import {
  AVIF_ENCODING_PROFILES,
  AVIF_HARD_LIMIT_BYTES,
  buildAvifEncodingProfiles,
  buildFpsCandidates,
  convertToAvifWithEncoder,
  parseFrameRate,
  type AvifEncoder,
  type AvifEncodingProfile,
  type ConversionResult,
} from './avifConversion.js';
import {
  buildAlphaFfmpegArgs,
  buildAvifFilter,
  buildAvifMuxArgs,
  buildColorFfmpegArgs,
  encodeAnimatedAvif,
  validateAnimatedAvif,
} from './avifEncoder.js';
import {runMediaProcess} from './mediaProcess.js';

export type {AvifEncoder, AvifEncodingProfile, ConversionResult};
export {
  AVIF_ENCODING_PROFILES,
  AVIF_HARD_LIMIT_BYTES,
  buildAlphaFfmpegArgs,
  buildAvifFilter,
  buildAvifMuxArgs,
  buildColorFfmpegArgs,
  validateAnimatedAvif,
};

export async function probeWebmSourceFps(
  inputPath: string,
): Promise<number | undefined> {
  try {
    const {stdout} = await runMediaProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-threads',
        '1',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=avg_frame_rate,r_frame_rate',
        '-of',
        'json',
        inputPath,
      ],
      `probe WebM source FPS for "${inputPath}"`,
      {timeoutMs: 15_000},
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{avg_frame_rate?: string; r_frame_rate?: string}>;
    };
    const stream = parsed.streams?.[0];
    if (!stream) return undefined;
    return (
      parseFrameRate(stream.avg_frame_rate) ??
      parseFrameRate(stream.r_frame_rate)
    );
  } catch {
    return undefined;
  }
}

export function buildWebmFfmpegInputArgs(inputPath: string): string[] {
  return ['-c:v', 'libvpx-vp9', '-threads', '1', '-i', inputPath];
}

const executeWebmFfmpeg: AvifEncoder = async (
  inputPath,
  candidatePath,
  profile,
) => {
  await encodeAnimatedAvif(
    {
      args: buildWebmFfmpegInputArgs(inputPath),
      description: `WebM input "${inputPath}"`,
    },
    candidatePath,
    profile,
  );
};

export async function convertWebmToAvifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: AvifEncoder = executeWebmFfmpeg,
  profiles?: readonly AvifEncodingProfile[],
): Promise<ConversionResult> {
  const effectiveProfiles =
    profiles ??
    buildAvifEncodingProfiles(
      buildFpsCandidates(await probeWebmSourceFps(inputPath), 'webm'),
    );
  return await convertToAvifWithEncoder(
    inputPath,
    outputPath,
    encoder,
    'WebM',
    effectiveProfiles,
    encoder === executeWebmFfmpeg
      ? async (candidatePath, profile) =>
          validateAnimatedAvif(candidatePath, profile, false).then(
            () => undefined,
          )
      : undefined,
  );
}

export async function convertWebmToAvif(
  inputPath: string,
  outputPath: string,
): Promise<ConversionResult> {
  const result = await convertWebmToAvifWithEncoder(
    inputPath,
    outputPath,
    executeWebmFfmpeg,
  );
  await validateAnimatedAvif(result.outputPath, result.profile);
  return result;
}
