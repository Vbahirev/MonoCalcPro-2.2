<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDatabase } from '@/composables/useDatabase';
import { useHaptics } from '@/composables/useHaptics';
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue';
import ModernSelect from '@/components/ModernSelect.vue';
import AuthLogin from '@/components/AuthLogin.vue';
import DtfRollViz from '@/components/DtfRollViz.vue';
import InvoiceModal from '@/components/InvoiceModal.vue';
import PriceChart from '@/components/PriceChart.vue';
import Tooltip from '@/components/Tooltip.vue';
import { DEFAULT_DTF_ROLL_WIDTH_MM } from '@/utils/coatingPricing';
import { sanitizeText } from '@/utils/sanitize';
import { buildInvoicePayload } from '@/utils/invoicePayload';

const router = useRouter();
const { impactLight, impactMedium } = useHaptics();
const {
    user: currentUser,
    hasPermission,
    isOfflineMode,
    packagingDB,
    processingDB,
  saveProjectToHistory,
} = useDatabase();

const DTF_AUTOSAVE_COUNTER_KEY = 'monocalc_dtf_autosave_counter';
const DTF_HISTORY_LOAD_KEY = 'monocalc_dtf_history_load_state_v1';
const DTF_DRAFT_STORAGE_KEY = 'monocalc_dtf_draft_v1';
const DTF_TAB_ID_KEY = 'monocalc_dtf_tab_id_v1';

const getTabId = () => {
  try {
    const existing = window.sessionStorage.getItem(DTF_TAB_ID_KEY);
    if (existing) return existing;

    const nextId = `dtf_tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(DTF_TAB_ID_KEY, nextId);
    return nextId;
  } catch (error) {
    return `dtf_tab_fallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
};

const getPreferredStorage = () => {
  try {
    const ss = window.sessionStorage;
    const key = '__monocalc_dtf_test__';
    ss.setItem(key, '1');
    ss.removeItem(key);
    return ss;
  } catch (error) {}

  try {
    const ls = window.localStorage;
    const key = '__monocalc_dtf_test__';
    ls.setItem(key, '1');
    ls.removeItem(key);
    return ls;
  } catch (error) {}

  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
};

const draftStorage = getPreferredStorage();
const draftStorageKey = `${DTF_DRAFT_STORAGE_KEY}_${getTabId()}`;

// --- Permissions ---
const canViewHistory  = computed(() => hasPermission('canSaveHistory'));
const canViewSettings = computed(() => hasPermission('canViewSettings'));
const canUseCloud     = computed(() => !isOfflineMode.value);

// --- DTF pricing from processingDB (items with type === 'area_cm2') ---
const activeDtfItem = computed(() =>
    processingDB.value.find(item => item?.type === 'area_cm2' && item?.active !== false) || null
);
const rollWidthMm = computed(() => Number(activeDtfItem.value?.dtfWidthMm) || DEFAULT_DTF_ROLL_WIDTH_MM);
const pricePerCm2 = computed(() => {
    const base = Number(activeDtfItem.value?.price) || 0;
    const mu   = Math.max(0, Number(activeDtfItem.value?.markupPercent) || 0);
    return base * (1 + mu / 100);
});
const dtfSettingLabel = computed(() => activeDtfItem.value?.name || null);

// --- Status badge ---
const statusConfig = computed(() => isOfflineMode.value
    ? { text: 'Офлайн', cls: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/20', dot: 'bg-red-500' }
    : { text: 'Онлайн',  cls: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300 border-green-100 dark:border-green-500/20', dot: 'bg-green-500' }
);

// --- Garment & print-tech constants ---
const PRODUCT_TYPES = [
  { id: 'tshirt',     label: 'Футболка'   },
  { id: 'hoodie',     label: 'Худи'       },
  { id: 'sweatshirt', label: 'Свитшот'    },
  { id: 'longsleeve', label: 'Лонгслив'   },
  { id: 'shorts',     label: 'Шорты'      },
  { id: 'cap',        label: 'Кепка'      },
  { id: 'bag',        label: 'Сумка'      },
  { id: 'flag',       label: 'Флаг'       },
  { id: 'pillow',     label: 'Подушка'    },
  { id: 'custom',     label: 'Другое'     },
];
const SIZE_KEYS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const PLACEMENT_PRESETS = [
  { id: 'a3',       label: 'A3',      w: 297, h: 420 },
  { id: 'a4',       label: 'A4',      w: 210, h: 297 },
  { id: 'a5',       label: 'A5',      w: 148, h: 210 },
  { id: 'a6',       label: 'A6',      w: 105, h: 148 },
  { id: 'logo_10',  label: 'Логотип', w: 100, h: 100 },
];
const TECH_OPTIONS = [
  { id: 'dtf',         label: 'ДТФ'        },
  { id: 'flex',        label: 'Флекс'      },
  { id: 'sublimation', label: 'Сублимация' },
];
// Flex vinyl material types (coeff on base price/cm²)
const FLEX_COLOR_OPTIONS = [
  { id: 'standard',  label: 'Стандарт',        coeff: 1.00 },
  { id: 'metallic',  label: 'Металлик',         coeff: 1.35 },
  { id: 'foil',      label: 'Фольга',           coeff: 1.60 },
  { id: 'glitter',   label: 'Глиттер',          coeff: 1.45 },
  { id: 'fluo',      label: 'Флуоресцент',      coeff: 1.25 },
  { id: 'reflective',label: 'Световозвращающий',coeff: 1.80 },
];
// Flex price tiers by number of color layers
const FLEX_PRICE_TIERS = [
  { colors: 1, label: '1 цвет',   coeff: 1.00 },
  { colors: 2, label: '2 цвета',  coeff: 1.45 },
  { colors: 3, label: '3 цвета',  coeff: 1.85 },
  { colors: 4, label: '4 цвета',  coeff: 2.20 },
  { colors: 5, label: '5 цветов', coeff: 2.50 },
  { colors: 6, label: '6+ цветов',coeff: 2.75 },
];
// Sublimation standard formats
const SUBLIMATION_FORMATS = [
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a3', label: 'A3', w: 297, h: 420 },
];

// --- Project & qty ---
const project    = ref({ name: '', client: '', markup: 0, discount: 0 });
const productQty = ref(1);
const changeMarkup     = (d) => { project.value.markup   = Math.max(0, Math.min(50, project.value.markup   + d)); };
const changeDiscount   = (d) => { project.value.discount = Math.max(0, Math.min(50, project.value.discount + d)); };
const changeProductQty = (d) => {
  if (sizeGridEnabled.value && canUseSizeGrid.value) return;
  productQty.value = Math.max(1, productQty.value + d);
};

// --- Garment state ---
const productType      = ref('tshirt');
const sizeGridEnabled  = ref(false);
const sizeGrid         = ref(Object.fromEntries(SIZE_KEYS.map(k => [k, 0])));
const blankPrice       = ref(0);

const currentProductType = computed(() => PRODUCT_TYPES.find(p => p.id === productType.value) || PRODUCT_TYPES[0]);
const canUseSizeGrid     = computed(() => !['cap', 'bag', 'flag', 'pillow', 'custom'].includes(productType.value));
const sizeGridTotal      = computed(() => SIZE_KEYS.reduce((s, k) => s + (Number(sizeGrid.value[k]) || 0), 0));

watch([sizeGridEnabled, sizeGridTotal, canUseSizeGrid], () => {
  if (sizeGridEnabled.value && canUseSizeGrid.value) {
    productQty.value = Math.max(1, sizeGridTotal.value);
  }
});

// --- Active tab ---
const activeTab = ref('garment');

// --- Layers ---
let layerIdCtr = 1;
const layers = ref([{ id: layerIdCtr++, name: 'Принт 1', w: 0, h: 0, qty: 1, expanded: true, tech: 'dtf', placement: 'chest_l', flexColorType: 'standard', flexColorsCount: 1, sublimationFormat: 'a4' }]);

const addLayer = () => {
    impactLight();
    layers.value.forEach(l => { l.expanded = false; });
    layers.value.unshift({ id: layerIdCtr++, name: `Принт ${layers.value.length + 1}`, w: 0, h: 0, qty: 1, expanded: true, tech: 'dtf', placement: 'chest_l', flexColorType: 'standard', flexColorsCount: 1, sublimationFormat: 'a4' });
};
const removeLayer    = (id) => { layers.value = layers.value.filter(l => l.id !== id); };

const onPlacementChange = (l) => {
  if (l.placement === 'custom') return;
  const pp = PLACEMENT_PRESETS.find(p => p.id === l.placement);
  if (pp) {
    l.w = pp.w;
    l.h = pp.h;
    if (l.name.startsWith('Принт ')) {
      l.name = pp.label;
    }
  }
};
const duplicateLayer = (layer) => {
    impactLight();
    layers.value.forEach(l => { l.expanded = false; });
    layers.value.unshift({ ...layer, id: layerIdCtr++, name: layer.name + ' (копия)', expanded: true });
};

const layerAreaCm2 = (l) => (Number(l.w) || 0) * (Number(l.h) || 0) / 100;
const layerCost = (l) => {
  const qty  = Math.max(1, Number(l.qty) || 1);
  const base = pricePerCm2.value;
  const tech = l.tech || 'dtf';
  if (tech === 'sublimation') {
    const fmt  = SUBLIMATION_FORMATS.find(f => f.id === (l.sublimationFormat || 'a4')) || SUBLIMATION_FORMATS[1];
    const area = fmt.w * fmt.h / 100; // cm²
    return area * base * 0.85 * qty;
  }
  const area = layerAreaCm2(l);
  if (tech === 'flex') {
    const matOpt     = FLEX_COLOR_OPTIONS.find(o => o.id === (l.flexColorType || 'standard')) || FLEX_COLOR_OPTIONS[0];
    const colorCount = Math.max(1, Number(l.flexColorsCount) || 1);
    const tier       = FLEX_PRICE_TIERS[Math.min(colorCount - 1, FLEX_PRICE_TIERS.length - 1)];
    return area * base * matOpt.coeff * tier.coeff * qty;
  }
  // dtf
  return area * base * qty;
};

const totalPrints  = computed(() => layers.value.reduce((s, l) => s + Math.max(1, Number(l.qty) || 1), 0));
const totalLinearM = computed(() => {
    const rw = rollWidthMm.value;
    return layers.value.reduce((sum, l) => {
        const w   = Number(l.w) || 0;
        const h   = Number(l.h) || 0;
        const qty = Math.max(1, Number(l.qty) || 1);
        if (!w || !h) return sum;
        const fpr = Math.floor(rw / w);
        if (!fpr) return sum;
        return sum + Math.ceil(qty / fpr) * h / 1000;
    }, 0);
});

// --- Packaging ---
let pkgIdCtr = 100;
const packaging = ref([]);
const addPackaging    = () => {
    impactLight();
    packaging.value.unshift({ id: ++pkgIdCtr, dbId: null, name: '', type: 'fixed', price: 0, qty: 1, rollWidthMm: 500, length: 0, w: 0, l: 0, h: 0 });
};
const removePackaging = (id) => { packaging.value = packaging.value.filter(p => p.id !== id); };

const isAvailable = (i) => i?.inStock !== false && i?.active !== false;
const packagingOptions = computed(() =>
    (packagingDB.value || []).filter(isAvailable).reverse().map(i => {
        const mu   = Math.max(0, Number(i?.markupPercent) || 0);
        const price = Number(i?.price || 0) * (1 + mu / 100);
        const rw   = Number(i?.rollWidthMm || i?.rollWidth) || 0;
        return {
            value: i.id,
            label: i.name,
            sub: i.type === 'roll'
                ? `${Math.round(price)} ₽/пог.м${rw > 0 ? ` · ${rw}мм` : ''}`
                : i.type === 'box_mm' ? `${Math.round(price)} ₽/м²`
                : `${Math.round(price)} ₽`,
        };
    })
);

const onPkgSelect = (item, val) => {
    const dbItem = (packagingDB.value || []).find(i => i.id === val);
    if (!dbItem) return;
    const mu    = Math.max(0, Number(dbItem?.markupPercent) || 0);
    item.dbId        = val;
    item.name        = dbItem.name;
    item.type        = dbItem.type || 'fixed';
    item.price       = Number(dbItem.price || 0) * (1 + mu / 100);
    item.rollWidthMm = Number(dbItem.rollWidthMm || dbItem.rollWidth) || 500;
};

  const syncPackagingSelection = (item) => {
    const dbItem = (packagingDB.value || []).find(entry => entry.id === item?.dbId);
    if (!dbItem) return;
    const mu = Math.max(0, Number(dbItem?.markupPercent) || 0);
    item.name = dbItem.name;
    item.type = dbItem.type || 'fixed';
    item.price = Number(dbItem.price || 0) * (1 + mu / 100);
    item.rollWidthMm = Number(dbItem.rollWidthMm || dbItem.rollWidth) || item.rollWidthMm || 500;
  };

const stepUp   = (obj, key, step = 1)         => { obj[key] = parseFloat(((Number(obj[key]) || 0) + step).toFixed(1)); };
const stepDown = (obj, key, step = 1, min = 0) => { const v = (Number(obj[key]) || 0) - step; obj[key] = v < min ? min : parseFloat(v.toFixed(1)); };

// --- Totals ---
const materialTotal  = computed(() => layers.value.reduce((s, l) => s + layerCost(l), 0));
const packagingTotal = computed(() => packaging.value.reduce((s, item) => {
    const qty    = Math.max(0, Number(item.qty) || 0);
    const dbItem = (packagingDB.value || []).find(d => d.id === item.dbId);
    if (!dbItem) return s;
    const mu = Math.max(0, Number(dbItem.markupPercent) || 0);
    const p  = Number(dbItem.price || 0) * (1 + mu / 100);
    if (dbItem.type === 'roll') return s + p * Math.max(0, Number(item.length) || 0) / 1000 * qty;
    return s + p * qty;
}, 0));

const blankTotal  = computed(() => (Number(blankPrice.value) || 0) * productQty.value);
const baseTotal   = computed(() => materialTotal.value + packagingTotal.value + blankTotal.value);
const markupAmt  = computed(() => baseTotal.value * project.value.markup / 100);
const discountAmt = computed(() => (baseTotal.value + markupAmt.value) * project.value.discount / 100);
const pricePerOne = computed(() => Math.round(baseTotal.value + markupAmt.value - discountAmt.value));
const totalForAll = computed(() => Math.round(pricePerOne.value * productQty.value));

// --- Cost visibility (blur) ---
const isCostVisible = ref(false);
const toggleCostVisibility = () => { isCostVisible.value = !isCostVisible.value; };

// --- PriceChart totals shape ---
const dtfTotals = computed(() => ({
    costLayers: materialTotal.value,
    layers: materialTotal.value,
  processing: 0,
  accessories: blankTotal.value,
    costPackaging: packagingTotal.value,
    packaging: packagingTotal.value,
  design: 0,
    costTotal: baseTotal.value,
    markupRub: markupAmt.value,
    discountRub: discountAmt.value,
}));

const invoicePayload = computed(() => buildInvoicePayload({
  calculatorId: 'dtf',
  project: project.value,
  productQty: productQty.value,
  layers: layers.value,
  processing: [],
  accessories: [],
  packaging: packaging.value,
  design: [],
  totals: dtfTotals.value,
  settings: {},
  materials: [],
  coatings: [],
  dtf: {
    label: dtfSettingLabel.value,
    pricePerCm2: pricePerCm2.value,
  },
}));

const autoSaveCounter = ref(parseInt(localStorage.getItem(DTF_AUTOSAVE_COUNTER_KEY) || '1', 10) || 1);

const buildDtfHistoryState = () => ({
  project: {
    ...project.value,
    qty: productQty.value,
  },
  layers: JSON.parse(JSON.stringify(layers.value)),
  processing: [],
  accessories: [],
  packaging: JSON.parse(JSON.stringify(packaging.value)),
  design: [],
});

const saveDraftState = () => {
  try {
    draftStorage.setItem(draftStorageKey, JSON.stringify({
      project: {
        ...project.value,
        qty: productQty.value,
      },
      layers: layers.value,
      packaging: packaging.value,
      activeTab: activeTab.value,
      garment: {
        productType: productType.value,
        sizeGridEnabled: sizeGridEnabled.value,
        sizeGrid: { ...sizeGrid.value },
        blankPrice: blankPrice.value,
      },
    }));
  } catch (error) {}
};

const restoreDraftState = () => {
  try {
    let raw = draftStorage.getItem(draftStorageKey);
    if (!raw) {
      raw = draftStorage.getItem(DTF_DRAFT_STORAGE_KEY);
      if (raw) {
        draftStorage.setItem(draftStorageKey, raw);
      }
    }
    if (!raw) return false;
    const parsed = JSON.parse(raw);

    const nextProject = parsed?.project || {};
    project.value = {
      name: nextProject.name || '',
      client: nextProject.client || '',
      markup: Math.max(0, Number(nextProject.markup) || 0),
      discount: Math.max(0, Number(nextProject.discount) || 0),
    };

    const nextQty = Number(nextProject.qty || 1);
    productQty.value = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : 1;

    const nextLayers = Array.isArray(parsed?.layers) && parsed.layers.length
      ? parsed.layers.map((layer, index) => ({
          id: Number(layer?.id) || index + 1,
          name: layer?.name || `Деталь ${index + 1}`,
          w: Number(layer?.w) || 0,
          h: Number(layer?.h) || 0,
          qty: Math.max(1, Number(layer?.qty) || 1),
          expanded: Boolean(layer?.expanded),
          tech: layer?.tech || 'dtf',
          placement: layer?.placement || 'chest_l',
          flexColorType: layer?.flexColorType || 'standard',
          flexColorsCount: Math.max(1, Number(layer?.flexColorsCount) || 1),
          sublimationFormat: layer?.sublimationFormat || 'a4',
        }))
      : [{ id: 1, name: 'Деталь 1', w: 0, h: 0, qty: 1, expanded: true }];
    layers.value = nextLayers;
    layerIdCtr = nextLayers.reduce((maxId, layer) => Math.max(maxId, Number(layer.id) || 0), 0) + 1;

    const nextPackaging = Array.isArray(parsed?.packaging)
      ? parsed.packaging.map((item, index) => ({
          id: Number(item?.id) || 100 + index + 1,
          dbId: item?.dbId || null,
          name: item?.name || '',
          type: item?.type || 'fixed',
          price: Number(item?.price) || 0,
          qty: Math.max(0, Number(item?.qty) || 0),
          rollWidthMm: Number(item?.rollWidthMm) || 500,
          length: Number(item?.length) || 0,
          w: Number(item?.w) || 0,
          l: Number(item?.l) || 0,
          h: Number(item?.h) || 0,
        }))
      : [];
    packaging.value = nextPackaging;
    pkgIdCtr = nextPackaging.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 100) + 1;
    packaging.value.forEach(syncPackagingSelection);

    // restore garment state
    const g = parsed?.garment || {};
    if (PRODUCT_TYPES.find(p => p.id === g.productType)) productType.value = g.productType;
    sizeGridEnabled.value = Boolean(g.sizeGridEnabled);
    if (g.sizeGrid && typeof g.sizeGrid === 'object') {
      SIZE_KEYS.forEach(k => { if (k in g.sizeGrid) sizeGrid.value[k] = Math.max(0, Number(g.sizeGrid[k]) || 0); });
    }
    blankPrice.value = Math.max(0, Number(g.blankPrice) || 0);

    activeTab.value = ['garment', 'layers', 'packaging'].includes(parsed?.activeTab) ? parsed.activeTab : 'garment';
    return true;
  } catch (error) {
    return false;
  }
};

const saveToHistory = async (nameOverride, opts = {}) => {
  if (!currentUser.value) throw new Error('Сначала войдите в аккаунт');
  if (!canViewHistory.value) throw new Error('Нет прав для сохранения в историю');

  const finalName = sanitizeText((nameOverride || project.value.name || '').trim());
  if (!finalName) throw new Error('Введите название проекта');

  const finalClient = sanitizeText((project.value.client || '').trim());
  project.value.name = finalName;
  project.value.client = finalClient;

  const payload = {
    id: opts.forceNew ? `dtf_${Date.now()}_${Math.floor(Math.random() * 1000)}` : undefined,
    type: 'dtf',
    name: finalName,
    client: finalClient,
    total: totalForAll.value,
    totalPerUnit: pricePerOne.value,
    totalOrder: totalForAll.value,
    qty: productQty.value,
    state: buildDtfHistoryState(),
  };

  const ok = await saveProjectToHistory(payload);
  if (!ok) throw new Error('Ошибка сохранения');
  return { status: isOfflineMode.value ? 'queued' : 'saved' };
};

const triggerAutoSave = async () => {
  try {
    if (!currentUser.value || !canViewHistory.value) return false;
    let nameToUse = (project.value.name || '').trim();
    if (!nameToUse) {
      nameToUse = `Без названия ${autoSaveCounter.value}`;
      project.value.name = nameToUse;
      autoSaveCounter.value += 1;
      localStorage.setItem(DTF_AUTOSAVE_COUNTER_KEY, String(autoSaveCounter.value));
    }
    await saveToHistory(nameToUse);
    return true;
  } catch (error) {
    return false;
  }
};

// --- Toast ---
const toast    = ref({ show: false, message: '' });
const showToast = (msg) => {
  toast.value = { show: true, message: msg };
  setTimeout(() => { toast.value.show = false; }, 2600);
};
const showOfflineToast = () => {
  toast.value = { show: true, message: 'Офлайн: раздел временно недоступен' };
  setTimeout(() => { toast.value.show = false; }, 2500);
};
const blockCloudAction = (action) => {
  if (!canUseCloud.value) {
    showOfflineToast();
    return;
  }
  action();
};

// --- Save modal ---
const showSaveProjectModal = ref(false);
const saveModalNotice = ref(null);
const isManualSaving = ref(false);
const showAuthModal   = ref(false);
const showResetConfirm = ref(false);
const showInvoice = ref(false);
const openSaveProjectModal = () => {
  blockCloudAction(() => {
    if (!currentUser.value) {
      showAuthModal.value = true;
      showToast('Сначала войдите в аккаунт');
      return;
    }
    if (!canViewHistory.value) {
      showToast('Нет прав для сохранения в историю');
      return;
    }
    impactMedium();
    saveModalNotice.value = isOfflineMode.value
      ? { type: 'info', text: 'Офлайн: проект сохранится в кэш браузера и автоматически синхронизируется при подключении к сети.' }
      : null;
    showSaveProjectModal.value = true;
  });
};
const saveFireworks = ref([]);
let saveFireworkCounter = 0;
let saveFireworksTimer = null;

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

const handleManualSaveToHistory = async () => {
  if (!canViewHistory.value) {
    showToast('Нет прав для сохранения в историю');
    return;
  }
  isManualSaving.value = true;
  if (isOfflineMode.value) {
    saveModalNotice.value = { type: 'info', text: 'Сохраняем в кэш браузера…' };
  }
  try {
    let nameToUse = (project.value.name || '').trim();
    if (!nameToUse) {
      nameToUse = `Без названия ${autoSaveCounter.value}`;
      project.value.name = nameToUse;
      autoSaveCounter.value += 1;
      localStorage.setItem(DTF_AUTOSAVE_COUNTER_KEY, String(autoSaveCounter.value));
    }
    const result = await saveToHistory(nameToUse, { forceNew: true });
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
      const idPart = result?.id ? ` • id: ${result.id}` : '';
      showToast(`Проект сохранён в Историю${idPart}`);
    }
    setTimeout(() => { toast.value.show = false; }, 3000);
  } catch (error) {
    showToast(error?.message || 'Ошибка сохранения');
  } finally {
    isManualSaving.value = false;
  }
};

const openInvoiceModal = () => {
  showInvoice.value = true;
};

const copyQuote = async () => {
  const date = new Date().toLocaleDateString('ru-RU');
  let text = `КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ\nДата: ${date}\n\n`;
  if (project.value.name) text += `Проект: ${project.value.name}\n`;
  text += `Количество изделий: ${productQty.value}\n`;
  text += `ИТОГО К ОПЛАТЕ: ${totalForAll.value.toLocaleString()} ₽`;

  try {
    await navigator.clipboard.writeText(text);
    if (canViewHistory.value) {
      const saved = await triggerAutoSave();
      showToast(saved ? 'Скопировано и сохранено' : 'Скопировано');
    } else {
      showToast('Скопировано');
    }
  } catch (error) {
    showToast('Не удалось скопировать');
  }
};

const onInvoicePrint = () => {
  if (canViewHistory.value) triggerAutoSave();
  showToast('КП отправлено на печать');
};

const requestReset = () => {
  impactMedium();
  showResetConfirm.value = true;
};

const confirmReset = () => {
  layers.value = [{ id: layerIdCtr++, name: 'Деталь 1', w: 0, h: 0, qty: 1, expanded: true }];
  packaging.value = [];
  project.value = { name: '', client: '', markup: 0, discount: 0 };
  productQty.value = 1;
  activeTab.value = 'layers';
  showInvoice.value = false;
  showResetConfirm.value = false;
  draftStorage.removeItem(draftStorageKey);
  draftStorage.removeItem(DTF_DRAFT_STORAGE_KEY);
  showToast('Проект очищен');
};

// --- Navigation ---
const openSettings = () => {
    if (!canUseCloud.value) { showToast('Офлайн: настройки недоступны'); return; }
    impactLight();
    router.push({ path: '/settings/dtf', query: { from: 'calc', calc: 'dtf' } });
};
const openHistory = () => {
    if (!canUseCloud.value) { showToast('Офлайн: история недоступна'); return; }
  impactLight();
  Promise.resolve(canViewHistory.value ? triggerAutoSave() : false).finally(() => {
    router.push({ path: '/history', query: { from: 'calc', calc: 'dtf' } });
  });
};

watch(packagingDB, () => {
  packaging.value.forEach(syncPackagingSelection);
}, { deep: true });

let draftSaveTimeout = null;
watch([layers, packaging, project, productQty, activeTab], () => {
  if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
  draftSaveTimeout = setTimeout(() => {
    saveDraftState();
  }, 250);
}, { deep: true });

const restoreFromHistoryPayload = () => {
  try {
    const raw = sessionStorage.getItem(DTF_HISTORY_LOAD_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const state = parsed?.state;
    if (!state || typeof state !== 'object') return;

    const nextProject = state.project || {};
    project.value = {
      name: nextProject.name || '',
      client: nextProject.client || '',
      markup: Math.max(0, Number(nextProject.markup) || 0),
      discount: Math.max(0, Number(nextProject.discount) || 0),
    };

    const nextQty = Number(nextProject.qty || parsed?.qty || 1);
    productQty.value = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : 1;

    const nextLayers = Array.isArray(state.layers) && state.layers.length
      ? state.layers.map((layer, index) => ({
        id: Number(layer?.id) || index + 1,
        name: layer?.name || `Деталь ${index + 1}`,
        w: Number(layer?.w) || 0,
        h: Number(layer?.h) || 0,
        qty: Math.max(1, Number(layer?.qty) || 1),
        expanded: index === 0,
      }))
      : [{ id: 1, name: 'Деталь 1', w: 0, h: 0, qty: 1, expanded: true }];
    layers.value = nextLayers;
    layerIdCtr = nextLayers.reduce((maxId, layer) => Math.max(maxId, Number(layer.id) || 0), 0) + 1;

    const nextPackaging = Array.isArray(state.packaging)
      ? state.packaging.map((item, index) => ({
        id: Number(item?.id) || 100 + index + 1,
        dbId: item?.dbId || null,
        name: item?.name || '',
        type: item?.type || 'fixed',
        price: Number(item?.price) || 0,
        qty: Math.max(0, Number(item?.qty) || 0),
        rollWidthMm: Number(item?.rollWidthMm) || 500,
        length: Number(item?.length) || 0,
        w: Number(item?.w) || 0,
        l: Number(item?.l) || 0,
        h: Number(item?.h) || 0,
      }))
      : [];
    packaging.value = nextPackaging;
    pkgIdCtr = nextPackaging.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 100) + 1;
    packaging.value.forEach(syncPackagingSelection);

    sessionStorage.removeItem(DTF_HISTORY_LOAD_KEY);
    showToast('Проект загружен из истории');
  } catch (error) {
    sessionStorage.removeItem(DTF_HISTORY_LOAD_KEY);
  }
};

// --- Collapse animations ---
const onBeforeEnter = (el) => { el.style.height = '0'; el.style.opacity = '0'; el.style.overflow = 'hidden'; };
const onEnter       = (el) => { el.style.transition = 'all 0.28s ease-out'; el.style.height = el.scrollHeight + 'px'; el.style.opacity = '1'; };
const onAfterEnter  = (el) => { el.style.height = 'auto'; el.style.overflow = 'visible'; };
const onBeforeLeave = (el) => { el.style.height = el.scrollHeight + 'px'; el.style.overflow = 'hidden'; };
const onLeave       = (el) => { el.style.transition = 'all 0.25s ease-in'; el.style.height = '0'; el.style.opacity = '0'; };

// --- Scroll top ---
const showScrollTop = ref(false);
const handleWindowScroll = () => {
  showScrollTop.value = window.scrollY > 300;
};
const persistDraftOnPageHide = () => {
  saveDraftState();
};

onMounted(()   => {
  const restoredFromHistory = (() => {
    const raw = sessionStorage.getItem(DTF_HISTORY_LOAD_KEY);
    return Boolean(raw);
  })();
  restoreFromHistoryPayload();
  if (!restoredFromHistory) restoreDraftState();
  handleWindowScroll();
  window.addEventListener('scroll', handleWindowScroll, { passive: true });
  window.addEventListener('pagehide', persistDraftOnPageHide);
  window.addEventListener('beforeunload', persistDraftOnPageHide);
});
onUnmounted(() => {
  if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
  saveDraftState();
  window.removeEventListener('scroll', handleWindowScroll);
  window.removeEventListener('pagehide', persistDraftOnPageHide);
  window.removeEventListener('beforeunload', persistDraftOnPageHide);
});
const scrollToTop = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); };

const getTextClass = (val) => (val && parseFloat(val) > 0) ? 'text-black dark:text-white font-bold' : 'text-gray-400 dark:text-gray-500 font-normal';
</script>

<template>
  <div class="desktop-calc w-full max-w-7xl container mx-auto p-5 md:p-7 text-sm text-[#18181B] dark:text-gray-100">

    <AppBreadcrumbs />

    <!-- ======= HEADER ======= -->
    <header class="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-white/10 no-print gap-4">
      <div class="flex-1 w-full md:w-auto flex items-center gap-2">
        <h1 class="text-2xl font-black tracking-tight text-[#18181B] dark:text-white">DTF Печать</h1>
      </div>

      <div class="calc-top-nav-wrap flex items-center gap-2 w-full md:w-auto justify-end">
        <div v-if="currentUser" class="hidden md:flex flex-col items-end mr-2 text-right">
          <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Вы вошли как</span>
          <span class="text-xs font-black text-[#1d1d1f] dark:text-white leading-none">{{ currentUser.email }}</span>
        </div>
        <button v-else @click="showAuthModal = true" class="hidden md:flex px-4 py-2 bg-black text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:opacity-80 transition-all">Войти</button>

        <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all" :class="statusConfig.cls">
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
          <button @click="openHistory" :disabled="!canUseCloud" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="История">
            <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>
            <span class="hidden md:block">История</span>
          </button>
        </template>

        <template v-if="canViewSettings">
          <button @click="openSettings" :disabled="!canUseCloud" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="Настройки">
            <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </div>
            <span class="hidden md:block">Настройки</span>
          </button>
        </template>
      </div>
    </header>

    <!-- ======= TABS ======= -->
    <div class="flex overflow-x-auto gap-1.5 mb-6 p-1.5 bg-gray-100 dark:bg-white/5 rounded-2xl no-print">
      <button
        v-for="(name, key) in { garment: '1. Изделие', layers: '2. Нанесение', packaging: '3. Упаковка' }"
        :key="key"
        @click="activeTab = key"
        class="calc-tab-btn flex-1 py-3 px-4 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wide whitespace-nowrap relative overflow-hidden"
        :class="activeTab === key ? 'calc-tab-btn-active' : 'calc-tab-btn-idle'"
      >
        {{ name }}
      </button>
    </div>

    <!-- ======= MAIN GRID ======= -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 no-print">

      <!-- ===== LEFT CONTENT ===== -->
      <div class="lg:col-span-2 min-h-[500px]">
        <Transition name="page-switch" mode="out-in">

          <!-- === ИЗДЕЛИЕ TAB === -->
          <div v-if="activeTab === 'garment'" key="garment">

            <!-- Product type selector -->
            <div class="mb-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-4">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Тип изделия</label>
              <div class="relative mt-3">
                <select
                  v-model="productType"
                  class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 pr-10 text-sm font-bold outline-none text-[#18181B] dark:text-white appearance-none cursor-pointer"
                >
                  <option v-for="pt in PRODUCT_TYPES" :key="pt.id" :value="pt.id">{{ pt.label }}</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M1 1L5 5L9 1"/></svg>
                </div>
              </div>
            </div>

            <!-- Blank (garment) price -->
            <div class="mb-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-4">
              <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Закупочная цена изделия (₽/шт)</label>
              <p class="text-[10px] text-gray-400 dark:text-gray-500 mb-3">Стоимость пустого изделия без нанесения — добавляется к итогу</p>
              <div class="flex items-center h-10 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden mt-3">
                <button @click="blankPrice = Math.max(0, (Number(blankPrice)||0) - 50)" class="w-12 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors flex-shrink-0">−</button>
                <input type="number" min="0" v-model.number="blankPrice" class="flex-1 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                <button @click="blankPrice = Math.max(0, (Number(blankPrice)||0) + 50)" class="w-12 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors flex-shrink-0">+</button>
              </div>
              <p v-if="blankPrice > 0 && productQty > 0" class="text-xs text-gray-400 dark:text-gray-500 mt-2">{{ blankPrice }} ₽ × {{ productQty }} шт = {{ Math.round(blankTotal).toLocaleString() }} ₽</p>
            </div>

            <!-- Size grid -->
            <div v-if="canUseSizeGrid" class="mb-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-4">
              <div class="flex items-center justify-between mb-3">
                <label class="inline-flex items-center rounded-full px-2.5 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Сетка размеров</label>
                <button
                  @click="sizeGridEnabled = !sizeGridEnabled"
                  class="relative w-10 h-6 rounded-full transition-colors"
                  :class="sizeGridEnabled ? 'bg-black dark:bg-white' : 'bg-gray-200 dark:bg-white/20'"
                >
                  <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white dark:bg-black transition-transform" :class="sizeGridEnabled ? 'translate-x-4' : ''"></span>
                </button>
              </div>
              <div v-if="sizeGridEnabled" class="grid grid-cols-5 md:grid-cols-10 gap-1.5">
                <div v-for="sz in SIZE_KEYS" :key="sz" class="flex flex-col items-center gap-1">
                  <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase">{{ sz }}</span>
                  <input
                    type="number" min="0"
                    :value="sizeGrid[sz]"
                    @input="sizeGrid[sz] = Math.max(0, parseInt($event.target.value) || 0)"
                    class="w-full h-10 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-center text-xs font-black outline-none dark:text-white"
                    placeholder="0"
                  >
                </div>
              </div>
              <p v-if="sizeGridEnabled && sizeGridTotal > 0" class="text-xs text-gray-400 dark:text-gray-500 mt-2">Итого: {{ sizeGridTotal }} шт</p>
            </div>

          </div>

          <!-- === НАНЕСЕНИЕ TAB === -->
          <div v-else-if="activeTab === 'layers'" key="layers">

            <!-- Block header card -->
            <div class="mb-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-gradient-to-br from-white to-gray-50 dark:from-[#1C1C1E] dark:to-[#232326] p-4">
              <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-gray-500 mb-1">Блок калькулятора</p>
                  <h3 class="text-lg font-black text-[#18181B] dark:text-white truncate">DTF Печать</h3>
                  <p v-if="dtfSettingLabel" class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{{ dtfSettingLabel }} · {{ rollWidthMm }} мм</p>
                  <p v-else class="text-[10px] text-amber-500 mt-0.5">Нет настроек DTF — зайдите в Настройки и добавьте пресет</p>
                </div>
                <div class="grid grid-cols-3 gap-2 w-full md:w-auto">
                  <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Принтов</div>
                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ layers.length }}</div>
                  </div>
                  <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Всего шт</div>
                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ totalPrints }}</div>
                  </div>
                  <div class="rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 px-3 py-2 text-center min-w-[88px]">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Пог.м</div>
                    <div class="text-sm font-black text-[#18181B] dark:text-white">{{ totalLinearM.toFixed(1) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- List header -->
            <div class="calc-section-head flex justify-between items-center mb-4">
              <h2 class="section-title">DTF Печать</h2>
              <button @click="addLayer" class="btn-add">Добавить деталь</button>
            </div>

            <!-- Layer cards -->
            <Transition name="fade" mode="out-in">
              <TransitionGroup v-if="layers.length" key="list" name="layer-stack" tag="div" class="space-y-4">
                <div
                  v-for="(l) in layers"
                  :key="l.id"
                  class="layer-stack-item card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0"
                  :class="l.expanded
                    ? 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10'
                    : 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 hover:bg-[#18181B] dark:hover:bg-white hover:border-black dark:hover:border-white'"
                >
                  <!-- Layer header -->
                  <div
                    @click="l.expanded = !l.expanded"
                    class="layer-header flex justify-between items-center select-none cursor-pointer transition-colors duration-200 p-4"
                    :class="{ 'is-expanded': l.expanded }"
                  >
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                      <div class="shrink-0 transition-transform duration-300" :class="l.expanded ? 'rotate-180 text-gray-400' : 'text-black dark:text-white group-hover:text-white dark:group-hover:text-black'">
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1L5 5L9 1"/></svg>
                      </div>
                      <span
                        class="font-bold text-sm uppercase tracking-widest truncate transition-colors"
                        :class="l.expanded ? 'text-[#18181B] dark:text-white' : 'text-[#18181B] dark:text-white group-hover:text-white dark:group-hover:text-black'"
                      >{{ l.name || 'Принт' }}</span>
                    </div>
                    <div class="shrink-0 ml-4 flex items-center gap-2">
                      <span v-if="!l.expanded && l.tech !== 'sublimation' && l.w && l.h" class="text-[11px] font-bold text-gray-400 group-hover:text-white/70 dark:group-hover:text-black/70 transition-colors">{{ l.w }}×{{ l.h }}мм · {{ l.qty }}шт</span>
                      <span v-if="!l.expanded && l.tech === 'sublimation'" class="text-[11px] font-bold text-gray-400 group-hover:text-white/70 dark:group-hover:text-black/70 transition-colors">{{ (SUBLIMATION_FORMATS.find(f=>f.id===(l.sublimationFormat||'a4'))||SUBLIMATION_FORMATS[1]).label }} · {{ l.qty }}шт</span>
                      <span v-if="!l.expanded && l.w && l.h && pricePerCm2 > 0" class="text-[11px] font-black text-gray-600 dark:text-gray-300 group-hover:text-white dark:group-hover:text-black transition-colors">{{ Math.round(layerCost(l)).toLocaleString() }} ₽</span>
                      <button v-if="l.expanded" @click.stop="duplicateLayer(l)" class="text-gray-300 dark:text-gray-500 hover:text-black dark:hover:text-white font-bold text-xs no-print transition-colors">Копировать</button>
                      <button v-if="l.expanded" @click.stop="removeLayer(l.id)" class="text-gray-300 dark:text-gray-500 hover:text-red-500 font-bold text-xs no-print transition-colors">Удалить</button>
                    </div>
                  </div>

                  <!-- Layer body -->
                  <transition name="collapse" @before-enter="onBeforeEnter" @enter="onEnter" @after-enter="onAfterEnter" @before-leave="onBeforeLeave" @leave="onLeave">
                    <div v-show="l.expanded" class="layer-card-body px-5 pb-5 pt-3 space-y-3">

                      <!-- Name -->
                      <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Название</label>
                        <input v-model="l.name" maxlength="50" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 text-sm font-black outline-none text-[#18181B] dark:text-white placeholder-gray-300 dark:placeholder-gray-600 caret-current" placeholder="Название детали">
                      </div>

                      <!-- Tech selector -->
                      <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Технология</label>
                        <div class="flex gap-2 mt-2">
                          <button
                            v-for="t in TECH_OPTIONS" :key="t.id"
                            @click="l.tech = t.id"
                            class="flex-1 py-2 px-3 rounded-xl border text-[11px] font-bold uppercase tracking-wide transition-all"
                            :class="(l.tech||'dtf') === t.id
                              ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                              : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-gray-400'"
                          >{{ t.label }}</button>
                        </div>
                      </div>

                      <!-- Placement presets -->
                      <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Формат печати</label>
                        <div class="flex flex-wrap gap-1.5 mt-2">
                          <button
                            v-for="pp in PLACEMENT_PRESETS" :key="pp.id"
                            @click="l.placement = pp.id; l.w = pp.w; l.h = pp.h; if(l.name.startsWith('Принт ')) l.name = pp.label;"
                            class="py-1.5 px-2.5 rounded-lg border flex items-baseline gap-1.5 transition-all"
                            :class="l.placement === pp.id
                              ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white shadow-sm'
                              : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'"
                          >
                            <span class="text-[11px] font-bold leading-none">{{ pp.label }}</span>
                            <span class="text-[9px] opacity-60 leading-none">{{ pp.w }}×{{ pp.h }}</span>
                          </button>
                          <button
                            @click="l.placement = 'custom'"
                            class="py-1.5 px-2.5 rounded-lg border text-[11px] font-bold transition-all"
                            :class="['custom', undefined].includes(l.placement) || !PLACEMENT_PRESETS.find(p=>p.id===l.placement)
                              ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white shadow-sm'
                              : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'"
                          >
                            Свои размеры
                          </button>
                        </div>
                      </div>



                      <!-- Flex options (Flex only) -->
                      <div v-if="l.tech === 'flex'" class="space-y-3">
                        <div>
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Материал флекса</label>
                          <div class="relative mt-2">
                            <select
                              v-model="l.flexColorType"
                              class="w-full h-10 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 pr-9 text-sm font-bold outline-none text-[#18181B] dark:text-white appearance-none cursor-pointer"
                            >
                              <option v-for="fo in FLEX_COLOR_OPTIONS" :key="fo.id" :value="fo.id">{{ fo.label }} (×{{ fo.coeff }})</option>
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M1 1L5 5L9 1"/></svg>
                            </div>
                          </div>
                        </div>
                        <div>
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цветов в макете</label>
                          <div class="flex items-center h-10 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden mt-2">
                            <button @click="l.flexColorsCount = Math.max(1, (Number(l.flexColorsCount)||1) - 1)" class="w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-lg transition-colors flex-shrink-0">−</button>
                            <input type="number" min="1" :value="l.flexColorsCount || 1" @input="l.flexColorsCount = Math.max(1, parseInt($event.target.value) || 1)" class="flex-1 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current">
                            <button @click="l.flexColorsCount = Math.max(1, (Number(l.flexColorsCount)||1) + 1)" class="w-10 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-lg transition-colors flex-shrink-0">+</button>
                          </div>
                          <p class="text-[10px] text-gray-400 mt-1">
                            Тариф:
                            <template v-for="(tier, idx) in FLEX_PRICE_TIERS" :key="idx">
                              <span :class="(l.flexColorsCount||1) === tier.colors || (idx === FLEX_PRICE_TIERS.length-1 && (l.flexColorsCount||1) >= tier.colors) ? 'font-black text-[#18181B] dark:text-white' : ''">{{ idx > 0 ? ' · ' : '' }}{{ tier.label }}&nbsp;×{{ tier.coeff }}</span>
                            </template>
                          </p>
                        </div>
                      </div>

                      <!-- Size inputs (hidden for sublimation) -->
                      <div v-if="l.tech !== 'sublimation'" class="grid grid-cols-12 gap-2 items-end">
                        <div class="col-span-5">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Ширина (мм)</label>
                          <input
                            type="number" min="0" v-model.number="l.w"
                            class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 text-sm outline-none caret-current"
                            :class="getTextClass(l.w)"
                            placeholder="Ш"
                          >
                        </div>
                        <div class="col-span-2 flex items-center justify-center pb-2">
                          <span class="text-gray-400 font-bold text-base">✕</span>
                        </div>
                        <div class="col-span-5">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Высота (мм)</label>
                          <input
                            type="number" min="0" v-model.number="l.h"
                            class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 text-sm outline-none caret-current"
                            :class="getTextClass(l.h)"
                            placeholder="В"
                          >
                        </div>
                      </div>

                      <!-- Sublimation format selector -->
                      <div v-if="l.tech === 'sublimation'">
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Формат</label>
                        <div class="flex gap-2 mt-3">
                          <button
                            v-for="fmt in SUBLIMATION_FORMATS" :key="fmt.id"
                            @click="l.sublimationFormat = fmt.id"
                            class="flex-1 py-3 rounded-xl border font-bold text-sm transition-all"
                            :class="(l.sublimationFormat||'a4') === fmt.id
                              ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                              : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-gray-400'"
                          >
                            <div>{{ fmt.label }}</div>
                            <div class="text-[10px] font-normal opacity-60 mt-0.5">{{ fmt.w }}×{{ fmt.h }} мм</div>
                          </button>
                        </div>
                      </div>

                      <!-- Qty -->
                      <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Количество</label>
                        <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden">
                          <button @click="stepDown(l, 'qty', 1, 1)" class="w-14 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors flex-shrink-0">−</button>
                          <input
                            type="number" min="1" v-model.number="l.qty"
                            class="flex-1 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current"
                            :class="getTextClass(l.qty)"
                          >
                          <button @click="stepUp(l, 'qty', 1)" class="w-14 h-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors flex-shrink-0">+</button>
                        </div>
                      </div>

                      <!-- Roll visualization -->
                      <DtfRollViz
                        v-if="(l.tech||'dtf') === 'dtf'"
                        :rollWidthMm="rollWidthMm"
                        :printW="Number(l.w) || 0"
                        :printH="Number(l.h) || 0"
                        :qty="Math.max(1, Number(l.qty) || 1)"
                      />

                      <!-- Cost for this layer -->
                      <div v-if="pricePerCm2 > 0 && (l.tech === 'sublimation' || (l.w && l.h))" class="flex items-center justify-between rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-4 py-3">
                        <div>
                          <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Стоимость</p>
                          <p v-if="l.tech === 'sublimation'" class="text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5">
                            {{ (SUBLIMATION_FORMATS.find(f=>f.id===(l.sublimationFormat||'a4'))||SUBLIMATION_FORMATS[1]).label }}
                            · {{ ((SUBLIMATION_FORMATS.find(f=>f.id===(l.sublimationFormat||'a4'))||SUBLIMATION_FORMATS[1]).w * (SUBLIMATION_FORMATS.find(f=>f.id===(l.sublimationFormat||'a4'))||SUBLIMATION_FORMATS[1]).h / 100).toFixed(0) }} см²
                            × {{ pricePerCm2.toFixed(4) }} ₽ × 0.85 × {{ l.qty }} шт
                          </p>
                          <p v-else class="text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5">{{ layerAreaCm2(l).toFixed(1) }} см² × {{ pricePerCm2.toFixed(4) }} ₽ × {{ l.qty }} шт</p>
                        </div>
                        <span class="text-xl font-black text-[#18181B] dark:text-white">{{ Math.round(layerCost(l)).toLocaleString() }} ₽</span>
                      </div>

                    </div>
                  </transition>
                </div>
              </TransitionGroup>

              <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">
                Нет деталей — нажмите «Добавить деталь»
              </div>
            </Transition>
          </div>

          <!-- === УПАКОВКА TAB === -->
          <div v-else-if="activeTab === 'packaging'" key="packaging">
            <div class="calc-section-head flex justify-between items-center mb-4">
              <h2 class="section-title">Упаковка</h2>
              <button @click="addPackaging" class="btn-add">Добавить</button>
            </div>

            <Transition name="fade" mode="out-in">
              <div v-if="packaging.length" key="list">
                <TransitionGroup name="service-stack" tag="div" class="space-y-3">
                  <div
                    v-for="item in packaging"
                    :key="item.id"
                    class="service-stack-item card service-card relative p-4 pt-8 pr-16 flex flex-col md:flex-row items-center gap-4"
                  >
                    <div class="w-full md:w-1/2">
                      <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Тип</label>
                      <ModernSelect v-model="item.dbId" :options="packagingOptions" @update:modelValue="val => onPkgSelect(item, val)" placeholder="Выберите упаковку" />
                    </div>

                    <div v-if="item.dbId" class="w-full md:w-5/12">
                      <!-- roll type -->
                      <div v-if="item.type === 'roll'" class="space-y-2">
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Ширина рулона (мм)</label>
                            <input type="number" v-model.number="item.rollWidthMm" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="500">
                          </div>
                          <div>
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Длина (мм)</label>
                            <input type="number" v-model.number="item.length" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                          </div>
                        </div>
                        <div class="flex gap-2">
                          <div class="flex-1">
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Цена (₽/пог.м)</label>
                            <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                          </div>
                          <div class="w-24">
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Кол-во</label>
                            <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                              <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                              <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                              <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <!-- box type -->
                      <div v-else-if="item.type === 'box_mm'" class="space-y-2">
                        <div class="grid grid-cols-3 gap-2">
                          <div>
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Ш (мм)</label>
                            <input type="number" v-model.number="item.w" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                          </div>
                          <div>
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Д (мм)</label>
                            <input type="number" v-model.number="item.l" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                          </div>
                          <div>
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">В (мм)</label>
                            <input type="number" v-model.number="item.h" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                          </div>
                        </div>
                        <div class="flex gap-2">
                          <div class="flex-1">
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Цена (₽/м²)</label>
                            <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                          </div>
                          <div class="w-24">
                            <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Кол-во</label>
                            <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                              <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                              <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                              <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <!-- default type -->
                      <div v-else class="flex gap-2">
                        <div class="w-1/2">
                          <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Цена (₽)</label>
                          <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current text-center">
                        </div>
                        <div class="w-1/2">
                          <label class="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">Кол-во</label>
                          <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                            <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                            <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                            <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div v-else class="w-full md:w-5/12">
                      <label class="inline-flex invisible">Тип</label>
                      <div class="h-11 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center text-xs text-gray-400 font-bold uppercase tracking-wider">
                        Сначала выберите упаковку
                      </div>
                    </div>

                    <div class="absolute top-2 right-2 md:top-3 md:right-3">
                      <button @click="removePackaging(item.id)" class="text-gray-300 dark:text-gray-600 hover:text-red-500 font-bold text-xs transition-colors p-2">Удалить</button>
                    </div>
                  </div>
                </TransitionGroup>
              </div>
              <div v-else key="empty" class="p-10 text-center border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl text-gray-400 text-xs uppercase tracking-widest mt-4">
                Нет добавленной упаковки
              </div>
            </Transition>
          </div>

        </Transition>
      </div>

      <!-- ===== RIGHT: TOTALS ===== -->
      <div class="relative">
        <div>
          <div class="kpi-card bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 text-[#18181B] dark:text-gray-100 mb-6">
          
          <!-- PriceChart with cost blur -->
          <PriceChart :totals="dtfTotals" :cost-revealed="isCostVisible" @toggle-cost-visibility="toggleCostVisibility" />
          
          <!-- Total headline -->
          <div class="mb-6 border-t border-gray-100 pt-4">
            <div class="flex justify-between items-baseline">
              <span class="text-sm font-bold uppercase tracking-widest text-gray-400">Итого</span>
              <span class="total-amount text-3xl font-black tracking-tighter text-black dark:text-white">{{ totalForAll.toLocaleString() }} ₽</span>
            </div>
            <div class="flex justify-end mt-1">
              <span class="text-[10px] font-bold text-gray-400">{{ pricePerOne.toLocaleString() }} ₽ × {{ productQty }} шт</span>
            </div>
          </div>

          <!-- Breakdown -->
          <div class="space-y-4 mb-6">
            <div class="flex justify-between items-baseline">
              <div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 rounded-full bg-black dark:bg-white shrink-0"></div>
                <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Нанесение</span>
              </div>
              <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(materialTotal).toLocaleString() }} ₽</span>
            </div>
            <div class="flex justify-between items-baseline">
              <div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 rounded-full bg-[#D4D4D8] dark:bg-gray-600 shrink-0"></div>
                <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Упаковка</span>
              </div>
              <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(packagingTotal).toLocaleString() }} ₽</span>
            </div>
            <div v-if="blankTotal > 0" class="flex justify-between items-baseline">
              <div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 rounded-full bg-[#A78BFA] shrink-0"></div>
                <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Бланки ({{ currentProductType.label }})</span>
              </div>
              <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(blankTotal).toLocaleString() }} ₽</span>
            </div>
          </div>

          <!-- Controls: markup, discount, qty -->
            <div class="kp-controls bg-gray-100 rounded-xl p-4 mb-6 space-y-4 relative transition-colors">
            <div class="absolute top-2 right-2 z-10">
              <Tooltip text="Итого = (Себестоимость + Наценка%) - Скидка%" width="w-48">
                <div class="w-4 h-4 rounded-full bg-white dark:bg-black text-gray-400 hover:text-black dark:hover:text-white flex items-center justify-center text-[10px] font-bold shadow-sm cursor-help transition-colors">?</div>
              </Tooltip>
            </div>
            <!-- Markup -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-[10px] uppercase font-bold text-gray-500">Наценка</span>
                <span v-if="markupAmt > 0" class="text-[10px] font-bold text-green-600 dark:text-green-500">+{{ Math.round(markupAmt).toLocaleString() }} ₽</span>
              </div>
              <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
                <button @click="changeMarkup(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
                <span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 leading-8 text-black dark:text-white">{{ project.markup }}%</span>
                <button @click="changeMarkup(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
              </div>
            </div>
            <!-- Discount -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-[10px] uppercase font-bold text-gray-500">Скидка</span>
                <span v-if="discountAmt > 0" class="text-[10px] font-bold text-red-500">-{{ Math.round(discountAmt).toLocaleString() }} ₽</span>
              </div>
              <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
                <button @click="changeDiscount(-5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
                <span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 leading-8 text-black dark:text-white">{{ project.discount }}%</span>
                <button @click="changeDiscount(5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
              </div>
            </div>
            <!-- Product qty -->
            <div class="pt-3 mt-1 border-t border-gray-200 dark:border-white/10 transition-colors">
              <div class="flex items-center justify-between">
                <div class="flex flex-col">
                  <span class="text-[10px] uppercase font-bold text-gray-500">Количество изделий</span>
                  <span class="text-[10px] font-bold text-gray-500">{{ productQty }} шт</span>
                </div>
                <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
                  <button @click="changeProductQty(-1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
                  <input type="number" min="1" v-model.number="productQty" class="w-12 h-full text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 bg-transparent outline-none caret-current text-black dark:text-white">
                  <button @click="changeProductQty(1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
                </div>
              </div>
            </div>
          </div>

          <!-- CTAs -->
          <div class="flex flex-col gap-3">
            <button @click="openInvoiceModal" class="w-full h-12 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-gray-800 dark:hover:bg-gray-200 transition-all active:scale-[0.98] shadow-xl flex items-center justify-center gap-2">
              Сформировать КП
            </button>
            <div class="grid grid-cols-2 gap-3">
              <button @click="copyQuote" class="kp-secondary-btn h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">
                Копировать КП
              </button>
              <button @click="requestReset" class="kp-secondary-btn kp-secondary-danger h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">
                Сброс
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    </div><!-- /main grid -->

    <!-- ===== SAVE MODAL ===== -->
    <Transition name="modal-anim">
      <div
        v-if="showSaveProjectModal"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print"
        @click.self="showSaveProjectModal = false; saveModalNotice = null"
      >
        <div class="bg-white p-6 rounded-xl w-full max-w-sm shadow-xl">
          <h3 class="font-bold text-lg mb-2">Сохранить в историю</h3>
          <p class="text-xs text-gray-500 mb-4">Укажите данные проекта перед сохранением</p>

          <div
            v-if="saveModalNotice"
            class="mb-4 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 shadow-sm"
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
            <div class="grid grid-cols-2 gap-2 pt-1">
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

    <Transition name="modal-anim">
      <div v-if="showResetConfirm" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showResetConfirm = false">
        <div class="bg-white dark:bg-[#1C1C1E] rounded-xl shadow-2xl p-6 max-w-sm w-full border border-white/50 dark:border-white/10 text-center transform transition-all">
          <h3 class="text-lg font-black mb-2 text-[#18181B] dark:text-white">Сбросить всё?</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Все введенные данные будут удалены.</p>
          <div class="grid grid-cols-2 gap-2">
            <button @click="showResetConfirm = false" class="py-3 rounded-xl font-bold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-xs uppercase tracking-wider">Отмена</button>
            <button @click="confirmReset" class="py-3 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all text-xs uppercase tracking-wider">Сбросить</button>
          </div>
        </div>
      </div>
    </Transition>

    <InvoiceModal
      :show="showInvoice"
      :project="invoicePayload.project"
      :layers="invoicePayload.layers"
      :processing="invoicePayload.processing"
      :accessories="invoicePayload.accessories"
      :packaging="invoicePayload.packaging"
      :design="invoicePayload.design"
      :totals="invoicePayload.totals"
      :settings="invoicePayload.settings"
      :materials="invoicePayload.materials"
      :coatings="invoicePayload.coatings"
      :product-qty="invoicePayload.productQty"
      @close="showInvoice = false"
      @print="onInvoicePrint"
    />

    <!-- ===== AUTH MODAL ===== -->
    <Transition name="modal-anim">
      <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @success="showAuthModal = false; showToast('Вход выполнен')" />
    </Transition>

    <!-- ===== TOAST ===== -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-6 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-white/20 backdrop-blur-md bg-[#18181B]/90 text-white">
        <span class="font-bold text-xs uppercase tracking-wide">{{ toast.message }}</span>
      </div>
    </Transition>

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

    <!-- ===== SCROLL TOP ===== -->
    <Transition name="pop-up">
      <div
        v-if="showScrollTop"
        class="fixed bottom-10 left-1/2 z-[90] -translate-x-1/2 w-20 h-10 flex items-center justify-center cursor-pointer"
        @click="scrollToTop"
      >
        <div class="h-10 bg-[#1d1d1f] dark:bg-white shadow-2xl border border-white/10 dark:border-black/10 rounded-full w-full"></div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white dark:text-black pointer-events-none">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </div>
    </Transition>

  </div>
</template>

<style>
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

.desktop-calc .calc-top-nav-btn {
  border-radius: 0.85rem;
  padding: 0.25rem 0.55rem;
  transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease;
}
.desktop-calc .calc-top-nav-btn:hover { transform: translateY(-1px); }
.desktop-calc .calc-top-nav-icon { background: #f3f4f6; }
html.dark .desktop-calc .calc-top-nav-icon { background: rgba(255,255,255,0.08); }
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
  box-shadow: 0 8px 16px -12px rgba(0,0,0,0.45);
}
.desktop-calc .kp-secondary-btn:active { transform: translateY(0); }
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
  border-color: rgba(255,255,255,0.16);
  color: #e5e7eb;
}
html.dark .desktop-calc .kp-secondary-btn:hover {
  background: #2b2b2f;
  border-color: rgba(255,255,255,0.28);
  color: #ffffff;
  box-shadow: 0 10px 20px -14px rgba(0,0,0,0.75);
}
html.dark .desktop-calc .kp-secondary-danger:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fecaca;
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

/* ===== Blanket dark-mode overrides (matches DesktopApp / laser) ===== */
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
.page-switch-enter-active, .page-switch-leave-active { transition: all 0.18s ease; }
.page-switch-enter-from, .page-switch-leave-to { opacity: 0; transform: translateY(4px); }
.layer-stack-enter-active { transition: all 0.28s ease-out; }
.layer-stack-leave-active  { transition: all 0.22s ease-in; position: absolute; width: 100%; }
.layer-stack-enter-from, .layer-stack-leave-to { opacity: 0; transform: translateY(-8px); }
.service-stack-enter-active { transition: all 0.22s ease-out; }
.service-stack-leave-active  { transition: all 0.18s ease-in; position: absolute; width: 100%; }
.service-stack-enter-from, .service-stack-leave-to { opacity: 0; transform: translateY(-6px); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.modal-anim-enter-active, .modal-anim-leave-active { transition: all 0.2s ease-out; }
.modal-anim-enter-from, .modal-anim-leave-to { opacity: 0; transform: scale(0.95); }
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
.pop-up-enter-active, .pop-up-leave-active { transition: all 0.25s ease; }
.pop-up-enter-from, .pop-up-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
.collapse-enter-active, .collapse-leave-active { transition: all 0.28s ease; }
.collapse-enter-from, .collapse-leave-to { opacity: 0; }

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
