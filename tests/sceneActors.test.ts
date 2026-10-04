import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BOOKING_ACT_S, applyBookingAct } from '../src/game/bookingAct';
import { FRAME_LEN, PF, writeFrame } from '../src/game/replay';
import { SCENE_STYLE } from '../src/game/scenePoses';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { CELEB, Footballer, PSTATE, type PoseInput } from '../src/render/characters';
import { MatchAward } from '../src/render/matchAward';
import { Match } from '../src/sim/match';

const pose = (style: number, progress = 0): PoseInput => ({ state: PSTATE.celebrate, stateT: progress * 4,
  speed: style === CELEB.walkTalk ? 1.8 : 0, runPhase: progress, kickT: progress, kickLeg: 1, lean: 0,
  diveDir: 0, headerT: 0, celebrate: style, y: 0, keeper: false, hasBall: false, look: 0, turn: 0, dt: 0 });

describe('expressive scene actors', () => {
  it('has distinct pose keys for every scene style and renders finite, moving limbs', () => {
    const team = makeTeam(PRESET_CLUBS[0]);
    const f = new Footballer(team.players[7], team.kit, false);
    const keys: number[] = [];
    const snapshots: string[] = [];
    for (const style of Object.values(SCENE_STYLE)) {
      f.pose(pose(style, 0.4), 1.6);
      keys.push((f as unknown as { poseKey: number }).poseKey);
      const values: number[] = [];
      f.group.traverse((o) => { values.push(...o.position.toArray(), o.rotation.x, o.rotation.y, o.rotation.z, ...o.scale.toArray()); });
      expect(values.every(Number.isFinite)).toBe(true);
      snapshots.push(JSON.stringify(values));
    }
    expect(new Set(keys).size).toBe(Object.keys(SCENE_STYLE).length);
    expect(new Set(snapshots).size).toBe(Object.keys(SCENE_STYLE).length);
    f.dispose();
  });

  it('keeps talk gestures walking and makes the comic victim stand up again within the card shot', () => {
    const team = makeTeam(PRESET_CLUBS[0]);
    const f = new Footballer(team.players[7], team.kit, false);
    f.pose(pose(CELEB.walkTalk, 0.1), 0.4);
    const body = (f as unknown as { body: THREE.Group }).body;
    const legs = (f as unknown as { legL: THREE.Mesh; legR: THREE.Mesh });
    expect(Math.abs(legs.legL.rotation.z - legs.legR.rotation.z)).toBeGreaterThan(0.05);
    f.pose(pose(CELEB.ouch, 0.1), 0.4);
    const down = body.position.y;
    expect(body.rotation.z).toBeGreaterThan(0.7);
    f.pose(pose(CELEB.ouch, 1), BOOKING_ACT_S);
    expect(body.position.y).toBeGreaterThan(down + 0.1);
    expect(body.rotation.z).toBe(0);
    f.dispose();
  });

  it('exaggerates only the drawn victim frame while preserving simulation health, ball, cards and random state', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
    const source = new Float32Array(FRAME_LEN);
    writeFrame(m, source, 0);
    const original = JSON.stringify(m);
    const drawn = source.slice();
    applyBookingAct(drawn, 7, 2, 3, 0, BOOKING_ACT_S * 0.5);
    expect(drawn[7 * PF + 13]).toBe(CELEB.ouch);
    expect(drawn[7 * PF + 8]).toBe(0.5);
    expect(drawn[7 * PF + 14]).toBe(0);
    expect([...source.slice(22 * PF)]).toEqual([...drawn.slice(22 * PF)]);
    expect(JSON.stringify(m)).toBe(original);
  });
});

describe('MOTM award set', () => {
  it('hands the trophy to the player and lifts it with his pose, then removes all owned geometry on exit', () => {
    const award = new MatchAward();
    const parent = new THREE.Group(); parent.add(award.group);
    expect(award.group.visible).toBe(false);
    award.begin();
    award.update(0, 10, 4, 2.1, 0, 0, false);
    const trophy = (award as unknown as { trophy: THREE.Mesh }).trophy;
    const from = trophy.position.clone();
    award.update(0.8, 10, 4, 2.1, 3.2, 0.1, false);
    expect(trophy.position.x).toBeGreaterThan(from.x + 0.5);
    expect(trophy.position.y).toBeGreaterThan(from.y + 0.5);
    const winningHeight = trophy.position.y;
    award.update(0.8, 10, 4, 2.1, 3.2, 0.1, true);
    expect(trophy.position.y).toBeLessThan(winningHeight);
    const ownGeometry = vi.spyOn(trophy.geometry, 'dispose');
    const sharedMaterial = vi.spyOn(trophy.material as THREE.Material, 'dispose');
    award.end(); expect(award.group.visible).toBe(false);
    award.dispose();
    expect(ownGeometry).toHaveBeenCalledOnce();
    expect(sharedMaterial).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
