import { version } from '../../package.json';

/**
 * Calynx, the studio: the pixel lynx mark and wordmark, drawn from bitmaps so they are crisp at any size and
 * need no font to have loaded (the boot splash in index.html carries a static copy of the same mark; keep the
 * two in step). Modelled on the studio logo: a lynx head with tall tufted ears and a wide ruff, in studio blue.
 */
export const STUDIO = 'Calynx';
export const STUDIO_BLUE = '#2230d6';
export const APP_VERSION: string = version;

/** 16 × 16: '.' empty, 'B' studio blue, 'W' the white tufts, eyes and cheek marks. */
export const LYNX_ROWS: readonly string[] = [
  '.....B......B...',
  '....BB......BB..',
  '....BB......BB..',
  '....BBB....BBB..',
  '....BWBB..BBWB..',
  '....BWBBBBBBWB..',
  '...BBBBBBBBBBBB.',
  '..BBBBBBBBBBBBBB',
  '.BBBBWWBBBBWWBBB',
  '.BBBBWBBBBBBWBBB',
  'BBWBBBBBBBBBBBWB',
  'BBBWBBBBBBBBBWBB',
  '.BBBBBBBWBBBBBB.',
  '..BBBBBWWWBBBB..',
  '...BBBBBBBBBB...',
  '.....BBBBBB.....',
];

/** 5 × 7 pixel capitals for the wordmark. */
const LETTERS: Record<string, string[]> = {
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  X: ['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'],
};

function rects(rows: readonly string[], want: string, x0 = 0): string {
  let out = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === want) out += `<rect x="${x0 + x}" y="${y}" width="1" height="1"/>`;
  }));
  return out;
}

/** The lynx head, `px` CSS pixels a cell. `white` is the tuft / eye colour (the cream of the UI by default). */
export function lynxSvg(px = 2, blue = STUDIO_BLUE, white = '#fbfbf4', cls = 'lynx'): string {
  const n = LYNX_ROWS.length;
  return `<svg class="${cls}" width="${n * px}" height="${n * px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<g fill="${blue}">${rects(LYNX_ROWS, 'B')}</g><g fill="${white}">${rects(LYNX_ROWS, 'W')}</g></svg>`;
}

/** "CALYNX" in pixel capitals, `px` CSS pixels a cell. */
export function wordmarkSvg(px = 3, color = STUDIO_BLUE, word = 'CALYNX', cls = 'wordmark'): string {
  let body = '';
  let x = 0;
  for (const ch of word) {
    const rows = LETTERS[ch];
    if (!rows) continue;
    body += rects(rows, 'X', x);
    x += 6;
  }
  const w = Math.max(1, x - 1);
  return `<svg class="${cls}" width="${w * px}" height="${7 * px}" viewBox="0 0 ${w} 7" shape-rendering="crispEdges" fill="${color}" role="img" aria-label="${word}">${body}</svg>`;
}

/** The title-screen credit: the mark and "a Calynx game" (small caps via CSS). */
export function creditHtml(): string {
  return `<p class="credit">${lynxSvg(2)}<span>a ${STUDIO} game</span></p>`;
}
