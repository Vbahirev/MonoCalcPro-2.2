<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useCalculator } from '@/core/useCalculator';
import { useHaptics } from '@/composables/useHaptics';
import { useDatabase } from '@/composables/useDatabase'; // <--- Импорт базы
import MobileLayerCard from './mobile/MobileLayerCard.vue';
import ModernSelect from './ModernSelect.vue'; 
import AnimatedIcon from './mobile/AnimatedIcon.vue';
import AuthLogin from './AuthLogin.vue'; // <--- Импорт окна входа
import { isCoatingAllowedForMaterial } from '@/utils/coatingCompatibility';
import { COATING_PRICING_MODE_DTF_LINEAR, getCoatingPricePerCm2 } from '@/utils/coatingPricing';

const props = defineProps({
  calculatorId: { type: [String, Object], default: 'laser' }
});

// Достаем глобального пользователя
const { user: currentUser } = useDatabase();

const { 
    init, settings,
    layers, processing, accessories, packaging, design, project,
    materials, materialGroups, coatings, processingDB, accessoriesDB, packagingDB, designDB,
    totals, materialConsumption, resetAll, 
    addLayer, removeLayer, addProcessing, removeProcessing, 
    addAccessory, removeAccessory, addPackaging, removePackaging, addDesign, removeDesign,
    triggerAutoSave 
} = useCalculator(typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId);

const { impactLight, impactMedium, notificationSuccess, notificationError } = useHaptics();
const router = useRouter();
const route = useRoute();

const activePage = ref('layers');
const showPageMenu = ref(false); 
const showAuthModal = ref(false); // <--- Для модалки входа
const showMobileDevModal = ref(true);
const scrollContainer = ref(null);

// Состояния для анимаций
const newlyAddedId = ref(null); 
const restoredId = ref(null);   

// --- EDIT SHEET STATE ---
const editingItem = ref(null);
const editingType = ref(null); 

const sheetY = ref(0);
const sheetIsDragging = ref(false);
const sheetStartY = ref(0);
const sheetStartScrollTop = ref(0);
const sheetScrollRef = ref(null);

const openSettings = () => {
    const id = typeof props.calculatorId === 'object' ? props.calculatorId.value : props.calculatorId;
    router.push({ path: `/settings/${id}`, query: { from: 'calc', calc: id } });
};

const openEdit = (item, type) => {
    impactMedium();
    editingItem.value = item;
    editingType.value = type;
    sheetY.value = 0; 
};

const closeEdit = () => {
    editingItem.value = null;
    editingType.value = null;
    impactLight();
    setTimeout(() => { sheetY.value = 0; }, 300);
};

const onSheetTouchStart = (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.closest('.no-drag') || target.closest('button')) return;
    sheetStartY.value = e.touches[0].clientY;
    sheetStartScrollTop.value = sheetScrollRef.value ? sheetScrollRef.value.scrollTop : 0;
    sheetIsDragging.value = true;
};

const onSheetTouchMove = (e) => {
    if (!sheetIsDragging.value) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - sheetStartY.value;
    if (sheetStartScrollTop.value > 0 && diff > 0) return;
    if (diff > 0) {
        if (e.cancelable && sheetStartScrollTop.value <= 0) e.preventDefault(); 
        sheetY.value = diff;
    }
};

const onSheetTouchEnd = () => {
    sheetIsDragging.value = false;
    if (sheetY.value > 100) { closeEdit(); } else { sheetY.value = 0; }
};

const handleAddNew = async (type) => {
    impactMedium();
    let newItem = null;
    if (type === 'layers') { addLayer(); newItem = layers.value[0]; }
    else if (type === 'processing') { newItem = addProcessing(); }
    else if (type === 'accessories') { newItem = addAccessory(); }
    else if (type === 'packaging') { newItem = addPackaging(); }
    else if (type === 'design') { newItem = addDesign(); }

    if (newItem) {
        newlyAddedId.value = newItem.id;
        setTimeout(() => newlyAddedId.value = null, 600);
        await nextTick();
        openEdit(newItem, type);
    }
};

// --- UNDO SYSTEM ---
const toasts = ref([]); 

const getListRef = (name) => {
    if (name === 'layers') return layers;
    if (name === 'processing') return processing;
    if (name === 'accessories') return accessories;
    if (name === 'packaging') return packaging;
    if (name === 'design') return design;
    return null;
};

const getRemoveFn = (name) => {
    if (name === 'layers') return removeLayer;
    if (name === 'processing') return removeProcessing;
    if (name === 'accessories') return removeAccessory;
    if (name === 'packaging') return removePackaging;
    if (name === 'design') return removeDesign;
    return null;
};

const addToast = (msg, isUndo = false, undoData = null) => {
    const id = Date.now() + Math.random();
    const duration = isUndo ? 4000 : 2000;
    const timer = setTimeout(() => { removeToast(id); }, duration);
    toasts.value.push({ id, message: msg, isUndo, undoData, timer });
    if (toasts.value.length > 3) {
        const removed = toasts.value.shift();
        if (removed && removed.timer) clearTimeout(removed.timer);
    }
};

const removeToast = (id) => {
    const idx = toasts.value.findIndex(t => t.id === id);
    if (idx !== -1) {
        if (toasts.value[idx].timer) clearTimeout(toasts.value[idx].timer);
        toasts.value.splice(idx, 1);
    }
};

const removeWithUndo = (listName, id) => {
    if (editingItem.value && editingItem.value.id === id) closeEdit();
    const listRef = getListRef(listName);
    const removeFn = getRemoveFn(listName);
    if (!listRef || !removeFn) return;
    const index = listRef.value.findIndex(i => i.id === id);
    if (index === -1) return;
    const item = JSON.parse(JSON.stringify(listRef.value[index]));
    removeFn(id);
    notificationError();
    addToast(`Удалено`, true, { listName, item, index });
};

const performUndo = async (toast) => {
    removeToast(toast.id);
    if (!toast.undoData) return;
    const { listName, item, index } = toast.undoData;
    const listRef = getListRef(listName);
    if (listRef) {
        listRef.value.splice(index, 0, item);
        restoredId.value = item.id;
        setTimeout(() => restoredId.value = null, 600);
        await triggerAutoSave();
        notificationSuccess();
    }
};

// --- SWIPE LOGIC ---
const swipedItemId = ref(null);
const swipeOffset = ref(0);
const touchStartX = ref(0);
const touchStartY = ref(0);

const onListTouchStart = (e, id) => {
    if(e.target.closest('.no-swipe')) return;
    touchStartX.value = e.touches[0].clientX;
    touchStartY.value = e.touches[0].clientY;
    swipedItemId.value = id;
};

const onListTouchMove = (e) => {
    if (!swipedItemId.value) return;
    const xDiff = e.touches[0].clientX - touchStartX.value;
    const yDiff = e.touches[0].clientY - touchStartY.value;
    if (Math.abs(yDiff) > Math.abs(xDiff)) { swipedItemId.value = null; swipeOffset.value = 0; return; }
    if (xDiff < 0) { swipeOffset.value = Math.max(-120, xDiff); }
};

const onListTouchEnd = (listName, id) => {
    if (swipeOffset.value < -80) { removeWithUndo(listName, id); }
    swipeOffset.value = 0;
    swipedItemId.value = null;
};

const onLoginSuccess = () => {
    showAuthModal.value = false;
    showPageMenu.value = false; // Закрываем меню после входа
    notificationSuccess();
};

const openDesktopVersion = () => {
    impactMedium();
    const nextQuery = { ...route.query, view: 'desktop' };
    router.replace({ path: route.path, query: nextQuery });
};

onMounted(() => { init(); });

const pages = [
    { id: 'layers', label: 'Раскрой', icon: 'layers' },
    { id: 'processing', label: 'Услуги', icon: 'processing' },
    { id: 'accessories', label: 'Фурнитура', icon: 'accessories' },
    { id: 'packaging', label: 'Упаковка', icon: 'packaging' },
    { id: 'design', label: 'Макет', icon: 'design' },
    { id: 'total', label: 'Смета', icon: 'total' },
];
const DEFAULT_PACKAGING_ROLL_WIDTH_MM = 500;

const currentPageLabel = computed(() => pages.find(p => p.id === activePage.value)?.label);

const switchPage = (id) => { 
    if (activePage.value !== id) {
        activePage.value = id; 
        showPageMenu.value = false; 
        impactLight(); 
        if (scrollContainer.value) { scrollContainer.value.scrollTo({ top: 0, behavior: 'smooth' }); }
    }
};

const handleDuplicateLayer = (layer) => {
    const newLayer = JSON.parse(JSON.stringify(layer)); 
    newLayer.id = Date.now() + Math.random(); 
    newLayer.name = `${newLayer.name} (Копия)`;
    layers.value.unshift(newLayer);
    newlyAddedId.value = newLayer.id;
    setTimeout(() => newlyAddedId.value = null, 600);
    addToast('Скопировано');
};

const copyToClipboard = async () => { await triggerAutoSave(); const t = `ЗАКАЗ "${project.value.name}"\nTotal: ${totals.value.total} ₽`; try { if (!navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable'); await navigator.clipboard.writeText(t); notificationSuccess(); addToast('Скопировано'); } catch (e) { addToast('Не удалось скопировать'); } };
const confirmReset = () => { if(confirm('Сброс?')) { resetAll(); notificationSuccess(); addToast('Очищено'); } };

// Helpers
const isAvailableItem = (item) => (item?.inStock !== false) && (item?.active !== false);
const hasSelectedDbItem = (item) => Boolean(item?.dbId);
const applyMarkup = (value, markupPercent) => {
    const amount = Number(value) || 0;
    const pct = Math.max(0, Number(markupPercent) || 0);
    return amount * (1 + pct / 100);
};
const usesValueField = (type) => type === 'fixed' || type === 'percent';
const mapOptions = (list) => [...(list || [])].filter(isAvailableItem).reverse().map(i => {
    const markup = Math.max(0, Number(i?.markupPercent) || 0);
    const finalPrice = Math.round(applyMarkup(i.price || i.value, markup));
    const finalPercent = Math.round(applyMarkup(i.price ?? i.value ?? 0, markup));
    if (i?.type === 'percent') {
        return { value: i.id, label: i.name, sub: `${finalPercent}%` };
    }
    if (i?.type === 'roll') {
        const width = Number(i?.rollWidthMm || i?.rollWidth) || 0;
        return { value: i.id, label: i.name, sub: `${finalPrice} ₽/пог.м${width > 0 ? ` • ${width}мм` : ''}` };
    }
    if (i?.type === 'area_cm2') return { value: i.id, label: i.name, sub: `${finalPrice} ₽/см²` };
    if (i?.type === 'box_mm') return { value: i.id, label: i.name, sub: `${finalPrice} ₽/м²` };
    return { value: i.id, label: i.name, sub: `${finalPrice} ₽` };
});
const processingOptions = computed(() => mapOptions(processingDB.value));
const accessoryOptions = computed(() => mapOptions(accessoriesDB.value));
const packagingOptions = computed(() => mapOptions(packagingDB.value));
const designOptions = computed(() => mapOptions(designDB.value));
const getFinishingOptions = (matId) => {
    const material = materials.value.find(m => m.id === matId);
    return coatings.value
    .filter(coating => coating?.inStock !== false)
        .filter(coating => coating?.pricingModel !== COATING_PRICING_MODE_DTF_LINEAR)
        .filter(coating => isCoatingAllowedForMaterial(coating, material))
        .map(c => {
            const pricePerCm2 = getCoatingPricePerCm2(c);
            const printable = pricePerCm2 >= 1 ? pricePerCm2.toFixed(2) : pricePerCm2.toFixed(3);
            return ({ value: c.id, label: c.name, sub: pricePerCm2 > 0 ? `${printable} ₽/см²` : '' });
        });
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
const amountLabel = (type) => {
    if (type === 'percent') return 'Процент';
    if (type === 'roll') return 'Цена за пог.м';
    if (type === 'linear') return 'Цена за м';
    if (type === 'linear_mm') return 'Цена за мм';
    if (type === 'area') return 'Цена за м²';
    if (type === 'area_cm2') return 'Цена за см²';
    if (type === 'area_mm2') return 'Цена за мм²';
    if (type === 'box_mm') return 'Цена за м²';
    return 'Цена';
};
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
const normalizeSides = (value) => (Number(value) === 2 ? 2 : 1);
const stepUp = (obj, key) => { obj[key] = (parseFloat(obj[key]) || 0) + 1; impactLight(); };
const stepDown = (obj, key) => { const v = (parseFloat(obj[key]) || 0) - 1; obj[key] = v < 1 ? 1 : v; impactLight(); };
const autoCalcArea = () => { if(editingItem.value.w && editingItem.value.h) { editingItem.value.area = Math.round((editingItem.value.w * editingItem.value.h) / 100 * 10) / 10; } else { editingItem.value.area = 0; } };
const selectAll = (event) => { event.target.select(); };

// Navigation Bar Logic
const pageIds = pages.map(p => p.id);
const currentIndex = computed(() => pageIds.indexOf(activePage.value));
const barTouchStart = ref(0);
const onBarTouchStart = (e) => { barTouchStart.value = e.touches[0].clientX; };
const onBarTouchEnd = (e) => { const diff = e.changedTouches[0].clientX - barTouchStart.value; if (Math.abs(diff) > 50) { if (diff < 0) { if (currentIndex.value < pageIds.length - 1) switchPage(pageIds[currentIndex.value + 1]); } else { if (currentIndex.value > 0) switchPage(pageIds[currentIndex.value - 1]); } } };
</script>

<template>
    <div class="fixed inset-0 bg-[#F5F5F7] font-sans overflow-hidden text-[#1d1d1f]">
        <Transition name="mobile-dev-modal">
            <div v-if="showMobileDevModal" class="fixed inset-0 z-[12000] bg-black/55 backdrop-blur-md p-5 flex items-center justify-center">
                <div class="w-full max-w-sm rounded-[2rem] bg-white border border-white/70 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.6)] overflow-hidden">
                    <div class="px-6 pt-6 pb-4 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-700 text-white">
                        <div class="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-4">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        </div>
                        <h2 class="text-2xl font-black tracking-tight leading-tight">Мобильная версия в разработке</h2>
                        <p class="mt-2 text-sm text-white/75 font-medium">Для стабильной работы перейдите в desktop-версию сайта.</p>
                    </div>

                    <div class="p-5 space-y-3">
                        <button @click="openDesktopVersion" class="w-full h-12 rounded-2xl bg-black text-white font-bold text-sm tracking-wide shadow-lg active:scale-[0.98] transition-transform">
                            Перейти в Desktop версию
                        </button>
                        <button @click="showMobileDevModal = false; impactLight()" class="w-full h-11 rounded-2xl bg-gray-100 text-gray-700 font-bold text-sm active:scale-[0.98] transition-transform">
                            Остаться в мобильной
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
        
        <div class="h-full w-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] origin-bottom will-change-transform bg-[#F5F5F7]"
             :class="showPageMenu || editingItem ? 'scale-[0.92] opacity-80 brightness-95 rounded-[2rem] overflow-hidden translate-y-4 shadow-2xl pointer-events-none' : ''">

            <main 
                ref="scrollContainer"
                class="h-full overflow-y-auto custom-scroll px-4 pt-12 pb-40"
                style="-webkit-mask-image: linear-gradient(to bottom, transparent 0px, black 40px, black calc(100% - 160px), transparent calc(100% - 40px), transparent 100%);"
            >
                <Transition name="page-flow" mode="out-in">
                    
                    <div v-if="activePage === 'layers'" key="layers" class="min-h-full">
                        <div class="mb-6 mt-2 px-1">
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Проект</label>
                            <input v-model="project.name" 
                                   class="bg-transparent outline-none font-black tracking-tighter w-full placeholder-gray-300 text-black text-4xl leading-tight" 
                                   placeholder="Новый Проект">
                        </div>

                        <TransitionGroup name="list-anim">
                            <div v-for="layer in layers" :key="layer.id" 
                                 class="relative mb-3 transition-transform duration-200">
                                 
                                <div v-if="newlyAddedId === layer.id" 
                                     class="absolute inset-0 z-50 bg-white/60 pointer-events-none rounded-[1.2rem] animate-flash"></div>
                                <div v-if="restoredId === layer.id" 
                                     class="absolute inset-0 z-50 bg-black/5 pointer-events-none rounded-[1.2rem] animate-pop"></div>

                                <MobileLayerCard 
                                    :layer="layer"
                                    :materials="materials"
                                    :coatings="coatings"
                                    @edit="openEdit(layer, 'layers')"
                                    @remove="removeWithUndo('layers', layer.id)"
                                    @duplicate="handleDuplicateLayer(layer)"
                                />
                            </div>
                        </TransitionGroup>
                        
                        <div v-if="layers.length === 0" class="flex flex-col items-center justify-center py-24 text-gray-300">
                            <span class="text-sm font-bold uppercase tracking-widest opacity-50">Нажмите + чтобы добавить</span>
                        </div>

                        <div v-if="materialConsumption.length > 0" class="mt-8 mb-8">
                            <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-4 border border-white/50 shadow-sm">
                                <h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 ml-1">Расход материалов</h3>
                                <div class="flex flex-wrap gap-2">
                                    <div v-for="mc in materialConsumption" :key="mc.id" class="bg-white rounded-xl px-3 py-2 flex items-center gap-2 border border-gray-100 shadow-sm">
                                        <span class="font-bold text-xs">{{ mc.name }}</span>
                                        <span class="font-black text-xs bg-black text-white px-1.5 rounded-md">{{ mc.sheets }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-else-if="['processing', 'accessories', 'packaging', 'design'].includes(activePage)" :key="activePage" class="space-y-4 min-h-full">
                        <div class="mb-6 mt-2 px-1">
                            <h1 class="font-black tracking-tighter text-black text-4xl leading-tight">{{ currentPageLabel }}</h1>
                        </div>

                        <TransitionGroup name="list-anim">
                            <div v-for="item in (activePage==='processing'?processing:activePage==='accessories'?accessories:activePage==='packaging'?packaging:design)" :key="item.id" 
                                 class="relative overflow-hidden mb-3 rounded-[1.2rem] transition-all duration-200"
                                 @touchstart="onListTouchStart($event, item.id)"
                                 @touchmove="onListTouchMove"
                                 @touchend="onListTouchEnd(activePage, item.id)">
                                
                                <div v-if="newlyAddedId === item.id" 
                                     class="absolute inset-0 z-50 bg-white/60 pointer-events-none rounded-[1.2rem] animate-flash"></div>
                                <div v-if="restoredId === item.id" 
                                     class="absolute inset-0 z-50 bg-black/5 pointer-events-none rounded-[1.2rem] animate-pop"></div>

                                <div class="absolute inset-0 rounded-[1.2rem] bg-gradient-to-l from-neutral-900/90 via-neutral-900/40 to-transparent flex items-center justify-end px-6 z-0">
                                    <div class="flex items-center gap-2 text-white/90 transition-transform origin-right"
                                         :style="{ transform: `scale(${swipedItemId === item.id ? Math.min(1.3, Math.max(1, Math.abs(swipeOffset) / 50)) : 1})` }">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </div>
                                </div>

                                <div class="bg-white rounded-[1.2rem] p-4 shadow-sm border border-gray-100 relative z-10 transition-transform duration-200 active:scale-[0.98] active:bg-gray-50"
                                     :style="{ transform: `translateX(${swipedItemId === item.id ? swipeOffset : 0}px)` }"
                                     @click="openEdit(item, activePage)">
                                    <div class="flex items-center justify-between">
                                        <div class="flex flex-col">
                                            <span class="font-bold text-sm text-gray-900">{{ item.name || 'Выберите...' }}</span>
                                            <span class="text-[11px] font-bold text-gray-400 mt-0.5">
                                                {{
                                                    item.type === 'percent'
                                                        ? `${item.value || 0}%`
                                                        : item.type === 'area_cm2'
                                                            ? `${item.price || 0} ₽/см²`
                                                        : item.type === 'roll'
                                                            ? `${item.price || 0} ₽/пог.м`
                                                            : item.type === 'box_mm'
                                                                ? `${item.price || 0} ₽/м²`
                                                                : `${item.price || 0} ₽`
                                                }}
                                            </span>
                                        </div>
                                        <div class="px-3 py-1 bg-gray-100 rounded-lg text-black font-black text-xs">
                                            x{{ item.qty }}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TransitionGroup>

                        <div v-if="(activePage==='processing'?processing:activePage==='accessories'?accessories:activePage==='packaging'?packaging:design).length === 0" class="flex flex-col items-center justify-center py-24 text-gray-300">
                             <span class="text-sm font-bold uppercase tracking-widest opacity-50">Список пуст</span>
                        </div>
                    </div>

                    <div v-else-if="activePage === 'total'" key="total" class="space-y-6 min-h-full animate-fade-in">
                        <div class="mb-2 mt-2 px-1 flex justify-between items-end">
                            <h1 class="font-black tracking-tighter text-black text-4xl leading-tight">Смета</h1>
                            <button @click="openSettings; impactMedium()" class="mb-1 w-12 h-12 rounded-[1.3rem] flex items-center justify-center bg-white shadow-sm border border-gray-100 text-black active:scale-90 transition-all shrink-0 hover:bg-gray-50">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            </button>
                        </div>

                        <div class="bg-white rounded-[2rem] p-8 shadow-xl shadow-gray-200 border border-white relative overflow-hidden"><div class="absolute -top-20 -right-20 w-64 h-64 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-3xl opacity-60"></div><span class="relative z-10 text-xs font-bold uppercase tracking-widest text-gray-400">К оплате</span><div class="relative z-10 text-6xl font-black text-black mt-2 mb-10 tracking-tighter leading-none">{{ totals.total.toLocaleString() }}<span class="text-3xl text-gray-300 align-top ml-2">₽</span></div><div class="relative z-10 space-y-4 mb-8"><div class="flex justify-between items-center"><span class="text-gray-500 font-medium">Материалы</span><span class="font-bold text-lg">{{ totals.layers.toLocaleString() }}</span></div><div class="flex justify-between items-center"><span class="text-gray-500 font-medium">Услуги</span><span class="font-bold text-lg">{{ totals.processing.toLocaleString() }}</span></div><div class="flex justify-between items-center"><span class="text-gray-500 font-medium">Детали</span><span class="font-bold text-lg">{{ totals.accessories.toLocaleString() }}</span></div></div><div class="relative z-10 bg-gray-50 rounded-2xl p-2 space-y-2"><div class="flex items-center justify-between p-3"><span class="text-[10px] uppercase font-bold text-gray-400 ml-1">Наценка</span><div class="flex items-center bg-white rounded-xl h-10 shadow-sm px-2 border border-gray-100"><button @click="project.markup = Math.max(0, project.markup-5); impactLight()" class="w-10 h-full font-bold text-gray-400 text-lg active:text-black">-</button><span class="text-sm font-black w-10 text-center">{{ project.markup }}%</span><button @click="project.markup += 5; impactLight()" class="w-10 h-full font-bold text-gray-400 text-lg active:text-black">+</button></div></div><div class="flex items-center justify-between p-3"><span class="text-[10px] uppercase font-bold text-gray-400 ml-1">Скидка</span><div class="flex items-center bg-white rounded-xl h-10 shadow-sm px-2 border border-gray-100"><button @click="project.discount = Math.max(0, project.discount-5); impactLight()" class="w-10 h-full font-bold text-gray-400 text-lg active:text-black">-</button><span class="text-sm font-black w-10 text-center">{{ project.discount }}%</span><button @click="project.discount += 5; impactLight()" class="w-10 h-full font-bold text-gray-400 text-lg active:text-black">+</button></div></div></div></div>
                        <div class="grid grid-cols-2 gap-4"><button @click="copyToClipboard" class="h-16 bg-[#111] text-white rounded-[1.5rem] font-bold text-sm tracking-wide shadow-xl active:scale-95 transition-transform flex flex-col items-center justify-center gap-1"><span>Копия</span></button><button @click="confirmReset" class="h-16 bg-white border border-gray-100 text-red-500 rounded-[1.5rem] font-bold text-sm tracking-wide shadow-sm active:scale-95 transition-transform flex flex-col items-center justify-center gap-1"><span>Сброс</span></button></div>
                    </div>
                </Transition>
            </main>

            <Transition name="scale">
                <button v-if="['layers', 'processing', 'accessories', 'packaging', 'design'].includes(activePage) && !showPageMenu && !editingItem" 
                        @click="handleAddNew(activePage)" 
                        class="fixed bottom-24 right-4 w-14 h-14 bg-black text-white rounded-[1.2rem] shadow-2xl shadow-black/40 flex items-center justify-center z-50 active:scale-90 transition-all duration-300 hover:rotate-90 ring-1 ring-white/20"
                >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
            </Transition>
        </div>

        <Transition name="fade">
            <div v-if="showPageMenu || editingItem" 
                 @click="showPageMenu = false; closeEdit()" 
                 class="fixed inset-0 z-[60] bg-black/30 backdrop-blur-md" />
        </Transition>
        
        <Transition name="menu-pop">
            <div v-if="showPageMenu" class="fixed bottom-24 left-4 right-4 z-[70]">
                <div class="bg-white/95 backdrop-blur-2xl rounded-[2rem] p-4 shadow-2xl border border-white/60 ring-1 ring-black/5">
                    
                    <div v-if="currentUser" class="mb-4 p-3 bg-gray-50 rounded-2xl flex items-center gap-3 border border-gray-100">
                        <div class="w-10 h-10 rounded-full bg-[#1d1d1f] text-white flex items-center justify-center font-bold text-sm shadow-md">
                            {{ currentUser.email[0].toUpperCase() }}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Вы вошли как</div>
                            <div class="text-xs font-black text-[#1d1d1f] truncate">{{ currentUser.email }}</div>
                        </div>
                    </div>
                    
                    <div v-else class="mb-4">
                        <button @click="showAuthModal = true" class="w-full h-12 bg-black text-white rounded-2xl font-bold uppercase text-xs tracking-wider shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                            Войти в аккаунт
                        </button>
                    </div>

                    <div class="grid grid-cols-3 gap-3">
                        <button v-for="page in pages" :key="page.id" 
                                @click="switchPage(page.id)"
                                class="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl transition-all active:scale-95 duration-200"
                                :class="activePage === page.id ? 'bg-black text-white shadow-lg shadow-black/20' : 'bg-white/50 text-gray-600 hover:bg-white'">
                            <AnimatedIcon :name="page.icon" :active="activePage === page.id" class="w-6 h-6" :class="activePage === page.id ? 'text-white' : 'text-black'"/>
                            <span class="text-[10px] font-bold uppercase tracking-wider leading-none">{{ page.label }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </Transition>

        <div 
            class="md:hidden fixed bottom-6 left-4 right-4 h-14 z-[50] flex gap-2 items-stretch transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
            :class="[
                showPageMenu ? 'translate-y-1' : '', 
                editingItem ? 'scale-95 opacity-0 pointer-events-none' : 'opacity-100 scale-100'
            ]"
            @touchstart="onBarTouchStart"
            @touchend="onBarTouchEnd"
        >
            <Transition name="bubble-pop">
                <button 
                    v-if="currentIndex > 0"
                    @click.stop="switchPage(pageIds[currentIndex - 1])"
                    class="w-11 h-14 rounded-[2rem] bg-white/70 backdrop-blur-xl border border-white/50 flex items-center justify-center text-gray-500 active:text-black active:bg-white transition-all shadow-sm"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
            </Transition>

            <button 
                @click="showPageMenu = !showPageMenu; impactLight()" 
                class="flex-1 h-14 bg-white/80 backdrop-blur-xl rounded-[2rem] flex flex-col items-center justify-center text-black active:scale-[0.97] transition-all duration-300 border border-white/60 shadow-lg shadow-gray-200/50 relative overflow-hidden group gap-0.5"
            >
                <span class="font-black text-sm tracking-tight">{{ currentPageLabel }}</span>
            </button>

            <Transition name="bubble-pop">
                <button 
                    v-if="currentIndex < pageIds.length - 1"
                    @click.stop="switchPage(pageIds[currentIndex + 1])"
                    class="w-11 h-14 rounded-[2rem] bg-white/70 backdrop-blur-xl border border-white/50 flex items-center justify-center text-gray-500 active:text-black active:bg-white transition-all shadow-sm"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </Transition>

            <button @click="switchPage('total')" class="px-5 bg-[#1d1d1f] rounded-[2rem] flex flex-col items-center justify-center text-white shadow-lg shadow-black/10 active:scale-95 transition-transform duration-300 shrink-0 border border-white/10 relative overflow-hidden h-14">
                <div class="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-50"></div>
                <span class="font-black text-sm tracking-tight relative z-10 whitespace-nowrap">{{ totals.total.toLocaleString() }} <span class="text-[10px] opacity-60 ml-0.5">₽</span></span>
            </button>
        </div>
        
        <div v-if="editingItem" 
             class="fixed bottom-0 inset-x-0 z-[80] flex flex-col max-h-[90vh] will-change-transform"
             :class="sheetIsDragging ? 'transition-none' : 'transition-transform duration-300 cubic-bezier(0.2, 0.8, 0.2, 1)'"
             :style="{ transform: `translateY(${sheetY}px)` }">
            
            <div class="bg-[#F2F2F7] rounded-t-[24px] shadow-2xl flex flex-col overflow-hidden h-full max-h-[90vh]">
                
                <div class="bg-white pt-4 pb-4 flex justify-center shrink-0 border-b border-gray-100 touch-none cursor-grab active:cursor-grabbing"
                     @touchstart="onSheetTouchStart" 
                     @touchmove="onSheetTouchMove" 
                     @touchend="onSheetTouchEnd">
                    <div class="w-10 h-1.5 bg-gray-300 rounded-full"></div>
                </div>

                <div 
                    ref="sheetScrollRef"
                    class="overflow-y-auto p-6 space-y-5 custom-scroll bg-[#F2F2F7] flex-1" 
                    @touchstart="onSheetTouchStart" 
                    @touchmove="onSheetTouchMove" 
                    @touchend="onSheetTouchEnd"
                >
                    
                    <div v-if="editingType === 'layers'" class="flex flex-col gap-4">
                        
                        <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col gap-3">
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Название</label>
                                    <input v-model="editingItem.name" class="w-full text-lg font-black bg-transparent outline-none placeholder-gray-300 text-black truncate" placeholder="Деталь" @focus="selectAll">
                                </div>
                                <div class="flex items-center bg-[#F2F2F7] rounded-xl p-1 gap-2 shrink-0">
                                    <button @click="editingItem.qty = Math.max(1, editingItem.qty-1); impactLight()" class="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center font-bold text-lg active:scale-95 transition-transform">-</button>
                                    <span class="font-black w-6 text-center text-lg">{{ editingItem.qty }}</span>
                                    <button @click="editingItem.qty++; impactLight()" class="w-9 h-9 bg-black text-white rounded-lg shadow-md flex items-center justify-center font-bold text-lg active:scale-95 transition-transform">+</button>
                                </div>
                            </div>
                            <div class="pt-2 border-t border-gray-50">
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Материал</label>
                                <ModernSelect v-model="editingItem.matId" :grouped="materialGroups" placeholder="Выберите материал" class="w-full" />
                            </div>
                        </div>

                        <div class="bg-white rounded-2xl p-2 shadow-sm border border-gray-100 flex items-stretch h-20">
                            <div class="flex-1 flex flex-col items-center justify-center border-r border-gray-100">
                                <input v-model.number="editingItem.w" @input="autoCalcArea" @focus="selectAll" type="number" class="w-full text-center font-black text-xl bg-transparent outline-none" placeholder="Ш">
                                <span class="text-[10px] font-bold text-gray-400 uppercase mt-1">Ширина</span>
                            </div>
                            <div class="flex-1 flex flex-col items-center justify-center border-r border-gray-100">
                                <input v-model.number="editingItem.h" @input="autoCalcArea" @focus="selectAll" type="number" class="w-full text-center font-black text-xl bg-transparent outline-none" placeholder="В">
                                <span class="text-[10px] font-bold text-gray-400 uppercase mt-1">Высота</span>
                            </div>
                            <div class="flex-[1.2] flex flex-col items-center justify-center bg-blue-50/50 rounded-xl m-1">
                                 <input v-model.number="editingItem.area" type="number" @focus="selectAll" class="w-full text-center font-black text-xl bg-transparent outline-none text-blue-600" placeholder="S">
                                 <span class="text-[10px] font-bold text-blue-400 uppercase mt-1">Площадь</span>
                            </div>
                        </div>

                        <div class="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 divide-y divide-gray-50">
                            <div class="p-3 flex items-center justify-between gap-3">
                                <div class="flex items-center gap-2">
                                    <div class="w-7 h-7 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2.69l5.74 5.74-5.74 5.74A8.12 8.12 0 0 1 6.26 12 8.12 8.12 0 0 1 12 2.69z"></path></svg></div>
                                    <span class="text-xs font-bold text-gray-900">Покрытие</span>
                                </div>
                                <div class="flex-1 flex justify-end">
                                    <ModernSelect v-model="editingItem.finishing" :options="[{value: 'none', label: 'Нет'}, ...getFinishingOptions(editingItem.matId)]" placeholder="Нет" />
                                </div>
                            </div>
                            <div class="p-3 flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <div class="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></div>
                                    <span class="text-xs font-bold text-gray-900">Длина реза</span>
                                </div>
                                <div class="flex items-center w-24 bg-gray-50 rounded-lg px-2 py-1">
                                    <input v-model.number="editingItem.cut" @focus="selectAll" type="number" class="w-full text-right font-black text-base bg-transparent outline-none" placeholder="0">
                                    <span class="text-[10px] text-gray-400 font-bold ml-1">мм</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-else class="flex flex-col gap-4">
                         <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                            <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Наименование</label>
                            <ModernSelect v-model="editingItem.dbId" 
                                          :options="editingType==='processing'?processingOptions:editingType==='accessories'?accessoryOptions:editingType==='packaging'?packagingOptions:designOptions" 
                                          @update:modelValue="val => onSelectChange(editingItem, editingType==='processing'?processingDB:editingType==='accessories'?accessoriesDB:editingType==='packaging'?packagingDB:designDB, val)" 
                                          placeholder="Выберите..." />
                        </div>
                        <div v-if="hasSelectedDbItem(editingItem)" class="flex gap-3">
                            <div class="flex-1 min-w-0 bg-white border border-gray-100 h-16 rounded-2xl flex flex-col justify-center px-4 shadow-sm">
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">{{ amountLabel(editingItem.type) }}</label>
                                <div class="flex items-baseline">
                                    <input v-if="usesValueField(editingItem.type)" v-model.number="editingItem.value" @focus="selectAll" type="number" class="w-full bg-transparent font-black outline-none text-xl" placeholder="0">
                                    <div v-else-if="editingType === 'processing' && editingItem.type === 'area_cm2'" class="w-full text-xl font-black text-gray-900">{{ getProcessingSystemPriceValue(editingItem) }}</div>
                                    <input v-else v-model.number="editingItem.price" @focus="selectAll" type="number" class="w-full bg-transparent font-black outline-none text-xl" placeholder="0">
                                    <span v-if="!(editingType === 'processing' && editingItem.type === 'area_cm2')" class="text-xs font-bold text-gray-400 ml-1">{{ editingItem.type === 'percent' ? '%' : '₽' }}</span>
                                </div>
                            </div>
                            <div v-if="editingItem.type !== 'fixed' && editingItem.type !== 'percent'" class="flex-1 min-w-0 flex h-16 bg-white border border-gray-100 rounded-2xl overflow-hidden items-center shadow-sm">
                                <button @click="stepDown(editingItem, 'qty')" class="w-12 h-full flex items-center justify-center font-bold text-xl text-gray-400 active:text-black shrink-0">-</button>
                                <input v-model.number="editingItem.qty" @focus="selectAll" type="number" class="flex-1 w-0 bg-transparent text-center font-black outline-none text-xl">
                                <button @click="stepUp(editingItem, 'qty')" class="w-12 h-full flex items-center justify-center font-bold text-xl text-gray-400 active:text-black shrink-0">+</button>
                            </div>
                        </div>

                        <div v-else class="h-16 rounded-2xl border border-dashed border-gray-200 bg-white px-4 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400 shadow-sm flex items-center justify-center">
                            Сначала выберите позицию из списка
                        </div>

                        <div v-if="hasSelectedDbItem(editingItem) && editingType === 'processing' && (editingItem.type === 'linear' || editingItem.type === 'linear_mm' || editingItem.type === 'roll')" class="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                            <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Длина</label>
                            <div class="flex items-baseline">
                                <input v-model.number="editingItem.length" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] px-4 font-black outline-none" placeholder="0">
                                <span class="text-xs font-bold text-gray-400 ml-2">мм</span>
                            </div>
                        </div>

                        <div v-if="hasSelectedDbItem(editingItem) && editingType === 'processing' && (editingItem.type === 'area' || editingItem.type === 'area_cm2' || editingItem.type === 'area_mm2')" class="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm grid grid-cols-2 gap-2">
                            <div>
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Ширина</label>
                                <input v-model.number="editingItem.w" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] text-center font-black outline-none" placeholder="0">
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Высота</label>
                                <input v-model.number="editingItem.h" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] text-center font-black outline-none" placeholder="0">
                            </div>
                        </div>

                        <div v-if="hasSelectedDbItem(editingItem) && editingType === 'processing' && editingItem.type === 'area_cm2'" class="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                            <label class="text-[10px] font-bold text-gray-400 uppercase block mb-2">Стороны печати</label>
                            <div class="grid grid-cols-2 gap-2">
                                <button type="button" @click="editingItem.sides = 1" class="h-11 rounded-xl border text-sm font-black transition-colors" :class="normalizeSides(editingItem.sides) === 1 ? 'bg-black text-white border-black' : 'bg-[#F2F2F7] text-gray-600 border-transparent'">1 сторона</button>
                                <button type="button" @click="editingItem.sides = 2" class="h-11 rounded-xl border text-sm font-black transition-colors" :class="normalizeSides(editingItem.sides) === 2 ? 'bg-black text-white border-black' : 'bg-[#F2F2F7] text-gray-600 border-transparent'">2 стороны</button>
                            </div>
                        </div>

                        <div v-if="hasSelectedDbItem(editingItem) && editingType === 'packaging' && editingItem.type === 'roll'" class="grid grid-cols-2 gap-3">
                            <div class="bg-white border border-gray-100 h-16 rounded-2xl flex flex-col justify-center px-4 shadow-sm">
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Ширина рулона</label>
                                <div class="flex items-baseline">
                                    <input v-model.number="editingItem.rollWidthMm" @focus="selectAll" type="number" class="w-full bg-transparent font-black outline-none text-xl" placeholder="500">
                                    <span class="text-xs font-bold text-gray-400 ml-1">мм</span>
                                </div>
                            </div>
                            <div class="bg-white border border-gray-100 h-16 rounded-2xl flex flex-col justify-center px-4 shadow-sm">
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Длина</label>
                                <div class="flex items-baseline">
                                    <input v-model.number="editingItem.length" @focus="selectAll" type="number" class="w-full bg-transparent font-black outline-none text-xl" placeholder="0">
                                    <span class="text-xs font-bold text-gray-400 ml-1">мм</span>
                                </div>
                            </div>
                        </div>

                        <div v-if="hasSelectedDbItem(editingItem) && editingType === 'packaging' && editingItem.type === 'box_mm'" class="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm grid grid-cols-3 gap-2">
                            <div>
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Ширина</label>
                                <input v-model.number="editingItem.w" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] text-center font-black outline-none" placeholder="0">
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Длина</label>
                                <input v-model.number="editingItem.l" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] text-center font-black outline-none" placeholder="0">
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">Высота</label>
                                <input v-model.number="editingItem.h" @focus="selectAll" type="number" class="w-full h-11 rounded-xl bg-[#F2F2F7] text-center font-black outline-none" placeholder="0">
                            </div>
                        </div>
                    </div>
                    
                </div>
                
                <div class="p-4 bg-white border-t border-gray-100 shrink-0 pb-8">
                    <button @click="closeEdit" class="w-full h-12 bg-black text-white rounded-2xl font-bold text-sm tracking-wide shadow-lg active:scale-[0.98] transition-transform">
                        Готово
                    </button>
                </div>

            </div>
        </div>

        <transition 
            enter-active-class="transition-transform duration-300 cubic-bezier(0.2, 0.8, 0.2, 1)"
            leave-active-class="transition-transform duration-200 ease-in"
            enter-from-class="translate-y-full"
            leave-to-class="translate-y-full"
        >
        </transition>

        <div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[10000] flex flex-col justify-end items-center gap-3 pointer-events-none pb-2 w-full px-4">
            <TransitionGroup name="toast-stack">
                <div v-for="toast in toasts" :key="toast.id" 
                     class="pointer-events-auto pl-5 pr-1 py-1.5 rounded-full bg-[#1c1c1e] text-white font-medium text-xs shadow-2xl flex items-center justify-between gap-4 border border-white/10 w-fit min-w-[140px] max-w-[200px]">
                    <span class="pl-1 truncate opacity-90 tracking-wide">{{ toast.message }}</span>
                    <button v-if="toast.isUndo" @click="performUndo(toast)" class="h-7 px-3 rounded-full bg-white text-black font-bold text-[10px] uppercase tracking-wider transition-transform active:scale-95 flex items-center justify-center shrink-0 shadow-sm">
                        Вернуть
                    </button>
                </div>
            </TransitionGroup>
        </div>
        
        <Transition name="fade">
            <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @success="onLoginSuccess" />
        </Transition>

    </div>
</template>

<style scoped>
/* Стили те же */
.scale-enter-active, .scale-leave-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.scale-enter-from, .scale-leave-to { transform: scale(0) rotate(-90deg); opacity: 0; }

.list-anim-enter-active { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.list-anim-leave-active { transition: all 0.3s ease-in; position: absolute; width: 100%; z-index: 0; }
.list-anim-enter-from { opacity: 0; transform: translateY(30px) scale(0.95); }
.list-anim-leave-to { opacity: 0; transform: scale(0.9) translateX(-20px); }
.list-anim-move { transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

/* ANIMATION KEYFRAMES (Simple & Classy) */
.animate-flash { animation: simpleFlash 0.6s ease-out forwards; }
@keyframes simpleFlash { 0% { opacity: 0.8; } 100% { opacity: 0; } }

.animate-pop { animation: simplePop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
@keyframes simplePop { 0% { transform: scale(0.95); opacity: 0; } 50% { transform: scale(1.02); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }

/* Menu Pop Animation */
.menu-pop-enter-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.menu-pop-leave-active { transition: all 0.2s ease-in; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: translateY(20px) scale(0.95); }

/* Bubble Pop Animation */
.bubble-pop-enter-active, .bubble-pop-leave-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.bubble-pop-enter-from, .bubble-pop-leave-to { opacity: 0; transform: scale(0.5); width: 0; }

/* Page Flow Animation */
.page-flow-enter-active, .page-flow-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.page-flow-enter-from { opacity: 0; transform: scale(0.98); }
.page-flow-leave-to { opacity: 0; transform: scale(1.02); }

/* Sheet Up Animation */
.sheet-up-enter-active { transition: all 0.5s cubic-bezier(0.32, 0.72, 0, 1); }
.sheet-up-leave-active { transition: all 0.3s ease-in; }
.sheet-up-enter-from, .sheet-up-leave-to { transform: translateY(100%); }

/* Toast Stack Animation (Slide Up) */
.toast-stack-enter-active, .toast-stack-leave-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.toast-stack-enter-from { opacity: 0; transform: translateY(20px) scale(0.9); }
.toast-stack-leave-to { opacity: 0; transform: translateY(-20px) scale(0.9); }
.toast-stack-move { transition: transform 0.4s ease; }

.mobile-dev-modal-enter-active, .mobile-dev-modal-leave-active { transition: opacity 0.22s ease; }
.mobile-dev-modal-enter-from, .mobile-dev-modal-leave-to { opacity: 0; }
</style>