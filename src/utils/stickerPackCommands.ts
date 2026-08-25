import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {Telegram} from 'telegraf';
import {getStickerPackMetadata} from './stickerPackMetadata.js';
import {listLocalStickerPackNames} from './stickerPackCatalog.js';
import {
  CommandContext,
  extractArgs,
  formatCommandUsage,
  formatUptime,
  isAllowedTelegramUser,
  parseGcRetentionArgument,
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
  formatByteSize,
  formatDurationSeconds,
  getGarbageCollectionStatus,
  resolveStickerAssetPath,
  runGarbageCollection,
  STICKER_PACK_VERSION_RETENTION,
  verifyStoredStickerAsset,
} from './stickerAssetStorage.js';
import {
  formatStatusResponse,
  getConverterStatusSnapshot,
} from './statusDiagnostics.js';
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

export interface RefreshStickerPackResult {
  success: boolean;
  packName: string;
  version?: number | string;
  url?: string;
  error?: string;
}

export async function refreshStickerPack(
  telegram: Telegram,
  packName: string,
): Promise<RefreshStickerPackResult> {
  return await enqueueStickerPackOperation(packName, async () => {
    let stickerSet;
    try {
      stickerSet = await telegram.getStickerSet(packName);
    } catch {
      return {
        success: false,
        packName,
        error: `Telegram sticker pack "${packName}" not found.`,
      };
    }

    const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
    try {
      await downloadStickerPack(telegram, stickerSet);
    } catch (err) {
      console.error(`Failed to refresh sticker pack "${packName}":`, err);
      return {
        success: false,
        packName,
        error: `Failed to refresh sticker pack "${packName}".`,
      };
    }

    try {
      await fsp.access(mcStickerPackPath, fs.constants.R_OK);
    } catch {
      return {
        success: false,
        packName,
        error: `Failed to refresh sticker pack "${packName}".`,
      };
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
    return {
      success: true,
      packName,
      version: updatedVersion,
      url: packUrl,
    };
  });
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
  const result = await refreshStickerPack(ctx.telegram, packName);
  if (!result.success) {
    await ctx.reply(
      `Error: ${result.error ?? `Failed to refresh sticker pack "${packName}".`}`,
    );
    return false;
  }

  await ctx.reply(
    `Pack "${packName}" refreshed successfully.\nVersion: ${result.version}\n${result.url}`,
  );
  return true;
}

const MAX_REPORTED_FAILED_PACKS = 25;
const MAX_FAILED_PACK_ERROR_LENGTH = 120;
const SAFE_REPORT_MAX_LENGTH = 3900;

export interface RefreshAllState {
  running: boolean;
  cancelRequested: boolean;
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentPack?: string;
  startedAt?: number;
}

export interface LastRefreshAllSummary {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  total: number;
  refreshed: number;
  failed: number;
  skipped: number;
  outcome: 'completed' | 'cancelled' | 'failed';
}

let refreshAllState: RefreshAllState | undefined;
let lastRefreshAll: LastRefreshAllSummary | undefined;

export function getRefreshAllStatus(): RefreshAllState {
  if (!refreshAllState) {
    return {
      running: false,
      cancelRequested: false,
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
    };
  }
  return {...refreshAllState};
}

export function getLastRefreshAll(): LastRefreshAllSummary | undefined {
  if (!lastRefreshAll) {
    return undefined;
  }
  return {...lastRefreshAll};
}

export function resetLastRefreshAllForTests(): void {
  lastRefreshAll = undefined;
}

export type RequestRefreshAllCancellationResult =
  | 'not_running'
  | 'requested'
  | 'already_requested';

export function requestRefreshAllCancellation(): RequestRefreshAllCancellationResult {
  if (!refreshAllState || !refreshAllState.running) {
    return 'not_running';
  }
  if (refreshAllState.cancelRequested) {
    return 'already_requested';
  }
  refreshAllState.cancelRequested = true;
  return 'requested';
}

export async function handleRefreshAllCancelCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const result = requestRefreshAllCancellation();
  if (result === 'not_running') {
    await ctx.reply('No refresh all operation is currently running.');
    return true;
  }
  if (result === 'already_requested') {
    await ctx.reply('Refresh all cancellation has already been requested.');
    return true;
  }
  await ctx.reply(
    'Refresh all cancellation requested.\nThe current pack will finish before the operation stops.',
  );
  return true;
}

function sanitizeFailedPackError(
  rawError: string | undefined,
  defaultMessage: string,
): string {
  const text = (rawError ?? defaultMessage).replace(/\r?\n+/g, ' ').trim();
  if (text.length <= MAX_FAILED_PACK_ERROR_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_FAILED_PACK_ERROR_LENGTH - 3)}...`;
}

export async function handleRefreshAllCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  if (!ctx.telegram) {
    await ctx.reply('Error: Telegram client is unavailable.');
    return false;
  }

  if (refreshAllState?.running) {
    await ctx.reply('Refresh all is already running.');
    return false;
  }

  const startTime = Date.now();
  refreshAllState = {
    running: true,
    cancelRequested: false,
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    startedAt: startTime,
  };

  try {
    let packNames: string[];
    try {
      packNames = await listLocalStickerPackNames();
    } catch (err) {
      console.error(
        'Failed to list local sticker packs for /refresh_all:',
        err,
      );
      lastRefreshAll = {
        startedAt: startTime,
        finishedAt: Date.now(),
        durationMs: Date.now() - startTime,
        total: 0,
        refreshed: 0,
        failed: 1,
        skipped: 0,
        outcome: 'failed',
      };
      await ctx.reply('Error: Unable to read local sticker packs.');
      return false;
    }

    if (packNames.length === 0) {
      lastRefreshAll = {
        startedAt: startTime,
        finishedAt: Date.now(),
        durationMs: Date.now() - startTime,
        total: 0,
        refreshed: 0,
        failed: 0,
        skipped: 0,
        outcome: 'completed',
      };
      await ctx.reply('No local sticker packs to refresh.');
      return true;
    }
    const count = packNames.length;
    refreshAllState.total = count;

    await ctx.reply(
      `Refreshing ${count} sticker pack${count === 1 ? '' : 's'}...`,
    );

    let successful = 0;
    const failedPacks: Array<{name: string; error: string}> = [];

    for (const packName of packNames) {
      if (refreshAllState.cancelRequested) {
        break;
      }

      refreshAllState.currentPack = packName;
      try {
        const result = await refreshStickerPack(ctx.telegram, packName);
        if (result.success) {
          successful++;
          refreshAllState.successful = successful;
        } else {
          const cleanError = sanitizeFailedPackError(
            result.error,
            `Failed to refresh sticker pack "${packName}".`,
          );
          failedPacks.push({name: packName, error: cleanError});
          refreshAllState.failed = failedPacks.length;
        }
      } catch (err) {
        console.error(`Unexpected failure refreshing pack "${packName}":`, err);
        const rawMessage =
          err instanceof Error
            ? err.message
            : `Failed to refresh sticker pack "${packName}".`;
        failedPacks.push({
          name: packName,
          error: sanitizeFailedPackError(
            rawMessage,
            `Failed to refresh sticker pack "${packName}".`,
          ),
        });
        refreshAllState.failed = failedPacks.length;
      } finally {
        refreshAllState.processed = successful + failedPacks.length;
        refreshAllState.currentPack = undefined;
      }
    }
    const processed = successful + failedPacks.length;
    const isCancelled = processed < count && refreshAllState.cancelRequested;
    const outcome = isCancelled ? 'cancelled' : 'completed';

    lastRefreshAll = {
      startedAt: startTime,
      finishedAt: Date.now(),
      durationMs: Date.now() - startTime,
      total: count,
      refreshed: successful,
      failed: failedPacks.length,
      skipped: isCancelled ? count - processed : 0,
      outcome,
    };

    const lines = isCancelled
      ? [
          'Refresh all cancelled.\n',
          `Processed: ${processed}/${count}`,
          `Successful: ${successful}`,
          `Failed: ${failedPacks.length}`,
          `Skipped: ${count - processed}`,
        ]
      : [
          'Refresh all finished.\n',
          `Total: ${count}`,
          `Successful: ${successful}`,
          `Failed: ${failedPacks.length}`,
        ];
    if (failedPacks.length > 0) {
      lines.push('\nFailed packs:');
      let includedCount = 0;
      for (const failed of failedPacks) {
        if (includedCount >= MAX_REPORTED_FAILED_PACKS) {
          break;
        }
        const line = `- ${failed.name}: ${failed.error}`;
        const remainingCount = failedPacks.length - (includedCount + 1);
        const suffix =
          remainingCount > 0 ? `\n...and ${remainingCount} more.` : '';
        const currentTotalLength =
          lines.reduce((sum, l) => sum + l.length + 1, 0) +
          line.length +
          suffix.length;
        if (currentTotalLength > SAFE_REPORT_MAX_LENGTH) {
          break;
        }
        lines.push(line);
        includedCount++;
      }
      if (includedCount < failedPacks.length) {
        const remaining = failedPacks.length - includedCount;
        lines.push(`\n...and ${remaining} more.`);
      }
    }

    await ctx.reply(lines.join('\n'));
    return !isCancelled && failedPacks.length === 0;
  } catch (err) {
    lastRefreshAll = {
      startedAt: startTime,
      finishedAt: Date.now(),
      durationMs: Date.now() - startTime,
      total: refreshAllState?.total ?? 0,
      refreshed: refreshAllState?.successful ?? 0,
      failed: refreshAllState?.failed ?? 1,
      skipped: 0,
      outcome: 'failed',
    };
    throw err;
  } finally {
    refreshAllState = undefined;
  }
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

  const concurrency = parseDownloadConcurrency(process.env.CONCURRENCY);
  const snapshot = await getConverterStatusSnapshot({concurrency});
  const response = formatStatusResponse(snapshot, formatUptime);
  await ctx.reply(response);
  return true;
}

export async function handleGcCommand(ctx: CommandContext): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const parsedRetention = parseGcRetentionArgument(ctx);
  if (!parsedRetention.success) {
    await ctx.reply('Error: retention must be a positive integer (minimum 1).');
    return false;
  }

  const gcStatus = getGarbageCollectionStatus();
  if (gcStatus.running) {
    await ctx.reply('Garbage collection is already running.');
    return false;
  }

  try {
    const result = await runGarbageCollection({
      mode: 'apply',
      retention: parsedRetention.retention,
    });
    let report =
      'Garbage collection finished.\n\n' +
      `Retention: ${result.retention} version${result.retention === 1 ? '' : 's'}\n` +
      `Removed version indexes: ${result.versionsRemoved}\n` +
      `Removed orphaned assets: ${result.assetsRemoved}\n` +
      `Freed: ${formatByteSize(result.bytesFreed)}\n\n` +
      `Remaining CAS assets: ${result.remainingAssets}\n` +
      `Duration: ${formatDurationSeconds(result.durationMs)}`;
    if (result.errors && result.errors > 0) {
      report += `\nErrors: ${result.errors}`;
    }
    await ctx.reply(report);
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'GarbageCollectionRunningError'
    ) {
      await ctx.reply('Garbage collection is already running.');
      return false;
    }
    console.error('GC command failed:', err);
    await ctx.reply('Error: Garbage collection failed.');
    return false;
  }
}

export async function handleGcDryCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const args = extractArgs(ctx);
  if (args && args.length > 0) {
    await ctx.reply('Error: /gc_dry does not accept arguments.');
    return false;
  }

  const gcStatus = getGarbageCollectionStatus();
  if (gcStatus.running) {
    await ctx.reply('Garbage collection is already running.');
    return false;
  }
  try {
    const result = await runGarbageCollection({mode: 'dry-run'});
    let report =
      'Garbage collection dry run.\n\n' +
      `Would remove version indexes: ${result.prunableVersionIndexes}\n` +
      `Would remove orphaned assets: ${result.orphanedAssets}\n` +
      `Would free: ${formatByteSize(result.reclaimableBytes)}\n\n` +
      'No files were deleted.';
    if (result.errors && result.errors > 0) {
      report += `\nErrors: ${result.errors}`;
    }
    await ctx.reply(report);
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'GarbageCollectionRunningError'
    ) {
      await ctx.reply('Garbage collection is already running.');
      return false;
    }
    console.error('GC dry run failed:', err);
    await ctx.reply('Error: Garbage collection dry run failed.');
    return false;
  }
}

export async function handleGcStatsCommand(
  ctx: CommandContext,
): Promise<boolean> {
  if (!isAllowedTelegramUser(ctx.from?.id)) {
    return false;
  }

  const args = extractArgs(ctx);
  if (args && args.length > 0) {
    await ctx.reply('Error: /gc_stats does not accept arguments.');
    return false;
  }

  const gcStatus = getGarbageCollectionStatus();
  if (gcStatus.running) {
    await ctx.reply('Garbage collection is currently running.');
    return false;
  }
  try {
    const result = await runGarbageCollection({mode: 'stats'});
    let report =
      'Storage GC statistics\n\n' +
      `Sticker packs: ${result.stickerPackCount}\n` +
      `Version indexes: ${result.totalVersionIndexes}\n\n` +
      `CAS assets: ${result.totalAssets}\n` +
      `CAS size: ${formatByteSize(result.totalAssetBytes)}\n\n` +
      `Referenced assets: ${result.referencedAssets}\n` +
      `Referenced size: ${formatByteSize(result.referencedAssetBytes)}\n\n` +
      `Orphaned assets: ${result.orphanedAssets}\n` +
      `Orphaned size: ${formatByteSize(result.orphanedAssetBytes)}\n\n` +
      `Prunable version indexes: ${result.prunableVersionIndexes}\n` +
      `Estimated reclaimable: ${formatByteSize(result.reclaimableBytes)}\n\n` +
      `Retention: last ${STICKER_PACK_VERSION_RETENTION} versions`;
    if (result.errors && result.errors > 0) {
      report += `\nErrors: ${result.errors}`;
    }
    await ctx.reply(report);
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'GarbageCollectionRunningError'
    ) {
      await ctx.reply('Garbage collection is currently running.');
      return false;
    }
    console.error('GC stats failed:', err);
    await ctx.reply('Error: Storage GC statistics failed.');
    return false;
  }
}
