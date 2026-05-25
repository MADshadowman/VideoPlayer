# VideoPlayer

Personal web video library with a modern dark UI.

Open the page and it auto-loads videos from `videos/`.

## Zero-step mode (recommended)

This repo now includes `videos.php`.

- Put your files in `videos/`
- Open `index.html` (through your web server)
- The player fetches `videos.php`, which scans `videos/` automatically
- No Node command needed
- Check the top badge: it should say `Source: PHP auto-scan`

## Works on normal webspace

Most shared hosting supports PHP out of the box. In that case, this is fully automatic.

If the badge says `(... PHP failed)` or browser console shows `HTTP 500`:

1. Open `/videos.php` directly in browser.
2. If it fails, your host PHP version/config is the issue (not player JS).
3. Use `Open Folder` immediately as fallback, then fix hosting PHP.

If PHP is not available, the app falls back to:
1. `videos/videos.json` or `videos.json` manifest
2. Directory index parsing (`videos/`) if your host exposes directory listings
3. `Open Folder` button (client-side folder import)

## What you get

- Search
- Playlist/library with thumbnails and metadata
- Responsive layout
- Normal mode: list beside player
- Theater mode: list below player
- Playback controls: play/pause, prev/next, seek, volume/mute, fullscreen
- Settings: playback speed, fit mode, autoplay next, zoom
- Zoom + pan inside video
- Mini player (Picture-in-Picture where supported)
- Resume position per video
- Auto format selection by browser support
- Automatic MediaBunny-first metadata hydration (duration/resolution/codec) with native fallback
- Automatic thumbnail frame extraction for videos without poster images
- Thumbnail caching in IndexedDB (faster subsequent page loads on same device/browser)
- Engine badge showing `MediaBunny active (native output)` vs `Native fallback`

## Folder structure

```text
VideoPlayer/
  index.html
  styles.css
  app.js
  videos.php
  videos/
    your-video.mp4
    your-video.webm
    posters/
      your-video.jpg
```

Poster matching: `videos/posters/<video-basename>.jpg|jpeg|png|webp`

## Optional advanced mode

If you want richer precomputed metadata, you can still use:

```bash
node tools/generate-manifest.mjs
```

This is optional and no longer required for normal use.

MediaBunny is wired into runtime thumbnail extraction and metadata probing, with native browser fallback when needed.

## Format guidance

- Best compatibility: `MP4 (H.264 + AAC)`
- Optional extra quality/compression variant: `WebM`
- `.mov` is not reliable cross-browser for direct playback

## Notes

- Some features depend on browser support (PiP, MediaCapabilities details).
- Keyboard shortcuts:
  - `Space` play/pause
  - `ArrowLeft` / `ArrowRight` seek
  - `F` fullscreen
  - `T` theater mode
  - `N` / `P` next/previous
  - `/` focus search
