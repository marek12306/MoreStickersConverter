> [!IMPORTANT]
>
> ## About this fork
>
> This repository is a modified fork of the original **MoreStickersConverter** project.
>
> The fork significantly extends the upstream version with support for modern Telegram sticker formats, hosted and dynamically refreshable sticker packs, a public sticker pack catalog, access control, visibility management, improved caching and download reliability, and additional runtime and testing infrastructure.
>
> The original upstream README is preserved below for reference. Some instructions or descriptions in the upstream documentation may not fully reflect the behavior of this fork.

## Changes in this fork

### Telegram sticker format support

This fork expands Telegram sticker support beyond static WebP stickers:

* Static Telegram stickers are preserved as **WebP**.
* Telegram video stickers in **WebM** format are converted server-side to animated **GIF** files using FFmpeg.
* Telegram animated stickers in **TGS** format are converted server-side to animated **GIF** files using `lottieconverter`.
* GIF conversion uses multiple encoding profiles and adaptive compression to target approximately **5 MB** while keeping generated files below the **10 MB limit**.
* Animated stickers are marked as ready to upload in generated manifests.
* WebP previews are generated automatically for both static and animated stickers.

### Hosted sticker packs

Instead of sending the generated `.stickerpack` file directly through Telegram, the bot returns a URL to a hosted manifest:

```text
/stickerpack/telegram/<pack-name>
```

Sticker assets are hosted by the built-in HTTP server:

```text
/sticker/telegram/<pack-name>/<filename>
```

Generated previews are available through:

```text
/preview/telegram/<pack-name>/<sticker-id>.webp
```

Raw `.webm` and `.tgs` source files are not exposed as final sticker assets. Clients receive the converted `.gif` or original `.webp` files instead.

### Dynamic sticker packs

Generated manifests contain dynamic pack metadata that allows clients to retrieve updated versions of a sticker pack without importing a completely separate pack every time it changes.

This includes:

* automatic pack versioning,
* a `refreshUrl` pointing to the latest hosted manifest,
* version increments when sticker content changes,
* stable versions when regenerated content is unchanged.

Changes that can trigger a new version include:

* stickers being added or removed,
* sticker order changing,
* sticker IDs changing,
* sticker emoji or title changing.

Manifest writes are performed atomically and serialized per pack to reduce the risk of corrupted data when multiple requests operate on the same sticker pack.

### Public sticker pack catalog

The fork includes a built-in web interface available from:

```text
/
```

It provides a public browser for sticker packs marked as visible.

The catalog includes:

* sticker pack previews,
* sticker counts,
* pack search,
* sticker preview galleries,
* direct pack URL copying.

Public packs can also be queried through:

```text
GET /api/stickerpacks
```

The catalog is generated from the current stored pack metadata, so visibility changes do not require restarting the service.

### Public and unlisted packs

Imported sticker packs are **unlisted by default**.

Authorized users can control whether a pack appears in the public catalog with Telegram bot commands:

```text
/public <pack-name>
/unlisted <pack-name>
```

The commands can also be used by replying to a sticker belonging to the target pack.

An unlisted pack:

* does not appear in the public catalog,
* remains available through its direct sticker pack URL.

### Telegram user access control

Bot access can be restricted with:

```text
ALLOWED_TELEGRAM_USER_IDS
```

The value is a comma-separated list of Telegram user IDs allowed to:

* import sticker packs,
* use `/public`,
* use `/unlisted`.

Access control is deny-by-default. If `ALLOWED_TELEGRAM_USER_IDS` is empty or not configured, Telegram requests are ignored.

Example:

```env
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
```

### Parallel downloads

Sticker downloads can run concurrently.

The number of download workers is controlled by:

```text
CONCURRENCY
```

The default value is:

```text
5
```

Example:

```env
CONCURRENCY=8
```

The downloader also includes retry handling for failed Telegram file downloads and uses streaming pipelines with proper error propagation.

### Cache handling

The fork includes additional cache validation for previously generated sticker packs.

Legacy cached packs that still reference unsupported animated source formats such as WebM or TGS are automatically considered outdated and regenerated using the current GIF-based format.

Existing compatible WebP/GIF caches can continue to be reused.

### HTTP server improvements

The built-in HTTP server includes additional behavior required by hosted sticker packs and the public catalog:

* CORS support,
* appropriate MIME types,
* cache headers for served assets,
* stricter validation of pack names,
* stricter validation of sticker IDs and filenames,
* extension validation,
* protection against malformed paths and path traversal.

### Runtime requirements

This fork requires:

* **Node.js 20 or newer**
* **FFmpeg**
* **lottieconverter**

The provided Docker image includes the required conversion tools.

The Docker build environment uses **Node.js 22**.

### Docker changes

The Docker image additionally includes:

* FFmpeg,
* `lottieconverter`,
* the public catalog frontend,
* a build-time smoke test.

Docker or Docker Compose is therefore the recommended deployment method if animated Telegram sticker conversion is required.

### Development environment

A Nix flake is included for reproducible local development with the required tools, including:

* Node.js 22,
* pnpm,
* FFmpeg,
* `lottieconverter`.

### Testing

The fork includes an expanded smoke test suite.

Running:

```bash
pnpm test
```

builds the project and executes tests covering areas such as:

* WebM conversion,
* TGS conversion,
* GIF size handling,
* preview generation,
* manifest generation,
* dynamic versioning,
* cache behavior,
* HTTP endpoints,
* CORS,
* pack visibility,
* Telegram authorization,
* malformed request handling.

---

## Upstream README

The original project documentation follows below.

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
