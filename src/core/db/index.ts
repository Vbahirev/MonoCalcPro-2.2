import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  where,
  limit as qLimit,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/firebase'

import {
  globalConfigDoc,
  historyCol,
  historyDoc,
  trashCol,
  trashDoc,
  usersDoc,
} from './collections'

/**
 * Единственный адаптер Firestore для приложения.
 * UI/компоненты НЕ должны собирать пути Firestore руками.
 */

// -------------------- Global config --------------------
export async function getGlobalConfig() {
  const snap = await getDoc(globalConfigDoc())
  return snap.exists() ? snap.data() : null
}

export async function updateGlobalConfig(
  patch: Record<string, any>,
  opts?: { allowWrite?: boolean }
) {
  // STEP 6: DB-layer guard (UI is not a security boundary)
  if (opts?.allowWrite === false) {
    const err: any = new Error('PERMISSION_DENIED: settings.global.write')
    err.code = 'permission-denied'
    throw err
  }

  // updateDoc падает, если документа нет -> делаем merge set
  await setDoc(globalConfigDoc(), patch, { merge: true })
}

// -------------------- History --------------------
export async function listHistory(uid: string, opts?: { limit?: number }) {
  const q = query(
    historyCol(uid),
    orderBy('createdAt', 'desc'),
    qLimit(opts?.limit ?? 100)
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function saveHistory(uid: string, id: string, payload: any) {
  await setDoc(historyDoc(uid, id), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
}

// -------------------- Trash --------------------
export type TrashFilters = {
  type?: string
  limit?: number
}

export async function listTrash(uid: string, filters?: TrashFilters) {
  const clauses: any[] = []
  if (filters?.type && filters.type !== 'all') {
    clauses.push(where('entityType', '==', filters.type))
  }
  clauses.push(orderBy('deletedAtISO', 'desc'))
  clauses.push(qLimit(filters?.limit ?? 200))

  const q = query(trashCol(uid), ...clauses)
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function moveToTrash(uid: string, id: string, payload: any) {
  const deletedAt = new Date()
  await setDoc(trashDoc(uid, id), {
    ...payload,
    deletedAt: serverTimestamp(),
    deletedAtISO: deletedAt.toISOString(),
  })
}

export async function restoreTrash(uid: string, id: string, target: 'history' | 'custom' = 'history', customPath?: { col: string }) {
  const ref = trashDoc(uid, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null

  const data: any = snap.data()
  // технические поля
  delete data.deletedAt
  delete data.deletedAtISO
  delete data.expiresAtISO

  const batch = writeBatch(db)

  if (target === 'history') {
    batch.set(historyDoc(uid, id), { ...data, restoredAt: serverTimestamp() }, { merge: true })
  } else if (target === 'custom' && customPath?.col) {
    // safe minimal: write back under users/{uid}/{col}/{id}
    batch.set(doc(db as any, 'users', uid, customPath.col, id), { ...data, restoredAt: serverTimestamp() }, { merge: true })
  }

  batch.delete(ref)
  await batch.commit()
  return data
}

export async function deleteTrash(uid: string, id: string) {
  await deleteDoc(trashDoc(uid, id))
}

// -------------------- Users (admin-only; permission checked outside) --------------------
export async function listUsers() {
  // NOTE: users is a collection, but in this app we usually read users list from admin panels only.
  // Keep minimal to avoid accidental exposure. Implement when реально потребуется.
  throw new Error('listUsers() is not implemented. Use admin backend or add explicit rules & UI flow.')
}

// -------------------- Helpers --------------------
export async function ensureUserDoc(uid: string, patch?: Record<string, any>) {
  await setDoc(usersDoc(uid), { ...(patch || {}), updatedAt: serverTimestamp() }, { merge: true })
}
