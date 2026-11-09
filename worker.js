export default {
  async fetch(request, env, ctx) {
    return await handleNewsGeneration(env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleNewsGeneration(env));
  }
};

async function handleNewsGeneration(env) {
  try {
    // === БЛОК 1: Получаем свежий заголовок из Hacker News ===
    let currentTopic = null;
    let newsLink = null;

    try {
      // 1. Получаем список ID топовых новостей
      const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      const storyIds = await topStoriesRes.json();

      // Берем первые 20 новостей (самые свежие)
      const recentIds = storyIds.slice(0, 20);

      for (const id of recentIds) {
        const key = `sent:hn_${id}`;
        const alreadySent = await env.NEWS_KV.get(key);

        if (!alreadySent) {
          // 2. Получаем заголовок и ссылку конкретной новости
          const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = await itemRes.json();

          if (item && item.title) {
            currentTopic = item.title;
            newsLink = item.url || `https://news.ycombinator.com/item?id=${id}`;

            // 3. Сразу сохраняем в базу, чтобы не повторяться
            await env.NEWS_KV.put(key, "1");
            break; // Нашли новую новость — выходим из цикла
          }
        }
      }
    } catch (e) {
      console.error("Ошибка HN API:", e);
    }

    // Если всё уже отправлено или произошла ошибка
    if (!currentTopic) {
      return new Response("📭 Нет новых тем для публикации.", { status: 200 });
    }

    // === БЛОК 2: Картинки ===
    const images = [
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800",
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
      "https://images.unsplash.com/photo-1563089145-599997674d42?w=800",
      "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800",
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800"
    ];
    const randomImage = images[Math.floor(Math.random() * images.length)];

    // === БЛОК 3: Промпт для Gemini ===
    const prompt = `Напиши рэп-батл из двух реплик на тему реальной новости: "${currentTopic}".
Опирайся на суть заголовка, но стилизуй под киберпанк-баттл зомби-диджея и киборга.
Строго соблюдай формат, без вводных слов, без фразы "мозги кипят":
🧟‍♂️ Zombie-DJ: [текст куплета в 2 строки с рифмой]
🤖 Cyber-MC: [текст ответа в 2 строки с рифмой]`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const geminiData = await geminiResponse.json();
    let rapText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "🧟‍♂️ Zombie-DJ: Бит летит, но сеть шумит\n🤖 Cyber-MC: Процессор на бадле горит!";

    if (rapText.includes("мозги кипят") || rapText.length < 10) {
      rapText = `🧟‍♂️ Zombie-DJ: Сигнал в эфире, биты гремят!\n🤖 Cyber-MC: Зомби и киборг снова в ряд!`;
    }

    // === БЛОК 4: Формируем пост со ссылкой на источник ===
    const finalPost = `🎧 **Инфоповод:** ${currentTopic}\n🔗 [Источник](${newsLink})\n\n${rapText}`;

    // === БЛОК 5: Отправка в Telegram ===
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const tgResponse = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        photo: randomImage,
        caption: finalPost,
        parse_mode: "Markdown"
      })
    });

    if (!tgResponse.ok) {
      const errText = await tgResponse.text();
      return new Response(`Telegram error: ${errText}`, { status: 500 });
    }

    return new Response("🤖 Отправлено без багов!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
