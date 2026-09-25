import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep, wrapAngle } from '../core/math';
import { PF } from '../game/replay';
import { GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W } from '../sim/constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu' | 'intro' | 'penalty';

export interface CamFocus {
  bx: number; by: number; bz: number;
  bvx: number; bvz: number;
  ax: number; az: number; // active / interesting player
  avx?: number; avz?: number;
  attack: number; // +1 / -1: the human's attacking direction (portrait framing)
  /** Attacking direction of the side in possession (0 = loose). */
  lean?: number;
  /** Set piece being taken: frame the taker and the target area together. */
  setPiece?: { x: number; z: number; tx: number; tz: number; behind?: boolean; goal?: boolean; pen?: boolean } | null;
  /** Celebrate: player index of the subject (never counted as blocking the shot). */
  subject?: number;
  /** Celebrate: radius of a group to frame instead of one player (shootout pile-up). */
  group?: number;
  /** Celebrate: which way the group faces (radians, world facing), so the camera films faces not backs. */
  groupFacing?: number;
}

const PITCH_DEG = 27;
const FOV = 24;
const DEG = Math.PI / 180;

export class CameraRig {
  mode: CamMode = 'menu';
  /** Ground-plane yaw of the camera: 0 means looking towards -z (broadcast). */
  yaw = 0;
  /** Replay shot: 'build' = the move, 'goal' = goal-line slow-mo. */
  replayShot: 'build' | 'goal' = 'build';
  replayAngle = 0;
  /** Which goal (+1 / -1) the replayed goal went into. */
  replayGoalSign = 1;
  /** Goal-line replay camera side (+1 / -1 z): away from where the ball crossed the line. */
  replaySide = -1;
  /** Shootout: which goal (+1 / -1) every kick is taken at. */
  penaltyGoal = 1;
  /** Latest rendered frame (MatchView.frame): lets the low cameras keep players out of the lens. */
  players: Float32Array | null = null;
  private target = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 60, 90);
  private fov = FOV;
  private lead = new THREE.Vector2();
  private orbit = 0;
  private shake = 0;
  private snap = true;
  private behind = false;
  private celebAz = Math.PI / 2;
  private celebWant = Math.PI / 2;
  private celebT = 0;
  private celebFresh = true;
  /** 0..1 progress of the pre-match fly-in. */
  introT = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.fov = camera.fov;
  }

  setMode(m: CamMode): void {
    if (m !== this.mode) {
      const prev = this.mode;
      this.mode = m;
      // Cut (don't glide) into and out of replays, like TV.
      this.snap = m === 'replay' || m === 'intro' || (m === 'broadcast' && prev === 'replay');
      if (m === 'celebrate') {
        this.celebT = 0;
        this.celebFresh = true;
      }
    }
  }

  cut(): void {
    this.snap = true;
    this.celebT = 0;
    this.celebFresh = true;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  get portrait(): boolean {
    return this.camera.aspect < 0.85;
  }

  /** True while the over-the-shoulder set-piece camera is on air. */
  get behindActive(): boolean {
    return this.behind;
  }

  /** Metres of pitch the broadcast shot shows across the screen. */
  private broadcastWidth(): number {
    const a = this.camera.aspect;
    const w = a >= 1.6 ? 41 : a >= 1.25 ? 36 + (a - 1.25) * 14 : 35;
    // Small phone screens get a tighter shot so the players stay readable.
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    return w * (h < 420 ? 0.78 : h < 560 ? 0.88 : 1);
  }

  update(dt: number, f: CamFocus, time: number): void {
    const cam = this.camera;
    let tx: number, ty: number, tz: number;
    let px: number, py: number, pz: number;
    let fov = this.fov;
    let rate = 4;
    let behind = false;
    switch (this.mode) {
      case 'menu': {
        this.orbit += dt * 0.045;
        const r = 70;
        tx = 0; ty = 0; tz = 0;
        px = Math.sin(this.orbit) * r;
        pz = Math.cos(this.orbit) * r;
        py = 52;
        fov = 36;
        rate = 1.5;
        break;
      }
      case 'intro': {
        // Sweep in from high over the halfway line to the broadcast gantry.
        const k = this.introT;
        const e = k * k * (3 - 2 * k);
        const a = -1.1 + e * 1.1;
        const r = 72 - e * 16;
        tx = 0; ty = 0; tz = 0;
        px = Math.sin(a) * r;
        pz = Math.cos(a) * r;
        py = 40 - e * 6;
        fov = 34 - e * 10;
        rate = 6;
        break;
      }
      case 'celebrate': {
        // Low, close and clear: the subject in the lower third, the crowd behind, nobody in the way.
        const g = f.group ?? 0;
        const sx = f.ax + (f.avx ?? 0) * 0.35;
        const sz = f.az + (f.avz ?? 0) * 0.35;
        fov = 34;
        const tanH = Math.tan((fov / 2) * DEG);
        // A level lens at the aim height: the subject's head on the lower-third line (ndc -0.3) and the
        // boots of whoever stands nearest (the front of a group) just above the bottom edge (ndc -0.9).
        // Portrait phones keep him in the middle band instead (the touch buttons own the bottom) and back
        // off until ~3 m either side of him fits the narrow frame.
        const tall = 2.15;
        const feet = this.portrait ? -0.45 : -0.9;
        const head = this.portrait ? 0.1 : -0.3;
        let dist = (tall - feet * g * tanH) / ((head - feet) * tanH);
        dist = Math.max(dist, (3.2 + g) / (tanH * cam.aspect));
        const aimY = -feet * (dist - g) * tanH;
        this.celebT -= dt;
        if (this.celebT <= 0) {
          this.celebWant = this.pickCelebrateAngle(sx, sz, dist, f.subject ?? -1, g, this.celebFresh, f.groupFacing);
          this.celebT = 0.5;
          if (this.celebFresh) this.celebAz = this.celebWant;
          this.celebFresh = false;
        }
        this.celebAz = dampAngle(this.celebAz, this.celebWant, 1.6, dt);
        this.orbit += dt * 0.35;
        const az = this.celebAz + Math.sin(this.orbit) * 0.12;
        px = sx + Math.cos(az) * dist;
        pz = sz + Math.sin(az) * dist;
        py = aimY;
        tx = sx; tz = sz;
        ty = aimY;
        rate = 5;
        break;
      }
      case 'replay': {
        tx = f.bx; ty = Math.min(f.by, 2.2) * 0.5 + 0.6; tz = f.bz;
        const gs = this.replayGoalSign;
        if (this.replayShot === 'goal') {
          // Low three-quarter angle from beside the six-yard box, across the goal mouth from where the ball
          // crossed the line: the finish is seen through the mouth (never through side netting or from inside
          // the net), and 5 m out from the line the ball in the back of the net is still framed.
          px = gs * (HALF_L - 5);
          pz = this.replaySide * (GOAL_W / 2 + 9);
          py = 2;
          ty = clamp(f.by, 0, 2.6) * 0.6 + 0.45;
          fov = 30;
          rate = 8;
        } else if (this.replayAngle % 2 === 0) {
          // Touchline tracking shot, a step behind the ball, kept out of the stand.
          px = f.bx - gs * 6;
          py = 6.2;
          pz = Math.min(f.bz + 20, HALF_W + 2.6);
          fov = 32;
          rate = 5;
        } else {
          // High reverse angle from the far side.
          px = f.bx - gs * 4;
          py = 16;
          pz = f.bz - 30;
          fov = 30;
          rate = 5;
        }
        break;
      }
      case 'penalty': {
        // Shootout: low behind the taker's shoulder, the whole goal mouth framed, easing after the ball.
        const g = this.penaltyGoal;
        this.yaw = g > 0 ? Math.PI / 2 : -Math.PI / 2;
        const spot = g * (HALF_L - 10);
        // High enough that the taker's head sits below the goal line, so the keeper is never hidden.
        tx = g * HALF_L; ty = 0.5; tz = clamp(f.bz * 0.3, -2, 2);
        px = spot - g * 9; py = 4; pz = g * 1.8 + clamp(f.bz * 0.15, -1, 1);
        // Keep ~13 m of goal line in shot whatever the screen shape (portrait phones need a wider lens).
        const half = Math.atan(6.5 / (19 * Math.max(0.3, cam.aspect)));
        fov = clamp(THREE.MathUtils.radToDeg(half * 2), 34, 74);
        rate = 5;
        break;
      }
      default: {
        const sp = Math.hypot(f.bvx, f.bvz);
        this.lead.x = damp(this.lead.x, f.bvx * 0.35, 1.4, dt);
        this.lead.y = damp(this.lead.y, f.bvz * 0.2, 1.4, dt);
        if (this.portrait) {
          const ad = f.attack;
          tx = clamp(f.bx * 0.85 + f.ax * 0.15 + this.lead.x + ad * 5, -HALF_L + 8, HALF_L - 8);
          tz = clamp(f.bz * 0.8 + this.lead.y, -HALF_W + 9, HALF_W - 9);
          ty = 0;
          this.yaw = ad > 0 ? Math.PI / 2 : -Math.PI / 2;
          px = tx - ad * 44;
          pz = tz;
          py = 34;
          fov = 38;
        } else {
          this.yaw = 0;
          const W = this.broadcastWidth();
          const small = typeof window !== 'undefined' && window.innerHeight < 420;
          let fx = f.bx * 0.82 + f.ax * 0.18 + this.lead.x;
          // Aim a little beyond the ball so the far boards and a few stand rows frame the top.
          let fz = small ? f.bz * 0.9 : f.bz * 0.6 - 5 + this.lead.y * 0.5;
          const lean = f.lean ?? 0;
          if (lean !== 0) fx += lean * 5 * smoothstep(12, 34, lean * f.bx);
          const piece = f.setPiece;
          if (piece) {
            // Taker and target together, but never let the taker leave the frame.
            fx = clamp((piece.x + piece.tx) / 2, piece.x - 0.3 * W, piece.x + 0.3 * W);
            fz = clamp((piece.z + piece.tz) / 2, piece.z - 0.22 * W, piece.z + 0.22 * W);
          }
          if (piece?.behind) {
            const s = this.behindShot(piece);
            tx = s.tx; ty = s.ty; tz = s.tz;
            px = s.px; py = s.py; pz = s.pz;
            fov = s.fov;
            rate = 3;
            behind = true;
            break;
          }
          const edge = HALF_L - 0.3 * W;
          tx = clamp(fx, -edge, edge);
          tz = clamp(fz, -(HALF_W - 12), HALF_W - 10);
          ty = 0;
          // Distance so W metres span the screen with a long, near-orthographic lens.
          const zoom = 1 + clamp(f.by * 0.015 + sp * 0.003, 0, 0.1);
          const d = (W / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * cam.aspect)) * zoom;
          const a = THREE.MathUtils.degToRad(PITCH_DEG);
          px = tx;
          py = d * Math.sin(a);
          pz = tz + d * Math.cos(a);
          fov = FOV;
        }
        rate = 3.2 + Math.min(sp, 25) * 0.08;
        if (f.setPiece) rate = 2.4;
      }
    }
    // The over-the-shoulder set-piece camera is a different camera: cut to it and back, never fly.
    if (behind !== this.behind) {
      this.behind = behind;
      this.snap = true;
    }
    // Low cameras (goal line, celebrations) step around anyone standing where the lens would be.
    if ((this.mode === 'replay' && this.replayShot === 'goal') || this.mode === 'celebrate') {
      const o = this.clearOfPlayers(px, pz, f.subject ?? -1);
      px = o.x;
      pz = o.z;
    }
    if (this.snap) {
      this.target.set(tx, ty, tz);
      this.pos.set(px, py, pz);
      this.fov = fov;
      this.snap = false;
    } else {
      this.target.x = damp(this.target.x, tx, rate, dt);
      this.target.y = damp(this.target.y, ty, rate, dt);
      this.target.z = damp(this.target.z, tz, rate, dt);
      this.pos.x = damp(this.pos.x, px, rate, dt);
      this.pos.y = damp(this.pos.y, py, rate, dt);
      this.pos.z = damp(this.pos.z, pz, rate, dt);
      // Lens changes ease with the move, so a zoom never jumps ahead of the dolly.
      this.fov = damp(this.fov, fov, rate, dt);
    }
    cam.fov = this.fov;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += Math.sin(time * 61) * this.shake;
      cam.position.y += Math.sin(time * 47 + 1) * this.shake;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
  }

  /** Over-the-shoulder set-piece camera: metres behind / above the ball and to the side of the taker. */
  readonly behindRig = { back: 9.5, up: 4.5, side: 0.7, penBack: 6.5, penUp: 4.8, cornerBack: 6.5, cornerUp: 4.8 };

  /**
   * Our dead ball near goal, filmed from behind the taker. Shots at goal: a longish lens from ~9.5 m back and
   * 4.5 m up, so the ball at his feet, the wall, the keeper and the whole goal mouth (over the wall) share
   * the frame, crossbar ~26% from the top; that is the biggest the goal can be with the ball still in shot
   * (~28% of the width from 23 m, capped at 45%). Penalties come in to 6.5 m back / 4.8 m up, inside the
   * box, so the players cleared to its edge are behind the lens (goal ~40%). Crosses: over the corner
   * taker's shoulder at the drop zone.
   */
  private behindShot(piece: NonNullable<CamFocus['setPiece']>): { tx: number; ty: number; tz: number; px: number; py: number; pz: number; fov: number } {
    const rig = this.behindRig;
    const back0 = piece.pen ? rig.penBack : piece.goal ? rig.back : rig.cornerBack;
    const up = piece.pen ? rig.penUp : piece.goal ? rig.up : rig.cornerUp;
    const dx = piece.tx - piece.x;
    const dz = piece.tz - piece.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl;
    const uz = dz / dl;
    // Step to the side nearer the middle of the pitch, so the taker stands just off the aim line.
    const ss = piece.z * ux - piece.x * uz > 0 ? -1 : 1;
    const side0 = piece.goal ? rig.side : 0;
    // Stay in front of the stands (corners put "behind the ball" over the front rows).
    const place = (b: number, sd: number) => ({
      x: clamp(piece.x - ux * b - uz * ss * sd, -(HALF_L + 4), HALF_L + 4),
      z: clamp(piece.z - uz * b + ux * ss * sd, -(HALF_W + 2.8), HALF_W + 2.8),
    });
    // Someone standing between the lens and the ball (a team-mate, a player lingering by the box): step
    // to one side of him, then come in a little, until the ball and taker are clear.
    let at = place(back0, side0);
    search: for (const b of [back0, back0 - 1.2, back0 - 2.2]) {
      for (const sd of [side0, side0 + 1.8, -side0 - 1.8]) {
        at = place(b, sd);
        if (!this.blocksBall(at.x, at.z, piece.x, piece.z)) break search;
      }
      at = place(back0, side0);
    }
    const px = at.x;
    const pz = at.z;
    const py = up;
    const D = Math.max(4, Math.hypot(piece.tx - px, piece.tz - pz));
    const vx = (piece.tx - px) / D;
    const vz = (piece.tz - pz) / D;
    if (!piece.goal) {
      // Crosses: look at the drop zone at head height with a medium lens.
      return { tx: piece.tx, ty: 1.2, tz: piece.tz, px, py, pz, fov: 34 };
    }
    const aspect = Math.max(0.5, this.camera.aspect);
    // Ball (ndc -0.92) up to the crossbar (ndc +0.48, clear of the set-piece hint along the top) must fit...
    const aBall = Math.atan2(py - 0.11, Math.max(1, Math.hypot(piece.x - px, piece.z - pz)));
    const aBar = Math.atan2(py - GOAL_H, D);
    const hvFit = (aBall - aBar) / 1.4;
    // ...and the goal mouth never takes more than 45% of the width.
    const hvCap = Math.atan(Math.tan(Math.atan(GOAL_W / 0.45 / 2 / D)) / aspect);
    const hv = clamp(Math.max(hvFit, hvCap), 10 * DEG, 20 * DEG);
    // Centre the span low (its middle at ndc -0.22); if it can't all fit, keep the crossbar at +0.48 and
    // let the bottom (ball) crop instead.
    let pitch = (aBall + aBar) / 2 - Math.atan(0.22 * Math.tan(hv));
    if (Math.tan(pitch - aBar) > 0.48 * Math.tan(hv)) pitch = aBar + Math.atan(0.48 * Math.tan(hv));
    return {
      tx: px + vx * D, ty: py - D * Math.tan(pitch), tz: pz + vz * D,
      px, py, pz, fov: (hv * 2) / DEG,
    };
  }

  /** Is a player (other than whoever is over the ball) standing on the sight line from (cx, cz) to the ball? */
  private blocksBall(cx: number, cz: number, bx: number, bz: number): boolean {
    const fr = this.players;
    if (!fr) return false;
    const lx = bx - cx;
    const lz = bz - cz;
    const l2 = lx * lx + lz * lz || 1;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const qx = fr[o];
      const qz = fr[o + 1];
      if (Math.hypot(qx - bx, qz - bz) < 1.3) continue;
      const t = ((qx - cx) * lx + (qz - cz) * lz) / l2;
      if (t < 0.05 || t > 0.95) continue;
      if (Math.hypot(qx - (cx + lx * t), qz - (cz + lz * t)) < 1.25) return true;
    }
    return false;
  }

  /** Best side to film a celebration from: clear line of sight, inside the boards, close to where we are. */
  private pickCelebrateAngle(sx: number, sz: number, dist: number, subject: number, group: number, first: boolean, facing?: number): number {
    const fr = this.players;
    let best = this.celebWant;
    let bestScore = Infinity;
    // Preferences: in front of the subject (faces, not backs), then from the pitch side looking out.
    const home = Math.atan2(-sz, -sx * 0.35);
    const face = facing ?? (fr && subject >= 0 ? fr[subject * PF + 3] : null);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const cx = sx + Math.cos(a) * dist;
      const cz = sz + Math.sin(a) * dist;
      let score = 0;
      // Never in a stand, a goal or behind the boards.
      const ox = Math.max(0, Math.abs(cx) - (HALF_L + 3.2));
      const oz = Math.max(0, Math.abs(cz) - (HALF_W + 2.4));
      score += (ox + oz) * 6;
      if (Math.abs(cx) > HALF_L - 1 && Math.abs(cz) < GOAL_W / 2 + 1.5) score += 20;
      // Nor peering through a goal frame and its netting.
      for (let k2 = 1; k2 < 10; k2++) {
        const t = k2 / 10;
        const qx = Math.abs(cx + (sx - cx) * t);
        const qz = Math.abs(cz + (sz - cz) * t);
        if (qx > HALF_L - 0.8 && qx < HALF_L + GOAL_DEPTH + 0.8 && qz < GOAL_W / 2 + 0.8) {
          score += 12;
          break;
        }
      }
      if (fr) {
        for (let i = 0; i < 22; i++) {
          if (i === subject) continue;
          const o = i * PF;
          const qx = fr[o];
          const qz = fr[o + 1];
          const ds = Math.hypot(qx - sx, qz - sz);
          // Team-mates piling on are part of the shot.
          if (ds < 1.3 + group) continue;
          // Distance from the camera→subject sight line.
          const lx = sx - cx, lz = sz - cz;
          const t = clamp(((qx - cx) * lx + (qz - cz) * lz) / (dist * dist), 0, 1);
          const d = Math.hypot(qx - (cx + lx * t), qz - (cz + lz * t));
          if (t > 0.02 && t < 0.97 && d < 1.1) score += 4 * (1.4 - t);
          // Anyone right by the lens would fill the frame.
          const dc = Math.hypot(qx - cx, qz - cz);
          if (dc < 2.2) score += 3 * (2.2 - dc);
        }
      }
      score += Math.abs(wrapAngle(a - home)) * 0.3;
      if (face !== null) score += Math.abs(wrapAngle(a - face)) * 1.1;
      if (!first) score += Math.abs(wrapAngle(a - this.celebWant)) * 1.2;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Push a low camera position out of any player's body. */
  private clearOfPlayers(x: number, z: number, skip: number): { x: number; z: number } {
    const fr = this.players;
    if (!fr) return { x, z };
    const R = 1.4;
    for (let i = 0; i < 22; i++) {
      if (i === skip) continue;
      const o = i * PF;
      const dx = x - fr[o];
      const dz = z - fr[o + 1];
      const d = Math.hypot(dx, dz);
      if (d < R) {
        const k = d > 1e-3 ? R / d : 0;
        x = fr[o] + (d > 1e-3 ? dx * k : R);
        z = fr[o + 1] + (d > 1e-3 ? dz * k : 0);
      }
    }
    return { x, z };
  }

  get focusX(): number {
    return this.target.x;
  }

  get focusZ(): number {
    return this.target.z;
  }

  /** Screen-stick to world-ground mapping for the current camera. */
  screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // yaw 0: forward (0,-1), right (1,0)
    const rx = -fz;
    const rz = fx;
    return { x: sx * rx + sy * fx, z: sx * rz + sy * fz };
  }
}
