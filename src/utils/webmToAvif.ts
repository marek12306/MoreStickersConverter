import {
  AVIF_ENCODING_PROFILES,
  AVIF_HARD_LIMIT_BYTES,
  convertToAvifWithEncoder,
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
): Promise<ConversionResult> {
  return await convertToAvifWithEncoder(
    inputPath,
    outputPath,
    encoder,
    'WebM',
    AVIF_ENCODING_PROFILES,
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
