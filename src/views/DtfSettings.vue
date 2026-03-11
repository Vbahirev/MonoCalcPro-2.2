<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useDatabase } from '@/composables/useDatabase';
import { useHaptics } from '@/composables/useHaptics';
import { PageScrollWrapper } from '@/ui-core';
import draggable from 'vuedraggable';
import ModernSelect from '@/components/ModernSelect.vue';
import { buildDeepSearchBlob, getSearchVariants } from '@/utils/searchIndex';
import {
    DEFAULT_DTF_ROLL_WIDTH_MM,
    DEFAULT_DTF_LINEAR_METER_PRICE,
} from '@/utils/coatingPricing';

const router = useRouter();
const route  = useRoute();
const { processingDB, saveFullDatabase, isRemoteUpdate, hasPermission, isOfflineMode } = useDatabase();
const { impactLight, impactMedium, notificationSuccess, notificationError } = useHaptics();

// ─── Права ────────────────────────────────────────────────────────────────────
const canEditSvc = computed(() =>
    hasPermission('settings.prices.write') ||
    hasPermission('canEditPrices') ||
    hasPermission('canEditGlobalSettings')
);

// ─── Состояние ────────────────────────────────────────────────────────────────
const isSaving            = ref(false);
const hasUnsavedChanges   = ref(false);
const highlightedId       = ref(null);
const deleteConfirmationId = ref(null);
const showLeaveModal      = ref(false);
const pendingRoute        = ref(null);

// ─── Стили (идентичны LaserSettings) ─────────────────────────────────────────
const btnClass     = `h-14 bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/10 font-bold text-gray-400 dark:text-gray-500 transition-all duration-300 ease-out transform-gpu no-flicker hover:-translate-y-1 hover:text-gray-900 dark:hover:text-white hover:shadow-[0_15px_30px_-5px_rgba(0,0,0,0.1)] dark:hover:shadow-black/70 hover:ring-black/10 dark:hover:ring-white/20 active:translate-y-0 active:shadow-sm flex items-center relative z-10 hover:z-20`;
const saveBtnClass = `h-14 w-40 rounded-2xl font-bold uppercase tracking-widest text-xs text-white dark:text-black shadow-[0_10px_20px_-5px_rgba(0,0,0,0.4)] dark:shadow-[0_10px_20px_-5px_rgba(255,255,255,0.15)] transition-all duration-300 ease-out transform-gpu active:translate-y-0 active:shadow-md flex items-center justify-center gap-2 relative z-30`;
const cardClass    = `bg-white dark:bg-[#1C1C1E] rounded-[1.5rem] p-5 shadow-sm border border-gray-100 dark:border-white/5 relative group overflow-visible transition-all duration-300 transform-gpu hover:shadow-xl hover:-translate-y-1 hover:border-gray-200 dark:hover:border-white/20 hover:z-[100] focus-within:z-[100]`;

// ─── Данные ───────────────────────────────────────────────────────────────────
const dtfItems = computed(() =>
    (processingDB.value || []).filter(item => item?.type === 'area_cm2')
);

// ─── Поиск ───────────────────────────────────────────────────────────────────
const searchQuery = ref('');
const filteredDtfItems = computed(() => {
    const q = String(searchQuery.value || '').trim();
    if (!q) return dtfItems.value;
    const variants = getSearchVariants(q);
    return dtfItems.value.filter(item => {
        const blob = buildDeepSearchBlob(item, 3, 80);
        return variants.some(v => blob.includes(v));
    });
});
const activeTab = ref('dtf');
const tabs = [{ value: 'dtf', label: 'Пресеты DTF' }];

// ─── Хелперы расчёта ─────────────────────────────────────────────────────────
const normWidth  = (v) => { const p = Number(v); return (Number.isFinite(p) && p > 0) ? p : DEFAULT_DTF_ROLL_WIDTH_MM; };
const normLp     = (v) => { const p = Number(v); return (Number.isFinite(p) && p > 0) ? p : DEFAULT_DTF_LINEAR_METER_PRICE; };
const normMarkup = (v) => { const p = Number(v); return Number.isFinite(p) ? Math.max(0, p) : 0; };

const toDtfPricePerCm2 = (lp, wm) => {
    const w = normWidth(wm);
    const l = Math.max(0, Number(lp) || 0);
    return l / ((w / 10) * 100);
};
const getDtfEffectiveWidthMm = (item) => normWidth(item?.dtfWidthMm);
const getDtfEffectiveLinearPrice = (item) => {
    const fl = Number(item?.dtfLinearMeterPrice);
    if (Number.isFinite(fl) && fl > 0) return normLp(fl);
    const fp = Number(item?.price);
    if (Number.isFinite(fp) && fp > 0) return normLp(fp * ((normWidth(item?.dtfWidthMm) / 10) * 100));
    return DEFAULT_DTF_LINEAR_METER_PRICE;
};
const formatDtfPricePerCm2 = (item) => {
    const v = toDtfPricePerCm2(getDtfEffectiveLinearPrice(item), getDtfEffectiveWidthMm(item));
    if (v <= 0) return '0';
    return v >= 1 ? v.toFixed(2) : v.toFixed(4);
};
const formatDtfPricePerCm2WithMarkup = (item) => {
    const base = toDtfPricePerCm2(getDtfEffectiveLinearPrice(item), getDtfEffectiveWidthMm(item));
    const v = base * (1 + normMarkup(item?.markupPercent) / 100);
    if (v <= 0) return '0';
    return v >= 1 ? v.toFixed(2) : v.toFixed(4);
};

const updateDtfLinearPrice = (item, value) => {
    item.dtfLinearMeterPrice = normLp(value);
    item.dtfWidthMm          = getDtfEffectiveWidthMm(item);
    item.price               = toDtfPricePerCm2(item.dtfLinearMeterPrice, item.dtfWidthMm);
    markDirty();
};
const updateDtfWidth = (item, value) => {
    item.dtfWidthMm          = normWidth(value);
    item.dtfLinearMeterPrice = getDtfEffectiveLinearPrice(item);
    item.price               = toDtfPricePerCm2(item.dtfLinearMeterPrice, item.dtfWidthMm);
    markDirty();
};

const isItemAvailable    = (item) => item?.active !== false;
const toggleAvailability = (item) => { item.active = !isItemAvailable(item); markDirty(); };

// ─── Add / Delete / Duplicate ────────────────────────────────────────────────
const addDtfItem = () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const lp = DEFAULT_DTF_LINEAR_METER_PRICE;
    const wm = DEFAULT_DTF_ROLL_WIDTH_MM;
    const newItem = {
        id: `dtf_preset_${Date.now()}`,
        name: 'DTF Печать',
        type: 'area_cm2',
        active: true,
        inStock: true,
        markupPercent: 0,
        dtfLinearMeterPrice: lp,
        dtfWidthMm: wm,
        price: toDtfPricePerCm2(lp, wm),
        qty: 1,
    };
    processingDB.value.unshift(newItem);
    highlightedId.value = newItem.id;
    markDirty();
    setTimeout(() => { if (highlightedId.value === newItem.id) highlightedId.value = null; }, 2000);
};

const duplicateItem = (item) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const copy = { ...JSON.parse(JSON.stringify(item)), id: `dtf_preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
    processingDB.value.unshift(copy);
    highlightedId.value = copy.id;
    markDirty();
    setTimeout(() => { if (highlightedId.value === copy.id) highlightedId.value = null; }, 2000);
};

const askRemoveItem = (id) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactMedium();
    deleteConfirmationId.value = id;
};
const cancelDelete  = () => { impactLight(); deleteConfirmationId.value = null; };
const confirmDelete = (id) => {
    const idx = processingDB.value.findIndex(i => i.id === id);
    if (idx !== -1) { processingDB.value.splice(idx, 1); impactMedium(); markDirty(); }
    deleteConfirmationId.value = null;
};

// ─── Save ─────────────────────────────────────────────────────────────────────
const markDirty = () => { if (!hasUnsavedChanges.value) hasUnsavedChanges.value = true; };

watch(processingDB, () => {
    if (isRemoteUpdate?.value) return;
    markDirty();
}, { deep: true });

const handleSave = async () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    isSaving.value = true;
    impactMedium();
    try {
        const ok = await saveFullDatabase();
        if (ok) { hasUnsavedChanges.value = false; notificationSuccess('Настройки DTF сохранены'); }
    } catch (e) {
        notificationError('Ошибка сохранения');
    } finally {
        isSaving.value = false;
    }
};

// ─── Routing ─────────────────────────────────────────────────────────────────
const queryCalcId = computed(() => {
    const raw = route.query.calc;
    if (Array.isArray(raw)) return raw[0] || 'dtf';
    return raw || 'dtf';
});
const goBack = () => {
    impactLight();
    if (route.query.from === 'calc') { router.push(`/calc/${queryCalcId.value}`); return; }
    router.push('/settings');
};

onBeforeRouteLeave((to, from, next) => {
    if (hasUnsavedChanges.value && canEditSvc.value) {
        impactMedium(); pendingRoute.value = to; showLeaveModal.value = true; next(false);
    } else { next(); }
});
const confirmLeave = () => {
    hasUnsavedChanges.value = false;
    showLeaveModal.value = false;
    if (pendingRoute.value) router.push(pendingRoute.value);
};

const encodeItemDomId = (id) => `setting-card-${encodeURIComponent(String(id || ''))}`;
const onDragEnd = () => { impactLight(); markDirty(); };
</script>

<template>
    <div class="h-screen w-full bg-[#F5F5F7] dark:bg-[#121212] overflow-hidden flex flex-col relative transition-colors duration-500">

        <!-- Leave modal — идентичен LaserSettings -->
        <Teleport to="body">
            <Transition name="modal-scale">
                <div v-if="showLeaveModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showLeaveModal = false">
                    <div class="bg-white dark:bg-[#1C1C1E] w-full max-w-xs rounded-[2rem] p-6 shadow-2xl border border-gray-100 dark:border-white/10 flex flex-col items-center text-center">
                        <div class="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-500 flex items-center justify-center mb-4">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                        </div>
                        <h3 class="text-xl font-black text-[#1d1d1f] dark:text-white mb-2">Не сохранено!</h3>
                        <p class="text-sm text-gray-500 mb-6 font-medium">Все изменения будут потеряны.</p>
                        <div class="flex gap-3 w-full">
                            <button @click="showLeaveModal = false" class="flex-1 h-12 rounded-xl bg-[#1d1d1f] dark:bg-white text-white dark:text-black font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all">Остаться</button>
                            <button @click="confirmLeave" class="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-sm hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">Выйти</button>
                        </div>
                    </div>
                </div>
            </Transition>
        </Teleport>

        <PageScrollWrapper class="flex-1">
            <div class="pb-32 pt-6 relative min-h-full flex flex-col w-full">
                <div class="max-w-5xl mx-auto px-5 w-full relative z-10">

                    <!-- Заголовок -->
                    <div class="flex items-center justify-center relative mb-8 animate-fade-in-down">
                        <h1 class="text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none text-center px-6 py-2 transition-colors duration-300">
                            Настройки <span class="inline-block text-transparent bg-clip-text bg-gradient-to-br from-gray-600 to-black dark:from-gray-300 dark:to-white">DTF</span>
                        </h1>
                    </div>

                    <!-- Панель навигации — идентична LaserSettings -->
                    <div class="relative flex flex-col sm:flex-row gap-3 w-full mb-4 animate-fade-in-up z-40 items-center">
                        <button @click="goBack" :class="[btnClass, 'px-5 justify-center gap-2 shrink-0 w-full sm:w-auto']">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                            <span class="font-bold text-sm">Назад</span>
                        </button>

                        <div class="relative flex-1 group w-full flex items-center gap-2" :class="btnClass">
                            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <svg class="text-inherit transition-colors duration-300" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            </div>
                            <input v-model="searchQuery" class="block w-full h-full pl-12 pr-12 bg-transparent rounded-2xl text-sm font-bold outline-none text-inherit placeholder-gray-400/70 transition-colors cursor-text" placeholder="Найти материал...">
                        </div>

                        <ModernSelect v-model="activeTab" :options="tabs" placeholder="Категория" :class="btnClass" class="sm:w-auto w-full px-0" />

                        <button
                            v-if="canEditSvc"
                            @click="handleSave"
                            :disabled="isSaving"
                            :class="[saveBtnClass, 'bg-black dark:bg-white', isSaving ? 'opacity-80 cursor-wait' : '', !isSaving && hasUnsavedChanges ? 'btn-pulse' : 'opacity-100', 'hover:-translate-y-1 hover:shadow-lg']"
                        >
                            <div v-if="isSaving" class="flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                                <span class="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                            </div>
                            <span v-else>Сохранить</span>
                        </button>

                        <div v-else class="h-14 px-6 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center gap-2 text-gray-400 font-bold text-xs uppercase tracking-wider cursor-not-allowed">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            <span>Только чтение</span>
                        </div>
                    </div>

                    <!-- Офлайн -->
                    <div v-if="isOfflineMode" class="mb-6 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-4 py-3 text-sm font-bold text-amber-700 dark:text-amber-300 animate-fade-in-up">
                        Офлайн — изменения сохранятся в кэш и синхронизируются после подключения
                    </div>

                    <!-- Секция DTF Печать -->
                    <div class="space-y-12 animate-fade-in-up" style="animation-delay: 0.2s;">
                        <section>
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">DTF Печать</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredDtfItems.length }}</span>
                            </div>

                            <!-- Пустой стейт — нет пресетов вообще -->
                            <div
                                v-if="!dtfItems.length"
                                class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest"
                            >
                                Нет пресетов DTF — нажмите «Добавить»
                            </div>

                            <!-- Пустой стейт — поиск не дал результатов -->
                            <div
                                v-else-if="!filteredDtfItems.length"
                                class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest"
                            >
                                Ничего не найдено по запросу «{{ searchQuery }}»
                            </div>

                            <draggable
                                v-else
                                v-model="processingDB"
                                item-key="id"
                                tag="div"
                                class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start"
                                handle=".drag-handle"
                                :animation="250"
                                ghost-class="ghost-card"
                                @end="onDragEnd"
                                :disabled="!canEditSvc"
                            >
                                <template #header>
                                    <button
                                        v-if="canEditSvc"
                                        @click="addDtfItem"
                                        class="min-h-[220px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"
                                    >
                                        <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                            </svg>
                                        </div>
                                        <span>Добавить</span>
                                    </button>
                                </template>

                                <template #item="{ element: item }">
                                    <div
                                        v-if="item.type === 'area_cm2' && filteredDtfItems.some(fi => fi.id === item.id)"
                                        :id="encodeItemDomId(item.id)"
                                        :class="[cardClass, 'min-h-[220px] flex flex-col self-start', {
                                            'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id,
                                            'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': deleteConfirmationId === item.id
                                        }]"
                                    >
                                        <!-- Оверлей удаления — идентичен LaserSettings -->
                                        <div v-if="deleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                            <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                            <div class="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
                                                <div class="max-w-[78%] rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md">
                                                    <div class="flex items-center gap-2.5">
                                                        <div class="flex h-9 w-9 items-center justify-center rounded-2xl bg-red-50 text-red-500 ring-1 ring-red-100 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-500/20">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                                                                <path d="M3 6h18"/>
                                                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                                                            </svg>
                                                        </div>
                                                        <div>
                                                            <p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p>
                                                            <h3 class="mt-0.5 text-sm font-black text-black dark:text-white leading-tight">Удалить этот пресет?</h3>
                                                            <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Действие удалит настройку из списка сразу после подтверждения.</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md">
                                                <div class="grid grid-cols-2 gap-2">
                                                    <button @click="cancelDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button>
                                                    <button @click="confirmDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Шапка карточки — идентична LaserSettings -->
                                        <div class="flex justify-between items-start gap-3 mb-4">
                                            <div
                                                class="drag-handle cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1"
                                                :class="{ 'opacity-0 pointer-events-none': !canEditSvc }"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
                                                    <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
                                                </svg>
                                            </div>
                                            <input
                                                v-model="item.name"
                                                @input="markDirty"
                                                :disabled="!canEditSvc"
                                                class="flex-1 font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500"
                                                placeholder="Название"
                                            >
                                            <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5">
                                                <button @click="duplicateItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать">
                                                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                    </svg>
                                                </button>
                                                <button @click="askRemoveItem(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M18 6L6 18M6 6l12 12"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>

                                        <!-- Активно + Наценка -->
                                        <div class="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span>
                                                <button
                                                    type="button"
                                                    :disabled="!canEditSvc"
                                                    @click="toggleAvailability(item)"
                                                    class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none"
                                                    style="-webkit-tap-highlight-color: transparent;"
                                                    :class="isItemAvailable(item) ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"
                                                >
                                                    <span
                                                        class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform"
                                                        :class="isItemAvailable(item) ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"
                                                    ></span>
                                                </button>
                                            </div>
                                            <div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span>
                                                <input
                                                    :value="item.markupPercent ?? 0"
                                                    :disabled="!canEditSvc"
                                                    @input="(e) => { item.markupPercent = Math.max(0, Number(e.target.value) || 0); markDirty(); }"
                                                    type="number" min="0" step="1"
                                                    class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"
                                                >
                                                <span class="text-[11px] font-black text-gray-400">%</span>
                                            </div>
                                        </div>

                                        <!-- DTF блок — идентичен LaserSettings processing area_cm2 -->
                                        <div class="bg-gray-50 dark:bg-black/20 rounded-2xl p-4 mt-auto">
                                            <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-3 py-3">
                                                <div class="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p class="text-[10px] font-black uppercase tracking-widest text-gray-900 dark:text-white">DTF Печать</p>
                                                        <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">Настройка ведётся через закупку за погонный метр и ширину рулона. Цена за см² считается автоматически.</p>
                                                    </div>
                                                    <div class="shrink-0 rounded-2xl bg-gray-50 dark:bg-white/5 px-3 py-2 text-right shadow-sm ring-1 ring-gray-200 dark:ring-white/10">
                                                        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-300">Итог</p>
                                                        <p class="mt-1 text-sm font-black text-gray-900 dark:text-white">{{ formatDtfPricePerCm2WithMarkup(item) }} ₽/см²</p>
                                                    </div>
                                                </div>
                                                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                                                    <div>
                                                        <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Закупка за 1 пог. м</label>
                                                        <input
                                                            :value="item.dtfLinearMeterPrice ?? DEFAULT_DTF_LINEAR_METER_PRICE"
                                                            :disabled="!canEditSvc"
                                                            @input="(e) => updateDtfLinearPrice(item, e.target.value)"
                                                            type="number" min="0" step="0.01"
                                                            class="w-full h-11 bg-white dark:bg-[#232326] rounded-xl border border-gray-200 dark:border-white/10 px-3 text-sm font-black outline-none dark:text-white"
                                                        >
                                                    </div>
                                                    <div>
                                                        <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Ширина рулона (мм)</label>
                                                        <input
                                                            :value="item.dtfWidthMm ?? DEFAULT_DTF_ROLL_WIDTH_MM"
                                                            :disabled="!canEditSvc"
                                                            @input="(e) => updateDtfWidth(item, e.target.value)"
                                                            type="number" min="1"
                                                            class="w-full h-11 bg-white dark:bg-[#232326] rounded-xl border border-gray-200 dark:border-white/10 px-3 text-sm font-black outline-none dark:text-white"
                                                        >
                                                    </div>
                                                </div>
                                                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                                                    <div class="rounded-2xl bg-gray-50 dark:bg-white/5 px-3 py-2 ring-1 ring-gray-200 dark:ring-white/10">
                                                        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Себестоимость</p>
                                                        <p class="mt-1 text-sm font-black text-gray-900 dark:text-white">{{ formatDtfPricePerCm2(item) }} ₽/см²</p>
                                                    </div>
                                                    <div class="rounded-2xl bg-gray-50 dark:bg-white/5 px-3 py-2 ring-1 ring-gray-200 dark:ring-white/10">
                                                        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Формула</p>
                                                        <p class="mt-1 text-[11px] font-medium leading-4 text-gray-500 dark:text-gray-300">Цена за см² = цена за пог. м / (ширина в см × 100)</p>
                                                    </div>
                                                </div>
                                                <p class="mt-3 text-[10px] font-medium text-gray-500 dark:text-gray-300">В калькуляторе вводятся ширина, высота и количество изделий.</p>
                                            </div>
                                        </div>

                                    </div>
                                </template>
                            </draggable>
                        </section>
                    </div>

                </div>
            </div>
        </PageScrollWrapper>
    </div>
</template>
