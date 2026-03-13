<script setup>
defineProps({
  currentUser: { type: Object, default: null },
  statusConfig: {
    type: Object,
    default: () => ({ cls: '', dot: '', text: '' }),
  },
  canViewHistory: { type: Boolean, default: false },
  canUseCloud: { type: Boolean, default: false },
  canViewSettings: { type: Boolean, default: false },
});

const emit = defineEmits([
  'open-auth',
  'open-save-project',
  'open-history',
  'open-settings',
]);
</script>

<template>
  <header class="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-white/10 no-print gap-4">
    <div class="flex-1 w-full md:w-auto flex items-center gap-2">
      <h1 class="text-2xl font-black tracking-tight text-[#18181B] dark:text-white">Нанесение на текстиль</h1>
    </div>

    <div class="calc-top-nav-wrap flex items-center gap-2 w-full md:w-auto justify-end">
      <div v-if="currentUser" class="hidden md:flex flex-col items-end mr-2 text-right">
        <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Вы вошли как</span>
        <span class="text-xs font-black text-[#1d1d1f] dark:text-white leading-none">{{ currentUser.email }}</span>
      </div>
      <button v-else @click="emit('open-auth')" class="hidden md:flex px-4 py-2 bg-black text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:opacity-80 transition-all">Войти</button>

      <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all" :class="statusConfig.cls">
        <span class="w-2 h-2 rounded-full" :class="statusConfig.dot"></span>{{ statusConfig.text }}
      </div>

      <div class="h-8 w-px bg-gray-200 dark:bg-white/10 mx-1 hidden md:block"></div>

      <button @click="emit('open-save-project')" class="btn-labeled calc-top-nav-btn group" title="Сохранить проект">
        <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        </div>
        <span class="hidden md:block">Сохранить</span>
      </button>

      <template v-if="canViewHistory">
        <button @click="emit('open-history')" :disabled="!canUseCloud" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="История">
          <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <span class="hidden md:block">История</span>
        </button>
      </template>

      <template v-if="canViewSettings">
        <button @click="emit('open-settings')" :disabled="!canUseCloud" class="btn-labeled calc-top-nav-btn group disabled:opacity-50 disabled:cursor-not-allowed" title="Настройки">
          <div class="calc-top-nav-icon p-1.5 rounded-lg transition-all text-gray-600 dark:text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </div>
          <span class="hidden md:block">Настройки</span>
        </button>
      </template>
    </div>
  </header>
</template>