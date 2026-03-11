import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";

/**
 * Firebase config is loaded from Vite environment variables.
 * IMPORTANT:
 *  - Put real values into .env (NOT committed; see .gitignore)
 *  - Use .env.example as a template for teammates / deployment
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/**
 * Optional runtime host allowlist (defense-in-depth).
 * NOTE: This does NOT replace proper API key restrictions in Google Cloud Console.
 * It helps prevent accidental deployment of the same build to an unexpected domain.
 *
 * Configure via:
 *   VITE_ALLOWED_HOSTS=localhost,127.0.0.1,monocalc-pro.web.app
 */
function assertAllowedHost() {
  // SSR / tests safety
  if (typeof window === "undefined") return;

  const raw = import.meta.env.VITE_ALLOWED_HOSTS;
  const allowed = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // In local development, always allow localhost variants to avoid
  // accidental lock-out of auth/features because of stale .env values.
  if (import.meta.env.DEV) {
    allowed.push("localhost", "127.0.0.1", "::1");
  }

  if (!allowed.length) return; // not configured -> do nothing

  const host = window.location.hostname;
  const ok = new Set(allowed).has(host);

  if (!ok) {
    // Fail fast: if the build is accidentally served from the wrong host,
    // we block initialization to reduce misuse of the same client config.
    throw new Error(
      `[Security] This build is not allowed to run on host "${host}". ` +
        `Set VITE_ALLOWED_HOSTS to include this host, and configure API key restrictions in Google Cloud Console.`
    );
  }
}

// Fail fast in dev if env is missing (prevents silent production errors)
if (import.meta.env.DEV) {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      "[Firebase] Missing environment variables for:",
      missing.join(", "),
      "\nCreate .env from .env.example and fill VITE_FIREBASE_* values."
    );
  }
}

assertAllowedHost();

const app = initializeApp(firebaseConfig);

// Analytics only in production — not needed in dev/offline PWA
if (import.meta.env.PROD) {
  try {
    getAnalytics(app);
  } catch {
    // ignore: can throw in non-browser or restricted contexts
  }
}

let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager(),
    }),
  });
} catch (e) {
  dbInstance = getFirestore(app);
  console.warn("[Firebase] Firestore persistent cache unavailable, fallback to default:", e?.message || e);
}

export const db = dbInstance;
export const auth = getAuth(app);

// --- ВАЖНО: ВКЛЮЧАЕМ СОХРАНЕНИЕ СЕССИИ ---
// Это гарантирует, что при обновлении страницы (F5) авторизация не слетит
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    if (import.meta.env.DEV) console.log("Firebase persistence enabled");
  })
  .catch((error) => {
    console.error("Firebase persistence error:", error);
  });


// Step 3 security guard
export function requireAuth(auth){
  if(!auth.currentUser){ throw new Error('Unauthorized'); }
}
