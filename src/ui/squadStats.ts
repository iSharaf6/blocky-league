/**
 * The STATS tab of MY CLUB (the owner: "should also show stats of players in my team, like appearances goals assists
 * and etc for gk all that yk when im looking at my team"). Master and detail on the app shell (docs/UX.md):
 * - on the left the squad's LEADERS at a glance (top scorer, most assists, most appearances, best average), a
 *   SEASON / CAREER switch, and the squad as a list with appearances, goals, assists and average rating;
 * - on the right the picked player: his key stats, then every number this season and in his career (appearances,
 *   starts, minutes, goals, assists, rating, cards, man of the match; a keeper's clean sheets, saves, goals against and
 *   penalties saved).
 * The numbers live on the players (meta/stats.ts); a save from before them reads as zeros.
 */
import type { CareerState, ClubState } from '../meta/career';
import { LINE_KEYS, careerLine, ratingText, seasonLine, squadLeaders, type Leader, type LeaderKind, type StatLine } from '../meta/stats';
import { isInjured } from '../meta/morale';
import { overall, type PlayerDef } from '../sim/types';
import { buzz } from '../platform/haptics';
import { playerAge } from '../meta/market';
import { ceilOf } from '../meta/growth';
import { escHtml, keyBarsHtml, numText, seasonOf } from './playerCard';
import { faceHtml } from './preview';
import { pixelIcon } from './pixelIcons';
import { revealInPane } from './panes';
import './squadStats.css';

export type StatsScope = 'season' | 'career';
export interface StatsUi {
  /** The picked player's id. */
  id: string;
  scope: StatsScope;
}

/** What the screen remembers while the app is open: the player and the scope last looked at. */
let last: StatsUi = { id: '', scope: 'season' };

export function defaultStatsUi(club: ClubState, id?: string): StatsUi {
  const pick = id && club.squad.some((p) => p.id === id) ? id : club.squad.some((p) => p.id === last.id) ? last.id : club.squad[0]?.id ?? '';
  return { id: pick, scope: last.scope };
}

const LEADER_INFO: Record<LeaderKind, { icon: string; caption: string; aria: string; text: (n: number) => string }> = {
  goals: { icon: 'ball', aria: 'Top scorer', caption: 'SCORER', text: (n) => `${n} ${n === 1 ? 'GOAL' : 'GOALS'}` },
  assists: { icon: 'run', aria: 'Most assists', caption: 'ASSISTS', text: (n) => `${n} ${n === 1 ? 'ASSIST' : 'ASSISTS'}` },
  apps: { icon: 'shirt', aria: 'Most appearances', caption: 'APPS', text: (n) => `${n} ${n === 1 ? 'GAME' : 'GAMES'}` },
  rating: { icon: 'star', aria: 'Best average rating', caption: 'RATING', text: (n) => `AVG ${(n / 10).toFixed(1)}` },
};

const lastName = (name: string) => name.split(' ').pop() ?? name;

function leaderChip(l: Leader, sel: string): string {
  const info = LEADER_INFO[l.kind];
  return `<button class="ss-lead ${l.id === sel ? 'sel' : ''}" data-a="spick" data-id="${escHtml(l.id)}" aria-label="${info.aria}: ${escHtml(l.name)}, ${info.text(l.n)}">
      <small>${pixelIcon(info.icon, 'currentColor', 1)}${info.caption}</small><b>${escHtml(lastName(l.name))}</b><em>${info.text(l.n)}</em>
    </button>`;
}

const lineOf = (st: CareerState, p: PlayerDef, scope: StatsScope): StatLine => (scope === 'season' ? seasonLine(p, seasonOf(st)) : careerLine(p));

function rowHtml(st: CareerState, p: PlayerDef, ui: StatsUi): string {
  const l = lineOf(st, p, ui.scope);
  const keeper = p.role === 'GK';
  return `<button class="ss-row r-${p.role} ${p.id === ui.id ? 'sel' : ''}" data-a="spick" data-id="${escHtml(p.id)}" aria-pressed="${p.id === ui.id}"
      aria-label="${escHtml(p.name)}, ${p.role}, ${l.apps} appearances, ${l.goals} goals, ${l.assists} assists${l.rated ? `, average rating ${ratingText(l)}` : ''}">
      <em class="sq-role">${p.role}</em>
      <span class="ss-nm">${escHtml(p.name)}${isInjured(p) ? '<i class="ss-hurt">OUT</i>' : ''}</span>
      <b>${l.apps}</b><b>${keeper ? `${l.clean}<i>CS</i>` : l.goals}</b><b>${keeper ? `${l.saves}<i>SV</i>` : l.assists}</b><b class="avg">${ratingText(l)}</b>
    </button>`;
}

/** One block of the detail: a label column and the two numbers (this season, his career). */
function block(rows: [string, string, string][]): string {
  // (A label may have a short form: "CLEAN SHEETS|CLEAN" shows the short one on a narrow phone.)
  const label = (k: string) => {
    const [long, short] = k.split('|');
    return short ? `<i class="lg">${long}</i><i class="sh">${short}</i>` : long;
  };
  return `<div class="ss-tbl"><div class="ss-th"><span></span><span>SEASON</span><span>TOTAL</span></div>${rows
    .map(([k, a, b]) => `<div class="ss-tr"><span>${label(k)}</span><b>${a}</b><b>${b}</b></div>`)
    .join('')}</div>`;
}

function detailHtml(st: CareerState, club: ClubState, p: PlayerDef): string {
  const s = seasonLine(p, seasonOf(st));
  const c = careerLine(p);
  const both = (f: (l: StatLine) => string): [string, string] => [f(s), f(c)];
  const row = (label: string, f: (l: StatLine) => string): [string, string, string] => [label, ...both(f)];
  const n = (key: (typeof LINE_KEYS)[number]) => (l: StatLine) => numText(l[key]);
  const left = [
    row('APPS', n('apps')),
    row('STARTS', n('starts')),
    row('MINUTES', n('mins')),
    row('GOALS', n('goals')),
    row('ASSISTS', n('assists')),
    row('RATING', (l) => ratingText(l)),
  ];
  const right = [row('YELLOW', n('yellow')), row('RED', n('red')), row('MAN OF MATCH|MOTM', n('motm'))];
  if (p.role === 'GK') right.unshift(row('CLEAN SHEETS|CLEAN', n('clean')), row('SAVES', n('saves')), row('CONCEDED', n('conceded')), row('PENS SAVED|PENS', n('pens')));
  const ovr = overall(p);
  const pot = ceilOf(p);
  const idx = club.squad.indexOf(p);
  return `<div class="ss-id">
      <span class="ss-face">${faceHtml(p, club.kit, 'md')}</span>
      <div class="ss-who"><b>${escHtml(p.name)}</b><span><span class="mc-role r-${p.role}">${p.role}</span><em>AGE ${playerAge(p)}</em><em>${idx < 0 ? '' : idx < 11 ? 'STARTER' : 'BENCH'}</em></span></div>
      <div class="ss-ovr"><small>OVR</small><b>${ovr}</b>${pot > ovr ? `<i>POT ${pot}</i>` : ''}</div>
    </div>
    ${keyBarsHtml(p)}
    <div class="ss-grid">${block(left)}${block(right)}</div>`;
}

/** The whole tab: the leaders and the list on the left, the picked player on the right. */
export function statsTab(st: CareerState, club: ClubState, ui: StatsUi): string {
  if (!club.squad.some((p) => p.id === ui.id)) ui.id = club.squad[0]?.id ?? '';
  const p = club.squad.find((x) => x.id === ui.id)!;
  const leaders = squadLeaders(club.squad, seasonOf(st), ui.scope);
  const lead = leaders.length
    ? `<div class="ss-leaders">${leaders.map((l) => leaderChip(l, ui.id)).join('')}</div>`
    : `<p class="ss-none">${ui.scope === 'season' ? 'PLAY A MATCH TO FILL THE BOARD' : 'NOBODY HAS PLAYED YET'}</p>`;
  const seg = (v: StatsScope, label: string) => `<button class="${ui.scope === v ? 'on' : ''}" data-a="sscope" data-v="${v}" aria-pressed="${ui.scope === v}">${label}</button>`;
  return `<div class="mc-body split-l ss-body">
      <div class="pane">
        <div class="pane-h"><span class="sq-ph">SQUAD</span><span class="grow"></span><div class="seg gl-seg ss-seg">${seg('season', 'SEASON')}${seg('career', 'ALL TIME')}</div></div>
        ${lead}
        <div class="ss-head"><span></span><span></span><b>APPS</b><b>G</b><b>A</b><b>AVG</b></div>
        <div class="pane-scroll ss-list" data-scroll-key="ss-list">${club.squad.map((q) => rowHtml(st, q, ui)).join('')}</div>
      </div>
      <div class="pane ss-detail">${detailHtml(st, club, p)}</div>
    </div>`;
}

/** The taps of the tab: pick a player (a row, or a leader), and the SEASON / CAREER switch. */
export function statsHandlers(ui: StatsUi, draw: () => void, root: () => HTMLElement): Record<string, (el: HTMLElement) => void> {
  return {
    spick: (el) => {
      ui.id = el.dataset.id ?? ui.id;
      last = { ...ui };
      buzz('tap');
      draw();
      revealInPane(root().querySelector('.ss-row.sel'));
    },
    sscope: (el) => {
      ui.scope = el.dataset.v === 'career' ? 'career' : 'season';
      last = { ...ui };
      draw();
    },
  };
}
