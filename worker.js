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
    // 1. Парсим свежую новость из RSS-ленты
    const rssUrl = "https://tproger.ru/feed/news"; // Можно заменять на любой RSS (lenta, habr, techcrunch)
    const rssResponse = await fetch(rssUrl);
    const xmlText = await rssResponse.text();

    // Быстро извлекаем заголовок первой свежей новости
    const titleMatch = xmlText.match(/<item>[\s\S]*?<title>(.*?)<\/title>/);
    const latestNewsTitle = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1') : "ИИ и технологии захватывают мир";

    // 2. Промпт для Gemini: Сделать диалог двух персонажей по РЕАЛЬНОЙ новости
    const prompt = `
Ты — сценарист рэп-баттла. На основе реальной новости: "${latestNewsTitle}", напиши короткий дерзкий диалог (рэп-фит) двух персонажей для Telegram-поста.

Персонажи:
🧟‍♂️ Zombie-DJ (Новости): зачитывает панч про новость (2-3 строки).
🤖 Cyber-MC (Оппонент): дерзко подхватывает, спорит или дорисовывает картину (2-3 строки).

Используй эмодзи, рифмы, зомби/киберпанк сленг. Пост должен быть коротким и сочным!
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

    // Формируем итоговое сообщение с указанием инфоповода
    const finalPost = `📰 **Главный инфоповод:** ${latestNewsTitle}\n\n${rapText}`;

    // 3. Отправка в Telegram
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

    return new Response("🤖 Пост с живой новостью и диалогом отправлен!", { status: 200 });

  } catch (err) {
    return new Response(`Ошибка: ${err.message}`, { status: 500 });
  }
}
