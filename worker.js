export default {
  async fetch(request, env, ctx) {
    try {
      // 1. Проверяем секреты
      if (!env.GEMINI_API_KEY || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return new Response("❌ Ошибка: Какого-то из секретов нет в Cloudflare!", { status: 500 });
      }

      // 2. Проверяем отправку в Telegram напрямую (без Gemini, чтобы исключить ИИ)
      const testMessage = "🧟‍♂️ Тестовая проверка связи от Зомби-бота!";
      const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      const tgResponse = await fetch(tgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: testMessage
        })
      });

      const tgResult = await tgResponse.json();

      // Выводим точный ответ от Telegram на экран телефона
      return new Response(`Ответ Telegram API: ${JSON.stringify(tgResult)}`, { status: 200 });

    } catch (err) {
      return new Response(`❌ Ошибка кода: ${err.message}`, { status: 500 });
    }
  },
};
