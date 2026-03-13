import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDatabase } from '@/composables/useDatabase';
import { useHaptics } from '@/composables/useHaptics';
import { DEFAULT_DTF_ROLL_WIDTH_MM } from '@/utils/coatingPricing';
import { sanitizeText } from '@/utils/sanitize';
import { buildInvoicePayload } from '@/utils/invoicePayload';
import {
  DTF_ACTIVE_TABS,
  DTF_INVALID_PRODUCTS_FOR_GRID,
  DTF_LAYER_PRESETS,
  FLEX_COLOR_OPTIONS as DEFAULT_FLEX_COLOR_OPTIONS,
  FLEX_PRICE_TIERS,
  isDtfClientOwnedGarment,
  normalizeDtfFlexColorMarkups,
  getDtfFlexPricePerCm2,
  getDtfGarmentFinalPrice,
  getDtfSublimationFormatFinalPrice,
  normalizeDtfFlexMaterials,
  normalizeDtfGarments,
  normalizeDtfSublimationFormats,
  PLACEMENT_PRESETS,
  PRODUCT_TYPES,
  SIZE_KEYS,
  SUBLIMATION_FORMATS as DEFAULT_SUBLIMATION_FORMATS,
  TECH_OPTIONS,
} from './constants';

const DTF_AUTOSAVE_COUNTER_KEY = 'monocalc_dtf_autosave_counter';
const DTF_HISTORY_LOAD_KEY = 'monocalc_dtf_history_load_state_v1';
const DTF_DRAFT_STORAGE_KEY = 'monocalc_dtf_draft_v1';
const DTF_TAB_ID_KEY = 'monocalc_dtf_tab_id_v1';
const DTF_IMPORT_EXPORT_VERSION = 1;
const MAX_FLEX_COLORS = 6;

const toNumber = (value, fallback = 0) => {
  const numeric = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeFlexColorsCount = (value) => clamp(Math.round(toNumber(value, 1)) || 1, 1, MAX_FLEX_COLORS);

const LAYER_TECH_IDS = new Set(TECH_OPTIONS.map((item) => item.id));

const normalizeLayerTech = (value) => (LAYER_TECH_IDS.has(value) ? value : '');

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

const createInitialLayer = (id, name = 'Принт 1') => ({
  id,
  name,
  w: 0,
  h: 0,
  qty: 1,
  expanded: true,
  tech: '',
  placement: 'custom',
  flexColorType: 'standard',
  flexColorsCount: normalizeFlexColorsCount(1),
  sublimationFormat: 'a4',
  rotateToFit: false,
});

const createInitialPackagingItem = (id) => ({
  id,
  dbId: null,
  name: '',
  type: 'fixed',
  price: 0,
  qty: 1,
  rollWidthMm: 500,
  length: 0,
  w: 0,
  l: 0,
  h: 0,
  seedPrice: 0,
  expanded: true,
});

const createInitialProject = () => ({
  name: '',
  client: '',
  markup: 0,
  discount: 0,
});

export function useDtfCalculator() {
  const router = useRouter();
  const { impactLight, impactMedium } = useHaptics();
  const {
    user: currentUser,
    hasPermission,
    isOfflineMode,
    settings,
    packagingDB,
    processingDB,
    saveProjectToHistory,
  } = useDatabase();

  const draftStorage = getPreferredStorage();
  const draftStorageKey = `${DTF_DRAFT_STORAGE_KEY}_${getTabId()}`;

  const activeTab = ref('garment');
  const project = ref(createInitialProject());
  const productQty = ref(1);
  const productType = ref('tshirt');
  const sizeGridEnabled = ref(false);
  const sizeGrid = ref(Object.fromEntries(SIZE_KEYS.map((key) => [key, 0])));
  const blankPrice = ref(0);
  const isCostVisible = ref(false);

  const showSaveProjectModal = ref(false);
  const saveModalNotice = ref(null);
  const isManualSaving = ref(false);
  const showAuthModal = ref(false);
  const showResetConfirm = ref(false);
  const showSizeGridExitConfirm = ref(false);
  const showInvoice = ref(false);
  const showScrollTop = ref(false);
  const toast = ref({ show: false, message: '', actionLabel: '', onAction: null });
  const saveFireworks = ref([]);
  const draftStatus = ref('idle');
  const lastDraftSavedAt = ref('');

  const materials = ref([]);
  const materialGroups = computed(() => []);
  const coatings = ref([]);
  const accessories = ref([]);
  const design = ref([]);
  const materialConsumption = computed(() => []);

  const autoSaveCounter = ref(parseInt(localStorage.getItem(DTF_AUTOSAVE_COUNTER_KEY) || '1', 10) || 1);
  let layerIdCtr = 1;
  let pkgIdCtr = 100;
  let saveFireworkCounter = 0;
  let saveFireworksTimer = null;
  let draftSaveTimeout = null;
  let toastTimer = null;
  let preserveBlankPriceOnNextProductTypeSync = false;

  const layers = ref([createInitialLayer(layerIdCtr++)]);
  const packaging = ref([]);

  const canViewHistory = computed(() => hasPermission('canSaveHistory'));
  const canViewSettings = computed(() => hasPermission('canViewSettings'));
  const canUseCloud = computed(() => !isOfflineMode.value);

  const activeDtfItem = computed(() =>
    processingDB.value.find((item) => item?.type === 'area_cm2' && item?.active !== false) || null
  );
  const rollWidthMm = computed(() => Number(activeDtfItem.value?.dtfWidthMm) || DEFAULT_DTF_ROLL_WIDTH_MM);
  const pricePerCm2 = computed(() => {
    const base = Number(activeDtfItem.value?.price) || 0;
    const markup = Math.max(0, Number(activeDtfItem.value?.markupPercent) || 0);
    return base * (1 + markup / 100);
  });
  const dtfSettingLabel = computed(() => activeDtfItem.value?.name || null);

  const garmentCatalog = computed(() => normalizeDtfGarments(settings.value?.dtfGarments, settings.value?.dtfGarmentPrices));
  const flexColorMarkupTiers = computed(() => normalizeDtfFlexColorMarkups(settings.value?.dtfFlexColorMarkups));
  const flexMaterials = computed(() => normalizeDtfFlexMaterials(settings.value?.dtfFlexMaterials));
  const sublimationFormats = computed(() => normalizeDtfSublimationFormats(settings.value?.dtfSublimationFormats));
  const flexMaterialOptions = computed(() => {
    const activeItems = flexMaterials.value.filter((item) => item?.active !== false);
    const source = activeItems.length ? activeItems : flexMaterials.value;
    return source.map((item) => ({
      id: item.id,
      value: item.id,
      label: item.name,
      coeff: 1,
      linearMeterPrice: Number(item.linearMeterPrice) || 0,
      rollWidthMm: Number(item.rollWidthMm) || 500,
      markupPercent: Number(item.markupPercent) || 0,
    }));
  });
  const sublimationFormatOptions = computed(() => {
    const activeItems = sublimationFormats.value.filter((item) => item?.active !== false);
    const source = activeItems.length ? activeItems : sublimationFormats.value;
    return source.map((item) => ({
      id: item.id,
      label: item.name,
      w: Number(item.widthMm) || 0,
      h: Number(item.heightMm) || 0,
      price: getDtfSublimationFormatFinalPrice(item),
    }));
  });
  const PRODUCT_TYPES_OPTIONS = computed(() => {
    const activeItems = garmentCatalog.value.filter((item) => item?.active !== false);
    return (activeItems.length ? activeItems : garmentCatalog.value).map((item) => ({
      ...item,
      label: item.name,
    }));
  });
  const findGarmentById = (id) => garmentCatalog.value.find((item) => item.id === id) || null;
  const getFallbackProductTypeId = () => PRODUCT_TYPES_OPTIONS.value[0]?.id || garmentCatalog.value[0]?.id || PRODUCT_TYPES[0]?.id || 'tshirt';
  const resolveProductTypeId = (candidate) => findGarmentById(candidate)?.id || getFallbackProductTypeId();
  const setResolvedProductType = (candidate, options = {}) => {
    preserveBlankPriceOnNextProductTypeSync = Boolean(options.preserveBlankPrice);
    productType.value = resolveProductTypeId(candidate);
  };
  const currentProductType = computed(() => {
    const currentItem = findGarmentById(productType.value) || PRODUCT_TYPES_OPTIONS.value[0] || garmentCatalog.value[0];
    if (currentItem) {
      return {
        ...currentItem,
        label: currentItem.label || currentItem.name,
      };
    }

    return {
      id: PRODUCT_TYPES[0]?.id || 'tshirt',
      name: PRODUCT_TYPES[0]?.label || 'Изделие',
      label: PRODUCT_TYPES[0]?.label || 'Изделие',
      active: true,
      clientOwned: false,
      purchasePrice: 0,
      markupPercent: 0,
    };
  });
  const currentProductRiskMarkupPercent = computed(() => (
    isDtfClientOwnedGarment(currentProductType.value)
      ? Math.max(0, Number(settings.value?.clientMaterialPrintRiskPercent) || 0)
      : 0
  ));
  const defaultBlankPrice = computed(() => {
    return Math.max(0, Number(getDtfGarmentFinalPrice(currentProductType.value)) || 0);
  });
  const isBlankPriceCustom = computed(() => Math.abs((Number(blankPrice.value) || 0) - defaultBlankPrice.value) > 0.0001);
  const canUseSizeGrid = computed(() => !DTF_INVALID_PRODUCTS_FOR_GRID.includes(productType.value));
  const sizeGridTotal = computed(() => SIZE_KEYS.reduce((sum, key) => sum + (Number(sizeGrid.value[key]) || 0), 0));

  const setBlankPrice = (value) => {
    blankPrice.value = Math.max(0, Number(value) || 0);
  };

  const stepBlankPrice = (delta) => {
    blankPrice.value = Math.max(0, (Number(blankPrice.value) || 0) + delta);
  };

  const resetBlankPriceToDefault = () => {
    blankPrice.value = defaultBlankPrice.value;
  };

  const statusConfig = computed(() => isOfflineMode.value
    ? {
        text: 'Офлайн',
        cls: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/20',
        dot: 'bg-red-500',
      }
    : {
        text: 'Онлайн',
        cls: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300 border-green-100 dark:border-green-500/20',
        dot: 'bg-green-500',
      });

  const packagingOptions = computed(() =>
    (packagingDB.value || [])
      .filter((item) => item?.inStock !== false && item?.active !== false)
      .map((item) => {
        const markup = Math.max(0, Number(item?.markupPercent) || 0);
        const price = Number(item?.price || 0) * (1 + markup / 100);
        const rw = Number(item?.rollWidthMm || item?.rollWidth) || 0;
        return {
          value: item.id,
          label: item.name,
          sub: item.type === 'roll'
            ? `${Math.round(price)} ₽/пог.м${rw > 0 ? ` · ${rw}мм` : ''}`
            : item.type === 'box_mm'
              ? `${Math.round(price)} ₽/м²`
              : `${Math.round(price)} ₽`,
        };
      })
  );

  const layerAreaCm2 = (layer) => {
    if (layer?.tech === 'sublimation') {
      const format = sublimationFormats.value.find((item) => item.id === (layer?.sublimationFormat || 'a4')) || sublimationFormats.value[1] || DEFAULT_SUBLIMATION_FORMATS[1];
      return ((Number(format?.widthMm) || Number(format?.w) || 0) * (Number(format?.heightMm) || Number(format?.h) || 0)) / 100;
    }
    return (Math.max(0, Number(layer?.w) || 0) * Math.max(0, Number(layer?.h) || 0)) / 100;
  };

  const normalizedLayerSize = (layer) => {
    const width = Math.max(0, Number(layer?.w) || 0);
    const height = Math.max(0, Number(layer?.h) || 0);
    return { width, height };
  };

  const effectivePricePerCm2 = (layer) => {
    const tech = normalizeLayerTech(layer?.tech);
    if (!tech) return 0;
    if (tech === 'sublimation') {
      const format = sublimationFormats.value.find((item) => item.id === (layer?.sublimationFormat || 'a4')) || sublimationFormats.value[1] || DEFAULT_SUBLIMATION_FORMATS[1];
      const areaCm2 = layerAreaCm2({ ...layer, tech: 'sublimation' });
      if (!areaCm2) return 0;
      return getDtfSublimationFormatFinalPrice(format) / areaCm2;
    }
    if (tech === 'flex') {
      const material = flexMaterials.value.find((item) => item.id === (layer?.flexColorType || 'standard')) || flexMaterials.value[0] || DEFAULT_FLEX_COLOR_OPTIONS[0];
      const colorCount = normalizeFlexColorsCount(layer?.flexColorsCount);
      const tier = flexColorMarkupTiers.value[Math.min(colorCount - 1, flexColorMarkupTiers.value.length - 1)] || flexColorMarkupTiers.value[0] || { markupPercent: 0 };
      return getDtfFlexPricePerCm2(material, { includeMarkup: true }) * (1 + (Math.max(0, Number(tier?.markupPercent) || 0) / 100));
    }
    return pricePerCm2.value;
  };

  const layerValidationMessage = (layer) => {
    const tech = normalizeLayerTech(layer?.tech);
    if (!tech) return 'Выберите технологию печати.';
    if (tech === 'sublimation') return '';

    const width = Math.max(0, Number(layer?.w) || 0);
    const height = Math.max(0, Number(layer?.h) || 0);
    if (!width || !height) return 'Введите ширину и высоту макета.';

    const normalized = normalizedLayerSize(layer);
    if (normalized.width > rollWidthMm.value) {
      return `Макет шире рабочей ширины ${rollWidthMm.value} мм. Уменьшите ширину макета.`;
    }

    return '';
  };

  const layerCanBeCalculated = (layer) => {
    const tech = normalizeLayerTech(layer?.tech);
    if (!tech) return false;
    if (tech === 'sublimation') return true;
    return !layerValidationMessage(layer);
  };

  const layerCost = (layer) => {
    if (!layerCanBeCalculated(layer)) return 0;
    const qty = Math.max(1, Number(layer?.qty) || 1);
    return layerAreaCm2(layer) * effectivePricePerCm2(layer) * qty;
  };

  const totalPrints = computed(() => layers.value.reduce((sum, layer) => sum + Math.max(1, Number(layer.qty) || 1), 0));

  const totalLinearM = computed(() => {
    return layers.value.reduce((sum, layer) => {
      if (layer?.tech !== 'dtf') return sum;
      if (!layerCanBeCalculated(layer)) return sum;

      const normalized = normalizedLayerSize(layer);
      const width = normalized.width;
      const height = normalized.height;
      const qty = Math.max(1, Number(layer?.qty) || 1);
      const spacingMm = 8;
      const printableWidth = Math.max(0, rollWidthMm.value - spacingMm);
      const footprintWidth = width + spacingMm;
      const footprintHeight = height + spacingMm;
      const fitsPerRow = footprintWidth > 0 ? Math.floor(printableWidth / footprintWidth) : 0;
      if (!fitsPerRow) return sum;
      return sum + (Math.ceil(qty / fitsPerRow) * footprintHeight) / 1000;
    }, 0);
  });

  const dtfRollSummaryRows = computed(() => layers.value
    .filter((layer) => layer?.tech === 'dtf')
    .map((layer) => {
      const normalized = normalizedLayerSize(layer);
      const spacingMm = 8;
      const printableWidth = Math.max(0, rollWidthMm.value - spacingMm);
      const footprintWidth = normalized.width + spacingMm;
      const fitsPerRow = footprintWidth > 0 ? Math.floor(printableWidth / footprintWidth) : 0;
      const qty = Math.max(1, Number(layer?.qty) || 1);
      const meters = fitsPerRow > 0 && layerCanBeCalculated(layer)
        ? (Math.ceil(qty / fitsPerRow) * (normalized.height + spacingMm)) / 1000
        : 0;
      return {
        id: layer.id,
        name: layer.name || 'Принт',
        qty,
        fitsPerRow,
        meters,
        invalid: !layerCanBeCalculated(layer),
      };
    }));

  const orderQty = computed(() => Math.max(1, Number(productQty.value) || 1));
  const materialBaseTotal = computed(() => layers.value.reduce((sum, layer) => sum + layerCost(layer), 0));
  const materialUnitTotal = computed(() => (
    materialBaseTotal.value * (1 + (currentProductRiskMarkupPercent.value / 100))
  ));
  const packagingUnitTotal = computed(() => packaging.value.reduce((sum, item) => {
    const qty = Math.max(0, Number(item?.qty) || 0);
    const price = Math.max(0, Number(item?.price) || 0);
    if (!qty || !price) return sum;

    if (item?.type === 'roll') {
      return sum + price * (Math.max(0, Number(item?.length) || 0) / 1000) * qty;
    }

    if (item?.type === 'box_mm') {
      const width = Math.max(0, Number(item?.w) || 0);
      const length = Math.max(0, Number(item?.l) || 0);
      const height = Math.max(0, Number(item?.h) || 0);
      const areaM2 = (2 * ((width * length) + (width * height) + (length * height))) / 1000000;
      return sum + price * areaM2 * qty;
    }

    return sum + price * qty;
  }, 0));
  const materialTotal = computed(() => materialUnitTotal.value * orderQty.value);
  const packagingTotal = computed(() => packagingUnitTotal.value * orderQty.value);
  const blankUnitTotal = computed(() => Math.max(0, Number(blankPrice.value) || 0));
  const blankTotal = computed(() => blankUnitTotal.value * orderQty.value);
  const orderSubtotal = computed(() => materialTotal.value + packagingTotal.value + blankTotal.value);
  const markupAmt = computed(() => orderSubtotal.value * Math.max(0, Number(project.value.markup) || 0) / 100);
  const discountAmt = computed(() => (orderSubtotal.value + markupAmt.value) * Math.max(0, Number(project.value.discount) || 0) / 100);
  const totalForAll = computed(() => Math.round(orderSubtotal.value + markupAmt.value - discountAmt.value));
  const pricePerOne = computed(() => {
    return Math.round(totalForAll.value / orderQty.value);
  });

  const dtfTotals = computed(() => ({
    costLayers: materialTotal.value,
    layers: materialTotal.value,
    processing: 0,
    accessories: blankTotal.value,
    costPackaging: packagingTotal.value,
    packaging: packagingTotal.value,
    design: 0,
    costTotal: orderSubtotal.value,
    markupRub: markupAmt.value,
    discountRub: discountAmt.value,
    total: totalForAll.value,
  }));

  const hasAnyValidLayer = computed(() => layers.value.some((layer) => layerCanBeCalculated(layer) && layerCost(layer) > 0));

  const dtfSizeBreakdownItems = computed(() => {
    if (!sizeGridEnabled.value) return [];

    return SIZE_KEYS
      .map((key) => ({ key, qty: Math.max(0, Number(sizeGrid.value?.[key]) || 0) }))
      .filter((item) => item.qty > 0);
  });

  const dtfSizeBreakdown = computed(() => {
    return dtfSizeBreakdownItems.value
      .map((item) => `${item.key} × ${item.qty}`)
      .join(', ');
  });

  const getDtfLayerInvoiceMeta = (layer) => {
    const techId = String(layer?.tech || '');
    const techLabel = TECH_OPTIONS.find((item) => item.id === techId)?.label || 'Нанесение';
    const placementLabel = PLACEMENT_PRESETS.find((item) => item.id === layer?.placement)?.label || '';
    const sublimationLabel = sublimationFormatOptions.value.find((item) => item.id === layer?.sublimationFormat)?.label || '';
    const flexMaterialLabel = flexMaterialOptions.value.find((item) => item.id === layer?.flexColorType)?.label || '';

    return {
      techLabel,
      placementLabel,
      sublimationLabel,
      flexMaterialLabel,
      qtyPerProduct: Math.max(1, Number(layer?.qty) || 1),
    };
  };

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
      getLayerCost: (layer) => layerCost(layer),
      getEffectivePricePerCm2: (layer) => effectivePricePerCm2(layer),
      garment: {
        label: currentProductType.value?.label || currentProductType.value?.name || 'Изделие',
        sizeBreakdown: dtfSizeBreakdown.value,
        sizeBreakdownItems: dtfSizeBreakdownItems.value,
        sizeGridEnabled: sizeGridEnabled.value,
        unitPrice: blankUnitTotal.value,
        total: blankTotal.value,
      },
      getLayerMeta: (layer) => getDtfLayerInvoiceMeta(layer),
    },
  }));

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
    garment: {
      productType: productType.value,
      sizeGridEnabled: sizeGridEnabled.value,
      sizeGrid: { ...sizeGrid.value },
      blankPrice: blankPrice.value,
    },
    ui: {
      activeTab: activeTab.value,
    },
  });

  const createStateSnapshot = () => JSON.parse(JSON.stringify({
    project: project.value,
    productQty: productQty.value,
    productType: productType.value,
    sizeGridEnabled: sizeGridEnabled.value,
    sizeGrid: sizeGrid.value,
    blankPrice: blankPrice.value,
    activeTab: activeTab.value,
    layers: layers.value,
    packaging: packaging.value,
  }));

  const restoreStateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;

    project.value = {
      ...createInitialProject(),
      ...(snapshot.project || {}),
      markup: clamp(Math.max(0, Number(snapshot?.project?.markup) || 0), 0, 50),
      discount: clamp(Math.max(0, Number(snapshot?.project?.discount) || 0), 0, 50),
    };
    productQty.value = Math.max(1, Number(snapshot.productQty) || 1);
    setResolvedProductType(snapshot.productType, { preserveBlankPrice: true });
    sizeGridEnabled.value = Boolean(snapshot.sizeGridEnabled);
    sizeGrid.value = Object.fromEntries(SIZE_KEYS.map((key) => [key, Math.max(0, Number(snapshot?.sizeGrid?.[key]) || 0)]));
    blankPrice.value = Math.max(0, Number(snapshot.blankPrice) || 0);
    activeTab.value = DTF_ACTIVE_TABS.includes(snapshot.activeTab) ? snapshot.activeTab : 'layers';

    const nextLayers = Array.isArray(snapshot.layers) && snapshot.layers.length
      ? snapshot.layers.map((layer, index) => ({
          ...createInitialLayer(Number(layer?.id) || index + 1, layer?.name || `Принт ${index + 1}`),
          ...layer,
          qty: Math.max(1, Number(layer?.qty) || 1),
          tech: normalizeLayerTech(layer?.tech),
          placement: layer?.placement || 'custom',
          flexColorType: layer?.flexColorType || 'standard',
          flexColorsCount: normalizeFlexColorsCount(layer?.flexColorsCount),
          sublimationFormat: layer?.sublimationFormat || 'a4',
          rotateToFit: Boolean(layer?.rotateToFit),
        }))
      : [createInitialLayer(1)];
    layers.value = nextLayers;
    layerIdCtr = nextLayers.reduce((maxId, layer) => Math.max(maxId, Number(layer.id) || 0), 0) + 1;

    const nextPackaging = Array.isArray(snapshot.packaging)
      ? snapshot.packaging.map((item, index) => ({
          ...createInitialPackagingItem(Number(item?.id) || 100 + index + 1),
          ...item,
          qty: Math.max(0, Number(item?.qty) || 0),
          rollWidthMm: Number(item?.rollWidthMm) || 500,
          length: Number(item?.length) || 0,
          w: Number(item?.w) || 0,
          l: Number(item?.l) || 0,
          h: Number(item?.h) || 0,
          seedPrice: Number(item?.seedPrice) || 0,
          expanded: item?.expanded !== false,
        }))
      : [];
    packaging.value = nextPackaging;
    pkgIdCtr = nextPackaging.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 100) + 1;
    packaging.value.forEach((item) => syncPackagingSelection(item, { preserveCustomPrice: true }));
  };

  const hideToast = () => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.value = { show: false, message: '', actionLabel: '', onAction: null };
  };

  const showToast = (message, options = {}) => {
    const { actionLabel = '', onAction = null, duration = actionLabel ? 5000 : 2600 } = options;
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

  const exportProjectJson = () => {
    const snapshot = createStateSnapshot();
    const payload = {
      type: 'monocalc-dtf-project',
      version: DTF_IMPORT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      projectName: project.value.name || '',
      data: snapshot,
    };

    const fileNameBase = sanitizeText((project.value.name || 'dtf-project').trim()) || 'dtf-project';
    const fileName = `${fileNameBase.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]+/gi, '') || 'dtf-project'}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Проект экспортирован в JSON');
  };

  const importProjectJson = async (event) => {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (parsed?.type !== 'monocalc-dtf-project') {
        throw new Error('Файл не является экспортом DTF-проекта');
      }
      if (!parsed?.data || typeof parsed.data !== 'object') {
        throw new Error('В файле нет данных проекта');
      }

      const snapshot = createStateSnapshot();
      restoreStateSnapshot(parsed.data);
      draftStatus.value = 'dirty';
      showToast('Проект импортирован', {
        actionLabel: 'Отменить',
        onAction: () => {
          restoreStateSnapshot(snapshot);
          draftStatus.value = 'dirty';
          showToast('Импорт отменён');
        },
      });
    } catch (error) {
      showToast(error?.message || 'Не удалось импортировать JSON');
    } finally {
      if (input) input.value = '';
    }
  };

  const validateProjectBeforeOutput = () => {
    if (!hasAnyValidLayer.value) {
      showToast('Добавьте хотя бы один валидный принт с размером или форматом.');
      activeTab.value = 'layers';
      return false;
    }
    return true;
  };

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
      draftStatus.value = 'saved';
      lastDraftSavedAt.value = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {}
  };

  const restoreDraftState = () => {
    try {
      let raw = draftStorage.getItem(draftStorageKey);
      if (!raw) {
        raw = draftStorage.getItem(DTF_DRAFT_STORAGE_KEY);
        if (raw) draftStorage.setItem(draftStorageKey, raw);
      }
      if (!raw) return false;
      const parsed = JSON.parse(raw);

      const nextProject = parsed?.project || {};
      project.value = {
        name: nextProject.name || '',
        client: nextProject.client || '',
        markup: clamp(Math.max(0, Number(nextProject.markup) || 0), 0, 50),
        discount: clamp(Math.max(0, Number(nextProject.discount) || 0), 0, 50),
      };

      const nextQty = Number(nextProject.qty || 1);
      productQty.value = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : 1;

      const nextLayers = Array.isArray(parsed?.layers) && parsed.layers.length
        ? parsed.layers.map((layer, index) => ({
            ...createInitialLayer(Number(layer?.id) || index + 1, layer?.name || `Принт ${index + 1}`),
            ...layer,
            qty: Math.max(1, Number(layer?.qty) || 1),
            tech: normalizeLayerTech(layer?.tech),
            placement: layer?.placement || 'custom',
            flexColorType: layer?.flexColorType || 'standard',
            flexColorsCount: normalizeFlexColorsCount(layer?.flexColorsCount),
            sublimationFormat: layer?.sublimationFormat || 'a4',
            rotateToFit: Boolean(layer?.rotateToFit),
          }))
        : [createInitialLayer(1)];
      layers.value = nextLayers;
      layerIdCtr = nextLayers.reduce((maxId, layer) => Math.max(maxId, Number(layer.id) || 0), 0) + 1;

      const nextPackaging = Array.isArray(parsed?.packaging)
        ? parsed.packaging.map((item, index) => ({
            ...createInitialPackagingItem(Number(item?.id) || 100 + index + 1),
            ...item,
            qty: Math.max(0, Number(item?.qty) || 0),
            rollWidthMm: Number(item?.rollWidthMm) || 500,
            length: Number(item?.length) || 0,
            w: Number(item?.w) || 0,
            l: Number(item?.l) || 0,
            h: Number(item?.h) || 0,
            seedPrice: Number(item?.seedPrice) || 0,
            expanded: item?.expanded !== false,
          }))
        : [];
      packaging.value = nextPackaging;
      pkgIdCtr = nextPackaging.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 100) + 1;
      packaging.value.forEach((item) => syncPackagingSelection(item, { preserveCustomPrice: true }));

      const garment = parsed?.garment || {};
      setResolvedProductType(garment.productType, { preserveBlankPrice: true });
      sizeGridEnabled.value = Boolean(garment.sizeGridEnabled);
      if (garment.sizeGrid && typeof garment.sizeGrid === 'object') {
        SIZE_KEYS.forEach((key) => {
          if (key in garment.sizeGrid) {
            sizeGrid.value[key] = Math.max(0, Number(garment.sizeGrid[key]) || 0);
          }
        });
      }
      blankPrice.value = Math.max(0, Number(garment.blankPrice) || 0);
      activeTab.value = DTF_ACTIVE_TABS.includes(parsed?.activeTab) ? parsed.activeTab : 'garment';
      return true;
    } catch (error) {
      return false;
    }
  };

  const saveToHistory = async (nameOverride, opts = {}) => {
    if (!currentUser.value) throw new Error('Сначала войдите в аккаунт');
    if (!canViewHistory.value) throw new Error('Нет прав для сохранения в историю');
    if (!validateProjectBeforeOutput()) throw new Error('Нет валидных позиций для сохранения');

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
      if (!currentUser.value || !canViewHistory.value || !hasAnyValidLayer.value) return false;
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

  const showOfflineToast = () => {
    showToast('Офлайн: раздел временно недоступен');
  };

  const blockCloudAction = (action) => {
    if (!canUseCloud.value) {
      showOfflineToast();
      return;
    }
    action();
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
          color: palette[Math.floor(Math.random() * palette.length)],
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

  const openSaveProjectModal = () => {
    blockCloudAction(() => {
      if (!validateProjectBeforeOutput()) return;
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

  const handleManualSaveToHistory = async () => {
    if (!canViewHistory.value) {
      showToast('Нет прав для сохранения в историю');
      return;
    }
    if (!validateProjectBeforeOutput()) return;
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
        showToast('Проект сохранён в Историю');
      }
    } catch (error) {
      showToast(error?.message || 'Ошибка сохранения');
    } finally {
      isManualSaving.value = false;
    }
  };

  const openInvoiceModal = () => {
    if (!validateProjectBeforeOutput()) return;
    showInvoice.value = true;
  };

  const copyQuote = async () => {
    if (!validateProjectBeforeOutput()) return;
    const date = new Date().toLocaleDateString('ru-RU');
    let text = `КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ\nДата: ${date}\n\n`;
    if (project.value.name) text += `Проект: ${project.value.name}\n`;
    text += `Количество изделий: ${productQty.value}\n`;
    text += `ИТОГО К ОПЛАТЕ: ${totalForAll.value.toLocaleString()} ₽`;

    try {
      await navigator.clipboard.writeText(text);
      showToast('Скопировано');
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
    const snapshot = createStateSnapshot();
    layers.value = [createInitialLayer(layerIdCtr++, 'Принт 1')];
    packaging.value = [];
    project.value = createInitialProject();
    productQty.value = 1;
    setResolvedProductType(PRODUCT_TYPES[0]?.id || 'tshirt');
    sizeGridEnabled.value = false;
    sizeGrid.value = Object.fromEntries(SIZE_KEYS.map((key) => [key, 0]));
    blankPrice.value = defaultBlankPrice.value;
    activeTab.value = 'layers';
    showInvoice.value = false;
    showResetConfirm.value = false;
    draftStorage.removeItem(draftStorageKey);
    draftStorage.removeItem(DTF_DRAFT_STORAGE_KEY);
    draftStatus.value = 'idle';
    lastDraftSavedAt.value = '';
    showToast('Проект очищен', {
      actionLabel: 'Отменить',
      onAction: () => {
        restoreStateSnapshot(snapshot);
        draftStatus.value = 'dirty';
        showToast('Сброс отменён');
      },
    });
  };

  const requestToggleSizeGrid = () => {
    if (!sizeGridEnabled.value) {
      sizeGridEnabled.value = true;
      if (sizeGridTotal.value > 0) {
        productQty.value = Math.max(1, sizeGridTotal.value);
      }
      return;
    }
    showSizeGridExitConfirm.value = true;
  };

  const keepGridTotalAsProductQty = () => {
    sizeGridEnabled.value = false;
    productQty.value = Math.max(1, sizeGridTotal.value || productQty.value || 1);
    showSizeGridExitConfirm.value = false;
    showToast('Сетка размеров отключена, общее количество сохранено');
  };

  const resetGridAndProductQty = () => {
    sizeGridEnabled.value = false;
    sizeGrid.value = Object.fromEntries(SIZE_KEYS.map((key) => [key, 0]));
    productQty.value = 1;
    showSizeGridExitConfirm.value = false;
    showToast('Сетка размеров отключена, количество сброшено');
  };

  const cancelSizeGridExit = () => {
    showSizeGridExitConfirm.value = false;
  };

  const openSettings = () => {
    if (!canUseCloud.value) {
      showToast('Офлайн: настройки недоступны');
      return;
    }
    impactLight();
    router.push({ path: '/settings/dtf', query: { from: 'calc', calc: 'dtf' } });
  };

  const openHistory = () => {
    if (!canUseCloud.value) {
      showToast('Офлайн: история недоступна');
      return;
    }
    impactLight();
    router.push({ path: '/history', query: { from: 'calc', calc: 'dtf' } });
  };

  const syncPackagingSelection = (item, { preserveCustomPrice = false } = {}) => {
    const dbItem = (packagingDB.value || []).find((entry) => entry.id === item?.dbId);
    if (!dbItem) return;

    const markup = Math.max(0, Number(dbItem?.markupPercent) || 0);
    const defaultPrice = Number(dbItem.price || 0) * (1 + markup / 100);

    item.name = dbItem.name;
    item.type = dbItem.type || 'fixed';
    if (!(preserveCustomPrice && Number(item.price) > 0 && Number(item.price) !== Number(item.seedPrice || 0))) {
      item.price = defaultPrice;
      item.seedPrice = defaultPrice;
    }
    item.rollWidthMm = Number(dbItem.rollWidthMm || dbItem.rollWidth) || item.rollWidthMm || 500;
  };

  const onPkgSelect = (item, value) => {
    item.dbId = value;
    syncPackagingSelection(item);
  };

  const addPackaging = () => {
    impactLight();
    packaging.value.forEach((item) => {
      item.expanded = false;
    });
    packaging.value.unshift(createInitialPackagingItem(++pkgIdCtr));
  };

  const removePackaging = (id) => {
    const snapshot = createStateSnapshot();
    packaging.value = packaging.value.filter((item) => item.id !== id);
    showToast('Упаковка удалена', {
      actionLabel: 'Отменить',
      duration: 5000,
      onAction: () => {
        restoreStateSnapshot(snapshot);
        draftStatus.value = 'dirty';
        showToast('Удаление упаковки отменено');
      },
    });
  };

  const applyPlacementPreset = (layer, presetId) => {
    if (presetId === 'custom') {
      layer.placement = 'custom';
      return;
    }
    const preset = PLACEMENT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    layer.placement = preset.id;
    layer.w = preset.w;
    layer.h = preset.h;
    if (!layer.name || /^Принт\s+\d+/i.test(layer.name)) {
      layer.name = preset.label;
    }
  };

  const addLayer = () => {
    impactLight();
    layers.value.forEach((layer) => {
      layer.expanded = false;
    });
    layers.value.unshift(createInitialLayer(layerIdCtr++, `Принт ${layers.value.length + 1}`));
  };

  const removeLayer = (id) => {
    const snapshot = createStateSnapshot();
    layers.value = layers.value.filter((item) => item.id !== id);
    if (!layers.value.length) {
      layers.value = [createInitialLayer(layerIdCtr++, 'Принт 1')];
    }
    showToast('Деталь удалена', {
      actionLabel: 'Отменить',
      duration: 5000,
      onAction: () => {
        restoreStateSnapshot(snapshot);
        draftStatus.value = 'dirty';
        showToast('Удаление детали отменено');
      },
    });
  };

  const duplicateLayer = (layer) => {
    impactLight();
    layers.value.forEach((item) => {
      item.expanded = false;
    });
    layers.value.unshift({
      ...JSON.parse(JSON.stringify(layer)),
      id: layerIdCtr++,
      name: `${layer.name} (копия)`,
      expanded: true,
    });
  };

  const applyProductQtyToLayers = () => {
    const qty = Math.max(1, Number(productQty.value) || 1);
    layers.value.forEach((layer) => {
      layer.qty = qty;
    });
    showToast('Количество изделий применено ко всем принтам');
  };

  const addLayerPreset = (presetId) => {
    const preset = DTF_LAYER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    layers.value.forEach((layer) => {
      layer.expanded = false;
    });

    const nextLayers = preset.layers.map((item) => {
      const layer = createInitialLayer(layerIdCtr++, item.name);
      applyPlacementPreset(layer, item.placement);
      layer.name = item.name;
      return layer;
    });

    layers.value = [...nextLayers, ...layers.value];
    if (layers.value[0]) layers.value[0].expanded = true;
    showToast(`Добавлен шаблон: ${preset.label}`);
  };

  const toggleCostVisibility = () => {
    isCostVisible.value = !isCostVisible.value;
  };

  const changeMarkup = (delta) => {
    project.value.markup = clamp(project.value.markup + delta, 0, 50);
  };

  const changeDiscount = (delta) => {
    project.value.discount = clamp(project.value.discount + delta, 0, 50);
  };

  const applyManualProductQty = (nextQty) => {
    const normalizedQty = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : 1;

    if (sizeGridEnabled.value && canUseSizeGrid.value) {
      sizeGridEnabled.value = false;
      showToast('Сетка размеров отключена, используется ручное количество');
    }

    productQty.value = normalizedQty;
  };

  const changeProductQty = (delta) => {
    if (delta && typeof delta === 'object' && 'absoluteQty' in delta) {
      const nextQty = Number(delta.absoluteQty);
      applyManualProductQty(nextQty);
      return;
    }

    if (delta && typeof delta === 'object' && 'target' in delta) {
      const nextQty = Number(delta.target?.value);
      applyManualProductQty(nextQty);
      return;
    }

    applyManualProductQty(Math.max(1, productQty.value + delta));
  };

  const stepUp = (obj, key, step = 1) => {
    obj[key] = parseFloat(((Number(obj[key]) || 0) + step).toFixed(1));
  };

  const stepDown = (obj, key, step = 1, min = 0) => {
    const nextValue = (Number(obj[key]) || 0) - step;
    obj[key] = nextValue < min ? min : parseFloat(nextValue.toFixed(1));
  };

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
        markup: clamp(Math.max(0, Number(nextProject.markup) || 0), 0, 50),
        discount: clamp(Math.max(0, Number(nextProject.discount) || 0), 0, 50),
      };

      const nextQty = Number(nextProject.qty || parsed?.qty || 1);
      productQty.value = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : 1;

      const nextLayers = Array.isArray(state.layers) && state.layers.length
        ? state.layers.map((layer, index) => ({
            ...createInitialLayer(Number(layer?.id) || index + 1, layer?.name || `Принт ${index + 1}`),
            ...layer,
            qty: Math.max(1, Number(layer?.qty) || 1),
            expanded: index === 0,
            tech: normalizeLayerTech(layer?.tech),
            placement: layer?.placement || 'custom',
            flexColorType: layer?.flexColorType || 'standard',
            flexColorsCount: normalizeFlexColorsCount(layer?.flexColorsCount),
            sublimationFormat: layer?.sublimationFormat || 'a4',
            rotateToFit: Boolean(layer?.rotateToFit),
          }))
        : [createInitialLayer(1)];
      layers.value = nextLayers;
      layerIdCtr = nextLayers.reduce((maxId, layer) => Math.max(maxId, Number(layer.id) || 0), 0) + 1;

      const nextPackaging = Array.isArray(state.packaging)
        ? state.packaging.map((item, index) => ({
            ...createInitialPackagingItem(Number(item?.id) || 100 + index + 1),
            ...item,
            qty: Math.max(0, Number(item?.qty) || 0),
            rollWidthMm: Number(item?.rollWidthMm) || 500,
            length: Number(item?.length) || 0,
            w: Number(item?.w) || 0,
            l: Number(item?.l) || 0,
            h: Number(item?.h) || 0,
            seedPrice: Number(item?.seedPrice) || 0,
            expanded: item?.expanded !== false,
          }))
        : [];
      packaging.value = nextPackaging;
      pkgIdCtr = nextPackaging.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 100) + 1;
      packaging.value.forEach((item) => syncPackagingSelection(item, { preserveCustomPrice: true }));

      const garment = state.garment || {};
      setResolvedProductType(garment.productType, { preserveBlankPrice: true });
      sizeGridEnabled.value = Boolean(garment.sizeGridEnabled);
      if (garment.sizeGrid && typeof garment.sizeGrid === 'object') {
        SIZE_KEYS.forEach((key) => {
          sizeGrid.value[key] = Math.max(0, Number(garment.sizeGrid[key]) || 0);
        });
      }
      blankPrice.value = Math.max(0, Number(garment.blankPrice) || 0);
      activeTab.value = DTF_ACTIVE_TABS.includes(state?.ui?.activeTab) ? state.ui.activeTab : 'layers';

      sessionStorage.removeItem(DTF_HISTORY_LOAD_KEY);
      showToast('Проект загружен из истории');
    } catch (error) {
      sessionStorage.removeItem(DTF_HISTORY_LOAD_KEY);
    }
  };

  const onBeforeEnter = (el) => {
    el.style.height = '0';
    el.style.opacity = '0';
    el.style.overflow = 'hidden';
  };

  const onEnter = (el) => {
    el.style.transition = 'all 0.28s ease-out';
    el.style.height = `${el.scrollHeight}px`;
    el.style.opacity = '1';
  };

  const onAfterEnter = (el) => {
    el.style.height = 'auto';
    el.style.overflow = 'visible';
  };

  const onBeforeLeave = (el) => {
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflow = 'hidden';
  };

  const onLeave = (el) => {
    el.style.transition = 'all 0.25s ease-in';
    el.style.height = '0';
    el.style.opacity = '0';
  };

  const handleWindowScroll = () => {
    showScrollTop.value = window.scrollY > 300;
  };

  const persistDraftOnPageHide = () => {
    saveDraftState();
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getTextClass = (value) => (value && parseFloat(value) > 0 ? 'text-black dark:text-white font-bold' : 'text-gray-400 dark:text-gray-500 font-normal');

  watch([sizeGridEnabled, sizeGridTotal, canUseSizeGrid], () => {
    if (sizeGridEnabled.value && canUseSizeGrid.value) {
      productQty.value = Math.max(1, sizeGridTotal.value);
    }
  });

  watch(productType, () => {
    if (!canUseSizeGrid.value) {
      sizeGridEnabled.value = false;
    }
    if (preserveBlankPriceOnNextProductTypeSync) {
      preserveBlankPriceOnNextProductTypeSync = false;
      return;
    }
    blankPrice.value = defaultBlankPrice.value;
  });

  watch(defaultBlankPrice, (nextValue, previousValue) => {
    const wasCustom = Math.abs((Number(blankPrice.value) || 0) - (Number(previousValue) || 0)) > 0.0001;
    if (!wasCustom) {
      blankPrice.value = nextValue;
    }
  });

  watch(PRODUCT_TYPES_OPTIONS, () => {
    const resolvedId = resolveProductTypeId(productType.value);
    if (resolvedId !== productType.value) {
      setResolvedProductType(resolvedId, { preserveBlankPrice: !findGarmentById(productType.value) });
    }
  }, { deep: true, immediate: true });

  watch(project, () => {
    project.value.markup = clamp(toNumber(project.value.markup, 0), 0, 50);
    project.value.discount = clamp(toNumber(project.value.discount, 0), 0, 50);
  }, { deep: true });

  watch(packagingDB, () => {
    packaging.value.forEach((item) => syncPackagingSelection(item, { preserveCustomPrice: true }));
  }, { deep: true });

  watch([
    layers,
    packaging,
    project,
    productQty,
    activeTab,
    productType,
    sizeGridEnabled,
    sizeGrid,
    blankPrice,
  ], () => {
    draftStatus.value = 'dirty';
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
    draftSaveTimeout = setTimeout(() => {
      saveDraftState();
    }, 250);
  }, { deep: true });

  onMounted(() => {
    const restoredFromHistory = Boolean(sessionStorage.getItem(DTF_HISTORY_LOAD_KEY));
    restoreFromHistoryPayload();
    if (!restoredFromHistory) restoreDraftState();
    handleWindowScroll();
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('pagehide', persistDraftOnPageHide);
    window.addEventListener('beforeunload', persistDraftOnPageHide);
  });

  onUnmounted(() => {
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
    if (saveFireworksTimer) clearTimeout(saveFireworksTimer);
    if (toastTimer) clearTimeout(toastTimer);
    saveDraftState();
    window.removeEventListener('scroll', handleWindowScroll);
    window.removeEventListener('pagehide', persistDraftOnPageHide);
    window.removeEventListener('beforeunload', persistDraftOnPageHide);
  });

  return {
    PRODUCT_TYPES: PRODUCT_TYPES_OPTIONS,
    SIZE_KEYS,
    PLACEMENT_PRESETS,
    TECH_OPTIONS,
    FLEX_COLOR_OPTIONS: flexMaterialOptions,
    FLEX_PRICE_TIERS: computed(() => flexColorMarkupTiers.value.map((item, index) => ({
      colors: item.colors,
      label: item.label,
      markupPercent: item.markupPercent,
      coeff: Number((1 + (Math.max(0, Number(item.markupPercent) || 0) / 100)).toFixed(2)),
      id: `flex-tier-${index + 1}`,
    }))),
    SUBLIMATION_FORMATS: sublimationFormatOptions,
    DTF_LAYER_PRESETS,
    currentUser,
    canViewHistory,
    canViewSettings,
    canUseCloud,
    statusConfig,
    activeTab,
    showSaveProjectModal,
    saveModalNotice,
    isManualSaving,
    showAuthModal,
    showResetConfirm,
    showSizeGridExitConfirm,
    showInvoice,
    showScrollTop,
    toast,
    saveFireworks,
    draftStatus,
    lastDraftSavedAt,
    project,
    productQty,
    productType,
    sizeGridEnabled,
    sizeGrid,
    blankPrice,
    defaultBlankPrice,
    isBlankPriceCustom,
    currentProductType,
    currentProductRiskMarkupPercent,
    canUseSizeGrid,
    sizeGridTotal,
    layers,
    packaging,
    packagingOptions,
    rollWidthMm,
    pricePerCm2,
    dtfSettingLabel,
    totalPrints,
    totalLinearM,
    dtfRollSummaryRows,
    materialTotal,
    packagingTotal,
    blankTotal,
    orderSubtotal,
    markupAmt,
    discountAmt,
    pricePerOne,
    totalForAll,
    isCostVisible,
    dtfTotals,
    invoicePayload,
    settings,
    materials,
    materialGroups,
    coatings,
    processingDB,
    accessories,
    design,
    materialConsumption,
    layerAreaCm2,
    layerCost,
    effectivePricePerCm2,
    layerValidationMessage,
    applyPlacementPreset,
    addLayer,
    removeLayer,
    duplicateLayer,
    addPackaging,
    removePackaging,
    onPkgSelect,
    openSaveProjectModal,
    handleManualSaveToHistory,
    openSettings,
    openHistory,
    changeMarkup,
    changeDiscount,
    changeProductQty,
    setBlankPrice,
    stepBlankPrice,
    resetBlankPriceToDefault,
    applyProductQtyToLayers,
    addLayerPreset,
    requestToggleSizeGrid,
    keepGridTotalAsProductQty,
    resetGridAndProductQty,
    cancelSizeGridExit,
    stepUp,
    stepDown,
    toggleCostVisibility,
    exportProjectJson,
    importProjectJson,
    openInvoiceModal,
    copyQuote,
    onInvoicePrint,
    requestReset,
    confirmReset,
    onBeforeEnter,
    onEnter,
    onAfterEnter,
    onBeforeLeave,
    onLeave,
    scrollToTop,
    getTextClass,
    showToast,
    runToastAction,
    validateProjectBeforeOutput,
  };
}