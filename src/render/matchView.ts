import * as THREE from 'three';
import { lerp, wrapAngle } from '../core/math';
import { BALL_OFS, FRAME_LEN, PF } from '../game/replay';
import { BALL_R } from '../sim/constants';
import type { Kit, PlayerDef, TeamDef } from '../sim/types';
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
  private nameTag: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTex: THREE.CanvasTexture;
  private nameFor = -1;
  private targetRing: THREE.Mesh;
  private aim: THREE.Mesh;
  private names: string[] = [];
  private referee: Footballer;
  private ref = { x: -8, z: -10, vx: 0, vz: 0, facing: 0, phase: 0, signal: 0 };
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
    this.frame = new Float32Array(FRAME_LEN);
    const refKit: Kit = { shirt: 0x2a2a30, shirt2: 0xffd23a, pattern: 'plain', shorts: 0x2a2a30, socks: 0x2a2a30, gk: 0x2a2a30 };
    const refDef: PlayerDef = {
      id: 'ref', name: 'Referee', number: -1, role: 'MF',
      stats: { pace: 70, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 },
      look: { skin: 2, hair: 1, hairColor: 6, beard: 0, boots: 0x2a2a30 },
    };
    this.referee = new Footballer(refDef, refKit, false);
    this.group.add(this.referee.group);
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
    // Surname tag floating over the controlled player, broadcast style.
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 256;
    this.nameCanvas.height = 48;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, depthTest: false, transparent: true }));
    this.nameTag.scale.set(2.4, 0.45, 1);
    this.nameTag.renderOrder = 10;
    this.marker.add(this.nameTag);
    for (let s = 0; s < 2; s++) for (const p of teams[s].players) this.names.push(p.name.split('. ').pop()!.toUpperCase());
    this.group.add(this.marker);
    this.marker.visible = humanSide >= 0;

    // Ring on the intended receiver of a pass.
    const tb = new BoxBuilder();
    const tr = 0.55, tt = 0.08;
    tb.box(0, 0, -tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(0, 0, tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(-tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    tb.box(tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    this.targetRing = new THREE.Mesh(tb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.group.add(this.targetRing);

    // Set-piece aim: a dashed chunky arrow along the taker's facing.
    const ab2 = new BoxBuilder();
    for (let i = 0; i < 6; i++) ab2.box(1.0 + i * 0.9, 0, 0, 0.55, 0.02, 0.22, 0xffd23a);
    ab2.box(6.6, 0, 0, 0.3, 0.02, 0.9, 0xffd23a);
    ab2.box(6.9, 0, 0, 0.3, 0.02, 0.55, 0xffd23a);
    ab2.box(7.2, 0, 0, 0.3, 0.02, 0.22, 0xffd23a);
    this.aim = new THREE.Mesh(ab2.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.aim.position.y = 0.06;
    this.aim.visible = false;
    this.group.add(this.aim);

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
    for (let k = 6; k < 11; k++) f[BALL_OFS + k] = b[BALL_OFS + k];

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
      this.arrow.position.y = 2.45 + f[o + 2] + Math.abs(Math.sin(time * 5)) * 0.18;
      this.nameTag.position.y = 3.25 + f[o + 2];
      if (active !== this.nameFor) this.drawName(active);
    }
    const pt = f[BALL_OFS + 10];
    const human = active >= 0 ? (active < 11 ? 0 : 1) : -1;
    if (this.marker.visible && pt >= 0 && pt !== active && (pt < 11 ? 0 : 1) === human) {
      this.targetRing.visible = true;
      this.targetRing.position.x = f[pt * PF];
      this.targetRing.position.z = f[pt * PF + 1];
      const pulse = 1 + Math.sin(time * 10) * 0.08;
      this.targetRing.scale.set(pulse, 1, pulse);
    } else {
      this.targetRing.visible = false;
    }
  }

  /** The referee jogs a diagonal about 10 m from the ball and signals fouls. */
  updateReferee(dt: number, time: number, visible: boolean): void {
    const g = this.referee.group;
    g.visible = visible;
    if (!visible || dt <= 0) return;
    const f = this.frame;
    const bx = f[BALL_OFS];
    const bz = f[BALL_OFS + 2];
    const r = this.ref;
    const tx = Math.max(-44, Math.min(44, bx - 7));
    const tz = Math.max(-26, Math.min(26, bz > 0 ? bz - 11 : bz + 11));
    const dx = tx - r.x;
    const dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    const want = d < 1.2 ? 0 : Math.min(7, d * 1.2);
    const k = Math.min(1, dt * 3);
    r.vx += ((d > 0 ? (dx / d) * want : 0) - r.vx) * k;
    r.vz += ((d > 0 ? (dz / d) * want : 0) - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    const sp = Math.hypot(r.vx, r.vz);
    const faceTo = sp > 1.2 ? Math.atan2(r.vz, r.vx) : Math.atan2(bz - r.z, bx - r.x);
    r.facing += wrapAngle(faceTo - r.facing) * Math.min(1, dt * 6);
    r.phase = (r.phase + (sp * dt) / 2.1) % 1;
    r.signal = Math.max(0, r.signal - dt);
    g.position.set(r.x, 0, r.z);
    g.rotation.y = -r.facing;
    const pose = this.pose;
    pose.state = 0; pose.stateT = 0; pose.speed = sp; pose.runPhase = r.phase; pose.kickT = 0; pose.kickLeg = 1;
    pose.lean = Math.min(0.3, sp * 0.03); pose.diveDir = 0; pose.headerT = 0; pose.celebrate = 0; pose.y = 0;
    pose.keeper = false; pose.hasBall = false; pose.turn = 0;
    pose.look = -wrapAngle(Math.atan2(bz - r.z, bx - r.x) - r.facing);
    pose.signal = r.signal > 0;
    this.referee.pose(pose, time);
    pose.signal = false;
  }

  refSignal(seconds: number): void {
    this.ref.signal = seconds;
  }

  /** Swap the model for a substitute coming on. */
  replacePlayer(i: number, def: PlayerDef, kit: Kit): void {
    const old = this.players[i];
    const f = new Footballer(def, kit, i === 0 || i === 11);
    f.group.position.copy(old.group.position);
    f.group.rotation.copy(old.group.rotation);
    old.group.removeFromParent();
    this.players[i] = f;
    this.group.add(f.group);
    this.names[i] = def.name.split('. ').pop()!.toUpperCase();
    if (this.nameFor === i) this.nameFor = -1;
  }

  /** Show the set-piece aim arrow from (x, z) along `angle` (radians, world facing). */
  setAim(on: boolean, x = 0, z = 0, angle = 0, length = 1): void {
    this.aim.visible = on;
    if (!on) return;
    this.aim.position.x = x;
    this.aim.position.z = z;
    this.aim.rotation.y = -angle;
    this.aim.scale.x = length;
  }

  setMarkerVisible(v: boolean): void {
    this.marker.visible = v;
    if (!v) this.targetRing.visible = false;
  }

  private drawName(idx: number): void {
    this.nameFor = idx;
    const c = this.nameCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const name = this.names[idx] ?? '';
    g.font = '700 26px "Silkscreen", "Courier New", monospace';
    const w = Math.min(c.width - 8, g.measureText(name).width + 22);
    const x = (c.width - w) / 2;
    g.fillStyle = 'rgba(38,38,46,0.82)';
    g.fillRect(x, 6, w, 36);
    g.fillStyle = '#ffd23a';
    g.fillRect(x, 38, w, 4);
    g.fillStyle = '#fbfbf4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, c.width / 2, 25);
    this.nameTex.needsUpdate = true;
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
