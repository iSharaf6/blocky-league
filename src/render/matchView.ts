import * as THREE from 'three';
import { lerp, wrapAngle } from '../core/math';
import { BALL_OFS, PF } from '../game/replay';
import { BALL_R } from '../sim/constants';
import type { Kit, TeamDef } from '../sim/types';
import { Footballer, buildBallGeometry, type PoseInput } from './characters';
import { BoxBuilder, voxelMaterial } from './voxel';

/** Everything that draws a match: 22 voxel footballers, the ball, and the control marker. */
export class MatchView {
  readonly group = new THREE.Group();
  readonly players: Footballer[] = [];
  readonly ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private marker: THREE.Group;
  private markerRing: THREE.Mesh;
  private arrow: THREE.Mesh;
  private powerBar: THREE.Group;
  private powerFill: THREE.Mesh;
  private ballQuat = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private pose: PoseInput = {
    state: 0, stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
    celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0,
  };
  private lastFacing = new Float32Array(22);
  private turnRate = new Float32Array(22);
  /** Interpolated frame the renderer last drew (read by camera, HUD). */
  readonly frame: Float32Array;

  constructor(teams: [TeamDef, TeamDef], kits: [Kit, Kit], humanSide: number) {
    for (let s = 0; s < 2; s++) {
      teams[s].players.forEach((def, i) => {
        const f = new Footballer(def, kits[s], i === 0);
        this.players.push(f);
        this.group.add(f.group);
      });
    }
    this.frame = new Float32Array(BALL_OFS + 10);
    this.ball = new THREE.Mesh(buildBallGeometry(BALL_R * 1.25), voxelMaterial);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    // A soft blob keeps the ball readable when high in the air.
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1e3312, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.position.y = 0.02;
    this.ballShadow = blob;
    this.group.add(blob);

    // Control marker: a chunky square ring + bobbing arrow in the human's colour.
    const markColor = humanSide >= 0 ? 0xffd23a : 0xffffff;
    this.marker = new THREE.Group();
    const rb = new BoxBuilder();
    const r = 0.62, t = 0.12;
    rb.box(0, 0, -r, r * 2 + t, 0.03, t, markColor);
    rb.box(0, 0, r, r * 2 + t, 0.03, t, markColor);
    rb.box(-r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r + 0.28, 0, 0, 0.3, 0.03, 0.26, markColor);
    this.markerRing = new THREE.Mesh(rb.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.markerRing.position.y = 0.04;
    this.marker.add(this.markerRing);
    const ab = new BoxBuilder();
    ab.box(0, 0.36, 0, 0.44, 0.12, 0.44, markColor);
    ab.box(0, 0.24, 0, 0.3, 0.12, 0.3, markColor);
    ab.box(0, 0.12, 0, 0.16, 0.12, 0.16, markColor);
    this.arrow = new THREE.Mesh(ab.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.marker.add(this.arrow);
    this.group.add(this.marker);
    this.marker.visible = humanSide >= 0;

    this.powerBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0x26262e }));
    this.powerFill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.18), new THREE.MeshBasicMaterial({ color: 0x3aff9e }));
    this.powerFill.geometry.translate(0.55, 0, 0);
    this.powerFill.position.x = -0.55;
    this.powerBar.add(bg, this.powerFill);
    this.powerBar.visible = false;
    this.group.add(this.powerBar);
  }

  /** Blend frames a→b and pose everything. */
  apply(a: Float32Array, b: Float32Array, alpha: number, time: number, dt: number): void {
    const f = this.frame;
    for (let i = 0; i < a.length; i++) f[i] = a[i];
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      // Only blend continuous channels; discrete ones take the newer frame.
      f[o] = lerp(a[o], b[o], alpha);
      f[o + 1] = lerp(a[o + 1], b[o + 1], alpha);
      f[o + 2] = lerp(a[o + 2], b[o + 2], alpha);
      f[o + 3] = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * alpha;
      for (const k of [4, 9, 11, 13, 14]) f[o + k] = b[o + k];
      f[o + 5] = b[o + 4] === a[o + 4] ? lerp(a[o + 5], b[o + 5], alpha) : b[o + 5];
      const dp = b[o + 6] - a[o + 6];
      f[o + 6] = a[o + 6] + (dp < -0.5 ? dp + 1 : dp) * alpha;
      f[o + 7] = lerp(a[o + 7], b[o + 7], alpha);
      f[o + 8] = lerp(a[o + 8], b[o + 8], alpha);
      f[o + 10] = lerp(a[o + 10], b[o + 10], alpha);
      f[o + 12] = lerp(a[o + 12], b[o + 12], alpha);
    }
    for (let k = 0; k < 6; k++) f[BALL_OFS + k] = lerp(a[BALL_OFS + k], b[BALL_OFS + k], alpha);
    for (let k = 6; k < 10; k++) f[BALL_OFS + k] = b[BALL_OFS + k];

    const pose = this.pose;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const fb = this.players[i];
      fb.group.position.set(f[o], 0, f[o + 1]);
      fb.group.rotation.y = -f[o + 3];
      pose.y = f[o + 2];
      pose.state = f[o + 4];
      pose.stateT = f[o + 5];
      pose.runPhase = f[o + 6];
      pose.speed = f[o + 7];
      pose.kickT = f[o + 8];
      pose.kickLeg = f[o + 9];
      pose.lean = f[o + 10];
      pose.diveDir = f[o + 11];
      pose.headerT = f[o + 12];
      pose.celebrate = f[o + 13];
      pose.hasBall = f[o + 14] > 0.5;
      pose.keeper = i === 0 || i === 11;
      const bearing = Math.atan2(f[BALL_OFS + 2] - f[o + 1], f[BALL_OFS] - f[o]);
      // Model left is -z; our facing angle grows towards +z, so negate for "left positive".
      pose.look = -wrapAngle(bearing - f[o + 3]);
      if (dt > 0) {
        const dF = wrapAngle(f[o + 3] - this.lastFacing[i]) / dt;
        this.turnRate[i] += (Math.max(-12, Math.min(12, -dF)) - this.turnRate[i]) * Math.min(1, dt * 8);
      }
      this.lastFacing[i] = f[o + 3];
      pose.turn = this.turnRate[i];
      fb.pose(pose, time + i * 0.37);
    }

    // Ball: position plus rolling rotation integrated from its velocity.
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const vx = f[BALL_OFS + 3], vy = f[BALL_OFS + 4], vz = f[BALL_OFS + 5];
    this.ball.position.set(bx, by, bz);
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05 && f[BALL_OFS + 6] < 0.5) {
      this.axis.set(vz, 0, -vx).normalize();
      this.tmpQ.setFromAxisAngle(this.axis, (sp / (BALL_R * 1.25)) * dt);
      this.ballQuat.premultiply(this.tmpQ);
      this.ball.quaternion.copy(this.ballQuat);
    }
    void vy;
    this.ballShadow.position.set(bx, 0.02, bz);
    const hs = Math.max(0.35, 1 - by * 0.12);
    this.ballShadow.scale.set(hs, hs, hs);
    this.ballShadow.visible = by > 0.5;

    // Marker on the human-controlled player.
    const active = f[BALL_OFS + 8];
    if (this.marker.visible !== false && active >= 0) {
      const o = active * PF;
      this.marker.position.set(f[o], 0, f[o + 1]);
      this.markerRing.rotation.y = -f[o + 3];
      this.arrow.position.y = 2.25 + f[o + 2] + Math.abs(Math.sin(time * 5)) * 0.18;
      this.marker.userData.active = active;
    }
  }

  setMarkerVisible(v: boolean): void {
    this.marker.visible = v;
  }

  setPower(p: number | null, x: number, z: number): void {
    if (p === null || p <= 0) {
      this.powerBar.visible = false;
      return;
    }
    this.powerBar.visible = true;
    this.powerBar.position.set(x, 2.75, z);
    this.powerFill.scale.x = Math.max(0.02, p);
    const m = this.powerFill.material as THREE.MeshBasicMaterial;
    m.color.setHex(p < 0.6 ? 0x3aff9e : p < 0.85 ? 0xffd23a : 0xff4a3a);
  }

  faceCamera(cam: THREE.Camera): void {
    this.powerBar.quaternion.copy(cam.quaternion);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
