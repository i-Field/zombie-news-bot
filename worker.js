const MAX_HISTORY = 250;
const CAPTION_LIMIT = 980;
const STYLES = ['rap', 'chanson', 'battle'];
const CATEGORIES = ['weird', 'crypto', 'showbiz', 'tech'];

const CATEGORY_LABELS = {
  weird: '🌍 Мировой треш',
  crypto: '🪙 Крипта',
  showbiz: '🎬 Шоу-биз',
  tech: '🤖 Техно & AI'
};

const STYLE_LABELS = {
  rap: '🎤 Zombie Rap',
  chanson: '🎸 Кибер-Шансон',
  battle: '⚔️ Рэп vs Шансон'
};

const RSS_FEEDS = {
  weird: [
    'https://www.odditycentral.com/feed',
    'https://www.reddit.com/r/nottheonion/.rss?limit=15'
  ],
  crypto: [
    'https://forklog.com/feed/',
    'https://cointelegraph.com/rss'
  ],
  showbiz: [
    'https://www.tmz.com/rss.xml',
    'https://variety.com/feed/'
  ],
  tech: [
    'https://habr.com/ru/rss/news/?fl=ru'
  ]
};

const GEMINI_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
      return await handleWebhook(request, env, ctx);
    }

    if (url.pathname === '/setup' && request.method === 'GET') {
      return await handleSetup(request, env);
    }

    if (url.pathname === '/run' && request.method === 'GET') {
      const secret = await getRunSecret(env);
      if (!secret || url.searchParams.get('key') !== secret) {
        return jsonResp({ ok: false, error: 'Forbidden' }, 403);
      }
      const style = STYLES.includes(url.searchParams.get('style')) ? url.searchParams.get('style') : null;
      const category = CATEGORIES.includes(url.searchParams.get('cat')) ? url.searchParams.get('cat') : null;
      const preview = url.searchParams.get('preview') === '1';
      ctx.waitUntil(runPipeline(env, { forcedStyle: style, forcedCategory: category, toAdminDraft: preview }));
      return jsonResp({ ok: true, started: true, preview, style: style || 'auto', category: category || 'auto' });
    }

    return new Response('Zombie News Bot Active', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  }
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function hmacHex(salt, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(secret || '')));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getWebhookSecret(env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return '';
  return (await hmacHex('zombie-news-wh-v1', env.TELEGRAM_BOT_TOKEN)).slice(0, 32);
}

async function getRunSecret(env) {
  if (env.RUN_SECRET) return env.RUN_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return '';
  return (await hmacHex('zombie-news-run-v1', env.TELEGRAM_BOT_TOKEN)).slice(0, 24);
}

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '';
}

function decodeEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(str) {
  return decodeEntities(str).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function parseRssItems(xml, sourceCategory) {
  const items = [];
  const itemMatches = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const raw of itemMatches.slice(0, 20)) {
    const title = stripTags(extractTag(raw, 'title'));
    let link = stripTags(extractTag(raw, 'link'));
    if (!link) {
      const atomLink = raw.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (atomLink) link = decodeEntities(atomLink[1]);
    }
    const desc = stripTags(
      extractTag(raw, 'description') || extractTag(raw, 'summary') || extractTag(raw, 'content')
    ).slice(0, 450);

    const safeLink = sanitizeUrl(link);
    if (title && title.length > 10 && safeLink) {
      const idSource = safeLink.replace(/^https?:\/\//, '').slice(0, 120);
      items.push({
        id: `rss:${idSource}`,
        title,
        snippet: desc,
        url: safeLink,
        category: sourceCategory
      });
    }
  }
  return items;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadState(kv) {
  if (!kv) return { sent: [], lastCategory: '', lastStyle: '', cronMode: 'auto' };
  const raw = await kv.get('state:history', 'json');
  if (!raw || typeof raw !== 'object') {
    return { sent: [], lastCategory: '', lastStyle: '', cronMode: 'auto' };
  }
  return {
    sent: Array.isArray(raw.sent) ? raw.sent.slice(-MAX_HISTORY) : [],
    lastCategory: String(raw.lastCategory || ''),
    lastStyle: String(raw.lastStyle || ''),
    cronMode: raw.cronMode === 'draft' ? 'draft' : 'auto'
  };
}

async function saveState(kv, state) {
  if (!kv) return;
  const clean = {
    sent: Array.isArray(state.sent) ? state.sent.slice(-MAX_HISTORY) : [],
    lastCategory: state.lastCategory || '',
    lastStyle: state.lastStyle || '',
    cronMode: state.cronMode === 'draft' ? 'draft' : 'auto'
  };
  await kv.put('state:history', JSON.stringify(clean));
}

async function fetchHackerNewsCandidate(sentSet) {
  const res = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json', {}, 8000);
  if (!res.ok) return null;
  const ids = (await res.json()).slice(0, 25);
  for (const id of ids) {
    const key = `hn:${id}`;
    if (sentSet.has(key)) continue;
    const itemRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 5000);
    if (!itemRes.ok) continue;
    const item = await itemRes.json();
    if (!item || !item.title || (item.score || 0) < 40) continue;
    if (/^(Ask|Show|Tell) HN:/i.test(item.title)) continue;
    return {
      id: key,
      title: item.title,
      snippet: item.text ? stripTags(item.text).slice(0, 350) : '',
      url: sanitizeUrl(item.url) || `https://news.ycombinator.com/item?id=${id}`,
      category: 'tech'
    };
  }
  return null;
}

async function pickNewsItem(state, forcedCategory = null) {
  const sentSet = new Set(state.sent);
  const rotatedCats = CATEGORIES.filter((c) => c !== state.lastCategory);
  const orderedCats = forcedCategory
    ? [forcedCategory, ...CATEGORIES.filter((c) => c !== forcedCategory)]
    : [rotatedCats[Math.floor(Math.random() * rotatedCats.length)], ...rotatedCats];

  for (const cat of orderedCats) {
    const feeds = RSS_FEEDS[cat] || [];
    for (const feedUrl of feeds) {
      try {
        const res = await fetchWithTimeout(feedUrl, {
          headers: { 'User-Agent': 'ZombieNewsBot/2.0 (Cloudflare Workers RSS Reader)' }
        }, 8000);
        if (!res.ok) continue;
        const xml = await res.text();
        const items = parseRssItems(xml, cat);
        const fresh = items.find((it) => !sentSet.has(it.id));
        if (fresh) return fresh;
      } catch {}
    }
    if (cat === 'tech') {
      try {
        const hn = await fetchHackerNewsCandidate(sentSet);
        if (hn) return hn;
      } catch {}
    }
  }
  return null;
}

function chooseStyle(state, forcedStyle = null) {
  if (forcedStyle && STYLES.includes(forcedStyle)) return forcedStyle;
  const idx = STYLES.indexOf(state.lastStyle);
  return STYLES[(idx + 1) % STYLES.length];
}

function buildGeminiPayload(news, style) {
  const stylePrompt = style === 'rap'
    ? `Формат "rap" — дерзкий киберпанк-рэп от лица 🧟‍♂️ Zombie-DJ.
Напиши 6 плотных рифмованных строк (AABB или ABAB) с уличным сленгом, битом и чёрным юмором.`
    : style === 'chanson'
    ? `Формат "chanson" — мрачный ироничный кибер-шансон от лица 🎸 Дяди Коли Мертвеца.
Напиши 6 душевных рифмованных строк про судьбу, провода, общак, гитару и эту новость (вайб постапокалиптического кабака, но без мата и жести).`
    : `Формат "battle" — короткий баттл между рэпером и шансонье:
🧟‍♂️ Zombie-DJ: 4 строки язвительного киберпанк-рэпа с рифмой
🎸 Дядя Коля: 4 строки ироничного ответа в стиле кибер-шансона с рифмой`;

  const systemInstruction = `Ты креативный редактор сатирического Telegram-канала "Zombie News Flava".
Превращаешь реальные новости в яркие посты в стиле Zombie Rap и Кибер-Шансон на русском языке.
Отвечай СТРОГО JSON-объектом без markdown-обёрток.`;

  const userPrompt = `Реальная новость (${CATEGORY_LABELS[news.category] || news.category}):
Заголовок: "${news.title}"
Контекст: "${news.snippet || 'Без дополнительного текста'}"

${stylePrompt}

Верни JSON с полями:
- headline_ru: цепляющий, живой заголовок новости на русском (до 85 символов, точно передаёт суть).
- summary_ru: 1–2 коротких предложения по-русски — что именно произошло, простым языком (до 180 символов).
- lyrics: текст трека/баттла на русском (строго до 520 символов, с эмодзи персонажей и переносами строк).
- image_prompt: детальный визуальный промпт НА АНГЛИЙСКОМ для генерации обложки (без слов и текста на картинке!), где сюжет новости обыгран с персонажем (${style === 'chanson' ? 'undead cyberpunk chanson singer with rusty acoustic guitar in neon dive bar' : 'undead cyberpunk zombie rapper with glowing headphones and microphone'}), стиль: dark neon synthwave illustration, cinematic lighting, high contrast.`;

  return {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          headline_ru: { type: 'STRING' },
          summary_ru: { type: 'STRING' },
          lyrics: { type: 'STRING' },
          image_prompt: { type: 'STRING' }
        },
        required: ['headline_ru', 'summary_ru', 'lyrics', 'image_prompt']
      }
    }
  };
}

async function generatePostWithGemini(env, news, style) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан');
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_MODELS.filter((m) => m !== env.GEMINI_MODEL)] : GEMINI_MODELS;
  const payload = buildGeminiPayload(news, style);
  let lastError = 'Неизвестная ошибка Gemini';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify(payload)
      }, 25000);

      if (res.ok) {
        const data = await res.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && parsed.headline_ru && parsed.lyrics) {
          return parsed;
        }
        lastError = `${model}: пустой JSON`;
      } else {
        const errBody = await res.text();
        lastError = `${model} (${res.status}): ${errBody.slice(0, 120)}`;
        if ([429, 500, 503].includes(res.status) && i < models.length - 1) {
          await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 800)));
        }
      }
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }
  throw new Error(lastError);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function generateCoverImage(env, prompt) {
  const cleanPrompt = String(prompt || 'undead cyberpunk zombie rapper in dark neon city, digital art')
    .replace(/[^\w\s,.-]/g, ' ')
    .slice(0, 320)
    .trim();

  if (env.AI && typeof env.AI.run === 'function') {
    try {
      const fluxRes = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt: cleanPrompt,
        steps: 6
      });
      if (fluxRes && typeof fluxRes.image === 'string') {
        const buffer = base64ToArrayBuffer(fluxRes.image);
        if (buffer.byteLength > 4096) return { buffer, mime: 'image/jpeg' };
      }
    } catch {}

    try {
      const sdRes = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', {
        prompt: cleanPrompt
      });
      const buffer = sdRes instanceof ArrayBuffer
        ? sdRes
        : (sdRes instanceof Uint8Array ? sdRes.buffer : await new Response(sdRes).arrayBuffer());
      if (buffer && buffer.byteLength > 4096) return { buffer, mime: 'image/png' };
    } catch {}
  }

  if (env.GEMINI_API_KEY) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent';
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: cleanPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] }
        })
      }, 20000);
      if (res.ok) {
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
        if (imgPart) {
          const buffer = base64ToArrayBuffer(imgPart.inlineData.data);
          if (buffer.byteLength > 4096) {
            return { buffer, mime: imgPart.inlineData.mimeType || 'image/png' };
          }
        }
      }
    } catch {}
  }

  return null;
}

function formatCaption(news, gen, style) {
  const catLabel = CATEGORY_LABELS[news.category] || '📰 Новости';
  const styleLabel = STYLE_LABELS[style] || '';
  const header = `${catLabel} · ${styleLabel}\n<b>${escHtml(gen.headline_ru)}</b>`;
  const summary = `<i>${escHtml(gen.summary_ru)}</i>`;
  const footer = `🔗 <a href="${escHtml(news.url)}">Источник</a> · @zombie_news_flava`;

  const overhead = header.length + summary.length + footer.length + 12;
  const maxLyrics = Math.max(200, CAPTION_LIMIT - overhead);
  let lyrics = String(gen.lyrics || '').trim();
  if (lyrics.length > maxLyrics) {
    lyrics = lyrics.slice(0, maxLyrics - 1).replace(/\s+\S*$/, '') + '…';
  }

  return `${header}\n\n${summary}\n\n${escHtml(lyrics)}\n\n${footer}`;
}

async function tgCall(botToken, method, payload, isForm = false) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? payload : JSON.stringify(payload)
  }, 15000);
  return res.json();
}

async function sendPostToChat(botToken, chatId, caption, imageObjOrFileId, replyMarkup = null) {
  if (typeof imageObjOrFileId === 'string' && imageObjOrFileId) {
    const payload = {
      chat_id: chatId,
      photo: imageObjOrFileId,
      caption,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    };
    const r = await tgCall(botToken, 'sendPhoto', payload);
    if (r.ok) return r;
  } else if (imageObjOrFileId && imageObjOrFileId.buffer) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    const ext = imageObjOrFileId.mime.includes('png') ? 'png' : 'jpg';
    form.append('photo', new Blob([imageObjOrFileId.buffer], { type: imageObjOrFileId.mime }), `cover.${ext}`);
    const r = await tgCall(botToken, 'sendPhoto', form, true);
    if (r.ok) return r;
  }

  return tgCall(botToken, 'sendMessage', {
    chat_id: chatId,
    text: caption,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

async function notifyAdmin(env, text) {
  if (!env.ADMIN_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) return;
  try {
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: env.ADMIN_CHAT_ID,
      text: String(text).slice(0, 3500)
    });
  } catch {}
}

async function runScheduled(env) {
  const state = await loadState(env.NEWS_KV);
  await runPipeline(env, { toAdminDraft: state.cronMode === 'draft' });
}

async function runPipeline(env, opts = {}) {
  const { forcedStyle = null, forcedCategory = null, toAdminDraft = false } = opts;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы' };
  }

  const state = await loadState(env.NEWS_KV);
  const news = await pickNewsItem(state, forcedCategory);
  if (!news) {
    await notifyAdmin(env, '📭 Свежих новостей во всех лентах не найдено.');
    return { ok: false, error: 'Нет новых новостей' };
  }

  const style = chooseStyle(state, forcedStyle);

  let gen;
  try {
    gen = await generatePostWithGemini(env, news, style);
  } catch (err) {
    await notifyAdmin(env, `⚠️ Gemini не ответил (в канал ничего не отправлено):\n${err.message}`);
    return { ok: false, error: err.message };
  }

  const imageObj = await generateCoverImage(env, gen.image_prompt);
  const caption = formatCaption(news, gen, style);

  if (toAdminDraft && env.ADMIN_CHAT_ID) {
    const draftId = crypto.randomUUID().slice(0, 8);
    const kb = {
      inline_keyboard: [
        [
          { text: '✅ В канал', callback_data: `pub:${draftId}` },
          { text: '🔄 Переписать', callback_data: `reroll:${draftId}` }
        ],
        [
          { text: '🎤 Рэп', callback_data: `gen:rap` },
          { text: '🎸 Шансон', callback_data: `gen:chanson` },
          { text: '⚔️ Баттл', callback_data: `gen:battle` }
        ],
        [{ text: '🗑 Отмена', callback_data: `drop:${draftId}` }]
      ]
    };

    const res = await sendPostToChat(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, caption, imageObj, kb);
    if (res.ok && env.NEWS_KV) {
      const photos = res.result?.photo;
      const photoFileId = Array.isArray(photos) && photos.length ? photos[photos.length - 1].file_id : '';
      await env.NEWS_KV.put(`draft:${draftId}`, JSON.stringify({
        caption,
        photoFileId,
        news,
        style
      }), { expirationTtl: 86400 });
    }
    return { ok: Boolean(res.ok), mode: 'draft', style, category: news.category, hasImage: Boolean(imageObj) };
  }

  const sendRes = await sendPostToChat(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, caption, imageObj);
  if (sendRes.ok) {
    state.sent.push(news.id);
    state.lastCategory = news.category;
    state.lastStyle = style;
    await saveState(env.NEWS_KV, state);
    return { ok: true, mode: 'channel', style, category: news.category, hasImage: Boolean(imageObj) };
  }

  await notifyAdmin(env, `❌ Ошибка отправки в канал: ${sendRes.description || 'Unknown'}`);
  return { ok: false, error: sendRes.description || 'Send failed' };
}

function adminKeyboard(cronMode) {
  return {
    inline_keyboard: [
      [{ text: '🎲 Черновик (Авто-микс)', callback_data: 'gen:auto' }],
      [
        { text: '🎤 Рэп', callback_data: 'gen:rap' },
        { text: '🎸 Шансон', callback_data: 'gen:chanson' },
        { text: '⚔️ Баттл', callback_data: 'gen:battle' }
      ],
      [
        {
          text: cronMode === 'draft' ? '⏰ Крон: черновик в ЛС (сменить)' : '⏰ Крон: автопост в канал (сменить)',
          callback_data: 'toggle_cron'
        }
      ]
    ]
  };
}

async function handleSetup(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return jsonResp({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' }, 500);
  const origin = new URL(request.url).origin;
  const whSecret = await getWebhookSecret(env);
  const runSecret = await getRunSecret(env);

  const wh = await tgCall(env.TELEGRAM_BOT_TOKEN, 'setWebhook', {
    url: `${origin}/telegram-webhook`,
    secret_token: whSecret,
    allowed_updates: ['message', 'callback_query']
  });
  const cmds = await tgCall(env.TELEGRAM_BOT_TOKEN, 'setMyCommands', {
    commands: [
      { command: 'menu', description: '🎛 Пульт управления' },
      { command: 'draft', description: '🎲 Черновик случайной новости' },
      { command: 'rap', description: '🎤 Черновик Zombie Rap' },
      { command: 'chanson', description: '🎸 Черновик Кибер-Шансон' },
      { command: 'battle', description: '⚔️ Черновик Баттл' },
      { command: 'status', description: '📊 Статус и режим крона' }
    ]
  });

  return jsonResp({
    ok: Boolean(wh.ok && cmds.ok),
    hasWorkersAI: Boolean(env.AI),
    runUrl: `${origin}/run?key=${runSecret}`,
    draftUrl: `${origin}/run?key=${runSecret}&preview=1`,
    wh,
    cmds
  });
}

async function handleWebhook(request, env, ctx) {
  const expectedSecret = await getWebhookSecret(env);
  if (expectedSecret && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) {
    return jsonResp({ error: 'Forbidden' }, 403);
  }

  const upd = await request.json().catch(() => ({}));

  if (upd.callback_query) {
    const cq = upd.callback_query;
    const fromId = String(cq.from?.id || '');
    if (!env.ADMIN_CHAT_ID || fromId !== String(env.ADMIN_CHAT_ID)) {
      ctx.waitUntil(tgCall(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Доступ только для администратора канала',
        show_alert: true
      }));
      return jsonResp({ ok: true });
    }
    ctx.waitUntil(processCallback(env, cq));
    return jsonResp({ ok: true });
  }

  const msg = upd.message;
  if (msg && msg.chat && msg.text) {
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    if (!env.ADMIN_CHAT_ID) {
      ctx.waitUntil(tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: `Твой Telegram ID для переменной ADMIN_CHAT_ID:\n<code>${escHtml(chatId)}</code>`,
        parse_mode: 'HTML'
      }));
      return jsonResp({ ok: true });
    }

    if (chatId !== String(env.ADMIN_CHAT_ID)) {
      return jsonResp({ ok: true });
    }

    ctx.waitUntil(processAdminCommand(env, chatId, text));
  }

  return jsonResp({ ok: true });
}

async function processAdminCommand(env, chatId, text) {
  const state = await loadState(env.NEWS_KV);
  if (/^\/(start|menu)/i.test(text)) {
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: `🧟‍♂️ <b>Zombie News Flava — Пульт</b>\nКанал: ${escHtml(env.TELEGRAM_CHAT_ID)}\nОбложки AI: <b>${env.AI ? '⚡ Подключён' : '⚠️ Нет привязки [ai]'}</b>\nРежим крона: <b>${state.cronMode === 'draft' ? 'Черновик в ЛС' : 'Автопост в канал'}</b>`,
      parse_mode: 'HTML',
      reply_markup: adminKeyboard(state.cronMode)
    });
  } else if (/^\/status/i.test(text)) {
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: `📊 <b>Статус</b>\nВ истории новостей: <b>${state.sent.length}</b>\nПоследняя рубрика: <b>${CATEGORY_LABELS[state.lastCategory] || '—'}</b>\nПоследний стиль: <b>${STYLE_LABELS[state.lastStyle] || '—'}</b>\nОбложки (Workers AI): <b>${env.AI ? '⚡ Активно' : '❌ Не привязан'}</b>\nКрон: <b>${state.cronMode === 'draft' ? 'Черновик в ЛС' : 'Автопост в канал'}</b>`,
      parse_mode: 'HTML',
      reply_markup: adminKeyboard(state.cronMode)
    });
  } else if (/^\/draft/i.test(text)) {
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: '⏳ Ищу свежий треш, пишу трек и рисую обложку...' });
    await runPipeline(env, { toAdminDraft: true });
  } else if (/^\/(rap|chanson|battle)/i.test(text)) {
    const forcedStyle = text.slice(1).split(/\s+/)[0].toLowerCase();
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: `⏳ Готовлю черновик (${STYLE_LABELS[forcedStyle]})...` });
    await runPipeline(env, { forcedStyle, toAdminDraft: true });
  }
}

async function processCallback(env, cq) {
  const data = String(cq.data || '');
  const chatId = String(cq.message?.chat?.id || env.ADMIN_CHAT_ID);
  const msgId = cq.message?.message_id;

  await tgCall(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id });

  if (data === 'toggle_cron') {
    const state = await loadState(env.NEWS_KV);
    state.cronMode = state.cronMode === 'draft' ? 'auto' : 'draft';
    await saveState(env.NEWS_KV, state);
    if (msgId) {
      await tgCall(env.TELEGRAM_BOT_TOKEN, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: adminKeyboard(state.cronMode)
      });
    }
    return;
  }

  if (data.startsWith('gen:')) {
    const styleArg = data.slice(4);
    const forcedStyle = STYLES.includes(styleArg) ? styleArg : null;
    await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: '⏳ Генерирую черновик с обложкой...' });
    await runPipeline(env, { forcedStyle, toAdminDraft: true });
    return;
  }

  if (data.startsWith('pub:')) {
    const draftId = data.slice(4);
    const draft = env.NEWS_KV ? await env.NEWS_KV.get(`draft:${draftId}`, 'json') : null;
    if (!draft) {
      await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: '⚠️ Черновик устарел. Сделай новый через /draft' });
      return;
    }
    const res = await sendPostToChat(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, draft.caption, draft.photoFileId);
    if (res.ok) {
      const state = await loadState(env.NEWS_KV);
      state.sent.push(draft.news.id);
      state.lastCategory = draft.news.category;
      state.lastStyle = draft.style;
      await saveState(env.NEWS_KV, state);
      await env.NEWS_KV.delete(`draft:${draftId}`);
      if (msgId) {
        await tgCall(env.TELEGRAM_BOT_TOKEN, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: msgId,
          reply_markup: { inline_keyboard: [[{ text: '✅ Опубликовано в канал', callback_data: 'noop' }]] }
        });
      }
    } else {
      await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: `❌ Ошибка публикации: ${res.description}` });
    }
    return;
  }

  if (data.startsWith('reroll:')) {
    const draftId = data.slice(7);
    const draft = env.NEWS_KV ? await env.NEWS_KV.get(`draft:${draftId}`, 'json') : null;
    if (!draft) {
      await runPipeline(env, { toAdminDraft: true });
      return;
    }
    const nextStyle = STYLES[(STYLES.indexOf(draft.style) + 1) % STYLES.length];
    try {
      const gen = await generatePostWithGemini(env, draft.news, nextStyle);
      const imageObj = await generateCoverImage(env, gen.image_prompt);
      const caption = formatCaption(draft.news, gen, nextStyle);
      const newId = crypto.randomUUID().slice(0, 8);
      const kb = {
        inline_keyboard: [
          [
            { text: '✅ В канал', callback_data: `pub:${newId}` },
            { text: '🔄 Переписать', callback_data: `reroll:${newId}` }
          ],
          [{ text: '🗑 Отмена', callback_data: `drop:${newId}` }]
        ]
      };
      const res = await sendPostToChat(env.TELEGRAM_BOT_TOKEN, chatId, caption, imageObj, kb);
      if (res.ok && env.NEWS_KV) {
        const photos = res.result?.photo;
        const photoFileId = Array.isArray(photos) && photos.length ? photos[photos.length - 1].file_id : '';
        await env.NEWS_KV.delete(`draft:${draftId}`);
        await env.NEWS_KV.put(`draft:${newId}`, JSON.stringify({
          caption,
          photoFileId,
          news: draft.news,
          style: nextStyle
        }), { expirationTtl: 86400 });
      }
    } catch (e) {
      await tgCall(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: `⚠️ Ошибка перегенерации: ${e.message}` });
    }
    return;
  }

  if (data.startsWith('drop:')) {
    const draftId = data.slice(5);
    if (env.NEWS_KV) await env.NEWS_KV.delete(`draft:${draftId}`);
    if (msgId) {
      await tgCall(env.TELEGRAM_BOT_TOKEN, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '🗑 Отменено', callback_data: 'noop' }]] }
      });
    }
  }
}
