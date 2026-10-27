export default {
  // 1. Запуск вручную через ссылку в браузере
  async fetch(request, env, ctx) {
    return await handleNewsGeneration(env);
  },

  // 2. Автоматический запуск по расписанию (каждый час)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleNewsGeneration(env));
  }
};

// Основная функция генерации и отправки
async function handleNewsGeneration(env) {
  try {
    // Вызов Gemini API для генерации короткого рэп-поста
    const prompt = "Напиши короткий, дерзкий рэп-куплет (4-6 строк) про самые свежие мировые новости или тренды на данный час. Используй эмодзи и зомби-стиль.";
    
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

    // Отправка текста в Telegram
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResponse = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: rapText
      })
    });

    return new Response("🤖 Пост успешно сгенерирован и отправлен!", { status: 200 });
  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
з
