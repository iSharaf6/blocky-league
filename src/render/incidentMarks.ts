import * as THREE from 'three';
import { PF } from '../game/replay';
import { HALF_W } from '../sim/constants';
import { PITCH_Y } from './stadium';

/** The man who committed it (the opponents' ring red, brighter) and the man it was done to (the HUD's gold). */
const MARK_RED = 0xff4338;
const MARK_GOLD = 0xffd23a;
const MARK_WHITE = 0xfbfbf4;
const RING_IN = 0.62;
const RING_OUT = 0.86;
/** The offside line: a gold stripe across the pitch, and a faint band on the offside side of it. */
const LINE_W = 0.3;
const BAND_W = 3;

function flat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
  });
}

/**
 * What an incident replay draws on the lawn so the decision reads at a glance: a ring under each of the two men
 * in a foul, the offside line with the attacker and the second-last defender ringed. Drawn only; replay frames
 * and the sim never see it. The session shows it for a clip and clears it when the clip ends or is skipped.
 */
export class IncidentMarks {
  private readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];
  private readonly who: number[] = [-1, -1];
  private readonly line: THREE.Mesh;
  private readonly band: THREE.Mesh;
  private pulse = false;

  constructor(parent: THREE.Object3D) {
    for (const color of [MARK_RED, MARK_GOLD]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 28).rotateX(-Math.PI / 2), flat(color, 0.95));
      const edge = new THREE.Mesh(new THREE.RingGeometry(RING_OUT, RING_OUT + 0.07, 28).rotateX(-Math.PI / 2), flat(MARK_WHITE, 0.9));
      ring.add(edge);
      ring.renderOrder = 6;
      edge.renderOrder = 5;
      ring.frustumCulled = false;
      ring.visible = false;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.line = new THREE.Mesh(new THREE.PlaneGeometry(LINE_W, HALF_W * 2).rotateX(-Math.PI / 2), flat(MARK_GOLD, 0.95));
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(BAND_W, HALF_W * 2).rotateX(-Math.PI / 2), flat(MARK_RED, 0.2));
    for (const m of [this.line, this.band]) {
      m.renderOrder = m === this.line ? 5 : 4;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    this.group.visible = false;
    parent.add(this.group);
  }

  get active(): boolean { return this.group.visible; }

  /** Ring the two men of a foul: red under the man who committed it, gold under the man brought down. */
  foul(fouler: number, victim: number): void {
    this.clear();
    this.who[0] = fouler;
    this.who[1] = victim;
    this.pulse = true;
    this.group.visible = true;
  }

  /**
   * The offside line at `lineX` (the goal attacked lies towards `dir`: the band shades the offside side), with
   * the attacker ringed red and the second-last defender gold.
   */
  offside(lineX: number, dir: number, attacker: number, defender: number): void {
    this.clear();
    this.who[0] = attacker;
    this.who[1] = defender;
    this.pulse = false;
    // MatchView's group is at world height zero; the grass itself is raised by PITCH_Y. Depth bias cannot
    // reliably reveal a stripe buried underneath it, especially as a replay changes camera angle.
    this.line.position.set(lineX, PITCH_Y + 0.045, 0);
    this.band.position.set(lineX + dir * (BAND_W / 2 + LINE_W / 2), PITCH_Y + 0.04, 0);
    this.line.visible = this.band.visible = true;
    this.group.visible = true;
  }

  /** Follow the drawn frame (call after MatchView.apply). */
  update(f: Float32Array, time: number): void {
    if (!this.group.visible) return;
    const k = this.pulse ? 1 + Math.sin(time * 9) * 0.07 : 1;
    for (let j = 0; j < 2; j++) {
      const i = this.who[j];
      const ring = this.rings[j];
      const on = Number.isInteger(i) && i >= 0 && i < 22;
      ring.visible = on;
      if (!on) continue;
      ring.position.set(f[i * PF], PITCH_Y + 0.05, f[i * PF + 1]);
      ring.scale.setScalar(k);
    }
  }

  clear(): void {
    this.group.visible = false;
    this.who[0] = this.who[1] = -1;
    for (const r of this.rings) r.visible = false;
    this.line.visible = this.band.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  }
}
