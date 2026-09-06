# TabFlow Capture Studio

TabFlow Capture Studio is a local-first screen recorder and screenshot workflow for monitor, window, or browser-tab capture.

## Master
- Real source quality; 4K requests max 3840×2160 and never fake-upscale smaller sources.
- 4K/1440p/1080p/Native, 30/60 FPS.
- MP4 preferred with WebM fallback.
- System/source audio + optional mic mixing.
- Pause/resume/stop, PNG screenshot, direct-to-file 1s chunks, Chrome Downloads.

## Social Ready
- **Social Ready:** 1080p30 MP4; strict H.264/AVC + AAC-LC preflight.
- **X Free:** same encoding and auto-stop at 2:19.
- Post-record social check validates locally knowable codec/container intent, dimensions, FPS, duration, size and requested bitrate.
- No upload path.

At the September 2026 review, X's ordinary non-Premium web uploader documents 140 seconds, 512 MB, max 1920×1200 landscape / 1200×1900 portrait, 1:2.39–2.39:1 aspect ratio, 40 FPS and 25 Mbps. X Media Studio is a separate surface with different limits.

Facebook uses the same conservative 1080p30 H.264/AAC interoperability preset; TabFlow does not claim to predict every Meta account/product ingest rule.

## Upstream policy
Screenity was inspected for general browser-recorder patterns. It is GPL-3.0; no Screenity source code is copied into this MIT project.

## Gates
- `test/recorder-core.test.mjs`
- `test/social-profile.test.mjs`
- `scripts/verify-recorder.mjs`
- `test/recorder-browser-e2e.mjs`
