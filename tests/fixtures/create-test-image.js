#!/usr/bin/env node
/**
 * Generate a minimal 1x1 pixel PNG for E2E test fixtures.
 * Run once: node tests/fixtures/create-test-image.js
 * Output: tests/fixtures/test-image.png (68 bytes)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

// IHDR: 1x1, 8-bit RGB (no alpha needed)
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);  // width
ihdr.writeUInt32BE(1, 4);  // height
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT: filter byte (0) + RGB pixel (red)
const raw = Buffer.from([0, 0xff, 0x00, 0x00]);
const compressed = zlib.deflateSync(raw);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, "test-image.png");
fs.writeFileSync(outPath, png);
console.log(`Created ${outPath} (${png.length} bytes)`);
