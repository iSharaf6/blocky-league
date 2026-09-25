/**
 * My Club screens (club creation, squad, training, kit, stadium) plus the small screen kit shared with the
 * career UI. Screens mount into the menus root alongside (never on top of) Menus' own screens.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import {
  KEY_STATS, NAME_BAD, PATTERNS, SQUAD_MAX, STADIUM_MAX, STADIUM_NAMES, STAT_CAP, STAT_KEYS, STAT_NAME, STAT_SHORT, TRAIN_STEP,
  autoPick, clubRating, createClub, deriveShort, keeperColor, lineupIssues, matchAttendance, migrateCareer, randomKit,
  sanitizeName, sanitizeShort, setFormation, stadiumUpgradeCost, swapPlayers, trainPlayer, trainingCost, upgradeStadium,
  type CareerState, type ClubState, type TxFail,
} from '../meta/career';
import { KIT_COLORS } from '../meta/data';
import { cssHex } from '../render/palette';
import { STADIUM_LEVELS } from '../render/stadium';
import { FORMATIONS, FORMATION_IDS } from '../sim/formations';
import { overall, type FormationId, type Kit, type KitPattern, type PlayerDef, type PlayerStats } from '../sim/types';
import { pitchLayout, shirtArt } from './menus';
import { StadiumPreview, stadiumIsoSvg } from './preview';

// ------------------------------------------------------------------ shared screen kit

export type Handlers = Record<string, (el: HTMLElement) => void>;
export type InputHandlers = Record<string, (el: HTMLInputElement) => void>;
export type ToastKind = 'good' | 'bad' | 'info';

export interface MetaScreen {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  /** Replace the panel content (keeps scroll position) and the active click/input handlers. */
  render(html: string, on: Handlers, inputs?: InputHandlers): void;
  toast(msg: string, kind?: ToastKind): void;
}

let activeRoot: HTMLDivElement | null = null;
/** Run when the meta screen closes (3D previews free their WebGL context). */
let cleanups: (() => void)[] = [];

export function onMetaClose(fn: () => void): void {
  cleanups.push(fn);
}

export function closeMeta(): void {
  const fns = cleanups;
  cleanups = [];
  for (const fn of fns) {
    try {
      fn();
    } catch {
      // A failed cleanup must not keep the next screen from opening.
    }
  }
  activeRoot?.remove();
  activeRoot = null;
}

export function mountMeta(app: AppContext, cls: string): MetaScreen {
  app.menus.close();
  closeMeta();
  const root = document.createElement('div');
  root.className = `screen meta ${cls}`;
  root.innerHTML = '<div class="panel-wrap dim mc-wrap"><div class="panel mc"></div></div><div class="mc-toast" role="status" aria-live="polite"></div>';
  app.menus.root.appendChild(root);
  activeRoot = root;
  const panel = root.querySelector('.mc') as HTMLDivElement;
  const toastEl = root.querySelector('.mc-toast') as HTMLDivElement;
  let clicks: Handlers = {};
  let inputs: InputHandlers = {};
  let toastTimer = 0;
  panel.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button:not(:disabled)')) sfx.click();
  });
  panel.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!el || !panel.contains(el) || (el as HTMLButtonElement).disabled) return;
    clicks[el.dataset.a ?? '']?.(el);
  });
  panel.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.in;
    if (k) inputs[k]?.(el);
  });
  // The match Input listens on window and preventDefaults WASD/Space; keep typing inside our fields.
  panel.addEventListener('keydown', (e) => {
    const t = e.target as Element;
    if (t.matches('input')) {
      e.stopPropagation();
      if (e.key === 'Enter') (t as HTMLInputElement).blur();
    }
  });
  return {
    root,
    panel,
    render(html, on, inp) {
      const top = panel.scrollTop;
      panel.innerHTML = html;
      clicks = on;
      inputs = inp ?? {};
      panel.scrollTop = top;
    },
    toast(msg, kind = 'info') {
      toastEl.textContent = msg;
      toastEl.className = `mc-toast on ${kind}`;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 2600);
    },
  };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function coinsHtml(n: number): string {
  return `<div class="coins mc-coins"><i></i><span>${fmt(n)}</span></div>`;
}

export function topBar(back: string, title: string, sub: string, coins: number): string {
  return `<header class="mc-top">
    <button class="btn btn-white mc-back" data-a="back" aria-label="${esc(back)}">◀<span>${esc(back)}</span></button>
    <div class="mc-title"><h2>${title}</h2><span>${sub}</span></div>
    ${coinsHtml(coins)}
  </header>`;
}

export function roleBadge(role: string): string {
  return `<span class="mc-role r-${role}">${role}</span>`;
}

export function ovrBadge(n: number): string {
  return `<span class="mc-ovr">${n}</span>`;
}

export function failText(reason: TxFail): string {
  switch (reason) {
    case 'no-coins': return 'NOT ENOUGH COINS';
    case 'squad-full': return `SQUAD FULL (${SQUAD_MAX} MAX)`;
    case 'min-squad': return 'NEED AT LEAST 14 PLAYERS';
    case 'last-gk': return "CAN'T SELL YOUR LAST KEEPER";
    case 'maxed': return 'ALREADY MAXED';
    case 'not-found': return 'PLAYER NOT AVAILABLE';
    case 'no-club': return 'CREATE A CLUB FIRST';
  }
}

export function keyStatsText(p: PlayerDef): string {
  return KEY_STATS[p.role].map((k) => `${STAT_SHORT[k]} ${p.stats[k]}`).join(' ');
}

const migrated = new WeakSet<object>();

/** The live CareerState inside app.save (migrated once per save object). */
export function careerState(app: AppContext): CareerState {
  const raw = app.save.career;
  if (typeof raw === 'object' && raw !== null && migrated.has(raw)) return raw as CareerState;
  const st = migrateCareer(raw, (Math.random() * 2 ** 32) >>> 0);
  migrated.add(st);
  app.save.career = st;
  return st;
}

function lum(hex: number): number {
  return (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
}

// ------------------------------------------------------------------ kit designer

export type KitPart = 'shirt' | 'shirt2' | 'shorts' | 'socks';
const PARTS: [KitPart, string][] = [['shirt', 'SHIRT'], ['shirt2', 'TRIM'], ['shorts', 'SHORTS'], ['socks', 'SOCKS']];
const COLORS = Object.entries(KIT_COLORS) as [string, number][];

function kitEditorHtml(kit: Kit, part: KitPart): string {
  return `<div class="mc-kited">
    <div class="seg mc-parts">${PARTS.map(([k, l]) => `<button class="${k === part ? 'on' : ''}" data-a="part" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="mc-swatches">${COLORS.map(([n, c]) => `<button class="mc-sw ${kit[part] === c ? 'on' : ''}" data-a="color" data-v="${c}" style="--sw:${cssHex(c)}" aria-label="${n}" title="${n.toUpperCase()}"></button>`).join('')}</div>
    <div class="mc-pats">${PATTERNS.map((p) => `<button class="mc-pat ${kit.pattern === p ? 'on' : ''}" data-a="pattern" data-v="${p}">${shirtArt({ ...kit, pattern: p }, 3)}<span>${p.toUpperCase()}</span></button>`).join('')}</div>
    <button class="btn btn-white mc-rand" data-a="randkit">SHUFFLE KIT</button>
  </div>`;
}

function kitHandlers(kit: Kit, part: { v: KitPart }, changed: () => void): Handlers {
  return {
    part: (el) => {
      part.v = el.dataset.v as KitPart;
      changed();
    },
    color: (el) => {
      kit[part.v] = Number(el.dataset.v);
      kit.gk = keeperColor(kit);
      changed();
    },
    pattern: (el) => {
      kit.pattern = el.dataset.v as KitPattern;
      changed();
    },
    randkit: () => {
      Object.assign(kit, randomKit(new Rng((Math.random() * 2 ** 32) >>> 0)));
      changed();
    },
  };
}

function formationButtons(cur: FormationId, action: string): string {
  return `<div class="mc-forms">${FORMATION_IDS.map((f) => `<button class="${f === cur ? 'on' : ''}" data-a="${action}" data-v="${f}">${f}</button>`).join('')}</div>`;
}

function previewHtml(kit: Kit, name: string, short: string): string {
  return `${shirtArt(kit, 12)}<b>${esc(name || '—')}</b><span>${esc(short.length === 3 ? short : '???')}</span>`;
}

const SUGGESTED = ['Pixel Park FC', 'Cube City', 'Voxel Rovers', 'Brick Lane FC', 'Blocky Town', 'Square United', 'Crate Albion'];

/** First-run club builder: name, short name, kit, formation. Generates the 16-man squad on CREATE. */
export function clubCreate(app: AppContext, onDone: () => void, onBack: () => void): void {
  const st = careerState(app);
  const scr = mountMeta(app, 'mc-create-screen');
  const name0 = SUGGESTED[Math.floor(Math.random() * SUGGESTED.length)];
  const d = {
    name: name0,
    short: deriveShort(name0),
    shortEdited: false,
    kit: randomKit(new Rng((Math.random() * 2 ** 32) >>> 0)),
    formation: '4-4-2' as FormationId,
  };
  const part = { v: 'shirt' as KitPart };
  const valid = () => sanitizeName(d.name).length >= 2 && sanitizeShort(d.short).length === 3;
  const update = () => {
    const pv = scr.panel.querySelector('.mc-preview');
    if (pv) pv.innerHTML = previewHtml(d.kit, sanitizeName(d.name), d.short);
    const btn = scr.panel.querySelector<HTMLButtonElement>('[data-a=create]');
    if (btn) btn.disabled = !valid();
    scr.panel.querySelector('[data-in=name]')?.classList.toggle('bad', sanitizeName(d.name).length < 2);
    scr.panel.querySelector('[data-in=short]')?.classList.toggle('bad', d.short.length !== 3);
  };
  const draw = () =>
    scr.render(
      `${topBar('BACK', 'NEW CLUB', 'FOUND YOUR TEAM', app.save.coins)}
      <div class="mc-create">
        <div class="mc-preview">${previewHtml(d.kit, sanitizeName(d.name), d.short)}</div>
        <div class="mc-form">
          <div class="mc-fields">
            <label class="mc-field"><span>CLUB NAME</span><input data-in="name" maxlength="18" value="${esc(d.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done"></label>
            <label class="mc-field mc-short"><span>SHORT</span><input data-in="short" maxlength="3" value="${esc(d.short)}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done"></label>
          </div>
          <h3 class="mc-h">KIT</h3>
          ${kitEditorHtml(d.kit, part.v)}
          <h3 class="mc-h">FORMATION</h3>
          ${formationButtons(d.formation, 'form')}
        </div>
      </div>
      <p class="mc-hint">You start in the Sunday League with 16 players. Win matches, train your squad and climb all the way to the Elite League.</p>
      <div class="btn-row"><button class="btn btn-go btn-lg" data-a="create" ${valid() ? '' : 'disabled'}>CREATE CLUB</button></div>`,
      {
        back: onBack,
        ...kitHandlers(d.kit, part, draw),
        form: (el) => {
          d.formation = el.dataset.v as FormationId;
          draw();
        },
        create: () => {
          if (!valid()) return;
          st.club = createClub({ name: d.name, short: d.short, kit: d.kit, formation: d.formation }, st.seed);
          app.persist();
          sfx.coin();
          onDone();
        },
      },
      {
        name: (el) => {
          const v = el.value.replace(NAME_BAD, '');
          if (v !== el.value) el.value = v;
          d.name = v;
          if (!d.shortEdited) {
            d.short = deriveShort(sanitizeName(v));
            const s = scr.panel.querySelector<HTMLInputElement>('[data-in=short]');
            if (s) s.value = d.short;
          }
          update();
        },
        short: (el) => {
          const v = sanitizeShort(el.value);
          if (v !== el.value) el.value = v;
          d.short = v;
          d.shortEdited = true;
          update();
        },
      },
    );
  draw();
}

// ------------------------------------------------------------------ club hub

export type ClubTab = 'squad' | 'train' | 'kit' | 'stadium';

export interface ClubOpts {
  tab?: ClubTab;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

export function openClub(app: AppContext, opts: ClubOpts = {}): void {
  const st = careerState(app);
  const back =
    opts.onBack ??
    (() => {
      closeMeta();
      app.mainMenu();
    });
  if (!st.club) {
    clubCreate(app, () => openClub(app, opts), back);
    return;
  }
  clubHub(app, st, st.club, opts.tab ?? 'squad', back, opts.backLabel ?? 'MENU');
}

const TABS: [ClubTab, string][] = [['squad', 'SQUAD'], ['train', 'TRAIN'], ['kit', 'KIT'], ['stadium', 'STADIUM']];

function lastName(name: string): string {
  const parts = name.split(' ');
  return parts[parts.length - 1] ?? name;
}

function clubHub(app: AppContext, st: CareerState, club: ClubState, tab0: ClubTab, back: () => void, backLabel: string): void {
  const scr = mountMeta(app, 'mc-club-screen');
  let tab = tab0;
  let sel = -1;
  let trainIdx = 0;
  const part = { v: 'shirt' as KitPart };

  const playerRow = (p: PlayerDef, i: number, action: string, selected: boolean) => {
    const slots = FORMATIONS[club.formation];
    const starter = i < 11;
    const warn = starter && slots[i].role !== p.role;
    return `<button class="mc-pl ${selected ? 'sel' : ''} ${warn ? 'warn' : ''}" data-a="${action}" data-i="${i}">
      <span class="mc-slot">${starter ? slots[i].label : 'SUB'}</span>
      <span class="mc-num">${p.number}</span>
      ${roleBadge(p.role)}
      <span class="mc-pname"><b>${esc(p.name)}</b><small>${keyStatsText(p)}</small></span>
      ${ovrBadge(overall(p))}
    </button>`;
  };

  const pitchHtml = () => {
    const issues = new Set(lineupIssues(club));
    const light = lum(club.kit.shirt) > 0.62;
    // Same team-sheet pitch as the in-match tactics screen (menus.ts pitchLayout + .tx-p tokens).
    const slots = FORMATIONS[club.formation];
    const pos = pitchLayout(slots);
    return `<div class="tx-pitch mc-teampitch" style="--shirt:${cssHex(club.kit.shirt)};--trim:${cssHex(club.kit.shirt2)};--gk:${cssHex(club.kit.gk)};--dot-t:${light ? 'var(--ink)' : '#fff'}">
      ${slots
        .map((s, i) => {
          const p = club.squad[i];
          const [left, top, room] = pos[i];
          return `<button class="tx-p ${i === 0 ? 'gk' : ''} ${sel === i ? 'sel' : ''} ${issues.has(i) ? 'warn' : ''}" data-a="pick" data-i="${i}" style="left:${left}%;top:${top}%;--room:${room}%" aria-label="${s.label} ${esc(p.name)}, overall ${overall(p)}"><span class="tx-shirt"><b>${p.number}</b><i class="tx-ovr">${overall(p)}</i></span><em class="tx-nm">${esc(lastName(p.name))}</em></button>`;
        })
        .join('')}
    </div>`;
  };

  const squadHtml = () => {
    const issues = lineupIssues(club);
    const hint =
      sel >= 0
        ? `<p class="mc-hint sel">${esc(club.squad[sel].name)} selected: tap another player to swap.</p>`
        : issues.length
          ? `<p class="mc-hint warn">${issues.length} starter${issues.length > 1 ? 's' : ''} out of position. AUTO PICK fixes it.</p>`
          : '<p class="mc-hint">Tap two players to swap them. The first 11 start.</p>';
    return `<div class="mc-squadtop">
        ${pitchHtml()}
        <div class="mc-squadside">
          <h3 class="mc-h">FORMATION</h3>
          ${formationButtons(club.formation, 'form')}
          ${hint}
          <button class="btn btn-yellow" data-a="autopick">AUTO PICK</button>
        </div>
      </div>
      <h3 class="mc-h">STARTING XI</h3>
      <div class="mc-list">${club.squad.slice(0, 11).map((p, i) => playerRow(p, i, 'pick', i === sel)).join('')}</div>
      <h3 class="mc-h">BENCH · ${club.squad.length - 11}</h3>
      <div class="mc-list">${club.squad.slice(11).map((p, i) => playerRow(p, i + 11, 'pick', i + 11 === sel)).join('')}</div>`;
  };

  const trainHtml = () => {
    trainIdx = Math.max(0, Math.min(club.squad.length - 1, trainIdx));
    const p = club.squad[trainIdx];
    const cost = trainingCost(p);
    const poor = app.save.coins < cost;
    const keys = new Set(KEY_STATS[p.role]);
    const stats = STAT_KEYS.map((k) => {
      const v = p.stats[k];
      const maxed = v >= STAT_CAP;
      return `<div class="mc-st ${keys.has(k) ? 'key' : ''}">
        <span><i class="nm-full">${STAT_NAME[k]}</i><i class="nm-short">${STAT_SHORT[k]}</i></span>
        <div class="mc-meter"><i style="width:${v}%"></i></div>
        <b>${v}</b>
        <button class="btn btn-go mc-trainbtn ${poor ? 'poor' : ''}" data-a="train" data-k="${k}" ${maxed ? 'disabled' : ''}>${maxed ? 'MAX' : `+${TRAIN_STEP} · ${fmt(cost)}`}</button>
      </div>`;
    }).join('');
    return `<div class="mc-tcard">
        <div class="mc-tchead">
          <button class="arrow" data-a="tprev" aria-label="Previous player">◀</button>
          <div class="mc-tcid">${roleBadge(p.role)}<b>${esc(p.name)}</b><span class="mc-num">#${p.number}</span>${ovrBadge(overall(p))}</div>
          <button class="arrow" data-a="tnext" aria-label="Next player">▶</button>
        </div>
        <div class="mc-stats">${stats}</div>
        <p class="mc-hint">Each session adds +${TRAIN_STEP} and costs 40 + 3 × OVR coins. Green stats count most for a ${p.role}.</p>
      </div>
      <h3 class="mc-h">PICK A PLAYER</h3>
      <div class="mc-list">${club.squad.map((q, i) => playerRow(q, i, 'tpick', i === trainIdx)).join('')}</div>`;
  };

  const kitHtml = () => `<div class="mc-create">
      <div class="mc-preview">${previewHtml(club.kit, club.name, club.short)}</div>
      <div class="mc-form">
        <div class="mc-fields">
          <label class="mc-field"><span>CLUB NAME</span><input data-in="cname" maxlength="18" value="${esc(club.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done"></label>
          <label class="mc-field mc-short"><span>SHORT</span><input data-in="cshort" maxlength="3" value="${esc(club.short)}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done"></label>
        </div>
        <h3 class="mc-h">KIT · CHANGES SAVE AUTOMATICALLY</h3>
        ${kitEditorHtml(club.kit, part.v)}
      </div>
    </div>`;

  /** Upgrade-screen 3D grounds (now / next), alive only while the STADIUM tab is showing. */
  let pv: StadiumPreview | null = null;
  const dropPreview = () => {
    pv?.dispose();
    pv = null;
  };
  onMetaClose(dropPreview);
  const has3d = () => {
    pv ??= new StadiumPreview({ home: club.kit.shirt, homeName: club.name });
    return pv.ok;
  };

  const stadiumView = (l: number, when: 'NOW' | 'NEXT', solo: boolean, gl: boolean) => `
    <figure class="mc-stadview ${when === 'NEXT' ? 'next' : 'now'} ${solo ? 'solo' : ''}">
      ${gl ? `<canvas class="mc-stad3d" data-slot="${when === 'NOW' ? 0 : 1}" aria-label="${STADIUM_NAMES[l]} preview"></canvas>` : stadiumIsoSvg(l)}
      <figcaption><span>${when}</span><b>${STADIUM_NAMES[l]}</b></figcaption>
    </figure>`;

  const stadiumHtml = () => {
    const lvl = st.stadium;
    const maxed = lvl >= STADIUM_MAX;
    const cost = stadiumUpgradeCost(lvl);
    const crowd = (l: number) => `${Math.round(matchAttendance(l) * 100)}%`;
    const cap = (l: number) => fmt(STADIUM_LEVELS[l]?.capacity ?? 0);
    const next = (a: string, b: string) => (maxed ? `<b>${a}</b>` : `<b>${a} <em>→ ${b}</em></b>`);
    const gl = has3d();
    return `<div class="mc-stadium ${maxed ? 'maxed' : ''}">
        ${stadiumView(lvl, 'NOW', maxed, gl)}
        ${maxed ? '' : stadiumView(lvl + 1, 'NEXT', false, gl)}
        <div class="mc-stadinfo">
          <b class="mc-stadname">${STADIUM_NAMES[lvl]}</b>
          <span class="mc-stadlvl">LEVEL ${lvl} / ${STADIUM_MAX}</span>
          <div class="mc-kv"><span>CAPACITY</span>${next(cap(lvl), cap(lvl + 1))}</div>
          <div class="mc-kv"><span>CROWD</span>${next(crowd(lvl), crowd(lvl + 1))}</div>
          <div class="mc-kv"><span>MATCH COINS</span>${next(`+${lvl * 10}%`, `+${(lvl + 1) * 10}%`)}</div>
        </div>
      </div>
      <p class="mc-hint">A bigger ground packs in more fans and pays more coins for every home match.</p>
      <div class="btn-row"><button class="btn btn-go btn-lg ${app.save.coins < cost ? 'poor' : ''}" data-a="upgrade" ${maxed ? 'disabled' : ''}>${maxed ? 'FULLY UPGRADED' : `UPGRADE · ${fmt(cost)}`}</button></div>`;
  };

  /** After a render: point the previews at the fresh canvases (or free them off the STADIUM tab). */
  const bindPreview = () => {
    if (tab !== 'stadium') {
      dropPreview();
      return;
    }
    if (!pv?.ok) return;
    const lvl = st.stadium;
    const canvases = scr.panel.querySelectorAll<HTMLCanvasElement>('.mc-stad3d');
    canvases.forEach((c) => pv!.set(Number(c.dataset.slot), c, lvl + Number(c.dataset.slot)));
    if (lvl >= STADIUM_MAX) pv.clear(1);
  };

  const draw = () => {
    const body = tab === 'squad' ? squadHtml() : tab === 'train' ? trainHtml() : tab === 'kit' ? kitHtml() : stadiumHtml();
    scr.render(
      `${topBar(backLabel, 'MY CLUB', esc(club.name.toUpperCase()), app.save.coins)}
      <div class="mc-clubbar">
        ${shirtArt(club.kit, 4)}
        <div class="mc-clubtxt"><b>${esc(club.name)}</b><span>${esc(club.short)} · ${club.formation} · ${club.squad.length} PLAYERS · ${STADIUM_NAMES[st.stadium]}</span></div>
        <div class="mc-ovrbox"><small>OVR</small><b>${clubRating(club)}</b></div>
      </div>
      <div class="seg mc-tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}`,
      {
        back,
        tab: (el) => {
          tab = el.dataset.v as ClubTab;
          sel = -1;
          scr.panel.scrollTop = 0;
          draw();
        },
        pick: (el) => {
          const i = Number(el.dataset.i);
          if (sel < 0) sel = i;
          else if (sel === i) sel = -1;
          else {
            swapPlayers(club, sel, i);
            sel = -1;
            app.persist();
          }
          draw();
        },
        form: (el) => {
          setFormation(club, el.dataset.v as FormationId);
          sel = -1;
          app.persist();
          draw();
        },
        autopick: () => {
          autoPick(club);
          sel = -1;
          app.persist();
          draw();
          scr.toast('BEST XI PICKED', 'good');
        },
        tpick: (el) => {
          trainIdx = Number(el.dataset.i);
          draw();
          scr.panel.querySelector('.mc-tcard')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        },
        tprev: () => {
          trainIdx = (trainIdx - 1 + club.squad.length) % club.squad.length;
          draw();
        },
        tnext: () => {
          trainIdx = (trainIdx + 1) % club.squad.length;
          draw();
        },
        train: (el) => {
          const p = club.squad[trainIdx];
          const k = el.dataset.k as keyof PlayerStats;
          const was = p.stats[k];
          const ovr = overall(p);
          const r = trainPlayer(club, app.save, p.id, k);
          if (!r.ok) {
            scr.toast(failText(r.reason), 'bad');
            return;
          }
          app.persist();
          sfx.coin();
          draw();
          const now = overall(p);
          scr.toast(`${STAT_SHORT[k]} ${was} → ${p.stats[k]}${now !== ovr ? ` · OVR ${ovr} → ${now}` : ''}`, 'good');
        },
        ...kitHandlers(club.kit, part, () => {
          app.persist();
          draw();
        }),
        upgrade: () => {
          const r = upgradeStadium(st, app.save);
          if (!r.ok) {
            scr.toast(failText(r.reason), 'bad');
            return;
          }
          app.persist();
          sfx.coin();
          draw();
          scr.toast(`WELCOME TO THE ${STADIUM_NAMES[st.stadium]}!`, 'good');
        },
      },
      {
        cname: (el) => {
          const v = el.value.replace(NAME_BAD, '');
          if (v !== el.value) el.value = v;
          const ok = sanitizeName(v).length >= 2;
          el.classList.toggle('bad', !ok);
          if (!ok) return;
          club.name = sanitizeName(v);
          app.persist();
          const kp = scr.panel.querySelector('.mc-preview');
          if (kp) kp.innerHTML = previewHtml(club.kit, club.name, club.short);
          const bar = scr.panel.querySelector('.mc-clubtxt b');
          if (bar) bar.textContent = club.name;
        },
        cshort: (el) => {
          const v = sanitizeShort(el.value);
          if (v !== el.value) el.value = v;
          el.classList.toggle('bad', v.length !== 3);
          if (v.length !== 3) return;
          club.short = v;
          app.persist();
          const kp = scr.panel.querySelector('.mc-preview');
          if (kp) kp.innerHTML = previewHtml(club.kit, club.name, club.short);
        },
      },
    );
    bindPreview();
  };
  draw();
}
