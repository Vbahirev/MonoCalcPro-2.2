import { ref, computed, nextTick } from 'vue';
import { 
    emptyMaterials, emptyCoatings, 
    emptyProcessingDB, emptyAccessoriesDB, 
    emptyPackagingDB, emptyDesignDB, 
    defaultSettings, 
    DB_CACHE_KEY 
} from '../data/defaults';
import { db, auth } from '../services/firebase';
import { historyDoc, trashDoc, historyCol, trashCol, globalConfigDoc, garbageSlotDoc } from '@/core/db/collections';
import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, serverTimestamp,
    collection, addDoc, query, orderBy, getDocs, deleteDoc,
    limit as fsLimit, startAfter, where
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { canUser } from '@/core/auth/access';


// =========================================================
// ⚠️ НЕ УДАЛЯТЬ
// GARBAGE (application-level rolling retention, ~30 days)
// Принцип:
// - 30 слотов (0..29), по одному на день
// - Каждый день слот ОБЯЗАН обновляться:
//   либо данными, либо пустой меткой
// - Старые данные плавно вытесняются перезаписью
// - Без TTL / Billing / background jobs
// =========================================================
const GARBAGE_SLOTS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const garbageSlotRef = (uid, slot) => garbageSlotDoc(uid, slot);

const todaySlot = () =>
    Math.floor(Date.now() / DAY_MS) % GARBAGE_SLOTS;

const isSameDay = (a, b) => {
    try {
        const da = new Date(a);
        const dbb = new Date(b);
        return da.toDateString() === dbb.toDateString();
    } catch (e) { return false; }
};

// ⚠️ НЕ УДАЛЯТЬ
// Гарантирует, что слот текущего дня обновлён.
// Если сегодня не было событий — перезаписываем пустой меткой.
const ensureDailyGarbageSlot = async (uid) => {
    const slot = todaySlot();
    const ref = garbageSlotRef(uid, slot);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
        await setDoc(ref, {
            type: 'empty',
            writtenAt: serverTimestamp(),
            slot
        });
        return;
    }

    const data = snap.data();
    // Если слот был записан НЕ сегодня — перезаписываем пустотой
    if (!data?.writtenAt || !isSameDay(data.writtenAt?.toDate?.() ?? data.writtenAt, new Date())) {
        await setDoc(ref, {
            type: 'empty',
            writtenAt: serverTimestamp(),
            slot
        });
    }
};

// ⚠️ НЕ УДАЛЯТЬ
// Запись события мусора в слот текущего дня (перезапись)
const writeGarbage = async (uid, payload) => {
    const slot = todaySlot();
    await setDoc(garbageSlotRef(uid, slot), {
        type: 'event',
        payload,
        writtenAt: serverTimestamp(),
        slot
    });
};

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ (Singleton) ---
const materials = ref([...emptyMaterials]);
const coatings = ref([...emptyCoatings]);
const processingDB = ref([...emptyProcessingDB]);
const accessoriesDB = ref([...emptyAccessoriesDB]);
const packagingDB = ref([...emptyPackagingDB]);
const designDB = ref([...emptyDesignDB]);
const settings = ref({ ...defaultSettings });

// Состояние пользователя
const user = ref(null);
// Canonical roles: guest | client | team | admin | superadmin
const userRole = ref('guest');
// Canonical permissions map: { "perm.string": true }
const userPermissions = ref({});
const syncStatus = ref('idle'); 
const isLoaded = ref(false);
const isRemoteUpdate = ref(false);
const userHistory = ref([]); 
const allUsers = ref([]); 

// Legacy flags mapping (compat): existing UI still asks for old keys.
const LEGACY_PERMISSION_MAP = {
    // history
    canSaveHistory: ['history.view', 'history.write'],
    // settings
    canViewSettings: ['settings.global.view'],
    canEditMaterials: ['settings.materials.write'],
    canEditPrices: ['settings.prices.write'],
    canEditGlobalSettings: ['settings.global.write'],
    // team management
    canManageTeam: ['users.list.view', 'users.permissions.edit'],
};

// Superadmin UID fallback (must match Firestore rules owner UID)
const DEFAULT_SUPERADMIN_UID = 'sGGQraRarlZAtRJKgMA26TB75MN2';
const DEFAULT_SUPERADMIN_EMAIL = 'viktor19971997@gmail.com';

export function useDatabase() {
    
    // --- 1. ИНИЦИАЛИЗАЦИЯ ---
    const initDatabase = async () => {
        // ⚠️ НЕ УДАЛЯТЬ: ежедневное обслуживание слота мусора
        // Важно: initDatabase может вызваться до того, как сработает onAuthStateChanged,
        // поэтому requireUser() здесь использовать нельзя (иначе будет ReferenceError/нет UID).
        try {
            const uid = auth.currentUser?.uid || user.value?.uid;
            if (uid) await ensureDailyGarbageSlot(uid);
        } catch (e) {}

        if (isLoaded.value) return; 

        // Загрузка из кэша для скорости
        const cachedDB = localStorage.getItem(DB_CACHE_KEY);
        if (cachedDB) { 
            try { applyData(JSON.parse(cachedDB)); } 
            catch (e) { console.error('Cache init error', e); } 
        }

        // Слушаем авторизацию
        onAuthStateChanged(auth, async (currentUser) => {
            user.value = currentUser;
            
            if (currentUser) {
                // ⚠️ НЕ УДАЛЯТЬ: гарантируем ежедневное обслуживание мусорного слота
                // уже после появления auth uid.
                try { await ensureDailyGarbageSlot(currentUser.uid); } catch (e) {}

                // 1. Регистрируем/Загружаем профиль
                await checkAndRegisterUser(currentUser);
                
                // 2. Если есть право управлять командой — грузим список всех юзеров
                if (userRole.value === 'superadmin' || hasPermission('users.list.view') || hasPermission('canManageTeam')) {
                    subscribeToAllUsers();
                }

                // 3. Если есть право сохранять историю — грузим её
                if (hasPermission('canSaveHistory')) {
                    subscribeToHistory();
                }
            } else {
                setGuestState();
            }
        });

        // Всегда слушаем глобальные настройки (цены)
        subscribeToGlobalSettings();
        isLoaded.value = true;
    };

    const setGuestState = () => {
        userRole.value = 'guest';
        userPermissions.value = {};
        userHistory.value = [];
        allUsers.value = [];
    };

    // --- ПРОВЕРКА ПРАВ (ГЛАВНАЯ ФУНКЦИЯ) ---
    const hasPermission = (permission) => {
        const role = userRole.value;
        const userAccess = { role, permissions: userPermissions.value };

        // 1) Canonical permissions ("a.b.c")
        if (typeof permission === 'string' && permission.includes('.')) {
            return canUser(userAccess, permission);
        }

        // 2) Legacy flags: map -> canonical permissions
        const mapped = LEGACY_PERMISSION_MAP[permission];
        if (Array.isArray(mapped) && mapped.length) {
            return mapped.some((p) => canUser(userAccess, p)) || !!userPermissions.value[permission];
        }

        // 3) Fallback: direct flag (if it exists in stored map)
        return !!userPermissions.value[permission];
    };

    // --- ЛОГИКА ПОЛЬЗОВАТЕЛЕЙ ---
    const checkAndRegisterUser = async (currentUser) => {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);

        // ---- Role resolution ----
        // Priority: custom claims -> users/{uid}.role -> client (no traces in Firestore)
        let tokenRole = null;
        try {
            const tokenResult = await currentUser.getIdTokenResult();
            tokenRole = tokenResult?.claims?.role || null;
        } catch (e) {
            tokenRole = null;
        }

        const roleFromDb = userSnap.exists() ? (userSnap.data().role || null) : null;

        // ---- Superadmin override (by UID) ----
        // Single source of truth must match Firestore rules.
        // Priority:
        // 1) VITE_SUPERADMIN_UID (if provided)
        // 2) DEFAULT_SUPERADMIN_UID fallback (project owner UID)
        const superUid = import.meta.env.VITE_SUPERADMIN_UID || DEFAULT_SUPERADMIN_UID;
        const superEmail = (import.meta.env.VITE_SUPERADMIN_EMAIL || DEFAULT_SUPERADMIN_EMAIL || '').toLowerCase();
        const currentEmail = (currentUser.email || '').toLowerCase();
        if ((superUid && currentUser.uid === superUid) || (superEmail && currentEmail === superEmail)) {
            tokenRole = 'superadmin';
        }
        let effectiveRole = (tokenRole || roleFromDb || 'guest');

        // Backward compatibility for old role names
        if (effectiveRole === 'employee') effectiveRole = 'team';

        if (!userSnap.exists()) {
            const initialRole = effectiveRole === 'superadmin' ? 'superadmin' : 'guest';
            const initialPermissions = {};
            try {
                await setDoc(userRef, {
                    email: currentUser.email || '',
                    displayName: currentUser.displayName || '',
                    photoURL: currentUser.photoURL || '',
                    providerId: currentUser.providerData?.[0]?.providerId || 'password',
                    role: initialRole,
                    permissions: initialPermissions,
                    createdAt: serverTimestamp(),
                    lastLoginAt: serverTimestamp(),
                }, { merge: true });
                effectiveRole = initialRole;
            } catch (e) {
                console.warn('[DB] user profile auto-create skipped:', e?.code || e?.message || e);
            }
        } else {
            try {
                await updateDoc(userRef, {
                    lastLoginAt: serverTimestamp(),
                    email: currentUser.email || '',
                    displayName: currentUser.displayName || '',
                    photoURL: currentUser.photoURL || '',
                });
            } catch (e) {
                console.warn('[DB] user profile metadata update skipped:', e?.code || e?.message || e);
            }
        }

        userRole.value = effectiveRole;

        // ---- Permissions (checkboxes) ----
        // Shape: permissions: { "perm.string": true/false }
        userPermissions.value = userSnap.exists() ? (userSnap.data().permissions || {}) : {};

        if (!userSnap.exists()) {
            userPermissions.value = {};
        }
    };

    const subscribeToAllUsers = () => {
        /* guard users list */
                // Only admin/superadmin (or explicit permission) should listen to users list
        if (!(userRole.value === 'admin' || userRole.value === 'superadmin') && !hasPermission('users.list.view')) {
            return;
        }
        const q = query(collection(db, 'users'));
        onSnapshot(q, (snapshot) => {
            allUsers.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        }, (err) => {
            if (err?.code === 'permission-denied') {
                console.warn('[DB] users list listen denied');
                return;
            }
            console.error('[DB] users list listen error:', err);
        });
    };

    const updateUserRole = async (targetUserId, newRole, newPermissions) => {
        // Only superadmin can change roles/permissions (UI may show read-only for others)
        if (userRole.value !== 'superadmin') return false;
        
        const userRef = doc(db, 'users', targetUserId);
        try {
            await updateDoc(userRef, {
                role: newRole,
                permissions: newPermissions
            });
            return true;
        } catch (e) {
            console.error("Ошибка обновления роли:", e);
            return false;
        }
    };

    // --- 2. СИНХРОНИЗАЦИЯ НАСТРОЕК (Firestore) ---
    const subscribeToGlobalSettings = () => {
        syncStatus.value = 'syncing';
        const docRef = doc(db, "settings", "global_config");

        onSnapshot(docRef, async (docSnap) => {
            if (docSnap.exists()) {
                isRemoteUpdate.value = true; 
                const data = docSnap.data();
                applyData(data);
                localStorage.setItem(DB_CACHE_KEY, JSON.stringify(data));
                syncStatus.value = 'success';
                await nextTick();
                isRemoteUpdate.value = false;
            } else {
                syncStatus.value = 'idle';
            }
            setTimeout(() => { if(syncStatus.value === 'success') syncStatus.value = 'idle'; }, 2000);
        }, (err) => {
            if (err?.code === 'permission-denied') {
                console.warn('[DB] settings listen denied (expected for limited roles)');
                syncStatus.value = 'idle';
                return;
            }
            console.error('Ошибка настроек:', err);
            syncStatus.value = 'error';
        });
    };

    const applyData = (data) => {
        if (!data) return;
        if (data.materials) materials.value = data.materials;
        if (data.coatings) coatings.value = data.coatings;
        if (data.processing) processingDB.value = data.processing;
        if (data.accessories) accessoriesDB.value = data.accessories;
        if (data.packaging) packagingDB.value = data.packaging;
        if (data.design) designDB.value = data.design;
        if (data.settings) settings.value = { ...settings.value, ...data.settings };
    };

    // --- 3. СОХРАНЕНИЕ НАСТРОЕК ---
    
    // ===== ARCHIVE HELPERS (универсальный архив удалённых данных) =====
    const makeKey = (x) => {
        if (!x) return '';
        if (typeof x === 'string') return x;
        return String(x.id || x.key || x.uid || x.name || x.title || JSON.stringify(x));
    };

    const diffRemoved = (beforeList, afterList) => {
        const before = Array.isArray(beforeList) ? beforeList : [];
        const after = Array.isArray(afterList) ? afterList : [];
        const afterKeys = new Set(after.map(makeKey));
        return before.filter((x) => !afterKeys.has(makeKey(x)));
    };

    const archiveToUserTrash = async (uid, entry) => {
        const deletedAtISO = new Date().toISOString();
        const expiresAtISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await addDoc(trashCollectionRef(uid), {
            ...entry,
            deletedAt: serverTimestamp(),
            deletedAtISO,
            expiresAtISO,
        });
    };

const saveFullDatabase = async () => {
        // STEP 6: права на глобальные настройки / материалы / цены разделены на read/write.
        // Сохраняем ТОЛЬКО те секции, на которые есть write, и дополнительно защищаемся от случайных вызовов.
        const canWriteGlobal = hasPermission('settings.global.write') || hasPermission('canEditGlobalSettings');
        const canWriteMaterials = hasPermission('settings.materials.write') || hasPermission('canEditMaterials');
        const canWritePrices = hasPermission('settings.prices.write') || hasPermission('canEditPrices');

        const canEditAny = canWriteGlobal || canWriteMaterials || canWritePrices;
        if (!canEditAny) {
            alert('Нет прав на сохранение настроек!');
            return false;
        }


        const u = await requireUserAsync();
        if (!u?.uid) {
            alert('Необходимо войти в аккаунт!');
            syncStatus.value = 'error';
            return false;
        }
        const uid = u.uid;

        // Снимок ДО сохранения (чтобы понять, что реально удалили)
        const beforeSnap = await getDoc(globalConfigDoc());
        const beforeData = beforeSnap.exists() ? (beforeSnap.data() || {}) : {};

        syncStatus.value = 'syncing';

        // ✅ 2.4 Защита от перезаписи настроек:
        // обновляем только те секции, на которые есть права — вместо перезаписи всего документа.
        const docRef = doc(db, "settings", "global_config");
        const payload = {
            updatedAt: serverTimestamp(),
            updatedBy: user.value?.email || 'unknown'
        };

        if (canWriteMaterials) {
            payload.materials = materials.value;
        }

        if (canWritePrices) {
            payload.coatings = coatings.value;
            payload.processing = processingDB.value;
            payload.accessories = accessoriesDB.value;
            payload.packaging = packagingDB.value;
            payload.design = designDB.value;
        }

        if (canWriteGlobal) {
            payload.settings = settings.value;
        }

        try {
            // updateDoc падает, если документа ещё нет — тогда создаём его (merge) без риска затереть поля.
            await updateDoc(docRef, payload);

            // ✅ Архивируем удалённые элементы настроек (срабатывает ТОЛЬКО при сохранении)
            try {
                const writes = [];

                if (canWriteMaterials && payload.materials) {
                    const removed = diffRemoved(beforeData.materials, payload.materials);
                    removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                        itemType: 'settings',
                        dataType: 'materials',
                        sourcePath: 'settings/global_config',
                        name: x?.name || x?.title || '',
                        payload: x
                    })));
                }

                if (canWritePrices) {
                    const map = [
                        ['coatings', payload.coatings],
                        ['processing', payload.processing],
                        ['accessories', payload.accessories],
                        ['packaging', payload.packaging],
                        ['design', payload.design],
                    ];

                    map.forEach(([key, afterList]) => {
                        if (!afterList) return;
                        const removed = diffRemoved(beforeData[key], afterList);
                        removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                            itemType: 'settings',
                            dataType: key,
                            sourcePath: 'settings/global_config',
                            name: x?.name || x?.title || '',
                            payload: x
                        })));
                    });
                }

                if (writes.length) await Promise.allSettled(writes);
            } catch (trashErr) {
                console.warn('[TRASH] archive settings removals failed:', trashErr);
            }

            return true;
        } catch (e) {
            const msg = String(e?.message || '');
            const code = String(e?.code || '');
            const isNotFound = code.includes('not-found') || msg.toLowerCase().includes('no document to update');

            if (isNotFound) {
                try {
                    await setDoc(docRef, payload, { merge: true });

            // ✅ Архивируем удалённые элементы настроек (срабатывает ТОЛЬКО при сохранении)
            try {
                const writes = [];

                if (canWriteMaterials && payload.materials) {
                    const removed = diffRemoved(beforeData.materials, payload.materials);
                    removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                        itemType: 'settings',
                        dataType: 'materials',
                        sourcePath: 'settings/global_config',
                        name: x?.name || x?.title || '',
                        payload: x
                    })));
                }

                if (canWritePrices) {
                    const map = [
                        ['coatings', payload.coatings],
                        ['processing', payload.processing],
                        ['accessories', payload.accessories],
                        ['packaging', payload.packaging],
                        ['design', payload.design],
                    ];

                    map.forEach(([key, afterList]) => {
                        if (!afterList) return;
                        const removed = diffRemoved(beforeData[key], afterList);
                        removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                            itemType: 'settings',
                            dataType: key,
                            sourcePath: 'settings/global_config',
                            name: x?.name || x?.title || '',
                            payload: x
                        })));
                    });
                }

                if (writes.length) await Promise.allSettled(writes);
            } catch (trashErr) {
                console.warn('[TRASH] archive settings removals failed:', trashErr);
            }

                    return true;
                } catch (e2) {
                    console.error("Ошибка сохранения (fallback):", e2);
                    syncStatus.value = 'error';
                    alert("Ошибка сохранения: " + (e2?.message || e2));
                    return false;
                }
            }

            console.error("Ошибка сохранения:", e);
            syncStatus.value = 'error';
            alert("Ошибка сохранения: " + (e?.message || e));
            return false;
        }
    };

    
    // --- 3.2 ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ (вместо src/services/api.js) ---
    // Все операции с Firestore собраны здесь, чтобы не дублировать логику и пути.
    const requireUser = () => {
        const u = auth.currentUser || user.value;
        if (!u) throw new Error('Необходимо войти в аккаунт');
        return u;
    };

    // ✅ Ждём, пока Firebase Auth восстановит сессию (избавляет от "Необходимо войти..." при открытии страниц)
    const requireUserAsync = async (timeoutMs = 5000) => {
        const start = Date.now();
        // уже есть
        if (auth.currentUser || user.value) return (auth.currentUser || user.value);
        // ждём onAuthStateChanged, но без бесконечности
        return await new Promise((resolve, reject) => {
            const unsub = onAuthStateChanged(auth, (u) => {
                if (u) {
                    unsub();
                    resolve(u);
                } else {
                    // если вышел/не вошёл — не падаем сразу, ждём таймаут
                    if (Date.now() - start >= timeoutMs) {
                        unsub();
                        resolve(null);
                    }
                }
            });
            setTimeout(() => {
                try { unsub(); } catch {}
                resolve(null);
            }, timeoutMs);
        });
    };


    const historyDocRef = (uid, id) => historyDoc(uid, id);
    const trashDocRef = (uid, id) => trashDoc(uid, id);
    const historyCollectionRef = (uid) => historyCol(uid);
    const trashCollectionRef = (uid) => trashCol(uid);


    // --- ГЛОБАЛЬНЫЕ ДАННЫЕ (совместимость с прежним API) ---
    const fetchFromGoogleSheet = async () => {
        try {
            const docRef = globalConfigDoc();
            const snap = await getDoc(docRef);
            return snap.exists() ? snap.data() : null;
        } catch (e) {
            console.error('Firestore Fetch Error:', e);
            throw e;
        }
    };

    const saveGlobalData = async (data) => {
        try {
            const docRef = globalConfigDoc();

            // Поддержка legacy payload формата из SettingsModal:
            // { Settings, Materials, Coatings, Processing, Accessories, Packaging, Design }
            const normalized = (data && (data.Settings || data.Materials)) ? {
                settings: data.Settings ?? data.settings,
                materials: data.Materials ?? data.materials,
                coatings: data.Coatings ?? data.coatings,
                processing: data.Processing ?? data.processing,
                accessories: data.Accessories ?? data.accessories,
                packaging: data.Packaging ?? data.packaging,
                design: data.Design ?? data.design
            } : data;

            await setDoc(docRef, {
                ...normalized,
                updatedAt: serverTimestamp(),
                updatedBy: (auth.currentUser?.email || user.value?.email || 'unknown')
            }, { merge: true });

            return { status: 'success', message: 'База данных обновлена' };
        } catch (e) {
            console.error('Firestore Save Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    // Совместимость со старым интерфейсом/импортами
    const sendToGoogleSheet = async (action, _sheet, payload) => {
        console.warn('sendToGoogleSheet (legacy) -> Firestore');
        if (action === 'syncAll') return saveGlobalData(payload);
        return { status: 'error', message: 'Метод не поддерживается' };
    };

    // --- ИСТОРИЯ/КОРЗИНА (совместимость со старым API) ---
    /**
     * История проектов (пагинация)
     *
     * По умолчанию возвращает первые 50 записей, отсортированные по дате (desc).
     * Для подгрузки используйте cursor из предыдущего ответа.
     *
     * @param {{ pageSize?: number, cursor?: any }} [opts]
     * @returns {{result: any[], cursor: any, hasMore: boolean} | {status:'error', message:string}}
     */
    const getCloudHistory = async (opts = {}) => {
        try {
            const { uid } = requireUser();
            const pageSize = Number.isFinite(Number(opts.pageSize)) ? Number(opts.pageSize) : 50;
            const cursor = opts.cursor || null;

            const base = [
                orderBy('savedAt', 'desc'),
                fsLimit(pageSize)
            ];

            const q = cursor
                ? query(historyCollectionRef(uid), ...base, startAfter(cursor))
                : query(historyCollectionRef(uid), ...base);

            const snap = await getDocs(q);
            const items = snap.docs.map(d => {
                const raw = d.data() || {};
                const stateProject = raw?.state?.project || {};
                const name = (raw.name || stateProject.name || '').toString().trim();
                const client = (raw.client || stateProject.client || '').toString().trim();
                const date = raw.date || raw.savedAt || null;

                return {
                    ...raw,
                    id: d.id,
                    projectId: raw?.id || d.id,
                    name: name || 'Без названия',
                    client,
                    date
                };
            });

            const last = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

            // Если пришло меньше pageSize — подгружать нечего.
            const hasMore = snap.docs.length === pageSize;

            return { result: items, cursor: last, hasMore };
        } catch (e) {
            console.error('Get History Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const saveCloudHistory = async (projectData) => {
        try {
            const { uid } = requireUser();
            if (!projectData?.id) throw new Error('Нет ID проекта');

            const stateProject = projectData?.state?.project || {};
            const normalizedName = (projectData.name || stateProject.name || '').toString().trim();
            const normalizedClient = (projectData.client || stateProject.client || '').toString().trim();
            const nowIso = new Date().toISOString();

            const dataToSave = {
                ...projectData,
                name: normalizedName || 'Без названия',
                client: normalizedClient,
                date: projectData?.date || nowIso,
                savedAt: nowIso
            };

            await setDoc(historyDocRef(uid, projectData.id), dataToSave, { merge: true });
            return { status: 'success', message: 'Проект сохранен' };
        } catch (e) {
            console.error('Save History Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const deleteCloudHistory = async (id) => {
        try {
            const { uid } = requireUser();
            if (!id) throw new Error('Нет ID проекта');

            let fromRef = historyDocRef(uid, id);
            let snap = await getDoc(fromRef);

            // Backward compatibility:
            // if caller passed legacy payload id (stored field), find real Firestore doc id.
            if (!snap.exists()) {
                const byFieldQ = query(
                    historyCollectionRef(uid),
                    where('id', '==', id),
                    fsLimit(1)
                );
                const byFieldSnap = await getDocs(byFieldQ);
                if (!byFieldSnap.empty) {
                    fromRef = byFieldSnap.docs[0].ref;
                    snap = byFieldSnap.docs[0];
                }
            }

            if (!snap.exists()) return { status: 'error', message: 'Проект не найден' };

            const data = snap.data();
            const toTrashRef = trashDocRef(uid, id);
            // /users/{uid}/trash forbids update in rules; recreate doc to keep operation in "create" path.
            try { await deleteDoc(toTrashRef); } catch (_) {}

            await setDoc(toTrashRef, {
                itemType: 'projects',
                ...data,
                id,
                sourceHistoryId: id,
                deletedAt: serverTimestamp(),
                deletedAtISO: new Date().toISOString(),
                // ⚠️ НЕ УДАЛЯТЬ: срок хранения корзины (30 дней) — используется для фильтрации/сортировки
                expiresAtISO: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            });

            // ⚠️ НЕ УДАЛЯТЬ: фиксируем событие для плавного вытеснения (~30 дней)
            await writeGarbage(uid, { action: 'history_delete', historyId: id });
            await deleteDoc(fromRef);
            return { status: 'success', message: 'Проект перемещен в корзину' };
        } catch (e) {
            console.error('Delete History Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const getCloudTrash = async () => {
        try {
            const u = await requireUserAsync();
            if (!u?.uid) return [];
            const uid = u.uid;

            const snap = await getDocs(trashCollectionRef(uid));
            const trash = [];
            snap.forEach((d) => {
                const raw = d.data() || {};
                trash.push({ ...raw, id: d.id, trashId: raw?.id || d.id });
            });

            // фильтрация: последние ~31 день
            const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000;
            const parseMs = (iso) => {
                if (!iso) return 0;
                const t = new Date(iso).getTime();
                return Number.isFinite(t) ? t : 0;
            };

            return trash
                .filter((x) => {
                    const ms = parseMs(x.expiresAtISO || x.deletedAtISO);
                    return ms === 0 ? true : ms >= cutoff;
                })
                .sort((a, b) => parseMs(b.deletedAtISO) - parseMs(a.deletedAtISO));
        } catch (e) {
            console.error('Trash Error:', e);
            return [];
        }
    };

    const restoreCloudHistoryFromTrash = async (id, opts = {}) => {
        try {
            const u = await requireUserAsync();
            const uid = u?.uid;
            if (!uid) throw new Error('Необходимо войти в аккаунт');
            if (!id) throw new Error('Нет ID');

            const fromRef = trashDocRef(uid, id);
            const snap = await getDoc(fromRef);
            if (!snap.exists()) return { status: 'error', message: 'Элемент не найден в архиве' };

            const data = snap.data() || {};

            // ===== STEP 6: срок хранения / запрет восстановления после purge =====
            const nowMs = Date.now();
            const expIso = data.expiresAtISO || data.purgeAtISO || null;
            if (expIso) {
                const expMs = new Date(expIso).getTime();
                if (Number.isFinite(expMs) && expMs <= nowMs) {
                    // Просрочено — удаляем запись из архива и запрещаем восстановление
                    await deleteDoc(fromRef);
                    return { status: 'error', message: 'Срок хранения истёк (30 дней). Запись удалена из архива.' };
                }
            }

            // ===== STEP 6: права на восстановление =====
            // settings restore требует прав на запись глобальных настроек
            if (data.itemType === 'settings' && !hasPermission('canEditGlobalSettings') && !hasPermission('settings.global.write')) {
                throw new Error('Недостаточно прав для восстановления настроек');
            }
            // projects/history restore требует права на запись истории
            if (data.itemType !== 'settings' && !hasPermission('canSaveHistory') && !hasPermission('history.write')) {
                throw new Error('Недостаточно прав для восстановления данных');
            }

            const destination = opts?.destination || null;

            
            const writeRestoreAudit = async (meta = {}) => {
                try {
                    // ⚠️ Пишем в /users/{uid}/history — других коллекций правилами не разрешено
                    // Чтобы не ломать историю проектов, помечаем запись как audit.
                    await addDoc(historyCollectionRef(uid), {
                        audit: true,
                        action: 'restore',
                        source: 'trash',
                        type: data.itemType || data.type || 'unknown',
                        title: data?.title || data?.name || data?.data?.name || data?.data?.title || meta?.title || 'Восстановление',
                        restoredAt: serverTimestamp(),
                        savedAt: new Date().toISOString(),
                        restoredBy: uid,
                        destination: destination,
                        trashId: id,
                        meta: meta
                    });
                } catch (e) {
                    // лог не должен блокировать восстановление
                    console.warn('Restore audit log failed:', e?.message || e);
                }
            };
// ===== Восстановление настроек (settings/global_config) =====
            if (data.itemType === 'settings') {
                const key = data.dataType;
                if (!key) throw new Error('Не указан тип данных (dataType)');

                const item = data.payload;
                if (!item) throw new Error('Нет данных для восстановления');

                await updateDoc(globalConfigDoc(), {
                    [key]: arrayUnion(item)
                });

                await writeRestoreAudit({ module: 'settings', key });

                await deleteDoc(fromRef);
                return { status: 'success', message: 'Данные восстановлены' };
            }

            // ===== Восстановление проектов истории (по-умолчанию) =====
            const { deletedAt, deletedAtISO, expiresAtISO, ...rest } = data;
            const historyId = rest?.sourceHistoryId || rest?.id || id;
            await setDoc(historyDocRef(uid, historyId), {
                ...rest,
                id: historyId,
                savedAt: rest.savedAt || new Date().toISOString()
            }, { merge: true });

            await writeRestoreAudit({ module: 'history' });

            await deleteDoc(fromRef);
            return { status: 'success', message: 'Проект восстановлен' };
        } catch (e) {
            console.error('Restore Trash Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const deleteTrashForever = async (id) => {
        try {
            const u = await requireUserAsync();
            const uid = u?.uid;
            if (!uid) throw new Error('Необходимо войти в аккаунт');
            if (!id) throw new Error('Нет ID');

            await deleteDoc(trashDocRef(uid, id));
            return { status: 'success', message: 'Удалено навсегда' };
        } catch (e) {
            console.error('Delete Trash Forever Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };


// --- 4. ИСТОРИЯ ---
    const subscribeToHistory = () => {
        if (!user.value) return;
        const q = query(
            historyCol(user.value.uid),
            orderBy('date', 'desc')
        );
        onSnapshot(q, (snapshot) => {
            userHistory.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        }, (err) => {
            if (err?.code === 'permission-denied') {
                console.warn('[DB] history listen denied');
                return;
            }
            console.error('[DB] history listen error:', err);
        });
    };

    const saveProjectToHistory = async (projectData) => {
        if (!hasPermission('canSaveHistory')) {
            alert("У вас нет прав на сохранение истории.");
            return false;
        }
        try {
            await addDoc(historyCol(user.value.uid), {
                ...projectData,
                date: serverTimestamp()
            });
            return true;
        } catch (e) {
            console.error("Ошибка сохранения проекта:", e);
            return false;
        }
    };

    // --- ВСПОМОГАТЕЛЬНЫЕ ---
    const searchGlobal = (queryStr) => { 
        if (!queryStr || String(queryStr).trim().length === 0) return [];
        const q = String(queryStr).toLowerCase().trim();

        const normalize = (x) => ({
            id: x?.id || x?.uid || x?.key || x?.name || '',
            name: x?.name || x?.title || '',
            raw: x
        });

        const searchIn = (list, typeId, label) =>
            (Array.isArray(list) ? list : [])
                .map((i) => ({ ...normalize(i), itemType: typeId, itemLabel: label }))
                .filter((item) => (item.name || '').toLowerCase().includes(q));

        return [
            ...searchIn(materials.value, 'materials', 'Материал'),
            ...searchIn(coatings.value, 'coatings', 'Покрытие'),
            ...searchIn(processingDB.value, 'processing', 'Услуга'),
            ...searchIn(accessoriesDB.value, 'accessories', 'Аксессуар'),
            ...searchIn(packagingDB.value, 'packaging', 'Упаковка'),
            ...searchIn(designDB.value, 'design', 'Дизайн'),
        ];
    };
    
    const materialGroups = computed(() => {
        const groups = {};
        materials.value.forEach(m => {
            const type = m.type || 'Прочее';
            if (!groups[type]) groups[type] = [];
            groups[type].push(m);
        });
        return groups;
    });

    const isAdmin = computed(() => userRole.value === 'admin');
    const isSuperAdmin = computed(() => userRole.value === 'superadmin');

    // --- AUDIT LOGS (STEP 5) ---
    const requireSuperAdmin = () => {
        if (!isSuperAdmin.value) throw new Error('SuperAdmin only');
    };

    const writeAuditLog = async (event) => {
        requireSuperAdmin();
        const payload = {
            ...event,
            // server time for reliable ordering
            ts: serverTimestamp(),
            // client timestamp for quick filtering/debug
            tsMs: Date.now(),
        };
        await addDoc(collection(db, 'audit_logs'), payload);
        return payload;
    };

    const listAuditLogs = async ({ pageSize = 30, cursorDoc = null, action = null } = {}) => {
        requireSuperAdmin();
        const col = collection(db, 'audit_logs');
        const parts = [];
        if (action) parts.push(where('action', '==', action));
        parts.push(orderBy('ts', 'desc'));
        if (cursorDoc) parts.push(startAfter(cursorDoc));
        parts.push(fsLimit(pageSize));

        const q = query(col, ...parts);
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data(), __ref: d.ref }));
        const last = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
        return { items, cursorDoc: last, hasMore: snap.docs.length === pageSize };
    };

    return {
        materials, coatings, processingDB, accessoriesDB, packagingDB, designDB, settings,
        materialGroups, userHistory, allUsers,
        syncStatus, isLoaded, user, 
        isAdmin, // Legacy
        isSuperAdmin,
        userRole, 
        hasPermission, // <--- НОВАЯ ФУНКЦИЯ ПРАВ
        isRemoteUpdate,
        initDatabase, saveFullDatabase, saveProjectToHistory, updateUserRole, searchGlobal,
        // Legacy API compatibility (ex-services/api.js)
        fetchFromGoogleSheet, saveGlobalData, sendToGoogleSheet,
        getCloudHistory, saveCloudHistory, deleteCloudHistory,
        getCloudTrash, restoreCloudHistoryFromTrash, deleteTrashForever
        ,
        // STEP 5
        writeAuditLog,
        listAuditLogs
    };
}
const forbidClient = () => { if (userRole.value === 'client') throw new Error('Client write forbidden'); };