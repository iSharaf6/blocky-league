// Dependency-free binary helpers for the release tooling: CRC-32, a PNG encoder
// and a ZIP writer, all on top of node:zlib. Used by scripts/gen-assets.mjs
// (icons, covers) and scripts/release.mjs (portal zips).

import { deflateRawSync, deflateSync, inflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- PNG

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode an 8-bit RGB (channels=3) or RGBA (channels=4) image.
 * `px` is a Uint8Array of width*height*channels bytes, rows top to bottom.
 * Each row picks the PNG filter (None/Sub/Up/Paeth) with the smallest residual.
 */
export function encodePNG(width, height, px, channels = 3) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestScore = Infinity;
    [0, 1, 2, 4].forEach((f, fi) => {
      const b = cand[fi];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels] : 0;
        const u = up ? up[i] : 0;
        const ul = up && i >= channels ? up[i - channels] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = u;
        else if (f === 4) {
          const p = a + u - ul;
          const pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - ul);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? u : ul;
        }
        const v = (row[i] - pred) & 0xff;
        b[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = fi;
      }
    });
    out[y * (stride + 1)] = [0, 1, 2, 4][best];
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: RGBA / RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ZIP

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === '.DS_Store') continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Zip the *contents* of `dir` (so index.html sits at the zip root) into `outFile`.
 * Plain deflate, no zip64 (fine far below 4 GB). Returns a manifest for reporting.
 */
export function zipDirectory(dir, outFile) {
  const files = listFiles(dir);
  const { time, day } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  let rawTotal = 0;
  const entries = [];
  for (const file of files) {
    const name = relative(dir, file).split(sep).join('/');
    const nameBuf = Buffer.from(name, 'utf8');
    const data = readFileSync(file);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    rawTotal += data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(day, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4); // made by: unix, spec 3.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(day, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: -rw-r--r--
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
    entries.push({ name, size: data.length, packed: body.length });
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const zip = Buffer.concat([...locals, cd, end]);
  writeFileSync(outFile, zip);
  return { entries, rawTotal, zipSize: zip.length };
}

/**
 * Re-read a zip written by zipDirectory and check every entry inflates to the
 * recorded size and CRC. Throws on the first problem; returns the entry names.
 */
export function verifyZip(file) {
  const buf = readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`${file}: no end-of-central-directory record`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central header #${i}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26);
    const lelen = buf.readUInt16LE(off + 28);
    const start = off + 30 + lnlen + lelen;
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : body;
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`${file}: corrupt entry ${name}`);
    names.push(name);
    p += 46 + nlen + elen + clen;
  }
  return names;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
