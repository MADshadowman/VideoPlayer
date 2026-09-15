# Contributing

Thanks for your interest in contributing! This project is intentionally small and
zero-build, so most contributions are simple.

## Getting started

1. Fork the repository and clone your fork.
2. Serve the repo over HTTP:

   ```bash
   node tools/serve.mjs 8080
   ```

3. Open http://localhost:8080 and drop some video files into `videos/`.

That's it — no npm install, no build step.

## Ground rules

- **Zero-build, zero-dependency:** the runtime is plain HTML/CSS/JS modules plus
  the vendored `vendor/mediabunny.min.mjs`. Please don't add bundlers, npm
  dependencies, or frameworks.
- **Modern vanilla only:** ES modules, no transpilation. Target evergreen
  browsers.
- **Match the existing style:** 2-space indentation, double quotes, small
  functions. There's no linter yet — consistency is on you.
- **Keep the PHP API stable:** `videos.php` returns a documented JSON shape that
  both the player and external tools may rely on.

## Good first contributions

- Bug fixes in the MediaBunny fallback playback loop
- Accessibility improvements (keyboard, screen readers, focus states)
- Responsive/layout polish
- Documentation and translations

## Submitting changes

1. Create a feature branch.
2. Make your change.
3. Test manually with at least one natively supported file (MP4) and one
   fallback file (MKV) in Chrome and, ideally, Firefox.
4. Open a pull request with a short description and before/after notes where
   relevant.

## Reporting issues

Please include:

- Browser and OS version
- What you did and what happened instead
- Console errors, if any
- Whether the video plays with the native engine but not MediaBunny (Settings →
  Playback engine)
