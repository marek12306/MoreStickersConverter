import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import {
  convertToGifWithEncoder,
  TGS_GIF_ENCODING_PROFILES,
  type ConversionResult,
  type GifEncoder,
  type GifEncodingProfile,
} from './gifConversion.js';
const MAX_STDERR_BUFFER = 64 * 1024;

async function executeLottieConverter(
  inputPath: string,
  candidatePath: string,
  profile: GifEncodingProfile,
): Promise<void> {
  const args = [
    inputPath,
    candidatePath,
    'gif',
    `${profile.maxDimension}x${profile.maxDimension}`,
    String(profile.fps),
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
      child = spawn('lottieconverter', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err) {
      rejectOnce(
        new Error(
          `Failed to spawn lottieconverter for input "${inputPath}" (profile: ${JSON.stringify(profile)}): ${err instanceof Error ? err.message : String(err)}`,
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
          `lottieconverter process error for input "${inputPath}" (profile: ${JSON.stringify(profile)}): ${err.message}`,
        ),
      );
    });
    child.on('close', code => {
      if (code === 0) {
        resolveOnce();
        return;
      }
      const stderrExcerpt = stderrData.trim().slice(-2048);
      rejectOnce(
        new Error(
          `lottieconverter exited with code ${code} for input "${inputPath}" (profile: ${JSON.stringify(profile)}). Error output: ${stderrExcerpt}`,
        ),
      );
    });
  });
}
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

  const normalizedOp = op - 1;
  if (normalizedOp <= ip) {
    throw new Error(
      `TGS duration too short for converter normalization (ip=${ip}, op=${op}) in "${inputPath}"`,
    );
  }

  const normalizedData = {
    ...data,
    op: normalizedOp,
  };

  return JSON.stringify(normalizedData);
}

async function removePreparedTgs(file: string): Promise<void> {
  try {
    await fsp.unlink(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

export async function prepareTgsForLottieConverter(
  inputPath: string,
): Promise<string> {
  const fileBuffer = await fsp.readFile(inputPath);
  let jsonString: string;
  try {
    const decompressed = gunzipSync(fileBuffer);
    jsonString = decompressed.toString('utf8');
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
  const normalizedBuffer = gzipSync(Buffer.from(normalizedJson, 'utf8'));

  const parsedPath = path.parse(inputPath);
  const tempPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}.lottieconverter-${randomUUID()}${parsedPath.ext || '.tgs'}`,
  );

  await fsp.writeFile(tempPath, normalizedBuffer);
  return tempPath;
}

export async function convertTgsToGifWithEncoder(
  inputPath: string,
  outputPath: string,
  encoder: GifEncoder = executeLottieConverter,
): Promise<ConversionResult> {
  return convertToGifWithEncoder(
    inputPath,
    outputPath,
    encoder,
    'TGS',
    TGS_GIF_ENCODING_PROFILES,
  );
}

export async function convertTgsToGif(
  inputPath: string,
  outputPath: string,
  encoder: GifEncoder = executeLottieConverter,
): Promise<ConversionResult> {
  const preparedInputPath = await prepareTgsForLottieConverter(inputPath);
  let result: ConversionResult;
  try {
    result = await convertTgsToGifWithEncoder(
      preparedInputPath,
      outputPath,
      encoder,
    );
  } catch (conversionError) {
    try {
      await removePreparedTgs(preparedInputPath);
    } catch {
      // Don't throw cleanup error to preserve primary conversion error
    }
    throw conversionError;
  }

  await removePreparedTgs(preparedInputPath);
  return result;
}
