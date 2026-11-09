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
    // === БЛОК 1: Получаем свежий заголовок из Reddit JSON ===
    const feeds = [
      "https://www.reddit.com/r/technology/top/.json?limit=15&t=day",
      "https://www.reddit.com/r/robotics/top/.json?limit=15&t=day",
      "https://www.reddit.com/r/artificial/top/.json?limit=15&t=day"
    ];

    let currentTopic = null;
    let newsLink = null;

    // Перемешиваем ленты, чтобы бот не залипал на одном источнике
    const shuffled = [...feeds].sort(() => Math.random() - 0.5);

    for (const feedUrl of shuffled) {
      try {
        const res = await fetch(feedUrl, {
          headers: { "User-Agent": "zombie-news-bot/1.0 (by /u/zombie_news_bot)" }
        });
        if (!res.ok) continue;

        const data = await res.json();
        const posts = data?.data?.children || [];

        for (const post of posts) {
          const title = post?.data?.title;
          const permalink = post?.data?.permalink;
          if (!title || !permalink) continue;

          const key = `sent:${permalink}`;
          const alreadySent = await env.NEWS_KV.get(key);
          if (!alreadySent) {
            currentTopic = title;
            newsLink = `https://www.reddit.com${permalink}`;
            // Сохраняем сразу, чтобы при следующем запуске не взяли это же
            await env.NEWS_KV.put(key, "1");
            break;
          }
        }
        if (currentTopic) break;
      } catch (feedErr) {
        // Пропускаем сломанную ленту, идём к следующей
        continue;
      }
    }

    // Если всё уже отправлено — тихо выходим, не спамим канал
    if (!currentTopic) {
      return new Response("📭 Нет новых тем для публикации.", { status: 200 });
    }

    // === БЛОК 2: Картинки (ваш оригинальный пул) ===
    const images = [
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800",
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
      "https://images.unsplash.com/photo-1563089145-599997674d42?w=800",
      "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800",
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800"
    ];
    const randomImage = images[Math.floor(Math.random() * images.length)];

    // === БЛОК 3: Промпт для Gemini (опирается на реальный заголовок) ===
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

    // Защита от пустого/сломанного ответа
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
