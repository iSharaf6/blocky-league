import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { advanceOffsideReplay } from '../src/game/offsideReplay';
import { FRAME_LEN, PF } from '../src/game/replay';
import { IncidentMarks } from '../src/render/incidentMarks';
import { PITCH_Y } from '../src/render/stadium';

describe('offside playback boundaries', () => {
  it('clamps on the release before rendering and keeps the fractional render time inside the decision hold', () => {
    const step = advanceOffsideReplay(59.5, 1 / 30, 60, false, 0, 1.5);
    expect(step.entered).toBe(true);
    expect(step.frame).toBe(60);
    expect(step.remaining).toBeCloseTo(1.5 - 0.025, 10);
    expect(step.moving).toBe(0);
    expect(step.frozen).toBe(true);
  });

  it('resumes with unused time in the same render instead of losing one frame at the end of the hold', () => {
    const step = advanceOffsideReplay(60, 0.04, 60, true, 0.015, 1.5);
    expect(step.resumed).toBe(true);
    expect(step.frame).toBeCloseTo(61.5, 10);
    expect(step.moving).toBeCloseTo(0.025, 10);
    expect(step.remaining).toBe(0);
    expect(step.frozen).toBe(false);
  });

  it('keeps all timing equivalent when a delayed render crosses both boundaries', () => {
    const whole = advanceOffsideReplay(48, 2.6, 60, false, 0, 1.5);
    let frame = 48, froze = false, remaining = 0;
    for (let i = 0; i < 260; i++) {
      const next = advanceOffsideReplay(frame, 0.01, 60, froze, remaining, 1.5);
      frame = next.frame; froze = next.froze; remaining = next.remaining;
    }
    expect(frame).toBeCloseTo(whole.frame, 8);
    expect(remaining).toBe(whole.remaining);
    expect(whole.frame).toBeCloseTo(114, 9);
  });

  it('does not restart an inspection when paused or after it resumes', () => {
    const paused = advanceOffsideReplay(60, 0, 60, true, 0.6, 1.5);
    expect(paused.remaining).toBe(0.6);
    expect(paused.entered).toBe(false);
    const resumed = advanceOffsideReplay(72, 0.02, 60, true, 0, 1.5);
    expect(resumed.frame).toBeCloseTo(73.2, 9);
    expect(resumed.entered).toBe(false);
    expect(resumed.resumed).toBe(false);
  });
});

describe('offside markings above the raised pitch', () => {
  it.each([-1, 1])('keeps the line, band and participant rings above the grass in attack direction %s', dir => {
    const scene = new THREE.Group();
    const marks = new IncidentMarks(scene);
    const frame = new Float32Array(FRAME_LEN);
    frame[9 * PF] = dir * 35; frame[9 * PF + 1] = 4;
    frame[13 * PF] = dir * 32; frame[13 * PF + 1] = -5;
    marks.offside(dir * 32, dir, 9, 13);
    marks.update(frame, 0);
    const group = scene.children[0];
    group.updateMatrixWorld(true);
    const visible = group.children.filter((o) => o.visible) as THREE.Mesh[];
    expect(visible).toHaveLength(4);
    for (const mesh of visible) {
      const p = mesh.getWorldPosition(new THREE.Vector3());
      expect(p.y).toBeGreaterThan(PITCH_Y + 0.03);
      expect((mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(true);
    }
    const line = visible.find(m => m.geometry instanceof THREE.PlaneGeometry && m.geometry.parameters.width < 1)!;
    const band = visible.find(m => m.geometry instanceof THREE.PlaneGeometry && m.geometry.parameters.width > 1)!;
    expect(line.position.x).toBe(dir * 32);
    expect(Math.sign(band.position.x - line.position.x)).toBe(dir);
    // Actual ray/geometry ordering: the grass cannot occlude the decision stripe from a camera above it.
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(100, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    grass.position.y = PITCH_Y;
    grass.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(dir * 32, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObjects([grass, line])[0].object).toBe(line);
    marks.clear();
    expect(marks.active).toBe(false);
    expect(group.children.every(o => !o.visible)).toBe(true);
    marks.dispose();
    grass.geometry.dispose(); (grass.material as THREE.Material).dispose();
    expect(scene.children).toHaveLength(0);
  });
});
