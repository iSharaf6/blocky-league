import type { Match } from '../sim/match';

/**
 * A 32-bit hash of the simulation state for lockstep desync detection (src/net/lockstep.ts) and for the
 * determinism tests. Two peers running the same match on the same inputs must produce the same value on
 * the same tick; the first tick they don't, the match has lost sync.
 *
 * It folds in the sim's random generator (every draw moves it, so almost any divergence shows up there
 * within a step or two), the clock and phase, the score, the ball and every player, bit for bit (the
 * float64 patterns, not rounded strings). It reads only simulation state that is the same on both peers:
 * never the view (the local human's side, camera, HUD) and never per-viewer accessors such as
 * Match.active (the peers look at different sides).
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Murmur3-style incremental mixer over 32-bit words. */
export class Hasher {
  private h: number;

  constructor(seed = 0x9747b28c) {
    this.h = seed | 0;
  }

  word(v: number): this {
    let k = Math.imul(v | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h = this.h ^ k;
    h = (h << 13) | (h >>> 19);
    this.h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    return this;
  }

  /** A float, by its exact bit pattern. */
  num(x: number): this {
    f64[0] = x;
    return this.word(u32[0]).word(u32[1]);
  }

  bool(b: boolean): this {
    return this.word(b ? 1 : 0);
  }

  str(s: string | null | undefined): this {
    if (s == null) return this.word(-1);
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
    return this;
  }

  /** The finished hash (murmur3 finaliser), unsigned. */
  value(): number {
    let h = this.h;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

/** The state hash of `m` right now (see the file comment). */
export function stateHash(m: Match): number {
  const h = new Hasher();
  h.word(m.rng.state()).word(m.half).num(m.clock).num(m.phaseT).str(m.phase).word(m.kickId);
  h.word(m.score[0]).word(m.score[1]).word(m.subsUsed[0]).word(m.subsUsed[1]).num(m.mentality[0]).num(m.mentality[1]);
  const b = m.ball;
  h.num(b.pos.x).num(b.pos.y).num(b.pos.z).num(b.vel.x).num(b.vel.y).num(b.vel.z).num(b.spin.x).num(b.spin.y).num(b.spin.z);
  h.word(b.owner).bool(b.held).word(b.lastTouch);
  for (const p of m.players) {
    h.num(p.pos.x).num(p.pos.z).num(p.y).num(p.vel.x).num(p.vel.z).num(p.facing).num(p.stamina).str(p.state).bool(p.sentOff);
  }
  h.word(m.powerups.length);
  for (const pu of m.powerups) h.word(pu.id).str(pu.kind).num(pu.x).num(pu.z).num(pu.t);
  h.str(m.heldPower[0]).str(m.heldPower[1]);
  return h.value();
}
