import { version } from '../../package.json';
import { LOGO_ROWS, MARK_ROWS, rowsSvg } from '../core/calynxArt';

/**
 * Calynx, the studio: its logo as pixel art (src/core/calynxArt.ts, generated from the studio's own artwork), drawn
 * as crisp SVG at any size with no font needed. The boot splash in index.html carries a static copy of the same
 * logo; keep the two in step.
 */
export const STUDIO = 'Calynx';
export const STUDIO_BLUE = '#2230d6';
export const APP_VERSION: string = version;

/**
 * The lynx-x mark on its own, about `px` × 16 CSS pixels tall (the old 16-cell mark's footprint, so callers keep
 * their layout). `white` is unused now (the mark is one colour) and kept for the call sites.
 */
export function lynxSvg(px = 2, blue = STUDIO_BLUE, _white = '#fbfbf4', cls = 'lynx'): string {
  return rowsSvg(MARK_ROWS, Math.round(16 * px), blue, cls);
}

/** The full Calynx logo (wordmark with the lynx in the x), about `px` × 12 CSS pixels tall. */
export function wordmarkSvg(px = 3, color = STUDIO_BLUE, _word = 'CALYNX', cls = 'wordmark'): string {
  return rowsSvg(LOGO_ROWS, Math.round(12 * px), color, cls, STUDIO);
}

/** The title-screen credit: "a", the logo in cream, "game" (small caps via CSS). */
export function creditHtml(): string {
  return `<p class="credit"><span>a</span>${rowsSvg(LOGO_ROWS, 22, '#fbfbf4', 'logo', STUDIO)}<span>game</span></p>`;
}
