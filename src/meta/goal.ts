/**
 * NEXT GOAL: the one line on the hub that says what to do next, always present once you have a club. It picks the
 * single most relevant goal right now: a decider coming up, an academy prospect to promote, a board objective that
 * is close, a part of the ground you can build, the next legacy level or the next unlock. Tapping it goes there
 * (`go`, handled by main.ts). Pure, no DOM, nothing written back.
 */
import { MATCHDAYS, TOP_DIVISION, nextMatch, type CareerState } from './career';
import { boardView, finishGap } from './board';
import { nextBuild, partDef } from './ground';
import { legacyLevel, nextPerk } from './legacy';
import { storyTag } from './story';

export type GoalTarget = 'career' | 'board' | 'academy' | 'stadium' | 'market' | 'unlocks';

export interface NextGoal {
  text: string;
  go: GoalTarget;
  /** Pixel icon (ui/pixelIcons.ts). */
  icon: string;
}

/** The level unlock main.ts already works out (save.ts nextUnlock): the fallback when the road has nothing better. */
export interface UnlockHint {
  name: string;
  level: number;
  xpLeft: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The open board objective nearest to done, as a line and the matches it still needs (lower is closer). */
function objectiveGoal(state: CareerState): { goal: NextGoal; need: number } | null {
  let best: { goal: NextGoal; need: number } | null = null;
  const consider = (goal: NextGoal, need: number) => {
    if (!best || need < best.need) best = { goal, need };
  };
  for (const v of boardView(state)) {
    const o = v.obj;
    if (o.state !== 'open') continue;
    switch (o.kind) {
      case 'finish': {
        const g = finishGap(state, o.target);
        const left = MATCHDAYS - (state.season?.matchday ?? 0);
        const where = o.target === 1 ? 'GO TOP' : `GO ${v.short}`;
        if (g.inside) consider({ text: `STAY ${o.target === 1 ? 'TOP' : `IN THE ${v.short}`}: ${plural(left, 'MATCH', 'MATCHES')} TO PLAY`, go: 'career', icon: 'flag' }, 6);
        else consider({ text: `${plural(g.wins, 'WIN', 'WINS')} TO ${where}`, go: 'career', icon: 'flag' }, g.wins + 0.5);
        break;
      }
      case 'cup':
      case 'continental': {
        const need = v.need - v.have;
        const comp = o.kind === 'cup' ? 'CUP' : 'CONTINENTAL';
        const what = o.target === 3 ? `LIFTING THE ${comp}` : `THE ${comp} ${o.target === 1 ? 'SEMI FINAL' : 'FINAL'}`;
        consider({ text: `${plural(need, 'WIN', 'WINS')} FROM ${what}`, go: 'career', icon: 'trophy' }, need);
        break;
      }
      case 'cleanSheets':
        consider({ text: `${plural(v.need - v.have, 'MORE CLEAN SHEET', 'MORE CLEAN SHEETS')} FOR THE BOARD`, go: 'career', icon: 'shield' }, v.need - v.have);
        break;
      case 'goals':
        consider({ text: `${plural(v.need - v.have, 'MORE LEAGUE GOAL', 'MORE LEAGUE GOALS')} FOR THE BOARD`, go: 'career', icon: 'ball' }, Math.ceil((v.need - v.have) / 2));
        break;
      case 'wins':
        consider({ text: `${plural(v.need - v.have, 'MORE WIN', 'MORE WINS')} FOR THE BOARD`, go: 'career', icon: 'star' }, v.need - v.have);
        break;
      case 'bigWin':
        consider({ text: `WIN BY ${o.target} GOALS FOR THE BOARD`, go: 'career', icon: 'fire' }, 2);
        break;
      case 'derby':
        consider({ text: `${v.label}`, go: 'career', icon: 'fire' }, 1.5);
        break;
      case 'sign':
        consider({ text: v.label, go: 'market', icon: 'swap' }, 1.2);
        break;
      case 'academy':
        consider({ text: v.label, go: 'academy', icon: 'star' }, 1);
        break;
    }
  }
  return best;
}

/**
 * The single most relevant goal now, or null when there is no club yet (the hero card says CREATE YOUR CLUB) or the
 * season's summary is waiting (the hero says so).
 */
export function nextGoal(state: CareerState | null, coins: number, unlock?: UnlockHint | null): NextGoal | null {
  if (!state?.club || !state.season || state.summary) return null;
  let nm: ReturnType<typeof nextMatch> = null;
  try {
    nm = nextMatch(state);
  } catch {
    nm = null;
  }
  // A decider (or a derby) next: that is the story.
  const tag = storyTag(state, nm);
  if (tag && tag.tone !== 'hot') return { text: tag.line, go: 'career', icon: tag.tone === 'gold' ? 'trophy' : 'shield' };
  if (state.academy.prospects.length && state.club.squad.length < 23) {
    return { text: `PROMOTE ${state.academy.prospects.length === 1 ? 'YOUR ACADEMY PROSPECT' : 'AN ACADEMY PROSPECT'}`, go: 'academy', icon: 'star' };
  }
  const obj = objectiveGoal(state);
  if (obj && obj.need <= 2) return obj.goal;
  const g = state.ground;
  const build = nextBuild(g);
  if (!g.building && build && coins >= build.cost) return { text: `BUILD THE ${build.name} NOW`, go: 'stadium', icon: 'flag' };
  if (tag) return { text: tag.line === 'THE FIRST DERBY' ? `DERBY DAY AGAINST ${nm?.rival.short ?? 'YOUR RIVALS'}` : `DERBY DAY: ${tag.line}`, go: 'career', icon: 'fire' };
  if (obj) return obj.goal;
  if (g.building) {
    const left = g.building.left;
    return { text: `THE ${partDef(g.building.id).steps[g.building.level - 1]?.name ?? 'NEW PART'} OPENS AFTER ${plural(left, 'MATCH', 'MATCHES')}`, go: 'stadium', icon: 'clock' };
  }
  if (build) return { text: `${fmt(build.cost - coins)} COINS TO BUILD THE ${build.name}`, go: 'stadium', icon: 'flag' };
  if (state.season.division === TOP_DIVISION && state.legacy.trebles === 0) return { text: 'THE DREAM: LEAGUE, CUP AND CONTINENTAL IN ONE SEASON', go: 'board', icon: 'crown' };
  const lv = legacyLevel(state.legacy.points);
  const perk = nextPerk(state.legacy.points);
  if (perk) return { text: `${fmt(lv.next - state.legacy.points)} LEGACY TO LEVEL ${lv.level + 1}`, go: 'board', icon: 'crown' };
  if (unlock) return { text: `LEVEL ${unlock.level} UNLOCKS THE ${unlock.name.toUpperCase()}`, go: 'unlocks', icon: 'gift' };
  return { text: `${fmt(lv.next - state.legacy.points)} LEGACY TO LEVEL ${lv.level + 1}`, go: 'board', icon: 'crown' };
}
