import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import {Readable} from 'stream';
import {pipeline} from 'stream/promises';
import {randomUUID} from 'crypto';
import {Telegram} from 'telegraf';
import {StickerPack, Sticker as McSticker} from './mcStickerPack.js';
import {Sticker, StickerSet} from 'telegraf/types';
import {convertWebmToGif} from './webmToGif.js';
import {convertTgsToGif} from './tgsToGif.js';
const DATA_DIR = path.join(path.resolve(process.env.DATA_DIR!), 'telegram');
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const MC_STICKER_PACK_ID_PREFIX = 'MoreStickers:Telegram:Pack';
const MC_STICKER_ID_PREFIX = 'MoreStickers:Telegram:Sticker';
const EXTERNAL_URL = process.env.EXTERNAL_URL!;

function toMcStickerPackId(stickerSetName: string) {
  return `${MC_STICKER_PACK_ID_PREFIX}:${stickerSetName}`;
}

function toMcStickerId(stickerId: string, stickerPackName: string) {
  return `${MC_STICKER_ID_PREFIX}:${stickerPackName}:${stickerId}`;
}

function generateExternalUrl(
  stickerPackName: string,
  stickerId: string,
  fileExtension: string,
) {
  return `${EXTERNAL_URL}/sticker/telegram/${stickerPackName}/${stickerId}.${fileExtension}`;
}

export function generateStickerPackDirPath(stickerSetName: string) {
  return path.join(DATA_DIR, stickerSetName);
}

export function generateStickerPackFilePath(stickerSetName: string) {
  return path.join(DATA_DIR, `${stickerSetName}.telegram.stickerpack`);
}

export interface StickerMediaInfo {
  isVideoSticker: boolean;
  isTgsSticker: boolean;
  outputFileType: string;
  isAnimated: boolean;
}

export function getStickerMediaInfo(
  sticker: Sticker,
  sourceFileType: string,
): StickerMediaInfo {
  const normalizedSourceFileType = sourceFileType.toLowerCase();
  const isVideoSticker =
    Boolean(sticker.is_video) || normalizedSourceFileType === 'webm';
  const isTgsSticker =
    !isVideoSticker &&
    (Boolean(sticker.is_animated) || normalizedSourceFileType === 'tgs');
  const isAnimated = isVideoSticker || isTgsSticker;

  return {
    isVideoSticker,
    isTgsSticker,
    outputFileType: isAnimated ? 'gif' : normalizedSourceFileType,
    isAnimated,
  };
}

export async function fetchStickerWithRetry(
  url: URL | string,
  stickerUniqueId: string,
  attempts = 5,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  let lastError: Error | null = null;
  let lastStatus: number | null = null;
  let lastStatusText = '';

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchFn(url);
      if (response.ok && response.body) {
        return response;
      }

      lastStatus = response.status;
      lastStatusText = response.statusText;
      try {
        await response.body?.cancel();
      } catch {
        // ignore body cancel error
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  const statusInfo =
    lastStatus !== null ? ` (HTTP ${lastStatus} ${lastStatusText})` : '';
  const errorInfo = lastError ? `: ${lastError.message}` : '';
  throw new Error(
    `Failed to download sticker ${stickerUniqueId}${statusInfo}${errorInfo}`,
  );
}

function isLegacySticker(sticker: McSticker): boolean {
  if (!sticker || typeof sticker !== 'object') {
    return false;
  }
  const filename = sticker.filename?.toLowerCase();
  const image = sticker.image?.toLowerCase();

  const hasRawAnimatedSource =
    filename?.endsWith('.webm') ||
    filename?.endsWith('.tgs') ||
    image?.endsWith('.webm') ||
    image?.endsWith('.tgs');

  const hasNonGifAnimatedOutput =
    sticker.isAnimated === true &&
    ((filename !== undefined && !filename.endsWith('.gif')) ||
      (image !== undefined && !image.endsWith('.gif')));

  const hasLegacyAnimatedManifest =
    sticker.isAnimated === true && sticker.readyToUpload !== true;

  return Boolean(
    hasRawAnimatedSource ||
      hasNonGifAnimatedOutput ||
      hasLegacyAnimatedManifest,
  );
}

export async function isLegacyStickerPack(
  stickerSetName: string,
): Promise<boolean> {
  const mcStickerPackPath = generateStickerPackFilePath(stickerSetName);
  try {
    const rawData = await fsp.readFile(mcStickerPackPath, 'utf8');
    const pack = JSON.parse(rawData) as StickerPack;
    if (pack.logo && isLegacySticker(pack.logo)) {
      return true;
    }
    if (Array.isArray(pack.stickers)) {
      return pack.stickers.some(isLegacySticker);
    }
    return false;
  } catch {
    return false;
  }
}

export async function invalidateLegacyStickerPackCache(
  stickerSetName: string,
): Promise<boolean> {
  const isLegacy = await isLegacyStickerPack(stickerSetName);
  if (isLegacy) {
    const dirPath = generateStickerPackDirPath(stickerSetName);
    const filePath = generateStickerPackFilePath(stickerSetName);
    try {
      await fsp.rm(dirPath, {recursive: true, force: true});
    } catch {
      // ignore cleanup error
    }
    try {
      await fsp.rm(filePath, {force: true});
    } catch {
      // ignore cleanup error
    }
    return true;
  }
  return false;
}

async function isStickerPackDownloaded(stickerSetName: string) {
  try {
    const dirPath = generateStickerPackDirPath(stickerSetName);
    const filePath = generateStickerPackFilePath(stickerSetName);
    await fsp.access(dirPath);
    await fsp.access(filePath);

    const wasLegacy = await invalidateLegacyStickerPackCache(stickerSetName);
    if (wasLegacy) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function downloadSingleSticker(
  sticker: Sticker,
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<void> {
  const stickerFile = await telegram.getFile(sticker.file_id);
  const sourceFileType = stickerFile.file_path?.split('.').pop() || '';
  const mediaInfo = getStickerMediaInfo(sticker, sourceFileType);
  const stickerPackDirPath = generateStickerPackDirPath(stickerSet.name);

  const fileLink = await telegram.getFileLink(stickerFile.file_id);
  const response = await fetchStickerWithRetry(
    fileLink,
    sticker.file_unique_id,
  );

  if (mediaInfo.isAnimated) {
    const sourceExtension = mediaInfo.isVideoSticker ? 'webm' : 'tgs';
    const tempSourcePath = path.join(
      stickerPackDirPath,
      `${sticker.file_unique_id}.source.${randomUUID()}.${sourceExtension}`,
    );
    const finalGifPath = path.join(
      stickerPackDirPath,
      `${sticker.file_unique_id}.gif`,
    );

    try {
      await pipeline(
        Readable.fromWeb(response.body!),
        fs.createWriteStream(tempSourcePath),
      );
      if (mediaInfo.isVideoSticker) {
        await convertWebmToGif(tempSourcePath, finalGifPath);
      } else {
        await convertTgsToGif(tempSourcePath, finalGifPath);
      }
    } finally {
      await fsp.unlink(tempSourcePath).catch(() => undefined);
    }
    return;
  }

  const stickerFilePath = path.join(
    stickerPackDirPath,
    `${sticker.file_unique_id}.${mediaInfo.outputFileType}`,
  );
  await pipeline(
    Readable.fromWeb(response.body!),
    fs.createWriteStream(stickerFilePath),
  );
}

async function downloadWorker(
  queue: Sticker[],
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<void> {
  while (queue.length > 0) {
    const sticker = queue.shift();
    if (!sticker) break;
    await downloadSingleSticker(sticker, telegram, stickerSet);
  }
}

async function downloadStickerPack(telegram: Telegram, stickerSet: StickerSet) {
  const stickerSetDir = generateStickerPackDirPath(stickerSet.name);
  await fsp.mkdir(stickerSetDir, {recursive: true});
  const queue = stickerSet.stickers.slice();

  const downloadPromises = Array.from({length: CONCURRENCY}, () =>
    downloadWorker(queue, telegram, stickerSet),
  );
  await Promise.all(downloadPromises);

  const mcStickerPack = await toMcStickerPack(telegram, stickerSet);
  const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
  await fsp.writeFile(mcStickerPackPath, JSON.stringify(mcStickerPack));
}

async function toMcStickerPack(
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<StickerPack> {
  const stickerPs = stickerSet.stickers.map(async sticker => {
    const stickerFile = await telegram.getFile(sticker.file_id);
    const sourceFileType = stickerFile.file_path?.split('.').pop() || '';
    const {outputFileType, isAnimated} = getStickerMediaInfo(
      sticker,
      sourceFileType,
    );

    return {
      id: toMcStickerId(sticker.file_unique_id, stickerSet.name),
      image: generateExternalUrl(
        stickerSet.name,
        sticker.file_unique_id,
        outputFileType,
      ),
      title: sticker.emoji ?? '',
      stickerPackId: toMcStickerPackId(stickerSet.name),
      filename: `${sticker.file_unique_id}.${outputFileType}`,
      isAnimated,
      ...(isAnimated ? {readyToUpload: true} : {}),
    } as McSticker;
  });
  const stickers = await Promise.all(stickerPs);
  return {
    id: toMcStickerPackId(stickerSet.name),
    title: stickerSet.title,
    logo: stickers[0],
    stickers,
  } as StickerPack;
}

export {
  isStickerPackDownloaded,
  downloadStickerPack,
  toMcStickerPack,
  DATA_DIR,
};
