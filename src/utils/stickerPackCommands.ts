import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {Telegram} from 'telegraf';
import {getStickerPackMetadata} from './stickerPackMetadata.js';
import {
  CommandContext,
  formatCommandUsage,
  formatUptime,
  isAllowedTelegramUser,
  resolveStickerPackNameFromCommand,
} from './telegramCommandUtils.js';
import {
  DATA_DIR,
  downloadStickerPack,
  enqueueStickerPackOperation,
  generateStickerPackDirPath,
  generateStickerPackExternalUrl,
  generateStickerPackFilePath,
  generateStickerPreviewFilePath,
  getStickerContentSignature,
  getTelegramStickerContentSignature,
  isStickerPackDownloaded,
  parseDownloadConcurrency,
  readManifestOrUndefined,
  validateLocalStickerPackManifest,
} from './telegramStickers.js';
import {
  resolveStickerAssetPath,
  verifyStoredStickerAsset,
} from './stickerAssetStorage.js';

export interface ReplyContext {
  reply: (text: string) => Promise<unknown>;
}

async function isLocalStickerAssetAvailable(
  stickerSetName: string,
  version: number | undefined,
  filename: string,
  kind: 'stickers' | 'previews',
  legacyPath: string,
): Promise<boolean> {
  if (version === undefined) {
    try {
      await fsp.access(legacyPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const assetPath = await resolveStickerAssetPath(
      stickerSetName,
      version,
      filename,
      kind,
    );
    return (
      assetPath !== undefined &&
      (await verifyStoredStickerAsset(stickerSetName, path.basename(assetPath)))
    );
  } catch {
    return false;
  }
}

export async function importOrGetStickerPack(
  telegram: Telegram,
  stickerPackName: string,
  ctx: ReplyContext,
): Promise<boolean> {
  return await enqueueStickerPackOperation(stickerPackName, async () => {
    let stickerSet;
    try {
      stickerSet = await telegram.getStickerSet(stickerPackName);
    } catch (e) {
      await ctx.reply(
        `Error: Telegram sticker pack "${stickerPackName}" not found.`,
      );
      return false;
    }

    const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
    if (await isStickerPackDownloaded(stickerSet.name)) {
      try {
        await fsp.access(mcStickerPackPath, fs.constants.R_OK);
        const stickerPackUrl = generateStickerPackExternalUrl(stickerSet.name);
        await ctx.reply(stickerPackUrl);
        return true;
      } catch {
        // If manifest is inaccessible despite check, continue to download
      }
    }

    await ctx.reply('Downloading the sticker pack...');
    try {
      await downloadStickerPack(telegram, stickerSet);
    } catch (e) {
      await ctx.reply('StickerPack download error.');
      return false;
    }

    try {
      await fsp.access(mcStickerPackPath, fs.constants.R_OK);
    } catch {
      await ctx.reply('Error: Sticker pack download error.');
      return false;
    }

    const stickerPackUrl = generateStickerPackExternalUrl(stickerSet.name);
    await ctx.reply(stickerPackUrl);
    return true;
  });
}

export async function handlePackCommand(ctx: CommandContext): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    await ctx.reply(formatCommandUsage('pack'));
    return false;
  }

  if (!ctx.telegram) {
    await ctx.reply('Error: Telegram client is unavailable.');
    return false;
  }

  return await importOrGetStickerPack(
    ctx.telegram,
    resolveResult.packName,
    ctx,
  );
}

export async function handleRefreshCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    await ctx.reply(formatCommandUsage('refresh'));
    return false;
  }

  if (!ctx.telegram) {
    await ctx.reply('Error: Telegram client is unavailable.');
    return false;
  }

  const packName = resolveResult.packName;
  return await enqueueStickerPackOperation(packName, async () => {
    let stickerSet;
    try {
      stickerSet = await ctx.telegram!.getStickerSet(packName);
    } catch {
      await ctx.reply(`Error: Telegram sticker pack "${packName}" not found.`);
      return false;
    }

    const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
    try {
      await downloadStickerPack(ctx.telegram!, stickerSet);
    } catch (err) {
      console.error(`Failed to refresh sticker pack "${packName}":`, err);
      await ctx.reply(`Error: Failed to refresh sticker pack "${packName}".`);
      return false;
    }

    try {
      await fsp.access(mcStickerPackPath, fs.constants.R_OK);
    } catch {
      await ctx.reply(`Error: Failed to refresh sticker pack "${packName}".`);
      return false;
    }

    let updatedVersion: number | string = 1;
    try {
      const manifestRaw = await readManifestOrUndefined(stickerSet.name);
      if (
        manifestRaw &&
        typeof manifestRaw === 'object' &&
        'dynamic' in manifestRaw
      ) {
        const dyn = (manifestRaw as {dynamic?: {version?: number}}).dynamic;
        if (dyn && typeof dyn.version === 'number') {
          updatedVersion = dyn.version;
        }
      }
    } catch {
      // Keep fallback version
    }

    const packUrl = generateStickerPackExternalUrl(stickerSet.name);
    await ctx.reply(
      `Pack "${packName}" refreshed successfully.\nVersion: ${updatedVersion}\n${packUrl}`,
    );
    return true;
  });
}

export async function handleCheckCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    await ctx.reply(formatCommandUsage('check'));
    return false;
  }

  if (!ctx.telegram) {
    await ctx.reply('Error: Telegram client is unavailable.');
    return false;
  }

  const packName = resolveResult.packName;
  const manifestPath = generateStickerPackFilePath(packName);

  try {
    await fsp.access(manifestPath, fs.constants.R_OK);
  } catch {
    await ctx.reply(
      `Pack "${packName}" is not downloaded locally.\nUse /pack ${packName} to download it.`,
    );
    return false;
  }

  let rawContent: string;
  try {
    rawContent = await fsp.readFile(manifestPath, 'utf8');
  } catch {
    await ctx.reply(
      `Pack "${packName}" has a malformed local manifest.\n\nUse /refresh ${packName} to repair it.`,
    );
    return false;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    await ctx.reply(
      `Pack "${packName}" has a malformed local manifest.\n\nUse /refresh ${packName} to repair it.`,
    );
    return false;
  }

  const localManifest = validateLocalStickerPackManifest(parsedJson);
  if (!localManifest) {
    await ctx.reply(
      `Pack "${packName}" has a malformed local manifest.\n\nUse /refresh ${packName} to repair it.`,
    );
    return false;
  }

  let tgStickerSet;
  try {
    tgStickerSet = await ctx.telegram.getStickerSet(packName);
  } catch {
    await ctx.reply(
      `Error: Telegram sticker pack "${packName}" not found on Telegram.`,
    );
    return false;
  }

  const localSignature = getStickerContentSignature(localManifest.stickers);
  const tgSignature = getTelegramStickerContentSignature(
    packName,
    tgStickerSet.stickers,
  );

  if (localSignature !== tgSignature) {
    await ctx.reply(
      `Pack "${packName}" is out of date.\n\n` +
        `Local stickers: ${localManifest.stickers.length}\n` +
        `Telegram stickers: ${tgStickerSet.stickers.length}\n\n` +
        `Use /refresh ${packName} to update it.`,
    );
    return false;
  }

  const packDir = generateStickerPackDirPath(packName);
  for (const sticker of localManifest.stickers) {
    if (
      !sticker.filename ||
      typeof sticker.filename !== 'string' ||
      sticker.filename.trim().length === 0 ||
      path.basename(sticker.filename) !== sticker.filename ||
      sticker.filename.includes('..')
    ) {
      await ctx.reply(
        `Pack "${packName}" has an incomplete local cache.\n\nMissing sticker or preview files were detected.\n\nUse /refresh ${packName} to repair it.`,
      );
      return false;
    }

    const version = localManifest.dynamic?.version;
    const stickerAvailable = await isLocalStickerAssetAvailable(
      packName,
      version,
      sticker.filename,
      'stickers',
      path.join(packDir, sticker.filename),
    );
    if (!stickerAvailable) {
      await ctx.reply(
        `Pack "${packName}" has an incomplete local cache.\n\nMissing sticker or preview files were detected.\n\nUse /refresh ${packName} to repair it.`,
      );
      return false;
    }

    const stickerUniqueId = sticker.id.split(':').pop();
    if (!stickerUniqueId) {
      await ctx.reply(
        `Pack "${packName}" has an incomplete local cache.\n\nMissing sticker or preview files were detected.\n\nUse /refresh ${packName} to repair it.`,
      );
      return false;
    }

    const previewFilename = `${stickerUniqueId}.webp`;
    const previewAvailable = await isLocalStickerAssetAvailable(
      packName,
      version,
      previewFilename,
      'previews',
      generateStickerPreviewFilePath(packName, stickerUniqueId),
    );
    if (!previewAvailable) {
      await ctx.reply(
        `Pack "${packName}" has an incomplete local cache.\n\nMissing sticker or preview files were detected.\n\nUse /refresh ${packName} to repair it.`,
      );
      return false;
    }
  }

  const metadata = await getStickerPackMetadata(packName);
  const version =
    localManifest.dynamic?.version !== undefined
      ? localManifest.dynamic.version
      : 'legacy';

  await ctx.reply(
    `Pack "${packName}" is OK and up to date.\n\n` +
      `Stickers: ${localManifest.stickers.length}\n` +
      `Version: ${version}\n` +
      `Visibility: ${metadata.visibility}`,
  );
  return true;
}

export async function handleInfoCommand(ctx: CommandContext): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const resolveResult = resolveStickerPackNameFromCommand(ctx);
  if (!resolveResult.success) {
    await ctx.reply(formatCommandUsage('info'));
    return false;
  }

  const packName = resolveResult.packName;
  const manifestPath = generateStickerPackFilePath(packName);

  try {
    await fsp.access(manifestPath, fs.constants.R_OK);
  } catch {
    await ctx.reply(
      `Sticker pack "${packName}" does not exist locally.\nUse /pack ${packName} to download it.`,
    );
    return false;
  }

  let raw: string;
  try {
    raw = await fsp.readFile(manifestPath, 'utf8');
  } catch {
    await ctx.reply(
      `Error: Local manifest for pack "${packName}" is malformed.`,
    );
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await ctx.reply(
      `Error: Local manifest for pack "${packName}" is malformed.`,
    );
    return false;
  }

  const manifest = validateLocalStickerPackManifest(parsed);
  if (!manifest) {
    await ctx.reply(
      `Error: Local manifest for pack "${packName}" is malformed.`,
    );
    return false;
  }

  const metadata = await getStickerPackMetadata(packName);
  const totalStickers = manifest.stickers.length;
  const staticCount = manifest.stickers.filter(s => !s.isAnimated).length;
  const animatedCount = manifest.stickers.filter(
    s => s.isAnimated === true,
  ).length;
  const version =
    manifest.dynamic?.version !== undefined
      ? manifest.dynamic.version
      : 'legacy';
  const url = generateStickerPackExternalUrl(packName);

  const text =
    `Pack: ${packName}\n` +
    `Title: ${manifest.title || packName}\n` +
    `Stickers: ${totalStickers}\n` +
    `Static: ${staticCount}\n` +
    `Animated: ${animatedCount}\n` +
    `Version: ${version}\n` +
    `Visibility: ${metadata.visibility}\n\n` +
    `${url}`;

  await ctx.reply(text);
  return true;
}

export async function handleStatsCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  let files: string[] = [];
  try {
    files = await fsp.readdir(DATA_DIR);
  } catch {
    await ctx.reply('Error: Unable to read sticker data directory.');
    return false;
  }

  const manifestFiles = files
    .filter(f => f.endsWith('.telegram.stickerpack'))
    .sort();
  let totalPacks = 0;
  let publicPacks = 0;
  let unlistedPacks = 0;
  let totalStickers = 0;
  let staticStickers = 0;
  let animatedStickers = 0;
  let invalidPacks = 0;

  for (const filename of manifestFiles) {
    const packName = filename.slice(0, -'.telegram.stickerpack'.length);
    const filePath = path.join(DATA_DIR, filename);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const manifest = validateLocalStickerPackManifest(parsed);
      if (!manifest) {
        invalidPacks++;
        continue;
      }
      totalPacks++;
      totalStickers += manifest.stickers.length;
      for (const s of manifest.stickers) {
        if (s.isAnimated === true) {
          animatedStickers++;
        } else {
          staticStickers++;
        }
      }
      const meta = await getStickerPackMetadata(packName);
      if (meta.visibility === 'public') {
        publicPacks++;
      } else {
        unlistedPacks++;
      }
    } catch {
      invalidPacks++;
    }
  }

  let response =
    'Sticker library statistics\n\n' +
    `Packs: ${totalPacks}\n` +
    `Public: ${publicPacks}\n` +
    `Unlisted: ${unlistedPacks}\n\n` +
    `Stickers: ${totalStickers}\n` +
    `Static: ${staticStickers}\n` +
    `Animated: ${animatedStickers}`;

  if (invalidPacks > 0) {
    response += `\n\nInvalid packs: ${invalidPacks}`;
  }

  await ctx.reply(response);
  return true;
}

export async function handleStatusCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  let dataDirOk = false;
  try {
    await fsp.access(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    dataDirOk = true;
  } catch {
    dataDirOk = false;
  }

  const externalUrlConfigured = Boolean(process.env.EXTERNAL_URL);
  const status = dataDirOk && externalUrlConfigured ? 'OK' : 'DEGRADED';
  const uptime = formatUptime(process.uptime());
  const concurrency = parseDownloadConcurrency(process.env.CONCURRENCY);

  const response =
    'MoreStickersConverter status\n\n' +
    `Status: ${status}\n` +
    `Uptime: ${uptime}\n` +
    `Node.js: ${process.version}\n` +
    `Download concurrency: ${concurrency}\n` +
    `Data directory: ${dataDirOk ? 'OK' : 'Inaccessible'}\n` +
    `External URL: ${externalUrlConfigured ? 'configured' : 'missing'}`;

  await ctx.reply(response);
  return true;
}
