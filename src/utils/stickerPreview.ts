import {findAnimatedAvifStreamIndexes} from './avifEncoder.js';
import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {runMediaProcess} from './mediaProcess.js';

export const PREVIEW_TARGET_BYTES = 12 * 1024;
export const PREVIEW_MAX_BYTES = 24 * 1024;

export interface PreviewEncodingProfile {
  maxDimension: number;
  quality: number;
}

export const PREVIEW_PROFILES: PreviewEncodingProfile[] = [
  {maxDimension: 96, quality: 60},
  {maxDimension: 96, quality: 50},
  {maxDimension: 80, quality: 50},
  {maxDimension: 80, quality: 40},
  {maxDimension: 64, quality: 40},
];

export interface PreviewResult {
  outputPath: string;
  sizeBytes: number;
  profile: PreviewEncodingProfile;
  profileIndex: number;
}

export type PreviewEncoder = (
  inputPath: string,
  candidatePath: string,
  profile: PreviewEncodingProfile,
) => Promise<void>;

export function buildPreviewFilter(profile: PreviewEncodingProfile): string {
  return `scale=w='min(${profile.maxDimension},iw)':h='min(${profile.maxDimension},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
}

export function buildPreviewFfmpegArgs(
  inputPath: string,
  candidatePath: string,
  profile: PreviewEncodingProfile,
  avifStreams?: {colorStreamIndex: number; alphaStreamIndex: number},
): string[] {
  const filter = buildPreviewFilter(profile);
  const filterArgs = avifStreams
    ? [
        '-filter_complex_threads',
        '1',
        '-filter_complex',
        `[0:${avifStreams.colorStreamIndex}][0:${avifStreams.alphaStreamIndex}]alphamerge,format=rgba,premultiply=inplace=1,${filter},unpremultiply=inplace=1,format=rgba,lut=a='if(lte(val,1),0,if(gte(val,254),255,val))'[preview]`,
        '-map',
        '[preview]',
      ]
    : ['-filter_threads', '1', '-vf', filter];
  return [
    '-y',
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    inputPath,
    ...filterArgs,
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-threads',
    '1',
    '-quality',
    String(profile.quality),
    '-compression_level',
    '6',
    candidatePath,
  ];
}

export const executePreviewFfmpeg: PreviewEncoder = async (
  inputPath: string,
  candidatePath: string,
  profile: PreviewEncodingProfile,
): Promise<void> => {
  const avifStreams =
    path.extname(inputPath).toLowerCase() === '.avif'
      ? await findAnimatedAvifStreamIndexes(inputPath)
      : undefined;
  await runMediaProcess(
    'ffmpeg',
    buildPreviewFfmpegArgs(inputPath, candidatePath, profile, avifStreams),
    `preview encode for "${inputPath}" (profile: ${JSON.stringify(profile)})`,
  );
};

export async function generatePreviewWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: PreviewEncoder = executePreviewFfmpeg,
  profiles: readonly PreviewEncodingProfile[] = PREVIEW_PROFILES,
): Promise<PreviewResult> {
  const candidateFiles = new Set<string>();
  const removeCandidate = async (file: string): Promise<void> => {
    try {
      await fsp.unlink(file);
      candidateFiles.delete(file);
    } catch {
      // Keep the path for the finally block to retry cleanup.
    }
  };
  let bestFallback:
    | {
        path: string;
        size: number;
        profile: PreviewEncodingProfile;
        index: number;
      }
    | undefined;

  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const conversionId = randomUUID();

  try {
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const candidatePath = path.join(
        outputDir,
        `${baseName}.preview-candidate-${i}-${conversionId}.webp`,
      );

      candidateFiles.add(candidatePath);
      try {
        await encoder(inputPath, candidatePath, profile);
      } catch (err) {
        await removeCandidate(candidatePath);
        throw err;
      }

      const size = (await fsp.stat(candidatePath)).size;
      if (size <= PREVIEW_TARGET_BYTES) {
        await fsp.rename(candidatePath, outputPath);
        candidateFiles.delete(candidatePath);
        return {outputPath, sizeBytes: size, profile, profileIndex: i};
      }

      if (size <= PREVIEW_MAX_BYTES) {
        if (!bestFallback || size < bestFallback.size) {
          if (bestFallback) {
            await removeCandidate(bestFallback.path);
          }
          bestFallback = {path: candidatePath, size, profile, index: i};
        } else {
          await removeCandidate(candidatePath);
        }
      } else {
        await removeCandidate(candidatePath);
      }
    }

    if (bestFallback) {
      await fsp.rename(bestFallback.path, outputPath);
      candidateFiles.delete(bestFallback.path);
      return {
        outputPath,
        sizeBytes: bestFallback.size,
        profile: bestFallback.profile,
        profileIndex: bestFallback.index,
      };
    }

    throw new Error(
      `Failed to generate preview for "${inputPath}" under ${PREVIEW_MAX_BYTES} bytes. All profiles exceeded the preview size limit.`,
    );
  } finally {
    await Promise.all([...candidateFiles].map(removeCandidate));
  }
}

export async function generatePreview(
  sourcePath: string,
  outputPath: string,
): Promise<PreviewResult> {
  return generatePreviewWithEncoder(
    sourcePath,
    outputPath,
    executePreviewFfmpeg,
  );
}
