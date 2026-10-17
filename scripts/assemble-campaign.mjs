#!/usr/bin/env node
/** Format and validate generated campaign assets; no game files are changed. */
import sharp from 'sharp';
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const campaign = join(root, 'store-assets/campaign-2026-10-14');
const out = join(campaign, 'illustrated-art');
const originals = join(out, 'originals');
const generated = '/Users/IslamSharaf_1/.codex/generated_images/01a1383b-58cd-7f23-aae0-8113d4b75356';
const sourceFiles = {
  clean: 'exec-ec8ac754-3ad8-4ca6-87d3-eace0909c0e3.png',
  landscape: 'exec-bac2f08d-e713-4eec-ae6f-0e4e40401506.png',
  square: 'exec-b3b866e1-855b-4956-93e0-b166a3f3bb96.png',
  portrait: 'exec-5b6572f2-c451-4f0f-b29b-10c4420bf230.png',
};
await mkdir(originals, { recursive: true });
for (const [key, name] of Object.entries(sourceFiles)) {
  const target = join(originals, `${key}-master.png`);
  // Retained workspace masters make re-exports portable after generation.
  try { await access(target); }
  catch { await copyFile(join(generated, name), target); }
}
const exports = [
  ['landscape', 'route-a-landscape-1920x1080.png', 1920, 1080, 'CrazyGames cover / promotional key art'],
  ['square', 'route-a-square-800x800.png', 800, 800, 'CrazyGames square cover'],
  ['portrait', 'route-a-portrait-800x1200.png', 800, 1200, 'CrazyGames portrait cover'],
  ['clean', 'key-art-no-title-1920x1080.png', 1920, 1080, 'Promotional illustration without title'],
];
const manifest = [];
for (const [key, name, width, height, use] of exports) {
  const source = join(originals, `${key}-master.png`);
  const native = await sharp(source).metadata();
  const buffer = await sharp(source).resize(width, height, { fit: 'fill' })
    .flatten({ background: '#5cc8f5' }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(out, name), buffer);
  const m = await sharp(buffer).metadata();
  if (m.width !== width || m.height !== height || m.hasAlpha || m.channels !== 3)
    throw new Error(`Invalid export ${name}`);
  manifest.push({ path: `illustrated-art/${name}`, width, height, bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'), use,
    provenance: 'AI promotional illustration, not a gameplay screenshot',
    sourceDimensions: [native.width, native.height],
    resizedUp: width > native.width || height > native.height,
  });
  console.log(`${name}: ${width}x${height}, RGB, ${(buffer.length / 1024).toFixed(0)} KB`);
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Check legibility at realistic portal tile sizes. Only output formatting;
// all illustrated image creation and image editing was performed by Imagegen.
const tiles = [];
for (const [name, w, h, left, top] of [
  ['route-a-landscape-1920x1080.png', 320, 180, 16, 16],
  ['route-a-square-800x800.png', 160, 160, 352, 16],
  ['route-a-portrait-800x1200.png', 160, 240, 528, 16],
]) tiles.push({ input: await sharp(join(out, name)).resize(w, h).png().toBuffer(), left, top });
await sharp({ create: { width: 704, height: 272, channels: 3, background: '#f6f7f1' } })
  .composite(tiles).png().toFile(join(out, 'tile-size-review.png'));
console.log('Illustrated campaign export complete.');
