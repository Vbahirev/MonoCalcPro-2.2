export function buildInvoicePayload({
  calculatorId = 'laser',
  project,
  productQty,
  layers,
  processing,
  accessories,
  packaging,
  design,
  totals,
  settings,
  materials,
  coatings,
  dtf,
}) {
  const safeProductQty = Math.max(1, Number(productQty) || 1);

  if (calculatorId === 'dtf') {
    const pricePerCm2 = Math.max(0, Number(dtf?.pricePerCm2) || 0);
    const label = dtf?.label || 'Нанесение на текстиль';
    const sourceLayers = Array.isArray(layers) ? layers : [];
    const sourcePackaging = Array.isArray(packaging) ? packaging : [];
    const getLayerCost = typeof dtf?.getLayerCost === 'function'
      ? dtf.getLayerCost
      : (layer) => {
          const width = Math.max(0, Number(layer?.w) || 0);
          const height = Math.max(0, Number(layer?.h) || 0);
          const qty = Math.max(1, Number(layer?.qty) || 1);
          return ((width * height) / 100) * pricePerCm2 * qty;
        };
    const getEffectivePricePerCm2 = typeof dtf?.getEffectivePricePerCm2 === 'function'
      ? dtf.getEffectivePricePerCm2
      : () => pricePerCm2;
    const totalLayers = sourceLayers.reduce((sum, layer) => {
      return sum + Math.max(0, Number(getLayerCost(layer)) || 0);
    }, 0);
    const totalOrder = Math.max(0, Math.round(Number(totals?.totalOrder ?? totals?.total) || 0));
    const totalPerUnit = Math.max(0, Math.round(Number(totals?.totalPerUnit) || (safeProductQty > 0 ? totalOrder / safeProductQty : 0)));
    const garment = dtf?.garment && typeof dtf.garment === 'object' ? { ...dtf.garment } : null;

    return {
      project: {
        ...(project || {}),
        invoiceMeta: {
          calculator: 'dtf',
          garment,
        },
      },
      productQty: safeProductQty,
      layers: sourceLayers.map((layer, index) => ({
        id: `dtf-layer-${layer?.id ?? index}-${index}`,
        name: layer?.name || (sourceLayers.length > 1 ? `Деталь ${index + 1}` : label),
        qty: Math.max(1, Number(layer?.qty) || 1),
        w: Math.max(0, Number(layer?.w) || 0),
        h: Math.max(0, Number(layer?.h) || 0),
        area: Math.max(0, Number(layer?.area) || 0),
        total: Math.max(0, Number(getLayerCost(layer)) || 0) * safeProductQty,
        unitPrice: Math.max(0, Number(getEffectivePricePerCm2(layer)) || 0),
        invoiceMeta: {
          calculator: 'dtf',
          label,
          tech: layer?.tech || '',
          ...(typeof dtf?.getLayerMeta === 'function' ? dtf.getLayerMeta(layer) : {}),
        },
      })),
      processing: [],
      accessories: [],
      packaging: sourcePackaging.map((item) => ({ ...item })),
      design: [],
      totals: {
        ...(totals || {}),
        qty: safeProductQty,
        totalPerUnit,
        totalOrder,
        total: totalOrder,
        layers: Number(totals?.layers ?? totalLayers),
        costLayers: Number(totals?.costLayers ?? totals?.layers ?? totalLayers),
        processing: 0,
        accessories: 0,
        design: 0,
      },
      settings: {
        minimumOrderPrice: 0,
        wastage: 1,
        laserMinuteCost: 0,
        engravingPrice: 0,
        engravingCost100x100mm: 0,
        ...(settings || {}),
      },
      materials: [],
      coatings: [],
    };
  }

  const totalPerUnit = Math.max(0, Math.round(Number(totals?.totalPerUnit ?? totals?.total) || 0));
  const totalOrder = Math.max(0, Math.round(Number(totals?.totalOrder) || (totalPerUnit * safeProductQty)));

  return {
    project,
    productQty: safeProductQty,
    layers: Array.isArray(layers) ? layers : [],
    processing: Array.isArray(processing) ? processing : [],
    accessories: Array.isArray(accessories) ? accessories : [],
    packaging: Array.isArray(packaging) ? packaging : [],
    design: Array.isArray(design) ? design : [],
    totals: {
      ...(totals || {}),
      qty: safeProductQty,
      totalPerUnit,
      totalOrder,
      total: totalPerUnit,
    },
    settings: settings || {},
    materials: Array.isArray(materials) ? materials : [],
    coatings: Array.isArray(coatings) ? coatings : [],
  };
}