import * as THREE from 'three';
import type { SubStage } from '../game/showcase';
import { STRIDE } from '../sim/constants';
import type { Kit, PlayerDef } from '../sim/types';
import { CELEB, Footballer, PSTATE, screenCharK, type PoseInput } from './characters';
import { BoxBuilder, voxelMaterial } from './voxel';

/**
 * A substitution on the touchline (the owner: "have a substitiution cutscene of the players ... dont overcomplicate
 * it"): the man coming off, the man coming on, the fourth official and his board with the two numbers (red off, green
 * on). game/showcase.ts says where everyone is at each moment (subStage); this draws them. Its own three footballers,
 * made per change from the cached voxel parts and thrown away after: the 22 in the match are never borrowed, so the
 * sim, its frames and the replays never see a substitution scene.
 */

/** 3x5 pixel digits, rows top to bottom (the board's LEDs). */
const DIGITS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/** The board: its size (m), an LED's size, and the two colours. */
const BOARD_W = 1.5;
const BOARD_H = 0.62;
const BOARD_D = 0.08;
const LED = 0.074;
export const SUB_RED = 0xff4a3d;
export const SUB_GREEN = 0x46e36a;
const INK = 0x1c1c22;

/** The fourth official: dark tracksuit, a bright bib colour on the trim, nobody in the squads looks like him. */
const OFFICIAL_KIT: Kit = { shirt: 0x26262e, shirt2: 0xd8f13a, pattern: 'plain', shorts: 0x26262e, socks: 0x26262e, gk: 0x26262e };
const OFFICIAL_DEF: PlayerDef = {
  id: 'fourth-official', name: 'Fourth Official', number: 4, role: 'MF',
  stats: { pace: 50, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 },
  look: { skin: 1, hair: 2, hairColor: 1, beard: 0, boots: 0x26262e },
};

/**
 * The LED cells of a number on the board (at most two digits), centred on `cx` in board space: u runs to the right as
 * the lens sees it, v up. Returns [u, v] pairs (cell centres).
 */
export function boardCells(n: number, cx: number): [number, number][] {
  const text = String(Math.max(0, Math.min(99, Math.round(n))));
  const w = text.length * 3 + (text.length - 1);
  const out: [number, number][] = [];
  [...text].forEach((ch, d) => {
    const rows = DIGITS[ch] ?? DIGITS['0'];
    rows.forEach((row, r) => {
      [...row].forEach((c, col) => {
        if (c !== '1') return;
        out.push([cx + (d * 4 + col - (w - 1) / 2) * LED, (2 - r) * LED]);
      });
    });
  });
  return out;
}

export class SubScene {
  readonly group = new THREE.Group();
  private off: Footballer | null = null;
  private on: Footballer | null = null;
  private official: Footballer | null = null;
  private board: THREE.Group | null = null;
  private leds: THREE.Mesh | null = null;
  private readonly ledMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private offPhase = 0;
  private onPhase = 0;
  private pose: PoseInput = {
    state: PSTATE.move, stateT: 1, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
    celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0, signal: false, signalKind: 0, dt: 0,
  };

  constructor() {
    this.group.visible = false;
  }

  get active(): boolean {
    return this.group.visible;
  }

  /** A change begins: `off` for `on`, in `kit` (a keeper's change wears the keeper's strip). */
  begin(off: PlayerDef, on: PlayerDef, kit: Kit, keeper: boolean): void {
    this.clearMen();
    this.off = new Footballer(off, kit, keeper);
    this.on = new Footballer(on, kit, keeper);
    this.official ??= new Footballer(OFFICIAL_DEF, OFFICIAL_KIT, false);
    this.group.add(this.off.group, this.on.group, this.official.group);
    this.buildBoard(off.number, on.number);
    this.offPhase = 0;
    this.onPhase = 0.5;
    this.group.visible = true;
  }

  /** The board: a dark panel on a pole with a yellow top rail, the LEDs standing a little proud of it. */
  private buildBoard(off: number, on: number): void {
    if (!this.board) {
      const b = new BoxBuilder();
      b.box(0, 0, 0, BOARD_W, BOARD_H, BOARD_D, INK, { top: 0xffd23a });
      b.box(0, -BOARD_H / 2 - 0.42, 0.02, 0.07, 0.84, 0.07, 0x8f939c);
      // A hairline between the two numbers.
      b.box(0, 0, -BOARD_D / 2 - 0.004, 0.02, BOARD_H * 0.7, 0.01, 0x4a4a56);
      const panel = new THREE.Mesh(b.build(), voxelMaterial);
      panel.castShadow = true;
      this.board = new THREE.Group();
      this.board.add(panel);
      this.group.add(this.board);
    }
    if (this.leds) {
      this.leds.geometry.dispose();
      this.leds.removeFromParent();
    }
    const l = new BoxBuilder();
    // (The lens looks at the board's -z face, where screen right is -x: the red number goes on the left as seen.)
    const z = -BOARD_D / 2 - 0.012;
    for (const [u, v] of boardCells(off, -BOARD_W * 0.26)) l.box(-u, v, z, LED * 0.86, LED * 0.86, 0.024, SUB_RED);
    for (const [u, v] of boardCells(on, BOARD_W * 0.26)) l.box(-u, v, z, LED * 0.86, LED * 0.86, 0.024, SUB_GREEN);
    this.leds = new THREE.Mesh(l.build(), this.ledMat);
    this.board.add(this.leds);
  }

  /** Draw the change at this moment (game/showcase.ts subStage). `dt` 0: a cut (no cross-fade into the pose). */
  update(st: SubStage, time: number, dt: number): void {
    if (!this.off || !this.on || !this.official) return;
    const k = screenCharK();
    this.offPhase = (this.offPhase + (st.off.speed * dt) / (2 * STRIDE)) % 1;
    this.onPhase = (this.onPhase + (st.on.speed * dt) / (2 * STRIDE)) % 1;
    this.place(this.off, st.off.x, st.off.z, st.off.facing, st.off.speed, this.offPhase, st.off.arm ? 'five' : '', 0, time, dt, k);
    // (The man waiting to come on bounces on his toes.)
    const hop = st.on.speed > 0 || st.on.arm ? 0 : Math.abs(Math.sin(time * 9)) * 0.07;
    this.place(this.on, st.on.x, st.on.z, st.on.facing, st.on.speed, this.onPhase, st.on.arm ? 'five' : '', hop, time, dt, k);
    // The official holds the board up beside him.
    this.place(this.official, st.official.x, st.official.z, st.official.facing, 0, 0.2, 'board', 0, time + 0.8, dt, k);
    if (this.board) {
      this.board.position.set(st.board.x, st.board.y, st.board.z);
      this.board.scale.setScalar(k);
    }
  }

  /**
   * Stand, jog or pose one of them. `act`: 'five' the high five (both arms up and off the ground: a single raised arm
   * hides behind these big heads), 'board' the official's arm up with the board, '' nothing.
   */
  private place(fb: Footballer, x: number, z: number, facing: number, speed: number, phase: number, act: 'five' | 'board' | '', y: number, time: number, dt: number, k: number): void {
    fb.scaleK = k;
    fb.group.position.set(x, 0, z);
    fb.group.rotation.y = -facing;
    const p = this.pose;
    const five = act === 'five';
    p.state = five ? PSTATE.celebrate : PSTATE.move;
    p.celebrate = five ? CELEB.armsUp : 0;
    p.speed = five ? 0 : speed;
    p.runPhase = five ? 0 : phase;
    p.signal = act === 'board';
    p.y = y;
    p.dt = dt;
    fb.pose(p, time);
  }

  private clearMen(): void {
    this.off?.dispose();
    this.on?.dispose();
    this.off = null;
    this.on = null;
  }

  /** The change is over: off the grass. */
  end(): void {
    this.clearMen();
    this.group.visible = false;
  }

  dispose(): void {
    this.end();
    this.official?.dispose();
    this.official = null;
    this.leds?.geometry.dispose();
    this.board?.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.leds) o.geometry.dispose();
    });
    this.ledMat.dispose();
    this.group.removeFromParent();
  }
}
