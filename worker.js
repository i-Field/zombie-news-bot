const GEMINI_TEXT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

const RSS_SOURCES = {
  world: [
    'https://lenta.ru/rss/news',
    'https://meduza.io/rss/all',
    'https://www.bbc.com/russian/index.xml',
  ],
  crypto: [
    'https://bits.media/rss2/',
    'https://forklog.com/feed/',
  ],
  tech: [
    'https://habr.com/ru/rss/news/?fl=ru',
    'https://3dnews.ru/news/rss/',
  ],
  showbiz: [
    'https://www.intermedia.ru/rss/news.xml',
    'https://lenta.ru/rss/news/culture',
  ],
  weird: [
    'https://www.reddit.com/r/nottheonion/hot.json?limit=10',
    'https://lenta.ru/rss/news/life',
  ],
};

const COOKIE_PACKS = {
  cookie_50: {
    id: 'cookie_50',
    stars: 50,
    cookies: 5,
    isBanquet: false,
    title: 'Коробка печенья для студии',
    desc: '5 хрустящих печенек для Zombie-DJ и Дяди Коли Мертвеца.',
  },
  cookie_150: {
    id: 'cookie_150',
    stars: 150,
    cookies: 18,
    isBanquet: false,
    title: 'Ящик печенья и кофе в эфир',
    desc: '18 печенек и бодрый эспрессо на ночную смену диджеев.',
  },
  cookie_500: {
    id: 'cookie_500',
    stars: 500,
    cookies: 75,
    isBanquet: false,
    title: 'Продюсерский кейс печенья',
    desc: '75 печенек и статус главного спонсора ночного эфира.',
  },
  banquet_10000: {
    id: 'banquet_10000',
    stars: 10000,
    cookies: 2000,
    isBanquet: true,
    title: 'Банкет для диджеев',
    desc: 'Легендарный банкет на всю студию Zombie News Flava.',
  },
};

// Isolate RAM caches to keep Cloudflare KV writes minimal on Free Tier
const RAM_CHATS = new Map();
const RAM_STATS = { data: null, ts: 0 };
const RAM_RATE = new Map();
const RAM_BOT = { username: '' };
const RAM_TRACE = [];

const MAX_RAM_CHATS = 120;
const KV_FLUSH_INTERVAL_MS = 180000; // max 1 KV write per 3 min per active chat

function addTrace(entry) {
  RAM_TRACE.unshift({ ts: new Date().toISOString(), ...entry });
  if (RAM_TRACE.length > 10) RAM_TRACE.length = 10;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/') {
        const stats = await loadStats(env);
        return new Response(renderHtml(env, stats), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (request.method === 'GET' && path === '/setup') {
        return handleSetup(request, env);
      }

      if (request.method === 'GET' && path === '/debug') {
        return handleDebug(request, env);
      }

      if (request.method === 'GET' && path === '/run') {
        const secret = url.searchParams.get('secret') || '';
        if (env.RUN_SECRET && secret !== env.RUN_SECRET) {
          return jsonResp({ ok: false, error: 'Forbidden' }, 403);
        }
        const force = url.searchParams.get('force') === '1';
        const res = await runNewsEdition(env, { force, targetChat: env.TELEGRAM_CHAT_ID });
        return jsonResp(res, res.ok ? 200 : 500);
      }

      if (request.method === 'GET' && path === '/api/state') {
        const stats = await loadStats(env);
        return jsonResp({ ok: true, stats, projects: getEcosystem(env) });
      }

      if (request.method === 'POST' && path === '/api/free-cookie') {
        const ip = request.headers.get('CF-Connecting-IP') || 'anon';
        if (!allowRate('fc:' + ip, 1500)) {
          return jsonResp({ ok: true, throttled: true });
        }
        const body = await safeJson(request);
        const delta = Math.max(1, Math.min(25, Number(body && body.count) || 1));
        const stats = await updateStats(env, (s) => {
          s.freeCookies = (s.freeCookies || 0) + delta;
        });
        return jsonResp({ ok: true, stats });
      }

      if (request.method === 'POST' && path === '/api/react') {
        const ip = request.headers.get('CF-Connecting-IP') || 'anon';
        if (!allowRate('react:' + ip, 1200)) {
          return jsonResp({ ok: false, error: 'Too fast' }, 429);
        }
        const body = await safeJson(request);
        const kind = body && body.kind;
        if (!['fire', 'zombie', 'guitar'].includes(kind)) {
          return jsonResp({ ok: false, error: 'Invalid reaction' }, 400);
        }
        const stats = await updateStats(env, (s) => {
          if (!s.reacts) s.reacts = { fire: 0, zombie: 0, guitar: 0 };
          s.reacts[kind] = (s.reacts[kind] || 0) + 1;
        });
        return jsonResp({ ok: true, stats });
      }

      if (request.method === 'POST' && path === '/api/suggest') {
        const body = await safeJson(request);
        const topic = String((body && body.topic) || '').trim().slice(0, 180);
        const author = String((body && body.author) || 'Слушатель').trim().slice(0, 48);
        if (topic.length < 4) {
          return jsonResp({ ok: false, error: 'Тема слишком короткая' }, 400);
        }
        const ip = request.headers.get('CF-Connecting-IP') || 'anon';
        if (!allowRate('sug:' + ip, 900000)) {
          return jsonResp({ ok: false, error: 'Подожди 15 минут перед следующей темой' }, 429);
        }
        if (env.NEWS_KV) {
          const list = (await env.NEWS_KV.get('suggestions', 'json')) || [];
          list.unshift({ topic, author, ts: Date.now() });
          await env.NEWS_KV.put('suggestions', JSON.stringify(list.slice(0, 30)));
        }
        if (env.ADMIN_CHAT_ID && env.TELEGRAM_BOT_TOKEN) {
          ctx.waitUntil(
            tgCall(env, 'sendMessage', {
              chat_id: env.ADMIN_CHAT_ID,
              text: '💡 Новая тема от ' + author + ':\n' + topic,
            })
          );
        }
        return jsonResp({ ok: true });
      }

      if (request.method === 'POST' && path === '/api/cookie-invoice') {
        const body = await safeJson(request);
        const packId = String((body && body.packId) || 'cookie_50');
        const pack = COOKIE_PACKS[packId];
        if (!pack) return jsonResp({ ok: false, error: 'Unknown pack' }, 400);

        const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        if (env.NEWS_KV) {
          await env.NEWS_KV.put(
            'inv:' + nonce,
            JSON.stringify({ packId: pack.id, stars: pack.stars, used: false }),
            { expirationTtl: 3600 }
          );
        }

        const linkRes = await tgCall(env, 'createInvoiceLink', {
          title: pack.title,
          description: pack.desc,
          payload: JSON.stringify({ packId: pack.id, nonce }),
          currency: 'XTR',
          prices: [{ label: pack.title, amount: pack.stars }],
        });

        if (!linkRes.ok || !linkRes.result) {
          return jsonResp({ ok: false, error: linkRes.description || 'Invoice error' }, 500);
        }
        return jsonResp({ ok: true, invoiceUrl: linkRes.result, nonce });
      }

      if (request.method === 'POST' && path === '/api/cookie-confirm') {
        const body = await safeJson(request);
        const nonce = String((body && body.nonce) || '');
        if (!nonce || !env.NEWS_KV) {
          return jsonResp({ ok: false, error: 'Invalid nonce' }, 400);
        }
        const inv = await env.NEWS_KV.get('inv:' + nonce, 'json');
        if (!inv) return jsonResp({ ok: false, error: 'Invoice not found' }, 404);
        if (inv.used) {
          const stats = await loadStats(env);
          return jsonResp({ ok: true, alreadyCounted: true, stats });
        }
        const pack = COOKIE_PACKS[inv.packId] || COOKIE_PACKS.cookie_50;
        inv.used = true;
        await env.NEWS_KV.put('inv:' + nonce, JSON.stringify(inv), { expirationTtl: 3600 });
        const stats = await updateStats(env, (s) => {
          s.paidCookies = (s.paidCookies || 0) + pack.cookies;
          s.starsTotal = (s.starsTotal || 0) + pack.stars;
          if (pack.isBanquet) s.banquets = (s.banquets || 0) + 1;
        });
        return jsonResp({ ok: true, stats });
      }

      if (request.method === 'POST' && path === '/webhook') {
        const expectedSecret = await getWebhookSecret(env);
        const gotSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (expectedSecret && gotSecret && gotSecret !== expectedSecret) {
          addTrace({ stage: 'webhook_401', info: 'Secret mismatch — run /setup' });
          return new Response('Unauthorized', { status: 401 });
        }
        const update = await safeJson(request);
        if (update) {
          ctx.waitUntil(handleTelegramUpdate(env, update, url.origin));
        }
        return new Response('OK', { status: 200 });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResp({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNewsEdition(env, { force: false, targetChat: env.TELEGRAM_CHAT_ID }));
  },
};

// ---------------- SETUP & DEBUG ----------------

async function getWebhookSecret(env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return '';
  const data = new TextEncoder().encode('znb:' + env.TELEGRAM_BOT_TOKEN);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function handleSetup(request, env) {
  const origin = new URL(request.url).origin;
  const webhookUrl = origin + '/webhook';
  const secretToken = await getWebhookSecret(env);

  const wh = await tgCall(env, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken || undefined,
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
    drop_pending_updates: false,
  });

  const me = await tgCall(env, 'getMe', {});
  if (me && me.result && me.result.username) {
    RAM_BOT.username = me.result.username.toLowerCase();
  }

  const privateCommands = [
    { command: 'start', description: 'Открыть студию и игры' },
    { command: 'games', description: 'Все боты и игры i-Field' },
    { command: 'roast', description: 'Прожарка от Zombie-DJ' },
    { command: 'cookie', description: 'Угостить диджеев печеньем' },
    { command: 'ping', description: 'Проверка связи и AI' },
  ];

  const groupCommands = [
    { command: 'roast', description: 'Прожарить участников чата' },
    { command: 'news', description: 'Свежая новость для чата' },
    { command: 'games', description: 'Во что сыграем?' },
    { command: 'cookie', description: 'Угостить диджеев' },
    { command: 'ping', description: 'Проверить слух и AI бота' },
  ];

  const cmdDefault = await tgCall(env, 'setMyCommands', { commands: privateCommands });
  const cmdGroup = await tgCall(env, 'setMyCommands', {
    commands: groupCommands,
    scope: { type: 'all_group_chats' },
  });

  if (env.TELEGRAM_BOT_TOKEN) {
    await tgCall(env, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Студия',
        web_app: { url: origin + '/' },
      },
    });
  }

  return jsonResp({
    ok: wh.ok,
    bot: me.result ? '@' + me.result.username : null,
    canReadAllGroupMessages: me.result ? Boolean(me.result.can_read_all_group_messages) : null,
    webhookUrl,
    hasKV: Boolean(env.NEWS_KV),
    hasAI: Boolean(env.AI),
    hasGemini: Boolean(env.GEMINI_API_KEY),
    webhook: wh,
    commandsDefault: cmdDefault.ok,
    commandsGroup: cmdGroup.ok,
  });
}

async function handleDebug(request, env) {
  const me = await tgCall(env, 'getMe', {});
  const whInfo = await tgCall(env, 'getWebhookInfo', {});

  let geminiTest = 'no key';
  let availableModels = [];
  if (env.GEMINI_API_KEY) {
    try {
      const mRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(6000),
      });
      if (mRes.ok) {
        const mj = await mRes.json();
        availableModels = (mj.models || [])
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => n.includes('gemini'))
          .slice(0, 12);
      }
    } catch (_) {}

    try {
      const t0 = Date.now();
      const g = await callGeminiText(env, {
        systemInstruction: 'Ответь одним словом: Работает.',
        prompt: 'Тест.',
        json: false,
      });
      geminiTest = 'OK (' + g.model + ', ' + (Date.now() - t0) + 'ms)';
    } catch (e) {
      geminiTest = 'ERROR: ' + String(e.message || e);
    }
  }

  return jsonResp({
    ok: true,
    bot: me.result || me,
    webhookInfo: whInfo.result || whInfo,
    geminiTest,
    availableModels,
    ramChatsCount: RAM_CHATS.size,
    recentTrace: RAM_TRACE,
  });
}

// ---------------- ECOSYSTEM (ALL TELEGRAM BOTS) ----------------

function resolveLink(val, fallback) {
  const v = String(val || '').trim();
  if (!v) return fallback;
  if (v.startsWith('@')) return 'https://t.me/' + v.slice(1);
  if (v.startsWith('t.me/')) return 'https://' + v;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return fallback;
}

function getEcosystem(env) {
  const botUser = String(env.BOT_USERNAME || RAM_BOT.username || 'zombie_rap_news_bot').replace(/^@/, '');
  const channelUser = String(env.CHANNEL_USERNAME || 'zombie_news_flava').replace(/^@/, '');
  return {
    botUser,
    channelUser,
    channelUrl: 'https://t.me/' + channelUser,
    botUrl: 'https://t.me/' + botUser,
    projects: [
      {
        id: 'forest5x5',
        name: 'Forest Fortune 5x5',
        desc: 'Сказочный каскадный слот-лес 5x5 с духами, комбо и бонус-раундами.',
        url: resolveLink(env.SLOTS_BOT || env.SLOTS_URL, 'https://t.me/ForestFortuneVegasBot'),
        cta: 'Крутить 5x5',
      },
      {
        id: 'durak',
        name: 'Дурак Империя',
        desc: 'Подкидной Дурак: проверка блефа, козырей и удачи за столом.',
        url: resolveLink(env.DURAK_BOT || env.DURAK_URL, 'https://t.me/durak_empire_bot'),
        cta: 'Срубить в Дурака',
      },
      {
        id: 'roger',
        name: 'Lucky Rodger Slot',
        desc: 'Пиратский азарт, сундуки с золотом и быстрые спины.',
        url: resolveLink(env.ROGER_BOT || env.ROGER_URL, 'https://t.me/LUCKY_RODGER_BOT'),
        cta: 'К Роджеру',
      },
      {
        id: 'empire',
        name: 'Khutor Empire',
        desc: 'Развивай свой хутор, строй империю и собирай ресурсы.',
        url: resolveLink(env.EMPIRE_BOT || env.EMPIRE_URL, 'https://t.me/KhutorEmpireBot'),
        cta: 'В Империю',
      },
      {
        id: 'forest',
        name: 'Forest Fortune Classic',
        desc: 'Классическая версия волшебного лесного слота.',
        url: resolveLink(env.FOREST_CLASSIC_BOT, 'https://t.me/Forest_Fortune_Bot'),
        cta: 'Открыть слот',
      },
      {
        id: 'studio',
        name: 'iField Studio',
        desc: 'Креативная мастерская, музыка и визуальные проекты i-Field.',
        url: resolveLink(env.STUDIO_BOT, 'https://t.me/ifield_studio_bot'),
        cta: 'В Студию',
      },
      {
        id: 'chat',
        name: 'iField Chat',
        desc: 'Умный AI-собеседник и цифровой помощник экосистемы.',
        url: resolveLink(env.CHAT_BOT, 'https://t.me/chat_ifield_bot'),
        cta: 'Открыть чат',
      },
    ],
  };
}

// ---------------- TELEGRAM UPDATES ----------------

async function handleTelegramUpdate(env, update, origin) {
  if (update.pre_checkout_query) {
    await tgCall(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true,
    });
    return;
  }

  if (update.callback_query) {
    await handleCallback(env, update.callback_query, origin);
    return;
  }

  const msg = update.message || update.edited_message;
  if (!msg) return;

  if (msg.successful_payment) {
    await handleSuccessfulPayment(env, msg);
    return;
  }

  const chat = msg.chat || {};
  const chatType = chat.type || 'private';
  addTrace({
    stage: 'incoming',
    chatType,
    chatId: chat.id,
    fromId: msg.from && msg.from.id,
    isBot: Boolean(msg.from && msg.from.is_bot),
    text: String(msg.text || msg.caption || (msg.new_chat_members ? '[new_members]' : '[non-text]')).slice(0, 60),
  });

  if (chatType === 'group' || chatType === 'supergroup') {
    await handleGroupMessage(env, msg, origin);
    return;
  }

  if (chatType === 'private') {
    await handlePrivateMessage(env, msg, origin);
  }
}

async function handleSuccessfulPayment(env, msg) {
  let payload = {};
  try {
    payload = JSON.parse(msg.successful_payment.invoice_payload || '{}');
  } catch (_) {}
  const pack = COOKIE_PACKS[payload.packId] || COOKIE_PACKS.cookie_50;

  let alreadyCounted = false;
  if (payload.nonce && env.NEWS_KV) {
    const inv = await env.NEWS_KV.get('inv:' + payload.nonce, 'json');
    if (inv && inv.used) alreadyCounted = true;
    else if (inv) {
      inv.used = true;
      await env.NEWS_KV.put('inv:' + payload.nonce, JSON.stringify(inv), { expirationTtl: 3600 });
    }
  }

  if (!alreadyCounted) {
    await updateStats(env, (s) => {
      s.paidCookies = (s.paidCookies || 0) + pack.cookies;
      s.starsTotal = (s.starsTotal || 0) + pack.stars;
      if (pack.isBanquet) s.banquets = (s.banquets || 0) + 1;
    });
  }

  const name = escapeHtml((msg.from && msg.from.first_name) || 'Братишка');
  const txt = pack.isBanquet
    ? '🥂 <b>ЛЕГЕНДАРНЫЙ БАНКЕТ!</b>\n' + name + ', вся студия Zombie News Flava стоя аплодирует! Заряд: +' + pack.cookies + ' печенек.'
    : '🍪 <b>Спасибо за подгон, ' + name + '!</b>\nСтудия получила +' + pack.cookies + ' печенек. Биты стали качать громче!';

  await tgCall(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: txt,
    parse_mode: 'HTML',
  });
}

async function handleCallback(env, cq, origin) {
  const data = String(cq.data || '');
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const chatType = cq.message && cq.message.chat && cq.message.chat.type;
  const isPrivate = chatType === 'private';

  await tgCall(env, 'answerCallbackQuery', { callback_query_id: cq.id });

  if (!chatId) return;

  if (data.startsWith('cookie_buy:')) {
    const packId = data.split(':')[1];
    const pack = COOKIE_PACKS[packId];
    if (!pack) return;
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    if (env.NEWS_KV) {
      await env.NEWS_KV.put('inv:' + nonce, JSON.stringify({ packId: pack.id, stars: pack.stars, used: false }), {
        expirationTtl: 3600,
      });
    }
    await tgCall(env, 'sendInvoice', {
      chat_id: chatId,
      title: pack.title,
      description: pack.desc,
      payload: JSON.stringify({ packId: pack.id, nonce }),
      currency: 'XTR',
      prices: [{ label: pack.title, amount: pack.stars }],
    });
    return;
  }

  if (data === 'show_games') {
    await sendGamesMenu(env, chatId, isPrivate, origin);
    return;
  }

  if (data === 'show_cookies') {
    await sendCookieMenu(env, chatId, isPrivate, origin);
    return;
  }

  if (data === 'group_roast') {
    await sendGroupRoast(env, chatId, cq.from, origin, isPrivate);
    return;
  }

  if (data === 'group_news') {
    await sendGroupNews(env, chatId, origin, isPrivate);
  }
}

// ---------------- PRIVATE DM CHAT ----------------

async function handlePrivateMessage(env, msg, origin) {
  const chatId = msg.chat.id;
  const text = String(msg.text || msg.caption || '').trim();
  if (!text) return;

  const cmd = text.split(/\s+/)[0].toLowerCase().split('@')[0];

  if (cmd === '/start') {
    const eco = getEcosystem(env);
    const name = escapeHtml((msg.from && msg.from.first_name) || 'слушатель');
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text:
        '🧟‍♂️ <b>Салют, ' + name + '! На связи Zombie-DJ и Дядя Коля Мертвец.</b>\n\n' +
        'Можешь просто писать мне сюда любым текстом — поболтаем, разберём новости, сделаю прожарку или подкину игру.\n\n' +
        '• <b>/games</b> — все твои боты и игры i-Field\n' +
        '• <b>/roast</b> — зачитать прожарку\n' +
        '• <b>/cookie</b> — угостить студию печеньем\n' +
        '• <b>/ping</b> — проверить связь и AI',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎛 Открыть Студию и Игры', web_app: { url: origin + '/' } }],
          [
            { text: '🎮 Боты i-Field (7)', callback_data: 'show_games' },
            { text: '🍪 Угостить диджеев', callback_data: 'show_cookies' },
          ],
          [{ text: '📢 Канал @' + eco.channelUser, url: eco.channelUrl }],
        ],
      },
    });
    return;
  }

  if (cmd === '/ping') {
    await handlePingCommand(env, msg, text);
    return;
  }

  if (cmd === '/games' || cmd === '/projects') {
    await sendGamesMenu(env, chatId, true, origin);
    return;
  }

  if (cmd === '/cookie') {
    await sendCookieMenu(env, chatId, true, origin);
    return;
  }

  if (cmd === '/roast') {
    await sendGroupRoast(env, chatId, msg.from, origin, true);
    return;
  }

  if (cmd === '/draft') {
    if (env.ADMIN_CHAT_ID && String(msg.from && msg.from.id) !== String(env.ADMIN_CHAT_ID)) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: '⛔ Команда только для админа студии.' });
      return;
    }
    await tgCall(env, 'sendMessage', { chat_id: chatId, text: '🎙 Собираю черновик выпуска для тебя...' });
    const res = await runNewsEdition(env, { force: true, targetChat: chatId });
    if (!res.ok) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: '⚠️ Не вышло: ' + (res.error || 'ошибка') });
    }
    return;
  }

  if (!allowRate('dm:' + chatId, 1800)) return;
  await tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  const memKey = 'dm:' + chatId;
  const state = await getChatMem(env, memKey);
  const userName = (msg.from && (msg.from.first_name || msg.from.username)) || 'Слушатель';
  pushChatLine(state, userName, text);

  try {
    const aiOut = await generateChatReply(env, 'private', state, text, userName);
    pushChatLine(state, aiOut.persona === 'kolya' ? 'Дядя Коля' : 'Zombie-DJ', aiOut.reply);
    await flushChatMem(env, memKey, state, false);

    const prefix = aiOut.persona === 'kolya' ? '🎸 <b>Дядя Коля:</b> ' : '🎤 <b>Zombie-DJ:</b> ';
    const sent = await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: prefix + escapeHtml(aiOut.reply),
      parse_mode: 'HTML',
      reply_markup: buildCtaMarkup(env, origin, aiOut.cta, true),
    });
    addTrace({ stage: 'dm_reply', ok: sent.ok, err: sent.description || null });
  } catch (err) {
    addTrace({ stage: 'dm_err', err: String(err.message || err) });
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: '⚠️ Студийный AI не ответил: ' + String(err.message || err).slice(0, 160),
    });
  }
}

// ---------------- GROUP AI ENGINE ----------------

async function handleGroupMessage(env, msg, origin) {
  const chatId = msg.chat.id;
  const memKey = 'grp:' + chatId;

  // 1. Greet new chat members
  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length > 0) {
    const humans = msg.new_chat_members.filter((u) => !u.is_bot);
    if (humans.length > 0) {
      const names = humans.map((u) => escapeHtml(u.first_name || u.username || 'боец')).join(', ');
      const eco = getEcosystem(env);
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '🧟‍♂️ О, свежая кровь в эфире — салют, <b>' + names + '</b>!\n' +
          'Мы тут с Дядей Колей крутим новости, делаем прожарки и рубимся в игры.\n\n' +
          'Можете звать меня по имени («Зомби», «Дядя Коля», @' + eco.botUser + ') или сразу залетать:',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🃏 Дурак Империя', url: eco.projects[1].url },
              { text: '🌲 Forest 5x5', url: eco.projects[0].url },
            ],
            [
              { text: '🔥 Прожарить чат', callback_data: 'group_roast' },
              { text: '🎮 Все боты', callback_data: 'show_games' },
            ],
          ],
        },
      });
    }
    return;
  }

  // Allow anonymous admins (GroupAnonymousBot id 1087968824), ignore other bots
  if (msg.from && msg.from.is_bot && Number(msg.from.id) !== 1087968824) return;

  const text = String(msg.text || msg.caption || '').trim();
  if (!text) return;

  if (!RAM_BOT.username && !env.BOT_USERNAME && env.TELEGRAM_BOT_TOKEN) {
    const me = await tgCall(env, 'getMe', {});
    if (me && me.result && me.result.username) RAM_BOT.username = me.result.username.toLowerCase();
  }
  const botUsername = String(env.BOT_USERNAME || RAM_BOT.username || 'zombie_rap_news_bot')
    .replace(/^@/, '')
    .toLowerCase();

  const rawCmd = text.split(/\s+/)[0].toLowerCase();
  const cmdParts = rawCmd.split('@');
  const cmd = cmdParts[0];
  const cmdTarget = cmdParts[1] || '';

  if (cmdTarget && cmdTarget !== botUsername) return;

  if (cmd === '/ping') {
    await handlePingCommand(env, msg, text);
    return;
  }
  if (cmd === '/games' || cmd === '/projects') {
    await sendGamesMenu(env, chatId, false, origin);
    return;
  }
  if (cmd === '/cookie') {
    await sendCookieMenu(env, chatId, false, origin);
    return;
  }
  if (cmd === '/roast') {
    await sendGroupRoast(env, chatId, msg.from, origin, false);
    return;
  }
  if (cmd === '/news') {
    await sendGroupNews(env, chatId, origin, false);
    return;
  }
  if (cmd.startsWith('/')) return;

  // Record incoming human message in RAM first (0 KV writes!)
  const state = await getChatMem(env, memKey);
  const authorName =
    (msg.sender_chat && msg.sender_chat.title) ||
    (msg.from && Number(msg.from.id) !== 1087968824 && (msg.from.first_name || msg.from.username)) ||
    'Участник';
  pushChatLine(state, authorName, text);
  state.msgSinceBot = (state.msgSinceBot || 0) + 1;

  const decision = shouldReplyInGroup(msg, text, state, botUsername);
  addTrace({
    stage: 'group_eval',
    reply: decision.reply,
    direct: decision.direct,
    msgSinceBot: state.msgSinceBot,
  });
  if (!decision.reply) return;

  const now = Date.now();
  if (!decision.direct && now - (state.lastBotAt || 0) < 8000) return;

  try {
    await tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    const aiOut = await generateChatReply(env, 'group', state, text, authorName);

    state.lastBotAt = Date.now();
    state.msgSinceBot = 0;
    pushChatLine(state, aiOut.persona === 'kolya' ? 'Дядя Коля' : 'Zombie-DJ', aiOut.reply);

    // Flush to KV at most once every 3 minutes
    await flushChatMem(env, memKey, state, false);

    const prefix = aiOut.persona === 'kolya' ? '🎸 <b>Дядя Коля:</b> ' : '🎤 <b>Zombie-DJ:</b> ';
    const sent = await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: prefix + escapeHtml(aiOut.reply),
      parse_mode: 'HTML',
      reply_to_message_id: decision.direct ? msg.message_id : undefined,
      reply_markup: buildCtaMarkup(env, origin, aiOut.cta, false),
    });
    addTrace({ stage: 'group_sent', ok: sent.ok, err: sent.description || null });
  } catch (err) {
    addTrace({ stage: 'group_err', err: String(err.message || err) });
    if (decision.direct) {
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: msg.message_id,
        text: '⚠️ Микрофон сбоит: ' + String(err.message || err).slice(0, 150),
      });
    }
  }
}

function shouldReplyInGroup(msg, text, state, botUsername) {
  const lower = text.toLowerCase();
  const replyUser = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.username;
  const isReplyToBot = Boolean(replyUser && replyUser.toLowerCase() === botUsername);
  const isMention = lower.includes('@' + botUsername);

  const hasTriggerWord = /(^|[^а-яёa-z0-9])(зомби|коля|колян|мертвец|диджей|dj|бот|нейросет|дурак|картишк|слот|роджер|фортун|хутор|импери|игр|музык|рэп|шансон|трек|новост|скучно|прожар|печень|банкет|привет|салют|здаров|здорово|кто тут|че как|что нового|как дела|погнали|сыграем|поболтаем)([^а-яёa-z0-9]|$)/i.test(
    lower
  );

  if (isReplyToBot || isMention) {
    return { reply: true, direct: true };
  }

  const now = Date.now();
  const elapsed = now - (state.lastBotAt || 0);

  if (hasTriggerWord && elapsed >= 15000) {
    return { reply: true, direct: true };
  }

  if (text.includes('?') && text.length >= 6 && (state.msgSinceBot || 0) >= 2 && elapsed >= 25000) {
    return { reply: true, direct: false };
  }

  if (text.length >= 4 && (state.msgSinceBot || 0) >= 3 && elapsed >= 30000) {
    return { reply: true, direct: false };
  }

  return { reply: false, direct: false };
}

async function handlePingCommand(env, msg, text) {
  const chatId = msg.chat.id;
  const memKey = (msg.chat.type === 'private' ? 'dm:' : 'grp:') + chatId;
  const mem = RAM_CHATS.get(memKey);
  const testAi = text.toLowerCase().includes('ai');

  let aiDiag = env.GEMINI_API_KEY ? 'ключ есть' : 'НЕТ GEMINI_API_KEY';
  if (testAi && env.GEMINI_API_KEY) {
    const t0 = Date.now();
    try {
      const r = await callGeminiText(env, {
        systemInstruction: 'Ответь одним коротким словом: Принято.',
        prompt: 'Проверка связи.',
        json: false,
      });
      aiDiag = 'OK (' + r.model + ', ' + (Date.now() - t0) + 'ms)';
    } catch (e) {
      aiDiag = 'ОШИБКА: ' + String(e.message || e).slice(0, 140);
    }
  }

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    reply_to_message_id: msg.message_id,
    text:
      '📡 <b>Диагностика студии</b>\n' +
      '• Чат: <code>' + msg.chat.type + '</code>\n' +
      '• В памяти RAM: ' + (mem ? mem.msgs.length : 0) + ' сообщ.\n' +
      '• KV: ' + (env.NEWS_KV ? 'подключён' : 'нет') + '\n' +
      '• Gemini: ' + escapeHtml(aiDiag) + '\n' +
      (testAi ? '' : '\n💡 Напиши <code>/ping ai</code> чтобы проверить живой ответ нейросети.'),
    parse_mode: 'HTML',
  });
}

// ---------------- RAM-FIRST CHAT MEMORY ----------------

async function getChatMem(env, key) {
  let state = RAM_CHATS.get(key);
  if (state) return state;

  let loaded = null;
  if (env.NEWS_KV) {
    try {
      loaded = await env.NEWS_KV.get(key, 'json');
    } catch (_) {}
  }

  state = {
    msgs: Array.isArray(loaded && loaded.msgs) ? loaded.msgs.slice(-14) : [],
    msgSinceBot: Number(loaded && loaded.msgSinceBot) || 0,
    lastBotAt: Number(loaded && loaded.lastBotAt) || 0,
    lastKvWriteAt: Date.now(),
  };

  if (RAM_CHATS.size >= MAX_RAM_CHATS) {
    const oldestKey = RAM_CHATS.keys().next().value;
    if (oldestKey) RAM_CHATS.delete(oldestKey);
  }
  RAM_CHATS.set(key, state);
  return state;
}

function pushChatLine(state, name, text) {
  state.msgs.push({
    n: String(name || 'Юзер').slice(0, 28),
    t: String(text || '').replace(/\s+/g, ' ').slice(0, 220),
  });
  if (state.msgs.length > 14) {
    state.msgs = state.msgs.slice(-14);
  }
}

async function flushChatMem(env, key, state, force) {
  if (!env.NEWS_KV) return;
  const now = Date.now();
  if (!force && now - (state.lastKvWriteAt || 0) < KV_FLUSH_INTERVAL_MS) {
    return;
  }
  state.lastKvWriteAt = now;
  try {
    await env.NEWS_KV.put(
      key,
      JSON.stringify({
        msgs: state.msgs.slice(-14),
        msgSinceBot: state.msgSinceBot || 0,
        lastBotAt: state.lastBotAt || 0,
      }),
      { expirationTtl: 604800 }
    );
  } catch (e) {
    console.error('KV flush error:', e);
  }
}

// ---------------- AI CONVERSATION ----------------

async function generateChatReply(env, mode, state, currentText, authorName) {
  const history = state.msgs.map((m) => m.n + ': ' + m.t).join('\n');
  const systemInstruction =
    'Ты — дуэт ведущих Telegram-студии Zombie News Flava: Zombie-DJ (дерзкий уличный рэпер и битмейкер) и Дядя Коля Мертвец (ироничный ветеран кибер-шансона).\n' +
    'Режим: ' + (mode === 'private' ? 'личная переписка 1-на-1 с пользователем' : 'живой групповой чат') + '.\n' +
    'Правила:\n' +
    '1. Выбери, кто сейчас отвечает: "zombie" или "kolya".\n' +
    '2. Отвечай живо, коротко (2–4 предложения), по-русски, с юмором и учётом имён и контекста переписки.\n' +
    '3. Никогда не звучи как скучный справочный ассистент. Не повторяй чужие слова дословно.\n' +
    '4. Иногда, когда это органично по разговору (скука, азарт, карты, стратегия, общение, новости), можешь предложить кнопку:\n' +
    '   - "durak": Дурак Империя (картишки)\n' +
    '   - "slots": Forest Fortune 5x5 (слоты)\n' +
    '   - "forest": Forest Fortune Classic\n' +
    '   - "roger": Lucky Rodger Slot (пиратский слот)\n' +
    '   - "empire": Khutor Empire (империя хутора)\n' +
    '   - "ifield_studio": iField Studio\n' +
    '   - "ifield_chat": iField Chat\n' +
    '   - "news": свежая новость дня\n' +
    '   - "studio": открыть нашу Zombie Студию\n' +
    '   - "cookie": угостить диджеев печеньем\n' +
    '   - "none": если кнопка сейчас не нужна (чаще используй "none" в обычной болтовне!).\n' +
    'Верни СТРОГО JSON формата: {"persona":"zombie"|"kolya","reply":"текст ответа","cta":"none"|"durak"|"slots"|"forest"|"roger"|"empire"|"ifield_studio"|"ifield_chat"|"news"|"studio"|"cookie"}.';

  const prompt =
    'Последние реплики:\n' + history + '\n\nТекущее сообщение от ' + authorName + ':\n' + currentText;

  const res = await callGeminiText(env, {
    systemInstruction,
    prompt,
    json: true,
    thinkingLevel: 'LOW',
  });

  const parsed = parseJsonSafe(res.text);
  if (parsed && parsed.reply) {
    return {
      persona: parsed.persona === 'kolya' ? 'kolya' : 'zombie',
      reply: String(parsed.reply).slice(0, 750),
      cta: String(parsed.cta || 'none'),
    };
  }
  return {
    persona: 'zombie',
    reply: String(res.text || 'На связи!').replace(/[{}"]/g, '').slice(0, 750),
    cta: 'none',
  };
}

function buildCtaMarkup(env, origin, cta, isPrivate) {
  const eco = getEcosystem(env);
  if (!cta || cta === 'none') return undefined;

  const byId = {};
  for (const p of eco.projects) byId[p.id] = p;

  if (cta === 'slots' && byId.forest5x5) {
    return { inline_keyboard: [[{ text: '🌲 ' + byId.forest5x5.name, url: byId.forest5x5.url }]] };
  }
  if (cta === 'durak' && byId.durak) {
    return { inline_keyboard: [[{ text: '🃏 ' + byId.durak.name, url: byId.durak.url }]] };
  }
  if (cta === 'roger' && byId.roger) {
    return { inline_keyboard: [[{ text: '🏴‍☠️ ' + byId.roger.name, url: byId.roger.url }]] };
  }
  if (cta === 'empire' && byId.empire) {
    return { inline_keyboard: [[{ text: '🏰 ' + byId.empire.name, url: byId.empire.url }]] };
  }
  if (cta === 'forest' && byId.forest) {
    return { inline_keyboard: [[{ text: '🌿 ' + byId.forest.name, url: byId.forest.url }]] };
  }
  if (cta === 'ifield_studio' && byId.studio) {
    return { inline_keyboard: [[{ text: '🎛 ' + byId.studio.name, url: byId.studio.url }]] };
  }
  if (cta === 'ifield_chat' && byId.chat) {
    return { inline_keyboard: [[{ text: '💬 ' + byId.chat.name, url: byId.chat.url }]] };
  }
  if (cta === 'news') {
    return {
      inline_keyboard: [
        [
          { text: '📰 Свежая новость', callback_data: 'group_news' },
          { text: '📢 Канал', url: eco.channelUrl },
        ],
      ],
    };
  }
  if (cta === 'cookie') {
    return { inline_keyboard: [[{ text: '🍪 Угостить диджеев', callback_data: 'show_cookies' }]] };
  }
  if (cta === 'studio') {
    return {
      inline_keyboard: [
        [isPrivate ? { text: '🎛 Открыть Студию', web_app: { url: origin + '/' } } : { text: '🎛 Открыть Студию', url: eco.botUrl }],
      ],
    };
  }
  return undefined;
}

// ---------------- GROUP ACTIONS: ROAST, NEWS, GAMES, COOKIES ----------------

async function sendGroupRoast(env, chatId, fromUser, origin, isPrivate) {
  if (!allowRate('roast:' + chatId, isPrivate ? 15000 : 120000)) {
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: '🔥 Микрофон ещё остывает после прошлой прожарки — подожди пару минут!',
    });
    return;
  }

  const memKey = (isPrivate ? 'dm:' : 'grp:') + chatId;
  const state = await getChatMem(env, memKey);
  const participants = Array.from(new Set(state.msgs.map((m) => m.n))).filter(
    (n) => n !== 'Zombie-DJ' && n !== 'Дядя Коля'
  );
  const fallbackName = (fromUser && (fromUser.first_name || fromUser.username)) || 'чат';
  const listNames = participants.length ? participants.join(', ') : fallbackName;

  try {
    await tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    const aiRes = await callGeminiText(env, {
      systemInstruction:
        'Ты — Zombie-DJ. Напиши дерзкий, но добрый и смешной 6-строчный рэп-куплет (прожарку) про участников этого чата с учётом того, о чём они говорили. Без оскорблений и жести, только угар и харизма.',
      prompt: 'Участники: ' + listNames + '\nКонтекст:\n' + state.msgs.map((m) => m.n + ': ' + m.t).join('\n'),
      json: false,
      thinkingLevel: 'LOW',
    });

    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: '🎤 <b>ПРОЖАРКА ЧАТА от Zombie-DJ:</b>\n\n<i>' + escapeHtml(aiRes.text.slice(0, 900)) + '</i>',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔥 Ещё прожарку', callback_data: 'group_roast' },
            { text: '🎮 Игры', callback_data: 'show_games' },
          ],
        ],
      },
    });
  } catch (err) {
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: '⚠️ Не удалось зачитать прожарку: ' + String(err.message || err).slice(0, 120),
    });
  }
}

async function sendGroupNews(env, chatId, origin, isPrivate) {
  if (!allowRate('gnews:' + chatId, 180000)) {
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: '📰 Следующую горячую сводку можно вкинуть через 3 минуты.',
    });
    return;
  }

  const stats = await loadStats(env);
  if (stats.lastTrack && stats.lastTrack.headline) {
    const eco = getEcosystem(env);
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text:
        '📻 <b>Из свежей ленты @' + eco.channelUser + ':</b>\n\n' +
        '<b>' + escapeHtml(stats.lastTrack.headline) + '</b>\n\n' +
        '<i>' + escapeHtml(stats.lastTrack.lyrics || '') + '</i>\n\n' +
        '💬 Что думаете, народ? Или лучше в карты?',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🃏 В Дурака', url: eco.projects[1].url },
            { text: '📢 Весь канал', url: eco.channelUrl },
          ],
        ],
      },
    });
    return;
  }

  await tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  await runNewsEdition(env, { force: true, targetChat: chatId, saveLast: false });
}

async function sendGamesMenu(env, chatId, isPrivate, origin) {
  const eco = getEcosystem(env);
  const p = eco.projects;
  const rows = [
    [
      { text: '🌲 ' + p[0].name, url: p[0].url },
      { text: '🃏 ' + p[1].name, url: p[1].url },
    ],
    [
      { text: '🏴‍☠️ ' + p[2].name, url: p[2].url },
      { text: '🏰 ' + p[3].name, url: p[3].url },
    ],
    [
      { text: '🌿 ' + p[4].name, url: p[4].url },
      { text: '🎛 ' + p[5].name, url: p[5].url },
    ],
    [{ text: '💬 ' + p[6].name, url: p[6].url }],
  ];
  if (isPrivate) {
    rows.push([{ text: '🎙 Открыть Zombie Студию', web_app: { url: origin + '/' } }]);
  } else {
    rows.push([{ text: '🎙 Студия в боте', url: eco.botUrl }]);
  }

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text: '🎮 <b>Все боты и игры экосистемы i-Field:</b>\nВыбирай куда залетаем прямо сейчас!',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendCookieMenu(env, chatId, isPrivate, origin) {
  const eco = getEcosystem(env);
  const buttons = [
    [
      { text: '🍪 50 ⭐', callback_data: 'cookie_buy:cookie_50' },
      { text: '🍪 150 ⭐', callback_data: 'cookie_buy:cookie_150' },
      { text: '🍪 500 ⭐', callback_data: 'cookie_buy:cookie_500' },
    ],
    [{ text: '🥂 Банкет диджеям · 10 000 ⭐', callback_data: 'cookie_buy:banquet_10000' }],
  ];
  if (isPrivate) {
    buttons.push([{ text: '🎛 Открыть Банкет в Студии', web_app: { url: origin + '/' } }]);
  } else {
    buttons.push([{ text: '🎛 Зайти в Студию', url: eco.botUrl }]);
  }

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      '🍩 <b>Угостить Zombie-DJ и Дядю Колю</b>\n' +
      'Выбери размер подгона — звёзды улетят в ночную смену студии:',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------------- NEWS PIPELINE (CHANNEL / DRAFT) ----------------

async function runNewsEdition(env, opts) {
  const targetChat = (opts && opts.targetChat) || env.TELEGRAM_CHAT_ID;
  if (!targetChat || !env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'Missing TELEGRAM_CHAT_ID or TELEGRAM_BOT_TOKEN' };
  }
  if (!env.GEMINI_API_KEY) {
    return { ok: false, error: 'Missing GEMINI_API_KEY' };
  }

  const categories = Object.keys(RSS_SOURCES);
  const startCat = categories[Math.floor(Math.random() * categories.length)];
  const orderedCats = [startCat].concat(categories.filter((c) => c !== startCat));

  let postedUrls = [];
  if (env.NEWS_KV) {
    postedUrls = (await env.NEWS_KV.get('posted_urls', 'json')) || [];
  }

  let picked = null;
  for (const cat of orderedCats) {
    const items = await fetchCategoryItems(cat);
    const fresh = items.find((it) => it.link && !postedUrls.includes(it.link));
    if (fresh) {
      picked = { ...fresh, cat };
      break;
    }
    if (!picked && items.length > 0 && opts && opts.force) {
      picked = { ...items[0], cat };
    }
  }

  if (!picked) {
    return { ok: false, error: 'Не удалось получить свежую новость из источников' };
  }

  const sys =
    'Ты — сатирическая музыкальная AI-редакция Zombie News Flava.\n' +
    'На основе новости сочини короткий, хлесткий музыкальный выпуск.\n' +
    'Чередуй ведущих: "Zombie-DJ" (уличный неон-рэп, 4–6 ритмичных строк) и "Дядя Коля Мертвец" (ироничный кибер-шансон на ржавой гитаре, 4–6 строк).\n' +
    'Верни СТРОГО JSON:\n' +
    '{"persona":"Zombie-DJ"|"Дядя Коля Мертвец","format":"РЭП-СВОДКА"|"КИБЕР-ШАНСОН","headline":"короткий яркий заголовок до 85 символов","lyrics":"4-6 строк куплета без хештегов","punchline":"финальная колкая фраза до 110 символов","imagePrompt":"vivid English prompt for cinematic neon street cover art matching the news, no text inside image"}';

  const geminiRes = await callGeminiText(env, {
    systemInstruction: sys,
    prompt: 'Категория: ' + picked.cat + '\nЗаголовок: ' + picked.title + '\nТекст: ' + picked.desc,
    json: true,
    thinkingLevel: 'LOW',
  });

  const track = parseJsonSafe(geminiRes.text);
  if (!track || !track.lyrics) {
    return { ok: false, error: 'Gemini не вернул корректный выпуск' };
  }

  const headline = String(track.headline || picked.title).slice(0, 100);
  const lyrics = String(track.lyrics).slice(0, 620);
  const punchline = String(track.punchline || '').slice(0, 130);
  const persona = String(track.persona || 'Zombie-DJ').slice(0, 32);
  const format = String(track.format || 'РЭП-СВОДКА').slice(0, 32);
  const sourceHost = safeHost(picked.link).slice(0, 48);

  const caption =
    '🎙 <b>' + escapeHtml(persona) + ' · ' + escapeHtml(format) + '</b>\n\n' +
    '<b>' + escapeHtml(headline) + '</b>\n\n' +
    '<i>' + escapeHtml(lyrics) + '</i>\n\n' +
    (punchline ? '💥 ' + escapeHtml(punchline) + '\n\n' : '') +
    '🗞 Источник: ' + escapeHtml(sourceHost);

  const imgBytes = await generateCoverImage(env, track.imagePrompt || picked.title);
  const eco = getEcosystem(env);
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🎛 Слушать в Студии', url: eco.botUrl },
        { text: '🌲 Forest 5x5', url: eco.projects[0].url },
      ],
    ],
  };

  let tgRes;
  if (imgBytes) {
    tgRes = await tgSendPhotoBytes(env, targetChat, imgBytes, caption, replyMarkup);
  } else {
    tgRes = await tgCall(env, 'sendMessage', {
      chat_id: targetChat,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  if (!tgRes.ok) {
    return { ok: false, error: tgRes.description || 'Telegram send error' };
  }

  if (env.VOICE_ENABLED === 'true') {
    const audioWav = await tryGenerateVoice(env, headline + '. ' + lyrics, persona);
    if (audioWav) {
      await tgSendAudioBytes(env, targetChat, audioWav, persona + ' — ' + headline);
    }
  }

  if (env.NEWS_KV && opts && opts.saveLast !== false) {
    const nextPosted = [picked.link].concat(postedUrls.filter((u) => u !== picked.link)).slice(0, 60);
    await env.NEWS_KV.put('posted_urls', JSON.stringify(nextPosted));
    await updateStats(env, (s) => {
      s.lastTrack = {
        persona,
        format,
        headline,
        lyrics,
        punchline,
        source: sourceHost,
        ts: Date.now(),
      };
    });
  }

  return { ok: true, headline, persona };
}

async function fetchCategoryItems(cat) {
  const urls = RSS_SOURCES[cat] || RSS_SOURCES.world;
  const out = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'ZombieNewsFlava/1.0' },
        signal: AbortSignal.timeout(4500),
      });
      if (!resp.ok) continue;
      if (url.endsWith('.json') || url.includes('.json?')) {
        const j = await resp.json();
        const kids = (j && j.data && j.data.children) || [];
        for (const c of kids) {
          if (c && c.data && c.data.title && c.data.url) {
            out.push({ title: c.data.title, link: c.data.url, desc: '' });
          }
        }
      } else {
        const xml = await resp.text();
        const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
        for (const block of items.slice(0, 8)) {
          const title = stripXml(extractTag(block, 'title'));
          const link = stripXml(extractTag(block, 'link')) || extractAttr(block, 'link', 'href');
          const desc = stripXml(extractTag(block, 'description') || extractTag(block, 'summary')).slice(0, 400);
          if (title && link) out.push({ title, link, desc });
        }
      }
      if (out.length > 0) break;
    } catch (_) {}
  }
  return out;
}

// ---------------- GEMINI & WORKERS AI ----------------

async function callGeminiText(env, opts) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан');

  const models = [];
  if (env.GEMINI_MODEL) models.push(env.GEMINI_MODEL);
  for (const m of GEMINI_TEXT_MODELS) {
    if (!models.includes(m)) models.push(m);
  }

  let lastErr = 'Unknown Gemini error';

  for (const model of models) {
    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';

    const baseBody = {
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    };
    if (opts.systemInstruction) {
      baseBody.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }

    const genCfg = {};
    if (opts.json) genCfg.responseMimeType = 'application/json';
    if (model.startsWith('gemini-4-') && opts.thinkingLevel) {
      genCfg.thinkingConfig = { thinkingLevel: opts.thinkingLevel };
    }

    const payload = Object.keys(genCfg).length ? { ...baseBody, generationConfig: genCfg } : baseBody;

    let res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 400 && Object.keys(genCfg).length > 0) {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(baseBody),
        signal: AbortSignal.timeout(12000),
      });
    }

    if (res.ok) {
      const data = await res.json();
      const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      if (text) return { text, model };
      lastErr = model + ': empty response';
      continue;
    }

    const errText = await res.text();
    lastErr = model + ' (' + res.status + '): ' + errText.slice(0, 140);
  }

  throw new Error(lastErr);
}

async function generateCoverImage(env, prompt) {
  if (!env.AI) return null;
  const fullPrompt = 'Editorial neon street art illustration, moody lighting, high contrast, no text: ' + String(prompt).slice(0, 240);
  try {
    const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: fullPrompt,
      steps: 4,
    });
    if (out && out.image) {
      return base64ToBytes(out.image);
    }
    if (out instanceof ReadableStream || out instanceof Uint8Array || out instanceof ArrayBuffer) {
      return new Uint8Array(out instanceof ReadableStream ? await new Response(out).arrayBuffer() : out);
    }
  } catch (_) {}

  try {
    const out2 = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', { prompt: fullPrompt });
    return new Uint8Array(out2 instanceof ReadableStream ? await new Response(out2).arrayBuffer() : out2);
  } catch (_) {
    return null;
  }
}

async function tryGenerateVoice(env, text, persona) {
  if (!env.GEMINI_API_KEY) return null;
  try {
    const voiceName = persona.includes('Коля') ? 'Charon' : 'Fenrir';
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_TTS_MODEL + ':generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: String(text).slice(0, 480) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const inline = parts.find((p) => p.inlineData && p.inlineData.data);
    if (!inline) return null;
    const pcm = base64ToBytes(inline.inlineData.data);
    return pcm16ToWav(pcm, 24000);
  } catch (_) {
    return null;
  }
}

// ---------------- STATS & HELPERS ----------------

async function loadStats(env) {
  const now = Date.now();
  if (RAM_STATS.data && now - RAM_STATS.ts < 30000) return RAM_STATS.data;
  const fallback = {
    freeCookies: 0,
    paidCookies: 0,
    starsTotal: 0,
    banquets: 0,
    reacts: { fire: 0, zombie: 0, guitar: 0 },
    lastTrack: null,
  };
  if (!env.NEWS_KV) return fallback;
  const loaded = (await env.NEWS_KV.get('stats', 'json')) || {};
  const merged = {
    ...fallback,
    ...loaded,
    reacts: { ...fallback.reacts, ...(loaded.reacts || {}) },
  };
  RAM_STATS.data = merged;
  RAM_STATS.ts = now;
  return merged;
}

async function updateStats(env, mutator) {
  const current = await loadStats(env);
  const next = JSON.parse(JSON.stringify(current));
  mutator(next);
  RAM_STATS.data = next;
  RAM_STATS.ts = Date.now();
  if (env.NEWS_KV) {
    await env.NEWS_KV.put('stats', JSON.stringify(next));
  }
  return next;
}

function allowRate(key, windowMs) {
  const now = Date.now();
  const prev = RAM_RATE.get(key) || 0;
  if (now - prev < windowMs) return false;
  if (RAM_RATE.size > 400) RAM_RATE.clear();
  RAM_RATE.set(key, now);
  return true;
}

async function tgCall(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'No token' };
  const res = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  return res.json();
}

async function tgSendPhotoBytes(env, chatId, bytes, caption, replyMarkup) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('photo', new Blob([bytes], { type: 'image/png' }), 'cover.png');
  fd.append('caption', caption);
  fd.append('parse_mode', 'HTML');
  if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));
  const res = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendPhoto', {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(12000),
  });
  return res.json();
}

async function tgSendAudioBytes(env, chatId, wavBytes, title) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'track.wav');
  fd.append('title', title.slice(0, 60));
  await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendAudio', {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(12000),
  });
}

function pcm16ToWav(pcm, sampleRate) {
  const wav = new Uint8Array(44 + pcm.length);
  const v = new DataView(wav.buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJsonSafe(raw) {
  try {
    const cleaned = String(raw || '').replace(/```json|```/gi, '').trim();
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch (_) {
    return null;
  }
}

async function safeJson(req) {
  try {
    return await req.json();
  } catch (_) {
    return null;
  }
}

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*' + attr + '=["\']([^"\']+)["\']', 'i'));
  return m ? m[1] : '';
}

function stripXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'news';
  }
}

// ---------------- MINI APP HTML ----------------

function renderHtml(env, stats) {
  const eco = getEcosystem(env);
  const initData = JSON.stringify({
    stats,
    projects: eco.projects,
    channelUrl: eco.channelUrl,
    channelUser: eco.channelUser,
    botUrl: eco.botUrl,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Zombie News Flava Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      --bg: #0a0e14;
      --surface: #121822;
      --surface-2: #18202d;
      --border: rgba(255, 255, 255, 0.08);
      --text: #f3f6fb;
      --muted: #93a1b5;
      --accent: #22c55e;
      --gold: #f59e0b;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0; padding: 0;
      background: var(--bg); color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 15px; line-height: 1.5;
      min-height: 100vh;
    }
    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 16px 16px 96px;
    }
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      font-family: 'Outfit', sans-serif;
      font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
      margin: 0;
    }
    .meta-line {
      font-size: 12px; color: var(--muted); margin-top: 4px;
    }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 44px; padding: 10px 18px;
      border-radius: 12px; border: 1px solid var(--border);
      background: var(--surface-2); color: var(--text);
      font-family: inherit; font-size: 14px; font-weight: 600;
      text-decoration: none; cursor: pointer;
      transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.14s;
      white-space: nowrap;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary {
      background: var(--accent); color: #04120a; border-color: transparent;
    }
    .btn-gold {
      background: var(--gold); color: #1a1002; border-color: transparent;
    }
    .btn-full { width: 100%; }
    .section { margin-top: 20px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
    }
    .card + .card { margin-top: 14px; }
    h2 {
      font-family: 'Outfit', sans-serif;
      font-size: 18px; font-weight: 600; margin: 0 0 8px;
    }
    p { margin: 0 0 12px; color: var(--muted); }
    .lyrics {
      white-space: pre-line;
      color: var(--text);
      font-size: 15px; line-height: 1.6;
      padding: 14px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      margin: 12px 0;
    }
    .row { display: flex; flex-wrap: wrap; gap: 10px; }
    .row > * { flex: 1 1 0; }
    .num {
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
    }
    .stats-strip {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      margin-top: 12px;
    }
    .stat-cell {
      padding: 12px; border-radius: 14px; background: var(--surface-2);
      text-align: center;
    }
    .stat-val { font-size: 20px; font-weight: 700; display: block; }
    .stat-lbl { font-size: 12px; color: var(--muted); }
    canvas#viz {
      width: 100%; height: 64px; display: block;
      background: #0b1018; border-radius: 12px;
      margin: 12px 0;
    }
    .pad-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
      margin-top: 12px;
    }
    .project-list {
      display: grid; grid-template-columns: 1fr; gap: 12px;
    }
    @media (min-width: 720px) {
      .project-list { grid-template-columns: repeat(2, 1fr); }
    }
    .proj-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; padding: 16px;
      display: flex; flex-direction: column; justify-content: space-between; gap: 12px;
    }
    .proj-title { font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 600; color: var(--text); }
    .proj-desc { font-size: 13px; color: var(--muted); }
    input, textarea {
      width: 100%; min-height: 44px; padding: 11px 14px;
      border-radius: 12px; border: 1px solid var(--border);
      background: var(--surface-2); color: var(--text);
      font-family: inherit; font-size: 15px; outline: none;
    }
    input:focus, textarea:focus { border-color: var(--accent); }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    .bottom-nav {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
      background: rgba(12, 17, 25, 0.92);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--border);
      padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
    }
    .bottom-inner {
      max-width: 960px; margin: 0 auto;
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
    }
    .nav-btn {
      min-height: 48px; border: none; border-radius: 10px;
      background: transparent; color: var(--muted);
      font-family: inherit; font-size: 12px; font-weight: 600;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      cursor: pointer;
    }
    .nav-btn.active { color: var(--text); background: var(--surface-2); }
    .toast {
      position: fixed; left: 50%; bottom: 82px; transform: translateX(-50%);
      background: #1f2937; color: var(--text); border: 1px solid var(--border);
      padding: 10px 16px; border-radius: 12px; font-size: 13px; font-weight: 500;
      display: none; z-index: 50; max-width: 90%; text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div>
        <h1 class="brand">Zombie News Flava</h1>
        <div class="meta-line">Сатирическая AI-студия · @${escapeHtml(eco.channelUser)} · Свободный эфир</div>
      </div>
      <a class="btn btn-primary" href="${escapeHtml(eco.channelUrl)}" target="_blank" rel="noopener">Канал</a>
    </header>

    <main class="section">
      <!-- TAB 1: ЭФИР -->
      <section id="tab-air" class="tab-pane active">
        <div class="card">
          <div class="meta-line" id="track-meta">Последний выпуск студии</div>
          <h2 id="track-title" style="margin-top:6px;">Загрузка эфира...</h2>
          <div class="lyrics" id="track-lyrics"></div>
          <p id="track-punch" style="color:var(--text);font-weight:500;"></p>
          <div class="row">
            <button class="btn btn-primary" id="btn-speak">🔊 Зачитать поверх бита</button>
            <button class="btn" id="btn-beat-quick">🎵 Включить бит</button>
          </div>
          <div class="row" style="margin-top:10px;">
            <button class="btn" onclick="sendReact('fire')">🔥 <span class="num" id="r-fire">0</span></button>
            <button class="btn" onclick="sendReact('zombie')">🧟 <span class="num" id="r-zombie">0</span></button>
            <button class="btn" onclick="sendReact('guitar')">🎸 <span class="num" id="r-guitar">0</span></button>
          </div>
        </div>

        <div class="card">
          <h2>Ведущие эфира</h2>
          <p><strong>Zombie-DJ</strong> — уличный неон-рэп и острые панчи по горячим новостям.</p>
          <p style="margin-bottom:0;"><strong>Дядя Коля Мертвец</strong> — ветеран кибер-шансона на ржавой гитаре. Добавь бота в свой чат, чтобы общаться с обоими вживую.</p>
        </div>
      </section>

      <!-- TAB 2: ПУЛЬТ -->
      <section id="tab-deck" class="tab-pane">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <h2 style="margin:0;">DJ-Пульт студии</h2>
            <button class="btn" id="btn-mute" style="min-height:40px;padding:8px 14px;">Звук вкл</button>
          </div>
          <canvas id="viz" width="600" height="64"></canvas>
          <div class="row">
            <button class="btn btn-primary" id="btn-beat-zombie">🎤 Zombie-DJ · 94 BPM</button>
            <button class="btn btn-gold" id="btn-beat-kolya">🎸 Дядя Коля · 108 BPM</button>
          </div>
          <div class="pad-grid">
            <button class="btn" onclick="playPad('scratch')">🎧 Скретч</button>
            <button class="btn" onclick="playPad('growl')">🧟 Рык зомби</button>
            <button class="btn" onclick="playPad('horn')">📯 Эйрхорн</button>
            <button class="btn" onclick="playPad('crunch')">🍪 Хруст</button>
          </div>
        </div>

        <div class="card">
          <h2>Заказать тему выпуска</h2>
          <p>Предложи новость или прикол — редакция заберёт её в следующий эфир.</p>
          <input id="sug-input" type="text" maxlength="180" placeholder="О чём зачитать в следующем треке?" />
          <div style="margin-top:10px;">
            <button class="btn btn-primary btn-full" id="btn-sug">Отправить в редакцию</button>
          </div>
        </div>
      </section>

      <!-- TAB 3: ИГРЫ -->
      <section id="tab-games" class="tab-pane">
        <div class="project-list" id="projects-grid"></div>
      </section>

      <!-- TAB 4: БАНКЕТ -->
      <section id="tab-bank" class="tab-pane">
        <div class="card">
          <h2>Касса студии</h2>
          <p>Поддержи ночную смену Zombie-DJ и Дяди Коли бесплатным тапом или Telegram Stars.</p>
          <div class="stats-strip">
            <div class="stat-cell">
              <span class="stat-val num" id="s-cookies">0</span>
              <span class="stat-lbl">Печенек</span>
            </div>
            <div class="stat-cell">
              <span class="stat-val num" id="s-stars">0</span>
              <span class="stat-lbl">Звёзд</span>
            </div>
            <div class="stat-cell">
              <span class="stat-val num" id="s-banquets">0</span>
              <span class="stat-lbl">Банкетов</span>
            </div>
          </div>
          <div style="margin-top:14px;">
            <button class="btn btn-full" id="btn-free-cookie">🍪 Угостить бесплатно (+1)</button>
          </div>
        </div>

        <div class="card">
          <h2>Подогнать печенье в Stars</h2>
          <div class="row">
            <button class="btn" onclick="buyPack('cookie_50')">🍪 50 ⭐</button>
            <button class="btn" onclick="buyPack('cookie_150')">🍪 150 ⭐</button>
            <button class="btn" onclick="buyPack('cookie_500')">🍪 500 ⭐</button>
          </div>
          <div style="margin-top:12px;">
            <button class="btn btn-gold btn-full" onclick="buyPack('banquet_10000')">🥂 Накрыть диджеям банкет · 10 000 ⭐</button>
          </div>
        </div>
      </section>
    </main>
  </div>

  <nav class="bottom-nav">
    <div class="bottom-inner">
      <button class="nav-btn active" data-tab="tab-air" onclick="switchTab('tab-air', this)">📻<span>Эфир</span></button>
      <button class="nav-btn" data-tab="tab-deck" onclick="switchTab('tab-deck', this)">🎛<span>Пульт</span></button>
      <button class="nav-btn" data-tab="tab-games" onclick="switchTab('tab-games', this)">🎮<span>Игры</span></button>
      <button class="nav-btn" data-tab="tab-bank" onclick="switchTab('tab-bank', this)">🍩<span>Банкет</span></button>
    </div>
  </nav>

  <div class="toast" id="toast"></div>

  <script>
    var INIT = ${initData};
    var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (tg) {
      try { tg.ready(); tg.expand(); } catch (e) {}
    }

    var stateStats = INIT.stats || {};
    var ac = null;
    var analyser = null;
    var masterGain = null;
    var muted = false;
    var beatMode = null;
    var beatTimer = null;
    var step = 0;
    var freeQueue = 0;
    var freeTimer = null;

    function showToast(msg) {
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.display = 'none'; }, 2400);
    }

    function switchTab(id, btn) {
      var panes = document.querySelectorAll('.tab-pane');
      for (var i = 0; i < panes.length; i++) panes[i].classList.remove('active');
      var navs = document.querySelectorAll('.nav-btn');
      for (var j = 0; j < navs.length; j++) navs[j].classList.remove('active');
      document.getElementById(id).classList.add('active');
      if (btn) btn.classList.add('active');
    }

    function renderStats() {
      var s = stateStats || {};
      var r = s.reacts || {};
      var totalCookies = (s.freeCookies || 0) + (s.paidCookies || 0);
      document.getElementById('s-cookies').textContent = String(totalCookies);
      document.getElementById('s-stars').textContent = String(s.starsTotal || 0);
      document.getElementById('s-banquets').textContent = String(s.banquets || 0);
      document.getElementById('r-fire').textContent = String(r.fire || 0);
      document.getElementById('r-zombie').textContent = String(r.zombie || 0);
      document.getElementById('r-guitar').textContent = String(r.guitar || 0);

      var t = s.lastTrack;
      if (t && t.headline) {
        document.getElementById('track-meta').textContent = (t.persona || 'Zombie-DJ') + ' · ' + (t.format || 'Эфир');
        document.getElementById('track-title').textContent = t.headline;
        document.getElementById('track-lyrics').textContent = t.lyrics || '';
        document.getElementById('track-punch').textContent = t.punchline || '';
      } else {
        document.getElementById('track-title').textContent = 'Студия готова к эфиру';
        document.getElementById('track-lyrics').textContent =
          'Каждый день в 09:00 и 21:00 UTC бот забирает свежие мировые новости и превращает их в сатирический рэп и кибер-шансон.\\n\\nЖми «Включить бит» или переходи в «Пульт» и «Игры»!';
        document.getElementById('track-punch').textContent = '';
      }
    }

    function renderProjects() {
      var grid = document.getElementById('projects-grid');
      var list = INIT.projects || [];
      grid.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var card = document.createElement('div');
        card.className = 'proj-card';
        var top = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'proj-title';
        title.textContent = p.name;
        var desc = document.createElement('div');
        desc.className = 'proj-desc';
        desc.textContent = p.desc;
        top.appendChild(title);
        top.appendChild(desc);

        var link = document.createElement('a');
        link.className = 'btn btn-primary';
        link.textContent = p.cta || 'Открыть';
        link.href = p.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.onclick = function (url) {
          return function (ev) {
            if (tg && url.indexOf('https://t.me/') === 0 && tg.openTelegramLink) {
              ev.preventDefault();
              tg.openTelegramLink(url);
            }
          };
        }(p.url);

        card.appendChild(top);
        card.appendChild(link);
        grid.appendChild(card);
      }
    }

    function ensureAudio() {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        try { navigator.audioSession.type = 'playback'; } catch (e) {}
      }
      if (!ac) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx();
        masterGain = ac.createGain();
        masterGain.gain.value = muted ? 0 : 0.7;
        analyser = ac.createAnalyser();
        analyser.fftSize = 64;
        masterGain.connect(analyser);
        analyser.connect(ac.destination);
        drawViz();
      }
      if (ac.state === 'suspended') {
        ac.resume();
      }
    }

    function playTone(freq, dur, type, vol, slideTo) {
      ensureAudio();
      var now = ac.currentTime;
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
      g.gain.setValueAtTime(vol || 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + dur);
    }

    function playNoise(dur, vol, hp) {
      ensureAudio();
      var len = Math.floor(ac.sampleRate * dur);
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var src = ac.createBufferSource();
      src.buffer = buf;
      var filter = ac.createBiquadFilter();
      filter.type = hp ? 'highpass' : 'bandpass';
      filter.frequency.value = hp || 1200;
      var g = ac.createGain();
      g.gain.setValueAtTime(vol || 0.2, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(masterGain);
      src.start();
    }

    function playPad(kind) {
      if (kind === 'scratch') {
        playTone(440, 0.12, 'sawtooth', 0.22, 180);
        setTimeout(function () { playTone(210, 0.14, 'sawtooth', 0.2, 520); }, 110);
      } else if (kind === 'growl') {
        playTone(95, 0.45, 'sawtooth', 0.28, 55);
      } else if (kind === 'horn') {
        playTone(392, 0.28, 'sawtooth', 0.22, 370);
        playTone(494, 0.28, 'square', 0.14, 466);
      } else if (kind === 'crunch') {
        playNoise(0.11, 0.35, 1800);
      }
    }

    function toggleBeat(mode) {
      ensureAudio();
      if (beatMode === mode) {
        clearInterval(beatTimer);
        beatMode = null;
        updateBeatButtons();
        return;
      }
      clearInterval(beatTimer);
      beatMode = mode;
      step = 0;
      var bpm = mode === 'kolya' ? 108 : 94;
      var ms = Math.round(60000 / bpm / 2);
      beatTimer = setInterval(function () {
        if (muted) return;
        var s = step % 8;
        if (s === 0 || (mode === 'zombie' && s === 3) || (mode === 'kolya' && s === 4)) {
          playTone(115, 0.18, 'sine', 0.45, 42);
        }
        if ((mode === 'zombie' && (s === 2 || s === 6)) || (mode === 'kolya' && (s === 2 || s === 5 || s === 7))) {
          playNoise(0.12, 0.22, 1400);
        }
        if (s % 2 === 1) playNoise(0.04, 0.08, 5200);
        if (mode === 'kolya' && (s === 0 || s === 4)) {
          playTone(s === 0 ? 196 : 220, 0.22, 'triangle', 0.14, 165);
        }
        step++;
      }, ms);
      updateBeatButtons();
    }

    function updateBeatButtons() {
      document.getElementById('btn-beat-zombie').textContent = beatMode === 'zombie' ? '⏹ Стоп · 94 BPM' : '🎤 Zombie-DJ · 94 BPM';
      document.getElementById('btn-beat-kolya').textContent = beatMode === 'kolya' ? '⏹ Стоп · 108 BPM' : '🎸 Дядя Коля · 108 BPM';
      document.getElementById('btn-beat-quick').textContent = beatMode ? '⏹ Остановить бит' : '🎵 Включить бит';
    }

    function drawViz() {
      var canvas = document.getElementById('viz');
      if (!canvas || !analyser) return;
      var c2 = canvas.getContext('2d');
      var buf = new Uint8Array(analyser.frequencyBinCount);
      function frame() {
        requestAnimationFrame(frame);
        analyser.getByteFrequencyData(buf);
        c2.fillStyle = '#0b1018';
        c2.fillRect(0, 0, canvas.width, canvas.height);
        var w = canvas.width / buf.length;
        for (var i = 0; i < buf.length; i++) {
          var h = Math.max(4, (buf[i] / 255) * (canvas.height - 8));
          c2.fillStyle = i % 2 === 0 ? '#22c55e' : '#f59e0b';
          c2.fillRect(i * w + 2, canvas.height - h, Math.max(4, w - 4), h);
        }
      }
      frame();
    }

    function sendReact(kind) {
      fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.stats) {
            stateStats = d.stats;
            renderStats();
          }
        })
        .catch(function () {});
    }

    function queueFreeCookie() {
      playPad('crunch');
      freeQueue += 1;
      stateStats.freeCookies = (stateStats.freeCookies || 0) + 1;
      renderStats();
      clearTimeout(freeTimer);
      freeTimer = setTimeout(function () {
        var count = freeQueue;
        freeQueue = 0;
        if (count <= 0) return;
        fetch('/api/free-cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: count }),
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.stats) {
              stateStats = d.stats;
              renderStats();
            }
          })
          .catch(function () {});
      }, 2000);
    }

    function buyPack(packId) {
      showToast('Готовим счёт в Stars...');
      fetch('/api/cookie-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: packId }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.invoiceUrl) {
            showToast((d && d.error) || 'Не удалось создать счёт');
            return;
          }
          if (tg && tg.openInvoice) {
            tg.openInvoice(d.invoiceUrl, function (status) {
              if (status === 'paid') {
                fetch('/api/cookie-confirm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ nonce: d.nonce }),
                })
                  .then(function (r2) { return r2.json(); })
                  .then(function (d2) {
                    if (d2 && d2.stats) {
                      stateStats = d2.stats;
                      renderStats();
                    }
                    showToast('Спасибо! Студия заряжена!');
                  });
              } else if (status === 'cancelled') {
                showToast('Оплата отменена');
              }
            });
          } else {
            window.open(d.invoiceUrl, '_blank');
          }
        })
        .catch(function () {
          showToast('Ошибка сети');
        });
    }

    document.getElementById('btn-beat-zombie').onclick = function () { toggleBeat('zombie'); };
    document.getElementById('btn-beat-kolya').onclick = function () { toggleBeat('kolya'); };
    document.getElementById('btn-beat-quick').onclick = function () { toggleBeat(beatMode || 'zombie'); };
    document.getElementById('btn-mute').onclick = function () {
      muted = !muted;
      if (masterGain) masterGain.gain.value = muted ? 0 : 0.7;
      this.textContent = muted ? 'Звук выкл' : 'Звук вкл';
    };
    document.getElementById('btn-free-cookie').onclick = queueFreeCookie;

    document.getElementById('btn-speak').onclick = function () {
      var title = document.getElementById('track-title').textContent;
      var lyrics = document.getElementById('track-lyrics').textContent;
      if (!('speechSynthesis' in window)) {
        showToast('Озвучка не поддерживается браузером');
        return;
      }
      if (!beatMode) toggleBeat('zombie');
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(title + '. ' + lyrics);
      u.lang = 'ru-RU';
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
      showToast('Зачитываем выпуск поверх бита');
    };

    document.getElementById('btn-sug').onclick = function () {
      var input = document.getElementById('sug-input');
      var topic = (input.value || '').trim();
      var author = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || 'Слушатель';
      if (topic.length < 4) {
        showToast('Напиши тему чуть подробнее');
        return;
      }
      fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic, author: author }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            input.value = '';
            showToast('Тема отправлена в редакцию!');
          } else {
            showToast((d && d.error) || 'Попробуй позже');
          }
        })
        .catch(function () { showToast('Ошибка сети'); });
    };

    renderStats();
    renderProjects();
  </script>
</body>
</html>`;
}
