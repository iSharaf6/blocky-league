/**
 * Dev-only hooks for testing ROAD TO GLORY's long game from the browser console (never in a production build: ui/career.ts
 * imports this only when import.meta.env.DEV). `__road.play(3)` plays the next three matches (cup ties and the
 * Continental / World Club Cups too), `__road.seasonEnd()` plays to the summary, `__road.elite()` starts a season in
 * the Elite League (with the Continental Cup), `__road.coins(20000)`, `__road.intake()` brings an academy intake,
 * `__road.age()` makes three veterans 36 (they retire at the season's end), `__road.open()` reopens the hub.
 */
import type { AppContext } from '../app';
import {
  TOP_DIVISION, YOU, compsDue, cupDue, newSeason, resolveCompTie, resolveCupTie, resolveMatchday, userFixture, type CareerState,
} from '../meta/career';
import { academyIntake, type LifePlayer } from '../meta/life';
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
};
