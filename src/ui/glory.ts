/**
 * The long game of ROAD TO GLORY on screen, kept light (docs/UX.md: one screen, master and detail, one-tap helpers):
 * - the EVENT CARD: one short card at a time over the hub, two or three answers, each saying what it does; then one
 *   line of what happened. (meta/events.ts makes them.)
 * - THE STORY and COMING UP: two short sections on the hub's CLUB tab (the timeline, and what is on its way).
 * - the STAFF tab of MY CLUB: six jobs on the left, the picked one on the right with HIRE as the one button; a scout's
 *   report is a list with SIGN on each row.
 * - the GROW card on a player (MY CLUB > TRAIN): his chart and potential, XP, the three focuses, his mentor, his
 *   traits, his morale.
 * - the small badges on squad chips: a face when a player's morale is high or low, a cross when he is injured.
 * Rules live in meta/ (events, staff, growth, morale, week, premium); this file only draws them and wires the taps.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { KEY_STATS, STAT_SHORT, type CareerState, type ClubState } from '../meta/career';
import { choiceOpen, pendingEvent, resolveEvent, type EventCard, type EventChoice, type EventKind, type TimelineEntry } from '../meta/events';
import { GEM_PRICES, SCOUT_NETWORKS, gems, spendGems } from '../meta/gems';
import { has, partDef } from '../meta/ground';
import {
  FOCUSES, FOCUS_INFO, MENTOR_TRAIT_AFTER, PUPIL_MAX_AGE, TRAIT_INFO, XP_LEVEL, ageRate, ceilOf, focusOf, growthChart, mentorOf, mentorsFor,
  pupilOf, setFocus, setGroupFocus, setMentor, traitsOf, type FocusId, type GrowPlayer,
} from '../meta/growth';
import { contractOf, playerAge } from '../meta/market';
import { MORALE_HIGH, MORALE_LOW, expectsToPlay, isInjured, moraleOf } from '../meta/morale';
import { buyNetwork, healNow } from '../meta/premium';
import {
  REGIONS, REGION_IDS, STAFF, STAFF_MAX_LEVEL, canHire, canSignFind, hireStaff, hiredLevel, isScout, releaseStaff, reportOf, scoutEvery, setScout,
  signFind, staffDef, staffNeeds, staffTitle, staffWages, unseenReports, type RegionId, type ScoutSlot, type StaffRole,
} from '../meta/staff';
import { comingUp, isOpen, nextUnlock, type Soon } from '../meta/week';
import { buzz } from '../platform/haptics';
import { overall, type Kit, type PlayerDef, type Role } from '../sim/types';
import { confirmGems, gemPrice } from './gemUi';
import { pixelIcon } from './pixelIcons';
import { faceHtml, hydrateFaces } from './preview';
import { sep } from './text';
import './glory.css';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lastName = (name: string) => name.split(' ').pop() ?? name;
const grow = (p: PlayerDef) => p as GrowPlayer;
const coinChip = (n: number) => `<span class="sd-cost"><i></i>${fmt(n)}</span>`;

// ------------------------------------------------------------------ badges on player chips

/**
 * The badge on a squad chip, only when there is something to do about him: a red cross with the matches out for an
 * injured player, a sad face when his morale is LOW. Nothing for everyone else (a happy squad is a clean screen:
 * the team's own mood is the "+1" on the match card).
 */
export function moodBadge(p: PlayerDef): string {
  const inj = grow(p).inj ?? 0;
  if (inj > 0) return `<i class="gl-badge inj" title="Injured: out for ${plural(inj, 'match', 'matches')}">${pixelIcon('medic', '#fff', 1)}<u>${inj}</u></i>`;
  if (moraleOf(p) <= MORALE_LOW) return `<i class="gl-badge lo" title="Morale low">${pixelIcon('sad', '#fff', 1)}</i>`;
  return '';
}

/** The same, said for a screen reader. */
export function moodWord(p: PlayerDef): string {
  const inj = grow(p).inj ?? 0;
  if (inj > 0) return `, injured for ${plural(inj, 'match', 'matches')}`;
  const m = moraleOf(p);
  return m >= MORALE_HIGH ? ', morale high' : m <= MORALE_LOW ? ', morale low' : '';
}

// ------------------------------------------------------------------ the event card

const EVENT_COLOR: Record<EventKind, string> = {
  press: '#2f7be8', injury: '#ec4a3e', bench: '#ff8a2a', clash: '#ec4a3e', contract: '#8a5cf6', bid: '#1fb3a6', youth: '#ffd23a', ultimatum: '#26262e',
  protest: '#26262e', festival: '#3cc15a', sponsor: '#ffd23a', mentor: '#1fb3a6', training: '#2f7be8', community: '#3cc15a',
};
const LIGHT_KINDS: EventKind[] = ['youth', 'sponsor'];

function choiceHtml(c: EventChoice, i: number, coins: number, gemsHave: number): string {
  const open = choiceOpen(c, coins, c.gems ? Infinity : gemsHave);
  const cost = c.gems ? gemPrice(c.gems) : c.coins ? coinChip(c.coins) : '';
  return `<button class="btn gl-choice ${c.gems ? 'gem' : c.tone} ${open ? '' : 'poor'}" data-c="${i}" ${open ? '' : 'disabled'} aria-label="${esc(c.label)}. ${esc(c.hint)}${c.coins ? `. Costs ${fmt(c.coins)} coins` : ''}${c.gems ? `. Costs ${c.gems} gems` : ''}">
      <b>${esc(c.label)}</b><small>${esc(c.hint)}</small>${cost ? `<em class="gl-cost">${cost}</em>` : ''}
    </button>`;
}

/**
 * Show the event cards waiting in the career over `root`, one at a time (the oldest first): the card with its two
 * or three answers; a tap on one does it (an answer that costs gems asks first: ui/gemUi.ts confirmGems) and the card
 * turns to one line of what happened and OK. Saved after every answer. `onDone` runs when the last card goes.
 * Returns false (and shows nothing) when no card is waiting.
 */
export function playEvents(app: AppContext, root: HTMLElement, st: CareerState, onDone?: () => void): boolean {
  let card = pendingEvent(st);
  if (!card) return false;
  const wrap = document.createElement('div');
  wrap.className = 'fv-moment-wrap gl-wrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  root.appendChild(wrap);
  /** The answer just given (the card shows what happened until OK). */
  let done: EventChoice | null = null;
  const kit: Kit | undefined = st.club?.kit;
  const head = (c: EventCard) => {
    const who = c.who[0] ? st.club?.squad.find((p) => p.id === c.who[0]) : undefined;
    const face = who && kit ? `<span class="gl-face">${faceHtml(who, kit, 'md')}</span>` : '';
    const light = LIGHT_KINDS.includes(c.kind);
    return `<header class="gl-top"><span class="gl-ic">${pixelIcon(c.icon, light ? '#26262e' : '#fff', 3)}</span><b class="gl-title">${esc(c.title)}</b>${face}</header>`;
  };
  const show = (c: EventCard) => {
    done = null;
    const coins = app.save.coins;
    const have = gems(app.save);
    wrap.setAttribute('aria-label', c.title);
    wrap.innerHTML = `<div class="gl-card k-${c.kind}" style="--mc:${EVENT_COLOR[c.kind]}">
        ${head(c)}
        <p class="gl-text">${esc(c.text)}</p>
        <div class="gl-choices n${c.choices.length}">${c.choices.map((ch, i) => choiceHtml(ch, i, coins, have)).join('')}</div>
      </div>`;
    hydrateFaces(wrap);
    sfx.click();
    buzz('tap');
    wrap.querySelector<HTMLButtonElement>('.gl-choice:not(:disabled)')?.focus({ preventScroll: true });
  };
  const outcome = (c: EventCard, ch: EventChoice) => {
    done = ch;
    const more = st.events.queue.length;
    wrap.innerHTML = `<div class="gl-card gl-done k-${c.kind} t-${ch.tone}" style="--mc:${EVENT_COLOR[c.kind]}">
        ${head(c)}
        <p class="gl-text gl-say">${esc(ch.say)}</p>
        <p class="gl-hint">${esc(ch.hint)}</p>
        <button class="btn btn-go gl-ok" data-ok="1">${more ? 'NEXT' : 'OK'}</button>
      </div>`;
    hydrateFaces(wrap);
    wrap.querySelector<HTMLButtonElement>('.gl-ok')?.focus({ preventScroll: true });
  };
  const close = () => {
    wrap.remove();
    window.removeEventListener('keydown', key, true);
    onDone?.();
  };
  const next = () => {
    card = pendingEvent(st);
    if (card) show(card);
    else close();
  };
  const choose = (i: number) => {
    const c = card;
    const ch = c?.choices[i];
    if (!c || !ch || done) return;
    const go = (spend?: (n: number, why: string) => boolean) => {
      const r = resolveEvent(st, app.save, c.id, i, spend);
      if (!r.ok) {
        show(c);
        return;
      }
      app.persist();
      if (ch.tone === 'bad') sfx.click();
      else sfx.coin();
      buzz(ch.tone === 'good' ? 'success' : 'tap');
      outcome(c, ch);
    };
    if (ch.gems) {
      confirmGems(root, {
        title: `${ch.label}?`, text: ch.hint, price: ch.gems, have: gems(app.save), yes: 'YES',
        onYes: () => go((n, why) => spendGems(app.save, n, why)),
        free: 'OR REST HIM: HE IS BACK BY HIMSELF',
      });
      return;
    }
    go();
  };
  const key = (e: KeyboardEvent) => {
    if (!wrap.isConnected) {
      window.removeEventListener('keydown', key, true);
      return;
    }
    // (A gem confirm sheet on top takes its own keys.)
    if (root.querySelector('.gem-sheet')) return;
    if (e.key === 'Escape') {
      // A card has to be answered: Esc must not take the screen under it BACK.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (done) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        next();
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 3) {
      e.preventDefault();
      e.stopPropagation();
      const btn = wrap.querySelector<HTMLButtonElement>(`[data-c="${n - 1}"]`);
      if (btn && !btn.disabled) choose(n - 1);
    }
  };
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = (e.target as Element).closest<HTMLButtonElement>('[data-c], [data-ok]');
    if (!el || el.disabled) return;
    if (el.dataset.ok) next();
    else choose(Number(el.dataset.c));
  });
  window.addEventListener('keydown', key, true);
  show(card);
  return true;
}

// ------------------------------------------------------------------ THE STORY and COMING UP (the hub's CLUB tab)

const TONE_COLOR = { good: '#238a3b', bad: '#a62b22', info: '#1c4fa3' } as const;

function timelineRow(e: TimelineEntry): string {
  return `<div class="fv-row gl-tl t-${e.tone}">${pixelIcon(e.icon, TONE_COLOR[e.tone], 1.6)}<span class="gl-tltext">${esc(e.text)}</span><small>S${e.s}${sep()}MD${e.md}</small></div>`;
}

/** THE STORY SO FAR: the club's timeline, the latest few lines (`all`: every line kept). */
export function storyHtml(st: CareerState, all = false): string {
  const tl = st.events.timeline;
  const rows = (all ? tl : tl.slice(0, 3)).map(timelineRow).join('');
  const more = tl.length > 3 ? `<button class="btn btn-white fv-mini" data-a="story">${all ? 'LESS' : `ALL ${tl.length}`}</button>` : '';
  return `<section class="fv-sec gl-story"><h3 class="fv-h"><span>THE STORY SO FAR</span>${more}</h3>${rows || '<p class="fv-empty">YOUR CLUB WRITES ITS STORY MATCH BY MATCH</p>'}</section>`;
}

/** This season's headlines for the recap (the big lines of the timeline). */
export function headlinesHtml(lines: readonly TimelineEntry[]): string {
  if (!lines.length) return '';
  return `<section class="fv-sec gl-story"><h3 class="fv-h"><span>HEADLINES</span></h3>${lines.map(timelineRow).join('')}</section>`;
}

function soonRow(x: Soon): string {
  const when = x.in === 0 ? '<b class="gl-now">NOW</b>' : `<small>${x.in} MD</small>`;
  return `<button class="fv-row gl-soon ${x.in === 0 ? 'now' : ''}" data-a="soon" data-v="${x.go}">${pixelIcon(x.icon, '#26262e', 1.6)}<span class="gl-tltext">${esc(x.text)}</span>${when}</button>`;
}

/** COMING UP: what is in progress at the club, the nearest first (a tap goes there). */
export function soonHtml(st: CareerState, max = 4): string {
  const list = comingUp(st).filter((x) => x.kind !== 'intake' && x.kind !== 'chart').slice(0, max);
  if (!list.length) return '';
  return `<section class="fv-sec gl-soons"><h3 class="fv-h"><span>COMING UP</span></h3>${list.map(soonRow).join('')}</section>`;
}

// ------------------------------------------------------------------ the GROW card (MY CLUB > TRAIN)

/** The growth chart: his overall at each half season as a stepped line, his potential as a dashed line above it. */
export function chartSvg(points: readonly number[], ceil: number): string {
  const w = 200;
  const h = 64;
  const pad = 6;
  const pts = points.length ? points : [ceil];
  const lo = Math.min(...pts) - 2;
  const hi = Math.max(ceil, ...pts) + 2;
  const y = (v: number) => pad + (h - pad * 2) * (1 - (v - lo) / Math.max(1, hi - lo));
  const x = (i: number) => (pts.length === 1 ? w - pad : pad + ((w - pad * 2) * i) / (pts.length - 1));
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${h - pad} L${x(0).toFixed(1)} ${h - pad} Z`;
  const dots = pts.map((v, i) => `<rect x="${(x(i) - 2.5).toFixed(1)}" y="${(y(v) - 2.5).toFixed(1)}" width="5" height="5" fill="#26262e"/>`).join('');
  const cy = y(ceil).toFixed(1);
  return `<svg class="gl-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Overall ${pts[pts.length - 1]}, potential ${ceil}">
      <line x1="${pad}" y1="${cy}" x2="${w - pad}" y2="${cy}" stroke="#8a5cf6" stroke-width="2" stroke-dasharray="5 4"/>
      ${pts.length > 1 ? `<path d="${area}" fill="rgba(60,193,90,0.22)"/><path d="${line}" fill="none" stroke="#3cc15a" stroke-width="3" stroke-linejoin="round"/>` : ''}
      ${dots}
    </svg>`;
}

function learnsWord(age: number): string {
  const r = ageRate(age);
  return r >= 1 ? 'LEARNS FAST' : r >= 0.6 ? 'LEARNS WELL' : r >= 0.3 ? 'LEARNS SLOWLY' : r > 0 ? 'NEARLY DONE LEARNING' : 'A FINISHED PLAYER';
}

/**
 * The GROW card of a player: the chart with his potential, his XP bar, the three focuses of his position (and one
 * tap for the whole position), his mentor or pupil, his traits, his morale and contract. One short screen.
 */
export function growHtml(st: CareerState, club: ClubState, p: PlayerDef): string {
  const g = grow(p);
  const ovr = overall(p);
  const { points, ceil } = growthChart(p);
  const age = playerAge(p);
  const xp = Math.max(0, Math.min(XP_LEVEL, g.xp ?? 0));
  const focus = focusOf(p);
  const focusOpen = isOpen(st, 'focus');
  const info = FOCUS_INFO[p.role];
  const chips = FOCUSES.map((f) => {
    const stats = [...new Set(info[f].stats)].map((k) => STAT_SHORT[k]).join(' ');
    return `<button class="gl-focus ${f === focus ? 'on' : ''}" data-a="focus" data-v="${f}" aria-pressed="${f === focus}" ${focusOpen ? '' : 'disabled'}><b>${info[f].name}</b><small>${stats}</small></button>`;
  }).join('');
  const groupWord: Record<Role, string> = { GK: 'KEEPERS', DF: 'DEFENDERS', MF: 'MIDFIELDERS', FW: 'FORWARDS' };
  // The mentor line: a youngster's teacher (or a way to find one), a veteran's pupil.
  const mentorsOpen = isOpen(st, 'mentors');
  let mentor = '';
  if (mentorsOpen) {
    const m = mentorOf(club, p);
    const pupil = pupilOf(club, p);
    if (m) {
      const left = Math.max(0, MENTOR_TRAIT_AFTER - (g.mentored ?? 0));
      mentor = `<div class="gl-line">${pixelIcon('duo', '#1fb3a6', 1.6)}<span>MENTOR: ${esc(lastName(m.name).toUpperCase())}<small>${left ? `LEARNS A TRAIT AFTER ${plural(left, 'MATCH', 'MATCHES')}` : 'XP +25%'}</small></span><button class="btn btn-white fv-mini" data-a="mentoroff">END</button></div>`;
    } else if (pupil) {
      mentor = `<div class="gl-line">${pixelIcon('duo', '#1fb3a6', 1.6)}<span>TEACHING ${esc(lastName(pupil.name).toUpperCase())}<small>HIS PUPIL LEARNS 25% FASTER</small></span></div>`;
    } else if (age <= PUPIL_MAX_AGE) {
      const vet = mentorsFor(club, p)[0];
      mentor = vet
        ? `<div class="gl-line">${pixelIcon('duo', '#1fb3a6', 1.6)}<span>NO MENTOR YET<small>${esc(lastName(vet.name).toUpperCase())} (${playerAge(vet)}) CAN TEACH HIM</small></span><button class="btn btn-yellow fv-mini" data-a="mentoron">MENTOR</button></div>`
        : `<div class="gl-line dim">${pixelIcon('duo', '#9a968c', 1.6)}<span>NO VETERAN ${p.role} TO TEACH HIM<small>A MENTOR IS 28 OR OLDER, IN HIS POSITION</small></span></div>`;
    }
  }
  const traits = traitsOf(p)
    .map((t) => `<span class="gl-trait" title="${TRAIT_INFO[t].does}">${pixelIcon(TRAIT_INFO[t].icon, '#fff', 1.2)}${TRAIT_INFO[t].name}</span>`)
    .join('');
  const m = moraleOf(p);
  const face = m >= MORALE_HIGH ? 'happy' : m <= MORALE_LOW ? 'sad' : 'okay';
  const sat = g.sat ?? 0;
  const why = isInjured(p)
    ? `OUT FOR ${plural(g.inj ?? 0, 'MATCH', 'MATCHES')}`
    : club.squad.indexOf(p) < 11
      ? `${plural(g.run ?? 0, 'START', 'STARTS')} IN A ROW`
      : sat >= 3 && expectsToPlay(club, p) ? `WANTS A GAME: ${sat} MATCHES OUT` : 'HAPPY TO WAIT';
  const heal = isInjured(p) ? `<button class="btn btn-blue fv-mini gl-heal" data-a="heal">HEAL NOW ${gemPrice(GEM_PRICES.healPlayer)}</button>` : '';
  const leaving = g.leaving ? `${sep()}LEAVING` : '';
  return `<div class="gl-grow">
      <div class="gl-chartrow">
        ${chartSvg(points, ceil)}
        <div class="gl-nums"><span><small>OVR</small><b>${ovr}</b></span><span class="pot"><small>POTENTIAL</small><b>${ceil}</b></span></div>
      </div>
      <div class="gl-xp" title="${xp} of ${XP_LEVEL} XP"><span>XP</span><i class="fv-bar"><u style="width:${Math.round((xp / XP_LEVEL) * 100)}%"></u></i><em>${ovr >= ceil ? 'AT HIS POTENTIAL' : learnsWord(age)}</em></div>
      <div class="gl-focusrow" role="group" aria-label="Training focus">${chips}<button class="btn btn-white fv-mini gl-all" data-a="focusall" ${focusOpen ? '' : 'disabled'} aria-label="This focus for all ${groupWord[p.role].toLowerCase()}">ALL ${groupWord[p.role]}</button></div>
      ${focusOpen ? '' : `<p class="gl-lock">${pixelIcon('lock', '#8f8c85', 1.4)}TRAINING FOCUS OPENS AFTER ${plural(nextUnlock(st)?.left ?? 1, 'MORE MATCH', 'MORE MATCHES')}</p>`}
      <div class="gl-lines ${mentor ? '' : 'one'}">
        ${mentor}
        <div class="gl-line">${pixelIcon(face, m >= MORALE_HIGH ? '#238a3b' : m <= MORALE_LOW ? '#a62b22' : '#3a3a46', 1.6)}<span>MORALE ${m}<small>${why}</small></span>${heal}</div>
      </div>
      <div class="gl-meta"><span>AGE ${age}${sep()}CONTRACT ${plural(contractOf(p), 'YEAR', 'YEARS')}${leaving}</span>${traits}</div>
    </div>`;
}

/** The GROW card's taps (ui/club.ts adds these to the TRAIN tab's handlers). `redraw` after anything changes. */
export function growHandlers(
  app: AppContext, st: CareerState, club: ClubState, current: () => PlayerDef | undefined, redraw: () => void,
  toast: (msg: string, kind?: 'good' | 'bad' | 'info') => void, host: () => HTMLElement,
): Record<string, (el: HTMLElement) => void> {
  const saved = () => {
    app.persist();
    buzz('tap');
    redraw();
  };
  return {
    focus: (el) => {
      const p = current();
      if (p && setFocus(club, p.id, el.dataset.v as FocusId)) saved();
    },
    focusall: () => {
      const p = current();
      if (!p) return;
      const n = setGroupFocus(club, p.role, focusOf(p));
      saved();
      toast(n ? `${FOCUS_INFO[p.role][focusOf(p)].name} FOR ${plural(n, 'MORE PLAYER', 'MORE PLAYERS')}` : 'ALREADY SET', 'good');
    },
    mentoron: () => {
      const p = current();
      const vet = p ? mentorsFor(club, p)[0] : undefined;
      if (!p || !vet || !setMentor(club, p.id, vet.id)) return;
      saved();
      toast(`${lastName(vet.name).toUpperCase()} NOW MENTORS ${lastName(p.name).toUpperCase()}`, 'good');
    },
    mentoroff: () => {
      const p = current();
      if (p && setMentor(club, p.id, null)) saved();
    },
    heal: () => {
      const p = current();
      if (!p) return;
      confirmGems(host(), {
        title: `HEAL ${lastName(p.name).toUpperCase()} NOW?`, text: 'FIT FOR YOUR NEXT MATCH', price: GEM_PRICES.healPlayer, have: gems(app.save),
        free: `OR WAIT: HE IS BACK AFTER ${plural(grow(p).inj ?? 0, 'MATCH', 'MATCHES')}`,
        onYes: () => {
          if (!healNow(st, app.save, p.id)) return;
          sfx.coin();
          saved();
          toast(`${lastName(p.name).toUpperCase()} IS FIT AGAIN`, 'good');
        },
      });
    },
  };
}

/** The line under a player's name in lists: what he could become ("POT 71") when he still has growing to do. */
export function potText(p: PlayerDef): string {
  const c = ceilOf(p);
  return c > overall(p) ? `POT ${c}` : '';
}

// ------------------------------------------------------------------ the STAFF tab (MY CLUB)

export interface StaffUi {
  sel: StaffRole;
  /** The region picked for a scout not hired yet. */
  region: RegionId;
  /** RELEASE asks twice. */
  confirm: boolean;
}

export function defaultStaffUi(st: CareerState): StaffUi {
  // The scout with a report nobody has read starts picked; else the first job with nobody in it.
  const unseen = unseenReports(st)[0]?.slot;
  const empty = STAFF.find((d) => !st.staff.hired[d.role] && !staffNeeds(st, d.role))?.role;
  return { sel: unseen ?? empty ?? 'assistant', region: 'south', confirm: false };
}

/** The report of the scout picked is on screen: mark it read. True when that changed anything (save it). */
export function seeReport(st: CareerState, ui: StaffUi): boolean {
  if (!isScout(ui.sel)) return false;
  const r = reportOf(st, ui.sel);
  if (!r || r.seen) return false;
  r.seen = true;
  return true;
}

const pips = (level: number) => `<span class="gl-pips" aria-label="Level ${level} of ${STAFF_MAX_LEVEL}">${[1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;

function scoutsLocked(st: CareerState, role: StaffRole): boolean {
  return isScout(role) && !isOpen(st, 'scouts');
}

function staffRow(st: CareerState, role: StaffRole, ui: StaffUi): string {
  const def = staffDef(role);
  const lv = hiredLevel(st, role);
  const next = def.levels[lv];
  const locked = scoutsLocked(st, role) || (!!next && !lv && !!staffNeeds(st, role));
  const report = isScout(role) ? reportOf(st, role) : undefined;
  const fresh = report && !report.seen && report.finds.length ? '<b class="sd-new">REPORT</b>' : '';
  const status = lv
    ? `<em class="sd-ps ok">${fmt(def.levels[lv - 1].wage)} A MATCH</em>`
    : locked
      ? `<em class="sd-ps no">${pixelIcon('lock', 'currentColor', 1.3, 'inl')}</em>`
      : `<em class="sd-ps">${coinChip(next.fee)}</em>`;
  return `<button class="sd-part ${lv ? 'built' : locked ? 'locked' : 'ready'} ${role === ui.sel ? 'sel' : ''}" data-a="staffpick" data-v="${role}" aria-pressed="${role === ui.sel}">
      ${pixelIcon(def.icon, 'currentColor', 1.6)}<span class="sd-pn">${lv ? staffTitle(role, lv) : def.name}${fresh}</span>${lv ? pips(lv) : ''}${status}
    </button>`;
}

function regionChips(action: string, cur: RegionId, home?: RegionId): string {
  return `<div class="gl-regions" role="group" aria-label="Region">${REGION_IDS.map((r) => `<button class="gl-region ${r === cur ? 'on' : ''}" data-a="${action}" data-v="${r}" aria-pressed="${r === cur}">${REGIONS[r].name}${home === r ? '<i title="He knows this region"></i>' : ''}</button>`).join('')}</div>
    <p class="gl-regdoes">${REGIONS[cur].does}</p>`;
}

function reportHtml(st: CareerState, coins: number, slot: ScoutSlot): string {
  const report = reportOf(st, slot);
  const m = st.staff.hired[slot];
  const due = st.staff.due[slot] ?? (m ? scoutEvery(m) : 0);
  const wait = st.staff.unpaid ? 'WAITING TO BE PAID' : `NEXT REPORT AFTER ${plural(due, 'MATCH', 'MATCHES')}`;
  if (!report || !report.finds.length) return `<p class="fv-empty gl-wait">${pixelIcon('scout', '#3a3a46', 1.6)}${report ? 'EVERYONE ON THIS REPORT IS SIGNED OR GONE' : 'HE IS OUT LOOKING'}${sep()}${wait}</p>`;
  const rows = report.finds
    .map((f, i) => {
      const can = canSignFind(st, coins, slot, i);
      const why = can.ok ? '' : can.reason === 'no-coins' ? 'poor' : 'blocked';
      const tag = f.kind === 'youth' ? `AGE ${playerAge(f.player)}${sep()}POT ${ceilOf(f.player)}` : `AGE ${playerAge(f.player)}${sep()}READY NOW`;
      const trait = traitsOf(f.player)[0];
      return `<div class="fv-row gl-find">
          <span class="mc-role r-${f.player.role}">${f.player.role}</span>
          <span class="fv-t">${esc(f.player.name)}<small>${tag}${trait ? `${sep()}${TRAIT_INFO[trait].name}` : ''}</small></span>
          <b class="mc-ovr">${overall(f.player)}</b>
          <button class="btn btn-go fv-mini gl-sign ${why}" data-a="sign" data-i="${i}" aria-label="Sign ${esc(f.player.name)} for ${fmt(f.fee)} coins">SIGN ${coinChip(f.fee)}</button>
        </div>`;
    })
    .join('');
  return `<div class="gl-finds"><p class="gl-from">FROM ${REGIONS[report.region].name}${sep()}${wait}</p>${rows}</div>`;
}

function staffDetail(app: AppContext, st: CareerState, ui: StaffUi): string {
  const role = ui.sel;
  const def = staffDef(role);
  const lv = hiredLevel(st, role);
  const m = st.staff.hired[role];
  const cur = lv ? def.levels[lv - 1] : undefined;
  const next = def.levels[lv];
  const needs = staffNeeds(st, role);
  const coins = app.save.coins;
  if (scoutsLocked(st, role)) {
    const u = nextUnlock(st);
    return `<div class="gl-locked">${pixelIcon('lock', '#8f8c85', 4)}<b>SCOUTS</b><p>THEY OPEN AFTER ${plural(u?.unlock.id === 'scouts' ? u.left : Math.max(1, 5 - st.events.played), 'MORE MATCH', 'MORE MATCHES')}</p></div>`;
  }
  const headName = m ? esc(m.name.toUpperCase()) : 'NOBODY YET';
  const knows = m && isScout(role) && m.region ? `${sep()}KNOWS ${REGIONS[m.region].name}` : '';
  const head = `<div class="gl-head">${pixelIcon(def.icon, '#26262e', 3)}<div class="gl-who"><b>${lv ? staffTitle(role, lv) : def.name}</b><small>${headName}${knows}</small></div>${pips(lv)}</div>`;
  const check = canHire(st, coins, role);
  const poor = !check.ok && check.reason === 'no-coins';
  const button = !next
    ? '<button class="btn btn-go sd-up" disabled>TOP LEVEL</button>'
    : needs
      ? `<button class="btn btn-go sd-up" disabled>${esc(needs)}</button>`
      : `<button class="btn btn-go sd-up ${poor ? 'poor' : ''}" data-a="hire">${lv ? 'PROMOTE' : 'HIRE'} ${coinChip(next.fee)}</button>`;
  const release = lv ? `<button class="btn ${ui.confirm ? 'btn-red' : 'btn-white'} gl-release" data-a="release">${ui.confirm ? 'SURE?' : 'RELEASE'}</button>` : '';
  const fact = (label: string, value: string, cls = '') => `<span class="sd-fact ${cls}"><small>${label}</small><b>${value}</b></span>`;
  const facts = `<div class="sd-facts gl-facts">
      ${cur ? fact('NOW', cur.does) : ''}
      ${next ? fact(lv ? `LEVEL ${lv + 1}` : 'HIRE HIM', next.does, 'next') : ''}
      ${fact('WAGE', `${cur ? `${fmt(cur.wage)}` : '0'}${next ? ` <em>→ ${fmt(next.wage)}</em>` : ''} A MATCH`)}
    </div>`;
  let body = facts;
  if (isScout(role)) {
    if (!m) body = `${regionChips('region', ui.region)}${facts}`;
    else {
      const task = m.task ?? m.region ?? 'home';
      const brief = m.brief ?? 'youth';
      body = `${regionChips('task', task, m.region)}
        <div class="gl-brief"><div class="seg"><button class="${brief === 'youth' ? 'on' : ''}" data-a="brief" data-v="youth" aria-pressed="${brief === 'youth'}">YOUNGSTERS</button><button class="${brief === 'ready' ? 'on' : ''}" data-a="brief" data-v="ready" aria-pressed="${brief === 'ready'}">READY NOW</button></div></div>
        <div class="pane-scroll gl-report" data-scroll-key="gl-report">${reportHtml(st, coins, role)}</div>`;
    }
  } else if (role === 'academy') {
    // The SCOUTING NETWORK (meta/gems.ts): a stated guarantee on every intake, bought once with gems.
    const tier = st.staff.network;
    const own = SCOUT_NETWORKS[tier - 1];
    const up = SCOUT_NETWORKS[tier];
    body = `${facts}<div class="gl-net">${pixelIcon('scout', '#1c4fa3', 1.6)}<span>SCOUTING NETWORK<small>${own ? own.text : 'A GUARANTEED TOP PROSPECT EVERY INTAKE'}</small></span>${
      up ? `<button class="btn btn-blue fv-mini" data-a="network" aria-label="${up.name}: ${up.text}. ${up.price} gems">${own ? 'UPGRADE' : 'GET'} ${gemPrice(up.price)}</button>` : '<b class="fv-ok">TOP TIER</b>'
    }</div>`;
  } else if (next?.needs && !has(st.ground, next.needs)) {
    body = `${facts}<p class="gl-need">${pixelIcon('flag', '#a46b00', 1.4)}LEVEL ${lv + 1} NEEDS THE ${partDef(next.needs).name}</p>`;
  }
  return `${head}${body}<div class="gl-actions">${release}${button}</div>`;
}

/**
 * The STAFF tab's body: the six jobs on the left (who has them, what they cost a match), the picked one on the right
 * (what it does now and at the next level, and HIRE or PROMOTE as the one button). A scout shows his region, what he
 * looks for and his latest report, each find with SIGN.
 */
export function staffTab(app: AppContext, st: CareerState, ui: StaffUi): string {
  const wages = staffWages(st);
  const rows = STAFF.map((d) => staffRow(st, d.role, ui)).join('');
  const bill = st.staff.unpaid ? '<span class="gl-wages warn">UNPAID: THEY WAIT FOR THEIR WAGES</span>' : `<span class="gl-wages">WAGES ${fmt(wages)} A MATCH</span>`;
  return `<div class="mc-body split-l sd-body sd-parts gl-staff">
      <div class="pane">
        <div class="pane-h"><span class="sq-ph">STAFF</span><span class="grow"></span>${bill}</div>
        <div class="pane-scroll sd-list" data-scroll-key="gl-staff">${rows}</div>
      </div>
      <div class="pane gl-info">${staffDetail(app, st, ui)}</div>
    </div>`;
}

/** The STAFF tab's taps (ui/club.ts adds these to its handlers). */
export function staffHandlers(
  app: AppContext, st: CareerState, ui: StaffUi, redraw: () => void, toast: (msg: string, kind?: 'good' | 'bad' | 'info') => void, host: () => HTMLElement,
): Record<string, (el: HTMLElement) => void> {
  const saved = () => {
    app.persist();
    redraw();
  };
  return {
    staffpick: (el) => {
      ui.sel = el.dataset.v as StaffRole;
      ui.confirm = false;
      redraw();
    },
    region: (el) => {
      ui.region = el.dataset.v as RegionId;
      redraw();
    },
    task: (el) => {
      if (isScout(ui.sel) && setScout(st, ui.sel, { task: el.dataset.v as RegionId })) saved();
    },
    brief: (el) => {
      if (isScout(ui.sel) && setScout(st, ui.sel, { brief: el.dataset.v === 'ready' ? 'ready' : 'youth' })) saved();
    },
    hire: () => {
      const was = hiredLevel(st, ui.sel);
      const r = hireStaff(st, app.save, ui.sel, ui.region);
      if (!r.ok) {
        toast(r.reason === 'no-coins' ? 'NOT ENOUGH COINS' : r.reason === 'locked' ? staffNeeds(st, ui.sel) ?? 'NOT YET' : 'TOP LEVEL', 'bad');
        return;
      }
      ui.confirm = false;
      sfx.coin();
      buzz('success');
      saved();
      const m = st.staff.hired[ui.sel];
      toast(was ? `${staffTitle(ui.sel, r.level)}: LEVEL ${r.level}` : `${(m?.name ?? 'HE').toUpperCase()} JOINS THE STAFF`, 'good');
    },
    release: () => {
      if (!ui.confirm) {
        ui.confirm = true;
        redraw();
        return;
      }
      ui.confirm = false;
      if (releaseStaff(st, ui.sel)) saved();
    },
    sign: (el) => {
      if (!isScout(ui.sel)) return;
      const r = signFind(st, app.save, ui.sel, Number(el.dataset.i));
      if (!r.ok) {
        toast(r.reason === 'no-coins' ? 'NOT ENOUGH COINS' : r.reason === 'squad-full' ? 'SQUAD FULL: SELL OR RELEASE FIRST' : r.reason === 'wages' ? 'OVER THE WAGE BUDGET' : 'HE HAS GONE', 'bad');
        return;
      }
      sfx.coin();
      buzz('success');
      saved();
      toast(`${r.player.name.toUpperCase()} JOINS THE SQUAD`, 'good');
    },
    network: () => {
      const up = SCOUT_NETWORKS[st.staff.network];
      if (!up) return;
      confirmGems(host(), {
        title: `${up.name}?`, text: up.text, price: up.price, have: gems(app.save), free: 'THE ACADEMY BRINGS PROSPECTS EVERY SEASON WITHOUT IT',
        onYes: () => {
          if (!buyNetwork(st, app.save).ok) return;
          sfx.coin();
          saved();
          toast(`${up.name}: ${up.text}`, 'good');
        },
      });
    },
  };
}

/** What KEY_STATS says of a position, for a label ("PAS DRI STA"). */
export function keyStatsOf(role: Role): string {
  return KEY_STATS[role].map((k) => STAT_SHORT[k]).join(' ');
}
