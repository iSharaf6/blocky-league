import { describe, expect, it } from 'vitest';
import { rainSamples } from '../src/audio/ambience';

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
