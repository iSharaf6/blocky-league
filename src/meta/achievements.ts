/**
 * Game Center achievements (the iPhone / iPad app: platform/gameCenter.ts reports them). Pure: each one is read
 * straight off the save, so a player who earned something before the app had Game Center still gets it, and a
 * reinstall reports nothing twice that matters (Game Center keeps the best percent).
 *
 * The ids must match App Store Connect (Features, Game Center, Achievements) exactly; docs/APP_STORE.md lists them
 * with titles, descriptions and points, and store-assets/game-center/ holds the images. Points add up to 740 of
 * the 1000 Apple allows, leaving room for more later. Never rename or reuse an id once it is live.
 */
import { levelOf, type SaveData } from '../core/save';
import { MASTERY_THRESHOLDS, MASTERY_TITLES, masteryOf, TRACK_INFO, type MasteryTrack } from './mastery';
import { MOMENTS } from './moments';
import { RUN_ROUNDS } from './run';

export interface Achievement {
  id: string;
  title: string;
  /** What to do (Game Center's "before earning" line). */
  how: string;
  points: number;
  /** Progress towards it and the amount that completes it. */
  target: number;
  value(save: SaveData): number;
}

/** Mastery tiers I, III and V of each track (mastery.ts): its own title, 10 / 30 / 60 points. */
const MASTERY_TIERS_SHOWN = [[1, 10], [3, 30], [5, 60]] as const;

const UNIT_WORDS: { readonly [k in MasteryTrack]: string } = {
  finisher: 'goals',
  playmaker: 'playmaker points (assists, and one for every 10 passes)',
  wall: 'wall points (tackles won, and 3 for a clean sheet)',
  magician: 'skill moves and men beaten',
  keeper: 'saves by your keeper',
};

const mastery: Achievement[] = (Object.keys(MASTERY_THRESHOLDS) as MasteryTrack[]).flatMap((track) =>
  MASTERY_TIERS_SHOWN.map(([tier, points]) => {
    const target = MASTERY_THRESHOLDS[track][tier - 1];
    return {
      id: `bl.ach.${track}.${tier}`,
      title: MASTERY_TITLES[track][tier - 1],
      how: `${TRACK_INFO[track].name} badge: ${target} ${UNIT_WORDS[track]}.`,
      points,
      target,
      value: (s: SaveData) => masteryOf(s).counts[track],
    };
  }),
);

const threeStarred = (s: SaveData) => MOMENTS.filter((m) => (s.moments?.[m.id] ?? 0) >= 3).length;

const milestones: Achievement[] = [
  { id: 'bl.ach.first_win', title: 'First Win', how: 'Win a match.', points: 10, target: 1, value: (s) => s.record.won },
  { id: 'bl.ach.wins_50', title: 'Fifty Up', how: 'Win 50 matches.', points: 50, target: 50, value: (s) => s.record.won },
  { id: 'bl.ach.streak_5', title: 'On Fire', how: 'Win 5 matches in a row.', points: 30, target: 5, value: (s) => s.progress.bestStreak },
  { id: 'bl.ach.level_10', title: 'Rising Star', how: 'Reach level 10.', points: 30, target: 10, value: (s) => levelOf(s.progress.xp).level },
  {
    id: 'bl.ach.run_champion', title: 'Run Champion', how: `Win all ${RUN_ROUNDS} matches of a Club Run.`, points: 60, target: RUN_ROUNDS,
    value: (s) => ((s.run?.cleared ?? 0) > 0 ? RUN_ROUNDS : (s.run?.best ?? 0)),
  },
  { id: 'bl.ach.moments_all', title: 'Moment Maker', how: 'Get three stars on every Moment.', points: 60, target: MOMENTS.length, value: threeStarred },
];

export const ACHIEVEMENTS: readonly Achievement[] = [...milestones, ...mastery];

/** Every achievement the save has made any progress on, as a whole percent (100 = earned). */
export function achievementProgress(save: SaveData): { id: string; percent: number }[] {
  const out: { id: string; percent: number }[] = [];
  for (const a of ACHIEVEMENTS) {
    const v = Number(a.value(save)) || 0;
    const percent = Math.min(100, Math.floor((Math.max(0, v) / a.target) * 100));
    if (percent > 0) out.push({ id: a.id, percent });
  }
  return out;
}
