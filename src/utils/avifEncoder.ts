import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  AVIF_HARD_LIMIT_BYTES,
  AVIF_MAX_DURATION_SECONDS,
  type AvifEncodingProfile,
} from './avifConversion.js';
import {runMediaProcess} from './mediaProcess.js';

export type AvifFilterBranch = 'color' | 'alpha';

export interface AvifInput {
  args: readonly string[];
  description: string;
}

interface ProbeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  nb_read_frames?: string;
  duration?: string;
}

interface ProbeDocument {
  streams?: ProbeStream[];
  format?: {
    format_name?: string;
    tags?: {major_brand?: string; compatible_brands?: string};
  };
}

export interface AnimatedAvifProbe {
  colorStreamIndex: number;
  alphaStreamIndex: number;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  colorPixelFormat: string;
  alphaPixelFormat: string;
  sizeBytes: number;
}

function parsePositiveNumber(value: string | number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [numerator, denominator] = value.split('/').map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return 0;
  }
  return numerator / denominator;
}

function getFrameCount(stream: ProbeStream): number {
  return parsePositiveNumber(stream.nb_read_frames ?? stream.nb_frames);
}

function getFrameRate(stream: ProbeStream): number {
  return (
    parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate)
  );
}

function getDuration(
  stream: ProbeStream,
  frameCount: number,
  fps: number,
): number {
  return parsePositiveNumber(stream.duration) || frameCount / fps;
}

export function buildAvifFilter(
  profile: AvifEncodingProfile,
  branch: AvifFilterBranch,
): string {
  const timed = [
    `trim=duration=${AVIF_MAX_DURATION_SECONDS}`,
    'setpts=PTS-STARTPTS',
    `fps=${profile.fps}`,
  ].join(',');
  const scale = `scale=w='min(${profile.maxDimension},iw)':h='min(${profile.maxDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
  return branch === 'color'
    ? `${timed},format=rgba,premultiply=inplace=1,${scale},unpremultiply=inplace=1,format=yuv420p10le`
    : `${timed},${scale},format=rgba,alphaextract,format=gray10le,geq=lum='if(gte(lum(X,Y),1016),1023,round(lum(X,Y)*1023/1020))'`;
}

function commonEncoderArgs(profile: AvifEncodingProfile): string[] {
  return [
    '-c:v',
    'libaom-av1',
    '-b:v',
    '0',
    '-cpu-used',
    String(profile.cpuUsed),
    '-usage',
    'good',
    '-tune',
    'ssim',
    '-threads',
    '1',
    '-row-mt',
    '0',
    '-tiles',
    '1x1',
  ];
}

export function buildColorFfmpegArgs(
  inputArgs: readonly string[],
  outputPath: string,
  profile: AvifEncodingProfile,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-filter_threads',
    '1',
    ...inputArgs,
    '-vf',
    buildAvifFilter(profile, 'color'),
    '-an',
    ...commonEncoderArgs(profile),
    '-crf',
    String(profile.crf),
    '-f',
    'ivf',
    '-y',
    outputPath,
  ];
}

export function buildAlphaFfmpegArgs(
  inputArgs: readonly string[],
  outputPath: string,
  profile: AvifEncodingProfile,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-filter_threads',
    '1',
    ...inputArgs,
    '-vf',
    buildAvifFilter(profile, 'alpha'),
    '-an',
    ...commonEncoderArgs(profile),
    '-crf',
    '0',
    '-aq-mode',
    '0',
    '-enable-restoration',
    '0',
    '-aom-params',
    'lossless=1',
    '-f',
    'ivf',
    '-y',
    outputPath,
  ];
}

export function buildAvifMuxArgs(
  colorPath: string,
  alphaPath: string,
  outputPath: string,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    '1',
    '-i',
    colorPath,
    '-i',
    alphaPath,
    '-map',
    '0:v:0',
    '-map',
    '1:v:0',
    '-c',
    'copy',
    '-loop',
    '0',
    '-f',
    'avif',
    '-y',
    outputPath,
  ];
}

export async function encodeAnimatedAvif(
  input: AvifInput,
  outputPath: string,
  profile: AvifEncodingProfile,
): Promise<void> {
  const conversionId = randomUUID();
  const outputDir = path.dirname(outputPath);
  const colorPath = path.join(outputDir, `.avif-color-${conversionId}.ivf`);
  const alphaPath = path.join(outputDir, `.avif-alpha-${conversionId}.ivf`);

  try {
    await runMediaProcess(
      'ffmpeg',
      buildColorFfmpegArgs(input.args, colorPath, profile),
      `${input.description} color encode (profile: ${JSON.stringify(profile)})`,
    );
    await runMediaProcess(
      'ffmpeg',
      buildAlphaFfmpegArgs(input.args, alphaPath, profile),
      `${input.description} alpha encode (profile: ${JSON.stringify(profile)})`,
    );
    await runMediaProcess(
      'ffmpeg',
      buildAvifMuxArgs(colorPath, alphaPath, outputPath),
      `${input.description} AVIF mux`,
    );
  } finally {
    await Promise.all([
      fsp.unlink(colorPath).catch(() => undefined),
      fsp.unlink(alphaPath).catch(() => undefined),
    ]);
  }
}

interface AnimatedAvifInspection {
  probe: AnimatedAvifProbe;
  alphaWidth: number;
  alphaHeight: number;
  alphaFrameCount: number;
  alphaFps: number;
}

async function inspectAnimatedAvif(
  outputPath: string,
): Promise<AnimatedAvifInspection> {
  const {stdout} = await runMediaProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-threads',
      '1',
      '-count_frames',
      '-show_entries',
      'stream=index,codec_name,codec_type,width,height,pix_fmt,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration:format=format_name:format_tags=major_brand,compatible_brands',
      '-of',
      'json',
      outputPath,
    ],
    `animated AVIF inspection for "${outputPath}"`,
    {timeoutMs: 30_000},
  );

  let document: ProbeDocument;
  try {
    document = JSON.parse(stdout) as ProbeDocument;
  } catch (err) {
    throw new Error(
      `ffprobe returned invalid JSON for animated AVIF "${outputPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const formatName = document.format?.format_name ?? '';
  const majorBrand = document.format?.tags?.major_brand ?? '';
  const compatibleBrands = document.format?.tags?.compatible_brands ?? '';
  if (
    !formatName.split(',').includes('mov') ||
    majorBrand !== 'avis' ||
    !compatibleBrands.includes('avif')
  ) {
    throw new Error(
      `Animated AVIF "${outputPath}" has invalid container format=${formatName}, major_brand=${majorBrand}, compatible_brands=${compatibleBrands}`,
    );
  }

  const animatedStreams = (document.streams ?? []).filter(
    stream =>
      stream.codec_type === 'video' &&
      stream.codec_name === 'av1' &&
      getFrameCount(stream) > 1,
  );
  const color = animatedStreams.find(
    stream => !stream.pix_fmt?.startsWith('gray'),
  );
  const alpha = animatedStreams.find(stream =>
    stream.pix_fmt?.startsWith('gray'),
  );
  if (!color || !alpha) {
    throw new Error(
      `Animated AVIF "${outputPath}" must contain separate animated AV1 color and alpha streams`,
    );
  }

  const colorFrames = getFrameCount(color);
  const fps = getFrameRate(color);
  const width = color.width ?? 0;
  const height = color.height ?? 0;
  return {
    probe: {
      colorStreamIndex: color.index ?? -1,
      alphaStreamIndex: alpha.index ?? -1,
      width,
      height,
      frameCount: colorFrames,
      fps,
      durationSeconds: getDuration(color, colorFrames, fps),
      colorPixelFormat: color.pix_fmt ?? '',
      alphaPixelFormat: alpha.pix_fmt ?? '',
      sizeBytes: (await fsp.stat(outputPath)).size,
    },
    alphaWidth: alpha.width ?? 0,
    alphaHeight: alpha.height ?? 0,
    alphaFrameCount: getFrameCount(alpha),
    alphaFps: getFrameRate(alpha),
  };
}

export async function findAnimatedAvifStreamIndexes(
  outputPath: string,
): Promise<{colorStreamIndex: number; alphaStreamIndex: number}> {
  const {probe} = await inspectAnimatedAvif(outputPath);
  return {
    colorStreamIndex: probe.colorStreamIndex,
    alphaStreamIndex: probe.alphaStreamIndex,
  };
}

export async function validateAnimatedAvif(
  outputPath: string,
  profile: AvifEncodingProfile,
  enforceSizeLimit = true,
): Promise<AnimatedAvifProbe> {
  const {probe, alphaWidth, alphaHeight, alphaFrameCount, alphaFps} =
    await inspectAnimatedAvif(outputPath);
  const {
    width,
    height,
    frameCount,
    fps,
    durationSeconds,
    sizeBytes,
    colorPixelFormat,
    alphaPixelFormat,
  } = probe;

  if (colorPixelFormat !== 'yuv420p10le' || alphaPixelFormat !== 'gray10le') {
    throw new Error(
      `Animated AVIF "${outputPath}" has unexpected pixel formats color=${colorPixelFormat}, alpha=${alphaPixelFormat}`,
    );
  }
  if (
    width < 1 ||
    height < 1 ||
    width > profile.maxDimension ||
    height > profile.maxDimension ||
    width > 160 ||
    height > 160 ||
    width % 2 !== 0 ||
    height % 2 !== 0 ||
    alphaWidth !== width ||
    alphaHeight !== height
  ) {
    throw new Error(
      `Animated AVIF "${outputPath}" has invalid color/alpha dimensions ${width}x${height} and ${alphaWidth}x${alphaHeight}`,
    );
  }
  if (frameCount !== alphaFrameCount) {
    throw new Error(
      `Animated AVIF "${outputPath}" has mismatched color/alpha frame counts ${frameCount}/${alphaFrameCount}`,
    );
  }
  if (
    Math.abs(fps - profile.fps) > 0.01 ||
    Math.abs(alphaFps - profile.fps) > 0.01
  ) {
    throw new Error(
      `Animated AVIF "${outputPath}" has unexpected color/alpha FPS ${fps}/${alphaFps}; expected ${profile.fps}`,
    );
  }
  if (
    durationSeconds <= 0 ||
    durationSeconds > AVIF_MAX_DURATION_SECONDS + 0.001 ||
    frameCount > Math.ceil(AVIF_MAX_DURATION_SECONDS * profile.fps)
  ) {
    throw new Error(
      `Animated AVIF "${outputPath}" duration ${durationSeconds}s or frame count ${frameCount} exceeds ${AVIF_MAX_DURATION_SECONDS}s`,
    );
  }
  if (enforceSizeLimit && sizeBytes > AVIF_HARD_LIMIT_BYTES) {
    throw new Error(
      `Animated AVIF "${outputPath}" size ${sizeBytes} exceeds ${AVIF_HARD_LIMIT_BYTES} bytes`,
    );
  }
  return probe;
}
