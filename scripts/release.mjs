#!/usr/bin/env node
// Build + package Blocky League for each distribution channel.
//
//   node scripts/release.mjs web                 # one variant
//   node scripts/release.mjs web crazygames poki itch
//   SITE_URL=https://blockyleague.example node scripts/release.mjs web   # absolute og:image for social cards
//
// Each variant produces dist-<variant>/ (index.html at the root, relative paths — vite base is './')
// and release/blocky-league-<variant>-v<version>.zip ready to upload.
// The npm scripts (build:web etc.) run `tsc --noEmit` before this.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { formatBytes, verifyZip, zipDirectory } from './lib.mjs';
import { fileFingerprint, sourceFingerprint } from './release-checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ZIP_BUDGET = 5 * 1024 * 1024;
const CLOUD_ENV = [process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '']; // web build only (src/platform/cloud.ts)

const VARIANTS = {
  // Own site. Keeps the PWA bits (manifest, icons, service worker, og image, privacy page).
  web: { portal: 'none', webOnly: true },
  // Portal builds: the portal's SDK is loaded at runtime by src/platform/ads.ts.
  crazygames: { portal: 'crazygames', webOnly: false },
  poki: { portal: 'poki', webOnly: false },
  // itch.io embeds the game in an iframe on its own CDN; no ads, no PWA.
  itch: { portal: 'none', webOnly: false },
};

// Files from public/ that only make sense on a top-level site we control.
const WEB_ONLY_FILES = ['sw.js', 'manifest.webmanifest', 'icons', 'apple-touch-icon.png', 'og-image.png', 'robots.txt', 'privacy.html'];
const WEB_ONLY_BLOCK = /[ \t]*<!-- web-only:start[\s\S]*?<!-- web-only:end -->\n?/;
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.txt', '.svg']);
const PORTAL_HOSTS = { crazygames: ['sdk.crazygames.com'], poki: ['game-cdn.poki.com'], itch: [] };
const NOT_REQUESTS = new Set(['www.w3.org', 'jcgt.org']);

// three.js (MIT) and the two fonts (SIL OFL 1.1) require their notices to travel with every copy.
// The minified bundle drops comments, so each build ships this file, generated from the
// installed packages so it always matches the versions actually bundled.
const LICENSES_FILE = 'third-party-licenses.txt';
function thirdPartyLicenses() {
  const parts = ['Blocky League bundles the following third-party software. Their licences are reproduced below.\n'];
  for (const dep of Object.keys(pkg.dependencies ?? {}).sort()) {
    const dir = join(ROOT, 'node_modules', dep);
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((f) => join(dir, f)).find((f) => existsSync(f));
    parts.push(`${'='.repeat(72)}\n${meta.name} ${meta.version} (${meta.license})\n${'='.repeat(72)}\n`);
    parts.push(lic ? readFileSync(lic, 'utf8').trim() + '\n' : `See https://www.npmjs.com/package/${meta.name}\n`);
  }
  return parts.join('\n');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function checkOutput(outDir, variant) {
  const problems = [];
  const warnings = [];
  const indexPath = join(outDir, 'index.html');
  if (!existsSync(indexPath)) problems.push('index.html missing at the build root');
  const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  // Root-absolute URLs break when a portal serves the game from a sub-path.
  for (const m of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const url = m[1];
    if (/^\/(?!\/)/.test(url)) problems.push(`root-absolute URL in index.html: ${url}`);
    else if (!/^(?:[a-z]+:|\/\/|#)/i.test(url)) {
      const asset = url.split(/[?#]/)[0];
      if (asset && !existsSync(join(outDir, asset))) problems.push(`missing asset referenced by index.html: ${url}`);
    }
  }
  if (!VARIANTS[variant].webOnly) {
    if (html.includes('web-only:start')) problems.push('web-only block was not stripped');
    if (html.includes('serviceWorker')) problems.push('service worker registration left in a portal build');
  }
  // Inventory of absolute http(s) URLs so "no external links / requests" can be reviewed.
  const hosts = new Map();
  for (const f of walk(outDir)) {
    if (!TEXT_EXT.has(extname(f)) || f.endsWith(LICENSES_FILE)) continue; // licence URLs are not requests
    const text = readFileSync(f, 'utf8');
    if (extname(f) !== '.html' && /["'`]\/assets\//.test(text)) problems.push(`${relative(outDir, f)} references /assets/ root-absolute`);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const h = m[1].toLowerCase();
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    }
  }
  if (!VARIANTS[variant].webOnly) {
    const allowed = PORTAL_HOSTS[variant];
    for (const host of hosts.keys()) if (!NOT_REQUESTS.has(host) && !allowed.includes(host)) problems.push(`unexpected external host in ${variant}: ${host}`);
    for (const host of allowed) if (!hosts.has(host)) problems.push(`${variant} SDK host missing: ${host}`);
  }
  return { problems, warnings, hosts };
}

async function buildVariant(variant) {
  const cfg = VARIANTS[variant];
  const outDir = join(ROOT, `dist-${variant}`);
  console.log(`\n=== ${variant} → ${relative(ROOT, outDir)}/ (VITE_PORTAL=${cfg.portal}) ===`);

  // Vite exposes VITE_* vars from process.env to import.meta.env; ads.ts reads VITE_PORTAL.
  process.env.VITE_PORTAL = cfg.portal;
  [process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY] = cfg.webOnly ? CLOUD_ENV : ['', '']; // cloud saves never ship in portal / itch zips
  const sourceHash = sourceFingerprint(ROOT);
  await build({
    root: ROOT,
    mode: 'production',
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  });

  const indexPath = join(outDir, 'index.html');
  let html = readFileSync(indexPath, 'utf8');
  if (!cfg.webOnly) {
    html = html.replace(WEB_ONLY_BLOCK, '');
    for (const f of WEB_ONLY_FILES) rmSync(join(outDir, f), { recursive: true, force: true });
  } else if (process.env.SITE_URL) {
    // Social scrapers need absolute image URLs; only known once the site has a domain.
    const site = process.env.SITE_URL.replace(/\/+$/, '');
    html = html
      .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")\.?\/?og-image\.png"/g, `$1${site}/og-image.png"`)
      .replace('<meta property="og:type"', `<meta property="og:url" content="${site}/" />\n    <meta property="og:type"`);
  }
  writeFileSync(indexPath, html);
  writeFileSync(join(outDir, LICENSES_FILE), thirdPartyLicenses());

  const { problems, warnings, hosts } = checkOutput(outDir, variant);
  const files = walk(outDir);
  const raw = files.reduce((n, f) => n + statSync(f).size, 0);

  mkdirSync(join(ROOT, 'release'), { recursive: true });
  const zipPath = join(ROOT, 'release', `blocky-league-${variant}-v${pkg.version}.zip`);
  rmSync(zipPath, { force: true });
  const zip = zipDirectory(outDir, zipPath);
  const names = verifyZip(zipPath);
  if (!names.includes('index.html')) problems.push('index.html is not at the zip root');
  if (sourceFingerprint(ROOT) !== sourceHash) problems.push('source changed during the build; rebuild before uploading');
  // Kept beside the ZIP, outside the game bundle. Submission verifies both source
  // and ZIP hashes, so changing a checkout timestamp cannot make a stale build pass.
  writeFileSync(zipPath.replace(/\.zip$/, '.json'), JSON.stringify({
    variant, version: pkg.version, builtAt: new Date().toISOString(), sourceHash, zipHash: fileFingerprint(zipPath),
  }, null, 2) + '\n');

  console.log(`  files: ${files.length}   unpacked: ${formatBytes(raw)}   zip: ${formatBytes(zip.zipSize)}  (${relative(ROOT, zipPath)}, verified)`);
  const big = zip.entries.filter((e) => e.size > 300 * 1024).sort((a, b) => b.size - a.size);
  for (const e of big) console.log(`  large: ${e.name.split('/').join(sep)}  ${formatBytes(e.size)} → ${formatBytes(e.packed)}`);
  console.log(`  external hosts referenced: ${hosts.size ? [...hosts].map(([h, n]) => `${h} (${n})`).join(', ') : 'none'}`);
  if (zip.zipSize > ZIP_BUDGET) warnings.push(`zip is ${formatBytes(zip.zipSize)}, over the 5 MB budget`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const p of problems) console.error(`  PROBLEM: ${p}`);
  return { variant, files: files.length, raw, zip: zip.zipSize, zipPath, ok: problems.length === 0 };
}

const wanted = process.argv.slice(2);
if (!wanted.length || wanted.some((v) => !VARIANTS[v])) {
  console.error(`usage: node scripts/release.mjs <${Object.keys(VARIANTS).join('|')}>...`);
  process.exit(2);
}

const results = [];
for (const v of wanted) results.push(await buildVariant(v));

console.log('\nvariant      files   unpacked    zip');
for (const r of results) {
  console.log(`${r.variant.padEnd(12)} ${String(r.files).padStart(5)}   ${formatBytes(r.raw).padStart(9)}   ${formatBytes(r.zip).padStart(8)}  ${r.ok ? 'ok' : 'PROBLEMS'}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
