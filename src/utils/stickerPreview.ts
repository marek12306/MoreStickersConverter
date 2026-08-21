import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

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

const MAX_STDERR_BUFFER = 64 * 1024;

export function buildPreviewFilter(profile: PreviewEncodingProfile): string {
  return `scale=w='min(${profile.maxDimension},iw)':h='min(${profile.maxDimension},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
}

export const executePreviewFfmpeg: PreviewEncoder = async (
  inputPath: string,
  candidatePath: string,
  profile: PreviewEncodingProfile,
): Promise<void> => {
  const filter = buildPreviewFilter(profile);
  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    filter,
    '-c:v',
    'libwebp',
    '-quality',
    String(profile.quality),
    '-compression_level',
    '6',
    candidatePath,
  ];

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const resolveOnce = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const rejectOnce = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    let child;
    try {
      child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err) {
      rejectOnce(
        new Error(
          `Failed to spawn ffmpeg for preview input "${inputPath}" (profile: ${JSON.stringify(profile)}): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    let stderrData = '';

    child.stderr.on('data', chunk => {
      if (stderrData.length < MAX_STDERR_BUFFER) {
        stderrData += chunk.toString();
      }
    });

    child.on('error', err => {
      rejectOnce(
        new Error(
          `FFmpeg preview process encountered error for "${inputPath}": ${err.message}`,
        ),
      );
    });

    child.on('close', code => {
      if (code === 0) {
        resolveOnce();
      } else {
        const errorDetails = stderrData.trim()
          ? ` Details: ${stderrData.trim()}`
          : '';
        rejectOnce(
          new Error(
            `FFmpeg preview process exited with code ${code} for "${inputPath}".${errorDetails}`,
          ),
        );
      }
    });
  });
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
