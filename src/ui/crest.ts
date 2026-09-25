import { hashString } from '../core/rng';
import { cssHex, shade } from '../render/palette';
import type { Kit } from '../sim/types';

// 5x7 pixel capitals for the crest initial.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00001', '00001', '00001', '10001', '10001', '01110'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10010', '10001', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '01010', '10001', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
};

type Shape = 'shield' | 'round' | 'diamond' | 'block';
const SHAPES: Shape[] = ['shield', 'round', 'diamond', 'block'];

function inside(shape: Shape, x: number, y: number, W: number, H: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const cx = (W - 1) / 2;
  const nx = Math.abs(x - cx) / (W / 2);
  const ny = y / (H - 1);
  switch (shape) {
    case 'shield':
      return ny < 0.62 ? true : nx <= 1 - (ny - 0.62) / 0.4;
    case 'round': {
      const cy = (H - 1) / 2;
      return Math.hypot((x - cx) / (W / 2), (y - cy) / (H / 2)) <= 1.02;
    }
    case 'diamond': {
      const cy = (H - 1) / 2;
      return Math.abs(x - cx) / (W / 2) + Math.abs(y - cy) / (H / 2) <= 1.08;
    }
    default:
      return !((x === 0 || x === W - 1) && (y === 0 || y === H - 1));
  }
}

/**
 * Deterministic pixel crest for a club: shape and band style come from the name,
 * colours from the kit, and the club's initial sits in the middle.
 */
export function crestSvg(name: string, short: string, kit: Kit, px = 3): string {
  const h = hashString(name);
  const shape = SHAPES[h % SHAPES.length];
  const band = (h >> 3) % 3; // 0 plain, 1 horizontal band, 2 vertical split
  const W = 13;
  const H = 15;
  const a = kit.shirt;
  const b = kit.shirt2 === a ? 0xfbfbf4 : kit.shirt2;
  const ink = 0x26262e;
  const letter = GLYPHS[(short || name).charAt(0).toUpperCase()] ?? GLYPHS.B;
  let rects = '';
  const put = (x: number, y: number, c: number) => {
    rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${cssHex(c)}"/>`;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(shape, x, y, W, H)) continue;
      const edge = !inside(shape, x - 1, y, W, H) || !inside(shape, x + 1, y, W, H) || !inside(shape, x, y - 1, W, H) || !inside(shape, x, y + 1, W, H);
      if (edge) {
        put(x, y, ink);
        continue;
      }
      let c = a;
      if (band === 1 && y >= 2 && y <= 4) c = b;
      if (band === 2 && x < W / 2) c = b;
      if (y === 1) c = shade(c, 1.15);
      put(x, y, c);
    }
  }
  // The initial, in a colour that reads on the field.
  const lum = (((a >> 16) & 255) * 0.3 + ((a >> 8) & 255) * 0.59 + (a & 255) * 0.11) / 255;
  const letterC = lum > 0.62 ? ink : 0xfbfbf4;
  letter.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      if (ch === '1') put(4 + rx, 4 + ry, letterC);
    });
  });
  return `<svg class="crest-svg" width="${W * px}" height="${H * px}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
