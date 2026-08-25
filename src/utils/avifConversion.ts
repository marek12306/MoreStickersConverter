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
export const TGS_MAX_FPS = 60;
export const WEBM_MAX_FPS = 30;
export const TGS_FPS_FALLBACKS: readonly number[] = [60, 48, 30, 24, 20, 16];
export const WEBM_FPS_FALLBACKS: readonly number[] = [30, 24, 20, 16];

export function parseFrameRate(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === 'N/A' || trimmed === '0/0') {
    return undefined;
  }
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length !== 2) return undefined;
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (
      !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      numerator <= 0 ||
      denominator <= 0
    ) {
      return undefined;
    }
    return numerator / denominator;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function buildFpsCandidates(
  sourceFps: number | undefined,
  formatCapOrSourceType: number | 'tgs' | 'webm',
): number[] {
  if (
    typeof sourceFps === 'number' &&
    Number.isFinite(sourceFps) &&
    sourceFps > 0 &&
    sourceFps < 1
  ) {
    throw new Error(
      `Unsupported source frame rate (${sourceFps} FPS): animated AVIF conversion requires >= 1 FPS to satisfy the 3-second duration limit`,
    );
  }

  const isTgs =
    formatCapOrSourceType === 'tgs' || formatCapOrSourceType === TGS_MAX_FPS;
  const formatCap =
    typeof formatCapOrSourceType === 'number'
      ? formatCapOrSourceType
      : formatCapOrSourceType === 'tgs'
        ? TGS_MAX_FPS
        : WEBM_MAX_FPS;

  const standardFallbacks =
    formatCap >= TGS_MAX_FPS ? TGS_FPS_FALLBACKS : WEBM_FPS_FALLBACKS;

  const hasValidSourceFps =
    typeof sourceFps === 'number' &&
    Number.isFinite(sourceFps) &&
    sourceFps >= 1;

  const validSourceFps = hasValidSourceFps ? sourceFps : AVIF_DEFAULT_FPS;
  const rawMaxFps = Math.min(validSourceFps, formatCap);
  // Floor fractional source FPS for TGS to prevent upsampling.
  const effectiveMaxFps = isTgs ? Math.floor(rawMaxFps) : rawMaxFps;
  const candidates: number[] = [effectiveMaxFps];

  for (const rung of standardFallbacks) {
    if (rung <= formatCap && rung < effectiveMaxFps - 0.01) {
      if (!candidates.some(c => Math.abs(c - rung) < 0.01)) {
        candidates.push(rung);
      }
    }
  }

  return candidates;
}

export function buildAvifEncodingProfiles(
  fpsCandidates: readonly number[],
): AvifEncodingProfile[] {
  if (fpsCandidates.length === 0) {
    return [...AVIF_ENCODING_PROFILES];
  }
  const topFps = fpsCandidates[0];
  const profiles: AvifEncodingProfile[] = [
    {maxDimension: 160, fps: topFps, crf: 24, cpuUsed: 3},
    {maxDimension: 160, fps: topFps, crf: 28, cpuUsed: 3},
    {maxDimension: 160, fps: topFps, crf: 32, cpuUsed: 3},
    {maxDimension: 160, fps: topFps, crf: 36, cpuUsed: 3},
  ];
  for (let i = 1; i < fpsCandidates.length; i++) {
    profiles.push({
      maxDimension: 160,
      fps: fpsCandidates[i],
      crf: 36,
      cpuUsed: 3,
    });
  }
  return profiles;
}

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
