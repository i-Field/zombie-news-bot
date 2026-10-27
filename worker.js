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
    // 1. Пул тем и инфоповодов для максимального разнообразия (чтобы бот не повторялся)
    const topics = [
      "ИИ захватывает кофейни и увольняет бариста",
      "Цены на видеокарты упали, но геймеры застряли в ретро-играх",
      "Ученые создали робота-голубя, который шпионит за прохожими",
      "Крипто-инвестор случайно купил остров в метавселенной и потерял вайб",
      "В метро запустили вагон с бесплатным кибер-панк караоке",
      "Новый квантовый процессор запек пиццу за две секунды",
      "Уличные хакеры взломали билборд и запустили трансляцию старого рэпа"
    ];
    
    // Выбираем случайную тему каждый раз
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];

    // 2. Список стилей, чтобы тексты и рифмы всегда были разными
    const styles = [
      "Агрессивный андерграунд-рэп с тяжелым басом",
      "Киберпанк-читка с упором на технологии и баги",
      "Ироничный бум-бэп старой школы с уличным сленгом",
      "Мрачный зомби-мотив с черным юмором"
    ];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];

    // 3. Промпт для Gemini с четким разделением ролей
    const prompt = `
Ты — генератор контента для уличного рэп-радио. 
Используй тему: "${randomTopic}".
Музыкальный вайб/стиль: "${randomStyle}".

Напиши короткий, качающий рэп-диалог (фит) двух персонажей. Никаких шаблонных фраз вроде "мозги кипят", только живые рифмы!

Формат ответа (строго соблюдай имена):
🧟‍♂️ **Zombie-DJ:** [Текст куплета или панча на 2-3 строки, рифмованный рэп]
🤖 **Cyber-MC:** [Ответный панч, ирония или развитие темы на 2-3 строки, рифмованный рэп]

Используй эмодзи. Текст должен быть бодрым, дерзким и уникальным!
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

    // Собираем итоговое сообщение
    const finalPost = `🎙 **Трек часа / Тема:** ${randomTopic}\n⚡️ **Стиль:** ${randomStyle}\n\n${rapText}`;

    // 4. Отправка в Telegram
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResponse = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: finalPost,
        parse_mode: "Markdown"
      })
    });

    return new Response("🤖 Разнообразный рэп-баттл успешно отправлен!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
