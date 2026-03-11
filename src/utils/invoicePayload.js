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
  if (calculatorId === 'dtf') {
    const pricePerCm2 = Math.max(0, Number(dtf?.pricePerCm2) || 0);
    const label = dtf?.label || 'DTF Печать';
    const sourceLayers = Array.isArray(layers) ? layers : [];
    const sourcePackaging = Array.isArray(packaging) ? packaging : [];
    const totalProcessing = sourceLayers.reduce((sum, layer) => {
      const width = Math.max(0, Number(layer?.w) || 0);
      const height = Math.max(0, Number(layer?.h) || 0);
      const qty = Math.max(1, Number(layer?.qty) || 1);
      return sum + (((width * height) / 100) * pricePerCm2 * qty);
    }, 0);

    return {
      project,
      productQty,
      layers: [],
      processing: sourceLayers.map((layer, index) => ({
        id: `dtf-processing-${layer?.id ?? index}-${index}`,
        name: sourceLayers.length > 1
          ? `${label} · ${layer?.name || `Деталь ${index + 1}`}`
          : label,
        type: 'area_cm2',
        qty: Math.max(1, Number(layer?.qty) || 1),
        w: Math.max(0, Number(layer?.w) || 0),
        h: Math.max(0, Number(layer?.h) || 0),
        sides: 1,
        price: pricePerCm2,
      })),
      accessories: [],
      packaging: sourcePackaging.filter((item) => item?.dbId).map((item) => ({ ...item })),
      design: [],
      totals: {
        ...(totals || {}),
        layers: 0,
        costLayers: 0,
        processing: totalProcessing,
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

  return {
    project,
    productQty,
    layers: Array.isArray(layers) ? layers : [],
    processing: Array.isArray(processing) ? processing : [],
    accessories: Array.isArray(accessories) ? accessories : [],
    packaging: Array.isArray(packaging) ? packaging : [],
    design: Array.isArray(design) ? design : [],
    totals: totals || {},
    settings: settings || {},
    materials: Array.isArray(materials) ? materials : [],
    coatings: Array.isArray(coatings) ? coatings : [],
  };
}