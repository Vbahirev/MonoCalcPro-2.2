<script setup>
import { ref, computed, reactive, watch } from 'vue';
import { useDatabase } from '@/composables/useDatabase';
import draggable from 'vuedraggable';
import { isPermAllowedForRole } from '@/core/auth/permissions';
import { deleteKanbanUser } from '@/services/deleteKanbanUser';

const { allUsers, updateUserRole, user: currentUser, userRole, hasPermission } = useDatabase();

const searchQuery = ref('');
const showDetailsModal = ref(false);
const selectedUser = ref(null);

const isSuperAdmin = computed(() => userRole.value === 'superadmin');
// Управление ролями/правами в базе по правилам Firestore — только superadmin UID.
// Поэтому UI тоже «честно» блокируем, если вы не superadmin.
const canManageUsers = computed(() => isSuperAdmin.value);
const canViewUsers = computed(() => canManageUsers.value || hasPermission('users.list.view') || hasPermission('canManageTeam'));
const localPermissions = ref({});
const isSearchActive = computed(() => !!searchQuery.value.trim());
const isSaving = ref(false);
const saveError = ref('');

const deleteConfirmUser = ref(null);
const isDeleting = ref(false);
const deleteError = ref('');

const openDeleteConfirm = (e, userItem) => {
    e.stopPropagation();
    deleteConfirmUser.value = userItem;
    deleteError.value = '';
};

const closeDeleteConfirm = () => {
    deleteConfirmUser.value = null;
    deleteError.value = '';
};

const handleDeleteUser = async () => {
    const target = deleteConfirmUser.value;
    if (!target) return;
    if (!canManageUsers.value) return;
    if (target.id === currentUser.value?.uid) {
        deleteError.value = 'Нельзя удалить собственный аккаунт.';
        return;
    }
    isDeleting.value = true;
    deleteError.value = '';
    try {
        await deleteKanbanUser({
            targetUserId: target.id,
            userData: { email: target.email, role: target.role },
            currentUserId: currentUser.value?.uid,
        });
        closeDeleteConfirm();
        rebuildColumns();
    } catch (e) {
        deleteError.value = e?.message || 'Ошибка при удалении пользователя.';
    } finally {
        isDeleting.value = false;
    }
};

// Колонки канбана должны быть МУТАБЕЛЬНЫМИ массивами.
// Нельзя передавать в vuedraggable результат фильтрации (это новый массив, drag не работает).
const columns = reactive({
    guest: [],
    team: [],
    admin: [],
    superadmin: [],
});

const rebuildColumns = () => {
    const next = { guest: [], team: [], admin: [], superadmin: [] };
    (allUsers.value || []).forEach((u) => {
        const roleRaw = (u.role || 'guest');
        const role = roleRaw === 'employee' ? 'team' : roleRaw; // backward-compat
        if (role === 'superadmin') next.superadmin.push(u);
        else if (role === 'admin') next.admin.push(u);
        else if (role === 'team') next.team.push(u);
        else next.guest.push(u);
    });
    columns.guest = next.guest;
    columns.team = next.team;
    columns.admin = next.admin;
    columns.superadmin = next.superadmin;
};

watch(allUsers, rebuildColumns, { immediate: true });

const normalizeRole = (roleRaw) => {
    if (roleRaw === 'employee') return 'team';
    if (!roleRaw) return 'guest';
    return roleRaw;
};

const PERMISSION_GROUPS = [
    {
        title: 'Настройки',
        items: [
            { key: 'settings.global.view', label: 'Просмотр настроек', desc: 'Доступ к разделу настроек' },
            { key: 'settings.global.write', label: 'Изменение глобальных настроек', desc: 'Редактирование глобальных параметров' },
            { key: 'settings.laser.view', label: 'Просмотр лазерных настроек', desc: 'Открытие модуля лазерных параметров' },
            { key: 'settings.laser.write', label: 'Изменение лазерных настроек', desc: 'Редактирование цен и коэффициентов лазера' },
            { key: 'settings.materials.read', label: 'Просмотр материалов', desc: 'Чтение справочников материалов' },
            { key: 'settings.materials.write', label: 'Редактирование материалов', desc: 'Добавление и изменение материалов' },
            { key: 'settings.prices.read', label: 'Просмотр цен', desc: 'Чтение прайсов услуг' },
            { key: 'settings.prices.write', label: 'Редактирование цен', desc: 'Изменение стоимости услуг' },
            { key: 'invoice.stamp.edit', label: 'Редактирование печати в КП', desc: 'Загрузка и изменение PNG-печати в предпросмотре КП' },
        ],
    },
    {
        title: 'История и архив',
        items: [
            { key: 'history.view', label: 'Просмотр истории', desc: 'Открытие списка сохранённых проектов' },
            { key: 'history.write', label: 'Сохранение в историю', desc: 'Создание и обновление сохранённых расчётов' },
            { key: 'history.bulkDelete', label: 'Массовое удаление проек.', desc: 'Множественный выбор и удаление в архиве проектов' },
            { key: 'trash.view', label: 'Просмотр удалённых данных', desc: 'Доступ к архиву удалений' },
            { key: 'trash.restore', label: 'Восстановление из архива', desc: 'Возврат удалённых данных' },
            { key: 'trash.delete', label: 'Удаление из архива', desc: 'Удаление элементов архива' },
            { key: 'trash.purge', label: 'Полная очистка архива', desc: 'Безвозвратная очистка удалённых данных' },
        ],
    },
    {
        title: 'Команда',
        items: [
            { key: 'users.list.view', label: 'Просмотр команды', desc: 'Доступ к списку пользователей' },
            { key: 'users.permissions.edit', label: 'Изменение прав пользователей', desc: 'Назначение ролей и прав доступа' },
        ],
    },
    {
        title: 'Канбан',
        items: [
            { key: 'kanban.view', label: 'Просмотр канбана', desc: 'Доступ к доске задач' },
            { key: 'kanban.task.read', label: 'Просмотр задач', desc: 'Чтение карточек канбана' },
            { key: 'kanban.task.create', label: 'Создание задач', desc: 'Добавление новых задач' },
            { key: 'kanban.task.edit', label: 'Редактирование задач', desc: 'Изменение существующих задач' },
            { key: 'kanban.task.delete', label: 'Удаление задач', desc: 'Удаление задач с канбана' },
        ],
    },
];

const MANAGED_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((item) => item.key));

const selectedUserRole = computed(() => normalizeRole(selectedUser.value?.role));

const isPermissionAllowedForRole = (permKey, role = selectedUserRole.value) => {
    if (role === 'superadmin') return true;
    return isPermAllowedForRole(role, permKey);
};

const visiblePermissionGroups = computed(() => {
    const role = selectedUserRole.value;
    return PERMISSION_GROUPS
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => isPermissionAllowedForRole(item.key, role)),
        }))
        .filter((group) => group.items.length > 0);
});

const sanitizePermissionsByRole = (sourcePermissions = {}, roleRaw = 'guest') => {
    const role = normalizeRole(roleRaw);
    const preservedUnknown = Object.fromEntries(
        Object.entries(sourcePermissions || {}).filter(([key]) => !MANAGED_PERMISSION_KEYS.includes(key))
    );

    if (role === 'superadmin') {
        const managedAll = Object.fromEntries(MANAGED_PERMISSION_KEYS.map((key) => [key, true]));
        return { ...preservedUnknown, ...managedAll };
    }

    const managed = {};
    for (const permKey of MANAGED_PERMISSION_KEYS) {
        managed[permKey] = !!sourcePermissions?.[permKey] && isPermissionAllowedForRole(permKey, role);
    }

    return { ...preservedUnknown, ...managed };
};

// Поиск НЕ должен ломать drag: мы фильтруем отображение, но не список draggable.
const matchesSearch = (user) => {
    const q = (searchQuery.value || '').trim().toLowerCase();
    if (!q) return true;
    const role = String(user?.role || 'guest').toLowerCase();
    return ((user?.email || '').toLowerCase().includes(q)) || role.includes(q);
};

const visibleCounts = computed(() => ({
    guest: columns.guest.filter(matchesSearch).length,
    team: columns.team.filter(matchesSearch).length,
    admin: columns.admin.filter(matchesSearch).length,
    superadmin: columns.superadmin.filter(matchesSearch).length,
}));

const getGroupStats = (group) => {
    const total = group.items.length;
    const enabled = group.items.filter((item) => !!localPermissions.value[item.key]).length;
    return { total, enabled, all: total > 0 && enabled === total, none: enabled === 0 };
};

const setGroupPermissions = (group, enabled) => {
    group.items.forEach((item) => {
        localPermissions.value[item.key] = enabled;
    });
};

const setAllVisiblePermissions = (enabled) => {
    visiblePermissionGroups.value.forEach((group) => setGroupPermissions(group, enabled));
};

// Обработка перетаскивания
const handleChange = (event, newRole) => {
    if (!canManageUsers.value) return;
    if (event.added) {
        const user = event.added.element;
        const normalizedRole = normalizeRole(newRole);
        const isSelf = user.id === currentUser.value?.uid;
        const currentRole = normalizeRole(user?.role);

        // Защита: свою роль через канбан менять нельзя
        if (isSelf && normalizedRole !== currentRole) {
            alert("Нельзя менять собственную роль через канбан.");
            rebuildColumns();
            return; 
        }
        const sanitizedPermissions = sanitizePermissionsByRole(user.permissions || {}, normalizedRole);
        user.role = normalizedRole;
        user.permissions = sanitizedPermissions;
        // Обновляем роль в базе
        updateUserRole(user.id, normalizedRole, sanitizedPermissions);
    }
};

// Открытие окна настройки прав
const openUserDetails = (user) => {
    selectedUser.value = {
        ...user,
        role: normalizeRole(user?.role),
    };
    // Заполняем локальный объект прав значениями из базы (или false)
    const currentPerms = user.permissions || {};
    localPermissions.value = sanitizePermissionsByRole(currentPerms, selectedUser.value.role);
    saveError.value = '';
    showDetailsModal.value = true;
};

// Сохранение прав
const savePermissions = async () => {
    if (!selectedUser.value) return;
    if (!canManageUsers.value) { showDetailsModal.value = false; return; }
    if (isSaving.value) return;

    isSaving.value = true;
    saveError.value = '';
    const role = normalizeRole(selectedUser.value.role);
    const nextPermissions = sanitizePermissionsByRole(localPermissions.value, role);

    try {
        const ok = await updateUserRole(selectedUser.value.id, role, nextPermissions);
        if (!ok) {
            saveError.value = 'Не удалось сохранить права. Проверьте подключение и права доступа.';
            return;
        }
        showDetailsModal.value = false;
    } finally {
        isSaving.value = false;
    }
};

const closeDetails = () => {
    showDetailsModal.value = false;
    selectedUser.value = null;
    saveError.value = '';
};

const openUserDetailsIfAllowed = (user) => {
    if (!canViewUsers.value) return;
    openUserDetails(user);
};
</script>

<template>
    <div class="space-y-6">
        <div class="relative group h-14 bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm border border-gray-100 dark:border-white/5 flex items-center px-4 transition-all focus-within:shadow-md">
            <svg class="text-gray-400 mr-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input v-model="searchQuery" placeholder="Найти по email или роли..." class="bg-transparent w-full h-full outline-none font-bold text-sm text-[#1d1d1f] dark:text-white placeholder-gray-400">
            <button v-if="searchQuery" @click="searchQuery='';" class="ml-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" type="button" aria-label="Очистить поиск">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>

        <div v-if="isSearchActive" class="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 px-1">
            Поиск активен: перетаскивание ролей временно отключено для безопасного редактирования.
        </div>

        <div v-if="canViewUsers" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[500px]">
            
            <div class="kanban-column bg-gray-50 dark:bg-white/5 rounded-3xl p-4 flex flex-col gap-3">
                <div class="flex items-center gap-2 px-2 mb-2">
                    <div class="w-2 h-2 rounded-full bg-gray-400"></div>
                    <span class="text-xs font-black uppercase tracking-widest text-gray-500">Гости</span>
                    <span class="ml-auto text-[10px] font-black px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-300">{{ visibleCounts.guest }}</span>
                </div>
                <draggable 
                    :list="columns.guest" :disabled="!canManageUsers || isSearchActive" group="users" item-key="id"
                    class="flex-1 flex flex-col gap-3 min-h-[100px]"
                    @change="(e) => handleChange(e, 'guest')" ghost-class="ghost-card"
                >
                    <template #item="{ element }">
                        <div class="user-card group" v-show="matchesSearch(element)" @click="openUserDetailsIfAllowed(element)">
                            <div class="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-xs">
                                {{ element.email ? element.email[0].toUpperCase() : '?' }}
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-bold truncate">{{ element.email }}</div>
                            </div>
                            <button v-if="canManageUsers && element.id !== currentUser?.uid" @click.stop="openDeleteConfirm($event, element)" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all ml-1" title="Удалить пользователя" type="button">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                            </button>
                        </div>
                    </template>
                </draggable>
                <div v-if="visibleCounts.guest === 0" class="text-[11px] text-gray-400 font-bold px-2 py-4 text-center">
                    Нет пользователей по текущему фильтру
                </div>
            </div>

            <div class="kanban-column bg-blue-100/70 border border-blue-200 dark:bg-blue-900/10 dark:border-blue-500/20 rounded-3xl p-4 flex flex-col gap-3">
                <div class="flex items-center gap-2 px-2 mb-2">
                    <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span class="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-400">Команда</span>
                    <span class="ml-auto text-[10px] font-black px-2 py-1 rounded-full bg-white/80 border border-blue-200 dark:bg-blue-500/20 dark:border-blue-500/20 text-blue-700 dark:text-blue-300">{{ visibleCounts.team }}</span>
                </div>
                <draggable 
                    :list="columns.team" :disabled="!canManageUsers || isSearchActive" group="users" item-key="id"
                    class="flex-1 flex flex-col gap-3 min-h-[100px]"
                    @change="(e) => handleChange(e, 'team')" ghost-class="ghost-card"
                >
                    <template #item="{ element }">
                        <div class="user-card group ring-1 ring-blue-200 dark:ring-blue-500/20" v-show="matchesSearch(element)" @click="openUserDetailsIfAllowed(element)">
                            <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                                {{ element.email ? element.email[0].toUpperCase() : '?' }}
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-bold truncate">{{ element.email }}</div>
                            </div>
                            <button v-if="canManageUsers && element.id !== currentUser?.uid" @click.stop="openDeleteConfirm($event, element)" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all" title="Удалить пользователя" type="button">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                            </button>
                            <div v-else class="opacity-0 group-hover:opacity-100 text-gray-400">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                            </div>
                        </div>
                    </template>
                </draggable>
                <div v-if="visibleCounts.team === 0" class="text-[11px] text-blue-600 dark:text-blue-300 font-bold px-2 py-4 text-center">
                    Нет пользователей по текущему фильтру
                </div>
            </div>

            <div class="kanban-column bg-purple-100/70 border border-purple-200 dark:bg-purple-900/10 dark:border-purple-500/20 rounded-3xl p-4 flex flex-col gap-3">
                <div class="flex items-center gap-2 px-2 mb-2">
                    <div class="w-2 h-2 rounded-full bg-purple-500"></div>
                    <span class="text-xs font-black uppercase tracking-widest text-purple-700 dark:text-purple-400">Админы</span>
                    <span class="ml-auto text-[10px] font-black px-2 py-1 rounded-full bg-white/80 border border-purple-200 dark:bg-purple-500/20 dark:border-purple-500/20 text-purple-700 dark:text-purple-300">{{ visibleCounts.admin }}</span>
                </div>
                <draggable 
                    :list="columns.admin" :disabled="!canManageUsers || isSearchActive" group="users" item-key="id"
                    class="flex-1 flex flex-col gap-3 min-h-[100px]"
                    @change="(e) => handleChange(e, 'admin')" ghost-class="ghost-card"
                >
                    <template #item="{ element }">
                        <div class="user-card group ring-1 ring-purple-200 dark:ring-purple-500/20" v-show="matchesSearch(element)" @click="openUserDetailsIfAllowed(element)">
                            <div class="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-xs">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-bold truncate">{{ element.email }}</div>
                            </div>
                            <button v-if="canManageUsers && element.id !== currentUser?.uid" @click.stop="openDeleteConfirm($event, element)" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all" title="Удалить пользователя" type="button">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                            </button>
                        </div>
                    </template>
                </draggable>
                <div v-if="visibleCounts.admin === 0" class="text-[11px] text-purple-600 dark:text-purple-300 font-bold px-2 py-4 text-center">
                    Нет пользователей по текущему фильтру
                </div>
            </div>

            <div class="kanban-column bg-amber-50/70 dark:bg-amber-900/10 rounded-3xl p-4 flex flex-col gap-3">
                <div class="flex items-center gap-2 px-2 mb-2">
                    <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                    <span class="text-xs font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Superadmin</span>
                    <span class="ml-auto text-[10px] font-black px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200">{{ visibleCounts.superadmin }}</span>
                </div>
                <draggable
                    :list="columns.superadmin" :disabled="!canManageUsers || isSearchActive" group="users" item-key="id"
                    class="flex-1 flex flex-col gap-3 min-h-[100px]"
                    @change="(e) => handleChange(e, 'superadmin')" ghost-class="ghost-card"
                >
                    <template #item="{ element }">
                        <div class="user-card group ring-1 ring-amber-200 dark:ring-amber-500/25" v-show="matchesSearch(element)" @click="openUserDetailsIfAllowed(element)">
                            <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 3l2.2 4.45 4.9.71-3.55 3.46.84 4.88L12 14.2l-4.39 2.3.84-4.88L4.9 8.16l4.9-.71L12 3z"/></svg>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-bold truncate">{{ element.email }}</div>
                            </div>
                            <button v-if="canManageUsers && element.id !== currentUser?.uid" @click.stop="openDeleteConfirm($event, element)" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all" title="Удалить пользователя" type="button">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                            </button>
                        </div>
                    </template>
                </draggable>
                <div v-if="visibleCounts.superadmin === 0" class="text-[11px] text-amber-500 dark:text-amber-300 font-bold px-2 py-4 text-center">
                    Нет пользователей по текущему фильтру
                </div>
            </div>
        </div>

        <div v-else class="rounded-3xl bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/10 p-8 text-center">
            <p class="text-sm font-bold text-gray-500 dark:text-gray-400">Недостаточно прав для просмотра команды.</p>
        </div>

        <Teleport to="body">
            <!-- Подтверждение удаления пользователя -->
            <Transition name="modal-scale">
                <div v-if="deleteConfirmUser" class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" @click.self="closeDeleteConfirm">
                    <div class="bg-white dark:bg-[#1C1C1E] w-full max-w-xs rounded-[2rem] p-6 shadow-2xl border border-gray-100 dark:border-white/10">
                        <div class="flex flex-col items-center gap-4 text-center">
                            <div class="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                            </div>
                            <div>
                                <h3 class="text-base font-black text-[#1d1d1f] dark:text-white mb-1">Удалить пользователя?</h3>
                                <p class="text-xs text-gray-500 dark:text-gray-400 font-bold break-all">{{ deleteConfirmUser.email }}</p>
                                <p class="text-[11px] text-gray-400 mt-2">Запись будет помещена в архив администратора. Это действие необратимо.</p>
                            </div>
                            <div v-if="deleteError" class="w-full rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-3 py-2 text-xs font-bold">
                                {{ deleteError }}
                            </div>
                            <div class="flex gap-3 w-full">
                                <button @click="closeDeleteConfirm" :disabled="isDeleting" class="flex-1 h-11 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-sm hover:bg-gray-200 transition-colors disabled:opacity-50">Отмена</button>
                                <button @click="handleDeleteUser" :disabled="isDeleting" class="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">
                                    {{ isDeleting ? 'Удаление…' : 'Удалить' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>

        <Transition name="modal-scale">
                <div v-if="showDetailsModal && selectedUser" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="closeDetails">
                    <div class="bg-white dark:bg-[#1C1C1E] w-full max-w-sm rounded-[2rem] p-6 shadow-2xl border border-gray-100 dark:border-white/10 max-h-[80vh] flex flex-col">
                        
                        <div class="flex items-center gap-4 mb-6 shrink-0">
                            <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-xl font-black text-gray-400">
                                {{ selectedUser.email ? selectedUser.email[0].toUpperCase() : '?' }}
                            </div>
                            <div class="min-w-0">
                                <h3 class="text-base font-black text-[#1d1d1f] dark:text-white truncate">{{ selectedUser.email }}</h3>
                                <div class="text-xs text-gray-400 font-bold uppercase tracking-wider mt-1">{{ selectedUser.role }}</div>
                            </div>
                        </div>

                        <div class="overflow-y-auto custom-scroll flex-1 pr-1 space-y-4 mb-6">
                            <div class="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-white/5">
                                <span class="text-[10px] font-black uppercase tracking-wider text-gray-400">Пакетное управление</span>
                                <div class="flex items-center gap-2">
                                    <button type="button" @click="setAllVisiblePermissions(true)" :disabled="!canManageUsers || isSaving" class="px-3 h-8 rounded-lg bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-wider disabled:opacity-50">Включить всё</button>
                                    <button type="button" @click="setAllVisiblePermissions(false)" :disabled="!canManageUsers || isSaving" class="px-3 h-8 rounded-lg bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-200 text-[10px] font-black uppercase tracking-wider disabled:opacity-50">Выключить всё</button>
                                </div>
                            </div>

                            <div v-for="group in visiblePermissionGroups" :key="group.title" class="space-y-2">
                                <div class="px-1 flex items-center justify-between gap-2">
                                    <div class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                        {{ group.title }}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-[10px] font-bold text-gray-400">{{ getGroupStats(group).enabled }}/{{ getGroupStats(group).total }}</span>
                                        <button type="button" @click="setGroupPermissions(group, !getGroupStats(group).all)" :disabled="!canManageUsers || isSaving" class="px-2.5 h-7 rounded-lg text-[10px] font-black uppercase tracking-wider bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-200 disabled:opacity-50">
                                            {{ getGroupStats(group).all ? 'Снять блок' : 'Включить блок' }}
                                        </button>
                                    </div>
                                </div>
                                <label v-for="perm in group.items" :key="perm.key" class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-white/5 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                                    <div class="flex flex-col pr-3">
                                        <span class="font-bold text-xs text-[#1d1d1f] dark:text-white">{{ perm.label }}</span>
                                        <span class="text-[10px] text-gray-400 mt-0.5">{{ perm.desc }}</span>
                                    </div>
                                    <div class="relative inline-flex items-center cursor-pointer shrink-0">
                                        <input type="checkbox" v-model="localPermissions[perm.key]" :disabled="!canManageUsers || isSaving" class="sr-only peer">
                                        <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black dark:peer-checked:bg-white dark:peer-checked:after:border-black dark:peer-checked:after:bg-black"></div>
                                    </div>
                                </label>
                            </div>

                            <div v-if="!visiblePermissionGroups.length" class="text-[11px] text-gray-400 font-bold p-3 rounded-2xl bg-gray-50 dark:bg-white/5 text-center">
                                Для роли {{ selectedUserRole }} нет настраиваемых прав.
                            </div>
                        </div>

                        <div v-if="saveError" class="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-3 py-2 text-xs font-bold">
                            {{ saveError }}
                        </div>

                        <div class="flex gap-3 shrink-0">
                            <button @click="closeDetails" class="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 font-bold text-sm hover:bg-gray-200 transition-colors">Отмена</button>
                            <button @click="savePermissions" :disabled="isSaving" class="flex-1 h-12 rounded-xl bg-black dark:bg-white text-white dark:text-black font-bold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed" v-if="canManageUsers">{{ isSaving ? 'Сохранение...' : 'Сохранить' }}</button>
                        </div>

                    </div>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped>
.kanban-column { transition: background-color 0.3s; }
.user-card { background: white; @apply dark:bg-[#2C2C2E]; border-radius: 1rem; padding: 0.75rem; display: flex; align-items: center; gap: 0.75rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02); cursor: pointer; transition: all 0.2s ease; }
.user-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.06); }
.ghost-card { opacity: 0.4; background: #F3F4F6; border: 2px dashed #9CA3AF; }
.modal-scale-enter-active, .modal-scale-leave-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.modal-scale-enter-from, .modal-scale-leave-to { opacity: 0; transform: scale(0.9); }
.custom-scroll::-webkit-scrollbar { width: 4px; }
.custom-scroll::-webkit-scrollbar-track { background: transparent; }
.custom-scroll::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.1); border-radius: 10px; }
</style>