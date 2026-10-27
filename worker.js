export default {
  async fetch(request, env, ctx) {
    try {
      // 1. Проверяем, что секреты на месте
      if (!env.GEMINI_API_KEY || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return new Response("❌ Ошибка: Не заданы секреты в переменных окружения Cloudflare!", { status: 500 });
      }

      // 2. Получаем свежую новость (например, из открытого RSS или используем тестовую для старта)
      const newsText = "Учёные выяснили, что кофе по утрам продлевает бодрость духа, но превращает людей в зомби до первой чашки.";

      // 3. Формируем запрос к Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const prompt = `Ты — веселый зомби-диджей и рэпер. Возьми эту новость: "${newsText}" и напиши на её основе короткий, качающий куплет в стиле русского рэпа и шансона. Используй сленг, темы про тлен, но на позитиве. Сделай смешно.`;

      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const aiData = await aiResponse.json();
      const rapVerse = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "Мозги кипят, а рифмы льются!";

      // 4. Отправляем готовый трек в Telegram-канал
      const message = `🧟‍♂️ **Зомби-Радио ФМ | Свежий трек**\n\n${rapVerse}\n\n#ЗомбиРэп #ХитыТлена`;
      
      const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const tgResponse = await fetch(tgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown"
        })
      });

      const tgResult = await tgResponse.json();

      if (!tgResult.ok) {
        return new Response(`❌ Ошибка Telegram API: ${JSON.stringify(tgResult)}`, { status: 500 });
      }

      return new Response("🤖 Успех! Зомби-бот успешно сгенерировал и отправил пост в канал!", { status: 200 });

    } catch (err) {
      return new Response(`❌ Критическая ошибка скрипта: ${err.message}`, { status: 500 });
    }
  },
};
