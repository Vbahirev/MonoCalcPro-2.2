import { ref, computed, watch } from 'vue';
import { useDatabase } from '@/composables/useDatabase';
import { USER_DATA_KEY } from '@/data/defaults';
import { sanitizeText } from '@/utils/sanitize';
import { isCoatingAllowedForMaterial } from '@/utils/coatingCompatibility';

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

// ВАЖНО: состояние должно быть *инстансным*, а не модульным.
// Это позволяет подключать много калькуляторов (или несколько инстансов одного)
// без взаимного влияния. Логика расчётов при этом остаётся 1:1.
function createState() {
    return {
        project: ref({ name: '', client: '', discount: 0, markup: 0 }),
        layers: ref([]),
        processing: ref([]),
        accessories: ref([]),
        packaging: ref([]),
        design: ref([]),
        currentProjectId: ref(null),
        autoSaveCounter: ref(parseInt(localStorage.getItem('monocalc_autosave_counter')) || 1),
    };
}

export function useLaserCalculator() {
    const { project, layers, processing, accessories, packaging, design, currentProjectId, autoSaveCounter } = createState();

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
    
    const addItem = (listRef, defaultType = 'fixed') => { 
        listRef.value.unshift({ 
            id: Date.now() + Math.random(), 
            dbId: '', name: '', type: defaultType, value: null, price: null, qty: 1 
        }); 
    };

    const addProcessing = () => { 
        processing.value.unshift({ 
            id: Date.now() + Math.random(), 
            name: `Услуга ${processing.value.length + 1}`, 
            dbId: '', type: 'fixed', value: null, price: null, qty: 1 
        }); 
    };
    
    const addAccessory = () => addItem(accessories, 'pieces');
    const addPackaging = () => addItem(packaging, 'pieces');
    const addDesign = () => addItem(design, 'fixed');

    // --- ФУНКЦИИ УДАЛЕНИЯ ---
    const removeLayer = (id) => layers.value = layers.value.filter(x => x.id !== id);
    const removeItem = (listRef, id) => listRef.value = listRef.value.filter(x => x.id !== id);
    
    const removeProcessing = (id) => removeItem(processing, id);
    const removeAccessory = (id) => removeItem(accessories, id);
    const removePackaging = (id) => removeItem(packaging, id);
    const removeDesign = (id) => removeItem(design, id);

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

    // --- ИСТОРИЯ И ОБЛАКО (С УМНЫМ ФИЛЬТРОМ) ---
    
    // 1. Парсер даты (понимает и ISO, и Русский формат)
    const parseProjectDate = (dateStr) => {
        if (!dateStr) return new Date(0);
        if (dateStr.includes('T')) return new Date(dateStr); // ISO формат
        
        try {
            // Формат: 25.05.2025, 14:30
            const [dPart, tPart] = dateStr.split(', ');
            const [d, m, y] = dPart.split('.');
            // Месяцы в JS начинаются с 0, поэтому формат YYYY-MM-DD корректен для конструктора
            return new Date(`${y}-${m}-${d}T${tPart || '00:00'}:00`);
        } catch (e) {
            return new Date(0);
        }
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

    const getFullState = () => ({
        layers: layers.value,
        processing: processing.value,
        accessories: accessories.value,
        packaging: packaging.value,
        design: design.value,
        project: project.value
    });

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

    const saveToHistory = async (nameOverride) => {
        if (!hasPermission('canSaveHistory')) throw new Error('Недостаточно прав для сохранения истории');
        const finalNameRaw = nameOverride || project.value.name;
        const finalName = sanitizeText(finalNameRaw);
        const finalClient = sanitizeText(project.value.client);
        project.value.client = finalClient;
        if (!finalName) throw new Error("Введите название проекта");
        project.value.name = finalName;
        if (!currentProjectId.value) {
            currentProjectId.value = 'proj_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        }

        const payload = {
            id: currentProjectId.value,
            name: finalName,
            client: finalClient,
            date: new Date().toISOString(),
            total: totals.value.total,
            state: getFullState()
        };

        const result = await saveCloudHistory(payload);
        if (result && result.status === 'error') throw new Error(result.message);
        return result;
    };

    // Обертка для получения истории с применением фильтра
    const getFilteredCloudHistory = async () => {
        if (!hasPermission('canSaveHistory')) {
            return { status: 'error', message: 'Недостаточно прав для просмотра истории' };
        }
        const data = await apiGetHistory();
        
        let list = [];
        if (Array.isArray(data)) list = data;
        else if (data && data.result && Array.isArray(data.result)) list = data.result;
        
        // Применяем фильтр "30 дней" здесь, перед отдачей в интерфейс
        // Лимита .slice(0, 20) больше нет!
        return filterHistoryByRetention(list);
    };

    const triggerAutoSave = async () => {
        try {
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
    
    const deleteFromHistory = async (id) => {
        const result = await deleteCloudHistory(id);
        if (result && result.status === 'error') throw new Error(result.message);
        if (currentProjectId.value === id) currentProjectId.value = null;
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
        }).filter(item => item && item.totalAreaM2 > 0);
    });

    const totals = computed(() => {
        let lSum = 0; let fSum = 0; let pSum = 0; let aSum = 0; let kSum = 0; let dSum = 0; 
        
        if (materials.value.length > 0) {
            layers.value.forEach(l => {
                const m = materials.value.find(x => x.id === l.matId) || materials.value[0];
                if (!l.matId || !m) return;
                
                const sheetW = positive(toNum(m.sheetW, 0));
                const sheetH = positive(toNum(m.sheetH, 0));
                const sheetPrice = nonNeg(toNum(m.sheetPrice, 0));
                const sheetAreaCm2 = (sheetW / 10) * (sheetH / 10);
                const pricePerCm2 = sheetAreaCm2 > 0 ? (sheetPrice / sheetAreaCm2) : 0;
                const w = positive(toNum(l.w, 0));
                const h = positive(toNum(l.h, 0));
                const qty = qtySafe(l.qty);
                const areaInput = positive(toNum(l.area, 0));
                const currentArea = areaInput > 0 ? areaInput : (w > 0 && h > 0 ? (Math.round((w * h) / 100 * 10) / 10) : 0);

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
                
                lSum += (matCost + cutCost + engrCost) * qty;
                
                if (l.finishing !== 'none') {
                    const coat = coatings.value.find(c => c.id === l.finishing);
                    if (coat && isCoatingAllowedForMaterial(coat, m)) {
                        const areaCm2 = currentArea;
                        const coatPrice = nonNeg(toNum(coat.price, 0));
                        const finishingMultiplier = l.finishingBothSides ? 2 : 1;
                        fSum += (areaCm2 * coatPrice * finishingMultiplier) * qty;
                    }
                }
            });
        }
        
        const baseForPercent = lSum + fSum;
        const calcList = (list) => {
            let sum = 0;
            list.forEach(item => {
                const valRaw = toNum(item.value, 0);
                const priceRaw = toNum(item.price, 0);
                const qty = qtySafe(item.qty);
                const val = nonNeg(valRaw);
                const price = nonNeg(priceRaw);
                const w = positive(toNum(item.w, 0));
                const h = positive(toNum(item.h, 0));
                const length = nonNeg(toNum(item.length, 0));
                if (item.type === 'percent') sum += baseForPercent * (clamp(val, 0, 100) / 100); 
                else if (item.type === 'linear') sum += price * (length / 1000) * qty;
                else if (item.type === 'linear_mm') sum += price * length * qty;
                else if (item.type === 'area') sum += price * ((w * h) / 1000000) * qty;
                else if (item.type === 'area_mm2') sum += price * (w * h) * qty;
                else if (item.type === 'roll') sum += price * (length / 1000) * qty;
                else {
                    if (val > 0) sum += val;
                    else if (price > 0) sum += price * qty;
                }
            });
            return sum;
        };

        pSum = calcList(processing.value); 
        aSum = calcList(accessories.value); 
        kSum = calcList(packaging.value); 
        dSum = calcList(design.value);

        let subTotal = lSum + fSum + pSum + aSum + kSum + dSum;
        const markupPct = nonNeg(toNum(project.value.markup, 0));
        const discountPct = clamp(toNum(project.value.discount, 0), 0, 100);
        let markupRub = subTotal * (markupPct / 100);
        let totalWithMarkup = subTotal + markupRub;
        let discountRub = totalWithMarkup * (discountPct / 100);
        let grandTotal = Math.max(0, totalWithMarkup - discountRub);

        return { 
            layers: Math.round(lSum + fSum), 
            processing: Math.round(pSum), 
            accessories: Math.round(aSum), 
            packaging: Math.round(kSum), 
            design: Math.round(dSum), 
            markupRub: Math.round(markupRub), 
            discountRub: Math.round(discountRub), 
            total: Math.round(grandTotal) 
        };
    });

    return {
        materials, materialGroups, coatings, 
        processingDB, accessoriesDB, packagingDB, designDB, settings, 
        
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
        triggerAutoSave
    };
}