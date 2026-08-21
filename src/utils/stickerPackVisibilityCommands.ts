import fs from 'fs';
import fsp from 'fs/promises';
import {generateStickerPackFilePath} from './telegramStickers.js';
import {
  PackVisibility,
  isValidStickerPackName,
  updateStickerPackMetadata,
} from './stickerPackMetadata.js';

export function isAllowedTelegramUser(
  userId: string | number | undefined,
): boolean {
  if (userId === undefined || userId === null) {
    return false;
  }
  const allowedTelegramUserIds = new Set(
    (process.env.ALLOWED_TELEGRAM_USER_IDS ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
  );
  return allowedTelegramUserIds.has(String(userId));
}

export interface VisibilityCommandContext {
  from?: {
    id: string | number;
  };
  args?: string[];
  message?: unknown;
  reply: (text: string) => Promise<unknown>;
}

export type ResolvePackNameResult =
  | {success: true; packName: string}
  | {
      success: false;
      error:
        | 'too_many_args'
        | 'invalid_arg'
        | 'no_target'
        | 'invalid_reply_sticker';
    };

export function resolveStickerPackNameFromCommand(
  ctx: VisibilityCommandContext,
): ResolvePackNameResult {
  const args = ctx.args;
  if (args && args.length > 0) {
    if (args.length > 1) {
      return {success: false, error: 'too_many_args'};
    }
    const rawArg = args[0];
    if (!isValidStickerPackName(rawArg)) {
      return {success: false, error: 'invalid_arg'};
    }
    return {success: true, packName: rawArg};
  }

  const message = ctx.message;
  if (
    message &&
    typeof message === 'object' &&
    'reply_to_message' in message &&
    message.reply_to_message &&
    typeof message.reply_to_message === 'object' &&
    'sticker' in message.reply_to_message
  ) {
    const replySticker = message.reply_to_message.sticker;
    if (replySticker && typeof replySticker === 'object') {
      if ('set_name' in replySticker) {
        const setName = replySticker.set_name;
        if (typeof setName === 'string' && setName.length > 0) {
          if (!isValidStickerPackName(setName)) {
            return {success: false, error: 'invalid_arg'};
          }
          return {success: true, packName: setName};
        }
      }
      return {success: false, error: 'invalid_reply_sticker'};
    }
  }

  return {success: false, error: 'no_target'};
}

export async function handleVisibilityCommand(
  ctx: VisibilityCommandContext,
  visibility: PackVisibility,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    const usage =
      visibility === 'public'
        ? 'Usage: /public <pack-name>\nor reply with /public to a sticker from the pack.'
        : 'Usage: /unlisted <pack-name>\nor reply with /unlisted to a sticker from the pack.';
    await ctx.reply(usage);
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
