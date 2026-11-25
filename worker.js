/**
 * ZOMBIE NEWS RADIO & AI CREW — Cloudflare Worker (V9)
 * Single-file Worker for GitHub -> Cloudflare Workers
 * Bindings: NEWS_KV (KV), AI (Workers AI)
 * Env Vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, ADMIN_CHAT_ID
 */

const BOT_USERNAME = 'zombie_rap_news_bot';
const DEFAULT_CHANNEL = '@zombie_news_flava';
const DEFAULT_MINIAPP_URL = 'https://zombie-news-bot.qx420.workers.dev/';

const GEMINI_TEXT_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
];
const GEMINI_TTS_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-2.5-flash-preview-tts',
];
const WORKERS_AI_TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const WORKERS_AI_IMAGE_MODELS = [
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/bytedance/sdxl-lightning-4step',
];

// 1087968824 = Anonymous Group Admin (@GroupAnonymousBot), 136817688 = @Channel_Bot
const ALLOWED_BOT_SENDER_IDS = new Set([1087968824, 136817688]);

const RAM_CHATS = new Map();
const RAM_TRACE = [];
const KV_SYNC_INTERVAL_MS = 180000;
const MAX_RAM_CHATS = 120;
const MAX_TRACE_ITEMS = 30;

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
  RAM_TRACE.unshift({ ts: new Date().toISOString(), type, detail: String(detail || '').slice(0, 220) });
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

function cleanFormatting(str) {
  return String(str || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
}

function truncateForCaption(str, maxLen = 800) {
  const s = String(str || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3).trimEnd()}...`;
}

function hasCyrillicTrigger(text, innerPattern) {
  const re = new RegExp(`(^|[^а-яёa-z0-9_])(${innerPattern})([^а-яёa-z0-9_]|$)`, 'i');
  return re.test(String(text || '').toLowerCase());
}

// ---------- Binary / Base64 / WAV Helpers ----------

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function streamToBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function pcmToWavBytes(pcmBytes, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcmBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  v.setUint32(40, pcmBytes.length, true);
  const out = new Uint8Array(44 + pcmBytes.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcmBytes, 44);
  return out;
}

// ---------- KV Helpers ----------

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

async function recordDiagError(env, source, detail) {
  addTrace(source, detail);
  await kvPutJson(env, 'diag_last_error', { ts: new Date().toISOString(), source, detail: String(detail).slice(0, 300) }, 86400);
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

// ---------- Telegram API Helpers ----------

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

async function tgUploadMultipart(env, method, formData) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) addTrace('tg_err', `${method}: ${data.description || res.status}`);
  return data;
}

async function sendTgMessage(env, chatId, text, extra = {}) {
  let res = await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, 4000),
    disable_web_page_preview: true,
    ...extra,
  });
  if (!res.ok && extra.reply_to_message_id) {
    const cleanExtra = { ...extra };
    delete cleanExtra.reply_to_message_id;
    res = await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: String(text || '').slice(0, 4000),
      disable_web_page_preview: true,
      ...cleanExtra,
    });
  }
  if (!res.ok) await recordDiagError(env, 'send_err', `${chatId}: ${res.description || 'unknown'}`);
  return res;
}

async function sendTgPhoto(env, chatId, bytes, mime, captionHtml, replyMarkup) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('photo', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'cover.png' : 'cover.jpg');
  if (captionHtml) {
    fd.append('caption', captionHtml);
    fd.append('parse_mode', 'HTML');
  }
  if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));

  const res = await tgUploadMultipart(env, 'sendPhoto', fd);
  if (!res.ok) await recordDiagError(env, 'photo_err', `${chatId}: ${res.description || 'unknown'}`);
  return res;
}

async function sendTgAudio(env, chatId, wavBytes, title = 'Zombie Rap Radio', performer = 'Zombie-DJ & Дядя Коля') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'zombie_radio.wav');
  fd.append('title', title);
  fd.append('performer', performer);
  const res = await tgUploadMultipart(env, 'sendAudio', fd);
  if (!res.ok) await recordDiagError(env, 'audio_err', `${chatId}: ${res.description || 'unknown'}`);
  return res;
}

async function sendTyping(env, chatId, action = 'typing') {
  return tgCall(env, 'sendChatAction', { chat_id: chatId, action }).catch(() => null);
}

// ---------- AI Text, Vision, Image & TTS ----------

async function callGeminiSingleModel(apiKey, model, systemInstruction, contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  const supportsThinkingLow = model === 'gemini-4-hydrogen' || model === 'gemini-3-flash-preview';

  const makeBody = (withConfig) => {
    const body = { contents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (withConfig && supportsThinkingLow) body.generationConfig = { thinkingConfig: { thinkingLevel: 'LOW' } };
    return JSON.stringify(body);
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeBody(true), signal: controller.signal });
    if (res.status === 400 && supportsThinkingLow) {
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
    const out = await env.AI.run(WORKERS_AI_TEXT_MODEL, { messages: aiMessages, max_tokens: 340 });
    const text = String(out?.response || out?.text || '').trim();
    if (!text) return { ok: false, error: 'Workers AI returned empty text' };
    return { ok: true, provider: 'workers-ai', model: WORKERS_AI_TEXT_MODEL, text };
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

  addTrace('gemini_fallback', gem.errors.join(' | '));
  const waMessages = history.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.role === 'assistant' ? h.text : `${h.name}: ${h.text}`,
  }));
  if (userPrompt) waMessages.push({ role: 'user', content: userPrompt });

  const wa = await callWorkersAiChat(env, { systemInstruction, messages: waMessages });
  if (wa.ok) return wa;
  return { ok: false, errors: [...(gem.errors || []), wa.error] };
}

async function generateCoverImage(env, promptText) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return { ok: false, error: 'Workers AI binding missing' };
  }
  const fullPrompt = `${promptText}, underground pirate cyberpunk rap radio cover art, neon lime and crimson lighting, gritty digital illustration, no text, high contrast`;
  const errors = [];

  for (const model of WORKERS_AI_IMAGE_MODELS) {
    try {
      const inputs = model.includes('flux') ? { prompt: fullPrompt, steps: 4 } : { prompt: fullPrompt, num_steps: 4 };
      const out = await env.AI.run(model, inputs);
      if (out && typeof out.image === 'string' && out.image.length > 100) {
        return { ok: true, model, mime: 'image/jpeg', b64: out.image, bytes: base64ToBytes(out.image) };
      }
      if (out instanceof Uint8Array && out.length > 100) {
        return { ok: true, model, mime: 'image/png', b64: bytesToBase64(out), bytes: out };
      }
      if (out && typeof out.getReader === 'function') {
        const bytes = await streamToBytes(out);
        if (bytes.length > 100) return { ok: true, model, mime: 'image/png', b64: bytesToBase64(bytes), bytes };
      }
      errors.push(`${model}: unsupported output`);
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

async function generateGeminiTtsWav(env, text) {
  if (!env.GEMINI_API_KEY) return { ok: false, error: 'GEMINI_API_KEY missing' };
  const speechText = String(text || '').slice(0, 500);
  const errors = [];
  for (const model of GEMINI_TTS_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Прочитай выразительно как ночной радиоведущий: ${speechText}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          },
        }),
      });
      if (!res.ok) {
        errors.push(`${model} (${res.status})`);
        continue;
      }
      const data = await res.json();
      const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline || !inline.data) {
        errors.push(`${model}: empty audio`);
        continue;
      }
      const pcm = base64ToBytes(inline.data);
      const wav = inline.mimeType && inline.mimeType.includes('wav') ? pcm : pcmToWavBytes(pcm, 24000, 1, 16);
      return { ok: true, model, wavBytes: wav };
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

// ---------- Ecosystem & Telegram Safe Inline Markups ----------

function buildCtaMarkup(env, textHint = '', isPrivate = false, isChannel = false) {
  const eco = getEcosystem(env);
  const lower = String(textHint || '').toLowerCase();
  const matched = eco.filter((i) => !i.isWebApp && i.keywords.some((kw) => lower.includes(kw)));
  const picks = matched.length ? matched.slice(0, 2) : [eco[1], eco[0]];
  const rows = [picks.map((p) => ({ text: `🎮 ${p.name}`, url: p.url }))];

  const radioBtn = isPrivate
    ? { text: '📻 Открыть Zombie Radio', web_app: { url: eco.find((e) => e.isWebApp).url } }
    : { text: '📻 Открыть Zombie Radio', url: `https://t.me/${BOT_USERNAME}?startapp=radio` };
  const banquetBtn = isChannel
    ? { text: '🤩 Банкет / Звёзды', url: `https://t.me/${BOT_USERNAME}?start=banquet` }
    : { text: '🤩 Банкет / Звёзды', callback_data: 'open_banquet' };

  rows.push([radioBtn, banquetBtn]);
  return { inline_keyboard: rows };
}

function buildNewsMarkup(env, textHint = '', showPublishBtn = true, isPrivate = false) {
  const base = buildCtaMarkup(env, textHint, isPrivate, false);
  const controls = [
    { text: '⚡ Новая', callback_data: 'news_gen' },
    { text: '🎙 Голос', callback_data: 'news_voice' },
  ];
  if (showPublishBtn) controls.push({ text: '📢 В канал', callback_data: 'news_pub' });
  return { inline_keyboard: [controls, ...base.inline_keyboard] };
}

function buildAllGamesMarkup(env, isPrivate = false) {
  const eco = getEcosystem(env);
  const bots = eco.filter((e) => !e.isWebApp);
  const rows = [];
  for (let i = 0; i < bots.length; i += 2) {
    const row = [{ text: bots[i].name, url: bots[i].url }];
    if (bots[i + 1]) row.push({ text: bots[i + 1].name, url: bots[i + 1].url });
    rows.push(row);
  }
  const radioBtn = isPrivate
    ? { text: '📻 Радио и Пульт', web_app: { url: (env && env.MINIAPP_URL) || DEFAULT_MINIAPP_URL } }
    : { text: '📻 Радио и Пульт', url: `https://t.me/${BOT_USERNAME}?startapp=radio` };
  rows.push([radioBtn, { text: '🤩 Банкет диджеям', callback_data: 'open_banquet' }]);
  return { inline_keyboard: rows };
}

function buildBanquetMarkup() {
  return { inline_keyboard: STAR_TIERS.map((t) => [{ text: t.label, callback_data: `buy_${t.id}` }]) };
}

// ---------- Personas & News Generation with Auto-Cover ----------

function getPersonaPrompt(isGroup, chatTitle = '') {
  return [
    'Ты — дуэт ведущих ночного пиратского Zombie Rap Radio: бодрый техно-ведущий Zombie-DJ и саркастичный уличный философ Дядя Коля Мертвец.',
    isGroup ? `Вы сидите в Telegram-группе "${chatTitle || 'тусовка'}" вместе с живыми участниками.` : 'Вы общаетесь 1-на-1 со слушателем в личке.',
    'Правила: отвечай живо по-русски, остроумно, без воды (2–5 коротких фраз). Не используй звёздочки **.',
    'Реагий именно на реплику собеседника и историю чата. Если к месту (скучно, карты, слоты, стратегия, музыка, ИИ), предложи заглянуть в один из ботов тусовки (Дурак Империя, Forest Fortune 5x5, Lucky Rodger Slot, Khutor Empire, iField Studio, iField Chat), но без спама.',
  ].join('\n');
}

function splitNewsAndCoverPrompt(rawText) {
  const lines = String(rawText || '').split('\n');
  let coverPrompt = 'underground zombie DJ spinning vinyl records in a neon cyberpunk radio booth';
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^\s*COVER\s*:\s*(.+)$/i);
    if (m && m[1].trim().length > 6) coverPrompt = m[1].trim();
    else kept.push(line);
  }
  return { newsText: cleanFormatting(kept.join('\n')), coverPrompt };
}

async function sendNewsBroadcast(env, chatId, item, cover, isPrivate, isChannel, showControls) {
  const header = isChannel ? '🎙 <b>ZOMBIE NEWS ЭФИР</b>' : '🎙 <b>Свежий выпуск радиорубки</b>';
  const markup = showControls ? buildNewsMarkup(env, item.text, !isChannel, isPrivate) : buildCtaMarkup(env, item.text, isPrivate, isChannel);

  if (cover && cover.b64) {
    const bytes = cover.bytes || base64ToBytes(cover.b64);
    const caption = `${header}\n\n${escapeHtml(truncateForCaption(item.text, 800))}`;
    const photoRes = await sendTgPhoto(env, chatId, bytes, cover.mime || 'image/jpeg', caption, markup);
    if (photoRes?.ok) return photoRes;
  }
  const fullHtml = `${header}\n\n${escapeHtml(item.text)}`;
  return sendTgMessage(env, chatId, fullHtml, { parse_mode: 'HTML', reply_markup: markup });
}

async function generateAndStoreNews(env, { postToChannel = false, forceTopic = '' } = {}) {
  const eco = getEcosystem(env).filter((e) => !e.isWebApp).map((e) => `${e.name} (${e.tag})`).join(', ');
  const sys = [
    'Ты главный редактор сатирического рэп-радио Zombie News.',
    'Напиши один короткий, острый, смешной выпуск ночных новостей от Zombie-DJ и Дяди Коли Мертвеца (до 650 символов!): 1 заголовок с эмодзи + 3 фразы ироничной сводки и короткий призыв проверить удачу.',
    'НЕ используй звёздочки ** и решётки # в тексте.',
    `Можешь упомянуть проект из тусовки: ${eco}.`,
    'В самом конце добавь отдельную последнюю строку строго в формате:',
    'COVER: short English visual scene description for cover art (5-12 words, no quotes)',
  ].join('\n');

  const prompt = forceTopic ? `Срочный выпуск про: ${forceTopic}` : `Свежий выпуск эфира #${Math.floor(Math.random() * 900 + 100)} на ${new Date().toUTCString()}`;
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: sys, history: [], userPrompt: prompt });
  if (!aiRes.ok) return { ok: false, error: aiRes.errors.join(' | ') };

  const { newsText, coverPrompt } = splitNewsAndCoverPrompt(aiRes.text);
  const cover = await generateCoverImage(env, coverPrompt);

  const item = {
    id: `news_${Date.now()}`,
    text: newsText,
    coverPrompt,
    hasCover: Boolean(cover.ok),
    coverModel: cover.ok ? cover.model : null,
    coverError: cover.ok ? null : cover.error,
    provider: aiRes.provider,
    model: aiRes.model,
    createdAt: new Date().toISOString(),
  };

  const prev = await kvGetJson(env, 'news_history', []);
  await kvPutJson(env, 'latest_news', item);
  await kvPutJson(env, 'news_history', [item, ...(Array.isArray(prev) ? prev : [])].slice(0, 12));
  if (cover.ok) {
    await kvPutJson(env, 'latest_cover_b64', { mime: cover.mime, b64: cover.b64, createdAt: item.createdAt }, 604800);
  }

  let channelSent = null;
  if (postToChannel) {
    const channelId = env.TELEGRAM_CHAT_ID || DEFAULT_CHANNEL;
    channelSent = await sendNewsBroadcast(env, channelId, item, cover.ok ? cover : null, false, true, false);
    if (!channelSent?.ok) {
      return { ok: false, item, error: channelSent?.description || 'Не удалось отправить в канал' };
    }
  }
  return { ok: true, item, cover: cover.ok ? cover : null, channelSent };
}

async function publishLatestNewsToChannel(env) {
  const item = await kvGetJson(env, 'latest_news', null);
  if (!item || !item.text) return generateAndStoreNews(env, { postToChannel: true });
  const cover = await kvGetJson(env, 'latest_cover_b64', null);
  const channelId = env.TELEGRAM_CHAT_ID || DEFAULT_CHANNEL;
  const sent = await sendNewsBroadcast(env, channelId, item, cover, false, true, false);
  return { ok: Boolean(sent?.ok), item, error: sent?.description };
}

// ---------- Stars Hall of Fame & Dice Games ----------

async function recordHallOfFame(env, userId, name, stars, tierTitle) {
  const list = (await kvGetJson(env, 'hall_of_fame', [])) || [];
  const key = String(userId || name);
  const existing = list.find((x) => String(x.id) === key);
  if (existing) {
    existing.stars = (existing.stars || 0) + stars;
    existing.name = name;
    existing.lastTier = tierTitle;
    existing.ts = Date.now();
  } else {
    list.push({ id: key, name, stars, lastTier: tierTitle, ts: Date.now() });
  }
  list.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  await kvPutJson(env, 'hall_of_fame', list.slice(0, 15));
}

async function handleDiceRoll(env, chatId, emoji, isPrivate) {
  const res = await tgCall(env, 'sendDice', { chat_id: chatId, emoji });
  const val = res?.result?.dice?.value;
  if (!val) return;

  await new Promise((r) => setTimeout(r, 2200));
  let verdict = '';
  if (emoji === '🎰') {
    const isJackpot = val === 1 || val === 22 || val === 43 || val === 64;
    verdict = isJackpot
      ? `🔥 ДЖЕКПОТ (${val}/64)! Дядя Коля роняет сигару! Лови удачу за хвост в слотах тусовки:`
      : `🎰 Выпало ${val}/64. Разогрев пошёл — за настоящими иксами залетаем в Forest Fortune 5x5 или Lucky Rodger:`;
  } else {
    verdict = val >= 5
      ? `🎲 Выпала ${val}! Фартит по-крупному — пора разложить партию в Дурака Империю!`
      : `🎲 Выпало ${val}. Маловато, но в Дураке решает голова, а не кубик — го проверять!`;
  }
  await sendTgMessage(env, chatId, verdict, { reply_markup: buildCtaMarkup(env, 'слоты дурак', isPrivate, false) });
}

// ---------- Vision Photo Roast ----------

async function handlePhotoMessage(env, msg, isGroup) {
  const chatId = msg.chat.id;
  const caption = (msg.caption || '').trim();
  const isReplyToBot = msg.reply_to_message?.from?.username?.toLowerCase() === BOT_USERNAME.toLowerCase();
  const wantsReaction = !isGroup || isReplyToBot || hasCyrillicTrigger(caption, 'зомби|коля|колян|оцен|прожар|че это|чё это|мем|фото|скри') || caption.includes('?');
  if (!wantsReaction) return false;

  const photos = msg.photo || [];
  const picked = photos[Math.max(0, photos.length - 2)] || photos[photos.length - 1];
  if (!picked?.file_id) return false;

  const fileInfo = await tgCall(env, 'getFile', { file_id: picked.file_id });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) return false;

  await sendTyping(env, chatId);
  const fileRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileRes.ok) return false;
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  const b64 = bytesToBase64(bytes);

  const name = extractDisplayName(msg);
  const gem = await callGeminiChat(env, {
    systemInstruction: getPersonaPrompt(isGroup, msg.chat.title || ''),
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        { text: `${name} скинул(а) картинку${caption ? ` с подписью: "${caption}"` : ''}. Прокомментируйте коротко, смешно и с характером.` },
      ],
    }],
  });

  if (!gem.ok) return false;
  const replyText = cleanFormatting(gem.text);
  await sendTgMessage(env, chatId, replyText, {
    ...(isGroup ? { reply_to_message_id: msg.message_id } : {}),
    reply_markup: buildCtaMarkup(env, replyText, !isGroup, false),
  });
  return true;
}

// ---------- Message Routing & Commands ----------

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
  const hasDirectTrigger = hasCyrillicTrigger(
    lower,
    'привет|здаров|хай|салют|ку|добр|тест|алло|эй|ау|слыш|молч|жив|кто тут|как дел|скучн|зомби|дядя коля|колян|диджей|dj|бот|радио|новост|пост|эфир|сыгра|картишк|карт|дурак|слот|удач|вегас|хутор|банкет|печен|музык|трек|бит|ии|нейро|скажи|расскаж|подскаж|помоги|что нового|че там|чё там|крути|рулет|кубик',
  );
  if (isReplyToBot || hasMention || hasDirectTrigger) return { reply: true, direct: true };
  if (text.includes('?') && text.length >= 3) return { reply: true, direct: true };

  const sinceReplyMs = Date.now() - (mem.lastBotReplyTs || 0);
  if (mem.turnsSinceReply >= 2 && sinceReplyMs > 12000) return { reply: true, direct: false };
  return { reply: false, direct: false };
}

async function handleCommands(env, msg, text) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(`@${BOT_USERNAME}`, '');
  const arg = parts.slice(1).join(' ').trim();

  if (cmd === '/start') {
    if (arg === 'banquet') {
      await sendTgMessage(env, chatId, '🤩 <b>Звёздный банкет и донаты в студию!</b>\nВыбери угощение для Zombie-DJ и Дяди Коли:', {
        parse_mode: 'HTML',
        reply_markup: buildBanquetMarkup(),
      });
      return true;
    }
    await sendTgMessage(env, chatId, '📻 <b>Здарова, на связи Zombie Rap Radio!</b>\nЗа пультом <b>Zombie-DJ</b> и <b>Дядя Коля Мертвец</b>.\n\n• Пиши или кидай фото — поболтаем и прожарим.\n• <b>/post</b> — свежая новость с AI-обложкой (+ <code>/post канал</code>).\n• <b>/luck</b> или <b>/roll</b> — крутануть слот 🎰 / кости 🎲 прямо тут.\n• <b>/voice</b> — голосовой выпуск от ведущих.\n• <b>/games</b> — все 7 ботов, <b>/top</b> — стена легенд Stars.', {
      parse_mode: 'HTML',
      reply_markup: buildAllGamesMarkup(env, isPrivate),
    });
    return true;
  }

  if (cmd === '/games' || cmd === '/bots') {
    const lines = getEcosystem(env).filter((e) => !e.isWebApp).map((e) => `• <b>${escapeHtml(e.name)}</b> [${e.tag}] — ${escapeHtml(e.short)}`);
    await sendTgMessage(env, chatId, `🎮 <b>Вся тусовка проектов iField & Zombie:</b>\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
      reply_markup: buildAllGamesMarkup(env, isPrivate),
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

  if (cmd === '/top' || cmd === '/legends') {
    const list = (await kvGetJson(env, 'hall_of_fame', [])) || [];
    const body = list.length
      ? list.map((x, i) => `${i + 1}. <b>${escapeHtml(x.name)}</b> — ${x.stars} ⭐`).join('\n')
      : 'Стена легенд пока ждёт первого мецената! Нажми /banquet, чтобы занять #1 место.';
    await sendTgMessage(env, chatId, `👑 <b>СТЕНА ЛЕГЕНД STARS:</b>\n\n${body}`, {
      parse_mode: 'HTML',
      reply_markup: buildBanquetMarkup(),
    });
    return true;
  }

  if (cmd === '/luck' || cmd === '/slot' || cmd === '/slots') {
    await handleDiceRoll(env, chatId, '🎰', isPrivate);
    return true;
  }

  if (cmd === '/roll' || cmd === '/dice') {
    await handleDiceRoll(env, chatId, '🎲', isPrivate);
    return true;
  }

  if (cmd === '/voice') {
    const latest = await kvGetJson(env, 'latest_news', null);
    const speakText = arg || latest?.text || 'Здарова народ, на связи ночное Зомби Рэп Радио! Залетайте в игры и накрывайте банкет!';
    await sendTyping(env, chatId, 'record_voice');
    const tts = await generateGeminiTtsWav(env, speakText);
    if (!tts.ok) {
      await sendTgMessage(env, chatId, `⚠️ Голосовой синтезатор перегружен (${tts.error}). Но озвучка всегда работает в Mini App!`);
      return true;
    }
    await sendTgAudio(env, chatId, tts.wavBytes, 'Zombie News Эфир', 'Zombie-DJ');
    return true;
  }

  if (cmd === '/post' || cmd === '/fresh') {
    await sendTyping(env, chatId, 'upload_photo');
    const toChannelNow = /^(channel|канал)$/i.test(arg);
    const gen = await generateAndStoreNews(env, { postToChannel: toChannelNow, forceTopic: toChannelNow ? '' : arg });
    if (!gen.ok) {
      await sendTgMessage(env, chatId, `⚠️ Не вышло: ${gen.error}`);
      return true;
    }
    if (toChannelNow) {
      await sendTgMessage(env, chatId, `📢 Выпуск с обложкой улетел в канал ${escapeHtml(env.TELEGRAM_CHAT_ID || DEFAULT_CHANNEL)}!`);
    } else {
      await sendNewsBroadcast(env, chatId, gen.item, gen.cover, isPrivate, false, true);
    }
    return true;
  }

  if (cmd === '/news') {
    await sendTyping(env, chatId, 'upload_photo');
    const cached = arg ? null : await kvGetJson(env, 'latest_news', null);
    if (cached && cached.text) {
      const cover = await kvGetJson(env, 'latest_cover_b64', null);
      await sendNewsBroadcast(env, chatId, cached, cover, isPrivate, false, true);
    } else {
      const gen = await generateAndStoreNews(env, { postToChannel: false, forceTopic: arg });
      if (!gen.ok) await sendTgMessage(env, chatId, `⚠️ Радиовышка перегружена: ${gen.error}`);
      else await sendNewsBroadcast(env, chatId, gen.item, gen.cover, isPrivate, false, true);
    }
    return true;
  }

  if (cmd === '/ping') {
    const mem = RAM_CHATS.get(String(chatId));
    if (!/\bai\b/i.test(text)) {
      await sendTgMessage(env, chatId, `🟢 Worker жив (V9). Чат ${msg.chat.type}. RAM-чатов: ${RAM_CHATS.size}. Истории тут: ${mem ? mem.history.length : 0}. Напиши /ping ai для теста ИИ или /post для новости с артом.`);
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
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    if (await handlePhotoMessage(env, msg, false)) return;
  }

  const text = (msg.text || msg.caption || '').trim();
  if (!text) return;
  if (text.startsWith('/') && await handleCommands(env, msg, text)) return;

  if (hasCyrillicTrigger(text, 'крути рулет|проверь удач|брось кубик|кинь слот')) {
    await handleDiceRoll(env, chatId, '🎰', true);
    return;
  }

  const name = extractDisplayName(msg);
  const mem = await getChatMem(env, chatId);
  pushChatHistory(mem, 'user', name, text);

  await sendTyping(env, chatId);
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: getPersonaPrompt(false), history: mem.history.slice(0, -1), userPrompt: `${name}: ${text}` });
  if (!aiRes.ok) {
    await recordDiagError(env, 'dm_ai_err', aiRes.errors.join(' | '));
    await sendTgMessage(env, chatId, '📡 Сигнал до ИИ-пульта временно просел. Попробуй через пару секунд или жми /games!');
    return;
  }

  const cleanReply = cleanFormatting(aiRes.text);
  pushChatHistory(mem, 'assistant', 'Zombie-DJ', cleanReply);
  mem.lastBotReplyTs = Date.now();
  mem.turnsSinceReply = 0;
  await flushChatMem(env, chatId, mem);
  await sendTgMessage(env, chatId, cleanReply, { reply_markup: buildCtaMarkup(env, `${text} ${cleanReply}`, true, false) });
}

async function handleGroupMessage(env, msg) {
  const chatId = msg.chat.id;

  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length > 0) {
    const newcomers = msg.new_chat_members.filter((u) => !u.is_bot).map((u) => u.first_name || u.username || 'боец');
    if (newcomers.length > 0) {
      await sendTgMessage(env, chatId, `🧟‍♂️ В эфир залетел(и): <b>${escapeHtml(newcomers.join(', '))}</b>!\nДядя Коля тасует карты, Zombie-DJ крутит биты. Срубнём в Дурака, покрутим слоты или включим радио?`, {
        parse_mode: 'HTML',
        reply_markup: buildAllGamesMarkup(env, false),
      });
    }
    return;
  }

  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    if (await handlePhotoMessage(env, msg, true)) return;
  }

  const text = (msg.text || msg.caption || '').trim();
  if (!text) return;
  if (text.startsWith('/') && await handleCommands(env, msg, text)) return;

  if (hasCyrillicTrigger(text, 'крути рулет|проверь удач|брось кубик|кинь слот')) {
    await handleDiceRoll(env, chatId, '🎰', false);
    return;
  }

  const name = extractDisplayName(msg);
  const mem = await getChatMem(env, chatId);
  pushChatHistory(mem, 'user', name, text);
  mem.turnsSinceReply = (mem.turnsSinceReply || 0) + 1;

  const decision = shouldBotReplyInGroup(msg, mem);
  if (!decision.reply) return;

  await sendTyping(env, chatId);
  const aiRes = await callChatAIWithBackup(env, { systemInstruction: getPersonaPrompt(true, msg.chat.title || ''), history: mem.history.slice(0, -1), userPrompt: `${name}: ${text}` });
  if (!aiRes.ok) {
    await recordDiagError(env, 'group_ai_err', aiRes.errors.join(' | '));
    if (decision.direct) {
      await sendTgMessage(env, chatId, '🎙 Радиовышка чуть перегрелась — повтори через 10 секунд или жми /games!', { reply_to_message_id: msg.message_id });
    }
    return;
  }

  const cleanReply = cleanFormatting(aiRes.text);
  pushChatHistory(mem, 'assistant', 'Zombie-DJ', cleanReply);
  mem.lastBotReplyTs = Date.now();
  mem.turnsSinceReply = 0;
  await flushChatMem(env, chatId, mem);
  await sendTgMessage(env, chatId, cleanReply, { reply_to_message_id: msg.message_id, reply_markup: buildCtaMarkup(env, `${text} ${cleanReply}`, false, false) });
}

// ---------- Telegram Payments (Stars) & Callbacks ----------

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
  const isPrivate = cq.message?.chat?.type === 'private';
  await tgCall(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
  if (!chatId) return;

  if (data === 'open_banquet') {
    await sendTgMessage(env, chatId, '🤩 <b>Меню банкета для Zombie-DJ и Дяди Коли:</b>', { parse_mode: 'HTML', reply_markup: buildBanquetMarkup() });
    return;
  }
  if (data === 'news_gen') {
    await sendTyping(env, chatId, 'upload_photo');
    const gen = await generateAndStoreNews(env, { postToChannel: false });
    if (!gen.ok) await sendTgMessage(env, chatId, `⚠️ Ошибка генерации: ${gen.error}`);
    else await sendNewsBroadcast(env, chatId, gen.item, gen.cover, isPrivate, false, true);
    return;
  }
  if (data === 'news_voice') {
    const latest = await kvGetJson(env, 'latest_news', null);
    if (!latest?.text) return;
    await sendTyping(env, chatId, 'record_voice');
    const tts = await generateGeminiTtsWav(env, latest.text);
    if (!tts.ok) await sendTgMessage(env, chatId, `⚠️ Озвучка временно занята (${tts.error}). Нажми «🔊 Озвучить» в Mini App!`);
    else await sendTgAudio(env, chatId, tts.wavBytes, 'Zombie News Эфир', 'Zombie-DJ');
    return;
  }
  if (data === 'news_pub') {
    const pub = await publishLatestNewsToChannel(env);
    await sendTgMessage(env, chatId, pub.ok
      ? `📢 Новость с артом улетела в канал ${escapeHtml(env.TELEGRAM_CHAT_ID || DEFAULT_CHANNEL)}!`
      : `⚠️ Не удалось опубликовать в канал: ${escapeHtml(pub.error || 'проверь права бота в канале')}`);
    return;
  }
  if (data.startsWith('buy_')) {
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
    if (update.channel_post && typeof update.channel_post.text === 'string' && update.channel_post.text.startsWith('/')) {
      addTrace('channel_cmd', update.channel_post.text.slice(0, 40));
      await handleCommands(env, update.channel_post, update.channel_post.text);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    if (msg.successful_payment) {
      const amount = msg.successful_payment.total_amount;
      const who = extractDisplayName(msg);
      const tierId = String(msg.successful_payment.invoice_payload || '').split(':')[1] || 'stars';
      await recordHallOfFame(env, msg.from?.id || who, who, amount, tierId);
      await sendTgMessage(env, msg.chat.id, amount >= 10000
        ? `👑 <b>${escapeHtml(who)}</b> НАКРЫЛ ДИДЖЕЯМ БАНКЕТ на ${amount} ⭐! Ты в топе Стены Легенд (/top)!`
        : `⭐ Спасибо, <b>${escapeHtml(who)}</b>! Долетело ${amount} ⭐ — имя занесено в /top!`, { parse_mode: 'HTML' });
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
    addTrace('msg', `${chatType}:${msg.chat?.id}:${fromId || 'anon'}:${(msg.text || msg.caption || (msg.photo ? '[photo]' : '')).slice(0, 40)}`);
    if (chatType === 'private') await handlePrivateMessage(env, msg);
    else if (chatType === 'group' || chatType === 'supergroup') await handleGroupMessage(env, msg);
  } catch (e) {
    await recordDiagError(env, 'update_err', e.message);
  }
}

// ---------- Mini App HTML (4-Tab Masterpiece) ----------

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
  .app{max-width:520px;margin:0 auto;padding:14px 14px calc(88px + env(safe-area-inset-bottom,0px))}
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
  .cover-wrap{display:none;margin-bottom:12px;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#000}
  .cover-wrap img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
  .news-text{font-size:14px;line-height:1.5;color:#E2E8F0;white-space:pre-wrap;margin:0}
  .topic-input{width:100%;min-height:44px;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:14px;outline:none}
  .btn{width:100%;min-height:46px;border:0;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
  .btn:active{transform:scale(.98)}
  .btn-lime{background:var(--lime);color:#090B0E}
  .btn-dark{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
  .btn-gold{background:linear-gradient(135deg,#FFB800,#FF7A00);color:#090B0E}
  .row-2,.pad-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .pad{min-height:70px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;color:var(--text);font-weight:700;font-size:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer}
  .pad.on{border-color:var(--lime);box-shadow:inset 0 0 0 1px var(--lime);color:var(--lime)}
  .pad-sub{font-size:11px;color:var(--muted)}
  .slider-row{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted)}
  .slider-row input{flex:1;accent-color:var(--lime)}
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
  .hof-row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border);font-size:13px}
  .hof-stars{color:var(--gold);font-weight:800;font-variant-numeric:tabular-nums}
  .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(14,17,23,.96);backdrop-filter:blur(12px);border-top:1px solid var(--border);padding:6px 10px calc(6px + env(safe-area-inset-bottom,0px))}
  .tabbar-inner{max-width:520px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .tabbtn{min-height:48px;background:transparent;border:0;border-radius:10px;color:var(--muted);font-size:11px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
  .tabbtn.active{color:var(--lime);background:rgba(204,255,0,.08)}
  .tabico{font-size:18px;line-height:1}
  .status-line{font-size:12px;color:var(--muted);margin-top:8px;text-align:center}
  .hist-item{padding:10px 0;border-top:1px solid var(--border);font-size:13px;line-height:1.4;color:#CBD5E1;white-space:pre-wrap}
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
      <div class="card-label">СВОДКА ИЗ РУБКИ + FLUX.1 АРТ</div><div class="card-title">Ночной выпуск</div>
      <div class="cover-wrap" id="cover-wrap"><img id="cover-img" alt="Обложка выпуска"></div>
      <p class="news-text" id="news-body">Загружаем свежий эфир...</p>
      <input class="topic-input" id="topic-input" type="text" placeholder="Тема выпуска (необязательно)...">
      <div class="row-2"><button class="btn btn-lime" id="btn-gen-news">⚡ Новый + Арт</button><button class="btn btn-dark" id="btn-post-channel">📢 В канал</button></div>
      <div class="row-2"><button class="btn btn-dark" id="btn-speak">🔊 Озвучить</button><button class="btn btn-dark" data-bot-url="https://t.me/durak_empire_bot">🃏 Дурак</button></div>
      <div class="status-line" id="feed-msg"></div>
    </div>
    <div class="card"><div class="card-label">АРХИВ ЭФИРА</div><div class="card-title">Последние выпуски</div><div id="hist-list"></div></div>
  </section>
  <section id="view-deck" class="view">
    <div class="card">
      <div class="card-label">WEB AUDIO ПУЛЬТ</div><div class="card-title">Каналы Zombie-DJ</div>
      <div class="pad-grid">
        <button class="pad" id="pad-bass" data-pad="bass"><span>🔊 Sub-Bass</span><span class="pad-sub">Грув баса</span></button>
        <button class="pad" id="pad-beat" data-pad="beat"><span>🥁 Boom-Bap</span><span class="pad-sub">Кач ударных</span></button>
        <button class="pad" id="pad-synth" data-pad="synth"><span>🎹 Acid Lead</span><span class="pad-sub">Синт-рисунок</span></button>
        <button class="pad" id="pad-hats" data-pad="hats"><span>✨ Trap Hats</span><span class="pad-sub">Хэты 16-ми</span></button>
        <button class="pad" id="pad-scratch"><span>💿 Scratch FX</span><span class="pad-sub">Скрэтч</span></button>
        <button class="pad" id="pad-horn"><span>📣 Airhorn</span><span class="pad-sub">Сирена эфира</span></button>
      </div>
      <div class="slider-row"><span>Темп: <strong id="bpm-val">92</strong> BPM</span><input id="bpm-range" type="range" min="78" max="128" value="92"></div>
      <div class="slider-row"><span>Голос Pitch: <strong id="pitch-val">0.85</strong></span><input id="pitch-range" type="range" min="60" max="130" value="85"></div>
    </div>
    <div class="card">
      <div class="card-label">АКТИВНОСТЬ СТУДИИ</div><div class="card-title">Натапай печеньку Дяде Коле</div>
      <button class="btn btn-gold" id="btn-tap-cookie">🍪 Кинуть печеньку бесплатно</button>
      <div class="status-line">Тапы уходят пачками, не нагружая базу</div>
    </div>
  </section>
  <section id="view-games" class="view">
    <div class="card"><div class="card-label">ЭКОСИСТЕМА</div><div class="card-title">7 ботов тусовки</div><div id="eco-list"></div></div>
  </section>
  <section id="view-banquet" class="view">
    <div class="card"><div class="card-label">TELEGRAM STARS</div><div class="card-title">Угостить ведущих</div><div id="tiers-list"></div><div class="status-line" id="pay-msg"></div></div>
    <div class="card"><div class="card-label">СТЕНА ЛЕГЕНД</div><div class="card-title">Топ донатов Stars</div><div id="hof-list"></div></div>
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
let cookiesTotal = 0, pendingCookies = 0, cookieFlushTimer = null, currentBpm = 92, voicePitch = 0.85;

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
    btn.className = 'eco-go'; btn.textContent = 'Открыть'; btn.dataset.botUrl = e.url;
    row.append(info, btn); ecoList.appendChild(row);
  });

  const tiersList = document.getElementById('tiers-list');
  tiersList.textContent = '';
  TIERS.forEach(t => {
    const card = document.createElement('div');
    card.className = 'tier-card' + (t.stars >= 10000 ? ' legend' : '');
    const head = document.createElement('div'); head.className = 'tier-head';
    head.innerHTML = '<span class="tier-name"></span><span class="tier-stars"></span>';
    head.querySelector('.tier-name').textContent = t.title;
    head.querySelector('.tier-stars').textContent = t.stars + ' ⭐';
    const desc = document.createElement('div'); desc.className = 'tier-desc'; desc.textContent = t.desc;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (t.stars >= 10000 ? 'btn-gold' : 'btn-lime');
    btn.textContent = t.label; btn.dataset.tierId = t.id;
    card.append(head, desc, btn); tiersList.appendChild(card);
  });
}

function renderHistory(items) {
  const box = document.getElementById('hist-list');
  box.textContent = '';
  const list = Array.isArray(items) ? items.slice(0, 4) : [];
  if (!list.length) {
    const empty = document.createElement('div'); empty.className = 'status-line';
    empty.textContent = 'История выпусков появится после первой генерации.'; box.appendChild(empty); return;
  }
  list.forEach(it => { const d = document.createElement('div'); d.className = 'hist-item'; d.textContent = it.text || ''; box.appendChild(d); });
}

function renderHof(items) {
  const box = document.getElementById('hof-list');
  box.textContent = '';
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const empty = document.createElement('div'); empty.className = 'status-line';
    empty.textContent = 'Пока никого нет — будь первым в списке легенд!'; box.appendChild(empty); return;
  }
  list.forEach((it, idx) => {
    const row = document.createElement('div'); row.className = 'hof-row';
    const left = document.createElement('span'); left.textContent = (idx + 1) + '. ' + it.name;
    const right = document.createElement('span'); right.className = 'hof-stars'; right.textContent = it.stars + ' ⭐';
    row.append(left, right); box.appendChild(row);
  });
}

function updateCover(hasCover) {
  const wrap = document.getElementById('cover-wrap');
  const img = document.getElementById('cover-img');
  if (hasCover) {
    img.src = '/api/cover?t=' + Date.now();
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
  }
}

async function loadState() {
  try {
    const data = await (await fetch('/api/state')).json();
    cookiesTotal = data.cookies || 0;
    document.getElementById('cookie-count').textContent = cookiesTotal;
    document.getElementById('news-body').textContent = (data.news && data.news.text) ? data.news.text : 'Эфир пуст. Жми «Новый + Арт»!';
    updateCover(Boolean(data.hasCover));
    renderHistory(data.history);
    renderHof(data.hallOfFame);
  } catch { document.getElementById('news-body').textContent = 'Не удалось загрузить эфир.'; }
}

document.getElementById('btn-gen-news').onclick = async () => {
  const msg = document.getElementById('feed-msg');
  const topic = document.getElementById('topic-input').value.trim();
  msg.textContent = 'Пишем выпуск и рисуем обложку FLUX.1...';
  try {
    const data = await (await fetch('/api/generate?topic=' + encodeURIComponent(topic), { method: 'POST' })).json();
    if (data.ok && data.item) {
      document.getElementById('news-body').textContent = data.item.text;
      updateCover(Boolean(data.item.hasCover));
      msg.textContent = 'Готово (' + data.item.provider + (data.item.hasCover ? ' + арт' : '') + ')';
      loadState();
    } else msg.textContent = data.error || 'Ошибка генерации';
  } catch { msg.textContent = 'Сбой сети'; }
};

document.getElementById('btn-post-channel').onclick = async () => {
  const msg = document.getElementById('feed-msg');
  msg.textContent = 'Публикуем с обложкой в канал...';
  try {
    const data = await (await fetch('/api/post-channel', { method: 'POST' })).json();
    msg.textContent = data.ok ? '📢 Выпуск с обложкой улетел в канал!' : ('Ошибка: ' + (data.error || 'не вышло'));
  } catch { msg.textContent = 'Сбой сети'; }
};

document.getElementById('btn-speak').onclick = () => {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(document.getElementById('news-body').textContent);
  u.lang = 'ru-RU'; u.rate = 1.03; u.pitch = voicePitch;
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
      if (tg && typeof tg.openInvoice === 'function') tg.openInvoice(data.url, (st) => { msg.textContent = st === 'paid' ? '⭐ Оплата прошла, ты в /top!' : ('Статус: ' + st); if (st === 'paid') loadState(); });
      else window.location.href = data.url;
    } else msg.textContent = data.error || 'Не удалось создать счёт';
  } catch { msg.textContent = 'Ошибка соединения'; }
}

let actx = null, loopTimer = null, step = 0;
const padState = { bass: false, beat: false, synth: false, hats: false };
function ensureAudio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); }
function tone(type, f1, f2, dur, gainVal, t) {
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(f1, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(gainVal, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(actx.destination); osc.start(t); osc.stop(t + dur + 0.02);
}
function restartEngine() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (padState.bass || padState.beat || padState.synth || padState.hats) {
    loopTimer = setInterval(tickEngine, Math.round(15000 / currentBpm));
  } else {
    document.getElementById('dj-status').textContent = 'ЭФИР ГОТОВ';
  }
}
function tickEngine() {
  if (!padState.bass && !padState.beat && !padState.synth && !padState.hats) { restartEngine(); return; }
  document.getElementById('dj-status').textContent = 'DJ LIVE • ' + currentBpm + ' BPM';
  const t = actx.currentTime + 0.02;
  if (padState.beat && (step % 4 === 0 || step % 8 === 6)) tone('sine', 140, 42, 0.14, 0.65, t);
  if (padState.bass && step % 2 === 0) tone('sawtooth', step % 4 === 0 ? 55 : 65.4, null, 0.22, 0.16, t);
  if (padState.synth) tone('square', [220,261.6,329.6,293.6,220,392,329.6,261.6][step % 8], null, 0.13, 0.09, t);
  if (padState.hats) tone('triangle', 4800, 2400, 0.04, step % 2 === 0 ? 0.06 : 0.03, t);
  step = (step + 1) % 16;
}
function togglePad(name) {
  ensureAudio(); padState[name] = !padState[name];
  document.getElementById('pad-' + name).classList.toggle('on', padState[name]);
  restartEngine();
}
document.getElementById('bpm-range').oninput = (e) => {
  currentBpm = Number(e.target.value) || 92;
  document.getElementById('bpm-val').textContent = currentBpm;
  if (loopTimer) restartEngine();
};
document.getElementById('pitch-range').oninput = (e) => {
  voicePitch = (Number(e.target.value) || 85) / 100;
  document.getElementById('pitch-val').textContent = voicePitch.toFixed(2);
};
document.getElementById('pad-scratch').onclick = () => {
  ensureAudio(); const t = actx.currentTime;
  tone('triangle', 900, 140, 0.12, 0.28, t); tone('triangle', 140, 620, 0.1, 0.22, t + 0.12);
};
document.getElementById('pad-horn').onclick = () => {
  ensureAudio(); const t = actx.currentTime;
  tone('sawtooth', 440, 415, 0.35, 0.22, t); tone('sawtooth', 554, 523, 0.35, 0.18, t);
};

renderLists(); loadState();
</script>
</body>
</html>`;
}

// ---------- Diagnostics & Setup ----------

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
  const lastKvErr = await kvGetJson(env, 'diag_last_error', null);
  return jsonResp({
    ok: true,
    version: 'V9',
    privacyWarning: canRead === false ? 'Отключи Group Privacy в @BotFather -> /mybots -> @zombie_rap_news_bot -> Bot Settings -> Group Privacy -> Turn off' : null,
    bot: me?.result || me,
    webhookInfo: webhookInfo?.result || webhookInfo,
    geminiTest,
    workersAiTest: waRes.ok ? `OK (${waRes.model}): ${waRes.text}` : `ERROR: ${waRes.error}`,
    workersAiImageModels: WORKERS_AI_IMAGE_MODELS,
    availableModels,
    ramChatsCount: RAM_CHATS.size,
    lastKvError: lastKvErr,
    recentTrace: RAM_TRACE,
  });
}

async function handleSetup(env, reqUrl) {
  const webhookUrl = `${reqUrl.origin}/webhook`;
  const wh = await tgCall(env, 'setWebhook', { url: webhookUrl, allowed_updates: ['message', 'channel_post', 'callback_query', 'pre_checkout_query'] });
  const cmds = await tgCall(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Запуск радио и меню' },
      { command: 'post', description: 'Свежая новость с AI-обложкой' },
      { command: 'news', description: 'Последний выпуск с обложкой' },
      { command: 'luck', description: 'Крутануть слот 🎰 в чате' },
      { command: 'roll', description: 'Бросить кубик 🎲 в чате' },
      { command: 'voice', description: 'Голосовой выпуск от DJ' },
      { command: 'games', description: 'Все 7 ботов и игры тусовки' },
      { command: 'banquet', description: 'Накрыть диджеям банкет (Stars)' },
      { command: 'top', description: 'Стена легенд Stars' },
      { command: 'ping', description: 'Проверка связи (/ping ai)' },
    ],
  });
  const me = await tgCall(env, 'getMe');
  const canRead = me?.result?.can_read_all_group_messages ?? null;
  return jsonResp({ ok: Boolean(wh?.ok), version: 'V9', webhookUrl, webhookSet: wh, commandsSet: cmds, canReadAllGroupMessages: canRead, warning: canRead === false ? 'Отключи Group Privacy в @BotFather!' : null });
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

    if (path === '/api/cover') {
      const cover = await kvGetJson(env, 'latest_cover_b64', null);
      if (!cover || !cover.b64) return new Response('No cover', { status: 404 });
      return new Response(base64ToBytes(cover.b64), {
        headers: { 'Content-Type': cover.mime || 'image/jpeg', 'Cache-Control': 'no-store', ...getCorsHeaders() },
      });
    }

    if (path === '/api/state') {
      const news = await kvGetJson(env, 'latest_news', null);
      const history = await kvGetJson(env, 'news_history', []);
      const cover = await kvGetJson(env, 'latest_cover_b64', null);
      const hallOfFame = await kvGetJson(env, 'hall_of_fame', []);
      const cookies = (await kvGetJson(env, 'free_cookies', 0)) || 0;
      return jsonResp({ ok: true, news, history, hasCover: Boolean(cover?.b64), hallOfFame, cookies, ecosystem: getEcosystem(env), tiers: STAR_TIERS });
    }

    if (path === '/api/generate' && (request.method === 'POST' || request.method === 'GET')) {
      const res = await generateAndStoreNews(env, { postToChannel: false, forceTopic: url.searchParams.get('topic') || '' });
      return jsonResp(res.ok ? { ok: true, item: res.item } : { ok: false, error: res.error }, res.ok ? 200 : 502);
    }

    if ((path === '/api/post-channel' || path === '/api/post') && (request.method === 'POST' || request.method === 'GET')) {
      const fresh = url.searchParams.get('fresh') === '1';
      const res = fresh
        ? await generateAndStoreNews(env, { postToChannel: true, forceTopic: url.searchParams.get('topic') || '' })
        : await publishLatestNewsToChannel(env);
      return jsonResp(res.ok ? { ok: true, item: res.item } : { ok: false, error: res.error }, res.ok ? 200 : 502);
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
