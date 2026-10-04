/**
 * Crisp pixel icons, drawn as inline SVG: 10 by 10 grids where 'X' is a filled cell. Every icon in the game that
 * would otherwise be an emoji (moments, power-ups, locks, streaks, gifts) is one of these, so the whole UI keeps
 * one chunky voxel look and no platform's emoji set shows up. (tests/uiCopy.test.ts fails on any emoji in src/.)
 */

const ICON_ROWS = {
  ball: [
    '..XXXXXX..', '.XX.XX.XX.', 'XX..XX..XX', 'X.XX..XX.X', 'XXX.XX.XXX',
    'XXX.XX.XXX', 'X.XX..XX.X', 'XX..XX..XX', '.XX.XX.XX.', '..XXXXXX..',
  ],
  trophy: [
    'XXXXXXXXXX', 'X.XXXXXX.X', 'X.XXXXXX.X', '.XXXXXXXX.', '..XXXXXX..',
    '...XXXX...', '....XX....', '....XX....', '..XXXXXX..', '..XXXXXX..',
  ],
  shirt: [
    '..XX..XX..', 'XXXX..XXXX', 'XXXXXXXXXX', 'XXXXXXXXXX', '.XXXXXXXX.',
    '..XXXXXX..', '..XXXXXX..', '..XXXXXX..', '..XXXXXX..', '..XXXXXX..',
  ],
  gear: [
    '....XX....', '.X.XXXX.X.', '..XXXXXX..', '.XXX..XXX.', 'XXX....XXX',
    'XXX....XXX', '.XXX..XXX.', '..XXXXXX..', '.X.XXXX.X.', '....XX....',
  ],
  star: [
    '....XX....', '....XX....', '...XXXX...', 'XXXXXXXXXX', '.XXXXXXXX.',
    '..XXXXXX..', '..XXXXXX..', '.XXX..XXX.', 'XX......XX', 'X........X',
  ],
  /** Two players (ONLINE: play a friend). */
  duo: [
    '.XX....XX.', '.XX....XX.', '..........', 'XXXX..XXXX', 'XXXX..XXXX',
    'XXXX..XXXX', '.XX....XX.', '.XX....XX.', '.XX....XX.', '..........',
  ],
  lock: [
    '...XXXX...', '..XX..XX..', '..X....X..', '..X....X..', '.XXXXXXXX.',
    '.XXXXXXXX.', '.XXXX.XXX.', '.XXXX.XXX.', '.XXXXXXXX.', '.XXXXXXXX.',
  ],
  /** A lightning bolt (BLITZ, TURBO, the touch power button). */
  bolt: [
    '......XXX.', '.....XXX..', '....XXX...', '...XXX....', '..XXXXXXX.',
    '.....XXX..', '....XXX...', '...XXX....', '..XXX.....', '..XX......',
  ],
  /** A player in full stride. */
  run: [
    '.....XX...', '.....XX...', '..XX.XXX..', '...XXXX.XX', '....XXXX..',
    '....XXX...', '...XX.XX..', '..XX...XX.', '.XX.....XX', 'XX........',
  ],
  /** A curved arrow: the ball whipped in from the wing. */
  cross: [
    '.....X....', '.....XX...', '..XXXXXXX.', '.XXXXXXXXX', '.XX..XXXX.',
    '.XX..XX...', 'XX...X....', 'XX........', 'XX........', 'XX........',
  ],
  /** A corner flag. */
  flag: [
    '.XXXXXXX..', '.XXXXXXXX.', '.XXXXXXX..', '.XXXXXX...', '.XX.......',
    '.XX.......', '.XX.......', '.XX.......', '.XX.......', 'XXXX......',
  ],
  shield: [
    'XXXXXXXXXX', 'XXXXXXXXXX', 'XXXX..XXXX', 'XXXX..XXXX', 'XXXX..XXXX',
    '.XXX..XXX.', '.XXXXXXXX.', '..XXXXXX..', '...XXXX...', '....XX....',
  ],
  crown: [
    '..........', 'X...XX...X', 'XX..XX..XX', 'XXX.XX.XXX', 'XXXXXXXXXX',
    'XXXXXXXXXX', 'XXXXXXXXXX', '..........', 'XXXXXXXXXX', '..........',
  ],
  /** Two arrows, one each way (a substitution). */
  swap: [
    '......X...', '......XX..', 'XXXXXXXXX.', '......XX..', '......X...',
    '...X......', '..XX......', '.XXXXXXXXX', '..XX......', '...X......',
  ],
  fire: [
    '.....X....', '....XXX...', '...XXXXX.X', '...XXXXXXX', '..XXXXXXXX',
    '.XXXXX.XXX', '.XXXX...XX', '.XXXX...XX', '..XXXX.XX.', '...XXXXX..',
  ],
  gift: [
    '..XX..XX..', '.XXXXXXXX.', 'XXXX..XXXX', 'XXXX..XXXX', '.XXX..XXX.',
    '.XXX..XXX.', '.XXX..XXX.', '.XXX..XXX.', '.XXX..XXX.', '.XXXXXXXX.',
  ],
  /** A play button in a screen (watch a clip). */
  film: [
    '..........', '.XXXXXXXX.', 'XXXXXXXXXX', 'XXX.XXXXXX', 'XXX..XXXXX',
    'XXX...XXXX', 'XXX...XXXX', 'XXX..XXXXX', 'XXX.XXXXXX', '.XXXXXXXX.',
  ],
  /** A snowflake (FREEZE). */
  freeze: [
    '....XX....', '.X..XX..X.', '..X.XX.X..', '...XXXX...', 'XXXXXXXXXX',
    'XXXXXXXXXX', '...XXXX...', '..X.XX.X..', '.X..XX..X.', '....XX....',
  ],
  /** A horseshoe magnet. */
  magnet: [
    'XXXX..XXXX', 'XXXX..XXXX', '..........', 'XXXX..XXXX', 'XXXX..XXXX',
    'XXXX..XXXX', 'XXXX..XXXX', 'XXXXXXXXXX', '.XXXXXXXX.', '..XXXXXX..',
  ],
  /** A starburst (MEGA SHOT). */
  burst: [
    '....XX....', '.X..XX..X.', '..XXXXXX..', '.XXXXXXXX.', 'XXXXXXXXXX',
    'XXXXXXXXXX', '.XXXXXXXX.', '..XXXXXX..', '.X..XX..X.', '....XX....',
  ],
  /** A stopwatch (beat the clock). */
  clock: [
    '...XXXX...', '....XX....', '..XXXXXX..', '.XX.XX.XX.', 'XX..XX..XX',
    'XX..XXXXXX', 'XX......XX', '.XX....XX.', '..XXXXXX..', '..........',
  ],
  /** A film camera: two reels on the body, the lens to the right (the match camera button). */
  camera: [
    '.XX..XX...', 'X..XX..X..', 'X..XX..X..', '.XX..XX...', 'XXXXXXX..X',
    'XXXXXXX.XX', 'XXXXXXXXXX', 'XXXXXXX.XX', 'XXXXXXX..X', '..........',
  ],
  /** Two beamed notes (the crowd is singing: the chant caption). */
  note: [
    '...XXXXXXX', '...XXXXXXX', '...X.....X', '...X.....X', '...X.....X',
    '...X.....X', '.XXX...XXX', 'XXXX..XXXX', 'XXXX..XXXX', '.XX....XX.',
  ],
  /** A medical cross (the physio, an injured player). */
  medic: [
    '...XXXX...', '...XXXX...', '...XXXX...', 'XXXXXXXXXX', 'XXXXXXXXXX',
    'XXXXXXXXXX', 'XXXXXXXXXX', '...XXXX...', '...XXXX...', '...XXXX...',
  ],
  /** A magnifying glass (a scout, a scout report). */
  scout: [
    '..XXXX....', '.XX..XX...', 'XX....XX..', 'XX....XX..', 'XX....XX..',
    '.XX..XX...', '..XXXXXX..', '......XXX.', '.......XXX', '........XX',
  ],
  /** A speech bubble (a press conference, the team talk). */
  chat: [
    '.XXXXXXXX.', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XX.XX.XX.X', 'XXXXXXXXXX',
    'XXXXXXXXXX', '.XXXXXXXX.', '..XXX.....', '..XX......', '..X.......',
  ],
  /** A coin (a sponsor, the commercial manager). */
  coin: [
    '..XXXXXX..', '.XXXXXXXX.', 'XXXX..XXXX', 'XXX.XXXXXX', 'XXX.XXXXXX',
    'XXX.XXXXXX', 'XXX.XXXXXX', 'XXXX..XXXX', '.XXXXXXXX.', '..XXXXXX..',
  ],
  /** A rising line on a base (a player growing). */
  chart: [
    '.......XXX', '........XX', '......XX.X', '..X..XX...', '.XXXXX....',
    'XX.XX.....', 'X.........', '..........', 'XXXXXXXXXX', 'XXXXXXXXXX',
  ],
  /** Three faces: a player's morale, high, steady and low. */
  happy: [
    '..XXXXXX..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XX.XXXX.XX', 'XXXXXXXXXX',
    'XXXXXXXXXX', 'X.XXXXXX.X', 'XX......XX', '.XXXXXXXX.', '..XXXXXX..',
  ],
  okay: [
    '..XXXXXX..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XX.XXXX.XX', 'XXXXXXXXXX',
    'XXXXXXXXXX', 'XX......XX', 'XXXXXXXXXX', '.XXXXXXXX.', '..XXXXXX..',
  ],
  sad: [
    '..XXXXXX..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XX.XXXX.XX', 'XXXXXXXXXX',
    'XXXXXXXXXX', 'XX......XX', 'X.XXXXXX.X', '.XXXXXXXX.', '..XXXXXX..',
  ],
} satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_ROWS;
export const ICONS: Readonly<Record<string, readonly string[]>> = ICON_ROWS;
export const ICON_NAMES = Object.keys(ICON_ROWS) as IconName[];

/**
 * A crisp pixel icon as inline SVG. `px` is the size of one cell (the icon is 10 cells square); `cls` adds classes
 * beside "picon" (CSS sets the real size where it differs by screen). An unknown name draws nothing.
 */
export function pixelIcon(name: string, color = '#fbfbf4', px = 5, cls = ''): string {
  const rows = ICONS[name];
  if (!rows) return '';
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }));
  const n = rows.length;
  return `<svg class="picon${cls ? ` ${cls}` : ''}" width="${n * px}" height="${n * px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="${color}" aria-hidden="true">${rects}</svg>`;
}
