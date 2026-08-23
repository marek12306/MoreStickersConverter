import Fastify, {type FastifyReply} from 'fastify';
import cors from '@fastify/cors';
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
});

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
  const validExtension =
    kind === 'stickers'
      ? /^(?:webp|gif)$/.test(fileExtension)
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
  if (rawVersion === undefined && version === undefined && !assetPath) {
    assetPath =
      kind === 'stickers'
        ? path.join(DATA_DIR, stickerPackName, canonicalFilename)
        : generateStickerPreviewFilePath(stickerPackName, stickerId);
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

  const contentType = fileExtension === 'gif' ? 'image/gif' : 'image/webp';
  const cacheControl =
    rawVersion === undefined
      ? 'public, max-age=300'
      : 'public, max-age=31536000, immutable';
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
      await fs.promises.access(stickerPackFilePath, fs.constants.R_OK);
      const fileStream = fs.createReadStream(stickerPackFilePath, {
        highWaterMark: 64 * 1024,
      });

      const safeFilename = stickerPackName.replace(/[^a-zA-Z0-9_-]/g, '_');

      await reply
        .type('application/json; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${safeFilename}.stickerpack"`,
        )
        .header('Cache-Control', 'no-cache')
        .send(fileStream);
    } catch {
      await reply.code(404).send('Sticker pack not found');
    }
  },
);

app.get('/api/stickerpacks', async (_request, reply) => {
  const packs = await getPublicStickerPacks();

  await reply
    .type('application/json; charset=utf-8')
    .header('Cache-Control', 'no-cache')
    .send(packs);
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
