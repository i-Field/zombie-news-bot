export default {
  async fetch(request, env, ctx) {
    return await handleNewsGeneration(env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleNewsGeneration(env));
  }
};

// Функция отправки логов прямо в Telegram
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
    let newsKey = null;

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
            newsKey = key;
            await sendDebug(env, `Найдена тема: "${currentTopic}"`);
            break; 
          }
        }
      }
    } catch (e) {
      await sendDebug(env, `Ошибка в блоке HN: ${e.message}`);
    }

    if (!currentTopic) {
      await sendDebug(env, "Все новости из списка уже были отправлены ранее.");
      return new Response("📭 Нет новых тем.", { status: 200 });
    }

    // === БЛОК 2: Генерация картинки ===
    const randomSeed = Math.floor(Math.random() * 100000);
    const randomImage = `https://image.pollinations.ai/prompt/cyberpunk,neon,robot,dark?width=800&height=600&nologo=true&seed=${randomSeed}`;

    // === БЛОК 3: Gemini (Модель flash-latest + Таймаут 30 сек) ===
    if (!env.GEMINI_API_KEY) {
      await sendDebug(env, "КРИТИЧЕСКАЯ ОШИБКА: Переменная GEMINI_API_KEY пуста!");
      return new Response("Нет ключа", { status: 500 });
    }

    const prompt = `Напиши рэп-батл из двух реплик на тему реальной новости: "${currentTopic}".
Стиль: киберпанк.
Строго соблюдай формат:
🧟‍♂️ Zombie-DJ: [текст куплета в 2 строки с рифмой]
🤖 Cyber-MC: [текст ответа в 2 строки с рифмой]`;

    // Используем актуальный псевдоним, который Google всегда поддерживает
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
    
    let rapText = null;
    let lastError = "Неизвестная ошибка";
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await sendDebug(env, `Стучусь в Gemini (попытка ${attempt} из ${MAX_RETRIES})...`);
        
        const controller = new AbortController();
        // Увеличили таймаут до 30 секунд для надежности
        const timeoutId = setTimeout(() => controller.abort(), 30000); 

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY 
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.9 }
          })
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          rapText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (rapText && rapText.length > 10) {
            await sendDebug(env, "Успех! Gemini выдал рэп.");
            break; 
          } else {
            lastError = "Gemini вернул пустой ответ.";
          }
        } else if (response.status === 503 || response.status === 429) {
          lastError = `Сервер Google перегружен (Код ${response.status}). Ждем...`;
          await sendDebug(env, lastError);
          await new Promise(r => setTimeout(r, 3000)); 
        } else {
          const errData = await response.text();
          lastError = `Код ${response.status}: ${errData.substring(0, 150)}`;
          break; 
        }
      } catch (error) {
        lastError = error.name === 'AbortError' ? "Таймаут (30 сек)." : error.message;
        if (attempt < MAX_RETRIES) {
          await sendDebug(env, `Сбой: ${lastError}. Пробуем снова...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!rapText) {
      await sendDebug(env, `ВСЕ ПОПЫТКИ ПРОВАЛИЛИСЬ. Ошибка: ${lastError}`);
      rapText = `🚨 GEMINI НЕ ОТВЕЧАЕТ!\nПричина: ${lastError}`;
    }

    // === БЛОК 4: Формируем пост ===
    const safeTitle = currentTopic.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let safeRap = rapText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (safeRap.length > 700) safeRap = safeRap.substring(0, 700) + "...";
    
    const finalPost = `🎧 <b>Инфоповод:</b> ${safeTitle}\n🔗 <a href="${newsLink}">Источник</a>\n\n${safeRap}`;

    // === БЛОК 5: Отправка в Telegram ===
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const tgResponse = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        chat_id: env.TELEGRAM_CHAT_ID, 
        photo: randomImage, 
        caption: finalPost, 
        parse_mode: "HTML" 
      })
    });

    // === БЛОК 6: Сохраняем в KV только при успешной отправке ===
    if (tgResponse.ok) {
      if (newsKey) await env.NEWS_KV.put(newsKey, "1");
      return new Response("🤖 Отправлено без багов!", { status: 200 });
    } else {
      await sendDebug(env, "Фото не ушло, шлю только текст.");
      const tgTextUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const textResponse = await fetch(tgTextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chat_id: env.TELEGRAM_CHAT_ID, 
          text: finalPost, 
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });

      if (textResponse.ok && newsKey) await env.NEWS_KV.put(newsKey, "1");
      return new Response("⚠️ Отправлен текст", { status: 200 });
    }

  } catch (err) {
    await sendDebug(env, `ГЛОБАЛЬНАЯ ОШИБКА: ${err.message}`);
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
