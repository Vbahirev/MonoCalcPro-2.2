import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/firebase';

/**
 * STEP 8
 * Универсальное восстановление данных из архива
 * Права проверяются Firestore Rules
 */
export async function restoreFromArchive({
  scope,
  userId,
  archiveId,
  type,
  data,
}) {
  let targetRef;

  switch (type) {
    case 'projects':
      targetRef = doc(db, 'users', userId, 'projects', data.projectId);
      break;

    case 'history':
      targetRef = doc(db, 'users', userId, 'history', data.historyId);
      break;

    case 'settings':
      targetRef = doc(db, 'settings', 'global_config');
      break;

    case 'users':
      targetRef = doc(db, 'users', data.userId);
      break;

    default:
      throw new Error('Unknown archive type');
  }

  // 1. восстанавливаем данные
  await setDoc(targetRef, data, { merge: true });

  // 2. удаляем запись из архива
  const archiveRef =
    scope === 'user'
      ? doc(db, 'users', userId, 'trash', archiveId)
      : doc(db, 'trash', archiveId);

  await deleteDoc(archiveRef);
}
