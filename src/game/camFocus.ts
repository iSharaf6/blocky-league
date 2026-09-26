import type { CamFocus } from '../render/cameraRig';
import { HALF_L } from '../sim/constants';
import type { Match } from '../sim/match';
import type { Side } from '../sim/types';
import { BALL_OFS, PF } from './replay';

/** A set piece being framed (see CamFocus.setPiece). */
export type SetPieceFocus = NonNullable<CamFocus['setPiece']>;

/** Frame the taker and where the ball is going for set pieces; null in open play. */
export function setPieceFocus(m: Match): SetPieceFocus | null {
  const r = m.restart;
  if (!r || (m.phase !== 'restart' && m.phase !== 'out')) return null;
  if (m.phase === 'out' && m.phaseT < 0.5) return null;
  const ad = m.attackDir(r.side);
  const ours = r.side === m.cfg.humanSide && m.phase === 'restart';
  // Once the ball is spotted, frame where it actually is.
  const bx = m.phase === 'restart' ? m.ball.pos.x : r.x;
  const bz = m.phase === 'restart' ? m.ball.pos.z : r.z;
  switch (r.kind) {
    case 'corner':
      // No room behind a corner flag (boards, stands) for a lens that shows both the taker and the box:
      // corners keep the wide set-piece shot (pulled on towards the goal, so all of it is in shot).
      return { x: r.x, z: r.z, tx: ad * (HALF_L - 9), tz: 0, corner: true, ours: r.side === m.cfg.humanSide };
    case 'freekick':
    case 'penalty': {
      const near = Math.hypot(ad * HALF_L - r.x, r.z) < 35;
      return {
        x: bx, z: bz, tx: ad * (HALF_L - (near ? 0 : 9)), tz: 0, behind: ours && near, goal: near, pen: r.kind === 'penalty',
        taker: r.taker, foot: m.runUpFoot,
      };
    }
    case 'throwin':
      return { x: r.x, z: r.z, tx: r.x + ad * 8, tz: r.z * 0.55 };
    case 'goalkick':
      return { x: r.x, z: r.z, tx: r.x + ad * 22, tz: 0 };
    default:
      return null;
  }
}

/**
 * Attacking direction the broadcast framing leans towards: the side on the ball, or while it is loose (a
 * pass in flight, a tackle's ricochet) the side that last had it (the sim's possessionSide); 0 before anyone
 * has. The camera rig adds its own hysteresis and eases the shift in and out.
 */
export function possessionLean(m: Match): number {
  const owner = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
  const side = owner ? owner.side : m.possessionSide;
  return side === 0 || side === 1 ? m.attackDir(side) : 0;
}

/**
 * Live-play camera focus from the drawn frame `f` (MatchView.frame): the ball, the human's controlled player
 * (the ball when there is none), the possession lean and any set piece. `tall`: a standing player's head
 * height at the current draw scale. The session overrides the subject for celebrations and replays.
 */
export function playFocus(m: Match, f: Float32Array, tall: number): CamFocus {
  const hs = m.cfg.humanSide;
  const act = f[BALL_OFS + 8];
  const has = act >= 0 && act < 22;
  return {
    bx: f[BALL_OFS], by: f[BALL_OFS + 1], bz: f[BALL_OFS + 2],
    bvx: f[BALL_OFS + 3], bvz: f[BALL_OFS + 5],
    ax: has ? f[act * PF] : f[BALL_OFS],
    az: has ? f[act * PF + 1] : f[BALL_OFS + 2],
    avx: 0, avz: 0,
    attack: hs >= 0 ? m.attackDir(hs as Side) : 1,
    lean: possessionLean(m),
    subject: -1,
    group: 0,
    setPiece: setPieceFocus(m),
    // After our set piece the over-the-shoulder shot may stay on the ball while it is live, in the net, or
    // just gone out (the one cut is then to the next set-piece framing, not to the wide shot first).
    hold: m.phase === 'play' || m.phase === 'goal' || m.phase === 'out',
    card: null,
    tall,
  };
}
