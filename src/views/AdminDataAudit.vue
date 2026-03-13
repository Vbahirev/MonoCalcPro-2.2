<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

import { PageScrollWrapper } from '@/ui-core';
import { useDatabase } from '@/composables/useDatabase';
import { useHaptics } from '@/composables/useHaptics';
import { buildControlledSectionRows, buildDocAnomalies, buildSchemaSummary, formatPreviewValue, isPrimitiveValue } from '@/utils/adminDataAudit';
import { buildDeepSearchBlob, matchesSearchBlob } from '@/utils/searchIndex';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit as fsLimit,
  startAfter,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/firebase';

const router = useRouter();
const { impactLight, notificationError, notificationSuccess } = useHaptics();
const { userRole, user, isSuperAdmin, allUsers, writeAuditLog, listAuditLogs } = useDatabase();

/**
 * STEP 1-4 (Admin Data Audit)
 * - Каталог модулей (read-only)
 * - Просмотр документов (read-only)
 * - Редактирование ТОЛЬКО в безопасных границах (STEP 4)
 * - Подготовка события для audit log (пока local + console)
 */

// ===== UI =====
const btnClass = `
  h-14 bg-white dark:bg-[#1C1C1E] rounded-2xl
  shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)]
  dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/10
  font-bold text-gray-400 dark:text-gray-500
  transition-all duration-300 ease-out transform-gpu no-flicker
  hover:-translate-y-1 hover:text-gray-900 dark:hover:text-white
  hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)]
  dark:hover:shadow-black/70 hover:ring-black/10 dark:hover:ring-white/20
  active:translate-y-0 active:shadow-sm
  flex items-center relative z-10 hover:z-20
`;

const filterControlClass = `
  h-12 px-5 rounded-2xl bg-[#F5F5F7] dark:bg-[#121212]
  ring-1 ring-black/5 dark:ring-white/10
  text-sm font-bold text-gray-700 dark:text-gray-200 outline-none
  transition-all duration-300 ease-out transform-gpu
  hover:-translate-y-0.5 hover:ring-black/10 dark:hover:ring-white/20
  hover:shadow-[0_10px_18px_-10px_rgba(0,0,0,0.25)] dark:hover:shadow-black/40
  min-w-[164px] w-full md:w-auto
`;

// ===== Tabs =====
const activeTab = ref('structure'); // structure | logs
const searchQuery = ref('');

const buildSearchBlob = (source) => buildDeepSearchBlob(source, 3, 80);

// ===== Registry (STEP 2) =====
const modulesRegistry = [
  {
    id: 'settings',
    titleHuman: 'Глобальные настройки',
    descriptionHuman: 'Параметры системы: цены, материалы и общие настройки.',
    pathHint: 'Firestore: /settings/*',
    permissionsRequired: ['settings.global.view', 'canViewSettings'],
  },
  {
    id: 'users',
    titleHuman: 'Пользователи',
    descriptionHuman: 'Профили пользователей: отображаемое имя, роль, права.',
    pathHint: 'Firestore: /users/*',
    permissionsRequired: ['users.list.view', 'canManageTeam'],
  },
  {
    id: 'history',
    titleHuman: 'История проектов',
    descriptionHuman: 'История расчётов пользователей (только просмотр по политике).',
    pathHint: 'Firestore: /users/{uid}/history/*',
    permissionsRequired: ['history.view', 'canSaveHistory'],
    readOnly: true,
  },
  {
    id: 'trash',
    titleHuman: 'Корзина удалённых данных',
    descriptionHuman: 'Временное хранение удалённых элементов (восстановление/удаление отдельными операциями).',
    pathHint: 'Firestore: /users/{uid}/trash/*',
    permissionsRequired: ['settings.global.view', 'canViewSettings'],
    readOnly: true,
  },
];

// Filter visible modules (Super Admin only)
const visibleModules = computed(() => {
  return modulesRegistry
    .filter((m) => {
      return matchesSearchBlob(buildSearchBlob(m), searchQuery.value);
    });
});

// ===== Selection =====
const selectedModuleId = ref(null);
const selectedModule = computed(() => visibleModules.value.find((m) => m.id === selectedModuleId.value) || null);
const scopedUserId = ref('');

const docs = ref([]);
const isLoadingDocs = ref(false);
const loadError = ref('');
const cursor = ref(null);
const hasMore = ref(false);

const selectedDocId = ref(null);
const selectedDoc = ref(null);
const isLoadingDoc = ref(false);
const selectedSectionKey = ref('');
const selectedSectionItemIndex = ref(0);
const isEditingSection = ref(false);
const sectionEditDraft = ref({});

// ===== Edit mode (STEP 4) =====
const isEditing = ref(false);
const editDraft = ref({});
const validationError = ref('');
// ===== Audit logs (STEP 5) =====
const auditLogs = ref([]);
const logsCursor = ref(null);
const logsHasMore = ref(false);
const isLoadingLogs = ref(false);
const logsError = ref('');
const actionFilter = ref('all'); // all | update | restore | delete...
const periodFilter = ref('30'); // all | 1 | 7 | 30 | 90
const entityFilter = ref('all');
const actorFilter = ref('');
const selectedLogId = ref(null);

const userScopeOptions = computed(() => {
  return (allUsers.value || []).map((entry) => ({
    id: entry.id,
    label: entry.displayName || entry.name || entry.email || entry.id,
  }));
});

const requiresUserScope = computed(() => selectedModule.value?.id === 'history' || selectedModule.value?.id === 'trash');
const canLoadScopedModule = computed(() => !requiresUserScope.value || Boolean(scopedUserId.value));

const moduleCapabilities = {
  settings: { risk: 'Средний риск', scope: 'Глобальный контур', ops: ['Просмотр', 'Безопасное редактирование'] },
  users: { risk: 'Высокий риск', scope: 'Глобальный контур', ops: ['Просмотр', 'Ограниченное редактирование'] },
  history: { risk: 'Низкий риск', scope: 'Контур пользователя', ops: ['Просмотр', 'Диагностика'] },
  trash: { risk: 'Средний риск', scope: 'Контур пользователя', ops: ['Просмотр', 'Диагностика'] },
};

const dataMapCards = [
  { id: 'settings', title: 'Settings', text: 'Глобальные параметры, справочники и конфиги системы.', links: ['users', 'history'] },
  { id: 'users', title: 'Users', text: 'Пользователи, роли и права доступа.', links: ['history', 'trash'] },
  { id: 'history', title: 'History', text: 'Сохранённые проекты и расчёты конкретного пользователя.', links: ['trash'] },
  { id: 'trash', title: 'Trash', text: 'Временно удалённые записи с TTL и восстановлением.', links: [] },
];

const selectedLog = computed(() => {
  if (!selectedLogId.value) return null;
  return filteredAuditLogs.value.find((x) => x.id === selectedLogId.value) || null;
});

const DAY_MS_LOCAL = 24 * 60 * 60 * 1000;

function logTsMs(l) {
  if (!l) return 0;
  if (typeof l.tsMs === 'number') return l.tsMs;
  const ts = l.ts;
  if (ts?.toMillis) return ts.toMillis();
  return 0;
}

const filteredAuditLogs = computed(() => {
  const now = Date.now();
  const days = periodFilter.value === 'all' ? null : Number(periodFilter.value || 30);
  const since = days ? (now - days * DAY_MS_LOCAL) : null;
  const actorQuery = actorFilter.value.trim().toLowerCase();

  return auditLogs.value
    .filter((l) => {
      if (!since) return true;
      return logTsMs(l) >= since;
    })
    .filter((l) => {
      if (entityFilter.value === 'all') return true;
      return String(l?.entityType || '') === entityFilter.value;
    })
    .filter((l) => {
      if (!actorQuery) return true;
      return String(l?.actorEmail || l?.actorUid || '').toLowerCase().includes(actorQuery);
    })
    .filter((l) => {
      const blob = buildSearchBlob(l);
      return matchesSearchBlob(blob, searchQuery.value);
    });
});

const logSummaryCards = computed(() => {
  const items = filteredAuditLogs.value;
  const selected = selectedLog.value;
  return [
    { label: 'Событий в выборке', value: String(items.length) },
    { label: 'Изменения', value: String(items.filter((entry) => entry.action === 'update').length) },
    { label: 'Восстановления', value: String(items.filter((entry) => entry.action === 'restore').length) },
    { label: 'Фокус', value: selected ? `${selected.entityType}/${selected.entityId}` : 'Событие не выбрано' },
  ];
});

async function loadAuditLogs({ reset = false } = {}) {
  logsError.value = '';
  isLoadingLogs.value = true;

  try {
    const res = await listAuditLogs({
      pageSize: 40,
      cursorDoc: reset ? null : logsCursor.value,
      action: actionFilter.value === 'all' ? null : actionFilter.value,
    });
    if (reset) auditLogs.value = res.items;
    else auditLogs.value = [...auditLogs.value, ...res.items];
    logsCursor.value = res.cursorDoc;
    logsHasMore.value = !!res.hasMore;
  } catch (e) {
    console.error('[AdminDataAudit] loadAuditLogs error', e);
    logsError.value = 'Не удалось загрузить логи.';
  } finally {
    isLoadingLogs.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === 'logs' && isSuperAdmin.value) {
    loadAuditLogs({ reset: true });
  }
});

watch(actionFilter, () => {
  if (activeTab.value === 'logs' && isSuperAdmin.value) {
    loadAuditLogs({ reset: true });
  }
});

function trySelectUserFromPath(path) {
  const match = String(path || '').match(/^users\/([^/]+)\//);
  if (!match) return false;
  scopedUserId.value = match[1];
  return true;
}

async function openEntityFromLog(log) {
  if (!log?.entityType || !log?.entityId) return;
  activeTab.value = 'structure';
  searchQuery.value = '';
  selectedModuleId.value = log.entityType;
  if (log.entityPath) trySelectUserFromPath(log.entityPath);
  if ((log.entityType === 'history' || log.entityType === 'trash') && !scopedUserId.value) {
    notificationError('Для этого события не удалось определить пользователя из пути');
    return;
  }
  await loadDocuments({ reset: true });
  await openDocument(log.entityId);
}

// ===== Guards =====
onMounted(() => {
  // Access guard: Super Admin only (hard rule)
  if (!isSuperAdmin.value) {
    notificationError('Доступ только для Super Admin');
    router.replace('/settings');
  }
});

// ===== Firestore adapters =====
function moduleCollectionRef(moduleId) {
  if (moduleId === 'settings') return collection(db, 'settings');
  if (moduleId === 'users') return collection(db, 'users');
  if (moduleId === 'history' && scopedUserId.value) return collection(db, 'users', scopedUserId.value, 'history');
  if (moduleId === 'trash' && scopedUserId.value) return collection(db, 'users', scopedUserId.value, 'trash');
  return null;
}

function moduleDocRef(moduleId, docId) {
  if (moduleId === 'settings') return doc(db, 'settings', docId);
  if (moduleId === 'users') return doc(db, 'users', docId);
  if (moduleId === 'history' && scopedUserId.value) return doc(db, 'users', scopedUserId.value, 'history', docId);
  if (moduleId === 'trash' && scopedUserId.value) return doc(db, 'users', scopedUserId.value, 'trash', docId);
  return null;
}

// Read docs list (STEP 3)
async function loadDocuments({ reset = false } = {}) {
  loadError.value = '';
  isLoadingDocs.value = true;

  try {
    if (!selectedModule.value) return;

    if (requiresUserScope.value && !scopedUserId.value) {
      docs.value = [];
      hasMore.value = false;
      cursor.value = null;
      return;
    }

    const colRef = moduleCollectionRef(selectedModule.value.id);
    if (!colRef) {
      docs.value = [];
      hasMore.value = false;
      cursor.value = null;
      return;
    }

    const pageSize = 20;
    const q = reset
      ? query(colRef, orderBy('__name__'), fsLimit(pageSize))
      : (cursor.value
          ? query(colRef, orderBy('__name__'), startAfter(cursor.value), fsLimit(pageSize))
          : query(colRef, orderBy('__name__'), fsLimit(pageSize)));

    const snap = await getDocs(q);
    const batch = snap.docs.map((d) => ({
      id: d.id,
      __ref: d.ref,
      __raw: d.data(),
    }));

    if (reset) docs.value = batch;
    else docs.value = [...docs.value, ...batch];

    cursor.value = snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor.value;
    hasMore.value = snap.docs.length === pageSize;
  } catch (e) {
    console.error('[AdminDataAudit] loadDocuments error', e);
    loadError.value = 'Не удалось загрузить список документов.';
  } finally {
    isLoadingDocs.value = false;
  }
}

// Read one doc (STEP 3)
async function openDocument(docId) {
  selectedDocId.value = docId;
  selectedDoc.value = null;
  isEditing.value = false;
  isEditingSection.value = false;
  selectedSectionKey.value = '';
  selectedSectionItemIndex.value = 0;
  validationError.value = '';
  isLoadingDoc.value = true;

  try {
    const ref = moduleDocRef(selectedModule.value?.id, docId);
    if (!ref) {
      selectedDoc.value = null;
      return;
    }
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      selectedDoc.value = null;
      return;
    }
    selectedDoc.value = {
      id: snap.id,
      path: snap.ref.path,
      data: snap.data(),
      __ref: snap.ref,
    };
  } catch (e) {
    console.error('[AdminDataAudit] openDocument error', e);
    notificationError('Не удалось открыть документ');
  } finally {
    isLoadingDoc.value = false;
  }
}

// ===== STEP 4 policy =====
function canEditCurrentDoc() {
  if (!selectedDoc.value || !selectedModule.value) return false;

  if (!isSuperAdmin.value) return false;
  if (selectedModule.value.id === 'history' || selectedModule.value.id === 'trash') return false;
  return selectedModule.value.id === 'settings' || selectedModule.value.id === 'users';
}

function editableFieldsForModule(moduleId) {
  if (moduleId === 'settings') return null; // null => primitives only (no deletion)
  if (moduleId === 'users') return ['displayName', 'role'];
  return [];
}

function buildEditDraft() {
  if (!selectedDoc.value) return {};
  const data = selectedDoc.value.data || {};
  const allowList = editableFieldsForModule(selectedModule.value.id);

  const out = {};
  Object.keys(data).forEach((k) => {
    const v = data[k];
    if (allowList && Array.isArray(allowList)) {
      if (!allowList.includes(k)) return;
      if (!isPrimitiveValue(v)) return;
      out[k] = v;
      return;
    }

    // settings: allow primitives only
    if (!allowList) {
      if (!isPrimitiveValue(v)) return;
      out[k] = v;
    }
  });

  return out;
}

const docsWithAnomalies = computed(() => {
  const moduleId = selectedModule.value?.id;
  return docs.value.map((entry) => ({
    ...entry,
    __anomalies: moduleId ? buildDocAnomalies(moduleId, entry) : [],
  }));
});

const selectedDocAnomalies = computed(() => {
  if (!selectedDoc.value || !selectedModule.value) return [];
  return buildDocAnomalies(selectedModule.value.id, selectedDoc.value);
});

const schemaSummaryRows = computed(() => buildSchemaSummary(docs.value).slice(0, 12));

const selectedDocControlledSections = computed(() => {
  if (!selectedDoc.value?.data) return [];
  return buildControlledSectionRows(selectedDoc.value.data);
});

const moduleSummaryCards = computed(() => {
  if (!selectedModule.value) return [];
  const caps = moduleCapabilities[selectedModule.value.id] || { risk: 'Неизвестно', scope: 'Неизвестно', ops: [] };
  const anomalyCount = docsWithAnomalies.value.reduce((sum, docEntry) => sum + (docEntry.__anomalies?.length ? 1 : 0), 0);
  return [
    { label: 'Контур', value: caps.scope },
    { label: 'Риск', value: caps.risk },
    { label: 'Операции', value: caps.ops.join(' · ') || 'Просмотр' },
    { label: 'Документов загружено', value: String(docs.value.length) },
    { label: 'Документов с аномалиями', value: String(anomalyCount) },
    { label: 'Режим доступа', value: canEditCurrentDoc() ? 'Просмотр и редактирование' : 'Только просмотр' },
  ];
});

const structureSteps = computed(() => [
  {
    id: 'module',
    title: '1. Контур данных',
    text: selectedModule.value ? selectedModule.value.titleHuman : 'Выберите модуль, с которым работаете.',
    state: selectedModule.value ? 'Готово' : 'Нужно выбрать',
    ready: Boolean(selectedModule.value),
  },
  {
    id: 'scope',
    title: '2. Контекст доступа',
    text: requiresUserScope.value
      ? (scopedUserId.value ? `Выбран пользователь: ${userScopeOptions.value.find((entry) => entry.id === scopedUserId.value)?.label || scopedUserId.value}` : 'Для этого модуля нужно выбрать пользователя.')
      : 'Дополнительный контекст не требуется.',
    state: !requiresUserScope.value || Boolean(scopedUserId.value) ? 'Готово' : 'Нужно выбрать',
    ready: !requiresUserScope.value || Boolean(scopedUserId.value),
  },
  {
    id: 'document',
    title: '3. Документ',
    text: selectedDocId.value ? `Открыт документ ${selectedDocId.value}` : 'Выберите документ из списка ниже.',
    state: selectedDocId.value ? 'Готово' : 'Не выбран',
    ready: Boolean(selectedDocId.value),
  },
]);

const documentOverviewCards = computed(() => {
  if (!selectedDoc.value || !selectedModule.value) return [];
  return [
    { label: 'Модуль', value: selectedModule.value.titleHuman },
    { label: 'Полей', value: String(Object.keys(selectedDoc.value.data || {}).length) },
    { label: 'Аномалий', value: String(selectedDocAnomalies.value.length) },
    { label: 'Режим', value: isEditing.value || isEditingSection.value ? 'Редактирование' : 'Просмотр' },
  ];
});

const editDiffRows = computed(() => {
  if (!selectedDoc.value || !isEditing.value) return [];
  const before = selectedDoc.value.data || {};
  return Object.entries(editDraft.value || {})
    .filter(([key, value]) => before[key] !== value)
    .map(([key, value]) => ({ key, before: before[key], after: value }));
});

const activeControlledSection = computed(() => {
  if (!selectedDoc.value?.data || !selectedSectionKey.value) return null;
  const value = selectedDoc.value.data[selectedSectionKey.value];
  if (value === undefined) return null;
  return { key: selectedSectionKey.value, value };
});

const controlledSectionEntries = computed(() => {
  const section = activeControlledSection.value?.value;
  if (Array.isArray(section)) {
    return section.map((entry, index) => ({
      id: index,
      label: entry?.name || entry?.title || entry?.label || `Элемент ${index + 1}`,
      value: entry,
    }));
  }
  if (section && typeof section === 'object') {
    return Object.entries(section).map(([key, value]) => ({ id: key, label: key, value }));
  }
  return [];
});

const activeControlledEntry = computed(() => {
  if (!controlledSectionEntries.value.length) return null;
  if (Array.isArray(activeControlledSection.value?.value)) {
    return controlledSectionEntries.value.find((entry) => Number(entry.id) === Number(selectedSectionItemIndex.value)) || controlledSectionEntries.value[0];
  }
  return controlledSectionEntries.value[0];
});

const controlledEntryPrimitiveRows = computed(() => {
  const value = activeControlledEntry.value?.value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .filter(([, fieldValue]) => isPrimitiveValue(fieldValue))
    .map(([key, fieldValue]) => ({ key, value: fieldValue }));
});

function buildSectionEditDraft() {
  const value = activeControlledEntry.value?.value;
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => isPrimitiveValue(fieldValue)));
}

function startSectionEdit() {
  if (selectedModule.value?.id !== 'settings' || !activeControlledEntry.value) return;
  isEditingSection.value = true;
  sectionEditDraft.value = buildSectionEditDraft();
}

function cancelSectionEdit() {
  isEditingSection.value = false;
  sectionEditDraft.value = {};
}

const sectionDiffRows = computed(() => {
  const before = activeControlledEntry.value?.value || {};
  return Object.entries(sectionEditDraft.value || {})
    .filter(([key, value]) => before[key] !== value)
    .map(([key, value]) => ({ key, before: before[key], after: value }));
});

async function saveSectionEdit() {
  if (selectedModule.value?.id !== 'settings' || !selectedDoc.value || !activeControlledSection.value || !activeControlledEntry.value) return;
  if (!sectionDiffRows.value.length) {
    notificationSuccess('Нет изменений в секции');
    cancelSectionEdit();
    return;
  }

  const sectionKey = activeControlledSection.value.key;
  const originalSection = selectedDoc.value.data[sectionKey];
  let nextSection;

  if (Array.isArray(originalSection)) {
    nextSection = [...originalSection];
    nextSection[Number(activeControlledEntry.value.id)] = {
      ...nextSection[Number(activeControlledEntry.value.id)],
      ...sectionEditDraft.value,
    };
  } else {
    nextSection = {
      ...originalSection,
      [activeControlledEntry.value.id]: {
        ...(originalSection?.[activeControlledEntry.value.id] || {}),
        ...sectionEditDraft.value,
      },
    };
  }

  try {
    await updateDoc(selectedDoc.value.__ref, { [sectionKey]: nextSection });
    const before = selectedDoc.value.data[sectionKey];
    selectedDoc.value.data = { ...selectedDoc.value.data, [sectionKey]: nextSection };
    try {
      await writeAuditLog({
        ts: Date.now(),
        action: 'update',
        actorUid: user.value?.uid || null,
        actorEmail: user.value?.email || null,
        actorRole: userRole.value || null,
        entityType: selectedModule.value?.id || null,
        entityId: selectedDoc.value?.id || null,
        entityPath: selectedDoc.value?.path || null,
        before: { [sectionKey]: before },
        after: { [sectionKey]: nextSection },
        source: 'ui-section',
      });
    } catch (e) {
      console.warn('[AuditLog] section write failed', e);
    }
    notificationSuccess('Секция сохранена');
    cancelSectionEdit();
  } catch (e) {
    console.error('[AdminDataAudit] saveSectionEdit error', e);
    notificationError('Не удалось сохранить секцию');
  }
}

async function copyReport(payload, successText) {
  try {
    if (!navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    notificationSuccess(successText);
  } catch (e) {
    notificationError('Не удалось скопировать отчёт');
  }
}

const moduleReport = computed(() => {
  if (!selectedModule.value) return null;
  return {
    module: selectedModule.value.id,
    title: selectedModule.value.titleHuman,
    scopedUserId: scopedUserId.value || null,
    summary: moduleSummaryCards.value,
    schema: schemaSummaryRows.value,
    anomalies: docsWithAnomalies.value
      .filter((entry) => entry.__anomalies?.length)
      .map((entry) => ({ id: entry.id, anomalies: entry.__anomalies })),
  };
});

function startEdit() {
  if (!canEditCurrentDoc()) return;
  isEditing.value = true;
  validationError.value = '';
  editDraft.value = buildEditDraft();
}

function cancelEdit() {
  isEditing.value = false;
  validationError.value = '';
  editDraft.value = {};
}

// ===== Validation (STEP 4) =====
function validateDraft() {
  validationError.value = '';

  if (!selectedDoc.value) {
    validationError.value = 'Документ не выбран.';
    return false;
  }

  const moduleId = selectedModule.value?.id;
  const allowList = editableFieldsForModule(moduleId);

  // users role check
  if (moduleId === 'users' && 'role' in editDraft.value && userRole.value !== 'superadmin') {
    validationError.value = 'Роль может менять только superadmin.';
    return false;
  }

  // types
  for (const [k, v] of Object.entries(editDraft.value || {})) {
    const ok = (typeof v === 'string') || (typeof v === 'number') || (typeof v === 'boolean') || v === null;
    if (!ok) {
      validationError.value = `Поле «${k}» имеет неподдерживаемый тип.`;
      return false;
    }
    if (allowList && Array.isArray(allowList) && !allowList.includes(k)) {
      validationError.value = `Поле «${k}» запрещено для редактирования.`;
      return false;
    }
  }

  return true;
}

// diff helper for audit event
function pickPrimitives(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (isPrimitiveValue(v)) out[k] = v;
  });
  return out;
}

function buildAuditEvent(beforeObj, afterObj) {
  const now = Date.now();
  const actorUid = user.value?.uid || null;
  const actorEmail = user.value?.email || null;
  const actorRole = userRole.value || null;

  return {
    ts: now,
    action: 'update',
    actorUid,
    actorEmail,
    actorRole,
    entityType: selectedModule.value?.id || null,
    entityId: selectedDoc.value?.id || null,
    entityPath: selectedDoc.value?.path || null,
    before: pickPrimitives(beforeObj),
    after: pickPrimitives(afterObj),
    source: 'ui',
  };
}

// Save (STEP 4)
async function saveEdit() {
  if (!validateDraft()) {
    notificationError(validationError.value || 'Ошибка валидации');
    return;
  }
  if (!canEditCurrentDoc()) {
    notificationError('Запрещено политикой доступа');
    return;
  }

  const before = { ...(selectedDoc.value?.data || {}) };
  const after = { ...before, ...(editDraft.value || {}) };

  // Compute patch: only changed primitives
  const patch = {};
  for (const [k, v] of Object.entries(editDraft.value || {})) {
    if (before[k] !== v) patch[k] = v;
  }

  if (!Object.keys(patch).length) {
    notificationSuccess('Нет изменений');
    isEditing.value = false;
    return;
  }

  try {
    await updateDoc(selectedDoc.value.__ref, patch);

    // Update local state
    selectedDoc.value.data = after;
    isEditing.value = false;

    // STEP 5: пишем audit log в Firestore (Super Admin only)
    const evt = buildAuditEvent(before, after);
    try {
      await writeAuditLog(evt);
    } catch (e) {
      console.warn('[AuditLog] write failed', e);
    }

    // локальное отражение (быстрый UX) + фильтрация по вкладке "Логи"
    auditLogs.value = [{ ...evt, tsMs: Date.now() }, ...auditLogs.value].slice(0, 200);

    notificationSuccess('Сохранено');
  } catch (e) {
    console.error('[AdminDataAudit] saveEdit error', e);
    notificationError('Не удалось сохранить');
  }
}

// ===== Reactive flows =====
watch(selectedModuleId, async () => {
  // reset state on module change
  docs.value = [];
  cursor.value = null;
  hasMore.value = false;
  selectedDocId.value = null;
  selectedDoc.value = null;
  isEditing.value = false;
  validationError.value = '';
  editDraft.value = {};
  cancelSectionEdit();
  selectedSectionKey.value = '';
  selectedSectionItemIndex.value = 0;
  if (!(selectedModuleId.value === 'history' || selectedModuleId.value === 'trash')) {
    scopedUserId.value = '';
  }

  if (selectedModuleId.value && (!requiresUserScope.value || scopedUserId.value)) await loadDocuments({ reset: true });
});

watch(scopedUserId, async () => {
  if (!selectedModule.value || !requiresUserScope.value) return;
  docs.value = [];
  cursor.value = null;
  hasMore.value = false;
  selectedDocId.value = null;
  selectedDoc.value = null;
  cancelSectionEdit();
  selectedSectionKey.value = '';
  selectedSectionItemIndex.value = 0;
  if (scopedUserId.value) await loadDocuments({ reset: true });
});

watch(selectedDocControlledSections, (sections) => {
  if (!sections.length) {
    selectedSectionKey.value = '';
    selectedSectionItemIndex.value = 0;
    cancelSectionEdit();
    return;
  }
  if (!sections.some((section) => section.key === selectedSectionKey.value)) {
    selectedSectionKey.value = sections[0].key;
    selectedSectionItemIndex.value = 0;
    cancelSectionEdit();
  }
});

const emptyStateText = computed(() => {
  if (activeTab.value === 'logs') return 'Логи пока не загружены';
  if (!selectedModule.value) return 'Выберите модуль данных';
  if (requiresUserScope.value && !scopedUserId.value) {
    return 'Сначала выберите пользователя, чтобы безопасно открыть user-scoped модуль.';
  }
  return 'Нет данных для отображения';
});

const goBack = () => { impactLight(); router.push('/settings'); };
</script>

<template>
  <div class="h-screen w-full bg-[#F5F5F7] dark:bg-[#121212] overflow-hidden flex flex-col relative transition-colors duration-500">
    <PageScrollWrapper class="flex-1">
      <div class="pb-32 pt-2 relative min-h-full flex flex-col w-full pt-6">
        <div class="max-w-6xl mx-auto px-5 w-full relative z-10">

          <!-- Header -->
          <div class="flex items-center justify-center relative mb-8 animate-fade-in-down">
            <h1 class="text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none text-center px-6 py-2 transition-colors duration-300">
              Структура данных
            </h1>
          </div>

          <div class="relative flex flex-col sm:flex-row gap-4 w-full mb-8 animate-fade-in-up z-40 items-center">
            <button @click="goBack" :class="[btnClass, 'px-7 justify-center gap-3 shrink-0 w-full sm:w-auto whitespace-nowrap']">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
              <span class="font-bold text-sm">Назад</span>
            </button>

            <div class="relative flex-1 group w-full" :class="btnClass">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg class="text-inherit transition-colors duration-300" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <input
                v-model="searchQuery"
                class="block w-full h-full pl-12 pr-12 bg-transparent rounded-2xl text-sm font-bold outline-none text-inherit placeholder-gray-400/70 transition-colors cursor-text"
                placeholder="Поиск по модулям..."
              >
              <button v-if="searchQuery" @click="searchQuery=''" class="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-black dark:hover:text-white cursor-pointer z-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <!-- Tabs -->
            <div class="flex gap-2 w-full sm:w-auto">
              <button
                @click="activeTab='structure'"
                :class="[btnClass, 'px-7 justify-center w-full sm:w-auto whitespace-nowrap', activeTab==='structure' ? 'text-gray-900 dark:text-white' : '']"
              >
                Структура
              </button>
              <button
                @click="activeTab='logs'"
                :class="[btnClass, 'px-7 justify-center w-full sm:w-auto whitespace-nowrap', activeTab==='logs' ? 'text-gray-900 dark:text-white' : '']"
              >
                Логи
              </button>
            </div>
          </div>

          <!-- Content -->
          <div class="space-y-8 animate-fade-in-up" style="animation-delay: 0.1s;">

            <div v-if="activeTab==='structure'" class="rounded-[2rem] bg-white dark:bg-[#1C1C1E] ring-1 ring-black/5 dark:ring-white/10 p-5 shadow-sm">
              <div class="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
                <div>
                  <div class="text-[11px] uppercase tracking-[0.22em] font-black text-gray-400 dark:text-gray-500">Карта данных</div>
                  <div class="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">Раздел показывает безопасные связи между глобальными настройками, пользователями, историей и корзиной.</div>
                </div>
                <div v-if="selectedModule" class="flex flex-wrap gap-2">
                  <button @click="copyReport(moduleReport, 'Отчёт по модулю скопирован')" :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto']">
                    Скопировать отчёт модуля
                  </button>
                </div>
              </div>

              <div class="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div
                  v-for="step in structureSteps"
                  :key="step.id"
                  class="audit-step-card"
                  :class="step.ready ? 'audit-step-card--ready' : 'audit-step-card--pending'"
                >
                  <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
                    <div>
                      <div class="text-sm font-black text-[#1d1d1f] dark:text-white">{{ step.title }}</div>
                      <div class="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400 leading-relaxed">{{ step.text }}</div>
                    </div>
                    <span class="audit-status-pill self-start shrink-0" :class="step.ready ? 'audit-status-pill--ready' : 'audit-status-pill--pending'">{{ step.state }}</span>
                  </div>
                </div>
              </div>

              <div class="mt-4 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
                <div v-for="node in dataMapCards" :key="node.id" class="audit-map-card" :class="selectedModuleId===node.id ? 'audit-map-card--active' : ''">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 text-lg font-black text-[#1d1d1f] dark:text-white break-words">{{ node.title }}</div>
                    <button class="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.16em] px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400" @click="selectedModuleId = node.id">
                      Открыть
                    </button>
                  </div>
                  <div class="mt-2 text-sm font-semibold text-gray-500 dark:text-gray-400 leading-relaxed">{{ node.text }}</div>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <span v-for="target in node.links" :key="`${node.id}-${target}`" class="inline-flex items-center px-2.5 py-1 rounded-full bg-white/80 dark:bg-white/5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400 ring-1 ring-black/5 dark:ring-white/10">
                      → {{ target }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Audit Logs (STEP 5) -->
            <div v-if="activeTab==='logs'" class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
              <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,240px)_1fr] gap-4 mb-4 items-start">
                <div class="text-sm font-bold text-gray-500 dark:text-gray-400 leading-relaxed xl:pt-3">
                  Audit Logs — фиксируем каждое действие Super Admin
                </div>

                <div class="flex flex-col md:flex-row md:flex-wrap gap-3 w-full items-stretch">
                  <select v-model="actionFilter" :class="filterControlClass">
                    <option value="all">Все действия</option>
                    <option value="update">Изменения</option>
                    <option value="restore">Восстановления</option>
                    <option value="delete">Удаления</option>
                  </select>
                  <select v-model="entityFilter" :class="filterControlClass">
                    <option value="all">Все модули</option>
                    <option value="settings">Настройки</option>
                    <option value="users">Пользователи</option>
                    <option value="history">История</option>
                    <option value="trash">Корзина</option>
                  </select>
                  <select v-model="periodFilter" :class="filterControlClass">
                    <option value="all">За всё время</option>
                    <option value="1">24 часа</option>
                    <option value="7">7 дней</option>
                    <option value="30">30 дней</option>
                    <option value="90">90 дней</option>
                  </select>
                  <input
                    v-model="actorFilter"
                    :class="filterControlClass"
                    placeholder="Актор: email или uid"
                  >
                  <button @click="loadAuditLogs({ reset: true })" :class="[btnClass, 'px-7 justify-center gap-3 h-12 min-w-[170px] w-full md:w-auto whitespace-nowrap']">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
                      <path d="M21 3v6h-6"></path>
                    </svg>
                    <span class="font-bold text-sm">Обновить</span>
                  </button>
                </div>
              </div>

              <div class="mb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div v-for="card in logSummaryCards" :key="card.label" class="audit-stat-card">
                  <div class="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">{{ card.label }}</div>
                  <div class="mt-2 text-sm font-bold text-[#1d1d1f] dark:text-white break-words">{{ card.value }}</div>
                </div>
              </div>

              <div v-if="logsError" class="text-sm font-bold text-red-600 mb-3">{{ logsError }}</div>
              <div v-if="isLoadingLogs" class="text-sm font-bold text-gray-500 dark:text-gray-400">Загрузка логов...</div>

              <div v-else-if="!filteredAuditLogs.length" class="text-center py-10">
                <div class="text-lg font-black text-[#1d1d1f] dark:text-white mb-2">Логи не найдены</div>
                <div class="text-sm font-bold text-gray-500 dark:text-gray-400">Попробуй изменить фильтры или строку поиска.</div>
              </div>

              <div v-else class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_360px] gap-4 items-start">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  v-for="l in filteredAuditLogs"
                  :key="l.id"
                  @click="selectedLogId = l.id"
                  class="text-left rounded-3xl p-5 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
                  :class="selectedLogId===l.id ? 'ring-2 ring-black/10 dark:ring-white/20 shadow-md' : ''"
                >
                  <div class="text-sm font-black text-[#1d1d1f] dark:text-white">
                    {{ (l.actorEmail || 'Super Admin') }}
                  </div>
                  <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1">
                    {{ l.action }} • {{ l.entityType }}/{{ l.entityId }}
                  </div>
                  <div class="text-xs font-bold text-gray-400 dark:text-gray-500 mt-2">
                    {{ new Date(logTsMs(l) || Date.now()).toLocaleString() }}
                  </div>
                </button>
                </div>

                <div class="xl:sticky xl:top-6">
                  <div v-if="selectedLog" class="rounded-3xl p-6 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <div class="text-lg font-black text-[#1d1d1f] dark:text-white">Детали события</div>
                        <div class="text-sm font-bold text-gray-500 dark:text-gray-400 mt-1">
                          {{ (selectedLog.actorEmail || 'Super Admin') }} • {{ selectedLog.action }}
                        </div>
                      </div>
                      <button @click="selectedLogId=null" class="text-gray-400 hover:text-black dark:hover:text-white">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>

                    <div class="mt-4 flex flex-wrap gap-2">
                      <button
                        @click="openEntityFromLog(selectedLog)"
                        :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto']"
                      >
                        Открыть объект
                      </button>
                      <button
                        @click="copyReport(selectedLog, 'Отчёт по логу скопирован')"
                        :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto']"
                      >
                        Скопировать лог
                      </button>
                    </div>

                    <div class="mt-5 grid grid-cols-1 gap-4">
                      <div class="rounded-2xl p-4 bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                        <div class="text-xs font-black text-gray-600 dark:text-gray-300 mb-2">До</div>
                        <pre class="text-xs font-mono whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">{{ JSON.stringify(selectedLog.before || {}, null, 2) }}</pre>
                      </div>
                      <div class="rounded-2xl p-4 bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                        <div class="text-xs font-black text-gray-600 dark:text-gray-300 mb-2">После</div>
                        <pre class="text-xs font-mono whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">{{ JSON.stringify(selectedLog.after || {}, null, 2) }}</pre>
                      </div>
                    </div>
                  </div>

                  <div v-else class="rounded-3xl p-6 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                    <div class="text-lg font-black text-[#1d1d1f] dark:text-white">Инспектор лога</div>
                    <div class="mt-2 text-sm font-semibold text-gray-500 dark:text-gray-400 leading-relaxed">
                      Выберите событие слева, чтобы сразу увидеть до/после и перейти к связанному объекту.
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="logsHasMore" class="mt-6">
                <button @click="loadAuditLogs({ reset: false })" :class="[btnClass, 'px-6 justify-center gap-2 w-full']">
                  Показать ещё
                </button>
              </div>
            </div>

            <!-- Structure -->
            <template v-else>
              <!-- Module cards -->
              <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4">
                <button
                  v-for="m in visibleModules"
                  :key="m.id"
                  @click="selectedModuleId = m.id"
                  class="text-left bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 ring-1 ring-black/5 dark:ring-white/10 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 audit-module-card"
                  :class="selectedModuleId===m.id ? 'audit-module-card--active' : ''"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="text-xl font-black text-[#1d1d1f] dark:text-white leading-tight break-words">
                        {{ m.titleHuman }}
                      </div>
                      <div class="mt-2 text-sm font-bold text-gray-500 dark:text-gray-400 leading-relaxed">
                        {{ m.descriptionHuman }}
                      </div>
                    </div>
                    <span class="audit-status-pill shrink-0" :class="selectedModuleId===m.id ? 'audit-status-pill--ready' : 'audit-status-pill--neutral'">
                      {{ moduleCapabilities[m.id]?.risk || 'Риск не задан' }}
                    </span>
                  </div>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <span class="audit-mini-tag">{{ moduleCapabilities[m.id]?.scope || 'Контур не задан' }}</span>
                    <span class="audit-mini-tag">{{ moduleCapabilities[m.id]?.ops?.length || 0 }} операций</span>
                  </div>
                  <div class="mt-3 text-xs font-bold text-gray-400 dark:text-gray-500 break-words">
                    {{ m.pathHint }}
                  </div>
                </button>
              </div>

              <!-- Module detail panel -->
              <div v-if="selectedModule" class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div class="text-2xl font-black text-[#1d1d1f] dark:text-white">{{ selectedModule.titleHuman }}</div>
                    <div class="text-sm font-bold text-gray-500 dark:text-gray-400 mt-1">{{ selectedModule.pathHint }}</div>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    <button
                      @click="loadDocuments({ reset: true })"
                      :class="[btnClass, 'px-6 justify-center gap-2 w-full md:w-auto']"
                      :disabled="requiresUserScope && !canLoadScopedModule"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
                        <path d="M21 3v6h-6"></path>
                      </svg>
                      <span class="font-bold text-sm">Обновить</span>
                    </button>
                    <button
                      @click="copyReport(moduleReport, 'Отчёт по модулю скопирован')"
                      :class="[btnClass, 'px-6 justify-center gap-2 w-full md:w-auto']"
                    >
                      Отчёт
                    </button>
                  </div>
                </div>

                <div class="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  <div v-for="card in moduleSummaryCards" :key="card.label" class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                    <div class="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">{{ card.label }}</div>
                    <div class="mt-2 text-sm font-bold text-[#1d1d1f] dark:text-white break-words">{{ card.value }}</div>
                  </div>
                </div>

                <div v-if="schemaSummaryRows.length" class="mt-5 rounded-3xl p-5 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                  <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-3">Schema Summary</div>
                  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    <div v-for="row in schemaSummaryRows" :key="row.key" class="rounded-2xl p-4 bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                      <div class="text-sm font-black text-[#1d1d1f] dark:text-white">{{ row.key }}</div>
                      <div class="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">Тип: {{ row.shape }}</div>
                      <div class="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">Покрытие: {{ row.coverage }} док.</div>
                      <div class="mt-2 text-xs font-bold text-gray-600 dark:text-gray-300 break-words">{{ row.details }}</div>
                    </div>
                  </div>
                </div>

                <div class="mt-6">
                  <div v-if="loadError" class="text-sm font-bold text-red-600">{{ loadError }}</div>

                  <div v-if="requiresUserScope" class="mb-5 rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                    <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Пользовательский контур</div>
                    <select v-model="scopedUserId" class="w-full h-12 px-4 rounded-2xl bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 text-sm font-bold text-gray-700 dark:text-gray-200 outline-none">
                      <option value="">Выберите пользователя</option>
                      <option v-for="opt in userScopeOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                    </select>
                    <div class="mt-2 text-sm font-bold text-gray-500 dark:text-gray-400">
                      Для history и trash сначала выбирается пользователь, затем безопасно открывается только его контур.
                    </div>
                  </div>

                  <div>
                    <div v-if="isLoadingDocs" class="text-sm font-bold text-gray-500 dark:text-gray-400">Загрузка...</div>

                    <div v-else-if="!docs.length" class="text-center py-10">
                      <div class="text-lg font-black text-[#1d1d1f] dark:text-white mb-2">{{ emptyStateText }}</div>
                    </div>

                    <div v-else class="mt-4">
                      <div class="mb-3 text-xs font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">Список документов</div>
                      <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                      <button
                        v-for="d in docsWithAnomalies"
                        :key="d.id"
                        @click="openDocument(d.id)"
                        class="text-left rounded-3xl p-5 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 audit-doc-card"
                        :class="selectedDocId===d.id ? 'audit-doc-card--active' : ''"
                      >
                        <div class="text-base font-black text-[#1d1d1f] dark:text-white truncate">{{ d.id }}</div>
                        <div class="mt-2 text-xs font-bold text-gray-500 dark:text-gray-400 truncate">
                          {{ selectedModule.id==='users' ? 'Профиль пользователя' : selectedModule.id==='settings' ? 'Документ настроек' : selectedModule.id==='history' ? 'Запись истории' : 'Запись корзины' }}
                        </div>
                        <div class="mt-4 flex flex-wrap gap-2">
                          <span class="audit-mini-tag">Полей: {{ Object.keys(d.data || {}).length }}</span>
                          <span v-if="!d.__anomalies?.length" class="audit-mini-tag audit-mini-tag--ok">Без аномалий</span>
                        </div>
                        <div v-if="d.__anomalies?.length" class="mt-3 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.14em] bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                          Аномалий: {{ d.__anomalies.length }}
                        </div>
                      </button>
                      </div>
                    </div>

                    <div class="mt-5" v-if="hasMore">
                      <button @click="loadDocuments()" :class="[btnClass, 'px-6 justify-center w-full md:w-auto']">
                        Загрузить ещё
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Document viewer -->
              <div v-if="selectedDocId" class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div class="text-2xl font-black text-[#1d1d1f] dark:text-white">{{ selectedDocId }}</div>
                    <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1" v-if="selectedDoc?.path">
                      {{ selectedDoc.path }}
                    </div>
                  </div>

                  <div class="flex gap-2">
                    <button
                      v-if="!isEditing && canEditCurrentDoc()"
                      @click="startEdit"
                      :class="[btnClass, 'px-6 justify-center w-full md:w-auto']"
                    >
                      Редактировать
                    </button>

                    <button
                      v-if="isEditing"
                      @click="saveEdit"
                      :class="[btnClass, 'px-6 justify-center w-full md:w-auto text-gray-900 dark:text-white']"
                    >
                      Сохранить
                    </button>

                    <button
                      v-if="isEditing"
                      @click="cancelEdit"
                      :class="[btnClass, 'px-6 justify-center w-full md:w-auto']"
                    >
                      Отмена
                    </button>
                  </div>
                </div>

                <div class="mt-6">
                  <div v-if="isLoadingDoc" class="text-sm font-bold text-gray-500 dark:text-gray-400">Загрузка...</div>

                  <div v-else-if="!selectedDoc" class="text-sm font-bold text-gray-500 dark:text-gray-400">
                    Документ не найден.
                  </div>

                  <template v-else>
                    <div v-if="validationError" class="text-sm font-bold text-red-600 mb-4">
                      {{ validationError }}
                    </div>

                    <div v-if="selectedDocAnomalies.length" class="mb-4 rounded-2xl p-4 bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200 dark:ring-amber-500/20">
                      <div class="text-xs font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200 mb-2">Аномалии документа</div>
                      <div class="space-y-1">
                        <div v-for="issue in selectedDocAnomalies" :key="issue" class="text-sm font-bold text-amber-800 dark:text-amber-100">
                          {{ issue }}
                        </div>
                      </div>
                    </div>

                      <div class="mb-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_340px] gap-4 items-start">
                        <div class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                          <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Паспорт документа</div>
                          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-bold text-[#1d1d1f] dark:text-white">
                            <div>Модуль: <span class="text-gray-500 dark:text-gray-400">{{ selectedModule.titleHuman }}</span></div>
                            <div>ID: <span class="text-gray-500 dark:text-gray-400">{{ selectedDoc.id }}</span></div>
                            <div>Путь: <span class="text-gray-500 dark:text-gray-400 break-all">{{ selectedDoc.path }}</span></div>
                            <div>Полей: <span class="text-gray-500 dark:text-gray-400">{{ Object.keys(selectedDoc.data || {}).length }}</span></div>
                          </div>

                          <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            <div v-for="card in documentOverviewCards" :key="card.label" class="audit-stat-card">
                              <div class="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">{{ card.label }}</div>
                              <div class="mt-2 text-sm font-bold text-[#1d1d1f] dark:text-white break-words">{{ card.value }}</div>
                            </div>
                          </div>
                        </div>

                        <div v-if="selectedDocControlledSections.length" class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10 xl:sticky xl:top-6">
                          <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Section Inspector</div>
                          <select v-model="selectedSectionKey" class="w-full h-11 px-4 rounded-2xl bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 text-sm font-bold text-gray-700 dark:text-gray-200 outline-none">
                            <option v-for="section in selectedDocControlledSections" :key="section.key" :value="section.key">{{ section.key }} · {{ section.summary }}</option>
                          </select>
                          <select v-if="Array.isArray(activeControlledSection?.value) && controlledSectionEntries.length" v-model="selectedSectionItemIndex" class="mt-2 w-full h-11 px-4 rounded-2xl bg-white/80 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 text-sm font-bold text-gray-700 dark:text-gray-200 outline-none">
                            <option v-for="entry in controlledSectionEntries" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
                          </select>
                        </div>
                      </div>

                    <div v-if="selectedDocControlledSections.length" class="mb-4 rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                      <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Контролируемые секции</div>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <button v-for="section in selectedDocControlledSections" :key="section.key" class="rounded-2xl p-3 bg-white/70 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 text-left" :class="selectedSectionKey===section.key ? 'ring-2 ring-black/10 dark:ring-white/20' : ''" @click="selectedSectionKey = section.key">
                          <div class="text-sm font-black text-[#1d1d1f] dark:text-white">{{ section.key }}</div>
                          <div class="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400">{{ section.kind }} · {{ section.summary }}</div>
                          </button>
                      </div>
                    </div>

                      <div v-if="activeControlledEntry" class="mb-4 rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div>
                            <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Controlled Entry</div>
                            <div class="mt-1 text-sm font-black text-[#1d1d1f] dark:text-white">{{ activeControlledEntry.label }}</div>
                          </div>
                          <div class="flex flex-wrap gap-2">
                            <button v-if="selectedModule.id==='settings' && !isEditingSection && controlledEntryPrimitiveRows.length" @click="startSectionEdit" :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto']">Редактировать секцию</button>
                            <button v-if="isEditingSection" @click="saveSectionEdit" :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto text-gray-900 dark:text-white']">Сохранить секцию</button>
                            <button v-if="isEditingSection" @click="cancelSectionEdit" :class="[btnClass, 'px-5 justify-center h-11 w-full sm:w-auto']">Отмена</button>
                          </div>
                        </div>

                        <div v-if="isEditingSection" class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div class="space-y-3">
                            <div v-for="(v, k) in sectionEditDraft" :key="k" class="rounded-2xl p-3 bg-white/70 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                              <div class="text-xs font-black text-gray-500 dark:text-gray-400 mb-2">{{ k }}</div>
                              <input v-if="typeof v === 'string' || v === null" v-model="sectionEditDraft[k]" class="w-full bg-white/80 dark:bg-white/5 rounded-2xl px-4 py-3 font-bold text-sm text-[#1d1d1f] dark:text-white outline-none ring-1 ring-black/5 dark:ring-white/10" />
                              <input v-else-if="typeof v === 'number'" type="number" v-model.number="sectionEditDraft[k]" class="w-full bg-white/80 dark:bg-white/5 rounded-2xl px-4 py-3 font-bold text-sm text-[#1d1d1f] dark:text-white outline-none ring-1 ring-black/5 dark:ring-white/10" />
                              <label v-else-if="typeof v === 'boolean'" class="flex items-center gap-3"><input type="checkbox" v-model="sectionEditDraft[k]" class="w-5 h-5 rounded" /><span class="text-sm font-bold text-[#1d1d1f] dark:text-white">{{ sectionEditDraft[k] ? 'Включено' : 'Выключено' }}</span></label>
                            </div>
                          </div>
                          <div class="rounded-2xl p-4 bg-white/70 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                            <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Diff секции</div>
                            <div v-if="sectionDiffRows.length" class="space-y-2">
                              <div v-for="row in sectionDiffRows" :key="row.key" class="rounded-2xl p-3 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                                <div class="text-xs font-black text-gray-500 dark:text-gray-400">{{ row.key }}</div>
                                <div class="mt-1 text-xs font-bold text-red-500">Было: {{ row.before ?? '—' }}</div>
                                <div class="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-300">Станет: {{ row.after ?? '—' }}</div>
                              </div>
                            </div>
                            <div v-else class="text-sm font-bold text-gray-500 dark:text-gray-400">Изменений в секции пока нет.</div>
                          </div>
                        </div>

                        <div v-else class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div v-for="row in controlledEntryPrimitiveRows" :key="row.key" class="rounded-2xl p-3 bg-white/70 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                            <div class="text-xs font-black text-gray-500 dark:text-gray-400">{{ row.key }}</div>
                            <div class="mt-1 text-sm font-bold text-[#1d1d1f] dark:text-white">{{ formatPreviewValue(row.value) }}</div>
                          </div>
                        </div>
                      </div>

                    <!-- Edit form (primitives only) -->
                    <div v-if="isEditing" class="space-y-4">
                      <div class="text-sm font-bold text-gray-500 dark:text-gray-400">
                        Доступны только безопасные поля (строка/число/булево). Сложные структуры на STEP 4 не редактируются.
                      </div>

                      <div class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10">
                        <div class="text-xs font-black uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 mb-2">Preview diff</div>
                        <div v-if="editDiffRows.length" class="space-y-2">
                          <div v-for="row in editDiffRows" :key="row.key" class="rounded-2xl p-3 bg-white/70 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                            <div class="text-xs font-black text-gray-500 dark:text-gray-400">{{ row.key }}</div>
                            <div class="mt-1 text-xs font-bold text-red-500">Было: {{ row.before ?? '—' }}</div>
                            <div class="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-300">Станет: {{ row.after ?? '—' }}</div>
                          </div>
                        </div>
                        <div v-else class="text-sm font-bold text-gray-500 dark:text-gray-400">Пока нет изменений.</div>
                      </div>

                      <div
                        v-for="(v, k) in editDraft"
                        :key="k"
                        class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10"
                      >
                        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">{{ k }}</div>

                        <input
                          v-if="typeof v === 'string' || v === null"
                          v-model="editDraft[k]"
                          class="w-full bg-white/70 dark:bg-white/5 rounded-2xl px-4 py-3 font-bold text-sm text-[#1d1d1f] dark:text-white outline-none ring-1 ring-black/5 dark:ring-white/10"
                          placeholder="Значение..."
                        />

                        <input
                          v-else-if="typeof v === 'number'"
                          type="number"
                          v-model.number="editDraft[k]"
                          class="w-full bg-white/70 dark:bg-white/5 rounded-2xl px-4 py-3 font-bold text-sm text-[#1d1d1f] dark:text-white outline-none ring-1 ring-black/5 dark:ring-white/10"
                        />

                        <label v-else-if="typeof v === 'boolean'" class="flex items-center gap-3">
                          <input type="checkbox" v-model="editDraft[k]" class="w-5 h-5 rounded" />
                          <span class="text-sm font-bold text-[#1d1d1f] dark:text-white">
                            {{ editDraft[k] ? 'Включено' : 'Выключено' }}
                          </span>
                        </label>

                        <div v-else class="text-sm font-bold text-gray-500 dark:text-gray-400">Недоступно для редактирования</div>
                      </div>
                    </div>

                    <!-- Read-only view -->
                    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div
                        v-for="(v, k) in selectedDoc.data"
                        :key="k"
                        class="rounded-2xl p-4 bg-[#F5F5F7] dark:bg-[#121212] ring-1 ring-black/5 dark:ring-white/10"
                      >
                        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">{{ k }}</div>
                        <div class="text-sm font-bold text-[#1d1d1f] dark:text-white break-words">
                          <template v-if="typeof v === 'string'">{{ v }}</template>
                          <template v-else-if="typeof v === 'number'">{{ v }}</template>
                          <template v-else-if="typeof v === 'boolean'">{{ v ? 'Да' : 'Нет' }}</template>
                          <template v-else-if="v === null">—</template>
                          <template v-else>
                            <div class="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">{{ formatPreviewValue(v) }}</div>
                            <details class="cursor-pointer">
                              <summary class="text-sm font-black text-gray-600 dark:text-gray-300">Показать JSON</summary>
                              <pre class="mt-3 text-xs font-mono whitespace-pre-wrap text-gray-700 dark:text-gray-200">{{ JSON.stringify(v, null, 2) }}</pre>
                            </details>
                          </template>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>

            </template>
          </div>
        </div>
      </div>
    </PageScrollWrapper>
  </div>
</template>

<style scoped>
.audit-step-card {
  border-radius: 1.5rem;
  padding: 1rem;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: linear-gradient(180deg, rgba(245, 245, 247, 0.92) 0%, rgba(255, 255, 255, 0.96) 100%);
}

.dark .audit-step-card {
  border-color: rgba(255, 255, 255, 0.1);
  background: linear-gradient(180deg, rgba(28, 28, 30, 0.96) 0%, rgba(18, 18, 18, 0.94) 100%);
}

.audit-step-card--ready {
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.15);
}

.audit-step-card--pending {
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.14);
}

.audit-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.75rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  text-align: center;
  line-height: 1;
  max-width: none;
}

.audit-status-pill--ready {
  background: rgba(16, 185, 129, 0.12);
  color: rgb(4, 120, 87);
}

.dark .audit-status-pill--ready {
  background: rgba(16, 185, 129, 0.16);
  color: rgb(167, 243, 208);
}

.audit-status-pill--pending {
  background: rgba(245, 158, 11, 0.12);
  color: rgb(180, 83, 9);
}

.dark .audit-status-pill--pending {
  background: rgba(245, 158, 11, 0.14);
  color: rgb(253, 230, 138);
}

.audit-status-pill--neutral {
  background: rgba(15, 23, 42, 0.06);
  color: rgb(71, 85, 105);
}

.dark .audit-status-pill--neutral {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(203, 213, 225);
}

.audit-map-card,
.audit-stat-card,
.audit-module-card,
.audit-doc-card {
  position: relative;
  overflow: hidden;
}

.audit-module-card,
.audit-doc-card {
  height: 100%;
}

.audit-map-card {
  border-radius: 1.5rem;
  padding: 1rem;
  background: #f5f5f7;
  border: 1px solid rgba(0, 0, 0, 0.05);
  transition: transform 0.28s ease, box-shadow 0.28s ease, border-color 0.28s ease;
}

.dark .audit-map-card {
  background: #121212;
  border-color: rgba(255, 255, 255, 0.08);
}

.audit-map-card--active,
.audit-module-card--active,
.audit-doc-card--active {
  box-shadow: 0 18px 35px -24px rgba(15, 23, 42, 0.45);
  transform: translateY(-2px);
}

.audit-map-card--active::after,
.audit-module-card--active::after,
.audit-doc-card--active::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: inset 0 0 0 2px rgba(15, 23, 42, 0.1);
}

.dark .audit-map-card--active::after,
.dark .audit-module-card--active::after,
.dark .audit-doc-card--active::after {
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.16);
}

.audit-stat-card {
  border-radius: 1rem;
  padding: 0.875rem 1rem;
  background: rgba(245, 245, 247, 0.88);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.dark .audit-stat-card {
  background: rgba(18, 18, 18, 0.88);
  border-color: rgba(255, 255, 255, 0.08);
}

.audit-mini-tag {
  display: inline-flex;
  align-items: center;
  min-height: 1.75rem;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: rgb(100, 116, 139);
  font-size: 0.675rem;
  font-weight: 800;
  line-height: 1.15;
  text-align: center;
}

.dark .audit-mini-tag {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(203, 213, 225);
}

.audit-mini-tag--ok {
  background: rgba(16, 185, 129, 0.12);
  color: rgb(4, 120, 87);
}

.dark .audit-mini-tag--ok {
  background: rgba(16, 185, 129, 0.16);
  color: rgb(167, 243, 208);
}
</style>
