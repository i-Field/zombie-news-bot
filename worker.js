/**
 * ZOMBIE NEWS RADIO & AI CREW — Cloudflare Worker (V7.1)
 * Single-file Worker for GitHub -> Cloudflare Workers
 * Bindings: NEWS_KV (KV), AI (Workers AI)
 * Env Vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, ADMIN_CHAT_ID
 */

const BOT_USERNAME = 'zombie_rap_news_bot';
const DEFAULT_MINIAPP_URL = 'https://zombie-news-bot.qx420.workers.dev/';

const GEMINI_TEXT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
];
const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

// 1087968824 = Anonymous Group Admin (@GroupAnonymousBot), 136817688 = @Channel_Bot
const ALLOWED_BOT_SENDER_IDS = new Set([1087968824, 136817688]);

const RAM_CHATS = new Map();
const RAM_TRACE = [];
const KV_SYNC_INTERVAL_MS = 180000;
const MAX_RAM_CHATS = 120;
const MAX_TRACE_ITEMS = 25;

const STAR_TIERS = [
  { id: 'cookie', stars: 50, title: 'Печенька для Дяди Коли', label: '🍪 Угостить печенькой — 50 ⭐', desc: 'Хрустящая поддержка радиорубки и кибер-зомби ведущих.' },
  { id: 'energy', stars: 150, title: 'Кислотный энергетик DJ', label: '⚡ Зарядить пульт — 150 ⭐', desc: 'Разгон генератора битов и внеочередной токсичный инсайд.' },
  { id: 'booster', stars: 500, title: 'Бустер эфира на сутки', label: '📡 Прокачать вышку — 500 ⭐', desc: 'Мощный буст эфира, респект в чате и поддержка всей тусовки.' },
  { id: 'banquet', stars: 10000, title: 'Банкет для диджеев', label: '🤩 Накрыть диджеям банкет — 10 000 ⭐', desc: 'Королевский пир для Zombie-DJ и Дяди Коли Мертвеца. Легенда канала!' },
];

function getEcosystem(env) {
  const miniAppUrl = (env && env.MINIAPP_URL) || DEFAULT_MINIAPP_URL;
  return [
    { id: 'ff5x5', name: 'Forest Fortune 5x5', tag: 'СЛОТ 5x5', short: 'Лесной мега-слот 5x5 с бонусами и крупными линиями', url: 'https://t.me/ForestFortuneVegasBot', keywords: ['вегас', '5x5', '5х5', 'лес', 'мега', 'барабан', 'джекпот'] },
    { id: 'durak', name: 'Дурак Империя', tag: 'КАРТЫ', short: 'Подкидной и переводной дурак против реальных соперников', url: 'https://t.me/durak_empire_bot', keywords: ['дурак', 'карт', 'козыр', 'подкид', 'руби', 'колод', 'туз', 'раскин'] },
    { id: 'rodger', name: 'Lucky Rodger Slot', tag: 'ПИРАТСКИЙ СЛОТ', short: 'Пиратские слоты, сундуки удачи и риск-игра', url: 'https://t.me/LUCKY_RODGER_BOT', keywords: ['роджер', 'пират', 'слот', 'крут', 'спин', 'удач', 'сундук', 'казино'] },
    { id: 'khutor', name: 'Khutor Empire', tag: 'СТРАТЕГИЯ', short: 'Империя хутора: экономика, ресурсы и битвы за влияние', url: 'https://t.me/KhutorEmpireBot', keywords: ['хутор', 'импер', 'строй', 'ферм', 'ресурс', 'экономик', 'стратег'] },
    { id: 'ffclassic', name: 'Forest Fortune Classic', tag: 'СЛОТ КЛАССИКА', short: 'Классический лесной автомат для быстрого фана', url: 'https://t.me/Forest_Fortune_Bot', keywords: ['классик', 'фортун', 'автомат', 'крути'] },
    { id: 'studio', name: 'iField Studio', tag: 'AI СТУДИЯ', short: 'Продакшн, визуалы, саунд-дизайн и веб-инструменты', url: 'https://t.me/ifield_studio_bot', keywords: ['студ', 'музык', 'бит', 'трек', 'дизайн', 'код', 'сайт', 'приложен'] },
    { id: 'chat', name: 'iField Chat', tag: 'AI ЧАТ', short: 'Прямой ИИ-собеседник и помощник экосистемы', url: 'https://t.me/chat_ifield_bot', keywords: ['ии', 'нейросет', 'совет', 'помоги', 'вопрос', 'иде'] },
    { id: 'radio', name: 'Zombie News Mini App', tag: 'РАДИО', short: 'Прямой эфир, DJ-пульт, игры и звёздный банкет', url: miniAppUrl, keywords: ['радио', 'эфир', 'новост', 'диджей', 'пульт'], isWebApp: true },
  ];
}

function addTrace(type, detail) {
  RAM_TRACE.unshift({ ts: new Date().toISOString(), type, detail });
  if (RAM_TRACE.length > MAX_TRACE_ITEMS) RAM_TRACE.length = MAX_TRACE_ITEMS;
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...getCorsHeaders(),
    },
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hasCyrillicTrigger(text, innerPattern) {
  const re = new RegExp(`(^|[^а-яёa-z0-9_])(${innerPattern})([^а-яёa-z0-9_]|$)`, 'i');
  return re.test(String(text || '').toLowerCase());
}

async function kvGetJson(env, key, fallback = null) {
  if (!env || !env.NEWS_KV) return fallback;
  try {
    const val = await env.NEWS_KV.get(key, { type: 'json' });
    return val ?? fallback;
  } catch {
    return fallback;
  }
}

async function kvPutJson(env, key, value, ttlSeconds = null) {
  if (!env || !env.NEWS_KV) return false;
  try {
    const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
    await env.NEWS_KV.put(key, JSON.stringify(value), opts);
    return true;
  } catch (e) {
    addTrace('kv_put_error', `${key}: ${e.message}`);
    return false;
  }
}

async function getChatMem(env, chatId) {
  const key = String(chatId);
  if (RAM_CHATS.has(key)) return RAM_CHATS.get(key);

  const fromKv = await kvGetJson(env, `chat_mem:${key}`, null);
  const mem = fromKv && Array.isArray(fromKv.history)
    ? {
        history: fromKv.history.slice(-14),
        lastKvSync: fromKv.lastKvSync || 0,
        lastBotReplyTs: fromKv.lastBotReplyTs || 0,
        turnsSinceReply: fromKv.turnsSinceReply || 0,
      }
    : { history: [], lastKvSync: 0, lastBotReplyTs: 0, turnsSinceReply: 0 };

  if (RAM_CHATS.size >= MAX_RAM_CHATS) {
    const oldestKey = RAM_CHATS.keys().next().value;
    if (oldestKey !== undefined) RAM_CHATS.delete(oldestKey);
  }
  RAM_CHATS.set(key, mem);
  return mem;
}

function pushChatHistory(mem, role, name, text) {
  const clean = String(text || '').trim().slice(0, 400);
  if (!clean) return;
  mem.history.push({ role, name: String(name || 'User').slice(0, 32), text: clean, ts: Date.now() });
  if (mem.history.length > 14) mem.history = mem.history.slice(-14);
}

async function flushChatMem(env, chatId, mem) {
  const now = Date.now();
  if (now - (mem.lastKvSync || 0) < KV_SYNC_INTERVAL_MS) return false;
  mem.lastKvSync = now;
  return kvPutJson(env, `chat_mem:${chatId}`, mem, 604800);
}

async function tgCall(env, method, payload = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) addTrace('tg_err', `${method}: ${data.description || res.status}`);
  return data;
}

async function sendTgMessage(env, chatId, text, extra = {}) {
  return tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, 4000),
    disable_web_page_preview: true,
    ...extra,
  });
}

async function sendTyping(env, chatId) {
  return tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => null);
}

async function callGeminiSingleModel(apiKey, model, systemInstruction, contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);
  const makeBody = (withThinking) => {
    const body = { contents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (withThinking && model === 'gemini-3-flash-preview') {
      body.generationConfig = { thinkingConfig: { thinkingLevel: 'LOW' } };
    }
    return JSON.stringify(body);
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeBody(true), signal: controller.signal });
    if (res.status === 400 && model === 'gemini-3-flash-preview') {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeBody(false), signal: controller.signal });
    }
    const rawText = await res.text();
    if (!res.ok) return { ok: false, error: `${model} (${res.status}): ${rawText.slice(0, 180)}` };
    const data = JSON.parse(rawText);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return { ok: false, error: `${model}: empty candidate text` };
    return { ok: true, model, text };
  } catch (e) {
    return { ok: false, error: `${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiChat(env, { systemInstruction, contents }) {
  if (!env.GEMINI_API_KEY) return { ok: false, errors: ['GEMINI_API_KEY missing'] };
  const errors = [];
  for (const model of GEMINI_TEXT_MODELS) {
    const res = await callGeminiSingleModel(env.GEMINI_API_KEY, model, systemInstruction, contents);
    if (res.ok) return { ok: true, provider: 'gemini', model: res.model, text: res.text };
    errors.push(res.error);
  }
  return { ok: false, errors };
}

async function callWorkersAiChat(env, { systemInstruction, messages }) {
  if (!env.AI || typeof env.AI.run !== 'function') return { ok: false, error: 'env.AI binding missing' };
  try {
    const aiMessages = systemInstruction ? [{ role: 'system', content: systemInstruction }, ...messages] : messages;
    const out = await env.AI.run(WORKERS_AI_MODEL, { messages: aiMessages, max_tokens: 340 });
    const text = String(out?.response || out?.text || '').trim();
    if (!text) return { ok: false, error: 'Workers AI returned empty text' };
    return { ok: true, provider: 'workers-ai', model: WORKERS_AI_MODEL, text };
  } catch (e) {
    return { ok: false, error: `Workers AI: ${e.message}` };
  }
}

async function callChatAIWithBackup(env, { systemInstruction, history, userPrompt }) {
  const geminiContents = history.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.role === 'assistant' ? h.text : `${h.name}: ${h.text}` }],
  }));
  if (userPrompt) geminiContents.push({ role: 'user', parts: [{ text: userPrompt }] });

  const gem = await callGeminiChat(env, { systemInstruction, contents: geminiContents });
  if (gem.ok) return gem;

  addTrace('gemini_fallback', gem.errors.join(' | ').slice(0, 220));

  const waMessages = history.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.role === 'assistant' ? h.text : `${h.name}: ${h.text}`,
  }));
  if (userPrompt) waMessages.push({ role: 'user', content: userPrompt });

  const wa = await callWorkersAiChat(env, { systemInstruction, messages: waMessages });
  if (wa.ok) return wa;
  return { ok: false, errors: [...(gem.errors || []), wa.error] };
}

function buildCtaMarkup(env, textHint = '', includeMiniApp = true) {
  const eco = getEcosystem(env);
  const lower = String(textHint || '').toLowerCase();
  const matched = eco.filter((i) => !i.isWebApp && i.keywords.some((kw) => lower.includes(kw)));
  const picks = matched.length ? matched.slice(0, 2) : [eco[1], eco[0]];
  const rows = [picks.map((p) => ({ text: `🎮 ${p.name}`, url: p.url }))];
  if (includeMiniApp) {
    rows.push([
      { text: '📻 Открыть Zombie Radio', web_app: { url: eco.find((e) => e.isWebApp).url } },
      { text: '🤩 Банкет / Звёзды', callback_data: 'open_banquet' },
    ]);
  }
  return { inline_keyboard: rows };
}

function buildAllGamesMarkup(env) {
  const eco = getEcosystem(env);
  const bots = eco.filter((e) => !e.isWebApp);
  const rows = [];
  for (let i = 0; i < bots.length; i += 2) {
    const row = [{ text: bots[i].name, url: bots[i].url }];
    if (bots[i + 1]) row.push({ text: bots[i + 1].name, url: bots[i + 1].url });
    rows.push(row);
  }
  rows.push([
    { text: '📻 Радио и Пульт', web_app: { url: (env && env.MINIAPP_URL) || DEFAULT_MINIAPP_URL } },
    { text: '🤩 Банкет диджеям', callback_data: 'open_banquet' },
  ]);
  return { inline_keyboard: rows };
}

function buildBanquetMarkup() {
  return { inline_keyboard: STAR_TIERS.map((t) => [{ text: t.label, callback_data: `buy_${t.id}` }]) };
}

function getPersonaPrompt(isGroup, chatTitle = '') {
  return [
    'Ты — дуэт ведущих ночного пиратского Zombie Rap Radio: бодрый техно-ведущий Zombie-DJ и саркастичный уличный философ Дядя Коля Мертвец.',
    isGroup ? `Вы сидите в Telegram-группе "${chatTitle || 'тусовка'}" вместе с живыми участниками.` : 'Вы общаетесь 1-на-1 со слушателем в личке.',
    'Правила: отвечай живо по-русски, остроумно, без воды (2–5 коротких фраз). Реагируй именно на реплику собеседника и историю чата.',
    'Если к месту (скучно, карты, слоты, стратегия, музыка, ИИ), предложи заглянуть в один из ботов тусовки (Дурак Империя, Forest Fortune 5x5, Lucky Rodger Slot, Khutor Empire, iField Studio, iField Chat), но без спама.',
  ].join('\n');
}

async function generateAndStoreNews(env, { postToChannel = false, forceTopic = '' } = {}) {
  const eco = getEcosystem(env).filter((e) => !e.isWebApp).map((e) => `${e.name} (${e.tag})`).join(', ');
  const sys = [
    'Ты главный редактор сатирического рэп-радио Zombie News.',
    'Напиши один короткий, острый, смешной выпуск ночных новостей от Zombie-DJ и Дяди Коли Мертвеца: 1 заголовок с эмодзи + 3–4 фразы ироничной сводки и короткий призыв проверить удачу.',
    `Можешь упомянуть проект из тусовки: ${eco}.`,
  ].join('\n');
  const prompt = forceTopic ? `Срочный выпуск про: ${forceTopic}` : `Свежий выпуск эфира на ${new Date().toUTCString()}`;
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: sys, history: [], userPrompt: prompt });
  if (!aiRes.ok) return { ok: false, error: aiRes.errors.join(' | ') };

  const item = { id: `news_${Date.now()}`, text: aiRes.text, provider: aiRes.provider, model: aiRes.model, createdAt: new Date().toISOString() };
  const prev = await kvGetJson(env, 'news_history', []);
  await kvPutJson(env, 'latest_news', item);
  await kvPutJson(env, 'news_history', [item, ...(Array.isArray(prev) ? prev : [])].slice(0, 12));

  if (postToChannel && env.TELEGRAM_CHAT_ID) {
    await sendTgMessage(env, env.TELEGRAM_CHAT_ID, `🎙 <b>ZOMBIE NEWS ЭФИР</b>\n\n${escapeHtml(item.text)}`, {
      parse_mode: 'HTML',
      reply_markup: buildCtaMarkup(env, item.text, true),
    });
  }
  return { ok: true, item };
}

function extractDisplayName(msg) {
  if (msg.sender_chat && msg.sender_chat.title) return msg.sender_chat.title;
  const f = msg.from || {};
  if (f.id === 1087968824) return 'Анонимный Админ';
  return [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || 'Слушатель';
}

function shouldBotReplyInGroup(msg, mem) {
  const text = (msg.text || msg.caption || '').trim();
  if (!text) return { reply: false, direct: false };
  const lower = text.toLowerCase();
  const isReplyToBot = msg.reply_to_message?.from?.username?.toLowerCase() === BOT_USERNAME.toLowerCase();
  const hasMention = lower.includes(`@${BOT_USERNAME.toLowerCase()}`);
  const hasNameTrigger = hasCyrillicTrigger(lower, 'зомби|дядя коля|колян|диджей|dj|бот|радио|новости|сыграем|картишки|карты|дурака|слоты|удача|вегас|хутор|банкет|печеньк');
  if (isReplyToBot || hasMention || hasNameTrigger) return { reply: true, direct: true };

  const sinceReplyMs = Date.now() - (mem.lastBotReplyTs || 0);
  if ((mem.turnsSinceReply >= 3 && sinceReplyMs > 25000) || (text.includes('?') && text.length >= 8 && sinceReplyMs > 45000)) {
    return { reply: true, direct: false };
  }
  return { reply: false, direct: false };
}

async function handleCommands(env, msg, text) {
  const chatId = msg.chat.id;
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(`@${BOT_USERNAME}`, '');

  if (cmd === '/start') {
    await sendTgMessage(env, chatId, '📻 <b>Здарова, на связи Zombie Rap Radio!</b>\nЗа пультом <b>Zombie-DJ</b> и <b>Дядя Коля Мертвец</b>. Пиши в чат или жми кнопки — пообщаемся и подкинем игру:', {
      parse_mode: 'HTML',
      reply_markup: buildAllGamesMarkup(env),
    });
    return true;
  }

  if (cmd === '/games' || cmd === '/bots') {
    const lines = getEcosystem(env).filter((e) => !e.isWebApp).map((e) => `• <b>${escapeHtml(e.name)}</b> [${e.tag}] — ${escapeHtml(e.short)}`);
    await sendTgMessage(env, chatId, `🎮 <b>Вся тусовка проектов iField & Zombie:</b>\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
      reply_markup: buildAllGamesMarkup(env),
    });
    return true;
  }

  if (cmd === '/banquet' || cmd === '/donate' || cmd === '/stars') {
    await sendTgMessage(env, chatId, '🤩 <b>Звёздный банкет и донаты в студию!</b>\nВыбери угощение для ведущих:', {
      parse_mode: 'HTML',
      reply_markup: buildBanquetMarkup(),
    });
    return true;
  }

  if (cmd === '/news') {
    await sendTyping(env, chatId);
    const cached = await kvGetJson(env, 'latest_news', null);
    if (cached && cached.text) {
      await sendTgMessage(env, chatId, `🎙 <b>Свежий выпуск:</b>\n\n${escapeHtml(cached.text)}`, { parse_mode: 'HTML', reply_markup: buildCtaMarkup(env, cached.text, true) });
    } else {
      const gen = await generateAndStoreNews(env, { postToChannel: false });
      await sendTgMessage(env, chatId, gen.ok ? `🎙 <b>Срочный выпуск:</b>\n\n${escapeHtml(gen.item.text)}` : `⚠️ Радиовышка перегружена: ${gen.error}`, {
        parse_mode: 'HTML',
        ...(gen.ok ? { reply_markup: buildCtaMarkup(env, gen.item.text, true) } : {}),
      });
    }
    return true;
  }

  if (cmd === '/ping') {
    const mem = RAM_CHATS.get(String(chatId));
    if (!/\bai\b/i.test(text)) {
      await sendTgMessage(env, chatId, `🟢 Worker жив (V7.1). RAM-чатов: ${RAM_CHATS.size}. Истории тут: ${mem ? mem.history.length : 0}. Напиши /ping ai для теста ИИ.`);
      return true;
    }
    await sendTyping(env, chatId);
    const t0 = Date.now();
    const aiRes = await callChatAIWithBackup(env, {
      systemInstruction: 'Ответь одной короткой бодрой фразой на русском, что связь с радиорубкой отличная.',
      history: [],
      userPrompt: 'Проверка связи /ping ai',
    });
    const ms = Date.now() - t0;
    await sendTgMessage(env, chatId, aiRes.ok ? `🟢 AI ответ за ${ms} мс\nПровайдер: ${aiRes.provider} (${aiRes.model})\n\n${aiRes.text}` : `🔴 Ошибка AI (${ms} мс):\n${aiRes.errors.join('\n')}`);
    return true;
  }

  return false;
}

async function handlePrivateMessage(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();
  if (!text) return;
  if (text.startsWith('/') && await handleCommands(env, msg, text)) return;

  const name = extractDisplayName(msg);
  const mem = await getChatMem(env, chatId);
  pushChatHistory(mem, 'user', name, text);

  await sendTyping(env, chatId);
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: getPersonaPrompt(false), history: mem.history.slice(0, -1), userPrompt: `${name}: ${text}` });
  if (!aiRes.ok) {
    addTrace('dm_ai_err', aiRes.errors.join(' | ').slice(0, 220));
    await sendTgMessage(env, chatId, '📡 Сигнал до ИИ-пульта временно просел. Попробуй через пару секунд или жми /games!');
    return;
  }

  pushChatHistory(mem, 'assistant', 'Zombie-DJ', aiRes.text);
  mem.lastBotReplyTs = Date.now();
  mem.turnsSinceReply = 0;
  await flushChatMem(env, chatId, mem);
  await sendTgMessage(env, chatId, aiRes.text, { reply_markup: buildCtaMarkup(env, `${text} ${aiRes.text}`, true) });
}

async function handleGroupMessage(env, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length > 0) {
    const newcomers = msg.new_chat_members.filter((u) => !u.is_bot).map((u) => u.first_name || u.username || 'боец');
    if (newcomers.length > 0) {
      await sendTgMessage(env, chatId, `🧟‍♂️ В эфир залетел(и): <b>${escapeHtml(newcomers.join(', '))}</b>!\nДядя Коля тасует карты, Zombie-DJ крутит биты. Срубнём в Дурака, покрутим слоты или включим радио?`, {
        parse_mode: 'HTML',
        reply_markup: buildAllGamesMarkup(env),
      });
    }
    return;
  }

  if (!text) return;
  if (text.startsWith('/') && await handleCommands(env, msg, text)) return;

  const name = extractDisplayName(msg);
  const mem = await getChatMem(env, chatId);
  pushChatHistory(mem, 'user', name, text);
  mem.turnsSinceReply = (mem.turnsSinceReply || 0) + 1;

  const decision = shouldBotReplyInGroup(msg, mem);
  if (!decision.reply) return;

  await sendTyping(env, chatId);
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: getPersonaPrompt(true, msg.chat.title || ''), history: mem.history.slice(0, -1), userPrompt: `${name}: ${text}` });
  if (!aiRes.ok) {
    addTrace('group_ai_err', aiRes.errors.join(' | ').slice(0, 220));
    if (decision.direct) {
      await sendTgMessage(env, chatId, '🎙 Радиовышка чуть перегрелась — повтори через 10 секунд или жми /games!', { reply_to_message_id: msg.message_id });
    }
    return;
  }

  pushChatHistory(mem, 'assistant', 'Zombie-DJ', aiRes.text);
  mem.lastBotReplyTs = Date.now();
  mem.turnsSinceReply = 0;
  await flushChatMem(env, chatId, mem);
  await sendTgMessage(env, chatId, aiRes.text, { reply_to_message_id: msg.message_id, reply_markup: buildCtaMarkup(env, `${text} ${aiRes.text}`, false) });
}

async function sendStarInvoiceToChat(env, chatId, tierId) {
  const tier = STAR_TIERS.find((t) => t.id === tierId) || STAR_TIERS[0];
  return tgCall(env, 'sendInvoice', { chat_id: chatId, title: tier.title, description: tier.desc, payload: `star_tier:${tier.id}:${Date.now()}`, currency: 'XTR', prices: [{ label: tier.title, amount: tier.stars }] });
}

async function createStarInvoiceLink(env, tierId) {
  const tier = STAR_TIERS.find((t) => t.id === tierId) || STAR_TIERS[0];
  return tgCall(env, 'createInvoiceLink', { title: tier.title, description: tier.desc, payload: `star_tier:${tier.id}:${Date.now()}`, currency: 'XTR', prices: [{ label: tier.title, amount: tier.stars }] });
}

async function handleCallbackQuery(env, cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id;
  await tgCall(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
  if (!chatId) return;
  if (data === 'open_banquet') {
    await sendTgMessage(env, chatId, '🤩 <b>Меню банкета для Zombie-DJ и Дяди Коли:</b>', { parse_mode: 'HTML', reply_markup: buildBanquetMarkup() });
  } else if (data.startsWith('buy_')) {
    await sendStarInvoiceToChat(env, chatId, data.slice(4));
  }
}

async function handleTelegramUpdate(env, update) {
  try {
    if (update.pre_checkout_query) {
      await tgCall(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
      return;
    }
    if (update.callback_query) {
      addTrace('callback', update.callback_query.data || '');
      await handleCallbackQuery(env, update.callback_query);
      return;
    }
    const msg = update.message;
    if (!msg) return;

    if (msg.successful_payment) {
      const amount = msg.successful_payment.total_amount;
      const who = extractDisplayName(msg);
      await sendTgMessage(env, msg.chat.id, amount >= 10000
        ? `👑 <b>${escapeHtml(who)}</b> НАКРЫЛ ДИДЖЕЯМ БАНКЕТ на ${amount} ⭐! Вся рубка и канал встают на уши — легенда!`
        : `⭐ Спасибо, <b>${escapeHtml(who)}</b>! Долетело ${amount} ⭐ — ведущие заряжены на максимум!`, { parse_mode: 'HTML' });
      if (env.ADMIN_CHAT_ID) {
        await sendTgMessage(env, env.ADMIN_CHAT_ID, `💰 Донат ${amount} ⭐ от ${who} (${msg.from?.id || '?'})`).catch(() => null);
      }
      return;
    }

    if (msg.is_automatic_forward) return;
    const fromId = msg.from?.id;
    if (Boolean(msg.from?.is_bot) && !ALLOWED_BOT_SENDER_IDS.has(fromId)) {
      addTrace('ignored_bot', `${fromId}:${msg.from?.username || ''}`);
      return;
    }

    const chatType = msg.chat?.type;
    addTrace('msg', `${chatType}:${msg.chat?.id}:${fromId || 'anon'}:${(msg.text || '').slice(0, 40)}`);
    if (chatType === 'private') await handlePrivateMessage(env, msg);
    else if (chatType === 'group' || chatType === 'supergroup') await handleGroupMessage(env, msg);
  } catch (e) {
    addTrace('update_err', e.message);
  }
}

function renderHtml(env) {
  const ecoJson = JSON.stringify(getEcosystem(env)).replace(/</g, '\\u003c');
  const tiersJson = JSON.stringify(STAR_TIERS).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Zombie Rap Radio</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root{--bg:#090B0E;--surface:#12161C;--surface2:#1A2029;--border:rgba(255,255,255,0.08);--text:#F2F5F8;--muted:#8B96A5;--lime:#CCFF00;--red:#FF3B30;--gold:#FFB800}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,sans-serif;min-height:100vh;overflow-x:hidden}
  .app{max-width:520px;margin:0 auto;padding:14px 14px calc(86px + env(safe-area-inset-bottom,0px))}
  .topbar{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:14px}
  .brand{display:flex;align-items:center;gap:10px}
  .dot{width:10px;height:10px;border-radius:50%;background:var(--red);box-shadow:0 0 10px var(--red)}
  .brand-title{font-weight:800;font-size:15px;letter-spacing:.4px}
  .brand-sub{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
  .cookie-counter{font-size:13px;font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums}
  .view{display:none}.view.active{display:block}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px}
  .card-label{font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:var(--lime);margin-bottom:6px}
  .card-title{font-size:17px;font-weight:800;margin:0 0 8px}
  .news-text{font-size:14px;line-height:1.5;color:#E2E8F0;white-space:pre-wrap;margin:0}
  .btn{width:100%;min-height:46px;border:0;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
  .btn:active{transform:scale(.98)}
  .btn-lime{background:var(--lime);color:#090B0E}
  .btn-dark{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
  .btn-gold{background:linear-gradient(135deg,#FFB800,#FF7A00);color:#090B0E}
  .row-2,.pad-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .pad{min-height:76px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;color:var(--text);font-weight:700;font-size:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer}
  .pad.on{border-color:var(--lime);box-shadow:inset 0 0 0 1px var(--lime);color:var(--lime)}
  .pad-sub{font-size:11px;color:var(--muted)}
  .eco-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;margin-bottom:8px}
  .eco-tag{font-size:10px;font-weight:800;color:var(--lime);letter-spacing:.7px}
  .eco-name{font-size:15px;font-weight:800;margin:2px 0}
  .eco-desc{font-size:12px;color:var(--muted);line-height:1.35}
  .eco-go{min-width:78px;min-height:44px;padding:0 12px;border:0;border-radius:10px;background:var(--lime);color:#090B0E;font-weight:800;font-size:13px;cursor:pointer}
  .tier-card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px}
  .tier-card.legend{border-color:rgba(255,184,0,.45)}
  .tier-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .tier-name{font-size:15px;font-weight:800}
  .tier-stars{font-size:14px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums}
  .tier-desc{font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.4}
  .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(14,17,23,.96);backdrop-filter:blur(12px);border-top:1px solid var(--border);padding:6px 10px calc(6px + env(safe-area-inset-bottom,0px))}
  .tabbar-inner{max-width:520px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .tabbtn{min-height:48px;background:transparent;border:0;border-radius:10px;color:var(--muted);font-size:11px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
  .tabbtn.active{color:var(--lime);background:rgba(204,255,0,.08)}
  .tabico{font-size:18px;line-height:1}
  .status-line{font-size:12px;color:var(--muted);margin-top:8px;text-align:center}
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="brand"><div class="dot"></div><div><div class="brand-title">ZOMBIE RAP RADIO</div><div class="brand-sub" id="dj-status">ЭФИР ГОТОВ</div></div></div>
    <div class="cookie-counter">🍪 <span id="cookie-count">0</span></div>
  </div>
  <section id="view-feed" class="view active">
    <div class="card">
      <div class="card-label">СВОДКА ИЗ РУБКИ</div><div class="card-title">Ночной выпуск</div>
      <p class="news-text" id="news-body">Загружаем свежий эфир...</p>
      <div class="row-2"><button class="btn btn-lime" id="btn-gen-news">⚡ Новый эфир</button><button class="btn btn-dark" id="btn-speak">🔊 Озвучить</button></div>
      <div class="status-line" id="feed-msg"></div>
    </div>
    <div class="card">
      <div class="card-label">БЫСТРЫЙ СТАРТ</div><div class="card-title">Поиграть прямо сейчас</div>
      <div class="row-2"><button class="btn btn-dark" data-bot-url="https://t.me/durak_empire_bot">🃏 Дурак</button><button class="btn btn-dark" data-bot-url="https://t.me/ForestFortuneVegasBot">🎰 Слоты 5x5</button></div>
    </div>
  </section>
  <section id="view-deck" class="view">
    <div class="card">
      <div class="card-label">WEB AUDIO ПУЛЬТ</div><div class="card-title">Каналы Zombie-DJ</div>
      <div class="pad-grid">
        <button class="pad" id="pad-bass" data-pad="bass"><span>🔊 Sub-Bass</span><span class="pad-sub">55 Hz Грув</span></button>
        <button class="pad" id="pad-beat" data-pad="beat"><span>🥁 Boom-Bap</span><span class="pad-sub">92 BPM Бит</span></button>
        <button class="pad" id="pad-synth" data-pad="synth"><span>🎹 Acid Lead</span><span class="pad-sub">Синт-рисунок</span></button>
        <button class="pad" id="pad-scratch"><span>💿 Scratch FX</span><span class="pad-sub">Разовый удар</span></button>
      </div>
    </div>
    <div class="card">
      <div class="card-label">АКТИВНОСТЬ СТУДИИ</div><div class="card-title">Натапай печеньку Дяде Коле</div>
      <button class="btn btn-gold" id="btn-tap-cookie">🍪 Кинуть печеньку бесплатно</button>
      <div class="status-line">Тапы уходят пачками, не нагружая базу</div>
    </div>
  </section>
  <section id="view-games" class="view">
    <div class="card"><div class="card-label">ЭКОСИСТЕМА</div><div class="card-title">Боты и проекты тусовки</div><div id="eco-list"></div></div>
  </section>
  <section id="view-banquet" class="view">
    <div class="card"><div class="card-label">TELEGRAM STARS</div><div class="card-title">Угостить ведущих</div><div id="tiers-list"></div><div class="status-line" id="pay-msg"></div></div>
  </section>
</div>
<nav class="tabbar"><div class="tabbar-inner">
  <button class="tabbtn active" data-tab="feed"><span class="tabico">📻</span><span>Эфир</span></button>
  <button class="tabbtn" data-tab="deck"><span class="tabico">🎛</span><span>Пульт</span></button>
  <button class="tabbtn" data-tab="games"><span class="tabico">🎮</span><span>Игры</span></button>
  <button class="tabbtn" data-tab="banquet"><span class="tabico">🤩</span><span>Банкет</span></button>
</div></nav>
<script>
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const ECO = ${ecoJson};
const TIERS = ${tiersJson};
let cookiesTotal = 0, pendingCookies = 0, cookieFlushTimer = null;

function openBot(url) {
  if (tg && typeof tg.openTelegramLink === 'function' && url.indexOf('https://t.me/') === 0) tg.openTelegramLink(url);
  else window.location.href = url;
}

document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
    document.getElementById('view-' + tabBtn.dataset.tab).classList.add('active');
    tabBtn.classList.add('active');
    return;
  }
  const botBtn = ev.target.closest('[data-bot-url]');
  if (botBtn) { openBot(botBtn.dataset.botUrl); return; }
  const tierBtn = ev.target.closest('[data-tier-id]');
  if (tierBtn) { buyTier(tierBtn.dataset.tierId); return; }
  const padBtn = ev.target.closest('[data-pad]');
  if (padBtn) { togglePad(padBtn.dataset.pad); }
});

function renderLists() {
  const ecoList = document.getElementById('eco-list');
  ecoList.textContent = '';
  ECO.filter(e => !e.isWebApp).forEach(e => {
    const row = document.createElement('div');
    row.className = 'eco-item';
    const info = document.createElement('div');
    info.innerHTML = '<div class="eco-tag"></div><div class="eco-name"></div><div class="eco-desc"></div>';
    info.querySelector('.eco-tag').textContent = e.tag;
    info.querySelector('.eco-name').textContent = e.name;
    info.querySelector('.eco-desc').textContent = e.short;
    const btn = document.createElement('button');
    btn.className = 'eco-go';
    btn.textContent = 'Открыть';
    btn.dataset.botUrl = e.url;
    row.append(info, btn);
    ecoList.appendChild(row);
  });

  const tiersList = document.getElementById('tiers-list');
  tiersList.textContent = '';
  TIERS.forEach(t => {
    const card = document.createElement('div');
    card.className = 'tier-card' + (t.stars >= 10000 ? ' legend' : '');
    const head = document.createElement('div');
    head.className = 'tier-head';
    head.innerHTML = '<span class="tier-name"></span><span class="tier-stars"></span>';
    head.querySelector('.tier-name').textContent = t.title;
    head.querySelector('.tier-stars').textContent = t.stars + ' ⭐';
    const desc = document.createElement('div');
    desc.className = 'tier-desc';
    desc.textContent = t.desc;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (t.stars >= 10000 ? 'btn-gold' : 'btn-lime');
    btn.textContent = t.label;
    btn.dataset.tierId = t.id;
    card.append(head, desc, btn);
    tiersList.appendChild(card);
  });
}

async function loadState() {
  try {
    const data = await (await fetch('/api/state')).json();
    cookiesTotal = data.cookies || 0;
    document.getElementById('cookie-count').textContent = cookiesTotal;
    document.getElementById('news-body').textContent = (data.news && data.news.text) ? data.news.text : 'Эфир пуст. Жми «Новый эфир»!';
  } catch { document.getElementById('news-body').textContent = 'Не удалось загрузить эфир.'; }
}

document.getElementById('btn-gen-news').onclick = async () => {
  const msg = document.getElementById('feed-msg');
  msg.textContent = 'Генерируем свежий выпуск...';
  try {
    const data = await (await fetch('/api/generate', { method: 'POST' })).json();
    if (data.ok && data.item) {
      document.getElementById('news-body').textContent = data.item.text;
      msg.textContent = 'Готово (' + data.item.provider + ')';
    } else msg.textContent = data.error || 'Ошибка генерации';
  } catch { msg.textContent = 'Сбой сети'; }
};

document.getElementById('btn-speak').onclick = () => {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(document.getElementById('news-body').textContent);
  u.lang = 'ru-RU'; u.rate = 1.03; u.pitch = 0.85;
  window.speechSynthesis.speak(u);
};

document.getElementById('btn-tap-cookie').onclick = () => {
  cookiesTotal += 1; pendingCookies += 1;
  document.getElementById('cookie-count').textContent = cookiesTotal;
  if (cookieFlushTimer) clearTimeout(cookieFlushTimer);
  cookieFlushTimer = setTimeout(async () => {
    const delta = pendingCookies; pendingCookies = 0;
    if (delta <= 0) return;
    try {
      const d = await (await fetch('/api/free-cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta }) })).json();
      if (typeof d.cookies === 'number') { cookiesTotal = d.cookies; document.getElementById('cookie-count').textContent = cookiesTotal; }
    } catch {}
  }, 2000);
};

async function buyTier(tierId) {
  const msg = document.getElementById('pay-msg');
  msg.textContent = 'Создаём счёт Stars...';
  try {
    const data = await (await fetch('/api/create-invoice?tier=' + encodeURIComponent(tierId), { method: 'POST' })).json();
    if (data.ok && data.url) {
      msg.textContent = '';
      if (tg && typeof tg.openInvoice === 'function') tg.openInvoice(data.url, (st) => { msg.textContent = st === 'paid' ? '⭐ Оплата прошла, респект!' : ('Статус: ' + st); });
      else window.location.href = data.url;
    } else msg.textContent = data.error || 'Не удалось создать счёт';
  } catch { msg.textContent = 'Ошибка соединения'; }
}

let actx = null, loopTimer = null, step = 0;
const padState = { bass: false, beat: false, synth: false };
function ensureAudio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); }
function tone(type, f1, f2, dur, gainVal, t) {
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(f1, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(gainVal, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(actx.destination); osc.start(t); osc.stop(t + dur + 0.02);
}
function tickEngine() {
  if (!padState.bass && !padState.beat && !padState.synth) { clearInterval(loopTimer); loopTimer = null; document.getElementById('dj-status').textContent = 'ЭФИР ГОТОВ'; return; }
  document.getElementById('dj-status').textContent = 'DJ LIVE • 92 BPM';
  const t = actx.currentTime + 0.02;
  if (padState.beat && (step % 4 === 0 || step % 8 === 6)) tone('sine', 140, 42, 0.14, 0.65, t);
  if (padState.bass && step % 2 === 0) tone('sawtooth', step % 4 === 0 ? 55 : 65.4, null, 0.22, 0.16, t);
  if (padState.synth) tone('square', [220,261.6,329.6,293.6,220,392,329.6,261.6][step % 8], null, 0.13, 0.09, t);
  step = (step + 1) % 16;
}
function togglePad(name) {
  ensureAudio(); padState[name] = !padState[name];
  document.getElementById('pad-' + name).classList.toggle('on', padState[name]);
  if (!loopTimer && (padState.bass || padState.beat || padState.synth)) loopTimer = setInterval(tickEngine, 163);
}
document.getElementById('pad-scratch').onclick = () => {
  ensureAudio(); const t = actx.currentTime;
  tone('triangle', 900, 140, 0.12, 0.28, t); tone('triangle', 140, 620, 0.1, 0.22, t + 0.12);
};

renderLists(); loadState();
</script>
</body>
</html>`;
}

async function handleDebug(env) {
  const me = await tgCall(env, 'getMe');
  const webhookInfo = await tgCall(env, 'getWebhookInfo');
  let availableModels = [];
  let geminiTest = 'GEMINI_API_KEY missing';

  if (env.GEMINI_API_KEY) {
    try {
      const mRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`);
      if (mRes.ok) {
        const mJson = await mRes.json();
        availableModels = (mJson.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
      }
    } catch {}
    const gRes = await callGeminiChat(env, { systemInstruction: 'Reply with OK and 3 short words in Russian.', contents: [{ role: 'user', parts: [{ text: 'Тест связи' }] }] });
    geminiTest = gRes.ok ? `OK (${gRes.model}): ${gRes.text}` : `ERROR: ${gRes.errors.join(' | ')}`;
  }

  const waRes = await callWorkersAiChat(env, { systemInstruction: 'Reply with OK in 3 words in Russian.', messages: [{ role: 'user', content: 'Тест связи' }] });
  const canRead = me?.result?.can_read_all_group_messages;
  return jsonResp({
    ok: true,
    version: 'V7.1',
    privacyWarning: canRead === false ? 'Отключи Group Privacy в @BotFather -> /mybots -> @zombie_rap_news_bot -> Bot Settings -> Group Privacy -> Turn off' : null,
    bot: me?.result || me,
    webhookInfo: webhookInfo?.result || webhookInfo,
    geminiTest,
    workersAiTest: waRes.ok ? `OK (${waRes.model}): ${waRes.text}` : `ERROR: ${waRes.error}`,
    availableModels,
    ramChatsCount: RAM_CHATS.size,
    recentTrace: RAM_TRACE,
  });
}

async function handleSetup(env, reqUrl) {
  const webhookUrl = `${reqUrl.origin}/webhook`;
  const wh = await tgCall(env, 'setWebhook', { url: webhookUrl, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
  const cmds = await tgCall(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Запуск радио и меню' },
      { command: 'news', description: 'Свежий сатирический выпуск' },
      { command: 'games', description: 'Все 7 ботов и игры тусовки' },
      { command: 'banquet', description: 'Накрыть диджеям банкет (Stars)' },
      { command: 'ping', description: 'Проверка связи (/ping ai для ИИ)' },
    ],
  });
  const me = await tgCall(env, 'getMe');
  const canRead = me?.result?.can_read_all_group_messages ?? null;
  return jsonResp({ ok: Boolean(wh?.ok), version: 'V7.1', webhookUrl, webhookSet: wh, commandsSet: cmds, canReadAllGroupMessages: canRead, warning: canRead === false ? 'Отключи Group Privacy в @BotFather!' : null });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: getCorsHeaders() });
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/index.html') return new Response(renderHtml(env), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (path === '/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleTelegramUpdate(env, update));
      return jsonResp({ ok: true });
    }
    if (path === '/setup') return handleSetup(env, url);
    if (path === '/debug') return handleDebug(env);
    if (path === '/api/state') {
      const news = await kvGetJson(env, 'latest_news', null);
      const cookies = (await kvGetJson(env, 'free_cookies', 0)) || 0;
      return jsonResp({ ok: true, news, cookies, ecosystem: getEcosystem(env), tiers: STAR_TIERS });
    }
    if (path === '/api/generate' && (request.method === 'POST' || request.method === 'GET')) {
      const res = await generateAndStoreNews(env, { postToChannel: false, forceTopic: url.searchParams.get('topic') || '' });
      return jsonResp(res, res.ok ? 200 : 502);
    }
    if (path === '/api/free-cookie' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const delta = Math.max(1, Math.min(50, Number(body.delta) || 1));
      const next = ((await kvGetJson(env, 'free_cookies', 0)) || 0) + delta;
      await kvPutJson(env, 'free_cookies', next);
      return jsonResp({ ok: true, cookies: next });
    }
    if (path === '/api/create-invoice') {
      const link = await createStarInvoiceLink(env, url.searchParams.get('tier') || 'cookie');
      return link.ok && link.result ? jsonResp({ ok: true, url: link.result }) : jsonResp({ ok: false, error: link.description || 'Invoice error' }, 500);
    }
    return jsonResp({ ok: false, error: 'Not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateAndStoreNews(env, { postToChannel: true }));
  },
};
