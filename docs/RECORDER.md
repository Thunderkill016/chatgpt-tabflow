# TabFlow Capture Studio

## Goal

TabFlow includes a local-first screen recorder and screenshot workflow for capturing a monitor, window, or browser tab without uploading the recording to a remote service.

The product contract is **real source quality, not fake 4K**:

- `4K UHD` requests at most `3840×2160`.
- If Chrome provides a smaller source, TabFlow records the real source size and reports it in the UI.
- TabFlow does not canvas-upscale a 1080p source and label it 4K.
- `Native` keeps the source dimensions while still applying an FPS ceiling.

## Upstream references and adoption policy

### Chrome / Web Platform

The implementation uses the standard Screen Capture API (`navigator.mediaDevices.getDisplayMedia`) from a dedicated extension page. Chrome remains responsible for the user-visible source picker and capture permission.

Media is encoded with `MediaRecorder`. The implementation probes `MediaRecorder.isTypeSupported()` and prefers MP4 when the running Chrome can actually construct/start that recorder; otherwise it falls back to WebM for Master capture.

For long high-resolution recordings, the preferred path is File System Access: a user explicitly picks the output file, then `MediaRecorder` chunks are written through `FileSystemWritableFileStream` instead of accumulating one giant final Blob in RAM.

Chrome Downloads is used for the fallback export, screenshots, and the recent-downloads list.

### Screenity

`alyssaxuu/screenity` was inspected because it is a mature open-source browser recorder. Useful design lessons adopted independently:

- negotiate the recorder container at runtime instead of assuming a codec;
- keep file extension/container consistent with the chosen MIME type;
- apply capture-resolution constraints after the user selects the source;
- emit bounded recorder chunks rather than waiting for one huge final Blob;
- make high-resolution recording robust against browser/hardware capability differences.

Screenity is GPL-3.0. **No Screenity source code is copied into TabFlow.** TabFlow remains MIT and implements these platform patterns independently.

## Features

- monitor / window / tab selection through Chrome's native picker;
- 4K, 1440p, 1080p and Native presets;
- 30 FPS and 60 FPS in Master mode;
- MP4 preferred with WebM fallback in Master mode;
- system/source audio request;
- optional microphone capture and audio mixing;
- pause / resume / stop;
- actual captured resolution, FPS, format and audio status;
- full-resolution PNG screenshot;
- direct-to-file chunk streaming for long 4K sessions;
- Chrome Downloads fallback and recent-video list;
- local-only design: recorder code contains no upload/fetch path.

## Social Ready

Master recordings optimize for source quality, not for social-platform ingest. A 4K60 WebM or a long 4K MP4 can therefore be a valid local recording while still being rejected by a social uploader.

Capture Studio has three output intents:

- **Master** — normal 4K/60 FPS controls.
- **Social Ready** — locks to `1080p`, `30 FPS`, MP4 and requires an explicit `H.264/AVC + AAC-LC` MediaRecorder MIME.
- **X Free** — same Social Ready encoding and auto-stops at `2:19`, one second before X's documented 140-second non-Premium limit.

The cross-platform target is deliberately conservative: `1920×1080`, `30 FPS`, H.264/AAC-LC MP4, roughly 5 Mbps video bitrate. For Facebook this is an interoperability preset, not a claim that TabFlow can predict every account/product-specific Meta ingest rule.

### X web limits

At the September 2026 implementation review, X's standard web-upload documentation lists for non-Premium posts:

- maximum duration: `140 seconds`;
- maximum file size: `512 MB`;
- maximum landscape resolution: `1920×1200` (portrait `1200×1900`);
- aspect ratio: `1:2.39` through `2.39:1`;
- maximum frame rate: `40 FPS`;
- maximum bitrate: `25 Mbps`.

This is why Social Ready uses **30 FPS**, not 60 FPS. X Media Studio is a different upload surface and has different limits.

The post-record Social check evaluates what TabFlow can know locally: codec/container intent, dimensions, FPS, duration, file size and requested bitrate. It never uploads the file and does not claim account-specific acceptance.

## Performance policy

4K60 can require much more encode/write throughput than 4K30. For long 4K sessions, choose **Chọn file lưu trực tiếp** before recording. For X/Facebook, prefer **Social Ready** rather than recording a Master and relying on the uploader to transcode it.

## Privacy / security

- Source selection always happens through Chrome's permission picker.
- No silent background screen capture.
- No remote upload endpoint.
- Recorder UI is extension-owned and does not mutate ChatGPT's React tree.
- Downloads permission is only for export/reveal/history of TabFlow captures.

## Automated gates

`test/recorder-core.test.mjs` covers deterministic capture policy.

`test/social-profile.test.mjs` covers strict H.264/AAC detection, 1080p30 Social/X Free policy, and X's 140-second / 512 MB / 40 FPS / 25 Mbps envelope.

`scripts/verify-recorder.mjs` rejects capture regressions including network upload paths.

`test/recorder-browser-e2e.mjs` launches the unpacked extension in Chromium, validates Social Ready locks, and exercises real `MediaRecorder` when strict H.264/AAC MP4 is available.
