import { describe, expect, it } from 'vitest';
import { rainSamples } from '../src/audio/ambience';
import { Sfx } from '../src/audio/sfx';

describe('rain ambience', () => {
  it('has quiet headroom and a click-free loop seam at browser sample rates', () => {
    for (const rate of [44100, 48000]) {
      let seed = 73;
      const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const channels = rainSamples(rate, random);
      for (const samples of channels) {
        let sum = 0, peak = 0;
        for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
        const rms = Math.sqrt(sum / samples.length);
        expect(rms).toBeGreaterThan(0.005);
        expect(rms).toBeLessThan(0.04);
        expect(peak).toBeLessThan(0.35);
        expect(Math.abs(samples[0])).toBe(0);
        expect(Math.abs(samples[samples.length - 1])).toBe(0);
      }
      let cross = 0, leftPower = 0, rightPower = 0;
      for (let i = 0; i < channels[0].length; i++) {
        const l = channels[0][i], r = channels[1][i];
        cross += l * r; leftPower += l * l; rightPower += r * r;
      }
      expect(Math.abs(cross / Math.sqrt(leftPower * rightPower))).toBeLessThan(0.08);
    }
  });
});

describe('menu music scheduler', () => {
  /** A Sfx on a fake audio clock, recording the start time of every note the loop schedules. */
  const rig = (now: number, behind: number) => {
    const s = new Sfx() as unknown as {
      ctx: { currentTime: number; state: string };
      nextNoteTime: number;
      musicStep: number;
      tone: (t: number) => void;
      noiseBurst: (t: number) => void;
      schedule: () => void;
    };
    const starts: number[] = [];
    s.ctx = { currentTime: now, state: 'running' };
    s.tone = (t) => void starts.push(t);
    s.noiseBurst = (t) => void starts.push(t);
    s.nextNoteTime = now - behind;
    s.musicStep = 40;
    return { s, starts };
  };

  it('skips the notes a throttled (background tab) timer missed instead of firing them all at once', () => {
    const { s, starts } = rig(100, 5);
    s.schedule();
    expect(starts.length).toBeGreaterThan(0);
    // Nothing is started in the past (Web Audio would play every one of them at once).
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(100);
    // Only the notes due in the next scheduling window: one eighth note's worth here, not five seconds of them.
    expect(new Set(starts).size).toBeLessThanOrEqual(1);
    // The bar is kept: the step moved on by the notes skipped.
    expect(s.musicStep).toBeGreaterThan(40 + 20);
    expect(s.nextNoteTime).toBeGreaterThanOrEqual(100.12);
  });

  it('plays on in time when the timer keeps up', () => {
    const { s, starts } = rig(100, -0.05);
    s.schedule();
    expect(starts.every((t) => t === 100.05)).toBe(true);
    expect(s.musicStep).toBe(41);
  });
});
