import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/net/hash';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { decodeInput, encodeInput, quantizePad, DELAY_MAX, DELAY_MIN, HASH_EVERY, TIMEOUT_MS } from '../src/net/lockstep';
import { buildSdp, codeToSdp, parseSdp, sdpToCode } from '../src/net/sdpCode';
import { HumanBot } from './humanBot';
import { FuzzPad, netConfig, runToEnd, stoppages } from './netHarness';
import { NetSim, runPeers, SimPeer, testSetup } from './netSim';

/**
 * Online play is deterministic lockstep: both peers run the same sim on the same pads. These tests pin that
 * down: single-player is bit-identical to what it was before two-human support, two sims fed the same pads stay
 * identical every tick (whichever side each one views), and (below) the lockstep engine keeps two peers identical
 * over a bad network and notices when they aren't.
 */

/**
 * End-state hash, a fold of the hash every 60 steps, the step count and the score, recorded with the sim as it
 * was before MatchConfig.humanSides / Match.ctl (commit bb34939) by the same drivers as below.
 */
const BEFORE = {
  aiClassic: [2077768361, 1578466246, 18111, [0, 0]],
  aiBlitz: [1735493330, 1863915192, 11618, [0, 4]],
  botSide0: [4019672980, 1082181710, 15214, [3, 0]],
  fuzzSide1: [3273114491, 3761332502, 11420, [2, 0]],
  fuzzBlitz0: [3222048373, 3000282187, 11826, [0, 3]],
  ko1: [3491640593, 2415376323, 5398, [0, 0]],
  ko6: [583792695, 3974704757, 6495, [0, 0]],
  ko3: [779716697, 1298573416, 3468, [2, 0]],
} as const;

const summary = (r: { end: number; trail: number; steps: number; m: Match }) => [r.end, r.trail, r.steps, [...r.m.score]];

describe('single-player stays bit-identical', () => {
  it('AI v AI, classic and blitz', () => {
    const a = runToEnd(new Match(netConfig({ seed: 7, halfLength: 150, difficulty: 2 })), () => EMPTY_PAD, [false, false]);
    expect(summary(a)).toEqual(BEFORE.aiClassic);
    const b = runToEnd(new Match(netConfig({ seed: 31, halfLength: 90, difficulty: 3, mode: 'blitz' })), () => EMPTY_PAD, [false, false]);
    expect(summary(b)).toEqual(BEFORE.aiBlitz);
  }, 60_000);

  it('one human (the scripted bot on side 0; a masher on side 1 with non-default controls; blitz)', () => {
    const m = new Match(netConfig({ seed: 11, halfLength: 120, difficulty: 1.8, humanSide: 0 }));
    const bot = new HumanBot(11);
    let steps = 0;
    let trail = 0;
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 16) {
      const pad = bot.pad(m);
      const before = m.ball.owner;
      m.step(DT, pad);
      bot.observe(m, m.drainEvents(), before);
      stoppages(m, [true, false]);
      steps++;
      if (steps % 60 === 0) trail = (Math.imul(trail ^ stateHash(m), 16777619) + steps) >>> 0;
    }
    expect([stateHash(m), trail, steps, [...m.score]]).toEqual(BEFORE.botSide0);

    const m1 = new Match(netConfig({ seed: 5, halfLength: 90, difficulty: 3, humanSide: 1 }));
    m1.groundAssist = 'manual';
    m1.throughAssist = 'semi';
    m1.quickPass = false;
    m1.autoSwitch = false;
    const f1 = new FuzzPad(5);
    expect(summary(runToEnd(m1, () => f1.pad(), [false, true]))).toEqual(BEFORE.fuzzSide1);

    const f2 = new FuzzPad(9);
    const m2 = new Match(netConfig({ seed: 9, halfLength: 90, difficulty: 1.8, humanSide: 0, mode: 'blitz' }));
    expect(summary(runToEnd(m2, () => f2.pad(), [true, false]))).toEqual(BEFORE.fuzzBlitz0);
  }, 60_000);

  it('knockout ties, through a penalty shootout', () => {
    for (const [seed, want] of [[1, BEFORE.ko1], [6, BEFORE.ko6], [3, BEFORE.ko3]] as const) {
      const m = new Match(netConfig({ seed, halfLength: 25, difficulty: 1.8, humanSide: 1, knockout: true }));
      const f = new FuzzPad(seed);
      const r = runToEnd(m, () => f.pad(), [false, true]);
      expect(summary(r)).toEqual(want);
      expect(!!m.shootout).toBe(seed !== 3);
    }
  }, 60_000);
});

describe('two human sides', () => {
  /** Two sims of one online match, as the two peers run it: the same config but each viewing its own side. */
  const pair = (seed: number, extra: Partial<Parameters<typeof netConfig>[0]> = {}) => {
    const cfg = (humanSide: 0 | 1) => netConfig({ seed, halfLength: 60, difficulty: 1.8, humanSide, humanSides: [true, true], ...extra });
    return [new Match(cfg(0)), new Match(cfg(1))] as const;
  };

  it('two sims fed the same pads stay identical every tick, whichever side each views', () => {
    const [a, b] = pair(21);
    // Each peer's own settings, agreed at the lobby: they are per side, whoever is looking.
    for (const m of [a, b]) {
      m.ctl[1].groundAssist = 'semi';
      m.ctl[1].quickPass = false;
      m.ctl[0].timedFinish = false;
    }
    const p0 = new FuzzPad(1);
    const p1 = new FuzzPad(2);
    let steps = 0;
    const seen = { active0: new Set<number>(), active1: new Set<number>() };
    while (a.phase !== 'fulltime' && steps < 60 * 60 * 10) {
      const pads: [Pad, Pad] = [p0.pad(), p1.pad()];
      a.step(DT, pads);
      b.step(DT, pads);
      a.drainEvents();
      b.drainEvents();
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      steps++;
      const ha = stateHash(a);
      const hb = stateHash(b);
      if (ha !== hb) throw new Error(`diverged at step ${steps}`);
      seen.active0.add(a.ctl[0].active);
      seen.active1.add(a.ctl[1].active);
    }
    expect(a.phase).toBe('fulltime');
    expect(b.phase).toBe('fulltime');
    // Both humans really played: each side's control moved round his team, and each view reads its own.
    expect(seen.active0.size).toBeGreaterThan(3);
    expect(seen.active1.size).toBeGreaterThan(3);
    expect(a.active).toBe(a.ctl[0].active);
    expect(b.active).toBe(b.ctl[1].active);
    // ...and it is not the AI playing both: an AI v AI match from the same seed goes differently.
    const ai = runToEnd(new Match(netConfig({ seed: 21, halfLength: 60, difficulty: 1.8 })), () => EMPTY_PAD, [false, false]);
    expect(ai.end).not.toBe(stateHash(a));
  }, 60_000);

  it('each human switches, passes and tackles for his own side (the scripted bot on side 0)', () => {
    const [a, b] = pair(33);
    const bot = new HumanBot(33);
    const p1 = new FuzzPad(7);
    let steps = 0;
    const humanKicks = [0, 0];
    while (a.phase !== 'fulltime' && steps < 60 * 60 * 10) {
      // (The bot reads the side-0 view; the same pads go to both peers.)
      const pads: [Pad, Pad] = [bot.pad(a), p1.pad()];
      const before = a.ball.owner;
      const act = [a.ctl[0].active, a.ctl[1].active];
      a.step(DT, pads);
      b.step(DT, pads);
      const ev = a.drainEvents();
      b.drainEvents();
      bot.observe(a, ev, before);
      // (A strike by the man a human had just then: his pass, shot or clearance.)
      const k = a.ball.lastTouch;
      if (k >= 0 && ev.some((e) => e.type === 'kick') && k === act[a.players[k].side]) humanKicks[a.players[k].side]++;
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      steps++;
      expect(stateHash(b)).toBe(stateHash(a));
    }
    expect(humanKicks[0]).toBeGreaterThan(10);
    expect(humanKicks[1]).toBeGreaterThan(5);
    expect(bot.tally.passes).toBeGreaterThan(5);
  }, 60_000);

  it('blitz with two humans: each side presses its own power-up', () => {
    const [a, b] = pair(12, { mode: 'blitz' });
    const p0 = new FuzzPad(3);
    const p1 = new FuzzPad(4);
    let used = [0, 0];
    for (let steps = 0; a.phase !== 'fulltime' && steps < 60 * 60 * 10; steps++) {
      const pads: [Pad, Pad] = [p0.pad(), p1.pad()];
      a.step(DT, pads);
      b.step(DT, pads);
      for (const e of a.drainEvents()) if (e.type === 'powerupUsed') used = used.map((n, s) => n + (e.side === s ? 1 : 0));
      b.drainEvents();
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      expect(stateHash(b)).toBe(stateHash(a));
    }
    expect(used[0] + used[1]).toBeGreaterThan(0);
  }, 60_000);
});

describe('lockstep engine', () => {
  /** Both peers' per-tick hashes agree over every tick both stepped. */
  const agree = (a: SimPeer, b: SimPeer): number => {
    const n = Math.min(a.hashes.length, b.hashes.length);
    for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(`peers diverged at tick ${i + 1}`);
    return n;
  };

  it('keeps both peers bit-identical through a full match over a bad network (10% loss, 20-120 ms, reordering)', () => {
    const net = new NetSim({ loss: 0.1, latency: [20, 120], seed: 1 });
    const [ta, tb] = net.pair();
    const setup = testSetup({ seed: 777 });
    const a = new SimPeer(ta, 0, setup, net);
    // (The guest's display runs a little slower: 17.2 ms frames.)
    const b = new SimPeer(tb, 1, setup, net, {}, 17.2);
    runPeers(net, a, b);
    expect(a.lock.status).toBe('play');
    expect(b.lock.status).toBe('play');
    expect(a.m.phase).toBe('fulltime');
    expect(b.m.phase).toBe('fulltime');
    const n = agree(a, b);
    expect(n).toBeGreaterThan(60 * 110);
    expect(a.hashes.length).toBe(b.hashes.length);
    expect(stateHash(a.m)).toBe(stateHash(b.m));
    expect([...a.m.score]).toEqual([...b.m.score]);
    // The network really was that bad, the redundancy covered it, and the hash checks ran and passed.
    expect(net.dropped).toBeGreaterThan(500);
    expect(a.lock.dupes + b.lock.dupes).toBeGreaterThan(1000);
    expect(a.lock.desyncAt).toBeNull();
    expect(b.lock.desyncAt).toBeNull();
    // A ~140 ms round trip on average wants more than the default 4 ticks of delay; it stays within the range.
    for (const p of [a, b]) {
      expect(p.lock.delay).toBeGreaterThanOrEqual(5);
      expect(p.lock.delay).toBeLessThanOrEqual(DELAY_MAX);
      expect(p.lock.rtt).toBeGreaterThan(80);
      expect(p.lock.rtt).toBeLessThan(260);
    }
    // Both humans played, and it wasn't a stall-fest: the stall count stays a small share of the ticks.
    expect(a.m.stats.passes[0] + a.m.stats.passes[1]).toBeGreaterThan(5);
    expect(a.lock.stalls + b.lock.stalls).toBeLessThan(n * 0.25);
  }, 120_000);

  it('a clean LAN keeps the delay low (2-4 ticks) and hardly stalls', () => {
    const net = new NetSim({ loss: 0, latency: [1, 4], seed: 2 });
    const [ta, tb] = net.pair();
    const setup = testSetup({ seed: 99, halfMinutes: 0.5 });
    const a = new SimPeer(ta, 0, setup, net);
    const b = new SimPeer(tb, 1, setup, net);
    runPeers(net, a, b);
    agree(a, b);
    expect(a.m.phase).toBe('fulltime');
    expect(stateHash(a.m)).toBe(stateHash(b.m));
    for (const p of [a, b]) {
      expect(p.lock.delay).toBeGreaterThanOrEqual(DELAY_MIN);
      expect(p.lock.delay).toBeLessThanOrEqual(4);
    }
    expect(a.lock.stalls + b.lock.stalls).toBeLessThan(200);
  }, 60_000);

  it("a side whose game runs slow (90% speed) is the time sync's to absorb, not a reason for a longer delay", () => {
    const run = (sync: boolean) => {
      const net = new NetSim({ loss: 0, latency: [2, 6], seed: 12 });
      const [ta, tb] = net.pair();
      const setup = testSetup({ seed: 123, halfMinutes: 0.5 });
      const a = new SimPeer(ta, 0, setup, net);
      const b = new SimPeer(tb, 1, setup, net, {}, 20);
      b.rate = 0.9;
      a.usePace = sync;
      runPeers(net, a, b);
      // (Identical tick by tick; one may have stood at full time a little longer when the run stopped.)
      expect(agree(a, b)).toBeGreaterThan(60 * 60);
      expect(a.m.phase).toBe('fulltime');
      expect([...a.m.score]).toEqual([...b.m.score]);
      return { a, b };
    };
    // With the time sync, the full-speed side eases to the other's pace: few waits, and the delay stays short.
    const synced = run(true);
    expect(synced.a.lock.stalls + synced.b.lock.stalls).toBeLessThan(60);
    for (const p of [synced.a, synced.b]) expect(p.lock.delay).toBeLessThanOrEqual(4);
    // Without it, the full-speed side keeps running into the slow one's pads; those waits aren't the network's,
    // and the delay still stays short.
    const raw = run(false);
    expect(raw.a.lock.stalls).toBeGreaterThan(500);
    expect(raw.a.lock.lateStalls).toBeLessThan(raw.a.lock.stalls * 0.1);
    for (const p of [raw.a, raw.b]) expect(p.lock.delay).toBeLessThanOrEqual(4);
  }, 60_000);

  it('detects a desync when a pad is corrupted in flight (and both sides stop)', () => {
    const net = new NetSim({ loss: 0.05, latency: [10, 40], seed: 3 });
    const [ta, tb] = net.pair();
    const setup = testSetup({ seed: 31337, halfMinutes: 1 });
    const a = new SimPeer(ta, 0, setup, net);
    const b = new SimPeer(tb, 1, setup, net);
    // Every copy of the host's pad for tick 900 reaches the guest with the stick changed: the guest's sim steps
    // a different game from there on.
    const BAD = 900;
    net.tamper = (data, from) => {
      if (from !== 0 || typeof data === 'string') return data;
      const p = decodeInput(data);
      if (!p || BAD < p.first || BAD >= p.first + p.pads.length) return data;
      const pads = p.pads.slice();
      const o = pads[BAD - p.first];
      pads[BAD - p.first] = quantizePad({ ...o, mx: o.mx > 0 ? -1 : 1, mz: 0.5, sprint: !o.sprint });
      return encodeInput({ ...p, pads });
    };
    let desyncs = 0;
    a.lock.onDesync = () => desyncs++;
    b.lock.onDesync = () => desyncs++;
    runPeers(net, a, b, 5 * 60_000);
    expect(a.lock.status).toBe('desync');
    expect(b.lock.status).toBe('desync');
    expect(desyncs).toBe(2);
    // Caught at the first hash check after the bad tick.
    const at = a.lock.desyncAt!.tick;
    expect(at).toBeGreaterThan(BAD);
    expect(at).toBeLessThanOrEqual(BAD + HASH_EVERY);
    expect(a.lock.reason).toMatch(/lost sync/i);
    // Neither sim runs on past it.
    expect(a.lock.next(() => EMPTY_PAD)).toBeNull();
    expect(a.hashes.length).toBeLessThan(at + 60);
  }, 60_000);

  it('pauses both sides and resumes in step', () => {
    const net = new NetSim({ loss: 0.1, latency: [20, 60], seed: 4 });
    const [ta, tb] = net.pair();
    const setup = testSetup({ seed: 5, halfMinutes: 0.5 });
    const a = new SimPeer(ta, 0, setup, net);
    const b = new SimPeer(tb, 1, setup, net);
    const seen: [boolean, boolean][] = [];
    b.lock.onPause = (paused, byPeer) => seen.push([paused, byPeer]);
    let pausedAt = -1;
    let bTickAtPause = -1;
    runPeers(net, a, b, 10 * 60_000, (t) => {
      if (t === 10_000) {
        a.lock.setPaused(true);
        pausedAt = a.lock.tick;
      }
      if (t === 14_000) bTickAtPause = b.lock.tick;
      if (t === 20_000) a.lock.setPaused(false);
    });
    // B stopped within a few ticks of A (it only has A's pads up to A's delay ahead), and waited out the pause.
    expect(bTickAtPause - pausedAt).toBeLessThanOrEqual(DELAY_MAX + 1);
    expect(seen).toEqual([[true, true], [false, true]]);
    // Ten seconds of pause is no timeout.
    expect(a.lock.status).toBe('play');
    expect(b.lock.status).toBe('play');
    expect(a.m.phase).toBe('fulltime');
    agree(a, b);
    expect(stateHash(a.m)).toBe(stateHash(b.m));
  }, 60_000);

  it('notices the other side leaving, the link closing, and the silence of a dead link', () => {
    const run = (fault: (net: NetSim, a: SimPeer, b: SimPeer, ta: { close(): void }) => void) => {
      const net = new NetSim({ loss: 0, latency: [5, 10], seed: 6 });
      const [ta, tb] = net.pair();
      const setup = testSetup({ seed: 8 });
      const a = new SimPeer(ta, 0, setup, net);
      const b = new SimPeer(tb, 1, setup, net);
      let lostB = '';
      b.lock.onLost = (r) => (lostB = r);
      runPeers(net, a, b, 40_000, (t) => {
        if (t === 5_000) fault(net, a, b, ta);
      });
      return { a, b, lostB };
    };
    type Fault = (net: NetSim, a: SimPeer, b: SimPeer, ta: { close(): void }) => void;
    const leave: Fault = (_n, a) => a.lock.leave();
    const quit = run(leave);
    expect(quit.b.lock.status).toBe('lost');
    expect(quit.lostB).toMatch(/left/i);
    const close: Fault = (_n, _a, _b, ta) => ta.close();
    expect(run(close).b.lock.status).toBe('lost');
    const pull: Fault = (net) => (net.cut = [true, false]);
    const cable = run(pull);
    expect(cable.b.lock.status).toBe('lost');
    expect(cable.lostB).toMatch(/timed out/i);
    // (It stalled first, waiting: it never ran far past the cut, and gave up after TIMEOUT_MS of silence.)
    expect(cable.b.lock.tick).toBeLessThan(60 * 6);
    expect(TIMEOUT_MS).toBeLessThan(35_000);
  }, 60_000);

  it("a rematch on the same link ignores the last match's stragglers", () => {
    const net = new NetSim({ loss: 0.1, latency: [20, 150], seed: 9 });
    const [ta, tb] = net.pair();
    const s0 = testSetup({ seed: 1, halfMinutes: 0.25 });
    const a0 = new SimPeer(ta, 0, s0, net);
    const b0 = new SimPeer(tb, 1, s0, net);
    runPeers(net, a0, b0);
    expect(a0.m.phase).toBe('fulltime');
    // The next match starts at once, with the old one's packets still in flight.
    const s1 = testSetup({ seed: 2, halfMinutes: 0.25, epoch: 1 });
    const a1 = new SimPeer(ta, 0, s1, net);
    const b1 = new SimPeer(tb, 1, s1, net);
    runPeers(net, a1, b1);
    expect(a1.m.phase).toBe('fulltime');
    agree(a1, b1);
    expect(stateHash(a1.m)).toBe(stateHash(b1.m));
  }, 60_000);

  it('pads survive the wire exactly as the local sim used them', () => {
    const f = new FuzzPad(3);
    const pads = Array.from({ length: 30 }, () => quantizePad(f.pad()));
    const back = decodeInput(encodeInput({ epoch: 7, first: 123456, ack: 99, tick: 123450, pads }))!;
    expect(back.pads).toEqual(pads);
    expect([back.epoch, back.first, back.ack, back.tick]).toEqual([7, 123456, 99, 123450]);
    // A tiny negative stick is +0 on both sides of the wire, never -0 on the sender's (atan2 tells them apart).
    const z = quantizePad({ ...EMPTY_PAD, mx: -0.001, mz: -0 });
    expect(Object.is(z.mx, 0) && Object.is(z.mz, 0)).toBe(true);
    // A digital diagonal stays a unit-length 45-degree stick (isDigitalStick still reads it as keys).
    const d = quantizePad({ ...EMPTY_PAD, mx: Math.SQRT1_2, mz: Math.SQRT1_2 });
    expect(Math.abs(Math.hypot(d.mx, d.mz) - 1)).toBeLessThan(0.02);
    // 15 bytes of header and 3 a pad.
    expect(encodeInput({ epoch: 0, first: 0, ack: 0, tick: 0, pads: pads.slice(0, 8) }).byteLength).toBe(39);
  });
});

describe('offer / answer codes (manual WebRTC signalling)', () => {
  const FP = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(':');
  // Shaped like what Chrome and Firefox produce for a data-channel-only offer (ICE gathered in full).
  const CHROME = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    'm=application 54321 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 203.0.113.7',
    'a=candidate:2999745851 1 udp 2122260223 3b0c5f2a-1b2c-4d5e-8f90-a1b2c3d4e5f6.local 54321 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:842163049 1 udp 1686052607 203.0.113.7 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10',
    'a=candidate:1510613869 1 tcp 1518280447 3b0c5f2a-1b2c-4d5e-8f90-a1b2c3d4e5f6.local 9 typ host tcptype active generation 0',
    'a=ice-ufrag:Ab3d', 'a=ice-pwd:0123456789abcdefghijklmn', 'a=ice-options:trickle', `a=fingerprint:sha-256 ${FP}`, 'a=setup:actpass',
    'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
  ].join('\r\n');
  const FIREFOX = [
    'v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 7070718913612410224 0 IN IP4 0.0.0.0', 's=-', 't=0 0', 'a=sendrecv',
    `a=fingerprint:sha-256 ${FP}`, 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    'a=candidate:0 1 UDP 2122252543 192.168.1.20 61234 typ host',
    'a=candidate:1 1 UDP 1686052863 198.51.100.4 61234 typ srflx raddr 192.168.1.20 rport 61234',
    'a=candidate:2 1 UDP 2122187007 2001:db8::1:2 61235 typ host',
    'a=candidate:3 1 TCP 2105524479 192.168.1.20 9 typ host tcptype active', 'a=sendrecv', 'a=end-of-candidates',
    'a=ice-pwd:0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'a=ice-ufrag:9a8b7c6d', 'a=mid:0', 'a=setup:active', 'a=sctp-port:5000',
    'a=max-message-size:1073741823', '',
  ].join('\r\n');

  it('squeezes a description into a short code and back, keeping what the other side needs', async () => {
    for (const [sdp, kind] of [[CHROME, 'offer'], [FIREFOX, 'answer']] as const) {
      const code = await sdpToCode(sdp, kind);
      expect(code[0]).toBe('1');
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThan(170);
      const back = await codeToSdp(code);
      expect(back.kind).toBe(kind);
      // What it rebuilt parses to the same essentials (UDP candidates only; TCP ones are dropped).
      const a = parseSdp(sdp, kind)!;
      const b = parseSdp(back.sdp, kind)!;
      expect({ ...b, fingerprint: [...b.fingerprint] }).toEqual({ ...a, fingerprint: [...a.fingerprint] });
      expect(a.candidates.every((c) => c.port > 0)).toBe(true);
      expect(back.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    }
    const ff = parseSdp(FIREFOX, 'answer')!;
    expect(ff.candidates.map((c) => c.address)).toEqual(['192.168.1.20', '198.51.100.4', '2001:db8:0:0:0:0:1:2']);
    expect(ff.setup).toBe('active');
  });

  it('falls back to the whole description (deflated) when the short form cannot carry it', async () => {
    const odd = CHROME.replace('a=fingerprint:sha-256', 'a=fingerprint:sha-384').replace('a=mid:0', 'a=mid:data');
    const code = await sdpToCode(odd, 'offer');
    expect(code[0]).toBe('2');
    expect(await codeToSdp(code)).toEqual({ kind: 'offer', sdp: odd });
    // A rebuilt description is a valid minimal one in its own right.
    expect(parseSdp(buildSdp(parseSdp(CHROME, 'offer')!), 'offer')).not.toBeNull();
  });

  it('rejects a code that was cut short or mistyped, with a message a player can act on', async () => {
    const code = await sdpToCode(CHROME, 'offer');
    await expect(codeToSdp(code.slice(0, -6))).rejects.toThrow(/incomplete or mistyped/);
    const typo = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    await expect(codeToSdp(typo)).rejects.toThrow(/incomplete or mistyped/);
    await expect(codeToSdp('hello there')).rejects.toThrow(/doesn't look like/);
    // Whitespace from a chat app's line wrapping is fine.
    expect((await codeToSdp(code.slice(0, 30) + '\n  ' + code.slice(30))).kind).toBe('offer');
  });
});
