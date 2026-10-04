import type { AppContext, MatchRequest, Reward } from '../app';
import type { MatchResult } from './matchSession';
import { nextMatch } from '../meta/career';
import { runOf } from '../meta/run';
import { playMatchday } from '../ui/career';
import { careerState } from '../ui/club';
import { openMoments } from '../ui/moments';
import { resumeRunRequest } from '../ui/run';
import type { PendingMatch } from './matchRecovery';

/** Results can only settle the fixture/round the player actually left, including after importing another save. */
export function recoveryContext(app: AppContext, route: PendingMatch['route']): string {
  if (route === 'career') {
    const st = careerState(app), n = nextMatch(st);
    return JSON.stringify([st.seed, st.club?.name, st.club?.short, st.season?.seed, st.season?.number, n?.competition, n?.md, n?.cupRound, n?.stage, n?.rival.id]);
  }
  if (route === 'run') {
    const st = runOf(app.save);
    return JSON.stringify([st.active, st.seed, st.round, st.club, st.perks, st.offer]);
  }
  return '';
}

/** Build the original competition's real settlement callbacks without opening a menu or launching a new match. */
export function rebuildRecoveryRequest(app: AppContext, pending: PendingMatch,
  friendlyReward: (r: MatchResult, difficulty: number) => Reward): MatchRequest | null {
  if (pending.context !== undefined && pending.context !== recoveryContext(app, pending.route)) return null;
  let rebuilt: MatchRequest | null = null;
  const capture: AppContext = { ...app, startMatch: r => { rebuilt = r; } };
  if (pending.route === 'career') playMatchday(capture, careerState(app));
  else if (pending.route === 'run') rebuilt = resumeRunRequest(capture);
  else rebuilt = {
    ...pending.request,
    reward: r => friendlyReward(r, pending.request.difficulty),
    onDone: () => {
      app.mainMenu();
      if (pending.route === 'moment') openMoments(app, app.mainMenu);
    },
    onQuit: app.mainMenu,
  };
  const req = rebuilt as MatchRequest | null;
  if (!req || req.home.id !== pending.request.home.id || req.away.id !== pending.request.away.id || req.humanSide !== pending.request.humanSide) return null;
  // Saved setup wins over later preferences. Explicit undefined preserves a consumed decider replay offer.
  return { ...req, ...pending.request, decider: pending.request.decider };
}
