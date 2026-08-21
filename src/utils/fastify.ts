import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'path';
import {DATA_DIR, generateStickerPackFilePath} from './telegramStickers.js';
import fs from 'fs';
interface ParamsType {
  stickerPackName: string;
  filename: string;
}
interface StickerPackParamsType {
  stickerPackName: string;
}

const app = Fastify();

await app.register(cors, {
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
});

app.get(
  '/sticker/telegram/:stickerPackName/:filename',
  async (request, reply) => {
    const {stickerPackName, filename} = request.params as unknown as ParamsType;

    const extension = path.extname(filename);
    const stickerId = path.basename(filename, extension);
    const fileExtension = extension.slice(1).toLowerCase();

    // Sanitize stickerPackName and stickerId
    if (!/^[a-z0-9_]+$/i.test(stickerPackName)) {
      await reply.code(400).send('Invalid sticker pack name');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/i.test(stickerId)) {
      await reply.code(400).send('Invalid sticker id');
      return;
    }

    if (!/^(?:webp|gif)$/.test(fileExtension)) {
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

    const mimeTypes: Record<string, string> = {
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const contentType = mimeTypes[fileExtension] || 'application/octet-stream';
    const stickerFilePath = path.join(DATA_DIR, stickerPackName, filename);

    try {
      const fileStream = fs.createReadStream(stickerFilePath, {
        highWaterMark: 64 * 1024,
      });
      await reply
        .type(contentType)
        .header('Cache-Control', 'public, max-age=31536000')
        .send(fileStream);
    } catch {
      await reply.code(500).send('Internal server error');
    }
  },
);

app.get<{Params: StickerPackParamsType}>(
  '/stickerpack/telegram/:stickerPackName',
  async (request, reply) => {
    const {stickerPackName} = request.params;

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

export {app};
