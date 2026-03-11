<script setup>
import { computed } from 'vue';

const props = defineProps({
  rollWidthMm: { type: Number, default: 560 },
  printW:      { type: Number, default: 0 },
  printH:      { type: Number, default: 0 },
  qty:         { type: Number, default: 1 },
});

const CONTAINER_H = 156;

const rollW   = computed(() => Math.max(1, props.rollWidthMm || 560));
const printW  = computed(() => Math.min(Math.max(0, props.printW || 0), rollW.value));
const printH  = computed(() => Math.max(0, props.printH || 0));
const qty     = computed(() => Math.max(1, props.qty || 1));

const hasSize      = computed(() => printW.value > 0 && printH.value > 0);
const fitsPerRow   = computed(() => hasSize.value ? Math.max(1, Math.floor(rollW.value / printW.value)) : 0);
const rowsNeeded   = computed(() => fitsPerRow.value ? Math.ceil(qty.value / fitsPerRow.value) : 0);
const linearM      = computed(() => ((rowsNeeded.value * printH.value) / 1000).toFixed(2));

const maxVisualRows = 2;
const displayRows   = computed(() => hasSize.value ? Math.min(rowsNeeded.value, maxVisualRows) : 1);
const rowPx         = computed(() => Math.max(12, Math.floor((CONTAINER_H - 16) / Math.max(displayRows.value, 1)) - 4));
const printWPct     = computed(() => printW.value / rollW.value * 100);

const printRects = computed(() => {
  if (!hasSize.value || !fitsPerRow.value) return [];
  const rects = [];
  let count = 0;
  for (let row = 0; row < displayRows.value; row++) {
    for (let col = 0; col < fitsPerRow.value; col++) {
      if (count >= qty.value) break;
      rects.push({
        key:      `${row}-${col}`,
        leftPct:  (col * printW.value / rollW.value * 100).toFixed(3),
        topPx:    8 + row * (rowPx.value + 4),
        wPct:     printWPct.value.toFixed(3),
        hPx:      rowPx.value,
        num:      count + 1,
        showNum:  printWPct.value > 8 && rowPx.value > 16,
      });
      count++;
    }
  }
  return rects;
});

const hiddenCount = computed(() => Math.max(0, qty.value - printRects.value.length));

const rulerTicks = computed(() => {
  const w    = rollW.value;
  const step = w <= 200 ? 50 : w <= 600 ? 100 : 200;
  const ticks = [];
  for (let mm = 0; mm <= w; mm += step) ticks.push({ mm, pct: (mm / w * 100).toFixed(2) });
  if (ticks.at(-1)?.mm !== w) ticks.push({ mm: w, pct: '100' });
  return ticks;
});
</script>

<template>
  <div class="rounded-2xl bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 overflow-hidden">
    <!-- Info bar -->
    <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-white/10">
      <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
        Развёртка · {{ rollW }} мм
      </span>
      <div v-if="hasSize" class="flex gap-3">
        <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">×{{ fitsPerRow }} в ряд</span>
        <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">{{ rowsNeeded }} рядов</span>
        <span class="text-[10px] font-black text-[#1d1d1f] dark:text-white">{{ linearM }} пог. м</span>
      </div>
    </div>

    <div class="p-3 select-none">
      <!-- Roll area -->
      <div
        class="relative bg-white dark:bg-[#232326] rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden"
        :style="{ height: CONTAINER_H + 'px' }"
      >
        <!-- Roll edges -->
        <div class="absolute top-0 bottom-0 left-0 w-0.5 bg-gray-300 dark:bg-white/15 z-10"></div>
        <div class="absolute top-0 bottom-0 right-0 w-0.5 bg-gray-300 dark:bg-white/15 z-10"></div>
        <!-- Subtle column grid -->
        <div
          class="absolute inset-0 pointer-events-none"
          style="background-image: repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(0,0,0,0.04) 50px);"
        ></div>
        <!-- Empty state -->
        <div v-if="!hasSize" class="absolute inset-0 flex items-center justify-center">
          <span class="text-xs font-bold text-gray-400 dark:text-gray-500">Введите размер печати</span>
        </div>
        <!-- Print rects -->
        <div
          v-for="rect in printRects"
          :key="rect.key"
          class="absolute bg-blue-500/85 dark:bg-blue-400/80 rounded-[3px] border border-blue-600/20 dark:border-blue-300/20 flex items-center justify-center transition-all duration-200"
          :style="{
            left:   'calc(' + rect.leftPct + '% + 1px)',
            top:    rect.topPx + 'px',
            width:  'calc(' + rect.wPct + '% - 2px)',
            height: rect.hPx + 'px',
          }"
        >
          <span v-if="rect.showNum" class="text-[8px] font-black text-white leading-none">{{ rect.num }}</span>
        </div>
        <!-- More indicator -->
        <div v-if="hiddenCount > 0" class="absolute bottom-2 left-3">
          <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500">··· ещё {{ hiddenCount }} шт.</span>
        </div>
      </div>

      <!-- Ruler -->
      <div class="relative mt-1.5" style="height: 26px">
        <div class="absolute top-0 left-0 right-0 h-px bg-gray-300 dark:bg-white/15"></div>
        <div
          v-for="tick in rulerTicks"
          :key="tick.mm"
          class="absolute flex flex-col items-center"
          :style="{ left: tick.pct + '%', transform: 'translateX(-50%)' }"
        >
          <div class="w-px h-2 bg-gray-300 dark:bg-white/20 mt-px"></div>
          <span class="text-[9px] font-bold text-gray-400 dark:text-gray-500 mt-0.5 whitespace-nowrap">{{ tick.mm }}</span>
        </div>
      </div>

      <!-- Size hint -->
      <div v-if="hasSize" class="mt-1.5 text-center">
        <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500">
          {{ printW }} × {{ printH }} мм · {{ fitsPerRow }} шт. в ряд
        </span>
      </div>
    </div>
  </div>
</template>
