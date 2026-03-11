<script setup>
import { computed, onMounted, ref, onErrorCaptured } from 'vue';
import { useTheme } from '@/composables/useTheme';
import { useDatabase } from '@/composables/useDatabase';
import { useRegisterSW } from 'virtual:pwa-register/vue';

// PWA Update Logic
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisterError(error) {
    console.warn('[PWA] SW registration failed:', error);
  }
});

const applyPwaUpdate = () => {
  if (needRefresh.value) {
    updateServiceWorker(true);
  }
};

// Глобальный перехватчик ошибок
const globalError = ref(null);

onErrorCaptured((err, instance, info) => {
  console.error('[Global Error Boundary]:', err, info);
  globalError.value = {
    message: err?.message || 'Неизвестная ошибка',
    info: info
  };
  // Возвращаем false чтобы остановить всплытие ошибки
  return false;
});

const reloadApp = () => {
  window.location.reload();
};

// Достаем методы инициализации
const { initTheme } = useTheme();
const { initDatabase: initDB, isOfflineMode, pendingProjectSyncCount } = useDatabase();

const offlineHintText = computed(() => {
  if (!isOfflineMode.value) return '';
  if (pendingProjectSyncCount.value > 0) {
    return `Офлайн режим: ${pendingProjectSyncCount.value} проект(ов) ожидают синхронизации`;
  }
  return 'Офлайн режим: данные будут синхронизированы после подключения';
});

onMounted(() => {
    // 1. Применяем сохраненную тему (Светлая / Тёмная / Системная)
    initTheme();

    // 2. Инициализируем подключение к базе и слушатель авторизации
    initDB();
});
</script>

<template>
  <!-- PWA Update Prompt -->
  <Transition name="fade-up">
    <div
      v-if="needRefresh"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-full bg-[#1d1d1f] dark:bg-white text-white dark:text-black shadow-2xl flex items-center justify-between gap-4 w-[90%] max-w-sm"
      role="alert"
    >
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-white/10 dark:bg-black/10 flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </div>
        <span class="text-xs font-bold leading-tight uppercase tracking-wide">Доступно обновление</span>
      </div>
      
      <div class="flex gap-2 shrink-0">
        <button @click="needRefresh = false" class="px-3 py-1.5 rounded-full text-[10px] font-bold text-gray-300 dark:text-gray-500 hover:bg-white/10 dark:hover:bg-black/5 transition-colors uppercase">
          Позже
        </button>
        <button @click="applyPwaUpdate" class="px-4 py-1.5 rounded-full text-[10px] font-black bg-white dark:bg-black text-black dark:text-white transition-transform hover:scale-105 active:scale-95 shadow-lg uppercase">
          Обновить
        </button>
      </div>
    </div>
  </Transition>

  <!-- Offline Status -->
  <div
    v-if="isOfflineMode"
    class="fixed top-4 right-4 z-[9999] px-3 py-1.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30 shadow-lg flex items-center gap-2 max-w-[320px]"
    role="status"
    aria-live="polite"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 8.82a15 15 0 0 1 20 0"></path>
      <path d="M5 12.86a10 10 0 0 1 14 0"></path>
      <path d="M8.5 16.43a5 5 0 0 1 7 0"></path>
      <line x1="12" y1="20" x2="12.01" y2="20"></line>
      <line x1="3" y1="3" x2="21" y2="21"></line>
    </svg>
    {{ offlineHintText }}
  </div>

  <div v-if="globalError" class="min-h-screen flex flex-col items-center justify-center p-6 text-center z-[10000] relative bg-[#F5F5F7] dark:bg-[#121212]">
    <div class="bg-white dark:bg-[#1C1C1E] p-8 rounded-3xl shadow-2xl max-w-md w-full border border-red-100 dark:border-red-900/30">
      <div class="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h1 class="text-2xl font-black text-gray-900 dark:text-white mb-2">Упс, что-то сломалось</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 font-medium">Произошла непредвиденная ошибка в приложении. Мы уже в курсе проблемы.</p>
      
      <div class="bg-gray-50 dark:bg-black/50 p-4 rounded-xl text-left mb-8 overflow-hidden">
        <p class="text-xs font-mono text-red-600 dark:text-red-400 break-all">{{ globalError.message }}</p>
      </div>

      <button @click="reloadApp" class="w-full bg-[#1d1d1f] dark:bg-white text-white dark:text-black py-4 rounded-full font-bold text-sm tracking-wider uppercase hover:scale-105 active:scale-95 transition-all shadow-xl shadow-black/20">
        Перезагрузить страницу
      </button>
    </div>
  </div>

  <router-view v-else />
</template>

<style>
/* --- ГЛОБАЛЬНЫЕ СТИЛИ --- */

/* Настройки для HTML */
html {
  height: 100%;
  background-color: #F5F5F7; /* Фон по умолчанию (светлый) */
  transition: none; /* Без флика на первом кадре */
}

html.theme-ready {
  transition: background-color 0.2s ease; /* Плавная смена после инициализации */
}

/* Настройки для HTML в темной теме */
html.dark {
  background-color: #121212; /* Фон по умолчанию (темный) */
}

/* Настройки Body */
body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background-color: inherit; /* Наследует цвет от html */
  color: #1d1d1f; /* Цвет текста по умолчанию */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Цвет текста в темной теме */
html.dark body {
  color: #ffffff;
}

/* Убираем синюю подсветку при нажатии на мобильных (iOS/Android) */
* {
  -webkit-tap-highlight-color: transparent;
}

/* Кастомный скроллбар (тонкий и аккуратный) */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

html.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

html.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Анимация появления PWA-уведомления */
.fade-up-enter-active, .fade-up-leave-active {
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-up-enter-from, .fade-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
</style>