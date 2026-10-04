/**
 * Dev-only hooks for testing ROAD TO GLORY's long game from the browser console (never in a production build: ui/career.ts
 * imports this only when import.meta.env.DEV). `__road.play(3)` plays the next three matches (cup ties and the
 * Continental / World Club Cups too), `__road.seasonEnd()` plays to the summary, `__road.elite()` starts a season in
 * the Elite League (with the Continental Cup), `__road.coins(20000)`, `__road.intake()` brings an academy intake,
 * `__road.age()` makes three veterans 36 (they retire at the season's end), `__road.open()` reopens the hub.
 * The long game: `__road.unlock()` opens every feature, `__road.injure()` injures a starter (with his card),
 * `__road.scout('south')` hires a scout and brings his report in, `__road.sad()` makes a good bench player want a
 * game, `__road.board(20)` sets the board's confidence, `__road.sim()` sims the next match if it can be.
 */
import type { AppContext } from '../app';
import {
  TOP_DIVISION, YOU, compsDue, cupDue, newSeason, resolveCompTie, resolveCupTie, resolveMatchday, userFixture, type CareerState,
} from '../meta/career';
import { academyIntake, type LifePlayer } from '../meta/life';
import { injuryCard } from '../meta/events';
import { GEM_PRICES } from '../meta/gems';
import type { GrowPlayer } from '../meta/growth';
import { hireStaff, tickScouts, type RegionId } from '../meta/staff';
import { benchInjured, openAll, simMatch } from '../meta/week';
import { openCareer } from './career';
import { careerState } from './club';

function app(): AppContext {
  return (window as unknown as { __bl: { app: AppContext } }).__bl.app;
}

function st(): CareerState {
  return careerState(app());
}

function playOne(s: CareerState, my: number, their: number): boolean {
  if (cupDue(s) >= 0) return !!resolveCupTie(s, my, their, my >= their);
  if (compsDue(s)) return !!resolveCompTie(s, my, their, my >= their);
  const season = s.season;
  if (!season || s.summary) return false;
  const f = userFixture(season, season.matchday);
  if (!f) return false;
  const home = f.home === YOU;
  return resolveMatchday(s, app().save, season.matchday, home ? my : their, home ? their : my);
}

export const devRoad = {
  play(n = 1, my = 2, their = 0): void {
    const s = st();
    for (let i = 0; i < n; i++) if (!playOne(s, my, their)) break;
    app().persist();
    openCareer(app());
  },
  seasonEnd(my = 2, their = 0): void {
    const s = st();
    for (let i = 0; i < 40 && !s.summary; i++) if (!playOne(s, my, their)) break;
    app().persist();
    openCareer(app());
  },
  elite(): void {
    const s = st();
    newSeason(s, TOP_DIVISION, (s.season?.number ?? 0) + 1);
    app().persist();
    openCareer(app());
  },
  coins(n = 20000): void {
    app().save.coins += n;
    app().persist();
    openCareer(app());
  },
  intake(): void {
    const s = st();
    s.academy.season = 0;
    academyIntake(s);
    app().persist();
    openCareer(app(), undefined, 'club');
  },
  age(): void {
    const s = st();
    for (const p of (s.club?.squad ?? []).slice(1, 4) as LifePlayer[]) {
      p.age = 36;
      p.apps = 70;
    }
    app().persist();
  },
  open(): void {
    openCareer(app());
  },
  /** Everything the long game adds, open now (as a manager a season in). */
  unlock(): void {
    const s = st();
    openAll(s);
    s.events.played = Math.max(s.events.played, 20);
    app().persist();
    openCareer(app());
  },
  /** A starter picks up a knock: out for `weeks` matches, his card waiting on the hub. */
  injure(weeks = 3, idx = 9): void {
    const s = st();
    const p = s.club?.squad[idx] as GrowPlayer | undefined;
    if (!p) return;
    p.inj = weeks;
    benchInjured(s);
    injuryCard(s, p, weeks, false, GEM_PRICES.healPlayer);
    app().persist();
    openCareer(app());
  },
  /** Hire a scout for a region (free) and bring his first report in. */
  scout(region: RegionId = 'south'): void {
    const s = st();
    openAll(s);
    const wallet = { coins: 1e6 };
    hireStaff(s, wallet, s.staff.hired.scout1 ? 'scout2' : 'scout1', region);
    for (const slot of ['scout1', 'scout2'] as const) if (s.staff.hired[slot]) s.staff.due[slot] = 1;
    tickScouts(s);
    app().persist();
    openCareer(app());
  },
  /** A bench player as good as the starters who has sat out six matches and is not happy about it. */
  sad(): void {
    const s = st();
    const club = s.club;
    if (!club) return;
    const p = club.squad[12] as GrowPlayer;
    const starter = club.squad.slice(0, 11).find((q) => q.role === p.role) ?? club.squad[5];
    p.stats = { ...starter.stats };
    p.mor = 30;
    p.sat = 6;
    p.age = 25;
    app().persist();
    openCareer(app());
  },
  /** The board's confidence (20 brings its ultimatum after the next match). */
  board(confidence = 20): void {
    st().board.confidence = Math.max(0, Math.min(100, confidence));
    app().persist();
    openCareer(app());
  },
  sim(): void {
    const r = simMatch(st(), app().save);
    app().persist();
    openCareer(app(), r ? { msg: `SIM ${r.my}:${r.their}`, kind: 'info' } : { msg: 'CAN NOT SIM THIS ONE', kind: 'bad' });
  },
};
