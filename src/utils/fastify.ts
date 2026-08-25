import Fastify, {type FastifyReply} from 'fastify';
import cors from '@fastify/cors';
import crypto from 'crypto';
import path from 'path';
import {
  DATA_DIR,
  generateStickerPackFilePath,
  generateStickerPreviewFilePath,
  readManifestOrUndefined,
  validateLocalStickerPackManifest,
} from './telegramStickers.js';
import {
  resolveLegacyStickerAssetPath,
  resolveStickerAssetPath,
} from './stickerAssetStorage.js';
import {getPublicStickerPacks} from './stickerPackCatalog.js';
import {isValidStickerPackName} from './stickerPackMetadata.js';
import fs from 'fs';
interface ParamsType {
  stickerPackName: string;
  filename: string;
}
interface VersionedParamsType extends ParamsType {
  version: string;
}
interface StickerPackParamsType {
  stickerPackName: string;
}

const app = Fastify();

await app.register(cors, {
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  exposedHeaders: ['ETag'],
});

export function createEtag(body: string | Buffer): string {
  const hash = crypto.createHash('sha256').update(body).digest('base64url');
  return `"${hash}"`;
}

function parseEntityTag(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

function splitHttpHeaderList(header: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      const trimmedItem = current.trim();
      if (trimmedItem) {
        items.push(trimmedItem);
      }
      current = '';
    } else {
      current += char;
    }
  }
  const lastItem = current.trim();
  if (lastItem) {
    items.push(lastItem);
  }
  return items;
}

export function ifNoneMatchMatches(
  ifNoneMatch: string | string[] | undefined | null,
  etag: string,
): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  const header = Array.isArray(ifNoneMatch)
    ? ifNoneMatch.join(', ')
    : typeof ifNoneMatch === 'string'
      ? ifNoneMatch
      : '';
  const trimmed = header.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === '*') {
    return true;
  }

  const targetOpaque = parseEntityTag(etag);
  if (!targetOpaque) {
    return false;
  }

  const parts = splitHttpHeaderList(trimmed);
  if (parts.length === 0) {
    return false;
  }

  let matched = false;
  for (const part of parts) {
    const candidateOpaque = parseEntityTag(part);
    if (!candidateOpaque) {
      return false;
    }
    if (candidateOpaque === targetOpaque) {
      matched = true;
    }
  }
  return matched;
}

async function serveStickerAsset(
  reply: FastifyReply,
  params: ParamsType,
  kind: 'stickers' | 'previews',
  rawVersion?: string,
): Promise<void> {
  const {stickerPackName, filename} = params;
  const extension = path.extname(filename);
  const stickerId = path.basename(filename, extension);
  const fileExtension = extension.slice(1).toLowerCase();
  if (!isValidStickerPackName(stickerPackName)) {
    await reply.code(400).send('Invalid sticker pack name');
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(stickerId)) {
    await reply.code(400).send('Invalid sticker id');
    return;
  }
  const isLegacyAnimatedRequest =
    kind === 'stickers' &&
    rawVersion === undefined &&
    /^(?:webm|tgs)$/.test(fileExtension);
  const validExtension =
    kind === 'stickers'
      ? /^(?:avif|gif|webp)$/.test(fileExtension) || isLegacyAnimatedRequest
      : fileExtension === 'webp';
  if (!validExtension) {
    await reply.code(400).send('Invalid file extension');
    return;
  }
  const canonicalFilename = `${stickerId}.${fileExtension}`;
  if (
    path.basename(filename) !== filename ||
    filename.toLowerCase() !== canonicalFilename.toLowerCase()
  ) {
    await reply.code(400).send('Invalid filename');
    return;
  }

  let version: number | undefined;
  if (rawVersion !== undefined) {
    version = Number(rawVersion);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      String(version) !== rawVersion
    ) {
      await reply.code(400).send('Invalid sticker pack version');
      return;
    }
    let publicVersion: number | undefined;
    try {
      const manifest = validateLocalStickerPackManifest(
        await readManifestOrUndefined(stickerPackName),
      );
      publicVersion = manifest?.dynamic?.version;
    } catch {
      publicVersion = undefined;
    }
    if (publicVersion === undefined || version > publicVersion) {
      await reply
        .code(404)
        .send(kind === 'stickers' ? 'Sticker not found' : 'Preview not found');
      return;
    }
  } else {
    const manifest = validateLocalStickerPackManifest(
      await readManifestOrUndefined(stickerPackName),
    );
    version = manifest?.dynamic?.version;
  }
  if (isLegacyAnimatedRequest && version === undefined) {
    await reply.code(400).send('Invalid file extension');
    return;
  }

  let assetPath: string | undefined;
  if (version !== undefined) {
    assetPath =
      rawVersion === undefined
        ? await resolveLegacyStickerAssetPath(
            stickerPackName,
            version,
            canonicalFilename,
            kind,
          )
        : await resolveStickerAssetPath(
            stickerPackName,
            version,
            filename,
            kind,
          );
  }
  if (
    rawVersion === undefined &&
    version === undefined &&
    !assetPath &&
    !isLegacyAnimatedRequest
  ) {
    assetPath =
      kind === 'stickers'
        ? path.join(DATA_DIR, stickerPackName, filename)
        : generateStickerPreviewFilePath(stickerPackName, stickerId);
  }
  if (!assetPath && isLegacyAnimatedRequest) {
    await reply.code(400).send('Invalid file extension');
    return;
  }
  if (!assetPath) {
    await reply
      .code(404)
      .send(kind === 'stickers' ? 'Sticker not found' : 'Preview not found');
    return;
  }
  let assetFile;
  try {
    assetFile = await fs.promises.open(assetPath, 'r');
  } catch {
    await reply
      .code(404)
      .send(kind === 'stickers' ? 'Sticker not found' : 'Preview not found');
    return;
  }

  // Content-Type must reflect the actually resolved asset, not the request
  // filename: a legacy /A.gif request may resolve to the current A.avif.
  const resolvedExtension = path.extname(assetPath).slice(1).toLowerCase();
  const contentType =
    resolvedExtension === 'avif'
      ? 'image/avif'
      : resolvedExtension === 'gif'
        ? 'image/gif'
        : 'image/webp';
  const cacheControl =
    rawVersion === undefined ? 'public, max-age=300' : 'public, max-age=604800';
  try {
    await reply
      .type(contentType)
      .header('Cache-Control', cacheControl)
      .send(
        assetFile.createReadStream({
          highWaterMark: 64 * 1024,
        }),
      );
  } catch {
    await assetFile.close().catch(() => undefined);
    if (!reply.sent) {
      await reply.code(500).send('Internal server error');
    }
  }
}

app.get(
  '/sticker/telegram/:stickerPackName/:version/:filename',
  async (request, reply) => {
    const {version, ...params} =
      request.params as unknown as VersionedParamsType;
    await serveStickerAsset(reply, params, 'stickers', version);
  },
);
app.get(
  '/sticker/telegram/:stickerPackName/:filename',
  async (request, reply) => {
    await serveStickerAsset(
      reply,
      request.params as unknown as ParamsType,
      'stickers',
    );
  },
);
app.get(
  '/preview/telegram/:stickerPackName/:version/:filename',
  async (request, reply) => {
    const {version, ...params} =
      request.params as unknown as VersionedParamsType;
    await serveStickerAsset(reply, params, 'previews', version);
  },
);
app.get(
  '/preview/telegram/:stickerPackName/:filename',
  async (request, reply) => {
    await serveStickerAsset(
      reply,
      request.params as unknown as ParamsType,
      'previews',
    );
  },
);

app.get<{Params: StickerPackParamsType}>(
  '/stickerpack/telegram/:stickerPackName',
  async (request, reply) => {
    const {stickerPackName} = request.params;

    if (!isValidStickerPackName(stickerPackName)) {
      await reply.code(400).send('Invalid sticker pack name');
      return;
    }

    const stickerPackFilePath = generateStickerPackFilePath(stickerPackName);

    try {
      const manifestContent = await fs.promises.readFile(
        stickerPackFilePath,
        'utf8',
      );
      const safeFilename = stickerPackName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const etag = createEtag(manifestContent);
      if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
        await reply
          .header('ETag', etag)
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFilename}.stickerpack"`,
          )
          .header('Cache-Control', 'no-cache')
          .code(304)
          .send();
        return;
      }

      await reply
        .header('ETag', etag)
        .header(
          'Content-Disposition',
          `attachment; filename="${safeFilename}.stickerpack"`,
        )
        .header('Cache-Control', 'no-cache')
        .type('application/json; charset=utf-8')
        .send(manifestContent);
    } catch {
      await reply.code(404).send('Sticker pack not found');
    }
  },
);

app.get('/api/stickerpacks', async (request, reply) => {
  const packs = await getPublicStickerPacks();
  const body = JSON.stringify(packs);
  const etag = createEtag(body);

  if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
    await reply
      .header('ETag', etag)
      .header('Cache-Control', 'no-cache')
      .code(304)
      .send();
    return;
  }

  await reply
    .header('ETag', etag)
    .header('Cache-Control', 'no-cache')
    .type('application/json; charset=utf-8')
    .send(body);
});

const browserIndexPath = path.resolve('public/index.html');

app.get('/', async (_request, reply) => {
  try {
    const html = await fs.promises.readFile(browserIndexPath, 'utf8');
    await reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(html);
  } catch {
    await reply.code(500).send('Browser page unavailable');
  }
});

export {app};
