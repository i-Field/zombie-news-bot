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
    // 1. Расширенный пул безумных тем
    const topics = [
      "ИИ захватил кофейни и увольняет бариста за медленный вайб",
      "Цены на видеокарты упали в ноль, но геймеры застряли в ретро-играх",
      "Ученые создали робота-голубя, который ворует вай-фай у прохожих",
      "Крипто-инвестор случайно купил остров в метавселенной и потерял кошелек",
      "В метро запустили вагон с бесплатным кибер-панк караоке",
      "Новый квантовый процессор запек пиццу за две секунды прямо на сервере",
      "Уличные хакеры взломали городской билборд и запустили рэп-батл",
      "В темном переулке ИИ-диджей вызвал на батл старый советский радиоприемник",
      "Кибер-панки устроили гонки на разгоняющихся электросамокатах по крышам"
    ];
    
    const currentTopic = topics[Math.floor(Math.random() * topics.length)];

    // 2. Рандомизация стилей подачи (чтобы каждый раз менялся настрой)
    const vibes = [
      "Агрессивный уличный панч-ток",
      "Ироничный кибер-сарказм",
      "Мрачный андеграундный вайб",
      "Динамичный батл-рэп старой школы"
    ];
    const currentVibe = vibes[Math.floor(Math.random() * vibes.length)];

    // 3. Пул уникальных картинок
    const images = [
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800",
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
      "https://images.unsplash.com/photo-1563089145-599997674d42?w=800",
      "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800",
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800"
    ];
    const randomImage = images[Math.floor(Math.random() * images.length)];

    // 4. Усложненный промпт с жестким требованием разнообразия
    const prompt = `
Ты — дерзкий рэп-продюсер. Напиши короткий диалог-фит двух персонажей.
Тема: "${currentTopic}".
Настроение/Стиль: "${currentVibe}".

Важно: каждый раз используй абсолютно уникальные рифмы и обороты, не повторяйся!

Формат ответа (строго соблюдай разметку):
🧟‍♂️ Zombie-DJ: [2 строчки рэпа в стиле ${currentVibe}]
🤖 Cyber-MC: [2 строчки ответного панча]
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const geminiData = await geminiResponse.json();
    const rapText = geminiData.candidates[0].content.parts[0].text;

    const finalPost = `🎧 **Тема:** ${currentTopic}\n🔥 **Вайб:** ${currentVibe}\n\n${rapText}`;

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

    return new Response("🤖 Уникальный пост с картинкой отправлен!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
