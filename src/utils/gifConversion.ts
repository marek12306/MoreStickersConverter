import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface GifEncodingProfile {
  maxDimension: number;
  fps: number;
  maxColors: number;
  bayerScale: number;
}

export const GIF_TARGET_BYTES = 5_000_000;
export const GIF_SAFE_HARD_LIMIT_BYTES = 9_500_000;
export const GIF_DIMENSION_SCALE = 0.5;

const BASE_GIF_ENCODING_PROFILES: GifEncodingProfile[] = [
  {maxDimension: 320, fps: 24, maxColors: 192, bayerScale: 3},
  {maxDimension: 304, fps: 20, maxColors: 160, bayerScale: 3},
  {maxDimension: 288, fps: 18, maxColors: 128, bayerScale: 3},
  {maxDimension: 256, fps: 15, maxColors: 128, bayerScale: 4},
  {maxDimension: 224, fps: 15, maxColors: 96, bayerScale: 4},
  {maxDimension: 192, fps: 12, maxColors: 80, bayerScale: 4},
  {maxDimension: 160, fps: 10, maxColors: 64, bayerScale: 4},
  {maxDimension: 128, fps: 8, maxColors: 48, bayerScale: 5},
  {maxDimension: 96, fps: 6, maxColors: 32, bayerScale: 5},
  {maxDimension: 80, fps: 5, maxColors: 24, bayerScale: 5},
];

export const GIF_ENCODING_PROFILES: GifEncodingProfile[] =
  BASE_GIF_ENCODING_PROFILES.map(profile => ({
    ...profile,
    maxDimension: Math.max(
      1,
      Math.round(profile.maxDimension * GIF_DIMENSION_SCALE),
    ),
  }));

const TGS_FPS_BY_PROFILE = [20, 20, 20, 10, 10, 10, 10, 5, 5, 5] as const;

if (TGS_FPS_BY_PROFILE.length !== GIF_ENCODING_PROFILES.length) {
  throw new Error(
    'TGS FPS profile mapping must match GIF encoding profile count',
  );
}

export const TGS_GIF_ENCODING_PROFILES: GifEncodingProfile[] =
  GIF_ENCODING_PROFILES.map((profile, index) => {
    const fps = TGS_FPS_BY_PROFILE[index];
    if (fps === undefined) {
      throw new Error(
        `Missing TGS GIF FPS mapping for encoding profile ${index}`,
      );
    }
    return {
      ...profile,
      fps,
    };
  });

export type GifEncoder = (
  inputPath: string,
  candidatePath: string,
  profile: GifEncodingProfile,
) => Promise<void>;

export interface ConversionResult {
  outputPath: string;
  sizeBytes: number;
  profile: GifEncodingProfile;
  profileIndex: number;
}

export async function convertToGifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: GifEncoder,
  sourceType: string,
  profiles: readonly GifEncodingProfile[] = GIF_ENCODING_PROFILES,
): Promise<ConversionResult> {
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
    | {path: string; size: number; profile: GifEncodingProfile; index: number}
    | undefined;

  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const conversionId = randomUUID();

  try {
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const candidatePath = path.join(
        outputDir,
        `${baseName}.candidate-${i}-${conversionId}.gif`,
      );

      candidateFiles.add(candidatePath);
      try {
        await encoder(inputPath, candidatePath, profile);
      } catch (err) {
        await removeCandidate(candidatePath);
        throw err;
      }

      const size = (await fsp.stat(candidatePath)).size;
      if (size <= GIF_TARGET_BYTES) {
        await fsp.rename(candidatePath, outputPath);
        candidateFiles.delete(candidatePath);
        return {outputPath, sizeBytes: size, profile, profileIndex: i};
      }

      if (size <= GIF_SAFE_HARD_LIMIT_BYTES) {
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
      `Failed to convert ${sourceType} "${inputPath}" to GIF under ${GIF_SAFE_HARD_LIMIT_BYTES} bytes. All profiles exceeded the safe size limit.`,
    );
  } finally {
    await Promise.all([...candidateFiles].map(removeCandidate));
  }
}
