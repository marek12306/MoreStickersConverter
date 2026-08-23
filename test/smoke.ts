import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {gzipSync} from 'node:zlib';

// Setup environment before importing app modules
const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'morestickers-test-'));
process.env.DATA_DIR = tempDir;
process.env.CONCURRENCY = '2';
process.env.EXTERNAL_URL = 'https://stickers.example.com';
process.env.BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
process.env.ALLOWED_TELEGRAM_USER_IDS = '123456789,987654321';
process.env.PORT = '3000';
import type {GifEncoder} from '../src/utils/webmToGif.js';
import type {Telegram} from 'telegraf';
const {
  buildFfmpegFilter,
  convertWebmToGif,
  convertWebmToGifWithEncoder,
  GIF_DIMENSION_SCALE,
  GIF_ENCODING_PROFILES,
  GIF_TARGET_BYTES,
  GIF_SAFE_HARD_LIMIT_BYTES,
} = await import('../src/utils/webmToGif.js');
const {TGS_GIF_ENCODING_PROFILES} = await import(
  '../src/utils/gifConversion.js'
);
const {
  convertTgsToGif,
  convertTgsToGifWithEncoder,
  normalizeLottieJsonForConverter,
  prepareTgsForLottieConverter,
} = await import('../src/utils/tgsToGif.js');
const {
  buildPreviewFilter,
  generatePreview,
  generatePreviewWithEncoder,
  PREVIEW_TARGET_BYTES,
  PREVIEW_MAX_BYTES,
  PREVIEW_PROFILES,
} = await import('../src/utils/stickerPreview.js');
const {
  DATA_DIR,
  isLegacyStickerPack,
  isStickerPackDownloaded,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
  generateStickerPreviewDirPath,
  generateStickerPreviewFilePath,
  getStickerMediaInfo,
  fetchStickerWithRetry,
  parseDownloadConcurrency,
  generateStickerPackExternalUrl,
  getStickerContentSignature,
  getTelegramStickerContentSignature,
  resolveStickerPackVersion,
  validateLocalStickerPackManifest,
  writeStickerPackManifestAtomically,
  enqueueManifestPublish,
  enqueueStickerPackOperation,
  readManifestOrUndefined,
  initializeTelegramStickerStorage,
  migrateLegacyStickerPack,
  migrateLegacyStickerStorage,
  toMcStickerPack,
} = await import('../src/utils/telegramStickers.js');
const {
  garbageCollectStickerAssets,
  generateStickerAssetsDirPath,
  listStickerPackVersions,
  readStickerVersionIndex,
  pruneOldStickerVersions,
  resolveStickerAssetPath,
  scheduleStickerAssetGarbageCollection,
  STICKER_PACK_VERSION_RETENTION,
  STICKER_STORAGE_GC_INTERVAL_MS,
  storeStickerAsset,
  withStickerStorageMutation,
  writeStickerVersionIndexAtomically,
} = await import('../src/utils/stickerAssetStorage.js');
const {
  DEFAULT_STICKER_PACK_METADATA,
  getStickerPackMetadata,
  getStickerPackMetadataPath,
  generateStickerPackMetadataPath,
  isValidStickerPackName,
  normalizeStoredMetadata,
  updateStickerPackMetadata,
} = await import('../src/utils/stickerPackMetadata.js');
const {getPublicStickerPacks} = await import(
  '../src/utils/stickerPackCatalog.js'
);
const {
  handleVisibilityCommand,
  isAllowedTelegramUser,
  resolveStickerPackNameFromCommand,
} = await import('../src/utils/stickerPackVisibilityCommands.js');
const {formatCommandUsage, formatUptime} = await import(
  '../src/utils/telegramCommandUtils.js'
);
const {
  handleCheckCommand,
  handleInfoCommand,
  handlePackCommand,
  handleRefreshCommand,
  handleStatsCommand,
  handleStatusCommand,
  importOrGetStickerPack,
} = await import('../src/utils/stickerPackCommands.js');
const {app} = await import('../src/utils/fastify.js');

console.log('--- Starting Smoke Tests in Nix Environment ---');

assert.equal(GIF_DIMENSION_SCALE, 0.5, 'GIF dimension scale must be 0.5');
assert.deepEqual(
  GIF_ENCODING_PROFILES.map(profile => profile.maxDimension),
  [160, 152, 144, 128, 112, 96, 80, 64, 48, 40],
  'GIF profiles must use half-size output dimensions',
);
assert.deepEqual(
  TGS_GIF_ENCODING_PROFILES.map(profile => profile.maxDimension),
  GIF_ENCODING_PROFILES.map(profile => profile.maxDimension),
  'TGS and WebM GIF profiles must use the same scaled dimensions',
);
assert.equal(
  TGS_GIF_ENCODING_PROFILES.length,
  GIF_ENCODING_PROFILES.length,
  'TGS and WebM GIF profile lists must have matching lengths',
);
assert.equal(
  PREVIEW_TARGET_BYTES,
  12 * 1024,
  'Preview target bytes must be 12 KiB',
);
assert.equal(PREVIEW_MAX_BYTES, 24 * 1024, 'Preview max bytes must be 24 KiB');
assert.deepEqual(
  PREVIEW_PROFILES,
  [
    {maxDimension: 96, quality: 60},
    {maxDimension: 96, quality: 50},
    {maxDimension: 80, quality: 50},
    {maxDimension: 80, quality: 40},
    {maxDimension: 64, quality: 40},
  ],
  'Preview profiles must match specification',
);
const firstPreviewFilter = buildPreviewFilter(PREVIEW_PROFILES[0]);
assert.ok(
  firstPreviewFilter.includes('min(96,iw)'),
  `Expected preview filter to use max dimension 96, got ${firstPreviewFilter}`,
);
assert.ok(
  firstPreviewFilter.includes('min(96,ih)'),
  `Expected preview filter to use max dimension 96, got ${firstPreviewFilter}`,
);
assert.deepEqual(
  GIF_ENCODING_PROFILES.map(profile => profile.fps),
  [24, 20, 18, 15, 15, 12, 10, 8, 6, 5],
  'WebM GIF profiles must retain their baseline FPS values',
);
assert.deepEqual(
  TGS_GIF_ENCODING_PROFILES.map(profile => profile.fps),
  [20, 20, 20, 10, 10, 10, 10, 5, 5, 5],
  'TGS GIF profiles must use timing-safe FPS values',
);
for (const profile of TGS_GIF_ENCODING_PROFILES) {
  assert.equal(
    100 % profile.fps,
    0,
    `TGS FPS ${profile.fps} must divide GIF's 100 Hz delay base`,
  );
  assert.equal(
    60 % profile.fps,
    0,
    `TGS FPS ${profile.fps} must divide Telegram's 60 FPS source`,
  );
}

const firstWebmProfile = GIF_ENCODING_PROFILES[0];
assert.equal(firstWebmProfile.maxDimension, 160);
const firstWebmFilter = buildFfmpegFilter(firstWebmProfile);
assert.ok(
  firstWebmFilter.includes('min(160,iw)'),
  `Expected WebM filter to use scaled max dimension 160, got ${firstWebmFilter}`,
);
assert.ok(
  firstWebmFilter.includes('min(160,ih)'),
  `Expected WebM filter to use scaled max dimension 160, got ${firstWebmFilter}`,
);

// Test 0.9: Concurrency configuration parser
console.log('Testing parseDownloadConcurrency...');
assert.equal(parseDownloadConcurrency(undefined), 5);
assert.equal(parseDownloadConcurrency(''), 5);
assert.equal(parseDownloadConcurrency('1'), 1);
assert.equal(parseDownloadConcurrency('2'), 2);
assert.equal(parseDownloadConcurrency('20'), 20);

assert.throws(
  () => parseDownloadConcurrency('0'),
  /CONCURRENCY must be a positive integer/,
);
assert.throws(
  () => parseDownloadConcurrency('-1'),
  /CONCURRENCY must be a positive integer/,
);
assert.throws(
  () => parseDownloadConcurrency('abc'),
  /CONCURRENCY must be a positive integer/,
);
assert.throws(
  () => parseDownloadConcurrency('2.5'),
  /CONCURRENCY must be a positive integer/,
);
assert.throws(
  () => parseDownloadConcurrency('Infinity'),
  /CONCURRENCY must be a positive integer/,
);
assert.throws(
  () => parseDownloadConcurrency('NaN'),
  /CONCURRENCY must be a positive integer/,
);
console.log(
  'Verified: parseDownloadConcurrency correctly validates environment values',
);

// Test 1: Unit Tests for getStickerMediaInfo
console.log('Testing getStickerMediaInfo...');

// Case A: normal video sticker (is_video = true, source = webm)
const infoA = getStickerMediaInfo(
  {
    file_id: '1',
    file_unique_id: '1',
    is_video: true,
    is_animated: false,
    emoji: '😀',
    width: 512,
    height: 512,
    type: 'regular',
  },
  'webm',
);
assert.equal(infoA.isVideoSticker, true, 'Case A: isVideoSticker must be true');
assert.equal(infoA.outputFileType, 'gif', 'Case A: outputFileType must be gif');
assert.equal(infoA.isAnimated, true, 'Case A: isAnimated must be true');

// Case B: fallback when is_video = false but source extension is webm
const infoB = getStickerMediaInfo(
  {
    file_id: '2',
    file_unique_id: '2',
    is_video: false,
    is_animated: false,
    emoji: '😀',
    width: 512,
    height: 512,
    type: 'regular',
  },
  'webm',
);
assert.equal(
  infoB.isVideoSticker,
  true,
  'Case B: isVideoSticker must be true for .webm fallback',
);
assert.equal(
  infoB.outputFileType,
  'gif',
  'Case B: outputFileType must be gif for .webm fallback',
);
assert.equal(
  infoB.isAnimated,
  true,
  'Case B: isAnimated must be true for .webm fallback',
);

// Case C: static WebP (is_video = false, is_animated = false, source = webp)
const infoC = getStickerMediaInfo(
  {
    file_id: '3',
    file_unique_id: '3',
    is_video: false,
    is_animated: false,
    emoji: '🐱',
    width: 512,
    height: 512,
    type: 'regular',
  },
  'webp',
);
assert.equal(
  infoC.isVideoSticker,
  false,
  'Case C: isVideoSticker must be false for webp',
);
assert.equal(
  infoC.outputFileType,
  'webp',
  'Case C: outputFileType must be webp',
);
assert.equal(
  infoC.isAnimated,
  false,
  'Case C: isAnimated must be false for static webp',
);

// Case D: animated TGS (is_video = false, is_animated = true, source = tgs)
const infoD = getStickerMediaInfo(
  {
    file_id: '4',
    file_unique_id: '4',
    is_video: false,
    is_animated: true,
    emoji: '🎉',
    width: 512,
    height: 512,
    type: 'regular',
  },
  'tgs',
);
assert.equal(
  infoD.isVideoSticker,
  false,
  'Case D: isVideoSticker must be false for tgs',
);
assert.equal(infoD.isTgsSticker, true, 'Case D: isTgsSticker must be true');
assert.equal(infoD.outputFileType, 'gif', 'Case D: outputFileType must be gif');
assert.equal(infoD.isAnimated, true, 'Case D: isAnimated must be true for tgs');

// Case E: fallback when is_animated = false but source extension is tgs
const infoE = getStickerMediaInfo(
  {
    file_id: '5',
    file_unique_id: '5',
    is_video: false,
    is_animated: false,
    emoji: '🎉',
    width: 512,
    height: 512,
    type: 'regular',
  },
  'tgs',
);
assert.equal(
  infoE.isTgsSticker,
  true,
  'Case E: isTgsSticker must be true for .tgs fallback',
);
assert.equal(
  infoE.outputFileType,
  'gif',
  'Case E: outputFileType must be gif for .tgs fallback',
);
assert.equal(
  infoE.isAnimated,
  true,
  'Case E: isAnimated must be true for .tgs fallback',
);

console.log(
  'Verified: getStickerMediaInfo handles video, fallback webm, static webp, and tgs correctly',
);

// Test 1.5: manifest outputs final animated assets and omits static readiness
console.log('Testing Telegram manifest media contract...');
const manifestPackName = 'ManifestTestPack';
const manifestFileTypes: Record<string, string> = {
  manifest_webm: 'webm',
  manifest_tgs: 'tgs',
  manifest_webp: 'webp',
};
const manifestTelegram = {
  getFile: async (fileId: string) => ({
    file_id: fileId,
    file_path: `stickers/${fileId}.${manifestFileTypes[fileId]}`,
  }),
} as unknown as Telegram;
const manifestStickerSet = {
  name: manifestPackName,
  title: 'Manifest test',
  stickers: [
    {
      file_id: 'manifest_webm',
      file_unique_id: 'webm-id',
      is_video: true,
      is_animated: false,
      width: 512,
      height: 512,
      type: 'regular',
    },
    {
      file_id: 'manifest_tgs',
      file_unique_id: 'tgs-id',
      is_video: false,
      is_animated: true,
      emoji: '🎊',
      width: 512,
      height: 512,
      type: 'regular',
    },
    {
      file_id: 'manifest_webp',
      file_unique_id: 'webp-id',
      is_video: false,
      is_animated: false,
      emoji: '🐱',
      width: 512,
      height: 512,
      type: 'regular',
    },
  ],
} as Parameters<typeof toMcStickerPack>[1];
const manifest = await toMcStickerPack(manifestTelegram, manifestStickerSet);
const [manifestWebm, manifestTgs, manifestWebp] = manifest.stickers;

// No-emoji fallback and logo test
assert.equal(
  manifestWebm.title,
  '',
  'Sticker without emoji must use an empty string title',
);
assert.equal(typeof manifestWebm.title, 'string');
assert.equal(
  manifest.logo.title,
  '',
  'Logo sticker without emoji must use an empty string title',
);

// Normal emoji preserved
assert.equal(
  manifestTgs.title,
  '🎊',
  'Sticker with emoji must preserve its emoji title',
);
assert.equal(
  manifestWebp.title,
  '🐱',
  'Sticker with emoji must preserve its emoji title',
);

// Serialized JSON manifest test
const serializedManifest = JSON.parse(JSON.stringify(manifest));
assert.equal(
  serializedManifest.stickers[0].title,
  '',
  'Serialized sticker without emoji must have empty string title',
);
assert.equal(
  Object.hasOwn(serializedManifest.stickers[0], 'title'),
  true,
  'Serialized sticker must contain title property',
);
assert.equal(
  serializedManifest.logo.title,
  '',
  'Serialized logo without emoji must have empty string title',
);
assert.equal(
  Object.hasOwn(serializedManifest.logo, 'title'),
  true,
  'Serialized logo must contain title property',
);
assert.equal(
  serializedManifest.stickers[1].title,
  '🎊',
  'Serialized sticker with emoji must preserve title',
);

for (const sticker of [manifestWebm, manifestTgs]) {
  assert.ok(sticker.filename?.endsWith('.gif'));
  assert.equal(sticker.filename?.includes('-160'), false);
  assert.ok(sticker.image.includes(`/${manifest.dynamic?.version}/`));
  assert.ok(sticker.image.endsWith('.gif'));
  assert.equal(sticker.isAnimated, true);
  assert.equal(sticker.readyToUpload, true);
}
for (const sticker of [manifestWebm, manifestTgs, manifestWebp]) {
  assert.ok(
    sticker.previewImage?.endsWith('.webp'),
    `Sticker previewImage must end in .webp, got ${sticker.previewImage}`,
  );
  assert.ok(
    sticker.previewImage?.includes('/preview/telegram/'),
    `Sticker previewImage must include /preview/telegram/, got ${sticker.previewImage}`,
  );
}
assert.equal(
  manifest.logo.previewImage,
  manifest.stickers[0].previewImage,
  'Logo previewImage must equal first sticker previewImage',
);
assert.equal(
  typeof serializedManifest.stickers[0].previewImage,
  'string',
  'Serialized sticker previewImage must be a string',
);
assert.ok(
  serializedManifest.stickers[0].previewImage.endsWith('.webp'),
  'Serialized sticker previewImage must end with .webp',
);
assert.equal(
  typeof serializedManifest.logo.previewImage,
  'string',
  'Serialized logo previewImage must be a string',
);
assert.ok(
  serializedManifest.logo.previewImage.endsWith('.webp'),
  'Serialized logo previewImage must end with .webp',
);
assert.equal(
  manifestWebm.id,
  `MoreStickers:Telegram:Sticker:${manifestPackName}:webm-id`,
);
assert.equal(
  manifestTgs.id,
  `MoreStickers:Telegram:Sticker:${manifestPackName}:tgs-id`,
);
assert.ok(manifestWebp.filename?.endsWith('.webp'));
assert.ok(manifestWebp.image.endsWith('.webp'));
assert.equal(manifestWebp.isAnimated, false);
assert.equal(Object.hasOwn(manifestWebp, 'readyToUpload'), false);

// dynamic contract: numeric version + refreshUrl on every generated manifest
assert.ok(manifest.dynamic, 'Generated manifest must contain dynamic block');
assert.equal(
  manifest.dynamic.version,
  1,
  `First generation must produce version 1, got ${manifest.dynamic.version}`,
);
assert.equal(
  typeof manifest.dynamic.version,
  'number',
  'dynamic.version must be a JSON number, not a string',
);
assert.equal(
  Number.isSafeInteger(manifest.dynamic.version),
  true,
  'dynamic.version must be a safe integer',
);
assert.equal(
  manifest.dynamic.refreshUrl,
  `https://stickers.example.com/stickerpack/telegram/${manifestPackName}`,
  'refreshUrl must point at the public manifest endpoint of the same pack',
);
assert.equal(
  typeof serializedManifest.dynamic.version,
  'number',
  'Serialized dynamic.version must remain a number after JSON round-trip',
);
assert.equal(
  Object.hasOwn(serializedManifest, 'dynamic'),
  true,
  'Serialized manifest must contain the dynamic property',
);
console.log(
  'Verified: Telegram manifests expose final GIFs, static WebP, and WebP previews',
);

// Test 1.x: dynamic version lifecycle (resolveStickerPackVersion contract)
console.log('Testing dynamic version lifecycle...');
type TestMcSticker = {
  id: string;
  image: string;
  previewImage?: string;
  title: string;
  stickerPackId: string;
  filename?: string;
  isAnimated?: boolean;
  readyToUpload?: boolean;
};
const mkSticker = (uniqueId: string, emoji: string): TestMcSticker => ({
  id: `MoreStickers:Telegram:Sticker:VersionPack:${uniqueId}`,
  image: `https://stickers.example.com/sticker/telegram/VersionPack/${uniqueId}.gif`,
  title: emoji,
  stickerPackId: 'MoreStickers:Telegram:Pack:VersionPack',
});
const [stickerA, stickerB, stickerC, stickerD] = [
  mkSticker('aaa', 'emoji-a'),
  mkSticker('bbb', 'emoji-b'),
  mkSticker('ccc', 'emoji-c'),
  mkSticker('ddd', 'emoji-d'),
] as const;

const versionedPrevious = (
  stickers: Parameters<typeof getStickerContentSignature>[0],
  version: number,
) => ({
  id: 'MoreStickers:Telegram:Pack:VersionPack',
  title: 'Some pack title',
  logo: stickers[0],
  stickers,
  dynamic: {
    version,
    refreshUrl: 'https://old.example.com/stickerpack/telegram/VersionPack',
  },
});

// Test 1 - first generation (no previous manifest)
assert.equal(resolveStickerPackVersion(undefined, [stickerA]), 1);
// Test 2 - identical regeneration keeps version
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA], 7), [stickerA]),
  7,
);
// Test 3 - pack title change does not affect version (title lives on pack)
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA], 4), [stickerA]),
  4,
);
// Test 4 - technical URL changes (image, preview, refreshUrl) do not affect version
const technicalChangedPrevious = {
  ...versionedPrevious([stickerA], 5),
  dynamic: {
    version: 5,
    refreshUrl:
      'https://newdomain.example.com/stickerpack/telegram/VersionPack',
  },
  stickers: [
    {
      ...stickerA,
      image:
        'https://newdomain.example.com/sticker/telegram/VersionPack/aaa.gif',
      previewImage:
        'https://newdomain.example.com/preview/telegram/VersionPack/aaa.webp',
    },
  ],
};
assert.equal(
  resolveStickerPackVersion(technicalChangedPrevious, [stickerA]),
  5,
);
// Test 5 - emoji/title change increments
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA], 3), [
    {...stickerA, title: 'emoji-changed'},
  ]),
  4,
);
// Test 6 - file_unique_id replacement (different id) increments
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA], 2), [
    mkSticker('xyz', 'emoji-a'),
  ]),
  3,
);
// Test 7 - add sticker increments
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA], 2), [
    stickerA,
    stickerB,
  ]),
  3,
);
// Test 8 - remove sticker increments
assert.equal(
  resolveStickerPackVersion(versionedPrevious([stickerA, stickerB], 2), [
    stickerA,
  ]),
  3,
);
// Test 9 - reorder increments (signature preserves order)
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA, stickerB, stickerC], 2),
    [stickerB, stickerA, stickerC],
  ),
  3,
);
assert.notEqual(
  getStickerContentSignature([
    {id: 'a', title: '1'} as never,
    {id: 'b', title: '2'} as never,
  ]),
  getStickerContentSignature([
    {id: 'b', title: '2'} as never,
    {id: 'a', title: '1'} as never,
  ]),
  'Signature must distinguish order',
);
// Test 10 - after a change, same content again keeps the new version
const changed = [stickerA, stickerB, stickerD];
const afterChange = resolveStickerPackVersion(
  versionedPrevious([stickerA, stickerB, stickerC], 1),
  changed,
);
assert.equal(afterChange, 2);
assert.equal(
  resolveStickerPackVersion(versionedPrevious(changed, afterChange), changed),
  2,
);
// Test 11 - legacy manifest without dynamic migrates to version 1
assert.equal(
  resolveStickerPackVersion({id: 'x', stickers: [stickerA]}, [stickerA]),
  1,
);
assert.equal(
  resolveStickerPackVersion({id: 'x', dynamic: {}, stickers: [stickerA]}, [
    stickerA,
  ]),
  1,
  'Manifest with empty dynamic block (no version) migrates to version 1',
);
// Structural validation: null, primitive, array, corrupt root must throw
for (const invalidRoot of [
  null,
  'invalid-string',
  123,
  true,
  [],
  ['not-an-object'],
]) {
  assert.throws(
    () => resolveStickerPackVersion(invalidRoot, [stickerA]),
    /invalid root structure|refusing/,
    `Invalid root ${String(invalidRoot)} must be rejected`,
  );
}

// Dynamic field validation: non-object or null or array must throw
for (const invalidDynamic of [null, 'invalid', 123, true, []]) {
  assert.throws(
    () =>
      resolveStickerPackVersion(
        {dynamic: invalidDynamic, stickers: [stickerA]},
        [stickerA],
      ),
    /invalid dynamic field|refusing/,
    `Invalid dynamic field ${String(invalidDynamic)} must be rejected`,
  );
}

// Unreadable stickers list or unreadable sticker entries must throw
assert.throws(
  () =>
    resolveStickerPackVersion(
      {dynamic: {version: 4, refreshUrl: 'u'}, stickers: []},
      [stickerA],
    ),
  /lacks a readable stickers\[\] list|refusing/,
);
assert.throws(
  () =>
    resolveStickerPackVersion(
      {dynamic: {version: 4, refreshUrl: 'u'}, stickers: [{}]},
      [stickerA],
    ),
  /unreadable sticker entries|refusing/,
);
assert.throws(
  () =>
    resolveStickerPackVersion(
      {
        dynamic: {version: 4, refreshUrl: 'u'},
        stickers: [{id: 123, title: 't'}],
      },
      [stickerA],
    ),
  /unreadable sticker entries|refusing/,
);
assert.throws(
  () =>
    resolveStickerPackVersion(
      {
        dynamic: {version: 4, refreshUrl: 'u'},
        stickers: [{id: 'id', title: 123}],
      },
      [stickerA],
    ),
  /unreadable sticker entries|refusing/,
);

// Test 13 - invalid declared versions are rejected, never silently reset
for (const bad of ['4', 0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () =>
      resolveStickerPackVersion(
        {
          dynamic: {
            version: bad,
            refreshUrl: 'u',
          },
          stickers: [stickerA],
        },
        [stickerA],
      ),
    /invalid dynamic\.version|refusing/,
    `Invalid version ${String(bad)} must be rejected`,
  );
}
// Version overflow guard
assert.throws(
  () =>
    resolveStickerPackVersion(
      versionedPrevious([stickerA], Number.MAX_SAFE_INTEGER),
      [stickerB],
    ),
  /overflow/,
);
// refreshUrl helper uses encodeURIComponent and manifest endpoint
assert.equal(
  generateStickerPackExternalUrl('plain_pack'),
  'https://stickers.example.com/stickerpack/telegram/plain_pack',
);

// Test 14 - atomic write + serialized per-pack publishing
console.log('Testing atomic manifest write and per-pack serialization...');
const atomicPackName = 'AtomicWriteTestPack';
const atomicManifestPath = generateStickerPackFilePath(atomicPackName);
await writeStickerPackManifestAtomically(atomicManifestPath, {
  id: `MoreStickers:Telegram:Pack:${atomicPackName}`,
  title: 'atomic',
  logo: stickerA as never,
  stickers: [stickerA as never],
  dynamic: {
    version: 3,
    refreshUrl: generateStickerPackExternalUrl(atomicPackName),
  },
} as never);
const storedAtomic = JSON.parse(await fsp.readFile(atomicManifestPath, 'utf8'));
assert.equal(storedAtomic.dynamic.version, 3);
assert.equal(
  storedAtomic.dynamic.refreshUrl.includes('/stickerpack/telegram/'),
  true,
);
const leftoverTempFiles = (
  await fsp.readdir(path.dirname(atomicManifestPath))
).filter(f => f.endsWith('.tmp'));
assert.equal(leftoverTempFiles.length, 0, 'No .tmp leftovers may remain');

// Test FIFO concurrency on enqueueManifestPublish
const events: string[] = [];
const first = enqueueManifestPublish('QueueTestPack', async () => {
  events.push('first:start');
  await new Promise<void>(resolve => setTimeout(resolve, 25));
  events.push('first:end');
});
const second = enqueueManifestPublish('QueueTestPack', async () => {
  events.push('second:start');
  events.push('second:end');
});
await Promise.all([first, second]);
assert.deepEqual(
  events,
  ['first:start', 'first:end', 'second:start', 'second:end'],
  'Queue must execute concurrent requests strictly in FIFO order',
);

// Test Queue failure handling: first job rejects, next job runs without poisoning
let nextExecuted = false;
const failed = enqueueManifestPublish('QueueFailurePack', async () => {
  throw new Error('expected queue test failure');
});
const next = enqueueManifestPublish('QueueFailurePack', async () => {
  nextExecuted = true;
});
await assert.rejects(
  failed,
  /expected queue test failure/,
  'Caller must receive the job rejection',
);
await next;
assert.equal(
  nextExecuted,
  true,
  'Next job after failure must execute successfully',
);

// Missing manifest returns undefined (ENOENT only)
assert.equal(
  await readManifestOrUndefined('NonExistentPackXYZ123'),
  undefined,
  'readManifestOrUndefined must return undefined for non-existent pack (ENOENT)',
);

// Malformed JSON manifest rejects and does not overwrite existing file
const malformedPackName = 'MalformedJsonManifestPack';
const malformedManifestPath = generateStickerPackFilePath(malformedPackName);
await fsp.mkdir(path.dirname(malformedManifestPath), {recursive: true});
await fsp.writeFile(
  malformedManifestPath,
  '{ definitely not valid JSON',
  'utf8',
);
await assert.rejects(
  async () => readManifestOrUndefined(malformedPackName),
  /malformed JSON/,
  'readManifestOrUndefined must reject on malformed JSON',
);
const malformedFileAfter = await fsp.readFile(malformedManifestPath, 'utf8');
assert.equal(
  malformedFileAfter,
  '{ definitely not valid JSON',
  'Malformed file must remain untouched',
);

// Non-ENOENT read error (manifest path is a directory) rejects
const dirPackName = 'DirManifestPack';
const dirManifestPath = generateStickerPackFilePath(dirPackName);
await fsp.mkdir(dirManifestPath, {recursive: true});
await assert.rejects(
  async () => readManifestOrUndefined(dirPackName),
  'Non-ENOENT filesystem error (EISDIR/EPERM) must reject and never return undefined',
);
await fsp.rmdir(dirManifestPath);

console.log(
  'Verified: dynamic version lifecycle, atomic writes, and queue serialization pass',
);

// Test 2: HTTP error retry and response body cancellation
console.log('Testing fetchStickerWithRetry...');

let failingAttempts = 0;
let bodyCancelCount = 0;
const mockFailingFetch = async () => {
  failingAttempts++;
  return {
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    body: {
      cancel: async () => {
        bodyCancelCount++;
      },
    },
  } as unknown as Response;
};

await assert.rejects(
  async () => {
    await fetchStickerWithRetry(
      'https://example.com/fail',
      'sticker_unique_fail',
      3,
      mockFailingFetch as unknown as typeof fetch,
    );
  },
  err => {
    assert.ok(err instanceof Error);
    assert.ok(
      err.message.includes('sticker_unique_fail'),
      'Error must contain sticker unique ID',
    );
    assert.ok(
      err.message.includes('500'),
      'Error must contain HTTP status 500',
    );
    assert.ok(
      err.message.includes('Internal Server Error'),
      'Error must contain HTTP statusText',
    );
    return true;
  },
);
assert.equal(failingAttempts, 3, 'Must retry specified number of attempts');
assert.equal(bodyCancelCount, 3, 'Must cancel body on each failed attempt');

// Test retry recovery on second attempt
let recoveryAttempts = 0;
const mockRecoveringFetch = async () => {
  recoveryAttempts++;
  if (recoveryAttempts === 1) {
    return {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: {
        cancel: async () => {},
      },
    } as unknown as Response;
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: Readable.from(['valid-data']),
  } as unknown as Response;
};

const recoveryResponse = await fetchStickerWithRetry(
  'https://example.com/recover',
  'sticker_unique_recover',
  3,
  mockRecoveringFetch as unknown as typeof fetch,
);
assert.equal(recoveryResponse.ok, true, 'Must succeed when retry receives 200');
assert.equal(recoveryAttempts, 2, 'Must have made 2 attempts before success');
console.log(
  'Verified: fetchStickerWithRetry correctly retries, cancels bodies, and throws on failure',
);

// Test 3: Stream Pipeline Error Propagation
console.log('Testing stream error propagation in pipeline...');
const streamErrorDest = path.join(tempDir, 'stream_error_dest.tmp');
const failingReadable = new Readable({
  read() {
    this.destroy(new Error('Simulated network stream interruption'));
  },
});

await assert.rejects(
  async () => {
    await pipeline(failingReadable, fs.createWriteStream(streamErrorDest));
  },
  /Simulated network stream interruption/,
  'Expected pipeline to reject immediately when stream errors',
);
console.log('Verified: pipeline propagates stream errors correctly');

// Test 4: Generate WebM with VP9 + Alpha + Opaque Box and verify conversion
console.log('Generating test VP9 WebM with alpha transparency...');
const testWebmPath = path.join(tempDir, 'sample_alpha_sticker.webm');
const testGifPath = path.join(tempDir, 'sample_alpha_sticker.gif');

const genResult = spawnSync('ffmpeg', [
  '-f',
  'lavfi',
  '-i',
  'color=c=black@0.0:size=512x512:duration=2:rate=30,format=rgba,drawbox=x=100:y=100:w=200:h=200:color=red:t=fill:replace=1,format=yuva420p',
  '-c:v',
  'libvpx-vp9',
  '-auto-alt-ref',
  '0',
  '-pix_fmt',
  'yuva420p',
  testWebmPath,
  '-y',
]);
assert.equal(
  genResult.status,
  0,
  'Failed to generate test alpha WebM using FFmpeg',
);
assert.ok(fs.existsSync(testWebmPath), 'Test WebM file does not exist');

console.log('Testing convertWebmToGif with libvpx-vp9 input decoding...');
const conversionResult = await convertWebmToGif(testWebmPath, testGifPath);

console.log('Conversion result:', {
  outputPath: conversionResult.outputPath,
  sizeBytes: conversionResult.sizeBytes,
  profile: conversionResult.profile,
  profileIndex: conversionResult.profileIndex,
});

assert.ok(fs.existsSync(testGifPath), 'Output GIF file was not created');
assert.ok(
  conversionResult.sizeBytes <= GIF_TARGET_BYTES,
  `Output GIF size (${conversionResult.sizeBytes}) exceeds target (${GIF_TARGET_BYTES})`,
);
assert.ok(
  conversionResult.sizeBytes <= GIF_SAFE_HARD_LIMIT_BYTES,
  `Output GIF size (${conversionResult.sizeBytes}) exceeds safe limit (${GIF_SAFE_HARD_LIMIT_BYTES})`,
);

// Verify GIF properties with ffprobe
const probeResult = spawnSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=codec_name,width,height,nb_read_frames',
  '-count_frames',
  '-of',
  'json',
  testGifPath,
]);
assert.equal(probeResult.status, 0, 'ffprobe failed on generated GIF');
const probeData = JSON.parse(probeResult.stdout.toString('utf8'));
const stream = probeData.streams[0];
assert.equal(stream.codec_name, 'gif', 'Output file is not GIF codec');
const webmOutputWidth = Number(stream.width);
const webmOutputHeight = Number(stream.height);
assert.ok(
  webmOutputWidth <= conversionResult.profile.maxDimension,
  `WebM GIF width (${webmOutputWidth}) exceeds profile limit (${conversionResult.profile.maxDimension})`,
);
assert.ok(
  webmOutputHeight <= conversionResult.profile.maxDimension,
  `WebM GIF height (${webmOutputHeight}) exceeds profile limit (${conversionResult.profile.maxDimension})`,
);
assert.ok(
  conversionResult.profile.maxDimension <= 160,
  `WebM GIF profile limit (${conversionResult.profile.maxDimension}) exceeds 160 px`,
);
assert.ok(
  Number(stream.nb_read_frames) > 1,
  `GIF must be animated with multiple frames, got: ${stream.nb_read_frames}`,
);
// Verify Pixel (0,0) is Transparent (alpha = 0)
const transparentPixelResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  testGifPath,
  '-vf',
  'select=eq(n\\,0),format=rgba,crop=1:1:0:0',
  '-frames:v',
  '1',
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  'pipe:1',
]);
assert.equal(
  transparentPixelResult.status,
  0,
  'FFmpeg pixel extraction failed at (0,0)',
);
assert.equal(transparentPixelResult.stdout.length, 4, 'Expected 4 bytes RGBA');
assert.equal(
  transparentPixelResult.stdout[3],
  0,
  `Expected alpha = 0 at transparent corner (0,0), got ${transparentPixelResult.stdout[3]}`,
);

const centerX = Math.floor(webmOutputWidth / 2);
const centerY = Math.floor(webmOutputHeight / 2);
// Verify Pixel (centerX,centerY) is Opaque Red (alpha = 255)
const opaquePixelResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  testGifPath,
  '-vf',
  `select=eq(n\\,0),format=rgba,crop=1:1:${centerX}:${centerY}`,
  '-frames:v',
  '1',
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  'pipe:1',
]);
assert.equal(
  opaquePixelResult.status,
  0,
  `FFmpeg pixel extraction failed at (${centerX},${centerY})`,
);
assert.equal(opaquePixelResult.stdout.length, 4, 'Expected 4 bytes RGBA');
assert.equal(
  opaquePixelResult.stdout[3],
  255,
  `Expected alpha = 255 at opaque center (${centerX},${centerY}), got ${opaquePixelResult.stdout[3]}`,
);
console.log(
  `Verified GIF: codec=${stream.codec_name}, dimensions=${stream.width}x${stream.height}, frames=${stream.nb_read_frames}, transparent pixel alpha=0, opaque pixel alpha=255`,
);

// Verify no leftover candidate files exist
const tempFiles = await fsp.readdir(tempDir);
const candidateFiles = tempFiles.filter(f => f.includes('.candidate-'));
assert.equal(
  candidateFiles.length,
  0,
  `Candidate files were not cleaned up: ${candidateFiles.join(', ')}`,
);
console.log('Verified: candidate temporary files were properly cleaned up');

// Test 4.5: Real local TGS fixture through lottieconverter, when available.
const requireLottieConverter = process.env.REQUIRE_LOTTIECONVERTER === '1';
const lottieConverterProbe = spawnSync('lottieconverter', [], {
  stdio: 'ignore',
});
const lottieConverterError = lottieConverterProbe.error as
  | NodeJS.ErrnoException
  | undefined;
const lottieConverterUnavailable = lottieConverterError?.code === 'ENOENT';
if (lottieConverterUnavailable) {
  if (requireLottieConverter) {
    assert.fail(
      'lottieconverter is required for this test but was not found in PATH',
    );
  }
  console.log(
    'Skipped TGS integration test: lottieconverter is not available in this environment',
  );
} else {
  assert.equal(
    lottieConverterError,
    undefined,
    'lottieconverter probe must not fail before the integration test',
  );
  console.log('Testing real TGS to GIF conversion with lottieconverter...');
  const tgsIntegrationDir = await fsp.mkdtemp(path.join(tempDir, 'tgs-real-'));
  const inputTgsPath = path.join(tgsIntegrationDir, 'fixture.tgs');
  const outputTgsGifPath = path.join(tgsIntegrationDir, 'fixture.gif');
  const lottieJson = JSON.stringify({
    v: '5.7.4',
    fr: 60,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    nm: 'Smoke test square',
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'Square',
        sr: 1,
        ks: {
          o: {a: 0, k: 100},
          r: {a: 0, k: 0},
          p: {
            a: 1,
            k: [
              {
                i: {
                  x: [0.833, 0.833, 0.833],
                  y: [0.833, 0.833, 0.833],
                },
                o: {
                  x: [0.167, 0.167, 0.167],
                  y: [0.167, 0.167, 0.167],
                },
                t: 0,
                s: [128, 256, 0],
                e: [384, 256, 0],
              },
              {
                i: {
                  x: [0.833, 0.833, 0.833],
                  y: [0.833, 0.833, 0.833],
                },
                o: {
                  x: [0.167, 0.167, 0.167],
                  y: [0.167, 0.167, 0.167],
                },
                t: 30,
                s: [384, 256, 0],
                e: [128, 256, 0],
              },
              {t: 59, s: [128, 256, 0]},
            ],
          },
          a: {a: 0, k: [0, 0, 0]},
          s: {a: 0, k: [100, 100, 100]},
        },
        ao: 0,
        shapes: [
          {
            ty: 'rc',
            d: 1,
            s: {a: 0, k: [256, 256]},
            p: {a: 0, k: [0, 0]},
            r: {a: 0, k: 0},
            nm: 'Rectangle',
          },
          {
            ty: 'fl',
            c: {a: 0, k: [1, 0, 0, 1]},
            o: {a: 0, k: 100},
            r: 1,
            bm: 0,
            nm: 'Fill',
          },
          {
            ty: 'tr',
            p: {a: 0, k: [0, 0]},
            a: {a: 0, k: [0, 0]},
            s: {a: 0, k: [100, 100]},
            r: {a: 0, k: 0},
            o: {a: 0, k: 100},
            sk: {a: 0, k: 0},
            sa: {a: 0, k: 0},
            nm: 'Transform',
          },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  });
  const tgsData = gzipSync(Buffer.from(lottieJson));
  assert.ok(
    tgsData.length <= 64 * 1024,
    `Telegram TGS fixture must be <= 64 KB, got ${tgsData.length}`,
  );
  await fsp.writeFile(inputTgsPath, tgsData);
  console.log(
    'Testing normalized lottieconverter execution at 20, 10, 5 FPS using production helper...',
  );
  const normalizedInputPath = await prepareTgsForLottieConverter(inputTgsPath);

  const expectedNormalized = new Map([
    [20, {frames: 20, duration: 1}],
    [10, {frames: 10, duration: 1}],
    [5, {frames: 5, duration: 1}],
  ]);

  try {
    for (const fps of [20, 10, 5]) {
      const expected = expectedNormalized.get(fps);
      assert.ok(expected);
      const normOutPath = path.join(
        tgsIntegrationDir,
        `fixture-norm-${fps}.gif`,
      );
      const normConv = spawnSync(
        'lottieconverter',
        [
          normalizedInputPath,
          normOutPath,
          'gif',
          `${GIF_ENCODING_PROFILES[0].maxDimension}x${GIF_ENCODING_PROFILES[0].maxDimension}`,
          String(fps),
        ],
        {encoding: 'utf8'},
      );
      assert.equal(
        normConv.status,
        0,
        `lottieconverter failed for normalized ${fps} FPS`,
      );
      const probe = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-count_frames',
          '-show_entries',
          'stream=codec_name,width,height,nb_read_frames:format=duration',
          '-of',
          'json',
          normOutPath,
        ],
        {encoding: 'utf8'},
      );
      assert.equal(
        probe.status,
        0,
        `ffprobe failed for normalized ${fps} FPS GIF`,
      );
      const info = JSON.parse(probe.stdout);
      assert.equal(
        info.streams[0].codec_name,
        'gif',
        `Normalized ${fps} FPS output must use GIF codec`,
      );
      const normFrameCount = Number(info.streams[0].nb_read_frames);
      const normDuration = Number(info.format.duration);
      assert.equal(
        normFrameCount,
        expected.frames,
        `Normalized ${fps} FPS GIF must have ${expected.frames} frames, got ${normFrameCount}`,
      );
      assert.ok(
        Number.isFinite(normDuration),
        `Normalized ${fps} FPS duration must be finite`,
      );
      assert.ok(
        Math.abs(normDuration - expected.duration) <= 0.02,
        `Normalized ${fps} FPS GIF must preserve 1s duration, got ${normDuration}s`,
      );
    }
  } finally {
    await fsp.unlink(normalizedInputPath).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  const tgsResult = await convertTgsToGif(inputTgsPath, outputTgsGifPath);
  assert.ok(fs.existsSync(outputTgsGifPath), 'TGS output GIF must exist');
  assert.ok(
    tgsResult.sizeBytes <= GIF_SAFE_HARD_LIMIT_BYTES,
    'TGS output GIF must be within the safe size limit',
  );

  const tgsProbeResult = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=duration',
      '-of',
      'json',
      outputTgsGifPath,
    ],
    {encoding: 'utf8'},
  );
  assert.equal(tgsProbeResult.status, 0, 'ffprobe failed on TGS GIF');
  const tgsProbe = JSON.parse(tgsProbeResult.stdout);
  const tgsStream = tgsProbe.streams[0];
  const outputDuration = Number(tgsProbe.format.duration);
  assert.ok(
    Number.isFinite(outputDuration),
    `TGS GIF duration must be finite, got ${tgsProbe.format.duration}`,
  );
  assert.ok(
    Math.abs(outputDuration - 1) <= 0.02,
    `TGS GIF must preserve 1 second source duration, got ${outputDuration}s`,
  );
  assert.equal(tgsStream.codec_name, 'gif', 'TGS output must use GIF codec');
  const outputWidth = Number(tgsStream.width);
  const outputHeight = Number(tgsStream.height);
  assert.ok(outputWidth > 0, 'TGS GIF width must be positive');
  assert.ok(outputHeight > 0, 'TGS GIF height must be positive');
  assert.ok(
    outputWidth <= tgsResult.profile.maxDimension,
    `TGS GIF width (${outputWidth}) must be <= profile maxDimension (${tgsResult.profile.maxDimension})`,
  );
  assert.ok(
    outputHeight <= tgsResult.profile.maxDimension,
    `TGS GIF height (${outputHeight}) must be <= profile maxDimension (${tgsResult.profile.maxDimension})`,
  );
  assert.ok(
    Number(tgsStream.nb_read_frames) > 1,
    `TGS GIF must contain multiple frames, got ${tgsStream.nb_read_frames}`,
  );
  const frameCount = Number(tgsStream.nb_read_frames);
  assert.equal(
    frameCount,
    20,
    `Production adaptive TGS GIF must contain exactly 20 frames for 1s 20 FPS profile, got ${frameCount}`,
  );
  assert.equal(tgsResult.profileIndex, 0, 'Fixture must select profile 0');
  assert.equal(tgsResult.profile.fps, 20, 'Fixture must select 20 FPS profile');
  const firstFrameIndex = 0;
  const middleFrameIndex = Math.floor(frameCount / 2);
  const lastFrameIndex = frameCount - 1;
  const transparentX = outputWidth - 1;
  const transparentY = outputHeight - 1;
  const animationProbeX = Math.floor(outputWidth * 0.25);
  const animationProbeY = Math.floor(outputHeight * 0.5);
  const readGifPixelAlpha = (
    gifPath: string,
    frameIndex: number,
    x: number,
    y: number,
  ): number => {
    const result = spawnSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      gifPath,
      '-vf',
      `select=eq(n\\,${frameIndex}),format=rgba,crop=1:1:${x}:${y}`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]);
    assert.equal(
      result.status,
      0,
      `FFmpeg pixel extraction failed for GIF frame ${frameIndex}`,
    );
    assert.equal(
      result.stdout.length,
      4,
      `Expected one RGBA pixel from GIF frame ${frameIndex}`,
    );
    return result.stdout[3];
  };
  assert.equal(
    readGifPixelAlpha(
      outputTgsGifPath,
      firstFrameIndex,
      transparentX,
      transparentY,
    ),
    0,
    'TGS GIF background pixel must remain transparent',
  );
  assert.equal(
    readGifPixelAlpha(
      outputTgsGifPath,
      firstFrameIndex,
      animationProbeX,
      animationProbeY,
    ),
    255,
    'TGS GIF rectangle must be opaque at the start of the animation',
  );
  assert.equal(
    readGifPixelAlpha(
      outputTgsGifPath,
      middleFrameIndex,
      animationProbeX,
      animationProbeY,
    ),
    0,
    'TGS GIF rectangle must move away from the probe point',
  );
  assert.equal(
    readGifPixelAlpha(
      outputTgsGifPath,
      lastFrameIndex,
      animationProbeX,
      animationProbeY,
    ),
    255,
    'TGS GIF must return to the initial visual state for looping',
  );
  assert.deepEqual(
    (await fsp.readdir(tgsIntegrationDir)).filter(file =>
      file.includes('.candidate-'),
    ),
    [],
    'TGS candidate files must be cleaned up',
  );
  assert.deepEqual(
    (await fsp.readdir(tgsIntegrationDir)).filter(file =>
      file.includes('.lottieconverter-'),
    ),
    [],
    'Normalized temporary TGS files must be cleaned up',
  );
  console.log('Verified: lottieconverter produced a valid GIF from TGS');
}

// Test 5: Legacy Cache Invalidation
console.log('Testing legacy cache detection and invalidation...');
const legacyPackName = 'LegacyTestPack';
const legacyPackDir = generateStickerPackDirPath(legacyPackName);
const legacyPackFile = generateStickerPackFilePath(legacyPackName);

await fsp.mkdir(legacyPackDir, {recursive: true});
await fsp.writeFile(path.join(legacyPackDir, 'sticker1.webm'), 'dummy');
const legacyPackJson = {
  id: `MoreStickers:Telegram:Pack:${legacyPackName}`,
  title: 'Legacy Pack',
  logo: {
    id: `MoreStickers:Telegram:Sticker:${legacyPackName}:sticker1`,
    image: `https://stickers.example.com/sticker/telegram/${legacyPackName}/sticker1.webm`,
    title: '😀',
    stickerPackId: `MoreStickers:Telegram:Pack:${legacyPackName}`,
    filename: 'sticker1.webm',
    isAnimated: true,
  },
  stickers: [
    {
      id: `MoreStickers:Telegram:Sticker:${legacyPackName}:sticker1`,
      image: `https://stickers.example.com/sticker/telegram/${legacyPackName}/sticker1.webm`,
      title: '😀',
      stickerPackId: `MoreStickers:Telegram:Pack:${legacyPackName}`,
      filename: 'sticker1.webm',
      isAnimated: true,
    },
  ],
};
await fsp.writeFile(legacyPackFile, JSON.stringify(legacyPackJson));

assert.equal(
  await isLegacyStickerPack(legacyPackName),
  true,
  'isLegacyStickerPack should return true for pack with .webm filename/image',
);

const isDownloadedBefore = await isStickerPackDownloaded(legacyPackName);
assert.equal(
  isDownloadedBefore,
  false,
  'isStickerPackDownloaded should return false for legacy cache after invalidating it',
);

assert.equal(
  fs.existsSync(legacyPackDir),
  true,
  'Legacy sticker pack dir must remain until replacement publication',
);
assert.equal(
  fs.existsSync(legacyPackFile),
  true,
  'Legacy sticker pack manifest must remain until replacement publication',
);
console.log('Verified: legacy cache correctly detected and invalidated');

const additionalCacheCases = [
  {
    name: 'LegacyRawWebmNoFlag',
    sticker: {filename: 'sticker.webm'},
    expectedLegacy: true,
  },
  {
    name: 'LegacyRawTgsNoFlag',
    sticker: {filename: 'sticker.tgs'},
    expectedLegacy: true,
  },
  {
    name: 'AnimatedTgsWithReadyFlag',
    sticker: {
      filename: 'sticker.tgs',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedWebpWithReadyFlag',
    sticker: {
      filename: 'sticker.webp',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedPngWithReadyFlag',
    sticker: {
      filename: 'sticker.png',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedGifFilenameWithTgsImage',
    sticker: {
      filename: 'sticker.gif',
      image: 'https://example.test/sticker.tgs',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedTgsFilenameWithGifImage',
    sticker: {
      filename: 'sticker.tgs',
      image: 'https://example.test/sticker.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedGifFilenameWithWebpImage',
    sticker: {
      filename: 'sticker.gif',
      image: 'https://example.test/sticker.webp',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: true,
  },
  {
    name: 'AnimatedUpperGifWithReadyFlag',
    sticker: {
      filename: 'sticker.GIF',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: false,
  },
  {
    name: 'StaticWebpPack',
    sticker: {filename: 'sticker.webp', isAnimated: false},
    expectedLegacy: false,
  },
  {
    name: 'LegacyGifPack',
    sticker: {
      filename: 'sticker.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: false,
  },
  {
    name: 'ReadyGifPack',
    sticker: {
      filename: 'sticker.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: false,
  },
  {
    name: 'SizedGifPack',
    sticker: {
      filename: 'sticker-160.gif',
      image: 'https://example.test/sticker-160.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    expectedLegacy: false,
  },
];
for (const cacheCase of additionalCacheCases) {
  await fsp.writeFile(
    generateStickerPackFilePath(cacheCase.name),
    JSON.stringify({stickers: [cacheCase.sticker]}),
  );
  assert.equal(
    await isLegacyStickerPack(cacheCase.name),
    cacheCase.expectedLegacy,
    `${cacheCase.name} legacy state must match the manifest contract`,
  );
}

// Test Logo Invariant Cases
const logoCacheCases = [
  {
    name: 'LegacyTgsLogoModernStickersPack',
    pack: {
      logo: {
        filename: 'logo.tgs',
        image: 'https://example.test/logo.tgs',
        isAnimated: true,
        readyToUpload: true,
      },
      stickers: [
        {
          filename: 'sticker.gif',
          image: 'https://example.test/sticker.gif',
          isAnimated: true,
          readyToUpload: true,
        },
      ],
    },
    expectedLegacy: true,
  },
  {
    name: 'RawTgsLogoModernStickersPack',
    pack: {
      logo: {
        filename: 'logo.tgs',
      },
      stickers: [
        {
          filename: 'sticker.gif',
          image: 'https://example.test/sticker.gif',
          isAnimated: true,
          readyToUpload: true,
        },
      ],
    },
    expectedLegacy: true,
  },
  {
    name: 'ModernLogoModernStickersPack',
    pack: {
      logo: {
        filename: 'logo.gif',
        image:
          'https://example.test/sticker/telegram/ModernLogoModernStickersPack/1/logo.gif',
        isAnimated: true,
        readyToUpload: true,
      },
      stickers: [
        {
          filename: 'sticker.gif',
          image:
            'https://example.test/sticker/telegram/ModernLogoModernStickersPack/1/sticker.gif',
          isAnimated: true,
          readyToUpload: true,
        },
      ],
    },
    expectedLegacy: false,
  },
];
for (const logoCase of logoCacheCases) {
  await fsp.writeFile(
    generateStickerPackFilePath(logoCase.name),
    JSON.stringify(logoCase.pack),
  );
  assert.equal(
    await isLegacyStickerPack(logoCase.name),
    logoCase.expectedLegacy,
    `${logoCase.name} logo legacy state must match expected ${logoCase.expectedLegacy}`,
  );
}
console.log(
  'Verified: legacy TGS, non-GIF, logo, and stale GIF manifests are invalidated',
);

const staleAnimatedTgsPackName = 'LegacyAnimatedTgsInvariantPack';
const staleAnimatedTgsPackDir = generateStickerPackDirPath(
  staleAnimatedTgsPackName,
);
const staleAnimatedTgsPackFile = generateStickerPackFilePath(
  staleAnimatedTgsPackName,
);
await fsp.mkdir(staleAnimatedTgsPackDir, {recursive: true});
await fsp.writeFile(path.join(staleAnimatedTgsPackDir, 'sticker.tgs'), 'dummy');
await fsp.writeFile(
  staleAnimatedTgsPackFile,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${staleAnimatedTgsPackName}`,
    title: 'Legacy Animated TGS Invariant Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${staleAnimatedTgsPackName}:sticker1`,
      image: `https://stickers.example.com/sticker/telegram/${staleAnimatedTgsPackName}/sticker1.tgs`,
      title: '😀',
      stickerPackId: `MoreStickers:Telegram:Pack:${staleAnimatedTgsPackName}`,
      filename: 'sticker.tgs',
      isAnimated: true,
      readyToUpload: true,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${staleAnimatedTgsPackName}:sticker1`,
        image: `https://stickers.example.com/sticker/telegram/${staleAnimatedTgsPackName}/sticker1.tgs`,
        title: '😀',
        stickerPackId: `MoreStickers:Telegram:Pack:${staleAnimatedTgsPackName}`,
        filename: 'sticker.tgs',
        isAnimated: true,
        readyToUpload: true,
      },
    ],
  }),
);
assert.equal(
  await isStickerPackDownloaded(staleAnimatedTgsPackName),
  false,
  'Animated TGS with readyToUpload:true must still invalidate the cache',
);
assert.equal(
  fs.existsSync(staleAnimatedTgsPackDir),
  true,
  'Legacy animated TGS directory must remain until regeneration succeeds',
);
assert.equal(
  fs.existsSync(staleAnimatedTgsPackFile),
  true,
  'Legacy animated TGS manifest must remain until regeneration succeeds',
);
console.log('Verified: stale animated TGS cache is invalidated');

const staleGifPackName = 'LegacyGifInvalidationPack';
const staleGifPackDir = generateStickerPackDirPath(staleGifPackName);
const staleGifPackFile = generateStickerPackFilePath(staleGifPackName);
await fsp.mkdir(staleGifPackDir, {recursive: true});
await fsp.writeFile(path.join(staleGifPackDir, 'sticker.gif'), 'dummy');
await fsp.writeFile(
  staleGifPackFile,
  JSON.stringify({
    stickers: [{filename: 'sticker.gif', isAnimated: true}],
  }),
);
assert.equal(
  await isStickerPackDownloaded(staleGifPackName),
  false,
  'Animated GIF without readyToUpload must invalidate the cache',
);
assert.equal(
  fs.existsSync(staleGifPackDir),
  true,
  'Stale animated GIF directory must remain until regeneration succeeds',
);
assert.equal(
  fs.existsSync(staleGifPackFile),
  true,
  'Stale animated GIF manifest must remain until regeneration succeeds',
);
console.log('Verified: stale animated GIF cache is invalidated');
// Test 6: Modern Pack Cache (WebP / GIF)
console.log('Testing modern pack cache...');
const modernPackName = 'ModernTestPack';
const modernPackDir = generateStickerPackDirPath(modernPackName);
const modernPackFile = generateStickerPackFilePath(modernPackName);

await fsp.mkdir(modernPackDir, {recursive: true});
await fsp.writeFile(path.join(modernPackDir, 'sticker1.gif'), 'dummy');
await fsp.writeFile(path.join(modernPackDir, 'sticker2.webp'), 'dummy');

const modernPackJson = {
  id: `MoreStickers:Telegram:Pack:${modernPackName}`,
  title: 'Modern Pack',
  logo: {
    id: `MoreStickers:Telegram:Sticker:${modernPackName}:sticker1`,
    image: `https://stickers.example.com/sticker/telegram/${modernPackName}/sticker1.gif`,
    title: '😀',
    stickerPackId: `MoreStickers:Telegram:Pack:${modernPackName}`,
    filename: 'sticker1.gif',
    isAnimated: true,
    readyToUpload: true,
  },
  stickers: [
    {
      id: `MoreStickers:Telegram:Sticker:${modernPackName}:sticker1`,
      image: `https://stickers.example.com/sticker/telegram/${modernPackName}/sticker1.gif`,
      title: '😀',
      stickerPackId: `MoreStickers:Telegram:Pack:${modernPackName}`,
      filename: 'sticker1.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    {
      id: `MoreStickers:Telegram:Sticker:${modernPackName}:sticker2`,
      image: `https://stickers.example.com/sticker/telegram/${modernPackName}/sticker2.webp`,
      title: '🐱',
      stickerPackId: `MoreStickers:Telegram:Pack:${modernPackName}`,
      filename: 'sticker2.webp',
      isAnimated: false,
    },
  ],
};
await fsp.writeFile(modernPackFile, JSON.stringify(modernPackJson));

assert.equal(
  await isLegacyStickerPack(modernPackName),
  false,
  'isLegacyStickerPack should return false for modern pack',
);
assert.equal(
  await isStickerPackDownloaded(modernPackName),
  true,
  'isStickerPackDownloaded should return true for valid modern pack',
);
assert.ok(
  fs.existsSync(modernPackDir),
  'Modern pack dir should NOT be removed',
);
assert.ok(
  fs.existsSync(modernPackFile),
  'Modern pack file should NOT be removed',
);
console.log('Verified: modern pack cache preserved');

console.log('Testing content-addressed sticker storage lifecycle...');
assert.equal(STICKER_PACK_VERSION_RETENTION, 5);
assert.equal(STICKER_STORAGE_GC_INTERVAL_MS, 5 * 60 * 60 * 1000);
const storagePackName = 'VersionedStoragePack';
const storagePackDir = generateStickerPackDirPath(storagePackName);
await fsp.mkdir(storagePackDir, {recursive: true});
const storageSourceA = path.join(storagePackDir, 'source-a.gif');
const storageSourceADuplicate = path.join(
  storagePackDir,
  'source-a-duplicate.gif',
);
const storageSourceBOld = path.join(storagePackDir, 'source-b-old.gif');
const storageSourceBNew = path.join(storagePackDir, 'source-b-new.gif');
const orphanSource = path.join(storagePackDir, 'orphan.gif');
await fsp.writeFile(storageSourceA, 'asset-a');
await fsp.writeFile(storageSourceADuplicate, 'asset-a');
await fsp.writeFile(storageSourceBOld, 'asset-b-old');
await fsp.writeFile(storageSourceBNew, 'asset-b-new');
await fsp.writeFile(orphanSource, 'orphan');
const assetA = await storeStickerAsset(storagePackName, storageSourceA);
const duplicateAssetA = await storeStickerAsset(
  storagePackName,
  storageSourceADuplicate,
);
const assetBOld = await storeStickerAsset(storagePackName, storageSourceBOld);
const assetBNew = await storeStickerAsset(storagePackName, storageSourceBNew);
const orphanAsset = await storeStickerAsset(storagePackName, orphanSource);
assert.equal(assetA, duplicateAssetA, 'Identical bytes must reuse one hash');
await fsp.writeFile(
  path.join(generateStickerAssetsDirPath(storagePackName), assetA),
  'corrupted',
);
assert.equal(
  await storeStickerAsset(storagePackName, storageSourceA),
  assetA,
  'Re-storing known bytes must repair a corrupted hash-named asset',
);
assert.equal(
  await fsp.readFile(
    path.join(generateStickerAssetsDirPath(storagePackName), assetA),
    'utf8',
  ),
  'asset-a',
);
for (let version = 1; version <= 6; version++) {
  const bAsset = version === 6 ? assetBNew : assetBOld;
  await writeStickerVersionIndexAtomically(storagePackName, {
    version,
    signature: `signature-${version}`,
    stickers: {'A.gif': assetA, 'B.gif': bAsset},
    previews: {},
  });
}
await fsp.writeFile(
  generateStickerPackFilePath(storagePackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${storagePackName}`,
    stickers: [],
    dynamic: {version: 6},
  }),
);
await assert.rejects(
  writeStickerVersionIndexAtomically(storagePackName, {
    version: 6,
    signature: 'replacement',
    stickers: {'A.gif': assetBNew},
    previews: {},
  }),
  /Refusing to replace immutable sticker version/,
);
await garbageCollectStickerAssets();
assert.deepEqual(
  await listStickerPackVersions(storagePackName),
  [2, 3, 4, 5, 6],
  'Only five newest pack versions must remain',
);
assert.equal(
  path.basename(
    (await resolveStickerAssetPath(storagePackName, 2, 'A.gif', 'stickers'))!,
  ),
  assetA,
);
assert.equal(
  path.basename(
    (await resolveStickerAssetPath(storagePackName, 6, 'B.gif', 'stickers'))!,
  ),
  assetBNew,
  'Changed sticker bytes must resolve to a new content hash',
);
assert.equal(
  fs.existsSync(
    path.join(generateStickerAssetsDirPath(storagePackName), assetA),
  ),
  true,
  'Asset shared by retained versions must survive GC',
);
assert.equal(
  fs.existsSync(
    path.join(generateStickerAssetsDirPath(storagePackName), assetBOld),
  ),
  true,
  'Old asset must survive while any retained version references it',
);
assert.equal(
  fs.existsSync(
    path.join(generateStickerAssetsDirPath(storagePackName), orphanAsset),
  ),
  false,
  'Unreferenced content-addressed asset must be collected',
);
assert.equal(
  (await fsp.readdir(generateStickerAssetsDirPath(storagePackName))).length,
  3,
  'Two versions with one changed sticker must store three unique assets',
);

console.log('Testing pending versions do not evict published history...');
const pendingRetentionPackName = 'PendingRetentionPack';
const pendingRetentionPackDir = generateStickerPackDirPath(
  pendingRetentionPackName,
);
await fsp.mkdir(pendingRetentionPackDir, {recursive: true});
const publishedRetentionSource = path.join(
  pendingRetentionPackDir,
  'published.gif',
);
const pendingRetentionSource = path.join(
  pendingRetentionPackDir,
  'pending.gif',
);
const ghostRetentionSource = path.join(pendingRetentionPackDir, 'ghost.gif');
await fsp.writeFile(publishedRetentionSource, 'published-history-asset');
await fsp.writeFile(pendingRetentionSource, 'pending-recovery-asset');
await fsp.writeFile(ghostRetentionSource, 'ghost-version-asset');
const publishedRetentionAsset = await storeStickerAsset(
  pendingRetentionPackName,
  publishedRetentionSource,
);
const pendingRetentionAsset = await storeStickerAsset(
  pendingRetentionPackName,
  pendingRetentionSource,
);
const ghostRetentionAsset = await storeStickerAsset(
  pendingRetentionPackName,
  ghostRetentionSource,
);
for (let version = 6; version <= 13; version++) {
  const asset =
    version <= 10
      ? publishedRetentionAsset
      : version === 11
        ? pendingRetentionAsset
        : ghostRetentionAsset;
  await writeStickerVersionIndexAtomically(pendingRetentionPackName, {
    version,
    signature: `pending-retention-${version}`,
    stickers: {'A.gif': asset},
    previews: {},
  });
}
await fsp.writeFile(
  generateStickerPackFilePath(pendingRetentionPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${pendingRetentionPackName}`,
    stickers: [],
    dynamic: {version: 10},
  }),
);
assert.equal(
  await pruneOldStickerVersions(pendingRetentionPackName),
  2,
  'Immediate retention must remove only ghost indexes',
);
assert.deepEqual(
  await listStickerPackVersions(pendingRetentionPackName),
  [6, 7, 8, 9, 10, 11],
  'Pending recovery must not evict five published versions',
);
await garbageCollectStickerAssets();
assert.deepEqual(
  await listStickerPackVersions(pendingRetentionPackName),
  [6, 7, 8, 9, 10, 11],
);
assert.equal(
  fs.existsSync(
    path.join(
      generateStickerAssetsDirPath(pendingRetentionPackName),
      pendingRetentionAsset,
    ),
  ),
  true,
  'GC must mark assets referenced by the pending recovery index',
);
assert.equal(
  fs.existsSync(
    path.join(
      generateStickerAssetsDirPath(pendingRetentionPackName),
      ghostRetentionAsset,
    ),
  ),
  false,
  'Assets referenced only by removed ghost indexes must become collectible',
);
await fsp.writeFile(
  path.join(
    generateStickerAssetsDirPath(pendingRetentionPackName),
    pendingRetentionAsset,
  ),
  'corrupted-pending-recovery-asset',
);
await garbageCollectStickerAssets();
assert.deepEqual(
  await listStickerPackVersions(pendingRetentionPackName),
  [6, 7, 8, 9, 10],
  'A corrupt pending index must not be preserved as recovery state',
);
assert.equal(
  fs.existsSync(
    path.join(
      generateStickerAssetsDirPath(pendingRetentionPackName),
      publishedRetentionAsset,
    ),
  ),
  true,
  'Discarding corrupt pending state must preserve published history assets',
);

console.log('Testing corruption-safe retention and garbage collection...');
const corruptRetentionPackName = 'CorruptRetentionPack';
const corruptRetentionPackDir = generateStickerPackDirPath(
  corruptRetentionPackName,
);
await fsp.mkdir(corruptRetentionPackDir, {recursive: true});
const corruptRetentionAssets: string[] = [];
for (let version = 1; version <= 6; version++) {
  const sourcePath = path.join(
    corruptRetentionPackDir,
    `retention-${version}.gif`,
  );
  await fsp.writeFile(sourcePath, `retention-asset-${version}`);
  const asset = await storeStickerAsset(corruptRetentionPackName, sourcePath);
  corruptRetentionAssets.push(asset);
  await writeStickerVersionIndexAtomically(corruptRetentionPackName, {
    version,
    signature: `retention-${version}`,
    stickers: {'A.gif': asset},
    previews: {},
  });
}
await fsp.writeFile(
  generateStickerPackFilePath(corruptRetentionPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${corruptRetentionPackName}`,
    stickers: [],
    dynamic: {version: 6},
  }),
);
await fsp.writeFile(
  path.join(
    generateStickerAssetsDirPath(corruptRetentionPackName),
    corruptRetentionAssets[5],
  ),
  'corrupted-retained-asset',
);
const corruptVersionsDir = path.join(corruptRetentionPackDir, 'versions');
const corruptAssetsDir = generateStickerAssetsDirPath(corruptRetentionPackName);
const corruptVersionsBefore = (await fsp.readdir(corruptVersionsDir)).sort();
const corruptAssetsBefore = (await fsp.readdir(corruptAssetsDir)).sort();
const corruptVersionBytesBefore = await Promise.all(
  corruptVersionsBefore.map(filename =>
    fsp.readFile(path.join(corruptVersionsDir, filename)),
  ),
);
const corruptAssetBytesBefore = await Promise.all(
  corruptAssetsBefore.map(filename =>
    fsp.readFile(path.join(corruptAssetsDir, filename)),
  ),
);
assert.equal(
  await pruneOldStickerVersions(corruptRetentionPackName),
  0,
  'Immediate retention must skip a pack with corrupt retained storage',
);
await garbageCollectStickerAssets();
assert.deepEqual(
  (await fsp.readdir(corruptVersionsDir)).sort(),
  corruptVersionsBefore,
  'GC must not remove any version when a retained asset is corrupt',
);
assert.deepEqual(
  (await fsp.readdir(corruptAssetsDir)).sort(),
  corruptAssetsBefore,
  'GC must not remove any asset when a retained asset is corrupt',
);
assert.deepEqual(
  await Promise.all(
    corruptVersionsBefore.map(filename =>
      fsp.readFile(path.join(corruptVersionsDir, filename)),
    ),
  ),
  corruptVersionBytesBefore,
  'GC must preserve version indexes byte-for-byte on validation failure',
);
assert.deepEqual(
  await Promise.all(
    corruptAssetsBefore.map(filename =>
      fsp.readFile(path.join(corruptAssetsDir, filename)),
    ),
  ),
  corruptAssetBytesBefore,
  'GC must preserve assets byte-for-byte on validation failure',
);

console.log('Testing per-pack storage mutation serialization...');
const storageMutationEvents: string[] = [];
let markFirstStorageMutationStarted!: () => void;
let releaseFirstStorageMutation!: () => void;
const firstStorageMutationStarted = new Promise<void>(resolve => {
  markFirstStorageMutationStarted = resolve;
});
const firstStorageMutationGate = new Promise<void>(resolve => {
  releaseFirstStorageMutation = resolve;
});
const firstPackMutation = withStickerStorageMutation(
  'StorageQueuePackA',
  async () => {
    storageMutationEvents.push('A:first:start');
    markFirstStorageMutationStarted();
    await firstStorageMutationGate;
    storageMutationEvents.push('A:first:end');
  },
);
await firstStorageMutationStarted;
const secondPackMutation = withStickerStorageMutation(
  'StorageQueuePackA',
  async () => {
    storageMutationEvents.push('A:second');
  },
);
const independentPackMutation = withStickerStorageMutation(
  'StorageQueuePackB',
  async () => {
    storageMutationEvents.push('B');
  },
);
await new Promise<void>(resolve => setImmediate(resolve));
assert.deepEqual(
  storageMutationEvents,
  ['A:first:start', 'B'],
  'Different packs may mutate while the first pack is blocked',
);
releaseFirstStorageMutation();
await Promise.all([
  firstPackMutation,
  secondPackMutation,
  independentPackMutation,
]);
assert.deepEqual(
  storageMutationEvents,
  ['A:first:start', 'B', 'A:first:end', 'A:second'],
  'Mutations for the same pack must remain FIFO',
);

console.log('Testing idempotent legacy storage migration...');
const migrationPackName = 'LegacyStorageMigrationPack';
const migrationPackDir = generateStickerPackDirPath(migrationPackName);
const migrationPreviewDir = generateStickerPreviewDirPath(migrationPackName);
const migrationManifestPath = generateStickerPackFilePath(migrationPackName);
await fsp.mkdir(migrationPreviewDir, {recursive: true});
const migrationSourcePath = path.join(migrationPackDir, 'legacy-160.gif');
await fsp.writeFile(migrationSourcePath, 'legacy-gif-bytes');
await fsp.writeFile(
  path.join(migrationPreviewDir, 'legacy.webp'),
  'legacy-preview-bytes',
);
const migrationPack = {
  id: `MoreStickers:Telegram:Pack:${migrationPackName}`,
  title: 'Legacy Storage Migration Pack',
  logo: {
    id: `MoreStickers:Telegram:Sticker:${migrationPackName}:legacy`,
    image: `https://stickers.example.com/sticker/telegram/${migrationPackName}/legacy-160.gif`,
    previewImage: `https://stickers.example.com/preview/telegram/${migrationPackName}/legacy.webp`,
    title: '✨',
    stickerPackId: `MoreStickers:Telegram:Pack:${migrationPackName}`,
    filename: 'legacy-160.gif',
    isAnimated: true,
    readyToUpload: true,
  },
  stickers: [
    {
      id: `MoreStickers:Telegram:Sticker:${migrationPackName}:legacy`,
      image: `https://stickers.example.com/sticker/telegram/${migrationPackName}/legacy-160.gif`,
      previewImage: `https://stickers.example.com/preview/telegram/${migrationPackName}/legacy.webp`,
      title: '✨',
      stickerPackId: `MoreStickers:Telegram:Pack:${migrationPackName}`,
      filename: 'legacy-160.gif',
      isAnimated: true,
      readyToUpload: true,
    },
  ],
  dynamic: {
    version: 7,
    refreshUrl: generateStickerPackExternalUrl(migrationPackName),
  },
} as Parameters<typeof migrateLegacyStickerPack>[1];
await fsp.writeFile(migrationManifestPath, JSON.stringify(migrationPack));
const partiallyStoredAsset = await storeStickerAsset(
  migrationPackName,
  migrationSourcePath,
);
assert.equal(
  await migrateLegacyStickerPack(migrationPackName, migrationPack),
  true,
);
const migratedIndex = await readStickerVersionIndex(migrationPackName, 7);
assert.equal(migratedIndex?.stickers['legacy.gif'], partiallyStoredAsset);
assert.equal(
  migratedIndex?.stickers['legacy-160.gif'],
  undefined,
  'Version indexes must not contain legacy -160 aliases',
);
assert.ok(migratedIndex?.previews['legacy.webp']);
const migratedManifest = validateLocalStickerPackManifest(
  JSON.parse(await fsp.readFile(migrationManifestPath, 'utf8')),
);
assert.ok(migratedManifest);
assert.equal(migratedManifest.stickers[0].filename, 'legacy.gif');
assert.ok(migratedManifest.stickers[0].image.includes('/7/legacy.gif'));
assert.ok(
  migratedManifest.stickers[0].previewImage?.includes('/7/legacy.webp'),
);
assert.equal(fs.existsSync(migrationSourcePath), false);
assert.equal(
  await migrateLegacyStickerPack(migrationPackName, migratedManifest),
  false,
  'Second migration run must be a no-op',
);
assert.equal(
  await resolveStickerAssetPath(
    migrationPackName,
    7,
    'legacy-160.gif',
    'stickers',
  ),
  undefined,
  'Versioned lookup must not resolve legacy -160 aliases',
);
await fsp.writeFile(
  path.join(migrationPackDir, 'legacy.gif'),
  'leftover-working-copy',
);
await fsp.mkdir(migrationPreviewDir, {recursive: true});
await fsp.writeFile(
  path.join(migrationPreviewDir, 'legacy.webp'),
  'leftover-preview-copy',
);
assert.equal(
  await migrateLegacyStickerPack(migrationPackName, migratedManifest),
  false,
  'Interrupted post-manifest cleanup must resume idempotently',
);
assert.equal(fs.existsSync(path.join(migrationPackDir, 'legacy.gif')), false);
assert.equal(
  fs.existsSync(path.join(migrationPreviewDir, 'legacy.webp')),
  false,
);

console.log('Testing isolated legacy storage migration failures...');
async function writeLegacyGifMigrationFixture(
  fixturePackName: string,
): Promise<void> {
  const fixturePackDir = generateStickerPackDirPath(fixturePackName);
  const fixturePreviewDir = generateStickerPreviewDirPath(fixturePackName);
  await fsp.mkdir(fixturePreviewDir, {recursive: true});
  await fsp.writeFile(
    path.join(fixturePackDir, 'sticker-160.gif'),
    `gif-${fixturePackName}`,
  );
  await fsp.writeFile(
    path.join(fixturePreviewDir, 'sticker.webp'),
    `preview-${fixturePackName}`,
  );
  const fixtureSticker = {
    id: `MoreStickers:Telegram:Sticker:${fixturePackName}:sticker`,
    image: `https://stickers.example.com/sticker/telegram/${fixturePackName}/sticker-160.gif`,
    previewImage: `https://stickers.example.com/preview/telegram/${fixturePackName}/sticker.webp`,
    title: 'fixture',
    stickerPackId: `MoreStickers:Telegram:Pack:${fixturePackName}`,
    filename: 'sticker-160.gif',
    isAnimated: true,
    readyToUpload: true,
  };
  await fsp.writeFile(
    generateStickerPackFilePath(fixturePackName),
    JSON.stringify({
      id: `MoreStickers:Telegram:Pack:${fixturePackName}`,
      title: fixturePackName,
      logo: fixtureSticker,
      stickers: [fixtureSticker],
    }),
  );
}

const migrationGoodBefore = 'MigrationIsolationGoodBefore';
const migrationRawTgs = 'MigrationIsolationRawTgs';
const migrationGoodAfter = 'MigrationIsolationGoodAfter';
const migrationInvalid = 'MigrationIsolationInvalid';
await writeLegacyGifMigrationFixture(migrationGoodBefore);
const migrationRawDir = generateStickerPackDirPath(migrationRawTgs);
await fsp.mkdir(migrationRawDir, {recursive: true});
const migrationRawPath = path.join(migrationRawDir, 'raw.tgs');
const migrationRawBytes = Buffer.from('legacy-raw-tgs');
await fsp.writeFile(migrationRawPath, migrationRawBytes);
const migrationRawManifestPath = generateStickerPackFilePath(migrationRawTgs);
const migrationRawManifest = JSON.stringify({
  id: `MoreStickers:Telegram:Pack:${migrationRawTgs}`,
  title: migrationRawTgs,
  stickers: [
    {
      id: `MoreStickers:Telegram:Sticker:${migrationRawTgs}:raw`,
      image: `https://stickers.example.com/sticker/telegram/${migrationRawTgs}/raw.tgs`,
      title: 'raw',
      stickerPackId: `MoreStickers:Telegram:Pack:${migrationRawTgs}`,
      filename: 'raw.tgs',
      isAnimated: true,
    },
  ],
});
await fsp.writeFile(migrationRawManifestPath, migrationRawManifest);
await writeLegacyGifMigrationFixture(migrationGoodAfter);
const migrationInvalidDir = generateStickerPackDirPath(migrationInvalid);
await fsp.mkdir(migrationInvalidDir, {recursive: true});
const migrationInvalidSentinel = path.join(
  migrationInvalidDir,
  'preserve-me.bin',
);
await fsp.writeFile(migrationInvalidSentinel, 'preserve-invalid-pack');
const migrationInvalidManifestPath =
  generateStickerPackFilePath(migrationInvalid);
const migrationInvalidManifest = '{invalid-json';
await fsp.writeFile(migrationInvalidManifestPath, migrationInvalidManifest);

await migrateLegacyStickerStorage();
assert.ok(
  await readStickerVersionIndex(migrationGoodBefore, 1),
  'A valid pack before a failing pack must migrate',
);
assert.ok(
  await readStickerVersionIndex(migrationGoodAfter, 1),
  'A valid pack after a failing pack must still migrate',
);
assert.deepEqual(
  await fsp.readFile(migrationRawPath),
  migrationRawBytes,
  'Raw TGS bytes must remain untouched for later regeneration',
);
assert.equal(
  await fsp.readFile(migrationRawManifestPath, 'utf8'),
  migrationRawManifest,
  'Raw TGS manifest must remain untouched',
);
assert.equal(
  await fsp.readFile(migrationInvalidManifestPath, 'utf8'),
  migrationInvalidManifest,
  'Invalid manifest must remain untouched',
);
assert.equal(
  await fsp.readFile(migrationInvalidSentinel, 'utf8'),
  'preserve-invalid-pack',
  'Invalid pack files must remain untouched',
);

const startupEvents: string[] = [];
const startupGcTimer = await initializeTelegramStickerStorage(
  async () => {
    startupEvents.push('migration');
  },
  async () => {
    startupEvents.push('gc');
  },
);
clearInterval(startupGcTimer);
assert.deepEqual(startupEvents, ['migration', 'gc']);
assert.equal(startupGcTimer.hasRef(), false);
assert.equal(typeof migrateLegacyStickerStorage, 'function');
assert.equal(typeof scheduleStickerAssetGarbageCollection, 'function');
console.log(
  'Verified: deduplication, immutable indexes, retention, GC, migration, and startup ordering',
);

// Test 7: Fastify endpoint with GIF, manifests, and CORS
console.log('Testing Fastify endpoints and CORS...');
const packName = 'TestPackHttp';
const packDir = generateStickerPackDirPath(packName);
const manifestFilePath = generateStickerPackFilePath(packName);
await fsp.mkdir(packDir, {recursive: true});

const sampleGifDest = path.join(packDir, 'test_sticker.gif');
await fsp.copyFile(testGifPath, sampleGifDest);
await fsp.writeFile(
  manifestFilePath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${packName}`,
    title: 'Test Pack Http',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${packName}:test_sticker`,
        image: `https://stickers.example.com/sticker/telegram/${packName}/test_sticker.gif`,
        title: '😀',
        stickerPackId: `MoreStickers:Telegram:Pack:${packName}`,
        filename: 'test_sticker.gif',
        isAnimated: true,
        readyToUpload: true,
      },
    ],
    dynamic: {
      version: 1,
      refreshUrl: generateStickerPackExternalUrl(packName),
    },
  }),
);
const sampleGifAsset = await storeStickerAsset(packName, sampleGifDest);
await writeStickerVersionIndexAtomically(packName, {
  version: 1,
  signature: 'http-fixture',
  stickers: {'test_sticker.gif': sampleGifAsset},
  previews: {},
});

const gifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/test_sticker.gif`,
  headers: {
    origin: 'https://discord.com',
  },
});

assert.equal(
  gifResponse.statusCode,
  200,
  `Expected 200 for .gif, got ${gifResponse.statusCode}`,
);
assert.equal(
  gifResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${gifResponse.headers['access-control-allow-origin']}`,
);
assert.equal(
  gifResponse.headers['content-type'],
  'image/gif',
  `Expected Content-Type image/gif, got ${gifResponse.headers['content-type']}`,
);
assert.equal(
  gifResponse.headers['cache-control'],
  'public, max-age=300',
  `Expected cache-control header, got ${gifResponse.headers['cache-control']}`,
);

const gifHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/sticker/telegram/${packName}/test_sticker.gif`,
  headers: {
    origin: 'https://discord.com',
  },
});

assert.equal(
  gifHeadResponse.statusCode,
  200,
  `Expected 200 for HEAD .gif, got ${gifHeadResponse.statusCode}`,
);
assert.equal(
  gifHeadResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${gifHeadResponse.headers['access-control-allow-origin']}`,
);
assert.equal(
  gifHeadResponse.headers['content-type'],
  'image/gif',
  `Expected Content-Type image/gif for HEAD, got ${gifHeadResponse.headers['content-type']}`,
);
assert.equal(
  gifHeadResponse.headers['cache-control'],
  'public, max-age=300',
  `Expected cache-control header for HEAD, got ${gifHeadResponse.headers['cache-control']}`,
);
assert.equal(
  gifHeadResponse.body,
  '',
  `Expected empty body for HEAD, got length ${gifHeadResponse.body.length}`,
);

const gifOptionsResponse = await app.inject({
  method: 'OPTIONS',
  url: `/sticker/telegram/${packName}/test_sticker.gif`,
  headers: {
    origin: 'https://discord.com',
    'access-control-request-method': 'GET',
  },
});

assert.equal(
  gifOptionsResponse.statusCode,
  204,
  `Expected 204 for OPTIONS .gif, got ${gifOptionsResponse.statusCode}`,
);
assert.equal(
  gifOptionsResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${gifOptionsResponse.headers['access-control-allow-origin']}`,
);
const assetAllowedMethods = (
  (gifOptionsResponse.headers['access-control-allow-methods'] as string) || ''
)
  .split(',')
  .map(m => m.trim().toUpperCase());
assert.ok(
  assetAllowedMethods.includes('GET'),
  'Access-Control-Allow-Methods must include GET',
);
assert.ok(
  assetAllowedMethods.includes('HEAD'),
  'Access-Control-Allow-Methods must include HEAD',
);
assert.ok(
  assetAllowedMethods.includes('OPTIONS'),
  'Access-Control-Allow-Methods must include OPTIONS',
);

const manifestResponse = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    origin: 'https://discord.com',
  },
});

assert.equal(
  manifestResponse.statusCode,
  200,
  `Expected 200 for manifest GET, got ${manifestResponse.statusCode}`,
);
assert.equal(
  manifestResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${manifestResponse.headers['access-control-allow-origin']}`,
);
assert.equal(
  manifestResponse.headers['content-type'],
  'application/json; charset=utf-8',
  `Expected Content-Type application/json; charset=utf-8 for manifest, got ${manifestResponse.headers['content-type']}`,
);
const parsedManifest = JSON.parse(manifestResponse.body);
assert.equal(
  parsedManifest.id,
  `MoreStickers:Telegram:Pack:${packName}`,
  'Manifest body must parse as valid JSON matching pack id',
);
assert.equal(
  parsedManifest.dynamic?.version,
  1,
  'Manifest served via HTTP must contain dynamic.version',
);
assert.equal(
  parsedManifest.dynamic?.refreshUrl,
  generateStickerPackExternalUrl(packName),
  'Manifest served via HTTP must contain dynamic.refreshUrl',
);
assert.equal(
  manifestResponse.headers['cache-control'],
  'no-cache',
  `Expected cache-control: no-cache for manifest, got ${manifestResponse.headers['cache-control']}`,
);
assert.equal(
  manifestResponse.headers['content-disposition'],
  `attachment; filename="${packName}.stickerpack"`,
  `Expected Content-Disposition header for manifest, got ${manifestResponse.headers['content-disposition']}`,
);

const manifestHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    origin: 'https://discord.com',
  },
});

assert.equal(
  manifestHeadResponse.statusCode,
  200,
  `Expected 200 for manifest HEAD, got ${manifestHeadResponse.statusCode}`,
);
assert.equal(
  manifestHeadResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${manifestHeadResponse.headers['access-control-allow-origin']}`,
);
assert.equal(
  manifestHeadResponse.headers['content-type'],
  'application/json; charset=utf-8',
  `Expected Content-Type application/json; charset=utf-8 for manifest HEAD, got ${manifestHeadResponse.headers['content-type']}`,
);
assert.equal(
  manifestHeadResponse.headers['cache-control'],
  'no-cache',
  `Expected cache-control: no-cache for manifest HEAD, got ${manifestHeadResponse.headers['cache-control']}`,
);
assert.equal(
  manifestHeadResponse.body,
  '',
  `Expected empty body for manifest HEAD, got length ${manifestHeadResponse.body.length}`,
);
assert.equal(
  manifestHeadResponse.headers['content-disposition'],
  `attachment; filename="${packName}.stickerpack"`,
  `Expected Content-Disposition header for manifest HEAD, got ${manifestHeadResponse.headers['content-disposition']}`,
);

const manifestOptionsResponse = await app.inject({
  method: 'OPTIONS',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    origin: 'https://discord.com',
    'access-control-request-method': 'GET',
  },
});

assert.equal(
  manifestOptionsResponse.statusCode,
  204,
  `Expected 204 for manifest OPTIONS, got ${manifestOptionsResponse.statusCode}`,
);
assert.equal(
  manifestOptionsResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: *, got ${manifestOptionsResponse.headers['access-control-allow-origin']}`,
);
const manifestAllowedMethods = (
  (manifestOptionsResponse.headers['access-control-allow-methods'] as string) ||
  ''
)
  .split(',')
  .map(m => m.trim().toUpperCase());
assert.ok(
  manifestAllowedMethods.includes('GET'),
  'Manifest Access-Control-Allow-Methods must include GET',
);
assert.ok(
  manifestAllowedMethods.includes('HEAD'),
  'Manifest Access-Control-Allow-Methods must include HEAD',
);
assert.ok(
  manifestAllowedMethods.includes('OPTIONS'),
  'Manifest Access-Control-Allow-Methods must include OPTIONS',
);

console.log('Testing immutable versioned and mutable legacy asset routes...');
const versionedHttpPackName = 'VersionedHttpPack';
const versionedHttpPackDir = generateStickerPackDirPath(versionedHttpPackName);
await fsp.mkdir(versionedHttpPackDir, {recursive: true});
const version10StickerSource = path.join(versionedHttpPackDir, 'v10.gif');
const version11StickerSource = path.join(versionedHttpPackDir, 'v11.gif');
const version10PreviewSource = path.join(versionedHttpPackDir, 'v10.webp');
const version11PreviewSource = path.join(versionedHttpPackDir, 'v11.webp');
await fsp.writeFile(version10StickerSource, 'version-10-sticker');
await fsp.writeFile(version11StickerSource, 'version-11-sticker');
await fsp.writeFile(version10PreviewSource, 'version-10-preview');
await fsp.writeFile(version11PreviewSource, 'version-11-preview');
const version10StickerAsset = await storeStickerAsset(
  versionedHttpPackName,
  version10StickerSource,
);
const version11StickerAsset = await storeStickerAsset(
  versionedHttpPackName,
  version11StickerSource,
);
const version10PreviewAsset = await storeStickerAsset(
  versionedHttpPackName,
  version10PreviewSource,
);
const version11PreviewAsset = await storeStickerAsset(
  versionedHttpPackName,
  version11PreviewSource,
);
await writeStickerVersionIndexAtomically(versionedHttpPackName, {
  version: 10,
  signature: 'version-10',
  stickers: {'A.gif': version10StickerAsset},
  previews: {'A.webp': version10PreviewAsset},
});
await writeStickerVersionIndexAtomically(versionedHttpPackName, {
  version: 11,
  signature: 'version-11',
  stickers: {'A.gif': version11StickerAsset},
  previews: {'A.webp': version11PreviewAsset},
});
assert.equal(
  (
    await app.inject({
      method: 'GET',
      url: `/sticker/telegram/${versionedHttpPackName}/10/A.gif`,
    })
  ).statusCode,
  404,
  'Versioned sticker routes must remain private without a public manifest',
);
assert.equal(
  (
    await app.inject({
      method: 'GET',
      url: `/preview/telegram/${versionedHttpPackName}/10/A.webp`,
    })
  ).statusCode,
  404,
  'Versioned preview routes must remain private without a public manifest',
);
await fsp.writeFile(
  generateStickerPackFilePath(versionedHttpPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${versionedHttpPackName}`,
    title: 'Versioned HTTP Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${versionedHttpPackName}:A`,
      image: `https://stickers.example.com/sticker/telegram/${versionedHttpPackName}/10/A.gif`,
      previewImage: `https://stickers.example.com/preview/telegram/${versionedHttpPackName}/10/A.webp`,
      title: 'A',
      stickerPackId: `MoreStickers:Telegram:Pack:${versionedHttpPackName}`,
      filename: 'A.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${versionedHttpPackName}:A`,
        image: `https://stickers.example.com/sticker/telegram/${versionedHttpPackName}/10/A.gif`,
        previewImage: `https://stickers.example.com/preview/telegram/${versionedHttpPackName}/10/A.webp`,
        title: 'A',
        stickerPackId: `MoreStickers:Telegram:Pack:${versionedHttpPackName}`,
        filename: 'A.gif',
        isAnimated: true,
        readyToUpload: true,
      },
    ],
    dynamic: {
      version: 10,
      refreshUrl: generateStickerPackExternalUrl(versionedHttpPackName),
    },
  }),
);
const version10Response = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/10/A.gif`,
});
assert.equal(version10Response.statusCode, 200);
assert.equal(version10Response.body, 'version-10-sticker');
assert.ok(version10Response.headers['cache-control']?.includes('immutable'));
assert.ok(
  version10Response.headers['cache-control']?.includes('max-age=31536000'),
);
const pendingVersion11Response = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A.gif`,
});
assert.equal(
  pendingVersion11Response.statusCode,
  404,
  'Pending sticker versions must not be public',
);
const pendingVersion11PreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/11/A.webp`,
});
assert.equal(
  pendingVersion11PreviewResponse.statusCode,
  404,
  'Pending preview versions must not be public',
);
const committedVersion11Manifest = JSON.parse(
  await fsp.readFile(
    generateStickerPackFilePath(versionedHttpPackName),
    'utf8',
  ),
) as {dynamic: {version: number}};
committedVersion11Manifest.dynamic.version = 11;
await fsp.writeFile(
  generateStickerPackFilePath(versionedHttpPackName),
  JSON.stringify(committedVersion11Manifest),
);
const version11Response = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A.gif`,
});
assert.equal(version11Response.statusCode, 200);
assert.equal(version11Response.body, 'version-11-sticker');
assert.ok(version11Response.headers['cache-control']?.includes('immutable'));
const legacyLatestResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/A.gif`,
});
assert.equal(legacyLatestResponse.statusCode, 200);
assert.equal(legacyLatestResponse.body, 'version-11-sticker');
assert.equal(
  legacyLatestResponse.headers['cache-control']?.includes('immutable'),
  false,
);
const versionedLegacyAliasResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/10/A-160.gif`,
});
assert.equal(
  versionedLegacyAliasResponse.statusCode,
  404,
  'Versioned routes must require an exact index key',
);
const versionedCanonicalizationResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/10/A.GIF`,
});
assert.equal(
  versionedCanonicalizationResponse.statusCode,
  404,
  'Versioned routes must not canonicalize request filenames',
);
const legacyAliasResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/A-160.gif`,
});
assert.equal(legacyAliasResponse.statusCode, 200);
assert.equal(legacyAliasResponse.body, 'version-11-sticker');
assert.equal(
  legacyAliasResponse.headers['cache-control']?.includes('immutable'),
  false,
);
const versionedPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/10/A.webp`,
});
assert.equal(versionedPreviewResponse.statusCode, 200);
assert.equal(versionedPreviewResponse.body, 'version-10-preview');
assert.ok(
  versionedPreviewResponse.headers['cache-control']?.includes('immutable'),
);
const committedVersion11PreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/11/A.webp`,
});
assert.equal(committedVersion11PreviewResponse.statusCode, 200);
assert.equal(committedVersion11PreviewResponse.body, 'version-11-preview');
assert.ok(
  committedVersion11PreviewResponse.headers['cache-control']?.includes(
    'immutable',
  ),
);
const legacyPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/A.webp`,
});
assert.equal(legacyPreviewResponse.statusCode, 200);
assert.equal(legacyPreviewResponse.body, 'version-11-preview');
assert.equal(
  legacyPreviewResponse.headers['cache-control']?.includes('immutable'),
  false,
);
assert.equal(
  (
    await app.inject({
      method: 'GET',
      url: `/sticker/telegram/${versionedHttpPackName}/9/A.gif`,
    })
  ).statusCode,
  404,
);
assert.equal(
  (
    await app.inject({
      method: 'GET',
      url: `/sticker/telegram/${versionedHttpPackName}/10/missing.gif`,
    })
  ).statusCode,
  404,
);
assert.ok(
  [400, 404].includes(
    (
      await app.inject({
        method: 'GET',
        url: `/sticker/telegram/${versionedHttpPackName}/10/%2e%2e%2fA.gif`,
      })
    ).statusCode,
  ),
);
console.log(
  'Verified: versioned history is immutable and legacy routes use latest',
);

console.log('Verified: Fastify correctly serves .gif and manifest with CORS');

// Manifest Path Traversal and Invalid Pack Name tests
console.log(
  'Testing Fastify manifest path traversal protection and validation...',
);
const escapedManifestPath = path.join(tempDir, 'escaped.telegram.stickerpack');
await fsp.writeFile(
  escapedManifestPath,
  JSON.stringify({id: 'SHOULD-NOT-BE-SERVED', pack: 'escaped'}),
);

const traversalGet = await app.inject({
  method: 'GET',
  url: '/stickerpack/telegram/..%2Fescaped',
});
assert.equal(
  traversalGet.statusCode,
  400,
  'Expected 400 for path traversal GET',
);
assert.equal(traversalGet.body, 'Invalid sticker pack name');
assert.equal(
  traversalGet.body.includes('SHOULD-NOT-BE-SERVED'),
  false,
  'Escaped manifest content must NOT be served',
);

const traversalHead = await app.inject({
  method: 'HEAD',
  url: '/stickerpack/telegram/..%2Fescaped',
});
assert.equal(
  traversalHead.statusCode,
  400,
  'Expected 400 for path traversal HEAD',
);

const backslashGet = await app.inject({
  method: 'GET',
  url: '/stickerpack/telegram/..%5Cescaped',
});
assert.equal(
  backslashGet.statusCode,
  400,
  'Expected 400 for backslash traversal GET',
);
assert.equal(backslashGet.body, 'Invalid sticker pack name');
assert.equal(
  backslashGet.body.includes('SHOULD-NOT-BE-SERVED'),
  false,
  'Escaped manifest content must NOT be served on backslash',
);

console.log(
  'Verified: Fastify manifest endpoint rejects path traversal and invalid pack names',
);

// Test 8: Fastify static WebP and forbidden raw formats (.webm / .tgs / .exe)
console.log('Testing Fastify endpoint for static .webp...');
const legacyStaticPackName = 'LegacyStaticHttpPack';
const legacyStaticPackDir = generateStickerPackDirPath(legacyStaticPackName);
await fsp.mkdir(legacyStaticPackDir, {recursive: true});
const webpFilePath = path.join(legacyStaticPackDir, 'test_static.webp');
await fsp.writeFile(webpFilePath, 'dummy-webp');
const webpResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${legacyStaticPackName}/test_static.webp`,
  headers: {
    origin: 'https://discord.com',
  },
});
assert.equal(
  webpResponse.statusCode,
  200,
  `Expected 200 for .webp, got ${webpResponse.statusCode}`,
);
assert.equal(
  webpResponse.headers['content-type'],
  'image/webp',
  `Expected Content-Type image/webp, got ${webpResponse.headers['content-type']}`,
);
assert.equal(
  webpResponse.headers['cache-control'],
  'public, max-age=300',
  `Expected cache-control header for .webp, got ${webpResponse.headers['cache-control']}`,
);
assert.equal(
  webpResponse.headers['access-control-allow-origin'],
  '*',
  `Expected Access-Control-Allow-Origin: * for .webp, got ${webpResponse.headers['access-control-allow-origin']}`,
);
console.log('Verified: Fastify correctly serves static .webp');

console.log('Testing Fastify full asset missing file handling (404)...');
const missingGifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/missing_sticker.gif`,
});
assert.equal(
  missingGifResponse.statusCode,
  404,
  `Expected 404 for missing .gif, got ${missingGifResponse.statusCode}`,
);
assert.equal(
  missingGifResponse.body,
  'Sticker not found',
  `Expected 'Sticker not found' body for missing .gif, got ${missingGifResponse.body}`,
);

const missingWebpHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/sticker/telegram/${packName}/missing_sticker.webp`,
});
assert.equal(
  missingWebpHeadResponse.statusCode,
  404,
  `Expected 404 for missing .webp HEAD, got ${missingWebpHeadResponse.statusCode}`,
);
assert.equal(
  missingWebpHeadResponse.body,
  '',
  `Expected empty body for missing .webp HEAD, got length ${missingWebpHeadResponse.body.length}`,
);
console.log('Verified: Fastify returns 404 for missing full assets (GET/HEAD)');
console.log('Testing Fastify rejection of raw .webm (with physical file)...');
const rawWebmPath = path.join(packDir, 'legacy_raw.webm');
await fsp.writeFile(rawWebmPath, 'dummy-webm');
assert.ok(
  fs.existsSync(rawWebmPath),
  'Raw WebM file must physically exist before request',
);
const rawWebmResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/legacy_raw.webm`,
});
assert.equal(
  rawWebmResponse.statusCode,
  400,
  `Expected 400 for raw .webm, got ${rawWebmResponse.statusCode}`,
);
assert.equal(
  rawWebmResponse.body,
  'Invalid file extension',
  `Expected 'Invalid file extension' body for raw .webm, got ${rawWebmResponse.body}`,
);
const rawWebmHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/sticker/telegram/${packName}/legacy_raw.webm`,
});
assert.equal(
  rawWebmHeadResponse.statusCode,
  400,
  `Expected 400 for raw .webm HEAD, got ${rawWebmHeadResponse.statusCode}`,
);

console.log('Testing Fastify rejection of raw .tgs (with physical file)...');
const rawTgsPath = path.join(packDir, 'legacy_raw.tgs');
await fsp.writeFile(rawTgsPath, 'dummy-tgs');
assert.ok(
  fs.existsSync(rawTgsPath),
  'Raw TGS file must physically exist before request',
);
const rawTgsResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/legacy_raw.tgs`,
});
assert.equal(
  rawTgsResponse.statusCode,
  400,
  `Expected 400 for raw .tgs, got ${rawTgsResponse.statusCode}`,
);
assert.equal(
  rawTgsResponse.body,
  'Invalid file extension',
  `Expected 'Invalid file extension' body for raw .tgs, got ${rawTgsResponse.body}`,
);
const rawTgsHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/sticker/telegram/${packName}/legacy_raw.tgs`,
});
assert.equal(
  rawTgsHeadResponse.statusCode,
  400,
  `Expected 400 for raw .tgs HEAD, got ${rawTgsHeadResponse.statusCode}`,
);

console.log('Testing Fastify endpoint for invalid extension .exe...');
const invalidResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/test_sticker.exe`,
});
assert.equal(
  invalidResponse.statusCode,
  400,
  `Expected 400 for invalid extension, got ${invalidResponse.statusCode}`,
);
console.log('Testing Fastify endpoint for uppercase extension .GIF...');
const upperGifPath = path.join(legacyStaticPackDir, 'upper.GIF');
await fsp.copyFile(testGifPath, upperGifPath);
const upperGifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${legacyStaticPackName}/upper.GIF`,
});
assert.equal(
  upperGifResponse.statusCode,
  200,
  `Expected 200 for upper.GIF, got ${upperGifResponse.statusCode}`,
);
assert.equal(
  upperGifResponse.headers['content-type'],
  'image/gif',
  `Expected Content-Type image/gif for upper.GIF, got ${upperGifResponse.headers['content-type']}`,
);

console.log('Testing Fastify rejection of double extension bypass.gif.exe...');
const bypassExePath = path.join(packDir, 'bypass.gif.exe');
await fsp.writeFile(bypassExePath, 'must-not-be-served');
assert.ok(
  fs.existsSync(bypassExePath),
  'Bypass exe file must physically exist before request',
);
const bypassExeResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/bypass.gif.exe`,
});
assert.equal(
  bypassExeResponse.statusCode,
  400,
  `Expected 400 for bypass.gif.exe, got ${bypassExeResponse.statusCode}`,
);

console.log('Testing Fastify rejection of double extension bypass.gif.webp...');
const bypassWebpPath = path.join(packDir, 'bypass.gif.webp');
await fsp.writeFile(bypassWebpPath, 'must-not-be-served');
assert.ok(
  fs.existsSync(bypassWebpPath),
  'Bypass webp file must physically exist before request',
);
const bypassWebpResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/bypass.gif.webp`,
});
assert.equal(
  bypassWebpResponse.statusCode,
  400,
  `Expected 400 for bypass.gif.webp, got ${bypassWebpResponse.statusCode}`,
);

console.log('Testing Fastify rejection of filename without extension...');
const noExtResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/sticker_without_ext`,
});
assert.equal(
  noExtResponse.statusCode,
  400,
  `Expected 400 for filename without extension, got ${noExtResponse.statusCode}`,
);

console.log('Testing Fastify rejection of path-component filename...');
const pathComponentResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/nested%2Ftest_sticker.gif`,
});
assert.equal(
  pathComponentResponse.statusCode,
  400,
  `Expected 400 for path-component filename, got ${pathComponentResponse.statusCode}`,
);

console.log(
  'Verified: Fastify rejects invalid/raw extensions (.webm, .tgs, .exe, .gif.exe, .gif.webp, no-ext, path-component) with 400',
);
console.log('Testing deterministic preview profile selection...');
const previewTestDir = path.join(tempDir, 'preview-deterministic-tests');
await fsp.mkdir(previewTestDir, {recursive: true});

// Case A: Profile 0 produces 20 KiB (> target, <= max), Profile 1 produces 10 KiB (<= target)
const caseAInput = path.join(previewTestDir, 'caseA-in.webp');
await fsp.writeFile(caseAInput, 'test-in');
const caseAOutput = path.join(previewTestDir, 'caseA-out.webp');
const encoderA = async (
  _input: string,
  candidate: string,
  profile: (typeof PREVIEW_PROFILES)[number],
) => {
  const profileIdx = PREVIEW_PROFILES.indexOf(profile);
  const size = profileIdx === 0 ? 20 * 1024 : 10 * 1024;
  await fsp.writeFile(candidate, Buffer.alloc(size));
};
const resultA = await generatePreviewWithEncoder(
  caseAInput,
  caseAOutput,
  encoderA,
);
assert.equal(resultA.profileIndex, 1, 'Case A: must accept profile 1');
assert.equal(
  resultA.sizeBytes,
  10 * 1024,
  'Case A: output size must be 10 KiB',
);
assert.ok(
  resultA.sizeBytes <= PREVIEW_TARGET_BYTES,
  'Case A: output must be <= PREVIEW_TARGET_BYTES',
);
assert.ok(fs.existsSync(caseAOutput), 'Case A: output file must exist');
const filesA = await fsp.readdir(previewTestDir);
assert.equal(
  filesA.filter(f => f.includes('.preview-candidate-')).length,
  0,
  'Case A: no candidate files remaining',
);

// Case B: all profiles > target (12 KiB) but <= max (24 KiB) -> best fallback accepted
const caseBOutput = path.join(previewTestDir, 'caseB-out.webp');
const profileSizesB = [22 * 1024, 20 * 1024, 18 * 1024, 19 * 1024, 21 * 1024];
const encoderB = async (
  _input: string,
  candidate: string,
  profile: (typeof PREVIEW_PROFILES)[number],
) => {
  const profileIdx = PREVIEW_PROFILES.indexOf(profile);
  await fsp.writeFile(candidate, Buffer.alloc(profileSizesB[profileIdx]));
};
const resultB = await generatePreviewWithEncoder(
  caseAInput,
  caseBOutput,
  encoderB,
);
assert.equal(
  resultB.profileIndex,
  2,
  'Case B: must accept profile index 2 (smallest fallback 18 KiB)',
);
assert.equal(
  resultB.sizeBytes,
  18 * 1024,
  'Case B: output size must be 18 KiB',
);
assert.ok(
  resultB.sizeBytes <= PREVIEW_MAX_BYTES,
  'Case B: output must be <= PREVIEW_MAX_BYTES',
);
assert.ok(fs.existsSync(caseBOutput), 'Case B: output file must exist');
const filesB = await fsp.readdir(previewTestDir);
assert.equal(
  filesB.filter(f => f.includes('.preview-candidate-')).length,
  0,
  'Case B: no candidate files remaining',
);

// Case C: all profiles > 24 KiB -> throw error, no output, all candidates cleaned up
const caseCOutput = path.join(previewTestDir, 'caseC-out.webp');
const encoderC = async (_input: string, candidate: string) => {
  await fsp.writeFile(candidate, Buffer.alloc(25 * 1024));
};
await assert.rejects(
  async () => {
    await generatePreviewWithEncoder(caseAInput, caseCOutput, encoderC);
  },
  /exceeded the preview size limit/,
  'Case C: must reject when all profiles exceed PREVIEW_MAX_BYTES',
);
assert.equal(
  fs.existsSync(caseCOutput),
  false,
  'Case C: output file must not exist',
);
const filesC = await fsp.readdir(previewTestDir);
assert.equal(
  filesC.filter(f => f.includes('.preview-candidate-')).length,
  0,
  'Case C: no candidate files remaining after rejection',
);
console.log(
  'Verified: deterministic preview profile selection and cleanup pass',
);

console.log('Testing real GIF and WebP preview generation with FFmpeg...');
// Real GIF -> WebP preview
const gifPreviewOutput = path.join(tempDir, 'real_gif_preview.webp');
const gifPreviewResult = await generatePreview(testGifPath, gifPreviewOutput);
assert.ok(fs.existsSync(gifPreviewOutput), 'GIF preview file must exist');
assert.ok(
  gifPreviewResult.sizeBytes <= PREVIEW_MAX_BYTES,
  'GIF preview must be <= 24 KiB',
);

const probeGifPreview = spawnSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=codec_name,width,height',
  '-of',
  'json',
  gifPreviewOutput,
]);
assert.equal(probeGifPreview.status, 0, 'ffprobe failed on GIF preview');
const gifPreviewProbe = JSON.parse(probeGifPreview.stdout.toString('utf8'))
  .streams[0];
assert.equal(
  gifPreviewProbe.codec_name,
  'webp',
  'GIF preview must be WebP codec',
);
const gifPrevWidth = Number(gifPreviewProbe.width);
const gifPrevHeight = Number(gifPreviewProbe.height);
assert.ok(
  gifPrevWidth > 0 && gifPrevWidth <= 96,
  `GIF preview width (${gifPrevWidth}) must be <= 96`,
);
assert.ok(
  gifPrevHeight > 0 && gifPrevHeight <= 96,
  `GIF preview height (${gifPrevHeight}) must be <= 96`,
);

// Check transparency of GIF preview
const cornerAlphaResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  gifPreviewOutput,
  '-vf',
  'format=rgba,crop=1:1:0:0',
  '-frames:v',
  '1',
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  'pipe:1',
]);
assert.equal(
  cornerAlphaResult.status,
  0,
  'FFmpeg pixel extraction failed at (0,0)',
);
assert.equal(
  cornerAlphaResult.stdout[3],
  0,
  'GIF preview corner (0,0) must be transparent (alpha=0)',
);

const centerPrevX = Math.floor(gifPrevWidth / 2);
const centerPrevY = Math.floor(gifPrevHeight / 2);
const centerAlphaResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  gifPreviewOutput,
  '-vf',
  `format=rgba,crop=1:1:${centerPrevX}:${centerPrevY}`,
  '-frames:v',
  '1',
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  'pipe:1',
]);
assert.equal(
  centerAlphaResult.status,
  0,
  'FFmpeg pixel extraction failed at center',
);
assert.equal(
  centerAlphaResult.stdout[3],
  255,
  `GIF preview center (${centerPrevX},${centerPrevY}) must be opaque (alpha=255)`,
);

// Real static WebP -> WebP preview
const realWebpInput = path.join(tempDir, 'real_input_512.webp');
const genWebpRes = spawnSync('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=red:size=512x512:duration=1',
  '-frames:v',
  '1',
  '-c:v',
  'libwebp',
  realWebpInput,
]);
assert.equal(genWebpRes.status, 0, 'Failed to create test 512x512 WebP');
const webpPreviewOutput = path.join(tempDir, 'real_webp_preview.webp');
const webpPreviewResult = await generatePreview(
  realWebpInput,
  webpPreviewOutput,
);
assert.ok(fs.existsSync(webpPreviewOutput), 'WebP preview file must exist');
assert.ok(
  webpPreviewResult.sizeBytes <= PREVIEW_MAX_BYTES,
  'WebP preview must be <= 24 KiB',
);

const probeWebpPreview = spawnSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=codec_name,width,height',
  '-of',
  'json',
  webpPreviewOutput,
]);
assert.equal(probeWebpPreview.status, 0, 'ffprobe failed on WebP preview');
const webpPreviewProbe = JSON.parse(probeWebpPreview.stdout.toString('utf8'))
  .streams[0];
assert.equal(
  webpPreviewProbe.codec_name,
  'webp',
  'WebP preview must be WebP codec',
);
const webpPrevWidth = Number(webpPreviewProbe.width);
const webpPrevHeight = Number(webpPreviewProbe.height);
assert.ok(
  webpPrevWidth > 0 && webpPrevWidth <= 96,
  `WebP preview width (${webpPrevWidth}) must be <= 96`,
);
assert.ok(
  webpPrevHeight > 0 && webpPrevHeight <= 96,
  `WebP preview height (${webpPrevHeight}) must be <= 96`,
);
console.log(
  'Verified: real GIF and WebP preview generation with transparency and size bounds',
);

console.log(
  'Testing Fastify preview endpoint /preview/telegram/:pack/:filename...',
);
const legacyPreviewPackName = 'LegacyPreviewHttpPack';
const previewPackDir = generateStickerPreviewDirPath(legacyPreviewPackName);
await fsp.mkdir(previewPackDir, {recursive: true});
const previewFilePathInPack = generateStickerPreviewFilePath(
  legacyPreviewPackName,
  'test_sticker',
);
await fsp.copyFile(gifPreviewOutput, previewFilePathInPack);

// GET preview
const previewGetResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.webp`,
  headers: {
    origin: 'https://discord.com',
  },
});
assert.equal(
  previewGetResponse.statusCode,
  200,
  'Expected 200 for preview GET',
);
assert.equal(
  previewGetResponse.headers['content-type'],
  'image/webp',
  'Expected image/webp Content-Type for preview',
);
assert.equal(
  previewGetResponse.headers['cache-control'],
  'public, max-age=300',
  'Expected short mutable cache-control for legacy preview',
);
assert.equal(
  previewGetResponse.headers['access-control-allow-origin'],
  '*',
  'Expected CORS * for preview',
);

// HEAD preview
const previewHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.webp`,
  headers: {
    origin: 'https://discord.com',
  },
});
assert.equal(
  previewHeadResponse.statusCode,
  200,
  'Expected 200 for preview HEAD',
);
assert.equal(
  previewHeadResponse.body,
  '',
  'Expected empty body for preview HEAD',
);

// OPTIONS preview
const previewOptionsResponse = await app.inject({
  method: 'OPTIONS',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.webp`,
  headers: {
    origin: 'https://discord.com',
    'access-control-request-method': 'GET',
  },
});
assert.equal(
  previewOptionsResponse.statusCode,
  204,
  'Expected 204 for preview OPTIONS',
);

// Missing preview -> 404
const missingPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/non_existent_sticker.webp`,
});
assert.equal(
  missingPreviewResponse.statusCode,
  404,
  'Expected 404 for missing preview',
);
assert.equal(missingPreviewResponse.body, 'Preview not found');

// Invalid extension -> 400
const invalidExtPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.gif`,
});
assert.equal(
  invalidExtPreviewResponse.statusCode,
  400,
  'Expected 400 for .gif on preview route',
);

// Double extension -> 400
const doubleExtPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.webp.exe`,
});
assert.equal(
  doubleExtPreviewResponse.statusCode,
  400,
  'Expected 400 for double extension on preview route',
);

// Path component -> 400
const pathCompPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/nested%2Ftest_sticker.webp`,
});
assert.equal(
  pathCompPreviewResponse.statusCode,
  400,
  'Expected 400 for path component on preview route',
);

console.log(
  'Verified: Fastify preview route serves WebP with CORS and rejects invalid/missing requests',
);
// Test 9: Error handling on invalid/corrupt input
console.log('Testing convertWebmToGif error handling with invalid input...');
const invalidInputPath = path.join(tempDir, 'corrupt.webm');
await fsp.writeFile(invalidInputPath, 'not a valid video file');
const invalidOutputPath = path.join(tempDir, 'corrupt.gif');

await assert.rejects(
  async () => {
    await convertWebmToGif(invalidInputPath, invalidOutputPath);
  },
  /FFmpeg exited with code|Failed to spawn ffmpeg/,
  'Expected convertWebmToGif to reject with informative error on corrupt input',
);
assert.equal(
  fs.existsSync(invalidOutputPath),
  false,
  'No output GIF should exist after failed conversion',
);
console.log(
  'Verified: convertWebmToGif correctly rejects corrupt input and leaves no output',
);

// Test 10: Deterministic Regression - 6 MB fallback cleaned up when 4 MB target is reached
console.log(
  'Testing deterministic regression: 6 MB fallback -> 4 MB target cleanup...',
);
const reg1Dir = await fsp.mkdtemp(path.join(tempDir, 'reg1-'));
const reg1Input = path.join(reg1Dir, 'input.webm');
const reg1Output = path.join(reg1Dir, 'output.gif');
await fsp.writeFile(reg1Input, 'dummy-webm-input');

let encodingCall = 0;
const fallbackThenTargetEncoder: GifEncoder = async (
  _inputPath,
  candidatePath,
) => {
  const size = encodingCall++ === 0 ? 6_000_000 : 4_000_000;
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(candidatePath, size);
};

const reg1Result = await convertWebmToGifWithEncoder(
  reg1Input,
  reg1Output,
  fallbackThenTargetEncoder,
);

assert.equal(reg1Result.profileIndex, 1, 'Profile 1 must be selected');
assert.equal(reg1Result.sizeBytes, 4_000_000, 'Size must be 4 MB');
assert.ok(fs.existsSync(reg1Output), 'Final output GIF must exist');

const reg1Files = await fsp.readdir(reg1Dir);
const reg1Candidates = reg1Files.filter(f => f.includes('.candidate-'));
assert.deepEqual(
  reg1Candidates,
  [],
  'No candidate files (including 6MB fallback) should remain after target reached',
);
console.log('Verified: 6 MB fallback cleaned up when 4 MB target reached');

// Test 11: Deterministic Regression - 6 MB fallback cleaned up when subsequent profile throws error
console.log(
  'Testing deterministic regression: 6 MB fallback -> subsequent encoder error cleanup...',
);
const reg2Dir = await fsp.mkdtemp(path.join(tempDir, 'reg2-'));
const reg2Input = path.join(reg2Dir, 'input.webm');
const reg2Output = path.join(reg2Dir, 'output.gif');
await fsp.writeFile(reg2Input, 'dummy-webm-input');

let failingCall = 0;
const failingEncoder: GifEncoder = async (_inputPath, candidatePath) => {
  if (failingCall++ === 0) {
    await fsp.writeFile(candidatePath, '');
    await fsp.truncate(candidatePath, 6_000_000);
    return;
  }
  throw new Error('simulated encoder failure');
};

await assert.rejects(
  async () => {
    await convertWebmToGifWithEncoder(reg2Input, reg2Output, failingEncoder);
  },
  /simulated encoder failure/,
  'Expected convertWebmToGifWithEncoder to reject with encoder failure',
);

assert.equal(
  fs.existsSync(reg2Output),
  false,
  'Final output GIF must not exist after error',
);

const reg2Files = await fsp.readdir(reg2Dir);
const reg2Candidates = reg2Files.filter(f => f.includes('.candidate-'));
assert.deepEqual(
  reg2Candidates,
  [],
  'All candidate files (including 6MB fallback) must be cleaned up after error',
);
console.log(
  'Verified: 6 MB fallback cleaned up when subsequent profile throws error',
);

// Test 12: TGS uses the same candidate selection and cleanup policy
console.log('Testing deterministic TGS conversion policy...');
const tgsReg1Dir = await fsp.mkdtemp(path.join(tempDir, 'tgs-reg1-'));
const tgsReg1Input = path.join(tgsReg1Dir, 'input.tgs');
const tgsReg1Output = path.join(tgsReg1Dir, 'output.gif');
await fsp.writeFile(tgsReg1Input, 'dummy-tgs-input');

let tgsEncodingCall = 0;
const tgsEncoderFps: number[] = [];
const tgsFallbackThenTargetEncoder: GifEncoder = async (
  _inputPath,
  candidatePath,
  profile,
) => {
  tgsEncoderFps.push(profile.fps);
  const size = tgsEncodingCall++ === 0 ? 6_000_000 : 4_000_000;
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(candidatePath, size);
};
const tgsReg1Result = await convertTgsToGifWithEncoder(
  tgsReg1Input,
  tgsReg1Output,
  tgsFallbackThenTargetEncoder,
);
assert.equal(tgsReg1Result.profileIndex, 1, 'TGS profile 1 must be selected');
assert.equal(tgsReg1Result.sizeBytes, 4_000_000, 'TGS size must be 4 MB');
assert.deepEqual(
  tgsEncoderFps,
  [20, 20],
  'TGS encoder must receive timing-safe FPS values from its selected profiles',
);
assert.equal(
  tgsReg1Result.profile.fps,
  TGS_GIF_ENCODING_PROFILES[1].fps,
  'TGS result profile must match the FPS passed to its encoder',
);
assert.ok(fs.existsSync(tgsReg1Output), 'TGS final output GIF must exist');
assert.deepEqual(
  (await fsp.readdir(tgsReg1Dir)).filter(f => f.includes('.candidate-')),
  [],
  'TGS candidate and fallback files must be cleaned up after target reached',
);

const tgsReg2Dir = await fsp.mkdtemp(path.join(tempDir, 'tgs-reg2-'));
const tgsReg2Input = path.join(tgsReg2Dir, 'input.tgs');
const tgsReg2Output = path.join(tgsReg2Dir, 'output.gif');
await fsp.writeFile(tgsReg2Input, 'dummy-tgs-input');

let tgsFailingCall = 0;
const tgsFailingEncoder: GifEncoder = async (_inputPath, candidatePath) => {
  if (tgsFailingCall++ === 0) {
    await fsp.writeFile(candidatePath, '');
    await fsp.truncate(candidatePath, 6_000_000);
    return;
  }
  throw new Error('simulated TGS encoder failure');
};
await assert.rejects(
  async () => {
    await convertTgsToGifWithEncoder(
      tgsReg2Input,
      tgsReg2Output,
      tgsFailingEncoder,
    );
  },
  /simulated TGS encoder failure/,
  'TGS encoder errors must reject',
);
assert.equal(
  fs.existsSync(tgsReg2Output),
  false,
  'TGS conversion errors must not leave a final GIF',
);
assert.deepEqual(
  (await fsp.readdir(tgsReg2Dir)).filter(f => f.includes('.candidate-')),
  [],
  'TGS conversion errors must clean candidate and fallback files',
);
console.log('Verified: TGS shares GIF sizing and cleanup policy');

// Test 13: Full TGS profile walk through 20, 10, and 5 FPS
console.log('Testing full TGS profile walk through 20, 10, and 5 FPS...');
const tgsWalkDir = await fsp.mkdtemp(path.join(tempDir, 'tgs-walk-'));
const tgsWalkInput = path.join(tgsWalkDir, 'input.tgs');
const tgsWalkOutput = path.join(tgsWalkDir, 'output.gif');
await fsp.writeFile(tgsWalkInput, 'dummy-tgs-input');

const observedTgsFps: number[] = [];
const profileWalkEncoder: GifEncoder = async (
  _inputPath,
  candidatePath,
  profile,
) => {
  observedTgsFps.push(profile.fps);
  const isLast = observedTgsFps.length === TGS_GIF_ENCODING_PROFILES.length;
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(
    candidatePath,
    isLast ? 4_000_000 : GIF_SAFE_HARD_LIMIT_BYTES + 1,
  );
};

const walkResult = await convertTgsToGifWithEncoder(
  tgsWalkInput,
  tgsWalkOutput,
  profileWalkEncoder,
);

assert.deepEqual(
  observedTgsFps,
  [20, 20, 20, 10, 10, 10, 10, 5, 5, 5],
  'Profile walk must observe every TGS FPS level in order',
);
assert.equal(
  walkResult.profileIndex,
  9,
  'Last profile (index 9) must be selected',
);
assert.equal(walkResult.profile.fps, 5, 'Selected profile FPS must be 5');
assert.equal(
  walkResult.sizeBytes,
  4_000_000,
  'Selected profile size must be 4 MB',
);
assert.ok(
  fs.existsSync(tgsWalkOutput),
  'Final output GIF from profile walk must exist',
);
assert.deepEqual(
  (await fsp.readdir(tgsWalkDir)).filter(f => f.includes('.candidate-')),
  [],
  'All candidate files from profile walk must be cleaned up',
);
console.log(
  'Verified: full TGS profile walk exercises 20, 10, and 5 FPS with proper cleanup',
);

// Test 14: TGS normalization logic, duration handling, and edge cases
console.log('Testing TGS normalization logic and edge cases...');
const norm1Result = normalizeLottieJsonForConverter(
  {fr: 60, ip: 0, op: 90, v: '5.7.4'},
  'test1.tgs',
);
const norm1Parsed = JSON.parse(norm1Result);
assert.equal(norm1Parsed.op, 89, 'op=90 must normalize to op=89');
assert.equal(norm1Parsed.ip, 0, 'ip must remain unchanged');
assert.equal(norm1Parsed.fr, 60, 'fr must remain unchanged');

const norm2Result = normalizeLottieJsonForConverter(
  {fr: 60, ip: 30, op: 90, v: '5.7.4'},
  'test2.tgs',
);
const norm2Parsed = JSON.parse(norm2Result);
assert.equal(norm2Parsed.op, 89, 'op=90 with ip=30 must normalize to op=89');
assert.equal(norm2Parsed.ip, 30, 'non-zero ip must remain unchanged');

// Error cases for normalization
assert.throws(
  () => normalizeLottieJsonForConverter('not an object', 'bad-root.tgs'),
  /Invalid TGS content in "bad-root\.tgs"/,
);
assert.throws(
  () => normalizeLottieJsonForConverter(null, 'null-root.tgs'),
  /Invalid TGS content in "null-root\.tgs"/,
);
assert.throws(
  () => normalizeLottieJsonForConverter([], 'array-root.tgs'),
  /Invalid TGS content in "array-root\.tgs"/,
);
assert.throws(
  () => normalizeLottieJsonForConverter({fr: 0, ip: 0, op: 60}, 'bad-fr.tgs'),
  /Invalid TGS frame rate .* in "bad-fr\.tgs"/,
);
assert.throws(
  () => normalizeLottieJsonForConverter({fr: -10, ip: 0, op: 60}, 'neg-fr.tgs'),
  /Invalid TGS frame rate .* in "neg-fr\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: '60', ip: 0, op: 60},
      'str-num-fr.tgs',
    ),
  /Invalid TGS frame rate .* in "str-num-fr\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 'invalid', ip: 0, op: 60},
      'str-fr.tgs',
    ),
  /Invalid TGS frame rate .* in "str-fr\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: '0', op: 60},
      'str-num-ip.tgs',
    ),
  /Invalid TGS in-point .* in "str-num-ip\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter({fr: 60, ip: null, op: 60}, 'null-ip.tgs'),
  /Invalid TGS in-point .* in "null-ip\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter({fr: 60, ip: false, op: 60}, 'bool-ip.tgs'),
  /Invalid TGS in-point .* in "bool-ip\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: 'invalid', op: 60},
      'bad-ip.tgs',
    ),
  /Invalid TGS in-point .* in "bad-ip\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: 0, op: '60'},
      'str-num-op.tgs',
    ),
  /Invalid TGS out-point .* in "str-num-op\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: 0, op: 'invalid'},
      'bad-op.tgs',
    ),
  /Invalid TGS out-point .* in "bad-op\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: 10, op: 10},
      'equal-range.tgs',
    ),
  /Invalid TGS frame range .* in "equal-range\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter(
      {fr: 60, ip: 10, op: 5},
      'inverted-range.tgs',
    ),
  /Invalid TGS frame range .* in "inverted-range\.tgs"/,
);
assert.throws(
  () =>
    normalizeLottieJsonForConverter({fr: 60, ip: 10, op: 11}, 'too-short.tgs'),
  /TGS duration too short for converter normalization .* in "too-short\.tgs"/,
);

// Test prepareTgsForLottieConverter file creation, decompression, and error handling
const normTestDir = await fsp.mkdtemp(path.join(tempDir, 'tgs-norm-test-'));
const normValidTgs = path.join(normTestDir, 'valid.tgs');
await fsp.writeFile(
  normValidTgs,
  gzipSync(Buffer.from(JSON.stringify({fr: 60, ip: 0, op: 60, v: '5.7.4'}))),
);
const preparedValidPath = await prepareTgsForLottieConverter(normValidTgs);
assert.ok(fs.existsSync(preparedValidPath), 'Prepared TGS file must exist');
assert.ok(
  preparedValidPath.includes('.lottieconverter-'),
  'Prepared TGS path must include .lottieconverter- marker',
);
await fsp.unlink(preparedValidPath);

const normCorruptTgs = path.join(normTestDir, 'corrupt.tgs');
await fsp.writeFile(normCorruptTgs, Buffer.from('not gzip data'));
await assert.rejects(async () => {
  await prepareTgsForLottieConverter(normCorruptTgs);
}, /Failed to decompress TGS gzip payload from ".*corrupt\.tgs"/);

// Test 1: convertTgsToGif cleans up normalized temporary file on encoder failure
const failingConvInput = path.join(normTestDir, 'failing-conv.tgs');
await fsp.writeFile(
  failingConvInput,
  gzipSync(Buffer.from(JSON.stringify({fr: 60, ip: 0, op: 60}))),
);
const failingConvOutput = path.join(normTestDir, 'failing-out.gif');

let observedPreparedInput: string | undefined;
const failingNormEncoder: GifEncoder = async preparedInput => {
  observedPreparedInput = preparedInput;
  assert.notEqual(preparedInput, failingConvInput);
  assert.ok(preparedInput.includes('.lottieconverter-'));
  assert.ok(fs.existsSync(preparedInput));
  throw new Error('simulated failure inside encoder');
};

await assert.rejects(async () => {
  await convertTgsToGif(
    failingConvInput,
    failingConvOutput,
    failingNormEncoder,
  );
}, /simulated failure inside encoder/);
assert.ok(observedPreparedInput, 'Prepared input path must have been observed');
assert.equal(
  fs.existsSync(observedPreparedInput),
  false,
  'Prepared TGS must be removed after encoder failure',
);
assert.deepEqual(
  (await fsp.readdir(normTestDir)).filter(f => f.includes('.lottieconverter-')),
  [],
  'Normalized temporary files must be cleaned up even on encoder failure',
);

// Test 2 (Regression A): successful conversion + non-ENOENT cleanup failure => rejects (does not pretend success)
const cleanupFailInput = path.join(normTestDir, 'cleanup-fail-conv.tgs');
await fsp.writeFile(
  cleanupFailInput,
  gzipSync(Buffer.from(JSON.stringify({fr: 60, ip: 0, op: 60}))),
);
const cleanupFailOutput = path.join(normTestDir, 'cleanup-fail-out.gif');
let observedCleanupFailPreparedInput: string | undefined;
const cleanupFailEncoder: GifEncoder = async (preparedInput, candidatePath) => {
  observedCleanupFailPreparedInput = preparedInput;
  assert.notEqual(preparedInput, cleanupFailInput);
  assert.ok(preparedInput.includes('.lottieconverter-'));
  assert.ok(fs.existsSync(preparedInput));
  // Replace prepared file with a directory so subsequent unlink in removePreparedTgs fails with non-ENOENT (EISDIR/EPERM)
  await fsp.unlink(preparedInput);
  await fsp.mkdir(preparedInput);
  // Encoder itself succeeds by producing a candidate under GIF_TARGET_BYTES
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(candidatePath, 1_000);
};

try {
  await assert.rejects(
    async () => {
      await convertTgsToGif(
        cleanupFailInput,
        cleanupFailOutput,
        cleanupFailEncoder,
      );
    },
    err => {
      assert.ok(err instanceof Error);
      return true;
    },
  );
} finally {
  if (observedCleanupFailPreparedInput) {
    await fsp.rm(observedCleanupFailPreparedInput, {
      recursive: true,
      force: true,
    });
  }
  await fsp.rm(cleanupFailOutput, {force: true}).catch(() => {});
}
assert.deepEqual(
  (await fsp.readdir(normTestDir)).filter(f => f.includes('.lottieconverter-')),
  [],
  'No .lottieconverter-* files remain after Regression Test A',
);

// Test 3 (Regression B): primary conversion error + non-ENOENT cleanup failure => preserves original conversion error
const cleanupErrorInput = path.join(normTestDir, 'cleanup-error-conv.tgs');
await fsp.writeFile(
  cleanupErrorInput,
  gzipSync(Buffer.from(JSON.stringify({fr: 60, ip: 0, op: 60}))),
);
const cleanupErrorOutput = path.join(normTestDir, 'cleanup-error-out.gif');
const primaryError = new Error('primary simulated encoder failure');
let observedCleanupErrorPreparedInput: string | undefined;
const cleanupErrorEncoder: GifEncoder = async preparedInput => {
  observedCleanupErrorPreparedInput = preparedInput;
  assert.ok(fs.existsSync(preparedInput));
  // Replace prepared file with a directory so cleanup unlink also fails
  await fsp.unlink(preparedInput);
  await fsp.mkdir(preparedInput);
  throw primaryError;
};

try {
  await assert.rejects(
    async () => {
      await convertTgsToGif(
        cleanupErrorInput,
        cleanupErrorOutput,
        cleanupErrorEncoder,
      );
    },
    err => {
      assert.equal(
        err,
        primaryError,
        'Caller must receive the exact primary error object, not masked by cleanup failure',
      );
      return true;
    },
  );
} finally {
  if (observedCleanupErrorPreparedInput) {
    await fsp.rm(observedCleanupErrorPreparedInput, {
      recursive: true,
      force: true,
    });
  }
  await fsp.rm(cleanupErrorOutput, {force: true}).catch(() => {});
}
assert.deepEqual(
  (await fsp.readdir(normTestDir)).filter(f => f.includes('.lottieconverter-')),
  [],
  'No .lottieconverter-* files remain after Regression Test B',
);
console.log(
  'Verified: TGS normalization logic, duration handling, and edge cases pass',
);

console.log('Testing StickerPack Metadata module...');
assert.deepEqual(
  DEFAULT_STICKER_PACK_METADATA,
  {visibility: 'unlisted'},
  'Default sticker pack metadata must be unlisted',
);
assert.equal(
  getStickerPackMetadataPath('test_pack'),
  generateStickerPackMetadataPath('test_pack'),
  'getStickerPackMetadataPath and generateStickerPackMetadataPath must return identical paths',
);
assert.ok(
  getStickerPackMetadataPath('test_pack').endsWith('test_pack.meta.json'),
  'Metadata path must end with <pack>.meta.json',
);
assert.equal(isValidStickerPackName('Valid_Pack_123'), true);
assert.equal(isValidStickerPackName('../traversal'), false);
assert.equal(isValidStickerPackName('pack with space'), false);
assert.equal(isValidStickerPackName('pack.meta.json'), false);

assert.deepEqual(normalizeStoredMetadata(null), {});
assert.deepEqual(normalizeStoredMetadata('string'), {});
assert.deepEqual(normalizeStoredMetadata([]), {});
assert.deepEqual(normalizeStoredMetadata({}), {});
assert.deepEqual(normalizeStoredMetadata({visibility: 'public'}), {
  visibility: 'public',
});
assert.deepEqual(normalizeStoredMetadata({visibility: 'unlisted'}), {
  visibility: 'unlisted',
});
assert.deepEqual(normalizeStoredMetadata({visibility: 'invalid'}), {});

// Case 1: Missing .meta.json
const case1Meta = await getStickerPackMetadata('NonExistentMetaPack');
assert.deepEqual(
  case1Meta,
  {visibility: 'unlisted'},
  'Case 1: missing .meta.json must resolve to unlisted',
);

// Case 2: JSON {"visibility": "public"}
const case2Path = getStickerPackMetadataPath('PublicMetaPack');
await fsp.writeFile(case2Path, JSON.stringify({visibility: 'public'}));
const case2Meta = await getStickerPackMetadata('PublicMetaPack');
assert.deepEqual(
  case2Meta,
  {visibility: 'public'},
  'Case 2: public visibility must resolve to public',
);

// Case 3: JSON {"visibility": "unlisted"}
const case3Path = getStickerPackMetadataPath('UnlistedMetaPack');
await fsp.writeFile(case3Path, JSON.stringify({visibility: 'unlisted'}));
const case3Meta = await getStickerPackMetadata('UnlistedMetaPack');
assert.deepEqual(
  case3Meta,
  {visibility: 'unlisted'},
  'Case 3: unlisted visibility must resolve to unlisted',
);

// Case 4: JSON {"visibility": "invalid"}
const case4Path = getStickerPackMetadataPath('InvalidMetaPack');
await fsp.writeFile(case4Path, JSON.stringify({visibility: 'invalid'}));
const case4Meta = await getStickerPackMetadata('InvalidMetaPack');
assert.deepEqual(
  case4Meta,
  {visibility: 'unlisted'},
  'Case 4: invalid visibility must resolve to unlisted',
);

// Case 5: Valid JSON object without visibility
const case5Path = getStickerPackMetadataPath('FutureMetaPack');
await fsp.writeFile(case5Path, JSON.stringify({someFutureField: 123}));
const case5Meta = await getStickerPackMetadata('FutureMetaPack');
assert.deepEqual(
  case5Meta,
  {visibility: 'unlisted'},
  'Case 5: JSON without visibility must resolve to unlisted',
);

// Case 6: Preserving unknown fields on update
const case6Path = getStickerPackMetadataPath('PreserveMetaPack');
await fsp.writeFile(
  case6Path,
  JSON.stringify({
    visibility: 'unlisted',
    featured: true,
    tags: ['anime'],
  }),
);
await updateStickerPackMetadata('PreserveMetaPack', {visibility: 'public'});
const rawCase6 = JSON.parse(await fsp.readFile(case6Path, 'utf8'));
assert.equal(
  rawCase6.visibility,
  'public',
  'Case 6: visibility updated to public',
);
assert.equal(rawCase6.featured, true, 'Case 6: featured field preserved');
assert.deepEqual(rawCase6.tags, ['anime'], 'Case 6: tags field preserved');
const resolvedCase6 = await getStickerPackMetadata('PreserveMetaPack');
assert.deepEqual(
  resolvedCase6,
  {visibility: 'public'},
  'Case 6: resolved metadata returns typed public',
);

// Malformed JSON handling
const malformedPath = getStickerPackMetadataPath('MalformedMetaPack');
await fsp.writeFile(malformedPath, '{ this is not valid json');
const malformedRes = await getStickerPackMetadata('MalformedMetaPack');
assert.deepEqual(
  malformedRes,
  {visibility: 'unlisted'},
  'Malformed metadata must not throw and must resolve to unlisted',
);
await updateStickerPackMetadata('MalformedMetaPack', {visibility: 'public'});
const repairedRaw = JSON.parse(await fsp.readFile(malformedPath, 'utf8'));
assert.equal(
  repairedRaw.visibility,
  'public',
  'Update on malformed metadata repairs to valid JSON',
);

// Explicit file creation
await updateStickerPackMetadata('CreatedPublicPack', {visibility: 'public'});
assert.ok(fs.existsSync(getStickerPackMetadataPath('CreatedPublicPack')));
assert.deepEqual(
  JSON.parse(
    await fsp.readFile(getStickerPackMetadataPath('CreatedPublicPack'), 'utf8'),
  ),
  {visibility: 'public'},
);
await updateStickerPackMetadata('CreatedUnlistedPack', {
  visibility: 'unlisted',
});
assert.ok(fs.existsSync(getStickerPackMetadataPath('CreatedUnlistedPack')));
assert.deepEqual(
  JSON.parse(
    await fsp.readFile(
      getStickerPackMetadataPath('CreatedUnlistedPack'),
      'utf8',
    ),
  ),
  {visibility: 'unlisted'},
);

// Concurrent updates with preserved unknown fields and deterministic ordering
const concurrentPath = getStickerPackMetadataPath('ConcurrentPack');
await fsp.writeFile(
  concurrentPath,
  JSON.stringify({
    visibility: 'unlisted',
    featured: true,
    tags: ['anime'],
  }),
);
const concurrentResults = await Promise.all([
  updateStickerPackMetadata('ConcurrentPack', {visibility: 'public'}),
  updateStickerPackMetadata('ConcurrentPack', {visibility: 'unlisted'}),
  updateStickerPackMetadata('ConcurrentPack', {visibility: 'public'}),
]);
assert.equal(
  concurrentResults[0].visibility,
  'public',
  'Concurrent update 0 must return public',
);
assert.equal(
  concurrentResults[1].visibility,
  'unlisted',
  'Concurrent update 1 must return unlisted',
);
assert.equal(
  concurrentResults[2].visibility,
  'public',
  'Concurrent update 2 must return public',
);
assert.ok(fs.existsSync(concurrentPath));
const concurrentRaw = JSON.parse(await fsp.readFile(concurrentPath, 'utf8'));
assert.equal(
  concurrentRaw.visibility,
  'public',
  'Final raw visibility must be public',
);
assert.equal(concurrentRaw.featured, true, 'Featured field must be preserved');
assert.deepEqual(concurrentRaw.tags, ['anime'], 'Tags field must be preserved');

// Non-ENOENT read error during update must throw instead of resetting
const dirAsMetaPack = 'DirAsMetaPack';
const dirAsMetaPath = getStickerPackMetadataPath(dirAsMetaPack);
await fsp.mkdir(dirAsMetaPath);
await assert.rejects(
  async () => {
    await updateStickerPackMetadata(dirAsMetaPack, {visibility: 'public'});
  },
  /EISDIR|EPERM|EACCES|illegal operation/i,
  'Non-ENOENT read error must be rethrown and not swallowed as empty metadata',
);
await fsp.rmdir(dirAsMetaPath);

// Pack name rejection
await assert.rejects(
  async () => {
    await updateStickerPackMetadata('../traversal', {visibility: 'public'});
  },
  /Invalid sticker pack name/,
  'Invalid pack name must be rejected by updateStickerPackMetadata',
);
console.log('Verified: StickerPack Metadata module passes all invariant tests');

console.log('Testing Public Catalog and GET /api/stickerpacks...');
const publicPack1Name = 'PublicCatalogPack';
const publicPack1ManifestPath = generateStickerPackFilePath(publicPack1Name);
await fsp.writeFile(
  publicPack1ManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${publicPack1Name}`,
    title: 'Public Catalog Pack',
    stickers: [
      {
        id: 's1',
        image: `https://stickers.example.com/sticker/telegram/${publicPack1Name}/s1.gif`,
        previewImage: `https://stickers.example.com/preview/telegram/${publicPack1Name}/s1.webp`,
      },
    ],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${publicPack1Name}/logo.gif`,
      previewImage: `https://stickers.example.com/preview/telegram/${publicPack1Name}/logo.webp`,
      isAnimated: true,
    },
  }),
);
await fsp.writeFile(
  getStickerPackMetadataPath(publicPack1Name),
  JSON.stringify({visibility: 'public'}),
);

const publicPack2Name = 'PublicCatalogNoPreviewPack';
const publicPack2ManifestPath = generateStickerPackFilePath(publicPack2Name);
await fsp.writeFile(
  publicPack2ManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${publicPack2Name}`,
    title: 'Public Catalog No Preview Pack',
    stickers: [
      {
        id: 's1',
        image: `https://stickers.example.com/sticker/telegram/${publicPack2Name}/s1.gif`,
      },
      {
        id: 's2',
        image: `https://stickers.example.com/sticker/telegram/${publicPack2Name}/s2.gif`,
      },
    ],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${publicPack2Name}/logo.gif`,
    },
  }),
);
await fsp.writeFile(
  getStickerPackMetadataPath(publicPack2Name),
  JSON.stringify({visibility: 'public'}),
);

const unlistedPackName = 'UnlistedCatalogPack';
const unlistedPackManifestPath = generateStickerPackFilePath(unlistedPackName);
await fsp.writeFile(
  unlistedPackManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${unlistedPackName}`,
    title: 'Unlisted Catalog Pack',
    stickers: [{id: 'u1'}],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${unlistedPackName}/logo.gif`,
    },
  }),
);
await fsp.writeFile(
  getStickerPackMetadataPath(unlistedPackName),
  JSON.stringify({visibility: 'unlisted'}),
);

const noMetaPackName = 'NoMetadataCatalogPack';
const noMetaPackManifestPath = generateStickerPackFilePath(noMetaPackName);
await fsp.writeFile(
  noMetaPackManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${noMetaPackName}`,
    title: 'No Metadata Catalog Pack',
    stickers: [{id: 'n1'}],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${noMetaPackName}/logo.gif`,
    },
  }),
);

const brokenPublicPackName = 'BrokenPublicCatalogPack';
const brokenPublicManifestPath =
  generateStickerPackFilePath(brokenPublicPackName);
await fsp.writeFile(brokenPublicManifestPath, 'not valid json');
await fsp.writeFile(
  getStickerPackMetadataPath(brokenPublicPackName),
  JSON.stringify({visibility: 'public'}),
);

const brokenMetaPackName = 'BrokenMetaPublicCatalogPack';
const brokenMetaManifestPath = generateStickerPackFilePath(brokenMetaPackName);
await fsp.writeFile(
  brokenMetaManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${brokenMetaPackName}`,
    title: 'Broken Meta Pack',
    stickers: [{id: 'bm1'}],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${brokenMetaPackName}/logo.gif`,
    },
  }),
);
await fsp.writeFile(
  getStickerPackMetadataPath(brokenMetaPackName),
  '{ not valid json',
);

const catalogPacks = await getPublicStickerPacks();
assert.equal(
  catalogPacks.length,
  2,
  'Catalog must contain exactly the 2 valid public packs',
);
assert.deepEqual(
  catalogPacks.map(p => p.name),
  [publicPack2Name, publicPack1Name],
  'Catalog must sort packs alphabetically by name',
);

const pubSummary1 = catalogPacks.find(p => p.name === publicPack1Name)!;
assert.equal(pubSummary1.id, `MoreStickers:Telegram:Pack:${publicPack1Name}`);
assert.equal(pubSummary1.title, 'Public Catalog Pack');
assert.equal(pubSummary1.stickerCount, 1);
assert.equal(
  pubSummary1.url,
  `https://stickers.example.com/stickerpack/telegram/${publicPack1Name}`,
);
assert.equal(
  pubSummary1.preview,
  `https://stickers.example.com/preview/telegram/${publicPack1Name}/logo.webp`,
  'Public pack with previewImage must use previewImage',
);
assert.equal(
  pubSummary1.animatedPreview,
  `https://stickers.example.com/sticker/telegram/${publicPack1Name}/logo.gif`,
  'Animated public pack must expose its animated logo',
);

const pubSummary2 = catalogPacks.find(p => p.name === publicPack2Name)!;
assert.equal(pubSummary2.stickerCount, 2);
assert.equal(
  pubSummary2.preview,
  `https://stickers.example.com/sticker/telegram/${publicPack2Name}/logo.gif`,
  'Public pack without previewImage must fallback to logo.image',
);
assert.equal(
  pubSummary2.animatedPreview,
  undefined,
  'Static public pack must not expose an animated logo',
);

const apiResponse = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    origin: 'https://discord.com',
  },
});
assert.equal(
  apiResponse.statusCode,
  200,
  'GET /api/stickerpacks must return 200',
);
assert.equal(
  apiResponse.headers['content-type'],
  'application/json; charset=utf-8',
  'GET /api/stickerpacks Content-Type must be application/json; charset=utf-8',
);
assert.equal(
  apiResponse.headers['cache-control'],
  'no-cache',
  'GET /api/stickerpacks Cache-Control must be no-cache',
);
assert.equal(
  apiResponse.headers['access-control-allow-origin'],
  '*',
  'GET /api/stickerpacks must include CORS *',
);
const apiPacks = JSON.parse(apiResponse.body);
assert.equal(
  apiPacks.length,
  2,
  'API response must contain exactly 2 public packs',
);
assert.deepEqual(
  apiPacks.map((p: {name: string}) => p.name),
  [publicPack2Name, publicPack1Name],
);

// Direct unlisted access
const unlistedManifestResp = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${unlistedPackName}`,
});
assert.equal(
  unlistedManifestResp.statusCode,
  200,
  'Unlisted pack direct manifest GET must return 200',
);
assert.equal(
  unlistedManifestResp.headers['content-type'],
  'application/json; charset=utf-8',
);
assert.ok(
  String(unlistedManifestResp.headers['content-disposition']).includes(
    `${unlistedPackName}.stickerpack`,
  ),
);
const parsedUnlistedManifest = JSON.parse(unlistedManifestResp.body);
assert.equal(
  parsedUnlistedManifest.id,
  `MoreStickers:Telegram:Pack:${unlistedPackName}`,
);

// Dynamic update without server restart
await updateStickerPackMetadata(unlistedPackName, {visibility: 'public'});
const dynamicPublicResp = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
});
const dynamicPublicPacks = JSON.parse(dynamicPublicResp.body);
assert.equal(
  dynamicPublicPacks.some((p: {name: string}) => p.name === unlistedPackName),
  true,
  'Dynamically public pack must appear in catalog without restart',
);
await updateStickerPackMetadata(unlistedPackName, {visibility: 'unlisted'});
const dynamicUnlistedResp = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
});
const dynamicUnlistedPacks = JSON.parse(dynamicUnlistedResp.body);
assert.equal(
  dynamicUnlistedPacks.some((p: {name: string}) => p.name === unlistedPackName),
  false,
  'Dynamically unlisted pack must disappear from catalog without restart',
);
console.log(
  'Verified: Public Catalog and /api/stickerpacks endpoint pass all tests',
);

console.log('Testing Public Browser GET / HTML endpoint...');
const rootGetResponse = await app.inject({
  method: 'GET',
  url: '/',
  headers: {
    origin: 'https://discord.com',
  },
});
assert.equal(rootGetResponse.statusCode, 200, 'GET / must return status 200');
assert.equal(
  rootGetResponse.headers['content-type'],
  'text/html; charset=utf-8',
  'GET / Content-Type must be text/html; charset=utf-8',
);
assert.equal(
  rootGetResponse.headers['cache-control'],
  'no-cache',
  'GET / Cache-Control must be no-cache',
);
assert.equal(
  rootGetResponse.headers['access-control-allow-origin'],
  '*',
  'GET / must include CORS header Access-Control-Allow-Origin: *',
);

const rootHtml = rootGetResponse.body;
assert.ok(
  rootHtml.includes('MoreStickersConverter'),
  'HTML must contain MoreStickersConverter brand',
);
assert.ok(
  rootHtml.includes('id="search"'),
  'HTML must contain search input id="search"',
);
assert.ok(
  rootHtml.includes('id="tag"'),
  'HTML must contain tag select id="tag"',
);
assert.ok(
  rootHtml.includes('id="grid"'),
  'HTML must contain grid section id="grid"',
);
assert.ok(
  rootHtml.includes('id="overlay"'),
  'HTML must contain drawer overlay id="overlay"',
);
assert.ok(
  rootHtml.includes('CATALOG_API_URL'),
  'HTML must define CATALOG_API_URL',
);
assert.ok(
  rootHtml.includes('/api/stickerpacks'),
  'HTML must use /api/stickerpacks endpoint',
);

// Verify proper Unicode characters from mockup are preserved via ASCII-safe HTML entities / JS escapes
assert.ok(
  rootHtml.includes('<span>&#8981;</span>'),
  'HTML must preserve the mockup search icon via &#8981;',
);
assert.ok(
  rootHtml.includes('Loading&hellip;'),
  'HTML must preserve the initial loading ellipsis via &hellip;',
);
assert.ok(
  rootHtml.includes('aria-label="Close">&times;</button>'),
  'HTML must preserve the drawer close symbol via &times;',
);
assert.ok(
  rootHtml.includes('Loading pack manifest\\u2026'),
  'HTML must preserve the drawer loading ellipsis via \\u2026',
);
assert.ok(
  rootHtml.includes('Loading catalog\\u2026'),
  'HTML must preserve the catalog loading ellipsis via \\u2026',
);

// Verify no mojibake / question mark placeholder corruption
assert.equal(
  rootHtml.includes('<span>???</span>'),
  false,
  'HTML must NOT contain <span>???</span>',
);
assert.equal(
  rootHtml.includes('Loading???'),
  false,
  'HTML must NOT contain Loading???',
);
assert.equal(
  rootHtml.includes('Loading pack manifest???'),
  false,
  'HTML must NOT contain Loading pack manifest???',
);
assert.equal(
  rootHtml.includes('Loading catalog???'),
  false,
  'HTML must NOT contain Loading catalog???',
);
assert.equal(
  rootHtml.includes('aria-label="Close">??</button>'),
  false,
  'Close button must not contain question-mark corruption',
);

// Verify production mock data is removed
assert.equal(
  rootHtml.includes('USE_MOCK_DATA'),
  false,
  'HTML must NOT contain USE_MOCK_DATA',
);
assert.equal(
  rootHtml.includes('MOCK_PACKS'),
  false,
  'HTML must NOT contain MOCK_PACKS',
);
assert.equal(
  rootHtml.includes('svgPreview'),
  false,
  'HTML must NOT contain svgPreview mock helper',
);

console.log('Testing Public Browser HEAD / endpoint...');
const rootHeadResponse = await app.inject({
  method: 'HEAD',
  url: '/',
});
assert.equal(rootHeadResponse.statusCode, 200, 'HEAD / must return status 200');
assert.equal(rootHeadResponse.body, '', 'HEAD / body must be empty');
assert.equal(
  rootHeadResponse.headers['content-type'],
  'text/html; charset=utf-8',
  'HEAD / Content-Type must be text/html; charset=utf-8',
);
assert.equal(
  rootHeadResponse.headers['cache-control'],
  'no-cache',
  'HEAD / Cache-Control must be no-cache',
);

console.log('Testing Public Browser OPTIONS / endpoint...');
const rootOptionsResponse = await app.inject({
  method: 'OPTIONS',
  url: '/',
  headers: {
    origin: 'https://discord.com',
    'access-control-request-method': 'GET',
  },
});
assert.equal(
  rootOptionsResponse.statusCode,
  204,
  'OPTIONS / must return status 204',
);
assert.equal(
  rootOptionsResponse.headers['access-control-allow-origin'],
  '*',
  'OPTIONS / must include Access-Control-Allow-Origin: *',
);
const allowMethods = String(
  rootOptionsResponse.headers['access-control-allow-methods'] || '',
);
assert.ok(
  allowMethods.includes('GET'),
  'OPTIONS / Allow Methods must include GET',
);
assert.ok(
  allowMethods.includes('HEAD'),
  'OPTIONS / Allow Methods must include HEAD',
);
assert.ok(
  allowMethods.includes('OPTIONS'),
  'OPTIONS / Allow Methods must include OPTIONS',
);

console.log('Verified: Public Browser GET/HEAD/OPTIONS / pass all tests');

console.log('Testing Telegram visibility commands resolver and handlers...');
const cmdTestPackName = 'CommandTestPack';
await fsp.writeFile(
  generateStickerPackFilePath(cmdTestPackName),
  JSON.stringify({id: `MoreStickers:Telegram:Pack:${cmdTestPackName}`}),
);
const replyTestPackName = 'ReplyTestPack';
await fsp.writeFile(
  generateStickerPackFilePath(replyTestPackName),
  JSON.stringify({id: `MoreStickers:Telegram:Pack:${replyTestPackName}`}),
);
const explicitTestPackName = 'ExplicitTestPack';
await fsp.writeFile(
  generateStickerPackFilePath(explicitTestPackName),
  JSON.stringify({id: `MoreStickers:Telegram:Pack:${explicitTestPackName}`}),
);
const otherTestPackName = 'OtherTestPack';
await fsp.writeFile(
  generateStickerPackFilePath(otherTestPackName),
  JSON.stringify({id: `MoreStickers:Telegram:Pack:${otherTestPackName}`}),
);

function createMockContext(options: {
  userId?: string | number;
  args?: string[];
  payload?: string;
  telegram?: unknown;
  replyTo?: {sticker?: {set_name?: string}; [key: string]: unknown};
  message?: unknown;
}) {
  const replies: string[] = [];
  const ctx = {
    from: options.userId !== undefined ? {id: options.userId} : undefined,
    args: options.args,
    payload: options.payload,
    telegram: options.telegram as Telegram,
    message:
      options.message ??
      (options.replyTo
        ? {
            reply_to_message: options.replyTo,
          }
        : undefined),
    reply: async (msg: string) => {
      replies.push(msg);
    },
    replies,
  };
  return ctx;
}

const allowedUserId = '123456789';
assert.equal(isAllowedTelegramUser(allowedUserId), true);
assert.equal(isAllowedTelegramUser(987654321), true);
assert.equal(isAllowedTelegramUser('999999_unauthorized'), false);
assert.equal(isAllowedTelegramUser(undefined), false);

assert.deepEqual(
  resolveStickerPackNameFromCommand(createMockContext({args: ['ValidPack']})),
  {success: true, packName: 'ValidPack'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({args: ['Pack1', 'Pack2']}),
  ),
  {success: false, error: 'too_many_args'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({args: ['../invalid_pack']}),
  ),
  {success: false, error: 'invalid_arg'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({replyTo: {sticker: {set_name: 'RepliedPack'}}}),
  ),
  {success: true, packName: 'RepliedPack'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({replyTo: {sticker: {set_name: '../invalid'}}}),
  ),
  {success: false, error: 'invalid_arg'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({replyTo: {sticker: {}}}),
  ),
  {success: false, error: 'invalid_reply_sticker'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(createMockContext({replyTo: {text: 'hi'}})),
  {success: false, error: 'no_target'},
);
// Case A: /public CommandTestPack explicit
const ctxA = createMockContext({
  userId: allowedUserId,
  args: [cmdTestPackName],
});
const handledA = await handleVisibilityCommand(ctxA, 'public');
assert.equal(handledA, true);
assert.equal(ctxA.replies[0], `Pack "${cmdTestPackName}" is now public.`);
assert.equal(
  (await getStickerPackMetadata(cmdTestPackName)).visibility,
  'public',
);

// Case B: /unlisted CommandTestPack explicit
const ctxB = createMockContext({
  userId: allowedUserId,
  args: [cmdTestPackName],
});
const handledB = await handleVisibilityCommand(ctxB, 'unlisted');
assert.equal(handledB, true);
assert.equal(ctxB.replies[0], `Pack "${cmdTestPackName}" is now unlisted.`);
assert.equal(
  (await getStickerPackMetadata(cmdTestPackName)).visibility,
  'unlisted',
);
assert.ok(
  fs.existsSync(getStickerPackMetadataPath(cmdTestPackName)),
  'Metadata sidecar must still exist after /unlisted',
);

// Case C: /public reply to sticker
const ctxC = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {set_name: replyTestPackName}},
});
const handledC = await handleVisibilityCommand(ctxC, 'public');
assert.equal(handledC, true);
assert.equal(ctxC.replies[0], `Pack "${replyTestPackName}" is now public.`);
assert.equal(
  (await getStickerPackMetadata(replyTestPackName)).visibility,
  'public',
);

// Case D: /unlisted reply to sticker
const ctxD = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {set_name: replyTestPackName}},
});
const handledD = await handleVisibilityCommand(ctxD, 'unlisted');
assert.equal(handledD, true);
assert.equal(ctxD.replies[0], `Pack "${replyTestPackName}" is now unlisted.`);
assert.equal(
  (await getStickerPackMetadata(replyTestPackName)).visibility,
  'unlisted',
);

// Case E: Explicit argument precedence over reply
const ctxE = createMockContext({
  userId: allowedUserId,
  args: [explicitTestPackName],
  replyTo: {sticker: {set_name: otherTestPackName}},
});
const handledE = await handleVisibilityCommand(ctxE, 'public');
assert.equal(handledE, true);
assert.equal(
  (await getStickerPackMetadata(explicitTestPackName)).visibility,
  'public',
  'Explicit argument pack must be updated to public',
);
assert.equal(
  (await getStickerPackMetadata(otherTestPackName)).visibility,
  'unlisted',
  'Replied sticker pack must remain untouched when explicit arg is provided',
);

// Case F: Reply to non-sticker message
const ctxF = createMockContext({
  userId: allowedUserId,
  replyTo: {text: 'hello'},
});
const handledF = await handleVisibilityCommand(ctxF, 'public');
assert.equal(handledF, false);
assert.ok(
  ctxF.replies[0].includes('Usage: /public'),
  'Non-sticker reply must respond with usage message',
);

// Case G: Reply to sticker without set_name
const ctxG = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {}},
});
const handledG = await handleVisibilityCommand(ctxG, 'unlisted');
assert.equal(handledG, false);
assert.ok(
  ctxG.replies[0].includes('Usage: /unlisted'),
  'Sticker without set_name must respond with usage message',
);

// Case H: Nonexistent pack
const ctxH = createMockContext({
  userId: allowedUserId,
  args: ['NonExistentLocalPack'],
});
const handledH = await handleVisibilityCommand(ctxH, 'public');
assert.equal(handledH, false);
assert.equal(
  ctxH.replies[0],
  'Sticker pack "NonExistentLocalPack" does not exist locally.',
);
assert.equal(
  fs.existsSync(getStickerPackMetadataPath('NonExistentLocalPack')),
  false,
  'Nonexistent pack must not have a metadata file created',
);

// Case I: Unauthorized user
const ctxI = createMockContext({
  userId: '999999_unauthorized',
  args: [cmdTestPackName],
});
const handledI = await handleVisibilityCommand(ctxI, 'public');
assert.equal(handledI, false);
assert.equal(
  ctxI.replies.length,
  0,
  'Unauthorized command must be silently ignored',
);

// Case J: Too many args
const ctxJ = createMockContext({
  userId: allowedUserId,
  args: ['Pack1', 'Pack2'],
});
const handledJ = await handleVisibilityCommand(ctxJ, 'public');
assert.equal(handledJ, false);
assert.ok(ctxJ.replies[0].includes('Usage: /public'));

// Case K: Invalid pack name arg
const ctxK = createMockContext({
  userId: allowedUserId,
  args: ['../traversal_pack'],
});
const handledK = await handleVisibilityCommand(ctxK, 'public');
assert.equal(handledK, false);
assert.ok(ctxK.replies[0].includes('Usage: /public'));

console.log(
  'Verified: Telegram visibility commands resolver and handlers pass all tests',
);

console.log('Testing Telegram command utilities...');
assert.equal(
  formatCommandUsage('pack'),
  'Usage: /pack <pack-name>\nor reply with /pack to a sticker from the pack.',
);
assert.equal(
  formatCommandUsage('/info'),
  'Usage: /info <pack-name>\nor reply with /info to a sticker from the pack.',
);
assert.equal(formatUptime(0), '0s');
assert.equal(formatUptime(45), '45s');
assert.equal(formatUptime(120), '2m');
assert.equal(formatUptime(3660), '1h 1m');
assert.equal(formatUptime(180000), '2d 2h');

assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({payload: 'PayloadPack'}),
  ),
  {success: true, packName: 'PayloadPack'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({message: {text: '/pack TextPack'}}),
  ),
  {success: true, packName: 'TextPack'},
);
assert.deepEqual(
  resolveStickerPackNameFromCommand(
    createMockContext({message: {text: '/pack P1 P2'}}),
  ),
  {success: false, error: 'too_many_args'},
);
assert.equal(
  getTelegramStickerContentSignature('PackX', [
    {
      file_id: 'f1',
      file_unique_id: 'u1',
      emoji: '🐱',
      is_animated: false,
      is_video: false,
      width: 512,
      height: 512,
      type: 'regular',
    },
  ]),
  JSON.stringify([['MoreStickers:Telegram:Sticker:PackX:u1', '🐱']]),
);

assert.equal(validateLocalStickerPackManifest(null), null);
assert.equal(validateLocalStickerPackManifest({id: 'x'}), null);
assert.equal(
  validateLocalStickerPackManifest({id: 'x', stickers: [null]}),
  null,
);
assert.equal(
  validateLocalStickerPackManifest({
    id: 'x',
    stickers: [{id: 's1', title: 't'}],
  }) !== null,
  true,
);
console.log('Testing /pack command...');
const packTestName = 'PackTestSample';
const packManifestPath = generateStickerPackFilePath(packTestName);
const packTestDir = generateStickerPackDirPath(packTestName);
await fsp.mkdir(packTestDir, {recursive: true});
await fsp.writeFile(
  path.join(packTestDir, 'unique-id-1.webp'),
  Buffer.from('fake-webp'),
);
await fsp.mkdir(path.join(packTestDir, 'previews'), {recursive: true});
await fsp.writeFile(
  path.join(packTestDir, 'previews', 'unique-id-1.webp'),
  Buffer.from('fake-preview'),
);
await fsp.writeFile(
  packManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${packTestName}`,
    title: 'Pack Test Sample',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${packTestName}:unique-id-1`,
      image: `https://stickers.example.com/sticker/telegram/${packTestName}/unique-id-1.webp`,
      title: '🎉',
      stickerPackId: `MoreStickers:Telegram:Pack:${packTestName}`,
      filename: 'unique-id-1.webp',
      isAnimated: false,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${packTestName}:unique-id-1`,
        image: `https://stickers.example.com/sticker/telegram/${packTestName}/unique-id-1.webp`,
        title: '🎉',
        stickerPackId: `MoreStickers:Telegram:Pack:${packTestName}`,
        filename: 'unique-id-1.webp',
        isAnimated: false,
      },
    ],
    dynamic: {
      version: 1,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${packTestName}`,
    },
  }),
);
const packTestManifest = validateLocalStickerPackManifest(
  JSON.parse(await fsp.readFile(packManifestPath, 'utf8')),
);
assert.ok(packTestManifest);
await migrateLegacyStickerPack(packTestName, packTestManifest);
let getStickerSetCalled = false;
const mockTelegram = {
  getStickerSet: async (name: string) => {
    getStickerSetCalled = true;
    if (name === 'NonExistentTgPack') {
      throw new Error('400: Bad Request: STICKERSET_INVALID');
    }
    return {
      name,
      title: `Title of ${name}`,
      stickers: [
        {
          file_id: 'file-id-1',
          file_unique_id: 'unique-id-1',
          emoji: '🎉',
          is_animated: false,
          is_video: false,
        },
      ],
    };
  },
  getFileLink: async () => new URL('https://example.com/file.webp'),
} as unknown as Telegram;
// Case 1: Already downloaded local pack -> returns URL without downloading
const ctxPack1 = createMockContext({
  userId: allowedUserId,
  args: [packTestName],
  telegram: mockTelegram,
});
getStickerSetCalled = false;
const handledPack1 = await handlePackCommand(ctxPack1);
assert.equal(handledPack1, true);
assert.equal(getStickerSetCalled, true);
assert.equal(
  ctxPack1.replies[0],
  `https://stickers.example.com/stickerpack/telegram/${packTestName}`,
);

// Case 1b: Real-method reply binding regression test (issue #1)
const thisBoundReplies: string[] = [];
const thisBoundCtx = {
  from: {id: allowedUserId},
  args: [packTestName],
  telegram: mockTelegram,
  replies: thisBoundReplies,
  async reply(this: {replies: string[]}, text: string) {
    this.replies.push(text);
  },
};
const handledThisBound = await handlePackCommand(thisBoundCtx);
assert.equal(handledThisBound, true);
assert.equal(
  thisBoundReplies[0],
  `https://stickers.example.com/stickerpack/telegram/${packTestName}`,
);

// Case 1c: Missing local pack -> downloaded and manifest created
const missingPackName = 'MissingPackToDownload';
const mockDownloadTelegram = {
  getStickerSet: async (name: string) => ({
    name,
    title: 'Missing Pack Title',
    stickers: [
      {
        file_id: 'missing-file-1',
        file_unique_id: 'missing-unique-1',
        emoji: '🐱',
        is_animated: false,
        is_video: false,
      },
    ],
  }),
  getFileLink: async () => new URL('https://example.com/missing.webp'),
  getFile: async () => ({file_path: 'documents/missing.webp'}),
} as unknown as Telegram;

const sampleWebpBuffer = spawnSync('ffmpeg', [
  '-f',
  'lavfi',
  '-i',
  'color=c=blue:size=64x64:duration=1',
  '-vframes',
  '1',
  '-c:v',
  'libwebp',
  '-f',
  'webp',
  'pipe:1',
]).stdout;
const changedSampleWebpBuffer = spawnSync('ffmpeg', [
  '-f',
  'lavfi',
  '-i',
  'color=c=green:size=64x64:duration=1',
  '-vframes',
  '1',
  '-c:v',
  'libwebp',
  '-f',
  'webp',
  'pipe:1',
]).stdout;

const originalGlobalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  return new Response(sampleWebpBuffer, {
    status: 200,
    headers: {'Content-Type': 'image/webp'},
  });
}) as unknown as typeof fetch;

try {
  const ctxMissingPack = createMockContext({
    userId: allowedUserId,
    args: [missingPackName],
    telegram: mockDownloadTelegram,
  });
  const handledMissingPack = await handlePackCommand(ctxMissingPack);
  assert.equal(handledMissingPack, true);
  assert.ok(
    fs.existsSync(generateStickerPackFilePath(missingPackName)),
    'Manifest must exist after downloading missing pack',
  );
  assert.equal(
    ctxMissingPack.replies[ctxMissingPack.replies.length - 1],
    `https://stickers.example.com/stickerpack/telegram/${missingPackName}`,
  );

  // Case 1d: Download failure during /pack
  const failingDownloadPackName = 'FailingDownloadPack';
  const mockFailingDownloadTg = {
    getStickerSet: async (name: string) => ({
      name,
      title: 'Failing Download Pack',
      stickers: [
        {
          file_id: 'fail-file',
          file_unique_id: 'fail-unique',
          emoji: '💥',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
    getFileLink: async () => new URL('https://example.com/fail.webp'),
    getFile: async () => {
      throw new Error('Telegram getFile network failure');
    },
  } as unknown as Telegram;

  const ctxFailDownload = createMockContext({
    userId: allowedUserId,
    args: [failingDownloadPackName],
    telegram: mockFailingDownloadTg,
  });
  const handledFailDownload = await handlePackCommand(ctxFailDownload);
  assert.equal(handledFailDownload, false);
  assert.ok(ctxFailDownload.replies.some(r => r.includes('error')));
  assert.equal(
    fs.existsSync(generateStickerPackFilePath(failingDownloadPackName)),
    false,
  );
} finally {
  globalThis.fetch = originalGlobalFetch;
}

// Case 1e: Reply to sticker with /pack
const ctxPackReply = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {set_name: packTestName}},
  telegram: mockTelegram,
});
const handledPackReply = await handlePackCommand(ctxPackReply);
assert.equal(handledPackReply, true);
assert.equal(
  ctxPackReply.replies[0],
  `https://stickers.example.com/stickerpack/telegram/${packTestName}`,
);

// Case 2: Telegram error (sticker set not found)
const ctxPack2 = createMockContext({
  userId: allowedUserId,
  args: ['NonExistentTgPack'],
  telegram: mockTelegram,
});
const handledPack2 = await handlePackCommand(ctxPack2);
assert.equal(handledPack2, false);
assert.equal(
  ctxPack2.replies[0],
  'Error: Telegram sticker pack "NonExistentTgPack" not found.',
);

// Case 2b: importOrGetStickerPack direct helper call with ReplyContext
const directReplies: string[] = [];
const handledDirect = await importOrGetStickerPack(mockTelegram, packTestName, {
  async reply(msg: string) {
    directReplies.push(msg);
  },
});
assert.equal(handledDirect, true);
assert.equal(
  directReplies[0],
  `https://stickers.example.com/stickerpack/telegram/${packTestName}`,
);

// Case 3: Unauthorized user
const ctxPack3 = createMockContext({
  userId: 'unauthorized_id',
  args: [packTestName],
  telegram: mockTelegram,
});
const handledPack3 = await handlePackCommand(ctxPack3);
assert.equal(handledPack3, false);
assert.equal(ctxPack3.replies.length, 0);

// Case 4: Missing target usage message
const ctxPack4 = createMockContext({
  userId: allowedUserId,
  telegram: mockTelegram,
});
const handledPack4 = await handlePackCommand(ctxPack4);
assert.equal(handledPack4, false);
assert.ok(ctxPack4.replies[0].includes('Usage: /pack'));
console.log('Testing /refresh command...');
const refreshPackName = 'RefreshTestPack';
const refreshManifestPath = generateStickerPackFilePath(refreshPackName);
const refreshDir = generateStickerPackDirPath(refreshPackName);
await fsp.mkdir(refreshDir, {recursive: true});
await fsp.writeFile(
  path.join(refreshDir, 'unique-1.webp'),
  Buffer.from('fake-webp'),
);
await fsp.mkdir(path.join(refreshDir, 'previews'), {recursive: true});
await fsp.writeFile(
  path.join(refreshDir, 'previews', 'unique-1.webp'),
  Buffer.from('fake-preview'),
);
await fsp.writeFile(
  refreshManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${refreshPackName}`,
    title: 'Refresh Test Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${refreshPackName}:unique-1`,
      image: `https://stickers.example.com/sticker/telegram/${refreshPackName}/unique-1.webp`,
      title: '🐱',
      stickerPackId: `MoreStickers:Telegram:Pack:${refreshPackName}`,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${refreshPackName}:unique-1`,
        image: `https://stickers.example.com/sticker/telegram/${refreshPackName}/unique-1.webp`,
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${refreshPackName}`,
        filename: 'unique-1.webp',
        isAnimated: false,
      },
    ],
    dynamic: {
      version: 3,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${refreshPackName}`,
    },
  }),
);
const legacyRawTgsPath = path.join(refreshDir, 'unique-1.tgs');
const legacyRawWebmPath = path.join(refreshDir, 'unique-1.webm');
await fsp.writeFile(legacyRawTgsPath, 'legacy-tgs-working-file');
await fsp.writeFile(legacyRawWebmPath, 'legacy-webm-working-file');
await updateStickerPackMetadata(refreshPackName, {visibility: 'public'});
let refreshGetFileCalls = 0;
const mockRefreshTelegram = {
  getStickerSet: async (name: string) => {
    if (name === 'FailTgPack') {
      throw new Error('Telegram API error');
    }
    return {
      name,
      title: 'Refresh Test Pack',
      stickers: [
        {
          file_id: 'file-1',
          file_unique_id: 'unique-1',
          emoji: '🐱',
          is_animated: false,
          is_video: false,
        },
      ],
    };
  },
  getFileLink: async () => new URL('https://example.com/file.webp'),
  getFile: async () => {
    refreshGetFileCalls++;
    if (refreshGetFileCalls === 2) {
      let storageProbeRan = false;
      const storageProbe = withStickerStorageMutation(
        refreshPackName,
        async () => {
          storageProbeRan = true;
        },
      );
      await new Promise<void>(resolve => setImmediate(resolve));
      if (!storageProbeRan) {
        throw new Error(
          'Telegram metadata lookup ran while holding the pack storage lock',
        );
      }
      await storageProbe;
    }
    return {file_path: 'documents/file.webp'};
  },
} as unknown as Telegram;

const savedFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  return new Response(sampleWebpBuffer, {
    status: 200,
    headers: {'Content-Type': 'image/webp'},
  });
}) as unknown as typeof fetch;
try {
  // Case 1: First content-addressed publication advances legacy version 3 to 4
  const ctxRef1 = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockRefreshTelegram,
  });
  const handledRef1 = await handleRefreshCommand(ctxRef1);
  assert.equal(handledRef1, true);
  assert.ok(ctxRef1.replies.some(r => r.includes('refreshed successfully')));
  assert.ok(ctxRef1.replies.some(r => r.includes('Version: 4')));
  assert.equal(
    (await getStickerPackMetadata(refreshPackName)).visibility,
    'public',
    'Visibility must be preserved after refresh',
  );
  assert.equal(
    fs.existsSync(legacyRawTgsPath),
    false,
    'Successful regeneration must clean the unambiguous legacy TGS working file',
  );
  assert.equal(
    fs.existsSync(legacyRawWebmPath),
    false,
    'Successful regeneration must clean the unambiguous legacy WebM working file',
  );

  const ctxRef1NoChange = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockRefreshTelegram,
  });
  const handledRef1NoChange = await handleRefreshCommand(ctxRef1NoChange);
  assert.equal(handledRef1NoChange, true);
  assert.ok(
    ctxRef1NoChange.replies.some(r => r.includes('Version: 4')),
    'Identical final asset and preview hashes must not bump version',
  );
  const committedRefreshVersion4Manifest = await fsp.readFile(
    refreshManifestPath,
    'utf8',
  );

  globalThis.fetch = (async () => {
    return new Response(changedSampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as unknown as typeof fetch;
  const ctxRefAssetChange = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockRefreshTelegram,
  });
  const handledRefAssetChange = await handleRefreshCommand(ctxRefAssetChange);
  assert.equal(handledRefAssetChange, true);
  assert.ok(ctxRefAssetChange.replies.some(r => r.includes('Version: 5')));
  const refreshVersion4 = await readStickerVersionIndex(refreshPackName, 4);
  const refreshVersion5 = await readStickerVersionIndex(refreshPackName, 5);
  assert.notEqual(
    refreshVersion4?.stickers['unique-1.webp'],
    refreshVersion5?.stickers['unique-1.webp'],
    'Changed final bytes must bump version for the same sticker id and title',
  );
  assert.ok(refreshVersion5);
  const refreshVersion5Signature = refreshVersion5.signature;
  for (const ghostVersion of [6, 7, 8]) {
    await writeStickerVersionIndexAtomically(refreshPackName, {
      version: ghostVersion,
      signature: `ghost-${ghostVersion}`,
      stickers: {...refreshVersion5.stickers},
      previews: {...refreshVersion5.previews},
    });
  }
  await fsp.writeFile(refreshManifestPath, committedRefreshVersion4Manifest);
  const ctxResumePending = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockRefreshTelegram,
  });
  assert.equal(await handleRefreshCommand(ctxResumePending), true);
  assert.ok(ctxResumePending.replies.some(r => r.includes('Version: 5')));
  assert.equal(
    validateLocalStickerPackManifest(
      JSON.parse(await fsp.readFile(refreshManifestPath, 'utf8')),
    )?.dynamic?.version,
    5,
    'Matching canonical pending index must complete publication',
  );
  assert.equal(
    (await readStickerVersionIndex(refreshPackName, 5))?.signature,
    refreshVersion5Signature,
    'Matching pending index must be reused without replacement',
  );
  assert.deepEqual(
    await listStickerPackVersions(refreshPackName),
    [4, 5],
    'Resume must remove ghost indexes above the canonical pending slot',
  );

  for (const ghostVersion of [6, 7, 8]) {
    await writeStickerVersionIndexAtomically(refreshPackName, {
      version: ghostVersion,
      signature: `divergent-${ghostVersion}`,
      stickers: {...refreshVersion5.stickers},
      previews: {...refreshVersion5.previews},
    });
  }
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as unknown as typeof fetch;
  // Case 1b: Divergent pending 6 is replaced; ghosts 7 and 8 are removed
  const mockChangedRefreshTelegram = {
    getStickerSet: async (name: string) => ({
      name,
      title: 'Refresh Test Pack',
      stickers: [
        {
          file_id: 'file-1',
          file_unique_id: 'unique-1',
          emoji: '🐱',
          is_animated: false,
          is_video: false,
        },
        {
          file_id: 'file-2',
          file_unique_id: 'unique-2',
          emoji: '🐶',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
    getFileLink: async () => new URL('https://example.com/file2.webp'),
    getFile: async () => ({file_path: 'documents/file2.webp'}),
  } as unknown as Telegram;

  const ctxRef1b = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockChangedRefreshTelegram,
  });
  const handledRef1b = await handleRefreshCommand(ctxRef1b);
  assert.equal(handledRef1b, true);
  assert.ok(ctxRef1b.replies.some(r => r.includes('refreshed successfully')));
  assert.ok(ctxRef1b.replies.some(r => r.includes('Version: 6')));
  const refreshVersion6 = await readStickerVersionIndex(refreshPackName, 6);
  assert.ok(refreshVersion6);
  assert.notEqual(
    refreshVersion6.signature,
    'divergent-6',
    'Divergent unpublished content must be replaced in canonical next slot',
  );
  assert.deepEqual(
    await listStickerPackVersions(refreshPackName),
    [4, 5, 6],
    'Divergent publish must not create a version gap or retain ghost indexes',
  );

  const firstCrashPackName = 'FirstPublicationCrashPack';
  const firstCrashPackDir = generateStickerPackDirPath(firstCrashPackName);
  await fsp.mkdir(firstCrashPackDir, {recursive: true});
  const firstCrashOldSource = path.join(firstCrashPackDir, 'old.webp');
  await fsp.writeFile(firstCrashOldSource, 'old-pending-bytes');
  const firstCrashOldAsset = await storeStickerAsset(
    firstCrashPackName,
    firstCrashOldSource,
  );
  await writeStickerVersionIndexAtomically(firstCrashPackName, {
    version: 1,
    signature: 'old-first-pending',
    stickers: {'old.webp': firstCrashOldAsset},
    previews: {},
  });
  const firstCrashContext = createMockContext({
    userId: allowedUserId,
    args: [firstCrashPackName],
    telegram: mockRefreshTelegram,
  });
  assert.equal(await handleRefreshCommand(firstCrashContext), true);
  assert.ok(firstCrashContext.replies.some(r => r.includes('Version: 1')));
  const firstCrashManifest = validateLocalStickerPackManifest(
    JSON.parse(
      await fsp.readFile(
        generateStickerPackFilePath(firstCrashPackName),
        'utf8',
      ),
    ),
  );
  assert.equal(firstCrashManifest?.dynamic?.version, 1);
  assert.notEqual(
    (await readStickerVersionIndex(firstCrashPackName, 1))?.signature,
    'old-first-pending',
  );
  assert.deepEqual(await listStickerPackVersions(firstCrashPackName), [1]);

  // Case 1c: Refresh download failure preserves previous valid manifest and metadata
  const failRefreshPackName = 'RefreshDownloadFailPack';
  const failRefreshManifestPath =
    generateStickerPackFilePath(failRefreshPackName);
  const initialFailManifestContent = JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${failRefreshPackName}`,
    title: 'Initial Title',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${failRefreshPackName}:s1`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${failRefreshPackName}`,
        filename: 's1.webp',
        isAnimated: false,
      },
    ],
    dynamic: {
      version: 2,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${failRefreshPackName}`,
    },
  });
  await fsp.writeFile(failRefreshManifestPath, initialFailManifestContent);
  await updateStickerPackMetadata(failRefreshPackName, {visibility: 'public'});

  const mockFailingRefreshTg = {
    getStickerSet: async (name: string) => ({
      name,
      title: 'Initial Title',
      stickers: [
        {
          file_id: 'fail-file-id',
          file_unique_id: 's1',
          emoji: '🐱',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
    getFileLink: async () => new URL('https://example.com/fail.webp'),
    getFile: async () => {
      throw new Error('Download network error during refresh');
    },
  } as unknown as Telegram;

  const ctxRefFail = createMockContext({
    userId: allowedUserId,
    args: [failRefreshPackName],
    telegram: mockFailingRefreshTg,
  });
  const handledRefFail = await handleRefreshCommand(ctxRefFail);
  assert.equal(handledRefFail, false);
  assert.ok(ctxRefFail.replies[0].includes('Error:'));
  assert.equal(
    await fsp.readFile(failRefreshManifestPath, 'utf8'),
    initialFailManifestContent,
    'Previous manifest must not be modified or deleted on refresh failure',
  );
  assert.equal(
    (await getStickerPackMetadata(failRefreshPackName)).visibility,
    'public',
    'Metadata must remain public after failed refresh',
  );

  // Case 1d: Reply to sticker with /refresh
  const ctxRefReply = createMockContext({
    userId: allowedUserId,
    replyTo: {sticker: {set_name: refreshPackName}},
    telegram: mockRefreshTelegram,
  });
  const handledRefReply = await handleRefreshCommand(ctxRefReply);
  assert.equal(handledRefReply, true);
  assert.ok(
    ctxRefReply.replies.some(r => r.includes('refreshed successfully')),
  );

  // Case 2: Telegram error does not delete manifest or report success
  const ctxRef2 = createMockContext({
    userId: allowedUserId,
    args: ['FailTgPack'],
    telegram: mockRefreshTelegram,
  });
  const handledRef2 = await handleRefreshCommand(ctxRef2);
  assert.equal(handledRef2, false);
  assert.ok(ctxRef2.replies[0].includes('Error:'));

  // Case 3: Mid-stream static download failure during /refresh
  const midStreamPackName = 'MidStreamFailPack';
  const midStreamPackDir = generateStickerPackDirPath(midStreamPackName);
  const midStreamPreviewDir = generateStickerPreviewDirPath(midStreamPackName);
  const midStreamManifestPath = generateStickerPackFilePath(midStreamPackName);

  await fsp.mkdir(midStreamPackDir, {recursive: true});
  await fsp.mkdir(midStreamPreviewDir, {recursive: true});

  const originalAssetBytes = Buffer.from('ORIGINAL_VALID_ASSET_CONTENT_BYTES');
  const originalPreviewBytes = Buffer.from('ORIGINAL_VALID_PREVIEW_BYTES');
  const midStreamAssetPath = path.join(midStreamPackDir, 's1.webp');
  const midStreamPreviewPath = path.join(midStreamPreviewDir, 's1.webp');

  await fsp.writeFile(midStreamAssetPath, originalAssetBytes);
  await fsp.writeFile(midStreamPreviewPath, originalPreviewBytes);

  const originalManifestContent = JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${midStreamPackName}`,
    title: 'Mid Stream Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${midStreamPackName}:s1`,
        image: `https://stickers.example.com/sticker/telegram/${midStreamPackName}/s1.webp`,
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${midStreamPackName}`,
        filename: 's1.webp',
        isAnimated: false,
      },
    ],
    dynamic: {
      version: 3,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${midStreamPackName}`,
    },
  });
  await fsp.writeFile(midStreamManifestPath, originalManifestContent);
  await updateStickerPackMetadata(midStreamPackName, {visibility: 'public'});

  const mockMidStreamTg = {
    getStickerSet: async (name: string) => ({
      name,
      title: 'Mid Stream Pack',
      stickers: [
        {
          file_id: 'file-mid-fail',
          file_unique_id: 's1',
          emoji: '🐱',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
    getFileLink: async () => new URL('https://example.com/mid-fail.webp'),
    getFile: async () => ({file_path: 'documents/mid-fail.webp'}),
  } as unknown as Telegram;

  const savedFetchForMidStream = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new Uint8Array(Buffer.from('PARTIAL_INCOMING_BYTES_')),
          );
          controller.error(new Error('Network connection aborted mid-stream'));
        },
      });
      return new Response(errorStream, {
        status: 200,
        headers: {'Content-Type': 'image/webp'},
      });
    }) as typeof fetch;

    const ctxMidStream = createMockContext({
      userId: allowedUserId,
      args: [midStreamPackName],
      telegram: mockMidStreamTg,
    });
    const handledMidStream = await handleRefreshCommand(ctxMidStream);
    assert.equal(
      handledMidStream,
      false,
      'Handler must return false on mid-stream failure',
    );
    assert.ok(
      ctxMidStream.replies.some(r => r.includes('Error:')),
      'Error message must be replied',
    );
    assert.equal(
      await fsp.readFile(midStreamManifestPath, 'utf8'),
      originalManifestContent,
      'Manifest must be byte-for-byte unchanged',
    );
    assert.deepEqual(
      await fsp.readFile(midStreamAssetPath),
      originalAssetBytes,
      'Existing asset must be byte-for-byte unchanged and not truncated',
    );
    assert.deepEqual(
      await fsp.readFile(midStreamPreviewPath),
      originalPreviewBytes,
      'Existing preview must remain untouched',
    );
    assert.equal(
      (await getStickerPackMetadata(midStreamPackName)).visibility,
      'public',
      'Metadata visibility must remain public',
    );
    const remainingFiles = await fsp.readdir(midStreamPackDir);
    const tempDownloadFiles = remainingFiles.filter(
      f => f.includes('download-') || f.endsWith('.tmp'),
    );
    assert.equal(
      tempDownloadFiles.length,
      0,
      'No temporary download files must remain in pack dir',
    );
  } finally {
    globalThis.fetch = savedFetchForMidStream;
  }
} finally {
  globalThis.fetch = savedFetch;
}
console.log('Testing /check command...');
const checkPackName = 'CheckTestPack';
const checkManifestPath = generateStickerPackFilePath(checkPackName);
const checkDir = generateStickerPackDirPath(checkPackName);
await fsp.mkdir(checkDir, {recursive: true});
await fsp.writeFile(
  path.join(checkDir, 'asset-1.webp'),
  Buffer.from('fake-asset'),
);
await fsp.mkdir(path.join(checkDir, 'previews'), {recursive: true});
await fsp.writeFile(
  path.join(checkDir, 'previews', 'asset-1.webp'),
  Buffer.from('fake-preview'),
);
const checkStickerAsset = await storeStickerAsset(
  checkPackName,
  path.join(checkDir, 'asset-1.webp'),
);
const checkPreviewAsset = await storeStickerAsset(
  checkPackName,
  path.join(checkDir, 'previews', 'asset-1.webp'),
);
await writeStickerVersionIndexAtomically(checkPackName, {
  version: 2,
  signature: 'check-pack',
  stickers: {'asset-1.webp': checkStickerAsset},
  previews: {'asset-1.webp': checkPreviewAsset},
});
await fsp.writeFile(
  checkManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${checkPackName}`,
    title: 'Check Test Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${checkPackName}:asset-1`,
      image: `https://stickers.example.com/sticker/telegram/${checkPackName}/asset-1.webp`,
      title: '🐱',
      stickerPackId: `MoreStickers:Telegram:Pack:${checkPackName}`,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${checkPackName}:asset-1`,
        image: `https://stickers.example.com/sticker/telegram/${checkPackName}/asset-1.webp`,
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${checkPackName}`,
        filename: 'asset-1.webp',
        isAnimated: false,
      },
    ],
    dynamic: {
      version: 2,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${checkPackName}`,
    },
  }),
);
await updateStickerPackMetadata(checkPackName, {visibility: 'public'});

const mockCheckTelegram = {
  getStickerSet: async (name: string) => {
    if (name === checkPackName) {
      return {
        name: checkPackName,
        title: 'Check Test Pack',
        stickers: [
          {
            file_id: 'file-1',
            file_unique_id: 'asset-1',
            emoji: '🐱',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
    if (name === 'OutdatedPack') {
      return {
        name: 'OutdatedPack',
        title: 'Outdated Pack',
        stickers: [
          {
            file_id: 'file-1',
            file_unique_id: 'asset-1',
            emoji: '🐱',
            is_animated: false,
            is_video: false,
          },
          {
            file_id: 'file-2',
            file_unique_id: 'asset-2',
            emoji: '🐶',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
    if (name === 'ChangedContentPack') {
      return {
        name: 'ChangedContentPack',
        title: 'Changed Content Pack',
        stickers: [
          {
            file_id: 'file-1',
            file_unique_id: 'asset-changed-id',
            emoji: '🐱',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
    if (name === 'MissingPreviewPack') {
      return {
        name: 'MissingPreviewPack',
        title: 'Missing Preview Pack',
        stickers: [
          {
            file_id: 'file-1',
            file_unique_id: 'preview-asset-1',
            emoji: '🐱',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
    if (name === 'MissingFilenamePack') {
      return {
        name: 'MissingFilenamePack',
        title: 'Missing Filename Pack',
        stickers: [
          {
            file_id: 'file-1',
            file_unique_id: 'no-fn-1',
            emoji: '🐱',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
    throw new Error('Not found');
  },
} as unknown as Telegram;

// Case 1: Healthy pack -> reports OK
const manifestBeforeCheck = await fsp.readFile(checkManifestPath, 'utf8');
const ctxCheck1 = createMockContext({
  userId: allowedUserId,
  args: [checkPackName],
  telegram: mockCheckTelegram,
});
const handledCheck1 = await handleCheckCommand(ctxCheck1);
assert.equal(handledCheck1, true);
assert.ok(ctxCheck1.replies[0].includes('is OK and up to date'));
assert.ok(ctxCheck1.replies[0].includes('Stickers: 1'));
assert.ok(ctxCheck1.replies[0].includes('Version: 2'));
assert.ok(ctxCheck1.replies[0].includes('Visibility: public'));

// Read-only check assertion
const manifestAfterCheck = await fsp.readFile(checkManifestPath, 'utf8');
assert.equal(
  manifestAfterCheck,
  manifestBeforeCheck,
  '/check command must be strictly read-only and never modify manifest',
);

// Case 1b: Reply to sticker with /check
const ctxCheckReply = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {set_name: checkPackName}},
  telegram: mockCheckTelegram,
});
const handledCheckReply = await handleCheckCommand(ctxCheckReply);
assert.equal(handledCheckReply, true);
assert.ok(ctxCheckReply.replies[0].includes('is OK and up to date'));

// Case 2: Outdated pack (Telegram has 2 stickers, local has 1)
const outdatedPackName = 'OutdatedPack';
await fsp.writeFile(
  generateStickerPackFilePath(outdatedPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${outdatedPackName}`,
    title: 'Outdated Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${outdatedPackName}:asset-1`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${outdatedPackName}`,
        filename: 'asset-1.webp',
        isAnimated: false,
      },
    ],
  }),
);
const ctxCheck2 = createMockContext({
  userId: allowedUserId,
  args: [outdatedPackName],
  telegram: mockCheckTelegram,
});
const handledCheck2 = await handleCheckCommand(ctxCheck2);
assert.equal(handledCheck2, false);
assert.ok(ctxCheck2.replies[0].includes('is out of date'));
assert.ok(ctxCheck2.replies[0].includes('Local stickers: 1'));
assert.ok(ctxCheck2.replies[0].includes('Telegram stickers: 2'));
assert.ok(ctxCheck2.replies[0].includes('/refresh OutdatedPack'));

// Case 2b: Same sticker count (1 vs 1), but changed content signature -> out of date
const changedContentPackName = 'ChangedContentPack';
await fsp.writeFile(
  generateStickerPackFilePath(changedContentPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${changedContentPackName}`,
    title: 'Changed Content Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${changedContentPackName}:asset-original`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${changedContentPackName}`,
        filename: 'asset-1.webp',
        isAnimated: false,
      },
    ],
  }),
);
const ctxCheckChanged = createMockContext({
  userId: allowedUserId,
  args: [changedContentPackName],
  telegram: mockCheckTelegram,
});
const handledCheckChanged = await handleCheckCommand(ctxCheckChanged);
assert.equal(handledCheckChanged, false);
assert.ok(ctxCheckChanged.replies[0].includes('is out of date'));
assert.ok(ctxCheckChanged.replies[0].includes('/refresh ChangedContentPack'));

// Case 3: Missing local sticker asset file
const missingAssetPackName = 'MissingAssetPack';
await fsp.writeFile(
  generateStickerPackFilePath(missingAssetPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${missingAssetPackName}`,
    title: 'Missing Asset Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${missingAssetPackName}:missing-asset`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${missingAssetPackName}`,
        filename: 'does-not-exist.webp',
        isAnimated: false,
      },
    ],
  }),
);
const mockMissingAssetTg = {
  getStickerSet: async () => ({
    name: missingAssetPackName,
    title: 'Missing Asset Pack',
    stickers: [
      {
        file_id: 'f1',
        file_unique_id: 'missing-asset',
        emoji: '🐱',
        is_animated: false,
        is_video: false,
      },
    ],
  }),
} as unknown as Telegram;
const ctxCheck3 = createMockContext({
  userId: allowedUserId,
  args: [missingAssetPackName],
  telegram: mockMissingAssetTg,
});
const handledCheck3 = await handleCheckCommand(ctxCheck3);
assert.equal(handledCheck3, false);
assert.ok(ctxCheck3.replies[0].includes('incomplete local cache'));
assert.ok(ctxCheck3.replies[0].includes('/refresh MissingAssetPack'));

// Case 3b: Missing preview file
const missingPreviewPackName = 'MissingPreviewPack';
const missingPreviewDir = generateStickerPackDirPath(missingPreviewPackName);
await fsp.mkdir(missingPreviewDir, {recursive: true});
await fsp.writeFile(
  path.join(missingPreviewDir, 'preview-asset-1.webp'),
  Buffer.from('fake-asset'),
);
await fsp.writeFile(
  generateStickerPackFilePath(missingPreviewPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${missingPreviewPackName}`,
    title: 'Missing Preview Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${missingPreviewPackName}:preview-asset-1`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${missingPreviewPackName}`,
        filename: 'preview-asset-1.webp',
        isAnimated: false,
      },
    ],
  }),
);
const ctxCheckMissingPreview = createMockContext({
  userId: allowedUserId,
  args: [missingPreviewPackName],
  telegram: mockCheckTelegram,
});
const handledCheckMissingPreview = await handleCheckCommand(
  ctxCheckMissingPreview,
);
assert.equal(handledCheckMissingPreview, false);
assert.ok(ctxCheckMissingPreview.replies[0].includes('incomplete local cache'));
assert.ok(
  ctxCheckMissingPreview.replies[0].includes('/refresh MissingPreviewPack'),
);

// Case 3c: Versioned sticker mapping cannot fall back to a legacy direct file
const missingVersionedStickerPackName = 'MissingVersionedStickerPack';
const missingVersionedStickerDir = generateStickerPackDirPath(
  missingVersionedStickerPackName,
);
await fsp.mkdir(path.join(missingVersionedStickerDir, 'previews'), {
  recursive: true,
});
await fsp.writeFile(
  path.join(missingVersionedStickerDir, 'A.webp'),
  'legacy-sticker-leftover',
);
const missingVersionedStickerPreviewPath = path.join(
  missingVersionedStickerDir,
  'previews',
  'A.webp',
);
await fsp.writeFile(missingVersionedStickerPreviewPath, 'versioned-preview');
const missingVersionedStickerPreviewAsset = await storeStickerAsset(
  missingVersionedStickerPackName,
  missingVersionedStickerPreviewPath,
);
await writeStickerVersionIndexAtomically(missingVersionedStickerPackName, {
  version: 10,
  signature: 'missing-sticker-mapping',
  stickers: {},
  previews: {'A.webp': missingVersionedStickerPreviewAsset},
});
await fsp.writeFile(
  generateStickerPackFilePath(missingVersionedStickerPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${missingVersionedStickerPackName}`,
    title: 'Missing Versioned Sticker Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${missingVersionedStickerPackName}:A`,
        image: 'url',
        title: 'A',
        stickerPackId: `MoreStickers:Telegram:Pack:${missingVersionedStickerPackName}`,
        filename: 'A.webp',
        isAnimated: false,
      },
    ],
    dynamic: {version: 10, refreshUrl: 'url'},
  }),
);
const missingVersionedStickerContext = createMockContext({
  userId: allowedUserId,
  args: [missingVersionedStickerPackName],
  telegram: {
    getStickerSet: async () => ({
      name: missingVersionedStickerPackName,
      title: 'Missing Versioned Sticker Pack',
      stickers: [
        {
          file_id: 'A',
          file_unique_id: 'A',
          emoji: 'A',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
  } as unknown as Telegram,
});
assert.equal(
  await handleCheckCommand(missingVersionedStickerContext),
  false,
  '/check must not use a direct working file for a missing versioned sticker mapping',
);
assert.ok(
  missingVersionedStickerContext.replies[0].includes('incomplete local cache'),
);

// Case 3d: Versioned preview mapping cannot fall back to a legacy direct file
const missingVersionedPreviewPackName = 'MissingVersionedPreviewPack';
const missingVersionedPreviewDir = generateStickerPackDirPath(
  missingVersionedPreviewPackName,
);
await fsp.mkdir(path.join(missingVersionedPreviewDir, 'previews'), {
  recursive: true,
});
const missingVersionedPreviewStickerPath = path.join(
  missingVersionedPreviewDir,
  'B.webp',
);
await fsp.writeFile(missingVersionedPreviewStickerPath, 'versioned-sticker');
await fsp.writeFile(
  path.join(missingVersionedPreviewDir, 'previews', 'B.webp'),
  'legacy-preview-leftover',
);
const missingVersionedPreviewStickerAsset = await storeStickerAsset(
  missingVersionedPreviewPackName,
  missingVersionedPreviewStickerPath,
);
await writeStickerVersionIndexAtomically(missingVersionedPreviewPackName, {
  version: 10,
  signature: 'missing-preview-mapping',
  stickers: {'B.webp': missingVersionedPreviewStickerAsset},
  previews: {},
});
await fsp.writeFile(
  generateStickerPackFilePath(missingVersionedPreviewPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${missingVersionedPreviewPackName}`,
    title: 'Missing Versioned Preview Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${missingVersionedPreviewPackName}:B`,
        image: 'url',
        title: 'B',
        stickerPackId: `MoreStickers:Telegram:Pack:${missingVersionedPreviewPackName}`,
        filename: 'B.webp',
        isAnimated: false,
      },
    ],
    dynamic: {version: 10, refreshUrl: 'url'},
  }),
);
const missingVersionedPreviewContext = createMockContext({
  userId: allowedUserId,
  args: [missingVersionedPreviewPackName],
  telegram: {
    getStickerSet: async () => ({
      name: missingVersionedPreviewPackName,
      title: 'Missing Versioned Preview Pack',
      stickers: [
        {
          file_id: 'B',
          file_unique_id: 'B',
          emoji: 'B',
          is_animated: false,
          is_video: false,
        },
      ],
    }),
  } as unknown as Telegram,
});
assert.equal(
  await handleCheckCommand(missingVersionedPreviewContext),
  false,
  '/check must not use a direct working file for a missing versioned preview mapping',
);
assert.ok(
  missingVersionedPreviewContext.replies[0].includes('incomplete local cache'),
);
// Case 3c: Missing filename in manifest
const missingFilenamePackName = 'MissingFilenamePack';
await fsp.writeFile(
  generateStickerPackFilePath(missingFilenamePackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${missingFilenamePackName}`,
    title: 'Missing Filename Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${missingFilenamePackName}:no-fn-1`,
        image: 'url',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${missingFilenamePackName}`,
        isAnimated: false,
      },
    ],
  }),
);
const ctxCheckMissingFn = createMockContext({
  userId: allowedUserId,
  args: [missingFilenamePackName],
  telegram: mockCheckTelegram,
});
const handledCheckMissingFn = await handleCheckCommand(ctxCheckMissingFn);
assert.equal(handledCheckMissingFn, false);
assert.ok(ctxCheckMissingFn.replies[0].includes('incomplete local cache'));

// Case 4: Pack not downloaded locally
const ctxCheck4 = createMockContext({
  userId: allowedUserId,
  args: ['NotDownloadedPack'],
  telegram: mockCheckTelegram,
});
const handledCheck4 = await handleCheckCommand(ctxCheck4);
assert.equal(handledCheck4, false);
assert.ok(ctxCheck4.replies[0].includes('is not downloaded locally'));
assert.ok(ctxCheck4.replies[0].includes('/pack NotDownloadedPack'));

// Case 5: Malformed manifest
const malformedCheckName = 'MalformedCheckPack';
await fsp.writeFile(
  generateStickerPackFilePath(malformedCheckName),
  'invalid json content',
);
const ctxCheck5 = createMockContext({
  userId: allowedUserId,
  args: [malformedCheckName],
  telegram: mockCheckTelegram,
});
const handledCheck5 = await handleCheckCommand(ctxCheck5);
assert.equal(handledCheck5, false);
assert.ok(ctxCheck5.replies[0].includes('malformed local manifest'));

console.log('Testing /info command...');
const infoPackName = 'InfoTestPack';
await fsp.writeFile(
  generateStickerPackFilePath(infoPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${infoPackName}`,
    title: 'Info Sample Pack',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${infoPackName}:s1`,
        image: 'url1',
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${infoPackName}`,
        isAnimated: false,
      },
      {
        id: `MoreStickers:Telegram:Sticker:${infoPackName}:s2`,
        image: 'url2',
        title: '🎉',
        stickerPackId: `MoreStickers:Telegram:Pack:${infoPackName}`,
        isAnimated: true,
      },
      {
        id: `MoreStickers:Telegram:Sticker:${infoPackName}:s3`,
        image: 'url3',
        title: '🔥',
        stickerPackId: `MoreStickers:Telegram:Pack:${infoPackName}`,
        isAnimated: true,
      },
    ],
    dynamic: {
      version: 5,
      refreshUrl: `https://stickers.example.com/stickerpack/telegram/${infoPackName}`,
    },
  }),
);
await updateStickerPackMetadata(infoPackName, {visibility: 'public'});

// Case 1: Valid info command
const ctxInfo1 = createMockContext({
  userId: allowedUserId,
  args: [infoPackName],
});
const handledInfo1 = await handleInfoCommand(ctxInfo1);
assert.equal(handledInfo1, true);
const infoResp = ctxInfo1.replies[0];
assert.ok(infoResp.includes(`Pack: ${infoPackName}`));
assert.ok(infoResp.includes('Title: Info Sample Pack'));
assert.ok(infoResp.includes('Stickers: 3'));
assert.ok(infoResp.includes('Static: 1'));
assert.ok(infoResp.includes('Animated: 2'));
assert.ok(infoResp.includes('Version: 5'));
assert.ok(infoResp.includes('Visibility: public'));
assert.ok(
  infoResp.includes(
    `https://stickers.example.com/stickerpack/telegram/${infoPackName}`,
  ),
);

// Case 1b: Reply to sticker with /info
const ctxInfoReply = createMockContext({
  userId: allowedUserId,
  replyTo: {sticker: {set_name: infoPackName}},
});
const handledInfoReply = await handleInfoCommand(ctxInfoReply);
assert.equal(handledInfoReply, true);
assert.ok(ctxInfoReply.replies[0].includes(`Pack: ${infoPackName}`));

// Case 2: Legacy manifest without version -> reports Version: legacy
const legacyInfoPackName = 'LegacyInfoPack';
await fsp.writeFile(
  generateStickerPackFilePath(legacyInfoPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${legacyInfoPackName}`,
    title: 'Legacy Info Pack',
    stickers: [
      {
        id: 's1',
        image: 'url',
        title: '🐱',
        stickerPackId: 'p',
        isAnimated: false,
      },
    ],
  }),
);
const ctxInfo2 = createMockContext({
  userId: allowedUserId,
  args: [legacyInfoPackName],
});
const handledInfo2 = await handleInfoCommand(ctxInfo2);
assert.equal(handledInfo2, true);
assert.ok(ctxInfo2.replies[0].includes('Version: legacy'));

// Case 3: Nonexistent local pack
const ctxInfo3 = createMockContext({
  userId: allowedUserId,
  args: ['NonExistentInfoPack'],
});
const handledInfo3 = await handleInfoCommand(ctxInfo3);
assert.equal(handledInfo3, false);
assert.ok(ctxInfo3.replies[0].includes('does not exist locally'));
assert.ok(ctxInfo3.replies[0].includes('/pack NonExistentInfoPack'));

// Case 4: Syntactically valid JSON with invalid sticker entries (e.g. [null]) -> does not throw
const malformedStickerPackName = 'MalformedStickerInfoPack';
await fsp.writeFile(
  generateStickerPackFilePath(malformedStickerPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${malformedStickerPackName}`,
    title: 'Broken Pack',
    stickers: [null],
  }),
);
const ctxInfoMalformed = createMockContext({
  userId: allowedUserId,
  args: [malformedStickerPackName],
});
const handledInfoMalformed = await handleInfoCommand(ctxInfoMalformed);
assert.equal(handledInfoMalformed, false);
assert.ok(ctxInfoMalformed.replies[0].includes('malformed'));

console.log('Testing /stats command...');
// Construct a controlled deterministic library in DATA_DIR to verify exact stats values:
const statsFiles = await fsp.readdir(DATA_DIR);
for (const f of statsFiles) {
  if (f.endsWith('.telegram.stickerpack') || f.endsWith('.meta.json')) {
    await fsp.rm(path.join(DATA_DIR, f), {force: true});
  }
}

// Pack A: public, 2 stickers (1 static, 1 animated)
const packAName = 'PackA';
await fsp.writeFile(
  generateStickerPackFilePath(packAName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${packAName}`,
    title: 'Pack A',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${packAName}:1`,
        title: '🐱',
        isAnimated: false,
      },
      {
        id: `MoreStickers:Telegram:Sticker:${packAName}:2`,
        title: '🎉',
        isAnimated: true,
      },
    ],
  }),
);
await updateStickerPackMetadata(packAName, {visibility: 'public'});

// Pack B: unlisted, 3 stickers (2 static, 1 animated)
const packBName = 'PackB';
await fsp.writeFile(
  generateStickerPackFilePath(packBName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${packBName}`,
    title: 'Pack B',
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${packBName}:1`,
        title: '🐱',
        isAnimated: false,
      },
      {
        id: `MoreStickers:Telegram:Sticker:${packBName}:2`,
        title: '🐶',
        isAnimated: false,
      },
      {
        id: `MoreStickers:Telegram:Sticker:${packBName}:3`,
        title: '🔥',
        isAnimated: true,
      },
    ],
  }),
);
await updateStickerPackMetadata(packBName, {visibility: 'unlisted'});

// Pack C: malformed json
const packCName = 'PackC';
await fsp.writeFile(generateStickerPackFilePath(packCName), 'not valid json');

// Pack D: valid json with invalid sticker item
const packDName = 'PackD';
await fsp.writeFile(
  generateStickerPackFilePath(packDName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${packDName}`,
    title: 'Pack D',
    stickers: [null],
  }),
);

const ctxStats1 = createMockContext({userId: allowedUserId});
const handledStats1 = await handleStatsCommand(ctxStats1);
assert.equal(handledStats1, true);
const statsResp = ctxStats1.replies[0];
assert.equal(
  statsResp,
  'Sticker library statistics\n\n' +
    'Packs: 2\n' +
    'Public: 1\n' +
    'Unlisted: 1\n\n' +
    'Stickers: 5\n' +
    'Static: 3\n' +
    'Animated: 2\n\n' +
    'Invalid packs: 2',
);

// Unauthorized /stats
const ctxStats2 = createMockContext({userId: 'unauthorized_id'});
const handledStats2 = await handleStatsCommand(ctxStats2);
assert.equal(handledStats2, false);
assert.equal(ctxStats2.replies.length, 0);

console.log('Testing /status command...');
const ctxStatus1 = createMockContext({userId: allowedUserId});
const handledStatus1 = await handleStatusCommand(ctxStatus1);
assert.equal(handledStatus1, true);
const statusResp = ctxStatus1.replies[0];
assert.ok(statusResp.includes('MoreStickersConverter status'));
assert.ok(statusResp.includes('Status: OK'));
assert.ok(statusResp.includes('Uptime:'));
assert.ok(statusResp.includes(`Node.js: ${process.version}`));
assert.ok(statusResp.includes('Download concurrency: 2'));
assert.ok(statusResp.includes('Data directory: OK'));
assert.ok(statusResp.includes('External URL: configured'));
assert.equal(
  statusResp.includes(process.env.BOT_TOKEN!),
  false,
  'Status response must NOT contain BOT_TOKEN',
);
assert.equal(
  statusResp.includes('123456789'),
  false,
  'Status response must NOT contain allowed Telegram user IDs',
);

// Unauthorized /status
const ctxStatus2 = createMockContext({userId: 'unauthorized_id'});
const handledStatus2 = await handleStatusCommand(ctxStatus2);
assert.equal(handledStatus2, false);
assert.equal(ctxStatus2.replies.length, 0);

// Concurrent Test A: /refresh serialization
console.log('Testing concurrent /refresh serialization...');
const crPackName = 'ConcurrentRefreshPack';
let getStickerSetCount = 0;
let releaseFirstDownload!: () => void;
const firstDownloadGate = new Promise<void>(resolve => {
  releaseFirstDownload = resolve;
});

const crSticker1 = {
  file_id: 'cr-file-1',
  file_unique_id: 'cr_s1',
  emoji: '🐱',
  is_animated: false,
  is_video: false,
};
const crSticker2 = {
  file_id: 'cr-file-2',
  file_unique_id: 'cr_s2',
  emoji: '🐶',
  is_animated: false,
  is_video: false,
};

let firstDownloadStarted = false;
let notifyFirstDownloadStarted!: () => void;
const firstDownloadStartedPromise = new Promise<void>(resolve => {
  notifyFirstDownloadStarted = resolve;
});

const mockConcurrentRefreshTg = {
  getStickerSet: async (name: string) => {
    getStickerSetCount++;
    if (getStickerSetCount === 1) {
      return {
        name,
        title: 'Concurrent Pack V1',
        stickers: [crSticker1],
      };
    } else {
      return {
        name,
        title: 'Concurrent Pack V2',
        stickers: [crSticker1, crSticker2],
      };
    }
  },
  getFileLink: async () => new URL('https://example.com/cr.webp'),
  getFile: async (fileId: string) => {
    if (fileId === 'cr-file-1' && getStickerSetCount === 1) {
      if (!firstDownloadStarted) {
        firstDownloadStarted = true;
        notifyFirstDownloadStarted();
      }
      await firstDownloadGate;
    }
    return {file_path: `documents/${fileId}.webp`};
  },
} as unknown as Telegram;

const savedFetchForCr = globalThis.fetch;
try {
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as typeof fetch;

  const ctxCr1 = createMockContext({
    userId: allowedUserId,
    args: [crPackName],
    telegram: mockConcurrentRefreshTg,
  });
  const ctxCr2 = createMockContext({
    userId: allowedUserId,
    args: [crPackName],
    telegram: mockConcurrentRefreshTg,
  });

  // Start first refresh (will block at firstDownloadGate)
  const refresh1Promise = handleRefreshCommand(ctxCr1);

  // Wait until first refresh enters its download phase
  await firstDownloadStartedPromise;

  // Start second refresh for the SAME pack
  const refresh2Promise = handleRefreshCommand(ctxCr2);

  // Small delay to let any synchronous or eager work in refresh2 run
  await new Promise(r => setTimeout(r, 50));

  // Assert that getStickerSet was only called ONCE so far (refresh 2 is waiting in queue)
  assert.equal(
    getStickerSetCount,
    1,
    'getStickerSet must only be called once while first operation is in progress',
  );

  // Release first operation
  releaseFirstDownload();

  // Wait for both refreshes to complete
  const [res1, res2] = await Promise.all([refresh1Promise, refresh2Promise]);
  assert.equal(res1, true);
  assert.equal(res2, true);

  // Assert that getStickerSet was called twice in total
  assert.equal(
    getStickerSetCount,
    2,
    'getStickerSet must be called a second time after first operation completes',
  );

  // Read final manifest
  const finalCrManifest = validateLocalStickerPackManifest(
    JSON.parse(
      await fsp.readFile(generateStickerPackFilePath(crPackName), 'utf8'),
    ),
  );
  assert.ok(finalCrManifest);
  assert.equal(
    finalCrManifest.stickers.length,
    2,
    'Final manifest must contain 2 stickers from snapshot 2',
  );
  assert.equal(
    finalCrManifest.stickers[0].id,
    `MoreStickers:Telegram:Sticker:${crPackName}:cr_s1`,
  );
  assert.equal(
    finalCrManifest.stickers[1].id,
    `MoreStickers:Telegram:Sticker:${crPackName}:cr_s2`,
  );
  assert.ok(finalCrManifest.dynamic);
  assert.equal(
    finalCrManifest.dynamic.version,
    2,
    'Version must be incremented to 2',
  );
} finally {
  globalThis.fetch = savedFetchForCr;
}

// Concurrent Test B: concurrent /pack failure must not delete success
console.log('Testing concurrent /pack failure recovery...');
const cpFailPackName = 'ConcurrentPackFailSuccessPack';
let cpImportAttempt = 0;

const mockConcurrentPackTg = {
  getStickerSet: async (name: string) => ({
    name,
    title: 'Concurrent Pack Fail-Success',
    stickers: [
      {
        file_id: 'cp-s1-file',
        file_unique_id: 'cp_s1',
        emoji: '⭐',
        is_animated: false,
        is_video: false,
      },
    ],
  }),
  getFileLink: async () => new URL('https://example.com/cp.webp'),
  getFile: async () => {
    cpImportAttempt++;
    if (cpImportAttempt === 1) {
      throw new Error('Network error on first attempt');
    }
    return {file_path: 'documents/cp.webp'};
  },
} as unknown as Telegram;

const savedFetchForCp = globalThis.fetch;
try {
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as typeof fetch;

  const ctxCp1 = createMockContext({
    userId: allowedUserId,
    args: [cpFailPackName],
    telegram: mockConcurrentPackTg,
  });
  const ctxCp2 = createMockContext({
    userId: allowedUserId,
    args: [cpFailPackName],
    telegram: mockConcurrentPackTg,
  });

  const [res1, res2] = await Promise.all([
    handlePackCommand(ctxCp1),
    handlePackCommand(ctxCp2),
  ]);

  assert.equal(res1, false, 'First attempt must fail cleanly');
  assert.equal(res2, true, 'Second attempt must succeed');

  const cpManifestPath = generateStickerPackFilePath(cpFailPackName);
  const cpDirPath = generateStickerPackDirPath(cpFailPackName);

  await fsp.access(cpManifestPath, fs.constants.R_OK);
  await fsp.access(cpDirPath, fs.constants.R_OK);

  const finalCpManifest = validateLocalStickerPackManifest(
    JSON.parse(await fsp.readFile(cpManifestPath, 'utf8')),
  );
  assert.ok(finalCpManifest);
  assert.equal(finalCpManifest.stickers.length, 1);
  assert.ok(
    ctxCp2.replies.some(r =>
      r.includes(`/stickerpack/telegram/${cpFailPackName}`),
    ),
    'Success URL must be returned by second attempt',
  );
} finally {
  globalThis.fetch = savedFetchForCp;
}

// Concurrent Test C: different packs are not globally serialized
console.log('Testing independent pack queue concurrency...');
let packAStarted = false;
let packBStarted = false;
let releasePackA!: () => void;
let releasePackB!: () => void;
const gateA = new Promise<void>(r => {
  releasePackA = r;
});
const gateB = new Promise<void>(r => {
  releasePackB = r;
});

const opAPromise = enqueueStickerPackOperation('PackAlpha', async () => {
  packAStarted = true;
  await gateA;
  return 'resultA';
});

const opBPromise = enqueueStickerPackOperation('PackBeta', async () => {
  packBStarted = true;
  await gateB;
  return 'resultB';
});

// Give microtasks a turn to run
await new Promise(r => setTimeout(r, 20));

// Assert both operations have started concurrently before releasing either gate
assert.equal(packAStarted, true, 'PackAlpha operation must have started');
assert.equal(
  packBStarted,
  true,
  'PackBeta operation must have started concurrently',
);

releasePackA();
releasePackB();

const [resA, resB] = await Promise.all([opAPromise, opBPromise]);
assert.equal(resA, 'resultA');
assert.equal(resB, 'resultB');

// Concurrent Test D: Worker-drain on failure prevents premature lock release
console.log('Testing worker-drain failure coordination and lock safety...');
const drainPackName = 'WorkerDrainPack';
const drainEvents: string[] = [];
let releaseFailWorker!: () => void;
const failWorkerGate = new Promise<void>(r => {
  releaseFailWorker = r;
});

let releaseSlowWorker!: () => void;
const slowWorkerGate = new Promise<void>(r => {
  releaseSlowWorker = r;
});

let notifyFailWorkerStarted!: () => void;
const failWorkerStarted = new Promise<void>(r => {
  notifyFailWorkerStarted = r;
});

let notifySlowWorkerStarted!: () => void;
const slowWorkerStarted = new Promise<void>(r => {
  notifySlowWorkerStarted = r;
});

let drainGetStickerSetCount = 0;

const mockDrainTg = {
  getStickerSet: async (name: string) => {
    drainGetStickerSetCount++;
    if (drainGetStickerSetCount === 1) {
      drainEvents.push('A-getStickerSet');
      return {
        name,
        title: 'Worker Drain Pack Initial',
        stickers: [
          {
            file_id: 'fail-file-1',
            file_unique_id: 'fail_s1',
            emoji: '💥',
            is_animated: false,
            is_video: false,
          },
          {
            file_id: 'slow-file-2',
            file_unique_id: 'slow_s2',
            emoji: '⏳',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    } else {
      drainEvents.push('B-getStickerSet');
      return {
        name,
        title: 'Worker Drain Pack Final',
        stickers: [
          {
            file_id: 'b-file-1',
            file_unique_id: 'b_s1',
            emoji: '✨',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    }
  },
  getFileLink: async () => new URL('https://example.com/drain.webp'),
  getFile: async (fileId: string) => {
    if (fileId === 'fail-file-1') {
      notifyFailWorkerStarted();
      await failWorkerGate;
      throw new Error('Worker 1 intentional failure');
    }
    if (fileId === 'slow-file-2') {
      notifySlowWorkerStarted();
      await slowWorkerGate;
      drainEvents.push('A-slow-finished');
      return {file_path: 'documents/slow.webp'};
    }
    return {file_path: `documents/${fileId}.webp`};
  },
} as unknown as Telegram;

const savedFetchForDrain = globalThis.fetch;
try {
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as typeof fetch;

  let refreshASettled = false;
  const ctxDrainA = createMockContext({
    userId: allowedUserId,
    args: [drainPackName],
    telegram: mockDrainTg,
  });

  const refreshAPromise = handleRefreshCommand(ctxDrainA).finally(() => {
    refreshASettled = true;
  });

  // Wait until both workers in Refresh A have actually started
  await Promise.all([failWorkerStarted, slowWorkerStarted]);

  // Trigger failure of Worker 1
  releaseFailWorker();

  // Yield microtasks to allow Worker 1 rejection to be processed
  await new Promise(r => setTimeout(r, 20));

  // Critical assertion: Refresh A must NOT have completed yet because Worker 2 is still running
  assert.equal(
    refreshASettled,
    false,
    'Refresh A must not settle while Worker 2 is still in-flight',
  );

  // Start Refresh B for the SAME pack while Worker 2 of A is still blocked
  let refreshBSettled = false;
  const ctxDrainB = createMockContext({
    userId: allowedUserId,
    args: [drainPackName],
    telegram: mockDrainTg,
  });

  const refreshBPromise = handleRefreshCommand(ctxDrainB).finally(() => {
    refreshBSettled = true;
  });

  // Yield microtasks
  await new Promise(r => setTimeout(r, 20));

  // Assert Refresh B has not called getStickerSet yet because A still holds the lock
  assert.equal(
    drainGetStickerSetCount,
    1,
    'Refresh B must not call getStickerSet while Refresh A is still draining',
  );
  assert.equal(refreshBSettled, false);

  // Now release slow worker 2
  releaseSlowWorker();

  // Wait for both operations
  const [resA, resB] = await Promise.all([refreshAPromise, refreshBPromise]);

  assert.equal(resA, false, 'Refresh A must fail');
  assert.equal(resB, true, 'Refresh B must succeed');

  assert.equal(
    drainGetStickerSetCount,
    2,
    'Refresh B must have called getStickerSet after Refresh A drained',
  );

  const idxSlowFinished = drainEvents.indexOf('A-slow-finished');
  const idxBGetStickerSet = drainEvents.indexOf('B-getStickerSet');
  assert.ok(
    idxSlowFinished !== -1 && idxBGetStickerSet !== -1,
    'Both events must have been recorded',
  );
  assert.ok(
    idxSlowFinished < idxBGetStickerSet,
    'A-slow-finished must happen BEFORE B-getStickerSet',
  );

  // Verify final manifest corresponds to Refresh B
  const finalDrainManifest = validateLocalStickerPackManifest(
    JSON.parse(
      await fsp.readFile(generateStickerPackFilePath(drainPackName), 'utf8'),
    ),
  );
  assert.ok(finalDrainManifest);
  assert.equal(finalDrainManifest.title, 'Worker Drain Pack Final');
  assert.equal(finalDrainManifest.stickers.length, 1);
  assert.equal(
    finalDrainManifest.stickers[0].id,
    `MoreStickers:Telegram:Sticker:${drainPackName}:b_s1`,
  );

  // Check no temp files left
  const drainPackDir = generateStickerPackDirPath(drainPackName);
  const remainingFiles = await fsp.readdir(drainPackDir);
  const tempFiles = remainingFiles.filter(
    f => f.includes('download-') || f.endsWith('.tmp'),
  );
  assert.equal(tempFiles.length, 0, 'No temporary download files must remain');
} finally {
  globalThis.fetch = savedFetchForDrain;
}

console.log('Verified: All new Telegram bot commands passed all tests');
await fsp.rm(tempDir, {recursive: true, force: true});
console.log('--- All Smoke Tests Passed Successfully! ---');
