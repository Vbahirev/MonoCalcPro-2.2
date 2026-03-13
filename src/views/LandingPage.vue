<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useHaptics } from '@/composables/useHaptics';
import { useTheme } from '@/composables/useTheme';
import { useDatabase } from '@/composables/useDatabase'; 
import { calculatorList } from '@/core/calculators/registry';
import { auth } from '@/services/firebase';
import { signOut } from 'firebase/auth';
import AuthLogin from '@/components/AuthLogin.vue';

// !!! ВАШ EMAIL АДМИНА !!!
const ADMIN_EMAIL = 'viktor19971997@gmail.com'; 

const router = useRouter();
const { impactLight, impactMedium } = useHaptics();
const { theme, setTheme } = useTheme(); 
const { syncStatus, initDatabase, hasPermission, user: currentUser, isOfflineMode } = useDatabase(); 
const currentYear = new Date().getFullYear();

// --- СОСТОЯНИЕ ---
const showLoginModal = ref(false);
const showLogoutInCapsule = ref(false);
const loginFireworks = ref([]);
const lockLogoutCapsule = ref(false);

// Статус для верхней капсулы
const headerStatus = ref(null); 
const statusTimeout = ref(null);
const LOGIN_CELEBRATION_KEY = 'calpro_login_celebration';
let loginFireworkCounter = 0;
let loginFireworksTimer = null;
let lastLoginFireworksAt = 0;

// --- ЛОГИКА ТЕКСТА КАПСУЛЫ ---
const capsuleText = computed(() => {
    if (headerStatus.value) return headerStatus.value;

    return isOfflineMode.value ? 'ОФЛАЙН' : 'ПЕЧАТНЫЙ ДВОР';
});

const isAdmin = computed(() => {
    const isSuperAdmin = currentUser.value && currentUser.value.email && currentUser.value.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return isSuperAdmin || hasPermission('canViewSettings');
});

const canViewSettings = computed(() => isAdmin.value);
const canViewHistory = computed(() => hasPermission('canSaveHistory'));
const canUseCloudSections = computed(() => !isOfflineMode.value);

onMounted(() => {
    initDatabase(); 
});

onUnmounted(() => {
    if (statusTimeout.value) clearTimeout(statusTimeout.value);
    if (loginFireworksTimer) {
        clearTimeout(loginFireworksTimer);
        loginFireworksTimer = null;
    }
});

const showHeaderNotification = (text) => {
    if (statusTimeout.value) clearTimeout(statusTimeout.value);
    headerStatus.value = text;
    impactMedium();
    statusTimeout.value = setTimeout(() => {
        headerStatus.value = null;
    }, 2500);
};

const triggerLoginFireworks = () => {
    const palette = ['#60A5FA', '#34D399', '#F472B6', '#FBBF24', '#A78BFA', '#F87171'];
    const salvos = 6;
    const allParticles = [];

    for (let salvoIndex = 0; salvoIndex < salvos; salvoIndex++) {
        const salvoDelay = salvoIndex * 460 + Math.floor(Math.random() * 120);
        const originX = Math.round((Math.random() - 0.5) * 190);
        const originY = Math.round(-10 + Math.random() * 44);
        const particlesCount = 10 + Math.floor(Math.random() * 8);

        for (let particleIndex = 0; particleIndex < particlesCount; particleIndex++) {
            const angleRad = (Math.random() * 360 * Math.PI) / 180;
            const distance = 30 + Math.random() * 84;
            allParticles.push({
                id: `landing-burst-${Date.now()}-${loginFireworkCounter++}-${salvoIndex}-${particleIndex}`,
                originX,
                originY,
                offsetX: Math.round(Math.cos(angleRad) * distance),
                offsetY: Math.round(Math.sin(angleRad) * distance),
                delayMs: salvoDelay + Math.floor(Math.random() * 170),
                durationMs: 760 + Math.floor(Math.random() * 680),
                sizePx: 3 + Math.random() * 7,
                color: palette[Math.floor(Math.random() * palette.length)]
            });
        }
    }

    if (loginFireworksTimer) clearTimeout(loginFireworksTimer);
    loginFireworks.value = allParticles;
    loginFireworksTimer = setTimeout(() => {
        loginFireworks.value = [];
        loginFireworksTimer = null;
    }, 3400);
};

const launchLoginCelebration = () => {
    const now = Date.now();
    if (now - lastLoginFireworksAt < 1200) return;
    lastLoginFireworksAt = now;
    setTimeout(() => {
        triggerLoginFireworks();
    }, 420);
};

const handleLoginSuccess = () => {
    showLoginModal.value = false;
    showLogoutInCapsule.value = false;
    lockLogoutCapsule.value = true;
    setTimeout(() => {
        lockLogoutCapsule.value = false;
    }, 3600);
    try {
        window.sessionStorage.setItem(LOGIN_CELEBRATION_KEY, '1');
    } catch (e) {}
    launchLoginCelebration();
    showHeaderNotification('ВХОД ВЫПОЛНЕН');
};

const onCapsuleMouseEnter = () => {
    if (lockLogoutCapsule.value) return;
    showLogoutInCapsule.value = true;
};

const onCapsuleMouseLeave = () => {
    showLogoutInCapsule.value = false;
};

watch(currentUser, (user) => {
    if (!user) return;
    let hasPendingCelebration = false;
    try {
        hasPendingCelebration = window.sessionStorage.getItem(LOGIN_CELEBRATION_KEY) === '1';
    } catch (e) {}
    if (!hasPendingCelebration) return;
    try {
        window.sessionStorage.removeItem(LOGIN_CELEBRATION_KEY);
    } catch (e) {}
    launchLoginCelebration();
}, { immediate: true });

const handleLogout = async () => {
    await signOut(auth);
    showHeaderNotification('ВЫХОД ВЫПОЛНЕН');
};

// --- ЛОГИКА ТЕГОВ ---
const activeTag = ref('all');
const tags = computed(() => {
    const base = [{ id: 'all', label: 'Все' }];
    const map = new Map();
    calculatorList.forEach(m => {
        if (!m.category) return;
        if (!map.has(m.category)) map.set(m.category, m.category);
    });
    const labelMap = { laser: 'Лазерная резка', printing: 'Полиграфия', textile: 'Текстиль', dtf: 'Нанесение на текстиль' };
    return base.concat([...map.keys()].map(id => ({ id, label: labelMap[id] || id })));
});

const modules = computed(() => {
    return calculatorList.map(m => ({
        ...m,
        action: () => { impactMedium(); router.push(`/calc/${m.id}`); }
    }));
});

const filteredModules = computed(() => {
    const list = modules.value;
    if (activeTag.value === 'all') return list;
    return list.filter(m => m.category === activeTag.value);
});

const selectTag = (tagId) => { impactLight(); activeTag.value = tagId; };
const openSettings = () => {
    impactLight();
    if (!canUseCloudSections.value) {
        showHeaderNotification('ОФЛАЙН: РАЗДЕЛ ВРЕМЕННО НЕДОСТУПЕН');
        return;
    }
    router.push('/settings');
};
const openHistory = () => {
    impactLight();
    if (!canUseCloudSections.value) {
        showHeaderNotification('ОФЛАЙН: РАЗДЕЛ ВРЕМЕННО НЕДОСТУПЕН');
        return;
    }
    router.push('/history');
};

// --- ТЕМА ---
const effectiveTheme = computed(() => {
    if (theme.value === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return theme.value;
});
const toggleIcon = computed(() => effectiveTheme.value === 'dark' ? 'moon' : 'sun');

const runThemeTransition = async (event, newThemeValue) => {
    impactMedium();
    if (theme.value === newThemeValue) return;
    if (!document.startViewTransition) { setTheme(newThemeValue); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(async () => { setTheme(newThemeValue); await nextTick(); });
    await transition.ready;
    document.documentElement.animate(
        [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` }],
        { duration: 700, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)", pseudoElement: "::view-transition-new(root)" }
    );
};
const toggleLightDark = (event) => runThemeTransition(event, effectiveTheme.value === 'dark' ? 'light' : 'dark');
const setSystemTheme = (event) => runThemeTransition(event, 'system');
</script>

<template>
  <div class="min-h-screen bg-[#F5F5F7] dark:bg-[#121212] flex flex-col items-center justify-center p-4 relative overflow-hidden py-6">
    
    <div class="max-w-5xl w-full relative z-10 flex flex-col flex-1 items-center justify-center">
      
      <div class="text-center mb-6 flex flex-col items-center animate-fade-in-up">
        
        <div class="relative h-8 w-64 mb-4 backdrop-blur-sm border rounded-full shadow-sm overflow-hidden flex items-center justify-center transition-colors duration-500"
             :class="{
                     'bg-red-50/60 dark:bg-red-900/20 border-red-400/40': isOfflineMode && !headerStatus,
                     'bg-white/60 dark:bg-white/5 border-gray-200/60 dark:border-white/10': !isOfflineMode || headerStatus
             }">
            <Transition name="clock-scroll" mode="out-in">
                <div :key="capsuleText" class="absolute w-full text-center">
                    <h2 class="text-[10px] md:text-xs font-black uppercase tracking-[0.25em] whitespace-nowrap transition-colors duration-300"
                        :class="{
                            'text-red-500 dark:text-red-300': isOfflineMode && !headerStatus,
                            'text-gray-400 dark:text-gray-500': !isOfflineMode || headerStatus
                        }">
                        {{ capsuleText }}
                    </h2>
                </div>
            </Transition>
        </div>

        <div class="relative inline-block mb-8">
            <h1 class="relative z-10 text-5xl md:text-7xl font-black text-[#1d1d1f] dark:text-white tracking-tighter leading-none">
              MonoCalc <span class="inline-block py-2 pr-2 text-transparent bg-clip-text bg-gradient-to-br from-gray-600 to-black dark:from-gray-300 dark:to-white">Pro</span>
            </h1>
            
            <h1 class="absolute top-[-0.2em] left-0 w-full text-5xl md:text-7xl font-black text-[#1d1d1f]/40 dark:text-white/30 tracking-tighter leading-none 
                       transform scale-y-[-1] origin-bottom blur-[1px] pointer-events-none reflection-mask select-none z-0">
              MonoCalc <span class="inline-block py-2 pr-2 text-transparent bg-clip-text bg-gradient-to-br from-gray-400/50 to-black/50 dark:from-gray-500/50 dark:to-white/50">Pro</span>
            </h1>
        </div>
        
        <p class="text-gray-500 dark:text-gray-400 text-sm md:text-base mb-8 max-w-md mx-auto leading-relaxed font-bold tracking-tight relative z-20">
          Профессиональный расчет производства
        </p>

        <div class="w-full flex flex-col items-center justify-center min-h-[90px] mb-8 relative z-30">
            <div class="absolute inset-0 pointer-events-none flex items-center justify-center" aria-hidden="true">
                <div class="landing-fireworks-stage">
                    <span
                        v-for="particle in loginFireworks"
                        :key="particle.id"
                        class="landing-firework-dot"
                        :style="{
                            '--bx': `${particle.originX}px`,
                            '--by': `${particle.originY}px`,
                            '--tx': `${particle.offsetX}px`,
                            '--ty': `${particle.offsetY}px`,
                            '--delay': `${particle.delayMs}ms`,
                            '--duration': `${particle.durationMs}ms`,
                            '--size': `${particle.sizePx}px`,
                            '--dot-color': particle.color
                        }"
                    ></span>
                </div>
            </div>

            <Transition name="fade-slide" mode="out-in">
                
                <div v-if="!currentUser" key="login">
                    <button 
                        @click="showLoginModal = true"
                        class="group flex items-center gap-3 w-44 pl-1.5 pr-4 py-1.5 bg-[#1d1d1f] dark:bg-[#1C1C1E] text-white dark:text-white rounded-full shadow-lg border border-transparent dark:border-white/10
                               will-change-transform transform-gpu transition-transform duration-300 ease-out 
                               hover:scale-105 active:scale-95 cursor-pointer"
                    >
                        <div class="w-10 h-10 rounded-full bg-white/10 dark:bg-white/10 flex items-center justify-center text-white dark:text-white border border-white/5 dark:border-white/5 relative overflow-visible shrink-0">
                            <div class="v8-group">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible;">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" class="v8-shackle"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="flex flex-col items-start text-left">
                            <span class="text-[8px] font-bold text-white/50 dark:text-white/50 uppercase tracking-[0.15em] leading-none mb-1">Доступ</span>
                            <span class="text-sm font-bold leading-none tracking-wide">Войти</span>
                        </div>
                    </button>
                </div>

                <div v-else key="admin" class="flex flex-col items-center gap-4 md:gap-5 w-full">

                    <div class="relative flex items-center justify-center w-full animate-fade-in-up delay-100">
                        <div
                            class="w-full max-w-[340px]"
                            @mouseenter="onCapsuleMouseEnter"
                            @mouseleave="onCapsuleMouseLeave"
                        >
                            <div class="flex items-center gap-3 pl-2 pr-4 py-2 bg-white/50 dark:bg-[#1C1C1E]/50 backdrop-blur-md rounded-full border border-white/20 dark:border-white/5 shadow-sm">
                                <div class="w-10 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-black text-sm uppercase shadow-inner shrink-0">
                                    <Transition name="clock-scroll" mode="out-in">
                                        <span v-if="!showLogoutInCapsule" key="avatar-email">{{ currentUser.email[0] }}</span>
                                        <svg v-else key="avatar-logout" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                                    </Transition>
                                </div>

                                <div class="flex-1 min-w-0 h-10 flex items-center">
                                    <Transition name="clock-scroll" mode="out-in">
                                        <div v-if="!showLogoutInCapsule" key="capsule-email" class="w-full flex flex-col items-start">
                                            <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Добро пожаловать</span>
                                            <span class="text-xs font-black text-[#1d1d1f] dark:text-white leading-none truncate max-w-[220px]">{{ currentUser.email }}</span>
                                        </div>

                                        <button
                                            v-else
                                            key="capsule-logout"
                                            @click="handleLogout"
                                            class="w-full h-full rounded-full bg-red-50/80 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-500 dark:text-red-300 text-[10px] font-black uppercase tracking-[0.18em] hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                        >
                                            Выход
                                        </button>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="relative z-20 flex flex-wrap justify-center gap-4">
                        
                                                <button v-if="canViewSettings"
                          @click="openSettings"
                                                    :disabled="!canUseCloudSections"
                          class="group flex items-center gap-3 w-40 pl-1.5 pr-4 py-1.5 bg-[#1d1d1f] dark:bg-[#1C1C1E] text-white dark:text-white rounded-full shadow-lg border border-transparent dark:border-white/10
                                 will-change-transform transform-gpu transition-transform duration-300 ease-out 
                                                                 hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div class="w-10 h-10 rounded-full bg-white/10 dark:bg-white/10 flex items-center justify-center text-white dark:text-white border border-white/5 dark:border-white/5 shrink-0">
                                <svg class="transition-transform duration-500 group-hover:rotate-90" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            </div>
                            <div class="flex flex-col items-start text-left">
                                <span class="text-[8px] font-bold text-white/50 dark:text-white/50 uppercase tracking-[0.15em] leading-none mb-1">Система</span>
                                <span class="text-sm font-bold leading-none tracking-wide">Настройки</span>
                            </div>
                        </button>

                                                <button v-if="canViewHistory"
                          @click="openHistory"
                                                    :disabled="!canUseCloudSections"
                          class="group flex items-center gap-3 w-40 pl-1.5 pr-4 py-1.5 bg-[#1d1d1f] dark:bg-[#1C1C1E] text-white dark:text-white rounded-full shadow-lg border border-transparent dark:border-white/10
                                 will-change-transform transform-gpu transition-transform duration-300 ease-out 
                                                                 hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div class="w-10 h-10 rounded-full bg-white/10 dark:bg-white/10 flex items-center justify-center text-white dark:text-white border border-white/5 dark:border-white/5 shrink-0">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="12" x2="16" y2="14" style="transform-origin: 12px 12px;" class="transition-transform duration-700 ease-out group-hover:rotate-[60deg]" />
                                    <line x1="12" y1="12" x2="12" y2="6" style="transform-origin: 12px 12px;" class="transition-transform duration-700 ease-out group-hover:rotate-[360deg]" />
                                </svg>
                            </div>
                            <div class="flex flex-col items-start text-left">
                                <span class="text-[8px] font-bold text-white/50 dark:text-white/50 uppercase tracking-[0.15em] leading-none mb-1">Архив</span>
                                <span class="text-sm font-bold leading-none tracking-wide">История</span>
                            </div>
                        </button>
                    </div>
                </div>
            </Transition>
        </div>

        <div class="relative z-30 mt-1 md:mt-2 w-full max-w-full px-4 pt-1 pb-3 overflow-visible">
            <div class="flex flex-wrap gap-2 justify-center py-1 overflow-visible">
                <button 
                    v-for="tag in tags" 
                    :key="tag.id"
                    @click="selectTag(tag.id)"
                    class="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-[background-color,border-color,color,box-shadow] duration-300 border shadow-sm whitespace-nowrap"
                    :class="activeTag === tag.id ? 'bg-[#1d1d1f] dark:bg-white/16 text-white dark:text-white border-black/40 dark:border-white/25 shadow-[0_3px_8px_rgba(0,0,0,0.20)] dark:shadow-[0_3px_8px_rgba(255,255,255,0.05)] ring-1 ring-black/20 dark:ring-white/15' : 'bg-white/45 dark:bg-white/5 text-gray-500 dark:text-gray-500 border-transparent hover:bg-white/85 dark:hover:bg-white/10 hover:text-gray-700 dark:hover:text-gray-300 hover:border-black/5 dark:hover:border-white/10 hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_6px_rgba(255,255,255,0.04)]'"
                >
                    {{ tag.label }}
                </button>
            </div>
        </div>

      </div>

      <TransitionGroup 
        tag="div" 
        name="list" 
        class="flex flex-wrap justify-center gap-3 md:gap-5 w-full pb-6 content-start"
      >
        <div 
          v-for="mod in filteredModules" 
          :key="mod.id"
          @click="mod.active ? mod.action() : null"
          class="group bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 md:p-5 border border-white dark:border-white/5 shadow-lg shadow-gray-200/50 dark:shadow-black/50 relative overflow-hidden ring-1 ring-black/5 dark:ring-white/5 flex flex-col justify-between transition-all duration-300
                 w-[calc(50%-0.5rem)] md:w-52 h-32 md:h-40" 
          :class="mod.active ? 'cursor-pointer hover:shadow-xl hover:shadow-blue-500/10 dark:hover:shadow-blue-900/20 hover:-translate-y-1' : 'opacity-70 cursor-not-allowed hover:opacity-100'"
        >
          <div class="absolute -bottom-4 -right-4 text-gray-100 dark:text-[#2A2A2A] transition-all duration-500"
               :class="mod.active ? 'group-hover:text-gray-50 dark:group-hover:text-[#333] group-hover:scale-110 group-hover:-rotate-12' : ''">
            <svg v-if="mod.iconType === 'laser'" xmlns="http://www.w3.org/2000/svg" class="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <svg v-if="mod.iconType === 'print'" xmlns="http://www.w3.org/2000/svg" class="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            <svg v-if="mod.iconType === 'shirt'" xmlns="http://www.w3.org/2000/svg" class="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.38 3.4a2 2 0 0 0-1.2-1.2l-3.2-.8a2.5 2.5 0 0 0-3.3 1.5 1 1 0 0 1-1.3 0 2.5 2.5 0 0 0-3.3-1.5l-3.2.8a2 2 0 0 0-1.2 1.2L2 10l4 1V21a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11l4-1z" /></svg>
          </div>
          
          <div class="relative z-10 flex flex-col h-full justify-between">
            <div class="flex justify-between items-start">
                <div class="h-9 w-9 bg-gray-50 dark:bg-white/10 rounded-xl flex items-center justify-center text-black dark:text-white shadow-inner transition-colors duration-300"
                      :class="mod.active ? 'group-hover:bg-black dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black' : 'text-gray-400 dark:text-gray-500'">
                   <svg v-if="mod.iconType === 'laser'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                   <svg v-if="mod.iconType === 'print'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                   <svg v-if="mod.iconType === 'shirt'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.38 3.4a2 2 0 0 0-1.2-1.2l-3.2-.8a2.5 2.5 0 0 0-3.3 1.5 1 1 0 0 1-1.3 0 2.5 2.5 0 0 0-3.3-1.5l-3.2.8a2 2 0 0 0-1.2 1.2L2 10l4 1V21a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11l4-1z" /></svg>
                </div>
                <div class="w-2 h-2 rounded-full shadow-sm" :class="mod.active ? 'bg-green-500 shadow-green-200 dark:shadow-none dark:bg-green-600' : 'bg-gray-300 dark:bg-gray-600'"></div>
            </div>
            <div>
                <h3 class="text-xs md:text-sm font-black text-gray-900 dark:text-white leading-tight mb-0.5" :class="!mod.active ? 'text-gray-400 dark:text-gray-600' : ''">{{ mod.name }}</h3>
                <p class="text-[9px] font-bold uppercase tracking-wide" :class="mod.active ? 'text-gray-400 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'">{{ mod.version }}</p>
            </div>
          </div>
        </div>
      </TransitionGroup>
      
      <div class="mt-auto text-center animate-fade-in-up delay-200 relative z-20">
         <p class="text-[9px] text-gray-400 dark:text-gray-600 uppercase tracking-[0.2em] font-bold mb-1">MonoCalc System</p>
         <p class="text-[9px] text-gray-300 dark:text-gray-700 font-bold tracking-widest mb-3">{{ currentYear }}</p>
         
         <div class="flex items-center justify-center gap-3"> <button 
                @click="toggleLightDark" 
                class="flex items-center gap-3 h-12 pl-5 pr-1.5 rounded-full bg-white dark:bg-[#1C1C1E] border border-gray-100 dark:border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-black/20 hover:shadow-lg active:scale-95 transition-transform duration-300 group cursor-pointer"
             >
                <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 group-hover:text-black dark:group-hover:text-white transition-colors">
                    {{ toggleIcon === 'sun' ? 'Светлая' : 'Тёмная' }}
                </span>
                <div class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 dark:bg-white/10 text-gray-400 dark:text-gray-300 group-hover:bg-yellow-50 dark:group-hover:bg-blue-900/30 group-hover:text-yellow-500 dark:group-hover:text-blue-300 transition-colors">
                    <svg v-if="toggleIcon === 'sun'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                </div>
             </button>

             <button 
                @click="setSystemTheme"
                class="w-12 h-12 flex items-center justify-center rounded-full border border-gray-100 dark:border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-black/20 hover:shadow-lg active:scale-95 transition-transform duration-300 group cursor-pointer"
                :class="theme === 'system' 
                    ? 'bg-black dark:bg-white text-white dark:text-black shadow-md' 
                    : 'bg-white dark:bg-[#1C1C1E] text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white'"
                title="Системная тема"
             >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
             </button>

             
         </div>
      </div>

    </div>

    <Transition name="fade">
        <AuthLogin v-if="showLoginModal" @close="showLoginModal = false" @success="handleLoginSuccess" />
    </Transition>

  </div>
</template>

<style>
/* CSS RESETS */
html {
  background-color: #F5F5F7;
  transition: none !important;
}
html.dark {
  background-color: #121212;
}
body {
  margin: 0;
  padding: 0;
  background-color: inherit;
  transition: none !important;
}

/* ИСПРАВЛЕННЫЙ ГРАДИЕНТ МАСКИ: 50% прозрачности */
.reflection-mask {
  -webkit-mask-image: linear-gradient(to bottom, transparent 50%, black 100%);
  mask-image: linear-gradient(to bottom, transparent 50%, black 100%);
}

.animate-fade-in-up { animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; transform: translateY(20px); }
.delay-100 { animation-delay: 0.1s; }
.delay-200 { animation-delay: 0.2s; }
@keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }
.list-move, .list-enter-active, .list-leave-active { transition: all 0.5s cubic-bezier(0.55, 0, 0.1, 1); }
.list-leave-active { position: absolute; }
.list-enter-from, .list-leave-to { opacity: 0; transform: scale(0.95); }

/* Анимация кнопок панели */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* АНИМАЦИЯ ЧАСОВ (БАРАБАН) */
.clock-scroll-enter-active,
.clock-scroll-leave-active {
    transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.clock-scroll-enter-from {
  opacity: 0;
    transform: translateY(10px);
}
.clock-scroll-leave-to {
  opacity: 0;
    transform: translateY(-10px);
}

/* ВАРИАНТ 8: SHAKE & OPEN */
.v8-group { transform-origin: center; }
.v8-shackle { transform-origin: 17px 11px; transition: transform 0.2s ease-out 0.2s; }

/* Ховер-эффекты на группе (родительской кнопке) */
.group:hover .v8-group {
    animation: v8-shake 0.3s ease-in-out;
}
.group:hover .v8-shackle {
    transform: translateY(-2px) rotate(25deg);
}

/* Ключевые кадры тряски */
@keyframes v8-shake {
    0%, 100% { transform: rotate(0); }
    25% { transform: rotate(-10deg); }
    75% { transform: rotate(10deg); }
}

/* VIEW TRANSITIONS */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
::view-transition-new(root) {
  z-index: 9999;
}
::view-transition-old(root) {
  z-index: 1;
}

.landing-fireworks-stage {
    position: relative;
    width: 300px;
    height: 140px;
}

.landing-firework-dot {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--size);
    height: var(--size);
    border-radius: 9999px;
    background: var(--dot-color);
    opacity: 0;
    box-shadow: 0 0 10px color-mix(in oklab, var(--dot-color) 70%, white 30%);
    transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(0.3);
    animation: landing-firework-burst var(--duration) cubic-bezier(0.16, 1, 0.3, 1) forwards;
    animation-delay: var(--delay);
}

@keyframes landing-firework-burst {
    0% {
        opacity: 0;
        transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(0.2);
    }
    12% {
        opacity: 1;
    }
    55% {
        opacity: 0.9;
    }
    100% {
        opacity: 0;
        transform: translate(calc(-50% + var(--bx) + var(--tx)), calc(-50% + var(--by) + var(--ty))) scale(0.15);
    }
}
</style>