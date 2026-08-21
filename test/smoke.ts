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
process.env.PORT = '3000';

import type {GifEncoder} from '../src/utils/webmToGif.js';
import type {Telegram} from 'telegraf';
const {
  convertWebmToGif,
  convertWebmToGifWithEncoder,
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
  isLegacyStickerPack,
  isStickerPackDownloaded,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
  getStickerMediaInfo,
  fetchStickerWithRetry,
  toMcStickerPack,
} = await import('../src/utils/telegramStickers.js');
const {app} = await import('../src/utils/fastify.js');

console.log('--- Starting Smoke Tests in Nix Environment ---');

const profile160 = GIF_ENCODING_PROFILES.find(
  profile => profile.maxDimension === 160,
);
assert.deepEqual(profile160, {
  maxDimension: 160,
  fps: 10,
  maxColors: 64,
  bayerScale: 4,
});
assert.equal(
  TGS_GIF_ENCODING_PROFILES.length,
  GIF_ENCODING_PROFILES.length,
  'TGS and WebM GIF profile lists must have matching lengths',
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
      emoji: '🎉',
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

for (const sticker of [manifestWebm, manifestTgs]) {
  assert.ok(sticker.filename?.endsWith('.gif'));
  assert.ok(sticker.image.endsWith('.gif'));
  assert.equal(sticker.isAnimated, true);
  assert.equal(sticker.readyToUpload, true);
}
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
console.log('Verified: Telegram manifests expose final GIFs and static WebP');

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
        [normalizedInputPath, normOutPath, 'gif', '384x384', String(fps)],
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
// Clean up temp dir
await fsp.rm(tempDir, {recursive: true, force: true});

console.log('--- All Smoke Tests Passed Successfully! ---');
