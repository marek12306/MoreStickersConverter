import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Setup environment before importing app modules
const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'morestickers-test-'));
process.env.DATA_DIR = tempDir;
process.env.CONCURRENCY = '2';
process.env.EXTERNAL_URL = 'https://stickers.example.com';
process.env.BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
process.env.PORT = '3000';

import type {GifEncoder} from '../src/utils/webmToGif.js';
const {
  convertWebmToGif,
  convertWebmToGifWithEncoder,
  GIF_TARGET_BYTES,
  GIF_SAFE_HARD_LIMIT_BYTES,
} = await import('../src/utils/webmToGif.js');
const {
  isLegacyStickerPack,
  isStickerPackDownloaded,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
  getStickerMediaInfo,
  fetchStickerWithRetry,
} = await import('../src/utils/telegramStickers.js');
const {app} = await import('../src/utils/fastify.js');

console.log('--- Starting Smoke Tests in Nix Environment ---');

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
assert.equal(infoD.outputFileType, 'tgs', 'Case D: outputFileType must be tgs');
assert.equal(infoD.isAnimated, true, 'Case D: isAnimated must be true for tgs');

console.log(
  'Verified: getStickerMediaInfo handles video, fallback webm, static webp, and tgs correctly',
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

// Verify Pixel (150,150) is Opaque Red (alpha = 255)
const opaquePixelResult = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-i',
  testGifPath,
  '-vf',
  'select=eq(n\\,0),format=rgba,crop=1:1:150:150',
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
  'FFmpeg pixel extraction failed at (150,150)',
);
assert.equal(opaquePixelResult.stdout.length, 4, 'Expected 4 bytes RGBA');
assert.equal(
  opaquePixelResult.stdout[3],
  255,
  `Expected alpha = 255 at opaque center (150,150), got ${opaquePixelResult.stdout[3]}`,
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
  },
  stickers: [
    {
      id: `MoreStickers:Telegram:Sticker:${modernPackName}:sticker1`,
      image: `https://stickers.example.com/sticker/telegram/${modernPackName}/sticker1.gif`,
      title: '😀',
      stickerPackId: `MoreStickers:Telegram:Pack:${modernPackName}`,
      filename: 'sticker1.gif',
      isAnimated: true,
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

// Test 7: Fastify endpoint with GIF and MIME types
console.log('Testing Fastify endpoint for .gif...');
const packName = 'TestPackHttp';
const packDir = generateStickerPackDirPath(packName);
await fsp.mkdir(packDir, {recursive: true});

const sampleGifDest = path.join(packDir, 'test_sticker.gif');
await fsp.copyFile(testGifPath, sampleGifDest);

const gifResponse = await app.inject({
  method: 'GET',
  url: `/sticker/telegram/${packName}/test_sticker.gif`,
});

assert.equal(
  gifResponse.statusCode,
  200,
  `Expected 200 for .gif, got ${gifResponse.statusCode}`,
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
console.log('Verified: Fastify correctly serves .gif with image/gif');

// Test 8: Fastify invalid extension real request & assertion
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
console.log('Verified: Fastify rejects invalid extension with 400');

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
// Clean up temp dir
await fsp.rm(tempDir, {recursive: true, force: true});

console.log('--- All Smoke Tests Passed Successfully! ---');
