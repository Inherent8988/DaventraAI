// Конфигурация DAVENTRA AI.
// Ключ Firebase Web API — публичный идентификатор (не секрет); защита данных обеспечивается
// Firebase Authentication, правилами Firestore (firestore.rules) и Firebase App Check.

export const firebaseConfig = {
  apiKey: "AIzaSyCA8ONpSRkIsXotSYL_qJIxE-18VzqTcBQ",
  authDomain: "daventra-ai.firebaseapp.com",
  projectId: "daventra-ai",
  storageBucket: "daventra-ai.firebasestorage.app",
  messagingSenderId: "978786636501",
  appId: "1:978786636501:web:28a6899e612c9c07ec885c",
};

// Site key reCAPTCHA Enterprise для Firebase App Check.
export const APP_CHECK_SITE_KEY = "6LdBFx0uAAAAAJvCRFXwd8Nk_1YRde-dIy-hMWjq";

// Единственная модель приложения. Автоматического переключения на другие модели нет.
export const MODEL_ID = "gemini-3.8-flash";

export const SDK_VERSION = "12.18.0";

export const SYSTEM_PROMPT =
  "Ты — DAVENTRA AI, дружелюбный и точный ИИ-ассистент. " +
  "Отвечай на том языке, на котором написал пользователь. " +
  "Оформляй ответы в Markdown: заголовки, списки, таблицы и блоки кода с указанием языка. " +
  "Если не уверен в факте — прямо скажи об этом.";

export const LIMITS = {
  maxInputChars: 12000, // длина одного сообщения пользователя
  maxHistoryMessages: 200, // сколько последних сообщений отправляется модели как контекст
  maxTitleChars: 48,
};
