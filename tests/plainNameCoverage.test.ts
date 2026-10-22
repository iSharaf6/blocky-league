import { describe, expect, it } from 'vitest';
import { plainName } from '../src/core/displayName';

declare const process: {
  getBuiltinModule(id: 'node:fs'): {
    readFileSync(path: string, enc: 'utf8'): string;
    readdirSync(path: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  };
};
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs');

// CrazyGames' QA, 22 October: "Zając" in Pause > TACTICS beside "T. EKSTRÖM" in the foul banner and ZAJAC on the
// overhead tag read as different players. One spelling everywhere: every player's (and staff member's, and scout
// find's: the same name pool) name goes through core/displayName.ts plainName when it is drawn. The stored name and
// the simulation never change.

/** The surname pool, read from the source (meta/data.ts keeps it private): every accented one in it. */
function accentedSurnames(): string[] {
  const src = readFileSync('src/meta/data.ts', 'utf8');
  const pool = /const LAST = \[([\s\S]*?)\];/.exec(src);
  if (!pool) throw new Error('meta/data.ts: the LAST surname pool was not found');
  const names = [...pool[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return names.filter((n) => /[^\x00-\x7F]/.test(n) && /[^\x00-\x7F’]/.test(n));
}

describe('plainName: one spelling, in plain letters', () => {
  it('the surnames the QA saw and the rest of the pool', () => {
    const want: Record<string, string> = {
      Zając: 'Zajac', Ekström: 'Ekstrom', Wójcik: 'Wojcik', Araújo: 'Araujo', Dembélé: 'Dembele', García: 'Garcia',
      Ibáñez: 'Ibanez', Jovanović: 'Jovanovic', Kovač: 'Kovac', Traoré: 'Traore', Bergström: 'Bergstrom', Šimić: 'Simic',
    };
    for (const [from, to] of Object.entries(want)) expect(plainName(from)).toBe(to);
    const pool = accentedSurnames();
    // (The pool really is read: every name the QA met is in it.)
    for (const n of Object.keys(want)) expect(pool).toContain(n);
    for (const n of pool) {
      const plain = plainName(n);
      expect([...plain].filter((ch) => /\p{L}/u.test(ch) && !/[A-Za-z]/.test(ch)), `${n} -> ${plain}`).toEqual([]);
      expect(plain.length).toBe(n.length);
    }
  });

  it('capitals and full names too, and plain names come back as they went in', () => {
    expect(plainName('ZAJĄC')).toBe('ZAJAC');
    expect(plainName('T. EKSTRÖM')).toBe('T. EKSTROM');
    expect(plainName('J. Zając').toUpperCase()).toBe('J. ZAJAC');
    expect(plainName('Łukasz Øde Đorđe Strauß')).toBe('Lukasz Ode Dorde Strauss');
    for (const n of ['A. Pebble', 'Van Dijk', 'O’Brien', 'De Jong', 'B. Cinder 2']) expect(plainName(n)).toBe(n);
    expect(plainName(plainName('Šimić'))).toBe('Simic');
  });
});

// ------------------------------------------------------------------ the source scan

const ROOTS = ['src/ui', 'src/render', 'src/game'];
const EXTRA = ['src/main.ts'];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * A player's name as code reaches it: his def's name, a player / scout find / record holder's name, or one of the
 * names a screen calls the people it is about (the bench's off and on, the best, the man of the match, the scorer,
 * the captain, a mentor and his pupil, a staff member `m`, a legend `l`, a retiring player `f`, a rating row `r`).
 */
const PLAYER_NAME = new RegExp(
  [
    String.raw`\.def\??\.name\b`,
    String.raw`\.player\??\.name\b`,
    String.raw`\b(?:topScorer|mostApps|recordSigning)\??\.name\b`,
    String.raw`(?<![\w$.])(?:p|q|g|r|l|f|m|player|off|on|best|motm|scorer|cap|hero|kid|vet|pupil|gone|replaced|starter|sad|leader|runner|taker|by|shot)\??\.name\b`,
    String.raw`\.(?:off|on|replaced|starter)\??\.name\b`,
  ].join('|'),
  'g',
);

/**
 * Calls that put a name on show already in plain letters: plainName itself, and each screen's own helpers, which this
 * test also checks are built on it (HELPERS below).
 */
const PLAIN_CALLS = new Set(['plainName', 'lastName', 'surname', 'sur', 'last', 'calloutName', 'shortName', 'story', 'sn', 'two']);

/** Where a helper named in PLAIN_CALLS is defined: its body must call plainName (directly or through surname). */
const HELPERS: [file: string, def: RegExp][] = [
  ['src/ui/menus.ts', /function lastName\(/],
  ['src/ui/club.ts', /function lastName\(/],
  ['src/ui/shop.ts', /function lastName\(/],
  ['src/ui/glory.ts', /const lastName = /],
  ['src/ui/glory.ts', /const story = /],
  ['src/ui/squadStats.ts', /const lastName = /],
  ['src/ui/forever.ts', /const last = /],
  ['src/ui/commentary.ts', /export function surname\(/],
  ['src/ui/commentary.ts', /private sn\(/],
  ['src/ui/trainer.ts', /export function calloutName\(/],
  ['src/ui/quickSub.ts', /const shortName = /],
  ['src/game/showcase.ts', /const sur = /],
];

/** Lines that put text on screen outside a template literal: a text node, a canvas, a banner, a toast. */
const SINK = /\.(?:textContent|innerText|innerHTML)\s*=|\b(?:fillText|strokeText)\(|\.show\(|\btoast\(|\bsay\(|\bdone\(/;

/**
 * Hits the expression can't tell from a player: not a player's name at all, or one only a screen reader hears.
 * Each entry: file, a piece of the line, and why it may stay.
 */
const ALLOW: [file: string, piece: string, why: string][] = [
  ['src/ui/forever.ts', 'esc(r.name.toUpperCase())}<small>FOLLOWS YOU', 'YOUR RIVAL: r is the rival club'],
  ['src/ui/forever.ts', '<div class="fv-row fv-past">', 'HALL OF FAME, clubs you built before: p is a past club'],
  ['src/ui/playerCard.ts', 'const label = `${p.name}, ${p.role}', 'the card section\'s aria-label only'],
];

/**
 * Sites the scan can't follow (the name is kept in a field and drawn later): each must spell it through plainName.
 * The overhead tags, the HUD's player chip, the studio screen's scorer, the incident replay's caption, the sub board.
 */
const PINNED: [file: string, site: RegExp][] = [
  ['src/render/matchView.ts', /this\.names\.push\(plainName\(p\.name/],
  ['src/render/matchView.ts', /this\.names\[i\] = plainName\(def\.name/],
  ['src/ui/hud.ts', /setPlayer\(num: number, name: string[^]*?const up = plainName\(name\)/],
  ['src/render/sideStage.ts', /const name = plainName\(s\.scorer\)/],
  ['src/game/incidentReplay.ts', /\$\{d\.number\} \$\{plainName\(d\.name\)/],
  ['src/ui/presentHud.ts', /<span>\$\{escHtml\(plainName\(off\.name\)/],
  ['src/ui/presentHud.ts', /<span>\$\{escHtml\(plainName\(on\.name\)/],
];

interface Hit { file: string; line: number; text: string }

/** The `${ ... }` interpolations open at each column of a line (by brace depth), innermost last. */
function openInterps(line: string, upto: number): number[] {
  const stack: { at: number; interp: boolean }[] = [];
  for (let i = 0; i < upto; i++) {
    const c = line[i];
    if (c === '$' && line[i + 1] === '{') {
      stack.push({ at: i, interp: true });
      i++;
    } else if (c === '{') stack.push({ at: i, interp: false });
    else if (c === '}') stack.pop();
  }
  return stack.filter((s) => s.interp).map((s) => s.at);
}

/** Is column `at` inside the parentheses of a call to a PLAIN_CALLS helper (from column `from`)? */
function insidePlainCall(line: string, from: number, at: number): boolean {
  const open: string[] = [];
  for (let i = from; i < at; i++) {
    const c = line[i];
    if (c === '(') {
      const name = /([\w$]+)\s*$/.exec(line.slice(from, i))?.[1] ?? '';
      open.push(name);
    } else if (c === ')') open.pop();
  }
  return open.some((n) => PLAIN_CALLS.has(n));
}

function inAriaLabel(line: string, at: number): boolean {
  if (/setAttribute\(\s*'aria-label'/.test(line)) return true;
  const i = line.lastIndexOf('aria-label="', at);
  return i >= 0 && !line.slice(i + 'aria-label="'.length, at).includes('"');
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  const files = [...ROOTS.flatMap(tsFiles), ...EXTRA];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, n) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const m of line.matchAll(PLAYER_NAME)) {
        const at = m.index ?? 0;
        const interps = openInterps(line, at);
        const inTemplate = interps.length > 0;
        if (!inTemplate && !SINK.test(line)) continue;
        if (inAriaLabel(line, at)) continue;
        const from = inTemplate ? interps[interps.length - 1] : 0;
        if (insidePlainCall(line, from, at)) continue;
        if (ALLOW.some(([f, piece]) => f === file && line.includes(piece))) continue;
        hits.push({ file, line: n + 1, text: t.slice(0, 160) });
      }
    });
  }
  return hits;
}

describe('every player name on screen goes through plainName', () => {
  it('the helpers the screens name players with are built on plainName', () => {
    const bad: string[] = [];
    for (const [file, def] of HELPERS) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const i = lines.findIndex((l) => def.test(l));
      if (i < 0) {
        bad.push(`${file}: ${def} not found`);
        continue;
      }
      // (The definition and the few lines of its body.)
      const body = lines.slice(i, i + 5).join('\n');
      if (!/\b(?:plainName|surname)\(/.test(body)) bad.push(`${file}:${i + 1} ${lines[i].trim()}`);
    }
    expect(bad, `helpers that show a name without plainName:\n${bad.join('\n')}`).toEqual([]);
  });

  it('no player name reaches visible text (DOM or canvas) in its stored spelling', () => {
    const hits = scan();
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.text}`), 'wrap these in plainName (core/displayName.ts)').toEqual([]);
  });

  it('names kept for later are drawn through plainName too (tags, chip, studio screen, replay caption, sub board)', () => {
    const missing = PINNED.filter(([file, site]) => !site.test(readFileSync(file, 'utf8')));
    expect(missing.map(([f, s]) => `${f}: ${s}`)).toEqual([]);
  });

  it('the allowlist only holds lines that still exist (no stale entries)', () => {
    const stale = ALLOW.filter(([file, piece]) => !readFileSync(file, 'utf8').includes(piece));
    expect(stale.map(([f, p]) => `${f}: ${p}`)).toEqual([]);
  });

  it('the two lines the QA reported: TACTICS chips and the foul banner', () => {
    const menus = readFileSync('src/ui/menus.ts', 'utf8');
    expect(menus).toMatch(/<em class="tx-nm">\$\{escHtml\(lastName\(p\.def\.name\)\)\}<\/em>/);
    const session = readFileSync('src/game/matchSession.ts', 'utf8');
    expect(session).toMatch(/BY \$\{by\.def\.number\} \$\{plainName\(by\.def\.name\)\.toUpperCase\(\)\}/);
  });
});
