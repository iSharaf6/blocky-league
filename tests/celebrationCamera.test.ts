import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';
import { HALF_L, HALF_W } from '../src/sim/constants';

describe('scorer close-ups by the corner flags', () => {
  it.each([16 / 9, 9 / 19.5])('keeps every low lens in front of the advertising boards at aspect %s', (aspect) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (const close of [false, true]) for (const locked of [false, true]) {
        const camera = new THREE.PerspectiveCamera(34, aspect, 0.5, 900);
        const rig = new CameraRig(camera);
        rig.setReducedMotion(true);
        rig.setMode('celebrate');
        const focus: CamFocus = {
          bx: 0, by: 0, bz: 0, bvx: 0, bvz: 0, attack: sx,
          ax: sx * (HALF_L - 4), az: sz * (HALF_W - 6), tall: 2.15, tight: true, close,
          // A celebration can request a view from the front as the scorer turns towards the crowd.
          lockAngle: locked ? Math.atan2(sz, sx) : undefined,
        };
        for (let frame = 0; frame < 180; frame++) {
          rig.update(1 / 60, focus, frame / 60);
          expect(Math.abs(camera.position.x)).toBeLessThanOrEqual(HALF_L + 3.4 + 1e-5);
          expect(Math.abs(camera.position.z)).toBeLessThanOrEqual(HALF_W + 2.2 + 1e-5);
        }
      }
    }
  });
});
