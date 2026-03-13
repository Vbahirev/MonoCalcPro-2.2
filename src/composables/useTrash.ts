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
  writeBatch,
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

function makeCopyId(baseId: any) {
  const normalized = String(baseId || 'restored').trim() || 'restored'
  return `${normalized}_copy_${Date.now()}`
}

function appendCopySuffix(value: any) {
  const normalized = String(value || '').trim()
  if (!normalized) return 'Копия'
  return normalized.includes('(копия)') ? normalized : `${normalized} (копия)`
}

function cloneForRestoreCopy(payload: any, nextId?: string) {
  const cloned = payload ? JSON.parse(JSON.stringify(payload)) : {}

  if (nextId) {
    if (Object.prototype.hasOwnProperty.call(cloned, 'id')) cloned.id = nextId
    if (Object.prototype.hasOwnProperty.call(cloned, 'dbId')) cloned.dbId = nextId
  }

  if (typeof cloned.name === 'string') cloned.name = appendCopySuffix(cloned.name)
  if (typeof cloned.title === 'string') cloned.title = appendCopySuffix(cloned.title)
  if (cloned?.state?.project && typeof cloned.state.project.name === 'string') {
    cloned.state.project.name = appendCopySuffix(cloned.state.project.name)
  }

  return cloned
}

function normalizeRestoredEntityType(itemType: any) {
  const normalized = String(itemType || '').trim().toLowerCase()
  if (normalized === 'settings') return 'settings'
  if (normalized === 'users') return 'users'
  return 'history'
}

function buildRestoredEntityPath(uid: string, entityType: string, entityId: string) {
  if (entityType === 'settings') return 'settings/global_config'
  if (entityType === 'users') return `users/${entityId}`
  return `users/${uid}/history/${entityId}`
}

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
export async function restoreFromTrash(uid: string, id: string, options: { mode?: 'replace' | 'copy' } = {}) {
  const ref = trashDoc(uid, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Элемент не найден в корзине')

  const data: any = snap.data()
  const restoreMode = options?.mode === 'copy' ? 'copy' : 'replace'
  const entityType = normalizeRestoredEntityType(data.itemType || data.type)

  // Проверка срока хранения
  if (data.expiresAtISO && new Date(data.expiresAtISO).getTime() <= Date.now()) {
    await deleteDoc(ref)
    throw new Error('Срок хранения истёк (30 дней). Запись удалена.')
  }

  const { deletedAt, deletedAtISO, expiresAtISO, ...clean } = data

  // Восстановление настроек → arrayUnion в global_config
  if (data.itemType === 'settings' && data.dataType && data.payload) {
    const restoredPayload = restoreMode === 'copy'
      ? cloneForRestoreCopy(data.payload, makeCopyId(data.payload?.id || data.payload?.dbId || data.id || id))
      : data.payload
    const batch = writeBatch(db)
    batch.update(globalConfigDoc(), { [data.dataType]: arrayUnion(restoredPayload) })
    batch.delete(ref)
    await batch.commit()
    await _writeRestoreAudit(uid, id, data, restoreMode)
    return {
      status: 'success',
      message: restoreMode === 'copy' ? 'Настройка восстановлена как копия' : 'Настройка восстановлена',
      restoreMode,
      entityType,
      entityId: 'global_config',
      entityPath: buildRestoredEntityPath(uid, entityType, 'global_config'),
    }
  }

  // Восстановление проекта/истории → запись в history
  const sourceHistoryId = clean?.sourceHistoryId || clean?.id || id
  const historyId = restoreMode === 'copy' ? makeCopyId(sourceHistoryId) : sourceHistoryId
  const payloadToRestore = restoreMode === 'copy'
    ? cloneForRestoreCopy(clean, historyId)
    : clean
  const batch = writeBatch(db)
  batch.set(historyDoc(uid, historyId), {
    ...payloadToRestore,
    id: historyId,
    sourceHistoryId,
    restoredAt: serverTimestamp(),
    savedAt: payloadToRestore.savedAt || new Date().toISOString(),
  }, { merge: true })
  batch.delete(ref)
  await batch.commit()

  await _writeRestoreAudit(uid, id, data, restoreMode)
  return {
    status: 'success',
    message: restoreMode === 'copy' ? 'Элемент восстановлен как копия' : 'Элемент восстановлен',
    restoreMode,
    entityType,
    entityId: historyId,
    entityPath: buildRestoredEntityPath(uid, entityType, historyId),
  }
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
async function _writeRestoreAudit(uid: string, trashId: string, data: any, restoreMode: 'replace' | 'copy' = 'replace') {
  try {
    await addDoc(historyCol(uid), {
      audit: true,
      action: 'restore',
      source: 'trash',
      restoreMode,
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
