import {spawn} from 'node:child_process';
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
export const GIF_HARD_LIMIT_BYTES = 10_000_000;
export const GIF_SAFE_HARD_LIMIT_BYTES = 9_500_000;

export const GIF_ENCODING_PROFILES: GifEncodingProfile[] = [
  {maxDimension: 384, fps: 24, maxColors: 192, bayerScale: 3},
  {maxDimension: 320, fps: 20, maxColors: 160, bayerScale: 3},
  {maxDimension: 288, fps: 18, maxColors: 128, bayerScale: 3},
  {maxDimension: 256, fps: 15, maxColors: 128, bayerScale: 4},
  {maxDimension: 224, fps: 15, maxColors: 96, bayerScale: 4},
  {maxDimension: 192, fps: 12, maxColors: 80, bayerScale: 4},
  {maxDimension: 160, fps: 10, maxColors: 64, bayerScale: 4},
  {maxDimension: 128, fps: 8, maxColors: 48, bayerScale: 5},
  {maxDimension: 96, fps: 6, maxColors: 32, bayerScale: 5},
  {maxDimension: 80, fps: 5, maxColors: 24, bayerScale: 5},
];

export function buildFfmpegFilter(profile: GifEncodingProfile): string {
  const {maxDimension, fps, maxColors, bayerScale} = profile;
  const scaleFilter = `scale=w='min(${maxDimension},iw)':h='min(${maxDimension},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
  const paletteGen = `palettegen=max_colors=${maxColors}:stats_mode=diff:reserve_transparent=1:transparency_color=000000`;
  const paletteUse = `paletteuse=dither=bayer:bayer_scale=${bayerScale}:diff_mode=rectangle:alpha_threshold=128`;

  return `fps=${fps},${scaleFilter},split[s0][s1];[s0]${paletteGen}[p];[s1][p]${paletteUse}`;
}

const MAX_STDERR_BUFFER = 64 * 1024;

async function executeFfmpeg(
  inputPath: string,
  candidatePath: string,
  profile: GifEncodingProfile,
): Promise<void> {
  const filterComplex = buildFfmpegFilter(profile);
  const args = [
    '-c:v',
    'libvpx-vp9',
    '-i',
    inputPath,
    '-filter_complex',
    filterComplex,
    '-an',
    '-loop',
    '0',
    candidatePath,
    '-y',
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
          `Failed to spawn ffmpeg for input "${inputPath}" (profile: ${JSON.stringify(profile)}): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    let stderrData = '';

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString('utf8');
      if (stderrData.length > MAX_STDERR_BUFFER) {
        stderrData = stderrData.slice(stderrData.length - MAX_STDERR_BUFFER);
      }
    });

    child.on('error', err => {
      rejectOnce(
        new Error(
          `FFmpeg process error for input "${inputPath}" (profile: ${JSON.stringify(profile)}): ${err.message}`,
        ),
      );
    });

    child.on('close', code => {
      if (code === 0) {
        resolveOnce();
      } else {
        const stderrExcerpt = stderrData.trim().slice(-2048);
        rejectOnce(
          new Error(
            `FFmpeg exited with code ${code} for input "${inputPath}" (profile: ${JSON.stringify(profile)}). Error output: ${stderrExcerpt}`,
          ),
        );
      }
    });
  });
}
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

export async function convertWebmToGifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: GifEncoder = executeFfmpeg,
): Promise<ConversionResult> {
  const candidateFiles = new Set<string>();
  let bestFallback:
    | {path: string; size: number; profile: GifEncodingProfile; index: number}
    | undefined;

  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const conversionId = randomUUID();

  try {
    for (let i = 0; i < GIF_ENCODING_PROFILES.length; i++) {
      const profile = GIF_ENCODING_PROFILES[i];
      const candidatePath = path.join(
        outputDir,
        `${baseName}.candidate-${i}-${conversionId}.gif`,
      );

      candidateFiles.add(candidatePath);

      try {
        await encoder(inputPath, candidatePath, profile);
      } catch (err) {
        // Clean up failed candidate file if it was created
        try {
          await fsp.unlink(candidatePath);
          candidateFiles.delete(candidatePath);
        } catch {
          // ignore unlink error
        }
        throw err;
      }

      const stat = await fsp.stat(candidatePath);
      const size = stat.size;

      if (size <= GIF_TARGET_BYTES) {
        // Target achieved: immediately accept and rename
        await fsp.rename(candidatePath, outputPath);
        // Remove accepted path from candidate list so cleanup won't delete it
        candidateFiles.delete(candidatePath);
        return {
          outputPath,
          sizeBytes: size,
          profile,
          profileIndex: i,
        };
      }

      if (size <= GIF_SAFE_HARD_LIMIT_BYTES) {
        // Candidate is within safe limit (<= 9.5MB) but above target (5MB).
        // Save as fallback and try next profile to achieve <= 5MB.
        if (!bestFallback || size < bestFallback.size) {
          if (bestFallback) {
            // Remove previous larger fallback file
            try {
              await fsp.unlink(bestFallback.path);
              candidateFiles.delete(bestFallback.path);
            } catch {
              // ignore
            }
          }
          bestFallback = {path: candidatePath, size, profile, index: i};
        } else {
          // New candidate is larger than existing fallback, delete it
          try {
            await fsp.unlink(candidatePath);
            candidateFiles.delete(candidatePath);
          } catch {
            // ignore
          }
        }
      } else {
        // Candidate exceeds safe hard limit (> 9.5MB), delete it immediately
        try {
          await fsp.unlink(candidatePath);
          candidateFiles.delete(candidatePath);
        } catch {
          // ignore
        }
      }
    }

    // Finished all profiles without reaching <= 5MB
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
      `Failed to convert WebM "${inputPath}" to GIF under ${GIF_SAFE_HARD_LIMIT_BYTES} bytes. All profiles exceeded the safe size limit.`,
    );
  } finally {
    // Clean up all remaining candidate files
    for (const file of candidateFiles) {
      try {
        await fsp.unlink(file);
      } catch {
        // ignore errors during cleanup
      }
    }
  }
}

export async function convertWebmToGif(
  inputPath: string,
  outputPath: string,
): Promise<ConversionResult> {
  return convertWebmToGifWithEncoder(inputPath, outputPath, executeFfmpeg);
}
