import { ref } from 'vue';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/firebase';

export function useArchive() {
  const items = ref([]);
  const loading = ref(false);
  const error = ref(null);

  async function loadUserArchive(userId) {
    loading.value = true;
    try {
      const q = query(
        collection(db, 'users', userId, 'trash'),
        orderBy('deletedAt', 'desc')
      );
      const snap = await getDocs(q);
      items.value = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  async function loadGlobalArchive() {
    loading.value = true;
    try {
      const q = query(
        collection(db, 'trash'),
        orderBy('deletedAt', 'desc')
      );
      const snap = await getDocs(q);
      items.value = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  
function getDaysLeft(restoreUntil: any): number {
  if (!restoreUntil?.toDate) return 0;
  const now = new Date();
  const end = restoreUntil.toDate();
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

return {
  items,
  loading,
  error,
  loadUserArchive,
  loadGlobalArchive,
  getDaysLeft,
};

}
