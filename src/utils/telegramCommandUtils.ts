import {Telegram} from 'telegraf';
import {isValidStickerPackName} from './stickerPackMetadata.js';

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

export interface CommandContext {
  from?: {
    id: string | number;
  };
  args?: string[];
  payload?: string;
  message?: unknown;
  telegram?: Telegram;
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

export function extractArgs(ctx: CommandContext): string[] | undefined {
  if (ctx.args && Array.isArray(ctx.args)) {
    return ctx.args;
  }
  if (typeof ctx.payload === 'string' && ctx.payload.trim().length > 0) {
    return ctx.payload.trim().split(/\s+/);
  }
  const message = ctx.message;
  if (
    message &&
    typeof message === 'object' &&
    'text' in message &&
    typeof message.text === 'string' &&
    message.text.startsWith('/')
  ) {
    const tokens = message.text.trim().split(/\s+/).slice(1);
    if (tokens.length > 0) {
      return tokens;
    }
  }
  return undefined;
}

export function resolveStickerPackNameFromCommand(
  ctx: CommandContext,
): ResolvePackNameResult {
  const args = extractArgs(ctx);
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

export type ParseGcRetentionResult =
  | {success: true; retention: number | undefined}
  | {success: false; error: 'too_many_args' | 'invalid_arg'};

export function parseGcRetentionArgument(
  ctx: CommandContext,
): ParseGcRetentionResult {
  const args = extractArgs(ctx);
  if (!args || args.length === 0) {
    return {success: true, retention: undefined};
  }
  if (args.length > 1) {
    return {success: false, error: 'too_many_args'};
  }
  const raw = args[0];
  if (!/^[1-9]\d*$/.test(raw)) {
    return {success: false, error: 'invalid_arg'};
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 1) {
    return {success: false, error: 'invalid_arg'};
  }
  return {success: true, retention: num};
}

export function formatCommandUsage(commandName: string): string {
  const cleanName = commandName.startsWith('/')
    ? commandName
    : `/${commandName}`;
  return `Usage: ${cleanName} <pack-name>\nor reply with ${cleanName} to a sticker from the pack.`;
}

export function formatUptime(uptimeSeconds: number): string {
  const totalSec = Math.floor(Math.max(0, uptimeSeconds));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  if (parts.length === 0) {
    return `${seconds}s`;
  }
  return parts.join(' ');
}
