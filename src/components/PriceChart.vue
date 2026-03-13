<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
    totals: { type: Object, required: true },
    costRevealed: { type: Boolean, default: false },
    segmentConfig: { type: Array, default: null }
});
const emit = defineEmits(['toggle-cost-visibility']);

const hoveredSegment = ref(null);

// МОНОХРОМНАЯ ПАЛИТРА
const defaultCategories = [
    { key: 'costLayers', fallbackKey: 'layers', bg: 'bg-black dark:bg-zinc-100', label: 'Материалы' },
    { key: 'costProcessing', fallbackKey: 'processing', bg: 'bg-zinc-600 dark:bg-zinc-200', label: 'Пост-обработка' },
    { key: 'costAccessories', fallbackKey: 'accessories', bg: 'bg-zinc-400 dark:bg-zinc-300', label: 'Аксессуары' },
    { key: 'costPackaging', fallbackKey: 'packaging', bg: 'bg-zinc-300 dark:bg-zinc-400', label: 'Упаковка' },
    { key: 'costDesign', fallbackKey: 'design', bg: 'bg-zinc-200 dark:bg-zinc-500', label: 'Дизайн' }
];

const categories = computed(() => {
    if (Array.isArray(props.segmentConfig) && props.segmentConfig.length) {
        return props.segmentConfig;
    }
    return defaultCategories;
});

const chartData = computed(() => {
    const data = categories.value.map(cat => ({
        ...cat,
        value: Number(props.totals?.[cat.key] ?? props.totals?.[cat.fallbackKey] ?? 0) || 0
    })).filter(item => item.value > 0);

    const total = data.reduce((sum, item) => sum + item.value, 0);

    if (total === 0) return [];

    let accumulatedPercent = 0;

    return data.map(item => {
        const rawPercent = (item.value / total) * 100;
        const centerPosition = accumulatedPercent + (rawPercent / 2);
        accumulatedPercent += rawPercent;

        return {
            ...item,
            percent: rawPercent,
            displayPercent: Math.round(rawPercent),
            center: centerPosition
        };
    });
});

const totalSum = computed(() => {
    const fromTotals = Number(props.totals?.costTotal);
    if (Number.isFinite(fromTotals) && fromTotals > 0) return fromTotals;
    return categories.value.reduce((sum, cat) => sum + (Number(props.totals?.[cat.key] ?? props.totals?.[cat.fallbackKey] ?? 0) || 0), 0);
});
</script>

<template>
    <div class="w-full py-6 opacity-0 animate-fade-in relative group" 
         :class="{'opacity-100': totalSum > 0}" 
         v-if="totalSum > 0"
         @mouseleave="hoveredSegment = null">
        
        <div
            class="flex justify-between items-end mb-3 px-1 transition-all duration-200"
            :class="costRevealed ? '' : 'cost-spoiler cursor-pointer'"
            @click="emit('toggle-cost-visibility')"
        >
            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Себестоимость</span>
            <div class="flex items-baseline gap-1.5">
                <span class="text-2xl font-black tracking-tight leading-none text-[#18181B] dark:text-white transition-all duration-200">{{ totalSum.toLocaleString() }}</span>
                <span class="text-[10px] font-bold text-gray-400 dark:text-gray-300">₽</span>
            </div>
        </div>

        <Transition name="tooltip-pop">
            <div v-if="hoveredSegment" 
                 class="absolute bottom-[2.8rem] z-20 transform -translate-x-1/2 pointer-events-none"
                 :style="{ left: `${hoveredSegment.center}%` }">
                
                <div class="bg-[#18181B] text-white text-[10px] font-bold py-1.5 px-3 rounded-lg shadow-xl flex flex-col items-center min-w-[80px] border border-white/10">
                    <span class="uppercase tracking-wider text-[9px] opacity-70 mb-0.5">{{ hoveredSegment.label }}</span>
                    <span class="text-xs">{{ hoveredSegment.displayPercent }}%</span>
                    
                    <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#18181B] rotate-45 border-r border-b border-white/10"></div>
                </div>
            </div>
        </Transition>

        <div
            class="flex h-4 w-full rounded-lg bg-gray-100 dark:bg-white/10 p-[2px] gap-[3px] shadow-inner relative isolate transition-all duration-200"
            :class="costRevealed ? 'cursor-default' : 'cost-spoiler cost-spoiler--block cursor-pointer'"
            @click="emit('toggle-cost-visibility')"
        >
            <div 
                v-for="(segment, index) in chartData" 
                :key="segment.key"
                :class="[segment.bg, 'h-full rounded-md transition-all duration-300 ease-out relative hover:brightness-110']"
                :style="{ width: `${segment.percent}%`, zIndex: 10 - index }"
                @mouseenter="costRevealed && (hoveredSegment = segment)"
            ></div>
        </div>
        
    </div>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

.tooltip-pop-enter-active,
.tooltip-pop-leave-active {
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.tooltip-pop-enter-from,
.tooltip-pop-leave-to {
    opacity: 0;
    transform: translate(-50%, 5px);
}

.cost-spoiler {
    border-radius: 10px;
    user-select: none;
    filter: blur(8px);
    -webkit-filter: blur(8px);
    opacity: 0.92;
}

.cost-spoiler--block {
    border-radius: 8px;
}
</style>