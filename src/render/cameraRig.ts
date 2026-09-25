import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle } from '../core/math';
import { PF } from '../game/replay';
import { GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W } from '../sim/constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu' | 'intro' | 'penalty' | 'card';

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
  /** Celebrate: radius of a group to frame instead of one player (team-mates arriving, shootout pile-up). */
  group?: number;
  /** Celebrate: which way the group faces (radians, world facing), so the camera films faces not backs. */
  groupFacing?: number;
  /** After one of our set pieces is struck: the ball is still live (or in the net), so the shot may stay on it. */
  hold?: boolean;
  /** Card close-up: where the referee stands and the spot he faces (the offender). */
  card?: { rx: number; rz: number; fx: number; fz: number } | null;
  /** Head height of a standing player (m) at the current draw scale. */
  tall?: number;
}

interface Shot {
  tx: number; ty: number; tz: number;
  px: number; py: number; pz: number;
  fov: number;
}

const PITCH_DEG = 27;
const FOV = 24;
const DEG = Math.PI / 180;
/** Steepest the broadcast lens tilts to keep the near stand out of the bottom of the frame. */
const NEAR_PITCH_MAX = 40;
/** Near stand, front-row heads (z, height; with a hop and a flag), the first thing the broadcast frame would clip at the bottom. */
const NEAR_STAND_Z = HALF_W + 5.9;
const NEAR_STAND_Y = 2.7;
/** Card close-up: preferred angle (degrees) of the lens off the referee-offender line, and the side (+1 / -1) of his card hand. */
const CARD_DEG = 70;
const CARD_HAND = 1;
/**
 * The over-the-shoulder shot stays on a struck free kick / penalty this long, then cuts back to the
 * broadcast shot (a cut, never an ease: easing 40 m back up to the gantry reads as a whip pan).
 */
const POST_HOLD = 1.4;
/** Near-touchline framing: the front-row heads of the near stand stay below this NDC height (bottom 8%). */
const NEAR_STAND_NDC = -0.84;
/** ...and the ball stays above this one (clear of the bottom HUD: minimap, player chip). */
const NEAR_BALL_NDC = -0.62;
/** Where the wanted shot moves further than this in one frame (players reset, a new set piece), cut. */
const CUT_JUMP = 8;
/** Top speed of the gliding cameras, m/s: faster than this reads as a whip pan. */
const MAX_GLIDE = 30;

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
  private softCutReq = false;
  private behind = false;
  private celebAz = Math.PI / 2;
  private celebWant = Math.PI / 2;
  private celebT = 0;
  private celebFresh = true;
  /** The shot wanted last frame (to spot jumps worth a cut). */
  private wantT = new THREE.Vector3();
  private wantP = new THREE.Vector3();
  private hasWant = false;
  /** Post-strike: seconds left of hold + ease, the behind shot being held, and where it is looking. */
  private post = 0;
  private postCheck = 0;
  private postShot: Shot | null = null;
  private postYaw = 0;
  private postLook = new THREE.Vector3();
  /** Card close-up: signed angle (rad) of the lens off the referee's facing (chosen once per booking). */
  private cardSide = 0;
  /** Touch layout (thumbstick bottom-left, buttons bottom-right): set pieces keep the taker in the left 60%. */
  touchLayout = false;
  /** 0..1 progress of the pre-match fly-in. */
  introT = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.fov = camera.fov;
  }

  setMode(m: CamMode): void {
    if (m !== this.mode) {
      this.mode = m;
      // Every change of camera is a cut, like TV: never fly from one shot to another.
      this.snap = true;
      this.post = 0;
      this.cardSide = 0;
      if (m === 'celebrate') {
        this.celebT = 0;
        this.celebFresh = true;
      }
    }
  }

  /** Cut to the current shot now. */
  cut(): void {
    this.snap = true;
    this.celebT = 0;
    this.celebFresh = true;
  }

  /** Cut only if the new framing is far from the current one (> 8 m); otherwise glide to it. */
  softCut(): void {
    this.softCutReq = true;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  get portrait(): boolean {
    return this.camera.aspect < 0.85;
  }

  /** True while the over-the-shoulder set-piece camera is on air (including the post-strike hold). */
  get behindActive(): boolean {
    return this.behind;
  }

  /** True while the struck set piece is being followed from over the taker's shoulder (the post-strike hold). */
  get holding(): boolean {
    return this.post > 0 && this.postShot !== null && this.behind;
  }

  /**
   * End the post-strike hold now (the ball has come back towards the taker, or someone other than the taker
   * or a keeper has touched it): the next frame cuts to the broadcast shot.
   */
  endHold(): void {
    if (this.post > 0) this.post = 0;
  }

  /** Metres of pitch the broadcast shot shows across the screen. */
  private broadcastWidth(): number {
    const a = this.camera.aspect;
    const w = a >= 1.6 ? 41 : a >= 1.25 ? 36 + (a - 1.25) * 14 : 35;
    // Small (phone landscape) screens keep a wide shot, ~42 m, and draw the players bigger instead
    // (characters.screenCharK) so the game still reads.
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    return h < 560 ? Math.max(w, 42) : w;
  }

  /** The main broadcast framing (landscape gantry or portrait end-on). Updates the look-ahead: once a frame. */
  private broadcastShot(f: CamFocus, dt: number): { shot: Shot; rate: number } {
    const cam = this.camera;
    const sp = Math.hypot(f.bvx, f.bvz);
    this.lead.x = damp(this.lead.x, f.bvx * 0.35, 1.4, dt);
    this.lead.y = damp(this.lead.y, f.bvz * 0.2, 1.4, dt);
    let tx: number, tz: number, px: number, py: number, pz: number, fov: number;
    if (this.portrait) {
      const ad = f.attack;
      tx = clamp(f.bx * 0.85 + f.ax * 0.15 + this.lead.x + ad * 5, -HALF_L + 8, HALF_L - 8);
      tz = clamp(f.bz * 0.8 + this.lead.y, -HALF_W + 9, HALF_W - 9);
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
      const edge = HALF_L - 0.3 * W;
      tx = clamp(fx, -edge, edge);
      // Touch screens: the buttons own the bottom-right, so a set-piece taker is kept in the left 60% of the
      // frame (even if that shows a little of the end stand beyond the corner flag).
      if (piece && this.touchLayout) tx = Math.max(tx, Math.min(piece.x - 0.06 * W, HALF_L + 2));
      tz = clamp(fz, -(HALF_W - 12), HALF_W - 10);
      // Distance so W metres span the screen with a long, near-orthographic lens.
      const zoom = 1 + clamp(f.by * 0.015 + sp * 0.003, 0, 0.1);
      const d = (W / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * cam.aspect)) * zoom;
      const hf = THREE.MathUtils.degToRad(FOV / 2);
      // Play by the near touchline: the lens rises (a steeper look down, target and distance kept) until the
      // near stand's front-row heads drop out of the bottom band (<= 8% of the height), and only if even the
      // steepest angle can't manage that does the look target come back up the pitch; either way the ball
      // itself stays clear of the bottom HUD.
      const bz = piece ? Math.max(piece.z, f.bz) : f.bz;
      const ndcAt = (tzz: number, a: number, z: number, y: number) => {
        const cz = tzz + d * Math.cos(a);
        const cy = d * Math.sin(a);
        return -Math.tan(Math.atan2(cy - y, cz - z) - a) / Math.tan(hf);
      };
      const standOk = (tzz: number, a: number) => ndcAt(tzz, a, NEAR_STAND_Z, NEAR_STAND_Y) <= NEAR_STAND_NDC;
      const ballOk = (tzz: number, a: number) => ndcAt(tzz, a, bz, 0) >= NEAR_BALL_NDC;
      const a0 = PITCH_DEG * DEG;
      const aMax = NEAR_PITCH_MAX * DEG;
      let a = a0;
      if (!standOk(tz, a0)) {
        if (standOk(tz, aMax)) {
          // Smallest pitch that clears the stand (bisection keeps it continuous as the ball moves).
          let lo = a0;
          let hi = aMax;
          for (let i = 0; i < 14; i++) {
            const mid = (lo + hi) / 2;
            if (standOk(tz, mid)) hi = mid;
            else lo = mid;
          }
          a = hi;
        } else {
          a = aMax;
          // Pull the target back up the pitch (never so far that the ball drops under the HUD).
          let lo = tz - 14;
          let hi = tz;
          for (let i = 0; i < 14; i++) {
            const mid = (lo + hi) / 2;
            if (standOk(mid, a)) lo = mid;
            else hi = mid;
          }
          tz = lo;
        }
        // The ball wins over the stand: ease the target back towards it until it clears the HUD.
        if (!ballOk(tz, a)) {
          let lo = tz;
          let hi = tz + 10;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (ballOk(mid, a)) hi = mid;
            else lo = mid;
          }
          tz = hi;
        }
      }
      px = tx;
      py = d * Math.sin(a);
      pz = tz + d * Math.cos(a);
      fov = FOV;
    }
    const rate = f.setPiece ? 2.4 : 3.2 + Math.min(sp, 25) * 0.08;
    return { shot: { tx, ty: 0, tz, px, py, pz, fov }, rate };
  }

  /**
   * Post-strike hold: the lens stays where the over-the-shoulder camera stood and pans after the ball
   * (rate 3), never dipping below the original look and tilting up for a ball that climbs. It cranes
   * gently up and back meanwhile, so the players running past it on their way into the box stay low in
   * the frame instead of filling it.
   */
  private holdShot(f: CamFocus, dt: number): Shot {
    const h0 = this.postShot!;
    const base = Math.atan2(h0.tz - h0.pz, h0.tx - h0.px);
    const k = clamp(POST_HOLD - this.post, 0, POST_HOLD);
    const h = {
      ...h0,
      px: h0.px - Math.cos(base) * k * 0.9,
      pz: h0.pz - Math.sin(base) * k * 0.9,
      py: h0.py + k * 1.4,
    };
    const D0 = Math.max(4, Math.hypot(h.tx - h.px, h.tz - h.pz));
    const dxb = f.bx - h.px;
    const dzb = f.bz - h.pz;
    const hd = Math.hypot(dxb, dzb);
    // Pan with the ball, but never swing round more than ~50 degrees (a clearance back over our heads).
    const ang = hd > 3 ? base + clamp(wrapAngle(Math.atan2(dzb, dxb) - base), -0.9, 0.9) : base;
    const el0 = Math.atan2(h.ty - h.py, D0);
    const elB = hd > 3 ? Math.atan2(f.by + 0.6 - h.py, hd) : el0;
    const el = Math.max(el0, Math.min(elB, 0.35));
    const lx = h.px + Math.cos(ang) * D0;
    const lz = h.pz + Math.sin(ang) * D0;
    const ly = h.py + Math.tan(el) * D0;
    this.postLook.x = damp(this.postLook.x, lx, 3, dt);
    this.postLook.y = damp(this.postLook.y, ly, 3, dt);
    this.postLook.z = damp(this.postLook.z, lz, 3, dt);
    return { tx: this.postLook.x, ty: this.postLook.y, tz: this.postLook.z, px: h.px, py: h.py, pz: h.pz, fov: h.fov };
  }

  update(dt: number, f: CamFocus, time: number): void {
    const cam = this.camera;
    let tx: number, ty: number, tz: number;
    let px: number, py: number, pz: number;
    let fov = this.fov;
    let rate = 4;
    let behind = false;
    /** Gliding cameras: speed-limited, and cut (not flown) when the wanted shot jumps. */
    let glide = false;
    /** A designed move (the intro fly-in, the post-strike hold): follow it exactly, no speed limit, no jump cuts. */
    let scripted = false;
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
        // Sweep in from high over the halfway line and land exactly on the broadcast shot of the kick-off.
        const k = this.introT;
        const e = k * k * (3 - 2 * k);
        const a = -1.1 + e * 1.1;
        const r = 72 - e * 16;
        const b = this.broadcastShot(f, dt).shot;
        const w = smoothstep(0.55, 1, k);
        tx = lerp(0, b.tx, w); ty = lerp(0, b.ty, w); tz = lerp(0, b.tz, w);
        px = lerp(Math.sin(a) * r, b.px, w);
        pz = lerp(Math.cos(a) * r, b.pz, w);
        py = lerp(40 - e * 6, b.py, w);
        fov = lerp(34 - e * 10, b.fov, w);
        rate = 60;
        scripted = true;
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
        const tall = (f.tall ?? 1.9) + 0.25;
        const feet = this.portrait ? -0.45 : -0.9;
        const head = this.portrait ? 0.1 : -0.3;
        let dist = (tall - feet * g * tanH) / ((head - feet) * tanH);
        dist = Math.max(dist, (3.2 + g) / (tanH * cam.aspect));
        const aimY = -feet * (dist - g) * tanH;
        // A scorer sprinting away (to the corner flag) is filmed from ahead, running at the lens.
        const rvx = f.avx ?? 0;
        const rvz = f.avz ?? 0;
        const heading = Math.hypot(rvx, rvz) > 2.5 ? Math.atan2(rvz, rvx) : undefined;
        this.celebT -= dt;
        if (this.celebT <= 0) {
          const want = this.pickCelebrateAngle(sx, sz, dist, f.subject ?? -1, g, this.celebFresh, f.groupFacing, heading);
          // A big change of side is a cut to the reverse angle, never a whip round him.
          if (!this.celebFresh && Math.abs(wrapAngle(want - this.celebAz)) > 1.8) {
            this.celebAz = want;
            this.snap = true;
          }
          this.celebWant = want;
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
        glide = true;
        break;
      }
      case 'card': {
        const c = f.card;
        if (!c) {
          const b = this.broadcastShot(f, dt);
          ({ tx, ty, tz, px, py, pz, fov } = b.shot);
          rate = b.rate;
          glide = true;
          break;
        }
        // Referee close-up: the lens orbits the midpoint between the referee and the offender he faces, ~70
        // degrees off the line between them, so both stand side by side in a tight frame: the raised card, his
        // face and the player it is shown to.
        let dx = c.fx - c.rx;
        let dz = c.fz - c.rz;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const mx = (c.rx + c.fx) / 2;
        const mz = (c.rz + c.fz) / 2;
        const D = 6.6;
        const at = (sg: number) => {
          const off = Math.abs(sg);
          const ux = dx * Math.cos(off) - dz * Math.sign(sg) * Math.sin(off);
          const uz = dz * Math.cos(off) + dx * Math.sign(sg) * Math.sin(off);
          return { x: mx + ux * D, z: mz + uz * D };
        };
        if (this.cardSide === 0) {
          // 55-90 degrees off the line, either side: clear of the stands and of anyone standing between the
          // lens and the pair, then the referee's card-hand side, then the side nearer the main stand.
          let best = CARD_DEG * DEG;
          let bestScore = Infinity;
          for (const deg of [CARD_DEG, 62, 80, 55, 90]) {
            for (const sgn of [1, -1]) {
              const sg = sgn * deg * DEG;
              const q = at(sg);
              let score = (Math.max(0, Math.abs(q.x) - (HALF_L + 3)) + Math.max(0, Math.abs(q.z) - (HALF_W + 2.2))) * 10;
              score += this.sightBlock(q.x, q.z, mx, mz, -1) * 3;
              score += Math.abs(deg - CARD_DEG) * 0.02 - q.z * 0.03 + (sgn !== CARD_HAND ? 1.2 : 0);
              if (score < bestScore) {
                bestScore = score;
                best = sg;
              }
            }
          }
          this.cardSide = best;
        }
        const q = at(this.cardSide);
        px = clamp(q.x, -(HALF_L + 3), HALF_L + 3);
        pz = clamp(q.z, -(HALF_W + 2.2), HALF_W + 2.2);
        const tall = f.tall ?? 1.9;
        py = tall * 1.0;
        // Framed on the midpoint between the referee (raised card) and the offender he faces.
        tx = mx;
        tz = mz;
        ty = tall * 0.78;
        fov = 30;
        rate = 6;
        glide = true;
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
        const piece = f.setPiece;
        if (piece?.behind && !this.portrait) {
          const b = this.behindShot(piece);
          ({ tx, ty, tz, px, py, pz, fov } = b);
          rate = 3;
          behind = true;
          // Controls follow the lens: stick-up aims along the camera, left / right as seen on screen.
          this.yaw = Math.atan2(b.tx - b.px, -(b.tz - b.pz));
          this.post = POST_HOLD;
          this.postCheck = 0.2;
          this.postShot = b;
          this.postYaw = this.yaw;
          this.postLook.set(b.tx, b.ty, b.tz);
          break;
        }
        const bc = this.broadcastShot(f, dt);
        ({ tx, ty, tz, px, py, pz, fov } = bc.shot);
        rate = bc.rate;
        glide = true;
        if (this.post > 0 && this.postShot) {
          // The kick is away. A real strike (a shot, a whipped cross) keeps the over-the-shoulder shot on
          // it for POST_HOLD, then cuts back to the broadcast shot; a short pass, the ball going out, a new
          // stoppage or the session ending the hold (endHold: a rebound, a touch by anyone but the taker or a
          // keeper) cuts straight back.
          if (!f.hold || f.setPiece) this.post = 0;
          else if (this.postCheck > 0) {
            if (Math.hypot(f.bvx, f.bvz) > 11) this.postCheck = 0;
            else {
              this.postCheck -= dt;
              if (this.postCheck <= 0) this.post = 0;
            }
          }
        }
        if (this.post > 0 && this.postShot) {
          ({ tx, ty, tz, px, py, pz, fov } = this.holdShot(f, dt));
          this.yaw = this.postYaw;
          behind = true;
          rate = 14;
          glide = false;
          scripted = true;
          // When it runs out, the next frame is the broadcast shot and `behind` flipping makes it a cut.
          this.post -= dt;
        }
      }
    }
    // The over-the-shoulder set-piece camera is a different camera: cut to it and back, never fly.
    if (behind !== this.behind) {
      this.behind = behind;
      this.snap = true;
    }
    // Low cameras (goal line, celebrations, card close-ups) step around anyone standing where the lens would be.
    if ((this.mode === 'replay' && this.replayShot === 'goal') || this.mode === 'celebrate' || this.mode === 'card') {
      const o = this.clearOfPlayers(px, pz, f.subject ?? -1);
      px = o.x;
      pz = o.z;
    }
    // Cuts: asked for (only when the new framing is far away), or the wanted shot jumped (players reset
    // for a kick-off or a set piece, a new stoppage framing): a cut, never a 50 m whip pan.
    if (this.softCutReq) {
      this.softCutReq = false;
      if (Math.hypot(px - this.pos.x, pz - this.pos.z) > CUT_JUMP || Math.hypot(tx - this.target.x, tz - this.target.z) > CUT_JUMP) this.snap = true;
    }
    if ((glide || this.mode === 'replay') && this.hasWant && (Math.hypot(tx - this.wantT.x, tz - this.wantT.z) > CUT_JUMP || Math.hypot(px - this.wantP.x, py - this.wantP.y, pz - this.wantP.z) > CUT_JUMP)) {
      this.snap = true;
    }
    this.wantT.set(tx, ty, tz);
    this.wantP.set(px, py, pz);
    this.hasWant = true;
    if (this.snap || (scripted && rate >= 60)) {
      this.target.set(tx, ty, tz);
      this.pos.set(px, py, pz);
      this.fov = fov;
      this.snap = false;
    } else {
      const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
      const qx = this.target.x, qy = this.target.y, qz = this.target.z;
      this.target.x = damp(this.target.x, tx, rate, dt);
      this.target.y = damp(this.target.y, ty, rate, dt);
      this.target.z = damp(this.target.z, tz, rate, dt);
      this.pos.x = damp(this.pos.x, px, rate, dt);
      this.pos.y = damp(this.pos.y, py, rate, dt);
      this.pos.z = damp(this.pos.z, pz, rate, dt);
      if (glide && dt > 0) {
        // Never faster than MAX_GLIDE: a long ball is followed, not whipped after.
        const lim = MAX_GLIDE * dt;
        const cap = (v: THREE.Vector3, x: number, y: number, z: number) => {
          const d = Math.hypot(v.x - x, v.y - y, v.z - z);
          if (d > lim) {
            const k = lim / d;
            v.set(x + (v.x - x) * k, y + (v.y - y) * k, z + (v.z - z) * k);
          }
        };
        cap(this.pos, ox, oy, oz);
        cap(this.target, qx, qy, qz);
      }
      // Lens changes ease with the move, so a zoom never jumps ahead of the dolly.
      this.fov = damp(this.fov, fov, rate, dt);
    }
    cam.fov = this.fov;
    cam.position.copy(this.pos);
    if (this.shake > 0.001 && dt > 0) {
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

  /**
   * How badly players block the sight line from a low lens at (cx, cz) to someone at (sx, sz): anyone near
   * the line counts, more the nearer the lens they stand (they would fill the frame), and anyone right
   * by the lens counts too.
   */
  private sightBlock(cx: number, cz: number, sx: number, sz: number, skip: number): number {
    const fr = this.players;
    if (!fr) return 0;
    const lx = sx - cx;
    const lz = sz - cz;
    const l2 = lx * lx + lz * lz || 1;
    let score = 0;
    for (let i = 0; i < 22; i++) {
      if (i === skip) continue;
      const qx = fr[i * PF];
      const qz = fr[i * PF + 1];
      const t = clamp(((qx - cx) * lx + (qz - cz) * lz) / l2, 0, 1);
      const d = Math.hypot(qx - (cx + lx * t), qz - (cz + lz * t));
      if (t > 0.02 && t < 0.9 && d < 1.0) score += 1.5 - t;
      const dc = Math.hypot(qx - cx, qz - cz);
      if (dc < 2.2) score += 2.2 - dc;
    }
    return score;
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
  private pickCelebrateAngle(
    sx: number, sz: number, dist: number, subject: number, group: number, first: boolean, facing?: number, heading?: number,
  ): number {
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
      if (heading !== undefined) score += Math.abs(wrapAngle(a - heading)) * 2.2;
      else if (face !== null) score += Math.abs(wrapAngle(a - face)) * 1.1;
      if (!first) score += Math.abs(wrapAngle(a - this.celebWant)) * (heading !== undefined ? 0.5 : 1.2);
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
