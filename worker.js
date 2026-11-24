const DEFAULT_CHANNEL = '@zombie_news_flava';
const DEFAULT_BOT = 'zombie_rap_news_bot';
const DEFAULT_SLOTS_URL = 'https://forest-fortune-5x5.qx420.workers.dev/';
const DEFAULT_SLOTS_BOT = 'ForestFortuneVegasBot';
const DEFAULT_ROGER_URL = 'https://i-field.github.io/lucky-roger-slot/';
const DEFAULT_DURAK_URL = 'https://i-field.github.io/durak-mini-app/';
const DEFAULT_MUSIC_URL = 'https://i-field.github.io/ifield-music-lab/';

const GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

const WORKERS_AI_IMAGE_MODELS = [
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/bytedance/stable-diffusion-xl-lightning',
];

const COOKIE_PACKS = {
  cookie_50: {
    id: 'cookie_50',
    stars: 50,
    title: 'Хрустящая печенька 🍪',
    desc: 'Кофе и печенье для Zombie-DJ и Дяди Коли на ночной эфир',
    label: 'Печенье для диджеев (50 ⭐)',
  },
  cookie_150: {
    id: 'cookie_150',
    stars: 150,
    title: 'Коробка печенья 🍩',
    desc: 'Плотный паёк для студии: больше жёстких панчей и свежих обложек',
    label: 'Коробка печенья (150 ⭐)',
  },
  cookie_500: {
    id: 'cookie_500',
    stars: 500,
    title: 'VIP-самовар и пряники 👑',
    desc: 'Королевский респект продюсеру студии Zombie News Flava',
    label: 'VIP-самовар студии (500 ⭐)',
  },
  banquet_10000: {
    id: 'banquet_10000',
    stars: 10000,
    title: '🥂 Банкет для диджеев!',
    desc: 'Легендарный ужин на весь некро-район: Zombie-DJ и Дядя Коля качают до утра',
    label: 'Банкет для диджеев (10 000 ⭐)',
  },
};

const STYLES = ['rap', 'chanson', 'battle'];
const CATEGORIES = ['weird', 'crypto', 'showbiz', 'tech'];

const CATEGORY_LABELS = {
  weird: 'Мировой трэш',
  crypto: 'Крипта & Web3',
  showbiz: 'Шоу-биз & Хайп',
  tech: 'Техно & ИИ',
};

const STYLE_LABELS = {
  rap: '🎤 Zombie-DJ',
  chanson: '🎸 Дядя Коля Мертвец',
  battle: '⚔️ Рэп vs Шансон',
};

const USER_AGENT = 'Mozilla/5.0 (compatible; ZombieNewsStudio/2.2; +https://t.me/zombie_news_flava)';
const GROUP_MEM = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS' && path.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    try {
      if (request.method === 'GET' && (path === '/' || path === '/app' || path === '/index.html')) {
        return new Response(renderHtml({
          bot: getBotUsername(env),
          channel: getChannelUsername(env),
          apiBase: url.origin,
          slotsUrl: getSlotsUrl(env),
          slotsBot: getSlotsBot(env),
          rogerUrl: getRogerUrl(env),
          durakUrl: getDurakUrl(env),
          musicUrl: getMusicUrl(env),
        }), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=120',
          },
        });
      }

      if (request.method === 'GET' && path === '/api/studio') {
        const studio = await getStudioState(env);
        return jsonResponse({
          ok: true,
          bot: getBotUsername(env),
          channel: getChannelUsername(env),
          slotsUrl: getSlotsUrl(env),
          slotsBot: getSlotsBot(env),
          rogerUrl: getRogerUrl(env),
          durakUrl: getDurakUrl(env),
          musicUrl: getMusicUrl(env),
          hasWorkersAI: Boolean(env.AI),
          ...studio,
        }, 200, {
          ...corsHeaders(),
          'cache-control': 'public, max-age=15',
        });
      }

      if (request.method === 'POST' && path === '/api/react') {
        const body = await safeJson(request);
        const ip = request.headers.get('cf-connecting-ip') || 'anon';
        const allowed = await checkRateLimit(env, `rl:react:${ip}`, 3, 25);
        if (!allowed) {
          return jsonResponse({ ok: false, error: 'Слишком часто, переведи дух пару секунд' }, 429, corsHeaders());
        }

        const studio = await getStudioState(env);
        if (body?.kind === 'vote' && STYLES.includes(body.style)) {
          studio.votes[body.style] = (studio.votes[body.style] || 0) + 1;
        } else if (body?.kind === 'post' && body.postId && ['fire', 'skull', 'rock'].includes(body.reaction)) {
          const post = studio.recentPosts.find((p) => p.id === body.postId);
          if (post) {
            post.reactions = post.reactions || { fire: 0, skull: 0, rock: 0 };
            post.reactions[body.reaction] = (post.reactions[body.reaction] || 0) + 1;
          }
        } else {
          return jsonResponse({ ok: false, error: 'Неверные параметры реакции' }, 400, corsHeaders());
        }

        await saveStudioState(env, studio);
        return jsonResponse({ ok: true, votes: studio.votes, recentPosts: studio.recentPosts }, 200, corsHeaders());
      }

      if (request.method === 'POST' && path === '/api/free-cookie') {
        const body = await safeJson(request);
        const ip = request.headers.get('cf-connecting-ip') || 'anon';
        const allowed = await checkRateLimit(env, `rl:fc:${ip}`, 10, 1);
        if (!allowed) {
          const current = await getStudioState(env);
          return jsonResponse({ ok: true, throttled: true, freeCookies: current.freeCookies }, 200, corsHeaders());
        }
        const delta = Math.max(1, Math.min(10, Number(body?.count) || 1));
        const studio = await getStudioState(env);
        studio.freeCookies = (studio.freeCookies || 0) + delta;
        await saveStudioState(env, studio);
        return jsonResponse({ ok: true, freeCookies: studio.freeCookies }, 200, corsHeaders());
      }

      if (request.method === 'POST' && path === '/api/suggest') {
        const body = await safeJson(request);
        const text = String(body?.text || '').replace(/\s+/g, ' ').trim();
        const style = STYLES.includes(body?.style) ? body.style : 'auto';
        const author = String(body?.author || 'Слушатель').replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 32) || 'Слушатель';

        if (text.length < 6 || text.length > 180) {
          return jsonResponse({ ok: false, error: 'Напиши тему от 6 до 180 символов' }, 400, corsHeaders());
        }

        const ip = request.headers.get('cf-connecting-ip') || 'anon';
        const allowed = await checkRateLimit(env, `rl:sug:${ip}`, 900, 1);
        if (!allowed) {
          return jsonResponse({ ok: false, error: 'Одну тему можно закидывать раз в 15 минут (бережем лимит)' }, 429, corsHeaders());
        }

        const inbox = await getInbox(env);
        const item = {
          id: crypto.randomUUID().slice(0, 8),
          text,
          style,
          author,
          ts: Date.now(),
        };
        inbox.unshift(item);
        await saveInbox(env, inbox.slice(0, 25));

        if (env.ADMIN_CHAT_ID) {
          ctx.waitUntil(
            tgCall(env, 'sendMessage', {
              chat_id: env.ADMIN_CHAT_ID,
              text: `💡 <b>Новая предложка из Mini App</b>\nОт: ${escapeHtml(author)}\nСтиль: ${escapeHtml(STYLE_LABELS[style] || 'Авто')}\n\n«${escapeHtml(text)}»`,
              parse_mode: 'HTML',
            }).catch(() => {})
          );
        }

        return jsonResponse({ ok: true, item, queueSize: Math.min(inbox.length, 25) }, 200, corsHeaders());
      }

      if (request.method === 'POST' && path === '/api/cookie-invoice') {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return jsonResponse({ ok: false, error: 'Не задан TELEGRAM_BOT_TOKEN' }, 500, corsHeaders());
        }
        const body = await safeJson(request);
        const pack = COOKIE_PACKS[body?.pack] || COOKIE_PACKS.cookie_50;
        const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

        if (env.NEWS_KV) {
          await env.NEWS_KV.put(
            `nonce:${nonce}`,
            JSON.stringify({ pack: pack.id, stars: pack.stars, paid: false, ts: Date.now() }),
            { expirationTtl: 900 }
          );
        }

        const res = await tgCall(env, 'createInvoiceLink', {
          title: pack.title,
          description: pack.desc,
          payload: JSON.stringify({ pack: pack.id, src: 'webapp', nonce }),
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: pack.label, amount: pack.stars }],
        });

        if (!res?.ok || !res?.result) {
          return jsonResponse({ ok: false, error: res?.description || 'Не удалось создать счёт Stars' }, 502, corsHeaders());
        }

        return jsonResponse({
          ok: true,
          invoiceLink: res.result,
          pack: pack.id,
          stars: pack.stars,
          nonce,
        }, 200, corsHeaders());
      }

      if (request.method === 'POST' && path === '/api/cookie-confirm') {
        const body = await safeJson(request);
        const nonce = String(body?.nonce || '').trim();
        if (!nonce || !env.NEWS_KV) {
          return jsonResponse({ ok: false, error: 'Неверный код подтверждения' }, 400, corsHeaders());
        }
        const raw = await env.NEWS_KV.get(`nonce:${nonce}`);
        if (!raw) {
          return jsonResponse({ ok: false, error: 'Чек уже учтён или истёк' }, 404, corsHeaders());
        }
        const info = JSON.parse(raw);
        if (info.paid) {
          const s = await getStudioState(env);
          return jsonResponse({ ok: true, alreadyCounted: true, cookiesTotal: s.cookiesTotal, cookiesCount: s.cookiesCount }, 200, corsHeaders());
        }
        info.paid = true;
        await env.NEWS_KV.put(`nonce:${nonce}`, JSON.stringify(info), { expirationTtl: 600 });
        const studio = await addStarsCookie(env, info.stars);
        if (env.ADMIN_CHAT_ID) {
          ctx.waitUntil(
            tgCall(env, 'sendMessage', {
              chat_id: env.ADMIN_CHAT_ID,
              text: info.stars >= 10000
                ? `🥂👑 <b>МЕГА-БАНКЕТ В MINI APP!</b>\nКто-то занёс <b>${info.stars} ⭐</b> диджеям!\nВсего собрано: ${studio.cookiesTotal} ⭐`
                : `🍩 <b>Донат через Mini App!</b>\n+${info.stars} ⭐ на печенье диджеям.\nВсего собрано: ${studio.cookiesTotal} ⭐`,
              parse_mode: 'HTML',
            }).catch(() => {})
          );
        }
        return jsonResponse({
          ok: true,
          cookiesTotal: studio.cookiesTotal,
          cookiesCount: studio.cookiesCount,
        }, 200, corsHeaders());
      }

      if (path === '/setup') {
        const runKey = await getRunKey(env);
        const whSecret = await getWebhookSecret(env);
        const webhookUrl = `${url.origin}/webhook`;
        const whPayload = {
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          secret_token: whSecret,
        };
        const wh = await tgCall(env, 'setWebhook', whPayload);
        const cmds = await tgCall(env, 'setMyCommands', {
          commands: [
            { command: 'start', description: 'Пульт, игры и фишки студии' },
            { command: 'projects', description: 'Наши игры: Дурак, Слоты, Пульт' },
            { command: 'news', description: 'Свежий AI-выпуск в чат' },
            { command: 'roast', description: 'Трек от Zombie-DJ про наш чат' },
            { command: 'cookie', description: 'Печенье и банкет диджеям (Stars)' },
            { command: 'draft', description: 'Создать черновик выпуска (админ)' },
            { command: 'status', description: 'Статус бота и лимитов' },
          ],
        });

        return jsonResponse({
          ok: Boolean(wh?.ok),
          hasWorkersAI: Boolean(env.AI),
          hasKV: Boolean(env.NEWS_KV),
          hasGemini: Boolean(env.GEMINI_API_KEY),
          hasAdmin: Boolean(env.ADMIN_CHAT_ID),
          miniAppUrl: `${url.origin}/`,
          runUrl: `${url.origin}/run?key=${runKey}`,
          draftUrl: `${url.origin}/run?key=${runKey}&preview=1`,
          wh,
          cmds,
        });
      }

      if (path === '/status' || path === '/health') {
        const studio = await getStudioState(env);
        const inbox = await getInbox(env);
        return jsonResponse({
          ok: true,
          hasWorkersAI: Boolean(env.AI),
          hasKV: Boolean(env.NEWS_KV),
          hasGemini: Boolean(env.GEMINI_API_KEY),
          hasAdmin: Boolean(env.ADMIN_CHAT_ID),
          mode: studio.mode,
          totalPosts: studio.totalPosts,
          cookiesTotal: studio.cookiesTotal,
          freeCookies: studio.freeCookies,
          inboxCount: inbox.length,
        });
      }

      if (path === '/run' || path === '/draft') {
        const expectedKey = await getRunKey(env);
        const key = url.searchParams.get('key') || '';
        if (!key || key !== expectedKey) {
          return jsonResponse({ ok: false, error: 'Неверный ключ запуска (?key=...)' }, 403);
        }
        const preview = path === '/draft' || url.searchParams.get('preview') === '1';
        const style = url.searchParams.get('style') || 'auto';
        const category = url.searchParams.get('category') || 'auto';

        ctx.waitUntil(runNewsCycle(env, { preview, style, category, source: 'manual' }));
        return jsonResponse({ ok: true, started: true, preview, style, category });
      }

      if (request.method === 'POST' && (path === '/webhook' || path === '/tg-webhook')) {
        const expectedSecret = await getWebhookSecret(env);
        const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (expectedSecret && got && got !== expectedSecret) {
          return new Response('Forbidden', { status: 403 });
        }
        const update = await safeJson(request);
        if (!update) return new Response('OK');
        await handleTelegramUpdate(update, env, ctx, url.origin);
        return new Response('OK');
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return jsonResponse({ ok: false, error: err?.message || String(err) }, 500, corsHeaders());
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNewsCycle(env, { preview: false, style: 'auto', category: 'auto', source: 'cron' }));
  },
};

/* ---------------- Telegram Webhook & Commands ---------------- */

async function handleTelegramUpdate(update, env, ctx, origin) {
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    let valid = false;
    try {
      const p = JSON.parse(q.invoice_payload || '{}');
      const pack = COOKIE_PACKS[p.pack];
      if (pack && q.currency === 'XTR' && Number(q.total_amount) === pack.stars) {
        valid = true;
      }
    } catch {}
    await tgCall(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok: valid,
      error_message: valid ? undefined : 'Некорректные параметры счёта',
    });
    return;
  }

  const msg = update.message;
  if (msg?.successful_payment) {
    const sp = msg.successful_payment;
    const chargeId = sp.telegram_payment_charge_id || '';
    if (env.NEWS_KV && chargeId) {
      const seen = await env.NEWS_KV.get(`pay:${chargeId}`);
      if (seen) return;
      await env.NEWS_KV.put(`pay:${chargeId}`, '1', { expirationTtl: 86400 * 30 });
    }

    let alreadyViaNonce = false;
    try {
      const p = JSON.parse(sp.invoice_payload || '{}');
      if (p.nonce && env.NEWS_KV) {
        const raw = await env.NEWS_KV.get(`nonce:${p.nonce}`);
        if (raw) {
          const info = JSON.parse(raw);
          if (info.paid) alreadyViaNonce = true;
          info.paid = true;
          await env.NEWS_KV.put(`nonce:${p.nonce}`, JSON.stringify(info), { expirationTtl: 600 });
        }
      }
    } catch {}

    const stars = Number(sp.total_amount) || 50;
    const studio = alreadyViaNonce ? await getStudioState(env) : await addStarsCookie(env, stars);

    await tgCall(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: stars >= 10000
        ? `🥂👑 <b>БАНКЕТ НАКРЫТ!</b>\nТы занёс легендарные <b>${stars} ⭐</b>!\nZombie-DJ открывает шампанское, а Дядя Коля играет соляк до утра!`
        : `🧟‍♂️🎸 <b>Хруст пошёл!</b>\nСпасибо за <b>${stars} ⭐</b> на печенье диджеям!\nZombie-DJ уже точит микрофон, а Дядя Коля наливает чай.`,
      parse_mode: 'HTML',
    });

    if (env.ADMIN_CHAT_ID && String(msg.chat.id) !== String(env.ADMIN_CHAT_ID) && !alreadyViaNonce) {
      await tgCall(env, 'sendMessage', {
        chat_id: env.ADMIN_CHAT_ID,
        text: `🍩 <b>Прилетело ${stars} ⭐</b> от @${escapeHtml(msg.from?.username || msg.from?.first_name || 'слушателя')}\nВсего собрано: ${studio.cookiesTotal} ⭐`,
        parse_mode: 'HTML',
      });
    }
    return;
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const chatId = cb.message?.chat?.id;
    const chatType = cb.message?.chat?.type || 'private';
    const isPrivate = chatType === 'private';
    const isAdmin = env.ADMIN_CHAT_ID && String(cb.from?.id) === String(env.ADMIN_CHAT_ID);

    if (data === 'menu:cookie') {
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
      await sendCookiePicker(env, chatId, origin, isPrivate);
      return;
    }

    if (data === 'menu:projects') {
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
      await sendProjectsShowcase(env, chatId, origin, isPrivate);
      return;
    }

    if (data === 'grp:news') {
      const ok = await checkRateLimit(env, `rl:gnews:${chatId}`, 600, 1);
      if (!ok) {
        await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '⏳ Свежую новость можно вызывать раз в 10 минут' });
        return;
      }
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '🎙 Готовлю свежий разнос в чат...' });
      ctx.waitUntil(postTrackToGroup(env, chatId));
      return;
    }

    if (data === 'grp:roast') {
      const ok = await checkRateLimit(env, `rl:groast:${chatId}`, 300, 1);
      if (!ok) {
        await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '⏳ Перезарядка рифм 5 минут' });
        return;
      }
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '🎤 Сочиняю куплет про чат...' });
      ctx.waitUntil(sendGroupRoast(env, chatId));
      return;
    }

    if (data === 'menu:surprise') {
      const facts = [
        '🎤 В Зомби-Пульте можно включить бит 94 или 108 BPM и зачитать любой трек голосом поверх!',
        '💡 Напиши смешную новость боту — диджеи могут сделать из неё трек в канал!',
        '🎰 В нашем Forest Fortune 5x5 крутится 25 барабанов в стиле неонового Вегаса!',
        '🃏 Можно прямо сейчас срубить партию в Подкидного Дурака!',
        '🥂 Легенда гласит: кто накроет банкет за 10 000 ⭐, получит именной респект в канале.',
      ];
      const pick = facts[Math.floor(Math.random() * facts.length)];
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Лови фишку!' });
      const btn = isPrivate
        ? { text: '🎛 Открыть Звуковой Пульт', web_app: { url: `${origin}/` } }
        : { text: '🎛 Открыть Звуковой Пульт', url: origin };
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text: `✨ <b>Фишка студии:</b>\n${pick}`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[btn]] },
      });
      return;
    }

    if (data.startsWith('buy:')) {
      const packId = data.slice(4);
      const pack = COOKIE_PACKS[packId];
      if (!pack) {
        await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Набор не найден' });
        return;
      }
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: `Открываю счёт на ${pack.stars} ⭐` });
      await tgCall(env, 'sendInvoice', {
        chat_id: chatId,
        title: pack.title,
        description: pack.desc,
        payload: JSON.stringify({ pack: pack.id, src: 'bot', ts: Date.now() }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: pack.label, amount: pack.stars }],
      });
      return;
    }

    if (!isAdmin) {
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Только для продюсера студии' });
      return;
    }

    if (data === 'adm:draft' || data === 'adm:post') {
      const preview = data === 'adm:draft';
      await tgCall(env, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: preview ? 'Готовлю черновик...' : 'Генерирую выпуск в канал...',
      });
      ctx.waitUntil(runNewsCycle(env, { preview, style: 'auto', category: 'auto', source: 'admin_btn' }));
      return;
    }

    if (data === 'adm:toggle_mode') {
      const studio = await getStudioState(env);
      studio.mode = studio.mode === 'auto' ? 'draft' : 'auto';
      await saveStudioState(env, studio);
      await tgCall(env, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `Режим крона: ${studio.mode === 'auto' ? 'Автопост в канал' : 'Черновики в ЛС'}`,
      });
      await sendAdminMenu(env, chatId, origin);
      return;
    }

    if (data === 'adm:status') {
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
      await sendStatusMessage(env, chatId);
      return;
    }

    if (data === 'adm:inbox') {
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
      await sendInboxMessage(env, chatId);
      return;
    }

    if (data.startsWith('pub:')) {
      const draftId = data.slice(4);
      const draft = env.NEWS_KV ? await env.NEWS_KV.get(`draft:${draftId}`, 'json') : null;
      if (!draft) {
        await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Черновик устарел' });
        return;
      }
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Публикую в канал...' });
      await publishPostToChannel(env, draft);
      await env.NEWS_KV?.delete(`draft:${draftId}`);
      await tgCall(env, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Выпуск опубликован в ${getChannelUsername(env)}!`,
      });
      return;
    }

    if (data.startsWith('regen:')) {
      const draftId = data.slice(6);
      await env.NEWS_KV?.delete(`draft:${draftId}`);
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Переписываю в другом стиле...' });
      ctx.waitUntil(runNewsCycle(env, { preview: true, style: 'auto', category: 'auto', source: 'regen' }));
      return;
    }

    if (data.startsWith('drop:')) {
      const draftId = data.slice(5);
      await env.NEWS_KV?.delete(`draft:${draftId}`);
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Черновик удалён' });
      await tgCall(env, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      return;
    }

    await tgCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
    return;
  }

  if (!msg) return;
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  if (chatType === 'group' || chatType === 'supergroup') {
    await handleGroupMessage(msg, env, ctx, origin);
    return;
  }

  if (!msg.text || chatType !== 'private') return;
  const text = msg.text.trim();
  const isAdmin = env.ADMIN_CHAT_ID && String(msg.from?.id) === String(env.ADMIN_CHAT_ID);

  if (text.startsWith('/start')) {
    const param = text.split(/\s+/)[1] || '';
    if (param === 'cookie') {
      await sendCookiePicker(env, chatId, origin, true);
      return;
    }
    if (param === 'projects') {
      await sendProjectsShowcase(env, chatId, origin, true);
      return;
    }
    await sendWelcomeMessage(env, chatId, origin, isAdmin);
    return;
  }

  if (text === '/projects') {
    await sendProjectsShowcase(env, chatId, origin, true);
    return;
  }

  if (text === '/cookie') {
    await sendCookiePicker(env, chatId, origin, true);
    return;
  }

  if (text === '/status') {
    await sendStatusMessage(env, chatId);
    return;
  }

  if (text === '/news' || text === '/roast') {
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: 'Команды /news и /roast работают прямо в групповых чатах — добавь меня в группу и проверь! А здесь можно просто прислать тему для трека.',
    });
    return;
  }

  if (text === '/draft' || text === '/run') {
    if (!isAdmin) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: 'Эта команда только для админа студии.' });
      return;
    }
    const preview = text === '/draft';
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: preview ? '⏳ Готовлю черновик выпуска...' : '🚀 Запускаю внеочередной эфир в канал...',
    });
    ctx.waitUntil(runNewsCycle(env, { preview, style: 'auto', category: 'auto', source: 'cmd' }));
    return;
  }

  if (!text.startsWith('/')) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 6) {
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Напиши тему или смешную новость подлиннее (от 6 символов) — закину в предложку диджеям!',
      });
      return;
    }
    const allowed = await checkRateLimit(env, `rl:dm:${msg.from?.id || chatId}`, 600, 1);
    if (!allowed) {
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text: '⏳ Предложку можно отправлять раз в 10 минут — твой прошлый заказ уже в очереди!',
      });
      return;
    }
    const inbox = await getInbox(env);
    const author = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || 'Слушатель');
    inbox.unshift({
      id: crypto.randomUUID().slice(0, 8),
      text: clean.slice(0, 180),
      style: 'auto',
      author,
      ts: Date.now(),
    });
    await saveInbox(env, inbox.slice(0, 25));

    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: `💡 <b>Тема принята в студию!</b>\n«${escapeHtml(clean.slice(0, 180))}»\n\nЗагляни в пульт или попробуй наши игры 👇`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎛 Открыть Зомби-Пульт', web_app: { url: `${origin}/` } }],
          [{ text: '🎮 Наши игры и проекты', callback_data: 'menu:projects' }],
        ],
      },
    });
    if (env.ADMIN_CHAT_ID && !isAdmin) {
      await tgCall(env, 'sendMessage', {
        chat_id: env.ADMIN_CHAT_ID,
        text: `💡 <b>Предложка из ЛС</b> от ${escapeHtml(author)}:\n«${escapeHtml(clean.slice(0, 180))}»`,
        parse_mode: 'HTML',
      }).catch(() => {});
    }
  }
}

/* ---------------- Group AI Engine & Context Behavior ---------------- */

async function getGroupMemory(env, chatId) {
  const key = `grp:${chatId}`;
  if (GROUP_MEM.has(key)) return GROUP_MEM.get(key);
  const def = { messages: [], members: [], msgSinceBot: 0, lastBotTs: 0 };
  if (!env.NEWS_KV) {
    GROUP_MEM.set(key, def);
    return def;
  }
  const saved = await env.NEWS_KV.get(key, 'json');
  const state = saved ? { ...def, ...saved } : def;
  GROUP_MEM.set(key, state);
  return state;
}

async function saveGroupMemory(env, chatId, state, forceKv = false) {
  const key = `grp:${chatId}`;
  GROUP_MEM.set(key, state);
  if (!env.NEWS_KV) return;
  if (forceKv || state.msgSinceBot % 5 === 0) {
    await env.NEWS_KV.put(key, JSON.stringify(state), { expirationTtl: 86400 * 7 });
  }
}

async function handleGroupMessage(msg, env, ctx, origin) {
  const chatId = msg.chat.id;
  const botUsername = getBotUsername(env);

  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length > 0) {
    const joinedSelf = msg.new_chat_members.some(
      (m) => m.is_bot && (m.username || '').toLowerCase() === botUsername.toLowerCase()
    );
    if (joinedSelf) {
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text:
          `🧟‍♂️🎸 <b>Zombie-DJ и Дядя Коля зашли в чат!</b>\n` +
          `Мы следим за вайбом, подкидываем новости, можем зачитать рэп про участников (/roast), позвать в <b>Дурака</b> или проверить вашу удачу в <b>Слотах</b>.\n\n` +
          `<i>Совет админу: чтобы я понимал весь контекст чата, отключи Group Privacy в @BotFather или выдай мне права админа.</i>`,
        parse_mode: 'HTML',
        reply_markup: buildGroupActionMarkup('studio', env, origin),
      });
      return;
    }
    const human = msg.new_chat_members.find((m) => !m.is_bot);
    if (human) {
      const name = escapeHtml(human.first_name || human.username || 'боец');
      await tgCall(env, 'sendMessage', {
        chat_id: chatId,
        text: `👋 О, <b>${name}</b> заглянул в некро-бар! Садись ближе к пульту — хочешь в Дурака перекинемся или удачу в слотах проверим?`,
        parse_mode: 'HTML',
        reply_markup: buildGroupActionMarkup('durak', env, origin),
      });
    }
    return;
  }

  const rawText = (msg.text || msg.caption || '').trim();
  if (!rawText || msg.from?.is_bot) return;

  const cmd = rawText.split(/\s+/)[0].toLowerCase().replace(`@${botUsername.toLowerCase()}`, '');
  if (cmd === '/projects' || cmd === '/games' || cmd === '/start') {
    await sendProjectsShowcase(env, chatId, origin, false);
    return;
  }
  if (cmd === '/cookie') {
    await sendCookiePicker(env, chatId, origin, false);
    return;
  }
  if (cmd === '/news') {
    const ok = await checkRateLimit(env, `rl:gnews:${chatId}`, 600, 1);
    if (!ok) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: '⏳ Свежий выпуск в группу можно вызывать раз в 10 минут.' });
      return;
    }
    await tgCall(env, 'sendMessage', { chat_id: chatId, text: '🎙 Ща подгоню свежак по новостям...' });
    ctx.waitUntil(postTrackToGroup(env, chatId));
    return;
  }
  if (cmd === '/roast') {
    const ok = await checkRateLimit(env, `rl:groast:${chatId}`, 300, 1);
    if (!ok) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: '⏳ Дай диджеям 5 минут перевести дух перед новым треком про чат.' });
      return;
    }
    ctx.waitUntil(sendGroupRoast(env, chatId));
    return;
  }

  if (rawText.startsWith('/')) return;

  const senderName = msg.from?.first_name || msg.from?.username || 'Участник';
  const mem = await getGroupMemory(env, chatId);
  mem.messages.push({
    name: senderName.slice(0, 28),
    text: rawText.slice(0, 160),
    ts: Date.now(),
  });
  mem.messages = mem.messages.slice(-14);
  if (!mem.members.includes(senderName)) {
    mem.members = [senderName, ...mem.members].slice(0, 15);
  }
  mem.msgSinceBot = (mem.msgSinceBot || 0) + 1;

  const lower = rawText.toLowerCase();
  const isReplyToBot = Boolean(msg.reply_to_message?.from?.is_bot);
  const isMention = lower.includes(`@${botUsername.toLowerCase()}`) || /(^|\s)(зомби|дядя коля|диджей|zombie)(\s|[,.!?]|$)/i.test(lower);
  const isKeywordTrigger = /(скучно|во что поиграть|в картишки|в дурака|проверить удачу|слоты|крутануть|новост)/i.test(lower);

  const now = Date.now();
  const sinceReplyMs = now - (mem.lastBotTs || 0);
  const direct = isReplyToBot || isMention || isKeywordTrigger;
  const spontaneous = !direct && mem.msgSinceBot >= 10 && sinceReplyMs > 10 * 60 * 1000;

  if (!direct && !spontaneous) {
    await saveGroupMemory(env, chatId, mem, false);
    return;
  }

  if (direct && sinceReplyMs < 15000) {
    await saveGroupMemory(env, chatId, mem, false);
    return;
  }

  mem.msgSinceBot = 0;
  mem.lastBotTs = now;
  await saveGroupMemory(env, chatId, mem, true);

  ctx.waitUntil(respondInGroupWithAI(env, chatId, msg.message_id, senderName, rawText, mem, origin));
}

async function respondInGroupWithAI(env, chatId, replyToId, senderName, currentText, mem, origin) {
  const history = mem.messages.slice(-12).map((m) => `${m.name}: ${m.text}`).join('\n');
  const prompt =
    `Ты — харизматичный ведущий чата (выбирай по ситуации голос дерзкого Zombie-DJ или ироничного гитариста Дяди Коли Мертвеца).\n` +
    `Вот последние сообщения участников группы:\n${history}\n\n` +
    `Сейчас написал(а) ${senderName}: "${currentText}".\n` +
    `Ответь естественно, живо и коротко (1–3 предложения на русском), учитывая имена участников и тему разговора.\n` +
    `Можешь подстегнуть участников, пошутить или органично предложить одну из активностей студии:\n` +
    `- durak: "срубить в картишки в Дурака"\n` +
    `- slots: "проверить удачу в слотах Forest Fortune 5x5 или Lucky Roger"\n` +
    `- news: "подкинуть свежий сатирический выпуск новостей"\n` +
    `- studio: "покрутить живой бит в Зомби-Пульте"\n` +
    `- cookie: "угостить диджеев печеньем"\n` +
    `- none: если сейчас уместнее просто меткая реплика без призыва.\n\n` +
    `Верни СТРОГО JSON: {"reply": "текст ответа", "action": "durak|slots|news|studio|cookie|none"}`;

  try {
    const out = await callGeminiJson(env, prompt, {
      type: 'OBJECT',
      properties: {
        reply: { type: 'STRING' },
        action: { type: 'STRING' },
      },
      required: ['reply', 'action'],
    });
    if (!out?.reply) return;
    const action = ['durak', 'slots', 'news', 'studio', 'cookie', 'none'].includes(out.action) ? out.action : 'none';
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      reply_to_message_id: replyToId,
      text: escapeHtml(String(out.reply).slice(0, 700)),
      parse_mode: 'HTML',
      reply_markup: buildGroupActionMarkup(action, env, origin),
    });
  } catch {}
}

async function sendGroupRoast(env, chatId) {
  const mem = await getGroupMemory(env, chatId);
  const history = mem.messages.slice(-12).map((m) => `${m.name}: ${m.text}`).join('\n') || 'В чате пока тишина, все греют диван.';
  const prompt =
    `Ты — Zombie-DJ и Дядя Коля Мертвец. Напиши короткий смешной и дружелюбный куплет (6 строк в рифму, без мата) про участников этого чата на основе их переписки:\n${history}\n\n` +
    `Верни СТРОГО JSON: {"title": "заголовок до 50 символов", "verse": "6 строк через \\n"}`;

  try {
    const out = await callGeminiJson(env, prompt, {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        verse: { type: 'STRING' },
      },
      required: ['title', 'verse'],
    });
    if (!out?.verse) return;
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: `🎤 <b>${escapeHtml(out.title || 'Куплет про наш чат')}</b>\n\n${escapeHtml(out.verse)}`,
      parse_mode: 'HTML',
      reply_markup: buildGroupActionMarkup('studio', env),
    });
  } catch {}
}

async function postTrackToGroup(env, chatId) {
  try {
    const studio = await getStudioState(env);
    const cat = pickNextCategory(studio);
    const style = pickNextStyle(studio);
    const story = await fetchFreshStory(env, cat, studio.seenIds || []);
    if (!story) {
      await tgCall(env, 'sendMessage', { chat_id: chatId, text: 'Сегодня RSS-ленты молчат, попробуй позже!' });
      return;
    }
    const track = await generateTrackWithGemini(env, story, style);
    const caption =
      `${STYLE_LABELS[style]} · ${CATEGORY_LABELS[cat]}\n\n` +
      `<b>${escapeHtml(track.headline)}</b>\n\n` +
      `${escapeHtml(track.lyrics)}\n\n` +
      `💬 <i>${escapeHtml(track.punchline)}</i>`;

    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text: caption.slice(0, 3900),
      parse_mode: 'HTML',
      reply_markup: buildGroupActionMarkup('news', env),
    });
  } catch {}
}

function buildGroupActionMarkup(action, env, origin = '') {
  const bot = getBotUsername(env);
  const durakUrl = getDurakUrl(env);
  const slotsBot = getSlotsBot(env);
  const rogerUrl = getRogerUrl(env);
  const channel = getChannelUsername(env).replace(/^@/, '');

  if (action === 'durak') {
    return {
      inline_keyboard: [[
        { text: '🃏 Срубить в Дурака', url: durakUrl },
        { text: '🎰 Слоты 5x5', url: `https://t.me/${slotsBot}` },
      ]],
    };
  }
  if (action === 'slots') {
    return {
      inline_keyboard: [[
        { text: '🎰 Forest Fortune 5x5', url: `https://t.me/${slotsBot}` },
        { text: '🏴‍☠️ Lucky Roger', url: rogerUrl },
      ]],
    };
  }
  if (action === 'news') {
    return {
      inline_keyboard: [[
        { text: '📰 Ещё выпуск', callback_data: 'grp:news' },
        { text: '📢 Канал', url: `https://t.me/${channel}` },
      ]],
    };
  }
  if (action === 'studio') {
    return {
      inline_keyboard: [[
        { text: '🎛 Звуковой пульт', url: origin || `https://t.me/${bot}` },
        { text: '🃏 В Дурака', url: durakUrl },
      ]],
    };
  }
  if (action === 'cookie') {
    return {
      inline_keyboard: [[
        { text: '🍩 Угостить диджеев', url: `https://t.me/${bot}?start=cookie` },
      ]],
    };
  }
  return undefined;
}

/* ---------------- Welcome, Showcase & Admin Menus ---------------- */

async function sendWelcomeMessage(env, chatId, origin, isAdmin) {
  const channel = getChannelUsername(env);
  const slotsBot = getSlotsBot(env);
  const durakUrl = getDurakUrl(env);

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `🧟‍♂️ <b>Добро пожаловать в студию iField!</b>\n` +
      `Выбирай, во что зарубиться прямо сейчас:\n\n` +
      `🎛 <b>Зомби-Пульт</b> — живой бит-синтезатор, пады, озвучка треков и предложка тем.\n` +
      `🎰 <b>Forest Fortune 5x5</b> — наши слоты в стиле Лас-Вегас.\n` +
      `🃏 <b>Подкидной Дурак</b> — карточная битва студии.\n` +
      `👥 Добавь меня в групповой чат — буду болтать с участниками, травить куплеты и звать играть!\n` +
      `💬 Напиши сюда любую новость или идею — диджеи могут записать про неё трек!`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎛 Открыть Зомби-Пульт со звуком', web_app: { url: `${origin}/` } }],
        [
          { text: '🎰 Слоты 5x5', url: `https://t.me/${slotsBot}` },
          { text: '🃏 Подкидной Дурак', url: durakUrl },
        ],
        [
          { text: '🎲 Фишка студии', callback_data: 'menu:surprise' },
          { text: '🍩 Печенье / Банкет', callback_data: 'menu:cookie' },
        ],
        [
          { text: '🎮 Все проекты', callback_data: 'menu:projects' },
          { text: `📢 ${channel}`, url: `https://t.me/${channel.replace(/^@/, '')}` },
        ],
      ],
    },
  });
  if (isAdmin) {
    await sendAdminMenu(env, chatId, origin);
  }
}

async function sendProjectsShowcase(env, chatId, origin, isPrivate = true) {
  const slotsUrl = getSlotsUrl(env);
  const slotsBot = getSlotsBot(env);
  const rogerUrl = getRogerUrl(env);
  const durakUrl = getDurakUrl(env);
  const musicUrl = getMusicUrl(env);
  const channel = getChannelUsername(env);

  const studioBtn = isPrivate
    ? { text: '🎛 Звуковой Пульт', web_app: { url: `${origin}/` } }
    : { text: '🎛 Звуковой Пульт', url: origin };

  const slotsWebBtn = isPrivate
    ? { text: '🎰 Слоты 5x5 (Веб)', web_app: { url: slotsUrl } }
    : { text: '🎰 Слоты 5x5 (Бот)', url: `https://t.me/${slotsBot}` };

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `🎮 <b>Витрина проектов студии iField</b>\n\n` +
      `1. 🎛 <b>Zombie News Flava</b> — сатирический AI-эфир, бит-машина и предложка треков.\n` +
      `2. 🎰 <b>Forest Fortune 5x5</b> — 25-барабанный неоновый слот.\n` +
      `3. 🏴‍☠️ <b>Lucky Roger Slot</b> — пиратский слот.\n` +
      `4. 🃏 <b>Подкидной Дурак</b> — карточный стол.\n` +
      `5. 🎵 <b>iField Music Lab</b> — музыкальная лаборатория.`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [studioBtn],
        [
          slotsWebBtn,
          { text: '🏴‍☠️ Lucky Roger', url: rogerUrl },
        ],
        [
          { text: '🃏 Подкидной Дурак', url: durakUrl },
          { text: '🎵 Music Lab', url: musicUrl },
        ],
        [
          { text: '🍩 На печенье', callback_data: 'menu:cookie' },
          { text: `📢 ${channel}`, url: `https://t.me/${channel.replace(/^@/, '')}` },
        ],
      ],
    },
  });
}

async function sendAdminMenu(env, chatId, origin) {
  const studio = await getStudioState(env);
  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `🎛 <b>Панель продюсера</b>\n` +
      `Режим крона (09:00 / 21:00 UTC): <b>${studio.mode === 'auto' ? 'Автопост в канал' : 'Черновик в ЛС'}</b>\n` +
      `Выпусков: <b>${studio.totalPosts}</b> · Печенья: <b>${studio.cookiesTotal} ⭐</b>`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Черновик сейчас', callback_data: 'adm:draft' },
          { text: '🚀 Пост в канал', callback_data: 'adm:post' },
        ],
        [
          { text: `⚙️ Режим: ${studio.mode === 'auto' ? 'Авто' : 'Черновик'}`, callback_data: 'adm:toggle_mode' },
          { text: '📥 Предложка', callback_data: 'adm:inbox' },
        ],
        [
          { text: '📊 Статус', callback_data: 'adm:status' },
          { text: '🎛 Студия', web_app: { url: `${origin}/` } },
        ],
      ],
    },
  });
}

async function sendCookiePicker(env, chatId, origin, isPrivate = true) {
  const studio = await getStudioState(env);
  const bot = getBotUsername(env);

  if (!isPrivate) {
    await tgCall(env, 'sendMessage', {
      chat_id: chatId,
      text:
        `🍩 <b>Диджеям на печенье и банкет</b>\n` +
        `Всего собрано: <b>${studio.cookiesTotal} ⭐</b> · Бесплатных: <b>${studio.freeCookies} 🍪</b>\n` +
        `Жми кнопку ниже — открою кассу в ЛС без лишних окон в группе!`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🍩 Угостить в боте (Stars)', url: `https://t.me/${bot}?start=cookie` }]],
      },
    });
    return;
  }

  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `🍩 <b>Диджеям на печенье и банкет</b>\n` +
      `Выбери угощение Stars ниже или открой <b>Зомби-Пульт</b>, чтобы поддержать студию в одно касание без лишних сообщений в чате.\n\n` +
      `Всего собрано: <b>${studio.cookiesTotal} ⭐</b> · Бесплатных печенек: <b>${studio.freeCookies} 🍪</b>`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🍪 50 ⭐', callback_data: 'buy:cookie_50' },
          { text: '🍩 150 ⭐', callback_data: 'buy:cookie_150' },
          { text: '👑 500 ⭐', callback_data: 'buy:cookie_500' },
        ],
        [{ text: '🥂 Накрыть диджеям банкет · 10 000 ⭐', callback_data: 'buy:banquet_10000' }],
        [{ text: '🎛 Открыть в Mini App', web_app: { url: `${origin}/?tab=cookie` } }],
      ],
    },
  });
}

async function sendStatusMessage(env, chatId) {
  const studio = await getStudioState(env);
  const inbox = await getInbox(env);
  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `📊 <b>Статус студии</b>\n` +
      `Workers AI: ${env.AI ? '✅ подключен' : '⚠️ нет [ai] binding'}\n` +
      `KV: ${env.NEWS_KV ? '✅ подключен' : '⚠️ нет NEWS_KV'}\n` +
      `Gemini: ${env.GEMINI_API_KEY ? '✅ ключ задан' : '⚠️ нет ключа'}\n` +
      `Озвучка TTS: ${env.VOICE_ENABLED === 'false' ? '⏸ выкл' : '🔊 авто (Gemini TTS)'}\n` +
      `Режим крона: <b>${studio.mode === 'auto' ? 'Автопост' : 'Черновик'}</b>\n` +
      `Выпусков: <b>${studio.totalPosts}</b>\n` +
      `Stars на печенье: <b>${studio.cookiesTotal} ⭐</b> (${studio.cookiesCount} донат.)\n` +
      `Бесплатных печенек: <b>${studio.freeCookies} 🍪</b>\n` +
      `В предложке: <b>${inbox.length}</b> тем`,
    parse_mode: 'HTML',
  });
}

async function sendInboxMessage(env, chatId) {
  const inbox = await getInbox(env);
  if (!inbox.length) {
    await tgCall(env, 'sendMessage', { chat_id: chatId, text: '📥 Предложка пока пуста.' });
    return;
  }
  const lines = inbox.slice(0, 8).map((x, i) => `${i + 1}. <b>${escapeHtml(x.author)}</b>: ${escapeHtml(x.text)}`);
  await tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text: `📥 <b>Темы от слушателей (${inbox.length})</b>:\n\n${lines.join('\n')}`,
    parse_mode: 'HTML',
  });
}

/* ---------------- News Pipeline, Gemini & Workers AI ---------------- */

async function runNewsCycle(env, opts = {}) {
  const studio = await getStudioState(env);
  const isPreview = Boolean(opts.preview || (opts.source === 'cron' && studio.mode === 'draft'));

  const pickedStyle = STYLES.includes(opts.style)
    ? opts.style
    : pickNextStyle(studio);

  const pickedCategory = CATEGORIES.includes(opts.category)
    ? opts.category
    : pickNextCategory(studio);

  try {
    let story = null;
    const inbox = await getInbox(env);
    if (inbox.length > 0 && (studio.totalPosts % 3 === 2 || opts.source === 'manual_inbox')) {
      const reqItem = inbox.shift();
      await saveInbox(env, inbox);
      story = {
        id: `inbox:${reqItem.id}`,
        title: reqItem.text,
        summary: `Заказ от слушателя ${reqItem.author}`,
        source: `Предложка (${reqItem.author})`,
        link: `https://t.me/${getBotUsername(env)}`,
        category: pickedCategory,
        fromInbox: true,
      };
    }

    if (!story) {
      story = await fetchFreshStory(env, pickedCategory, studio.seenIds || []);
      if (!story) {
        for (const altCat of CATEGORIES) {
          if (altCat === pickedCategory) continue;
          story = await fetchFreshStory(env, altCat, studio.seenIds || []);
          if (story) break;
        }
      }
    }

    if (!story) {
      if (env.ADMIN_CHAT_ID) {
        await tgCall(env, 'sendMessage', {
          chat_id: env.ADMIN_CHAT_ID,
          text: '⚠️ Не удалось получить свежую новость из RSS-лент. Попробуй позже.',
        });
      }
      return;
    }

    const track = await generateTrackWithGemini(env, story, pickedStyle);
    const [imgBytes, voiceBytes] = await Promise.all([
      generateCoverImage(env, env.AI ? track.imagePrompt : null, track.imagePrompt),
      tryGenerateVoiceWithGemini(env, track, pickedStyle),
    ]);

    const postRecord = {
      id: crypto.randomUUID().slice(0, 8),
      storyId: story.id,
      style: pickedStyle,
      category: story.category,
      headline: track.headline,
      lyrics: track.lyrics,
      punchline: track.punchline,
      source: story.source,
      sourceUrl: story.link,
      imagePrompt: track.imagePrompt,
      ts: Date.now(),
      reactions: { fire: 0, skull: 0, rock: 0 },
    };

    if (isPreview && env.ADMIN_CHAT_ID) {
      const sent = await sendPostMessage(env, env.ADMIN_CHAT_ID, postRecord, imgBytes, {
        isDraft: true,
      });
      const photoFileId = sent?.result?.photo?.slice(-1)?.[0]?.file_id || null;
      let audioFileId = null;
      if (voiceBytes && voiceBytes.byteLength > 1024) {
        const audioSent = await sendTrackAudio(env, env.ADMIN_CHAT_ID, postRecord, voiceBytes);
        audioFileId = audioSent?.result?.audio?.file_id || null;
      }
      if (env.NEWS_KV) {
        await env.NEWS_KV.put(
          `draft:${postRecord.id}`,
          JSON.stringify({ ...postRecord, photoFileId, audioFileId }),
          { expirationTtl: 86400 }
        );
      }
      return;
    }

    await publishPostToChannel(env, postRecord, imgBytes, voiceBytes);
  } catch (err) {
    if (env.ADMIN_CHAT_ID) {
      await tgCall(env, 'sendMessage', {
        chat_id: env.ADMIN_CHAT_ID,
        text: `⚠️ Ошибка выпуска:\n<code>${escapeHtml((err?.message || String(err)).slice(0, 1200))}</code>`,
        parse_mode: 'HTML',
      }).catch(() => {});
    }
  }
}

async function publishPostToChannel(env, postRecord, imgBytes = null, voiceBytes = null) {
  const channel = getChannelUsername(env);
  const sent = await sendPostMessage(env, channel, postRecord, imgBytes, { isDraft: false });
  if (!sent?.ok) {
    throw new Error(`Telegram send failed: ${sent?.description || 'unknown'}`);
  }

  if (postRecord.audioFileId) {
    await tgCall(env, 'sendAudio', {
      chat_id: channel,
      audio: postRecord.audioFileId,
      title: postRecord.headline.slice(0, 60),
      performer: STYLE_LABELS[postRecord.style] || 'Zombie News Flava',
    }).catch(() => {});
  } else if (voiceBytes && voiceBytes.byteLength > 1024) {
    await sendTrackAudio(env, channel, postRecord, voiceBytes).catch(() => {});
  }

  const msgId = sent?.result?.message_id;
  const cleanChannel = channel.replace(/^@/, '');
  const tgUrl = msgId ? `https://t.me/${cleanChannel}/${msgId}` : `https://t.me/${cleanChannel}`;

  const studio = await getStudioState(env);
  studio.totalPosts = (studio.totalPosts || 0) + 1;
  studio.lastStyle = postRecord.style;
  studio.lastCategory = postRecord.category;
  studio.seenIds = [postRecord.storyId, ...(studio.seenIds || [])].slice(0, 80);
  studio.recentPosts = [
    {
      id: postRecord.id,
      style: postRecord.style,
      category: postRecord.category,
      headline: postRecord.headline,
      lyrics: postRecord.lyrics,
      punchline: postRecord.punchline,
      source: postRecord.source,
      tgUrl,
      ts: postRecord.ts,
      reactions: { fire: 0, skull: 0, rock: 0 },
    },
    ...(studio.recentPosts || []),
  ].slice(0, 8);
  await saveStudioState(env, studio);
}

async function sendPostMessage(env, chatId, post, imgBytes, { isDraft }) {
  const botUsername = getBotUsername(env);
  const styleTitle = STYLE_LABELS[post.style] || post.style;
  const catTitle = CATEGORY_LABELS[post.category] || post.category;

  const safeHeadline = escapeHtml(String(post.headline || '').slice(0, 100));
  const safeLyrics = escapeHtml(String(post.lyrics || '').slice(0, 620));
  const safePunch = escapeHtml(String(post.punchline || '').slice(0, 130));
  const safeSource = escapeHtml(String(post.source || '').slice(0, 48));

  const caption =
    `${styleTitle} · ${catTitle}\n\n` +
    `<b>${safeHeadline}</b>\n\n` +
    `${safeLyrics}\n\n` +
    `💬 <i>${safePunch}</i>\n` +
    `📰 Источник: ${safeSource}`;

  const reply_markup = isDraft
    ? {
        inline_keyboard: [
          [
            { text: '✅ В канал', callback_data: `pub:${post.id}` },
            { text: '🔄 Переписать', callback_data: `regen:${post.id}` },
            { text: '🗑 Отмена', callback_data: `drop:${post.id}` },
          ],
        ],
      }
    : {
        inline_keyboard: [
          [
            { text: '🍩 Печенье и банкет', url: `https://t.me/${botUsername}?start=cookie` },
            { text: '🎛 Пульт и игры', url: `https://t.me/${botUsername}?start=studio` },
          ],
        ],
      };

  if (post.photoFileId) {
    return tgCall(env, 'sendPhoto', {
      chat_id: chatId,
      photo: post.photoFileId,
      caption,
      parse_mode: 'HTML',
      reply_markup,
    });
  }

  if (imgBytes && imgBytes.byteLength > 512) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('reply_markup', JSON.stringify(reply_markup));
    form.append('photo', new Blob([imgBytes], { type: 'image/png' }), 'cover.png');
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    return r.json();
  }

  return tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text: caption,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup,
  });
}

async function sendTrackAudio(env, chatId, post, wavBytes) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('title', (post.headline || 'Zombie Track').slice(0, 60));
  form.append('performer', STYLE_LABELS[post.style] || 'Zombie News Flava');
  form.append('caption', '🎙 Голосовая озвучка выпуска');
  form.append('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'track.wav');
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
    method: 'POST',
    body: form,
  });
  return r.json();
}

async function tryGenerateVoiceWithGemini(env, track, style) {
  if (env.VOICE_ENABLED === 'false') return null;
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;

  try {
    const voiceName = style === 'chanson' ? 'Charon' : 'Fenrir';
    const speakText = `${track.headline}. ${track.lyrics}`.slice(0, 520);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TTS_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: speakText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) return null;
    return base64ToArrayBuffer(b64);
  } catch {
    return null;
  }
}

async function fetchFreshStory(env, category, seenIds) {
  const feedsByCategory = {
    weird: [
      { name: 'Oddity Central', url: 'https://www.odditycentral.com/feed' },
      { name: 'Reddit r/nottheonion', url: 'https://www.reddit.com/r/nottheonion/hot.json?limit=12', type: 'reddit' },
    ],
    crypto: [
      { name: 'ForkLog', url: 'https://forklog.com/feed/' },
      { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
    ],
    showbiz: [
      { name: 'TMZ', url: 'https://www.tmz.com/rss.xml' },
      { name: 'Variety', url: 'https://variety.com/feed/' },
    ],
    tech: [
      { name: 'Habr', url: 'https://habr.com/ru/rss/articles/?fl=ru' },
      { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
    ],
  };

  const feeds = feedsByCategory[category] || feedsByCategory.weird;
  const seen = new Set(seenIds);

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;

      if (feed.type === 'reddit') {
        const json = await res.json();
        const posts = (json?.data?.children || []).map((c) => c.data).filter((d) => d && !d.stickied && d.title);
        for (const p of posts) {
          const id = `rd:${p.id}`;
          if (!seen.has(id)) {
            return {
              id,
              title: p.title,
              summary: (p.selftext || '').slice(0, 280),
              source: feed.name,
              link: `https://reddit.com${p.permalink}`,
              category,
            };
          }
        }
        continue;
      }

      const xml = await res.text();
      const items = parseRssItems(xml);
      for (const item of items) {
        if (feed.name === 'Hacker News' && !/(ai|gpt|robot|apple|crypto|hack|space|quantum|chip|cyber)/i.test(item.title)) {
          continue;
        }
        const id = `rss:${simpleHash(item.link || item.title)}`;
        if (!seen.has(id)) {
          return {
            id,
            title: item.title,
            summary: item.desc.slice(0, 320),
            source: feed.name,
            link: item.link,
            category,
          };
        }
      }
    } catch {}
  }

  return null;
}

async function callGeminiJson(env, prompt, schema) {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Не задан GEMINI_API_KEY в Cloudflare Secrets');

  const models = [];
  if (env.GEMINI_MODEL && env.GEMINI_MODEL.trim()) {
    models.push(env.GEMINI_MODEL.trim());
  }
  for (const m of GEMINI_MODELS) {
    if (!models.includes(m)) models.push(m);
  }

  const errors = [];
  let saw404 = false;

  for (const model of models) {
    for (const useSchema of [true, false]) {
      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: useSchema
          ? { responseMimeType: 'application/json', responseSchema: schema }
          : { responseMimeType: 'application/json' },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 404) saw404 = true;
        errors.push(`${model} (${res.status}): ${errText.slice(0, 220)}`);
        if (res.status === 400 && useSchema) continue;
        break;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = extractJsonObject(rawText);
      if (parsed) return parsed;
      errors.push(`${model}: не удалось разобрать JSON ответа`);
    }
  }

  if (saw404) {
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        const names = (listData.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, ''))
          .slice(0, 12);
        errors.push(`Доступные модели ключа: ${names.join(', ') || 'нет'}`);
      }
    } catch {}
  }

  throw new Error(`Gemini не ответил:\n${errors.join('\n')}`);
}

async function generateTrackWithGemini(env, story, style) {
  const personaGuide = style === 'rap'
    ? 'Ты — дерзкий уличный рэпер Zombie-DJ из кибер-подворотни. Пиши 8–10 ритмичных строк с плотными рифмами, уличным юмором и сатирой.'
    : style === 'chanson'
    ? 'Ты — Дядя Коля Мертвец, ветеран неоновых рюмочных. Пиши 8–10 душевных ироничных строк в духе кибер-шансона под гитару (про судьбу, провода, общак и абсурд).'
    : 'Устрой короткий рэп-баттл (8–10 строк): 4 строки читает Zombie-DJ (🎤), потом 4–5 строк отвечает Дядя Коля Мертвец (🎸).';

  const prompt =
    `${personaGuide}\n` +
    `Новость (${story.source}): "${story.title}".\n` +
    `Контекст: ${story.summary || 'без доп. деталей'}.\n\n` +
    `Верни СТРОГО JSON с полями:\n` +
    `- headline: цепляющий заголовок на русском до 75 символов\n` +
    `- lyrics: текст трека на русском (8-10 строк через \\n, без мата, но остро и смешно)\n` +
    `- punchline: одна финальная колкая фраза-вывод до 100 символов\n` +
    `- imagePrompt: детальный промпт на английском для обложки (dark underground cyberpunk illustration, vivid lighting, without any text or letters on the image)`;

  const parsed = await callGeminiJson(env, prompt, {
    type: 'OBJECT',
    properties: {
      headline: { type: 'STRING' },
      lyrics: { type: 'STRING' },
      punchline: { type: 'STRING' },
      imagePrompt: { type: 'STRING' },
    },
    required: ['headline', 'lyrics', 'punchline', 'imagePrompt'],
  });

  if (!parsed?.headline || !parsed?.lyrics) {
    throw new Error('Gemini вернул неполный трек');
  }

  return {
    headline: String(parsed.headline).slice(0, 100),
    lyrics: String(parsed.lyrics).slice(0, 620),
    punchline: String(parsed.punchline || 'Такие новости на трезвую голову не читаются.').slice(0, 130),
    imagePrompt: String(parsed.imagePrompt || `cyberpunk zombie dj radio studio neon art about ${story.title}`),
  };
}

async function generateCoverImage(env, prompt, fallbackPrompt) {
  if (!env.AI || !prompt) return null;
  const cleanPrompt = `${prompt || fallbackPrompt}, high contrast stylized album cover art, no text, no watermark`.slice(0, 420);

  for (const model of WORKERS_AI_IMAGE_MODELS) {
    try {
      const out = await env.AI.run(model, { prompt: cleanPrompt, num_steps: 4 });
      if (!out) continue;
      if (out instanceof ReadableStream) {
        return await new Response(out).arrayBuffer();
      }
      if (out instanceof ArrayBuffer) return out;
      if (ArrayBuffer.isView(out)) return out.buffer;
      if (typeof out.image === 'string') {
        return base64ToArrayBuffer(out.image);
      }
    } catch {}
  }
  return null;
}

/* ---------------- State & Helpers ---------------- */

async function getStudioState(env) {
  const def = {
    mode: 'auto',
    totalPosts: 0,
    lastStyle: 'battle',
    lastCategory: 'tech',
    cookiesTotal: 0,
    cookiesCount: 0,
    freeCookies: 0,
    seenIds: [],
    recentPosts: [],
    votes: { rap: 0, chanson: 0, battle: 0 },
  };
  if (!env.NEWS_KV) return def;
  const saved = await env.NEWS_KV.get('state:studio', 'json');
  if (saved) {
    return {
      ...def,
      ...saved,
      votes: { ...def.votes, ...(saved.votes || {}) },
      recentPosts: Array.isArray(saved.recentPosts) ? saved.recentPosts : [],
      seenIds: Array.isArray(saved.seenIds) ? saved.seenIds : [],
    };
  }
  const legacy = await env.NEWS_KV.get('state:history', 'json');
  if (legacy) {
    return {
      ...def,
      mode: legacy.mode || 'auto',
      totalPosts: legacy.totalPosts || 0,
      cookiesTotal: legacy.cookiesTotal || 0,
      cookiesCount: legacy.cookiesCount || 0,
      seenIds: Array.isArray(legacy.seenIds) ? legacy.seenIds : [],
    };
  }
  return def;
}

async function saveStudioState(env, state) {
  if (!env.NEWS_KV) return;
  await env.NEWS_KV.put('state:studio', JSON.stringify(state));
}

async function addStarsCookie(env, stars) {
  const studio = await getStudioState(env);
  studio.cookiesTotal = (studio.cookiesTotal || 0) + Number(stars || 0);
  studio.cookiesCount = (studio.cookiesCount || 0) + 1;
  await saveStudioState(env, studio);
  return studio;
}

async function getInbox(env) {
  if (!env.NEWS_KV) return [];
  const data = await env.NEWS_KV.get('state:inbox', 'json');
  return Array.isArray(data) ? data : [];
}

async function saveInbox(env, items) {
  if (!env.NEWS_KV) return;
  await env.NEWS_KV.put('state:inbox', JSON.stringify(items));
}

async function checkRateLimit(env, key, ttlSeconds, maxHits) {
  if (!env.NEWS_KV) return true;
  const raw = await env.NEWS_KV.get(key);
  const count = Number(raw || 0);
  if (count >= maxHits) return false;
  await env.NEWS_KV.put(key, String(count + 1), { expirationTtl: Math.max(60, ttlSeconds) });
  return true;
}

function pickNextStyle(studio) {
  const votes = studio.votes || {};
  const maxVote = Math.max(votes.rap || 0, votes.chanson || 0, votes.battle || 0);
  if (maxVote >= 3) {
    const winner = STYLES.find((s) => (votes[s] || 0) === maxVote);
    if (winner) return winner;
  }
  const idx = STYLES.indexOf(studio.lastStyle);
  return STYLES[(idx + 1) % STYLES.length];
}

function pickNextCategory(studio) {
  const idx = CATEGORIES.indexOf(studio.lastCategory);
  return CATEGORIES[(idx + 1) % CATEGORIES.length];
}

async function getRunKey(env) {
  if (env.RUN_SECRET) return env.RUN_SECRET.trim();
  const seed = `${env.TELEGRAM_BOT_TOKEN || 'zombie'}:run_v2`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function getWebhookSecret(env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET.trim();
  const seed = `${env.TELEGRAM_BOT_TOKEN || 'zombie'}:wh_v2`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function getBotUsername(env) {
  return (env.BOT_USERNAME || DEFAULT_BOT).replace(/^@/, '').trim();
}

function getChannelUsername(env) {
  const raw = (env.TELEGRAM_CHAT_ID || env.CHANNEL_USERNAME || DEFAULT_CHANNEL).trim();
  return raw.startsWith('@') || raw.startsWith('-') ? raw : `@${raw}`;
}

function getSlotsUrl(env) {
  return (env.SLOTS_URL || DEFAULT_SLOTS_URL).trim();
}

function getSlotsBot(env) {
  return (env.SLOTS_BOT || DEFAULT_SLOTS_BOT).replace(/^@/, '').trim();
}

function getRogerUrl(env) {
  return (env.ROGER_URL || DEFAULT_ROGER_URL).trim();
}

function getDurakUrl(env) {
  return (env.DURAK_URL || DEFAULT_DURAK_URL).trim();
}

function getMusicUrl(env) {
  return (env.MUSIC_URL || DEFAULT_MUSIC_URL).trim();
}

async function tgCall(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'Missing TELEGRAM_BOT_TOKEN' };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseRssItems(xml) {
  const items = [];
  const itemMatches = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
  for (const block of itemMatches.slice(0, 12)) {
    const title = decodeXml(extractTag(block, 'title'));
    const link = decodeXml(extractTag(block, 'link') || extractAttr(block, 'link', 'href'));
    const desc = decodeXml(extractTag(block, 'description') || extractTag(block, 'summary') || '');
    if (title && link) {
      items.push({
        title: title.replace(/<[^>]+>/g, '').trim(),
        link: link.trim(),
        desc: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* ---------------- Interactive Sound Studio Mini App HTML ---------------- */

function renderHtml(cfg) {
  const bot = escapeHtml(cfg.bot);
  const channel = escapeHtml(cfg.channel);
  const cleanChannel = channel.replace(/^@/, '');
  const apiBase = escapeHtml(cfg.apiBase);
  const slotsBot = escapeHtml(cfg.slotsBot);
  const slotsUrl = escapeHtml(cfg.slotsUrl);
  const rogerUrl = escapeHtml(cfg.rogerUrl);
  const durakUrl = escapeHtml(cfg.durakUrl);
  const musicUrl = escapeHtml(cfg.musicUrl);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>Zombie News Flava — Звуковая Студия</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Outfit:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b0d10;
      --surface: #131720;
      --surface-2: #191f2b;
      --line: rgba(255, 255, 255, 0.08);
      --text: #f3f6fa;
      --muted: #9aa6b8;
      --lime: #2ee58a;
      --lime-ink: #071910;
      --gold: #f5b74f;
      --gold-ink: #221604;
      --radius: 18px;
      --safe-b: env(safe-area-inset-bottom, 0px);
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      overflow-x: hidden;
    }
    .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
    h1, h2, h3 {
      font-family: 'Outfit', sans-serif;
      margin: 0;
      text-wrap: balance;
      letter-spacing: -0.01em;
    }
    button, input, textarea { font-family: inherit; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 30;
      height: 52px;
      padding: 0 16px;
      background: rgba(11, 13, 16, 0.88);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      font-size: 17px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .brand span { color: var(--gold); }
    .top-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .icon-btn {
      min-height: 40px;
      min-width: 44px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 0.15s cubic-bezier(0.16,1,0.3,1), border-color 0.15s;
    }
    .icon-btn:active { transform: scale(0.96); }
    .icon-btn.sound-on { border-color: rgba(46,229,138,0.45); color: var(--lime); }
    .icon-btn.gold-btn { background: var(--gold); color: var(--gold-ink); border-color: transparent; }

    .wrap {
      max-width: 1040px;
      margin: 0 auto;
      padding: 16px 16px calc(86px + var(--safe-b));
    }
    .hero {
      padding: 8px 0 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .hero-meta { font-size: 13px; color: var(--muted); }
    .hero h1 { font-size: clamp(26px, 6vw, 38px); line-height: 1.1; }
    .hero p { margin: 0; color: var(--muted); max-width: 62ch; }
    .hero-cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 4px;
    }

    .btn {
      min-height: 46px;
      padding: 10px 18px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
      white-space: nowrap;
      transition: transform 0.15s cubic-bezier(0.16,1,0.3,1), opacity 0.15s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary { background: var(--lime); color: var(--lime-ink); border-color: transparent; }
    .btn-gold { background: var(--gold); color: var(--gold-ink); border-color: transparent; }

    .desktop-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    @media (min-width: 880px) {
      .wrap { padding-bottom: 32px; }
      .desktop-grid {
        grid-template-columns: 1.05fr 0.95fr;
        align-items: start;
      }
      .bottom-nav { display: none !important; }
      .tab-panel { display: block !important; }
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
    }
    .card + .card { margin-top: 16px; }
    .section-title { font-size: 19px; font-weight: 700; margin-bottom: 4px; }
    .section-sub { font-size: 13px; color: var(--muted); margin-bottom: 14px; }

    .seg {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding: 4px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 14px;
      margin-bottom: 14px;
    }
    .seg button {
      min-height: 44px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }
    .seg button.active {
      background: var(--surface-2);
      color: var(--text);
      box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset;
    }

    .viz-wrap {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 14px;
    }
    canvas#vizCanvas { width: 100%; height: 82px; display: block; }
    .step-row {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 6px;
      margin-top: 8px;
    }
    .step-cell {
      height: 5px;
      border-radius: 4px;
      background: rgba(255,255,255,0.08);
      transition: background 0.1s;
    }
    .step-cell.on { background: var(--lime); }

    .transport-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .play-btn {
      flex: 1;
      min-height: 48px;
      border-radius: 14px;
      border: 0;
      background: var(--lime);
      color: var(--lime-ink);
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .play-btn.playing {
      background: var(--surface-2);
      color: var(--lime);
      border: 1px solid rgba(46,229,138,0.4);
    }
    .bpm-box {
      padding: 0 12px;
      min-height: 48px;
      border-radius: 14px;
      background: var(--bg);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }

    .pads-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .pad-btn {
      min-height: 68px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--text);
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.12s cubic-bezier(0.16,1,0.3,1), border-color 0.12s;
    }
    .pad-btn:active, .pad-btn.hit {
      transform: scale(0.96);
      border-color: var(--lime);
    }
    .pad-name { font-weight: 700; font-size: 14px; }
    .pad-hint { font-size: 12px; color: var(--muted); }

    .poll-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .vote-btn {
      min-height: 54px;
      padding: 8px 6px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
    }
    .vote-btn.voted { border-color: var(--lime); color: var(--lime); }

    .projects-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .proj-row {
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--bg);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .proj-info { min-width: 0; }
    .proj-title { font-weight: 700; font-size: 14.5px; }
    .proj-desc { font-size: 12.5px; color: var(--muted); }

    .feed-item { padding: 14px 0; border-bottom: 1px solid var(--line); }
    .feed-item:first-child { padding-top: 0; }
    .feed-item:last-child { border-bottom: 0; padding-bottom: 0; }
    .feed-meta { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .feed-title { font-weight: 700; font-size: 16px; margin-bottom: 6px; }
    .feed-lyrics { font-size: 13.5px; color: #d6deea; white-space: pre-line; margin-bottom: 10px; }
    .react-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .react-btns { display: flex; gap: 6px; flex-wrap: wrap; }
    .react-chip {
      min-height: 40px;
      min-width: 50px;
      padding: 0 10px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .react-chip.done { border-color: var(--lime); color: var(--lime); }

    .field {
      width: 100%;
      min-height: 88px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--text);
      font-size: 15px;
      resize: vertical;
      margin-bottom: 10px;
    }
    .field:focus { outline: none; border-color: var(--lime); }
    .style-picks {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .style-picks button {
      min-height: 44px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .style-picks button.active {
      border-color: var(--lime);
      color: var(--text);
      background: var(--surface-2);
    }

    .cookie-free-box {
      padding: 14px;
      border-radius: 14px;
      background: var(--bg);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .packs-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }
    .pack-btn {
      min-height: 76px;
      padding: 10px 8px;
      border-radius: 14px;
      border: 1px solid rgba(245, 183, 79, 0.35);
      background: rgba(245, 183, 79, 0.08);
      color: var(--text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: transform 0.14s, background 0.14s;
    }
    .pack-btn:active { transform: scale(0.96); }
    .pack-stars { font-weight: 700; color: var(--gold); font-size: 16px; }
    .pack-label { font-size: 11.5px; color: var(--muted); text-align: center; }

    .banquet-btn {
      width: 100%;
      min-height: 62px;
      padding: 12px 16px;
      border-radius: 14px;
      border: 1px solid rgba(245, 183, 79, 0.7);
      background: linear-gradient(135deg, rgba(245,183,79,0.22), rgba(46,229,138,0.12));
      color: var(--text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: transform 0.14s;
    }
    .banquet-btn:active { transform: scale(0.98); }
    .banquet-title { font-weight: 700; font-size: 15px; text-align: left; }
    .banquet-sub { font-size: 12px; color: var(--muted); text-align: left; }
    .banquet-price { font-weight: 700; color: var(--gold); font-size: 15px; white-space: nowrap; }

    .bottom-nav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      background: rgba(11, 13, 16, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-top: 1px solid var(--line);
      padding-bottom: var(--safe-b);
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      height: calc(60px + var(--safe-b));
    }
    .nav-btn {
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      cursor: pointer;
      min-height: 44px;
    }
    .nav-btn .ico { font-size: 19px; line-height: 1; }
    .nav-btn.active { color: var(--lime); }

    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(74px + var(--safe-b));
      transform: translateX(-50%) translateY(16px);
      background: #1d2430;
      color: var(--text);
      border: 1px solid rgba(255,255,255,0.14);
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 500;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      z-index: 60;
      max-width: calc(100vw - 32px);
      text-align: center;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">Zombie News <span>Flava</span></div>
    <div class="top-actions">
      <button id="soundToggleBtn" class="icon-btn sound-on" type="button" aria-label="Переключить звук">
        <span id="soundIcon">🔊</span><span>Звук</span>
      </button>
      <button id="topCookieBtn" class="icon-btn gold-btn" type="button">🍩 Печенье</button>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <div class="hero-meta" id="heroMeta">Автоэфир в 09:00 и 21:00 UTC · Рэп и кибер-шансон</div>
      <h1>Сатирическая звуковая студия в Telegram</h1>
      <p>Крути живой бит, жми звуковые пады, включай голосовую читку прямо поверх ритма, закидывай темы и пробуй другие игры студии.</p>
      <div class="hero-cta-row">
        <button class="btn btn-primary" type="button" data-tg-link="https://t.me/${cleanChannel}">📢 Читать ${channel}</button>
        <button class="btn btn-gold" type="button" id="heroCookieBtn">🍩 Печенье и банкет</button>
        <button class="btn" type="button" data-tg-link="https://t.me/${slotsBot}">🎰 Слоты 5x5</button>
      </div>
    </section>

    <div class="desktop-grid">
      <section class="tab-panel active" data-tab="deck">
        <div class="card">
          <div class="section-title">Живой пульт Zombie-DJ и Дяди Коли</div>
          <div class="section-sub">Синтезатор работает прямо в браузере — без интернета и расхода лимитов.</div>

          <div class="seg" role="tablist" aria-label="Выбор бита">
            <button type="button" class="active" data-deck="rap">🎤 Zombie-DJ · 94 BPM</button>
            <button type="button" data-deck="chanson">🎸 Дядя Коля · 108 BPM</button>
          </div>

          <div class="viz-wrap">
            <canvas id="vizCanvas" width="600" height="160"></canvas>
            <div class="step-row" id="stepRow">
              <div class="step-cell"></div><div class="step-cell"></div><div class="step-cell"></div><div class="step-cell"></div>
              <div class="step-cell"></div><div class="step-cell"></div><div class="step-cell"></div><div class="step-cell"></div>
            </div>
          </div>

          <div class="transport-row">
            <button id="playBeatBtn" class="play-btn" type="button">▶ Запустить бит</button>
            <div class="bpm-box mono"><span id="bpmLabel">94</span>&nbsp;BPM</div>
          </div>

          <div class="pads-grid">
            <button class="pad-btn" type="button" data-pad="scratch">
              <span class="pad-name">🎧 Скретч</span>
              <span class="pad-hint">Виниловый запил</span>
            </button>
            <button class="pad-btn" type="button" data-pad="zombie">
              <span class="pad-name">🧟‍♂️ Рык зомби</span>
              <span class="pad-hint">Басовый гроул</span>
            </button>
            <button class="pad-btn" type="button" data-pad="horn">
              <span class="pad-name">📯 Эйрхорн</span>
              <span class="pad-hint">Клубный гудок</span>
            </button>
            <button class="pad-btn" type="button" data-pad="crunch">
              <span class="pad-name">🍪 Хруст</span>
              <span class="pad-hint">Вкусный бит-аккорд</span>
            </button>
          </div>
        </div>

        <div class="card">
          <div class="section-title">Выбор стиля следующего эфира</div>
          <div class="section-sub">Лидер голосования задаст подачу для ближайшего выпуска в канале.</div>
          <div class="poll-grid">
            <button class="vote-btn" type="button" data-vote="rap">
              <span>🎤 Рэп</span>
              <span class="mono" id="voteRap">0</span>
            </button>
            <button class="vote-btn" type="button" data-vote="chanson">
              <span>🎸 Шансон</span>
              <span class="mono" id="voteChanson">0</span>
            </button>
            <button class="vote-btn" type="button" data-vote="battle">
              <span>⚔️ Баттл</span>
              <span class="mono" id="voteBattle">0</span>
            </button>
          </div>
        </div>

        <div class="card">
          <div class="section-title">Игры и проекты студии iField</div>
          <div class="section-sub">Собрали всё в одном месте — запускай в один тап.</div>
          <div class="projects-grid">
            <div class="proj-row">
              <div class="proj-info">
                <div class="proj-title">🎰 Forest Fortune 5x5</div>
                <div class="proj-desc">25-барабанный неоновый слот в стиле Вегаса</div>
              </div>
              <button class="btn btn-primary" type="button" id="openSlotsBtn">Играть</button>
            </div>
            <div class="proj-row">
              <div class="proj-info">
                <div class="proj-title">🃏 Подкидной Дурак</div>
                <div class="proj-desc">Карточная битва студии</div>
              </div>
              <button class="btn" type="button" id="openDurakBtn">Играть</button>
            </div>
            <div class="proj-row">
              <div class="proj-info">
                <div class="proj-title">🏴‍☠️ Lucky Roger Slot</div>
                <div class="proj-desc">Пиратский слот за сокровищами</div>
              </div>
              <button class="btn" type="button" id="openRogerBtn">Открыть</button>
            </div>
            <div class="proj-row">
              <div class="proj-info">
                <div class="proj-title">🎵 iField Music Lab</div>
                <div class="proj-desc">Музыкальная лаборатория студии</div>
              </div>
              <button class="btn" type="button" id="openMusicBtn">Открыть</button>
            </div>
          </div>
        </div>
      </section>

      <div>
        <section class="tab-panel" data-tab="feed">
          <div class="card">
            <div class="section-title">Последние выпуски канала</div>
            <div class="section-sub">Оценивай панчи или жми «🔊 Зачитать», чтобы послушать поверх бита.</div>
            <div id="feedList">
              <div class="feed-meta">Загружаю свежие треки из студии...</div>
            </div>
          </div>
        </section>

        <section class="tab-panel" data-tab="suggest">
          <div class="card">
            <div class="section-title">Предложка: закажи трек диджеям</div>
            <div class="section-sub">Смешная новость, крипта или ситуация из жизни — лучшие темы уходят в выпуск.</div>
            <textarea id="suggestText" class="field" maxlength="180" placeholder="Например: Кот случайно запустил майнинг-ферму и согрел весь подъезд..."></textarea>
            <div class="style-picks" id="suggestStyles">
              <button type="button" class="active" data-sstyle="auto">🎲 Авто</button>
              <button type="button" data-sstyle="rap">🎤 Рэп</button>
              <button type="button" data-sstyle="chanson">🎸 Шансон</button>
            </div>
            <button id="suggestBtn" class="btn btn-primary" style="width:100%" type="button">Отправить тему в студию</button>
          </div>
        </section>

        <section class="tab-panel" data-tab="cookie" id="cookieSection">
          <div class="card">
            <div class="section-title">🍩 Диджеям на печенье и банкет</div>
            <div class="section-sub">Оплата Stars открывается прямо здесь поверх приложения, не засоряя чат.</div>

            <div class="cookie-free-box">
              <div>
                <div style="font-weight:700">Бесплатная печенька</div>
                <div class="feed-meta">Угощено: <span class="mono" id="freeCookieCount">0</span> 🍪</div>
              </div>
              <button id="freeCookieBtn" class="btn btn-primary" type="button">Кинуть 🍪</button>
            </div>

            <div class="section-sub" style="margin-bottom:8px">
              Реальные звёзды на поддержку студии · Собрано <span class="mono" id="starsTotal">0</span> ⭐
            </div>
            <div class="packs-grid">
              <button class="pack-btn" type="button" data-pack="cookie_50">
                <span class="pack-stars">50 ⭐</span>
                <span class="pack-label">Хрустящая печенька</span>
              </button>
              <button class="pack-btn" type="button" data-pack="cookie_150">
                <span class="pack-stars">150 ⭐</span>
                <span class="pack-label">Коробка печенья</span>
              </button>
              <button class="pack-btn" type="button" data-pack="cookie_500">
                <span class="pack-stars">500 ⭐</span>
                <span class="pack-label">VIP-самовар</span>
              </button>
            </div>

            <button class="banquet-btn" type="button" data-pack="banquet_10000">
              <div>
                <div class="banquet-title">🥂 Накрыть диджеям банкет!</div>
                <div class="banquet-sub">Царский ужин на весь некро-район</div>
              </div>
              <span class="banquet-price mono">10 000 ⭐</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </main>

  <nav class="bottom-nav" aria-label="Навигация студии">
    <button class="nav-btn active" type="button" data-nav="deck"><span class="ico">🎛</span><span>Пульт</span></button>
    <button class="nav-btn" type="button" data-nav="feed"><span class="ico">📻</span><span>Эфир</span></button>
    <button class="nav-btn" type="button" data-nav="suggest"><span class="ico">💡</span><span>Заказ</span></button>
    <button class="nav-btn" type="button" data-nav="cookie"><span class="ico">🍩</span><span>Печенье</span></button>
  </nav>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>

  <script>
    (function () {
      var API_BASE = '${apiBase}';
      var BOT_USER = '${bot}';
      var SLOTS_URL = '${slotsUrl}';
      var SLOTS_BOT = '${slotsBot}';
      var ROGER_URL = '${rogerUrl}';
      var DURAK_URL = '${durakUrl}';
      var MUSIC_URL = '${musicUrl}';
      var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

      if (tg) {
        try {
          tg.ready();
          tg.expand();
          if (tg.setHeaderColor) tg.setHeaderColor('#0b0d10');
          if (tg.setBackgroundColor) tg.setBackgroundColor('#0b0d10');
        } catch (e) {}
      }

      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'playback'; } catch (e) {}
      }

      function haptic(level) {
        if (tg && tg.HapticFeedback) {
          try { tg.HapticFeedback.impactOccurred(level || 'light'); } catch (e) {}
        }
      }

      function showToast(msg) {
        var el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
      }

      function openTg(url) {
        haptic('light');
        if (tg && tg.openTelegramLink && url.indexOf('https://t.me/') === 0) {
          try { tg.openTelegramLink(url); return; } catch (e) {}
        }
        window.location.href = url;
      }

      document.getElementById('openSlotsBtn').addEventListener('click', function () {
        if (tg && tg.openTelegramLink) openTg('https://t.me/' + SLOTS_BOT);
        else window.location.href = SLOTS_URL;
      });
      document.getElementById('openDurakBtn').addEventListener('click', function () {
        openTg(DURAK_URL);
      });
      document.getElementById('openRogerBtn').addEventListener('click', function () {
        openTg(ROGER_URL);
      });
      document.getElementById('openMusicBtn').addEventListener('click', function () {
        openTg(MUSIC_URL);
      });

      var soundEnabled = true;
      var audioCtx = null;
      var masterGain = null;
      var analyser = null;
      var noiseBuffer = null;
      var beatPlaying = false;
      var beatTimer = null;
      var stepIndex = 0;
      var currentDeck = 'rap';

      function ensureAudio() {
        if (!soundEnabled) return null;
        if (!audioCtx) {
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return null;
          audioCtx = new Ctx();
          masterGain = audioCtx.createGain();
          masterGain.gain.value = 0.72;
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          masterGain.connect(analyser);
          analyser.connect(audioCtx.destination);

          var len = audioCtx.sampleRate * 0.5;
          noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
          var data = noiseBuffer.getChannelData(0);
          for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(function () {});
        }
        return audioCtx;
      }

      function playKick(t, freqStart, dur) {
        var ctx = ensureAudio(); if (!ctx) return;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqStart || 135, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + (dur || 0.16));
        g.gain.setValueAtTime(0.85, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.22));
        osc.connect(g); g.connect(masterGain);
        osc.start(t); osc.stop(t + (dur || 0.24));
      }

      function playSnare(t, sharp) {
        var ctx = ensureAudio(); if (!ctx || !noiseBuffer) return;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        var flt = ctx.createBiquadFilter();
        flt.type = sharp ? 'highpass' : 'bandpass';
        flt.frequency.setValueAtTime(sharp ? 1900 : 1200, t);
        var g = ctx.createGain();
        g.gain.setValueAtTime(sharp ? 0.26 : 0.36, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + (sharp ? 0.08 : 0.16));
        src.connect(flt); flt.connect(g); g.connect(masterGain);
        src.start(t); src.stop(t + 0.18);
      }

      function playBass(t, freq, type, dur) {
        var ctx = ensureAudio(); if (!ctx) return;
        var osc = ctx.createOscillator();
        var flt = ctx.createBiquadFilter();
        var g = ctx.createGain();
        osc.type = type || 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(type === 'triangle' ? 950 : 420, t);
        flt.frequency.exponentialRampToValueAtTime(160, t + dur);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(flt); flt.connect(g); g.connect(masterGain);
        osc.start(t); osc.stop(t + dur + 0.02);
      }

      function playPadEffect(kind) {
        var ctx = ensureAudio();
        if (!ctx) return;
        var t = ctx.currentTime;
        if (kind === 'scratch') {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(620, t);
          osc.frequency.exponentialRampToValueAtTime(110, t + 0.11);
          osc.frequency.exponentialRampToValueAtTime(480, t + 0.21);
          osc.frequency.exponentialRampToValueAtTime(85, t + 0.32);
          g.gain.setValueAtTime(0.28, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
          osc.connect(g); g.connect(masterGain);
          osc.start(t); osc.stop(t + 0.35);
          playSnare(t + 0.02, true);
        } else if (kind === 'zombie') {
          var o1 = ctx.createOscillator();
          var o2 = ctx.createOscillator();
          var f = ctx.createBiquadFilter();
          var gz = ctx.createGain();
          o1.type = 'sawtooth'; o2.type = 'square';
          o1.frequency.setValueAtTime(92, t);
          o1.frequency.linearRampToValueAtTime(66, t + 0.45);
          o2.frequency.setValueAtTime(95, t);
          o2.frequency.linearRampToValueAtTime(63, t + 0.45);
          f.type = 'bandpass'; f.Q.value = 4.5;
          f.frequency.setValueAtTime(280, t);
          f.frequency.linearRampToValueAtTime(520, t + 0.18);
          f.frequency.linearRampToValueAtTime(210, t + 0.45);
          gz.gain.setValueAtTime(0.4, t);
          gz.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
          o1.connect(f); o2.connect(f); f.connect(gz); gz.connect(masterGain);
          o1.start(t); o2.start(t); o1.stop(t + 0.5); o2.stop(t + 0.5);
        } else if (kind === 'horn') {
          var freqs = [392, 493.88, 587.33];
          for (var i = 0; i < freqs.length; i++) {
            var ho = ctx.createOscillator();
            var hg = ctx.createGain();
            ho.type = 'sawtooth';
            ho.frequency.setValueAtTime(freqs[i], t);
            hg.gain.setValueAtTime(0.14, t);
            hg.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
            ho.connect(hg); hg.connect(masterGain);
            ho.start(t); ho.stop(t + 0.4);
          }
        } else if (kind === 'crunch') {
          playSnare(t, true);
          playSnare(t + 0.06, false);
          playBass(t + 0.08, 523.25, 'triangle', 0.16);
          playBass(t + 0.17, 659.25, 'triangle', 0.22);
        } else if (kind === 'click') {
          playBass(t, 420, 'sine', 0.05);
        }
      }

      function speakTrackText(text, style) {
        if (!window.speechSynthesis) {
          showToast('Озвучка в браузере не поддерживается');
          return;
        }
        try {
          window.speechSynthesis.cancel();
          var u = new SpeechSynthesisUtterance(text);
          u.lang = 'ru-RU';
          u.pitch = style === 'chanson' ? 0.85 : 0.72;
          u.rate = style === 'chanson' ? 0.94 : 1.04;
          window.speechSynthesis.speak(u);
          showToast('🔊 Зачитываю трек...');
        } catch (e) {
          showToast('Не удалось включить голос');
        }
      }

      function stepTick() {
        var ctx = ensureAudio();
        if (!ctx || !beatPlaying) return;
        var t = ctx.currentTime + 0.02;
        var s = stepIndex % 8;

        var cells = document.querySelectorAll('#stepRow .step-cell');
        for (var i = 0; i < cells.length; i++) {
          cells[i].classList.toggle('on', i === s);
        }

        if (currentDeck === 'rap') {
          var rapBass = [55, 0, 55, 0, 65.4, 0, 49, 61.7];
          if (s === 0 || s === 3 || s === 5) playKick(t, 140, 0.2);
          if (s === 2 || s === 6) playSnare(t, false);
          playSnare(t, true);
          if (rapBass[s]) playBass(t, rapBass[s], 'sawtooth', 0.22);
        } else {
          var chansonNotes = [220, 261.6, 329.6, 261.6, 196, 246.9, 293.7, 246.9];
          if (s === 0 || s === 4) playKick(t, 110, 0.14);
          if (s === 2 || s === 6) playSnare(t, false);
          playBass(t, chansonNotes[s], 'triangle', 0.19);
        }

        stepIndex++;
      }

      function toggleBeat(forceState) {
        var next = typeof forceState === 'boolean' ? forceState : !beatPlaying;
        beatPlaying = next;
        var btn = document.getElementById('playBeatBtn');
        clearInterval(beatTimer);
        if (beatPlaying) {
          ensureAudio();
          var bpm = currentDeck === 'rap' ? 94 : 108;
          var ms = Math.round((60000 / bpm) / 2);
          stepIndex = 0;
          stepTick();
          beatTimer = setInterval(stepTick, ms);
          btn.textContent = '⏸ Пауза';
          btn.classList.add('playing');
        } else {
          btn.textContent = '▶ Запустить бит';
          btn.classList.remove('playing');
          var cells = document.querySelectorAll('#stepRow .step-cell');
          for (var i = 0; i < cells.length; i++) cells[i].classList.remove('on');
        }
      }

      var vizCanvas = document.getElementById('vizCanvas');
      var vizCtx = vizCanvas.getContext('2d');
      var freqArr = new Uint8Array(32);
      var phase = 0;

      function drawViz() {
        var w = vizCanvas.width;
        var h = vizCanvas.height;
        vizCtx.clearRect(0, 0, w, h);

        if (analyser && soundEnabled) {
          analyser.getByteFrequencyData(freqArr);
        } else {
          freqArr.fill(0);
        }

        var bars = 24;
        var gap = 6;
        var bw = (w - gap * (bars - 1)) / bars;
        phase += 0.05;

        for (var i = 0; i < bars; i++) {
          var v = freqArr[i] || 0;
          var idle = 10 + Math.sin(phase + i * 0.45) * 6;
          var bh = Math.max(8, (v > 4 ? (v / 255) * (h - 16) : idle));
          var x = i * (bw + gap);
          var y = h - bh;
          vizCtx.fillStyle = v > 120 ? '#f5b74f' : '#2ee58a';
          vizCtx.globalAlpha = v > 4 ? 0.92 : 0.35;
          vizCtx.fillRect(x, y, bw, bh);
        }
        vizCtx.globalAlpha = 1;
        requestAnimationFrame(drawViz);
      }
      requestAnimationFrame(drawViz);

      function switchTab(tabName) {
        haptic('light');
        var navs = document.querySelectorAll('[data-nav]');
        var panels = document.querySelectorAll('[data-tab]');
        for (var i = 0; i < navs.length; i++) {
          navs[i].classList.toggle('active', navs[i].getAttribute('data-nav') === tabName);
        }
        for (var j = 0; j < panels.length; j++) {
          panels[j].classList.toggle('active', panels[j].getAttribute('data-tab') === tabName);
        }
        if (window.innerWidth >= 880 && tabName === 'cookie') {
          var el = document.getElementById('cookieSection');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      var navBtns = document.querySelectorAll('[data-nav]');
      for (var n = 0; n < navBtns.length; n++) {
        navBtns[n].addEventListener('click', function () {
          ensureAudio();
          playPadEffect('click');
          switchTab(this.getAttribute('data-nav'));
        });
      }

      document.getElementById('topCookieBtn').addEventListener('click', function () {
        ensureAudio();
        playPadEffect('crunch');
        switchTab('cookie');
      });
      document.getElementById('heroCookieBtn').addEventListener('click', function () {
        ensureAudio();
        playPadEffect('crunch');
        switchTab('cookie');
      });

      var tgLinks = document.querySelectorAll('[data-tg-link]');
      for (var tl = 0; tl < tgLinks.length; tl++) {
        tgLinks[tl].addEventListener('click', function () {
          openTg(this.getAttribute('data-tg-link'));
        });
      }

      document.getElementById('soundToggleBtn').addEventListener('click', function () {
        soundEnabled = !soundEnabled;
        this.classList.toggle('sound-on', soundEnabled);
        document.getElementById('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
        if (!soundEnabled && beatPlaying) toggleBeat(false);
        if (!soundEnabled && window.speechSynthesis) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        if (soundEnabled) {
          ensureAudio();
          playPadEffect('click');
          showToast('Звук включён');
        } else {
          showToast('Звук выключен');
        }
      });

      var deckBtns = document.querySelectorAll('[data-deck]');
      for (var d = 0; d < deckBtns.length; d++) {
        deckBtns[d].addEventListener('click', function () {
          ensureAudio();
          haptic('light');
          currentDeck = this.getAttribute('data-deck');
          for (var k = 0; k < deckBtns.length; k++) {
            deckBtns[k].classList.toggle('active', deckBtns[k] === this);
          }
          document.getElementById('bpmLabel').textContent = currentDeck === 'rap' ? '94' : '108';
          if (beatPlaying) toggleBeat(true);
          else playPadEffect('click');
        });
      }

      document.getElementById('playBeatBtn').addEventListener('click', function () {
        if (!soundEnabled) {
          soundEnabled = true;
          document.getElementById('soundToggleBtn').classList.add('sound-on');
          document.getElementById('soundIcon').textContent = '🔊';
        }
        ensureAudio();
        haptic('medium');
        toggleBeat();
      });

      var padBtns = document.querySelectorAll('[data-pad]');
      for (var p = 0; p < padBtns.length; p++) {
        padBtns[p].addEventListener('pointerdown', function () {
          ensureAudio();
          haptic('medium');
          var el = this;
          el.classList.add('hit');
          setTimeout(function () { el.classList.remove('hit'); }, 140);
          playPadEffect(el.getAttribute('data-pad'));
        });
      }

      var votedStyle = localStorage.getItem('znf_style_vote') || '';

      function renderStudio(data) {
        if (!data) return;
        document.getElementById('freeCookieCount').textContent = String(data.freeCookies || 0);
        document.getElementById('starsTotal').textContent = String(data.cookiesTotal || 0);
        var votes = data.votes || {};
        document.getElementById('voteRap').textContent = String(votes.rap || 0);
        document.getElementById('voteChanson').textContent = String(votes.chanson || 0);
        document.getElementById('voteBattle').textContent = String(votes.battle || 0);

        var vBtns = document.querySelectorAll('[data-vote]');
        for (var i = 0; i < vBtns.length; i++) {
          vBtns[i].classList.toggle('voted', vBtns[i].getAttribute('data-vote') === votedStyle);
        }

        renderFeed(data.recentPosts || []);
      }

      function renderFeed(posts) {
        var box = document.getElementById('feedList');
        if (!posts.length) {
          box.innerHTML = '<div class="feed-meta">Скоро здесь появятся свежие треки из канала!</div>';
          return;
        }
        box.innerHTML = '';
        for (var i = 0; i < posts.length; i++) {
          var post = posts[i];
          var item = document.createElement('div');
          item.className = 'feed-item';

          var meta = document.createElement('div');
          meta.className = 'feed-meta';
          var stLabel = post.style === 'rap' ? 'Zombie-DJ' : (post.style === 'chanson' ? 'Дядя Коля' : 'Баттл');
          meta.textContent = stLabel + ' · ' + (post.source || 'Эфир');

          var title = document.createElement('div');
          title.className = 'feed-title';
          title.textContent = post.headline || 'Без названия';

          var lyrics = document.createElement('div');
          lyrics.className = 'feed-lyrics';
          lyrics.textContent = post.lyrics || '';

          var row = document.createElement('div');
          row.className = 'react-row';

          var btns = document.createElement('div');
          btns.className = 'react-btns';
          var reacts = [
            { k: 'fire', ico: '🔥' },
            { k: 'skull', ico: '💀' },
            { k: 'rock', ico: '🎸' }
          ];
          for (var r = 0; r < reacts.length; r++) {
            (function (postId, rk, ico) {
              var b = document.createElement('button');
              b.type = 'button';
              b.className = 'react-chip';
              var storeKey = 'znf_r_' + postId + '_' + rk;
              if (localStorage.getItem(storeKey)) b.classList.add('done');
              var count = (post.reactions && post.reactions[rk]) || 0;
              b.innerHTML = '<span>' + ico + '</span><span class="mono">' + count + '</span>';
              b.addEventListener('click', function () {
                ensureAudio();
                haptic('light');
                if (localStorage.getItem(storeKey)) {
                  showToast('Ты уже поставил эту реакцию');
                  return;
                }
                localStorage.setItem(storeKey, '1');
                playPadEffect('crunch');
                fetch(API_BASE + '/api/react', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ kind: 'post', postId: postId, reaction: rk })
                }).then(function (res) { return res.json(); }).then(function (j) {
                  if (j.ok && j.recentPosts) renderFeed(j.recentPosts);
                }).catch(function () {});
              });
              btns.appendChild(b);
            })(post.id, reacts[r].k, reacts[r].ico);
          }

          var speakBtn = document.createElement('button');
          speakBtn.type = 'button';
          speakBtn.className = 'react-chip';
          speakBtn.textContent = '🔊 Зачитать';
          (function (pObj) {
            speakBtn.addEventListener('click', function () {
              ensureAudio();
              haptic('light');
              speakTrackText((pObj.headline || '') + '. ' + (pObj.lyrics || ''), pObj.style);
            });
          })(post);

          var openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'react-chip';
          openBtn.textContent = 'В канал ↗';
          (function (url) {
            openBtn.addEventListener('click', function () {
              openTg(url || 'https://t.me/${cleanChannel}');
            });
          })(post.tgUrl);

          btns.appendChild(speakBtn);
          row.appendChild(btns);
          row.appendChild(openBtn);
          item.appendChild(meta);
          item.appendChild(title);
          item.appendChild(lyrics);
          item.appendChild(row);
          box.appendChild(item);
        }
      }

      fetch(API_BASE + '/api/studio')
        .then(function (r) { return r.json(); })
        .then(renderStudio)
        .catch(function () {
          document.getElementById('feedList').innerHTML = '<div class="feed-meta">Не удалось загрузить ленту.</div>';
        });

      var voteBtns = document.querySelectorAll('[data-vote]');
      for (var vb = 0; vb < voteBtns.length; vb++) {
        voteBtns[vb].addEventListener('click', function () {
          ensureAudio();
          haptic('medium');
          var st = this.getAttribute('data-vote');
          if (votedStyle === st) {
            showToast('Голос уже учтён');
            return;
          }
          votedStyle = st;
          localStorage.setItem('znf_style_vote', st);
          playPadEffect('crunch');
          fetch(API_BASE + '/api/react', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'vote', style: st })
          }).then(function (r) { return r.json(); }).then(function (j) {
            if (j.ok) {
              document.getElementById('voteRap').textContent = String(j.votes.rap || 0);
              document.getElementById('voteChanson').textContent = String(j.votes.chanson || 0);
              document.getElementById('voteBattle').textContent = String(j.votes.battle || 0);
              for (var k = 0; k < voteBtns.length; k++) {
                voteBtns[k].classList.toggle('voted', voteBtns[k].getAttribute('data-vote') === votedStyle);
              }
              showToast('Голос за стиль принят!');
            }
          }).catch(function () {});
        });
      }

      var suggestStyle = 'auto';
      var sugStyleBtns = document.querySelectorAll('[data-sstyle]');
      for (var sb = 0; sb < sugStyleBtns.length; sb++) {
        sugStyleBtns[sb].addEventListener('click', function () {
          ensureAudio();
          playPadEffect('click');
          suggestStyle = this.getAttribute('data-sstyle');
          for (var k = 0; k < sugStyleBtns.length; k++) {
            sugStyleBtns[k].classList.toggle('active', sugStyleBtns[k] === this);
          }
        });
      }

      document.getElementById('suggestBtn').addEventListener('click', function () {
        ensureAudio();
        haptic('medium');
        var input = document.getElementById('suggestText');
        var text = (input.value || '').trim();
        if (text.length < 6) {
          showToast('Напиши тему хотя бы от 6 символов');
          return;
        }
        var author = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && (tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name)) || 'Слушатель';
        var btn = this;
        btn.disabled = true;
        fetch(API_BASE + '/api/suggest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text, style: suggestStyle, author: author })
        }).then(function (r) { return r.json(); }).then(function (j) {
          btn.disabled = false;
          if (j.ok) {
            input.value = '';
            playPadEffect('crunch');
            showToast('Тема отправлена диджеям! В очереди: ' + j.queueSize);
          } else {
            showToast(j.error || 'Не удалось отправить');
          }
        }).catch(function () {
          btn.disabled = false;
          showToast('Ошибка сети');
        });
      });

      var pendingCookies = 0;
      var cookieFlushTimer = null;
      document.getElementById('freeCookieBtn').addEventListener('click', function () {
        ensureAudio();
        haptic('medium');
        playPadEffect('crunch');
        var el = document.getElementById('freeCookieCount');
        el.textContent = String((Number(el.textContent) || 0) + 1);
        pendingCookies++;
        clearTimeout(cookieFlushTimer);
        cookieFlushTimer = setTimeout(function () {
          var batch = pendingCookies;
          pendingCookies = 0;
          if (!batch) return;
          fetch(API_BASE + '/api/free-cookie', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ count: batch })
          }).then(function (r) { return r.json(); }).then(function (j) {
            if (j.ok && typeof j.freeCookies === 'number') {
              el.textContent = String(j.freeCookies);
            }
          }).catch(function () {});
        }, 700);
      });

      var packBtns = document.querySelectorAll('[data-pack]');
      for (var pk = 0; pk < packBtns.length; pk++) {
        packBtns[pk].addEventListener('click', function () {
          ensureAudio();
          haptic('medium');
          var packId = this.getAttribute('data-pack');
          var btn = this;
          btn.disabled = true;
          showToast('Открываю Stars...');
          fetch(API_BASE + '/api/cookie-invoice', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pack: packId })
          }).then(function (r) { return r.json(); }).then(function (j) {
            btn.disabled = false;
            if (!j.ok || !j.invoiceLink) {
              showToast(j.error || 'Не удалось создать счёт');
              return;
            }
            if (tg && tg.openInvoice) {
              tg.openInvoice(j.invoiceLink, function (status) {
                if (status === 'paid') {
                  playPadEffect('horn');
                  haptic('heavy');
                  showToast(j.stars >= 10000 ? '🥂 Легендарный банкет доставлен!' : 'Спасибо! Печенье доставлено 🍩');
                  fetch(API_BASE + '/api/cookie-confirm', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ nonce: j.nonce })
                  }).then(function (cr) { return cr.json(); }).then(function (cj) {
                    if (cj.ok && typeof cj.cookiesTotal === 'number') {
                      document.getElementById('starsTotal').textContent = String(cj.cookiesTotal);
                    }
                  }).catch(function () {});
                } else if (status === 'cancelled') {
                  showToast('Оплата отменена');
                } else {
                  showToast('Статус оплаты: ' + status);
                }
              });
            } else {
              openTg('https://t.me/' + BOT_USER + '?start=cookie');
            }
          }).catch(function () {
            btn.disabled = false;
            showToast('Ошибка связи со студией');
          });
        });
      }

      var qs = new URLSearchParams(window.location.search);
      var startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      if (qs.get('tab') === 'cookie' || startParam === 'cookie') {
        switchTab('cookie');
      }
    })();
  </script>
</body>
</html>`;
}
