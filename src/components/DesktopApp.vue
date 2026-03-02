<script setup>
import { ref, computed, onMounted, watch } from 'vue';
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

const router = useRouter();

const props = defineProps({
  calculatorId: { type: [String, Object], default: 'laser' }
});

// Достаем глобального пользователя и проверку прав
const { user: currentUser, hasPermission } = useDatabase();

const { 
    init, settings,
    layers, processing, accessories, packaging, design, project,
    materials, materialGroups, 
    coatings, processingDB, accessoriesDB, packagingDB, designDB,
    totals, materialConsumption: matConsumption,
    resetAll, syncStatus,
    addLayer, removeLayer, 
    addProcessing, removeProcessing, 
    addAccessory, removeAccessory, 
    addPackaging, removePackaging,
    addDesign, removeDesign,
    saveToHistory,
    triggerAutoSave 
} = useCalculator(typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId);

const showSaveProjectModal = ref(false);
const showResetConfirm = ref(false);
const showInvoice = ref(false);
const showAuthModal = ref(false); // <--- Для окна входа
const isManualSaving = ref(false);
const activeTab = ref('layers');
const toast = ref({ show: false, message: '' });
const reviewedSections = ref({ processing: false, accessories: false, packaging: false, design: false });

// Используем права для скрытия кнопок
const canViewHistory = computed(() => hasPermission('canSaveHistory'));
const canViewSettings = computed(() => hasPermission('canViewSettings'));
const resolvedCalculatorId = computed(() => typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId);

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

const checklist = computed(() => {
    const hasLayers = layers.value.length > 0;
    const allMaterials = hasLayers && layers.value.every(layer => !!layer?.matId);
    const allSizes = hasLayers && layers.value.every(layer => (Number(layer?.w) > 0 && Number(layer?.h) > 0));
    const allCutAndQty = hasLayers && layers.value.every(layer => (Number(layer?.cut) > 0 && Number(layer?.qty) >= 1));
    const extrasReviewed = Object.values(reviewedSections.value).every(Boolean);

    return [
        { key: 'layers', label: 'Добавлен хотя бы один слой', done: hasLayers, required: true },
        { key: 'material', label: 'Во всех слоях выбран материал', done: allMaterials, required: true },
        { key: 'size', label: 'Во всех слоях заполнены размеры', done: allSizes, required: true },
        { key: 'cutqty', label: 'Указаны длина реза и количество', done: allCutAndQty, required: true },
        { key: 'extras', label: 'Проверены доп. разделы (пост-обработка, аксессуары, упаковка, дизайн)', done: extrasReviewed, required: true }
    ];
});

const checklistDoneCount = computed(() => checklist.value.filter(item => item.done).length);
const missingChecklist = computed(() => checklist.value.filter(item => !item.done));
const isChecklistComplete = computed(() => missingChecklist.value.length === 0);

const checklistLabelShort = (key, full) => {
    if (key === 'layers') return 'Слой';
    if (key === 'material') return 'Материал';
    if (key === 'size') return 'Размеры';
    if (key === 'cutqty') return 'Рез/кол-во';
    if (key === 'extras') return 'Доп. разделы';
    return full;
};

onMounted(() => {
    init();
});

watch(activeTab, (tab) => {
    if (Object.prototype.hasOwnProperty.call(reviewedSections.value, tab)) {
        reviewedSections.value[tab] = true;
    }
});

const statusConfig = computed(() => {
    switch (syncStatus.value) {
        case 'syncing': return { text: 'Синхронизация...', class: 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-100 dark:border-blue-500/20', dot: 'bg-blue-500 animate-pulse' };
        case 'success': return { text: 'Актуально', class: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300 border-green-100 dark:border-green-500/20', dot: 'bg-green-500' };
        case 'offline': return { text: 'Офлайн', class: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/20', dot: 'bg-red-500' };
        default: return { text: 'Готово', class: 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-gray-300 border-gray-100 dark:border-white/10', dot: 'bg-gray-300 dark:bg-gray-500' };
    }
});

const openSettings = () => {
    router.push({ path: `/settings/${resolvedCalculatorId.value}`, query: { from: 'calc', calc: resolvedCalculatorId.value } });
};

const openHistoryPage = async () => {
    if (canViewHistory.value) {
        await triggerAutoSave();
    }
    router.push({ path: '/history', query: { from: 'calc', calc: resolvedCalculatorId.value } });
};

const goBackToHome = () => { router.push('/'); };

const onLoginSuccess = () => {
    toast.value = { show: true, message: 'Вы успешно вошли' };
    setTimeout(() => toast.value.show = false, 3000);
};

const openSaveProjectModal = () => {
    if (!currentUser.value) {
        showAuthModal.value = true;
        toast.value = { show: true, message: 'Сначала войдите в аккаунт' };
        setTimeout(() => { toast.value.show = false; }, 2500);
        return;
    }
    if (!canViewHistory.value) {
        toast.value = { show: true, message: 'Нет прав для сохранения в историю' };
        setTimeout(() => { toast.value.show = false; }, 2500);
        return;
    }
    showSaveProjectModal.value = true;
};

const handleManualSaveToHistory = async () => {
    if (!canViewHistory.value) {
        toast.value = { show: true, message: 'Нет прав для сохранения в историю' };
        setTimeout(() => { toast.value.show = false; }, 2500);
        return;
    }

    isManualSaving.value = true;
    try {
        await saveToHistory(project.value.name);
        showSaveProjectModal.value = false;
        toast.value = { show: true, message: 'Проект сохранён в Историю' };
        setTimeout(() => { toast.value.show = false; }, 3000);
    } catch (e) {
        toast.value = { show: true, message: e?.message || 'Ошибка сохранения' };
        setTimeout(() => { toast.value.show = false; }, 3000);
    } finally {
        isManualSaving.value = false;
    }
};

// ... (Хелперы и методы) ...
const getTextClass = (val) => { return (val && parseFloat(val) > 0) ? 'text-black dark:text-white font-bold' : 'text-gray-400 dark:text-gray-500 font-normal'; };
const mapOptions = (list, isGoods = false) => list.map(i => ({ value: i.id, label: i.name, sub: isGoods ? `${i.price} ₽` : (i.type === 'percent' ? `${i.value}%` : i.type === 'linear' ? `${i.price} ₽/м` : i.type === 'linear_mm' ? `${i.price} ₽/мм` : i.type === 'area' ? `${i.price} ₽/м²` : i.type === 'area_mm2' ? `${i.price} ₽/мм²` : i.type === 'roll' ? `${i.price} ₽/мп` : `${i.value || i.price} ₽`), active: i.active, inStock: i.inStock }));
const getFinishingOptions = (matId) => {
    const material = materials.value.find(m => m.id === matId);
    return coatings.value
        .filter(coating => isCoatingAllowedForMaterial(coating, material))
    .map(c => ({ value: c.id, label: c.name, sub: c.price > 0 ? `${c.price} ₽/см²` : '', inStock: c.inStock }));
};
const processingOptions = computed(() => mapOptions(processingDB.value));
const accessoryOptions = computed(() => mapOptions(accessoriesDB.value, true));
const packagingOptions = computed(() => mapOptions(packagingDB.value));
const designOptions = computed(() => mapOptions(designDB.value));
const onSelectChange = (item, dbList, val) => { const dbItem = dbList.find(i => i.id === val); if(dbItem) { item.dbId = val; item.name = dbItem.name; item.type = dbItem.type || 'fixed'; if(item.price !== undefined) item.price = dbItem.price || dbItem.value || 0; if(item.value !== undefined) item.value = dbItem.value || 0; if(dbItem.rollWidth) item.rollWidth = dbItem.rollWidth; } };
const onBeforeEnter = (el) => { el.style.height = '0'; el.style.opacity = '0'; el.style.overflow = 'hidden'; };
const onEnter = (el) => { el.style.transition = 'all 0.3s ease-out'; el.style.height = el.scrollHeight + 'px'; el.style.opacity = '1'; };
const onAfterEnter = (el) => { el.style.height = 'auto'; el.style.overflow = 'visible'; };
const onBeforeLeave = (el) => { el.style.height = el.scrollHeight + 'px'; el.style.overflow = 'hidden'; };
const onLeave = (el) => { el.style.transition = 'all 0.3s ease-in'; el.style.height = '0'; el.style.opacity = '0'; };
const autoCalcArea = (l) => { if(l.w && l.h) l.area = Math.round((l.w * l.h) / 100 * 10) / 10; else l.area = 0; };
const autoCalcEngraving = (l) => { if(l.engravingW_mm && l.engravingH_mm) l.engravingArea = Math.round((l.engravingW_mm * l.engravingH_mm) / 100 * 10) / 10; else l.engravingArea = 0; };
const stepUp = (obj, key, step = 1) => { let val = parseFloat(obj[key]) || 0; obj[key] = parseFloat((val + step).toFixed(1)); if(key === 'w' || key === 'h') autoCalcArea(obj); };
const stepDown = (obj, key, step = 1, min = 0) => { let val = parseFloat(obj[key]) || 0; let newVal = parseFloat((val - step).toFixed(1)); obj[key] = newVal < min ? min : newVal; if(key === 'w' || key === 'h') autoCalcArea(obj); };
const changeDiscount = (step) => { let n = project.value.discount + step; project.value.discount = Math.max(0, Math.min(50, n)); };
const changeMarkup = (step) => { let n = project.value.markup + step; project.value.markup = Math.max(0, Math.min(50, n)); };

const ensureChecklistComplete = (actionLabel) => {
    if (isChecklistComplete.value) return true;

    const firstMissing = missingChecklist.value[0];
    if (firstMissing?.key === 'extras') {
        activeTab.value = 'processing';
    } else {
        activeTab.value = 'layers';
    }

    toast.value = {
        show: true,
        message: `Перед действием "${actionLabel}" заполните: ${firstMissing?.label || 'обязательные поля'}`
    };
    setTimeout(() => { toast.value.show = false; }, 3500);
    return false;
};

const openInvoiceModal = () => {
    if (!ensureChecklistComplete('Сформировать КП')) return;
    showInvoice.value = true;
};

const copyQuote = async () => {
    if (!ensureChecklistComplete('Копировать КП')) return;

    // Автосохранение при копировании, если есть права
    if (canViewHistory.value) { triggerAutoSave().then(saved => { toast.value = { show: true, message: saved ? 'Скопировано и сохранено' : 'Скопировано' }; setTimeout(() => { toast.value.show = false; }, 3000); }); } 
    else { toast.value = { show: true, message: 'Скопировано' }; setTimeout(() => { toast.value.show = false; }, 3000); }

    const date = new Date().toLocaleDateString('ru-RU');
    let t = `КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ\nДата: ${date}\n\n`;
    if(project.value.name) t += `Проект: ${project.value.name}\n`;
    t += `ИТОГО К ОПЛАТЕ: ${totals.value.total.toLocaleString()} ₽`;
    navigator.clipboard.writeText(t);
};

const onInvoicePrint = () => { if(canViewHistory.value) triggerAutoSave(); };
const requestReset = () => { showResetConfirm.value = true; };
const confirmReset = () => { resetAll(); showResetConfirm.value = false; toast.value = { show: true, message: 'Проект очищен' }; setTimeout(() => { toast.value.show = false; }, 3000); };
</script>

<template>
    <div class="desktop-calc w-full max-w-7xl container mx-auto p-5 md:p-7 text-sm text-[#18181B] dark:text-gray-100">
    
    <AppBreadcrumbs />

    <header class="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-white/10 no-print gap-4">
        <div class="flex-1 w-full md:w-auto flex items-center gap-2">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-[#18181B] dark:text-white">Лазерная резка</h1>
                <p class="text-[11px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">Профессиональный расчёт материалов и реза</p>
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
                <button @click="openHistoryPage" class="btn-labeled calc-top-nav-btn group" title="История">
                    <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <span class="hidden md:block">История</span>
                </button>
            </template>

            <template v-if="canViewSettings">
                <button @click="openSettings" class="btn-labeled calc-top-nav-btn group" title="Настройки">
                    <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </div>
                    <span class="hidden md:block">Настройки</span>
                </button>
            </template>
        </div>
    </header>

    <div class="calc-checklist mb-4 p-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] no-print">
        <div class="flex items-center justify-between gap-3 mb-2">
            <h3 class="text-[10px] font-black uppercase tracking-wider text-[#18181B] dark:text-white">Чеклист менеджера</h3>
            <div class="text-[10px] font-black whitespace-nowrap" :class="isChecklistComplete ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-300'">
                {{ checklistDoneCount }}/{{ checklist.length }}
            </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
            <div v-for="item in checklist" :key="item.key" class="check-item rounded-full pl-2 pr-2.5 py-1 border transition-colors" :class="item.done ? 'border-gray-300 bg-gray-100 dark:border-white/25 dark:bg-white/10' : 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5'">
                <div class="flex items-center gap-1.5">
                    <span class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black" :class="item.done ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-gray-300 text-white dark:bg-gray-600'">
                        {{ item.done ? '✓' : '' }}
                    </span>
                    <span class="text-[10px] font-bold" :class="item.done ? 'text-[#18181B] dark:text-white' : 'text-gray-600 dark:text-gray-300'">{{ checklistLabelShort(item.key, item.label) }}</span>
                </div>
            </div>
        </div>
    </div>

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
                                <h3 class="text-lg font-black text-[#18181B] dark:text-white truncate">Раскрой и лазерная резка</h3>
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
                        <div v-if="layers.length" key="list" class="space-y-4">
                                <div v-for="(l, i) in layers" :key="l.id" class="card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0" :class="l.expanded ? 'bg-white' : 'bg-white hover:bg-[#18181B] border border-gray-200 hover:border-black'">
                                    <div @click="l.expanded = !l.expanded" class="layer-header flex justify-between items-center select-none cursor-pointer transition-colors duration-200 p-4" :class="{ 'is-expanded': l.expanded }">
                                        <div class="flex items-center gap-3 flex-1 min-w-0"><div class="shrink-0 transition-transform duration-300" :class="[l.expanded ? 'rotate-180 text-gray-400' : 'text-black group-hover:text-white']"><svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1L5 5L9 1"/></svg></div><input v-model="l.name" @click.stop maxlength="15" class="bg-transparent outline-none font-bold text-sm uppercase tracking-widest transition-colors w-[30%] cursor-text" :class="l.expanded ? 'text-black' : 'text-black group-hover:text-white'" placeholder="Название слоя"></div>
                                        <div class="shrink-0 ml-4"><button v-if="l.expanded" @click.stop="removeLayer(l.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors">Удалить</button></div>
                                    </div>
                                    <transition name="collapse" @before-enter="onBeforeEnter" @enter="onEnter" @after-enter="onAfterEnter" @before-leave="onBeforeLeave" @leave="onLeave">
                                        <div v-show="l.expanded" class="layer-card-body px-5 pb-5 pt-3 grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
                                            <div class="md:col-span-6"><label class="label">Материал</label><ModernSelect v-model="l.matId" :grouped="materialGroups" placeholder="Выбор материала" @update:modelValue="() => { l.finishing='none'; l.finishingBothSides = false; }" /></div>
                                            <div :class="l.finishing !== 'none' ? 'md:col-span-4' : 'md:col-span-6'">
                                                <label class="label">Пост-обработка</label>
                                                <ModernSelect class="flex-1" v-model="l.finishing" :options="[{value: 'none', label: 'Без покрытия'}, ...getFinishingOptions(l.matId)]" placeholder="Без покрытия" @update:modelValue="val => { if (val === 'none') l.finishingBothSides = false; }" />
                                            </div>
                                            <div v-if="l.finishing !== 'none'" class="md:col-span-2">
                                                <label class="label">2 стороны</label>
                                                <button
                                                    type="button"
                                                    class="engrave-toggle w-full h-14 min-w-0 border border-gray-200 dark:border-white/10 rounded-2xl flex items-center justify-between px-2.5 bg-white dark:bg-[#232326] transition-colors duration-200"
                                                    :class="{ 'is-on': l.finishingBothSides }"
                                                    @click="l.finishingBothSides = !l.finishingBothSides"
                                                >
                                                    <span class="flex items-center min-w-0">
                                                        <span class="engrave-switch"><span class="engrave-knob"></span></span>
                                                    </span>
                                                    <span class="text-[10px] font-black uppercase tracking-wider whitespace-nowrap ml-2" :class="l.finishingBothSides ? 'text-black dark:text-white' : 'text-gray-400 dark:text-gray-500'">{{ l.finishingBothSides ? 'x2' : 'x1' }}</span>
                                                </button>
                                            </div>
                                            <div class="md:col-span-7"><label class="label">Размеры (мм)</label><div class="flex items-center gap-2"><input type="number" v-model.number="l.w" @input="autoCalcArea(l)" class="input-std text-center" :class="getTextClass(l.w)" placeholder="Ш (мм)"><span class="text-gray-300 font-bold">✕</span><input type="number" v-model.number="l.h" @input="autoCalcArea(l)" class="input-std text-center" :class="getTextClass(l.h)" placeholder="В (мм)"></div></div>
                                            <div class="md:col-span-5"><label class="label">Площадь (см²)</label><div class="input-std bg-gray-50 flex items-center justify-center"><input type="number" v-model.number="l.area" class="w-full h-full bg-transparent text-center outline-none" :class="getTextClass(l.area)" placeholder="0"></div></div>
                                            <div class="md:col-span-4"><label class="label">Длина кривой (мм)</label><div class="stepper-wrap"><button @click="stepDown(l, 'cut', 100, 0)" class="step-btn">-</button><input type="number" v-model.number="l.cut" step="1" class="step-input" :class="getTextClass(l.cut)" placeholder="0"><button @click="stepUp(l, 'cut', 100)" class="step-btn">+</button></div></div>
                                            <div class="md:col-span-3"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(l, 'qty', 1, 1)" class="step-btn">-</button><input type="number" v-model.number="l.qty" class="step-input" :class="getTextClass(l.qty)" placeholder="1"><button @click="stepUp(l, 'qty', 1)" class="step-btn">+</button></div></div>
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
                        </div>
                        <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет слоев для раскроя</div>
                    </transition>
                </div>
                
                <div v-else-if="activeTab === 'processing'" key="processing"><div class="calc-section-head flex justify-between items-center mb-4"><div class="flex items-center gap-2"><h2 class="section-title">Пост-обработка</h2><Tooltip text="Дополнительные услуги..."><div class="w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-black hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors shadow-sm">?</div></Tooltip></div><button @click="addProcessing" class="btn-add">Добавить обработку</button></div><transition name="fade" mode="out-in"><div v-if="processing.length" key="list"><TransitionGroup name="list" tag="div" class="space-y-3"><div v-for="(item, i) in processing" :key="item.id" class="card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Вид работ</label><ModernSelect v-model="item.dbId" :options="processingOptions" @update:modelValue="val => onSelectChange(item, processingDB, val)" placeholder="Выберите услугу" /></div><div class="w-full md:w-5/12"><div v-if="item.type === 'fixed'"><label class="label">Стоимость (₽)</label><div class="input-std bg-gray-50 flex items-center justify-center"><input type="number" v-model.number="item.value" class="w-full h-full bg-transparent text-center outline-none font-bold"></div></div><div v-else-if="item.type === 'percent'"><label class="label">Процент (%)</label><div class="stepper-wrap"><button @click="stepDown(item, 'value', 5)" class="step-btn">-</button><input type="number" v-model.number="item.value" class="step-input font-bold" placeholder="0"><button @click="stepUp(item, 'value', 5)" class="step-btn">+</button></div></div><div v-else-if="item.type === 'pieces'" class="flex gap-2"><div class="w-1/2"><label class="label">Цена (₽)</label><input type="number" v-model.number="item.price" class="input-std text-center"></div><div class="w-1/2"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div><div v-else-if="item.type === 'linear' || item.type === 'linear_mm' || item.type === 'roll'" class="flex gap-2"><div class="w-7/12"><label class="label">Длина (мм)</label><input type="number" v-model.number="item.length" class="input-std text-center font-bold" placeholder="0"></div><div class="w-5/12"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div><div v-else-if="item.type === 'area' || item.type === 'area_mm2'" class="flex gap-2"><div class="w-7/12"><label class="label">Размеры (мм)</label><div class="flex items-center gap-1"><input type="number" v-model.number="item.w" class="input-std text-center !px-1 text-xs" placeholder="Ш"><span class="text-gray-300 font-bold text-xs">✕</span><input type="number" v-model.number="item.h" class="input-std text-center !px-1 text-xs" placeholder="В"></div></div><div class="w-5/12"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removeProcessing(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленной пост-обработки</div></transition></div>
                <div v-else-if="activeTab === 'accessories'" key="accessories"><div class="calc-section-head flex justify-between items-center mb-4"><h2 class="section-title">Аксессуары</h2><button @click="addAccessory" class="btn-add">Добавить</button></div><transition name="fade" mode="out-in"><div v-if="accessories.length" key="list"><TransitionGroup name="list" tag="div" class="space-y-3"><div v-for="(item, i) in accessories" :key="item.id" class="card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Наименование</label><ModernSelect v-model="item.dbId" :options="accessoryOptions" @update:modelValue="val => onSelectChange(item, accessoriesDB, val)" placeholder="Выберите товар" /></div><div class="w-full md:w-5/12 flex gap-2"><div class="w-1/2"><label class="label">Цена (₽)</label><input type="number" v-model.number="item.price" class="input-std text-center text-gray-500"></div><div class="w-1/2"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removeAccessory(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленных аксессуаров</div></transition></div>
                <div v-else-if="activeTab === 'packaging'" key="packaging"><div class="calc-section-head flex justify-between items-center mb-4"><h2 class="section-title">Упаковка</h2><button @click="addPackaging" class="btn-add">Добавить</button></div><transition name="fade" mode="out-in"><div v-if="packaging.length" key="list"><TransitionGroup name="list" tag="div" class="space-y-3"><div v-for="(item, i) in packaging" :key="item.id" class="card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Тип</label><ModernSelect v-model="item.dbId" :options="packagingOptions" @update:modelValue="val => onSelectChange(item, packagingDB, val)" placeholder="Выберите упаковку" /></div><div class="w-full md:w-5/12 flex gap-2"><div class="w-1/2"><label class="label">Цена (₽)</label><input type="number" v-model.number="item.price" class="input-std text-center text-gray-500"></div><div class="w-1/2"><label class="label">Кол-во</label><div class="stepper-wrap"><button @click="stepDown(item, 'qty', 1)" class="step-btn">-</button><input type="number" v-model.number="item.qty" class="step-input font-bold"><button @click="stepUp(item, 'qty', 1)" class="step-btn">+</button></div></div></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removePackaging(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленной упаковки</div></transition></div>
                <div v-else-if="activeTab === 'design'" key="design"><div class="calc-section-head flex justify-between items-center mb-4"><h2 class="section-title">Дизайн</h2><button @click="addDesign" class="btn-add">Добавить</button></div><transition name="fade" mode="out-in"><div v-if="design.length" key="list"><TransitionGroup name="list" tag="div" class="space-y-3"><div v-for="(item, i) in design" :key="item.id" class="card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"><div class="w-full md:w-1/2"><label class="label">Услуга</label><ModernSelect v-model="item.dbId" :options="designOptions" @update:modelValue="val => onSelectChange(item, designDB, val)" placeholder="Выберите услугу" /></div><div class="w-full md:w-5/12"><label class="label">Стоимость (₽)</label><input type="number" v-model.number="item.value" class="input-std text-center font-bold"></div><div class="absolute top-2 right-2 md:top-3 md:right-3"><button @click="removeDesign(item.id)" class="text-gray-300 hover:text-red-500 font-bold text-xs no-print transition-colors p-2">Удалить</button></div></div></TransitionGroup></div><div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">Нет добавленного макета</div></transition></div>
            </Transition>
        </div>

        <div class="relative">
            <div class="sticky top-6">
                <div class="kpi-card bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 text-[#18181B] dark:text-gray-100 mb-6">
                    <PriceChart :totals="totals" />
                    <MaterialConsumption :consumption="matConsumption" />
                    <div class="my-6 h-px bg-gray-100"></div>
                    <div class="space-y-4 mb-6">
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-black dark:bg-gray-300"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Материалы и резка</span></div><span class="calc-amount-value">{{ totals.layers.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#52525B] dark:bg-gray-400"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Пост-обработка</span> </div><span class="calc-amount-value">{{ totals.processing.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#A1A1AA] dark:bg-gray-500"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Аксессуары</span></div><span class="calc-amount-value">{{ totals.accessories.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#D4D4D8] dark:bg-gray-500"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Упаковка</span></div><span class="calc-amount-value">{{ totals.packaging.toLocaleString() }} ₽</span></div>
                        <div class="flex justify-between items-baseline"><div class="flex items-center gap-2"><div class="w-2.5 h-2.5 rounded-full bg-[#E4E4E7] dark:bg-gray-600"></div> <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Дизайн</span></div><span class="calc-amount-value">{{ totals.design.toLocaleString() }} ₽</span></div>
                    </div>

                    <div v-if="canViewHistory" class="kp-controls bg-gray-100 rounded-xl p-4 mb-6 space-y-4 relative">
                         <div class="absolute top-2 right-2 z-10"><Tooltip text="Итого = (Себестоимость + Наценка%) - Скидка%" width="w-48"><div class="w-4 h-4 rounded-full bg-white text-gray-400 hover:text-black flex items-center justify-center text-[10px] font-bold shadow-sm cursor-help">?</div></Tooltip></div>
                        <div class="flex items-center justify-between"><div class="flex flex-col"><span class="text-[10px] uppercase font-bold text-gray-500">Наценка</span><span v-if="totals.markupRub > 0" class="text-[10px] font-bold text-green-600">+{{ totals.markupRub.toLocaleString() }} ₽</span></div><div class="flex items-center bg-white rounded-lg border border-gray-200 h-8 shadow-sm"><button @click="changeMarkup(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-l-lg transition-colors font-bold">-</button><span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-100 leading-8">{{ project.markup }}%</span><button @click="changeMarkup(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-r-lg transition-colors font-bold">+</button></div></div>
                        <div class="flex items-center justify-between"><div class="flex flex-col"><span class="text-[10px] uppercase font-bold text-gray-500">Скидка</span><span v-if="totals.discountRub > 0" class="text-[10px] font-bold text-red-500">-{{ totals.discountRub.toLocaleString() }} ₽</span></div><div class="flex items-center bg-white rounded-lg border border-gray-200 h-8 shadow-sm"><button @click="changeDiscount(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-l-lg transition-colors font-bold">-</button><span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-100 leading-8">{{ project.discount }}%</span><button @click="changeDiscount(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50 rounded-r-lg transition-colors font-bold">+</button></div></div>
                    </div>

                    <div class="mb-6 border-t border-gray-100 pt-4"><div class="flex justify-between items-baseline"><span class="text-sm font-bold uppercase tracking-widest text-gray-400">Итого</span><span class="total-amount text-3xl font-black tracking-tighter">{{ totals.total.toLocaleString() }} ₽</span></div></div>

                    <div class="flex flex-col gap-3">
                        <button @click="openInvoiceModal" class="w-full h-12 bg-black text-white rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] shadow-xl flex items-center justify-center gap-2">Сформировать КП</button>
                        <div class="grid grid-cols-2 gap-3">
                            <button @click="copyQuote" class="kp-secondary-btn h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">Копировать КП</button>
                            <button @click="requestReset" class="kp-secondary-btn kp-secondary-danger h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">Сброс</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <Transition name="modal-anim"><div v-if="showSaveProjectModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print" @click.self="showSaveProjectModal=false"><div class="bg-white p-6 rounded-2xl w-full max-w-sm shadow-xl"><h3 class="font-bold text-lg mb-2">Сохранить в историю</h3><p class="text-xs text-gray-500 mb-4">Укажите данные проекта перед сохранением</p><div class="space-y-3"><input v-model="project.name" class="input-std font-bold" placeholder="Название проекта"><input v-model="project.client" class="input-std" placeholder="Заказчик / Организация"><div class="grid grid-cols-2 gap-3 pt-1"><button @click="showSaveProjectModal=false" class="py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider">Отмена</button><button @click="handleManualSaveToHistory" :disabled="isManualSaving" class="py-3 rounded-xl font-bold bg-black text-white hover:bg-gray-800 transition-colors text-xs uppercase tracking-wider disabled:opacity-60">{{ isManualSaving ? 'Сохранение...' : 'Сохранить' }}</button></div></div></div></div></Transition>
    <Transition name="modal-anim"><div v-if="showResetConfirm" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showResetConfirm = false"><div class="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-white/50 text-center transform transition-all"><h3 class="text-lg font-black mb-2">Сбросить всё?</h3><p class="text-sm text-gray-500 mb-6">Все введенные данные будут удалены.</p><div class="grid grid-cols-2 gap-3"><button @click="showResetConfirm = false" class="py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider">Отмена</button><button @click="confirmReset" class="py-3 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all text-xs uppercase tracking-wider">Сбросить</button></div></div></div></Transition>
    
    <Transition name="modal-anim">
        <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @success="onLoginSuccess" />
    </Transition>

    <Teleport to="body">
        <InvoiceModal :show="showInvoice" :project="project" :layers="layers" :processing="processing" :accessories="accessories" :packaging="packaging" :design="design" :totals="totals" :settings="settings" :materials="materials" :coatings="coatings" @close="showInvoice = false" @print="onInvoicePrint" />
    </Teleport>

    <Transition name="toast"><div v-if="toast.show" class="fixed top-6 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md transition-all bg-[#18181B]/90 text-white"><span class="font-bold text-xs uppercase tracking-wide">{{ toast.message }}</span></div></Transition>
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

.desktop-calc .service-card {
    min-height: 130px;
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
</style>