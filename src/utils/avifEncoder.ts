import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  AVIF_HARD_LIMIT_BYTES,
  AVIF_MAX_DURATION_SECONDS,
  parseFrameRate,
  type AvifEncodingProfile,
} from './avifConversion.js';
import {runMediaProcess} from './mediaProcess.js';

export const AVIF_FPS_TOLERANCE = 0.01;
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

function getFrameRateFromValue(value: string | undefined): number {
  return parseFrameRate(value) ?? 0;
}

function getFrameCount(stream: ProbeStream): number {
  return parsePositiveNumber(stream.nb_read_frames ?? stream.nb_frames);
}

function getFrameRate(stream: ProbeStream): number {
  return (
    getFrameRateFromValue(stream.avg_frame_rate) ||
    getFrameRateFromValue(stream.r_frame_rate)
  );
}

function getDuration(
  stream: ProbeStream,
  frameCount: number,
  fps: number,
): number {
  if (frameCount > 0 && fps > 0) {
    return frameCount / fps;
  }

  return parsePositiveNumber(stream.duration);
}

export function buildAvifFilter(
  profile: AvifEncodingProfile,
  branch: AvifFilterBranch,
): string {
  const timed = [
    'setpts=PTS-STARTPTS',
    `fps=${profile.fps}:start_time=0`,
    `trim=end=${AVIF_MAX_DURATION_SECONDS}`,
    'setpts=PTS-STARTPTS',
  ].join(',');
  const scale = `scale=w='min(${profile.maxDimension},iw)':h='min(${profile.maxDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
  const pad = `pad=${profile.maxDimension}:${profile.maxDimension}:(ow-iw)/2:(oh-ih)/2:color=black`;
  return branch === 'color'
    ? `${timed},format=rgba,premultiply=inplace=1,${scale},unpremultiply=inplace=1,${pad},format=yuv420p10le`
    : `${timed},${scale},format=rgba,alphaextract,${pad},format=gray10le,geq=lum='if(gte(lum(X,Y),1016),1023,round(lum(X,Y)*1023/1020))'`;
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

export function buildDirectAnimatedAvifArgs(
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

    // Map the same source twice:
    // stream 0 = color
    // stream 1 = alpha mask
    '-map',
    '0:v:0',
    '-map',
    '0:v:0',

    // Color stream
    '-filter:v:0',
    buildAvifFilter(profile, 'color'),

    // Alpha stream
    '-filter:v:1',
    buildAvifFilter(profile, 'alpha'),

    '-an',

    // Color AV1 encoder
    '-c:v:0',
    'libaom-av1',
    '-b:v:0',
    '0',
    '-cpu-used:v:0',
    String(profile.cpuUsed),
    '-usage:v:0',
    'good',
    '-tune:v:0',
    'ssim',
    '-threads:v:0',
    '1',
    '-row-mt:v:0',
    '0',
    '-tiles:v:0',
    '1x1',
    '-crf:v:0',
    String(profile.crf),

    // Alpha AV1 encoder
    '-c:v:1',
    'libaom-av1',
    '-b:v:1',
    '0',
    '-cpu-used:v:1',
    String(profile.cpuUsed),
    '-usage:v:1',
    'good',
    '-tune:v:1',
    'ssim',
    '-threads:v:1',
    '1',
    '-row-mt:v:1',
    '0',
    '-tiles:v:1',
    '1x1',
    '-crf:v:1',
    '0',
    '-aq-mode:v:1',
    '0',
    '-enable-restoration:v:1',
    '0',
    '-aom-params:v:1',
    'lossless=1',

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
  await runMediaProcess(
    'ffmpeg',
    buildDirectAnimatedAvifArgs(input.args, outputPath, profile),
    `${input.description} animated AVIF encode (profile: ${JSON.stringify(
      profile,
    )})`,
  );
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
    !compatibleBrands.includes('avif') ||
    (majorBrand !== 'avis' && majorBrand !== 'avif')
  ) {
    throw new Error(
      `AVIF "${outputPath}" has invalid container format=${formatName}, major_brand=${majorBrand}, compatible_brands=${compatibleBrands}`,
    );
  }

  const isAnimatedContainer = majorBrand === 'avis';

  const avifStreams = (document.streams ?? []).filter(stream => {
    if (stream.codec_type !== 'video' || stream.codec_name !== 'av1') {
      return false;
    }

    const frameCount = getFrameCount(stream);

    return isAnimatedContainer ? frameCount > 1 : frameCount === 1;
  });

  const color = avifStreams.find(stream => !stream.pix_fmt?.startsWith('gray'));
  const alpha = avifStreams.find(stream => stream.pix_fmt?.startsWith('gray'));

  if (!color || !alpha) {
    throw new Error(
      isAnimatedContainer
        ? `Animated AVIF "${outputPath}" must contain separate animated AV1 color and alpha streams`
        : `Static AVIF "${outputPath}" must contain separate single-frame AV1 color and alpha streams`,
    );
  }

  const colorFrames = getFrameCount(color);
  const alphaFrames = getFrameCount(alpha);

  const isSingleFrame = colorFrames === 1 && alphaFrames === 1;

  const hasValidBrand = isSingleFrame
    ? majorBrand === 'avif'
    : majorBrand === 'avis';

  if (
    !formatName.split(',').includes('mov') ||
    !hasValidBrand ||
    !compatibleBrands.includes('avif')
  ) {
    throw new Error(
      `AVIF "${outputPath}" has invalid container format=${formatName}, major_brand=${majorBrand}, compatible_brands=${compatibleBrands}, frames=${colorFrames}/${alphaFrames}`,
    );
  }
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
    alphaFrameCount: alphaFrames,
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
  const isSingleFrame = frameCount === 1 && alphaFrameCount === 1;

  if (
    !isSingleFrame &&
    (Math.abs(fps - profile.fps) > AVIF_FPS_TOLERANCE ||
      Math.abs(alphaFps - profile.fps) > AVIF_FPS_TOLERANCE)
  ) {
    throw new Error(
      `Animated AVIF "${outputPath}" has unexpected color/alpha FPS ${fps}/${alphaFps}; expected ${profile.fps}`,
    );
  }
  if (!isSingleFrame) {
    const maxFrameCount = Math.ceil(AVIF_MAX_DURATION_SECONDS * profile.fps);
    const maxRepresentableDuration = maxFrameCount / profile.fps;
    if (
      durationSeconds <= 0 ||
      durationSeconds > maxRepresentableDuration + 0.001 ||
      frameCount > maxFrameCount
    ) {
      throw new Error(
        `Animated AVIF "${outputPath}" duration ${durationSeconds}s or frame count ${frameCount} exceeds ${AVIF_MAX_DURATION_SECONDS}s`,
      );
    }
  }
  if (enforceSizeLimit && sizeBytes > AVIF_HARD_LIMIT_BYTES) {
    throw new Error(
      `Animated AVIF "${outputPath}" size ${sizeBytes} exceeds ${AVIF_HARD_LIMIT_BYTES} bytes`,
    );
  }
  return probe;
}
