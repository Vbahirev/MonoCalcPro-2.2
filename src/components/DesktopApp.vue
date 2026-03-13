<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useCalculator } from '@/core/useCalculator';
import { useDatabase } from '@/composables/useDatabase'; // <--- Импортируем базу
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue';
import ModernSelect from './ModernSelect.vue';
import Tooltip from './Tooltip.vue';
import PriceChart from './PriceChart.vue';
import InvoiceModal from './InvoiceModal.vue';
import MaterialConsumption from './MaterialConsumption.vue';
import AuthLogin from './AuthLogin.vue'; // <--- Импортируем окно входа
import { isCoatingAllowedForMaterial } from '@/utils/coatingCompatibility';
import { COATING_PRICING_MODE_DTF_LINEAR, getCoatingPricePerCm2 } from '@/utils/coatingPricing';
import { getCalculator } from '@/core/calculators/registry';
import { buildInvoicePayload } from '@/utils/invoicePayload';

const router = useRouter();

const props = defineProps({
  calculatorId: { type: [String, Object], default: 'laser' }
});

// Достаем глобального пользователя и проверку прав
const { user: currentUser, hasPermission, isOfflineMode } = useDatabase();

const { 
    init, settings,
    layers, processing, accessories, packaging, design, project,
    materials, materialGroups, 
    coatings, processingDB, accessoriesDB, packagingDB, designDB,
    toast,
    totals, materialConsumption: matConsumption,
    resetAll, syncStatus,
    addLayer, removeLayer, 
    addProcessing, removeProcessing, 
    addAccessory, removeAccessory, 
    addPackaging, removePackaging,
    addDesign, removeDesign,
    saveToHistory,
    triggerAutoSave,
    showToast,
    runToastAction
} = useCalculator(typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId);

const showSaveProjectModal = ref(false);
const showResetConfirm = ref(false);
const showInvoice = ref(false);
const productQty = ref(1);
const showAuthModal = ref(false); // <--- Для окна входа
const isManualSaving = ref(false);
const saveModalNotice = ref(null);
const activeTab = ref('layers');
const isCostVisible = ref(false);
const showScrollTop = ref(false);
const saveFireworks = ref([]);
let saveFireworkCounter = 0;
let saveFireworksTimer = null;

// Используем права для скрытия кнопок
const canViewHistory = computed(() => hasPermission('canSaveHistory'));
const canViewSettings = computed(() => hasPermission('canViewSettings'));
const canUseCloudSections = computed(() => !isOfflineMode.value);
const resolvedCalculatorId = computed(() => typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId);
const calculatorName = computed(() => getCalculator(resolvedCalculatorId.value)?.manifest?.name || 'Лазерная резка');
const DEFAULT_PACKAGING_ROLL_WIDTH_MM = 500;

const invoicePayload = computed(() => buildInvoicePayload({
    calculatorId: resolvedCalculatorId.value,
    project: project.value,
    productQty: productQty.value,
    layers: layers.value,
    processing: processing.value,
    accessories: accessories.value,
    packaging: packaging.value,
    design: design.value,
    totals: totals.value,
    settings: settings.value,
    materials: materials.value,
    coatings: coatings.value,
}));

const totalCutLengthMm = computed(() =>
    layers.value.reduce((sum, layer) => {
        const cut = Number(layer?.cut) || 0;
        const qty = Number(layer?.qty) || 1;
        return sum + (cut * qty);
    }, 0)
);

const totalCutLengthMeters = computed(() => (totalCutLengthMm.value / 1000).toFixed(1));

const totalMaterialSheets = computed(() =>
    matConsumption.value.reduce((sum, item) => sum + (Number(item?.sheets) || 0), 0)
);

const onWindowScroll = () => {
    showScrollTop.value = window.scrollY > 300;
};

const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

onMounted(() => {
    init();
    document.addEventListener('focusin', handleNumberFocusIn);
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    onWindowScroll();
});

onUnmounted(() => {
    document.removeEventListener('focusin', handleNumberFocusIn);
    window.removeEventListener('scroll', onWindowScroll);
    if (saveFireworksTimer) {
        clearTimeout(saveFireworksTimer);
        saveFireworksTimer = null;
    }
});

const statusConfig = computed(() => {
    if (isOfflineMode.value) {
        return {
            text: 'Офлайн',
            class: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/20',
            dot: 'bg-red-500'
        };
    }

    return {
        text: 'Онлайн',
        class: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300 border-green-100 dark:border-green-500/20',
        dot: 'bg-green-500'
    };
});

const showOfflineToast = () => {
    showToast('Офлайн: раздел временно недоступен', { duration: 2500 });
};

const blockCloudAction = (action) => {
    if (!canUseCloudSections.value) {
        showOfflineToast();
        return;
    }
    action();
};

const openSettings = () => {
    blockCloudAction(() => {
        router.push({ path: `/settings/${resolvedCalculatorId.value}`, query: { from: 'calc', calc: resolvedCalculatorId.value } });
    });
};

const openHistoryPage = async () => {
    blockCloudAction(async () => {
        if (canViewHistory.value) {
            await triggerAutoSave();
        }
        router.push({ path: '/history', query: { from: 'calc', calc: resolvedCalculatorId.value } });
    });
};

const goBackToHome = () => { router.push('/'); };

const onLoginSuccess = () => {
    showAuthModal.value = false;
    showToast('Вы успешно вошли');
};

const openSaveProjectModal = () => {
    blockCloudAction(() => {
        if (!currentUser.value) {
            showAuthModal.value = true;
            showToast('Сначала войдите в аккаунт', { duration: 2500 });
            return;
        }
        if (!canViewHistory.value) {
            showToast('Нет прав для сохранения в историю', { duration: 2500 });
            return;
        }
        saveModalNotice.value = isOfflineMode.value
            ? { type: 'info', text: 'Офлайн: проект сохранится в кэш браузера и автоматически синхронизируется при подключении к сети.' }
            : null;
        showSaveProjectModal.value = true;
    });
};

const handleManualSaveToHistory = async () => {
    if (!canViewHistory.value) {
        showToast('Нет прав для сохранения в историю', { duration: 2500 });
        return;
    }

    isManualSaving.value = true;
    if (isOfflineMode.value) {
        saveModalNotice.value = { type: 'info', text: 'Сохраняем в кэш браузера…' };
    }
    try {
        const result = await saveToHistory(project.value.name, { forceNew: true });
        triggerSaveFireworks();
        if (result?.status === 'queued') {
            saveModalNotice.value = { type: 'success', text: 'Сохранено в кэш. Синхронизация выполнится автоматически при подключении к сети.' };
            showToast('Офлайн: сохранено в кэш, синхронизация после подключения');
            setTimeout(() => {
                showSaveProjectModal.value = false;
                saveModalNotice.value = null;
            }, 1100);
        } else {
            showSaveProjectModal.value = false;
            saveModalNotice.value = null;
            showToast('Проект сохранён в Историю');
        }
    } catch (e) {
        showToast(e?.message || 'Ошибка сохранения');
    } finally {
        isManualSaving.value = false;
    }
};

const triggerSaveFireworks = () => {
    const palette = ['#60A5FA', '#34D399', '#F472B6', '#FBBF24', '#A78BFA', '#F87171'];
    const salvos = 6;
    const allParticles = [];

    for (let salvoIndex = 0; salvoIndex < salvos; salvoIndex++) {
        const salvoDelay = salvoIndex * 480 + Math.floor(Math.random() * 120);
        const originX = Math.round((Math.random() - 0.5) * 260);
        const originY = Math.round(-8 + Math.random() * 54);
        const particlesCount = 10 + Math.floor(Math.random() * 8);

        for (let particleIndex = 0; particleIndex < particlesCount; particleIndex++) {
            const angleRad = (Math.random() * 360 * Math.PI) / 180;
            const distance = 36 + Math.random() * 88;
            allParticles.push({
                id: `save-burst-${Date.now()}-${saveFireworkCounter++}-${salvoIndex}-${particleIndex}`,
                originX,
                originY,
                offsetX: Math.round(Math.cos(angleRad) * distance),
                offsetY: Math.round(Math.sin(angleRad) * distance),
                delayMs: salvoDelay + Math.floor(Math.random() * 170),
                durationMs: 800 + Math.floor(Math.random() * 700),
                sizePx: 3 + Math.random() * 7,
                color: palette[Math.floor(Math.random() * palette.length)]
            });
        }
    }

    if (saveFireworksTimer) clearTimeout(saveFireworksTimer);
    saveFireworks.value = allParticles;
    saveFireworksTimer = setTimeout(() => {
        saveFireworks.value = [];
        saveFireworksTimer = null;
    }, 3400);
};

// ... (Хелперы и методы) ...
const getTextClass = (val) => { return (val && parseFloat(val) > 0) ? 'text-black dark:text-white font-bold' : 'text-gray-400 dark:text-gray-500 font-normal'; };
const isAvailableItem = (item) => (item?.inStock !== false) && (item?.active !== false);
const applyMarkup = (value, markupPercent) => {
    const amount = Number(value) || 0;
    const pct = Math.max(0, Number(markupPercent) || 0);
    return amount * (1 + pct / 100);
};
const usesValueField = (type) => type === 'fixed' || type === 'percent';
const normalizeSides = (value) => (Number(value) === 2 ? 2 : 1);
const hasSelectedDbItem = (item) => Boolean(item?.dbId);
const mapOptions = (list, isGoods = false) => [...(list || [])]
    .filter(isAvailableItem)
    .reverse()
    .map(i => {
        const markup = Math.max(0, Number(i?.markupPercent) || 0);
        const price = applyMarkup(i?.price, markup);
        const value = i?.type === 'percent'
            ? applyMarkup(i?.price ?? i?.value ?? 0, markup)
            : applyMarkup(i?.value ?? i?.price ?? 0, markup);
        const rollWidth = Number(i?.rollWidthMm || i?.rollWidth) || 0;
        return {
            value: i.id,
            label: i.name,
            sub: isGoods
                ? `${Math.round(price)} ₽`
                : (i.type === 'percent'
                    ? `${Math.round(value)}%`
                    : i.type === 'linear'
                        ? `${Math.round(price)} ₽/м`
                        : i.type === 'linear_mm'
                            ? `${Math.round(price)} ₽/мм`
                            : i.type === 'area'
                                ? `${Math.round(price)} ₽/м²`
                                : i.type === 'area_cm2'
                                    ? `${Math.round(price)} ₽/см²`
                                : i.type === 'area_mm2'
                                    ? `${Math.round(price)} ₽/мм²`
                                    : i.type === 'roll'
                                        ? `${Math.round(price)} ₽/пог.м${rollWidth > 0 ? ` • ${rollWidth}мм` : ''}`
                                        : i.type === 'box_mm'
                                            ? `${Math.round(price)} ₽/м² коробки`
                                        : `${Math.round(value || price)} ₽`),
            active: i.active,
            inStock: i.inStock
        };
    });
const getFinishingOptions = (matId) => {
    const material = materials.value.find(m => m.id === matId);
    return coatings.value
        .filter(coating => coating?.inStock !== false)
        .filter(coating => coating?.pricingModel !== COATING_PRICING_MODE_DTF_LINEAR)
        .filter(coating => isCoatingAllowedForMaterial(coating, material))
    .map(c => {
        const pricePerCm2 = getCoatingPricePerCm2(c);
        const printable = pricePerCm2 >= 1 ? pricePerCm2.toFixed(2) : pricePerCm2.toFixed(3);
        return ({ value: c.id, label: c.name, sub: pricePerCm2 > 0 ? `${printable} ₽/см²` : '', inStock: c.inStock });
    });
};
const processingOptions = computed(() => mapOptions(processingDB.value));
const accessoryOptions = computed(() => mapOptions(accessoriesDB.value, true));
const packagingOptions = computed(() => mapOptions(packagingDB.value));
const designOptions = computed(() => mapOptions(designDB.value));
const formatSystemPrice = (value, suffix = '₽') => {
    const amount = Number(value) || 0;
    if (amount <= 0) return `0 ${suffix}`;
    const digits = amount >= 1 ? 2 : 4;
    return `${amount.toFixed(digits)} ${suffix}`;
};
const getProcessingSystemPriceValue = (item) => {
    if (!item?.dbId) return formatSystemPrice(item?.price, '₽/см²');
    const dbItem = (processingDB.value || []).find(entry => entry?.id === item.dbId);
    if (!dbItem) return formatSystemPrice(item?.price, '₽/см²');
    const markup = Math.max(0, Number(dbItem?.markupPercent) || 0);
    const price = applyMarkup(dbItem?.price ?? dbItem?.value ?? 0, markup);
    return formatSystemPrice(price, '₽/см²');
};
const getProcessingSystemPriceMeta = (item) => {
    if (!item?.dbId) return '';
    const dbItem = (processingDB.value || []).find(entry => entry?.id === item.dbId);
    if (!dbItem) return '';
    const markup = Math.max(0, Number(dbItem?.markupPercent) || 0);
    const price = applyMarkup(dbItem?.price ?? dbItem?.value ?? 0, markup);

    if (dbItem?.type === 'area_cm2') return `Из настроек: ${formatSystemPrice(price, '₽/см²')}`;
    if (dbItem?.type === 'area') return `Из настроек: ${formatSystemPrice(price, '₽/м²')}`;
    if (dbItem?.type === 'area_mm2') return `Из настроек: ${formatSystemPrice(price, '₽/мм²')}`;
    if (dbItem?.type === 'linear') return `Из настроек: ${formatSystemPrice(price, '₽/м')}`;
    if (dbItem?.type === 'linear_mm') return `Из настроек: ${formatSystemPrice(price, '₽/мм')}`;
    if (dbItem?.type === 'roll') return `Из настроек: ${formatSystemPrice(price, '₽/пог.м')}`;
    if (dbItem?.type === 'percent') return `Из настроек: ${formatSystemPrice(price, '%')}`;
    return `Из настроек: ${formatSystemPrice(price, '₽')}`;
};
const getProcessingAreaCm2 = (item) => {
    const width = Number(item?.w) || 0;
    const height = Number(item?.h) || 0;
    const area = (width * height) / 100;
    if (!Number.isFinite(area) || area <= 0) return 0;
    return Math.round(area * 10) / 10;
};
const onSelectChange = (item, dbList, val) => {
    const dbItem = dbList.find(i => i.id === val);
    if (dbItem) {
        const markup = Math.max(0, Number(dbItem?.markupPercent) || 0);
        const nextType = dbItem.type || 'fixed';
        const nextPrice = applyMarkup(dbItem.price ?? dbItem.value ?? 0, markup);
        const nextValue = nextType === 'percent'
            ? applyMarkup(dbItem.price ?? dbItem.value ?? 0, markup)
            : applyMarkup(dbItem.value ?? dbItem.price ?? 0, markup);
        item.dbId = val;
        item.name = dbItem.name;
        item.type = nextType;
        item.value = usesValueField(nextType) ? nextValue : null;
        item.price = usesValueField(nextType) ? null : nextPrice;
        if (dbItem.rollWidthMm || dbItem.rollWidth) {
            item.rollWidthMm = Number(dbItem.rollWidthMm || dbItem.rollWidth) || DEFAULT_PACKAGING_ROLL_WIDTH_MM;
        }
    }
};
const onBeforeEnter = (el) => { el.style.height = '0'; el.style.opacity = '0'; el.style.overflow = 'hidden'; };
const onEnter = (el) => { el.style.transition = 'all 0.3s ease-out'; el.style.height = el.scrollHeight + 'px'; el.style.opacity = '1'; };
const onAfterEnter = (el) => { el.style.height = 'auto'; el.style.overflow = 'visible'; };
const onBeforeLeave = (el) => { el.style.height = el.scrollHeight + 'px'; el.style.overflow = 'hidden'; };
const onLeave = (el) => { el.style.transition = 'all 0.3s ease-in'; el.style.height = '0'; el.style.opacity = '0'; };
const autoCalcArea = (l) => { if(l.w && l.h) l.area = Math.round((l.w * l.h) / 100 * 10) / 10; else l.area = 0; };
const autoCalcEngraving = (l) => { if(l.engravingW_mm && l.engravingH_mm) l.engravingArea = Math.round((l.engravingW_mm * l.engravingH_mm) / 100 * 10) / 10; else l.engravingArea = 0; };
const stepUp = (obj, key, step = 1) => { let val = parseFloat(obj[key]) || 0; obj[key] = parseFloat((val + step).toFixed(1)); if(key === 'w' || key === 'h') autoCalcArea(obj); };
const stepDown = (obj, key, step = 1, min = 1) => { let val = parseFloat(obj[key]) || 0; let newVal = parseFloat((val - step).toFixed(1)); obj[key] = newVal < min ? min : newVal; if(key === 'w' || key === 'h') autoCalcArea(obj); };
const changeDiscount = (step) => { let n = project.value.discount + step; project.value.discount = Math.max(0, Math.min(50, n)); };
const changeMarkup = (step) => { let n = project.value.markup + step; project.value.markup = Math.max(0, Math.min(50, n)); };
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeCopyBaseName = (name = '') => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return `Деталь ${layers.value.length + 1}`;
    return trimmed.replace(/\s*\(копия(?:\s+\d+)?\)$/i, '').trim() || `Деталь ${layers.value.length + 1}`;
};
const buildNextCopyName = (sourceName) => {
    const base = normalizeCopyBaseName(sourceName);
    const pattern = new RegExp(`^${escapeRegExp(base)}\\s*\\(копия(?:\\s+(\\d+))?\\)$`, 'i');

    let maxCopyIndex = 0;
    (layers.value || []).forEach(layerItem => {
        const currentName = String(layerItem?.name || '').trim();
        const match = currentName.match(pattern);
        if (match) {
            const copyIndex = match[1] ? Number(match[1]) : 1;
            if (Number.isFinite(copyIndex)) maxCopyIndex = Math.max(maxCopyIndex, copyIndex);
        }
    });

    const nextIndex = maxCopyIndex + 1;
    return nextIndex === 1 ? `${base} (копия)` : `${base} (копия ${nextIndex})`;
};

const duplicateLayer = (layer) => {
    if (!layer) return;
    layers.value.forEach(item => { item.expanded = false; });
    const copiedLayer = {
        ...layer,
        id: Date.now() + Math.random(),
        name: buildNextCopyName(layer.name),
        expanded: true
    };
    layers.value.unshift(copiedLayer);
};

const moveCaretToEnd = (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLInputElement)) return;
    requestAnimationFrame(() => {
        const len = target.value?.length ?? 0;
        try { target.setSelectionRange(len, len); } catch (e) {}
    });
};

const handleNumberFocusIn = (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== 'number') return;
    if (!target.closest('.desktop-calc')) return;
    moveCaretToEnd(event);
};

const changeProductQty = (step) => {
    const next = Number(productQty.value || 1) + step;
    productQty.value = Math.max(1, Math.floor(next));
};

const toMoneyNum = (value) => {
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const pricePerOne = computed(() => Math.round(toMoneyNum(totals.value?.total)));
const totalForAll = computed(() => Math.round(pricePerOne.value * Number(productQty.value || 1)));
const toggleCostVisibility = () => {
    isCostVisible.value = !isCostVisible.value;
};

watch(() => project.value?.qty, (val) => {
    const n = Number(val);
    const normalized = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    if (productQty.value !== normalized) {
        productQty.value = normalized;
    }
}, { immediate: true });

watch(productQty, (val) => {
    const n = Number(val);
    const normalized = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;

    if (productQty.value !== normalized) {
        productQty.value = normalized;
    }

    if (project.value.qty !== normalized) {
        project.value.qty = normalized;
    }
});

const openInvoiceModal = () => {
    showInvoice.value = true;
};

const copyQuote = async () => {
    // Автосохранение при копировании, если есть права
    if (canViewHistory.value) { triggerAutoSave().then(saved => { showToast(saved ? 'Скопировано и сохранено' : 'Скопировано'); }); } 
    else { showToast('Скопировано'); }

    const date = new Date().toLocaleDateString('ru-RU');
    let t = `КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ\nДата: ${date}\n\n`;
    if(project.value.name) t += `Проект: ${project.value.name}\n`;
    t += `Количество изделий: ${productQty.value}\n`;
    t += `ИТОГО К ОПЛАТЕ: ${totalForAll.value.toLocaleString()} ₽`;
    navigator.clipboard.writeText(t);
};

const onInvoicePrint = () => { if(canViewHistory.value) triggerAutoSave(); };
const requestReset = () => { showResetConfirm.value = true; };
const confirmReset = () => { resetAll(); productQty.value = 1; showResetConfirm.value = false; showToast('Проект очищен'); };
</script>

<template>
    <div class="desktop-calc w-full max-w-7xl container mx-auto p-5 md:p-7 text-sm text-[#18181B] dark:text-gray-100">
    
    <AppBreadcrumbs />

    <header class="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-white/10 no-print gap-4">
        <div class="flex-1 w-full md:w-auto flex items-center gap-2">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-[#18181B] dark:text-white">{{ calculatorName }}</h1>
            </div>
        </div>
        
        <div class="calc-top-nav-wrap flex items-center gap-2 w-full md:w-auto justify-end">
            
            <div v-if="currentUser" class="hidden md:flex flex-col items-end mr-2 text-right">
                <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Вы вошли как</span>
                <span class="text-xs font-black text-[#1d1d1f] dark:text-white leading-none">{{ currentUser.email }}</span>
            </div>
            <button v-else @click="showAuthModal = true" class="hidden md:flex px-4 py-2 bg-black text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:opacity-80 transition-all">
                Войти
            </button>

            <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all" :class="statusConfig.class">
                <span class="w-2 h-2 rounded-full" :class="statusConfig.dot"></span>{{ statusConfig.text }}
            </div>
            
            <div class="h-8 w-px bg-gray-200 dark:bg-white/10 mx-1 hidden md:block"></div>
            
            <button @click="openSaveProjectModal" class="btn-labeled calc-top-nav-btn group" title="Сохранить проект">
                <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                </div>
                <span class="hidden md:block">Сохранить</span>
            </button>
            
            <template v-if="canViewHistory">
                <button @click="openHistoryPage" :disabled="!canUseCloudSections" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="История">
                    <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <span class="hidden md:block">История</span>
                </button>
            </template>

            <template v-if="canViewSettings">
                <button @click="openSettings" :disabled="!canUseCloudSections" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="Настройки">
                    <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </div>
                    <span class="hidden md:block">Настройки</span>
                </button>
            </template>
        </div>
    </header>

    <div class="flex overflow-x-auto gap-1.5 mb-6 p-1.5 bg-gray-100 dark:bg-white/5 rounded-2xl no-print">
        <button v-for="(name, key) in {'layers':'1. Раскрой', 'processing':'2. Пост-обработка', 'accessories':'3. Аксессуары', 'packaging':'4. Упаковка', 'design':'5. Дизайн'}" 
            :key="key" @click="activeTab = key"
            class="calc-tab-btn flex-1 py-3 px-4 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wide whitespace-nowrap relative overflow-hidden"
            :class="activeTab === key ? 'calc-tab-btn-active' : 'calc-tab-btn-idle'">
            {{ name }}
        </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 no-print">
        <div class="lg:col-span-2 min-h-[500px]">
            <Transition name="page-switch" mode="out-in">
                <div v-if="activeTab === 'layers'" key="layers">
                    <div class="mb-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-gradient-to-br from-white to-gray-50 dark:from-[#1C1C1E] dark:to-[#232326] p-4">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div class="min-w-0">
                                <p class="text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-gray-500 mb-1">Блок калькулятора</p>
                                <h3 class="text-lg font-black text-[#18181B] dark:text-white truncate">{{ calculatorName }}</h3>
                            </div>
                            <div class="grid grid-cols-3 gap-2 w-full md:w-auto">
                                <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Слои</div>
                                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ layers.length }}</div>
                                </div>
                                <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Рез</div>
                                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ totalCutLengthMeters }} м</div>
                                </div>
                                <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Листы</div>
                                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ totalMaterialSheets }}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="calc-section-head flex justify-between items-center mb-4">
                        <div class="flex items-center gap-2"><h2 class="section-title">Материалы и Резка</h2><Tooltip text="Цена = (Площадь детали × Цена м² × Коэф. отходов) + (Длина реза × Цена лазера)"><div class="w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-black hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors shadow-sm">?</div></Tooltip></div>
                        <button @click="addLayer" class="btn-add">Добавить Слой</button>
                    </div>
                    <transition name="fade" mode="out-in">
                        <TransitionGroup v-if="layers.length" key="list" name="layer-stack" tag="div" class="space-y-4">
                                <div v-for="(l, i) in layers" :key="l.id" class="layer-stack-item card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0" :class="l.expanded ? 'bg-white' : 'bg-white hover:bg-[#18181B] border border-gray-200 hover:border-black'">
                                    <div @click="l.expanded = !l.expanded" class="layer-header flex justify-between items-center select-none cursor-pointer transition-colors duration-200 p-4" :class="{ 'is-expanded': l.expanded }">
                                        <div class="flex items-center gap-3 flex-1 min-w-0"><div class="shrink-0 transition-transform duration-300" :class="[l.expanded ? 'rotate-180 text-gray-400' : 'text-black group-hover:text-white']"><svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1L5 5L9 1"/></svg></div><input v-model="l.name" @click.stop maxlength="40" class="bg-transparent outline-none font-bold text-sm uppercase tracking-widest transition-colors w-full min-w-0 cursor-text" :class="l.expanded ? 'text-black' : 'text-black group-hover:text-white'" placeholder="Название слоя"></div>
                                        <div class="shrink-0 ml-4 flex items-center gap-3"><button v-if="l.expanded" @click.stop="duplicateLayer(l)" class="text-gray-300 hover:text-black dark:hover:text-white font-bold text-xs no-print transition-colors">Копировать</button><button v-if="l.expanded" @click.stop="removeLayer(l.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors">Удалить</button></div>
                                    </div>
                                    <transition name="collapse" @before-enter="onBeforeEnter" @enter="onEnter" @after-enter="onAfterEnter" @before-leave="onBeforeLeave" @leave="onLeave">
                                        <div v-show="l.expanded" class="layer-card-body px-5 pb-5 pt-3 grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
                                            <div class="md:col-span-6"><label class="label">Материал</label><ModernSelect v-model="l.matId" :grouped="materialGroups" placeholder="Выбор материала" @update:modelValue="() => { l.finishing='none'; l.finishingBothSides = false; }" /></div>
                                            <div :class="l.finishing !== 'none' ? 'md:col-span-4' : 'md:col-span-6'">
                                                <label class="label">Пост-обработка</label>
                                                <ModernSelect class="flex-1" v-model="l.finishing" :options="[{value: 'none', label: 'Без покрытия'}, ...getFinishingOptions(l.matId)]" placeholder="Без покрытия" @update:modelValue="val => { if (val === 'none') l.finishingBothSides = false; }" />
                                            </div>
                                            <div v-if="l.finishing !== 'none'" class="md:col-span-2">
                                                <label class="label">Стороны · {{ l.finishingBothSides ? '2' : '1' }}</label>
                                                <div class="grid h-14 grid-cols-2 gap-1 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] p-1">
                                                    <button
                                                        type="button"
                                                        @click.stop="l.finishingBothSides = false"
                                                        class="h-full rounded-xl text-xs font-bold uppercase tracking-wide transition-colors"
                                                        :class="!l.finishingBothSides ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' : 'bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
                                                    >
                                                        1
                                                    </button>
                                                    <button
                                                        type="button"
                                                        @click.stop="l.finishingBothSides = true"
                                                        class="h-full rounded-xl text-xs font-bold uppercase tracking-wide transition-colors"
                                                        :class="l.finishingBothSides ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' : 'bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
                                                    >
                                                        2
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="md:col-span-7"><label class="label">Размеры (мм)</label><div class="flex items-center gap-2"><input type="number" v-model.number="l.w" @input="autoCalcArea(l)" class="input-std text-center" :class="getTextClass(l.w)" placeholder="Ш (мм)"><span class="text-gray-300 font-bold">✕</span><input type="number" v-model.number="l.h" @input="autoCalcArea(l)" class="input-std text-center" :class="getTextClass(l.h)" placeholder="В (мм)"></div></div>
                                            <div class="md:col-span-5"><label class="label">Площадь (см²)</label><div class="input-std bg-gray-50 flex items-center justify-center"><input type="number" v-model.number="l.area" class="w-full h-full bg-transparent text-center outline-none" :class="getTextClass(l.area)" placeholder="0"></div></div>
                                            <div class="md:col-span-4"><label class="label">Длина кривой (мм)</label><div class="stepper-wrap"><button @click="stepDown(l, 'cut', 100, 0)" class="step-btn">-</button><input type="number" v-model.number="l.cut" step="1" class="step-input" :class="getTextClass(l.cut)" placeholder="0"><button @click="stepUp(l, 'cut', 100)" class="step-btn">+</button></div></div>
                                            <div class="md:col-span-3"><label class="label">Идентичных слоёв</label><div class="stepper-wrap"><button @click="stepDown(l, 'qty', 1, 1)" class="step-btn">-</button><input type="number" v-model.number="l.qty" class="step-input" :class="getTextClass(l.qty)" placeholder="1"><button @click="stepUp(l, 'qty', 1)" class="step-btn">+</button></div></div>
                                            <div class="md:col-span-5">
                                                <label class="label opacity-0 select-none">Опция</label>
                                                <button
                                                    type="button"
                                                    class="engrave-toggle w-full h-9 border border-gray-200 dark:border-white/10 rounded-lg flex items-center justify-between px-3 bg-white dark:bg-[#232326] transition-colors duration-200"
                                                    :class="{ 'is-on': l.hasEngraving }"
                                                    @click="l.hasEngraving = !l.hasEngraving"
                                                >
                                                    <span class="flex items-center gap-2">
                                                        <span class="engrave-switch"><span class="engrave-knob"></span></span>
                                                        <span class="text-xs font-bold uppercase tracking-wide" :class="l.hasEngraving ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-300'">Гравировка</span>
                                                    </span>
                                                    <span class="text-[10px] font-black uppercase tracking-wider" :class="l.hasEngraving ? 'text-black dark:text-white' : 'text-gray-400 dark:text-gray-500'">{{ l.hasEngraving ? 'Вкл' : 'Выкл' }}</span>
                                                </button>
                                            </div>
                                            <div v-if="l.hasEngraving" class="md:col-span-12 pt-2 animate-fade-in"><div class="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-300"><div class="grid grid-cols-1 md:grid-cols-12 gap-4"><div class="md:col-span-7"><label class="label">Размеры Грав. (мм)</label><div class="flex items-center gap-2"><input type="number" min="0" v-model.number="l.engravingW_mm" @input="autoCalcEngraving(l)" class="input-std text-center bg-white" :class="getTextClass(l.engravingW_mm)" placeholder="Ш (мм)"><span class="text-gray-300 font-bold">✕</span><input type="number" min="0" v-model.number="l.engravingH_mm" @input="autoCalcEngraving(l)" class="input-std text-center bg-white" :class="getTextClass(l.engravingH_mm)" placeholder="В (мм)"></div></div><div class="md:col-span-5"><label class="label">Площадь (см²)</label><div class="input-std bg-gray-200/50 flex items-center justify-center"><input type="number" min="0" v-model.number="l.engravingArea" class="w-full h-full bg-transparent text-center outline-none" :class="getTextClass(l.engravingArea)" placeholder="0"></div></div></div></div></div>
                                        </div>
                                    </transition>
                                </div>
                        </TransitionGroup>
                        <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет слоев для раскроя</div>
                    </transition>
                </div>
                
                <div v-else-if="activeTab === 'processing'" key="processing">
                    <div class="calc-section-head flex justify-between items-center mb-4">
                        <div class="flex items-center gap-2">
                            <h2 class="section-title">Пост-обработка</h2>
                            <Tooltip text="Дополнительные услуги..."><div class="w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-black hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors shadow-sm">?</div></Tooltip>
                        </div>
                        <button @click="addProcessing" class="btn-add">Добавить обработку</button>
                    </div>
                    <transition name="fade" mode="out-in">
                        <div v-if="processing.length" key="list">
                            <TransitionGroup name="service-stack" tag="div" class="space-y-3">
                                <div v-for="(item, i) in processing" :key="item.id" :class="item.type === 'area_cm2' ? 'service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col gap-3 service-card-dtf' : 'service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4'">
                                    <template v-if="item.type === 'area_cm2'">
                                        <div class="w-full grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                            <div class="md:col-span-8">
                                                <label class="label">Вид работ</label>
                                                <ModernSelect v-model="item.dbId" :options="processingOptions" @update:modelValue="val => onSelectChange(item, processingDB, val)" placeholder="Выберите услугу" />
                                            </div>
                                            <div v-if="getProcessingSystemPriceMeta(item)" class="md:col-span-4">
                                                <label class="label">Цена за см²</label>
                                                <div class="h-10 rounded-xl border border-gray-200 bg-white px-3 flex items-center justify-center text-[11px] font-black text-gray-800 text-center whitespace-nowrap dark:border-white/10 dark:bg-white/5 dark:text-white">
                                                    {{ getProcessingSystemPriceValue(item) }}
                                                </div>
                                            </div>
                                        </div>

                                        <div class="rounded-[1.15rem] border border-gray-200 bg-gray-50/80 px-3 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                                            <div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                                <div class="md:col-span-6">
                                                    <label class="label">Размер печати (мм)</label>
                                                    <div class="dtf-size-wrap dtf-control-shell">
                                                        <input type="number" v-model.number="item.w" class="dtf-size-input" placeholder="Ш">
                                                        <span class="dtf-size-divider">×</span>
                                                        <input type="number" v-model.number="item.h" class="dtf-size-input" placeholder="В">
                                                    </div>
                                                </div>
                                                <div class="md:col-span-3">
                                                    <label class="label">Стороны</label>
                                                    <div class="grid dtf-control-shell grid-cols-2 gap-1 p-1">
                                                        <button type="button" @click="item.sides = 1" class="h-full rounded-lg text-[11px] font-bold leading-none transition-colors" :class="normalizeSides(item.sides) === 1 ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' : 'bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'">1</button>
                                                        <button type="button" @click="item.sides = 2" class="h-full rounded-lg text-[11px] font-bold leading-none transition-colors" :class="normalizeSides(item.sides) === 2 ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' : 'bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'">2</button>
                                                    </div>
                                                </div>
                                                <div class="md:col-span-3">
                                                    <label class="label">Кол-во</label>
                                                    <div class="stepper-wrap dtf-control-shell"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div>
                                                </div>
                                            </div>

                                            <div class="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-500">
                                                <span class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-inherit">Площадь: {{ getProcessingAreaCm2(item) || 0 }} см²</span>
                                                <span class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-inherit">{{ normalizeSides(item.sides) === 2 ? '2 стороны' : '1 сторона' }}</span>
                                            </div>
                                        </div>

                                        <div class="absolute top-2 right-2 md:top-3 md:right-3">
                                            <button @click="removeProcessing(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button>
                                        </div>
                                    </template>

                                    <template v-else>
                                        <div class="w-full md:w-1/2">
                                            <label class="label">Вид работ</label>
                                            <ModernSelect v-model="item.dbId" :options="processingOptions" @update:modelValue="val => onSelectChange(item, processingDB, val)" placeholder="Выберите услугу" />
                                        </div>

                                        <div v-if="hasSelectedDbItem(item)" class="w-full md:w-5/12">
                                            <div v-if="item.type === 'fixed'">
                                                <label class="label">Стоимость (₽)</label>
                                                <div class="input-std bg-gray-50 flex items-center justify-center"><input type="number" v-model.number="item.value" class="w-full h-full bg-transparent text-center outline-none font-bold"></div>
                                            </div>

                                            <div v-else-if="item.type === 'percent'">
                                                <label class="label">Процент (%)</label>
                                                <div class="stepper-wrap"><button @click="stepDown(item, 'value', 5, 0)" class="step-btn">-</button><input type="number" v-model.number="item.value" class="step-input font-bold" placeholder="0"><button @click="stepUp(item, 'value', 5)" class="step-btn">+</button></div>
                                            </div>

                                            <div v-else-if="item.type === 'pieces'" class="flex gap-2">
                                                <div class="w-1/2"><label class="label">Цена (₽)</label><input type="number" v-model.number="item.price" class="input-std text-center"></div>
                                                <div class="w-1/2"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div>
                                            </div>

                                            <div v-else-if="item.type === 'linear' || item.type === 'linear_mm' || item.type === 'roll'" class="flex gap-2">
                                                <div class="w-7/12">
                                                    <label class="label">Длина (мм)</label>
                                                    <input type="number" v-model.number="item.length" class="input-std text-center font-bold" placeholder="0">
                                                </div>
                                                <div class="w-5/12">
                                                    <label class="label">Кол-во</label>
                                                    <div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div>
                                                </div>
                                            </div>

                                            <div v-else-if="item.type === 'area' || item.type === 'area_mm2'" class="flex gap-2">
                                                <div class="w-7/12">
                                                    <label class="label">Размеры (мм)</label>
                                                    <div class="flex items-center gap-1"><input type="number" v-model.number="item.w" class="input-std text-center !px-1 text-xs" placeholder="Ш"><span class="text-gray-300 font-bold text-xs">✕</span><input type="number" v-model.number="item.h" class="input-std text-center !px-1 text-xs" placeholder="В"></div>
                                                </div>
                                                <div class="w-5/12">
                                                    <label class="label">Кол-во</label>
                                                    <div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div>
                                                </div>
                                            </div>
                                        </div>

                                        <div v-else class="w-full md:w-5/12">
                                            <label class="label invisible">Вид работ</label>
                                            <div class="empty-selection-placeholder w-full">
                                                Сначала выберите услугу
                                            </div>
                                        </div>

                                        <div class="absolute top-2 right-2 md:top-3 md:right-3">
                                            <button @click="removeProcessing(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button>
                                        </div>
                                    </template>
                                </div>
                            </TransitionGroup>
                        </div>
                        <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленной пост-обработки</div>
                    </transition>
                </div>
                <div v-else-if="activeTab === 'accessories'" key="accessories"><div class="calc-section-head flex justify-between items-center mb-4"><h2 class="section-title">Аксессуары</h2><button @click="addAccessory" class="btn-add">Добавить</button></div><transition name="fade" mode="out-in"><div v-if="accessories.length" key="list"><TransitionGroup name="service-stack" tag="div" class="space-y-3"><div v-for="(item, i) in accessories" :key="item.id" class="service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Наименование</label><ModernSelect v-model="item.dbId" :options="accessoryOptions" @update:modelValue="val => onSelectChange(item, accessoriesDB, val)" placeholder="Выберите товар" /></div><div v-if="hasSelectedDbItem(item)" class="w-full md:w-5/12 flex gap-2"><div class="w-1/2"><label class="label">Цена (₽)</label><input type="number" v-model.number="item.price" class="input-std text-center text-gray-500"></div><div class="w-1/2"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div><div v-else class="w-full md:w-5/12"><label class="label invisible">Цена</label><div class="empty-selection-placeholder">Сначала выберите товар</div></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removeAccessory(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленных аксессуаров</div></transition></div>
                <div v-else-if="activeTab === 'packaging'" key="packaging">
                    <div class="calc-section-head flex justify-between items-center mb-4">
                        <h2 class="section-title">Упаковка</h2>
                        <button @click="addPackaging" class="btn-add">Добавить</button>
                    </div>
                    <transition name="fade" mode="out-in">
                        <div v-if="packaging.length" key="list">
                            <TransitionGroup name="service-stack" tag="div" class="space-y-3">
                                <div v-for="(item, i) in packaging" :key="item.id" class="service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4">
                                    <div class="w-full md:w-1/2">
                                        <label class="label">Тип</label>
                                        <ModernSelect
                                            v-model="item.dbId"
                                            :options="packagingOptions"
                                            @update:modelValue="val => onSelectChange(item, packagingDB, val)"
                                            placeholder="Выберите упаковку"
                                        />
                                    </div>

                                    <div v-if="hasSelectedDbItem(item)" class="w-full md:w-5/12">
                                        <div v-if="item.type === 'box_mm'" class="space-y-2">
                                            <div class="grid grid-cols-3 gap-2">
                                                <div>
                                                    <label class="label">Ш (мм)</label>
                                                    <input type="number" v-model.number="item.w" class="input-std text-center" placeholder="0">
                                                </div>
                                                <div>
                                                    <label class="label">Д (мм)</label>
                                                    <input type="number" v-model.number="item.l" class="input-std text-center" placeholder="0">
                                                </div>
                                                <div>
                                                    <label class="label">В (мм)</label>
                                                    <input type="number" v-model.number="item.h" class="input-std text-center" placeholder="0">
                                                </div>
                                            </div>
                                            <div class="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label class="label">Цена (₽/м²)</label>
                                                    <input type="number" v-model.number="item.price" class="input-std text-center font-bold" placeholder="0">
                                                </div>
                                                <div>
                                                    <label class="label">Кол-во</label>
                                                    <div class="stepper-wrap">
                                                        <button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button>
                                                        <input type="number" v-model.number="item.qty" class="step-input font-bold">
                                                        <button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div v-else-if="item.type === 'roll'" class="space-y-2">
                                            <div class="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label class="label">Ширина рулона (мм)</label>
                                                    <input type="number" v-model.number="item.rollWidthMm" class="input-std text-center" placeholder="500">
                                                </div>
                                                <div>
                                                    <label class="label">Длина (мм)</label>
                                                    <input type="number" v-model.number="item.length" class="input-std text-center font-bold" placeholder="0">
                                                </div>
                                            </div>
                                            <div class="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label class="label">Цена (₽/пог.м)</label>
                                                    <input type="number" v-model.number="item.price" class="input-std text-center font-bold" placeholder="0">
                                                </div>
                                                <div>
                                                    <label class="label">Кол-во</label>
                                                    <div class="stepper-wrap">
                                                        <button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button>
                                                        <input type="number" v-model.number="item.qty" class="step-input font-bold">
                                                        <button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div v-else class="flex gap-2">
                                            <div class="w-1/2">
                                                <label class="label">Цена (₽)</label>
                                                <input type="number" v-model.number="item.price" class="input-std text-center text-gray-500">
                                            </div>
                                            <div class="w-1/2">
                                                <label class="label">Кол-во</label>
                                                <div class="stepper-wrap">
                                                    <button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button>
                                                    <input type="number" v-model.number="item.qty" class="step-input font-bold">
                                                    <button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else class="w-full md:w-5/12">
                                        <label class="label invisible">Тип</label>
                                        <div class="empty-selection-placeholder">
                                            Сначала выберите упаковку
                                        </div>
                                    </div>

                                    <div class="absolute top-2 right-2 md:top-3 md:right-3">
                                        <button @click="removePackaging(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button>
                                    </div>
                                </div>
                            </TransitionGroup>
                        </div>
                        <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленной упаковки</div>
                    </transition>
                </div>
                <div v-else-if="activeTab === 'design'" key="design"><div class="calc-section-head flex justify-between items-center mb-4"><h2 class="section-title">Дизайн</h2><button @click="addDesign" class="btn-add">Добавить</button></div><transition name="fade" mode="out-in"><div v-if="design.length" key="list"><TransitionGroup name="service-stack" tag="div" class="space-y-3"><div v-for="(item, i) in design" :key="item.id" class="service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Услуга</label><ModernSelect v-model="item.dbId" :options="designOptions" @update:modelValue="val => onSelectChange(item, designDB, val)" placeholder="Выберите услугу" /></div><div v-if="hasSelectedDbItem(item)" class="w-full md:w-5/12"><label class="label">Стоимость (₽)</label><input type="number" v-model.number="item.value" class="input-std text-center font-bold"></div><div v-else class="w-full md:w-5/12"><label class="label invisible">Стоимость</label><div class="empty-selection-placeholder">Сначала выберите услугу</div></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removeDesign(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленного макета</div></transition></div>
            </Transition>
        </div>

        <div class="relative">
            <div>
                <div class="kpi-card bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 text-[#18181B] dark:text-gray-100 mb-6">
                    <PriceChart :totals="totals" :cost-revealed="isCostVisible" @toggle-cost-visibility="toggleCostVisibility" />

                    <div class="mb-6 border-t border-gray-100 pt-4"><div class="flex justify-between items-baseline"><span class="text-sm font-bold uppercase tracking-widest text-gray-400">Итого</span><span class="total-amount text-3xl font-black tracking-tighter">{{ totalForAll.toLocaleString() }} ₽</span></div><div class="flex justify-end mt-1"><span class="text-[10px] font-bold text-gray-400">{{ pricePerOne.toLocaleString() }} ₽ × {{ productQty }} шт</span></div></div>

                    <MaterialConsumption :consumption="matConsumption" />
                    <div class="my-6 h-px bg-gray-100"></div>
                    <div class="space-y-4 mb-6">
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-black dark:bg-gray-300"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Материалы и резка</span></div><span class="calc-amount-value">{{ totals.layers.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#52525B] dark:bg-gray-400"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Пост-обработка</span> </div><span class="calc-amount-value">{{ totals.processing.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#A1A1AA] dark:bg-gray-500"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Аксессуары</span></div><span class="calc-amount-value">{{ totals.accessories.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#D4D4D8] dark:bg-gray-500"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Упаковка</span></div><span class="calc-amount-value">{{ totals.packaging.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#E4E4E7] dark:bg-gray-600"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Дизайн</span></div><span class="calc-amount-value">{{ totals.design.toLocaleString() }} ₽</span></div>
                    </div>

                    <div class="kp-controls bg-gray-100 rounded-xl p-4 mb-6 space-y-4 relative">
                         <div class="absolute top-2 right-2 z-10"><Tooltip text="Итого = (Себестоимость + Наценка%) - Скидка%" width="w-48"><div class="w-4 h-4 rounded-full bg-white text-gray-400 hover:text-black flex items-center justify-center text-[10px] font-bold shadow-sm cursor-help">?</div></Tooltip></div>
                        <div class="flex items-center justify-between"><div class="flex flex-col"><span class="text-[10px] uppercase font-bold text-gray-500">Наценка</span><span v-if="totals.markupRub > 0" class="text-[10px] font-bold text-green-600">+{{ totals.markupRub.toLocaleString() }} ₽</span></div><div class="flex items-center bg-white rounded-lg border border-gray-200 h-8 shadow-sm"><button @click="changeMarkup(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-l-lg transition-colors font-bold">-</button><span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-100 leading-8">{{ project.markup }}%</span><button @click="changeMarkup(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-r-lg transition-colors font-bold">+</button></div></div>
                        <div class="flex items-center justify-between"><div class="flex flex-col"><span class="text-[10px] uppercase font-bold text-gray-500">Скидка</span><span v-if="totals.discountRub > 0" class="text-[10px] font-bold text-red-500">-{{ totals.discountRub.toLocaleString() }} ₽</span></div><div class="flex items-center bg-white rounded-lg border border-gray-200 h-8 shadow-sm"><button @click="changeDiscount(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-l-lg transition-colors font-bold">-</button><span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-100 leading-8">{{ project.discount }}%</span><button @click="changeDiscount(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-r-lg transition-colors font-bold">+</button></div></div>
                        <div class="pt-3 mt-1 border-t border-gray-200">
                            <div class="flex items-center justify-between"><div class="flex flex-col"><span class="text-[10px] uppercase font-bold text-gray-500">Тираж заказа</span><span class="text-[10px] font-bold text-gray-500">{{ productQty }} шт</span></div><div class="flex items-center bg-white rounded-lg border border-gray-200 h-8 shadow-sm"><button @click="changeProductQty(-1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-l-lg transition-colors font-bold">-</button><input type="number" min="1" v-model.number="productQty" @focus="moveCaretToEnd" class="w-12 h-full text-center text-xs font-bold border-x border-gray-100 bg-transparent outline-none" /><button @click="changeProductQty(1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-r-lg transition-colors font-bold">+</button></div></div>
                            <p class="mt-2 max-w-[220px] text-[10px] font-semibold leading-snug text-gray-400 dark:text-gray-500">Умножает весь заказ целиком. Количества в карточках считаются внутри одной единицы заказа.</p>
                        </div>
                    </div>

                    <div class="flex flex-col gap-3">
                        <button @click="openInvoiceModal" class="w-full h-12 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-gray-800 dark:hover:bg-gray-200 transition-all active:scale-[0.98] shadow-xl flex items-center justify-center gap-2">Сформировать КП</button>
                        <div class="grid grid-cols-2 gap-3">
                            <button @click="copyQuote" class="kp-secondary-btn h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">Копировать КП</button>
                            <button @click="requestReset" class="kp-secondary-btn kp-secondary-danger h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">Сброс</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <Transition name="modal-anim">
        <div
            v-if="showSaveProjectModal"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print"
            @click.self="showSaveProjectModal = false; saveModalNotice = null"
        >
            <div class="bg-white p-6 rounded-2xl w-full max-w-sm shadow-xl">
                <h3 class="font-bold text-lg mb-2">Сохранить в историю</h3>
                <p class="text-xs text-gray-500 mb-4">Укажите данные проекта перед сохранением</p>

                <div
                    v-if="saveModalNotice"
                    class="mb-4 rounded-2xl border px-3.5 py-3 flex items-start gap-2.5 shadow-sm"
                    :class="saveModalNotice.type === 'success'
                        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50/80 border-amber-200 text-amber-800'"
                >
                    <div
                        class="mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                        :class="saveModalNotice.type === 'success'
                            ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
                            : 'bg-amber-100 border-amber-200 text-amber-700'"
                    >
                        <svg v-if="saveModalNotice.type === 'success'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                    </div>
                    <p class="text-[12px] font-semibold leading-snug tracking-tight">
                        {{ saveModalNotice.text }}
                    </p>
                </div>

                <div class="space-y-3">
                    <input v-model="project.name" class="input-std font-bold" placeholder="Название проекта">
                    <input v-model="project.client" class="input-std" placeholder="Заказчик / Организация">
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button
                            @click="showSaveProjectModal = false; saveModalNotice = null"
                            class="py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider"
                        >
                            Отмена
                        </button>
                        <button
                            @click="handleManualSaveToHistory"
                            :disabled="isManualSaving"
                            class="py-3 rounded-xl font-bold bg-black text-white hover:bg-gray-800 transition-colors text-xs uppercase tracking-wider disabled:opacity-60"
                        >
                            {{ isManualSaving ? (isOfflineMode ? 'В кэш...' : 'Сохранение...') : (isOfflineMode ? 'Сохранить в кэш' : 'Сохранить') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Transition>
    <Transition name="modal-anim"><div v-if="showResetConfirm" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showResetConfirm = false"><div class="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-white/50 text-center transform transition-all"><h3 class="text-lg font-black mb-2">Сбросить всё?</h3><p class="text-sm text-gray-500 mb-6">Все введенные данные будут удалены.</p><div class="grid grid-cols-2 gap-3"><button @click="showResetConfirm = false" class="py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider">Отмена</button><button @click="confirmReset" class="py-3 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all text-xs uppercase tracking-wider">Сбросить</button></div></div></div></Transition>
    
    <Transition name="modal-anim">
        <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @success="onLoginSuccess" />
    </Transition>

    <InvoiceModal :show="showInvoice" :project="invoicePayload.project" :layers="invoicePayload.layers" :processing="invoicePayload.processing" :accessories="invoicePayload.accessories" :packaging="invoicePayload.packaging" :design="invoicePayload.design" :totals="invoicePayload.totals" :settings="invoicePayload.settings" :materials="invoicePayload.materials" :coatings="invoicePayload.coatings" :product-qty="invoicePayload.productQty" @close="showInvoice = false" @print="onInvoicePrint" />

    <Transition name="toast"><div v-if="toast.show" class="fixed top-6 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md transition-all bg-[#18181B]/90 text-white"><span class="font-bold text-xs uppercase tracking-wide">{{ toast.message }}</span><button v-if="toast.actionLabel" @click="runToastAction" class="rounded-full border border-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10">{{ toast.actionLabel }}</button></div></Transition>

    <div class="fixed top-7 left-1/2 -translate-x-1/2 pointer-events-none z-[120] no-print" aria-hidden="true">
        <div class="save-fireworks-stage">
            <span
                v-for="particle in saveFireworks"
                :key="particle.id"
                class="save-firework-dot"
                :style="{
                    '--bx': `${particle.originX}px`,
                    '--by': `${particle.originY}px`,
                    '--tx': `${particle.offsetX}px`,
                    '--ty': `${particle.offsetY}px`,
                    '--delay': `${particle.delayMs}ms`,
                    '--duration': `${particle.durationMs}ms`,
                    '--size': `${particle.sizePx}px`,
                    '--dot-color': particle.color
                }"
            ></span>
        </div>
    </div>

        <Transition name="pop-up">
            <div
                v-if="showScrollTop"
                class="fixed bottom-10 left-1/2 z-[90] -translate-x-1/2 w-20 h-12 flex items-center justify-center group cursor-pointer no-print"
                @click="scrollToTop"
            >
                <div class="h-12 bg-[#1d1d1f] dark:bg-white shadow-2xl backdrop-blur-md border border-white/10 dark:border-black/10 rounded-full btn-bouncy"></div>
                <svg
                    width="24" height="24" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round"
                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white dark:text-black pointer-events-none z-10"
                >
                    <path d="M18 15l-6-6-6 6"/>
                </svg>
            </div>
        </Transition>
  </div>
</template>

<style>
/* Общая анимация появления модальных окон */
.modal-anim-enter-active, .modal-anim-leave-active { transition: all 0.2s ease-out; }
.modal-anim-enter-from, .modal-anim-leave-to { opacity: 0; transform: scale(0.95); }

/* ===== Desktop Calculator Theme Layer ===== */
.desktop-calc .section-title,
.desktop-calc .label {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    padding: 0.2rem 0.6rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
}

.desktop-calc .label {
    margin-left: 0.45rem;
    margin-bottom: 0.35rem;
}

.desktop-calc .layer-card {
    border-radius: 1.1rem;
    overflow: hidden;
    box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.35);
}

.desktop-calc .layer-card:hover {
    box-shadow: 0 14px 26px -20px rgba(15, 23, 42, 0.42);
}

.desktop-calc .layer-header {
    position: relative;
}

.desktop-calc .calc-section-head {
    position: relative;
    padding-bottom: 0.65rem;
}

.desktop-calc .calc-section-head::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(148, 163, 184, 0.6), rgba(0, 0, 0, 0));
}

.desktop-calc .layer-header::after {
    content: '';
    position: absolute;
    left: 1rem;
    right: 1rem;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(148, 163, 184, 0.62), rgba(0, 0, 0, 0));
    opacity: 0;
    transition: opacity 0.2s ease;
}

.desktop-calc .layer-header.is-expanded::after {
    opacity: 1;
}

.desktop-calc .layer-card-body {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
}

.desktop-calc .layer-card .input-std,
.desktop-calc .layer-card .stepper-wrap,
.desktop-calc .layer-card .w-full.h-9.border {
    border-radius: 0.75rem;
}

.desktop-calc .layer-card .w-full.h-9.border {
    padding-left: 0.55rem;
    padding-right: 0.55rem;
}

.desktop-calc .engrave-toggle {
    box-shadow: inset 0 0 0 0 rgba(0, 0, 0, 0.06);
}

.desktop-calc .engrave-toggle:hover {
    border-color: #d1d5db;
    background: #f9fafb;
}

.desktop-calc .engrave-switch {
    width: 1.65rem;
    height: 1rem;
    border-radius: 9999px;
    background: #d1d5db;
    padding: 2px;
    display: inline-flex;
    align-items: center;
}

.desktop-calc .engrave-knob {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 9999px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.desktop-calc .engrave-toggle.is-on {
    border-color: #9ca3af;
    background: #f3f4f6;
}

.desktop-calc .engrave-toggle.is-on .engrave-switch {
    background: #111827;
}

.desktop-calc .engrave-toggle.is-on .engrave-knob {
    transform: translateX(0.65rem);
}

.desktop-calc .layer-card .animate-fade-in > div {
    border-radius: 0.95rem;
}

.desktop-calc .layer-stack-item {
    transform-origin: top center;
}

.desktop-calc .layer-stack-enter-active,
.desktop-calc .layer-stack-leave-active {
    transition: opacity 0.28s ease, transform 0.28s ease, filter 0.28s ease;
}

.desktop-calc .layer-stack-move {
    transition: transform 0.32s ease;
}

.desktop-calc .layer-stack-enter-from,
.desktop-calc .layer-stack-leave-to {
    opacity: 0;
    transform: translateY(-10px) scale(0.985);
    filter: blur(2px);
}

.desktop-calc .service-stack-item {
    transform-origin: top center;
}

.desktop-calc .service-stack-enter-active,
.desktop-calc .service-stack-leave-active {
    transition: opacity 0.28s ease, transform 0.28s ease, filter 0.28s ease;
}

.desktop-calc .service-stack-move {
    transition: transform 0.32s ease;
}

.desktop-calc .service-stack-enter-from,
.desktop-calc .service-stack-leave-to {
    opacity: 0;
    transform: translateY(-10px) scale(0.985);
    filter: blur(2px);
}

.desktop-calc .service-card-dtf {
    min-height: 130px;
}

.desktop-calc .dtf-control-shell {
    height: 40px;
    border-radius: 0.75rem;
    border: 1px solid #d1d5db;
    background: #ffffff;
}

.desktop-calc .dtf-size-wrap {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
}

.desktop-calc .dtf-size-input {
    width: 100%;
    height: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    outline: none;
    text-align: center;
    line-height: 40px;
    font-weight: 800;
    color: #111827;
}

.desktop-calc .dtf-size-input::placeholder {
    color: rgba(156, 163, 175, 0.9);
}

.desktop-calc .dtf-size-divider {
    font-size: 0.85rem;
    font-weight: 800;
    color: rgba(156, 163, 175, 0.9);
    user-select: none;
}

html.dark .desktop-calc .dtf-control-shell {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
}

html.dark .desktop-calc .dtf-size-input {
    color: #ffffff;
}

.desktop-calc .calc-top-nav-wrap {
    border: 1px solid transparent;
}

.desktop-calc .calc-top-nav-btn {
    border-radius: 0.85rem;
    padding: 0.25rem 0.55rem;
    transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease, color 180ms ease;
}

.desktop-calc .calc-top-nav-btn:hover {
    transform: translateY(-1px);
}

.desktop-calc .calc-top-nav-icon {
    background: #f3f4f6;
}

html.dark .desktop-calc .calc-top-nav-icon {
    background: rgba(255, 255, 255, 0.08);
}

.desktop-calc .calc-tab-btn {
    transition: transform 220ms ease, background-color 220ms ease, color 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
    border: 1px solid transparent;
}

.desktop-calc .calc-tab-btn:hover {
    transform: translateY(-1px);
}

.desktop-calc .calc-tab-btn-active {
    background: #ffffff;
    color: #0f172a;
    box-shadow: 0 8px 20px -12px rgba(0, 0, 0, 0.45);
    border-color: #e5e7eb;
}

.desktop-calc .calc-tab-btn-idle {
    color: #6b7280;
}

.desktop-calc .calc-tab-btn-idle:hover {
    background: #e5e7eb;
    color: #374151;
}

html.dark .desktop-calc .calc-tab-btn-active {
    background: #2b2b2f;
    color: #f3f4f6;
    border-color: rgba(255, 255, 255, 0.16);
    box-shadow: 0 10px 24px -14px rgba(0, 0, 0, 0.6);
}

html.dark .desktop-calc .calc-tab-btn-idle {
    color: #9ca3af;
}

html.dark .desktop-calc .calc-tab-btn-idle:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #e5e7eb;
}

.desktop-calc .calc-amount-value {
    font-weight: 800;
    font-size: 1.125rem;
    color: #111827;
}

.desktop-calc .kp-percent-value {
    color: #111827;
}

.desktop-calc .total-amount {
    color: #111827;
}

.desktop-calc .kp-secondary-btn {
    background: #ffffff;
    border: 1px solid #d1d5db;
    color: #111827;
    transition: transform 180ms ease, background-color 180ms ease, color 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.desktop-calc .kp-secondary-btn:hover {
    transform: translateY(-1px);
    background: #f3f4f6;
    border-color: #9ca3af;
    box-shadow: 0 8px 16px -12px rgba(0, 0, 0, 0.45);
}

.desktop-calc .kp-secondary-btn:active {
    transform: translateY(0);
}

.desktop-calc .kp-secondary-danger:hover {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
}

html.dark .desktop-calc .calc-amount-value {
    color: #f3f4f6;
}

html.dark .desktop-calc .kp-percent-value,
html.dark .desktop-calc .total-amount {
    color: #f3f4f6;
}

html.dark .desktop-calc .kp-secondary-btn {
    background: #232326;
    border-color: rgba(255, 255, 255, 0.16);
    color: #e5e7eb;
}

html.dark .desktop-calc .kp-secondary-btn:hover {
    background: #2b2b2f;
    border-color: rgba(255, 255, 255, 0.28);
    color: #ffffff;
    box-shadow: 0 10px 20px -14px rgba(0, 0, 0, 0.75);
}

html.dark .desktop-calc .kp-secondary-danger:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
    color: #fecaca;
}

html.dark .desktop-calc .section-title,
html.dark .desktop-calc .label {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #d1d5db;
}

html.dark .desktop-calc .layer-card {
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 24px -18px rgba(0, 0, 0, 0.8);
}

html.dark .desktop-calc .layer-card:hover {
    box-shadow: 0 16px 28px -18px rgba(0, 0, 0, 0.9);
}

html.dark .desktop-calc .layer-header::after {
    background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(148, 163, 184, 0.42), rgba(255, 255, 255, 0));
}

html.dark .desktop-calc .engrave-toggle {
    border-color: rgba(255, 255, 255, 0.12);
    background: #232326;
}

html.dark .desktop-calc .engrave-toggle:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: #2a2a2f;
}

html.dark .desktop-calc .engrave-switch {
    background: #52525b;
}

html.dark .desktop-calc .engrave-toggle.is-on {
    border-color: rgba(255, 255, 255, 0.3);
    background: #2f2f34;
}

html.dark .desktop-calc .engrave-toggle.is-on .engrave-switch {
    background: #f3f4f6;
}

html.dark .desktop-calc .engrave-toggle.is-on .engrave-knob {
    background: #111827;
}

html.dark .desktop-calc .calc-section-head::after {
    background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(148, 163, 184, 0.38), rgba(255, 255, 255, 0));
}

html.dark .desktop-calc .bg-white {
    background-color: #1c1c1e !important;
}

html.dark .desktop-calc .bg-gray-50,
html.dark .desktop-calc .hover\:bg-gray-50:hover {
    background-color: #232326 !important;
}

html.dark .desktop-calc .bg-gray-100,
html.dark .desktop-calc .hover\:bg-gray-100:hover,
html.dark .desktop-calc .hover\:bg-gray-200:hover {
    background-color: #2b2b2f !important;
}

html.dark .desktop-calc .border-gray-100,
html.dark .desktop-calc .border-gray-200,
html.dark .desktop-calc .border-gray-300 {
    border-color: rgba(255, 255, 255, 0.12) !important;
}

html.dark .desktop-calc .text-black {
    color: #f3f4f6 !important;
}

html.dark .desktop-calc .text-gray-300 { color: #9ca3af !important; }
html.dark .desktop-calc .text-gray-400 { color: #9ca3af !important; }
html.dark .desktop-calc .text-gray-500 { color: #a1a1aa !important; }
html.dark .desktop-calc .text-gray-600 { color: #d1d5db !important; }
html.dark .desktop-calc .text-gray-700 { color: #e5e7eb !important; }

html.dark .desktop-calc .bg-gradient-to-br.from-white.to-gray-50 {
    background-image: linear-gradient(to bottom right, #1c1c1e, #232326) !important;
}

.btn-bouncy {
    width: 100%;
    transform: translateZ(0);
    will-change: width;
    transition: width 0.7s cubic-bezier(0.35, 1.6, 0.6, 1), background-color 0.3s ease;
}

.group:hover .btn-bouncy {
    width: 48px;
    transition: width 0.5s cubic-bezier(0.25, 2.5, 0.5, 1);
}

.group:active .btn-bouncy {
    transform: scale(0.9) translateZ(0);
    transition: transform 0.1s ease;
}

.pop-up-enter-active {
    transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-up-leave-active {
    transition: all 0.3s ease-in;
}

.pop-up-enter-from,
.pop-up-leave-to {
    opacity: 0;
    transform: translate(-50%, 40px) scale(0.5);
}

.save-fireworks-stage {
    position: relative;
    width: 320px;
    height: 120px;
}

.save-firework-dot {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--size);
    height: var(--size);
    border-radius: 9999px;
    background: var(--dot-color);
    opacity: 0;
    box-shadow: 0 0 10px color-mix(in oklab, var(--dot-color) 70%, white 30%);
    transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(0.3);
    animation: save-firework-burst var(--duration) cubic-bezier(0.16, 1, 0.3, 1) forwards;
    animation-delay: var(--delay);
}

@keyframes save-firework-burst {
    0% {
        opacity: 0;
        transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(0.2);
    }
    12% {
        opacity: 1;
    }
    55% {
        opacity: 0.9;
    }
    100% {
        opacity: 0;
        transform: translate(calc(-50% + var(--bx) + var(--tx)), calc(-50% + var(--by) + var(--ty))) scale(0.15);
    }
}
</style>