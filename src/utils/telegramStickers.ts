import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import {Readable} from 'stream';
import {pipeline} from 'stream/promises';
import {randomUUID} from 'crypto';
import {Telegram} from 'telegraf';
import {
  StickerPack,
  Sticker as McSticker,
  StickerPackDynamic,
} from './mcStickerPack.js';
import {Sticker, StickerSet} from 'telegraf/types';
import {convertWebmToGif} from './webmToGif.js';
import {convertTgsToGif} from './tgsToGif.js';
import {generatePreview} from './stickerPreview.js';
const DATA_DIR = path.join(path.resolve(process.env.DATA_DIR!), 'telegram');

export function parseDownloadConcurrency(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue === '') {
    return 5;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('CONCURRENCY must be a positive integer');
  }
  return parsed;
}

const CONCURRENCY = parseDownloadConcurrency(process.env.CONCURRENCY);
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
function generatePreviewExternalUrl(
  stickerPackName: string,
  stickerId: string,
) {
  return `${EXTERNAL_URL}/preview/telegram/${stickerPackName}/${stickerId}.webp`;
}

export function generateStickerPackExternalUrl(
  stickerPackName: string,
): string {
  return `${EXTERNAL_URL}/stickerpack/telegram/${encodeURIComponent(stickerPackName)}`;
}

export function getStickerContentSignature(stickers: McSticker[]): string {
  // Canonical content signature: id embeds file_unique_id, title carries
  // emoji. Order is preserved on purpose - reordering is a real change.
  return JSON.stringify(stickers.map(sticker => [sticker.id, sticker.title]));
}

export function getTelegramStickerContentSignature(
  stickerSetName: string,
  telegramStickers: Sticker[],
): string {
  return JSON.stringify(
    telegramStickers.map(sticker => [
      toMcStickerId(sticker.file_unique_id, stickerSetName),
      sticker.emoji || '',
    ]),
  );
}

export function validateLocalStickerPackManifest(
  value: unknown,
): StickerPack | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const pack = value as Partial<StickerPack>;
  if (typeof pack.id !== 'string' || pack.id.trim().length === 0) {
    return null;
  }
  if (!Array.isArray(pack.stickers)) {
    return null;
  }
  for (const item of pack.stickers) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }
    const sticker = item as Partial<McSticker>;
    if (typeof sticker.id !== 'string' || sticker.id.trim().length === 0) {
      return null;
    }
    if (typeof sticker.title !== 'string') {
      return null;
    }
    if (
      sticker.isAnimated !== undefined &&
      typeof sticker.isAnimated !== 'boolean'
    ) {
      return null;
    }
    if (
      sticker.readyToUpload !== undefined &&
      typeof sticker.readyToUpload !== 'boolean'
    ) {
      return null;
    }
    if (
      sticker.filename !== undefined &&
      typeof sticker.filename !== 'string'
    ) {
      return null;
    }
    if (sticker.image !== undefined && typeof sticker.image !== 'string') {
      return null;
    }
    if (
      sticker.previewImage !== undefined &&
      typeof sticker.previewImage !== 'string'
    ) {
      return null;
    }
    if (
      sticker.stickerPackId !== undefined &&
      typeof sticker.stickerPackId !== 'string'
    ) {
      return null;
    }
  }
  if (pack.dynamic !== undefined) {
    if (
      typeof pack.dynamic !== 'object' ||
      pack.dynamic === null ||
      Array.isArray(pack.dynamic)
    ) {
      return null;
    }
    const dynamic = pack.dynamic as Partial<StickerPackDynamic>;
    if (
      dynamic.version !== undefined &&
      !isValidDynamicVersion(dynamic.version)
    ) {
      return null;
    }
    if (
      dynamic.refreshUrl !== undefined &&
      typeof dynamic.refreshUrl !== 'string'
    ) {
      return null;
    }
  }
  return value as StickerPack;
}

function isValidDynamicVersion(version: unknown): version is number {
  return (
    typeof version === 'number' && Number.isSafeInteger(version) && version >= 1
  );
}

function isStickerSignatureEntry(
  value: unknown,
): value is Pick<McSticker, 'id' | 'title'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as {id?: unknown}).id === 'string' &&
    typeof (value as {title?: unknown}).title === 'string'
  );
}

export function resolveStickerPackVersion(
  previousPack: unknown,
  nextStickers: McSticker[],
): number {
  if (previousPack === undefined) {
    // Manifest does not exist on disk.
    return 1;
  }

  if (
    previousPack === null ||
    typeof previousPack !== 'object' ||
    Array.isArray(previousPack)
  ) {
    throw new Error(
      'Existing manifest has invalid root structure; refusing to guess version',
    );
  }

  const stickers = (previousPack as {stickers?: unknown}).stickers;
  if (!Array.isArray(stickers) || stickers.length === 0) {
    throw new Error(
      'Versioned manifest lacks a readable stickers[] list; refusing to overwrite with a guessed version',
    );
  }
  for (const sticker of stickers) {
    if (!isStickerSignatureEntry(sticker)) {
      throw new Error(
        'Versioned manifest contains unreadable sticker entries; refusing to guess version',
      );
    }
  }

  const dynamic = (previousPack as {dynamic?: unknown}).dynamic;
  if (
    dynamic === undefined ||
    (typeof dynamic === 'object' &&
      dynamic !== null &&
      !Array.isArray(dynamic) &&
      (dynamic as {version?: unknown}).version === undefined)
  ) {
    // Legacy manifest without dynamic.version migrates to version 1.
    return 1;
  }
  if (
    typeof dynamic !== 'object' ||
    dynamic === null ||
    Array.isArray(dynamic)
  ) {
    throw new Error(
      'Existing manifest has invalid dynamic field; refusing to guess version',
    );
  }

  const {version} = dynamic as {version?: unknown};
  if (!isValidDynamicVersion(version)) {
    throw new Error(
      `Existing manifest declares invalid dynamic.version (${String(version)}); refusing to reset it`,
    );
  }

  const previousSignature = getStickerContentSignature(stickers as McSticker[]);
  const nextSignature = getStickerContentSignature(nextStickers);
  if (previousSignature === nextSignature) {
    return version;
  }

  if (version === Number.MAX_SAFE_INTEGER) {
    throw new Error('Sticker pack version overflow');
  }
  return version + 1;
}

export function generateStickerPreviewDirPath(stickerSetName: string) {
  return path.join(generateStickerPackDirPath(stickerSetName), 'previews');
}

export function generateStickerPreviewFilePath(
  stickerSetName: string,
  stickerId: string,
) {
  return path.join(
    generateStickerPreviewDirPath(stickerSetName),
    `${stickerId}.webp`,
  );
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
      const previewPath = generateStickerPreviewFilePath(
        stickerSet.name,
        sticker.file_unique_id,
      );
      await generatePreview(finalGifPath, previewPath);
    } finally {
      await fsp.unlink(tempSourcePath).catch(() => undefined);
    }
    return;
  }

  const stickerFilePath = path.join(
    stickerPackDirPath,
    `${sticker.file_unique_id}.${mediaInfo.outputFileType}`,
  );
  const tempDownloadPath = path.join(
    stickerPackDirPath,
    `${sticker.file_unique_id}.download-${randomUUID()}.${mediaInfo.outputFileType}`,
  );

  try {
    await pipeline(
      Readable.fromWeb(response.body!),
      fs.createWriteStream(tempDownloadPath),
    );
    await fsp.rename(tempDownloadPath, stickerFilePath);
    const previewPath = generateStickerPreviewFilePath(
      stickerSet.name,
      sticker.file_unique_id,
    );
    await generatePreview(stickerFilePath, previewPath);
  } finally {
    await fsp.unlink(tempDownloadPath).catch(() => undefined);
  }
}

interface DownloadState {
  error?: unknown;
}

async function downloadWorker(
  queue: Sticker[],
  telegram: Telegram,
  stickerSet: StickerSet,
  state: DownloadState,
): Promise<void> {
  while (queue.length > 0) {
    if (state.error !== undefined) {
      return;
    }
    const sticker = queue.shift();
    if (!sticker) break;
    try {
      await downloadSingleSticker(sticker, telegram, stickerSet);
    } catch (err) {
      if (state.error === undefined) {
        state.error = err;
      }
      return;
    }
  }
}

async function downloadStickerPack(telegram: Telegram, stickerSet: StickerSet) {
  const stickerSetDir = generateStickerPackDirPath(stickerSet.name);
  await fsp.mkdir(stickerSetDir, {recursive: true});
  const previewDir = generateStickerPreviewDirPath(stickerSet.name);
  await fsp.mkdir(previewDir, {recursive: true});
  const queue = stickerSet.stickers.slice();
  const state: DownloadState = {};

  const downloadPromises = Array.from({length: CONCURRENCY}, () =>
    downloadWorker(queue, telegram, stickerSet, state),
  );
  await Promise.all(downloadPromises);

  if (state.error !== undefined) {
    throw state.error;
  }

  await publishStickerPackManifest(telegram, stickerSet);
}

// Per-pack FIFO ensuring the read-previous-manifest -> compute-version ->
// atomic-write cycle never interleaves between concurrent generations of
// the same pack. Different packs remain independent.
const manifestWriteQueues = new Map<string, Promise<unknown>>();

export function enqueueManifestPublish(
  stickerSetName: string,
  job: () => Promise<void>,
): Promise<void> {
  const previousRun =
    manifestWriteQueues.get(stickerSetName) ?? Promise.resolve();
  const run = previousRun.then(job);
  const trackedRun = run
    .catch(() => undefined)
    .finally(() => {
      if (manifestWriteQueues.get(stickerSetName) === trackedRun) {
        manifestWriteQueues.delete(stickerSetName);
      }
    });
  manifestWriteQueues.set(stickerSetName, trackedRun);
  return run;
}

// Per-pack operation queue ensuring high-level mutating operations (/pack, /refresh)
// on the same pack run serially without interleaving, while operations on different packs
// execute concurrently.
const stickerPackOperationQueues = new Map<string, Promise<unknown>>();

export function enqueueStickerPackOperation<T>(
  packName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const normalizedKey = packName.toLowerCase();
  const previousRun =
    stickerPackOperationQueues.get(normalizedKey) ?? Promise.resolve();
  const run = previousRun.then(operation);
  const trackedRun = run
    .catch(() => undefined)
    .finally(() => {
      if (stickerPackOperationQueues.get(normalizedKey) === trackedRun) {
        stickerPackOperationQueues.delete(normalizedKey);
      }
    });
  stickerPackOperationQueues.set(normalizedKey, trackedRun);
  return run;
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
      previewImage: generatePreviewExternalUrl(
        stickerSet.name,
        sticker.file_unique_id,
      ),
      title: sticker.emoji ?? '',
      stickerPackId: toMcStickerPackId(stickerSet.name),
      filename: `${sticker.file_unique_id}.${outputFileType}`,
      isAnimated,
      ...(isAnimated ? {readyToUpload: true} : {}),
    } as McSticker;
  });
  const stickers = await Promise.all(stickerPs);
  const previous = await readManifestOrUndefined(stickerSet.name);
  return {
    id: toMcStickerPackId(stickerSet.name),
    title: stickerSet.title,
    logo: stickers[0],
    stickers,
    dynamic: buildStickerPackDynamic(stickerSet.name, previous, stickers),
  } as StickerPack;
}

function buildStickerPackDynamic(
  stickerSetName: string,
  previousPack: unknown,
  stickers: McSticker[],
): StickerPackDynamic {
  return {
    version: resolveStickerPackVersion(previousPack, stickers),
    refreshUrl: generateStickerPackExternalUrl(stickerSetName),
  };
}

function getErrorCode(err: unknown): string | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as {code?: unknown}).code === 'string'
  ) {
    return (err as {code: string}).code;
  }
  return undefined;
}

export async function readManifestOrUndefined(
  stickerSetName: string,
): Promise<unknown> {
  const manifestPath = generateStickerPackFilePath(stickerSetName);
  let rawData: string;
  try {
    rawData = await fsp.readFile(manifestPath, 'utf8');
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return undefined;
    }
    throw err;
  }

  try {
    return JSON.parse(rawData);
  } catch {
    throw new Error(
      `Existing manifest for "${stickerSetName}" contains malformed JSON; refusing to reset sticker pack version`,
    );
  }
}

async function publishStickerPackManifest(
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<void> {
  await enqueueManifestPublish(stickerSet.name, async () => {
    // Rebuild inside the per-pack job: version resolution reads the latest
    // on-disk manifest serialized against any other generation of this pack.
    const pack = await toMcStickerPack(telegram, stickerSet);
    await writeStickerPackManifestAtomically(
      generateStickerPackFilePath(stickerSet.name),
      pack,
    );
  });
}

export async function writeStickerPackManifestAtomically(
  manifestPath: string,
  pack: StickerPack,
): Promise<void> {
  const tempPath = `${manifestPath}.${randomUUID()}.tmp`;
  await fsp.mkdir(path.dirname(manifestPath), {recursive: true});
  try {
    await fsp.writeFile(tempPath, JSON.stringify(pack), 'utf8');
    await fsp.rename(tempPath, manifestPath);
  } finally {
    await fsp.unlink(tempPath).catch(() => undefined);
  }
}

export {
  isStickerPackDownloaded,
  downloadStickerPack,
  toMcStickerPack,
  DATA_DIR,
};
