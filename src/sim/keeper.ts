import { clamp, dist2 } from '../core/math';
import {
  AIR_DRAG, BALL_R, BOUNCE, BOX_DEPTH, BOX_W, GOAL_H, GOAL_W, GRAVITY, HALF_L, MAGNUS, ROLL_A, ROLL_B, SHOT_TEMPO, SIX_W, TEMPO,
  WALL_DIST,
} from './constants';
import { blitzDive } from './blitz';
import type { Match } from './match';
import type { Player } from './player';
import type { Side } from './types';

type RestartLike = { kind: string; side: Side; x: number; z: number };

/**
 * Lateral dive pace scale (how far across goal a keeper gets in time). (Round 9: shots are SHOT_TEMPO faster
 * and his base reaction that much quicker; the dive itself isn't, so a well-struck one beats him a little
 * more often: goals at both ends.)
 */
const DIVE_PACE = 0.72;
/** How far (m) towards his near post a keeper shades when the ball is out at a tight angle. */
const NEAR_POST_SHADE = 0.8;
/** A chip: how long (s) the keeper takes to read it, and how near (m) his line he must be to claim it. */
const CHIP_REACT = 0.28;
const CHIP_HOME = 2.2;
/** ... and how much of his jog he gets back at while he's off it (turning to back-pedal costs pace). */
const CHIP_BACKPEDAL = 0.6;
/** Ball out wide by the byline (a corner): the keeper stands this far off his line and to the near side (m). */
const CROSS_STANCE_OUT = 0.9;
const CROSS_STANCE_Z = 0.7;
/** Direct free kick: how far across towards the open side the keeper stands (1 = the middle of the gap). */
const FK_KEEPER_SHADE = 0.2;
/**
 * A keeper's reaction time to a shot (s) is this less 0.2 x his keeping (so ~0.19 s for a good one), the lot
 * over SHOT_TEMPO (shots are that much faster; he reads them that much sooner).
 */
const KEEPER_REACT = 0.33;
/** Extra reaction time (s) to a free kick struck over the wall. */
const FK_UNSIGHTED = 0.05;
/**
 * Extra reaction time (s) to a finesse shot struck from outside the line of the near post: it starts
 * out wide of the far post and bends back in, so the keeper reads it late. (With the round-7 finesse
 * pace / placement, ~38% of 18 m angled far-post curlers go in against a set keeper: finishing.test.ts.
 * Round 9: 0.12 -> 0.14, his base reaction being SHOT_TEMPO quicker; the curler stays a ~30% chance.)
 */
const FINESSE_READ = 0.14;
/**
 * How far (m) a diving keeper's body travels sideways at most (plus a little for a great keeper); his
 * reach does the rest. So a shot placed right inside the post from the edge of the box is beyond him
 * even when it isn't struck hard: the corner is beaten by placement, not only by pace. A ball that
 * takes longer than DIVE_SET_T (s, after he has reacted) to reach him gives him time to get across on
 * his feet first: DIVE_SHUFFLE m more per second (so from range he still gets to the corners).
 */
export const DIVE_TRAVEL = 1.6;
const DIVE_SET_T = 0.45;
const DIVE_SHUFFLE = 8;
/**
 * A long shot (see LONG_READ) that will take longer than this (s) to reach him: he shuffles across on his
 * feet and dives when it's this far off (he used to dive at once and be on the floor when it got there).
 */
const DIVE_WAIT = 0.45;
/** How much of a curled free kick's bend he reads when it's a long one he's read the flight of (else 0.62). */
const FK_LONG_CURL_READ = 0.4;
/** A shot this long (s, at its launch speed in a straight line) from reaching him is read as a long one... */
const LONG_READ = 0.72;
/** ... and one struck from this far out (m) is a long one for its whole flight (Match.shotDist). */
const LONG_SHOT_D = 17;
/**
 * He reads a shot for this long (s) after it was struck: the whole flight of one from near halfway (2-3 s).
 * (Round 9: it was 1.6 s, and flightCrossing looked 1.6 s ahead: a shot from 40-55 m was read as a straight
 * line, or not at all once it was mid-flight, and he never committed to it.)
 */
const SHOT_READ_T = 4;
/**
 * A ball crossing higher than this (m) needs a leap: he waits until DIVE_WAIT_HIGH s before it arrives so his
 * hands are at the top of the jump as it gets there (he used to go at once and be back on the floor).
 */
const HIGH_DIVE_Y = 1.9;
const DIVE_WAIT_HIGH = 0.42;
/**
 * Straight at him (within 0.55 m) and under STAND_CATCH_Y m he stays on his feet and catches it, going up for
 * one over STAND_REACH_Y m: JUMP_VY m/s straight up (apex ~0.56 m at 0.25 s), JUMP_LEAD s before it arrives.
 */
const STAND_CATCH_Y = 2.9;
const STAND_REACH_Y = 2.2;
const JUMP_VY = 4.5;
const JUMP_LEAD = 0.28;
/** A dropper (DROPPER_DIP m lower at the line than where he stands) has him back-pedal to DROPPER_LINE m off his line. */
const DROPPER_LINE = 0.4;
const DROPPER_DIP = 0.3;

/**
 * When (s from now), how high and where (z) the ball crosses the plane x = `x` on its way towards the goal
 * of the side attacking `ad`'s opponents, flown on from where it is now with the ball's own air drag,
 * bounces and roll (spin left out: see curlDrift). Null when it doesn't within SHOT_READ_T s.
 */
export function flightCrossing(m: Match, x: number, ad: number): { t: number; y: number; z: number } | null {
  const b = m.ball;
  let px = b.pos.x;
  let py = b.pos.y;
  let pz = b.pos.z;
  if ((px - x) * ad <= 0) return null;
  let vx = b.vel.x;
  let vy = b.vel.y;
  let vz = b.vel.z;
  const dt = 1 / 60;
  const n = Math.round(SHOT_READ_T / dt);
  for (let i = 1; i <= n; i++) {
    if (py <= BALL_R + 0.005 && Math.abs(vy) < 0.9) {
      py = BALL_R;
      vy = 0;
      const sh = Math.hypot(vx, vz);
      if (sh < 0.3) return null;
      const k = Math.max(0, sh - (ROLL_A + ROLL_B * sh) * dt) / sh;
      vx *= k;
      vz *= k;
    } else {
      vy -= GRAVITY * dt;
      const drag = AIR_DRAG * Math.hypot(vx, vy, vz) * dt;
      vx -= vx * drag;
      vy -= vy * drag;
      vz -= vz * drag;
    }
    const ox = px;
    const oy = py;
    const oz = pz;
    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;
    if (py < BALL_R) {
      py = BALL_R;
      if (vy < -1.1) {
        vy = -vy * BOUNCE;
        vx *= 0.86;
        vz *= 0.86;
      } else vy = 0;
    }
    if ((px - x) * ad <= 0) {
      const f = Math.abs(px - ox) > 1e-6 ? (x - ox) / (px - ox) : 1;
      return { t: (i - 1 + f) * dt, y: Math.max(BALL_R, oy + (py - oy) * f), z: oz + (pz - oz) * f };
    }
  }
  return null;
}

/**
 * Where a player may stand while a penalty is taken: outside the penalty area and at least ten
 * yards from the spot (the arc). Returns (x, z) moved to the nearest legal point.
 */
export function clearOfPenalty(m: Match, r: RestartLike, x: number, z: number, margin = 0.6): { x: number; z: number } {
  const ad = m.attackDir(r.side);
  const gx = ad * HALF_L;
  let px = x;
  let pz = z;
  const front = BOX_DEPTH + margin - Math.abs(px - gx);
  const side = BOX_W / 2 + margin - Math.abs(pz);
  if (front > 0 && side > 0) {
    if (front <= side) px = gx - ad * (BOX_DEPTH + margin);
    else pz = (Math.sign(pz) || 1) * (BOX_W / 2 + margin);
  }
  const min = WALL_DIST + 0.4;
  const d = dist2(px, pz, r.x, r.z);
  if (d < min) {
    if (d < 0.05) {
      px = r.x - ad * min;
      pz = r.z;
    } else {
      px = r.x + ((px - r.x) / d) * min;
      pz = r.z + ((pz - r.z) / d) * min;
    }
  }
  return { x: px, z: pz };
}

/** A free kick close and central enough to shoot from: the defence puts up a wall. */
export function isDirectFreeKick(m: Match, r: RestartLike): boolean {
  if (r.kind !== 'freekick') return false;
  const gx = m.attackDir(r.side) * HALF_L;
  return dist2(r.x, r.z, gx, 0) < 30 && Math.abs(r.z) < 14;
}

export interface WallPlan {
  /** Wall spots, shoulder to shoulder from the near-post end inwards. */
  spots: { x: number; z: number }[];
  /** Where the keeper stands: covering the part of the goal the wall doesn't hide. */
  keeper: { x: number; z: number };
}

/** Spacing between wall players (the models are ~1 m wide, so they stand shoulder to shoulder). */
export const WALL_GAP = 0.9;

/**
 * The wall for a direct free kick: 9.15 m from the ball, square to the ball-goal line, 4 men when
 * it's close (3 further out). The end man lines up just outside the near post; the keeper takes
 * the rest of the goal, from the wall's inside edge to the far post.
 */
export function freeKickWall(m: Match, r: RestartLike): WallPlan {
  const gx = m.attackDir(r.side) * HALF_L;
  const hw = GOAL_W / 2;
  const bx = r.x;
  const bz = r.z;
  const dg = Math.max(1, dist2(bx, bz, gx, 0));
  const ux = (gx - bx) / dg;
  const uz = -bz / dg;
  const wx = -uz;
  const wz = ux;
  const n = dg < 24 ? 4 : 3;
  const near = Math.sign(bz) || 1;
  // Lateral offset, at wall distance, of the line from the ball to (gx, z).
  const latAt = (z: number) => {
    const vx = gx - bx;
    const vz = z - bz;
    return ((vx * wx + vz * wz) * WALL_DIST) / Math.max(0.1, vx * ux + vz * uz);
  };
  const sNear = latAt(near * hw);
  const sFar = latAt(-near * hw);
  const out = Math.sign(sNear - sFar) || 1;
  const s0 = sNear + out * 0.35;
  const cx = bx + ux * WALL_DIST;
  const cz = bz + uz * WALL_DIST;
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const sl = s0 - out * i * WALL_GAP;
    spots.push({ x: cx + wx * sl, z: cz + wz * sl });
  }
  // Where the line past the wall's inside shoulder meets the goal line.
  const sIn = s0 - out * ((n - 1) * WALL_GAP + 0.45);
  const ex = cx + wx * sIn;
  const ez = cz + wz * sIn;
  const zIn = bz + (ez - bz) * ((gx - bx) / (Math.abs(ex - bx) > 1e-3 ? ex - bx : 1e-3));
  const zFar = -near * hw;
  // The wall hides the whole goal from here: stand just off-centre towards the far post.
  // (Not all the way over: he has to be able to get across to a ball bent over the wall.)
  const kz = (zIn - zFar) * near <= 0.6 ? zFar * 0.2 : ((zIn + zFar) / 2) * FK_KEEPER_SHADE;
  return { spots, keeper: { x: gx - Math.sign(gx) * 0.9, z: clamp(kz, -hw + 0.6, hw - 0.6) } };
}

/**
 * Sideways drift still to come from the ball's sidespin (Magnus), over `t` seconds: a keeper reads
 * part of a curler's bend as it comes.
 */
export function curlDrift(m: Match, t: number): number {
  const b = m.ball;
  const az = MAGNUS * (b.spin.x * b.vel.y - b.spin.y * b.vel.x);
  // Spin fades as it flies (SPIN_DECAY ~0.7/s): ~0.8 of the undecayed drift over a typical shot.
  return 0.5 * az * t * t * Math.exp(-0.25 * t);
}

/** Is the point inside the penalty area that `side` defends? */
export function inOwnBox(m: Match, side: 0 | 1, x: number, z: number): boolean {
  const gx = -m.attackDir(side) * HALF_L;
  return Math.abs(x - gx) < BOX_DEPTH && Math.abs(z) < BOX_W / 2;
}

/**
 * Keeper brain: positioning on the ball–goal line, shot reading with a reaction delay,
 * dives with limited reach, rushing out to smother, and distribution after a catch.
 */
export function updateKeeper(m: Match, k: Player, dt: number): void {
  const b = m.ball;
  const ad = m.attackDir(k.side);
  const gx = -ad * HALF_L;
  const keeping = k.stat.keeping / 100;
  k.faceTarget = null;

  if (k.state === 'hold') {
    b.pos.x = k.pos.x + Math.cos(k.facing) * 0.35;
    b.pos.z = k.pos.z + Math.sin(k.facing) * 0.35;
    b.pos.y = 1.05;
    b.vel.x = b.vel.y = b.vel.z = 0;
    k.facing = ad > 0 ? 0 : Math.PI;
    // Human keepers wait for input (handled by the match); AI keepers distribute.
    if (!m.isHumanControlled(k) && k.stateT > m.keeperHoldTime) m.keeperDistribute(k);
    else if (m.isHumanControlled(k) && k.stateT > 3) m.keeperDistribute(k);
    return;
  }
  if (k.state !== 'move') return;

  // ---- Penalty against us: on the line, in the middle of the goal.
  const r = m.restart;
  if ((m.phase === 'restart' || m.phase === 'out') && r && r.kind === 'penalty' && r.side !== k.side) {
    moveTo(k, gx + ad * 0.3, 0, false);
    k.faceTarget = Math.atan2(r.z - k.pos.z, r.x - k.pos.x);
    return;
  }

  // ---- Free kick against us: take the side of the goal the wall doesn't cover.
  if ((m.phase === 'restart' || m.phase === 'out') && r && r.side !== k.side && isDirectFreeKick(m, r)) {
    const w = freeKickWall(m, r);
    moveTo(k, w.keeper.x, w.keeper.z, false);
    k.faceTarget = Math.atan2(r.z - k.pos.z, r.x - k.pos.x);
    return;
  }

  // ---- Ball at our feet (back-pass): move it on quickly.
  if (b.owner === k.idx && !b.held) {
    k.wantX = k.wantZ = 0;
    k.aiT -= dt;
    if (k.aiT <= 0 && !k.order) {
      k.aiT = 0.5;
      m.keeperClear(k);
    }
    return;
  }
  k.aiT = (0.35 + m.rng.next() * 0.4) / TEMPO;

  // ---- A chip: back-pedal under it and go up for it (a dive would have him on the floor when it drops).
  const toward = b.vel.x * -ad; // positive when heading to our goal
  if (b.owner < 0 && !b.held && m.shotStyle === 'chip' && m.shotKick === m.kickId && m.shotSide !== k.side && m.shotClock < 2.5 && toward > 2) {
    let drop: { x: number; z: number; y: number; t: number } | null = null;
    for (const s of m.ballPath) {
      if ((s.x - gx) * ad <= 0.4) {
        drop = s;
        break;
      }
    }
    if (drop && m.shotClock >= CHIP_REACT) {
      const home = Math.abs(k.pos.x - gx) < CHIP_HOME;
      moveTo(k, gx + ad * 0.4, clamp(drop.z, -GOAL_W / 2 + 0.3, GOAL_W / 2 - 0.3), home);
      k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
      // Caught off his line he can only scramble back, facing the ball; back on it under the ball, he
      // goes up with his hands (a chip against a keeper on his line is his).
      if (!home) {
        k.wantX *= CHIP_BACKPEDAL;
        k.wantZ *= CHIP_BACKPEDAL;
        k.sprint = false;
      }
      k.claiming = home;
      if (home && k.y === 0 && b.pos.y > 1.7 && dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z) < 1.8) {
        k.vy = 4;
        k.y = 0.01;
      }
      return;
    }
    if (drop) {
      k.wantX = k.wantZ = 0;
      return;
    }
  }

  // ---- Shot reading --------------------------------------------------------
  if (b.owner < 0 && !b.held && toward > 7 && m.shotClock < SHOT_READ_T) {
    // When and where it gets to him: the real flight (drag, dip, a skid off the turf, a bounce), read for the
    // whole of it; a straight line only when the flight doesn't cross his line.
    const tLine = (k.pos.x - b.pos.x) / b.vel.x;
    const across = flightCrossing(m, k.pos.x, ad);
    const t = across?.t ?? tLine;
    if (t > 0 && t < SHOT_READ_T) {
      // A long one (struck from LONG_SHOT_D m or more, or still LONG_READ s away): he has time to get across on
      // his feet first, and misjudges a curler's bend a little more.
      const long = m.shotKick === m.kickId ? m.shotDist >= LONG_SHOT_D : tLine > LONG_READ;
      // A curler's bend is only half read (a free kick, which he's set for, a little better).
      const zc = (across?.z ?? b.pos.z + b.vel.z * t) + curlDrift(m, t) * (m.freeKickShot() ? (long ? FK_LONG_CURL_READ : 0.62) : 0.5);
      const yc = across?.y ?? Math.max(BALL_R, b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t);
      const onFrame = Math.abs(zc) < GOAL_W / 2 + 0.9 && yc < GOAL_H + 0.6;
      if (onFrame) {
        // A free kick struck over the wall is seen late (the wall is in the way).
        const finesse = m.shotStyle === 'finesse' && m.shotKick === m.kickId && Math.abs(m.kickZ) > GOAL_W / 2;
        // (The base reaction rides on the shot tempo; the wall's and the curler's late read don't.)
        const reaction = clamp(KEEPER_REACT - keeping * 0.2 - m.keeperBonus(k.side), 0.09, 0.37) / SHOT_TEMPO + (m.freeKickShot() ? FK_UNSIGHTED : 0) +
          (finesse ? FINESSE_READ : 0);
        const lateral = zc - k.pos.z;
        const high = yc > HIGH_DIVE_Y;
        // A dropper (a floated long shot coming down steeply: over his head where he stands, under the bar at
        // the line): back onto his line first, where it's lower, then go up for it.
        const atLine = high ? flightCrossing(m, gx + ad * DROPPER_LINE, ad) : null;
        if (atLine && atLine.y < yc - DROPPER_DIP && Math.abs(k.pos.x - gx) > DROPPER_LINE + 0.3 && t > 0.15 && m.shotClock >= reaction) {
          moveTo(k, gx + ad * DROPPER_LINE, clamp(atLine.z, -GOAL_W / 2 + 0.2, GOAL_W / 2 - 0.2), true);
          k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
          return;
        }
        if (Math.abs(lateral) < 0.55 && yc < STAND_CATCH_Y) {
          // Straight at them: shuffle and let the catch check do the work; one over his standing reach he goes up
          // for, timed so his hands are at the top as it arrives.
          k.wantX = 0;
          k.wantZ = clamp(lateral * 3, -1, 1);
          k.sprint = false;
          k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
          if (yc > STAND_REACH_Y && k.y === 0 && t <= JUMP_LEAD && m.shotClock >= reaction) {
            k.vy = JUMP_VY;
            k.y = 0.01;
          }
          return;
        }
        if (m.shotClock >= reaction && (long || high) && t > (high ? DIVE_WAIT_HIGH : DIVE_WAIT)) {
          // Time in hand (a shot from range, or a high one): across to where it will cross on his feet first, and
          // dive late (a keeper who went at once was on the floor, sliding past it, by the time a long one got
          // there; for a high one the leap is timed to peak as it arrives).
          const tz = clamp(zc, -GOAL_W / 2 + 0.2, GOAL_W / 2 - 0.2);
          const dz = tz - k.pos.z;
          k.wantX = 0;
          k.wantZ = clamp(dz * 2.5, -1, 1);
          k.sprint = Math.abs(dz) > 0.6;
          k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
          return;
        }
        if (m.shotClock >= reaction) {
          // Lateral dive speed (m/s): enough for the corners from range, not from close in.
          const maxDive = (4.6 + keeping * 3 + m.keeperBonus(k.side) * 8) * DIVE_PACE;
          const need = Math.abs(lateral) / Math.max(t, 0.12);
          const vz = Math.sign(lateral) * Math.min(need * 1.05, maxDive);
          k.setState('dive');
          k.vel.z = vz;
          k.vel.x = ad * 0.8;
          k.diveTravel = DIVE_TRAVEL + keeping * 0.3 + m.keeperBonus(k.side) * 10 + Math.max(0, t - DIVE_SET_T) * DIVE_SHUFFLE;
          // Low shots: a skidding dive; high shots: a proper leap (peak ~0.5-0.9 m).
          k.vy = yc > 0.6 ? clamp(yc * 2.6 + 0.6, 3.2, 6.2) : clamp(yc * 2.4, 1.4, 3);
          k.y = 0.01;
          // +1 = dive to the keeper's own right (facing +x, right is +z).
          k.diveDir = Math.sign(lateral) * (Math.cos(k.facing) >= 0 ? 1 : -1);
          if (m.cfg.mode === 'blitz') blitzDive(m, k); // a frozen keeper's dive is slower and shorter
          return;
        }
        // Still reacting: set the feet.
        k.wantX = k.wantZ = 0;
        return;
      }
    }
  }

  // ---- Crosses: come and claim high balls dropping into the goal area --------------
  if (b.owner < 0 && !b.held && m.shotClock > 0.6 && m.kickSide !== k.side && m.sinceKick < 3.5) {
    const c = crossDrop(m, k);
    if (c) {
      if (k.claimKick !== m.kickId) {
        k.claimKick = m.kickId;
        const tK = dist2(k.pos.x, k.pos.z, c.x, c.z) / (k.top * 0.95) + 0.12;
        // Traffic around where it drops (a packed six-yard box at a corner, runners on their way in)
        // makes keepers stay on their line.
        let crowd = 0;
        for (const o of m.players) {
          if (!o.isKeeper && !o.sentOff && dist2(o.pos.x, o.pos.z, c.x, c.z) < 5) crowd++;
        }
        const traffic = clamp(1.1 - crowd * 0.12, 0.3, 1);
        // A set-piece delivery into a loaded box is mostly left to the defenders.
        const sp = m.setPieceKick === m.kickId ? 0.4 : 1;
        k.claiming = tK < c.t + 0.08 && m.rng.chance((0.5 + keeping * 0.35 + m.keeperBonus(k.side) * 2) * traffic * sp);
      }
      if (k.claiming) {
        moveTo(k, c.x, c.z, true);
        k.faceTarget = Math.atan2(b.pos.z - k.pos.z, b.pos.x - k.pos.x);
        // Leap for it as it arrives.
        if (k.y === 0 && b.pos.y > 1.9 && dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z) < 2) {
          k.vy = 4;
          k.y = 0.01;
        }
        return;
      }
    } else {
      k.claiming = false;
    }
  } else {
    k.claiming = false;
  }

  // ---- Sweep up loose balls we reach first ------------------------------------------
  if (b.owner < 0 && !b.held && m.shotClock > 0.5) {
    const toward = b.vel.x * -ad;
    const near = dist2(b.pos.x, b.pos.z, gx, 0) < BOX_DEPTH + 14;
    if (near && (toward > 1 || inOwnBox(m, k.side, b.pos.x, b.pos.z)) && b.hspeed() < 18) {
      const i = reach(m, k);
      if (inOwnBox(m, k.side, i.x, i.z)) {
        let rivalT = Infinity;
        for (const o of m.players) {
          if (o.side === k.side || o.sentOff) continue;
          rivalT = Math.min(rivalT, reach(m, o).t);
        }
        const kd = dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z);
        if (i.t < rivalT - 0.12 || kd < 2.5) {
          moveTo(k, i.x, i.z, true);
          return;
        }
      }
    }
  }

  // ---- 1v1: rush the carrier ----------------------------------------------------
  if (b.owner >= 0) {
    const c = m.players[b.owner];
    if (c.side !== k.side) {
      const cd = dist2(c.pos.x, c.pos.z, gx, 0);
      const kd = dist2(k.pos.x, k.pos.z, c.pos.x, c.pos.z);
      if (cd < 15 && Math.abs(c.pos.z) < BOX_W / 2 - 2 && kd < 9 && nobodyCovering(m, k, c)) {
        moveTo(k, c.pos.x - ad * 0.8, c.pos.z, true);
        return;
      }
    }
  }

  // ---- Positioning on the angle -----------------------------------------------
  const bx = b.pos.x;
  const bz = b.pos.z;
  const dx = bx - gx;
  const dz = bz;
  const dd = Math.max(0.1, Math.hypot(dx, dz));
  const dOut = clamp(0.7 + dd * 0.055, 0.7, 3.4);
  let tx = gx + (dx / dd) * dOut;
  let tz = (dz / dd) * dOut;
  // Keep the near post covered: from a tight angle he hugs it (and leaves the far post to his dive).
  const tight = clamp((Math.atan2(Math.abs(dz), Math.abs(dx)) - 0.45) / 0.6, 0, 1);
  tz = clamp(tz + bz * 0.04 + Math.sign(bz) * tight * NEAR_POST_SHADE, -GOAL_W / 2 + 0.45, GOAL_W / 2 - 0.45);
  // A corner (the ball dead out wide by the byline): he takes the middle of his goal a step off the
  // line, shaded a touch to the near side, rather than hugging the near post (in open play, with a
  // cut-back or a shot on, the near post is still his).
  const wide = m.phase === 'play' ? 0 : clamp((Math.abs(bz) - (BOX_W / 2 + 1)) / 5, 0, 1) * clamp(1 - (Math.abs(dx) - 10) / 8, 0, 1);
  if (wide > 0) {
    tx = tx + (gx + ad * CROSS_STANCE_OUT - tx) * wide;
    tz = tz + (Math.sign(bz) * CROSS_STANCE_Z - tz) * wide;
  }
  if (Math.abs(tx - gx) < 0.5) tx = gx + ad * 0.5;
  moveTo(k, tx, tz, false);
  k.faceTarget = Math.atan2(bz - k.pos.z, bx - k.pos.x);
}

/** Where a lofted ball first drops to catchable height inside the keeper's claiming area. */
function crossDrop(m: Match, k: Player): { x: number; z: number; t: number } | null {
  const b = m.ball;
  if (b.pos.y < 1 && b.vel.y < 1.5) return null;
  const gx = -m.attackDir(k.side) * HALF_L;
  let i = 0;
  for (const s of m.ballPath) {
    i++;
    if (s.y <= 2.8 && Math.abs(s.x - gx) < 6.5 && Math.abs(s.z) < SIX_W / 2 + 1.5) {
      return s.y >= 0.9 ? { x: s.x, z: s.z, t: s.t } : null;
    }
    if (s.y < 0.4 && i > 4) return null; // lands before it reaches us
  }
  return null;
}

/** Earliest point on the predicted ball path that `p` can get to (ground/low balls). */
function reach(m: Match, p: Player): { x: number; z: number; t: number } {
  const path = m.ballPath;
  const top = p.top * 0.92;
  for (const s of path) {
    if (s.y > (p.isKeeper ? 2.6 : 2.1)) continue;
    const d = Math.max(0, dist2(p.pos.x, p.pos.z, s.x, s.z) - 0.55);
    if (d / top + 0.12 <= s.t) return s;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, t: Math.max(last.t, dist2(p.pos.x, p.pos.z, last.x, last.z) / top) };
}

function nobodyCovering(m: Match, k: Player, c: Player): boolean {
  for (const o of m.players) {
    if (o.side !== k.side || o === k || o.sentOff) continue;
    if (dist2(o.pos.x, o.pos.z, c.pos.x, c.pos.z) < 2.2) return false;
  }
  return true;
}

function moveTo(p: Player, x: number, z: number, urgent: boolean): void {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) {
    p.wantX = p.wantZ = 0;
    p.sprint = false;
    return;
  }
  const f = Math.min(1, d / (urgent ? 1 : 2.5));
  p.wantX = (dx / d) * f;
  p.wantZ = (dz / d) * f;
  p.sprint = urgent || d > 6;
}
