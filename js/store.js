// Работа с Cloud Firestore.
// Структура данных (всё лежит внутри документа пользователя — это основа правил безопасности):
//   users/{uid}/chats/{chatId}                 { title, createdAt, updatedAt }
//   users/{uid}/chats/{chatId}/messages/{id}   { role: "user"|"model", text, idx, createdAt }

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db } from "./firebase.js";

const chatsCol = (uid) => collection(db, "users", uid, "chats");
const chatDoc = (uid, chatId) => doc(db, "users", uid, "chats", chatId);
const messagesCol = (uid, chatId) => collection(db, "users", uid, "chats", chatId, "messages");

const toDate = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate() : new Date());

export function subscribeChats(uid, onData, onError) {
  const q = query(chatsCol(uid), orderBy("updatedAt", "desc"), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            id: d.id,
            title: data.title || "Новый чат",
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          };
        }),
      );
    },
    onError,
  );
}

// ID чата создаётся локально, а запись уходит в Firestore в фоне: promise `done`
// завершается только после подтверждения сервером, поэтому интерфейс его не ждёт.
export function createChat(uid, title) {
  const ref = doc(chatsCol(uid));
  const done = setDoc(ref, {
    title,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, done };
}

export function addMessage(uid, chatId, { role, text, idx }) {
  const ref = doc(messagesCol(uid, chatId));
  return setDoc(ref, { role, text, idx, createdAt: serverTimestamp() });
}

export function touchChat(uid, chatId) {
  return updateDoc(chatDoc(uid, chatId), { updatedAt: serverTimestamp() });
}

export async function loadMessages(uid, chatId) {
  const snap = await getDocs(query(messagesCol(uid, chatId), orderBy("idx"), limit(1000)));
  return snap.docs.map((d) => {
    const data = d.data();
    return { role: data.role, text: data.text, time: toDate(data.createdAt) };
  });
}

export async function deleteChat(uid, chatId) {
  const snap = await getDocs(messagesCol(uid, chatId));
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(chatDoc(uid, chatId));
}
