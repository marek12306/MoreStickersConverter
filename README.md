# MoreStickersConverter

MoreStickersConverter is a tool that converts **Telegram stickers** into **MoreSticker-compatible `.stickerpack` files**.
Simply send a sticker to the bot, and it will download the asset, generate a stickerpack, and return it to you.

This project includes both the Telegram bot logic and the HTTP server used to host sticker images.

---

## ✨ Features

* Receive Telegram stickers from users (static WebP, animated TGS, and video WebM)
* Automatically download sticker assets
* Server-side conversion of Telegram WebM video stickers and Telegram TGS stickers to final animated GIFs, with adaptive compression targeting ~5 MB and a hard limit below 10 MB
* Keep static Telegram WebP stickers as WebP
* Convert stickers into `.stickerpack` format
* Host sticker images through the built-in HTTP server
* Stickerpacks reference external URLs instead of embedding images

---

## ⚙️ Environment Variables

Before running the service, configure the following environment variables:

| Variable                      | Description                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BOT_TOKEN**                 | Telegram bot token                                                                                                                                                      |
| **PORT**                      | Port on which the built-in HTTP server will listen                                                                                                                      |
| **DATA_DIR**                  | Directory where all sticker data is stored                                                                                                                              |
| **EXTERNAL_URL**              | Public URL of this HTTP server. Required when running behind a reverse proxy. <br>Discord clients typically require HTTPS, otherwise a Mixed-Content warning may occur. |
| **ALLOWED_TELEGRAM_USER_IDS** | Comma-separated Telegram user IDs allowed to use the bot (import stickers and manage pack visibility via `/public` and `/unlisted`). If empty or unset, all requests are ignored. |
| **CONCURRENCY**               | Optional: positive integer specifying the number of parallel sticker download workers (default: `5`).                                                                   |
---

## 🐳 Recommended: Run with Docker

A `Dockerfile` is included, and **Docker Compose is recommended** because:

* It simplifies environment variable configuration
* You can bundle your reverse proxy (Nginx/Caddy/etc.)
* It makes HTTPS setup easier for clients like Discord

You can build the image locally or use the prebuilt image from `ghcr.io/lekoowo/morestickersconverter:develop`

---

## ▶️ How to Use

1. Send a sticker to your Telegram bot
2. The bot downloads the sticker file
3. The bot returns the sticker pack URL / hosted manifest URL (`/stickerpack/telegram/<pack>`)
4. Sticker images are served by this project's HTTP server (they are **not embedded** inside the `.stickerpack` file)

---

## Notes

* **Animated stickers & runtime tools**: Telegram WebM stickers are converted server-side to animated GIF with FFmpeg; Telegram TGS stickers are converted to animated GIF with `lottieconverter`. Both FFmpeg and `lottieconverter` are required runtime dependencies and included in the Docker image.
* Since stickerpacks rely on externally hosted images, make sure your server's external URL is reachable.
* If using a reverse proxy, ensure that HTTPS is properly configured to avoid client-side loading errors.
