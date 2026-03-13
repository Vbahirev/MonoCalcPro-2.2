<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { PageScrollWrapper } from '@/ui-core'
import ModernSelect from '@/components/ModernSelect.vue'

import { useDatabase } from '@/composables/useDatabase'
import { useHaptics } from '@/composables/useHaptics'
import { buildDeepSearchBlob, matchesSearchBlob } from '@/utils/searchIndex'

const router = useRouter()
const { impactLight, impactMedium, notificationSuccess, notificationError } = useHaptics()

const {
  hasPermission,
  getCloudTrash,
  restoreCloudHistoryFromTrash,
  deleteTrashForever,
  allUsers,
  user,
  userHistory,
  materials,
  coatings,
  processingDB,
  accessoriesDB,
  packagingDB,
  designDB,
  masterPriceCatalog,
  settings,
} = useDatabase()
// ===== UI =====
const btnClass = `
  h-14 
  bg-white dark:bg-[#1C1C1E] 
  rounded-2xl 
  shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] 
  dark:shadow-black/50 
  ring-1 ring-black/5 dark:ring-white/10 
  font-bold text-gray-400 dark:text-gray-500
  transition-all duration-300 ease-out 
  transform-gpu no-flicker
  hover:-translate-y-1 
  hover:text-gray-900 dark:hover:text-white
  hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)]
  dark:hover:shadow-black/70
  hover:ring-black/10 dark:hover:ring-white/20
  active:translate-y-0 active:shadow-sm
  flex items-center relative z-10 hover:z-20
`

const actionBtnClass = `
  bg-[#1d1d1f] dark:bg-white 
  text-white dark:text-black 
  px-5 py-3 
  rounded-full 
  font-bold text-xs uppercase tracking-widest 
  shadow-xl shadow-black/20 
  transition-all duration-300 ease-out 
  transform-gpu
  hover:-translate-y-1 
  hover:shadow-2xl hover:shadow-black/40 
  active:translate-y-0 active:shadow-xl
`
 


// ===== PERMISSIONS =====
const canSeeDeletedSettings = computed(() =>
  hasPermission('canEditGlobalSettings')
)

// ===== STATE =====
const isLoading = ref(true)
const error = ref(null)
const trashItems = ref([])

const searchQuery = ref('')
// Пустое значение = «не выбран фильтр» (placeholder остаётся видимым)
const activeDataType = ref('')
const activePeriod = ref('')
const quickFilter = ref('all')
const selectedPreviewId = ref(null)
const selectedIds = ref([])
const isBulkProcessing = ref(false)

const userDirectory = computed(() => {
  const byId = new Map()
  const byEmail = new Map()

  for (const user of allUsers.value || []) {
    const label = user?.displayName || user?.name || user?.email || user?.id
    if (user?.id) byId.set(String(user.id), label)
    if (user?.uid) byId.set(String(user.uid), label)
    if (user?.email) byEmail.set(String(user.email).toLowerCase(), label)
  }

  return { byId, byEmail }
})

// ===== OPTIONS =====
const dataTypeOptions = computed(() => {
  const base = [
    { id: 'history', label: 'История' },
    { id: 'projects', label: 'Проекты' },
    { id: 'calculators', label: 'Калькуляторы' },
    { id: 'estimates', label: 'Сметы' },
    { id: 'users', label: 'Пользователи' },
  ]
  if (canSeeDeletedSettings.value) base.splice(2, 0, { id: 'settings', label: 'Настройки' })
  return base
})

const periodOptions = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: 'Последние 7 дней' },
  { id: '30d', label: 'Последние 30 дней' },
]

const quickFilterOptions = [
  { id: 'all', label: 'Все записи' },
  { id: 'restorable', label: 'Можно восстановить' },
  { id: 'expiring', label: 'Скоро исчезнут' },
  { id: 'settings', label: 'Только настройки' },
  { id: 'mine', label: 'Удалено мной' },
  { id: 'others', label: 'Удалено другими' },
  { id: 'expired', label: 'Просроченные' },
]

// ===== HELPERS =====
function normalizeTrashItem(raw) {
  return {
    ...raw,
    itemType: raw?.itemType || raw?.type || 'projects',
  }
}

function buildSearchBlob(item) {
  return buildDeepSearchBlob({
    title: itemTitle(item),
    typeLabel: itemTypeLabel(item),
    dataType: item?.dataType,
    deletedAt: formatDeletedAt(item),
    total: item?.total,
    dataTotal: item?.data?.total,
    projectClient: item?.state?.project?.client,
    projectName: item?.state?.project?.name,
    payload: item?.payload,
    state: item?.state,
    data: item?.data,
  }, 3, 60)
}

function prettyJson(item) {
  try {
    return JSON.stringify(item, null, 2)
  } catch {
    return String(item)
  }
}

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase()

const getSettingsCollectionByType = (dataType) => {
  if (dataType === 'materials') return materials.value || []
  if (dataType === 'coatings') return coatings.value || []
  if (dataType === 'processing') return processingDB.value || []
  if (dataType === 'accessories') return accessoriesDB.value || []
  if (dataType === 'packaging') return packagingDB.value || []
  if (dataType === 'design') return designDB.value || []
  if (dataType === 'masterPriceCatalog') return masterPriceCatalog.value || []
  if (dataType === 'settings') return Object.entries(settings.value || {}).map(([id, value]) => ({ id, value }))
  return []
}

const getItemIdentityTokens = (item) => {
  if (!item || typeof item !== 'object') return []
  return [item.id, item.dbId, item.uid, item.name, item.title, item.label, item.materialName]
    .map(normalizeIdentity)
    .filter(Boolean)
}

const getTrashConflict = (item) => {
  if (!item) return { hasConflict: false, reason: '' }

  const itemType = item?.itemType || item?.type

  if (itemType === 'settings') {
    const payload = item?.payload || item?.data?.payload || item?.data
    const current = getSettingsCollectionByType(item?.dataType)
    const payloadTokens = getItemIdentityTokens(payload)
    const conflict = current.some((entry) => {
      const entryTokens = getItemIdentityTokens(entry)
      return payloadTokens.some((token) => entryTokens.includes(token))
    })
    return {
      hasConflict: conflict,
      reason: conflict ? 'В текущих настройках уже есть похожая запись' : '',
    }
  }

  if (itemType === 'history' || itemType === 'projects') {
    const targetId = String(item?.sourceHistoryId || item?.id || '').trim()
    const conflict = Boolean(targetId) && (userHistory.value || []).some((entry) => String(entry?.id || '').trim() === targetId)
    return {
      hasConflict: conflict,
      reason: conflict ? 'В истории уже есть запись с таким же ID' : '',
    }
  }

  return { hasConflict: false, reason: '' }
}

const hasConflict = (item) => getTrashConflict(item).hasConflict

const conflictBadgeClass = (item) => hasConflict(item)
  ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/20'
  : 'bg-slate-50 text-slate-500 border border-slate-200 dark:bg-white/5 dark:text-slate-300 dark:border-white/10'

const isDeletedByCurrentUser = (item) => {
  const currentUid = String(user.value?.uid || '').trim()
  const currentEmail = normalizeIdentity(user.value?.email)
  const deletedByUid = String(item?.deletedBy || item?.deletedByUid || '').trim()
  const deletedByEmail = normalizeIdentity(item?.deletedByEmail)
  if (currentUid && deletedByUid && currentUid === deletedByUid) return true
  if (currentEmail && deletedByEmail && currentEmail === deletedByEmail) return true
  return false
}

// ===== EMPTY STATE =====
const emptyStateText = computed(() => {
  if (!trashItems.value.length) {
    return 'Удалённых данных нет'
  }
  return 'По выбранным фильтрам данные не найдены'
})

const hasActiveFilters = computed(() => (
  Boolean(searchQuery.value || activeDataType.value || activePeriod.value || quickFilter.value !== 'all')
))

const matchesQuickFilter = (item, filterId = quickFilter.value) => {
  if (!item) return false
  if (filterId === 'all') return true
  if (filterId === 'restorable') return canRestore(item)
  if (filterId === 'expiring') {
    const left = calcDaysLeft(item)
    return left > 0 && left <= 3
  }
  if (filterId === 'settings') return (item?.itemType || item?.type) === 'settings'
  if (filterId === 'mine') return isDeletedByCurrentUser(item)
  if (filterId === 'others') return !isDeletedByCurrentUser(item)
  if (filterId === 'expired') return isExpired(item)
  return true
}

const quickFilterCount = (filterId) => trashItems.value.filter((item) => matchesQuickFilter(item, filterId)).length

const dashboardStats = computed(() => {
  const all = trashItems.value
  const restorable = all.filter((item) => canRestore(item)).length
  const expiring = all.filter((item) => {
    const left = calcDaysLeft(item)
    return left > 0 && left <= 3
  }).length
  const settings = all.filter((item) => (item?.itemType || item?.type) === 'settings').length
  const expired = all.filter((item) => isExpired(item)).length

  return [
    { id: 'total', label: 'Всего в корзине', value: all.length, tone: 'neutral' },
    { id: 'restorable', label: 'Можно восстановить', value: restorable, tone: 'safe' },
    { id: 'expiring', label: 'Скоро исчезнут', value: expiring, tone: 'warning' },
    { id: 'settings', label: 'Удалённые настройки', value: settings, tone: 'neutral' },
    { id: 'expired', label: 'Просроченные', value: expired, tone: 'danger' },
  ]
})

const filteredStateHint = computed(() => {
  const total = filteredItems.value.length
  if (!trashItems.value.length) return 'Корзина пуста. Новые удаления будут появляться здесь автоматически.'
  if (!hasActiveFilters.value) return `Показаны все доступные записи: ${total}. Выберите карточку справа для подробного разбора.`
  return `Найдено ${total} записей по текущим условиям. Можно быстро сузить выбор через режимы выше.`
})

// ===== FILTERING =====
const filteredItems = computed(() => {
  const now = Date.now()

  const matchesPeriod = (item) => {
    if (!activePeriod.value) return true
    const ms = new Date(item.deletedAtISO || item.savedAt).getTime()
    if (!ms) return false
    if (activePeriod.value === 'today') {
      return new Date(ms).toDateString() === new Date(now).toDateString()
    }
    if (activePeriod.value === '7d') return ms >= now - 7 * 86400000
    if (activePeriod.value === '30d') return ms >= now - 30 * 86400000
    return true
  }

  return trashItems.value.filter((item) => {
    if (activeDataType.value && item.itemType !== activeDataType.value) {
      return false
    }
    if (!matchesPeriod(item)) return false
    if (!matchesQuickFilter(item)) return false
    return matchesSearchBlob(buildSearchBlob(item), searchQuery.value)
  })
})

const activePreviewItem = computed(() => (
  filteredItems.value.find((item) => item.id === selectedPreviewId.value) || filteredItems.value[0] || null
))

const selectedItems = computed(() => {
  const ids = new Set(selectedIds.value)
  return filteredItems.value.filter((item) => ids.has(item.id))
})

const selectedRestorableItems = computed(() => selectedItems.value.filter((item) => canRestore(item)))
const selectedExpiredItems = computed(() => selectedItems.value.filter((item) => isExpired(item)))
const hasSelectedItems = computed(() => selectedItems.value.length > 0)
const areAllFilteredSelected = computed(() => (
  filteredItems.value.length > 0 && filteredItems.value.every((item) => selectedIds.value.includes(item.id))
))

// ===== API =====
const loadTrash = async () => {
  isLoading.value = true
  error.value = null
  try {
    const data = await getCloudTrash()
    const normalized = Array.isArray(data)
      ? data.map(normalizeTrashItem)
      : []
    trashItems.value = canSeeDeletedSettings.value
      ? normalized
      : normalized.filter((item) => (item?.itemType || item?.type) !== 'settings')
    selectedIds.value = selectedIds.value.filter((id) => trashItems.value.some((item) => item.id === id))
    if (!selectedPreviewId.value && trashItems.value.length) {
      selectedPreviewId.value = trashItems.value[0].id
    }
  } catch (e) {
    error.value = e?.message || 'Ошибка загрузки'
    trashItems.value = []
    selectedPreviewId.value = null
    selectedIds.value = []
  } finally {
    isLoading.value = false
  }
}

const goBack = () => {
  impactLight()
  router.push('/settings')
}

const resetFilters = () => {
  searchQuery.value = ''
  activeDataType.value = ''
  activePeriod.value = ''
  quickFilter.value = 'all'
}

const selectItem = (item) => {
  selectedPreviewId.value = item?.id || null
}

const isSelected = (item) => selectedIds.value.includes(item?.id)

const toggleSelectedItem = (item) => {
  if (!item?.id) return
  if (isSelected(item)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== item.id)
    return
  }
  selectedIds.value = [...selectedIds.value, item.id]
}

const clearSelection = () => {
  selectedIds.value = []
}

const toggleSelectAllFiltered = () => {
  if (areAllFilteredSelected.value) {
    clearSelection()
    return
  }
  selectedIds.value = filteredItems.value.map((item) => item.id)
}


const getPurgeMs = (item) => {
  // Supports multiple schemas: purgeAt (Timestamp), restoreUntil (Timestamp), expiresAtISO (string)
  const ts = item?.purgeAt || item?.restoreUntil
  if (ts?.toDate) return ts.toDate().getTime()
  const iso = item?.expiresAtISO || item?.purgeAtISO || item?.restoreUntilISO
  if (iso) {
    const ms = new Date(iso).getTime()
    return Number.isFinite(ms) ? ms : 0
  }
  // fallback: deletedAt + 30d
  const delIso = item?.deletedAtISO
  const delMs = delIso ? new Date(delIso).getTime() : 0
  return delMs ? delMs + 30 * 86400000 : 0
}

const getDeletedMs = (item) => {
  const ts = item?.deletedAt
  if (ts?.toDate) return ts.toDate().getTime()
  const iso = item?.deletedAtISO || item?.savedAt
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

const calcDaysLeft = (item) => {
  const end = getPurgeMs(item)
  if (!end) return 0
  const now = Date.now()
  return Math.max(0, Math.ceil((end - now) / 86400000))
}

const isExpired = (item) => {
  const end = getPurgeMs(item)
  return end ? end <= Date.now() : false
}

const canRestore = (item) => {
  if (!item) return false
  if (isExpired(item)) return false

  // settings restore is privileged
  if (item.itemType === 'settings' || item.type === 'settings') {
    return hasPermission('canEditGlobalSettings')
  }

  // history/projects restore — same gate as history write
  return hasPermission('canSaveHistory') || hasPermission('history.write')
}

const itemStatusLabel = (item) => {
  const left = calcDaysLeft(item)
  if (left <= 0) return 'Истёк срок хранения'
  if (left === 1) return 'Удалится завтра'
  if (left <= 3) return `Удалится через ${left} дн.`
  return `Осталось ${left} дн.`
}

const statusBadgeClass = (item) => {
  const variant = statusClass(daysLeft(item))
  if (variant === 'danger') return 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20'
  if (variant === 'urgent') return 'bg-orange-50 text-orange-600 border border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20'
  if (variant === 'warning') return 'bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-200 dark:border-yellow-500/20'
  return 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/20'
}

const itemScopeLabel = (item) => {
  const type = item?.itemType || item?.type
  return type === 'settings' ? 'Глобальный контур' : 'Личный контур'
}

const restoreTargetLabel = (item) => {
  const type = item?.itemType || item?.type
  if (type === 'settings') return 'Вернётся в глобальные настройки'
  if (type === 'users') return 'Вернётся в список пользователей'
  return 'Вернётся в историю пользователя'
}

const deletedByLabel = (item) => {
  const rawId = item?.deletedBy || item?.deletedByUid
  const rawEmail = item?.deletedByEmail

  if (rawEmail) {
    const fromEmail = userDirectory.value.byEmail.get(String(rawEmail).toLowerCase())
    if (fromEmail) return fromEmail
  }

  if (rawId) {
    const fromId = userDirectory.value.byId.get(String(rawId))
    if (fromId) return fromId
  }

  return rawEmail || rawId || 'Не указано'
}

const buildPreviewFacts = (item) => {
  if (!item) return []
  return [
    { label: 'Тип записи', value: itemTypeLabel(item) },
    { label: 'Контур', value: itemScopeLabel(item) },
    { label: 'Удалено', value: formatDeletedAt(item) },
    { label: 'Статус', value: itemStatusLabel(item) },
    { label: 'Конфликт', value: hasConflict(item) ? getTrashConflict(item).reason : 'Конфликтов не найдено' },
    { label: 'Куда восстановится', value: restoreTargetLabel(item) },
    { label: 'Удалил', value: deletedByLabel(item) },
    item?.dataType ? { label: 'Раздел', value: settingsDataTypeLabel(item.dataType) } : null,
  ].filter(Boolean)
}

const copyItemJson = async (item) => {
  try {
    if (!navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(prettyJson(item))
    showToast('JSON записи скопирован', 'ok')
  } catch (e) {
    showToast('Не удалось скопировать JSON', 'danger')
  }
}

const deleteForeverItem = (item) => {
  if (!item) return
  impactMedium()
  openModal({
    title: 'Удалить из корзины навсегда',
    text: 'Запись будет удалена безвозвратно. После этого восстановить её уже нельзя.',
    details: [
      `Что: ${itemTitle(item)}`,
      `Тип: ${itemTypeLabel(item)}`,
      `Статус: ${itemStatusLabel(item)}`,
    ],
    confirmText: 'УДАЛИТЬ НАВСЕГДА',
    confirmKind: 'danger',
    lockMs: 1200,
    action: async () => {
      const res = await deleteTrashEntryForever(item)
      notificationSuccess?.(res?.message || 'Удалено навсегда')
      showToast(res?.message || 'Удалено навсегда', 'ok')
      if (selectedPreviewId.value === item.id) selectedPreviewId.value = null
      await loadTrash()
    },
  })
}

const runBulkAction = async ({ items, handler, successLabel, errorLabel }) => {
  if (!items.length || isBulkProcessing.value) return

  isBulkProcessing.value = true
  let successCount = 0
  let failureCount = 0

  for (const item of items) {
    try {
      await handler(item)
      successCount += 1
    } catch (e) {
      failureCount += 1
    }
  }

  await loadTrash()
  selectedIds.value = selectedIds.value.filter((id) => filteredItems.value.some((item) => item.id === id))
  if (!selectedIds.value.length && filteredItems.value.length) {
    selectedPreviewId.value = filteredItems.value[0].id
  }

  isBulkProcessing.value = false

  if (successCount) {
    const message = failureCount
      ? `${successLabel}: ${successCount}. Ошибок: ${failureCount}.`
      : `${successLabel}: ${successCount}.`
    notificationSuccess?.(message)
    showToast(message, failureCount ? 'info' : 'ok')
  } else {
    const message = errorLabel || 'Не удалось выполнить массовую операцию'
    notificationError?.(message)
    showToast(message, 'danger')
  }
}

const restoreSelectedItems = () => {
  const items = selectedRestorableItems.value
  if (!items.length) {
    showToast('Нет выбранных записей, доступных для восстановления', 'danger')
    return
  }

  const conflictingItems = items.filter((item) => hasConflict(item))

  openModal({
    title: 'Восстановить выбранные записи',
    text: conflictingItems.length
      ? 'Среди выбранных записей есть конфликты. Можно восстановить стандартно или в безопасном режиме, где конфликтные записи будут созданы как копии.'
      : 'Все выбранные восстановимые записи будут возвращены из корзины. Остальные останутся без изменений.',
    details: [
      `Выбрано: ${selectedItems.value.length}`,
      `Будет восстановлено: ${items.length}`,
      ...(conflictingItems.length ? [`Конфликтных записей: ${conflictingItems.length}`] : []),
    ],
    confirmText: 'ВОССТАНОВИТЬ ВЫБРАННОЕ',
    confirmKind: 'ok',
    secondaryText: conflictingItems.length ? 'БЕЗОПАСНЫЙ РЕЖИМ' : '',
    secondaryKind: 'copy',
    lockMs: 900,
    action: async () => {
      await runBulkAction({
        items,
        handler: (item) => restoreTrashEntry(item),
        successLabel: 'Восстановлено записей',
        errorLabel: 'Не удалось восстановить выбранные записи',
      })
      clearSelection()
    },
    secondaryAction: conflictingItems.length ? async () => {
      await runBulkAction({
        items,
        handler: (item) => restoreTrashEntry(item, null, hasConflict(item) ? { mode: 'copy' } : {}),
        successLabel: 'Безопасно восстановлено записей',
        errorLabel: 'Не удалось безопасно восстановить выбранные записи',
      })
      clearSelection()
    } : null,
  })
}

const deleteSelectedForever = () => {
  const items = selectedItems.value
  if (!items.length) {
    showToast('Нет выбранных записей для удаления', 'danger')
    return
  }

  openModal({
    title: 'Удалить выбранные записи навсегда',
    text: 'Все выбранные записи будут удалены из корзины без возможности восстановления.',
    details: [
      `Выбрано: ${items.length}`,
      `Просроченных среди них: ${selectedExpiredItems.value.length}`,
    ],
    confirmText: 'УДАЛИТЬ ВЫБРАННОЕ',
    confirmKind: 'danger',
    lockMs: 1200,
    action: async () => {
      await runBulkAction({
        items,
        handler: (item) => deleteTrashEntryForever(item),
        successLabel: 'Удалено записей',
        errorLabel: 'Не удалось удалить выбранные записи',
      })
      clearSelection()
    },
  })
}

const purgeExpiredItems = () => {
  const expiredItems = filteredItems.value.filter((item) => isExpired(item))
  if (!expiredItems.length) {
    showToast('В текущем списке нет просроченных записей', 'info')
    return
  }

  openModal({
    title: 'Очистить просроченные записи',
    text: 'Из корзины будут удалены все просроченные записи из текущего списка.',
    details: [
      `К удалению: ${expiredItems.length}`,
    ],
    confirmText: 'ОЧИСТИТЬ ПРОСРОЧЕННЫЕ',
    confirmKind: 'danger',
    lockMs: 1200,
    action: async () => {
      await runBulkAction({
        items: expiredItems,
        handler: (item) => deleteTrashEntryForever(item),
        successLabel: 'Просроченных удалено',
        errorLabel: 'Не удалось очистить просроченные записи',
      })
    },
  })
}

// ===== DESTINATION MODAL (Step 6 / Modal #2) =====
const destModal = ref({
  open: false,
  title: '',
  text: '',
  options: [],
  selected: null,
  item: null,
  locked: false,
  onConfirm: null,
})

const closeDestModal = () => {
  destModal.value.open = false
  destModal.value.item = null
  destModal.value.options = []
  destModal.value.selected = null
  destModal.value.locked = false
  destModal.value.onConfirm = null
}

const openDestModal = ({ item, title, text, options, onConfirm = null }) => {
  destModal.value = {
    open: true,
    title,
    text,
    options,
    selected: options?.[0]?.id ?? null,
    item,
    locked: false,
    onConfirm,
  }
}

const restoreTrashEntry = async (item, destination = null, options = {}) => {
  const res = await restoreCloudHistoryFromTrash(item.id, { destination, ...options })
  if (res?.status !== 'success') throw new Error(res?.message || 'Ошибка восстановления')
  return res
}

const deleteTrashEntryForever = async (item) => {
  const res = await deleteTrashForever(item.id)
  if (res?.status !== 'success') throw new Error(res?.message || 'Не удалось удалить запись навсегда')
  return res
}

const needsDestination = (item) => {
  // Для текущих типов (history/projects/settings) назначения не требуется.
  // Хук оставлен на будущее расширение (README Step 6).
  return Array.isArray(item?.destinations) && item.destinations.length > 0
}

const performRestore = async (item, destination = null) => {
  const res = await restoreTrashEntry(item, destination)
  notificationSuccess?.(res?.message || 'Восстановлено')
  await loadTrash()
}

const performRestoreAsCopy = async (item, destination = null) => {
  const res = await restoreTrashEntry(item, destination, { mode: 'copy' })
  notificationSuccess?.(res?.message || 'Восстановлено как копия')
  await loadTrash()
}

const restoreItem = async (item) => {
  if (!canRestore(item)) {
    notificationError?.('Нет прав или срок хранения истёк')
    return
  }

  const delMs = getDeletedMs(item)
  const delStr = delMs ? new Date(delMs).toLocaleString() : '—'
  const dleft = calcDaysLeft(item)
  const conflict = getTrashConflict(item)

  impactMedium()

  openModal({
    title: 'Подтверждение восстановления',
    text: conflict.hasConflict
      ? 'Найдён конфликт с уже существующими данными. Можно восстановить запись поверх существующей или создать безопасную копию.'
      : 'Вы собираетесь восстановить удалённые данные. После восстановления запись исчезнет из архива.',
    details: [
      `Что: ${itemTitle(item)}`,
      `Модуль: ${(item?.type || item?.itemType || '—')}`,
      `Удалено: ${delStr}`,
      `Осталось: ${dleft} дн.`,
      ...(conflict.hasConflict ? [`Конфликт: ${conflict.reason}`] : []),
    ],
    confirmText: conflict.hasConflict ? 'ВОССТАНОВИТЬ ПОВЕРХ' : 'ПРОДОЛЖИТЬ',
    confirmKind: 'ok',
    secondaryText: conflict.hasConflict ? 'ВОССТАНОВИТЬ КАК КОПИЮ' : '',
    secondaryKind: 'copy',
    lockMs: 900,
    action: async () => {
      // Modal #2 — если потребуется назначение
      if (needsDestination(item)) {
        openDestModal({
          item,
          title: 'Куда восстановить',
          text: 'Выберите назначение восстановления. Недоступные варианты скрыты правами доступа.',
          options: item.destinations,
          onConfirm: async (destination) => {
            await performRestore(item, destination)
          },
        })
        return
      }
      await performRestore(item)
    },
    secondaryAction: conflict.hasConflict ? async () => {
      if (needsDestination(item)) {
        openDestModal({
          item,
          title: 'Куда восстановить как копию',
          text: 'Выберите назначение восстановления копии. Исходная удалённая запись будет удалена из корзины после успешного восстановления.',
          options: item.destinations,
          onConfirm: async (destination) => {
            await performRestoreAsCopy(item, destination)
          },
        })
        return
      }
      await performRestoreAsCopy(item)
    } : null,
  })
}



// ===== TOAST (fallback, always visible) =====
const toast = ref(null)
let toastTimer = null
const showToast = (message, type = 'info') => {
  toast.value = { message, type, ts: Date.now() }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2600)
}

// ===== CONFIRM MODAL =====
const modal = ref({
  open: false,
  title: '',
  text: '',
  details: [],
  confirmText: '',
  confirmKind: 'ok', // ok | danger
  secondaryText: '',
  secondaryKind: 'neutral',
  locked: false,
  action: null,
  secondaryAction: null,
})

const closeModal = () => {
  modal.value.open = false
  modal.value.locked = false
  modal.value.action = null
  modal.value.secondaryAction = null
}

const openModal = ({ title, text, details = [], confirmText, confirmKind = 'ok', secondaryText = '', secondaryKind = 'neutral', lockMs = 0, action, secondaryAction = null }) => {
  modal.value = { open: true, title, text, details, confirmText, confirmKind, secondaryText, secondaryKind, locked: lockMs > 0, action, secondaryAction }
  if (lockMs > 0) {
    setTimeout(() => {
      if (modal.value.open) modal.value.locked = false
    }, lockMs)
  }
}

const runModalAction = async (handler) => {
  if (modal.value.locked) return
  try {
    await handler?.()
    closeModal()
  } catch (e) {
    const message = e?.message || 'Не удалось выполнить действие'
    notificationError?.(message)
    showToast(message, 'danger')
  }
}

const confirmModal = async () => {
  await runModalAction(modal.value.action)
}

const confirmSecondaryModal = async () => {
  await runModalAction(modal.value.secondaryAction)
}

// ===== GROUPING (default view) =====
const typeLabels = {
  history: 'История',
  projects: 'Проекты',
  calculators: 'Калькуляторы',
  settings: 'Настройки',
  estimates: 'Сметы',
  users: 'Пользователи',
}

const openedGroups = ref({
  history: true,
  projects: true,
  calculators: true,
  settings: true,
  estimates: true,
  users: true,
  other: true,
})

const groupedItems = computed(() => {
  const groups = {
    history: [],
    projects: [],
    calculators: [],
    settings: [],
    estimates: [],
    users: [],
    other: [],
  }
  for (const x of filteredItems.value) {
    const k = (x?.itemType || x?.type || 'other')
    if (groups[k]) groups[k].push(x)
    else groups.other.push(x)
  }
  return groups
})

const visibleGroups = computed(() => {
  return Object.entries(groupedItems.value)
    .filter(([, list]) => list.length)
    .map(([key, items]) => ({ key, items }))
})

const isDefaultBrowseMode = computed(() =>
  !searchQuery.value && !activeDataType.value && !activePeriod.value && quickFilter.value === 'all'
)

const statCardClass = (tone) => {
  if (tone === 'safe') return 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-200'
  if (tone === 'warning') return 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/20 dark:text-orange-200'
  if (tone === 'danger') return 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-200'
  return 'bg-white border-gray-200 text-[#1d1d1f] dark:bg-[#1C1C1E] dark:border-white/10 dark:text-white'
}

// ===== HUMAN SUMMARY (UI) =====
const settingsDataTypeLabel = (key) => {
  const map = {
    materials: 'Материалы',
    coatings: 'Покрытия',
    processing: 'Пост-обработка',
    accessories: 'Аксессуары',
    packaging: 'Упаковка',
    design: 'Дизайн',
    settings: 'Параметры',
  }
  return map[key] || (key ? String(key) : 'Настройки')
}

const pickTotal = (item) => {
  const candidates = [
    item?.total,
    item?.data?.total,
    item?.state?.project?.total,
    item?.state?.totals?.total,
  ]
  for (const x of candidates) {
    const n = typeof x === 'string' ? Number(x) : x
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n
  }
  return 0
}

const fmtMoney = (n) => {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v <= 0) return ''
  return `${Math.round(v).toLocaleString('ru-RU')} ₽`
}

const collectNames = (arr) => {
  if (!Array.isArray(arr)) return []
  const keys = ['name', 'title', 'materialName', 'material', 'label']
  const out = []
  for (const x of arr) {
    if (!x) continue
    if (typeof x === 'string') out.push(x)
    else if (typeof x === 'object') {
      for (const k of keys) {
        if (x?.[k]) {
          out.push(String(x[k]))
          break
        }
      }
    }
    if (out.length >= 6) break
  }
  return Array.from(new Set(out.map((s) => String(s).trim()).filter(Boolean)))
}

const describeItem = (item) => {
  const t = item?.itemType || item?.type

  // Settings (удалённые элементы настроек)
  if (t === 'settings') {
    const section = settingsDataTypeLabel(item?.dataType)
    const title = itemTitle(item)
    const lines = [
      `Раздел: ${section}`,
      `Источник: Глобальные настройки`,
    ]
    if (title && title !== '—') lines.unshift(`Элемент: ${title}`)
    return {
      subtitle: 'Настройки проекта (временное хранение после удаления)',
      lines,
    }
  }

  // Projects (история/проекты)
  if (t === 'projects' || t === 'history') {
    const total = pickTotal(item)
    const client = item?.state?.project?.client || item?.client
    const layers = collectNames(item?.state?.layers)
    const proc = collectNames(item?.state?.processing)
    const lines = []
    if (total) lines.push(`Сумма: ${fmtMoney(total)}`)
    if (client) lines.push(`Клиент: ${client}`)
    if (layers.length) lines.push(`Материалы/слои: ${layers.join(', ')}`)
    if (proc.length) lines.push(`Работы: ${proc.join(', ')}`)
    return {
      subtitle: 'Проект со сметой и параметрами расчёта',
      lines,
    }
  }

  // Calculators / Estimates (на будущее, но уже красиво)
  if (t === 'calculators') {
    return {
      subtitle: 'Калькулятор или модуль расчёта',
      lines: [`Название: ${itemTitle(item)}`].filter(Boolean),
    }
  }

  if (t === 'estimates') {
    const total = pickTotal(item)
    const lines = []
    if (total) lines.push(`Сумма: ${fmtMoney(total)}`)
    return {
      subtitle: 'Смета / расчёт',
      lines,
    }
  }

  return {
    subtitle: 'Удалённые данные (временное хранение)',
    lines: [],
  }
}

const daysLeft = (item) => calcDaysLeft(item)

const statusClass = (n) => {
  if (n === 0) return 'danger'
  if (n <= 2) return 'urgent'
  if (n <= 6) return 'warning'
  return 'safe'
}

const itemTitle = (item) => {
  // Главное — название. Если нет, ставим прочерк.
  return (
    item?.name ||
    item?.title ||
    item?.data?.name ||
    item?.data?.title ||
    item?.data?.projectName ||
    item?.data?.projectTitle ||
    item?.data?.calculatorName ||
    item?.data?.scope ||
    '—'
  )
}

const itemTypeLabel = (item) => {
  const t = item?.itemType || item?.type
  const map = {
    settings: 'НАСТРОЙКИ',
    projects: 'ПРОЕКТ',
    calculators: 'КАЛЬКУЛЯТОР',
    estimates: 'СМЕТА',
    history: 'ИСТОРИЯ',
    users: 'ПОЛЬЗОВАТЕЛЬ',
  }
  return (map[t] || String(t || 'ДАННЫЕ')).toUpperCase()
}

const formatDeletedAt = (item) => {
  const ms = getDeletedMs(item)
  if (!ms) return '—'
  // формат ближе к "Истории": DD.MM.YYYY · HH:MM
  const d = new Date(ms)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} · ${hh}:${min}`
}


onMounted(loadTrash)
</script>

<template>
  <div class="h-screen w-full bg-[#F5F5F7] dark:bg-[#121212] overflow-hidden flex flex-col transition-colors duration-500">
    <PageScrollWrapper class="flex-1">
      <div class="pb-32 pt-6 min-h-full flex flex-col w-full">
        <div class="max-w-5xl mx-auto px-5 w-full">

          
          <!-- HEADER (как в Истории) -->
          <div class="mb-6">
            <h1 class="text-center text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tight">
              Корзина удалённых данных
            </h1>
            <p class="text-center mt-2 text-sm text-gray-500 dark:text-gray-400 font-semibold opacity-80">
              Здесь временно хранятся удалённые данные. Раздел помогает быстро понять, что было удалено, сколько осталось до очистки и что можно безопасно восстановить.
            </p>
          </div>

          <!-- TOOLBAR (Назад • Поиск • Фильтры) -->
          <div class="relative flex flex-col sm:flex-row gap-4 w-full mb-6 z-40 items-center">
            <button @click="goBack" :class="[btnClass, 'px-6 justify-center gap-2 shrink-0 w-full sm:w-auto']">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              <span class="font-bold text-sm">Меню</span>
            </button>

            <div class="relative flex-1 group w-full" :class="btnClass">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg class="text-inherit transition-colors duration-300" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
              <input
                v-model="searchQuery"
                class="block w-full h-full pl-12 pr-12 bg-transparent rounded-2xl text-sm font-bold outline-none text-inherit placeholder-gray-400/70 transition-colors cursor-text"
                placeholder="Поиск по названию, сумме, материалам, дате…"
              >
              <button v-if="searchQuery" @click="searchQuery=''" class="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-black dark:hover:text-white cursor-pointer z-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <ModernSelect
              v-model="activeDataType"
              :options="dataTypeOptions"
              :class="btnClass"
              class="sm:w-auto w-full px-0"
              placeholder="Тип данных"
            />

            <ModernSelect
              v-model="activePeriod"
              :options="periodOptions"
              :class="btnClass"
              class="sm:w-auto w-full px-0"
              placeholder="Период удаления"
            />
          </div>

          <div class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-5">
            <div
              v-for="stat in dashboardStats"
              :key="stat.id"
              class="rounded-3xl border p-4 shadow-sm"
              :class="statCardClass(stat.tone)"
            >
              <div class="text-[11px] uppercase tracking-[0.18em] font-black opacity-70">
                {{ stat.label }}
              </div>
              <div class="mt-2 text-2xl md:text-3xl font-black tracking-tight">
                {{ stat.value }}
              </div>
            </div>
          </div>

          <div class="rounded-[2rem] bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-4 md:p-5 shadow-sm mb-6">
            <div class="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div>
                <div class="text-[11px] uppercase tracking-[0.22em] font-black text-gray-400 dark:text-gray-500">Рабочие режимы</div>
                <div class="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Быстро переключайте список между срочными, восстановимыми и просроченными записями.
                </div>
              </div>
              <button
                v-if="hasActiveFilters"
                class="h-11 px-4 rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                @click="resetFilters"
              >
                Сбросить фильтры
              </button>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <button
                v-for="filter in quickFilterOptions"
                :key="filter.id"
                class="inline-flex items-center gap-2 px-4 h-11 rounded-2xl border text-xs font-black uppercase tracking-widest transition-all"
                :class="quickFilter === filter.id
                  ? 'bg-[#1d1d1f] dark:bg-white text-white dark:text-black border-transparent shadow-lg'
                  : 'bg-[#F5F5F7] dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:text-[#1d1d1f] dark:hover:text-white'"
                @click="quickFilter = filter.id"
              >
                <span>{{ filter.label }}</span>
                <span class="px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[10px] leading-none">
                  {{ quickFilterCount(filter.id) }}
                </span>
              </button>
            </div>

            <p class="mt-4 text-sm font-semibold text-gray-500 dark:text-gray-400">
              {{ filteredStateHint }}
            </p>

            <div class="mt-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between rounded-3xl bg-[#F5F5F7] dark:bg-white/5 border border-black/5 dark:border-white/10 p-3">
              <div class="flex flex-wrap gap-2">
                <button
                  class="h-11 px-4 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                  @click="toggleSelectAllFiltered"
                  :disabled="!filteredItems.length"
                >
                  {{ areAllFilteredSelected ? 'Снять выделение' : 'Выбрать всё в списке' }}
                </button>
                <button
                  class="h-11 px-4 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                  @click="clearSelection"
                  :disabled="!hasSelectedItems"
                >
                  Очистить выбор
                </button>
                <button
                  class="h-11 px-4 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                  @click="purgeExpiredItems"
                  :disabled="isBulkProcessing"
                >
                  Очистить просроченные
                </button>
              </div>

              <div class="flex flex-wrap gap-2 lg:justify-end">
                <div class="inline-flex items-center px-4 h-11 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Выбрано: {{ selectedItems.length }}
                </div>
                <button
                  :class="actionBtnClass"
                  @click="restoreSelectedItems"
                  :disabled="!selectedRestorableItems.length || isBulkProcessing"
                >
                  Восстановить выбранные
                </button>
                <button
                  class="h-11 px-4 rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 font-bold text-xs uppercase tracking-widest border border-red-100 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="deleteSelectedForever"
                  :disabled="!hasSelectedItems || isBulkProcessing"
                >
                  Удалить выбранные
                </button>
              </div>
            </div>
          </div>

          <!-- CONTENT -->
          <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_360px] gap-6 items-start">
            <div>
              <div v-if="isLoading" class="rounded-[2rem] bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 py-16 text-center text-gray-400 font-bold shadow-sm">
                Загрузка…
              </div>

              <div v-else-if="error" class="rounded-[2rem] bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 py-16 text-center text-red-500 font-bold shadow-sm px-6">
                {{ error }}
              </div>

              <div v-else-if="!filteredItems.length" class="rounded-[2rem] bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 py-16 text-center text-gray-400 font-bold shadow-sm px-6">
                {{ emptyStateText }}
              </div>

              <div v-else-if="isDefaultBrowseMode" class="space-y-3">
                <div v-for="group in visibleGroups" :key="group.key" class="rounded-3xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 overflow-hidden shadow-sm">
                  <button
                    class="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    @click="openedGroups[group.key] = !openedGroups[group.key]"
                  >
                    <div class="font-black text-[#1d1d1f] dark:text-white text-base flex-1">
                      {{ typeLabels[group.key] || 'Другое' }}
                    </div>
                    <div class="text-[10px] font-black px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                      {{ group.items.length }}
                    </div>
                    <div class="text-gray-400 transition-transform duration-200" :class="openedGroups[group.key] ? 'rotate-180' : ''">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                  </button>

                  <div v-if="openedGroups[group.key]" class="p-4 grid grid-cols-1 gap-4">
                    <div
                      v-for="item in group.items"
                      :key="item.id"
                      class="p-5 rounded-3xl bg-white dark:bg-[#1C1C1E] shadow-[0_10px_30px_-15px_rgba(0,0,0,0.35)] border border-black/5 dark:border-white/10 transition-all"
                      :class="[
                        statusClass(daysLeft(item)),
                        activePreviewItem?.id === item.id ? 'ring-2 ring-black/10 dark:ring-white/20' : '',
                        isSelected(item) ? 'trash-selected' : '',
                      ]"
                    >
                      <div class="flex items-start justify-between gap-4">
                        <div class="flex flex-col gap-3 min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <button
                              class="selection-chip"
                              :class="isSelected(item) ? 'selection-chip--active' : ''"
                              @click="toggleSelectedItem(item)"
                            >
                              {{ isSelected(item) ? 'Выбрано' : 'Выбрать' }}
                            </button>
                            <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                              {{ itemTypeLabel(item) }}
                            </span>
                            <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase" :class="statusBadgeClass(item)">
                              {{ itemStatusLabel(item) }}
                            </span>
                            <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase" :class="conflictBadgeClass(item)">
                              {{ hasConflict(item) ? 'Конфликт' : 'Без конфликта' }}
                            </span>
                          </div>

                          <div class="text-base font-black text-[#1d1d1f] dark:text-white truncate">
                            {{ itemTitle(item) }}
                          </div>

                          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
                            <div>Удалено: {{ formatDeletedAt(item) }}</div>
                            <div>Контур: {{ itemScopeLabel(item) }}</div>
                            <div>Назначение: {{ restoreTargetLabel(item) }}</div>
                            <div>Удалил: {{ deletedByLabel(item) }}</div>
                          </div>

                          <div class="text-xs text-gray-500 dark:text-gray-400 font-semibold opacity-90">
                            {{ describeItem(item).subtitle }}
                          </div>

                          <div v-if="describeItem(item).lines?.length" class="flex flex-wrap gap-2">
                            <span v-for="l in describeItem(item).lines" :key="l" class="inline-flex items-center px-3 py-1 rounded-full bg-[#F5F5F7] dark:bg-white/5 text-[11px] font-bold text-gray-600 dark:text-gray-300">
                              {{ l }}
                            </span>
                          </div>
                        </div>

                        <div class="flex flex-col gap-2 shrink-0">
                          <button class="h-11 px-4 rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-colors" @click="selectItem(item)">
                            Подробнее
                          </button>
                          <button :class="actionBtnClass" @click="restoreItem(item)" :disabled="!canRestore(item)">
                            Восстановить
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="grid grid-cols-1 gap-4">
                <div
                  v-for="item in filteredItems"
                  :key="item.id"
                  class="p-5 rounded-3xl bg-white dark:bg-[#1C1C1E] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.35)] border border-black/5 dark:border-white/10 relative overflow-hidden transition-all"
                  :class="[
                    statusClass(daysLeft(item)),
                    activePreviewItem?.id === item.id ? 'ring-2 ring-black/10 dark:ring-white/20' : '',
                    isSelected(item) ? 'trash-selected' : '',
                  ]"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex flex-col gap-3 min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          class="selection-chip"
                          :class="isSelected(item) ? 'selection-chip--active' : ''"
                          @click="toggleSelectedItem(item)"
                        >
                          {{ isSelected(item) ? 'Выбрано' : 'Выбрать' }}
                        </button>
                        <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                          {{ itemTypeLabel(item) }}
                        </span>
                        <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase" :class="statusBadgeClass(item)">
                          {{ itemStatusLabel(item) }}
                        </span>
                        <span class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase" :class="conflictBadgeClass(item)">
                          {{ hasConflict(item) ? 'Конфликт' : 'Без конфликта' }}
                        </span>
                      </div>

                      <div class="text-base font-black text-[#1d1d1f] dark:text-white truncate">
                        {{ itemTitle(item) }}
                      </div>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
                        <div>Удалено: {{ formatDeletedAt(item) }}</div>
                        <div>Контур: {{ itemScopeLabel(item) }}</div>
                        <div>Назначение: {{ restoreTargetLabel(item) }}</div>
                        <div>Удалил: {{ deletedByLabel(item) }}</div>
                      </div>

                      <div class="text-xs text-gray-500 dark:text-gray-400 font-semibold opacity-90">
                        {{ describeItem(item).subtitle }}
                      </div>

                      <div v-if="describeItem(item).lines?.length" class="flex flex-wrap gap-2">
                        <span v-for="l in describeItem(item).lines" :key="l" class="inline-flex items-center px-3 py-1 rounded-full bg-[#F5F5F7] dark:bg-white/5 text-[11px] font-bold text-gray-600 dark:text-gray-300">
                          {{ l }}
                        </span>
                      </div>

                      <div class="flex flex-wrap gap-2 pt-1">
                        <button class="h-11 px-4 rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-colors" @click="selectItem(item)">
                          Подробнее
                        </button>
                        <button :class="actionBtnClass" @click="restoreItem(item)" :disabled="!canRestore(item)">
                          Восстановить
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside class="xl:sticky xl:top-6">
              <div class="rounded-[2rem] bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-5 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-[11px] uppercase tracking-[0.22em] font-black text-gray-400 dark:text-gray-500">Помощник корзины</div>
                    <h2 class="mt-1 text-2xl font-black text-[#1d1d1f] dark:text-white tracking-tight">Карточка записи</h2>
                  </div>
                  <span v-if="activePreviewItem" class="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase" :class="statusBadgeClass(activePreviewItem)">
                    {{ itemStatusLabel(activePreviewItem) }}
                  </span>
                </div>

                <template v-if="activePreviewItem">
                  <div class="mt-4 inline-flex items-center px-3 py-1.5 rounded-2xl text-[10px] font-black tracking-widest uppercase" :class="conflictBadgeClass(activePreviewItem)">
                    {{ hasConflict(activePreviewItem) ? getTrashConflict(activePreviewItem).reason : 'Конфликтов перед восстановлением не найдено' }}
                  </div>

                  <div v-if="hasSelectedItems" class="mt-5 rounded-3xl bg-[#F5F5F7] dark:bg-white/5 border border-black/5 dark:border-white/10 p-4">
                    <div class="text-[11px] uppercase tracking-[0.2em] font-black text-gray-400 dark:text-gray-500">Групповые действия</div>
                    <div class="mt-2 text-sm font-semibold text-gray-600 dark:text-gray-300 leading-relaxed">
                      Выбрано записей: {{ selectedItems.length }}. Доступно для восстановления: {{ selectedRestorableItems.length }}.
                    </div>
                    <div class="mt-3 grid grid-cols-1 gap-2">
                      <button :class="actionBtnClass + ' w-full justify-center'" @click="restoreSelectedItems" :disabled="!selectedRestorableItems.length || isBulkProcessing">
                        Восстановить выбранные
                      </button>
                      <button class="h-11 rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 font-bold text-xs uppercase tracking-widest border border-red-100 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" @click="deleteSelectedForever" :disabled="!hasSelectedItems || isBulkProcessing">
                        Удалить выбранные
                      </button>
                    </div>
                  </div>

                  <div class="mt-5">
                    <div class="text-lg font-black text-[#1d1d1f] dark:text-white break-words">
                      {{ itemTitle(activePreviewItem) }}
                    </div>
                    <div class="mt-2 text-sm font-semibold text-gray-500 dark:text-gray-400 leading-relaxed">
                      {{ describeItem(activePreviewItem).subtitle }}
                    </div>
                  </div>

                  <div class="mt-5 grid grid-cols-1 gap-3">
                    <div v-for="fact in buildPreviewFacts(activePreviewItem)" :key="`${fact.label}-${fact.value}`" class="rounded-2xl bg-[#F5F5F7] dark:bg-white/5 px-4 py-3 border border-black/5 dark:border-white/10">
                      <div class="text-[10px] uppercase tracking-[0.18em] font-black text-gray-400 dark:text-gray-500">{{ fact.label }}</div>
                      <div class="mt-1 text-sm font-bold text-[#1d1d1f] dark:text-white break-words">{{ fact.value }}</div>
                    </div>
                  </div>

                  <div v-if="describeItem(activePreviewItem).lines?.length" class="mt-5 rounded-3xl bg-[#F5F5F7] dark:bg-white/5 border border-black/5 dark:border-white/10 p-4">
                    <div class="text-[11px] uppercase tracking-[0.2em] font-black text-gray-400 dark:text-gray-500">Что внутри записи</div>
                    <div class="mt-3 space-y-2">
                      <div v-for="l in describeItem(activePreviewItem).lines" :key="l" class="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        {{ l }}
                      </div>
                    </div>
                  </div>

                  <div class="mt-5 grid grid-cols-1 gap-2">
                    <button :class="actionBtnClass + ' w-full justify-center'" @click="restoreItem(activePreviewItem)" :disabled="!canRestore(activePreviewItem)">
                      Восстановить запись
                    </button>
                    <button class="h-11 rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-colors" @click="copyItemJson(activePreviewItem)">
                      Скопировать JSON
                    </button>
                    <button class="h-11 rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 font-bold text-xs uppercase tracking-widest border border-red-100 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors" @click="deleteForeverItem(activePreviewItem)">
                      Удалить навсегда
                    </button>
                  </div>

                  <div class="mt-5">
                    <div class="text-[11px] uppercase tracking-[0.2em] font-black text-gray-400 dark:text-gray-500">Технические данные</div>
                    <pre class="details-pre mt-3">{{ prettyJson(activePreviewItem) }}</pre>
                  </div>
                </template>

                <template v-else>
                  <div class="mt-5 rounded-3xl bg-[#F5F5F7] dark:bg-white/5 border border-black/5 dark:border-white/10 p-5">
                    <div class="text-sm font-semibold text-gray-500 dark:text-gray-400 leading-relaxed">
                      Выберите любую запись из списка. Здесь появится её расшифровка, статус хранения, место восстановления и быстрые действия.
                    </div>
                  </div>
                </template>
              </div>
            </aside>
          </div>

        </div>
      </div>
    </PageScrollWrapper>

    <!-- TOAST -->
<div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]">
        <div
          class="px-5 py-3 rounded-2xl font-bold text-sm shadow-2xl"
          :class="toast.type === 'danger'
            ? 'bg-red-500 text-white'
            : toast.type === 'ok'
              ? 'bg-green-500 text-white'
              : 'bg-white dark:bg-[#1C1C1E] text-black dark:text-white border border-gray-100 dark:border-white/10'"
        >
          {{ toast.message }}
        </div>
      </div>

    <!-- CONFIRM MODAL -->
    <div v-if="modal.open" class="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center p-5" @click.self="closeModal">
      <div class="w-full max-w-sm rounded-[2rem] bg-white dark:bg-[#1C1C1E] p-6 shadow-2xl border border-gray-100 dark:border-white/10">
        <h3 class="text-xl font-black text-[#1d1d1f] dark:text-white mb-2">
          {{ modal.title }}
        </h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed">
          {{ modal.text }}
        </p>

        <div v-if="modal.details?.length" class="mt-4 rounded-2xl bg-gray-50 dark:bg-white/5 p-4 space-y-1.5">
          <div v-for="d in modal.details" :key="d" class="text-xs font-bold text-gray-600 dark:text-gray-300">
            {{ d }}
          </div>
        </div>

        <p v-if="modal.locked" class="mt-3 text-[11px] text-gray-400 font-semibold">
          Подтверждение станет доступно через секунду…
        </p>

        <div class="mt-6 flex gap-3">
          <button class="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-sm hover:bg-gray-200 dark:hover:bg-white/10 transition-colors" @click="closeModal">Отмена</button>
          <button
            v-if="modal.secondaryText"
            class="flex-1 h-12 rounded-xl font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            :class="modal.secondaryKind === 'copy'
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-200'"
            :disabled="modal.locked"
            @click="confirmSecondaryModal"
          >
            {{ modal.secondaryText }}
          </button>
          <button
            class="flex-1 h-12 rounded-xl font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            :class="modal.confirmKind === 'danger'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-[#1d1d1f] dark:bg-white text-white dark:text-black'"
            :disabled="modal.locked"
            @click="confirmModal"
          >
            {{ modal.confirmText }}
          </button>
        </div>
      </div>
    </div>
    <!-- DESTINATION MODAL (Modal #2) -->
    <div v-if="destModal.open" class="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center p-5" @click.self="closeDestModal">
      <div class="w-full max-w-sm rounded-[2rem] bg-white dark:bg-[#1C1C1E] p-6 shadow-2xl border border-gray-100 dark:border-white/10">
        <h3 class="text-xl font-black text-[#1d1d1f] dark:text-white mb-2">
          {{ destModal.title }}
        </h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed">
          {{ destModal.text }}
        </p>

        <div class="mt-4">
          <ModernSelect
            v-model="destModal.selected"
            :options="destModal.options"
            :class="btnClass"
            placeholder="Выберите…"
          />
        </div>

        <div class="mt-6 flex gap-3">
          <button class="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-sm hover:bg-gray-200 dark:hover:bg-white/10 transition-colors" @click="closeDestModal">Назад</button>
          <button
            class="flex-1 h-12 rounded-xl bg-[#1d1d1f] dark:bg-white text-white dark:text-black font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            :disabled="!destModal.selected || destModal.locked"
            @click="(async () => { 
              try { 
                destModal.locked = true; 
                await destModal.onConfirm?.(destModal.selected); 
                closeDestModal(); 
              } catch (e) { 
                notificationError?.(e?.message || 'Ошибка восстановления'); 
                destModal.locked = false; 
              } 
            })()"
          >
            Восстановить
          </button>
        </div>
      </div>
    </div>


  </div>
</template>

<style scoped>
/* ─── TTL Status Indicator — colored left accent via inset box-shadow ──────── */
.safe    { box-shadow: inset 4px 0 0 0 #4ade80, 0 10px 30px -15px rgba(0,0,0,0.25); }
.warning { box-shadow: inset 4px 0 0 0 #facc15, 0 10px 30px -15px rgba(0,0,0,0.25); }
.urgent  { box-shadow: inset 4px 0 0 0 #fb923c, 0 10px 30px -15px rgba(0,0,0,0.25); }
.danger  { box-shadow: inset 4px 0 0 0 #f87171, 0 10px 30px -15px rgba(0,0,0,0.25); }

.trash-selected {
  outline: 2px solid rgba(29, 29, 31, 0.12);
  outline-offset: 0;
}

:global(.dark) .trash-selected {
  outline-color: rgba(255, 255, 255, 0.18);
}

.selection-chip {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
  color: #4b5563;
  border-radius: 9999px;
  padding: 0.375rem 0.75rem;
  font-size: 0.625rem;
  line-height: 1;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.selection-chip:hover {
  background: rgba(0, 0, 0, 0.05);
}

.selection-chip--active {
  background: #1d1d1f;
  border-color: #1d1d1f;
  color: #fff;
}

:global(.dark) .selection-chip {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #d1d5db;
}

:global(.dark) .selection-chip:hover {
  background: rgba(255, 255, 255, 0.1);
}

:global(.dark) .selection-chip--active {
  background: #fff;
  border-color: #fff;
  color: #111827;
}

/* ─── Details / Summary — tech details block ──────────────────────────────── */
.details-block { margin-top: 0.5rem; }

.details-summary {
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.625rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9ca3af;
  background: rgba(0, 0, 0, 0.04);
  transition: background 0.15s, color 0.15s;
  user-select: none;
}
.details-summary::-webkit-details-marker { display: none; }
.details-summary::marker { display: none; }
.details-summary:hover { background: rgba(0, 0, 0, 0.08); color: #6b7280; }

:global(.dark) .details-summary { background: rgba(255, 255, 255, 0.05); color: #6b7280; }
:global(.dark) .details-summary:hover { background: rgba(255, 255, 255, 0.09); color: #9ca3af; }

.details-pre {
  margin-top: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.675rem;
  line-height: 1.6;
  max-height: 14rem;
  overflow: auto;
  background: rgba(0, 0, 0, 0.04);
  color: #374151;
}
:global(.dark) .details-pre { background: rgba(255, 255, 255, 0.05); color: #d1d5db; }
</style>
