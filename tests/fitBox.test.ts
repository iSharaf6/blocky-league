import { describe, expect, it } from 'vitest';
import { FIT_MAX_ASPECT, FIT_MIN_H, FIT_MIN_W, fitFor } from '../src/ui/fitBox';

// The fit box (src/ui/fitBox.ts, docs/UX.md section 10): when a menu screen is laid out at a design box and scaled.
describe('fitFor', () => {
  it('leaves frames inside the envelope native', () => {
    for (const [w, h] of [[667, 375], [852, 393], [800, 450], [1080, 607], [1920, 1080], [1180, 760], [900, 506]]) {
      const f = fitFor(w, h);
      expect(f.on, `${w}x${h}`).toBe(false);
      expect(f.scale).toBe(1);
    }
  });

  it('fits small landscape frames: the frame scaled up to 375 tall or 667 wide, same shape', () => {
    const a = fitFor(640, 290); // an iPhone on its side in Safari, beside CrazyGames' bar
    expect(a).toMatchObject({ on: true, h: 375, upright: false });
    expect(a.w).toBe(827);
    expect(a.scale).toBeCloseTo(0.7733, 3);
    const b = fitFor(700, 320);
    expect(b).toMatchObject({ on: true, h: 375, w: 820 });
    expect(b.scale).toBeCloseTo(0.8533, 3);
    const c = fitFor(600, 400); // narrower than 667
    expect(c).toMatchObject({ on: true, w: 667 });
    expect(c.scale).toBeCloseTo(0.8996, 3);
  });

  it('fits upright frames in a landscape box: 852 by 480, or 667 by 375 under 600 wide', () => {
    expect(fitFor(820, 1100)).toMatchObject({ on: true, w: 852, h: 480, upright: true });
    expect(fitFor(820, 1100).scale).toBeCloseTo(820 / 852, 5);
    expect(fitFor(930, 1250).scale).toBeCloseTo(930 / 852, 5); // an iPad upright: scaled up
    expect(fitFor(390, 700)).toMatchObject({ on: true, w: 667, h: 375, upright: true });
    expect(fitFor(390, 700).scale).toBeCloseTo(390 / 667, 5);
    // Square-ish windows count as upright (under 1.25 to 1).
    expect(fitFor(1000, 900).on).toBe(true);
    expect(fitFor(1000, 790).on).toBe(false);
  });

  it('always fits the whole box inside the frame, and never lays out under the envelope', () => {
    for (let w = 280; w <= 2600; w += 37) {
      for (let h = 200; h <= 1600; h += 41) {
        const f = fitFor(w, h);
        expect(f.w * f.scale).toBeLessThanOrEqual(w + 0.01);
        expect(f.h * f.scale).toBeLessThanOrEqual(h + 0.01);
        if (f.on) {
          expect(f.w).toBeGreaterThanOrEqual(FIT_MIN_W);
          expect(f.h).toBeGreaterThanOrEqual(FIT_MIN_H);
          expect(f.w / f.h).toBeLessThanOrEqual(FIT_MAX_ASPECT + 0.01);
          expect(f.w / f.h).toBeGreaterThanOrEqual(1.25);
        }
      }
    }
  });

  it('a very wide short frame keeps the widest tested shape and is letterboxed', () => {
    const f = fitFor(1000, 250);
    expect(f.on).toBe(true);
    expect(f.w / f.h).toBeCloseTo(FIT_MAX_ASPECT, 2);
    expect(f.h * f.scale).toBeCloseTo(250, 3);
  });

  it('is off for an empty frame', () => {
    expect(fitFor(0, 0).on).toBe(false);
  });
});
