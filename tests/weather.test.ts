import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Weather } from '../src/render/weather';
import { normalizeSettings } from '../src/core/save';
import { stateHash } from '../src/net/hash';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { wetPatches, WEATHER_KINDS, type WeatherKind } from '../src/sim/weather';

function fixture(kind: WeatherKind, side: 0 | 1 = 0, onlineView?: 0 | 1) {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8,
    humanSide: onlineView ?? side, humanSides: onlineView === undefined ? undefined : [true, true], weather: kind, seed: 44 });
  m.phase = 'play'; m.phaseT = 0; m.restart = null; m.drainEvents();
  for (const p of m.players) {
    p.pos.x = -42 + p.idx * 3.7; p.pos.z = -HALF_W + 1;
    p.vel.x = p.vel.z = 0; p.setState('move'); p.order = null;
  }
  const p = m.players[side === 0 ? 9 : 20], patch = wetPatches('rain', 44)[side];
  p.pos.x = patch.x; p.pos.z = patch.z; p.facing = side === 0 ? 0 : Math.PI;
  p.vel.x = side === 0 ? 7.5 : -7.5; p.sprint = true; p.ballT = 2;
  m.ball.reset(p.footX(), p.footZ()); m.ball.owner = p.idx; m.ball.lastTouch = p.idx; m.ball.lastTouchSide = side;
  m.ctl[side].active = p.idx; m.updateBallPath();
  return { m, p, patch };
}
const cut = (side: 0 | 1): Pad => ({ ...EMPTY_PAD, mx: side === 0 ? -1 : 1, autoSprint: true });

describe('visible wet surfaces and controllable skids', () => {
  it('marks the same seeded, mirrored patches for both teams, clear of either penalty area', () => {
    const patches = wetPatches('rain', 44);
    expect(patches).toEqual(wetPatches('rain', 44));
    expect(patches).not.toEqual(wetPatches('rain', 45));
    expect(wetPatches('drizzle', 44)).toHaveLength(4);
    expect(wetPatches('clear', 44)).toEqual([]);
    for (let i = 0; i < patches.length; i += 2) {
      expect(patches[i + 1]).toEqual({ ...patches[i], x: -patches[i].x, z: -patches[i].z });
      expect(Math.abs(patches[i].x) + patches[i].rx).toBeLessThan(HALF_L - 15);
    }
  });

  it.each([0, 1] as const)('a sharp sprint cut on a visible rain puddle skids side %s and nudges its ball loose, without a foul', (side) => {
    const { m, p } = fixture('rain', side);
    m.step(DT, cut(side));
    const events = m.drainEvents();
    expect(events.filter((e) => e.type === 'slip' && e.player === p.idx)).toHaveLength(1);
    expect(p.state).toBe('fallen');
    expect(m.ball.owner).not.toBe(p.idx);
    expect(events.some((e) => e.type === 'foul')).toBe(false);
    expect(m.stats.fouls).toEqual([0, 0]);
    expect(m.ball.lastTouch).toBe(p.idx);
  });

  it.each(['clear', 'overcast', 'snow', 'blizzard'] as const)('%s never adds wet-surface slips', (kind) => {
    const { m, p } = fixture(kind);
    m.step(DT, cut(0));
    expect(m.drainEvents().some((e) => e.type === 'slip')).toBe(false);
    expect(m.ball.owner).toBe(p.idx);
  });

  it('straight sprints, slower turns, dry ground and a successfully timed skill keep their footing', () => {
    for (const safe of ['straight', 'jog', 'dry', 'skill'] as const) {
      const { m, p } = fixture('rain');
      let input = cut(0);
      if (safe === 'straight') input = { ...input, mx: 1 };
      if (safe === 'jog') { p.vel.x = 4; input = { ...input, mx: -0.3 }; }
      if (safe === 'dry') { p.pos.x = 32; m.ball.pos.x = p.footX(); }
      if (safe === 'skill') p.protectT = 0.8;
      m.step(DT, input);
      expect(m.drainEvents().some((e) => e.type === 'slip'), safe).toBe(false);
      expect(m.ball.owner, safe).toBe(p.idx);
    }
  });

  it('a wet skid recovers quickly and cannot repeatedly knock down the same player', () => {
    const { m, p } = fixture('rain');
    m.step(DT, cut(0)); m.drainEvents();
    for (let frame = 0; frame < 48; frame++) { m.step(DT, EMPTY_PAD); m.drainEvents(); }
    expect(p.state).toBe('move');
    // Try the same abrupt turn again within a second, using the real controller path.
    const patch = m.wetPatches[0];
    p.pos.x = patch.x; p.pos.z = patch.z; p.facing = 0; p.vel.x = 7.5; p.vel.z = 0;
    m.active = p.idx; m.ball.reset(p.footX(), p.footZ()); m.ball.owner = p.idx;
    m.step(DT, cut(0));
    expect(m.drainEvents().some((e) => e.type === 'slip' && e.player === p.idx)).toBe(false);
    expect(p.state).toBe('move');
  });

  it('the SKILL button completes its move over wet grass without cancelling it with a skid', () => {
    const { m, p } = fixture('rain');
    m.step(DT, { ...cut(0), skill: true });
    expect(m.ctl[0].skill.moves).toBe(1);
    expect(m.ctl[0].skill.move?.player).toBe(p.idx);
    expect(m.drainEvents().some((e) => e.type === 'slip')).toBe(false);
    expect(m.ball.owner).toBe(p.idx); expect(p.state).toBe('move');
  });

  it('weather and skid cooldowns participate in wet-match desync detection', () => {
    const { m, p } = fixture('rain');
    const before = stateHash(m); p.wetSlipT = 5;
    expect(stateHash(m)).not.toBe(before);
    p.wetSlipT = 0; m.cfg.weather = 'drizzle';
    expect(stateHash(m)).not.toBe(before);
  });

  it.each(['drizzle', 'rain'] as const)('%s peers remain identical through a skid, loose ball and recovery from opposite views', (kind) => {
    const { m: a, p: pa } = fixture(kind, 0, 0), { m: b, p: pb } = fixture(kind, 0, 1);
    let slips = 0;
    for (let frame = 0; frame < 180; frame++) {
      const pads: [Pad, Pad] = [frame === 0 ? cut(0) : EMPTY_PAD, EMPTY_PAD];
      a.step(DT, pads); b.step(DT, pads);
      const events = a.drainEvents();
      expect(b.drainEvents(), `frame ${frame}`).toEqual(events);
      expect(stateHash(a), `frame ${frame}`).toBe(stateHash(b));
      slips += events.filter((e) => e.type === 'slip' && e.player === pa.idx).length;
    }
    expect(slips).toBe(1); expect(pa.state).toBe('move'); expect(pb.state).toBe('move');
  });

  it('normalizes and preserves every selectable weather option', () => {
    for (const weather of WEATHER_KINDS) expect(normalizeSettings({ weather }).weather).toBe(weather);
    expect(normalizeSettings({ weather: 'hail' }).weather).toBe('random');
  });
});

describe('weather geometry and resources', () => {
  it('snow is visible falling geometry from the first frame, with a bounded phone particle budget', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = new Weather(); w.set('snow', 'low');
    const flakes = w.group.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(flakes.count).toBeGreaterThan(300); expect(flakes.count).toBeLessThan(1000);
    const first = new THREE.Matrix4(), next = new THREE.Matrix4();
    flakes.getMatrixAt(0, first); w.update(0.1, 0, 0, 1); flakes.getMatrixAt(0, next);
    expect(next.elements[13]).toBeLessThan(first.elements[13]);
    expect(first.elements[0]).toBeGreaterThan(0.5);
    expect((flakes.material as THREE.MeshBasicMaterial).fog).toBe(false);
    w.set('blizzard', 'low');
    const storm = w.group.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(storm.count).toBeGreaterThan(flakes.count); expect(storm.count).toBeLessThan(2000);
    w.dispose(); random.mockRestore();
  });

  it('keeps a teleported camera focus wrapped without particles wandering outside the budget box', () => {
    const w = new Weather(); w.set('snow', 'low'); w.update(0.1, 1000, -1000, 1);
    const flakes = w.group.children[0] as THREE.InstancedMesh, matrix = new THREE.Matrix4();
    for (let i = 0; i < flakes.count; i++) {
      flakes.getMatrixAt(i, matrix);
      expect(matrix.elements.every(Number.isFinite)).toBe(true);
      expect(Math.abs(matrix.elements[12] - 1000)).toBeLessThanOrEqual(45);
      expect(Math.abs(matrix.elements[14] + 1000)).toBeLessThanOrEqual(35);
    }
    w.dispose();
  });

  it('draws the exact gameplay puddles and releases GPU allocations on setting changes and match exit', () => {
    const w = new Weather(); w.set('rain', 'low', 44);
    expect(w.group.children.filter((o) => o.name === 'wet-patch').map((o) => [o.position.x, o.position.z]))
      .toEqual(wetPatches('rain', 44).map((p) => [p.x, p.z]));
    const rain = w.group.children.find((o) => o instanceof THREE.LineSegments) as THREE.LineSegments;
    const geometry = vi.spyOn(rain.geometry, 'dispose'), material = vi.spyOn(rain.material as THREE.Material, 'dispose');
    w.set('rain', 'low', 44); expect(geometry).not.toHaveBeenCalled();
    w.set('snow', 'low', 44); expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
    const flakes = w.group.children[0] as THREE.InstancedMesh;
    const snowGeometry = vi.spyOn(flakes.geometry, 'dispose');
    const snowInstances = vi.spyOn(flakes, 'dispose');
    const scene = new THREE.Scene(); scene.add(w.group); w.dispose();
    expect(snowGeometry).toHaveBeenCalledOnce(); expect(snowInstances).toHaveBeenCalledOnce();
    expect(w.group.children).toHaveLength(0); expect(scene.children).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
