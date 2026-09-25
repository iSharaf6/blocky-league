import { sfx } from '../audio/sfx';
import type { SaveData } from '../core/save';
import { clubRating as presetRating } from '../meta/cup';
import { PRESET_CLUBS, makeTeam, type ClubSeed } from '../meta/data';
import { KitPreview } from './preview';
import { crestSvg } from './crest';
import { cssHex, shade } from '../render/palette';
import type { Match } from '../sim/match';
import { overall, type Kit, type PlayerDef } from '../sim/types';

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
    return `<div class="stats">
      ${row('POSSESSION', poss[0], poss[1], true)}
      ${row('SHOTS', s.shots[0], s.shots[1])}
      ${row('ON TARGET', s.onTarget[0], s.onTarget[1])}
      ${row('PASSES', s.passes[0], s.passes[1])}
      ${row('TACKLES', s.tackles[0], s.tackles[1])}
      ${row('SAVES', s.saves[0], s.saves[1])}
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

  /** Mentality + substitutions for the human side. */
  tactics(
    m: Match, side: 0 | 1, kits: [Kit, Kit],
    h: { setMentality: (v: number) => void; substitute: (slot: number, benchIdx: number) => boolean; back: () => void },
  ): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel tactics">
          <h2>TACTICS</h2>
          <div class="opt-row"><label>MENTALITY</label><div class="seg" data-o="ment"></div></div>
          <div class="subs-head"><b>SUBSTITUTIONS</b><span class="subs-left"></span></div>
          <div class="subs">
            <div class="sub-col"><h3>ON THE PITCH</h3><ul class="sub-list" data-l="xi"></ul></div>
            <div class="sub-col"><h3>BENCH</h3><ul class="sub-list" data-l="bench"></ul></div>
          </div>
          <p class="fine">Tap a player on the pitch, then a substitute. Subs come on with fresh legs.</p>
          <div class="btn-row"><button class="btn btn-go btn-lg" data-a="back">DONE</button></div>
        </div>
      </div>`, 'tactics-screen');
    let picked = -1;
    const ment = $(d, '[data-o=ment]');
    const drawMent = () => {
      const labels = ['DEFENSIVE', 'BALANCED', 'ATTACKING'];
      ment.innerHTML = labels.map((l, i) => `<button class="${m.mentality[side] === i - 1 ? 'on' : ''}" data-i="${i}">${l}</button>`).join('');
      ment.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          sfx.click();
          h.setMentality(Number(b.dataset.i) - 1);
          drawMent();
        }),
      );
    };
    const row = (p: PlayerDef, extra: string, cls: string, key: string) =>
      `<li><button class="sub-row ${cls}" data-k="${key}"><i style="background:${cssHex(kits[side].shirt)}">${p.number}</i><span>${p.name}</span><em>${p.role}</em>${extra}</button></li>`;
    const drawSubs = () => {
      const left = m.maxSubs - m.subsUsed[side];
      $(d, '.subs-left').textContent = `${left} LEFT`;
      const team = m.teamPlayers(side);
      $(d, '[data-l=xi]').innerHTML = team
        .map((p, i) => {
          const st = Math.round(p.stamina * 100);
          const col = st > 60 ? 'var(--go)' : st > 35 ? 'var(--yellow)' : 'var(--red)';
          return row(p.def, `<b class="stam"><s style="width:${st}%;background:${col}"></s></b>`, picked === i ? 'sel' : '', `x${i}`);
        })
        .join('');
      const bench = m.bench[side];
      const pickGK = picked === 0;
      $(d, '[data-l=bench]').innerHTML = bench.length
        ? bench.map((p, i) => row(p, `<b class="ovr">${overall(p)}</b>`, left <= 0 || picked < 0 || pickGK !== (p.role === 'GK') ? 'off' : '', `b${i}`)).join('')
        : '<li class="fine">Nobody left on the bench.</li>';
      d.querySelectorAll<HTMLButtonElement>('.sub-row').forEach((b) =>
        b.addEventListener('click', () => {
          sfx.click();
          const k = b.dataset.k!;
          const idx = Number(k.slice(1));
          if (k[0] === 'x') picked = picked === idx ? -1 : idx;
          else if (picked >= 0 && !b.classList.contains('off')) {
            if (h.substitute(picked, idx)) {
              sfx.coin();
              picked = -1;
            }
          }
          drawSubs();
        }),
      );
    };
    drawMent();
    drawSubs();
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
    const motmHtml = motm
      ? `<div class="motm">
          <div class="motm-card" style="--k:${cssHex(kits[motm.side].shirt)}"><span>MAN OF THE MATCH</span><b>${motm.name}</b><em>${motm.rating.toFixed(1)}</em>
          ${motm.goals ? `<small>${motm.goals} goal${motm.goals > 1 ? 's' : ''}${motm.assists ? ` · ${motm.assists} assist${motm.assists > 1 ? 's' : ''}` : ''}</small>` : motm.assists ? `<small>${motm.assists} assist${motm.assists > 1 ? 's' : ''}</small>` : ''}</div>
          <ul class="ratings">${mine.map((r) => `<li><span>${r.name}</span><b class="${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</b></li>`).join('')}</ul>
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
          <div class="reward"><i></i><span class="rw-n">+0</span><em>${reward.label}</em></div>
          <div class="btn-row">
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
            <button data-k="autoSwitch"></button>
            <button data-k="quality"></button>
          </div>
          <div class="btn-row"><button class="btn btn-go" data-a="back">DONE</button></div>
        </div>
      </div>`, 'settings');
    const labels: Record<string, string> = { sfx: 'SOUND FX', crowd: 'CROWD', music: 'MUSIC', autoSwitch: 'AUTO SWITCH', quality: 'GRAPHICS' };
    const draw = () => {
      d.querySelectorAll<HTMLButtonElement>('.toggles button').forEach((b) => {
        const k = b.dataset.k as keyof typeof s;
        const v = s[k];
        const val = k === 'quality' ? String(v).toUpperCase() : v ? 'ON' : 'OFF';
        b.innerHTML = `<span>${labels[k]}</span><b class="${v === false ? 'off' : ''}">${val}</b>`;
      });
    };
    d.querySelectorAll<HTMLButtonElement>('.toggles button').forEach((b) =>
      b.addEventListener('click', () => {
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

  howTo(onBack: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel">
          <h2>HOW TO PLAY</h2>
          <div class="howto">
            <div class="ht-col">
              <h3>ATTACK</h3>
              <p><kbd>WASD</kbd> / <kbd>←↑→↓</kbd> move</p>
              <p><kbd>SPACE</kbd> pass (aim with the stick)</p>
              <p><kbd>K</kbd> hold &amp; release to shoot</p>
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
          <p class="fine">Gamepad: A pass · B shoot · X through · RT sprint. Touch: stick on the left, buttons on the right.</p>
          <p class="fine">First-time finish: press SHOOT just before a pass or cross reaches you.</p>
          <div class="btn-row"><button class="btn btn-go" data-a="back">GOT IT</button></div>
        </div>
      </div>`, 'howto-screen');
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
