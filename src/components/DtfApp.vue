<script setup>
import { computed } from 'vue';
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue';
import ModernSelect from '@/components/ModernSelect.vue';
import AuthLogin from '@/components/AuthLogin.vue';
import Tooltip from '@/components/Tooltip.vue';
import DtfHeader from '@/components/dtf/DtfHeader.vue';
import DtfTotalsSidebar from '@/components/dtf/DtfTotalsSidebar.vue';
import InvoiceModal from '@/components/InvoiceModal.vue';
import { useCalculator } from '@/core/useCalculator';
import draggable from 'vuedraggable';

const {
  PRODUCT_TYPES,
  SIZE_KEYS,
  PLACEMENT_PRESETS,
  TECH_OPTIONS,
  FLEX_COLOR_OPTIONS,
  FLEX_PRICE_TIERS,
  SUBLIMATION_FORMATS,
  DTF_LAYER_PRESETS,
  currentUser,
  canViewHistory,
  canViewSettings,
  canUseCloud,
  isOfflineMode,
  statusConfig,
  activeTab,
  showSaveProjectModal,
  saveModalNotice,
  isManualSaving,
  showAuthModal,
  showResetConfirm,
  showSizeGridExitConfirm,
  showInvoice,
  showScrollTop,
  toast,
  saveFireworks,
  project,
  productQty,
  productType,
  sizeGridEnabled,
  sizeGrid,
  blankPrice,
  defaultBlankPrice,
  isBlankPriceCustom,
  currentProductType,
  currentProductRiskMarkupPercent,
  canUseSizeGrid,
  sizeGridTotal,
  layers,
  packaging,
  packagingOptions,
  rollWidthMm,
  pricePerCm2,
  totalPrints,
  totalLinearM,
  dtfRollSummaryRows,
  materialTotal,
  packagingTotal,
  blankTotal,
  markupAmt,
  discountAmt,
  pricePerOne,
  totalForAll,
  isCostVisible,
  dtfTotals,
  invoicePayload,
  layerAreaCm2,
  layerCost,
  effectivePricePerCm2,
  layerValidationMessage,
  applyPlacementPreset,
  addLayer,
  removeLayer,
  duplicateLayer,
  addPackaging,
  removePackaging,
  onPkgSelect,
  openSaveProjectModal,
  handleManualSaveToHistory,
  openSettings,
  openHistory,
  changeMarkup,
  changeDiscount,
  changeProductQty,
  setBlankPrice,
  stepBlankPrice,
  resetBlankPriceToDefault,
  addLayerPreset,
  requestToggleSizeGrid,
  keepGridTotalAsProductQty,
  resetGridAndProductQty,
  cancelSizeGridExit,
  stepUp,
  stepDown,
  toggleCostVisibility,
  openInvoiceModal,
  copyQuote,
  onInvoicePrint,
  requestReset,
  confirmReset,
  onBeforeEnter,
  onEnter,
  onAfterEnter,
  onBeforeLeave,
  onLeave,
  scrollToTop,
  getTextClass,
  showToast,
  runToastAction,
} = useCalculator('dtf');

const layerKindGroups = computed(() => [
  {
    name: 'Типовые виды',
    items: DTF_LAYER_PRESETS
      .filter((item) => (item.layers || []).length === 1)
      .map((item) => ({ value: item.id, label: item.label })),
  },
  {
    name: 'Свободный вариант',
    items: [{ value: 'custom', label: 'Другое' }],
  },
]);

const placementPresetGroups = computed(() => [
  {
    name: 'Основные форматы',
    items: PLACEMENT_PRESETS.filter((item) => ['a3', 'a4', 'a5', 'a6'].includes(item.id)).map((item) => ({ value: item.id, label: `${item.label} · ${item.w}×${item.h} мм` })),
  },
  {
    name: 'Логотипы и спецформаты',
    items: PLACEMENT_PRESETS.filter((item) => ['logo_10'].includes(item.id)).map((item) => ({ value: item.id, label: `${item.label} · ${item.w}×${item.h} мм` })),
  },
  {
    name: 'Свободный ввод',
    items: [{ value: 'custom', label: 'Свои размеры' }],
  },
]);

const sublimationFormatsList = computed(() => (Array.isArray(SUBLIMATION_FORMATS.value) ? SUBLIMATION_FORMATS.value : []));
const sublimationFormatGroups = computed(() => [
  {
    name: 'Листы сублимации',
    items: sublimationFormatsList.value.map((item) => ({ value: item.id, label: `${item.label} · ${item.w}×${item.h} мм` })),
  },
]);

const getSublimationFormat = (formatId) => {
  const formats = sublimationFormatsList.value;
  return formats.find((item) => item.id === (formatId || 'a4')) || formats[0] || { id: 'custom', label: 'Формат', w: 0, h: 0 };
};

const getLayerKindValue = (layer) => {
  if (layer?.layerKind) return layer.layerKind;

  const singleLayerPreset = DTF_LAYER_PRESETS.find((item) => {
    const presetLayer = item?.layers?.[0];
    if ((item?.layers || []).length !== 1 || !presetLayer) return false;
    if ((presetLayer?.name || '') !== (layer?.name || '')) return false;
    if (!presetLayer?.placement) return true;
    return presetLayer.placement === layer?.placement;
  });

  return singleLayerPreset?.id || 'custom';
};

const applyLayerKindSelection = (layer, value) => {
  if (!layer) return;

  layer.layerKind = value || 'custom';
  if (!value || value === 'custom') {
    layer.name = 'Другое';
    return;
  }

  const preset = DTF_LAYER_PRESETS.find((item) => item.id === value);
  const presetLayer = preset?.layers?.[0];
  if (!preset || !presetLayer) return;

  layer.name = presetLayer.name || preset.label || layer.name;
  if (presetLayer.placement) applyPlacementPreset(layer, presetLayer.placement);
};

const onLayerSortEnd = () => showToast('Порядок слоёв обновлён');
const onPackagingSortEnd = () => showToast('Порядок упаковки обновлён');
</script>

<template>
  <div class="desktop-calc w-full max-w-7xl container mx-auto p-5 md:p-7 text-sm text-[#18181B] dark:text-gray-100">

    <AppBreadcrumbs />

    <DtfHeader
      :current-user="currentUser"
      :status-config="statusConfig"
      :can-view-history="canViewHistory"
      :can-use-cloud="canUseCloud"
      :can-view-settings="canViewSettings"
      @open-auth="showAuthModal = true"
      @open-save-project="openSaveProjectModal"
      @open-history="openHistory"
      @open-settings="openSettings"
    />

    <!-- ======= TABS ======= -->
    <div class="flex overflow-x-auto gap-1.5 mb-6 p-1.5 bg-gray-100 dark:bg-white/5 rounded-2xl no-print">
      <button
        v-for="(name, key) in { garment: '1. Изделие', layers: '2. Виды печати', packaging: '3. Упаковка' }"
        :key="key"
        @click="activeTab = key"
        class="calc-tab-btn flex-1 py-3 px-4 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wide whitespace-nowrap relative overflow-hidden"
        :class="activeTab === key ? 'calc-tab-btn-active' : 'calc-tab-btn-idle'"
      >
        {{ name }}
      </button>
    </div>

    <!-- ======= MAIN GRID ======= -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 no-print">

      <!-- ===== LEFT CONTENT ===== -->
      <div class="lg:col-span-2 min-h-[500px]">
        <Transition name="page-switch" mode="out-in">

          <!-- === ИЗДЕЛИЕ TAB === -->
          <div v-if="activeTab === 'garment'" key="garment">
            <div class="card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10">
              <div class="layer-header flex justify-between items-center p-4">
                <span class="font-bold text-sm uppercase tracking-widest text-[#18181B] dark:text-white">Изделие и количество</span>
                <div class="flex items-center gap-2 text-[11px] font-black text-gray-600 dark:text-gray-300">
                  <span>{{ currentProductType.label }}</span>
                  <span>·</span>
                  <span>{{ sizeGridEnabled ? Math.max(sizeGridTotal, 0) || productQty : productQty }} шт</span>
                </div>
              </div>
              <div class="layer-card-body px-5 pb-5 pt-3 grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
                <div class="md:col-span-5">
                  <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Текстильное изделие</label>
                  <ModernSelect
                    v-model="productType"
                    :options="PRODUCT_TYPES.map((item) => ({ value: item.id, label: item.label }))"
                    placeholder="Выберите изделие"
                  />
                </div>

                <div class="md:col-span-3">
                  <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Количество</label>
                  <div v-if="!sizeGridEnabled || !canUseSizeGrid" class="grid grid-cols-[48px_minmax(0,1fr)_48px] items-stretch h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden mt-2">
                    <button @click="changeProductQty(-1)" class="h-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors border-r border-gray-200 dark:border-white/10">−</button>
                    <input type="number" min="1" :value="productQty" @input="changeProductQty($event)" class="min-w-0 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current" placeholder="1">
                    <button @click="changeProductQty(1)" class="h-full flex items-center justify-center text-black dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border-l border-gray-200 dark:border-white/10" aria-label="Увеличить количество">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                  </div>
                  <div v-else class="mt-2 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 flex items-center justify-between">
                    <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Из сетки</span>
                    <span class="text-sm font-black text-[#18181B] dark:text-white">{{ sizeGridTotal }} шт</span>
                  </div>
                </div>

                <div class="md:col-span-4">
                  <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цена изделия, ₽/шт</label>
                  <div class="grid grid-cols-[48px_minmax(0,1fr)_48px] items-stretch h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden mt-2">
                    <button @click="stepBlankPrice(-50)" class="h-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors border-r border-gray-200 dark:border-white/10">−</button>
                    <input type="number" min="0" :value="blankPrice" @input="setBlankPrice($event.target.value)" class="min-w-0 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                    <button @click="stepBlankPrice(50)" class="h-full flex items-center justify-center text-black dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border-l border-gray-200 dark:border-white/10" aria-label="Увеличить цену изделия">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                  </div>
                </div>

                <div class="md:col-span-12 grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4">
                  <div v-if="canUseSizeGrid" class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Размерная сетка</p>
                        <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Если размеры отличаются, включите сетку и заполните количества.</p>
                      </div>
                      <button
                        @click="requestToggleSizeGrid"
                        class="relative w-10 h-6 rounded-full transition-colors shrink-0"
                        :class="sizeGridEnabled ? 'bg-black dark:bg-white' : 'bg-gray-200 dark:bg-white/20'"
                      >
                        <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white dark:bg-black transition-transform" :class="sizeGridEnabled ? 'translate-x-4' : ''"></span>
                      </button>
                    </div>
                    <div v-if="sizeGridEnabled" class="mt-4">
                      <div class="grid grid-cols-5 md:grid-cols-10 gap-1.5">
                        <div v-for="sz in SIZE_KEYS" :key="sz" class="flex flex-col items-center gap-1">
                          <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase">{{ sz }}</span>
                          <input
                            type="number" min="0"
                            :value="sizeGrid[sz]"
                            @input="sizeGrid[sz] = Math.max(0, parseInt($event.target.value) || 0)"
                            class="w-full h-10 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/10 text-center text-xs font-black outline-none dark:text-white"
                            placeholder="0"
                          >
                        </div>
                      </div>
                      <p class="mt-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">Итого по сетке: <span class="font-black text-[#18181B] dark:text-white">{{ sizeGridTotal }} шт</span></p>
                    </div>
                  </div>
                  <div class="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-4">
                    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Сумма по изделиям</p>
                    <p class="mt-1 text-lg font-black text-[#18181B] dark:text-white">{{ Math.round(blankTotal).toLocaleString() }} ₽</p>
                    <p v-if="currentProductType.clientOwned" class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Изделие клиента не добавляет закупку. Риск на нанесение: {{ currentProductRiskMarkupPercent }}%</p>
                    <p v-else class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">База: {{ Math.round(defaultBlankPrice).toLocaleString() }} ₽/шт</p>
                    <button v-if="isBlankPriceCustom" @click="resetBlankPriceToDefault" class="mt-3 inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 transition-colors hover:text-black dark:hover:text-white">
                      Вернуть цену из настроек
                    </button>
                  </div>
                </div>

                <div v-if="currentProductType.clientOwned" class="md:col-span-12 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  Для изделия клиента закупка по умолчанию равна нулю, а процент из настроек применяется как риск-наценка к стоимости нанесения.
                </div>

                <div v-if="!canUseSizeGrid" class="md:col-span-12 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  Для выбранного изделия размерная сетка не используется.
                </div>
              </div>
            </div>

          </div>

          <!-- === НАНЕСЕНИЕ TAB === -->
          <div v-else-if="activeTab === 'layers'" key="layers">
            <div class="calc-section-head flex justify-between items-center mb-4">
              <div class="flex items-center gap-2">
                <h2 class="section-title">Принты и нанесение</h2>
                <Tooltip text="Стоимость = площадь принта × цена выбранной технологии × количество. Флекс дополнительно учитывает материал и число цветов.">
                  <div class="w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-black hover:text-white dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white dark:hover:text-black flex items-center justify-center text-[10px] font-bold transition-colors shadow-sm">?</div>
                </Tooltip>
              </div>
              <button @click="addLayer" class="btn-add h-11 px-4 whitespace-nowrap">Добавить вид</button>
            </div>

            <!-- Layer cards -->
            <Transition name="fade" mode="out-in">
              <draggable
                v-if="layers.length"
                key="list"
                v-model="layers"
                item-key="id"
                tag="div"
                class="space-y-4"
                handle=".drag-handle"
                :animation="200"
                ghost-class="ghost-card"
                @end="onLayerSortEnd"
              >
                <template #item="{ element: l }">
                <div
                  class="layer-stack-item card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0"
                  :class="l.expanded
                    ? 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10'
                    : 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 hover:bg-[#18181B] dark:hover:bg-white hover:border-black dark:hover:border-white'"
                >
                  <!-- Layer header -->
                  <div
                    @click="l.expanded = !l.expanded"
                    class="layer-header flex justify-between items-center select-none cursor-pointer transition-colors duration-200 px-4 py-3"
                    :class="{ 'is-expanded': l.expanded }"
                  >
                    <div class="flex items-center gap-2.5 flex-1 min-w-0">
                      <div class="drag-handle shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white transition-colors" @click.stop>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
                          <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
                        </svg>
                      </div>
                      <div class="shrink-0 transition-transform duration-300" :class="l.expanded ? 'rotate-180 text-gray-400' : 'text-black dark:text-white group-hover:text-white dark:group-hover:text-black'">
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1L5 5L9 1"/></svg>
                      </div>
                      <span
                        class="font-bold text-[13px] uppercase tracking-[0.18em] truncate transition-colors"
                        :class="l.expanded ? 'text-[#18181B] dark:text-white' : 'text-[#18181B] dark:text-white group-hover:text-white dark:group-hover:text-black'"
                      >{{ l.name || 'Вид' }}</span>
                    </div>
                    <div class="shrink-0 ml-3 flex items-center gap-2">
                      <span v-if="!l.expanded && l.tech !== 'sublimation' && l.w && l.h" class="text-[11px] font-bold text-gray-400 group-hover:text-white/70 dark:group-hover:text-black/70 transition-colors">{{ l.w }}×{{ l.h }}мм · {{ l.qty }}шт</span>
                      <span v-if="!l.expanded && l.tech === 'sublimation'" class="text-[11px] font-bold text-gray-400 group-hover:text-white/70 dark:group-hover:text-black/70 transition-colors">{{ getSublimationFormat(l.sublimationFormat).label }} · {{ l.qty }}шт</span>
                      <span v-if="!l.expanded && l.tech && !layerValidationMessage(l) && (l.tech === 'sublimation' || (l.w && l.h))" class="text-[11px] font-black text-gray-600 dark:text-gray-300 group-hover:text-white dark:group-hover:text-black transition-colors">{{ Math.round(layerCost(l)).toLocaleString() }} ₽</span>
                      <button v-if="l.expanded" @click.stop="duplicateLayer(l)" class="text-gray-300 dark:text-gray-500 hover:text-black dark:hover:text-white font-bold text-[11px] no-print transition-colors">Копировать</button>
                      <button v-if="l.expanded" @click.stop="removeLayer(l.id)" class="text-gray-300 dark:text-gray-500 hover:text-red-500 font-bold text-[11px] no-print transition-colors">Удалить</button>
                    </div>
                  </div>

                  <!-- Layer body -->
                  <transition name="collapse" @before-enter="onBeforeEnter" @enter="onEnter" @after-enter="onAfterEnter" @before-leave="onBeforeLeave" @leave="onLeave">
                    <div v-show="l.expanded" class="layer-card-body px-5 pb-5 pt-3 space-y-4">

                      <div class="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
                      <div :class="l.tech === 'sublimation' ? 'md:col-span-5 min-w-0' : 'md:col-span-4 min-w-0'">
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Технология</label>
                        <ModernSelect
                          v-model="l.tech"
                          :options="TECH_OPTIONS.map((item) => ({ value: item.id, label: item.label }))"
                          placeholder="Выберите"
                        />
                      </div>

                      <div :class="l.tech === 'sublimation' ? 'md:col-span-7 min-w-0' : 'md:col-span-4 min-w-0'">
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Вид слоя</label>
                        <ModernSelect
                          :model-value="getLayerKindValue(l)"
                          :grouped="layerKindGroups"
                          placeholder="Выберите"
                          @update:model-value="(value) => applyLayerKindSelection(l, value)"
                        />
                      </div>

                      <div v-if="l.tech !== 'sublimation'" class="md:col-span-4 min-w-0">
                        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Формат печати</label>
                        <ModernSelect
                          :model-value="PLACEMENT_PRESETS.find((item) => item.id === l.placement) ? l.placement : 'custom'"
                          :grouped="placementPresetGroups"
                          placeholder="Выберите"
                          @update:model-value="(value) => applyPlacementPreset(l, value)"
                        />
                      </div>
                      </div>



                      <!-- Flex options (Flex only) -->
                      <div v-if="l.tech === 'flex'" class="md:col-span-12 grid grid-cols-1 md:grid-cols-12 gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-3">
                        <div class="md:col-span-8">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Материал флекса</label>
                          <ModernSelect
                            v-model="l.flexColorType"
                            :options="FLEX_COLOR_OPTIONS.map((item) => ({ value: item.id, label: `${item.label} (×${item.coeff})` }))"
                            placeholder="Выберите материал флекса"
                          />
                        </div>
                        <div class="md:col-span-4">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цветов в макете</label>
                          <div class="grid grid-cols-[44px_minmax(0,1fr)_44px] items-stretch h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden mt-2">
                            <button @click="l.flexColorsCount = Math.max(1, (Number(l.flexColorsCount)||1) - 1)" class="h-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-lg transition-colors border-r border-gray-200 dark:border-white/10">−</button>
                            <input type="number" min="1" max="6" :value="l.flexColorsCount || 1" @input="l.flexColorsCount = Math.min(6, Math.max(1, parseInt($event.target.value) || 1))" class="min-w-0 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current">
                            <button @click="l.flexColorsCount = Math.min(6, Math.max(1, (Number(l.flexColorsCount)||1) + 1))" class="h-full flex items-center justify-center text-black dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border-l border-gray-200 dark:border-white/10" aria-label="Увеличить количество цветов">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                          </div>
                          <p class="text-[10px] text-gray-400 mt-1">Наценка: <span class="font-black text-[#18181B] dark:text-white">{{ (FLEX_PRICE_TIERS[Math.min((l.flexColorsCount||1) - 1, FLEX_PRICE_TIERS.length - 1)] || FLEX_PRICE_TIERS[0]).label }} · +{{ (FLEX_PRICE_TIERS[Math.min((l.flexColorsCount||1) - 1, FLEX_PRICE_TIERS.length - 1)] || FLEX_PRICE_TIERS[0]).markupPercent }}%</span></p>
                        </div>
                      </div>

                      <!-- Size inputs (hidden for sublimation) -->
                      <div v-if="l.tech !== 'sublimation'" class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div class="md:col-span-8 grid grid-cols-12 gap-2 items-end min-w-0">
                          <div class="col-span-5">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Ширина (мм)</label>
                            <input
                              type="number" min="0" v-model.number="l.w"
                              class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 text-sm outline-none caret-current"
                              :class="getTextClass(l.w)"
                              placeholder="Ш"
                            >
                          </div>
                          <div class="col-span-2 flex items-center justify-center pb-2">
                            <span class="text-gray-400 font-bold text-base">✕</span>
                          </div>
                          <div class="col-span-5">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Высота (мм)</label>
                            <input
                              type="number" min="0" v-model.number="l.h"
                              class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 text-sm outline-none caret-current"
                              :class="getTextClass(l.h)"
                              placeholder="В"
                            >
                          </div>
                        </div>

                        <div class="md:col-span-4 min-w-0">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Количество</label>
                          <div class="grid grid-cols-[48px_minmax(0,1fr)_48px] items-stretch h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden">
                            <button @click="stepDown(l, 'qty', 1, 1)" class="h-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors border-r border-gray-200 dark:border-white/10">−</button>
                            <input
                              type="number" min="1" v-model.number="l.qty"
                              class="min-w-0 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current"
                              :class="getTextClass(l.qty)"
                            >
                            <button @click="stepUp(l, 'qty', 1)" class="h-full flex items-center justify-center text-black dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border-l border-gray-200 dark:border-white/10" aria-label="Увеличить количество слоя">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      <div v-if="l.tech && !layerValidationMessage(l) && l.tech !== 'sublimation' && (l.w && l.h)" class="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-4 py-3 flex items-center justify-between gap-4 min-w-0">
                        <div class="min-w-0">
                          <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Стоимость</p>
                          <p class="mt-1 text-xs font-bold text-gray-500 dark:text-gray-400 truncate">{{ layerAreaCm2(l).toFixed(1) }} см² × {{ effectivePricePerCm2(l).toFixed(4) }} ₽ × {{ l.qty }} шт</p>
                        </div>
                        <span class="shrink-0 text-xl font-black text-[#18181B] dark:text-white">{{ Math.round(layerCost(l)).toLocaleString() }} ₽</span>
                      </div>

                      <div v-if="layerValidationMessage(l)" class="md:col-span-12 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        <p class="text-[11px] font-medium leading-relaxed">{{ layerValidationMessage(l) }}</p>
                      </div>

                      <!-- Sublimation format selector -->
                      <div v-if="l.tech === 'sublimation'" class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div class="md:col-span-8 min-w-0">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Формат</label>
                          <ModernSelect
                            v-model="l.sublimationFormat"
                            :grouped="sublimationFormatGroups"
                            placeholder="Выберите формат"
                          />
                        </div>

                        <div class="md:col-span-4 min-w-0">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Количество</label>
                          <div class="grid grid-cols-[48px_minmax(0,1fr)_48px] items-stretch h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 overflow-hidden">
                            <button @click="stepDown(l, 'qty', 1, 1)" class="h-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-xl transition-colors border-r border-gray-200 dark:border-white/10">−</button>
                            <input type="number" min="1" v-model.number="l.qty" class="min-w-0 h-full bg-transparent text-center text-sm font-black outline-none dark:text-white caret-current" :class="getTextClass(l.qty)">
                            <button @click="stepUp(l, 'qty', 1)" class="h-full flex items-center justify-center text-black dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors border-l border-gray-200 dark:border-white/10" aria-label="Увеличить количество слоя">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      <div v-if="l.tech === 'sublimation' && !layerValidationMessage(l)" class="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-4 py-3 flex items-center justify-between gap-4 min-w-0">
                        <div class="min-w-0">
                          <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Стоимость</p>
                          <p class="text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {{ getSublimationFormat(l.sublimationFormat).label }}
                            · {{ ((getSublimationFormat(l.sublimationFormat).w * getSublimationFormat(l.sublimationFormat).h) / 100).toFixed(0) }} см²
                            × {{ effectivePricePerCm2(l).toFixed(4) }} ₽ × {{ l.qty }} шт
                          </p>
                        </div>
                        <span class="shrink-0 text-xl font-black text-[#18181B] dark:text-white">{{ Math.round(layerCost(l)).toLocaleString() }} ₽</span>
                      </div>

                    </div>
                  </transition>
                </div>
                </template>
              </draggable>

              <div v-else key="empty" class="rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-10 text-center mt-4">
                <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                </div>
                <h3 class="mt-4 text-sm font-black uppercase tracking-widest text-[#18181B] dark:text-white">Добавьте первый вид</h3>
                <p class="mt-2 text-xs font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400 max-w-md mx-auto">Один слой хранит один вид печати: например грудь, спина или отдельный вариант изделия.</p>
                <button @click="addLayer" class="mt-4 rounded-xl bg-black dark:bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-white dark:text-black transition-colors hover:bg-gray-800 dark:hover:bg-gray-200">Добавить вид</button>
              </div>
            </Transition>
          </div>

          <!-- === УПАКОВКА TAB === -->
          <div v-else-if="activeTab === 'packaging'" key="packaging">
            <div class="mb-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div class="min-w-0">
                <h2 class="text-sm font-black uppercase tracking-widest text-[#18181B] dark:text-white">Упаковка</h2>
                <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Необязательный шаг. Добавляйте упаковку только если она нужна в заказе.</p>
              </div>
              <button @click="addPackaging" class="btn-add whitespace-nowrap">Добавить упаковку</button>
            </div>

            <Transition name="fade" mode="out-in">
              <div v-if="packaging.length" key="list">
                <draggable
                  v-model="packaging"
                  item-key="id"
                  tag="div"
                  class="space-y-3"
                  handle=".drag-handle"
                  :animation="200"
                  ghost-class="ghost-card"
                  @end="onPackagingSortEnd"
                >
                  <template #item="{ element: item }">
                  <div
                    class="service-stack-item card layer-card relative group w-full min-w-0 transition-colors duration-300 !p-0"
                    :class="item.expanded !== false
                      ? 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10'
                      : 'bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 hover:bg-[#18181B] dark:hover:bg-white hover:border-black dark:hover:border-white'"
                  >
                    <div
                      @click="item.expanded = item.expanded === false"
                      class="layer-header flex justify-between items-center select-none cursor-pointer transition-colors duration-200 p-4"
                      :class="{ 'is-expanded': item.expanded !== false }"
                    >
                      <div class="flex items-center gap-3 flex-1 min-w-0">
                        <div class="drag-handle shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-black dark:hover:text-white transition-colors" @click.stop>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
                            <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
                          </svg>
                        </div>
                        <div class="shrink-0 transition-transform duration-300" :class="item.expanded !== false ? 'rotate-180 text-gray-400' : 'text-black dark:text-white group-hover:text-white dark:group-hover:text-black'">
                          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1L5 5L9 1"/></svg>
                        </div>
                        <span class="font-bold text-sm uppercase tracking-widest truncate transition-colors" :class="item.expanded !== false ? 'text-[#18181B] dark:text-white' : 'text-[#18181B] dark:text-white group-hover:text-white dark:group-hover:text-black'">
                          {{ item.name || 'Упаковка' }}
                        </span>
                      </div>
                      <div class="shrink-0 ml-4 flex items-center gap-2">
                        <span v-if="item.expanded === false" class="text-[11px] font-bold text-gray-400 group-hover:text-white/70 dark:group-hover:text-black/70 transition-colors">
                          {{ item.qty || 1 }} шт
                        </span>
                        <span v-if="item.expanded === false && item.price > 0" class="text-[11px] font-black text-gray-600 dark:text-gray-300 group-hover:text-white dark:group-hover:text-black transition-colors">
                          {{ Math.round((Number(item.price) || 0) * Math.max(1, Number(item.qty) || 1)).toLocaleString() }} ₽
                        </span>
                        <button v-if="item.expanded !== false" @click.stop="removePackaging(item.id)" class="text-gray-300 dark:text-gray-500 hover:text-red-500 font-bold text-xs no-print transition-colors">Удалить</button>
                      </div>
                    </div>

                    <transition name="collapse" @before-enter="onBeforeEnter" @enter="onEnter" @after-enter="onAfterEnter" @before-leave="onBeforeLeave" @leave="onLeave">
                      <div v-show="item.expanded !== false" class="layer-card-body px-5 pb-5 pt-3 grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
                        <div class="md:col-span-6">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Тип упаковки</label>
                          <ModernSelect v-model="item.dbId" :options="packagingOptions" @update:modelValue="val => onPkgSelect(item, val)" placeholder="Выберите упаковку" />
                        </div>

                        <div v-if="item.dbId" class="md:col-span-6 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3">
                          <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Системная цена</p>
                          <p class="mt-1 text-sm font-black text-[#18181B] dark:text-white">{{ Math.round(Number(item.seedPrice) || 0).toLocaleString() }} ₽</p>
                          <p class="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Можно менять локально в расчёте без изменения базы.</p>
                        </div>

                        <div v-if="item.dbId" class="md:col-span-12">
                      <!-- roll type -->
                      <div v-if="item.type === 'roll'" class="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div class="md:col-span-4">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Ширина рулона (мм)</label>
                          <input type="number" v-model.number="item.rollWidthMm" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="500">
                        </div>
                        <div class="md:col-span-4">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Длина (мм)</label>
                          <input type="number" v-model.number="item.length" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                        </div>
                        <div class="md:col-span-4">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цена (₽/пог.м)</label>
                          <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div class="md:col-span-4">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Кол-во</label>
                            <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                              <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                              <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                              <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <!-- box type -->
                      <div v-else-if="item.type === 'box_mm'" class="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div class="md:col-span-3">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Ш (мм)</label>
                            <input type="number" v-model.number="item.w" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                        </div>
                        <div class="md:col-span-3">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Д (мм)</label>
                            <input type="number" v-model.number="item.l" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                        </div>
                        <div class="md:col-span-3">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">В (мм)</label>
                            <input type="number" v-model.number="item.h" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 text-sm font-black outline-none dark:text-white caret-current text-center" placeholder="0">
                        </div>
                        <div class="md:col-span-3">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цена (₽/м²)</label>
                            <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current" placeholder="0">
                        </div>
                        <div class="md:col-span-3">
                            <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Кол-во</label>
                            <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                              <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                              <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                              <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                            </div>
                        </div>
                      </div>
                      <!-- default type -->
                      <div v-else class="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div class="md:col-span-6">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Цена (₽)</label>
                          <input type="number" v-model.number="item.price" class="w-full h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 text-sm font-black outline-none dark:text-white caret-current text-center">
                        </div>
                        <div class="md:col-span-6">
                          <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Кол-во</label>
                          <div class="flex items-center h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                            <button @click="stepDown(item, 'qty', 1, 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">−</button>
                            <input type="number" v-model.number="item.qty" class="flex-1 h-full bg-transparent text-center text-xs font-black outline-none dark:text-white caret-current">
                            <button @click="stepUp(item, 'qty', 1)" class="w-8 h-full flex items-center justify-center text-gray-400 hover:text-black dark:hover:text-white font-bold">+</button>
                          </div>
                        </div>
                      </div>
                        </div>

                        <div v-else class="md:col-span-6">
                          <span class="block invisible text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 pl-1">Подсказка</span>
                          <div class="h-14 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 px-4 flex items-center justify-center text-center text-[10px] text-gray-400 font-bold uppercase tracking-wider shadow-sm dark:shadow-black/40">
                            Сначала выберите упаковку
                          </div>
                        </div>
                      </div>
                    </transition>
                  </div>
                  </template>
                </draggable>
              </div>
              <div v-else key="empty" class="rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E] p-10 text-center mt-4">
                <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9 4 9-4"/><path d="M3 7l9-4 9 4"/><path d="M3 7v10l9 4 9-4V7"/></svg>
                </div>
                <h3 class="mt-4 text-sm font-black uppercase tracking-widest text-[#18181B] dark:text-white">Упаковка не выбрана</h3>
                <p class="mt-2 text-xs font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400 max-w-md mx-auto">Добавьте пакет, коробку или рулонную упаковку, если хотите включить логистику и выдачу готовой текстильной продукции в коммерческое предложение.</p>
                <button @click="addPackaging" class="mt-4 rounded-xl border border-gray-200 dark:border-white/10 bg-black dark:bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-white dark:text-black transition-colors hover:bg-gray-800 dark:hover:bg-gray-200">Добавить упаковку</button>
              </div>
            </Transition>
          </div>

        </Transition>
      </div>

      <DtfTotalsSidebar
        :dtf-totals="dtfTotals"
        :is-cost-visible="isCostVisible"
        :total-for-all="totalForAll"
        :price-per-one="pricePerOne"
        :product-qty="productQty"
        :size-grid-enabled="sizeGridEnabled"
        :size-grid="sizeGrid"
        :total-prints="totalPrints"
        :total-linear-m="totalLinearM"
        :roll-width-mm="rollWidthMm"
        :dtf-roll-summary-rows="dtfRollSummaryRows"
        :material-total="materialTotal"
        :packaging-total="packagingTotal"
        :blank-total="blankTotal"
        :current-product-type="currentProductType"
        :markup-amt="markupAmt"
        :discount-amt="discountAmt"
        :project="project"
        @toggle-cost-visibility="toggleCostVisibility"
        @change-markup="changeMarkup"
        @change-discount="changeDiscount"
        @change-product-qty="changeProductQty"
        @open-invoice-modal="openInvoiceModal"
        @copy-quote="copyQuote"
        @request-reset="requestReset"
      />

    </div><!-- /main grid -->

    <!-- ===== SAVE MODAL ===== -->
    <Transition name="modal-anim">
      <div
        v-if="showSaveProjectModal"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print"
        @click.self="showSaveProjectModal = false; saveModalNotice = null"
      >
        <div class="bg-white p-6 rounded-xl w-full max-w-sm shadow-xl">
          <h3 class="font-bold text-lg mb-2">Сохранить в историю</h3>
          <p class="text-xs text-gray-500 mb-4">Укажите данные проекта перед сохранением</p>

          <div
            v-if="saveModalNotice"
            class="mb-4 rounded-xl border px-3.5 py-3 flex items-start gap-2.5 shadow-sm"
            :class="saveModalNotice.type === 'success'
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
              : 'bg-amber-50/80 border-amber-200 text-amber-800'"
          >
            <div
              class="mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
              :class="saveModalNotice.type === 'success'
                ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
                : 'bg-amber-100 border-amber-200 text-amber-700'"
            >
              <svg v-if="saveModalNotice.type === 'success'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            </div>
            <p class="text-[12px] font-semibold leading-snug tracking-tight">
              {{ saveModalNotice.text }}
            </p>
          </div>

          <div class="space-y-3">
            <input v-model="project.name" class="input-std font-bold" placeholder="Название проекта">
            <input v-model="project.client" class="input-std" placeholder="Заказчик / Организация">
            <div class="grid grid-cols-2 gap-2 pt-1">
              <button
                @click="showSaveProjectModal = false; saveModalNotice = null"
                class="py-3 rounded-xl font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors text-xs uppercase tracking-wider"
              >
                Отмена
              </button>
              <button
                @click="handleManualSaveToHistory"
                :disabled="isManualSaving"
                class="py-3 rounded-xl font-bold bg-black text-white hover:bg-gray-800 transition-colors text-xs uppercase tracking-wider disabled:opacity-60"
              >
                {{ isManualSaving ? (isOfflineMode ? 'В кэш...' : 'Сохранение...') : (isOfflineMode ? 'Сохранить в кэш' : 'Сохранить') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-anim">
      <div v-if="showResetConfirm" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showResetConfirm = false">
        <div class="bg-white dark:bg-[#1C1C1E] rounded-xl shadow-2xl p-6 max-w-sm w-full border border-white/50 dark:border-white/10 text-center transform transition-all">
          <h3 class="text-lg font-black mb-2 text-[#18181B] dark:text-white">Сбросить всё?</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Все введенные данные будут удалены.</p>
          <div class="grid grid-cols-2 gap-2">
            <button @click="showResetConfirm = false" class="py-3 rounded-xl font-bold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-xs uppercase tracking-wider">Отмена</button>
            <button @click="confirmReset" class="py-3 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all text-xs uppercase tracking-wider">Сбросить</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-anim">
      <div v-if="showSizeGridExitConfirm" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="cancelSizeGridExit">
        <div class="bg-white dark:bg-[#1C1C1E] rounded-xl shadow-2xl p-6 max-w-md w-full border border-white/50 dark:border-white/10">
          <h3 class="text-lg font-black text-[#18181B] dark:text-white">Отключить сетку размеров?</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Можно сохранить суммарное количество изделий из сетки или полностью сбросить количество и значения размеров.</p>
          <div class="mt-5 grid gap-2">
            <button @click="keepGridTotalAsProductQty" class="py-3 rounded-xl font-bold bg-black text-white dark:bg-white dark:text-black text-xs uppercase tracking-wider">Сохранить общее количество</button>
            <button @click="resetGridAndProductQty" class="py-3 rounded-xl font-bold bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Сбросить количество и размеры</button>
            <button @click="cancelSizeGridExit" class="py-3 rounded-xl font-bold bg-transparent text-gray-400 text-xs uppercase tracking-wider">Отмена</button>
          </div>
        </div>
      </div>
    </Transition>

    <InvoiceModal
      :show="showInvoice"
      :project="invoicePayload.project"
      :layers="invoicePayload.layers"
      :processing="invoicePayload.processing"
      :accessories="invoicePayload.accessories"
      :packaging="invoicePayload.packaging"
      :design="invoicePayload.design"
      :totals="invoicePayload.totals"
      :settings="invoicePayload.settings"
      :materials="invoicePayload.materials"
      :coatings="invoicePayload.coatings"
      :product-qty="invoicePayload.productQty"
      @close="showInvoice = false"
      @print="onInvoicePrint"
    />

    <!-- ===== AUTH MODAL ===== -->
    <Transition name="modal-anim">
      <AuthLogin v-if="showAuthModal" @close="showAuthModal = false" @success="showAuthModal = false; showToast('Вход выполнен')" />
    </Transition>

    <!-- ===== TOAST ===== -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-6 left-1/2 -translate-x-1/2 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md bg-[#18181B]/90 text-white">
        <span class="font-bold text-xs uppercase tracking-wide">{{ toast.message }}</span>
        <button v-if="toast.actionLabel" @click="runToastAction" class="rounded-full border border-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-white/10">
          {{ toast.actionLabel }}
        </button>
      </div>
    </Transition>

    <div class="fixed top-7 left-1/2 -translate-x-1/2 pointer-events-none z-[120] no-print" aria-hidden="true">
      <div class="save-fireworks-stage">
        <span
          v-for="particle in saveFireworks"
          :key="particle.id"
          class="save-firework-dot"
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

    <!-- ===== SCROLL TOP ===== -->
    <Transition name="pop-up">
      <div
        v-if="showScrollTop"
        class="fixed bottom-10 left-1/2 z-[90] -translate-x-1/2 w-20 h-10 flex items-center justify-center cursor-pointer"
        @click="scrollToTop"
      >
        <div class="h-10 bg-[#1d1d1f] dark:bg-white shadow-2xl border border-white/10 dark:border-black/10 rounded-full w-full"></div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white dark:text-black pointer-events-none">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </div>
    </Transition>

  </div>
</template>

<style>
.desktop-calc .section-title,
.desktop-calc .label {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.2rem 0.6rem;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
}

.desktop-calc .label {
  margin-left: 0.45rem;
  margin-bottom: 0.35rem;
}

.desktop-calc .layer-card {
  border-radius: 1.1rem;
  overflow: hidden;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.35);
}

.desktop-calc .layer-card:hover {
  box-shadow: 0 14px 26px -20px rgba(15, 23, 42, 0.42);
}

.desktop-calc .layer-header {
  position: relative;
}

.desktop-calc .calc-section-head {
  position: relative;
  padding-bottom: 0.65rem;
}

.desktop-calc .calc-section-head::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(148, 163, 184, 0.6), rgba(0, 0, 0, 0));
}

.desktop-calc .layer-header::after {
  content: '';
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(148, 163, 184, 0.62), rgba(0, 0, 0, 0));
  opacity: 0;
  transition: opacity 0.2s ease;
}

.desktop-calc .layer-header.is-expanded::after {
  opacity: 1;
}

.desktop-calc .layer-card-body {
  padding-left: 1.25rem;
  padding-right: 1.25rem;
}

.desktop-calc .calc-tab-btn {
  transition: transform 220ms ease, background-color 220ms ease, color 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
  border: 1px solid transparent;
}

.desktop-calc .calc-tab-btn:hover {
  transform: translateY(-1px);
}

.desktop-calc .calc-tab-btn-active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 8px 20px -12px rgba(0, 0, 0, 0.45);
  border-color: #e5e7eb;
}

.desktop-calc .calc-tab-btn-idle {
  color: #6b7280;
}

.desktop-calc .calc-tab-btn-idle:hover {
  background: #e5e7eb;
  color: #374151;
}

.desktop-calc .calc-top-nav-btn {
  border-radius: 0.85rem;
  padding: 0.25rem 0.55rem;
  transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease;
}
.desktop-calc .calc-top-nav-btn:hover { transform: translateY(-1px); }
.desktop-calc .calc-top-nav-icon { background: #f3f4f6; }
html.dark .desktop-calc .calc-top-nav-icon { background: rgba(255,255,255,0.08); }
.desktop-calc .calc-amount-value {
  font-weight: 800;
  font-size: 1.125rem;
  color: #111827;
}
.desktop-calc .kp-percent-value {
  color: #111827;
}
.desktop-calc .total-amount {
  color: #111827;
}
.desktop-calc .kp-secondary-btn {
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #111827;
  transition: transform 180ms ease, background-color 180ms ease, color 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}
.desktop-calc .kp-secondary-btn:hover {
  transform: translateY(-1px);
  background: #f3f4f6;
  border-color: #9ca3af;
  box-shadow: 0 8px 16px -12px rgba(0,0,0,0.45);
}
.desktop-calc .kp-secondary-btn:active { transform: translateY(0); }
.desktop-calc .kp-secondary-danger:hover {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
html.dark .desktop-calc .calc-amount-value {
  color: #f3f4f6;
}
html.dark .desktop-calc .kp-percent-value,
html.dark .desktop-calc .total-amount {
  color: #f3f4f6;
}
html.dark .desktop-calc .kp-secondary-btn {
  background: #232326;
  border-color: rgba(255,255,255,0.16);
  color: #e5e7eb;
}
html.dark .desktop-calc .kp-secondary-btn:hover {
  background: #2b2b2f;
  border-color: rgba(255,255,255,0.28);
  color: #ffffff;
  box-shadow: 0 10px 20px -14px rgba(0,0,0,0.75);
}
html.dark .desktop-calc .kp-secondary-danger:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fecaca;
}

html.dark .desktop-calc .calc-tab-btn-active {
  background: #2b2b2f;
  color: #f3f4f6;
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 10px 24px -14px rgba(0, 0, 0, 0.6);
}

html.dark .desktop-calc .calc-tab-btn-idle {
  color: #9ca3af;
}

html.dark .desktop-calc .calc-tab-btn-idle:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

html.dark .desktop-calc .section-title,
html.dark .desktop-calc .label {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #d1d5db;
}

html.dark .desktop-calc .layer-card {
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 24px -18px rgba(0, 0, 0, 0.8);
}

html.dark .desktop-calc .layer-card:hover {
  box-shadow: 0 16px 28px -18px rgba(0, 0, 0, 0.9);
}

html.dark .desktop-calc .layer-header::after {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(148, 163, 184, 0.42), rgba(255, 255, 255, 0));
}

/* ===== Blanket dark-mode overrides (matches DesktopApp / laser) ===== */
html.dark .desktop-calc .bg-white {
  background-color: #1c1c1e !important;
}
html.dark .desktop-calc .bg-gray-50,
html.dark .desktop-calc .hover\:bg-gray-50:hover {
  background-color: #232326 !important;
}
html.dark .desktop-calc .bg-gray-100,
html.dark .desktop-calc .hover\:bg-gray-100:hover,
html.dark .desktop-calc .hover\:bg-gray-200:hover {
  background-color: #2b2b2f !important;
}
html.dark .desktop-calc .border-gray-100,
html.dark .desktop-calc .border-gray-200,
html.dark .desktop-calc .border-gray-100,
html.dark .desktop-calc .border-gray-200,
html.dark .desktop-calc .border-gray-300 {
  border-color: rgba(255, 255, 255, 0.12) !important;
}
html.dark .desktop-calc .text-black {
  color: #f3f4f6 !important;
}
html.dark .desktop-calc .text-gray-300 { color: #9ca3af !important; }
html.dark .desktop-calc .text-gray-400 { color: #9ca3af !important; }
html.dark .desktop-calc .text-gray-500 { color: #a1a1aa !important; }
html.dark .desktop-calc .text-gray-600 { color: #d1d5db !important; }
html.dark .desktop-calc .text-gray-700 { color: #e5e7eb !important; }
html.dark .desktop-calc .bg-gradient-to-br.from-white.to-gray-50 {
  background-image: linear-gradient(to bottom right, #1c1c1e, #232326) !important;
}
.page-switch-enter-active, .page-switch-leave-active { transition: all 0.18s ease; }
.page-switch-enter-from, .page-switch-leave-to { opacity: 0; transform: translateY(4px); }
.layer-stack-enter-active { transition: all 0.28s ease-out; }
.layer-stack-leave-active  { transition: all 0.22s ease-in; position: absolute; width: 100%; }
.layer-stack-enter-from, .layer-stack-leave-to { opacity: 0; transform: translateY(-8px); }
.service-stack-enter-active { transition: all 0.22s ease-out; }
.service-stack-leave-active  { transition: all 0.18s ease-in; position: absolute; width: 100%; }
.service-stack-enter-from, .service-stack-leave-to { opacity: 0; transform: translateY(-6px); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.modal-anim-enter-active, .modal-anim-leave-active { transition: all 0.2s ease-out; }
.modal-anim-enter-from, .modal-anim-leave-to { opacity: 0; transform: scale(0.95); }
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
.pop-up-enter-active, .pop-up-leave-active { transition: all 0.25s ease; }
.pop-up-enter-from, .pop-up-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
.collapse-enter-active, .collapse-leave-active { transition: all 0.28s ease; }
.collapse-enter-from, .collapse-leave-to { opacity: 0; }

.save-fireworks-stage {
  position: relative;
  width: 320px;
  height: 120px;
}

.save-firework-dot {
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
  animation: save-firework-burst var(--duration) cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: var(--delay);
}

@keyframes save-firework-burst {
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
