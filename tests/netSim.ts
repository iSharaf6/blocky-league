import { stateHash } from '../src/net/hash';
import { Lockstep, type LockstepOptions } from '../src/net/lockstep';
import { applyNetControls, netConfig as setupConfig, netStoppages, type MatchSetup } from '../src/net/setup';
import { transportPair, type Transport } from '../src/net/transport';
import { DT } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import type { Side } from '../src/sim/types';
import { FuzzPad } from './netHarness';

/**
 * A simulated network for the lockstep tests, on a virtual clock: each direction's unreliable messages are
 * dropped with probability `loss`, the rest delayed by `latency` ms (a random span: later ones overtake earlier
 * ones, so it reorders too); reliable ones never drop and stay in order (latency as well). Its own LCG.
 */
export class NetSim {
  now = 0;
  delivered = 0;
  dropped = 0;
  /** Tamper with an unreliable message in flight (return the one to deliver, or null to drop it). */
  tamper: ((data: ArrayBuffer | string, from: 0 | 1) => ArrayBuffer | string | null) | null = null;
  /** Nothing gets through from this side while set (a pulled cable). */
  cut: [boolean, boolean] = [false, false];
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  private dirty = false;
  private lastReliable: [number, number] = [0, 0];
  private s: number;

  constructor(private readonly o: { loss: number; latency: [number, number]; seed: number }) {
    this.s = (Math.imul(o.seed + 7, 2654435761) >>> 0) || 1;
  }

  rnd(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  pair(): [Transport, Transport] {
    // (The pair calls deliver with a closure holding a copy; tampering needs the data, so wrap send instead.)
    const [a, b] = transportPair((fn, reliable, from) => this.schedule(fn, reliable, from));
    for (const [t, from] of [[a, 0], [b, 1]] as const) {
      const send = t.send.bind(t);
      t.send = (data, reliable) => {
        if (this.cut[from]) return;
        if (!reliable && this.tamper) {
          const d = this.tamper(data, from);
          if (d === null) return;
          data = d;
        }
        send(data, reliable);
      };
    }
    return [a, b];
  }

  private schedule(fn: () => void, reliable: boolean, from: 0 | 1): void {
    const [lo, hi] = this.o.latency;
    let at = this.now + lo + this.rnd() * (hi - lo);
    if (reliable) {
      at = Math.max(at, this.lastReliable[from] + 0.01);
      this.lastReliable[from] = at;
    } else if (this.rnd() < this.o.loss) {
      this.dropped++;
      return;
    }
    this.q.push({ at, seq: this.seq++, fn });
    this.dirty = true;
  }

  /** Move the clock on to `t`, delivering everything due by then (in time order). */
  advance(t: number): void {
    this.now = t;
    if (this.dirty) {
      this.q.sort((x, y) => x.at - y.at || x.seq - y.seq);
      this.dirty = false;
    }
    while (this.q.length && this.q[0].at <= t) {
      const e = this.q.shift()!;
      this.delivered++;
      e.fn();
    }
  }
}

/** One peer of a simulated online match: its own Match, its lockstep engine, a masher on its pad. */
export class SimPeer {
  readonly m: Match;
  readonly lock: Lockstep;
  readonly pad: FuzzPad;
  /** stateHash after every tick it has stepped (index = tick - 1). */
  readonly hashes: number[] = [];
  private acc = 0;
  /** This peer's frame length (ms): the two needn't run at the same rate. */
  frameMs: number;
  /** Follow the engine's time sync (Lockstep.pace); off, a faster side keeps running into the slower one's pads. */
  usePace = true;
  /** How fast its game clock runs against real time (below 1: a machine that can't keep up). */
  rate = 1;

  constructor(tx: Transport, readonly side: Side, setup: MatchSetup, net: NetSim, opts: Partial<LockstepOptions> = {}, frameMs = 1000 / 60) {
    this.m = new Match(setupConfig(setup, side));
    applyNetControls(this.m, setup);
    this.pad = new FuzzPad(setup.seed * 2 + side);
    this.lock = new Lockstep(tx, { side, epoch: setup.epoch, delay: setup.delay, now: () => net.now, ...opts });
    tx.onMessage = (d) => {
      this.lock.receive(d);
    };
    tx.onClose = (r) => this.lock.linkClosed(r);
    this.frameMs = frameMs;
  }

  /** One display frame of `ms`: what MatchSession.update does with a lockstep driver. */
  frame(ms: number): void {
    this.lock.update();
    this.acc += (ms / 1000) * this.rate * (this.usePace ? this.lock.pace() : 1);
    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      const pads = this.lock.next(() => this.pad.pad());
      if (!pads) {
        this.acc = Math.min(this.acc, DT);
        break;
      }
      this.m.step(DT, pads);
      this.m.drainEvents();
      this.lock.stepped(this.m);
      netStoppages(this.m);
      this.hashes.push(stateHash(this.m));
      this.acc -= DT;
      steps++;
    }
    if (steps === 6) this.acc = 0;
  }
}

export function testSetup(o: Partial<MatchSetup> = {}): MatchSetup {
  const c = { groundAssist: 'assisted', throughAssist: 'assisted', autoSwitch: true, moveAssist: true, timedFinish: true, quickPass: true } as const;
  return {
    epoch: 0, seed: 4242, home: 5, away: 6, mode: 'classic', halfMinutes: 1, timeOfDay: 'day', weather: 'clear',
    controls: [{ ...c }, { ...c, groundAssist: 'semi', quickPass: false }], delay: 4, ...o,
  };
}

/**
 * Runs two peers over `net` until both reach full time (or `maxMs` of virtual time), each on its own frame
 * clock. `onFrame` runs once a virtual millisecond step (fault injection).
 */
export function runPeers(net: NetSim, a: SimPeer, b: SimPeer, maxMs = 30 * 60_000, onFrame?: (t: number) => void): void {
  let nextA = 0;
  let nextB = 0;
  for (let t = 0; t < maxMs; t += 1) {
    net.advance(t);
    onFrame?.(t);
    if (t >= nextA) {
      a.frame(a.frameMs);
      nextA += a.frameMs;
    }
    if (t >= nextB) {
      b.frame(b.frameMs);
      nextB += b.frameMs;
    }
    const done = (p: SimPeer) => p.m.phase === 'fulltime' || !p.lock.running;
    if (done(a) && done(b)) break;
  }
}
