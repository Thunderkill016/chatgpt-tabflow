import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function createPng(width, height, pixelFn) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    scanlines[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      scanlines[offset++] = r;
      scanlines[offset++] = g;
      scanlines[offset++] = b;
      scanlines[offset++] = a;
    }
  }

  const compressedData = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Icon design: Modern glowing emerald-to-cyan circular badge with a lightning bolt / speed symbol
function drawAppIcon(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = (w / 2) - 1;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Transparent outside circle
  if (dist > r) {
    return [0, 0, 0, 0];
  }

  // Smooth antialiasing on border
  let alpha = 255;
  if (dist > r - 1) {
    alpha = Math.floor(255 * (r - dist));
  }

  // Background: Modern high-tech dark gradient (slate-900 to teal-950)
  const gradY = y / h;
  const bgR = Math.floor(16 + gradY * 10);
  const bgG = Math.floor(24 + gradY * 60);
  const bgB = Math.floor(39 + gradY * 70);

  // Normalized coords [-1, 1]
  const nx = (x - cx) / (w / 2);
  const ny = (y - cy) / (h / 2);

  // Lightning bolt / Speed icon shape
  // Points of lightning:
  // Top: (0.1, -0.65), Middle bend: (-0.35, 0.05), Mid-right: (0.05, 0.05), Bottom: (-0.1, 0.65), Upper bend: (0.35, -0.05), Mid-left: (-0.05, -0.05)
  // Simplified check for lightning polygon:
  const isLightning = (
    (ny >= -0.65 && ny <= 0.05 && nx >= (-0.35 + (ny + 0.65) * 0.2) && nx <= (0.15 - (ny + 0.65) * 0.1)) ||
    (ny >= -0.05 && ny <= 0.65 && nx >= (-0.1 - (0.65 - ny) * 0.1) && nx <= (0.35 - (0.65 - ny) * 0.2)) ||
    (ny >= -0.15 && ny <= 0.15 && nx >= -0.25 && nx <= 0.25)
  );

  if (isLightning) {
    // Glowing Emerald Green to Electric Cyan
    const lightR = 16;
    const lightG = Math.floor(220 + (1 - gradY) * 35);
    const lightB = Math.floor(160 + gradY * 95);
    return [lightR, lightG, lightB, alpha];
  }

  // Ring border glow
  if (dist >= r - (w >= 48 ? 3 : 1.5)) {
    return [16, 185, 129, alpha]; // Emerald border
  }

  return [bgR, bgG, bgB, alpha];
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const buf = createPng(size, size, drawAppIcon);
  const targetPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(targetPath, buf);
  console.log(`Generated: ${targetPath} (${size}x${size}, ${buf.length} bytes)`);
}

console.log('✅ All icons successfully generated!');
