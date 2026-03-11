// Central registry of calculators.
//
// Масштабирование до 30+ калькуляторов:
// - добавляешь новую папку src/calculators/<id>/index.js
// - калькулятор автоматически попадёт в реестр
//
// Важно: используем eager-импорт, чтобы список калькуляторов был доступен синхронно
// (без смены текущей логики роутинга/рендера).

// Используем относительный путь, чтобы не зависеть от настроек alias.
const modules = import.meta.glob('../../calculators/*/index.js', { eager: true });
const calculators = Object.values(modules)
  .map((m) => m?.default)
  .filter(Boolean)
  // стабильный порядок (важно для дефолтного калькулятора)
  .sort((a, b) => {
    const orderA = Number(a?.manifest?.order ?? 999);
    const orderB = Number(b?.manifest?.order ?? 999);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.manifest?.name || '').localeCompare(String(b.manifest?.name || ''));
  });

export const calculatorList = calculators.map((c) => c.manifest);

export function getCalculator(id) {
  const found = calculators.find((c) => c.manifest.id === id);
  return found || calculators[0];
}
