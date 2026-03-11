<script setup>
import { ref } from 'vue';

defineProps({
    text: String,
    // Увеличили ширину для длинных текстов
    width: { type: String, default: 'w-max max-w-[280px]' } 
});

const isVisible = ref(false);
const triggerRef = ref(null);
const tooltipPos = ref({ top: 0, left: 0 });
const placement = ref('top');

const show = () => {
    if (!triggerRef.value) return;
    
    // Вычисляем координаты иконки относительно окна
    const rect = triggerRef.value.getBoundingClientRect();
    
    const estimatedTooltipHeight = 120;
    const viewportMargin = 12;
    const shouldOpenBelow = rect.top < (estimatedTooltipHeight + viewportMargin);

    placement.value = shouldOpenBelow ? 'bottom' : 'top';

    tooltipPos.value = {
        top: shouldOpenBelow ? (rect.bottom + 10) : (rect.top - 10),
        left: rect.left + rect.width / 2
    };
    
    isVisible.value = true;
};

const hide = () => {
    isVisible.value = false;
};
</script>

<template>
    <div 
        ref="triggerRef"
        class="inline-flex items-center justify-center cursor-help text-gray-400 transition-all duration-300 hover:text-black dark:hover:text-white z-20"
        @mouseenter="show"
        @mouseleave="hide"
        @focus="show"
        @blur="hide"
    >
        <slot />
    </div>

    <Teleport to="body">
        <Transition name="tooltip-fade">
            <div 
                v-if="isVisible"
                class="fixed z-[9999] pointer-events-none"
                :style="{ top: `${tooltipPos.top}px`, left: `${tooltipPos.left}px` }"
            >
                <div :class="placement === 'top' ? 'transform -translate-x-1/2 -translate-y-full' : 'transform -translate-x-1/2 translate-y-0'">
                    
                    <div :class="[
                        width, 
                        'bg-[#09090b]/95 backdrop-blur-md', 
                        'text-white text-[11px] font-medium leading-relaxed tracking-wide', 
                        'py-3 px-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]', 
                        'text-left border border-white/10 relative whitespace-pre-line'
                    ]">
                        {{ text }}
                        
                        <svg v-if="placement === 'top'" class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[#09090b]/95 w-4 h-2 drop-shadow-sm" viewBox="0 0 255 127" fill="currentColor">
                            <path d="M127.5 127.5L0 0H255L127.5 127.5Z"/>
                        </svg>
                        <svg v-else class="absolute -top-1.5 left-1/2 -translate-x-1/2 rotate-180 text-[#09090b]/95 w-4 h-2 drop-shadow-sm" viewBox="0 0 255 127" fill="currentColor">
                            <path d="M127.5 127.5L0 0H255L127.5 127.5Z"/>
                        </svg>
                    </div>

                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
/* Плавное появление (Opacity + Slide) */
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
    opacity: 0;
    transform: translateY(4px); 
}
</style>