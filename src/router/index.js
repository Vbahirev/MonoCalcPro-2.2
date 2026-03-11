import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'

const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')

const router = createRouter({
  history: isGitHubPages
    ? createWebHashHistory(import.meta.env.BASE_URL)
    : createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/LandingPage.vue')
    },
    {
      path: '/calc/:id',
      name: 'calculator',
      component: () => import('../views/MainCalculator.vue')
    },
    { path: '/laser', redirect: '/calc/laser' },
    { path: '/dtf', redirect: '/calc/dtf' },

    {
      path: '/history',
      name: 'history',
      component: () => import('../views/HistoryView.vue')
    },

    // --- НОВАЯ СТРУКТУРА НАСТРОЕК ---
    {
      path: '/settings',
      name: 'settings-hub',
      component: () => import('../views/SettingsHub.vue')
    },
    {
      path: '/settings/laser',
      name: 'settings-laser',
      component: () => import('../views/LaserSettings.vue')
    },
    {
      path: '/settings/dtf',
      name: 'settings-dtf',
      component: () => import('../views/DtfSettings.vue')
    },
    {
      path: '/settings/trash',
      name: 'settings-trash',
      component: () => import('../views/TrashView.vue')
    },

    // --- Архив удалённых данных ---
    {
      path: '/settings/archive',
      name: 'settings-archive',
      component: () => import('../views/ArchiveView.vue')
    },

    // --- Администрирование: структура данных (STEP 1-4) ---
    {
      path: '/admin/data-audit',
      name: 'admin-data-audit',
      component: () => import('../views/AdminDataAudit.vue')
    },
  ]
})

export default router
