import type { Match } from '../sim/match';
import type { PState } from '../sim/player';

/**
 * Floats per player in a frame: 0 x, 1 z, 2 y, 3 facing, 4 state code, 5 stateT, 6 runPhase, 7 speed,
 * 8 kickT, 9 kick foot (+-1; +-2 = the same foot in a poke tackle), 10 lean, 11 diveDir, 12 headerT,
 * 13 celebration style, 14 has the ball, 15 stamina.
 */
export const PF = 16;
export const BALL_OFS = 22 * PF;
export const FRAME_LEN = BALL_OFS + 11;

/**
 * Frame code per player state; 10 = sent off (parked by his dugout, drawn hands-on-head). 11 / 12 are
 * reserved for a sim 'stumble' and a 'plant' (the step before a strike at a sprint): the renderer already
 * draws them (characters.PSTATE), so a sim state by either name is recorded and drawn with no other change.
 */
export const STATE_CODE: Record<PState, number> & Record<string, number | undefined> = {
  move: 0, kick: 1, slide: 2, fallen: 3, stand: 4, dive: 5, hold: 6, throw: 7, celebrate: 8, dejected: 9, sentoff: 10,
  stumble: 11, plant: 12,
};
export const SENT_OFF_CODE = 10;

/** Red-carded: the sim either flags the player or gives him a 'sentoff' state (whichever it ships). */
export function isSentOff(p: Match['players'][number]): boolean {
  return (p.state as string) === 'sentoff' || ('sentOff' in p && !!(p as { sentOff?: boolean }).sentOff);
}

/**
 * A standing-tackle lunge (the sim's poke: a 'kick' state entered at stateT 0.09 / kickT 0.28, so it lasts
 * LUNGE_S of the 0.34 s state). The session bakes the same lunge into a frame on a TACKLE press (the
 * 'tackleTry' event, before any contact), so a lost tackle still lunges, live and in replays alike.
 */
export const LUNGE_S = 0.25;
export const LUNGE_STATE_T0 = 0.09;
export const LUNGE_KICK_T0 = 0.28;

/**
 * Snapshot the sim into a flat float array (what the renderer and replays consume). `lunge` (per player,
 * seconds since his TACKLE press, < 0 = none): a man still running is written as a poke 'kick' for LUNGE_S,
 * the leg picked towards the ball (`lungeLeg`, +-1), exactly as the sim's own won-tackle poke is.
 */
export function writeFrame(m: Match, out: Float32Array, time: number, lunge?: Float32Array, lungeLeg?: Float32Array): void {
  for (const p of m.players) {
    const o = p.idx * PF;
    out[o] = p.pos.x;
    out[o + 1] = p.pos.z;
    out[o + 2] = p.y;
    out[o + 3] = p.facing;
    out[o + 4] = isSentOff(p) ? SENT_OFF_CODE : STATE_CODE[p.state] ?? 0;
    out[o + 5] = p.stateT;
    out[o + 6] = p.runPhase;
    out[o + 7] = p.speed();
    out[o + 8] = p.kickT;
    // A poke tackle is a 'kick' state too: flag it in the foot channel (the renderer draws a lunge).
    out[o + 9] = p.state === 'kick' && p.poke ? p.kickLeg * 2 : p.kickLeg;
    const lt = lunge ? lunge[p.idx] : -1;
    if (lt >= 0 && lt < LUNGE_S && p.state === 'move' && !isSentOff(p)) {
      out[o + 4] = STATE_CODE.kick;
      out[o + 5] = LUNGE_STATE_T0 + lt;
      out[o + 8] = Math.min(1, LUNGE_KICK_T0 + lt / 0.34);
      out[o + 9] = (lungeLeg && lungeLeg[p.idx] < 0 ? -1 : 1) * 2;
    }
    out[o + 10] = p.lean;
    out[o + 11] = p.diveDir;
    out[o + 12] = p.headerT;
    out[o + 13] = p.celebrate;
    out[o + 14] = m.ball.owner === p.idx ? 1 : 0;
    out[o + 15] = p.stamina;
  }
  const b = m.ball;
  out[BALL_OFS] = b.pos.x;
  out[BALL_OFS + 1] = b.pos.y;
  out[BALL_OFS + 2] = b.pos.z;
  out[BALL_OFS + 3] = b.vel.x;
  out[BALL_OFS + 4] = b.vel.y;
  out[BALL_OFS + 5] = b.vel.z;
  out[BALL_OFS + 6] = b.held ? 1 : 0;
  out[BALL_OFS + 7] = b.owner;
  out[BALL_OFS + 8] = m.active;
  out[BALL_OFS + 9] = time;
  out[BALL_OFS + 10] = m.passTarget;
}

/** Ring buffer of recent frames for instant replays. */
export class ReplayBuffer {
  private frames: Float32Array[];
  private head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.frames = Array.from({ length: capacity }, () => new Float32Array(FRAME_LEN));
  }

  push(m: Match, time: number, lunge?: Float32Array, lungeLeg?: Float32Array): void {
    writeFrame(m, this.frames[this.head], time, lunge, lungeLeg);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** i = 0 is the oldest retained frame. */
  get(i: number): Float32Array {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.frames[(start + Math.max(0, Math.min(this.count - 1, i))) % this.capacity];
  }

  clear(): void {
    this.count = 0;
  }

  /** Copy the last `n` frames out so the live buffer can keep recording. */
  snapshot(n: number): Float32Array[] {
    const k = Math.min(n, this.count);
    const out: Float32Array[] = [];
    for (let i = this.count - k; i < this.count; i++) out.push(this.get(i).slice());
    return out;
  }
}
