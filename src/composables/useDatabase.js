import { ref, computed, nextTick } from 'vue';
import { 
    emptyMaterials, emptyCoatings, 
    emptyProcessingDB, emptyAccessoriesDB, 
    emptyPackagingDB, emptyDesignDB, 
    defaultSettings, 
    DB_CACHE_KEY 
} from '../data/defaults';
import { db, auth } from '@/firebase';
import { historyDoc, trashDoc, historyCol, trashCol, globalConfigDoc } from '@/core/db/collections';
import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, serverTimestamp,
    collection, addDoc, query, orderBy, getDocs, deleteDoc,
    limit as fsLimit, startAfter, where
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { canUser } from '@/core/auth/access';
import {
    buildLegacyDtfGarmentPriceMap,
    normalizeDtfFlexColorMarkups,
    normalizeDtfFlexMaterials,
    normalizeDtfGarments,
    normalizeDtfSublimationFormats,
} from '@/calculators/dtf/constants';
import { COATING_PRICING_MODE_DTF_LINEAR, getCoatingPricePerCm2 } from '@/utils/coatingPricing';
// ── единые модули корзины и ротации мусора ──
import { moveToTrash as _moveToTrash, addToTrash as _addToTrash, restoreFromTrash as _restoreFromTrash, deleteForever as _deleteForever, listTrashItems as _listTrashItems, TRASH_TTL_DAYS } from '@/composables/useTrash';
import { ensureDailyGarbageSlot as _ensureGarbage, writeGarbageEvent as _writeGarbage } from '@/composables/useGarbage';

const isDtfLinearCoating = (item) => item?.pricingModel === COATING_PRICING_MODE_DTF_LINEAR;

const createProcessingItemFromDtfCoating = (coating) => {
    const markupPercent = Math.max(0, Number(coating?.markupPercent) || 0);
    const rawPricePerCm2 = Math.max(0, Number(getCoatingPricePerCm2(coating, { includeMarkup: false })) || 0);
    return {
        id: `processing_dtf_${coating?.id || Date.now()}`,
        name: coating?.name || 'DTF печать',
        type: 'area_cm2',
        price: rawPricePerCm2,
        value: null,
        qty: 1,
        active: coating?.inStock !== false && coating?.active !== false,
        markupPercent,
        isDtfPrint: true,
        migratedFromCoatingId: coating?.id || null,
    };
};

const normalizeGlobalData = (data) => {
    if (!data || typeof data !== 'object') return data;

    const nextData = { ...data };
    const rawCoatings = Array.isArray(data.coatings) ? data.coatings : [];
    const rawProcessing = Array.isArray(data.processing) ? [...data.processing] : [];
    const dtfCoatings = rawCoatings.filter(isDtfLinearCoating);

    if (!dtfCoatings.length) return nextData;

    dtfCoatings.forEach((coating) => {
        const alreadyExists = rawProcessing.some((item) => {
            if (!item) return false;
            if (item?.migratedFromCoatingId && coating?.id) return item.migratedFromCoatingId === coating.id;
            return item?.isDtfPrint === true && String(item?.name || '').trim() === String(coating?.name || '').trim();
        });

        if (!alreadyExists) {
            rawProcessing.unshift(createProcessingItemFromDtfCoating(coating));
        }
    });

    nextData.coatings = rawCoatings.filter((item) => !isDtfLinearCoating(item));
    nextData.processing = rawProcessing;
    if (nextData.settings && typeof nextData.settings === 'object') {
        const dtfGarments = normalizeDtfGarments(nextData.settings.dtfGarments, nextData.settings.dtfGarmentPrices);
        nextData.settings = {
            ...nextData.settings,
            clientMaterialPrintRiskPercent: Math.max(0, Number(nextData.settings.clientMaterialPrintRiskPercent) || 0),
            dtfGarments,
            dtfGarmentPrices: buildLegacyDtfGarmentPriceMap(dtfGarments),
            dtfFlexColorMarkups: normalizeDtfFlexColorMarkups(nextData.settings.dtfFlexColorMarkups),
            dtfFlexMaterials: normalizeDtfFlexMaterials(nextData.settings.dtfFlexMaterials),
            dtfSublimationFormats: normalizeDtfSublimationFormats(nextData.settings.dtfSublimationFormats),
        };
    }
    return nextData;
};


// =========================================================
// GARBAGE — ротация слотов делегирована в useGarbage.ts
// =========================================================
const ensureDailyGarbageSlot = (uid) => _ensureGarbage(uid);
const writeGarbage = (uid, payload) => _writeGarbage(uid, payload);

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ (Singleton) ---
const materials = ref([...emptyMaterials]);
const coatings = ref([...emptyCoatings]);
const processingDB = ref([...emptyProcessingDB]);
const accessoriesDB = ref([...emptyAccessoriesDB]);
const packagingDB = ref([...emptyPackagingDB]);
const designDB = ref([...emptyDesignDB]);
const masterPriceCatalog = ref([]);
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
const isOfflineMode = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false);

const OFFLINE_HISTORY_QUEUE_KEY = 'monocalc_offline_history_queue_v1';
const AUTH_SESSION_CACHE_KEY = 'monocalc_auth_session_v1';

const readCachedAuthSession = () => {
    try {
        const raw = localStorage.getItem(AUTH_SESSION_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed?.uid) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writeCachedAuthSession = (session) => {
    try {
        if (!session || !session?.uid) return;
        localStorage.setItem(AUTH_SESSION_CACHE_KEY, JSON.stringify(session));
    } catch {}
};

const clearCachedAuthSession = () => {
    try { localStorage.removeItem(AUTH_SESSION_CACHE_KEY); } catch {}
};

const readOfflineQueue = () => {
    try {
        const raw = localStorage.getItem(OFFLINE_HISTORY_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};
const writeOfflineQueue = (queue) => {
    const normalized = Array.isArray(queue) ? queue : [];
    try {
        localStorage.setItem(OFFLINE_HISTORY_QUEUE_KEY, JSON.stringify(normalized));
    } catch {}
};
const pendingProjectQueue = ref(readOfflineQueue());
const pendingProjectSyncCount = computed(() => pendingProjectQueue.value.length);
let networkListenersBound = false;
let networkProbeIntervalId = null;
let networkProbeInFlight = false;
let unsubscribeAuthListener = null;
let unsubscribeUsersListener = null;
let unsubscribeSettingsListener = null;
let unsubscribeHistoryListener = null;

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

export function useDatabase() {
    const hasHistoryWriteAccess = () => hasPermission('canSaveHistory') || hasPermission('history.write');

    const clearUserScopedSubscriptions = () => {
        if (typeof unsubscribeUsersListener === 'function') {
            try { unsubscribeUsersListener(); } catch {}
        }
        if (typeof unsubscribeHistoryListener === 'function') {
            try { unsubscribeHistoryListener(); } catch {}
        }
        unsubscribeUsersListener = null;
        unsubscribeHistoryListener = null;
    };

    const setOfflineState = () => {
        isOfflineMode.value = true;
        syncStatus.value = 'offline';
    };

    const setOnlineState = () => {
        isOfflineMode.value = false;
        if (syncStatus.value === 'offline') syncStatus.value = 'idle';
    };

    const probeNetworkReachability = async () => {
        if (typeof window === 'undefined') return !isOfflineMode.value;

        if (!navigator.onLine) {
            setOfflineState();
            return false;
        }

        if (networkProbeInFlight) return !isOfflineMode.value;
        networkProbeInFlight = true;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const baseUrl = import.meta.env.BASE_URL || '/';
            const probeUrl = `${baseUrl}favicon.svg?network_probe=${Date.now()}`;

            const response = await fetch(probeUrl, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                setOnlineState();
                return true;
            }

            setOfflineState();
            return false;
        } catch {
            setOfflineState();
            return false;
        } finally {
            networkProbeInFlight = false;
        }
    };

    const restoreCachedAuthState = () => {
        const cached = readCachedAuthSession();
        if (!cached?.uid) return false;

        user.value = {
            uid: cached.uid,
            email: cached.email || '',
            displayName: cached.displayName || '',
            photoURL: cached.photoURL || '',
        };
        userRole.value = cached.role || 'guest';
        userPermissions.value = cached.permissions || {};
        return true;
    };

    const upsertOfflineProject = ({ uid, id, payload }) => {
        if (!uid || !id || !payload) return;
        const queue = Array.isArray(pendingProjectQueue.value) ? [...pendingProjectQueue.value] : [];
        const next = {
            uid,
            id,
            payload,
            queuedAt: new Date().toISOString()
        };
        const idx = queue.findIndex((item) => item?.uid === uid && item?.id === id);
        if (idx >= 0) queue[idx] = next;
        else queue.push(next);
        pendingProjectQueue.value = queue;
        writeOfflineQueue(queue);
    };

    const flushPendingProjectQueue = async () => {
        if (isOfflineMode.value) return 0;
        const queue = Array.isArray(pendingProjectQueue.value) ? [...pendingProjectQueue.value] : [];
        if (!queue.length) return 0;

        const u = await requireUserAsync(4000);
        if (!u?.uid) return 0;
        if (!hasHistoryWriteAccess()) return 0;

        const remaining = [];
        let synced = 0;

        for (const item of queue) {
            if (!item?.uid || !item?.id || !item?.payload) continue;
            if (item.uid !== u.uid) {
                remaining.push(item);
                continue;
            }

            try {
                await setDoc(historyDocRef(u.uid, item.id), item.payload, { merge: true });
                synced++;
            } catch (e) {
                const code = String(e?.code || '');
                if (code === 'permission-denied') {
                    remaining.push(item);
                    continue;
                }
                remaining.push(item);
            }
        }

        pendingProjectQueue.value = remaining;
        writeOfflineQueue(remaining);
        return synced;
    };

    const bindNetworkListeners = () => {
        if (networkListenersBound || typeof window === 'undefined') return;

        const onOffline = () => {
            setOfflineState();
        };
        const onOnline = async () => {
            const reachable = await probeNetworkReachability();
            if (reachable) await flushPendingProjectQueue();
        };
        const onVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                const reachable = await probeNetworkReachability();
                if (reachable) await flushPendingProjectQueue();
            }
        };

        window.addEventListener('offline', onOffline);
        window.addEventListener('online', onOnline);
        document.addEventListener('visibilitychange', onVisibilityChange);

        if (!networkProbeIntervalId) {
            networkProbeIntervalId = setInterval(() => {
                probeNetworkReachability();
            }, 15000);
        }

        networkListenersBound = true;
    };
    
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

        bindNetworkListeners();
        await probeNetworkReachability();
        pendingProjectQueue.value = readOfflineQueue();

        if (isOfflineMode.value && !auth.currentUser) {
            restoreCachedAuthState();
        }

        // Загрузка из кэша для скорости
        let cachedDB = null;
        try {
            cachedDB = localStorage.getItem(DB_CACHE_KEY);
        } catch (e) {
            cachedDB = null;
        }
        if (cachedDB) { 
            try { applyData(JSON.parse(cachedDB)); } 
            catch (e) { console.error('Cache init error', e); } 
        }

        // Слушаем авторизацию
        unsubscribeAuthListener = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                user.value = currentUser;
                clearUserScopedSubscriptions();
                // ⚠️ НЕ УДАЛЯТЬ: гарантируем ежедневное обслуживание мусорного слота
                // уже после появления auth uid.
                try { await ensureDailyGarbageSlot(currentUser.uid); } catch (e) {}

                // 1. Регистрируем/Загружаем профиль
                try {
                    await checkAndRegisterUser(currentUser);
                } catch (e) {
                    const code = String(e?.code || '');
                    if (isOfflineMode.value || code === 'unavailable' || code === 'deadline-exceeded') {
                        restoreCachedAuthState();
                    } else {
                        console.error('[DB] auth profile load failed:', e);
                        setGuestState();
                        return;
                    }
                }
                
                // 2. Если есть право управлять командой — грузим список всех юзеров
                if (userRole.value === 'superadmin' || hasPermission('users.list.view') || hasPermission('canManageTeam')) {
                    subscribeToAllUsers();
                }

                // 3. Если есть право сохранять историю — грузим её
                if (hasPermission('canSaveHistory')) {
                    subscribeToHistory();
                }

                if (!isOfflineMode.value && hasHistoryWriteAccess()) {
                    await flushPendingProjectQueue();
                }
            } else {
                clearUserScopedSubscriptions();
                if (isOfflineMode.value && restoreCachedAuthState()) return;
                setGuestState();
            }
        });

        // Всегда слушаем глобальные настройки (цены)
        subscribeToGlobalSettings();
        isLoaded.value = true;
    };

    const setGuestState = ({ clearSessionCache = true } = {}) => {
        clearUserScopedSubscriptions();
        userRole.value = 'guest';
        userPermissions.value = {};
        user.value = null;
        userHistory.value = [];
        allUsers.value = [];
        if (clearSessionCache) clearCachedAuthSession();
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
        if (superUid && currentUser.uid === superUid) {
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

        writeCachedAuthSession({
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || '',
            photoURL: currentUser.photoURL || '',
            role: userRole.value,
            permissions: userPermissions.value || {},
            savedAt: new Date().toISOString(),
        });
    };

    const subscribeToAllUsers = () => {
        /* guard users list */
                // Only admin/superadmin (or explicit permission) should listen to users list
        if (!(userRole.value === 'admin' || userRole.value === 'superadmin') && !hasPermission('users.list.view')) {
            if (typeof unsubscribeUsersListener === 'function') {
                try { unsubscribeUsersListener(); } catch {}
            }
            unsubscribeUsersListener = null;
            return;
        }
        const q = query(collection(db, 'users'));
        if (typeof unsubscribeUsersListener === 'function') {
            try { unsubscribeUsersListener(); } catch {}
        }
        unsubscribeUsersListener = onSnapshot(q, (snapshot) => {
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

        if (typeof unsubscribeSettingsListener === 'function') {
            try { unsubscribeSettingsListener(); } catch {}
        }

        unsubscribeSettingsListener = onSnapshot(docRef, async (docSnap) => {
            const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
            if (!browserOnline) {
                isOfflineMode.value = true;
                syncStatus.value = 'offline';
            }

            if (docSnap.exists()) {
                isRemoteUpdate.value = true; 
                const data = normalizeGlobalData(docSnap.data());
                applyData(data);
                try {
                    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(data));
                } catch (e) {}
                syncStatus.value = isOfflineMode.value ? 'offline' : 'success';
                await nextTick();
                isRemoteUpdate.value = false;
            } else {
                syncStatus.value = isOfflineMode.value ? 'offline' : 'idle';
            }
            setTimeout(() => {
                if (syncStatus.value === 'success') syncStatus.value = 'idle';
                if (isOfflineMode.value) syncStatus.value = 'offline';
            }, 2000);
        }, (err) => {
            if (err?.code === 'permission-denied') {
                console.warn('[DB] settings listen denied (expected for limited roles)');
                syncStatus.value = 'idle';
                return;
            }
            const code = String(err?.code || '');
            if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'network-request-failed') {
                isOfflineMode.value = true;
                syncStatus.value = 'offline';
                return;
            }
            console.error('Ошибка настроек:', err);
            syncStatus.value = 'error';
        });
    };

    const applyData = (data) => {
        const normalized = normalizeGlobalData(data);
        if (!normalized) return;
        if (normalized.materials) materials.value = normalized.materials;
        if (normalized.coatings) coatings.value = normalized.coatings;
        if (normalized.processing) processingDB.value = normalized.processing;
        if (normalized.accessories) accessoriesDB.value = normalized.accessories;
        if (normalized.packaging) packagingDB.value = normalized.packaging;
        if (normalized.design) designDB.value = normalized.design;
        if (Array.isArray(normalized.masterPriceCatalog)) masterPriceCatalog.value = normalized.masterPriceCatalog;
        if (normalized.settings) settings.value = { ...settings.value, ...normalized.settings };
    };

    // --- 3. СОХРАНЕНИЕ НАСТРОЕК ---
    
    // ===== TRASH HELPERS (единый контур корзины удалённых данных) =====
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

    // Записываем в корзину через единый модуль useTrash
    const archiveToUserTrash = async (uid, entry) => {
        await _addToTrash(uid, entry);
    };

const saveFullDatabase = async () => {
        // STEP 6: права на глобальные настройки / материалы / цены разделены на read/write.
        // Сохраняем ТОЛЬКО те секции, на которые есть write, и дополнительно защищаемся от случайных вызовов.
        const canWriteGlobal = hasPermission('settings.global.write') || hasPermission('canEditGlobalSettings');
        const canWriteMaterials = hasPermission('settings.materials.write') || hasPermission('canEditMaterials');
        const canWritePrices = hasPermission('settings.prices.write') || hasPermission('canEditPrices');
        const canWriteMasterPrices = canWritePrices || canWriteGlobal;

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
        } else if (canWritePrices) {
            payload['settings.dtfGarments'] = settings.value?.dtfGarments || [];
            payload['settings.dtfGarmentPrices'] = settings.value?.dtfGarmentPrices || {};
            payload['settings.dtfFlexColorMarkups'] = settings.value?.dtfFlexColorMarkups || [];
            payload['settings.dtfFlexMaterials'] = settings.value?.dtfFlexMaterials || [];
            payload['settings.dtfSublimationFormats'] = settings.value?.dtfSublimationFormats || [];
        }

        if (canWriteMasterPrices) {
            payload.masterPriceCatalog = masterPriceCatalog.value;
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

                if (canWriteMasterPrices && payload.masterPriceCatalog) {
                    const removed = diffRemoved(beforeData.masterPriceCatalog, payload.masterPriceCatalog);
                    removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                        itemType: 'settings',
                        dataType: 'masterPriceCatalog',
                        sourcePath: 'settings/global_config',
                        name: x?.name || x?.title || '',
                        payload: x
                    })));
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

                if (canWriteMasterPrices && payload.masterPriceCatalog) {
                    const removed = diffRemoved(beforeData.masterPriceCatalog, payload.masterPriceCatalog);
                    removed.forEach((x) => writes.push(archiveToUserTrash(uid, {
                        itemType: 'settings',
                        dataType: 'masterPriceCatalog',
                        sourcePath: 'settings/global_config',
                        name: x?.name || x?.title || '',
                        payload: x
                    })));
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
                    // Разрешаем null сразу, если пользователь реально не вошёл (не ждём таймаут зря)
                    unsub();
                    resolve(null);
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
        // Wrap core logic in a promise so we can race it with a timeout to avoid hanging UI
        const core = async () => {
            const u = await requireUserAsync();
            if (!u?.uid) throw new Error('Необходимо войти в аккаунт');
            const uid = u.uid;
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
                const qty = Number(raw?.qty || stateProject?.qty || 1);
                const normalizedQty = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
                const rawTotal = Number(raw?.total || 0);
                const rawTotalPerUnit = Number(raw?.totalPerUnit || 0);
                const rawTotalOrder = Number(raw?.totalOrder || 0);

                const totalPerUnit = rawTotalPerUnit > 0
                    ? rawTotalPerUnit
                    : (rawTotalOrder > 0 ? rawTotalOrder / normalizedQty : rawTotal);

                const totalOrder = rawTotalOrder > 0
                    ? rawTotalOrder
                    : (rawTotalPerUnit > 0 ? (rawTotalPerUnit * normalizedQty) : (rawTotal * normalizedQty));

                return {
                    ...raw,
                    id: d.id,
                    projectId: raw?.id || d.id,
                    name: name || 'Без названия',
                    client,
                    date,
                    qty: normalizedQty,
                    total: Math.round(totalOrder),
                    totalPerUnit: Math.round(totalPerUnit),
                    totalOrder: Math.round(totalOrder)
                };
            });

            const last = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
            const hasMore = snap.docs.length === pageSize;
            return { result: items, cursor: last, hasMore };
        };

        try {
            const TIMEOUT_MS = 10000;
            return await Promise.race([
                core(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('История: таймаут запроса')), TIMEOUT_MS))
            ]);
        } catch (e) {
            console.error('Get History Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const saveCloudHistory = async (projectData) => {
        try {
            const u = await requireUserAsync();
            if (!u?.uid) throw new Error('Необходимо войти в аккаунт');
            const uid = u.uid;
            if (!hasHistoryWriteAccess()) throw new Error('Недостаточно прав для сохранения истории');
            if (!projectData?.id) throw new Error('Нет ID проекта');
            const isNetworkOffline = isOfflineMode.value || (typeof navigator !== 'undefined' && !navigator.onLine);

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

            if (isNetworkOffline) {
                upsertOfflineProject({
                    uid,
                    id: projectData.id,
                    payload: dataToSave
                });
                syncStatus.value = 'offline';
                return { status: 'queued', message: 'Офлайн: проект сохранён в кэш и будет синхронизирован позже' };
            }

            // Wrapping setDoc in a race to prevent endless hanging when offline but not cleanly detected
            const savePromise = setDoc(historyDocRef(uid, projectData.id), dataToSave, { merge: true });
            
            await Promise.race([
                savePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout_saving')), 5000))
            ]);

            return { status: 'success', message: 'Проект сохранен' };
        } catch (e) {
            const code = String(e?.code || '');
            const msg = String(e?.message || '').toLowerCase();
            const isNetworkIssue =
                isOfflineMode.value ||
                !navigator.onLine ||
                code === 'unavailable' ||
                code === 'deadline-exceeded' ||
                msg.includes('offline') ||
                msg.includes('network');

            if (projectData?.id && isNetworkIssue) {
                const u = auth.currentUser || user.value;
                if (u?.uid && hasHistoryWriteAccess()) {
                    const stateProject = projectData?.state?.project || {};
                    const normalizedName = (projectData.name || stateProject.name || '').toString().trim();
                    const normalizedClient = (projectData.client || stateProject.client || '').toString().trim();
                    const nowIso = new Date().toISOString();

                    upsertOfflineProject({
                        uid: u.uid,
                        id: projectData.id,
                        payload: {
                            ...projectData,
                            name: normalizedName || 'Без названия',
                            client: normalizedClient,
                            date: projectData?.date || nowIso,
                            savedAt: nowIso
                        }
                    });

                    isOfflineMode.value = true;
                    syncStatus.value = 'offline';
                    return { status: 'queued', message: 'Офлайн: проект поставлен в очередь синхронизации' };
                }
            }

            console.error('Save History Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const deleteCloudHistory = async (id) => {
        try {
            const u = await requireUserAsync();
            if (!u?.uid) throw new Error('Необходимо войти в аккаунт');
            const uid = u.uid;
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
            const projectId = String(data?.id || fromRef.id || id || '');
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
            // Не должно блокировать удаление истории, если правила для garbage не выданы.
            try {
                await writeGarbage(uid, { action: 'history_delete', historyId: id });
            } catch (garbageErr) {
                console.warn('[GARBAGE] write skipped:', garbageErr?.code || garbageErr?.message || garbageErr);
            }
            await deleteDoc(fromRef);

            await safeWriteAdminAudit(uid, {
                action: 'delete',
                actorUid: u.uid,
                actorEmail: u.email || user.value?.email || null,
                actorRole: userRole.value || null,
                entityType: 'history',
                entityId: projectId,
                entityPath: fromRef.path,
                before: summarizeProjectAuditPayload(data, projectId),
                after: {
                    status: 'moved_to_trash',
                    trashPath: toTrashRef.path,
                    trashId: id,
                },
                source: 'history-delete',
            });

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
            return await _listTrashItems(u.uid);
        } catch (e) {
            console.error('Trash Error:', e);
            return [];
        }
    };

    const restoreCloudHistoryFromTrash = async (id, options = {}) => {
        try {
            const u = await requireUserAsync();
            if (!u?.uid) throw new Error('Необходимо войти в аккаунт');
            const trashRef = trashDocRef(u.uid, id);
            const trashSnap = await getDoc(trashRef);
            const beforeData = trashSnap.exists() ? trashSnap.data() : null;
            const result = await _restoreFromTrash(u.uid, id, options);

            await safeWriteAdminAudit(u.uid, {
                action: 'restore',
                actorUid: u.uid,
                actorEmail: u.email || user.value?.email || null,
                actorRole: userRole.value || null,
                entityType: result?.entityType || mapTrashItemToAuditEntityType(beforeData?.itemType || beforeData?.type),
                entityId: result?.entityId || inferTrashRestoreEntityId(beforeData, id, options),
                entityPath: result?.entityPath || inferTrashRestoreEntityPath(u.uid, beforeData, id, options),
                before: summarizeTrashAuditPayload({ id, ...(beforeData || {}) }),
                after: {
                    status: 'restored',
                    restoreMode: result?.restoreMode || (options?.mode === 'copy' ? 'copy' : 'replace'),
                    restoredEntityType: result?.entityType || mapTrashItemToAuditEntityType(beforeData?.itemType || beforeData?.type),
                    restoredEntityId: result?.entityId || inferTrashRestoreEntityId(beforeData, id, options),
                    restoredEntityPath: result?.entityPath || inferTrashRestoreEntityPath(u.uid, beforeData, id, options),
                    sourceTrashId: id,
                },
                source: 'trash-restore',
            });

            return result;
        } catch (e) {
            console.error('Restore Trash Error:', e);
            return { status: 'error', message: e?.message || String(e) };
        }
    };

    const deleteTrashForever = async (id) => {
        try {
            const u = await requireUserAsync();
            if (!u?.uid) throw new Error('Необходимо войти в аккаунт');
            const trashRef = trashDocRef(u.uid, id);
            const trashSnap = await getDoc(trashRef);
            const beforeData = trashSnap.exists() ? trashSnap.data() : null;
            await _deleteForever(u.uid, id);

            await safeWriteAdminAudit(u.uid, {
                action: 'delete',
                actorUid: u.uid,
                actorEmail: u.email || user.value?.email || null,
                actorRole: userRole.value || null,
                entityType: 'trash',
                entityId: id,
                entityPath: trashRef.path,
                before: summarizeTrashAuditPayload({ id, ...(beforeData || {}) }),
                after: {
                    status: 'deleted_forever',
                    deletedFrom: trashRef.path,
                },
                source: 'trash-delete-forever',
            });

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
        if (typeof unsubscribeHistoryListener === 'function') {
            try { unsubscribeHistoryListener(); } catch {}
        }
        unsubscribeHistoryListener = onSnapshot(q, (snapshot) => {
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
            const dataToSave = {
                ...projectData,
                date: projectData?.date || new Date().toISOString(),
                savedAt: serverTimestamp()
            };
            await addDoc(historyCol(user.value.uid), dataToSave);
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
            ...searchIn(masterPriceCatalog.value, 'master-price', 'Мастер-прайс'),
        ];
    };
    
    const materialGroups = computed(() => {
        const groups = {};
        const formatThickness = (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return '';
            return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace('.', ',');
        };
        [...(materials.value || [])].reverse().forEach(m => {
            if (m?.inStock === false || m?.active === false) return;
            const type = m.type || 'Прочее';
            if (!groups[type]) groups[type] = [];
            const thicknessLabel = formatThickness(m?.thickness);
            groups[type].push({
                ...m,
                label: thicknessLabel ? `${m?.name || 'Без названия'} • ${thicknessLabel} мм` : (m?.name || 'Без названия')
            });
        });
        return groups;
    });

    const isAdmin = computed(() => userRole.value === 'admin');
    const isSuperAdmin = computed(() => userRole.value === 'superadmin');

    const canWriteAdminAudit = (uid = null) => {
        return isSuperAdmin.value || String(uid || '') === DEFAULT_SUPERADMIN_UID;
    };

    const safeAuditValue = (value) => {
        if (value == null) return value;
        if (['string', 'number', 'boolean'].includes(typeof value)) return value;
        if (Array.isArray(value)) return value.slice(0, 10).map((entry) => safeAuditValue(entry));
        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value)
                    .slice(0, 20)
                    .map(([key, entryValue]) => [key, safeAuditValue(entryValue)])
            );
        }
        return String(value);
    };

    const summarizeProjectAuditPayload = (data, fallbackId = null) => ({
        id: data?.id || fallbackId || null,
        name: data?.name || data?.state?.project?.name || null,
        client: data?.client || data?.state?.project?.client || null,
        qty: Number(data?.qty || data?.state?.project?.qty || 0) || null,
        total: Number(data?.totalOrder || data?.total || 0) || null,
        savedAt: data?.savedAt || data?.date || null,
    });

    const mapTrashItemToAuditEntityType = (itemType) => {
        const normalized = String(itemType || '').trim().toLowerCase();
        if (normalized === 'settings') return 'settings';
        if (normalized === 'users') return 'users';
        return 'history';
    };

    const inferTrashRestoreEntityId = (data, fallbackId = null, options = {}) => {
        const entityType = mapTrashItemToAuditEntityType(data?.itemType || data?.type);
        if (entityType === 'settings') return 'global_config';
        if (options?.mode === 'copy') return fallbackId || null;
        return data?.sourceHistoryId || data?.id || fallbackId || null;
    };

    const inferTrashRestoreEntityPath = (uid, data, fallbackId = null, options = {}) => {
        const entityType = mapTrashItemToAuditEntityType(data?.itemType || data?.type);
        if (entityType === 'settings') return 'settings/global_config';
        if (entityType === 'users') return `users/${fallbackId || data?.id || ''}`;
        return `users/${uid}/history/${inferTrashRestoreEntityId(data, fallbackId, options) || ''}`;
    };

    const summarizeTrashAuditPayload = (data) => ({
        id: data?.id || null,
        itemType: data?.itemType || data?.type || null,
        dataType: data?.dataType || null,
        title: data?.title || data?.name || data?.payload?.name || data?.payload?.title || data?.state?.project?.name || null,
        sourceHistoryId: data?.sourceHistoryId || null,
        deletedAtISO: data?.deletedAtISO || null,
        expiresAtISO: data?.expiresAtISO || null,
        deletedBy: data?.deletedBy || data?.deletedByUid || null,
        deletedByEmail: data?.deletedByEmail || null,
        payload: safeAuditValue(data?.payload || null),
    });

    const safeWriteAdminAudit = async (uid, event) => {
        if (!canWriteAdminAudit(uid)) return;
        try {
            await writeAuditLog(event);
        } catch (e) {
            console.warn('[AuditLog] admin flow write failed', e);
        }
    };

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
        materials, coatings, processingDB, accessoriesDB, packagingDB, designDB, masterPriceCatalog, settings,
        materialGroups, userHistory, allUsers,
        syncStatus, isLoaded, user, 
        isAdmin, // Legacy
        isSuperAdmin,
        userRole, 
        hasPermission, // <--- НОВАЯ ФУНКЦИЯ ПРАВ
        isOfflineMode,
        pendingProjectSyncCount,
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