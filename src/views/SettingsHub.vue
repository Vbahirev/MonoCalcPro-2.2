<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDatabase } from '@/composables/useDatabase'; 
import { useHaptics } from '@/composables/useHaptics';
import { PageScrollWrapper } from '@/ui-core'; 
import ModernSelect from '@/components/ModernSelect.vue';
import UserKanban from '@/components/admin/UserKanban.vue'; 
import { buildDeepSearchBlob, getSearchVariants, matchesSearchBlob, matchesSearchQuery, normalizeSearchValue } from '@/utils/searchIndex';

const router = useRouter();
const route = useRoute();
const { impactLight } = useHaptics();
const {
    hasPermission,
    userRole,
    isOfflineMode,
    materials,
    coatings,
    processingDB,
    accessoriesDB,
    packagingDB,
    designDB,
    settings,
} = useDatabase(); // Используем проверку прав

const queryCalcId = computed(() => {
    const raw = route.query.calc;
    if (Array.isArray(raw)) return raw[0] || 'laser';
    return raw || 'laser';
});

const navigationQuery = computed(() => {
    if (route.query.from === 'calc') {
        return { from: 'calc', calc: queryCalcId.value };
    }
    return {};
});

// --- СОСТОЯНИЕ ---
const activeHubTag = ref('all');
const searchQuery = ref('');
const showTeamModal = ref(false); 

// --- СТИЛИ ---
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

// --- ДАННЫЕ ---
const hubTags = computed(() => {
    const tags = [
        { id: 'all', label: 'Все' },
        { id: 'laser', label: 'Лазер' },
        { id: 'printing', label: 'Полиграфия' },
        { id: 'textile', label: 'Текстиль' }
    ];
    // Показываем "Администрирование" только если есть право
    if (hasPermission('canManageTeam')) {
        tags.push({ id: 'admin', label: 'Администрирование' });
    }
    return tags;
});

const modules = [
    { 
        id: 'laser', 
        name: 'Лазерная резка', 
        desc: 'Глобальные параметры лазера: цена минуты, скорость, коэффициенты', 
        active: true, 
        category: 'laser', 
        iconType: 'laser', 
        route: '/settings/laser',
        resultSections: [
            {
                id: 'config',
                label: 'Конфигурация',
                tab: 'config',
                single: true,
                title: 'Конфигурация лазера',
                source: (ctx) => ctx.settings,
            },
            { id: 'materials', label: 'Материалы', tab: 'materials', source: (ctx) => ctx.materials },
            { id: 'coatings', label: 'Покрытия', tab: 'coatings', source: (ctx) => ctx.coatings },
            { id: 'processing', label: 'Услуги', tab: 'processing', source: (ctx) => ctx.processing },
            { id: 'accessories', label: 'Фурнитура', tab: 'accessories', source: (ctx) => ctx.accessories },
            { id: 'packaging', label: 'Упаковка', tab: 'packaging', source: (ctx) => ctx.packaging },
            { id: 'design', label: 'Дизайн', tab: 'design', source: (ctx) => ctx.design },
        ],
        searchSource: () => ({
            calculatorId: 'laser',
            settings: settings.value,
            materials: materials.value,
            coatings: coatings.value,
            processing: processingDB.value,
            accessories: accessoriesDB.value,
            packaging: packagingDB.value,
            design: designDB.value,
        }),
        // legacy + canonical (покажем модуль, если доступ к настройкам разрешён)
        permission: ['canViewSettings', 'settings.global.view', 'settings.laser.view'],
        keywords: ['лазер', 'резка', 'гравировка', 'минуты', 'скорость', 'мощность', 'настройки', 'глобальные']
    },

    { 
        id: 'poly', 
        name: 'Цифровая печать', 
        desc: 'Настройки печати (Скоро)', 
        active: false, 
        category: 'printing', 
        iconType: 'print', 
        route: '/settings/poly',
        keywords: ['бумага', 'визитки', 'листовки', 'а4', 'а3', 'цвет', 'черно-белая']
    },
    { 
        id: 'dtf', 
        name: 'Нанесение на текстиль', 
        desc: 'Отдельный контур настроек печати на текстиле: пресеты, рулоны, себестоимость и запуск отдельного калькулятора.', 
        active: true, 
        category: 'textile', 
        iconType: 'shirt', 
        route: '/settings/dtf',
        permission: ['canViewSettings', 'settings.global.view', 'settings.laser.view'],
        keywords: ['футболка', 'худи', 'пленка', 'нанесение', 'ткань', 'хлопок'],
},
];

const adminModulesData = [
    {
        id: 'trash',
        name: 'Корзина удалённых данных',
        desc: 'Восстановление, контроль сроков хранения и удаление записей навсегда',
        action: () => openModule({ id: 'trash', active: true, route: '/settings/trash' }),
        iconType: 'trash',
        category: 'admin',
        keywords: ['архив', 'удаленные', 'восстановить', 'очистка', 'контроль', 'администрирование']
    },
    {
        id: 'data-audit',
        name: 'Структура данных',
        desc: 'Просмотр и безопасное редактирование данных (с подготовкой логов).',
        action: () => openModule({ id: 'data-audit', active: true, route: '/admin/data-audit' }),
        iconType: 'database',
        category: 'admin',
        superOnly: true,
        keywords: ['структура', 'данные', 'firestore', 'логи', 'audit', 'администрирование']
    },
    {
        id: 'team',
        name: 'Команда',
        desc: 'Управление доступом, ролями и правами сотрудников.',
        action: () => showTeamModal.value = true,
        iconType: 'team',
        category: 'admin',
        keywords: ['сотрудники', 'права', 'доступ', 'роли', 'админ', 'пользователи', 'персонал']
    }
];

const moduleDeepIndex = computed(() => {
    const index = {};

    modules.forEach((moduleItem) => {
        const source = typeof moduleItem?.searchSource === 'function'
            ? moduleItem.searchSource()
            : null;

        if (!source) {
            index[moduleItem.id] = '';
            return;
        }

        // NOTE: maxDepth/maxItems keep search responsive while still indexing most nested params.
        index[moduleItem.id] = buildDeepSearchBlob(source, 4, 140);
    });

    return index;
});

const isModuleVisibleByTag = (moduleItem) => {
    return activeHubTag.value === 'all' || moduleItem.category === activeHubTag.value;
};

const safeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const buildDetailMeta = (sectionId, item) => {
    if (!item || typeof item !== 'object') return '';

    if (sectionId === 'config') {
        const minOrder = safeNumber(item.minimumOrderPrice);
        const minuteCost = safeNumber(item.laserMinuteCost);
        const engraving = safeNumber(item.engravingPrice);
        const parts = [];
        if (minOrder !== null) parts.push(`Мин. заказ ${minOrder}`);
        if (minuteCost !== null) parts.push(`Минута ${minuteCost}`);
        if (engraving !== null) parts.push(`Грав. ${engraving}`);
        return parts.join(' · ');
    }

    const parts = [];
    const type = normalizeSearchValue(item.type);
    const priceBySection = sectionId === 'materials'
        ? safeNumber(item.sheetPrice)
        : sectionId === 'processing'
            ? safeNumber(item.value ?? item.price)
            : safeNumber(item.price);
    const markup = safeNumber(item.markupPercent);

    if (type) parts.push(type);
    if (priceBySection !== null) parts.push(`${priceBySection}`);
    if (markup !== null && markup > 0) parts.push(`+${markup}%`);

    if (sectionId === 'materials') {
        const thickness = safeNumber(item.thickness);
        if (thickness !== null) parts.push(`${thickness} мм`);
    }

    return parts.slice(0, 3).join(' · ');
};

const detailedSearchResults = computed(() => {
    const query = searchQuery.value;
    const variants = getSearchVariants(query);
    if (!variants.length) return [];

    const results = [];

    modules
        .filter(m => canAccess(m))
        .filter(m => isModuleVisibleByTag(m))
        .forEach((moduleItem) => {
            const source = typeof moduleItem?.searchSource === 'function'
                ? moduleItem.searchSource()
                : null;
            const sections = Array.isArray(moduleItem?.resultSections) ? moduleItem.resultSections : [];

            if (!source || !sections.length) return;

            sections.forEach((section) => {
                const raw = typeof section?.source === 'function' ? section.source(source) : null;

                if (section?.single) {
                    const blob = buildDeepSearchBlob(raw, 3, 120);
                    if (!matchesSearchBlob(blob, query)) return;

                    results.push({
                        id: `${moduleItem.id}:${section.id}:single`,
                        moduleName: moduleItem.name,
                        moduleRoute: moduleItem.route,
                        sectionLabel: section.label,
                        sectionTab: section.tab || section.id,
                        title: section.title || section.label,
                        meta: buildDetailMeta(section.id, raw),
                        score: 1,
                    });
                    return;
                }

                const list = Array.isArray(raw) ? raw : [];
                list.forEach((entry, index) => {
                    const blob = buildDeepSearchBlob(entry, 3, 80);
                    if (!matchesSearchBlob(blob, query)) return;

                    const title = String(entry?.name || entry?.label || `${section.label} ${index + 1}`).trim();
                    const normalizedTitle = normalizeSearchValue(title);
                    const score = variants.some(v => normalizedTitle.includes(v)) ? 2 : 1;

                    results.push({
                        id: `${moduleItem.id}:${section.id}:${entry?.id || index}`,
                        moduleName: moduleItem.name,
                        moduleRoute: moduleItem.route,
                        sectionLabel: section.label,
                        sectionTab: section.tab || section.id,
                        itemId: String(entry?.id || ''),
                        title,
                        meta: buildDetailMeta(section.id, entry),
                        score,
                    });
                });
            });
        });

    return results
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'))
        .slice(0, 24);
});

// --- ЛОГИКА ФИЛЬТРАЦИИ ---

const matchesSearch = (moduleItem) => {
    const baseMatch = matchesSearchQuery({
        name: moduleItem?.name,
        desc: moduleItem?.desc,
        keywords: moduleItem?.keywords,
        category: moduleItem?.category,
        route: moduleItem?.route,
    }, searchQuery.value);

    if (baseMatch) return true;

    const deepBlob = moduleDeepIndex.value?.[moduleItem?.id] || '';
    if (!deepBlob) return false;

    return matchesSearchBlob(deepBlob, searchQuery.value);
};

const canAccess = (moduleItem) => {
    if (moduleItem.superOnly && userRole.value !== 'superadmin') return false;
    if (!moduleItem.permission) return true;
    if (Array.isArray(moduleItem.permission)) return moduleItem.permission.some(p => hasPermission(p));
    return hasPermission(moduleItem.permission);
};

// Фильтруем обычные модули
const filteredModules = computed(() => {
    return modules
        .filter(m => canAccess(m))
    .filter(m => isModuleVisibleByTag(m))
        .filter(m => matchesSearch(m));
});

// Фильтруем админские модули
const filteredAdminModules = computed(() => {
    if (userRole.value !== 'superadmin' && !hasPermission('canManageTeam')) return [];
    if (activeHubTag.value !== 'all' && activeHubTag.value !== 'admin') return [];

    return adminModulesData
        .filter(m => canAccess(m))
        .filter(m => matchesSearch(m));
});

const openModule = (mod, extraQuery = {}) => {
    if (!mod.active) return;
    impactLight();
    router.push({
        path: mod.route,
        query: {
            ...navigationQuery.value,
            ...extraQuery,
        },
    });
};

const openDetailedResult = (result) => {
    impactLight();
    const nextQuery = {
        ...navigationQuery.value,
        q: searchQuery.value,
        tab: result.sectionTab,
    };

    if (result?.itemId) {
        nextQuery.item = result.itemId;
    }

    router.push({
        path: result.moduleRoute,
        query: nextQuery,
    });
};

const goBack = () => {
    impactLight();
    if (route.query.from === 'calc') {
        router.push(`/calc/${queryCalcId.value}`);
        return;
    }
    router.push('/');
};

onMounted(() => {
    if (!isOfflineMode.value) return;

    if (route.query.from === 'calc') {
        router.replace(`/calc/${queryCalcId.value}`);
        return;
    }

    router.replace('/');
});
</script>

<template>
    <div class="h-screen w-full bg-[#F5F5F7] dark:bg-[#121212] overflow-hidden flex flex-col relative transition-colors duration-500">
        <PageScrollWrapper class="flex-1">
            <div class="pb-32 pt-2 relative min-h-full flex flex-col w-full pt-6">
                <div class="max-w-5xl mx-auto px-5 w-full relative z-10">
                    
                    <div class="flex items-center justify-center relative mb-8 animate-fade-in-down">
                        <h1 class="text-3xl md:text-5xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none text-center px-6 py-2 transition-colors duration-300">Настройки</h1>
                    </div>
                    
                    <div class="relative flex flex-col sm:flex-row gap-4 w-full mb-8 animate-fade-in-up z-40 items-center">
                        
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
                                placeholder="Найти модуль или любой параметр..."
                            >
                            <button v-if="searchQuery" @click="searchQuery=''" class="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-black dark:hover:text-white cursor-pointer z-10">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        <ModernSelect 
                            v-model="activeHubTag" 
                            :options="hubTags" 
                            placeholder="Категория"
                            :class="btnClass"
                            class="sm:w-auto w-full px-0" 
                        />
                    </div>

                    <div class="space-y-8 animate-fade-in-up" style="animation-delay: 0.1s;">
                        
                        <div v-if="filteredAdminModules.length > 0">
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest ml-4 mb-3" v-if="activeHubTag === 'all'">Администрирование</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div v-for="mod in filteredAdminModules" :key="mod.id" 
                                     @click="mod.action()"
                                     class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 border border-gray-100 dark:border-white/5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] dark:shadow-black/30 transition-all duration-300 group relative overflow-hidden flex items-start gap-5 cursor-pointer transform-gpu no-flicker hover:shadow-2xl hover:-translate-y-1 hover:border-gray-200 dark:hover:border-white/20"
                                >
                                    <div class="w-14 h-14 bg-gray-50 dark:bg-white/5 rounded-2xl flex items-center justify-center text-gray-800 dark:text-gray-200 group-hover:bg-black dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-all duration-300 group-hover:scale-110 shrink-0 shadow-inner">
                                        <svg v-if="mod.iconType === 'team'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                        <svg v-if="mod.iconType === 'trash'" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                        <svg v-if="mod.iconType === 'database'" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>
                                    </div>
                                    
                                    <div class="flex-1 min-w-0 pt-1 relative z-10">
                                        <h3 class="text-xl font-black text-gray-900 dark:text-white mb-1.5 leading-tight flex items-center gap-2">
                                            {{ mod.name }}
                                            <span class="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-[10px] uppercase font-bold tracking-wider text-gray-600 dark:text-gray-300">Admin</span>
                                        </h3>
                                        <p class="text-xs text-gray-500 dark:text-gray-400 font-medium leading-relaxed">{{ mod.desc }}</p>
                                    </div>
                                    
                                    <div class="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-4 group-hover:translate-x-0 text-black dark:text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></div>
                                </div>
                            </div>
                        </div>

                        <div v-if="filteredModules.length > 0">
                             <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest ml-4 mb-3" v-if="activeHubTag === 'all' && filteredAdminModules.length > 0">Модули</h3>
                             <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div v-for="mod in filteredModules" :key="mod.id" @click="openModule(mod)" 
                                     class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 border border-gray-100 dark:border-white/5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] dark:shadow-black/30 transition-all duration-300 group relative overflow-hidden flex items-start gap-5 transform-gpu no-flicker" 
                                     :class="mod.active ? 'cursor-pointer hover:shadow-2xl hover:-translate-y-1 hover:border-gray-200 dark:hover:border-white/20' : 'opacity-60 cursor-not-allowed grayscale-[0.5]'">
                                    
                                    <div class="w-14 h-14 bg-gray-50 dark:bg-white/5 rounded-2xl flex items-center justify-center text-gray-800 dark:text-gray-200 group-hover:bg-black dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-colors duration-300 shrink-0 shadow-inner">
                                        <svg v-if="mod.iconType === 'laser'" xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                        <svg v-if="mod.iconType === 'print'" xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                        <svg v-if="mod.iconType === 'shirt'" xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.38 3.4a2 2 0 0 0-1.2-1.2l-3.2-.8a2.5 2.5 0 0 0-3.3 1.5 1 1 0 0 1-1.3 0 2.5 2.5 0 0 0-3.3-1.5l-3.2.8a2 2 0 0 0-1.2 1.2L2 10l4 1V21a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11l4-1z" /></svg>
                                        <svg v-if="mod.iconType === 'trash'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3m-4 0h14" /></svg>
                                    </div>
                                    <div class="flex-1 min-w-0 pt-1"><h3 class="text-xl font-black text-gray-900 dark:text-white mb-1.5 leading-tight">{{ mod.name }}</h3><p class="text-xs text-gray-500 dark:text-gray-400 font-medium leading-relaxed">{{ mod.desc }}</p></div>
                                    <div v-if="mod.active" class="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-4 group-hover:translate-x-0 text-black dark:text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></div>
                                </div>
                            </div>
                        </div>

                        <div v-if="detailedSearchResults.length > 0">
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest ml-4 mb-3">Точные совпадения</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div
                                    v-for="result in detailedSearchResults"
                                    :key="result.id"
                                    @click="openDetailedResult(result)"
                                    class="bg-white dark:bg-[#1C1C1E] rounded-3xl p-5 border border-gray-100 dark:border-white/5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] dark:shadow-black/30 transition-all duration-300 group relative overflow-hidden cursor-pointer transform-gpu no-flicker hover:shadow-2xl hover:-translate-y-1 hover:border-gray-200 dark:hover:border-white/20"
                                >
                                    <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                            <p class="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-1">{{ result.moduleName }} · {{ result.sectionLabel }}</p>
                                            <h4 class="text-lg font-black text-gray-900 dark:text-white leading-tight truncate">{{ result.title }}</h4>
                                            <p v-if="result.meta" class="text-xs text-gray-500 dark:text-gray-400 font-semibold mt-2 truncate">{{ result.meta }}</p>
                                        </div>
                                        <div class="text-black dark:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div v-if="filteredModules.length === 0 && filteredAdminModules.length === 0 && detailedSearchResults.length === 0" class="text-center py-20 text-gray-400 font-bold bg-white dark:bg-[#1C1C1E] rounded-3xl border border-dashed border-gray-200 dark:border-white/10">
                            Ничего не найдено
                        </div>

                    </div>
                </div>
            </div>
        </PageScrollWrapper>

        <Teleport to="body">
            <Transition name="modal-up">
                <div v-if="showTeamModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 sm:p-6" @click.self="showTeamModal = false">
                    <div class="modal-up-card bg-[#F5F5F7] dark:bg-[#121212] w-full max-w-5xl h-[85vh] rounded-[2.5rem] p-6 md:p-10 shadow-2xl overflow-hidden flex flex-col relative border border-white/20 ring-1 ring-black/5">
                        
                        <div class="flex items-center justify-between mb-6 shrink-0">
                            <div>
                                <h2 class="text-3xl font-black text-[#1d1d1f] dark:text-white tracking-tighter">Управление командой</h2>
                            </div>
                            <button @click="showTeamModal = false" class="w-12 h-12 rounded-full bg-white dark:bg-[#1C1C1E] shadow-sm flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        <div class="flex-1 overflow-y-auto custom-scroll pr-1">
                            <UserKanban />
                        </div>

                    </div>
                </div>
            </Transition>
        </Teleport>

    </div>
</template>

<style scoped>
.animate-fade-in-down { animation: fadeInDown 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards; opacity: 0; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

.no-flicker {
    will-change: transform;
    backface-visibility: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

/* Скроллбар для модалки */
.custom-scroll::-webkit-scrollbar { width: 4px; }
.custom-scroll::-webkit-scrollbar-track { background: transparent; }
.custom-scroll::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.1); border-radius: 10px; }
.dark .custom-scroll::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.1); }

/* Анимация модалки "снизу вверх" */
.modal-up-enter-active, .modal-up-leave-active { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.modal-up-enter-from, .modal-up-leave-to { opacity: 0; }
.modal-up-enter-from .modal-up-card,
.modal-up-leave-to .modal-up-card { transform: translateY(40px) scale(0.95); opacity: 0; }
</style>