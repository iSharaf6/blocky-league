import { EMPTY_PAD, type Pad } from '../sim/match';
import type { Match } from '../sim/match';
import type { Side } from '../sim/types';
import { stateHash } from './hash';
import type { NetData, Transport } from './transport';

/**
 * Deterministic lockstep for a two-human match. Both peers run the same Match (same seed and settings, agreed
 * before the kick-off: the host decides) and exchange only their pads; the sim steps tick t once both pads for
 * t are known, so the two runs stay bit-identical without ever sending game state.
 *
 * Input delay: the pad read on local tick t is the one for tick t + D (D = `delay`, 4 by default: ~67 ms at
 * 60 Hz), which gives it D ticks to cross the network before the other side needs it. D adapts to the measured
 * round trip (DELAY_MIN..DELAY_MAX): up at once when the link gets slower, down one tick at a time once it has
 * stayed faster. Each side only decides its own D: every pad it ever fills in is sent, so a change needs no
 * agreement (a longer delay repeats the pad once, a shorter one skips a read).
 *
 * Packets (binary, unreliable and unordered: pads may be lost or overtaken): every packet repeats all of this
 * side's pads the other side hasn't acknowledged yet (up to MAX_PADS), with the first one's tick, this side's
 * acknowledgement of the other's pads (the first tick still missing) and this side's current tick (the other
 * side's time sync reads it). 15 bytes of header, then 3 a pad: stick x and z (int8, /127) and the buttons
 * (bits); ~27-40 bytes a packet, 60 a second. A lost packet costs nothing unless every repeat of a pad is lost.
 * Pads are quantised the same way before this side's own sim uses them, so both sims see exactly the same
 * numbers.
 *
 * Control (JSON, reliable): every HASH_EVERY ticks each side sends its state hash (src/net/hash.ts); a mismatch
 * is a desync (status 'desync': the match stops, "connection lost sync"). Pause / resume, and 'bye'. Pings (on the
 * unreliable channel) measure the round trip. Nothing heard for TIMEOUT_MS is a lost connection.
 *
 * Time sync: a side that finds itself ahead of the other (by its own tick against the other's last reported one
 * plus half the round trip) runs a touch slower (pace()) until they're level, so neither keeps stalling.
 */

export const TICK_MS = 1000 / 60;
export const DEFAULT_DELAY = 4;
export const DELAY_MIN = 2;
export const DELAY_MAX = 8;
export const HASH_EVERY = 60;
/** Pads per packet at most (0.5 s: a longer gap than that is resent from its start, in pieces). */
const MAX_PADS = 30;
const PING_MS = 500;
const RESEND_MS = 15;
export const TIMEOUT_MS = 6000;
/** ...while either side is paused (a menu open, a hidden tab only pinging once a second or so). */
export const PAUSED_TIMEOUT_MS = 45_000;
/** How often the delay is looked at again, and how many looks in a row must find it too long to lower it. */
const ADAPT_MS = 1000;
const LOWER_AFTER = 3;
/** Stalled ticks in one ADAPT_MS window that raise the delay whatever the round trip says. */
const STALL_RAISE = 6;
const PKT_INPUT = 0xb1;
const HEADER = 15;

// ------------------------------------------------------------------ pads on the wire

const FL_SPRINT = 1;
const FL_PASS = 2;
const FL_SHOOT = 4;
const FL_THROUGH = 8;
const FL_DIGITAL = 16;
const FL_POWER = 32;

/**
 * A stick axis as the int8 that goes on the wire. `| 0` matters: Math.round(-0.001 * 127) is -0, which would
 * leave this side stepping with -0 while the other decodes +0 from the byte (atan2(-0, -1) is -pi, atan2(0, -1)
 * is pi, and the sim reads the stick's angle). The sims then part ways within seconds (the lockstep tests caught
 * exactly that).
 */
const q8 = (v: number): number => Math.max(-127, Math.min(127, Math.round((Number.isFinite(v) ? v : 0) * 127))) | 0;

/** A pad as it goes on the wire and comes off it (both peers step with exactly this). */
export function quantizePad(p: Pad): Pad {
  return decodePad(q8(p.mx), q8(p.mz), flagsOf(p));
}

function flagsOf(p: Pad): number {
  return (p.sprint ? FL_SPRINT : 0) | (p.pass ? FL_PASS : 0) | (p.shoot ? FL_SHOOT : 0) | (p.through ? FL_THROUGH : 0) |
    (p.digital ? FL_DIGITAL : 0) | (p.power ? FL_POWER : 0);
}

function decodePad(qx: number, qz: number, f: number): Pad {
  return {
    mx: qx / 127, mz: qz / 127,
    sprint: (f & FL_SPRINT) !== 0, pass: (f & FL_PASS) !== 0, shoot: (f & FL_SHOOT) !== 0, through: (f & FL_THROUGH) !== 0,
    digital: (f & FL_DIGITAL) !== 0, power: (f & FL_POWER) !== 0,
  };
}

export interface InputPacket {
  epoch: number;
  /** Tick of pads[0]. */
  first: number;
  /** The sender has every pad of ours below this tick. */
  ack: number;
  /** The sender's next tick to simulate when it sent this. */
  tick: number;
  pads: Pad[];
}

export function encodeInput(p: InputPacket): ArrayBuffer {
  const n = p.pads.length;
  const buf = new ArrayBuffer(HEADER + n * 3);
  const v = new DataView(buf);
  v.setUint8(0, PKT_INPUT);
  v.setUint8(1, p.epoch & 0xff);
  v.setUint32(2, p.first, true);
  v.setUint32(6, p.ack, true);
  v.setUint32(10, p.tick, true);
  v.setUint8(14, n);
  for (let i = 0; i < n; i++) {
    const pad = p.pads[i];
    v.setInt8(HEADER + i * 3, q8(pad.mx));
    v.setInt8(HEADER + i * 3 + 1, q8(pad.mz));
    v.setUint8(HEADER + i * 3 + 2, flagsOf(pad));
  }
  return buf;
}

export function decodeInput(buf: ArrayBuffer): InputPacket | null {
  if (buf.byteLength < HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== PKT_INPUT) return null;
  const n = v.getUint8(14);
  if (buf.byteLength !== HEADER + n * 3) return null;
  const pads: Pad[] = [];
  for (let i = 0; i < n; i++) pads.push(decodePad(v.getInt8(HEADER + i * 3), v.getInt8(HEADER + i * 3 + 1), v.getUint8(HEADER + i * 3 + 2)));
  return { epoch: v.getUint8(1), first: v.getUint32(2, true), ack: v.getUint32(6, true), tick: v.getUint32(10, true), pads };
}

// ------------------------------------------------------------------ control messages

/** Lockstep's own control messages (JSON). Anything else on the link is the lobby's (see OnlineLink). */
export type LockMsg =
  | { t: 'hash'; e: number; k: number; h: number }
  | { t: 'pause'; e: number; on: boolean }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'bye'; reason?: string };

export type LockStatus = 'play' | 'desync' | 'lost';

export interface LockstepOptions {
  /** This machine's side. */
  side: Side;
  /** The match's number on this link (a rematch is the next one): packets for another are ignored. */
  epoch: number;
  /** Starting input delay in ticks (DEFAULT_DELAY). */
  delay?: number;
  /** Adapt the delay to the round trip (default true). */
  adaptive?: boolean;
  /** Clock in ms (tests pass a virtual one). */
  now?: () => number;
  hashEvery?: number;
}

export class Lockstep {
  /** The next tick to simulate (ticks stepped so far). */
  tick = 0;
  delay: number;
  status: LockStatus = 'play';
  /** Why it stopped ('desync' / 'lost'), for the UI. */
  reason = '';
  /** Smoothed round trip and its mean deviation (ms); -1 before the first pong. */
  rtt = -1;
  rttDev = 0;
  /** Pads that arrived for a tick already covered (duplicates from the redundancy), and packets taken in. */
  dupes = 0;
  packets = 0;
  /** Ticks the sim wanted to step but the other side's pad wasn't here yet. */
  stalls = 0;
  /** The desync, when there was one. */
  desyncAt: { tick: number; local: number; remote: number } | null = null;

  onDesync: ((tick: number) => void) | null = null;
  onLost: ((reason: string) => void) | null = null;
  onPause: ((paused: boolean, byPeer: boolean) => void) | null = null;

  private readonly side: Side;
  private readonly epoch: number;
  private readonly adaptive: boolean;
  private readonly now: () => number;
  private readonly hashEvery: number;
  /** Our pads by tick (from `acked` on), and the next tick we'll fill in. */
  private local = new Map<number, Pad>();
  private sendTick: number;
  /** The other side's pads by tick; every tick below `remoteNext` has arrived. */
  private remote = new Map<number, Pad>();
  private remoteNext = 0;
  /** The other side has all our pads below this. */
  private acked = 0;
  /** The other side's tick by its latest packet, and when that came. */
  private peerTick = 0;
  private peerTickAt = 0;
  private hashes = new Map<number, number>();
  private peerHashes = new Map<number, number>();
  private localPause = false;
  private peerPause = false;
  private lastHeard: number;
  private lastSent = -1e9;
  private lastPing = -1e9;
  private adaptAt: number;
  private lowerVotes = 0;
  private stallsAtAdapt = 0;

  constructor(private readonly tx: Transport, o: LockstepOptions) {
    this.side = o.side;
    this.epoch = o.epoch & 0xff;
    this.delay = clampDelay(o.delay ?? DEFAULT_DELAY);
    this.adaptive = o.adaptive ?? true;
    this.now = o.now ?? (() => performance.now());
    this.hashEvery = o.hashEvery ?? HASH_EVERY;
    // The first `delay` ticks have nothing read for them: empty pads (sent like any other, so the other side
    // needn't assume anything about our delay).
    for (let t = 0; t < this.delay; t++) this.local.set(t, EMPTY_PAD_Q);
    this.sendTick = this.delay;
    this.lastHeard = this.now();
    this.adaptAt = this.now() + ADAPT_MS;
  }

  get paused(): boolean {
    return this.localPause || this.peerPause;
  }

  get pausedByPeer(): boolean {
    return this.peerPause;
  }

  get running(): boolean {
    return this.status === 'play';
  }

  /**
   * The pads for the next tick, both sides' (index = side), or null when the sim has to wait (the other side's
   * pad for it hasn't come, paused, or stopped). `sample` reads this machine's pad: called at most once a call,
   * only when a new local tick needs one.
   */
  next(sample: () => Pad): readonly [Pad, Pad] | null {
    if (this.status !== 'play' || this.paused) return null;
    const t = this.tick;
    if (this.sendTick <= t + this.delay) {
      const pad = quantizePad(sample());
      // (A longer delay than last tick: the new tick gets this pad too.)
      while (this.sendTick <= t + this.delay) this.local.set(this.sendTick++, pad);
      this.flush(true);
    }
    const theirs = this.remote.get(t);
    const mine = this.local.get(t);
    if (!theirs || !mine) {
      this.stalls++;
      return null;
    }
    this.remote.delete(t);
    this.tick = t + 1;
    return this.side === 0 ? [mine, theirs] : [theirs, mine];
  }

  /** Call after the sim has stepped the tick next() returned: the state hash every HASH_EVERY ticks. */
  stepped(m: Match): void {
    if (this.tick % this.hashEvery !== 0) return;
    const h = stateHash(m);
    this.hashes.set(this.tick, h);
    this.sendCtl({ t: 'hash', e: this.epoch, k: this.tick, h });
    this.compare(this.tick);
    // Old ones can go: anything a few checks back has been compared (or never will be).
    for (const k of this.hashes.keys()) if (k < this.tick - this.hashEvery * 8) this.hashes.delete(k);
  }

  /** Once a frame: resends, pings, the timeout, the delay. */
  update(): void {
    if (this.status !== 'play') return;
    const now = this.now();
    if (now - this.lastHeard > (this.paused ? PAUSED_TIMEOUT_MS : TIMEOUT_MS)) {
      this.lose('Connection timed out: nothing from the other player for a few seconds.');
      return;
    }
    this.flush(false);
    if (now - this.lastPing >= PING_MS) {
      this.lastPing = now;
      this.tx.send(JSON.stringify({ t: 'ping', ts: now } satisfies LockMsg), false);
    }
    if (this.adaptive && now >= this.adaptAt) this.adapt(now);
  }

  /**
   * Real-time scale for the fixed-step accumulator: below 1 while this side is ahead of the other (it lets the
   * other catch up rather than stalling on its pads), 1 otherwise.
   */
  pace(): number {
    if (this.status !== 'play' || this.paused || this.packets === 0) return 1;
    // Where the other side is now: its tick in its last packet, plus the time that packet took and has been here
    // (a stalled side isn't moving, so not more than a few ticks' worth of that).
    const since = Math.min(this.now() - this.peerTickAt, 100);
    const peerNow = this.peerTick + (Math.max(0, this.rtt) / 2 + since) / TICK_MS;
    const ahead = this.tick - peerNow;
    return ahead > 3 ? 0.9 : ahead > 1.5 ? 0.97 : 1;
  }

  /** How many ticks this side is ahead of the other, by the last word from it (debug HUD). */
  get lead(): number {
    return this.tick - this.peerTick;
  }

  setPaused(on: boolean): void {
    if (this.localPause === on || this.status !== 'play') return;
    this.localPause = on;
    this.sendCtl({ t: 'pause', e: this.epoch, on });
    this.onPause?.(this.paused, false);
  }

  /** Leave (quit, back to the menu): tells the other side. */
  leave(reason = 'The other player left the match.'): void {
    if (this.status === 'play') this.sendCtl({ t: 'bye', reason });
    this.status = 'lost';
    this.reason = 'You left.';
  }

  /**
   * Feed a message from the link. True if it was the engine's (an input packet, or one of its control
   * messages); false for anything else (the lobby's), which the caller handles.
   */
  receive(data: NetData): boolean {
    if (typeof data !== 'string') {
      const pkt = decodeInput(data);
      if (!pkt) return false;
      if (pkt.epoch !== this.epoch) return true;
      this.heard();
      this.takeInput(pkt);
      return true;
    }
    let m: LockMsg;
    try {
      m = JSON.parse(data) as LockMsg;
    } catch {
      return false;
    }
    switch (m.t) {
      case 'ping':
        this.heard();
        this.tx.send(JSON.stringify({ t: 'pong', ts: m.ts } satisfies LockMsg), false);
        return true;
      case 'pong': {
        this.heard();
        const s = this.now() - m.ts;
        if (s >= 0 && s < 10_000) {
          if (this.rtt < 0) this.rtt = s;
          else {
            this.rttDev = this.rttDev * 0.75 + Math.abs(s - this.rtt) * 0.25;
            this.rtt = this.rtt * 0.8 + s * 0.2;
          }
        }
        return true;
      }
      case 'hash':
        if (m.e !== this.epoch) return true;
        this.heard();
        this.peerHashes.set(m.k, m.h);
        this.compare(m.k);
        for (const k of this.peerHashes.keys()) if (k < this.tick - this.hashEvery * 8) this.peerHashes.delete(k);
        return true;
      case 'pause':
        if (m.e !== this.epoch) return true;
        this.heard();
        if (this.peerPause !== m.on) {
          this.peerPause = m.on;
          // (The quiet while he's paused is no timeout: his pings keep coming.)
          this.onPause?.(this.paused, true);
        }
        return true;
      case 'bye':
        if (this.status === 'play') this.lose(m.reason || 'The other player left the match.');
        return true;
      default:
        return false;
    }
  }

  /** The link itself went down. */
  linkClosed(reason: string): void {
    if (this.status === 'play') this.lose(reason || 'Connection closed.');
  }

  // ---------------------------------------------------------------- internals

  private heard(): void {
    this.lastHeard = this.now();
  }

  private takeInput(p: InputPacket): void {
    this.packets++;
    for (let i = 0; i < p.pads.length; i++) {
      const t = p.first + i;
      if (t < this.remoteNext || this.remote.has(t)) {
        this.dupes++;
        continue;
      }
      this.remote.set(t, p.pads[i]);
    }
    while (this.remote.has(this.remoteNext)) this.remoteNext++;
    // (A pad for a tick already stepped would be an old duplicate: those were deleted, and are below remoteNext.)
    if (p.ack > this.acked) this.acked = p.ack;
    if (p.tick > this.peerTick) {
      this.peerTick = p.tick;
      this.peerTickAt = this.now();
    }
  }

  /** Send every pad the other side hasn't acknowledged (at most MAX_PADS from the oldest), with our ack. */
  private flush(force: boolean): void {
    const now = this.now();
    if (!force && now - this.lastSent < RESEND_MS) return;
    // Pads below `acked` the other side has; our own sim may still need some of them, so they stay in `local`
    // until both are done with them.
    const from = this.acked;
    const to = Math.min(this.sendTick, from + MAX_PADS);
    const pads: Pad[] = [];
    for (let t = from; t < to; t++) {
      const p = this.local.get(t);
      if (!p) break;
      pads.push(p);
    }
    // (Nothing unacknowledged: an empty packet still carries our ack and lead, and keeps the link warm.)
    this.lastSent = now;
    this.tx.send(encodeInput({ epoch: this.epoch, first: from, ack: this.remoteNext, tick: this.tick, pads }), false);
    // (Done with: the other side has it and our sim has used it.)
    for (const t of this.local.keys()) if (t < this.acked && t < this.tick) this.local.delete(t);
  }

  private compare(k: number): void {
    const a = this.hashes.get(k);
    const b = this.peerHashes.get(k);
    if (a === undefined || b === undefined || this.status !== 'play') return;
    if (a !== b) {
      this.status = 'desync';
      this.reason = 'Connection lost sync: the two games no longer match.';
      this.desyncAt = { tick: k, local: a, remote: b };
      this.onDesync?.(k);
    }
  }

  private adapt(now: number): void {
    this.adaptAt = now + ADAPT_MS;
    const stalled = this.stalls - this.stallsAtAdapt;
    this.stallsAtAdapt = this.stalls;
    if (this.rtt < 0) return;
    // The other side's pad for tick t leaves it `delay` ticks before t: it needs to cross in less than that,
    // with room for the jitter.
    const need = (this.rtt / 2 + 2 * this.rttDev + 4) / TICK_MS;
    let want = clampDelay(Math.ceil(need) + 1);
    if (stalled >= STALL_RAISE) want = Math.max(want, clampDelay(this.delay + 1));
    if (want > this.delay) {
      this.delay = Math.min(want, this.delay + 2);
      this.lowerVotes = 0;
    } else if (want < this.delay) {
      if (++this.lowerVotes >= LOWER_AFTER) {
        this.delay--;
        this.lowerVotes = 0;
      }
    } else this.lowerVotes = 0;
  }

  private lose(reason: string): void {
    this.status = 'lost';
    this.reason = reason;
    this.onLost?.(reason);
  }

  private sendCtl(m: LockMsg): void {
    this.tx.send(JSON.stringify(m), true);
  }
}

const EMPTY_PAD_Q = quantizePad(EMPTY_PAD);

function clampDelay(d: number): number {
  return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.round(d)));
}
