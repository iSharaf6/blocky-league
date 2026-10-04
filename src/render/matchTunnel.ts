import * as THREE from 'three';
import { TUNNEL_MOUTH_Z } from '../game/matchInterludes';
import { BoxBuilder, voxelMaterial } from './voxel';

/** A compact match-story set, between the dugouts. Hidden throughout play, so every club keeps its own ground. */
export class MatchTunnel {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;

  constructor(home: number, away: number) {
    const z = TUNNEL_MOUTH_Z;
    const b = new BoxBuilder();
    // Two kit-coloured pillars frame a real dark passage, with a covered roof, lit stripes and a rubber floor.
    b.box(-3.5, 1.95, z + 1, 0.45, 3.9, 2.35, 0x2c303d, { top: home });
    b.box(3.5, 1.95, z + 1, 0.45, 3.9, 2.35, 0x2c303d, { top: away });
    b.box(0, 4.05, z + 1, 7.45, 0.35, 2.6, 0x333849, { top: 0x495166 });
    b.box(0, 1.95, z + 2.25, 7.2, 3.9, 0.25, 0x11151e);
    b.box(0, 0.02, z + 0.55, 6.7, 0.035, 3.1, 0x303743);
    for (const [x, colour] of [[-3.23, home], [3.23, away]] as const) {
      b.box(x, 2.04, z - 0.2, 0.16, 3.8, 0.09, colour);
      b.box(x, 3.65, z - 0.25, 0.24, 0.08, 0.08, 0xfff0b2);
      b.box(x, 0.4, z - 0.25, 0.24, 0.07, 0.08, 0xfff0b2);
    }
    // A pair of ceiling panels give the passage depth without adding real-time lights on a phone.
    for (const depth of [0.35, 1.5]) b.box(0, 3.87, z + depth, 3.2, 0.025, 0.22, 0xe8edd6);
    this.mesh = new THREE.Mesh(b.build(), voxelMaterial);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  show(visible: boolean): void { this.group.visible = visible; }

  dispose(): void {
    this.group.visible = false;
    this.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
