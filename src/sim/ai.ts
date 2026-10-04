import { clamp, dist2, pointSegDist } from '../core/math';
import { interceptRisk, laneRisk, passSpeed, shotBlockers, shotQuality, THROUGH_MAX_INTERCEPT, throughSpeed } from './actions';
import { headerAtGoal, throughLead } from './actions';
import { ACCEL, BOX_DEPTH, BOX_W, DDA_PRESS, GOAL_W, HALF_L, HALF_W, TEMPO, WALL_DIST } from './constants';
import { readsHuman, takeOnVsHuman, vsHuman } from './dribble';
import { DUEL_TACKLE, startTell, telegraphs, tellReady, TELL_DUEL, TELL_PRESS, TELL_REACH, TOLD_TACKLE } from './skills';
import { clearOfPenalty, freeKickWall, inOwnBox, isDirectFreeKick, updateKeeper } from './keeper';
import { FIRST_MATCH_PRESS, type Match } from './match';
import type { Player } from './player';
import type { Side, TeamStyle } from './types';

/**
 * Team brain. Roles are re-assigned ~8x a second; each player then acts on its role every tick.
 *
 * Round 13 (the owner: "everybody just chasing the ball ... back and forth like children in primary"): real shape.
 * Out of possession at most two men engage the ball: the presser jockeys goal-side and only commits now and then,
 * the cover takes the carrier's most dangerous passing lane rather than a man (a high-pressing side sends a third,
 * the trap, in the other half). Everyone else holds a zonal block built from his formation slot: a back line that
 * steps up and drops as a unit, a midfield bank in front of it and the forwards ahead, the whole block sliding
 * across with the ball (BLOCK_SLIDE of its z) and kept clear of the ball (ENGAGE_R) unless it's in our box.
 * In possession: a support triangle around the carrier (a short option either side, one ahead), runners in
 * behind timed on the last line, full-backs overlapping on their own flank, width from the wide men and box runs
 * when the ball is out wide; nobody else crowds the carrier (ATTACK_SPACE). The carrier weighs every option by a
 * simple expected-threat model (see `threat`) with difficulty-scaled noise. How high the block sits, how hard it
 * presses and how the ball is moved on all come from the club's style (TeamDef.style, STYLES).
 */
export interface TeamBrain {
  think: number;
  chaser: number;
  presser: number;
  cover: number;
  /** A high-pressing side's third man in the other half: he cuts off the carrier's escape (-1: none). */
  trap: number;
  /** The presser holds a screen in front of the block instead of engaging (the carrier is beyond the style's press zone). */
  screen: boolean;
  /**
   * The human's carrier being watched for standing on the ball (humanStalling): his index (-1: none), the furthest
   * he has got up the pitch (m, his attacking direction) and the match clock when he last gained ground.
   */
  stallBy: number;
  stallBest: number;
  stallSince: number;
  supporter: number;
  supportX: number;
  supportZ: number;
  supportT: number;
  supporter2: number;
  support2X: number;
  support2Z: number;
  /** The support triangle's man ahead of the carrier. */
  supporter3: number;
  support3X: number;
  support3Z: number;
  marks: Map<number, number>; // our player idx -> opponent idx
  overlap: number;
  overlapT: number;
  /** Our back line in our own normalised frame (-1 = our goal line). */
  line: number;
  /**
   * 0 (our defending shape) .. 1 (our attacking shape), eased after a turnover (SHAPE_WIN / SHAPE_LOSE s) so the men
   * who aren't engaging move into the new shape rather than all turning and sprinting the other way at once.
   */
  att: number;
  /** Box-attacking assignments while the ball is out wide: player idx -> world point. */
  boxZones: Map<number, { x: number; z: number }>;
  /** Set-piece positions, computed once per restart (`spFor`). */
  spFor: object | null;
  spTaker: number;
  spTargets: Map<number, { x: number; z: number }>;
  /** Attacking set piece: players meant to attack the delivery, in delivery-zone order. */
  spRunners: number[];
  /** Corner runners: the zone each one attacks once the ball is struck (near post, far post, ...). */
  spZones: Map<number, { x: number; z: number }>;
  /** Defending a direct free kick: the players in the wall, near-post end first. */
  spWall: number[];
  /** Defending a corner: the zonal men and the spot on the 5.5 m line each one holds while it comes in. */
  spZonal: Map<number, { x: number; z: number }>;
}

export function makeBrain(): TeamBrain {
  return {
    think: 0, chaser: -1, presser: -1, cover: -1, trap: -1, screen: false, stallBy: -1, stallBest: 0, stallSince: 0,
    supporter: -1, supportX: 0, supportZ: 0, supportT: 0,
    supporter2: -1, support2X: 0, support2Z: 0,
    supporter3: -1, support3X: 0, support3Z: 0,
    marks: new Map(), overlap: -1, overlapT: 0, line: -0.5, att: 0, boxZones: new Map(),
    spFor: null, spTaker: -1, spTargets: new Map(), spRunners: [], spZones: new Map(), spWall: [], spZonal: new Map(),
  };
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

// ------------------------------------------------------------------ team styles

/**
 * How a style plays (TeamDef.style; undefined is 'balanced'). Lines are in the side's normalised frame (-1 its own
 * goal line, +1 theirs; 0.1 is 4.8 m).
 */
export interface StyleParams {
  /** Added to the back line's height, and the highest it may step up to. */
  line: number;
  lineMax: number;
  /** The midfield bank sits this far (least, most) in front of the back line out of possession. */
  midMin: number;
  midMax: number;
  /** The forwards sit this far in front of the midfield bank, at most (they may stay further up). */
  fwdGap: number;
  /** The block's width out of possession (times the slot's). */
  defWidth: number;
  /** The presser engages only while the carrier is behind this (our frame); further up he screens in front of the block. */
  pressFrom: number;
  /** His commit rate, and times this again with the carrier in his own half. */
  pressRate: number;
  pressHigh: number;
  /** A third man (the trap) engages while the carrier is in his own half. */
  trap: boolean;
  /** In possession: weight on what a lost pass costs (risk aversion), and on its length past LONG_PASS_D. */
  safe: number;
  longCost: number;
  /** Extra value on a ball forward (times its threat, per 15 m gained). */
  forward: number;
  /** The carrier's hold before he moves it on (times). */
  hold: number;
  /** A shot's score (times; patient sides wait for a better one). */
  shoot: number;
  /** A clearance / long ball out of our half is worth this much more. */
  direct: number;
  /** For this long (s) after a regain the side breaks: runs in behind at once, forward balls worth more still. */
  counter: number;
  /** Runs in behind (times the chance), and the in-possession width (times). */
  runs: number;
  width: number;
}

export const STYLES: Record<TeamStyle, StyleParams> = {
  balanced: {
    line: 0, lineMax: -0.12, midMin: 0.14, midMax: 0.34, fwdGap: 0.34, defWidth: 1, pressFrom: 1, pressRate: 1, pressHigh: 1, trap: false,
    safe: 1, longCost: 0, forward: 0, hold: 1, shoot: 1, direct: 0, counter: 0, runs: 1, width: 1,
  },
  // Line 8 m higher, the forwards on their back line, a third man in their half, quick regains.
  'high-press': {
    line: 0.167, lineMax: 0.06, midMin: 0.14, midMax: 0.3, fwdGap: 0.36, defWidth: 0.95, pressFrom: 1, pressRate: 1.3, pressHigh: 2.6, trap: true,
    safe: 1, longCost: 0, forward: 0.15, hold: 0.9, shoot: 1.05, direct: 0, counter: 1.5, runs: 1.15, width: 1,
  },
  // A low block: two banks of four or five inside our own third, one man up; cleared long, then a counter.
  'park-bus': {
    line: -0.1, lineMax: -0.56, midMin: 0.19, midMax: 0.21, fwdGap: 0.28, defWidth: 0.85, pressFrom: -0.04, pressRate: 1.3, pressHigh: 1, trap: false,
    safe: 1.2, longCost: 0, forward: 0.2, hold: 0.9, shoot: 1, direct: 0.006, counter: 3.5, runs: 1.1, width: 0.9,
  },
  // Short passes, patient, no risky balls: more of the ball.
  possession: {
    line: 0.04, lineMax: -0.08, midMin: 0.14, midMax: 0.3, fwdGap: 0.32, defWidth: 1, pressFrom: 1, pressRate: 1.1, pressHigh: 1.1, trap: false,
    safe: 2.1, longCost: 0.006, forward: -0.15, hold: 1.6, shoot: 0.6, direct: 0, counter: 0, runs: 0.6, width: 1.08,
  },
  // A mid-block that breaks at pace: forward balls and sprints the moment it's won.
  counter: {
    line: -0.06, lineMax: -0.36, midMin: 0.16, midMax: 0.24, fwdGap: 0.3, defWidth: 0.9, pressFrom: 0.05, pressRate: 1, pressHigh: 1, trap: false,
    safe: 0.85, longCost: 0, forward: 0.45, hold: 0.7, shoot: 1.2, direct: 0.006, counter: 4, runs: 1.35, width: 0.95,
  },
};

/** The style `side` plays. */
export function styleOf(m: Match, side: Side): StyleParams {
  return STYLES[m.teams[side].style ?? 'balanced'] ?? STYLES.balanced;
}

/** A pass longer than this (m) costs a possession side StyleParams.longCost a metre. */
const LONG_PASS_D = 20;

/**
 * How long (s) a player takes to read a ball and set off for it: AI_REACT for everyone, except that an AI opponent
 * reads the HUMAN's ground pass late, like a real defender watching a man pass (HUMAN_BALL_REACT), and can't cut it
 * out by a stretch: he has to be on its line HUMAN_BALL_SET s before it gets there. (Round 12, the critic: a marker
 * 3.5 m short of the owner's winger and 2.5-3.5 m off the lane of a 27 m/s ball played at 48-60 degrees cut it out
 * 56% of the time from a 0.12 s reaction, while the human receiver was handicapped 0.25 s more in assignRoles.)
 * Human-only: an AI's own balls, and every AI v AI ball, read as before.
 */
const AI_REACT = 0.12;
export const HUMAN_BALL_REACT = 0.32;
const HUMAN_BALL_SET = 0.1;
export function readDelay(m: Match, p: Player): number {
  return m.humanBallInFlight() && p.side !== m.kickSide ? HUMAN_BALL_REACT : AI_REACT;
}

/** Where the ball can be reached soonest by `p`, from the match's predicted ball path. */
export function intercept(m: Match, p: Player): { x: number; z: number; t: number } {
  const path = m.ballPath;
  const top = p.top * 0.92;
  const react = readDelay(m, p);
  const set = react > AI_REACT ? HUMAN_BALL_SET : 0;
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    if (s.y > (p.isKeeper ? 2.6 : 2.1)) continue;
    const d = Math.max(0, dist2(p.pos.x, p.pos.z, s.x, s.z) - 0.55);
    const need = d / top + react + set;
    if (need <= s.t) return { x: s.x, z: s.z, t: s.t };
  }
  const last = path[path.length - 1];
  const d = dist2(p.pos.x, p.pos.z, last.x, last.z);
  return { x: last.x, z: last.z, t: Math.max(last.t, d / top) };
}

/**
 * Where the human side's man meets a ground pass played to him (Match.receivePoint): the first point of the
 * ball's path he can reach `early` s before the ball does, so he's set on its line and square to it as it
 * comes. (intercept, the earliest point he can just reach, slid towards him every frame and ran him head-on
 * into a ball arriving at 17-20 m/s: the meeting was a collision at 20+ m/s relative, his foot missed the
 * control window and the ball rolled on into touch: the owner's winger who "struggles to or doesn't at all
 * receive the ball".) Null when no point gives him that time.
 */
export function meetSpot(m: Match, p: Player, early: number): { x: number; z: number; t: number } | null {
  const path = m.ballPath;
  const top = p.top * 0.92;
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    if (s.y > 2.1) continue;
    const d = Math.max(0, dist2(p.pos.x, p.pos.z, s.x, s.z) - 0.55);
    if (d / top + 0.12 + early <= s.t) return { x: s.x, z: s.z, t: s.t };
  }
  return null;
}

/** The controls moveTo sets: the move vector, the sprint, the facing (null: along his run). */
export interface MoveIntent {
  wantX: number;
  wantZ: number;
  sprint: boolean;
  face: number | null;
}

function moveIntent(p: Player, x: number, z: number, urgency: number, faceBall?: { x: number; z: number }): MoveIntent {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  const r: MoveIntent = { wantX: 0, wantZ: 0, sprint: false, face: null };
  if (d >= 0.35) {
    const f = Math.min(1, d / 2.2);
    r.wantX = (dx / d) * f;
    r.wantZ = (dz / d) * f;
    r.sprint = urgency > 0.7 || d > 9 + (1 - urgency) * 8;
  }
  if (faceBall && d < 2.5) r.face = Math.atan2(faceBall.z - p.pos.z, faceBall.x - p.pos.x);
  return r;
}

function moveTo(p: Player, x: number, z: number, urgency: number, faceBall?: { x: number; z: number }): void {
  const r = moveIntent(p, x, z, urgency, faceBall);
  p.wantX = r.wantX;
  p.wantZ = r.wantZ;
  p.sprint = r.sprint;
  p.faceTarget = r.face;
}

/**
 * Rough value of `side` having the ball at (x, z): a steep progress term plus the chance of
 * scoring from there. Midfield ~0.04, final third ~0.1, edge of the box ~0.25, six-yard box ~0.5.
 */
export function threat(m: Match, side: Side, x: number, z: number): number {
  const ad = m.attackDir(side);
  const u = clamp(((x * ad) / HALF_L + 1) / 2, 0, 1);
  return 0.01 + 0.2 * Math.pow(u, 2.5) + 0.5 * shotQuality(x, z, ad);
}

function nearestOpp(m: Match, side: Side, x: number, z: number): { d: number; o: Player | null } {
  let d = Infinity;
  let o: Player | null = null;
  for (const q of m.players) {
    if (q.side === side || q.sentOff) continue;
    const e = dist2(q.pos.x, q.pos.z, x, z);
    if (e < d) {
      d = e;
      o = q;
    }
  }
  return { d, o };
}

const slotOf = (m: Match, p: Player) => m.slots[p.side][p.slot];
const isWide = (m: Match, p: Player) => Math.abs(slotOf(m, p).z) >= 0.5;
/** Normalised own-frame x: -1 our goal line, +1 theirs. */
const nX = (m: Match, side: Side, x: number) => (x * m.attackDir(side)) / HALF_L;

/**
 * Does the AI on the ball read teammate `t` as offside? It judges the line by eye: clear cases are
 * never wrong, marginal ones sometimes are (less often for better sides).
 */
export function looksOffside(m: Match, t: Player): boolean {
  if (!m.offside) return false;
  if (!m.inOffsidePosition(t, -1.2)) return false;
  if (m.inOffsidePosition(t, 1.6)) return true;
  const err = m.rng.gauss() * clamp(1 - m.aiSkill(t.side) * 0.1, 0.4, 1);
  return m.inOffsidePosition(t, err - 0.05);
}

/** Formation position given the reference ball point, in world space (used for set pieces). */
export function shapeTarget(m: Match, p: Player, attacking: boolean, refX: number, refZ: number): { x: number; z: number } {
  const ad = m.attackDir(p.side);
  const slot = slotOf(m, p);
  const bx = (refX * ad) / HALF_L;
  const bz = (refZ * ad) / HALF_W;
  let x: number;
  let z: number;
  const ment = m.mentality[p.side];
  if (attacking) {
    x = slot.x * 0.74 + bx * 0.5 + 0.3 + ment * (p.role === 'DF' ? 0.05 : 0.08);
    z = slot.z * 1.1 + bz * 0.2;
    if (p.role === 'DF') x = Math.min(x, 0.32 + ment * 0.1);
  } else {
    x = slot.x * 0.66 + bx * 0.46 - 0.14;
    z = slot.z * 0.7 + bz * 0.36;
    if (p.role === 'DF') x = Math.min(x, bx - 0.04);
    if (p.role === 'FW') x = Math.max(x, -0.12);
  }
  if (attacking && p.role !== 'DF') {
    const line = m.defLine(other(p.side));
    x = Math.min(x, line - 0.02);
  }
  x = clamp(x, -0.9, 0.93);
  z = clamp(z, -0.93, 0.93);
  return { x: x * HALF_L * ad, z: z * HALF_W * ad };
}

/**
 * Defensive block position: a back line (brain.line, the unit that steps up and drops), a midfield bank in front of
 * it (the style's midMin..midMax ahead, half-way to the ball) and the forwards ahead of that, each from his slot, the
 * whole block sliding across with the ball (BLOCK_SLIDE of its z) and squeezed to the style's defWidth.
 */
function defendHome(m: Match, p: Player, brain: TeamBrain, refX: number, refZ: number): { x: number; z: number } {
  const ad = m.attackDir(p.side);
  const slot = slotOf(m, p);
  const st = styleOf(m, p.side);
  const bx = (refX * ad) / HALF_L;
  const bz = (refZ * ad) / HALF_W;
  const w = st.defWidth;
  let x: number;
  let z: number;
  // A screen between the back line and the ball, leaving room in front of it.
  const screen = brain.line + clamp((bx - brain.line) * 0.5, st.midMin, st.midMax);
  if (p.role === 'DF') {
    x = brain.line + (Math.abs(slot.z) >= 0.5 ? 0.015 : 0);
    z = slot.z * 0.64 * w + bz * BLOCK_SLIDE * 0.8;
  } else if (p.role === 'MF') {
    x = Math.min(screen + (slot.x + 0.3) * 0.25, bx - 0.06);
    z = slot.z * 0.68 * w + bz * BLOCK_SLIDE;
  } else {
    x = Math.max(-0.14, slot.x * 0.5 + bx * 0.45 + 0.04 + m.mentality[p.side] * 0.06);
    // (No further ahead of the midfield bank than the style's fwdGap, unless the ball is up there with them.)
    x = Math.min(x, Math.max(screen + st.fwdGap, bx - 0.1));
    if (st.trap) x = Math.max(x, Math.min(bx - 0.12, 0.45));
    z = slot.z * 0.75 * w + bz * BLOCK_SLIDE * 0.75;
  }
  x = clamp(x, -0.9, 0.6);
  z = clamp(z, -0.9, 0.9);
  return { x: x * HALF_L * ad, z: z * HALF_W * ad };
}

/** Out of possession the block slides across this share of the ball's z (the midfield bank; the back line 0.8 of it). */
const BLOCK_SLIDE = 0.42;
/**
 * Nobody but the presser, the cover (and a high press's trap) comes nearer the ball than this (m) out of possession,
 * unless it's within ENGAGE_BOX m of our goal (then the box is defended man for man); in possession nobody but the
 * support triangle, a runner, an overlap or a box run comes nearer the carrier than ATTACK_SPACE.
 */
const ENGAGE_R = 7.5;
const ENGAGE_R_HUMAN = 5.5;
const ENGAGE_BOX = 24;
const ATTACK_SPACE = 8.5;

/**
 * Keep a target point at least `r` m from the ball: pushed straight out from it, and (defending) round towards our
 * own goal, so a man who isn't engaging drops off goal-side rather than stepping in.
 */
function keepOff(m: Match, p: Player, x: number, z: number, r: number, goalSide: boolean, ref: { x: number; z: number } = m.ball.pos): { x: number; z: number } {
  const b = ref;
  let dx = x - b.x;
  let dz = z - b.z;
  const d = Math.hypot(dx, dz);
  if (d >= r) return { x, z };
  if (goalSide) {
    const gx = -m.attackDir(p.side) * HALF_L;
    const gl = Math.hypot(gx - b.x, b.z) || 1;
    const k = clamp(1 - d / r, 0, 1);
    dx = dx + ((gx - b.x) / gl) * k * r;
    dz = dz + (-b.z / gl) * k * r;
  }
  const l = Math.hypot(dx, dz);
  if (l < 1e-3) return { x, z };
  return { x: clamp(b.x + (dx / l) * r, -HALF_L + 1, HALF_L - 1), z: clamp(b.z + (dz / l) * r, -HALF_W + 1, HALF_W - 1) };
}

// ------------------------------------------------------------------ role assignment

function assignRoles(m: Match, side: Side, brain: TeamBrain): void {
  const team = m.teamPlayers(side);
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  brain.chaser = -1;
  brain.presser = -1;
  brain.cover = -1;
  brain.trap = -1;
  brain.screen = false;
  brain.marks.clear();
  // The line steps up with the ball but sits off it, drops to around the penalty spot as the
  // ball comes towards the box, and tracks it inside once it's right on top of it. (Deeper than a
  // no-offside line: with the law on, the space in behind is what attackers have to earn.)
  const bxN = nX(m, side, ball.pos.x);
  const st = styleOf(m, side);
  brain.line = bxN < -0.72 ? Math.max(-0.88, bxN - 0.1) : clamp(bxN - 0.5 + st.line, -0.82, st.lineMax);
  // Mentality: attacking sides hold a higher line, defensive ones sit deeper.
  const ment = m.mentality[side];
  if (ment !== 0 && bxN >= -0.7) brain.line = clamp(brain.line + ment * 0.08, -0.86, Math.max(st.lineMax + 0.14, -0.5));
  if (owner && ball.held) return;
  const flight = !owner && m.passTarget >= 0 ? m.players[m.passTarget] : null;

  if (!owner) {
    if (flight && flight.side === side) return; // our receiver goes to meet it
    // The human's ball has just left his foot: nobody of ours has read it yet (readDelay); the marks hold.
    const humanBall = m.humanBallInFlight() && m.kickSide !== side;
    if (humanBall && m.sinceKick < HUMAN_BALL_REACT) {
      if (flight) assignMarks(m, side, brain, flight);
      return;
    }
    let bestT = Infinity;
    for (const p of team) {
      if (p.isKeeper || p.state !== 'move' || p.sentOff) continue;
      const t = intercept(m, p).t + (m.isHumanControlled(p) ? 0.25 : 0);
      if (t < bestT) {
        bestT = t;
        brain.chaser = p.idx;
      }
    }
    if (flight) {
      // Their pass is on its way: only go for it if we get there first, else close the receiver.
      // A corner / wide free kick into our box: about half the time a defender attacks it whenever
      // he can get there as soon as the runner (`spContest` is drawn per delivery).
      const contest = m.setPieceKick === m.kickId && m.kickSide !== side && m.spContest ? 0.1 : 0;
      if (bestT > intercept(m, flight).t - 0.05 + contest) {
        brain.chaser = -1;
        // (The human's ball, and we aren't clearly first to it: nobody runs at it. The presser jockeys the man
        // it's for around the BALL, which sent the owner's winger's marker straight down the lane at it; his man
        // is closed down once he has it. The marks hold their side of him: markSpot.)
        if (!humanBall) pickPresser(m, side, brain, flight);
      }
      assignMarks(m, side, brain, flight);
    }
    return;
  }
  if (owner.side !== side) {
    pickPresser(m, side, brain, owner);
    assignMarks(m, side, brain, owner);
  }
}

function pickPresser(m: Match, side: Side, brain: TeamBrain, c: Player): void {
  const ad = m.attackDir(side);
  const cN = nX(m, side, c.pos.x);
  const ranked: { p: Player; s: number }[] = [];
  for (const p of m.teamPlayers(side)) {
    if (p.isKeeper || p.state === 'fallen' || p.sentOff) continue;
    let s = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
    if ((c.pos.x - p.pos.x) * ad <= 0) s += 3; // not goal-side
    if (p.role === 'DF' && cN > brain.line + 0.42) s += 7; // don't break the line to press in midfield
    if (p.role === 'FW' && cN < -0.45) s += 5; // strikers don't track into our box
    if (p.state !== 'move') s += 4;
    ranked.push({ p, s });
  }
  ranked.sort((a, b) => a.s - b.s);
  const human = ranked.find((r) => m.isHumanControlled(r.p));
  const first = ranked[0];
  if (!first) return;
  const st = styleOf(m, side);
  // Beyond the style's press zone (a low block, a mid-block) the presser holds a screen in front of the block and
  // nobody else steps out of it. Not for ever: the human's man standing on it there (no ground gained for STALL_S)
  // is closed down, the presser in and the cover with him, as against a carrier inside the zone.
  brain.screen = cN > st.pressFrom && !inOwnBox(m, side, c.pos.x, c.pos.z) && !humanStalling(m, brain, c);
  let engaged: Player | null;
  if (human && human.s < first.s + 4) {
    // The human is on it; the nearest AI teammate covers.
    engaged = human.p;
    const next = ranked.find((r) => r.p !== human.p);
    if (next && next.s < 18 && !brain.screen) brain.cover = next.p.idx;
  } else {
    engaged = first.p;
    brain.presser = first.p.idx;
    const next = ranked.find((r) => r.p !== first.p && !m.isHumanControlled(r.p));
    if (next && next.s < 18 && !brain.screen) brain.cover = next.p.idx;
  }
  // A high press in their half: a third man closes the carrier's way out (the human's man, only in his own third).
  if (st.trap && !brain.screen && cN > (m.isHumanControlled(c) ? TRAP_FROM_HUMAN : TRAP_FROM)) {
    const t = ranked.find((r) => r.p !== engaged && r.p.idx !== brain.cover && !m.isHumanControlled(r.p) && r.p.role !== 'DF');
    if (t && t.s < 22) brain.trap = t.p.idx;
  }
}

/**
 * The human's carrier hasn't gained STALL_GAIN m up the pitch in STALL_S s of the match clock (standing on the ball,
 * or shuffling it about, to run the clock down where a low block won't come for him). Only the human's man: an AI
 * carrier moves it on by himself. A new carrier, or ground gained, starts the count again.
 */
function humanStalling(m: Match, brain: TeamBrain, c: Player): boolean {
  if (!m.isHumanControlled(c) || m.ball.owner !== c.idx) {
    brain.stallBy = -1;
    return false;
  }
  const fwd = c.pos.x * m.attackDir(c.side);
  if (brain.stallBy !== c.idx || fwd > brain.stallBest + STALL_GAIN || m.clock < brain.stallSince) {
    brain.stallBy = c.idx;
    brain.stallBest = fwd;
    brain.stallSince = m.clock;
    return false;
  }
  return m.clock - brain.stallSince >= STALL_S;
}
export const STALL_S = 3;
const STALL_GAIN = 2;

/** A high press's trap engages while the carrier is this far up (our frame: 0 is halfway, so in his own half; the human's, his own third). */
const TRAP_FROM = 0;
const TRAP_FROM_HUMAN = 0.33;
/** How much of a style's extra press (pressRate x pressHigh over 1) it brings against the human's carrier. */
const STYLE_VS_HUMAN = 0.4;

/** Zonal marking: each defender / midfielder takes the most dangerous opponent near their zone. */
function assignMarks(m: Match, side: Side, brain: TeamBrain, c: Player): void {
  const ad = m.attackDir(side);
  const gx = -ad * HALF_L;
  const ball = m.ball;
  const opps = m.teamPlayers(other(side)).filter((o) => !o.isKeeper && o !== c && !o.sentOff);
  const taken = new Set<number>();
  const order = m
    .teamPlayers(side)
    .filter((p) => !p.isKeeper && !p.sentOff && p.role !== 'FW' && p.idx !== brain.presser && p.idx !== brain.cover && p.idx !== brain.trap)
    .sort((a, b) => (a.role === 'DF' ? 0 : 1) - (b.role === 'DF' ? 0 : 1));
  for (const p of order) {
    const home = defendHome(m, p, brain, ball.pos.x, ball.pos.z);
    let best = -1;
    let bestS = p.role === 'DF' ? 11 : 8.5;
    for (const o of opps) {
      if (taken.has(o.idx)) continue;
      const dz = dist2(home.x, home.z, o.pos.x, o.pos.z);
      const danger = dist2(o.pos.x, o.pos.z, gx, 0) / 40;
      const s = dz + danger * 4;
      if (s < bestS) {
        bestS = s;
        best = o.idx;
      }
    }
    if (best >= 0) {
      taken.add(best);
      brain.marks.set(p.idx, best);
    }
  }
}

// ------------------------------------------------------------------ per-tick update

export function updateTeamAI(m: Match, side: Side, dt: number): void {
  const brain = m.brains[side];
  brain.think -= dt;
  if (brain.think <= 0) {
    assignRoles(m, side, brain);
    brain.think = 0.12 / TEMPO;
  }
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  const flight = m.passTarget >= 0 && !owner ? m.players[m.passTarget] : null;
  const focus = owner ?? flight;
  const weHave = focus ? focus.side === side : false;
  const theyHave = focus ? focus.side !== side : false;
  const live = m.phase === 'play';
  const want = weHave ? 1 : theyHave ? 0 : m.possessionSide === side ? 1 : 0;
  brain.att = live ? clamp(want, brain.att - dt / SHAPE_LOSE, brain.att + dt / SHAPE_WIN) : want;

  if (live && weHave && focus) organiseAttack(m, side, focus, brain, dt);
  else {
    brain.boxZones.clear();
    brain.overlap = -1;
    brain.supporter = -1;
    brain.supporter2 = -1;
    brain.supporter3 = -1;
  }

  for (const p of m.teamPlayers(side)) {
    if (p.sentOff) continue; // parked by the dugout (see Match.parkSentOff)
    if (p.isKeeper) {
      if (!m.isHumanControlled(p) || p.state === 'hold') updateKeeper(m, p, dt);
      continue;
    }
    if (m.isHumanControlled(p)) continue;
    if (brain.presser !== p.idx) p.jockeyT = 0;
    if (p.state !== 'move') {
      p.wantX = p.wantZ = 0;
      continue;
    }
    updateRun(m, p, weHave && live, owner, dt);

    if (!live) {
      restartPosition(m, p, side);
      continue;
    }
    if (owner === p) {
      carrierAI(m, p, dt);
      continue;
    }
    if (flight === p || (!owner && brain.chaser === p.idx)) {
      const i = intercept(m, p);
      moveTo(p, i.x, i.z, 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }
    const run = !owner ? setPieceRun(m, p) ?? setPieceZonal(m, p) : null;
    if (run) {
      moveTo(p, run.x, run.z, 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }
    if (theyHave && focus) {
      defend(m, p, brain, focus, dt);
      continue;
    }
    // The man the human's PASS / THROUGH press has locked onto makes his move before the ball comes.
    const called = owner && m.human[side] && m.ctl[side].calledRun === p.idx ? calledSpot(m, p, owner) : null;
    if (called) {
      moveTo(p, called.x, called.z, 1, ball.pos);
      continue;
    }
    if (weHave && focus) {
      const t = attackTarget(m, p, brain, focus);
      const b = t.shape ? blendShape(m, p, brain, t.x, t.z, true) : t;
      moveTo(p, b.x, b.z, t.u, ball.pos);
      continue;
    }
    // One of our shots just saved or blocked: the men up there follow it in for the rebound.
    if (m.shotSide === side && m.shotClock < FOLLOW_IN_T && p.role !== 'DF' && !setPieceShot(m) && dist2(p.pos.x, p.pos.z, m.attackDir(side) * HALF_L, 0) < 24) {
      const ad = m.attackDir(side);
      moveTo(p, ad * (HALF_L - 6.5), clamp(ball.pos.z * 0.5, -5, 5), 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }
    // Loose ball: hold the shape of whoever had it last (the chaser goes for it; nobody else crowds it).
    if (m.possessionSide === side) {
      const t = attackTarget(m, p, brain, p);
      const b = t.shape ? zonalSpot(m, p, ...xz(blendShape(m, p, brain, t.x, t.z, true))) : t;
      moveTo(p, b.x, b.z, 0.45, ball.pos);
    } else {
      const home = defendHome(m, p, brain, ball.pos.x, ball.pos.z);
      const b = zonalSpot(m, p, ...xz(blendShape(m, p, brain, home.x, home.z, false)));
      moveTo(p, b.x, b.z, 0.55, ball.pos);
    }
  }
}

/** Easing of TeamBrain.att: seconds to go from the defending to the attacking shape, and back. */
const SHAPE_WIN = 1.1;
const SHAPE_LOSE = 0.7;

/**
 * A man holding his place in the shape, while the team is still moving between its two shapes (TeamBrain.att): his
 * target in this phase's shape (`attacking`: the attacking one) blended with the other one by how far the team has got.
 */
function blendShape(m: Match, p: Player, brain: TeamBrain, x: number, z: number, attacking: boolean): { x: number; z: number } {
  const k = attacking ? brain.att : 1 - brain.att;
  if (k >= 0.999) return { x, z };
  const o = attacking ? zonalSpot(m, p, ...xz(defendHome(m, p, brain, m.ball.pos.x, m.ball.pos.z))) : attackTarget(m, p, brain, p);
  return { x: o.x + (x - o.x) * k, z: o.z + (z - o.z) * k };
}
const xz = (q: { x: number; z: number }): [number, number] => [q.x, q.z];

// ------------------------------------------------------------------ attacking organisation

function organiseAttack(m: Match, side: Side, c: Player, brain: TeamBrain, dt: number): void {
  const ad = m.attackDir(side);
  const gx = ad * HALF_L;
  const b = m.ball.pos;
  const team = m.teamPlayers(side);
  const cN = nX(m, side, c.pos.x);
  const free = (p: Player) => !p.isKeeper && !p.sentOff && p !== c && p.state === 'move' && !m.isHumanControlled(p);
  // The human's man on it: his teammates move sooner and more (humanFlow).
  const hum = humanFlow(m, side, c);

  // ---- Box runs when the ball is out wide in the final third (or a cross is in the air).
  brain.boxZones.clear();
  const wideFinal = Math.abs(c.pos.z) > HALF_W * (hum ? HUMAN_WIDE : 0.36) && cN > (hum ? HUMAN_WIDE_FINAL : 0.4);
  const crossing = m.ball.owner < 0 && b.y > 0.8 && nX(m, side, b.x) > 0.45;
  if (wideFinal || crossing) {
    const s0 = Math.sign(crossing ? b.z : c.pos.z) || 1;
    const zones = [
      { x: gx - ad * 5.5, z: s0 * 2.2 }, // near post
      { x: gx - ad * 6.5, z: -s0 * 3 }, // far post
      { x: gx - ad * 10.5, z: -s0 * 0.8 }, // penalty spot
      { x: gx - ad * 16.5, z: s0 * 4 }, // edge of the box for cut-backs and knock-downs
    ];
    const used = new Set<number>();
    for (const z of zones) {
      let best: Player | null = null;
      let bd = hum ? HUMAN_BOX_REACH : 30;
      for (const p of team) {
        if (!free(p) || used.has(p.idx) || p.role === 'DF') continue;
        const d = dist2(p.pos.x, p.pos.z, z.x, z.z) - (p.role === 'FW' ? 6 : 0);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        used.add(best.idx);
        brain.boxZones.set(best.idx, z);
      }
    }
  }

  // ---- Overlapping full-back on the ball's flank.
  brain.overlapT -= dt;
  if (brain.overlap >= 0 && (brain.overlapT <= 0 || cN < -0.05 || m.players[brain.overlap].state !== 'move')) brain.overlap = -1;
  if (brain.overlap < 0 && cN > 0.02 && cN < 0.75 && isWide(m, c) && c.role !== 'DF' &&
    m.rng.chance(dt * 0.4 * (1 + m.mentality[c.side] * 0.6) * (hum ? HUMAN_OVERLAP : 1))) {
    const sgn = Math.sign(slotOf(m, c).z);
    // (Only the full-back on the flank the carrier is on now: never across the pitch.)
    const onFlank = Math.sign(c.pos.z * ad) === sgn;
    for (const p of team) {
      if (!onFlank) break;
      if (!free(p) || p.role !== 'DF' || !isWide(m, p) || Math.sign(slotOf(m, p).z) !== sgn) continue;
      if (nX(m, side, p.pos.x) < cN) {
        brain.overlap = p.idx;
        brain.overlapT = 3.4;
      }
    }
  }

  // ---- The support triangle: a short option either side of the carrier (SUPPORT_SHORT m) and one ahead
  // (SUPPORT_AHEAD m), each spot the most open of a few angles, and the nearest free men sent to them.
  brain.supportT -= dt;
  if (brain.supportT > 0 && brain.supporter >= 0) return;
  brain.supportT = 0.5;
  // (The wide men give the width: a winger never comes in to make the triangle, a full-back only on his own flank.)
  const cFlank = Math.sign(c.pos.z * ad);
  const avail = team
    .filter((p) => free(p) && !brain.boxZones.has(p.idx) && brain.overlap !== p.idx && !p.running &&
      !(isWide(m, p) && (p.role !== 'DF' || Math.sign(slotOf(m, p).z) !== cFlank)))
    .map((p) => ({ p, d: dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) }))
    .sort((a, b2) => a.d - b2.d)
    .slice(0, 5)
    .map((a) => a.p);
  const base = ad > 0 ? 0 : Math.PI;
  // (Out wide the touchline side's short option is behind him, not in the stand.)
  const spotFor = (angs: number[], r: number): { x: number; z: number } => {
    let bestS = Infinity;
    let out = { x: c.pos.x, z: c.pos.z };
    for (const ang of angs) {
      const a = base + ang;
      const x = clamp(c.pos.x + Math.cos(a) * r, -HALF_L + 3, HALF_L - 4);
      const z = clamp(c.pos.z + Math.sin(a) * r, -HALF_W + 2.5, HALF_W - 2.5);
      let crowd = 0;
      for (const t of team) if (t !== c && !t.sentOff && dist2(t.pos.x, t.pos.z, x, z) < 6) crowd += 0.12;
      const open = nearestOpp(m, side, x, z).d;
      const s = laneRisk(m, side, c.pos.x, c.pos.z, x, z) * 1.3 + (open < 3 ? 0.35 : 0) + crowd - Math.cos(ang) * 0.12 +
        (dist2(c.pos.x, c.pos.z, x, z) < r * 0.7 ? 0.4 : 0);
      if (s < bestS) {
        bestS = s;
        out = { x, z };
      }
    }
    return out;
  };
  const spots = [
    spotFor([0.9, 1.3, 1.8, 2.3], SUPPORT_SHORT),
    spotFor([-0.9, -1.3, -1.8, -2.3], SUPPORT_SHORT),
    spotFor([-0.55, -0.25, 0.25, 0.55], SUPPORT_AHEAD),
  ];
  // The cheapest way to fill them (total distance) from the five nearest free men.
  let bestCost = Infinity;
  let bestPick: (Player | null)[] = [null, null, null];
  const n = avail.length;
  const cost = (p: Player | null, k: number) => (p ? dist2(p.pos.x, p.pos.z, spots[k].x, spots[k].z) : 60);
  for (let i = -1; i < n; i++) {
    for (let j = -1; j < n; j++) {
      if (j >= 0 && j === i) continue;
      for (let k = -1; k < n; k++) {
        if (k >= 0 && (k === i || k === j)) continue;
        const pick = [i >= 0 ? avail[i] : null, j >= 0 ? avail[j] : null, k >= 0 ? avail[k] : null];
        const s = cost(pick[0], 0) + cost(pick[1], 1) + cost(pick[2], 2);
        if (s < bestCost) {
          bestCost = s;
          bestPick = pick;
        }
      }
    }
  }
  brain.supporter = bestPick[0]?.idx ?? -1;
  brain.supporter2 = bestPick[1]?.idx ?? -1;
  brain.supporter3 = bestPick[2]?.idx ?? -1;
  brain.supportX = spots[0].x;
  brain.supportZ = spots[0].z;
  brain.support2X = spots[1].x;
  brain.support2Z = spots[1].z;
  brain.support3X = spots[2].x;
  brain.support3Z = spots[2].z;
}

/** The support triangle: the short options' distance from the carrier (m), and the man ahead's. */
const SUPPORT_SHORT = 12;
const SUPPORT_AHEAD = 17;

/**
 * The human's man has it (or a pass is on its way to him): his teammates move sooner and more, the Mario
 * Strikers way. Forwards make their runs in behind far more often (HUMAN_RUN_BOOST, and one always goes when
 * nobody is running); box runs start from further out (HUMAN_WIDE, HUMAN_WIDE_FINAL) and from further away
 * (HUMAN_BOX_REACH m). (Round 9 also tried busier support runs for him, spots picked more often, round where he
 * was going, with a local search and more weight on room: the open options it measured barely moved, 22% ->
 * 20-24% of his time on the ball without a clear one 8-16 m away, and a casual human's passes were cut out a
 * point or two more often; so the support spots are the AI's.)
 */
function humanFlow(m: Match, side: Side, c: Player | null): boolean {
  return m.human[side] && !!c && c.side === side && m.isHumanControlled(c);
}
/**
 * (2026-10-03, the owner: "its hard to play to score and make runs": 1.6 -> 2.2, and with fewer than HUMAN_RUNNERS men
 * already running a winger is due as well as a forward, so a through ball has someone to find; his overlaps come
 * HUMAN_OVERLAP x as often.)
 */
const HUMAN_RUN_BOOST = 2.2;
const HUMAN_RUNNERS = 2;
const HUMAN_OVERLAP = 2.5;
const HUMAN_WIDE = 0.33;
const HUMAN_WIDE_FINAL = 0.32;
const HUMAN_BOX_REACH = 45;

/**
 * The move a man makes the moment the human's PASS / THROUGH press locks onto him (Match.calledRun), before the
 * ball comes: for a pass he checks towards the ball, a few strides, and off his marker if one is on him; for a
 * through ball he starts his sprint in behind at once (along the offside line until it's played, with the law
 * on, so the run doesn't take him offside before the pass). Null for a lofted ball (its runner keeps his run).
 */
function calledSpot(m: Match, p: Player, c: Player): { x: number; z: number } | null {
  const mode = m.ctl[p.side].calledMode;
  if (mode === 'pass') {
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(CALLED_CHECK, d * 0.3);
    let x = p.pos.x + (dx / d) * step;
    let z = p.pos.z + (dz / d) * step;
    const o = nearestOpp(m, p.side, p.pos.x, p.pos.z);
    if (o.o && o.d < 4 && o.d > 0.01) {
      x += ((p.pos.x - o.o.pos.x) / o.d) * CALLED_SHAKE;
      z += ((p.pos.z - o.o.pos.z) / o.d) * CALLED_SHAKE;
    }
    return { x, z };
  }
  if (mode !== 'through') return null;
  const ad = m.attackDir(p.side);
  const pt = throughLead(m, p, CALLED_RUN, true);
  if (m.offside) {
    const lim = (Math.max(m.offsideLine(p.side), nX(m, p.side, m.ball.pos.x)) * HALF_L - 0.5) * ad;
    if ((pt.x - lim) * ad > 0) {
      // On the line: a diagonal along it (towards the middle from out wide, else away from the nearest man).
      const near = nearestOpp(m, p.side, p.pos.x, p.pos.z).o;
      const zs = Math.abs(p.pos.z) > 7 ? -Math.sign(p.pos.z) : near && near.pos.z > p.pos.z ? -1 : 1;
      return { x: (p.pos.x - lim) * ad > -1 ? lim : pt.x * 0.5 + lim * 0.5, z: clamp(p.pos.z + zs * 5, -HALF_W + 2, HALF_W - 2) };
    }
  }
  return pt;
}
/** A called pass: he checks this far (m) towards the ball, and shakes this far off a marker within 4 m. */
const CALLED_CHECK = 3;
const CALLED_SHAKE = 1.5;
/** A called through ball: his sprint is aimed this far (m) ahead of him (actions.throughLead). */
const CALLED_RUN = 9;

/** Runs in behind: only when the carrier has time and is facing forward to play the pass. */
function updateRun(m: Match, p: Player, weHave: boolean, c: Player | null, dt: number): void {
  if (p.role === 'DF') {
    p.running = false;
    return;
  }
  p.runT -= dt;
  if (!weHave) {
    p.running = false;
    return;
  }
  if (p.running) {
    if (p.runT <= 0 || nX(m, p.side, p.pos.x) > 0.88) {
      p.running = false;
      p.runT = 1.4 + m.rng.next() * 2.4;
    } else if (m.offside && c && c !== p && c.side === p.side && m.inOffsidePosition(p, 0.8)) {
      // The pass didn't come in time: check back onside and go again from the line.
      p.running = false;
      p.runT = 0.5 + m.rng.next() * 0.9;
    } else if (m.offside && !p.runCued && c && c !== p && c.side === p.side && !m.isHumanControlled(c)) {
      // Arriving on the last man at full tilt: that's the moment to play it (the carrier looks up).
      const ad = m.attackDir(p.side);
      const gap = (Math.max(m.offsideLine(p.side), nX(m, p.side, m.ball.pos.x)) - nX(m, p.side, p.pos.x)) * HALF_L;
      if (gap < 4 && gap > -0.2 && p.vel.x * ad > 5) {
        p.runCued = true;
        c.aiT = Math.min(c.aiT, 0.02);
      }
    }
    return;
  }
  if (p.runT > 0 || !c || c === p || c.side !== p.side) return;
  const ad = m.attackDir(p.side);
  const pr = nearestOpp(m, c.side, c.pos.x, c.pos.z).d;
  const facingFwd = Math.cos(c.facing) * ad > -0.2;
  const line = m.defLine(other(p.side));
  const n = nX(m, p.side, p.pos.x);
  const ment = m.mentality[p.side];
  // The human's carrier facing forward in the middle or final third: a forward always goes when nobody is
  // running, and runs come far more often (humanFlow).
  const hum = humanFlow(m, p.side, c) && nX(m, p.side, c.pos.x) > -0.33;
  const st = styleOf(m, p.side);
  const bf = breakFor(m, p.side, st);
  const breaking = bf > 0 && m.sincePossession < bf && !hum;
  const chance = (p.role === 'FW' ? 0.6 : isWide(m, p) ? 0.38 : 0.2) * (1 + ment * 0.45) * (hum ? HUMAN_RUN_BOOST : 1 + AI_INTENT_RUNS * intentVsHuman(m, p.side)) *
    st.runs * (breaking ? COUNTER_RUNS : 1);
  let runners = 0;
  if (hum) for (const t of m.teamPlayers(p.side)) if (t.running && !t.sentOff) runners++;
  const due = hum && ((p.role === 'FW' && runners === 0) || ((p.role === 'FW' || isWide(m, p)) && runners < HUMAN_RUNNERS));
  // (The roll is made either way, as it always was: a forward who's due doesn't change the rng's course.)
  if (pr > (hum ? 1.5 : 2.2) && facingFwd && n > line - 0.32 && line < 0.8 && (m.rng.chance(chance) || due)) {
    p.running = true;
    p.runCued = false;
    p.runT = 2.1 + m.rng.next() * 0.9;
  } else {
    p.runT = hum || breaking ? 0.3 + m.rng.next() * 0.6 : 0.7 + m.rng.next() * 1.8;
  }
}
/** On the break, runs in behind come this much more often (and he looks again sooner). */
const COUNTER_RUNS = 1.6;

function attackTarget(m: Match, p: Player, brain: TeamBrain, c: Player): { x: number; z: number; u: number; shape?: boolean } {
  const side = p.side;
  const ad = m.attackDir(side);
  if (p.giveGoT > 0 && p !== c) {
    let x = clamp(p.pos.x + ad * 9, -HALF_L + 3, HALF_L - 3);
    if (m.offside && m.ball.owner >= 0) {
      const limit = (Math.max(m.offsideLine(side), nX(m, side, m.ball.pos.x)) * HALF_L - 0.6) * ad;
      if ((x - limit) * ad > 0) x = limit;
    }
    return { x, z: p.pos.z * 0.9, u: 1 };
  }
  const b = m.ball.pos;
  const bx = nX(m, side, b.x);
  // With the law on, the line that matters is the offside line (second-last defender, or the ball
  // if it's further up, never inside our half); otherwise their last outfield defender.
  const line = m.offside ? Math.max(m.offsideLine(side), bx) : m.defLine(other(side));
  const owner = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
  const onBall = !!owner && owner.side === side;
  // Caught beyond the line while a teammate has it: get back onside, quickly.
  const stranded = m.offside && onBall && !p.running && m.inOffsidePosition(p, -0.2);
  const zone = brain.boxZones.get(p.idx);
  if (zone) {
    // Hold the run on the last man until the cross is struck, then attack the zone.
    let zx = zone.x;
    if (m.offside && onBall) {
      const lim = (line * HALF_L - 0.2) * ad;
      if ((zx - lim) * ad > 0) zx = lim;
    }
    return { x: zx, z: zone.z, u: stranded ? 0.95 : 0.85 };
  }
  if (brain.supporter === p.idx || brain.supporter2 === p.idx || brain.supporter3 === p.idx) {
    const k = brain.supporter === p.idx ? 1 : brain.supporter2 === p.idx ? 2 : 3;
    let sx = k === 1 ? brain.supportX : k === 2 ? brain.support2X : brain.support3X;
    const sz = k === 1 ? brain.supportZ : k === 2 ? brain.support2Z : brain.support3Z;
    if (m.offside && onBall && p.role !== 'DF' && nX(m, side, sx) > line - 0.012) sx = (line - 0.012) * HALF_L * ad;
    return { x: sx, z: sz, u: stranded ? 0.95 : 0.6 };
  }
  const slot = slotOf(m, p);
  const bz = (b.z * ad) / HALF_W;
  const wide = Math.abs(slot.z) >= 0.5;
  const ballSide = bz * slot.z > 0;
  const ment = m.mentality[side];
  let x = slot.x * 0.68 + bx * 0.52 + 0.24 + ment * 0.07;
  let z = slot.z * 1.08 + bz * 0.16;
  if (wide) z = Math.sign(slot.z) * (ballSide ? 0.9 : 0.74); // hold the width, touchline side
  if (p.role === 'DF') {
    if (wide) {
      x = Math.min(x, bx - 0.04 + ment * 0.08, 0.42 + ment * 0.12);
      z = Math.sign(slot.z) * (ballSide ? 0.8 : 0.66);
    } else {
      x = Math.min(x, bx - 0.2 + ment * 0.06, 0.12 + ment * 0.1);
      z = slot.z * 1.2 + bz * 0.12;
    }
  }
  if (wide) z *= styleOf(m, side).width;
  let u = 0.45;
  let shape = true;
  if (brain.overlap === p.idx) {
    x = Math.min(nX(m, side, c.pos.x) + 0.18, 0.86);
    z = Math.sign(slot.z) * 0.88;
    u = 0.95;
    shape = false;
  } else if (p.role !== 'DF') {
    if (p.running) {
      x = Math.min(line + 0.22, 0.9);
      z *= 0.55; // attack the channel between centre-back and full-back
      u = 0.95;
      shape = false;
    } else if (m.offside) {
      // Stay on the last man (level is onside), ready to spin in behind; if stranded, drop back.
      x = Math.min(x, line - 0.01);
      if (stranded) {
        x = Math.min(x, nX(m, side, p.pos.x) - 0.08);
        u = 0.95;
        shape = false;
      }
    } else {
      x = Math.min(x, line - 0.015);
    }
  }
  x = clamp(x, -0.9, 0.92);
  z = clamp(z, -0.92, 0.92);
  // (Holding his place in the shape: not crowding the man on the ball, or the man a pass of ours is on its way to.)
  if (shape && c.side === side && c !== p && (onBall || m.passTarget === c.idx)) {
    const k = keepOff(m, p, x * HALF_L * ad, z * HALF_W * ad, ATTACK_SPACE, false, onBall ? m.ball.pos : c.pos);
    return { x: k.x, z: k.z, u, shape };
  }
  return { x: x * HALF_L * ad, z: z * HALF_W * ad, u, shape };
}

// ------------------------------------------------------------------ defending

function defend(m: Match, p: Player, brain: TeamBrain, c: Player, dt: number): void {
  const ball = m.ball.pos;
  if (brain.presser === p.idx) {
    if (brain.screen) {
      const s = screenSpot(m, p, c);
      moveTo(p, s.x, s.z, 0.6, ball);
      return;
    }
    press(m, p, c, dt, brain);
    return;
  }
  if (brain.cover === p.idx) {
    if (m.ball.owner === c.idx) chaseSlide(m, p, c, dt);
    if (p.state !== 'move') return;
    const s = coverSpot(m, p, c);
    moveTo(p, s.x, s.z, 0.75, ball);
    return;
  }
  if (brain.trap === p.idx) {
    trap(m, p, c, dt);
    return;
  }
  const s = markSpot(m, p, brain);
  const off = zonalSpot(m, p, s.x, s.z);
  const b = blendShape(m, p, brain, off.x, off.z, false);
  moveTo(p, b.x, b.z, s.u, ball);
}

/** A man in the block who isn't engaging: kept ENGAGE_R off the ball (goal-side), unless it's near our goal. */
function zonalSpot(m: Match, p: Player, x: number, z: number): { x: number; z: number } {
  const b = m.ball.pos;
  if (dist2(b.x, b.z, -m.attackDir(p.side) * HALF_L, 0) < ENGAGE_BOX) return { x, z };
  // (Against the human's carrier the block keeps ENGAGE_R_HUMAN off: it drops a touch less deep off him.)
  const o = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
  return keepOff(m, p, x, z, o && m.isHumanControlled(o) ? ENGAGE_R_HUMAN : ENGAGE_R, true);
}

/**
 * The cover's spot: in the carrier's most dangerous passing lane (the teammate of his, level with him or nearer our
 * goal, whose ball is worth most: laneCover), COVER_LANE of the way along it (COVER_MIN..COVER_MAX m out) and a
 * little goal-side; with no such lane, goal-side of the carrier, a few metres behind the challenge.
 */
function coverSpot(m: Match, p: Player, c: Player): { x: number; z: number } {
  // (The human's carrier: the cover sits goal-side of him as before; cutting his lanes as well made the game a notch
  // harder than it was, round 13's Football Moments against the scripted bot: two-down 8/10 -> 4/10.)
  const lane = m.isHumanControlled(c) ? null : laneCover(m, p.side, c);
  if (lane) return lane;
  const gx = -m.attackDir(p.side) * HALF_L;
  const ux = gx - c.pos.x;
  const uz = -c.pos.z * 0.7;
  const ul = Math.hypot(ux, uz) || 1;
  const back = Math.min(5.5, ul * 0.5);
  return { x: c.pos.x + (ux / ul) * back + c.vel.x * 0.3, z: c.pos.z + (uz / ul) * back + c.vel.z * 0.3 };
}

export function laneCover(m: Match, side: Side, c: Player): { x: number; z: number; target: number } | null {
  const ad = m.attackDir(side);
  const gx = -ad * HALF_L;
  let best: Player | null = null;
  let bestS = 0;
  for (const t of m.teamPlayers(c.side)) {
    if (t === c || t.isKeeper || t.sentOff) continue;
    const d = dist2(c.pos.x, c.pos.z, t.pos.x, t.pos.z);
    if (d < 7 || d > 32) continue;
    // Only a ball that goes our way (or square): a back pass isn't worth leaving the carrier for.
    if ((t.pos.x - c.pos.x) * ad > 3) continue;
    const s = threat(m, c.side, t.pos.x, t.pos.z) * (1 - laneRisk(m, c.side, c.pos.x, c.pos.z, t.pos.x, t.pos.z) * 0.7);
    if (s > bestS) {
      bestS = s;
      best = t;
    }
  }
  if (!best) return null;
  const dx = best.pos.x - c.pos.x;
  const dz = best.pos.z - c.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const along = clamp(d * COVER_LANE, COVER_MIN, COVER_MAX);
  const gl = Math.hypot(gx - c.pos.x, c.pos.z) || 1;
  return {
    x: c.pos.x + (dx / d) * along + ((gx - c.pos.x) / gl) * 1.2,
    z: c.pos.z + (dz / d) * along - (c.pos.z / gl) * 1.2,
    target: best.idx,
  };
}
const COVER_LANE = 0.4;
const COVER_MIN = 5.5;
const COVER_MAX = 9;

/** The presser beyond the style's press zone: a screen ~SCREEN_D m goal-side of the carrier, no challenge. */
function screenSpot(m: Match, p: Player, c: Player): { x: number; z: number } {
  const gx = -m.attackDir(p.side) * HALF_L;
  const ux = gx - c.pos.x;
  const uz = -c.pos.z * 0.6;
  const ul = Math.hypot(ux, uz) || 1;
  return { x: c.pos.x + (ux / ul) * SCREEN_D + c.vel.x * 0.3, z: c.pos.z + (uz / ul) * SCREEN_D + c.vel.z * 0.3 };
}
const SCREEN_D = 6.5;

/**
 * The trap (a high press, the carrier in his own half): on the carrier's open side, ~TRAP_D m off him across the
 * pitch, shutting the way out and the square ball; he pokes at a touch that gets away from the carrier.
 */
function trap(m: Match, p: Player, c: Player, dt: number): void {
  const b = m.ball.pos;
  const ad = m.attackDir(p.side);
  // Across the carrier, towards the middle of the pitch (a man near the touchline is shown down the line).
  const sgn = Math.sign(-c.pos.z) || 1;
  const x = c.pos.x - ad * 1.2 + c.vel.x * 0.3;
  const z = clamp(c.pos.z + sgn * TRAP_D + c.vel.z * 0.3, -HALF_W + 1, HALF_W - 1);
  moveTo(p, x, z, 0.9, b);
  if (m.ball.owner === c.idx && p.tackleCooldown <= 0 && p.slowT <= 0 && p.tellT <= 0 && !(m.isHumanControlled(c) && c.protectT > 0) &&
    dist2(p.footX(), p.footZ(), b.x, b.z) < 0.95 && dist2(b.x, b.z, c.pos.x, c.pos.z) > 0.95) {
    m.tryTackle(p, c, (0.62 + m.aiSkill(p.side) * 0.09) * 1.1);
  }
  chaseSlide(m, p, c, dt);
}
const TRAP_D = 3.2;

/** Where a defender who isn't pressing or covering goes (and how urgently): his man, or his block position. */
function markSpot(m: Match, p: Player, brain: TeamBrain): { x: number; z: number; u: number } {
  const ad = m.attackDir(p.side);
  const gx = -ad * HALF_L;
  const ball = m.ball.pos;
  const home = defendHome(m, p, brain, ball.x, ball.z);
  const mark = brain.marks.get(p.idx);
  if (mark === undefined) return { x: home.x, z: home.z, u: 0.5 };
  const o = m.players[mark];
  if (mark === m.passTarget && m.humanBallInFlight()) {
    // The human's ball is on its way to the man he marks: he keeps his side of him (within HUMAN_BALL_MARK_R m),
    // eyes on the ball, rather than crossing its line to get goal-side as it arrives.
    const rx = p.pos.x - o.pos.x;
    const rz = p.pos.z - o.pos.z;
    const rl = Math.hypot(rx, rz) || 1;
    const keep = Math.min(rl, HUMAN_BALL_MARK_R);
    return { x: o.pos.x + (rx / rl) * keep, z: o.pos.z + (rz / rl) * keep, u: 0.5 };
  }
  // Defenders watch the ball, so they pick up a run a beat late (where he was, not where he is).
  const lag = o.running ? 0.45 : 0.15;
  const ox = o.pos.x - o.vel.x * lag;
  const oz = o.pos.z - o.vel.z * lag;
  // Goal-side of the man, shaded towards the ball.
  const ux = gx - ox;
  const uz = -oz * 0.6;
  const ul = Math.hypot(ux, uz) || 1;
  const bxv = ball.x - ox;
  const bzv = ball.z - oz;
  const bl = Math.hypot(bxv, bzv) || 1;
  // Tight when the ball is near, a yard off (and ready to intercept) when it's far away.
  const far = clamp((dist2(ox, oz, ball.x, ball.z) - 12) / 20, 0, 1);
  const tight = (p.role === 'DF' ? 1.4 : 1.9) + far * 1.2;
  const mx = ox + (ux / ul) * tight + (bxv / bl) * 0.6;
  const mz = oz + (uz / ul) * tight + (bzv / bl) * 0.6;
  const k = p.role === 'DF' ? 0.8 : 0.6;
  let tx = home.x + (mx - home.x) * k;
  const tz = home.z + (mz - home.z) * k;
  if (p.role === 'DF') {
    // Hold the line: never step out past it; drop with a runner who goes beyond it.
    const lineX = brain.line * HALF_L * ad;
    if ((tx - lineX) * ad > 0.8) tx = lineX + ad * 0.8;
  }
  const running = o.vel.x * -ad > 4;
  return { x: tx, z: tz, u: running ? 0.85 : 0.55 };
}

function press(m: Match, p: Player, c: Player, dt: number, brain: TeamBrain): void {
  const ad = m.attackDir(p.side);
  const gx = -ad * HALF_L;
  const ux = gx - c.pos.x;
  const uz = -c.pos.z * 0.8;
  const ul = Math.hypot(ux, uz) || 1;
  const d = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
  const skill = m.aiSkill(p.side);
  const b = m.ball.pos;
  const hasBall = m.ball.owner === c.idx;
  // Against the human's dribbler he jockeys more and commits less (pressVsHuman, by difficulty), and never
  // goes in during the protection window after a skill (Player.protectT).
  const vsHuman = m.isHumanControlled(c);
  const hk = vsHuman ? pressVsHuman(skill) : 1;
  const st = styleOf(m, p.side);
  const guarded = vsHuman && c.protectT > 0;
  // Jockey goal-side, then commit to a tackle now and then: more often when the ball is
  // exposed, when the carrier has their back to goal, and when a teammate is covering.
  let commit = p.commitT > 0;
  if (hasBall && d < 3.2) p.jockeyT += dt;
  if (commit) p.commitT -= dt;
  // (Winding up a telegraphed challenge, Player.tellT: skills.ts sends him in when it's up.)
  // (At the human's man from in front or beside him, a told challenge can start further out, TELL_REACH: the duel.)
  else if (hasBall && p.tackleCooldown <= 0 && !guarded && p.tellT <= 0 && (d < 2.7 || (vsHuman && d < TELL_REACH && telegraphs(m, p, c)))) {
    const exposed = dist2(b.x, b.z, c.pos.x, c.pos.z) > 0.8 ? 2.2 : 1;
    const backToGoal = Math.cos(c.facing) * ad > 0.3 ? 1.5 : 1;
    const covered = brain.cover >= 0 ? 1.3 : 0.8;
    const box = inOwnBox(m, p.side, c.pos.x, c.pos.z) ? 0.7 : 1;
    // Don't shadow forever: the longer we've jockeyed, the likelier we go in (~2.5/s after 1.2 s; against
    // the human, later and less).
    const ramp = vsHuman ? clamp((p.jockeyT - 0.9) / 0.9, 0, 1) * 2.2 * hk : clamp((p.jockeyT - 0.5) / 0.7, 0, 1) * 2.2;
    // (His very first minute: the AI shadows him at FIRST_MATCH_PRESS of its usual aggression.)
    const ease = vsHuman && m.firstMatchEase() ? FIRST_MATCH_PRESS : 1;
    // (The style's press, and against the human his dynamic difficulty: assistEase.)
    // (Against the human a style's extra press is STYLE_VS_HUMAN of what it is against the AI: a high press is felt, not a
    // mugging.)
    const styleK = st.pressRate * (nX(m, p.side, c.pos.x) > 0 ? st.pressHigh : 1);
    const style = (vsHuman ? 1 + (styleK - 1) * STYLE_VS_HUMAN : styleK) * (vsHuman ? 1 - DDA_PRESS * m.assistEase(p.side) : 1);
    const rate = ((0.3 + skill * 0.09) * exposed * backToGoal * covered * hk + ramp) * box * (1 + m.mentality[p.side] * 0.25) * ease * style;
    // At the human's man from in front of him or beside him it's telegraphed first: the SKILL counter (skills.ts). (A
    // told challenge comes TELL_PRESS x as often: the warning it gives him costs it the surprise.)
    const told = vsHuman && telegraphs(m, p, c);
    // (And taking a man on brings one most of the time: TELL_DUEL a second more while a tell may go up, eased like
    // the press for a new player.)
    const duel = told && tellReady(m, c) ? TELL_DUEL * ease * (1 - DDA_PRESS * m.assistEase(p.side)) : 0;
    // (Beyond a standing tackle's 2.7 m only the duel's own tell starts.)
    const press = d < 2.7 ? rate * (told ? TELL_PRESS : 1) : 0;
    // (No draw when nothing can start: past 2.7 m with no duel open, the dice are left alone.)
    if (press + duel > 0 && m.rng.chance((press + duel) * dt)) {
      // (Which of the two it was: the duel's share of the chance.)
      if (told) startTell(m, p, c, false, duel > 0 && m.rng.next() * (press + duel) < duel);
      else {
        p.commitT = 0.55;
        commit = true;
      }
    }
  }
  // The jockeying gap is measured from the ball so the presser's foot isn't already on it (a little more room
  // for the human's dribbler).
  // (A high press in their half stands tighter on him: HIGH_PRESS_TIGHT m less room.)
  const tight = st.pressHigh > 1 && nX(m, p.side, c.pos.x) > 0 ? HIGH_PRESS_TIGHT : 0;
  const gap = commit ? 0.1 : clamp(1.95 + (c.speed() > 5 ? 0.45 : 0) - skill * 0.06 - tight, 1.3, 2.5) +
    (vsHuman ? HUMAN_JOCKEY_ROOM + DDA_ROOM * m.assistEase(p.side) : 0);
  const jx = b.x + c.vel.x * 0.28 + (ux / ul) * gap;
  const jz = b.z + c.vel.z * 0.28 + (uz / ul) * gap;
  moveTo(p, jx, jz, 1, b);
  if (d < 3.2) p.faceTarget = Math.atan2(b.z - p.pos.z, b.x - p.pos.x);
  // (Winding up a telegraphed challenge, skills.ts, he keeps up with the man on his toes.)
  p.sprint = d > 2.6 || commit || p.tellT > 0;
  const aggression = 0.62 + skill * 0.09;
  const footD = dist2(p.footX(), p.footZ(), b.x, b.z);
  if (commit && hasBall && p.tackleCooldown <= 0 && footD < 1.15) {
    // (Going in out of a tell, skills.ts, the man ignored it: the tackle is the surer for it.)
    m.tryTackle(p, c, aggression * (p.toldT > 0 ? (p.tellDuel ? DUEL_TACKLE : TOLD_TACKLE) : 1));
    p.commitT = 0;
    p.jockeyT = 0;
  } else if (hasBall && p.tackleCooldown <= 0 && p.slowT <= 0 && footD < 0.95 && !guarded && p.tellT <= 0 && !(p.toldT > 0 && p.tellDuel) &&
    dist2(b.x, b.z, c.pos.x, c.pos.z) > (vsHuman ? HUMAN_POKE_EXPOSED : 0.95)) {
    // Poke it away when the carrier's touch takes it too far from his feet.
    m.tryTackle(p, c, aggression * 1.25);
    p.jockeyT = 0;
  }
  // Beaten, or chasing him down: go to ground.
  chaseSlide(m, p, c, dt);
}

/**
 * A defender chasing a carrier who is getting away from them (from behind or alongside, within
 * ~2.2 m) sometimes goes to ground to get a foot in: ~0.15/s at the default level. Rarely inside
 * our own box. Whether it's clean or takes the man is decided by Match.startSlide.
 */
function chaseSlide(m: Match, p: Player, c: Player, dt: number): void {
  const b = m.ball;
  if (b.owner !== c.idx || b.held || p.state !== 'move' || p.tackleCooldown > 0 || p.slowT > 0 || p.tellT > 0) return;
  const tx = p.pos.x - c.pos.x;
  const tz = p.pos.z - c.pos.z;
  const d = Math.hypot(tx, tz);
  const csp = c.speed();
  if (d < 0.9 || d > 2.6 || csp < 3) return;
  // Escaping: the carrier isn't running at us (we're behind or beside him).
  if ((c.vel.x * tx + c.vel.z * tz) / (d * csp) > 0.35) return;
  const ad = m.attackDir(p.side);
  const beaten = (c.pos.x - p.pos.x) * ad < 0.3; // he's level with us or past us, towards our goal
  let rate = SLIDE_RATE * (0.7 + m.aiSkill(p.side) * 0.15) * (beaten ? 1.2 : 0.85) * (1 + m.mentality[p.side] * 0.2);
  if (m.isHumanControlled(c) && m.firstMatchEase()) rate *= FIRST_MATCH_PRESS;
  if (inOwnBox(m, p.side, c.pos.x, c.pos.z)) rate *= 0.6;
  if (m.isHumanControlled(c)) {
    if (c.protectT > 0) return;
    rate *= pressVsHuman(m.aiSkill(p.side)) * (1 - DDA_PRESS * m.assistEase(p.side));
  }
  // Only a reckless defender slides when the carrier's body is between him and the ball.
  const bx = b.pos.x + c.vel.x * 0.18;
  const bz = b.pos.z + c.vel.z * 0.18;
  if (pointSegDist(c.pos.x, c.pos.z, p.pos.x, p.pos.z, bx, bz).d < 0.55) rate *= 0.3;
  if (!m.rng.chance(rate * dt)) return;
  // Beside the human's man (not from behind him) it's telegraphed first: he goes to ground when it's up (skills.ts).
  if (telegraphs(m, p, c)) {
    startTell(m, p, c, true);
    return;
  }
  p.facing = Math.atan2(bz - p.pos.z, bx - p.pos.x);
  m.startSlide(p);
}

/**
 * Base rate (per second) of slide attempts while chasing an escaping carrier. A defender is only in
 * that position ~12 s a match, so this lands at ~3-4 slides a match. (Round 13: 0.45 before; with the cover in the
 * passing lane more carriers get past the presser to be chased down, and slides reached 6 a match at 2x150 s.)
 */
const SLIDE_RATE = 0.42;

/**
 * How readily the AI goes in on the human's dribbler (its commit rate, its chase slides), against an AI
 * carrier, by difficulty: dribble.ts vsHuman (which also scales the tackle's success against him).
 */
export function pressVsHuman(skill: number): number {
  return vsHuman(skill).press;
}
/** Extra jockeying room (m) the presser gives the human's dribbler (and DDA_ROOM more at full dynamic difficulty)... */
const HUMAN_JOCKEY_ROOM = 0.25;
const HIGH_PRESS_TIGHT = 0.35;
const DDA_ROOM = 0.6;
/** A marker holds this close (m) to the man the human's ball is on its way to, on his own side of him (markSpot). */
const HUMAN_BALL_MARK_R = 2;
/** ... and how far (m) the ball must be off his foot before it's poked away (0.95 against the AI). */
const HUMAN_POKE_EXPOSED = 1.05;

// ------------------------------------------------------------------ move assist (the human's man)

/**
 * Move assist (Match.moveAssist): the run the AI would have the human's man making off the ball right now,
 * as the controls moveTo would set, chosen the way updateTeamAI chooses for an AI player (the loose ball if
 * he's first to it, his set-piece run or zone, pressing / covering / marking when they have it, his
 * support run or shape when we do). Movement only: no tackles, slides, volleys or orders. Null when there's
 * no run to make (he has the ball, it's dead, or he isn't on his feet).
 */
export function assistRun(m: Match, p: Player): MoveIntent | null {
  if (m.phase !== 'play' || p.state !== 'move' || p.sentOff || p.isKeeper) return null;
  const side = p.side;
  const brain = m.brains[side];
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  if (owner === p) return null;
  const flight = m.passTarget >= 0 && !owner ? m.players[m.passTarget] : null;
  const focus = owner ?? flight;
  if (flight === p || (!owner && firstToBall(m, p, flight))) {
    const i = intercept(m, p);
    return moveIntent(p, i.x, i.z, 1, ball.pos);
  }
  const run = !owner ? setPieceRun(m, p) ?? setPieceZonal(m, p) : null;
  if (run) return moveIntent(p, run.x, run.z, 1, ball.pos);
  if (focus && focus.side !== side) {
    if (!ball.held) {
      // The brain leaves the press to the human's man when he's the one for it (pickPresser): jockey
      // goal-side the way press() does, without ever committing to the tackle himself.
      if (brain.presser === p.idx || (brain.presser < 0 && brain.chaser < 0 && brain.cover !== p.idx)) {
        const ad = m.attackDir(side);
        const ux = -ad * HALF_L - focus.pos.x;
        const uz = -focus.pos.z * 0.8;
        const ul = Math.hypot(ux, uz) || 1;
        const gap = clamp(1.95 + (focus.speed() > 5 ? 0.45 : 0) - m.aiSkill(side) * 0.06, 1.6, 2.5);
        const b = ball.pos;
        const r = moveIntent(p, b.x + focus.vel.x * 0.28 + (ux / ul) * gap, b.z + focus.vel.z * 0.28 + (uz / ul) * gap, 1, b);
        const d = dist2(p.pos.x, p.pos.z, focus.pos.x, focus.pos.z);
        if (d < 3.2) r.face = Math.atan2(b.z - p.pos.z, b.x - p.pos.x);
        r.sprint = d > 2.6;
        return r;
      }
      if (brain.cover === p.idx) {
        const s = coverSpot(m, p, focus);
        return moveIntent(p, s.x, s.z, 0.75, ball.pos);
      }
    }
    const s = markSpot(m, p, brain);
    return moveIntent(p, s.x, s.z, s.u, ball.pos);
  }
  if (focus) {
    const t = attackTarget(m, p, brain, focus);
    return moveIntent(p, t.x, t.z, t.u, ball.pos);
  }
  if (m.possessionSide === side) {
    const t = attackTarget(m, p, brain, p);
    return moveIntent(p, t.x, t.z, 0.45, ball.pos);
  }
  const home = defendHome(m, p, brain, ball.pos.x, ball.pos.z);
  return moveIntent(p, home.x, home.z, 0.55, ball.pos);
}

/**
 * The loose ball is his to go for: nobody else of ours gets to it clearly sooner and, when it's a pass of
 * theirs on its way, he gets there before their man does (the brain's chaser test).
 */
function firstToBall(m: Match, p: Player, flight: Player | null): boolean {
  const mine = intercept(m, p).t;
  if (flight && mine > intercept(m, flight).t - 0.05) return false;
  for (const q of m.teamPlayers(p.side)) {
    if (q === p || q.isKeeper || q.sentOff || q.state !== 'move') continue;
    if (intercept(m, q).t < mine - 0.1) return false;
  }
  return true;
}

// ------------------------------------------------------------------ first-time actions

/** AI first-time actions for balls in the air or arriving in the box. */
function aerialOrVolley(m: Match, p: Player): void {
  if (p.order) return;
  // The wall doesn't go for a free kick struck over it (a body in the way is Match.checkWall's), and
  // nobody gets in the way of his own side's shot.
  if (m.wallKick === m.kickId && m.sinceKick < 0.9 && m.wall.includes(p.idx)) return;
  if (m.shotKick === m.kickId && m.shotSide === p.side && m.shotClock < 1.2 && m.ball.lastTouch === m.shooter) return;
  const b = m.ball;
  const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
  if (d > 3.2) return;
  const ad = m.attackDir(p.side);
  // (The player's first half-minute: the AI doesn't go for goal first time either: Match.firstMatchPatient.)
  const patient = m.human[other(p.side)] && m.firstMatchPatient();
  const q = patient ? 0 : shotQuality(p.pos.x, p.pos.z, ad);
  const ownGoalDist = dist2(p.pos.x, p.pos.z, -ad * HALF_L, 0);
  let rival = Infinity;
  for (const o of m.players) {
    if (o.side !== p.side && !o.sentOff) rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
  }
  if (b.pos.y > 1.15 && b.pos.y < 3) {
    // From a tight angle, nod it down to a better-placed teammate instead of forcing it.
    let lay: Player | null = null;
    if ((q < 0.22 || !headerAtGoal(m, p)) && ownGoalDist > 40) {
      let bestQ = q + 0.12;
      for (const t of m.teamPlayers(p.side)) {
        if (t === p || t.isKeeper || t.sentOff) continue;
        const dt = dist2(t.pos.x, t.pos.z, p.pos.x, p.pos.z);
        const tq = shotQuality(t.pos.x, t.pos.z, ad);
        if (dt > 3 && dt < 11 && tq > bestQ && nearestOpp(m, p.side, t.pos.x, t.pos.z).d > 1.8 && !m.inOffsidePosition(t)) {
          bestQ = tq;
          lay = t;
        }
      }
    }
    if (lay) {
      m.order(p, 'header', lay.pos.x - p.pos.x, lay.pos.z - p.pos.z, 0.5, lay.idx, true, { x: lay.pos.x, z: lay.pos.z });
    } else if (headerAtGoal(m, p) && !patient) {
      // (Only from close in: from further out a header is a nod the keeper has covered. It used to go for
      // goal whenever it had a sight of it, and headers were ~40% of all shots.)
      m.order(p, 'header', 0, 0, 0.75, -1, true);
    } else if (ownGoalDist < 30 && rival < 5) {
      const gxOwn = -ad * HALF_L;
      // (Attacking a corner / wide free kick he's facing, he mostly heads it back out where it came from.)
      const sp = m.setPieceKick === m.kickId && m.kickSide !== p.side ? SP_GLANCE : 1;
      if (ownGoalDist < 22 && rival < 5 && m.rng.chance((rival < 1.6 ? 0.8 : 0.66) * sp)) {
        // Under real pressure near goal: glance it behind for a corner rather than risk it.
        const z = Math.sign(p.pos.z || 1) * (6 + m.rng.next() * 8);
        m.order(p, 'header', -ad, 0, 1, -1, true, { x: gxOwn - ad * 3, z });
      } else {
        // Head it clear, out towards the wing (from out there, into touch). A corner is headed for
        // distance instead, out of the box towards the flank but not into the stand. (A header carries
        // HEADER_MAX_D m at most, so the open-play one goes 12 m up and 16 m across: from wide, that's
        // into touch.)
        const zs = Math.sign(p.pos.z || 1);
        if (sp < 1) {
          m.order(p, 'header', ad, 0, 1, -1, true, { x: p.pos.x + ad * 22, z: clamp(p.pos.z * 0.4 + zs * 11, -HALF_W + 4, HALF_W - 4) });
        } else {
          m.order(p, 'header', ad, 0, 1, -1, true, { x: p.pos.x + ad * 12, z: clamp(p.pos.z + zs * 16, -HALF_W - 3, HALF_W + 3) });
        }
      }
    } else if (rival < 2.2) {
      // Contested: nod it on to a teammate ahead.
      const x = clamp(p.pos.x + ad * 12, -HALF_L + 4, HALF_L - 4);
      m.order(p, 'header', ad, 0, 0.6, -1, true, { x, z: p.pos.z * 0.7 });
    }
    return;
  }
  // First-time finish from a low cross or cut-back: decide once per ball.
  if (p.volleyKick === m.kickId) return;
  // (Or a loose ball off the keeper or a defender straight after one of our shots: a rebound, hit first time.)
  const rebound = m.shotKick === m.kickId && m.shotSide === p.side && m.shotClock < 3 && b.lastTouch !== m.shooter && !setPieceShot(m);
  if ((b.hspeed() > 5 && q > 0.2) || (rebound && q > 0.3)) {
    p.volleyKick = m.kickId;
    // (A corner or wide free kick dropping to him: as ever, the box is crowded.)
    const sp = m.kickId === m.setPieceKick;
    const volley = m.human[p.side] ? HUMAN_SIDE_VOLLEY : AI_VOLLEY;
    if (m.rng.chance(sp ? clamp(q * 1.1, 0.25, 0.75) : clamp(q * volley, 0.3, rebound ? 0.85 : 0.8))) m.order(p, 'shot', 0, 0, 0.75, -1, true);
  } else if (ownGoalDist < 22 && rival < 2 && b.hspeed() > 4) {
    // Under pressure in our box: hack it away first time.
    p.volleyKick = m.kickId;
    const z = Math.sign(p.pos.z || 1) * (HALF_W - 1.5);
    m.order(p, 'clear', ad, 0, 1, -1, true, { x: p.pos.x + ad * 35, z });
  }
}

// ------------------------------------------------------------------ carrying the ball

function dribble(m: Match, p: Player, dx: number, dz: number): void {
  // Steer away from the nearest opponent ahead and off the touchlines.
  let ax = dx;
  let az = dz;
  let nearest = Infinity;
  for (const o of m.players) {
    if (o.side === p.side || o.sentOff) continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const d = Math.hypot(ox, oz);
    nearest = Math.min(nearest, d);
    if (d > 4.5 || d < 0.01) continue;
    const ahead = (ox * dx + oz * dz) / d;
    if (ahead < 0.2) continue;
    const w = ((4.5 - d) / 4.5) * ahead * 1.3;
    ax -= (ox / d) * w;
    az -= (oz / d) * w;
  }
  if (Math.abs(p.pos.z) > HALF_W - 3) az -= Math.sign(p.pos.z) * 0.9;
  if (Math.abs(p.pos.x) > HALF_L - 2.5) ax -= Math.sign(p.pos.x) * 0.9;
  const l = Math.hypot(ax, az) || 1;
  p.wantX = ax / l;
  p.wantZ = az / l;
  p.faceTarget = null;
  p.sprint = nearest > 3.2 && p.stamina > 0.2;
}

/** Put the body between the ball and the challenger: face away and edge sideways. */
function shield(m: Match, p: Player, o: Player): void {
  const ad = m.attackDir(p.side);
  let ax = p.pos.x - o.pos.x;
  let az = p.pos.z - o.pos.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  // Roll sideways, towards the side that isn't our own goal.
  let px = -az;
  let pz = ax;
  if (px * ad < 0 || (Math.abs(px * ad) < 0.1 && pz * p.pos.z > 0)) {
    px = -px;
    pz = -pz;
  }
  const wx = ax * 0.45 + px * 0.55;
  const wz = az * 0.45 + pz * 0.55;
  p.wantX = wx * 0.5;
  p.wantZ = wz * 0.5;
  if (Math.abs(p.pos.z + wz) > HALF_W - 1.5) p.wantZ = -Math.sign(p.pos.z) * 0.3;
  p.sprint = false;
  p.faceTarget = Math.atan2(az, ax);
}

type Choice = { s: number; run: () => void };

/** A first-time finish from a low cross, a cut-back or a rebound (open play) is hit with chance shotQuality x AI_VOLLEY. */
const AI_VOLLEY = 2.1;
/** ... and the human's own AI teammates' (round 12's AI_VOLLEY: the round-13 rise is the AI sides' alone). */
const HUMAN_SIDE_VOLLEY = 1.6;
/**
 * For this long (s) after one of our shots from open play, attackers near goal follow it in for a rebound
 * (set pieces have their own shape: see setPieceShot).
 */
const FOLLOW_IN_T = 1.8;

/** The last shot came from a set piece: a direct free kick, or met straight from a corner / wide free kick. */
function setPieceShot(m: Match): boolean {
  return m.shotKick === m.wallKick || (m.setPieceKick >= 0 && m.shotKick <= m.setPieceKick + 1);
}

/** How often an AI shooter chips a keeper who has rushed out at him. */
const AI_CHIP = 0.35;
/** What an AI carrier knocks off a shot from beyond 22 m (work it into the box instead)... */
const AI_LONG_SHOT_COST = 0.006;
/** ... and what a sight of goal inside the box adds to one... */
const AI_BOX_SHOT = 0.28;
/** ... and a clean sight of goal (nobody in the way) from the edge of the box (15-22 m out). */
const AI_CLEAR_SIGHT = 0.17;

/** Lateral offsets (m) tried for a through ball, around the runner's own line. */
const THREAD_OFFSETS = [0, -3.5, 3.5, -7, 7];
/**
 * The AI's attacking intent against the HUMAN (round 12: at NORMAL the scripted human had 75% of the ball and the AI 2.3
 * shots a match; a competent player was never in danger): from nothing at EASY to full at NORMAL and above, it looks
 * for the shot sooner (AI_INTENT_SHOT more on a sight of goal, the long-shot cost cut), rates the forward ball and the
 * through ball higher (AI_INTENT_FORWARD, AI_INTENT_THROUGH) and makes more runs in behind (AI_INTENT_RUNS).
 * AI v AI (no human side) is untouched.
 */
const AI_INTENT_FROM = 0.6;
const AI_INTENT_FULL = 1.8;
const AI_INTENT_SHOT = 0.6;
const AI_INTENT_FORWARD = 0.35;
const AI_INTENT_THROUGH = 0.4;
const AI_INTENT_RUNS = 0.5;
export function intentVsHuman(m: Match, side: Side): number {
  if (!m.human[other(side)]) return 0;
  return clamp((m.aiSkill(side) - AI_INTENT_FROM) / (AI_INTENT_FULL - AI_INTENT_FROM), 0, 1);
}
/**
 * Against the human every AI side breaks after a regain, as the counter styles do (StyleParams.counter): for
 * AI_INTENT_BREAK s (times intentVsHuman) it holds the ball less, rates the ball forward higher and runs in behind at
 * once. (2026-10-04, the owner: "boring", "sloggy". Against the casual phone bot the AI's spells lasted 6 s, two in
 * three never reached his third and it had 2 shots a match to his 11: no end-to-end, nothing for his keeper to do.)
 */
const AI_INTENT_BREAK = 3.5;
function breakFor(m: Match, side: Side, st: StyleParams): number {
  return Math.max(st.counter, AI_INTENT_BREAK * intentVsHuman(m, side));
}

/**
 * Time (s) `p` loses getting up to full speed towards (x, z), compared with already being flat out
 * that way: top / (2 ACCEL) from a standstill (or from running the other way), nothing at full tilt.
 */
function spinUp(p: Player, x: number, z: number): number {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const along = clamp((p.vel.x * dx + p.vel.z * dz) / d / p.top, 0, 1);
  return (1 - along) * (p.top / (2 * ACCEL));
}

function carrierAI(m: Match, p: Player, dt: number): void {
  const side = p.side;
  const opp = other(side);
  const ad = m.attackDir(side);
  const gx = ad * HALF_L;
  const skill = m.aiSkill(side);
  const brain = m.brains[side];
  const near = nearestOpp(m, side, p.pos.x, p.pos.z);
  const pressure = Math.pow(clamp((3.6 - near.d) / 2.4, 0, 1), 1.5);

  p.aiT -= dt;
  const firstTouch = p.ballT < 0.05 && p.aiT <= -dt * 0.5;
  const squeezed = (near.d < 1.4 && p.aiMode === 'dribble' && p.aiT > 0.1 && p.ballT > 0.3) || readsHuman(m, p, near.o, near.d, dt);
  if (!firstTouch && p.aiT > 0 && !squeezed) {
    if (p.aiMode === 'shield' && near.o && near.d < 3.5) shield(m, p, near.o);
    else dribble(m, p, p.aiDirX, p.aiDirZ);
    return;
  }
  // (Think times and the hold ride on the tempo: the AI carrier looks up and moves it on that much sooner.)
  p.aiT = (firstTouch ? 0.32 + m.rng.next() * 0.3 - skill * 0.03 : 0.24 + m.rng.next() * 0.2 - skill * 0.015) / TEMPO;
  // The style: how patient (hold), how safe, how direct; on the break (just won it, a counter side) it goes forward.
  const st = styleOf(m, side);
  const bf = breakFor(m, side, st);
  const breaking = bf > 0 && m.sincePossession < bf;
  if (firstTouch) p.holdT = ((1.1 + m.rng.next() * 1.5) / TEMPO) * st.hold * (breaking ? COUNTER_HOLD : 1);
  const fwdK = st.forward + (breaking ? COUNTER_FORWARD : 0);

  const team = m.teamPlayers(side);
  const choices: Choice[] = [];
  const here = threat(m, side, p.pos.x, p.pos.z);
  // Not every turnover gets punished, so a loss costs a share of their threat from there.
  const lose = (x: number, z: number) => threat(m, opp, x, z) * 0.65 + 0.01;
  const loseHere = lose(p.pos.x, p.pos.z);
  // Tempo: take a touch and look up before moving it on, unless there's no time to. Early
  // releases are marked down in proportion to their value, so only a clearly better option
  // (a runner in behind, a big chance) is played first time.
  const tempo = clamp(1 - p.ballT / p.holdT, 0, 1) * (1 - pressure * 0.7);
  const early = (s: number, k: number) => s - tempo * (k * Math.abs(s) + 0.01);
  const pN = nX(m, side, p.pos.x);
  const dg = dist2(p.pos.x, p.pos.z, gx, 0);
  const inBox = Math.abs(p.pos.x - gx) < BOX_DEPTH && Math.abs(p.pos.z) < BOX_W / 2;

  // ---- Shoot (never in the patient build-up of the player's first half-minute: Match.firstMatchPatient)
  let shotChoice: Choice | null = null;
  let shotXg = 0;
  const patient = m.human[opp] && m.firstMatchPatient();
  const intent = intentVsHuman(m, side);
  if (dg < 36 && !patient) {
    let q = shotQuality(p.pos.x, p.pos.z, ad);
    const blockers = shotBlockers(m, p);
    q *= Math.pow(0.55, blockers);
    const k = m.keeperOf(opp);
    if (k && dist2(k.pos.x, k.pos.z, gx, 0) > 6) q *= 1.3;
    q *= 1 - pressure * 0.15;
    shotXg = q;
    // A clean strike also earns rebounds and corners, and shooters love a sight of goal.
    // (A clean sight of goal from the edge of the box, 15-22 m out, is the one to hit.)
    const bonus = blockers < 0.5 ? (dg < 15 ? 0.035 : dg < 22 ? AI_CLEAR_SIGHT : dg < 28 ? 0.035 : 0.015) : 0;
    const keen = 1 + AI_INTENT_SHOT * intent;
    const s0 = early(q * 2 + (bonus + (inBox ? AI_BOX_SHOT : 0)) * keen - (dg > 22 ? AI_LONG_SHOT_COST / keen : 0), 0.05);
    const s = s0 > 0 ? s0 * st.shoot : s0;
    // (Harder from further out, but short of flat out: see actions.AI_STRIKE_LIFT.)
    const power = clamp(0.55 + dg / 50, 0.6, 0.94);
    // A keeper who has come off his line (3.8+ m out, 3-12 m from the shooter): now and then it's
    // lifted over him.
    const kd = k ? dist2(k.pos.x, k.pos.z, p.pos.x, p.pos.z) : 0;
    const rushing = !!k && dist2(k.pos.x, k.pos.z, gx, 0) > 3.8 && kd > 3 && kd < 12 && dg < 26 && k.state === 'move';
    shotChoice = {
      s,
      run: () => {
        const o = m.order(p, 'shot', 0, 0, power, -1, false);
        if (o && rushing && m.rng.chance(AI_CHIP)) o.style = 'chip';
      },
    };
    choices.push(shotChoice);
  }

  // ---- Passes and through balls
  for (const t of team) {
    if (t === p || t.sentOff || (t.state !== 'move' && t.state !== 'stand')) continue;
    // Never knowingly played to a man in an offside position.
    if (looksOffside(m, t)) continue;
    const lead = t.running || brain.overlap === t.idx ? 0.5 : 0.3;
    const lx = clamp(t.pos.x + t.vel.x * lead, -HALF_L + 1, HALF_L - 1);
    const lz = clamp(t.pos.z + t.vel.z * lead, -HALF_W + 1, HALF_W - 1);
    const d = dist2(p.pos.x, p.pos.z, lx, lz);
    if (d >= 5 && d <= 38 && (!t.isKeeper || (pressure > 0.6 && pN < -0.35))) {
      const risk = interceptRisk(m, side, p.pos.x, p.pos.z, lx, lz, passSpeed(d));
      // Room the receiver will have once the ball arrives (defenders close while it travels).
      const open = nearestOpp(m, side, lx, lz).d - d * 0.2;
      const room = clamp(open / 4, 0, 1);
      let pc = (1 - risk) * (0.7 + 0.3 * room);
      if (d > 24) pc *= 1 - (d - 24) / 32;
      pc = clamp(pc * (0.86 + p.stat.passing / 700), 0.02, 0.96);
      // (Against the human: the forward ball is worth that much more, AI_INTENT_FORWARD.)
      const ahead = clamp(((lx - p.pos.x) * ad) / 15, 0, 1);
      const fwd = (intent > 0 ? 1 + AI_INTENT_FORWARD * intent * ahead : 1) * (1 + fwdK * ahead);
      const gain = threat(m, side, lx, lz) * (t.isKeeper ? 0.3 : 1) * (0.72 + 0.28 * room) * fwd;
      const s = early(pc * gain - (1 - pc) * lose((p.pos.x + lx) / 2, (p.pos.z + lz) / 2) * st.safe, 0.6) -
        (d < 9 && pressure < 0.3 ? 0.004 : 0) - Math.max(0, d - LONG_PASS_D) * st.longCost;
      choices.push({ s, run: () => m.order(p, 'pass', lx - p.pos.x, lz - p.pos.z, 0.6, t.idx, false) });
    }

    const tsp = Math.hypot(t.vel.x, t.vel.z);
    const fwd = t.vel.x * ad;
    const runner = t.running || brain.overlap === t.idx || (t.role === 'FW' && fwd > 4);
    if (!t.isKeeper && runner && fwd > 1.5) {
      const rx0 = (t.vel.x / tsp) * 0.6 + ad * 0.4;
      const rz0 = (t.vel.z / tsp) * 0.6;
      const rl = Math.hypot(rx0, rz0) || 1;
      const leadD = 5 + tsp * 0.75;
      const lx0 = t.pos.x + (rx0 / rl) * leadD;
      const lz0 = t.pos.z + (rz0 / rl) * leadD;
      // Thread it: try the runner's line and a few points either side of it, through the gaps in
      // the back line, and keep the best ground ball and the best ball over the top.
      let bestG: Choice | null = null;
      let bestL: Choice | null = null;
      const onShoulder = nX(m, side, t.pos.x) > m.defLine(opp) - 0.06;
      for (const off of THREAD_OFFSETS) {
        const ax = clamp(lx0, -HALF_L + 3, HALF_L - 3);
        const az = clamp(lz0 + off, -HALF_W + 2, HALF_W - 2);
        if ((ax - p.pos.x) * ad <= 5 || nearestOpp(m, side, ax, az).d <= 2.5) continue;
        // A race to the ball in behind: whoever is already running that way has the head start (a
        // defender stepping up or holding the line has to turn and get up to speed first).
        const tRun = dist2(t.pos.x, t.pos.z, ax, az) / t.top + 0.1 + spinUp(t, ax, az);
        let tDef = Infinity;
        for (const o of m.teamPlayers(opp)) {
          if (o.sentOff) continue;
          tDef = Math.min(tDef, Math.max(0, dist2(o.pos.x, o.pos.z, ax, az) - 1) / o.top + (o.isKeeper ? 0.3 : 0.12) + spinUp(o, ax, az));
        }
        const pWin = clamp(0.42 + (tDef - tRun) * 0.7, 0.02, 0.88);
        const dT = dist2(p.pos.x, p.pos.z, ax, az);
        const gain = (threat(m, side, ax, az) + 0.02) * (1 + AI_INTENT_THROUGH * intent) * (1 + Math.max(0, fwdK));
        const ir = interceptRisk(m, side, p.pos.x, p.pos.z, ax, az, throughSpeed(dT));
        const pc = pWin * (1 - ir);
        const sg = early(pc * gain - (1 - pc) * lose(ax, az) * 0.6 * st.safe, 0.35);
        // (A lane a defender would cut out isn't threaded at all: the pass to feet is the option there.)
        if (ir <= THROUGH_MAX_INTERCEPT && (!bestG || sg > bestG.s)) {
          bestG = { s: sg, run: () => m.order(p, 'through', 0, 0, 0.7, t.idx, false, { x: ax, z: az }) };
        }
        // Over the top when the ground lane is shut and the runner is on the shoulder of the
        // last man: only the race to the landing spot matters, but it's harder to weight.
        if (dT > 16 && dT < 42 && ir > 0.4 && onShoulder) {
          const pl = pWin * 0.62 * (0.8 + p.stat.passing / 700);
          const sl = early(pl * gain - (1 - pl) * lose(ax, az) * 0.6 * st.safe, 0.5);
          if (!bestL || sl > bestL.s) {
            bestL = { s: sl, run: () => m.order(p, 'lob', ax - p.pos.x, az - p.pos.z, 0.7, t.idx, false, { x: ax, z: az }, 0.5) };
          }
        }
      }
      if (bestG) choices.push(bestG);
      if (bestL) choices.push(bestL);
    }
  }

  // ---- Crosses from wide in the final third, aimed at a zone a teammate is attacking.
  if (Math.abs(p.pos.z) > HALF_W * 0.36 && pN > 0.42 && !patient) {
    const s0 = Math.sign(p.pos.z);
    const zones = [
      { x: gx - ad * 5.5, z: s0 * 2.2 },
      { x: gx - ad * 6.5, z: -s0 * 3 },
      { x: gx - ad * 10.5, z: -s0 * 0.8 },
    ];
    for (const zn of zones) {
      let tAtt = Infinity;
      let who = -1;
      for (const t of team) {
        if (t === p || t.isKeeper || t.sentOff || (t.role === 'DF' && brain.overlap !== t.idx)) continue;
        const tt = dist2(t.pos.x, t.pos.z, zn.x, zn.z) / t.top + 0.15;
        if (tt < tAtt) {
          tAtt = tt;
          who = t.idx;
        }
      }
      if (who < 0 || looksOffside(m, m.players[who])) continue;
      let tDef = Infinity;
      for (const o of m.teamPlayers(opp)) {
        if (o.sentOff) continue;
        tDef = Math.min(tDef, (dist2(o.pos.x, o.pos.z, zn.x, zn.z) / o.top + 0.1) * (o.isKeeper ? 1.25 : 1));
      }
      const flight = 0.75 + dist2(p.pos.x, p.pos.z, zn.x, zn.z) / 34;
      // Whoever is there when it drops contests it; a runner arriving at pace wins more than his
      // share of those duels, so being a step behind the marker matters less than getting there.
      const pWin = tAtt < flight + 0.05
        ? tDef < flight ? clamp(0.45 + (tDef - tAtt) * 0.3, 0.25, 0.6) : 0.7
        : 0.1;
      const hq = shotQuality(zn.x, zn.z, ad) * 0.75;
      // A won header is far from a sure goal: credit roughly its real conversion.
      const s = early(pWin * (0.03 + hq * AI_CROSS_VALUE) - (1 - pWin) * 0.02, 0.3);
      choices.push({ s, run: () => m.order(p, 'lob', zn.x - p.pos.x, zn.z - p.pos.z, 0.75, who, false, { x: zn.x, z: zn.z }) });
    }
  }

  // ---- Clear it when trapped deep in our own third: from out wide, up the line and into touch
  // (safe, and the throw is deep in their half); from the middle, towards the wing.
  // (A low block clears it from anywhere in our half with a man near him: long, towards its outlet up top.)
  const clearFrom = st.direct > 0.008 ? [-0.05, 0.25] : [-0.35, 0.5];
  if (pN < clearFrom[0] && pressure > clearFrom[1]) {
    const wide = Math.abs(p.pos.z) > HALF_W * 0.35;
    const tz = Math.sign(p.pos.z || 1) * (wide ? HALF_W + 4 : HALF_W - 1.5);
    const tx = p.pos.x + ad * (wide ? 30 : 38);
    choices.push({ s: -0.004 + (pN < -0.6 ? 0.006 : 0) + (wide ? 0.002 : 0) + st.direct, run: () => m.order(p, 'clear', ad, 0, 1, -1, false, { x: tx, z: tz }) });
  }

  // ---- Trapped by the touchline in our half: put it out for a throw rather than lose it.
  if (pN < 0.1 && pressure > 0.45 && Math.abs(p.pos.z) > HALF_W - 9) {
    const zs = Math.sign(p.pos.z);
    choices.push({
      s: -0.22 * threat(m, opp, p.pos.x, p.pos.z) - 0.002,
      run: () => m.order(p, 'clear', ad, zs, 0.6, -1, false, { x: p.pos.x + ad * 10, z: zs * (HALF_W + 6) }, 0.3),
    });
  }

  // ---- Trapped by our own byline, wide of the goal: hook it behind rather than lose it in our box.
  const dOwnLine = Math.abs(p.pos.x + gx);
  if (dOwnLine < 11 && Math.abs(p.pos.z) > GOAL_W / 2 + 3 && pressure > 0.5) {
    const zs = Math.sign(p.pos.z);
    const aim = { x: -gx - ad * 3, z: zs * Math.max(Math.abs(p.pos.z) + 2, 10) };
    choices.push({
      s: -0.15 * threat(m, opp, p.pos.x, p.pos.z) - 0.004,
      run: () => m.order(p, 'clear', aim.x - p.pos.x, aim.z - p.pos.z, 0.6, -1, false, aim, 0.3),
    });
  }

  // ---- Shield it under tight pressure (buys a second, not a lifetime).
  if (near.o && near.d < 2.2) {
    const o = near.o;
    const hold = clamp(1 - (p.ballT * TEMPO) / 2, 0, 1);
    const pRet = clamp(0.5 + (p.stat.dribbling / 100) * 0.3 - (near.d < 1 ? 0.1 : 0), 0.35, 0.85) * (0.55 + 0.45 * hold);
    const s = pRet * here - (1 - pRet) * loseHere;
    choices.push({
      s,
      run: () => {
        p.aiMode = 'shield';
        shield(m, p, o);
      },
    });
  }

  // ---- Take on the man in front: knock it past his shoulder and go.
  if (near.o && !near.o.isKeeper && near.d > 0.9 && near.d < 3.2 && near.o.slowT <= 0) {
    const o = near.o;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const ol = Math.hypot(ox, oz) || 1;
    const tgx = gx - p.pos.x;
    const tgz = -p.pos.z * 0.5;
    const tgl = Math.hypot(tgx, tgz) || 1;
    if ((ox * tgx + oz * tgz) / (ol * tgl) > 0.35) {
      const pWin = clamp(0.33 + (p.stat.dribbling - o.stat.defending) / 100 * 0.9 + (p.top - o.top) * 0.08 + (skill - 2) * 0.03, 0.15, 0.68);
      for (const sgn of [-1, 1]) {
        const a = Math.atan2(oz, ox) + sgn * 0.8;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let free = 12;
        for (const q of m.players) {
          if (q.side === side || q === o || q.sentOff) continue;
          const qx = q.pos.x - p.pos.x;
          const qz = q.pos.z - p.pos.z;
          const along = qx * dx + qz * dz;
          if (along < -1) continue;
          free = Math.min(free, Math.max(0, (Math.max(along, 0) + Math.abs(qx * dz - qz * dx)) * 0.55 - 1));
        }
        const L = clamp(free, 2, 12);
        const lx = clamp(p.pos.x + dx * L, -HALF_L + 1, HALF_L - 1);
        const lz = clamp(p.pos.z + dz * L, -HALF_W + 1.5, HALF_W - 1.5);
        if (Math.abs(p.pos.z + dz * 3) > HALF_W - 1) continue;
        // A failed take-on usually just means he steps across; it's lost maybe 40% of the time.
        const s = pWin * threat(m, side, lx, lz) + (1 - pWin) * (0.6 * here - 0.4 * loseHere);
        choices.push({
          s,
          run: () => {
            p.aiMode = 'dribble';
            p.aiDirX = dx;
            p.aiDirZ = dz;
            p.aiT = 0.55 / TEMPO;
            // A human defender reads it differently from the AI: how well, by difficulty (dribble.ts vsHuman).
            if (m.rng.chance(pWin * takeOnVsHuman(m, o))) {
              m.beatDefender(p, o);
            } else {
              o.commitT = 0.5; // he reads it and steps in
            }
            dribble(m, p, dx, dz);
            p.sprint = true;
          },
        });
      }
    }
  }

  // ---- Dribble options fanned around the goal direction.
  const gdx = gx - p.pos.x;
  const gdz = -p.pos.z * (pN > 0.55 ? 0.8 : 0.35);
  const base = Math.atan2(gdz, gdx);
  for (const off of [0, -0.5, 0.5, -1.0, 1.0, -1.6, 1.6]) {
    const a = base + off;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // How far we can carry it this way before an opponent can step across.
    let free = 14;
    for (const o of m.players) {
      if (o.side === side || o.sentOff) continue;
      const ox = o.pos.x - p.pos.x;
      const oz = o.pos.z - p.pos.z;
      const along = ox * dx + oz * dz;
      const lat = Math.abs(ox * dz - oz * dx);
      if (along < -1) {
        if (Math.hypot(ox, oz) < 2) free = Math.min(free, 2.5);
        continue;
      }
      free = Math.min(free, Math.max(0, (Math.max(along, 0) + lat) * 0.65 - 0.7));
    }
    // Keep it on the pitch.
    const L0 = clamp(free, 2, 14);
    let L = L0;
    if (Math.abs(dz) > 0.05) L = Math.min(L, Math.max(1.5, (HALF_W - 1.5 - Math.sign(dz) * p.pos.z) / Math.abs(dz)));
    if (Math.abs(dx) > 0.05) L = Math.min(L, Math.max(1.5, (HALF_L - 1 - Math.sign(dx) * p.pos.x) / Math.abs(dx)));
    const lx = p.pos.x + dx * L;
    const lz = p.pos.z + dz * L;
    const edge = L < L0 && L < 3 ? 0.03 : 0;
    const pRet = clamp(0.5 + L / 22 + (p.stat.dribbling / 100) * 0.15 - pressure * 0.25, 0.12, 0.95);
    let s = pRet * threat(m, side, lx, lz) - (1 - pRet) * loseHere - edge;
    if (p.aiMode === 'dribble' && dx * p.aiDirX + dz * p.aiDirZ > 0.85) s += 0.003;
    choices.push({
      s,
      run: () => {
        p.aiMode = 'dribble';
        p.aiDirX = dx;
        p.aiDirZ = dz;
        dribble(m, p, dx, dz);
      },
    });
  }

  const noise = 0.95 - skill * 0.16;
  let best: Choice | null = null;
  let bestS = -Infinity;
  for (const c of choices) {
    const s = c.s + m.rng.gauss() * noise * (0.006 + Math.abs(c.s) * 0.18);
    if (s > bestS) {
      bestS = s;
      best = c;
    }
  }
  // About to shoot with a clearly better-placed teammate free (a clear lane to him): half the time he's
  // found instead (one striker was scoring ~40-60% of his side's goals).
  if (best && best === shotChoice) {
    const t = betterPlaced(m, p, shotXg);
    if (t && m.rng.chance(AI_SQUARE_IT)) {
      const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
      const lead = Math.min(0.3, d / 60);
      m.order(p, 'pass', t.pos.x + t.vel.x * lead - p.pos.x, t.pos.z + t.vel.z * lead - p.pos.z, 0.6, t.idx, false);
      return;
    }
  }
  best?.run();
}

/**
 * What a won header from a cross is worth to the AI carrier, times the zone's shot quality (round 13: 0.42, and headers
 * were 55-65% of its goals; one carry-wide-and-cross pattern).
 */
const AI_CROSS_VALUE = 0.32;
/** On the break (StyleParams.counter): the hold is this much shorter, and a ball forward worth this much more. */
const COUNTER_HOLD = 0.6;
const COUNTER_FORWARD = 0.35;

/** A teammate needs a chance at least this much better (xG, times the shooter's) to be looked for... */
const AI_SQUARE_XG = 1.25;
/** ... through a lane at most this risky (interceptRisk / laneRisk) ... */
const AI_SQUARE_LANE = 0.2;
/** ... and then he's found this often instead of the shot. */
const AI_SQUARE_IT = 0.5;

/**
 * The teammate (in range, onside, a clear pass away) whose chance from where he stands (shotQuality with
 * the bodies in his way, like the shooter's own) is at least AI_SQUARE_XG x `xg`: the best such, or null.
 */
function betterPlaced(m: Match, p: Player, xg: number): Player | null {
  if (xg <= 0) return null;
  const ad = m.attackDir(p.side);
  let best: Player | null = null;
  let bestQ = xg * AI_SQUARE_XG;
  for (const t of m.teamPlayers(p.side)) {
    if (t === p || t.isKeeper || t.sentOff || t.state !== 'move' || looksOffside(m, t)) continue;
    const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
    if (d < 4 || d > 24) continue;
    const near = nearestOpp(m, p.side, t.pos.x, t.pos.z).d;
    const tq = shotQuality(t.pos.x, t.pos.z, ad) * Math.pow(0.55, shotBlockers(m, t)) * (1 - Math.pow(clamp((3.6 - near) / 2.4, 0, 1), 1.5) * 0.15);
    if (tq < bestQ) continue;
    if (interceptRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z, passSpeed(d)) > AI_SQUARE_LANE) continue;
    if (laneRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z) > AI_SQUARE_LANE + 0.15) continue;
    bestQ = tq;
    best = t;
  }
  return best;
}

// ------------------------------------------------------------------ set pieces

/** Is this restart a crossing situation (corner, or a free kick wide in the final third)? */
export function isCrossingRestart(m: Match, r: { kind: string; side: Side; x: number; z: number }): boolean {
  if (r.kind === 'corner') return true;
  if (r.kind !== 'freekick') return false;
  const ad = m.attackDir(r.side);
  const gx = ad * HALF_L;
  const n = nX(m, r.side, r.x);
  const dg = dist2(r.x, r.z, gx, 0);
  return n > 0.45 && !(dg < 30 && Math.abs(r.z) < 14);
}

/**
 * Set-piece shapes. Corners: five runners start in and around the six-yard box (CORNER_BOX: near post,
 * far post, spot, back post, front post) and attack their zones (cornerZones) as the kick is struck;
 * one comes short, one on the edge, two at the back. Defending a corner: three zonal men on the 5.5 m
 * line (CORNER_ZONAL, they hold it while the ball comes in), a man goal-side of each box attacker,
 * one on the edge, one up. Wide free kicks: the runners hold the line; defenders go goal-side of each,
 * a two-man wall, the edge, two up. Direct free kicks: see `directFreeKickShape`.
 */
export function setPieceTargets(m: Match, side: Side): Map<number, { x: number; z: number }> {
  const brain = m.brains[side];
  const r = m.restart;
  if (!r) return brain.spTargets;
  if (brain.spFor === r && brain.spTaker === r.taker) return brain.spTargets;
  brain.spFor = r;
  brain.spTaker = r.taker;
  brain.spTargets = new Map();
  brain.spRunners = [];
  brain.spZones = new Map();
  brain.spWall = [];
  brain.spZonal = new Map();
  if (isDirectFreeKick(m, r)) {
    directFreeKickShape(m, side, r, brain);
    return brain.spTargets;
  }
  if (!isCrossingRestart(m, r)) return brain.spTargets;
  const atk = r.side;
  const adA = m.attackDir(atk);
  const gx = adA * HALF_L;
  const s0 = Math.sign(r.z) || 1;
  const corner = r.kind === 'corner';
  // (distance out from the goal line, z) for the attacking side.
  const box: [number, number][] = corner
    ? CORNER_BOX.map(([d, z]) => [d, z * s0] as [number, number])
    : [[6, 2.8 * s0], [6.5, -3.5 * s0], [9.5, 0.5 * s0], [11, -5.5 * s0], [10.5, 6 * s0]];
  const edge: [number, number][] = [[17, 3 * s0], [17.5, -6 * s0]];
  const P = (d: number, z: number) => ({ x: gx - adA * d, z });
  const attackers = m.teamPlayers(atk).filter((p) => !p.isKeeper && !p.sentOff && p.idx !== r.taker);
  attackers.sort((a, b) => atkPrio(m, a) - atkPrio(m, b) || a.slot - b.slot);
  const boxPts = box.map(([d, z]) => P(d, z));
  if (side === atk) {
    assignNearest(attackers.slice(0, 5), boxPts, brain.spTargets, brain.spRunners);
    if (corner) {
      // One of the edge men comes short for it, ~8 m from the flag, in case it's played short.
      assignNearest(attackers.slice(5, 6), [cornerShortSpot(m, r)], brain.spTargets);
      assignNearest(attackers.slice(6, 7), edge.slice(0, 1).map(([d, z]) => P(d, z)), brain.spTargets);
    } else {
      assignNearest(attackers.slice(5, 7), edge.map(([d, z]) => P(d, z)), brain.spTargets);
    }
    assignNearest(attackers.slice(7), [{ x: adA * 2, z: -8 }, { x: adA * 2, z: 8 }], brain.spTargets);
    if (corner) {
      const zones = cornerZones(s0).map(([d, z]) => P(d, z));
      brain.spRunners.forEach((idx, i) => brain.spZones.set(idx, zones[i]));
    }
    return brain.spTargets;
  }
  // Defending: goal-side of each box zone, zonal men (corners) or a short wall, the edge, up top.
  const defs = m.teamPlayers(side).filter((p) => !p.isKeeper && !p.sentOff);
  const dprio = (p: Player) => (p.role === 'DF' ? 0 : p.role === 'MF' ? 1 : 2);
  defs.sort((a, b) => dprio(a) - dprio(b) || a.slot - b.slot);
  const marks = boxPts.map((pt) => ({ x: pt.x + adA * 0.9, z: pt.z * 0.92 }));
  if (corner) {
    // Three zonal men across the 5.5 m line (they stay there while it comes in), a marker goal-side of
    // each runner, one on the edge, one up for the counter.
    const zonal = CORNER_ZONAL.map((z) => P(CORNER_ZONAL_D, z * s0));
    assignNearest(defs.slice(0, 3), zonal, brain.spTargets);
    for (const p of defs.slice(0, 3)) {
      const pt = brain.spTargets.get(p.idx);
      if (pt) brain.spZonal.set(p.idx, pt);
    }
    assignNearest(defs.slice(3, 8), marks, brain.spTargets);
    assignNearest(defs.slice(8, 9), [P(16, 2 * s0)], brain.spTargets);
    assignNearest(defs.slice(9), [{ x: -adA * 1.5, z: -7 * s0 }], brain.spTargets);
    return brain.spTargets;
  }
  // A wide free kick: a two-man wall.
  const dg = Math.max(1, dist2(r.x, r.z, gx, 0));
  const ux = (gx - r.x) / dg;
  const uz = -r.z / dg;
  const extra = [-0.45, 0.45].map((o) => ({ x: r.x + ux * WALL_DIST - uz * o, z: r.z + uz * WALL_DIST + ux * o }));
  const edgeD = [P(16, 2 * s0), P(16.5, -4 * s0)];
  // Two stay up on halfway for the counter.
  const up = [{ x: -adA * 1.5, z: -7 }, { x: -adA * 1.5, z: 7 }];
  assignNearest(defs.slice(0, 5), marks, brain.spTargets);
  assignNearest(defs.slice(5, 5 + extra.length), extra, brain.spTargets);
  assignNearest(defs.slice(5 + extra.length, 7 + extra.length), edgeD, brain.spTargets);
  assignNearest(defs.slice(7 + extra.length), up, brain.spTargets);
  return brain.spTargets;
}

/** Where the man who comes short for a corner stands: ~6 m in from the byline and the touchline. */
export function cornerShortSpot(m: Match, r: { side: Side; x: number; z: number }): { x: number; z: number } {
  const gx = m.attackDir(r.side) * HALF_L;
  const s0 = Math.sign(r.z) || 1;
  return { x: gx - m.attackDir(r.side) * 6, z: s0 * (HALF_W - 6) };
}

/**
 * Where the five corner runners start (m out from the goal line, z towards the corner's side), in
 * runner order: near post, far post, spot, back post, front post. They're in and around the six-yard
 * box, not in a pack on the penalty spot.
 */
export const CORNER_BOX: readonly [number, number][] = [[6.5, 2.5], [7.5, -2], [11, 0.5], [9, -5.5], [5.5, 5.5]];
/** Corner defence: zonal men on this line (m out) at these z (towards the corner's side). */
export const CORNER_ZONAL_D = 5.5;
export const CORNER_ZONAL: readonly number[] = [-3, 0, 3];

/**
 * Corner delivery zones (distance out, z) in runner order: near post, far post, spot, back post, front.
 * The near-post runner arrives ~6 m out, where a driven corner is whipped.
 */
function cornerZones(s0: number): [number, number][] {
  return [[6, 2.2 * s0], [5.5, -3 * s0], [9, 0], [7, -5.5 * s0], [4.5, 4.5 * s0]];
}

/**
 * A zonal defender at a corner: while the delivery is coming in (the first ~1.6 s), he holds his spot
 * on the 5.5 m line, stepping towards the ball's line, rather than following a runner.
 */
function setPieceZonal(m: Match, p: Player): { x: number; z: number } | null {
  if (m.setPieceKick !== m.kickId || m.sinceKick > 1.6 || m.kickSide === p.side) return null;
  const zone = m.brains[p.side].spZonal.get(p.idx);
  if (!zone) return null;
  // A ball coming through his zone at a height he can head: he attacks it (the first point of its
  // flight he can get to, within ZONAL_REACH of his spot); otherwise he holds the spot, shading a
  // little towards the ball.
  let best: { x: number; z: number } | null = null;
  for (const s of m.ballPath) {
    if (s.y > 2.6 || s.y < 0.5) continue;
    if (dist2(s.x, s.z, zone.x, zone.z) > ZONAL_REACH) continue;
    if (dist2(p.pos.x, p.pos.z, s.x, s.z) / (p.top * 0.9) <= s.t + 0.1) {
      best = { x: s.x, z: s.z };
      break;
    }
  }
  if (best) return best;
  const b = m.ball;
  return { x: zone.x, z: zone.z + clamp(b.pos.z - zone.z, -1, 1) * 0.6 };
}

/** How far (m) from his spot a zonal defender goes to attack a corner coming through his zone. */
const ZONAL_REACH = 1.0;
/** How much less often a defender glances a set-piece delivery behind (vs heading it away). */
const SP_GLANCE = 0.6;

const atkPrio = (m: Match, p: Player) => (p.role === 'FW' ? 0 : p.role === 'MF' ? 1 : isWide(m, p) ? 2 : 3);

/** Greedy: each point in turn takes the nearest still-free player of `group`. */
function assignNearest(group: Player[], pts: { x: number; z: number }[], out: Map<number, { x: number; z: number }>, order?: number[]): void {
  const free = [...group];
  for (const pt of pts) {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = dist2(free[i].pos.x, free[i].pos.z, pt.x, pt.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi < 0) break;
    out.set(free[bi].idx, pt);
    order?.push(free[bi].idx);
    free.splice(bi, 1);
  }
}

/**
 * Direct free kick. Defending: a 3-4 man wall 9.15 m out (midfielders and forwards first), a line
 * of four holding ~10.5 m out, one on the edge, the rest up; every one of them at least 9.15 m from
 * the ball. Attacking: a second man over the ball, four lurking on the line for rebounds, two on
 * the edge, the rest back.
 */
function directFreeKickShape(m: Match, side: Side, r: { kind: string; side: Side; x: number; z: number; taker: number }, brain: TeamBrain): void {
  const atk = r.side;
  const adA = m.attackDir(atk);
  const gx = adA * HALF_L;
  const near = Math.sign(r.z) || 1;
  const P = (d: number, z: number) => ({ x: gx - adA * d, z: clamp(z, -HALF_W + 1.5, HALF_W - 1.5) });
  // The middle of the shooting lanes (ball to goal centre) at `d` m out.
  const dx = Math.max(1, Math.abs(gx - r.x));
  const laneZ = (d: number) => r.z * Math.min(1, d / dx);
  // Keep a point at least ten yards from the ball (and on the pitch).
  const clearOf = (pt: { x: number; z: number }, min: number) => {
    const d = dist2(pt.x, pt.z, r.x, r.z);
    if (d >= min) return pt;
    const k = min / Math.max(0.1, d);
    return { x: r.x + (pt.x - r.x) * k, z: clamp(r.z + (pt.z - r.z) * k, -HALF_W + 1, HALF_W - 1) };
  };
  if (side === atk) {
    const attackers = m.teamPlayers(atk).filter((p) => !p.isKeeper && !p.sentOff && p.idx !== r.taker);
    attackers.sort((a, b) => atkPrio(m, a) - atkPrio(m, b) || a.slot - b.slot);
    const dg = Math.max(1, dist2(r.x, r.z, gx, 0));
    const ux = (gx - r.x) / dg;
    const uz = -r.z / dg;
    // The second man over the ball stands beside it and a stride ahead of it: the set-piece camera looks
    // along the ball-goal line from ~7 m behind the ball, so nobody may stand behind the ball near that
    // line (see clearOfLens); level with the ball or ahead of it he's in shot but not in the way.
    const decoy = { x: r.x + ux * FK_DECOY_AHEAD - uz * near * FK_DECOY_SIDE, z: r.z + uz * FK_DECOY_AHEAD + ux * near * FK_DECOY_SIDE };
    // Lurking for the rebound either side of the shooting lanes, not in them.
    const line = [P(11, laneZ(11) - 10), P(11.5, laneZ(11.5) - 6.5), P(11.5, laneZ(11.5) + 6.5), P(11, laneZ(11) + 10)];
    const edge = [P(19, -near * 9), P(19, near * 13)].map((pt) => clearOf(pt, 4));
    const back = [{ x: -adA * 2, z: -8 }, { x: -adA * 2, z: 8 }, { x: -adA * 10, z: 0 }];
    assignNearest(attackers.slice(0, 1), [decoy], brain.spTargets);
    assignNearest(attackers.slice(1, 5), line, brain.spTargets, brain.spRunners);
    assignNearest(attackers.slice(5, 7), edge, brain.spTargets);
    assignNearest(attackers.slice(7), back, brain.spTargets);
    for (const [idx, pt] of brain.spTargets) brain.spTargets.set(idx, clearOfLens(r, gx, pt, near));
    return;
  }
  const defLens = (map: Map<number, { x: number; z: number }>) => {
    for (const [idx, pt] of map) map.set(idx, clearOfLens(r, gx, pt, near));
  };
  const plan = freeKickWall(m, r);
  const defs = m.teamPlayers(side).filter((p) => !p.isKeeper && !p.sentOff);
  const nonDf = defs.filter((p) => p.role !== 'DF');
  const wallGroup = nonDf.length >= plan.spots.length ? nonDf : defs;
  assignNearest(wallGroup, plan.spots, brain.spTargets, brain.spWall);
  const rest = defs.filter((p) => !brain.spTargets.has(p.idx));
  rest.sort((a, b) => (a.role === 'DF' ? 0 : 1) - (b.role === 'DF' ? 0 : 1) || a.slot - b.slot);
  // The line holds ~10.5 m out, or drops behind the wall when the kick is close.
  const depth = clamp(Math.abs(gx - r.x) - WALL_DIST - 1.5, 5.5, 10.5);
  // (Out of the shooting lanes, marking the men lurking either side of them.)
  const line = [P(depth - 0.5, laneZ(depth) - 9.5), P(depth, laneZ(depth) - 6), P(depth, laneZ(depth) + 6), P(depth - 0.5, laneZ(depth) + 9.5)]
    .map((pt) => clearOf(pt, WALL_DIST + 0.3));
  const edge = [clearOf(P(16.5, -near * 7), WALL_DIST + 0.3)];
  const up = [{ x: -adA * 1.5, z: -7 }, { x: -adA * 1.5, z: 7 }];
  assignNearest(rest.slice(0, 4), line, brain.spTargets);
  assignNearest(rest.slice(4, 5), edge, brain.spTargets);
  assignNearest(rest.slice(5), up, brain.spTargets);
  // (Nobody from either side stands in the lens: the wall and the line are ahead of the ball anyway.)
  defLens(brain.spTargets);
}

/**
 * How far (m) to the side of the free-kick camera's line (behind the ball, along ball-goal) everyone
 * but the taker stands. The camera sits ~7 m back and ~2.8 m up; this also keeps the ±30° cone behind
 * the ball clear out to FK_LENS_CONE_DEPTH (6 m x tan 30° = 3.5 m < this).
 */
export const FK_LENS_CLEAR = 4.5;
/** Depth (m) behind the ball of the ±30° cone that is kept clear for the free-kick camera. */
export const FK_LENS_CONE_DEPTH = 6;
/** The second man over a direct free kick: this far ahead of the ball and to its side (m). */
const FK_DECOY_AHEAD = 0.9;
const FK_DECOY_SIDE = 1.6;

/**
 * A point moved off the camera's line of sight on a direct free kick: anywhere from level with the ball
 * to 12 m behind it (the lens sits ~7 m back on the ball-goal line), at least FK_LENS_CLEAR (plus a
 * little) to the side of that line, keeping to the side it was on (`near` when it's right on it).
 */
export function clearOfLens(r: { x: number; z: number }, gx: number, pt: { x: number; z: number }, near: number): { x: number; z: number } {
  const dg = Math.max(1, dist2(r.x, r.z, gx, 0));
  const ux = (gx - r.x) / dg;
  const uz = -r.z / dg;
  const along = (pt.x - r.x) * ux + (pt.z - r.z) * uz;
  const lat = (pt.x - r.x) * -uz + (pt.z - r.z) * ux;
  const need = FK_LENS_CLEAR + 0.2;
  if (along > 0.5 || along < -12 || Math.abs(lat) >= need) return pt;
  const s = Math.sign(lat) || near;
  const nl = s * need;
  return { x: clamp(r.x + ux * along - uz * nl, -HALF_L + 1, HALF_L - 1), z: clamp(r.z + uz * along + ux * nl, -HALF_W + 1, HALF_W - 1) };
}

/**
 * Where a corner or wide free kick is whipped in: the zone one of the box runners is attacking
 * (corners: mostly the near- or far-post zone, ~5 m out), or the runner himself on a free kick.
 * `nearPost` picks the near-post runner (a driven delivery). `dir` (a human's aimed delivery): the
 * runner whose zone lies nearest the line of the aim (the nearer one on a tie), the near-post runner
 * when nobody's zone is within DRIVEN_AIM_LANE m of it.
 */
export function setPieceAim(m: Match, t: Player, nearPost = false, dir?: { x: number; z: number }): { x: number; z: number; target: number } {
  const brain = m.brains[t.side];
  setPieceTargets(m, t.side);
  const ad = m.attackDir(t.side);
  let best = -1;
  let bs = -Infinity;
  let aim = { x: ad * (HALF_L - 6), z: 0 };
  const zoneOf = (idx: number) => brain.spZones.get(idx) ?? brain.spTargets.get(idx) ?? m.players[idx].pos;
  const dl = dir ? Math.hypot(dir.x, dir.z) : 0;
  if (dir && dl > 0.1) {
    const ux = dir.x / dl;
    const uz = dir.z / dl;
    let bestOff = Infinity;
    brain.spRunners.forEach((idx) => {
      if (m.players[idx].sentOff) return;
      const zone = zoneOf(idx);
      const vx = zone.x - t.pos.x;
      const vz = zone.z - t.pos.z;
      const along = vx * ux + vz * uz;
      if (along < 3) return;
      const off = Math.abs(vx * uz - vz * ux) + along * 0.05;
      if (off < bestOff) {
        bestOff = off;
        best = idx;
        aim = { x: zone.x, z: zone.z };
      }
    });
    if (bestOff > DRIVEN_AIM_LANE) best = -1;
  }
  if (best < 0) {
    brain.spRunners.forEach((idx, i) => {
      const p = m.players[idx];
      if (p.sentOff) return;
      const zone = zoneOf(idx);
      // (`nearPost`: a driven corner, whipped at the near-post runner.)
      const prio = nearPost ? (i === 0 ? 9 : i === 4 ? 1 : 0) : i < 2 ? 1.6 : i === 2 ? 0.5 : 0;
      const open = Math.min(4, nearestOpp(m, t.side, p.pos.x, p.pos.z).d);
      const s = prio + open * 0.35 + m.rng.next() * 2.2;
      if (s > bs) {
        bs = s;
        best = idx;
        aim = { x: zone.x, z: zone.z };
      }
    });
  }
  // (A driven ball, whipped in flat and fast, is harder to put on a sixpence.)
  const spread = nearPost ? DRIVEN_SPREAD : 0.6;
  return { x: aim.x + m.rng.gauss() * spread, z: aim.z + m.rng.gauss() * spread, target: best };
}

/** Error (sd, m) in where a driven set-piece delivery arrives (was 0.95: a third of them missed the runner). */
const DRIVEN_SPREAD = 0.7;
/** A human's aimed driven delivery goes to the runner whose zone is within this (m) of the aim line. */
const DRIVEN_AIM_LANE = 4;

/** A corner runner, once the ball is struck: time the run, then attack the assigned zone. */
function setPieceRun(m: Match, p: Player): { x: number; z: number } | null {
  if (m.setPieceKick !== m.kickId || m.sinceKick > 2.4 || m.kickSide !== p.side) return null;
  const brain = m.brains[p.side];
  const zone = brain.spZones.get(p.idx);
  if (!zone) return null;
  if (m.sinceKick < 0.3) return brain.spTargets.get(p.idx) ?? zone;
  return zone;
}

/** Positions during set pieces and kick-offs. */
function restartPosition(m: Match, p: Player, side: Side): void {
  const r = m.restart;
  const ad = m.attackDir(side);
  if (m.phase === 'kickoff') {
    p.wantX = p.wantZ = 0;
    p.faceTarget = ad > 0 ? 0 : Math.PI;
    return;
  }
  if (!r) return;
  if (r.taker === p.idx) {
    // Walk over to the ball while it's dead; the match stands them over it for the kick, facing
    // the way it was set up (Match.beginRestart).
    if (m.phase === 'out') moveTo(p, r.x, r.z, 0.6);
    else {
      p.wantX = p.wantZ = 0;
      p.faceTarget = null;
    }
    return;
  }
  const attacking = r.side === side;
  if (r.kind === 'penalty') {
    const w = penaltyWaitSpot(m, p);
    moveTo(p, w.x, w.z, 0.9, { x: r.x, z: r.z });
    return;
  }
  const sp = setPieceTargets(m, side).get(p.idx);
  if (sp) {
    moveTo(p, sp.x, sp.z, 1, { x: r.x, z: r.z });
    return;
  }
  const t = shapeTarget(m, p, attacking, r.x, r.z);
  if (r.kind === 'freekick' && !attacking && dist2(t.x, t.z, r.x, r.z) < WALL_DIST) {
    // Ten yards back.
    const d = Math.max(0.1, dist2(t.x, t.z, r.x, r.z));
    t.x = r.x + ((t.x - r.x) / d) * WALL_DIST;
    t.z = clamp(r.z + ((t.z - r.z) / d) * WALL_DIST, -HALF_W + 1, HALF_W - 1);
  } else if (r.kind === 'goalkick' && !attacking) {
    const gx = ad * HALF_L; // the goal kick is at the goal we attack
    if (Math.abs(t.x - gx) < BOX_DEPTH + 2) t.x = gx - ad * (BOX_DEPTH + 2);
  }
  moveTo(p, t.x, t.z, 0.8, { x: r.x, z: r.z });
}

/** Where an outfielder waits while a penalty is taken: his shape position, outside the area and arc. */
export function penaltyWaitSpot(m: Match, p: Player): { x: number; z: number } {
  const r = m.restart;
  if (!r) return { x: p.pos.x, z: p.pos.z };
  const t = shapeTarget(m, p, p.side === r.side, r.x, r.z);
  // Line up on the edge of the area rather than all on one point.
  t.z = clamp(t.z + (p.slot - 5) * 0.8, -HALF_W + 1, HALF_W - 1);
  return clearOfPenalty(m, r, t.x, t.z, 0.9);
}

/** How many of the attacking set-piece runners are already in position (for the AI taker). */
export function setPieceReady(m: Match, side: Side): number {
  const brain = m.brains[side];
  const t = setPieceTargets(m, side);
  let n = 0;
  for (const idx of brain.spRunners) {
    const pt = t.get(idx);
    const p = m.players[idx];
    if (pt && dist2(p.pos.x, p.pos.z, pt.x, pt.z) < 2.5) n++;
  }
  return n;
}
