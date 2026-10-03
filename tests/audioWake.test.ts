import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sfx } from '../src/audio/sfx';

/**
 * Leaving the app and coming back (the owner: "audio is compleetely silent"): iOS interrupts the AudioContext in the
 * background and can leave it stuck. The context sleeps while hidden, wakes on the way back, a tap resumes it while
 * it isn't running, and a context that stays stuck (or runs with its clock stood still) is built again on the next
 * tap with the crowd and the music, never twice.
 */

type Listener = () => void;

function events() {
  const map = new Map<string, Set<Listener>>();
  return {
    add: (type: string, fn: Listener) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
    },
    fire: (type: string) => map.get(type)?.forEach((fn) => fn()),
    count: (type: string) => map.get(type)?.size ?? 0,
  };
}

/** A WebAudio stand-in: every context made, its sources started and whether it was closed. */
function fakeAudio() {
  const made: FakeCtx[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  class FakeCtx {
    state: string = 'running';
    sampleRate = 4000;
    clock = 0;
    closed = false;
    started = 0;
    /** What resume() leaves the state at (iOS: 'interrupted' until a tap, sometimes even after one). */
    resumeTo = 'running';
    resumes = 0;
    destination = this.node();
    constructor() { made.push(this); }
    get currentTime() { return this.clock; }
    resume() { this.resumes++; this.state = this.resumeTo; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
    node(extra: Record<string, unknown> = {}) {
      const n = {
        connect: (d: unknown) => d,
        disconnect() {},
        start: () => { this.started++; },
        stop() {},
        gain: param(), frequency: param(), Q: param(), pan: param(), playbackRate: param(), threshold: param(), ratio: param(),
        ...extra,
      };
      return n;
    }
    createGain() { return this.node(); }
    createDynamicsCompressor() { return this.node(); }
    createBiquadFilter() { return this.node(); }
    createOscillator() { return this.node(); }
    createBufferSource() { return this.node(); }
    createConvolver() { return this.node(); }
    createStereoPanner() { return this.node(); }
    createBuffer(ch: number, len: number) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { length: len, getChannelData: (i: number) => data[i] };
    }
  }
  return { made, FakeCtx };
}

let win: ReturnType<typeof events>;
let doc: ReturnType<typeof events> & { visibilityState: string };
let audio: ReturnType<typeof fakeAudio>;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  win = events();
  doc = Object.assign(events(), { visibilityState: 'visible' });
  audio = fakeAudio();
  vi.stubGlobal('window', {
    AudioContext: audio.FakeCtx,
    addEventListener: (t: string, fn: Listener) => win.add(t, fn),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
  vi.stubGlobal('document', { addEventListener: (t: string, fn: Listener) => doc.add(t, fn), get visibilityState() { return doc.visibilityState; } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function away(s: Sfx, stuck: string): Promise<void> {
  void s;
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange');
  // iOS takes the audio session while the app is in the background.
  audio.made[audio.made.length - 1].state = stuck;
  audio.made[audio.made.length - 1].resumeTo = stuck;
  await flush();
}

async function back(): Promise<void> {
  doc.visibilityState = 'visible';
  doc.fire('visibilitychange');
  win.fire('pageshow');
  win.fire('focus');
  await flush();
}

describe('audio after leaving the app', () => {
  it('sleeps while hidden and wakes on the way back when the system lets it', async () => {
    const s = new Sfx();
    s.unlock();
    const c = audio.made[0];
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(c.state).toBe('suspended');
    await back();
    expect(c.state).toBe('running');
    expect(audio.made).toHaveLength(1);
    // The listeners went on once, however often the context is unlocked.
    s.unlock();
    expect(doc.count('visibilitychange')).toBe(1);
    expect(win.count('touchstart')).toBe(1);
  });

  it('left interrupted: the next tap resumes it (a gesture always may), no rebuild needed', async () => {
    const s = new Sfx();
    s.unlock();
    const c = audio.made[0];
    await away(s, 'interrupted');
    await back();
    expect(c.state).toBe('interrupted');
    c.resumeTo = 'running';
    win.fire('touchstart');
    await flush();
    expect(c.state).toBe('running');
    expect(audio.made).toHaveLength(1);
    // Running again: a tap does nothing more.
    const r = c.resumes;
    win.fire('pointerdown');
    expect(c.resumes).toBe(r);
  });

  it('still stuck after a tap: the next tap builds it again, crowd and music with it, the old one closed', async () => {
    const s = new Sfx();
    s.unlock();
    s.startMusic();
    const intervals = vi.getTimerCount();
    const c = audio.made[0];
    const sources = c.started;
    await away(s, 'interrupted');
    await back();
    win.fire('touchstart');
    await flush();
    expect(audio.made).toHaveLength(1);
    win.fire('touchend');
    await flush();
    expect(audio.made).toHaveLength(2);
    expect(c.closed).toBe(true);
    const fresh = audio.made[1];
    // The same beds and the room started on the new context, and one music timer (never two).
    expect(fresh.started).toBe(sources);
    expect(vi.getTimerCount()).toBe(intervals);
    s.stopMusic();
  });

  it('says running with its clock stood still (WebKit\'s silent context): rebuilt on the next tap', async () => {
    const s = new Sfx();
    s.unlock();
    const c = audio.made[0];
    await away(s, 'suspended');
    c.resumeTo = 'running';
    await back();
    expect(c.state).toBe('running');
    await vi.advanceTimersByTimeAsync(700);
    win.fire('keydown');
    await flush();
    expect(audio.made).toHaveLength(2);
    expect(c.closed).toBe(true);
  });

  it('a clock that moves is left alone', async () => {
    const s = new Sfx();
    s.unlock();
    const c = audio.made[0];
    await away(s, 'suspended');
    c.resumeTo = 'running';
    await back();
    c.clock += 0.7;
    await vi.advanceTimersByTimeAsync(700);
    win.fire('touchstart');
    await flush();
    expect(audio.made).toHaveLength(1);
  });

  it('an ad closing (unmute) wakes a context it left suspended', async () => {
    const s = new Sfx();
    s.unlock();
    const c = audio.made[0];
    s.setMuted(true);
    c.state = 'suspended';
    s.setMuted(false);
    await flush();
    expect(c.state).toBe('running');
  });
});
