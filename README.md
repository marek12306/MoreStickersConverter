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
* Video stickers in **WebM** format are converted to animated **AVIF** (AV1 with preserved alpha transparency, 10-bit color, max 160x160, max 3 seconds, hard 5 MiB limit):
  * Source frame rate is detected using `ffprobe` (preferring `avg_frame_rate`, falling back to `r_frame_rate`).
  * Output frame rate is capped at `min(source FPS, 30)` and is never artificially upsampled above the source frame rate (e.g. 60 FPS -> max 30, 30 FPS -> max 30, 29.97 FPS -> max 29.97, 25 FPS -> max 25, 24 FPS -> max 24, 15 FPS -> max 15).
  * Dynamic fallback FPS candidates are built from `30 -> 24 -> 20 -> 16`, using only rungs strictly below the effective source/cap rate. The highest FPS candidate is tried across multiple quality profiles before lower-FPS fallback candidates are attempted.
* Animated **TGS** stickers are rendered to lossless PNG frames using `lottieconverter` and encoded as animated **AVIF**:
  * Original Lottie timeline frame rate (`fr`) is preserved during normalization.
  * Rendered via `lottieconverter` at `min(60, floor(source FPS))` integer FPS (capped at 60 fps max, without upsampling above source, e.g. 120 FPS -> render max 60, 60 FPS -> 60, 50 FPS -> 50, 30 FPS -> 30, 29.6 FPS -> render 29 with 29.6 timeline, 12 FPS -> 12).
  * Dynamic fallback ladder uses filtered rungs from `60 -> 48 -> 30 -> 24 -> 20 -> 16` fps.
* **Frame rate compatibility**: Candidate and output FPS never exceed the source frame rate. Missing or invalid FPS metadata uses a compatibility fallback of 24 FPS. Valid frame rates in `0 < FPS < 1` are explicitly unsupported because the constant-frame-rate animated AVIF pipeline cannot preserve such rates within the 3-second duration limit.
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

#### Progressive loading and performance
* **Preview-first rendering**: Animated pack cards and animated stickers initially display lightweight static **WebP preview** images; heavy animated AVIF/GIF files are not loaded upfront.
* **Hover-activated animations**: Animated assets are fetched on first hover and play while hovered, returning to static previews on mouse leave.
* **Viewport-proximity quality loading**: Static stickers and full-resolution previews load high-quality assets via `IntersectionObserver` when scrolling near the viewport (`rootMargin: 200px`).
* **On-demand manifest retrieval**: Sticker pack manifests and full galleries are fetched on demand when opening a pack drawer, rather than loading all manifests upfront.
* Standard image lazy loading (`loading="lazy"`) is used across the catalog.

### Telegram bot commands

Authorized users can manage and inspect sticker packs using the following bot commands:

```text
/pack <pack-name>          Import or get a hosted sticker pack
/refresh <pack-name>       Refresh a single pack from Telegram
/refresh_all               Refresh all local sticker packs from Telegram sequentially
/refresh_all_cancel        Request cooperative cancellation of the current bulk refresh
/check <pack-name>         Check whether a local pack is up to date with Telegram
/info <pack-name>          Show information about a pack
/public <pack-name>        Add a pack to the public catalog
/unlisted <pack-name>      Remove a pack from the public catalog
/stats                     Show local library statistics
/status                    Show runtime, work, storage, refresh and GC diagnostics
/gc [retention]            Run storage garbage collection, optionally keeping only the newest N versions
/gc_dry                    Preview garbage collection without deleting files
/gc_stats                  Show storage garbage collection statistics
```

Pack-specific commands (`/pack`, `/refresh`, `/check`, `/info`, `/public`, `/unlisted`) can be used either with an explicit pack name (e.g. `/info MyPack`) or by replying to a sticker from that pack.

#### `/refresh`
Refreshes a single sticker pack from Telegram. It re-downloads the source stickers from Telegram, runs the current conversion pipeline (WebM/TGS -> animated AVIF, WebP previews), writes to content-addressed storage, and publishes a new version if changes are detected. This is also the recommended way to upgrade historical GIF packs to AVIF without lossy GIF-to-AVIF re-encoding, since it re-fetches the original source from Telegram.

#### `/refresh_all`
An administrative command that reads all locally known sticker packs from local manifests and refreshes them sequentially (`pack-level concurrency = 1`) using the exact same core pipeline as `/refresh`.
* Refreshes run one pack at a time; an error in one pack does not stop processing of the remaining packs.
* When finished, it replies with a summary showing total, successful, and failed packs.
* Concurrent `/refresh_all` invocations are rejected with `Refresh all is already running.`.
* Progress is maintained process-local and can be monitored via `/status` (showing processed/total, current pack, successful, failed, cancel requested, and elapsed time).
* Once finished, the result is recorded in a process-local summary with one of three outcomes: `completed`, `cancelled`, or `failed`.
* Individual `/refresh` commands are not globally blocked by `/refresh_all`, as per-pack queues safely isolate operations on the same pack.
* It is the recommended way to migrate all historical GIF packs to the current AVIF pipeline by re-downloading sources from Telegram.

#### `/refresh_all_cancel`
Requests cooperative cancellation of an active `/refresh_all` operation:
* It stops processing between packs: the currently active pack is not killed mid-download or mid-conversion and finishes its full publication cycle normally.
* Processing halts before starting the next pack in the queue.
* Multiple cancellation requests are handled idempotently.
* If `/refresh_all` is not running, the bot responds that there is no active bulk refresh to cancel.

#### `/status`
Returns a comprehensive read-only snapshot of runtime health, work queues, storage diagnostics, bulk refresh state, and garbage collection:

* **Runtime diagnostics**:
  * Status: `OK` or `DEGRADED` (degraded if `DATA_DIR` is inaccessible or `EXTERNAL_URL` is not configured).
  * Uptime, Node.js version (`process.version`), FFmpeg availability/version (via lightweight `ffmpeg -version` probe), `lottieconverter` availability (via lightweight probe), download worker concurrency (`CONCURRENCY`), data directory access check (`OK`/`Inaccessible`), and external URL configuration status (`configured`/`missing`).
  * Tool diagnostics (FFmpeg, lottieconverter) are cached process-local with a **5-minute TTL**.
* **Work diagnostics**:
  * `Active downloads`: Number of currently running Telegram sticker download operations (process-local counter).
  * `Active encodes`: Number of logical animated conversion jobs in progress (process-local counter; a single sticker conversion across multiple profile fallback attempts counts as 1 active encode).
  * `Queue length`: Total number of sticker jobs waiting in active download queues (excluding jobs already acquired by download workers).
  * *Note*: `Active encodes` is a diagnostic metric, not a separate concurrency limit; download concurrency is governed by `CONCURRENCY`.
* **Storage diagnostics**:
  * `Storage size`: Read-only snapshot of total bytes stored in `DATA_DIR`, formatted in binary units (B, KiB, MiB, GiB, TiB). Strictly read-only: does not create `DATA_DIR` if missing (reporting `0 B`). If an unexpected read error occurs (such as permission or I/O failure), reports `unavailable` rather than an understated partial sum.
  * `Legacy GIF packs`: Count of sticker *packs* that still reference legacy GIF assets in their active version retention history (`last 5 versions`). Stale GIF assets outside the retention window are not counted. If index/manifest scanning encounters unreadable files or corruption, reports `unavailable` to avoid displaying an inaccurate partial count.
  * Storage diagnostics are cached process-local with a **60-second TTL**.
* **Refresh all diagnostics**: Shows current status (idle or running with progress, current pack, counts, and elapsed time) and the outcome of the last run (`completed`, `cancelled` with refreshed/failed/skipped counts, or `failed`).
* **Garbage collection diagnostics**: Shows current GC status (idle or running with mode, retention, and elapsed time) and the summary of the last run across all execution modes (mode, retention, outcome, error count, and bytes freed for `apply` mode).
* **Fail-soft & process-local semantics**: `/status` is strictly read-only and never performs repair or cleanup actions. If an individual probe fails (e.g. FFmpeg unavailable or storage unreadable), the remaining sections still render without crashing. Counters, queue lengths, tool cache, and lifecycle summaries are process-local (not aggregated across multiple container replicas).

Example output:
```text
MoreStickersConverter status

Runtime
Status: OK
Uptime: 2h 4m
Node.js: v22.x.x
FFmpeg: 7.x
lottieconverter: available
Download concurrency: 5
Data directory: OK
External URL: configured

Work
Active downloads: 2
Active encodes: 1
Queue length: 4

Storage
Storage size: 3.74 GiB
Legacy GIF packs: 2

Refresh all: idle
Last run: 18m ago
Result: 121 refreshed, 2 failed

Garbage collection: idle
Last run: 2h ago
Mode: apply
Retention: 5
Result: success with 0 errors
Freed: 186.4 MiB
```

#### `/gc [retention]`
Manually triggers real storage garbage collection:
* **Default retention**: Running `/gc` without arguments uses the standard retention policy (`STICKER_PACK_VERSION_RETENTION`, currently keeping the **last 5 version indexes** per pack).
* **Custom retention override**: Running `/gc <retention>` (e.g. `/gc 1`, `/gc 2`) performs a one-shot manual GC retaining only up to the specified number of newest published versions per pack and pruning older generations.
  * Similar to keeping only the newest N Nix generations, `/gc N` keeps the newest N published sticker-pack versions and prunes older versions that fall outside the retention window.
  * Examples:
    * `/gc 1` keeps only the single newest published version per pack (e.g. for versions 1..5, keeps 5 and prunes 1..4).
    * `/gc 2` keeps the two newest published versions per pack (e.g. for versions 1..5, keeps 4 and 5).
    * `/gc 5` is equivalent to the default retention window.
  * **One-shot override**: The numeric argument is a one-shot manual retention override for that specific run. It does not alter `STICKER_PACK_VERSION_RETENTION`, background GC, normal publication pruning, or future `/gc` runs without an argument.
  * **Strict argument validation**: The retention argument must be a positive integer $\ge 1$ (`/^[1-9]\d*$/`, safe integer). Invalid arguments such as `/gc 0`, `/gc -1`, `/gc 1.5`, `/gc abc`, or multiple arguments are rejected immediately without performing any file mutations or recording a failed GC run.
* Prunes stale version indexes eligible for cleanup under the active retention window.
* Deletes orphaned / unreferenced CAS assets only after stale version indexes are safely deleted.
* Preserves all assets referenced by any retained version index for that pack (a CAS blob shared by multiple retained versions is kept as long as at least one retained version references it).
* Preserves valid pending recovery indexes (`currentVersion + 1`).
* Synchronized with sticker pack publication through the per-pack storage mutation lock.
* Concurrent GC operations within the same process are rejected with `Garbage collection is already running.`.

Example output:
```text
Garbage collection finished.

Retention: 2 versions
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
* **Process-local concurrency**: GC guards and per-pack storage mutation locks are **process-local**. They synchronize GC with concurrent storage mutations and pack publications within the same Node.js process (without locking during network downloads), but do not provide distributed locking across multiple container replicas sharing the same `DATA_DIR`.
* **Periodic background GC**: Background GC runs automatically on startup after migrations, and periodically every **5 hours** (`STICKER_STORAGE_GC_INTERVAL_MS`). Every background execution updates the unified `last GC` summary reported in `/status`.
* **`/status` reporting**: Real-time GC state and the last completed GC summary are visible via the `/status` command.

### Telegram access control

Bot access can be limited with:

```text
ALLOWED_TELEGRAM_USER_IDS
```

Only allowlisted Telegram users can import stickers by sending them to the bot or use bot management and diagnostic commands (`/pack`, `/refresh`, `/refresh_all`, `/refresh_all_cancel`, `/check`, `/info`, `/stats`, `/status`, `/gc`, `/gc_dry`, `/gc_stats`, `/public`, `/unlisted`).

Example:

```env
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
```

If the allowlist is empty or not configured, all incoming Telegram messages and commands are ignored.

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

### Startup migration, routing compatibility, and caching

On startup, the server automatically inspects local sticker packs and performs failure-safe startup migrations:
* **Raw upstream WebM/TGS**: If a local manifest references raw `.webm` or `.tgs` assets from upstream MoreStickersConverter, the startup migration converts them to animated AVIF, generates WebP previews, stores assets in CAS, creates version index 1, and atomically publishes the new manifest before cleaning up raw working files (retaining original sources if conversion fails).
* **Static WebP without previews**: For older packs with static `.webp` stickers and missing preview files, the missing WebP previews are generated automatically before publishing the pack to CAS version 1.
* **Historical GIF packs**: Historical GIF packs from earlier fork versions remain fully compatible and are served as-is (they are not converted at startup). To migrate them to AVIF, run `/refresh <pack-name>` or `/refresh_all` to re-download the original WebM/TGS sources from Telegram.
* **Background GC scheduling**: The server automatically schedules periodic background garbage collection every 5 hours upon startup.

#### Legacy URL routing compatibility
To maintain backward compatibility with links generated before migration:
* **Versionless WebM/TGS URLs** (`/sticker/telegram/:pack/A.webm`, `/sticker/telegram/:pack/A.tgs`): Automatically resolve to the current `.avif` asset.
* **Versionless GIF URLs and aliases** (`/sticker/telegram/:pack/A.gif`, `/sticker/telegram/:pack/A-160.gif`): Automatically resolve to the current `.avif` asset if no exact GIF file exists in the active version.
* **Strict versioned routing**: Cross-extension compatibility fallbacks apply exclusively to unversioned legacy routes. Versioned routes (`/sticker/telegram/:pack/:version/:filename`) use strict exact-match resolution and remain available only while that version is retained.

#### HTTP cache policy
* **Versionless / legacy asset URLs** (`/sticker/telegram/:pack/:filename`, `/preview/telegram/:pack/:filename`): `Cache-Control: public, max-age=300` (5 minutes).
* **Versioned asset URLs** (`/sticker/telegram/:pack/:version/:filename`, `/preview/telegram/:pack/:version/:filename`): `Cache-Control: public, max-age=604800` (7 days).
* Binary asset HTTP responses do not use `immutable`. Since retention keeps the last 5 versions in storage, versioned URLs are not permanent archives.

#### Conditional JSON caching
* The hosted manifest endpoint (`/stickerpack/telegram/:stickerPackName`) and public catalog API (`/api/stickerpacks`) return `Cache-Control: no-cache` along with a deterministic, SHA-256-based `ETag`.
* Full `If-None-Match` conditional request support is provided: clients sending a matching entity tag (including exact tags, weak `W/` tags, comma-separated tag lists, or `*`) receive a `304 Not Modified` response without a response body.
* Malformed `If-None-Match` headers fail-safe to a standard `200 OK` response without errors.
* The `ETag` header is exposed to browser clients via CORS (`Access-Control-Expose-Headers: ETag`).

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

* Source-aware WebM conversion to animated AVIF (up to 30 fps cap, no upsampling, rational 29.97 parsing, dynamic fallback ladder `30 -> 24 -> 20 -> 16` fps, 10-bit yuv420p10le color + gray10le alpha, <= 3 s / <= 5 MiB / 160x160 constraints, candidate cleanup),
* Source-aware TGS Lottie rendering and conversion (`lottieconverter` at `min(60, floor(source FPS))` integer fps, timeline preservation, ladder `60 -> 48 -> 30 -> 24 -> 20 -> 16` fps, zip-bomb / frame-count limits),
* Invalid and unsupported FPS edge cases (24 fps fallback for missing/invalid metadata, rejection of `0 < FPS < 1`),
* Static WebP handling and WebP preview generation (with premultiply/unpremultiply alpha scaling),
* Legacy GIF asset compatibility and unversioned URL routing fallbacks (`.webm`/`.tgs`/`.gif`/`-160.gif` -> `.avif`),
* Startup migration for raw upstream WebM/TGS and static WebP packs without previews, and 5-hour background GC scheduling,
* `/refresh` and `/refresh_all` lifecycle (sequential execution, per-pack locking, cooperative cancellation via `/refresh_all_cancel`, summary reporting, outcome recording),
* Dynamic version lifecycle, pack-title version bump, and content-addressed storage (CAS) retention / GC (last 5 versions),
* Storage garbage collection and administrative commands (`/gc [retention]`, `/gc_dry`, `/gc_stats`, custom retention `/gc 1`, `/gc 2`, `/gc 10`, rejection of `/gc 0` and invalid args, dry-run / stats read-only safety, shared CAS blob retention, deletion failure safety, publication lock synchronization),
* `/status` diagnostics (FFmpeg and lottieconverter probes with 5-minute TTL cache, active download / encode counters, queue length tracking, storage size scanner with 60-second TTL cache and `unavailable` on read errors, legacy GIF pack count with fail-soft `unavailable` reporting on partial/corrupt legacy GIF scans, fail-soft rendering),
* HTTP endpoints, CORS headers, `ETag` generation, `If-None-Match` matching (exact, weak, list, wildcard, RFC 9110 fail-safe), 304 conditional responses, and binary asset caching (`max-age=300` for legacy, `max-age=604800` for versioned without `immutable`),
* Public catalog web interface and progressive loading behavior (WebP preview first, hover-activated animations, viewport proximity loading),
* Telegram authorization allowlist (`ALLOWED_TELEGRAM_USER_IDS`) for sticker imports and all bot management/diagnostic commands,
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
