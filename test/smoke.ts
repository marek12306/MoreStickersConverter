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
  resolveStickerPackVersion,
  writeStickerPackManifestAtomically,
  enqueueManifestPublish,
  readManifestOrUndefined,
  toMcStickerPack,
} = await import('../src/utils/telegramStickers.js');
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
const {app} = await import('../src/utils/fastify.js');

console.log('--- Starting Smoke Tests in Nix Environment ---');

assert.equal(GIF_DIMENSION_SCALE, 0.5, 'GIF dimension scale must be 0.5');
assert.deepEqual(
  GIF_ENCODING_PROFILES.map(profile => profile.maxDimension),
  [192, 160, 144, 128, 112, 96, 80, 64, 48, 40],
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
assert.equal(firstWebmProfile.maxDimension, 192);
const firstWebmFilter = buildFfmpegFilter(firstWebmProfile);
assert.ok(
  firstWebmFilter.includes('min(192,iw)'),
  `Expected WebM filter to use scaled max dimension 192, got ${firstWebmFilter}`,
);
assert.ok(
  firstWebmFilter.includes('min(192,ih)'),
  `Expected WebM filter to use scaled max dimension 192, got ${firstWebmFilter}`,
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
  false,
  'Legacy sticker pack dir should have been removed',
);
assert.equal(
  fs.existsSync(legacyPackFile),
  false,
  'Legacy sticker pack file should have been removed',
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
    sticker: {filename: 'sticker.gif', isAnimated: true},
    expectedLegacy: true,
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
        image: 'https://example.test/logo.gif',
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
  false,
  'Legacy animated TGS pack directory must be removed',
);
assert.equal(
  fs.existsSync(staleAnimatedTgsPackFile),
  false,
  'Legacy animated TGS manifest must be removed',
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
  false,
  'Stale animated GIF pack directory must be removed',
);
assert.equal(
  fs.existsSync(staleGifPackFile),
  false,
  'Stale animated GIF manifest must be removed',
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
  'public, max-age=31536000',
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
  'public, max-age=31536000',
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
const webpFilePath = path.join(packDir, 'test_static.webp');
await fsp.writeFile(webpFilePath, 'dummy-webp');
const webpResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/test_static.webp`,
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
  'public, max-age=31536000',
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
const upperGifPath = path.join(packDir, 'upper.GIF');
await fsp.copyFile(testGifPath, upperGifPath);
const upperGifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/upper.GIF`,
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
const previewPackDir = generateStickerPreviewDirPath(packName);
await fsp.mkdir(previewPackDir, {recursive: true});
const previewFilePathInPack = generateStickerPreviewFilePath(
  packName,
  'test_sticker',
);
await fsp.copyFile(gifPreviewOutput, previewFilePathInPack);

// GET preview
const previewGetResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${packName}/test_sticker.webp`,
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
  'public, max-age=31536000',
  'Expected 1-year cache-control for preview',
);
assert.equal(
  previewGetResponse.headers['access-control-allow-origin'],
  '*',
  'Expected CORS * for preview',
);

// HEAD preview
const previewHeadResponse = await app.inject({
  method: 'HEAD',
  url: `/preview/telegram/${packName}/test_sticker.webp`,
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
  url: `/preview/telegram/${packName}/test_sticker.webp`,
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
  url: `/preview/telegram/${packName}/non_existent_sticker.webp`,
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
  url: `/preview/telegram/${packName}/test_sticker.gif`,
});
assert.equal(
  invalidExtPreviewResponse.statusCode,
  400,
  'Expected 400 for .gif on preview route',
);

// Double extension -> 400
const doubleExtPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${packName}/test_sticker.webp.exe`,
});
assert.equal(
  doubleExtPreviewResponse.statusCode,
  400,
  'Expected 400 for double extension on preview route',
);

// Path component -> 400
const pathCompPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${packName}/nested%2Ftest_sticker.webp`,
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

const pubSummary2 = catalogPacks.find(p => p.name === publicPack2Name)!;
assert.equal(pubSummary2.stickerCount, 2);
assert.equal(
  pubSummary2.preview,
  `https://stickers.example.com/sticker/telegram/${publicPack2Name}/logo.gif`,
  'Public pack without previewImage must fallback to logo.image',
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
  replyTo?: {sticker?: {set_name?: string}; [key: string]: unknown};
}) {
  const replies: string[] = [];
  const ctx = {
    from: options.userId !== undefined ? {id: options.userId} : undefined,
    args: options.args,
    message: {
      reply_to_message: options.replyTo,
    },
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
// Clean up temp dir
await fsp.rm(tempDir, {recursive: true, force: true});

console.log('--- All Smoke Tests Passed Successfully! ---');
