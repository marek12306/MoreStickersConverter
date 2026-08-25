import fsp from 'fs/promises';
import {DATA_DIR, generateStickerPackFilePath} from './telegramStickers.js';
import {
  getStickerPackMetadata,
  isValidStickerPackName,
} from './stickerPackMetadata.js';

export interface PublicStickerPackSummary {
  id: string;
  name: string;
  title: string;
  stickerCount: number;
  url: string;
  preview: string;
  animatedPreview?: string;
  fullPreview?: string;
}

export const STICKER_PACK_FILE_SUFFIX = '.telegram.stickerpack';

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
export async function listLocalStickerPackNames(): Promise<string[]> {
  let dirents;
  try {
    dirents = await fsp.readdir(DATA_DIR, {withFileTypes: true});
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const packNames = new Set<string>();
  for (const dirent of dirents) {
    if (!dirent.isFile() && !dirent.isSymbolicLink()) {
      continue;
    }

    const filename = dirent.name;
    if (!filename.endsWith(STICKER_PACK_FILE_SUFFIX)) {
      continue;
    }

    const packName = filename.slice(0, -STICKER_PACK_FILE_SUFFIX.length);
    if (!isValidStickerPackName(packName)) {
      continue;
    }

    packNames.add(packName);
  }

  return Array.from(packNames).sort((a, b) => a.localeCompare(b));
}

export async function getPublicStickerPacks(): Promise<
  PublicStickerPackSummary[]
> {
  const summaries: PublicStickerPackSummary[] = [];

  let dirents;
  try {
    dirents = await fsp.readdir(DATA_DIR, {withFileTypes: true});
  } catch (err: unknown) {
    if (getErrorCode(err) === 'ENOENT') {
      return [];
    }
    throw err;
  }

  for (const dirent of dirents) {
    if (!dirent.isFile() && !dirent.isSymbolicLink()) {
      continue;
    }

    const filename = dirent.name;
    if (!filename.endsWith(STICKER_PACK_FILE_SUFFIX)) {
      continue;
    }

    const packName = filename.slice(0, -STICKER_PACK_FILE_SUFFIX.length);
    if (!isValidStickerPackName(packName)) {
      continue;
    }

    try {
      const metadata = await getStickerPackMetadata(packName);
      if (metadata.visibility !== 'public') {
        continue;
      }

      const manifestPath = generateStickerPackFilePath(packName);
      const manifestRaw = await fsp.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestRaw);

      if (
        typeof manifest !== 'object' ||
        manifest === null ||
        Array.isArray(manifest)
      ) {
        console.warn(
          `Warning: Invalid manifest for pack "${packName}". Skipping.`,
        );
        continue;
      }

      const id = manifest.id;
      const title = manifest.title;
      const stickers = manifest.stickers;
      const logo = manifest.logo;

      if (
        typeof id !== 'string' ||
        typeof title !== 'string' ||
        !Array.isArray(stickers) ||
        typeof logo !== 'object' ||
        logo === null ||
        typeof logo.image !== 'string'
      ) {
        console.warn(
          `Warning: Manifest missing required summary fields for pack "${packName}". Skipping.`,
        );
        continue;
      }

      const preview =
        typeof logo.previewImage === 'string' && logo.previewImage
          ? logo.previewImage
          : logo.image;
      const animatedPreview =
        logo.isAnimated === true && logo.image !== preview
          ? logo.image
          : undefined;
      const fullPreview =
        logo.isAnimated !== true &&
        typeof logo.previewImage === 'string' &&
        logo.previewImage &&
        logo.image !== preview
          ? logo.image
          : undefined;

      const externalUrl = process.env.EXTERNAL_URL!;
      const url = `${externalUrl}/stickerpack/telegram/${encodeURIComponent(packName)}`;

      summaries.push({
        id,
        name: packName,
        title,
        stickerCount: stickers.length,
        url,
        preview,
        ...(animatedPreview ? {animatedPreview} : {}),
        ...(fullPreview ? {fullPreview} : {}),
      });
    } catch (err: unknown) {
      const code = getErrorCode(err);
      console.warn(
        `Warning: Failed to process pack "${packName}" in getPublicStickerPacks${code ? ` (${code})` : ''}. Skipping.`,
      );
      continue;
    }
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
