import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchAudio, type DirectorSink } from '../src/audio/director';
import { Sfx, chantSyllables } from '../src/audio/sfx';
import type { Match } from '../src/sim/match';
import type { MatchEvent } from '../src/sim/types';

/**
 * The owner: "no music between half time, winning a game no music ... crowd chants non existent". The crowd sings at
 * every ground (ROAD TO GLORY's level-0 park included), and the music follows the match: the menu, the kick-off
 * sting, the half-time loop and out of it, the full-time song by result, back to the menu.
 */

/** A WebAudio stand-in on a hand-moved clock: counts the nodes made. */
function fakeAudio() {
  const ctx = { clock: 0, nodes: 0 };
  const param = () => ({
    value: 1,
    setValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  class FakeCtx {
    state = 'running';
    sampleRate = 4000;
    destination = this.node();
    get currentTime() { return ctx.clock; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    node() {
      ctx.nodes++;
      return {
        connect: (d: unknown) => d, disconnect() {}, start() {}, stop() {}, setPeriodicWave(_wave: unknown) {},
        gain: param(), frequency: param(), Q: param(), pan: param(), playbackRate: param(), threshold: param(), ratio: param(),
        knee: param(), attack: param(), release: param(), type: '', buffer: null as unknown, loop: false, normalize: true,
      };
    }
    createGain() { return this.node(); }
    createDynamicsCompressor() { return this.node(); }
    createBiquadFilter() { return this.node(); }
    createOscillator() { return this.node(); }
    createPeriodicWave(_real: Float32Array, _imag: Float32Array) { return {}; }
    createBufferSource() { return this.node(); }
    createConvolver() { return this.node(); }
    createStereoPanner() { return this.node(); }
    createBuffer(ch: number, len: number) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { length: len, getChannelData: (i: number) => data[i] };
    }
  }
  return { ctx, FakeCtx };
}

let audio: ReturnType<typeof fakeAudio>;
beforeEach(() => {
  vi.useFakeTimers();
  audio = fakeAudio();
  vi.stubGlobal('window', {
    AudioContext: audio.FakeCtx,
    addEventListener() {},
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function unlocked(): Sfx {
  const s = new Sfx();
  s.unlock();
  return s;
}

/** Run `secs` of match frames at 60 fps; returns each chant's start (the chant kind, as it changes). */
function play(s: Sfx, secs: number): string[] {
  const sung: string[] = [];
  let last: unknown = null;
  let lastIn = Infinity;
  for (let i = 0; i < secs * 60; i++) {
    audio.ctx.clock = i / 60;
    s.tick(1 / 60);
    const st = s.debugState();
    // A new chant: the countdown jumped back up (a chant started) and named its kind.
    if ((st.chantIn as number) > lastIn + 5 && st.lastChant) sung.push(st.lastChant as string);
    lastIn = st.chantIn as number;
    last = st.lastChant;
  }
  void last;
  return sung;
}

describe('the crowd sings at every ground', () => {
  it("ROAD TO GLORY's level-0 park (a Sunday League gate) sings every 15 to 30 s, and not the same chant twice running", () => {
    const s = unlocked();
    s.setClubNames('Mossvale Rovers', 'Pebbleport Town');
    s.setStadium(0, 0.35 * 0.55);
    s.setAmbienceActive(true);
    const sung = play(s, 120);
    expect(sung.length).toBeGreaterThanOrEqual(4);
    expect(sung.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < sung.length; i++) expect(sung[i]).not.toBe(sung[i - 1]);
  });

  it('an empty ground never sings; the gate (half time, full time) stops the chants; a goal makes the scorers sing anyway', () => {
    const empty = unlocked();
    empty.setStadium(0, 0);
    empty.setAmbienceActive(true);
    expect(play(empty, 90)).toHaveLength(0);
    const s = unlocked();
    s.setStadium(2, 0.6);
    s.setAmbienceActive(true);
    s.setChantGate(false);
    const n0 = audio.ctx.nodes;
    for (let i = 0; i < 60 * 60; i++) {
      audio.ctx.clock = i / 60;
      s.tick(1 / 60);
    }
    expect(audio.ctx.nodes).toBe(n0);
    s.goal(0);
    expect(s.debugState().forced).toBe('ohs');
    for (let i = 0; i < 60 * 8; i++) {
      audio.ctx.clock = 60 + i / 60;
      s.tick(1 / 60);
    }
    expect(s.debugState().forced).toBeNull();
    expect(audio.ctx.nodes).toBeGreaterThan(n0 + 20);
  });

  it("chants a club's name in its own syllables (BLOCKY LEAGUE without one)", () => {
    expect(chantSyllables('Mossvale Rovers')).toEqual(['o', 'a']);
    expect(chantSyllables('Pebbleport Town')).toEqual(['e', 'e', 'o']);
    expect(chantSyllables('Foxhollow Athletic')).toEqual(['o', 'o', 'o']);
    expect(chantSyllables('')).toEqual(['o', 'i', 'i']);
    expect(chantSyllables('Supercalifragilistic FC').length).toBeLessThanOrEqual(4);
  });

  it('per frame: tension and nerves move no params unless they change, and the voice budget caps a burst of reactions', () => {
    const s = unlocked();
    s.setStadium(5, 1);
    s.setAmbienceActive(true);
    audio.ctx.clock = 5;
    const n0 = audio.ctx.nodes;
    for (let i = 0; i < 600; i++) {
      s.setTension(0.5);
      s.setNerves(0.4);
    }
    expect(audio.ctx.nodes).toBe(n0);
    for (let i = 0; i < 40; i++) {
      s.groan(1, 0);
      s.crowdWhistles(1, 1, true);
      s.applause(1, 0);
    }
    expect(s.debugState().voices as number).toBeLessThanOrEqual(64);
  });
});

describe('the music state machine', () => {
  const run = (secs: number): void => {
    for (let i = 0; i < secs / 0.03; i++) {
      audio.ctx.clock += 0.03;
      vi.advanceTimersByTime(30);
    }
  };

  it('menu, kick-off sting, half time, the second half, full time by result, and back to the menu: one timer throughout', () => {
    const s = unlocked();
    s.startMusic();
    expect(s.musicState).toBe('menu');
    const timers = vi.getTimerCount();
    run(1);
    // A match starts: the menu goes; the kick-off sting plays over silence.
    s.stopMusic();
    expect(s.musicState).toBe('off');
    s.sting('kickoff');
    expect(s.debugState().lastSting).toBe('kickoff');
    expect(s.musicState).toBe('off');
    // Half time, asked for twice (it never doubles), then out into the second half.
    s.playTrack('halftime');
    s.playTrack('halftime');
    expect(s.musicState).toBe('halftime');
    expect(vi.getTimerCount()).toBe(timers);
    run(2);
    s.stopMusic(1.6);
    expect(s.musicState).toBe('off');
    // Full time: a win's fanfare, then its loop.
    s.result('win');
    expect(s.musicState).toBe('win');
    expect(s.debugState().part).toBe('intro');
    run(7);
    expect(s.debugState().part).toBe('loop');
    // A draw's and a defeat's themes are their own songs.
    s.result('draw');
    expect(s.musicState).toBe('draw');
    s.result('loss');
    expect(s.musicState).toBe('loss');
    expect(vi.getTimerCount()).toBe(timers);
    // Back to the menus.
    s.startMusic();
    expect(s.musicState).toBe('menu');
    expect(vi.getTimerCount()).toBe(timers);
  });

  it('respects the MUSIC toggle: off stops the song, and no song or sting starts while it is off', () => {
    const s = unlocked();
    s.startMusic();
    s.setMusic(false);
    expect(s.musicState).toBe('off');
    s.result('win');
    s.playTrack('halftime');
    s.sting('goal');
    expect(s.musicState).toBe('off');
    expect(s.debugState().stings).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a cup final won opens with the trophy fanfare; the goal roar ducks the song and it comes back", () => {
    const s = unlocked();
    s.result('win', 2);
    expect(s.debugState().big).toBe(2);
    expect(() => s.goal(0)).not.toThrow();
    expect(() => s.fanfare('promotion')).not.toThrow();
    expect(s.musicState).toBe('win');
  });
});

// ------------------------------------------------------------------ the director (src/audio/director.ts)

type Call = [string, ...unknown[]];

function recorder(): { sink: DirectorSink; calls: Call[]; named: (n: string) => Call[] } {
  const calls: Call[] = [];
  const rec = (name: string) => (...a: unknown[]) => void calls.push([name, ...a]);
  const sink = {
    sting: rec('sting'), playTrack: rec('playTrack'), stopMusic: rec('stopMusic'), setChantGate: rec('setChantGate'),
    applause: rec('applause'), groan: rec('groan'), crowdWhistles: rec('crowdWhistles'), oleChain: rec('oleChain'),
    setNerves: rec('setNerves'), fullTimeCrowd: rec('fullTimeCrowd'), setClubNames: rec('setClubNames'),
  } as unknown as DirectorSink;
  return { sink, calls, named: (n) => calls.filter((c) => c[0] === n) };
}

/** Just enough of a Match for the director: 22 players (0..10 home), the clock, the score and the last shot. */
function fakeMatch(): Match {
  const players = Array.from({ length: 22 }, (_, i) => ({ idx: i, side: i < 11 ? 0 : 1 }));
  return {
    cfg: { humanSide: 0, halfLength: 120 },
    teams: [{ name: 'Mossvale Rovers' }, { name: 'Pebbleport Town' }],
    players, human: [true, false], ball: { owner: -1, lastTouch: -1 },
    phase: 'kickoff', phaseT: 0, half: 1, clock: 0, score: [0, 0], shootout: null,
    shotClock: 99, shotDist: 0, shotSide: 0, shotByHuman: false,
  } as unknown as Match;
}

describe('the match director', () => {
  it('stings the first and the second-half kick-off (not one after a goal), plays half time once and fades it out', () => {
    const { sink, named } = recorder();
    const d = new MatchAudio(sink);
    const m = fakeMatch();
    const ev = (e: MatchEvent): void => d.events([e], m);
    d.begin(m);
    expect(named('setClubNames')[0]).toEqual(['setClubNames', 'Mossvale Rovers', 'Pebbleport Town']);
    ev({ type: 'kickoffReady', side: 0 });
    expect(named('sting')).toEqual([['sting', 'kickoff']]);
    (m as { phase: string }).phase = 'play';
    ev({ type: 'goal', side: 0, scorer: 3, own: false });
    expect(named('sting').at(-1)).toEqual(['sting', 'goal']);
    ev({ type: 'kickoffReady', side: 1 });
    expect(named('sting')).toHaveLength(2);
    // Half time: the chants stop; the track once the screen is coming up, asked for once.
    ev({ type: 'halftime' });
    expect(named('setChantGate').at(-1)).toEqual(['setChantGate', false]);
    Object.assign(m, { phase: 'halftime', phaseT: 0.3 });
    d.frame(1 / 60, m);
    expect(named('playTrack')).toHaveLength(0);
    Object.assign(m, { phaseT: 1 });
    d.frame(1 / 60, m);
    d.frame(1 / 60, m);
    expect(named('playTrack')).toEqual([['playTrack', 'halftime']]);
    // The second half: the track fades, the chants come back, the kick-off is stung.
    Object.assign(m, { phase: 'kickoff', phaseT: 0, half: 2 });
    d.frame(1 / 60, m);
    expect(named('stopMusic')[0][1]).toBeGreaterThan(1);
    expect(named('setChantGate').at(-1)).toEqual(['setChantGate', true]);
    ev({ type: 'kickoffReady', side: 1 });
    expect(named('sting').filter((c) => c[1] === 'kickoff')).toHaveLength(2);
    // Full time 2-1: the home fans win it.
    Object.assign(m, { phase: 'fulltime', score: [2, 1] });
    ev({ type: 'fulltime' });
    expect(named('fullTimeCrowd')).toEqual([['fullTimeCrowd', 0]]);
    d.end(m);
    expect(d.state.active).toBe(false);
  });

  it('olés a passing move from the fourth pass, groans at a sitter missed, whistles the AI keeping the ball, gets nervous late', () => {
    const { sink, named } = recorder();
    const d = new MatchAudio(sink);
    const m = fakeMatch();
    d.begin(m);
    Object.assign(m, { phase: 'play' });
    for (let i = 0; i < 5; i++) {
      d.events([{ type: 'kick', power: 0.5, x: 0, y: 0, z: 0, kind: 'pass', player: i }, { type: 'control', player: i + 1 }], m);
    }
    expect(named('oleChain').map((c) => c[1])).toEqual([4, 5]);
    // Intercepted: the move is over.
    d.events([{ type: 'control', player: 15 }], m);
    expect(d.state.chain).toBe(0);
    // His shot from 8 m goes wide.
    Object.assign(m, { shotClock: 1, shotDist: 8, shotSide: 0, shotByHuman: true });
    d.events([{ type: 'restart', kind: 'goalkick', side: 1 }], m);
    expect(named('groan')).toEqual([['groan', 1, 0]]);
    // The AI keeps it for 11 s: his fans whistle.
    (m as { ball: { owner: number } }).ball.owner = 14;
    for (let i = 0; i < 11 * 60; i++) d.frame(1 / 60, m);
    expect(named('crowdWhistles')).toHaveLength(1);
    // Late in the second half, level: nerves up.
    Object.assign(m, { half: 2, clock: 110, score: [1, 1] });
    d.frame(1 / 60, m);
    expect(named('setNerves').at(-1)![1] as number).toBeGreaterThan(0.5);
    // Another match's events (the menu's demo) are ignored.
    const other = fakeMatch();
    d.events([{ type: 'kickoffReady', side: 0 }], other);
    expect(named('sting')).toHaveLength(0);
  });
});
