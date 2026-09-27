/**
 * Football Moments: the catalogue. Eight short scripted situations (15–90 seconds of play), easy to hard, three
 * stars apiece, each pointing at the next. They teach the controls (a first touch, a cross, a one-on-one),
 * fit a quick session, and make a shareable challenge ("come back from 2–0 down").
 *
 * The situations themselves are ScenarioSpecs (src/sim/types.ts) applied and judged by src/sim/scenario.ts;
 * this file is data plus the small rules the MOMENTS screen (src/ui/moments.ts) and the tests read: the
 * order, the unlock ladder (a moment opens once the previous one has a star), the XP a star pays, and the
 * star rule in words.
 *
 * Coordinates are in the human's attacking frame (+x towards the goal you shoot at; see scenario.ts).
 * The human is always side 0 (home) here, so his club's kit is worn and the AI is the away side.
 */
import { groundPassSpeed } from '../sim/ball';
import { HALF_L, HALF_W } from '../sim/constants';
import type { FullScenarioSpec } from '../sim/scenario';
import type { ScenarioSpec, Side } from '../sim/types';

export interface Moment {
  id: string;
  title: string;
  /** One line under the title (and the pre-play card). */
  brief: string;
  /** A glyph for the card. */
  icon: string;
  /** What a star pays, in words ("+25 XP a star"). */
  xpNote: string;
  /**
   * Controls reminder for the pre-play card (action names as HOW TO PLAY uses them; the key in brackets as a
   * {pass} / {shoot} / {through} / {sprint} / {power} token, filled with the player's own binding: see fillKeys).
   */
  tip: string;
  /** Preset clubs (indexes into PRESET_CLUBS) to play as / against; undefined = the player's own club / usual rival. */
  home?: number;
  away?: number;
  /** DIFFICULTIES index (0 easy .. 3 legend) for the AI. */
  difficulty: number;
  /** The moment after this one (null: the last). */
  next: string | null;
  spec: FullScenarioSpec;
}

/** XP a star pays (core/save.ts momentXp: 30 a try plus this a star; moments pay no coins). */
export const MOMENT_XP_PER_STAR = 25;

const HS: Side = 0;
const AI: Side = 1;
const GOAL_X = HALF_L;

type Placement = NonNullable<ScenarioSpec['players']>[number];
const at = (side: Side, slot: number, x: number, z: number, facing?: number): Placement =>
  facing === undefined ? { side, slot, x, z } : { side, slot, x, z, facing };

/** A ground pass rolling from (x0, z0) towards (x1, z1), arriving at `vArrive` m/s. */
function rolling(x0: number, z0: number, x1: number, z1: number, vArrive = 4): ScenarioSpec['ball'] {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const d = Math.hypot(dx, dz) || 1;
  const v = groundPassSpeed(d, vArrive);
  return { x: x0, z: z0, vx: (dx / d) * v, vz: (dz / d) * v };
}

const AI_KEEPER = at(AI, 0, GOAL_X - 1.2, 0, Math.PI);

export const MOMENTS: Moment[] = [
  {
    id: 'first-touch',
    title: 'FIRST TOUCH',
    brief: 'Take the pass and score from ten metres. 20 seconds.',
    icon: '⚽',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'The ball is rolling to your striker: let it come, then SHOOT ({shoot}) with the stick at a corner of the goal. Tap SHOOT again as the foot meets the ball for a perfect finish.',
    difficulty: 0,
    next: 'cross-finish',
    spec: {
      id: 'first-touch',
      title: 'FIRST TOUCH',
      brief: 'Take the pass and score from ten metres.',
      clock: 0,
      seconds: 20,
      score: [0, 0],
      humanSide: HS,
      difficulty: 0,
      players: [
        at(HS, 9, GOAL_X - 11, 0), at(HS, 7, GOAL_X - 24, -7), at(HS, 10, GOAL_X - 18, 9), at(HS, 8, GOAL_X - 22, 14),
        at(HS, 5, GOAL_X - 24, -18), at(HS, 6, GOAL_X - 34, 0),
        AI_KEEPER, at(AI, 2, GOAL_X - 24, -12, 0), at(AI, 3, GOAL_X - 24, 12, 0), at(AI, 1, GOAL_X - 28, 24, 0), at(AI, 4, GOAL_X - 28, -24, 0),
      ],
      ball: rolling(GOAL_X - 21, -6, GOAL_X - 11, 0),
      owner: null,
      goal: 'score',
      stars: [0, 8, 13],
    },
  },
  {
    id: 'cross-finish',
    title: 'CROSS & SCORE',
    brief: 'Your winger has it. Cross for the runner and score. 25 seconds.',
    icon: '↗',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Hold THROUGH ({through}) with the stick towards the box to cross; control switches to your striker as it comes in. Leave the stick to head it, or SHOOT ({shoot}) to head at goal.',
    difficulty: 0,
    next: 'one-on-one',
    spec: {
      id: 'cross-finish',
      title: 'CROSS & SCORE',
      brief: 'Cross for the runner and score.',
      clock: 0,
      seconds: 25,
      score: [0, 0],
      humanSide: HS,
      difficulty: 0,
      players: [
        at(HS, 8, GOAL_X - 20, 24), at(HS, 9, GOAL_X - 24, 4), at(HS, 10, GOAL_X - 28, -6), at(HS, 7, GOAL_X - 34, 8),
        at(HS, 6, GOAL_X - 36, -10), at(HS, 5, GOAL_X - 30, -22),
        AI_KEEPER, at(AI, 2, GOAL_X - 12, -4, 0), at(AI, 3, GOAL_X - 12, 8, 0), at(AI, 1, GOAL_X - 14, 19, 0), at(AI, 4, GOAL_X - 18, -16, 0),
      ],
      owner: { side: HS, slot: 8 },
      goal: 'score',
      stars: [0, 10, 16],
    },
  },
  {
    id: 'one-on-one',
    title: 'ONE ON ONE',
    brief: 'Through on goal from 25 metres, two defenders on your heels. 15 seconds.',
    icon: '🏃',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'SPRINT ({sprint}) at goal and shoot before they catch you: SHOOT ({shoot}) with the stick across the keeper, or hold SHOOT and tap THROUGH ({through}) to chip him.',
    difficulty: 1,
    next: 'corner-kick',
    spec: {
      id: 'one-on-one',
      title: 'ONE ON ONE',
      brief: 'Beat the keeper before the defenders catch you.',
      clock: 0,
      seconds: 15,
      score: [0, 0],
      humanSide: HS,
      difficulty: 1,
      players: [
        at(HS, 9, GOAL_X - 25, 0), at(HS, 10, GOAL_X - 40, -10), at(HS, 8, GOAL_X - 42, 18), at(HS, 5, GOAL_X - 42, -22),
        at(AI, 0, GOAL_X - 1.5, 0, Math.PI), at(AI, 2, GOAL_X - 29, -2.2, 0), at(AI, 3, GOAL_X - 29, 2.2, 0),
        at(AI, 1, GOAL_X - 36, 16, 0), at(AI, 4, GOAL_X - 36, -16, 0),
      ],
      owner: { side: HS, slot: 9 },
      goal: 'score',
      stars: [0, 5, 9],
    },
  },
  {
    id: 'corner-kick',
    title: 'CORNER KICK',
    brief: 'Score from a corner. 30 seconds of play (the wait for the kick is free).',
    icon: '⚑',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Aim with the stick and tap PASS ({pass}) to swing it in, or hold for a driven ball. As it drops, SHOOT ({shoot}) to head at goal, or push the stick to bring it down.',
    difficulty: 1,
    next: 'two-down',
    spec: {
      id: 'corner-kick',
      title: 'CORNER KICK',
      brief: 'Score from the corner.',
      clock: 0,
      seconds: 30,
      score: [0, 0],
      humanSide: HS,
      difficulty: 1,
      ball: { x: HALF_L - 0.35, z: HALF_W - 0.35 },
      restart: 'corner',
      goal: 'score',
      stars: [0, 12, 20],
    },
  },
  {
    id: 'two-down',
    title: 'TWO DOWN',
    brief: 'Two goals behind, a minute to play, the ball at your feet. Draw or better.',
    icon: '⏱',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Move it fast: PASS ({pass}) to the ringed man, THROUGH ({through}) for a runner, SHOOT ({shoot}) from anywhere near the box. Win the kick-off back after you score. A draw is one star, a win two.',
    difficulty: 0,
    next: 'hold-the-fort',
    spec: {
      id: 'two-down',
      title: 'TWO DOWN',
      brief: 'From 0–2, get level or better before time.',
      clock: 0,
      seconds: 60,
      score: [0, 2],
      humanSide: HS,
      difficulty: 0,
      // The last minute of a siege: your playmaker on the ball 30 m out, both strikers up, their block set.
      players: [
        at(HS, 8, GOAL_X - 30, 0), at(HS, 9, GOAL_X - 18, -8), at(HS, 10, GOAL_X - 18, 8), at(HS, 7, GOAL_X - 38, 12), at(HS, 6, GOAL_X - 40, -12),
        at(HS, 5, GOAL_X - 36, 24), at(HS, 1, -2, -20), at(HS, 4, -2, 20),
        at(AI, 0, GOAL_X - 1.5, 0, Math.PI), at(AI, 2, GOAL_X - 14, -5, Math.PI), at(AI, 3, GOAL_X - 14, 5, Math.PI), at(AI, 1, GOAL_X - 16, 18, Math.PI), at(AI, 4, GOAL_X - 16, -18, Math.PI),
        at(AI, 5, GOAL_X - 26, -10, Math.PI), at(AI, 6, GOAL_X - 24, 0, Math.PI), at(AI, 7, GOAL_X - 26, 10, Math.PI), at(AI, 8, GOAL_X - 32, 16, Math.PI),
        at(AI, 9, 4, -6, Math.PI), at(AI, 10, 4, 6, Math.PI),
      ],
      owner: { side: HS, slot: 8 },
      goal: 'draw-or-better',
      stars: [0, 1, 2],
    },
  },
  {
    id: 'hold-the-fort',
    title: 'HOLD THE FORT',
    brief: 'One up, one man down, they are coming. Keep them out for 45 seconds.',
    icon: '🛡',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Hold THROUGH ({through}) to PRESS and stay goal-side, tap SHOOT ({shoot}) to tackle when you are close. PASS ({pass}) switches to the nearest defender. Win it and keep it for more stars.',
    difficulty: 2,
    next: 'giant-killing',
    spec: {
      id: 'hold-the-fort',
      title: 'HOLD THE FORT',
      brief: 'Ten men, one goal up: no goals conceded.',
      clock: 0,
      seconds: 45,
      score: [1, 0],
      humanSide: HS,
      difficulty: 2,
      players: [
        at(HS, 0, -GOAL_X + 1.2, 0), at(HS, 1, -30, -15), at(HS, 2, -33, -5), at(HS, 3, -33, 5), at(HS, 4, -30, 15),
        at(HS, 5, -22, -13), at(HS, 6, -24, -3), at(HS, 8, -22, 13), at(HS, 9, -12, -4), at(HS, 10, -12, 4),
        at(AI, 0, GOAL_X - 4, 0, Math.PI), at(AI, 1, -2, -16, Math.PI), at(AI, 2, 4, -5, Math.PI), at(AI, 3, 4, 5, Math.PI), at(AI, 4, -2, 16, Math.PI),
        at(AI, 5, -12, -14, Math.PI), at(AI, 6, -10, -4, Math.PI), at(AI, 7, -8, 4, Math.PI), at(AI, 8, -12, 14, Math.PI),
        at(AI, 9, -22, -7, Math.PI), at(AI, 10, -22, 7, Math.PI),
      ],
      owner: { side: AI, slot: 7 },
      sentOff: [{ side: HS, slot: 7 }],
      goal: 'no-concede',
      stars: [0, 30, 50],
    },
  },
  {
    id: 'giant-killing',
    title: 'GIANT KILLING',
    brief: 'Duckworth Albion against Northwick Wanderers, Hard. Be in front after 90 seconds.',
    icon: '👑',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Their players are faster and sharper: keep it simple, PASS ({pass}) early, shoot when the lane is clear. A win is one star; a clean sheet or two clear goals makes two; both, three.',
    // Duckworth (54) against Northwick (88): the widest gap the scripted bot still wins now and then on Hard.
    home: 2,
    away: 9,
    difficulty: 2,
    next: 'blitz-mega',
    spec: {
      id: 'giant-killing',
      title: 'GIANT KILLING',
      brief: 'The underdogs: lead when the time is up.',
      clock: 0,
      seconds: 90,
      score: [0, 0],
      humanSide: HS,
      difficulty: 2,
      restart: 'kickoff',
      goal: 'lead',
      stars: [1, 2, 3],
    },
  },
  {
    id: 'blitz-mega',
    title: 'BLITZ MEGA',
    brief: 'Grab the MEGA cube and score with the rocket. 40 seconds.',
    icon: '⚡',
    xpNote: `+${MOMENT_XP_PER_STAR} XP a star`,
    tip: 'Run over the cube, press POWER ({power}) to arm it, wait a second for the ball to glow, then SHOOT ({shoot}) from range: a mega shot cannot be saved from inside twelve metres.',
    difficulty: 1,
    next: null,
    spec: {
      id: 'blitz-mega',
      title: 'BLITZ MEGA',
      brief: 'Take the mega cube and score with it.',
      clock: 0,
      seconds: 40,
      score: [0, 0],
      humanSide: HS,
      difficulty: 1,
      mode: 'blitz',
      players: [
        at(HS, 9, 2, 0), at(HS, 10, 4, -12), at(HS, 8, 0, 20), at(HS, 7, -6, 4), at(HS, 6, -8, -6), at(HS, 5, -4, -20),
        at(AI, 0, GOAL_X - 1.5, 0, Math.PI), at(AI, 2, 26, -5, Math.PI), at(AI, 3, 26, 5, Math.PI), at(AI, 1, 22, 18, Math.PI), at(AI, 4, 22, -18, Math.PI),
        at(AI, 5, 6, -12, Math.PI), at(AI, 6, 4, 12, Math.PI), at(AI, 7, -3, 0, Math.PI),
      ],
      owner: { side: HS, slot: 9 },
      powerups: [{ kind: 'mega', x: 10, z: 3 }],
      goal: 'score',
      stars: [0, 15, 25],
    },
  },
];

export function momentById(id: string): Moment | undefined {
  return MOMENTS.find((m) => m.id === id);
}

export function momentIndex(id: string): number {
  return MOMENTS.findIndex((m) => m.id === id);
}

/** The moment after `id` (undefined after the last one). */
export function nextMoment(id: string): Moment | undefined {
  const cur = momentById(id);
  return cur?.next ? momentById(cur.next) : undefined;
}

/** The first moment is always open; each later one opens once the previous has at least one star. */
export function momentUnlocked(id: string, best: Readonly<Record<string, number>>): boolean {
  const i = momentIndex(id);
  if (i <= 0) return i === 0;
  return (best[MOMENTS[i - 1].id] ?? 0) >= 1;
}

/** The moment to highlight when the screen opens: the first one without three stars, else the last. */
export function firstOpenMoment(best: Readonly<Record<string, number>>): Moment {
  return MOMENTS.find((m) => (best[m.id] ?? 0) < 3 && momentUnlocked(m.id, best)) ?? MOMENTS[MOMENTS.length - 1];
}

/** Stars earned over the catalogue, and the total on offer. */
export function momentStarTotals(best: Readonly<Record<string, number>>): { got: number; of: number } {
  let got = 0;
  for (const m of MOMENTS) got += Math.max(0, Math.min(3, Math.floor(best[m.id] ?? 0)));
  return { got, of: MOMENTS.length * 3 };
}

/** The star rule of a spec in words, one line per star ("★ score", "★★ 8 s left", "★★★ 13 s left"). */
export function starRules(spec: ScenarioSpec): [string, string, string] {
  const th = spec.stars;
  const s = (n: number) => `${Math.round(n)} s`;
  switch (spec.goal) {
    case 'score':
      return ['score', th ? `score with ${s(th[1])} left` : 'score fast', th ? `score with ${s(th[2])} left` : 'score faster'];
    case 'lead':
      return ['be in front', 'in front with a clean sheet, or two clear', 'two clear with a clean sheet'];
    case 'draw-or-better':
      return ['draw', 'win', 'win by two'];
    case 'no-concede':
      return ['hold them out', th ? `hold out with ${th[1]}% of the ball` : 'hold out and keep the ball', th ? `hold out with ${th[2]}% of the ball, or score` : 'hold out and score'];
    case 'win-shootout':
      return ['win the shootout', 'win by one kick or more', 'win by two kicks or more'];
  }
}

// ------------------------------------------------------------------ LEARN THE BASICS (the first-visit campaign)

/**
 * One prompt of a basics step. The trainer (ui/trainer.ts) shows at most one at a time: a cue appears `after`
 * seconds of play (counted from the start, or from the previous cue being done) while `when` holds, and goes
 * once `done` happens. The key cap is the player's own binding for `key` (core/input.ts actionKey).
 */
export interface LessonCue {
  key: 'pass' | 'shoot' | 'through' | 'sprint' | 'move';
  /** What to do, beside the key cap ("to your free team-mate"). */
  text: string;
  after: number;
  /** onBall: our man has it at his feet; offBall: nobody of ours has it; incoming: a ball is on its way to our man. */
  when: 'onBall' | 'offBall' | 'incoming' | 'any';
  done: 'pass' | 'shot' | 'cross' | 'sprint' | 'move';
}

/** A LEARN THE BASICS step: a tiny staged situation (a Football Moment spec that isn't in the MOMENTS list). */
export interface BasicsStep {
  id: string;
  /** Short: the brief banner's letters are huge. */
  title: string;
  brief: string;
  icon: string;
  lesson: LessonCue[];
  spec: FullScenarioSpec;
}

/** Every lineup slot of a side except `keep` (sent off before the start: a drill has only the players it needs). */
const allBut = (side: Side, keep: number[]): { side: Side; slot: number }[] =>
  Array.from({ length: 11 }, (_, slot) => slot).filter((s) => !keep.includes(s)).map((slot) => ({ side, slot }));

/**
 * The three steps, in order: PASS (a 2 v 1: square it to the free man), SHOOT (an open shot from 12 m, then
 * SPRINT after a rebound) and CROSS (from the wing to a runner). Easy AI, generous clocks; they are replayed
 * until done (main.ts: a miss restarts the step at once, no result screen, no fail state).
 */
export const BASICS: readonly BasicsStep[] = [
  {
    id: 'basics-pass',
    title: 'PASS',
    brief: 'Two against one. Pass to your free team-mate, then score.',
    icon: '⇄',
    lesson: [
      { key: 'pass', text: 'Pass to the free man', after: 0.5, when: 'onBall', done: 'pass' },
      { key: 'shoot', text: 'Now shoot!', after: 0.3, when: 'onBall', done: 'shot' },
    ],
    spec: {
      id: 'basics-pass',
      title: 'PASS',
      brief: 'Pass to the free man, then score.',
      clock: 0,
      seconds: 30,
      score: [0, 0],
      humanSide: HS,
      difficulty: 0,
      players: [
        at(HS, 9, GOAL_X - 25, -7), at(HS, 10, GOAL_X - 13, 9),
        AI_KEEPER, at(AI, 3, GOAL_X - 21.5, -5.5, Math.PI),
      ],
      sentOff: [...allBut(HS, [0, 9, 10]), ...allBut(AI, [0, 3])],
      owner: { side: HS, slot: 9 },
      goal: 'score',
      stars: [0, 15, 22],
    },
  },
  {
    id: 'basics-shoot',
    title: 'SHOOT',
    brief: 'An open shot from twelve metres. Hold SHOOT, aim at a corner, let go.',
    icon: '⚽',
    lesson: [
      { key: 'shoot', text: 'Hold, aim at a corner, let go', after: 0.5, when: 'onBall', done: 'shot' },
      { key: 'sprint', text: 'Sprint after the ball', after: 1.2, when: 'offBall', done: 'sprint' },
    ],
    spec: {
      id: 'basics-shoot',
      title: 'SHOOT',
      brief: 'Score from twelve metres.',
      clock: 0,
      seconds: 30,
      score: [0, 0],
      humanSide: HS,
      difficulty: 0,
      players: [at(HS, 9, GOAL_X - 12, -2), AI_KEEPER],
      sentOff: [...allBut(HS, [0, 9]), ...allBut(AI, [0])],
      owner: { side: HS, slot: 9 },
      goal: 'score',
      stars: [0, 15, 22],
    },
  },
  {
    id: 'basics-cross',
    title: 'CROSS',
    brief: 'Your winger has it. Cross for the runner and score.',
    icon: '↗',
    lesson: [
      { key: 'through', text: 'Hold to cross to your runner', after: 0.5, when: 'onBall', done: 'cross' },
      { key: 'shoot', text: 'Head it in!', after: 0, when: 'incoming', done: 'shot' },
    ],
    spec: {
      id: 'basics-cross',
      title: 'CROSS',
      brief: 'Cross for the runner and score.',
      clock: 0,
      seconds: 30,
      score: [0, 0],
      humanSide: HS,
      difficulty: 0,
      players: [
        at(HS, 8, GOAL_X - 15, 21), at(HS, 9, GOAL_X - 17, 1),
        AI_KEEPER, at(AI, 2, GOAL_X - 9, 15, Math.PI),
      ],
      sentOff: [...allBut(HS, [0, 8, 9]), ...allBut(AI, [0, 2])],
      owner: { side: HS, slot: 8 },
      goal: 'score',
      stars: [0, 15, 22],
    },
  },
];

export function basicsStep(i: number): BasicsStep | undefined {
  return BASICS[i];
}
