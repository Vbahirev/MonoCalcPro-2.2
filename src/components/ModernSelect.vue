<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useHaptics } from '../composables/useHaptics';

const props = defineProps({
    modelValue: [String, Number],
    options: { type: Array, default: () => [] },
    grouped: { type: [Array, Object], default: () => null },
    placeholder: { type: String, default: 'Выберите' },
    columns: { type: Number, default: 1 },
    fitToContent: { type: Boolean, default: false },
    noTruncate: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);
const { impactLight, impactMedium } = useHaptics();

const isOpen = ref(false);
const localValue = ref(null);
const isDesktop = ref(false);
const containerRef = ref(null);
const instanceId = `modern-select-${Math.random().toString(36).slice(2, 10)}`;
const dropdownWidth = ref(0);
const dropdownLeft = ref(0);
const dropdownTop = ref(0);
const dropdownBottom = ref(null);
const dropdownMaxHeight = ref(320);
const normalizedColumns = computed(() => {
    const n = Number(props.columns);
    if (!Number.isFinite(n)) return 1;
    return Math.min(4, Math.max(1, Math.round(n)));
});
const isCompactMultiCol = computed(() => normalizedColumns.value > 1);

const estimatedLabelWidth = computed(() => {
    const text = String(longestLabel.value || props.placeholder || '');
    const px = text.length * 8 + 56;
    return Math.min(460, Math.max(110, px));
});

watch(() => props.modelValue, (val) => {
    localValue.value = val;
}, { immediate: true });

const checkScreen = () => {
    isDesktop.value = window.innerWidth >= 768; 
};

const updateWidth = () => {
    if (containerRef.value) {
        const baseWidth = containerRef.value.offsetWidth;
        // Keep the trigger compact when closed; expanded width is handled only on open.
        dropdownWidth.value = baseWidth;
    }
};

const updateDropdownPosition = () => {
    if (!containerRef.value || !isDesktop.value) return;

    const rect = containerRef.value.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 10;
    const minHeight = 120;

    const compactDesktopMin = isDesktop.value && isCompactMultiCol.value ? 220 : rect.width;
    // Expand only while open so collapsed controls do not affect layout.
    const desiredWidth = isOpen.value
        ? Math.max(rect.width, estimatedLabelWidth.value)
        : rect.width;
    const maxAllowedWidth = Math.max(120, window.innerWidth - viewportPadding * 2);
    const resolvedWidth = Math.min(Math.max(compactDesktopMin, desiredWidth), maxAllowedWidth);

    // Expand symmetrically around the trigger center whenever possible.
    const centeredLeft = rect.left + (rect.width - resolvedWidth) / 2;
    const safeLeft = Math.max(
        viewportPadding,
        Math.min(centeredLeft, window.innerWidth - resolvedWidth - viewportPadding)
    );

    dropdownLeft.value = safeLeft;
    dropdownWidth.value = resolvedWidth;

    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    dropdownBottom.value = null;
    dropdownTop.value = rect.bottom + gap;
    dropdownMaxHeight.value = Math.max(minHeight, spaceBelow - gap);
};

const desktopDropdownStyle = computed(() => {
    if (!isDesktop.value) return {};
    const style = {
        left: `${dropdownLeft.value}px`,
        width: `${dropdownWidth.value}px`,
        maxHeight: `${dropdownMaxHeight.value}px`
    };
    if (dropdownBottom.value !== null) {
        return { ...style, bottom: `${dropdownBottom.value}px` };
    }
    return { ...style, top: `${dropdownTop.value}px` };
});

const containerStyle = computed(() => {
    if (!props.fitToContent) return {};
    return { minWidth: `${estimatedLabelWidth.value}px` };
});

onMounted(() => {
    checkScreen();
    window.addEventListener('resize', checkScreen);
    window.addEventListener('click', onClickOutside);
    window.addEventListener('modern-select-opened', onAnotherSelectOpened);
    window.addEventListener('resize', updateWidth);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    setTimeout(updateWidth, 100);
});

onUnmounted(() => {
    window.removeEventListener('resize', checkScreen);
    window.removeEventListener('click', onClickOutside);
    window.removeEventListener('modern-select-opened', onAnotherSelectOpened);
    window.removeEventListener('resize', updateWidth);
    window.removeEventListener('resize', updateDropdownPosition);
    window.removeEventListener('scroll', updateDropdownPosition, true);
});

const onAnotherSelectOpened = (event) => {
    const openedId = event?.detail?.id;
    if (!openedId || openedId === instanceId) return;
    if (isOpen.value) close();
};

const onClickOutside = (event) => {
    if (isDesktop.value && isOpen.value && containerRef.value && !containerRef.value.contains(event.target)) {
        close();
    }
};

const sections = computed(() => {
    const result = [];
    if (props.grouped) {
        const processGroup = (name, items) => {
            if (items && items.length > 0) {
                const normalizedItems = items.map(item => ({
                    ...item,
                    id: item.id ?? item.value,
                    value: item.value ?? item.id,
                    label: item.label || item.name || 'Без названия'
                }));
                result.push({ title: name, items: normalizedItems });
            }
        };
        if (!Array.isArray(props.grouped)) {
            Object.keys(props.grouped).forEach(k => processGroup(k, props.grouped[k]));
        } else {
            props.grouped.forEach(g => processGroup(g.name || g.group || 'Группа', g.items || g.list));
        }
    } else if (props.options && props.options.length > 0) {
        const items = props.options.map((opt, idx) => {
            if (typeof opt === 'object') {
                const id = opt.id ?? opt.value;
                return { 
                    ...opt, 
                    id: id ?? `opt-${idx}`,
                    value: opt.value ?? id,
                    label: opt.label || opt.name || 'Без названия'
                };
            } else {
                return { id: opt, label: opt, value: opt };
            }
        });
        result.push({ title: null, items });
    }
    return result;
});

const longestLabel = computed(() => {
    let longest = props.placeholder || '';
    sections.value.forEach(section => {
        section.items.forEach(item => {
            if (item.label && item.label.length > longest.length) {
                longest = item.label;
            }
        });
    });
    return longest;
});

const selectedLabel = computed(() => {
    if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') return null;
    for (const section of sections.value) {
        const found = section.items.find(i => i.value === props.modelValue || i.id === props.modelValue);
        if (found) return found.label;
    }
    return null;
});

const open = () => {
    if (!isOpen.value) {
        impactMedium();
        updateWidth();
        window.dispatchEvent(new CustomEvent('modern-select-opened', { detail: { id: instanceId } }));
        isOpen.value = true;
        nextTick(() => {
            updateDropdownPosition();
        });
    } else {
        close();
    }
};

const close = () => {
    isOpen.value = false;
};

const select = (item) => {
    impactLight();
    localValue.value = item.value;
    setTimeout(() => {
        emit('update:modelValue', item.value);
        close();
    }, isDesktop.value ? 0 : 150);
};

const isSelected = (item) => {
    return (item.value === localValue.value || item.id === localValue.value);
};

const sectionItemsClass = computed(() => {
    if (isDesktop.value) {
        if (!isCompactMultiCol.value) return 'flex flex-col gap-1';
        if (normalizedColumns.value === 2) return 'grid gap-1 grid-cols-2';
        if (normalizedColumns.value === 3) return 'grid gap-1 grid-cols-3';
        return 'grid gap-1 grid-cols-4';
    }
    if (!isCompactMultiCol.value) return 'grid grid-cols-2 gap-3';
    if (normalizedColumns.value === 2) return 'grid gap-3 grid-cols-2';
    if (normalizedColumns.value === 3) return 'grid gap-3 grid-cols-3';
    return 'grid gap-3 grid-cols-4';
});
</script>

<template>
    <div 
        class="relative min-w-0 overflow-hidden h-14 bg-white dark:bg-[#232326] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm dark:shadow-black/40 cursor-pointer select-none group transform-gpu no-flicker transition-all duration-300 ease-out"
        :class="isOpen ? 'border-gray-400 dark:border-white/30 ring-2 ring-gray-200/70 dark:ring-white/10' : 'hover:border-gray-300 dark:hover:border-white/20'"
        :style="containerStyle"
        ref="containerRef"
        @click.stop="open"
    >
        <div class="w-full h-full grid place-items-center px-3">
            <div class="col-start-1 row-start-1 invisible flex items-center gap-3 opacity-0 pointer-events-none">
                <span class="font-bold text-[11px] tracking-wide whitespace-nowrap">{{ longestLabel }}</span>
                <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24"></svg>
            </div>

            <div class="col-start-1 row-start-1 flex items-center justify-center w-full relative pr-9 pl-2">
                <span :class="[
                    'max-w-full text-center font-bold tracking-wide transition-colors duration-300 px-1 text-inherit leading-tight text-[clamp(10px,1.4vw,11px)]',
                    noTruncate ? 'whitespace-nowrap' : 'truncate'
                ]">
                    {{ selectedLabel || placeholder }}
                </span>
                
                <div class="absolute inset-y-0 right-3 w-4 flex items-center justify-center pointer-events-none">
                    <svg class="w-4 h-4 opacity-70 transition-transform duration-300 text-inherit" 
                         :class="{'rotate-180': isOpen}"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <polyline points="6 9 12 15 18 9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
                    </svg>
                </div>
            </div>
        </div>

        <Teleport to="body">
            <Transition name="fade">
                <div v-if="isOpen && !isDesktop" @click="close" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9990]"></div>
            </Transition>
        </Teleport>

        <Teleport to="body">
            <Transition :name="isDesktop ? 'dropdown' : 'pop-up'">
                <div 
                    v-if="isOpen"
                    :style="isDesktop ? desktopDropdownStyle : {}"
                    :class="[
                        isDesktop 
                            ? 'fixed bg-white dark:bg-[#1C1C1E] rounded-2xl p-2 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 z-[1200] flex flex-col gap-1' 
                            : 'fixed bottom-6 left-4 right-4 z-[9999] bg-[#F7F7F9] dark:bg-[#1C1C1E] rounded-[28px] shadow-2xl border border-white/20 dark:border-white/5 flex flex-col max-h-[60vh] ring-1 ring-black/5'
                    ]"
                >
                    <div v-if="!isDesktop" class="px-6 py-4 bg-white dark:bg-[#252525] border-b border-gray-100 dark:border-white/5 flex items-center justify-between shrink-0 rounded-t-[28px]">
                        <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Выберите</span>
                    </div>

                    <div class="overflow-y-auto custom-scroll modern-select-scroll" @wheel.stop :class="isDesktop ? '' : 'p-4 space-y-6'">
                        <template v-if="sections.length > 0">
                            <div v-for="(section, idx) in sections" :key="idx" class="flex flex-col gap-1">
                                <div v-if="section.title" 
                                     :class="isDesktop ? 'px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1 first:mt-0 mx-1' : 'px-2 mb-3 flex items-center justify-center gap-2'">
                                    <span v-if="!isDesktop" class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ section.title }}</span>
                                    <span v-else>{{ section.title }}</span>
                                </div>

                                <div :class="sectionItemsClass">
                                    <button 
                                        v-for="item in section.items" 
                                        :key="item.id"
                                        @click.stop="select(item)"
                                        class="relative transition-colors duration-200 flex items-center justify-between group w-full overflow-hidden"
                                        :class="[
                                            isDesktop 
                                                ? (isCompactMultiCol ? 'px-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider justify-center' : 'px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider')
                                                : 'flex flex-col items-center justify-center p-4 rounded-2xl border active:scale-[0.96] min-h-[80px]',
                                            isSelected(item) 
                                                ? (isDesktop ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-black border-black text-white shadow-lg shadow-black/20') 
                                                : (isDesktop ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-black dark:hover:text-white' : 'bg-white dark:bg-white/5 border-transparent text-gray-900 dark:text-white shadow-sm')
                                        ]"
                                    >
                                        <div v-if="!isDesktop && isSelected(item)" class="absolute top-2 right-2 text-white/40">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
                                        </div>
                                        <span class="leading-tight break-words" :class="[
                                            isDesktop
                                                ? (noTruncate ? 'text-center whitespace-normal break-words w-full text-[clamp(10px,1vw,11px)]' : 'text-center truncate w-full text-[clamp(10px,1vw,11px)]')
                                                : 'text-[clamp(12px,3.2vw,14px)] text-center w-full px-1 font-bold'
                                        ]">
                                            {{ item.label }}
                                        </span>
                                        <div v-if="isDesktop && isSelected(item) && !isCompactMultiCol" class="absolute right-2 top-1/2 -translate-y-1/2">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        </div>
                                        <div v-if="isDesktop && isSelected(item) && isCompactMultiCol" class="ml-1 shrink-0">
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </template>
                        <div v-else class="py-6 flex flex-col items-center justify-center text-gray-400 opacity-50">
                            <span class="text-xs font-bold">Пусто</span>
                        </div>
                    </div>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.pop-up-enter-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.pop-up-leave-active { transition: all 0.2s ease-in; }
.pop-up-enter-from, .pop-up-leave-to { opacity: 0; transform: translateY(20px) scale(0.95); }

.dropdown-enter-active { transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top center; }
.dropdown-leave-active { transition: opacity 0.15s ease-in, transform 0.15s ease-in; transform-origin: top center; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-6px); }

.modern-select-scroll {
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}

.modern-select-scroll::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
}
</style>