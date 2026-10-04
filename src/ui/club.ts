import { isPairAllowed } from '../core/names';
/**
 * My Club screens (club creation, squad, training, kit, stadium) plus the small screen kit shared with the
 * career UI. Screens mount into the menus root alongside (never on top of) Menus' own screens.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import {
  KEY_STATS, PATTERNS, SQUAD_MAX, STADIUM_NAMES, STAT_CAP, STAT_KEYS, STAT_NAME, STAT_SHORT, TRAIN_STEP,
  buildPart, clubRating, createClub, keeperColor, lineupIssues, migrateCareer, newClubLevel, randomKit,
  sanitizeName, sanitizeShort, setFormation, swapPlayers, trainPlayer, trainingCost, trainingDiscount,
  type CareerState, type ClubState, type TxFail,
} from '../meta/career';
import { PARTS as GROUND_PARTS, capacity, groundLevel, nextBuild, partView, stadiumParts, type GroundState, type PartId } from '../meta/ground';
import { pixelIcon } from './pixelIcons';
import './forever.css';
import { NAME_DISALLOWED, cleanName, fallbackShort, isNameAllowed, nameIssue, nameProblem, nameWhy, suggestName } from '../core/names';
import { defaultCrest, randomCrest, setMyCrest, type CrestDesign } from '../core/crest';
import { crestDesignSvg } from './crest';
import { crestEditorHandlers, crestEditorHtml, crestFollowKit, type CrestEditState } from './crestEditor';
import { KIT_COLORS } from '../meta/data';
import { SHORTLIST_MAX, WAGE_DIP, marketSummary, wageOf } from '../meta/market';
import { BENCH_SIZE, autoLineupFit, trainBest } from '../meta/squad';
// The long game (ui/glory.ts draws it): the STAFF tab, the GROW card, morale badges, ROTATE and TEAM TALK.
import { assignMentors } from '../meta/events';
import { isInjured, rotate, rotateSuggestion, talkWait, teamTalk } from '../meta/morale';
import { isOpen } from '../meta/week';
import { defaultStaffUi, growHandlers, growHtml, moodBadge, moodWord, seeReport, staffHandlers, staffTab } from './glory';
import { buzz } from '../platform/haptics';
import { localDay } from '../core/day';
import { gems } from '../meta/gems';
import { adsLeft, useAd } from '../meta/loops';
import { finishBuildCost, finishBuildNow, skipBuildMatchday } from '../meta/premium';
import { ads } from '../platform/ads';
import { iap } from '../platform/iap';
import { confirmGems, gemPrice, gemsHtml } from './gemUi';
import { openShop } from './shop';
import { openMarket } from './market';
import { sep } from './text';
import { cssHex } from '../render/palette';
import { FORMATIONS, FORMATION_IDS } from '../sim/formations';
import { overall, type FormationId, type Kit, type KitPattern, type PlayerDef, type PlayerStats } from '../sim/types';
import { bindDragSwap } from './dragSwap';
import { pitchLayout, shirtArt } from './menus';
import { paneScrolls, restorePaneScrolls, revealInPane } from './panes';
import { StadiumPreview, faceHtml, hydrateFaces, stadiumIsoSvg } from './preview';
import { partSpot } from '../render/stadium';
// The club screens' and the in-match tactics screen's layout (pitch plus bench, master and detail).
import './squad.css';

// ------------------------------------------------------------------ shared screen kit

/**
 * Live verdict on a name field: red when it can't be used; "Pick another name" (and a shake, unless the
 * player prefers reduced motion) when it is on the blocklist. The message sits in the field's .mc-why.
 */
export function markField(input: HTMLElement | null, problem: '' | 'short' | 'blocked', why = 'Pick another name'): void {
  if (!input) return;
  const wrap = input.closest<HTMLElement>('.mc-field') ?? input;
  input.classList.toggle('bad', problem !== '');
  const was = wrap.classList.contains('blocked');
  wrap.classList.toggle('blocked', problem === 'blocked');
  const em = wrap.querySelector('.mc-why');
  if (em) em.textContent = problem === 'blocked' ? why : '';
  if (problem === 'blocked' && !was) {
    wrap.classList.remove('shake');
    void wrap.offsetWidth;
    wrap.classList.add('shake');
  }
}

/** Why a typed short code can't be used: three letters or digits that aren't a blocked word. */
export function shortProblem(code: string): '' | 'short' | 'blocked' {
  if (code.length && !isNameAllowed(code)) return 'blocked';
  return code.length === 3 ? '' : 'short';
}

export type Handlers = Record<string, (el: HTMLElement) => void>;
export type InputHandlers = Record<string, (el: HTMLInputElement) => void>;
export type ToastKind = 'good' | 'bad' | 'info';

export interface MetaScreen {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  /** Replace the panel content (keeps its scroll position, and each keyed list's) and the click/input handlers. */
  render(html: string, on: Handlers, inputs?: InputHandlers): void;
  toast(msg: string, kind?: ToastKind): void;
}

let activeRoot: HTMLDivElement | null = null;
/** The save of the screen now mounted (mountMeta): topBar draws its gems beside the coins. */
let barSave: AppContext['save'] | null = null;
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
  barSave = app.save;
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
      if (e.key === 'Enter' || e.key === 'Escape') (t as HTMLInputElement).blur();
    }
  });
  // Esc goes back (docs/UX.md), unless something on top took it first (a sheet's own Esc stops the event).
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || activeRoot !== root) return;
    const backBtn = panel.querySelector<HTMLButtonElement>('[data-a=back]');
    if (!backBtn || backBtn.disabled) return;
    e.preventDefault();
    backBtn.click();
  };
  window.addEventListener('keydown', onEsc);
  onMetaClose(() => window.removeEventListener('keydown', onEsc));
  return {
    root,
    panel,
    render(html, on, inp) {
      const top = panel.scrollTop;
      // Lists inside panes (`.pane-scroll` with a data-scroll-key or data-key) keep their place too (src/ui/panes.ts).
      const lists = paneScrolls(panel);
      panel.innerHTML = html;
      clicks = on;
      inputs = inp ?? {};
      panel.scrollTop = top;
      restorePaneScrolls(panel, lists);
    },
    toast(msg, kind = 'info') {
      toastEl.textContent = msg;
      // Just under the panel's title bar (never over the title, back button or coins), or the panel's top
      // edge once that bar has scrolled away.
      // Layout offsets, not client rects: the panel may still be mid entrance animation.
      const y = (el: HTMLElement) => {
        let v = 0;
        for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) v += n.offsetTop;
        return v;
      };
      const pTop = y(panel);
      const bar = panel.querySelector<HTMLElement>('.mc-top');
      const barBottom = bar ? y(bar) + bar.offsetHeight - panel.scrollTop : pTop;
      // App-shell screens: a slim toast right under the header, over the tabs (never over a pane's buttons).
      toastEl.style.top = `${Math.round(Math.max(pTop + 8, barBottom + (root.classList.contains('shell') ? 4 : 14)))}px`;
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
    <button class="btn btn-white mc-back" data-a="back" aria-label="${esc(back)}">←<span>${esc(back)}</span></button>
    <div class="mc-title"><h2>${title}</h2><span>${sub}</span></div>
    <div class="mc-wallet">${barSave ? gemsHtml(gems(barSave)) : ''}${coinsHtml(coins)}</div>
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
    case 'window-closed': return 'TRANSFER WINDOW CLOSED';
    case 'wages': return 'OVER THE WAGE BUDGET';
    case 'pending': return 'ALREADY IN TALKS';
    case 'bad-amount': return 'OFFER 60% TO 110% OF ASKING';
    case 'shortlist-full': return `SHORTLIST FULL (${SHORTLIST_MAX} MAX)`;
    case 'expired': return 'THAT DEAL HAS GONE';
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

/** Part tabs (with SHUFFLE beside them), the colours, the patterns: compact enough to sit beside the preview. */
function kitEditorHtml(kit: Kit, part: KitPart): string {
  return `<div class="mc-kited">
    <div class="ck-partrow">
      <div class="seg mc-parts">${PARTS.map(([k, l]) => `<button class="${k === part ? 'on' : ''}" data-a="kpart" data-v="${k}">${l}</button>`).join('')}</div>
      <button class="btn btn-white mc-rand" data-a="randkit" aria-label="Shuffle the kit">SHUFFLE</button>
    </div>
    <div class="mc-swatches">${COLORS.map(([n, c]) => `<button class="mc-sw ${kit[part] === c ? 'on' : ''}" data-a="color" data-v="${c}" style="--sw:${cssHex(c)}" aria-label="${n}" title="${n.toUpperCase()}"></button>`).join('')}</div>
    <div class="mc-pats">${PATTERNS.map((p) => `<button class="mc-pat ${kit.pattern === p ? 'on' : ''}" data-a="pattern" data-v="${p}">${shirtArt({ ...kit, pattern: p }, 3)}<span>${p.toUpperCase()}</span></button>`).join('')}</div>
  </div>`;
}

function kitHandlers(kit: Kit, part: { v: KitPart }, changed: () => void): Handlers {
  return {
    // ('kpart', not 'part': MY CLUB's STADIUM tab has a 'part' action of its own.)
    kpart: (el) => {
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

/** KIT or CREST: which editor the right pane shows (the preview makes that one the bigger). */
type KitMode = 'kit' | 'crest';

function previewHtml(kit: Kit, name: string, short: string, crest?: CrestDesign, mode: KitMode = 'kit'): string {
  const badge = crest ? crestDesignSvg(crest, short.length === 3 ? short : '', name, 6) : '';
  return `<div class="ck-pvrow ${mode}">${badge}${shirtArt(kit, 12)}</div><b>${esc(name || 'YOUR CLUB')}</b><span>${esc(short.length === 3 ? short : '???')}</span>`;
}

function modeTabs(mode: KitMode): string {
  return `<div class="seg ck-mode" role="tablist">${(['kit', 'crest'] as const).map((k) => `<button class="${k === mode ? 'on' : ''}" data-a="kmode" data-v="${k}" role="tab" aria-selected="${k === mode}">${k === 'kit' ? 'KIT' : 'CREST'}</button>`).join('')}</div>`;
}

/**
 * A name field's verdict with its friendly line (core/names.ts nameWhy), and the "use this instead" chip under the
 * fields: a name to tap when the typed one was turned down (rude, or a real club's or a brand's).
 */
function markName(panel: HTMLElement, input: HTMLElement | null, raw: string, seed: number): void {
  const issue = nameIssue(raw);
  markField(input, issue === 'rude' || issue === 'reserved' ? 'blocked' : issue, nameWhy(issue) || undefined);
  const chip = panel.querySelector<HTMLButtonElement>('.mc-suggest');
  if (!chip) return;
  const off = issue !== 'rude' && issue !== 'reserved';
  chip.hidden = off;
  if (!off) {
    const s = suggestName(raw, seed);
    chip.dataset.v = s;
    chip.textContent = `USE ${s.toUpperCase()}`;
  }
}

const SUGGESTED = ['Pixel Park FC', 'Cube City', 'Voxel Rovers', 'Brick Lane FC', 'Blocky Town', 'Square United', 'Crate Albion'];

/** First-run club builder: name, short name, kit, formation. Generates the 16-man squad on CREATE. */
export function clubCreate(app: AppContext, onDone: () => void, onBack: () => void): void {
  const st = careerState(app);
  const scr = mountMeta(app, 'mc-create-screen shell');
  const name0 = SUGGESTED[Math.floor(Math.random() * SUGGESTED.length)];
  const d = {
    name: name0,
    short: fallbackShort(name0),
    shortEdited: false,
    kit: randomKit(new Rng((Math.random() * 2 ** 32) >>> 0)),
    formation: '4-4-2' as FormationId,
  };
  const part = { v: 'shirt' as KitPart };
  // The crest starts in the kit's colours and follows them until the player picks crest colours of his own.
  const kitColors = (Object.values(KIT_COLORS) as number[]);
  const ced: CrestEditState = { crest: randomCrest(Math.random, kitColors, { c1: d.kit.shirt, c2: d.kit.shirt2 }), tab: 'shape', col: 'c1' };
  crestFollowKit(ced.crest, d.kit);
  let ownColors = false;
  let mode: KitMode = 'kit';
  const suggestSeed = Math.floor(Math.random() * 1000);
  const valid = () => sanitizeName(d.name).length >= 2 && nameProblem(d.name) === '' && sanitizeShort(d.short).length === 3 && isPairAllowed(d.name, d.short);
  const shown = () => sanitizeName(d.name) || (nameProblem(d.name) === 'blocked' ? '' : cleanName(d.name));
  const update = () => {
    const pv = scr.panel.querySelector('.mc-preview');
    if (pv) pv.innerHTML = previewHtml(d.kit, shown(), d.short, ced.crest, mode);
    const btn = scr.panel.querySelector<HTMLButtonElement>('[data-a=create]');
    if (btn) btn.disabled = !valid();
    markName(scr.panel, scr.panel.querySelector('[data-in=name]'), d.name, suggestSeed);
    const sp = shortProblem(d.short);
    markField(scr.panel.querySelector('[data-in=short]'), sp === '' && d.short.length === 3 && !isPairAllowed(d.name, d.short) && nameProblem(d.name) === '' ? 'blocked' : sp, nameWhy('rude', 'code'));
  };
  const draw = () =>
    scr.render(
      // One screen (docs/UX.md): name and badge on the left, kit and shape on the right, CREATE CLUB pinned.
      `${topBar('BACK', 'NEW CLUB', 'FOUND YOUR TEAM', app.save.coins)}
      <div class="mc-body ck-body">
        <div class="pane ck-id">
          <div class="mc-preview">${previewHtml(d.kit, shown(), d.short, ced.crest, mode)}</div>
          <div class="mc-fields">
            <label class="mc-field"><span>CLUB NAME</span><input data-in="name" maxlength="18" value="${esc(d.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done"><em class="mc-why" aria-live="polite"></em></label>
            <label class="mc-field mc-short"><span>SHORT</span><input data-in="short" maxlength="3" value="${esc(d.short)}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done"><em class="mc-why" aria-live="polite"></em></label>
          </div>
          <button class="mc-suggest" data-a="usename" hidden></button>
        </div>
        <div class="pane ck-ed">
          ${modeTabs(mode)}
          ${mode === 'kit'
            ? `${kitEditorHtml(d.kit, part.v)}<div class="ck-forms"><span class="ck-lbl">FORMATION</span>${formationButtons(d.formation, 'form')}</div>`
            : crestEditorHtml(ced, shown(), d.short.length === 3 ? d.short : '')}
        </div>
      </div>
      <div class="mc-actions">
        <span class="grow mc-note">16 PLAYERS${sep()}SUNDAY LEAGUE</span>
        <button class="btn btn-go" data-a="create" ${valid() ? '' : 'disabled'}>CREATE CLUB</button>
      </div>`,
      {
        back: onBack,
        ...kitHandlers(d.kit, part, () => {
          if (!ownColors) crestFollowKit(ced.crest, d.kit);
          redraw();
        }),
        ...crestEditorHandlers(ced, () => d.kit, redraw),
        ccolor: (el) => {
          ownColors = true;
          ced.crest[ced.col] = Number(el.dataset.v);
          redraw();
        },
        kmode: (el) => {
          mode = el.dataset.v as KitMode;
          redraw();
        },
        usename: (el) => {
          const v = el.dataset.v ?? '';
          if (!v) return;
          d.name = v;
          if (!d.shortEdited) d.short = fallbackShort(v);
          redraw();
        },
        form: (el) => {
          d.formation = el.dataset.v as FormationId;
          redraw();
        },
        create: () => {
          if (!valid()) return;
          st.club = createClub({ name: d.name, short: d.short, kit: d.kit, formation: d.formation, crest: ced.crest }, st.seed, newClubLevel(st));
          setMyCrest(st.club);
          app.persist();
          sfx.coin();
          onDone();
        },
      },
      {
        name: (el) => {
          const v = el.value.replace(NAME_DISALLOWED, '');
          if (v !== el.value) el.value = v;
          d.name = v;
          if (!d.shortEdited) {
            // The code comes from the name; a blocked one (or a blocked name) falls back to letters that pass.
            d.short = fallbackShort(cleanName(v));
            const s = scr.panel.querySelector<HTMLInputElement>('[data-in=short]');
            if (s) s.value = d.short;
          }
          update();
        },
        short: (el) => {
          const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
          if (v !== el.value) el.value = v;
          d.short = v;
          d.shortEdited = true;
          update();
        },
      },
    );
  /** Redraw, then put the name fields' verdicts (and the suggestion chip) back on the fresh markup. */
  const redraw = () => {
    draw();
    update();
  };
  redraw();
}

// ------------------------------------------------------------------ club hub

/** 'market' opens the transfer market screen (ui/market.ts) with BACK returning to the club hub. */
export type ClubTab = 'squad' | 'train' | 'staff' | 'kit' | 'stadium' | 'market';

export interface ClubOpts {
  tab?: ClubTab;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

/** The club screen's last tab and TRAIN pick, kept for the session (docs/UX.md section 8: memory). */
let lastTab: Exclude<ClubTab, 'market'> = 'squad';
let lastTrainId = '';
/** The TRAIN tab's right pane: the paid +2 sessions, or the player's GROW card (ui/glory.ts). */
let lastTrainMode: 'stats' | 'grow' = 'stats';
let lastKitMode: KitMode = 'kit';
/** The SQUAD hint ("TAP OR DRAG TO SWAP") shows until the first swap of the session. */
let swappedOnce = false;

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
  const backLabel = opts.backLabel ?? 'MENU';
  if (opts.tab === 'market') {
    openMarket(app, { backLabel, onBack: () => clubHub(app, st, st.club!, lastTab, back, backLabel) });
    return;
  }
  clubHub(app, st, st.club, opts.tab ?? lastTab, back, backLabel);
}

const TABS: [ClubTab, string][] = [['squad', 'SQUAD'], ['train', 'TRAIN'], ['staff', 'STAFF'], ['market', 'MARKET'], ['kit', 'KIT'], ['stadium', 'STADIUM']];

function lastName(name: string): string {
  const parts = name.split(' ');
  return parts[parts.length - 1] ?? name;
}

/**
 * MY CLUB: one screen per tab, no page scroll (docs/UX.md). The club's name and OVR ride in the header; the tabs are
 * a slim row; each tab is a body of two panes:
 * - SQUAD: the formation rail and the pitch on the left, the bench and reserves on the right (the only list that
 *   scrolls). Swap by tap then tap, or drag and drop, with both ends on screen. AUTO PICK in the bench pane's header.
 * - TRAIN: the squad list on the left, the picked player's stats and +2 buttons on the right. TRAIN BEST on the list.
 * - KIT: the preview and the name on the left, the colours and patterns on the right.
 * - STADIUM: the ground's parts on the left (stands, lights, the dome, the screen, the megastore, the fan zone, the
 *   training ground, the academy), the picked one on the right: the ground with it, its numbers and BUILD.
 */
function clubHub(app: AppContext, st: CareerState, club: ClubState, tab0: ClubTab, back: () => void, backLabel: string): void {
  const scr = mountMeta(app, 'mc-club-screen shell');
  // (STAFF opens after a career's first matches, meta/week.ts: until then the tab isn't there.)
  let tab: Exclude<ClubTab, 'market'> = tab0 === 'market' || (tab0 === 'staff' && !isOpen(st, 'staff')) ? 'squad' : tab0;
  lastTab = tab;
  let trainMode = lastTrainMode;
  const staffUi = defaultStaffUi(st);
  let sel = -1;
  let trainIdx = Math.max(0, club.squad.findIndex((p) => p.id === lastTrainId));
  /** Squad indices just swapped (they pop once). */
  let fresh: number[] = [];
  const part = { v: 'shirt' as KitPart };
  // The KIT tab's second editor: the crest (a club from before the designer gets its default to start from).
  club.crest ??= defaultCrest(club.name, club.short, club.kit);
  const ced: CrestEditState = { crest: club.crest, tab: 'shape', col: 'c1' };
  let kitMode: KitMode = lastKitMode;
  const suggestSeed = Math.floor(Math.random() * 1000);

  // ---- SQUAD

  const roleCls = (p: PlayerDef) => `r-${p.role}`;

  /** A bench or reserve chip: number, surname, role (its colour) and OVR. The whole chip is the tap and drag target. */
  const chip = (p: PlayerDef, i: number) => {
    const cls = ['sq-chip', roleCls(p), sel === i ? 'sel' : '', sel >= 0 && sel !== i ? 'hot' : '', fresh.includes(i) ? 'fresh' : '', isInjured(p) ? 'hurt' : ''];
    // (A badge only when there is something to say: injured, morale high, morale low. ui/glory.ts)
    return `<button class="${cls.filter(Boolean).join(' ')}" data-a="pick" data-i="${i}" data-drag="${i}" aria-pressed="${sel === i}"
      aria-label="${esc(p.name)}, ${p.role}, overall ${overall(p)}${moodWord(p)}"><i class="sq-num">${p.number}</i><span class="sq-nm">${esc(lastName(p.name))}</span>${moodBadge(p)}<em class="sq-role">${p.role}</em><b class="sq-ovr">${overall(p)}</b></button>`;
  };

  const pitchHtml = (issues: Set<number>) => {
    const light = lum(club.kit.shirt) > 0.62;
    // Same team-sheet pitch as the in-match tactics screen (menus.ts pitchLayout + .tx-p tokens).
    const slots = FORMATIONS[club.formation];
    const pos = pitchLayout(slots);
    return `<div class="tx-pitch mc-teampitch" style="--shirt:${cssHex(club.kit.shirt)};--trim:${cssHex(club.kit.shirt2)};--gk:${cssHex(club.kit.gk)};--dot-t:${light ? 'var(--ink)' : '#fff'}">
      ${slots
        .map((s, i) => {
          const p = club.squad[i];
          if (!p) return '';
          const [left, top, room] = pos[i];
          const warn = issues.has(i);
          const cls = ['tx-p', roleCls(p), i === 0 ? 'gk' : '', sel === i ? 'sel' : '', sel >= 0 && sel !== i ? 'hot' : '', warn ? 'warn' : '', fresh.includes(i) ? 'fresh' : '', isInjured(p) ? 'hurt' : ''];
          return `<button class="${cls.filter(Boolean).join(' ')}" data-a="pick" data-i="${i}" data-drag="${i}" aria-pressed="${sel === i}" style="left:${left}%;top:${top}%;--room:${room}%"
            aria-label="${s.label} ${esc(p.name)}, ${p.role}, overall ${overall(p)}${warn ? ', out of position' : ''}${moodWord(p)}"><span class="tx-shirt"><b>${p.number}</b><i class="tx-ovr">${overall(p)}</i></span><em class="tx-nm">${esc(lastName(p.name))}</em>${warn ? '<i class="tx-warn" aria-hidden="true">!</i>' : ''}${moodBadge(p)}</button>`;
        })
        .join('')}
    </div>`;
  };

  const squadHtml = () => {
    const issues = lineupIssues(club);
    const bench = club.squad.slice(11, 11 + BENCH_SIZE);
    const reserves = club.squad.slice(11 + BENCH_SIZE);
    // At most one hint, and only until it has been done once (docs/UX.md section 6).
    const hint =
      sel >= 0
        ? `<b class="sq-hint sel">${esc(lastName(club.squad[sel].name).toUpperCase())}: PICK WHO TO SWAP</b>`
        : issues.length
          ? `<b class="sq-hint warn">${issues.length} OUT OF POSITION</b>`
          : swappedOnce ? '' : '<b class="sq-hint">TAP OR DRAG TO SWAP</b>';
    // The one-tap helpers beside AUTO PICK (meta/morale.ts): ROTATE when there is a swap worth making (an injured
    // starter, a man who wants a game), TEAM TALK every third matchday.
    const swapPick = isOpen(st, 'rotate') ? rotateSuggestion(st) : null;
    const rotateBtn = swapPick
      ? `<button class="btn gl-help go pulse" data-a="rotate" aria-label="Rotate: ${esc(club.squad[swapPick.in].name)} in for ${esc(club.squad[swapPick.out].name)}">ROTATE</button>`
      : '';
    const wait = talkWait(st);
    const talkBtn = isOpen(st, 'talk')
      ? `<button class="btn gl-help" data-a="talk" ${wait > 0 || st.events.talk ? 'disabled' : ''} aria-label="Team talk${st.events.talk ? ', on for your next match' : wait ? `, ready after ${wait} more matches` : ''}">${pixelIcon('chat', 'currentColor', 1.2)}TALK${st.events.talk ? '<small>ON</small>' : wait ? `<small>${wait}</small>` : ''}</button>`
      : '';
    return `<div class="mc-body sq-body">
        <div class="pane sq-pitchpane">
          <div class="sq-rail" role="group" aria-label="Formation">${FORMATION_IDS.map((f) => `<button class="${f === club.formation ? 'on' : ''}" data-a="form" data-v="${f}" aria-pressed="${f === club.formation}">${f}</button>`).join('')}</div>
          ${pitchHtml(new Set(issues))}
        </div>
        <div class="pane sq-benchpane">
          <div class="pane-h"><span class="sq-ph">BENCH</span><span class="grow">${hint}</span>${rotateBtn}${talkBtn}<button class="btn btn-yellow sq-auto ${issues.length ? 'pulse' : ''}" data-a="autopick">AUTO PICK</button></div>
          <div class="pane-scroll sq-list" data-scroll-key="sq-bench">
            <div class="sq-grid">${bench.map((p, j) => chip(p, 11 + j)).join('')}</div>
            ${reserves.length ? `<div class="sq-sub">RESERVES</div><div class="sq-grid">${reserves.map((p, j) => chip(p, 11 + BENCH_SIZE + j)).join('')}</div>` : ''}
          </div>
        </div>
      </div>`;
  };

  const swap = (a: number, b: number) => {
    if (!swapPlayers(club, a, b)) return;
    sel = -1;
    fresh = [a, b];
    swappedOnce = true;
    app.persist();
    buzz('tap');
    draw();
    fresh = [];
  };

  // Drag and drop on the SQUAD tab (src/ui/dragSwap.ts): any player onto any other swaps them.
  onMetaClose(
    bindDragSwap(scr.panel, {
      canDrop: (a, b) => tab === 'squad' && a !== b,
      onDrop: (a, b) => swap(Number(a), Number(b)),
    }),
  );

  // ---- TRAIN

  /** Training raises a player's wage (OVR² / 40 a week); over the budget, coins drain after every match. */
  const wageLine = (p: PlayerDef) => {
    const s = marketSummary(st);
    const over = s.drain > 0;
    const text = over
      ? `OVER BUDGET${sep()}${fmt(s.drain)} COINS A MATCH, ${WAGE_DIP} OVR DOWN`
      : `WAGE ${fmt(wageOf(p))} A WEEK${sep()}SQUAD ${fmt(s.wages)} OF ${fmt(s.budget)}`;
    return `<p class="tr-wage ${over ? 'warn' : ''}">${text}</p>`;
  };

  const trainHtml = () => {
    trainIdx = Math.max(0, Math.min(club.squad.length - 1, trainIdx));
    const p = club.squad[trainIdx];
    // (The TRAINING GROUND and the legacy coach perk take some off: meta/ground.ts, meta/legacy.ts.)
    const cost = trainingCost(p, trainingDiscount(st));
    const poor = app.save.coins < cost;
    const keys = KEY_STATS[p.role];
    // His role's key stats first (green), then the rest.
    const order = [...keys, ...STAT_KEYS.filter((k) => !keys.includes(k))];
    const best = trainBest(club.squad);
    // The GROW card (ui/glory.ts) once the training focus has opened: the chart, XP, focus, mentor, morale.
    const growOpen = isOpen(st, 'focus');
    const growing = growOpen && trainMode === 'grow';
    const slots = FORMATIONS[club.formation];
    const where = trainIdx < 11 ? slots[trainIdx]?.label ?? '' : trainIdx < 11 + BENCH_SIZE ? 'BENCH' : 'RESERVE';
    const row = (q: PlayerDef, i: number) => `<button class="tr-row ${roleCls(q)} ${i === trainIdx ? 'sel' : ''}" data-a="tpick" data-i="${i}" aria-pressed="${i === trainIdx}">
        <em class="sq-role">${q.role}</em><i class="sq-num">${q.number}</i><span class="sq-nm">${esc(q.name)}</span>${best?.index === i && !growing ? '<i class="tr-tip">BEST</i>' : ''}${moodBadge(q)}<b class="sq-ovr">${overall(q)}</b></button>`;
    const stats = order
      .map((k) => {
        const v = p.stats[k];
        const maxed = v >= STAT_CAP;
        return `<div class="tr-st ${keys.includes(k) ? 'key' : ''}">
          <span title="${STAT_NAME[k]}">${STAT_SHORT[k]}</span>
          <div class="mc-meter"><i style="width:${v}%"></i></div>
          <b>${v}</b>
          <button class="btn btn-go tr-btn ${poor ? 'poor' : ''}" data-a="train" data-k="${k}" ${maxed ? 'disabled' : ''} aria-label="${maxed ? `${STAT_NAME[k]} maxed` : `Train ${STAT_NAME[k]}, ${fmt(cost)} coins`}">${maxed ? 'MAX' : `+${TRAIN_STEP}`}</button>
        </div>`;
      })
      .join('');
    return `<div class="mc-body split-l tr-body">
        <div class="pane">
          <div class="pane-h"><span class="sq-ph">SQUAD</span><span class="grow"></span>${
            growing && isOpen(st, 'mentors')
              ? '<button class="btn btn-yellow tr-best" data-a="mentorall">AUTO MENTOR</button>'
              : `<button class="btn btn-yellow tr-best" data-a="trainbest" ${best ? '' : 'disabled'}>TRAIN BEST</button>`
          }</div>
          <div class="pane-scroll tr-list" data-scroll-key="tr-list">${club.squad.map(row).join('')}</div>
        </div>
        <div class="pane tr-detail">
          <div class="tr-id">
            ${faceHtml(p, club.kit, 'md')}
            <div class="tr-who"><b>${esc(p.name)}</b><span>${roleBadge(p.role)}<i>#${p.number}</i><i>${where}</i></span></div>
            ${growing ? '' : `<div class="tr-cost ${poor ? 'poor' : ''}"><small>+${TRAIN_STEP} COSTS</small><span class="coins mc-coins"><i></i><span>${fmt(cost)}</span></span></div>`}
            ${ovrBadge(overall(p))}
          </div>
          ${growOpen ? `<div class="seg gl-seg"><button class="${growing ? '' : 'on'}" data-a="tmode" data-v="stats" aria-pressed="${!growing}">TRAIN</button><button class="${growing ? 'on' : ''}" data-a="tmode" data-v="grow" aria-pressed="${growing}">GROW</button></div>` : ''}
          ${growing ? growHtml(st, club, p) : `<div class="tr-stats">${stats}</div>${wageLine(p)}`}
        </div>
      </div>`;
  };

  const trainStat = (k: keyof PlayerStats) => {
    const p = club.squad[trainIdx];
    const was = p.stats[k];
    const ovr = overall(p);
    const r = trainPlayer(club, app.save, p.id, k, trainingDiscount(st));
    if (!r.ok) {
      scr.toast(failText(r.reason), 'bad');
      return;
    }
    lastTrainId = p.id;
    app.persist();
    sfx.coin();
    buzz('tap');
    draw();
    const now = overall(p);
    scr.toast(`${lastName(p.name).toUpperCase()} ${STAT_SHORT[k]} ${was} → ${p.stats[k]}${now !== ovr ? ` / OVR ${ovr} → ${now}` : ''}`, 'good');
  };

  // ---- KIT

  const kitHtml = () => `<div class="mc-body ck-body">
      <div class="pane ck-id">
        <div class="mc-preview">${previewHtml(club.kit, club.name, club.short, ced.crest, kitMode)}</div>
        <div class="mc-fields">
          <label class="mc-field"><span>CLUB NAME</span><input data-in="cname" maxlength="18" value="${esc(club.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done"><em class="mc-why" aria-live="polite"></em></label>
          <label class="mc-field mc-short"><span>SHORT</span><input data-in="cshort" maxlength="3" value="${esc(club.short)}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done"><em class="mc-why" aria-live="polite"></em></label>
        </div>
        <button class="mc-suggest" data-a="usename" hidden></button>
      </div>
      <div class="pane ck-ed">
        ${modeTabs(kitMode)}
        ${kitMode === 'kit' ? `${kitEditorHtml(club.kit, part.v)}<p class="ck-note">CHANGES SAVE AUTOMATICALLY</p>` : crestEditorHtml(ced, club.name, club.short)}
      </div>
    </div>`;

  // ---- STADIUM: the ground, part by part (meta/ground.ts)

  /** Upgrade-screen 3D ground, alive only while the STADIUM tab is showing. */
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
  /** The part picked on the list: the one going up, else the cheapest you can build, else the main stand. */
  let partSel: PartId = st.ground.building?.id ?? nextBuild(st.ground)?.id ?? 'main';
  /** Parts that opened since the last look (a NEW chip each), taken when the tab first draws. */
  let freshParts = new Set<PartId>();
  const takeOpened = () => {
    if (!st.ground.opened.length) return;
    freshParts = new Set(st.ground.opened);
    st.ground.opened = [];
    app.persist();
  };

  /** The ground with the picked part's next step on it (what you would get), for the preview. */
  const withPart = (g: GroundState, id: PartId): GroundState => {
    const v = partView(g, id);
    if (v.status === 'built') return g;
    const level = v.status === 'building' ? (g.building?.level ?? v.level + 1) : v.level + 1;
    return { ...g, built: { ...g.built, [id]: level } };
  };

  const stadiumHtml = () => {
    const g = st.ground;
    const v = partView(g, partSel);
    const after = withPart(g, partSel);
    const gl = has3d();
    const status = (x: ReturnType<typeof partView>) =>
      x.status === 'built'
        ? '<em class="sd-ps ok">✓ BUILT</em>'
        : x.status === 'building'
          ? `<em class="sd-ps go">${pixelIcon('clock', 'currentColor', 1.3, 'inl')}${x.left} MD</em>`
          : x.status === 'locked'
            ? `<em class="sd-ps no">${pixelIcon('lock', 'currentColor', 1.3, 'inl')}</em>`
            : `<em class="sd-ps"><span class="sd-cost"><i></i>${fmt(x.next!.cost)}</span></em>`;
    const rows = GROUND_PARTS.map((def) => {
      const x = partView(g, def.id);
      const steps = def.steps.length;
      const lv = steps > 1 ? `<small>${x.level}/${steps}</small>` : '';
      return `<button class="sd-part ${x.status} ${def.id === partSel ? 'sel' : ''}" data-a="part" data-v="${def.id}" aria-pressed="${def.id === partSel}">
          ${pixelIcon(def.icon, 'currentColor', 1.6)}<span class="sd-pn">${def.name}${lv}${freshParts.has(def.id) ? '<b class="sd-new">NEW</b>' : ''}</span>${status(x)}
        </button>`;
    }).join('');
    const seats = capacity(g);
    const seatsAfter = capacity(after);
    const lvl = groundLevel(g);
    const lvlAfter = groundLevel(after);
    const next = v.next;
    const name = next?.name ?? v.def.steps[v.def.steps.length - 1].name;
    const poor = !!next && app.save.coins < next.cost;
    const busy = !!g.building && g.building.id !== partSel;
    const btn =
      v.status === 'built'
        ? '<button class="btn btn-go sd-up" disabled>BUILT</button>'
        : v.status === 'building'
          // Going up: it opens by itself after its matchdays. FINISH NOW opens it at once for gems (asked first, with the
          // price), and one rewarded ad a day takes a matchday off (economy v3: meta/premium.ts, meta/loops.ts).
          ? `<div class="sd-now">
              <button class="btn btn-go sd-up" data-a="finishnow" aria-label="Finish the ${esc(name.toLowerCase())} now for ${finishBuildCost(st)} gems">FINISH NOW ${gemPrice(finishBuildCost(st))}</button>
              ${ads.portal !== 'none' && adsLeft(app.save, 'build', localDay()) > 0 ? `<button class="btn btn-yellow sd-up sd-ad" data-a="buildad" aria-label="Watch an ad to take one matchday off this build">${pixelIcon('film', '#26262e', 2, 'inl')}1 MATCHDAY OFF</button>` : ''}
            </div>
            <small class="sd-opens">OR IT OPENS IN ${v.left} ${v.left === 1 ? 'MATCHDAY' : 'MATCHDAYS'}</small>`
          : v.status === 'locked'
            ? `<button class="btn btn-go sd-up" disabled>${esc(v.needs ?? 'LOCKED')}</button>`
            : busy
              ? '<button class="btn btn-go sd-up" disabled>ONE BUILD AT A TIME</button>'
              : `<button class="btn btn-go sd-up ${poor ? 'poor' : ''}" data-a="build">BUILD <span class="sd-cost"><i></i>${fmt(next!.cost)}</span></button>`;
    const fact = (label: string, a: string, b: string) => `<span class="sd-fact"><small>${label}</small><b>${a}${a !== b ? ` <em>→ ${b}</em>` : ''}</b></span>`;
    return `<div class="mc-body split-l sd-body sd-parts">
        <div class="pane">
          <div class="pane-h"><span class="sq-ph">THE GROUND</span><span class="grow"></span><span class="sd-seats">${fmt(seats)} SEATS</span></div>
          <div class="pane-scroll sd-list" data-scroll-key="sd-list">${rows}</div>
        </div>
        <div class="pane sd-info">
          <figure class="mc-stadview solo sd-one">
            ${gl ? `<canvas class="mc-stad3d" data-slot="0" aria-label="${esc(name)} preview"></canvas>` : stadiumIsoSvg(lvlAfter)}
            <figcaption><span>${v.status === 'built' ? 'NOW' : 'WITH IT'}</span><b>${esc(name)}</b></figcaption>
          </figure>
          <span class="mc-stadlvl">${esc(v.def.does)}</span>
          <div class="sd-facts">
            ${fact('SEATS', fmt(seats), fmt(seatsAfter))}
            ${lvl !== lvlAfter ? fact('GROUND', STADIUM_NAMES[lvl], STADIUM_NAMES[lvlAfter]) : ''}
            ${next ? `<span class="sd-fact"><small>BUILD</small><b>${next.weeks} ${next.weeks === 1 ? 'MATCHDAY' : 'MATCHDAYS'}</b></span>` : ''}
          </div>
          ${btn}
        </div>
      </div>`;
  };

  /** After a render: point the preview at the fresh canvas (or free it off the STADIUM tab). */
  const bindPreview = () => {
    if (tab !== 'stadium') {
      dropPreview();
      return;
    }
    if (!pv?.ok) return;
    const after = withPart(st.ground, partSel);
    const c = scr.panel.querySelector<HTMLCanvasElement>('.mc-stad3d');
    if (c) pv.set(0, c, groundLevel(after), stadiumParts(after), partSpot(partSel));
  };

  // ---- the screen

  /** The header's subtitle: the club and its OVR (what the old banner said, in one line). */
  const sub = () => `<i class="mc-clubname">${esc(club.name.toUpperCase())}</i><b class="mc-ovrchip">OVR ${clubRating(club)}</b>`;

  const draw = () => {
    if (tab === 'stadium') takeOpened();
    const body = tab === 'squad' ? squadHtml() : tab === 'train' ? trainHtml() : tab === 'staff' ? staffTab(app, st, staffUi) : tab === 'kit' ? kitHtml() : stadiumHtml();
    const tabs = TABS.filter(([k]) => k !== 'staff' || isOpen(st, 'staff'));
    scr.render(
      `${topBar(backLabel, 'MY CLUB', sub(), app.save.coins)}
      <div class="seg mc-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}" role="tab" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
      ${body}`,
      {
        back,
        // The long game's taps (ui/glory.ts): the STAFF tab, and the GROW card of the player picked on TRAIN.
        ...staffHandlers(app, st, staffUi, draw, scr.toast, () => scr.root),
        ...growHandlers(app, st, club, () => club.squad[trainIdx], draw, scr.toast, () => scr.root),
        tmode: (el) => {
          trainMode = el.dataset.v === 'grow' ? 'grow' : 'stats';
          lastTrainMode = trainMode;
          draw();
        },
        mentorall: () => {
          const n = assignMentors(st);
          app.persist();
          buzz('tap');
          draw();
          scr.toast(n ? `${n} ${n === 1 ? 'YOUNGSTER HAS' : 'YOUNGSTERS HAVE'} A MENTOR NOW` : 'NO FREE VETERAN FOR A YOUNGSTER', n ? 'good' : 'info');
        },
        rotate: () => {
          const pick = rotateSuggestion(st);
          const names = pick ? [lastName(club.squad[pick.in].name), lastName(club.squad[pick.out].name)] : [];
          if (!pick || !rotate(st)) return;
          sel = -1;
          fresh = [pick.in, pick.out];
          app.persist();
          buzz('tap');
          draw();
          fresh = [];
          scr.toast(`${names[0].toUpperCase()} IN FOR ${names[1].toUpperCase()}`, 'good');
        },
        talk: () => {
          const lift = teamTalk(st);
          if (!lift) return;
          app.persist();
          sfx.coin();
          buzz('success');
          draw();
          scr.toast(`TEAM TALK: MORALE +${lift}, AND +1 IN YOUR NEXT MATCH`, 'good');
        },
        tab: (el) => {
          const next = el.dataset.v as ClubTab;
          if (next === 'market') {
            openMarket(app, { backLabel: 'CLUB', onBack: () => clubHub(app, st, club, tab, back, backLabel) });
            return;
          }
          tab = next;
          lastTab = next;
          sel = -1;
          draw();
          if (tab === 'train') revealInPane(scr.panel.querySelector('.tr-row.sel'), 'center');
        },
        pick: (el) => {
          const i = Number(el.dataset.i);
          if (sel < 0) sel = i;
          else if (sel === i) sel = -1;
          else {
            swap(sel, i);
            return;
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
          // (The best XI of the fit players: anyone injured goes to the reserves.)
          club.squad = autoLineupFit(club.squad, club.formation);
          sel = -1;
          fresh = club.squad.slice(0, 11).map((_, i) => i);
          app.persist();
          buzz('tap');
          draw();
          fresh = [];
          scr.toast('BEST XI PICKED', 'good');
        },
        tpick: (el) => {
          trainIdx = Number(el.dataset.i);
          lastTrainId = club.squad[trainIdx]?.id ?? '';
          draw();
        },
        train: (el) => trainStat(el.dataset.k as keyof PlayerStats),
        trainbest: () => {
          const pick = trainBest(club.squad);
          if (!pick) return;
          trainIdx = pick.index;
          lastTrainId = club.squad[trainIdx]?.id ?? '';
          // Short of coins: the toast says so, and the pick still shows who it would be.
          if (app.save.coins < pick.cost) draw();
          trainStat(pick.stat);
          revealInPane(scr.panel.querySelector('.tr-row.sel'));
        },
        ...kitHandlers(club.kit, part, () => {
          setMyCrest(club);
          app.persist();
          draw();
        }),
        ...crestEditorHandlers(ced, () => club.kit, () => {
          club.crest = ced.crest;
          setMyCrest(club);
          app.persist();
          draw();
        }),
        kmode: (el) => {
          kitMode = el.dataset.v as KitMode;
          lastKitMode = kitMode;
          draw();
        },
        usename: (el) => {
          const v = sanitizeName(el.dataset.v ?? '');
          if (!v || nameProblem(v) !== '' || !isPairAllowed(v, club.short)) return;
          club.name = v;
          setMyCrest(club);
          app.persist();
          draw();
        },
        part: (el) => {
          partSel = el.dataset.v as PartId;
          draw();
        },
        build: () => {
          const r = buildPart(st, app.save, partSel);
          if (!r.ok) {
            scr.toast(r.reason === 'no-coins' ? 'NOT ENOUGH COINS' : r.reason === 'busy' ? 'ONE BUILD AT A TIME' : 'NOT YET', 'bad');
            return;
          }
          app.persist();
          sfx.coin();
          buzz('success');
          draw();
          const name = partView(st.ground, partSel).def.name;
          scr.toast(`BUILDING THE ${name}: READY IN ${r.weeks} ${r.weeks === 1 ? 'MATCHDAY' : 'MATCHDAYS'}`, 'good');
        },
        // FINISH NOW: the build opens at once for gems (GEM_PRICES.finishBuildPerMatchday a matchday left). One tap
        // to confirm, with the price and the free way on the sheet.
        finishnow: () => {
          const b = st.ground.building;
          if (!b) return;
          const what = partView(st.ground, b.id).def.steps[b.level - 1]?.name ?? partView(st.ground, b.id).def.name;
          confirmGems(scr.root, {
            title: `FINISH THE ${what} NOW?`, text: 'IT OPENS FOR YOUR NEXT HOME MATCH', price: finishBuildCost(st), have: gems(app.save), yes: 'FINISH',
            free: `OR PLAY ${b.left} ${b.left === 1 ? 'MATCHDAY' : 'MATCHDAYS'} AND IT OPENS BY ITSELF`,
            getGems: iap.storefront
              ? () => openShop(app, { tab: 'coins', section: 'gems', backLabel: 'MY CLUB', onBack: () => openClub(app, { tab: 'stadium' }) })
              : undefined,
            onYes: () => {
              if (!finishBuildNow(st, app.save)) return;
              app.persist();
              sfx.coin();
              buzz('success');
              draw();
              scr.toast(`THE ${what} IS OPEN`, 'good');
            },
          });
        },
        // One rewarded ad a day takes a matchday off the build: the player's own tap, a stated reward, a daily cap.
        buildad: async () => {
          if (!st.ground.building) return;
          if (adsLeft(app.save, 'build', localDay()) <= 0) {
            scr.toast("TODAY'S BUILD AD IS USED. BACK TOMORROW", 'info');
            return;
          }
          if (!ads.rewardedAvailable) {
            scr.toast('NO AD RIGHT NOW. TRY AGAIN LATER', 'info');
            return;
          }
          const watched = await ads.rewarded();
          if (!watched || !st.ground.building || !useAd(app.save, 'build', localDay())) {
            scr.toast('THE AD DID NOT FINISH, SO NOTHING CHANGED', 'info');
            return;
          }
          skipBuildMatchday(st);
          app.persist();
          sfx.coin();
          buzz('success');
          if (scr.root.isConnected) draw();
          const left = st.ground.building?.left ?? 0;
          scr.toast(left > 0 ? `ONE MATCHDAY OFF: ${left} TO GO` : 'IT IS OPEN', 'good');
        },
      },
      {
        cname: (el) => {
          const v = el.value.replace(NAME_DISALLOWED, '');
          if (v !== el.value) el.value = v;
          const problem = nameProblem(v);
          markName(scr.panel, el, v, suggestSeed);
          if (problem) return;
          // (A word split across the name and the code is turned down too: the old name stays.)
          if (!isPairAllowed(v, club.short)) {
            markField(el, 'blocked', nameWhy('rude'));
            return;
          }
          club.name = sanitizeName(v);
          setMyCrest(club);
          app.persist();
          const kp = scr.panel.querySelector('.mc-preview');
          if (kp) kp.innerHTML = previewHtml(club.kit, club.name, club.short, ced.crest, kitMode);
          const nm = scr.panel.querySelector('.mc-clubname');
          if (nm) nm.textContent = club.name.toUpperCase();
        },
        cshort: (el) => {
          const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
          if (v !== el.value) el.value = v;
          const problem = shortProblem(v) || (isPairAllowed(club.name, v) ? '' : 'blocked');
          markField(el, problem, nameWhy('rude', 'code'));
          if (problem) return;
          club.short = v;
          setMyCrest(club);
          app.persist();
          const kp = scr.panel.querySelector('.mc-preview');
          if (kp) kp.innerHTML = previewHtml(club.kit, club.name, club.short, ced.crest, kitMode);
        },
      },
    );
    bindPreview();
    hydrateFaces(scr.panel);
    // A scout's report on screen is a report read (the REPORT tag shows this once).
    if (tab === 'staff' && seeReport(st, staffUi)) app.persist();
  };
  draw();
  if (tab === 'train') revealInPane(scr.panel.querySelector('.tr-row.sel'), 'center');
}
