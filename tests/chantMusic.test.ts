import { describe, expect, it, vi } from 'vitest';
import { CHANT_KINDS, Sfx, chantCaption } from '../src/audio/sfx';

type Note = readonly [number, number, number, string, string?];
interface Param { value: number; events: [number, number][]; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; cancelScheduledValues(t: number): void }
const param = (): Param => ({ value: 0, events: [], setValueAtTime(v, t) { this.events.push([v, t]); }, linearRampToValueAtTime(v, t) { this.events.push([v, t]); }, cancelScheduledValues() {} });
const node = () => ({ gain: param(), connect: function () { return this; }, disconnect: vi.fn() });

describe('terrace music', () => {
  it('keeps voiced chants on their melody, without octave-down growls or large pitch slides', () => {
    const oscillators: { frequency: Param; setPeriodicWave: ReturnType<typeof vi.fn> }[] = [];
    const wave = {};
    const ctx = {
      createGain: node,
      createPeriodicWave: vi.fn(() => wave),
      createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn() }),
      createOscillator: () => {
        const o = { ...node(), frequency: param(), setPeriodicWave: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
        oscillators.push(o); return o;
      },
    };
    const s = Object.assign(new Sfx(), { ctx, choirs: [{ input: node(), f1: { frequency: param() }, f2: { frequency: param() } }], noiseBurst: vi.fn() }) as unknown as {
      sing(t: number, notes: Note[], voices: number, level: number, who: number, spread: number): number;
    };
    s.sing(10, [[0, 0.5, 60, 'a'], [0.6, 0.5, 64, 'a', 'l']], 10, 0.2, 0, 0.04);
    const c4 = 261.625565;
    for (const o of oscillators) {
      expect(o.setPeriodicWave).toHaveBeenCalledWith(wave);
      expect(o.frequency.events.every(([f, t]) => Number.isFinite(f) && t >= 10)).toBe(true);
      const first = o.frequency.events[0][0];
      expect(first).toBeGreaterThan(c4 * 0.98);
      const fundamental = first > c4 * 1.5 ? c4 * 2 : c4;
      expect(first / fundamental).toBeLessThan(1.01);
      expect(first / fundamental).toBeGreaterThan(0.98);
    }
    // Persistent rounded spectrum is created once for the choir, not once per voice or syllable.
    expect(ctx.createPeriodicWave).toHaveBeenCalledTimes(1);
  });

  it.each(['homeagain', 'bounce'] as const)('%s is a timed major-pentatonic refrain with claps and a readable caption', (kind) => {
    const phrases: { t: number; notes: readonly Note[] }[] = [];
    const clap = vi.fn();
    const s = Object.assign(new Sfx(), {
      ctx: { currentTime: 0, state: 'running' }, choirs: [{ busy: 0 }], claim: () => true,
      sing: (t: number, notes: readonly Note[]) => { phrases.push({ t, notes }); const last = notes.at(-1)!; return t + last[0] + last[1]; },
      drum: vi.fn(), clap, standBus: () => node(), duckBed: vi.fn(),
    }) as unknown as Sfx;
    const cue = vi.fn(); s.onChant = cue; s.chant(kind);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(clap).toHaveBeenCalled();
    for (const { notes } of phrases) for (const [at, dur, midi] of notes) {
      expect(at).toBeGreaterThanOrEqual(0); expect(dur).toBeGreaterThan(0);
      expect([0, 2, 4, 7, 9]).toContain(midi % 12);
    }
    const last = cue.mock.calls[0][0];
    expect(last.seconds).toBeGreaterThan(6); expect(last.seconds).toBeLessThan(10);
    expect(last.caption).toBe(chantCaption(kind, ['BLOCKY']));
  });

  it('all nineteen chants retain distinct selectable IDs and clear terrace captions', () => {
    expect(new Set(CHANT_KINDS).size).toBe(19);
    for (const kind of CHANT_KINDS) expect(chantCaption(kind, ['BRICK', 'CITY'])).toMatch(/[A-Z]/);
  });
});
