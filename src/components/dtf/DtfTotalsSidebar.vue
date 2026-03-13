<script setup>
import { computed, ref, watch } from 'vue';
import PriceChart from '@/components/PriceChart.vue';
import Tooltip from '@/components/Tooltip.vue';

const SIZE_KEYS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];

const dtfSegmentConfig = [
  { key: 'accessories', fallbackKey: 'accessories', bg: 'bg-[#E4E4E7] dark:bg-gray-300', label: 'Изделия' },
  { key: 'costLayers', fallbackKey: 'layers', bg: 'bg-[#A1A1AA] dark:bg-gray-400', label: 'Вид печати' },
  { key: 'costPackaging', fallbackKey: 'packaging', bg: 'bg-[#52525B] dark:bg-gray-500', label: 'Упаковка' },
];

const props = defineProps({
  dtfTotals: { type: Object, default: () => ({}) },
  isCostVisible: { type: Boolean, default: false },
  totalForAll: { type: Number, default: 0 },
  pricePerOne: { type: Number, default: 0 },
  productQty: { type: Number, default: 1 },
  sizeGridEnabled: { type: Boolean, default: false },
  sizeGrid: { type: Object, default: () => ({}) },
  totalPrints: { type: Number, default: 0 },
  totalLinearM: { type: Number, default: 0 },
  rollWidthMm: { type: Number, default: 0 },
  dtfRollSummaryRows: { type: Array, default: () => [] },
  materialTotal: { type: Number, default: 0 },
  packagingTotal: { type: Number, default: 0 },
  blankTotal: { type: Number, default: 0 },
  currentProductType: { type: Object, default: () => ({ label: '' }) },
  markupAmt: { type: Number, default: 0 },
  discountAmt: { type: Number, default: 0 },
  project: { type: Object, default: () => ({ markup: 0, discount: 0 }) },
});

const emit = defineEmits([
  'toggle-cost-visibility',
  'change-markup',
  'change-discount',
  'change-product-qty',
  'open-invoice-modal',
  'copy-quote',
  'request-reset',
]);

const qtyDraft = ref('1');

const orderProductQty = computed(() => Math.max(1, Number(props.productQty) || 1));
const sizeBreakdown = computed(() => {
  if (!props.sizeGridEnabled) return '';

  return SIZE_KEYS
    .map((key) => ({ key, qty: Math.max(0, Number(props.sizeGrid?.[key]) || 0) }))
    .filter((item) => item.qty > 0)
    .map((item) => `${item.key} × ${item.qty}`)
    .join(', ');
});
const orderedPrintsCount = computed(() => Math.max(0, Number(props.totalPrints) || 0) * orderProductQty.value);
const orderedLinearMeters = computed(() => (Math.max(0, Number(props.totalLinearM) || 0) * orderProductQty.value));
const hasRollUsage = computed(() => orderedLinearMeters.value > 0.0001);
const previewRows = computed(() => (props.dtfRollSummaryRows || [])
  .filter((row) => !row?.invalid && Number(row?.qty) > 0)
  .map((row) => ({
    id: row.id,
    name: row.name || 'Нанесение',
    perProductQty: Math.max(1, Number(row.qty) || 1),
    orderQty: Math.max(1, Number(row.qty) || 1) * orderProductQty.value,
    meters: Math.max(0, Number(row.meters) || 0) * orderProductQty.value,
  })));

watch(
  () => props.productQty,
  (value) => {
    qtyDraft.value = String(Math.max(1, Number(value) || 1));
  },
  { immediate: true }
);

const onQtyInput = (event) => {
  const rawValue = String(event?.target?.value ?? '').replace(/[^0-9]/g, '');
  qtyDraft.value = rawValue;

  const nextQty = Number(rawValue);
  if (Number.isFinite(nextQty) && nextQty > 0) {
    emit('change-product-qty', { absoluteQty: nextQty });
  }
};

const commitQtyInput = () => {
  const nextQty = Number(qtyDraft.value);
  const normalizedQty = Number.isFinite(nextQty) && nextQty > 0 ? Math.floor(nextQty) : Math.max(1, Number(props.productQty) || 1);
  qtyDraft.value = String(normalizedQty);
  emit('change-product-qty', { absoluteQty: normalizedQty });
};
</script>

<template>
  <div class="relative">
    <div>
      <div class="kpi-card bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 text-[#18181B] dark:text-gray-100 mb-6">
        <PriceChart :totals="dtfTotals" :segment-config="dtfSegmentConfig" :cost-revealed="isCostVisible" @toggle-cost-visibility="emit('toggle-cost-visibility')" />

        <div class="mb-6 border-t border-gray-100 pt-4">
          <div class="flex justify-between items-baseline">
            <span class="text-sm font-bold uppercase tracking-widest text-gray-400">Итого</span>
            <span class="total-amount text-3xl font-black tracking-tighter text-black dark:text-white">{{ totalForAll.toLocaleString() }} ₽</span>
          </div>
          <div class="flex justify-end mt-1">
            <span class="text-[10px] font-bold text-gray-400">{{ pricePerOne.toLocaleString() }} ₽ × {{ productQty }} шт</span>
          </div>
        </div>

        <div class="mb-6 animate-fade-in">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 px-1">
            Формирование заказа
          </h3>

          <div class="space-y-2">
            <div class="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-xs text-[#18181B] dark:text-gray-100 truncate">{{ currentProductType.label || 'Текстиль' }}</div>
                <div class="mt-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">Текстильные заготовки</div>
                <div v-if="sizeBreakdown" class="mt-1 text-[10px] font-semibold leading-snug text-gray-400 dark:text-gray-500">
                  {{ sizeBreakdown }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="font-black text-sm text-[#18181B] dark:text-white">{{ orderProductQty }}</div>
                <div class="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">шт</div>
              </div>
            </div>

            <div class="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-xs text-[#18181B] dark:text-gray-100 truncate">Нанесения</div>
                <div class="mt-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">Всего принтов по заказу</div>
              </div>
              <div class="text-right shrink-0">
                <div class="font-black text-sm text-[#18181B] dark:text-white">{{ orderedPrintsCount }}</div>
                <div class="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">шт</div>
              </div>
            </div>

            <div v-if="hasRollUsage" class="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10 flex flex-col gap-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-bold text-xs text-[#18181B] dark:text-gray-100 truncate">Расход DTF-рулона</div>
                  <div class="mt-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">Ширина {{ Math.round(rollWidthMm || 0) }} мм</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-black text-sm text-[#18181B] dark:text-white">{{ orderedLinearMeters.toFixed(2) }}</div>
                  <div class="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">м</div>
                </div>
              </div>

              <div v-if="previewRows.length" class="space-y-1 pt-1 border-t border-gray-200 dark:border-white/10">
                <div v-for="row in previewRows" :key="row.id" class="flex items-center justify-between gap-3 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  <span class="truncate">{{ row.name }}</span>
                  <span class="shrink-0">{{ row.orderQty }} шт · {{ row.meters.toFixed(2) }} м</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4 mb-6">
          <div v-if="blankTotal > 0" class="flex justify-between items-baseline">
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full bg-[#E4E4E7] dark:bg-gray-300 shrink-0"></div>
              <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Изделия ({{ currentProductType.label }})</span>
            </div>
            <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(blankTotal).toLocaleString() }} ₽</span>
          </div>
          <div class="flex justify-between items-baseline">
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full bg-[#A1A1AA] dark:bg-gray-400 shrink-0"></div>
              <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Вид печати</span>
            </div>
            <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(materialTotal).toLocaleString() }} ₽</span>
          </div>
          <div class="flex justify-between items-baseline">
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full bg-[#52525B] dark:bg-gray-500 shrink-0"></div>
              <span class="text-sm font-bold text-gray-500 dark:text-gray-400">Упаковка</span>
            </div>
            <span class="calc-amount-value font-bold text-black dark:text-white">{{ Math.round(packagingTotal).toLocaleString() }} ₽</span>
          </div>
        </div>

        <div class="kp-controls bg-gray-100 rounded-xl p-4 mb-6 space-y-4 relative transition-colors">
          <div class="absolute top-2 right-2 z-10">
            <Tooltip text="Итого = (Себестоимость + Наценка%) - Скидка%" width="w-48">
              <div class="w-4 h-4 rounded-full bg-white dark:bg-black text-gray-400 hover:text-black dark:hover:text-white flex items-center justify-center text-[10px] font-bold shadow-sm cursor-help transition-colors">?</div>
            </Tooltip>
          </div>

          <div class="flex items-center justify-between">
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-bold text-gray-500">Наценка</span>
              <span v-if="markupAmt > 0" class="text-[10px] font-bold text-green-600 dark:text-green-500">+{{ Math.round(markupAmt).toLocaleString() }} ₽</span>
            </div>
            <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
              <button @click="emit('change-markup', -5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
              <span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 leading-8 text-black dark:text-white">{{ project.markup }}%</span>
              <button @click="emit('change-markup', 5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-bold text-gray-500">Скидка</span>
              <span v-if="discountAmt > 0" class="text-[10px] font-bold text-red-500">-{{ Math.round(discountAmt).toLocaleString() }} ₽</span>
            </div>
            <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
              <button @click="emit('change-discount', -5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
              <span class="kp-percent-value w-10 text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 leading-8 text-black dark:text-white">{{ project.discount }}%</span>
              <button @click="emit('change-discount', 5)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
            </div>
          </div>

          <div class="pt-3 mt-1 border-t border-gray-200 dark:border-white/10 transition-colors">
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-[10px] uppercase font-bold text-gray-500">Тираж заказа</span>
                <span class="text-[10px] font-bold text-gray-500">{{ productQty }} шт</span>
              </div>
              <div class="flex items-center bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-sm transition-colors overflow-hidden">
                <button @click="emit('change-product-qty', -1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">-</button>
                <input type="number" min="1" :value="qtyDraft" @input="onQtyInput" @change="commitQtyInput" @blur="commitQtyInput" class="w-12 h-full text-center text-xs font-bold border-x border-gray-200 dark:border-white/10 bg-transparent outline-none caret-current text-black dark:text-white">
                <button @click="emit('change-product-qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors font-bold">+</button>
              </div>
            </div>
            <p class="mt-2 max-w-[220px] text-[10px] font-semibold leading-snug text-gray-400 dark:text-gray-500">
              Умножает весь заказ целиком. Количества в карточках считаются внутри одной единицы заказа.
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <button @click="emit('open-invoice-modal')" class="w-full h-12 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-gray-800 dark:hover:bg-gray-200 transition-all active:scale-[0.98] shadow-xl flex items-center justify-center gap-2">
            Сформировать КП
          </button>
          <div class="grid grid-cols-2 gap-3">
            <button @click="emit('copy-quote')" class="kp-secondary-btn h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">
              Копировать КП
            </button>
            <button @click="emit('request-reset')" class="kp-secondary-btn kp-secondary-danger h-12 rounded-xl font-bold uppercase text-[10px] tracking-wider">
              Сброс
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>