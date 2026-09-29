#!/usr/bin/env node
// Generates every raster asset the release needs, with no dependencies:
//   public/icons/*.png, public/apple-touch-icon.png, public/og-image.png  (shipped with the web build)
//   store-assets/*.png                                                    (uploaded by hand to stores / portals)
//
// Renders a tiny orthographic voxel scene (ball, players, goal) with a DDA ray caster,
// flat Crossy-style face shading and hard shadows, then stamps the title in a 5x7
// bitmap font. Colours come from src/render/palette.ts and src/meta/data.ts.
//
//   node scripts/gen-assets.mjs            # everything
//   node scripts/gen-assets.mjs --fast     # 1 sample/pixel preview

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, formatBytes } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = process.argv.includes('--fast');

// ----------------------------------------------------------- palette (mirrors src/render/palette.ts)
const GRASS_A = 0xa2d65c;
const GRASS_B = 0x94cc4f;
const LINE = 0xfbfbf4;
const BALL_WHITE = 0xfbfbf6;
const BALL_BLACK = 0x26262e;
const INK = 0x26262e;
const SKY = 0x5cc8f5; // theme colour
const SKIN = [0xf8dcc0, 0xf0c49c, 0xdca577, 0xb97b4c, 0x8c5634];
const HAIR = [0x2a1d16, 0x4a2e1c, 0x7a4a26, 0xe8c25a, 0xc8602a];
const KIT = {
  red: 0xe8443a, white: 0xf6f4ec, sky: 0x5cc8f5, navy: 0x223a78, orange: 0xff8a2b, yellow: 0xffd23a,
};
const NET = 0xe4e4dc;

const SHADOW = 0.66; // hard shadow multiplier
// Direction *towards* the sun. Lights the +z faces, leaves +x faces in shade, throws
// shadows screen-right.
const L = norm([-0.42, 1, 0.5]);

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** Rodrigues rotation of v about unit axis k by angle t. */
function rotateAxis(v, k, t) {
  const c = Math.cos(t), s = Math.sin(t), kv = dot(k, v), kxv = cross(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ----------------------------------------------------------- voxel objects

function grid(nx, ny, nz) {
  return { nx, ny, nz, data: new Int32Array(nx * ny * nz).fill(-1) };
}
function setV(g, x, y, z, c) {
  if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) return;
  g.data[(y * g.nz + z) * g.nx + x] = c;
}
function box(g, x0, y0, z0, x1, y1, z1, c) {
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) setV(g, x, y, z, c);
}
/** Place grid `g` with voxel size `vs`; (x,y,z) is the world position of its min corner. */
function place(g, vs, x, y, z) {
  return { g, vs, px: x, py: y, pz: z };
}

/**
 * Voxel football: sphere of n^3 cells, 12 dark patches at icosahedron vertices.
 * Defaults match buildBallGeometry() in src/render/characters.ts (n=8, dot > 0.9).
 * `face` (a direction) rotates the ball so one patch points that way — e.g. at the camera —
 * then `roll` spins it about that axis. The in-game ball rolls, so every orientation is canon.
 */
function makeBall(n = 8, { face = null, roll = 0, patchCos = 0.9 } = {}) {
  const g = grid(n, n, n);
  const phi = (1 + Math.sqrt(5)) / 2;
  let verts = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) verts.push([0, a, b], [a, b, 0], [b, 0, a]);
  verts = verts.map(norm);
  if (face) {
    const b = norm(face);
    const a = verts[0];
    verts = verts.map((v) => rotateAxis(v, norm(cross(a, b)), Math.acos(dot(a, b))));
    verts = verts.map((v) => rotateAxis(v, b, roll));
  }
  const r = n / 2;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const cx = x + 0.5 - r, cy = y + 0.5 - r, cz = z + 0.5 - r;
        const d = Math.hypot(cx, cy, cz);
        if (d > r - 0.05) continue;
        let dark = false;
        for (const v of verts) if ((cx * v[0] + cy * v[1] + cz * v[2]) / d > patchCos) dark = true;
        setV(g, x, y, z, dark ? BALL_BLACK : BALL_WHITE);
      }
    }
  }
  return g;
}

const DIGITS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};

/**
 * Chunky voxel footballer, 8 wide (x) x 4 deep (z) x 17 tall, built facing +z.
 * facing: 0 = +z (towards camera), 1 = +x, 2 = -z, 3 = -x. stride lifts one leg.
 */
function makePlayer({ shirt, shirt2 = shirt, pattern = 'plain', shorts, socks, skin, hair, gloves = null, number = null, facing = 0, stride = false }) {
  const m = grid(8, 18, 6);
  const S = (x, y, z, c) => setV(m, x, y, z + 1, c);
  const B = (x0, y0, z0, x1, y1, z1, c) => box(m, x0, y0, z0 + 1, x1, y1, z1 + 1, c);
  // legs: boots, socks, knees
  const legs = [[1, 0], [5, stride ? 1 : 0]];
  legs.forEach(([lx, lift], i) => {
    const dz = stride && i === 1 ? 2 : 0;
    B(lx, lift, 1 + dz, lx + 2, lift + 1, 3 + dz, INK);
    B(lx, lift + 1, 1 + dz, lx + 2, lift + 4, 3 + dz, socks);
    B(lx, lift + 4, 1 + dz, lx + 2, 5, 3 + dz, skin);
  });
  B(1, 5, 0, 7, 7, 4, shorts);
  // torso with pattern
  for (let y = 7; y < 12; y++) {
    for (let x = 1; x < 7; x++) {
      for (let z = 0; z < 4; z++) {
        let c = shirt;
        if (pattern === 'stripes' && x % 2 === 0) c = shirt2;
        if (pattern === 'sleeves') c = shirt;
        S(x, y, z, c);
      }
    }
  }
  // arms
  for (const ax of [0, 7]) {
    B(ax, 10, 1, ax + 1, 12, 3, pattern === 'sleeves' ? shirt2 : shirt);
    B(ax, 8, 1, ax + 1, 10, 3, skin);
    B(ax, 7, 1, ax + 1, 8, 3, gloves ?? skin);
  }
  // shirt number on the back (z = 0 side), mirrored in x so it reads correctly from behind
  if (number !== null) {
    const glyph = DIGITS[String(number)];
    const ink = shirt === KIT.white ? INK : KIT.white;
    glyph.forEach((row, r) => [...row].forEach((bit, c) => { if (bit === '1') S(5 - c, 11 - r, 0, ink); }));
  }
  // head
  B(1, 12, 0, 7, 17, 4, skin);
  B(1, 16, 0, 7, 17, 4, hair);
  B(1, 13, 0, 7, 16, 1, hair); // back of head
  B(1, 15, 0, 2, 16, 4, hair);
  B(6, 15, 0, 7, 16, 4, hair);
  S(2, 14, 3, INK);
  S(5, 14, 3, INK);
  // rotate into place
  const turns = ((facing % 4) + 4) % 4;
  if (turns === 0) return m;
  const nx = turns % 2 ? m.nz : m.nx, nz = turns % 2 ? m.nx : m.nz;
  const out = grid(nx, m.ny, nz);
  for (let y = 0; y < m.ny; y++) {
    for (let z = 0; z < m.nz; z++) {
      for (let x = 0; x < m.nx; x++) {
        const c = m.data[(y * m.nz + z) * m.nx + x];
        if (c < 0) continue;
        let X = x, Z = z;
        for (let t = 0; t < turns; t++) [X, Z] = [Z, (t % 2 === 0 ? m.nx : m.nz) - 1 - X];
        setV(out, X, y, Z, c);
      }
    }
  }
  return out;
}

/** Goal frame + lattice net. Mouth faces +z; `w` x `h` x `d` in voxels. */
function makeGoal(w, h, d) {
  const g = grid(w, h, d);
  const post = BALL_WHITE;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const onBack = z === 0, onTop = y === h - 1, onSide = x === 0 || x === w - 1;
        if (!(onBack || onTop || onSide)) continue;
        const lattice = (a, b) => a % 3 === 0 || b % 3 === 0;
        let net = false;
        if (onBack && lattice(x, y)) net = true;
        if (onTop && lattice(x, z)) net = true;
        if (onSide && lattice(z, y)) net = true;
        if (net) setV(g, x, y, z, NET);
      }
    }
  }
  box(g, 0, 0, d - 1, 1, h, d, post);
  box(g, w - 1, 0, d - 1, w, h, d, post);
  box(g, 0, h - 1, d - 1, w, h, d, post);
  return g;
}

// ----------------------------------------------------------- ray caster

const HIT = { t: 0, c: 0, n: 1, s: 1 }; // n: normal axis 0/1/2, s: sign

function traceObj(o, ox, oy, oz, dx, dy, dz, tBest, anyHit) {
  const g = o.g;
  const inv = 1 / o.vs;
  const lx = (ox - o.px) * inv, ly = (oy - o.py) * inv, lz = (oz - o.pz) * inv;
  let t0 = 0, t1 = tBest * inv, axis = 1;
  const slab = (l, d, n, ax) => {
    if (d === 0) return l >= 0 && l < n;
    let a = -l / d, b = (n - l) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) { t0 = a; axis = ax; }
    if (b < t1) t1 = b;
    return true;
  };
  if (!slab(lx, dx, g.nx, 0) || !slab(ly, dy, g.ny, 1) || !slab(lz, dz, g.nz, 2) || t0 >= t1) return false;
  let ix = Math.min(g.nx - 1, Math.max(0, Math.floor(lx + dx * t0)));
  let iy = Math.min(g.ny - 1, Math.max(0, Math.floor(ly + dy * t0)));
  let iz = Math.min(g.nz - 1, Math.max(0, Math.floor(lz + dz * t0)));
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const ddy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const ddz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx > 0 ? (ix + 1 - lx) / dx : dx < 0 ? (ix - lx) / dx : Infinity;
  let ty = dy > 0 ? (iy + 1 - ly) / dy : dy < 0 ? (iy - ly) / dy : Infinity;
  let tz = dz > 0 ? (iz + 1 - lz) / dz : dz < 0 ? (iz - lz) / dz : Infinity;
  let tc = t0;
  for (;;) {
    const c = g.data[(iy * g.nz + iz) * g.nx + ix];
    if (c >= 0) {
      if (anyHit) return true;
      HIT.t = tc * o.vs;
      HIT.c = c;
      HIT.n = axis;
      HIT.s = axis === 0 ? -sx : axis === 1 ? -sy : -sz;
      return true;
    }
    if (tx < ty && tx < tz) {
      if (tx > t1) return false;
      ix += sx; tc = tx; tx += ddx; axis = 0;
      if (ix < 0 || ix >= g.nx) return false;
    } else if (ty < tz) {
      if (ty > t1) return false;
      iy += sy; tc = ty; ty += ddy; axis = 1;
      if (iy < 0 || iy >= g.ny) return false;
    } else {
      if (tz > t1) return false;
      iz += sz; tc = tz; tz += ddz; axis = 2;
      if (iz < 0 || iz >= g.nz) return false;
    }
  }
}

function occluded(objs, x, y, z) {
  for (const o of objs) if (traceObj(o, x, y, z, L[0], L[1], L[2], 1e6, true)) return true;
  return false;
}

function mulHex(hex, f) {
  return [((hex >> 16) & 255) * f, ((hex >> 8) & 255) * f, (hex & 255) * f];
}

/** Shade one ray. Returns [r,g,b] floats. */
function shade(scene, ox, oy, oz, dx, dy, dz) {
  let best = Infinity, col = 0, n = 1, s = 1;
  for (const o of scene.objs) {
    if (traceObj(o, ox, oy, oz, dx, dy, dz, best, false)) {
      best = HIT.t; col = HIT.c; n = HIT.n; s = HIT.s;
    }
  }
  const tg = dy < 0 ? -oy / dy : Infinity;
  let px, py, pz, nx = 0, ny = 1, nz = 0;
  if (tg < best) {
    px = ox + dx * tg; py = 0; pz = oz + dz * tg;
    col = scene.ground(px, pz);
  } else if (best === Infinity) {
    return mulHex(SKY, 1);
  } else {
    px = ox + dx * best; py = oy + dy * best; pz = oz + dz * best;
    nx = n === 0 ? s : 0; ny = n === 1 ? s : 0; nz = n === 2 ? s : 0;
  }
  // flat toy shading per face orientation
  let f;
  if (ny > 0) f = 1;
  else if (ny < 0) f = 0.6;
  else f = nx * L[0] + nz * L[2] > 0 ? 0.88 : 0.74;
  const e = 1e-3;
  if ((ny > 0 || nx * L[0] + nz * L[2] > 0) && occluded(scene.objs, px + nx * e, py + ny * e, pz + nz * e)) f *= SHADOW;
  return mulHex(col, f);
}

/**
 * Render the scene into an RGB float buffer.
 * cam: { target:[x,y,z], yaw, pitch (radians), scale: world units per pixel }
 */
function render(scene, W, H, cam, ss) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const C = [Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp]; // towards camera
  const R = norm([C[2], 0, -C[0]]); // up x C
  const U = [C[1] * R[2] - C[2] * R[1], C[2] * R[0] - C[0] * R[2], C[0] * R[1] - C[1] * R[0]];
  const D = [-C[0], -C[1], -C[2]];
  const far = 200;
  const buf = new Float32Array(W * H * 3);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss - W / 2) * cam.scale;
          const v = (H / 2 - y - (sy + 0.5) / ss) * cam.scale;
          const ox = cam.target[0] + C[0] * far + R[0] * u + U[0] * v;
          const oy = cam.target[1] + C[1] * far + R[1] * u + U[1] * v;
          const oz = cam.target[2] + C[2] * far + R[2] * u + U[2] * v;
          const c = shade(scene, ox, oy, oz, D[0], D[1], D[2]);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (y * W + x) * 3;
      buf[i] = r * inv; buf[i + 1] = g * inv; buf[i + 2] = b * inv;
    }
  }
  return { W, H, buf };
}

function toBytes(img) {
  const out = new Uint8Array(img.W * img.H * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(img.buf[i])));
  return out;
}

// ----------------------------------------------------------- 5x7 pixel font

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

function textCells(str) {
  const cells = [];
  let cx = 0;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    g.forEach((row, y) => [...row].forEach((b, x) => { if (b === '1') cells.push([cx + x, y]); }));
    cx += 6;
  }
  return { cells, w: cx - 1, h: 7 };
}

function fillRect(img, x0, y0, w, h, rgb) {
  const x1 = Math.min(img.W, Math.round(x0 + w)), y1 = Math.min(img.H, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
    for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
      const i = (y * img.W + x) * 3;
      img.buf[i] = rgb[0]; img.buf[i + 1] = rgb[1]; img.buf[i + 2] = rgb[2];
    }
  }
}

/**
 * Voxel-style block title: hard ground shadow, dark outline, extruded side, flat face.
 * (x, y) is the top-left of the face; p is the size of one font pixel.
 */
function drawTitle(img, str, x, y, p, face, { depth = 0.45, outline = 0.28, shadow = 0.5 } = {}) {
  const { cells } = textCells(str);
  const e = Math.round(p * depth), o = Math.round(p * outline), sh = Math.round(p * shadow);
  // hard shadow: multiply once through a mask so overlaps don't double-darken
  const mask = new Uint8Array(img.W * img.H);
  for (const [cx, cy] of cells) {
    const X = x + cx * p - o + sh, Y = y + cy * p - o + sh;
    for (let yy = Math.max(0, Y); yy < Math.min(img.H, Y + p + 2 * o + e); yy++)
      for (let xx = Math.max(0, X); xx < Math.min(img.W, X + p + 2 * o); xx++) mask[yy * img.W + xx] = 1;
  }
  for (let i = 0; i < mask.length; i++) if (mask[i]) for (let k = 0; k < 3; k++) img.buf[i * 3 + k] *= SHADOW;
  const ink = mulHex(INK, 1), faceRgb = mulHex(face, 1), side = mulHex(face, 0.7);
  for (const [cx, cy] of cells) fillRect(img, x + cx * p - o, y + cy * p - o, p + 2 * o, p + 2 * o + e, ink);
  for (const [cx, cy] of cells) fillRect(img, x + cx * p, y + cy * p + e, p, p, side);
  for (const [cx, cy] of cells) fillRect(img, x + cx * p, y + cy * p, p, p, faceRgb);
}

function titleWidth(str, p) {
  return textCells(str).w * p;
}

/** Dark banner with small white pixel text, centred at cx. */
function drawBanner(img, str, cx, y, p) {
  const w = titleWidth(str, p);
  const pad = p * 2;
  fillRect(img, cx - w / 2 - pad + p * 0.6, y - pad + p * 0.6, w + pad * 2, 7 * p + pad * 2, mulHex(INK, 0.6));
  fillRect(img, cx - w / 2 - pad, y - pad, w + pad * 2, 7 * p + pad * 2, mulHex(INK, 1));
  const { cells } = textCells(str);
  const white = mulHex(BALL_WHITE, 1);
  for (const [x, yy] of cells) fillRect(img, cx - w / 2 + x * p, y + yy * p, p, p, white);
}

// ----------------------------------------------------------- scenes

function pitchGround({ stripe = 3.2, lines = true, goalZ = -12, goalX = 12 } = {}) {
  const lw = 0.32;
  return (x, z) => {
    if (lines) {
      // goal line + six-yard box in front of the goal
      const bx0 = goalX - 11, bx1 = goalX + 11, bz = goalZ + 7;
      if (Math.abs(z - goalZ) < lw) return LINE;
      if (z > goalZ && z < bz + lw && (Math.abs(x - bx0) < lw || Math.abs(x - bx1) < lw)) return LINE;
      if (Math.abs(z - bz) < lw && x > bx0 - lw && x < bx1 + lw) return LINE;
    }
    return Math.floor(z / stripe) & 1 ? GRASS_A : GRASS_B;
  };
}

function iconScene() {
  // Icons get a finer ball than in-game (12^3, realistic ~30% dark) so it reads at 48-192 px.
  const ball = makeBall(12, { face: camDir(), roll: 0.3, patchCos: 0.95 });
  const vs = 10 / 12;
  return {
    objs: [place(ball, vs, -5, 1.2, -5)],
    ground: (x, z) => (Math.floor((z + 100) / 5) & 1 ? GRASS_A : GRASS_B),
    focus: [1.0, 5.2, -0.6],
    size: 10,
  };
}

function coverScene() {
  const goalX = 9, goalZ = -10;
  const ball = makeBall(10, { face: camDir(), roll: 0.9, patchCos: 0.94 });
  const goal = makeGoal(30, 12, 9);
  const vsP = 0.55;
  const striker = makePlayer({ shirt: KIT.red, shirt2: KIT.white, pattern: 'sleeves', shorts: KIT.white, socks: KIT.red, skin: SKIN[3], hair: HAIR[0], number: 9, facing: 2, stride: true });
  const defender = makePlayer({ shirt: KIT.sky, shirt2: KIT.white, pattern: 'sleeves', shorts: KIT.navy, socks: KIT.sky, skin: SKIN[1], hair: HAIR[3], facing: 0 });
  const keeper = makePlayer({ shirt: KIT.orange, shorts: 0x8c4c18, socks: KIT.orange, skin: SKIN[0], hair: HAIR[4], gloves: KIT.white, facing: 0 });
  return {
    objs: [
      place(goal, 0.5, goalX - 7.5, 0, goalZ - 4.5),
      place(keeper, vsP, goalX + 1.2, 0, goalZ - 1.2),
      place(defender, vsP, 2.2, 0, -3.2),
      place(ball, 0.48, -2.2, 2.4, 0.8),
      place(striker, vsP, -5.5, 0, 4.5),
    ],
    ground: pitchGround({ goalX, goalZ }),
  };
}

const CAM = { yaw: (38 * Math.PI) / 180, pitch: (42 * Math.PI) / 180 };
/** Unit vector from the scene towards the camera. */
function camDir() {
  const cp = Math.cos(CAM.pitch);
  return [Math.sin(CAM.yaw) * cp, Math.sin(CAM.pitch), Math.cos(CAM.yaw) * cp];
}

// ----------------------------------------------------------- outputs

function writePNG(rel, img) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  const png = encodePNG(img.W, img.H, toBytes(img), 3);
  writeFileSync(file, png);
  console.log(`  ${rel.padEnd(44)} ${String(img.W).padStart(4)}x${String(img.H).padEnd(4)} ${formatBytes(png.length)}`);
}

function icon(size, { maskable = false } = {}) {
  const s = iconScene();
  // Maskable icons must keep the subject inside the central 80% circle.
  const fill = maskable ? 0.5 : 0.64;
  const scale = s.size / (fill * size);
  return render(s, size, size, { ...CAM, target: s.focus, scale }, FAST ? 1 : 4);
}

/**
 * Cover: voxel scene framed so its centre of interest sits at (fx, fy) (0..1 of the frame),
 * then the title block.
 */
function cover(W, H, layout) {
  const s = coverScene();
  const scale = layout.worldWidth / W;
  // shift the camera target so the scene's focus lands at (fx, fy)
  const focus = [2, 3, -2.5];
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const C = [Math.sin(CAM.yaw) * cp, sp, Math.cos(CAM.yaw) * cp];
  const R = norm([C[2], 0, -C[0]]);
  const U = [C[1] * R[2] - C[2] * R[1], C[2] * R[0] - C[0] * R[2], C[0] * R[1] - C[1] * R[0]];
  const du = (0.5 - layout.fx) * W * scale, dv = (layout.fy - 0.5) * H * scale;
  const target = [focus[0] + R[0] * du + U[0] * dv, focus[1] + R[1] * du + U[1] * dv, focus[2] + R[2] * du + U[2] * dv];
  const img = render(s, W, H, { ...CAM, target, scale }, FAST ? 1 : layout.ss ?? 3);
  layout.title(img);
  return img;
}

function stackedTitle(img, cx, top, p, { banner = true } = {}) {
  const w1 = titleWidth('BLOCKY', p), w2 = titleWidth('LEAGUE', p);
  drawTitle(img, 'BLOCKY', Math.round(cx - w1 / 2), top, p, BALL_WHITE);
  drawTitle(img, 'LEAGUE', Math.round(cx - w2 / 2), top + Math.round(p * 9.2), p, KIT.yellow);
  if (banner) drawBanner(img, 'VOXEL FOOTBALL', cx, top + Math.round(p * 19.5), Math.max(3, Math.round(p * 0.34)));
}

const t0 = Date.now();
console.log(FAST ? 'Rendering (fast preview)…' : 'Rendering…');

// PWA / web icons (shipped in public/)
writePNG('public/icons/icon-192.png', icon(192));
writePNG('public/icons/icon-512.png', icon(512));
writePNG('public/icons/maskable-192.png', icon(192, { maskable: true }));
writePNG('public/icons/maskable-512.png', icon(512, { maskable: true }));
writePNG('public/apple-touch-icon.png', icon(180));
const brandCard = cover(1200, 630, {
  worldWidth: 50, fx: 0.7, fy: 0.5,
  title: (img) => stackedTitle(img, 300, 170, 14),
});
writePNG('public/og-image.png', brandCard);
writePNG('store-assets/blocky-league-logo-1200x630.png', brandCard);

// Store and portal artwork (NOT shipped in builds — upload by hand). Keeping these tracked makes the exact
// submission art reviewable and prevents a release from depending on a developer's ignored `release/` folder.
// Rules checked 2026-09:
//  - Apple App Store: 1024x1024 icon, opaque and square (the store applies the corner mask).
//  - Google Play: 512x512 icon and 1024x500 feature graphic.
//  - CrazyGames: 1920x1080, 800x1200, 800x800; no text except the game title, no borders/logos.
//    https://docs.crazygames.com/requirements/game-covers/
//  - Poki: full-bleed square >= 628x628, avoid text (titles included), no borders.
//    https://developers.poki.com/guide/game-thumbnail
//  - GameDistribution: 512x512, 512x384, 200x120 thumbnails mandatory.
//    https://static.gamedistribution.com/developer/developers-guidelines.html
//  - itch.io: cover image 630x500 (shown scaled down in listings).
const titleOnly = (cx, top, p) => (img) => stackedTitle(img, cx, top, p, { banner: false });
const covers = [
  ['store-assets/google-play-feature-1024x500.png', 1024, 500, { worldWidth: 49, fx: 0.7, fy: 0.52, title: titleOnly(255, 145, 12) }],
  ['store-assets/ios-product-page-1200x630.png', 1200, 630, { worldWidth: 50, fx: 0.7, fy: 0.5, title: titleOnly(300, 190, 14) }],
  ['store-assets/crazygames-landscape-1920x1080.png', 1920, 1080, { worldWidth: 50, fx: 0.7, fy: 0.5, title: titleOnly(480, 360, 22) }],
  ['store-assets/crazygames-portrait-800x1200.png', 800, 1200, { worldWidth: 36, fx: 0.5, fy: 0.62, title: titleOnly(400, 120, 18) }],
  ['store-assets/crazygames-square-800x800.png', 800, 800, { worldWidth: 40, fx: 0.52, fy: 0.64, title: titleOnly(400, 70, 13) }],
  ['store-assets/poki-thumbnail-1024x1024.png', 1024, 1024, { worldWidth: 27, fx: 0.47, fy: 0.5, title: () => {} }],
  ['store-assets/gamedistribution-512x512.png', 512, 512, { worldWidth: 38, fx: 0.52, fy: 0.66, title: titleOnly(256, 34, 9) }],
  ['store-assets/gamedistribution-512x384.png', 512, 384, { worldWidth: 38, fx: 0.55, fy: 0.66, title: titleOnly(256, 22, 8) }],
  ['store-assets/gamedistribution-200x120.png', 200, 120, { worldWidth: 20, fx: 0.47, fy: 0.5, title: () => {} }],
  ['store-assets/itch-cover-630x500.png', 630, 500, { worldWidth: 42, fx: 0.55, fy: 0.64, title: titleOnly(315, 30, 10) }],
  // Generic 16:9 key art with tagline, for your own site / social posts / GameDistribution.
  ['store-assets/keyart-1920x1080.png', 1920, 1080, { worldWidth: 50, fx: 0.7, fy: 0.5, title: (img) => stackedTitle(img, 480, 300, 22) }],
];
for (const [rel, W, H, layout] of covers) writePNG(rel, cover(W, H, layout));

// Store icons deliberately use the simple hero ball rather than tiny lettering: recognisable at home-screen size,
// opaque, and with enough safe area for Android launchers to apply their own circle / squircle masks.
writePNG('store-assets/ios-app-icon-1024.png', icon(1024));
writePNG('store-assets/google-play-icon-512.png', icon(512, { maskable: true }));

console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
