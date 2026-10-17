#!/usr/bin/env node
/** Validate ready-to-upload media, then package a standalone review gallery. */
import sharp from 'sharp';
import { readFile, writeFile, readdir, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zipDirectory, verifyZip } from './lib.mjs';

const root = resolve(import.meta.dirname, '..');
const campaign = join(root, 'store-assets/campaign-2026-10-14');
const ffprobe = process.env.BLOCKY_CAPTURE_FFPROBE || '/tmp/blocky-campaign-ffprobe';
const ffmpeg = process.env.BLOCKY_CAPTURE_FFMPEG || '/tmp/blocky-campaign-ffmpeg';
const zipName = 'blocky-league-creative-kit-v1.1.0-2026-10-14.zip';
const sha = data => createHash('sha256').update(data).digest('hex');
const files = [];
const sources = JSON.parse(await readFile(join(campaign, 'renderer-art/manifest.json'), 'utf8'));
for (const source of sources.rendererInputs) {
  if (sha(await readFile(join(root, source.file))) !== source.sha256)
    throw new Error(`Renderer source changed after capture: ${source.file}`);
}
for (const route of ['a', 'b']) {
  const folder = route === 'a' ? 'illustrated-art' : 'renderer-art';
  for (const [shape, width, height] of [['landscape', 1920, 1080], ['portrait', 800, 1200], ['square', 800, 800]]) {
    const path = `${folder}/route-${route}-${shape}-${width}x${height}.png`;
    const data = await readFile(join(campaign, path));
    const m = await sharp(data).metadata();
    if (m.width !== width || m.height !== height || m.channels !== 3 || m.hasAlpha)
      throw new Error(`Invalid cover specification: ${path}`);
    files.push({ path, kind: 'portal-cover', route, width, height, channels: m.channels,
      hasAlpha: m.hasAlpha, bytes: data.length, sha256: sha(data) });
  }
  for (const [shape, width, height] of [['landscape', 1920, 1080], ['portrait', 1080, 1620]]) {
    const path = `footage/${route === 'a' ? 'blocky-league' : 'route-b'}-gameplay-${shape}-${width}x${height}.mp4`;
    const data = await readFile(join(campaign, path));
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', join(campaign, path)], { encoding: 'utf8' }));
    const v = probe.streams.find(s => s.codec_type === 'video');
    if (!v || probe.streams.some(s => s.codec_type === 'audio') ||
        v.width !== width || v.height !== height || v.codec_name !== 'h264' ||
        v.pix_fmt !== 'yuv420p' || v.avg_frame_rate !== '30/1' ||
        Number(probe.format.duration) > 20 || data.length >= 50_000_000 || Number(v.nb_read_frames) !== 432)
      throw new Error(`Invalid preview specification: ${path}`);
    // Full decoding, not merely reading a valid-looking container header.
    execFileSync(ffmpeg, ['-v', 'error', '-i', join(campaign, path), '-f', 'null', '-'], { stdio: 'pipe' });
    files.push({ path, kind: 'portal-preview', route, width, height, codec: v.codec_name,
      pixelFormat: v.pix_fmt, fps: 30, frames: Number(v.nb_read_frames),
      duration: Number(probe.format.duration), audioStreams: 0,
      bytes: data.length, sha256: sha(data), matchingCoverOpeningSeconds: 0.6 });
  }
}
const extraArt = [
  'illustrated-art/key-art-no-title-1920x1080.png',
  'renderer-art/route-b-landscape-1920x1080-no-title.png',
  'renderer-art/route-b-portrait-800x1200-no-title.png',
  'renderer-art/route-b-square-800x800-no-title.png',
];
for (const path of extraArt) {
  const data = await readFile(join(campaign, path));
  const m = await sharp(data).metadata();
  files.push({ path, kind: 'text-free-promotional-art', width: m.width, height: m.height,
    bytes: data.length, sha256: sha(data) });
}
const manifest = {
  title: 'Blocky League creative kit', preparedDate: '2026-10-14', timezone: 'Australia/Sydney',
  buildVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  latestRelease: JSON.parse(await readFile(join(root, 'release/blocky-league-crazygames-v1.1.0.json'), 'utf8')),
  files,
  sourceRecords: ['illustrated-art/manifest.json', 'illustrated-art/prompts.json', 'renderer-art/manifest.json', 'footage/footage-manifest.json'],
  verification: { opaqueRGBImages: true, fullVideoDecoding: true, previewNoAudio: true,
    maxPreviewSeconds: 20, maxPreviewBytes: 50000000, rendererSourceHashesMatch: true },
  provenance: {
    illustratedArt: 'Built-in Imagegen promotional illustration, not a game screenshot.',
    rendererArt: 'Current game meshes with staged promotional pose, scale, lighting and cameras.',
    footage: 'Current game simulation and renderer, deterministic starting scenarios, normal gameplay speed. A/B previews share identical motion after their matching opening cover.',
  },
  publishing: 'Prepared locally. No portal uploads or release changes.',
};
await writeFile(join(campaign, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const docs = ['index.html', 'README.md', 'GROWTH-PLAN.md', 'manifest.json',
  'illustrated-art/manifest.json', 'illustrated-art/prompts.json', 'illustrated-art/tile-size-review.png',
  'renderer-art/manifest.json', 'renderer-art/contact-sheet.png', 'footage/README.md', 'footage/footage-manifest.json'];
const reviews = (await readdir(join(campaign, 'footage/previews'))).map(name => `footage/previews/${name}`);
const packFiles = [...files.map(f => f.path), ...docs, ...reviews];
const stage = join(root, 'release/campaign-package-2026-10-14');
await mkdir(stage, { recursive: true });
try {
  for (const path of packFiles) {
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await copyFile(join(campaign, path), join(stage, path));
  }
  const zipped = zipDirectory(stage, join(campaign, zipName));
  const entries = verifyZip(join(campaign, zipName));
  if (entries.length !== packFiles.length) throw new Error('Unexpected ZIP contents');
  await writeFile(join(campaign, 'verification.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), imageCount: 6, previewCount: 4, artworkCount: 4,
    files: files.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
    zip: { name: zipName, bytes: zipped.zipSize, entries: entries.length, verifiedCRC: true,
      sha256: sha(await readFile(join(campaign, zipName))) },
  }, null, 2) + '\n');
  console.log(`Validated 6 covers, 4 silent previews and 4 artwork exports. ZIP: ${(zipped.zipSize / 1048576).toFixed(1)} MiB, ${entries.length} verified entries.`);
} finally { await rm(stage, { recursive: true, force: true }); }
