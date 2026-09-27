/**
 * Career screens: hub (next match, table, fixtures), match launch and the season summary. Transfers live in one
 * place, the market (ui/market.ts): the hub's MARKET button opens it and its BACK returns here.
 * Rules live in meta/career.ts; this file only renders and wires them to AppContext.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import {
  BOTTOM_DIVISION, CLUBS_PER_DIVISION, DIVISION_NAMES, MATCHDAYS, STADIUM_NAMES, TOP_DIVISION, YOU,
  clubRating, finishSeason, forfeitScore, leagueClubs, leagueTable, matchAttendance, matchDifficulty,
  matchReward, newSeason, nextMatch, payTable, refreshMarket, resolveMatchday, rivalStadiumLevel, startNextSeason,
  type CareerState, type Fixture, type LeagueClub, type SeasonState, type TableRow,
} from '../meta/career';
import { marketUnread } from '../meta/market';
import { cssHex } from '../render/palette';
import { careerState, closeMeta, clubCreate, esc, fmt, mountMeta, openClub, topBar, type ToastKind } from './club';
import { openMarket } from './market';
import { DIFFICULTIES, shirtArt } from './menus';
import { scoreHtml, sep } from './text';

type HubTab = 'table' | 'fixtures';

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
function returnToCareer(app: AppContext, flash?: Flash): void {
  app.mainMenu();
  openCareer(app, flash);
}

/** Entry point from the main menu (and the return point after every career match). */
export function openCareer(app: AppContext, flash?: Flash, tab: HubTab = 'table'): void {
  const st = careerState(app);
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
  if (st.summary) {
    seasonSummary(app, st);
    return;
  }
  refreshMarket(st);
  careerHub(app, st, tab, flash);
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
  const upLabel = division > TOP_DIVISION ? 'PROMOTION' : 'TOP-TWO PRIZE';
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

function fixturesHtml(season: SeasonState, info: Map<string, LeagueClub>, mdView: number): string {
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
      return `<div class="mc-ys ${f.md === season.matchday ? 'next' : ''}">
        <span class="mc-ysmd">MD${f.md + 1}</span>
        <span class="mc-chip ${home ? 'home' : 'away'}">${home ? 'H' : 'A'}</span>
        <span class="mc-ysopp">${kitDot(opp)}${clubNames(opp)}</span>
        ${fixtureScore(f)}
        ${res}
      </div>`;
    })
    .join('');
  return `<div class="mc-pager">
      <button class="arrow" data-a="mdprev" ${mdView <= 0 ? 'disabled' : ''} aria-label="Previous matchday">◀</button>
      <b>MATCHDAY ${mdView + 1}<small>${status}</small></b>
      <button class="arrow" data-a="mdnext" ${mdView >= MATCHDAYS - 1 ? 'disabled' : ''} aria-label="Next matchday">▶</button>
    </div>
    <div class="mc-fxlist">${rows}</div>
    <h3 class="mc-h">YOUR SEASON</h3>
    <div class="mc-fxlist">${mine}</div>`;
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
    if (nm) {
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
    const body = tab === 'table' ? tableHtml(table, info, season.division) : fixturesHtml(season, info, mdView);
    const tabs: [HubTab, string][] = [['table', 'TABLE'], ['fixtures', 'FIXTURES']];
    // Market news the club made itself and nobody has read (openMarket marks them seen, so a visit clears it).
    const unread = marketUnread(st);
    scr.render(
      `${topBar('MENU', 'CAREER', `SEASON ${season.number}${sep()}${DIVISION_NAMES[season.division]}`, app.save.coins)}
      ${st.notice ? `<div class="mc-notice"><p>${esc(st.notice)}</p><button class="btn btn-white" data-a="dismiss">OK</button></div>` : ''}
      ${next}
      <div class="mc-quick">
        <button class="btn btn-yellow" data-a="squad">SQUAD</button>
        <button class="btn btn-white" data-a="train">TRAINING</button>
        <button class="btn btn-white" data-a="stadium">STADIUM<span class="mc-lv">${sep()}LV ${st.stadium}</span></button>
        <button class="btn btn-white mc-marketbtn" data-a="market" aria-label="Transfer market${unread ? `, ${unread} unread` : ''}">MARKET${unread ? `<b class="mc-badge">${unread}</b>` : ''}</button>
      </div>
      <div class="seg mc-tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}`,
      {
        back: () => toMenu(app),
        dismiss: () => {
          st.notice = null;
          app.persist();
          draw();
        },
        play: () => playMatchday(app, st),
        squad: () => openClub(app, { tab: 'squad', backLabel: 'CAREER', onBack: () => openCareer(app) }),
        train: () => openClub(app, { tab: 'train', backLabel: 'CAREER', onBack: () => openCareer(app) }),
        stadium: () => openClub(app, { tab: 'stadium', backLabel: 'CAREER', onBack: () => openCareer(app) }),
        // One market, one BACK: straight to the transfer market, and its BACK lands here.
        market: () => openMarket(app, { backLabel: 'CAREER', onBack: () => openCareer(app) }),
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

function playMatchday(app: AppContext, st: CareerState): void {
  const nm = nextMatch(st);
  const season = st.season;
  if (!nm || !season) return;
  const { md, userHome, rival } = nm;
  const seasonNo = season.number;
  const division = season.division;
  const stadium = st.stadium;
  // Home games at your ground; away games at the rival's (sized by division).
  const venue = userHome ? stadium : rivalStadiumLevel(division, rival);
  st.notice = null;
  closeMeta();
  app.startMatch({
    home: nm.home,
    away: nm.away,
    kits: nm.kits,
    humanSide: userHome ? 0 : 1,
    difficulty: matchDifficulty(division),
    halfMinutes: app.save.settings.halfMinutes,
    attendance: matchAttendance(venue),
    stadiumLevel: venue,
    reward: (r) => {
      const my = userHome ? r.score[0] : r.score[1];
      const their = userHome ? r.score[1] : r.score[0];
      return matchReward(division, stadium, my, their);
    },
    nextLabel: 'BACK TO CAREER',
    onDone: (r) => {
      const cur = careerState(app);
      const [hg, ag] = r.score;
      const ok = cur.season?.number === seasonNo && resolveMatchday(cur, app.save, md, hg, ag);
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
    .map((h) => `<span class="mc-hist ${h.outcome}">S${h.season}${sep()}DIV ${h.division}${sep()}${ordinal(h.position)}</span>`)
    .join('');
  scr.render(
    `${topBar('MENU', `SEASON ${sum.season}`, 'FINAL WHISTLE', app.save.coins)}
    <div class="mc-result ${cls}">
      <b>${title}</b>
      <span>${ordinal(sum.position)} OF ${CLUBS_PER_DIVISION} IN THE ${DIVISION_NAMES[sum.division]}</span>
      <em>${move}</em>
    </div>
    <div class="mc-prize">${lines}<div class="total"><span>PRIZE MONEY</span><b><i></i>+${fmt(sum.prize)}</b></div></div>
    ${tableHtml(table, info, season.division)}
    ${past ? `<h3 class="mc-h">HISTORY</h3><div class="mc-histrow">${past}</div>` : ''}
    <p class="mc-hint">Next season brings seven new rivals in the ${esc(DIVISION_NAMES[sum.nextDivision])}. Your squad, coins and ${esc(STADIUM_NAMES[st.stadium])} come with you.</p>
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
