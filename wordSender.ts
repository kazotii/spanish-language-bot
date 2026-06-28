import { Context, Markup } from "telegraf";
import { Telegraf } from "telegraf";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

const calculateInterval = (currentBox: number, isCorrect: boolean) => {
  if (!isCorrect) {
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + 1);
    return { box: 1, nextReview };
  }
  const nextBox = Math.min(currentBox + 1, 5);
  const intervals: Record<number, number> = {
    1: 1,
    2: 3,
    3: 5,
    4: 10,
    5: 15,
    6: 30,
    7: 45,
    8: 60,
    9: 90,
    10: 120,
  };
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + (intervals[nextBox] || 30));
  return { box: nextBox, nextReview };
};

const sendNextWord = async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const now = new Date();

  const dueProgress = await prisma.progress.findMany({
    where: {
      chatId: chatId.toString(),
      nextReview: { lte: now },
      box: { lte: 5 },
    },
    select: { wordId: true },
    take: 10,
  });

  if (dueProgress.length > 0) {
    const dueWordIds = dueProgress.map((p) => p.wordId);
    const randomIndex = Math.floor(Math.random() * dueWordIds.length);
    const targetWordId = dueWordIds[randomIndex];

    const word = await prisma.word.findUnique({ where: { id: targetWordId } });
    if (word) {
      ctx.reply(
        `🔁 Время повторить: ${word.word}?`,
        Markup.inlineKeyboard([
          Markup.button.callback("Показать перевод", `show_${word.id}`),
        ]),
      );
      return;
    }
  }

  const allUserProgress = await prisma.progress.findMany({
    where: { chatId: chatId.toString() },
    select: { wordId: true },
  });
  const learnedWordIds = allUserProgress.map((p) => p.wordId);

  const newWords = await prisma.word.findMany({
    where: { id: { notIn: learnedWordIds } },
  });

  if (newWords.length === 0) {
    ctx.reply(
      "🎉 Все доступные слова разобраны! Новых слов пока нет, загляни позже для повторения.",
    );
    return;
  }

  const randomIndex = Math.floor(Math.random() * newWords.length);
  const currentWord = newWords[randomIndex];

  ctx.reply(
    `Как переводится: ${currentWord.word}?`,
    Markup.inlineKeyboard([
      Markup.button.callback("Показать перевод", `show_${currentWord.id}`),
    ]),
  );
};

export const wordSender = (bot: Telegraf) => {
  bot.command("word", async (ctx: Context) => {
    await sendNextWord(ctx);
  });

  bot.action(
    /^show_(.+)$/,
    async (ctx: Context & { match: RegExpExecArray }) => {
      const wordId = parseInt(ctx.match[1]);
      const wordRecord = await prisma.word.findUnique({
        where: { id: wordId },
      });

      if (!wordRecord) {
        await ctx.reply("Слово не найдено");
        return;
      }
      await ctx.editMessageText(
        `${wordRecord.word} - ${wordRecord.translation}`,
        Markup.inlineKeyboard([
          Markup.button.callback("🟢 Знаю", `know_${wordId}`),
          Markup.button.callback("🔴 Не знаю", `dont_${wordId}`),
        ]),
      );
    },
  );

  bot.action(
    /^know_(.+)$/,
    async (ctx: Context & { match: RegExpExecArray }) => {
      const wordId = parseInt(ctx.match[1]);
      const chatId = ctx.callbackQuery?.message?.chat.id;
      if (!chatId) return;

      const currentProgress = await prisma.progress.findUnique({
        where: { chatId_wordId: { chatId: chatId.toString(), wordId } },
      });

      const currentBox = currentProgress?.box || 0; // 0 если слово новое
      const { box, nextReview } = calculateInterval(currentBox, true);

      await prisma.progress.upsert({
        where: { chatId_wordId: { chatId: chatId.toString(), wordId } },
        update: { box, nextReview },
        create: { chatId: chatId.toString(), wordId, box, nextReview },
      });

      await ctx.answerCbQuery(`Отлично! Уровень ${box}/5. Отложено.`);

      const wordRecord = await prisma.word.findUnique({
        where: { id: wordId },
      });
      if (wordRecord) {
        await ctx.editMessageText(
          `${wordRecord.word} - ${wordRecord.translation} (Уровень ${box})`,
        );
      }

      await sendNextWord(ctx);
    },
  );

  bot.action(
    /^dont_(.+)$/,
    async (ctx: Context & { match: RegExpExecArray }) => {
      const wordId = parseInt(ctx.match[1]);
      const chatId = ctx.callbackQuery?.message?.chat.id;
      if (!chatId) return;

      const currentProgress = await prisma.progress.findUnique({
        where: { chatId_wordId: { chatId: chatId.toString(), wordId } },
      });

      const currentBox = currentProgress?.box || 0;
      const { box, nextReview } = calculateInterval(currentBox, false);

      await prisma.progress.upsert({
        where: { chatId_wordId: { chatId: chatId.toString(), wordId } },
        update: { box, nextReview },
        create: { chatId: chatId.toString(), wordId, box, nextReview },
      });

      await ctx.answerCbQuery("Сброшено в уровень 1. Повторим завтра.");

      const wordRecord = await prisma.word.findUnique({
        where: { id: wordId },
      });
      if (wordRecord) {
        await ctx.editMessageText(
          `${wordRecord.word} - ${wordRecord.translation} (Повторить завтра)`,
        );
      }

      await sendNextWord(ctx);
    },
  );

  bot.command("stats", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const startedCount = await prisma.progress.count({
      where: { chatId: chatId.toString() },
    });

    const learnedCount = await prisma.progress.count({
      where: { chatId: chatId.toString(), box: 5 },
    });

    await ctx.reply(
      `📈 *Твой прогресс!*\n\n` +
        `Слов на изучении: *${startedCount}*\n` +
        `Полностью выучено (Уровень 5): *${learnedCount}*\n\n` +
        `¡Buen trabajo! Продолжай в том же темпе!`,
      { parse_mode: "Markdown" },
    );
  });
};
