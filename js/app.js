// DAVENTRA AI — основная логика интерфейса.

import {
  watchAuth,
  signInWithGoogle,
  consumeRedirectResult,
  signOutUser,
  model,
  MODEL_ID,
  SDK_VERSION,
  appCheckInitError,
  runAppCheckDiagnostics,
} from "./firebase.js";
import * as store from "./store.js";
import { renderMarkdown } from "./markdown.js";
import { LIMITS } from "./config.js";

window.__daventraReady = true;

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("screen-boot"),
  login: $("screen-login"),
  app: $("screen-app"),
  loginBtn: $("loginBtn"),
  loginError: $("loginError"),
  sidebar: $("sidebar"),
  backdrop: $("backdrop"),
  newChatBtn: $("newChatBtn"),
  chatList: $("chatList"),
  profileBtn: $("profileBtn"),
  profileAvatar: $("profileAvatar"),
  profileName: $("profileName"),
  profileEmail: $("profileEmail"),
  profileMenu: $("profileMenu"),
  diagBtn: $("diagBtn"),
  logoutBtn: $("logoutBtn"),
  menuBtn: $("menuBtn"),
  chatTitle: $("chatTitle"),
  scroll: $("scroll"),
  messages: $("messages"),
  composer: $("composer"),
  input: $("input"),
  sendBtn: $("sendBtn"),
  confirmDialog: $("confirmDialog"),
  confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"),
  confirmOk: $("confirmOk"),
  diagDialog: $("diagDialog"),
  diagBody: $("diagBody"),
  diagTestAi: $("diagTestAi"),
  diagClose: $("diagClose"),
  toasts: $("toasts"),
};

const state = {
  user: null,
  chats: [],
  chatsLoaded: false,
  chatId: null,
  messages: [], // { role: "user" | "model", text, time }
  unsubChats: null,
  busy: false,
  stopRequested: false,
  run: null,
  loadToken: 0,
};

const NEW_CHAT_TITLE = "Новый чат";
const MAX_SAVED_TEXT = 200000;

const SUGGESTIONS = [
  "Объясни простыми словами, как работает блокчейн",
  "Напиши функцию на Python для сортировки слиянием с комментариями",
  "Составь план тренировок на неделю для начинающего",
  "Придумай 5 идей для стартапа в сфере образования",
];

// ---------- Утилиты ----------

function toast(text, type = "info", ms = 4200) {
  const t = document.createElement("div");
  t.className = `toast ${type === "error" ? "error" : ""}`;
  t.textContent = text;
  el.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 320);
  }, ms);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flashDone(btn, doneText, original) {
  btn.classList.add("done");
  if (doneText) btn.textContent = doneText;
  setTimeout(() => {
    btn.classList.remove("done");
    if (original) btn.textContent = original;
  }, 1600);
}

function makeTitle(text) {
  const firstLine = text.split("\n").find((l) => l.trim()) || NEW_CHAT_TITLE;
  const clean = firstLine
    .replace(/[`*_#>~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return NEW_CHAT_TITLE;
  return clean.length > LIMITS.maxTitleChars ? clean.slice(0, LIMITS.maxTitleChars - 1).trimEnd() + "…" : clean;
}

function fmtTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function groupLabel(date) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  if (diffDays <= 7) return "Последние 7 дней";
  return "Ранее";
}

function isNearBottom() {
  const s = el.scroll;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}

function scrollToBottom(smooth = false) {
  el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

// ---------- Экраны и авторизация ----------

function showScreen(name) {
  el.boot.hidden = name !== "boot";
  el.login.hidden = name !== "login";
  el.app.hidden = name !== "app";
}

function setProfile(user) {
  const name = user.displayName || user.email || "Пользователь";
  el.profileName.textContent = name;
  el.profileEmail.textContent = user.email || "";
  el.profileAvatar.textContent = "";
  if (user.photoURL) {
    const img = document.createElement("img");
    img.src = user.photoURL;
    img.alt = name;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      el.profileAvatar.textContent = name.trim().charAt(0).toUpperCase();
    };
    el.profileAvatar.appendChild(img);
  } else {
    el.profileAvatar.textContent = name.trim().charAt(0).toUpperCase();
  }
}

function authErrorText(err) {
  switch (err?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/unauthorized-domain":
      return "Этот домен не добавлен в Authorized domains Firebase Authentication.";
    case "auth/network-request-failed":
      return "Нет соединения с сетью. Проверьте интернет и попробуйте снова.";
    case "auth/operation-not-allowed":
      return "Вход через Google не включён в Firebase Authentication.";
    case "auth/too-many-requests":
      return "Слишком много попыток. Подождите немного и повторите.";
    default:
      return `Не удалось войти: ${err?.code || err?.message || "неизвестная ошибка"}`;
  }
}

async function handleLogin() {
  el.loginError.hidden = true;
  el.loginBtn.disabled = true;
  try {
    await signInWithGoogle();
  } catch (err) {
    console.error("[DAVENTRA] Ошибка входа:", err);
    const msg = authErrorText(err);
    if (msg) {
      el.loginError.textContent = msg;
      el.loginError.hidden = false;
    }
  } finally {
    el.loginBtn.disabled = false;
  }
}

async function handleLogout() {
  closeProfileMenu();
  await stopAndWait();
  try {
    await signOutUser();
  } catch (err) {
    console.error(err);
    toast("Не удалось выйти из аккаунта", "error");
  }
}

function onUserSignedIn(user) {
  state.user = user;
  setProfile(user);
  showScreen("app");
  resetChatView();
  state.chatsLoaded = false;
  renderChatList();
  state.unsubChats?.();
  state.unsubChats = store.subscribeChats(
    user.uid,
    (chats) => {
      state.chats = chats;
      state.chatsLoaded = true;
      renderChatList();
      if (state.chatId) {
        const cur = chats.find((c) => c.id === state.chatId);
        if (cur) el.chatTitle.textContent = cur.title;
      }
    },
    (err) => {
      console.error("[DAVENTRA] Ошибка подписки на чаты:", err);
      state.chatsLoaded = true;
      renderChatList();
      toast(explainFirestoreError(err), "error", 7000);
    },
  );
}

function onUserSignedOut() {
  state.unsubChats?.();
  state.unsubChats = null;
  state.user = null;
  state.chats = [];
  state.chatsLoaded = false;
  resetChatView();
  closeSidebar();
  showScreen("login");
}

function explainFirestoreError(err) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return "Firestore отклонил запрос (permission-denied). Опубликуйте firestore.rules и проверьте App Check.";
  }
  if (code === "unavailable") return "Firestore недоступен. Проверьте соединение с сетью.";
  return `Ошибка Firestore: ${code || err?.message || err}`;
}

// ---------- Список чатов ----------

function renderChatList() {
  const list = el.chatList;
  list.textContent = "";

  if (!state.chatsLoaded) {
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div");
      s.className = "skeleton";
      list.appendChild(s);
    }
    return;
  }

  if (!state.chats.length) {
    const p = document.createElement("p");
    p.className = "chat-empty";
    p.textContent = "Пока нет чатов. Напишите первое сообщение!";
    list.appendChild(p);
    return;
  }

  const order = ["Сегодня", "Вчера", "Последние 7 дней", "Ранее"];
  const groups = new Map(order.map((k) => [k, []]));
  for (const c of state.chats) groups.get(groupLabel(c.updatedAt)).push(c);

  for (const label of order) {
    const items = groups.get(label);
    if (!items.length) continue;
    const g = document.createElement("div");
    g.className = "chat-group";
    const h = document.createElement("div");
    h.className = "chat-group-title";
    h.textContent = label;
    g.appendChild(h);

    for (const c of items) {
      const row = document.createElement("div");
      row.className = "chat-item" + (c.id === state.chatId ? " active" : "");

      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-open";
      open.textContent = c.title;
      open.title = c.title;
      open.addEventListener("click", () => openChat(c.id));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "chat-del";
      del.setAttribute("aria-label", `Удалить чат «${c.title}»`);
      del.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6m4-6v6"/></svg>';
      del.addEventListener("click", () => confirmDeleteChat(c));

      row.append(open, del);
      g.appendChild(row);
    }
    list.appendChild(g);
  }
}

// ---------- Работа с чатом ----------

function resetChatView() {
  state.loadToken++;
  state.chatId = null;
  state.messages = [];
  el.chatTitle.textContent = NEW_CHAT_TITLE;
  renderMessages();
}

async function startNewChat() {
  await stopAndWait();
  resetChatView();
  renderChatList();
  closeSidebar();
  el.input.focus();
}

async function openChat(chatId) {
  if (chatId === state.chatId && !state.busy) {
    closeSidebar();
    return;
  }
  await stopAndWait();
  closeSidebar();

  const token = ++state.loadToken;
  state.chatId = chatId;
  state.messages = [];
  const info = state.chats.find((c) => c.id === chatId);
  el.chatTitle.textContent = info?.title || NEW_CHAT_TITLE;
  renderChatList();

  el.messages.textContent = "";
  const loading = document.createElement("div");
  loading.className = "chat-loading";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("div");
    s.className = "skeleton";
    loading.appendChild(s);
  }
  el.messages.appendChild(loading);

  try {
    const msgs = await store.loadMessages(state.user.uid, chatId);
    if (token !== state.loadToken) return;
    state.messages = msgs;
    renderMessages();
    scrollToBottom();
  } catch (err) {
    if (token !== state.loadToken) return;
    console.error("[DAVENTRA] Ошибка загрузки сообщений:", err);
    el.messages.textContent = "";
    el.messages.appendChild(
      errorCard("Не удалось загрузить чат", explainFirestoreError(err), err, () => openChat(chatId), true),
    );
  }
}

function confirmDeleteChat(chat) {
  el.confirmTitle.textContent = "Удалить чат?";
  el.confirmText.textContent = `«${chat.title}» и все его сообщения будут удалены безвозвратно.`;
  el.confirmOk.textContent = "Удалить";
  el.confirmDialog.returnValue = "";
  el.confirmDialog.onclose = async () => {
    if (el.confirmDialog.returnValue !== "ok") return;
    try {
      if (chat.id === state.chatId) {
        await stopAndWait();
        resetChatView();
      }
      await store.deleteChat(state.user.uid, chat.id);
      toast("Чат удалён");
    } catch (err) {
      console.error("[DAVENTRA] Ошибка удаления:", err);
      toast(explainFirestoreError(err), "error", 6000);
    }
  };
  el.confirmDialog.showModal();
}

// ---------- Рендер сообщений ----------

function renderMessages() {
  el.messages.textContent = "";
  if (!state.messages.length) {
    el.messages.appendChild(welcomeView());
    return;
  }
  state.messages.forEach((m) => el.messages.appendChild(messageEl(m)));
}

function welcomeView() {
  const w = document.createElement("div");
  w.className = "welcome";
  w.innerHTML =
    '<div class="logo-mark"><span>D</span></div><h3>Привет! Я <b>DAVENTRA AI</b></h3>' +
    "<p>Задайте вопрос, попросите написать код, текст или помочь с идеей.</p>";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const s of SUGGESTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = s;
    b.addEventListener("click", () => send(s));
    chips.appendChild(b);
  }
  w.appendChild(chips);
  return w;
}

function messageEl(m) {
  if (m.role === "user") {
    const row = document.createElement("div");
    row.className = "msg msg-user";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.text;
    row.appendChild(bubble);
    return row;
  }
  const { row, md } = aiRow();
  md.innerHTML = renderMarkdown(m.text);
  row.querySelector(".msg-body").appendChild(actionsEl(m));
  return row;
}

function aiRow() {
  const row = document.createElement("div");
  row.className = "msg msg-ai";
  const av = document.createElement("div");
  av.className = "ai-avatar";
  av.textContent = "D";
  av.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "msg-body";
  const md = document.createElement("div");
  md.className = "md";
  body.appendChild(md);
  row.append(av, body);
  return { row, md };
}

function actionsEl(m) {
  const wrap = document.createElement("div");
  wrap.className = "msg-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "icon-btn msg-copy";
  copy.title = "Копировать ответ";
  copy.setAttribute("aria-label", "Копировать ответ");
  copy.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  copy.addEventListener("click", async () => {
    if (await copyText(m.text)) {
      flashDone(copy);
      toast("Ответ скопирован");
    } else {
      toast("Не удалось скопировать", "error");
    }
  });
  const time = document.createElement("span");
  time.textContent = m.time ? fmtTime(m.time) : "";
  wrap.append(copy, time);
  return wrap;
}

function errorCard(title, text, err, onRetry, retryAlways = false) {
  const card = document.createElement("div");
  card.className = "error-card";
  const h = document.createElement("h4");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  card.append(h, p);

  if (err) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "Технические детали";
    const pre = document.createElement("pre");
    pre.textContent = `${err.code ? err.code + ": " : ""}${err.message || err}`;
    d.append(s, pre);
    card.appendChild(d);
  }
  if (onRetry && (retryAlways || true)) {
    const actions = document.createElement("div");
    actions.className = "error-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn primary";
    retry.textContent = "Повторить";
    retry.addEventListener("click", () => {
      card.remove();
      onRetry();
    });
    actions.appendChild(retry);
    card.appendChild(actions);
  }
  return card;
}

// Делегирование: кнопки «Копировать» в блоках кода.
el.messages.addEventListener("click", async (e) => {
  const btn = e.target.closest(".code-copy");
  if (!btn) return;
  const code = btn.closest(".code-block")?.querySelector("pre code");
  if (!code) return;
  if (await copyText(code.textContent)) flashDone(btn, "Скопировано", "Копировать");
  else toast("Не удалось скопировать код", "error");
});

// ---------- Gemini ----------

// Временные сбои на стороне сервера: повторяем запрос к ТОЙ ЖЕ модели.
function isTransientError(err) {
  const s = `${err?.code || ""} ${err?.message || err || ""}`;
  return /\[(500|502|503|504)\b|\b(500|502|503|504)\s*\]|high demand|overloaded|currently unavailable|try again later|abort|timed? ?out/i.test(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function explainAiError(err) {
  const raw = `${err?.code || ""} ${err?.message || err || ""}`;
  const low = raw.toLowerCase();

  if (/app[\s-]?check|appcheck|attestation|recaptcha/.test(low)) {
    return "Запрос отклонён проверкой App Check. Убедитесь, что reCAPTCHA Enterprise key разрешает домен inherent8988.github.io, а приложение зарегистрировано в App Check. Подробности — в «Диагностика».";
  }
  if (/api[\s-]?not[\s-]?enabled|has not been used|service_disabled|api key not valid|api_key_invalid/.test(low)) {
    return "Firebase AI Logic / Gemini Developer API не включены для проекта или ключ недействителен. Проверьте консоль Firebase → AI Logic.";
  }
  if (/\b429\b|quota|resource[\s_]exhausted|rate[\s_-]?limit|too many requests/.test(low)) {
    return "Достигнут лимит запросов бесплатного тарифа Gemini. Подождите немного и повторите.";
  }
  if (isTransientError(err)) {
    return "Модель Gemini временно перегружена (ошибка на стороне Google). Это обычно проходит само — нажмите «Повторить» через несколько секунд.";
  }
  if (/\b403\b|permission[\s_]denied|forbidden/.test(low)) {
    return "Доступ к Gemini запрещён (403). Проверьте настройки Firebase AI Logic, ограничения API-ключа и App Check.";
  }
  if (/\b404\b|not[\s_]found|is not supported/.test(low)) {
    return `Модель ${MODEL_ID} не найдена или не поддерживается для этого проекта. Приложение намеренно не переключается на другую модель — проверьте доступность модели в консоли Firebase AI Logic.`;
  }
  if (/\b400\b|invalid[\s_]argument/.test(low)) {
    return "Запрос отклонён моделью (400). Попробуйте переформулировать сообщение или начать новый чат.";
  }
  if (/\b5\d\d\b|unavailable|overloaded|internal/.test(low)) {
    return "Сервис Gemini временно недоступен или перегружен. Повторите через несколько секунд.";
  }
  if (/safety|blocked|prohibited|block[\s_]reason/.test(low)) {
    return "Ответ заблокирован фильтрами безопасности модели. Попробуйте изменить запрос.";
  }
  if (!navigator.onLine || /failed to fetch|network|fetch-error|load failed|offline/.test(low)) {
    return "Нет соединения с сетью или сервер недоступен. Проверьте интернет и повторите.";
  }
  return "Не удалось получить ответ от Gemini. Повторите попытку.";
}

function buildRequest(previous, prompt) {
  // Приводим историю к чередованию user/model, начиная с user — этого требует API.
  const turns = [];
  for (const m of previous.slice(-LIMITS.maxHistoryMessages)) {
    if (!m.text || !m.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.parts[0].text += "\n\n" + m.text;
    else turns.push({ role: m.role, parts: [{ text: m.text }] });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  // Если последний ход — пользовательское сообщение без ответа (прошлая ошибка), объединяем с новым.
  let text = prompt;
  if (turns.length && turns[turns.length - 1].role === "user") {
    text = turns.pop().parts[0].text + "\n\n" + prompt;
  }
  return { history: turns, text };
}

function setBusy(busy) {
  state.busy = busy;
  el.sendBtn.classList.toggle("is-stop", busy);
  el.sendBtn.setAttribute("aria-label", busy ? "Остановить генерацию" : "Отправить");
  el.sendBtn.disabled = busy ? false : !el.input.value.trim();
}

function autosize() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
}

function stopAndWait() {
  if (!state.busy) return Promise.resolve();
  state.stopRequested = true;
  return state.run ? state.run.catch(() => {}) : Promise.resolve();
}

async function send(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text || state.busy || !state.user) return;
  if (text.length > LIMITS.maxInputChars) {
    toast(`Сообщение слишком длинное (максимум ${LIMITS.maxInputChars} символов)`, "error");
    return;
  }

  const uid = state.user.uid;
  state.stopRequested = false;
  setBusy(true);

  // Первое сообщение создаёт чат и его название.
  if (!state.chatId) {
    const title = makeTitle(text);
    const { id, done } = store.createChat(uid, title);
    done.catch((err) => {
      console.error("[DAVENTRA] Не удалось создать чат:", err);
      toast(explainFirestoreError(err), "error", 7000);
    });
    state.chatId = id;
    state.messages = [];
    el.chatTitle.textContent = title;
    state.chats = [{ id, title, createdAt: new Date(), updatedAt: new Date() }, ...state.chats];
    renderChatList();
  }

  const chatId = state.chatId;
  const userMsg = { role: "user", text, time: new Date() };
  const idx = state.messages.length;
  state.messages.push(userMsg);
  if (state.messages.length === 1) el.messages.textContent = "";
  el.messages.appendChild(messageEl(userMsg));
  scrollToBottom(true);

  el.input.value = "";
  autosize();

  store.addMessage(uid, chatId, { role: "user", text, idx }).catch((err) => {
    console.error("[DAVENTRA] Не удалось сохранить сообщение:", err);
    toast(explainFirestoreError(err), "error", 7000);
  });

  state.run = generate(uid, chatId);
  try {
    await state.run;
  } finally {
    state.run = null;
    setBusy(false);
    if (!el.input.matches(":disabled") && window.matchMedia("(pointer: fine)").matches) el.input.focus();
  }
}

async function retryLast() {
  if (state.busy || !state.user || !state.chatId) return;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "user") return;
  state.stopRequested = false;
  setBusy(true);
  state.run = generate(state.user.uid, state.chatId);
  try {
    await state.run;
  } finally {
    state.run = null;
    setBusy(false);
  }
}

async function generate(uid, chatId) {
  const msgs = state.messages;
  const prompt = msgs[msgs.length - 1].text;
  const { history, text } = buildRequest(msgs.slice(0, -1), prompt);

  const { row, md } = aiRow();
  row.classList.add("streaming");
  md.innerHTML = '<span class="typing" aria-label="Gemini печатает"><i></i><i></i><i></i></span>';
  el.messages.appendChild(row);
  scrollToBottom(true);

  let full = "";
  let failure = null;
  let raf = 0;
  const paint = () => {
    raf = 0;
    const follow = isNearBottom();
    md.innerHTML = renderMarkdown(full);
    if (follow) scrollToBottom();
  };

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    failure = null;
    try {
      // Многоходовой диалог: история передаётся в startChat, новое сообщение — в sendMessageStream.
      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(text);
      for await (const chunk of result.stream) {
        if (state.stopRequested) break;
        const part = chunk.text();
        if (part) {
          full += part;
          if (!raf) raf = requestAnimationFrame(paint);
        }
      }
      break;
    } catch (err) {
      failure = err;
      console.error(`[DAVENTRA] Ошибка Gemini (попытка ${attempt}/${MAX_ATTEMPTS}):`, err);
      // Повторяем только временные сбои сервера и только пока не пришёл ни один фрагмент ответа.
      if (full || state.stopRequested || !isTransientError(err) || attempt === MAX_ATTEMPTS) break;
      await sleep(1500 * attempt);
      if (state.stopRequested) break;
    }
  }

  if (raf) cancelAnimationFrame(raf);
  row.classList.remove("streaming");

  const stillHere = state.chatId === chatId && state.user?.uid === uid;

  if (full.trim()) {
    const aiMsg = { role: "model", text: full, time: new Date() };
    if (stillHere) {
      const idx = state.messages.length;
      state.messages.push(aiMsg);
      md.innerHTML = renderMarkdown(full);
      row.querySelector(".msg-body").appendChild(actionsEl(aiMsg));
      store
        .addMessage(uid, chatId, { role: "model", text: full.slice(0, MAX_SAVED_TEXT), idx })
        .then(() => store.touchChat(uid, chatId))
        .catch((err) => {
          console.error("[DAVENTRA] Не удалось сохранить ответ:", err);
          toast(explainFirestoreError(err), "error", 7000);
        });
    }
  } else {
    row.remove();
  }

  if (failure && stillHere) {
    const canRetry = !full.trim();
    const card = errorCard(
      "Не удалось получить ответ",
      explainAiError(failure),
      failure,
      canRetry ? retryLast : null,
    );
    el.messages.appendChild(card);
    scrollToBottom(true);
  } else if (!failure && state.stopRequested && stillHere) {
    toast("Генерация остановлена");
  }

  if (!full.trim() && !failure && stillHere && state.messages.length === 1 && !state.stopRequested) {
    toast("Модель вернула пустой ответ", "error");
  }
}

// ---------- Профиль, меню, боковая панель ----------

function openSidebar() {
  el.sidebar.classList.add("open");
  el.backdrop.hidden = false;
}
function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.backdrop.hidden = true;
}
function closeProfileMenu() {
  el.profileMenu.hidden = true;
  el.profileBtn.setAttribute("aria-expanded", "false");
}
function toggleProfileMenu() {
  const open = el.profileMenu.hidden;
  el.profileMenu.hidden = !open;
  el.profileBtn.setAttribute("aria-expanded", String(open));
}

// ---------- Диагностика ----------

function diagRow(label, value, status) {
  const row = document.createElement("div");
  row.className = "diag-row";
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("span");
  b.textContent = value;
  if (status === "ok") b.className = "diag-ok";
  if (status === "bad") b.className = "diag-bad";
  row.append(a, b);
  return row;
}

async function openDiagnostics() {
  closeProfileMenu();
  closeSidebar();
  const body = el.diagBody;
  body.textContent = "";
  body.append(
    diagRow("Модель", MODEL_ID, "ok"),
    diagRow("Firebase SDK", SDK_VERSION),
    diagRow("Домен", location.hostname),
    diagRow("Пользователь", state.user?.uid || "—"),
  );
  const appCheckRow = diagRow("App Check", "проверка…");
  body.appendChild(appCheckRow);
  el.diagDialog.showModal();

  const res = await runAppCheckDiagnostics();
  appCheckRow.children[1].textContent = res.ok ? "токен получен" : `ошибка: ${res.error}`;
  appCheckRow.children[1].className = res.ok ? "diag-ok" : "diag-bad";
  if (!res.ok || appCheckInitError) {
    const hint = document.createElement("p");
    hint.className = "diag-hint";
    hint.textContent =
      "Проверьте: 1) ключ reCAPTCHA Enterprise содержит домен inherent8988.github.io (для localhost — debug-токен); " +
      "2) в Firebase Console → App Check приложение зарегистрировано с провайдером reCAPTCHA Enterprise и этим ключом; " +
      "3) в Google Cloud включён reCAPTCHA Enterprise API.";
    body.appendChild(hint);
  }
}

async function testGemini() {
  const btn = el.diagTestAi;
  btn.disabled = true;
  const row = diagRow("Gemini", "запрос…");
  row.children[1].innerHTML = '<span class="spinner"></span> запрос…';
  el.diagBody.appendChild(row);
  try {
    const started = performance.now();
    const res = await model.generateContent("Ответь одним словом: ок");
    const answer = res.response.text().trim().slice(0, 80);
    const ms = Math.round(performance.now() - started);
    row.children[1].textContent = `${MODEL_ID} ответила за ${ms} мс: «${answer}»`;
    row.children[1].className = "diag-ok";
  } catch (err) {
    row.children[1].textContent = `${err?.code || ""} ${err?.message || err}`.trim();
    row.children[1].className = "diag-bad";
    const hint = document.createElement("p");
    hint.className = "diag-hint";
    hint.textContent = explainAiError(err);
    el.diagBody.appendChild(hint);
  } finally {
    btn.disabled = false;
  }
}

// ---------- События ----------

el.loginBtn.addEventListener("click", handleLogin);
el.logoutBtn.addEventListener("click", handleLogout);
el.newChatBtn.addEventListener("click", startNewChat);
el.menuBtn.addEventListener("click", openSidebar);
el.backdrop.addEventListener("click", closeSidebar);
el.profileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleProfileMenu();
});
el.diagBtn.addEventListener("click", openDiagnostics);
el.diagClose.addEventListener("click", () => el.diagDialog.close());
el.diagTestAi.addEventListener("click", testGemini);

document.addEventListener("click", (e) => {
  if (!el.profileMenu.hidden && !el.profileMenu.contains(e.target)) closeProfileMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeProfileMenu();
    closeSidebar();
  }
});

el.input.addEventListener("input", () => {
  autosize();
  if (!state.busy) el.sendBtn.disabled = !el.input.value.trim();
});
el.input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  // На сенсорных устройствах Enter переносит строку, отправка — кнопкой.
  if (window.matchMedia("(pointer: coarse)").matches) return;
  e.preventDefault();
  if (!state.busy) send(el.input.value);
});

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy) {
    state.stopRequested = true;
    return;
  }
  send(el.input.value);
});

// ---------- Старт ----------

(async function init() {
  showScreen("boot");
  try {
    await consumeRedirectResult();
  } catch (err) {
    console.error("[DAVENTRA] Ошибка результата редиректа:", err);
    const msg = authErrorText(err);
    if (msg) {
      el.loginError.textContent = msg;
      el.loginError.hidden = false;
    }
  }
  watchAuth((user) => {
    if (user) onUserSignedIn(user);
    else onUserSignedOut();
  });
})();
