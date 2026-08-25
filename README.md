> [!IMPORTANT]
>
> This repository is a modified fork of the original **MoreStickersConverter** project.
>
> The original upstream README is preserved below for reference, so some parts may not fully reflect the behavior of this fork.
>
> Also, this project was vibecoded.

## Changes in this fork

### Better Telegram sticker support

The fork supports all common Telegram sticker formats:

* Static **WebP** stickers are preserved as-is.
* Video stickers in **WebM** format are converted to animated **AVIF** (AV1 with preserved alpha transparency, 10-bit color, up to 160x160, up to 24 fps with lower-FPS fallback profiles, max 3 seconds, hard 5 MiB limit).
* Animated **TGS** stickers are rendered to frames using `lottieconverter` and encoded as animated **AVIF**.
* New animated stickers are encoded exclusively as animated AVIF; historical GIF assets from older versions remain supported for backward compatibility.
* Previews are generated automatically as **WebP** for both static and animated stickers.

### Hosted and refreshable sticker packs

Sticker packs are hosted by the converter instead of being sent as `.stickerpack` files directly through Telegram. The bot returns a URL to the hosted sticker pack manifest (`/stickerpack/telegram/<pack-name>`).

Generated packs support automatic content-addressed storage (CAS) and versioning:
* The initial pack is published as **version 1**.
* A new version is created whenever stickers are added, removed, reordered, or modified (content hash, emoji, or title), or when the pack title changes.
* If nothing changed (or during an identical refresh), the existing version is retained without an unnecessary version bump.
* Storage retention keeps the **last 5 version indexes** per pack; older versions and unreferenced assets are pruned automatically by background garbage collection. Versioned URLs are therefore not permanent archives.

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

### Telegram bot commands

Authorized users can manage and inspect sticker packs using the following bot commands:

```text
/pack <pack-name>       Import or get a hosted sticker pack
/refresh <pack-name>    Refresh a single pack from Telegram
/refresh_all            Refresh all local sticker packs from Telegram sequentially
/check <pack-name>      Check whether a local pack is up to date with Telegram
/info <pack-name>       Show information about a pack
/public <pack-name>     Add a pack to the public catalog
/unlisted <pack-name>   Remove a pack from the public catalog
/stats                  Show local library statistics
/status                 Show converter and garbage collection status
/gc                     Run storage garbage collection
/gc_dry                 Preview garbage collection without deleting files
/gc_stats               Show storage garbage collection statistics
```

Pack-specific commands (`/pack`, `/refresh`, `/check`, `/info`, `/public`, `/unlisted`) can be used either with an explicit pack name (e.g. `/info MyPack`) or by replying to a sticker from that pack.

#### `/refresh`
Refreshes a single sticker pack from Telegram. It re-downloads the source stickers from Telegram, runs the current conversion pipeline (WebM/TGS -> animated AVIF, WebP previews), writes to content-addressed storage, and publishes a new version if changes are detected. This is also the recommended way to upgrade historical GIF packs to AVIF without lossy GIF-to-AVIF re-encoding, since it re-fetches the original source from Telegram.

#### `/refresh_all`
An administrative command that reads all locally known sticker packs from local manifests and refreshes them sequentially (`pack-level concurrency = 1`) using the exact same core pipeline as `/refresh`.
* Refreshes run one pack at a time; an error in one pack does not stop processing of the remaining packs.
* When finished, it replies with a summary showing total, successful, and failed packs.
* Concurrent `/refresh_all` invocations are rejected with `Refresh all is already running.`.
* Individual `/refresh` commands are not globally blocked by `/refresh_all`, as per-pack queues safely isolate operations on the same pack.
* It is the recommended way to migrate all historical GIF packs to the current AVIF pipeline by re-downloading sources from Telegram.

#### `/gc`
Manually triggers real storage garbage collection using the exact same core engine and retention policy as the background GC (it does not replace or disable the periodic background GC):
* Applies the retention policy: keeps the **last 5 version indexes** per pack.
* Prunes stale version indexes eligible for cleanup.
* Deletes orphaned / unreferenced CAS assets.
* Preserves all assets referenced by any retained version index for that pack (a CAS blob shared by multiple retained versions is kept as long as at least one retained version references it).
* Synchronized with sticker pack publication through the per-pack storage mutation lock.
* Concurrent GC operations within the same process are rejected with `Garbage collection is already running.`.

Example output:
```text
Garbage collection finished.

Removed version indexes: 18
Removed orphaned assets: 42
Freed: 186.4 MiB

Remaining CAS assets: 1247
Duration: 1.8 s
```

#### `/gc_dry`
Performs a **strict read-only dry run** of storage garbage collection:
* Analyzes the exact same storage and applies the exact same retention policy as `/gc`.
* Reports how many version indexes and orphaned assets would be removed, and estimated space to be freed (`Would free: ...`).
* Modifies no files, manifests, or version indexes.
* Strictly read-only: does not create `DATA_DIR` if the directory does not exist.
* Recommended way to preview planned cleanup before running `/gc`.

Example output:
```text
Garbage collection dry run.

Would remove version indexes: 18
Would remove orphaned assets: 42
Would free: 186.4 MiB

No files were deleted.
```

#### `/gc_stats`
Returns a **read-only statistical snapshot** of storage and GC metrics without modifying any files:
* Reports total sticker packs, total version indexes, total CAS assets count and byte size, referenced assets count and size, orphaned assets count and size, prunable version indexes, estimated reclaimable space, and active retention policy (`last 5 versions`).
* Does not create `DATA_DIR` if missing.

Example output:
```text
Storage GC statistics

Sticker packs: 124
Version indexes: 531

CAS assets: 4821
CAS size: 3.74 GiB

Referenced assets: 4630
Referenced size: 3.51 GiB

Orphaned assets: 191
Orphaned size: 231.4 MiB

Prunable version indexes: 27
Estimated reclaimable: 238.2 MiB

Retention: last 5 versions
```

#### Garbage collection safety and concurrency
* **Conservative fail-safe design**: All three GC modes report `Errors: N` if any sticker pack or version index cannot be safely analyzed or cleaned. When storage state cannot be safely validated (such as a corrupted manifest or an unreadable index), potentially required data is retained rather than deleted. If removing a stale version index fails, orphaned asset deletion for that pack is skipped to prevent leaving valid indexes without their corresponding blobs.
* **Process-local concurrency**: GC guards and per-pack storage mutation locks are **process-local**. They prevent race conditions between GC and concurrent pack downloads or publications within the same Node.js process, but do not provide distributed locking across multiple container replicas sharing the same `DATA_DIR`.
* **`/status` reporting**: The `/status` command displays the current state of garbage collection:
  * Idle: `Garbage collection: idle`
  * Running:
    ```text
    Garbage collection: running
    Mode: apply
    Elapsed: 12s
    ```
    (where `Mode` reflects `apply`, `dry-run`, or `stats`).

### Telegram access control

Bot access can be limited with:

```text
ALLOWED_TELEGRAM_USER_IDS
```

Only listed Telegram users can import packs, trigger refreshes (`/refresh`, `/refresh_all`), run garbage collection (`/gc`, `/gc_dry`, `/gc_stats`), or manage visibility (`/public`, `/unlisted`).

Example:

```env
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
```

If the allowlist is empty or not configured, Telegram requests are ignored.

### Faster and more reliable downloads

Sticker downloads within a pack run in parallel, with worker concurrency controlled by:

```text
CONCURRENCY
```

The default is `5`.

Example:

```env
CONCURRENCY=8
```

Failed Telegram downloads are retried automatically, and download handling has been improved to avoid incomplete or corrupted files.

### Startup migration and caching

On startup, the server automatically inspects local sticker packs and performs failure-safe startup migrations:
* **Raw upstream WebM/TGS**: If a local manifest references raw `.webm` or `.tgs` assets from upstream MoreStickersConverter, the startup migration converts them to animated AVIF, generates WebP previews, stores assets in CAS, creates version index 1, and atomically publishes the new manifest before cleaning up raw working files (retaining original sources if conversion fails).
* **Static WebP without previews**: For older packs with static `.webp` stickers and missing preview files, the missing WebP previews are generated automatically before publishing the pack to CAS version 1.
* **Historical GIF packs**: Historical GIF packs from earlier fork versions remain fully compatible and are served as-is (they are not converted at startup). To migrate them to AVIF, run `/refresh <pack-name>` or `/refresh_all` to re-download the original WebM/TGS sources from Telegram.

#### HTTP cache policy
* **Versionless / legacy URLs** (`/sticker/telegram/:pack/:filename`, `/preview/telegram/:pack/:filename`): `Cache-Control: public, max-age=300` (5 minutes).
* **Versioned URLs** (`/sticker/telegram/:pack/:version/:filename`, `/preview/telegram/:pack/:version/:filename`): `Cache-Control: public, max-age=604800` (7 days).
* HTTP responses do not use `immutable`. Since retention keeps the last 5 versions in storage, versioned URLs are not permanent.

### Safer and more robust server

The built-in server has been improved with better request validation, safer file handling, correct asset metadata, caching support, and protection against malformed paths.

### Docker and runtime

This fork requires:

* **Node.js 20 or newer**
* **FFmpeg** (with `libaom-av1` support)
* **lottieconverter** (for rendering animated TGS stickers)

The provided Docker image includes a supported Node.js runtime and the required FFmpeg / `lottieconverter` tools.

A Nix development environment is also available with Node.js, pnpm, FFmpeg, and `lottieconverter`.

### Testing

The fork includes a comprehensive smoke test suite covering:

* WebM and TGS conversion to animated AVIF (alpha preservation, 160x160 / up to 24 fps / <= 3 s / <= 5 MiB constraints),
* Quality ladder profile fallback and temporary file cleanup,
* Static WebP handling and WebP preview generation,
* Legacy GIF asset compatibility and unversioned GIF-to-AVIF routing fallback,
* Startup migration for raw upstream WebM/TGS and static WebP packs without previews,
* `/refresh` and `/refresh_all` (sequential execution, concurrent guard, error isolation, summary reporting),
* Dynamic version lifecycle, pack-title version bump, and content-addressed storage (CAS) retention / GC (last 5 versions),
* Storage garbage collection and administrative commands (`/gc`, `/gc_dry`, `/gc_stats`, dry-run / stats read-only safety, error reporting, publication lock synchronization),
* HTTP endpoints, CORS headers, and cache policies (`max-age=300` for legacy, `max-age=604800` for versioned),
* Public catalog and `/public` / `/unlisted` visibility commands,
* Telegram authorization allowlist,
* Malformed input handling, path traversal protection, atomic file operations, per-pack serialization, and worker-drain safety.

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
* Server-side conversion of Telegram WebM video stickers and Telegram TGS stickers to final animated AVIF (AV1, 10-bit color, preserved alpha), with a quality ladder and a hard 5 MiB limit
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

* **Animated stickers & runtime tools**: Telegram WebM stickers are converted server-side to animated AVIF with FFmpeg/libaom-av1. Telegram TGS stickers are rendered by `lottieconverter` to lossless PNG frames before FFmpeg encodes AVIF. Both tools are required runtime dependencies and included in the Docker image; historical GIF assets remain served for compatibility.
* Since stickerpacks rely on externally hosted images, make sure your server's external URL is reachable.
* If using a reverse proxy, ensure that HTTPS is properly configured to avoid client-side loading errors.
