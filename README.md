# zombie-news-bot
Telegram AI news bot running on Cloudflare Workers (Zombie Rap &amp; Chanson theme).
# 🧟‍♂️ zombie-news-bot (`@zombie_news_flava`)

Автономный AI-бот новостей на **Cloudflare Workers**, превращающий горячие мировые, крипто-, техно- и шоу-биз инфоповоды в сатирические треки и баттлы в стиле **Zombie Rap & Кибер-Шансон** с уникальной обложкой к каждому посту.

- **Канал:** [@zombie_news_flava](https://t.me/zombie_news_flava)
- **Бот-пульт:** [@zombie_rap_news_bot](https://t.me/zombie_rap_news_bot)

---

## ✨ Возможности

- **Микс источников без дублей:** RSS-ленты (`Oddity Central`, `Reddit r/nottheonion`, `ForkLog`, `CoinTelegraph`, `TMZ`, `Variety`, `Habr`) + фильтрованный `Hacker News`. История последних 250 новостей хранится компактно в одном ключе KV (`state:history`).
- **3 сценария с авточередованием:**
  - `🎤 Zombie Rap` — жёсткий киберпанк-речитатив от **Zombie-DJ**
  - `🎸 Кибер-Шансон` — кабацко-неоновая баллада от **Дяди Коли Мертвеца**
  - `⚔️ Баттл` — перепалка **Zombie-DJ vs Дядя Коля** в одном посте
- **Умный текст (Gemini):** переводит и адаптирует заголовок, даёт короткую выжимку сути, пишет рифмованный куплет и придумывает визуальный промпт под сюжет новости (строгий JSON + цепочка резервных моделей).
- **Тематические обложки (Cloudflare Workers AI):** генерация картинки через `@cf/black-forest-labs/flux-1-schnell` (резерв — `sdxl-lightning`) с прямой загрузкой в Telegram файлом (`FormData`).
- **Два режима работы:**
  - **Автопост по таймеру:** публикация в канал по cron (`0 9,21 * * *` UTC).
  - **Пульт и черновики в ЛС:** команды `/menu`, `/draft`, `/rap`, `/chanson`, `/battle`, `/status` в боте с кнопками **«✅ В канал»**, **«🔄 Переписать»**, **«🗑 Отмена»** и переключателем режима крона (`автопост ↔ черновик в ЛС`).
- **Тихая работа канала:** все ошибки и уведомления уходят только админу в `ADMIN_CHAT_ID`.

---

## ⚙️ Конфигурация `wrangler.toml`

```toml
name = "zombie-news-bot"
main = "worker.js"
compatibility_date = "2026-01-01"

[[kv_namespaces]]
binding = "NEWS_KV"
id = "ТВОЙ_KV_NAMESPACE_ID"

[ai]
binding = "AI"

[observability]
enabled = true

# Запуск 2 раза в день: 09:00 и 21:00 UTC (11:00 и 23:00 по Киеву / 12:00 и 00:00 МСК)
[triggers]
crons = ["0 9,21 * * *"]
```

---

## 🔐 Переменные и секреты (Cloudflare Workers → Settings → Variables and Secrets)

| Переменная | Обязательна | Описание |
| --- | :---: | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота от `@BotFather` |
| `TELEGRAM_CHAT_ID` | ✅ | `@zombie_news_flava` или числовой ID канала |
| `GEMINI_API_KEY` | ✅ | API-ключ Google Gemini (AI Studio) |
| `ADMIN_CHAT_ID` | ✅ | Числовой Telegram ID админа для пульта и логов |
| `GEMINI_MODEL` | ➖ | Опционально: принудительная модель Gemini |
| `TELEGRAM_WEBHOOK_SECRET` | ➖ | Опционально: свой секрет вебхука |
| `RUN_SECRET` | ➖ | Опционально: свой ключ для `/run?key=...` |

---

## 🚀 Быстрый запуск после деплоя

1. Добавь `@zombie_rap_news_bot` администратором в канал `@zombie_news_flava` (право на публикацию сообщений).
2. Открой один раз в браузере:
   ```text
   https://<твой-воркер>.workers.dev/setup
   ```
   Ответ вернёт `ok: true`, статус `hasWorkersAI`, а также защищённые ссылки `runUrl` и `draftUrl`.
3. Напиши боту `/menu` (или `/start`, если ещё не задан `ADMIN_CHAT_ID` — бот подскажет твой ID).

---

## 🎛 Команды и эндпоинты

### В Telegram (личка с ботом для админа)
- `/menu` — пульт управления с кнопками и переключателем режима крона
- `/draft` — черновик случайной новости в авто-стиле
- `/rap` — черновик в стиле **Zombie Rap**
- `/chanson` — черновик в стиле **Кибер-Шансон**
- `/battle` — черновик **Рэп vs Шансон**
- `/status` — количество новостей в истории, последняя рубрика/стиль и статус Workers AI

### HTTP-маршруты воркера
- `GET /setup` — регистрация Telegram webhook и меню команд
- `GET /run?key=<RUN_SECRET>` — немедленная публикация поста в канал
- `GET /run?key=<RUN_SECRET>&preview=1` — отправка черновика админу в ЛС (поддерживает `&style=rap|chanson|battle` и `&cat=weird|crypto|showbiz|tech`)
- `POST /telegram-webhook` — обработчик команд и inline-кнопок бота
