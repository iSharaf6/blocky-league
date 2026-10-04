import { CREST_H, CREST_W, crestFor, crestPixels, type CrestDesign } from '../core/crest';
import type { Kit } from '../sim/types';

/**
 * A club's pixel crest as inline SVG (core/crest.ts draws it: a shape, a field pattern, an emblem and an optional
 * banner). Your own club's is the one you designed; every other club's comes from its name and colours.
 *
 * The crest is CREST_W x CREST_H cells in a 13 x 15 box, so `px` is the size of two cells (the same box the old 13 x 15
 * crest filled: nothing around it moves). Cells of one colour in a row are merged into one rect.
 */
export function crestDesignSvg(d: CrestDesign, short: string, name: string, px = 3, cls = ''): string {
  const p = crestPixels(d, short, name);
  let rects = '';
  for (let y = 0; y < CREST_H; y++) {
    let x = 0;
    while (x < CREST_W) {
      const c = p[y * CREST_W + x];
      if (c < 0) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < CREST_W && p[y * CREST_W + x + w] === c) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="#${c.toString(16).padStart(6, '0')}"/>`;
      x += w;
    }
  }
  return `<svg class="crest-svg${cls ? ` ${cls}` : ''}" width="${(CREST_W / 2) * px}" height="${(CREST_H / 2) * px}" viewBox="0 0 ${CREST_W} ${CREST_H}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** The crest of the club called `name` (`short`, in `kit`), `px` to two cells: see crestDesignSvg. */
export function crestSvg(name: string, short: string, kit: Kit, px = 3): string {
  return crestDesignSvg(crestFor(name, short, kit), short, name, px);
}
