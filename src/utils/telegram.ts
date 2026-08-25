import {Telegraf} from 'telegraf';
import {message} from 'telegraf/filters';
import {
  handleCheckCommand,
  handleInfoCommand,
  handlePackCommand,
  handleRefreshAllCancelCommand,
  handleRefreshAllCommand,
  handleRefreshCommand,
  handleStatsCommand,
  handleStatusCommand,
  importOrGetStickerPack,
} from './stickerPackCommands.js';
import {handleVisibilityCommand} from './stickerPackVisibilityCommands.js';
import {isAllowedTelegramUser} from './telegramCommandUtils.js';

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN!);

bot.on(message('sticker'), async ctx => {
  if (!ctx.from || !isAllowedTelegramUser(ctx.from.id)) {
    return;
  }

  const stickerPackName = ctx.message.sticker.set_name;
  if (!stickerPackName) {
    await ctx.reply('This sticker does not belong to any sticker pack.');
    return;
  }

  await importOrGetStickerPack(ctx.telegram, stickerPackName, ctx);
});

bot.command('pack', async ctx => {
  await handlePackCommand(ctx);
});

bot.command('refresh', async ctx => {
  await handleRefreshCommand(ctx);
});
bot.command('refresh_all', async ctx => {
  await handleRefreshAllCommand(ctx);
});
bot.command('refresh_all_cancel', async ctx => {
  await handleRefreshAllCancelCommand(ctx);
});

bot.command('check', async ctx => {
  await handleCheckCommand(ctx);
});

bot.command('info', async ctx => {
  await handleInfoCommand(ctx);
});

bot.command('stats', async ctx => {
  await handleStatsCommand(ctx);
});

bot.command('status', async ctx => {
  await handleStatusCommand(ctx);
});

bot.command('public', async ctx => {
  await handleVisibilityCommand(ctx, 'public');
});

bot.command('unlisted', async ctx => {
  await handleVisibilityCommand(ctx, 'unlisted');
});

export {bot};
