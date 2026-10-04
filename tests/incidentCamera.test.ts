import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { FRAME_LEN, PF } from '../src/game/replay';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';

describe('incident replay framing', () => {
  for (const aspect of [16 / 9, 9 / 19.5, 4 / 3]) {
    it.each([
      { kind: 'midfield foul', ball: [4, 0.2, -1], actors: [[3, -1], [5, 0]] },
      { kind: 'penalty award', ball: [38, 0.2, 0], actors: [[37, 1], [39, 0.5]] },
      { kind: 'offside pass', ball: [15, 0.2, 4], actors: [[39, -5], [15, 4]] },
      { kind: 'saved penalty', ball: [47, 1, 2], actors: [[36, 0], [47, 2]] },
      { kind: 'high penalty miss', ball: [52, 10, 13], actors: [[38, 0], [48, 2]] },
      { kind: 'far touchline incident', ball: [-40, 0.2, -27], actors: [[-39, -26], [-41, -27]] },
    ])('keeps the ball and both participants visible in $kind at aspect ' + aspect, ({ ball, actors }) => {
      const camera = new THREE.PerspectiveCamera(24, aspect, 0.5, 900);
      const rig = new CameraRig(camera);
      const frame = new Float32Array(FRAME_LEN);
      actors.forEach(([x, z], n) => { frame[(n + 1) * PF] = x; frame[(n + 1) * PF + 1] = z; });
      rig.players = frame;
      rig.replayKind = 'incident';
      rig.replayActors = [1, 2];
      // Incident type must win even if a previous goal left its goal-line shot selected.
      rig.replayShot = 'goal';
      rig.setMode('replay');
      const focus: CamFocus = { bx: ball[0], by: ball[1], bz: ball[2], bvx: 0, bvz: 0,
        ax: actors[0][0], az: actors[0][1], attack: 1, tall: 1.94 };
      rig.update(1 / 60, focus, 0);
      camera.updateMatrixWorld();
      const points = [ball, ...actors.flatMap(([x, z]) => [[x, 0, z], [x, 1.94, z]])];
      for (const [x, y, z] of points) {
        const ndc = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(0.9);
        expect(Math.abs(ndc.y)).toBeLessThan(0.9);
        expect(ndc.z).toBeGreaterThan(-1);
        expect(ndc.z).toBeLessThan(1);
      }
    });
  }

  it('ignores absent and invalid participants without creating a broken camera', () => {
    const camera = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 900);
    const rig = new CameraRig(camera);
    rig.replayKind = 'incident';
    rig.replayActors = [-1, 99, Number.NaN];
    rig.setMode('replay');
    rig.update(1 / 60, { bx: 0, by: 0.2, bz: 0, bvx: 0, bvz: 0, ax: 0, az: 0, attack: 1 }, 0);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });
});

describe('incident replay badge', () => {
  it('shows the incident as plain text and resets it for the next goal replay', () => {
    const badge = { textContent: '' };
    const replayClasses = new Set<string>(['skip-only']);
    const rootClasses = new Set<string>();
    const classes = (values: Set<string>) => ({
      remove: (v: string) => values.delete(v),
      toggle: (v: string, on: boolean) => { if (on) values.add(v); else values.delete(v); },
    });
    const hud = Object.assign(Object.create(Hud.prototype), {
      replay: { classList: classes(replayClasses), querySelector: () => badge },
      root: { classList: classes(rootClasses) }, hideLine: vi.fn(),
      banner: { classList: { remove: vi.fn() } }, bannerTimer: 2,
    }) as Hud;
    hud.setReplay(true, 'RED CARD REPLAY');
    expect(badge.textContent).toBe('RED CARD REPLAY');
    expect(replayClasses.has('skip-only')).toBe(false);
    expect(rootClasses.has('replaying')).toBe(true);
    expect((hud as unknown as { bannerTimer: number }).bannerTimer).toBe(0);
    hud.setReplay(false);
    expect(badge.textContent).toBe('REPLAY');
    expect(rootClasses.has('replaying')).toBe(false);
    hud.setReplay(true, '<img src=x onerror=alert(1)>');
    expect(badge.textContent).toBe('<img src=x onerror=alert(1)>');
    hud.setReplay(false);
    hud.setReplay(true);
    expect(badge.textContent).toBe('REPLAY');
  });
});
