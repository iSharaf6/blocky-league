/**
 * The forever game inside ROAD TO GLORY (no new screens: the hub's own panes). ui/career.ts mounts these pieces:
 * - THIS SEASON: the board's three objectives as one strip under the next match (a tap opens the CLUB tab).
 * - the CLUB tab: the board, the academy (PROMOTE BEST PROSPECT), the squad's mood, legacy and its perks, the rival,
 *   the record book, the Hall of Fame, and START AGAIN AS A LEGEND once it is earned.
 * - the CONTINENTAL / WORLD CLUB CUP sections of the CUPS tab.
 * - the season STORY on the summary (the recap): the board's verdict, the highlights, the legacy earned, farewells.
 * - the MOMENTS: one stamp card at a time for an objective done, a milestone, a new stand, a legacy level.
 * Rules live in meta/ (board, life, legacy, story, comps, ground); this file only draws them.
 */
import { sfx } from '../audio/sfx';
import { YOU, type CareerState } from '../meta/career';
import { boardView, confidenceWord, seasonResults } from '../meta/board';
import { COMP_FINISH, COMP_NAMES, CONT_FINAL_AFTER, CONT_GROUP_AFTER, CONT_SF_AFTER, compClub, fixtureWinner, groupTable, type Competition, type CompFixture } from '../meta/comps';
import { LEGACY_PERKS, canStartAsLegend, legacyLevel, nextPerk } from '../meta/legacy';
import { CHEMISTRY_NAMES, MORALE_NAMES, captainOf, chemistry, morale, prospectCeiling, seasonTopScorer, type LifePlayer, type MatchFacts } from '../meta/life';
import { playerAge, playerPotential } from '../meta/market';
import { takeMoment, type StoryMoment } from '../meta/story';
import type { MatchResult } from '../game/matchSession';
import { buzz } from '../platform/haptics';
import { cssHex } from '../render/palette';
import { overall, type Side } from '../sim/types';
import { esc, fmt } from './club';
import { pixelIcon } from './pixelIcons';
import { scoreHtml, sep } from './text';
import './forever.css';

const stars = (n: number) => `<span class="fv-stars" aria-label="${n} star potential">${'★'.repeat(Math.max(0, n))}</span>`;

// ------------------------------------------------------------------ THIS SEASON (the hub's left pane)

/** The board's three objectives as one tappable strip: a tick, the short goal, the live progress. */
export function seasonStripHtml(st: CareerState): string {
  const views = boardView(st);
  if (!views.length) return '';
  const chips = views
    .map((v) => {
      const s = v.obj.state;
      return `<span class="fv-obj ${s}"><i class="fv-tick" aria-hidden="true">${s === 'done' ? '✓' : s === 'failed' ? '✕' : ''}</i><b>${esc(v.short)}</b><small>${esc(v.progress)}</small></span>`;
    })
    .join('');
  const done = views.filter((v) => v.obj.state === 'done').length;
  return `<button class="fv-strip" data-a="tab" data-v="club" aria-label="This season: ${done} of ${views.length} board objectives done. Open the club tab">
      <span class="fv-strip-h"><b>THIS SEASON</b><em>${done}/${views.length}</em></span>${chips}
    </button>`;
}

// ------------------------------------------------------------------ the CLUB tab

function section(title: string, body: string, extra = ''): string {
  return `<section class="fv-sec"><h3 class="fv-h"><span>${title}</span>${extra}</h3>${body}</section>`;
}

function kitDot(kit: { shirt: number; shirt2: number }): string {
  return `<i class="mc-kd" style="background:${cssHex(kit.shirt)};--kd2:${cssHex(kit.shirt2)}"></i>`;
}

function boardSection(st: CareerState): string {
  const b = st.board;
  const rows = boardView(st)
    .map((v) => {
      const s = v.obj.state;
      const right = s === 'done' ? `<b class="fv-ok">✓ +${fmt(v.obj.reward)}</b>` : s === 'failed' ? '<b class="fv-no">MISSED</b>' : `<b class="fv-pay">+${fmt(v.obj.reward)}</b>`;
      return `<div class="fv-row fv-objrow ${s}"><span class="fv-t">${esc(v.label)}</span><small>${esc(v.progress)}</small>${right}</div>`;
    })
    .join('');
  const conf = `<div class="fv-conf"><span>BOARD CONFIDENCE</span><i class="fv-bar"><u style="width:${b.confidence}%"></u></i><b>${b.confidence}%</b><em>${confidenceWord(b.confidence)}</em></div>`;
  return section('THE BOARD', `${rows || '<p class="fv-empty">NEW OBJECTIVES WHEN THE SEASON STARTS</p>'}${conf}`);
}

function academySection(st: CareerState): string {
  const ps = st.academy.prospects;
  if (!ps.length) {
    const next = st.academy.season ? 'NEXT INTAKE: NEXT SEASON' : 'FIRST INTAKE: NEXT SEASON';
    return section('YOUTH ACADEMY', `<p class="fv-empty">${next}</p>`);
  }
  const full = (st.club?.squad.length ?? 0) >= 23;
  const rows = ps
    .map((p, i) => `<div class="fv-row fv-prospect">
        <span class="mc-role r-${p.role}">${p.role}</span>
        <span class="fv-t">${esc(p.name)}<small>AGE ${playerAge(p)}${sep()}UP TO ${prospectCeiling(p)}</small></span>
        ${stars(playerPotential(p))}
        <b class="mc-ovr">${overall(p)}</b>
        <button class="btn btn-go fv-mini" data-a="promote" data-i="${i}" ${full ? 'disabled' : ''} aria-label="Promote ${esc(p.name)}">PROMOTE</button>
        <button class="btn btn-white fv-mini" data-a="release" data-i="${i}" aria-label="Release ${esc(p.name)}">✕</button>
      </div>`)
    .join('');
  const best = `<button class="btn btn-yellow fv-mini" data-a="promotebest" ${full ? 'disabled' : ''}>PROMOTE BEST</button>`;
  return section('YOUTH ACADEMY', `${rows}${full ? '<p class="fv-empty">SQUAD FULL: SELL OR RELEASE FIRST</p>' : ''}`, best);
}

function moodSection(st: CareerState): string {
  const club = st.club!;
  const m = morale(st.story.form);
  const c = chemistry(club, st.season?.number ?? 1);
  const cap = captainOf(club) as LifePlayer | undefined;
  const form = st.story.form.length ? st.story.form.map((f) => `<i class="mc-wdl ${f === 'W' ? 'w' : f === 'D' ? 'd' : 'l'}">${f}</i>`).join('') : '<small>NO GAMES YET</small>';
  return section('THE SQUAD', `<div class="fv-mood">
      <div class="fv-m m${m}">${pixelIcon('fire', 'currentColor', 2)}<span>MORALE</span><b>${MORALE_NAMES[m]}</b></div>
      <div class="fv-m m${c}">${pixelIcon('duo', 'currentColor', 2)}<span>CHEMISTRY</span><b>${CHEMISTRY_NAMES[c]}</b></div>
      <div class="fv-m cap">${pixelIcon('shield', 'currentColor', 2)}<span>CAPTAIN</span><b>${cap ? esc(cap.name.toUpperCase()) : '?'}</b></div>
    </div><div class="fv-form"><span>FORM</span>${form}</div>`);
}

function legacySection(st: CareerState): string {
  const lg = st.legacy;
  const lv = legacyLevel(lg.points);
  const perk = nextPerk(lg.points);
  const got = LEGACY_PERKS.filter((p) => lv.level >= p.level).map((p) => `<span class="fv-perk">${esc(p.text)}</span>`).join('');
  const treble = st.season?.division === 1 || lg.trebles > 0
    ? `<div class="fv-row fv-treble">${pixelIcon('crown', '#ffd23a', 2)}<span class="fv-t">THE TREBLE<small>LEAGUE, BLOCKY CUP AND CONTINENTAL CUP IN ONE SEASON</small></span><b>${lg.trebles ? `${lg.trebles}X` : 'NOT YET'}</b></div>`
    : '';
  const log = lg.log.slice(0, 4).map((e) => `<div class="fv-row fv-log"><span class="fv-t">${esc(e.text)}</span><b>+${fmt(e.points)}</b></div>`).join('');
  return section('CLUB LEGACY', `<div class="fv-lv"><b class="fv-lvn"><small>LV</small>${lv.level}</b><span class="fv-lvbar"><i class="fv-bar"><u style="width:${Math.round((lv.into / lv.need) * 100)}%"></u></i><small>${fmt(lg.points)} POINTS${sep()}${fmt(lv.next - lg.points)} TO LEVEL ${lv.level + 1}</small></span></div>
    ${perk ? `<p class="fv-next">LEVEL ${perk.level}: ${esc(perk.text)}</p>` : ''}
    ${got ? `<div class="fv-perks">${got}</div>` : ''}${treble}${log}`);
}

function rivalSection(st: CareerState): string {
  const r = st.story.rival;
  if (!r) return '';
  const h2h = r.met ? `${r.won}W ${r.drawn}D ${r.lost}L` : 'NOT MET YET';
  return section('YOUR RIVAL', `<div class="fv-row fv-rival">${kitDot(r.kit)}<span class="fv-t">${esc(r.name.toUpperCase())}<small>FOLLOWS YOU UP THE LEAGUES</small></span><b>${h2h}</b></div>`);
}

function recordsSection(st: CareerState): string {
  const r = st.legacy.records;
  const row = (label: string, value: string) => `<div class="fv-row fv-rec"><span>${label}</span><b class="fv-t">${value}</b></div>`;
  const rows = [
    r.topScorer ? row('TOP SCORER', `${esc(r.topScorer.name.toUpperCase())}${sep()}${r.topScorer.goals} GOALS`) : '',
    r.mostApps ? row('MOST GAMES', `${esc(r.mostApps.name.toUpperCase())}${sep()}${r.mostApps.apps}`) : '',
    r.biggestWin ? row('BIGGEST WIN', `${r.biggestWin.my}:${r.biggestWin.their} V ${esc(r.biggestWin.vs.toUpperCase())}`) : '',
    r.recordSigning ? row('RECORD SIGNING', `${esc(r.recordSigning.name.toUpperCase())}${sep()}${fmt(r.recordSigning.paid)}`) : '',
  ].join('');
  return section('CLUB RECORDS', rows || '<p class="fv-empty">PLAY TO WRITE THE RECORD BOOK</p>');
}

function hallSection(st: CareerState, confirm: boolean): string {
  const lg = st.legacy;
  const legends = lg.legends
    .map((l) => `<div class="fv-row fv-legend"><span class="mc-role r-${l.role}">${l.role}</span><span class="fv-t">${esc(l.name.toUpperCase())}<small>${esc(l.club.toUpperCase())}${sep()}${esc(l.why)}</small></span>${pixelIcon('star', '#ffd23a', 1.6)}</div>`)
    .join('');
  const past = lg.past
    .map((p) => `<div class="fv-row fv-past">${kitDot(p.kit)}<span class="fv-t">${esc(p.name.toUpperCase())}<small>${p.seasons} SEASONS${sep()}${p.titles} TITLES${sep()}${p.cups + p.continental + p.world} CUPS</small></span></div>`)
    .join('');
  const can = canStartAsLegend(st);
  const anew = can
    ? `<div class="fv-anew"><p>${confirm ? 'SURE? THIS CLUB GOES INTO THE HALL OF FAME. YOUR LEGACY, PERKS AND COINS STAY.' : 'YOU CONQUERED THE ELITE LEAGUE. START AGAIN WITH A NEW CLUB, AS A LEGEND.'}</p>
        <button class="btn ${confirm ? 'btn-red' : 'btn-yellow'}" data-a="legend">${confirm ? 'YES, START A NEW CLUB' : 'START A NEW CLUB AS A LEGEND'}</button></div>`
    : '';
  const body = legends || past ? `${legends}${past}` : '<p class="fv-empty">LEGENDS RETIRE INTO THE HALL OF FAME</p>';
  return section('HALL OF FAME', `${body}${anew}`);
}

/** The CLUB tab of the hub: everything the club is building up, season after season. */
export function clubTabHtml(st: CareerState, confirmLegend = false): string {
  if (!st.club) return '';
  return `<div class="fv-club">${boardSection(st)}${academySection(st)}${moodSection(st)}${legacySection(st)}${rivalSection(st)}${recordsSection(st)}${hallSection(st, confirmLegend)}</div>`;
}

// ------------------------------------------------------------------ the CUPS tab: Continental and World Club Cups

function compName(comp: Competition, id: string): string {
  if (id === YOU) return 'YOU';
  return esc(compClub(comp, id)?.short ?? '?');
}

function compRow(comp: Competition, f: CompFixture, label: string): string {
  const you = f.home === YOU || f.away === YOU;
  const played = f.hg !== null && f.ag !== null;
  const w = fixtureWinner(f);
  const side = (id: string) => {
    if (!id) return '<span class="fv-cs tbd">TBD</span>';
    const c = compClub(comp, id);
    return `<span class="fv-cs ${id === YOU ? 'me' : ''} ${played && w === id ? 'win' : ''}">${c ? kitDot(c.kit) : ''}${compName(comp, id)}</span>`;
  };
  const score = played ? `<b class="sc">${scoreHtml(f.hg!, f.ag!)}${f.pens ? '<small>PENS</small>' : ''}</b>` : '<b class="sc tbd">VS</b>';
  return `<div class="fv-row fv-fx ${you ? 'you' : ''}"><span class="mc-ysmd">${label}</span>${side(f.home)}${score}${side(f.away)}</div>`;
}

function compHead(comp: Competition, st: CareerState): string {
  const name = COMP_NAMES[comp.kind];
  let line = '';
  if (comp.status === 'won') line = `WINNERS!${sep()}+${fmt(comp.earned)}`;
  else if (comp.status === 'out') line = 'OUT OF IT THIS SEASON';
  else {
    const md = st.season?.matchday ?? 0;
    const next = comp.fixtures.find((f) => (f.home === YOU || f.away === YOU) && f.hg === null);
    line = next ? (next.after <= md ? 'NEXT UP' : `AFTER MATCHDAY ${next.after}`) : 'WAITING FOR THE DRAW';
  }
  return `<div class="cup-head fv-comphead ${comp.kind}">${pixelIcon('trophy', comp.kind === 'world' ? '#7fe0ff' : '#ffd23a', 3)}<div class="cup-status"><b>${name}</b><span>${line}</span></div></div>`;
}

/** A group's table, compact: position, club, played, points. */
function groupHtml(comp: Competition, gi: number): string {
  const rows = groupTable(comp, gi)
    .map((r, i) => {
      const c = compClub(comp, r.id);
      return `<tr class="${r.id === YOU ? 'you' : ''} ${i < 2 ? 'up' : ''}"><td class="pos">${i + 1}</td><td class="club">${c ? kitDot(c.kit) : ''}${compName(comp, r.id)}</td><td>${r.P}</td><td>${r.GD > 0 ? `+${r.GD}` : r.GD}</td><td class="pts">${r.PTS}</td></tr>`;
    })
    .join('');
  return `<table class="mc-table fv-group"><thead><tr><th>#</th><th class="club">GROUP ${gi === 0 ? 'A' : 'B'}</th><th>P</th><th>GD</th><th>PTS</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The Continental / World Club Cup sections for the CUPS tab ('' when the season has neither). */
export function compsHtml(st: CareerState): string {
  const s = st.season;
  if (!s) return '';
  let out = '';
  const w = s.world;
  if (w) {
    const [sf1, sf2, fin] = w.fixtures;
    out += `${compHead(w, st)}<div class="fv-fxs">${compRow(w, sf1, 'SF')}${compRow(w, sf2, 'SF')}${compRow(w, fin, 'FINAL')}</div>`;
  }
  const c = s.continental;
  if (c) {
    const mine = c.fixtures.filter((f) => f.stage === 'group' && (f.home === YOU || f.away === YOU));
    const ko = c.fixtures.filter((f) => f.stage !== 'group');
    out += `${compHead(c, st)}
      <div class="fv-groups">${groupHtml(c, 0)}${groupHtml(c, 1)}</div>
      <div class="fv-fxs">${mine.map((f, i) => compRow(c, f, `G${i + 1}`)).join('')}${ko.map((f) => compRow(c, f, f.stage === 'sf' ? 'SF' : 'FINAL')).join('')}</div>
      <p class="fv-cal">GROUP GAMES AFTER MATCHDAYS ${CONT_GROUP_AFTER.join(', ')}${sep()}SEMI AFTER ${CONT_SF_AFTER}${sep()}FINAL AFTER ${CONT_FINAL_AFTER}</p>`;
  } else if (s.division !== 1 && !w) {
    out += `<div class="cup-head fv-comphead locked">${pixelIcon('lock', '#b9b5aa', 3)}<div class="cup-status"><b>CONTINENTAL CUP</b><span>REACH THE ELITE LEAGUE TO PLAY THE BEST ABROAD</span></div></div>`;
  }
  return out;
}

/** "WINNERS", "OUT IN THE SEMI FINALS" for a Continental / World Club Cup run. */
export function compFinishText(f: number): string {
  return f >= 2 ? COMP_FINISH[f] : `OUT IN THE ${COMP_FINISH[Math.max(0, f)]}`;
}

// ------------------------------------------------------------------ the season STORY (the recap)

/** The season's story on the summary: the board's verdict, the highlights, the legacy, the farewells. */
export function recapHtml(st: CareerState): string {
  const sum = st.summary;
  if (!sum) return '';
  const board = boardView(st)
    .map((v) => `<div class="fv-row fv-objrow ${v.obj.state}"><i class="fv-tick">${v.obj.state === 'done' ? '✓' : '✕'}</i><span class="fv-t">${esc(v.label)}</span><b>${v.obj.state === 'done' ? `+${fmt(v.obj.reward)}` : 'MISSED'}</b></div>`)
    .join('');
  const res = seasonResults(st);
  const w = res.filter((r) => r.my > r.their || (r.my === r.their && r.won)).length;
  const l = res.filter((r) => r.my < r.their || (r.my === r.their && r.won === false)).length;
  const d = res.length - w - l;
  const cs = res.filter((r) => r.their === 0 && !r.forfeit).length;
  const best = res.reduce<(typeof res)[number] | null>((b, r) => (r.my - r.their > (b ? b.my - b.their : 0) ? r : b), null);
  const scorer = seasonTopScorer(st);
  const hl = [
    `<div class="fv-row fv-rec"><span>RECORD</span><b class="fv-t">${w}W ${d}D ${l}L${sep()}${cs} CLEAN SHEETS</b></div>`,
    scorer ? `<div class="fv-row fv-rec"><span>TOP SCORER</span><b class="fv-t">${esc(scorer.name.toUpperCase())}${sep()}${scorer.goals} GOALS</b></div>` : '',
    best ? `<div class="fv-row fv-rec"><span>BIGGEST WIN</span><b class="fv-t">${best.my}:${best.their}</b></div>` : '',
    sum.legacy ? `<div class="fv-row fv-rec"><span>LEGACY</span><b class="fv-t">+${fmt(sum.legacy)} POINTS${sep()}LEVEL ${legacyLevel(st.legacy.points).level}</b></div>` : '',
  ].join('');
  const bye = (sum.retiring ?? [])
    .map((f) => `<div class="fv-row fv-legend"><span class="mc-role r-${f.role}">${f.role}</span><span class="fv-t">${esc(f.name.toUpperCase())}<small>AGE ${f.age}${sep()}${f.apps} GAMES${sep()}${f.goals} GOALS</small></span>${f.legend ? '<b class="fv-ok">LEGEND</b>' : ''}</div>`)
    .join('');
  const treble = sum.treble ? `<div class="fv-treblebig">${pixelIcon('crown', '#ffd23a', 3)}<b>THE TREBLE!</b></div>` : '';
  return `<div class="fv-club">${treble}${section('THE BOARD', board || '<p class="fv-empty">NO OBJECTIVES THIS SEASON</p>', `<em class="fv-confchip">${st.board.confidence}% ${confidenceWord(st.board.confidence)}</em>`)}${section('HIGHLIGHTS', hl)}${bye ? section('FAREWELL', bye) : ''}</div>`;
}

// ------------------------------------------------------------------ the moments (stamp cards, one at a time)

const MOMENT_COLOR: Record<StoryMoment['kind'], string> = {
  board: '#3cc15a', milestone: '#2f7be8', build: '#ff8a2a', legacy: '#8a5cf6', record: '#ec4a3e', farewell: '#26262e', trophy: '#ffd23a', academy: '#1fb3a6', rival: '#ec4a3e',
};

/**
 * Show the moments waiting in the career (oldest first) over `root`, one stamp card at a time: a tap (or Enter,
 * Escape, Space) moves on. `onEach` runs after each is taken (save it), `onDone` when the last one goes.
 */
export function playMoments(root: HTMLElement, st: CareerState, onEach: () => void, onDone?: () => void): boolean {
  const first = takeMoment(st);
  if (!first) return false;
  onEach();
  const wrap = document.createElement('div');
  wrap.className = 'fv-moment-wrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  root.appendChild(wrap);
  let cur: StoryMoment | null = first;
  const show = (m: StoryMoment) => {
    const color = MOMENT_COLOR[m.kind];
    wrap.innerHTML = `<div class="fv-moment k-${m.kind}" style="--mc:${color}">
        <div class="fv-mic">${pixelIcon(m.icon, m.kind === 'trophy' ? '#26262e' : '#fff', 5)}</div>
        <b class="fv-mt">${esc(m.title)}</b>
        <p class="fv-mx">${esc(m.text)}</p>
        ${m.coins ? `<span class="fv-mcoins"><i></i>+${fmt(m.coins)}</span>` : ''}
        <button class="btn btn-go fv-mgo" data-a="moment">${st.story.moments.length ? 'NEXT' : 'GREAT!'}</button>
      </div>`;
    if (m.coins || m.kind === 'trophy') sfx.coin();
    else sfx.click();
    buzz(m.kind === 'trophy' || m.kind === 'legacy' ? 'win' : 'success');
    wrap.querySelector<HTMLButtonElement>('[data-a=moment]')?.focus({ preventScroll: true });
  };
  const next = () => {
    cur = takeMoment(st);
    onEach();
    if (cur) show(cur);
    else {
      wrap.remove();
      window.removeEventListener('keydown', key, true);
      onDone?.();
    }
  };
  const key = (e: KeyboardEvent) => {
    // (The screen went away under the card some other way: let the keys go.)
    if (!wrap.isConnected) {
      window.removeEventListener('keydown', key, true);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      next();
    }
  };
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    next();
  });
  window.addEventListener('keydown', key, true);
  show(cur);
  return true;
}

// ------------------------------------------------------------------ what a match leaves behind

/**
 * Appearances and goals from a full-time result: the eleven who started (`xi`, taken at kick-off), whoever was on
 * at the end, and the scorers (by name: a goal stays his even if he was later substituted).
 */
export function matchFacts(r: MatchResult, hs: Side, xi: readonly { id: string; name: string }[], squad: readonly { id: string; name: string }[], vs: string): MatchFacts {
  const m = r.match as Partial<MatchResult['match']> | undefined;
  const byName = new Map(squad.map((p) => [p.name, p.id]));
  const played = new Set(xi.map((p) => p.id));
  for (const p of m?.players ?? []) if (p.side === hs && byName.get(p.def.name) === p.def.id) played.add(p.def.id);
  const scorers: string[] = [];
  for (const g of m?.goals ?? []) {
    if (g.side !== hs || g.own) continue;
    const id = byName.get(g.name);
    if (id) scorers.push(id);
  }
  return { played: [...played], scorers, my: r.score[hs], their: r.score[hs === 0 ? 1 : 0], vs };
}
