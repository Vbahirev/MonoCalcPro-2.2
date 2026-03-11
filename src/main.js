import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// Apply theme BEFORE app mount to prevent first-frame flicker.
// Keep in sync with useTheme composable key.
const THEME_KEY = 'monocalc-theme-preference'
try {
	const saved = localStorage.getItem(THEME_KEY) || 'system'
	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
	const isDark = saved === 'dark' || (saved === 'system' && prefersDark)
	document.documentElement.classList.toggle('dark', isDark)
	document.documentElement.classList.add('theme-ready')
} catch {
	// no-op: keep app boot resilient in restricted environments
}

const app = createApp(App)

app.use(router)

app.mount('#app')

