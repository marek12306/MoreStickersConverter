import {app} from './utils/fastify.js';
import {bot} from './utils/telegram.js';
import {initializeTelegramStickerStorage} from './utils/telegramStickers.js';

const port = parseInt(process.env.PORT!);
const host = process.env.HOST ?? '::';

const stickerStorageGcTimer = await initializeTelegramStickerStorage();

process.on('SIGINT', () => {
  clearInterval(stickerStorageGcTimer);
  bot.stop('SIGINT');
});
process.on('SIGTERM', () => {
  clearInterval(stickerStorageGcTimer);
  bot.stop('SIGTERM');
});

await Promise.all([
  app
    .listen({port, host})
    .then(() => console.log(`Server listening on http://${host}:${port}`)),
  bot.launch(),
]);
