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

## Architecture

```text
Control Center
   │
   └── 🎥 Quay / Chụp 4K
              │
              ▼
      recorder/index.html
              │
      getDisplayMedia picker
              │
      ┌───────┴────────┐
      │                │
   video track      audio tracks
      │           system + optional mic
      │                │
      └───────┬────────┘
              ▼
         MediaStream
              │
      MIME / bitrate policy
              │
         MediaRecorder
              │  1s chunks
      ┌───────┴────────────┐
      │                    │
File System Access   in-memory fallback
 direct chunk write      Blob/File
      │                    │
      └────────┬───────────┘
               ▼
         local video file
```

## Features

- monitor / window / tab selection through Chrome's native picker;
- 4K, 1440p, 1080p and Native presets;
- 30 FPS and 60 FPS in Master mode;
- MP4 preferred with WebM fallback in Master mode;
- system/source audio request;
- optional microphone capture;
- microphone + source-audio mixing when both tracks exist;
- pause / resume / stop;
- actual captured resolution, FPS, format and audio status;
- full-resolution PNG screenshot from the live capture track or recorded preview;
- direct-to-file chunk streaming for long 4K sessions when File System Access is available;
- browser-download fallback;
- recent TabFlow video list with Open / Show in folder;
- local-only design: recorder code contains no upload/fetch path.

## Social Ready

Master recordings optimize for source quality, not for social-platform ingest. A 4K60 WebM or a long 4K MP4 can therefore be a perfectly valid local recording while still being rejected by a social uploader.

Capture Studio now has three output intents:

- **Master** — keeps the normal 4K/60 FPS controls.
- **Social Ready** — locks the capture to `1080p`, `30 FPS`, and MP4. Before recording it requires an explicit `H.264/AVC + AAC-LC` MediaRecorder MIME instead of silently calling a WebM fallback "social ready".
- **X Free** — uses the same Social Ready encoding and auto-stops at `2:19`, one second before X's documented 140-second non-Premium limit.

The cross-platform target is deliberately conservative: `1920×1080`, `30 FPS`, H.264/AAC-LC MP4, and roughly 5 Mbps video bitrate. It is intended to avoid the common failure mode where a high-quality local master is outside a social platform's ingest envelope. For Facebook this is a conservative interoperability preset, not a claim that TabFlow can predict every account/product-specific Meta ingest rule.

### X web limits

As of the September 2026 implementation review, X's own standard web-upload documentation lists the following for non-Premium posts:

- maximum duration: `140 seconds`;
- maximum file size: `512 MB`;
- web maximum landscape resolution: `1920×1200` (portrait `1200×1900`);
- aspect-ratio range: `1:2.39` through `2.39:1`;
- maximum frame rate: `40 FPS`;
- maximum bitrate: `25 Mbps`.

This is why TabFlow Social Ready uses **30 FPS**, not 60 FPS. X Media Studio has a different upload specification that can accept 60 FPS; it must not be confused with the ordinary x.com post uploader.

The Social check after recording evaluates the limits that TabFlow can know locally (container/codec intent, dimensions, FPS, duration, size and requested bitrate). It does not upload the file or claim that an external platform will accept an account-specific upload.

## Performance policy

The recorder bitrate is calculated from actual captured width, height and selected FPS and is clamped to a practical range. 4K60 can require roughly twice the encoding/write throughput of 4K30 and may be constrained by the machine, GPU encoder, selected source, filesystem, or Chrome.

For long 4K sessions:

1. choose **Chọn file lưu trực tiếp** before recording;
2. prefer 4K30 unless 60 FPS is actually needed;
3. verify the `Nguồn` field after capture starts — it is the source of truth for real resolution;
4. if system audio is missing, check the selected capture surface/OS because browsers do not expose system audio for every source/platform combination.

For a file intended for X/Facebook, prefer **Social Ready** rather than recording a Master and hoping the uploader transcodes it.

## Privacy / security

- Source selection always happens through Chrome's permission picker.
- No silent background screen capture is implemented.
- No remote upload endpoint is used.
- The recorder page is an extension-owned page; it does not inject capture controls into ChatGPT's React tree.
- Downloads permission is used only for exporting captures and reading/revealing the user's recent TabFlow downloads.

## Automated gates

`test/recorder-core.test.mjs` verifies deterministic capture policy logic.

`test/social-profile.test.mjs` verifies:

- strict H.264/AAC Social MIME detection;
- 1080p30 Social/X Free profile contract;
- X 140-second / 512 MB / 40 FPS / 25 Mbps limits;
- compatibility pass/fail classification.

`scripts/verify-recorder.mjs` verifies the extension contract and rejects regressions such as a network upload path.

`test/recorder-browser-e2e.mjs` launches the unpacked extension in Chromium and checks the Social Ready locks plus real `MediaRecorder` recording when the Chromium build exposes the required H.264/AAC MP4 MIME.
