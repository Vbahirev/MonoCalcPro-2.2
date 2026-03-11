/**
 * useGarbage.ts — ротация garbage-слотов (замена TTL).
 *
 * Принцип: 30 слотов (0..29), по одному на каждый день.
 * Каждый день слот перезаписывается — данные плавно вытесняются за ~30 дней.
 * Без Cloud Functions, без TTL, без billing overhead.
 *
 * Используется из useDatabase.js при каждом входе пользователя и при удалении.
 */
import { getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/firebase'
import { garbageSlotDoc } from '@/core/db/collections'

const DAY = 24 * 60 * 60 * 1000
export const GARBAGE_SLOTS = 30

export const todaySlot = () => Math.floor(Date.now() / DAY) % GARBAGE_SLOTS

function isSameDay(a: any, b: Date): boolean {
  try {
    const da = a instanceof Date ? a : new Date(a)
    return da.toDateString() === b.toDateString()
  } catch {
    return false
  }
}

/**
 * Гарантирует, что слот текущего дня существует.
 * Если слот уже записан сегодня — пропускает (идемпотентно).
 */
export async function ensureDailyGarbageSlot(uid: string) {
  const slot = todaySlot()
  const ref = garbageSlotDoc(uid, slot)
  const snap = await getDoc(ref)

  if (!snap.exists()) {
    await setDoc(ref, { type: 'empty', writtenAt: serverTimestamp(), slot })
    return
  }

  const data = snap.data()
  const writtenAt = data?.writtenAt?.toDate?.() ?? (data?.writtenAt ? new Date(data.writtenAt) : null)
  if (!writtenAt || !isSameDay(writtenAt, new Date())) {
    await setDoc(ref, { type: 'empty', writtenAt: serverTimestamp(), slot })
  }
}

/**
 * Записывает событие в слот текущего дня (действие пользователя).
 */
export async function writeGarbageEvent(uid: string, payload: any) {
  const slot = todaySlot()
  await setDoc(garbageSlotDoc(uid, slot), {
    type: 'event',
    payload,
    writtenAt: serverTimestamp(),
    slot,
  })
}
