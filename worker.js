export default {
  async fetch(request, env, ctx) {
    return await handleNewsGeneration(env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleNewsGeneration(env));
  }
};

async function sendDebug(env, text) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `🛠 DEBUG: ${text}` })
    });
  } catch (e) {}
}

async function handleNewsGeneration(env) {
  try {
    await sendDebug(env, "Бот запущен. Ищу новости...");
    
    // === БЛОК 1: Hacker News ===
    let currentTopic = null;
    let newsLink = null;

    try {
      const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      const storyIds = await topStoriesRes.json();
      const recentIds = storyIds.slice(0, 50);

      for (const id of recentIds) {
        const key = `sent:hn_${id}`;
        const alreadySent = await env.NEWS_KV.get(key);

        if (!alreadySent) {
          const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = await itemRes.json();

          if (item && item.title) {
            currentTopic = item.title;
            newsLink = item.url || `https://news.ycombinator.com/item?id=${id}`;
            await env.NEWS_KV.put(key, "1");
            await sendDebug(env, `Найдена тема: "${currentTopic}"`);
            break; 
          }
        }
      }
    } catch (e) {
      await sendDebug(env, `Ошибка в блоке HN: ${e.message}`);
    }

    if (!currentTopic) {
      return new Response("📭 Нет новых тем.", { status: 200 });
    }

    // === БЛОК 2: Картинка ===
    const randomSeed = Math.floor(Math.random() * 100000);
    const randomImage = `https://image.pollinations.ai/prompt/cyberpunk,zombie,neon,robot?width=800&height=600&nologo=true&seed=${randomSeed}`;

    // === БЛОК 3: Gemini (актуальная модель 3.8-flash) ===
    if (!env.GEMINI_API_KEY) {
      await sendDebug(env, "КРИТИЧЕСКАЯ ОШИБКА: Переменная GEMINI_API_KEY пуста!");
      return new Response("Нет ключа", { status: 500 });
    }

    const prompt = `Напиши рэп-батл из двух реплик на тему реальной новости: "${currentTopic}".
Стиль: киберпанк.
Строго соблюдай формат:
🧟‍♂️ Zombie-DJ: [текст куплета в 2 строки с рифмой]
🤖 Cyber-MC: [текст ответа в 2 строки с рифмой]`;

    await sendDebug(env, "Стучусь в Gemini (модель 3.8-flash)...");
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    
    let geminiData = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Таймаут 15 секунд

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9 }
        })
      });
      
      clearTimeout(timeoutId);
      geminiData = await geminiResponse.json();
      
    } catch (error) {
      await sendDebug(env, `СБОЙ СВЯЗИ С GEMINI: ${error.message}. Проверьте ключ или соединение.`);
      return new Response(`Ошибка Gemini: ${error.message}`, { status: 500 });
    }

    let rapText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rapText || rapText.length < 10) {
      const errorDetails = JSON.stringify(geminiData).substring(0, 300); 
      await sendDebug(env, `ОТКАЗ GEMINI: ${errorDetails}`);
      const safeError = errorDetails.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rapText = `🚨 ОШИБКА API!\n${safeError}`;
    } else {
      await sendDebug(env, "Gemini выдал рэп! Отправляю пост...");
    }

    // === БЛОК 4: Пост ===
    const safeTitle = currentTopic.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let safeRap = rapText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (safeRap.length > 700) safeRap = safeRap.substring(0, 700) + "...";
    
    const finalPost = `🎧 <b>Инфоповод:</b> ${safeTitle}\n🔗 <a href="${newsLink}">Источник</a>\n\n${safeRap}`;

    // === БЛОК 5: Telegram ===
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const tgResponse = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, photo: randomImage, caption: finalPost, parse_mode: "HTML" })
    });

    if (!tgResponse.ok) {
      await sendDebug(env, "Фото не ушло, шлю текст.");
      const tgTextUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(tgTextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: finalPost, parse_mode: "HTML" })
      });
      return new Response("⚠️ Отправлен текст", { status: 200 });
    }

    return new Response("🤖 Отправлено без багов!", { status: 200 });

  } catch (err) {
    await sendDebug(env, `ГЛОБАЛЬНАЯ ОШИБКА: ${err.message}`);
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
