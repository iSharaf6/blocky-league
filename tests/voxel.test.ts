import { describe, expect, it } from 'vitest';
import { BoxBuilder, VoxelGrid, meshVoxels } from '../src/render/voxel';

describe('voxel mesher', () => {
  it('culls hidden faces: a 2x1x1 bar has 10 faces', () => {
    const g = new VoxelGrid(2, 1, 1);
    g.set(0, 0, 0, 0xff0000);
    g.set(1, 0, 0, 0xff0000);
    const geo = meshVoxels(g, { scale: 1, pivot: [0, 0, 0] });
    expect(geo.getAttribute('position').count).toBe(10 * 4);
    expect(geo.getIndex()!.count).toBe(10 * 6);
  });

  it('solid 3^3 cube only emits its 54 outer faces', () => {
    const g = new VoxelGrid(3, 3, 3);
    g.box(0, 0, 0, 3, 3, 3, 0x00ff00);
    const geo = meshVoxels(g, { scale: 0.1, pivot: [1.5, 0, 1.5] });
    expect(geo.getAttribute('position').count).toBe(54 * 4);
    // Pivot shifts the origin to the bottom centre.
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0);
    expect(bb.max.y).toBeCloseTo(0.3);
    expect(bb.min.x).toBeCloseTo(-0.15);
  });

  it('bakes darker AO into inner corners', () => {
    // A floor with two walls meeting in a corner: the floor corner vertex sees both walls.
    const g = new VoxelGrid(3, 2, 3);
    g.box(0, 0, 0, 3, 1, 3, 0xffffff);
    g.box(0, 1, 0, 3, 1, 1, 0xffffff);
    g.box(0, 1, 0, 1, 1, 3, 0xffffff);
    const geo = meshVoxels(g, { scale: 1, pivot: [0, 0, 0], faceTint: false });
    const col = geo.getAttribute('color');
    let min = 1;
    let max = 0;
    for (let i = 0; i < col.count; i++) {
      min = Math.min(min, col.getX(i));
      max = Math.max(max, col.getX(i));
    }
    expect(max).toBeCloseTo(1);
    expect(min).toBeLessThan(0.8);
  });

  it('box builder faces point outwards', () => {
    const geo = new BoxBuilder().box(0, 0, 0, 2, 2, 2, 0xffffff).build();
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const dot = pos.getX(i) * nor.getX(i) + pos.getY(i) * nor.getY(i) + pos.getZ(i) * nor.getZ(i);
      expect(dot).toBeGreaterThan(0);
    }
  });
});
