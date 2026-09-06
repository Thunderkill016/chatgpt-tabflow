# TabFlow Capture Studio

## Goal

TabFlow includes a local-first screen recorder and screenshot workflow for capturing a monitor, window, or browser tab without uploading the recording to a remote service.

The product contract is **real source quality, not fake 4K**:

- `4K UHD` requests at most `3840×2160`.
- If Chrome provides a smaller source, TabFlow records the real source size and reports it in the UI.
- TabFlow does not canvas-upscale a 1080p source and label it 4K.
- `Native` keeps the source dimensions while still applying an FPS ceiling.

## Upstream references and adoption policy

TabFlow uses the standard Screen Capture API (`navigator.mediaDevices.getDisplayMedia`) from an extension-owned page. Chrome owns the user-visible source picker and capture permission. Media is encoded with `MediaRecorder`, and high-resolution sessions can stream 1-second chunks to a user-picked file through File System Access instead of accumulating one giant Blob in RAM.

`alyssaxuu/screenity` was inspected as a mature browser-recorder reference. TabFlow independently adopted platform patterns such as runtime codec negotiation, container/extension consistency, post-selection capture constraints and bounded chunks. Screenity is GPL-3.0; **no Screenity source code is copied into TabFlow**, which remains MIT.

## Master capture

- monitor / window / tab selection through Chrome's native picker;
- 4K, 1440p, 1080p and Native presets;
- 30 FPS and 60 FPS;
- MP4 preferred with WebM fallback;
- system/source audio and optional microphone mixing;
- pause / resume / stop;
- actual captured resolution, FPS, format and audio status;
- full-resolution PNG screenshots;
- direct-to-file chunk streaming for long 4K sessions;
- Chrome Downloads fallback and recent-video list;
- local-only data flow with no upload/fetch path.

## Social Ready

A high-quality Master file can be valid locally but outside a social uploader's ingest envelope. Capture Studio therefore has three output intents:

- **Master** — normal 4K/60 FPS controls.
- **Social Ready** — locks to `1080p`, `30 FPS`, MP4 and requires an explicit `H.264/AVC + AAC-LC` MediaRecorder MIME.
- **X Free** — same Social Ready encoding and auto-stops at `2:19`, one second before X's documented 140-second non-Premium limit.

The cross-platform target is deliberately conservative: `1920×1080`, `30 FPS`, H.264/AAC-LC MP4, roughly 5 Mbps video bitrate. For Facebook this is an interoperability preset, not a claim that TabFlow can predict every account/product-specific Meta ingest rule.

### X web envelope

At the September 2026 review, X's ordinary web uploader documents for non-Premium posts: 140 seconds, 512 MB, maximum landscape resolution 1920×1200 (portrait 1200×1900), aspect ratio 1:2.39 through 2.39:1, maximum 40 FPS and 25 Mbps. X Media Studio is a different upload surface and has different limits.

The post-record Social check evaluates what TabFlow can know locally: codec/container intent, dimensions, FPS, duration, file size and requested bitrate. It never uploads the file and does not claim account-specific acceptance.

## Automated gates

- `test/recorder-core.test.mjs` covers deterministic capture policy.
- `test/social-profile.test.mjs` covers strict H.264/AAC detection, 1080p30 Social/X Free policy, and X's upload envelope.
- `scripts/verify-recorder.mjs` rejects capture regressions including network upload paths.
- `test/recorder-browser-e2e.mjs` launches the unpacked extension in Chromium, validates Social Ready locks, and exercises real `MediaRecorder` when strict H.264/AAC MP4 is available.
