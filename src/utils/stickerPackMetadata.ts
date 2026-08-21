import path from 'path';
import fsp from 'fs/promises';
import {randomUUID} from 'crypto';
import {DATA_DIR} from './telegramStickers.js';

export type PackVisibility = 'public' | 'unlisted';

export interface StickerPackMetadata {
  visibility: PackVisibility;
}

export const DEFAULT_STICKER_PACK_METADATA: StickerPackMetadata = {
  visibility: 'unlisted',
};

const STICKER_PACK_NAME_REGEX = /^[a-z0-9_]+$/i;

export function isValidStickerPackName(packName: string): boolean {
  return STICKER_PACK_NAME_REGEX.test(packName);
}

export function getStickerPackMetadataPath(packName: string): string {
  return path.join(DATA_DIR, `${packName}.meta.json`);
}

export const generateStickerPackMetadataPath = getStickerPackMetadataPath;

function getErrorCode(err: unknown): string | undefined {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as {code: unknown}).code === 'string'
  ) {
    return (err as {code: string}).code;
  }
  return undefined;
}

export function normalizeStoredMetadata(
  value: unknown,
): Partial<StickerPackMetadata> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const normalized: Partial<StickerPackMetadata> = {};

  if (record.visibility === 'public' || record.visibility === 'unlisted') {
    normalized.visibility = record.visibility;
  }

  return normalized;
}

export async function getStickerPackMetadata(
  packName: string,
): Promise<StickerPackMetadata> {
  if (!isValidStickerPackName(packName)) {
    return {...DEFAULT_STICKER_PACK_METADATA};
  }

  const metadataPath = getStickerPackMetadataPath(packName);
  let rawText: string;
  try {
    rawText = await fsp.readFile(metadataPath, 'utf8');
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return {...DEFAULT_STICKER_PACK_METADATA};
    }
    const code = getErrorCode(err);
    console.warn(
      `Warning: Failed to read metadata for pack "${packName}"${code ? ` (${code})` : ''}. Using default unlisted.`,
    );
    return {...DEFAULT_STICKER_PACK_METADATA};
  }

  try {
    const parsed = JSON.parse(rawText);
    const normalized = normalizeStoredMetadata(parsed);
    return {
      ...DEFAULT_STICKER_PACK_METADATA,
      ...normalized,
    };
  } catch {
    console.warn(
      `Warning: Invalid metadata JSON for pack "${packName}". Using default unlisted.`,
    );
    return {...DEFAULT_STICKER_PACK_METADATA};
  }
}

const metadataUpdateQueue = new Map<string, Promise<StickerPackMetadata>>();

async function readRawStoredMetadataObject(
  packName: string,
): Promise<Record<string, unknown>> {
  const metadataPath = getStickerPackMetadataPath(packName);
  let rawText: string;
  try {
    rawText = await fsp.readFile(metadataPath, 'utf8');
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return {};
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(rawText);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    console.warn(
      `Warning: Malformed metadata JSON for pack "${packName}". Resetting metadata on update.`,
    );
    return {};
  }
}

async function writeMetadataAtomically(
  packName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const metadataPath = getStickerPackMetadataPath(packName);
  const metadataDir = path.dirname(metadataPath);
  await fsp.mkdir(metadataDir, {recursive: true});

  const tempFile = path.join(
    metadataDir,
    `${packName}.meta.json.${randomUUID()}.tmp`,
  );
  try {
    await fsp.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tempFile, metadataPath);
  } finally {
    await fsp.unlink(tempFile).catch(() => undefined);
  }
}

export async function updateStickerPackMetadata(
  packName: string,
  patch: Partial<StickerPackMetadata>,
): Promise<StickerPackMetadata> {
  if (!isValidStickerPackName(packName)) {
    throw new Error(`Invalid sticker pack name "${packName}"`);
  }

  const previous =
    metadataUpdateQueue.get(packName) ??
    Promise.resolve({} as StickerPackMetadata);

  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const rawObject = await readRawStoredMetadataObject(packName);
      const validatedPatch = normalizeStoredMetadata(patch);

      const updatedRaw = {
        ...rawObject,
        ...validatedPatch,
      };

      await writeMetadataAtomically(packName, updatedRaw);

      return {
        ...DEFAULT_STICKER_PACK_METADATA,
        ...normalizeStoredMetadata(updatedRaw),
      };
    });

  metadataUpdateQueue.set(packName, current);

  try {
    return await current;
  } finally {
    if (metadataUpdateQueue.get(packName) === current) {
      metadataUpdateQueue.delete(packName);
    }
  }
}
