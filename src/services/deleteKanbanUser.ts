import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { writeToArchive } from './archive.service';

/**
 * STEP 6
 * Удаление пользователя канбана с архивированием
 * Доступ: admin / superadmin
 */
export async function deleteKanbanUser({
  targetUserId,
  userData,
  currentUserId,
}) {
  const ref = doc(db, 'users', targetUserId);

  // 1. удаляем пользователя
  await deleteDoc(ref);

  // 2. архивируем (глобальный архив)
  await writeToArchive({
    scope: 'global',
    type: 'users',
    data: {
      userId: targetUserId,
      ...userData,
    },
    deletedBy: currentUserId,
  });
}
