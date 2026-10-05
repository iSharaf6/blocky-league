/**
 * The player card: everything a decision about a player needs, on the screen where you decide (the owner: "i just got
 * asked to make a decision out of 3 for my star player and i cant see his stats and shit"). One card, drawn the same
 * everywhere: his face, name, position, age, OVR and potential, his key stats as bars, this season's numbers
 * (appearances, goals, assists, average rating; for a keeper clean sheets and saves), then his wage, contract, value
 * and morale. A bid adds the offer beside his value. Used by the event cards (ui/glory.ts), the scout's finds and the
 * academy's prospects, SELL in the market and TRAIN; the STATS tab (ui/squadStats.ts) builds on its pieces.
 *
 * Pure HTML strings (hydrateFaces fills the face). No imports from the screens, so any of them can use it.
 */
import { KEY_STATS, STAT_SHORT, type CareerState } from '../meta/career';
import { ceilOf } from '../meta/growth';
import { MORALE_NAMES } from '../meta/life';
import { contractOf, playerAge, playerValue, wageOf } from '../meta/market';
import { moodOf, moraleOf } from '../meta/morale';
import { ratingText, seasonLine, type StatLine } from '../meta/stats';
import { overall, type Kit, type PlayerDef } from '../sim/types';
import { faceHtml } from './preview';
import './playerCard.css';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
export const numText = (n: number): string => Math.round(n).toLocaleString('en-US');

const cell = (label: string, value: string, cls = ''): string =>
  `<div class="pc-cell ${cls}"><small>${label}</small><b>${value}</b></div>`;

/** The number of the season being played (0 before the first). */
export const seasonOf = (st: CareerState): number => st.season?.number ?? 0;

/** His key stats for his role, three cells, the number over a bar (the market's own look). */
export function keyBarsHtml(p: PlayerDef): string {
  return `<div class="pc-bars">${KEY_STATS[p.role]
    .map((k) => `<div class="pc-bar"><small>${STAT_SHORT[k]}</small><b>${p.stats[k]}</b><i><i style="width:${p.stats[k]}%"></i></i></div>`)
    .join('')}</div>`;
}

/** His key stats as a line ("PAS 40 DRI 38 STA 44"): a list row's second caption. */
export function keyStatsLine(p: PlayerDef): string {
  return KEY_STATS[p.role].map((k) => `${STAT_SHORT[k]} ${p.stats[k]}`).join(' ');
}

/** This season's four numbers under their caption (the SELL detail of the market). */
export function seasonStripHtml(st: CareerState, p: PlayerDef): string {
  return `<p class="pc-cap">THIS SEASON</p>${numsHtml(p, seasonLine(p, seasonOf(st)))}`;
}

/** The four numbers of a line that tell a story: appearances, goals, assists and the average (a keeper: clean sheets, saves). */
export function numsHtml(p: PlayerDef, l: StatLine): string {
  if (p.role === 'GK') return `<div class="pc-cells">${cell('APPS', String(l.apps))}${cell('CLEAN', String(l.clean))}${cell('SAVES', String(l.saves))}${cell('AVG', ratingText(l), 'avg')}</div>`;
  return `<div class="pc-cells">${cell('APPS', String(l.apps))}${cell('GOALS', String(l.goals))}${cell('ASSISTS', String(l.assists))}${cell('AVG', ratingText(l), 'avg')}</div>`;
}

/** The same as a line of words, for a row or a toast ("12 APPS, 4 GOALS, 3 ASSISTS, AVG 7.1"). */
export function numsText(p: PlayerDef, l: StatLine): string {
  if (!l.apps) return 'NOT PLAYED YET';
  const avg = l.rated > 0 ? `, AVG ${ratingText(l)}` : '';
  return p.role === 'GK' ? `${l.apps} APPS, ${l.clean} CLEAN, ${l.saves} SAVES${avg}` : `${l.apps} APPS, ${l.goals} GOALS, ${l.assists} ASSISTS${avg}`;
}

/** His wage, contract, value and morale. */
export function factsHtml(p: PlayerDef, o: { value?: boolean } = {}): string {
  const mood = MORALE_NAMES[moodOf(moraleOf(p))];
  return `<div class="pc-cells">${cell('WAGE', numText(wageOf(p)))}${cell('YEARS', String(contractOf(p)))}${o.value === false ? '' : cell('VALUE', numText(playerValue(p)))}${cell('MORALE', `<span class="m${moodOf(moraleOf(p))}">${mood}</span>`, 'word')}</div>`;
}

/** What a bid is: the offer beside his value, and how far over (or under) it is. */
export function offerHtml(p: PlayerDef, coins: number): string {
  const value = playerValue(p);
  const pct = value > 0 ? Math.round((coins / value - 1) * 100) : 0;
  const side = pct === 0 ? cell('VALUE', numText(value)) : cell(pct > 0 ? 'OVER VALUE' : 'UNDER VALUE', `${Math.abs(pct)}%`, pct > 0 ? 'up' : 'down');
  return `<div class="pc-cells offer">${cell('OFFER', numText(coins), 'bid')}${cell('VALUE', numText(value))}${side}</div>`;
}

export interface CardOpts {
  /** A bid on him: the offer (and who from) is shown beside his value. */
  offer?: number;
  /** Two cards on one screen: the head, the key stats and this season, and nothing else. */
  slim?: boolean;
  /** The line under his name (default: STARTER or BENCH). */
  tag?: string;
}

/** The whole card for one of your players. */
export function playerCardHtml(st: CareerState, p: PlayerDef, kit: Kit, o: CardOpts = {}): string {
  const club = st.club;
  const idx = club ? club.squad.indexOf(p) : -1;
  const place = o.tag ?? (idx < 0 ? '' : idx < 11 ? 'STARTER' : 'BENCH');
  const ovr = overall(p);
  const pot = ceilOf(p);
  const line = seasonLine(p, seasonOf(st));
  const inj = (p as { inj?: number }).inj ?? 0;
  const label = `${p.name}, ${p.role}, age ${playerAge(p)}, overall ${ovr}${pot > ovr ? `, potential ${pot}` : ''}`;
  return `<section class="pc ${o.slim ? 'slim' : ''}" aria-label="${escHtml(label)}">
      <header class="pc-head">
        <span class="pc-face">${faceHtml(p, kit, 'md')}</span>
        <div class="pc-id"><b>${escHtml(p.name)}</b><span><span class="mc-role r-${p.role}">${p.role}</span><em>AGE ${playerAge(p)}</em>${inj > 0 ? `<em class="hurt">OUT ${inj}</em>` : place ? `<em>${place}</em>` : ''}</span></div>
        <div class="pc-ovr"><small>OVR</small><b>${ovr}</b>${pot > ovr ? `<i>POT ${pot}</i>` : ''}</div>
      </header>
      ${keyBarsHtml(p)}
      <p class="pc-cap">THIS SEASON</p>
      ${numsHtml(p, line)}
      ${o.slim ? '' : o.offer ? offerHtml(p, o.offer) : ''}
      ${o.slim ? '' : factsHtml(p, { value: !o.offer })}
    </section>`;
}
