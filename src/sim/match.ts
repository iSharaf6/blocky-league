import { angleDiff, clamp, dist2, pointSegDist, turnToward } from '../core/math';
import { Rng } from '../core/rng';
import { CURL_SPIN, FINESSE_CURL, FINESSE_MAX_POWER, onTarget, passAimPoint, pickReceiver, resolveKick, stickCurl } from './actions';
import { assistRun, intercept, isCrossingRestart, makeBrain, penaltyWaitSpot, setPieceAim, setPieceReady, setPieceTargets, updateTeamAI, type TeamBrain } from './ai';
import { headerAtGoal, reaimShot, WILD_LIFT, type Launch } from './actions';
import { Ball, groundPassSpeed, type BallHit } from './ball';
import {
  AssistState, carrierGuard, closeTouch, humanDribble, humanTackle, KNOCK_TAP, knockAssist, PRESS_GAP, PRESS_LEAD, pressSteal,
  standingFoulChance, standingTackleChance, STAND_REACH, tackleClosing, vsHuman,
} from './dribble';
import {
  AIR_DRAG, BALL_R, BOX_DEPTH, BOX_W, DT, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W, JOG_SPEED, KICK_WINDUP,
  PEN_SPOT, ROLL_A, ROLL_B, SEP_MATE, SEP_OPP, SIX_DEPTH, SIX_W, SPRINT_SPEED,
} from './constants';
import { FORMATIONS, kickoffSlot, type Slot } from './formations';
import { clearOfPenalty, freeKickWall, inOwnBox, isDirectFreeKick } from './keeper';
import { FATIGUE_REF_HALF, Player, type KickOrder } from './player';
import { STUMBLE_BUMP, STUMBLE_LOST } from './player';
import {
  HUMAN_WINDOW, INTRO_BEAT, KICK_TIMEOUT, RESULT_BEAT, aiPenaltyAim, divePlan, keeperGuess, lineupSpot, nextTurn, penaltyLaunch,
  predictCrossing, shootoutWinner, takerOrder, type KeeperDive, type KickHow, type PenAim, type ShootoutState,
} from './shootout';
import type { AssistLevel, FormationId, KickKind, MatchEvent, PlayerDef, RestartKind, ShotStyle, Side, TeamDef } from './types';

export type Phase = 'kickoff' | 'play' | 'out' | 'restart' | 'goal' | 'halftime' | 'fulltime' | 'shootout';

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  /** Real seconds per half. */
  halfLength: number;
  /** 0 (Sunday league) .. 4 (legend). */
  difficulty: number;
  humanSide: Side | -1;
  seed?: number;
  /**
   * Optional per-side AI difficulty (0..4) overriding `difficulty` for that side's AI.
   * Used for AI-vs-AI balancing; the default keeps both sides on `difficulty`.
   */
  sideDifficulty?: [number, number];
  /** Cup tie: level at full time goes straight to a penalty shootout (no extra time). */
  knockout?: boolean;
  /** The offside law is enforced (default true). See Match.offside. */
  offside?: boolean;
}

/** Held button state from the input layer, move vector already in world space. */
export interface Pad {
  mx: number;
  mz: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
  /**
   * Optional: the stick is keyboard / d-pad (true) or an analog stick / touch thumbstick (false).
   * Left out, the sim guesses from the vector (isDigitalStick). Keys turn a free-kick / corner aim
   * gradually instead of snapping it to eight directions.
   */
  digital?: boolean;
}

export interface Restart {
  kind: RestartKind;
  side: Side;
  x: number;
  z: number;
  taker: number;
  wait: number;
  /** An indirect free kick (given for offside): it can't go straight in. */
  indirect?: boolean;
}

export interface Stats {
  shots: [number, number];
  onTarget: [number, number];
  possession: [number, number];
  passes: [number, number];
  tackles: [number, number];
  corners: [number, number];
  fouls: [number, number];
  saves: [number, number];
  /** Times each side was caught offside. */
  offsides: [number, number];
}

export interface GoalRecord {
  side: Side;
  scorer: number;
  name: string;
  minute: number;
  own: boolean;
}

export const EMPTY_PAD: Pad = { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, through: false };

/** How fast (rad/s) keyboard / d-pad input turns a set-piece aim (~60 degrees a second). */
export const AIM_TURN = Math.PI / 3;

/**
 * Does this (world-space) stick vector look like keyboard / d-pad input: full length and along one of
 * the eight 45-degree directions? The pad reaches the sim through the camera, so the directions are
 * checked against the world axes (the broadcast camera) and against `ref` (the default aim, which a
 * behind-the-ball set-piece camera looks along, give or take a few degrees). A full-tilt analog stick
 * held exactly on one of those lines reads as digital too; the input layer can say for sure with
 * Pad.digital.
 */
export function isDigitalStick(mx: number, mz: number, ref = 0): boolean {
  const l = Math.hypot(mx, mz);
  if (Math.abs(l - 1) > 0.02) return false;
  const a = Math.atan2(mz, mx);
  const off45 = (x: number) => {
    const k = x / (Math.PI / 4);
    return Math.abs(k - Math.round(k)) * 45;
  };
  return off45(a) < 2 || off45(a - ref) < 6;
}

/** Chance a contested header ends in a foul by the player who lost it. */
const AERIAL_FOUL = 0.21;
/** A shot passing this close (m) to an outfield body is usually blocked. */
const BODY_BLOCK = 0.5;
/** Header leap: ~0.49 m apex ~0.23 s after take-off (players fall at 18 m/s²). */
const HEADER_VY = 4.2;
/** Take off when the ball is this far (s) from the head, so contact comes around the apex. */
const HEADER_LEAD = 0.28;
/** A ball above this height (m) at the head needs a leap; lower ones are headed standing. */
const HEADER_JUMP_Y = 1.75;
/** A goal off a defender or keeper within this long (s) of an on-target shot is the shooter's. */
const SHOT_CREDIT = 1.3;
/**
 * Benefit of the doubt (m), body centre to body centre: level, or within about half a (chunky, ~1 m
 * wide) body of level, is onside.
 */
export const OFFSIDE_TOL = 0.8;
/** Athletic edge per AI difficulty level above/below 2 (the human side is never scaled). */
const AI_PACE_EDGE = 0.02;
/** Standing tackles are won a little less often than they used to be (more attacks reach the box). */
const TACKLE_WIN = 0.85;
/** Seconds the referee waits to see whether the fouled side keeps the ball (advantage). */
const ADVANTAGE_WINDOW = 1.5;
/** Free kick / penalty run-up: the taker waits this far behind the ball and off to one side (m). */
const RUNUP_BACK = 1.5;
const RUNUP_SIDE = 0.9;
/** ... and steps in to strike it at this pace (m/s). */
const RUNUP_SPEED = 5.5;
/** The run-up spot stays at least this far (m) to his side of the ball-goal line, however he aims. */
const RUNUP_LENS_CLEAR = 0.8;
/** AI managers look at their bench at the first dead ball after these minutes (second half)... */
const AUTO_SUB_MINUTES = [60, 75];
/**
 * ... and a side that still hasn't made a change by this minute makes one at the next dead ball
 * whatever the legs look like (the most tired outfielder comes off): every AI bench gets used. (Was 70',
 * checked only as the ball went out, so it landed at 72-77'; from 66' on it's checked on every step the
 * ball is dead and lands by ~70'.)
 */
export const FORCED_SUB_MINUTE = 66;
/**
 * A driven corner (SHOOT): whipped at the near-post zone short of full power (a softer driven ball hangs a
 * touch longer: DRIVEN_HANG in actions.ts, ~10% here), dropping to ~1 m at the runner (so it's met, not
 * flashed across the box and out for a throw on the far side). Was 0.75 (which only labelled the kick).
 */
const DRIVEN_POWER = 0.65;
const DRIVEN_LAND = 1.0;
/** The human's man heads a ball dropping onto him on his own (no button) from this close (m): see autoHeader. */
const AUTO_HEADER_D = 3.2;
/** A zonal defender at a corner heads away a delivery that passes this close (m) and this low (m). */
const ZONAL_HEAD_R = 1.2;
const ZONAL_HEAD_Y = 2.2;
/** ... unless an attacker is within this (m) of it too: then it's a contest for the first-time contact. */
const ZONAL_CONTEST_R = 2;
/**
 * How much of the stick moves the human's man while he charges a shot with the ball at his feet (round 8:
 * at 0.3 he stood planted for up to 0.85 s and two thirds of human shots were blocked or cleared).
 */
const SHOOT_CHARGE_MOVE = 0.6;
/**
 * SHOOT held this long (s) fills the power bar (it was 0.85 s). Match.shootCharge counts in SHOOT_BAR units
 * of a full bar (shootCharge / SHOOT_BAR is the bar, 0..1, as the HUD reads it).
 */
export const SHOOT_FULL_T = 0.5;
export const SHOOT_BAR = 0.85;
/** The human's assisted receive sprints onto a pass whose meeting point is further than this (m). */
const RECEIVE_SPRINT = 2.5;
/**
 * A human pass (PASS with the ball at his feet): held, it charges over PASS_CHARGE_T s (passCharge 0..1);
 * let go sooner than PASS_TAP s and it's a tap, at the pace the assist judges.
 */
const PASS_CHARGE_T = 0.9;
const PASS_TAP = 0.12;
/** THROUGH held at least this long (s) is a lofted ball, not a through ball; its charge fills over LOB_CHARGE_T s. */
const THROUGH_LOB_HOLD = 0.24;
const LOB_CHARGE_T = 0.8;
/** How much of the stick still moves him while he charges a pass and turns his body to it. */
const PASS_CHARGE_MOVE = 0.5;
/** The passer's body turn towards the pass line (rad/s) standing still, and the share of it lost at a sprint. */
const PASS_TURN = 14;
const PASS_TURN_SPRINT_LOSS = 0.55;
/**
 * Let go with his body still more than PASS_SQUARE_MAX (rad) off the line and the kick waits for the turn
 * (at most PASS_TURN_WAIT s) rather than going out of the side of his foot; he keeps turning through the
 * wind-up, so he's square to it at the strike.
 */
const PASS_SQUARE_MAX = Math.PI / 4;
const PASS_TURN_WAIT = 0.15;
/** While charging, the lock-on is picked again when the stick swings this far (rad), or every PASS_REPICK s. */
const PASS_REPICK_ANGLE = 0.12;
const PASS_REPICK = 0.25;
/** PASS pressed while a pass is on its way to him is a first-time ball when it arrives (a one-two), for up to this long (s). */
const PASS_BUFFER = 1.5;
/**
 * Move assist: for MOVE_ASSIST_T s after a switch, with the stick neutral (or still held the way it was at the
 * switch) or within MOVE_ASSIST_CONE (rad) of the AI's run, the new man keeps making that run...
 */
const MOVE_ASSIST_T = 0.5;
const MOVE_ASSIST_CONE = Math.PI / 3;
/** ... and off the ball, with the stick left alone for MOVE_IDLE_T s, he follows his AI positioning at a jog. */
const MOVE_IDLE_T = 0.4;
/** The stick held at a switch counts as neutral (latched) until it's let go or swung more than this (rad). */
const STICK_LATCH_TURN = Math.PI / 4;
/**
 * Auto switch (defending: their ball, or a loose one): at most one every AUTO_SWITCH_GAP s, to the man who
 * gets to the ball in under AUTO_SWITCH_RATIO of the current man's time (AUTO_SWITCH_RATIO_LOOSE for a loose
 * ball: whoever gets to where it drops first) and at least AUTO_SWITCH_MARGIN s sooner.
 */
const AUTO_SWITCH_GAP = 0.6;
const AUTO_SWITCH_RATIO = 0.7;
const AUTO_SWITCH_RATIO_LOOSE = 0.8;
const AUTO_SWITCH_MARGIN = 0.5;

/** The kick-off taker's partner stands this far (m) to his side, clear of him. */
const KICKOFF_PARTNER_Z = 1.6;

/** A human pass being charged (PASS / THROUGH held), or let go and waiting on his body turn / wind-up. */
interface PassCharge {
  btn: 'pass' | 'through';
  player: number;
  /** Seconds the button has been held. */
  t: number;
  /** The aim: the stick (unit) while it's pushed, else his facing when he pressed. */
  dirX: number;
  dirZ: number;
  released: boolean;
  /** Seconds since it was let go. */
  wait: number;
  /** The man it's locked onto (-1: none). */
  target: number;
  mode: 'pass' | 'through' | 'lob';
  pickT: number;
  pickA: number;
  /** The pass line (world angle) his body turns to. */
  line: number;
  /** The kick has been ordered: he's winding up. */
  ordered: boolean;
  /** His speed (m/s) when he let the button go (the error margin's speed term). */
  relSpeed: number;
}
/** Extra hang time (s) on a corner to the far post, so it clears the near-post crowd. */
const FAR_POST_HANG = 0.22;
/**
 * Chance (base) a parry of a ball heading for the edge of the frame is tipped round the post or over
 * the bar; the rest are pushed back into play (it used to be ~0.75, so most long shots ended as corners).
 */
const PARRY_TIP = 0.5;
/** Upward pace (m/s, plus up to 1.5) of a parry spilled back into the middle. */
const PARRY_SPILL_VY = 0.4;
/** A shot struck at least this fast (m/s) into the top corner is beyond a diving keeper's full reach... */
const TOP_CORNER_SPEED = 25.5;
/** ... from TOP_CORNER_NEAR m or nearer; from TOP_CORNER_FAR m or further he has it covered as well as any. */
const TOP_CORNER_NEAR = 16;
const TOP_CORNER_FAR = 26;
/** Shots from further out than this (m) are held more often (fully from 8 m further out). */
const LONG_CATCH_FROM = 16;
/** How much shorter a diving keeper's reach is against a fully bent free kick. */
const CURL_REACH = 0.15;
/** How much higher (m) than a shoulder the wall reaches for a straight (unbent) free kick. */
const WALL_HEAD = 0.18;
/** How much lower (m) the wall's reach is against a fully bent free kick (it's struck up and dips). */
const WALL_CURL_DIP = 0.55;
/** How far (m) in front of / behind his body line a diving keeper can still get a hand to the ball. */
const DIVE_DEPTH = 0.5;
/**
 * A human's open-play strike: the boot meets the ball HUMAN_SHOT_WINDUP s after SHOOT is let go (an AI
 * shot, KICK_WINDUP: 0.11 s), long enough to time timed finishing's second tap on (see FINISH_WINDOWS).
 */
export const HUMAN_SHOT_WINDUP = 0.15;
/**
 * A shot ordered at more than PLANT_SPEED m/s takes a plant step: PLANT_MIN s more wind-up (PLANT_MAX flat
 * out) braking out of the sprint before the strike, so he doesn't snap from a dead run into a full swing.
 */
export const PLANT_SPEED = 6.5;
const PLANT_MIN = 0.05;
const PLANT_MAX = 0.08;
/** A ball within this far (m) of the middle of his body is struck with his good foot; further out, the near one. */
const STRONG_SIDE = 0.2;
/**
 * Timed finishing (Match.timedFinish): a second SHOOT tap within `perfect` s of the boot meeting the ball
 * scales the shot's error by TIMING_ERR.perfect, within `good` s by TIMING_ERR.good; any other tap from the
 * release until `late` s after contact is mistimed (early / late): a wild one (TIMING_ERR.early, and WILD_LIFT
 * more height). No second tap: the shot is exactly what it would have been.
 */
export const FINISH_WINDOWS = { perfect: 0.05, good: 0.08, late: 0.12 };
export const TIMING_ERR = { perfect: 0.4, good: 0.7, early: 1.9, late: 1.9 } as const;
/**
 * First touch (see Match.firstTouch): a moving ball comes off the receiver's body TOUCH_BASE m plus
 * TOUCH_K x how heavy the touch is (the ball's speed relative to him, squared, his dribbling, the pressure,
 * facing it or not). Up to TOUCH_SPILL m he has it, pushed into his stride and settled over TOUCH_T s;
 * beyond that it's loose (at most TOUCH_MAX m away) and anyone's.
 */
const TOUCH_BASE = 0.22;
const TOUCH_K = 1.1;
export const TOUCH_SPILL = 0.95;
const TOUCH_T = 0.22;
const TOUCH_MAX = 3.2;
/** A ball slower than this (m/s) relative to him is just picked up (no first touch to speak of). */
const TOUCH_MIN_REL = 4;
/** While a touch settles, the ball is steered with this spring (1/s; 15 once it's on his foot)... */
const TOUCH_SPRING = 7;
/** ... and gives up this share of the difference each step, so it doesn't stop dead on contact. */
const TOUCH_GRIP = 0.35;
/** The heavy-touch part for the human receiver, by Match.groundAssist, and for the AI's. */
const TOUCH_ASSIST: Record<AssistLevel, number> = { assisted: 0.5, semi: 0.75, manual: 1 };
const TOUCH_AI = 0.8;
/** A keeper holding the ball stays at least this far (m) in front of his goal line. */
const KEEPER_LINE_IN = 0.3;
/**
 * A human's shot that meets a defender is blocked this much less often than an AI's (round 8: two thirds of
 * human shots in real matches were blocked or cleared; the AI picks its moments and loses ~5%).
 */
const HUMAN_SHOT_BLOCK = 0.45;
/**
 * A shot or cross grazed or blocked within DEFLECT_SAFE_D m of the defender's own goal turns at least
 * DEFLECT_SAFE_TURN rad away from it and keeps DEFLECT_SAFE_PACE of its pace (own goals were ~15%).
 */
const DEFLECT_SAFE_D = 12;
const DEFLECT_SAFE_TURN = 0.35;
const DEFLECT_SAFE_PACE = 0.6;
/** The flank (m in from the touchline) where tackles and blocks tend to put the ball into touch... */
const WING_TOUCH = 12;
/** ... how often a won poke tackle there knocks it out (right by the line), and a block. */
const WING_POKE_TOUCH = 0.85;
const WING_BLOCK_TOUCH = 0.8;
/**
 * ... and take off outfielders more tired than this (per window: a busy player is ~0.5 fit by the hour
 * mark, so the 60' look uses a looser bar than the 75' one).
 */
const AUTO_SUB_STAMINA = [0.55, 0.45];

const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

/** Timed finishing's verdict on a second SHOOT tap (the 'timing' event). */
export type TimingGrade = Extract<MatchEvent, { type: 'timing' }>['grade'];

/**
 * A formation change: which slot of `to` each slot of `from` moves to (index = old slot, value = new
 * slot). The keeper keeps slot 0; the outfield slots are matched so the total distance (metres on the
 * pitch) between old and new slot positions is least, with a small preference for slots of the
 * player's natural role (`roles`, per old slot, optional). Exact (bitmask DP over the ten outfield slots).
 */
export function formationRemap(from: readonly Slot[], to: readonly Slot[], roles?: readonly string[]): number[] {
  const n = Math.min(from.length, to.length);
  const out = from.map((_, i) => i);
  if (n <= 1) return out;
  const k = n - 1; // outfield slots 1..n-1
  const cost: number[][] = [];
  for (let i = 0; i < k; i++) {
    const a = from[i + 1];
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      const b = to[j + 1];
      let c = Math.hypot((a.x - b.x) * HALF_L, (a.z - b.z) * HALF_W);
      if (roles && roles[i + 1] && roles[i + 1] !== b.role) c += 2;
      row.push(c);
    }
    cost.push(row);
  }
  const full = (1 << k) - 1;
  const dp = new Float64Array(1 << k).fill(Infinity);
  const pick = new Int8Array(1 << k).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < full; mask++) {
    if (dp[mask] === Infinity) continue;
    // The next old slot to place is the popcount of mask.
    let i = 0;
    for (let v = mask; v; v &= v - 1) i++;
    for (let j = 0; j < k; j++) {
      if (mask & (1 << j)) continue;
      const nm = mask | (1 << j);
      const c = dp[mask] + cost[i][j];
      if (c < dp[nm] - 1e-9) {
        dp[nm] = c;
        pick[nm] = j;
      }
    }
  }
  // Walk back: the last old slot placed took pick[mask].
  let mask = full;
  for (let i = k - 1; i >= 0; i--) {
    const j = pick[mask];
    out[i + 1] = j + 1;
    mask &= ~(1 << j);
  }
  return out;
}

/** The scorer's sprint away (s) before he slows so the mob can reach him. */
const HERO_BURST = 0.7;
/** A sent-off player's walk to the dugout: pace (m/s), and the longest it takes before he's there. */
const WALK_OFF_SPEED = 3.2;
const WALK_OFF_MAX = 9;
/** Where a shootout's winners pile up: on halfway, on the camera side. */
const SO_HUB = { x: 0, z: HALF_W * 0.3 };

export class Match {
  readonly rng: Rng;
  readonly ball = new Ball();
  readonly players: Player[] = [];
  readonly slots: [Slot[], Slot[]];
  readonly brains: [TeamBrain, TeamBrain] = [makeBrain(), makeBrain()];
  readonly teams: [TeamDef, TeamDef];
  private readonly bySide: [Player[], Player[]] = [[], []];

  score: [number, number] = [0, 0];
  /** -1 defensive · 0 balanced · +1 attacking, per side. */
  mentality: [number, number] = [0, 0];
  subsUsed: [number, number] = [0, 0];
  /** Players already in the referee's book. */
  readonly booked = new Set<number>();
  /** Substitutions allowed per side (five, as in DLS). The tactics screen reads this. */
  readonly maxSubs = 5;
  readonly bench: [PlayerDef[], PlayerDef[]];
  half = 1;
  clock = 0;
  phase: Phase = 'kickoff';
  phaseT = 0;
  restart: Restart | null = null;
  events: MatchEvent[] = [];
  goals: GoalRecord[] = [];
  stats: Stats = {
    shots: [0, 0], onTarget: [0, 0], possession: [0, 0], passes: [0, 0],
    tackles: [0, 0], corners: [0, 0], fouls: [0, 0], saves: [0, 0], offsides: [0, 0],
  };
  /** Offside law on (MatchConfig.offside, default true). Can be flipped mid-match. */
  offside: boolean;
  /** Formation each side is playing right now (see setFormation). */
  readonly formation: [FormationId, FormationId];
  /**
   * Who leads the goal celebration: the scorer, or for an own goal the scoring side's player
   * nearest the ball. -1 outside a goal. (The camera can follow this instead of lastGoalScorer.)
   */
  celebHero = -1;
  /** Where the celebration heads: the corner flag on the camera side at the end the goal went in. */
  celebSpot = { x: 0, z: 0 };

  passTarget = -1;
  passT = 0;
  shotClock = 99;
  shotOnTarget = false;
  shotSide: Side = 0;
  /** Who struck the last shot, the kick id it was, and whether it was on target when struck. */
  shooter = -1;
  shotKick = -1;
  shotWasOnTarget = false;
  /** Launch speed (m/s) of the last shot, and how bent it was (0 straight .. 1 full curl). */
  shotSpeed = 0;
  shotCurl = 0;
  /** How far out (m, to the goal centre) the last shot was struck from. */
  shotDist = 0;
  /** The last shot was a chip or a finesse one (null for a plain strike or a header). */
  shotStyle: ShotStyle | null = null;
  /**
   * The last shot with the foot: struck with the shooter's weaker foot, and how far off balance he was (0
   * steady .. 1: turned right away from goal, or reeling from a challenge). For the HUD, commentary, render.
   */
  shotWeakFoot = false;
  shotBalance = 0;
  /** Timed finishing's verdict on the last shot (null: no second tap, or not a timed one). */
  shotTiming: TimingGrade | null = null;
  /** How far (m) the last first touch came off the receiver (over TOUCH_SPILL: a heavy one he lost). */
  lastTouchD = 0;
  /** The last shot was struck by the human's man. */
  shotByHuman = false;
  /** kickId of the last shot struck straight from a direct free kick. */
  private fkShotKick = -1;
  /** Where the ball was at the start of this step (swept contact checks). */
  private readonly ballPrev = { x: 0, y: 0, z: 0 };
  ballPath: { t: number; x: number; y: number; z: number }[] = [];
  keeperHoldTime = 1.4;
  /** Human-controlled player index, -1 when nobody. */
  active = -1;
  /** The shot power bar while SHOOT is held: shootCharge / SHOOT_BAR is 0..1 (full after SHOOT_FULL_T s). */
  shootCharge = 0;
  throughCharge = 0;
  goalSide: Side = 0;
  lastGoalScorer = -1;
  autoSwitch = true;
  /** Human pass assistance for ground passes and through balls (settings; see AssistLevel). */
  groundAssist: AssistLevel = 'assisted';
  throughAssist: AssistLevel = 'assisted';
  /** After a switch (and with the stick left alone off the ball) the new man keeps making the AI's run. */
  moveAssist = true;
  /** A second SHOOT tap at contact sharpens (or, mistimed, spoils) the shot. */
  timedFinish = true;
  /** 0..1 while the human is charging a pass (PASS held), -1 otherwise. */
  passCharge = -1;
  /** The teammate the charging pass is locked onto, -1 when none (render marks him). */
  passAim = -1;
  /**
   * What the charging ball is while PASS / THROUGH is held (and until it's struck): a pass, a through ball
   * (THROUGH tapped) or a lofted one (THROUGH held THROUGH_LOB_HOLD s or more); null otherwise.
   */
  passMode: 'pass' | 'through' | 'lob' | null = null;
  private hp: PassCharge | null = null;
  /** Switch tracking for move assist: the man last seen controlled, seconds since the last switch. */
  private seenActive = -1;
  private sinceSwitch = 99;
  /** Seconds the stick has been left alone, and the direction it was held at the last switch (see STICK_LATCH_TURN). */
  private stickIdle = 0;
  private latch: { x: number; z: number } | null = null;
  /** PASS pressed while a pass was on its way to him (see PASS_BUFFER). */
  private passBuffer = 0;
  /** Seconds since the last possession change (drives crowd tension, auto-switch). */
  sincePossession = 0;
  possessionSide: Side | -1 = -1;

  private prev: Pad = { ...EMPTY_PAD };
  private lastSprintTap = -9;
  private humanTime = 0;
  private hits: BallHit[] = [];
  private switchT = 0;
  private firstKickoff: Side = 0;
  private pendingRestart: Restart | null = null;
  private pathT = 0;
  /** Increments on every strike of the ball; lets players react once per kick. */
  kickId = 0;
  /** Seconds since the last strike, where it was struck from, and by which side. */
  sinceKick = 99;
  kickX = 0;
  kickZ = 0;
  kickSide: Side = 0;
  kickKind: KickKind = 'pass';
  /** kickId of the last corner / wide free-kick delivery (its box runners attack their zones). */
  setPieceKick = -1;
  /** That delivery was driven (whipped in flat and fast) rather than hung up. */
  setPieceDriven = false;
  /** Whether the defence attacks that delivery (vs. holding and letting the runners come). */
  spContest = false;
  /** kickId of the last direct free kick, and the defenders who were in its wall. */
  wallKick = -1;
  wall: number[] = [];
  private wallJumped = false;
  /** Penalty shootout of a knockout tie level at full time; null until one starts. */
  shootout: ShootoutState | null = null;
  /** Match stats frozen at the final whistle (shootout kicks aren't match stats). */
  private soStats: Stats | null = null;
  /**
   * A pass just released: the passer's teammates who were offside when it was played. If one of
   * them is the next to touch the ball, the flag goes up.
   */
  private offWatch: { kick: number; side: Side; passer: number; players: number[] } | null = null;
  /** A foul the referee is waiting on (advantage), resolved within ADVANTAGE_WINDOW. */
  private adv: { by: number; on: number; side: Side; t: number; x: number; z: number; reckless: boolean; kick: number } | null = null;
  /** Next automatic substitution window (index into AUTO_SUB_MINUTES), per side. */
  private subWindow: [number, number] = [0, 0];
  /** The stoppage each side's AI manager last looked at his bench (see aiSubs). */
  private aiSubAt: [string, string] = ['', ''];
  /** Players (by idx) who came on as substitutes. */
  private readonly cameOn = new Set<number>();
  /** Conceding players' walk-away points during a goal celebration. */
  private concedeWalk = new Map<number, { x: number; z: number }>();
  /** The AI corner whose short-or-cross choice has been made. */
  private shortRolled: Restart | null = null;
  /**
   * Free kicks and penalties (shootout kicks too): the taker waits at a run-up spot beside and behind
   * the ball (so the over-the-shoulder camera sees the ball) and, once the kick is ordered, steps in
   * to it (`stepIn` = his index) before the strike starts. `runUpFoot`: 1 right foot, -1 left.
   */
  stepIn = -1;
  runUpFoot = 1;
  private stepInT = 0;
  /** The default aim (radians, world facing) the current restart's taker was set up with. */
  restartAim = 0;

  /**
   * Foul probabilities scale with the half length (like fatigue), so a match of any length has a
   * match's worth of fouls (~4): 1.2 at the default 2-minute halves.
   */
  private readonly foulScale: number;

  constructor(readonly cfg: MatchConfig) {
    this.rng = new Rng(cfg.seed ?? 12345);
    this.foulScale = 1.2 * clamp(Math.pow(FATIGUE_REF_HALF / Math.max(30, cfg.halfLength), 1.3), 0.4, 1.8);
    this.teams = [cfg.home, cfg.away];
    this.offside = cfg.offside ?? true;
    this.formation = [cfg.home.formation, cfg.away.formation];
    this.bench = [[...(cfg.home.bench ?? [])], [...(cfg.away.bench ?? [])]];
    this.slots = [FORMATIONS[cfg.home.formation], FORMATIONS[cfg.away.formation]];
    for (const side of [0, 1] as Side[]) {
      const team = this.teams[side];
      // Harder AI sides get a small athletic edge (the human side is never scaled).
      const pace = cfg.humanSide === side ? 1 : 1 + (this.aiSkill(side) - 2) * AI_PACE_EDGE;
      for (let s = 0; s < 11; s++) {
        const p = new Player(this.players.length, side, s, team.players[s]);
        p.runT = this.rng.next() * 4;
        // Fatigue builds over a match of any length; keepers cover a fraction of the ground.
        p.fatigue = clamp(FATIGUE_REF_HALF / Math.max(1, cfg.halfLength), 0.05, 8) * (p.isKeeper ? 0.25 : 1);
        p.top *= pace;
        p.jog *= pace;
        this.players.push(p);
        this.bySide[side].push(p);
      }
    }
    this.firstKickoff = this.rng.chance(0.5) ? 0 : 1;
    this.setupKickoff(this.firstKickoff);
    this.updateBallPath();
  }

  // ---------------------------------------------------------------- queries

  attackDir(side: Side): number {
    const so = this.shootout;
    // Every shootout kick is taken at the same end: the kicking side attacks it, the keeper defends it.
    if (so && this.phase === 'shootout') return side === so.turn ? so.goal : -so.goal;
    const base = side === 0 ? 1 : -1;
    return this.half === 1 ? base : -base;
  }

  teamPlayers(side: Side): Player[] {
    return this.bySide[side];
  }

  keeperOf(side: Side): Player | undefined {
    return this.bySide[side][0];
  }

  isHumanControlled(p: Player): boolean {
    return this.cfg.humanSide === p.side && this.active === p.idx;
  }

  aiSkill(side: Side): number {
    if (this.cfg.humanSide === side) return 2.6;
    return this.cfg.sideDifficulty?.[side] ?? this.cfg.difficulty;
  }

  /** Skill level that shapes this player's kick accuracy (humans get a fixed, fair level). */
  kickSkill(p: Player): number {
    return this.isHumanControlled(p) ? 3 : this.aiSkill(p.side);
  }

  keeperBonus(side: Side): number {
    return this.cfg.humanSide === side ? 0.01 : (this.aiSkill(side) - 2) * 0.025;
  }

  /** Deepest outfield defender of `side`, in the normalised frame of the team attacking them. */
  defLine(side: Side): number {
    const other = (side === 0 ? 1 : 0) as Side;
    const ad = this.attackDir(other);
    let line = -1;
    for (const p of this.bySide[side]) {
      if (p.isKeeper || p.sentOff) continue;
      line = Math.max(line, (p.pos.x * ad) / HALF_L);
    }
    return line;
  }

  /**
   * The offside line for attackers of `side`, in their normalised frame (+1 = the goal they
   * attack): the second-last opponent (the keeper counts), never nearer than halfway (0).
   */
  offsideLine(side: Side): number {
    const ad = this.attackDir(side);
    let last = -Infinity;
    let second = -Infinity;
    for (const p of this.bySide[otherSide(side)]) {
      if (p.sentOff) continue;
      const x = (p.pos.x * ad) / HALF_L;
      if (x > last) {
        second = last;
        last = x;
      } else if (x > second) second = x;
    }
    return Math.max(0, second);
  }

  /**
   * Is `p` standing in an offside position: in the opponents' half, ahead of the ball and beyond the
   * second-last opponent (by more than OFFSIDE_TOL + `margin` metres)?
   */
  inOffsidePosition(p: Player, margin = 0): boolean {
    if (p.isKeeper || p.sentOff) return false;
    const ad = this.attackDir(p.side);
    const x = p.pos.x * ad;
    const line = Math.max(this.offsideLine(p.side) * HALF_L, this.ball.pos.x * ad);
    return x > line + OFFSIDE_TOL + margin;
  }

  minute(): number {
    const m = Math.floor((this.clock / this.cfg.halfLength) * 45);
    return (this.half - 1) * 45 + Math.min(m, 45 + 4);
  }

  /**
   * The minute an incident is logged in: football counts the minute being played (0:20 is the 1st
   * minute, 44:10 the 45th), so this rounds up, never shows 0', and stoppage time stays on 45'/90'.
   */
  goalMinute(): number {
    const base = (this.half - 1) * 45;
    const m = Math.ceil((this.clock / this.cfg.halfLength) * 45);
    return clamp(base + m, base + 1, this.half * 45);
  }

  /** Players still on the pitch for `side` (red cards leave a team short). */
  onPitch(side: Side): Player[] {
    return this.bySide[side].filter((p) => !p.sentOff);
  }

  // ---------------------------------------------------------------- set-up

  setupKickoff(side: Side): void {
    this.phase = 'kickoff';
    this.phaseT = 0;
    this.ball.reset(0, 0);
    this.passTarget = -1;
    this.shotClock = 99;
    this.offWatch = null;
    this.adv = null;
    this.celebHero = -1;
    this.concedeWalk.clear();
    for (const p of this.players) {
      if (p.sentOff) continue;
      const ad = this.attackDir(p.side);
      const k = kickoffSlot(this.slots[p.side][p.slot], p.side === side);
      p.pos.x = k.x * HALF_L * ad;
      p.pos.z = k.z * HALF_W * ad;
      p.vel.x = p.vel.z = 0;
      p.facing = ad > 0 ? 0 : Math.PI;
      p.setState('move');
      p.order = null;
      p.y = 0;
      p.vy = 0;
      p.kickT = 0;
      p.wantX = p.wantZ = 0;
      p.running = false;
    }
    // Kicker: the forward nearest the spot stands over the ball.
    const ad = this.attackDir(side);
    let kicker = this.bySide[side].find((p) => !p.sentOff && !p.isKeeper) ?? this.bySide[side][10];
    let best = Infinity;
    for (const p of this.bySide[side]) {
      if (p.sentOff || p.isKeeper) continue;
      const d = Math.hypot(p.pos.x, p.pos.z) + (p.role === 'FW' ? 0 : p.role === 'MF' ? 6 : 14);
      if (d < best) {
        best = d;
        kicker = p;
      }
    }
    kicker.pos.x = -ad * 0.62;
    kicker.pos.z = 0.05;
    kicker.facing = ad > 0 ? 0 : Math.PI;
    // His partner on the spot stands clear of him (they were 0.92 m apart: the bodies overlapped).
    for (const p of this.bySide[side]) {
      if (p === kicker || p.sentOff || p.isKeeper) continue;
      if (Math.hypot(p.pos.x - kicker.pos.x, p.pos.z - kicker.pos.z) < KICKOFF_PARTNER_Z) {
        p.pos.z = (Math.sign(p.pos.z - kicker.pos.z) || 1) * KICKOFF_PARTNER_Z;
      }
    }
    this.restartAim = kicker.facing;
    this.ball.owner = kicker.idx;
    this.ball.lastTouch = kicker.idx;
    this.ball.lastTouchSide = side;
    this.restart = { kind: 'kickoff', side, x: 0, z: 0, taker: kicker.idx, wait: 1.2 };
    if (this.cfg.humanSide >= 0) {
      this.active = side === this.cfg.humanSide ? kicker.idx : this.nearestTo(this.cfg.humanSide as Side, 0, 0, true);
    }
    this.events.push({ type: 'kickoffReady', side });
  }

  private nearestTo(side: Side, x: number, z: number, skipKeeper: boolean, exclude = -1): number {
    let best = -1;
    let bd = Infinity;
    for (const p of this.bySide[side]) {
      if ((skipKeeper && p.isKeeper) || p.idx === exclude || p.sentOff) continue;
      const d = dist2(p.pos.x, p.pos.z, x, z);
      if (d < bd) {
        bd = d;
        best = p.idx;
      }
    }
    return best;
  }

  /**
   * Bring on bench player `benchIdx` for the player in `slot`. Fresh legs, same slot and role;
   * the replaced player takes no further part. Returns false if not allowed.
   */
  substitute(side: Side, slot: number, benchIdx: number): boolean {
    if (this.subsUsed[side] >= this.maxSubs) return false;
    const bench = this.bench[side];
    const on = bench[benchIdx];
    const p = this.bySide[side][slot];
    if (!on || !p || p.sentOff) return false; // a sent-off player can't be replaced
    if ((slot === 0) !== (on.role === 'GK')) return false; // keepers only swap with keepers
    if (this.ball.owner === p.idx) this.ball.owner = -1;
    const off = p.def;
    bench.splice(benchIdx, 1);
    p.def = on;
    p.role = this.slots[side][slot].role;
    const pace = on.stats.pace / 100;
    const edge = this.cfg.humanSide === side ? 1 : 1 + (this.aiSkill(side) - 2) * AI_PACE_EDGE;
    p.jog = JOG_SPEED * (0.86 + pace * 0.22) * edge;
    p.top = SPRINT_SPEED * (0.82 + pace * 0.26) * edge;
    p.stamina = 1;
    // The yellow card belonged to the man going off, not to the slot.
    this.booked.delete(p.idx);
    this.cameOn.add(p.idx);
    this.subsUsed[side]++;
    this.teams[side].players[slot] = on;
    this.events.push({ type: 'sub', side, slot, on: on.name, off: off.name });
    return true;
  }

  /**
   * AI managers: freshen up to `count` of the most tired outfielders (stamina under `below`), within
   * the maxSubs limit (called at half time, and by the automatic 60' / 70' / 75' looks). Each goes off
   * for a bench player of the same role if there is one, otherwise any outfielder; a player who has
   * already come on is never taken off again, and nobody is replaced by a keeper. A second call for
   * the same side at the same stoppage (same half, phase and clock) does nothing, so a caller that
   * asks twice at the break can't double the changes. Returns how many substitutions were made.
   */
  aiSubs(side: Side, count: number, below = 0.7): number {
    const key = `${this.half}|${this.phase}|${this.clock}|${this.kickId}`;
    if (this.aiSubAt[side] === key) return 0;
    this.aiSubAt[side] = key;
    return this.subTired(side, count, below);
  }

  /** aiSubs without the once-per-stoppage guard. */
  private subTired(side: Side, count: number, below: number): number {
    let room = Math.max(0, Math.min(Math.floor(count), this.maxSubs - this.subsUsed[side]));
    if (room <= 0) return 0;
    const tired = this.bySide[side]
      .filter((p) => !p.isKeeper && !p.sentOff && p.stamina < below && !this.cameOn.has(p.idx))
      .sort((a, b) => a.stamina - b.stamina || a.slot - b.slot);
    let made = 0;
    for (const p of tired) {
      if (room <= 0) break;
      const bench = this.bench[side];
      // Like for like first, then any outfielder.
      const order = [
        ...bench.map((d, i) => ({ d, i })).filter((e) => e.d.role === p.role),
        ...bench.map((d, i) => ({ d, i })).filter((e) => e.d.role !== p.role && e.d.role !== 'GK'),
      ];
      for (const e of order) {
        if (this.substitute(side, p.slot, e.i)) {
          made++;
          room--;
          break;
        }
      }
    }
    return made;
  }

  /**
   * AI managers (both sides in AI-vs-AI, never the human's) look at their bench at the first dead
   * ball after 60' and after 75': outfielders under that window's AUTO_SUB_STAMINA come off, up to two
   * at a time, within maxSubs. A side that has made no change at all by FORCED_SUB_MINUTE brings one
   * on at the next dead ball regardless (the most tired outfielder). Each change is a 'sub' event.
   */
  private autoSubs(): void {
    if (this.half !== 2 || this.shootout) return;
    const min = this.minute();
    for (const side of [0, 1] as Side[]) {
      if (this.cfg.humanSide === side) continue;
      let w = this.subWindow[side];
      if (w < AUTO_SUB_MINUTES.length && min >= AUTO_SUB_MINUTES[w]) {
        while (w < AUTO_SUB_MINUTES.length && min >= AUTO_SUB_MINUTES[w]) w++;
        this.subWindow[side] = w;
        // (A stoppage that comes late enough to cover both windows uses the later, stricter bar.)
        this.aiSubs(side, 2, AUTO_SUB_STAMINA[w - 1]);
      }
      if (min >= FORCED_SUB_MINUTE && this.subsUsed[side] === 0) this.subTired(side, 1, Infinity);
    }
  }

  /**
   * Change a side's formation mid-match (the tactics screen). Each outfielder moves to the slot of
   * the new shape nearest the one he held (the assignment with the least total distance between old
   * and new slot positions, so a right-back stays on the right rather than becoming a left
   * wing-back), and takes its role; the keeper stays in slot 0 and the bench is untouched.
   * teamPlayers(side) (and the team's player list) stay in slot order. Returns false for an unknown
   * formation.
   */
  setFormation(side: Side, id: FormationId): boolean {
    const slots = FORMATIONS[id];
    if (!slots) return false;
    const old = this.slots[side];
    const team = this.bySide[side];
    const moveTo = formationRemap(old, slots, team.map((p) => p.def.role));
    this.slots[side] = slots;
    this.formation[side] = id;
    const byNew: Player[] = new Array(team.length);
    for (const p of team) {
      const s = moveTo[p.slot];
      byNew[s] = p;
      p.slot = s;
      if (!p.isKeeper) p.role = slots[s].role;
    }
    for (let s = 0; s < byNew.length; s++) {
      team[s] = byNew[s];
      this.teams[side].players[s] = byNew[s].def;
    }
    for (const s of [0, 1] as Side[]) {
      const br = this.brains[s];
      br.spFor = null; // set-piece shapes are drawn from the slots
      br.think = 0;
      if (s === side) {
        br.overlap = -1;
        br.boxZones.clear();
        br.supportT = 0;
      }
    }
    return true;
  }

  continueSecondHalf(): void {
    if (this.phase !== 'halftime') return;
    this.half = 2;
    this.clock = 0;
    this.setupKickoff(this.firstKickoff === 0 ? 1 : 0);
  }

  resumeAfterGoal(): void {
    if (this.phase !== 'goal') return;
    this.autoSubs();
    this.setupKickoff(this.goalSide === 0 ? 1 : 0);
  }

  // ---------------------------------------------------------------- main step

  step(dt: number, pad: Pad): void {
    this.phaseT += dt;
    if (this.phase === 'fulltime' && this.shootout && this.shootout.winner >= 0 && this.phaseT < 8) {
      this.shootoutParty(dt);
      return;
    }
    if (this.phase === 'halftime' || this.phase === 'fulltime') return;
    if (this.phase === 'shootout') {
      this.stepShootout(dt, pad);
      this.prev = { ...pad };
      return;
    }

    this.pathT -= dt;
    if (this.pathT <= 0) {
      this.updateBallPath();
      this.pathT = 0.05;
    }

    if (this.phase === 'goal') {
      this.celebrate();
    } else {
      updateTeamAI(this, 0, dt);
      updateTeamAI(this, 1, dt);
      this.applyHuman(dt, pad);
      this.restartTakers(dt);
    }
    this.prev = { ...pad };

    this.resolveOrders(dt);
    const frozen = this.phase === 'kickoff' || this.phase === 'restart';
    for (const p of this.players) {
      if (p.sentOff) {
        this.parkSentOff(p, dt);
        continue;
      }
      if (frozen && p.state === 'move' && (p.idx === this.restart?.taker || this.phase === 'kickoff')) {
        p.wantX = p.wantZ = 0;
        p.sprint = false;
      }
      p.step(dt, this.ball.owner === p.idx, this.isHumanControlled(p));
    }
    this.separate();
    this.keepPenaltyArea();
    this.holdDeadBall();
    this.keepHeldBall();
    this.dribbleControl();

    this.hits.length = 0;
    this.ballPrev.x = this.ball.pos.x;
    this.ballPrev.y = this.ball.pos.y;
    this.ballPrev.z = this.ball.pos.z;
    this.ball.step(dt, this.hits);
    for (const h of this.hits) {
      if (h.kind === 'post') {
        this.events.push({ type: 'post', x: h.x, y: h.y, z: h.z, speed: h.speed });
        if (this.shotClock < 2) this.events.push({ type: 'ooh' });
      } else if (h.kind === 'bounce') this.events.push({ type: 'bounce', speed: h.speed });
      else this.events.push({ type: 'net', x: h.x, y: h.y, z: h.z, speed: h.speed });
    }

    if (this.phase === 'play') {
      this.checkSlides();
      this.checkKeeperHands();
      this.checkWall();
      this.checkZonal();
      this.checkPossession();
      this.checkGraze();
      this.autoTackle();
      this.checkBounds();
      if (this.phase === 'play') this.updateAdvantage(dt);
      this.autoSwitchUpdate(dt);
    } else if (this.phase === 'out') {
      // A late change that's due (a side still without one past FORCED_SUB_MINUTE, or a window that opened
      // while the ball was already dead) is made while the ball is out, not held over to the next stoppage.
      if (this.half === 2 && this.minute() >= AUTO_SUB_MINUTES[0] && this.pendingRestart?.kind !== 'penalty') this.autoSubs();
      // Corners and wide free kicks get a beat longer so the box can fill.
      const pr = this.pendingRestart;
      const beat = pr && (isCrossingRestart(this, pr) || isDirectFreeKick(this, pr)) ? 1.3 : 0.85;
      if (this.phaseT > beat && pr) this.beginRestart(pr);
    }

    if (this.phase === 'play' || this.phase === 'out' || this.phase === 'restart') {
      this.clock += dt;
      if (this.possessionSide !== -1) this.stats.possession[this.possessionSide as Side] += dt;
      if (this.clock >= this.cfg.halfLength && this.phase === 'play') {
        const b = this.ball.pos;
        const danger = Math.abs(b.x) > HALF_L - BOX_DEPTH - 6 && Math.abs(b.z) < BOX_W / 2 + 4;
        // Never blow while the ball is in the air, a shot is live or a set piece has just been taken.
        // (Nor while the referee is waiting to see whether an advantage comes off.)
        const live = b.y > 1 || this.shotClock < 1.5 || this.phaseT < 2.5 || this.adv !== null;
        if ((!danger && !live) || this.clock > this.cfg.halfLength + 8) this.endHalf();
      }
    }
    this.passT += dt;
    if (this.passT > 3.2) this.passTarget = -1;
    this.shotClock += dt;
    this.sinceKick += dt;
    this.sincePossession += dt;
    if (this.ball.owner >= 0) this.players[this.ball.owner].ballT += dt;
  }

  private endHalf(): void {
    this.ball.owner = -1;
    this.offWatch = null;
    this.adv = null;
    for (const p of this.players) {
      p.order = null;
      p.wantX = p.wantZ = 0;
    }
    if (this.half === 1) {
      this.phase = 'halftime';
      this.events.push({ type: 'whistle', kind: 'long' }, { type: 'halftime' });
    } else if (this.cfg.knockout && this.score[0] === this.score[1]) {
      this.events.push({ type: 'whistle', kind: 'end' });
      this.startShootout();
      return;
    } else {
      this.phase = 'fulltime';
      this.events.push({ type: 'whistle', kind: 'end' }, { type: 'fulltime' });
    }
    this.phaseT = 0;
  }

  // ---------------------------------------------------------------- ball path prediction

  updateBallPath(): void {
    const path = this.ballPath;
    path.length = 0;
    const b = this.ball;
    if (b.owner >= 0) {
      const o = this.players[b.owner];
      for (let i = 1; i <= 16; i++) {
        const t = i * 0.1;
        path.push({ t, x: b.pos.x + o.vel.x * t, y: b.pos.y, z: b.pos.z + o.vel.z * t });
      }
      return;
    }
    let x = b.pos.x, y = b.pos.y, z = b.pos.z;
    let vx = b.vel.x, vy = b.vel.y, vz = b.vel.z;
    const dt = 0.05;
    for (let i = 1; i <= 64; i++) {
      const grounded = y <= BALL_R + 0.01 && Math.abs(vy) < 0.9;
      if (grounded) {
        y = BALL_R;
        vy = 0;
        const sh = Math.hypot(vx, vz);
        if (sh > 1e-3) {
          const ns = Math.max(0, sh - (ROLL_A + ROLL_B * sh) * dt);
          vx *= ns / sh;
          vz *= ns / sh;
        }
      } else {
        vy -= GRAVITY * dt;
        const sp = Math.hypot(vx, vy, vz);
        const k = AIR_DRAG * sp * dt;
        vx -= vx * k;
        vy -= vy * k;
        vz -= vz * k;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (y < BALL_R) {
        y = BALL_R;
        vy = vy < -1.1 ? -vy * 0.56 : 0;
        vx *= 0.86;
        vz *= 0.86;
      }
      if (i % 2 === 0) path.push({ t: i * dt, x, y, z });
    }
  }

  // ---------------------------------------------------------------- orders & kicking

  order(
    p: Player, kind: KickKind, dirX: number, dirZ: number, power: number, target: number,
    firstTime: boolean, aim?: { x: number; z: number }, land?: number,
  ): KickOrder | null {
    if (p.sentOff) return null;
    if (this.stepIn === p.idx && p.order) return null; // already on his way in to strike it
    if (p.state !== 'move' && p.state !== 'hold' && !(p.state === 'kick' && p.poke)) return null;
    p.order = {
      kind, dirX, dirZ, power, target, firstTime,
      aimX: aim?.x, aimZ: aim?.z, land,
      expires: firstTime ? 0.6 : 0.6,
    };
    if (!firstTime && this.usesRunUp(p) && p.state === 'move') {
      // Step in from the run-up first (holdDeadBall walks him in, then starts the kick).
      this.stepIn = p.idx;
      this.stepInT = 0;
      p.kickLeg = this.runUpFoot;
      return p.order;
    }
    if (!firstTime) {
      const run = p.speed();
      p.setState(kind === 'throw' || (kind === 'keeper' && p.isKeeper) ? 'throw' : 'kick');
      p.kickT = 0;
      p.kickLeg = this.strikeFoot(p);
      // A shot: he opens his body to the goal as he winds up (Player.kickFace).
      if (kind === 'shot' && this.phase === 'play') p.kickFace = Math.atan2(-this.ball.pos.z * 0.5, this.attackDir(p.side) * HALF_L - this.ball.pos.x);
      if (kind === 'shot' && this.phase === 'play' && run > PLANT_SPEED) {
        // Out of a sprint: a plant step first, braking into the strike.
        const k = clamp((run - PLANT_SPEED) / (SPRINT_SPEED - PLANT_SPEED), 0, 1);
        p.plant = 0.5 + 0.5 * k;
        p.kickWindup += PLANT_MIN + (PLANT_MAX - PLANT_MIN) * k;
      }
    }
    return p.order;
  }

  /**
   * The foot `p` strikes the ball with: the one on the ball's side of his body, unless it's near enough the
   * middle for him to shape up to it with his good foot.
   */
  private strikeFoot(p: Player): 1 | -1 {
    const bx = this.ball.pos.x - p.pos.x;
    const bz = this.ball.pos.z - p.pos.z;
    const side = -Math.sin(p.facing) * bx + Math.cos(p.facing) * bz;
    if (Math.abs(side) < STRONG_SIDE) return p.foot;
    return side > 0 ? 1 : -1;
  }

  private ballReach(p: Player): 'foot' | 'head' | null {
    const b = this.ball.pos;
    const df = dist2(p.footX(), p.footZ(), b.x, b.z);
    if (df < 1.0 && b.y < 1.05) return 'foot';
    const dh = dist2(p.pos.x, p.pos.z, b.x, b.z);
    // A leaping player reaches higher.
    if (dh < 0.95 && b.y >= 1.05 && b.y < 2.55 + p.y) return 'head';
    return null;
  }

  /**
   * A player waiting on a first-time ball that will arrive above head height takes off early: when
   * the ball is HEADER_LEAD from his head he leaps, so he meets it near the top of the jump rather
   * than flat-footed. The flight is projected with the same air model as the ball (and the player
   * carried on at his current velocity).
   */
  private headerJump(p: Player): void {
    const b = this.ball;
    if (p.y > 0 || p.state !== 'move' || b.owner >= 0 || b.held) return;
    if (b.pos.y < 0.9 && b.vel.y < 2) return;
    let x = b.pos.x;
    let y = b.pos.y;
    let z = b.pos.z;
    let vx = b.vel.x;
    let vy = b.vel.y;
    let vz = b.vel.z;
    const dt = 1 / 60;
    for (let i = 1; i <= 27; i++) {
      vy -= GRAVITY * dt;
      const k = AIR_DRAG * Math.hypot(vx, vy, vz) * dt;
      vx -= vx * k;
      vy -= vy * k;
      vz -= vz * k;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (y < BALL_R + 0.05) return; // lands first: it's a volley or a bouncing ball
      const t = i * dt;
      const d = dist2(p.pos.x + p.vel.x * t, p.pos.z + p.vel.z * t, x, z);
      if (d < 0.95 && y < 2.55 + 0.49) {
        if (y >= HEADER_JUMP_Y && t <= HEADER_LEAD) {
          p.vy = HEADER_VY;
          p.y = 0.01;
        }
        return;
      }
    }
  }

  private resolveOrders(dt: number): void {
    const kick0 = this.kickId;
    const contact: { p: Player; reach: 'foot' | 'head' }[] = [];
    for (const p of this.players) {
      const o = p.order;
      if (!o) continue;
      o.expires -= dt;
      if (o.firstTime) {
        if (p.state !== 'move' || o.expires < 0) {
          p.order = null;
          continue;
        }
        if (this.ball.held) continue;
        if (this.ball.owner >= 0 && this.ball.owner !== p.idx) continue;
        this.headerJump(p);
        const reach = this.ballReach(p);
        if (reach) contact.push({ p, reach });
        continue;
      }
      // (A kick's contact: KICK_WINDUP, longer for a human's strike or a plant step: Player.kickWindup.)
      const windup = p.state === 'throw' ? 0.26 : p.kickWindup;
      if (this.stepIn === p.idx && p.state === 'move') continue;
      if (p.state !== 'kick' && p.state !== 'throw') {
        p.order = null;
        continue;
      }
      if (p.stateT < windup) continue;
      const held = this.ball.held && this.ball.owner === p.idx;
      const reach = held || this.ball.owner === p.idx ? 'foot' : this.ballReach(p);
      if (reach && (this.ball.owner < 0 || this.ball.owner === p.idx)) this.execute(p);
      p.order = null;
    }
    // First-time strikes and headers: when several players meet the same ball in the same tick,
    // one of them wins the contact (a fair draw, weighted to the better in the air), not whoever
    // happens to be last in the list.
    if (contact.length === 0 || this.kickId !== kick0) return;
    let win = contact[0];
    const duel = contact.length > 1 && contact.some((c) => c.p.side !== contact[0].p.side);
    if (contact.length > 1) {
      let tot = 0;
      const w = contact.map((c) => {
        let s = c.reach === 'head' ? 0.6 + (c.p.stat.defending + c.p.stat.shooting) / 400 : 1;
        // Attacking the ball at pace (a runner onto a cross) beats standing and waiting for it,
        // and so does getting up early for it.
        if (c.p.speed() > 4.5) s *= 1.3;
        if (c.reach === 'head' && c.p.y > 0.25) s *= 1.15;
        tot += s;
        return s;
      });
      let r = this.rng.next() * tot;
      for (let i = 0; i < contact.length; i++) {
        r -= w[i];
        if (r <= 0) {
          win = contact[i];
          break;
        }
      }
    }
    // The losers of a 50/50 are knocked off balance.
    if (duel) for (const c of contact) if (c.p.side !== win.p.side) c.p.stumbleT = Math.max(c.p.stumbleT, STUMBLE_BUMP);
    // Aerial duel: the loser sometimes goes through the back of the winner (or pushes him).
    if (duel && win.reach === 'head' && this.phase === 'play') {
      const loser = contact.find((c) => c.p.side !== win.p.side && dist2(c.p.pos.x, c.p.pos.z, win.p.pos.x, win.p.pos.z) < 1.6);
      if (loser && !loser.p.isKeeper && this.rng.chance(AERIAL_FOUL * this.foulScale)) {
        win.p.order = null;
        loser.p.order = null;
        this.foul(loser.p, win.p);
        return;
      }
    }
    this.firstTimeContact(win.p, win.reach);
  }

  /** Execute a first-time order at the moment of contact (volley, or header when it's at head height). */
  private firstTimeContact(p: Player, reach: 'foot' | 'head'): void {
    const o = p.order;
    if (!o) return;
    if (reach === 'head') {
      if (o.kind === 'shot') o.kind = 'header';
      else if (o.kind !== 'header') {
        o.kind = 'header';
        if (o.target < 0 && o.aimX === undefined) {
          // Header pass along the aim.
          const l = Math.hypot(o.dirX, o.dirZ) || 1;
          o.aimX = p.pos.x + (o.dirX / l) * 14;
          o.aimZ = p.pos.z + (o.dirZ / l) * 14;
        }
      }
      p.headerT = 1;
      // Normally already in the air (headerJump); a ball that got there too quickly for that is
      // still met with a spring off the ground if it's high.
      if (p.y === 0 && this.ball.pos.y > HEADER_JUMP_Y + 0.15) {
        p.vy = HEADER_VY * 0.8;
        p.y = 0.01;
      }
    } else if (o.kind === 'header') {
      // Ball dropped below head height: volley a header shot, otherwise knock the aimed ball on.
      o.kind = o.aimX === undefined && o.target < 0 ? 'shot' : 'lob';
    }
    p.setState('kick');
    p.kickT = 0.32;
    if (reach === 'foot') p.kickLeg = this.strikeFoot(p);
    this.execute(p);
  }

  private execute(p: Player): void {
    const o = p.order;
    if (!o) return;
    // First to a pass he was offside for: the flag is up before he can do anything with it.
    if (this.offsideTouch(p)) {
      p.order = null;
      return;
    }
    const b = this.ball;
    if (b.held && b.owner === p.idx) {
      b.held = false;
      if (o.kind === 'throw' || o.kind === 'keeper') {
        b.pos.x = p.pos.x + Math.cos(p.facing) * 0.35;
        b.pos.z = p.pos.z + Math.sin(p.facing) * 0.35;
        b.pos.y = o.kind === 'throw' ? 2.1 : 1.5;
      } else {
        b.pos.x = p.pos.x + Math.cos(p.facing) * 0.6;
        b.pos.z = p.pos.z + Math.sin(p.facing) * 0.6;
        b.pos.y = 0.55;
      }
    }
    const so = this.phase === 'shootout' && this.shootout?.taker === p.idx ? this.shootout : null;
    // Timed finishing: a second tap before the strike is judged now, at contact.
    const timed = this.finish && this.finish.p === p.idx && this.finish.contact < 0 && o.kind === 'shot' ? this.finish : null;
    let grade: TimingGrade | null = null;
    if (timed && timed.tap >= 0) {
      const off = timed.t - timed.tap;
      grade = off <= FINISH_WINDOWS.perfect + 1e-6 ? 'perfect' : off <= FINISH_WINDOWS.good + 1e-6 ? 'good' : 'early';
      o.finish = TIMING_ERR[grade];
      o.wild = grade === 'early';
    }
    const L = so?.pen ? penaltyLaunch(this, p, so.pen) : resolveKick(this, p, o);
    b.owner = -1;
    b.vel.x = L.vx;
    b.vel.y = L.vy;
    b.vel.z = L.vz;
    b.spin.x = L.spinX;
    b.spin.y = L.spinY;
    b.spin.z = L.spinZ;
    if (b.pos.y < BALL_R) b.pos.y = BALL_R;
    if (L.vy > 0.5 && b.pos.y <= BALL_R + 0.01) b.pos.y = BALL_R + 0.02;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.3;
    p.order = null;
    this.kickId++;
    this.sinceKick = 0;
    this.kickX = b.pos.x;
    this.kickZ = b.pos.z;
    this.kickSide = p.side;
    this.kickKind = L.kind;
    const isShot = L.kind === 'shot' || (L.kind === 'header' && L.target < 0 && o.aimX === undefined);
    if (isShot) {
      this.shotClock = 0;
      this.shotSide = p.side;
      this.stats.shots[p.side]++;
      this.shotOnTarget = onTarget(this, p.side);
      if (this.shotOnTarget) this.stats.onTarget[p.side]++;
      this.shooter = p.idx;
      this.shotKick = this.kickId;
      this.shotWasOnTarget = this.shotOnTarget;
      this.shotSpeed = Math.hypot(L.vx, L.vy, L.vz);
      this.shotDist = dist2(b.pos.x, b.pos.z, this.attackDir(p.side) * HALF_L, 0);
      this.shotCurl = clamp(Math.abs(L.spinY) / CURL_SPIN, 0, 1);
      this.shotStyle = L.style ?? null;
      this.shotWeakFoot = !!L.weak;
      this.shotBalance = L.balance ?? 0;
      this.shotByHuman = this.isHumanControlled(p);
      this.shotTiming = grade;
      if (timed) {
        timed.contact = timed.t;
        timed.kick = this.kickId;
        timed.aim = L.aim ?? null;
        if (grade) this.events.push({ type: 'timing', player: p.idx, grade });
      }
      const rr = this.restart;
      if (this.phase === 'restart' && rr && rr.taker === p.idx && isDirectFreeKick(this, rr)) this.fkShotKick = this.kickId;
      this.passTarget = -1;
    } else {
      this.passTarget = L.target;
      this.passT = 0;
      if (L.target >= 0) this.stats.passes[p.side]++;
    }
    // Offside is judged the moment a pass is played (never from a throw-in, corner or goal kick).
    this.offWatch = null;
    const rs = this.restart;
    const noOffside = this.phase === 'restart' && rs && rs.taker === p.idx &&
      (rs.kind === 'throwin' || rs.kind === 'corner' || rs.kind === 'goalkick');
    if (this.offside && !isShot && L.kind !== 'clear' && L.kind !== 'throw' && !noOffside && this.phase !== 'shootout') {
      const off: number[] = [];
      for (const q of this.bySide[p.side]) {
        if (q !== p && this.inOffsidePosition(q)) off.push(q.idx);
      }
      if (off.length) this.offWatch = { kick: this.kickId, side: p.side, passer: p.idx, players: off };
    }
    this.events.push({ type: 'kick', power: L.power, x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: L.kind, ...(L.style ? { style: L.style } : {}) });
    if (this.cfg.humanSide === p.side && L.target >= 0 && !isShot) {
      const r = this.players[L.target];
      if (r.side === p.side) this.active = r.idx;
    }
    const r = this.restart;
    if (this.phase === 'restart' && r && r.taker === p.idx) {
      if (isCrossingRestart(this, r)) {
        this.setPieceKick = this.kickId;
        this.setPieceDriven = !!o.driven;
        this.spContest = this.rng.chance(0.45);
      }
      if (isDirectFreeKick(this, r)) {
        this.wallKick = this.kickId;
        this.wall = [...this.brains[r.side === 0 ? 1 : 0].spWall];
        this.wallJumped = false;
      }
    }
    if (this.phase === 'kickoff' || this.phase === 'restart') {
      if (this.phase === 'kickoff') this.events.push({ type: 'whistle', kind: 'short' });
      this.phase = 'play';
      this.phaseT = 0;
      this.restart = null;
    }
    if (so?.stage === 'aim') this.shootoutStrike();
  }

  keeperDistribute(k: Player, dirX = 0, dirZ = 0, long = false): void {
    if (k.state !== 'hold') return;
    const ad = this.attackDir(k.side);
    if (dirX !== 0 || dirZ !== 0) {
      const tgt = pickReceiver(this, k, dirX, dirZ, long ? 'lob' : 'pass');
      k.setState('move');
      // (The human's keeper turns to the man it's for first, so it leaves his hands towards him.)
      const t = tgt >= 0 ? this.players[tgt] : null;
      k.facing = t ? Math.atan2(t.pos.z - k.pos.z, t.pos.x - k.pos.x) : Math.atan2(dirZ, dirX);
      this.order(k, long ? 'lob' : 'keeper', dirX, dirZ, 1, tgt, false);
      return;
    }
    // AI: short to a free defender, otherwise launch it.
    let best = -1;
    let bestS = -Infinity;
    for (const t of this.bySide[k.side]) {
      if (t === k || t.sentOff) continue;
      const d = dist2(k.pos.x, k.pos.z, t.pos.x, t.pos.z);
      if (d > 28 || d < 6) continue;
      // Never roll it across the face of our own goal.
      if (Math.sign(t.pos.z) !== Math.sign(k.pos.z) && Math.abs(t.pos.z - k.pos.z) > 16) continue;
      let open = 10;
      for (const o of this.bySide[k.side === 0 ? 1 : 0]) if (!o.sentOff) open = Math.min(open, dist2(o.pos.x, o.pos.z, t.pos.x, t.pos.z));
      const s = open - d * 0.08 + this.rng.next() * 2;
      if (s > bestS) {
        bestS = s;
        best = t.idx;
      }
    }
    k.setState('move');
    if (best >= 0 && bestS > 5 && this.rng.chance(0.7)) {
      const t = this.players[best];
      this.order(k, 'keeper', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 0.6, best, false);
    } else {
      let fw = -1;
      let fd = -Infinity;
      for (const t of this.bySide[k.side]) {
        if (t.sentOff || t.isKeeper || (this.offside && this.inOffsidePosition(t))) continue;
        const s = t.pos.x * ad + this.rng.next() * 12 - (t.role === 'DF' ? 30 : 0);
        if (s > fd) {
          fd = s;
          fw = t.idx;
        }
      }
      if (fw < 0) {
        this.order(k, 'clear', ad, 0, 1, -1, false, { x: k.pos.x + ad * 40, z: 0 });
        return;
      }
      const t = this.players[fw];
      this.order(k, 'lob', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 1, fw, false);
    }
  }

  /**
   * Skill move: push the ball 5–6 m ahead and burst after it. (It used to leave the foot at 13-15 m/s and
   * roll ~18 m: he only caught it ~12 m on, often after a defender had. Bent round a defender in its line.)
   */
  knockOn(p: Player, dirX: number, dirZ: number): void {
    const b = this.ball;
    const l = Math.hypot(dirX, dirZ) || 1;
    const k = knockAssist(this, p, dirX / l, dirZ / l);
    const ux = k.x;
    const uz = k.z;
    const sp = Math.max(p.speed(), 4) + 4.5 + (p.stat.pace / 100) * 1.5;
    b.owner = -1;
    b.vel.x = ux * sp;
    b.vel.z = uz * sp;
    b.vel.y = 0.6;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.32;
    p.burstT = 1.1;
    p.facing = Math.atan2(uz, ux);
    this.passTarget = -1;
    this.events.push({ type: 'kick', power: 0.3, x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: 'pass' });
    this.events.push({ type: 'skill', player: p.idx });
  }

  /** Keeper with the ball at their feet: safe pass if one is on, otherwise hoof it. */
  keeperClear(k: Player): void {
    const ad = this.attackDir(k.side);
    let best = -1;
    let bestS = -Infinity;
    for (const t of this.bySide[k.side]) {
      if (t === k || t.sentOff) continue;
      const d = dist2(k.pos.x, k.pos.z, t.pos.x, t.pos.z);
      if (d < 6 || d > 30) continue;
      let open = 10;
      for (const o of this.bySide[k.side === 0 ? 1 : 0]) if (!o.sentOff) open = Math.min(open, dist2(o.pos.x, o.pos.z, t.pos.x, t.pos.z));
      if (open - d * 0.1 > bestS) {
        bestS = open - d * 0.1;
        best = t.idx;
      }
    }
    if (best >= 0 && bestS > 4) {
      const t = this.players[best];
      this.order(k, 'pass', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 0.6, best, false);
    } else {
      this.order(k, 'clear', ad, 0, 1, -1, false, { x: k.pos.x + ad * 45, z: (this.rng.next() - 0.5) * 30 });
    }
  }

  // ---------------------------------------------------------------- human control

  private applyHuman(dt: number, pad: Pad): void {
    const hs = this.cfg.humanSide;
    if (hs < 0) return;
    const side = hs as Side;
    const passP = pad.pass && !this.prev.pass;
    // Timed finishing: a SHOOT press while a strike is being timed is its second tap (judged, and used up:
    // it doesn't slide, charge or strike again until it's let go).
    this.finishTick(dt);
    if (pad.shoot && !this.prev.shoot && this.finishTap()) this.finishHeld = true;
    const shootP = pad.shoot && !this.prev.shoot && !this.finishHeld;
    const shootR = !pad.shoot && this.prev.shoot && !this.finishHeld;
    if (!pad.shoot) this.finishHeld = false;
    const throughP = pad.through && !this.prev.through;
    const throughR = !pad.through && this.prev.through;
    const stickLen = Math.hypot(pad.mx, pad.mz);
    // Charge is measured while held and read on the release frame.
    const shootPower = clamp(this.shootCharge / SHOOT_BAR, 0.15, 1);
    const throughHold = this.throughCharge;
    if (!pad.shoot && !this.prev.shoot) this.chipArmed = false;
    this.shootCharge = pad.shoot && !this.finishHeld ? this.shootCharge + (dt * SHOOT_BAR) / SHOOT_FULL_T : 0;
    this.throughCharge = pad.through ? this.throughCharge + dt : 0;
    if (this.phase === 'shootout') {
      this.shootoutInput(pad, shootR, shootPower, stickLen);
      return;
    }
    // A pass being charged doesn't outlive open play.
    if (this.hp && this.phase !== 'play') this.endPass();

    // Set pieces we're taking.
    if ((this.phase === 'kickoff' || this.phase === 'restart') && this.restart && this.restart.side === side) {
      const t = this.players[this.restart.taker];
      this.active = t.idx;
      t.wantX = t.wantZ = 0;
      const kind = this.restart.kind;
      // Keyboard / d-pad (no analog magnitude): remembered from the last time the stick was pushed.
      if (stickLen > 0.3) this.padDigital = pad.digital ?? isDigitalStick(pad.mx, pad.mz, this.restartAim);
      else if (pad.digital !== undefined) this.padDigital = pad.digital;
      // On free kicks and corners the keys turn the aim steadily (AIM_TURN) from the default instead of
      // snapping it to one of eight directions; W (towards goal) puts it back. An analog stick aims
      // directly. On the frame a free kick is struck the stick is read for curl only, so a flick
      // sideways bends the ball without swinging the aim.
      const rotating = this.padDigital && this.phase === 'restart' && (kind === 'freekick' || kind === 'corner');
      const striking = kind === 'freekick' && (shootR || throughR || passP);
      if (stickLen > 0.3 && kind !== 'kickoff' && this.stepIn !== t.idx && !striking) {
        const want = Math.atan2(pad.mz, pad.mx);
        if (!rotating) t.facing = want;
        else {
          const off = angleDiff(this.restartAim, want);
          if (Math.abs(off) < 0.3) t.facing = this.restartAim;
          else if (Math.abs(off) < 2.6) t.facing = turnToward(t.facing, want, AIM_TURN * dt);
        }
      }
      if (this.phase === 'restart' && this.phaseT < 0.35) return;
      const useStick = stickLen > 0.3 && !rotating;
      const dx = useStick ? pad.mx : Math.cos(t.facing);
      const dz = useStick ? pad.mz : Math.sin(t.facing);
      // A free kick is struck where the aim arrow (the taker's facing) meets the goal line; left on
      // the default aim, he picks the side the keeper leaves open himself.
      const fkShot = (pw: number) => {
        const o = this.order(t, 'shot', Math.cos(t.facing), Math.sin(t.facing), pw, -1, false);
        if (o) {
          o.curl = stickCurl(pad.mz);
          const az = Math.abs(angleDiff(this.restartAim, t.facing)) > 0.01 ? this.aimOnGoalLine(t) : null;
          if (az !== null) o.aimZ = az;
          else o.dirZ = 0;
        }
      };
      // Crossing set pieces: hold the delivery (briefly) until the runners are in the box, but
      // remember the button so the kick goes the moment they are.
      if (this.phase === 'restart' && isCrossingRestart(this, this.restart)) {
        let want: (() => void) | null = null;
        // No stick (or, on the keys, the default aim): whip it into the zone a runner is attacking.
        const aimed = rotating ? Math.abs(angleDiff(this.restartAim, t.facing)) > 0.04 : stickLen > 0.3;
        if (passP && !aimed && kind === 'corner') {
          // Played short to the man who came across for it: no need to wait for the box.
          this.queuedKick = null;
          this.shortCorner(t);
          return;
        }
        if (passP) want = aimed ? () => this.order(t, 'pass', dx, dz, 0.6, -1, false) : () => this.deliverSetPiece(t, 0.7);
        else if (throughR) {
          const pw = clamp(throughHold / 0.8, 0.3, 1);
          want = aimed ? () => this.order(t, 'lob', dx, dz, pw, -1, false) : () => this.deliverSetPiece(t, pw);
        } else if (shootR && kind === 'freekick') {
          const pw = shootPower;
          want = () => fkShot(pw);
        } else if (shootR) {
          // SHOOT on a corner: a driven cross, flat and fast, whipped at a box runner's zone (the aim picks
          // which runner; left alone, the near-post one). It used to fly along the aim at whoever the
          // pass assist found (often the short man, or nobody, and out for a throw on the far side).
          const aim = aimed ? { x: dx, z: dz } : undefined;
          want = () => this.deliverSetPiece(t, DRIVEN_POWER, true, aim);
        }
        if (want) this.queuedKick = want;
        if (setPieceReady(this, side) < 4 && this.phaseT < 1.6) return;
        const q = this.queuedKick;
        this.queuedKick = null;
        q?.();
        return;
      }
      if (kind === 'kickoff') {
        if (passP || throughP || shootP) {
          const ad = this.attackDir(side);
          const kx = stickLen > 0.3 ? pad.mx : -ad * 0.4;
          const kz = stickLen > 0.3 ? pad.mz : 1;
          this.order(t, 'pass', kx, kz, 0.5, -1, false);
        }
      } else if (kind === 'throwin') {
        if (passP || throughP) this.order(t, 'throw', dx, dz, 0.5, -1, false);
      } else {
        const fdx = kind === 'freekick' ? Math.cos(t.facing) : dx;
        const fdz = kind === 'freekick' ? Math.sin(t.facing) : dz;
        if (passP) this.order(t, 'pass', fdx, fdz, 0.6, -1, false);
        else if (throughR) this.order(t, 'lob', fdx, fdz, clamp(throughHold / 0.8, 0.3, 1), -1, false);
        else if (shootR && kind === 'freekick') fkShot(shootPower);
        // Penalties are struck clean.
        else if (shootR && kind === 'penalty') this.order(t, 'shot', dx, dz, shootPower, -1, false);
        else if (shootR) this.order(t, 'lob', fdx, fdz, 1, -1, false);
      }
      return;
    }
    if (this.phase !== 'play') {
      // Free movement while the ball is dead.
      if (this.phase !== 'kickoff' && this.active >= 0 && this.players[this.active].side === side && !this.players[this.active].sentOff) {
        const p = this.players[this.active];
        p.wantX = pad.mx;
        p.wantZ = pad.mz;
        p.sprint = pad.sprint;
        p.faceTarget = null;
      }
      return;
    }

    const b = this.ball;
    // Our keeper has it in their hands: they're ours to distribute.
    if (b.held && b.owner >= 0 && this.players[b.owner].side === side) {
      const k = this.players[b.owner];
      this.active = k.idx;
      if (this.hp) this.endPass();
      const dx = stickLen > 0.3 ? pad.mx : this.attackDir(side);
      const dz = stickLen > 0.3 ? pad.mz : 0;
      if (k.stateT > 0.4) {
        if (passP) this.keeperDistribute(k, dx, dz, false);
        else if (throughP || shootP) this.keeperDistribute(k, dx, dz, true);
      }
      return;
    }

    if (this.active < 0 || this.players[this.active].side !== side || this.players[this.active].sentOff) {
      this.active = this.nearestTo(side, b.pos.x, b.pos.z, true);
    }
    if (this.active < 0) return;
    const p = this.players[this.active];
    const hasBall = b.owner === p.idx;
    this.trackSwitch(p, pad, stickLen, hasBall, dt);
    p.faceTarget = null;
    // Winding up a shot he mostly plants and aims: the stick picks the corner, it doesn't carry him (he
    // used to be dragged ~4 m sideways by a stick held across the goal while charging).
    const move = hasBall && pad.shoot ? SHOOT_CHARGE_MOVE : 1;
    p.wantX = pad.mx * move;
    p.wantZ = pad.mz * move;
    p.sprint = pad.sprint && move === 1;
    // Dribble assists: close control, skill cuts, shielding, path assist (dribble.ts).
    if (hasBall && !b.held) humanDribble(this, p, pad, stickLen, dt);

    const dirX = stickLen > 0.25 ? pad.mx : Math.cos(p.facing);
    const dirZ = stickLen > 0.25 ? pad.mz : Math.sin(p.facing);
    // Double-tap sprint while dribbling: knock it past your man and chase it.
    this.humanTime += dt;
    if (pad.sprint && !this.prev.sprint) {
      if (hasBall && this.humanTime - this.lastSprintTap < KNOCK_TAP && p.state === 'move' && !b.held) {
        this.knockOn(p, dirX, dirZ);
        this.lastSprintTap = -9;
      } else {
        this.lastSprintTap = this.humanTime;
      }
    }

    // Chip: THROUGH tapped while SHOOT is charging fires it there and then, at the charge so far (or SHOOT
    // let go with THROUGH held).
    const chipTap = throughP && pad.shoot && this.prev.shoot;
    if (chipTap) this.chipArmed = true;
    if (hasBall && b.owner === p.idx) {
      // PASS / THROUGH: charged, with his body turned to the man it's for first (see humanPass).
      if (this.humanPass(p, pad, stickLen, passP, throughP, shootP, dt)) {
        // (The charge, the wait for his turn, or the wind-up: that's this frame.)
      } else if (chipTap) {
        const o = this.order(p, 'shot', stickLen > 0.25 ? pad.mx : 0, stickLen > 0.25 ? pad.mz : 0, shootPower, -1, false);
        if (o) o.style = 'chip';
      } else if (shootR) {
        const sx = stickLen > 0.25 ? pad.mx : 0;
        const sz = stickLen > 0.25 ? pad.mz : 0;
        const o = this.order(p, 'shot', sx, sz, shootPower, -1, false);
        if (o) {
          // Finesse: the stick pushed diagonally at a corner (towards goal and across it, ~25-60 degrees
          // off straight at goal) on a placed (under FINESSE_MAX_POWER) shot: curled away from the
          // keeper into that corner.
          const fwd = (sx * this.attackDir(side)) / Math.max(stickLen, 1e-6);
          const lat = Math.abs(sz) / Math.max(stickLen, 1e-6);
          if (this.chipArmed || pad.through) o.style = 'chip';
          else if (stickLen > 0.5 && fwd > 0.5 && lat > 0.4 && shootPower < FINESSE_MAX_POWER) {
            o.style = 'finesse';
            o.curl = Math.sign(sz) * FINESSE_CURL;
          } else if (stickLen > 0.25) o.curl = stickCurl(pad.mz);
          if (o.style !== 'chip') {
            // A strike (not a chip): the boot meets it a beat later than an AI's, so the second tap can be
            // timed (the same with timed finishing off, so no tap is exactly no tap).
            p.kickWindup += HUMAN_SHOT_WINDUP - KICK_WINDUP;
            this.startFinish(p);
          }
        }
        this.chipArmed = false;
      }
    } else {
      if (this.hp) this.endPass(); // (lost it mid-charge, or it's away)
      const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
      const loose = b.owner < 0 && !b.held;
      const opp = b.owner >= 0 && this.players[b.owner].side !== side;
      if (loose && d < 4) {
        if (passP || (this.passBuffer > 0 && this.passTarget === p.idx)) {
          this.passBuffer = 0;
          const o = this.order(p, 'pass', dirX, dirZ, 0.6, -1, true);
          if (o) o.runSpeed = p.speed();
        } else if (shootP) this.order(p, 'shot', stickLen > 0.25 ? pad.mx : 0, stickLen > 0.25 ? pad.mz : 0, 0.8, -1, true);
        else if (throughP) {
          const o = this.order(p, 'through', dirX, dirZ, 0.7, -1, true);
          if (o) o.runSpeed = p.speed();
        } else if (this.passTarget === p.idx && !p.order) this.autoHeader(p, d);
      } else {
        // A pass on its way to him: PASS now is a first-time ball when it gets there (a one-two), not a
        // switch away from the man it's for.
        if (passP && loose && this.passTarget === p.idx) this.passBuffer = PASS_BUFFER;
        else if (passP) this.switchPlayer(stickLen > 0.3 ? pad.mx : 0, stickLen > 0.3 ? pad.mz : 0);
      }
      // Move assist: the run the AI had him making, just after a switch or with the stick left alone.
      this.moveAssistRun(p, pad, stickLen);
      // Hold "press" to have your player close the carrier down automatically: goal-side of the ball, reading
      // his run, facing it; an exposed touch is poked away (pressSteal).
      if (pad.through && opp && stickLen < 0.3) {
        const c = this.players[b.owner];
        const gx = -this.attackDir(side) * HALF_L;
        const ux = gx - c.pos.x;
        const uz = -c.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        const tx = b.pos.x + c.vel.x * PRESS_LEAD + (ux / ul) * PRESS_GAP - p.pos.x;
        const tz = b.pos.z + c.vel.z * PRESS_LEAD + (uz / ul) * PRESS_GAP - p.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        const f = Math.min(1, tl / 0.6);
        p.wantX = (tx / tl) * f;
        p.wantZ = (tz / tl) * f;
        p.sprint = tl > 2;
        if (d < 3.5) p.faceTarget = Math.atan2(b.pos.z - p.pos.z, b.pos.x - p.pos.x);
        pressSteal(this, p, c);
      }
      // TACKLE (SHOOT) while they have it: tap for a standing tackle (closing first from further off), hold or
      // double-tap for a slide (dribble.ts).
      humanTackle(this, p, pad, shootP, stickLen, dt);
      // Assisted receive: if a pass is on its way to you and you're not steering, go meet it (at a
      // sprint when it's a few metres off: an AI man racing for it would). Still holding the stick the
      // way it was when control came to him (he just played the pass along it) isn't steering, and
      // nor, just after the switch, is a stick roughly along the run to it.
      if (this.passTarget === p.idx && this.receiveAssisted(p, pad, stickLen)) {
        const i = intercept(this, p);
        const tx = i.x - p.pos.x;
        const tz = i.z - p.pos.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 0.3) {
          p.wantX = (tx / tl) * Math.min(1, tl / 2);
          p.wantZ = (tz / tl) * Math.min(1, tl / 2);
          if (tl > RECEIVE_SPRINT) p.sprint = true;
        }
      }
    }
  }

  /**
   * PASS / THROUGH with the ball at the human's feet (open play). Pressing starts a charge (passCharge rises
   * 0..1 over PASS_CHARGE_T s for PASS; THROUGH's bar is its hold time, see THROUGH_LOB_HOLD). While the
   * button is held the stick picks the man it's locked onto (passAim, picked again as the stick swings) and
   * he turns his body to him (PASS_TURN, slower at speed), slowed to PASS_CHARGE_MOVE of his pace. Let go and
   * it's played to that man: a tap (under PASS_TAP s) at the pace the assist judges, a longer PASS hold at
   * the charged pace (nudged by the assist level, see actions.assistPace), a THROUGH hold as a lofted ball
   * whose charge is its carry. Let go with his body still more than PASS_SQUARE_MAX off the line and the kick
   * waits (at most PASS_TURN_WAIT s) for the turn; through the wind-up he keeps turning to it. A PASS pressed
   * while a pass was on its way to him (passBuffer) starts one as he takes it. True while the pass owns the
   * frame (the charge, the wait, the wind-up).
   */
  private humanPass(
    p: Player, pad: Pad, stickLen: number, passP: boolean, throughP: boolean, shootP: boolean, dt: number,
  ): boolean {
    let hp = this.hp;
    if (hp && hp.player !== p.idx) {
      this.endPass();
      hp = null;
    }
    if (!hp) {
      const btn = passP || this.passBuffer > 0 ? 'pass' : throughP && !pad.shoot && !this.chipArmed ? 'through' : null;
      this.passBuffer = 0;
      if (!btn || p.state !== 'move') return false;
      const l = stickLen > 0.25 ? stickLen : 0;
      hp = this.hp = {
        btn, player: p.idx, t: 0,
        dirX: l ? pad.mx / l : Math.cos(p.facing), dirZ: l ? pad.mz / l : Math.sin(p.facing),
        released: false, wait: 0, target: -1, mode: btn, pickT: Infinity, pickA: 0, line: p.facing, ordered: false, relSpeed: 0,
      };
    }
    if (hp.ordered) {
      // Winding up: his body keeps coming round to the line.
      if (p.order && p.state === 'kick') {
        p.facing = turnToward(p.facing, hp.line, this.passTurnRate(p) * dt);
        return true;
      }
      this.endPass();
      return false;
    }
    // SHOOT pressed mid-charge: it's a shot (or, THROUGH held, a chip) instead.
    if (shootP) {
      this.endPass();
      return false;
    }
    const held = hp.btn === 'pass' ? pad.pass : pad.through;
    const letGo = !hp.released && !held;
    if (!hp.released) {
      if (stickLen > 0.25) {
        hp.dirX = pad.mx / stickLen;
        hp.dirZ = pad.mz / stickLen;
      }
      if (held) hp.t += dt;
      else {
        hp.released = true;
        hp.relSpeed = p.speed();
      }
    } else hp.wait += dt;
    const mode = hp.btn === 'pass' ? 'pass' : hp.t < THROUGH_LOB_HOLD ? 'through' : 'lob';
    // The lock-on follows the stick while it's held (and on the frame it's let go).
    hp.pickT += dt;
    const a = Math.atan2(hp.dirZ, hp.dirX);
    if ((!hp.released || letGo) && (mode !== hp.mode || hp.pickT >= PASS_REPICK || Math.abs(angleDiff(hp.pickA, a)) > PASS_REPICK_ANGLE)) {
      hp.target = pickReceiver(this, p, hp.dirX, hp.dirZ, mode);
      hp.mode = mode;
      hp.pickT = 0;
      hp.pickA = a;
    }
    const b = this.ball.pos;
    const pt = passAimPoint(this, p, hp.target, mode, hp.dirX, hp.dirZ);
    hp.line = Math.atan2(pt.z - b.z, pt.x - b.x);
    this.passAim = hp.target;
    this.passMode = mode;
    this.passCharge = hp.btn === 'pass' && !hp.released ? clamp(hp.t / PASS_CHARGE_T, 0, 1) : -1;
    // Square up to it, at a controlled pace (locomote holds the facing he's turned to).
    p.facing = turnToward(p.facing, hp.line, this.passTurnRate(p) * dt);
    p.faceTarget = p.facing;
    p.wantX = pad.mx * PASS_CHARGE_MOVE;
    p.wantZ = pad.mz * PASS_CHARGE_MOVE;
    p.sprint = false;
    if (!hp.released) return true;
    // Still side-on to it: a few frames more for the turn (the wind-up squares him up the rest of the way).
    if (Math.abs(angleDiff(p.facing, hp.line)) > PASS_SQUARE_MAX && hp.wait < PASS_TURN_WAIT) return true;
    // Play it. (A through ball is always weighted by the assist; a lofted one by its charge.)
    const charge = mode === 'lob' ? clamp(hp.t / LOB_CHARGE_T, 0.3, 1)
      : mode === 'pass' && hp.t >= PASS_TAP ? clamp(hp.t / PASS_CHARGE_T, 0, 1) : undefined;
    const power = charge ?? (mode === 'through' ? 0.7 : 0.6);
    const o = this.order(p, mode, hp.dirX, hp.dirZ, power, hp.target, false);
    if (!o) {
      // (Not on his feet this instant: try again for a moment, then forget it.)
      if (hp.wait > 0.4) this.endPass();
      return true;
    }
    o.charge = charge;
    o.runSpeed = hp.relSpeed;
    o.bodyOff = Math.abs(angleDiff(p.facing, hp.line));
    hp.ordered = true;
    return true;
  }

  /** The pass charge is over (struck, lost, or play stopped). */
  private endPass(): void {
    this.hp = null;
    this.passCharge = -1;
    this.passAim = -1;
    this.passMode = null;
  }

  /** How fast (rad/s) a passer turns his body to the pass line: PASS_TURN standing, less at speed. */
  private passTurnRate(p: Player): number {
    return PASS_TURN * (1 - PASS_TURN_SPRINT_LOSS * Math.min(1, p.speed() / SPRINT_SPEED));
  }

  /**
   * Keep track of switches (any change of the controlled man: a pass received, a switch, a restart) for
   * move assist: the time since, the stick held at the switch (latched until it's let go or swung, or he
   * has the ball), how long the stick has been left alone, and a buffered PASS that no longer applies.
   */
  private trackSwitch(p: Player, pad: Pad, stickLen: number, hasBall: boolean, dt: number): void {
    if (p.idx !== this.seenActive) {
      this.seenActive = p.idx;
      this.sinceSwitch = 0;
      this.switchT = 0;
      this.latch = stickLen > 0.3 ? { x: pad.mx / stickLen, z: pad.mz / stickLen } : null;
    } else this.sinceSwitch += dt;
    const l = this.latch;
    if (l && (hasBall || stickLen < 0.3 || (pad.mx * l.x + pad.mz * l.z) / stickLen < Math.cos(STICK_LATCH_TURN))) this.latch = null;
    this.stickIdle = stickLen < 0.2 ? this.stickIdle + dt : 0;
    const b = this.ball;
    if ((b.owner >= 0 && b.owner !== p.idx) || (this.passTarget >= 0 && this.passTarget !== p.idx)) this.passBuffer = 0;
    else this.passBuffer = Math.max(0, this.passBuffer - dt);
  }

  /**
   * Move assist (moveAssist) for the human's man off the ball: for MOVE_ASSIST_T s after a switch, with the
   * stick neutral (or still latched) or within MOVE_ASSIST_CONE of it, he keeps making the run the AI had
   * him making (ai.assistRun) instead of stopping dead; with the stick left alone for MOVE_IDLE_T s, he
   * follows his AI positioning / marking at a jog.
   */
  private moveAssistRun(p: Player, pad: Pad, stickLen: number): void {
    if (!this.moveAssist || p.state !== 'move') return;
    const fresh = this.sinceSwitch < MOVE_ASSIST_T;
    const idle = this.stickIdle > MOVE_IDLE_T;
    if (!fresh && !idle) return;
    const run = assistRun(this, p);
    if (!run) return;
    if (fresh) {
      if (stickLen >= 0.2 && !this.latch) {
        const rl = Math.hypot(run.wantX, run.wantZ);
        if (rl < 0.05 || (pad.mx * run.wantX + pad.mz * run.wantZ) / (stickLen * rl) < Math.cos(MOVE_ASSIST_CONE)) return;
      }
      p.sprint = run.sprint || pad.sprint;
    } else p.sprint = false;
    p.wantX = run.wantX;
    p.wantZ = run.wantZ;
    p.faceTarget = run.face;
  }

  /** Does the assisted receive run the human's man onto a pass coming to him (see applyHuman)? */
  private receiveAssisted(p: Player, pad: Pad, stickLen: number): boolean {
    if (stickLen < 0.2 || this.latch) return true;
    if (!this.moveAssist || this.sinceSwitch >= MOVE_ASSIST_T) return false;
    const i = intercept(this, p);
    const tx = i.x - p.pos.x;
    const tz = i.z - p.pos.z;
    const tl = Math.hypot(tx, tz);
    return tl < 0.3 || (pad.mx * tx + pad.mz * tz) / (stickLen * tl) > Math.cos(MOVE_ASSIST_CONE);
  }

  /**
   * A cross or lofted pass is dropping onto the human's man and he hasn't pressed anything: he attacks it
   * anyway, the way an AI teammate would, rather than letting it sail over his head (a human-delivered
   * corner switches control to its target runner, and most of them used to go untouched). In sight of
   * goal (shotQuality over 0.12, as the AI judges it) it's a header at goal, otherwise a header on towards
   * goal. SHOOT / PASS / THROUGH still decide.
   */
  private autoHeader(p: Player, d: number): void {
    const b = this.ball;
    if (d > AUTO_HEADER_D || b.pos.y < 1.15 || b.pos.y > 3 || b.vel.y > 3) return;
    const ad = this.attackDir(p.side);
    // (The same call an AI teammate makes: close in, with a sight of goal, a header at it.)
    if (headerAtGoal(this, p)) {
      this.order(p, 'header', 0, 0, 0.75, -1, true);
    } else {
      const x = clamp(p.pos.x + ad * 12, -HALF_L + 4, HALF_L - 4);
      this.order(p, 'header', ad, 0, 0.6, -1, true, { x, z: p.pos.z * 0.7 });
    }
  }

  switchPlayer(dirX = 0, dirZ = 0): void {
    const hs = this.cfg.humanSide;
    if (hs < 0) return;
    const b = this.ball;
    const cur = this.active >= 0 ? this.players[this.active] : null;
    let best = -1;
    let bestS = Infinity;
    const aim = Math.hypot(dirX, dirZ) > 0.3;
    for (const p of this.bySide[hs as Side]) {
      if (p.isKeeper || p.idx === this.active || p.sentOff) continue;
      let s = intercept(this, p).t * 6 + dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z) * 0.4;
      // Prefer players goal-side of the ball.
      const ad = this.attackDir(hs as Side);
      if ((p.pos.x - b.pos.x) * ad > 0) s += 4;
      if (aim && cur) {
        const vx = p.pos.x - cur.pos.x;
        const vz = p.pos.z - cur.pos.z;
        const l = Math.hypot(vx, vz) || 1;
        s -= ((vx * dirX + vz * dirZ) / l) * 10;
      }
      if (s < bestS) {
        bestS = s;
        best = p.idx;
      }
    }
    if (best >= 0) {
      this.active = best;
      this.switchT = 0;
    }
  }

  private autoSwitchUpdate(dt: number): void {
    const hs = this.cfg.humanSide;
    if (hs < 0 || !this.autoSwitch) return;
    this.switchT += dt;
    const b = this.ball;
    // Defending only: their ball (at their feet, or a pass of theirs), or a loose one. Never while ours is
    // at our feet, in a keeper's hands, or on its way to one of ours.
    if (b.held) return;
    if (b.owner >= 0 && this.players[b.owner].side === hs) return;
    if (b.owner < 0 && this.passTarget >= 0 && this.players[this.passTarget].side === hs) return;
    if (this.switchT < AUTO_SWITCH_GAP || this.active < 0) return;
    const cur = this.players[this.active];
    if (cur.sentOff) return;
    // A man on the floor (or just gone to ground) is out of it for a moment.
    const down = cur.state !== 'move' && cur.state !== 'kick' && cur.stateT > 0.3;
    const ci = intercept(this, cur);
    const curT = ci.t + (down ? 1 : 0);
    let best = -1;
    let bestT = Infinity;
    for (const p of this.bySide[hs as Side]) {
      if (p.isKeeper || p === cur || p.sentOff || p.state !== 'move') continue;
      const t = intercept(this, p).t;
      if (t < bestT) {
        bestT = t;
        best = p.idx;
      }
    }
    const ratio = b.owner < 0 ? AUTO_SWITCH_RATIO_LOOSE : AUTO_SWITCH_RATIO;
    if (best < 0 || bestT > curT * ratio || curT - bestT < AUTO_SWITCH_MARGIN) return;
    // Never away from a man the stick is steering onto the ball while he's closing in on it.
    const pad = this.prev;
    const sl = Math.hypot(pad.mx, pad.mz);
    if (!down && sl > 0.3) {
      const toward = (x: number, z: number): boolean => {
        const tx = x - cur.pos.x;
        const tz = z - cur.pos.z;
        const tl = Math.hypot(tx, tz);
        return tl < 0.5 || ((pad.mx * tx + pad.mz * tz) / (sl * tl) > Math.cos(0.8) && (cur.vel.x * tx + cur.vel.z * tz) / tl > 2);
      };
      if (toward(ci.x, ci.z) || toward(b.pos.x, b.pos.z)) return;
    }
    this.active = best;
    this.switchT = 0;
  }

  // ---------------------------------------------------------------- set pieces

  private restartTakers(_dt: number): void {
    if (this.phase !== 'kickoff' && this.phase !== 'restart') return;
    const r = this.restart;
    if (!r) return;
    const t = this.players[r.taker];
    if (this.cfg.humanSide === r.side) {
      // Humans get a generous window, then it goes automatically.
      if (this.phaseT < 8) return;
    } else if (this.phaseT < r.wait) return;
    if (t.order) return;
    const ad = this.attackDir(r.side);
    const gx = ad * HALF_L;
    const mates = this.bySide[r.side].filter((p) => p !== t && !p.sentOff);
    const pick = (fn: (p: Player) => number): Player => {
      let best = mates[0];
      let bs = -Infinity;
      for (const p of mates) {
        const s = fn(p);
        if (s > bs) {
          bs = s;
          best = p;
        }
      }
      return best;
    };
    const openness = (p: Player): number => {
      let o = 10;
      for (const q of this.bySide[r.side === 0 ? 1 : 0]) if (!q.sentOff) o = Math.min(o, dist2(q.pos.x, q.pos.z, p.pos.x, p.pos.z));
      return o;
    };
    switch (r.kind) {
      case 'kickoff': {
        const m = pick((p) => (p.role === 'MF' ? 10 : 0) - dist2(p.pos.x, p.pos.z, 0, 0));
        this.order(t, 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.5, m.idx, false);
        break;
      }
      case 'throwin': {
        // To a teammate 4-18 m away; with nobody in range, the nearest outfielder (never the keeper,
        // which used to be the fallback and threw it the length of the pitch).
        const m = pick((p) => {
          if (p.isKeeper) return -1e4;
          const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
          if (d > 18 || d < 4) return -99 - Math.abs(d - 11);
          return openness(p) - d * 0.2 + ((p.pos.x - t.pos.x) * ad) * 0.08;
        });
        this.order(t, 'throw', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.5, m.idx, false);
        break;
      }
      case 'corner': {
        // Now and then it's played short to the man who came for it.
        if (this.cfg.humanSide !== r.side && this.shortRolled !== r) {
          this.shortRolled = r;
          if (this.rng.chance(0.1)) {
            this.shortCorner(t);
            break;
          }
        }
        // Give the runners a moment to load the box.
        if (this.cfg.humanSide !== r.side && setPieceReady(this, r.side) < 4 && this.phaseT < r.wait + 3) return;
        this.deliverSetPiece(t);
        break;
      }
      case 'goalkick': {
        if (this.rng.chance(0.45)) {
          const m = pick((p) => (p.role === 'DF' ? openness(p) : -99));
          this.order(t, 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.6, m.idx, false);
        } else {
          const m = pick((p) => (p.role === 'FW' || p.role === 'MF' ? p.pos.x * ad * 0.3 + openness(p) + this.rng.next() * 4 : -99));
          this.order(t, 'lob', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 1, m.idx, false);
        }
        break;
      }
      case 'penalty': {
        const zAim = this.rng.chance(0.5) ? 1 : -1;
        this.order(t, 'shot', 0, zAim, 0.72 + this.rng.next() * 0.2, -1, false);
        break;
      }
      case 'freekick': {
        const dg = dist2(r.x, r.z, gx, 0);
        if (isDirectFreeKick(this, r)) {
          // Mostly curled over the wall into the corner behind it (the keeper covers the other one):
          // aimed just inside the near post and bent in from outside; now and then bent into the
          // keeper's side instead, and now and then just hit.
          const near = Math.sign(r.z) || 1;
          const zs = this.rng.chance(0.65) ? near : -near;
          const o = this.order(t, 'shot', 0, zs, 0.72 + this.rng.next() * 0.22, -1, false);
          if (o) {
            o.aimZ = zs * (GOAL_W / 2 - 0.5 - this.rng.next() * 0.5);
            o.curl = this.rng.chance(0.8) ? -near * (0.5 + this.rng.next() * 0.5) : 0;
          }
        } else if (isCrossingRestart(this, r)) {
          if (this.cfg.humanSide !== r.side && setPieceReady(this, r.side) < 4 && this.phaseT < r.wait + 3) return;
          this.deliverSetPiece(t);
        } else {
          const m = pick((p) => openness(p) + ((p.pos.x - t.pos.x) * ad) * 0.15 - dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z) * 0.1 -
            (this.offside && this.inOffsidePosition(p) ? 99 : 0));
          this.order(t, dg < 40 ? 'lob' : 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.7, m.idx, false);
        }
        break;
      }
    }
  }

  /**
   * Corner / wide free kick: whip it into the zone one of the box runners is attacking (near or far
   * post on a corner). Used by the AI and by a human who takes it without aiming the stick.
   */
  private deliverSetPiece(t: Player, power = 0.8, driven = false, dir?: { x: number; z: number }): void {
    // A driven ball goes to the near-post runner (a flat ball to the far post just flies across).
    const a = setPieceAim(this, t, driven, dir);
    const o = this.order(t, 'lob', a.x - t.pos.x, a.z - t.pos.z, power, a.target, false, { x: a.x, z: a.z }, driven ? DRIVEN_LAND : undefined);
    if (o && driven) o.driven = true;
    // One aimed beyond the near post (a corner to the far post) is hung up over the heads there.
    else if (o && this.restart?.kind === 'corner' && a.z * Math.sign(t.pos.z || 1) < 1) o.hang = FAR_POST_HANG;
  }

  /**
   * Short corner: a pass to feet for the nearest teammate within ~12 m (the one who came short
   * for it); with nobody that close, the nearest within 20 m; failing that, a cross.
   */
  private shortCorner(t: Player): void {
    let best: Player | null = null;
    let bd = Infinity;
    for (const q of this.bySide[t.side]) {
      if (q === t || q.sentOff || q.isKeeper) continue;
      const d = dist2(q.pos.x, q.pos.z, t.pos.x, t.pos.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best || bd > 20) {
      this.deliverSetPiece(t, 0.7);
      return;
    }
    this.order(t, 'pass', best.pos.x - t.pos.x, best.pos.z - t.pos.z, 0.5, best.idx, false);
  }

  private goOut(kind: RestartKind, side: Side, x: number, z: number, indirect = false): void {
    this.phase = 'out';
    this.phaseT = 0;
    this.ball.owner = -1;
    this.passTarget = -1;
    this.offWatch = null;
    this.adv = null;
    this.pendingRestart = { kind, side, x, z, taker: -1, wait: 0.95 + this.rng.next() * 0.55 };
    if (indirect) this.pendingRestart.indirect = true;
    // Choose the taker now so everyone can take up set-piece positions while the ball is dead.
    this.pendingRestart.taker = this.pickTaker(this.pendingRestart).idx;
    this.restart = this.pendingRestart;
    for (const p of this.players) p.order = null;
    this.events.push({ type: 'whistle', kind: 'short' }, { type: 'restart', kind, side });
    if (kind === 'corner') this.stats.corners[side]++;
    // A stoppage: the AI benches can make their late changes (not while a penalty is given).
    if (kind !== 'penalty') this.autoSubs();
  }

  private pickTaker(r: Restart): Player {
    const team = this.bySide[r.side];
    if (r.kind === 'goalkick') return team[0];
    let taker = team.find((p) => !p.isKeeper && !p.sentOff) ?? team[1];
    let best = Infinity;
    for (const p of team) {
      if (p.isKeeper || p.sentOff) continue;
      let d = dist2(p.pos.x, p.pos.z, r.x, r.z);
      // Your best shooter takes penalties and central free kicks.
      if (r.kind === 'penalty' || r.kind === 'freekick') d -= p.stat.shooting * 0.12;
      if (d < best) {
        best = d;
        taker = p;
      }
    }
    return taker;
  }

  private beginRestart(r: Restart): void {
    this.pendingRestart = null;
    this.queuedKick = null;
    const ad = this.attackDir(r.side);
    const taker = r.taker >= 0 ? this.players[r.taker] : this.pickTaker(r);
    r.taker = taker.idx;
    this.ball.reset(r.x, r.z);
    this.ball.lastTouchSide = r.side;
    // Stand the taker behind the ball, facing into play.
    let fx: number, fz: number;
    if (r.kind === 'throwin') {
      fx = 0;
      fz = -Math.sign(r.z);
    } else if (r.kind === 'corner') {
      // Square on to the area between the spot and the six-yard box, where the delivery goes.
      fx = ad * (HALF_L - 7) - r.x;
      fz = -r.z;
    } else if (r.kind === 'goalkick') {
      fx = ad;
      fz = 0;
    } else {
      const gx = ad * HALF_L;
      const l = Math.max(0.1, dist2(r.x, r.z, gx, 0));
      fx = (gx - r.x) / l;
      fz = -r.z / l;
    }
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    taker.facing = Math.atan2(fz, fx);
    this.restartAim = taker.facing;
    taker.setState('move');
    taker.vel.x = taker.vel.z = 0;
    if (r.kind === 'throwin') {
      taker.pos.x = r.x;
      taker.pos.z = r.z + Math.sign(r.z) * 0.25;
      this.ball.owner = taker.idx;
      this.ball.held = true;
    } else {
      taker.pos.x = r.x - fx * 0.62;
      taker.pos.z = r.z - fz * 0.62;
      this.ball.owner = taker.idx;
    }
    if (r.kind === 'penalty') {
      // Everyone else out of the box; keeper on the line.
      const defSide = (r.side === 0 ? 1 : 0) as Side;
      const k = this.bySide[defSide][0];
      k.pos.x = ad * (HALF_L - 0.3);
      k.pos.z = 0;
      k.facing = ad > 0 ? Math.PI : 0;
      k.vel.x = k.vel.z = 0;
      // Everyone else outside the area and the arc, lined up on its edge (TV cuts to it).
      for (const p of this.players) {
        if (p === taker || p.isKeeper || p.sentOff) continue;
        const w = penaltyWaitSpot(this, p);
        p.pos.x = w.x;
        p.pos.z = w.z;
        p.vel.x = p.vel.z = 0;
        p.facing = Math.atan2(r.z - w.z, r.x - w.x);
      }
    }
    // Corners and free kicks in range: snap everyone into the set-piece shape (TV cuts to it).
    const direct = isDirectFreeKick(this, r);
    if (isCrossingRestart(this, r) || direct) {
      for (const side of [0, 1] as Side[]) {
        const targets = setPieceTargets(this, side);
        for (const [idx, t] of targets) {
          const p = this.players[idx];
          if (p === taker || p.isKeeper || p.sentOff) continue;
          p.pos.x = t.x;
          p.pos.z = t.z;
          p.vel.x = p.vel.z = 0;
          p.facing = Math.atan2(r.z - t.z, r.x - t.x);
        }
      }
      if (direct) {
        // Keeper on his side of the goal, the wall lined up in front of the other.
        const k = this.bySide[r.side === 0 ? 1 : 0][0];
        const w = freeKickWall(this, r);
        k.pos.x = w.keeper.x;
        k.pos.z = w.keeper.z;
        k.vel.x = k.vel.z = 0;
        k.facing = Math.atan2(r.z - k.pos.z, r.x - k.pos.x);
      }
      this.events.push({ type: 'setpiece', kind: r.kind, side: r.side });
    }
    this.phase = 'restart';
    this.phaseT = 0;
    this.stepIn = -1;
    if (r.kind === 'freekick' || r.kind === 'penalty') {
      this.runUpFoot = this.rng.chance(0.8) ? 1 : -1;
      this.holdDeadBall();
    }
    if (this.cfg.humanSide === r.side) this.active = taker.idx;
    else if (this.cfg.humanSide >= 0) this.active = this.nearestTo(this.cfg.humanSide as Side, r.x, r.z, true);
  }

  private checkBounds(): void {
    const b = this.ball;
    const p = b.pos;
    if (b.held) return;
    const lastSide = (b.lastTouchSide < 0 ? 0 : b.lastTouchSide) as Side;
    const other = (lastSide === 0 ? 1 : 0) as Side;
    const out = Math.abs(p.z) > HALF_W + BALL_R * 0.5 || Math.abs(p.x) > HALF_L + BALL_R;
    if (out && this.adv) {
      // Waiting on an advantage: a goal for the fouled side stands; anything else goes back for
      // the free kick.
      const gs = Math.sign(p.x);
      const scoring = (this.attackDir(0) === gs ? 0 : 1) as Side;
      const goal = Math.abs(p.x) > HALF_L + BALL_R && Math.abs(p.z) < GOAL_W / 2 && p.y < GOAL_H;
      if (goal && scoring === this.adv.side) this.grantAdvantage();
      else {
        this.whistleBack();
        return;
      }
    }
    if (Math.abs(p.z) > HALF_W + BALL_R * 0.5) {
      this.goOut('throwin', other, clamp(p.x, -HALF_L + 1, HALF_L - 1), Math.sign(p.z) * HALF_W);
      return;
    }
    if (Math.abs(p.x) > HALF_L + BALL_R) {
      const gs = Math.sign(p.x);
      const scoring = (this.attackDir(0) === gs ? 0 : 1) as Side;
      if (Math.abs(p.z) < GOAL_W / 2 && p.y < GOAL_H) {
        this.goal(scoring);
        return;
      }
      const defending = (scoring === 0 ? 1 : 0) as Side;
      if (this.shotClock < 2.5 && Math.abs(p.z) < GOAL_W / 2 + 3) this.events.push({ type: 'ooh' });
      if (b.lastTouchSide === defending) {
        this.goOut('corner', scoring, gs * (HALF_L - 0.35), Math.sign(p.z || 1) * (HALF_W - 0.35));
      } else {
        this.goOut('goalkick', defending, gs * (HALF_L - SIX_DEPTH), Math.sign(p.z || 1) * (SIX_W / 2) * 0.55);
      }
    }
  }

  private goal(side: Side): void {
    this.score[side]++;
    let scorer = this.ball.lastTouch >= 0 ? this.players[this.ball.lastTouch] : this.bySide[side][10];
    // An on-target shot that goes in off a save, a block or a deflection is the shooter's goal, not
    // an own goal (as long as nobody has struck the ball since).
    const shooter = this.shooter >= 0 ? this.players[this.shooter] : null;
    if (scorer.side !== side && shooter && shooter.side === side && !shooter.sentOff && this.shotSide === side &&
      this.shotWasOnTarget && this.shotKick === this.kickId && this.shotClock < SHOT_CREDIT) {
      scorer = shooter;
    }
    const own = scorer.side !== side;
    // Football minutes count up from 1' (0:30 is the 1st minute); stoppage time stays on 45'/90'.
    const minute = this.goalMinute();
    this.goals.push({ side, scorer: scorer.idx, name: scorer.def.name, minute, own });
    this.goalSide = side;
    this.lastGoalScorer = scorer.idx;
    this.phase = 'goal';
    this.phaseT = 0;
    this.passTarget = -1;
    this.offWatch = null;
    this.adv = null;
    this.ball.owner = -1;
    this.ball.held = false;
    this.events.push({ type: 'goal', side, scorer: scorer.idx, own });
    // The scorer (for an own goal, the attacker nearest the ball) wheels away to the corner flag on
    // the camera side at this end; the 3-4 nearest teammates chase him there, the rest jog over and
    // the keeper stays home. The conceding side trudges off towards its own half.
    let hero: Player | null = own ? null : scorer;
    if (!hero) {
      const b = this.ball.pos;
      let bd = Infinity;
      for (const p of this.bySide[side]) {
        if (p.isKeeper || p.sentOff) continue;
        const d = dist2(p.pos.x, p.pos.z, b.x, b.z);
        if (d < bd) {
          bd = d;
          hero = p;
        }
      }
    }
    this.celebHero = hero ? hero.idx : -1;
    this.celebSpot = { x: this.attackDir(side) * (HALF_L - 6), z: HALF_W - 4 };
    this.celebrants = hero
      ? this.bySide[side]
        .filter((p) => p !== hero && !p.isKeeper && !p.sentOff)
        .sort((a, b) => dist2(a.pos.x, a.pos.z, hero.pos.x, hero.pos.z) - dist2(b.pos.x, b.pos.z, hero.pos.x, hero.pos.z))
        .slice(0, 3 + this.rng.int(2))
        .map((p) => p.idx)
      : [];
    this.concedeWalk.clear();
    const conc = otherSide(side);
    const adc = this.attackDir(conc);
    for (const p of this.players) {
      p.order = null;
      p.claiming = false;
      if (p.sentOff) continue;
      if (p.side === side) {
        p.setState('celebrate');
        p.celebrate = p === hero ? this.rng.int(4) : 4 + this.rng.int(2);
      } else if (!p.isKeeper || p.state !== 'dive') {
        // Conceding keeper included (unless mid-dive; he gets up first).
        p.setState('dejected');
      }
      if (p.side === conc && !p.isKeeper) {
        // ~12 m towards where he'll line up for the kick-off.
        const k = kickoffSlot(this.slots[conc][p.slot], true);
        const dx = k.x * HALF_L * adc - p.pos.x;
        const dz = k.z * HALF_W * adc - p.pos.z;
        const d = Math.hypot(dx, dz);
        const s = d > 0.5 ? Math.min(12, d) / d : 0;
        this.concedeWalk.set(p.idx, { x: p.pos.x + dx * s, z: p.pos.z + dz * s });
      }
    }
  }

  private celebrants: number[] = [];

  /**
   * Goal choreography, stepped for as long as the goal phase lasts (only resumeAfterGoal ends it):
   * the scorer sprints (up to CELEBRATE_SPRINT) to the corner flag and turns to the camera; the mob
   * sprints there too and closes round him; the rest of the team jogs up to a few metres off; the
   * conceding side walks ~12 m away towards its own half, its keeper fetches the ball.
   */
  private celebrate(): void {
    const hero = this.celebHero >= 0 ? this.players[this.celebHero] : null;
    const spot = this.celebSpot;
    const t = this.phaseT;
    // Once the scorer is at the flag the others close round him; until then they head for the flag.
    const there = !!hero && dist2(hero.pos.x, hero.pos.z, spot.x, spot.z) < 3;
    const hubX = there && hero ? hero.pos.x : spot.x;
    const hubZ = there && hero ? hero.pos.z : spot.z;
    // The mob fans out on the pitch side of the flag (never behind the byline or the touchline).
    const a0 = Math.atan2(-1, -Math.sign(spot.x) || -1);
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.faceTarget = null;
      if (p.isKeeper && p.side !== this.goalSide && (p.state === 'move' || p.state === 'hold')) p.setState('dejected');
      if (p.state === 'celebrate') {
        let tx: number;
        let tz: number;
        let fast = true;
        let stopR = 0.8;
        let face: number | null = null;
        const mob = this.celebrants.indexOf(p.idx);
        if (p.isKeeper) {
          // Punches the air near his own goal.
          const gx = -this.attackDir(p.side) * (HALF_L - 4);
          tx = gx;
          tz = clamp(p.pos.z, -6, 6);
          fast = false;
        } else if (p === hero) {
          // A burst away, then a strut to the flag with the arms out so the mob can catch him.
          tx = spot.x;
          tz = spot.z;
          stopR = 0.6;
          fast = t < HERO_BURST;
          face = Math.PI / 2; // to the camera
        } else if (hero && mob >= 0) {
          // Straight after him from the whistle, then round him (and with him) once they're there.
          const n = Math.max(1, this.celebrants.length);
          const a = a0 + ((mob + 0.5) / n - 0.5) * 2.4 + Math.sin(t * 1.3 + mob) * 0.15;
          const near = dist2(p.pos.x, p.pos.z, hero.pos.x, hero.pos.z) < 2.4;
          const cx = there ? hubX : hero.pos.x + hero.vel.x * 0.35;
          const cz = there ? hubZ : hero.pos.z + hero.vel.z * 0.35;
          tx = cx + Math.cos(a) * 1.35;
          tz = cz + Math.sin(a) * 1.35;
          stopR = 0.3;
          fast = !near || !there;
          face = Math.atan2(hero.pos.z - p.pos.z, hero.pos.x - p.pos.x);
          // Hop around the scorer once they get there.
          if (near && p.y === 0 && this.rng.chance(0.05)) {
            p.vy = 3;
            p.y = 0.01;
          }
        } else if (hero) {
          // Everyone else jogs over but gives the scorer room.
          const dx = p.pos.x - hubX;
          const dz = p.pos.z - hubZ;
          const d = Math.hypot(dx, dz) || 1;
          tx = hubX + (dx / d) * 5;
          tz = hubZ + (dz / d) * 5;
          fast = false;
          face = Math.atan2(hubZ - p.pos.z, hubX - p.pos.x);
        } else {
          tx = p.pos.x;
          tz = p.pos.z;
        }
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > stopR) {
          const f = fast ? 1 : p === hero ? 0.85 : Math.min(1, d / 3) * 0.6;
          p.wantX = (dx / d) * f;
          p.wantZ = (dz / d) * f;
          p.sprint = fast;
        } else {
          p.wantX = p.wantZ = 0;
          p.sprint = false;
          p.faceTarget = face ?? Math.PI / 2;
        }
      } else if (p.state === 'dejected') {
        let tx: number;
        let tz: number;
        if (p.isKeeper) {
          // Trudge back and pick the ball out of the net.
          const b = this.ball.pos;
          tx = clamp(b.x, -HALF_L - 1.2, HALF_L + 1.2);
          tz = clamp(b.z, -GOAL_W / 2 + 0.5, GOAL_W / 2 - 0.5);
        } else {
          const w = this.concedeWalk.get(p.idx);
          tx = w ? w.x : p.pos.x;
          tz = w ? w.z : p.pos.z;
        }
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > (p.isKeeper ? 0.7 : 0.6)) {
          const f = p.isKeeper ? 0.35 : 0.5;
          p.wantX = (dx / d) * f;
          p.wantZ = (dz / d) * f;
        } else {
          p.wantX = p.wantZ = 0;
          if (p.isKeeper) p.faceTarget = Math.atan2(this.ball.pos.z - p.pos.z, this.ball.pos.x - p.pos.x);
        }
        p.sprint = false;
      } else {
        p.wantX = p.wantZ = 0;
      }
    }
  }

  // ---------------------------------------------------------------- contact

  private separate(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.sentOff) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.sentOff) continue;
        // Opponents bump shoulder to shoulder (the chunky models are ~1 m across); teammates can
        // squeeze a little closer.
        const minD = a.side === b.side ? SEP_MATE : a.isKeeper || b.isKeeper ? 0.95 : SEP_OPP;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        // A proper shoulder barge (not just two bodies touching) knocks the man on the ball off balance.
        if (a.side !== b.side && push > 0.07) {
          const own = this.ball.owner;
          if (own === a.idx || own === b.idx) this.players[own].stumbleT = Math.max(this.players[own].stumbleT, STUMBLE_BUMP * 0.6);
        }
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
      }
    }
    for (const p of ps) {
      if (p.sentOff) continue;
      p.pos.x = clamp(p.pos.x, -HALF_L - 5, HALF_L + 5);
      p.pos.z = clamp(p.pos.z, -HALF_W - 4, HALF_W + 4);
    }
  }

  private keepHeldBall(): void {
    const b = this.ball;
    if (!b.held || b.owner < 0) return;
    const k = this.players[b.owner];
    // A keeper with the ball in his hands stays in front of his goal line (he used to drift back into the
    // net after a catch and throw it out from in there, the ball over the line).
    if (k.isKeeper && Math.abs(k.pos.x) > HALF_L - KEEPER_LINE_IN) {
      k.pos.x = Math.sign(k.pos.x) * (HALF_L - KEEPER_LINE_IN);
      if (k.vel.x * k.pos.x > 0) k.vel.x = 0;
    }
    if (k.state === 'dive' || k.state === 'stand') {
      b.pos.x = k.pos.x + Math.cos(k.facing) * 0.3;
      b.pos.z = k.pos.z + Math.sin(k.facing) * 0.3;
      b.pos.y = k.y + 0.55;
      b.vel.x = b.vel.y = b.vel.z = 0;
      if (k.state === 'stand' && k.isKeeper) k.setState('hold');
    } else if (k.state === 'throw') {
      b.pos.x = k.pos.x + Math.cos(k.facing) * 0.15;
      b.pos.z = k.pos.z + Math.sin(k.facing) * 0.15;
      b.pos.y = k.isKeeper ? 1.5 : 2.15;
    } else if (!k.isKeeper) {
      // Throw-in: ball above the taker's head.
      b.pos.x = k.pos.x;
      b.pos.z = k.pos.z;
      b.pos.y = 2.15;
      b.vel.x = b.vel.y = b.vel.z = 0;
    }
  }

  /** Is `p` the taker of a free kick or penalty (or shootout kick) still waiting to strike it? */
  usesRunUp(p: Player): boolean {
    const r = this.restart;
    if (!r || r.taker !== p.idx || this.ball.held) return false;
    if (this.phase === 'shootout') {
      const s = this.shootout;
      return !!s && s.taker === p.idx && (s.stage === 'aim' || s.stage === 'intro');
    }
    return this.phase === 'restart' && (r.kind === 'freekick' || r.kind === 'penalty');
  }

  /**
   * Kick-offs and restarts: the ball sits dead still on its spot and the taker stands over it (a
   * human taker can turn round it with the stick) until it's struck. Nothing else can nudge it.
   */
  private holdDeadBall(): void {
    if (this.phase !== 'restart' && this.phase !== 'kickoff' && this.phase !== 'shootout') return;
    const r = this.restart;
    const b = this.ball;
    if (!r || r.taker < 0 || b.owner !== r.taker) {
      this.stepIn = -1;
      return;
    }
    const t = this.players[r.taker];
    if (r.kind === 'throwin') {
      t.pos.x = r.x;
      t.pos.z = r.z + Math.sign(r.z) * 0.25;
      t.vel.x = t.vel.z = 0;
      return;
    }
    if (b.held) return; // a keeper's restart from the hands
    const fx = Math.cos(t.facing);
    const fz = Math.sin(t.facing);
    // The side of the ball his kicking foot is on (world right of his facing is (-fz, fx)).
    const rx = -fz * this.runUpFoot;
    const rz = fx * this.runUpFoot;
    // However the kick is aimed, the taker keeps to his run-up side of the ball-goal line (the one
    // the behind-the-ball camera looks along) and behind the ball, so he never walks across the lens.
    // (Only where that camera is used: penalties and free kicks within ~35 m of goal.)
    const filmed = this.phase === 'restart' &&
      (r.kind === 'penalty' || (r.kind === 'freekick' && dist2(r.x, r.z, this.attackDir(r.side) * HALF_L, 0) < 35));
    const lens = (x: number, z: number, minLat: number, maxAlong: number): { x: number; z: number } => {
      if (!filmed) return { x, z };
      const ux = Math.cos(this.restartAim);
      const uz = Math.sin(this.restartAim);
      let along = (x - r.x) * ux + (z - r.z) * uz;
      let lat = (x - r.x) * -uz + (z - r.z) * ux;
      const side = -this.runUpFoot;
      if (lat * side < minLat) lat = side * minLat;
      if (along > maxAlong) along = maxAlong;
      // No further from the ball than the run-up ever is.
      const l = Math.hypot(along, lat);
      const maxL = Math.hypot(RUNUP_BACK, RUNUP_SIDE) + 0.05;
      if (l > maxL) {
        along *= maxL / l;
        lat *= maxL / l;
      }
      return { x: r.x + ux * along - uz * lat, z: r.z + uz * along + ux * lat };
    };
    const strike = lens(r.x - fx * 0.62 - rx * 0.12, r.z - fz * 0.62 - rz * 0.12, 0.1, -0.35);
    const strikeX = strike.x;
    const strikeZ = strike.z;
    if (this.usesRunUp(t) && t.state === 'move') {
      const up = lens(r.x - fx * RUNUP_BACK - rx * RUNUP_SIDE, r.z - fz * RUNUP_BACK - rz * RUNUP_SIDE, RUNUP_LENS_CLEAR, -1);
      const upX = up.x;
      const upZ = up.z;
      if (this.stepIn === t.idx) {
        // Stepping in: a couple of strides onto the ball, then the strike.
        this.stepInT += DT;
        const len = Math.hypot(strikeX - upX, strikeZ - upZ);
        const k = Math.min(1, (this.stepInT * RUNUP_SPEED) / Math.max(0.01, len));
        t.pos.x = upX + (strikeX - upX) * k;
        t.pos.z = upZ + (strikeZ - upZ) * k;
        // (Velocity for the run cycle only; the position is set here.)
        t.vel.x = ((strikeX - upX) / Math.max(0.01, len)) * RUNUP_SPEED;
        t.vel.z = ((strikeZ - upZ) / Math.max(0.01, len)) * RUNUP_SPEED;
        if (k >= 1) {
          t.vel.x = t.vel.z = 0;
          this.stepIn = -1;
          t.setState('kick');
          t.kickT = 0;
          t.kickLeg = this.runUpFoot;
        }
      } else {
        t.pos.x = upX;
        t.pos.z = upZ;
        t.vel.x = t.vel.z = 0;
      }
    } else if (t.state === 'move' || t.state === 'kick') {
      t.pos.x = this.usesRunUp(t) ? strikeX : r.x - fx * 0.62;
      t.pos.z = this.usesRunUp(t) ? strikeZ : r.z - fz * 0.62;
      if (t.state === 'move') t.vel.x = t.vel.z = 0;
    }
    b.pos.x = r.x;
    b.pos.z = r.z;
    b.pos.y = BALL_R;
    b.vel.x = b.vel.y = b.vel.z = 0;
    b.spin.x = b.spin.y = b.spin.z = 0;
  }

  /**
   * While a penalty is being taken, nobody but the taker and the keeper may be in the area or arc.
   * On a direct free kick, the wall holds its line shoulder to shoulder once it's formed.
   */
  private keepPenaltyArea(): void {
    const r = this.restart;
    if (this.phase === 'restart' && r && isDirectFreeKick(this, r)) {
      const br = this.brains[r.side === 0 ? 1 : 0];
      for (const idx of br.spWall) {
        const p = this.players[idx];
        const t = br.spTargets.get(idx);
        if (!t || p.sentOff || p.state !== 'move' || this.isHumanControlled(p)) continue;
        if (dist2(p.pos.x, p.pos.z, t.x, t.z) < 0.6) {
          p.pos.x = t.x;
          p.pos.z = t.z;
          p.vel.x = p.vel.z = 0;
          p.facing = Math.atan2(r.z - t.z, r.x - t.x);
        }
      }
      return;
    }
    if (this.phase !== 'restart' || !r || r.kind !== 'penalty') return;
    for (const p of this.players) {
      if (p.idx === r.taker || p.isKeeper || p.sentOff) continue;
      const q = clearOfPenalty(this, r, p.pos.x, p.pos.z, 0.5);
      p.pos.x = q.x;
      p.pos.z = q.z;
    }
  }

  // ---------------------------------------------------------------- timed finishing

  /**
   * The human's open-play strike being timed (Match.timedFinish): from SHOOT's release (t = 0) until
   * FINISH_WINDOWS.late s after the boot meets the ball (`contact`, s after the release; -1 before). `tap`:
   * when the second SHOOT tap came (-1: none yet). `aim`: the strike's aim and error, for a late tap to re-aim.
   */
  private finish: {
    p: number; side: Side; t: number; contact: number; tap: number; kick: number; aim: Launch['aim'] | null;
  } | null = null;
  /** SHOOT went down as the timed-finish tap: not a new press (no slide, no charge, no strike) until let go. */
  private finishHeld = false;

  /** The human has just ordered a strike on SHOOT's release: time it (when timed finishing is on). */
  private startFinish(p: Player): void {
    this.finish = this.timedFinish
      ? { p: p.idx, side: p.side, t: 0, contact: -1, tap: -1, kick: -1, aim: null }
      : null;
  }

  /** The timed strike's clock: it ends when the late window closes, or the strike never comes. */
  private finishTick(dt: number): void {
    const f = this.finish;
    if (!f) return;
    f.t += dt;
    const p = this.players[f.p];
    const b = this.ball;
    const gone = f.contact < 0
      ? p.state !== 'kick' || !p.order
      : f.t > Math.max(0.25, f.contact + FINISH_WINDOWS.late) + 1e-6 || b.owner >= 0 || b.lastTouch !== f.p || this.shotKick !== f.kick;
    if (this.phase !== 'play' || gone) this.finish = null;
  }

  /**
   * A SHOOT press while a strike is being timed: its second tap (true: used up here). Before the strike it's
   * judged at contact (execute); after it, the ball is put right (or wrong) in flight now.
   */
  private finishTap(): boolean {
    const f = this.finish;
    if (!f) return false;
    if (f.tap >= 0) return true; // one tap per strike
    f.tap = f.t;
    if (f.contact < 0) return true;
    const off = f.t - f.contact;
    const grade: TimingGrade = off <= FINISH_WINDOWS.perfect + 1e-6 ? 'perfect' : off <= FINISH_WINDOWS.good + 1e-6 ? 'good' : 'late';
    if (f.aim) {
      reaimShot(this, f.aim, TIMING_ERR[grade], grade === 'late' ? WILD_LIFT : 0);
      // (It may be on target now, or not any more.)
      const on = onTarget(this, f.side);
      if (on !== this.shotOnTarget) {
        this.stats.onTarget[f.side] += on ? 1 : -1;
        this.shotOnTarget = on;
        this.shotWasOnTarget = on;
      }
      this.updateBallPath();
    }
    this.shotTiming = grade;
    this.events.push({ type: 'timing', player: f.p, grade });
    return true;
  }

  private dribbleControl(): void {
    const b = this.ball;
    if (b.owner < 0 || b.held) return;
    // A dead ball on its spot is held there (holdDeadBall), not dribbled.
    if ((this.phase === 'restart' || this.phase === 'kickoff' || this.phase === 'shootout') && this.restart?.taker === b.owner) return;
    const p = this.players[b.owner];
    if (p.state !== 'move' && p.state !== 'kick' && p.state !== 'celebrate') {
      b.owner = -1;
      return;
    }
    const sp = p.speed();
    // Push the ball on in rhythm with the stride when running.
    // (Close control keeps the human's jogging dribbler's touches tighter: dribble.ts closeTouch.)
    const pulse = closeTouch(this, p, sp > 3 ? Math.max(0, Math.sin(p.runPhase * Math.PI * 4)) * 0.16 * (sp / 8) : 0);
    const fx = p.footX() + Math.cos(p.facing) * pulse;
    const fz = p.footZ() + Math.sin(p.facing) * pulse;
    const ex = fx - b.pos.x;
    const ez = fz - b.pos.z;
    if (Math.hypot(ex, ez) > 1.9) {
      b.owner = -1;
      return;
    }
    if (p.touchT > 0 && p.state === 'move') {
      // First touch settling (see firstTouch): the ball was pushed off his foot into his stride; he runs onto
      // it as the offset shrinks, and it gives up its pace over a few frames instead of stopping dead.
      const f = p.touchT / TOUCH_T;
      const wx = p.vel.x + (ex + p.touchX * f) * TOUCH_SPRING;
      const wz = p.vel.z + (ez + p.touchZ * f) * TOUCH_SPRING;
      b.vel.x += (wx - b.vel.x) * TOUCH_GRIP;
      b.vel.z += (wz - b.vel.z) * TOUCH_GRIP;
    } else {
      const k = p.state === 'kick' ? 8 : 15;
      b.vel.x = p.vel.x + ex * k;
      b.vel.z = p.vel.z + ez * k;
    }
    if (b.pos.y <= BALL_R + 0.02) b.vel.y = 0;
  }

  /**
   * First touch: `p` meets a moving ball (a pass, a loose ball, a clearance) coming at `rel` m/s relative to
   * him. It comes off his body a distance set by how heavy the touch is: that speed (squared), his dribbling,
   * how closely he's pressed, whether he's facing it, a ball off the ground, being off balance (the human's
   * man, less of it with more pass assistance: TOUCH_ASSIST). Up to TOUCH_SPILL m it's his, pushed that far
   * into his stride (the stick's way for the human, his run for the AI) and settled over TOUCH_T s
   * (dribbleControl); a heavier one squirts off him loose (up to TOUCH_MAX m) for anyone to get to. The
   * distance is kept in lastTouchD.
   */
  private firstTouch(p: Player, rel: number): void {
    const b = this.ball;
    const human = this.isHumanControlled(p);
    const bs = Math.hypot(b.vel.x, b.vel.z);
    const bx = bs > 0.5 ? b.vel.x / bs : Math.cos(p.facing);
    const bz = bs > 0.5 ? b.vel.z / bs : Math.sin(p.facing);
    // Pressure: the nearest opponent (outfield or keeper) closing him down.
    let near = Infinity;
    let ox = 0;
    let oz = 0;
    for (const o of this.bySide[otherSide(p.side)]) {
      if (o.sentOff) continue;
      const d = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
      if (d < near) {
        near = d;
        ox = (p.pos.x - o.pos.x) / Math.max(0.1, d);
        oz = (p.pos.z - o.pos.z) / Math.max(0.1, d);
      }
    }
    const press = clamp((2.6 - near) / 1.8, 0, 1);
    // Facing the ball (1) .. his back to it (-1).
    const faceIt = -(Math.cos(p.facing) * bx + Math.sin(p.facing) * bz);
    const back = clamp((0.2 - faceIt) / 1.2, 0, 1);
    const air = clamp((b.pos.y - 0.45) / 0.5, 0, 1);
    const ctrl = p.stat.dribbling / 100;
    let heavy = (rel / 20) ** 2 * (1.2 - ctrl) * (1 + 0.8 * press + 0.5 * back + 0.4 * air + (p.stumbleT > 0 ? 0.6 : 0)) *
      (1.15 - this.kickSkill(p) * 0.075);
    heavy *= human ? TOUCH_ASSIST[this.groundAssist] : TOUCH_AI;
    const dist = Math.min(TOUCH_MAX, TOUCH_BASE + heavy * TOUCH_K * (0.6 + 0.8 * this.rng.next()));
    this.lastTouchD = dist;
    // Where he means to take it: the stick (the human; no stick, in front of him), else into his run, or on
    // the way it was going, opened up towards goal and away from his marker.
    const ad = this.attackDir(p.side);
    const stick = human ? Math.hypot(this.prev.mx, this.prev.mz) : 0;
    let wx: number;
    let wz: number;
    if (stick > 0.3) {
      wx = this.prev.mx / stick;
      wz = this.prev.mz / stick;
    } else if (human) {
      // (No stick: cushioned in front of him, the way he's facing.)
      wx = Math.cos(p.facing);
      wz = Math.sin(p.facing);
    } else if (p.speed() > 2 && p.vel.x * bx + p.vel.z * bz > 0) {
      // Running onto it: into his stride.
      wx = p.vel.x;
      wz = p.vel.z;
    } else {
      wx = bx * 0.45 + ad * 0.35 + ox * press * 0.4 + Math.cos(p.facing) * 0.2;
      wz = bz * 0.45 + oz * press * 0.4 + Math.sin(p.facing) * 0.2;
    }
    const wl = Math.hypot(wx, wz);
    if (wl < 1e-3) {
      wx = Math.cos(p.facing);
      wz = Math.sin(p.facing);
    } else {
      wx /= wl;
      wz /= wl;
    }
    if (dist <= TOUCH_SPILL) {
      this.takePossession(p);
      if (b.owner !== p.idx) return;
      p.touchT = TOUCH_T;
      p.touchX = wx * dist;
      p.touchZ = wz * dist;
      return;
    }
    // A heavy touch: off his shin, mostly on the way the ball was going, and loose.
    if (this.offsideTouch(p)) return;
    const a = Math.atan2(bz * 0.7 + wz * 0.3, bx * 0.7 + wx * 0.3) + this.rng.gauss() * 0.45;
    const push = groundPassSpeed(dist, 0.6);
    b.vel.x = p.vel.x * 0.6 + Math.cos(a) * push;
    b.vel.z = p.vel.z * 0.6 + Math.sin(a) * push;
    b.vel.y = 0.6 + air * 1.2;
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.25;
    // (The human's man is still the one it's for: the assisted receive goes and gets it.)
    this.passTarget = human ? p.idx : -1;
    this.updateBallPath();
  }

  private checkPossession(): void {
    const b = this.ball;
    if (b.owner >= 0 || b.held || b.pos.y > 1.1) return;
    let best: Player | null = null;
    let bestD = Infinity;
    const hs = b.hspeed();
    // A ball just struck (or any shot) can only be blocked by someone it's actually heading at.
    const fresh = this.kickId > 0 &&
      (dist2(this.kickX, this.kickZ, b.pos.x, b.pos.z) < 3.8 || this.shotClock < 1.2);
    const wallLive = this.wallKick === this.kickId && this.sinceKick < 0.9;
    for (const p of this.players) {
      if (p.state !== 'move' || p.kickCooldown > 0 || p.sentOff) continue;
      if (p.order?.firstTime) continue;
      if (p.blockKick === this.kickId) continue;
      if (wallLive && this.wall.includes(p.idx)) continue;
      if (fresh && p.side !== this.kickSide && hs > 4) {
        const fx = p.footX() - b.pos.x;
        const fz = p.footZ() - b.pos.z;
        if (fx * b.vel.x + fz * b.vel.z < 0) continue;
      }
      const d = dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z);
      if (d < p.controlRadius() && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    const rel = Math.hypot(b.vel.x - best.vel.x, b.vel.z - best.vel.z, b.vel.y);
    const trap = 16 + best.stat.dribbling * 0.1;
    // A ball struck past an opponent at close range (or any shot) is a block attempt, not a
    // clean take: either it cannons off them or it's gone past before they can react.
    if (fresh && best.side !== this.kickSide && hs > 7 && (rel > 9 || this.shotClock < 1.2)) {
      best.blockKick = this.kickId;
      const def = best.stat.defending / 100;
      const shot = this.shotClock < 1.2;
      const pBlock = (shot ? 0.34 + def * 0.3 : 0.3 + def * 0.3) * (shot && this.shotByHuman ? HUMAN_SHOT_BLOCK : 1);
      if (this.rng.chance(pBlock)) this.deflect(best, shot);
      else if (shot && !this.shotOnTarget && this.rng.chance(0.7)) this.nick(best);
      return;
    }
    // Stretching to cut out a fast ball from wide inside your own box: often only a touch.
    if (best.side !== this.kickSide && !best.isKeeper && hs > 9 && Math.abs(this.kickZ) > HALF_W * 0.35 &&
      inOwnBox(this, best.side, b.pos.x, b.pos.z) && best.blockKick !== this.kickId) {
      best.blockKick = this.kickId;
      if (this.rng.chance(0.35)) {
        this.deflect(best, false);
        return;
      }
    }
    // An outfielder meeting a moving ball: a first touch (clean into his stride, or heavy and loose).
    if (!best.isKeeper && rel >= TOUCH_MIN_REL) {
      this.firstTouch(best, rel);
      return;
    }
    if (rel > trap) {
      if (this.offsideTouch(best)) return;
      // Heavy touch: it squirts off the player.
      b.vel.x = b.vel.x * 0.3 + best.vel.x * 0.4 + this.rng.gauss() * 2;
      b.vel.z = b.vel.z * 0.3 + best.vel.z * 0.4 + this.rng.gauss() * 2;
      b.vel.y = 1.2;
      b.lastTouch = best.idx;
      b.lastTouchSide = best.side;
      best.kickCooldown = 0.25;
      this.passTarget = -1;
      return;
    }
    this.takePossession(best);
  }

  /** `p` now has the ball at their feet. */
  private takePossession(p: Player): void {
    if (this.offsideTouch(p)) return;
    const b = this.ball;
    b.owner = p.idx;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.touchT = 0;
    this.passTarget = -1;
    // Take a touch and look up before the next decision (the AI times its first touch).
    p.ballT = 0;
    p.aiT = 0;
    p.aiMode = 'dribble';
    if (this.possessionSide !== p.side) this.sincePossession = 0;
    this.possessionSide = p.side;
    this.events.push({ type: 'control', player: p.idx });
    if (this.cfg.humanSide === p.side && !p.isKeeper) this.active = p.idx;
  }

  /**
   * An off-target shot flashing past a defender's body (legs, hip, shoulder) sometimes takes a
   * touch off him on its way wide: a corner, not a goal kick. On-target shots are never affected.
   */
  private checkGraze(): void {
    if (this.phase !== 'play') return;
    const b = this.ball;
    if (b.owner >= 0 || b.held || b.hspeed() < 8 || b.pos.y > 2) return;
    // A cross whipped in from wide that meets the full-back standing in front of it.
    const cross = this.kickKind === 'lob' && this.sinceKick < 0.35 && Math.abs(this.kickZ) > HALF_W * 0.35 &&
      this.kickX * this.attackDir(this.kickSide) > HALF_L * 0.35;
    const shot = this.shotClock < 1.2 && this.sinceKick < 1.2;
    if (!cross && !shot) return;
    const wallLive = this.wallKick === this.kickId;
    for (const p of this.players) {
      if (p.side === this.kickSide || p.isKeeper || p.sentOff || p.blockKick === this.kickId || p.state !== 'move') continue;
      // The wall on a direct free kick is checkWall's (a graze check here would let the ball through it).
      if (wallLive && this.wall.includes(p.idx)) continue;
      const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
      // Crosses meet the body; shots the body, or a stretched leg if it's low (and going wide).
      const reach = cross ? (b.pos.y < 1.3 ? 0.85 : 0.6) : b.pos.y < 1.1 && !this.shotOnTarget ? 1.3 : 0.9;
      if (d > reach || b.pos.y > 1.95 + p.y) continue;
      p.blockKick = this.kickId;
      if (cross) {
        if (this.rng.chance(0.8)) this.deflect(p, false);
      } else if (d < BODY_BLOCK && this.rng.chance(0.7 * (this.shotByHuman ? HUMAN_SHOT_BLOCK : 1))) {
        // Straight into a body: blocked.
        this.deflect(p, true);
      } else if (!this.shotOnTarget && this.rng.chance(0.66)) this.nick(p);
      return;
    }
  }

  /**
   * A shot that was going wide grazes a defender on its way through: a little further wide and
   * slower, and he touched it last (so it's a corner if it goes out).
   */
  private nick(p: Player): void {
    this.offsideTouch(p);
    const b = this.ball;
    const hs = b.hspeed();
    const a = Math.atan2(b.vel.z, b.vel.x);
    // Turn it away from the goal: further out on the side of the post it was already going wide of (where
    // it would cross the goal line; it used to be the side of the pitch the ball was on, which turned a
    // shot going wide of the far post back in off the defender).
    const gxOwn = -this.attackDir(p.side) * HALF_L;
    const tLine = Math.abs(b.vel.x) > 0.5 ? (gxOwn - b.pos.x) / b.vel.x : -1;
    const zLine = tLine > 0 ? b.pos.z + b.vel.z * tLine : b.pos.z;
    const out = Math.sign(zLine) || (this.rng.chance(0.5) ? 1 : -1);
    let turn = (0.05 + this.rng.next() * 0.12) * out * (Math.cos(a) >= 0 ? 1 : -1);
    let ns = hs * (0.82 + this.rng.next() * 0.12);
    if (dist2(b.pos.x, b.pos.z, gxOwn, 0) < DEFLECT_SAFE_D) {
      // Right by his own goal it comes off him well wide, and dead.
      turn = Math.sign(turn) * Math.max(Math.abs(turn), DEFLECT_SAFE_TURN);
      ns *= DEFLECT_SAFE_PACE;
    }
    b.vel.x = Math.cos(a + turn) * ns;
    b.vel.z = Math.sin(a + turn) * ns;
    b.vel.y = b.vel.y * 0.8 + this.rng.next() * 1.5;
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.25;
    this.passTarget = -1;
    this.shotOnTarget = false;
  }

  /** The ball cannons off `p`: a blocked pass or shot, sometimes behind for a corner. */
  private deflect(p: Player, shot: boolean): void {
    this.offsideTouch(p);
    const b = this.ball;
    const sp = b.hspeed();
    const gxOwn = -this.attackDir(p.side) * HALF_L;
    const dLine = Math.abs(b.pos.x - gxOwn);
    const nearLine = dLine < 22;
    const inBox = inOwnBox(this, p.side, b.pos.x, b.pos.z);
    const cross = Math.abs(this.kickZ) > HALF_W * 0.35 && this.kickKind !== 'shot';
    const pBehind = inBox ? (cross ? 0.72 : 0.6) : nearLine ? (shot ? 0.55 : cross ? 0.62 : 0.3) : 0;
    // Out on the flank (away from our goal), a block often just knocks it into touch.
    const wing = !inBox && !cross && Math.abs(b.pos.z) > HALF_W - WING_TOUCH;
    const pTouch = wing ? WING_BLOCK_TOUCH * clamp((Math.abs(b.pos.z) - (HALF_W - WING_TOUCH)) / 5, 0.4, 1) : 0;
    if (pTouch > 0 && !(pBehind > 0 && dLine < 12) && this.rng.chance(pTouch)) {
      // Off his shin and out over the touchline.
      const zs = Math.sign(b.pos.z) || 1;
      const ns = 7.5 + this.rng.next() * 4.5;
      const fwd = (Math.sign(b.vel.x) || 1) * (1 + this.rng.next() * 3);
      b.vel.x = fwd;
      b.vel.z = zs * ns;
      b.vel.y = 1 + this.rng.next() * 2.5;
    } else if (pBehind > 0 && this.rng.chance(pBehind)) {
      // Blocked cross or shot near our goal: it loops up and off behind the byline, wide of the posts.
      const ns = clamp(5 + dLine * 0.6, 7, 18) + this.rng.next() * 4;
      const zside = Math.sign(b.pos.z) || (this.rng.chance(0.5) ? 1 : -1);
      const clearPost = (GOAL_W / 2 + 1.8 - Math.abs(b.pos.z)) / Math.max(1, dLine);
      const zs = zside * Math.max(0.25 + this.rng.next() * 0.6, clearPost);
      const xs = Math.sign(gxOwn - b.pos.x) || 1;
      const l = Math.hypot(1, zs);
      b.vel.x = (xs / l) * ns;
      b.vel.z = (zs / l) * ns;
      b.vel.y = 3 + this.rng.next() * 3.5;
    } else {
      const heading = Math.atan2(b.vel.z, b.vel.x);
      let turn = (this.rng.chance(0.5) ? 1 : -1) * (0.35 + this.rng.next() * (shot ? 1.5 : 2.3));
      let ns = sp * (0.25 + this.rng.next() * (shot ? 0.45 : 0.3));
      if (dist2(b.pos.x, b.pos.z, gxOwn, 0) < DEFLECT_SAFE_D) {
        // By his own goal the block turns it away from the goal (by at least DEFLECT_SAFE_TURN), not
        // towards it, and kills it (own goals were ~15% of all goals).
        const toGoal = Math.atan2(-b.pos.z, gxOwn - b.pos.x);
        const away = Math.abs(angleDiff(toGoal, heading + Math.abs(turn))) >= Math.abs(angleDiff(toGoal, heading - Math.abs(turn))) ? 1 : -1;
        turn = away * Math.max(Math.abs(turn), DEFLECT_SAFE_TURN);
        ns *= DEFLECT_SAFE_PACE;
      }
      b.vel.x = Math.cos(heading + turn) * ns;
      b.vel.z = Math.sin(heading + turn) * ns;
      b.vel.y = 0.8 + this.rng.next() * (shot ? 4.5 : 3);
    }
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.28;
    this.passTarget = -1;
    this.events.push({ type: 'block', by: p.idx, shot, x: b.pos.x, z: b.pos.z });
    if (shot) this.events.push({ type: 'ooh' });
  }

  /**
   * The wall on a direct free kick: it jumps as the ball is struck, and a shot that meets a body
   * below head height is blocked (the legs-only block in checkPossession would let it through).
   */
  private checkWall(): void {
    if (this.wallKick !== this.kickId || this.sinceKick > 0.9) return;
    const b = this.ball;
    if (b.owner >= 0 || b.held) return;
    if (!this.wallJumped && this.sinceKick > 0.06) {
      this.wallJumped = true;
      for (const idx of this.wall) {
        const w = this.players[idx];
        if (w.sentOff || w.state !== 'move' || w.y > 0) continue;
        w.vy = 3.4;
        w.y = 0.01;
      }
    }
    // Swept: a 30 m/s strike covers half a metre a frame, so test the whole step, not its end.
    // A well-bent free kick is struck up and over the wall and dips (the wall has less of it); a
    // straight one has to clear the jumping heads.
    const bend = this.fkShotKick === this.kickId ? this.shotCurl : 0;
    // (A straight one is met by the tallest heads in the wall.)
    const top = 1.8 + WALL_HEAD * (1 - bend) - WALL_CURL_DIP * bend;
    const radius = 0.5 - 0.15 * bend;
    const a = this.ballPrev;
    for (const idx of this.wall) {
      const w = this.players[idx];
      if (w.sentOff || w.blockKick === this.kickId) continue;
      const { d, t } = pointSegDist(w.pos.x, w.pos.z, a.x, a.z, b.pos.x, b.pos.z);
      const y = a.y + (b.pos.y - a.y) * t;
      if (d < radius && y < top + w.y) {
        w.blockKick = this.kickId;
        this.wallKick = -1;
        b.pos.x = a.x + (b.pos.x - a.x) * t;
        b.pos.z = a.z + (b.pos.z - a.z) * t;
        b.pos.y = Math.max(BALL_R, y);
        this.deflect(w, true);
        return;
      }
    }
  }

  /**
   * A corner / wide free-kick delivery: a zonal defender heads (or hooks) away any ball that comes through
   * within ZONAL_HEAD_R m of him below ZONAL_HEAD_Y m (plus his leap), unless an attacker is right there
   * on it too (then the first-time contact settles it). Flat, driven ones used to fly through the
   * six-yard box untouched.
   */
  private checkZonal(): void {
    if (this.setPieceKick !== this.kickId || this.sinceKick > 1.8) return;
    const b = this.ball;
    if (b.owner >= 0 || b.held || b.pos.y > ZONAL_HEAD_Y + 0.6) return;
    const atk = this.kickSide;
    const zonal = this.brains[otherSide(atk)].spZonal;
    if (zonal.size === 0) return;
    const a = this.ballPrev;
    for (const idx of zonal.keys()) {
      const p = this.players[idx];
      if (p.sentOff || p.side === atk || p.state !== 'move' || p.blockKick === this.kickId || p.kickCooldown > 0 || (p.order && !p.order.firstTime)) continue;
      const { d, t } = pointSegDist(p.pos.x, p.pos.z, a.x, a.z, b.pos.x, b.pos.z);
      const y = a.y + (b.pos.y - a.y) * t;
      if (d > ZONAL_HEAD_R || y > ZONAL_HEAD_Y + p.y || y < 0.3) continue;
      const cx = a.x + (b.pos.x - a.x) * t;
      const cz = a.z + (b.pos.z - a.z) * t;
      let contested = false;
      for (const q of this.bySide[atk]) {
        if (!q.sentOff && !q.isKeeper && dist2(q.pos.x, q.pos.z, cx, cz) < ZONAL_CONTEST_R) contested = true;
      }
      if (contested) continue;
      p.blockKick = this.kickId;
      const ad = this.attackDir(p.side);
      const aim = { x: p.pos.x + ad * 20, z: clamp(p.pos.z * 0.4 + Math.sign(p.pos.z || 1) * 11, -HALF_W + 4, HALF_W - 4) };
      const o = this.order(p, 'header', ad, 0, 1, -1, true, aim);
      if (!o) continue;
      b.pos.x = cx;
      b.pos.z = cz;
      b.pos.y = Math.max(BALL_R, y);
      this.firstTimeContact(p, y >= 1.05 ? 'head' : 'foot');
      return;
    }
  }

  private checkKeeperHands(): void {
    const b = this.ball;
    if (b.held) return;
    for (const s of [0, 1] as Side[]) {
      const k = this.bySide[s][0];
      if ((k.state !== 'move' && k.state !== 'dive') || k.kickCooldown > 0) continue;
      if (!inOwnBox(this, s, k.pos.x, k.pos.z) || b.owner === k.idx) continue;
      // A keeper can smother a dribbler who gets too close.
      if (b.owner >= 0) {
        const c = this.players[b.owner];
        if (c.side !== s && dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z) < 0.9 && this.rng.chance(0.08 + (k.stat.keeping / 100) * 0.1)) {
          this.catchBall(k, false);
        }
        continue;
      }
      // A ball already wholly over the line (in the net, or out) is past him.
      if (Math.abs(b.pos.x) > HALF_L + BALL_R) continue;
      // Don't handle your own teammate's back-pass.
      if (b.lastTouchSide === s && this.shotClock > 1 && b.lastTouch !== k.idx && b.pos.y < 0.6) continue;
      const diving = k.state === 'dive';
      const claiming = k.claiming && !diving;
      const hx = k.pos.x;
      const hz = k.pos.z;
      const hy = diving ? k.y + 0.7 : claiming ? 1.55 + k.y : 1.1;
      const dy = Math.abs(b.pos.y - hy);
      const keeping = k.stat.keeping / 100;
      let reachH = (diving ? 0.72 : claiming ? 0.84 : 0.62) + keeping * 0.2 + this.keeperBonus(s);
      const reachV = diving ? 1.1 : claiming ? 1.4 : 1.45;
      const shotLive = this.shotClock < 2 && this.shotSide !== s && this.shotKick === this.kickId;
      if (diving && shotLive) {
        // A rocket (not a bent one) into the top corner: fingertips at best.
        // (From range he's seen it all the way: the fingertips-only rule fades out from TOP_CORNER_NEAR to
        // TOP_CORNER_FAR m.)
        if (this.shotSpeed >= TOP_CORNER_SPEED && this.shotCurl < 0.3 && Math.abs(b.pos.z) > GOAL_W / 2 - 1.25 && b.pos.y > 1.2) {
          reachH *= 1 - 0.5 * clamp((TOP_CORNER_FAR - this.shotDist) / (TOP_CORNER_FAR - TOP_CORNER_NEAR), 0, 1);
        }
        // A bending free kick is hard to judge: the keeper's reach is a little shorter against it.
        if (this.fkShotKick === this.shotKick) reachH *= 1 - CURL_REACH * this.shotCurl;
      }
      // A diving keeper is stretched out along his line: full reach sideways, much less in front of
      // or behind his body (a ball whipped across the face of goal from an angle goes past him).
      const dh = diving
        ? Math.hypot((hx - b.pos.x) * (reachH / DIVE_DEPTH), hz - b.pos.z)
        : dist2(hx, hz, b.pos.x, b.pos.z);
      if (dh < reachH && dy < reachV && b.pos.y < GOAL_H + (claiming ? 0.7 : 0.3)) {
        const speed = b.speed();
        // Only a shot that was actually on target counts as a save.
        const onFrame = this.shotClock < 2 && this.shotSide !== s && this.shotOnTarget;
        if (claiming && !onFrame) {
          this.claimCross(k);
          continue;
        }
        const catchLimit = 11 + keeping * 13 + this.keeperBonus(s) * 20;
        // A long shot (struck from 16 m out, fully from 24 m) gives him time to get his body behind
        // it: held far more often than a strike from inside the box, which is mostly parried.
        // Straight at him he usually holds it; at full stretch he mostly gets a hand to it.
        const seen = shotLive ? clamp((this.shotDist - LONG_CATCH_FROM) / 8, 0, 1) : 0;
        const stretch = diving ? clamp(dh / Math.max(0.1, reachH), 0, 1) : 0;
        const pCatch = speed < catchLimit + seen * 7
          ? diving
            ? (0.3 + keeping * 0.24) * (0.42 + seen * (0.6 - stretch * 0.35))
            : Math.min(0.92, 0.3 + keeping * 0.24 + seen * 0.3)
          : 0;
        if (this.rng.chance(pCatch)) {
          this.catchBall(k, onFrame);
        } else {
          this.parry(k, onFrame);
        }
      }
    }
  }

  /** Keeper meets a cross: catch it cleanly, or punch when an attacker is challenging. */
  private claimCross(k: Player): void {
    this.offsideTouch(k);
    const b = this.ball;
    k.claiming = false;
    let rival = Infinity;
    for (const o of this.bySide[k.side === 0 ? 1 : 0]) if (!o.sentOff) rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
    const keeping = k.stat.keeping / 100;
    const pCatch = (rival < 1.4 ? 0.35 : 0.85) * (0.7 + keeping * 0.3);
    if (this.rng.chance(pCatch)) {
      this.catchBall(k, false, false);
      this.events.push({ type: 'claim', keeper: k.idx, caught: true });
      return;
    }
    const ad = this.attackDir(k.side);
    const zs = Math.sign(b.pos.z) || (this.rng.chance(0.5) ? 1 : -1);
    b.vel.x = ad * (10 + this.rng.next() * 6);
    b.vel.z = zs * (2 + this.rng.next() * 6);
    b.vel.y = 4 + this.rng.next() * 2.5;
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = k.idx;
    b.lastTouchSide = k.side;
    k.kickCooldown = 0.6;
    this.passTarget = -1;
    this.kickId++;
    this.sinceKick = 0;
    this.kickX = b.pos.x;
    this.kickZ = b.pos.z;
    this.kickSide = k.side;
    this.events.push({ type: 'claim', keeper: k.idx, caught: false }, { type: 'kick', power: 0.6, x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: 'clear' });
  }

  /** Keeper gets a hand to it without holding on: back into play, or tipped behind. */
  private parry(k: Player, onFrame: boolean): void {
    this.offsideTouch(k);
    const b = this.ball;
    const s = k.side;
    const ad = this.attackDir(s);
    const hw = GOAL_W / 2;
    const sp = b.speed();
    const vx0 = b.vel.x;
    const vy0 = b.vel.y;
    const vz0 = b.vel.z;
    let tipped = false;
    // Tipped round the post or over the bar when it was heading for the edge of the frame; a save
    // nearer the keeper's body is pushed back out into play (not behind for a corner every time).
    const edge = Math.abs(b.pos.z) > hw - 1.3 || b.pos.y > GOAL_H - 0.75;
    // (A long shot he's had time to get across to is palmed down or out rather than tipped behind.)
    // Most parries stay in play: pushed out to the side or spilled back into the box (a rebound).
    const set = this.shotKick === this.kickId ? clamp((this.shotDist - LONG_CATCH_FROM) / 8, 0, 1) : 0;
    const pTip = edge ? PARRY_TIP + Math.min(0.12, (Math.abs(b.pos.z) / hw) * 0.12) + (sp > 24 ? 0.06 : 0) - set * 0.15 : 0.08;
    if (onFrame && this.rng.chance(pTip)) {
      // Tip it round the post or over the bar.
      if (Math.abs(b.pos.z) < 1.3 || b.pos.y > 1.7) {
        b.vel.x = -ad * (2.5 + this.rng.next() * 2);
        b.vel.y = 7 + this.rng.next() * 2.5;
        b.vel.z = vz0 * 0.3;
      } else {
        b.vel.x = -ad * (1.5 + this.rng.next() * 2);
        b.vel.y = 1.5 + this.rng.next() * 2.5;
        b.vel.z = Math.sign(b.pos.z) * (7 + this.rng.next() * 4);
      }
      b.spin.x = b.spin.y = b.spin.z = 0;
      tipped = !onTarget(this, s === 0 ? 1 : 0);
      if (!tipped) {
        b.vel.x = vx0;
        b.vel.y = vy0;
        b.vel.z = vz0;
      }
    }
    if (!tipped) {
      // Parry away from goal: out to the side, and now and then back into the middle (a rebound).
      b.vel.x = Math.abs(b.vel.x) * 0.25 * ad + ad * 2.5;
      const spill = this.rng.chance(0.5);
      b.vel.z = b.vel.z * (spill ? 0.15 : 0.3) + (Math.sign(b.pos.z - k.pos.z) || (this.rng.chance(0.5) ? 1 : -1)) * (spill ? 1 + this.rng.next() * 2.5 : 3 + this.rng.next() * 5);
      // (A spill back into the middle is palmed down, a rebound at someone's feet; pushed out wide, it's up.)
      b.vel.y = spill ? PARRY_SPILL_VY + this.rng.next() * 1.5 : 2 + this.rng.next() * 3.5;
      b.spin.x = b.spin.y = b.spin.z = 0;
    }
    b.lastTouch = k.idx;
    b.lastTouchSide = s;
    k.kickCooldown = 0.6;
    this.passTarget = -1;
    if (onFrame) {
      this.stats.saves[s]++;
      this.events.push({ type: 'save', keeper: k.idx, caught: false });
    }
  }

  private catchBall(k: Player, save: boolean, emit = true): void {
    this.offsideTouch(k);
    const b = this.ball;
    k.claiming = false;
    b.owner = k.idx;
    b.held = true;
    b.vel.x = b.vel.y = b.vel.z = 0;
    b.lastTouch = k.idx;
    b.lastTouchSide = k.side;
    this.passTarget = -1;
    this.possessionSide = k.side;
    if (k.state !== 'dive') k.setState('hold');
    this.keeperHoldTime = 1.1 + this.rng.next() * 1.1;
    if (save) this.stats.saves[k.side]++;
    if (emit) this.events.push({ type: 'save', keeper: k.idx, caught: true });
  }

  startSlide(p: Player): void {
    if (p.state !== 'move' || p.isKeeper || p.sentOff) return;
    // How well-timed is it? Going through the back of a carrier (or a poor tackler lunging) often
    // takes the man as well as the ball: that's a foul even if the ball is won.
    const b = this.ball;
    let pFoul = 0.12;
    if (b.owner >= 0 && this.players[b.owner].side !== p.side) {
      const c = this.players[b.owner];
      const tx = p.pos.x - c.pos.x;
      const tz = p.pos.z - c.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      const behind = clamp(-(Math.cos(c.facing) * tx + Math.sin(c.facing) * tz) / tl, 0, 1);
      const def = p.stat.defending / 100;
      pFoul = clamp(0.03 + behind * 0.14 + (0.75 - def) * 0.2 + (c.speed() > 6 ? 0.03 : 0), 0.02, 0.4);
    }
    p.setState('slide');
    const sp = Math.max(p.speed(), 5) + 2.2;
    p.vel.x = Math.cos(p.facing) * sp;
    p.vel.z = Math.sin(p.facing) * sp;
    p.slideHit = false;
    p.slideFoul = this.rng.chance(pFoul * this.foulScale);
    p.tackleCooldown = 1.2;
    p.order = null;
    this.events.push({ type: 'tackle', by: p.idx, won: false, slide: true });
  }

  private checkSlides(): void {
    const b = this.ball;
    for (const p of this.players) {
      if (p.state !== 'slide' || p.stateT > 0.5 || p.sentOff) continue;
      const tipX = p.pos.x + Math.cos(p.facing) * 0.75;
      const tipZ = p.pos.z + Math.sin(p.facing) * 0.75;
      if (!p.slideHit && !b.held && b.pos.y < 0.7 && b.owner !== p.idx && dist2(tipX, tipZ, b.pos.x, b.pos.z) < 0.85) {
        if (b.owner < 0 && this.offsideTouch(p)) return;
        const prev = b.owner;
        const c = prev >= 0 ? this.players[prev] : null;
        // (A carrier winding up a shot or pass counts: scything him down mid-strike is a foul too.)
        const standing = c && (c.state === 'move' || c.state === 'kick');
        if (c && standing && c.side !== p.side && p.slideFoul && dist2(c.pos.x, c.pos.z, p.pos.x, p.pos.z) < 2) {
          c.order = null;
          // Mistimed: got the ball, but took the man with it.
          p.slideHit = true;
          c.setState('fallen');
          this.foul(p, c);
          return;
        }
        b.owner = -1;
        const sp = 6 + this.rng.next() * 3;
        b.vel.x = Math.cos(p.facing) * sp + this.rng.gauss() * 1.5;
        b.vel.z = Math.sin(p.facing) * sp + this.rng.gauss() * 1.5;
        b.vel.y = 0.8;
        // Sliding in by the touchline often puts it out for a throw...
        const wz = Math.abs(b.pos.z) - (HALF_W - WING_TOUCH);
        if (wz > 0 && this.rng.chance(WING_POKE_TOUCH * clamp(wz / 5, 0.35, 1))) {
          b.vel.z = Math.sign(b.pos.z) * (7 + this.rng.next() * 4);
          b.vel.x *= 0.5;
        }
        // ... and by our own byline, usually behind.
        const gxOwn = -this.attackDir(p.side) * HALF_L;
        if (Math.abs(b.pos.x - gxOwn) < 13 && Math.abs(b.pos.z) > GOAL_W / 2 + 2 && this.rng.chance(0.5)) {
          b.vel.x = Math.sign(gxOwn - b.pos.x) * (5 + this.rng.next() * 3);
          b.vel.z = Math.sign(b.pos.z) * (1 + this.rng.next() * 3);
        }
        b.lastTouch = p.idx;
        b.lastTouchSide = p.side;
        p.slideHit = true;
        this.passTarget = -1;
        if (prev >= 0) {
          const c = this.players[prev];
          c.kickCooldown = 0.5;
          if (c.side !== p.side && dist2(c.pos.x, c.pos.z, p.pos.x, p.pos.z) < 1.5) c.setState('fallen');
          else c.stumbleT = Math.max(c.stumbleT, STUMBLE_LOST);
        }
        this.stats.tackles[p.side]++;
        this.events.push({ type: 'tackle', by: p.idx, won: true, slide: true });
        continue;
      }
      if (p.slideHit) continue;
      for (const c of this.players) {
        if (c.side === p.side || (c.state !== 'move' && c.state !== 'kick') || c.sentOff) continue;
        if (dist2(tipX, tipZ, c.pos.x, c.pos.z) < 0.55) {
          c.order = null;
          c.setState('fallen');
          p.slideHit = true;
          const hadBall = b.owner === c.idx || dist2(c.pos.x, c.pos.z, b.pos.x, b.pos.z) < 1.5;
          if (hadBall) {
            this.foul(p, c);
            return;
          }
          break;
        }
      }
    }
  }

  private foul(by: Player, on: Player): void {
    this.stats.fouls[by.side]++;
    const inBox = inOwnBox(this, by.side, on.pos.x, on.pos.z);
    this.events.push({ type: 'foul', by: by.idx, on: on.idx, penalty: inBox });
    const reckless = by.state === 'slide';
    // In their attacking half (outside the box) the referee waits a moment: if the fouled side
    // keeps the ball, he plays advantage (see updateAdvantage).
    if (!inBox && this.phase === 'play' && !this.adv && on.pos.x * this.attackDir(on.side) > 0) {
      this.adv = { by: by.idx, on: on.idx, side: on.side, t: 0, x: on.pos.x, z: on.pos.z, reckless, kick: this.kickId };
      return;
    }
    this.book(by, reckless, inBox);
    if (inBox) {
      const ad = this.attackDir(on.side);
      this.goOut('penalty', on.side, ad * (HALF_L - PEN_SPOT), 0);
    } else {
      this.goOut('freekick', on.side, clamp(on.pos.x, -HALF_L + 1, HALF_L - 1), clamp(on.pos.z, -HALF_W + 1, HALF_W - 1));
    }
  }

  /**
   * The card (if any) for a foul. Reckless slides get booked more often than clumsy standing fouls.
   * Keepers are never carded (so nobody ever has to go in goal); a second yellow is a red.
   */
  private book(by: Player, reckless: boolean, inBox: boolean): void {
    if (by.isKeeper || by.sentOff || !this.rng.chance(reckless ? 0.5 : inBox ? 0.35 : 0.12)) return;
    if (this.booked.has(by.idx)) {
      this.events.push({ type: 'card', player: by.idx, color: 'red', second: true });
      this.sendOff(by);
    } else {
      this.booked.add(by.idx);
      this.events.push({ type: 'card', player: by.idx, color: 'yellow' });
    }
  }

  /**
   * A foul the referee is holding: the fouled side having the ball (at feet, or playing it on) is
   * advantage; the other side getting it, or ADVANTAGE_WINDOW passing without it, brings it back.
   */
  private updateAdvantage(dt: number): void {
    const a = this.adv;
    if (!a) return;
    a.t += dt;
    const b = this.ball;
    // (The man who was brought down getting up and carrying on himself isn't an advantage: that's
    // the free kick he was fouled for.)
    const holder = b.owner >= 0 && b.owner !== a.on ? this.players[b.owner].side : -1;
    const struck = this.kickId !== a.kick && this.ball.lastTouch !== a.on ? this.kickSide : -1;
    if (holder === a.side || struck === a.side) this.grantAdvantage();
    else if (holder >= 0 || struck >= 0 || a.t > ADVANTAGE_WINDOW) this.whistleBack();
  }

  /** Play on: the booking (if any) is shown straight away. */
  private grantAdvantage(): void {
    const a = this.adv;
    if (!a) return;
    this.adv = null;
    this.events.push({ type: 'advantage', side: a.side });
    this.book(this.players[a.by], a.reckless, false);
  }

  /** No advantage after all: back for the free kick where the foul was. */
  private whistleBack(): void {
    const a = this.adv;
    if (!a) return;
    this.adv = null;
    this.book(this.players[a.by], a.reckless, false);
    this.goOut('freekick', a.side, clamp(a.x, -HALF_L + 1, HALF_L - 1), clamp(a.z, -HALF_W + 1, HALF_W - 1));
  }

  /**
   * `p` is touching the ball. If a pass is being watched for offside, this was the first touch
   * since it was played: a teammate who was offside when it was played means the flag goes up
   * (returns true; the ball is dead); anyone else just clears the watch.
   */
  private offsideTouch(p: Player): boolean {
    const w = this.offWatch;
    if (!w || this.phase !== 'play') return false;
    this.offWatch = null;
    if (!this.offside || p.side !== w.side || !w.players.includes(p.idx)) return false;
    this.stats.offsides[p.side]++;
    this.events.push({ type: 'offside', side: p.side, player: p.idx });
    p.order = null;
    // Indirect free kick to the defenders where he was.
    this.goOut('freekick', otherSide(p.side), clamp(p.pos.x, -HALF_L + 1, HALF_L - 1), clamp(p.pos.z, -HALF_W + 1, HALF_W - 1), true);
    return true;
  }

  /** Red card: off the pitch by the dugout for the rest of the match; the team plays on a man down. */
  sendOff(p: Player): void {
    if (p.sentOff) return;
    p.sentOff = true;
    p.order = null;
    p.running = false;
    p.claiming = false;
    p.commitT = 0;
    p.jockeyT = 0;
    if (this.ball.owner === p.idx) {
      this.ball.owner = -1;
      this.ball.held = false;
    }
    if (this.passTarget === p.idx) this.passTarget = -1;
    // He walks off to stand beside our dugout (home at -x, away at +x), a yard apart if there's
    // already someone there; nobody plays through him on the way (all loops skip the sent off).
    const n = this.bySide[p.side].filter((q) => q.sentOff).length;
    const sx = p.side === 0 ? -1 : 1;
    this.walkOff.set(p.idx, { x: sx * (13.4 + (n - 1) * 1.2), z: HALF_W + 2, t: 0 });
    p.vel.x = p.vel.z = 0;
    p.y = p.vy = 0;
    p.headerT = 0;
    p.kickT = 0;
    p.setState('dejected');
    for (const s of [0, 1] as Side[]) {
      const br = this.brains[s];
      br.spFor = null; // any set-piece shape has to be re-drawn without him
      if (br.presser === p.idx) br.presser = -1;
      if (br.cover === p.idx) br.cover = -1;
      if (br.chaser === p.idx) br.chaser = -1;
      br.think = 0;
    }
    if (this.cfg.humanSide === p.side && this.active === p.idx) {
      this.active = this.nearestTo(p.side, this.ball.pos.x, this.ball.pos.z, true);
    }
  }

  /** Sent-off players still walking to the dugout: where to, and for how long they've walked. */
  private walkOff = new Map<number, { x: number; z: number; t: number }>();

  /**
   * A sent-off player trudges to the dugout (head down, not controllable), then stands there
   * watching. Still stepped so animation time runs.
   */
  private parkSentOff(p: Player, dt: number): void {
    p.order = null;
    p.sprint = false;
    p.running = false;
    if (p.state !== 'dejected') p.setState('dejected');
    const w = this.walkOff.get(p.idx);
    if (w) {
      w.t += dt;
      const dx = w.x - p.pos.x;
      const dz = w.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || w.t > WALK_OFF_MAX) {
        // There (or, on a long walk, out of shot by now): stand by the dugout.
        p.pos.x = w.x;
        p.pos.z = w.z;
        p.vel.x = p.vel.z = 0;
        p.facing = -Math.PI / 2;
        this.walkOff.delete(p.idx);
      } else {
        const f = WALK_OFF_SPEED / p.jogPace();
        p.wantX = (dx / d) * f;
        p.wantZ = (dz / d) * f;
        p.faceTarget = null;
        p.step(dt, false);
        return;
      }
    }
    p.wantX = p.wantZ = 0;
    p.faceTarget = -Math.PI / 2;
    p.step(dt, false);
  }

  /**
   * A standing tackle by `p` on carrier `c`. `assisted`: the human's TACKLE tap / PRESS steal (dribble.ts): a
   * longer lunge (STAND_REACH), its own success (standingTackleChance: high from the front or side, lower
   * from behind) and foul (standingFoulChance: rare from the front) odds, a lighter penalty for missing.
   * Tackles on the human's carrier go through carrierGuard (difficulty, his dribbling, shielding, a skill's
   * protection window).
   */
  tryTackle(p: Player, c: Player, aggression: number, assisted = false): void {
    if (p.tackleCooldown > 0 || p.state !== 'move' || p.sentOff || c.sentOff) return;
    p.tackleCooldown = 0.55;
    const b = this.ball;
    if (b.owner !== c.idx) return;
    if (dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) > (assisted ? STAND_REACH : 1.15)) return;
    const def = p.stat.defending / 100;
    const drib = c.stat.dribbling / 100;
    const tb = Math.atan2(b.pos.z - p.pos.z, b.pos.x - p.pos.x);
    const facing = (Math.cos(tb - p.facing) + 1) / 2;
    // The carrier's body between tackler and ball (shielding) makes it harder and riskier.
    const bx = b.pos.x - c.pos.x;
    const bz = b.pos.z - c.pos.z;
    const tx = p.pos.x - c.pos.x;
    const tz = p.pos.z - c.pos.z;
    const bl = Math.hypot(bx, bz) || 1;
    const tl = Math.hypot(tx, tz) || 1;
    const shielded = clamp((-(bx * tx + bz * tz) / (bl * tl) - 0.1) / 0.7, 0, 1);
    // Coming from behind: the carrier is facing away from the tackler.
    const behind = clamp(-(Math.cos(c.facing) * tx + Math.sin(c.facing) * tz) / tl, 0, 1);
    const skill = this.isHumanControlled(p) ? 2.6 : this.aiSkill(p.side);
    let chance: number;
    if (assisted) chance = standingTackleChance(this, p, c, behind, shielded, bl > 0.9) * aggression;
    else {
      chance = clamp(0.42 + (def - drib) * 0.6 + (c.sprint ? 0.06 : 0), 0.12, 0.75) * (0.6 + 0.4 * facing) * aggression;
      chance *= (1 - shielded * 0.4) * (0.84 + skill * 0.06);
      if (this.isHumanControlled(p)) chance *= 1.2;
      chance *= TACKLE_WIN;
    }
    chance *= carrierGuard(this, p, c);
    if (this.rng.chance(chance)) {
      this.stats.tackles[p.side]++;
      this.events.push({ type: 'tackle', by: p.idx, won: true, slide: false });
      c.kickCooldown = 0.45;
      c.stumbleT = Math.max(c.stumbleT, STUMBLE_LOST);
      this.poke(p, b.pos.x, b.pos.z);
      // On the flank a poke often just knocks it into touch (the nearer the line, the likelier).
      const wz = Math.abs(c.pos.z) - (HALF_W - WING_TOUCH);
      const touch = wz > 0 && this.rng.chance(WING_POKE_TOUCH * clamp(wz / 5, 0.35, 1));
      if (!touch && this.rng.chance((assisted ? 0.5 : 0.35) + def * 0.3)) {
        // Clean: the tackler comes away with it.
        p.kickCooldown = 0;
        b.vel.x = p.vel.x;
        b.vel.z = p.vel.z;
        this.takePossession(p);
        return;
      }
      b.owner = -1;
      const dx = b.pos.x - c.pos.x;
      const dz = b.pos.z - c.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const sp = 3 + this.rng.next() * 4;
      b.vel.x = ((dx / dl) * 0.5 + Math.cos(p.facing) * 0.5) * sp + this.rng.gauss();
      b.vel.z = ((dz / dl) * 0.5 + Math.sin(p.facing) * 0.5) * sp + this.rng.gauss();
      if (touch) {
        b.vel.z = Math.sign(c.pos.z) * (7 + this.rng.next() * 4);
        b.vel.x *= 0.5;
        b.vel.y = 0.8 + this.rng.next() * 1.4;
      }
      // By our own byline, behind.
      const gxOwn = -this.attackDir(p.side) * HALF_L;
      if (Math.abs(c.pos.x - gxOwn) < 13 && Math.abs(c.pos.z) > GOAL_W / 2 + 2 && this.rng.chance(0.45)) {
        b.vel.x = Math.sign(gxOwn - c.pos.x) * (4 + this.rng.next() * 4) + b.vel.x * 0.3;
      }
      b.lastTouch = p.idx;
      b.lastTouchSide = p.side;
      p.kickCooldown = 0.12;
      this.passTarget = -1;
    } else {
      p.tackleCooldown = assisted ? 0.6 : 1.1;
      p.vel.x *= assisted ? 0.6 : 0.35;
      p.vel.z *= assisted ? 0.6 : 0.35;
      // He rode it, but it knocked him off his stride.
      c.stumbleT = Math.max(c.stumbleT, STUMBLE_BUMP);
      this.events.push({ type: 'tackle', by: p.idx, won: false, slide: false });
      // Mistimed: clipping the carrier from behind or through their back is a foul.
      const inBox = inOwnBox(this, p.side, c.pos.x, c.pos.z);
      const base = assisted ? standingFoulChance(behind, shielded) : 0.042 + behind * 0.18 + shielded * 0.1 + (c.speed() > 5 ? 0.04 : 0);
      const pFoul = base * (inBox ? 0.9 : 1) * this.foulScale;
      if (this.rng.chance(pFoul)) {
        c.setState('fallen');
        this.foul(p, c);
      }
    }
  }

  /**
   * A won standing tackle shows as a quick jab of the boot: the kick animation plays for ~0.25 s
   * without any strike being ordered (the player can still chain a pass straight out of it).
   */
  private poke(p: Player, bx: number, bz: number): void {
    p.facing = Math.atan2(bz - p.pos.z, bx - p.pos.x);
    const side = -Math.sin(p.facing) * (bx - p.pos.x) + Math.cos(p.facing) * (bz - p.pos.z);
    p.setState('kick');
    p.poke = true;
    p.order = null;
    p.stateT = 0.09; // the kick state lasts 0.34 s: this leaves a 0.25 s jab
    p.kickT = 0.28;
    p.kickLeg = side >= 0 ? 1 : -1;
  }

  /** `p` has wrong-footed `o` with a feint / change of pace. */
  beatDefender(p: Player, o: Player): void {
    o.slowT = this.isHumanControlled(o) ? vsHuman(this.aiSkill(p.side)).beaten : 0.7;
    o.commitT = 0;
    o.jockeyT = 0;
    o.tackleCooldown = Math.max(o.tackleCooldown, 0.6);
    this.events.push({ type: 'beat', by: p.idx, on: o.idx });
  }

  /** Is the ball in flight from a shot struck straight from a direct free kick? */
  freeKickShot(): boolean {
    return this.fkShotKick === this.shotKick && this.shotKick === this.kickId && this.shotClock < 2;
  }

  /**
   * Where `t`'s facing (the set-piece aim arrow) meets the goal line he attacks, or null when he's
   * facing away from it.
   */
  aimOnGoalLine(t: Player): number | null {
    const ad = this.attackDir(t.side);
    const fx = Math.cos(t.facing);
    const fz = Math.sin(t.facing);
    if (fx * ad < 0.15) return null;
    return this.ball.pos.z + (fz * (ad * HALF_L - this.ball.pos.x)) / fx;
  }

  /**
   * The human's dribble / tackle assists (see dribble.ts). (Its skill cut replaces the old humanCuts check,
   * whose smoothed turn never passed its 0.9 rad bar once the human's cut was a quick bend.)
   */
  readonly assist = new AssistState();
  /** The human's last stick input looked like keys / d-pad (see isDigitalStick, Pad.digital). */
  private padDigital = false;
  /** THROUGH was tapped during the current SHOOT charge: the shot will be a chip. */
  private chipArmed = false;
  /** A human set-piece delivery pressed while the box was still filling. */
  private queuedKick: (() => void) | null = null;

  /** The human's player tackles automatically when they run into the carrier. */
  private autoTackle(): void {
    if (this.cfg.humanSide < 0 || this.active < 0) return;
    const p = this.players[this.active];
    const b = this.ball;
    if (b.owner < 0 || b.held || p.sentOff) return;
    const c = this.players[b.owner];
    if (c.side === p.side || tackleClosing(this)) return; // (a TACKLE tap closing in makes its own challenge)
    // (The assisted standing tackle, less sure than one he went in for, by difficulty: dribble.ts vsHuman.auto.
    // A bump he didn't ask for shouldn't leave him stranded or give away a free kick.)
    if (dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) < 1.0) this.tryTackle(p, c, vsHuman(this.aiSkill(c.side)).auto, true);
  }

  // ---------------------------------------------------------------- penalty shootout

  private startShootout(): void {
    const first = (this.rng.chance(0.5) ? 0 : 1) as Side;
    this.shootout = {
      kicks: [[], []],
      turn: first,
      winner: -1,
      first,
      goal: this.rng.chance(0.5) ? 1 : -1,
      order: [takerOrder(this.bySide[0].filter((p) => !p.sentOff)), takerOrder(this.bySide[1].filter((p) => !p.sentOff))],
      stage: 'intro',
      t: 0,
      taker: -1,
      keeper: -1,
      aimZ: 0,
      stick: { x: 0, z: 0 },
      pen: null,
      dive: null,
      post: false,
      last: null,
    };
    this.soStats = structuredClone(this.stats);
    this.phase = 'shootout';
    this.phaseT = 0;
    this.setupShootoutKick();
    this.shootout.stage = 'intro';
  }

  /** Next taker on the spot, keeper on the line, everyone else lined up on halfway. */
  private setupShootoutKick(): void {
    const s = this.shootout!;
    const side = nextTurn(s.kicks, s.first);
    const def = (side === 0 ? 1 : 0) as Side;
    s.turn = side;
    const g = s.goal;
    const order = s.order[side];
    const taker = this.players[order[s.kicks[side].length % order.length]];
    const k = this.bySide[def][0];
    s.taker = taker.idx;
    s.keeper = k.idx;
    s.stage = 'aim';
    s.t = 0;
    s.pen = null;
    s.dive = null;
    s.post = false;
    s.aimZ = 0;
    const spotX = g * (HALF_L - PEN_SPOT);
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.setState('move');
      p.order = null;
      p.vel.x = p.vel.z = 0;
      p.wantX = p.wantZ = 0;
      p.sprint = false;
      p.running = false;
      p.faceTarget = null;
      p.claiming = false;
      p.y = 0;
      p.vy = 0;
      p.kickT = 0;
      p.kickCooldown = 0;
      if (p === taker) {
        p.pos.x = spotX - g * 0.62;
        p.pos.z = 0;
        p.facing = g > 0 ? 0 : Math.PI;
      } else if (p === k) {
        p.pos.x = g * (HALF_L - 0.3);
        p.pos.z = 0;
        p.facing = g > 0 ? Math.PI : 0;
      } else {
        const q = lineupSpot(p, g);
        p.pos.x = q.x;
        p.pos.z = q.z;
        p.facing = q.facing;
      }
    }
    this.ball.reset(spotX, 0);
    this.ball.owner = taker.idx;
    this.ball.lastTouch = taker.idx;
    this.ball.lastTouchSide = side;
    this.passTarget = -1;
    this.shotClock = 99;
    this.restart = { kind: 'penalty', side, x: spotX, z: 0, taker: taker.idx, wait: 1.1 + this.rng.next() * 0.7 };
    this.stepIn = -1;
    this.runUpFoot = this.rng.chance(0.8) ? 1 : -1;
    this.holdDeadBall();
    const hs = this.cfg.humanSide;
    if (hs === side) this.active = taker.idx;
    else if (hs === def) this.active = k.idx;
  }

  /** Only the taker, the keeper and the ball are simulated; the line-up just waits. */
  private stepShootout(dt: number, pad: Pad): void {
    const s = this.shootout!;
    s.t += dt;
    if (s.stage === 'intro' && s.t >= INTRO_BEAT) {
      s.stage = 'aim';
      s.t = 0;
      this.events.push({ type: 'whistle', kind: 'short' });
    }
    if (s.stage === 'result' && s.t >= RESULT_BEAT) {
      if (s.winner >= 0) this.finishShootout();
      else {
        this.setupShootoutKick();
        this.events.push({ type: 'whistle', kind: 'short' });
      }
      return;
    }
    const taker = this.players[s.taker];
    const k = this.players[s.keeper];
    this.applyHuman(dt, pad);
    if (s.stage === 'aim') {
      // AI takers step up after a breath; a human who never shoots gets the kick taken for them.
      const wait = this.cfg.humanSide === s.turn ? HUMAN_WINDOW : this.restart?.wait ?? 1.4;
      if (!taker.order && s.t > wait) this.shootoutKick(taker, aiPenaltyAim(this.rng));
      k.wantX = k.wantZ = 0;
      k.faceTarget = Math.atan2(this.ball.pos.z - k.pos.z, this.ball.pos.x - k.pos.x);
    } else if (s.stage === 'flight' && s.dive && s.t >= s.dive.at && k.state === 'move') {
      this.commitDive(k, s.dive);
    }
    this.resolveOrders(dt);
    taker.step(dt, this.ball.owner === taker.idx);
    k.step(dt, false);
    this.holdDeadBall();
    this.keepHeldBall();
    this.dribbleControl();
    this.hits.length = 0;
    this.ballPrev.x = this.ball.pos.x;
    this.ballPrev.y = this.ball.pos.y;
    this.ballPrev.z = this.ball.pos.z;
    this.ball.step(dt, this.hits);
    for (const h of this.hits) {
      if (h.kind === 'post') {
        if (s.stage === 'flight') s.post = true;
        this.events.push({ type: 'post', x: h.x, y: h.y, z: h.z, speed: h.speed });
      } else if (h.kind === 'bounce') this.events.push({ type: 'bounce', speed: h.speed });
      else this.events.push({ type: 'net', x: h.x, y: h.y, z: h.z, speed: h.speed });
    }
    if (s.stage === 'flight') {
      this.checkKeeperHands();
      this.judgeKick();
    }
    this.shotClock += dt;
    this.sinceKick += dt;
  }

  /** Human taker aims across the goal mouth and shoots on release; the stick is also the keeper's dive. */
  private shootoutInput(pad: Pad, shootR: boolean, shootPower: number, stickLen: number): void {
    const s = this.shootout;
    if (!s) return;
    s.stick.x = pad.mx;
    s.stick.z = pad.mz;
    if (this.cfg.humanSide !== s.turn || (s.stage !== 'aim' && s.stage !== 'intro')) return;
    const t = this.players[s.taker];
    this.active = t.idx;
    // Sideways share of the stick picks the spot; it stays where it was left.
    if (stickLen > 0.3) s.aimZ = clamp(pad.mz / stickLen / 0.85, -1, 1) * (GOAL_W / 2 - 0.5);
    if (s.stage !== 'aim' || s.t < 0.35 || t.order) return;
    if (shootR) this.shootoutKick(t, { z: s.aimZ, h: 0.3 + shootPower * 0.75, power: shootPower });
  }

  private shootoutKick(t: Player, aim: PenAim): void {
    const s = this.shootout!;
    s.pen = aim;
    t.facing = s.goal > 0 ? 0 : Math.PI;
    this.order(t, 'shot', s.goal, 0, aim.power, -1, false);
  }

  /** The ball is struck: the keeper commits (human stick, or the AI's read / guess). */
  private shootoutStrike(): void {
    const s = this.shootout!;
    s.stage = 'flight';
    s.t = 0;
    const k = this.players[s.keeper];
    const keeping = k.stat.keeping / 100;
    const pred = predictCrossing(this.ball, s.goal * HALF_L);
    const st = s.stick;
    const sl = Math.hypot(st.x, st.z);
    const human = this.cfg.humanSide === k.side && sl > 0.3;
    let dir: -1 | 0 | 1;
    let read = false;
    if (human) dir = Math.abs(st.z) / sl > 0.38 ? (st.z > 0 ? 1 : -1) : 0;
    else ({ dir, read } = keeperGuess(this.rng, keeping, this.keeperBonus(k.side), pred.z));
    const plan = divePlan(dir, pred, this.rng);
    if (!plan) {
      s.dive = null;
      return;
    }
    // Commit early, but leave the line late enough to still be in the air when the ball arrives;
    // a keeper who read the taker gets away sharp.
    const reaction = human ? 0.05 : clamp(0.13 - keeping * 0.06, 0.06, 0.13);
    const at = read ? reaction : Math.max(reaction, pred.t - 0.55);
    // Knowing the side isn't knowing the spot.
    const miss = this.rng.gauss() * 0.35 * (human ? 1 : 1.2 - keeping);
    s.dive = { at, z: plan.z + miss, y: plan.y, arrive: pred.t, boost: read ? 3 : 0 };
  }

  private commitDive(k: Player, d: KeeperDive): void {
    const s = this.shootout!;
    s.dive = null;
    const lateral = d.z - k.pos.z;
    if (Math.abs(lateral) < 0.6) {
      // Down the middle: stand tall and let the hands do it (a hop for a high one).
      if (d.y > 1.9) {
        k.vy = 3.6;
        k.y = 0.01;
      }
      return;
    }
    const keeping = k.stat.keeping / 100;
    const tLeft = Math.max(0.12, d.arrive - d.at);
    const need = Math.max(0, Math.abs(lateral) - 0.85) / tLeft;
    const maxDive = 3.4 + keeping * 1.8 + this.keeperBonus(k.side) * 6 + d.boost;
    k.setState('dive');
    k.diveTravel = Infinity;
    k.vel.z = Math.sign(lateral) * clamp(need * 1.1, 3.2, maxDive);
    k.vel.x = this.attackDir(k.side) * 0.5;
    k.vy = clamp(Math.max(d.y * 2.5 - 0.3, 7.5 * tLeft), 1.5, 5.8);
    k.y = 0.01;
    k.diveDir = Math.sign(lateral) * (Math.cos(k.facing) >= 0 ? 1 : -1);
  }

  /** Settle the kick in flight: in, held, out, bounced back into play, or timed out. */
  private judgeKick(): void {
    const s = this.shootout!;
    const b = this.ball;
    const g = s.goal;
    const hw = GOAL_W / 2;
    const touched = b.lastTouch === s.keeper;
    const past = Math.abs(b.pos.x) > HALF_L + BALL_R && Math.sign(b.pos.x) === g;
    const missHow = (): KickHow =>
      touched ? 'saved' : s.post ? 'post' : Math.abs(b.pos.z) < hw + 0.3 && b.pos.y >= GOAL_H - BALL_R ? 'over' : 'wide';
    let how: KickHow | null = null;
    if (b.inGoal === g || (past && Math.abs(b.pos.z) < hw && b.pos.y < GOAL_H)) how = 'goal';
    else if (b.held) how = 'saved';
    else if (past || Math.abs(b.pos.z) > HALF_W) how = missHow();
    else if ((s.t > 0.15 && b.vel.x * g < -0.3) || s.t > KICK_TIMEOUT) how = missHow();
    if (how) this.endKick(how);
  }

  private endKick(how: KickHow): void {
    const s = this.shootout!;
    const side = s.turn;
    const scored = how === 'goal';
    s.kicks[side].push(scored);
    s.last = { side, taker: s.taker, scored, how };
    s.stage = 'result';
    s.t = 0;
    s.dive = null;
    s.winner = shootoutWinner(s.kicks);
    const taker = this.players[s.taker];
    const k = this.players[s.keeper];
    if (taker.state === 'move') {
      taker.setState(scored ? 'celebrate' : 'dejected');
      taker.celebrate = this.rng.int(4);
    }
    if (scored) {
      this.goalSide = side;
      if (k.state === 'move') k.setState('dejected');
    }
    this.events.push({ type: 'shootoutKick', side, taker: s.taker, scored });
    if (!scored) this.events.push({ type: 'ooh' });
  }

  private finishShootout(): void {
    const s = this.shootout!;
    if (this.soStats) this.stats = this.soStats;
    this.soStats = null;
    this.phase = 'fulltime';
    this.phaseT = 0;
    this.restart = null;
    for (const p of this.players) {
      p.order = null;
      p.wantX = p.wantZ = 0;
    }
    this.events.push({ type: 'whistle', kind: 'end' }, { type: 'fulltime' }, { type: 'shootoutEnd', winner: s.winner as Side });
    // The camera cuts on shootoutEnd, so the two groups are set apart here: the winners spread
    // round the hub on the camera side of halfway (they close in on it in shootoutParty), the losers
    // on a line across the far side, facing away (they trudge a few metres further).
    const winners = this.bySide[s.winner as Side].filter((p) => !p.sentOff);
    const losers = this.bySide[s.winner === 0 ? 1 : 0].filter((p) => !p.sentOff);
    this.partySpots.clear();
    winners.forEach((p, i) => {
      const a = (i / Math.max(1, winners.length)) * Math.PI * 2;
      this.placeFor(p, SO_HUB.x + Math.cos(a) * 6.5, SO_HUB.z + Math.sin(a) * 3.2, Math.atan2(-Math.sin(a), -Math.cos(a)));
      p.setState('celebrate');
      p.celebrate = 4 + this.rng.int(2);
    });
    losers.forEach((p, i) => {
      const x = losers.length > 1 ? -10 + (20 * i) / (losers.length - 1) : 0;
      const z = -10 + (this.rng.next() - 0.5) * 1.6;
      this.partySpots.set(p.idx, { x, z });
      this.placeFor(p, x * 0.9, z + 3, -Math.PI / 2);
      p.setState('dejected');
    });
  }

  /** Stand `p` at (x, z) facing `facing`, at rest. */
  private placeFor(p: Player, x: number, z: number, facing: number): void {
    p.pos.x = x;
    p.pos.z = z;
    p.vel.x = p.vel.z = 0;
    p.facing = facing;
    p.y = p.vy = 0;
    p.kickT = 0;
    p.headerT = 0;
  }

  /** Losing players' spots for the end of a shootout (far side of halfway, spread out). */
  private partySpots = new Map<number, { x: number; z: number }>();

  /** After the winning penalty: the winners pile up at the hub facing the camera, the losers trudge away. */
  private shootoutParty(dt: number): void {
    const s = this.shootout!;
    let i = 0;
    const n = this.bySide[s.winner as Side].filter((p) => !p.sentOff).length;
    for (const p of this.players) {
      if (p.sentOff) {
        this.parkSentOff(p, dt);
        continue;
      }
      p.faceTarget = null;
      if (p.side === s.winner && p.state === 'celebrate') {
        const a = (i++ / Math.max(1, n)) * Math.PI * 2;
        const tx = SO_HUB.x + Math.cos(a) * 2.2;
        const tz = SO_HUB.z + Math.sin(a) * 1.6;
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        p.wantX = d > 0.6 ? dx / d : 0;
        p.wantZ = d > 0.6 ? dz / d : 0;
        p.sprint = d > 4;
        if (d <= 0.6) p.faceTarget = Math.PI / 2;
      } else if (p.side !== s.winner) {
        const w = this.partySpots.get(p.idx);
        const dx = w ? w.x - p.pos.x : 0;
        const dz = w ? w.z - p.pos.z : 0;
        const d = Math.hypot(dx, dz);
        p.wantX = d > 0.5 ? (dx / d) * 0.35 : 0;
        p.wantZ = d > 0.5 ? (dz / d) * 0.35 : 0;
        p.sprint = false;
        // Heads down, backs to the winners.
        p.faceTarget = -Math.PI / 2;
      } else {
        p.wantX = p.wantZ = 0;
        p.sprint = false;
      }
      p.step(dt, false);
    }
    this.separate();
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
