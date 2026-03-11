import { ref, computed } from 'vue'
import {
  collection,
  query,
  orderBy,
  where,
  limit,
  getDocs,
  deleteDoc,
  writeBatch,
  Timestamp,
  doc,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { canUser } from '@/core/auth/access'

export function useTrashStore(uid) {
  const items = ref([])
  const filter = ref('all')
  const error = ref(null)

  async function load() {
    try {
      if (!uid) return
      const q = query(
        collection(db, 'users', uid, 'trash'),
        orderBy('deletedAt', 'desc')
      )
      const snap = await getDocs(q)
      items.value = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(i => i && i.id)
    } catch (e) {
      error.value = e.message
    }
  }

  const filtered = computed(() => {
    if (filter.value === 'all') return items.value
    return items.value.filter(i => i.type === filter.value)
  })

  async function purge(id) {
    if (!uid || !id) return
    await deleteDoc(doc(db, 'users', uid, 'trash', id))
    await load()
  }

  return { items, filtered, filter, load, purge, error }
}

// Очистка просроченных записей корзины (вызывать серверно или из admin-панели)
export async function purgeExpiredTrash(user, uid) {
  if (!canUser(user, 'trash.purge')) return

  const now = Timestamp.now()
  let hasMore = true

  while (hasMore) {
    const q = query(
      collection(db, 'users', uid, 'trash'),
      where('expiresAt', '<=', now),
      orderBy('expiresAt'),
      limit(100)
    )

    const snap = await getDocs(q)
    if (snap.empty) {
      hasMore = false
      break
    }

    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}
