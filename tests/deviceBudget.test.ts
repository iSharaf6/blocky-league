import { describe, expect, it } from 'vitest';
import { ResolutionGovernor, resolutionLimits, type Quality } from '../src/render/world';

describe('device framebuffer budget', () => {
  it.each([['small phone', 320, 568], ['notched phone', 393, 852], ['landscape phone', 852, 393], ['tablet', 1024, 1366], ['desktop', 1920, 1080], ['4K', 3840, 2160], ['ultrawide', 7680, 2160]] as const)(
    '%s stays within pixel and GPU dimension limits at 1x, 2x and 3x', (_name, w, h) => {
      for (const q of ['high', 'medium', 'low'] as Quality[]) for (const dpr of [1, 2, 3]) for (const gpu of [2048, 4096, 8192]) {
        const limit = resolutionLimits(q, dpr, w, h, Math.min(gpu, 4096));
        const budget = q === 'high' ? 4_194_304 : q === 'medium' ? 3_145_728 : 2_097_152;
        expect(w * h * limit.max ** 2).toBeLessThanOrEqual(budget + 0.001);
        expect(Math.max(w, h) * limit.max).toBeLessThanOrEqual(Math.min(gpu, 4096) + 0.001);
        expect(limit.floor).toBeGreaterThan(0);
        expect(limit.floor).toBeLessThanOrEqual(limit.max);
        expect(limit.max).toBeLessThanOrEqual(dpr);
      }
    });

  it('keeps ordinary phones sharp and lets GPU-bound jitter fall to the bounded floor', () => {
    expect(resolutionLimits('high', 3, 393, 852)).toEqual({ max: 2, floor: 1.5 });
    expect(resolutionLimits('medium', 3, 393, 852)).toEqual({ max: 1.5, floor: 1 });
    const { max, floor } = resolutionLimits('high', 2, 1024, 1366);
    const g = new ResolutionGovernor(max, floor);
    for (let i = 0; i < 1200; i++) g.frame(i < 24 || i % 5 === 0 ? 1 / 60 : 1 / 20, 0, true);
    expect(g.ratio).toBeLessThan(max);
    expect(g.ratio).toBeGreaterThanOrEqual(floor);
  });

  it('makes invalid/missing device metrics finite and safe', () => {
    for (const n of [0, -1, Number.NaN, Infinity]) {
      const limits = resolutionLimits('high', n, n, n, n);
      expect(limits.max).toBeGreaterThan(0);
      expect(Number.isFinite(limits.max)).toBe(true);
      expect(Number.isFinite(limits.floor)).toBe(true);
    }
  });
});
