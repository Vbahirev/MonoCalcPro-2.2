import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { archiveDeletedData } from '@/core/trash/trash.service';

export async function deleteMaterial(material) {
  // 1. Удаляем документ
  await deleteDoc(doc(db, 'materials', material.id));
  // 2. Архивируем для audit trail
  return archiveDeletedData({
    scope: 'settings.laser',
    type: 'material',
    sourcePath: `materials/${material.id}`,
    originalData: material,
    meta: { title: material.name },
  });
}
