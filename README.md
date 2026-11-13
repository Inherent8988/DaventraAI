# DAVENTRA AI

Веб-чат с ИИ на **Gemini 3.8 Flash** (`gemini-3.8-flash`) через **Firebase AI Logic** (Gemini Developer API).
Статический сайт без сборки — работает на GitHub Pages: https://inherent8988.github.io/DaventraAI/

## Структура

```
index.html            разметка и экраны (вход, чат, диалоги)
css/styles.css        тема: чёрный / тёмно-серый / фиолетовый, адаптив
js/config.js          конфиг Firebase, site key App Check, ID модели, лимиты
js/firebase.js        инициализация: App → App Check → Auth / Firestore / AI Logic
js/store.js           чаты и сообщения в Cloud Firestore
js/markdown.js        безопасный Markdown-рендерер (код, таблицы, списки)
js/app.js             интерфейс, стриминг, ошибки, диагностика
firestore.rules       правила безопасности Firestore
firebase.json, .firebaserc   деплой правил через Firebase CLI
.nojekyll             отключает Jekyll на GitHub Pages
```

## Публикация

1. Загрузите **всё содержимое папки** в репозиторий `DaventraAI` (ветка, которую раздаёт GitHub Pages; `index.html` — в корне).
2. **Опубликуйте правила Firestore** (без этого чаты не сохранятся — по умолчанию доступ закрыт):
   - Firebase Console → Firestore Database → Rules → вставьте `firestore.rules` → Publish, **или**
   - `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`
3. Откройте сайт, войдите через Google и в меню профиля нажмите **«Диагностика»** → «Проверить Gemini».

## Модель

В `js/config.js`: `MODEL_ID = "gemini-3.8-flash"`. В `js/firebase.js` стоит защита: если ID изменён, приложение не запустится.
Автоматического переключения на другие модели при ошибках **нет** — ошибка показывается пользователю с кнопкой «Повторить».

## App Check — что проверить (проблема «Invalid requests 100%»)

Код инициализирует App Check **до** Auth, Firestore и AI Logic, с `ReCaptchaEnterpriseProvider` и автообновлением токена.
Если в мониторинге по-прежнему «Invalid», причина почти наверняка в настройках консоли, а не в коде:

1. **Google Cloud Console → reCAPTCHA Enterprise → ваш ключ → Domains**: должен быть `inherent8988.github.io`
   (только домен, без `https://` и пути). Тип ключа — «Website» (а не Android/iOS).
2. **Firebase Console → App Check → Apps**: веб-приложение `daventra-ai` зарегистрировано с провайдером
   **reCAPTCHA Enterprise** и site key `6LdBFx0uAAAAAJvCRFXwd8Nk_1YRde-dIy-hMWjq`.
3. В Google Cloud проекта `daventra-ai` включён **reCAPTCHA Enterprise API**.
4. Старые «Invalid» могли появиться от запросов, сделанных без токена (например, с `localhost` без debug-токена).
   Для локальной разработки откройте сайт на `localhost` — в консоли браузера появится debug-токен; добавьте его в
   App Check → Apps → Manage debug tokens.
5. Включайте **Enforce** для Firestore и AI Logic только когда в мониторинге появятся «Verified requests».
   (По документации Firebase, с 2 ноября 2026 App Check обязателен для AI Logic.)

В «Диагностика» показывается точная ошибка получения токена App Check.

## Безопасность

- Данные лежат в `users/{uid}/chats/{chatId}` и `.../messages/{id}`; правила разрешают доступ только владельцу (`request.auth.uid == uid`),
  проверяют структуру и размер документов, запрещают редактирование сообщений. Всё остальное закрыто.
- Firebase `apiKey` в клиентском коде — публичный идентификатор, не секрет. Секретных ключей в проекте нет.
- Markdown экранируется, HTML из ответов модели не исполняется, ссылки открываются с `rel="noopener noreferrer"`.

## Что реализовано

Вход/выход через Google, имя и аватар, сохранение сессии; многоходовой диалог (история передаётся в `startChat`),
потоковые ответы (`sendMessageStream`), остановка генерации (частичный ответ сохраняется), Markdown, блоки кода с кнопкой
копирования, повтор при ошибке с понятными сообщениями (App Check, квоты, сеть, 403/404…), история чатов в Firestore
с группировкой по датам, автоназвания, удаление, адаптивный интерфейс (меню-«шторка» на телефоне).
