<script setup>
import { ref } from 'vue';
import { auth } from '@/services/firebase';
import { 
    GoogleAuthProvider, 
    signInWithPopup,
    signInWithRedirect
} from 'firebase/auth';

const emit = defineEmits(['close', 'success']);

const isLoading = ref(false);
const errorMsg = ref('');

// Универсальная функция входа
const performLogin = async (method) => {
    isLoading.value = true;
    errorMsg.value = '';
    try {
        await method();
        // Если вход успешен — просто сообщаем наверх
        emit('success');
        emit('close');
    } catch (e) {
        if (
            e.code === 'auth/wrong-password' ||
            e.code === 'auth/user-not-found' ||
            e.code === 'auth/invalid-credential' ||
            e.code === 'auth/invalid-login-credentials'
        ) {
            errorMsg.value = 'Неверный email или пароль';
        } else if (e.code === 'auth/operation-not-allowed') {
            errorMsg.value = 'Email/Password вход отключён в Firebase Authentication';
        } else if (e.code === 'auth/popup-closed-by-user') {
            errorMsg.value = ''; // Пользователь просто закрыл окно
        } else if (e.code === 'auth/too-many-requests') {
            errorMsg.value = 'Слишком много попыток входа. Попробуйте позже';
        } else {
            errorMsg.value = 'Ошибка входа: ' + (e?.message || e?.code || 'неизвестная ошибка');
        }
    } finally {
        isLoading.value = false;
    }
};

const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    isLoading.value = true;
    errorMsg.value = '';
    try {
        await signInWithPopup(auth, provider);
        emit('success');
        emit('close');
    } catch (e) {
        const isPopupIssue = (
            e?.code === 'auth/popup-blocked' ||
            e?.code === 'auth/cancelled-popup-request' ||
            String(e?.message || '').toLowerCase().includes('cross-origin-opener-policy')
        );

        if (isPopupIssue) {
            await signInWithRedirect(auth, provider);
            return;
        }

        if (e.code === 'auth/popup-closed-by-user') {
            errorMsg.value = '';
        } else {
            errorMsg.value = 'Ошибка входа: ' + (e?.message || e?.code || 'неизвестная ошибка');
        }
    } finally {
        isLoading.value = false;
    }
};
</script>

<template>
    <div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" @click.self="$emit('close')">
        <div class="relative w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl p-6 overflow-hidden transform transition-all animate-pop-in border border-white/10">
            
            <button @click="$emit('close')" class="absolute top-4 right-4 p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div class="text-center mb-6 mt-2">
                <h2 class="text-2xl font-black text-[#1d1d1f] dark:text-white tracking-tight">Вход</h2>
                <p class="text-xs text-gray-500 font-medium mt-1">Для сохранения проектов</p>
            </div>

            <div class="space-y-3">
                <button @click="handleGoogleLogin" :disabled="isLoading" class="w-full h-12 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors active:scale-[0.98]">
                    <img src="https://www.svgrepo.com/show/475656/google-color.svg" class="w-5 h-5" />
                    <span>Войти через Google</span>
                </button>

                <p v-if="errorMsg" class="text-xs text-red-500 text-center font-bold mt-2 bg-red-50 dark:bg-red-900/20 py-2 rounded-lg">{{ errorMsg }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.animate-pop-in { animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
</style>