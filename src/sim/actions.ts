import { angleDiff, clamp, dist2, pointSegDist } from '../core/math';
import { Ball, groundPassSpeed, rollTime, solveLob, type BallHit } from './ball';
import {
  AIR_DRAG, BALL_R, BOUNCE, BOX_W, DECEL, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W, KICK_WINDUP, MAGNUS, ROLL_A, ROLL_B, SHOT_TEMPO, SPIN_DECAY,
  SPRINT_SPEED, TEMPO,
} from './constants';
import type { Match } from './match';
import type { KickOrder, Player } from './player';
import { STUMBLE_LOST } from './player';
import { megaLaunch } from './blitz';
import type { AssistLevel, KickKind, ShotStyle } from './types';

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  target: number;
  kind: KickKind;
  power: number;
  /** A shot struck as a chip or a finesse one. */
  style?: ShotStyle;
  /** Shots with the foot: struck with his weaker foot, and how far off balance (0 steady .. 1 all over the place). */
  weak?: boolean;
  balance?: number;
  /**
   * Shots with the foot: the goal line (x) and where on it (z, m; and the height) the strike was meant for,
   * and the error it put on top (the ball is struck at aim + err). Timed finishing's late tap re-aims from these.
   */
  aim?: { gx: number; z: number; errZ: number; h: number; errH: number };
}

function dirOf(p: Player, order: KickOrder): { x: number; z: number } {
  const l = Math.hypot(order.dirX, order.dirZ);
  if (l > 0.2) return { x: order.dirX / l, z: order.dirZ / l };
  return { x: Math.cos(p.facing), z: Math.sin(p.facing) };
}

/** How dangerous a pass lane is: 0 = clear, 1 = an opponent is standing on it. */
export function laneRisk(m: Match, side: number, ax: number, az: number, bx: number, bz: number): number {
  let risk = 0;
  for (const o of m.players) {
    if (o.side === side || o.sentOff) continue;
    const { d, t } = pointSegDist(o.pos.x, o.pos.z, ax, az, bx, bz);
    if (t < 0.04) continue;
    // Opponents further along the lane get more time to close it down.
    const reach = 0.9 + t * dist2(ax, az, bx, bz) * 0.06;
    const r = clamp(1 - d / (reach + 1.4), 0, 1);
    if (r > risk) risk = r;
  }
  return risk;
}

/** Lateral error scale on every shot (tuned with the keepers so ~55-60% of shots are on target). */
const FINISH_ERR = 0.93;
/**
 * Lateral aim error (sd, m at the goal line, before the skill / power / pressure factors) is
 * SHOT_ERR_BASE + distance x SHOT_ERR_DIST: a long shot is less precise, but not so much that
 * nothing from 25 m ever finds a corner (the distance term used to be 0.066).
 */
export const SHOT_ERR_BASE = 1.0;
export const SHOT_ERR_DIST = 0.047;
/** How far inside the post (m, at least) the AI aims a shot it places itself. */
const AI_POST_AIM = 0.12;
/**
 * How far inside the post (m) a shot aimed with the stick at a corner is aimed (16 m out and beyond; was
 * 0.9, and 25-50% of them went wide)...
 */
const STICK_POST_AIM = 1.2;
/** ... and from 11 m or closer. */
const STICK_POST_AIM_CLOSE = 0.45;
/** A human's lateral finishing error relative to the base model (the stick does the aiming)... */
const HUMAN_FINISH = 0.8;
/** ... and how much of the base model's extra lift (a blasted shot climbing over the bar) he gets. */
const HUMAN_LIFT = 0.8;
/**
 * The human's shot assist (an open-play strike with the foot): the stick left alone, or pushed roughly at goal
 * (its line meets the goal line within HUMAN_AT_GOAL_MARGIN m of a post), is a shot for the corner the keeper
 * leaves open, inside the post (it used to go the other way 40% of the time with the gaps within 0.9 m; now
 * only with them level within HUMAN_AUTO_LEVEL m, where either will do). Only a stick pushed clearly across the
 * goal picks a corner itself: the stick at goal from out wide no longer picks the far one by its sign. (Placing
 * it nearer the post than the no-aim spread was tried: a set keeper in the middle of his goal was beaten far
 * too often, finishing.test.ts.)
 */
const HUMAN_AT_GOAL_MARGIN = 0.8;
const HUMAN_AUTO_LEVEL = 0.4;
/**
 * The human's open-play strike isn't punished for a tap: it leaves the foot with at least HUMAN_TAP_PACE of
 * the bar's pace (a driven shot, still low and true: the height and accuracy are the tap's). And the power-miss
 * is softened: the lateral error grows with the bar by HUMAN_POWER_ERR (0.6 in the base model), the upward
 * error by HUMAN_POWER_LIFT of the base model's.
 */
const HUMAN_TAP_PACE = 0.35;
const HUMAN_POWER_ERR = 0.5;
const HUMAN_POWER_LIFT = 0.85;

/**
 * Is the human's shot stick left alone (order.dir under 0.25) or pushed roughly at goal: forwards, its line
 * from the ball (bx, bz) meeting the goal line (gx) within HUMAN_AT_GOAL_MARGIN m of the posts?
 */
function stickAtGoal(order: KickOrder, bx: number, bz: number, gx: number, ad: number): boolean {
  const l = Math.hypot(order.dirX, order.dirZ);
  if (l < 0.25) return true;
  if (order.dirX * ad < 0.2 * l) return false;
  const zHit = bz + (order.dirZ / order.dirX) * (gx - bx);
  return Math.abs(zHit) < GOAL_W / 2 + HUMAN_AT_GOAL_MARGIN;
}
/**
 * Set-piece shots (free kicks, penalties) and finesse curlers: launch speed (m/s) SHOT_SPEED_BASE + power x
 * SHOT_SPEED_POWER x (0.78 + shooting x 0.3), tuned with the walls and keepers (finishing.test.ts).
 */
export const SHOT_SPEED_BASE = 19;
export const SHOT_SPEED_POWER = 13;
/** Beyond this distance (m) a full-power set-piece strike no longer climbs as much (so it isn't always over). */
const LONG_RISE_FROM = 20;
/**
 * An open-play strike, the power bar (how long SHOOT was held) mapped to pace AND height. Launch speed (m/s)
 * STRIKE_SPEED_BASE + power x STRIKE_SPEED_POWER x (0.78 + shooting x 0.3): a tap is still struck hard.
 */
export const STRIKE_SPEED_BASE = 20.5 * SHOT_TEMPO;
export const STRIKE_SPEED_POWER = 10.5 * SHOT_TEMPO;
/**
 * Height (m) it's struck to reach at the goal line, before the error: STRIKE_TAP_H for a tap (under the
 * grass: a low drive that skids off the turf short of the line and skims in) rising with power^STRIKE_LIFT_EXP
 * to STRIKE_FULL_H at a full bar (a riser: into the roof of the net, or over from range).
 */
export const STRIKE_TAP_H = -0.55;
export const STRIKE_FULL_H = 1.75;
const STRIKE_LIFT_EXP = 1.7;
/**
 * Close in, the lift (the power part of the height, and the upward error with it) is scaled down: to
 * STRIKE_CLOSE_LIFT of it from STRIKE_CLOSE_IN m or nearer, all of it from STRIKE_CLOSE_OUT m (a full-power
 * shot from 8 m is a thunderbolt, not a sky-rocket).
 */
const STRIKE_CLOSE_IN = 5;
const STRIKE_CLOSE_OUT = 10;
const STRIKE_CLOSE_LIFT = 0.4;
/**
 * The AI picks its pace and keeps it down: an AI strike gets AI_STRIKE_LIFT of the power bar's lift (the human
 * has the full mapping, it's his choice).
 */
const AI_STRIKE_LIFT = 0.8;
/** From range the upward error grows: x (1 + STRIKE_LONG_SKY per metre beyond STRIKE_LONG_FROM), at most x 1.6. */
const STRIKE_LONG_FROM = 18;
const STRIKE_LONG_SKY = 0.02;

/**
 * Weak foot: a shot struck with the other foot (Player.kickLeg, chosen by the ball's side, isn't his
 * Player.foot) has WEAK_FOOT_ERR more error and WEAK_FOOT_PACE less pace, for a weak foot rated 1-2; a 3 gets
 * two thirds of that, a 4 a third, a two-footed 5 nothing.
 */
export const WEAK_FOOT_ERR = 0.35;
export const WEAK_FOOT_PACE = 0.1;
/**
 * Off balance: his body turned more than OFF_TURN_FROM rad from the shot at the strike (x1.3 error from
 * ~70 degrees, x1.8 by ~150), or still stumbling (Player.stumbleT: x1.3-1.8). OFF_BALANCE_PACE less pace.
 */
const OFF_TURN_FROM = 1.05;
const OFF_TURN_70 = 1.22;
const OFF_TURN_FULL = 2.62;
const OFF_BALANCE_PACE = 0.15;
/** The AI's shooters get this share of the weak-foot and off-balance penalties. */
export const AI_SHAPE = 0.5;
/** A mistimed second tap (timed finishing): this much more height (m) at the line. */
export const WILD_LIFT = 0.6;
/** How much steadier a header is than it used to be (1 = as precise as a shot with the foot). */
const HEADER_COMPOSURE = 0.72;
/**
 * A headed shot's pace (m/s) is 11 + power x 8 + heading x 3, but at most HEADER_SPEED_AT + HEADER_SPEED_SLOPE
 * x (HEADER_SPEED_FROM - distance) (and at least HEADER_SPEED_MIN): a header from 16 m is a 12 m/s nod, one from
 * 20 m 8 m/s, while close in (8 m or nearer) it's as firm as ever. (Round 8: 12 of 25 AI headers from 20-25 m went in.)
 */
const HEADER_SPEED_AT = 12;
const HEADER_SPEED_SLOPE = 0.9;
const HEADER_SPEED_FROM = 16;
const HEADER_SPEED_MIN = 7;
/**
 * An open-play header from HEADER_FAR_D m or further is HEADER_FAR of the power and the composure of a close one
 * (round 12: headers were 63% of the AI's goals; 25% of those from 8-12 m went in). Set-piece deliveries retain
 * their separately tuned accuracy (SET_PIECE_HEADER).
 */
const HEADER_FAR_D = 8;
const HEADER_FAR = 0.85;
/** A header is aimed at goal only from inside HEADER_AT_GOAL_D m with a sight of goal of at least HEADER_AT_GOAL_Q. */
export const HEADER_AT_GOAL_D = 14;
export const HEADER_AT_GOAL_Q = 0.3;

/** Is a header at goal on for `p` from where he is (the AI's call, and the human's automatic one)? */
export function headerAtGoal(m: Match, p: Player): boolean {
  const ad = m.attackDir(p.side);
  return dist2(p.pos.x, p.pos.z, ad * HALF_L, 0) < HEADER_AT_GOAL_D && shotQuality(p.pos.x, p.pos.z, ad) > HEADER_AT_GOAL_Q;
}
/** Headers from a corner / wide free-kick delivery (a crowded box, a marker on you) are rougher still. */
const SET_PIECE_HEADER = 0.7;
/** ... and a glance off one whipped in flat and fast (a driven corner) is harder to place again. */
const DRIVEN_HEADER = 0.65;

/** Longest a throw-in (or a keeper's throw / roll) can go, m. */
export const THROW_RANGE = 26;

/** The same safe, reachable destination is used by the throw-in preview and the actual release. */
export function throwInPlan(m: Match, p: Player, dx: number, dz: number, lockedTarget?: number): { x: number; z: number; target: number } {
  const edge = m.restart?.kind === 'throwin' ? m.restart.z : p.pos.z;
  const inward = -Math.sign(edge) || 1;
  const length = Math.hypot(dx, dz) || 1;
  // Along the line still means into the pitch. An outward stick cannot throw into the stands.
  let ux = dx / length;
  let uz = inward * Math.max(0.25, dz / length * inward);
  const safeLength = Math.hypot(ux, uz);
  ux /= safeLength; uz /= safeLength;
  const eligible = (q: Player) => q !== p && q.side === p.side && !q.isKeeper && !q.sentOff &&
    Math.abs(q.pos.x) < HALF_L && Math.abs(q.pos.z) < HALF_W &&
    dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z) >= 2 && dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z) <= THROW_RANGE;
  let target = lockedTarget ?? -1;
  if (target >= 0 && !eligible(m.players[target])) target = -1;
  if (lockedTarget === undefined && !(m.isHumanControlled(p) && m.groundAssist === 'manual')) {
    let best = -Infinity;
    for (const q of m.teamPlayers(p.side)) {
      if (!eligible(q)) continue;
      const d = dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
      const alignment = ((q.pos.x - p.pos.x) * ux + (q.pos.z - p.pos.z) * uz) / d;
      if (alignment < 0.35) continue;
      const score = alignment * 5 - d * 0.045 + Math.min(6, nearestOppDist(m, q)) * 0.025;
      if (score > best) { best = score; target = q.idx; }
    }
  }
  const q = target >= 0 ? m.players[target] : null;
  let x = clamp(q ? q.pos.x + q.vel.x * 0.18 : p.pos.x + ux * 15, -HALF_L + 2.5, HALF_L - 2.5);
  let z = clamp(q ? q.pos.z + q.vel.z * 0.18 : p.pos.z + uz * 15, -HALF_W + 2.5, HALF_W - 2.5);
  const d = dist2(p.pos.x, p.pos.z, x, z);
  if (d > THROW_RANGE) {
    x = p.pos.x + (x - p.pos.x) * THROW_RANGE / d;
    z = p.pos.z + (z - p.pos.z) * THROW_RANGE / d;
  }
  return { x, z, target };
}
/**
 * Headed balls that aren't shots: at most HEADER_MAX_D m (a clearance aimed further drops there), at most
 * HEADER_MAX_VH m/s along the ground (they used to fly off at 50-58 m/s: a volley's clearance target
 * solved as a header with its 1.2 s flight cap).
 */
export const HEADER_MAX_D = 20;
export const HEADER_MAX_VH = 18;
/**
 * Lofted balls leave the foot at most LOB_MAX_SPEED m/s and clearances CLEAR_MAX_SPEED, with hang times up
 * to LOB_MAX_FLIGHT s (a long ball is lofted higher rather than struck harder; the cap used to be 2.3 s).
 * (Round 8: both were capped at 30, and the critic measured lofted balls at 24.8 m/s on average, max 29.8,
 * clearances at 25.4: too hot to look or play right. Now lofted balls average ~23.3 m/s. A 24 cap was
 * tried: crosses hung up that much longer were met by ~0.35 more headed goals a match at 2x150 s, and the
 * save rate fell from ~55% to ~50%.)
 */
export const LOB_MAX_SPEED = 26;
export const CLEAR_MAX_SPEED = 26;
/**
 * A driven cross (whipped in flat and fast: a SHOOT corner, say) may still be struck up to this fast (m/s),
 * as before: at 26-28 its pace over a hung-up one fell under 3 m/s and the set-piece balance moved.
 */
export const DRIVEN_MAX_SPEED = 30;
const LOB_MAX_FLIGHT = 3.2;
/**
 * Ground passes and through balls leave the foot at most this fast (m/s): a pass arrives at a pace that
 * can be taken (round 8: they reached 28.9 m/s).
 */
export const GROUND_MAX_SPEED = 22 * TEMPO;
/** A driven cross struck at power p hangs (1 + (1 - p) x this) times as long as a full-power one. */
const DRIVEN_HANG = 0.3;

/** Launch speed of a ground pass to feet over `d` metres (firmer the longer it is). */
export function passSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, clamp(7 + d * 0.2, 8, 13) * TEMPO), GROUND_MAX_SPEED);
}

/** Launch speed of a through ball rolling `d` metres into space. */
export function throughSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, 4.5 * TEMPO), GROUND_MAX_SPEED);
}

/**
 * How long (s) the pass-risk models give an opponent to react before he sets off for a ball: cutting out a
 * lane (interceptRisk), racing the receiver to it (laneRace), a ball into space. The AI thinks TEMPO times
 * faster (ai.ts), so these ride on it too: the assist doesn't underrate a lane that closes that much sooner.
 */
const AI_REACT_LANE = 0.32 / TEMPO;
const AI_REACT_RACE = 0.3 / TEMPO;
const AI_REACT_SPACE = 0.25 / TEMPO;

/**
 * Chance an opponent cuts out a ground ball struck at `v0` from A to B: for each opponent,
 * compare when the ball passes their closest point on the line with how long they need to
 * get there. Opponents near B are racing the receiver for it.
 */
export function interceptRisk(m: Match, side: number, ax: number, az: number, bx: number, bz: number, v0: number): number {
  const len = dist2(ax, az, bx, bz);
  if (len < 0.5) return 0;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  let risk = 0;
  for (const o of m.players) {
    if (o.side === side || o.sentOff) continue;
    const rx = o.pos.x - ax;
    const rz = o.pos.z - az;
    const along = rx * ux + rz * uz;
    if (along < 0.5) continue;
    const s = Math.min(along, len);
    const lat = along > len ? dist2(o.pos.x, o.pos.z, bx, bz) : Math.abs(rx * uz - rz * ux);
    const reach = o.isKeeper ? 1.1 : 0.95;
    let r: number;
    if (lat < reach) {
      // Standing in the lane: close up it's a block (about a coin flip), further out it's cut out.
      r = along < 3.8 ? 0.55 : 0.9;
    } else {
      // Only one defender reacts to a pass, and not instantly (calibrated against match outcomes).
      const tb = Math.min(rollTime(v0, s), 4);
      const to = (lat - reach) / (o.top * 0.85) + AI_REACT_LANE;
      r = clamp(0.4 + (tb - to) * 1.6, 0, 1);
    }
    if (along > len * 0.92) r *= 0.75; // at the end it's a duel with the receiver
    if (r > risk) risk = r;
  }
  return risk;
}

/**
 * Human pass assist. The stick picks the direction, but among the teammates that way the assist leans
 * hard towards the one it can actually reach: a lane an opponent can cut out costs HUMAN_LANE_W x its
 * risk (the AI, which picks its own targets, only ever weighed it 0.5), a man with an opponent within
 * HUMAN_MARK_R m of him costs HUMAN_MARKED more, and when everyone in the cone is covered (risk over
 * HUMAN_RISKY) or nobody is in it, the cone opens (HUMAN_CONES) to find the open man rather than
 * rolling it into space at a defender.
 */
const HUMAN_LANE_W = 1.8;
const HUMAN_MARKED = 0.6;
const HUMAN_MARK_R = 2;
const HUMAN_RISKY = 0.6;
const HUMAN_CONES = [1.1, 1.45];
/**
 * ... and with NOBODY in the cone at all, the man out to the side, never behind: at most HUMAN_LAST_CONE (95 degrees)
 * off the aim. (It was 117 degrees, and opened whenever the man in the cone was covered. Round 12, the critic: the
 * stick straight ahead with the winger 48 degrees off and marked, it found an "open" man at -119 degrees behind the
 * carrier. The covered man the stick points at, to his outside foot, beats an open man behind.)
 */
const HUMAN_LAST_CONE = (95 * Math.PI) / 180;

/**
 * The human's pass assistance (Match.groundAssist for PASS, Match.throughAssist for THROUGH and its lofted
 * ball): the lock-on cone's half-angle (rad) for ground passes and through balls. 'assisted' locks on in a
 * wide ~60 degree cone (and looks wider still for an open man, as above, out to the side if need be);
 * 'semi' in a ~38 degree one, looking a little wider (HUMAN_CONES) only when the man there is covered, and
 * with nobody that way it goes where the stick says; 'manual' never locks on. A lofted ball always locks on
 * the way it did (semi-assisted), unless THROUGH is set to manual.
 */
export const ASSIST_CONE: Record<AssistLevel, number> = { assisted: 1.05, semi: 0.66, manual: 0 };

/** The assist level that governs a human ball of this kind. */
export function assistLevel(m: Match, mode: 'pass' | 'through' | 'lob'): AssistLevel {
  return mode === 'pass' ? m.groundAssist : m.throughAssist;
}

/**
 * The human's preview / lock-on is sticky: the man already highlighted (`prefer`) scores this much more, so it
 * doesn't flicker between two similar options while the stick is steady (another has to be clearly better).
 */
export const PREVIEW_STICKY = 0.2;

/**
 * Pick the teammate the passer is aiming at. Returns -1 when nobody is in the cone. `prefer` (the human's
 * current preview, -1 for none) gets PREVIEW_STICKY on his score.
 */
export function pickReceiver(m: Match, p: Player, dx: number, dz: number, mode: 'pass' | 'through' | 'lob', prefer = -1): number {
  const cone = mode === 'lob' ? 0.95 : 0.85;
  if (!m.isHumanControlled(p)) return scanReceivers(m, p, dx, dz, mode, cone, false).idx;
  const level = assistLevel(m, mode);
  if (level === 'manual') return -1;
  const semi = level === 'semi' && mode !== 'lob';
  const first = scanReceivers(m, p, dx, dz, mode, mode === 'lob' ? cone : ASSIST_CONE[level], true, prefer);
  if (first.idx >= 0 && first.risk <= HUMAN_RISKY) return first.idx;
  if (semi && first.idx < 0) return -1;
  // A covered man in the cone: an open one is looked for a little wider (HUMAN_CONES), never behind. Nobody in
  // the cone at all: out to HUMAN_LAST_CONE (a covered man in roughly the right direction beats rolling it into
  // space).
  const cones = mode === 'pass' && !semi && first.idx < 0 ? [...HUMAN_CONES, HUMAN_LAST_CONE] : HUMAN_CONES;
  let fallback = first.idx;
  for (const c of cones) {
    const wide = scanReceivers(m, p, dx, dz, mode, Math.max(cone, c), true, prefer);
    if (wide.open >= 0) return wide.open;
    if (fallback < 0) fallback = wide.idx;
  }
  return fallback;
}

/** The last resort for a THROUGH with nobody to run onto it: the least covered man that way (HUMAN_LAST_CONE), to feet. */
function lastResort(m: Match, p: Player, dx: number, dz: number): number {
  return scanReceivers(m, p, dx, dz, 'pass', HUMAN_LAST_CONE, true).idx;
}

/** How likely a human's ball to `t` is to be cut out: the lane (ground passes), and his marker. */
function passRisk(m: Match, p: Player, t: Player, mode: 'pass' | 'through' | 'lob'): number {
  const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
  // (A through ball with no safe lead point is played to his feet instead: that pass's risk.)
  if (mode === 'through') return throughRisk(m, p, t) ?? passRisk(m, p, t, 'pass');
  // (At the pace the human's ball is actually struck: humanGroundSpeed.)
  const v0 = humanGroundSpeed(d);
  const lane = mode === 'pass'
    ? Math.max(
      laneRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z) * 0.8,
      interceptRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z, v0),
      laneRace(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z, v0),
    )
    : 0;
  const mark = clamp(1 - (nearestOppDist(m, t) - 1) / (HUMAN_MARK_R + 1.5), 0, 1);
  return Math.max(lane, mode === 'lob' ? mark * 0.7 : mark);
}

/**
 * A race along the whole lane of a ground ball struck at `v0` from A to B: for points along it, the
 * ball's arrival against the quickest opponent's (from wherever he is, level with or behind the
 * passer included: a forward pressing a square ball after a kick-off). 0 = nobody gets near it.
 */
export function laneRace(m: Match, side: number, ax: number, az: number, bx: number, bz: number, v0: number): number {
  const len = dist2(ax, az, bx, bz);
  if (len < 1) return 0;
  let risk = 0;
  for (let k = 1; k <= 5; k++) {
    const f = k / 5;
    const px = ax + (bx - ax) * f;
    const pz = az + (bz - az) * f;
    const tb = rollTime(v0, len * f) + KICK_WINDUP;
    for (const o of m.players) {
      if (o.side === side || o.sentOff) continue;
      const to = Math.max(0, dist2(o.pos.x, o.pos.z, px, pz) - (o.isKeeper ? 1.1 : 0.95)) / (o.top * 0.9) + AI_REACT_RACE;
      let r = clamp(0.5 + (tb - to) * 1.4, 0, 1);
      if (f > 0.9) r *= 0.75; // at the end it's a duel with the receiver
      if (r > risk) risk = r;
    }
  }
  return risk;
}

/**
 * Where a through ball to runner `r` is played: into the space ahead of him along his run, biased
 * towards goal, `lead` m on (6 m plus a bit for his pace unless given). `wide` (the human's ball, and the
 * run his THROUGH press calls): a man within WING_LEAD_IN m of a touchline is led down the line, never
 * out towards it (the owner: a winger's ball led diagonally rolled into touch, or was clamped onto the
 * line where the full-back stood).
 */
export function throughLead(m: Match, r: Player, lead?: number, wide = false): { x: number; z: number } {
  const rs = Math.hypot(r.vel.x, r.vel.z);
  const u = throughRun(m, r, wide);
  const l = lead ?? 6 + rs * 0.7;
  return {
    x: clamp(r.pos.x + u.x * l, -HALF_L + 2, HALF_L - 2),
    z: clamp(r.pos.z + u.z * l, -HALF_W + 1.5, HALF_W - 1.5),
  };
}

/** The (unit) line a through ball leads runner `r` along: his run biased towards goal (see throughLead). */
function throughRun(m: Match, r: Player, wide: boolean): { x: number; z: number } {
  const ad = m.attackDir(r.side);
  const rs = Math.hypot(r.vel.x, r.vel.z);
  let rx = rs > 1.5 ? r.vel.x / rs : ad;
  let rz = rs > 1.5 ? r.vel.z / rs : 0;
  rx = rx * 0.6 + ad * 0.4;
  if (wide && Math.abs(r.pos.z) > HALF_W - WING_LEAD_IN && rz * Math.sign(r.pos.z) > 0) rz = 0;
  const rl = Math.hypot(rx, rz) || 1;
  return { x: rx / rl, z: rz / rl };
}
/** A runner this close (m) to a touchline gets a human's through ball straight down the line (throughLead). */
const WING_LEAD_IN = 9;

/**
 * A human's through ball to `t`: the rolling ball's lane to the space ahead of him, and the race for
 * that space (his time to it against the quickest opponent's, keepers included). Null when no lead point
 * is safe to play into (see THROUGH_MAX_INTERCEPT).
 */
function throughRisk(m: Match, p: Player, t: Player): number | null {
  return humanThrough(m, p, t)?.risk ?? null;
}

/**
 * Lead distances (m ahead of the runner, plus a share of his pace for the long ones) a human's through ball weighs:
 * the full run, into his stride, or just in front of his feet; never beyond the room in front of him (leadRoom).
 */
const HUMAN_THROUGH_LEADS = [6, 3.5, 2, 1.2];
const HUMAN_THROUGH_PACED = 3.5;
/**
 * A through-ball lead point a defender would cut out more often than this (interceptRisk) isn't played:
 * the ball goes to the runner's feet instead (round 7: 54% of human through balls were intercepted).
 */
export const THROUGH_MAX_INTERCEPT = 0.45;

/**
 * A through ball rolled into space with nobody in particular running onto it (a human's, with no
 * teammate in the stick's cone): how likely the other side gets there first. The lane's interception,
 * or the race for the spot between our nearest man (who has to read it first) and theirs.
 */
function spaceBallRisk(m: Match, p: Player, x: number, z: number, v0: number): number {
  const b = m.ball.pos;
  const d = Math.max(2, dist2(b.x, b.z, x, z));
  const ir = interceptRisk(m, p.side, b.x, b.z, x, z, v0);
  const tBall = rollTime(v0, d);
  let tUs = Infinity;
  let tThem = Infinity;
  for (const q of m.players) {
    if (q === p || q.sentOff || (q.isKeeper && q.side === p.side)) continue;
    const reach = Math.max(0, dist2(q.pos.x, q.pos.z, x, z) - 1);
    if (q.side === p.side) tUs = Math.min(tUs, reach / (q.top * 0.95) + 0.3);
    else tThem = Math.min(tThem, reach / (q.top * 0.9) + AI_REACT_SPACE);
  }
  const race = clamp(0.5 + (Math.max(tUs, tBall) - tThem) * 0.9, 0, 1);
  return Math.max(ir, race);
}

/**
 * The human's through ball to `t`: the lead (into his stride, or the full run) the space allows, or null
 * when every lead point's lane is one a defender would cut out (the caller plays it to feet).
 */
function humanThrough(m: Match, p: Player, t: Player): { x: number; z: number; risk: number } | null {
  const rs = Math.hypot(t.vel.x, t.vel.z);
  const run = throughRun(m, t, true);
  const room = leadRoom(m, t, run.x, run.z);
  let best: { x: number; z: number; risk: number } | null = null;
  for (const l of HUMAN_THROUGH_LEADS) {
    const lead = l >= HUMAN_THROUGH_PACED ? l + rs * 0.7 : l;
    if (lead > room) continue;
    const pt = throughLead(m, t, lead, true);
    const risk = throughSpaceRisk(m, p, t, pt);
    if (risk === null) continue;
    if (!best || risk < best.risk - 0.05) best = { ...pt, risk };
  }
  return best;
}

/**
 * Risk of a through ball from `p` into the space `pt` ahead of `t`: the race for the space, and the lane
 * weighed the way a pass to feet's is (passRisk: the lane itself, the ball's interception, the race along
 * it). Null when the interception risk alone is over THROUGH_MAX_INTERCEPT.
 */
function throughSpaceRisk(m: Match, p: Player, t: Player, pt: { x: number; z: number }): number | null {
  const d = Math.max(2, dist2(p.pos.x, p.pos.z, pt.x, pt.z));
  const v0 = throughSpeed(d);
  const ir = interceptRisk(m, p.side, p.pos.x, p.pos.z, pt.x, pt.z, v0);
  if (ir > THROUGH_MAX_INTERCEPT) return null;
  const tBall = rollTime(v0, d);
  const tMe = dist2(t.pos.x, t.pos.z, pt.x, pt.z) / (t.top * 0.95);
  let tThem = Infinity;
  for (const o of m.players) {
    if (o.side === p.side || o.sentOff) continue;
    tThem = Math.min(tThem, Math.max(0, dist2(o.pos.x, o.pos.z, pt.x, pt.z) - 1) / (o.top * 0.9) + AI_REACT_SPACE);
  }
  const race = clamp(0.5 + (Math.max(tMe, tBall) - tThem) * 0.9, 0, 1);
  const lane = Math.max(
    laneRisk(m, p.side, p.pos.x, p.pos.z, pt.x, pt.z) * 0.8,
    ir,
    laneRace(m, p.side, p.pos.x, p.pos.z, pt.x, pt.z, v0),
  );
  return Math.max(race, lane);
}

/**
 * A human's pass to feet is played firmer than the AI's (less time to read it): HUMAN_PASS_PACE times
 * the AI's pace at 10 m or less, up to HUMAN_PASS_PACE_LONG at 30 m.
 */
const HUMAN_PASS_PACE = 1.08;
const HUMAN_PASS_PACE_LONG = 1.22;
function humanPassPace(d: number): number {
  return HUMAN_PASS_PACE + clamp((d - 10) / 20, 0, 1) * (HUMAN_PASS_PACE_LONG - HUMAN_PASS_PACE);
}

function scanReceivers(
  m: Match, p: Player, dx: number, dz: number, mode: 'pass' | 'through' | 'lob', cone: number, human: boolean, prefer = -1,
): { idx: number; risk: number; open: number } {
  let best = -1;
  let bestScore = -Infinity;
  let bestRisk = 1;
  // The best-scoring candidate the human assist rates as open (risk at most HUMAN_RISKY).
  let open = -1;
  let openScore = -Infinity;
  const maxD = mode === 'pass' ? 40 : 58;
  const ad = m.attackDir(p.side);
  for (const t of m.players) {
    if (t.side !== p.side || t === p || t.sentOff) continue;
    const vx = t.pos.x - p.pos.x;
    const vz = t.pos.z - p.pos.z;
    const d = Math.hypot(vx, vz);
    if (d < 2.5 || d > maxD) continue;
    const cos = (vx * dx + vz * dz) / d;
    const ang = Math.acos(clamp(cos, -1, 1));
    if (ang > cone) continue;
    let score = cos * 2.2 - d * 0.012;
    let risk = 0;
    if (human) {
      risk = passRisk(m, p, t, mode);
      if (mode === 'pass' || mode === 'through') score -= risk * HUMAN_LANE_W;
      if (nearestOppDist(m, t) < HUMAN_MARK_R) score -= mode === 'lob' ? HUMAN_MARKED * 0.6 : HUMAN_MARKED;
    } else if (mode === 'pass' || mode === 'through') score -= laneRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z) * 0.5;
    if (mode === 'through') score += ((t.pos.x - p.pos.x) * ad) / 40 + (t.vel.x * ad) / 20;
    if (t.isKeeper) score -= 1.2;
    if (human && t.idx === prefer) score += PREVIEW_STICKY;
    if (score > bestScore) {
      bestScore = score;
      best = t.idx;
      bestRisk = risk;
    }
    if (human && risk <= HUMAN_RISKY && !t.isKeeper && score > openScore) {
      openScore = score;
      open = t.idx;
    }
  }
  return { idx: best, risk: bestRisk, open };
}

/** Distance from `p` to the nearest opponent. */
export function nearestOppDist(m: Match, p: Player): number {
  let d = Infinity;
  for (const o of m.players) {
    if (o.side === p.side || o.sentOff) continue;
    const e = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (e < d) d = e;
  }
  return d;
}

/** Error multiplier from difficulty / human control: ~1.3 at skill 0, ~0.8 at skill 4. */
export function skillErr(m: Match, p: Player): number {
  return 1.3 - m.kickSkill(p) * 0.125;
}

/**
 * An AI shooter's finishing error on top of skillErr: a touch steadier than before, since keepers now
 * hold more of the long shots they used to spill (the AI's goal rate was tuned against those rebounds).
 */
const AI_FINISH = 0.8;
function aiFinish(m: Match, p: Player): number {
  return m.isHumanControlled(p) ? 1 : AI_FINISH;
}

/** Being closed down makes every kick a little less clean. */
function pressureErr(m: Match, p: Player): number {
  const d = nearestOppDist(m, p);
  return 1 + clamp((2.8 - d) / 1.8, 0, 1) * 0.8;
}

function passError(p: Player, m: Match, scale: number): number {
  const acc = p.stat.passing / 100;
  return m.rng.gauss() * (1.1 - acc) * 0.1 * scale * skillErr(m, p) * pressureErr(m, p);
}

function rotate(x: number, z: number, a: number): { x: number; z: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - z * s, z: x * s + z * c };
}

// ------------------------------------------------------------------ human pass assistance

/**
 * The error margin's base spread (sd, rad) per assist level: an assisted ball is barely off, a manual one
 * visibly less tidy. See humanPassSpread.
 */
export const ASSIST_SPREAD: Record<AssistLevel, number> = { assisted: 0.02, semi: 0.034, manual: 0.05 };
/** Through balls and lofted balls spread this much more than a pass to feet. */
const THROUGH_SPREAD = 1.3;
const LOB_SPREAD = 1.4;
/**
 * The human's ground pass zips to feet (arcade, Mario Strikers): the ideal pace is HUMAN_GROUND_MIN m/s over
 * a few metres, HUMAN_GROUND_SLOPE m/s more for every metre beyond 4 m, at most HUMAN_GROUND_MAX (a 15 m ball
 * leaves at ~24 m/s and is at his feet in about half a second). The AI keeps passSpeed (GROUND_MAX_SPEED).
 * (Round 9: NOT scaled by TEMPO. At 18-31 m/s the ball beat its own receiver: the marker took it before his
 * first touch, and the human's forward passes fell from ~80% completed to ~66% (tests/human.test.ts pb2).)
 */
export const HUMAN_GROUND_MIN = 16;
export const HUMAN_GROUND_MAX = 27;
const HUMAN_GROUND_SLOPE = 0.72;
/** Ideal launch speed (m/s) of the human's pass to a man `d` m away. */
export function humanGroundSpeed(d: number): number {
  return clamp(HUMAN_GROUND_MIN + (d - 4) * HUMAN_GROUND_SLOPE, HUMAN_GROUND_MIN, HUMAN_GROUND_MAX);
}
/**
 * PASS held past the tap window (a tap, whatever its length up to Match's PASS_TAP_MAX, is the ideal pace:
 * never weaker) charges it ABOVE the ideal: a full bar (`over` 1) is HUMAN_OVERHIT more, at most
 * HUMAN_CHARGED_MAX m/s.
 */
const HUMAN_OVERHIT = 0.4;
export const HUMAN_CHARGED_MAX = 31 * TEMPO;
export function overhitPace(ideal: number, over: number | undefined): number {
  if (over === undefined || !(over > 0)) return ideal;
  return Math.max(ideal, Math.min(HUMAN_CHARGED_MAX, ideal * (1 + clamp(over, 0, 1) * HUMAN_OVERHIT)));
}
/** A manual pass tapped (no charge): a firm, standard pace along the stick. */
const MANUAL_TAP_SPEED = 19 * TEMPO;
/** A manual through ball tapped rolls into space this far (m) along the stick; a charged one 10-36 m. */
const MANUAL_THROUGH_D = 18;
/** A charged lofted ball carries LOB_CHARGE_MIN m with the least charge, up to LOB_CHARGE_MIN + LOB_CHARGE_SPAN. */
const LOB_CHARGE_MIN = 14;
const LOB_CHARGE_SPAN = 34;
/** Semi-assisted through balls go this much of the way from the runner's lead point towards the stick. */
const SEMI_THROUGH_STICK = 0.25;

/**
 * The carry (or through-ball pace) a human's lofted ball / through ball actually gets, from the one the
 * assist judges ideal and the one he charged (undefined for a tap: the ideal). 'assisted': the charge only
 * nudges it, at most 25% either way; 'semi': 60% of the way to the charge (kept within sane bounds);
 * 'manual': the charge, full stop. (Ground passes: overhitPace.)
 */
export function assistPace(level: AssistLevel, ideal: number, charged: number | undefined, max = GROUND_MAX_SPEED): number {
  if (charged === undefined) return Math.min(ideal, max);
  if (level === 'assisted') return clamp(ideal + (charged - ideal) * 0.35, ideal * 0.75, Math.min(max, ideal * 1.25));
  if (level === 'semi') return clamp(ideal + (charged - ideal) * 0.6, ideal * 0.55, Math.min(max, ideal * 1.6));
  return Math.min(charged, max);
}

/**
 * The error margin (sd, rad) of a human ball along `line` (world angle): the level's base spread, scaled
 * by his passing (x 1.3 - passing x 0.6), his speed when he played it (up to x 1.5 at a sprint), how far
 * his body was still turned off the line when he struck it (`bodyOff`, rad, when the kick was ordered;
 * else his facing now: up to x 2.5 for a ball played blind behind his back) and how closely he's pressed.
 */
export function humanPassSpread(m: Match, p: Player, level: AssistLevel, line: number, speed: number, bodyOff?: number): number {
  const off = Math.min(Math.PI, bodyOff ?? Math.abs(angleDiff(p.facing, line)));
  const run = Math.min(speed, SPRINT_SPEED * 1.2) / SPRINT_SPEED;
  return ASSIST_SPREAD[level] * (1.3 - (p.stat.passing / 100) * 0.6) * (1 + run * 0.5) * (1 + (off / Math.PI) * 1.5) *
    pressureErr(m, p);
}

/**
 * Where a human ball to `tgt` (or, with nobody locked on, along the stick) is aimed, near enough for the
 * passer to turn his body to it while he charges: the receiver's reception point for a pass, the lead
 * point for a through ball, where he'll be for a lofted one.
 */
export function passAimPoint(
  m: Match, p: Player, tgt: number, mode: 'pass' | 'through' | 'lob', dx: number, dz: number,
): { x: number; z: number } {
  const b = m.ball.pos;
  const l = Math.hypot(dx, dz) || 1;
  if (tgt < 0) return { x: b.x + (dx / l) * 15, z: b.z + (dz / l) * 15 };
  const r = m.players[tgt];
  if (mode === 'through') {
    const pt = assistLevel(m, 'through') === 'semi' ? semiThrough(m, p, r) : humanThrough(m, p, r);
    if (pt) return pt;
  }
  const d = dist2(b.x, b.z, r.pos.x, r.pos.z);
  const t = mode === 'lob' ? 0.8 + d / 30 : clamp(d / 17, 0.25, 1.6);
  return { x: r.pos.x + r.vel.x * t * 0.85, z: r.pos.z + r.vel.z * t * 0.85 };
}

/**
 * Nobody locked on (a manual ball, or nobody in the cone): the teammate who'll get to the ball's line
 * first, the one it's for as far as switching and receiving go (it isn't steered to him). -1 when nobody of
 * ours gets near it before it stops.
 */
function spaceReceiver(m: Match, p: Player, ux: number, uz: number, v0: number): number {
  const b = m.ball.pos;
  let best = -1;
  let bestT = Infinity;
  for (let k = 1; k <= 12; k++) {
    const s = k * 2.5;
    const tb = rollTime(v0, s);
    if (!Number.isFinite(tb)) break;
    const x = b.x + ux * s;
    const z = b.z + uz * s;
    for (const t of m.teamPlayers(p.side)) {
      if (t === p || t.sentOff || t.isKeeper) continue;
      const tt = Math.max(0, dist2(t.pos.x, t.pos.z, x, z) - 0.9) / (t.top * 0.9) + AI_REACT_SPACE;
      if (tt <= tb + 0.35 && tt < bestT) {
        bestT = tt;
        best = t.idx;
      }
    }
    if (best >= 0) break;
  }
  return best;
}

/**
 * The human's ground pass (PASS): locked onto `order.target` (or whoever the assist picks from the stick),
 * to his feet or to where he'll meet it if he's moving, at the ideal pace (humanGroundSpeed) plus any charge
 * above it (order.charge: overhitPace); 'manual' (or nobody that way) along the stick at MANUAL_TAP_SPEED
 * plus the charge. Then the error margin.
 */
function humanPass(m: Match, p: Player, order: KickOrder, dir: { x: number; z: number }, level: AssistLevel, kind: 'pass' | 'through' = 'pass'): Launch {
  const b = m.ball.pos;
  const speed = order.runSpeed ?? p.speed();
  const over = order.charge;
  const tgt = level === 'manual' ? -1 : order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'pass');
  if (tgt < 0) {
    const sp = overhitPace(MANUAL_TAP_SPEED, over);
    const line = Math.atan2(dir.z, dir.x);
    const a = line + m.rng.gauss() * humanPassSpread(m, p, level, line, speed, order.bodyOff);
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    return launch(ux * sp, 0, uz * sp, 0, 0, 0, spaceReceiver(m, p, ux, uz, sp), kind, clamp(sp / 28, 0, 1));
  }
  const r = m.players[tgt];
  const lead = humanLead(m, p, r, over);
  const tx = lead.x;
  const tz = lead.z;
  let sp = lead.sp;
  const line = Math.atan2(tz - b.z, tx - b.x);
  const a = line + m.rng.gauss() * humanPassSpread(m, p, level, line, speed, order.bodyOff);
  sp *= 1 + m.rng.gauss() * (1 - p.stat.passing / 100) * (level === 'assisted' ? 0.03 : 0.05);
  return launch(Math.cos(a) * sp, 0, Math.sin(a) * sp, 0, 0, 0, tgt, kind, clamp(sp / 28, 0, 1));
}

/**
 * Shares of the receiver's run a human's pass may be led by (HUMAN_LEADS: of where he'd be when the ball
 * arrives), the time to spare he needs at the point (LEAD_EARLY s: he's set on the ball's line when it comes,
 * see Match.receivePoint), how far inside a touchline the point is kept (LEAD_IN m; it was 0.8, and a ball led
 * out towards the line rolled into touch when the winger wasn't square to it) and the most an open man's
 * lead may be cut out (LEAD_RISKY, the lane models' risk).
 */
const HUMAN_LEADS = [1, 0.7, 0.45, 0.25, 0.1, 0];
const LEAD_EARLY = 0.25;
export const LEAD_IN = 1.5;
const LEAD_RISKY = 0.45;
/** A receiver whose run is more than this (cosine) towards the ball is checking to it: no lead. */
const LEAD_CHECKING = 0.3;
/**
 * The outside foot (round 12, the critic: a marker 3.5 m short of the owner's winger and 1 m inside, 2.5-3.5 m off the
 * lane of a ball played at 48-90 degrees, cut out 56% of the balls aimed at the man's feet): with an opponent within
 * OUTSIDE_FOOT_R m of the receiver, every ball to him (a pass to feet, its leads, a through ball to feet) is aimed
 * OUTSIDE_FOOT m to the side of him AWAY from that man, across the ball's line (the touchline side when the man is
 * straight behind him on it), kept LEAD_IN m inside the touchline.
 */
export const OUTSIDE_FOOT = 1.3;
const OUTSIDE_FOOT_R = 3;
/**
 * A ball led into a runner's stride never goes further than the room in front of him: the nearest opponent within
 * LEAD_ROOM_LANE m of his run, less LEAD_ROOM m (round 12: a THROUGH to a wide runner with the full-back 7 m ahead
 * was led into the full-back 11 times in 12).
 */
export const LEAD_ROOM = 2;
const LEAD_ROOM_LANE = 2.5;

/**
 * Where the ball to `r` from the passer at (bx, bz) is aimed relative to his feet: the outside foot when he's marked
 * (OUTSIDE_FOOT), else his feet. Zero offset when nobody is within OUTSIDE_FOOT_R m of him.
 */
export function outsideFoot(m: Match, r: Player, bx: number, bz: number): { x: number; z: number } {
  let near: Player | null = null;
  let nd = OUTSIDE_FOOT_R;
  for (const o of m.players) {
    if (o.side === r.side || o.sentOff) continue;
    const d = dist2(o.pos.x, o.pos.z, r.pos.x, r.pos.z);
    if (d < nd) {
      nd = d;
      near = o;
    }
  }
  if (!near) return { x: 0, z: 0 };
  const lx = r.pos.x - bx;
  const lz = r.pos.z - bz;
  const ll = Math.hypot(lx, lz) || 1;
  // Across the ball's line, on the side away from the marker (the touchline side when he's right on the line).
  const px = -lz / ll;
  const pz = lx / ll;
  const across = (r.pos.x - near.pos.x) * px + (r.pos.z - near.pos.z) * pz;
  const s = Math.abs(across) > 0.3 ? Math.sign(across) : Math.sign(pz * r.pos.z || 1);
  return { x: px * s * OUTSIDE_FOOT, z: pz * s * OUTSIDE_FOOT };
}

/**
 * Room (m) in front of `r` along the run (ux, uz): how far the nearest opponent within LEAD_ROOM_LANE m of that line is
 * ahead of him, less LEAD_ROOM. Infinity with nobody there.
 */
export function leadRoom(m: Match, r: Player, ux: number, uz: number): number {
  let gap = Infinity;
  for (const o of m.players) {
    if (o.side === r.side || o.sentOff) continue;
    const dx = o.pos.x - r.pos.x;
    const dz = o.pos.z - r.pos.z;
    const along = dx * ux + dz * uz;
    if (along <= 0) continue;
    const lat = Math.abs(dx * uz - dz * ux);
    if (lat < LEAD_ROOM_LANE && along < gap) gap = along;
  }
  return gap - LEAD_ROOM;
}

/**
 * Where a human's pass to `r` is aimed, and how hard: into his run as far as is safe. For each share of his
 * run (HUMAN_LEADS) the point is where he'd be when the ball arrives, at the pace it's struck over that
 * distance (solved three times over), kept LEAD_IN m inside the touchline. It's safe when he can be there
 * LEAD_EARLY s before the ball (his run yields to the reception: a man sprinting away from a ball to his feet
 * has to stop and come back, DECEL) and the lane to it is no worse than the one to his feet (interceptRisk,
 * laneRace: the full-back ahead of a winger, say) and under LEAD_RISKY. The longest safe lead is played;
 * with none safe, the least risky one he can reach. (Round 10: every pass led him 0.85 of the way, which put
 * a sprinting winger's ball at the full-back's feet, 1-of-48 completed in tests/wing.test.ts.)
 */
function humanLead(m: Match, p: Player, r: Player, over: number | undefined): { x: number; z: number; sp: number } {
  const b = m.ball.pos;
  const rs = Math.hypot(r.vel.x, r.vel.z);
  const top = r.top * 0.92;
  // A man coming to the ball (checking towards it: the run the press called) is played to feet, not led on.
  const db = dist2(b.x, b.z, r.pos.x, r.pos.z) || 1;
  const toBall = rs > 0.5 ? (r.vel.x * (b.x - r.pos.x) + r.vel.z * (b.z - r.pos.z)) / (rs * db) : 0;
  // The outside foot when he's marked, and the room in front of him a lead may use (leadRoom).
  const foot = outsideFoot(m, r, b.x, b.z);
  const room = rs > 1.5 ? leadRoom(m, r, r.vel.x / rs, r.vel.z / rs) : Infinity;
  const opts: { x: number; z: number; sp: number; risk: number; late: number }[] = [];
  for (const f of HUMAN_LEADS) {
    if (f > 0 && (rs < 1.5 || toBall > LEAD_CHECKING)) continue;
    let tx = r.pos.x;
    let tz = r.pos.z;
    let sp = HUMAN_GROUND_MIN;
    let t = 0;
    for (let i = 0; i < 3; i++) {
      const d = Math.max(1, dist2(b.x, b.z, tx, tz));
      sp = overhitPace(humanGroundSpeed(d), over);
      t = Math.min(rollTime(sp, d), 3);
      tx = clamp(r.pos.x + r.vel.x * t * f + foot.x, -HALF_L + 1, HALF_L - 1);
      tz = clamp(r.pos.z + r.vel.z * t * f + foot.z, -HALF_W + LEAD_IN, HALF_W - LEAD_IN);
    }
    // (Never led into the man in front of him: a lead beyond the room is not an option, to feet always is.)
    if (f > 0 && rs * t * f > room) continue;
    // His time to the point: a run at it, or a stop and a step back when he's going the other way.
    const dx = tx - r.pos.x;
    const dz = tz - r.pos.z;
    const dd = Math.hypot(dx, dz);
    const away = dd > 0.1 ? -(r.vel.x * dx + r.vel.z * dz) / dd : rs;
    let tr = 0.12;
    if (away > 0) tr += away / DECEL + Math.max(0, dd + (away * away) / (2 * DECEL) - 0.55) / top;
    else tr += Math.max(0, dd - 0.55) / top;
    const late = Math.max(0, tr + LEAD_EARLY - t);
    const risk = Math.max(
      laneRisk(m, p.side, b.x, b.z, tx, tz) * 0.8,
      interceptRisk(m, p.side, b.x, b.z, tx, tz, sp),
      laneRace(m, p.side, b.x, b.z, tx, tz, sp),
    );
    opts.push({ x: tx, z: tz, sp, risk, late });
  }
  // The longest lead that's safe, and no riskier than his feet...
  const feetRisk = opts[opts.length - 1].risk;
  for (const o of opts) if (o.late <= 0 && o.risk <= Math.min(LEAD_RISKY, feetRisk + 0.1)) return o;
  // ... else the least risky point he can reach (a late one only when nothing else is left): the longest such
  // lead, now that no lead goes beyond the room in front of him. (Round 12: with everything risky the tie went to
  // the longest lead, and a sprinting winger's ball went 20 m past him to the full-back; preferring the shortest
  // instead cost ~4% of the human's open-play forward passes, played to feet in traffic: tests/human.test.ts pb2.)
  let best = opts[0];
  for (const o of opts) if (o.late < best.late - 1e-6 || (o.late <= best.late + 1e-6 && o.risk < best.risk)) best = o;
  return best;
}

/**
 * Semi-assisted through ball: the destination is where runner `r`'s current run (his velocity, its angle)
 * takes him by the time the ball gets there, a stride beyond it. Null when he isn't running, or when a
 * defender would cut it out (see throughSpaceRisk).
 */
function semiThrough(m: Match, p: Player, r: Player): { x: number; z: number; risk: number } | null {
  const b = m.ball.pos;
  const rs = Math.hypot(r.vel.x, r.vel.z);
  let run: { x: number; z: number; risk: number } | null = null;
  if (rs >= 2) {
    // (A wide man drifting out is led down the line, not into touch: throughLead's `wide`.)
    const vz = Math.abs(r.pos.z) > HALF_W - WING_LEAD_IN && r.vel.z * Math.sign(r.pos.z) > 0 ? 0 : r.vel.z;
    let tx = r.pos.x + r.vel.x;
    let tz = r.pos.z + vz;
    for (let i = 0; i < 3; i++) {
      const d = Math.max(2, dist2(b.x, b.z, tx, tz));
      // (Nobody holds a straight line for long: a lead of more than SEMI_THROUGH_T s of his run is a guess.)
      const t = Math.min(rollTime(throughSpeed(d), d), SEMI_THROUGH_T);
      tx = r.pos.x + r.vel.x * t + (r.vel.x / rs) * 1.5;
      tz = r.pos.z + vz * t + (vz / rs) * 1.5;
    }
    const pt = { x: clamp(tx, -HALF_L + 2, HALF_L - 2), z: clamp(tz, -HALF_W + 1.5, HALF_W - 1.5) };
    const risk = throughSpaceRisk(m, p, r, pt);
    if (risk !== null) run = { ...pt, risk };
  }
  // His run's point when it's about as safe as the safest lead into the space ahead of him (humanThrough).
  const safe = humanThrough(m, p, r);
  return run && (!safe || run.risk <= safe.risk + SEMI_THROUGH_SLACK) ? run : safe;
}

/** Semi through balls: the most of his run (s) the destination allows for, and how much riskier than the safest lead it may be. */
const SEMI_THROUGH_T = 1.6;
const SEMI_THROUGH_SLACK = 0.1;

/**
 * The man a human's THROUGH tap goes to (the lock-on at the press, and Match.throughPreview): the runner the
 * assist picks along the stick; with nobody for it, the open man that way to feet (`feet`) when a ball rolled
 * into the space would be cut out (humanThroughBall's own fallback); -1 when it's rolled into space (or on
 * 'manual').
 */
export function humanThroughTarget(m: Match, p: Player, dx: number, dz: number, prefer = -1): { idx: number; feet: boolean } {
  const t = pickReceiver(m, p, dx, dz, 'through', prefer);
  if (t >= 0 || m.throughAssist === 'manual') return { idx: t, feet: false };
  const b = m.ball.pos;
  const l = Math.hypot(dx, dz) || 1;
  const tx = clamp(b.x + (dx / l) * MANUAL_THROUGH_D, -HALF_L + 2, HALF_L - 2);
  const tz = clamp(b.z + (dz / l) * MANUAL_THROUGH_D, -HALF_W + 1.5, HALF_W - 1.5);
  if (spaceBallRisk(m, p, tx, tz, throughSpeed(Math.max(2, dist2(b.x, b.z, tx, tz)))) <= THROUGH_MAX_INTERCEPT) return { idx: -1, feet: false };
  let alt = pickReceiver(m, p, dx, dz, 'pass', prefer);
  if (alt < 0) alt = lastResort(m, p, dx / l, dz / l);
  return { idx: alt, feet: alt >= 0 };
}

/**
 * The human's through ball (THROUGH tapped). 'assisted': into the space ahead of the man locked onto (as
 * the round-7 assist weighs it); 'semi': where his run takes him (semiThrough), pulled a quarter of the way
 * towards the stick; either way played to his feet when a defender would cut out any ball into the space.
 * 'manual': along the stick, MANUAL_THROUGH_D m (a charged one 10-36 m).
 */
function humanThroughBall(m: Match, p: Player, order: KickOrder, dir: { x: number; z: number }): Launch {
  const level = m.throughAssist;
  const b = m.ball.pos;
  const speed = order.runSpeed ?? p.speed();
  const tgt = level === 'manual' ? -1 : order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'through');
  let tx: number;
  let tz: number;
  if (tgt >= 0) {
    const r = m.players[tgt];
    // (No room in front of him, or every ball into it cut out: a driven through ball to his feet, the outside one
    // when he's marked. It's still his THROUGH: the kick is a 'through' whatever its weight.)
    const pt = order.toFeet ? null : level === 'semi' ? semiThrough(m, p, r) : humanThrough(m, p, r);
    if (!pt) return humanPass(m, p, { ...order, target: tgt, charge: undefined }, dir, level, 'through');
    tx = pt.x;
    tz = pt.z;
    if (level === 'semi') {
      // Mostly where he's running, but the stick has its say (as long as that doesn't hand it to them).
      const d0 = Math.max(2, dist2(b.x, b.z, tx, tz));
      const a0 = Math.atan2(tz - b.z, tx - b.x);
      const off = angleDiff(a0, Math.atan2(dir.z, dir.x));
      if (Math.abs(off) < ASSIST_CONE.semi) {
        const a = a0 + off * SEMI_THROUGH_STICK;
        const q = { x: b.x + Math.cos(a) * d0, z: b.z + Math.sin(a) * d0 };
        const risk = throughSpaceRisk(m, p, r, q);
        if (risk !== null && risk <= pt.risk + SEMI_THROUGH_SLACK) {
          tx = q.x;
          tz = q.z;
        }
      }
    }
  } else {
    const reach = level === 'manual' && order.charge !== undefined ? 10 + clamp(order.charge, 0, 1) * 26 : MANUAL_THROUGH_D;
    tx = b.x + dir.x * reach;
    tz = b.z + dir.z * reach;
  }
  tx = clamp(tx, -HALF_L + 2, HALF_L - 2);
  tz = clamp(tz, -HALF_W + 1.5, HALF_W - 1.5);
  const d = Math.max(2, dist2(b.x, b.z, tx, tz));
  let v0 = throughSpeed(d);
  if (order.charge !== undefined && tgt >= 0) v0 = assistPace(level, v0, throughSpeed(10 + clamp(order.charge, 0, 1) * 26));
  if (tgt < 0 && level !== 'manual' && spaceBallRisk(m, p, tx, tz, v0) > THROUGH_MAX_INTERCEPT) {
    // Nobody to run onto it, and a defender in the way or first to the space: the open man that way gets it
    // to feet rather than the defence getting it rolled to them.
    let alt = pickReceiver(m, p, dir.x, dir.z, 'pass');
    if (alt < 0) alt = lastResort(m, p, dir.x, dir.z);
    if (alt >= 0) return humanPass(m, p, { ...order, target: alt, charge: undefined }, dir, level === 'semi' ? 'semi' : 'assisted', 'through');
  }
  const line = Math.atan2(tz - b.z, tx - b.x);
  const a = line + m.rng.gauss() * humanPassSpread(m, p, level, line, speed, order.bodyOff) * THROUGH_SPREAD;
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const recv = tgt >= 0 ? tgt : spaceReceiver(m, p, ux, uz, v0);
  return launch(ux * v0, 0, uz * v0, 0, 0, 0, recv, 'through', clamp(v0 / 28, 0, 1));
}

// ------------------------------------------------------------------ the human's crosses

/**
 * A human's lofted ball (THROUGH held) from wide in the final third (more than CROSS_WIDE of the half-width
 * in from the middle, beyond CROSS_FINAL of the way from halfway to their goal line) is a cross: it locks onto
 * the best box runner (crossTarget) and drops onto him where he'll be (crossAim).
 */
export const CROSS_WIDE = 0.33;
export const CROSS_FINAL = 0.35;
export function isCrossPosition(m: Match, p: Player): boolean {
  return Math.abs(p.pos.z) > HALF_W * CROSS_WIDE && (p.pos.x * m.attackDir(p.side)) / HALF_L > CROSS_FINAL;
}
/** A cross dropping to a man within CROSS_HEAD_D m of goal with a sight of it is put on his head (CROSS_HEAD_H m)... */
const CROSS_HEAD_D = 13;
const CROSS_HEAD_H = 1.5;
/** ... anywhere else it drops to his feet (CROSS_FEET_H m at the drop). */
const CROSS_FEET_H = 0.55;
/** A cross never drops nearer the goal line than this (m): that's the keeper's ball. */
const CROSS_KEEPER_GAP = 4.5;

/**
 * Where a human's cross to `t` meets him: his run over the ball's flight (towards his box-run zone if the
 * brain gave him one, else on his current velocity), kept out of the keeper's six-yard box; on his head
 * close in with a sight of goal, else to his feet.
 */
export function crossAim(m: Match, p: Player, t: Player): { x: number; z: number; land: number } {
  const b = m.ball.pos;
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const zone = m.brains[t.side].boxZones.get(t.idx);
  let x = t.pos.x;
  let z = t.pos.z;
  for (let i = 0; i < 2; i++) {
    const flight = clamp(0.75 + Math.max(3, dist2(b.x, b.z, x, z)) / 34, 0.9, LOB_MAX_FLIGHT);
    if (zone) {
      const zx = zone.x - t.pos.x;
      const zz = zone.z - t.pos.z;
      const zl = Math.hypot(zx, zz);
      const run = Math.min(zl, t.top * 0.85 * flight);
      x = zl > 0.01 ? t.pos.x + (zx / zl) * run : t.pos.x;
      z = zl > 0.01 ? t.pos.z + (zz / zl) * run : t.pos.z;
    } else {
      x = t.pos.x + t.vel.x * flight * 0.8;
      z = t.pos.z + t.vel.z * flight * 0.8;
    }
  }
  if ((gx - x) * ad < CROSS_KEEPER_GAP) x = gx - ad * CROSS_KEEPER_GAP;
  x = clamp(x, -HALF_L + 2, HALF_L - 2);
  z = clamp(z, -HALF_W + 2, HALF_W - 2);
  const head = dist2(x, z, gx, 0) < CROSS_HEAD_D && shotQuality(x, z, ad) > HEADER_AT_GOAL_Q;
  return { x, z, land: head ? CROSS_HEAD_H : CROSS_FEET_H };
}

/**
 * The box runner a human's cross locks onto: the best chance where it drops (shotQuality there), the most
 * room there (the nearest outfield opponent, up to 4 m), a runner of the brain's box-run plan before a man
 * standing, the way the stick points when it's pushed, and the man already locked on (`prefer`) unless
 * another is clearly better. Never a man in an offside position. -1 when nobody of ours is in or arriving in
 * the box.
 */
export function crossTarget(m: Match, p: Player, dx: number, dz: number, prefer = -1): number {
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const brain = m.brains[p.side];
  const sl = Math.hypot(dx, dz);
  let best = -1;
  let bestS = -Infinity;
  for (const t of m.teamPlayers(p.side)) {
    if (t === p || t.isKeeper || t.sentOff || t.state !== 'move') continue;
    if (m.offside && m.inOffsidePosition(t)) continue;
    const a = crossAim(m, p, t);
    const dp = dist2(p.pos.x, p.pos.z, a.x, a.z);
    if (dist2(a.x, a.z, gx, 0) > 20 || Math.abs(a.z) > BOX_W / 2 || dp < 6) continue;
    let room = 4;
    for (const o of m.players) {
      if (o.side !== p.side && !o.sentOff && !o.isKeeper) room = Math.min(room, dist2(o.pos.x, o.pos.z, a.x, a.z));
    }
    let s = shotQuality(a.x, a.z, ad) * 3 + room * 0.25 + (brain.boxZones.has(t.idx) ? 0.25 : 0);
    if (sl > 0.3) s += (((a.x - p.pos.x) * dx + (a.z - p.pos.z) * dz) / (dp * sl)) * 0.6;
    if (t.idx === prefer) s += PREVIEW_STICKY;
    if (s > bestS) {
      bestS = s;
      best = t.idx;
    }
  }
  return best;
}

/** Solve the ball's launch for a kick order, from wherever the ball is right now. */
export function resolveKick(m: Match, p: Player, order: KickOrder): Launch {
  const L = resolveKickRaw(m, p, order);
  if (m.cfg.mode === 'blitz') megaLaunch(m, p, L);
  // Keeper distribution tops out around 30 m/s (no 90-metre punts).
  if (p.isKeeper && L.kind !== 'shot') {
    const sp = Math.hypot(L.vx, L.vy, L.vz);
    if (sp > 30) {
      const k = 30 / sp;
      L.vx *= k;
      L.vz *= k;
      L.vy *= Math.sqrt(k);
    }
  }
  return L;
}

function resolveKickRaw(m: Match, p: Player, order: KickOrder): Launch {
  const b = m.ball.pos;
  const dir = dirOf(p, order);
  const ad = m.attackDir(p.side);
  const kind = order.kind;

  if (kind === 'shot' || (kind === 'header' && order.target < 0 && order.aimX === undefined)) {
    return resolveShot(m, p, order, kind === 'header');
  }

  if (kind === 'pass' && m.isHumanControlled(p)) return humanPass(m, p, order, dir, m.groundAssist);
  if (kind === 'through' && m.isHumanControlled(p) && order.aimX === undefined) return humanThroughBall(m, p, order, dir);

  if (kind === 'throw') {
    const plan = order.aimX !== undefined && order.aimZ !== undefined
      ? { x: order.aimX, z: order.aimZ, target: order.target }
      : throwInPlan(m, p, dir.x, dir.z, order.target >= 0 ? order.target : undefined);
    const d = Math.max(0.1, dist2(b.x, b.z, plan.x, plan.z));
    const flight = clamp(0.4 + d / 22, 0.55, 1.6);
    const s = solveLob(d, flight, 0.5);
    // Release from the hands, to the point shown when the player pressed THROW.
    return launch((plan.x - b.x) / d * s.vh, s.vy - (b.y - BALL_R) / flight,
      (plan.z - b.z) / d * s.vh, 0, 0, 0, plan.target, kind, 0.4);
  }

  if (kind === 'pass' || kind === 'keeper') {
    const tgt = order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'pass');
    const throwIn = kind === 'keeper';
    if (tgt >= 0) return passToFeet(m, p, tgt, kind);
    // Pass into space along the stick.
    const sp = throwIn ? 9 : 13;
    return launch(dir.x * sp, throwIn ? 3 : 0, dir.z * sp, 0, 0, 0, -1, kind, 0.4);
  }

  if (kind === 'through') {
    const tgt = order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'through');
    let tx: number, tz: number;
    if (order.aimX !== undefined && order.aimZ !== undefined) {
      tx = order.aimX;
      tz = order.aimZ;
    } else if (tgt >= 0) {
      // Into the space ahead of the runner, biased towards goal (a human's is weighted into his stride
      // when a defender would win the race to the longer ball; when a defender would cut out any ball
      // into that space, it's played to his feet instead).
      const pt = m.isHumanControlled(p) ? humanThrough(m, p, m.players[tgt]) : throughLead(m, m.players[tgt]);
      if (!pt) return passToFeet(m, p, tgt, 'pass');
      tx = pt.x;
      tz = pt.z;
    } else {
      tx = b.x + dir.x * 18;
      tz = b.z + dir.z * 18;
    }
    tx = clamp(tx, -HALF_L + 2, HALF_L - 2);
    tz = clamp(tz, -HALF_W + 1.5, HALF_W - 1.5);
    const d = Math.max(2, dist2(b.x, b.z, tx, tz));
    const v0 = throughSpeed(d);
    if (tgt < 0 && order.aimX === undefined && m.isHumanControlled(p) && spaceBallRisk(m, p, tx, tz, v0) > THROUGH_MAX_INTERCEPT) {
      // Nobody to run onto it, and a defender in the way or first to the space (straight after a kick-off,
      // say): the open man that way gets it to feet rather than the defence getting it rolled to them.
      // (Everyone that way covered: the least covered of them, rather than the ball rolled to a defender.)
      let alt = pickReceiver(m, p, dir.x, dir.z, 'pass');
      if (alt < 0) alt = lastResort(m, p, dir.x, dir.z);
      if (alt >= 0) return passToFeet(m, p, alt, 'pass');
    }
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, passError(p, m, 1.3));
    return launch(u.x * v0, 0, u.z * v0, 0, 0, 0, tgt, kind, clamp(v0 / 28, 0, 1));
  }

  if (kind === 'lob' || kind === 'clear' || kind === 'header') {
    let tgt = order.target;
    let tx: number, tz: number;
    // A human's charged lofted ball (THROUGH held): the charge is its carry (and so its height), corrected
    // towards the man it's locked onto as far as THROUGH's assist level allows.
    const humanLob = kind === 'lob' && order.charge !== undefined && m.isHumanControlled(p);
    const carry = humanLob ? LOB_CHARGE_MIN + clamp(order.charge ?? 0, 0, 1) * LOB_CHARGE_SPAN : 0;
    if (order.aimX !== undefined && order.aimZ !== undefined) {
      tx = order.aimX;
      tz = order.aimZ;
    } else {
      if (tgt < 0 && kind !== 'clear') tgt = pickReceiver(m, p, dir.x, dir.z, 'lob');
      if (humanLob && m.throughAssist === 'manual') tgt = -1;
      if (tgt >= 0) {
        const r = m.players[tgt];
        const d0 = dist2(b.x, b.z, r.pos.x, r.pos.z);
        const t0 = 0.8 + d0 / 30;
        tx = r.pos.x + r.vel.x * t0 * 0.8;
        tz = r.pos.z + r.vel.z * t0 * 0.8;
        if (humanLob) {
          const di = Math.max(3, dist2(b.x, b.z, tx, tz));
          const dc = assistPace(m.throughAssist, di, carry, LOB_CHARGE_MIN + LOB_CHARGE_SPAN);
          tx = b.x + ((tx - b.x) / di) * dc;
          tz = b.z + ((tz - b.z) / di) * dc;
        }
      } else {
        const reach = kind === 'clear' ? 42 : humanLob ? carry : 16 + order.power * 24;
        tx = b.x + dir.x * reach;
        tz = b.z + dir.z * reach;
      }
    }
    // A deliberate clearance (or headed clearance) may be aimed off the pitch: into touch, or behind.
    const out = (kind === 'clear' || kind === 'header') && order.aimX !== undefined && tgt < 0 ? 6 : -1;
    tx = clamp(tx, -HALF_L - out, HALF_L + out);
    tz = clamp(tz, -HALF_W - out, HALF_W + out);
    const d0 = dist2(b.x, b.z, tx, tz);
    if (kind === 'header' && d0 > HEADER_MAX_D) {
      // Nobody heads it further than this: a clearance aimed 35 m upfield drops 20 m out.
      tx = b.x + ((tx - b.x) / d0) * HEADER_MAX_D;
      tz = b.z + ((tz - b.z) / d0) * HEADER_MAX_D;
    }
    const d = Math.max(3, dist2(b.x, b.z, tx, tz));
    let flight = kind === 'header'
      ? clamp(0.5 + d / 30, 0.5, 1.2)
      // (A driven ball struck softer hangs a touch longer: DRIVEN_POWER.)
      : order.driven ? clamp(0.42 + d / 42, 0.6, 1.3) * (1 + (1 - clamp(order.power, 0, 1)) * DRIVEN_HANG)
        : clamp(0.75 + d / 34, 0.9, LOB_MAX_FLIGHT) + (order.hang ?? 0);
    const land = order.land ?? (kind === 'clear' ? BALL_R : order.driven ? 1.1 : 1.3);
    let s = solveLob(d, flight, land);
    const maxSpeed = kind === 'clear' ? CLEAR_MAX_SPEED : order.driven ? DRIVEN_MAX_SPEED : LOB_MAX_SPEED;
    if (kind === 'header') {
      // A header can't be struck like a volley: longer ones are looped up rather than fired.
      while (s.vh > HEADER_MAX_VH && flight < 2) {
        flight += 0.05;
        s = solveLob(d, flight, land);
      }
      s = { vh: Math.min(s.vh, HEADER_MAX_VH), vy: s.vy };
    } else {
      // A long ball is hit higher, not harder (the least launch speed for a long carry is near 45 degrees;
      // a driven one only gets the few hundredths of a second of extra hang it needs).
      while (Math.hypot(s.vh, s.vy) > maxSpeed && flight < LOB_MAX_FLIGHT) {
        const f = Math.min(LOB_MAX_FLIGHT, flight + (order.driven ? 0.03 : 0.1));
        const n = solveLob(d, f, land);
        if (Math.hypot(n.vh, n.vy) >= Math.hypot(s.vh, s.vy)) break;
        flight = f;
        s = n;
      }
    }
    const sp0 = Math.hypot(s.vh, s.vy);
    if (kind !== 'header' && sp0 > maxSpeed) {
      // Nobody hits it harder than this: the longest hoofs drop short.
      s = { vh: (s.vh * maxSpeed) / sp0, vy: (s.vy * maxSpeed) / sp0 };
    }
    let err = humanLob
      ? m.rng.gauss() * humanPassSpread(m, p, m.throughAssist, Math.atan2(tz - b.z, tx - b.x), order.runSpeed ?? p.speed(), order.bodyOff) *
        LOB_SPREAD
      : passError(p, m, kind === 'clear' ? 2.2 : 1.4);
    // A scrambled clearance from inside our own box sometimes slices off behind for a corner.
    if (kind === 'clear' && Math.abs(b.x + ad * HALF_L) < 16 && m.rng.chance(0.75 * pressureErr(m, p))) {
      const toLine = -ad; // towards our own goal line
      const zs = Math.sign(b.z || 1);
      // Rotate so the ball heads for the byline on the near side, well wide of the goal.
      const want = Math.atan2(zs * 0.9, toLine * 0.45);
      err = want - Math.atan2((tz - b.z) / d, (tx - b.x) / d);
    }
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, err);
    const vy = kind === 'header' ? s.vy - Math.max(0, b.y - BALL_R) / flight : s.vy;
    return launch(u.x * s.vh, vy, u.z * s.vh, 0, m.rng.gauss() * 1.5, 0, tgt, kind, clamp(s.vh / 28, 0, 1));
  }

  // Fallback: tap it forward.
  return launch(dir.x * 8, 0, dir.z * 8, 0, 0, 0, -1, kind, 0.3);
}

/** A ground pass (or a throw / keeper's roll) to teammate `tgt`'s feet, leading him on his run. */
function passToFeet(m: Match, p: Player, tgt: number, kind: KickKind): Launch {
  const b = m.ball.pos;
  const throwIn = kind === 'throw' || kind === 'keeper';
  const r = m.players[tgt];
  // Lead the receiver: iterate the travel time twice.
  let tx = r.pos.x;
  let tz = r.pos.z;
  let v0 = 12;
  for (let i = 0; i < 2; i++) {
    const d = Math.max(1, dist2(b.x, b.z, tx, tz));
    v0 = passSpeed(d);
    const t = Math.min(rollTime(v0, d), 3);
    tx = r.pos.x + r.vel.x * t * 0.85;
    tz = r.pos.z + r.vel.z * t * 0.85;
  }
  tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
  // A keeper rolls / throws it to the full-back's feet, not onto the touchline.
  const zMax = kind === 'keeper' ? HALF_W - 3 : HALF_W - 0.8;
  tz = clamp(tz, -zMax, zMax);
  let d = dist2(b.x, b.z, tx, tz);
  if (throwIn && d > THROW_RANGE) {
    // Nobody can throw (or roll) it further than this: it drops short, towards the target.
    tx = b.x + ((tx - b.x) / d) * THROW_RANGE;
    tz = b.z + ((tz - b.z) / d) * THROW_RANGE;
    d = THROW_RANGE;
  }
  if (throwIn) {
    // Thrown balls travel at catchable speeds: longer throws hang in the air longer.
    const flight = clamp(0.4 + d / 22, 0.55, 1.6);
    const s = solveLob(d, flight, 0.5);
    const ex = passError(p, m, 0.6);
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, ex);
    // solveLob launches from grass height; we release from the hands.
    const vy = s.vy - (b.y - BALL_R) / flight;
    return launch(u.x * s.vh, vy, u.z * s.vh, 0, 0, 0, tgt, kind, 0.4);
  }
  const ex = passError(p, m, 1);
  const u = rotate((tx - b.x) / d, (tz - b.z) / d, ex);
  const pace = kind === 'pass' && m.isHumanControlled(p) ? humanPassPace(d) : 1;
  const sp = Math.min(GROUND_MAX_SPEED, v0 * pace) * (1 + m.rng.gauss() * (1 - p.stat.passing / 100) * 0.05);
  return launch(u.x * sp, 0, u.z * sp, 0, 0, 0, tgt, kind, clamp(sp / 28, 0, 1));
}

function resolveShot(m: Match, p: Player, order: KickOrder, header: boolean): Launch {
  if (!header && order.style === 'chip') return resolveChip(m, p, order);
  const finesse = !header && order.style === 'finesse';
  const b = m.ball.pos;
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const acc = p.stat.shooting / 100;
  const power = clamp(order.power, 0, 1);
  const hw = GOAL_W / 2;
  const sk = skillErr(m, p) * aiFinish(m, p);
  const press = pressureErr(m, p);

  // Aim: an explicit point on the goal line (a free kick aimed with the arrow), else the stick across
  // the goal picks a corner; otherwise the side the keeper leaves open.
  const keeper = m.keeperOf(p.side === 0 ? 1 : 0);
  const lateral = clamp(order.dirZ, -1, 1); // world z is lateral for both ends
  const human = m.isHumanControlled(p);
  const setPiece = !header && isSetPieceStrike(m, p);
  // The human's open-play strike with the stick left alone or pushed roughly at goal: the shot assist.
  const assist = human && !header && !finesse && !setPiece && stickAtGoal(order, b.x, b.z, gx, ad);
  let aimZ: number;
  if (!header && order.aimZ !== undefined && Number.isFinite(order.aimZ)) {
    aimZ = clamp(order.aimZ, -hw - 4, hw + 4);
  } else if (finesse && Math.abs(lateral) > 0.3) {
    // A finesse shot is placed: just inside the post it's curled towards.
    aimZ = Math.sign(lateral) * (hw - FINESSE_POST_AIM);
  } else if (Math.abs(lateral) > 0.3 && !assist) {
    // The stick picks a corner: from the edge of the box, inside the post by enough that the usual miss
    // still finds the frame; close in, tighter to the post (easier to hit, and to miss).
    const inset = STICK_POST_AIM - clamp((16 - dist2(b.x, b.z, gx, 0)) / 5, 0, 1) * (STICK_POST_AIM - STICK_POST_AIM_CLOSE);
    aimZ = Math.sign(lateral) * (hw - inset);
  } else {
    // Where the keeper blocks the goal line, seen from the ball.
    let kLine = 0;
    if (keeper) {
      const kdx = keeper.pos.x - b.x;
      const t = Math.abs(kdx) > 0.3 ? clamp((gx - b.x) / kdx, 1, 5) : 1;
      kLine = clamp(b.z + (keeper.pos.z - b.z) * t, -hw, hw);
    }
    const gapR = hw - kLine;
    const gapL = kLine + hw;
    let dir = gapR >= gapL ? 1 : -1;
    const dG = dist2(b.x, b.z, gx, 0);
    // A human who doesn't aim gets the open side, but not the corner every time close in (aim for
    // that); from range, where only the corners beat a keeper, it's placed nearer them. The AI goes for
    // the corner, right by the post.
    // (Struck hard from the edge of the box, it's meant for the corner: the harder, the nearer it.)
    const edge = clamp((dG - 12.5) / 3.5, 0, 1) * clamp((20 - dG) / 2.5, 0, 1);
    const spread = (dG < 16 ? 2.0 - clamp((dG - 11) / 5, 0, 1) * 0.9 : 1.1 - clamp((dG - 16) / 8, 0, 1) * 0.5) *
      (1 - power * power * 0.35 * edge);
    // Similar gaps: mix it up (near post / far post) so keepers can't cheat.
    const flip = Math.abs(gapR - gapL) < 0.9 && m.rng.chance(0.4);
    // (The shot assist: the corner away from the keeper whenever he leaves one; only with the gaps level within
    // HUMAN_AUTO_LEVEL m is it either.)
    if (flip && (!assist || Math.abs(gapR - gapL) < HUMAN_AUTO_LEVEL)) dir = -dir;
    aimZ = dir * (human ? hw - 0.35 - m.rng.next() * spread : hw - AI_POST_AIM - m.rng.next() * 0.5);
    if (header) aimZ *= 0.75;
  }
  const d = Math.max(2, dist2(b.x, b.z, gx, aimZ));
  // Headers are less precise than a strike with the foot (but a free header is still a chance);
  // a header from a set-piece delivery, in traffic, less so again.
  const sp = m.setPieceKick === m.kickId;
  const far = header && !sp && d >= HEADER_FAR_D ? HEADER_FAR : 1;
  const composure = header ? HEADER_COMPOSURE * far * (sp ? SET_PIECE_HEADER * (m.setPieceDriven ? DRIVEN_HEADER : 1) : 1) : 1;
  // Coming in at an angle the same miss in the air lands further along the goal line (1 / cos).
  const obl = Math.pow(clamp(Math.abs(gx - b.x) / d, 0.45, 1), 0.8);
  // The body shape (weak foot, off balance: open play only) and a timed-finish tap scale the error.
  const shape = header || setPiece ? null : strikeShape(m, p, Math.atan2(aimZ - b.z, gx - b.x));
  const fin = clamp(order.finish ?? 1, 0.2, 3);
  const errK = (shape?.err ?? 1) * fin;
  // Height at the line. An open-play strike (not a curler): the power bar sets the height as well as the
  // pace, from a tap driven low (it skims in off the turf) to a full bar rising into the roof of the net
  // (or over it, from range); close in the lift is scaled down. Headers, free kicks, penalties and finesse
  // shots keep the placed-low / blasted-high model they were tuned with (from range the climb of a
  // full-power one is capped, so a hit from 25 m isn't mostly over the bar).
  const strike = !header && !setPiece && !finesse;
  // (The human's open-play strike: the power-miss softened, HUMAN_POWER_ERR / HUMAN_POWER_LIFT.)
  const softMiss = human && strike;
  const errZ = (m.rng.gauss() * (SHOT_ERR_BASE + d * SHOT_ERR_DIST) * (1.3 - acc) * (0.6 + power * (softMiss ? HUMAN_POWER_ERR : 0.6)) *
    sk * press * FINISH_ERR * (human ? HUMAN_FINISH : 1) * (finesse ? FINESSE_ACC : 1) * errK) / (composure * obl);
  const tz = aimZ + errZ;
  const rise = header ? 1 : clamp(1 - (d - LONG_RISE_FROM) * 0.035, 0.62, 1);
  const close = STRIKE_CLOSE_LIFT + (1 - STRIKE_CLOSE_LIFT) * clamp((d - STRIKE_CLOSE_IN) / (STRIKE_CLOSE_OUT - STRIKE_CLOSE_IN), 0, 1);
  const sky = strike ? close * Math.min(1.6, 1 + Math.max(0, d - STRIKE_LONG_FROM) * STRIKE_LONG_SKY) : rise;
  const skew = Math.abs(m.rng.gauss()) * (1.15 - acc) * (0.35 + power * (softMiss ? HUMAN_POWER_LIFT : 1)) * 2.1 * sk * press * sky *
    (human ? HUMAN_LIFT : 1) * errK;
  let h: number;
  let hAim: number;
  if (header) {
    h = 0.3 + power * 0.8 + skew * 0.9 + m.rng.gauss() * 0.55;
    hAim = h;
  } else {
    const noise = m.rng.gauss() * 0.25;
    hAim = strike
      ? STRIKE_TAP_H + (STRIKE_FULL_H - STRIKE_TAP_H) * Math.pow(power, STRIKE_LIFT_EXP) * close * (human ? 1 : AI_STRIKE_LIFT)
      : 0.25 + power * power * 1.25 * rise;
    h = hAim + skew + noise * (strike ? fin : 1);
  }
  if (order.wild) h += WILD_LIFT;
  if (!header && b.y > 0.7) {
    h += b.y * 0.35; // volleys fly
    hAim += b.y * 0.35;
  }
  h = Math.max(strike ? STRIKE_TAP_H : 0.15, h);
  // (A tapped shot still has some pace on it: an edge-of-the-box side-foot isn't a back-pass.)
  // (A header dies with distance: no more than HEADER_SPEED_AT + HEADER_SPEED_SLOPE m/s per metre inside
  // HEADER_SPEED_FROM m, so a keeper has one from the edge of the box covered.)
  let speed = header
    ? Math.max(HEADER_SPEED_MIN, Math.min(11 + power * 8 + acc * 3, HEADER_SPEED_AT + HEADER_SPEED_SLOPE * (HEADER_SPEED_FROM - d)) * far)
    : (strike
      ? STRIKE_SPEED_BASE + (softMiss ? Math.max(power, HUMAN_TAP_PACE) : power) * STRIKE_SPEED_POWER * (0.78 + acc * 0.3)
      : SHOT_SPEED_BASE + power * SHOT_SPEED_POWER * (0.78 + acc * 0.3)) * (shape?.pace ?? 1);
  if (finesse) speed = Math.max(speed * FINESSE_PACE, FINESSE_MIN_SPEED);
  speed = Math.min(speed, 35);
  const dx = gx - b.x;
  const dz = tz - b.z;
  const dl = Math.hypot(dx, dz);
  const t = dl / (speed * 0.9);
  let vy = (h - b.y + 0.5 * GRAVITY * t * t) / t;
  vy = clamp(vy, header ? -6 : -2, 13);
  const ux = dx / dl;
  const uz = dz / dl;
  const L = launch(ux * speed, vy, uz * speed, 0, 0, 0, -1, header ? 'header' : 'shot', power);
  if (finesse) L.style = 'finesse';
  const curl = header ? 0 : clamp(order.curl ?? 0, -1, 1);
  let bendErr = 0;
  if (Math.abs(curl) > 0.02) {
    // A bent strike: a touch less precise than a clean one, and it starts outside the target. (A
    // finesse shot's bend is the controlled kind: half the extra error.)
    bendErr = m.rng.gauss() * Math.abs(curl) * CURL_ERR * (finesse ? 0.5 : 1) * fin;
    bendShot(m, L, gx, tz + bendErr, curl);
  } else {
    // A little natural curl so shots don't look like laser beams.
    L.spinY = m.rng.gauss() * 1.2;
  }
  if (shape) {
    L.weak = shape.weak;
    L.balance = shape.balance;
  }
  if (!header) L.aim = { gx, z: aimZ, errZ: errZ + bendErr, h: hAim, errH: h - hAim };
  return L;
}

/** Is `p` striking a dead ball (a free kick or a penalty he's taking)? */
function isSetPieceStrike(m: Match, p: Player): boolean {
  const r = m.restart;
  return (m.phase === 'restart' || m.phase === 'shootout') && !!r && r.taker === p.idx;
}

/** How a strike is struck: see strikeShape. */
export interface StrikeShape {
  /** Error multiplier (1 = clean). */
  err: number;
  /** Pace multiplier (1 = full). */
  pace: number;
  /** Struck with his weaker foot. */
  weak: boolean;
  /** 0 steady .. 1 as far off balance as it gets. */
  balance: number;
}

/** Error multiplier of a strike with the body turned `turn` rad away from the shot (1 = square to it). */
export function turnPenalty(turn: number): number {
  if (turn <= OFF_TURN_FROM) return 1;
  if (turn < OFF_TURN_70) return 1 + (0.3 * (turn - OFF_TURN_FROM)) / (OFF_TURN_70 - OFF_TURN_FROM);
  return 1.3 + 0.5 * clamp((turn - OFF_TURN_70) / (OFF_TURN_FULL - OFF_TURN_70), 0, 1);
}

/**
 * The body shape of a strike along world angle `line`: his weaker foot (the one the ball's side called
 * for isn't his good one) and being off balance (turned well away from the shot, or still stumbling from a
 * challenge) each cost accuracy and pace. The AI's shooters get AI_SHAPE of it.
 */
export function strikeShape(m: Match, p: Player, line: number): StrikeShape {
  const soft = m.isHumanControlled(p) ? 1 : AI_SHAPE;
  const weak = p.kickLeg !== p.foot;
  const wf = weak ? clamp((5 - p.weakFoot) / 3, 0, 1) * soft : 0;
  const turn = turnPenalty(Math.abs(angleDiff(p.facing, line)));
  const reel = p.stumbleT > 0 ? 1.3 + 0.5 * clamp(p.stumbleT / STUMBLE_LOST, 0, 1) : 1;
  const off = (Math.max(turn, reel) - 1) * soft;
  return {
    err: (1 + WEAK_FOOT_ERR * wf) * (1 + off),
    pace: (1 - WEAK_FOOT_PACE * wf) * (1 - OFF_BALANCE_PACE * clamp(off / 0.3, 0, 1)),
    weak,
    balance: clamp(off / 0.8, 0, 1),
  };
}

/**
 * Timed finishing, a tap just after the strike: re-aim the ball in flight so the lateral and height error
 * the strike put on it (Launch.aim) becomes `k` times as big (0.4 perfect, 0.7 good, 1.9 late), plus
 * `lift` m more height at the line. It turns the ball about where it is now (the bend of a curler is
 * already on it, so it keeps it).
 */
export function reaimShot(m: Match, aim: NonNullable<Launch['aim']>, k: number, lift = 0): void {
  const b = m.ball;
  const dx = aim.gx - b.pos.x;
  if (dx * b.vel.x <= 0 || Math.abs(dx) < 0.5) return; // there (or past it) already
  const zOld = aim.z + aim.errZ;
  const zNew = aim.z + aim.errZ * k;
  const turn = Math.atan2(zNew - b.pos.z, Math.abs(dx)) - Math.atan2(zOld - b.pos.z, Math.abs(dx));
  const a = turn * Math.sign(dx);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = b.vel.x * c - b.vel.z * s;
  b.vel.z = b.vel.x * s + b.vel.z * c;
  b.vel.x = vx;
  const hs = Math.hypot(b.vel.x, b.vel.z);
  const t = Math.abs(dx) / Math.max(1, hs * 0.9);
  b.vel.y += (aim.errH * (k - 1) + lift) / Math.max(0.12, t);
}

/** Extra lateral error (sd, m) of a fully bent strike: judging the bend is part of the skill. */
const CURL_ERR = 0.45;

/**
 * Finesse shot (SHOOT with the stick pushed diagonally at a corner, under FINESSE_MAX_POWER): curled
 * (FINESSE_CURL, bending away from the keeper into the corner) and placed FINESSE_POST_AIM m inside the
 * post, FINESSE_PACE of a normal strike's speed (never under FINESSE_MIN_SPEED m/s) with FINESSE_ACC of its
 * lateral error. (Round 7: at 0.84 of a placed strike's ~24 m/s and 0.6 m inside the post it was 0/48 from
 * 18 m angled spots, every one saved; a curler into the far corner has to be struck with some pace.)
 */
export const FINESSE_CURL = 0.6;
export const FINESSE_MAX_POWER = 0.6;
const FINESSE_POST_AIM = 0.35;
const FINESSE_PACE = 0.95;
export const FINESSE_MIN_SPEED = 24;
const FINESSE_ACC = 0.6;

/**
 * Chip: lifted over the keeper, ~CHIP_VH m/s along the ground with ~CHIP_VY m/s of lift, solved so it
 * clears him (CHIP_CLEAR m high where it passes him) and drops under the bar.
 */
export const CHIP_VH = 14;
export const CHIP_VY = 7;
/**
 * (Round 7 tried 2.7, to open the window: it narrowed it. A keeper gets a hand to a ball ~2.6-3.3 m up,
 * so a chip solved to pass 2.7 m over him was claimed: 57% of 15 m chips over a rushing keeper went in
 * against 87% at 3.1 (2.9: 73%, 3.3: 87%). The window is widened by solving against where he'll be.)
 */
const CHIP_CLEAR = 3.1;
/** Most lift (m/s) the chip solver tries (was 10: a keeper right on top of you needs a steeper one). */
const CHIP_VY_MAX = 11;
/** How far ahead (s) the chip allows for the keeper's run: it's lifted over where he'll be, not where he was. */
const CHIP_KEEPER_AHEAD = 0.45;
/** The height (m) at the goal line a chip is best dropping through. */
const CHIP_DROP = 1.5;
/** Error (sd, m/s, times 1.25 - shooting) in a chip's lift. */
const CHIP_LIFT_ERR = 1.3;

/**
 * Height (m) of a ball launched from height `y0` at (`vh`, `vy`) when it has travelled `a` and `b` m
 * along the ground (the same air model as Ball.step, no spin), or -1 where it has already landed.
 */
function chipHeights(y0: number, vh: number, vy: number, a: number, b: number): [number, number] {
  const dt = 1 / 120;
  let x = 0;
  let y = y0;
  let h = vh;
  let v = vy;
  let ya = -1;
  for (let i = 0; i < 480; i++) {
    v -= GRAVITY * dt;
    const k = AIR_DRAG * Math.hypot(h, v) * dt;
    h -= h * k;
    v -= v * k;
    const px = x;
    const py = y;
    x += h * dt;
    y += v * dt;
    if (y < BALL_R) return [ya, -1];
    if (px < a && x >= a) ya = py + (y - py) * ((a - px) / (x - px));
    if (px < b && x >= b) return [ya, py + (y - py) * ((b - px) / (x - px))];
  }
  return [ya, -1];
}

/** A chip over the keeper (see CHIP_VH): aimed with the stick across the goal, else the open side. */
function resolveChip(m: Match, p: Player, order: KickOrder): Launch {
  const b = m.ball.pos;
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const hw = GOAL_W / 2;
  const acc = p.stat.shooting / 100;
  const keeper = m.keeperOf(p.side === 0 ? 1 : 0);
  const lateral = clamp(order.dirZ, -1, 1);
  let aimZ: number;
  if (Math.abs(lateral) > 0.3) aimZ = Math.sign(lateral) * (hw - 1.3);
  else {
    const kz = keeper ? keeper.pos.z : 0;
    aimZ = clamp((kz > b.z * 0.3 ? -1 : 1) * 1.1 + b.z * 0.15, -hw + 1, hw - 1);
  }
  const d = Math.max(3, dist2(b.x, b.z, gx, aimZ));
  const ux = (gx - b.x) / d;
  const uz = (aimZ - b.z) / d;
  // How far along the chip's line the keeper will be when the ball gets to him (a keeper rushing out
  // meets it sooner; a keeper on his line: nothing to clear).
  let kAlong = d;
  if (keeper) {
    let kx = keeper.pos.x;
    let kz = keeper.pos.z;
    for (let i = 0; i < 2; i++) {
      const t = clamp(((kx - b.x) * ux + (kz - b.z) * uz) / CHIP_VH, 0, CHIP_KEEPER_AHEAD);
      kx = keeper.pos.x + keeper.vel.x * t;
      kz = keeper.pos.z + keeper.vel.z * t;
    }
    kAlong = (kx - b.x) * ux + (kz - b.z) * uz;
  }
  const clearAt = clamp(kAlong, 1.5, d - 0.4);
  let best = { vh: CHIP_VH, vy: CHIP_VY };
  let bestCost = Infinity;
  for (let vh = 8; vh <= 18.01; vh += 0.5) {
    for (let vy = 4; vy <= CHIP_VY_MAX + 0.01; vy += 0.25) {
      const [yk, yl] = chipHeights(b.y, vh, vy, clearAt, d);
      if (yl < 0.3 || yl > GOAL_H - 0.45) continue;
      const short = Math.max(0, CHIP_CLEAR - yk);
      // (Dropping steeply behind him, well under the bar, rather than skimming it.)
      const cost = (vh - CHIP_VH) ** 2 * 0.2 + (vy - CHIP_VY) ** 2 * 0.3 + short * 40 + (yl - CHIP_DROP) ** 2 * 2;
      if (cost < bestCost) {
        bestCost = cost;
        best = { vh, vy };
      }
    }
  }
  // Execution: a touch of lateral and lift error (the finer the finisher, the less; off his weaker foot or
  // off balance, more).
  const shape = isSetPieceStrike(m, p) ? null : strikeShape(m, p, Math.atan2(uz, ux));
  const sk = skillErr(m, p) * aiFinish(m, p) * (shape?.err ?? 1);
  // A chip is a delicate thing: the weight (how high, how far) is easy to get wrong.
  const u = rotate(ux, uz, m.rng.gauss() * (0.03 + (1 - acc) * 0.06) * sk);
  const vy = best.vy + m.rng.gauss() * CHIP_LIFT_ERR * (1.25 - acc) * sk;
  const vh = best.vh * (1 + m.rng.gauss() * 0.07 * sk);
  const L = launch(u.x * vh, vy, u.z * vh, 0, 0, 0, -1, 'shot', clamp(order.power, 0.2, 0.6));
  L.style = 'chip';
  if (shape) {
    L.weak = shape.weak;
    L.balance = shape.balance;
  }
  return L;
}

/** Sidespin (rad/s) of a full-curl strike: bends a 25 m free kick ~2 m. */
export const CURL_SPIN = 10;

/**
 * Put sidespin on a shot so it bends towards +z (curl > 0) or -z, and re-aim the launch so the
 * bend carries it back onto `tz` at the goal line.
 */
export function bendShot(m: Match, L: Launch, gx: number, tz: number, curl: number): void {
  const b = m.ball.pos;
  L.spinY = -clamp(curl, -1, 1) * CURL_SPIN * (Math.sign(L.vx) || 1);
  const want = Math.atan2(tz - b.z, gx - b.x);
  for (let i = 0; i < 3; i++) {
    const z = crossingZ(b.x, b.y, b.z, L.vx, L.vy, L.vz, L.spinY, gx);
    if (z === null) break;
    const err = angleDiff(Math.atan2(z - b.z, gx - b.x), want);
    if (Math.abs(err) < 1e-4) break;
    const c = Math.cos(err);
    const sn = Math.sin(err);
    const vx = L.vx * c - L.vz * sn;
    L.vz = L.vx * sn + L.vz * c;
    L.vx = vx;
  }
}

/**
 * Where a ball launched from (x, y, z) with sidespin `sy` crosses the line x = gx, using the same
 * air / bounce / roll model as Ball.step (no posts or players). Null if it never gets there.
 */
export function crossingZ(
  x: number, y: number, z: number, vx: number, vy: number, vz: number, sy: number, gx: number,
): number | null {
  const dt = 1 / 60;
  const dir = Math.sign(gx - x) || 1;
  for (let i = 0; i < 240; i++) {
    const grounded = y <= BALL_R + 0.005 && Math.abs(vy) < 0.9;
    if (grounded) {
      y = BALL_R;
      vy = 0;
      const sh = Math.hypot(vx, vz);
      if (sh < 0.3) return null;
      const k = Math.max(0, sh - (ROLL_A + ROLL_B * sh) * dt) / sh;
      vx *= k;
      vz *= k;
      sy *= Math.exp(-SPIN_DECAY * 4 * dt);
    } else {
      vy -= GRAVITY * dt;
      const drag = AIR_DRAG * Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
      vx -= vx * drag;
      vy -= vy * drag;
      vz -= vz * drag;
      vx += MAGNUS * sy * vz * dt;
      vz -= MAGNUS * sy * vx * dt;
      sy *= Math.exp(-SPIN_DECAY * dt);
    }
    const px = x;
    const pz = z;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y < BALL_R) {
      y = BALL_R;
      if (vy < -1.1) {
        vy = -vy * BOUNCE;
        vx *= 0.86;
        vz *= 0.86;
      } else vy = 0;
    }
    if ((x - gx) * dir >= 0) {
      const f = Math.abs(x - px) > 1e-6 ? (gx - px) / (x - px) : 1;
      return pz + (z - pz) * f;
    }
  }
  return null;
}

/**
 * Curl from a human's stick at the moment of the strike: its sideways (world z) share bends the
 * shot that way; a gentle push is a gentle bend. Small deflections of the stick do nothing.
 */
export function stickCurl(mz: number): number {
  const a = Math.abs(mz);
  return Math.sign(mz) * clamp((a - 0.25) / 0.55, 0, 1);
}

/** Opponents (outfield) standing in the shooting lane from `p` to the middle of the goal. */
export function shotBlockers(m: Match, p: Player): number {
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  let n = 0;
  for (const o of m.players) {
    if (o.side === p.side || o.isKeeper || o.sentOff) continue;
    const { d, t } = pointSegDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, gx, clamp(p.pos.z * 0.2, -1.5, 1.5));
    if (t > 0.02 && t < 0.97 && d < 0.6 + t * 1.1) n += d < 0.5 ? 1 : 0.5;
  }
  return n;
}

function launch(
  vx: number, vy: number, vz: number,
  spinX: number, spinY: number, spinZ: number,
  target: number, kind: KickKind, power: number,
): Launch {
  return { vx, vy, vz, spinX, spinY, spinZ, target, kind, power };
}

const scratch = new Ball();
const scratchHits: BallHit[] = [];

/**
 * Is the ball's current flight going to end up in the net if nobody touches it? Runs the real
 * ball physics (drag, curl, posts) on a scratch ball, so shots off the woodwork don't count.
 */
export function onTarget(m: Match, side: number): boolean {
  const b = m.ball;
  const ad = m.attackDir(side as 0 | 1);
  if (b.vel.x * ad <= 0.5) return false;
  scratch.reset(b.pos.x, b.pos.z);
  scratch.pos.y = b.pos.y;
  scratch.vel.x = b.vel.x;
  scratch.vel.y = b.vel.y;
  scratch.vel.z = b.vel.z;
  scratch.spin.x = b.spin.x;
  scratch.spin.y = b.spin.y;
  scratch.spin.z = b.spin.z;
  for (let i = 0; i < 240; i++) {
    scratchHits.length = 0;
    scratch.step(1 / 60, scratchHits);
    if (scratch.inGoal !== 0) return scratch.inGoal === ad;
    if (Math.abs(scratch.pos.x) > HALF_L + 0.5 || scratch.hspeed() < 0.5) return false;
  }
  return false;
}

/** Approximate chance a shot from here goes in, used by the AI to decide when to shoot. */
export function shotQuality(x: number, z: number, ad: number): number {
  const gx = ad * HALF_L;
  const hw = GOAL_W / 2;
  const a1 = Math.atan2(-hw - z, gx - x);
  const a2 = Math.atan2(hw - z, gx - x);
  let width = Math.abs(a2 - a1);
  if (width > Math.PI) width = Math.PI * 2 - width;
  const d = dist2(x, z, gx, 0);
  return clamp(Math.pow(width / 0.8, 1.1) * Math.exp(-d / 21), 0, 0.85);
}
