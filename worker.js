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
    const topics = [
      "ИИ захватил кофейни и увольняет бариста за медленный вайб",
      "Цены на видеокарты упали в ноль, но геймеры застряли в ретро-играх",
      "Ученые создали робота-голубя, который ворует вай-фай у прохожих",
      "Крипто-инвестор случайно купил остров в метавселенной и потерял кошелек",
      "В метро запустили вагон с бесплатным кибер-панк караоке",
      "Новый квантовый процессор запек пиццу за две секунды прямо на сервере",
      "Уличные хакеры взломали городской билборд и запустили рэп-батл"
    ];
    
    const currentTopic = topics[Math.floor(Math.random() * topics.length)];

    const images = [
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800",
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
      "https://images.unsplash.com/photo-1563089145-599997674d42?w=800",
      "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800",
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800"
    ];
    const randomImage = images[Math.floor(Math.random() * images.length)];

    const prompt = `
Ты — рэп-продюсер. Напиши короткий диалог-фит для двух персонажей по теме: "${currentTopic}".

Формат вывода строго такой (пиши строго от этих имен с эмодзи):
🧟‍♂️ Zombie-DJ: [2 строки дерзкого рэпа с рифмой]
🤖 Cyber-MC: [2 строки ответного панча с рифмой]

Никаких лишних слов, только этот диалог!
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

    const finalPost = `🎧 **Тема часа:** ${currentTopic}\n\n${rapText}`;

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

    return new Response("🤖 Пост с картинкой и диалогом отправлен!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
