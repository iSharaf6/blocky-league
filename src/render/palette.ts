// Flat, saturated toy colours. Everything in the world pulls from here so the
// frame reads as one art language.

export const SKIN = [0xf8dcc0, 0xf0c49c, 0xdca577, 0xb97b4c, 0x8c5634, 0x5c3721];
export const HAIR = [0x2a1d16, 0x4a2e1c, 0x7a4a26, 0xe8c25a, 0xc8602a, 0xe6e2da, 0x1c1c22, 0x3a72ff];

export const GRASS_A = 0xa2d65c;
export const GRASS_B = 0x94cc4f;
export const GRASS_OUT_A = 0x8fc84c;
export const GRASS_OUT_B = 0x86bf45;
export const LINE = 0xfbfbf4;
export const CONCRETE = 0xd9d6cc;
export const CONCRETE_DARK = 0xb9b5aa;
export const STEEL = 0x5a6270;
export const TRUNK = 0x8a5a36;
export const LEAF_A = 0x5fbf45;
export const LEAF_B = 0x4ea83a;
export const LEAF_C = 0x78cf52;
export const ROAD = 0x5b5e66;
export const WATER = 0x5cc9f2;
export const SAND = 0xf0dc9a;
export const SKY_TOP = 0x6fc6f2;
export const SKY_BOTTOM = 0xd8f1ff;
export const BALL_WHITE = 0xfbfbf6;
export const BALL_BLACK = 0x26262e;

export function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function cssHex(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
