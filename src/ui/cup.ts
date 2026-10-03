/**
 * BLOCKY CUP views inside ROAD TO GLORY: the bracket (the hub's BLOCKY CUP tab), the cup's rows in YOUR SEASON and the
 * trophy lift. The cup is part of every career season (rules: meta/cup.ts; the season: meta/career.ts); ui/career.ts
 * plays the ties. (It used to be a mode of its own, with its own entry and hub: retired.)
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { cupClubs, trophyCount, type CareerState } from '../meta/career';
import {
  CUP_AFTER, CUP_DIV_SCALE, FINISH_NAMES, ROUND_NAMES, ROUND_PRIZE, ROUND_SHORT, ROUND_TIES, TROPHY_PRIZE, champion, cupFinish, cupPrizeTotal,
  userTie, type CupClub, type CupTie, type SeasonCup,
} from '../meta/cup';
import { cssHex } from '../render/palette';
import { buzz } from '../platform/haptics';
import { esc, fmt, mountMeta } from './club';
import { pixelIcon } from './pixelIcons';
import { scoreHtml, sep } from './text';

function kitDot(c: CupClub | undefined): string {
  if (!c) return '<i class="mc-kd"></i>';
  return `<i class="mc-kd" style="background:${cssHex(c.kit.shirt)};--kd2:${cssHex(c.kit.shirt2)}"></i>`;
}

function clubNames(c: CupClub | undefined): string {
  if (!c) return '?';
  return `<span class="nm-full">${esc(c.name)}</span><span class="nm-short">${esc(c.short)}</span>`;
}

/** "DIV 4" after a club from another division than yours (where the giant killings come from). */
function divTag(c: CupClub | undefined, division: number): string {
  return c && c.division !== division ? `<em>DIV ${c.division}</em>` : '';
}

// ------------------------------------------------------------------ the bracket

function tieHtml(cup: SeasonCup, t: CupTie, clubs: Map<string, CupClub>, division: number): string {
  const you = t.home === cup.user || t.away === cup.user;
  const played = t.winner >= 0;
  const row = (slot: number, goals: number | null, pens: number | null) => {
    if (slot < 0) return '<div class="ct-row tbd"><i class="mc-kd"></i><span>TBD</span><b></b></div>';
    const c = clubs.get(cup.slots[slot]);
    const cls = `${slot === cup.user ? 'me' : ''} ${played ? (t.winner === slot ? 'win' : 'lose') : ''}`;
    return `<div class="ct-row ${cls}">${kitDot(c)}<span>${esc(c?.short ?? '?')}${divTag(c, division)}</span><b>${goals ?? ''}${
      pens !== null ? `<small>(${pens})</small>` : ''
    }</b></div>`;
  };
  const next = !played && you && cup.status === 'active';
  return `<div class="cup-tie${you ? ' you' : ''}${next ? ' next' : ''}">
    ${row(t.home, t.hg, t.pens ? t.pens[0] : null)}${row(t.away, t.ag, t.pens ? t.pens[1] : null)}
  </div>`;
}

/** The draw, QF to the winner, your path highlighted: compact enough for a landscape phone. */
export function cupBracketHtml(cup: SeasonCup, clubs: Map<string, CupClub>, division: number): string {
  const col = (round: number) =>
    `<div class="cup-col"><h3 class="cup-rh">${ROUND_SHORT[round]}</h3><div class="cup-ties">${ROUND_TIES[round]
      .map((i) => tieHtml(cup, cup.ties[i], clubs, division))
      .join('')}</div></div>`;
  const ch = champion(cup);
  const winner = ch >= 0 ? clubs.get(cup.slots[ch]) : undefined;
  const crown = `<div class="cup-col"><h3 class="cup-rh">WINNER</h3><div class="cup-ties">
      <div class="cup-winner${ch >= 0 && ch === cup.user ? ' you' : ''}${ch >= 0 ? ' crowned' : ''}">
        ${pixelIcon('trophy', ch >= 0 ? '#26262e' : '#b9b5aa', 4)}<b>${winner ? esc(winner.short) : '?'}</b>
      </div></div></div>`;
  return `<div class="cup-bracket compact">${col(0)}${col(1)}${col(2)}${crown}</div>`;
}

// ------------------------------------------------------------------ the hub's BLOCKY CUP tab

/** Where your run stands, in one line. */
function statusLine(st: CareerState, cup: SeasonCup, clubs: Map<string, CupClub>): string {
  const season = st.season!;
  if (cup.status === 'won') return `<b>WINNERS!</b><span>+${fmt(cup.earned)} PRIZE MONEY</span>`;
  if (cup.status === 'out') {
    const ch = champion(cup);
    const by = ch >= 0 ? `${esc(clubs.get(cup.slots[ch])?.short ?? '?')} WON THE CUP` : 'THE CUP GOES ON WITHOUT YOU';
    return `<b>${cupFinishText(cupFinish(cup))}</b><span>${by}</span>`;
  }
  const r = cup.round;
  const ut = userTie(cup);
  const rival = ut && ut.rival >= 0 ? clubs.get(cup.slots[ut.rival]) : undefined;
  const opp = rival ? ` V ${esc(rival.short)}` : '';
  const when = season.matchday >= CUP_AFTER[r] ? 'NEXT UP' : `AFTER MATCHDAY ${CUP_AFTER[r]}`;
  return `<b>${ROUND_NAMES[r]}${opp}</b><span>${when}</span>`;
}

/** The BLOCKY CUP tab: where your run stands, what each round pays, the draw and the trophy cabinet. */
export function cupTabHtml(st: CareerState): string {
  const season = st.season!;
  const cup = season.cup;
  const won = trophyCount(st);
  // This season's cup goes into the history (and the count) when the season ends.
  const cups = won.cups + (cup?.status === 'won' && !st.summary ? 1 : 0);
  const cabinet = `<div class="cup-cabinet">${pixelIcon('trophy', '#ffd23a', 3)}<span>TROPHY CABINET</span><b>${cups} BLOCKY CUP${cups === 1 ? '' : 'S'}${sep()}${
    won.titles
  } LEAGUE TITLE${won.titles === 1 ? '' : 'S'}</b></div>`;
  if (!cup) {
    return `<p class="mc-empty">The Blocky Cup starts next season: eight clubs from across the divisions, three knockout rounds between your league matchdays.</p>${cabinet}`;
  }
  const clubs = cupClubs(st);
  const div = season.division;
  const prizes = ROUND_SHORT.map((r, i) => `${r} +${fmt(Math.round(ROUND_PRIZE[i] * CUP_DIV_SCALE[div]))}`).join(sep());
  return `<div class="cup-head">${pixelIcon('trophy', '#ffd23a', 4)}<div class="cup-status">${statusLine(st, cup, clubs)}</div></div>
    ${cupBracketHtml(cup, clubs, div)}
    <p class="mc-hint">Win a round: ${prizes}${sep()}TROPHY +${fmt(Math.round(TROPHY_PRIZE * CUP_DIV_SCALE[div]))}. Level after 90 minutes goes to penalties. Knocked out? The league goes on.</p>
    ${cabinet}`;
}

// ------------------------------------------------------------------ YOUR SEASON rows

/**
 * The cup's row in the season list for `round`: your tie (opponent, score, through or out), the draw still to come,
 * or '' when your run ended before it. `next` marks the match up next.
 */
export function cupSeasonRow(cup: SeasonCup, round: number, clubs: Map<string, CupClub>, next: boolean): string {
  const idx = ROUND_TIES[round].find((i) => cup.ties[i].home === cup.user || cup.ties[i].away === cup.user);
  const tag = `<span class="mc-ysmd">${ROUND_SHORT[round]}</span>`;
  if (idx === undefined) {
    // Not drawn yet (still to come while you're in), or a round you never reached.
    if (cup.status !== 'active' || round < cup.round) return '';
    return `<div class="mc-ys cup">${tag}<span class="mc-chip">${round === 2 ? 'N' : '?'}</span><span class="mc-ysopp">${
      round === 2 ? 'THE FINAL' : `DRAW AFTER THE ${ROUND_SHORT[round - 1]}`
    }</span><b class="sc tbd">VS</b><i class="mc-wdl">${sep()}</i></div>`;
  }
  const t = cup.ties[idx];
  const home = t.home === cup.user;
  const opp = clubs.get(cup.slots[home ? t.away : t.home]);
  const venue = round === 2 ? ['N', ''] : home ? ['H', 'home'] : ['A', 'away'];
  let score = '<b class="sc tbd">VS</b>';
  let res = `<i class="mc-wdl">${sep()}</i>`;
  if (t.winner >= 0 && t.hg !== null && t.ag !== null) {
    score = `<b class="sc">${scoreHtml(t.hg, t.ag)}${t.pens ? '<small>PENS</small>' : ''}</b>`;
    res = t.winner === cup.user ? '<i class="mc-wdl w">W</i>' : '<i class="mc-wdl l">L</i>';
  }
  return `<div class="mc-ys cup${next ? ' next' : ''}">${tag}<span class="mc-chip ${venue[1]}">${venue[0]}</span><span class="mc-ysopp">${kitDot(opp)}${clubNames(opp)}</span>${score}${res}</div>`;
}

/** "WINNERS", "RUNNERS UP", "OUT IN THE SEMI FINALS": a finished run, for the summary and history. */
export function cupFinishText(finish: number): string {
  return finish >= 2 ? FINISH_NAMES[finish] : `OUT IN THE ${FINISH_NAMES[Math.max(0, finish)]}`;
}

// ------------------------------------------------------------------ trophy lift

/** The trophy lift after winning the final (once: the cup is marked celebrated), then `onNext`. */
export function cupTrophyScreen(app: AppContext, st: CareerState, onNext: () => void): void {
  const season = st.season!;
  const cup = season.cup!;
  const club = st.club!;
  const scr = mountMeta(app, 'cup-screen cup-trophy-screen');
  cup.celebrated = true;
  app.persist();
  const div = season.division;
  const lines =
    ROUND_SHORT.map((r, i) => `<div><span>${r} WIN</span><b><i></i>+${fmt(Math.round(ROUND_PRIZE[i] * CUP_DIV_SCALE[div]))}</b></div>`).join('') +
    `<div><span>TROPHY BONUS</span><b><i></i>+${fmt(Math.round(TROPHY_PRIZE * CUP_DIV_SCALE[div]))}</b></div>`;
  const total = cup.earned > 0 ? cup.earned : cupPrizeTotal(div);
  scr.render(
    `<div class="cup-lift">
      <div class="cup-rays" aria-hidden="true"></div>
      <div class="cup-big">${pixelIcon('trophy', '#ffd23a', 18)}</div>
      <h2 class="cup-champ-title">CHAMPIONS!</h2>
      <p class="cup-champ-sub">${esc(club.name.toUpperCase())} WIN THE BLOCKY CUP</p>
    </div>
    <div class="mc-prize">${lines}<div class="total"><span>CUP PRIZE MONEY</span><b><i></i>+${fmt(total)}</b></div></div>
    <p class="mc-hint">It goes in the trophy cabinet. Now finish the league season.</p>
    <div class="btn-row"><button class="btn btn-go btn-lg" data-a="next">CONTINUE</button></div>`,
    { next: onNext },
  );
  const cols = [club.kit.shirt, club.kit.shirt2, 0xffd23a, 0xfbfbf4, 0x3cc15a, 0x2f7be8, 0xec4a3e];
  let bits = '';
  for (let i = 0; i < 72; i++) {
    const x = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2.6).toFixed(2);
    const dur = (2.6 + Math.random() * 2.4).toFixed(2);
    const spin = Math.floor(Math.random() * 900 - 450);
    const drift = Math.floor(Math.random() * 160 - 80);
    bits += `<i style="--x:${x}%;--d:${delay}s;--t:${dur}s;--r:${spin}deg;--dx:${drift}px;background:${cssHex(cols[i % cols.length])}"></i>`;
  }
  const conf = document.createElement('div');
  conf.className = 'cup-confetti';
  conf.setAttribute('aria-hidden', 'true');
  conf.innerHTML = bits;
  scr.root.appendChild(conf);
  sfx.goal();
  sfx.coin();
  buzz('win');
}
