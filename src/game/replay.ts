import type { Match } from '../sim/match';
import type { PState } from '../sim/player';

/** Floats per player in a frame. */
export const PF = 16;
export const BALL_OFS = 22 * PF;
export const FRAME_LEN = BALL_OFS + 11;

export const STATE_CODE: Record<PState, number> = {
  move: 0, kick: 1, slide: 2, fallen: 3, stand: 4, dive: 5, hold: 6, throw: 7, celebrate: 8, dejected: 9,
};

/** Snapshot the sim into a flat float array (what the renderer and replays consume). */
export function writeFrame(m: Match, out: Float32Array, time: number): void {
  for (const p of m.players) {
    const o = p.idx * PF;
    out[o] = p.pos.x;
    out[o + 1] = p.pos.z;
    out[o + 2] = p.y;
    out[o + 3] = p.facing;
    out[o + 4] = STATE_CODE[p.state];
    out[o + 5] = p.stateT;
    out[o + 6] = p.runPhase;
    out[o + 7] = p.speed();
    out[o + 8] = p.kickT;
    out[o + 9] = p.kickLeg;
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

  push(m: Match, time: number): void {
    writeFrame(m, this.frames[this.head], time);
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
