import { angleDiff, clamp, dist2, pointSegDist } from '../core/math';
import { Ball, groundPassSpeed, rollTime, solveLob, type BallHit } from './ball';
import {
  AIR_DRAG, BALL_R, BOUNCE, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W, KICK_WINDUP, MAGNUS, ROLL_A, ROLL_B, SPIN_DECAY,
} from './constants';
import type { Match } from './match';
import type { KickOrder, Player } from './player';
import type { KickKind, ShotStyle } from './types';

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
/** Shot launch speed (m/s): SHOT_SPEED_BASE + power x SHOT_SPEED_POWER x (0.78 + shooting x 0.3). */
export const SHOT_SPEED_BASE = 19;
export const SHOT_SPEED_POWER = 13;
/** Beyond this distance (m) a full-power strike no longer climbs as much (so it isn't always over). */
const LONG_RISE_FROM = 20;
/** How much steadier a header is than it used to be (1 = as precise as a shot with the foot). */
const HEADER_COMPOSURE = 0.72;
/** Headers from a corner / wide free-kick delivery (a crowded box, a marker on you) are rougher still. */
const SET_PIECE_HEADER = 0.7;
/** ... and a glance off one whipped in flat and fast (a driven corner) is harder to place again. */
const DRIVEN_HEADER = 0.65;

/** Longest a throw-in (or a keeper's throw / roll) can go, m. */
export const THROW_RANGE = 26;
/**
 * Headed balls that aren't shots: at most HEADER_MAX_D m (a clearance aimed further drops there), at most
 * HEADER_MAX_VH m/s along the ground (they used to fly off at 50-58 m/s: a volley's clearance target
 * solved as a header with its 1.2 s flight cap).
 */
export const HEADER_MAX_D = 20;
export const HEADER_MAX_VH = 18;
/**
 * Lofted balls and clearances: at most LOB_MAX_SPEED m/s off the foot, and hang times up to
 * LOB_MAX_FLIGHT s (a long ball is lofted higher rather than struck harder; the cap used to be 2.3 s).
 */
export const LOB_MAX_SPEED = 30;
const LOB_MAX_FLIGHT = 3.2;
/** A driven cross struck at power p hangs (1 + (1 - p) x this) times as long as a full-power one. */
const DRIVEN_HANG = 0.3;

/** Launch speed of a ground pass to feet over `d` metres (firmer the longer it is). */
export function passSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, clamp(7 + d * 0.2, 8, 13)), 28);
}

/** Launch speed of a through ball rolling `d` metres into space. */
export function throughSpeed(d: number): number {
  return Math.min(groundPassSpeed(d, 4.5), 28);
}

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
      const to = (lat - reach) / (o.top * 0.85) + 0.32;
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
/** ... and for a pass to feet with nobody open that way, the open man out to the side (never straight back). */
const HUMAN_LAST_CONE = 2.05;

/** Pick the teammate the passer is aiming at. Returns -1 when nobody is in the cone. */
export function pickReceiver(m: Match, p: Player, dx: number, dz: number, mode: 'pass' | 'through' | 'lob'): number {
  const cone = mode === 'lob' ? 0.95 : 0.85;
  if (!m.isHumanControlled(p)) return scanReceivers(m, p, dx, dz, mode, cone, false).idx;
  const first = scanReceivers(m, p, dx, dz, mode, cone, true);
  if (first.idx >= 0 && first.risk <= HUMAN_RISKY) return first.idx;
  const cones = mode === 'pass' ? [...HUMAN_CONES, HUMAN_LAST_CONE] : HUMAN_CONES;
  let fallback = first.idx;
  for (const c of cones) {
    const wide = scanReceivers(m, p, dx, dz, mode, Math.max(cone, c), true);
    if (wide.open >= 0) return wide.open;
    // (Nobody that way at all: a covered man in roughly the right direction beats rolling it into space.)
    if (fallback < 0 && c < HUMAN_LAST_CONE) fallback = wide.idx;
  }
  return fallback;
}

/** How likely a human's ball to `t` is to be cut out: the lane (ground passes), and his marker. */
function passRisk(m: Match, p: Player, t: Player, mode: 'pass' | 'through' | 'lob'): number {
  const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
  // (A through ball with no safe lead point is played to his feet instead: that pass's risk.)
  if (mode === 'through') return throughRisk(m, p, t) ?? passRisk(m, p, t, 'pass');
  const v0 = passSpeed(d) * humanPassPace(d);
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
      const to = Math.max(0, dist2(o.pos.x, o.pos.z, px, pz) - (o.isKeeper ? 1.1 : 0.95)) / (o.top * 0.9) + 0.3;
      let r = clamp(0.5 + (tb - to) * 1.4, 0, 1);
      if (f > 0.9) r *= 0.75; // at the end it's a duel with the receiver
      if (r > risk) risk = r;
    }
  }
  return risk;
}

/**
 * Where a through ball to runner `r` is played: into the space ahead of him along his run, biased
 * towards goal, `lead` m on (6 m plus a bit for his pace unless given).
 */
export function throughLead(m: Match, r: Player, lead?: number): { x: number; z: number } {
  const ad = m.attackDir(r.side);
  const rs = Math.hypot(r.vel.x, r.vel.z);
  let rx = rs > 1.5 ? r.vel.x / rs : ad;
  const rz = rs > 1.5 ? r.vel.z / rs : 0;
  rx = rx * 0.6 + ad * 0.4;
  const rl = Math.hypot(rx, rz) || 1;
  const l = lead ?? 6 + rs * 0.7;
  return {
    x: clamp(r.pos.x + (rx / rl) * l, -HALF_L + 2, HALF_L - 2),
    z: clamp(r.pos.z + (rz / rl) * l, -HALF_W + 1.5, HALF_W - 1.5),
  };
}

/**
 * A human's through ball to `t`: the rolling ball's lane to the space ahead of him, and the race for
 * that space (his time to it against the quickest opponent's, keepers included). Null when no lead point
 * is safe to play into (see THROUGH_MAX_INTERCEPT).
 */
function throughRisk(m: Match, p: Player, t: Player): number | null {
  return humanThrough(m, p, t)?.risk ?? null;
}

/** Lead distances (m ahead of the runner) a human's through ball weighs: into his stride, or longer. */
const HUMAN_THROUGH_LEADS = [3.5, 6];
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
    else tThem = Math.min(tThem, reach / (q.top * 0.9) + 0.25);
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
  let best: { x: number; z: number; risk: number } | null = null;
  for (const l of HUMAN_THROUGH_LEADS) {
    const pt = throughLead(m, t, l + rs * 0.7);
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
    tThem = Math.min(tThem, Math.max(0, dist2(o.pos.x, o.pos.z, pt.x, pt.z) - 1) / (o.top * 0.9) + 0.25);
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
  m: Match, p: Player, dx: number, dz: number, mode: 'pass' | 'through' | 'lob', cone: number, human: boolean,
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
const AI_FINISH = 0.88;
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

/** Solve the ball's launch for a kick order, from wherever the ball is right now. */
export function resolveKick(m: Match, p: Player, order: KickOrder): Launch {
  const L = resolveKickRaw(m, p, order);
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

  if (kind === 'pass' || kind === 'throw' || kind === 'keeper') {
    const tgt = order.target >= 0 ? order.target : pickReceiver(m, p, dir.x, dir.z, 'pass');
    const throwIn = kind === 'throw' || kind === 'keeper';
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
      if (alt < 0) alt = scanReceivers(m, p, dir.x, dir.z, 'pass', HUMAN_LAST_CONE, true).idx;
      if (alt >= 0) return passToFeet(m, p, alt, 'pass');
    }
    const u = rotate((tx - b.x) / d, (tz - b.z) / d, passError(p, m, 1.3));
    return launch(u.x * v0, 0, u.z * v0, 0, 0, 0, tgt, kind, clamp(v0 / 28, 0, 1));
  }

  if (kind === 'lob' || kind === 'clear' || kind === 'header') {
    let tgt = order.target;
    let tx: number, tz: number;
    if (order.aimX !== undefined && order.aimZ !== undefined) {
      tx = order.aimX;
      tz = order.aimZ;
    } else {
      if (tgt < 0 && kind !== 'clear') tgt = pickReceiver(m, p, dir.x, dir.z, 'lob');
      if (tgt >= 0) {
        const r = m.players[tgt];
        const d0 = dist2(b.x, b.z, r.pos.x, r.pos.z);
        const t0 = 0.8 + d0 / 30;
        tx = r.pos.x + r.vel.x * t0 * 0.8;
        tz = r.pos.z + r.vel.z * t0 * 0.8;
      } else {
        const reach = kind === 'clear' ? 42 : 16 + order.power * 24;
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
      while (Math.hypot(s.vh, s.vy) > LOB_MAX_SPEED && flight < LOB_MAX_FLIGHT) {
        const f = Math.min(LOB_MAX_FLIGHT, flight + (order.driven ? 0.03 : 0.1));
        const n = solveLob(d, f, land);
        if (Math.hypot(n.vh, n.vy) >= Math.hypot(s.vh, s.vy)) break;
        flight = f;
        s = n;
      }
    }
    const sp0 = Math.hypot(s.vh, s.vy);
    if (kind !== 'header' && sp0 > LOB_MAX_SPEED) {
      // Nobody hits it harder than this: the longest hoofs drop short.
      s = { vh: (s.vh * LOB_MAX_SPEED) / sp0, vy: (s.vy * LOB_MAX_SPEED) / sp0 };
    }
    let err = passError(p, m, kind === 'clear' ? 2.2 : 1.4);
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
  const sp = Math.min(28, v0 * pace) * (1 + m.rng.gauss() * (1 - p.stat.passing / 100) * 0.05);
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
  let aimZ: number;
  if (!header && order.aimZ !== undefined && Number.isFinite(order.aimZ)) {
    aimZ = clamp(order.aimZ, -hw - 4, hw + 4);
  } else if (finesse && Math.abs(lateral) > 0.3) {
    // A finesse shot is placed: just inside the post it's curled towards.
    aimZ = Math.sign(lateral) * (hw - FINESSE_POST_AIM);
  } else if (Math.abs(lateral) > 0.3) {
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
    // Similar gaps: mix it up (near post / far post) so keepers can't cheat.
    if (Math.abs(gapR - gapL) < 0.9 && m.rng.chance(0.4)) dir = -dir;
    // A human who doesn't aim gets the open side, but not the corner every time close in (aim for
    // that); from range, where only the corners beat a keeper, it's placed nearer them. The AI goes for
    // the corner, right by the post.
    // (Struck hard from the edge of the box, it's meant for the corner: the harder, the nearer it.)
    const dG = dist2(b.x, b.z, gx, 0);
    const edge = clamp((dG - 12.5) / 3.5, 0, 1) * clamp((20 - dG) / 2.5, 0, 1);
    const spread = (dG < 16 ? 2.0 - clamp((dG - 11) / 5, 0, 1) * 0.9 : 1.1 - clamp((dG - 16) / 8, 0, 1) * 0.5) *
      (1 - power * power * 0.35 * edge);
    aimZ = dir * (human ? hw - 0.35 - m.rng.next() * spread : hw - AI_POST_AIM - m.rng.next() * 0.5);
    if (header) aimZ *= 0.75;
  }
  const d = Math.max(2, dist2(b.x, b.z, gx, aimZ));
  // Headers are less precise than a strike with the foot (but a free header is still a chance);
  // a header from a set-piece delivery, in traffic, less so again.
  const sp = m.setPieceKick === m.kickId;
  const composure = header ? HEADER_COMPOSURE * (sp ? SET_PIECE_HEADER * (m.setPieceDriven ? DRIVEN_HEADER : 1) : 1) : 1;
  // Coming in at an angle the same miss in the air lands further along the goal line (1 / cos).
  const obl = Math.pow(clamp(Math.abs(gx - b.x) / d, 0.45, 1), 0.8);
  const errZ = (m.rng.gauss() * (SHOT_ERR_BASE + d * SHOT_ERR_DIST) * (1.3 - acc) * (0.6 + power * 0.6) * sk * press * FINISH_ERR *
    (human ? HUMAN_FINISH : 1) * (finesse ? FINESSE_ACC : 1)) / (composure * obl);
  const tz = aimZ + errZ;
  // Height at the line: placed shots stay low, blasted ones climb (and can fly over). From range
  // the climb of a full-power strike is capped, so a hit from 25 m isn't mostly over the bar.
  const rise = header ? 1 : clamp(1 - (d - LONG_RISE_FROM) * 0.035, 0.62, 1);
  const skew = Math.abs(m.rng.gauss()) * (1.15 - acc) * (0.35 + power) * 2.1 * sk * press * rise * (human ? HUMAN_LIFT : 1);
  let h = header
    ? 0.3 + power * 0.8 + skew * 0.9 + m.rng.gauss() * 0.55
    : 0.25 + power * power * 1.25 * rise + skew + m.rng.gauss() * 0.25;
  if (!header && b.y > 0.7) h += b.y * 0.35; // volleys fly
  h = Math.max(0.15, h);
  // (A tapped shot still has some pace on it: an edge-of-the-box side-foot isn't a back-pass.)
  let speed = header ? 11 + power * 8 + acc * 3 : SHOT_SPEED_BASE + power * SHOT_SPEED_POWER * (0.78 + acc * 0.3);
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
  if (Math.abs(curl) > 0.02) {
    // A bent strike: a touch less precise than a clean one, and it starts outside the target. (A
    // finesse shot's bend is the controlled kind: half the extra error.)
    bendShot(m, L, gx, tz + m.rng.gauss() * Math.abs(curl) * CURL_ERR * (finesse ? 0.5 : 1), curl);
  } else {
    // A little natural curl so shots don't look like laser beams.
    L.spinY = m.rng.gauss() * 1.2;
  }
  return L;
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
  // Execution: a touch of lateral and lift error (the finer the finisher, the less).
  const sk = skillErr(m, p) * aiFinish(m, p);
  // A chip is a delicate thing: the weight (how high, how far) is easy to get wrong.
  const u = rotate(ux, uz, m.rng.gauss() * (0.03 + (1 - acc) * 0.06) * sk);
  const vy = best.vy + m.rng.gauss() * CHIP_LIFT_ERR * (1.25 - acc) * sk;
  const vh = best.vh * (1 + m.rng.gauss() * 0.07 * sk);
  const L = launch(u.x * vh, vy, u.z * vh, 0, 0, 0, -1, 'shot', clamp(order.power, 0.2, 0.6));
  L.style = 'chip';
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
