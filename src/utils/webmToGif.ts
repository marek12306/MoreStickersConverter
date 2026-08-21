import {spawn} from 'node:child_process';
import {
  convertToGifWithEncoder,
  type ConversionResult,
  type GifEncoder,
  type GifEncodingProfile,
  GIF_ENCODING_PROFILES,
  GIF_SAFE_HARD_LIMIT_BYTES,
  GIF_TARGET_BYTES,
} from './gifConversion.js';

export type {ConversionResult, GifEncoder, GifEncodingProfile};
export {GIF_ENCODING_PROFILES, GIF_SAFE_HARD_LIMIT_BYTES, GIF_TARGET_BYTES};
export const GIF_HARD_LIMIT_BYTES = 10_000_000;

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
export async function convertWebmToGifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: GifEncoder = executeFfmpeg,
): Promise<ConversionResult> {
  return convertToGifWithEncoder(inputPath, outputPath, encoder, 'WebM');
}

export async function convertWebmToGif(
  inputPath: string,
  outputPath: string,
): Promise<ConversionResult> {
  return convertWebmToGifWithEncoder(inputPath, outputPath, executeFfmpeg);
}
