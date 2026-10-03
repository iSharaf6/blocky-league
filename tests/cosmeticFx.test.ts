import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALL_SKIN_IDS, GOAL_FX_IDS, TRAIL_IDS } from '../src/core/save';
import { BALL_SKINS, buildBallGeometry } from '../src/render/characters';
import { goalFxColors, trailColors } from '../src/render/cosmetics';
import { GOAL_SHOWS, goalShow } from '../src/render/fx/goals';
import { FxKit, TrailState } from '../src/render/fx/kit';
import { SHAPE_COUNT, shapeGeometry, type ShapeId } from '../src/render/fx/shapes';
import { TRAILS, emitTrail, trailDef } from '../src/render/fx/trails';

/**
 * The shop's cosmetics are effects, not colour swaps (owner: "every other thing looks like a different colour"):
 * every goal explosion and trail has its own script, runs clean (no NaN, nothing left behind) and every ball
 * look is its own model.
 */

const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
camera.position.set(0, 24, 40);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

const m4 = new THREE.Matrix4();

/** The number of instances drawn (-1 if any matrix isn't finite). */
function drawnFinite(kit: FxKit): number {
  let n = 0;
  for (const o of kit.group.children) {
    const mesh = o as THREE.InstancedMesh;
    const a = mesh.instanceMatrix.array;
    for (let i = 0; i < mesh.count * 16; i++) if (!Number.isFinite(a[i])) return -1;
    n += mesh.count;
  }
  return n;
}

describe('goal explosions', () => {
  it('every one but Club Colours has its own show, its own script', () => {
    const paid = GOAL_FX_IDS.filter((id) => id !== 'club');
    for (const id of paid) expect(goalShow(id), id).not.toBeNull();
    expect(goalShow('club')).toBeNull();
    expect(goalShow('nope')).toBeNull();
    expect(goalShow(undefined)).toBeNull();
    // Not one script reused under another name (that would be a colourway again).
    expect(new Set(paid.map((id) => GOAL_SHOWS[id].run)).size).toBe(paid.length);
    expect(Object.keys(GOAL_SHOWS).sort()).toEqual([...paid].sort());
  });

  it('each goes off big within its first second, reads for 2 to 3 s, and leaves nothing behind', { timeout: 60_000 }, () => {
    for (const id of GOAL_FX_IDS) {
      const def = goalShow(id);
      if (!def) continue;
      expect(def.dur).toBeGreaterThanOrEqual(1.5);
      expect(def.dur).toBeLessThanOrEqual(3.5);
      expect(def.still).toBeLessThan(def.dur);
      const kit = new FxKit();
      kit.play(def.run, def.dur, 52.5, 0, 0, -1, 0, 1, goalFxColors(id, [1, 2, 3]), 0.5);
      let peak = 0;
      let early = 0;
      let bad = false;
      const dt = 1 / 60;
      for (let t = 0; t < def.dur + 4; t += dt) {
        kit.update(dt, camera);
        const n = drawnFinite(kit);
        if (n < 0) bad = true;
        peak = Math.max(peak, n);
        if (t < 1) early = Math.max(early, n);
      }
      expect(bad, id).toBe(false);
      // (Some shows are a few big props, a searchlight show's beams; most are hundreds of bits.)
      expect(early, id).toBeGreaterThan(8);
      expect(peak, id).toBeGreaterThan(12);
      expect(kit.running, id).toBe(0);
      expect(kit.live, id).toBe(0);
      kit.dispose();
    }
  });

  it('a show at the stage scale stays the stage size', { timeout: 20_000 }, () => {
    const def = goalShow('fireworks')!;
    const kit = new FxKit();
    kit.play(def.run, def.dur, 0, 0, 0, 1, 0, 0.34, [0xffffff], 0);
    let top = 0;
    for (let t = 0; t < 2.5; t += 1 / 60) {
      kit.update(1 / 60, camera);
      for (const o of kit.group.children) {
        const mesh = o as THREE.InstancedMesh;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m4);
          top = Math.max(top, m4.elements[13]);
        }
      }
    }
    // A real show's bursts go off ~10 m up; a third the size stays inside the showcase.
    expect(top).toBeGreaterThan(1.5);
    expect(top).toBeLessThan(6);
    kit.dispose();
  });
});

describe('trails', () => {
  it('every one but Chalk has its own emitter', () => {
    const paid = TRAIL_IDS.filter((id) => id !== 'white');
    for (const id of paid) expect(trailDef(id), id).not.toBeNull();
    expect(trailDef('white')).toBeNull();
    expect(new Set(paid.map((id) => TRAILS[id].run)).size).toBe(paid.length);
    expect(Object.keys(TRAILS).sort()).toEqual([...paid].sort());
  });

  it('each streams behind a sprinter and behind a ball, then clears away', { timeout: 60_000 }, () => {
    for (const id of TRAIL_IDS) {
      if (!trailDef(id)) continue;
      for (const air of [false, true]) {
        const kit = new FxKit();
        const st = new TrailState();
        let x = 0;
        let peak = 0;
        let bad = false;
        const dt = 1 / 60;
        const speed = air ? 24 : 8;
        for (let t = 0; t < 1.5; t += dt) {
          x += speed * dt;
          expect(emitTrail(kit, st, id, trailColors(id), x, air ? 1 : 0, 3, 1, 0, speed, dt, 1.2, air)).toBe(true);
          kit.update(dt, camera);
          const n = drawnFinite(kit);
          if (n < 0) bad = true;
          peak = Math.max(peak, n);
        }
        expect(bad, id).toBe(false);
        expect(peak, `${id} ${air ? 'ball' : 'runner'}`).toBeGreaterThan(3);
        // Readable, never a wall: a sprinter's trail stays a modest crowd of bits.
        expect(peak, id).toBeLessThan(260);
        for (let t = 0; t < 4; t += dt) kit.update(dt, camera);
        expect(kit.live, id).toBe(0);
        kit.dispose();
      }
    }
    expect(emitTrail(new FxKit(), new TrailState(), 'white', [0xffffff], 0, 0, 0, 1, 0, 8, 1 / 60)).toBe(false);
  });
});

describe('the props and the balls', () => {
  it('every prop builds', () => {
    for (let i = 0; i < SHAPE_COUNT; i++) {
      const g = shapeGeometry(i as ShapeId);
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('color')).toBeDefined();
    }
  });

  it('every ball look is its own model (a shape or a pattern, not the same ball recoloured)', () => {
    expect([...BALL_SKINS].sort()).toEqual([...BALL_SKIN_IDS].sort());
    const sig = (id: (typeof BALL_SKINS)[number]) => {
      const g = buildBallGeometry(0.5, id);
      const pos = g.getAttribute('position');
      const col = g.getAttribute('color');
      // Shape: the vertex count; pattern: how many distinct colours, and where they sit.
      const tones = new Set<string>();
      let where = 0;
      for (let i = 0; i < col.count; i++) {
        tones.add(`${col.getX(i).toFixed(2)},${col.getY(i).toFixed(2)},${col.getZ(i).toFixed(2)}`);
        where += (col.getX(i) * 3 + col.getY(i) * 5 + col.getZ(i) * 7) * (pos.getX(i) + 2 * pos.getY(i) + 3 * pos.getZ(i));
      }
      return { verts: pos.count, tones: tones.size, where: where.toFixed(3) };
    };
    const sigs = BALL_SKINS.map((id) => sig(id));
    const keys = new Set(sigs.map((s) => `${s.verts}|${s.where}`));
    expect(keys.size).toBe(BALL_SKINS.length);
    // Shape changes: the spiky ice ball, the cut diamond, the melon's stalk and the planet's ring aren't plain spheres.
    const classic = sig('classic');
    for (const id of ['ice', 'diamond', 'planet'] as const) expect(sig(id).verts, id).not.toBe(classic.verts);
  });
});
