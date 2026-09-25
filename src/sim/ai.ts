import { clamp, dist2 } from '../core/math';
import { laneRisk, shotQuality } from './actions';
import { BOX_DEPTH, BOX_W, HALF_L, HALF_W } from './constants';
import { updateKeeper } from './keeper';
import type { Match } from './match';
import type { Player } from './player';
import type { Side } from './types';

export interface TeamBrain {
  think: number;
  chaser: number;
  presser: number;
  cover: number;
  supporter: number;
  supportX: number;
  supportZ: number;
  supportT: number;
  marks: Map<number, number>; // our player idx -> opponent idx
}

export function makeBrain(): TeamBrain {
  return {
    think: 0, chaser: -1, presser: -1, cover: -1, supporter: -1,
    supportX: 0, supportZ: 0, supportT: 0, marks: new Map(),
  };
}

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

/** Formation position given the reference ball point, in world space. */
export function shapeTarget(m: Match, p: Player, attacking: boolean, refX: number, refZ: number): { x: number; z: number } {
  const ad = m.attackDir(p.side);
  const slot = m.slots[p.side][p.slot];
  const bx = (refX * ad) / HALF_L;
  const bz = (refZ * ad) / HALF_W;
  let x: number;
  let z: number;
  if (attacking) {
    x = slot.x * 0.74 + bx * 0.5 + 0.3;
    z = slot.z * 1.1 + bz * 0.2;
    if (p.role === 'DF') x = Math.min(x, 0.32);
  } else {
    x = slot.x * 0.66 + bx * 0.46 - 0.14;
    z = slot.z * 0.7 + bz * 0.36;
    if (p.role === 'DF') x = Math.min(x, bx - 0.04);
    if (p.role === 'FW') x = Math.max(x, -0.12);
  }
  // Forwards hang on the last defender instead of camping offside.
  if (attacking && p.role !== 'DF') {
    const line = m.defLine(p.side === 0 ? 1 : 0); // in our frame
    const cap = p.running ? line + 0.16 : line - 0.02;
    x = Math.min(x, cap);
  }
  x = clamp(x, -0.9, 0.93);
  z = clamp(z, -0.93, 0.93);
  return { x: x * HALF_L * ad, z: z * HALF_W * ad };
}

function assignRoles(m: Match, side: Side, brain: TeamBrain): void {
  const team = m.teamPlayers(side);
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  brain.chaser = -1;
  brain.presser = -1;
  brain.cover = -1;
  brain.marks.clear();

  // Chaser: whoever reaches the loose ball first (keeper only inside their box).
  if (!owner || ball.held) {
    let bestT = Infinity;
    for (const p of team) {
      if (p.isKeeper || !(p.state === 'move' || p.state === 'stand')) continue;
      const t = intercept(m, p).t + (m.isHumanControlled(p) ? 0.25 : 0);
      if (t < bestT) {
        bestT = t;
        brain.chaser = p.idx;
      }
    }
    return;
  }

  if (owner.side !== side) {
    // Presser: closest, preferring players already goal-side of the carrier.
    const ad = m.attackDir(side);
    const ranked = team
      .filter((p) => !p.isKeeper)
      .map((p) => {
        const d = dist2(p.pos.x, p.pos.z, owner.pos.x, owner.pos.z);
        const goalSide = (owner.pos.x - p.pos.x) * ad > 0 ? 0 : 3;
        return { p, s: d + goalSide };
      })
      .sort((a, b) => a.s - b.s);
    const human = ranked.find((r) => m.isHumanControlled(r.p));
    const first = ranked[0];
    if (first) {
      if (human && human.s < first.s + 4) {
        // The human is on it; the nearest AI teammate covers.
        const next = ranked.find((r) => r.p !== human.p);
        if (next && next.s < 18) brain.cover = next.p.idx;
      } else {
        brain.presser = first.p.idx;
        const next = ranked[1];
        if (next && next.s < 16 && !m.isHumanControlled(next.p)) brain.cover = next.p.idx;
      }
    }
    // Zonal marking: each outfielder takes the most dangerous opponent near their zone.
    const opps = m.teamPlayers(owner.side).filter((o) => !o.isKeeper && o !== owner);
    const taken = new Set<number>();
    const order = team
      .filter((p) => !p.isKeeper && p.idx !== brain.presser && p.idx !== brain.cover)
      .sort((a, b) => (a.role === 'DF' ? 0 : 1) - (b.role === 'DF' ? 0 : 1));
    const gx = -ad * HALF_L;
    for (const p of order) {
      const home = shapeTarget(m, p, false, ball.pos.x, ball.pos.z);
      let best = -1;
      let bestD = p.role === 'DF' ? 11 : 8;
      for (const o of opps) {
        if (taken.has(o.idx)) continue;
        const dz = dist2(home.x, home.z, o.pos.x, o.pos.z);
        const danger = dist2(o.pos.x, o.pos.z, gx, 0) / 40;
        if (dz + danger * 4 < bestD) {
          bestD = dz + danger * 4;
          best = o.idx;
        }
      }
      if (best >= 0) {
        taken.add(best);
        brain.marks.set(p.idx, best);
      }
    }
  }
}

export function updateTeamAI(m: Match, side: Side, dt: number): void {
  const brain = m.brains[side];
  brain.think -= dt;
  if (brain.think <= 0) {
    assignRoles(m, side, brain);
    brain.think = 0.12;
  }
  const ball = m.ball;
  const owner = ball.owner >= 0 ? m.players[ball.owner] : null;
  const flightTo = m.passTarget >= 0 && !owner ? m.players[m.passTarget].side : -1;
  const weHave = owner ? owner.side === side : flightTo === side;
  const theyHave = owner ? owner.side !== side : flightTo >= 0 && flightTo !== side;
  const ad = m.attackDir(side);

  for (const p of m.teamPlayers(side)) {
    if (p.isKeeper) {
      if (!m.isHumanControlled(p) || p.state === 'hold') updateKeeper(m, p, dt);
      continue;
    }
    if (m.isHumanControlled(p)) continue;
    if (p.state !== 'move') {
      p.wantX = p.wantZ = 0;
      continue;
    }

    // Run timers for forwards and attacking midfielders.
    if (p.role !== 'DF') {
      p.runT -= dt;
      if (p.runT <= 0) {
        p.running = !p.running && weHave && m.rng.chance(p.role === 'FW' ? 0.7 : 0.35);
        p.runT = p.running ? 2.4 : 2.5 + m.rng.next() * 4;
      }
      if (!weHave) p.running = false;
    }

    if (m.phase === 'restart' || m.phase === 'out' || m.phase === 'kickoff') {
      restartPosition(m, p, side);
      continue;
    }

    if (owner === p) {
      carrierAI(m, p, dt);
      continue;
    }

    // Receiving a pass: attack the ball.
    if (m.passTarget === p.idx && !owner) {
      const i = intercept(m, p);
      moveTo(p, i.x, i.z, 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }

    if (!owner && brain.chaser === p.idx) {
      const i = intercept(m, p);
      moveTo(p, i.x, i.z, 1, ball.pos);
      aerialOrVolley(m, p);
      continue;
    }

    if (theyHave && owner) {
      if (brain.presser === p.idx) {
        press(m, p, owner, dt);
        continue;
      }
      if (brain.cover === p.idx) {
        const gx = -ad * HALF_L;
        const ux = gx - owner.pos.x;
        const uz = -owner.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        moveTo(p, owner.pos.x + (ux / ul) * 5, owner.pos.z + (uz / ul) * 5, 0.7, ball.pos);
        continue;
      }
      const home = shapeTarget(m, p, false, ball.pos.x, ball.pos.z);
      const mark = brain.marks.get(p.idx);
      if (mark !== undefined) {
        const o = m.players[mark];
        const gx = -ad * HALF_L;
        const ux = gx - o.pos.x;
        const uz = -o.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        const k = p.role === 'DF' ? 0.72 : 0.55;
        const mx = o.pos.x + (ux / ul) * 1.7;
        const mz = o.pos.z + (uz / ul) * 1.7;
        moveTo(p, home.x + (mx - home.x) * k, home.z + (mz - home.z) * k, 0.55, ball.pos);
      } else {
        moveTo(p, home.x, home.z, 0.45, ball.pos);
      }
      continue;
    }

    if (weHave) {
      let t = shapeTarget(m, p, true, ball.pos.x, ball.pos.z);
      if (owner && brain.supporter === p.idx) {
        t = { x: brain.supportX, z: brain.supportZ };
      }
      moveTo(p, t.x, t.z, p.running ? 0.9 : 0.4, ball.pos);
      continue;
    }

    const home = shapeTarget(m, p, false, ball.pos.x, ball.pos.z);
    moveTo(p, home.x, home.z, 0.5, ball.pos);
  }

  if (owner && owner.side === side) updateSupport(m, side, owner, dt);
}

/** One teammate comes short to offer a safe angle to the carrier. */
function updateSupport(m: Match, side: Side, c: Player, dt: number): void {
  const brain = m.brains[side];
  brain.supportT -= dt;
  if (brain.supportT > 0 && brain.supporter >= 0) return;
  brain.supportT = 0.6;
  const ad = m.attackDir(side);
  let best = -1;
  let bestD = Infinity;
  for (const p of m.teamPlayers(side)) {
    if (p === c || p.isKeeper || m.isHumanControlled(p)) continue;
    const d = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
    if (d < bestD) {
      bestD = d;
      best = p.idx;
    }
  }
  brain.supporter = best;
  if (best < 0) return;
  let bestRisk = Infinity;
  for (const ang of [-2.2, -1.4, -0.7, 0.7, 1.4, 2.2]) {
    const base = ad > 0 ? 0 : Math.PI;
    const a = base + ang;
    const x = clamp(c.pos.x + Math.cos(a) * 9, -HALF_L + 3, HALF_L - 3);
    const z = clamp(c.pos.z + Math.sin(a) * 9, -HALF_W + 2, HALF_W - 2);
    const r = laneRisk(m, side, c.pos.x, c.pos.z, x, z) + Math.abs(ang) * 0.08;
    if (r < bestRisk) {
      bestRisk = r;
      brain.supportX = x;
      brain.supportZ = z;
    }
  }
}

function press(m: Match, p: Player, c: Player, dt: number): void {
  const ad = m.attackDir(p.side);
  const gx = -ad * HALF_L;
  const ux = gx - c.pos.x;
  const uz = -c.pos.z;
  const ul = Math.hypot(ux, uz) || 1;
  const d = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
  const skill = m.aiSkill(p.side);
  // Contain goal-side at a jockeying distance, then commit to a tackle now and then.
  const commit = p.aiT > 0;
  p.aiT -= dt;
  if (!commit && d < 2.4 && m.rng.chance(dt * (0.9 + skill * 0.25))) p.aiT = 0.7;
  const gap = commit ? 0.35 : d > 4 ? 1.6 : 1.45;
  const jx = c.pos.x + c.vel.x * 0.3 + (ux / ul) * gap;
  const jz = c.pos.z + c.vel.z * 0.3 + (uz / ul) * gap;
  moveTo(p, jx, jz, 1, m.ball.pos);
  if (d < 3) p.faceTarget = Math.atan2(m.ball.pos.z - p.pos.z, m.ball.pos.x - p.pos.x);
  p.sprint = d > 2.2 || commit;
  const aggression = 0.6 + skill * 0.1;
  if (commit && d < 1.35 && p.tackleCooldown <= 0) m.tryTackle(p, c, aggression);
  // Slide in when the carrier is about to escape.
  const away = (c.vel.x * (c.pos.x - p.pos.x) + c.vel.z * (c.pos.z - p.pos.z)) / Math.max(d, 0.1);
  if (d > 1.4 && d < 3 && away > 3 && m.rng.chance(dt * 0.35 * aggression)) {
    p.facing = Math.atan2(m.ball.pos.z - p.pos.z, m.ball.pos.x - p.pos.x);
    m.startSlide(p);
  }
}

/** AI first-time actions for balls in the air or arriving in the box. */
function aerialOrVolley(m: Match, p: Player): void {
  if (p.order) return;
  const b = m.ball;
  const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
  if (d > 3.2) return;
  const ad = m.attackDir(p.side);
  const q = shotQuality(p.pos.x, p.pos.z, ad);
  const ownGoalDist = dist2(p.pos.x, p.pos.z, -ad * HALF_L, 0);
  let rival = Infinity;
  for (const o of m.players) {
    if (o.side !== p.side) rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
  }
  if (b.pos.y > 1.15 && b.pos.y < 3) {
    if (q > 0.14) {
      m.order(p, 'header', 0, 0, 0.75, -1, true);
    } else if (ownGoalDist < 28 && rival < 4) {
      // Head it clear, out towards the wing.
      const z = clamp(p.pos.z * 0.4 + Math.sign(p.pos.z || 1) * 14, -HALF_W + 4, HALF_W - 4);
      m.order(p, 'header', ad, 0, 1, -1, true, { x: p.pos.x + ad * 20, z });
    } else if (rival < 2.2) {
      // Contested: nod it on to a teammate ahead.
      const x = clamp(p.pos.x + ad * 12, -HALF_L + 4, HALF_L - 4);
      m.order(p, 'header', ad, 0, 0.6, -1, true, { x, z: p.pos.z * 0.7 });
    }
    // Otherwise let it drop and bring it under control.
    return;
  }
  if (q > 0.24 && b.hspeed() > 5 && m.rng.chance(0.5)) {
    m.order(p, 'shot', 0, 0, 0.72, -1, true);
  }
}

function dribble(m: Match, p: Player, dx: number, dz: number): void {
  // Steer away from the nearest opponent ahead and off the touchlines.
  let ax = dx;
  let az = dz;
  let nearest = Infinity;
  for (const o of m.players) {
    if (o.side === p.side) continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const d = Math.hypot(ox, oz);
    nearest = Math.min(nearest, d);
    if (d > 4.5 || d < 0.01) continue;
    const ahead = (ox * dx + oz * dz) / d;
    if (ahead < 0.2) continue;
    const w = ((4.5 - d) / 4.5) * ahead * 1.4;
    ax -= (ox / d) * w;
    az -= (oz / d) * w;
  }
  if (Math.abs(p.pos.z) > HALF_W - 4) az -= Math.sign(p.pos.z) * 0.8;
  if (Math.abs(p.pos.x) > HALF_L - 3) ax -= Math.sign(p.pos.x) * 0.8;
  const l = Math.hypot(ax, az) || 1;
  p.wantX = ax / l;
  p.wantZ = az / l;
  p.faceTarget = null;
  p.sprint = nearest > 3.5 && p.stamina > 0.35;
}

function carrierAI(m: Match, p: Player, dt: number): void {
  const ad = m.attackDir(p.side);
  const gx = ad * HALF_L;
  const team = m.teamPlayers(p.side);
  let nearest = Infinity;
  for (const o of m.players) {
    if (o.side === p.side) continue;
    nearest = Math.min(nearest, dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z));
  }
  const urgent = nearest < 1.25;
  p.aiT -= dt;
  if (p.aiT > 0 && !(urgent && p.aiT > 0.12)) {
    dribble(m, p, p.aiDirX, p.aiDirZ);
    return;
  }
  const skill = m.aiSkill(p.side);
  p.aiT = 0.32 + m.rng.next() * 0.35 - skill * 0.03;
  const noise = 0.34 - skill * 0.06;

  type Choice = { s: number; run: () => void };
  const choices: Choice[] = [];
  const dg = dist2(p.pos.x, p.pos.z, gx, 0);
  const q = shotQuality(p.pos.x, p.pos.z, ad);
  const inBox = Math.abs(p.pos.x - gx) < BOX_DEPTH && Math.abs(p.pos.z) < BOX_W / 2;

  if (dg < 30) {
    const s = q * 5.6 + (inBox ? 0.45 : 0) - (dg > 22 ? 0.2 : 0) + skill * 0.03;
    const power = clamp(0.45 + dg / 40, 0.5, 0.95);
    choices.push({ s, run: () => m.order(p, 'shot', 0, 0, power, -1, false) });
  }

  for (const t of team) {
    if (t === p) continue;
    const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
    if (d < 4 || d > 40) continue;
    if (t.isKeeper && !(urgent && (p.pos.x - gx) * -ad < 30)) continue;
    const risk = laneRisk(m, p.side, p.pos.x, p.pos.z, t.pos.x, t.pos.z);
    const prog = ((t.pos.x - p.pos.x) * ad) / 25;
    let open = 8;
    for (const o of m.players) {
      if (o.side === p.side) continue;
      open = Math.min(open, dist2(o.pos.x, o.pos.z, t.pos.x, t.pos.z));
    }
    const s =
      0.02 + prog * 0.8 + (open / 8) * 0.4 - risk * 1.35 - d * 0.006 +
      (urgent ? 0.34 : 0) + shotQuality(t.pos.x, t.pos.z, ad) * 1.6 - (prog < -0.3 ? 0.25 : 0);
    choices.push({ s, run: () => m.order(p, 'pass', t.pos.x - p.pos.x, t.pos.z - p.pos.z, 0.6, t.idx, false) });

    // Through ball to a runner.
    const fwd = t.vel.x * ad;
    if (t.role !== 'DF' && fwd > 2.5 && prog > -0.1) {
      const ax = clamp(t.pos.x + ad * 7 + t.vel.x * 0.3, -HALF_L + 3, HALF_L - 3);
      const az = clamp(t.pos.z + t.vel.z * 0.6, -HALF_W + 2, HALF_W - 2);
      let openA = 8;
      for (const o of m.players) {
        if (o.side === p.side || o.isKeeper) continue;
        openA = Math.min(openA, dist2(o.pos.x, o.pos.z, ax, az));
      }
      const riskA = laneRisk(m, p.side, p.pos.x, p.pos.z, ax, az);
      const sa = 0.3 + ((ax - p.pos.x) * ad) / 25 * 0.75 + (openA / 8) * 0.5 - riskA * 1.1 + shotQuality(ax, az, ad) * 1.2;
      choices.push({ s: sa, run: () => m.order(p, 'through', 0, 0, 0.7, t.idx, false, { x: ax, z: az }) });
    }
  }

  // Cross from wide areas into the box.
  if (Math.abs(p.pos.z) > HALF_W * 0.4 && (p.pos.x * ad) > HALF_L * 0.45) {
    for (const t of team) {
      if (t === p || t.role === 'GK') continue;
      const tInBox = Math.abs(t.pos.x - gx) < BOX_DEPTH && Math.abs(t.pos.z) < BOX_W / 2;
      if (!tInBox) continue;
      const s = 0.5 + shotQuality(t.pos.x, t.pos.z, ad) * 2.2 + (urgent ? 0.2 : 0);
      choices.push({ s, run: () => m.order(p, 'lob', t.pos.x - p.pos.x, t.pos.z - p.pos.z, 0.7, t.idx, false) });
    }
  }

  // Clear it when trapped deep in our own third.
  const ownDist = dist2(p.pos.x, p.pos.z, -gx, 0);
  if (urgent && ownDist < 26) {
    choices.push({
      s: 0.5,
      run: () => m.order(p, 'clear', ad, 0, 1, -1, false, { x: p.pos.x + ad * 40, z: Math.sign(p.pos.z || 1) * (HALF_W - 6) }),
    });
  }

  // Dribble options fanned around the goal direction.
  const gdx = gx - p.pos.x;
  const gdz = -p.pos.z * 0.6;
  const base = Math.atan2(gdz, gdx);
  for (const off of [0, -0.55, 0.55, -1.1, 1.1, -1.6, 1.6]) {
    const a = base + off;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let space = 9;
    for (const o of m.players) {
      if (o.side === p.side) continue;
      const s1 = dist2(o.pos.x, o.pos.z, p.pos.x + dx * 3.5, p.pos.z + dz * 3.5);
      const s2 = dist2(o.pos.x, o.pos.z, p.pos.x + dx * 7, p.pos.z + dz * 7);
      space = Math.min(space, s1 * 1.1, s2 * 1.4);
    }
    const nz = p.pos.z + dz * 6;
    const nx = p.pos.x + dx * 6;
    const edge = Math.abs(nz) > HALF_W - 2 || Math.abs(nx) > HALF_L - 1 ? 0.6 : 0;
    const s = 0.16 + dx * ad * 0.45 + (Math.min(space, 9) / 9) * 0.62 - edge - (urgent ? 0.4 : 0) - Math.abs(off) * 0.05;
    choices.push({
      s,
      run: () => {
        p.aiDirX = dx;
        p.aiDirZ = dz;
        dribble(m, p, dx, dz);
      },
    });
  }

  let best: Choice | null = null;
  let bestS = -Infinity;
  for (const c of choices) {
    const s = c.s + m.rng.gauss() * noise * 0.5;
    if (s > bestS) {
      bestS = s;
      best = c;
    }
  }
  best?.run();
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
    p.wantX = p.wantZ = 0;
    return;
  }
  const attacking = r.side === side;
  let t = shapeTarget(m, p, attacking, r.x, r.z);
  if (r.kind === 'corner') {
    const gx = (attacking ? ad : -ad) * HALF_L;
    const inward = -Math.sign(gx);
    const slots = [
      [5.5, -2.5], [7, 2], [10, -4.5], [11, 4], [5, 0.5], [13, 0], [16, -7], [17, 7], [9, -8], [8.5, 8],
    ];
    const i = (p.slot * 7 + (attacking ? 0 : 3)) % slots.length;
    const joinBox = attacking ? p.role !== 'DF' || p.slot === 2 || p.slot === 3 : p.role !== 'FW';
    if (joinBox) {
      t = { x: gx + inward * slots[i][0], z: slots[i][1] * (attacking ? 1 : 0.9) };
    } else if (attacking) {
      t = { x: ad * 2, z: (p.slot % 2 ? 1 : -1) * 10 };
    } else {
      t = { x: ad * 8, z: (p.slot % 2 ? 1 : -1) * 6 };
    }
  } else if (r.kind === 'freekick' && !attacking) {
    // Build a wall for dangerous free kicks.
    const gx = -ad * HALF_L;
    const dg = dist2(r.x, r.z, gx, 0);
    if (dg < 32 && (p.slot === 5 || p.slot === 6 || p.slot === 7 || p.slot === 9)) {
      const ux = (gx - r.x) / dg;
      const uz = (0 - r.z) / dg;
      const off = ((p.slot % 4) - 1.5) * 0.85;
      t = { x: r.x + ux * 9.15 - uz * off, z: r.z + uz * 9.15 + ux * off };
    }
  } else if (r.kind === 'goalkick' && !attacking) {
    const gx = ad * HALF_L; // the goal kick is at the goal we attack
    if (Math.abs(t.x - gx) < BOX_DEPTH + 2) t.x = gx - ad * (BOX_DEPTH + 2);
  }
  moveTo(p, t.x, t.z, 0.8, { x: r.x, z: r.z });
}
