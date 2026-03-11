<template>
  <div class="min-h-screen bg-gray-50 dark:bg-[#111113] px-4 py-8 max-w-2xl mx-auto">

    <div class="mb-6">
      <h1 class="text-2xl font-black text-[#1d1d1f] dark:text-white tracking-tight">Архив удалений</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Удалённые данные хранятся до 30 дней, затем удаляются безвозвратно.
      </p>
    </div>

    <!-- Переключатель режима -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="tab in tabs" :key="tab.value"
        @click="mode = tab.value"
        :class="[
          'px-4 h-9 rounded-full text-xs font-black uppercase tracking-wider transition-all',
          mode === tab.value
            ? 'bg-black dark:bg-white text-white dark:text-black shadow'
            : 'bg-white dark:bg-white/5 text-gray-500 hover:text-black dark:hover:text-white border border-gray-200 dark:border-white/10'
        ]"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Загрузка -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-20 rounded-2xl bg-gray-200 dark:bg-white/5 animate-pulse"></div>
    </div>

    <!-- Ошибка -->
    <div v-else-if="error" class="rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 p-6 text-center">
      <p class="text-sm font-bold text-red-600 dark:text-red-400">Ошибка загрузки архива. Проверьте права доступа.</p>
    </div>

    <!-- Пусто -->
    <div v-else-if="!items.length" class="rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-10 text-center">
      <p class="text-sm font-bold text-gray-400 dark:text-gray-500">Архив пуст</p>
    </div>

    <!-- Список -->
    <div v-else class="space-y-3">
      <div
        v-for="item in items" :key="item.id"
        class="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-100 dark:border-white/10 p-4 flex items-start gap-4 shadow-sm"
      >
        <!-- Индикатор срока -->
        <div
          :class="[
            'w-1.5 self-stretch rounded-full shrink-0 mt-1',
            urgencyColor(getDaysLeft(item.restoreUntil))
          ]"
        ></div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="text-xs font-black uppercase tracking-wider text-gray-400">{{ item.type }}</span>
            <span v-if="item.data?.name || item.data?.title" class="text-sm font-bold text-[#1d1d1f] dark:text-white truncate max-w-[200px]">
              {{ item.data?.name || item.data?.title }}
            </span>
          </div>
          <div class="text-[11px] text-gray-400 font-bold space-y-0.5">
            <div v-if="item.deletedAt">Удалено: {{ formatDate(item.deletedAt) }}</div>
            <div v-if="item.restoreUntil">
              <span :class="urgencyText(getDaysLeft(item.restoreUntil))">
                Истекает через {{ getDaysLeft(item.restoreUntil) }} дн.
              </span>
            </div>
          </div>
        </div>

        <!-- Кнопка восстановления -->
        <button
          v-if="canRestore"
          @click="handleRestore(item)"
          :disabled="isRestoring === item.id"
          class="shrink-0 h-9 px-4 rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-black uppercase tracking-wider shadow transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ isRestoring === item.id ? '…' : 'Восстановить' }}
        </button>
      </div>
    </div>

    <!-- Уведомление о результате -->
    <Transition name="toast">
      <div v-if="toast" :class="[
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold text-white',
        toast.ok ? 'bg-green-500' : 'bg-red-500'
      ]">
        {{ toast.message }}
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useArchive } from '@/composables/useArchive';
import { restoreFromArchive } from '@/services/restoreFromArchive';
import { auth } from '@/firebase';
import { useDatabase } from '@/composables/useDatabase';

const { items, loading, error, loadUserArchive, loadGlobalArchive, getDaysLeft } = useArchive();
const { hasPermission } = useDatabase();

const mode = ref<'user' | 'global'>('user');
const isRestoring = ref<string | null>(null);
const toast = ref<{ ok: boolean; message: string } | null>(null);

const canRestore = hasPermission('trash.restore');

const tabs = [
  { value: 'user', label: 'Мой архив' },
  { value: 'global', label: 'Адм. архив' },
];

watch(mode, async () => {
  if (mode.value === 'user') {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await loadUserArchive(uid);
  } else {
    await loadGlobalArchive();
  }
}, { immediate: true });

function formatDate(ts: any) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function urgencyColor(days: number) {
  if (days <= 0) return 'bg-red-500';
  if (days <= 2) return 'bg-orange-400';
  if (days <= 6) return 'bg-yellow-400';
  return 'bg-green-400';
}

function urgencyText(days: number) {
  if (days <= 0) return 'text-red-500 font-black';
  if (days <= 2) return 'text-orange-500 font-black';
  if (days <= 6) return 'text-yellow-600 font-bold';
  return 'text-gray-400';
}

async function handleRestore(item: any) {
  if (isRestoring.value) return;
  isRestoring.value = item.id;
  try {
    await restoreFromArchive({
      scope: mode.value,
      userId: auth.currentUser?.uid ?? '',
      archiveId: item.id,
      type: item.type,
      data: item.data ?? {},
    });
    showToast(true, 'Данные восстановлены');
    // Перезагрузить список
    if (mode.value === 'user') await loadUserArchive(auth.currentUser?.uid ?? '');
    else await loadGlobalArchive();
  } catch (e: any) {
    showToast(false, e?.message || 'Не удалось восстановить');
  } finally {
    isRestoring.value = null;
  }
}

function showToast(ok: boolean, message: string) {
  toast.value = { ok, message };
  setTimeout(() => { toast.value = null; }, 3500);
}
</script>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px); }
</style>

