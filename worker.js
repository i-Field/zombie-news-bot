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
      console.log("Ищем новости в Hacker News...");
      const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      const storyIds = await topStoriesRes.json();
      
      // УВЕЛИЧИЛИ ДО 50, чтобы найти те, которые точно не отправляли
      const recentIds = storyIds.slice(0, 50);
      console.log(`Получено ID новостей: ${recentIds.length}. Начинаем проверку...`);

      for (const id of recentIds) {
        const key = `sent:hn_${id}`;
        const alreadySent = await env.NEWS_KV.get(key);

        if (!alreadySent) {
          console.log(`Нашли новую новость с ID: ${id}`);
          const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = await itemRes.json();

          // Проверка, что новость не удалена и у неё есть заголовок
          if (item && item.title) {
            currentTopic = item.title;
            newsLink = item.url || `https://news.ycombinator.com/item?id=${id}`;
            await env.NEWS_KV.put(key, "1");
            console.log(`Выбрана тема: ${currentTopic}`);
            break; 
          }
        }
      }
    } catch (e) {
      console.error("Ошибка HN API:", e);
    }

    if (!currentTopic) {
      console.log("Все новости из списка уже были опубликованы.");
      return new Response("📭 Нет новых тем для публикации.", { status: 200 });
    }

    // === БЛОК 2: Генерация картинки через нейросеть ===
    const randomSeed = Math.floor(Math.random() * 100000);
    const promptForImage = "cyberpunk,zombie,neon,robot";
    const randomImage = `https://image.pollinations.ai/prompt/${promptForImage}?width=800&height=600&nologo=true&seed=${randomSeed}`;

    // === БЛОК 3: Промпт для Gemini (Модель 3.8 Flash) ===
    const styles = [
      "в стиле агрессивного дрилла", 
      "в стиле олдскульного хип-хопа 90-х", 
      "в стиле мрачного киберпанк-трэпа", 
      "с легким безумием и быстрым флоу", 
      "философски и мрачно"
    ];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];

    const prompt = `Напиши рэп-батл из двух реплик на тему реальной новости: "${currentTopic}".
Стиль: ${randomStyle}.
Опирайся на суть заголовка, но стилизуй под киберпанк-баттл зомби-диджея и киборга.
Строго соблюдай формат, без вводных слов, без фразы "мозги кипят":
🧟‍♂️ Zombie-DJ: [текст куплета в 2 строки с рифмой]
🤖 Cyber-MC: [текст ответа в 2 строки с рифмой]`;

    console.log("Отправляем запрос в Gemini...");
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    const geminiData = await geminiResponse.json();
    
    let rapText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rapText || rapText.length < 10) {
      console.error("ОШИБКА GEMINI:", JSON.stringify(geminiData));
      const errorDetails = JSON.stringify(geminiData).substring(0, 300); 
      const safeError = errorDetails.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rapText = `🚨 ОШИБКА API!\nВот что ответил Google:\n${safeError}`;
    } else {
      console.log("Рэп успешно сгенерирован!");
    }

    // === БЛОК 4: Формируем пост ===
    const safeTitle = currentTopic.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let safeRap = rapText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    if (safeRap.length > 700) {
      safeRap = safeRap.substring(0, 700) + "...";
    }
    
    const finalPost = `🎧 <b>Инфоповод:</b> ${safeTitle}\n🔗 <a href="${newsLink}">Источник</a>\n\n${safeRap}`;

    // === БЛОК 5: Отправка в Telegram ===
    console.log("Отправляем в Telegram...");
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

    if (!tgResponse.ok) {
      const errText = await tgResponse.text();
      console.error("Ошибка sendPhoto:", errText);
      
      const tgTextUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(tgTextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: finalPost,
          parse_mode: "HTML",
          disable_web_page_preview: true 
        })
      });
      return new Response("⚠️ Картинка не загрузилась, отправлен текст", { status: 200 });
    }

    return new Response("🤖 Отправлено без багов!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
