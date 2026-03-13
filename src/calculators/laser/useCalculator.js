import { ref, computed, watch } from 'vue';
import { useDatabase } from '@/composables/useDatabase';
import { USER_DATA_KEY } from '@/data/defaults';
import { sanitizeText } from '@/utils/sanitize';
import { isCoatingAllowedForMaterial } from '@/utils/coatingCompatibility';
import { COATING_PRICING_MODE_DTF_LINEAR, getCoatingPricePerCm2 } from '@/utils/coatingPricing';

// --- FIX 3.4 (Zombie tabs): изоляция автосохранения между вкладками ---
// По умолчанию localStorage общий для всех вкладок, из-за чего два открытых калькулятора
// могут перетирать состояние друг друга. Используем sessionStorage (с запасным вариантом)
// и отдельный ключ на вкладку.
const TAB_ID_KEY = 'monocalc_tab_id_v1';

const getTabId = () => {
    try {
        const existing = window.sessionStorage.getItem(TAB_ID_KEY);
        if (existing) return existing;
        const id = `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        window.sessionStorage.setItem(TAB_ID_KEY, id);
        return id;
    } catch (e) {
        // Если sessionStorage недоступен (жесткие настройки браузера) — деградируем корректно.
        return `tab_fallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
};

const getPreferredStorage = () => {
    // 1) sessionStorage (изолирован по вкладке)
    try {
        const ss = window.sessionStorage;
        const k = '__monocalc_test__';
        ss.setItem(k, '1');
        ss.removeItem(k);
        return ss;
    } catch (e) {}
    // 2) localStorage (как запасной вариант)
    try {
        const ls = window.localStorage;
        const k = '__monocalc_test__';
        ls.setItem(k, '1');
        ls.removeItem(k);
        return ls;
    } catch (e) {}
    // 3) No-op storage (приложение продолжит работать, но без автосохранения)
    return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
};
// --- ВАЛИДАЦИЯ ЧИСЕЛ (защита от NaN и "отрицательной экономики") ---
const toNum = (v, fallback = 0) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const nonNeg = (n) => Math.max(0, n);
const positive = (n) => (n > 0 ? n : 0);
const qtySafe = (q) => {
    const n = toNum(q, 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
};
const hasNumericInput = (value) => {
    if (value === '' || value === null || value === undefined) return false;
    return Number.isFinite(toNum(value, NaN));
};
const usesValueField = (type) => type === 'fixed' || type === 'percent';
const DELETE_UNDO_TOAST_DURATION = 5000;
const normalizeSides = (value) => {
    const parsed = Math.round(toNum(value, 1));
    return parsed >= 2 ? 2 : 1;
};
const applyMarkup = (value, markupPercent) => {
    const amount = toNum(value, 0);
    const pct = Math.max(0, toNum(markupPercent, 0));
    return amount * (1 + pct / 100);
};

// ВАЖНО: состояние должно быть *инстансным*, а не модульным.
// Это позволяет подключать много калькуляторов (или несколько инстансов одного)
// без взаимного влияния. Логика расчётов при этом остаётся 1:1.
function createState() {
    const readAutoSaveCounter = () => {
        try {
            return parseInt(localStorage.getItem('monocalc_autosave_counter'), 10) || 1;
        } catch (e) {
            return 1;
        }
    };

    return {
        project: ref({ name: '', client: '', discount: 0, markup: 0 }),
        layers: ref([]),
        processing: ref([]),
        accessories: ref([]),
        packaging: ref([]),
        design: ref([]),
        toast: ref({ show: false, message: '', actionLabel: '', onAction: null }),
        currentProjectId: ref(null),
        autoSaveCounter: ref(readAutoSaveCounter()),
    };
}

export function useLaserCalculator() {
    const { project, layers, processing, accessories, packaging, design, toast, currentProjectId, autoSaveCounter } = createState();
    let skipNextAutoSaveAfterReset = false;
    let toastTimer = null;

    const tabId = getTabId();
    const storage = getPreferredStorage();
    const USER_DATA_STORAGE_KEY = `${USER_DATA_KEY}_${tabId}`;
// Нормализуем ключевые поля проекта (скидка/наценка) без изменения UX-логики:
//  - скидка строго 0..100%
//  - наценка >= 0
watch(project, () => {
    const nextDiscount = clamp(toNum(project.value.discount, 0), 0, 100);
    const nextMarkup = nonNeg(toNum(project.value.markup, 0));
    if (project.value.discount !== nextDiscount) project.value.discount = nextDiscount;
    if (project.value.markup !== nextMarkup) project.value.markup = nextMarkup;
}, { deep: true });

    const { 
        materials, coatings, processingDB, accessoriesDB, packagingDB, designDB, settings, 
        materialGroups, initDatabase, syncStatus,
        hasPermission,
        // History/Trash (3.2 Single Source of Truth)
        saveCloudHistory,
        getCloudHistory: apiGetHistory,
        deleteCloudHistory,
        getCloudTrash,
        restoreCloudHistoryFromTrash,
        deleteTrashForever
    } = useDatabase();

    const getFirstAvailableDbItem = (dbListRef) => {
        const list = Array.isArray(dbListRef?.value) ? dbListRef.value : [];
        return list.find((entry) => entry?.active !== false && entry?.inStock !== false) || list[0] || null;
    };

    const applyDbDefaultsToItem = (item, dbItem, { forceNumbers = false } = {}) => {
        if (!item || !dbItem) return item;

        const markup = Math.max(0, toNum(dbItem?.markupPercent, 0));
        const nextType = dbItem?.type || item?.type || 'fixed';
        const typeChanged = item.type && item.type !== nextType;
        const shouldUseValue = usesValueField(nextType);
        const defaultValue = nextType === 'percent'
            ? applyMarkup(dbItem?.price ?? dbItem?.value ?? 0, markup)
            : applyMarkup(dbItem?.value ?? dbItem?.price ?? 0, markup);
        const defaultPrice = applyMarkup(dbItem?.price ?? dbItem?.value ?? 0, markup);
        const defaultRollWidth = toNum(dbItem?.rollWidthMm ?? dbItem?.rollWidth, 0);

        item.dbId = dbItem?.id ?? item.dbId;
        item.name = dbItem?.name ?? item.name;
        item.type = nextType;

        if (shouldUseValue && (forceNumbers || typeChanged || !hasNumericInput(item.value))) {
            item.value = defaultValue;
        }
        else if (!shouldUseValue && (forceNumbers || typeChanged)) {
            item.value = null;
        }

        if (!shouldUseValue && (forceNumbers || typeChanged || !hasNumericInput(item.price))) {
            item.price = defaultPrice;
        }
        else if (shouldUseValue && (forceNumbers || typeChanged)) {
            item.price = null;
        }

        if (defaultRollWidth > 0 && (forceNumbers || !hasNumericInput(item.rollWidthMm))) {
            item.rollWidthMm = defaultRollWidth;
        }

        if (!hasNumericInput(item.qty)) {
            item.qty = 1;
        }

        return item;
    };
    
    // --- ФУНКЦИИ ДОБАВЛЕНИЯ ---
    const addLayer = () => {
        layers.value.forEach(l => l.expanded = false);
        layers.value.unshift({ 
            id: Date.now() + Math.random(), 
            name: `Деталь ${layers.value.length + 1}`, 
            matId: "", 
            expanded: true, 
            w: null, h: null, area: 0, cut: null, qty: 1, 
            finishing: 'none', 
            finishingBothSides: false,
            hasEngraving: false, engravingW_mm: null, engravingH_mm: null, engravingArea: 0 
        });
    };
    
    const addItem = (listRef, defaultType = 'fixed', dbListRef = null, fallbackName = '', seedFromDb = true) => {
        const item = {
            id: Date.now() + Math.random(), 
            dbId: '', name: fallbackName, type: defaultType, value: null, price: null, qty: 1 
        };
        if (seedFromDb) {
            const defaultDbItem = getFirstAvailableDbItem(dbListRef);
            if (defaultDbItem) applyDbDefaultsToItem(item, defaultDbItem, { forceNumbers: true });
        }
        listRef.value.unshift(item);
        return item;
    };

    const addProcessing = () => { 
        return addItem(processing, 'fixed', processingDB, `Услуга ${processing.value.length + 1}`, false);
    };
    
    const addAccessory = () => addItem(accessories, 'pieces', accessoriesDB, `Аксессуар ${accessories.value.length + 1}`, false);
    const addPackaging = () => addItem(packaging, 'pieces', packagingDB, `Упаковка ${packaging.value.length + 1}`, false);
    const addDesign = () => addItem(design, 'fixed', designDB, `Дизайн ${design.value.length + 1}`, false);

    const clonePlain = (value) => JSON.parse(JSON.stringify(value));

    const hideToast = () => {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        toast.value = { show: false, message: '', actionLabel: '', onAction: null };
    };

    const showToast = (message, options = {}) => {
        const { actionLabel = '', onAction = null, duration = actionLabel ? DELETE_UNDO_TOAST_DURATION : 3000 } = options;
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        toast.value = { show: true, message, actionLabel, onAction };
        if (duration > 0) {
            toastTimer = window.setTimeout(() => {
                hideToast();
            }, duration);
        }
    };

    const runToastAction = () => {
        const action = toast.value?.onAction;
        hideToast();
        if (typeof action === 'function') action();
    };

    const removeFromListWithUndo = (listRef, id, { message, undoMessage }) => {
        const currentList = Array.isArray(listRef.value) ? listRef.value : [];
        const index = currentList.findIndex((item) => item?.id === id);
        if (index < 0) return;

        const removedItem = clonePlain(currentList[index]);
        listRef.value = currentList.filter((item) => item?.id !== id);

        showToast(message, {
            actionLabel: 'Отмена',
            duration: DELETE_UNDO_TOAST_DURATION,
            onAction: () => {
                const nextList = Array.isArray(listRef.value) ? [...listRef.value] : [];
                const restoreIndex = Math.max(0, Math.min(index, nextList.length));
                nextList.splice(restoreIndex, 0, removedItem);
                listRef.value = nextList;
                showToast(undoMessage);
            },
        });
    };

    // --- ФУНКЦИИ УДАЛЕНИЯ ---
    const removeLayer = (id) => removeFromListWithUndo(layers, id, {
        message: 'Деталь удалена',
        undoMessage: 'Удаление детали отменено',
    });
    const removeItem = (listRef, id, message, undoMessage) => removeFromListWithUndo(listRef, id, {
        message,
        undoMessage,
    });
    
    const removeProcessing = (id) => removeItem(processing, id, 'Услуга удалена', 'Удаление услуги отменено');
    const removeAccessory = (id) => removeItem(accessories, id, 'Товар удалён', 'Удаление товара отменено');
    const removePackaging = (id) => removeItem(packaging, id, 'Упаковка удалена', 'Удаление упаковки отменено');
    const removeDesign = (id) => removeItem(design, id, 'Макет удалён', 'Удаление макета отменено');

    // --- ИНИЦИАЛИЗАЦИЯ ---
    const init = async () => {
        await initDatabase();
        loadUserProject();
        
        if (layers.value.length === 0) addLayer();
        if (processing.value.length === 0) addProcessing();
        if (accessories.value.length === 0) addAccessory();
        if (packaging.value.length === 0) addPackaging();
        if (design.value.length === 0) addDesign();
    };

    const resetAll = () => {
        storage.removeItem(USER_DATA_STORAGE_KEY);
        currentProjectId.value = null;
        layers.value = []; addLayer();
        processing.value = []; addProcessing();
        accessories.value = []; addAccessory();
        packaging.value = []; addPackaging();
        design.value = []; addDesign();
        project.value = { name: '', client: '', discount: 0, markup: 0 };
        skipNextAutoSaveAfterReset = true;
    };

    const loadUserProject = () => {
        let savedProject = storage.getItem(USER_DATA_STORAGE_KEY);
        // Миграция: если старый ключ есть (до FIX 3.4), подхватим его один раз
        // и перенесем в изолированное хранилище текущей вкладки.
        if (!savedProject) {
            const legacy = (() => { try { return window.localStorage.getItem(USER_DATA_KEY); } catch (e) { return null; } })();
            if (legacy) {
                savedProject = legacy;
                try { storage.setItem(USER_DATA_STORAGE_KEY, legacy); } catch (e) {}
            }
        }
        if (savedProject) {
            try {
                const d = JSON.parse(savedProject);
                project.value = d.project || project.value;
                layers.value = (d.layers || []).map(l => ({ ...l, expanded: l.expanded !== false, finishingBothSides: !!l.finishingBothSides }));
                processing.value = d.processing || [];
                accessories.value = d.accessories || [];
                packaging.value = d.packaging || [];
                design.value = d.design || [];
                currentProjectId.value = d.currentProjectId || null;
            } catch (e) { console.error('Project load error:', e); }
        }
    };

    const syncListWithDb = (listRef, dbListRef) => {
        const list = listRef?.value;
        const dbList = dbListRef?.value;
        if (!Array.isArray(list) || !Array.isArray(dbList) || !dbList.length) return;

        list.forEach((item) => {
            if (!item?.dbId) return;
            const dbItem = dbList.find((entry) => entry?.id === item.dbId);
            if (!dbItem) return;
            applyDbDefaultsToItem(item, dbItem);
        });
    };

    // --- АВТОСОХРАНЕНИЕ ---
    let saveTimeout = null;
    watch([layers, processing, accessories, packaging, design, project, currentProjectId], () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            try {
                storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify({ 
                    project: project.value, 
                    layers: layers.value, 
                    processing: processing.value, 
                    accessories: accessories.value, 
                    packaging: packaging.value, 
                    design: design.value,
                    currentProjectId: currentProjectId.value
                }));
            } catch (e) { console.error("Save failed", e); }
        }, 1000);
    }, { deep: true });

    watch([processingDB, accessoriesDB, packagingDB, designDB], () => {
        syncListWithDb(processing, processingDB);
        syncListWithDb(accessories, accessoriesDB);
        syncListWithDb(packaging, packagingDB);
        syncListWithDb(design, designDB);
    }, { deep: true, immediate: true });

    // --- ИСТОРИЯ И ОБЛАКО (С УМНЫМ ФИЛЬТРОМ) ---
    
    // 1. Парсер даты (понимает и ISO, и Русский формат)
    const parseProjectDate = (input) => {
        if (!input) return new Date(0);

        // If it's already a Date
        if (input instanceof Date) return input;

        // Firestore Timestamp has toDate()
        try {
            if (typeof input === 'object' && typeof input.toDate === 'function') {
                return input.toDate();
            }
        } catch (e) {}

        // If it's a number (ms since epoch)
        if (typeof input === 'number') return new Date(input);

        // If it's a string - try ISO first, then dd.mm.yyyy
        if (typeof input === 'string') {
            const s = input.trim();
            if (s.includes('T')) return new Date(s);
            try {
                const [dPart, tPart] = s.split(', ');
                const [d, m, y] = (dPart || '').split('.');
                if (d && m && y) {
                    return new Date(`${y}-${m}-${d}T${tPart || '00:00'}:00`);
                }
            } catch (e) {}
            // Fallback to Date constructor
            const maybe = new Date(s);
            if (!isNaN(maybe.getTime())) return maybe;
        }

        return new Date(0);
    };

    // 2. Функция фильтрации (Оставляет только свежее 30 дней)
    const filterHistoryByRetention = (list) => {
        if (!Array.isArray(list)) return [];
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Оставляем только те, что моложе 30 дней
        return list.filter(item => {
            const itemDate = parseProjectDate(item.date);
            return itemDate >= thirtyDaysAgo;
        });
    };

    const getFullState = () => JSON.parse(JSON.stringify({
        layers: layers.value,
        processing: processing.value,
        accessories: accessories.value,
        packaging: packaging.value,
        design: design.value,
        project: project.value
    }));

    const loadState = (data, id) => {
        if (!data) return;
        // ✅ FIX 3.1 (Race Condition):
        // История загружается на отдельном экране и затем выполняется router.push обратно в калькулятор.
        // Если опираться только на отложенный autosave (setTimeout), калькулятор может успеть
        // прочитать старое/пустое состояние из localStorage и перезаписать загруженный проект.
        // Поэтому делаем синхронную запись в localStorage сразу после применения состояния.
        currentProjectId.value = id;
        layers.value = (data.layers || []).map(l => ({ ...l, finishingBothSides: !!l.finishingBothSides }));
        processing.value = data.processing || [];
        accessories.value = data.accessories || [];
        packaging.value = data.packaging || [];
        design.value = data.design || [];
        project.value = { ...project.value, ...(data.project || {}) };

        // Сбрасываем отложенное сохранение, чтобы оно не затёрло данные "старым" снапшотом.
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }

        // Принудительное синхронное сохранение перед навигацией.
        try {
            storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify({
                project: project.value,
                layers: layers.value,
                processing: processing.value,
                accessories: accessories.value,
                packaging: packaging.value,
                design: design.value,
                currentProjectId: currentProjectId.value
            }));
        } catch (e) {
            console.error('Forced save failed', e);
        }
    };

    const saveToHistory = async (nameOverride, opts = {}) => {
        if (!hasPermission('canSaveHistory')) throw new Error('Недостаточно прав для сохранения истории');
        const forceNew = !!opts?.forceNew;
        const finalNameRaw = nameOverride || project.value.name;
        const finalName = sanitizeText(finalNameRaw);
        const finalClient = sanitizeText(project.value.client);
        project.value.client = finalClient;
        if (!finalName) throw new Error("Введите название проекта");
        project.value.name = finalName;
        if (forceNew || !currentProjectId.value) {
            currentProjectId.value = 'proj_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        }

        const orderQty = qtySafe(project.value.qty);
        const unitTotal = Number(totals.value.total) || 0;
        const orderTotal = Math.round(unitTotal * orderQty);

        const payload = {
            id: currentProjectId.value,
            name: finalName,
            client: finalClient,
            date: new Date().toISOString(),
            total: orderTotal,
            totalPerUnit: unitTotal,
            totalOrder: orderTotal,
            qty: orderQty,
            state: getFullState()
        };

        const result = await saveCloudHistory(payload);
        if (result && result.status === 'error') throw new Error(result.message);
        return result;
    };

    // Обертка для получения истории с применением фильтра
    const getFilteredCloudHistory = async (opts = {}) => {
        const data = await apiGetHistory(opts);
        if (data && data.status === 'error') return data;

        if (Array.isArray(data)) {
            return filterHistoryByRetention(data);
        }

        if (data && Array.isArray(data.result)) {
            return {
                ...data,
                result: filterHistoryByRetention(data.result)
            };
        }

        return [];
    };

    const triggerAutoSave = async () => {
        try {
            if (skipNextAutoSaveAfterReset) {
                skipNextAutoSaveAfterReset = false;
                return false;
            }
            if (!hasPermission('canSaveHistory')) return false;
            let nameToUse = project.value.name;
            if (!nameToUse || !nameToUse.trim()) {
                nameToUse = `Без названия ${autoSaveCounter.value}`;
                project.value.name = nameToUse;
                autoSaveCounter.value++;
                localStorage.setItem('monocalc_autosave_counter', autoSaveCounter.value);
            }
            await saveToHistory(nameToUse);
            return true;
        } catch (e) { return false; }
    };

    const clearDeletedProjectFromStoredState = (deletedId) => {
        if (!deletedId) return;
        try {
            const raw = storage.getItem(USER_DATA_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed?.currentProjectId !== deletedId) return;

            parsed.currentProjectId = null;
            storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(parsed));
        } catch (e) {
            // ignore storage parsing issues
        }
    };
    
    const deleteFromHistory = async (id) => {
        const result = await deleteCloudHistory(id);
        if (result && result.status === 'error') throw new Error(result.message);
        if (currentProjectId.value === id) currentProjectId.value = null;
        clearDeletedProjectFromStoredState(id);
        return result;
    };


const getTrash = async () => {
    if (!hasPermission('canSaveHistory')) {
        return { status: 'error', message: 'Недостаточно прав для просмотра корзины' };
    }
    const data = await getCloudTrash();
    // getCloudTrash возвращает массив или объект ошибки
    if (Array.isArray(data)) return data;
    return data;
};

const restoreFromTrash = async (id) => {
    const result = await restoreCloudHistoryFromTrash(id);
    if (result && result.status === 'error') throw new Error(result.message);
    return result;
};

const deleteFromTrashForever = async (id) => {
    const result = await deleteTrashForever(id);
    if (result && result.status === 'error') throw new Error(result.message);
    return result;
};

    // --- РАСЧЕТЫ (LOGIC) ---
    const materialConsumption = computed(() => {
        const usage = {};
        layers.value.forEach(l => {
            if (!l.matId) return;
            if (!usage[l.matId]) usage[l.matId] = { area: 0 };
            const partArea = (l.area && l.area > 0) ? l.area : (l.w * l.h / 100);
            usage[l.matId].area += partArea * l.qty;
        });

        return Object.keys(usage).map(matId => {
            const mat = materials.value.find(m => m.id === matId);
            if (!mat) return null;
            const totalPartAreaCm2 = usage[matId].area;
            const sheetW = parseFloat(mat.sheetW) || 0;
            const sheetH = parseFloat(mat.sheetH) || 0;
            const sheetAreaCm2 = (sheetW / 10) * (sheetH / 10);

            let sheetsNeeded = 0;
            let percentFilled = 0;

            if (sheetAreaCm2 > 0) {
                const requiredArea = totalPartAreaCm2;
                sheetsNeeded = Math.ceil(requiredArea / sheetAreaCm2);
                if (sheetsNeeded > 0) {
                    percentFilled = Math.round((requiredArea / (sheetsNeeded * sheetAreaCm2)) * 100);
                }
            }

            return {
                id: mat.id, name: mat.name,
                totalAreaM2: (totalPartAreaCm2 / 10000).toFixed(2),
                sheets: sheetsNeeded,
                sheetSize: sheetAreaCm2 > 0 ? `${mat.sheetW}x${mat.sheetH}` : null,
                percent: Math.min(percentFilled, 100),
                isValid: sheetAreaCm2 > 0
            };
        }).filter(item => item && Number(item.totalAreaM2) > 0);
    });

    const totals = computed(() => {
        let lCostSum = 0;
        let fCostSum = 0;
        let pCostSum = 0;
        let aCostSum = 0;
        let kCostSum = 0;
        let dCostSum = 0;

        let lSaleSum = 0;
        let fSaleSum = 0;
        let pSaleSum = 0;
        let aSaleSum = 0;
        let kSaleSum = 0;
        let dSaleSum = 0;
        
        if (materials.value.length > 0) {
            layers.value.forEach(l => {
                const m = materials.value.find(x => x.id === l.matId) || materials.value[0];
                if (!l.matId || !m) return;
                
                const sheetW = positive(toNum(m.sheetW, 0));
                const sheetH = positive(toNum(m.sheetH, 0));
                const materialMarkup = nonNeg(toNum(m.markupPercent, 0));
                const sheetPriceBase = nonNeg(toNum(m.sheetPrice, 0));
                const sheetPrice = sheetPriceBase * (1 + materialMarkup / 100);
                const sheetAreaCm2 = (sheetW / 10) * (sheetH / 10);
                const costPricePerCm2 = sheetAreaCm2 > 0 ? (sheetPriceBase / sheetAreaCm2) : 0;
                const pricePerCm2 = sheetAreaCm2 > 0 ? (sheetPrice / sheetAreaCm2) : 0;
                const w = positive(toNum(l.w, 0));
                const h = positive(toNum(l.h, 0));
                const qty = qtySafe(l.qty);
                const areaInput = positive(toNum(l.area, 0));
                const currentArea = areaInput > 0 ? areaInput : (w > 0 && h > 0 ? (Math.round((w * h) / 100 * 10) / 10) : 0);

                const matCostBase = currentArea * costPricePerCm2 * (nonNeg(toNum(settings.value.wastage, 1)));
                const matCost = currentArea * pricePerCm2 * (nonNeg(toNum(settings.value.wastage, 1)));
                const cutLengthMm = nonNeg(toNum(l.cut, 0));
                const speed = toNum(m.speed, 1) > 0 ? toNum(m.speed, 1) : 1; 
                const cutCost = (cutLengthMm / speed / 60) * (nonNeg(toNum(settings.value.laserMinuteCost, 0)));
                const engravingPricePerCm2 = (() => {
                    const directCm2 = toNum(settings.value.engravingPrice, NaN);
                    if (Number.isFinite(directCm2)) return nonNeg(directCm2);
                    const legacyBlock = nonNeg(toNum(settings.value.engravingCost100x100mm, 0));
                    return legacyBlock / 100;
                })();
                const engravingAreaCm2ByDims = (positive(toNum(l.engravingW_mm, 0)) * positive(toNum(l.engravingH_mm, 0))) / 100;
                const engravingAreaCm2 = engravingAreaCm2ByDims > 0
                    ? engravingAreaCm2ByDims
                    : positive(toNum(l.engravingArea, 0));
                const engrCost = l.hasEngraving ? engravingAreaCm2 * engravingPricePerCm2 : 0;
                
                lCostSum += (matCostBase + cutCost + engrCost) * qty;
                lSaleSum += (matCost + cutCost + engrCost) * qty;
                
                if (l.finishing !== 'none') {
                    const coat = coatings.value.find(c => c.id === l.finishing);
                    if (coat && coat?.pricingModel !== COATING_PRICING_MODE_DTF_LINEAR && isCoatingAllowedForMaterial(coat, m)) {
                        const areaCm2 = currentArea;
                        const coatPricePerCm2 = getCoatingPricePerCm2(coat);
                        const coatCostPricePerCm2 = getCoatingPricePerCm2(coat, { includeMarkup: false });
                        const finishingMultiplier = l.finishingBothSides ? 2 : 1;
                        fCostSum += (areaCm2 * coatCostPricePerCm2 * finishingMultiplier) * qty;
                        fSaleSum += (areaCm2 * coatPricePerCm2 * finishingMultiplier) * qty;
                    }
                }
            });
        }
        
        const baseForPercentCost = lCostSum + fCostSum;
        const baseForPercentSale = lSaleSum + fSaleSum;

        const resolveItemFromDb = (item, dbListRef, useDbMarkup = true) => {
            const dbList = dbListRef?.value;
            if (!item?.dbId || !Array.isArray(dbList) || !dbList.length) return item;
            const dbItem = dbList.find((entry) => entry?.id === item.dbId);
            if (!dbItem) return item;

            const markup = Math.max(0, toNum(dbItem?.markupPercent, 0));
            const factor = useDbMarkup ? (1 + markup / 100) : 1;
            const nextType = dbItem?.type || item?.type || 'fixed';
            const shouldUseValue = usesValueField(nextType);
            const dbValue = toNum(
                nextType === 'percent'
                    ? (dbItem?.price ?? dbItem?.value ?? 0)
                    : (dbItem?.value ?? dbItem?.price ?? 0),
                0
            ) * factor;
            const dbPrice = toNum(dbItem?.price ?? dbItem?.value ?? 0, 0) * factor;
            const dbRollWidth = toNum(dbItem?.rollWidthMm ?? dbItem?.rollWidth, 0);

            return {
                ...item,
                name: dbItem?.name ?? item?.name,
                type: nextType,
                value: shouldUseValue
                    ? (hasNumericInput(item?.value) ? toNum(item.value, 0) : dbValue)
                    : null,
                price: shouldUseValue
                    ? null
                    : (hasNumericInput(item?.price) ? toNum(item.price, 0) : dbPrice),
                rollWidthMm: hasNumericInput(item?.rollWidthMm)
                    ? toNum(item.rollWidthMm, 0)
                    : (dbRollWidth || item?.rollWidthMm),
            };
        };
        const calcList = (list, dbListRef, baseForPercent, useDbMarkup = true) => {
            let sum = 0;
            list.forEach(itemRaw => {
                const item = resolveItemFromDb(itemRaw, dbListRef, useDbMarkup);
                const valRaw = toNum(item.value, 0);
                const percentValRaw = toNum(item?.value, NaN);
                const priceRaw = toNum(item.price, 0);
                const qty = qtySafe(item.qty);
                const val = nonNeg(valRaw);
                const price = nonNeg(priceRaw);
                const w = positive(toNum(item.w, 0));
                const l = positive(toNum(item.l, 0));
                const h = positive(toNum(item.h, 0));
                const length = nonNeg(toNum(item.length, 0));
                if (item.type === 'percent') {
                    const percentVal = Number.isFinite(percentValRaw) ? Math.max(0, percentValRaw) : Math.max(0, priceRaw);
                    sum += baseForPercent * (percentVal / 100);
                }
                else if (item.type === 'pieces') sum += price * qty;
                else if (item.type === 'fixed') sum += val * qty;
                else if (item.type === 'linear') sum += price * (length / 1000) * qty;
                else if (item.type === 'linear_mm') sum += price * length * qty;
                else if (item.type === 'area') sum += price * ((w * h) / 1000000) * qty;
                else if (item.type === 'area_cm2') sum += price * ((w * h) / 100) * normalizeSides(item.sides) * qty;
                else if (item.type === 'area_mm2') sum += price * (w * h) * qty;
                else if (item.type === 'roll') sum += price * (length / 1000) * qty;
                else if (item.type === 'box_mm') {
                    // Price for box mode is treated as price per m2 of material.
                    const boxAreaMm2 = 2 * ((w * l) + (w * h) + (l * h));
                    sum += price * (boxAreaMm2 / 1000000) * qty;
                }
                else {
                    if (val > 0) sum += val;
                    else if (price > 0) sum += price * qty;
                }
            });
            return sum;
        };

        pCostSum = calcList(processing.value, processingDB, baseForPercentCost, false);
        aCostSum = calcList(accessories.value, accessoriesDB, baseForPercentCost, false);
        kCostSum = calcList(packaging.value, packagingDB, baseForPercentCost, false);
        dCostSum = calcList(design.value, designDB, baseForPercentCost, false);

        pSaleSum = calcList(processing.value, processingDB, baseForPercentSale, true);
        aSaleSum = calcList(accessories.value, accessoriesDB, baseForPercentSale, true);
        kSaleSum = calcList(packaging.value, packagingDB, baseForPercentSale, true);
        dSaleSum = calcList(design.value, designDB, baseForPercentSale, true);

        const costSubTotal = lCostSum + fCostSum + pCostSum + aCostSum + kCostSum + dCostSum;
        const saleSubTotal = lSaleSum + fSaleSum + pSaleSum + aSaleSum + kSaleSum + dSaleSum;
        const markupPct = nonNeg(toNum(project.value.markup, 0));
        const discountPct = clamp(toNum(project.value.discount, 0), 0, 100);
        let markupRub = saleSubTotal * (markupPct / 100);
        let totalWithMarkup = saleSubTotal + markupRub;
        let discountRub = totalWithMarkup * (discountPct / 100);
        const calculatedTotal = Math.max(0, totalWithMarkup - discountRub);
        const minimumOrderPrice = nonNeg(toNum(settings.value.minimumOrderPrice, 0));
        const grandTotal = Math.max(minimumOrderPrice, calculatedTotal);
        const minimumApplied = minimumOrderPrice > 0 && calculatedTotal < minimumOrderPrice;

        return { 
            layers: Math.round(lSaleSum + fSaleSum), 
            processing: Math.round(pSaleSum), 
            accessories: Math.round(aSaleSum), 
            packaging: Math.round(kSaleSum), 
            design: Math.round(dSaleSum), 
            costLayers: Math.round(lCostSum + fCostSum),
            costProcessing: Math.round(pCostSum),
            costAccessories: Math.round(aCostSum),
            costPackaging: Math.round(kCostSum),
            costDesign: Math.round(dCostSum),
            costTotal: Math.round(costSubTotal),
            markupRub: Math.round(markupRub), 
            discountRub: Math.round(discountRub), 
            calculatedTotal: Math.round(calculatedTotal),
            minimumOrderPrice: Math.round(minimumOrderPrice),
            minimumApplied,
            total: Math.round(grandTotal) 
        };
    });

    const hasAnyOutputData = computed(() => {
        const hasValidLayer = layers.value.some((layer) => {
            if (!layer?.matId) return false;

            const width = positive(toNum(layer?.w, 0));
            const height = positive(toNum(layer?.h, 0));
            const area = positive(toNum(layer?.area, 0));
            const cutLength = nonNeg(toNum(layer?.cut, 0));
            const engravingArea = positive(toNum(layer?.engravingArea, 0));
            const engravingWidth = positive(toNum(layer?.engravingW_mm, 0));
            const engravingHeight = positive(toNum(layer?.engravingH_mm, 0));

            return area > 0
                || (width > 0 && height > 0)
                || cutLength > 0
                || engravingArea > 0
                || (engravingWidth > 0 && engravingHeight > 0);
        });

        if (hasValidLayer) return true;

        return nonNeg(toNum(totals.value?.costTotal, 0)) > 0;
    });

    const validateProjectBeforeOutput = () => {
        if (hasAnyOutputData.value) return true;

        showToast('Нельзя сформировать КП: добавьте данные для расчёта.');
        return false;
    };

    return {
        materials, materialGroups, coatings, 
        processingDB, accessoriesDB, packagingDB, designDB, settings, 
        toast,
        
        project, layers, processing, accessories, packaging, design,
        totals, materialConsumption,
        
        init, resetAll, syncStatus, 
        addLayer, removeLayer, addProcessing, removeProcessing,
        addAccessory, removeAccessory, addPackaging, removePackaging, addDesign, removeDesign,
        currentProjectId, saveToHistory, loadState, 
        
        // ВОТ ЗДЕСЬ ПОДМЕНА: отдаем нашу функцию с фильтром вместо чистой API
        getCloudHistory: getFilteredCloudHistory,

        getTrash,
        restoreFromTrash,
        deleteFromTrashForever,

        hasPermission,

        deleteFromHistory,
        triggerAutoSave,
        validateProjectBeforeOutput,
        showToast,
        runToastAction
    };
}