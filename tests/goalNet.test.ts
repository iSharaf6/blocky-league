import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GoalNet } from '../src/render/goalNet';
import { BALL_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L } from '../src/sim/constants';

const positions = (net: GoalNet) => net.mesh.geometry.getAttribute('position').array as Float32Array;

describe('goal-net contacts', () => {
  it.each([-1, 1])('a back-net hit at goal %s ripples outward, leaving the roof, side panels and frame seams attached', (sign) => {
    const net = new GoalNet(sign), base = positions(net).slice();
    net.punch(sign * (HALF_L + GOAL_DEPTH - BALL_R), GOAL_H / 2, 0, 1.4); net.update(0.01);
    const p = positions(net), normals = net.mesh.geometry.getAttribute('normal');
    let moved = 0;
    for (let i = 0; i < p.length; i += 3) {
      const nx = normals.getX(i / 3);
      const edge = Math.abs(base[i + 1]) < 0.001 || Math.abs(base[i + 1] - GOAL_H) < 0.001 || Math.abs(Math.abs(base[i + 2]) - GOAL_W / 2) < 0.001;
      if (!nx || edge) expect([...p.slice(i, i + 3)]).toEqual([...base.slice(i, i + 3)]);
      else if (p[i] !== base[i]) { moved++; expect((p[i] - base[i]) * sign).toBeGreaterThan(0); }
    }
    expect(moved).toBeGreaterThan(10);
    net.update(2); expect([...positions(net)]).toEqual([...base]);
  });

  it.each(['roof', 'side'] as const)('a %s contact deforms that panel instead of blindly stretching every panel at the same y/z', (panel) => {
    const net = new GoalNet(1), base = positions(net).slice();
    net.punch(HALF_L + GOAL_DEPTH / 2, panel === 'roof' ? GOAL_H - BALL_R : 1.2, panel === 'roof' ? 0 : GOAL_W / 2 - BALL_R, 1.2);
    net.update(0.01);
    const p = positions(net), normals = net.mesh.geometry.getAttribute('normal');
    let moved = 0;
    for (let i = 0; i < p.length; i += 3) {
      const wanted = panel === 'roof' ? normals.getY(i / 3) === 1 : normals.getZ(i / 3) === 1;
      if (!wanted) expect([...p.slice(i, i + 3)]).toEqual([...base.slice(i, i + 3)]);
      else if (p[i + 1] !== base[i + 1] || p[i + 2] !== base[i + 2]) moved++;
    }
    expect(moved).toBeGreaterThan(5);
  });

  it('repeated contacts remain bounded and invalid events cannot corrupt GPU geometry', () => {
    const net = new GoalNet(1), base = positions(net).slice();
    net.punch(Number.NaN, 1, 0, 1); net.punch(HALF_L + GOAL_DEPTH, 1, 0, Infinity);
    for (let i = 0; i < 100; i++) { net.punch(HALF_L + GOAL_DEPTH, 1.2, 0, 100); net.update(1 / 120); }
    expect([...positions(net)].every(Number.isFinite)).toBe(true);
    for (let i = 0; i < base.length; i++) expect(Math.abs(positions(net)[i] - base[i])).toBeLessThanOrEqual(0.551);
    expect(net.mesh.geometry.boundingSphere).toBeInstanceOf(THREE.Sphere);
    net.update(2); expect([...positions(net)]).toEqual([...base]);
  });

  it('the shop goal uses the same anchored cloth at its own dimensions, without moving the posts', () => {
    const net = new GoalNet(-1, null, 0.045, { goalX: -1.12, width: 2.5, height: 1.55, depth: 0.76 });
    const base = positions(net).slice();
    net.punch(-1.88, 0.8, -0.1, 1.2); net.update(0.01);
    const p = positions(net);
    let moved = 0;
    for (let i = 0; i < p.length; i += 3) {
      const seam = Math.abs(base[i + 1]) < 0.001 || Math.abs(base[i + 1] - 1.55) < 0.001 || Math.abs(Math.abs(base[i + 2]) - 1.25) < 0.001;
      if (seam) expect([...p.slice(i, i + 3)]).toEqual([...base.slice(i, i + 3)]);
      if (p[i] !== base[i]) { moved++; expect(p[i]).toBeLessThan(base[i]); }
    }
    expect(moved).toBeGreaterThan(10);
    expect(net.mesh.position.length()).toBe(0);
    expect(net.mesh.scale.toArray()).toEqual([1, 1, 1]);
    net.reset(); expect([...positions(net)]).toEqual([...base]);
  });
});
