import { clamp, dist2, pointSegDist } from '../core/math';
import { interceptRisk, laneRisk, passSpeed, shotBlockers, shotQuality, throughSpeed } from './actions';
import { ACCEL, BOX_DEPTH, BOX_W, GOAL_W, HALF_L, HALF_W, WALL_DIST } from './constants';
import { clearOfPenalty, freeKickWall, inOwnBox, isDirectFreeKick, updateKeeper } from './keeper';
import type { Match } from './match';
import type { Player } from './player';
import type { Side } from './types';

/**
 * Team brain. Roles are re-assigned ~8x a second; each player then acts on its role every tick.
 *
 * Out of possession: one presser jockeys goal-side and only commits to a tackle now and then,
 * a second man covers behind him, defenders hold a line and mark goal-side in their zone.
 * In possession: two support options, runners in behind, full-back overlaps, width from the
 * wide men and box runs when the ball is out wide. The carrier weighs every option by a simple
 * expected-threat model (see `threat`) with difficulty-scaled noise.
 */
export interface TeamBrain {
  think: number;
  chaser: number;
  presser: number;
  cover: number;
  supporter: number;
  supportX: number;
  supportZ: number;
  supportT: number;
  supporter2: number;
  support2X: number;
  support2Z: number;
  marks: Map<number, number>; // our player idx -> opponent idx
  overlap: number;
  overlapT: number;
  /** Our back line in our own normalised frame (-1 = our goal line). */
  line: number;
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
}

export function makeBrain(): TeamBrain {
  return {
    think: 0, chaser: -1, presser: -1, cover: -1,
    supporter: -1, supportX: 0, supportZ: 0, supportT: 0,
    supporter2: -1, support2X: 0, support2Z: 0,
    marks: new Map(), overlap: -1, overlapT: 0, line: -0.5, boxZones: new Map(),
    spFor: null, spTaker: -1, spTargets: new Map(), spRunners: [], spZones: new Map(), spWall: [],
  };
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

/** Where the ball can be reached soonest by `p`, from the match's predicted ball path. */
export function intercept(m: Match, p: Player): { x: number; z: number; t: number } {
  const path = m.ballPath;
  const top = p.top * 0.92;
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    if (s.y > (p.isKeeper ? 2.6 : 2.1)) continue;
    const d = Math.max(0, dist2(p.pos.x, p.pos.z, s.x, s.z) - 0.55);
    const need = d / top + 0.12;
    if (need <= s.t) return { x: s.x, z: s.z, t: s.t };
  }
  const last = path[path.length - 1];
  const d = dist2(p.pos.x, p.pos.z, last.x, last.z);
  return { x: last.x, z: last.z, t: Math.max(last.t, d / top) };
}

function moveTo(p: Player, x: number, z: number, urgency: number, faceBall?: { x: number; z: number }): void {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.35) {
    p.wantX = p.wantZ = 0;
    p.sprint = false;
  } else {
    const f = Math.min(1, d / 2.2);
    p.wantX = (dx / d) * f;
    p.wantZ = (dz / d) * f;
    p.sprint = urgency > 0.7 || d > 9 + (1 - urgency) * 8;
  }
  if (faceBall && d < 2.5) p.faceTarget = Math.atan2(faceBall.z - p.pos.z, faceBall.x - p.pos.x);
  else p.faceTarget = null;
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

/** Defensive block position: a back line, a midfield screen in front of it, forwards up. */
function defendHome(m: Match, p: Player, brain: TeamBrain, refX: number, refZ: number): { x: number; z: number } {
  const ad = m.attackDir(p.side);
  const slot = slotOf(m, p);
  const bx = (refX * ad) / HALF_L;
  const bz = (refZ * ad) / HALF_W;
  let x: number;
  let z: number;
  if (p.role === 'DF') {
    x = brain.line + (Math.abs(slot.z) >= 0.5 ? 0.015 : 0);
    z = slot.z * 0.64 + bz * 0.3;
  } else if (p.role === 'MF') {
    // A screen between the back line and the ball, leaving room in front of it.
    const screen = brain.line + Math.max(0.14, (bx - brain.line) * 0.5);
    x = Math.min(screen + (slot.x + 0.3) * 0.25, bx - 0.06);
    z = slot.z * 0.68 + bz * 0.36;
  } else {
    x = Math.max(-0.14, slot.x * 0.5 + bx * 0.45 + 0.04 + m.mentality[p.side] * 0.06);
    z = slot.z * 0.75 + bz * 0.3;
  }
  x = clamp(x, -0.9, 0.6);
  z = clamp(z, -0.9, 0.9);
  return { x: x * HALF_L * ad, z: z * HALF_W * ad };
}

// ------------------------------------------------------------------ role assignment

function assignRoles(m: Match, side: Side, brain: TeamBrain): void {
  const team = m.teamPlayers(side);
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  brain.chaser = -1;
  brain.presser = -1;
  brain.cover = -1;
  brain.marks.clear();
  // The line steps up with the ball but sits off it, drops to around the penalty spot as the
  // ball comes towards the box, and tracks it inside once it's right on top of it. (Deeper than a
  // no-offside line: with the law on, the space in behind is what attackers have to earn.)
  const bxN = nX(m, side, ball.pos.x);
  brain.line = bxN < -0.72 ? Math.max(-0.88, bxN - 0.1) : clamp(bxN - 0.5, -0.82, -0.12);
  // Mentality: attacking sides hold a higher line, defensive ones sit deeper.
  const ment = m.mentality[side];
  if (ment !== 0 && bxN >= -0.7) brain.line = clamp(brain.line + ment * 0.08, -0.86, 0.02);
  if (owner && ball.held) return;
  const flight = !owner && m.passTarget >= 0 ? m.players[m.passTarget] : null;

  if (!owner) {
    if (flight && flight.side === side) return; // our receiver goes to meet it
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
        pickPresser(m, side, brain, flight);
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
  if (human && human.s < first.s + 4) {
    // The human is on it; the nearest AI teammate covers.
    const next = ranked.find((r) => r.p !== human.p);
    if (next && next.s < 18) brain.cover = next.p.idx;
  } else {
    brain.presser = first.p.idx;
    const next = ranked.find((r) => r.p !== first.p && !m.isHumanControlled(r.p));
    if (next && next.s < 18) brain.cover = next.p.idx;
  }
}

/** Zonal marking: each defender / midfielder takes the most dangerous opponent near their zone. */
function assignMarks(m: Match, side: Side, brain: TeamBrain, c: Player): void {
  const ad = m.attackDir(side);
  const gx = -ad * HALF_L;
  const ball = m.ball;
  const opps = m.teamPlayers(other(side)).filter((o) => !o.isKeeper && o !== c && !o.sentOff);
  const taken = new Set<number>();
  const order = m
    .teamPlayers(side)
    .filter((p) => !p.isKeeper && !p.sentOff && p.role !== 'FW' && p.idx !== brain.presser && p.idx !== brain.cover)
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
    brain.think = 0.12;
  }
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  const flight = m.passTarget >= 0 && !owner ? m.players[m.passTarget] : null;
  const focus = owner ?? flight;
  const weHave = focus ? focus.side === side : false;
  const theyHave = focus ? focus.side !== side : false;
  const live = m.phase === 'play';

  if (live && weHave && focus) organiseAttack(m, side, focus, brain, dt);
  else {
    brain.boxZones.clear();
    brain.overlap = -1;
    brain.supporter = -1;
    brain.supporter2 = -1;
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
    const run = !owner ? setPieceRun(m, p) : null;
    if (run) {
      moveTo(p, run.x, run.z, 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }
    if (theyHave && focus) {
      defend(m, p, brain, focus, dt);
      continue;
    }
    if (weHave && focus) {
      const t = attackTarget(m, p, brain, focus);
      moveTo(p, t.x, t.z, t.u, ball.pos);
      continue;
    }
    // Loose ball: hold the shape of whoever had it last.
    if (m.possessionSide === side) {
      const t = attackTarget(m, p, brain, p);
      moveTo(p, t.x, t.z, 0.45, ball.pos);
    } else {
      const home = defendHome(m, p, brain, ball.pos.x, ball.pos.z);
      moveTo(p, home.x, home.z, 0.55, ball.pos);
    }
  }
}

// ------------------------------------------------------------------ attacking organisation

function organiseAttack(m: Match, side: Side, c: Player, brain: TeamBrain, dt: number): void {
  const ad = m.attackDir(side);
  const gx = ad * HALF_L;
  const b = m.ball.pos;
  const team = m.teamPlayers(side);
  const cN = nX(m, side, c.pos.x);
  const free = (p: Player) => !p.isKeeper && !p.sentOff && p !== c && p.state === 'move' && !m.isHumanControlled(p);

  // ---- Box runs when the ball is out wide in the final third (or a cross is in the air).
  brain.boxZones.clear();
  const wideFinal = Math.abs(c.pos.z) > HALF_W * 0.36 && cN > 0.4;
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
      let bd = 30;
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
  if (brain.overlap < 0 && cN > 0.02 && cN < 0.75 && isWide(m, c) && c.role !== 'DF' && m.rng.chance(dt * 0.4 * (1 + m.mentality[c.side] * 0.6))) {
    const sgn = Math.sign(slotOf(m, c).z);
    for (const p of team) {
      if (!free(p) || p.role !== 'DF' || !isWide(m, p) || Math.sign(slotOf(m, p).z) !== sgn) continue;
      if (nX(m, side, p.pos.x) < cN) {
        brain.overlap = p.idx;
        brain.overlapT = 3.4;
      }
    }
  }

  // ---- Two support options: one short angle, one forward diagonal.
  brain.supportT -= dt;
  if (brain.supportT > 0 && brain.supporter >= 0) return;
  brain.supportT = 0.5;
  const avail = team
    .filter((p) => free(p) && !brain.boxZones.has(p.idx) && brain.overlap !== p.idx && !p.running)
    .map((p) => ({ p, d: dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) }))
    .sort((a, b2) => a.d - b2.d);
  brain.supporter = avail[0]?.p.idx ?? -1;
  brain.supporter2 = avail[1]?.p.idx ?? -1;
  const base = ad > 0 ? 0 : Math.PI;
  const pick = (angs: number[], r: number, mate: Player | undefined, into: 1 | 2) => {
    if (!mate) return;
    let bestS = Infinity;
    for (const ang of angs) {
      const a = base + ang;
      const x = clamp(c.pos.x + Math.cos(a) * r, -HALF_L + 3, HALF_L - 4);
      const z = clamp(c.pos.z + Math.sin(a) * r, -HALF_W + 2.5, HALF_W - 2.5);
      let crowd = 0;
      for (const t of team) if (t !== mate && t !== c && !t.sentOff && dist2(t.pos.x, t.pos.z, x, z) < 6) crowd += 0.25;
      const open = nearestOpp(m, side, x, z).d;
      const s = laneRisk(m, side, c.pos.x, c.pos.z, x, z) * 1.3 + (open < 3 ? 0.35 : 0) + crowd +
        dist2(mate.pos.x, mate.pos.z, x, z) * 0.02 - Math.cos(ang) * 0.12;
      if (s < bestS) {
        bestS = s;
        if (into === 1) {
          brain.supportX = x;
          brain.supportZ = z;
        } else {
          brain.support2X = x;
          brain.support2Z = z;
        }
      }
    }
  };
  pick([-2.3, -1.6, -1.0, 1.0, 1.6, 2.3], 10, avail[0]?.p, 1);
  pick([-0.95, -0.5, 0.5, 0.95], 16, avail[1]?.p, 2);
}

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
  const chance = (p.role === 'FW' ? 0.6 : isWide(m, p) ? 0.38 : 0.2) * (1 + ment * 0.45);
  if (pr > 2.2 && facingFwd && n > line - 0.32 && line < 0.8 && m.rng.chance(chance)) {
    p.running = true;
    p.runCued = false;
    p.runT = 2.1 + m.rng.next() * 0.9;
  } else {
    p.runT = 0.7 + m.rng.next() * 1.8;
  }
}

function attackTarget(m: Match, p: Player, brain: TeamBrain, c: Player): { x: number; z: number; u: number } {
  const side = p.side;
  const ad = m.attackDir(side);
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
  if (brain.supporter === p.idx || brain.supporter2 === p.idx) {
    const one = brain.supporter === p.idx;
    let sx = one ? brain.supportX : brain.support2X;
    const sz = one ? brain.supportZ : brain.support2Z;
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
  let u = 0.45;
  if (brain.overlap === p.idx) {
    x = Math.min(nX(m, side, c.pos.x) + 0.18, 0.86);
    z = Math.sign(slot.z) * 0.88;
    u = 0.95;
  } else if (p.role !== 'DF') {
    if (p.running) {
      x = Math.min(line + 0.22, 0.9);
      z *= 0.55; // attack the channel between centre-back and full-back
      u = 0.95;
    } else if (m.offside) {
      // Stay on the last man (level is onside), ready to spin in behind; if stranded, drop back.
      x = Math.min(x, line - 0.01);
      if (stranded) {
        x = Math.min(x, nX(m, side, p.pos.x) - 0.08);
        u = 0.95;
      }
    } else {
      x = Math.min(x, line - 0.015);
    }
  }
  x = clamp(x, -0.9, 0.92);
  z = clamp(z, -0.92, 0.92);
  return { x: x * HALF_L * ad, z: z * HALF_W * ad, u };
}

// ------------------------------------------------------------------ defending

function defend(m: Match, p: Player, brain: TeamBrain, c: Player, dt: number): void {
  const ad = m.attackDir(p.side);
  const gx = -ad * HALF_L;
  const ball = m.ball.pos;
  if (brain.presser === p.idx) {
    press(m, p, c, dt, brain);
    return;
  }
  if (brain.cover === p.idx) {
    if (m.ball.owner === c.idx) chaseSlide(m, p, c, dt);
    if (p.state !== 'move') return;
    // Second defender: goal-side of the carrier, a few metres behind the challenge.
    const ux = gx - c.pos.x;
    const uz = -c.pos.z * 0.7;
    const ul = Math.hypot(ux, uz) || 1;
    const back = Math.min(5.5, ul * 0.5);
    moveTo(p, c.pos.x + (ux / ul) * back + c.vel.x * 0.3, c.pos.z + (uz / ul) * back + c.vel.z * 0.3, 0.75, ball);
    return;
  }
  const home = defendHome(m, p, brain, ball.x, ball.z);
  const mark = brain.marks.get(p.idx);
  if (mark === undefined) {
    moveTo(p, home.x, home.z, 0.5, ball);
    return;
  }
  const o = m.players[mark];
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
  moveTo(p, tx, tz, running ? 0.85 : 0.55, ball);
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
  // Jockey goal-side, then commit to a tackle now and then: more often when the ball is
  // exposed, when the carrier has their back to goal, and when a teammate is covering.
  let commit = p.commitT > 0;
  if (hasBall && d < 3.2) p.jockeyT += dt;
  if (commit) p.commitT -= dt;
  else if (hasBall && d < 2.7 && p.tackleCooldown <= 0) {
    const exposed = dist2(b.x, b.z, c.pos.x, c.pos.z) > 0.8 ? 2.2 : 1;
    const backToGoal = Math.cos(c.facing) * ad > 0.3 ? 1.5 : 1;
    const covered = brain.cover >= 0 ? 1.3 : 0.8;
    const box = inOwnBox(m, p.side, c.pos.x, c.pos.z) ? 0.7 : 1;
    // Don't shadow forever: the longer we've jockeyed, the likelier we go in (~2.5/s after 1.2 s).
    const ramp = clamp((p.jockeyT - 0.5) / 0.7, 0, 1) * 2.2;
    const rate = ((0.3 + skill * 0.09) * exposed * backToGoal * covered + ramp) * box * (1 + m.mentality[p.side] * 0.25);
    if (m.rng.chance(rate * dt)) {
      p.commitT = 0.55;
      commit = true;
    }
  }
  // The jockeying gap is measured from the ball so the presser's foot isn't already on it.
  const gap = commit ? 0.1 : clamp(1.95 + (c.speed() > 5 ? 0.45 : 0) - skill * 0.06, 1.6, 2.5);
  const jx = b.x + c.vel.x * 0.28 + (ux / ul) * gap;
  const jz = b.z + c.vel.z * 0.28 + (uz / ul) * gap;
  moveTo(p, jx, jz, 1, b);
  if (d < 3.2) p.faceTarget = Math.atan2(b.z - p.pos.z, b.x - p.pos.x);
  p.sprint = d > 2.6 || commit;
  const aggression = 0.62 + skill * 0.09;
  const footD = dist2(p.footX(), p.footZ(), b.x, b.z);
  if (commit && hasBall && p.tackleCooldown <= 0 && footD < 1.15) {
    m.tryTackle(p, c, aggression);
    p.commitT = 0;
    p.jockeyT = 0;
  } else if (hasBall && p.tackleCooldown <= 0 && p.slowT <= 0 && footD < 0.95 && dist2(b.x, b.z, c.pos.x, c.pos.z) > 0.95) {
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
  if (b.owner !== c.idx || b.held || p.state !== 'move' || p.tackleCooldown > 0 || p.slowT > 0) return;
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
  if (inOwnBox(m, p.side, c.pos.x, c.pos.z)) rate *= 0.6;
  // Only a reckless defender slides when the carrier's body is between him and the ball.
  const bx = b.pos.x + c.vel.x * 0.18;
  const bz = b.pos.z + c.vel.z * 0.18;
  if (pointSegDist(c.pos.x, c.pos.z, p.pos.x, p.pos.z, bx, bz).d < 0.55) rate *= 0.3;
  if (!m.rng.chance(rate * dt)) return;
  p.facing = Math.atan2(bz - p.pos.z, bx - p.pos.x);
  m.startSlide(p);
}

/**
 * Base rate (per second) of slide attempts while chasing an escaping carrier. A defender is only in
 * that position ~12 s a match, so this lands at ~3-4 slides a match.
 */
const SLIDE_RATE = 0.45;

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
  const q = shotQuality(p.pos.x, p.pos.z, ad);
  const ownGoalDist = dist2(p.pos.x, p.pos.z, -ad * HALF_L, 0);
  let rival = Infinity;
  for (const o of m.players) {
    if (o.side !== p.side && !o.sentOff) rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
  }
  if (b.pos.y > 1.15 && b.pos.y < 3) {
    // From a tight angle, nod it down to a better-placed teammate instead of forcing it.
    let lay: Player | null = null;
    if (q < 0.22 && ownGoalDist > 40) {
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
    } else if (q > 0.12) {
      m.order(p, 'header', 0, 0, 0.75, -1, true);
    } else if (ownGoalDist < 30 && rival < 5) {
      const gxOwn = -ad * HALF_L;
      if (ownGoalDist < 22 && rival < 5 && m.rng.chance(rival < 1.6 ? 0.8 : 0.66)) {
        // Under real pressure near goal: glance it behind for a corner rather than risk it.
        const z = Math.sign(p.pos.z || 1) * (6 + m.rng.next() * 8);
        m.order(p, 'header', -ad, 0, 1, -1, true, { x: gxOwn - ad * 3, z });
      } else {
        // Head it clear, out towards the wing (from out there, into touch).
        const z = clamp(p.pos.z * 0.4 + Math.sign(p.pos.z || 1) * 20, -HALF_W - 3, HALF_W + 3);
        m.order(p, 'header', ad, 0, 1, -1, true, { x: p.pos.x + ad * 20, z });
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
  if (b.hspeed() > 5 && q > 0.2) {
    p.volleyKick = m.kickId;
    if (m.rng.chance(clamp(q * 1.1, 0.25, 0.75))) m.order(p, 'shot', 0, 0, 0.75, -1, true);
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

/** Lateral offsets (m) tried for a through ball, around the runner's own line. */
const THREAD_OFFSETS = [0, -3.5, 3.5, -7, 7];

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
  const squeezed = near.d < 1.4 && p.aiMode === 'dribble' && p.aiT > 0.1 && p.ballT > 0.3;
  if (!firstTouch && p.aiT > 0 && !squeezed) {
    if (p.aiMode === 'shield' && near.o && near.d < 3.5) shield(m, p, near.o);
    else dribble(m, p, p.aiDirX, p.aiDirZ);
    return;
  }
  p.aiT = firstTouch ? 0.32 + m.rng.next() * 0.3 - skill * 0.03 : 0.24 + m.rng.next() * 0.2 - skill * 0.015;
  if (firstTouch) p.holdT = 1.1 + m.rng.next() * 1.5;

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

  // ---- Shoot
  if (dg < 36) {
    let q = shotQuality(p.pos.x, p.pos.z, ad);
    const blockers = shotBlockers(m, p);
    q *= Math.pow(0.55, blockers);
    const k = m.keeperOf(opp);
    if (k && dist2(k.pos.x, k.pos.z, gx, 0) > 6) q *= 1.3;
    q *= 1 - pressure * 0.15;
    // A clean strike also earns rebounds and corners, and shooters love a sight of goal.
    const bonus = blockers < 0.5 ? (dg < 28 ? 0.035 : 0.015) : 0;
    const s = early(q * 2 + bonus + (inBox ? 0.12 : 0) - (dg > 22 ? 0.016 : 0), 0.05);
    const power = clamp(0.55 + dg / 45, 0.6, 0.97);
    choices.push({ s, run: () => m.order(p, 'shot', 0, 0, power, -1, false) });
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
      const gain = threat(m, side, lx, lz) * (t.isKeeper ? 0.3 : 1) * (0.72 + 0.28 * room);
      const s = early(pc * gain - (1 - pc) * lose((p.pos.x + lx) / 2, (p.pos.z + lz) / 2), 0.6) -
        (d < 9 && pressure < 0.3 ? 0.004 : 0);
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
        const gain = threat(m, side, ax, az) + 0.02;
        const ir = interceptRisk(m, side, p.pos.x, p.pos.z, ax, az, throughSpeed(dT));
        const pc = pWin * (1 - ir);
        const sg = early(pc * gain - (1 - pc) * lose(ax, az) * 0.6, 0.35);
        if (!bestG || sg > bestG.s) {
          bestG = { s: sg, run: () => m.order(p, 'through', 0, 0, 0.7, t.idx, false, { x: ax, z: az }) };
        }
        // Over the top when the ground lane is shut and the runner is on the shoulder of the
        // last man: only the race to the landing spot matters, but it's harder to weight.
        if (dT > 16 && dT < 42 && ir > 0.4 && onShoulder) {
          const pl = pWin * 0.62 * (0.8 + p.stat.passing / 700);
          const sl = early(pl * gain - (1 - pl) * lose(ax, az) * 0.6, 0.5);
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
  if (Math.abs(p.pos.z) > HALF_W * 0.36 && pN > 0.42) {
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
      const s = early(pWin * (0.03 + hq * 0.42) - (1 - pWin) * 0.02, 0.3);
      choices.push({ s, run: () => m.order(p, 'lob', zn.x - p.pos.x, zn.z - p.pos.z, 0.75, who, false, { x: zn.x, z: zn.z }) });
    }
  }

  // ---- Clear it when trapped deep in our own third: from out wide, up the line and into touch
  // (safe, and the throw is deep in their half); from the middle, towards the wing.
  if (pN < -0.35 && pressure > 0.5) {
    const wide = Math.abs(p.pos.z) > HALF_W * 0.35;
    const tz = Math.sign(p.pos.z || 1) * (wide ? HALF_W + 4 : HALF_W - 1.5);
    const tx = p.pos.x + ad * (wide ? 30 : 38);
    choices.push({ s: -0.004 + (pN < -0.6 ? 0.006 : 0) + (wide ? 0.002 : 0), run: () => m.order(p, 'clear', ad, 0, 1, -1, false, { x: tx, z: tz }) });
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
    const hold = clamp(1 - p.ballT / 2, 0, 1);
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
            p.aiT = 0.55;
            // A human defender can read it a little better than the AI.
            if (m.rng.chance(pWin * (m.isHumanControlled(o) ? 0.75 : 1))) {
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
  best?.run();
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
 * Set-piece shapes. Corners: five runners start in a pack between the spot and the six-yard box
 * and attack the near post, far post, spot, back post and front post as the kick is struck; two
 * on the edge, two at the back. Wide free kicks: the runners hold the line. Defenders: a man
 * goal-side of each box attacker, a post guard (or a two-man wall), the edge, two up. Direct free
 * kicks: see `directFreeKickShape`.
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
    ? [[10.5, 3.2 * s0], [11.5, -2.2 * s0], [13, 0.6 * s0], [12, -6 * s0], [9, 6.5 * s0]]
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
  // Defending: goal-side of each box zone, a post guard or short wall, the edge, two up top.
  const defs = m.teamPlayers(side).filter((p) => !p.isKeeper && !p.sentOff);
  const dprio = (p: Player) => (p.role === 'DF' ? 0 : p.role === 'MF' ? 1 : 2);
  defs.sort((a, b) => dprio(a) - dprio(b) || a.slot - b.slot);
  const marks = boxPts.map((pt) => ({ x: pt.x + adA * 0.9, z: pt.z * 0.92 }));
  let extra: { x: number; z: number }[];
  if (corner) {
    extra = [P(1.2, 3.1 * s0)];
  } else {
    const dg = Math.max(1, dist2(r.x, r.z, gx, 0));
    const ux = (gx - r.x) / dg;
    const uz = -r.z / dg;
    extra = [-0.45, 0.45].map((o) => ({ x: r.x + ux * WALL_DIST - uz * o, z: r.z + uz * WALL_DIST + ux * o }));
  }
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

/** Corner delivery zones (distance out, z) in runner order: near post, far post, spot, back post, front. */
function cornerZones(s0: number): [number, number][] {
  return [[5, 2.5 * s0], [5.5, -3.5 * s0], [9.5, -0.4 * s0], [7.5, -6 * s0], [4, 5.5 * s0]];
}

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
    // The second man over the ball stands well to the side of it: the set-piece camera looks along the
    // ball-goal line from ~9.5 m behind the ball, so nobody may stand on that line (see clearOfLens).
    const decoy = { x: r.x - ux * 0.6 - uz * near * FK_LENS_CLEAR * 1.15, z: r.z - uz * 0.6 + ux * near * FK_LENS_CLEAR * 1.15 };
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
}

/** How far (m) to the side of the free-kick camera's line (behind the ball, along ball-goal) teammates stand. */
export const FK_LENS_CLEAR = 2.5;

/**
 * A point moved off the camera's line of sight on a direct free kick: anywhere from level with the ball
 * to 12 m behind it (the lens sits ~9.5 m back on the ball-goal line), at least FK_LENS_CLEAR (plus a
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
 * `nearPost` picks the near-post runner (a driven delivery).
 */
export function setPieceAim(m: Match, t: Player, nearPost = false): { x: number; z: number; target: number } {
  const brain = m.brains[t.side];
  setPieceTargets(m, t.side);
  const ad = m.attackDir(t.side);
  let best = -1;
  let bs = -Infinity;
  let aim = { x: ad * (HALF_L - 6), z: 0 };
  brain.spRunners.forEach((idx, i) => {
    const p = m.players[idx];
    if (p.sentOff) return;
    const zone = brain.spZones.get(idx) ?? brain.spTargets.get(idx) ?? p.pos;
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
  return { x: aim.x + m.rng.gauss() * 0.6, z: aim.z + m.rng.gauss() * 0.6, target: best };
}

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
