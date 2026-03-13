import { ref, computed, watch } from 'vue';

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ ---
// Храним состояние вне функции, чтобы оно было единым для всего приложения
const THEME_KEY = 'monocalc-theme-preference'; // Ключ для памяти браузера
const safeReadTheme = () => {
    try {
        return localStorage.getItem(THEME_KEY) || 'system';
    } catch {
        return 'system';
    }
};
const theme = ref(safeReadTheme()); // Читаем из памяти или ставим system

// Следим за системной темой в реальном времени
const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
const systemIsDark = ref(Boolean(mediaQuery?.matches));

// Слушатель изменений системы (если ты поменял тему в Windows/iOS, не перезагружая сайт)
if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener('change', (e) => {
        systemIsDark.value = e.matches;
        if (theme.value === 'system') {
            applyTheme();
        }
    });
}

// --- ФУНКЦИЯ ПРИМЕНЕНИЯ ТЕМЫ К HTML ---
const applyTheme = () => {
    const root = document.documentElement;
    const isDark = 
        theme.value === 'dark' || 
        (theme.value === 'system' && systemIsDark.value);

    if (isDark) {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
};

export function useTheme() {
    
    // Функция установки темы (вызывается кнопками)
    const setTheme = (newTheme) => {
        theme.value = newTheme;
        try {
            localStorage.setItem(THEME_KEY, newTheme); // <-- СОХРАНЯЕМ В ПАМЯТЬ
        } catch {}
        applyTheme();
    };

    // Вычисляемое свойство: "Сейчас темно?" (для иконок луны/солнца)
    const isDark = computed(() => {
        return theme.value === 'dark' || (theme.value === 'system' && systemIsDark.value);
    });

    // Инициализация (нужно вызвать один раз при старте приложения)
    const initTheme = () => {
        applyTheme();
    };

    return {
        theme,
        isDark,
        setTheme,
        initTheme
    };
}