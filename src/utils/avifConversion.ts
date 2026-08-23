import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface AvifEncodingProfile {
  maxDimension: number;
  fps: number;
  crf: number;
  cpuUsed: number;
}

export const AVIF_HARD_LIMIT_BYTES = 5 * 1024 * 1024;
export const AVIF_MAX_DURATION_SECONDS = 3;
export const AVIF_DEFAULT_FPS = 24;

export const AVIF_ENCODING_PROFILES: readonly AvifEncodingProfile[] = [
  {maxDimension: 160, fps: 24, crf: 24, cpuUsed: 3},
  {maxDimension: 160, fps: 24, crf: 28, cpuUsed: 3},
  {maxDimension: 160, fps: 24, crf: 32, cpuUsed: 3},
  {maxDimension: 160, fps: 24, crf: 36, cpuUsed: 3},
  {maxDimension: 160, fps: 20, crf: 36, cpuUsed: 3},
  {maxDimension: 160, fps: 16, crf: 36, cpuUsed: 3},
];

export type AvifEncoder = (
  inputPath: string,
  candidatePath: string,
  profile: AvifEncodingProfile,
) => Promise<void>;

export type AvifValidator = (
  candidatePath: string,
  profile: AvifEncodingProfile,
) => Promise<void>;

export interface ConversionResult {
  outputPath: string;
  sizeBytes: number;
  profile: AvifEncodingProfile;
  profileIndex: number;
}

export async function convertToAvifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: AvifEncoder,
  sourceType: string,
  profiles: readonly AvifEncodingProfile[] = AVIF_ENCODING_PROFILES,
  validator?: AvifValidator,
): Promise<ConversionResult> {
  const candidateFiles = new Set<string>();
  const removeCandidate = async (file: string): Promise<void> => {
    try {
      await fsp.unlink(file);
      candidateFiles.delete(file);
    } catch {
      // Keep the path so the finally block retries cleanup.
    }
  };

  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const conversionId = randomUUID();

  try {
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const candidatePath = path.join(
        outputDir,
        `${baseName}.candidate-${i}-${conversionId}.avif`,
      );
      candidateFiles.add(candidatePath);

      try {
        await encoder(inputPath, candidatePath, profile);
        await validator?.(candidatePath, profile);
      } catch (err) {
        await removeCandidate(candidatePath);
        throw err;
      }

      const sizeBytes = (await fsp.stat(candidatePath)).size;
      if (sizeBytes <= AVIF_HARD_LIMIT_BYTES) {
        await fsp.rm(outputPath, {force: true});
        await fsp.rename(candidatePath, outputPath);
        candidateFiles.delete(candidatePath);
        return {outputPath, sizeBytes, profile, profileIndex: i};
      }

      await removeCandidate(candidatePath);
    }

    throw new Error(
      `Failed to convert ${sourceType} "${inputPath}" to animated AVIF under ${AVIF_HARD_LIMIT_BYTES} bytes. All quality profiles exceeded the hard limit.`,
    );
  } finally {
    await Promise.all([...candidateFiles].map(removeCandidate));
  }
}
