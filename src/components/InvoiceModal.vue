<script setup>
import { computed, ref, watch } from 'vue';
import { useDatabase } from '@/composables/useDatabase';
import { isCoatingAllowedForMaterial } from '@/utils/coatingCompatibility';
import { COATING_PRICING_MODE_DTF_LINEAR, getCoatingPricePerCm2 } from '@/utils/coatingPricing';

const INVOICE_PRINT_PREFS_KEY = 'monocalc_invoice_print_prefs_v1';

const props = defineProps({
    show: Boolean,
    project: Object,
    layers: Array,
    processing: Array,
    accessories: Array,
    packaging: Array,
    design: Array,
    totals: Object,
    productQty: { type: Number, default: 1 },
    settings: Object,
    materials: Array,
    coatings: Array
});

const safeProductQty = computed(() => {
    const n = Number(props.productQty);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
});
const toMoneyNum = (value) => {
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const hasNumericInput = (value) => {
    if (value === '' || value === null || value === undefined) return false;
    return Number.isFinite(toMoneyNum(value));
};
const usesValueField = (type) => type === 'fixed' || type === 'percent';
const normalizeSides = (value) => (Number(value) === 2 ? 2 : 1);

// Добавляем 'print' в список событий
const emit = defineEmits(['close', 'print']);

const currentDate = new Date().toLocaleDateString('ru-RU');
const invoiceNumber = ref(1932);
const managerName = ref('');
const stampEnabled = ref(true);
const stampImageDataUrl = ref('');
const stampOffsetX = ref(0);
const stampOffsetY = ref(0);
const stampScale = ref(1);
const signatureEnabled = ref(false);
const signatureImageDataUrl = ref('');
const signatureOffsetX = ref(0);
const signatureOffsetY = ref(0);
const signatureScale = ref(1);
const prefsExpanded = ref(false);
const stampControlsExpanded = ref(false);
const signatureControlsExpanded = ref(false);
const { userRole, hasPermission, processingDB, accessoriesDB, packagingDB, designDB } = useDatabase();
const canManageInvoiceAssets = computed(() => {
    const role = String(userRole.value || '').toLowerCase();
    if (role === 'superadmin') return true;
    return hasPermission('invoice.stamp.edit');
});

const loadPrintPrefs = () => {
    try {
        const raw = localStorage.getItem(INVOICE_PRINT_PREFS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        stampEnabled.value = true;
        stampImageDataUrl.value = typeof parsed.stampImageDataUrl === 'string' ? parsed.stampImageDataUrl : '';
        stampOffsetX.value = Number.isFinite(Number(parsed.stampOffsetX)) ? Number(parsed.stampOffsetX) : 0;
        stampOffsetY.value = Number.isFinite(Number(parsed.stampOffsetY)) ? Number(parsed.stampOffsetY) : 0;
        const scale = Number(parsed.stampScale);
        stampScale.value = Number.isFinite(scale) ? Math.max(0.3, Math.min(2.5, scale)) : 1;
        signatureEnabled.value = Boolean(parsed.signatureEnabled);
        signatureImageDataUrl.value = typeof parsed.signatureImageDataUrl === 'string' ? parsed.signatureImageDataUrl : '';
        signatureOffsetX.value = Number.isFinite(Number(parsed.signatureOffsetX)) ? Number(parsed.signatureOffsetX) : 0;
        signatureOffsetY.value = Number.isFinite(Number(parsed.signatureOffsetY)) ? Number(parsed.signatureOffsetY) : 0;
        const signatureScaleValue = Number(parsed.signatureScale);
        signatureScale.value = Number.isFinite(signatureScaleValue) ? Math.max(0.5, Math.min(2, signatureScaleValue)) : 1;
    } catch (e) {}
};

const savePrintPrefs = () => {
    try {
        localStorage.setItem(INVOICE_PRINT_PREFS_KEY, JSON.stringify({
            stampImageDataUrl: stampImageDataUrl.value || '',
            stampOffsetX: Number(stampOffsetX.value) || 0,
            stampOffsetY: Number(stampOffsetY.value) || 0,
            stampScale: Number(stampScale.value) || 1,
            signatureEnabled: Boolean(signatureEnabled.value),
            signatureImageDataUrl: signatureImageDataUrl.value || '',
            signatureOffsetX: Number(signatureOffsetX.value) || 0,
            signatureOffsetY: Number(signatureOffsetY.value) || 0,
            signatureScale: Number(signatureScale.value) || 1,
        }));
    } catch (e) {}
};

const readPngAsset = (event, onLoad) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!String(file.type || '').includes('png')) {
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        onLoad(typeof reader.result === 'string' ? reader.result : '');
        savePrintPrefs();
    };
    reader.readAsDataURL(file);
    event.target.value = '';
};

const handleStampUpload = (event) => {
    if (!canManageInvoiceAssets.value) return;
    readPngAsset(event, (value) => {
        stampImageDataUrl.value = value;
    });
};

const handleSignatureUpload = (event) => {
    if (!canManageInvoiceAssets.value) return;
    readPngAsset(event, (value) => {
        signatureImageDataUrl.value = value;
        signatureEnabled.value = true;
    });
};

const clearStamp = () => {
    stampImageDataUrl.value = '';
    savePrintPrefs();
};

const clearSignature = () => {
    signatureImageDataUrl.value = '';
    signatureEnabled.value = false;
    savePrintPrefs();
};

const showStampOnPrint = computed(() => stampEnabled.value && !!stampImageDataUrl.value);
const stampStyle = computed(() => ({
    transform: `translate(${Number(stampOffsetX.value) || 0}px, ${Number(stampOffsetY.value) || 0}px) scale(${Number(stampScale.value) || 1})`
}));
const showSignatureOnPrint = computed(() => signatureEnabled.value && !!signatureImageDataUrl.value);
const signatureStyle = computed(() => ({
    transform: `translate(${Number(signatureOffsetX.value) || 0}px, ${Number(signatureOffsetY.value) || 0}px) scale(${Number(signatureScale.value) || 1})`,
}));
const isDtfInvoice = computed(() => (
    props?.project?.invoiceMeta?.calculator === 'dtf'
    || (Array.isArray(props.layers) && props.layers.some((layer) => layer?.invoiceMeta?.calculator === 'dtf'))
));
const dtfGarmentMeta = computed(() => props?.project?.invoiceMeta?.garment || null);
const dtfGarmentSizeItems = computed(() => {
    const items = Array.isArray(dtfGarmentMeta.value?.sizeBreakdownItems)
        ? dtfGarmentMeta.value.sizeBreakdownItems
        : [];

    return items
        .map((item) => ({
            size: String(item?.key || '').trim(),
            qty: Math.max(0, Number(item?.qty) || 0),
        }))
        .filter((item) => item.size && item.qty > 0);
});

watch(() => props.show, (newVal) => {
    if (newVal) {
        const stored = localStorage.getItem('monocalc_invoice_counter');
        let nextNum = stored ? parseInt(stored) + 1 : 1932;
        invoiceNumber.value = nextNum;
        localStorage.setItem('monocalc_invoice_counter', nextNum);
        loadPrintPrefs();
        stampEnabled.value = true;
        managerName.value = '';
        prefsExpanded.value = false;
        stampControlsExpanded.value = false;
        signatureControlsExpanded.value = false;
    }
});

watch([stampEnabled, stampImageDataUrl, stampOffsetX, stampOffsetY, stampScale, signatureEnabled, signatureImageDataUrl, signatureOffsetX, signatureOffsetY, signatureScale], () => {
    savePrintPrefs();
});

const calculateLayerPrice = (layer) => {
    const explicitTotal = toMoneyNum(layer?.total ?? layer?.lineTotal);
    if (explicitTotal > 0) return explicitTotal;

    if (!props.materials || !props.settings) return 0;
    
    const m = props.materials.find(x => x.id === layer.matId) || props.materials[0];
    if (!layer.matId || !m) return 0;

    const toNum = (v, fallback = 0) => {
        const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const nonNeg = (n) => Math.max(0, n);
    const positive = (n) => (n > 0 ? n : 0);
    const qtySafe = (q) => {
        const n = toNum(q, 1);
        return Number.isFinite(n) && n > 0 ? n : 1;
    };

    const sheetW = positive(toNum(m.sheetW, 0));
    const sheetH = positive(toNum(m.sheetH, 0));
    const materialMarkup = nonNeg(toNum(m.markupPercent, 0));
    const sheetPrice = nonNeg(toNum(m.sheetPrice, 0)) * (1 + materialMarkup / 100);
    const sheetAreaCm2 = (sheetW / 10) * (sheetH / 10);
    const pricePerCm2 = sheetAreaCm2 > 0 ? (sheetPrice / sheetAreaCm2) : 0;
    const w = positive(toNum(layer.w, 0));
    const h = positive(toNum(layer.h, 0));
    const areaInput = positive(toNum(layer.area, 0));
    const currentArea = areaInput > 0 ? areaInput : (w > 0 && h > 0 ? (Math.round((w * h) / 100 * 10) / 10) : 0);
    const qty = qtySafe(layer.qty);
    const matCost = currentArea * pricePerCm2 * nonNeg(toNum(props.settings.wastage, 1));

    const speed = toNum(m.speed, 1) > 0 ? toNum(m.speed, 1) : 1;
    const cutLengthMm = nonNeg(toNum(layer.cut, 0));
    const cutCost = (cutLengthMm / speed / 60) * nonNeg(toNum(props.settings.laserMinuteCost, 0));

    const engravingPricePerCm2 = (() => {
        const directCm2 = toNum(props.settings.engravingPrice, NaN);
        if (Number.isFinite(directCm2)) return nonNeg(directCm2);
        const legacyBlock = nonNeg(toNum(props.settings.engravingCost100x100mm, 0));
        return legacyBlock / 100;
    })();
    const engravingAreaCm2ByDims = (positive(toNum(layer.engravingW_mm, 0)) * positive(toNum(layer.engravingH_mm, 0))) / 100;
    const engravingAreaCm2 = engravingAreaCm2ByDims > 0
        ? engravingAreaCm2ByDims
        : positive(toNum(layer.engravingArea, 0));
    const engrCost = layer.hasEngraving ? engravingAreaCm2 * engravingPricePerCm2 : 0;

    let finishCost = 0;
    if (layer.finishing !== 'none') {
        const coat = props.coatings.find(c => c.id === layer.finishing);
        if (coat && coat?.pricingModel !== COATING_PRICING_MODE_DTF_LINEAR && isCoatingAllowedForMaterial(coat, m)) {
            const finishingMultiplier = layer.finishingBothSides ? 2 : 1;
            const coatingPricePerCm2 = getCoatingPricePerCm2(coat);
            finishCost = currentArea * coatingPricePerCm2 * finishingMultiplier;
        }
    }

    return (matCost + cutCost + engrCost + finishCost) * qty;
};

const formatLaserLayerDescription = (layer) => {
    const descParts = [];
    const materialName = props.materials.find((item) => item?.id === layer?.matId)?.name;
    const finishingName = props.coatings.find((item) => item?.id === layer?.finishing)?.name;

    if (materialName) descParts.push(materialName);
    if (layer?.w && layer?.h) descParts.push(`${layer.w}x${layer.h} мм`);
    if (layer?.area) descParts.push(`${layer.area} см²`);
    if (Number(layer?.cut) > 0) descParts.push(`Рез: ${Math.round(Number(layer.cut))} мм`);
    if (finishingName && layer?.finishing !== 'none') {
        descParts.push(layer?.finishingBothSides ? `${finishingName}, 2 стороны` : finishingName);
    }
    if (layer?.hasEngraving) {
        const engravingW = Number(layer?.engravingW_mm) || 0;
        const engravingH = Number(layer?.engravingH_mm) || 0;
        if (engravingW > 0 && engravingH > 0) descParts.push(`Гравировка ${engravingW}x${engravingH} мм`);
        else descParts.push('Гравировка');
    }

    return descParts.join(' • ');
};

const allItems = computed(() => {
    if (isDtfInvoice.value) {
        const list = [];
        let idx = 1;
        const garment = dtfGarmentMeta.value;
        const garmentUnitPrice = Math.max(0, toMoneyNum(garment?.unitPrice));

        if (garment?.label) {
            if (dtfGarmentSizeItems.value.length) {
                dtfGarmentSizeItems.value.forEach((item) => {
                    list.push({
                        id: idx++,
                        name: `${garment.label} ${item.size}`,
                        desc: 'Текстильная заготовка',
                        category: 'Изделие',
                        qty: item.qty,
                        total: garmentUnitPrice * item.qty,
                    });
                });
            } else {
                list.push({
                    id: idx++,
                    name: garment.label,
                    desc: garment?.sizeBreakdown
                        ? `Размеры: ${garment.sizeBreakdown}`
                        : `Тираж заказа: ${safeProductQty.value} шт`,
                    category: 'Изделие',
                    qty: safeProductQty.value,
                    total: toMoneyNum(garment?.total),
                });
            }
        }

        (props.layers || []).forEach((layer) => {
            const total = calculateLayerPrice(layer);
            if (total <= 0) return;

            const meta = layer?.invoiceMeta || {};
            const descParts = [];
            if (meta?.techLabel) descParts.push(meta.techLabel);
            if (meta?.sublimationLabel) descParts.push(meta.sublimationLabel);
            else if (meta?.placementLabel) descParts.push(meta.placementLabel);
            if (meta?.flexMaterialLabel && layer?.tech === 'flex') descParts.push(meta.flexMaterialLabel);
            if (layer?.w && layer?.h && layer?.tech !== 'sublimation') descParts.push(`${layer.w}x${layer.h} мм`);
            if (meta?.qtyPerProduct) descParts.push(`${meta.qtyPerProduct} шт/изделие`);

            list.push({
                id: idx++,
                name: layer?.name || 'Нанесение',
                desc: descParts.join(' • '),
                category: 'Нанесение',
                qty: Math.max(1, Number(meta?.qtyPerProduct) || Number(layer?.qty) || 1) * safeProductQty.value,
                total,
            });
        });

        (props.packaging || []).forEach((item) => {
            const perProductQty = Math.max(1, Number(item?.qty) || 1);
            const price = Math.max(0, toMoneyNum(item?.price));
            let baseTotal = 0;

            if (price > 0) {
                if (item?.type === 'roll') {
                    baseTotal = price * ((Math.max(0, Number(item?.length) || 0) / 1000) * perProductQty);
                } else if (item?.type === 'box_mm') {
                    const width = Math.max(0, Number(item?.w) || 0);
                    const length = Math.max(0, Number(item?.l) || 0);
                    const height = Math.max(0, Number(item?.h) || 0);
                    const areaM2 = (2 * ((width * length) + (width * height) + (length * height))) / 1000000;
                    baseTotal = price * areaM2 * perProductQty;
                } else {
                    baseTotal = price * perProductQty;
                }
            }

            const total = baseTotal * safeProductQty.value;
            if (total <= 0) return;

            const width = Number(item?.w) || 0;
            const length = Number(item?.l) || 0;
            const height = Number(item?.h) || 0;
            const runLength = Number(item?.length) || 0;
            const rollWidth = Number(item?.rollWidthMm || item?.rollWidth) || 0;
            const desc = item?.type === 'box_mm'
                ? `Коробка ${width || 0}x${length || 0}x${height || 0} мм • ${perProductQty} шт/изделие`
                : item?.type === 'roll'
                    ? `Стрейч ${rollWidth || 0} мм, ${runLength || 0} мм • ${perProductQty} шт/изделие`
                    : `Упаковка • ${perProductQty} шт/изделие`;

            list.push({
                id: idx++,
                name: item?.name || 'Упаковка',
                desc,
                category: 'Упаковка',
                qty: perProductQty * safeProductQty.value,
                total,
            });
        });

        return list;
    }

    const list = [];
    let idx = 1;

    [...(props.layers || [])].reverse().forEach(l => {
        const calculatedTotal = calculateLayerPrice(l);
        if (calculatedTotal <= 0) return;

        list.push({
            id: idx++,
            name: l.name || 'Изделие из листового материала',
            desc: formatLaserLayerDescription(l),
            category: 'Деталь',
            qty: l.qty,
            total: calculatedTotal
        });
    });

    const baseForPercent = Number(props?.totals?.layers || 0);
    const resolveInvoiceItemFromDb = (item, section) => {
        const listBySection = {
            processing: processingDB?.value,
            accessories: accessoriesDB?.value,
            packaging: packagingDB?.value,
            design: designDB?.value,
        };
        const dbList = listBySection[section];
        if (!item?.dbId || !Array.isArray(dbList) || !dbList.length) return item;
        const dbItem = dbList.find((entry) => entry?.id === item.dbId);
        if (!dbItem) return item;

        const markup = Math.max(0, toMoneyNum(dbItem?.markupPercent));
        const applyMarkup = (value) => {
            const amount = toMoneyNum(value);
            return amount * (1 + markup / 100);
        };

        const nextType = dbItem?.type || item?.type || 'fixed';
        const shouldUseValue = usesValueField(nextType);
        const sourceValue = nextType === 'percent'
            ? (dbItem?.price ?? dbItem?.value ?? 0)
            : (dbItem?.value ?? dbItem?.price ?? 0);
        const sourcePrice = dbItem?.price ?? dbItem?.value ?? 0;

        return {
            ...item,
            name: dbItem?.name ?? item?.name,
            type: nextType,
            value: shouldUseValue
                ? (hasNumericInput(item?.value) ? toMoneyNum(item.value) : applyMarkup(sourceValue))
                : null,
            price: shouldUseValue
                ? null
                : (hasNumericInput(item?.price) ? toMoneyNum(item.price) : applyMarkup(sourcePrice)),
            rollWidthMm: toMoneyNum(dbItem?.rollWidthMm ?? dbItem?.rollWidth) || item?.rollWidthMm,
        };
    };

    const calcListItemTotal = (itemRaw, section) => {
        const item = resolveInvoiceItemFromDb(itemRaw, section);
        const toNum = (v, fallback = 0) => {
            const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
        const nonNeg = (n) => Math.max(0, n);
        const positive = (n) => (n > 0 ? n : 0);
        const qtySafe = (q) => {
            const n = toNum(q, 1);
            return Number.isFinite(n) && n > 0 ? n : 1;
        };

        const val = nonNeg(toNum(item?.value, 0));
        const percentValRaw = toNum(item?.value, NaN);
        const price = nonNeg(toNum(item?.price, 0));
        const qty = qtySafe(item?.qty);
        const w = positive(toNum(item?.w, 0));
        const l = positive(toNum(item?.l, 0));
        const h = positive(toNum(item?.h, 0));
        const length = nonNeg(toNum(item?.length, 0));

        if (item?.type === 'percent') {
            const percentVal = Number.isFinite(percentValRaw) ? Math.max(0, percentValRaw) : Math.max(0, price);
            return baseForPercent * (percentVal / 100);
        }
        if (item?.type === 'pieces') return price * qty;
        if (item?.type === 'fixed') return val * qty;
        if (item?.type === 'linear' || item?.type === 'roll') return price * (length / 1000) * qty;
        if (item?.type === 'linear_mm') return price * length * qty;
        if (item?.type === 'area') return price * ((w * h) / 1000000) * qty;
        if (item?.type === 'area_cm2') return price * ((w * h) / 100) * normalizeSides(item?.sides) * qty;
        if (item?.type === 'area_mm2') return price * (w * h) * qty;
        if (item?.type === 'box_mm') {
            const boxAreaMm2 = 2 * ((w * l) + (w * h) + (l * h));
            return price * (boxAreaMm2 / 1000000) * qty;
        }
        if (val > 0) return val * qty;
        if (price > 0) return price * qty;
        return 0;
    };

    [...(props.processing || [])].reverse().forEach(p => {
        let displayTotal = calcListItemTotal(p, 'processing');

        if (displayTotal > 0) {
            const width = Number(p?.w) || 0;
            const height = Number(p?.h) || 0;
            const sides = normalizeSides(p?.sides);
            list.push({
                id: idx++,
                name: p.name,
                desc: p.type === 'fixed'
                    ? 'Услуга'
                    : p.type === 'area_cm2'
                        ? `${width || 0}x${height || 0} мм • ${sides} ${sides === 2 ? 'стороны' : 'сторона'}`
                        : '',
                category: 'Услуга',
                qty: p.qty,
                total: displayTotal
            });
        }
    });

    [...(props.accessories || [])].reverse().forEach(a => {
        const total = calcListItemTotal(a, 'accessories');
        if (total > 0) {
            list.push({ id: idx++, name: a.name, desc: 'Фурнитура', category: 'Товар', qty: a.qty, total: total });
        }
    });

    [...(props.packaging || [])].reverse().forEach(p => {
        const total = calcListItemTotal(p, 'packaging');
        if (total > 0) {
            const width = Number(p?.w) || 0;
            const length = Number(p?.l) || 0;
            const height = Number(p?.h) || 0;
            const runLength = Number(p?.length) || 0;
            const rollWidth = Number(p?.rollWidthMm || p?.rollWidth) || 0;
            const desc = p?.type === 'box_mm'
                ? `Коробка ${width || 0}x${length || 0}x${height || 0} мм`
                : p?.type === 'roll'
                    ? `Стрейч ${rollWidth || 0} мм, ${runLength || 0} мм`
                    : 'Упаковка';
            list.push({ id: idx++, name: p.name, desc, category: 'Товар', qty: p.qty, total: total });
        }
    });

    [...(props.design || [])].reverse().forEach(d => {
        const total = calcListItemTotal(d, 'design');
        if (total > 0) {
            list.push({ id: idx++, name: d.name, desc: 'Разработка макета', category: 'Услуга', qty: d.qty || 1, total });
        }
    });

    return list;
});

const subTotalOne = computed(() => {
    return Math.round((allItems.value || []).reduce((sum, item) => sum + toMoneyNum(item?.total), 0));
});

const FIRST_PAGE_ROWS = 11;
const MIDDLE_PAGE_ROWS = 14;
const LAST_PAGE_ROWS = 10;

const invoicePages = computed(() => {
    const items = allItems.value || [];

    if (!items.length) {
        return [{ items: [], isFirst: true, isLast: true }];
    }

    const pages = [];
    let cursor = 0;

    const firstItems = items.slice(cursor, cursor + FIRST_PAGE_ROWS);
    const isSinglePage = items.length <= FIRST_PAGE_ROWS;
    pages.push({ items: firstItems, isFirst: true, isLast: isSinglePage });
    cursor += firstItems.length;

    if (isSinglePage) {
        return pages;
    }

    let remaining = items.length - cursor;
    while (remaining > MIDDLE_PAGE_ROWS + LAST_PAGE_ROWS) {
        const take = MIDDLE_PAGE_ROWS;
        const chunk = items.slice(cursor, cursor + take);
        pages.push({ items: chunk, isFirst: false, isLast: false });
        cursor += chunk.length;
        remaining = items.length - cursor;
    }

    if (remaining > LAST_PAGE_ROWS) {
        const minPenultimate = remaining - LAST_PAGE_ROWS;
        const maxPenultimate = Math.min(MIDDLE_PAGE_ROWS, remaining - 1);
        const penultimateCount = Math.max(minPenultimate, maxPenultimate);
        const chunk = items.slice(cursor, cursor + penultimateCount);
        pages.push({ items: chunk, isFirst: false, isLast: false });
        cursor += chunk.length;
    }

    pages.push({ items: items.slice(cursor), isFirst: false, isLast: true });
    return pages;
});

const projectMarkupPct = computed(() => {
    const n = toMoneyNum(props?.project?.markup);
    return Math.max(0, n);
});

const projectDiscountPct = computed(() => {
    const n = toMoneyNum(props?.project?.discount);
    return Math.min(100, Math.max(0, n));
});

const payloadPricePerOne = computed(() => {
    const value = toMoneyNum(props?.totals?.totalPerUnit);
    return value > 0 ? Math.round(value) : 0;
});

const payloadTotalForAll = computed(() => {
    const value = toMoneyNum(props?.totals?.totalOrder);
    return value > 0 ? Math.round(value) : 0;
});

const markupRubOne = computed(() => isDtfInvoice.value
    ? Math.round(toMoneyNum(props?.totals?.markupRub))
    : Math.round(subTotalOne.value * (projectMarkupPct.value / 100)));
const beforeDiscountOne = computed(() => subTotalOne.value + markupRubOne.value);
const discountRubOne = computed(() => isDtfInvoice.value
    ? Math.round(toMoneyNum(props?.totals?.discountRub))
    : Math.round(beforeDiscountOne.value * (projectDiscountPct.value / 100)));
const minimumOrderPriceOne = computed(() => Math.max(0, Math.round(toMoneyNum(props?.settings?.minimumOrderPrice))));
const calculatedPricePerOne = computed(() => Math.max(0, Math.round(beforeDiscountOne.value - discountRubOne.value)));
const pricePerOne = computed(() => payloadPricePerOne.value || Math.max(minimumOrderPriceOne.value, calculatedPricePerOne.value));
const totalForAll = computed(() => payloadTotalForAll.value || Math.round(pricePerOne.value * safeProductQty.value));
const formatMoney = (value) => new Intl.NumberFormat('ru-RU').format(Math.max(0, Number(value) || 0));

// ИЗМЕНЕНО: Сначала эмитим событие, потом печатаем
const printInvoice = () => {
    emit('print'); // Trigger auto-save in parent
    
    // Небольшая задержка, чтобы UI успел обновиться (если нужно),
    // хотя window.print блокирует поток, так что событие уйдет до открытия диалога
    setTimeout(() => {
        window.print();
    }, 100);
};
</script>

<template>
    <Teleport to="body">
        <div v-if="show" class="invoice-modal fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center overflow-y-auto p-4 md:p-8 text-[#18181B]" @click.self="$emit('close')">
            
            <div class="invoice-actions-track no-print">
                <div class="invoice-actions-rail">
                    <div class="invoice-actions">
                        <label class="invoice-manager-surface">
                            <span class="invoice-manager-surface-label">Менеджер</span>
                            <input v-model="managerName" type="text" placeholder="Кто печатает КП" class="invoice-pref-input invoice-pref-input--surface">
                        </label>
                        <div class="invoice-prefs-stack">
                            <button
                                type="button"
                                class="invoice-prefs-toggle"
                                :class="{ 'is-open': prefsExpanded }"
                                @click="prefsExpanded = !prefsExpanded"
                            >
                                <span>Параметры КП</span>
                                <svg class="invoice-prefs-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                        </div>
                        <button @click="printInvoice" class="invoice-action-btn invoice-action-btn--primary bg-white text-black px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg hover:bg-gray-100 transition-all flex items-center gap-2 active:scale-95">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                            Печать / Сохранить PDF
                        </button>
                        <button @click="$emit('close')" class="invoice-action-btn bg-white/10 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-white/20 transition-all active:scale-95 backdrop-blur-md">
                            Закрыть
                        </button>
                        <transition name="invoice-prefs-panel">
                            <div v-if="prefsExpanded" class="invoice-print-prefs">
                                <div class="invoice-prefs-header">
                                    <div>
                                        <div class="invoice-prefs-eyebrow">Настройки вывода</div>
                                        <div class="invoice-prefs-heading">Печать и подпись</div>
                                    </div>
                                </div>

                                <div class="invoice-prefs-section">
                                    <div class="invoice-prefs-section-head">
                                        <div class="invoice-prefs-section-title">Печать</div>
                                        <button
                                            v-if="canManageInvoiceAssets && stampImageDataUrl"
                                            type="button"
                                            class="invoice-section-toggle"
                                            @click="stampControlsExpanded = !stampControlsExpanded"
                                        >
                                            {{ stampControlsExpanded ? 'Свернуть' : 'Показать настройки' }}
                                        </button>
                                    </div>
                                    <div class="invoice-prefs-row invoice-prefs-row--inline">
                                        <label class="invoice-check">
                                            <input v-model="stampEnabled" type="checkbox" class="invoice-check-input">
                                            <span class="invoice-check-toggle" :class="{ 'is-on': stampEnabled }"><span class="invoice-check-knob"></span></span>
                                            <span>Добавить печать</span>
                                        </label>
                                        <div v-if="canManageInvoiceAssets" class="invoice-prefs-actions">
                                            <label class="invoice-upload-btn">
                                                <input type="file" accept="image/png" @change="handleStampUpload" class="hidden">
                                                <span>{{ stampImageDataUrl ? 'Заменить PNG' : 'Загрузить PNG' }}</span>
                                            </label>
                                            <button v-if="stampImageDataUrl" @click="clearStamp" class="invoice-clear-btn" type="button">Убрать</button>
                                        </div>
                                    </div>
                                    <div v-if="canManageInvoiceAssets && stampImageDataUrl && stampControlsExpanded" class="invoice-prefs-row invoice-prefs-sliders">
                                        <label>
                                            <span>Смещение X</span>
                                            <input v-model.number="stampOffsetX" type="range" min="-220" max="220" step="1" class="invoice-slider">
                                        </label>
                                        <label>
                                            <span>Смещение Y</span>
                                            <input v-model.number="stampOffsetY" type="range" min="-220" max="220" step="1" class="invoice-slider">
                                        </label>
                                        <label>
                                            <span>Размер</span>
                                            <input v-model.number="stampScale" type="range" min="0.3" max="2.5" step="0.01" class="invoice-slider">
                                        </label>
                                    </div>
                                </div>

                                <div class="invoice-prefs-section">
                                    <div class="invoice-prefs-section-head">
                                        <div class="invoice-prefs-section-title">Подпись</div>
                                        <button
                                            v-if="signatureImageDataUrl"
                                            type="button"
                                            class="invoice-section-toggle"
                                            @click="signatureControlsExpanded = !signatureControlsExpanded"
                                        >
                                            {{ signatureControlsExpanded ? 'Свернуть' : 'Показать настройки' }}
                                        </button>
                                    </div>
                                    <div class="invoice-prefs-row invoice-prefs-row--inline">
                                        <label class="invoice-check">
                                            <input v-model="signatureEnabled" type="checkbox" class="invoice-check-input">
                                            <span class="invoice-check-toggle" :class="{ 'is-on': signatureEnabled }"><span class="invoice-check-knob"></span></span>
                                            <span>Добавить подпись</span>
                                        </label>
                                        <div v-if="canManageInvoiceAssets" class="invoice-prefs-actions">
                                            <label class="invoice-upload-btn">
                                                <input type="file" accept="image/png" @change="handleSignatureUpload" class="hidden">
                                                <span>{{ signatureImageDataUrl ? 'Заменить PNG' : 'Загрузить PNG' }}</span>
                                            </label>
                                            <button v-if="signatureImageDataUrl" @click="clearSignature" class="invoice-clear-btn" type="button">Убрать</button>
                                        </div>
                                    </div>
                                    <div v-if="signatureImageDataUrl && signatureControlsExpanded" class="invoice-prefs-row invoice-prefs-sliders">
                                        <label>
                                            <span>Смещение X</span>
                                            <input v-model.number="signatureOffsetX" type="range" min="-220" max="220" step="1" class="invoice-slider">
                                        </label>
                                        <label>
                                            <span>Смещение Y</span>
                                            <input v-model.number="signatureOffsetY" type="range" min="-220" max="220" step="1" class="invoice-slider">
                                        </label>
                                        <label>
                                            <span>Размер подписи</span>
                                            <input v-model.number="signatureScale" type="range" min="0.5" max="2" step="0.01" class="invoice-slider">
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </transition>
                    </div>
                </div>
            </div>

            <div class="invoice-root w-full max-w-[210mm] flex flex-col relative min-h-full">

            <div
                v-for="(page, pageIndex) in invoicePages"
                :key="`invoice-page-${pageIndex + 1}`"
                class="invoice-sheet invoice-sheet--items animate-slide-up"
                :class="{ 'invoice-sheet--continued': !page.isFirst, 'invoice-sheet--last': page.isLast }"
            >
                <template v-if="page.isFirst">
                    <div class="invoice-header border-b border-gray-100 flex justify-between items-start">
                        <div><h1 class="text-3xl font-black tracking-tight text-black mb-2">Печатный двор</h1></div>
                        <div class="text-right"><div class="text-2xl font-bold text-black mb-1">КП № {{ invoiceNumber }}</div><div class="text-sm text-gray-500 font-medium">от {{ currentDate }}</div><div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">Стр. {{ pageIndex + 1 }} / {{ invoicePages.length }}</div></div>
                    </div>
                    <div class="invoice-parties flex justify-between gap-12">
                        <div class="flex-1"><div v-if="project.client || project.name"><h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Заказчик</h3><div v-if="project.client" class="text-lg font-bold text-black mb-1">{{ project.client }}</div><div v-if="project.name" class="text-sm text-gray-500">{{ project.name }}</div></div></div>
                        <div class="text-right flex-1"><h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Исполнитель</h3><div class="text-sm font-bold text-black">"Печатный двор"</div><div class="text-sm text-gray-500 mt-1">г. Биробиджан, ул. Советская 60А</div><div class="text-sm text-gray-500 font-medium mt-1">+7 (924) 742-07-76</div></div>
                    </div>
                </template>

                <div class="invoice-table-wrap" :class="{ 'invoice-table-wrap--continued': !page.isFirst }">
                    <div v-if="!page.isFirst" class="invoice-continuation-label">Стр. {{ pageIndex + 1 }} / {{ invoicePages.length }}</div>
                    <table class="w-full text-left border-collapse">
                        <thead><tr class="border-b-2 border-black"><th class="py-3 text-[10px] font-black uppercase tracking-wider text-black w-10">#</th><th class="py-3 text-[10px] font-black uppercase tracking-wider text-black">Наименование</th><th class="py-3 text-[10px] font-black uppercase tracking-wider text-black w-24">Тип</th><th class="py-3 text-[10px] font-black uppercase tracking-wider text-black text-center w-16">Кол-во</th><th class="py-3 text-[10px] font-black uppercase tracking-wider text-black text-right w-28">Сумма</th></tr></thead>
                        <tbody class="text-sm text-gray-700">
                            <tr v-for="item in page.items" :key="item.id" class="border-b border-gray-100 last:border-0"><td class="py-3 text-gray-400 font-medium text-xs">{{ item.id }}</td><td class="py-3 font-bold text-black">{{ item.name }}<div class="text-xs text-gray-400 font-normal mt-0.5">{{ item.desc }}</div></td><td class="py-3 text-xs font-medium text-gray-500">{{ item.category }}</td><td class="py-3 text-center font-bold text-black">{{ item.qty }}</td><td class="py-3 text-right font-bold tabular-nums text-black">{{ (Math.round(item.total ?? 0)).toLocaleString() }} ₽</td></tr>
                        </tbody>
                    </table>
                </div>

                <div v-if="page.isLast" class="invoice-summary">
                    <div class="flex justify-end mb-6">
                        <div class="w-64 space-y-3 invoice-total-block">
                            <div v-if="markupRubOne > 0" class="flex justify-between text-sm text-gray-600">
                                <span>Наценка ({{ project.markup }}%):</span>
                                <span class="font-bold">+{{ (markupRubOne ?? 0).toLocaleString() }} ₽</span>
                            </div>
                            <div v-if="discountRubOne > 0" class="flex justify-between text-sm text-gray-600">
                                <span>Скидка ({{ project.discount }}%):</span>
                                <span class="font-bold">-{{ (discountRubOne ?? 0).toLocaleString() }} ₽</span>
                            </div>
                            <div class="flex justify-between items-center pt-2">
                                <span class="text-xs font-bold text-gray-500">Количество изделий:</span>
                                <span class="font-bold">{{ safeProductQty }} шт</span>
                            </div>
                            <div class="flex justify-between items-center pt-2">
                                <span class="text-xs font-bold text-gray-500">Цена за 1 шт.:</span>
                                <span class="invoice-money-line"><span class="invoice-money-number">{{ formatMoney(pricePerOne) }}</span><span class="invoice-money-currency">₽</span></span>
                            </div>
                            <div class="flex justify-between items-end pt-4 border-t border-gray-200 gap-4">
                                <span class="text-base font-black uppercase tracking-widest text-black">Итого:</span>
                                <span class="invoice-total-line"><span class="invoice-total-number">{{ formatMoney(totalForAll) }}</span><span class="invoice-total-currency">₽</span></span>
                            </div>
                            <img v-if="showStampOnPrint" :src="stampImageDataUrl" alt="Печать" class="invoice-stamp" :style="stampStyle">
                        </div>
                    </div>
                    <div class="invoice-footer flex justify-between items-end pt-8 border-t border-gray-200"><div class="text-[10px] text-gray-400 max-w-xs leading-relaxed">Предложение действительно в течение 3 рабочих дней.<br>Не является публичной офертой.</div><div class="text-center"><div class="invoice-signature-slot"><img v-if="showSignatureOnPrint" :src="signatureImageDataUrl" alt="Подпись" class="invoice-signature" :style="signatureStyle"></div><div class="text-[18px] font-black text-black leading-none min-h-[22px] mb-2">{{ managerName || ' ' }}</div><div class="w-44 h-px bg-gray-400"></div><div class="text-[11px] font-bold uppercase tracking-widest text-gray-400 mt-2">Менеджер</div></div></div>
                </div>
            </div>
            
            <div class="h-12 shrink-0 no-print"></div>
            </div>
        </div>
    </Teleport>
</template>

<style>
/* СТИЛИ ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ */
.animate-slide-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

.invoice-money-line {
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.28rem;
    white-space: nowrap;
    text-align: right;
    font-weight: 800;
    line-height: 1;
}

.invoice-total-line {
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.35rem;
    white-space: nowrap;
    text-align: right;
    font-weight: 800;
    color: #000;
    line-height: 1;
    font-size: 2.45rem;
    letter-spacing: -0.02em;
}

.invoice-money-number,
.invoice-total-number {
    font-variant-numeric: tabular-nums;
}

.invoice-money-currency {
    font-size: 0.98em;
}

.invoice-total-currency {
    font-size: 0.94em;
}

.invoice-root {
    gap: 12mm;
}

.invoice-actions-track {
    position: sticky;
    top: 12px;
    z-index: 120;
    width: 100%;
    margin-bottom: 1rem;
}

.invoice-actions-rail {
    width: 100%;
    max-width: 210mm;
    margin: 0 auto;
    display: flex;
    justify-content: center;
    box-sizing: border-box;
    padding-right: 0;
    pointer-events: none;
}

.invoice-actions {
    position: relative;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.75rem;
    padding: 0.45rem;
    border-radius: 0.9rem;
    background: rgba(24, 24, 27, 0.58);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(10px);
    width: fit-content;
    max-width: calc(100vw - 2rem);
}

.invoice-manager-surface {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex: 0 0 auto;
    min-width: 0;
    padding: 0.3rem 0.35rem 0.3rem 0.7rem;
    border-radius: 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.09);
    overflow: hidden;
}

.invoice-manager-surface-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.86);
    white-space: nowrap;
}

.invoice-prefs-stack {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    flex: 0 0 auto;
}

.invoice-prefs-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    height: 42px;
    padding: 0 0.95rem;
    border-radius: 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.invoice-action-btn {
    white-space: nowrap;
    flex-shrink: 0;
}

.invoice-action-btn--primary {
    line-height: 1;
}

.invoice-prefs-toggle:hover {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.24);
}

.invoice-prefs-toggle.is-open {
    background: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.3);
}

.invoice-prefs-toggle-icon {
    transition: transform 0.22s ease;
}

.invoice-prefs-toggle.is-open .invoice-prefs-toggle-icon {
    transform: rotate(180deg);
}

.invoice-print-prefs {
    position: absolute;
    top: calc(100% + 0.65rem);
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: min(calc(100vw - 2rem), 520px);
    color: #fff;
    padding: 1rem;
    border-radius: 1.1rem;
    background: rgba(17, 17, 19, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(14px);
}

.invoice-prefs-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.1rem 0.1rem 0.2rem;
}

.invoice-prefs-eyebrow {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.42);
}

.invoice-prefs-heading {
    margin-top: 0.18rem;
    font-size: 18px;
    line-height: 1.1;
    font-weight: 900;
    color: #fff;
}

.invoice-prefs-section {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.95rem;
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.invoice-prefs-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.invoice-prefs-section-title {
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.5);
}

.invoice-section-toggle {
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.82);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
}

.invoice-prefs-panel-enter-active,
.invoice-prefs-panel-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
    transform-origin: top center;
}

.invoice-prefs-panel-enter-from,
.invoice-prefs-panel-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px) scale(0.98);
}

.invoice-prefs-panel-enter-to,
.invoice-prefs-panel-leave-from {
    transform: translateX(-50%) translateY(0) scale(1);
}

.invoice-prefs-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
}

.invoice-prefs-row--inline {
    justify-content: space-between;
    gap: 0.85rem;
    flex-wrap: wrap;
}

.invoice-pref-input {
    flex: 1;
    min-width: 260px;
    height: 40px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    padding: 0 12px;
    text-transform: none;
    letter-spacing: normal;
    outline: none;
}

.invoice-pref-input::placeholder {
    color: rgba(255, 255, 255, 0.58);
}

.invoice-pref-input--surface {
    min-width: 160px;
    width: 200px;
    height: 36px;
    color: rgba(255, 255, 255, 0.96);
    background: rgba(255, 255, 255, 0.14);
}

.invoice-check {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}

.invoice-check-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
}

.invoice-check-toggle {
    width: 2.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.12);
    padding: 2px;
    display: inline-flex;
    align-items: center;
    transition: border-color 0.2s ease, background-color 0.2s ease;
}

.invoice-check-knob {
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 9999px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.32);
    transform: translateX(0);
    transition: transform 0.2s ease, background-color 0.2s ease;
}

.invoice-check-toggle.is-on {
    background: #ffffff;
    border-color: #ffffff;
}

.invoice-check-toggle.is-on .invoice-check-knob {
    background: #111827;
    transform: translateX(0.98rem);
}

.invoice-upload-btn,
.invoice-clear-btn {
    height: 34px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 0 12px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #fff;
    background: rgba(255, 255, 255, 0.14);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.invoice-prefs-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
}

.invoice-prefs-sliders {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.7rem;
    padding-top: 0.15rem;
}

.invoice-prefs-sliders label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.88);
}

.invoice-prefs-sliders input[type="range"] {
    flex: 1;
}

.invoice-slider {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.62) 100%);
    outline: none;
}

.invoice-slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.58) 100%);
}

.invoice-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 15px;
    height: 15px;
    border-radius: 999px;
    background: #ffffff;
    border: 2px solid #111111;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
    margin-top: -6px;
}

.invoice-slider::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.58) 100%);
}

.invoice-slider::-moz-range-thumb {
    width: 15px;
    height: 15px;
    border-radius: 999px;
    background: #ffffff;
    border: 2px solid #111111;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
}

.invoice-signature-slot {
    height: 48px;
    margin-bottom: 0.35rem;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}

.invoice-signature {
    max-width: 150px;
    max-height: 46px;
    object-fit: contain;
    transform-origin: 50% 100%;
}

@media (max-width: 900px) {
    .invoice-actions {
        width: 100%;
        justify-content: flex-end;
        flex-wrap: wrap;
    }

    .invoice-manager-surface {
        width: 100%;
    }

    .invoice-prefs-stack {
        width: 100%;
    }

    .invoice-prefs-toggle {
        width: 100%;
        justify-content: space-between;
    }

    .invoice-action-btn {
        width: 100%;
        justify-content: center;
    }

    .invoice-print-prefs {
        position: static;
        left: auto;
        right: auto;
        transform: none;
        width: 100%;
        margin-top: 0.65rem;
    }

    .invoice-prefs-row {
        flex-direction: column;
        align-items: stretch;
    }

    .invoice-prefs-row--inline {
        align-items: stretch;
    }

    .invoice-pref-input {
        min-width: 0;
        width: 100%;
    }

    .invoice-pref-input--surface {
        width: 100%;
    }

    .invoice-prefs-actions {
        width: 100%;
        margin-left: 0;
    }
}

.invoice-sheet {
    width: 100%;
    max-width: 210mm;
    min-height: 297mm;
    background: #fff;
    opacity: 1;
    color: #111827;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.3);
    position: relative;
    display: flex;
    flex-direction: column;
    isolation: isolate;
}

.invoice-header {
    padding: 15mm 14mm 9mm;
}

.invoice-parties {
    padding: 9mm 14mm 7mm;
}

.invoice-table-wrap {
    padding: 0 14mm 14mm;
    flex: 1 1 auto;
}

.invoice-table-wrap--continued {
    padding-top: 10mm;
}

.invoice-continuation-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #9ca3af;
    font-weight: 700;
    margin-bottom: 4mm;
}

.invoice-summary {
    padding: 14mm;
    margin-top: auto;
}

.invoice-total-block {
    position: relative;
}

.invoice-stamp {
    position: absolute;
    right: 10px;
    bottom: -6px;
    width: 140px;
    max-width: 180px;
    opacity: 0.95;
    transform-origin: 100% 100%;
    pointer-events: none;
}

@media print {
    :root {
        color-scheme: light;
    }

    html, body {
        width: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
    }

    .invoice-modal,
    .invoice-modal * {
        visibility: visible !important;
    }

    body > :not(.invoice-modal) {
        display: none !important;
    }

    .invoice-modal {
        position: static !important;
        inset: auto !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        width: 100% !important;
        height: auto !important;
        max-height: none !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .invoice-root {
        width: 100% !important;
        max-width: 210mm !important;
        min-height: auto !important;
        height: auto !important;
        margin: 0 auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 0 !important;
    }

    .invoice-sheet {
        box-shadow: none !important;
        background: #fff !important;
        width: 210mm !important;
        max-width: 210mm !important;
        height: auto !important;
        min-height: 297mm !important;
        margin: 0 !important;
        position: static !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: visible !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
    }

    .invoice-sheet {
        break-after: page !important;
        page-break-after: always !important;
    }

    .invoice-sheet:last-of-type {
        break-after: auto !important;
        page-break-after: auto !important;
    }

    .invoice-table-wrap {
        flex: 1 1 auto !important;
        overflow: visible !important;
    }

    .invoice-summary {
        background: #fff !important;
        margin-top: auto !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
    }

    .invoice-footer {
        margin-top: auto !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
    }

    .invoice-table-wrap table {
        width: 100% !important;
        border-collapse: collapse !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
    }

    .invoice-table-wrap thead {
        display: table-header-group;
    }

    .invoice-table-wrap tr {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .no-print {
        display: none !important;
    }

    @page {
        size: A4;
        margin: 0;
    }
}
</style>