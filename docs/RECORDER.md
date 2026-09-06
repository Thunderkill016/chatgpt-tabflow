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

Media is encoded with `MediaRecorder`. The implementation probes `MediaRecorder.isTypeSupported()` and prefers MP4 when the running Chrome can actually construct/start that recorder; otherwise it falls back to WebM.

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
- 30 FPS and 60 FPS;
- MP4 preferred with WebM fallback;
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

## Performance policy

The recorder bitrate is calculated from actual captured width, height and selected FPS and is clamped to a practical range. 4K60 can require roughly twice the encoding/write throughput of 4K30 and may be constrained by the machine, GPU encoder, selected source, filesystem, or Chrome.

For long 4K sessions:

1. choose **Chọn file lưu trực tiếp** before recording;
2. prefer 4K30 unless 60 FPS is actually needed;
3. verify the `Nguồn` field after capture starts — it is the source of truth for real resolution;
4. if system audio is missing, check the selected capture surface/OS because browsers do not expose system audio for every source/platform combination.

## Privacy / security

- Source selection always happens through Chrome's permission picker.
- No silent background screen capture is implemented.
- No remote upload endpoint is used.
- The recorder page is an extension-owned page; it does not inject capture controls into ChatGPT's React tree.
- Downloads permission is used only for exporting captures and reading/revealing the user's recent TabFlow downloads.

## Automated gates

`test/recorder-core.test.mjs` verifies deterministic policy logic:

- 4K dimensions;
- FPS constraints;
- MIME fallback;
- bitrate bounds;
- real-resolution labeling;
- deterministic filenames and formatting.

`scripts/verify-recorder.mjs` verifies the extension contract and rejects regressions such as a network upload path.

The Chromium extension E2E opens Capture Studio from the real Control Center and runs a synthetic `canvas.captureStream()` through a real Chromium `MediaRecorder`. The OS screen picker itself is intentionally not automated in CI; production source-picker behavior remains controlled by Chrome.
