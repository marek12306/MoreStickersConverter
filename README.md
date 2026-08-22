> [!IMPORTANT]
>
> This repository is a modified fork of the original **MoreStickersConverter** project.
>
> It extends the upstream project with support for animated Telegram stickers, hosted and automatically refreshable sticker packs, a public sticker pack catalog, access control, visibility management, improved downloads and caching, and better Docker support.
>
> The original upstream README is preserved below for reference, so some parts may not fully reflect the behavior of this fork.
>
> Also, this project was vibecoded.

## Changes in this fork

### Better Telegram sticker support

The fork supports all common Telegram sticker formats:

* Static **WebP** stickers are preserved as-is.
* Video stickers in **WebM** format are converted to animated **GIFs**.
* Animated **TGS** stickers are also converted to animated **GIFs**.
* GIFs are automatically compressed to stay within practical upload limits.
* Previews are generated automatically for both static and animated stickers.

### Hosted and refreshable sticker packs

Sticker packs are now hosted by the converter instead of being sent as `.stickerpack` files directly through Telegram.

Generated packs support automatic versioning and refreshing. When stickers are added, removed, reordered, renamed, or otherwise changed, the pack version is updated. If nothing changed, the existing version is kept.

This allows imported packs to stay connected to their latest generated version.

### Public sticker pack catalog

The fork includes a built-in web interface for browsing shared sticker packs.

The catalog provides:

* pack previews,
* sticker counts,
* search,
* sticker galleries,
* easy copying of sticker pack links.

Imported packs are **unlisted by default**.

Authorized users can make a pack public or unlisted again using:

```text
/public <pack-name>
/unlisted <pack-name>
```

These commands can also be used by replying to a sticker from the target pack.

Unlisted packs do not appear in the public catalog but remain accessible through their direct link.

### Telegram access control

Bot access can be limited with:

```text
ALLOWED_TELEGRAM_USER_IDS
```

Only listed Telegram users can import packs or change their visibility.

Example:

```env
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
```

If the allowlist is empty or not configured, Telegram requests are ignored.

### Faster and more reliable downloads

Sticker downloads can run in parallel, with the number of workers controlled by:

```text
CONCURRENCY
```

The default is `5`.

Example:

```env
CONCURRENCY=8
```

Failed Telegram downloads are retried automatically, and download handling has been improved to avoid incomplete or corrupted files.

### Improved caching

Previously generated packs are reused when possible.

Older cached packs using outdated WebM/TGS handling are detected automatically and regenerated using the current GIF-based format, while compatible WebP/GIF caches remain valid.

### Safer and more robust server

The built-in server has been improved with better request validation, safer file handling, correct asset metadata, caching support, and protection against malformed paths.

### Docker and runtime

This fork requires:

* **Node.js 20 or newer**
* **FFmpeg**
* **lottieconverter**

The provided Docker image uses **Node.js 22** and already includes the required conversion tools and public web interface.

A Nix development environment is also available with Node.js, pnpm, FFmpeg, and `lottieconverter`.

### Testing

The fork includes an expanded smoke test suite covering the main functionality, including:

* WebM and TGS conversion,
* GIF generation and size handling,
* previews,
* sticker pack generation and versioning,
* caching,
* public/unlisted packs,
* Telegram authorization,
* invalid input handling.

Run the test suite with:

```bash
pnpm test
```

---

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
