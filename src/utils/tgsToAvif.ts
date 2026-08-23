import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import {
  AVIF_DEFAULT_FPS,
  AVIF_ENCODING_PROFILES,
  AVIF_MAX_DURATION_SECONDS,
  convertToAvifWithEncoder,
  type AvifEncoder,
  type ConversionResult,
} from './avifConversion.js';
import {encodeAnimatedAvif, validateAnimatedAvif} from './avifEncoder.js';
import {runMediaProcess} from './mediaProcess.js';

const TGS_MAX_COMPRESSED_BYTES = 64 * 1024;
const TGS_MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const TGS_MAX_RENDERED_FRAMES = AVIF_DEFAULT_FPS * AVIF_MAX_DURATION_SECONDS;
const TGS_MAX_RENDERED_FRAME_BYTES = 32 * 1024 * 1024;

export function normalizeLottieJsonForConverter(
  rawJson: unknown,
  inputPath: string,
): string {
  if (
    typeof rawJson !== 'object' ||
    rawJson === null ||
    Array.isArray(rawJson)
  ) {
    throw new Error(
      `Invalid TGS content in "${inputPath}": root must be a JSON object`,
    );
  }
  const data = rawJson as Record<string, unknown>;

  if (
    typeof data.fr !== 'number' ||
    !Number.isFinite(data.fr) ||
    data.fr <= 0
  ) {
    throw new Error(`Invalid TGS frame rate (fr=${data.fr}) in "${inputPath}"`);
  }
  if (typeof data.ip !== 'number' || !Number.isFinite(data.ip)) {
    throw new Error(`Invalid TGS in-point (ip=${data.ip}) in "${inputPath}"`);
  }
  if (typeof data.op !== 'number' || !Number.isFinite(data.op)) {
    throw new Error(`Invalid TGS out-point (op=${data.op}) in "${inputPath}"`);
  }

  const ip = data.ip;
  const op = data.op;
  if (op <= ip) {
    throw new Error(
      `Invalid TGS frame range (ip=${ip}, op=${op}) in "${inputPath}"`,
    );
  }

  if (op - ip < 2) {
    throw new Error(
      `TGS duration too short for converter normalization (ip=${ip}, op=${op}) in "${inputPath}"`,
    );
  }
  const cappedExclusiveOp = Math.min(
    op,
    ip + data.fr * AVIF_MAX_DURATION_SECONDS,
  );
  // lottieconverter/rlottie treats op as inclusive; TGS/Lottie defines it as
  // exclusive. Subtracting one prevents an extra rendered frame.
  return JSON.stringify({...data, op: cappedExclusiveOp - 1});
}

async function removePreparedTgs(file: string): Promise<void> {
  try {
    await fsp.unlink(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }
}

export async function prepareTgsForLottieConverter(
  inputPath: string,
): Promise<string> {
  const compressedSize = (await fsp.stat(inputPath)).size;
  if (compressedSize > TGS_MAX_COMPRESSED_BYTES) {
    throw new Error(
      `TGS gzip payload from "${inputPath}" exceeds ${TGS_MAX_COMPRESSED_BYTES} bytes`,
    );
  }
  const fileBuffer = await fsp.readFile(inputPath);
  let jsonString: string;
  try {
    jsonString = gunzipSync(fileBuffer, {
      maxOutputLength: TGS_MAX_DECOMPRESSED_BYTES,
    }).toString('utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to decompress TGS gzip payload from "${inputPath}": ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse TGS JSON payload from "${inputPath}": ${message}`,
    );
  }

  const normalizedJson = normalizeLottieJsonForConverter(parsed, inputPath);
  const parsedPath = path.parse(inputPath);
  const tempPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}.lottieconverter-${randomUUID()}${parsedPath.ext || '.tgs'}`,
  );
  await fsp.writeFile(tempPath, gzipSync(Buffer.from(normalizedJson, 'utf8')));
  return tempPath;
}

function getPngSequence(
  frameDir: string,
  entries: string[],
): {pattern: string; filenames: string[]} {
  const frames = entries
    .map(name => {
      const match = /^frame-(\d+)\.png$/.exec(name);
      return match ? {name, digits: match[1], number: Number(match[1])} : null;
    })
    .filter(
      (frame): frame is {name: string; digits: string; number: number} =>
        frame !== null,
    )
    .sort((left, right) => left.number - right.number);
  if (frames.length < 2) {
    throw new Error('lottieconverter did not produce an animated PNG sequence');
  }
  if (frames.length > TGS_MAX_RENDERED_FRAMES) {
    throw new Error(
      `lottieconverter produced ${frames.length} frames; maximum is ${TGS_MAX_RENDERED_FRAMES}`,
    );
  }

  const digitCount = frames[0].digits.length;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (frame.number !== index || frame.digits.length !== digitCount) {
      throw new Error(
        `lottieconverter produced a non-contiguous PNG sequence at "${frame.name}"`,
      );
    }
  }
  return {
    pattern: path.join(frameDir, `frame-%0${digitCount}d.png`),
    filenames: frames.map(frame => frame.name),
  };
}

async function renderTgsPngSequence(
  preparedInputPath: string,
  frameDir: string,
): Promise<string> {
  await fsp.mkdir(frameDir, {recursive: true});
  const framePrefix = path.join(frameDir, 'frame-');
  await runMediaProcess(
    'lottieconverter',
    [
      preparedInputPath,
      framePrefix,
      'pngs',
      '160x160',
      String(AVIF_DEFAULT_FPS),
    ],
    `TGS PNG sequence render for "${preparedInputPath}"`,
  );
  const sequence = getPngSequence(frameDir, await fsp.readdir(frameDir));
  const frameStats = await Promise.all(
    sequence.filenames.map(filename => fsp.stat(path.join(frameDir, filename))),
  );
  const totalFrameBytes = frameStats.reduce(
    (total, stats) => total + stats.size,
    0,
  );
  if (totalFrameBytes > TGS_MAX_RENDERED_FRAME_BYTES) {
    throw new Error(
      `lottieconverter PNG sequence uses ${totalFrameBytes} bytes; maximum is ${TGS_MAX_RENDERED_FRAME_BYTES}`,
    );
  }
  return sequence.pattern;
}

export function buildTgsFfmpegInputArgs(pattern: string): string[] {
  return [
    '-framerate',
    String(AVIF_DEFAULT_FPS),
    '-start_number',
    '0',
    '-threads',
    '1',
    '-i',
    pattern,
  ];
}

export async function convertTgsToAvifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: AvifEncoder,
): Promise<ConversionResult> {
  return await convertToAvifWithEncoder(
    inputPath,
    outputPath,
    encoder,
    'TGS',
    AVIF_ENCODING_PROFILES,
  );
}

export async function convertTgsToAvif(
  inputPath: string,
  outputPath: string,
  encoder?: AvifEncoder,
): Promise<ConversionResult> {
  const preparedInputPath = await prepareTgsForLottieConverter(inputPath);
  const frameDir = path.join(
    path.dirname(inputPath),
    `.lottie-frames-${randomUUID()}`,
  );
  let result: ConversionResult;

  try {
    if (encoder) {
      result = await convertTgsToAvifWithEncoder(
        preparedInputPath,
        outputPath,
        encoder,
      );
    } else {
      const sequencePattern = await renderTgsPngSequence(
        preparedInputPath,
        frameDir,
      );
      const sequenceEncoder: AvifEncoder = async (
        pattern,
        candidatePath,
        profile,
      ) => {
        await encodeAnimatedAvif(
          {
            args: buildTgsFfmpegInputArgs(pattern),
            description: `TGS PNG sequence "${pattern}"`,
          },
          candidatePath,
          profile,
        );
      };
      result = await convertToAvifWithEncoder(
        sequencePattern,
        outputPath,
        sequenceEncoder,
        'TGS',
        AVIF_ENCODING_PROFILES,
        async (candidatePath, profile) =>
          validateAnimatedAvif(candidatePath, profile, false).then(
            () => undefined,
          ),
      );
      await validateAnimatedAvif(result.outputPath, result.profile);
    }
  } catch (err) {
    await fsp
      .rm(frameDir, {recursive: true, force: true})
      .catch(() => undefined);
    await removePreparedTgs(preparedInputPath).catch(() => undefined);
    throw err;
  }

  await fsp.rm(frameDir, {recursive: true, force: true});
  await removePreparedTgs(preparedInputPath);
  return result;
}
