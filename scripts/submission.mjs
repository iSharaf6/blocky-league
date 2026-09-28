#!/usr/bin/env node
// Assemble the portal submission kit: one folder per portal with the right zip, images, videos and a
// listing.txt of every field to paste, then re-check all of it and print a checklist.
//
//   npm run build:all      # first, whenever the game changed (this script never builds)
//   npm run submission     # then this: rebuilds release/submission/<portal>/ from scratch
//
// Inputs (never modified):
//   release/blocky-league-<variant>-v<version>.zip   from `npm run build:all`
//   release/store-assets/*.png                       from `npm run assets`
//   release/submission/media/                        screenshots + videos captured from the game
//   docs/STORE_LISTING.md                            the store copy
// Output: release/submission/{crazygames,poki,gamedistribution,itch}/ and release/submission/README.txt.
// The step-by-step guide is docs/SUBMIT.md. Exit code 1 if anything that must be right is wrong.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { formatBytes, verifyZip } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const V = pkg.version;
const REL = join(ROOT, 'release');
const OUT = join(REL, 'submission');
const MEDIA = join(OUT, 'media');
const STORE = join(REL, 'store-assets');
const LISTING_MD = join(ROOT, 'docs', 'STORE_LISTING.md');
const MB = 1024 * 1024;

const problems = []; // must be fixed before submitting (exit 1)
const warnings = []; // worth a look
const rel = (p) => relative(ROOT, p);
const problem = (portal, msg) => problems.push(`[${portal}] ${msg}`);
const warn = (portal, msg) => warnings.push(`[${portal}] ${msg}`);

// ------------------------------------------------------------------ what each portal gets

const SHOTS_DESKTOP = 'screenshots/desktop-1920x1080';
const SHOTS_PHONE = 'screenshots/phone-1080x1920';
const VIDEO_16x9 = 'video/blocky-league-16x9-1920x1080.mp4';
const VIDEO_2x3 = 'video/blocky-league-2x3-1080x1620.mp4';
const VIDEO_SQUARE = 'video/blocky-league-square-1080x1080.mp4';

// Hosts that appear in the shipped code but are not requests: the SVG namespace string, a comment in a
// three.js shader. Licence text is skipped entirely.
const NOT_REQUESTS = new Set(['www.w3.org', 'jcgt.org']);

const PORTALS = {
  crazygames: {
    name: 'CrazyGames',
    zip: 'crazygames',
    allowHosts: ['sdk.crazygames.com'],
    // docs.crazygames.com/requirements/intro + /technical (read 29 Sep 2026)
    limits: { files: 1500, bytes: 50 * MB, note: 'initial download 50 MB or less (20 MB or less for the mobile homepage), 1,500 files or fewer, 250 MB total' },
    mobileBytes: 20 * MB,
    images: [
      { dir: 'covers', src: [STORE, 'crazygames-landscape-1920x1080.png'], w: 1920, h: 1080 },
      { dir: 'covers', src: [STORE, 'crazygames-portrait-800x1200.png'], w: 800, h: 1200 },
      { dir: 'covers', src: [STORE, 'crazygames-square-800x800.png'], w: 800, h: 800 },
    ],
    videos: [
      { dir: 'videos', src: VIDEO_16x9, w: 1920, h: 1080, minS: 15, maxS: 20, maxBytes: 50 * MB, silent: true },
      { dir: 'videos', src: VIDEO_2x3, w: 1080, h: 1620, minS: 15, maxS: 20, maxBytes: 50 * MB, silent: true },
    ],
    screenshots: 'screenshots-if-asked',
  },
  poki: {
    name: 'Poki',
    zip: 'poki',
    allowHosts: ['game-cdn.poki.com'],
    // developers.poki.com/guide/web-engine: "initial download should not exceed 5MB and 8MB in total"
    limits: { bytes: 5 * MB, note: 'guidance: initial download 5 MB or less, 8 MB total' },
    inspectorFolder: true,
    images: [{ dir: 'thumbnails', src: [STORE, 'poki-thumbnail-1024x1024.png'], w: 1024, h: 1024, min: 628 }],
    videos: [{ dir: 'thumbnails', src: VIDEO_SQUARE, w: 1080, h: 1080, minS: 4, maxS: 6, minFps: 50, maxBytes: 100 * MB, silent: true }],
    screenshots: 'screenshots-if-asked',
  },
  gamedistribution: {
    name: 'GameDistribution',
    zip: null, // no GameDistribution build yet: its SDK is mandatory and not integrated
    images: [
      { dir: 'thumbnails', src: [STORE, 'gamedistribution-512x512.png'], w: 512, h: 512 },
      { dir: 'thumbnails', src: [STORE, 'gamedistribution-512x384.png'], w: 512, h: 384 },
      { dir: 'thumbnails', src: [STORE, 'gamedistribution-200x120.png'], w: 200, h: 120 },
      { dir: 'thumbnails/optional', src: [MEDIA, 'extra-sizes/gamedistribution-1280x720.png'], w: 1280, h: 720 },
      { dir: 'thumbnails/optional', src: [MEDIA, 'extra-sizes/gamedistribution-1280x550.png'], w: 1280, h: 550 },
    ],
    videos: [{ dir: 'video-optional', src: VIDEO_16x9, w: 1920, h: 1080, silent: true }],
    screenshots: 'screenshots',
  },
  itch: {
    name: 'itch.io',
    zip: 'itch',
    allowHosts: [],
    // itch.io/docs/creators/html5 (read 29 Sep 2026)
    limits: { files: 1000, bytes: 500 * MB, fileBytes: 200 * MB, pathLen: 240, note: '1,000 files or fewer, 500 MB or less extracted, 200 MB or less per file, paths of 240 characters or fewer' },
    images: [{ dir: 'cover', src: [STORE, 'itch-cover-630x500.png'], w: 630, h: 500 }],
    videos: [{ dir: 'trailer-for-youtube', src: VIDEO_16x9, w: 1920, h: 1080, silent: true }],
    screenshots: 'screenshots',
  },
};

// ------------------------------------------------------------------ small readers

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Every entry of a zip with its bytes (CRCs are checked by lib.mjs verifyZip first). */
function readZip(file) {
  verifyZip(file);
  const buf = readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.subarray(start, start + csize);
    entries.push({ name, data: method === 8 ? inflateRawSync(body) : Buffer.from(body) });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Duration, size, frame rate and track kinds of an MP4, read from its boxes (no ffprobe needed). */
function probeMp4(file) {
  const b = readFileSync(file);
  const boxes = (start, end) => {
    const list = [];
    let p = start;
    while (p + 8 <= end) {
      let size = b.readUInt32BE(p);
      const type = b.toString('latin1', p + 4, p + 8);
      let head = 8;
      if (size === 1) { size = Number(b.readBigUInt64BE(p + 8)); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head) break;
      list.push({ type, start: p + head, end: p + size, at: p });
      p += size;
    }
    return list;
  };
  const top = boxes(0, b.length);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return null;
  const info = { faststart: top.findIndex((x) => x.type === 'moov') < top.findIndex((x) => x.type === 'mdat'), tracks: [] };
  for (const trak of boxes(moov.start, moov.end).filter((x) => x.type === 'trak')) {
    const t = {};
    for (const c of boxes(trak.start, trak.end)) {
      if (c.type === 'tkhd') { t.w = b.readUInt32BE(c.end - 8) / 65536; t.h = b.readUInt32BE(c.end - 4) / 65536; }
      if (c.type !== 'mdia') continue;
      for (const d of boxes(c.start, c.end)) {
        if (d.type === 'mdhd') {
          const v1 = b[d.start] === 1;
          t.timescale = b.readUInt32BE(d.start + (v1 ? 20 : 12));
          t.duration = v1 ? Number(b.readBigUInt64BE(d.start + 24)) : b.readUInt32BE(d.start + 16);
        }
        if (d.type === 'hdlr') t.kind = b.toString('latin1', d.start + 8, d.start + 12);
        if (d.type !== 'minf') continue;
        for (const stbl of boxes(d.start, d.end).filter((x) => x.type === 'stbl')) {
          for (const s of boxes(stbl.start, stbl.end)) if (s.type === 'stsz') t.samples = b.readUInt32BE(s.start + 8);
        }
      }
    }
    t.seconds = t.timescale ? t.duration / t.timescale : 0;
    t.fps = t.seconds ? t.samples / t.seconds : 0;
    info.tracks.push(t);
  }
  return info;
}

// ------------------------------------------------------------------ the store copy (docs/STORE_LISTING.md)

function parseListing() {
  const md = readFileSync(LISTING_MD, 'utf8');
  const section = (heading) => {
    const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
    const m = md.match(re);
    if (!m) throw new Error(`docs/STORE_LISTING.md: section "## ${heading}" is missing`);
    return m[1];
  };
  const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[\s(])_(.+?)_(?=[\s).,:;]|$)/g, '$1$2').trim();
  // A blockquote (the lines starting with ">") as plain paragraphs.
  const quote = (s) => {
    const lines = s.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^> ?/, ''));
    return plain(lines.join('\n').replace(/\n{2,}/g, '\n\n'));
  };
  const firstBold = (s) => (s.match(/\*\*(.+?)\*\*/) ?? [])[1] ?? '';
  const L = {};
  L.title = firstBold(section('Title'));
  const dev = section('Developer');
  L.developer = firstBold(dev);
  L.credit = (dev.match(/Credit line[^_]*_([^_]+)_/) ?? [])[1] ?? '';
  L.taglines = section('Tagline').split('\n').filter((l) => l.startsWith('- ')).map((l) => plain(l.slice(2).replace(/\s*_\(\d+ chars\)_\s*$/, '')));
  L.short = quote(section('Short description'));
  L.long = quote(section('Long description'));
  const gd = section('GameDistribution fields');
  const after = (label) => {
    const i = gd.indexOf(label);
    if (i < 0) throw new Error(`docs/STORE_LISTING.md: "${label}" is missing from the GameDistribution section`);
    const rest = gd.slice(i + label.length);
    const block = rest.split('\n').slice(1);
    const out = [];
    for (const l of block) { if (l.startsWith('>')) out.push(l); else if (out.length && l.trim()) break; }
    return quote(out.join('\n'));
  };
  L.gdDescription = after('**Description:**');
  L.gdInstructions = after('**Instructions:**');
  L.gdGenres = (gd.match(/\*\*Genres[^*]*\*\*\s*([^.*]+)/) ?? [])[1]?.trim() ?? '';
  L.gdTags = (gd.match(/\*\*Tags[^*]*\*\*\s*([^\n]+)/) ?? [])[1]?.trim() ?? '';
  const ctl = section('Controls text').match(/```\n([\s\S]*?)```/);
  if (!ctl) throw new Error('docs/STORE_LISTING.md: the controls code block is missing');
  L.controls = ctl[1].trimEnd();
  const tags = section('Tags and categories');
  L.tags = {};
  for (const row of tags.split('\n').filter((l) => /^\| (CrazyGames|Poki|GameDistribution|itch\.io) \|/.test(l))) {
    const [, platform, category, list] = row.split('|').map((c) => c.trim());
    L.tags[platform] = { category, tags: list };
  }
  L.age = plain((tags.match(/\*\*Age \/ content:\*\*([^\n]+)/) ?? [])[1] ?? '');
  L.accessibility = plain((tags.match(/\*\*Accessibility[^*]*\*\*([^\n]+)/) ?? [])[1] ?? '');
  const links = section('Links and contact');
  const link = (label) => {
    const v = (links.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*([^\\n]+)`)) ?? [])[1];
    if (!v) throw new Error(`docs/STORE_LISTING.md: "${label}" is missing from "## Links and contact"`);
    return plain(v);
  };
  L.privacy = link('Privacy policy');
  L.contact = link('Contact email');
  L.website = link('Website');
  L.madeWith = link('Made with');
  L.platforms = link('Platforms');
  L.orientation = link('Orientation');
  for (const [k, v] of Object.entries(L)) if (!v || (typeof v === 'object' && !Object.keys(v).length)) throw new Error(`docs/STORE_LISTING.md: could not read "${k}"`);
  return L;
}

// ------------------------------------------------------------------ checks

function checkZip(portal, cfg, zipPath) {
  const res = { files: 0, bytes: 0, hosts: new Map() };
  let entries;
  try {
    entries = readZip(zipPath);
  } catch (e) {
    problem(portal, `zip is corrupt: ${e.message}`);
    return res;
  }
  res.files = entries.length;
  res.bytes = entries.reduce((n, e) => n + e.data.length, 0);
  const names = entries.map((e) => e.name);
  if (!names.includes('index.html')) problem(portal, 'index.html is not at the zip root');
  if (names.some((n) => n.startsWith('/') || n.includes('..') || n.includes('\\'))) problem(portal, 'zip has an absolute, "..", or backslash path');
  const L = cfg.limits ?? {};
  if (L.files && res.files > L.files) problem(portal, `${res.files} files, over the limit of ${L.files}`);
  if (L.bytes && res.bytes > L.bytes) problem(portal, `${formatBytes(res.bytes)} unpacked, over ${formatBytes(L.bytes)}`);
  if (cfg.mobileBytes && res.bytes > cfg.mobileBytes) warn(portal, `over ${formatBytes(cfg.mobileBytes)}: not eligible for the CrazyGames mobile homepage`);
  if (L.pathLen && names.some((n) => n.length > L.pathLen)) problem(portal, `a path is longer than ${L.pathLen} characters`);
  if (L.fileBytes && entries.some((e) => e.data.length > L.fileBytes)) problem(portal, `a file is bigger than ${formatBytes(L.fileBytes)}`);
  for (const e of entries) {
    const ext = extname(e.name);
    if (!['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg'].includes(ext)) continue;
    const text = e.data.toString('utf8');
    if (e.name === 'index.html') {
      for (const m of text.matchAll(/\b(?:src|href)="(\/(?!\/)[^"]*)"/g)) problem(portal, `root-absolute URL in index.html: ${m[1]} (breaks under a portal's sub-path)`);
      if (/serviceWorker/.test(text)) problem(portal, 'index.html registers a service worker (web build only)');
      if (/web-only:start/.test(text)) problem(portal, 'the web-only block was not stripped from index.html');
    } else if (/["'`]\/assets\//.test(text)) problem(portal, `${e.name} references /assets/ root-absolute`);
    if (/wss:\/\//i.test(text)) problem(portal, `${e.name} contains a wss:// URL: online multiplayer must stay in the web build only`);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const h = m[1].toLowerCase();
      if (NOT_REQUESTS.has(h)) continue;
      res.hosts.set(h, (res.hosts.get(h) ?? 0) + 1);
    }
  }
  for (const h of res.hosts.keys()) {
    if (!cfg.allowHosts.includes(h)) problem(portal, `external host in the build: ${h} (allowed: ${cfg.allowHosts.join(', ') || 'none'})`);
  }
  for (const h of cfg.allowHosts) if (!res.hosts.has(h)) problem(portal, `the ${cfg.name} SDK host ${h} is not in the build: was this zip built with the right VITE_PORTAL?`);
  res.entries = entries;
  return res;
}

/** The newest change to anything that goes into a build, to catch a zip that predates the source. */
function newestSource() {
  let t = 0;
  let which = '';
  for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'public')), join(ROOT, 'index.html'), join(ROOT, 'package-lock.json'), join(ROOT, 'vite.config.ts')]) {
    if (!existsSync(f)) continue;
    const m = statSync(f).mtimeMs;
    if (m > t) { t = m; which = f; }
  }
  return { t, which };
}

// ------------------------------------------------------------------ listing.txt per portal

/** Local date and time, YYYY-MM-DD HH:MM (the owner reads these, not UTC). */
function local(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

const hr = (t) => `\n=== ${t} ${'='.repeat(Math.max(3, 66 - t.length))}\n`;
const count = (s) => `(${[...s].length} chars)`;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function listingText(portal, L0, zipName) {
  const P = PORTALS[portal];
  // Never name another portal in a portal's own fields (the age line mentions CrazyGames' PEGI rule).
  const L = { ...L0, age: cap(portal === 'crazygames' ? L0.age : L0.age.replace(/\s*This meets CrazyGames'[^.]*\./, '')), accessibility: cap(L0.accessibility) };
  const head = [
    `${L.title}: ${P.name} submission fields`,
    `Generated by \`npm run submission\` from docs/STORE_LISTING.md on ${local(Date.now())}. Build v${V}.`,
    'Paste each block into the matching field. Step-by-step clicks: docs/SUBMIT.md.',
  ].join('\n');
  const b = [head];
  const add = (t, v) => b.push(hr(t) + v);
  const t = L.tags;
  if (portal === 'crazygames') {
    add('Game name', L.title);
    add('Developer / studio', L.developer);
    add('Short description / subtitle', `${L.taglines[1] ?? L.taglines[0]}  ${count(L.taglines[1] ?? L.taglines[0])}\nShorter: ${L.taglines[0]}  ${count(L.taglines[0])}`);
    add('Description', L.long);
    add('Controls', L.controls);
    add('Category and tags', `Category: ${t.CrazyGames.category}\nTags: ${t.CrazyGames.tags}\n(pick the closest ones from CrazyGames' own lists)`);
    add('Input and devices', `${L.platforms}\nMobile: yes (touch controls). Orientation: ${L.orientation}`);
    add('Age / content', L.age);
    add('Accessibility', L.accessibility);
    add('Privacy policy URL', L.privacy);
    add('Contact email', L.contact);
    add('Made with', L.madeWith);
    add('Settings to switch on', [
      'Automatic Progress Save: ON (the game has no purchases, so no SDK data code is needed)',
      'Multiplayer: NO (single player; online play is web-build only and is not in this zip)',
      'In-game purchases: NO. External links: NO. Custom fullscreen button: NO.',
    ].join('\n'));
    add('Files', [
      `Game build:      upload/${zipName}`,
      'Landscape cover: covers/crazygames-landscape-1920x1080.png',
      'Portrait cover:  covers/crazygames-portrait-800x1200.png',
      'Square cover:    covers/crazygames-square-800x800.png',
      'Video 16:9:      videos/blocky-league-16x9-1920x1080.mp4',
      'Video 2:3:       videos/blocky-league-2x3-1080x1620.mp4',
      'Screenshots:     screenshots-if-asked/ (CrazyGames\' docs do not ask for any)',
    ].join('\n'));
  } else if (portal === 'poki') {
    add('Game title', L.title);
    add('Team / studio (application form)', `${L.developer} (${L.credit})`);
    add('Categories (up to 4)', `${t.Poki.category}\nTags: ${t.Poki.tags}`);
    add('Suggested description', L.short + '  ' + count(L.short) + '\n\nLonger version if there is room:\n\n' + L.long);
    add('Controls', L.controls);
    add('Age / content', L.age);
    add('Privacy policy URL', L.privacy);
    add('Contact email', L.contact);
    add('Made with (engine field on the application form)', L.madeWith);
    add('Files', [
      `Poki Inspector:        drag the folder  upload/inspector-folder/  into https://inspector.poki.dev`,
      `Build zip (if asked):  upload/${zipName}`,
      'Static thumbnail:      thumbnails/poki-thumbnail-1024x1024.png  (square, no text, Poki rounds the corners)',
      'Animated thumbnail:    thumbnails/blocky-league-square-1080x1080.mp4  (needed before global release)',
      'Screenshots:           screenshots-if-asked/',
    ].join('\n'));
    add('Note for you (not a form field)', 'Poki\'s standard deal is web-exclusive: signing it means taking the game off CrazyGames, GameDistribution and itch.io. See docs/SUBMIT.md.');
  } else if (portal === 'gamedistribution') {
    add('NOT READY', 'GameDistribution requires its own SDK in the build and this game does not have it yet, so there is no zip here. Their terms: games without the SDK are denied publishing. Submit these fields once a GameDistribution build exists (docs/PUBLISHING.md §6).');
    add('Title', L.title);
    add('Company / developer', L.developer);
    add('Description (200-500 chars)', `${L.gdDescription}\n${count(L.gdDescription)}`);
    add('Instructions (200-500 chars)', `${L.gdInstructions}\n${count(L.gdInstructions)}`);
    add('Genres and tags', `Genres: ${L.gdGenres}\nTags: ${L.gdTags}`);
    add('Age / content', L.age);
    add('Privacy policy URL', L.privacy);
    add('Contact email', L.contact);
    add('Files', [
      'Thumbnails (mandatory): thumbnails/gamedistribution-512x512.png, -512x384.png, -200x120.png',
      'Thumbnails (optional):  thumbnails/optional/gamedistribution-1280x720.png, -1280x550.png',
      'Screenshots:            screenshots/',
      'Video:                  video-optional/blocky-league-16x9-1920x1080.mp4',
    ].join('\n'));
  } else if (portal === 'itch') {
    add('Title', L.title);
    add('Project URL', 'blocky-league   (gives https://<your-itch-name>.itch.io/blocky-league)');
    add('Short description or tagline', `${L.taglines[1] ?? L.taglines[0]}  ${count(L.taglines[1] ?? L.taglines[0])}`);
    add('Classification / Kind of project', 'Classification: Games\nKind of project: HTML');
    add('Release status', 'Released');
    add('Pricing', 'No payments  (or "$0 or donate". itch only lets HTML games take donations unless you contact their support)');
    add('Uploads', `Upload upload/${zipName}\nTick: "This file will be played in the browser"`);
    add('Embed options', [
      'Embed in page, viewport 960 x 540 (the game scales to any size)',
      'Mobile friendly: ON (orientation: landscape if the option is shown)',
      'Automatically start on page load: OFF (click to play)',
      'Fullscreen button: ON (itch\'s own button; allowed on itch)',
      'Enable scrollbars: OFF.  SharedArrayBuffer support: OFF (not needed)',
    ].join('\n'));
    add('Description', `${L.long}\n\nCONTROLS\n${L.controls}\n\n${L.credit}`);
    add('Genre', 'Sports');
    add('Tags (up to 10)', t['itch.io'].tags);
    add('Made with', L.madeWith);
    add('AI generation disclosure (OWNER DECIDES)', 'itch asks you to tag a project that contains material produced by generative AI. The game\'s code (which also generates every model, texture and sound) was written with an AI coding assistant. Answer honestly; if unsure, disclose it.');
    add('Age / content', L.age);
    add('Privacy / contact', `${L.privacy}\n${L.contact}`);
    add('Files', [
      'Cover image:  cover/itch-cover-630x500.png',
      'Screenshots:  screenshots/  (itch recommends 3 to 5: 02, 03, 04, 06 and a phone shot work well)',
      'Trailer:      itch takes a YouTube or Vimeo link, not a file: upload trailer-for-youtube/ there first if you want one',
    ].join('\n'));
  }
  return b.join('\n') + '\n';
}

// ------------------------------------------------------------------ assemble

function copyTo(src, destDir, portal, label) {
  if (!existsSync(src)) { problem(portal, `missing ${label}: ${rel(src)}`); return null; }
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, src.split('/').pop());
  copyFileSync(src, dest);
  return dest;
}

let L;
try {
  L = parseListing();
} catch (e) {
  console.error(`PROBLEM: ${e.message}`);
  process.exit(1);
}
if ([...L.short].length > 160) warnings.push(`[listing] short description is ${[...L.short].length} chars (portals usually allow about 160)`);
for (const [k, v] of [['GameDistribution description', L.gdDescription], ['GameDistribution instructions', L.gdInstructions]]) {
  const n = [...v].length;
  if (n < 200 || n > 500) warnings.push(`[listing] ${k} is ${n} chars (asked for 200-500)`);
}
if (/voiced|spoken commentary|voice commentary/i.test(L.long + L.short)) warnings.push('[listing] the copy mentions voiced commentary, but the voice was removed');
if (/online|multiplayer/i.test(L.long + L.short + L.gdDescription)) warnings.push('[listing] the portal copy mentions online play, which is not in the portal builds');

mkdirSync(OUT, { recursive: true });
const src = newestSource();
const summary = [];
for (const [portal, cfg] of Object.entries(PORTALS)) {
  const dir = join(OUT, portal);
  rmSync(dir, { recursive: true, force: true }); // idempotent: the folder is rebuilt every run (media/ is untouched)
  mkdirSync(dir, { recursive: true });
  const row = { portal, name: cfg.name, zip: null, files: 0, bytes: 0, hosts: [], images: 0, videos: [] };

  if (cfg.zip) {
    const zipName = `blocky-league-${cfg.zip}-v${V}.zip`;
    const zipPath = join(REL, zipName);
    if (!existsSync(zipPath)) problem(portal, `${rel(zipPath)} not found: run npm run build:all`);
    else {
      const age = statSync(zipPath).mtimeMs;
      if (src.t > age + 1000) {
        warn(portal, `the zip (built ${local(age)}) is older than the source (${rel(src.which)}, changed ${local(src.t)}): run npm run build:all, then npm run submission again`);
      }
      copyTo(zipPath, join(dir, 'upload'), portal, 'zip');
      const z = checkZip(portal, cfg, zipPath);
      Object.assign(row, { zip: zipName, files: z.files, bytes: z.bytes, hosts: [...z.hosts.keys()] });
      if (cfg.inspectorFolder && z.entries) {
        const f = join(dir, 'upload', 'inspector-folder');
        for (const e of z.entries) {
          const p = join(f, e.name);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, e.data);
        }
      }
    }
  } else {
    writeFileSync(join(dir, 'NOT-READY.txt'), [
      `${cfg.name} is not ready for submission yet.`,
      '',
      'GameDistribution requires its own SDK inside the game (their developer terms deny publishing without it),',
      'and Blocky League does not have a GameDistribution build yet. Everything else is ready here: thumbnails,',
      'screenshots, a video and listing.txt. Once a GameDistribution build exists (docs/PUBLISHING.md section 6:',
      'an ads.ts branch plus a build:gamedistribution variant), add its zip here and follow docs/SUBMIT.md.',
      '',
    ].join('\n'));
  }

  for (const im of cfg.images) {
    const dest = copyTo(join(...im.src), join(dir, im.dir), portal, 'image');
    if (!dest) continue;
    const s = pngSize(dest);
    if (!s) problem(portal, `${rel(dest)} is not a PNG`);
    else if (im.min ? s.w < im.min || s.h < im.min || s.w !== s.h : s.w !== im.w || s.h !== im.h) problem(portal, `${im.src[1]} is ${s.w}x${s.h}, expected ${im.min ? `a square of at least ${im.min}` : `${im.w}x${im.h}`}`);
    else row.images++;
  }

  for (const v of cfg.videos) {
    const dest = copyTo(join(MEDIA, v.src), join(dir, v.dir), portal, 'video');
    if (!dest) continue;
    const info = probeMp4(dest);
    const vt = info?.tracks.find((t) => t.kind === 'vide');
    if (!vt) { problem(portal, `${v.src}: no video track found`); continue; }
    const bytes = statSync(dest).size;
    const tag = `${v.src.split('/').pop()}: ${vt.w}x${vt.h}, ${vt.seconds.toFixed(1)} s, ${vt.fps.toFixed(0)} fps, ${formatBytes(bytes)}`;
    row.videos.push(tag);
    if (vt.w !== v.w || vt.h !== v.h) problem(portal, `${tag}: expected ${v.w}x${v.h}`);
    if (v.minS && (vt.seconds < v.minS - 0.05 || vt.seconds > v.maxS + 0.05)) problem(portal, `${tag}: expected ${v.minS}-${v.maxS} s`);
    if (v.minFps && vt.fps < v.minFps) problem(portal, `${tag}: expected ${v.minFps} fps or more`);
    if (v.maxBytes && bytes > v.maxBytes) problem(portal, `${tag}: over ${formatBytes(v.maxBytes)}`);
    if (v.silent && info.tracks.some((t) => t.kind === 'soun')) problem(portal, `${tag}: has a sound track (must be silent)`);
    if (!info.faststart) warn(portal, `${tag}: not "fast start" (moov after mdat); fine for upload`);
  }

  if (cfg.screenshots) {
    for (const sub of [SHOTS_DESKTOP, SHOTS_PHONE]) {
      const files = walk(join(MEDIA, sub)).filter((f) => f.endsWith('.png'));
      if (!files.length) problem(portal, `no screenshots in ${rel(join(MEDIA, sub))}`);
      for (const f of files) copyTo(f, join(dir, cfg.screenshots, sub.split('/')[1]), portal, 'screenshot');
    }
  }

  writeFileSync(join(dir, 'listing.txt'), listingText(portal, L, row.zip ?? '(none yet)'));
  summary.push(row);
}

writeFileSync(join(OUT, 'README.txt'), [
  `Blocky League submission kit (v${V}), built by \`npm run submission\` on ${local(Date.now())}.`,
  '',
  'One folder per portal. In each: the zip to upload (upload/), the images and videos in the portal\'s sizes,',
  'and listing.txt with every field to paste. The click-by-click guide is docs/SUBMIT.md.',
  '',
  'Recommended order: crazygames/ first (open submission, Basic Launch), itch/ any time (free, no review),',
  'poki/ only if you choose Poki\'s web-exclusive deal instead of the others, gamedistribution/ once it has an SDK build.',
  '',
  'media/ holds the source screenshots and videos (captured from the game). The portal folders are rebuilt from it',
  'and from release/*.zip + release/store-assets/ every time you run the script; nothing in media/ is changed.',
  'release/ is not in git: keep a backup of media/.',
  '',
].join('\n'));

// ------------------------------------------------------------------ checklist

const ok = (b) => (b ? '[ok]' : '[!!]');
const byPortal = (p) => problems.filter((x) => x.startsWith(`[${p}]`)).length === 0;
console.log(`\nBlocky League submission kit v${V}  ->  ${rel(OUT)}/\n`);
for (const r of summary) {
  const cfg = PORTALS[r.portal];
  console.log(`${r.name}  (${rel(join(OUT, r.portal))}/)`);
  if (cfg.zip) {
    console.log(`  ${ok(r.zip && byPortal(r.portal))} zip ${r.zip ?? 'missing'}: ${r.files} files, ${formatBytes(r.bytes)} unpacked; external hosts: ${r.hosts.join(', ') || 'none'}`);
    console.log(`       limits: ${cfg.limits.note}`);
  } else console.log('  [!!] no zip: needs a GameDistribution SDK build first (see NOT-READY.txt)');
  console.log(`  ${ok(r.images === cfg.images.length)} ${r.images}/${cfg.images.length} images at the right sizes`);
  for (const v of r.videos) console.log(`  [ok] ${v}`);
  console.log('  [ok] listing.txt written');
}
console.log('\nStill yours to do (nobody else can):');
console.log('  [ ] CrazyGames: create the developer account, upload crazygames/upload/*.zip, add covers + videos, paste listing.txt, test in the Preview tool, submit');
console.log('  [ ] itch.io: create the account, new project (Kind: HTML), upload itch/upload/*.zip, paste listing.txt, answer the AI disclosure, publish');
console.log('  [ ] Poki: only if you choose web exclusivity; apply first, then test poki/upload/inspector-folder in Poki Inspector');
console.log('  [ ] GameDistribution: wait for an SDK build');
if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  - ${w}`);
}
if (problems.length) {
  console.log('\nPROBLEMS (fix before submitting):');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
