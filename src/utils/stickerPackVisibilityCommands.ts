import fs from 'fs';
import fsp from 'fs/promises';
import {generateStickerPackFilePath} from './telegramStickers.js';
import {
  PackVisibility,
  updateStickerPackMetadata,
} from './stickerPackMetadata.js';
import {
  CommandContext,
  formatCommandUsage,
  isAllowedTelegramUser,
  resolveStickerPackNameFromCommand,
} from './telegramCommandUtils.js';

export {isAllowedTelegramUser, resolveStickerPackNameFromCommand};
export type {CommandContext as VisibilityCommandContext};
export type {ResolvePackNameResult} from './telegramCommandUtils.js';

export async function handleVisibilityCommand(
  ctx: CommandContext,
  visibility: PackVisibility,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    await ctx.reply(formatCommandUsage(visibility));
    return false;
  }

  const packName = resolveResult.packName;
  const manifestPath = generateStickerPackFilePath(packName);

  try {
    await fsp.access(manifestPath, fs.constants.R_OK);
  } catch {
    await ctx.reply(`Sticker pack "${packName}" does not exist locally.`);
    return false;
  }

  await updateStickerPackMetadata(packName, {visibility});
  await ctx.reply(`Pack "${packName}" is now ${visibility}.`);
  return true;
}
