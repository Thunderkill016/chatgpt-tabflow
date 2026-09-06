# TabFlow Capture Studio

TabFlow includes a local-first screen recorder and screenshot workflow for capturing a monitor, window, or browser tab without uploading the recording to a remote service.

## Capture contract

- 4K requests at most 3840×2160 and never fake-upscale a smaller source.
- Master mode keeps 4K/1440p/1080p/Native and 30/60 FPS controls.
- MP4 is preferred when supported; Master can fall back to WebM.
- System/source audio and optional microphone can be mixed.
- Pause/resume/stop, PNG screenshot, direct-to-file chunk streaming and Chrome Downloads are supported.
- Capture remains local-only and has no network upload path.

## Social Ready

A valid high-quality Master file can still fall outside a social uploader's ingest envelope. Capture Studio therefore has:

- **Master** — normal high-quality capture controls.
- **Social Ready** — locks to 1080p30 MP4 and requires explicit H.264/AVC + AAC-LC support.
- **X Free** — same Social Ready encoding and auto-stops at 2:19, one second before X's documented 140-second non-Premium limit.

The conservative cross-platform target is 1920×1080, 30 FPS, H.264/AAC-LC MP4 at roughly 5 Mbps. For Facebook this is an interoperability preset, not a promise about every Meta account/product-specific ingest path.

At the September 2026 review, X's ordinary web uploader documents for non-Premium posts: 140 seconds, 512 MB, maximum landscape resolution 1920×1200 (portrait 1200×1900), aspect ratio 1:2.39 through 2.39:1, maximum 40 FPS and 25 Mbps. X Media Studio is a different upload surface with different limits.

The post-record Social check evaluates codec/container intent, dimensions, FPS, duration, file size and requested bitrate locally; it never uploads the file.

## Upstream and license policy

Screenity was inspected as a mature recorder reference for platform-level patterns such as runtime codec negotiation, post-selection constraints and bounded chunks. Screenity is GPL-3.0; no Screenity source code is copied into TabFlow, which remains MIT.

## Automated gates

- `test/recorder-core.test.mjs`
- `test/social-profile.test.mjs`
- `scripts/verify-recorder.mjs`
- `test/recorder-browser-e2e.mjs`
