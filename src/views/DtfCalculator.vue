<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useDatabase } from '@/composables/useDatabase';
import { useHaptics } from '@/composables/useHaptics';
import { PageScrollWrapper } from '@/ui-core';
import AuthLogin from '@/components/AuthLogin.vue';

const router = useRouter();
const { impactLight, impactMedium } = useHaptics();
const { user: currentUser, hasPermission, isOfflineMode } = useDatabase();

const activeTab = ref('queue');
const showAuthModal = ref(false);
const showToast = ref(false);
const toastMessage = ref('');

const canViewHistory = computed(() => hasPermission('canSaveHistory'));
const canViewSettings = computed(() => hasPermission('canViewSettings'));
const canUseCloudSections = computed(() => !isOfflineMode.value);

const sections = [
  {
    id: 'queue',
    title: 'Очередь печати',
    desc: 'Здесь соберём сценарий заказа: макеты, тираж, стороны печати и статусы подготовки.',
    items: ['Размер макета', 'Тираж', 'Количество сторон', 'Тип переноса'],
  },
  {
    id: 'production',
    title: 'Производство',
    desc: 'Позже добавим расчёт DTF-ленты, загрузку рулона, режимы печати и распределение по проходам.',
    items: ['Ширина рулона', 'Раскладка по длине', 'Расход плёнки', 'Время печати'],
  },
  {
    id: 'transfer',
    title: 'Перенос',
    desc: 'Отдельный блок для термопресса, температур, выдержки и технологических напоминаний.',
    items: ['Температура', 'Давление', 'Время', 'Повторный прогрев'],
  },
];

const activeSection = computed(() => sections.find((section) => section.id === activeTab.value) || sections[0]);

const statusConfig = computed(() => {
  if (isOfflineMode.value) {
    return {
      text: 'Офлайн',
      class: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/20',
      dot: 'bg-red-500',
    };
  }

  return {
    text: 'Онлайн',
    class: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300 border-green-100 dark:border-green-500/20',
    dot: 'bg-green-500',
  };
});

const showNotification = (message) => {
  toastMessage.value = message;
  showToast.value = true;
  window.setTimeout(() => {
    showToast.value = false;
  }, 2600);
};
const showOfflineToast = () => {
  showNotification('Офлайн: раздел временно недоступен');
};
const blockCloudAction = (action) => {
  if (!canUseCloudSections.value) {
    showOfflineToast();
    return;
  }
  action();
};

const openSettings = () => {
  blockCloudAction(() => {
    impactLight();
    router.push({ path: '/settings/dtf', query: { from: 'calc', calc: 'dtf' } });
  });
};

const openHistory = () => {
  blockCloudAction(() => {
    impactLight();
    router.push({ path: '/history', query: { from: 'calc', calc: 'dtf' } });
  });
};

const goHome = () => {
  impactLight();
  router.push('/');
};

const requestLogin = () => {
  impactMedium();
  showAuthModal.value = true;
};

const onLoginSuccess = () => {
  showAuthModal.value = false;
  showNotification('Вход выполнен');
};
</script>

<template>
  <div class="h-screen w-full bg-[#F5F5F7] dark:bg-[#121212] overflow-hidden flex flex-col relative transition-colors duration-500">
    <PageScrollWrapper class="flex-1">
      <div class="pb-28 pt-6 min-h-full">
        <div class="max-w-6xl mx-auto px-5 w-full">
          <div class="flex flex-col gap-5 mb-6">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Отдельный калькулятор</p>
                <h1 class="text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none">DTF Печать</h1>
                <p class="mt-3 max-w-2xl text-sm md:text-base font-medium text-gray-500 dark:text-gray-400 leading-relaxed">
                  Новый контур калькулятора с тем же универсальным каркасом, что и у лазерного модуля. Расчётные блоки и логика будут наращиваться поэтапно.
                </p>
              </div>

              <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all self-start lg:self-auto" :class="statusConfig.class">
                <span class="w-2 h-2 rounded-full" :class="statusConfig.dot"></span>{{ statusConfig.text }}
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto_auto] gap-3">
              <button @click="goHome" class="h-14 px-6 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 shadow-sm font-bold text-sm text-gray-700 dark:text-gray-200 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                Меню
              </button>

              <div class="grid grid-cols-3 gap-2 rounded-[1.5rem] border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-2 shadow-sm overflow-x-auto">
                <button
                  v-for="section in sections"
                  :key="section.id"
                  @click="activeTab = section.id"
                  class="h-11 min-w-[150px] rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wide transition-colors"
                  :class="activeTab === section.id ? 'bg-[#1d1d1f] dark:bg-white text-white dark:text-black shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'"
                >
                  {{ section.title }}
                </button>
              </div>

              <button
                v-if="canViewHistory"
                @click="openHistory"
                :disabled="!canUseCloudSections"
                class="h-14 px-5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 shadow-sm font-bold text-sm text-gray-700 dark:text-gray-200 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                История
              </button>

              <button
                v-if="canViewSettings"
                @click="openSettings"
                :disabled="!canUseCloudSections"
                class="h-14 px-5 rounded-2xl bg-[#1d1d1f] dark:bg-white text-white dark:text-black shadow-lg font-bold text-sm hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                Настройки
              </button>

              <button
                v-if="!currentUser"
                @click="requestLogin"
                class="h-14 px-5 rounded-2xl bg-[#1d1d1f] dark:bg-white text-white dark:text-black shadow-lg font-bold text-sm hover:scale-[1.01] active:scale-95 transition-all"
              >
                Войти
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
            <div class="space-y-6">
              <div class="rounded-[2rem] border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-6 md:p-7 shadow-sm">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Активный сценарий</p>
                    <h2 class="text-2xl font-black text-[#1d1d1f] dark:text-white leading-tight">{{ activeSection.title }}</h2>
                    <p class="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400 leading-relaxed max-w-2xl">{{ activeSection.desc }}</p>
                  </div>

                  <div class="hidden md:flex h-14 min-w-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 items-center justify-center shadow-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 11-14h-7l0-6z"/></svg>
                  </div>
                </div>

                <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div v-for="item in activeSection.items" :key="item" class="rounded-2xl border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-4">
                    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Скоро здесь</p>
                    <p class="text-lg font-black text-[#1d1d1f] dark:text-white">{{ item }}</p>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 leading-relaxed">Этот параметр будет вынесен в рабочий сценарий DTF-калькулятора отдельным блоком.</p>
                  </div>
                </div>
              </div>

              <div class="rounded-[2rem] border border-dashed border-gray-200 dark:border-white/10 bg-white/70 dark:bg-white/5 p-6 md:p-7">
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">Следующий этап</p>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div class="rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-4">
                    <h3 class="text-base font-black text-[#1d1d1f] dark:text-white">Раскладка на рулоне</h3>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 leading-relaxed">Сетка полос, длина заказа, технологические зазоры.</p>
                  </div>
                  <div class="rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-4">
                    <h3 class="text-base font-black text-[#1d1d1f] dark:text-white">Термопресс</h3>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 leading-relaxed">Температура, выдержка, давление и повторный прогрев.</p>
                  </div>
                  <div class="rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-4">
                    <h3 class="text-base font-black text-[#1d1d1f] dark:text-white">Финальная себестоимость</h3>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 leading-relaxed">Сводный расчёт по плёнке, чернилам, переносу и трудозатратам.</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-6">
              <div class="rounded-[2rem] border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-6 shadow-sm">
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">Состояние модуля</p>
                <div class="space-y-3">
                  <div class="rounded-2xl bg-gray-50 dark:bg-white/5 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-sm font-black text-[#1d1d1f] dark:text-white">Каркас калькулятора</span>
                      <span class="px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 text-[10px] font-bold uppercase tracking-widest">Готов</span>
                    </div>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">Маршрут, карточка запуска и базовая навигация уже вынесены в отдельный модуль.</p>
                  </div>
                  <div class="rounded-2xl bg-gray-50 dark:bg-white/5 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-sm font-black text-[#1d1d1f] dark:text-white">Расчётная логика</span>
                      <span class="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-widest">Дальше</span>
                    </div>
                    <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">Следующим шагом можно переносить реальные сущности заказа и финансовую формулу.</p>
                  </div>
                </div>
              </div>

              <div class="rounded-[2rem] border border-gray-100 dark:border-white/10 bg-gradient-to-br from-[#1d1d1f] to-black dark:from-white dark:to-gray-200 text-white dark:text-black p-6 shadow-xl">
                <p class="text-[10px] font-bold uppercase tracking-widest text-white/50 dark:text-black/50 mb-2">Настройки DTF</p>
                <h3 class="text-2xl font-black leading-tight">Отдельный контур уже заведён</h3>
                <p class="mt-3 text-sm font-medium text-white/70 dark:text-black/70 leading-relaxed">Можно переходить в самостоятельный экран настроек и постепенно переносить туда карточную логику из лазерного модуля.</p>
                <button
                  v-if="canViewSettings"
                  @click="openSettings"
                  class="mt-5 h-12 px-5 rounded-xl bg-white text-black dark:bg-black dark:text-white font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
                >
                  Открыть настройки DTF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageScrollWrapper>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showToast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl bg-[#1d1d1f] dark:bg-white text-white dark:text-black text-sm font-bold shadow-2xl">
          {{ toastMessage }}
        </div>
      </Transition>
    </Teleport>

    <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @login-success="onLoginSuccess" />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.22s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>