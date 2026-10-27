export default {
  // Вызывается при ручном тестировании по ссылке
  async fetch(request, env, ctx) {
    await runZombieBotWorkflow(env);
    return new Response("🤖 Зомби-бот успешно сгенерировал и отправил пост!");
  },
  
  // Вызывается автоматически по расписанию (Cron)
  async scheduled(event, env, ctx) {
    await runZombieBotWorkflow(env);
  }
};

async function runZombieBotWorkflow(env) {
  // 1. Новости для генерации (в будущем сюда подключим живую RSS-ленту)
  const newsList = [
    "Ученые выяснили, что кофе помогает дожить до понедельника.",
    "В центре города заметили гигантского робота-уборщика, который сбежал с завода.",
    "Цены на видеокарты снова упали, но геймеры всё равно продолжают играть в старые игры.",
    "Метеорологи пообещали идеальную погоду для прогулок по ночному городу."
  ];
  const randomNews = newsList[Math.floor(Math.random() * newsList.length)];

  // 2. Запрос к Google Gemini API
  const prompt = `Ты — весёлый зомби-шансонье и уличный рэпер. Возьми эту новость и напиши на её основе короткий, качающий куплет (4-6 строк) в рифму, используя сленг, тему тлена, уличной романтики и юмора: "${randomNews}"`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  
  const aiResponse = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const aiData = await aiResponse.json();
  const trackText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "Мозги кипят, рифма не идет...";

  // 3. Отправка в Telegram
  const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(tgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `🧟‍♂️ **Зомби-Вести ФМ:**\n\n📰 *Новость:* ${randomNews}\n\n🎤 *Трек:* \n${trackText}`,
      parse_mode: "Markdown"
    })
  });
}
