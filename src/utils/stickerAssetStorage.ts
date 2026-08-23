import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const DATA_DIR = path.join(
  path.resolve(process.env.DATA_DIR!),
  'telegram',
);
export const STICKER_PACK_VERSION_RETENTION = 5;
export const STICKER_STORAGE_GC_INTERVAL_MS = 5 * 60 * 60 * 1000;

export interface StickerVersionIndex {
  version: number;
  signature: string;
  stickers: Record<string, string>;
  previews: Record<string, string>;
}

const storageMutationQueues = new Map<string, Promise<unknown>>();

export function withStickerStorageMutation<T>(
  stickerSetName: string,
  job: () => Promise<T>,
): Promise<T> {
  const key = stickerSetName.toLowerCase();
  const previousRun = storageMutationQueues.get(key) ?? Promise.resolve();
  const run = previousRun.then(job);
  const trackedRun = run
    .catch(() => undefined)
    .finally(() => {
      if (storageMutationQueues.get(key) === trackedRun) {
        storageMutationQueues.delete(key);
      }
    });
  storageMutationQueues.set(key, trackedRun);
  return run;
}

export function generateStickerPackDirPath(stickerSetName: string): string {
  return path.join(DATA_DIR, stickerSetName);
}

export function generateStickerPackFilePath(stickerSetName: string): string {
  return path.join(DATA_DIR, `${stickerSetName}.telegram.stickerpack`);
}

export function generateStickerAssetsDirPath(stickerSetName: string): string {
  return path.join(generateStickerPackDirPath(stickerSetName), 'assets');
}

export function generateStickerVersionsDirPath(stickerSetName: string): string {
  return path.join(generateStickerPackDirPath(stickerSetName), 'versions');
}

export function generateStickerVersionIndexPath(
  stickerSetName: string,
  version: number,
): string {
  return path.join(
    generateStickerVersionsDirPath(stickerSetName),
    `${version}.json`,
  );
}

function isValidVersion(version: unknown): version is number {
  return (
    typeof version === 'number' && Number.isSafeInteger(version) && version >= 1
  );
}

function isSafePublicFilename(filename: string): boolean {
  return (
    path.basename(filename) === filename &&
    !filename.includes('..') &&
    /^[a-zA-Z0-9_-]+\.(?:avif|gif|webp)$/.test(filename)
  );
}

function isSafeAssetFilename(filename: unknown): filename is string {
  return (
    typeof filename === 'string' &&
    /^[a-f0-9]{64}\.(?:avif|gif|webp)$/.test(filename)
  );
}

function validateFilenameMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([filename, asset]) =>
      isSafePublicFilename(filename) &&
      isSafeAssetFilename(asset) &&
      path.extname(filename).toLowerCase() === path.extname(asset),
  );
}

function validateVersionIndex(
  value: unknown,
  expectedVersion?: number,
): StickerVersionIndex | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const index = value as Partial<StickerVersionIndex>;
  if (
    !isValidVersion(index.version) ||
    (expectedVersion !== undefined && index.version !== expectedVersion) ||
    typeof index.signature !== 'string' ||
    !validateFilenameMap(index.stickers) ||
    !validateFilenameMap(index.previews)
  ) {
    return null;
  }
  return index as StickerVersionIndex;
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

async function writeJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fsp.mkdir(path.dirname(filePath), {recursive: true});
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value), 'utf8');
    await fsp.rename(tempPath, filePath);
  } finally {
    await fsp.unlink(tempPath).catch(() => undefined);
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function storeStickerAsset(
  stickerSetName: string,
  sourcePath: string,
): Promise<string> {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension !== '.avif' && extension !== '.gif' && extension !== '.webp') {
    throw new Error(`Unsupported sticker asset extension: ${extension}`);
  }

  const assetsDir = generateStickerAssetsDirPath(stickerSetName);
  await fsp.mkdir(assetsDir, {recursive: true});
  const tempPath = path.join(assetsDir, `.asset-${randomUUID()}.tmp`);
  const hash = createHash('sha256');
  try {
    await pipeline(
      fs.createReadStream(sourcePath),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      fs.createWriteStream(tempPath, {flags: 'wx'}),
    );
    const digest = hash.digest('hex');
    const assetFilename = `${digest}${extension}`;
    const assetPath = path.join(assetsDir, assetFilename);
    try {
      if ((await hashFile(assetPath)) === digest) {
        return assetFilename;
      }
    } catch (err: unknown) {
      if (getErrorCode(err) !== 'ENOENT') {
        throw err;
      }
    }
    await fsp.rename(tempPath, assetPath);
    return assetFilename;
  } finally {
    await fsp.unlink(tempPath).catch(() => undefined);
  }
}
export async function readStickerVersionIndex(
  stickerSetName: string,
  version: number,
): Promise<StickerVersionIndex | undefined> {
  if (!isValidVersion(version)) {
    return undefined;
  }
  let raw: string;
  try {
    raw = await fsp.readFile(
      generateStickerVersionIndexPath(stickerSetName, version),
      'utf8',
    );
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
  const parsed = validateVersionIndex(JSON.parse(raw), version);
  if (!parsed) {
    throw new Error(
      `Invalid version index for sticker pack "${stickerSetName}" version ${version}`,
    );
  }
  return parsed;
}

export async function verifyStoredStickerAsset(
  stickerSetName: string,
  assetFilename: string,
): Promise<boolean> {
  if (!isSafeAssetFilename(assetFilename)) {
    return false;
  }
  try {
    return (
      (await hashFile(
        path.join(generateStickerAssetsDirPath(stickerSetName), assetFilename),
      )) === assetFilename.slice(0, 64)
    );
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export async function writeStickerVersionIndexAtomically(
  stickerSetName: string,
  index: StickerVersionIndex,
): Promise<void> {
  if (!validateVersionIndex(index, index.version)) {
    throw new Error('Refusing to write invalid sticker version index');
  }
  const indexPath = generateStickerVersionIndexPath(
    stickerSetName,
    index.version,
  );
  const existing = await readStickerVersionIndex(stickerSetName, index.version);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(index)) {
      throw new Error(
        `Refusing to replace immutable sticker version ${index.version} for "${stickerSetName}"`,
      );
    }
    return;
  }
  await writeJsonAtomically(indexPath, index);
}

export async function listStickerPackVersions(
  stickerSetName: string,
): Promise<number[]> {
  let entries;
  try {
    entries = await fsp.readdir(
      generateStickerVersionsDirPath(stickerSetName),
      {
        withFileTypes: true,
      },
    );
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
        isValidVersion(version) &&
        String(version) === rawVersion
        ? [version]
        : [];
    })
    .sort((a, b) => a - b);
}

interface CurrentStickerStorageManifest {
  version: number;
  stickers: Array<{filename: string; previewFilename: string}>;
}

async function readCurrentStickerStorageManifest(
  stickerSetName: string,
): Promise<CurrentStickerStorageManifest | undefined> {
  let raw: string;
  try {
    raw = await fsp.readFile(
      generateStickerPackFilePath(stickerSetName),
      'utf8',
    );
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
  try {
    const manifest = JSON.parse(raw) as {
      id?: unknown;
      dynamic?: {version?: unknown};
      stickers?: unknown;
    };
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      typeof manifest.id !== 'string' ||
      !isValidVersion(manifest.dynamic?.version) ||
      !Array.isArray(manifest.stickers)
    ) {
      throw new Error('invalid versioned manifest');
    }
    const stickers = manifest.stickers.map(stickerValue => {
      if (
        typeof stickerValue !== 'object' ||
        stickerValue === null ||
        !('id' in stickerValue) ||
        typeof stickerValue.id !== 'string' ||
        !('filename' in stickerValue) ||
        typeof stickerValue.filename !== 'string'
      ) {
        throw new Error('invalid sticker in versioned manifest');
      }
      const stickerId = stickerValue.id.split(':').pop();
      const previewFilename = `${stickerId}.webp`;
      if (
        !isSafePublicFilename(stickerValue.filename) ||
        !stickerId ||
        !isSafePublicFilename(previewFilename)
      ) {
        throw new Error('unsafe sticker in versioned manifest');
      }
      return {filename: stickerValue.filename, previewFilename};
    });
    return {version: manifest.dynamic.version, stickers};
  } catch (err) {
    throw new Error(
      `Cannot safely determine current version for "${stickerSetName}"`,
      {cause: err},
    );
  }
}

interface StickerVersionRetention {
  publishedVersions: number[];
  pendingVersion?: number;
}

function getStickerVersionRetention(
  versions: number[],
  currentVersion = 0,
): StickerVersionRetention {
  if (currentVersion > 0 && !versions.includes(currentVersion)) {
    throw new Error(
      `Current sticker pack version ${currentVersion} has no version index`,
    );
  }
  const publishedVersions = versions
    .filter(version => version <= currentVersion)
    .slice(-STICKER_PACK_VERSION_RETENTION);
  const nextVersion = currentVersion + 1;
  return {
    publishedVersions,
    ...(versions.includes(nextVersion) ? {pendingVersion: nextVersion} : {}),
  };
}

interface StickerRetentionPlan {
  staleVersions: number[];
  referencedAssets: Set<string>;
  assetEntries: fs.Dirent[];
}

function addIndexAssets(
  index: StickerVersionIndex,
  referencedAssets: Set<string>,
): void {
  for (const asset of [
    ...Object.values(index.stickers),
    ...Object.values(index.previews),
  ]) {
    referencedAssets.add(asset);
  }
}

async function verifyReferencedAssets(
  stickerSetName: string,
  assets: Set<string>,
): Promise<void> {
  for (const asset of assets) {
    if (!(await verifyStoredStickerAsset(stickerSetName, asset))) {
      throw new Error(`Retained asset "${asset}" is missing or corrupt`);
    }
  }
}

async function buildValidatedStickerRetentionPlan(
  stickerSetName: string,
): Promise<StickerRetentionPlan> {
  const versions = await listStickerPackVersions(stickerSetName);
  const currentManifest =
    await readCurrentStickerStorageManifest(stickerSetName);
  const retention = getStickerVersionRetention(
    versions,
    currentManifest?.version,
  );
  const preservedVersions = new Set(retention.publishedVersions);
  const retainedIndexes = new Map<number, StickerVersionIndex>();
  const referencedAssets = new Set<string>();
  for (const version of retention.publishedVersions) {
    const index = await readStickerVersionIndex(stickerSetName, version);
    if (!index) {
      throw new Error(`Missing retained sticker version index ${version}`);
    }
    retainedIndexes.set(version, index);
    addIndexAssets(index, referencedAssets);
  }
  if (currentManifest) {
    const currentIndex = retainedIndexes.get(currentManifest.version);
    if (!currentIndex) {
      throw new Error('Current sticker version index is not retained');
    }
    for (const sticker of currentManifest.stickers) {
      if (
        !currentIndex.stickers[sticker.filename] ||
        !currentIndex.previews[sticker.previewFilename]
      ) {
        throw new Error(
          'Current sticker version index is missing a public asset',
        );
      }
    }
  }
  await verifyReferencedAssets(stickerSetName, referencedAssets);

  if (retention.pendingVersion !== undefined) {
    try {
      const pendingIndex = await readStickerVersionIndex(
        stickerSetName,
        retention.pendingVersion,
      );
      if (!pendingIndex) {
        throw new Error('Pending recovery index is missing');
      }
      const pendingAssets = new Set<string>();
      addIndexAssets(pendingIndex, pendingAssets);
      await verifyReferencedAssets(stickerSetName, pendingAssets);
      preservedVersions.add(retention.pendingVersion);
      for (const asset of pendingAssets) {
        referencedAssets.add(asset);
      }
    } catch (err) {
      console.warn(
        `Discarding invalid pending sticker version ${retention.pendingVersion} for "${stickerSetName}":`,
        err,
      );
    }
  }

  let assetEntries: fs.Dirent[] = [];
  try {
    assetEntries = await fsp.readdir(
      generateStickerAssetsDirPath(stickerSetName),
      {withFileTypes: true},
    );
  } catch (err: unknown) {
    if (getErrorCode(err) !== 'ENOENT') {
      throw err;
    }
  }
  return {
    staleVersions: versions.filter(version => !preservedVersions.has(version)),
    referencedAssets,
    assetEntries,
  };
}

async function removeStickerVersionIndexes(
  stickerSetName: string,
  versions: number[],
): Promise<void> {
  await Promise.all(
    versions.map(version =>
      fsp.rm(generateStickerVersionIndexPath(stickerSetName, version), {
        force: true,
      }),
    ),
  );
}

export async function pruneOldStickerVersions(
  stickerSetName: string,
): Promise<number> {
  let plan: StickerRetentionPlan;
  try {
    plan = await buildValidatedStickerRetentionPlan(stickerSetName);
  } catch (err) {
    console.warn(
      `Sticker version retention skipped pack "${stickerSetName}":`,
      err,
    );
    return 0;
  }
  await removeStickerVersionIndexes(stickerSetName, plan.staleVersions);
  return plan.staleVersions.length;
}

export async function resolveStickerAssetPath(
  stickerSetName: string,
  version: number,
  filename: string,
  kind: 'stickers' | 'previews',
): Promise<string | undefined> {
  if (!isSafePublicFilename(filename)) {
    return undefined;
  }
  const index = await readStickerVersionIndex(stickerSetName, version);
  const assetFilename = index?.[kind][filename];
  if (!assetFilename || !isSafeAssetFilename(assetFilename)) {
    return undefined;
  }
  return path.join(generateStickerAssetsDirPath(stickerSetName), assetFilename);
}

export async function resolveLegacyStickerAssetPath(
  stickerSetName: string,
  version: number,
  filename: string,
  kind: 'stickers' | 'previews',
): Promise<string | undefined> {
  const exactPath = await resolveStickerAssetPath(
    stickerSetName,
    version,
    filename,
    kind,
  );
  if (exactPath || kind !== 'stickers') {
    return exactPath;
  }
  // Legacy -160 alias: A-160.gif -> A.gif (never materialized in an index).
  const aliasedFilename = filename.endsWith('-160.gif')
    ? filename.replace(/-160\.gif$/, '.gif')
    : filename;
  if (aliasedFilename !== filename) {
    const aliasedPath = await resolveStickerAssetPath(
      stickerSetName,
      version,
      aliasedFilename,
      kind,
    );
    if (aliasedPath) {
      return aliasedPath;
    }
  }
  // Legacy animated-GIF compatibility: A.gif -> current A.avif. Applies only
  // to the logical stickered name (after the -160 alias above), never to
  // other extensions or to a physical A-160.avif.
  if (aliasedFilename.endsWith('.gif')) {
    return await resolveStickerAssetPath(
      stickerSetName,
      version,
      aliasedFilename.replace(/\.gif$/, '.avif'),
      kind,
    );
  }
  return undefined;
}

async function garbageCollectStickerPack(stickerSetName: string): Promise<{
  versionsRemoved: number;
  assetsRemoved: number;
}> {
  const plan = await buildValidatedStickerRetentionPlan(stickerSetName);
  const orphaned = plan.assetEntries.filter(
    entry =>
      entry.isFile() &&
      isSafeAssetFilename(entry.name) &&
      !plan.referencedAssets.has(entry.name),
  );

  await removeStickerVersionIndexes(stickerSetName, plan.staleVersions);
  await Promise.all(
    orphaned.map(entry =>
      fsp.rm(
        path.join(generateStickerAssetsDirPath(stickerSetName), entry.name),
        {force: true},
      ),
    ),
  );
  return {
    versionsRemoved: plan.staleVersions.length,
    assetsRemoved: orphaned.length,
  };
}

export async function garbageCollectStickerAssets(): Promise<void> {
  console.log('Sticker asset GC started');
  await fsp.mkdir(DATA_DIR, {recursive: true});
  const entries = await fsp.readdir(DATA_DIR, {withFileTypes: true});
  let versionsRemoved = 0;
  let assetsRemoved = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const result = await withStickerStorageMutation(entry.name, async () =>
        garbageCollectStickerPack(entry.name),
      );
      versionsRemoved += result.versionsRemoved;
      assetsRemoved += result.assetsRemoved;
    } catch (err) {
      console.warn(`Sticker asset GC skipped pack "${entry.name}":`, err);
    }
  }
  console.log(
    `Sticker asset GC completed: ${versionsRemoved} versions removed, ${assetsRemoved} orphaned assets removed`,
  );
}

export function scheduleStickerAssetGarbageCollection(
  collect: () => Promise<void> = garbageCollectStickerAssets,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void collect().catch(err => {
      console.error('Sticker asset GC failed:', err);
    });
  }, STICKER_STORAGE_GC_INTERVAL_MS);
  timer.unref();
  return timer;
}
