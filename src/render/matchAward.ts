import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import type { Kit, PlayerDef } from '../sim/types';
import { CELEB, Footballer, PSTATE, screenCharK, type PoseInput } from './characters';
import { BoxBuilder, voxelMaterial } from './voxel';

const KIT: Kit = { shirt: 0x253345, shirt2: 0xffdf80, pattern: 'plain', shorts: 0x253345, socks: 0x253345, gk: 0x253345 };
const HOST: PlayerDef = { id: 'award-presenter', name: 'Match Presenter', number: 0, role: 'MF',
  stats: { pace: 30, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 },
  look: { skin: 2, hair: 1, hairColor: 1, beard: 0, boots: 0x253345 } };

/** The award actually passes from a presenter to the player's hands and rises with his pose. No sim actor is borrowed. */
export class MatchAward {
  readonly group = new THREE.Group();
  private readonly host = new Footballer(HOST, KIT, false);
  private readonly trophy: THREE.Mesh;
  private readonly pose: PoseInput = { state: PSTATE.hold, stateT: 0, speed: 0, runPhase: 0, kickT: 0,
    kickLeg: 1, lean: 0, diveDir: 0, headerT: 0, celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0, dt: 0 };

  constructor() {
    const b = new BoxBuilder();
    b.box(0, 0, 0, 0.48, 0.13, 0.34, 0x303542, { top: 0xf2ce70 });
    b.box(0, 0.2, 0, 0.13, 0.35, 0.13, 0xe9b648);
    b.box(0, 0.43, 0, 0.4, 0.16, 0.32, 0xffdc70, { top: 0xfff1b5 });
    for (const side of [-1, 1]) {
      b.box(side * 0.19, 0.57, 0, 0.12, 0.27, 0.34, 0xf2c14b);
      b.box(side * 0.34, 0.51, 0, 0.09, 0.29, 0.1, 0xffe799);
      b.box(side * 0.26, 0.65, 0, 0.24, 0.07, 0.1, 0xffe799);
    }
    b.box(0, 0.49, 0.18, 0.12, 0.17, 0.05, 0xffffff);
    this.trophy = new THREE.Mesh(b.build(), voxelMaterial);
    this.trophy.castShadow = true;
    this.group.add(this.host.group, this.trophy);
    this.group.visible = false;
  }

  begin(): void { this.group.visible = true; }

  update(fraction: number, x: number, z: number, tall: number, time: number, dt: number, lost: boolean): void {
    if (!this.group.visible) return;
    const k = clamp(fraction, 0, 1);
    const receive = smoothstep(0.15, 0.4, k);
    const lift = smoothstep(0.45, 0.72, k) * (lost ? 0.25 : 1);
    const scale = screenCharK();
    this.host.scaleK = scale;
    this.host.group.position.set(x - 1.25 - receive * 0.35, 0, z + 0.2);
    this.host.group.rotation.y = -0.08;
    const p = this.pose;
    p.state = receive < 0.85 ? PSTATE.hold : PSTATE.celebrate;
    p.celebrate = CELEB.clap;
    p.stateT = time;
    p.dt = dt;
    this.host.pose(p, time);
    this.trophy.scale.setScalar(scale);
    this.trophy.position.set(lerp(x - 0.68, x + 0.05, receive), tall * (0.5 + lift * 0.3), z + 0.48);
    this.trophy.rotation.y = Math.sin(time * 1.8) * 0.06;
  }

  end(): void { this.group.visible = false; }
  dispose(): void { this.end(); this.host.dispose(); this.trophy.geometry.dispose(); this.group.removeFromParent(); }
}
