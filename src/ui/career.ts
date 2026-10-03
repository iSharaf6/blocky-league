/**
 * ROAD TO GLORY screens on the app shell (docs/UX.md): the hub (the next match with a big PLAY on the left, always on
 * screen, with compact SQUAD / TRAINING / TRANSFERS / STADIUM under it; the TABLE, FIXTURES and CUP tabs in a pane on
 * the right, scrolled to your row and the current matchday), match launch and the one-screen season summary.
 * Transfers live in one place, the market (ui/market.ts): its BACK returns here.
 * Rules live in meta/career.ts; this file only renders and wires them to AppContext.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import {
  BOTTOM_DIVISION, CLUBS_PER_DIVISION, DIVISION_NAMES, MATCHDAYS, STADIUM_MAX, STADIUM_NAMES, TOP_DIVISION, YOU,
  clubRating, cupClubs, cupDue, cupTieReward, finishSeason, forfeitScore, leagueClubs, leagueTable, matchAttendance, matchDifficulty,
  matchReward, newSeason, nextMatch, payTable, refreshMarket, resolveCupTie, resolveMatchday, rivalStadiumLevel, startNextSeason,
  type CareerState, type Fixture, type LeagueClub, type NextMatch, type SeasonState, type TableRow,
} from '../meta/career';
import { CUP_AFTER, ROUND_NAMES, cupPrize, retiredCupNote, type TieOutcome } from '../meta/cup';
import { marketUnread } from '../meta/market';
import { cssHex } from '../render/palette';
import { goalsOf } from '../sim/shootout';
import type { Kit, Side } from '../sim/types';
import { careerState, closeMeta, clubCreate, esc, fmt, mountMeta, openClub, topBar, type ToastKind } from './club';
import { cupFinishText, cupSeasonRow, cupTabHtml, cupTrophyScreen } from './cup';
import { openMarket } from './market';
import { DIFFICULTIES, shirtArt } from './menus';
import { revealInPane } from './panes';
import { pixelIcon } from './pixelIcons';
import { roadIntro } from './roadIntro';
import { scoreHtml, sep } from './text';
import './career.css';

type HubTab = 'table' | 'fixtures' | 'cup';

/** The hub's memory for the session (docs/UX.md section 8): the last tab looked at. */
const hubMemo = { tab: 'table' as HubTab };

interface Flash {
  msg: string;
  kind: ToastKind;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${n}${s}`;
}

function toMenu(app: AppContext): void {
  closeMeta();
  app.mainMenu();
}

/**
 * After a match the 3D backdrop (demo match) and menu music are gone; mainMenu() restores both, then the
 * career screen replaces the main menu in the same task, so nothing flashes.
 */
function returnToCareer(app: AppContext, flash?: Flash, tab?: HubTab): void {
  app.mainMenu();
  openCareer(app, flash, tab);
}

/**
 * Entry point from the main menu (and the return point after every ROAD TO GLORY match). The very first visit opens
 * the "how it works" panel before anything else (a save already deep in a season has no use for it: it is marked
 * seen); it stays one tap away on the hub.
 */
export function openCareer(app: AppContext, flash?: Flash, tab?: HubTab): void {
  const st = careerState(app);
  retireOldCup(app, st);
  if (!app.save.settings.roadIntroSeen) {
    if (st.club && ((st.season?.matchday ?? 0) > 0 || st.history.length > 0)) {
      app.save.settings.roadIntroSeen = true;
      app.persist();
    } else {
      roadIntro(app, {
        first: true,
        onGo: () => {
          app.save.settings.roadIntroSeen = true;
          app.persist();
          openCareer(app, flash, tab);
        },
        onBack: () => toMenu(app),
      });
      return;
    }
  }
  if (!st.club) {
    clubCreate(app, () => openCareer(app, { msg: 'CLUB FOUNDED! GOOD LUCK', kind: 'good' }), () => toMenu(app));
    return;
  }
  if (!st.season) {
    newSeason(st, BOTTOM_DIVISION, 1);
    app.persist();
  } else if (st.season.matchday >= MATCHDAYS && !st.summary) {
    finishSeason(st, app.save);
    app.persist();
  }
  // Just won the BLOCKY CUP: the trophy lift first (once), then the hub on the cup tab.
  const cup = st.season?.cup;
  if (cup && cup.status === 'won' && !cup.celebrated) {
    cupTrophyScreen(app, st, () => openCareer(app, undefined, 'cup'));
    return;
  }
  if (st.summary) {
    seasonSummary(app, st);
    return;
  }
  refreshMarket(st);
  // A cup tie up next opens on the draw.
  careerHub(app, st, tab ?? (cupDue(st) >= 0 ? 'cup' : hubMemo.tab), flash);
}

/**
 * The BLOCKY CUP used to be a mode of its own (SaveData.cup). It lives in every career season now, so an old cup
 * in the save is closed here, once, with a note on the hub. Its coins were paid tie by tie, so nothing is lost.
 */
function retireOldCup(app: AppContext, st: CareerState): void {
  if (app.save.cup === null || app.save.cup === undefined) return;
  const note = retiredCupNote(app.save.cup);
  app.save.cup = null;
  if (note) st.notice = note;
  app.persist();
}

function kitDot(c: LeagueClub | undefined): string {
  if (!c) return '';
  return `<i class="mc-kd" style="background:${cssHex(c.kit.shirt)};--kd2:${cssHex(c.kit.shirt2)}"></i>`;
}

function clubNames(c: LeagueClub | undefined): string {
  if (!c) return '?';
  return `<span class="nm-full">${esc(c.name)}</span><span class="nm-short">${esc(c.short)}</span>`;
}

function tableHtml(rows: TableRow[], info: Map<string, LeagueClub>, division: number): string {
  const n = rows.length;
  const body = rows
    .map((r, i) => {
      const pos = i + 1;
      const zone = pos <= 2 ? 'up' : pos > n - 2 && division < BOTTOM_DIVISION ? 'down' : '';
      const c = info.get(r.id);
      const gd = r.GD > 0 ? `+${r.GD}` : `${r.GD}`;
      return `<tr class="${zone} ${r.id === YOU ? 'you' : ''}">
        <td class="pos">${pos}</td>
        <td class="club">${kitDot(c)}${clubNames(c)}</td>
        <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
        <td class="xs">${r.GF}</td><td class="xs">${r.GA}</td><td>${gd}</td>
        <td class="pts">${r.PTS}</td>
      </tr>`;
    })
    .join('');
  const upLabel = division > TOP_DIVISION ? 'PROMOTION' : 'TOP TWO PRIZE';
  return `<div class="mc-tablewrap"><table class="mc-table">
      <thead><tr><th>#</th><th class="club">CLUB</th><th>P</th><th>W</th><th>D</th><th>L</th><th class="xs">GF</th><th class="xs">GA</th><th>GD</th><th>PTS</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="mc-legend"><i class="up"></i>${upLabel}${division < BOTTOM_DIVISION ? '<i class="down"></i>RELEGATION' : ''}</p>`;
}

function fixtureScore(f: Fixture): string {
  if (f.hg === null || f.ag === null) return '<b class="sc tbd">VS</b>';
  return `<b class="sc">${scoreHtml(f.hg, f.ag)}${f.forfeit ? '<small>FF</small>' : ''}</b>`;
}

/**
 * Your season, one row per matchday (the cup's rounds slot in after the matchday they follow), the next match marked.
 * A row tap opens that matchday's other results under it; the last one played starts open.
 */
function fixturesHtml(st: CareerState, season: SeasonState, info: Map<string, LeagueClub>, open: number): string {
  const cup = season.cup;
  const cupClubMap = cup ? cupClubs(st) : null;
  const due = cupDue(st);
  // The cup round that comes after this league matchday (QF after MD2...), as its own row.
  const cupAfter = (md: number): string => {
    const r = CUP_AFTER.findIndex((n) => n === md + 1);
    return cup && cupClubMap && r >= 0 ? cupSeasonRow(cup, r, cupClubMap, due === r) : '';
  };
  const others = (mine: Fixture) =>
    season.fixtures
      .filter((f) => f.md === mine.md && f !== mine)
      .map(
        (f) => `<div class="mc-fx">
        <span class="h">${clubNames(info.get(f.home))}${kitDot(info.get(f.home))}</span>
        ${fixtureScore(f)}
        <span class="a">${kitDot(info.get(f.away))}${clubNames(info.get(f.away))}</span>
      </div>`,
      )
      .join('');
  const rows = season.fixtures
    .filter((f) => f.home === YOU || f.away === YOU)
    .sort((a, b) => a.md - b.md)
    .map((f) => {
      const home = f.home === YOU;
      const opp = info.get(home ? f.away : f.home);
      let res = `<i class="mc-wdl">${sep()}</i>`;
      if (f.hg !== null && f.ag !== null) {
        const my = home ? f.hg : f.ag;
        const their = home ? f.ag : f.hg;
        res = my > their ? '<i class="mc-wdl w">W</i>' : my === their ? '<i class="mc-wdl d">D</i>' : '<i class="mc-wdl l">L</i>';
      }
      const isOpen = f.md === open;
      const next = f.md === season.matchday && due < 0;
      return `<button class="mc-ys cr-ys${next ? ' next' : ''}${isOpen ? ' open' : ''}" data-a="md" data-v="${f.md}" aria-expanded="${isOpen}" aria-label="Matchday ${f.md + 1}: other results">
          <span class="mc-ysmd">MD${f.md + 1}</span>
          <span class="mc-chip ${home ? 'home' : 'away'}">${home ? 'H' : 'A'}</span>
          <span class="mc-ysopp">${kitDot(opp)}${clubNames(opp)}</span>
          ${fixtureScore(f)}
          ${res}
        </button>${isOpen ? `<div class="cr-others">${others(f)}</div>` : ''}${cupAfter(f.md)}`;
    })
    .join('');
  return `<div class="mc-fxlist cr-fx">${rows}</div>`;
}

/** One side of the next-match card: shirt, short name, full name, a fact line. */
function sideHtml(kit: Kit, short: string, name: string, meta: string): string {
  return `<div class="mc-side">${shirtArt(kit, 6)}<b>${esc(short)}</b><small>${esc(name)}</small><em>${meta}</em></div>`;
}

/** The next league match: both clubs, the big PLAY, and what a result pays. */
function leagueCard(st: CareerState, nm: NextMatch, table: TableRow[]): string {
  const club = st.club!;
  const season = st.season!;
  const pay = payTable(season.division, st.stadium);
  const youKit = nm.userHome ? nm.kits[0] : nm.kits[1];
  const themKit = nm.userHome ? nm.kits[1] : nm.kits[0];
  // League position only means something once a ball has been kicked.
  const place = (id: string) => (season.matchday > 0 ? `${sep()}${ordinal(table.findIndex((r) => r.id === id) + 1)}` : '');
  const you = sideHtml(youKit, club.short, club.name, `OVR ${clubRating(club)}${place(YOU)}`);
  const them = sideHtml(themKit, nm.rival.short, nm.rival.name, `OVR ${nm.rival.rating}${place(nm.rival.id)}`);
  return `<section class="mc-next cr-next">
      <div class="mc-nexttop">
        <span class="mc-chip div">DIV ${season.division}</span>
        <span>MATCHDAY ${nm.md + 1}/${MATCHDAYS}${sep()}AI ${DIFFICULTIES[matchDifficulty(season.division)]}</span>
        <span class="mc-chip ${nm.userHome ? 'home' : 'away'}">${nm.userHome ? 'HOME' : 'AWAY'}</span>
      </div>
      <div class="mc-vs">${nm.userHome ? you : them}<div class="mc-vsx">VS</div>${nm.userHome ? them : you}</div>
      <button class="btn btn-go btn-lg mc-play" data-a="play">PLAY MATCHDAY ${nm.md + 1}</button>
      <p class="mc-pay">WIN +${fmt(pay.win)}${sep()}DRAW +${fmt(pay.draw)}${sep()}LOSS +${fmt(pay.loss)}${sep()}GOAL +${pay.goal}</p>
    </section>`;
}

/** The next-match card for a BLOCKY CUP tie: the round, both clubs with their divisions, and what's at stake. */
function cupCard(st: CareerState, nm: NextMatch): string {
  const club = st.club!;
  const division = st.season!.division;
  const youKit = nm.userHome ? nm.kits[0] : nm.kits[1];
  const themKit = nm.userHome ? nm.kits[1] : nm.kits[0];
  const you = sideHtml(youKit, club.short, club.name, `OVR ${clubRating(club)}${sep()}DIV ${division}`);
  const them = sideHtml(themKit, nm.rival.short, nm.rival.name, `OVR ${nm.rival.rating}${sep()}DIV ${nm.rivalDivision}`);
  const round = ROUND_NAMES[nm.cupRound];
  const venue = nm.neutral ? '<span class="mc-chip">NEUTRAL</span>' : `<span class="mc-chip ${nm.userHome ? 'home' : 'away'}">${nm.userHome ? 'HOME' : 'AWAY'}</span>`;
  const prize = cupPrize(nm.cupRound, true, division);
  const stake = nm.cupRound === 2 ? `LIFT THE CUP +${fmt(prize)}` : `GO THROUGH +${fmt(prize)}`;
  return `<section class="mc-next cr-next cup-next">
      <div class="mc-nexttop">
        <span class="mc-chip cup">${pixelIcon('trophy', 'currentColor', 1.6, 'inl')}CUP</span>
        <span>${round}${sep()}AI ${DIFFICULTIES[matchDifficulty(division)]}</span>
        ${venue}
      </div>
      <div class="mc-vs">${nm.userHome ? you : them}<div class="mc-vsx">VS</div>${nm.userHome ? them : you}</div>
      <button class="btn btn-go btn-lg mc-play" data-a="play">PLAY ${round}</button>
      <p class="mc-pay">${stake}${sep()}LEVEL AFTER 90 GOES TO PENS</p>
    </section>`;
}

function careerHub(app: AppContext, st: CareerState, tab0: HubTab, flash?: Flash): void {
  const scr = mountMeta(app, 'mc-career-screen shell');
  let tab = tab0;
  hubMemo.tab = tab;
  /** The matchday whose other results show under your row (the last one played, to start with). */
  let open = (st.season?.matchday ?? 0) - 1;
  /** Bring you into view after the next draw: your table row, the next match, your cup tie. */
  let focus = true;
  const draw = () => {
    const season = st.season!;
    const nm = nextMatch(st);
    const info = new Map(leagueClubs(st).map((c) => [c.id, c]));
    const table = leagueTable(st);
    const next = nm
      ? nm.competition === 'cup'
        ? cupCard(st, nm)
        : leagueCard(st, nm, table)
      : '<section class="mc-next cr-next cr-done"><b>SEASON DONE</b><button class="btn btn-go btn-lg mc-play" data-a="summary">SEE HOW YOU FINISHED</button></section>';
    const body = tab === 'table' ? tableHtml(table, info, season.division) : tab === 'cup' ? cupTabHtml(st) : fixturesHtml(st, season, info, open);
    const tabs: [HubTab, string][] = [['table', 'TABLE'], ['fixtures', 'FIXTURES'], ['cup', 'CUP']];
    const cupNext = cupDue(st) >= 0;
    // Market news the club made itself and nobody has read (openMarket marks them seen, so a visit clears it).
    const unread = marketUnread(st);
    const quick = (a: string, icon: string, label: string, extra = '', aria = '') =>
      `<button class="btn btn-white" data-a="${a}"${aria ? ` aria-label="${aria}"` : ''}>${pixelIcon(icon, 'currentColor', 1.5)}<span>${label}</span>${extra}</button>`;
    scr.render(
      `${topBar('MENU', 'ROAD TO GLORY', `SEASON ${season.number}${sep()}${DIVISION_NAMES[season.division]}`, app.save.coins)}
      <div class="mc-body cr-body">
        <section class="pane cr-main">
          ${st.notice ? `<div class="cr-notice" role="status"><p>${esc(st.notice)}</p><button class="btn btn-white" data-a="dismiss">OK</button></div>` : ''}
          ${next}
          <nav class="cr-quick" aria-label="Your club">
            ${quick('squad', 'shirt', 'SQUAD')}
            ${quick('train', 'bolt', 'TRAINING')}
            ${quick('market', 'swap', 'TRANSFERS', unread ? `<b class="mc-badge">${unread}</b>` : '', `Transfers${unread ? `, ${unread} new` : ''}`)}
            ${quick('stadium', 'flag', 'STADIUM', `<small>LV ${st.stadium}</small>`)}
          </nav>
        </section>
        <section class="pane cr-side">
          <div class="cr-tabs">
            <div class="seg">${tabs
              .map(
                ([k, l]) =>
                  `<button class="${k === tab ? 'on' : ''}${k === 'cup' && cupNext ? ' due' : ''}" data-a="tab" data-v="${k}" aria-pressed="${k === tab}">${
                    k === 'cup' ? pixelIcon('trophy', 'currentColor', 1.3, 'inl') : ''
                  }${l}</button>`,
              )
              .join('')}</div>
            <button class="cr-how" data-a="how" aria-label="How ROAD TO GLORY works">?</button>
          </div>
          <div class="pane-scroll cr-scroll" data-scroll-key="cr-${tab}">${body}</div>
        </section>
      </div>`,
      {
        back: () => toMenu(app),
        dismiss: () => {
          st.notice = null;
          app.persist();
          draw();
        },
        play: () => playMatchday(app, st),
        summary: () => openCareer(app),
        how: () => roadIntro(app, { first: false, onGo: () => openCareer(app, undefined, tab), onBack: () => openCareer(app, undefined, tab) }),
        squad: () => openClub(app, { tab: 'squad', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app, undefined, tab) }),
        train: () => openClub(app, { tab: 'train', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app, undefined, tab) }),
        stadium: () => openClub(app, { tab: 'stadium', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app, undefined, tab) }),
        // One market, one BACK: straight to the transfer market, and its BACK lands here.
        market: () => openMarket(app, { backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app, undefined, tab) }),
        tab: (el) => {
          tab = el.dataset.v as HubTab;
          hubMemo.tab = tab;
          focus = true;
          draw();
        },
        md: (el) => {
          const md = Number(el.dataset.v);
          open = open === md ? -1 : md;
          draw();
          revealInPane(scr.panel.querySelector('.cr-others') ?? el);
        },
      },
    );
    if (focus) {
      focus = false;
      revealInPane(scr.panel.querySelector('.cr-scroll tr.you, .cr-scroll .mc-ys.next, .cr-scroll .cup-tie.next'), 'center');
    }
  };
  draw();
  if (flash) scr.toast(flash.msg, flash.kind);
}

/** Play what's next on the road: a BLOCKY CUP tie when one is due, otherwise the league matchday. */
export function playMatchday(app: AppContext, st: CareerState): void {
  const nm = nextMatch(st);
  const season = st.season;
  if (!nm || !season) return;
  if (nm.competition === 'cup') {
    playCupTie(app, st, nm);
    return;
  }
  const { md, userHome, rival } = nm;
  const seasonNo = season.number;
  const division = season.division;
  const stadium = st.stadium;
  // Home games at your ground; away games at the rival's (sized by division).
  const venue = userHome ? stadium : rivalStadiumLevel(division, rival);
  let ok = false;
  st.notice = null;
  closeMeta();
  app.startMatch({
    kind: 'career',
    home: nm.home,
    away: nm.away,
    kits: nm.kits,
    humanSide: userHome ? 0 : 1,
    difficulty: matchDifficulty(division),
    halfMinutes: app.save.settings.halfMinutes,
    attendance: matchAttendance(venue),
    stadiumLevel: venue,
    // Called once at full time: the table moves on here (as in the cup and Club Run), so the result is saved
    // with the match's coins. Closing the game on the full-time screen can't lose it or let the fixture be replayed.
    reward: (r) => {
      const cur = careerState(app);
      const [hg, ag] = r.score;
      ok = cur.season?.number === seasonNo && resolveMatchday(cur, app.save, md, hg, ag);
      const my = userHome ? r.score[0] : r.score[1];
      const their = userHome ? r.score[1] : r.score[0];
      return matchReward(division, stadium, my, their);
    },
    nextLabel: 'BACK TO THE ROAD',
    onDone: (r) => {
      const [hg, ag] = r.score;
      app.persist();
      const my = userHome ? hg : ag;
      const their = userHome ? ag : hg;
      const verdict = my > their ? 'WIN' : my === their ? 'DRAW' : 'LOSS';
      // A plain-text toast: the score reads "2:1" (no dash: see ui/text.ts) and facts are split with a slash.
      returnToCareer(app, ok ? { msg: `${verdict} ${my}:${their} VS ${rival.short} / TABLE UPDATED`, kind: my > their ? 'good' : my === their ? 'info' : 'bad' } : undefined);
    },
    quitNote: 'Walking off counts as a 3:0 defeat in the league table.',
    onQuit: () => {
      const cur = careerState(app);
      const [hg, ag] = forfeitScore(userHome);
      if (cur.season?.number === seasonNo && resolveMatchday(cur, app.save, md, hg, ag, true)) {
        cur.notice = `You walked off against ${rival.name}: a 3:0 defeat.`;
      }
      app.persist();
      returnToCareer(app);
    },
  });
}

/**
 * A BLOCKY CUP tie: a knockout match (level after 90 goes to the shootout). The QF and SF are at the home side's
 * ground, the final at the big bowl. Settled at full time like a league match, so the result is saved with its coins.
 */
function playCupTie(app: AppContext, st: CareerState, nm: NextMatch): void {
  const season = st.season!;
  const { userHome, rival, neutral } = nm;
  const round = nm.cupRound;
  const seasonNo = season.number;
  const division = season.division;
  const stadium = st.stadium;
  const venue = neutral ? STADIUM_MAX : userHome ? stadium : rivalStadiumLevel(nm.rivalDivision, rival);
  const hs: Side = userHome ? 0 : 1;
  const them: Side = userHome ? 1 : 0;
  let outcome: TieOutcome | null = null;
  // Only ever apply a result to the season and round it was played in.
  const current = (): CareerState | null => {
    const cur = careerState(app);
    return cur.season?.number === seasonNo && cupDue(cur) === round ? cur : null;
  };
  st.notice = null;
  closeMeta();
  app.startMatch({
    kind: 'career',
    home: nm.home,
    away: nm.away,
    kits: nm.kits,
    humanSide: hs,
    difficulty: matchDifficulty(division),
    halfMinutes: app.save.settings.halfMinutes,
    attendance: neutral ? 1 : matchAttendance(venue),
    stadiumLevel: venue,
    // A cup final under the lights.
    timeOfDay: neutral ? 'night' : undefined,
    knockout: true,
    reward: (r) => {
      const my = r.score[hs];
      const their = r.score[them];
      const won = r.winner !== undefined ? r.winner === hs : my > their;
      const so = r.match?.shootout;
      const pens: [number, number] | null = so && so.winner >= 0 ? [goalsOf(so.kicks[hs]), goalsOf(so.kicks[them])] : null;
      const cur = current();
      outcome = cur ? resolveCupTie(cur, my, their, won, pens) : null;
      return cupTieReward(division, stadium, my, their, outcome);
    },
    nextLabel: 'BACK TO THE ROAD',
    onDone: () => {
      app.persist();
      const o = outcome as TieOutcome | null;
      // (Winning the final: the trophy lift says it all.)
      let flash: Flash | undefined;
      if (o && !o.trophy) {
        flash = o.won
          ? { msg: `THROUGH TO THE ${ROUND_NAMES[Math.min(2, round + 1)]}!`, kind: 'good' }
          : { msg: `KNOCKED OUT BY ${rival.short} / THE LEAGUE GOES ON`, kind: 'bad' };
      }
      // Back on the draw, to see who else went through.
      returnToCareer(app, flash, 'cup');
    },
    quitNote: "Walking off counts as a 3:0 defeat: you're out of the cup.",
    onQuit: () => {
      const cur = current();
      if (cur && resolveCupTie(cur, 0, 3, false)) {
        cur.notice = `You walked off against ${rival.name}: out of the Blocky Cup. The league goes on.`;
      }
      app.persist();
      returnToCareer(app);
    },
  });
}

/** The season's end on one screen: the verdict and the prize money left, the final table right, START pinned below. */
function seasonSummary(app: AppContext, st: CareerState): void {
  const sum = st.summary!;
  const season = st.season!;
  const scr = mountMeta(app, 'mc-summary-screen shell');
  const info = new Map(leagueClubs(st).map((c) => [c.id, c]));
  const table = leagueTable(st);
  const [title, cls] = sum.champion
    ? ['CHAMPIONS!', 'champ']
    : sum.outcome === 'promoted'
      ? ['PROMOTED!', 'up']
      : sum.outcome === 'relegated'
        ? ['RELEGATED', 'down']
        : ['SEASON OVER', 'stay'];
  const next = DIVISION_NAMES[sum.nextDivision];
  const move = sum.outcome === 'promoted' ? `UP TO THE ${next}` : sum.outcome === 'relegated' ? `DOWN TO THE ${next}` : `STAYING IN THE ${next}`;
  const lines = sum.lines.length
    ? sum.lines.map((l) => `<div><span>${l.label}</span><b><i></i>+${fmt(l.coins)}</b></div>`).join('')
    : '<div><span>NO PRIZE MONEY</span><b><i></i>+0</b></div>';
  const past = st.history
    .slice(-5)
    .reverse()
    .map((h) => {
      // A BLOCKY CUP win shows as a trophy on its season.
      const cupWon = h.cup === 3 ? pixelIcon('trophy', 'currentColor', 1.6, 'inl') : '';
      return `<span class="mc-hist ${h.outcome}">S${h.season}${sep()}DIV ${h.division}${sep()}${ordinal(h.position)}${cupWon}</span>`;
    })
    .join('');
  // The season's cup run, under the league result (prize money already paid tie by tie).
  const cup = season.cup;
  const cupLine =
    sum.cup !== undefined
      ? `<div class="cup-sumline${sum.cup === 3 ? ' won' : ''}">${pixelIcon('trophy', sum.cup === 3 ? '#26262e' : '#b9b5aa', 2)}<span>BLOCKY CUP</span><b>${cupFinishText(sum.cup)}</b>${
          cup && cup.earned > 0 ? `<em>+${fmt(cup.earned)}</em>` : ''
        }</div>`
      : '';
  scr.render(
    `${topBar('MENU', `SEASON ${sum.season}`, 'FINAL WHISTLE', app.save.coins)}
    <div class="mc-body cr-body cr-sum">
      <section class="pane cr-main">
        <div class="mc-result ${cls}">
          <b>${title}</b>
          <span>${ordinal(sum.position)} OF ${CLUBS_PER_DIVISION}${sep()}${DIVISION_NAMES[sum.division]}</span>
          <em>${move}</em>
        </div>
        ${cupLine}
        <div class="mc-prize">${lines}<div class="total"><span>PRIZE MONEY</span><b><i></i>+${fmt(sum.prize)}</b></div></div>
      </section>
      <section class="pane cr-side">
        <div class="pane-h">FINAL TABLE</div>
        <div class="pane-scroll cr-scroll" data-scroll-key="cr-sum">${tableHtml(table, info, season.division)}${past ? `<div class="mc-histrow">${past}</div>` : ''}</div>
      </section>
    </div>
    <div class="mc-actions">
      <span class="cr-carry">SQUAD, COINS AND ${esc(STADIUM_NAMES[st.stadium])} CARRY OVER</span>
      <button class="btn btn-go btn-lg" data-a="next">START SEASON ${sum.season + 1}</button>
    </div>`,
    {
      back: () => toMenu(app),
      next: () => {
        const s = startNextSeason(st);
        app.persist();
        openCareer(app, s ? { msg: `SEASON ${s.number} / ${DIVISION_NAMES[s.division]}`, kind: 'info' } : undefined);
      },
    },
  );
  revealInPane(scr.panel.querySelector('.cr-scroll tr.you'), 'center');
  sfx.coin();
}
