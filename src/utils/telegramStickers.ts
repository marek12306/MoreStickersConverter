import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import {Readable, Transform} from 'stream';
import {pipeline} from 'stream/promises';
import {randomUUID} from 'crypto';
import {Telegram} from 'telegraf';
import {
  StickerPack,
  Sticker as McSticker,
  StickerPackDynamic,
} from './mcStickerPack.js';
import {Sticker, StickerSet} from 'telegraf/types';
import {convertWebmToAvif} from './webmToAvif.js';
import {convertTgsToAvif} from './tgsToAvif.js';
import {generatePreview} from './stickerPreview.js';
import {
  DATA_DIR,
  garbageCollectStickerAssets,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
  generateStickerVersionIndexPath,
  listStickerPackVersions,
  pruneOldStickerVersions,
  readStickerVersionIndex,
  scheduleStickerAssetGarbageCollection,
  type StickerVersionIndex,
  storeStickerAsset,
  withStickerStorageMutation,
  verifyStoredStickerAsset,
  writeStickerVersionIndexAtomically,
} from './stickerAssetStorage.js';

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
const TELEGRAM_TGS_MAX_BYTES = 64 * 1024;

function createByteLimitTransform(maxBytes: number, label: string): Transform {
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        callback(new Error(`${label} exceeds ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
}

function toMcStickerPackId(stickerSetName: string) {
  return `${MC_STICKER_PACK_ID_PREFIX}:${stickerSetName}`;
}

function toMcStickerId(stickerId: string, stickerPackName: string) {
  return `${MC_STICKER_ID_PREFIX}:${stickerPackName}:${stickerId}`;
}

function assertSafeStorageSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Unsafe ${label} for sticker storage`);
  }
}

function generateExternalUrl(
  stickerPackName: string,
  version: number,
  stickerId: string,
  fileExtension: string,
) {
  return `${EXTERNAL_URL}/sticker/telegram/${stickerPackName}/${version}/${stickerId}.${fileExtension}`;
}
function generatePreviewExternalUrl(
  stickerPackName: string,
  version: number,
  stickerId: string,
) {
  return `${EXTERNAL_URL}/preview/telegram/${stickerPackName}/${version}/${stickerId}.webp`;
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
  nextPackTitle: string,
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

  const previousTitle = (previousPack as {title?: unknown}).title;
  const previousSignature = getStickerContentSignature(stickers as McSticker[]);
  const nextSignature = getStickerContentSignature(nextStickers);
  if (previousTitle === nextPackTitle && previousSignature === nextSignature) {
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
    outputFileType: isAnimated ? 'avif' : normalizedSourceFileType,
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

  const hasUnsupportedAnimatedOutput =
    sticker.isAnimated === true &&
    ((filename !== undefined &&
      !filename.endsWith('.gif') &&
      !filename.endsWith('.avif')) ||
      (image !== undefined &&
        !image.endsWith('.gif') &&
        !image.endsWith('.avif')));

  const hasLegacyAnimatedManifest =
    sticker.isAnimated === true && sticker.readyToUpload !== true;
  return Boolean(
    hasRawAnimatedSource ||
      hasUnsupportedAnimatedOutput ||
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
  return await isLegacyStickerPack(stickerSetName);
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
    const manifest = validateLocalStickerPackManifest(
      await readManifestOrUndefined(stickerSetName),
    );
    if (!manifest) {
      return false;
    }
    if (manifest.dynamic?.version !== undefined) {
      const index = await readStickerVersionIndex(
        stickerSetName,
        manifest.dynamic.version,
      );
      if (!index) {
        return false;
      }
      await assertStoredVersionComplete(stickerSetName, manifest, index);
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
  assertSafeStorageSegment(stickerSet.name, 'sticker pack name');
  assertSafeStorageSegment(sticker.file_unique_id, 'sticker unique id');
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
    const rawSourcePath = path.join(
      stickerPackDirPath,
      `${sticker.file_unique_id}.${sourceExtension}`,
    );
    const rawSourceBackupPath = `${rawSourcePath}.backup-${randomUUID()}`;
    const finalAvifPath = path.join(
      stickerPackDirPath,
      `${sticker.file_unique_id}.avif`,
    );

    try {
      if (mediaInfo.isTgsSticker) {
        await pipeline(
          Readable.fromWeb(response.body!),
          createByteLimitTransform(
            TELEGRAM_TGS_MAX_BYTES,
            `TGS sticker ${sticker.file_unique_id}`,
          ),
          fs.createWriteStream(tempSourcePath),
        );
      } else {
        await pipeline(
          Readable.fromWeb(response.body!),
          fs.createWriteStream(tempSourcePath),
        );
      }
      let previousRawMoved = false;
      try {
        await fsp.rename(rawSourcePath, rawSourceBackupPath);
        previousRawMoved = true;
      } catch (err) {
        if (getErrorCode(err) !== 'ENOENT') throw err;
      }
      try {
        await fsp.rename(tempSourcePath, rawSourcePath);
      } catch (err) {
        if (previousRawMoved) {
          await fsp.rename(rawSourceBackupPath, rawSourcePath);
        }
        throw err;
      }
      if (mediaInfo.isVideoSticker) {
        await convertWebmToAvif(rawSourcePath, finalAvifPath);
      } else {
        await convertTgsToAvif(rawSourcePath, finalAvifPath);
      }
      const previewPath = generateStickerPreviewFilePath(
        stickerSet.name,
        sticker.file_unique_id,
      );
      await generatePreview(finalAvifPath, previewPath);
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

const RAW_SOURCE_BACKUP_PATTERN =
  /^([a-zA-Z0-9_-]+\.(?:webm|tgs))\.backup-[a-f0-9-]+$/;

async function listRawSourceBackups(stickerSetName: string): Promise<string[]> {
  const entries = await fsp.readdir(generateStickerPackDirPath(stickerSetName));
  return entries.filter(entry => RAW_SOURCE_BACKUP_PATTERN.test(entry));
}

async function restoreRawSourceBackups(stickerSetName: string): Promise<void> {
  const packDir = generateStickerPackDirPath(stickerSetName);
  for (const backupFilename of await listRawSourceBackups(stickerSetName)) {
    const match = RAW_SOURCE_BACKUP_PATTERN.exec(backupFilename);
    if (!match) continue;
    const canonicalPath = path.join(packDir, match[1]);
    await fsp.rm(canonicalPath, {force: true});
    await fsp.rename(path.join(packDir, backupFilename), canonicalPath);
  }
}

async function removeRawSourceBackups(stickerSetName: string): Promise<void> {
  const packDir = generateStickerPackDirPath(stickerSetName);
  await Promise.all(
    (await listRawSourceBackups(stickerSetName)).map(filename =>
      fsp.unlink(path.join(packDir, filename)).catch(() => undefined),
    ),
  );
}

async function restoreRawSourcesAfterFailure(
  stickerSetName: string,
  primaryError: unknown,
): Promise<never> {
  try {
    await restoreRawSourceBackups(stickerSetName);
  } catch (restoreError) {
    throw new AggregateError(
      [primaryError, restoreError],
      `Sticker pack "${stickerSetName}" failed and raw source restoration also failed`,
    );
  }
  throw primaryError;
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
  assertSafeStorageSegment(stickerSet.name, 'sticker pack name');
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
    await restoreRawSourcesAfterFailure(stickerSet.name, state.error);
  }

  try {
    await publishStickerPackManifest(telegram, stickerSet);
  } catch (err) {
    await restoreRawSourcesAfterFailure(stickerSet.name, err);
  }
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
  forcedVersion?: number,
): Promise<StickerPack> {
  assertSafeStorageSegment(stickerSet.name, 'sticker pack name');
  const stickerPs = stickerSet.stickers.map(async sticker => {
    assertSafeStorageSegment(sticker.file_unique_id, 'sticker unique id');
    const stickerFile = await telegram.getFile(sticker.file_id);
    const sourceFileType = stickerFile.file_path?.split('.').pop() || '';
    const {outputFileType, isAnimated} = getStickerMediaInfo(
      sticker,
      sourceFileType,
    );
    return {
      id: toMcStickerId(sticker.file_unique_id, stickerSet.name),
      image: '',
      previewImage: '',
      title: sticker.emoji ?? '',
      stickerPackId: toMcStickerPackId(stickerSet.name),
      filename: `${sticker.file_unique_id}.${outputFileType}`,
      isAnimated,
      ...(isAnimated ? {readyToUpload: true} : {}),
    } as McSticker;
  });
  const stickers = await Promise.all(stickerPs);
  const previous =
    forcedVersion === undefined
      ? await readManifestOrUndefined(stickerSet.name)
      : undefined;
  const version =
    forcedVersion ??
    resolveStickerPackVersion(previous, stickers, stickerSet.title);
  const pack = {
    id: toMcStickerPackId(stickerSet.name),
    title: stickerSet.title,
    logo: stickers[0],
    stickers,
    dynamic: buildStickerPackDynamic(stickerSet.name, version),
  } as StickerPack;
  setStickerPackVersionUrls(stickerSet.name, pack, version);
  return pack;
}
function buildStickerPackDynamic(
  stickerSetName: string,
  version: number,
): StickerPackDynamic {
  return {
    version,
    refreshUrl: generateStickerPackExternalUrl(stickerSetName),
  };
}
function setStickerPackVersionUrls(
  stickerSetName: string,
  pack: StickerPack,
  version: number,
): void {
  for (const sticker of pack.stickers) {
    const filename = sticker.filename;
    const stickerId = sticker.id.split(':').pop();
    if (!filename || !stickerId) {
      throw new Error('Cannot version sticker with missing filename or id');
    }
    const extension = path.extname(filename).slice(1);
    sticker.image = generateExternalUrl(
      stickerSetName,
      version,
      path.basename(filename, path.extname(filename)),
      extension,
    );
    sticker.previewImage = generatePreviewExternalUrl(
      stickerSetName,
      version,
      stickerId,
    );
  }
  pack.logo = pack.stickers[0];
  pack.dynamic = buildStickerPackDynamic(stickerSetName, version);
}
async function storePackVersionAssets(
  stickerSetName: string,
  pack: StickerPack,
): Promise<Omit<StickerVersionIndex, 'version'>> {
  const stickers: Record<string, string> = {};
  const previews: Record<string, string> = {};
  const signatureEntries: unknown[] = [];
  for (const sticker of pack.stickers) {
    const filename = sticker.filename;
    const stickerId = sticker.id.split(':').pop();
    if (!filename || !stickerId) {
      throw new Error('Cannot store sticker with missing filename or id');
    }
    const stickerAsset = await storeStickerAsset(
      stickerSetName,
      path.join(generateStickerPackDirPath(stickerSetName), filename),
    );
    const previewFilename = `${stickerId}.webp`;
    const previewAsset = await storeStickerAsset(
      stickerSetName,
      generateStickerPreviewFilePath(stickerSetName, stickerId),
    );
    stickers[filename] = stickerAsset;
    previews[previewFilename] = previewAsset;
    signatureEntries.push([
      sticker.id,
      sticker.title,
      filename,
      sticker.isAnimated === true,
      sticker.readyToUpload === true,
      stickerAsset,
      previewAsset,
    ]);
  }
  return {
    signature: JSON.stringify(signatureEntries),
    stickers,
    previews,
  };
}
function hasSameAssetMap(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([filename, asset]) => right[filename] === asset)
  );
}

function hasSameStoredVersion(
  index: StickerVersionIndex,
  stored: Omit<StickerVersionIndex, 'version'>,
): boolean {
  return (
    index.signature === stored.signature &&
    hasSameAssetMap(index.stickers, stored.stickers) &&
    hasSameAssetMap(index.previews, stored.previews)
  );
}
async function removePublishedWorkingFiles(
  stickerSetName: string,
  pack: StickerPack,
): Promise<void> {
  await Promise.all(
    pack.stickers.flatMap(sticker => {
      const stickerId = sticker.id.split(':').pop();
      return [
        sticker.filename
          ? fsp
              .unlink(
                path.join(
                  generateStickerPackDirPath(stickerSetName),
                  sticker.filename,
                ),
              )
              .catch(() => undefined)
          : Promise.resolve(),
        stickerId
          ? fsp
              .unlink(generateStickerPreviewFilePath(stickerSetName, stickerId))
              .catch(() => undefined)
          : Promise.resolve(),
        ...(stickerId
          ? ['webm', 'tgs'].map(extension =>
              fsp
                .unlink(
                  path.join(
                    generateStickerPackDirPath(stickerSetName),
                    `${stickerId}.${extension}`,
                  ),
                )
                .catch(() => undefined),
            )
          : []),
      ];
    }),
  );
  await removeRawSourceBackups(stickerSetName);
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

function getStoredManifestVersion(manifest: unknown): number {
  if (manifest === undefined) {
    return 0;
  }
  const pack = validateLocalStickerPackManifest(manifest);
  if (!pack) {
    throw new Error('Existing sticker pack manifest is invalid');
  }
  return pack.dynamic?.version ?? 0;
}

async function removeUnpublishedStickerVersionIndexes(
  stickerSetName: string,
  currentVersion: number,
  versions: number[],
  preservedPendingVersion?: number,
): Promise<void> {
  await Promise.all(
    versions
      .filter(
        version =>
          version > currentVersion && version !== preservedPendingVersion,
      )
      .map(version =>
        fsp.rm(generateStickerVersionIndexPath(stickerSetName, version), {
          force: true,
        }),
      ),
  );
}

async function publishStickerPackManifest(
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<void> {
  await enqueueManifestPublish(stickerSet.name, async () => {
    const pack = await toMcStickerPack(telegram, stickerSet, 1);
    await withStickerStorageMutation(stickerSet.name, async () => {
      const previous = await readManifestOrUndefined(stickerSet.name);
      const currentVersion = getStoredManifestVersion(previous);
      const previousPack = validateLocalStickerPackManifest(previous);
      const stored = await storePackVersionAssets(stickerSet.name, pack);
      const currentIndex =
        currentVersion > 0
          ? await readStickerVersionIndex(stickerSet.name, currentVersion)
          : undefined;
      const versions = await listStickerPackVersions(stickerSet.name);
      const unchanged =
        currentIndex !== undefined &&
        previousPack?.title === stickerSet.title &&
        hasSameStoredVersion(currentIndex, stored);
      let version: number;
      if (unchanged) {
        version = currentVersion;
        await removeUnpublishedStickerVersionIndexes(
          stickerSet.name,
          currentVersion,
          versions,
        );
      } else {
        const nextVersion = currentVersion + 1;
        if (!Number.isSafeInteger(nextVersion)) {
          throw new Error('Sticker pack version overflow');
        }
        let pendingIndex: StickerVersionIndex | undefined;
        if (versions.includes(nextVersion)) {
          try {
            pendingIndex = await readStickerVersionIndex(
              stickerSet.name,
              nextVersion,
            );
          } catch {
            pendingIndex = undefined;
          }
        }
        const resumesInterruptedPublish =
          pendingIndex !== undefined &&
          hasSameStoredVersion(pendingIndex, stored);
        await removeUnpublishedStickerVersionIndexes(
          stickerSet.name,
          currentVersion,
          versions,
          resumesInterruptedPublish ? nextVersion : undefined,
        );
        version = nextVersion;
        if (!resumesInterruptedPublish) {
          await writeStickerVersionIndexAtomically(stickerSet.name, {
            version,
            ...stored,
          });
        }
      }
      setStickerPackVersionUrls(stickerSet.name, pack, version);
      await writeStickerPackManifestAtomically(
        generateStickerPackFilePath(stickerSet.name),
        pack,
      );
      await pruneOldStickerVersions(stickerSet.name);
      await removePublishedWorkingFiles(stickerSet.name, pack);
    });
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

export function getCanonicalStickerFilename(sticker: McSticker): string {
  const stickerId = sticker.id.split(':').pop();
  const filename = sticker.filename;
  const extension = path.extname(filename ?? '').toLowerCase();
  if (
    !stickerId ||
    !/^[a-zA-Z0-9_-]+$/.test(stickerId) ||
    !filename ||
    path.basename(filename) !== filename ||
    filename.includes('..') ||
    !/^[a-zA-Z0-9_-]+\.(?:avif|gif|webp)$/i.test(filename) ||
    (extension !== '.avif' && extension !== '.gif' && extension !== '.webp')
  ) {
    throw new Error('Legacy sticker has no safe final filename');
  }
  return `${stickerId}${extension}`;
}

async function removeIndexedWorkingFiles(
  stickerSetName: string,
  index: StickerVersionIndex,
  legacyStickerFilenames: Iterable<string> = [],
): Promise<void> {
  await Promise.all([
    ...[
      ...new Set([...Object.keys(index.stickers), ...legacyStickerFilenames]),
    ].map(filename =>
      fsp
        .unlink(path.join(generateStickerPackDirPath(stickerSetName), filename))
        .catch(() => undefined),
    ),
    ...Object.keys(index.previews).map(filename =>
      fsp
        .unlink(
          path.join(generateStickerPreviewDirPath(stickerSetName), filename),
        )
        .catch(() => undefined),
    ),
  ]);
}

async function assertStoredVersionComplete(
  stickerSetName: string,
  pack: StickerPack,
  index: StickerVersionIndex,
): Promise<void> {
  for (const sticker of pack.stickers) {
    const stickerId = sticker.id.split(':').pop();
    const stickerAsset = sticker.filename
      ? index.stickers[sticker.filename]
      : undefined;
    const previewAsset = stickerId
      ? index.previews[`${stickerId}.webp`]
      : undefined;
    if (!stickerAsset || !previewAsset) {
      throw new Error(
        'Version index does not contain every sticker and preview',
      );
    }
    const [stickerExists, previewExists] = await Promise.all([
      verifyStoredStickerAsset(stickerSetName, stickerAsset),
      verifyStoredStickerAsset(stickerSetName, previewAsset),
    ]);
    if (!stickerExists || !previewExists) {
      throw new Error('Version index references a missing or corrupt asset');
    }
  }
}

function setVersionAssetMapping(
  mapping: Record<string, string>,
  filename: string,
  assetFilename: string,
): void {
  const existing = mapping[filename];
  if (existing && existing !== assetFilename) {
    throw new Error(`Conflicting legacy asset mapping for "${filename}"`);
  }
  mapping[filename] = assetFilename;
}

interface LegacyMigrationInputs {
  stickerSourcePaths?: ReadonlyMap<string, string>;
  previewSourcePaths?: ReadonlyMap<string, string>;
  sourceFilenames?: ReadonlySet<string>;
}

interface PreparedLegacyAnimatedPack {
  pack: StickerPack;
  inputs: LegacyMigrationInputs;
  temporaryPaths: Set<string>;
}

function getLegacyAnimatedSourceExtension(
  filename: string | undefined,
): 'webm' | 'tgs' | undefined {
  const extension = path
    .extname(filename ?? '')
    .slice(1)
    .toLowerCase();
  return extension === 'webm' || extension === 'tgs' ? extension : undefined;
}
function hasLegacyAnimatedReference(sticker: McSticker): boolean {
  const image = sticker.image?.toLowerCase();
  return Boolean(
    getLegacyAnimatedSourceExtension(sticker.filename) ||
      image?.endsWith('.webm') ||
      image?.endsWith('.tgs'),
  );
}

async function removeTemporaryMigrationPaths(
  temporaryPaths: Iterable<string>,
): Promise<void> {
  await Promise.all(
    [...temporaryPaths].map(file =>
      fsp.rm(file, {force: true}).catch(() => undefined),
    ),
  );
}

async function ensureLegacyPreviewSourcePath(
  stickerSetName: string,
  stickerId: string,
  stickerSourcePath: string,
  providedPreviewPath: string | undefined,
): Promise<string> {
  if (providedPreviewPath) {
    return providedPreviewPath;
  }

  const previewPath = generateStickerPreviewFilePath(stickerSetName, stickerId);
  try {
    await fsp.access(previewPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
    if (path.extname(stickerSourcePath).toLowerCase() !== '.webp') {
      return previewPath;
    }
    await fsp.mkdir(path.dirname(previewPath), {recursive: true});
    await generatePreview(stickerSourcePath, previewPath);
  }
  return previewPath;
}

async function prepareLegacyAnimatedPack(
  stickerSetName: string,
  pack: StickerPack,
): Promise<PreparedLegacyAnimatedPack | undefined> {
  if (!pack.stickers.some(hasLegacyAnimatedReference)) {
    return undefined;
  }

  const migratedPack: StickerPack = {
    ...pack,
    logo: {...pack.logo},
    stickers: pack.stickers.map(sticker => ({...sticker})),
    ...(pack.dynamic ? {dynamic: {...pack.dynamic}} : {}),
  };
  const stickerSourcePaths = new Map<string, string>();
  const previewSourcePaths = new Map<string, string>();
  const sourceFilenames = new Set<string>();
  const temporaryPaths = new Set<string>();
  const packDir = generateStickerPackDirPath(stickerSetName);
  await fsp.mkdir(generateStickerPreviewDirPath(stickerSetName), {
    recursive: true,
  });

  try {
    for (const sticker of migratedPack.stickers) {
      const sourceExtension = getLegacyAnimatedSourceExtension(
        sticker.filename,
      );
      if (!sourceExtension && hasLegacyAnimatedReference(sticker)) {
        throw new Error(
          'Legacy animated sticker reference has no matching source filename',
        );
      }
      if (!sourceExtension) {
        continue;
      }
      const sourceFilename = sticker.filename!;
      const stickerId = sticker.id.split(':').pop();
      if (
        !stickerId ||
        !/^[a-zA-Z0-9_-]+$/.test(stickerId) ||
        path.basename(sourceFilename) !== sourceFilename ||
        !/^[a-zA-Z0-9_-]+\.(?:webm|tgs)$/i.test(sourceFilename)
      ) {
        throw new Error('Legacy animated sticker has no safe source filename');
      }

      const migrationId = randomUUID();
      const sourcePath = path.join(packDir, sourceFilename);
      const avifPath = path.join(
        packDir,
        `.${stickerId}.legacy-${migrationId}.avif`,
      );
      const previewPath = path.join(
        generateStickerPreviewDirPath(stickerSetName),
        `.${stickerId}.legacy-${migrationId}.webp`,
      );
      temporaryPaths.add(avifPath);
      temporaryPaths.add(previewPath);
      if (sourceExtension === 'webm') {
        await convertWebmToAvif(sourcePath, avifPath);
      } else {
        await convertTgsToAvif(sourcePath, avifPath);
      }
      await generatePreview(avifPath, previewPath);

      sticker.filename = `${stickerId}.avif`;
      sticker.isAnimated = true;
      sticker.readyToUpload = true;
      stickerSourcePaths.set(sticker.id, avifPath);
      previewSourcePaths.set(sticker.id, previewPath);
      sourceFilenames.add(sourceFilename);
    }
  } catch (err) {
    await removeTemporaryMigrationPaths(temporaryPaths);
    throw err;
  }

  return {
    pack: migratedPack,
    inputs: {stickerSourcePaths, previewSourcePaths, sourceFilenames},
    temporaryPaths,
  };
}

async function migrateLegacyStickerPackUnlocked(
  stickerSetName: string,
  pack: StickerPack,
  inputs: LegacyMigrationInputs = {},
): Promise<boolean> {
  const version = pack.dynamic?.version ?? 1;
  const existingIndex = await readStickerVersionIndex(stickerSetName, version);
  const originalFilenames = new Map<string, string>();
  for (const sticker of pack.stickers) {
    if (!sticker.filename) {
      throw new Error('Legacy sticker manifest is missing filename');
    }
    originalFilenames.set(sticker.id, sticker.filename);
    sticker.filename = getCanonicalStickerFilename(sticker);
  }

  const expectedVersionPath = `/${stickerSetName}/${version}/`;
  const alreadyMigrated =
    existingIndex !== undefined &&
    pack.stickers.every(sticker => sticker.image.includes(expectedVersionPath));
  if (existingIndex) {
    await assertStoredVersionComplete(stickerSetName, pack, existingIndex);
  }
  if (alreadyMigrated) {
    await removeIndexedWorkingFiles(stickerSetName, existingIndex, [
      ...originalFilenames.values(),
      ...(inputs.sourceFilenames ?? []),
    ]);
    return false;
  }

  let index = existingIndex;
  if (!index) {
    const stickers: Record<string, string> = {};
    const previews: Record<string, string> = {};
    const signatureEntries: unknown[] = [];
    for (const sticker of pack.stickers) {
      const originalFilename = originalFilenames.get(sticker.id);
      const stickerId = sticker.id.split(':').pop();
      if (!originalFilename || !sticker.filename || !stickerId) {
        throw new Error('Legacy sticker manifest contains invalid identity');
      }
      const stickerSourcePath =
        inputs.stickerSourcePaths?.get(sticker.id) ??
        path.join(generateStickerPackDirPath(stickerSetName), originalFilename);
      const previewSourcePath = await ensureLegacyPreviewSourcePath(
        stickerSetName,
        stickerId,
        stickerSourcePath,
        inputs.previewSourcePaths?.get(sticker.id),
      );
      const stickerAsset = await storeStickerAsset(
        stickerSetName,
        stickerSourcePath,
      );
      const previewFilename = `${stickerId}.webp`;
      const previewAsset = await storeStickerAsset(
        stickerSetName,
        previewSourcePath,
      );
      setVersionAssetMapping(stickers, sticker.filename, stickerAsset);
      setVersionAssetMapping(previews, previewFilename, previewAsset);
      signatureEntries.push([
        sticker.id,
        sticker.title,
        sticker.filename,
        sticker.isAnimated === true,
        sticker.readyToUpload === true,
        stickerAsset,
        previewAsset,
      ]);
    }
    index = {
      version,
      signature: JSON.stringify(signatureEntries),
      stickers,
      previews,
    };
    await writeStickerVersionIndexAtomically(stickerSetName, index);
  }
  await assertStoredVersionComplete(stickerSetName, pack, index);
  setStickerPackVersionUrls(stickerSetName, pack, version);
  await writeStickerPackManifestAtomically(
    generateStickerPackFilePath(stickerSetName),
    pack,
  );
  await removeIndexedWorkingFiles(stickerSetName, index, [
    ...originalFilenames.values(),
    ...(inputs.sourceFilenames ?? []),
  ]);
  console.log(`Legacy sticker pack migrated: ${stickerSetName}`);
  return true;
}

async function migrateLegacyStickerPackWithAnimatedSources(
  stickerSetName: string,
  pack: StickerPack,
): Promise<boolean> {
  const prepared = await prepareLegacyAnimatedPack(stickerSetName, pack);
  if (!prepared) {
    return await migrateLegacyStickerPackUnlocked(stickerSetName, pack);
  }
  try {
    return await migrateLegacyStickerPackUnlocked(
      stickerSetName,
      prepared.pack,
      prepared.inputs,
    );
  } finally {
    await removeTemporaryMigrationPaths(prepared.temporaryPaths);
  }
}

export async function migrateLegacyStickerPack(
  stickerSetName: string,
  pack: StickerPack,
): Promise<boolean> {
  return await withStickerStorageMutation(stickerSetName, async () =>
    migrateLegacyStickerPackWithAnimatedSources(stickerSetName, pack),
  );
}

export async function migrateLegacyStickerStorage(): Promise<number> {
  console.log('Legacy sticker storage migration started');
  await fsp.mkdir(DATA_DIR, {recursive: true});
  const entries = await fsp.readdir(DATA_DIR, {withFileTypes: true});
  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const didMigrate = await withStickerStorageMutation(
        entry.name,
        async () => {
          const rawManifest = await readManifestOrUndefined(entry.name);
          if (rawManifest === undefined) {
            return false;
          }
          const pack = validateLocalStickerPackManifest(rawManifest);
          if (!pack) {
            throw new Error('invalid manifest');
          }
          return await migrateLegacyStickerPackWithAnimatedSources(
            entry.name,
            pack,
          );
        },
      );
      if (didMigrate) {
        migrated++;
      }
    } catch (err) {
      console.warn(`Legacy migration skipped ${entry.name}:`, err);
    }
  }
  return migrated;
}

export async function initializeTelegramStickerStorage(
  migrate: () => Promise<unknown> = migrateLegacyStickerStorage,
  collect: () => Promise<unknown> = garbageCollectStickerAssets,
): Promise<NodeJS.Timeout> {
  await migrate();
  try {
    await collect();
  } catch (err) {
    console.error('Sticker asset GC failed during startup:', err);
  }
  return scheduleStickerAssetGarbageCollection(collect);
}

export {
  isStickerPackDownloaded,
  downloadStickerPack,
  toMcStickerPack,
  DATA_DIR,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
};
