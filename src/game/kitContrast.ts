import { grassLike } from '../meta/data';
import type { Kit } from '../sim/types';

/**
 * Kit contrast for a match: the two sides must read apart at a glance on the broadcast shot. A kit is judged
 * by the colour it reads as from the gantry (stripes, hoops and halves blur into a mix of their two
 * colours; sleeves and a sash barely count), by CIE lightness (L*, 0..1) and hue. Too close, and the away
 * side changes into a plain strip of the opposite lightness: dark against a light home kit, light against a
 * dark one (its own second colour or shorts if that is far enough off, otherwise near-black / off-white).
 */

/** Lightness gap (L*, 0..1) the two sides need; sides of about the same hue need the bigger one. */
export const KIT_MIN_DL = 0.3;
export const KIT_MIN_DL_SAME_HUE = 0.45;
/** Hues closer than this (degrees) count as the same hue, for colours saturated enough to have one. */
const SAME_HUE_DEG = 45;
/** The change strips when neither of the side's own colours will do. */
const CHANGE_DARK = 0x23263a;
const CHANGE_LIGHT = 0xf6f4ec;

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function lin(hex: number): [number, number, number] {
  return [toLin(((hex >> 16) & 255) / 255), toLin(((hex >> 8) & 255) / 255), toLin((hex & 255) / 255)];
}

/** How much of the shirt's second colour shows from the gantry. */
function patternMix(k: Kit): number {
  switch (k.pattern) {
    case 'stripes':
    case 'hoops':
    case 'halves':
      return 0.5;
    case 'sleeves':
      return 0.25;
    case 'sash':
      return 0.2;
    default:
      return 0;
  }
}

export interface KitRead {
  /** CIE lightness, 0 (black) .. 1 (white). */
  l: number;
  /** HSL hue (degrees) and saturation of the colour it reads as. */
  hue: number;
  sat: number;
}

/** A single colour (0xRRGGBB) as it reads: lightness, hue, saturation. */
export function readColor(hex: number): KitRead {
  return readLinear(lin(hex));
}

function readLinear([r, g, b]: [number, number, number]): KitRead {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const l = (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;
  const R = toSrgb(r), G = toSrgb(g), B = toSrgb(b);
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  const hl = (max + min) / 2;
  const sat = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * hl - 1));
  let hue = 0;
  if (d > 1e-6) {
    if (max === R) hue = ((G - B) / d) % 6;
    else if (max === G) hue = (B - R) / d + 2;
    else hue = (R - G) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { l, hue, sat };
}

/** The colour a whole kit's shirt reads as from the broadcast gantry. */
export function readKit(k: Kit): KitRead {
  const w = patternMix(k);
  const a = lin(k.shirt);
  const b = lin(k.shirt2);
  return readLinear([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]);
}

function sameHue(a: KitRead, b: KitRead): boolean {
  if (a.sat < 0.3 || b.sat < 0.3 || a.l < 0.12 || b.l < 0.12 || a.l > 0.95 || b.l > 0.95) return false;
  const d = Math.abs(a.hue - b.hue) % 360;
  return Math.min(d, 360 - d) < SAME_HUE_DEG;
}

/** Do two reads tell apart? Lightness gap of KIT_MIN_DL (KIT_MIN_DL_SAME_HUE for about the same hue). */
export function readsApart(a: KitRead, b: KitRead): boolean {
  const dl = Math.abs(a.l - b.l);
  return dl >= (sameHue(a, b) ? KIT_MIN_DL_SAME_HUE : KIT_MIN_DL);
}

/** The away kit for this fixture: as it is if it reads apart from the home one, else a contrasting change strip. */
export function contrastAwayKit(home: Kit, away: Kit): Kit {
  const h = readKit(home);
  if (readsApart(h, readKit(away))) return away;
  // Opposite lightness to the home side: a dark strip against a light kit, a light one against a dark kit.
  const dark = h.l >= 0.55;
  const fits = (c: number) => {
    const r = readColor(c);
    return !grassLike(c) && (dark ? r.l <= h.l - KIT_MIN_DL_SAME_HUE : r.l >= h.l + KIT_MIN_DL_SAME_HUE) && readsApart(h, r);
  };
  const own = [away.shirt2, away.shorts, away.socks].find(fits);
  const shirt = own ?? (dark ? CHANGE_DARK : CHANGE_LIGHT);
  // Plain (no stripes to blur back towards the home colours), trimmed in the side's own colour, one colour
  // head to toe so the whole player reads as his team.
  const trim = shirt === away.shirt ? away.shirt2 : away.shirt;
  return { ...away, shirt, shirt2: trim, pattern: 'plain', shorts: shirt, socks: shirt };
}

/** Lightness gap (L*, 0..1) between two kits as they read from the gantry. */
export function kitLightnessGap(a: Kit, b: Kit): number {
  return Math.abs(readKit(a).l - readKit(b).l);
}
