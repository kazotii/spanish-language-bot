import { Telegraf } from "telegraf";
import "dotenv/config";
import { wordSender } from "./wordSender";
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Ты забыл прописать TELEGRAM_BOT_TOKEN в файле .env!");
}

const bot = new Telegraf(token);

wordSender(bot);

bot.start((ctx) => {
  ctx.reply(
    "¡Hola! Я твой личный тренер по испанскому. Скоро мы начнем учить слова!",
  );
});

bot.on("text", (ctx) => {
  ctx.reply(`Ты написал: ${ctx.message.text}`);
});

bot.telegram
  .setMyCommands([
    { command: "start", description: "Запустить бота / Перезапуск" },
    { command: "word", description: "Получить новое испанское слово" },
    { command: "stats", description: "Посмотреть мою статистику" },
  ])
  .then(() => {
    console.log("Кнопка меню успешно настроена!");
  })
  .catch((err) => {
    console.error("Ошибка при установке меню команд:", err);
  });

// Запуск
bot.launch();
console.log("Бот успешно запущен локально!");
