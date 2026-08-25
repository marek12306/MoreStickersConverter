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
import type {AvifEncoder} from '../src/utils/webmToAvif.js';
import type {Telegram} from 'telegraf';
const {
  AVIF_DEFAULT_FPS,
  AVIF_ENCODING_PROFILES,
  AVIF_HARD_LIMIT_BYTES,
  AVIF_MAX_DURATION_SECONDS,
  TGS_FPS_FALLBACKS,
  TGS_MAX_FPS,
  WEBM_FPS_FALLBACKS,
  WEBM_MAX_FPS,
  buildAvifEncodingProfiles,
  buildFpsCandidates,
  convertToAvifWithEncoder,
  parseFrameRate,
} = await import('../src/utils/avifConversion.js');
const {AVIF_FPS_TOLERANCE} = await import('../src/utils/avifEncoder.js');
const {
  buildAlphaFfmpegArgs,
  buildAvifFilter,
  buildAvifMuxArgs,
  buildColorFfmpegArgs,
  buildWebmFfmpegInputArgs,
  convertWebmToAvif,
  convertWebmToAvifWithEncoder,
  probeWebmSourceFps,
  validateAnimatedAvif,
} = await import('../src/utils/webmToAvif.js');
const {
  buildTgsFfmpegInputArgs,
  convertTgsToAvif,
  convertTgsToAvifWithEncoder,
  extractTgsSourceFps,
  normalizeLottieJsonForConverter,
  prepareTgsForLottieConverter,
} = await import('../src/utils/tgsToAvif.js');
const {
  buildPreviewFilter,
  buildPreviewFfmpegArgs,
  generatePreview,
  generatePreviewWithEncoder,
  PREVIEW_TARGET_BYTES,
  PREVIEW_MAX_BYTES,
  PREVIEW_PROFILES,
} = await import('../src/utils/stickerPreview.js');
const {runMediaProcess} = await import('../src/utils/mediaProcess.js');
const {
  DATA_DIR,
  isLegacyStickerPack,
  downloadStickerPack,
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
  formatByteSize,
  formatDurationSeconds,
  garbageCollectStickerAssets,
  generateStickerAssetsDirPath,
  generateStickerVersionIndexPath,
  generateStickerVersionsDirPath,
  getGarbageCollectionStatus,
  getLastGarbageCollection,
  listStickerPackVersions,
  pruneOldStickerVersions,
  readStickerVersionIndex,
  resetLastGarbageCollectionForTests,
  resolveStickerAssetPath,
  runGarbageCollection,
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
  getLastRefreshAll,
  getRefreshAllStatus,
  handleCheckCommand,
  handleGcCommand,
  handleGcDryCommand,
  handleGcStatsCommand,
  handleInfoCommand,
  handlePackCommand,
  handleRefreshAllCancelCommand,
  handleRefreshAllCommand,
  handleRefreshCommand,
  handleStatsCommand,
  handleStatusCommand,
  importOrGetStickerPack,
  refreshStickerPack,
  resetLastRefreshAllForTests,
} = await import('../src/utils/stickerPackCommands.js');
const {listLocalStickerPackNames} = await import(
  '../src/utils/stickerPackCatalog.js'
);
const {app, createEtag, ifNoneMatchMatches} = await import(
  '../src/utils/fastify.js'
);
const {
  calculateStorageSizeBytes,
  countLegacyGifPacks,
  formatStatusResponse,
  formatTimeAgo,
  getActiveDownloads,
  getActiveEncodes,
  getConverterStatusSnapshot,
  getQueueLength,
  getStorageDiagnostics,
  getToolDiagnostics,
  probeFfmpeg,
  probeLottieConverter,
  registerDownloadQueue,
  resetStorageDiagnosticsCacheForTests,
  resetToolDiagnosticsCacheForTests,
  resetWorkCountersForTests,
  withActiveDownload,
  withActiveEncode,
} = await import('../src/utils/statusDiagnostics.js');

console.log('--- Starting Smoke Tests in Nix Environment ---');

console.log('Testing createEtag and ifNoneMatchMatches contract...');
const unitEtag1 = createEtag('{"test":123}');
assert.match(
  unitEtag1,
  /^"[A-Za-z0-9_-]+"$/,
  'createEtag must return a quoted base64url SHA-256 string',
);
const unitEtag2 = createEtag('{"test":123}');
assert.equal(unitEtag1, unitEtag2, 'createEtag must be deterministic');
const unitEtag3 = createEtag('{"test":124}');
assert.notEqual(
  unitEtag1,
  unitEtag3,
  'createEtag must produce different hashes for different content',
);
const unicodeEtag = createEtag('{"title":"Zażółć gęślą jaźń 🚀"}');
assert.match(
  unicodeEtag,
  /^"[A-Za-z0-9_-]+"$/,
  'createEtag must handle Unicode UTF-8 payloads',
);

assert.equal(ifNoneMatchMatches(undefined, unitEtag1), false);
assert.equal(ifNoneMatchMatches(null, unitEtag1), false);
assert.equal(ifNoneMatchMatches('', unitEtag1), false);
assert.equal(ifNoneMatchMatches('   ', unitEtag1), false);
assert.equal(ifNoneMatchMatches('*', unitEtag1), true);
assert.equal(ifNoneMatchMatches(' * ', unitEtag1), true);
assert.equal(ifNoneMatchMatches(unitEtag1, unitEtag1), true);
assert.equal(ifNoneMatchMatches(` ${unitEtag1} `, unitEtag1), true);
assert.equal(ifNoneMatchMatches(`W/${unitEtag1}`, unitEtag1), true);
assert.equal(ifNoneMatchMatches(unitEtag1, `W/${unitEtag1}`), true);
assert.equal(
  ifNoneMatchMatches(`"other", ${unitEtag1}, "third"`, unitEtag1),
  true,
);
assert.equal(
  ifNoneMatchMatches(`"other", W/${unitEtag1}, "third"`, unitEtag1),
  true,
);
assert.equal(ifNoneMatchMatches(['"other"', unitEtag1], unitEtag1), true);
assert.equal(ifNoneMatchMatches('"other-tag"', unitEtag1), false);

// RFC 9110 strict syntax rejections -> false (fail-safe to 200, no crash)
assert.equal(
  ifNoneMatchMatches('"other", *', unitEtag1),
  false,
  'Wildcard mixed in list is invalid syntax and must return false',
);
assert.equal(
  ifNoneMatchMatches(`*, ${unitEtag1}`, unitEtag1),
  false,
  'Wildcard at start of list is invalid syntax and must return false',
);
assert.equal(
  ifNoneMatchMatches(`w/${unitEtag1}`, unitEtag1),
  false,
  'Lowercase w/ is invalid syntax and must return false',
);
assert.equal(
  ifNoneMatchMatches(`W/ ${unitEtag1}`, unitEtag1),
  false,
  'Whitespace between W/ and quote is invalid syntax and must return false',
);
assert.equal(
  ifNoneMatchMatches(`W/   ${unitEtag1}`, unitEtag1),
  false,
  'Whitespace after W/ is invalid syntax and must return false',
);
assert.equal(ifNoneMatchMatches('"unclosed', unitEtag1), false);
assert.equal(ifNoneMatchMatches('malformed no quotes', unitEtag1), false);
assert.equal(
  ifNoneMatchMatches('""', unitEtag1),
  false,
  'Empty opaque tag is valid syntax but does not match non-empty SHA-256 ETag',
);
assert.equal(
  ifNoneMatchMatches('""', '""'),
  true,
  'Empty opaque tag matches identical empty opaque tag',
);
assert.equal(ifNoneMatchMatches('"a,b", "c"', '"a,b"'), true);
assert.equal(ifNoneMatchMatches('"a,b", "c"', '"c"'), true);
assert.equal(ifNoneMatchMatches('"a,b", "c"', '"a"'), false);
console.log('Verified: createEtag and ifNoneMatchMatches contract passed');

assert.deepEqual(
  AVIF_ENCODING_PROFILES,
  [
    {maxDimension: 160, fps: 24, crf: 24, cpuUsed: 3},
    {maxDimension: 160, fps: 24, crf: 28, cpuUsed: 3},
    {maxDimension: 160, fps: 24, crf: 32, cpuUsed: 3},
    {maxDimension: 160, fps: 24, crf: 36, cpuUsed: 3},
    {maxDimension: 160, fps: 20, crf: 36, cpuUsed: 3},
    {maxDimension: 160, fps: 16, crf: 36, cpuUsed: 3},
  ],
  'AVIF profiles must exhaust 24 fps quality before FPS fallbacks',
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
const previewAvifArgs = buildPreviewFfmpegArgs(
  'input.avif',
  'preview.webp',
  PREVIEW_PROFILES[0],
  {colorStreamIndex: 2, alphaStreamIndex: 3},
);
assert.ok(previewAvifArgs.some(arg => arg.includes('[0:2][0:3]alphamerge')));
assert.ok(previewAvifArgs.some(arg => arg.includes('premultiply=inplace=1')));
assert.ok(previewAvifArgs.some(arg => arg.includes('unpremultiply=inplace=1')));
assert.deepEqual(
  previewAvifArgs.slice(
    previewAvifArgs.indexOf('-filter_complex_threads'),
    previewAvifArgs.indexOf('-filter_complex_threads') + 2,
  ),
  ['-filter_complex_threads', '1'],
);
assert.equal(
  previewAvifArgs.filter(
    (value, index) =>
      value === '-threads' && previewAvifArgs[index + 1] === '1',
  ).length,
  2,
  'Preview decoder and encoder must each receive threads=1',
);
await assert.rejects(
  runMediaProcess(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    'hung child timeout test',
    {timeoutMs: 50, killGraceMs: 50},
  ),
  /timed out/,
);
const firstWebmProfile = AVIF_ENCODING_PROFILES[0];
assert.equal(firstWebmProfile.maxDimension, 160);
const firstWebmFilter = buildAvifFilter(firstWebmProfile, 'color');
assert.ok(
  firstWebmFilter.includes('min(160,iw)'),
  `Expected WebM filter to use max dimension 160, got ${firstWebmFilter}`,
);
assert.ok(
  firstWebmFilter.includes('min(160,ih)'),
  `Expected WebM filter to use max dimension 160, got ${firstWebmFilter}`,
);
assert.ok(
  firstWebmFilter.includes('yuv420p10le'),
  `Expected ten-bit 4:2:0 color, got ${firstWebmFilter}`,
);
assert.ok(firstWebmFilter.includes('premultiply=inplace=1'));
assert.ok(firstWebmFilter.includes('unpremultiply=inplace=1'));
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
assert.equal(
  infoA.outputFileType,
  'avif',
  'Case A: outputFileType must be avif',
);
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
  'avif',
  'Case B: outputFileType must be avif for .webm fallback',
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
assert.equal(
  infoD.outputFileType,
  'avif',
  'Case D: outputFileType must be avif',
);
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
  'avif',
  'Case E: outputFileType must be avif for .tgs fallback',
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
  assert.ok(sticker.filename?.endsWith('.avif'));
  assert.equal(sticker.filename?.includes('-160'), false);
  assert.ok(sticker.image.includes(`/${manifest.dynamic?.version}/`));
  assert.ok(sticker.image.endsWith('.avif'));
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
  'Verified: Telegram manifests expose final AVIFs, static WebP, and WebP previews',
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
assert.equal(
  resolveStickerPackVersion(undefined, [stickerA], 'Some pack title'),
  1,
);
// Test 2 - identical regeneration keeps version
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA], 7),
    [stickerA],
    'Some pack title',
  ),
  7,
);
// Test 3 - pack title change increments
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA], 4),
    [stickerA],
    'Renamed pack title',
  ),
  5,
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
  resolveStickerPackVersion(
    technicalChangedPrevious,
    [stickerA],
    'Some pack title',
  ),
  5,
);
// Test 5 - emoji/title change increments
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA], 3),
    [{...stickerA, title: 'emoji-changed'}],
    'Some pack title',
  ),
  4,
);
// Test 6 - file_unique_id replacement (different id) increments
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA], 2),
    [mkSticker('xyz', 'emoji-a')],
    'Some pack title',
  ),
  3,
);
// Test 7 - add sticker increments
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA], 2),
    [stickerA, stickerB],
    'Some pack title',
  ),
  3,
);
// Test 8 - remove sticker increments
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA, stickerB], 2),
    [stickerA],
    'Some pack title',
  ),
  3,
);
// Test 9 - reorder increments (signature preserves order)
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious([stickerA, stickerB, stickerC], 2),
    [stickerB, stickerA, stickerC],
    'Some pack title',
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
  'Some pack title',
);
assert.equal(afterChange, 2);
assert.equal(
  resolveStickerPackVersion(
    versionedPrevious(changed, afterChange),
    changed,
    'Some pack title',
  ),
  2,
);
// Test 11 - legacy manifest without dynamic migrates to version 1
assert.equal(
  resolveStickerPackVersion(
    {id: 'x', stickers: [stickerA]},
    [stickerA],
    'Some pack title',
  ),
  1,
);
assert.equal(
  resolveStickerPackVersion(
    {id: 'x', dynamic: {}, stickers: [stickerA]},
    [stickerA],
    'Some pack title',
  ),
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
    () => resolveStickerPackVersion(invalidRoot, [stickerA], 'Some pack title'),
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
        'Some pack title',
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
      'Some pack title',
    ),
  /lacks a readable stickers\[\] list|refusing/,
);
assert.throws(
  () =>
    resolveStickerPackVersion(
      {dynamic: {version: 4, refreshUrl: 'u'}, stickers: [{}]},
      [stickerA],
      'Some pack title',
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
      'Some pack title',
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
      'Some pack title',
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
        'Some pack title',
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
      'Some pack title',
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

// Test 4: Generate WebM with VP9 alpha and verify animated AVIF conversion.
console.log('Generating test VP9 WebM with alpha transparency...');
const testWebmPath = path.join(tempDir, 'sample_alpha_sticker.webm');
const testAvifPath = path.join(tempDir, 'sample_alpha_sticker.avif');

const libaomHelp = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-h', 'encoder=libaom-av1'],
  {encoding: 'utf8'},
);
assert.equal(libaomHelp.status, 0, 'libaom-av1 encoder probe failed');
assert.match(libaomHelp.stdout, /yuv420p10le/);
assert.match(libaomHelp.stdout, /gray10le/);
assert.match(libaomHelp.stdout, /-row-mt/);
const avifMuxerHelp = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-h', 'muxer=avif'],
  {encoding: 'utf8'},
);
assert.equal(avifMuxerHelp.status, 0, 'AVIF muxer probe failed');
assert.match(avifMuxerHelp.stdout, /Mime type: image\/avif/);
assert.match(avifMuxerHelp.stdout, /-loop/);

const genResult = spawnSync('ffmpeg', [
  '-f',
  'lavfi',
  '-i',
  'color=c=black@0.0:size=512x512:duration=2:rate=30,format=rgba,drawbox=x=100:y=100:w=200:h=200:color=red@1.0:t=fill:replace=1,drawbox=x=350:y=200:w=100:h=100:color=blue@0.5:t=fill:replace=1,format=yuva420p',
  '-c:v',
  'libvpx-vp9',
  '-lossless',
  '1',
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

for (const args of [
  buildColorFfmpegArgs(['-i', 'input.webm'], 'color.ivf', firstWebmProfile),
  buildAlphaFfmpegArgs(['-i', 'input.webm'], 'alpha.ivf', firstWebmProfile),
]) {
  assert.deepEqual(
    args.slice(args.indexOf('-threads'), args.indexOf('-threads') + 2),
    ['-threads', '1'],
  );
  assert.deepEqual(
    args.slice(args.indexOf('-row-mt'), args.indexOf('-row-mt') + 2),
    ['-row-mt', '0'],
  );
  assert.deepEqual(
    args.slice(args.indexOf('-tiles'), args.indexOf('-tiles') + 2),
    ['-tiles', '1x1'],
  );
  assert.equal(args.includes('row-mt=1'), false);
}
const alphaArgs = buildAlphaFfmpegArgs(
  ['-i', 'input.webm'],
  'alpha.ivf',
  firstWebmProfile,
);
assert.deepEqual(
  alphaArgs.slice(alphaArgs.indexOf('-crf'), alphaArgs.indexOf('-crf') + 2),
  ['-crf', '0'],
);
assert.deepEqual(
  alphaArgs.slice(
    alphaArgs.indexOf('-aom-params'),
    alphaArgs.indexOf('-aom-params') + 2,
  ),
  ['-aom-params', 'lossless=1'],
);
const muxArgs = buildAvifMuxArgs('color.ivf', 'alpha.ivf', 'output.avif');
assert.deepEqual(
  muxArgs.slice(muxArgs.indexOf('-loop'), muxArgs.indexOf('-loop') + 2),
  ['-loop', '0'],
);
for (const inputArgs of [
  buildWebmFfmpegInputArgs('input.webm'),
  buildTgsFfmpegInputArgs('frame-%02d.png'),
]) {
  const inputIndex = inputArgs.indexOf('-i');
  assert.ok(inputIndex > 1);
  assert.deepEqual(inputArgs.slice(inputIndex - 2, inputIndex), [
    '-threads',
    '1',
  ]);
}

console.log('Testing convertWebmToAvif with libvpx-vp9 alpha decoding...');
const conversionResult = await convertWebmToAvif(testWebmPath, testAvifPath);
assert.ok(fs.existsSync(testAvifPath), 'Output AVIF file was not created');
assert.ok(
  conversionResult.sizeBytes <= AVIF_HARD_LIMIT_BYTES,
  `Output AVIF size (${conversionResult.sizeBytes}) exceeds ${AVIF_HARD_LIMIT_BYTES}`,
);
assert.equal(conversionResult.profileIndex, 0);
assert.equal(conversionResult.profile.fps, 30);
assert.equal(conversionResult.profile.crf, 24);
assert.equal(conversionResult.profile.maxDimension, 160);
const avifProbe = await validateAnimatedAvif(
  testAvifPath,
  conversionResult.profile,
);
assert.ok(
  avifProbe.colorStreamIndex > 0,
  'Validation must select the animated sequence, not primary image stream 0',
);
assert.ok(
  avifProbe.alphaStreamIndex > avifProbe.colorStreamIndex,
  'Animated AVIF must expose a separate alpha sequence',
);
assert.ok(avifProbe.frameCount > 1, 'AVIF must contain multiple frames');
assert.equal(avifProbe.colorPixelFormat, 'yuv420p10le');
assert.equal(avifProbe.alphaPixelFormat, 'gray10le');
assert.ok(avifProbe.width <= 160 && avifProbe.height <= 160);
assert.ok(avifProbe.durationSeconds <= 3);
assert.equal(avifProbe.fps, 30);
assert.equal(avifProbe.frameCount, 60);
const fakeAvifContainerPath = path.join(tempDir, 'fake-container.avif');
const fakeAvifContainerResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  testAvifPath,
  '-map',
  `0:${avifProbe.colorStreamIndex}`,
  '-map',
  `0:${avifProbe.alphaStreamIndex}`,
  '-c',
  'copy',
  '-f',
  'matroska',
  '-y',
  fakeAvifContainerPath,
]);
assert.equal(fakeAvifContainerResult.status, 0);
await assert.rejects(
  validateAnimatedAvif(fakeAvifContainerPath, conversionResult.profile),
  /invalid container/,
);

const readAvifAlphaPixel = (x: number, y: number): number => {
  const result = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    testAvifPath,
    '-map',
    `0:${avifProbe.alphaStreamIndex}`,
    '-vf',
    `select=eq(n\\,0),crop=1:1:${x}:${y},format=gray10le`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  assert.equal(
    result.status,
    0,
    `FFmpeg alpha extraction failed at (${x},${y})`,
  );
  assert.equal(result.stdout.length, 2, 'Expected one 16-bit alpha sample');
  return result.stdout.readUInt16LE(0);
};
assert.equal(readAvifAlphaPixel(0, 0), 0, 'Transparent alpha must remain zero');
assert.equal(
  readAvifAlphaPixel(
    Math.floor(avifProbe.width / 2),
    Math.floor(avifProbe.height / 2),
  ),
  1023,
  'Opaque alpha must remain fully opaque',
);
const semiAlpha = readAvifAlphaPixel(
  Math.floor(avifProbe.width * 0.78),
  Math.floor(avifProbe.height * 0.49),
);
assert.ok(
  semiAlpha >= 500 && semiAlpha <= 520,
  `Half-transparent alpha must remain near 50%, got ${semiAlpha}`,
);
console.log('Conversion result:', {
  ...conversionResult,
  probe: avifProbe,
  semiAlpha,
});
const smallLongWebmPath = path.join(tempDir, 'small_long.webm');
const smallLongAvifPath = path.join(tempDir, 'small_long.avif');
const smallLongGeneration = spawnSync('ffmpeg', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=64x48:rate=30',
  '-t',
  '4',
  '-c:v',
  'libvpx-vp9',
  '-crf',
  '24',
  '-b:v',
  '0',
  '-y',
  smallLongWebmPath,
]);
assert.equal(smallLongGeneration.status, 0);
const smallLongResult = await convertWebmToAvif(
  smallLongWebmPath,
  smallLongAvifPath,
);
const smallLongProbe = await validateAnimatedAvif(
  smallLongAvifPath,
  smallLongResult.profile,
);
assert.ok(
  smallLongProbe.width <= 64 && smallLongProbe.height <= 48,
  `Small sticker must not be upscaled, got ${smallLongProbe.width}x${smallLongProbe.height}`,
);
assert.ok(smallLongProbe.durationSeconds <= 3);
assert.ok(smallLongProbe.frameCount <= 3 * smallLongProbe.fps);
const testGifPath = path.join(tempDir, 'legacy_alpha_sticker.gif');
const legacyGifResult = spawnSync('ffmpeg', [
  '-c:v',
  'libvpx-vp9',
  '-i',
  testWebmPath,
  '-filter_complex',
  'fps=20,scale=160:160:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192:reserve_transparent=1:transparency_color=000000[p];[s1][p]paletteuse=alpha_threshold=128',
  '-loop',
  '0',
  '-y',
  testGifPath,
]);
assert.equal(legacyGifResult.status, 0, 'Failed to create legacy GIF fixture');

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
let realTgsFixturePath: string | undefined;
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
  console.log('Testing real TGS to animated AVIF conversion...');
  const tgsIntegrationDir = await fsp.mkdtemp(path.join(tempDir, 'tgs-real-'));
  const inputTgsPath = path.join(tgsIntegrationDir, 'fixture.tgs');
  realTgsFixturePath = inputTgsPath;
  const outputTgsAvifPath = path.join(tgsIntegrationDir, 'fixture.avif');
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

  const tgsResult = await convertTgsToAvif(inputTgsPath, outputTgsAvifPath);
  assert.ok(fs.existsSync(outputTgsAvifPath), 'TGS output AVIF must exist');
  assert.ok(tgsResult.sizeBytes <= AVIF_HARD_LIMIT_BYTES);
  assert.equal(tgsResult.profileIndex, 0);
  assert.equal(tgsResult.profile.fps, 60);
  const tgsProbe = await validateAnimatedAvif(
    outputTgsAvifPath,
    tgsResult.profile,
  );
  assert.equal(tgsProbe.frameCount, 60);
  assert.equal(tgsProbe.fps, 60);
  assert.ok(tgsProbe.width <= 160 && tgsProbe.height <= 160);
  console.log('TGS conversion result:', {
    sizeBytes: tgsResult.sizeBytes,
    profile: tgsResult.profile,
    profileIndex: tgsResult.profileIndex,
    probe: tgsProbe,
  });

  const readTgsAlpha = (frameIndex: number, x: number, y: number): number => {
    const result = spawnSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      outputTgsAvifPath,
      '-map',
      `0:${tgsProbe.alphaStreamIndex}`,
      '-vf',
      `select=eq(n\\,${frameIndex}),crop=1:1:${x}:${y},format=gray10le`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    assert.equal(
      result.status,
      0,
      `FFmpeg alpha extraction failed for TGS frame ${frameIndex}`,
    );
    assert.equal(result.stdout.length, 2);
    return result.stdout.readUInt16LE(0);
  };
  const animationProbeX = Math.floor(tgsProbe.width * 0.25);
  const animationProbeY = Math.floor(tgsProbe.height * 0.5);
  const transparentX = tgsProbe.width - 1;
  const transparentY = tgsProbe.height - 1;
  assert.equal(
    readTgsAlpha(0, transparentX, transparentY),
    0,
    'TGS transparent background must remain transparent',
  );
  assert.equal(
    readTgsAlpha(0, animationProbeX, animationProbeY),
    1023,
    'TGS shape must remain opaque',
  );
  assert.equal(
    readTgsAlpha(
      Math.floor(tgsProbe.frameCount / 2),
      animationProbeX,
      animationProbeY,
    ),
    0,
    'TGS moving shape must leave transparent pixels behind',
  );
  assert.equal(
    readTgsAlpha(tgsProbe.frameCount - 1, animationProbeX, animationProbeY),
    1023,
    'TGS final frame must return to its looping visual state',
  );
  const tgsTemporaryFiles = await fsp.readdir(tgsIntegrationDir);
  assert.deepEqual(
    tgsTemporaryFiles.filter(file =>
      /candidate-|lottieconverter-|lottie-frames-|avif-(?:color|alpha)-/.test(
        file,
      ),
    ),
    [],
    'TGS conversion must clean candidates, normalized input, frames, and IVF files',
  );
  console.log(
    'Verified: lottieconverter PNG frames produced a valid animated AVIF',
  );
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
    name: 'ReadyAvifPack',
    sticker: {
      filename: 'sticker.avif',
      image: 'https://example.test/sticker.avif',
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
const referencedAvifSource = path.join(storagePackDir, 'animated.avif');
const orphanAvifSource = path.join(storagePackDir, 'orphan.avif');
await fsp.writeFile(storageSourceA, 'asset-a');
await fsp.writeFile(storageSourceADuplicate, 'asset-a');
await fsp.writeFile(storageSourceBOld, 'asset-b-old');
await fsp.writeFile(storageSourceBNew, 'asset-b-new');
await fsp.writeFile(orphanSource, 'orphan');
await fsp.writeFile(referencedAvifSource, 'referenced-avif');
await fsp.writeFile(orphanAvifSource, 'orphan-avif');
const assetA = await storeStickerAsset(storagePackName, storageSourceA);
const duplicateAssetA = await storeStickerAsset(
  storagePackName,
  storageSourceADuplicate,
);
const assetBOld = await storeStickerAsset(storagePackName, storageSourceBOld);
const assetBNew = await storeStickerAsset(storagePackName, storageSourceBNew);
const orphanAsset = await storeStickerAsset(storagePackName, orphanSource);
const referencedAvifAsset = await storeStickerAsset(
  storagePackName,
  referencedAvifSource,
);
const orphanAvifAsset = await storeStickerAsset(
  storagePackName,
  orphanAvifSource,
);
assert.match(referencedAvifAsset, /^[a-f0-9]{64}\.avif$/);
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
    stickers: {'A.gif': assetA, 'B.gif': bAsset, 'C.avif': referencedAvifAsset},
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
  fs.existsSync(
    path.join(
      generateStickerAssetsDirPath(storagePackName),
      referencedAvifAsset,
    ),
  ),
  true,
  'Referenced AVIF asset must survive GC mark and sweep',
);
assert.equal(
  fs.existsSync(
    path.join(generateStickerAssetsDirPath(storagePackName), orphanAvifAsset),
  ),
  false,
  'Unreferenced AVIF asset must be swept',
);
assert.equal(
  (await fsp.readdir(generateStickerAssetsDirPath(storagePackName))).length,
  4,
  'Retained GIF and AVIF versions must store four unique assets',
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

const upstreamStaticPackName = 'UpstreamStaticStoragePack';
const upstreamStaticPackDir = generateStickerPackDirPath(
  upstreamStaticPackName,
);
await fsp.mkdir(upstreamStaticPackDir, {recursive: true});
const upstreamStaticFilename = 'upstream-static.webp';
const upstreamStaticPath = path.join(
  upstreamStaticPackDir,
  upstreamStaticFilename,
);
await generatePreview(testAvifPath, upstreamStaticPath);
const upstreamStaticSticker = {
  id: `MoreStickers:Telegram:Sticker:${upstreamStaticPackName}:upstream-static`,
  image: `https://stickers.example.com/sticker/telegram/${upstreamStaticPackName}/${upstreamStaticFilename}`,
  title: 'static',
  stickerPackId: `MoreStickers:Telegram:Pack:${upstreamStaticPackName}`,
  filename: upstreamStaticFilename,
  isAnimated: false,
};
await fsp.writeFile(
  generateStickerPackFilePath(upstreamStaticPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${upstreamStaticPackName}`,
    title: 'Upstream Static Storage Pack',
    logo: upstreamStaticSticker,
    stickers: [upstreamStaticSticker],
  }),
);
assert.equal(
  fs.existsSync(
    generateStickerPreviewFilePath(upstreamStaticPackName, 'upstream-static'),
  ),
  false,
  'The upstream fixture must not contain a fork preview',
);

const upstreamAnimatedPackName = 'UpstreamAnimatedStoragePack';
const upstreamAnimatedPackDir = generateStickerPackDirPath(
  upstreamAnimatedPackName,
);
await fsp.mkdir(upstreamAnimatedPackDir, {recursive: true});
const upstreamWebmFilename = 'upstream-webm.webm';
const upstreamWebmPath = path.join(
  upstreamAnimatedPackDir,
  upstreamWebmFilename,
);
await fsp.copyFile(testWebmPath, upstreamWebmPath);
const upstreamAnimatedStickers = [
  {
    id: `MoreStickers:Telegram:Sticker:${upstreamAnimatedPackName}:upstream-webm`,
    image: `https://stickers.example.com/sticker/telegram/${upstreamAnimatedPackName}/${upstreamWebmFilename}`,
    title: 'webm',
    stickerPackId: `MoreStickers:Telegram:Pack:${upstreamAnimatedPackName}`,
    filename: upstreamWebmFilename,
    isAnimated: false,
  },
];
let upstreamTgsPath: string | undefined;
if (realTgsFixturePath) {
  const upstreamTgsFilename = 'upstream-tgs.tgs';
  upstreamTgsPath = path.join(upstreamAnimatedPackDir, upstreamTgsFilename);
  await fsp.copyFile(realTgsFixturePath, upstreamTgsPath);
  upstreamAnimatedStickers.push({
    id: `MoreStickers:Telegram:Sticker:${upstreamAnimatedPackName}:upstream-tgs`,
    image: `https://stickers.example.com/sticker/telegram/${upstreamAnimatedPackName}/${upstreamTgsFilename}`,
    title: 'tgs',
    stickerPackId: `MoreStickers:Telegram:Pack:${upstreamAnimatedPackName}`,
    filename: upstreamTgsFilename,
    isAnimated: true,
  });
}
await fsp.writeFile(
  generateStickerPackFilePath(upstreamAnimatedPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${upstreamAnimatedPackName}`,
    title: 'Upstream Animated Storage Pack',
    logo: upstreamAnimatedStickers[0],
    stickers: upstreamAnimatedStickers,
  }),
);

console.log('Testing startup migration of upstream WebM/TGS storage...');
await migrateLegacyStickerStorage();
const migratedUpstreamStaticManifest = validateLocalStickerPackManifest(
  await readManifestOrUndefined(upstreamStaticPackName),
);
assert.ok(migratedUpstreamStaticManifest);
assert.equal(migratedUpstreamStaticManifest.dynamic?.version, 1);
assert.ok(
  migratedUpstreamStaticManifest.stickers[0].image.endsWith(
    `/${upstreamStaticPackName}/1/${upstreamStaticFilename}`,
  ),
);
assert.ok(
  migratedUpstreamStaticManifest.stickers[0].previewImage?.endsWith(
    `/${upstreamStaticPackName}/1/upstream-static.webp`,
  ),
);
const migratedUpstreamStaticIndex = await readStickerVersionIndex(
  upstreamStaticPackName,
  1,
);
assert.ok(migratedUpstreamStaticIndex?.stickers[upstreamStaticFilename]);
assert.ok(migratedUpstreamStaticIndex?.previews['upstream-static.webp']);
const migratedUpstreamStaticPreviewPath = await resolveStickerAssetPath(
  upstreamStaticPackName,
  1,
  'upstream-static.webp',
  'previews',
);
assert.ok(migratedUpstreamStaticPreviewPath);
const migratedUpstreamStaticPreview = await fsp.readFile(
  migratedUpstreamStaticPreviewPath,
);
assert.equal(migratedUpstreamStaticPreview.subarray(0, 4).toString(), 'RIFF');
assert.equal(migratedUpstreamStaticPreview.subarray(8, 12).toString(), 'WEBP');
assert.equal(
  fs.existsSync(upstreamStaticPath),
  false,
  'Published migration must remove the static WebP working copy',
);
assert.equal(
  await migrateLegacyStickerPack(
    upstreamStaticPackName,
    migratedUpstreamStaticManifest,
  ),
  false,
  'Restart migration must treat the published static pack as a no-op',
);
const migratedUpstreamManifest = validateLocalStickerPackManifest(
  await readManifestOrUndefined(upstreamAnimatedPackName),
);
assert.ok(migratedUpstreamManifest);
assert.equal(migratedUpstreamManifest.dynamic?.version, 1);
assert.deepEqual(
  migratedUpstreamManifest.stickers.map(sticker => sticker.filename),
  realTgsFixturePath
    ? ['upstream-webm.avif', 'upstream-tgs.avif']
    : ['upstream-webm.avif'],
  'Startup migration must publish AVIF filenames for upstream animated assets',
);
assert.ok(
  migratedUpstreamManifest.stickers.every(
    sticker =>
      sticker.readyToUpload === true &&
      sticker.image.includes(`/${upstreamAnimatedPackName}/1/`) &&
      sticker.image.endsWith('.avif'),
  ),
  'Migrated upstream stickers must be immediately publishable as version 1 AVIF',
);
assert.equal(
  fs.existsSync(upstreamWebmPath),
  false,
  'Published migration must remove the obsolete WebM working copy',
);
if (upstreamTgsPath) {
  assert.equal(
    fs.existsSync(upstreamTgsPath),
    false,
    'Published migration must remove the obsolete TGS working copy',
  );
}
for (const legacyFilename of upstreamAnimatedStickers.map(
  sticker => sticker.filename,
)) {
  const legacyResponse = await app.inject({
    method: 'GET',
    url: `/sticker/telegram/${upstreamAnimatedPackName}/${legacyFilename}`,
  });
  assert.equal(
    legacyResponse.statusCode,
    200,
    `Installed upstream URL ${legacyFilename} must work after startup migration`,
  );
  assert.equal(legacyResponse.headers['content-type'], 'image/avif');
  assert.equal(legacyResponse.headers['cache-control'], 'public, max-age=300');
  const stickerId = path.basename(legacyFilename, path.extname(legacyFilename));
  const migratedAssetPath = await resolveStickerAssetPath(
    upstreamAnimatedPackName,
    1,
    `${stickerId}.avif`,
    'stickers',
  );
  assert.ok(migratedAssetPath);
  assert.deepEqual(
    legacyResponse.rawPayload,
    await fsp.readFile(migratedAssetPath),
    'Legacy upstream URL must serve the migrated AVIF bytes',
  );
  const versionedLegacyResponse = await app.inject({
    method: 'GET',
    url: `/sticker/telegram/${upstreamAnimatedPackName}/1/${legacyFilename}`,
  });
  assert.equal(
    versionedLegacyResponse.statusCode,
    400,
    'Upstream extension compatibility must remain versionless-only',
  );
}
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
assert.deepEqual(
  (await fsp.readdir(migrationRawDir)).filter(filename =>
    filename.includes('.legacy-'),
  ),
  [],
  'Failed raw migration must clean temporary AVIF and preview files',
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
assert.match(
  manifestResponse.headers['etag'] as string,
  /^"[A-Za-z0-9_-]+"$/,
  'Manifest response must include a valid quoted ETag',
);
assert.equal(
  manifestResponse.headers['access-control-expose-headers'],
  'ETag',
  'Manifest response must expose ETag header via CORS',
);
const manifestEtag = manifestResponse.headers['etag'] as string;

// Exact If-None-Match conditional GET -> 304 Not Modified
const manifestExactConditional = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': manifestEtag,
  },
});
assert.equal(
  manifestExactConditional.statusCode,
  304,
  'Exact If-None-Match for manifest must return 304',
);
assert.equal(
  manifestExactConditional.body,
  '',
  '304 manifest response body must be empty',
);
assert.equal(
  manifestExactConditional.headers['etag'],
  manifestEtag,
  '304 manifest response must preserve current ETag',
);
assert.equal(
  manifestExactConditional.headers['cache-control'],
  'no-cache',
  '304 manifest response must preserve Cache-Control: no-cache',
);
assert.equal(
  manifestExactConditional.headers['content-disposition'],
  `attachment; filename="${packName}.stickerpack"`,
  '304 manifest response must preserve Content-Disposition',
);

// Weak If-None-Match conditional GET -> 304
const manifestWeakConditional = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': `W/${manifestEtag}`,
  },
});
assert.equal(
  manifestWeakConditional.statusCode,
  304,
  'Weak If-None-Match for manifest must return 304',
);
assert.equal(manifestWeakConditional.body, '');
assert.equal(manifestWeakConditional.headers['etag'], manifestEtag);

// Multi-tag If-None-Match conditional GET -> 304
const manifestMultiConditional = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': `"stale-1", ${manifestEtag}, "stale-2"`,
  },
});
assert.equal(
  manifestMultiConditional.statusCode,
  304,
  'Multi-tag If-None-Match for manifest must return 304',
);
assert.equal(manifestMultiConditional.body, '');

// Wildcard If-None-Match conditional GET -> 304
const manifestWildcardConditional = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': '*',
  },
});
assert.equal(
  manifestWildcardConditional.statusCode,
  304,
  'Wildcard If-None-Match for manifest must return 304',
);
assert.equal(manifestWildcardConditional.body, '');

// Stale If-None-Match -> 200 with current representation
const manifestStaleConditional = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': '"stale-manifest-etag"',
  },
});
assert.equal(
  manifestStaleConditional.statusCode,
  200,
  'Stale If-None-Match for manifest must return 200',
);
assert.equal(manifestStaleConditional.headers['etag'], manifestEtag);
assert.equal(
  JSON.parse(manifestStaleConditional.body).id,
  `MoreStickers:Telegram:Pack:${packName}`,
);

// Empty opaque tag / malformed / unclosed If-None-Match -> 200 without 500 error
const manifestMalformed1 = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': '""',
  },
});
assert.equal(
  manifestMalformed1.statusCode,
  200,
  'Empty opaque tag If-None-Match does not match and must return 200',
);
const manifestMalformed2 = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': '"unclosed',
  },
});
assert.equal(
  manifestMalformed2.statusCode,
  200,
  'Unclosed quote If-None-Match must return 200 without error',
);
const manifestMalformed3 = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': '"other", *',
  },
});
assert.equal(
  manifestMalformed3.statusCode,
  200,
  'Wildcard in list is invalid syntax and must return 200',
);
const manifestMalformed4 = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': `w/${manifestEtag}`,
  },
});
assert.equal(
  manifestMalformed4.statusCode,
  200,
  'Lowercase w/ is invalid syntax and must return 200',
);

// Non-existent pack with If-None-Match -> 404
const manifestNonExistent = await app.inject({
  method: 'GET',
  url: '/stickerpack/telegram/NonExistentStickerPack12345',
  headers: {
    'if-none-match': '*',
  },
});
assert.equal(
  manifestNonExistent.statusCode,
  404,
  'Non-existent pack with wildcard If-None-Match must return 404',
);

// Manifest change invalidation test
const invalidationPackName = 'ManifestInvalidationPack';
const invalidationPackPath = generateStickerPackFilePath(invalidationPackName);
const v1Manifest = {
  id: `MoreStickers:Telegram:Pack:${invalidationPackName}`,
  title: 'Invalidation Pack V1',
  stickers: [],
  dynamic: {
    version: 1,
    refreshUrl: generateStickerPackExternalUrl(invalidationPackName),
  },
};
await fsp.writeFile(invalidationPackPath, JSON.stringify(v1Manifest));
const invV1Resp = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${invalidationPackName}`,
});
assert.equal(invV1Resp.statusCode, 200);
const invEtagV1 = invV1Resp.headers['etag'] as string;
assert.match(invEtagV1, /^"[A-Za-z0-9_-]+"$/);

// Modify manifest (version 2)
const v2Manifest = {
  ...v1Manifest,
  title: 'Invalidation Pack V2 Updated',
  dynamic: {
    version: 2,
    refreshUrl: generateStickerPackExternalUrl(invalidationPackName),
  },
};
await fsp.writeFile(invalidationPackPath, JSON.stringify(v2Manifest));
const invV2Resp = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${invalidationPackName}`,
});
assert.equal(invV2Resp.statusCode, 200);
const invEtagV2 = invV2Resp.headers['etag'] as string;
assert.notEqual(
  invEtagV1,
  invEtagV2,
  'Manifest ETag must change when manifest content changes',
);

// Request with old etag1 -> must return 200 with new manifest, not 304
const invStaleResp = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${invalidationPackName}`,
  headers: {
    'if-none-match': invEtagV1,
  },
});
assert.equal(
  invStaleResp.statusCode,
  200,
  'Request with stale ETag after manifest update must return 200',
);
assert.equal(invStaleResp.headers['etag'], invEtagV2);
assert.equal(
  JSON.parse(invStaleResp.body).title,
  'Invalidation Pack V2 Updated',
);

// Request with new etag2 -> must return 304
const invFreshResp = await app.inject({
  method: 'GET',
  url: `/stickerpack/telegram/${invalidationPackName}`,
  headers: {
    'if-none-match': invEtagV2,
  },
});
assert.equal(
  invFreshResp.statusCode,
  304,
  'Request with fresh ETag must return 304',
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
  manifestHeadResponse.headers['etag'],
  manifestEtag,
  'HEAD response must include identical ETag to GET',
);

const manifestHeadConditional = await app.inject({
  method: 'HEAD',
  url: `/stickerpack/telegram/${packName}`,
  headers: {
    'if-none-match': manifestEtag,
  },
});
assert.equal(
  manifestHeadConditional.statusCode,
  304,
  'HEAD with matching ETag must return 304',
);
assert.equal(manifestHeadConditional.body, '');
assert.equal(manifestHeadConditional.headers['etag'], manifestEtag);
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
const version11StickerSource = path.join(versionedHttpPackDir, 'v11.avif');
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
  stickers: {'A.avif': version11StickerAsset},
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
assert.equal(
  version10Response.headers['cache-control'],
  'public, max-age=604800',
);
const pendingVersion11Response = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A.avif`,
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
);
committedVersion11Manifest.dynamic.version = 11;
for (const sticker of committedVersion11Manifest.stickers) {
  sticker.filename = 'A.avif';
  sticker.image = `https://stickers.example.com/sticker/telegram/${versionedHttpPackName}/11/A.avif`;
}
committedVersion11Manifest.logo = committedVersion11Manifest.stickers[0];
await fsp.writeFile(
  generateStickerPackFilePath(versionedHttpPackName),
  JSON.stringify(committedVersion11Manifest),
);
const version11Response = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A.avif`,
});
assert.equal(version11Response.statusCode, 200);
assert.equal(version11Response.body, 'version-11-sticker');
assert.equal(version11Response.headers['content-type'], 'image/avif');
assert.equal(
  version11Response.headers['cache-control'],
  'public, max-age=604800',
);
const retainedVersion10 = await readStickerVersionIndex(
  versionedHttpPackName,
  10,
);
const committedVersion11 = await readStickerVersionIndex(
  versionedHttpPackName,
  11,
);
assert.equal(retainedVersion10?.stickers['A.gif'], version10StickerAsset);
assert.equal(committedVersion11?.stickers['A.avif'], version11StickerAsset);
const retainedGifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/10/A.gif`,
});
assert.equal(retainedGifResponse.statusCode, 200);
assert.equal(retainedGifResponse.headers['content-type'], 'image/gif');
assert.equal(committedVersion11Manifest.dynamic.version, 11);
assert.equal(committedVersion11Manifest.stickers[0].filename, 'A.avif');
assert.ok(committedVersion11Manifest.stickers[0].image.endsWith('/11/A.avif'));
const legacyLatestResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/A.avif`,
});
assert.equal(legacyLatestResponse.statusCode, 200);
assert.equal(legacyLatestResponse.body, 'version-11-sticker');
assert.equal(
  legacyLatestResponse.headers['cache-control'],
  'public, max-age=300',
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
assert.equal(
  legacyAliasResponse.body,
  'version-11-sticker',
  'Legacy -160.gif alias must serve the current A.avif bytes',
);
assert.equal(
  legacyAliasResponse.headers['content-type'],
  'image/avif',
  'Legacy -160.gif alias must report the resolved asset type, not the request extension',
);
assert.equal(
  legacyAliasResponse.headers['cache-control'],
  'public, max-age=300',
  'Legacy -160.gif alias must use the short mutable cache policy',
);
// CASE 3: versioned routes must stay strict - no cross-extension fallback
const versionedGifFallbackResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A.gif`,
});
assert.equal(
  versionedGifFallbackResponse.statusCode,
  404,
  'Versioned routes must stay strict: /11/A.gif must not fall back to A.avif',
);
const versionedGifAliasFallbackResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/11/A-160.gif`,
});
assert.equal(
  versionedGifAliasFallbackResponse.statusCode,
  404,
  'Versioned routes must stay strict: /11/A-160.gif must not resolve',
);
// CASE 4: plain legacy GIF URL resolves to the current AVIF sticker
const legacyGifFallbackResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/A.gif`,
});
assert.equal(legacyGifFallbackResponse.statusCode, 200);
assert.equal(
  legacyGifFallbackResponse.body,
  'version-11-sticker',
  'Legacy A.gif must serve the current A.avif bytes',
);
assert.equal(
  legacyGifFallbackResponse.headers['content-type'],
  'image/avif',
  'Content-Type must come from the resolved asset, not the request extension',
);
assert.equal(
  legacyGifFallbackResponse.headers['cache-control'],
  'public, max-age=300',
  'Legacy A.gif alias must use the short mutable cache policy',
);
// CASE 7: no unrelated cross-extension fallback
const legacyUnrelatedFallbackResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${versionedHttpPackName}/A.webp`,
});
assert.equal(
  legacyUnrelatedFallbackResponse.statusCode,
  404,
  'No unrelated fallback: A.webp must not resolve to A.avif',
);
const versionedPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/10/A.webp`,
});
assert.equal(versionedPreviewResponse.statusCode, 200);
assert.equal(versionedPreviewResponse.body, 'version-10-preview');
assert.equal(
  versionedPreviewResponse.headers['cache-control'],
  'public, max-age=604800',
);
const committedVersion11PreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/11/A.webp`,
});
assert.equal(committedVersion11PreviewResponse.statusCode, 200);
assert.equal(committedVersion11PreviewResponse.body, 'version-11-preview');
assert.equal(
  committedVersion11PreviewResponse.headers['cache-control'],
  'public, max-age=604800',
);
const legacyPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${versionedHttpPackName}/A.webp`,
});
assert.equal(legacyPreviewResponse.statusCode, 200);
assert.equal(legacyPreviewResponse.body, 'version-11-preview');
assert.equal(
  legacyPreviewResponse.headers['cache-control'],
  'public, max-age=300',
);
// CASE 6: a current real GIF keeps priority over the AVIF compatibility fallback
const gifCurrentPackName = 'LegacyGifStillCurrentPack';
const gifCurrentPackDir = generateStickerPackDirPath(gifCurrentPackName);
await fsp.mkdir(gifCurrentPackDir, {recursive: true});
const gifCurrentStickerSource = path.join(gifCurrentPackDir, 'current-b.gif');
const gifCurrentPreviewSource = path.join(gifCurrentPackDir, 'current-b.webp');
await fsp.writeFile(gifCurrentStickerSource, 'current-gif-sticker');
await fsp.writeFile(gifCurrentPreviewSource, 'current-gif-preview');
const gifCurrentStickerAsset = await storeStickerAsset(
  gifCurrentPackName,
  gifCurrentStickerSource,
);
const gifCurrentPreviewAsset = await storeStickerAsset(
  gifCurrentPackName,
  gifCurrentPreviewSource,
);
await writeStickerVersionIndexAtomically(gifCurrentPackName, {
  version: 1,
  signature: 'gif-current-version',
  stickers: {'B.gif': gifCurrentStickerAsset},
  previews: {'B.webp': gifCurrentPreviewAsset},
});
await fsp.writeFile(
  generateStickerPackFilePath(gifCurrentPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${gifCurrentPackName}`,
    title: 'GIF Current Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${gifCurrentPackName}:B`,
      image: `https://stickers.example.com/sticker/telegram/${gifCurrentPackName}/1/B.gif`,
      previewImage: `https://stickers.example.com/preview/telegram/${gifCurrentPackName}/1/B.webp`,
      title: 'B',
      stickerPackId: `MoreStickers:Telegram:Pack:${gifCurrentPackName}`,
      filename: 'B.gif',
      isAnimated: true,
      readyToUpload: true,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${gifCurrentPackName}:B`,
        image: `https://stickers.example.com/sticker/telegram/${gifCurrentPackName}/1/B.gif`,
        previewImage: `https://stickers.example.com/preview/telegram/${gifCurrentPackName}/1/B.webp`,
        title: 'B',
        stickerPackId: `MoreStickers:Telegram:Pack:${gifCurrentPackName}`,
        filename: 'B.gif',
        isAnimated: true,
        readyToUpload: true,
      },
    ],
    dynamic: {
      version: 1,
      refreshUrl: generateStickerPackExternalUrl(gifCurrentPackName),
    },
  }),
);
const currentGifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${gifCurrentPackName}/B.gif`,
});
assert.equal(currentGifResponse.statusCode, 200);
assert.equal(currentGifResponse.body, 'current-gif-sticker');
assert.equal(currentGifResponse.headers['content-type'], 'image/gif');
const currentGifAliasResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${gifCurrentPackName}/B-160.gif`,
});
assert.equal(currentGifAliasResponse.statusCode, 200);
assert.equal(currentGifAliasResponse.body, 'current-gif-sticker');
assert.equal(
  currentGifAliasResponse.headers['content-type'],
  'image/gif',
  'Current real GIF must win over the AVIF compatibility fallback',
);
const currentGifReverseFallbackResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${gifCurrentPackName}/B.avif`,
});
assert.equal(
  currentGifReverseFallbackResponse.statusCode,
  404,
  'No reverse fallback: B.avif must not resolve to an existing B.gif',
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
const refreshTransitionPackName = 'RefreshGifToAvifPack';
const refreshTransitionPackDir = generateStickerPackDirPath(
  refreshTransitionPackName,
);
const refreshTransitionPreviewDir = generateStickerPreviewDirPath(
  refreshTransitionPackName,
);
await fsp.mkdir(refreshTransitionPreviewDir, {recursive: true});
const refreshLegacyGifPath = path.join(
  refreshTransitionPackDir,
  'refresh-id.gif',
);
const refreshLegacyPreviewPath = path.join(
  refreshTransitionPreviewDir,
  'refresh-id.webp',
);
await fsp.copyFile(testGifPath, refreshLegacyGifPath);
await fsp.writeFile(refreshLegacyPreviewPath, 'legacy refresh preview');
const refreshLegacyGifAsset = await storeStickerAsset(
  refreshTransitionPackName,
  refreshLegacyGifPath,
);
const refreshLegacyPreviewAsset = await storeStickerAsset(
  refreshTransitionPackName,
  refreshLegacyPreviewPath,
);
await writeStickerVersionIndexAtomically(refreshTransitionPackName, {
  version: 12,
  signature: 'legacy-gif-version',
  stickers: {'refresh-id.gif': refreshLegacyGifAsset},
  previews: {'refresh-id.webp': refreshLegacyPreviewAsset},
});
const refreshLegacySticker = {
  id: `MoreStickers:Telegram:Sticker:${refreshTransitionPackName}:refresh-id`,
  image: `https://stickers.example.com/sticker/telegram/${refreshTransitionPackName}/12/refresh-id.gif`,
  previewImage: `https://stickers.example.com/preview/telegram/${refreshTransitionPackName}/12/refresh-id.webp`,
  title: '🔄',
  stickerPackId: `MoreStickers:Telegram:Pack:${refreshTransitionPackName}`,
  filename: 'refresh-id.gif',
  isAnimated: true,
  readyToUpload: true,
};
await fsp.writeFile(
  generateStickerPackFilePath(refreshTransitionPackName),
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${refreshTransitionPackName}`,
    title: 'Refresh transition',
    logo: refreshLegacySticker,
    stickers: [refreshLegacySticker],
    dynamic: {
      version: 12,
      refreshUrl: generateStickerPackExternalUrl(refreshTransitionPackName),
    },
  }),
);
const refreshTransitionStickerSet = {
  name: refreshTransitionPackName,
  title: 'Refresh transition',
  stickers: [
    {
      file_id: 'refresh-file',
      file_unique_id: 'refresh-id',
      emoji: '🔄',
      is_video: true,
      is_animated: false,
      width: 512,
      height: 512,
      type: 'regular',
    },
  ],
} as Parameters<typeof downloadStickerPack>[1];
const refreshTransitionTelegram = {
  getFile: async () => ({
    file_id: 'refresh-file',
    file_path: 'stickers/refresh-id.webm',
  }),
  getFileLink: async () => new URL('https://example.test/refresh-id.webm'),
} as unknown as Telegram;
const refreshTransitionWebm = await fsp.readFile(testWebmPath);
const fetchBeforeRefreshTransition = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(refreshTransitionWebm, {status: 200})) as typeof fetch;
try {
  await downloadStickerPack(
    refreshTransitionTelegram,
    refreshTransitionStickerSet,
  );
} finally {
  globalThis.fetch = fetchBeforeRefreshTransition;
}
const refreshTransitionManifest = validateLocalStickerPackManifest(
  await readManifestOrUndefined(refreshTransitionPackName),
);
assert.equal(refreshTransitionManifest?.dynamic?.version, 13);
assert.equal(
  refreshTransitionManifest?.stickers[0].filename,
  'refresh-id.avif',
);
assert.ok(
  refreshTransitionManifest?.stickers[0].image.endsWith('/13/refresh-id.avif'),
);
assert.ok(
  refreshTransitionManifest?.stickers[0].previewImage?.endsWith(
    '/13/refresh-id.webp',
  ),
);
const refreshVersion12 = await readStickerVersionIndex(
  refreshTransitionPackName,
  12,
);
const refreshVersion13 = await readStickerVersionIndex(
  refreshTransitionPackName,
  13,
);
assert.equal(
  refreshVersion12?.stickers['refresh-id.gif'],
  refreshLegacyGifAsset,
);
assert.match(
  refreshVersion13?.stickers['refresh-id.avif'] ?? '',
  /^[a-f0-9]{64}\.avif$/,
);
assert.equal(
  fs.existsSync(path.join(refreshTransitionPackDir, 'refresh-id.webm')),
  false,
  'Raw source must be removed only after successful publication',
);
assert.equal(
  (
    await app.inject({
      method: 'GET',
      url: `/sticker/telegram/${refreshTransitionPackName}/12/refresh-id.gif`,
    })
  ).statusCode,
  200,
);
const refreshedAvifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${refreshTransitionPackName}/13/refresh-id.avif`,
});
assert.equal(refreshedAvifResponse.statusCode, 200);
assert.equal(refreshedAvifResponse.headers['content-type'], 'image/avif');
assert.equal(
  refreshedAvifResponse.headers['cache-control'],
  'public, max-age=604800',
);
await pruneOldStickerVersions(refreshTransitionPackName);
assert.deepEqual(
  await listStickerPackVersions(refreshTransitionPackName),
  [12, 13],
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

const avifPreviewOutput = path.join(tempDir, 'real_avif_preview.webp');
const avifPreviewResult = await generatePreview(
  testAvifPath,
  avifPreviewOutput,
);
assert.ok(fs.existsSync(avifPreviewOutput), 'AVIF preview file must exist');
assert.ok(avifPreviewResult.sizeBytes <= PREVIEW_MAX_BYTES);
const avifPreviewProbeResult = spawnSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=codec_name,width,height',
  '-of',
  'json',
  avifPreviewOutput,
]);
assert.equal(avifPreviewProbeResult.status, 0);
const avifPreviewProbe = JSON.parse(
  avifPreviewProbeResult.stdout.toString('utf8'),
).streams[0];
assert.equal(
  avifPreviewProbe.codec_name,
  'webp',
  'Animated AVIF preview must remain WebP',
);
const readAvifPreviewAlpha = (x: number, y: number): number => {
  const result = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    avifPreviewOutput,
    '-vf',
    `format=rgba,crop=1:1:${x}:${y}`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 4);
  return result.stdout[3];
};
assert.equal(readAvifPreviewAlpha(0, 0), 0);
assert.equal(
  readAvifPreviewAlpha(
    Math.floor(Number(avifPreviewProbe.width) / 2),
    Math.floor(Number(avifPreviewProbe.height) / 2),
  ),
  255,
);
const avifPreviewSemiAlpha = readAvifPreviewAlpha(
  Math.floor(Number(avifPreviewProbe.width) * 0.78),
  Math.floor(Number(avifPreviewProbe.height) * 0.49),
);
assert.ok(
  avifPreviewSemiAlpha >= 120 && avifPreviewSemiAlpha <= 136,
  `AVIF-derived WebP must preserve half-transparent alpha, got ${avifPreviewSemiAlpha}`,
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
const invalidAvifPreviewResponse = await app.inject({
  method: 'GET',
  url: `/preview/telegram/${legacyPreviewPackName}/test_sticker.avif`,
});
assert.equal(
  invalidAvifPreviewResponse.statusCode,
  400,
  'Preview route must reject AVIF',
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
console.log('Testing convertWebmToAvif error handling with invalid input...');
const invalidInputPath = path.join(tempDir, 'corrupt.webm');
await fsp.writeFile(invalidInputPath, 'not a valid video file');
const invalidOutputPath = path.join(tempDir, 'corrupt.avif');
await assert.rejects(
  async () => convertWebmToAvif(invalidInputPath, invalidOutputPath),
  /ffmpeg exited with code|Failed to spawn ffmpeg/i,
);
assert.equal(fs.existsSync(invalidOutputPath), false);
const retainedRawPackName = 'RetainedRawConversionFailure';
const retainedRawPackDir = generateStickerPackDirPath(retainedRawPackName);
await fsp.mkdir(retainedRawPackDir, {recursive: true});
await fsp.writeFile(
  path.join(retainedRawPackDir, 'retained-raw-id.webm'),
  'previous raw webm',
);
const retainedRawStickerSet = {
  name: retainedRawPackName,
  title: 'Retained raw conversion failure',
  stickers: [
    {
      file_id: 'retained-raw-file',
      file_unique_id: 'retained-raw-id',
      is_video: true,
      is_animated: false,
      width: 512,
      height: 512,
      type: 'regular',
    },
  ],
} as Parameters<typeof downloadStickerPack>[1];
const retainedRawTelegram = {
  getFile: async () => ({
    file_id: 'retained-raw-file',
    file_path: 'stickers/retained-raw-id.webm',
  }),
  getFileLink: async () => new URL('https://example.test/retained.webm'),
} as unknown as Telegram;
const fetchBeforeRetainedRawTest = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(Buffer.from('corrupt downloaded webm'), {
    status: 200,
  })) as typeof fetch;
try {
  await assert.rejects(
    downloadStickerPack(retainedRawTelegram, retainedRawStickerSet),
    /ffmpeg exited with code/i,
  );
} finally {
  globalThis.fetch = fetchBeforeRetainedRawTest;
}
assert.equal(
  await fsp.readFile(
    path.join(retainedRawPackDir, 'retained-raw-id.webm'),
    'utf8',
  ),
  'previous raw webm',
  'Previous raw input must be restored when regeneration fails before publication',
);
assert.deepEqual(
  (await fsp.readdir(retainedRawPackDir)).filter(
    file => file.includes('.source.') || file.includes('.backup-'),
  ),
  [],
);

// Test 10: Quality ladder order, hard limit, and cleanup.
console.log('Testing deterministic AVIF quality ladder...');
const reg1Dir = await fsp.mkdtemp(path.join(tempDir, 'reg1-'));
const reg1Input = path.join(reg1Dir, 'input.webm');
const reg1Output = path.join(reg1Dir, 'output.avif');
await fsp.writeFile(reg1Input, 'dummy-webm-input');
const observedProfiles: (typeof AVIF_ENCODING_PROFILES)[number][] = [];
const fallbackThenTargetEncoder: AvifEncoder = async (
  _inputPath,
  candidatePath,
  profile,
) => {
  observedProfiles.push(profile);
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(
    candidatePath,
    observedProfiles.length === 1 ? AVIF_HARD_LIMIT_BYTES + 1 : 4_000_000,
  );
};
const reg1Result = await convertWebmToAvifWithEncoder(
  reg1Input,
  reg1Output,
  fallbackThenTargetEncoder,
);
assert.equal(reg1Result.profileIndex, 1);
assert.equal(reg1Result.sizeBytes, 4_000_000);
assert.deepEqual(observedProfiles, AVIF_ENCODING_PROFILES.slice(0, 2));
assert.ok(fs.existsSync(reg1Output));
assert.ok((await fsp.stat(reg1Output)).size <= AVIF_HARD_LIMIT_BYTES);
assert.deepEqual(
  (await fsp.readdir(reg1Dir)).filter(file => file.includes('.candidate-')),
  [],
);

const reg2Dir = await fsp.mkdtemp(path.join(tempDir, 'reg2-'));
const reg2Input = path.join(reg2Dir, 'input.webm');
const reg2Output = path.join(reg2Dir, 'output.avif');
await fsp.writeFile(reg2Input, 'dummy-webm-input');
let failingCall = 0;
const failingEncoder: AvifEncoder = async (_inputPath, candidatePath) => {
  if (failingCall++ === 0) {
    await fsp.writeFile(candidatePath, '');
    await fsp.truncate(candidatePath, AVIF_HARD_LIMIT_BYTES + 1);
    return;
  }
  throw new Error('simulated encoder failure');
};
await assert.rejects(
  async () =>
    convertWebmToAvifWithEncoder(reg2Input, reg2Output, failingEncoder),
  /simulated encoder failure/,
);
assert.equal(fs.existsSync(reg2Output), false);
assert.deepEqual(
  (await fsp.readdir(reg2Dir)).filter(file => file.includes('.candidate-')),
  [],
);

const allOversizedDir = await fsp.mkdtemp(path.join(tempDir, 'all-oversized-'));
const allOversizedInput = path.join(allOversizedDir, 'input.webm');
const allOversizedOutput = path.join(allOversizedDir, 'output.avif');
await fsp.writeFile(allOversizedInput, 'dummy');
const allOversizedProfiles: (typeof AVIF_ENCODING_PROFILES)[number][] = [];
const allOversizedEncoder: AvifEncoder = async (
  _inputPath,
  candidatePath,
  profile,
) => {
  allOversizedProfiles.push(profile);
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(candidatePath, AVIF_HARD_LIMIT_BYTES + 1);
};
await assert.rejects(
  async () =>
    convertWebmToAvifWithEncoder(
      allOversizedInput,
      allOversizedOutput,
      allOversizedEncoder,
    ),
  /All quality profiles exceeded the hard limit/,
);
assert.deepEqual(allOversizedProfiles, AVIF_ENCODING_PROFILES);
assert.equal(fs.existsSync(allOversizedOutput), false);
assert.deepEqual(
  (await fsp.readdir(allOversizedDir)).filter(file =>
    file.includes('.candidate-'),
  ),
  [],
);

// Test 11: TGS uses the same profile order and only lowers FPS after CRF 36.
const tgsWalkDir = await fsp.mkdtemp(path.join(tempDir, 'tgs-walk-'));
const tgsWalkInput = path.join(tgsWalkDir, 'input.tgs');
const tgsWalkOutput = path.join(tgsWalkDir, 'output.avif');
await fsp.writeFile(tgsWalkInput, 'dummy-tgs-input');
const observedTgsProfiles: (typeof AVIF_ENCODING_PROFILES)[number][] = [];
const profileWalkEncoder: AvifEncoder = async (
  _inputPath,
  candidatePath,
  profile,
) => {
  observedTgsProfiles.push(profile);
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(
    candidatePath,
    observedTgsProfiles.length === AVIF_ENCODING_PROFILES.length
      ? 4_000_000
      : AVIF_HARD_LIMIT_BYTES + 1,
  );
};
const walkResult = await convertTgsToAvifWithEncoder(
  tgsWalkInput,
  tgsWalkOutput,
  profileWalkEncoder,
);
assert.deepEqual(observedTgsProfiles, AVIF_ENCODING_PROFILES);
assert.equal(walkResult.profileIndex, AVIF_ENCODING_PROFILES.length - 1);
assert.equal(walkResult.profile.fps, 16);
assert.equal(walkResult.sizeBytes, 4_000_000);
assert.deepEqual(
  (await fsp.readdir(tgsWalkDir)).filter(file => file.includes('.candidate-')),
  [],
);
console.log('Verified: AVIF quality ladder order, limit, failure, and cleanup');

// Test 14: TGS normalization logic, duration handling, and edge cases
console.log('Testing TGS normalization logic and edge cases...');
const norm1Result = normalizeLottieJsonForConverter(
  {fr: 60, ip: 0, op: 90, v: '5.7.4'},
  'test1.tgs',
);
const norm1Parsed = JSON.parse(norm1Result);
assert.equal(norm1Parsed.op, 89, 'Exclusive op must be normalized for rlottie');
assert.equal(norm1Parsed.ip, 0, 'ip must remain unchanged');
assert.equal(norm1Parsed.fr, 60, 'fr must remain unchanged');

const norm2Result = normalizeLottieJsonForConverter(
  {fr: 60, ip: 30, op: 90, v: '5.7.4'},
  'test2.tgs',
);
const norm2Parsed = JSON.parse(norm2Result);
assert.equal(
  norm2Parsed.op,
  89,
  'Non-zero ip timing must normalize for rlottie',
);
assert.equal(norm2Parsed.ip, 30, 'non-zero ip must remain unchanged');
const cappedTgs = JSON.parse(
  normalizeLottieJsonForConverter(
    {fr: 60, ip: 0, op: 300},
    'long-duration.tgs',
  ),
);
assert.equal(cappedTgs.op, 179, 'TGS render input must be capped at 3 seconds');
const cappedOffsetTgs = JSON.parse(
  normalizeLottieJsonForConverter(
    {fr: 30, ip: 15, op: 120},
    'offset-long-duration.tgs',
  ),
);
assert.equal(cappedOffsetTgs.op, 104);
const fractionalDurationTgs = JSON.parse(
  normalizeLottieJsonForConverter(
    {fr: 30, ip: 0, op: 75},
    'fractional-duration.tgs',
  ),
);
assert.equal(
  fractionalDurationTgs.op,
  74,
  'Sub-three-second duration must only receive rlottie inclusive-op normalization',
);

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
// Test 14: invalid or missing TGS fr falls back gracefully to 24 FPS
for (const badFr of [0, -10, '60', 'invalid', null, undefined]) {
  const parsedNorm = JSON.parse(
    normalizeLottieJsonForConverter(
      {fr: badFr, ip: 0, op: 60},
      `bad-fr-${String(badFr)}.tgs`,
    ),
  );
  assert.equal(parsedNorm.fr, 24);
  assert.equal(extractTgsSourceFps({fr: badFr}), undefined);
}
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
const preparedValid = await prepareTgsForLottieConverter(normValidTgs);
assert.equal(preparedValid.sourceFps, 60);
assert.ok(
  fs.existsSync(preparedValid.tempPath),
  'Prepared TGS file must exist',
);
assert.ok(
  preparedValid.tempPath.includes('.lottieconverter-'),
  'Prepared TGS path must include .lottieconverter- marker',
);
await fsp.unlink(preparedValid.tempPath);

const normCorruptTgs = path.join(normTestDir, 'corrupt.tgs');
await fsp.writeFile(normCorruptTgs, Buffer.from('not gzip data'));
await assert.rejects(async () => {
  await prepareTgsForLottieConverter(normCorruptTgs);
}, /Failed to decompress TGS gzip payload from ".*corrupt\.tgs"/);
const oversizedCompressedTgs = path.join(
  normTestDir,
  'oversized-compressed.tgs',
);
await fsp.writeFile(oversizedCompressedTgs, Buffer.alloc(64 * 1024 + 1));
await assert.rejects(
  prepareTgsForLottieConverter(oversizedCompressedTgs),
  /exceeds 65536 bytes/,
);
const oversizedExpandedTgs = path.join(normTestDir, 'oversized-expanded.tgs');
await fsp.writeFile(
  oversizedExpandedTgs,
  gzipSync(
    Buffer.from(
      JSON.stringify({
        fr: 60,
        ip: 0,
        op: 60,
        padding: 'x'.repeat(2 * 1024 * 1024),
      }),
    ),
  ),
);
await assert.rejects(
  prepareTgsForLottieConverter(oversizedExpandedTgs),
  /Failed to decompress TGS gzip payload/,
);

const sub1FpsTgs = path.join(normTestDir, 'sub1-fps.tgs');
await fsp.writeFile(
  sub1FpsTgs,
  gzipSync(Buffer.from(JSON.stringify({fr: 0.5, ip: 0, op: 10}))),
);
await assert.rejects(
  prepareTgsForLottieConverter(sub1FpsTgs),
  /Unsupported source frame rate.*0\.5 FPS/,
);

// Test 1: convertTgsToAvif cleans up normalized temporary file on encoder failure
const failingConvInput = path.join(normTestDir, 'failing-conv.tgs');
await fsp.writeFile(
  failingConvInput,
  gzipSync(Buffer.from(JSON.stringify({fr: 60, ip: 0, op: 60}))),
);
const failingConvOutput = path.join(normTestDir, 'failing-out.avif');

let observedPreparedInput: string | undefined;
const failingNormEncoder: AvifEncoder = async preparedInput => {
  observedPreparedInput = preparedInput;
  assert.notEqual(preparedInput, failingConvInput);
  assert.ok(preparedInput.includes('.lottieconverter-'));
  assert.ok(fs.existsSync(preparedInput));
  throw new Error('simulated failure inside encoder');
};

await assert.rejects(async () => {
  await convertTgsToAvif(
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
const cleanupFailOutput = path.join(normTestDir, 'cleanup-fail-out.avif');
let observedCleanupFailPreparedInput: string | undefined;
const cleanupFailEncoder: AvifEncoder = async (
  preparedInput,
  candidatePath,
) => {
  observedCleanupFailPreparedInput = preparedInput;
  assert.notEqual(preparedInput, cleanupFailInput);
  assert.ok(preparedInput.includes('.lottieconverter-'));
  assert.ok(fs.existsSync(preparedInput));
  // Replace prepared file with a directory so subsequent unlink in removePreparedTgs fails with non-ENOENT (EISDIR/EPERM)
  await fsp.unlink(preparedInput);
  await fsp.mkdir(preparedInput);
  // Encoder itself succeeds by producing a candidate under the AVIF hard limit.
  await fsp.writeFile(candidatePath, '');
  await fsp.truncate(candidatePath, 1_000);
};

try {
  await assert.rejects(
    async () => {
      await convertTgsToAvif(
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
const cleanupErrorOutput = path.join(normTestDir, 'cleanup-error-out.avif');
const primaryError = new Error('primary simulated encoder failure');
let observedCleanupErrorPreparedInput: string | undefined;
const cleanupErrorEncoder: AvifEncoder = async preparedInput => {
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
      await convertTgsToAvif(
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

console.log('Testing P0 — Source-dependent FPS ladder and rational parsing...');

// Verify constants
assert.equal(AVIF_DEFAULT_FPS, 24);
assert.equal(TGS_MAX_FPS, 60);
assert.equal(WEBM_MAX_FPS, 30);
assert.deepEqual(TGS_FPS_FALLBACKS, [60, 48, 30, 24, 20, 16]);
assert.deepEqual(WEBM_FPS_FALLBACKS, [30, 24, 20, 16]);
assert.equal(await probeWebmSourceFps(testWebmPath), 30);

// Test 0: parseFrameRate helper
assert.equal(parseFrameRate('30/1'), 30);
assert.equal(parseFrameRate('24/1'), 24);
assert.equal(parseFrameRate('25/1'), 25);
assert.equal(parseFrameRate('30'), 30);
assert.equal(parseFrameRate('29.97'), 29.97);
assert.ok(Math.abs((parseFrameRate('30000/1001') ?? 0) - 29.97002997) < 0.0001);
assert.ok(Math.abs((parseFrameRate('24000/1001') ?? 0) - 23.97602397) < 0.0001);
assert.equal(parseFrameRate('0/0'), undefined);
assert.equal(parseFrameRate('N/A'), undefined);
assert.equal(parseFrameRate('invalid'), undefined);
assert.equal(parseFrameRate(''), undefined);
assert.equal(parseFrameRate(undefined), undefined);
assert.equal(parseFrameRate(null as unknown as string), undefined);
assert.equal(parseFrameRate(-24), undefined);
assert.equal(parseFrameRate(0), undefined);

// Test 1: TGS 60 FPS
assert.deepEqual(buildFpsCandidates(60, 'tgs'), [60, 48, 30, 24, 20, 16]);

// Test 1b: TGS fractional FPS preserves source timeline in JSON while flooring render target
assert.deepEqual(buildFpsCandidates(29.97, 'tgs'), [29, 24, 20, 16]);
assert.deepEqual(buildFpsCandidates(29.6, 'tgs'), [29, 24, 20, 16]);
assert.deepEqual(buildFpsCandidates(12.5, 'tgs'), [12]);
assert.throws(
  () => extractTgsSourceFps({fr: 0.5}),
  /Unsupported source frame rate.*0\.5 FPS/,
);
assert.equal(extractTgsSourceFps({fr: 0}), undefined);
assert.equal(extractTgsSourceFps({fr: -10}), undefined);
assert.equal(extractTgsSourceFps({fr: 'invalid'}), undefined);
assert.equal(extractTgsSourceFps({}), undefined);
assert.throws(
  () => buildFpsCandidates(0.5, 'tgs'),
  /Unsupported source frame rate.*0\.5 FPS/,
);
assert.throws(
  () => buildFpsCandidates(0.5, 'webm'),
  /Unsupported source frame rate.*0\.5 FPS/,
);
assert.throws(
  () => buildFpsCandidates(0.1, 'webm'),
  /Unsupported source frame rate.*0\.1 FPS/,
);
const fracTgsNorm = JSON.parse(
  normalizeLottieJsonForConverter({fr: 29.6, ip: 0, op: 60}, 'frac-tgs.tgs'),
);
assert.equal(fracTgsNorm.fr, 29.6);
assert.equal(fracTgsNorm.op, 59);
// Test 3: TGS 30 FPS
assert.deepEqual(buildFpsCandidates(30, 'tgs'), [30, 24, 20, 16]);

// Test 4: TGS 24 FPS
assert.deepEqual(buildFpsCandidates(24, 'tgs'), [24, 20, 16]);

// Test 5: TGS low FPS (12)
assert.deepEqual(buildFpsCandidates(12, 'tgs'), [12]);

// Test 6: TGS > 60 FPS (120)
assert.deepEqual(buildFpsCandidates(120, 'tgs'), [60, 48, 30, 24, 20, 16]);
const tgs120Norm = JSON.parse(
  normalizeLottieJsonForConverter({fr: 120, ip: 0, op: 360}, 'tgs-120.tgs'),
);
assert.equal(tgs120Norm.fr, 120);
assert.equal(tgs120Norm.op, 359);
// Test 7: WebM 60 FPS (capped at 30)
assert.deepEqual(buildFpsCandidates(60, 'webm'), [30, 24, 20, 16]);

// Test 8: WebM 30 FPS
assert.deepEqual(buildFpsCandidates(30, 'webm'), [30, 24, 20, 16]);

// Test 9: WebM 25 FPS
assert.deepEqual(buildFpsCandidates(25, 'webm'), [25, 24, 20, 16]);

// Test 10: WebM 24 FPS
assert.deepEqual(buildFpsCandidates(24, 'webm'), [24, 20, 16]);

// Test 11: WebM 15 FPS (no upsampling to 16/20/24/30)
assert.deepEqual(buildFpsCandidates(15, 'webm'), [15]);

// Test 12: WebM 29.97 FPS (30000/1001)
const webm2997Candidates = buildFpsCandidates(
  parseFrameRate('30000/1001'),
  'webm',
);
assert.ok(Math.abs(webm2997Candidates[0] - 29.97002997) < 0.0001);
assert.deepEqual(webm2997Candidates.slice(1), [24, 20, 16]);

// Test 13: invalid ffprobe FPS uses 24 FPS fallback
assert.deepEqual(
  buildFpsCandidates(parseFrameRate('0/0'), 'webm'),
  [24, 20, 16],
);
assert.deepEqual(
  buildFpsCandidates(parseFrameRate('N/A'), 'webm'),
  [24, 20, 16],
);
assert.deepEqual(
  buildFpsCandidates(parseFrameRate('invalid'), 'webm'),
  [24, 20, 16],
);

// Test 14: invalid TGS fr uses 24 FPS fallback
assert.deepEqual(
  buildFpsCandidates(extractTgsSourceFps({fr: 0}), 'tgs'),
  [24, 20, 16],
);
assert.deepEqual(
  buildFpsCandidates(extractTgsSourceFps({fr: -1}), 'tgs'),
  [24, 20, 16],
);
assert.deepEqual(
  buildFpsCandidates(extractTgsSourceFps({fr: null}), 'tgs'),
  [24, 20, 16],
);
assert.deepEqual(
  buildFpsCandidates(extractTgsSourceFps({fr: '60'}), 'tgs'),
  [24, 20, 16],
);

// Test 15: no WebM upsampling invariant across wide range of sources
for (const src of [12, 15, 18, 23.976, 24, 25, 29.97, 30, 60]) {
  const cands = buildFpsCandidates(src, 'webm');
  for (const c of cands) {
    assert.ok(
      c <= src + 0.001,
      `Candidate ${c} must not exceed WebM source ${src}`,
    );
    assert.ok(c <= 30, `Candidate ${c} must not exceed WebM cap 30`);
  }
}

// Test 16: no TGS upsampling invariant across wide range of sources
for (const src of [10, 12, 20, 24, 25, 30, 48, 50, 60, 120]) {
  const cands = buildFpsCandidates(src, 'tgs');
  for (const c of cands) {
    assert.ok(
      c <= src + 0.001,
      `Candidate ${c} must not exceed TGS source ${src}`,
    );
    assert.ok(c <= 60, `Candidate ${c} must not exceed TGS cap 60`);
  }
}

// Test 17: Quality ladder profile generation from FPS candidates
const tgs60Profiles = buildAvifEncodingProfiles([60, 48, 30, 24, 20, 16]);
assert.equal(tgs60Profiles.length, 9);
assert.deepEqual(
  tgs60Profiles.map(p => ({fps: p.fps, crf: p.crf})),
  [
    {fps: 60, crf: 24},
    {fps: 60, crf: 28},
    {fps: 60, crf: 32},
    {fps: 60, crf: 36},
    {fps: 48, crf: 36},
    {fps: 30, crf: 36},
    {fps: 24, crf: 36},
    {fps: 20, crf: 36},
    {fps: 16, crf: 36},
  ],
);

// Test 18: Fallback profile selection integration (60 FPS too large -> 48 FPS too large -> 30 FPS fits)
const dynamicFallbackDir = await fsp.mkdtemp(
  path.join(tempDir, 'dynamic-fallback-'),
);
const dynInput = path.join(dynamicFallbackDir, 'test.webm');
const dynOutput = path.join(dynamicFallbackDir, 'test.avif');
await fsp.writeFile(dynInput, 'dummy-webm');
const attemptedFpsList: number[] = [];
const dynamicFallbackEncoder: AvifEncoder = async (_in, candPath, prof) => {
  attemptedFpsList.push(prof.fps);
  await fsp.writeFile(candPath, '');
  // Profiles with fps > 30 fail size check
  if (prof.fps > 30) {
    await fsp.truncate(candPath, AVIF_HARD_LIMIT_BYTES + 1);
  } else {
    await fsp.truncate(candPath, 2_000_000);
  }
};
const customTgsProfiles = buildAvifEncodingProfiles([60, 48, 30, 24, 20, 16]);
const dynResult = await convertToAvifWithEncoder(
  dynInput,
  dynOutput,
  dynamicFallbackEncoder,
  'TGS',
  customTgsProfiles,
);
assert.equal(dynResult.profile.fps, 30);
assert.equal(dynResult.sizeBytes, 2_000_000);
assert.ok(attemptedFpsList.includes(60));
assert.ok(attemptedFpsList.includes(48));
assert.ok(attemptedFpsList.includes(30));
await fsp.rm(dynamicFallbackDir, {recursive: true, force: true});

// Test 19: Strict 3-second limit and frame count validation
const strictCheckProfile60 = {maxDimension: 160, fps: 60, crf: 24, cpuUsed: 3};
assert.equal(
  Math.ceil(AVIF_MAX_DURATION_SECONDS * strictCheckProfile60.fps),
  180,
);
assert.equal(
  Math.ceil(AVIF_MAX_DURATION_SECONDS * strictCheckProfile60.fps) /
    strictCheckProfile60.fps,
  3.0,
);
const strictCheckProfile2997 = {
  maxDimension: 160,
  fps: 29.97002997,
  crf: 24,
  cpuUsed: 3,
};
assert.equal(AVIF_FPS_TOLERANCE, 0.01);
assert.ok(
  Math.abs(30 - strictCheckProfile2997.fps) > AVIF_FPS_TOLERANCE,
  '30 FPS must be rejected for 29.97002997 profile under 0.01 tolerance',
);
assert.ok(
  Math.abs(29.97 - strictCheckProfile2997.fps) <= AVIF_FPS_TOLERANCE,
  '29.97 FPS must be accepted for 29.97002997 profile under 0.01 tolerance',
);

console.log('Verified: P0 - Source-dependent FPS tests passed');
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

const publicPack3Name = 'PublicCatalogStaticPreviewPack';
const publicPack3ManifestPath = generateStickerPackFilePath(publicPack3Name);
await fsp.writeFile(
  publicPack3ManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${publicPack3Name}`,
    title: 'Public Catalog Static Preview Pack',
    stickers: [
      {
        id: 's1',
        image: `https://stickers.example.com/sticker/telegram/${publicPack3Name}/s1.webp`,
        previewImage: `https://stickers.example.com/preview/telegram/${publicPack3Name}/s1.webp`,
      },
    ],
    logo: {
      id: 'logo',
      image: `https://stickers.example.com/sticker/telegram/${publicPack3Name}/logo.webp`,
      previewImage: `https://stickers.example.com/preview/telegram/${publicPack3Name}/logo.webp`,
      isAnimated: false,
    },
  }),
);
await fsp.writeFile(
  getStickerPackMetadataPath(publicPack3Name),
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
  3,
  'Catalog must contain exactly the 3 valid public packs',
);
assert.deepEqual(
  catalogPacks.map(p => p.name),
  [publicPack2Name, publicPack1Name, publicPack3Name],
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
assert.equal(
  pubSummary1.fullPreview,
  undefined,
  'Animated public pack must not expose fullPreview to avoid redundant static image downloads',
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
assert.equal(
  pubSummary2.fullPreview,
  undefined,
  'Static public pack without distinct previewImage must not set fullPreview',
);

const pubSummary3 = catalogPacks.find(p => p.name === publicPack3Name)!;
assert.equal(pubSummary3.id, `MoreStickers:Telegram:Pack:${publicPack3Name}`);
assert.equal(pubSummary3.title, 'Public Catalog Static Preview Pack');
assert.equal(pubSummary3.stickerCount, 1);
assert.equal(
  pubSummary3.preview,
  `https://stickers.example.com/preview/telegram/${publicPack3Name}/logo.webp`,
  'Static public pack with previewImage must use previewImage for preview',
);
assert.equal(
  pubSummary3.animatedPreview,
  undefined,
  'Static public pack must not set animatedPreview',
);
assert.equal(
  pubSummary3.fullPreview,
  `https://stickers.example.com/sticker/telegram/${publicPack3Name}/logo.webp`,
  'Static public pack with distinct previewImage must expose fullPreview for progressive loading',
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
assert.match(
  apiResponse.headers['etag'] as string,
  /^"[A-Za-z0-9_-]+"$/,
  'GET /api/stickerpacks must include a valid quoted ETag',
);
assert.equal(
  apiResponse.headers['access-control-expose-headers'],
  'ETag',
  'GET /api/stickerpacks must expose ETag header via CORS',
);
const catalogEtag = apiResponse.headers['etag'] as string;

// Exact If-None-Match conditional GET -> 304 Not Modified
const apiExactConditional = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': catalogEtag,
  },
});
assert.equal(
  apiExactConditional.statusCode,
  304,
  'Exact If-None-Match for catalog must return 304',
);
assert.equal(
  apiExactConditional.body,
  '',
  '304 catalog response body must be empty',
);
assert.equal(
  apiExactConditional.headers['etag'],
  catalogEtag,
  '304 catalog response must preserve current ETag',
);
assert.equal(
  apiExactConditional.headers['cache-control'],
  'no-cache',
  '304 catalog response must preserve Cache-Control: no-cache',
);

// Weak If-None-Match conditional GET -> 304
const apiWeakConditional = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': `W/${catalogEtag}`,
  },
});
assert.equal(
  apiWeakConditional.statusCode,
  304,
  'Weak If-None-Match for catalog must return 304',
);
assert.equal(apiWeakConditional.body, '');
assert.equal(apiWeakConditional.headers['etag'], catalogEtag);

// Multi-tag If-None-Match conditional GET -> 304
const apiMultiConditional = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': `"stale-1", ${catalogEtag}, "stale-2"`,
  },
});
assert.equal(
  apiMultiConditional.statusCode,
  304,
  'Multi-tag If-None-Match for catalog must return 304',
);
assert.equal(apiMultiConditional.body, '');

// Wildcard If-None-Match conditional GET -> 304
const apiWildcardConditional = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': '*',
  },
});
assert.equal(
  apiWildcardConditional.statusCode,
  304,
  'Wildcard If-None-Match for catalog must return 304',
);
assert.equal(apiWildcardConditional.body, '');

// Stale If-None-Match -> 200 with current catalog
const apiStaleConditional = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': '"stale-catalog-etag"',
  },
});
assert.equal(
  apiStaleConditional.statusCode,
  200,
  'Stale If-None-Match for catalog must return 200',
);
assert.equal(apiStaleConditional.headers['etag'], catalogEtag);

// Empty opaque tag / malformed / unclosed If-None-Match -> 200 without 500 error
const apiMalformed1 = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': '""',
  },
});
assert.equal(
  apiMalformed1.statusCode,
  200,
  'Empty opaque tag If-None-Match does not match and must return 200',
);
const apiMalformed2 = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': '"unclosed',
  },
});
assert.equal(
  apiMalformed2.statusCode,
  200,
  'Unclosed quote If-None-Match must return 200 without error',
);
const apiMalformed3 = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': '"other", *',
  },
});
assert.equal(
  apiMalformed3.statusCode,
  200,
  'Wildcard in list is invalid syntax and must return 200',
);
const apiMalformed4 = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': `w/${catalogEtag}`,
  },
});
assert.equal(
  apiMalformed4.statusCode,
  200,
  'Lowercase w/ is invalid syntax and must return 200',
);
const apiPacks = JSON.parse(apiResponse.body);
assert.equal(
  apiPacks.length,
  3,
  'API response must contain exactly 3 public packs',
);
assert.deepEqual(
  apiPacks.map((p: {name: string}) => p.name),
  [publicPack2Name, publicPack1Name, publicPack3Name],
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

const etagBefore = dynamicPublicResp.headers['etag'] as string;
const etagAfter = dynamicUnlistedResp.headers['etag'] as string;
assert.match(etagBefore, /^"[A-Za-z0-9_-]+"$/);
assert.match(etagAfter, /^"[A-Za-z0-9_-]+"$/);
assert.notEqual(
  etagBefore,
  etagAfter,
  'Catalog ETag must change when catalog items change',
);

// Request with stale etagBefore -> 200 with new etagAfter
const staleCatalogResp = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': etagBefore,
  },
});
assert.equal(
  staleCatalogResp.statusCode,
  200,
  'Stale catalog ETag after visibility change must return 200',
);
assert.equal(staleCatalogResp.headers['etag'], etagAfter);
const stalePacks = JSON.parse(staleCatalogResp.body);
assert.equal(
  stalePacks.some((p: {name: string}) => p.name === unlistedPackName),
  false,
);

// Request with fresh etagAfter -> 304
const freshCatalogResp = await app.inject({
  method: 'GET',
  url: '/api/stickerpacks',
  headers: {
    'if-none-match': etagAfter,
  },
});
assert.equal(
  freshCatalogResp.statusCode,
  304,
  'Fresh catalog ETag must return 304',
);
assert.equal(freshCatalogResp.body, '');
assert.equal(freshCatalogResp.headers['etag'], etagAfter);
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
assert.ok(
  rootHtml.includes('cardQualityObserver'),
  'HTML must define cardQualityObserver for progressive static cover loading',
);
assert.ok(
  rootHtml.includes('data-full-src'),
  'HTML must support data-full-src for progressive high-quality image loading',
);
assert.ok(
  rootHtml.includes('data-animated-src'),
  'HTML must support data-animated-src for animated preview hover animation',
);
assert.ok(
  rootHtml.includes('enableHoverAnimation'),
  'HTML must define enableHoverAnimation for on-demand hover loading',
);
assert.ok(
  rootHtml.includes('isHovered'),
  'HTML must guard hover animation race conditions with isHovered check',
);
assert.equal(
  rootHtml.includes('animatedPreviewObserver'),
  false,
  'HTML must NOT use animatedPreviewObserver to avoid preloading heavy animated AVIF on viewport scroll',
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
  let changedRefreshPackTitle = 'Refresh Test Pack';
  const mockChangedRefreshTelegram = {
    getStickerSet: async (name: string) => ({
      name,
      title: changedRefreshPackTitle,
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

  changedRefreshPackTitle = 'Renamed Refresh Test Pack';
  const ctxTitleChange = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockChangedRefreshTelegram,
  });
  assert.equal(await handleRefreshCommand(ctxTitleChange), true);
  assert.ok(
    ctxTitleChange.replies.some(r => r.includes('Version: 7')),
    'Changing only the pack title must advance the published version',
  );
  const titleChangedManifest = validateLocalStickerPackManifest(
    JSON.parse(await fsp.readFile(refreshManifestPath, 'utf8')),
  );
  assert.equal(titleChangedManifest?.title, changedRefreshPackTitle);
  assert.equal(titleChangedManifest?.dynamic?.version, 7);
  const refreshVersion7 = await readStickerVersionIndex(refreshPackName, 7);
  assert.deepEqual(refreshVersion7?.stickers, refreshVersion6.stickers);
  assert.deepEqual(refreshVersion7?.previews, refreshVersion6.previews);
  assert.equal(refreshVersion7?.signature, refreshVersion6.signature);

  const ctxSameRenamedTitle = createMockContext({
    userId: allowedUserId,
    args: [refreshPackName],
    telegram: mockChangedRefreshTelegram,
  });
  assert.equal(await handleRefreshCommand(ctxSameRenamedTitle), true);
  assert.ok(
    ctxSameRenamedTitle.replies.some(r => r.includes('Version: 7')),
    'Refreshing the same renamed title must remain at the published version',
  );
  assert.equal(
    validateLocalStickerPackManifest(
      JSON.parse(await fsp.readFile(refreshManifestPath, 'utf8')),
    )?.dynamic?.version,
    7,
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
  path.join(checkDir, 'asset-1.avif'),
  Buffer.from('fake-asset'),
);
await fsp.mkdir(path.join(checkDir, 'previews'), {recursive: true});
await fsp.writeFile(
  path.join(checkDir, 'previews', 'asset-1.webp'),
  Buffer.from('fake-preview'),
);
const checkStickerAsset = await storeStickerAsset(
  checkPackName,
  path.join(checkDir, 'asset-1.avif'),
);
const checkPreviewAsset = await storeStickerAsset(
  checkPackName,
  path.join(checkDir, 'previews', 'asset-1.webp'),
);
await writeStickerVersionIndexAtomically(checkPackName, {
  version: 2,
  signature: 'check-pack',
  stickers: {'asset-1.avif': checkStickerAsset},
  previews: {'asset-1.webp': checkPreviewAsset},
});
await fsp.writeFile(
  checkManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${checkPackName}`,
    title: 'Check Test Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${checkPackName}:asset-1`,
      image: `https://stickers.example.com/sticker/telegram/${checkPackName}/2/asset-1.avif`,
      title: '🐱',
      stickerPackId: `MoreStickers:Telegram:Pack:${checkPackName}`,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${checkPackName}:asset-1`,
        image: `https://stickers.example.com/sticker/telegram/${checkPackName}/2/asset-1.avif`,
        previewImage: `https://stickers.example.com/preview/telegram/${checkPackName}/2/asset-1.webp`,
        title: '🐱',
        stickerPackId: `MoreStickers:Telegram:Pack:${checkPackName}`,
        filename: 'asset-1.avif',
        isAnimated: true,
        readyToUpload: true,
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
            is_video: true,
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
assert.ok(
  statusResp.includes('Refresh all: idle'),
  'Status response must indicate Refresh all: idle when not running',
);
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
console.log('Testing /refresh_all command...');

// 1. Helper function listLocalStickerPackNames
const allPacksBefore = await listLocalStickerPackNames();
assert.ok(Array.isArray(allPacksBefore));

// Verify listLocalStickerPackNames ignores temporary files and invalid names
const fakeTmpPackFile = path.join(
  DATA_DIR,
  'IgnoredTmpPack.telegram.stickerpack.12345.tmp',
);
await fsp.writeFile(fakeTmpPackFile, 'temp-file');
const fakeSubdir = path.join(DATA_DIR, 'IgnoredSubdir.telegram.stickerpack');
await fsp.mkdir(fakeSubdir, {recursive: true});

try {
  const packsWithTmp = await listLocalStickerPackNames();
  assert.ok(
    !packsWithTmp.includes('IgnoredTmpPack'),
    'listLocalStickerPackNames must ignore .tmp files',
  );
  assert.ok(
    !packsWithTmp.includes('IgnoredSubdir'),
    'listLocalStickerPackNames must ignore directory entries',
  );
} finally {
  await fsp.rm(fakeTmpPackFile, {force: true}).catch(() => undefined);
  await fsp
    .rm(fakeSubdir, {recursive: true, force: true})
    .catch(() => undefined);
}

// 2. Unauthorized user / missing telegram
const ctxRefreshAllUnauthorized = createMockContext({
  userId: 'unauthorized_id',
  telegram: mockTelegram,
});
assert.equal(
  await handleRefreshAllCommand(ctxRefreshAllUnauthorized),
  false,
  'Unauthorized user must be rejected',
);
assert.equal(
  ctxRefreshAllUnauthorized.replies.length,
  0,
  'Unauthorized user must receive no replies',
);

const ctxRefreshAllNoTg = createMockContext({
  userId: allowedUserId,
  telegram: undefined,
});
assert.equal(
  await handleRefreshAllCommand(ctxRefreshAllNoTg),
  false,
  'Missing telegram client must fail',
);
assert.ok(
  ctxRefreshAllNoTg.replies[0]?.includes(
    'Error: Telegram client is unavailable.',
  ),
  'Missing telegram client must report error',
);

// 3. GIF -> WebM -> AVIF migration via refreshStickerPack
const gifMigrationPackName = 'LegacyGifMigrationRefreshAllPack';
const gifMigrationPackDir = generateStickerPackDirPath(gifMigrationPackName);
const gifMigrationManifestPath =
  generateStickerPackFilePath(gifMigrationPackName);
const gifMigrationPreviewDir =
  generateStickerPreviewDirPath(gifMigrationPackName);

await fsp.mkdir(gifMigrationPackDir, {recursive: true});
await fsp.mkdir(gifMigrationPreviewDir, {recursive: true});

// Store legacy GIF in CAS and write version 1 index
const legacyGifStoredAsset = await storeStickerAsset(
  gifMigrationPackName,
  testGifPath,
);
const legacyPreviewStoredAsset = await storeStickerAsset(
  gifMigrationPackName,
  path.join(tempDir, 'real_gif_preview.webp'),
);
await writeStickerVersionIndexAtomically(gifMigrationPackName, {
  version: 1,
  signature: 'legacy-gif-sig',
  stickers: {'anim_sticker.gif': legacyGifStoredAsset},
  previews: {'anim_sticker.webp': legacyPreviewStoredAsset},
});

// Write legacy manifest pointing to .gif
await fsp.writeFile(
  gifMigrationManifestPath,
  JSON.stringify({
    id: `MoreStickers:Telegram:Pack:${gifMigrationPackName}`,
    title: 'Legacy GIF RefreshAll Pack',
    logo: {
      id: `MoreStickers:Telegram:Sticker:${gifMigrationPackName}:anim_sticker`,
      image: `https://example.com/sticker/telegram/${gifMigrationPackName}/1/anim_sticker.gif`,
      previewImage: `https://example.com/preview/telegram/${gifMigrationPackName}/1/anim_sticker.webp`,
      title: '🎬',
      isAnimated: true,
      stickerPackId: `MoreStickers:Telegram:Pack:${gifMigrationPackName}`,
    },
    stickers: [
      {
        id: `MoreStickers:Telegram:Sticker:${gifMigrationPackName}:anim_sticker`,
        image: `https://example.com/sticker/telegram/${gifMigrationPackName}/1/anim_sticker.gif`,
        previewImage: `https://example.com/preview/telegram/${gifMigrationPackName}/1/anim_sticker.webp`,
        title: '🎬',
        filename: 'anim_sticker.gif',
        isAnimated: true,
        readyToUpload: true,
        stickerPackId: `MoreStickers:Telegram:Pack:${gifMigrationPackName}`,
      },
    ],
    dynamic: {
      version: 1,
      refreshUrl: `https://example.com/stickerpack/telegram/${gifMigrationPackName}`,
    },
  }),
);

// Set up mock telegram returning real WebM for LegacyGifMigrationRefreshAllPack
const realWebmBytes = await fsp.readFile(testWebmPath);
let tgDownloadCalledForMigration = false;
const mockMigrationTg = {
  getStickerSet: async (name: string) => {
    if (name !== gifMigrationPackName) {
      throw new Error(`Unexpected pack: ${name}`);
    }
    return {
      name,
      title: 'Legacy GIF RefreshAll Pack',
      stickers: [
        {
          file_id: 'file-anim-1',
          file_unique_id: 'anim_sticker',
          emoji: '🎬',
          is_animated: false,
          is_video: true,
          width: 512,
          height: 512,
          type: 'regular',
        },
      ],
    };
  },
  getFile: async () => ({
    file_id: 'file-anim-1',
    file_path: 'stickers/anim_sticker.webm',
  }),
  getFileLink: async () => new URL('https://example.com/anim_sticker.webm'),
} as unknown as Telegram;

const savedFetchForMigration = globalThis.fetch;
globalThis.fetch = (async () => {
  tgDownloadCalledForMigration = true;
  return new Response(realWebmBytes, {
    status: 200,
    headers: {'Content-Type': 'video/webm'},
  });
}) as unknown as typeof fetch;

try {
  const refreshResult = await refreshStickerPack(
    mockMigrationTg,
    gifMigrationPackName,
  );
  assert.equal(refreshResult.success, true, 'refreshStickerPack must succeed');
  assert.equal(refreshResult.version, 2, 'Version must bump from 1 to 2');
  assert.equal(
    tgDownloadCalledForMigration,
    true,
    'Telegram WebM must be fetched from Telegram',
  );

  const updatedManifest = validateLocalStickerPackManifest(
    JSON.parse(await fsp.readFile(gifMigrationManifestPath, 'utf8')),
  );
  assert.ok(updatedManifest);
  assert.equal(updatedManifest.dynamic?.version, 2);
  assert.equal(
    updatedManifest.stickers[0].filename,
    'anim_sticker.avif',
    'Animated sticker filename must be .avif',
  );
  assert.ok(
    updatedManifest.stickers[0].image.endsWith('/2/anim_sticker.avif'),
    'Sticker image URL must point to .avif',
  );
  assert.ok(
    updatedManifest.stickers[0].previewImage?.endsWith('/2/anim_sticker.webp'),
    'Preview image URL must point to .webp',
  );

  const version1Index = await readStickerVersionIndex(gifMigrationPackName, 1);
  const version2Index = await readStickerVersionIndex(gifMigrationPackName, 2);
  assert.ok(version1Index);
  assert.ok(version2Index);
  assert.equal(
    version1Index.stickers['anim_sticker.gif'],
    legacyGifStoredAsset,
    'Historical version 1 index must retain .gif',
  );
  assert.match(
    version2Index.stickers['anim_sticker.avif'] ?? '',
    /^[a-f0-9]{64}\.avif$/,
    'Version 2 index must map .avif to CAS hash',
  );
  assert.match(
    version2Index.previews['anim_sticker.webp'] ?? '',
    /^[a-f0-9]{64}\.webp$/,
    'Version 2 index must map preview to CAS hash',
  );

  // Idempotent second refresh: must not bump version again
  const secondRefreshResult = await refreshStickerPack(
    mockMigrationTg,
    gifMigrationPackName,
  );
  assert.equal(secondRefreshResult.success, true);
  assert.equal(
    secondRefreshResult.version,
    2,
    'Second identical refresh must remain at version 2',
  );
} finally {
  globalThis.fetch = savedFetchForMigration;
}

// 4. Multi-pack error isolation and sequence verification (concurrency = 1)
const multiPackA = 'MultiRefreshPackA';
const multiPackB = 'MultiRefreshPackB';
const multiPackC = 'MultiRefreshPackC';

for (const p of [multiPackA, multiPackB, multiPackC]) {
  const pDir = generateStickerPackDirPath(p);
  const pPath = generateStickerPackFilePath(p);
  await fsp.mkdir(pDir, {recursive: true});
  await fsp.writeFile(
    pPath,
    JSON.stringify({
      id: `MoreStickers:Telegram:Pack:${p}`,
      title: `Title ${p}`,
      stickers: [],
      dynamic: {
        version: 1,
        refreshUrl: `https://example.com/stickerpack/telegram/${p}`,
      },
    }),
  );
}

let activeRefreshes = 0;
let maxActiveRefreshes = 0;
const processedPacks: string[] = [];

const mockMultiTg = {
  getStickerSet: async (name: string) => {
    activeRefreshes++;
    maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes);
    processedPacks.push(name);
    await new Promise(r => setTimeout(r, 15)); // simulate async I/O
    activeRefreshes--;

    if (name === multiPackB) {
      throw new Error('Telegram STICKERSET_INVALID');
    }

    return {
      name,
      title: `Refreshed ${name}`,
      stickers: [
        {
          file_id: `file-${name}-1`,
          file_unique_id: `uniq-${name}-1`,
          emoji: '⭐',
          is_animated: false,
          is_video: false,
        },
      ],
    };
  },
  getFile: async () => ({
    file_path: 'documents/file.webp',
  }),
  getFileLink: async () => new URL('https://example.com/file.webp'),
} as unknown as Telegram;

const savedFetchForMulti = globalThis.fetch;
globalThis.fetch = (async () => {
  return new Response(sampleWebpBuffer, {
    status: 200,
    headers: {'Content-Type': 'image/webp'},
  });
}) as unknown as typeof fetch;

try {
  const ctxMulti = createMockContext({
    userId: allowedUserId,
    telegram: mockMultiTg,
  });

  const allPacksList = await listLocalStickerPackNames();
  const multiResult = await handleRefreshAllCommand(ctxMulti);

  assert.equal(
    maxActiveRefreshes,
    1,
    'Pack-level refresh concurrency must be strictly 1 (sequential)',
  );
  assert.equal(
    multiResult,
    false,
    'handleRefreshAllCommand must return false when any pack fails',
  );

  assert.ok(
    ctxMulti.replies.some(r => r.startsWith('Refreshing ')),
    'Must send initial refreshing notification',
  );

  const summaryReply = ctxMulti.replies.find(r =>
    r.includes('Refresh all finished.'),
  );
  assert.ok(summaryReply, 'Summary reply must be sent');
  assert.ok(
    summaryReply.includes(`Total: ${allPacksList.length}`),
    'Summary must contain total pack count',
  );
  assert.ok(
    summaryReply.includes('Failed:'),
    'Summary must report failed count',
  );
  assert.ok(
    summaryReply.includes(`- ${multiPackB}:`),
    'Summary must list the failing pack name',
  );

  // Verify Pack A and Pack C were refreshed despite Pack B failing
  const manifestA = validateLocalStickerPackManifest(
    JSON.parse(
      await fsp.readFile(generateStickerPackFilePath(multiPackA), 'utf8'),
    ),
  );
  const manifestC = validateLocalStickerPackManifest(
    JSON.parse(
      await fsp.readFile(generateStickerPackFilePath(multiPackC), 'utf8'),
    ),
  );
  assert.ok(manifestA, 'Pack A must be refreshed');
  assert.equal(manifestA.title, `Refreshed ${multiPackA}`);
  assert.ok(manifestC, 'Pack C must be refreshed');
  assert.equal(manifestC.title, `Refreshed ${multiPackC}`);

  // Verify Pack B was not deleted
  assert.ok(
    fs.existsSync(generateStickerPackFilePath(multiPackB)),
    'Failing Pack B manifest must not be deleted',
  );
} finally {
  globalThis.fetch = savedFetchForMulti;
}

// 5. Global guard against concurrent /refresh_all invocations
let firstStickerSetStartedResolve: () => void;
const firstStickerSetStarted = new Promise<void>(resolve => {
  firstStickerSetStartedResolve = resolve;
});
let releaseFirstStickerSetResolve: () => void;
const releaseFirstStickerSet = new Promise<void>(resolve => {
  releaseFirstStickerSetResolve = resolve;
});

const mockGuardTg = {
  getStickerSet: async (name: string) => {
    firstStickerSetStartedResolve();
    await releaseFirstStickerSet;
    return {
      name,
      title: `Guard ${name}`,
      stickers: [
        {
          file_id: `file-${name}`,
          file_unique_id: `uniq-${name}`,
          emoji: '🛡️',
          is_animated: false,
          is_video: false,
        },
      ],
    };
  },
  getFile: async () => ({
    file_path: 'documents/file.webp',
  }),
  getFileLink: async () => new URL('https://example.com/file.webp'),
} as unknown as Telegram;
const savedFetchForGuard = globalThis.fetch;
globalThis.fetch = (async () => {
  return new Response(sampleWebpBuffer, {
    status: 200,
    headers: {'Content-Type': 'image/webp'},
  });
}) as unknown as typeof fetch;

try {
  const ctxGuard1 = createMockContext({
    userId: allowedUserId,
    telegram: mockGuardTg,
  });
  const ctxGuard2 = createMockContext({
    userId: allowedUserId,
    telegram: mockGuardTg,
  });

  const run1Promise = handleRefreshAllCommand(ctxGuard1);
  await firstStickerSetStarted;

  const run2Handled = await handleRefreshAllCommand(ctxGuard2);
  assert.equal(
    run2Handled,
    false,
    'Concurrent /refresh_all must be rejected immediately',
  );
  assert.ok(
    ctxGuard2.replies.some(r => r.includes('Refresh all is already running.')),
    'Concurrent /refresh_all must notify that it is already running',
  );

  releaseFirstStickerSetResolve!();
  await run1Promise;

  assert.ok(
    ctxGuard1.replies.some(r => r.includes('Refresh all finished.')),
    'First /refresh_all must finish successfully after unblocking',
  );

  // Third invocation after first run settles must be accepted and run normally
  const ctxGuard3 = createMockContext({
    userId: allowedUserId,
    telegram: mockGuardTg,
  });
  const run3Handled = await handleRefreshAllCommand(ctxGuard3);
  assert.equal(typeof run3Handled, 'boolean');
  assert.equal(
    ctxGuard3.replies.some(r => r.includes('Refresh all is already running.')),
    false,
    'Subsequent /refresh_all after run 1 settles must not be rejected by guard',
  );
  assert.ok(
    ctxGuard3.replies.some(r => r.includes('Refresh all finished.')),
    'Subsequent /refresh_all must complete normally',
  );
} finally {
  globalThis.fetch = savedFetchForGuard;
}

// 6. Comprehensive tests for /refresh_all progress, status, cooperative cancellation, and lifecycle
console.log(
  'Testing /refresh_all progress, status, and cooperative cancellation...',
);

// Test 1: Status idle contract
{
  const idleStatus = getRefreshAllStatus();
  assert.equal(idleStatus.running, false, 'idle status running must be false');
  assert.equal(
    idleStatus.cancelRequested,
    false,
    'idle status cancelRequested must be false',
  );
  assert.equal(idleStatus.total, 0, 'idle status total must be 0');
  assert.equal(idleStatus.processed, 0, 'idle status processed must be 0');
  assert.equal(idleStatus.successful, 0, 'idle status successful must be 0');
  assert.equal(idleStatus.failed, 0, 'idle status failed must be 0');
  assert.equal(
    idleStatus.currentPack,
    undefined,
    'idle status currentPack must be undefined',
  );

  const ctxIdle = createMockContext({userId: allowedUserId});
  const handledIdle = await handleStatusCommand(ctxIdle);
  assert.equal(handledIdle, true);
  assert.ok(
    ctxIdle.replies[0]?.includes('Refresh all: idle'),
    '/status must report "Refresh all: idle" when no batch is active',
  );
}

// Test 2, 3, 12: Progress during execution, failed pack increases progress count, /status formatting
{
  const progPackA = 'ProgressTestPackA';
  const progPackB = 'ProgressTestPackB';
  const progPackC = 'ProgressTestPackC';

  for (const p of [progPackA, progPackB, progPackC]) {
    const pDir = generateStickerPackDirPath(p);
    const pPath = generateStickerPackFilePath(p);
    await fsp.mkdir(pDir, {recursive: true});
    await fsp.writeFile(
      pPath,
      JSON.stringify({
        id: `MoreStickers:Telegram:Pack:${p}`,
        title: `Title ${p}`,
        stickers: [],
        dynamic: {
          version: 1,
          refreshUrl: `https://example.com/stickerpack/telegram/${p}`,
        },
      }),
    );
  }

  let packBStartedResolve!: () => void;
  const packBStarted = new Promise<void>(resolve => {
    packBStartedResolve = resolve;
  });
  let releasePackBResolve!: () => void;
  const releasePackB = new Promise<void>(resolve => {
    releasePackBResolve = resolve;
  });

  const processedInOrder: string[] = [];

  const mockProgressTg = {
    getStickerSet: async (name: string) => {
      processedInOrder.push(name);
      if (name === progPackB) {
        packBStartedResolve();
        await releasePackB;
        throw new Error('Simulated Telegram failure on PackB');
      }
      return {
        name,
        title: `Refreshed ${name}`,
        stickers: [
          {
            file_id: `file-${name}-prog`,
            file_unique_id: `uniq-${name}-prog`,
            emoji: '📊',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    },
    getFile: async () => ({
      file_path: 'documents/file.webp',
    }),
    getFileLink: async () => new URL('https://example.com/file.webp'),
  } as unknown as Telegram;

  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as unknown as typeof fetch;

  try {
    const ctxProgressBatch = createMockContext({
      userId: allowedUserId,
      telegram: mockProgressTg,
    });

    const batchPromise = handleRefreshAllCommand(ctxProgressBatch);

    // Wait until Pack B starts (after all packs before B have been processed)
    await packBStarted;

    // Test 2: Verify active snapshot while Pack B is in progress
    const activeSnapshot = getRefreshAllStatus();
    assert.equal(
      activeSnapshot.running,
      true,
      'Active snapshot must have running=true',
    );
    assert.ok(
      activeSnapshot.total >= 3,
      'Active snapshot total must be at least 3',
    );
    assert.equal(
      activeSnapshot.currentPack,
      progPackB,
      'Active snapshot currentPack must be ProgressTestPackB',
    );
    assert.equal(
      activeSnapshot.cancelRequested,
      false,
      'Active snapshot cancelRequested must be false',
    );
    assert.equal(
      typeof activeSnapshot.startedAt,
      'number',
      'startedAt must be timestamp number',
    );

    // Test 12: Verify /status command output while running
    const ctxStatusRunning = createMockContext({userId: allowedUserId});
    await handleStatusCommand(ctxStatusRunning);
    const statusRunningText = ctxStatusRunning.replies[0] ?? '';
    assert.ok(
      statusRunningText.includes('Refresh all: running'),
      '/status must contain "Refresh all: running"',
    );
    assert.ok(
      statusRunningText.includes(`Current: ${progPackB}`),
      '/status must contain "Current: ProgressTestPackB"',
    );
    assert.ok(
      statusRunningText.includes(
        `Progress: ${activeSnapshot.processed + 1}/${activeSnapshot.total}`,
      ),
      '/status must contain current progress indicator',
    );
    assert.ok(
      statusRunningText.includes('Cancel requested: no'),
      '/status must show "Cancel requested: no"',
    );
    assert.ok(
      statusRunningText.includes('Elapsed:'),
      '/status must show elapsed duration',
    );

    // Release Pack B (which throws an error)
    releasePackBResolve();
    const batchResult = await batchPromise;

    // Test 3: Pack B failed, but Pack C was still processed
    assert.equal(
      batchResult,
      false,
      'Batch must return false because Pack B failed',
    );
    assert.ok(
      processedInOrder.includes(progPackC),
      'Pack C must be processed even though Pack B failed',
    );

    // Verify final report contains both successful and failed counts
    const finalReport = ctxProgressBatch.replies.find(r =>
      r.includes('Refresh all finished.'),
    );
    assert.ok(finalReport, 'Final report must be delivered');
    assert.ok(
      finalReport.includes(`- ${progPackB}:`),
      'Final report must list failed Pack B',
    );

    // State must be reset after batch finishes
    const afterBatchStatus = getRefreshAllStatus();
    assert.equal(
      afterBatchStatus.running,
      false,
      'Status must return to running=false after batch',
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
}

// Test 4, 5, 7, 8: Cooperative cancellation, double cancel, concurrent guard while cancelling
{
  const cancelPackA = 'CancelFlowPackA';
  const cancelPackB = 'CancelFlowPackB';
  const cancelPackC = 'CancelFlowPackC';
  const cancelPackD = 'CancelFlowPackD';

  for (const p of [cancelPackA, cancelPackB, cancelPackC, cancelPackD]) {
    const pDir = generateStickerPackDirPath(p);
    const pPath = generateStickerPackFilePath(p);
    await fsp.mkdir(pDir, {recursive: true});
    await fsp.writeFile(
      pPath,
      JSON.stringify({
        id: `MoreStickers:Telegram:Pack:${p}`,
        title: `Title ${p}`,
        stickers: [],
        dynamic: {
          version: 1,
          refreshUrl: `https://example.com/stickerpack/telegram/${p}`,
        },
      }),
    );
  }

  let cancelPackBStartedResolve!: () => void;
  const cancelPackBStarted = new Promise<void>(resolve => {
    cancelPackBStartedResolve = resolve;
  });
  let releaseCancelPackBResolve!: () => void;
  const releaseCancelPackB = new Promise<void>(resolve => {
    releaseCancelPackBResolve = resolve;
  });

  const startedPacks: string[] = [];
  const finishedPacks: string[] = [];

  const mockCancelTg = {
    getStickerSet: async (name: string) => {
      startedPacks.push(name);
      if (name === cancelPackB) {
        cancelPackBStartedResolve();
        await releaseCancelPackB;
      }
      finishedPacks.push(name);
      return {
        name,
        title: `Refreshed ${name}`,
        stickers: [
          {
            file_id: `file-${name}-cancel`,
            file_unique_id: `uniq-${name}-cancel`,
            emoji: '🛑',
            is_animated: false,
            is_video: false,
          },
        ],
      };
    },
    getFile: async () => ({
      file_path: 'documents/file.webp',
    }),
    getFileLink: async () => new URL('https://example.com/file.webp'),
  } as unknown as Telegram;

  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(sampleWebpBuffer, {
      status: 200,
      headers: {'Content-Type': 'image/webp'},
    });
  }) as unknown as typeof fetch;

  try {
    const ctxCancelBatch = createMockContext({
      userId: allowedUserId,
      telegram: mockCancelTg,
    });

    const batchPromise = handleRefreshAllCommand(ctxCancelBatch);
    await cancelPackBStarted;

    // While Pack B is active:
    assert.equal(
      getRefreshAllStatus().currentPack,
      cancelPackB,
      'Current pack must be CancelFlowPackB',
    );

    // Test 4 & 5: Trigger cancellation
    const ctxCancelCmd1 = createMockContext({userId: allowedUserId});
    const cancelCmd1Handled =
      await handleRefreshAllCancelCommand(ctxCancelCmd1);
    assert.equal(cancelCmd1Handled, true);
    assert.ok(
      ctxCancelCmd1.replies[0]?.includes(
        'Refresh all cancellation requested.\nThe current pack will finish before the operation stops.',
      ),
      'First cancel must reply with cooperative cancellation confirmation',
    );
    assert.equal(
      getRefreshAllStatus().cancelRequested,
      true,
      'cancelRequested must be true in state',
    );

    // Test 7: Double cancel must be idempotent
    const ctxCancelCmd2 = createMockContext({userId: allowedUserId});
    const cancelCmd2Handled =
      await handleRefreshAllCancelCommand(ctxCancelCmd2);
    assert.equal(cancelCmd2Handled, true);
    assert.ok(
      ctxCancelCmd2.replies[0]?.includes(
        'Refresh all cancellation has already been requested.',
      ),
      'Second cancel must inform that cancellation is already pending',
    );

    // Test 8: Second /refresh_all invocation while cancelling is rejected
    const ctxConcurrentWhileCancelling = createMockContext({
      userId: allowedUserId,
      telegram: mockCancelTg,
    });
    const concurrentHandled = await handleRefreshAllCommand(
      ctxConcurrentWhileCancelling,
    );
    assert.equal(
      concurrentHandled,
      false,
      'Second /refresh_all during cancellation must be rejected',
    );
    assert.ok(
      ctxConcurrentWhileCancelling.replies.some(r =>
        r.includes('Refresh all is already running.'),
      ),
      'Must notify that refresh all is already running',
    );

    // Test 12: /status when cancelRequested is true
    const ctxStatusCancelling = createMockContext({userId: allowedUserId});
    await handleStatusCommand(ctxStatusCancelling);
    const statusCancellingText = ctxStatusCancelling.replies[0] ?? '';
    assert.ok(
      statusCancellingText.includes('Cancel requested: yes'),
      '/status must show "Cancel requested: yes"',
    );

    // Release Pack B
    releaseCancelPackBResolve();
    const batchResult = await batchPromise;
    assert.equal(batchResult, false, 'Cancelled batch must return false');

    // Test 5: Verify Pack B completed and no subsequent packs started after cancellation
    assert.ok(
      finishedPacks.includes(cancelPackB),
      'Pack B must finish completely despite cancellation',
    );
    const indexOfBInStarted = startedPacks.indexOf(cancelPackB);
    assert.ok(indexOfBInStarted !== -1);
    const packsStartedAfterB = startedPacks.slice(indexOfBInStarted + 1);
    assert.equal(
      packsStartedAfterB.length,
      0,
      'No packs must start after the cancelled pack finishes',
    );
    assert.ok(
      !startedPacks.includes(cancelPackC),
      'Pack C must never be started',
    );
    assert.ok(
      !startedPacks.includes(cancelPackD),
      'Pack D must never be started',
    );

    // Test 4: Final cancelled report format
    const cancelledReport = ctxCancelBatch.replies.find(r =>
      r.includes('Refresh all cancelled.'),
    );
    assert.ok(cancelledReport, 'Cancelled report must be sent');
    assert.ok(
      cancelledReport.includes('Processed:'),
      'Cancelled report must include Processed count',
    );
    assert.ok(
      cancelledReport.includes('Successful:'),
      'Cancelled report must include Successful count',
    );
    assert.ok(
      cancelledReport.includes('Failed:'),
      'Cancelled report must include Failed count',
    );
    assert.ok(
      cancelledReport.includes('Skipped:'),
      'Cancelled report must include Skipped count',
    );

    // Test 9: Cleanup after cancellation
    assert.equal(
      getRefreshAllStatus().running,
      false,
      'State must be cleared after cancelled batch',
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
}

// Test 6: Cancel when idle and authorization checks
{
  const ctxCancelIdle = createMockContext({userId: allowedUserId});
  const cancelIdleHandled = await handleRefreshAllCancelCommand(ctxCancelIdle);
  assert.equal(cancelIdleHandled, true);
  assert.ok(
    ctxCancelIdle.replies[0]?.includes(
      'No refresh all operation is currently running.',
    ),
    'Cancel when idle must report no operation is running',
  );
  assert.equal(getRefreshAllStatus().running, false);

  // Unauthorized cancel
  const ctxCancelUnauthorized = createMockContext({
    userId: 'unauthorized_999',
  });
  const cancelUnauthHandled = await handleRefreshAllCancelCommand(
    ctxCancelUnauthorized,
  );
  assert.equal(
    cancelUnauthHandled,
    false,
    'Unauthorized user must be rejected',
  );
  assert.equal(
    ctxCancelUnauthorized.replies.length,
    0,
    'Unauthorized cancel must produce 0 replies',
  );
}

// Test 10: State cleanup after truly unhandled exception escaping handleRefreshAllCommand
{
  assert.equal(getRefreshAllStatus().running, false);
  const ctxThrowingReply = {
    from: {id: allowedUserId},
    telegram: mockTelegram,
    reply: async (text: string) => {
      if (text.startsWith('Refreshing ')) {
        throw new Error(
          'Telegram network connection dropped during initial notification',
        );
      }
      return {};
    },
  };

  await assert.rejects(
    async () => {
      await handleRefreshAllCommand(ctxThrowingReply);
    },
    /Telegram network connection dropped during initial notification/,
    'handleRefreshAllCommand must propagate unhandled exception from reply',
  );

  assert.equal(
    getRefreshAllStatus().running,
    false,
    'State must be cleaned up in finally block after truly unhandled exception',
  );

  const ctxStatus = createMockContext({userId: allowedUserId});
  await handleStatusCommand(ctxStatus);
  assert.ok(
    ctxStatus.replies[0]?.includes('Refresh all: idle'),
    '/status must report idle after unhandled exception',
  );
}

// Test 11: Empty library handling
{
  assert.equal(getRefreshAllStatus().running, false);

  const backupDir = path.join(tempDir, '__empty_lib_backup__');
  await fsp.mkdir(backupDir, {recursive: true});

  // Temporarily move all .telegram.stickerpack files out of DATA_DIR
  const dirents = await fsp.readdir(DATA_DIR);
  const packFiles = dirents.filter(name =>
    name.endsWith('.telegram.stickerpack'),
  );
  for (const file of packFiles) {
    await fsp.rename(path.join(DATA_DIR, file), path.join(backupDir, file));
  }

  try {
    const packsBefore = await listLocalStickerPackNames();
    assert.equal(
      packsBefore.length,
      0,
      'Library must have 0 sticker packs for this test',
    );

    const ctxEmpty = createMockContext({
      userId: allowedUserId,
      telegram: mockTelegram,
    });

    const handled = await handleRefreshAllCommand(ctxEmpty);
    assert.equal(
      handled,
      true,
      'handleRefreshAllCommand must return true on empty library',
    );
    assert.equal(
      ctxEmpty.replies.length,
      1,
      'Must send exactly one reply on empty library',
    );
    assert.equal(
      ctxEmpty.replies[0],
      'No local sticker packs to refresh.',
      'Must notify that there are no local sticker packs',
    );

    const statusAfterEmpty = getRefreshAllStatus();
    assert.equal(
      statusAfterEmpty.running,
      false,
      'State must be idle after empty library refresh',
    );

    const ctxStatus = createMockContext({userId: allowedUserId});
    await handleStatusCommand(ctxStatus);
    assert.ok(
      ctxStatus.replies[0]?.includes('Refresh all: idle'),
      '/status must report idle after empty library run',
    );
  } finally {
    // Restore pack files
    for (const file of packFiles) {
      await fsp.rename(path.join(backupDir, file), path.join(DATA_DIR, file));
    }
    await fsp.rm(backupDir, {recursive: true, force: true});
  }
}

// =========================================================================
// Comprehensive test suite for /gc, /gc_dry, /gc_stats and unified GC engine
// =========================================================================
console.log('\nTesting /gc, /gc_dry, /gc_stats and unified GC engine...');

// Unit tests: formatByteSize and formatDurationSeconds
{
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(823), '823 B');
  assert.equal(formatByteSize(1024), '1 KiB');
  assert.equal(formatByteSize(12.4 * 1024), '12.4 KiB');
  assert.equal(formatByteSize(18.7 * 1024 * 1024), '18.7 MiB');
  assert.equal(formatByteSize(186.4 * 1024 * 1024), '186.4 MiB');
  assert.equal(formatByteSize(3.74 * 1024 * 1024 * 1024), '3.74 GiB');

  assert.equal(formatDurationSeconds(50), '50 ms');
  assert.equal(formatDurationSeconds(1800), '1.8 s');
}

// Test 1: Authorization for /gc, /gc_dry, /gc_stats
{
  const unauthCtx = createMockContext({userId: 'unauthorized_stranger'});
  assert.equal(
    await handleGcCommand(unauthCtx),
    false,
    '/gc must reject unauthorized user',
  );
  assert.equal(
    await handleGcDryCommand(unauthCtx),
    false,
    '/gc_dry must reject unauthorized user',
  );
  assert.equal(
    await handleGcStatsCommand(unauthCtx),
    false,
    '/gc_stats must reject unauthorized user',
  );
  assert.equal(
    unauthCtx.replies.length,
    0,
    'Unauthorized user must receive 0 replies',
  );
}

// Setup controlled fixture for Tests 2 - 9
const gcTestPackName = 'GcComprehensiveTestPack';
const gcTestPackDir = generateStickerPackDirPath(gcTestPackName);
const gcTestAssetsDir = generateStickerAssetsDirPath(gcTestPackName);
const gcTestVersionsDir = generateStickerVersionsDirPath(gcTestPackName);
await fsp.mkdir(gcTestAssetsDir, {recursive: true});
await fsp.mkdir(gcTestVersionsDir, {recursive: true});

const testAssetFiles: Record<string, string> = {};
for (let v = 1; v <= 7; v++) {
  const src = path.join(gcTestPackDir, `raw-${v}.webp`);
  await fsp.writeFile(src, `content-v${v}-${'x'.repeat(100)}`);
  const asset = await storeStickerAsset(gcTestPackName, src);
  testAssetFiles[`v${v}`] = asset;
  await fsp.unlink(src).catch(() => undefined);
}
// Orphaned asset (not referenced anywhere)
const orphanSrc = path.join(gcTestPackDir, 'raw-orphan.webp');
await fsp.writeFile(orphanSrc, `orphan-content-${'y'.repeat(200)}`);
const orphanAssetFilename = await storeStickerAsset(gcTestPackName, orphanSrc);
await fsp.unlink(orphanSrc).catch(() => undefined);

// Write version indexes 1..7
for (let v = 1; v <= 7; v++) {
  await writeStickerVersionIndexAtomically(gcTestPackName, {
    version: v,
    signature: `sig-v${v}`,
    stickers: {[`sticker_${v}.webp`]: testAssetFiles[`v${v}`]!},
    previews: {[`sticker_${v}.webp`]: testAssetFiles[`v${v}`]!},
  });
}

// Write manifest for current version 7
await writeStickerPackManifestAtomically(
  generateStickerPackFilePath(gcTestPackName),
  {
    id: gcTestPackName,
    title: 'GC Test Pack',
    animated: false,
    stickers: [
      {
        id: `${gcTestPackName}:sticker_7`,
        filename: 'sticker_7.webp',
        emojis: ['🧪'],
        isAnimated: false,
        media: {
          type: 'static',
          canonicalPath: 'sticker_7.webp',
          previewPath: 'sticker_7.webp',
        },
      },
    ],
    dynamic: {
      version: 7,
      url: `https://example.com/stickerpack/telegram/${gcTestPackName}`,
    },
  } as unknown as Parameters<typeof writeStickerPackManifestAtomically>[1],
);

// Test 2: /gc_stats on controlled storage
{
  const ctx = createMockContext({userId: allowedUserId});
  const handled = await handleGcStatsCommand(ctx);
  assert.equal(handled, true, '/gc_stats must handle authorized command');
  assert.equal(ctx.replies.length, 1, '/gc_stats must reply with 1 message');
  const reply = ctx.replies[0]!;
  assert.ok(reply.includes('Storage GC statistics'));
  assert.ok(reply.includes('Version indexes:'));
  assert.ok(reply.includes('CAS assets:'));
  assert.ok(reply.includes('CAS size:'));
  assert.ok(reply.includes('Referenced assets:'));
  assert.ok(reply.includes('Orphaned assets:'));
  assert.ok(reply.includes('Prunable version indexes:'));
  assert.ok(reply.includes('Estimated reclaimable:'));
  assert.ok(reply.includes('Retention: last 5 versions'));
}

// Test 3: /gc_stats is strictly read-only
{
  // Verify all 7 version indexes and all assets still exist
  for (let v = 1; v <= 7; v++) {
    const indexPath = generateStickerVersionIndexPath(gcTestPackName, v);
    await fsp.access(indexPath, fs.constants.R_OK);
    const assetPath = path.join(gcTestAssetsDir, testAssetFiles[`v${v}`]!);
    await fsp.access(assetPath, fs.constants.R_OK);
  }
  const orphanPath = path.join(gcTestAssetsDir, orphanAssetFilename);
  await fsp.access(orphanPath, fs.constants.R_OK);
  const manifestPath = generateStickerPackFilePath(gcTestPackName);
  await fsp.access(manifestPath, fs.constants.R_OK);
}

// Test 4: /gc_dry
{
  const ctx = createMockContext({userId: allowedUserId});
  const handled = await handleGcDryCommand(ctx);
  assert.equal(handled, true, '/gc_dry must handle authorized command');
  assert.equal(ctx.replies.length, 1, '/gc_dry must reply with 1 message');
  const reply = ctx.replies[0]!;
  assert.ok(reply.includes('Garbage collection dry run.'));
  assert.ok(reply.includes('Would remove version indexes:'));
  assert.ok(reply.includes('Would remove orphaned assets:'));
  assert.ok(reply.includes('Would free:'));
  assert.ok(reply.includes('No files were deleted.'));
}

// Test 5: /gc_dry does not delete any files
{
  for (let v = 1; v <= 7; v++) {
    const indexPath = generateStickerVersionIndexPath(gcTestPackName, v);
    await fsp.access(indexPath, fs.constants.R_OK);
  }
  const orphanPath = path.join(gcTestAssetsDir, orphanAssetFilename);
  await fsp.access(orphanPath, fs.constants.R_OK);
}

// Test 6: /gc executes cleanup and reports summary
{
  const ctx = createMockContext({userId: allowedUserId});
  const handled = await handleGcCommand(ctx);
  assert.equal(handled, true, '/gc must handle authorized command');
  assert.equal(ctx.replies.length, 1, '/gc must reply with 1 message');
  const reply = ctx.replies[0]!;
  assert.ok(reply.includes('Garbage collection finished.'));
  assert.ok(reply.includes('Removed version indexes:'));
  assert.ok(reply.includes('Removed orphaned assets:'));
  assert.ok(reply.includes('Freed:'));
  assert.ok(reply.includes('Remaining CAS assets:'));
  assert.ok(reply.includes('Duration:'));

  // Verify stale version indexes 1 and 2 are removed
  await assert.rejects(
    async () =>
      await fsp.access(
        generateStickerVersionIndexPath(gcTestPackName, 1),
        fs.constants.R_OK,
      ),
    'Version 1 index must be deleted',
  );
  await assert.rejects(
    async () =>
      await fsp.access(
        generateStickerVersionIndexPath(gcTestPackName, 2),
        fs.constants.R_OK,
      ),
    'Version 2 index must be deleted',
  );

  // Verify orphan asset is removed
  await assert.rejects(
    async () =>
      await fsp.access(
        path.join(gcTestAssetsDir, orphanAssetFilename),
        fs.constants.R_OK,
      ),
    'Orphan asset must be deleted',
  );
}

// Test 7: Referenced data survives after /gc
{
  for (let v = 3; v <= 7; v++) {
    const indexPath = generateStickerVersionIndexPath(gcTestPackName, v);
    await fsp.access(indexPath, fs.constants.R_OK);
    const assetPath = path.join(gcTestAssetsDir, testAssetFiles[`v${v}`]!);
    await fsp.access(assetPath, fs.constants.R_OK);
  }
}

// Test 8: Current manifest survives
{
  const manifestPath = generateStickerPackFilePath(gcTestPackName);
  await fsp.access(manifestPath, fs.constants.R_OK);
  const raw = await fsp.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.dynamic.version, 7, 'Manifest version must remain 7');
}

// Test 9: Retention = 5 policy verified exactly
{
  const versions = await listStickerPackVersions(gcTestPackName);
  assert.deepEqual(
    versions,
    [3, 4, 5, 6, 7],
    'Only the last 5 versions (3..7) must be retained',
  );
}

// Test 10: Shared CAS asset referenced by multiple versions survives
{
  const sharedPackName = 'GcSharedAssetPack';
  const sharedPackDir = generateStickerPackDirPath(sharedPackName);
  const sharedAssetsDir = generateStickerAssetsDirPath(sharedPackName);
  await fsp.mkdir(sharedAssetsDir, {recursive: true});

  const sharedSrc = path.join(sharedPackDir, 'shared.webp');
  await fsp.writeFile(sharedSrc, 'shared-cas-blob-content-12345');
  const sharedAssetFilename = await storeStickerAsset(
    sharedPackName,
    sharedSrc,
  );
  await fsp.unlink(sharedSrc).catch(() => undefined);

  // Write 7 versions: shared asset is used in version 1 (stale) AND version 7 (retained)
  for (let v = 1; v <= 7; v++) {
    await writeStickerVersionIndexAtomically(sharedPackName, {
      version: v,
      signature: `shared-v${v}`,
      stickers: {'sticker.webp': sharedAssetFilename},
      previews: {'sticker.webp': sharedAssetFilename},
    });
  }
  await writeStickerPackManifestAtomically(
    generateStickerPackFilePath(sharedPackName),
    {
      id: sharedPackName,
      title: 'Shared Asset Pack',
      animated: false,
      stickers: [
        {
          id: `${sharedPackName}:sticker`,
          filename: 'sticker.webp',
          emojis: ['⭐'],
          isAnimated: false,
          media: {
            type: 'static',
            canonicalPath: 'sticker.webp',
            previewPath: 'sticker.webp',
          },
        },
      ],
      dynamic: {
        version: 7,
        url: `https://example.com/stickerpack/telegram/${sharedPackName}`,
      },
    } as unknown as Parameters<typeof writeStickerPackManifestAtomically>[1],
  );

  // Run /gc
  const ctx = createMockContext({userId: allowedUserId});
  await handleGcCommand(ctx);

  // Stale version indexes 1 and 2 were removed
  assert.deepEqual(
    await listStickerPackVersions(sharedPackName),
    [3, 4, 5, 6, 7],
  );
  // BUT shared asset file MUST survive because it is referenced in retained versions 3..7
  const sharedPath = path.join(sharedAssetsDir, sharedAssetFilename);
  await fsp.access(sharedPath, fs.constants.R_OK);
}

// Test 11: Concurrent /gc, /gc_dry, and /gc_stats guard
{
  // Acquire mutation lock for a test pack to artificially hold GC in flight
  const barrierPackName = 'GcBarrierPack';
  await fsp.mkdir(generateStickerAssetsDirPath(barrierPackName), {
    recursive: true,
  });

  let releaseBarrier!: () => void;
  const barrierPromise = new Promise<void>(resolve => {
    releaseBarrier = resolve;
  });

  const backgroundGcPromise = withStickerStorageMutation(
    barrierPackName,
    async () => {
      await barrierPromise;
    },
  );

  // Start a GC in background that will queue on barrierPackName
  const firstGcCtx = createMockContext({userId: allowedUserId});
  const firstGcPromise = handleGcCommand(firstGcCtx);

  // Wait briefly for first GC to set running state
  let attempts = 0;
  while (!getGarbageCollectionStatus().running && attempts < 50) {
    await new Promise(r => setTimeout(r, 10));
    attempts++;
  }
  assert.equal(
    getGarbageCollectionStatus().running,
    true,
    'GC must be in running state while in flight',
  );

  // Concurrent /gc invocation must be rejected
  const concurrentGcCtx = createMockContext({userId: allowedUserId});
  const concurrentHandled = await handleGcCommand(concurrentGcCtx);
  assert.equal(
    concurrentHandled,
    false,
    'Concurrent /gc must be rejected while already running',
  );
  assert.ok(
    concurrentGcCtx.replies[0]?.includes(
      'Garbage collection is already running.',
    ),
    'Must report already running message to user',
  );

  // Concurrent /gc_dry invocation must also be rejected
  const concurrentDryCtx = createMockContext({userId: allowedUserId});
  const concurrentDryHandled = await handleGcDryCommand(concurrentDryCtx);
  assert.equal(
    concurrentDryHandled,
    false,
    'Concurrent /gc_dry must be rejected while already running',
  );
  assert.ok(
    concurrentDryCtx.replies[0]?.includes(
      'Garbage collection is already running.',
    ),
  );

  // Concurrent /gc_stats invocation must also be rejected
  const concurrentStatsCtx = createMockContext({userId: allowedUserId});
  const concurrentStatsHandled = await handleGcStatsCommand(concurrentStatsCtx);
  assert.equal(
    concurrentStatsHandled,
    false,
    'Concurrent /gc_stats must be rejected while already running',
  );
  assert.ok(
    concurrentStatsCtx.replies[0]?.includes(
      'Garbage collection is currently running.',
    ),
  );

  // Test 12: Background GC during active manual GC must also reject via shared guard
  await assert.rejects(
    garbageCollectStickerAssets(),
    (err: unknown) =>
      err !== null &&
      typeof err === 'object' &&
      'name' in err &&
      (err as {name: string}).name === 'GarbageCollectionRunningError',
    'garbageCollectStickerAssets must reject if GC is already running',
  );

  // Release barrier and wait for first GC to complete
  releaseBarrier();
  await backgroundGcPromise;
  await firstGcPromise;
  assert.equal(
    getGarbageCollectionStatus().running,
    false,
    'GC state must return to idle after completion',
  );
}

// Test 12 (follow-up): Background GC and manual /gc run normally when idle
{
  assert.equal(getGarbageCollectionStatus().running, false);
  const result = await garbageCollectStickerAssets();
  assert.equal(typeof result.versionsRemoved, 'number');
  assert.equal(typeof result.assetsRemoved, 'number');
  assert.equal(getGarbageCollectionStatus().running, false);
}
// Test 13: Publication safety vs GC
{
  const pubSafetyPackName = 'GcPubSafetyPack';
  const pubAssetsDir = generateStickerAssetsDirPath(pubSafetyPackName);
  await fsp.mkdir(pubAssetsDir, {recursive: true});

  let uncommittedAssetFilename = '';
  let releasePublication!: () => void;
  const pubBarrier = new Promise<void>(resolve => {
    releasePublication = resolve;
  });

  // Start an active publication holding the storage mutation lock
  const publicationPromise = withStickerStorageMutation(
    pubSafetyPackName,
    async () => {
      // Write new asset to disk before version index is published
      const rawPath = path.join(
        generateStickerPackDirPath(pubSafetyPackName),
        'new-uncommitted.webp',
      );
      await fsp.writeFile(rawPath, 'brand-new-publication-asset-data');
      uncommittedAssetFilename = await storeStickerAsset(
        pubSafetyPackName,
        rawPath,
      );
      await fsp.unlink(rawPath).catch(() => undefined);

      // Wait on barrier before publishing index
      await pubBarrier;

      // Commit version 1 index and manifest
      await writeStickerVersionIndexAtomically(pubSafetyPackName, {
        version: 1,
        signature: 'pub-v1',
        stickers: {'sticker.webp': uncommittedAssetFilename},
        previews: {'sticker.webp': uncommittedAssetFilename},
      });
      await writeStickerPackManifestAtomically(
        generateStickerPackFilePath(pubSafetyPackName),
        {
          id: pubSafetyPackName,
          title: 'Pub Safety Pack',
          animated: false,
          stickers: [
            {
              id: `${pubSafetyPackName}:sticker`,
              filename: 'sticker.webp',
              emojis: ['🔒'],
              isAnimated: false,
              media: {
                type: 'static',
                canonicalPath: 'sticker.webp',
                previewPath: 'sticker.webp',
              },
            },
          ],
          dynamic: {
            version: 1,
            url: `https://example.com/stickerpack/telegram/${pubSafetyPackName}`,
          },
        } as unknown as Parameters<
          typeof writeStickerPackManifestAtomically
        >[1],
      );
    },
  );

  // Concurrently run /gc
  const gcCtx = createMockContext({userId: allowedUserId});
  const gcPromise = handleGcCommand(gcCtx);

  // Verify GC started and is waiting on storage mutation lock
  let attempts = 0;
  while (!getGarbageCollectionStatus().running && attempts < 50) {
    await new Promise(r => setTimeout(r, 10));
    attempts++;
  }
  assert.equal(
    getGarbageCollectionStatus().running,
    true,
    'GC must be running and queued behind publication lock',
  );

  let gcSettled = false;
  void gcPromise.then(() => {
    gcSettled = true;
  });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(
    gcSettled,
    false,
    'GC must not complete while publication holds the lock',
  );

  // Release publication lock
  releasePublication();
  await publicationPromise;
  await gcPromise;
  assert.equal(
    gcSettled,
    true,
    'GC must complete after publication lock release',
  );
  // The newly published asset MUST survive and be verified
  const newAssetPath = path.join(pubAssetsDir, uncommittedAssetFilename);
  await fsp.access(newAssetPath, fs.constants.R_OK);
}
// Test 14: /status shows GC idle and running states
{
  const idleCtx = createMockContext({userId: allowedUserId});
  await handleStatusCommand(idleCtx);
  assert.ok(
    idleCtx.replies[0]?.includes('Garbage collection: idle'),
    '/status must show "Garbage collection: idle" when idle',
  );
}

// Test 15: State cleanup in finally after true outer exception
{
  assert.equal(getGarbageCollectionStatus().running, false);

  const originalReaddir = fsp.readdir;
  try {
    fsp.readdir = (async (targetPath: fs.PathLike, options?: unknown) => {
      if (String(targetPath) === DATA_DIR) {
        throw new Error('Simulated fatal storage failure');
      }
      return await (originalReaddir as Function)(targetPath, options);
    }) as typeof fsp.readdir;

    await assert.rejects(
      runGarbageCollection({mode: 'apply'}),
      /Simulated fatal storage failure/,
      'runGarbageCollection must propagate unhandled outer exceptions',
    );
  } finally {
    fsp.readdir = originalReaddir;
  }

  assert.equal(
    getGarbageCollectionStatus().running,
    false,
    'GC state must always be cleaned up in finally after unhandled exception',
  );

  // Verify next GC can start normally
  const nextCtx = createMockContext({userId: allowedUserId});
  const handled = await handleGcCommand(nextCtx);
  assert.equal(handled, true, 'Subsequent /gc must succeed after cleanup');
}

// Test 16: Regression test — failed stale index deletion stops orphan asset deletion
{
  const failedIndexPack = 'GcFailedIndexDeletePack';
  const failedIndexPackDir = generateStickerPackDirPath(failedIndexPack);
  const failedIndexAssetsDir = generateStickerAssetsDirPath(failedIndexPack);
  const failedIndexVersionsDir =
    generateStickerVersionsDirPath(failedIndexPack);
  await fsp.mkdir(failedIndexAssetsDir, {recursive: true});
  await fsp.mkdir(failedIndexVersionsDir, {recursive: true});

  // Asset unique to version 1 (would be orphan if v1 is deleted)
  const rawV1 = path.join(failedIndexPackDir, 'raw-v1.webp');
  await fsp.writeFile(rawV1, 'content-only-in-version-1-blob');
  const assetV1 = await storeStickerAsset(failedIndexPack, rawV1);
  await fsp.unlink(rawV1).catch(() => undefined);

  // Asset for versions 2..7 (retained)
  const rawV2 = path.join(failedIndexPackDir, 'raw-v2.webp');
  await fsp.writeFile(rawV2, 'content-in-retained-versions-blob');
  const assetV2 = await storeStickerAsset(failedIndexPack, rawV2);
  await fsp.unlink(rawV2).catch(() => undefined);

  // Write version indexes 1..7: v1 points to assetV1, v2..v7 point to assetV2
  await writeStickerVersionIndexAtomically(failedIndexPack, {
    version: 1,
    signature: 'sig-v1',
    stickers: {'sticker.webp': assetV1},
    previews: {'sticker.webp': assetV1},
  });
  for (let v = 2; v <= 7; v++) {
    await writeStickerVersionIndexAtomically(failedIndexPack, {
      version: v,
      signature: `sig-v${v}`,
      stickers: {'sticker.webp': assetV2},
      previews: {'sticker.webp': assetV2},
    });
  }

  // Write manifest for version 7
  await writeStickerPackManifestAtomically(
    generateStickerPackFilePath(failedIndexPack),
    {
      id: failedIndexPack,
      title: 'Failed Index Delete Pack',
      animated: false,
      stickers: [
        {
          id: `${failedIndexPack}:sticker`,
          filename: 'sticker.webp',
          emojis: ['🛡️'],
          isAnimated: false,
          media: {
            type: 'static',
            canonicalPath: 'sticker.webp',
            previewPath: 'sticker.webp',
          },
        },
      ],
      dynamic: {
        version: 7,
        url: `https://example.com/stickerpack/telegram/${failedIndexPack}`,
      },
    } as unknown as Parameters<typeof writeStickerPackManifestAtomically>[1],
  );

  const v1IndexPath = generateStickerVersionIndexPath(failedIndexPack, 1);
  const originalRm = fsp.rm;

  try {
    // Simulate deletion failure specifically for 1.json
    fsp.rm = (async (targetPath: fs.PathLike, options?: unknown) => {
      if (path.resolve(String(targetPath)) === path.resolve(v1IndexPath)) {
        throw new Error('Simulated EPERM on stale version index deletion');
      }
      return await (originalRm as Function)(targetPath, options);
    }) as typeof fsp.rm;

    const ctx = createMockContext({userId: allowedUserId});
    const handled = await handleGcCommand(ctx);
    assert.equal(handled, true, '/gc must handle command with errors reported');
    assert.ok(
      ctx.replies[0]?.includes('Errors:'),
      'Report must include Errors count when index deletion fails',
    );

    // Stale version index 1 was NOT deleted (failed)
    await fsp.access(v1IndexPath, fs.constants.R_OK);

    // CRITICAL: Asset V1 MUST NOT BE DELETED because its index was not removed!
    const assetV1Path = path.join(failedIndexAssetsDir, assetV1);
    await fsp.access(assetV1Path, fs.constants.R_OK);
  } finally {
    fsp.rm = originalRm;
  }
}

// Test 17: Corrupt pack analysis errors are reported in /gc, /gc_dry, and /gc_stats
{
  const corruptPackName = 'GcCorruptAnalysisPack';
  const corruptAssetsDir = generateStickerAssetsDirPath(corruptPackName);
  await fsp.mkdir(corruptAssetsDir, {recursive: true});

  // Write a corrupt manifest JSON
  await fsp.writeFile(
    generateStickerPackFilePath(corruptPackName),
    'invalid json content',
  );

  const ctxGc = createMockContext({userId: allowedUserId});
  await handleGcCommand(ctxGc);
  assert.ok(
    ctxGc.replies[0]?.includes('Errors:'),
    '/gc must report Errors when corrupt packs are skipped during analysis',
  );

  const ctxDry = createMockContext({userId: allowedUserId});
  await handleGcDryCommand(ctxDry);
  assert.ok(
    ctxDry.replies[0]?.includes('Errors:'),
    '/gc_dry must report Errors when corrupt packs are skipped during analysis',
  );

  const ctxStats = createMockContext({userId: allowedUserId});
  await handleGcStatsCommand(ctxStats);
  assert.ok(
    ctxStats.replies[0]?.includes('Errors:'),
    '/gc_stats must report Errors when corrupt packs are skipped during analysis',
  );
}

// Test 18: Regression test — /gc_stats and /gc_dry are strict read-only and do not create DATA_DIR
{
  const backupDataDir = `${DATA_DIR}.gc-readonly-backup-${Date.now()}`;
  await fsp.rename(DATA_DIR, backupDataDir);
  try {
    // Verify DATA_DIR does not exist
    await assert.rejects(fsp.access(DATA_DIR, fs.constants.R_OK));

    // 1. /gc_stats must not create DATA_DIR
    const statsCtx = createMockContext({userId: allowedUserId});
    const statsHandled = await handleGcStatsCommand(statsCtx);
    assert.equal(statsHandled, true);
    assert.ok(statsCtx.replies[0]?.includes('Sticker packs: 0'));
    await assert.rejects(
      fsp.access(DATA_DIR, fs.constants.R_OK),
      '/gc_stats must not create DATA_DIR',
    );

    // 2. /gc_dry must not create DATA_DIR
    const dryCtx = createMockContext({userId: allowedUserId});
    const dryHandled = await handleGcDryCommand(dryCtx);
    assert.equal(dryHandled, true);
    assert.ok(dryCtx.replies[0]?.includes('Would remove version indexes: 0'));
    await assert.rejects(
      fsp.access(DATA_DIR, fs.constants.R_OK),
      '/gc_dry must not create DATA_DIR',
    );
  } finally {
    await fsp
      .rm(DATA_DIR, {recursive: true, force: true})
      .catch(() => undefined);
    await fsp.rename(backupDataDir, DATA_DIR);
  }
}

console.log(
  'Testing P2: /status command diagnostics, tool probes, counters, storage scan, and lifecycles...',
);

// Test Section 1: formatTimeAgo helper
{
  const now = Date.now();
  assert.equal(formatTimeAgo(undefined), 'never');
  assert.equal(formatTimeAgo(0), 'never');
  assert.equal(formatTimeAgo(now - 10_000, now), '10s ago');
  assert.equal(formatTimeAgo(now - 180_000, now), '3m ago');
  assert.equal(formatTimeAgo(now - 7_200_000, now), '2h ago');
  assert.equal(formatTimeAgo(now - 7_320_000, now), '2h 2m ago');
  assert.equal(formatTimeAgo(now - 90_000_000, now), '1d 1h ago');
}

// Test Section 2: Tool Diagnostics (FFmpeg & lottieconverter probes and caching)
{
  resetToolDiagnosticsCacheForTests();
  // 1. Real FFmpeg probe
  const ffmpegRes = await probeFfmpeg();
  assert.ok(typeof ffmpegRes.available === 'boolean');
  if (ffmpegRes.available) {
    assert.ok(
      typeof ffmpegRes.version === 'string' && ffmpegRes.version.length > 0,
    );
  }

  // 2. Real lottieconverter probe
  const lottieRes = await probeLottieConverter();
  assert.ok(typeof lottieRes === 'boolean');

  // 3. Tool diagnostics cache TTL
  const toolDiag1 = await getToolDiagnostics();
  assert.equal(toolDiag1.nodeVersion, process.version);
  const toolDiag2 = await getToolDiagnostics();
  assert.equal(
    toolDiag1.checkedAt,
    toolDiag2.checkedAt,
    'getToolDiagnostics must return cached result within TTL',
  );

  // 4. Mock FFmpeg unavailable
  resetToolDiagnosticsCacheForTests();
  const mockToolDiagFfmpegUnavailable = await getToolDiagnostics(true, {
    probeFfmpeg: async () => ({available: false, version: undefined}),
    probeLottieConverter: async () => true,
  });
  assert.equal(mockToolDiagFfmpegUnavailable.ffmpegAvailable, false);
  assert.equal(mockToolDiagFfmpegUnavailable.ffmpegVersion, undefined);
  assert.equal(mockToolDiagFfmpegUnavailable.lottieConverterAvailable, true);

  // 5. Mock lottieconverter unavailable
  resetToolDiagnosticsCacheForTests();
  const mockToolDiagLottieUnavailable = await getToolDiagnostics(true, {
    probeFfmpeg: async () => ({available: true, version: '8.1.2'}),
    probeLottieConverter: async () => false,
  });
  assert.equal(mockToolDiagLottieUnavailable.ffmpegAvailable, true);
  assert.equal(mockToolDiagLottieUnavailable.ffmpegVersion, '8.1.2');
  assert.equal(mockToolDiagLottieUnavailable.lottieConverterAvailable, false);

  resetToolDiagnosticsCacheForTests();
}

// Test Section 3: Work Counters (Active downloads, active encodes, queue length, retries, error handling)
{
  resetWorkCountersForTests();
  assert.equal(getActiveDownloads(), 0);
  assert.equal(getActiveEncodes(), 0);
  assert.equal(getQueueLength(), 0);

  // 1. Active download counter (success)
  let inDownload = false;
  await withActiveDownload(async () => {
    inDownload = true;
    assert.equal(getActiveDownloads(), 1);
  });
  assert.equal(inDownload, true);
  assert.equal(getActiveDownloads(), 0);

  // 2. Active download counter (failure)
  await assert.rejects(async () => {
    await withActiveDownload(async () => {
      assert.equal(getActiveDownloads(), 1);
      throw new Error('download failed');
    });
  }, /download failed/);
  assert.equal(getActiveDownloads(), 0);

  // 3. Active encode counter (success)
  let inEncode = false;
  await withActiveEncode(async () => {
    inEncode = true;
    assert.equal(getActiveEncodes(), 1);
  });
  assert.equal(inEncode, true);
  assert.equal(getActiveEncodes(), 0);

  // 4. Active encode counter (failure)
  await assert.rejects(async () => {
    await withActiveEncode(async () => {
      assert.equal(getActiveEncodes(), 1);
      throw new Error('encode failed');
    });
  }, /encode failed/);
  assert.equal(getActiveEncodes(), 0);

  // 5. Logical encode retries / nesting (AsyncLocalStorage prevents double-increment)
  await withActiveEncode(async () => {
    assert.equal(getActiveEncodes(), 1);
    await withActiveEncode(async () => {
      assert.equal(
        getActiveEncodes(),
        1,
        'Nested encode retry must not double-increment counter',
      );
    });
    assert.equal(getActiveEncodes(), 1);
  });
  assert.equal(getActiveEncodes(), 0);

  // 6. Queue length tracking & cleanup
  const dummyQueue1 = [1, 2, 3, 4, 5];
  const dummyQueue2 = ['a', 'b'];
  const unreg1 = registerDownloadQueue(dummyQueue1);
  assert.equal(getQueueLength(), 5);
  const unreg2 = registerDownloadQueue(dummyQueue2);
  assert.equal(getQueueLength(), 7);

  // Shift items (simulating worker picking up items)
  dummyQueue1.shift();
  dummyQueue1.shift();
  assert.equal(getQueueLength(), 5);

  unreg1();
  assert.equal(getQueueLength(), 2);
  unreg2();
  assert.equal(getQueueLength(), 0);

  resetWorkCountersForTests();
}

// Test Section 4: Storage Diagnostics (calculateStorageSizeBytes, countLegacyGifPacks, caching, absent dir, fail-soft)
{
  const diagTestDir = await fsp.mkdtemp(
    path.join(tempDir, 'status-storage-test-'),
  );
  resetStorageDiagnosticsCacheForTests();

  // 1. Storage size calculation on known files
  const file1 = path.join(diagTestDir, 'file1.bin');
  const file2 = path.join(diagTestDir, 'sub', 'file2.bin');
  await fsp.mkdir(path.dirname(file2), {recursive: true});
  await fsp.writeFile(file1, Buffer.alloc(1000));
  await fsp.writeFile(file2, Buffer.alloc(2500));

  const totalBytes = await calculateStorageSizeBytes(diagTestDir);
  assert.equal(totalBytes, 3500);

  // 2. Legacy GIF pack count:
  // Pack A: retained index with .gif
  const packADir = path.join(diagTestDir, 'PackA');
  await fsp.mkdir(path.join(packADir, 'versions'), {recursive: true});
  await fsp.mkdir(path.join(packADir, 'assets'), {recursive: true});
  const packAManifest = {
    id: 'MoreStickers:Telegram:Pack:PackA',
    title: 'Pack A',
    name: 'PackA',
    dynamic: {version: 1},
    stickers: [
      {
        id: 'MoreStickers:Telegram:Sticker:PackA:1',
        filename: '1.gif',
        previewFilename: '1.webp',
      },
    ],
  };
  await fsp.writeFile(
    path.join(diagTestDir, 'PackA.telegram.stickerpack'),
    JSON.stringify(packAManifest),
  );
  const packAIndex1 = {
    version: 1,
    signature: 'sig1',
    stickers: {
      '1.gif':
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.gif',
    },
    previews: {
      '1.webp':
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
    },
  };
  await fsp.writeFile(
    path.join(packADir, 'versions', '1.json'),
    JSON.stringify(packAIndex1),
  );

  // Pack B: retained index with .avif only
  const packBDir = path.join(diagTestDir, 'PackB');
  await fsp.mkdir(path.join(packBDir, 'versions'), {recursive: true});
  const packBManifest = {
    id: 'MoreStickers:Telegram:Pack:PackB',
    title: 'Pack B',
    name: 'PackB',
    dynamic: {version: 1},
    stickers: [
      {
        id: 'MoreStickers:Telegram:Sticker:PackB:1',
        filename: '1.avif',
        previewFilename: '1.webp',
      },
    ],
  };
  await fsp.writeFile(
    path.join(diagTestDir, 'PackB.telegram.stickerpack'),
    JSON.stringify(packBManifest),
  );
  const packBIndex1 = {
    version: 1,
    signature: 'sigB1',
    stickers: {
      '1.avif':
        '1111456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.avif',
    },
    previews: {
      '1.webp':
        '22220123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
    },
  };
  await fsp.writeFile(
    path.join(packBDir, 'versions', '1.json'),
    JSON.stringify(packBIndex1),
  );

  // Pack C: v1 GIF (retained), v2 AVIF (current retained)
  const packCDir = path.join(diagTestDir, 'PackC');
  await fsp.mkdir(path.join(packCDir, 'versions'), {recursive: true});
  const packCManifest = {
    id: 'MoreStickers:Telegram:Pack:PackC',
    title: 'Pack C',
    name: 'PackC',
    dynamic: {version: 2},
    stickers: [
      {
        id: 'MoreStickers:Telegram:Sticker:PackC:1',
        filename: '1.avif',
        previewFilename: '1.webp',
      },
    ],
  };
  await fsp.writeFile(
    path.join(diagTestDir, 'PackC.telegram.stickerpack'),
    JSON.stringify(packCManifest),
  );
  const packCIndex1 = {
    version: 1,
    signature: 'sigC1',
    stickers: {
      '1.gif':
        '3333456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.gif',
    },
    previews: {
      '1.webp':
        '44440123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
    },
  };
  const packCIndex2 = {
    version: 2,
    signature: 'sigC2',
    stickers: {
      '1.avif':
        '5555456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.avif',
    },
    previews: {
      '1.webp':
        '66660123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
    },
  };
  await fsp.writeFile(
    path.join(packCDir, 'versions', '1.json'),
    JSON.stringify(packCIndex1),
  );
  await fsp.writeFile(
    path.join(packCDir, 'versions', '2.json'),
    JSON.stringify(packCIndex2),
  );

  const legacyPacksRes = await countLegacyGifPacks(diagTestDir);
  assert.equal(
    legacyPacksRes.count,
    2,
    'PackA and PackC have legacy GIF; PackB has AVIF only',
  );
  assert.equal(legacyPacksRes.warnings, 0);

  // 3. Stale version (outside retention last 5) with GIF is NOT counted
  const packDDir = path.join(diagTestDir, 'PackD');
  await fsp.mkdir(path.join(packDDir, 'versions'), {recursive: true});
  const packDManifest = {
    id: 'MoreStickers:Telegram:Pack:PackD',
    title: 'Pack D',
    name: 'PackD',
    dynamic: {version: 6},
    stickers: [
      {
        id: 'MoreStickers:Telegram:Sticker:PackD:1',
        filename: '1.avif',
        previewFilename: '1.webp',
      },
    ],
  };
  await fsp.writeFile(
    path.join(diagTestDir, 'PackD.telegram.stickerpack'),
    JSON.stringify(packDManifest),
  );
  // Version 1 (stale, outside retention last 5 of version 6, retained: 2,3,4,5,6)
  await fsp.writeFile(
    path.join(packDDir, 'versions', '1.json'),
    JSON.stringify({
      version: 1,
      signature: 'sigD1',
      stickers: {
        '1.gif':
          '0000456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.gif',
      },
      previews: {
        '1.webp':
          '00000123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
      },
    }),
  );
  for (let v = 2; v <= 6; v++) {
    await fsp.writeFile(
      path.join(packDDir, 'versions', `${v}.json`),
      JSON.stringify({
        version: v,
        signature: `sigD${v}`,
        stickers: {
          '1.avif':
            '1111456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.avif',
        },
        previews: {
          '1.webp':
            '22220123456789abcdef0123456789abcdef0123456789abcdef0123456789.webp',
        },
      }),
    );
  }
  const legacyPacksResD = await countLegacyGifPacks(diagTestDir);
  assert.equal(
    legacyPacksResD.count,
    2,
    'PackD must not be counted because its GIF is in stale version 1 outside retention',
  );

  // 4. Corrupted index file handled fail-soft without crashing
  const packEDir = path.join(diagTestDir, 'PackE');
  await fsp.mkdir(path.join(packEDir, 'versions'), {recursive: true});
  await fsp.writeFile(
    path.join(packEDir, 'versions', '1.json'),
    'corrupted json content',
  );
  const legacyPacksResE = await countLegacyGifPacks(diagTestDir);
  assert.ok(
    legacyPacksResE.warnings >= 1,
    'Corrupted index must record a warning',
  );
  assert.equal(
    legacyPacksResE.count,
    2,
    'Scan must continue successfully despite corrupted index',
  );

  // 5. getStorageDiagnostics caching and warning policy (Policy A: warnings => legacyGifPackCount: undefined)
  resetStorageDiagnosticsCacheForTests();
  const sDiag1 = await getStorageDiagnostics(false, diagTestDir);
  assert.ok(sDiag1.sizeBytes !== undefined && sDiag1.sizeBytes > 0);
  assert.equal(
    sDiag1.legacyGifPackCount,
    undefined,
    'Corrupted index with warnings must yield legacyGifPackCount: undefined in getStorageDiagnostics',
  );
  assert.ok(
    sDiag1.warnings !== undefined && sDiag1.warnings >= 1,
    'Storage diagnostics must record warnings count',
  );
  const sDiag2 = await getStorageDiagnostics(false, diagTestDir);
  assert.equal(
    sDiag1.checkedAt,
    sDiag2.checkedAt,
    'getStorageDiagnostics must use cache within TTL',
  );

  // 6. calculateStorageSizeBytes non-ENOENT error propagation
  // If an unreadable directory or file error occurs (not ENOENT), calculateStorageSizeBytes must throw,
  // causing getStorageDiagnostics to set sizeBytes: undefined (fail-soft -> unavailable)
  const unreadableTestDir = await fsp.mkdtemp(
    path.join(tempDir, 'status-unreadable-test-'),
  );
  const dummyFile = path.join(unreadableTestDir, 'dummy.bin');
  await fsp.writeFile(dummyFile, Buffer.alloc(100));
  // Mock fsp.stat temporarily to throw EACCES on dummyFile to simulate unreadable file
  const originalStat = fsp.stat;
  try {
    (fsp as unknown as {stat: typeof fsp.stat}).stat = (async (
      p: fs.PathLike,
      opts?: fs.StatOptions,
    ) => {
      if (String(p).includes('dummy.bin')) {
        const err = new Error('Permission denied') as Error & {code: string};
        err.code = 'EACCES';
        throw err;
      }
      return await originalStat(p, opts as undefined);
    }) as typeof fsp.stat;

    await assert.rejects(
      async () => {
        await calculateStorageSizeBytes(unreadableTestDir);
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          'code' in err &&
          (err as {code: string}).code === 'EACCES'
        );
      },
      'calculateStorageSizeBytes must rethrow non-ENOENT errors like EACCES',
    );

    const unreadableDiag = await getStorageDiagnostics(true, unreadableTestDir);
    assert.equal(
      unreadableDiag.sizeBytes,
      undefined,
      'Storage size must be undefined when non-ENOENT error occurs during scan',
    );
  } finally {
    (fsp as unknown as {stat: typeof fsp.stat}).stat = originalStat;
    await fsp.rm(unreadableTestDir, {recursive: true, force: true});
  }

  // 7. Absent DATA_DIR: returns 0 B, 0 packs, does NOT create directory
  const nonExistentDir = path.join(
    tempDir,
    `non-existent-data-dir-${Date.now()}`,
  );
  const sDiagAbsent = await getStorageDiagnostics(true, nonExistentDir);
  assert.equal(sDiagAbsent.sizeBytes, 0);
  assert.equal(sDiagAbsent.legacyGifPackCount, 0);
  assert.equal(
    fs.existsSync(nonExistentDir),
    false,
    'getStorageDiagnostics must not create nonExistentDir',
  );

  await fsp.rm(diagTestDir, {recursive: true, force: true});
}

// Test Section 5: /status formatting, snapshots, and lifecycle integration
{
  resetLastRefreshAllForTests();
  resetLastGarbageCollectionForTests();
  resetToolDiagnosticsCacheForTests();
  resetStorageDiagnosticsCacheForTests();

  // 1. Initial idle status with no previous runs
  const snapshot1 = await getConverterStatusSnapshot({forceRefresh: true});
  const formatted1 = formatStatusResponse(snapshot1, formatUptime);
  assert.ok(formatted1.includes('MoreStickersConverter status'));
  assert.ok(formatted1.includes('Node.js: ' + process.version));
  assert.ok(formatted1.includes('FFmpeg:'));
  assert.ok(formatted1.includes('lottieconverter:'));
  assert.ok(formatted1.includes('Active downloads: 0'));
  assert.ok(formatted1.includes('Active encodes: 0'));
  assert.ok(formatted1.includes('Queue length: 0'));
  assert.ok(formatted1.includes('Storage size:'));
  assert.ok(formatted1.includes('Legacy GIF packs:'));
  assert.ok(formatted1.includes('Refresh all: idle'));
  assert.ok(formatted1.includes('Last run: never'));
  assert.ok(formatted1.includes('Garbage collection: idle'));
  // 2. Last GC integration (manual and background)
  const gcResult = await runGarbageCollection({mode: 'apply'});
  const lastGc = getLastGarbageCollection();
  assert.ok(lastGc !== undefined);
  assert.equal(lastGc.mode, 'apply');
  assert.equal(
    lastGc.outcome,
    gcResult.errors && gcResult.errors > 0
      ? 'completed-with-errors'
      : 'success',
  );
  assert.equal(lastGc.errors, gcResult.errors ?? 0);
  assert.equal(lastGc.bytesFreed, gcResult.bytesFreed);

  const snapshotWithGc = await getConverterStatusSnapshot({forceRefresh: true});
  const formattedWithGc = formatStatusResponse(snapshotWithGc, formatUptime);
  assert.ok(formattedWithGc.includes('Mode: apply'));
  assert.ok(
    formattedWithGc.includes(
      `Result: ${lastGc.outcome} with ${lastGc.errors} error`,
    ),
  );
  // 3. Last /refresh_all lifecycle tracking
  assert.equal(getLastRefreshAll(), undefined);
  const ctxEmptyRefresh = createMockContext({
    userId: allowedUserId,
    telegram: mockTelegram as unknown as Telegram,
  });
  await handleRefreshAllCommand(ctxEmptyRefresh);
  const lastRefresh = getLastRefreshAll();
  assert.ok(lastRefresh !== undefined);
  assert.equal(lastRefresh.outcome, 'completed');
  const localPacksCount = (await listLocalStickerPackNames()).length;
  assert.equal(lastRefresh.total, localPacksCount);
  assert.equal(lastRefresh.refreshed + lastRefresh.failed, localPacksCount);
  assert.equal(lastRefresh.skipped, 0);
  // 3. Partial diagnostics failure resilience
  const degradedSnapshot = {
    runtime: {
      status: 'DEGRADED' as const,
      uptimeSeconds: 120,
      nodeVersion: process.version,
      ffmpegVersion: undefined,
      ffmpegAvailable: false,
      lottieConverterAvailable: false,
      concurrency: 5,
      dataDirOk: false,
      externalUrlConfigured: true,
    },
    work: {
      activeDownloads: 2,
      activeEncodes: 1,
      queueLength: 4,
    },
    storage: {
      sizeBytes: undefined,
      legacyGifPackCount: undefined,
      warnings: 2,
    },
    refreshAll: {
      current: {
        running: false,
        cancelRequested: false,
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
      },
      last: {
        startedAt: Date.now() - 60_000,
        finishedAt: Date.now() - 30_000,
        durationMs: 30_000,
        total: 10,
        refreshed: 8,
        failed: 2,
        skipped: 0,
        outcome: 'completed' as const,
      },
    },
    garbageCollection: {
      current: {
        running: false,
      },
      last: {
        mode: 'apply' as const,
        startedAt: Date.now() - 120_000,
        finishedAt: Date.now() - 110_000,
        durationMs: 10_000,
        errors: 0,
        bytesFreed: 1024 * 1024,
        outcome: 'success' as const,
      },
    },
  };
  const degradedFormatted = formatStatusResponse(
    degradedSnapshot,
    formatUptime,
  );
  assert.ok(degradedFormatted.includes('Status: DEGRADED'));
  assert.ok(degradedFormatted.includes('FFmpeg: unavailable'));
  assert.ok(degradedFormatted.includes('lottieconverter: unavailable'));
  assert.ok(degradedFormatted.includes('Active downloads: 2'));
  assert.ok(degradedFormatted.includes('Active encodes: 1'));
  assert.ok(degradedFormatted.includes('Queue length: 4'));
  assert.ok(degradedFormatted.includes('Storage size: unavailable'));
  assert.ok(degradedFormatted.includes('Legacy GIF packs: unavailable'));
  assert.ok(degradedFormatted.includes('Result: 8 refreshed, 2 failed'));
  assert.ok(degradedFormatted.includes('Freed: 1 MiB'));
}
console.log(
  'Verified: P2 /status diagnostics, probes, work counters, and storage tests pass',
);
console.log('Verified: All new Telegram bot commands passed all tests');
await fsp.rm(tempDir, {recursive: true, force: true});
console.log('--- All Smoke Tests Passed Successfully! ---');
