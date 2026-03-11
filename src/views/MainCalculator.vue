<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useDevice } from '@/composables/useDevice';

const MobileApp = defineAsyncComponent(() => import('@/components/MobileApp.vue'));
const DesktopApp = defineAsyncComponent(() => import('@/components/DesktopApp.vue'));
const DtfApp = defineAsyncComponent(() => import('@/components/DtfApp.vue'));

const { isMobile } = useDevice();
const router = useRouter();
const route = useRoute();

const calculatorId = computed(() => route.params.id || 'laser');
const forceDesktop = computed(() => route.query.view === 'desktop');
const showMobileApp = computed(() => isMobile.value && !forceDesktop.value);
const isDtfCalculator = computed(() => calculatorId.value === 'dtf');

const goBack = () => {
    router.push('/');
};
</script>

<template>
    <div class="relative min-h-screen bg-white dark:bg-[#121212] transition-colors duration-300">
        <DtfApp v-if="isDtfCalculator" />
        <MobileApp v-else-if="showMobileApp" :calculator-id="calculatorId" @go-home="goBack" />
        <DesktopApp v-else :calculator-id="calculatorId" />
    </div>
</template>