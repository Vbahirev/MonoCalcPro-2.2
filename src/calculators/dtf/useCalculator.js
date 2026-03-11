import { computed, ref } from 'vue';

function createEmptyList() {
  return ref([]);
}

export function useDtfCalculator() {
  const project = ref({ name: '', client: '', discount: 0, markup: 0 });
  const settings = ref({});
  const layers = createEmptyList();
  const processing = createEmptyList();
  const accessories = createEmptyList();
  const packaging = createEmptyList();
  const design = createEmptyList();
  const materials = createEmptyList();
  const materialGroups = computed(() => []);
  const coatings = createEmptyList();
  const processingDB = createEmptyList();
  const accessoriesDB = createEmptyList();
  const packagingDB = createEmptyList();
  const designDB = createEmptyList();
  const materialConsumption = computed(() => []);
  const totals = computed(() => ({
    total: 0,
    layers: 0,
    processing: 0,
    accessories: 0,
    packaging: 0,
    design: 0,
  }));

  return {
    init: async () => {},
    settings,
    layers,
    processing,
    accessories,
    packaging,
    design,
    project,
    materials,
    materialGroups,
    coatings,
    processingDB,
    accessoriesDB,
    packagingDB,
    designDB,
    totals,
    materialConsumption,
    resetAll: () => {},
    syncStatus: ref('idle'),
    addLayer: () => {},
    removeLayer: () => {},
    addProcessing: () => {},
    removeProcessing: () => {},
    addAccessory: () => {},
    removeAccessory: () => {},
    addPackaging: () => {},
    removePackaging: () => {},
    addDesign: () => {},
    removeDesign: () => {},
    saveToHistory: async () => ({}),
    triggerAutoSave: async () => {},
  };
}