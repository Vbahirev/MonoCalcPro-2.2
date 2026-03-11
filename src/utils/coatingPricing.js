export const COATING_CAN_COVERAGE_CM2 = 15000;
export const DEFAULT_VINYL_ROLL_WIDTH_MM = 1260;
export const DEFAULT_DTF_ROLL_WIDTH_MM = 560;
export const DEFAULT_DTF_LINEAR_METER_PRICE = 2000;

export const COATING_PRICING_MODE_SPRAY_CAN = 'spray_can';
export const COATING_PRICING_MODE_VINYL_LINEAR = 'vinyl_linear';
export const COATING_PRICING_MODE_DTF_LINEAR = 'dtf_linear';

const toNumber = (value) => {
    const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const getCoatingPricePerCm2 = (coating, options = {}) => {
    const includeMarkup = options?.includeMarkup !== false;
    const mode = coating?.pricingModel === COATING_PRICING_MODE_VINYL_LINEAR
        ? COATING_PRICING_MODE_VINYL_LINEAR
        : coating?.pricingModel === COATING_PRICING_MODE_DTF_LINEAR
            ? COATING_PRICING_MODE_DTF_LINEAR
            : COATING_PRICING_MODE_SPRAY_CAN;

    const fallbackPrice = mode === COATING_PRICING_MODE_DTF_LINEAR ? DEFAULT_DTF_LINEAR_METER_PRICE : 0;
    const rawPrice = Math.max(0, toNumber(coating?.price) || fallbackPrice);
    const markupPercent = Math.max(0, toNumber(coating?.markupPercent));
    const priceToUse = includeMarkup ? rawPrice * (1 + markupPercent / 100) : rawPrice;

    if (mode === COATING_PRICING_MODE_VINYL_LINEAR || mode === COATING_PRICING_MODE_DTF_LINEAR) {
        const defaultWidth = mode === COATING_PRICING_MODE_DTF_LINEAR ? DEFAULT_DTF_ROLL_WIDTH_MM : DEFAULT_VINYL_ROLL_WIDTH_MM;
        const rollWidthMm = Math.max(1, toNumber(coating?.vinylWidthMm) || defaultWidth);
        const safeRollWidthMm = Number.isFinite(rollWidthMm) && rollWidthMm > 0 ? rollWidthMm : defaultWidth;
        const linearMeterAreaCm2 = (safeRollWidthMm / 10) * 100;
        if (linearMeterAreaCm2 <= 0) return 0;
        return priceToUse / linearMeterAreaCm2;
    }

    if (COATING_CAN_COVERAGE_CM2 <= 0) return 0;
    return priceToUse / COATING_CAN_COVERAGE_CM2;
};
