<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCalculator } from '@/core/useCalculator';
import { useHaptics } from '@/composables/useHaptics';
import { PageScrollWrapper } from '@/ui-core';
import ModernSelect from '@/components/ModernSelect.vue';
import { buildDeepSearchBlob, matchesSearchBlob } from '@/utils/searchIndex';

const router = useRouter();
const route = useRoute();
const { settings, getCloudHistory, loadState, deleteFromHistory, totals, hasPermission } = useCalculator('laser');
const { impactLight, impactMedium, notificationSuccess, notificationError } = useHaptics();
const DTF_HISTORY_LOAD_KEY = 'monocalc_dtf_history_load_state_v1';

const queryCalcId = computed(() => {
    const raw = route.query.calc;
    if (Array.isArray(raw)) return raw[0] || 'laser';
    return raw || 'laser';
});

// --- ПРАВА ---
const canBulkDelete = computed(() => {
    try { return hasPermission('history.bulkDelete'); } catch(e) { return false; }
});

// --- СОСТОЯНИЕ ---
const projects = ref([]);
const isLoading = ref(true);
const isLoadingMore = ref(false);
const error = ref(null);
const searchQuery = ref('');
const windowWidth = ref(window.innerWidth);
const confirmModal = ref({ show: false, type: null, item: null });
const deletingProjectId = ref(null);

// --- ПАКЕТНОЕ УДАЛЕНИЕ ---
const isSelectionMode = ref(false);
const selectedIds = ref(new Set());
const isBulkDeleting = ref(false);

const toggleSelectionMode = () => {
    impactLight();
    isSelectionMode.value = !isSelectionMode.value;
    if (!isSelectionMode.value) selectedIds.value.clear();
};

const toggleSelection = (project) => {
    if (!isSelectionMode.value) return;
    impactLight();
    const newSet = new Set(selectedIds.value);
    if (newSet.has(project.id)) newSet.delete(project.id);
    else newSet.add(project.id);
    selectedIds.value = newSet;
};

const selectAllCurrent = () => {
    impactLight();
    const nextSet = new Set();
    filteredProjects.value.forEach(p => { if (!p.isPlaceholder) nextSet.add(p.id); });
    selectedIds.value = nextSet;
};

const clearSelection = () => {
    impactLight();
    selectedIds.value.clear();
    isSelectionMode.value = false;
};

const askToLoad = (project) => {
    if (project.isPlaceholder) return;
    if (isSelectionMode.value) {
        toggleSelection(project);
        return;
    }
    impactMedium();
    confirmModal.value = { show: true, type: 'load', item: project };
};

// --- ПАГИНАЦИЯ ---
const PAGE_SIZE = 50;
const historyCursor = ref(null);
const historyHasMore = ref(false);

// --- ФИЛЬТРЫ ---
const selectedType = ref('all');
const showCalendar = ref(false); 
const calendarDate = ref(new Date()); 
const selectedDate = ref(null); 
const calendarPopup = ref(null);   
const calendarTrigger = ref(null); 

// --- СТИЛЬ 1: ОБЫЧНЫЕ КНОПКИ (Меню, Поиск, Select) ---
const btnClass = `
    h-14 
    bg-white dark:bg-[#1C1C1E] 
    rounded-2xl 
    shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] 
    dark:shadow-black/50 
    ring-1 ring-black/5 dark:ring-white/10 
    font-bold text-gray-400 dark:text-gray-500
    
    transition-all duration-300 ease-out 
    transform-gpu no-flicker
    
    hover:-translate-y-1 
    hover:text-gray-900 dark:hover:text-white
    hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)]
    dark:hover:shadow-black/70
    hover:ring-black/10 dark:hover:ring-white/20
    
    active:translate-y-0 active:shadow-sm
    
    flex items-center relative z-10 hover:z-20
`;

// --- СТИЛЬ 2: АКЦЕНТНАЯ КНОПКА (Сбросить фильтры) ---
// Та же физика (no-flicker, translate), но другие цвета
const actionBtnClass = `
    bg-[#1d1d1f] dark:bg-white 
    text-white dark:text-black 
    px-8 py-4 
    rounded-full 
    font-bold text-xs uppercase tracking-widest 
    
    shadow-xl shadow-black/20 
    
    transition-all duration-300 ease-out 
    transform-gpu no-flicker
    
    hover:-translate-y-1 
    hover:shadow-2xl hover:shadow-black/40 
    hover:bg-black dark:hover:bg-gray-200 
    
    active:translate-y-0 active:shadow-sm
`;

const calcTypes = [
    { id: 'all', label: 'Все', short: 'Все' },
    { id: 'laser', label: 'Лазерная резка', short: 'Лазер' },
    { id: 'dtf', label: 'Нанесение на текстиль', short: 'Текстиль' },
    { id: 'poly', label: 'Цифровая печать', short: 'Цифра' }
];

const adaptiveCalcTypes = computed(() => {
    return calcTypes.map(t => ({
        ...t,
        label: windowWidth.value < 640 ? t.short : t.label
    }));
});

const getHistoryCalcIcon = (type) => {
    if (type === 'dtf') {
        return {
            viewBox: '0 0 24 24',
            path: 'M20.38 3.4a2 2 0 0 0-1.2-1.2l-3.2-.8a2.5 2.5 0 0 0-3.3 1.5 1 1 0 0 1-1.3 0 2.5 2.5 0 0 0-3.3-1.5l-3.2.8a2 2 0 0 0-1.2 1.2L2 10l4 1V21a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11l4-1z',
        };
    }

    if (type === 'poly') {
        return {
            viewBox: '0 0 24 24',
            path: 'M6 3h9l3 3v15H6V3zm8 1.5V7h2.5',
        };
    }

    return {
        viewBox: '0 0 24 24',
        path: 'M13 10V3L4 14h7v7l9-11h-7z',
    };
};

const getHistoryCardAccentIcon = (type) => {
    if (type === 'dtf' || type === 'poly') {
        return {
            ...getHistoryCalcIcon(type),
            filled: true,
            strokeWidth: null,
        };
    }

    return {
        ...getHistoryCalcIcon(type),
        filled: false,
        strokeWidth: '1.5',
    };
};

const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const currentMonthYear = computed(() => `${monthNames[calendarDate.value.getMonth()]} ${calendarDate.value.getFullYear()}`);
const selectedDayNumber = computed(() => selectedDate.value ? selectedDate.value.split('.')[0] : null);

const calendarDays = computed(() => {
    const year = calendarDate.value.getFullYear();
    const month = calendarDate.value.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const days = [];
    for(let i = 0; i < offset; i++) days.push(null);
    for(let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
});

const activeDates = computed(() => {
    const dates = new Set();
    projects.value.forEach(p => {
        try {
            if (!p.date) return;
            let d;
            if (typeof p.date === 'object') {
                d = typeof p.date.toDate === 'function' ? p.date.toDate() : (p.date instanceof Date ? p.date : null);
            } else if (typeof p.date === 'string') {
                d = new Date(p.date.includes('T') ? p.date : convertRuDate(p.date));
            } else if (typeof p.date === 'number') {
                d = new Date(p.date);
            }
            if (d && !isNaN(d)) dates.add(`${d.getDate()}-${d.getMonth()}-${d.getFullYear()}`);
        } catch(e) {}
    });
    return dates;
});

const filteredProjects = computed(() => {
    let list = [...(projects.value || [])];
    list.sort((a, b) => parseDateSort(b.date) - parseDateSort(a.date));
    if (selectedType.value !== 'all') {
        list = list.filter(p => { const type = p.type || 'laser'; return type === selectedType.value; });
    }
    if (searchQuery.value && searchQuery.value.trim().length > 0) {
        list = list.filter(p => {
            if (!p) return false;
            const blob = buildDeepSearchBlob({
                ...p,
                formattedDate: getProjectDateString(p.date),
            }, 3, 80);
            return matchesSearchBlob(blob, searchQuery.value);
        });
    }
    if (selectedDate.value) {
        list = list.filter(p => getProjectDateString(p.date) === selectedDate.value);
    }
    return list;
});

const gridColumns = computed(() => {
    if (windowWidth.value >= 1024) return 4; 
    if (windowWidth.value >= 768) return 3;  
    return 2; 
});

const displayList = computed(() => {
    const list = [...filteredProjects.value];
    const cols = gridColumns.value;
    const remainder = list.length % cols;
    if (remainder !== 0) {
        const missing = cols - remainder;
        for (let i = 0; i < missing; i++) list.push({ id: `placeholder-${i}`, isPlaceholder: true });
    }
    return list;
});

const listKey = computed(() => {
    return `${searchQuery.value}-${selectedDate.value}-${selectedType.value}-${filteredProjects.value.length}`;
});

const modalContent = computed(() => {
    const p = confirmModal.value.item;
    if (confirmModal.value.type === 'load') {
        return {
            title: 'Загрузить проект?',
            text: `Текущие данные калькулятора будут заменены данными из проекта "${p?.name}".`,
            btnText: 'Загрузить',
            btnClass: 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200'
        };
    } else {
        return {
            title: 'Удалить проект?',
            text: `Вы действительно хотите удалить проект "${p?.name}"? Это действие нельзя отменить.`,
            btnText: 'Удалить',
            btnClass: 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/30'
        };
    }
});

const updateWidth = () => { windowWidth.value = window.innerWidth; };

const fetchHistory = async () => {
    isLoading.value = true;
    error.value = null;
    historyCursor.value = null;
    historyHasMore.value = false;
    try {
        const data = await getCloudHistory({ pageSize: PAGE_SIZE });

        if (data && data.status === 'error') {
            error.value = data.message || 'Ошибка загрузки';
            projects.value = [];
            return;
        }

        if (Array.isArray(data)) {
            // legacy
            projects.value = data;
            return;
        }

        if (data && data.result && Array.isArray(data.result)) {
            projects.value = data.result;
            historyCursor.value = data.cursor || null;
            historyHasMore.value = !!data.hasMore;
            return;
        }

        projects.value = [];
    } catch (e) {
        console.error("Error:", e);
        error.value = 'Ошибка соединения';
        projects.value = [];
    } finally {
        isLoading.value = false;
    }
};

const loadMore = async () => {
    if (isLoading.value || isLoadingMore.value) return;
    if (!historyHasMore.value || !historyCursor.value) return;

    isLoadingMore.value = true;
    try {
        const data = await getCloudHistory({ pageSize: PAGE_SIZE, cursor: historyCursor.value });
        if (data && data.status === 'error') {
            notificationError(data.message || 'Ошибка загрузки');
            return;
        }

        if (data && data.result && Array.isArray(data.result)) {
            const existing = new Set((projects.value || []).map(p => p?.id));
            const next = data.result.filter(p => p?.id && !existing.has(p.id));
            projects.value = [...(projects.value || []), ...next];
            historyCursor.value = data.cursor || historyCursor.value;
            historyHasMore.value = !!data.hasMore;
        }
    } catch (e) {
        console.error('Load more error:', e);
        notificationError('Ошибка соединения');
    } finally {
        isLoadingMore.value = false;
    }
};

const convertRuDate = (str) => {
    if(!str) return null;
    try {
        const [dPart, tPart] = str.split(', ');
        if (!dPart) return null;
        const parts = dPart.split('.');
        if (parts.length !== 3) return null;
        const [d, m, y] = parts;
        return `${y}-${m}-${d}T${tPart || '00:00'}`;
    } catch (e) { return null; }
};

const getProjectDateString = (dateStr) => {
    try {
        if (!dateStr) return '';
        let d;
        if (typeof dateStr === 'object') {
            d = typeof dateStr.toDate === 'function' ? dateStr.toDate() : (dateStr instanceof Date ? dateStr : null);
        } else if (typeof dateStr === 'string') {
            d = new Date(dateStr.includes('T') ? dateStr : convertRuDate(dateStr));
        } else if (typeof dateStr === 'number') {
            d = new Date(dateStr);
        }
        if (!d || isNaN(d)) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
    } catch { return ''; }
};

const formatDateDisplay = (dateStr) => {
    try {
        if (!dateStr) return { date: 'Недавно', time: '' };
        let d;
        if (typeof dateStr === 'object') {
            d = typeof dateStr.toDate === 'function' ? dateStr.toDate() : (dateStr instanceof Date ? dateStr : null);
        } else if (typeof dateStr === 'string') {
            d = new Date(dateStr.includes('T') ? dateStr : convertRuDate(dateStr));
        } else if (typeof dateStr === 'number') {
            d = new Date(dateStr);
        }
        
        if (!d || isNaN(d)) return { date: typeof dateStr === 'string' ? dateStr : 'Недавно', time: '' };
        
        return {
            date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
    } catch (e) { return { date: typeof dateStr === 'string' ? dateStr : 'Недавно', time: '' }; }
};

const parseDateSort = (dateStr) => {
    if (!dateStr) return 0;
    // Handle Firestore Timestamp object or plain Date object
    if (typeof dateStr === 'object') {
        if (typeof dateStr.toDate === 'function') return dateStr.toDate().getTime();
        if (dateStr instanceof Date) return dateStr.getTime();
        return 0;
    }
    // Handle specific string formats
    if (typeof dateStr === 'string') {
        const str = dateStr.trim();
        const d = new Date(str.includes('T') ? str : convertRuDate(str));
        return d.getTime() || 0;
    }
    // Handle number (unix timestamp)
    if (typeof dateStr === 'number') return dateStr;
    
    return 0;
};

const goBack = () => {
    impactLight();
    if (route.query.from === 'calc') {
        router.push(`/calc/${queryCalcId.value}`);
        return;
    }
    if (route.query.from === 'settings') {
        router.push('/settings');
        return;
    }
    router.push('/');
};

const toggleCalendar = () => { 
    impactLight(); 
    showCalendar.value = !showCalendar.value; 
    if (showCalendar.value) {
        if (!selectedDate.value) calendarDate.value = new Date();
    }
};

const changeMonth = (offset) => {
    impactLight();
    const newDate = new Date(calendarDate.value);
    newDate.setMonth(newDate.getMonth() + offset);
    calendarDate.value = newDate;
};

const selectDate = (date) => {
    if (!date) return;
    impactMedium();
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const dateStr = `${d}.${m}.${y}`;
    selectedDate.value = (selectedDate.value === dateStr) ? null : dateStr;
};

const clearDate = () => { selectedDate.value = null; showCalendar.value = false; impactLight(); };
const resetFilters = () => { selectedDate.value = null; searchQuery.value = ''; selectedType.value = 'all'; impactLight(); };

const hasProjectOnDate = (date) => {
    if (!date) return false;
    const key = `${date.getDate()}-${date.getMonth()}-${date.getFullYear()}`;
    return activeDates.value.has(key);
};

const isSelected = (date) => {
    if(!date || !selectedDate.value) return false;
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}` === selectedDate.value;
};

const handleClickOutside = (event) => {
    if (showCalendar.value && calendarPopup.value && !calendarPopup.value.contains(event.target) && calendarTrigger.value && !calendarTrigger.value.contains(event.target)) {
        showCalendar.value = false;
    }
};

const askToDelete = (project, event) => {
    event.stopPropagation();
    impactMedium();
    deletingProjectId.value = project.id;
};

const cancelDelete = (event) => {
    if(event) event.stopPropagation();
    impactLight();
    deletingProjectId.value = null;
};

const confirmDeleteInline = async (project, event) => {
    if(event) event.stopPropagation();
    impactMedium();
    const idToDelete = project.id;
    projects.value = projects.value.filter(p => p.id !== idToDelete);
    deletingProjectId.value = null;
    notificationSuccess();
    deleteFromHistory(idToDelete).catch((e) => {
        console.error("Ошибка удаления:", e);
        if (notificationError) notificationError();
        fetchHistory(); 
    });
};

const executeBulkDelete = async () => {
    if (selectedIds.value.size === 0) return;
    impactMedium();
    isBulkDeleting.value = true;
    const idsToDelete = Array.from(selectedIds.value);
    
    // Optimistic UI update
    projects.value = projects.value.filter(p => !idsToDelete.includes(p.id));
    selectedIds.value.clear();
    isSelectionMode.value = false;
    notificationSuccess();

    try {
        await Promise.all(idsToDelete.map(id => deleteFromHistory(id)));
    } catch(e) {
        console.error("Partial bulk delete error:", e);
        if(notificationError) notificationError();
        fetchHistory();
    } finally {
        isBulkDeleting.value = false;
    }
};

const closeConfirm = () => {
    confirmModal.value.show = false;
    setTimeout(() => { confirmModal.value.item = null; confirmModal.value.type = null; }, 150);
};

const executeAction = async () => {
    const p = confirmModal.value.item;
    const type = confirmModal.value.type;
    confirmModal.value.show = false;

    if (type === 'load') {
        if ((p?.type || 'laser') === 'dtf') {
            try {
                sessionStorage.setItem(DTF_HISTORY_LOAD_KEY, JSON.stringify({
                    id: p.id,
                    qty: p?.qty || p?.state?.project?.qty || 1,
                    state: p.state || null,
                }));
            } catch (error) {}
            router.push('/calc/dtf');
            notificationSuccess();
            return;
        }

        const loadedQtyRaw = Number(p?.qty || p?.state?.project?.qty || 1);
        const loadedQty = Number.isFinite(loadedQtyRaw) && loadedQtyRaw > 0 ? Math.floor(loadedQtyRaw) : 1;
        const savedTotal = Number(p?.totalOrder ?? p?.total) || 0;

        if (p.state) loadState(p.state, p.id);

        // ⚖️ Trust but Verify: пересчитываем сумму по текущим тарифам и предупреждаем,
        // если сохранённая сумма отличается (подмена/устаревшие цены).
        await nextTick();
        const calculatedTotalPerUnit = Number(totals?.value?.total) || 0;
        const calculatedTotal = Math.round(calculatedTotalPerUnit * loadedQty);
        if (savedTotal > 0 && calculatedTotal > 0) {
            const diff = Math.abs(calculatedTotal - savedTotal) / savedTotal;
            if (diff > 0.01) {
                const percent = Math.round(diff * 1000) / 10; // 0.1%
                alert(
                    `⚠️ Предупреждение: сумма проекта отличается от пересчёта.\n\n` +
                    `Сохранено (за весь заказ): ${savedTotal.toLocaleString('ru-RU')} ₽\n` +
                    `Пересчитано (за ${loadedQty} шт): ${calculatedTotal.toLocaleString('ru-RU')} ₽\n\n` +
                    `Отклонение: ~${percent}%\n\n` +
                    `Причины: изменились тарифы или данные были изменены вручную.`
                );
            }
        }

        router.push('/calc/laser');
        notificationSuccess();
    }
};

onMounted(() => { 
    fetchHistory(); 
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', updateWidth);
});
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', updateWidth);
});
</script>

<template>
    <div class="relative w-full h-screen bg-[#F5F5F7] dark:bg-[#121212] flex flex-col overflow-hidden">
        
        <div class="flex-1 flex flex-col w-full h-full relative z-10 pt-8 overflow-hidden">
            
            <div class="w-full flex-none">
                <div class="max-w-5xl mx-auto px-5"> 
                    <div class="flex items-center justify-center relative mb-8 animate-fade-in-down">
                        <h1 class="text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none text-center px-6 py-2 transition-colors duration-300">
                            Архив <span class="inline-block px-1 text-transparent bg-clip-text bg-gradient-to-br from-gray-600 to-black dark:from-gray-300 dark:to-white">Проектов</span>
                        </h1>
                    </div>

                    <div class="relative flex gap-4 w-full mb-6 animate-fade-in-up z-40 items-center">
                        <button @click="goBack" :class="[btnClass, 'px-6 justify-center gap-2 shrink-0 w-auto']">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                            <span class="font-bold text-sm hidden sm:inline">Меню</span>
                            <span class="font-bold text-sm sm:hidden">Меню</span> 
                        </button>

                        <div class="relative flex-1 group" :class="btnClass">
                            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                 <svg class="text-inherit transition-colors duration-300" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            </div>
                            <input 
                                v-model="searchQuery" 
                                class="block w-full h-full pl-12 pr-4 bg-transparent rounded-2xl text-sm font-bold outline-none text-inherit placeholder-gray-400/70 transition-colors cursor-text" 
                                placeholder="Название, сумма..."
                            >
                        </div>

                        <ModernSelect 
                            v-model="selectedType" 
                            :options="adaptiveCalcTypes" 
                            placeholder="Тип" 
                            :class="btnClass"
                            class="w-auto px-0"
                        />

                        <div class="relative">
                            <button 
                                ref="calendarTrigger" 
                                @click="toggleCalendar" 
                                :class="[
                                    btnClass, 
                                    'w-14 justify-center px-0',
                                    showCalendar || selectedDate 
                                        ? '!text-black dark:!text-white ring-2 !ring-black dark:!ring-white !shadow-none hover:!translate-y-0' 
                                        : ''
                                ]"
                            >
                                <span v-if="selectedDate" class="text-xl font-black tracking-tighter leading-none animate-pop-in">{{ selectedDayNumber }}</span>
                                <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            </button>
                            
                            <Transition name="dropdown">
                                <div ref="calendarPopup" v-if="showCalendar" class="absolute top-16 right-0 bg-white dark:bg-[#1C1C1E] rounded-[2rem] p-5 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 w-80 max-w-[90vw] z-50 origin-top-right">
                                    <div class="flex justify-between items-center mb-4 px-2">
                                        <button @click="changeMonth(-1)" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-black dark:hover:text-white transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
                                        <h3 class="text-sm font-black uppercase tracking-widest text-[#1d1d1f] dark:text-white select-none">{{ currentMonthYear }}</h3>
                                        <div class="flex items-center gap-1"><button @click="changeMonth(1)" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 hover:text-black dark:hover:text-white transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></button><button @click="showCalendar=false" class="text-gray-400 hover:text-black dark:hover:text-white p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors ml-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>
                                    </div>
                                    <div class="grid grid-cols-7 mb-2 text-center"><span v-for="d in ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']" :key="d" class="text-[10px] font-bold text-gray-400 uppercase">{{ d }}</span></div>
                                    <div class="grid grid-cols-7 gap-1"><button v-for="(date, i) in calendarDays" :key="i" :disabled="!date" @click="selectDate(date)" class="h-9 w-full rounded-xl flex items-center justify-center text-xs transition-all relative" :class="[!date ? 'invisible' : '', isSelected(date) ? 'bg-black dark:bg-white text-white dark:text-black shadow-md font-bold' : (date && hasProjectOnDate(date) ? 'bg-gray-100 dark:bg-white/10 text-black dark:text-white font-black hover:bg-gray-200 dark:hover:bg-white/20' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5')]">{{ date ? date.getDate() : '' }}</button></div>
                                    <button v-if="selectedDate" @click="clearDate" class="w-full mt-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl font-bold text-[10px] uppercase tracking-widest text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-colors">Сбросить дату</button>
                                </div>
                            </Transition>
                        </div>
                        
                        <!-- Toggle Selection Mode -->
                        <button 
                            v-if="canBulkDelete && projects.length > 0"
                            @click="toggleSelectionMode" 
                            :class="[
                                btnClass, 
                                'w-14 justify-center px-0 sm:px-4 sm:w-auto overflow-hidden',
                                isSelectionMode
                                    ? '!bg-black !text-white dark:!bg-white dark:!text-black ring-2 ring-black dark:ring-white shadow-lg'
                                    : ''
                            ]"
                        >
                            <svg v-if="!isSelectionMode" width="20" height="20" viewBox="0 0 24 24" fill="none" class="collapse sm:visible sm:mr-2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" class="collapse sm:visible sm:mr-2" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            <span class="font-bold text-sm hidden sm:inline">{{ isSelectionMode ? 'Отмена' : 'Выбрать' }}</span>
                            <span class="font-bold text-sm sm:hidden absolute">{{ isSelectionMode ? '×' : '✓' }}</span>
                        </button>
                    </div>
                </div>
            </div>

            <PageScrollWrapper class="flex-1 w-full pt-2 relative z-10">
                <div class="max-w-5xl mx-auto px-5 pb-32">
                    
                    <div v-if="isLoading" class="flex flex-col items-center justify-center py-20 opacity-60">
                        <div class="w-8 h-8 border-4 border-gray-200 border-t-black dark:border-t-white dark:border-gray-700 rounded-full animate-spin mb-4"></div>
                        <span class="text-xs font-bold uppercase tracking-widest text-gray-500">Загрузка...</span>
                    </div>

                    <div v-else-if="error" class="text-center py-20 text-gray-400 flex flex-col items-center">
                        <div class="mb-4 text-red-400 bg-red-50 dark:bg-red-900/20 p-4 rounded-2xl"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
                        <p class="font-black text-lg text-gray-800 dark:text-white mb-2">Произошла ошибка</p>
                        <p class="text-sm font-medium text-gray-500 dark:text-gray-400 max-w-xs mb-6">{{ error }}</p>
                        <button @click="fetchHistory" class="bg-[#1d1d1f] dark:bg-white text-white dark:text-black px-6 py-3 rounded-full font-bold text-xs uppercase tracking-wider hover:scale-105 active:scale-95 transition-all shadow-xl shadow-black/20">Повторить</button>
                    </div>

                    <div v-else-if="filteredProjects.length === 0" class="text-center py-20 text-gray-400 flex flex-col items-center">
                        <p class="font-black text-lg text-gray-300 dark:text-gray-600 mb-2">Ничего не найдено</p>
                        <button @click="resetFilters" :class="actionBtnClass">Сбросить фильтры</button>
                    </div>

                    <Transition mode="out-in" name="grid-fade">
                        <div :key="listKey" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-auto relative">
                            <div v-for="p in displayList" :key="p.id" 
                                @click="isSelectionMode ? toggleSelection(p) : askToLoad(p)"
                                class="group bg-white dark:bg-[#1C1C1E] rounded-3xl p-5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08)] dark:shadow-black/40 relative overflow-hidden flex flex-col min-h-40 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 cursor-pointer w-full"
                                :class="[
                                    p.isPlaceholder ? 'opacity-0 pointer-events-none shadow-none' : '',
                                    isSelectionMode && selectedIds.has(p.id) ? 'ring-2 ring-blue-500 scale-[0.98]' : ''
                                ]"
                            >
                                <template v-if="!p.isPlaceholder">
                                    <div class="absolute -bottom-6 -right-6 text-gray-50 dark:text-[#252525] group-hover:text-gray-100 dark:group-hover:text-[#2A2A2A] transition-all duration-500 group-hover:scale-110 group-hover:-rotate-12 pointer-events-none"><svg width="130" height="130" :viewBox="getHistoryCardAccentIcon(p.type || 'laser').viewBox" :fill="getHistoryCardAccentIcon(p.type || 'laser').filled ? 'currentColor' : 'none'" :stroke="getHistoryCardAccentIcon(p.type || 'laser').filled ? 'none' : 'currentColor'" :stroke-width="getHistoryCardAccentIcon(p.type || 'laser').strokeWidth || undefined"><path stroke-linecap="round" stroke-linejoin="round" :d="getHistoryCardAccentIcon(p.type || 'laser').path" /></svg></div>
                                    
                                    <div v-if="isSelectionMode" class="absolute top-3 right-3 z-30 transition-transform" :class="selectedIds.has(p.id) ? 'scale-110' : 'scale-100'">
                                        <div class="w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center transition-colors shadow-sm"
                                             :class="selectedIds.has(p.id) ? 'bg-blue-500 border-blue-500 shadow-lg shadow-blue-500/30' : 'border-gray-300 dark:border-gray-500 bg-white/80 dark:bg-black/50 backdrop-blur-sm'">
                                            <svg v-if="selectedIds.has(p.id)" class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        </div>
                                    </div>
                                    <button v-else @click.stop="askToDelete(p, $event)" class="absolute top-3 right-3 p-2 bg-white/80 dark:bg-black/50 backdrop-blur-sm rounded-full text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all opacity-0 group-hover:opacity-100 z-20 scale-90 hover:scale-100 shadow-sm border border-gray-100 dark:border-white/5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>

                                    <div class="relative z-10 mb-3"><div class="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100/80 dark:bg-white/10 backdrop-blur-md rounded-lg border border-gray-200/50 dark:border-white/5 w-fit"><svg class="w-3 h-3 text-gray-500 dark:text-gray-400" :viewBox="getHistoryCalcIcon(p.type || 'laser').viewBox" fill="currentColor" stroke="none"><path :d="getHistoryCalcIcon(p.type || 'laser').path" /></svg><span class="text-[9px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-wider">{{ (calcTypes.find(t => t.id === (p.type || 'laser')) || calcTypes[1]).label }}</span></div></div>
                                    <div class="relative z-10 flex-1 flex flex-col items-start pr-6 gap-1">
                                        <h3 class="text-sm md:text-base font-black text-[#1d1d1f] dark:text-white leading-snug break-words">{{ p.name }}</h3>
                                        <span v-if="p.client" class="text-[10px] font-bold text-gray-500 dark:text-gray-400 leading-tight break-words">{{ p.client }}</span>
                                    </div>
                                    <div class="flex flex-col relative z-10 mt-3 mb-2"><span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-none">{{ formatDateDisplay(p.date).date }}</span><span class="text-[9px] font-bold text-gray-300 dark:text-gray-600 leading-tight mt-0.5">{{ formatDateDisplay(p.date).time }}</span></div>
                                    <div class="relative z-10 flex items-end justify-between pt-2 border-t border-gray-50/50 dark:border-white/5"><div class="flex flex-col"><div class="flex items-baseline gap-0.5"><span class="text-lg md:text-xl font-black text-black dark:text-white tracking-tight leading-none">{{ parseInt(p.total).toLocaleString() }}</span><span class="text-[10px] font-bold text-gray-400">₽</span></div></div><div class="pl-3 pr-2 py-1.5 bg-[#1d1d1f] dark:bg-white group-hover:bg-black dark:group-hover:bg-gray-200 rounded-full text-white dark:text-black flex items-center gap-1 transition-colors"><span class="text-[9px] font-bold uppercase tracking-widest">Открыть</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div></div>
                                    
                                    <!-- Inline Delete Overlay -->
                                    <Transition enter-active-class="transition-[opacity,transform] duration-300 ease-out" enter-from-class="opacity-0 scale-95" enter-to-class="opacity-100 scale-100" leave-active-class="transition-[opacity,transform] duration-200 ease-in" leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
                                        <div v-if="deletingProjectId === p.id" class="absolute inset-0 z-50 bg-red-500/90 dark:bg-red-900/90 backdrop-blur-md flex flex-col items-center justify-center p-4 rounded-3xl" @click.stop>
                                            <div class="bg-white dark:bg-[#1C1C1E] p-5 rounded-2xl w-full flex flex-col items-center text-center shadow-xl transform transition-all pb-4">
                                                <div class="w-10 h-10 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-3 text-red-500"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></div>
                                                <p class="font-black text-sm text-gray-900 dark:text-white mb-4">Удалить проект?</p>
                                                <div class="flex w-full gap-2 mt-auto">
                                                    <button @click="cancelDelete" class="flex-1 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">Отмена</button>
                                                    <button @click="confirmDeleteInline(p, $event)" class="flex-1 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20 transition-colors">Удалить</button>
                                                </div>
                                            </div>
                                        </div>
                                    </Transition>

                                </template>
                            </div>
                        </div>
                    </Transition>

                    <div v-if="historyHasMore && filteredProjects.length > 0" class="mt-8 flex justify-center">
                        <button
                            @click="loadMore"
                            :disabled="isLoadingMore"
                            class="px-8 py-4 rounded-full font-bold text-xs uppercase tracking-widest shadow-xl shadow-black/20 transition-all duration-300 ease-out transform-gpu no-flicker"
                            :class="[
                                'bg-[#1d1d1f] dark:bg-white text-white dark:text-black',
                                isLoadingMore ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/40 hover:bg-black dark:hover:bg-gray-200 active:translate-y-0 active:shadow-sm'
                            ]"
                        >
                            <span v-if="!isLoadingMore">Показать ещё</span>
                            <span v-else class="inline-flex items-center gap-2">
                                <span class="w-3.5 h-3.5 border-2 border-white/40 dark:border-black/30 border-t-white dark:border-t-black rounded-full animate-spin"></span>
                                Загрузка...
                            </span>
                        </button>
                    </div>

                    <div class="mt-8 text-center opacity-40 hover:opacity-100 transition-opacity">
                        <p class="text-[9px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Хранение данных: 30 дней</p>
                    </div>
                </div>
            </PageScrollWrapper>

            <!-- Плавающая панель массового удаления -->
            <Transition name="grid-fade">
                <div v-if="isSelectionMode" class="absolute bottom-6 left-1/2 -translate-x-1/2 z-50">
                    <div class="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl px-5 py-3 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] border border-gray-200/50 dark:border-white/10 flex items-center gap-4">
                        <span class="font-bold text-sm text-gray-800 dark:text-white whitespace-nowrap">Выбрано: {{ selectedIds.size }}</span>
                        
                        <div class="w-px h-6 bg-gray-200 dark:bg-white/10"></div>
                        
                        <div class="flex items-center gap-2">
                            <button @click="selectAllCurrent" class="text-xs font-bold text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white px-3 py-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors uppercase">Все</button>
                            <button @click="clearSelection" class="text-xs font-bold text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white px-3 py-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors uppercase">Снять</button>
                            
                            <button 
                                @click="executeBulkDelete" 
                                :disabled="selectedIds.size === 0 || isBulkDeleting"
                                class="ml-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white px-5 py-2.5 rounded-full font-bold text-xs uppercase tracking-wider transition-all disabled:scale-100 disabled:opacity-50 hover:scale-105 active:scale-95 shadow-lg shadow-red-500/30 disabled:shadow-none flex items-center gap-2"
                            >
                                <svg v-if="isBulkDeleting" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path></svg>
                                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                <span>Удалить</span>
                            </button>
                        </div>
                    </div>
                </div>
            </Transition>

            <Teleport to="body">
                <Transition name="modal-pop">
                    <div v-if="confirmModal.show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" @click.self="closeConfirm">
                        <div class="bg-white dark:bg-[#1C1C1E] rounded-[2rem] shadow-2xl p-6 max-w-sm w-full border border-gray-100 dark:border-white/10 text-center transform transition-all">
                            <h3 class="text-lg font-black mb-2 text-gray-900 dark:text-white">{{ modalContent.title }}</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">{{ modalContent.text }}</p>
                            <div class="grid grid-cols-2 gap-3">
                                <button @click="closeConfirm" class="py-3 rounded-xl font-bold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-xs uppercase tracking-wider">Отмена</button>
                                <button @click="executeAction" :class="['py-3 rounded-xl font-bold shadow-lg transition-all text-xs uppercase tracking-wider', modalContent.btnClass]">{{ modalContent.btnText }}</button>
                            </div>
                        </div>
                    </div>
                </Transition>
            </Teleport>

        </div>
    </div>
</template>

<style scoped>
.animate-fade-in-down { animation: fadeInDown 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards; opacity: 0; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.animate-pop-in { animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top right; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-10px) scale(0.95); }
.modal-pop-enter-active, .modal-pop-leave-active { transition: opacity 0.1s ease-out; }
.modal-pop-enter-from, .modal-pop-leave-to { opacity: 0; }
.grid-fade-enter-active, .grid-fade-leave-active { transition: all 0.25s ease-in-out; }
.grid-fade-enter-from, .grid-fade-leave-to { opacity: 0; transform: translateY(10px) scale(0.98); }

.no-flicker {
    will-change: transform;
    backface-visibility: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
</style>