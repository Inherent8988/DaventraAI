// Инициализация Firebase. ВАЖЕН ПОРЯДОК: App → App Check → остальные сервисы (Auth, Firestore, AI Logic).
// App Check должен быть создан до первого запроса к Auth/Firestore/AI Logic, иначе запросы
// уйдут без токена и будут помечены в мониторинге как «Invalid / Unverified».

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken as getAppCheckToken,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-ai.js";

import {
  firebaseConfig,
  APP_CHECK_SITE_KEY,
  MODEL_ID,
  SDK_VERSION,
  SYSTEM_PROMPT,
} from "./config.js";

export { MODEL_ID, SDK_VERSION };

// Защита от случайной подмены модели.
if (MODEL_ID !== "gemini-3.8-flash") {
  throw new Error("DAVENTRA AI должен использовать только модель gemini-3.8-flash.");
}

// Для локальной разработки (localhost) включаем debug-токен App Check.
// Токен появится в консоли браузера — его нужно один раз добавить в
// Firebase Console → App Check → Apps → ваше веб-приложение → Manage debug tokens.
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (isLocal) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// 1) FirebaseApp
export const app = initializeApp(firebaseConfig);

// 2) App Check (reCAPTCHA Enterprise)
export let appCheck = null;
export let appCheckInitError = null;
try {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} catch (err) {
  appCheckInitError = err;
  console.error("[DAVENTRA] Не удалось инициализировать App Check:", err);
}

// 3) Остальные сервисы
export const auth = getAuth(app);
export const db = getFirestore(app);

// Firebase AI Logic + Gemini Developer API
const ai = getAI(app, { backend: new GoogleAIBackend() });
export const model = getGenerativeModel(ai, {
  model: MODEL_ID,
  systemInstruction: SYSTEM_PROMPT,
});

// ---------- Авторизация ----------

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // Мобильные браузеры иногда блокируют всплывающее окно — используем редирект.
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export function consumeRedirectResult() {
  return getRedirectResult(auth);
}

export function signOutUser() {
  return signOut(auth);
}

// ---------- Диагностика App Check ----------

export async function runAppCheckDiagnostics() {
  if (appCheckInitError) {
    return { ok: false, error: `Ошибка инициализации: ${appCheckInitError.code || ""} ${appCheckInitError.message}` };
  }
  try {
    const res = await getAppCheckToken(appCheck, false);
    if (res.error) {
      return { ok: false, error: `${res.error.code || ""} ${res.error.message || res.error}`.trim() };
    }
    return { ok: Boolean(res.token), error: res.token ? "" : "Пустой токен" };
  } catch (err) {
    return { ok: false, error: `${err.code || ""} ${err.message || err}`.trim() };
  }
}
