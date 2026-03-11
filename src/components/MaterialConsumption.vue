<script setup>
defineProps({
    consumption: { type: Array, default: () => [] }
});
</script>

<template>
    <div v-if="consumption.length > 0" class="mt-6 animate-fade-in">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3 px-1">
            Расход материалов
        </h3>
        
        <div class="space-y-2">
            <div v-for="item in consumption" :key="item.id" class="bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10 flex flex-col gap-2">
                
                <div class="flex justify-between items-start">
                    <span class="font-bold text-xs text-[#18181B] dark:text-gray-100 truncate pr-2">{{ item.name }}</span>
                    <div class="text-right shrink-0">
                        <template v-if="item.isValid">
                            <div>
                                <span class="font-black text-sm text-[#18181B] dark:text-white">{{ item.sheets }}</span>
                                <span class="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase ml-1">лист(а)</span>
                            </div>
                        </template>
                        <template v-else>
                            <span class="text-[9px] font-bold text-red-400 uppercase">Нет размеров</span>
                        </template>
                    </div>
                </div>

                <div v-if="item.isValid" class="flex justify-between items-end">
                    <div class="text-[9px] text-gray-500 dark:text-gray-400 font-medium">
                        <div>Детали: {{ item.totalAreaM2 }} м²</div>
                        <div class="opacity-70">Лист: {{ item.sheetSize }}</div>
                    </div>
                    
                    <div class="w-12 h-1.5 bg-gray-200 dark:bg-white/20 rounded-full overflow-hidden ml-3">
                        <div class="h-full bg-black dark:bg-white rounded-full transition-all duration-500" :style="{ width: item.percent + '%' }"></div>
                    </div>
                </div>

            </div>
        </div>
    </div>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
</style>