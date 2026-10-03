/**
 * Career screens: hub (next match, table, fixtures), match launch and the season summary. Transfers live in one
 * place, the market (ui/market.ts): the hub's MARKET button opens it and its BACK returns here.
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
import type { Side } from '../sim/types';
import { careerState, closeMeta, clubCreate, esc, fmt, mountMeta, openClub, topBar, type ToastKind } from './club';
import { cupFinishText, cupSeasonRow, cupTabHtml, cupTrophyScreen } from './cup';
import { openMarket } from './market';
import { DIFFICULTIES, shirtArt } from './menus';
import { pixelIcon } from './pixelIcons';
import { roadIntro } from './roadIntro';
import { scoreHtml, sep } from './text';

type HubTab = 'table' | 'fixtures' | 'cup';

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
  careerHub(app, st, tab ?? (cupDue(st) >= 0 ? 'cup' : 'table'), flash);
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

function fixturesHtml(st: CareerState, season: SeasonState, info: Map<string, LeagueClub>, mdView: number): string {
  const cup = season.cup;
  const cupClubMap = cup ? cupClubs(st) : null;
  const due = cupDue(st);
  // The cup round that comes after this league matchday (QF after MD2...), as its own row in YOUR SEASON.
  const cupAfter = (md: number): string => {
    const r = CUP_AFTER.findIndex((n) => n === md + 1);
    return cup && cupClubMap && r >= 0 ? cupSeasonRow(cup, r, cupClubMap, due === r) : '';
  };
  const day = season.fixtures.filter((f) => f.md === mdView);
  const status = mdView < season.matchday ? 'FULL TIME' : mdView === season.matchday ? 'NEXT UP' : 'UPCOMING';
  const rows = day
    .map((f) => {
      const you = f.home === YOU || f.away === YOU;
      return `<div class="mc-fx ${you ? 'you' : ''}">
        <span class="h">${clubNames(info.get(f.home))}${kitDot(info.get(f.home))}</span>
        ${fixtureScore(f)}
        <span class="a">${kitDot(info.get(f.away))}${clubNames(info.get(f.away))}</span>
      </div>`;
    })
    .join('');
  const mine = season.fixtures
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
      return `<div class="mc-ys ${f.md === season.matchday && due < 0 ? 'next' : ''}">
        <span class="mc-ysmd">MD${f.md + 1}</span>
        <span class="mc-chip ${home ? 'home' : 'away'}">${home ? 'H' : 'A'}</span>
        <span class="mc-ysopp">${kitDot(opp)}${clubNames(opp)}</span>
        ${fixtureScore(f)}
        ${res}
      </div>${cupAfter(f.md)}`;
    })
    .join('');
  return `<div class="mc-pager">
      <button class="arrow" data-a="mdprev" ${mdView <= 0 ? 'disabled' : ''} aria-label="Previous matchday">←</button>
      <b>MATCHDAY ${mdView + 1}<small>${status}</small></b>
      <button class="arrow" data-a="mdnext" ${mdView >= MATCHDAYS - 1 ? 'disabled' : ''} aria-label="Next matchday">→</button>
    </div>
    <div class="mc-fxlist">${rows}</div>
    <h3 class="mc-h">YOUR SEASON</h3>
    <div class="mc-fxlist">${mine}</div>`;
}

/** The next-match card for a BLOCKY CUP tie: the round, both clubs with their divisions, and what's at stake. */
function cupCard(st: CareerState, nm: NextMatch): string {
  const club = st.club!;
  const division = st.season!.division;
  const youKit = nm.userHome ? nm.kits[0] : nm.kits[1];
  const themKit = nm.userHome ? nm.kits[1] : nm.kits[0];
  const side = (kit: typeof youKit, short: string, name: string, meta: string) =>
    `<div class="mc-side">${shirtArt(kit, 6)}<b>${esc(short)}</b><small>${esc(name)}</small><em>${meta}</em></div>`;
  const you = side(youKit, club.short, club.name, `OVR ${clubRating(club)}${sep()}DIV ${division}`);
  const them = side(themKit, nm.rival.short, nm.rival.name, `OVR ${nm.rival.rating}${sep()}DIV ${nm.rivalDivision}`);
  const round = ROUND_NAMES[nm.cupRound];
  const venue = nm.neutral ? '<span class="mc-chip">NEUTRAL</span>' : `<span class="mc-chip ${nm.userHome ? 'home' : 'away'}">${nm.userHome ? 'HOME' : 'AWAY'}</span>`;
  const prize = cupPrize(nm.cupRound, true, division);
  const stake = nm.cupRound === 2 ? `LIFT THE CUP +${fmt(prize)}` : `GO THROUGH +${fmt(prize)}`;
  return `<section class="mc-next cup-next">
      <div class="mc-nexttop">
        <span class="mc-chip cup">${pixelIcon('trophy', 'currentColor', 1.6, 'inl')}BLOCKY CUP</span>
        <span>${round}</span>
        ${venue}
      </div>
      <div class="mc-vs">${nm.userHome ? you : them}<div class="mc-vsx">VS</div>${nm.userHome ? them : you}</div>
      <button class="btn btn-go btn-lg mc-play" data-a="play">PLAY THE ${round}</button>
      <p class="mc-pay">${stake}${sep()}LEVEL AFTER 90 MEANS PENALTIES${sep()}LOSE AND YOU'RE OUT${sep()}AI ${DIFFICULTIES[matchDifficulty(division)]}</p>
    </section>`;
}

function careerHub(app: AppContext, st: CareerState, tab0: HubTab, flash?: Flash): void {
  const scr = mountMeta(app, 'mc-career-screen');
  const club = st.club!;
  let tab = tab0;
  let mdView = Math.min(MATCHDAYS - 1, Math.max(0, (st.season?.matchday ?? 1) - 1));
  const draw = () => {
    const season = st.season!;
    const nm = nextMatch(st);
    const info = new Map(leagueClubs(st).map((c) => [c.id, c]));
    const table = leagueTable(st);
    const pos = table.findIndex((r) => r.id === YOU) + 1;
    const pay = payTable(season.division, st.stadium);
    let next = '';
    if (nm && nm.competition === 'cup') {
      next = cupCard(st, nm);
    } else if (nm) {
      const youKit = nm.userHome ? nm.kits[0] : nm.kits[1];
      const themKit = nm.userHome ? nm.kits[1] : nm.kits[0];
      const rivalPos = table.findIndex((r) => r.id === nm.rival.id) + 1;
      const side = (kit: typeof youKit, short: string, name: string, meta: string) =>
        `<div class="mc-side">${shirtArt(kit, 6)}<b>${esc(short)}</b><small>${esc(name)}</small><em>${meta}</em></div>`;
      // League position only means something once a ball has been kicked.
      const place = (p: number) => (season.matchday > 0 ? `${sep()}${ordinal(p)}` : '');
      const you = side(youKit, club.short, club.name, `OVR ${clubRating(club)}${place(pos)}`);
      const them = side(themKit, nm.rival.short, nm.rival.name, `OVR ${nm.rival.rating}${place(rivalPos)}`);
      next = `<section class="mc-next">
        <div class="mc-nexttop">
          <span class="mc-chip div">DIV ${season.division}</span>
          <span>MATCHDAY ${nm.md + 1}/${MATCHDAYS}</span>
          <span class="mc-chip ${nm.userHome ? 'home' : 'away'}">${nm.userHome ? 'HOME' : 'AWAY'}</span>
        </div>
        <div class="mc-vs">${nm.userHome ? you : them}<div class="mc-vsx">VS</div>${nm.userHome ? them : you}</div>
        <button class="btn btn-go btn-lg mc-play" data-a="play">PLAY MATCHDAY ${nm.md + 1}</button>
        <p class="mc-pay">WIN +${fmt(pay.win)}${sep()}DRAW +${fmt(pay.draw)}${sep()}LOSS +${fmt(pay.loss)}${sep()}+${pay.goal} PER GOAL${sep()}AI ${DIFFICULTIES[matchDifficulty(season.division)]}</p>
      </section>`;
    }
    const body = tab === 'table' ? tableHtml(table, info, season.division) : tab === 'cup' ? cupTabHtml(st) : fixturesHtml(st, season, info, mdView);
    const tabs: [HubTab, string][] = [['table', 'TABLE'], ['fixtures', 'FIXTURES'], ['cup', 'BLOCKY CUP']];
    // Market news the club made itself and nobody has read (openMarket marks them seen, so a visit clears it).
    const unread = marketUnread(st);
    scr.render(
      `${topBar('MENU', 'ROAD TO GLORY', `SEASON ${season.number}${sep()}${DIVISION_NAMES[season.division]}`, app.save.coins)}
      ${st.notice ? `<div class="mc-notice"><p>${esc(st.notice)}</p><button class="btn btn-white" data-a="dismiss">OK</button></div>` : ''}
      ${next}
      <div class="mc-quick">
        <button class="btn btn-yellow" data-a="squad">SQUAD</button>
        <button class="btn btn-white" data-a="train">TRAINING</button>
        <button class="btn btn-white" data-a="stadium">STADIUM<span class="mc-lv">${sep()}LV ${st.stadium}</span></button>
        <button class="btn btn-white mc-marketbtn" data-a="market" aria-label="Transfer market${unread ? `, ${unread} unread` : ''}">MARKET${unread ? `<b class="mc-badge">${unread}</b>` : ''}</button>
      </div>
      <div class="mc-tabrow">
        <div class="seg mc-tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>
        <button class="btn btn-white mc-how" data-a="how">HOW IT WORKS</button>
      </div>
      ${body}`,
      {
        back: () => toMenu(app),
        dismiss: () => {
          st.notice = null;
          app.persist();
          draw();
        },
        play: () => playMatchday(app, st),
        how: () => roadIntro(app, { first: false, onGo: () => openCareer(app, undefined, tab), onBack: () => openCareer(app, undefined, tab) }),
        squad: () => openClub(app, { tab: 'squad', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app) }),
        train: () => openClub(app, { tab: 'train', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app) }),
        stadium: () => openClub(app, { tab: 'stadium', backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app) }),
        // One market, one BACK: straight to the transfer market, and its BACK lands here.
        market: () => openMarket(app, { backLabel: 'ROAD TO GLORY', onBack: () => openCareer(app) }),
        tab: (el) => {
          tab = el.dataset.v as HubTab;
          draw();
        },
        mdprev: () => {
          mdView = Math.max(0, mdView - 1);
          draw();
        },
        mdnext: () => {
          mdView = Math.min(MATCHDAYS - 1, mdView + 1);
          draw();
        },
      },
    );
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
    quitNote: 'Walking off counts as a 3-0 defeat in the league table.',
    onQuit: () => {
      const cur = careerState(app);
      const [hg, ag] = forfeitScore(userHome);
      if (cur.season?.number === seasonNo && resolveMatchday(cur, app.save, md, hg, ag, true)) {
        cur.notice = `You quit against ${rival.name}. Walking off counts as a 3-0 forfeit defeat.`;
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
    quitNote: "Walking off counts as a 3-0 defeat: you're out of the cup.",
    onQuit: () => {
      const cur = current();
      if (cur && resolveCupTie(cur, 0, 3, false)) {
        cur.notice = `You quit against ${rival.name}. Walking off counts as a 3-0 defeat: you're out of the Blocky Cup. The league goes on.`;
      }
      app.persist();
      returnToCareer(app);
    },
  });
}

function seasonSummary(app: AppContext, st: CareerState): void {
  const sum = st.summary!;
  const season = st.season!;
  const scr = mountMeta(app, 'mc-summary-screen');
  const info = new Map(leagueClubs(st).map((c) => [c.id, c]));
  const table = leagueTable(st);
  const [title, cls] = sum.champion
    ? ['CHAMPIONS!', 'champ']
    : sum.outcome === 'promoted'
      ? ['PROMOTED!', 'up']
      : sum.outcome === 'relegated'
        ? ['RELEGATED', 'down']
        : ['SEASON OVER', 'stay'];
  const move =
    sum.outcome === 'promoted'
      ? `▲ UP TO THE ${DIVISION_NAMES[sum.nextDivision]}`
      : sum.outcome === 'relegated'
        ? `▼ DOWN TO THE ${DIVISION_NAMES[sum.nextDivision]}`
        : `STAYING IN THE ${DIVISION_NAMES[sum.nextDivision]}`;
  const lines = sum.lines.length
    ? sum.lines.map((l) => `<div><span>${l.label}</span><b><i></i>+${fmt(l.coins)}</b></div>`).join('')
    : '<div><span>NO PRIZE MONEY THIS TIME</span><b><i></i>+0</b></div>';
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
  const cupLine = sum.cup !== undefined
    ? `<div class="cup-sumline${sum.cup === 3 ? ' won' : ''}">${pixelIcon('trophy', sum.cup === 3 ? '#26262e' : '#b9b5aa', 3)}<span>BLOCKY CUP</span><b>${cupFinishText(sum.cup)}</b>${
      cup && cup.earned > 0 ? `<em>+${fmt(cup.earned)} WON</em>` : ''
    }</div>`
    : '';
  scr.render(
    `${topBar('MENU', `SEASON ${sum.season}`, 'FINAL WHISTLE', app.save.coins)}
    <div class="mc-result ${cls}">
      <b>${title}</b>
      <span>${ordinal(sum.position)} OF ${CLUBS_PER_DIVISION} IN THE ${DIVISION_NAMES[sum.division]}</span>
      <em>${move}</em>
    </div>
    ${cupLine}
    <div class="mc-prize">${lines}<div class="total"><span>PRIZE MONEY</span><b><i></i>+${fmt(sum.prize)}</b></div></div>
    ${tableHtml(table, info, season.division)}
    ${past ? `<h3 class="mc-h">HISTORY</h3><div class="mc-histrow">${past}</div>` : ''}
    <p class="mc-hint">Next season brings seven new rivals in the ${esc(DIVISION_NAMES[sum.nextDivision])} and a new Blocky Cup draw. Your squad, coins and ${esc(STADIUM_NAMES[st.stadium])} come with you.</p>
    <div class="btn-row"><button class="btn btn-go btn-lg" data-a="next">START SEASON ${sum.season + 1}</button></div>`,
    {
      back: () => toMenu(app),
      next: () => {
        const s = startNextSeason(st);
        app.persist();
        openCareer(app, s ? { msg: `SEASON ${s.number} / ${DIVISION_NAMES[s.division]}`, kind: 'info' } : undefined);
      },
    },
  );
  sfx.coin();
}
