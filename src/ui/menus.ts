import { sfx } from '../audio/sfx';
import type { SaveData } from '../core/save';
import { clubRating as presetRating } from '../meta/cup';
import { PRESET_CLUBS, makeTeam, type ClubSeed } from '../meta/data';
import { KitPreview, faceHtml, hydrateFaces } from './preview';
import { crestSvg } from './crest';
import { speechAvailable } from './commentary';
import { cssHex, shade } from '../render/palette';
import { FORMATIONS, FORMATION_IDS, type Slot } from '../sim/formations';
import type { Match } from '../sim/match';
import { overall, type FormationId, type Kit, type PlayerDef } from '../sim/types';

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'LEGEND'];
export const DIFF_LEVEL = [0.6, 1.8, 3, 4];
export const HALF_OPTIONS = [1.5, 2, 3, 4];

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Live info for the main menu tiles. */
export interface MainInfo {
  captain?: { def: PlayerDef; kit: Kit; club: string; ovr: number };
  quick?: string;
  career?: string;
  club?: string;
  cup?: string;
  gift?: { amount: number; streak: number };
}

/** Pixel-art shirt drawn as a CSS grid, so kit previews match the voxel look. */
export function shirtArt(kit: Kit, size = 8): string {
  const W = 12;
  const H = 11;
  const mask = [
    '...XX..XX...',
    '.XXXX..XXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
  ];
  let cells = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y][x] !== 'X') {
        cells += '<i></i>';
        continue;
      }
      let c = kit.shirt;
      const sleeve = y >= 1 && y <= 4 && (x < 2 || x > 9);
      if (kit.pattern === 'stripes' && x % 2 === 1 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'hoops' && y % 2 === 0 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'halves' && x < 6) c = kit.shirt2;
      if (kit.pattern === 'sash' && Math.abs(x - (y + 1)) <= 1 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'sleeves' && sleeve) c = kit.shirt2;
      if (y === 1 && (x === 4 || x === 7)) c = shade(kit.shirt2, 0.9);
      if (y === H - 1) c = shade(c, 0.82);
      cells += `<i style="background:${cssHex(c)}"></i>`;
    }
  }
  return `<div class="shirt" style="--px:${size}px;grid-template-columns:repeat(${W},var(--px))">${cells}</div>`;
}

const ICONS: Record<string, string[]> = {
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
};

/** Crisp pixel icon as inline SVG. */
export function pixelIcon(name: string, color = '#fbfbf4', px = 5): string {
  const rows = ICONS[name];
  if (!rows) return '';
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }));
  const n = rows.length;
  return `<svg class="picon" width="${n * px}" height="${n * px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="${color}" aria-hidden="true">${rects}</svg>`;
}

/** 1-5 stars from a squad OVR (the same teamRating number shown everywhere else). */
export function starCount(ovr: number): number {
  return Math.max(1, Math.min(5, Math.round((ovr - 40) / 10)));
}

export function stars(ovr: number): string {
  const n = starCount(ovr);
  return `<span class="stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<s>${'★'.repeat(5 - n)}</s></span>`;
}

function lum(hex: number): number {
  return (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/**
 * Where each formation slot sits on the vertical team-sheet pitch (own goal at the bottom), as
 * [left %, top %, room %]: room is the horizontal space the token may use (its name tag) without meeting a neighbour.
 * Slots are grouped into lines (same role, split where a role spans two bands, e.g. 4-2-3-1's DMs and AMs);
 * lines are evenly spaced top to bottom and each line is spread wide enough that tokens never overlap, while
 * keeping a hint of the real shape (a deeper DM, wing-backs pushed on).
 */
export function pitchLayout(slots: Slot[]): [number, number, number][] {
  const out: [number, number, number][] = slots.map(() => [50, 50, 30]);
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => a.s.x - b.s.x);
  const lines: { s: Slot; i: number }[][] = [];
  for (const o of order) {
    const line = lines[lines.length - 1];
    const prev = line?.[line.length - 1];
    if (line && prev && prev.s.role === o.s.role && o.s.x - prev.s.x <= 0.2) line.push(o);
    else lines.push([o]);
  }
  const n = lines.length;
  const bottom = 87;
  const top = 8;
  lines.forEach((line, li) => {
    const y = n > 1 ? bottom - (li / (n - 1)) * (bottom - top) : 50;
    const mx = line.reduce((a, o) => a + o.s.x, 0) / line.length;
    const byZ = [...line].sort((a, b) => a.s.z - b.s.z);
    const zs = byZ.map((o) => o.s.z);
    const k = byZ.length;
    const centre = k > 1 ? (zs[0] + zs[k - 1]) / 2 : zs[0];
    // At least half a unit between neighbours, but a line never spills past ±0.92 (a back five is 0.46 apart).
    const gap = k > 1 ? Math.min(Math.max((zs[k - 1] - zs[0]) / (k - 1), 0.5), 1.84 / (k - 1)) : 0;
    const half = (gap * (k - 1)) / 2;
    const c = Math.max(-0.92 + half, Math.min(0.92 - half, centre));
    const room = k > 1 ? Math.round(gap * 43 - 1) : 40;
    byZ.forEach((o, j) => {
      const z = k > 1 ? c - half + j * gap : c;
      const nudge = Math.max(-4, Math.min(4, (o.s.x - mx) * 60));
      const t = Math.max(top, Math.min(bottom, y - nudge));
      out[o.i] = [Math.round((50 + z * 43) * 10) / 10, Math.round(t * 10) / 10, room];
    });
  });
  return out;
}

/** Touch screens get the touch controls first (a coarse pointer, i.e. a phone or tablet). */
export function defaultDevice(): 'keyboard' | 'touch' {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
  } catch {
    return 'keyboard';
  }
}

const HOWTO_KEYS = `
  <div class="howto">
    <div class="ht-col">
      <h3>ATTACK</h3>
      <p><kbd>WASD</kbd> / <kbd>←↑→↓</kbd> move</p>
      <p><kbd>SPACE</kbd> pass (aim with the stick)</p>
      <p><kbd>K</kbd> hold &amp; release to shoot</p>
      <p>Hold <kbd>K</kbd> + tap <kbd>L</kbd>: chip the keeper</p>
      <p>Soft <kbd>K</kbd> with a diagonal stick: finesse curler</p>
      <p><kbd>L</kbd> tap: through ball · hold: lob / cross</p>
      <p><kbd>SHIFT</kbd> sprint · double-tap to knock it past a defender</p>
    </div>
    <div class="ht-col">
      <h3>DEFEND</h3>
      <p><kbd>SPACE</kbd> switch player</p>
      <p><kbd>K</kbd> slide tackle</p>
      <p><kbd>L</kbd> hold to press the ball</p>
      <p>Run into the dribbler to steal it</p>
      <p><kbd>ESC</kbd> pause</p>
    </div>
  </div>
  <p class="fine">First-time finish: press SHOOT just before a pass or cross reaches you.</p>`;

const HOWTO_PAD = `
  <div class="howto">
    <div class="ht-col">
      <h3>ATTACK</h3>
      <p><kbd>LEFT STICK</kbd> move</p>
      <p><kbd>A</kbd> pass (aim with the stick)</p>
      <p><kbd>B</kbd> hold &amp; release to shoot</p>
      <p>Hold <kbd>B</kbd> + tap <kbd>X</kbd>: chip the keeper</p>
      <p>Soft <kbd>B</kbd> with a diagonal stick: finesse curler</p>
      <p><kbd>X</kbd> tap: through ball · hold: lob / cross</p>
      <p><kbd>RT</kbd> sprint · double-tap to knock it past</p>
    </div>
    <div class="ht-col">
      <h3>DEFEND</h3>
      <p><kbd>A</kbd> switch player</p>
      <p><kbd>B</kbd> slide tackle</p>
      <p><kbd>X</kbd> hold to press the ball</p>
      <p>Run into the dribbler to steal it</p>
      <p><kbd>START</kbd> pause</p>
    </div>
  </div>
  <p class="fine">First-time finish: press SHOOT just before a pass or cross reaches you.</p>`;

/** One of the in-match touch buttons, drawn small (same colours, rim and base as the real ones). */
const touchBtn = (cls: string, label: string) => `<i class="ht-tb ${cls}"><span>${label}</span></i>`;
const dot = (cls: string) => `<i class="ht-dot ${cls}"></i>`;

const HOWTO_TOUCH = `
  <div class="ht-touch">
    <div class="ht-pad" aria-hidden="true">
      <div class="ht-stick"><i></i></div>
      <span class="ht-pad-l">DRAG TO MOVE</span>
      <div class="ht-cluster">
        ${touchBtn('sprint', 'SPRINT')}${touchBtn('through', 'THROUGH')}${touchBtn('shoot', 'SHOOT')}${touchBtn('pass', 'PASS')}
      </div>
    </div>
    <p class="ht-note"><b>MOVE</b> Put your thumb down anywhere on the left half and drag: the stick follows your thumb.</p>
    <table class="ht-table">
      <thead><tr><th></th><th>WITH THE BALL</th><th>DEFENDING</th></tr></thead>
      <tbody>
        <tr><td>${dot('pass')}</td><td><b>PASS</b> where you aim</td><td>${dot('def')}<b>SWITCH</b> player</td></tr>
        <tr><td>${dot('shoot')}</td><td><b>SHOOT</b> hold &amp; release, longer = harder</td><td><b>TACKLE</b> slide in</td></tr>
        <tr><td>${dot('through')}</td><td><b>THROUGH</b> tap · hold for a lob or cross</td><td><b>PRESS</b> hold to close down</td></tr>
        <tr><td>${dot('sprint')}</td><td><b>SPRINT</b> hold · double-tap to knock it past</td><td><b>SPRINT</b> hold to chase</td></tr>
        <tr class="ht-finish"><td>${dot('shoot')}</td><td colspan="2"><b>CHIP</b> hold SHOOT + tap THROUGH/CROSS · <b>CURL</b> a soft SHOOT with the stick on a diagonal</td></tr>
      </tbody>
    </table>
    <p class="fine">The buttons relabel themselves with the play. Set pieces: <b>PASS</b> short · <b>SHOOT</b> at goal · <b>CROSS</b> hold to whip it in. Tap to skip a replay; <b>II</b> pauses.</p>
  </div>`;

export class Menus {
  readonly root: HTMLElement;
  private screen: HTMLDivElement | null = null;
  private preview: KitPreview | null = null;

  constructor() {
    this.root = document.getElementById('ui')!;
  }

  private mount(html: string, cls = ''): HTMLDivElement {
    this.close();
    const d = document.createElement('div');
    d.className = `screen ${cls}`;
    d.innerHTML = html;
    this.root.appendChild(d);
    this.screen = d;
    d.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => sfx.click()));
    return d;
  }

  close(): void {
    this.screen?.remove();
    this.screen = null;
    this.preview?.dispose();
    this.preview = null;
  }

  get open(): boolean {
    return this.screen !== null;
  }

  title(onStart: () => void): void {
    const d = this.mount(`
      <div class="title-wrap">
        <h1 class="logo"><span class="l1">BLOCKY</span><span class="l2">LEAGUE</span></h1>
        <p class="tagline">Chunky football. Big goals.</p>
        <button class="btn btn-go btn-xl pulse" data-a="start">TAP TO PLAY</button>
        <p class="fine">Keyboard · Gamepad · Touch</p>
      </div>`, 'title');
    const go = () => {
      window.removeEventListener('keydown', key);
      onStart();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') go();
    };
    window.addEventListener('keydown', key);
    $(d, '[data-a=start]').addEventListener('click', go);
  }

  main(
    save: SaveData,
    h: { quick: () => void; career: () => void; cup: () => void; club: () => void; settings: () => void; howto: () => void; gift?: () => void },
    info?: MainInfo,
  ): void {
    const r = save.record;
    const d = this.mount(`
      <div class="topbar">
        ${h.gift && info?.gift ? `<button class="btn btn-yellow gift pulse" data-a="gift">🎁 DAILY GIFT <b>+${info.gift.amount}</b></button>` : ''}
        <div class="coins"><i></i><span>${save.coins.toLocaleString()}</span></div>
      </div>
      <div class="main-wrap ${info?.captain ? 'with-captain' : ''}">
        ${info?.captain ? `<div class="captain"><canvas class="captain-3d"></canvas><div class="captain-tag"><b>${info.captain.club}</b><span>OVR ${info.captain.ovr}</span></div></div>` : ''}
        <div class="main-col">
        <h1 class="logo small"><span class="l1">BLOCKY</span><span class="l2">LEAGUE</span></h1>
        <div class="tiles">
          <button class="btn btn-go tile" data-a="quick">${pixelIcon('ball', '#fff', 6)}<span>QUICK MATCH</span>${info?.quick ? `<small title="${info.quick}">${info.quick}</small>` : ''}</button>
          <button class="btn btn-blue tile" data-a="career">${pixelIcon('trophy', '#ffd23a', 6)}<span>CAREER</span>${info?.career ? `<small title="${info.career}">${info.career}</small>` : ''}</button>
          <button class="btn btn-yellow tile" data-a="club">${pixelIcon('shirt', '#26262e', 6)}<span>MY CLUB</span>${info?.club ? `<small title="${info.club}">${info.club}</small>` : ''}</button>
          <button class="btn btn-white tile" data-a="settings">${pixelIcon('gear', '#26262e', 6)}<span>SETTINGS</span></button>
          <button class="btn btn-red tile tile-wide" data-a="cup">${pixelIcon('trophy', '#ffd23a', 5)}<span>BLOCKY CUP</span>${info?.cup ? `<small title="${info.cup}">${info.cup}</small>` : ''}</button>
        </div>
        <div class="main-foot">
          <button class="btn btn-ghost" data-a="howto">HOW TO PLAY</button>
          <span class="record-chip">W ${r.won} · D ${r.drawn} · L ${r.lost} · ${r.goalsFor} GOALS</span>
        </div>
        </div>
      </div>`, 'main');
    const cap = d.querySelector<HTMLCanvasElement>('.captain-3d');
    if (cap && info?.captain) {
      this.preview = new KitPreview();
      if (this.preview.ok) this.preview.set(0, cap, info.captain.def, info.captain.kit);
      else cap.remove();
    }
    d.querySelector('[data-a=gift]')?.addEventListener('click', () => h.gift?.());
    $(d, '[data-a=quick]').addEventListener('click', h.quick);
    $(d, '[data-a=career]').addEventListener('click', h.career);
    $(d, '[data-a=cup]').addEventListener('click', h.cup);
    $(d, '[data-a=club]').addEventListener('click', h.club);
    $(d, '[data-a=settings]').addEventListener('click', h.settings);
    $(d, '[data-a=howto]').addEventListener('click', h.howto);
  }

  quickMatch(save: SaveData, onBack: () => void, onKickOff: (home: number, away: number) => void): void {
    let home = save.clubIdx;
    let away = save.opponentIdx === home ? (home + 1) % PRESET_CLUBS.length : save.opponentIdx;
    const d = this.mount(`
      <div class="panel-wrap">
        <div class="panel qm">
          <h2>QUICK MATCH</h2>
          <div class="vs-row">
            <div class="team-pick" data-side="home"></div>
            <div class="vs">VS</div>
            <div class="team-pick" data-side="away"></div>
          </div>
          <div class="opt-row"><label>DIFFICULTY</label><div class="seg" data-o="diff"></div></div>
          <div class="opt-row"><label>HALF LENGTH</label><div class="seg" data-o="len"></div></div>
          <div class="opt-row"><label>KICK-OFF</label><div class="seg" data-o="tod"></div></div>
          <div class="opt-row"><label>WEATHER</label><div class="seg" data-o="wx"></div></div>
          <div class="btn-row">
            <button class="btn btn-white" data-a="back">BACK</button>
            <button class="btn btn-go btn-lg" data-a="go">KICK OFF</button>
          </div>
        </div>
      </div>`, 'qm-screen');
    this.preview = new KitPreview();
    const preview = this.preview;
    const render = (side: 'home' | 'away') => {
      const idx = side === 'home' ? home : away;
      const c: ClubSeed = PRESET_CLUBS[idx];
      const ovr = presetRating(idx);
      const el = $(d, `[data-side=${side}]`);
      el.innerHTML = `
        <span class="tp-label">${side === 'home' ? 'YOU' : 'RIVAL'}</span>
        <div class="tp-body">
          <button class="arrow" data-d="-1">◀</button>
          <div class="tp-kit">${preview.ok ? '<canvas class="tp-3d"></canvas>' : shirtArt(c.kit, 9)}</div>
          <button class="arrow" data-d="1">▶</button>
        </div>
        <b class="tp-name">${crestSvg(c.name, c.short, c.kit, 2)}${c.name}</b>
        <span class="tp-stars">${stars(ovr)}</span>
        <span class="tp-meta">OVR ${ovr} · ${c.formation}</span>`;
      const cv = el.querySelector<HTMLCanvasElement>('.tp-3d');
      if (cv) {
        const team = makeTeam(c);
        preview.set(side === 'home' ? 0 : 1, cv, team.players[9], c.kit);
      }
      el.querySelectorAll<HTMLButtonElement>('.arrow').forEach((b) =>
        b.addEventListener('click', () => {
          sfx.click();
          const dlt = Number(b.dataset.d);
          const n = PRESET_CLUBS.length;
          if (side === 'home') {
            home = (home + dlt + n) % n;
            if (home === away) home = (home + dlt + n) % n;
          } else {
            away = (away + dlt + n) % n;
            if (away === home) away = (away + dlt + n) % n;
          }
          render(side);
        }),
      );
    };
    render('home');
    render('away');
    const seg = (key: 'diff' | 'len' | 'tod' | 'wx', labels: string[], get: () => number, set: (i: number) => void) => {
      const el = $(d, `[data-o=${key}]`);
      const draw = () => {
        el.innerHTML = labels.map((l, i) => `<button class="${i === get() ? 'on' : ''}" data-i="${i}">${l}</button>`).join('');
        el.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
          b.addEventListener('click', () => {
            sfx.click();
            set(Number(b.dataset.i));
            draw();
          }),
        );
      };
      draw();
    };
    seg('diff', DIFFICULTIES, () => save.settings.difficulty, (i) => (save.settings.difficulty = i));
    seg('len', HALF_OPTIONS.map((m) => `${m} MIN`), () => Math.max(0, HALF_OPTIONS.indexOf(save.settings.halfMinutes)), (i) => (save.settings.halfMinutes = HALF_OPTIONS[i]));
    const tods = ['day', 'sunset', 'night', 'random'] as const;
    seg('tod', ['DAY', 'SUNSET', 'NIGHT', 'RANDOM'], () => Math.max(0, tods.indexOf(save.settings.timeOfDay)), (i) => (save.settings.timeOfDay = tods[i]));
    const wxs = ['clear', 'rain', 'snow', 'random'] as const;
    seg('wx', ['CLEAR', 'RAIN', 'SNOW', 'RANDOM'], () => Math.max(0, wxs.indexOf(save.settings.weather)), (i) => (save.settings.weather = wxs[i]));
    $(d, '[data-a=back]').addEventListener('click', onBack);
    $(d, '[data-a=go]').addEventListener('click', () => onKickOff(home, away));
  }

  pause(h: { resume: () => void; howto: () => void; quit: () => void; settings: () => void; tactics?: () => void }): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow">
          <h2>PAUSED</h2>
          <div class="menu-col">
            <button class="btn btn-go btn-lg" data-a="resume">RESUME</button>
            ${h.tactics ? '<button class="btn btn-blue" data-a="tactics">TACTICS &amp; SUBS</button>' : ''}
            <button class="btn btn-white" data-a="howto">CONTROLS</button>
            <button class="btn btn-white" data-a="settings">SOUND</button>
            <button class="btn btn-red" data-a="quit">QUIT MATCH</button>
          </div>
        </div>
      </div>`, 'pause');
    $(d, '[data-a=resume]').addEventListener('click', h.resume);
    d.querySelector('[data-a=tactics]')?.addEventListener('click', () => {
      window.removeEventListener('keydown', key);
      h.tactics?.();
    });
    $(d, '[data-a=howto]').addEventListener('click', h.howto);
    $(d, '[data-a=settings]').addEventListener('click', h.settings);
    $(d, '[data-a=quit]').addEventListener('click', h.quit);
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        window.removeEventListener('keydown', key);
        h.resume();
      }
    };
    window.addEventListener('keydown', key);
  }

  statsTable(m: Match, kits?: [Kit, Kit]): string {
    const s = m.stats;
    const total = s.possession[0] + s.possession[1] || 1;
    const poss = [Math.round((s.possession[0] / total) * 100), 0];
    poss[1] = 100 - poss[0];
    const row = (label: string, a: number, b: number, pct = false) => {
      const t = a + b || 1;
      const ca = kits ? `;background:${cssHex(kits[0].shirt)}` : '';
      const cb = kits ? `;background:${cssHex(kits[1].shirt)}` : '';
      return `<div class="st-row"><b>${a}${pct ? '%' : ''}</b><div class="st-bar"><i style="width:${(a / t) * 100}%${ca}"></i></div><span>${label}</span><div class="st-bar r"><i style="width:${(b / t) * 100}%${cb}"></i></div><b>${b}${pct ? '%' : ''}</b></div>`;
    };
    // Bookings: players in the referee's book (a second yellow stays counted) and players sent off.
    const yellows: [number, number] = [0, 0];
    const reds: [number, number] = [0, 0];
    for (const i of m.booked) {
      const p = m.players[i];
      if (p) yellows[p.side]++;
    }
    for (const p of m.players) if (p.sentOff) reds[p.side]++;
    return `<div class="stats">
      ${row('POSSESSION', poss[0], poss[1], true)}
      ${row('SHOTS', s.shots[0], s.shots[1])}
      ${row('ON TARGET', s.onTarget[0], s.onTarget[1])}
      ${row('PASSES', s.passes[0], s.passes[1])}
      ${row('TACKLES', s.tackles[0], s.tackles[1])}
      ${row('SAVES', s.saves[0], s.saves[1])}
      ${row('CORNERS', s.corners?.[0] ?? 0, s.corners?.[1] ?? 0)}
      ${row('FOULS', s.fouls?.[0] ?? 0, s.fouls?.[1] ?? 0)}
      ${row('<i class="st-card"></i>YELLOW CARDS', yellows[0], yellows[1])}
      ${row('<i class="st-card red"></i>RED CARDS', reds[0], reds[1])}
    </div>`;
  }

  private scoreHeader(m: Match, kits: [Kit, Kit]): string {
    const scorers = (side: 0 | 1) =>
      m.goals.filter((g) => g.side === side).map((g) => `<li>${g.name}${g.own ? ' (OG)' : ''} ${g.minute}'</li>`).join('');
    return `<div class="final">
      <div class="f-team">${crestSvg(m.teams[0].name, m.teams[0].short, m.teams[0].kit, 4)}<b style="border-bottom:5px solid ${cssHex(kits[0].shirt)}">${m.teams[0].short}</b><ul>${scorers(0)}</ul></div>
      <div class="f-score">${m.score[0]}<span>-</span>${m.score[1]}</div>
      <div class="f-team">${crestSvg(m.teams[1].name, m.teams[1].short, m.teams[1].kit, 4)}<b style="border-bottom:5px solid ${cssHex(kits[1].shirt)}">${m.teams[1].short}</b><ul>${scorers(1)}</ul></div>
    </div>`;
  }

  /**
   * In-match tactics for the human side: formation, the XI on a pitch in formation slots (OVR + stamina on
   * every starter), bench, mentality. Tap a starter then a substitute (or the other way round) to make a sub.
   */
  tactics(
    m: Match, side: 0 | 1, kits: [Kit, Kit],
    h: {
      setMentality: (v: number) => void;
      substitute: (slot: number, benchIdx: number) => boolean;
      setFormation?: (id: FormationId) => void;
      back: () => void;
    },
  ): void {
    const kit = kits[side];
    const light = lum(kit.shirt) > 0.62;
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel tactics tx">
          <div class="tx-pitch" style="--shirt:${cssHex(kit.shirt)};--trim:${cssHex(kit.shirt2)};--gk:${cssHex(kit.gk)};--dot-t:${light ? 'var(--ink)' : '#fff'}"></div>
          <div class="tx-side">
            <div class="tx-head"><h2>TACTICS</h2><span class="tx-left"></span></div>
            <div class="tx-row tx-forms-row"><label>FORMATION</label><div class="seg tx-forms"></div></div>
            <div class="tx-row tx-ment-row"><label>MENTALITY</label><div class="seg tx-ment"></div></div>
            <div class="tx-benchbox"><div class="tx-bh"><h3>BENCH</h3><p class="tx-hint"></p></div><ul class="tx-bench"></ul></div>
          </div>
          <div class="btn-row"><button class="btn btn-go btn-lg" data-a="back">DONE</button></div>
        </div>
      </div>`, 'tactics-screen');
    /** Current pick: a starter (slot) or a bench player waiting for the other half of the swap. */
    let picked: { k: 'x' | 'b'; i: number } | null = null;
    let chosen: FormationId | null = null;
    let fresh = -1;
    const pitch = $(d, '.tx-pitch');
    const bench = $(d, '.tx-bench');

    const formation = (): FormationId => {
      const cur = m.slots[side];
      const same = (a: Slot[], b: Slot[]) => a.length === b.length && a.every((s, i) => s.x === b[i].x && s.z === b[i].z && s.role === b[i].role);
      const live = (m as Match & { formation?: FormationId[] }).formation?.[side];
      return FORMATION_IDS.find((id) => FORMATIONS[id] === cur) ?? FORMATION_IDS.find((id) => same(FORMATIONS[id], cur)) ?? live ?? chosen ?? m.teams[side].formation;
    };
    // The sim's limit, read live (it may rise, or differ per match); per-side arrays are fine too.
    const maxSubs = () => {
      const v = (m as Match & { maxSubs: number | readonly number[] }).maxSubs;
      const n = typeof v === 'number' ? v : Array.isArray(v) ? Number(v[side]) : 3;
      return Number.isFinite(n) ? n : 3;
    };
    const subsLeft = () => Math.max(0, maxSubs() - m.subsUsed[side]);
    // A starter and a bench player can swap if subs remain, the starter is still on, and keeper swaps with keeper.
    const canSwap = (slot: number, b: PlayerDef) => {
      const p = m.teamPlayers(side)[slot];
      return subsLeft() > 0 && !!p && !p.sentOff && (slot === 0) === (b.role === 'GK');
    };

    const drawPitch = () => {
      const team = m.teamPlayers(side);
      const pos = pitchLayout(m.slots[side]);
      const benchPick = picked?.k === 'b' ? m.bench[side][picked.i] : null;
      pitch.innerHTML = team
        .map((p, i) => {
          const st = Math.round(p.stamina * 100);
          const col = st > 60 ? 'var(--go)' : st > 35 ? 'var(--yellow)' : 'var(--red)';
          const slot = m.slots[side][i];
          const cls = [
            i === 0 ? 'gk' : '',
            picked?.k === 'x' && picked.i === i ? 'sel' : '',
            p.sentOff ? 'out' : '',
            benchPick && canSwap(i, benchPick) ? 'hot' : benchPick ? 'dim' : '',
            i === fresh ? 'fresh' : '',
            !p.sentOff && slot && p.def.role !== slot.role ? 'warn' : '',
          ].filter(Boolean).join(' ');
          const [l, t, room] = pos[i];
          return `<button class="tx-p ${cls}" data-k="x${i}" style="left:${l}%;top:${t}%;--room:${room}%" ${p.sentOff ? 'disabled' : ''}
            aria-label="${slot?.label ?? ''} ${p.def.name}, overall ${overall(p.def)}, stamina ${st}%${p.sentOff ? ', sent off' : ''}">
            <span class="tx-shirt"><b>${p.def.number}</b><i class="tx-ovr">${overall(p.def)}</i><s class="tx-st"><u style="width:${st}%;background:${col}"></u></s></span>
            <em class="tx-nm">${lastName(p.def.name)}</em>
          </button>`;
        })
        .join('');
    };

    const drawBench = () => {
      const list = m.bench[side];
      const x = picked?.k === 'x' ? picked.i : -1;
      bench.innerHTML = list.length
        ? list
            .map((p, i) => {
              const ok = x >= 0 ? canSwap(x, p) : subsLeft() > 0;
              const sel = picked?.k === 'b' && picked.i === i;
              return `<li><button class="tx-b ${sel ? 'sel' : ''} ${ok ? (x >= 0 ? 'hot' : '') : 'off'}" data-k="b${i}" ${ok ? '' : 'aria-disabled="true"'}>
                ${faceHtml(p, kit, 'sm')}<i style="background:${cssHex(kit.shirt)};color:${light ? 'var(--ink)' : '#fff'}">${p.number}</i><span>${p.name}</span><em>${p.role}</em><b>${overall(p)}</b>
              </button></li>`;
            })
            .join('')
        : '<li class="tx-empty">Nobody left on the bench.</li>';
      const left = subsLeft();
      hydrateFaces(bench);
      $(d, '.tx-left').textContent = left > 0 ? `${left} OF ${maxSubs()} SUBS LEFT` : 'NO SUBS LEFT';
      $(d, '.tx-left').classList.toggle('none', left <= 0);
      const team = m.teamPlayers(side);
      $(d, '.tx-hint').textContent =
        left <= 0 ? 'All substitutions made.'
          : picked?.k === 'x' ? `${team[picked.i].def.name} off: pick a sub.`
            : picked?.k === 'b' ? `${list[picked.i]?.name ?? ''} on: pick who comes off.`
              : 'Tap a player, then a sub.';
    };

    const drawForms = () => {
      const cur = formation();
      const el = $(d, '.tx-forms');
      el.innerHTML = FORMATION_IDS.map((f) => `<button class="${f === cur ? 'on' : ''}" data-f="${f}" ${h.setFormation ? '' : 'disabled'}>${f}</button>`).join('');
    };
    const drawMent = () => {
      const labels = ['DEFENSIVE', 'BALANCED', 'ATTACKING'];
      $(d, '.tx-ment').innerHTML = labels.map((l, i) => `<button class="${m.mentality[side] === i - 1 ? 'on' : ''}" data-i="${i}">${l}</button>`).join('');
    };
    const draw = () => {
      drawPitch();
      drawBench();
      fresh = -1;
    };

    const tryPair = (slot: number, benchIdx: number) => {
      const p = m.bench[side][benchIdx];
      if (!p || !canSwap(slot, p)) return false;
      if (!h.substitute(slot, benchIdx)) return false;
      sfx.coin();
      fresh = slot;
      return true;
    };

    d.addEventListener('click', (e) => {
      const t = e.target as Element;
      const f = t.closest<HTMLButtonElement>('.tx-forms button');
      if (f && !f.disabled) {
        sfx.click();
        const id = f.dataset.f as FormationId;
        chosen = id;
        h.setFormation?.(id);
        drawForms();
        draw();
        return;
      }
      const mb = t.closest<HTMLButtonElement>('.tx-ment button');
      if (mb) {
        sfx.click();
        h.setMentality(Number(mb.dataset.i) - 1);
        drawMent();
        return;
      }
      const btn = t.closest<HTMLButtonElement>('.tx-p, .tx-b');
      if (!btn || btn.disabled) return;
      sfx.click();
      const k = btn.dataset.k!;
      const idx = Number(k.slice(1));
      if (k[0] === 'x') {
        if (picked?.k === 'b') {
          if (tryPair(idx, picked.i)) picked = null;
          else picked = { k: 'x', i: idx };
        } else picked = picked?.k === 'x' && picked.i === idx ? null : { k: 'x', i: idx };
      } else {
        if (btn.classList.contains('off')) return;
        if (picked?.k === 'x') {
          if (tryPair(picked.i, idx)) picked = null;
        } else picked = picked?.k === 'b' && picked.i === idx ? null : { k: 'b', i: idx };
      }
      draw();
    });
    drawForms();
    drawMent();
    draw();
    $(d, '[data-a=back]').addEventListener('click', h.back);
  }

  halftime(m: Match, kits: [Kit, Kit], onContinue: () => void, onTactics?: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel">
          <h2>HALF TIME</h2>
          ${this.scoreHeader(m, kits)}
          ${this.statsTable(m, kits)}
          <div class="btn-row">
            ${onTactics ? '<button class="btn btn-blue" data-a="tactics">TACTICS &amp; SUBS</button>' : ''}
            <button class="btn btn-go btn-lg" data-a="go">SECOND HALF</button>
          </div>
        </div>
      </div>`, 'ht');
    const go = () => {
      window.removeEventListener('keydown', key);
      onContinue();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') go();
    };
    window.addEventListener('keydown', key);
    $(d, '[data-a=go]').addEventListener('click', go);
    d.querySelector('[data-a=tactics]')?.addEventListener('click', () => {
      window.removeEventListener('keydown', key);
      onTactics?.();
    });
  }

  fulltime(
    m: Match, kits: [Kit, Kit], humanSide: number, reward: { coins: number; label: string }, canDouble: boolean,
    h: { double: () => Promise<boolean>; next: () => void; nextLabel?: string },
    ratings?: { idx: number; name: string; side: number; rating: number; goals: number; assists: number }[],
  ): void {
    const motm = ratings?.[0];
    const mine = ratings?.filter((r) => r.side === humanSide).slice(0, 3) ?? [];
    // Head shots: the player as he looked on the pitch, in the kit his side wore.
    const face = (r: { idx: number; side: number }, cls = '') => {
      const def = m.players[r.idx]?.def;
      const kit = kits[r.side === 1 ? 1 : 0];
      return def && kit ? faceHtml(def, kit, cls) : '';
    };
    const motmHtml = motm
      ? `<div class="motm">
          <div class="motm-card" style="--k:${cssHex(kits[motm.side].shirt)}">${face(motm, 'xl')}<span>MAN OF THE MATCH</span><b>${motm.name}</b><em>${motm.rating.toFixed(1)}</em>
          ${motm.goals ? `<small>${motm.goals} goal${motm.goals > 1 ? 's' : ''}${motm.assists ? ` · ${motm.assists} assist${motm.assists > 1 ? 's' : ''}` : ''}</small>` : motm.assists ? `<small>${motm.assists} assist${motm.assists > 1 ? 's' : ''}</small>` : ''}</div>
          <ul class="ratings">${mine.map((r) => `<li>${face(r, 'sm')}<span>${r.name}</span><b class="${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</b></li>`).join('')}</ul>
        </div>`
      : '';
    const my = m.score[humanSide];
    const their = m.score[humanSide === 0 ? 1 : 0];
    // A level knockout tie is settled on penalties.
    const so = m.shootout && m.shootout.winner >= 0 ? m.shootout : null;
    const res = so ? (so.winner === humanSide ? 1 : -1) : Math.sign(my - their);
    const verdict = res > 0 ? 'YOU WIN!' : res === 0 ? 'DRAW' : 'YOU LOSE';
    const cls = res > 0 ? 'win' : res === 0 ? 'draw' : 'lose';
    const pens = so
      ? `<p class="ft-pens">${m.teams[so.winner as 0 | 1].short} WIN ${so.kicks[so.winner as 0 | 1].filter(Boolean).length}-${so.kicks[so.winner === 0 ? 1 : 0].filter(Boolean).length} ON PENALTIES</p>`
      : '';
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel">
          <h2 class="verdict ${cls}">${verdict}</h2>
          ${this.scoreHeader(m, kits)}${pens}
          ${motmHtml}
          ${this.statsTable(m, kits)}
          <div class="btn-row ft-foot">
            <div class="reward"><i></i><span class="rw-n">+0</span><em>${reward.label}</em></div>
            ${canDouble ? '<button class="btn btn-yellow" data-a="double">🎬 2× COINS</button>' : ''}
            <button class="btn btn-go btn-lg" data-a="next">${h.nextLabel ?? 'CONTINUE'}</button>
          </div>
        </div>
      </div>`, 'ft');
    const n = $(d, '.rw-n');
    let shown = 0;
    const count = (to: number) => {
      const from = shown;
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        n.textContent = `+${shown}`;
        if (k < 1) requestAnimationFrame(tick);
      };
      tick();
      sfx.coin();
    };
    hydrateFaces(d);
    setTimeout(() => count(reward.coins), 350);
    const dbl = d.querySelector<HTMLButtonElement>('[data-a=double]');
    const nextBtn = $<HTMLButtonElement>(d, '[data-a=next]');
    dbl?.addEventListener('click', async () => {
      dbl.disabled = true;
      nextBtn.disabled = true;
      const ok = await h.double().finally(() => (nextBtn.disabled = false));
      if (ok) {
        count(reward.coins * 2);
        dbl.textContent = 'DOUBLED!';
      } else {
        dbl.textContent = 'AD UNAVAILABLE';
      }
    });
    $(d, '[data-a=next]').addEventListener('click', h.next);
  }

  settings(save: SaveData, onChange: () => void, onBack: () => void): void {
    const s = save.settings;
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow">
          <h2>SETTINGS</h2>
          <div class="toggles">
            <button data-k="sfx"></button>
            <button data-k="crowd"></button>
            <button data-k="music"></button>
            <button data-k="commentary"></button>
            <button data-k="commentaryVoice"></button>
            <button data-k="autoSwitch"></button>
            <button data-k="quality"></button>
          </div>
          <div class="btn-row"><button class="btn btn-go" data-a="back">DONE</button></div>
        </div>
      </div>`, 'settings');
    const labels: Record<string, string> = {
      sfx: 'SOUND FX', crowd: 'CROWD', music: 'MUSIC', commentary: 'COMMENTARY', commentaryVoice: 'COMMENTARY VOICE', autoSwitch: 'AUTO SWITCH', quality: 'GRAPHICS',
    };
    const canSpeak = speechAvailable();
    const draw = () => {
      d.querySelectorAll<HTMLButtonElement>('.toggles button').forEach((b) => {
        const k = b.dataset.k as keyof typeof s;
        const v = s[k];
        if (k === 'commentaryVoice' && !canSpeak) {
          b.disabled = true;
          b.innerHTML = `<span>${labels[k]}</span><b class="off na">N/A</b>`;
          return;
        }
        const val = k === 'quality' ? String(v).toUpperCase() : v ? 'ON' : 'OFF';
        b.innerHTML = `<span>${labels[k]}</span><b class="${v === false ? 'off' : ''}">${val}</b>`;
      });
    };
    d.querySelectorAll<HTMLButtonElement>('.toggles button').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.disabled) return;
        sfx.click();
        const k = b.dataset.k as keyof typeof s;
        if (k === 'quality') s.quality = s.quality === 'high' ? 'medium' : s.quality === 'medium' ? 'low' : 'high';
        else (s as unknown as Record<string, boolean>)[k] = !s[k];
        draw();
        onChange();
      }),
    );
    draw();
    $(d, '[data-a=back]').addEventListener('click', onBack);
  }

  /**
   * Controls for the device in hand: the touch pad (stick + the coloured buttons and what each one does when
   * attacking / defending), keyboard, or gamepad. Tabs show the others.
   */
  howTo(onBack: () => void, device: 'keyboard' | 'touch' | 'gamepad' = defaultDevice()): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel howto-panel">
          <h2>HOW TO PLAY</h2>
          <div class="seg ht-tabs" role="tablist">
            <button data-dev="touch" role="tab">TOUCH</button>
            <button data-dev="keyboard" role="tab">KEYBOARD</button>
            <button data-dev="gamepad" role="tab">GAMEPAD</button>
          </div>
          <div class="ht-body"></div>
          <div class="btn-row"><button class="btn btn-go" data-a="back">GOT IT</button></div>
        </div>
      </div>`, 'howto-screen');
    const body = $(d, '.ht-body');
    const show = (dev: 'keyboard' | 'touch' | 'gamepad') => {
      d.querySelectorAll<HTMLButtonElement>('.ht-tabs button').forEach((b) => {
        const on = b.dataset.dev === dev;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      body.innerHTML = dev === 'touch' ? HOWTO_TOUCH : dev === 'gamepad' ? HOWTO_PAD : HOWTO_KEYS;
    };
    d.querySelectorAll<HTMLButtonElement>('.ht-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        show(b.dataset.dev as 'keyboard' | 'touch' | 'gamepad');
      }),
    );
    show(device);
    $(d, '[data-a=back]').addEventListener('click', onBack);
  }

  gift(amount: number, streak: number, canDouble: boolean, h: { claim: (double: boolean) => Promise<boolean>; back: () => void }): void {
    const days = Array.from({ length: 7 }, (_, i) => {
      const n = 100 + 50 * i;
      const state = i < streak - 1 ? 'got' : i === streak - 1 ? 'today' : '';
      return `<li class="${state}"><span>DAY ${i + 1}</span><b>${n}</b></li>`;
    }).join('');
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel">
          <h2>DAILY GIFT</h2>
          <ul class="gift-days">${days}</ul>
          <div class="reward"><i></i><span>+${amount}</span><em>DAY ${streak} STREAK</em></div>
          <p class="fine">Come back tomorrow to keep the streak going.</p>
          <div class="btn-row">
            ${canDouble ? '<button class="btn btn-white" data-a="double">🎬 2× GIFT</button>' : ''}
            <button class="btn btn-go btn-lg" data-a="claim">CLAIM</button>
          </div>
        </div>
      </div>`, 'gift-screen');
    const go = async (double: boolean) => {
      d.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await h.claim(double);
      sfx.coin();
      h.back();
    };
    $(d, '[data-a=claim]').addEventListener('click', () => void go(false));
    d.querySelector('[data-a=double]')?.addEventListener('click', () => void go(true));
  }

  comingSoon(title: string, text: string, onBack: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow">
          <h2>${title}</h2>
          <p class="fine big">${text}</p>
          <div class="btn-row"><button class="btn btn-go" data-a="back">OK</button></div>
        </div>
      </div>`);
    $(d, '[data-a=back]').addEventListener('click', onBack);
  }
}
