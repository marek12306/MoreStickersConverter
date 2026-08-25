import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {runMediaProcess} from './mediaProcess.js';
import {
  DATA_DIR,
  formatByteSize,
  getGarbageCollectionStatus,
  getLastGarbageCollection,
  STICKER_PACK_VERSION_RETENTION,
  type GarbageCollectionState,
  type LastGarbageCollectionSummary,
} from './stickerAssetStorage.js';
import {
  getLastRefreshAll,
  getRefreshAllStatus,
  type LastRefreshAllSummary,
  type RefreshAllState,
} from './stickerPackCommands.js';

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

export function formatTimeAgo(
  timestampMs: number | undefined,
  nowMs = Date.now(),
): string {
  if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return 'never';
  }
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
}

// ---------------------------------------------------------------------------
// 1. Tool Diagnostics (FFmpeg, lottieconverter, Node) with TTL cache
// ---------------------------------------------------------------------------

export interface ToolDiagnostics {
  nodeVersion: string;
  ffmpegVersion?: string;
  ffmpegAvailable: boolean;
  lottieConverterAvailable: boolean;
  checkedAt: number;
}

export const TOOL_DIAGNOSTICS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedToolDiagnostics: ToolDiagnostics | undefined;

export async function probeFfmpeg(): Promise<{
  available: boolean;
  version?: string;
}> {
  try {
    const {stdout} = await runMediaProcess(
      'ffmpeg',
      ['-version'],
      'probe FFmpeg version for status diagnostics',
      {timeoutMs: 5000},
    );
    const firstLine = stdout.split(/\r?\n/)[0]?.trim() || '';
    const match = /^ffmpeg\s+version\s+([^\s,]+)/i.exec(firstLine);
    if (match) {
      return {available: true, version: match[1]};
    }
    if (firstLine.toLowerCase().includes('ffmpeg')) {
      return {available: true, version: firstLine};
    }
    return {available: true, version: undefined};
  } catch {
    return {available: false, version: undefined};
  }
}

export async function probeLottieConverter(): Promise<boolean> {
  try {
    await runMediaProcess(
      'lottieconverter',
      [],
      'probe lottieconverter availability for status diagnostics',
      {timeoutMs: 5000},
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('exited with code')) {
      return true;
    }
    if (
      message.includes('ENOENT') ||
      message.includes('not found') ||
      message.includes('Failed to spawn') ||
      message.includes('process error')
    ) {
      return false;
    }
    return false;
  }
}

export async function getToolDiagnostics(
  forceRefresh = false,
  probers?: {
    probeFfmpeg?: () => Promise<{available: boolean; version?: string}>;
    probeLottieConverter?: () => Promise<boolean>;
  },
): Promise<ToolDiagnostics> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedToolDiagnostics &&
    now - cachedToolDiagnostics.checkedAt < TOOL_DIAGNOSTICS_CACHE_TTL_MS
  ) {
    return cachedToolDiagnostics;
  }

  const ffmpegProber = probers?.probeFfmpeg ?? probeFfmpeg;
  const lottieProber = probers?.probeLottieConverter ?? probeLottieConverter;

  const [ffmpegRes, lottieAvailable] = await Promise.all([
    ffmpegProber().catch(() => ({available: false, version: undefined})),
    lottieProber().catch(() => false),
  ]);

  cachedToolDiagnostics = {
    nodeVersion: process.version,
    ffmpegVersion: ffmpegRes.version,
    ffmpegAvailable: ffmpegRes.available,
    lottieConverterAvailable: lottieAvailable,
    checkedAt: now,
  };
  return cachedToolDiagnostics;
}

export function resetToolDiagnosticsCacheForTests(): void {
  cachedToolDiagnostics = undefined;
}

// ---------------------------------------------------------------------------
// 2. Work Counters & Queue Length Tracking
// ---------------------------------------------------------------------------

let activeDownloads = 0;
let activeEncodes = 0;
const activeDownloadQueues = new Set<Array<unknown>>();
const downloadStorage = new AsyncLocalStorage<boolean>();
const encodeStorage = new AsyncLocalStorage<boolean>();

export function getActiveDownloads(): number {
  return activeDownloads;
}

export function getActiveEncodes(): number {
  return activeEncodes;
}

export function getQueueLength(): number {
  let total = 0;
  for (const queue of activeDownloadQueues) {
    total += queue.length;
  }
  return total;
}

export async function withActiveDownload<T>(
  action: () => Promise<T>,
): Promise<T> {
  if (downloadStorage.getStore()) {
    return await action();
  }
  activeDownloads++;
  try {
    return await downloadStorage.run(true, action);
  } finally {
    activeDownloads = Math.max(0, activeDownloads - 1);
  }
}

export async function withActiveEncode<T>(
  action: () => Promise<T>,
): Promise<T> {
  if (encodeStorage.getStore()) {
    return await action();
  }
  activeEncodes++;
  try {
    return await encodeStorage.run(true, action);
  } finally {
    activeEncodes = Math.max(0, activeEncodes - 1);
  }
}

export function registerDownloadQueue(queue: Array<unknown>): () => void {
  activeDownloadQueues.add(queue);
  return () => {
    activeDownloadQueues.delete(queue);
  };
}

export function resetWorkCountersForTests(): void {
  activeDownloads = 0;
  activeEncodes = 0;
  activeDownloadQueues.clear();
}

// ---------------------------------------------------------------------------
// 3. Storage Diagnostics (Read-Only Scanner & TTL cache)
// ---------------------------------------------------------------------------

export interface StorageDiagnostics {
  sizeBytes?: number;
  legacyGifPackCount?: number;
  warnings?: number;
  checkedAt: number;
}

export const STORAGE_DIAGNOSTICS_CACHE_TTL_MS = 60 * 1000; // 60 seconds
let cachedStorageDiagnostics: StorageDiagnostics | undefined;

export async function calculateStorageSizeBytes(
  dirPath: string,
): Promise<number> {
  let totalBytes = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dirPath, {withFileTypes: true});
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return 0;
    }
    throw err;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        totalBytes += await calculateStorageSizeBytes(fullPath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        totalBytes += stat.size;
      }
    } catch (err: unknown) {
      if (getErrorCode(err) !== 'ENOENT') {
        throw err;
      }
    }
  }
  return totalBytes;
}

async function listPackVersionsInDir(versionsDir: string): Promise<number[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(versionsDir, {withFileTypes: true});
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return entries
    .flatMap(entry => {
      const rawVersion = entry.name.slice(0, -5);
      const version = Number(rawVersion);
      return entry.isFile() &&
        /^\d+\.json$/.test(entry.name) &&
        typeof version === 'number' &&
        Number.isSafeInteger(version) &&
        version >= 1 &&
        String(version) === rawVersion
        ? [version]
        : [];
    })
    .sort((a, b) => a - b);
}

async function readCurrentVersionFromManifest(
  manifestPath: string,
): Promise<number | undefined> {
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as {dynamic?: {version?: number}};
    if (
      typeof parsed?.dynamic?.version === 'number' &&
      Number.isSafeInteger(parsed.dynamic.version) &&
      parsed.dynamic.version >= 1
    ) {
      return parsed.dynamic.version;
    }
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
  return undefined;
}

async function hasGifInVersionIndex(indexPath: string): Promise<boolean> {
  const raw = await fsp.readFile(indexPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    stickers?: Record<string, string>;
    previews?: Record<string, string>;
  };
  if (parsed.stickers && typeof parsed.stickers === 'object') {
    for (const [filename, asset] of Object.entries(parsed.stickers)) {
      if (
        (typeof filename === 'string' &&
          filename.toLowerCase().endsWith('.gif')) ||
        (typeof asset === 'string' && asset.toLowerCase().endsWith('.gif'))
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function countLegacyGifPacks(
  dataDir: string,
): Promise<{count: number; warnings: number}> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dataDir, {withFileTypes: true});
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return {count: 0, warnings: 0};
    }
    throw err;
  }

  let count = 0;
  let warnings = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packName = entry.name;
    const packDir = path.join(dataDir, packName);
    const versionsDir = path.join(packDir, 'versions');
    const manifestPath = path.join(dataDir, `${packName}.telegram.stickerpack`);

    try {
      let hasLegacyGif = false;
      const versions = await listPackVersionsInDir(versionsDir);
      const currentVersion =
        (await readCurrentVersionFromManifest(manifestPath)) ??
        (versions.length > 0 ? versions[versions.length - 1] : 0);

      const publishedVersions = versions
        .filter(version => version <= currentVersion)
        .slice(-STICKER_PACK_VERSION_RETENTION);

      for (const version of publishedVersions) {
        const indexPath = path.join(versionsDir, `${version}.json`);
        if (await hasGifInVersionIndex(indexPath)) {
          hasLegacyGif = true;
          break;
        }
      }

      if (!hasLegacyGif) {
        try {
          const raw = await fsp.readFile(manifestPath, 'utf8');
          const packData = JSON.parse(raw) as {
            logo?: {filename?: string; image?: string; isAnimated?: boolean};
            stickers?: Array<{
              filename?: string;
              image?: string;
              isAnimated?: boolean;
            }>;
          };
          if (
            packData.logo?.filename?.toLowerCase().endsWith('.gif') ||
            packData.logo?.image?.toLowerCase().endsWith('.gif')
          ) {
            hasLegacyGif = true;
          } else if (Array.isArray(packData.stickers)) {
            hasLegacyGif = packData.stickers.some(
              s =>
                s.filename?.toLowerCase().endsWith('.gif') ||
                s.image?.toLowerCase().endsWith('.gif'),
            );
          }
        } catch (err: unknown) {
          if (getErrorCode(err) !== 'ENOENT') {
            warnings++;
          }
        }
      }

      if (hasLegacyGif) {
        count++;
      }
    } catch (err) {
      warnings++;
      console.warn(
        `Diagnostics legacy GIF scan warning for pack "${packName}":`,
        err,
      );
    }
  }

  return {count, warnings};
}

export async function getStorageDiagnostics(
  forceRefresh = false,
  customDataDir = DATA_DIR,
): Promise<StorageDiagnostics> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedStorageDiagnostics &&
    now - cachedStorageDiagnostics.checkedAt < STORAGE_DIAGNOSTICS_CACHE_TTL_MS
  ) {
    return cachedStorageDiagnostics;
  }

  try {
    await fsp.access(customDataDir, fs.constants.R_OK);
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      cachedStorageDiagnostics = {
        sizeBytes: 0,
        legacyGifPackCount: 0,
        warnings: 0,
        checkedAt: now,
      };
      return cachedStorageDiagnostics;
    }
    return {
      sizeBytes: undefined,
      legacyGifPackCount: undefined,
      warnings: 1,
      checkedAt: now,
    };
  }

  let sizeBytes: number | undefined;
  let legacyGifPackCount: number | undefined;
  let warnings = 0;

  try {
    sizeBytes = await calculateStorageSizeBytes(customDataDir);
  } catch (err) {
    warnings++;
    console.warn('Storage size calculation warning:', err);
  }

  try {
    const legacyResult = await countLegacyGifPacks(customDataDir);
    if (legacyResult.warnings === 0) {
      legacyGifPackCount = legacyResult.count;
    } else {
      legacyGifPackCount = undefined;
      warnings += legacyResult.warnings;
    }
  } catch (err) {
    warnings++;
    console.warn('Legacy GIF pack count scan warning:', err);
  }
  cachedStorageDiagnostics = {
    sizeBytes,
    legacyGifPackCount,
    warnings: warnings > 0 ? warnings : undefined,
    checkedAt: now,
  };
  return cachedStorageDiagnostics;
}

export function resetStorageDiagnosticsCacheForTests(): void {
  cachedStorageDiagnostics = undefined;
}

// ---------------------------------------------------------------------------
// 4. Converter Status Snapshot & Formatter
// ---------------------------------------------------------------------------

export interface ConverterStatusSnapshot {
  runtime: {
    status: 'OK' | 'DEGRADED';
    uptimeSeconds: number;
    nodeVersion: string;
    ffmpegVersion?: string;
    ffmpegAvailable: boolean;
    lottieConverterAvailable: boolean;
    concurrency: number;
    dataDirOk: boolean;
    externalUrlConfigured: boolean;
  };
  work: {
    activeDownloads: number;
    activeEncodes: number;
    queueLength: number;
  };
  storage: {
    sizeBytes?: number;
    legacyGifPackCount?: number;
    warnings?: number;
  };
  refreshAll: {
    current: RefreshAllState;
    last?: LastRefreshAllSummary;
  };
  garbageCollection: {
    current: GarbageCollectionState;
    last?: LastGarbageCollectionSummary;
  };
}

export async function getConverterStatusSnapshot(options?: {
  concurrency?: number;
  dataDir?: string;
  externalUrl?: string;
  forceRefresh?: boolean;
}): Promise<ConverterStatusSnapshot> {
  const targetDataDir = options?.dataDir ?? DATA_DIR;
  let dataDirOk = false;
  try {
    await fsp.access(targetDataDir, fs.constants.R_OK | fs.constants.W_OK);
    dataDirOk = true;
  } catch {
    dataDirOk = false;
  }

  const externalUrlConfigured = Boolean(
    options?.externalUrl ?? process.env.EXTERNAL_URL,
  );
  const status: 'OK' | 'DEGRADED' =
    dataDirOk && externalUrlConfigured ? 'OK' : 'DEGRADED';

  const [toolDiag, storageDiag] = await Promise.all([
    getToolDiagnostics(options?.forceRefresh),
    getStorageDiagnostics(options?.forceRefresh, targetDataDir),
  ]);

  return {
    runtime: {
      status,
      uptimeSeconds: process.uptime(),
      nodeVersion: toolDiag.nodeVersion,
      ffmpegVersion: toolDiag.ffmpegVersion,
      ffmpegAvailable: toolDiag.ffmpegAvailable,
      lottieConverterAvailable: toolDiag.lottieConverterAvailable,
      concurrency: options?.concurrency ?? 1,
      dataDirOk,
      externalUrlConfigured,
    },
    work: {
      activeDownloads: getActiveDownloads(),
      activeEncodes: getActiveEncodes(),
      queueLength: getQueueLength(),
    },
    storage: {
      sizeBytes: storageDiag.sizeBytes,
      legacyGifPackCount: storageDiag.legacyGifPackCount,
      warnings: storageDiag.warnings,
    },
    refreshAll: {
      current: getRefreshAllStatus(),
      last: getLastRefreshAll(),
    },
    garbageCollection: {
      current: getGarbageCollectionStatus(),
      last: getLastGarbageCollection(),
    },
  };
}

export function formatStatusResponse(
  snapshot: ConverterStatusSnapshot,
  formatUptimeFn: (seconds: number) => string,
): string {
  const {runtime, work, storage, refreshAll, garbageCollection} = snapshot;

  const uptimeStr = formatUptimeFn(runtime.uptimeSeconds);
  const ffmpegStr = runtime.ffmpegAvailable
    ? (runtime.ffmpegVersion ?? 'available')
    : 'unavailable';
  const lottieStr = runtime.lottieConverterAvailable
    ? 'available'
    : 'unavailable';
  const dataDirStr = runtime.dataDirOk ? 'OK' : 'Inaccessible';
  const externalUrlStr = runtime.externalUrlConfigured
    ? 'configured'
    : 'missing';

  const sizeStr =
    storage.sizeBytes !== undefined
      ? formatByteSize(storage.sizeBytes)
      : 'unavailable';
  const legacyPacksStr =
    storage.legacyGifPackCount !== undefined
      ? String(storage.legacyGifPackCount)
      : 'unavailable';

  // Refresh all formatting
  let refreshAllSection = '';
  if (refreshAll.current.running) {
    const lines = [
      'Refresh all: running',
      `Progress: ${refreshAll.current.currentPack ? refreshAll.current.processed + 1 : refreshAll.current.processed}/${refreshAll.current.total}`,
    ];
    if (refreshAll.current.currentPack) {
      lines.push(`Current: ${refreshAll.current.currentPack}`);
    }
    lines.push(`Successful: ${refreshAll.current.successful}`);
    lines.push(`Failed: ${refreshAll.current.failed}`);
    lines.push(
      `Cancel requested: ${refreshAll.current.cancelRequested ? 'yes' : 'no'}`,
    );
    if (refreshAll.current.startedAt) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - refreshAll.current.startedAt) / 1000),
      );
      lines.push(`Elapsed: ${formatUptimeFn(elapsedSeconds)}`);
    }
    if (refreshAll.last) {
      lines.push(`Last run: ${formatTimeAgo(refreshAll.last.finishedAt)}`);
      lines.push(
        `Last result: ${refreshAll.last.outcome}, ${refreshAll.last.refreshed} refreshed, ${refreshAll.last.failed} failed`,
      );
    }
    refreshAllSection = lines.join('\n');
  } else {
    const lines = ['Refresh all: idle'];
    if (refreshAll.last) {
      lines.push(`Last run: ${formatTimeAgo(refreshAll.last.finishedAt)}`);
      if (refreshAll.last.outcome === 'cancelled') {
        lines.push(
          `Result: cancelled, ${refreshAll.last.refreshed} refreshed, ${refreshAll.last.failed} failed, ${refreshAll.last.skipped} skipped`,
        );
      } else if (refreshAll.last.outcome === 'failed') {
        lines.push(
          `Result: failed, ${refreshAll.last.refreshed} refreshed, ${refreshAll.last.failed} failed`,
        );
      } else {
        lines.push(
          `Result: ${refreshAll.last.refreshed} refreshed, ${refreshAll.last.failed} failed`,
        );
      }
    } else {
      lines.push('Last run: never');
    }
    refreshAllSection = lines.join('\n');
  }

  // Garbage collection formatting
  let gcSection = '';
  if (garbageCollection.current.running) {
    const lines = [
      'Garbage collection: running',
      `Mode: ${garbageCollection.current.mode ?? 'apply'}`,
    ];
    if (garbageCollection.current.retention !== undefined) {
      lines.push(`Retention: ${garbageCollection.current.retention}`);
    }
    if (garbageCollection.current.startedAt) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - garbageCollection.current.startedAt) / 1000),
      );
      lines.push(`Elapsed: ${formatUptimeFn(elapsedSeconds)}`);
    }
    if (garbageCollection.last) {
      lines.push(
        `Last run: ${formatTimeAgo(garbageCollection.last.finishedAt)}`,
      );
      lines.push(`Last mode: ${garbageCollection.last.mode}`);
      if (garbageCollection.last.retention !== undefined) {
        lines.push(`Last retention: ${garbageCollection.last.retention}`);
      }
      lines.push(
        `Last result: ${garbageCollection.last.outcome} with ${garbageCollection.last.errors} error${garbageCollection.last.errors === 1 ? '' : 's'}`,
      );
      if (
        garbageCollection.last.mode === 'apply' &&
        garbageCollection.last.bytesFreed !== undefined
      ) {
        lines.push(
          `Last freed: ${formatByteSize(garbageCollection.last.bytesFreed)}`,
        );
      }
    }
    gcSection = lines.join('\n');
  } else {
    const lines = ['Garbage collection: idle'];
    if (garbageCollection.last) {
      lines.push(
        `Last run: ${formatTimeAgo(garbageCollection.last.finishedAt)}`,
      );
      lines.push(`Mode: ${garbageCollection.last.mode}`);
      if (garbageCollection.last.retention !== undefined) {
        lines.push(`Retention: ${garbageCollection.last.retention}`);
      }
      lines.push(
        `Result: ${garbageCollection.last.outcome} with ${garbageCollection.last.errors} error${garbageCollection.last.errors === 1 ? '' : 's'}`,
      );
      if (
        garbageCollection.last.mode === 'apply' &&
        garbageCollection.last.bytesFreed !== undefined
      ) {
        lines.push(
          `Freed: ${formatByteSize(garbageCollection.last.bytesFreed)}`,
        );
      }
    } else {
      lines.push('Last run: never');
    }
    gcSection = lines.join('\n');
  }

  return (
    'MoreStickersConverter status\n\n' +
    'Runtime\n' +
    `Status: ${runtime.status}\n` +
    `Uptime: ${uptimeStr}\n` +
    `Node.js: ${runtime.nodeVersion}\n` +
    `FFmpeg: ${ffmpegStr}\n` +
    `lottieconverter: ${lottieStr}\n` +
    `Download concurrency: ${runtime.concurrency}\n` +
    `Data directory: ${dataDirStr}\n` +
    `External URL: ${externalUrlStr}\n\n` +
    'Work\n' +
    `Active downloads: ${work.activeDownloads}\n` +
    `Active encodes: ${work.activeEncodes}\n` +
    `Queue length: ${work.queueLength}\n\n` +
    'Storage\n' +
    `Storage size: ${sizeStr}\n` +
    `Legacy GIF packs: ${legacyPacksStr}\n\n` +
    refreshAllSection +
    '\n\n' +
    gcSection
  );
}
