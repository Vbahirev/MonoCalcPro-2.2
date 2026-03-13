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
    buildDefaultDtfFlexColorMarkups,
    buildDefaultDtfFlexMaterials,
    buildLegacyDtfGarmentPriceMap,
    buildDefaultDtfSublimationFormats,
    getDtfFlexPricePerCm2,
    getDtfGarmentFinalPrice,
    getDtfSublimationFormatFinalPrice,
    isDtfClientOwnedGarment,
    normalizeDtfFlexColorMarkups,
    normalizeDtfFlexMaterials,
    normalizeDtfGarments,
    normalizeDtfSublimationFormats,
} from '@/calculators/dtf/constants';
import {
    DEFAULT_DTF_ROLL_WIDTH_MM,
    DEFAULT_DTF_LINEAR_METER_PRICE,
} from '@/utils/coatingPricing';

const router = useRouter();
const route  = useRoute();
const { processingDB, packagingDB, settings, saveFullDatabase, isRemoteUpdate, hasPermission, isOfflineMode } = useDatabase();
const { impactLight, impactMedium, notificationSuccess, notificationError } = useHaptics();

// ─── Права ────────────────────────────────────────────────────────────────────
const canEditSvc = computed(() =>
    hasPermission('settings.prices.write') ||
    hasPermission('canEditPrices') ||
    hasPermission('canEditGlobalSettings')
);
const canViewConfig = computed(() => hasPermission('settings.global.view') || hasPermission('canViewSettings') || canEditSvc.value);
const canEditConfig = computed(() => hasPermission('settings.global.write') || hasPermission('canEditGlobalSettings') || canEditSvc.value);

// ─── Состояние ────────────────────────────────────────────────────────────────
const isSaving            = ref(false);
const hasUnsavedChanges   = ref(false);
const highlightedId       = ref(null);
const deleteConfirmationId = ref(null);
const garmentDeleteConfirmationId = ref(null);
const packagingDeleteConfirmationId = ref(null);
const flexDeleteConfirmationId = ref(null);
const sublimationDeleteConfirmationId = ref(null);
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
const filteredPackagingItems = computed(() => {
    const q = String(searchQuery.value || '').trim();
    const items = packagingDB.value || [];
    if (!q) return items;
    const variants = getSearchVariants(q);
    return items.filter(item => {
        const blob = buildDeepSearchBlob(item, 3, 80);
        return variants.some(v => blob.includes(v));
    });
});
const filteredGarments = computed(() => {
    const q = String(searchQuery.value || '').trim();
    const items = dtfGarments.value || [];
    if (!q) return items;
    const variants = getSearchVariants(q);
    return items.filter(item => {
        const blob = buildDeepSearchBlob(item, 3, 80);
        return variants.some(v => blob.includes(v));
    });
});
const filteredFlexMaterials = computed(() => {
    const q = String(searchQuery.value || '').trim();
    const items = dtfFlexMaterials.value || [];
    if (!q) return items;
    const variants = getSearchVariants(q);
    return items.filter((item) => {
        const blob = buildDeepSearchBlob(item, 3, 80);
        return variants.some((v) => blob.includes(v));
    });
});
const filteredSublimationFormats = computed(() => {
    const q = String(searchQuery.value || '').trim();
    const items = dtfSublimationFormats.value || [];
    if (!q) return items;
    const variants = getSearchVariants(q);
    return items.filter((item) => {
        const blob = buildDeepSearchBlob(item, 3, 80);
        return variants.some((v) => blob.includes(v));
    });
});
const configSearchBlob = computed(() => [
    'конфигурация',
    'доступ',
    'редактор',
    'риск печати на материале клиента',
    'материал клиента',
    settings.value?.clientMaterialPrintRiskPercent,
].map((value) => String(value ?? '').trim()).filter(Boolean).join(' | ').toLowerCase());
const configMatchesSearch = computed(() => {
    const q = String(searchQuery.value || '').trim();
    if (!q) return true;
    const variants = getSearchVariants(q);
    return variants.some((variant) => configSearchBlob.value.includes(variant));
});
const activeTab = ref('all');
const tabs = computed(() => ([
    { value: 'all', label: 'Все разделы' },
    { value: 'config', label: 'Конфигурация' },
    { value: 'dtf', label: 'Пресеты печати' },
    { value: 'flex', label: 'Флекс' },
    { value: 'sublimation', label: 'Сублимация' },
    { value: 'garments', label: 'Изделия' },
    { value: 'packaging', label: 'Упаковка' },
]));

const packagingOperationTypes = [
    { value: 'pieces', label: 'Шт.' },
    { value: 'fixed', label: 'Фикс.' },
    { value: 'linear', label: 'М.' },
    { value: 'linear_mm', label: 'ММ' },
    { value: 'roll', label: 'Рулон' },
    { value: 'box_mm', label: 'Коробка' },
];

const normalizePackagingRollWidthMm = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 500;
    return parsed;
};

const normalizeGarmentMoney = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeGarmentMarkup = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeClientMaterialRisk = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeFlexMoney = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeFlexRollWidth = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
};

const normalizeFlexColorMarkup = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeSublimationPrice = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeSublimationSize = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const syncGarmentSettings = (items, options = {}) => {
    const { markAsDirty = false } = options;
    const normalized = normalizeDtfGarments(items, settings.value?.dtfGarmentPrices);
    const nextPriceMap = buildLegacyDtfGarmentPriceMap(normalized);
    const prevItems = JSON.stringify(settings.value?.dtfGarments || []);
    const nextItems = JSON.stringify(normalized);
    const prevPriceMap = JSON.stringify(settings.value?.dtfGarmentPrices || {});
    const nextPrices = JSON.stringify(nextPriceMap);

    if (prevItems === nextItems && prevPriceMap === nextPrices) return;

    settings.value = {
        ...settings.value,
        dtfGarments: normalized,
        dtfGarmentPrices: nextPriceMap,
    };

    if (markAsDirty) markDirty();
};

const dtfGarments = computed({
    get: () => normalizeDtfGarments(settings.value?.dtfGarments, settings.value?.dtfGarmentPrices),
    set: (items) => syncGarmentSettings(items, { markAsDirty: true }),
});

const syncFlexColorMarkupSettings = (items, options = {}) => {
    const { markAsDirty = false } = options;
    const normalized = normalizeDtfFlexColorMarkups(items);
    const prevItems = JSON.stringify(settings.value?.dtfFlexColorMarkups || []);
    const nextItems = JSON.stringify(normalized);
    if (prevItems === nextItems) return;
    settings.value = {
        ...settings.value,
        dtfFlexColorMarkups: normalized,
    };
    if (markAsDirty) markDirty();
};

const dtfFlexColorMarkups = computed({
    get: () => normalizeDtfFlexColorMarkups(settings.value?.dtfFlexColorMarkups),
    set: (items) => syncFlexColorMarkupSettings(items, { markAsDirty: true }),
});

const syncFlexSettings = (items, options = {}) => {
    const { markAsDirty = false } = options;
    const normalized = normalizeDtfFlexMaterials(items);
    const prevItems = JSON.stringify(settings.value?.dtfFlexMaterials || []);
    const nextItems = JSON.stringify(normalized);
    if (prevItems === nextItems) return;
    settings.value = {
        ...settings.value,
        dtfFlexMaterials: normalized,
    };
    if (markAsDirty) markDirty();
};

const dtfFlexMaterials = computed({
    get: () => normalizeDtfFlexMaterials(settings.value?.dtfFlexMaterials),
    set: (items) => syncFlexSettings(items, { markAsDirty: true }),
});

const syncSublimationSettings = (items, options = {}) => {
    const { markAsDirty = false } = options;
    const normalized = normalizeDtfSublimationFormats(items);
    const prevItems = JSON.stringify(settings.value?.dtfSublimationFormats || []);
    const nextItems = JSON.stringify(normalized);
    if (prevItems === nextItems) return;
    settings.value = {
        ...settings.value,
        dtfSublimationFormats: normalized,
    };
    if (markAsDirty) markDirty();
};

const dtfSublimationFormats = computed({
    get: () => normalizeDtfSublimationFormats(settings.value?.dtfSublimationFormats),
    set: (items) => syncSublimationSettings(items, { markAsDirty: true }),
});

const currentStateSignature = computed(() => JSON.stringify({
    clientMaterialPrintRiskPercent: Math.max(0, Number(settings.value?.clientMaterialPrintRiskPercent) || 0),
    processing: processingDB.value || [],
    packaging: packagingDB.value || [],
    dtfGarments: normalizeDtfGarments(settings.value?.dtfGarments, settings.value?.dtfGarmentPrices),
    dtfFlexColorMarkups: normalizeDtfFlexColorMarkups(settings.value?.dtfFlexColorMarkups),
    dtfFlexMaterials: normalizeDtfFlexMaterials(settings.value?.dtfFlexMaterials),
    dtfSublimationFormats: normalizeDtfSublimationFormats(settings.value?.dtfSublimationFormats),
}));

const lastSavedSignature = ref(currentStateSignature.value);

const setSavedSnapshot = (signature = currentStateSignature.value) => {
    lastSavedSignature.value = signature;
    hasUnsavedChanges.value = false;
};

const syncPackagingSettings = (items) => {
    packagingDB.value = Array.isArray(items) ? items : [];
    markDirty();
};

const addGarmentItem = () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const newItem = {
        id: `dtf_garment_${Date.now()}`,
        name: 'Новое изделие',
        active: true,
        purchasePrice: 0,
        markupPercent: 0,
    };
    dtfGarments.value = [newItem, ...dtfGarments.value];
    highlightedId.value = newItem.id;
    setTimeout(() => { if (highlightedId.value === newItem.id) highlightedId.value = null; }, 2000);
};

const updateGarmentItem = (garmentId, patch) => {
    dtfGarments.value = dtfGarments.value.map((item) => {
        if (item.id !== garmentId) return item;
        const nextItem = {
            ...item,
            ...patch,
        };
        return {
            ...nextItem,
            purchasePrice: isDtfClientOwnedGarment(nextItem) ? 0 : normalizeGarmentMoney(nextItem.purchasePrice),
        };
    });
};

const duplicateGarmentItem = (item) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const duplicate = {
        ...item,
        id: `dtf_garment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${item.name || 'Изделие'} копия`,
    };
    dtfGarments.value = [duplicate, ...dtfGarments.value];
    highlightedId.value = duplicate.id;
    setTimeout(() => { if (highlightedId.value === duplicate.id) highlightedId.value = null; }, 2000);
};

const addFlexMaterialItem = () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const fallback = buildDefaultDtfFlexMaterials()[0] || {};
    const newItem = {
        id: `dtf_flex_${Date.now()}`,
        name: fallback.name || 'Новый флекс',
        active: true,
        inStock: true,
        markupPercent: 0,
        linearMeterPrice: 0,
        rollWidthMm: 500,
    };
    dtfFlexMaterials.value = [newItem, ...dtfFlexMaterials.value];
    highlightedId.value = newItem.id;
    setTimeout(() => { if (highlightedId.value === newItem.id) highlightedId.value = null; }, 2000);
};

const updateFlexColorMarkupItem = (colors, patch) => {
    dtfFlexColorMarkups.value = dtfFlexColorMarkups.value.map((item) => (
        item.colors === colors ? { ...item, ...patch } : item
    ));
};

const updateFlexMaterialItem = (itemId, patch) => {
    dtfFlexMaterials.value = dtfFlexMaterials.value.map((item) => item.id === itemId ? { ...item, ...patch } : item);
};

const duplicateFlexMaterialItem = (item) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const duplicate = {
        ...item,
        id: `dtf_flex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${item.name || 'Флекс'} копия`,
    };
    dtfFlexMaterials.value = [duplicate, ...dtfFlexMaterials.value];
    highlightedId.value = duplicate.id;
    setTimeout(() => { if (highlightedId.value === duplicate.id) highlightedId.value = null; }, 2000);
};

const askRemoveFlexMaterial = (id) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactMedium();
    flexDeleteConfirmationId.value = id;
};

const cancelFlexDelete = () => {
    impactLight();
    flexDeleteConfirmationId.value = null;
};

const confirmFlexDelete = (id) => {
    dtfFlexMaterials.value = dtfFlexMaterials.value.filter((item) => item.id !== id);
    flexDeleteConfirmationId.value = null;
    impactMedium();
};

const toggleFlexAvailability = (item) => {
    updateFlexMaterialItem(item.id, { active: item.active === false });
};

const addSublimationFormatItem = () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const fallback = buildDefaultDtfSublimationFormats()[1] || buildDefaultDtfSublimationFormats()[0] || {};
    const newItem = {
        id: `dtf_sublimation_${Date.now()}`,
        name: fallback.name || 'Новый формат',
        active: true,
        markupPercent: 0,
        widthMm: fallback.widthMm || 210,
        heightMm: fallback.heightMm || 297,
        price: 0,
    };
    dtfSublimationFormats.value = [newItem, ...dtfSublimationFormats.value];
    highlightedId.value = newItem.id;
    setTimeout(() => { if (highlightedId.value === newItem.id) highlightedId.value = null; }, 2000);
};

const updateSublimationFormatItem = (itemId, patch) => {
    dtfSublimationFormats.value = dtfSublimationFormats.value.map((item) => item.id === itemId ? { ...item, ...patch } : item);
};

const duplicateSublimationFormatItem = (item) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const duplicate = {
        ...item,
        id: `dtf_sublimation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${item.name || 'Формат'} копия`,
    };
    dtfSublimationFormats.value = [duplicate, ...dtfSublimationFormats.value];
    highlightedId.value = duplicate.id;
    setTimeout(() => { if (highlightedId.value === duplicate.id) highlightedId.value = null; }, 2000);
};

const askRemoveSublimationFormat = (id) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactMedium();
    sublimationDeleteConfirmationId.value = id;
};

const cancelSublimationDelete = () => {
    impactLight();
    sublimationDeleteConfirmationId.value = null;
};

const confirmSublimationDelete = (id) => {
    dtfSublimationFormats.value = dtfSublimationFormats.value.filter((item) => item.id !== id);
    sublimationDeleteConfirmationId.value = null;
    impactMedium();
};

const toggleSublimationAvailability = (item) => {
    updateSublimationFormatItem(item.id, { active: item.active === false });
};

const addPackagingItem = () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const newItem = {
        id: `packaging_${Date.now()}`,
        name: 'Новая упаковка',
        active: true,
        markupPercent: 0,
        type: 'pieces',
        price: 0,
        rollWidthMm: 500,
    };
    packagingDB.value = [newItem, ...(packagingDB.value || [])];
    highlightedId.value = newItem.id;
    markDirty();
    setTimeout(() => { if (highlightedId.value === newItem.id) highlightedId.value = null; }, 2000);
};

const duplicatePackagingItem = (item) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactLight();
    const copy = {
        ...JSON.parse(JSON.stringify(item)),
        id: `packaging_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${item.name || 'Упаковка'} копия`,
    };
    packagingDB.value = [copy, ...(packagingDB.value || [])];
    highlightedId.value = copy.id;
    markDirty();
    setTimeout(() => { if (highlightedId.value === copy.id) highlightedId.value = null; }, 2000);
};

const askRemovePackaging = (id) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    impactMedium();
    packagingDeleteConfirmationId.value = id;
};

const cancelPackagingDelete = () => {
    impactLight();
    packagingDeleteConfirmationId.value = null;
};

const confirmPackagingDelete = (id) => {
    packagingDB.value = (packagingDB.value || []).filter((item) => item.id !== id);
    packagingDeleteConfirmationId.value = null;
    impactMedium();
    markDirty();
};

const askRemoveGarment = (id) => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    if (id === 'client_garment') { notificationError('Системное изделие нельзя удалить'); return; }
    impactMedium();
    garmentDeleteConfirmationId.value = id;
};

const cancelGarmentDelete = () => {
    impactLight();
    garmentDeleteConfirmationId.value = null;
};

const confirmGarmentDelete = (id) => {
    if (id === 'client_garment') {
        garmentDeleteConfirmationId.value = null;
        notificationError('Системное изделие нельзя удалить');
        return;
    }
    dtfGarments.value = dtfGarments.value.filter((item) => item.id !== id);
    impactMedium();
    garmentDeleteConfirmationId.value = null;
};

const toggleGarmentAvailability = (item) => {
    updateGarmentItem(item.id, { active: item.active === false });
};

const togglePackagingAvailability = (item) => {
    item.active = item?.active === false;
    markDirty();
};

const getGarmentSalePrice = (item) => getDtfGarmentFinalPrice(item);
const isClientOwnedGarment = (item) => isDtfClientOwnedGarment(item);
const isLockedGarment = (item) => item?.id === 'client_garment';
const clientMaterialPrintRiskPercent = computed({
    get: () => Math.max(0, Number(settings.value?.clientMaterialPrintRiskPercent) || 0),
    set: (value) => {
        settings.value = {
            ...settings.value,
            clientMaterialPrintRiskPercent: normalizeClientMaterialRisk(value),
        };
        markDirty();
    },
});

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
        name: 'Нанесение на текстиль',
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
const markDirty = () => {
    if (isRemoteUpdate?.value) return;
    hasUnsavedChanges.value = currentStateSignature.value !== lastSavedSignature.value;
};

watch(currentStateSignature, (nextSignature) => {
    if (isRemoteUpdate?.value) {
        setSavedSnapshot(nextSignature);
        return;
    }
    hasUnsavedChanges.value = nextSignature !== lastSavedSignature.value;
}, { immediate: true });

watch(() => settings.value?.dtfGarments, (nextItems) => {
    if (isRemoteUpdate?.value) return;
    syncGarmentSettings(nextItems || [], { markAsDirty: false });
}, { deep: true, immediate: true });

const handleSave = async () => {
    if (!canEditSvc.value) { notificationError('Нет прав'); return; }
    isSaving.value = true;
    impactMedium();
    try {
        const ok = await saveFullDatabase();
        if (ok) {
            setSavedSnapshot();
            notificationSuccess('Настройки текстиля сохранены');
        }
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
                            Настройки <span class="inline-block text-transparent bg-clip-text bg-gradient-to-br from-gray-600 to-black dark:from-gray-300 dark:to-white">текстиля</span>
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
                            <input v-model="searchQuery" class="block w-full h-full pl-12 pr-12 bg-transparent rounded-2xl text-sm font-bold outline-none text-inherit placeholder-gray-400/70 transition-colors cursor-text" placeholder="Найти настройку...">
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
                        <section v-if="(activeTab === 'all' || activeTab === 'config') && canViewConfig && configMatchesSearch">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Конфигурация</h2>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div :class="cardClass">
                                    <div class="flex items-start gap-4">
                                        <div class="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-500/10 text-violet-500 dark:text-violet-300 flex items-center justify-center shrink-0">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                                <circle cx="12" cy="7" r="4"></circle>
                                            </svg>
                                        </div>
                                        <div class="min-w-0">
                                            <label class="text-[10px] font-bold uppercase text-gray-400 block mb-0.5">Доступ</label>
                                            <h3 class="font-black text-black dark:text-white text-lg leading-none">{{ canEditConfig || canEditSvc ? 'Редактор' : 'Пользователь' }}</h3>
                                        </div>
                                    </div>
                                    <p class="mt-5 text-sm text-gray-500 dark:text-gray-400 font-medium">Ваш уровень доступа ограничен выданными правами.</p>
                                </div>

                                <div :class="cardClass">
                                    <div class="flex items-start gap-4 mb-4">
                                        <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-300 flex items-center justify-center shrink-0">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"></path>
                                                <path d="M12 9v4"></path>
                                                <path d="M12 17h.01"></path>
                                            </svg>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div><label class="text-[10px] font-bold uppercase text-gray-400 block mb-0.5">Риск</label><h3 class="font-black text-black dark:text-white text-lg leading-none">Печать на материале клиента</h3></div>
                                        </div>
                                    </div>
                                    <div class="rounded-[1.35rem] border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3">
                                        <div class="flex items-center gap-3">
                                            <input :value="clientMaterialPrintRiskPercent" :disabled="!canEditConfig" @input="clientMaterialPrintRiskPercent = $event.target.value" type="number" min="0" step="1" class="w-full h-14 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-2xl font-black outline-none dark:text-white disabled:opacity-60">
                                            <span class="text-sm font-black text-gray-400 dark:text-gray-500">%</span>
                                        </div>
                                    </div>
                                    <p class="mt-3 text-[10px] font-medium text-gray-400">Применяется только к стоимости нанесения, если выбрано изделие клиента.</p>
                                </div>
                            </div>
                        </section>

                        <section v-if="activeTab === 'all' || activeTab === 'dtf'">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Нанесение на текстиль</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredDtfItems.length }}</span>
                            </div>

                            <!-- Пустой стейт — нет пресетов вообще -->
                            <div v-if="!dtfItems.length" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
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
                                        <div class="flex items-start gap-3 mb-4">
                                            <div
                                                class="drag-handle shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1"
                                                :class="{ 'opacity-0 pointer-events-none': !canEditSvc }"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
                                                    <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
                                                </svg>
                                            </div>
                                            <div class="min-w-0 flex-1 flex items-start gap-2.5">
                                                <input
                                                    v-model="item.name"
                                                    @input="markDirty"
                                                    :disabled="!canEditSvc"
                                                    class="min-w-0 w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500"
                                                    placeholder="Название"
                                                >
                                                <div v-if="canEditSvc" class="shrink-0 flex items-center gap-0.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-1.5 py-1 shadow-sm">
                                                    <button @click="duplicateItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5 rounded-lg hover:bg-white dark:hover:bg-white/5" title="Копировать">
                                                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                            <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                        </svg>
                                                    </button>
                                                    <button @click="askRemoveItem(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                            <path d="M18 6L6 18M6 6l12 12"></path>
                                                        </svg>
                                                    </button>
                                                </div>
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
                                                        <p class="text-[10px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Нанесение на текстиль</p>
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

                        <section v-if="activeTab === 'all' || activeTab === 'flex'">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Флекс</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredFlexMaterials.length }}</span>
                            </div>

                            <div class="mb-4 rounded-[1.5rem] border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-5 shadow-sm">
                                <div class="flex items-start justify-between gap-4 mb-4">
                                    <div>
                                        <p class="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Общая настройка</p>
                                        <h3 class="mt-1 text-lg font-black text-black dark:text-white">Наценка за количество цветов</h3>
                                        <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Эта наценка применяется ко всем флекс-материалам поверх их базовой цены.</p>
                                    </div>
                                    <div class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">1-6 цветов</div>
                                </div>
                                <div class="grid grid-cols-2 lg:grid-cols-6 gap-3">
                                    <div v-for="tier in dtfFlexColorMarkups" :key="tier.colors" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3">
                                        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">{{ tier.label }}</p>
                                        <div class="mt-3 flex items-center gap-3">
                                            <input :value="tier.markupPercent" :disabled="!canEditSvc" @input="(e) => updateFlexColorMarkupItem(tier.colors, { markupPercent: normalizeFlexColorMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60">
                                            <span class="text-sm font-black text-gray-400 dark:text-gray-500">%</span>
                                        </div>
                                        <p class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Итоговый коэффициент: ×{{ (1 + ((Number(tier.markupPercent) || 0) / 100)).toFixed(2) }}</p>
                                    </div>
                                </div>
                            </div>

                            <div v-if="!dtfFlexMaterials.length" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addFlexMaterialItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                            </div>

                            <div v-else-if="!filteredFlexMaterials.length" class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest">
                                Ничего не найдено по запросу «{{ searchQuery }}»
                            </div>

                            <div v-else-if="searchQuery" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addFlexMaterialItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                                <div v-for="item in filteredFlexMaterials" :key="item.id" :class="[cardClass, 'min-h-[280px] flex flex-col justify-between', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': flexDeleteConfirmationId === item.id }]">
                                    <div v-if="flexDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                        <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                        <div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md"><p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p><h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить этот флекс?</h3><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Материал исчезнет из DTF-калькулятора после сохранения.</p></div>
                                        <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md"><div class="grid grid-cols-2 gap-2"><button @click="cancelFlexDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button><button @click="confirmFlexDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button></div></div>
                                    </div>
                                    <div>
                                        <div class="flex justify-between items-start gap-3 mb-4">
                                            <div class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Флекс</div>
                                            <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5"><button @click="duplicateFlexMaterialItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button @click="askRemoveFlexMaterial(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button></div>
                                        </div>
                                        <input :value="item.name" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { name: e.target.value })" class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название флекса">
                                        <p class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Цена за см² считается из цены за погонный метр и ширины рулона.</p>
                                    </div>
                                        <div class="mt-4 space-y-3">
                                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Доступно</span><button type="button" :disabled="!canEditSvc" @click="toggleFlexAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"><span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span></button></div>
                                                <div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span><input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"><span class="text-[11px] font-black text-gray-400">%</span></div>
                                            </div>
                                        <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3">
                                            <div class="grid gap-3 sm:grid-cols-2">
                                                <div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Цена за пог. м</label><div class="flex items-center gap-3"><input :value="item.linearMeterPrice" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { linearMeterPrice: normalizeFlexMoney(e.target.value) })" type="number" min="0" step="0.01" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span></div></div>
                                                <div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Ширина рулона</label><div class="flex items-center gap-3"><input :value="item.rollWidthMm" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { rollWidthMm: normalizeFlexRollWidth(e.target.value) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div>
                                            </div>
                                            <div class="mt-3 rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10">
                                                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p>
                                                <p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ getDtfFlexPricePerCm2(item).toFixed(4) }} ₽/см²</p>
                                                <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">Из цены за пог. м, ширины рулона и наценки.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <draggable v-else v-model="dtfFlexMaterials" item-key="id" tag="div" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start" handle=".drag-handle" :animation="250" ghost-class="ghost-card" @end="onDragEnd" :disabled="!canEditSvc">
                                <template #header>
                                    <button v-if="canEditSvc" @click="addFlexMaterialItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"><div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div><span>Добавить</span></button>
                                </template>
                                <template #item="{ element: item }">
                                    <div :class="[cardClass, 'min-h-[280px] flex flex-col justify-between', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': flexDeleteConfirmationId === item.id }]">
                                        <div v-if="flexDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden"><div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div><div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md"><p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p><h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить этот флекс?</h3><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Материал исчезнет из DTF-калькулятора после сохранения.</p></div><div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md"><div class="grid grid-cols-2 gap-2"><button @click="cancelFlexDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button><button @click="confirmFlexDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button></div></div></div>
                                        <div><div class="flex justify-between items-start gap-3 mb-4"><div class="drag-handle cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1" :class="{ 'opacity-0 pointer-events-none': !canEditSvc }"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg></div><div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5"><button @click="duplicateFlexMaterialItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button @click="askRemoveFlexMaterial(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button></div></div><input :value="item.name" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { name: e.target.value })" class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название флекса"><p class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Цена за см² считается из цены за погонный метр и ширины рулона.</p></div>
                                        <div class="mt-4 space-y-3"><div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Доступно</span><button type="button" :disabled="!canEditSvc" @click="toggleFlexAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"><span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span></button></div><div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span><input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"><span class="text-[11px] font-black text-gray-400">%</span></div></div><div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3"><div class="grid gap-3 sm:grid-cols-2"><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Цена за пог. м</label><div class="flex items-center gap-3"><input :value="item.linearMeterPrice" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { linearMeterPrice: normalizeFlexMoney(e.target.value) })" type="number" min="0" step="0.01" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span></div></div><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Ширина рулона</label><div class="flex items-center gap-3"><input :value="item.rollWidthMm" :disabled="!canEditSvc" @input="(e) => updateFlexMaterialItem(item.id, { rollWidthMm: normalizeFlexRollWidth(e.target.value) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div></div><div class="mt-3 rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10"><p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p><p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ getDtfFlexPricePerCm2(item).toFixed(4) }} ₽/см²</p><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">Из цены за пог. м, ширины рулона и наценки.</p></div></div></div>
                                    </div>
                                </template>
                            </draggable>
                        </section>

                        <section v-if="activeTab === 'all' || activeTab === 'sublimation'">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Сублимация</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredSublimationFormats.length }}</span>
                            </div>

                            <div v-if="!dtfSublimationFormats.length" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addSublimationFormatItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"><div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div><span>Добавить</span></button>
                            </div>

                            <div v-else-if="!filteredSublimationFormats.length" class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest">Ничего не найдено по запросу «{{ searchQuery }}»</div>

                            <div v-else-if="searchQuery" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addSublimationFormatItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"><div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div><span>Добавить</span></button>
                                <div v-for="item in filteredSublimationFormats" :key="item.id" :class="[cardClass, 'min-h-[280px] flex flex-col justify-between', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': sublimationDeleteConfirmationId === item.id }]">
                                    <div v-if="sublimationDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden"><div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div><div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md"><p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p><h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить этот формат?</h3><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Формат исчезнет из DTF-калькулятора после сохранения.</p></div><div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md"><div class="grid grid-cols-2 gap-2"><button @click="cancelSublimationDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button><button @click="confirmSublimationDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button></div></div></div>
                                    <div><div class="flex justify-between items-start gap-3 mb-4"><div class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Сублимация</div><div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5"><button @click="duplicateSublimationFormatItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button @click="askRemoveSublimationFormat(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button></div></div><input :value="item.name" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { name: e.target.value })" class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название формата"><p class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Формат задаёт размер печати и итоговую цену листа/позиции.</p></div>
                                    <div class="mt-4 space-y-3"><div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span><button type="button" :disabled="!canEditSvc" @click="toggleSublimationAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"><span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span></button></div><div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span><input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"><span class="text-[11px] font-black text-gray-400">%</span></div></div><div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3"><div class="grid gap-3 sm:grid-cols-3"><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Ширина</label><div class="flex items-center gap-3"><input :value="item.widthMm" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { widthMm: normalizeSublimationSize(e.target.value, 210) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Высота</label><div class="flex items-center gap-3"><input :value="item.heightMm" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { heightMm: normalizeSublimationSize(e.target.value, 297) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Цена</label><div class="flex items-center gap-3"><input :value="item.price" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { price: normalizeSublimationPrice(e.target.value) })" type="number" min="0" step="0.01" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span></div></div></div><div class="mt-3 rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10"><p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p><p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ Math.round(getDtfSublimationFormatFinalPrice(item)).toLocaleString() }} ₽</p><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">{{ item.widthMm }}×{{ item.heightMm }} мм · цена с наценкой.</p></div></div></div>
                                </div>
                            </div>

                            <draggable v-else v-model="dtfSublimationFormats" item-key="id" tag="div" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start" handle=".drag-handle" :animation="250" ghost-class="ghost-card" @end="onDragEnd" :disabled="!canEditSvc">
                                <template #header>
                                    <button v-if="canEditSvc" @click="addSublimationFormatItem" class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"><div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div><span>Добавить</span></button>
                                </template>
                                <template #item="{ element: item }">
                                    <div :class="[cardClass, 'min-h-[280px] flex flex-col justify-between', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': sublimationDeleteConfirmationId === item.id }]">
                                        <div v-if="sublimationDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden"><div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div><div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md"><p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p><h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить этот формат?</h3><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Формат исчезнет из DTF-калькулятора после сохранения.</p></div><div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md"><div class="grid grid-cols-2 gap-2"><button @click="cancelSublimationDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button><button @click="confirmSublimationDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button></div></div></div>
                                        <div><div class="flex justify-between items-start gap-3 mb-4"><div class="drag-handle cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1" :class="{ 'opacity-0 pointer-events-none': !canEditSvc }"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg></div><div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5"><button @click="duplicateSublimationFormatItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button @click="askRemoveSublimationFormat(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button></div></div><input :value="item.name" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { name: e.target.value })" class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название формата"><p class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Формат задаёт размер печати и итоговую цену листа/позиции.</p></div>
                                        <div class="mt-4 space-y-3"><div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span><button type="button" :disabled="!canEditSvc" @click="toggleSublimationAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"><span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span></button></div><div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2"><span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span><input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"><span class="text-[11px] font-black text-gray-400">%</span></div></div><div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3"><div class="grid gap-3 sm:grid-cols-3"><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Ширина</label><div class="flex items-center gap-3"><input :value="item.widthMm" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { widthMm: normalizeSublimationSize(e.target.value, 210) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Высота</label><div class="flex items-center gap-3"><input :value="item.heightMm" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { heightMm: normalizeSublimationSize(e.target.value, 297) })" type="number" min="1" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-xs font-black text-gray-400 dark:text-gray-500">мм</span></div></div><div><label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Цена</label><div class="flex items-center gap-3"><input :value="item.price" :disabled="!canEditSvc" @input="(e) => updateSublimationFormatItem(item.id, { price: normalizeSublimationPrice(e.target.value) })" type="number" min="0" step="0.01" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"><span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span></div></div></div><div class="mt-3 rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10"><p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p><p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ Math.round(getDtfSublimationFormatFinalPrice(item)).toLocaleString() }} ₽</p><p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">{{ item.widthMm }}×{{ item.heightMm }} мм · цена с наценкой.</p></div></div></div>
                                    </div>
                                </template>
                            </draggable>
                        </section>

                        <section v-if="activeTab === 'all' || activeTab === 'garments'">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Цены изделий</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredGarments.length }}</span>
                            </div>

                            <div v-if="!dtfGarments.length" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button
                                    v-if="canEditSvc"
                                    @click="addGarmentItem"
                                    class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"
                                >
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                            </div>

                            <div
                                v-else-if="!filteredGarments.length"
                                class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest"
                            >
                                Ничего не найдено по запросу «{{ searchQuery }}»
                            </div>

                            <div v-else-if="searchQuery" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button
                                    v-if="canEditSvc"
                                    @click="addGarmentItem"
                                    class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"
                                >
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                                <div
                                    v-for="item in filteredGarments"
                                    :key="item.id"
                                    :class="[cardClass, 'min-h-[260px] flex flex-col justify-between', {
                                        'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id,
                                        'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': garmentDeleteConfirmationId === item.id
                                    }]"
                                >
                                    <div v-if="garmentDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                        <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                        <div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md">
                                            <p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p>
                                            <h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить это изделие?</h3>
                                            <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Карточка исчезнет из DTF-калькулятора после сохранения настроек.</p>
                                        </div>
                                        <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md">
                                            <div class="grid grid-cols-2 gap-2">
                                                <button @click="cancelGarmentDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button>
                                                <button @click="confirmGarmentDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="flex justify-between items-start gap-3 mb-4">
                                            <div class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Изделие</div>
                                            <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5">
                                                <button v-if="!isLockedGarment(item)" @click="duplicateGarmentItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать">
                                                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                </button>
                                                <button v-if="!isLockedGarment(item)" @click="askRemoveGarment(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                                                </button>
                                            </div>
                                        </div>

                                        <input :value="item.name" :disabled="!canEditSvc" @input="(e) => updateGarmentItem(item.id, { name: e.target.value })" class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название изделия">
                                        <p v-if="isClientOwnedGarment(item)" class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Системное изделие для заказов на материале клиента.</p>
                                        <p v-else class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Карточка управляет закупкой и ценой изделия, которая подставляется в DTF-калькулятор по умолчанию.</p>
                                    </div>

                                    <div class="mt-4 space-y-3">
                                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span>
                                                <button type="button" :disabled="!canEditSvc" @click="toggleGarmentAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'">
                                                    <span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span>
                                                </button>
                                            </div>
                                            <div v-if="!isClientOwnedGarment(item)" class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span>
                                                <input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => updateGarmentItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70">
                                                <span class="text-[11px] font-black text-gray-400">%</span>
                                            </div>
                                            <div v-else class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Системное изделие</span>
                                            </div>
                                        </div>

                                        <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3">
                                            <div class="grid gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Закупка</label>
                                                    <div class="flex items-center gap-3">
                                                        <input :value="item.purchasePrice" :disabled="!canEditSvc || isClientOwnedGarment(item)" @input="(e) => updateGarmentItem(item.id, { purchasePrice: normalizeGarmentMoney(e.target.value) })" type="number" min="0" step="1" class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60">
                                                        <span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span>
                                                    </div>
                                                    <p v-if="isClientOwnedGarment(item)" class="mt-1 text-[10px] font-medium text-gray-400">Для материала клиента закупка не учитывается.</p>
                                                </div>
                                                <div class="rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10">
                                                    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p>
                                                    <p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ Math.round(getGarmentSalePrice(item)).toLocaleString() }} ₽</p>
                                                    <p v-if="isClientOwnedGarment(item)" class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">0 ₽ за изделие клиента</p>
                                                    <p v-else class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">Закупка + {{ item.markupPercent ?? 0 }}% наценки</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <draggable v-else v-model="dtfGarments" item-key="id" tag="div" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start" handle=".drag-handle" :animation="250" ghost-class="ghost-card" @end="onDragEnd" :disabled="!canEditSvc">
                                <template #header>
                                    <button
                                        v-if="canEditSvc"
                                        @click="addGarmentItem"
                                        class="min-h-[260px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker"
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
                                    :class="[cardClass, 'min-h-[260px] flex flex-col justify-between', {
                                        'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id,
                                        'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': garmentDeleteConfirmationId === item.id
                                    }]"
                                >
                                    <div v-if="garmentDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                        <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                        <div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md">
                                            <p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p>
                                            <h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить это изделие?</h3>
                                            <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Карточка исчезнет из DTF-калькулятора после сохранения настроек.</p>
                                        </div>
                                        <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md">
                                            <div class="grid grid-cols-2 gap-2">
                                                <button @click="cancelGarmentDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button>
                                                <button @click="confirmGarmentDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="flex justify-between items-start gap-3 mb-4">
                                            <div class="drag-handle cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1" :class="{ 'opacity-0 pointer-events-none': !canEditSvc }">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
                                                    <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
                                                </svg>
                                            </div>
                                            <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5">
                                                <button v-if="!isLockedGarment(item)" @click="duplicateGarmentItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать">
                                                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                    </svg>
                                                </button>
                                                <button v-if="!isLockedGarment(item)" @click="askRemoveGarment(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M18 6L6 18M6 6l12 12"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>

                                        <input
                                            :value="item.name"
                                            :disabled="!canEditSvc"
                                            @input="(e) => updateGarmentItem(item.id, { name: e.target.value })"
                                            class="w-full font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500"
                                            placeholder="Название изделия"
                                        >
                                        <p v-if="isClientOwnedGarment(item)" class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Системное изделие для заказов на материале клиента.</p>
                                        <p v-else class="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Карточка управляет закупкой и ценой изделия, которая подставляется в DTF-калькулятор по умолчанию.</p>
                                    </div>

                                    <div class="mt-4 space-y-3">
                                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span>
                                                <button
                                                    type="button"
                                                    :disabled="!canEditSvc"
                                                    @click="toggleGarmentAvailability(item)"
                                                    class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none"
                                                    style="-webkit-tap-highlight-color: transparent;"
                                                    :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"
                                                >
                                                    <span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span>
                                                </button>
                                            </div>
                                            <div v-if="!isClientOwnedGarment(item)" class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span>
                                                <input
                                                    :value="item.markupPercent ?? 0"
                                                    :disabled="!canEditSvc"
                                                    @input="(e) => updateGarmentItem(item.id, { markupPercent: normalizeGarmentMarkup(e.target.value) })"
                                                    type="number" min="0" step="1"
                                                    class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70"
                                                >
                                                <span class="text-[11px] font-black text-gray-400">%</span>
                                            </div>
                                            <div v-else class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Системное изделие</span>
                                            </div>
                                        </div>

                                        <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-4 py-3">
                                            <div class="grid gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-2">Закупка</label>
                                                    <div class="flex items-center gap-3">
                                                        <input
                                                            :value="item.purchasePrice"
                                                            :disabled="!canEditSvc || isClientOwnedGarment(item)"
                                                            @input="(e) => updateGarmentItem(item.id, { purchasePrice: normalizeGarmentMoney(e.target.value) })"
                                                            type="number"
                                                            min="0"
                                                            step="1"
                                                            class="w-full h-12 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#232326] px-4 text-right text-lg font-black outline-none dark:text-white disabled:opacity-60"
                                                        >
                                                        <span class="text-sm font-black text-gray-400 dark:text-gray-500">₽</span>
                                                    </div>
                                                    <p v-if="isClientOwnedGarment(item)" class="mt-1 text-[10px] font-medium text-gray-400">Для материала клиента закупка не учитывается.</p>
                                                </div>
                                                <div class="rounded-2xl bg-white dark:bg-[#232326] px-4 py-3 ring-1 ring-gray-200 dark:ring-white/10">
                                                    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Цена в калькуляторе</p>
                                                    <p class="mt-1 text-lg font-black text-gray-900 dark:text-white">{{ Math.round(getGarmentSalePrice(item)).toLocaleString() }} ₽</p>
                                                    <p v-if="isClientOwnedGarment(item)" class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">0 ₽ за изделие клиента</p>
                                                    <p v-else class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300">Закупка + {{ item.markupPercent ?? 0 }}% наценки</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                </template>
                            </draggable>
                        </section>

                        <section v-if="activeTab === 'all' || activeTab === 'packaging'">
                            <div class="flex items-center gap-3 mb-6">
                                <div class="w-1.5 h-6 bg-black dark:bg-white rounded-full"></div>
                                <h2 class="text-xl font-black text-black dark:text-white">Упаковка</h2>
                                <span class="ml-auto text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-1 rounded-lg">{{ filteredPackagingItems.length }}</span>
                            </div>

                            <div v-if="!packagingDB.length" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addPackagingItem" class="min-h-[220px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                            </div>

                            <div v-else-if="!filteredPackagingItems.length" class="rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 p-12 text-center text-gray-400 dark:text-gray-600 font-bold uppercase text-[11px] tracking-widest">
                                Ничего не найдено по запросу «{{ searchQuery }}»
                            </div>

                            <div v-else-if="searchQuery" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <button v-if="canEditSvc" @click="addPackagingItem" class="min-h-[220px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </div>
                                    <span>Добавить</span>
                                </button>
                                <div v-for="item in filteredPackagingItems" :key="item.id" :class="[cardClass, 'self-start', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': packagingDeleteConfirmationId === item.id }]">
                                    <div v-if="packagingDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                        <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                        <div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md">
                                            <p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p>
                                            <h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить эту упаковку?</h3>
                                            <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Карточка исчезнет из DTF-калькулятора после сохранения настроек.</p>
                                        </div>
                                        <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md">
                                            <div class="grid grid-cols-2 gap-2">
                                                <button @click="cancelPackagingDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button>
                                                <button @click="confirmPackagingDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex justify-between items-start gap-3 mb-4">
                                        <div class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Упаковка</div>
                                        <input v-model="item.name" @input="markDirty" :disabled="!canEditSvc" class="flex-1 font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название">
                                        <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5">
                                            <button @click="duplicatePackagingItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                                            <button @click="askRemovePackaging(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>
                                        </div>
                                    </div>
                                    <div class="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span>
                                            <button type="button" :disabled="!canEditSvc" @click="togglePackagingAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'"><span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span></button>
                                        </div>
                                        <div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2">
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span>
                                            <input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => { item.markupPercent = Math.max(0, Number(e.target.value) || 0); markDirty(); }" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70">
                                            <span class="text-[11px] font-black text-gray-400">%</span>
                                        </div>
                                    </div>
                                    <div class="bg-gray-50 dark:bg-black/20 rounded-2xl p-4 grid gap-3">
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Тип</label>
                                                <ModernSelect v-model="item.type" :disabled="!canEditSvc" @update:modelValue="markDirty" :options="packagingOperationTypes" placeholder="Тип" class="w-full text-xs" />
                                            </div>
                                            <div>
                                                <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Цена</label>
                                                <div class="relative"><input v-model.number="item.price" :disabled="!canEditSvc" @input="markDirty" placeholder="0" class="w-full h-14 bg-white dark:bg-[#232326] rounded-2xl border border-gray-200 dark:border-white/10 pl-4 pr-8 text-sm font-black outline-none dark:text-white shadow-sm dark:shadow-black/40 focus:ring-1 ring-black/10 transition-all disabled:opacity-70"><span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">₽</span></div>
                                            </div>
                                        </div>
                                        <div v-if="item.type === 'roll'" class="pt-1">
                                            <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Ширина рулона (мм)</label>
                                            <input :value="item.rollWidthMm ?? 500" :disabled="!canEditSvc" @input="(e) => { item.rollWidthMm = normalizePackagingRollWidthMm(e.target.value); markDirty(); }" type="number" min="1" class="w-full h-11 bg-white dark:bg-[#232326] rounded-xl border border-gray-200 dark:border-white/10 px-3 text-sm font-black outline-none dark:text-white">
                                            <p class="mt-1 text-[10px] font-medium text-gray-400">Стрейч: задайте закупку за погонный метр и ширину рулона.</p>
                                        </div>
                                        <p v-if="item.type === 'box_mm'" class="text-[10px] font-medium text-gray-400">Коробка: цена трактуется как ₽/м², а в калькуляторе вводятся размеры Ш/Д/В.</p>
                                    </div>
                                </div>
                            </div>

                            <draggable v-else v-model="packagingDB" item-key="id" tag="div" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start" handle=".drag-handle" :animation="250" ghost-class="ghost-card" @end="onDragEnd" :disabled="!canEditSvc">
                                <template #header>
                                    <button v-if="canEditSvc" @click="addPackagingItem" class="min-h-[220px] rounded-[1.5rem] border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600 font-bold uppercase text-[10px] tracking-widest hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-all flex flex-col items-center justify-center gap-3 group sm:col-span-1 opacity-70 hover:opacity-100 self-start hover:z-30 relative no-flicker">
                                        <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black shadow-sm">
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                        </div>
                                        <span>Добавить</span>
                                    </button>
                                </template>
                                <template #item="{ element: item }">
                                    <div :class="[cardClass, 'self-start', { 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10': highlightedId === item.id, 'ring-2 ring-red-200 dark:ring-red-500/30 shadow-[0_18px_40px_-28px_rgba(239,68,68,0.55)]': packagingDeleteConfirmationId === item.id }]">
                                        <div v-if="packagingDeleteConfirmationId === item.id" class="absolute inset-0 z-50 rounded-[1.5rem] overflow-hidden">
                                            <div class="absolute inset-0 bg-gradient-to-b from-white/78 via-white/64 to-white/88 dark:from-[#111214]/70 dark:via-[#111214]/60 dark:to-[#111214]/88 backdrop-blur-[2px]"></div>
                                            <div class="absolute inset-x-3 top-3 rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-white/92 dark:bg-[#18181B]/92 px-3.5 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md">
                                                <p class="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-300">Удаление</p>
                                                <h3 class="mt-1 text-sm font-black text-black dark:text-white leading-tight">Удалить эту упаковку?</h3>
                                                <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-300 leading-snug">Карточка исчезнет из DTF-калькулятора после сохранения настроек.</p>
                                            </div>
                                            <div class="absolute inset-x-3 bottom-3 rounded-[1.35rem] border border-gray-200/80 dark:border-white/10 bg-white/94 dark:bg-[#18181B]/94 p-2 shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)] backdrop-blur-md">
                                                <div class="grid grid-cols-2 gap-2">
                                                    <button @click="cancelPackagingDelete" class="h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-100/90 dark:bg-white/5 text-gray-700 dark:text-gray-200 font-bold text-[11px] uppercase tracking-[0.14em] transition-all duration-200 hover:bg-gray-200 dark:hover:bg-white/10">Отмена</button>
                                                    <button @click="confirmPackagingDelete(item.id)" class="h-11 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-[11px] uppercase tracking-[0.14em] shadow-[0_14px_24px_-14px_rgba(239,68,68,0.95)] transition-all duration-200 hover:brightness-105">Удалить</button>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="flex justify-between items-start gap-3 mb-4">
                                            <div class="drag-handle cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white p-1.5 -ml-2 transition-colors flex items-center gap-1" :class="{ 'opacity-0 pointer-events-none': !canEditSvc }">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                                            </div>
                                            <input v-model="item.name" @input="markDirty" :disabled="!canEditSvc" class="flex-1 font-black text-lg outline-none bg-transparent placeholder-gray-300 dark:placeholder-gray-600 dark:text-white leading-tight disabled:text-gray-500" placeholder="Название">
                                            <div v-if="canEditSvc" class="flex items-center -mr-1.5 -mt-1.5">
                                                <button @click="duplicatePackagingItem(item)" class="text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 transition-colors p-1.5" title="Копировать"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                                                <button @click="askRemovePackaging(item.id)" class="text-gray-300 hover:text-red-500 transition-colors p-1.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>
                                            </div>
                                        </div>

                                        <div class="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div class="flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Активно</span>
                                                <button type="button" :disabled="!canEditSvc" @click="togglePackagingAvailability(item)" class="relative inline-flex h-6 w-11 items-center rounded-full border transition-none disabled:opacity-60 focus:outline-none" style="-webkit-tap-highlight-color: transparent;" :class="item.active !== false ? 'bg-[#1d1d1f] border-[#1d1d1f] dark:bg-white dark:border-white' : 'bg-gray-200 dark:bg-white/10 border-gray-300 dark:border-white/20'">
                                                    <span class="inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform" :class="item.active !== false ? 'bg-white dark:bg-black translate-x-5' : 'bg-white translate-x-0.5'"></span>
                                                </button>
                                            </div>
                                            <div class="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 gap-2">
                                                <span class="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">Наценка</span>
                                                <input :value="item.markupPercent ?? 0" :disabled="!canEditSvc" @input="(e) => { item.markupPercent = Math.max(0, Number(e.target.value) || 0); markDirty(); }" type="number" min="0" step="1" class="w-full bg-transparent outline-none text-right text-sm font-black dark:text-white disabled:opacity-70">
                                                <span class="text-[11px] font-black text-gray-400">%</span>
                                            </div>
                                        </div>

                                        <div class="bg-gray-50 dark:bg-black/20 rounded-2xl p-4 grid gap-3">
                                            <div class="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Тип</label>
                                                    <ModernSelect v-model="item.type" :disabled="!canEditSvc" @update:modelValue="markDirty" :options="packagingOperationTypes" placeholder="Тип" class="w-full text-xs" />
                                                </div>
                                                <div>
                                                    <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Цена</label>
                                                    <div class="relative"><input v-model.number="item.price" :disabled="!canEditSvc" @input="markDirty" placeholder="0" class="w-full h-14 bg-white dark:bg-[#232326] rounded-2xl border border-gray-200 dark:border-white/10 pl-4 pr-8 text-sm font-black outline-none dark:text-white shadow-sm dark:shadow-black/40 focus:ring-1 ring-black/10 transition-all disabled:opacity-70"><span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">₽</span></div>
                                                </div>
                                            </div>
                                            <div v-if="item.type === 'roll'" class="pt-1">
                                                <label class="text-[10px] font-bold uppercase text-gray-400 mb-1.5 block">Ширина рулона (мм)</label>
                                                <input :value="item.rollWidthMm ?? 500" :disabled="!canEditSvc" @input="(e) => { item.rollWidthMm = normalizePackagingRollWidthMm(e.target.value); markDirty(); }" type="number" min="1" class="w-full h-11 bg-white dark:bg-[#232326] rounded-xl border border-gray-200 dark:border-white/10 px-3 text-sm font-black outline-none dark:text-white">
                                                <p class="mt-1 text-[10px] font-medium text-gray-400">Стрейч: задайте закупку за погонный метр и ширину рулона.</p>
                                            </div>
                                            <p v-if="item.type === 'box_mm'" class="text-[10px] font-medium text-gray-400">Коробка: цена трактуется как ₽/м², а в калькуляторе вводятся размеры Ш/Д/В.</p>
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

<style scoped>
.animate-fade-in-down { animation: fadeInDown 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards; opacity: 0; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ripple { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(1.5); opacity: 0; } }
.btn-pulse::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: inherit; z-index: -1; background-color: rgba(0, 0, 0, 0.4); animation: ripple 1.5s infinite cubic-bezier(0.4, 0, 0.2, 1); }
.dark .btn-pulse::after { background-color: rgba(255, 255, 255, 0.4); }
.modal-scale-enter-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.modal-scale-leave-active { transition: all 0.2s ease-in; }
.modal-scale-enter-from, .modal-scale-leave-to { opacity: 0; transform: scale(0.9); }
.no-flicker { will-change: transform; backface-visibility: hidden; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
</style>
