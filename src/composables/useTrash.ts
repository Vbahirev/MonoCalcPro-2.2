/**
 * useTrash.ts — канонический модуль корзины.
 *
 * Все операции с корзиной пользователя проходят через этот файл.
 * useDatabase.js использует эти же функции напрямую.
 */
import {
  getDoc,
  setDoc,
  deleteDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  collection,
  query,
  orderBy,
  getDocs,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { trashDoc, trashCol, historyDoc, historyCol, globalConfigDoc } from '@/core/db/collections'

const DAY = 24 * 60 * 60 * 1000
export const TRASH_TTL_DAYS = 30

// ─────────────────────────────────────────────
// Запись в корзину (создаёт документ с детерминированным ID)
// ─────────────────────────────────────────────
export async function moveToTrash(uid: string, id: string, payload: any) {
  const deletedAt = new Date()
  // Предварительно удаляем, если документ существует (правила Firestore
  // не разрешают update в /trash — только create)
  try { await deleteDoc(trashDoc(uid, id)) } catch (_) {}
  await setDoc(trashDoc(uid, id), {
    ...payload,
    deletedAt: serverTimestamp(),
    deletedAtISO: deletedAt.toISOString(),
    expiresAtISO: new Date(deletedAt.getTime() + TRASH_TTL_DAYS * DAY).toISOString(),
  })
}

// Добавление в корзину без конкретного ID (для настроек, у которых нет своего ID)
export async function addToTrash(uid: string, payload: any) {
  const deletedAt = new Date()
  return addDoc(trashCol(uid), {
    ...payload,
    deletedAt: serverTimestamp(),
    deletedAtISO: deletedAt.toISOString(),
    expiresAtISO: new Date(deletedAt.getTime() + TRASH_TTL_DAYS * DAY).toISOString(),
  })
}

// ─────────────────────────────────────────────
// Список корзины пользователя
// ─────────────────────────────────────────────
export async function listTrashItems(uid: string) {
  const q = query(trashCol(uid), orderBy('deletedAtISO', 'desc'))
  const snap = await getDocs(q)
  const now = Date.now()
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .filter(item => {
      if (!item.expiresAtISO) return true
      return new Date(item.expiresAtISO).getTime() > now
    })
}

// ─────────────────────────────────────────────
// Восстановление из корзины
// ─────────────────────────────────────────────
export async function restoreFromTrash(uid: string, id: string) {
  const ref = trashDoc(uid, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Элемент не найден в корзине')

  const data: any = snap.data()

  // Проверка срока хранения
  if (data.expiresAtISO && new Date(data.expiresAtISO).getTime() <= Date.now()) {
    await deleteDoc(ref)
    throw new Error('Срок хранения истёк (30 дней). Запись удалена.')
  }

  const { deletedAt, deletedAtISO, expiresAtISO, ...clean } = data

  // Восстановление настроек → arrayUnion в global_config
  if (data.itemType === 'settings' && data.dataType && data.payload) {
    await updateDoc(globalConfigDoc(), { [data.dataType]: arrayUnion(data.payload) })
    await _writeRestoreAudit(uid, id, data)
    await deleteDoc(ref)
    return { status: 'success', message: 'Настройка восстановлена' }
  }

  // Восстановление проекта/истории → запись в history
  const historyId = clean?.sourceHistoryId || clean?.id || id
  await setDoc(historyDoc(uid, historyId), {
    ...clean,
    id: historyId,
    restoredAt: serverTimestamp(),
    savedAt: clean.savedAt || new Date().toISOString(),
  }, { merge: true })

  await _writeRestoreAudit(uid, id, data)
  await deleteDoc(ref)
  return { status: 'success', message: 'Элемент восстановлен' }
}

// ─────────────────────────────────────────────
// Удаление навсегда
// ─────────────────────────────────────────────
export async function deleteForever(uid: string, id: string) {
  await deleteDoc(trashDoc(uid, id))
}

// ─────────────────────────────────────────────
// Внутренний: запись audit log восстановления
// ─────────────────────────────────────────────
async function _writeRestoreAudit(uid: string, trashId: string, data: any) {
  try {
    await addDoc(historyCol(uid), {
      audit: true,
      action: 'restore',
      source: 'trash',
      type: data.itemType || data.type || 'unknown',
      title: data?.title || data?.name || data?.data?.name || 'Восстановление',
      restoredAt: serverTimestamp(),
      savedAt: new Date().toISOString(),
      restoredBy: uid,
      trashId,
    })
  } catch (_) {
    // audit log не должен блокировать восстановление
  }
}
