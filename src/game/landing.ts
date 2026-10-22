import { AIR_DRAG, BALL_R, GRAVITY, MAGNUS, SPIN_DECAY } from '../sim/constants';

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The flight is run on in steps this long (s): the spot it finds moves by well under a centimetre from one frame to the next. */
const STEP = 1 / 240;

/**
 * Where a ball in the air first comes down (the landing ring's spot: MatchSession.updateLanding), and when (s from
 * now): its flight run on from where it is with the sim's own air model (gravity, drag, the bend of its spin: sim/ball.ts
 * Ball.step) in fine steps, to the moment it reaches the grass, placed inside that step. Read only: the sim never sees
 * it. Null if it is not down within `maxT` s.
 *
 * (The ring used the sim's predicted path, Match.ballPath, sampled every 0.1 s for the AI, and took its first sample on
 * the grass. A bounce falling between two samples was missed, so the ring went to a later sample metres on, then came
 * back as the sampling moved with every step. That was the circle flickering between two spots as the cross flew to
 * the runner in drill 3, from CrazyGames' review of 22 October.)
 */
export function landingSpot(pos: V3, vel: V3, spin: V3 = { x: 0, y: 0, z: 0 }, maxT = 4): { x: number; z: number; t: number } | null {
  let x = pos.x, y = pos.y, z = pos.z;
  let vx = vel.x, vy = vel.y, vz = vel.z;
  let sx = spin.x, sy = spin.y, sz = spin.z;
  const sk = Math.exp(-SPIN_DECAY * STEP);
  const n = Math.ceil(maxT / STEP);
  for (let i = 0; i < n; i++) {
    vy -= GRAVITY * STEP;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const drag = AIR_DRAG * sp * STEP;
    vx -= vx * drag;
    vy -= vy * drag;
    vz -= vz * drag;
    // (In Ball.step's order: each line reads the ones before it.)
    vx += MAGNUS * (sy * vz - sz * vy) * STEP;
    vy += MAGNUS * (sz * vx - sx * vz) * STEP;
    vz += MAGNUS * (sx * vy - sy * vx) * STEP;
    sx *= sk;
    sy *= sk;
    sz *= sk;
    const nx = x + vx * STEP, ny = y + vy * STEP, nz = z + vz * STEP;
    if (ny <= BALL_R && vy < 0) {
      const f = y > ny ? Math.max(0, Math.min(1, (y - BALL_R) / (y - ny))) : 0;
      return { x: x + (nx - x) * f, z: z + (nz - z) * f, t: (i + f) * STEP };
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return null;
}
