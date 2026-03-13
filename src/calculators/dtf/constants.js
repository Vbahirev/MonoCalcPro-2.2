export const PRODUCT_TYPES = [
  { id: 'tshirt', label: 'Футболка' },
  { id: 'hoodie', label: 'Худи' },
  { id: 'sweatshirt', label: 'Свитшот' },
  { id: 'longsleeve', label: 'Лонгслив' },
  { id: 'shorts', label: 'Шорты' },
  { id: 'cap', label: 'Кепка' },
  { id: 'bag', label: 'Сумка' },
  { id: 'flag', label: 'Флаг' },
  { id: 'pillow', label: 'Подушка' },
  { id: 'client_garment', label: 'Изделие клиента' },
  { id: 'custom', label: 'Другое' },
];

export const CLIENT_GARMENT_ID = 'client_garment';

const toSafeMoney = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const toSafeMarkup = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const toSafeSize = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ensureUniqueGarmentId = (candidate, seen, index) => {
  const base = String(candidate || '').trim() || `dtf_garment_${index + 1}`;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  let suffix = 2;
  let nextId = `${base}_${suffix}`;
  while (seen.has(nextId)) {
    suffix += 1;
    nextId = `${base}_${suffix}`;
  }
  seen.add(nextId);
  return nextId;
};

export const getDtfGarmentFinalPrice = (item) => {
  if (item?.clientOwned === true || item?.id === CLIENT_GARMENT_ID) {
    return 0;
  }

  const purchasePrice = toSafeMoney(item?.purchasePrice ?? item?.price);
  const markupPercent = toSafeMarkup(item?.markupPercent);
  return purchasePrice * (1 + markupPercent / 100);
};

export const isDtfClientOwnedGarment = (item) => item?.clientOwned === true || item?.id === CLIENT_GARMENT_ID;

export const buildDefaultDtfGarments = (legacyPriceMap = {}) => (
  PRODUCT_TYPES.map((item) => ({
    id: item.id,
    name: item.label,
    active: true,
    clientOwned: item.id === CLIENT_GARMENT_ID,
    purchasePrice: item.id === CLIENT_GARMENT_ID ? 0 : toSafeMoney(legacyPriceMap?.[item.id]),
    markupPercent: 0,
  }))
);

export const normalizeDtfGarments = (items, legacyPriceMap = {}) => {
  if (!Array.isArray(items) || !items.length) {
    return buildDefaultDtfGarments(legacyPriceMap);
  }

  const knownLabels = new Map(PRODUCT_TYPES.map((item) => [item.id, item.label]));
  const seenIds = new Set();

  const normalizedItems = items.map((item, index) => {
    const rawId = String(item?.id || '').trim() || PRODUCT_TYPES[index]?.id || `dtf_garment_${index + 1}`;
    const id = ensureUniqueGarmentId(rawId, seenIds, index);
    const fallbackName = knownLabels.get(rawId) || knownLabels.get(id) || `Изделие ${index + 1}`;
    const name = String(item?.name || item?.label || '').trim() || fallbackName;
    const clientOwned = item?.clientOwned === true || rawId === CLIENT_GARMENT_ID || id === CLIENT_GARMENT_ID;

    return {
      id,
      name,
      active: item?.active !== false,
      clientOwned,
      purchasePrice: clientOwned ? 0 : toSafeMoney(item?.purchasePrice ?? item?.price ?? legacyPriceMap?.[rawId]),
      markupPercent: toSafeMarkup(item?.markupPercent),
    };
  });

  if (!normalizedItems.some((item) => item.id === CLIENT_GARMENT_ID)) {
    normalizedItems.push({
      id: CLIENT_GARMENT_ID,
      name: 'Изделие клиента',
      active: true,
      clientOwned: true,
      purchasePrice: 0,
      markupPercent: 0,
    });
  }

  return normalizedItems;
};

export const buildLegacyDtfGarmentPriceMap = (items) => {
  const normalized = normalizeDtfGarments(items);
  return normalized.reduce((acc, item) => {
    acc[item.id] = getDtfGarmentFinalPrice(item);
    return acc;
  }, {});
};

export const SIZE_KEYS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];

export const PLACEMENT_PRESETS = [
  { id: 'a3', label: 'A3', w: 297, h: 420 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a6', label: 'A6', w: 105, h: 148 },
  { id: 'logo_10', label: 'Логотип', w: 100, h: 100 },
];

export const TECH_OPTIONS = [
  { id: 'dtf', label: 'ДТФ' },
  { id: 'flex', label: 'Флекс' },
  { id: 'sublimation', label: 'Сублимация' },
];

export const FLEX_COLOR_OPTIONS = [
  { id: 'standard', label: 'Стандарт', coeff: 1.0 },
  { id: 'metallic', label: 'Металлик', coeff: 1.35 },
  { id: 'foil', label: 'Фольга', coeff: 1.6 },
  { id: 'glitter', label: 'Глиттер', coeff: 1.45 },
  { id: 'fluo', label: 'Флуоресцент', coeff: 1.25 },
  { id: 'reflective', label: 'Световозвращающий', coeff: 1.8 },
];

export const FLEX_PRICE_TIERS = [
  { colors: 1, label: '1 цвет', coeff: 1.0 },
  { colors: 2, label: '2 цвета', coeff: 1.45 },
  { colors: 3, label: '3 цвета', coeff: 1.85 },
  { colors: 4, label: '4 цвета', coeff: 2.2 },
  { colors: 5, label: '5 цветов', coeff: 2.5 },
  { colors: 6, label: '6+ цветов', coeff: 2.75 },
];

export const buildDefaultDtfFlexColorMarkups = () => (
  FLEX_PRICE_TIERS.map((item) => ({
    colors: item.colors,
    label: item.label,
    markupPercent: Math.max(0, Math.round((item.coeff - 1) * 100)),
  }))
);

export const normalizeDtfFlexColorMarkups = (items) => {
  const defaults = buildDefaultDtfFlexColorMarkups();
  if (!Array.isArray(items) || !items.length) return defaults;

  return defaults.map((fallback) => {
    const matched = items.find((item) => Number(item?.colors) === fallback.colors) || {};
    const label = String(matched?.label || '').trim() || fallback.label;
    return {
      colors: fallback.colors,
      label,
      markupPercent: toSafeMarkup(matched?.markupPercent),
    };
  });
};

export const SUBLIMATION_FORMATS = [
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a3', label: 'A3', w: 297, h: 420 },
];

export const buildDefaultDtfFlexMaterials = () => (
  FLEX_COLOR_OPTIONS.map((item) => ({
    id: item.id,
    name: item.label,
    active: true,
    inStock: true,
    markupPercent: 0,
    linearMeterPrice: 0,
    rollWidthMm: 500,
  }))
);

export const normalizeDtfFlexMaterials = (items) => {
  if (!Array.isArray(items) || !items.length) {
    return buildDefaultDtfFlexMaterials();
  }

  const knownLabels = new Map(FLEX_COLOR_OPTIONS.map((item) => [item.id, item.label]));
  const seenIds = new Set();

  return items.map((item, index) => {
    const rawId = String(item?.id || '').trim() || FLEX_COLOR_OPTIONS[index]?.id || `dtf_flex_${index + 1}`;
    const id = ensureUniqueGarmentId(rawId, seenIds, index);
    const fallbackName = knownLabels.get(rawId) || knownLabels.get(id) || `Флекс ${index + 1}`;

    return {
      id,
      name: String(item?.name || item?.label || '').trim() || fallbackName,
      active: item?.active !== false,
      inStock: item?.inStock !== false,
      markupPercent: toSafeMarkup(item?.markupPercent),
      linearMeterPrice: toSafeMoney(item?.linearMeterPrice ?? item?.price),
      rollWidthMm: toSafeSize(item?.rollWidthMm ?? item?.rollWidth, 500),
    };
  });
};

export const getDtfFlexPricePerCm2 = (item, options = {}) => {
  const { includeMarkup = true } = options;
  const rollWidthMm = toSafeSize(item?.rollWidthMm ?? item?.rollWidth, 500);
  const linearMeterPrice = toSafeMoney(item?.linearMeterPrice ?? item?.price);
  const basePrice = linearMeterPrice / ((rollWidthMm / 10) * 100);
  if (!includeMarkup) return basePrice;
  return basePrice * (1 + toSafeMarkup(item?.markupPercent) / 100);
};

export const buildDefaultDtfSublimationFormats = () => (
  SUBLIMATION_FORMATS.map((item) => ({
    id: item.id,
    name: item.label,
    active: true,
    markupPercent: 0,
    widthMm: item.w,
    heightMm: item.h,
    price: 0,
  }))
);

export const normalizeDtfSublimationFormats = (items) => {
  if (!Array.isArray(items) || !items.length) {
    return buildDefaultDtfSublimationFormats();
  }

  const knownLabels = new Map(SUBLIMATION_FORMATS.map((item) => [item.id, item.label]));
  const seenIds = new Set();

  return items.map((item, index) => {
    const rawId = String(item?.id || '').trim() || SUBLIMATION_FORMATS[index]?.id || `dtf_sublimation_${index + 1}`;
    const id = ensureUniqueGarmentId(rawId, seenIds, index);
    const fallbackName = knownLabels.get(rawId) || knownLabels.get(id) || `Формат ${index + 1}`;

    return {
      id,
      name: String(item?.name || item?.label || '').trim() || fallbackName,
      active: item?.active !== false,
      markupPercent: toSafeMarkup(item?.markupPercent),
      widthMm: toSafeSize(item?.widthMm ?? item?.w, 210),
      heightMm: toSafeSize(item?.heightMm ?? item?.h, 297),
      price: toSafeMoney(item?.price),
    };
  });
};

export const getDtfSublimationFormatFinalPrice = (item) => {
  const price = toSafeMoney(item?.price);
  return price * (1 + toSafeMarkup(item?.markupPercent) / 100);
};

export const DTF_ACTIVE_TABS = ['garment', 'layers', 'packaging'];
export const DTF_INVALID_PRODUCTS_FOR_GRID = ['cap', 'bag', 'flag', 'pillow', 'custom'];

export const DTF_LAYER_PRESETS = [
  {
    id: 'logo',
    label: 'Логотип',
    description: 'Небольшой принт или шеврон',
    layers: [{ name: 'Логотип', placement: 'logo_10' }],
  },
  {
    id: 'chest',
    label: 'Грудь',
    description: 'Один принт спереди без фиксации формата',
    layers: [{ name: 'Грудь' }],
  },
  {
    id: 'back',
    label: 'Спина',
    description: 'Один принт на спине без фиксации формата',
    layers: [{ name: 'Спина' }],
  },
  {
    id: 'left_sleeve',
    label: 'Левый рукав',
    description: 'Принт на левом рукаве без фиксации формата',
    layers: [{ name: 'Левый рукав' }],
  },
  {
    id: 'right_sleeve',
    label: 'Правый рукав',
    description: 'Принт на правом рукаве без фиксации формата',
    layers: [{ name: 'Правый рукав' }],
  },
  {
    id: 'chest_back',
    label: 'Грудь + спина',
    description: 'Два базовых принта без фиксации форматов',
    layers: [
      { name: 'Грудь' },
      { name: 'Спина' },
    ],
  },
  {
    id: 'sleeves_pair',
    label: 'Два рукава',
    description: 'Парные принты на рукавах без фиксации формата',
    layers: [
      { name: 'Левый рукав' },
      { name: 'Правый рукав' },
    ],
  },
];