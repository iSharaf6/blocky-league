import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { SUB_LENS_MIN, keepLensClear, newSubStage, subLensReach, subStage } from '../src/game/showcase';
import { CHAR_H } from '../src/render/characters';

// CrazyGames' QA, 22 October (the opponent's substitution at 1920 by 945): the change opened with the lens a stride
// behind the man coming off, his back filling the screen and his head cut off.

/** The three men of a change at `k`: how far each is from the lens, and where his head and boots fall (NDC, -1..1). */
function framing(k: number, side: 0 | 1, tall: number, aspect: number) {
  const st = newSubStage();
  subStage(k, side, st, tall);
  const s = st.shot;
  const cam = new PerspectiveCamera(s.fov, aspect, 0.1, 500);
  cam.position.set(s.px, s.py, s.pz);
  cam.lookAt(s.tx, s.ty, s.tz);
  cam.updateMatrixWorld();
  const men = [st.off, st.on, st.official].map((m) => ({
    d: Math.hypot(m.x - s.px, m.z - s.pz),
    head: new Vector3(m.x, tall, m.z).project(cam),
  }));
  return { st, men };
}

describe('the substitution cut-scene keeps the lens off every man and every head in frame', () => {
  // (1920 by 945, and a phone on its side: the men are drawn taller there, screenCharK.)
  const cases = [
    { tall: CHAR_H, aspect: 1920 / 945 },
    { tall: CHAR_H * 1.3, aspect: 745 / 290 },
  ];
  for (const { tall, aspect } of cases) {
    it(`never nearer than ${SUB_LENS_MIN} heights, head inside the top of the frame (tall ${tall.toFixed(2)})`, () => {
      for (const side of [0, 1] as const) {
        for (let i = 0; i <= 100; i++) {
          const { men } = framing(i / 100, side, tall, aspect);
          for (const m of men) {
            expect(m.d).toBeGreaterThanOrEqual(SUB_LENS_MIN * tall - 1e-3);
            // (Whoever is in the picture: his head below the top edge with room to spare.)
            if (Math.abs(m.head.x) < 1) expect(m.head.y).toBeLessThan(0.8);
          }
        }
      }
    });
  }

  it('the opening frame of the opponent\'s change (the QA shot): the man coming off is a full figure, not a back', () => {
    const { men } = framing(0, 1, CHAR_H, 1920 / 945);
    // Before: 2.96 m from the lens, his head at 1.04 (off the top of the screen).
    expect(men[0].d).toBeGreaterThan(5.9);
    expect(men[0].head.y).toBeLessThan(0.6);
  });

  it('moves smoothly: the lens never jumps between frames as it backs off', () => {
    for (const side of [0, 1] as const) {
      let last: { x: number; z: number } | null = null;
      for (let i = 0; i <= 400; i++) {
        const { st } = framing(i / 400, side, CHAR_H, 16 / 9);
        if (last) expect(Math.hypot(st.shot.px - last.x, st.shot.pz - last.z)).toBeLessThan(0.1);
        last = { x: st.shot.px, z: st.shot.pz };
      }
    }
  });

  it('keepLensClear backs off along the line of sight only as far as it must, and the match is cleared past all three', () => {
    const s = { px: 0, py: 1, pz: 0, tx: 0, ty: 1, tz: 10, fov: 32 };
    keepLensClear(s, [{ x: 0.5, z: 1 }], 4);
    expect(s.px).toBeCloseTo(0, 6);
    expect(Math.hypot(0.5 - s.px, 1 - s.pz)).toBeCloseTo(4, 3);
    const far = { px: 0, py: 1, pz: 0, tx: 0, ty: 1, tz: 10, fov: 32 };
    keepLensClear(far, [{ x: 0, z: 9 }], 4);
    expect(far.pz).toBe(0);
    const st = newSubStage();
    subStage(0, 1, st, CHAR_H);
    expect(subLensReach(st)).toBeGreaterThan(Math.hypot(st.official.x - st.shot.px, st.official.z - st.shot.pz) - 1e-9);
  });
});
