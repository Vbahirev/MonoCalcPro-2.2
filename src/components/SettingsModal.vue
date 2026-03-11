<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useCalculator } from '@/core/useCalculator';
import { useHaptics } from '../composables/useHaptics';
import { useDatabase } from '@/composables/useDatabase';
import ModernSelect from './ModernSelect.vue';
import Tooltip from './Tooltip.vue';

const emit = defineEmits(['close']);
const { materials, coatings, processingDB, accessoriesDB, packagingDB, designDB, settings } = useCalculator();
const { impactLight, impactMedium, notificationError, notificationSuccess } = useHaptics();
const { sendToGoogleSheet } = useDatabase();

// ... (остальной код script без изменений) ...
// Я сохранила всю логику, она тут не меняется, только верстка внизу

const newlyAddedId = ref(null); 
const saveStatus = ref('idle');
const toast = ref({ show: false, message: '', type: 'success', isUndo: false });
const confirmDialog = ref({ show: false, title: '', message: '', onConfirm: null });

// State
const activeMainTab = ref('production'); 
const activeSubTab = ref('materials');
const expandedItemId = ref(null);

// Undo System
const undoState = ref(null);
let undoTimer = null;

// Swipe Logic
const swipedItemId = ref(null);
const swipeOffset = ref(0);
const touchStartX = ref(0);

const onListTouchStart = (e, id) => {
    if (['input', 'select', 'button'].includes(e.target.tagName.toLowerCase())) return;
    touchStartX.value = e.touches[0].clientX;
    swipedItemId.value = id;
};

const onListTouchMove = (e) => {
    if (!swipedItemId.value) return;
    const diff = e.touches[0].clientX - touchStartX.value;
    if (diff < 0) {
        swipeOffset.value = Math.max(-100, diff);
    }
};

const onListTouchEnd = () => {
    if (swipeOffset.value < -60) {
        const item = currentList.value.find(i => i.id === swipedItemId.value);
        if (item) removeWithUndo(item);
    }
    swipeOffset.value = 0;
    swipedItemId.value = null;
};

// Undo Functionality
const removeWithUndo = (item) => {
    const index = currentList.value.findIndex(i => i.id === item.id);
    if (index === -1) return;

    undoState.value = { list: currentList.value, item, index };
    
    currentList.value.splice(index, 1);
    notificationError();
    showToast('Удалено', 'success', true);

    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        undoState.value = null;
        toast.value.show = false;
    }, 5000);
};

const performUndo = () => {
    if (!undoState.value) return;
    
    const { list, item, index } = undoState.value;
    list.splice(index, 0, item);
    
    undoState.value = null;
    clearTimeout(undoTimer);
    
    notificationSuccess();
    showToast('Восстановлено', 'success', false);
};

// Tabs Config
const mainTabs = [
    { id: 'production', label: 'Производство' },
    { id: 'extras', label: 'Опции и Товары' },
    { id: 'config', label: 'Параметры' }
];

const subTabsMap = {
    production: [
        { id: 'materials', label: 'Материалы' },
        { id: 'coatings', label: 'Покрытия' },
        { id: 'processing', label: 'Пост-обработка' }
    ],
    extras: [
        { id: 'accessories', label: 'Фурнитура' },
        { id: 'design', label: 'Дизайн' },
        { id: 'packaging', label: 'Упаковка' }
    ],
    config: [
        { id: 'global', label: 'Глобальные настройки' }
    ]
};

const operationTypes = [
    { value: 'fixed', label: 'Фикс.' },
    { value: 'pieces', label: 'Штука' },
    { value: 'percent', label: 'Процент' },
    { value: 'linear', label: 'Погонаж (м)' },
    { value: 'area', label: 'Площадь (м²)' },
    { value: 'roll', label: 'Рулон' }
];
const materialThicknessOptions = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20].map(value => ({
    value,
    label: `${value} мм`
}));

watch(activeMainTab, (newVal) => {
    if(subTabsMap[newVal] && subTabsMap[newVal].length > 0) {
        activeSubTab.value = subTabsMap[newVal][0].id;
    }
    expandedItemId.value = null;
    impactLight();
});

const currentSubTabs = computed(() => subTabsMap[activeMainTab.value]);

const currentList = computed(() => {
    switch (activeSubTab.value) {
        case 'materials': return materials.value;
        case 'coatings': return coatings.value;
        case 'processing': return processingDB.value;
        case 'accessories': return accessoriesDB.value;
        case 'packaging': return packagingDB.value;
        case 'design': return designDB.value;
        default: return [];
    }
});

const sectionTitle = computed(() => {
    if (activeMainTab.value === 'config') return 'Параметры расчета';
    if (activeMainTab.value === 'production') return 'База материалов';
    return 'Список элементов';
});

const toggleExpand = (id) => {
    impactLight();
    expandedItemId.value = expandedItemId.value === id ? null : id;
};

const toggleItemStatus = (item) => {
    impactLight();
    if (typeof item.inStock === 'boolean') {
        item.inStock = !item.inStock;
    } else if (typeof item.active === 'boolean') {
        item.active = !item.active;
    } else {
        if (['materials', 'coatings', 'accessories'].includes(activeSubTab.value)) {
            item.inStock = true; 
        } else {
            item.active = true;
        }
    }
};

const getAppMode = (item) => {
    if (item.forAcrylic === undefined) item.forAcrylic = true;
    if (item.forWood === undefined) item.forWood = true;
    if (item.forAcrylic && item.forWood) return 'all';
    if (item.forAcrylic && !item.forWood) return 'acrylic';
    if (!item.forAcrylic && item.forWood) return 'wood';
    return 'all';
};

const setAppMode = (item, mode) => {
    if (mode === 'all') { item.forAcrylic = true; item.forWood = true; }
    else if (mode === 'acrylic') { item.forAcrylic = true; item.forWood = false; }
    else if (mode === 'wood') { item.forAcrylic = false; item.forWood = true; }
};

// Drag & Drop
const draggableRowId = ref(null);
const dragIndex = ref(null);
const lastMouseY = ref(0);
const scrollContainerRef = ref(null);
let autoScrollFrame = null;

const performAutoScroll = () => {
    if (dragIndex.value === null || !scrollContainerRef.value) {
        cancelAnimationFrame(autoScrollFrame);
        return;
    }
    const { top, bottom } = scrollContainerRef.value.getBoundingClientRect();
    const mouseY = lastMouseY.value;
    const threshold = 100; 
    const maxSpeed = 15; 
    if (mouseY < top + threshold) {
        const intensity = Math.max(0, (top + threshold - mouseY) / threshold);
        scrollContainerRef.value.scrollTop -= maxSpeed * intensity;
    } else if (mouseY > bottom - threshold) {
        const intensity = Math.max(0, (mouseY - (bottom - threshold)) / threshold);
        scrollContainerRef.value.scrollTop += maxSpeed * intensity;
    }
    autoScrollFrame = requestAnimationFrame(performAutoScroll);
};

const enableDrag = (id) => { draggableRowId.value = id; };
const disableDrag = () => { draggableRowId.value = null; };

const onDragStart = (e, index) => {
    dragIndex.value = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    performAutoScroll();
    impactMedium();
};

const onDragEnd = () => {
    dragIndex.value = null;
    draggableRowId.value = null;
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
};

const onDragOver = (e, index) => {
    lastMouseY.value = e.clientY;
    if (dragIndex.value === null || dragIndex.value === index) return;
    const row = e.target.closest('.draggable-row');
    if (!row) return;
    
    const item = currentList.value.splice(dragIndex.value, 1)[0];
    currentList.value.splice(index, 0, item);
    dragIndex.value = index;
    impactLight();
};

onUnmounted(() => { if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame); });

const addItem = async () => {
    impactMedium();
    const ts = Date.now();
    let newItem = {};
    if (activeSubTab.value === 'materials') {
        newItem = { id: `mat_${ts}`, inStock: true, type: '', name: '', thickness: null, sheetW: null, sheetH: null, sheetPrice: null, speed: 20 };
    } else if (activeSubTab.value === 'coatings') {
        newItem = { id: `coat_${ts}`, name: '', price: null, inStock: true, forAcrylic: true, forWood: true };
    } else if (activeSubTab.value === 'accessories') {
        newItem = { id: `acc_${ts}`, name: '', price: null, inStock: true };
    } else if (activeSubTab.value === 'processing') {
        newItem = { id: `srv_${ts}`, name: '', type: 'fixed', value: null, price: null, active: true, rollWidth: null };
    } else {
        const defaultType = activeSubTab.value === 'packaging' ? 'pieces' : 'fixed';
        newItem = { id: `srv_${ts}`, name: '', type: defaultType, value: null, price: null, active: true };
    }
    currentList.value.unshift(newItem);
    newlyAddedId.value = newItem.id;
    expandedItemId.value = newItem.id;
    
    // Scroll to top
    if(scrollContainerRef.value) {
         scrollContainerRef.value.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    setTimeout(() => { newlyAddedId.value = null; }, 1000);
};

// Kept for desktop compatibility if needed
const requestDelete = (item) => {
    removeWithUndo(item);
};

const showToast = (msg, type = 'success', isUndo = false) => {
    toast.value = { show: true, message: msg, type, isUndo };
    if (!isUndo) {
        setTimeout(() => { toast.value.show = false; }, 3000);
    }
};

const saveAllChanges = async () => {
    saveStatus.value = 'loading'; 
    impactMedium();

    try {
        const megaPayload = {
            'Settings': settings.value,
            'Materials': materials.value,
            'Coatings': coatings.value,
            'Processing': processingDB.value,
            'Accessories': accessoriesDB.value,
            'Packaging': packagingDB.value,
            'Design': designDB.value
        };

        // Пароль/PIN больше не участвует в авторизации: права определяются ролью пользователя.
        const result = await sendToGoogleSheet('syncAll', 'All', megaPayload);
        
        if(result.status === 'success') {
            saveStatus.value = 'success'; 
            notificationSuccess();
            setTimeout(() => { 
                saveStatus.value = 'idle'; 
            }, 2000);
        } else {
            throw new Error(result.message);
        }

    } catch (error) {
        console.error(error);
        saveStatus.value = 'error'; 
        showToast(error.message || 'Ошибка', 'error');
        notificationError();
        setTimeout(() => { saveStatus.value = 'idle'; }, 3000);
    }
};

const saveButtonConfig = computed(() => {
    switch (saveStatus.value) {
        case 'loading': 
            return { text: 'Сохр...', class: 'bg-black text-white' };
        case 'success': 
            return { text: 'Готово', class: 'bg-black text-white' };
        case 'error': 
            return { text: 'Ошибка', class: 'bg-red-500 text-white' };
        default: 
            return { text: 'Сохранить', class: 'bg-black text-white' };
    }
});
</script>

<template>
    <div class="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90] flex items-center justify-center p-0 md:p-4 text-[#18181B] font-sans" @click.self="$emit('close')">
        
        <div class="bg-white w-full h-full md:h-[90vh] md:max-w-5xl md:rounded-[32px] shadow-2xl flex flex-col overflow-hidden relative border border-gray-100 dark:border-white/10">
            
            <div class="md:hidden fixed top-4 left-4 right-4 z-40 bg-white/60 backdrop-blur-xl rounded-[2rem] shadow-sm border border-white/40 ring-1 ring-black/5 px-5 py-4 transition-all">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-2xl font-black tracking-tight truncate">Настройки</h2>
                    <div class="flex items-center bg-gray-100/50 rounded-full pl-3 pr-2 h-9 border border-white/50">
                        <svg class="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 0 02-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                </div>

                <div class="bg-gray-100/50 p-1 rounded-xl flex gap-1 mb-3 overflow-x-auto no-scrollbar">
                    <button v-for="tab in mainTabs" :key="tab.id"
                        @click="activeMainTab = tab.id"
                        class="flex-1 py-2 px-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 text-center whitespace-nowrap shadow-sm"
                        :class="activeMainTab === tab.id ? 'bg-white text-black scale-[1.02]' : 'text-gray-400 hover:text-gray-600'">
                        {{ tab.label }}
                    </button>
                </div>

                <div v-if="activeMainTab !== 'config'" class="flex gap-1 bg-gray-50/50 p-1 rounded-lg border border-white/50 overflow-x-auto w-full no-scrollbar justify-center">
                    <button v-for="st in currentSubTabs" :key="st.id" @click="activeSubTab = st.id; impactLight()"
                        class="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all whitespace-nowrap flex-1 text-center"
                        :class="activeSubTab === st.id ? 'bg-[#18181B] text-white shadow-lg' : 'text-gray-400 hover:bg-gray-200/50 hover:text-gray-600'">
                        {{ st.label }}
                    </button>
                </div>
            </div>

            <div class="hidden md:block px-5 pt-5 pb-2 shrink-0 bg-white z-10 relative border-b border-gray-100">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-2xl font-black tracking-tight truncate">Настройки</h2>
                    <div class="flex items-center gap-2">
                         <div class="flex items-center bg-gray-100 rounded-full pl-3 pr-2 h-9 border border-transparent focus-within:border-black/10 focus-within:bg-white focus-within:shadow-sm transition-all">
                        </div>
                        <button @click="$emit('close')" class="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-all">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                 <div class="bg-gray-100 p-1 rounded-xl flex gap-1 mb-4 overflow-x-auto no-scrollbar">
                    <button v-for="tab in mainTabs" :key="tab.id" @click="activeMainTab = tab.id" class="flex-1 py-2 px-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 text-center whitespace-nowrap" :class="activeMainTab === tab.id ? 'bg-white text-black shadow-sm scale-[1.02]' : 'text-gray-400 hover:text-gray-600'">{{ tab.label }}</button>
                </div>
                 <div class="flex items-center justify-between gap-4 py-2 min-h-[50px]">
                    <h3 class="font-bold text-lg uppercase tracking-tight min-w-[150px]">{{ sectionTitle }}</h3>
                    <div v-if="activeMainTab !== 'config'" class="flex gap-1 bg-gray-50 p-1 rounded-lg border border-gray-100 overflow-x-auto no-scrollbar justify-center">
                        <button v-for="st in currentSubTabs" :key="st.id" @click="activeSubTab = st.id; impactLight()" class="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all whitespace-nowrap" :class="activeSubTab === st.id ? 'bg-[#18181B] text-white shadow-lg' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'">{{ st.label }}</button>
                    </div>
                    <div class="min-w-[100px] flex justify-end"><button v-if="activeMainTab !== 'config'" @click="addItem" class="bg-[#18181B] text-white pl-3 pr-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-black shadow-lg active:scale-95 transition-all flex items-center gap-2"><span class="text-lg leading-none font-light">+</span> Добавить</button></div>
                </div>
            </div>

            <div 
                ref="scrollContainerRef" 
                class="h-full overflow-y-auto custom-scroll px-4 md:px-8 pt-56 pb-44 md:pt-4 md:pb-40"
                style="-webkit-mask-image: linear-gradient(to bottom, transparent 0px, transparent 60px, black 160px, black calc(100% - 160px), transparent calc(100% - 60px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0px, transparent 60px, black 160px, black calc(100% - 160px), transparent calc(100% - 60px), transparent 100%);"
            >
                
                <Transition name="main-fade" mode="out-in">
                    
                    <div v-if="activeMainTab === 'config'" key="config" class="space-y-6">
                         <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                            <div class="bg-gray-50 rounded-2xl p-5 border border-transparent hover:border-gray-200 transition-colors flex flex-col justify-between group">
                                <div>
                                    <div class="flex justify-between items-start mb-3">
                                        <div class="flex items-center gap-1.5">
                                            <label class="text-[10px] font-bold uppercase text-gray-500">Коэф. отходов</label>
                                            <Tooltip text="Учитывает технические поля..."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></Tooltip>
                                        </div>
                                        <span class="text-xl font-black">{{ settings.wastage }}</span>
                                    </div>
                                    <input type="range" :value="settings.wastage" @input="settings.wastage = parseFloat($event.target.value)" min="1" max="2" step="0.01" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black mb-2">
                                </div>
                                <p class="text-[10px] text-gray-400 mt-2 leading-snug">Запас стоимости материала.</p>
                            </div>
                            
                             <div class="bg-gray-50 rounded-2xl p-5 border border-transparent hover:border-gray-200 transition-colors flex flex-col justify-between group">
                                <div>
                                    <div class="flex justify-between items-start mb-3">
                                        <div class="flex items-center gap-1.5">
                                            <label class="text-[10px] font-bold uppercase text-gray-500">Запас раскроя</label>
                                            <Tooltip text="Процент запаса площади..."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></Tooltip>
                                        </div>
                                        <span class="text-xl font-black">{{ settings.sheetMarginPercent || 0 }}%</span>
                                    </div>
                                    <input type="range" :value="settings.sheetMarginPercent || 0" @input="settings.sheetMarginPercent = parseInt($event.target.value)" min="0" max="50" step="1" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black mb-2">
                                </div>
                            </div>
                             <div class="bg-gray-50 rounded-2xl p-5 border border-transparent hover:border-gray-200 transition-colors flex flex-col justify-between group">
                                <div><label class="text-[10px] font-bold uppercase text-gray-500 block mb-2">Лазер (мин)</label><div class="flex items-center bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm focus-within:border-black"><input type="number" v-model.number="settings.laserMinuteCost" class="w-full bg-transparent outline-none font-bold text-base"><span class="text-gray-400 font-bold">₽</span></div></div>
                            </div>
                             <div class="bg-gray-50 rounded-2xl p-5 border border-transparent hover:border-gray-200 transition-colors flex flex-col justify-between group">
                                <div><label class="text-[10px] font-bold uppercase text-gray-500 block mb-2">Гравировка (см²)</label><div class="flex items-center bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm focus-within:border-black"><input type="number" v-model.number="settings.engravingPrice" class="w-full bg-transparent outline-none font-bold text-base"><span class="text-gray-400 font-bold">₽</span></div></div>
                            </div>
                        </div>
                    </div>

                    <div v-else :key="activeMainTab" class="w-full">
                         <div v-if="currentList.length">
                            <TransitionGroup name="drag-list" tag="div" class="space-y-3 md:space-y-0">
                                <div v-for="(item, index) in currentList" :key="item.id" 
                                    :draggable="draggableRowId === item.id"
                                    @dragstart="onDragStart($event, index)"
                                    @dragover.prevent="onDragOver($event, index)"
                                    @dragend="onDragEnd"
                                    
                                    class="draggable-row relative overflow-hidden bg-white md:bg-transparent rounded-2xl md:rounded-none border border-gray-100 md:border-0 md:border-b md:border-gray-50 transition-colors group z-0 shadow-sm md:shadow-none"
                                    
                                    @touchstart="onListTouchStart($event, item.id)"
                                    @touchmove="onListTouchMove"
                                    @touchend="onListTouchEnd"
                                    
                                    :class="{
                                        'animate-insert': item.id === newlyAddedId,
                                        'animate-delete': deletingIds?.has(item.id),
                                        'overflow-hidden': item.id === newlyAddedId || deletingIds?.has(item.id),
                                        'is-drag-placeholder': dragIndex === index,
                                        'md:hover:bg-gray-50': dragIndex !== index,
                                        'opacity-60 grayscale': (item.inStock === false) || (item.active === false),
                                        'grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-3': true
                                    }">
                                    
                                    <div class="md:hidden absolute inset-0 bg-gray-200 flex items-center justify-end px-6 z-0 rounded-2xl">
                                        <span class="text-gray-500 font-black uppercase text-xs tracking-widest">Удалить</span>
                                    </div>

                                    <div class="contents md:contents relative z-10 bg-white transition-transform duration-200 rounded-2xl" 
                                            :style="{ transform: `translateX(${swipedItemId === item.id ? swipeOffset : 0}px)` }">

                                        <div class="md:hidden flex items-center justify-between w-full relative z-10 bg-white p-2 rounded-2xl" @click="toggleExpand(item.id)">
                                            <div class="flex items-center gap-3 overflow-hidden">
                                                <div class="drag-handle w-8 h-8 flex items-center justify-center cursor-move text-gray-300 active:text-black transition-colors rounded hover:bg-gray-100 touch-none" @mouseenter="enableDrag(item.id)" @mouseleave="disableDrag" @click.stop>
                                                    <svg class="pointer-events-none" width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                                                </div>
                                                <div class="font-bold text-sm truncate max-w-[200px]">{{ item.name || 'Без названия' }}</div>
                                            </div>
                                            
                                            <div class="flex items-center gap-3">
                                                <div class="w-6 h-6 flex items-center justify-center text-gray-400 transition-transform duration-300" :class="expandedItemId === item.id ? 'rotate-180' : ''">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="col-span-1 flex justify-center order-2 md:order-none" :class="expandedItemId === item.id ? 'flex pt-4 border-t border-gray-50' : 'hidden md:flex'">
                                                <div class="md:hidden text-[10px] font-bold uppercase text-gray-400 mr-auto flex items-center">Активность</div>
                                                <div class="relative cursor-pointer" @click="toggleItemStatus(item)">
                                                <input type="checkbox" :checked="item.inStock || item.active" class="peer appearance-none w-5 h-5 border-2 border-gray-200 rounded bg-white checked:bg-black checked:border-black transition-colors cursor-pointer">
                                                <svg class="absolute top-1 left-1 w-3 h-3 text-white pointer-events-none hidden peer-checked:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M5 13l4 4L19 7"></path></svg>
                                            </div>
                                        </div>

                                        <div class="col-span-1 hidden md:flex justify-center items-center">
                                            <div class="drag-handle w-full h-8 flex items-center justify-center cursor-move text-gray-300 hover:text-black transition-colors rounded hover:bg-gray-100" @mouseenter="enableDrag(item.id)" @mouseleave="disableDrag">
                                                <svg class="pointer-events-none" width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                                            </div>
                                        </div>

                                        <div class="contents" :class="expandedItemId === item.id ? '!block w-full space-y-3 relative z-10 bg-white px-2 pb-2' : 'hidden md:contents'">
                                            
                                            <div :class="['materials', 'coatings'].includes(activeSubTab) ? 'md:col-span-3' : 'md:col-span-4'">
                                                <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Название</label>
                                                <input v-model.lazy="item.name" class="w-full bg-gray-50 md:bg-transparent px-3 md:px-0 py-2 md:py-1 rounded-lg md:rounded-none border-0 md:border-b md:border-transparent focus:border-black md:focus:border-gray-200 outline-none font-bold text-sm transition-colors" placeholder="Название">
                                                <input v-if="activeSubTab === 'materials'" v-model.lazy="item.type" class="w-full text-[10px] text-gray-400 bg-transparent border-none outline-none mt-1 md:mt-0.5 px-3 md:px-0" placeholder="Категория (код)">
                                            </div>

                                            <div v-if="activeSubTab === 'materials'" class="md:col-span-2">
                                                <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Размер листа (мм)</label>
                                                <div class="flex items-center justify-start md:justify-center w-full gap-2">
                                                    <input v-model.lazy.number="item.sheetW" class="w-full md:w-12 text-sm md:text-xs text-center bg-gray-50 border border-gray-100 rounded py-2 md:py-1 outline-none font-bold focus:border-black transition-colors" placeholder="Ш"><span class="text-gray-300 text-[10px]">✕</span><input v-model.lazy.number="item.sheetH" class="w-full md:w-12 text-sm md:text-xs text-center bg-gray-50 border border-gray-100 rounded py-2 md:py-1 outline-none font-bold focus:border-black transition-colors" placeholder="В">
                                                </div>
                                            </div>

                                            <div v-if="activeSubTab === 'materials'" class="md:col-span-2">
                                                <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Толщина (мм)</label>
                                                <ModernSelect v-model="item.thickness" :options="materialThicknessOptions" placeholder="Толщина" class="w-full !h-10 md:!h-8" />
                                            </div>
                                            
                                            <div v-if="activeSubTab === 'materials'" class="md:col-span-1">
                                                <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Скор. (мм/с)</label>
                                                <div class="flex items-center bg-gray-100 border border-gray-200 rounded-lg px-1 py-1 focus-within:border-black transition-colors w-full md:w-14 justify-center"><input v-model.lazy.number="item.speed" class="w-full text-center bg-transparent outline-none font-bold text-sm md:text-xs" placeholder="20"></div>
                                            </div>

                                            <div v-if="activeSubTab === 'coatings'" class="md:col-span-3 flex justify-start md:justify-center">
                                                <div class="w-full md:max-w-[200px]">
                                                    <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Тип материала</label>
                                                    <div class="flex bg-gray-100 rounded-lg p-0.5 relative h-9 md:h-7 w-full cursor-pointer select-none">
                                                        <div class="absolute top-0.5 bottom-0.5 rounded shadow-sm bg-white transition-all duration-300 ease-out border border-gray-200 z-0" :style="{ left: getAppMode(item) === 'acrylic' ? '2px' : getAppMode(item) === 'wood' ? 'calc(66.6% + 0px)' : 'calc(33.3% + 1px)', width: 'calc(33.3% - 2px)' }"></div>
                                                        <div @click="setAppMode(item, 'acrylic')" class="flex-1 flex items-center justify-center text-[10px] md:text-[8px] font-bold uppercase tracking-tight z-10 relative transition-colors" :class="getAppMode(item) === 'acrylic' ? 'text-black' : 'text-gray-400'">АКРИЛ</div>
                                                        <div @click="setAppMode(item, 'all')" class="flex-1 flex items-center justify-center text-[10px] md:text-[8px] font-bold uppercase tracking-tight z-10 relative transition-colors" :class="getAppMode(item) === 'all' ? 'text-black' : 'text-gray-400'">ВСЕ</div>
                                                        <div @click="setAppMode(item, 'wood')" class="flex-1 flex items-center justify-center text-[10px] md:text-[8px] font-bold uppercase tracking-tight z-10 relative transition-colors" :class="getAppMode(item) === 'wood' ? 'text-black' : 'text-gray-400'">ФАНЕРА</div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div v-if="!['materials', 'coatings'].includes(activeSubTab)" class="md:col-span-2">
                                                <div v-if="activeSubTab === 'processing'" class="w-full flex flex-col md:flex-row items-start md:items-center justify-center gap-2">
                                                    <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Тип расчета</label>
                                                    <div class="flex flex-col w-full">
                                                        <ModernSelect v-model="item.type" :options="operationTypes" placeholder="Тип" class="w-full" />
                                                        <input v-if="item.type === 'roll'" v-model.lazy.number="item.rollWidth" placeholder="Шир.рул(мм)" class="w-full text-center text-xs border-b border-gray-200 outline-none bg-transparent focus:border-black font-bold mt-1">
                                                    </div>
                                                </div>
                                                <span v-else class="text-[10px] font-bold text-gray-400 uppercase tracking-tight flex items-center h-8">
                                                    {{ activeSubTab === 'accessories' ? 'ЗА ШТ.' : activeSubTab === 'packaging' ? 'ЗА ШТ.' : activeSubTab === 'design' ? 'ФИКС.' : (item.type === 'fixed' ? 'Фикс.' : item.type === 'pieces' ? 'За шт.' : item.type === 'percent' ? 'Процент' : 'За м²') }}
                                                </span>
                                            </div>

                                            <div class="md:col-span-2">
                                                <label class="md:hidden text-[10px] font-bold uppercase text-gray-400 mb-1 block">Цена / Значение</label>
                                                <div class="flex items-center bg-gray-100 border border-gray-200 rounded-lg px-2 py-2 md:py-1 focus-within:border-black transition-colors w-full md:w-24 justify-center">
                                                    <input v-if="activeSubTab === 'materials'" v-model.lazy.number="item.sheetPrice" class="w-full text-center bg-transparent outline-none font-bold text-sm md:text-xs">
                                                    <input v-else-if="activeSubTab === 'coatings' || activeSubTab === 'accessories' || item.type === 'pieces' || item.type === 'linear' || item.type === 'area' || item.type === 'roll'" v-model.lazy.number="item.price" class="w-full text-center bg-transparent outline-none font-bold text-sm md:text-xs" :placeholder="item.type === 'roll' ? '₽/м.п' : ''">
                                                    <input v-else v-model.lazy.number="item.value" class="w-full text-center bg-transparent outline-none font-bold text-sm md:text-xs">
                                                    <span class="text-gray-400 text-[9px] font-bold ml-1 whitespace-nowrap">
                                                        {{ activeSubTab === 'coatings' ? '₽/ед.' : item.type === 'percent' ? '%' : item.type === 'linear' ? '₽/м' : item.type === 'area' ? '₽/м²' : item.type === 'roll' ? '₽/мп' : '₽' }}
                                                    </span>
                                                </div>
                                            </div>

                                            <div class="md:col-span-2 flex justify-center items-center pt-2 md:pt-0">
                                                <span class="md:hidden text-[9px] font-bold text-gray-300 uppercase tracking-widest">Смахните влево чтобы удалить</span>
                                                
                                                <button @click="removeWithUndo(item)" class="hidden md:block w-full md:w-auto px-4 py-1.5 rounded-lg bg-gray-100 text-[10px] font-black uppercase text-gray-500 hover:bg-[#18181B] hover:text-white transition-all active:scale-95">Удалить</button>
                                            </div>
                                        </div>
                                    </div> </div>
                            </TransitionGroup>
                        </div>
                        <div v-else class="p-10 text-center"><p class="text-gray-400 text-sm">Список пуст</p></div>
                    </div>
                </Transition>

            </div>

            <div class="md:hidden fixed bottom-6 left-4 right-4 h-14 bg-white/60 backdrop-blur-xl rounded-[2rem] flex items-center justify-between px-2 z-[60] shadow-sm border border-white/40 ring-1 ring-black/5 gap-2">
                <button @click="$emit('close'); impactLight()" class="w-12 h-12 rounded-full flex items-center justify-center text-black active:bg-black/5 transition-colors shrink-0 bg-white/50">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                </button>

                <button 
                    @click="saveAllChanges" 
                    :disabled="saveStatus === 'loading'" 
                    class="flex-1 h-12 bg-black rounded-[1.6rem] flex items-center justify-center gap-2 text-white shadow-lg active:scale-95 transition-transform duration-300"
                    :class="saveButtonConfig.class"
                >
                     <span v-if="saveStatus === 'loading'" class="w-4 h-4 border-2 border-t-current border-gray-300 rounded-full animate-spin"></span>
                     <span class="font-bold text-sm tracking-tight">{{ saveButtonConfig.text }}</span>
                </button>
            </div>

            <div class="absolute bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-md border-t border-white/50 z-20 pointer-events-none hidden md:block">
                <button 
                    @click="saveAllChanges" 
                    :disabled="saveStatus === 'loading'" 
                    class="pointer-events-auto w-full py-4 rounded-xl font-bold uppercase text-sm shadow-2xl transition-all active:scale-[0.99] tracking-widest flex items-center justify-center gap-2"
                    :class="saveButtonConfig.class"
                >
                    <span v-if="saveStatus === 'loading'" class="w-4 h-4 border-2 border-t-current border-gray-300 rounded-full animate-spin"></span>
                    <span>{{ saveButtonConfig.text }}</span>
                </button>
            </div>
            
            <Transition name="toast">
                <div v-if="toast.show" class="absolute top-6 left-1/2 -translate-x-1/2 z-[70] pl-6 pr-2 py-2 rounded-full bg-black/80 backdrop-blur-xl text-white font-bold text-xs shadow-2xl flex items-center gap-4 border border-white/10"
                     :class="toast.type === 'error' ? 'bg-[#18181B]/90 text-white' : 'bg-[#18181B]/90 text-white'">
                    <span>{{ toast.message }}</span>
                    <button v-if="toast.isUndo" @click="performUndo" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-full transition-colors text-[10px] uppercase tracking-widest text-yellow-300">Вернуть</button>
                </div>
            </Transition>

            <Teleport to="body">
                <Transition name="modal-fade">
                    <div v-if="confirmDialog.show" class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="confirmDialog.show = false">
                        <div class="bg-white rounded-[2rem] shadow-2xl border border-gray-100 p-6 max-w-sm w-full mx-4 transform transition-all scale-100 relative">
                            <h3 class="text-lg font-black mb-2">{{ confirmDialog.title }}</h3>
                            <p class="text-sm text-gray-500 mb-6 leading-relaxed">{{ confirmDialog.message }}</p>
                            <div class="flex gap-3">
                                <button @click="confirmDialog.show = false" class="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider">Отмена</button>
                                
                                <button @click="confirmDialog.onConfirm" class="flex-1 py-3 rounded-xl font-bold bg-[#18181B] text-white hover:bg-black shadow-lg shadow-gray-400/30 transition-all text-xs uppercase tracking-wider">Удалить</button>
                            </div>
                        </div>
                    </div>
                </Transition>
            </Teleport>

        </div>
    </div>
</template>

<style scoped>
/* Styles unchanged */

@keyframes insertRow {
    0% { opacity: 0; transform: translateY(-20px) scale(0.95); max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; background-color: #f3f4f6; }
    40% { opacity: 1; transform: translateY(0) scale(1); max-height: 200px; padding-top: 1rem; padding-bottom: 1rem; background-color: #e5e7eb; }
    100% { background-color: transparent; max-height: 500px; padding-top: 0.75rem; padding-bottom: 0.75rem; }
}
.animate-insert { animation: insertRow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

@keyframes deleteRow {
    0% { opacity: 1; transform: scale(1); max-height: 200px; padding-top: 1rem; padding-bottom: 1rem; border-bottom-width: 1px; }
    100% { opacity: 0; transform: scale(0.9) translateX(20px); max-height: 0; padding-top: 0; padding-bottom: 0; border-bottom-width: 0; margin: 0; }
}
.animate-delete { animation: deleteRow 0.3s ease-out forwards; transform-origin: right center; pointer-events: none; z-index: 0; }

.drag-list-move { transition: transform 0.35s cubic-bezier(0.25, 1, 0.5, 1); }
.is-drag-placeholder { background: #F9FAFB; border: 2px dashed #E5E7EB; opacity: 0.6; z-index: 0; }
.is-drag-placeholder > * { opacity: 0.3; }

.main-fade-enter-active, .main-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.main-fade-enter-from { opacity: 0; transform: translateY(5px); }
.main-fade-leave-to { opacity: 0; transform: translateY(-5px); }

.list-fade-enter-active, .list-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.list-fade-enter-from { opacity: 0; transform: translateY(4px); }
.list-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.toast-enter-active, .toast-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -20px); }

.scale-enter-active, .scale-leave-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.scale-enter-from, .scale-leave-to { transform: scale(0) rotate(-90deg); opacity: 0; }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .transform, .modal-fade-leave-active .transform { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.modal-fade-enter-from .transform { transform: scale(0.95) translateY(10px); }
.modal-fade-leave-to .transform { transform: scale(0.95) translateY(10px); }

/* Ensure dragged items don't trigger clicks on mobile */
.drag-handle { touch-action: none; }
</style>