import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { FRAME_LEN, PF } from '../src/game/replay';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';
import { Footballer, PSTATE, type PoseInput } from '../src/render/characters';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { MatchSession } from '../src/game/matchSession';
import type { IncidentReplay } from '../src/game/incidentReplay';

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

  it.each([16 / 9, 852 / 393])('films a foul from its own lens, tight on the two men, whatever the loose ball does (aspect %s)', (aspect) => {
    const camera = new THREE.PerspectiveCamera(24, aspect, 0.5, 900);
    const rig = new CameraRig(camera);
    const frame = new Float32Array(FRAME_LEN);
    frame[PF] = 40; frame[PF + 1] = 3;
    frame[2 * PF] = 41; frame[2 * PF + 1] = 3.4;
    rig.players = frame;
    rig.replayKind = 'incident';
    rig.replayActors = [1, 2];
    rig.replayLens = { x: 40.5, y: 4.4, z: 13.7, fov: 25 };
    rig.setMode('replay');
    // The ball has run 20 m away: the wide fit would pull right back to keep it, the foul lens stays on the contact.
    rig.update(1 / 60, { bx: 20, by: 0.2, bz: -10, bvx: 0, bvz: 0, ax: 40, az: 3, attack: 1, tall: 1.94 }, 0);
    camera.updateMatrixWorld();
    expect(camera.position.x).toBeCloseTo(40.5, 3);
    expect(camera.position.z).toBeCloseTo(13.7, 3);
    expect(camera.fov).toBeCloseTo(25, 3);
    for (const [x, y, z] of [[40, 0, 3], [40, 1.94, 3], [41, 0, 3.4], [41, 1.94, 3.4]]) {
      const ndc = new THREE.Vector3(x, y, z).project(camera);
      expect(Math.abs(ndc.x)).toBeLessThan(0.5);
      expect(Math.abs(ndc.y)).toBeLessThan(0.7);
    }
    // An offside line's lens holds a fixed look instead.
    rig.replayLens = { x: 36, y: 12, z: 16, fov: 30, look: { x: 37, z: -2 } };
    rig.cut();
    rig.update(1 / 60, { bx: 20, by: 0.2, bz: -10, bvx: 0, bvz: 0, ax: 40, az: 3, attack: 1, tall: 1.94 }, 0);
    camera.updateMatrixWorld();
    const look = new THREE.Vector3(37, 0.9, -2).project(camera);
    expect(Math.hypot(look.x, look.y)).toBeLessThan(0.05);
  });

  for (const aspect of [852 / 393, 4 / 3, 9 / 19.5]) {
    it.each([
      { attacker: [36, 4], defender: [32, -5], dir: 1 },
      { attacker: [-36, -4], defender: [-32, 5], dir: -1 },
      { attacker: [46, 27], defender: [24, -27], dir: 1 },
      { attacker: [-46, -27], defender: [-24, 27], dir: -1 },
    ])('fits the actual offside release participants in its stable inspection shot at aspect ' + aspect + ': %j', ({ attacker, defender, dir }) => {
      const camera = new THREE.PerspectiveCamera(24, aspect, 0.5, 900);
      const cam = new CameraRig(camera);
      const frame = new Float32Array(FRAME_LEN);
      frame[9 * PF] = attacker[0]; frame[9 * PF + 1] = attacker[1];
      frame[13 * PF] = defender[0]; frame[13 * PF + 1] = defender[1];
      cam.players = frame;
      cam.replayKind = 'incident';
      cam.setMode('replay');
      const marks = { offside: vi.fn() };
      const session = Object.assign(Object.create(MatchSession.prototype), {
        match: { players: Array.from({ length: 22 }, (_, i) => ({ side: i < 11 ? 0 : 1 })), attackDir: () => dir },
        view: { headTop: 1.94, incidentMarks: marks }, cam, flash: { play: vi.fn() },
      }) as { showOffsideLine(clip: IncidentReplay): void };
      session.showOffsideLine({ frames: [frame], releaseIdx: 0,
        offside: { lineX: defender[0], attacker: 9, defender: 13 } } as IncidentReplay);
      expect(marks.offside).toHaveBeenCalledWith(defender[0], dir, 9, 13);
      const focus: CamFocus = { bx: 12 * dir, by: 0.2, bz: 0, bvx: 0, bvz: 0,
        ax: attacker[0], az: attacker[1], attack: dir, tall: 1.94 };
      cam.update(1 / 60, focus, 0);
      camera.updateMatrixWorld();
      for (const [x, z] of [attacker, defender]) for (const y of [0, 1.94]) {
        const ndc = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(0.9);
        expect(Math.abs(ndc.y)).toBeLessThan(0.9);
        expect(ndc.z).toBeGreaterThan(-1);
        expect(ndc.z).toBeLessThan(1);
      }
      const position = camera.position.clone(), quaternion = camera.quaternion.clone();
      for (let i = 0; i < 30; i++) cam.update(1 / 60, focus, i / 60);
      expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-6);
    });
  }
});

describe('incident replay badge', () => {
  it('shows the incident as plain text and resets it for the next goal replay', () => {
    const badge = { textContent: '' };
    const caption = { textContent: '' };
    const replayClasses = new Set<string>(['skip-only']);
    const rootClasses = new Set<string>();
    const classes = (values: Set<string>) => ({
      remove: (v: string) => values.delete(v),
      toggle: (v: string, on: boolean) => { if (on) values.add(v); else values.delete(v); },
    });
    const hud = Object.assign(Object.create(Hud.prototype), {
      replay: { classList: classes(replayClasses), querySelector: (q: string) => (q === 'b' ? badge : caption) },
      root: { classList: classes(rootClasses) }, hideLine: vi.fn(),
      banner: { classList: { remove: vi.fn() } }, bannerTimer: 2,
    }) as Hud;
    hud.setReplay(true, 'RED CARD REPLAY', 'FOUL BY 5 CINDER');
    expect(badge.textContent).toBe('RED CARD REPLAY');
    expect(caption.textContent).toBe('FOUL BY 5 CINDER');
    expect(replayClasses.has('skip-only')).toBe(false);
    expect(rootClasses.has('replaying')).toBe(true);
    expect((hud as unknown as { bannerTimer: number }).bannerTimer).toBe(0);
    hud.setReplay(false);
    expect(badge.textContent).toBe('REPLAY');
    expect(caption.textContent).toBe('');
    expect(rootClasses.has('replaying')).toBe(false);
    hud.setReplay(true, '<img src=x onerror=alert(1)>');
    expect(badge.textContent).toBe('<img src=x onerror=alert(1)>');
    hud.setReplay(false);
    hud.setReplay(true);
    expect(badge.textContent).toBe('REPLAY');
  });
});

describe('the side that concedes looks beaten', () => {
  const pose = (over: Partial<PoseInput>): PoseInput => ({ state: PSTATE.dejected, stateT: 1, speed: 0, runPhase: 0.2, kickT: 0,
    kickLeg: 1, lean: 0, diveDir: 0, headerT: 0, celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0, dt: 0, ...over });
  const limbs = (f: Footballer) => f as unknown as {
    armL: { rotation: { z: number } }; armR: { rotation: { z: number } }; head: { rotation: { z: number } }; body: { position: { y: number } };
  };

  it('never raises a dejected player\'s arms, standing or walking, and drops his head', () => {
    const team = makeTeam(PRESET_CLUBS[0]);
    // (Several men: the three outfield variants are spread across them.)
    for (const def of team.players.slice(1, 8)) {
      const f = new Footballer(def, team.kit, false);
      for (const speed of [0, 3.3]) {
        f.pose(pose({ speed }), 1.3);
        // An arm above the horizontal (1.57) is an arm in the air: the old hands-on-head pose had both at 2.55.
        expect(limbs(f).armL.rotation.z).toBeLessThan(1);
        expect(limbs(f).armR.rotation.z).toBeLessThan(1);
        expect(limbs(f).head.rotation.z).toBeLessThan(-0.3);
      }
      f.dispose();
    }
  });

  it('puts a beaten keeper on his knees, and keeps hands on head for a man sent off only', () => {
    const team = makeTeam(PRESET_CLUBS[0]);
    const keeper = new Footballer(team.players[0], team.kit, true);
    keeper.pose(pose({ keeper: true, speed: 3 }), 1.3);
    const walking = limbs(keeper).body.position.y;
    keeper.pose(pose({ keeper: true, speed: 0 }), 1.3);
    expect(limbs(keeper).body.position.y).toBeLessThan(walking * 0.7);
    expect(limbs(keeper).armR.rotation.z).toBeLessThan(1.6);
    keeper.dispose();
    const off = new Footballer(team.players[5], team.kit, false);
    off.pose(pose({ sentOff: true }), 1.3);
    expect(limbs(off).armL.rotation.z).toBeGreaterThan(2);
    off.dispose();
  });
});
