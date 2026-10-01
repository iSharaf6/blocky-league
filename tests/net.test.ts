import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/net/hash';
import { DT, HALF_L, PEN_SPOT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { decodeInput, encodeInput, quantizePad, DELAY_MAX, DELAY_MIN, HASH_EVERY, TIMEOUT_MS } from '../src/net/lockstep';
import { buildSdp, codeToSdp, parseSdp, sdpToCode } from '../src/net/sdpCode';
import type { Side } from '../src/sim/types';
import { HumanBot } from './humanBot';
import { aiKoRun, koRun, PEN_SCENARIOS, SCENARIOS, type Row } from './netBaseline';
import { FuzzPad, netConfig, runToEnd, stoppages } from './netHarness';
import { NetSim, runPeers, SimPeer, testSetup } from './netSim';

/**
 * Online play is deterministic lockstep: both peers run the same sim on the same pads. These tests pin that
 * down: fixed single-player drivers reproduce the versioned physics baselines below, two sims fed the same pads stay
 * identical every tick (whichever side each one views), and (below) the lockstep engine keeps two peers identical
 * over a bad network and notices when they aren't.
 */

/**
 * tests/netBaseline.ts's table (end-state hash, a fold of the hash every 60 steps, steps, score, shootout),
 * recorded on main at 11c4bed (v1: round 13 plus the placed penalty aim) before MatchConfig.humanSides / Match.ctl
 * were merged onto it, by the very same drivers. (29 rows were recorded and all 29 matched; these are pinned.)
 * Round 14's receive lock (Match.receiveLocked) changed how the human's man takes a pass, so the rows with a human
 * in them (bot*, fuzz*, pen*, ko*) were re-recorded on it; the AI v AI rows (ai*) came out exactly as before.
 * Physics revision 2026-10-02 (NET_VERSION 2) adds early human first-time strikes on untargeted incoming balls.
 * Only the nine human-input rows whose drivers queue that action were re-recorded. Their queue/contact counts
 * are noted below; even a cancelled queue can change movement and possession before contact. All AI rows, the
 * three scripted-bot rows and ko1 keep their exact prior hashes, ticks, scores and shootout flags.
 */
const BEFORE: Record<string, Row> = {
  aiClassic: [2262850705, 2447626034, 19417, 2, 3, 0],
  aiBlitz: [513065991, 663489125, 11382, 0, 2, 0],
  aiStyles: [2891120658, 2774569015, 11673, 1, 2, 0],
  botSide0: [4291927938, 1091955903, 15525, 1, 1, 0],
  botPerks: [2431068158, 403911831, 11880, 4, 1, 0],
  botFirstMatch: [3953689325, 351485200, 11657, 1, 0, 0],
  fuzzSide1: [399059712, 1308671870, 11258, 1, 0, 0], // 1 new queue, 0 contacts
  fuzzBlitz0: [594496695, 1168062696, 11302, 0, 2, 0], // 3 new queues, 1 contact
  fuzzBlitzPerks1: [4063850517, 1852493949, 11103, 1, 0, 0], // 7 new queues, 2 contacts
  penTaker0: [626915086, 958774721, 7537, 1, 1, 0], // 2 new queues, 1 contact
  penTaker1Low: [790814125, 3196858246, 7590, 0, 1, 0], // 2 new queues, 0 contacts
  penTimeout1: [2721849617, 965648269, 7411, 0, 1, 0], // 3 new queues, 2 contacts
  penKeeper1: [483959362, 1474512133, 7381, 1, 0, 0], // 3 new queues, 0 contacts
  ko1: [4291486144, 3361617526, 3773, 1, 0, 0],
  ko3: [1812744883, 1974716986, 3603, 1, 0, 0], // 1 new queue, 1 contact
  ko6: [1838196313, 3688112271, 5716, 0, 0, 1], // 5 new queues, 1 contact
  aiKo1: [47845968, 1192999698, 5817, 0, 0, 1],
  aiKo4: [2291840460, 860824426, 3346, 0, 1, 0],
  aiKo7: [4112032605, 1756315151, 5108, 0, 0, 1],
};

describe('single-player stays bit-identical', () => {
  it('AI v AI: classic, blitz, contrasting team styles', () => {
    for (const k of ['aiClassic', 'aiBlitz', 'aiStyles']) expect(SCENARIOS[k](), k).toEqual(BEFORE[k]);
  }, 60_000);

  it('one human: the scripted bot (plain, with DDA + Club Run perks, first-match onboarding), a masher either side, blitz', () => {
    for (const k of ['botSide0', 'botPerks', 'botFirstMatch', 'fuzzSide1', 'fuzzBlitz0', 'fuzzBlitzPerks1']) {
      expect(SCENARIOS[k](), k).toEqual(BEFORE[k]);
    }
  }, 90_000);

  it("in-match penalties: the human's placed aim (either side, a timed-out one) and the AI's against his keeper", () => {
    for (const k of Object.keys(PEN_SCENARIOS)) expect(PEN_SCENARIOS[k](), k).toEqual(BEFORE[k]);
  }, 60_000);

  it('knockout ties through shootouts, a human taking and keeping, and AI v AI', () => {
    for (const s of [1, 3, 6]) expect(koRun(s), `ko${s}`).toEqual(BEFORE[`ko${s}`]);
    for (const s of [1, 4, 7]) expect(aiKoRun(s), `aiKo${s}`).toEqual(BEFORE[`aiKo${s}`]);
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

  /** Both sims given the same penalty at the same tick (as tests/penalty.test.ts sets one up). */
  const givePenalty = (ms: readonly Match[], side: Side): void => {
    for (const m of ms) {
      Object.assign(m, { phase: 'play', restart: null });
      (m as unknown as { goOut: (k: string, s: number, x: number, z: number) => void }).goOut('penalty', side, m.attackDir(side) * (HALF_L - PEN_SPOT), 0);
    }
  };

  it("either player's in-match penalty: aimed from his own pads, per side, the same on both machines, never shown to the other", () => {
    const [a, b] = pair(61);
    const p0 = new FuzzPad(8);
    const p1 = new FuzzPad(9);
    const step = (pads: [Pad, Pad]) => {
      a.step(DT, pads);
      b.step(DT, pads);
      a.drainEvents();
      b.drainEvents();
      stoppages(a, [true, true]);
      stoppages(b, [true, true]);
      expect(stateHash(b)).toBe(stateHash(a));
    };
    for (let i = 0; i < 180; i++) step([p0.pad(), p1.pad()]);
    // The away side's (side 1's) human takes it: the machine viewing side 0 is the keeper's.
    givePenalty([a, b], 1);
    let aimed = 0;
    let n = 0;
    let struck = false;
    let firstZ = NaN;
    let lastZ = NaN;
    for (let i = 0; i < 60 * 30 && !struck; i++) {
      const r = a.restart;
      const taking = a.phase === 'restart' && r?.kind === 'penalty';
      // The taker: the keys slide the reticle across for 40 steps, then SHOOT is held 20 and let go.
      const pad1: Pad = taking ? { ...EMPTY_PAD, digital: true, mz: n < 40 ? 1 : 0, shoot: n >= 40 && n < 60 } : p1.pad();
      if (taking) n++;
      const kickBefore = a.kickId;
      step([p0.pad(), pad1]);
      if (a.kickId !== kickBefore && taking) struck = true;
      const aim = a.ctl[1].penAim;
      if (aim && !aim.locked) {
        aimed++;
        if (Number.isNaN(firstZ)) firstZ = aim.z;
        lastZ = aim.z;
        // The same aim in both sims (it's sim state, from his pads)...
        expect(b.ctl[1].penAim).toEqual(aim);
        // ...but only his own machine shows it: the keeper's side's view has no reticle.
        expect(a.penAim).toBeNull();
        expect(b.penAim).toEqual(aim);
      }
    }
    expect(struck).toBe(true);
    expect(aimed).toBeGreaterThan(30);
    expect(Math.abs(lastZ - firstZ)).toBeGreaterThan(0.5);
    // And on through the rest of the match, still identical.
    for (let i = 0; i < 60 * 20; i++) step([p0.pad(), p1.pad()]);
  }, 60_000);

  it('a shootout with a human on each side: each takes his own kicks at his own aim and keeps his own goal', () => {
    let played = 0;
    // (Seeds whose fuzzed ties end level: re-picked 2026-09-30 when the receive lock and the clearance changed play.)
    for (const seed of [1, 4, 6, 9]) {
      const [a, b] = pair(seed, { halfLength: 25, knockout: true });
      const p0 = new FuzzPad(seed * 3);
      const p1 = new FuzzPad(seed * 3 + 1);
      const placed = [0, 0];
      let lastPen: unknown = null;
      for (let steps = 0; a.phase !== 'fulltime' && steps < 60 * 60 * 10; steps++) {
        const pads: [Pad, Pad] = [p0.pad(), p1.pad()];
        a.step(DT, pads);
        b.step(DT, pads);
        a.drainEvents();
        b.drainEvents();
        stoppages(a, [true, true]);
        stoppages(b, [true, true]);
        expect(stateHash(b)).toBe(stateHash(a));
        const so = a.shootout;
        if (so?.pen && so.pen !== lastPen) {
          lastPen = so.pen;
          if (so.pen.placed) placed[so.turn]++;
        }
      }
      if (!a.shootout) continue;
      played++;
      // Every kick was a human's placed one (his reticle, or his time running out at it), both sides.
      expect(placed[0]).toBeGreaterThan(0);
      expect(placed[1]).toBeGreaterThan(0);
      expect(a.shootout.winner).toBeGreaterThanOrEqual(0);
    }
    expect(played).toBeGreaterThan(0);
  }, 90_000);
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
    // (One may have stood a tick or two longer at full time when the run stopped: the sim is idle there.)
    expect(Math.abs(a.hashes.length - b.hashes.length)).toBeLessThanOrEqual(DELAY_MAX);
    expect(a.hashes[n - 1]).toBe(b.hashes[n - 1]);
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

  it('IF LEVEL: PENALTIES: a drawn match goes to a shootout, both peers identical through it, over a bad network', () => {
    let shootouts = 0;
    for (const seed of [2, 5, 9, 14]) {
      const net = new NetSim({ loss: 0.1, latency: [20, 120], seed });
      const [ta, tb] = net.pair();
      const setup = testSetup({ seed: 900 + seed, halfMinutes: 0.25, knockout: true });
      const a = new SimPeer(ta, 0, setup, net);
      const b = new SimPeer(tb, 1, setup, net);
      runPeers(net, a, b);
      expect(a.lock.status).toBe('play');
      expect(b.lock.status).toBe('play');
      expect(agree(a, b)).toBeGreaterThan(60 * 25);
      expect(a.m.phase).toBe('fulltime');
      if (!a.m.shootout) continue;
      shootouts++;
      expect(b.m.shootout!.winner).toBe(a.m.shootout.winner);
      expect(b.m.shootout!.kicks).toEqual(a.m.shootout.kicks);
    }
    expect(shootouts).toBeGreaterThan(0);
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
    expect(b1.m.phase).toBe('fulltime');
    // (Every tick both stepped is identical. One may step a tick further into full time than the other before the
    // run stops, which only runs its phaseT on: the final states are compared at the last tick they share.)
    const n = agree(a1, b1);
    expect(n).toBeGreaterThan(60 * 20);
    expect(a1.hashes[n - 1]).toBe(b1.hashes[n - 1]);
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
