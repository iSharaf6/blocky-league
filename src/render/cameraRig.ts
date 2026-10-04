import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle } from '../core/math';
import type { CamZoom } from '../core/save';
import { PF } from '../game/replay';
import { GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W, WALL_DIST } from '../sim/constants';
import { PUSH_IN, PUSH_LEAN_M, Shake } from './juice';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'menu' | 'intro' | 'penalty' | 'card' | 'scene';

/** A staged shot (CamMode 'scene'): where the lens is, what it looks at and its field of view (degrees). */
export interface SceneShot {
  px: number; py: number; pz: number;
  tx: number; ty: number; tz: number;
  fov: number;
}

export interface CamFocus {
  bx: number; by: number; bz: number;
  bvx: number; bvz: number;
  ax: number; az: number; // active / interesting player
  avx?: number; avz?: number;
  attack: number; // +1 / -1: the human's attacking direction (portrait framing)
  /** Attacking direction of the side in possession (0 = loose). */
  lean?: number;
  /**
   * Set piece being taken: frame the taker and the target area together. `taker`: his player index (the
   * over-the-shoulder lens steps to the other side of the aim line from him); `corner`: a corner kick; `ours`:
   * the human's side is taking it.
   */
  setPiece?: {
    x: number; z: number; tx: number; tz: number; behind?: boolean; goal?: boolean; pen?: boolean; taker?: number; corner?: boolean; ours?: boolean;
    /**
     * Free kicks / penalties: the taker's run-up foot (Match.runUpFoot: +1 right, -1 left). He waits on the
     * other side of the aim line from it, so the over-the-shoulder lens takes this side from the first frame.
     */
    foot?: number;
  } | null;
  /** Celebrate: player index of the subject (never counted as blocking the shot). */
  subject?: number;
  /** Celebrate: radius of a group to frame instead of one player (team-mates arriving, shootout pile-up). */
  group?: number;
  /** Celebrate: which way the group faces (radians, world facing), so the camera films faces not backs. */
  groupFacing?: number;
  /**
   * Celebrate: a scripted move's own lens angle (radians, the azimuth from the subject to the lens), taken
   * exactly: no re-pick for sight lines, no orbit (the backflip side-on, the shush's close-up).
   */
  lockAngle?: number;
  /** Celebrate: a head-and-shoulders close-up (the lens at his eye line, the face above centre, waist up). */
  close?: boolean;
  /**
   * Celebrate: your own scorer filmed full length and big (boots to hair filling over half the frame's height), so
   * his kit, boots and hair are seen, where the usual shot keeps him to the lower third for the mob.
   */
  tight?: boolean;
  /** CamMode 'scene': the staged shot, taken exactly (game/showcase.ts: a substitution, the line-up, the man of the match). */
  scene?: SceneShot | null;
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
/**
 * Card close-up: preferred angle (degrees) of the lens off the referee->offender line (past 90: on the
 * referee's side, so the offender's face is in shot, not the back of his head), the side (+1 / -1) of the
 * referee's card hand, and the lens distance (m) from the pair's midpoint and its height.
 */
const CARD_DEG = 115;
const CARD_HAND = 1;
const CARD_D = 6.4;
const CARD_Y = 1.5;
/**
 * Portrait (phones held upright): the end-on lens's distance behind / above its target, its half-angle of
 * view at the 'wide' setting (26 degrees: ~25 m of the pitch's width across the screen at the ball, where 19
 * showed only ~14 m and fewer than half the players), and its steepest tilt: never so steep that the bottom
 * of the frame looks back past straight down (at most PORTRAIT_TILT_MAX).
 */
const PORTRAIT_BACK = 44;
const PORTRAIT_UP = 34;
const PORTRAIT_HALF_FOV = 26;
const PORTRAIT_TILT_MAX = 70;
/** Corners: how far (m) the set-piece framing is pulled from the taker / box midpoint towards the goal. */
const CORNER_PULL = 6;
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
/**
 * Broadcast camera distance (Settings): relative to 47 m of pitch across a 16:9 screen at the focus.
 * The normal shot shows the nearby passing options, wide pulls back further, and close favours player detail.
 * Portrait (the end-on lens) widens / narrows its field of view by the matching PORTRAIT_ZOOM factor instead.
 */
const ZOOM_K: Record<CamZoom, number> = { wide: 0.85, normal: 1, close: 1.3, cinematic: 1.08 };
const PORTRAIT_ZOOM: Record<CamZoom, number> = { wide: 1.12, normal: 1, close: 0.88, cinematic: 0.94 };
/**
 * CINEMATIC (Settings, or the HUD's camera button): the TV match camera of FIFA / DLS in open play. A lower lens
 * (CINE_PITCH_DEG against the gantry's PITCH_DEG) that sees the players more side-on, a touch closer than NORMAL
 * (ZOOM_K) and framed on the ball (half the controlled man's pull), on a softer follow (CINE_RATE of the usual
 * rate) so it glides with the play. As an attack gets into the final third the lens zooms in (a zoom, not a dolly:
 * the camera itself stays put), up to CINE_PUSH of the width (the ball CINE_DEEP_FROM m up the pitch and on over
 * CINE_DEEP_SPAN m, ~1.5 s each way at CINE_PUSH_W), and back out as the attack breaks down, so the passing options
 * stay in shot. Play towards the near touchline
 * lifts it back to the gantry's angle (between CINE_NEAR_FROM and CINE_NEAR_TO m of look target z), and the near
 * stand and bottom HUD rules hold as for every setting. Set pieces keep their own framing.
 */
const CINE_PITCH_DEG = 17;
const CINE_RATE = 0.75;
const CINE_PUSH = 0.1;
const CINE_PUSH_W = 1.4;
const CINE_DEEP_FROM = 14;
const CINE_DEEP_SPAN = 20;
const CINE_NEAR_FROM = -6;
const CINE_NEAR_TO = 14;
/**
 * Corners (always filmed at the wide width: the whole box has to fit): where the penalty spot sits on
 * screen, NDC y (+0.07 = 46.5% down from the top). Touch layouts lift the framing ~28% (the spot to ~33%
 * down, still under the score bug and set-piece hint) so the buttons along the bottom never cover the box.
 * A far-side corner keeps its taker in frame, which may lower the spot, but never below CORNER_PEN_NDC_LOW
 * (55% down).
 */
const CORNER_PEN_NDC = 0.07;
const CORNER_PEN_NDC_TOUCH = 0.34;
const CORNER_PEN_NDC_LOW = -0.1;
/** After a corner is struck: seconds the framing glides (speed-limited) rather than jump-cutting to the ball. */
const CORNER_EASE_S = 1.2;
/** Near-side corners: the taker's boots stay above this NDC height; the lens backs off up to this factor for it. */
const CORNER_TAKER_NDC = -0.8;
const CORNER_BACK_MAX = 2.4;
/**
 * A set piece taken: the framing eases from the set-piece shot into the open-play one (PIECE_OUT_W rad/s,
 * ~1 s) instead of stepping to it at the kick. A corner holds the box framing until the delivery arrives
 * (inside the box) or CORNER_HOLD_S has gone.
 */
const PIECE_OUT_W = 4.5;
const CORNER_HOLD_S = 1.6;
/** Goal-line replay: the lens never looks further out than this from the goal line (m). */
const REPLAY_LOOK_MAX = 12;
/** Post-strike hold: once the ball is past the wall the lens pushes in after it, this far at most (m), at this rate. */
const PUSH_MAX = 6;
const PUSH_RATE = 4;
/**
 * Broadcast framing inputs are eased (critically damped, so they start and stop gently) before they move the
 * shot. The possession lean: up to LEAN_M m towards the goal being attacked, eased in / out over ~1 s
 * (LEAN_W rad/s); a new side has to keep the ball LEAN_HOLD s before the lean swings to it, and a loose ball
 * or a pass in flight keeps the last side's.
 */
const LEAN_M = 5;
const LEAN_W = 4;
const LEAN_HOLD = 0.35;
/**
 * The controlled player's pull on the framing, and how gently it follows a switch of player (rad/s). What is
 * eased is where he stands relative to the ball (so a carrier dribbling it is never trailed: that offset
 * hardly changes); a switch, or a pass leaving him behind, moves it and that is what eases.
 */
const AX_K = 0.18;
const AX_W = 2.5;
/** Ball speed / height dolly-out and the follow rate it drives: eased at this rate (rad/s). */
const ZOOM_W = 2.5;
/** The final minutes (CameraRig.tension): the broadcast lens comes in by up to this share of its distance, at this ease rate. */
const TENSION_IN = 0.06;
const TENSION_W = 1.2;
/** The controlled player's feet kept clear of the bottom HUD too: that extra pull eases at this rate (rad/s). */
const FEET_W = 2;
/**
 * The broadcast lens follows its framing as a critically damped spring (FOLLOW_K x the damping rate), never
 * faster than MAX_GLIDE and never accelerating harder than MAX_ACC (m/s^2): a big re-frame (a corner struck)
 * is a smooth glide, not a whip. It is fed forward FOLLOW_FF of the framing's own velocity (from frame to
 * frame, through a critically damped low-pass at FOLLOW_VEL_W rad/s: a sustained run comes through, a
 * dribbler's weave mostly doesn't), so a moving ball is followed locked on rather than trailed:
 * the steady lag behind a sprint dribble or a long pass is (1 - FOLLOW_FF) of a plain spring's (round 8 trailed
 * a sprint dribble by ~2.3 m, 93 px at its 'normal'; the same 41 m shot now ~14 px), and a ball that stops
 * is overshot by < 0.15 m.
 */
const FOLLOW_K = 2;
const MAX_ACC = 110;
const FOLLOW_FF = 0.8;
const FOLLOW_VEL_W = 6;
/** Soft edges (m): the framing slows into its limits over this distance instead of stopping dead on them. */
const EDGE_KNEE = 3;
/** Big-chance push-in (see CameraRig.chance): eased in at CHANCE_IN rad/s, back out at CHANCE_OUT. */
const CHANCE_IN = 5;
const CHANCE_OUT = 2;
const NO_SKIP: readonly number[] = [];

/** Critically damped spring on one value (exact step: stable at any frame time). Unprimed: jumps to the target. */
class Ease {
  x = 0;
  v = 0;
  private primed = false;

  to(target: number, w: number, dt: number): number {
    if (!this.primed) return this.snap(target);
    if (dt <= 0) return this.x;
    const x0 = this.x - target;
    const e = Math.exp(-w * dt);
    const k = (this.v + w * x0) * dt;
    this.v = (this.v - w * k) * e;
    this.x = target + (x0 + k) * e;
    return this.x;
  }

  snap(target: number): number {
    this.x = target;
    this.v = 0;
    this.primed = true;
    return target;
  }

  /** The next to() jumps straight to its target (after a cut). */
  reset(): void {
    this.primed = false;
  }
}

/**
 * clamp() with soft ends (C1-continuous): identity until half a `knee` short of a limit, then easing to a stop
 * half a knee past it (at the limit itself it sits ~0.1 knee inside: the framing near the limit is kept).
 */
function softClamp(v: number, lo: number, hi: number, knee: number): number {
  const k = Math.max(1e-3, Math.min(knee, (hi - lo) / 2));
  const top = hi + k / 2;
  const bot = lo - k / 2;
  if (v > top - k) return top - k * Math.exp(-(v - (top - k)) / k);
  if (v < bot + k) return bot + k * Math.exp((v - (bot + k)) / k);
  return v;
}

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
  /** The small positional punch (kick): metres of lens offset, decaying. */
  private punch = 0;
  /**
   * Screen shake (render/juice.ts Shake): a pixel-space jolt of the whole picture, applied to the projection
   * after everything else (so it never feeds back into the framing, the follow spring or the tests' motion).
   */
  readonly shakeFx = new Shake();
  /** CSS px height of the view (the canvas), for the pixel shake. */
  viewH = 720;
  /**
   * Big chance (0..1, set by the session every frame): a shot on in and around the box. The broadcast lens
   * pushes in up to PUSH_IN of its distance and leans up to PUSH_LEAN_M towards `chanceGoal` (+1 / -1: the goal
   * at +x / -x), eased in fast and back out gently.
   */
  chance = 0;
  chanceGoal = 1;
  /**
   * The final minutes' tension (0..1, set every frame by game/funPresent.ts): the broadcast lens tightens by up to
   * TENSION_IN of its distance, eased in and out. At 0 the framing is exactly what it always was.
   */
  tension = 0;
  private tensionE = new Ease();
  private chanceE = new Ease();
  private chanceW = 0;
  /** The broadcast shot and its follow rate (reused every frame). */
  private bShot: Shot = { tx: 0, ty: 0, tz: 0, px: 0, py: 0, pz: 0, fov: FOV };
  private bRate = 3.2;
  private stw = { x: 0, z: 0 };
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
  /** Post-strike hold: the dead-ball spot, and how far (m) the lens has pushed in after the ball so far. */
  private postSpotX = 0;
  private postSpotZ = 0;
  private postPush = 0;
  /** Broadcast camera distance (Settings; see ZOOM_K). */
  private zoomSetting: CamZoom = 'normal';
  /** A corner was being framed last frame / seconds left of the post-corner glide (no jump cuts). */
  private wasCorner = false;
  private cornerEase = 0;
  /** Card close-up: signed angle (rad) of the lens off the referee's facing (chosen once per booking). */
  private cardSide = 0;
  /** Touch layout (thumbstick bottom-left, buttons bottom-right): set pieces keep the taker in the left 60%. */
  touchLayout = false;
  /** 0..1 progress of the pre-match fly-in. */
  introT = 0;
  /** The last update() cut to its shot (rather than gliding): whatever depends on the framing can snap too. */
  private cutNow = true;
  /** Broadcast lens velocity (look target, position), m/s: the spring follow's state. */
  private velT = new THREE.Vector3();
  private velP = new THREE.Vector3();
  /** The wanted shot's own velocity (look target, position), m/s: fed forward to the follow (FOLLOW_FF). */
  private wantVT = new THREE.Vector3();
  private wantVP = new THREE.Vector3();
  private wantAT = new THREE.Vector3();
  private wantAP = new THREE.Vector3();
  /** Eased broadcast inputs: the controlled player, the possession lean, the ball-speed dolly-out. */
  private axE = new Ease();
  private azE = new Ease();
  private leanE = new Ease();
  private zoomE = new Ease();
  private feetE = new Ease();
  /** CINEMATIC's attack push-in (0..1). */
  private cineE = new Ease();
  private spE = 0;
  private spPrimed = false;
  /** Attacking direction of the side the lean favours (+1 / -1, 0 = nobody yet), and a challenger's claim on it. */
  private leanSide = 0;
  private leanCand = 0;
  private leanCandT = 0;
  /**
   * The last set-piece broadcast shot (null: none to ease out of), how much of it is still in the framing
   * (1 while the set piece is on, easing to 0 once it is taken), a corner's hold on it (s) and its goal (x).
   */
  private pieceShot: Shot | null = null;
  private pieceE = new Ease();
  private pieceHold = 0;
  private pieceGoalX = 0;

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
      this.resetEasing();
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
    this.resetEasing();
  }

  /** After a cut the eased framing inputs start where they want to be (no ease-in from the old shot). */
  private resetEasing(): void {
    this.chanceE.reset();
    this.axE.reset();
    this.azE.reset();
    this.leanE.reset();
    this.zoomE.reset();
    this.tensionE.reset();
    this.feetE.reset();
    this.cineE.reset();
    this.spPrimed = false;
    this.pieceShot = null;
    this.pieceHold = 0;
  }

  /**
   * Set piece -> open play without a lurch: while a set piece is on, its broadcast shot is remembered; once
   * it is taken the framing eases out of it (a corner first holds it until the delivery arrives in the box).
   */
  private easeFromPiece(shot: Shot, f: CamFocus, dt: number): void {
    const piece = f.setPiece;
    if (piece) {
      const s = (this.pieceShot ??= { ...shot });
      Object.assign(s, shot);
      this.pieceE.snap(1);
      this.pieceHold = piece.corner ? CORNER_HOLD_S : 0;
      this.pieceGoalX = Math.sign(piece.x || 1) * HALF_L;
      return;
    }
    const p = this.pieceShot;
    if (!p) return;
    // A delivery has arrived once it is in the box; a corner played short (still low and slow after 0.3 s)
    // lets go at once, so the pass along the byline is followed.
    const arrived = Math.abs(f.bx - this.pieceGoalX) < 17 && Math.abs(f.bz) < 19;
    const short = CORNER_HOLD_S - this.pieceHold > 0.3 && f.by < 0.5 && Math.hypot(f.bvx, f.bvz) < 15;
    let w = 1;
    if (this.pieceHold > 0 && !arrived && !short) this.pieceHold -= dt;
    else {
      this.pieceHold = 0;
      w = this.pieceE.to(0, PIECE_OUT_W, dt);
    }
    if (w < 0.002) {
      this.pieceShot = null;
      return;
    }
    shot.tx = lerp(shot.tx, p.tx, w);
    shot.ty = lerp(shot.ty, p.ty, w);
    shot.tz = lerp(shot.tz, p.tz, w);
    shot.px = lerp(shot.px, p.px, w);
    shot.py = lerp(shot.py, p.py, w);
    shot.pz = lerp(shot.pz, p.pz, w);
    shot.fov = lerp(shot.fov, p.fov, w);
  }

  /** Cut only if the new framing is far from the current one (> 8 m); otherwise glide to it. */
  softCut(): void {
    this.softCutReq = true;
  }

  /** A small positional punch of the lens (m); nothing under reduced motion. */
  kick(amount: number): void {
    if (!this.shakeFx.enabled) return;
    this.punch = Math.max(this.punch, amount);
  }

  /** Screen shake: a decaying jolt of `px` CSS pixels (render/juice.ts; at most SHAKE_MAX_PX, none under reduced motion). */
  shakePx(px: number): void {
    this.shakeFx.add(px);
  }

  /** Reduced motion: no shake, no punch, no push-in on a big chance. */
  setReducedMotion(on: boolean): void {
    this.shakeFx.enabled = !on;
    if (on) {
      this.shakeFx.amp = 0;
      this.punch = 0;
    }
  }

  /** The eased big-chance weight (0..1) the framing is using right now. */
  get chanceWeight(): number {
    return this.chanceW;
  }

  get portrait(): boolean {
    return this.camera.aspect < 1.05;
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

  /** Broadcast camera distance (Settings). A change cuts straight to the new framing (never a slow zoom). */
  get zoom(): CamZoom {
    return this.zoomSetting;
  }

  setZoom(z: CamZoom): void {
    if (!(z in ZOOM_K) || z === this.zoomSetting) return;
    this.zoomSetting = z;
    if (this.mode === 'broadcast' && !this.behind) {
      this.snap = true;
      this.resetEasing();
    }
  }

  /**
   * Metres of pitch the broadcast shot shows across the screen at the 'wide' setting (41 m on a 16:9
   * screen). Small (phone landscape) screens keep a wider shot, ~42 m, and draw the players bigger instead
   * (characters.screenCharK) so the game still reads.
   */
  private wideWidth(): number {
    const a = this.camera.aspect;
    const w = a >= 1.6 ? 47 : a >= 1.25 ? 42 + (a - 1.25) * 14 : 40;
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    return h < 560 ? Math.max(w, 42) : w;
  }

  /** Metres of pitch the broadcast shot shows across the screen at the current camera distance. */
  private broadcastWidth(): number {
    return this.wideWidth() / ZOOM_K[this.zoomSetting];
  }

  /** The main broadcast framing (landscape gantry or portrait end-on). Updates the look-ahead: once a frame. */
  /**
   * The possession lean (m along x): towards the goal the side in possession attacks, past 12 m into that
   * half. Hysteresis: a loose ball or a pass in flight (lean 0) keeps the last side, and a new side has to
   * hold on to it for LEAN_HOLD before the lean swings over; the shift itself eases in and out (~1 s).
   */
  private leanShift(f: CamFocus, dt: number): number {
    const raw = Math.sign(f.lean ?? 0);
    if (raw !== 0 && raw !== this.leanSide) {
      if (raw !== this.leanCand) {
        this.leanCand = raw;
        this.leanCandT = 0;
      }
      this.leanCandT += dt;
      if (this.leanSide === 0 || this.leanCandT >= LEAN_HOLD) {
        this.leanSide = raw;
        this.leanCand = 0;
      }
    } else if (raw === this.leanSide) this.leanCand = 0;
    const s = this.leanSide;
    return this.leanE.to(s === 0 ? 0 : s * LEAN_M * smoothstep(12, 34, s * f.bx), LEAN_W, dt);
  }

  /**
   * NDC height of ground-plane point (z, y) for a lens `d` m from its look target (tzz), pitched down `a`, half
   * vertical field of view `hf`. A point behind the lens is never in shot (-Infinity: "below the frame"). (The
   * closer settings put the lens over the near stand; measuring that point as an angle wrapped it past 90
   * degrees into "top of the frame", and the pitch flipped between 27 and ~38 degrees from one frame to the next.)
   */
  private static ndcAt(tzz: number, a: number, z: number, y: number, d: number, hf: number): number {
    const dz = z - (tzz + d * Math.cos(a));
    const dy = y - d * Math.sin(a);
    const depth = -dz * Math.cos(a) - dy * Math.sin(a);
    if (depth < 0.5) return -Infinity;
    return (dy * Math.cos(a) - dz * Math.sin(a)) / (depth * Math.tan(hf));
  }

  /** The near stand's front-row heads are out of the bottom band. */
  private static standOk(tzz: number, a: number, d: number, hf: number): boolean {
    return CameraRig.ndcAt(tzz, a, NEAR_STAND_Z, NEAR_STAND_Y, d, hf) <= NEAR_STAND_NDC;
  }

  /**
   * Look target (z) that puts ground point (z, y) at NDC height `yN` on the standard pitch `a0` (a point nearer
   * the lens sits lower on screen, so this is monotonic in the target).
   */
  private static tzFor(z: number, y: number, yN: number, a0: number, d: number, hf: number): number {
    let lo = z - 60;
    let hi = z + 60;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (CameraRig.ndcAt(mid, a0, z, y, d, hf) < yN) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * The main broadcast framing (landscape gantry or portrait end-on), into this.bShot (and its follow rate into
   * this.bRate). Updates the look-ahead: once a frame.
   */
  private broadcastShot(f: CamFocus, dt: number): Shot {
    const cam = this.camera;
    // Every input that can jump (the ball struck, a switch of player, possession changing hands) is eased
    // before it moves the framing: the wanted shot itself never jumps in open play.
    const sp = Math.min(Math.hypot(f.bvx, f.bvz), 25);
    this.spE = this.spPrimed ? damp(this.spE, sp, ZOOM_W, dt) : sp;
    this.spPrimed = true;
    this.lead.x = damp(this.lead.x, f.bvx * 0.35, 1.4, dt);
    this.lead.y = damp(this.lead.y, f.bvz * 0.2, 1.4, dt);
    // (His offset from the ball is what eases: see AX_K.)
    const axo = this.axE.to(f.ax - f.bx, AX_W, dt);
    const azo = this.azE.to(f.az - f.bz, AX_W, dt);
    const ax = f.bx + axo;
    const lean = this.leanShift(f, dt);
    // A big chance (a shot on): a push in and a lean towards the goal (never on a set piece's framing).
    const c = f.setPiece ? 0 : this.chanceW;
    const goalX = this.chanceGoal * HALF_L;
    let tx: number, tz: number, px: number, py: number, pz: number, fov: number;
    if (this.portrait) {
      const ad = f.attack;
      const piece = f.setPiece;
      // The ball ~7 m short of the look target sits at ~-25% of the height, above the touch buttons.
      let fx = f.bx * 0.85 + ax * 0.15 + this.lead.x + ad * 5;
      let fz = f.bz * 0.8 + this.lead.y;
      let zLim = HALF_W - 9;
      if (piece?.corner) {
        // Corners (ours or theirs): the narrow frame can't hold the flag and the goal both, so it shows the
        // box, the goal near the middle, turned a touch towards the flag side the delivery flies in from.
        fx = piece.tx + ad * (piece.ours === false ? 4 : 3);
        fz = piece.z * 0.12;
      } else if (piece) {
        // Set pieces: framed on the taker the same way, and never with him out of the narrow frame (a
        // throw-in or a corner by the touchline included).
        fx = piece.x + ad * 7;
        fz = piece.z * 0.9 + piece.tz * 0.1;
        zLim = HALF_W - 2.5;
      }
      if (c > 0) fx += clamp(goalX - fx, -PUSH_LEAN_M, PUSH_LEAN_M) * c;
      tx = softClamp(fx, -HALF_L + 8, HALF_L - 8, EDGE_KNEE);
      tz = softClamp(fz, -zLim, zLim, EDGE_KNEE * (2 / 3));
      this.yaw = ad > 0 ? Math.PI / 2 : -Math.PI / 2;
      // End-on, PORTRAIT_BACK m back and PORTRAIT_UP m up. Near our own goal that would put the lens behind
      // the end stand (a roofed bowl fills the frame with roof), so it never goes back past the end boards:
      // it waits there and tilts down more steeply (up to PORTRAIT_TILT_MAX, so nothing behind it creeps into
      // the bottom of the frame), keeping the ball at the same height on screen. Continuous at the switch.
      const limit = HALF_L + 3;
      const uT = ad * tx;
      // Closer settings narrow the lens (same spot, same tilt): the players drawn bigger, the ball still
      // above the touch buttons. (A big chance narrows it up to PUSH_IN more.)
      const half = Math.atan(Math.tan(PORTRAIT_HALF_FOV * DEG) * PORTRAIT_ZOOM[this.zoomSetting] * (1 - PUSH_IN * c));
      const tiltMax = Math.min(PORTRAIT_TILT_MAX * DEG, 89 * DEG - half);
      let G = PORTRAIT_BACK;
      py = PORTRAIT_UP;
      if (uT - PORTRAIT_BACK < -limit) {
        const r0 = PORTRAIT_BACK - 7;
        const r = Math.max(6, uT - 7 + limit);
        const k = clamp((r0 - r) / (r0 - 6), 0, 1);
        const p0 = Math.atan2(PORTRAIT_UP, PORTRAIT_BACK);
        const pitch = p0 + k * (tiltMax - p0);
        // Where the ball (7 m short of the old target) sat below the centre of the frame.
        const drop = Math.atan2(PORTRAIT_UP, r0) - p0;
        py = r * Math.tan(pitch + drop);
        G = py / Math.tan(pitch);
        tx = ad * (G - limit);
      }
      px = tx - ad * G;
      pz = tz;
      fov = (2 * half) / DEG;
    } else {
      this.yaw = 0;
      const piece = f.setPiece;
      // CINEMATIC (see CINE_PITCH_DEG): open play only.
      const cine = this.zoomSetting === 'cinematic' && !piece;
      const deep = this.leanSide !== 0 ? clamp((f.bx * this.leanSide - CINE_DEEP_FROM) / CINE_DEEP_SPAN, 0, 1) : 0;
      const push = this.cineE.to(cine ? deep : 0, CINE_PUSH_W, dt);
      // Corners keep the wide shot whatever the setting: the whole box has to be in the frame.
      const W = piece?.corner ? this.wideWidth() : this.broadcastWidth();
      const small = typeof window !== 'undefined' && window.innerHeight < 420;
      const axK = cine ? AX_K / 2 : AX_K;
      let fx = f.bx * (1 - axK) + ax * axK + this.lead.x + lean;
      // Aim a little beyond the ball so the far boards and a few stand rows frame the top. (The low cinematic
      // lens sees further up the pitch already: it aims nearer the ball.)
      let fz = small ? f.bz * 0.9 : cine ? f.bz * 0.7 - 3 + this.lead.y * 0.5 : f.bz * 0.6 - 5 + this.lead.y * 0.5;
      if (piece) {
        // Taker and target together, but never let the taker leave the frame.
        let mx = (piece.x + piece.tx) / 2;
        let mz = (piece.z + piece.tz) / 2;
        let zHi = piece.z + 0.22 * W;
        if (piece.corner) {
          // Corners: pulled ~6 m on towards the goal, so the whole goal (posts, net, keeper) is in shot, not
          // half off the side. A far-side corner may frame well down the pitch from the taker (he stays in the
          // upper part of the frame); a near-side one keeps him clear of the bottom.
          const gx = Math.sign(piece.x || 1) * HALF_L;
          const dx = gx - mx;
          const dz = -mz;
          const dl = Math.hypot(dx, dz) || 1;
          const k = Math.min(CORNER_PULL, dl);
          mx += (dx / dl) * k;
          mz += (dz / dl) * k;
          if (piece.z < 0) zHi = piece.z + 0.5 * W;
        }
        fx = clamp(mx, piece.x - 0.3 * W, piece.x + 0.3 * W);
        fz = clamp(mz, piece.z - 0.22 * W, zHi);
      }
      if (c > 0) fx += clamp(goalX - fx, -PUSH_LEAN_M, PUSH_LEAN_M) * c;
      // (Soft limits: the framing eases to a stop at the ends and sides instead of hitting a wall.)
      const edge = HALF_L - 0.3 * W + (piece?.corner ? CORNER_PULL : 0);
      tx = softClamp(fx, -edge, edge, EDGE_KNEE);
      // Touch screens: the buttons own the bottom-right, so a set-piece taker is kept in the left 60% of the
      // frame (even if that shows a little of the end stand beyond the corner flag).
      if (piece && this.touchLayout) tx = Math.max(tx, Math.min(piece.x - 0.06 * W, HALF_L + 2));
      tz = softClamp(fz, -(HALF_W - 12), HALF_W - 10, EDGE_KNEE * (2 / 3));
      // Distance so W metres span the screen with a long, near-orthographic lens; it eases out a little for a
      // ball in the air or struck hard (never a jump on the kick). A big chance holds the lens in instead (no
      // dolly-out) and zooms the lens itself (below: at most PUSH_IN of the width, eased, never overshooting).
      let zoom = this.zoomE.to(1 + clamp(f.by * 0.015 + this.spE * 0.003, 0, 0.1), ZOOM_W, dt);
      if (c > 0) zoom += (1 - zoom) * c;
      if (this.tension > 0 || this.tensionE.x > 0) zoom *= 1 - TENSION_IN * this.tensionE.to(this.tension, TENSION_W, dt);
      let d = (W / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * cam.aspect)) * zoom;
      const hf = THREE.MathUtils.degToRad(FOV / 2);
      // Play by the near touchline: the lens rises (a steeper look down, target and distance kept) until the
      // near stand's front-row heads drop out of the bottom band (<= 8% of the height), and only if even the
      // steepest angle can't manage that does the look target come back up the pitch; either way the ball
      // itself stays clear of the bottom HUD.
      // The lowest point that must stay clear of the bottom HUD: the ball, and the controlled player's feet
      // when he is anywhere near it (his pull fades out smoothly from 10 to 18 m away: a man 30 m off
      // across the pitch never drags the ball off the top).
      // (His extra pull is eased on its own, so a switch of player or a pass away from him never tugs the
      // framing across and back; the ball's own limit is never eased.)
      const near = 1 - smoothstep(10, 18, Math.hypot(axo, azo));
      const extra = this.feetE.to(piece ? 0 : Math.max(0, azo * near), FEET_W, dt);
      const bz = piece ? Math.max(piece.z, f.bz) : f.bz + extra;
      const a0 = (cine ? lerp(CINE_PITCH_DEG, PITCH_DEG, smoothstep(CINE_NEAR_FROM, CINE_NEAR_TO, tz)) : PITCH_DEG) * DEG;
      const aMax = NEAR_PITCH_MAX * DEG;
      let a = a0;
      if (piece?.corner) {
        // Corners: framed on the box, the penalty spot at ~46% of the height (~33% on touch layouts, so the
        // buttons never cover the box). A near-side taker is kept in shot too (his boots above NDC
        // CORNER_TAKER_NDC): the lens backs off (a wider shot) as far as that takes. A far-side one is kept
        // below the top 8% as far as the spot can come down (55%) for him.
        const penN = this.touchLayout ? CORNER_PEN_NDC_TOUCH : CORNER_PEN_NDC;
        if (piece.z > 0) {
          const d0 = d;
          const fits = (dd: number) => CameraRig.ndcAt(CameraRig.tzFor(0, 0, penN, a0, dd, hf), a0, piece.z, 0, dd, hf) >= CORNER_TAKER_NDC;
          if (!fits(d0)) {
            let lo = 1;
            let hi = CORNER_BACK_MAX;
            if (fits(d0 * hi)) {
              for (let i = 0; i < 16; i++) {
                const mid = (lo + hi) / 2;
                if (fits(d0 * mid)) hi = mid;
                else lo = mid;
              }
            }
            d = d0 * hi;
          } else d = d0;
        }
        tz = CameraRig.tzFor(0, 0, penN, a0, d, hf);
        if (piece.z < 0) {
          tz = Math.max(Math.min(tz, CameraRig.tzFor(piece.z, (f.tall ?? 1.9) + 0.3, 0.84, a0, d, hf)), CameraRig.tzFor(0, 0, CORNER_PEN_NDC_LOW, a0, d, hf));
        }
      } else {
        if (!CameraRig.standOk(tz, a0, d, hf)) {
          if (CameraRig.standOk(tz, aMax, d, hf)) {
            // Smallest pitch that clears the stand (bisection keeps it continuous as the ball moves).
            let lo = a0;
            let hi = aMax;
            for (let i = 0; i < 18; i++) {
              const mid = (lo + hi) / 2;
              if (CameraRig.standOk(tz, mid, d, hf)) hi = mid;
              else lo = mid;
            }
            a = hi;
          } else {
            a = aMax;
            // Pull the target back up the pitch (never so far that the ball drops under the HUD). The bracket
            // always holds the answer (the stand is out of shot well before 40 m), so it never jumps to an end.
            let lo = tz - 40;
            let hi = tz;
            for (let i = 0; i < 20; i++) {
              const mid = (lo + hi) / 2;
              if (CameraRig.standOk(mid, a, d, hf)) lo = mid;
              else hi = mid;
            }
            tz = lo;
          }
        }
        // The ball wins over the stand (and over the aim beyond it, on the closer settings): ease the target
        // back towards it until it clears the HUD. Looking at the ball itself puts it mid-frame, so the answer
        // is always between here and the ball.
        if (CameraRig.ndcAt(tz, a, bz, 0, d, hf) < NEAR_BALL_NDC && bz > tz) {
          let lo = tz;
          let hi = bz;
          for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            if (CameraRig.ndcAt(mid, a, bz, 0, d, hf) >= NEAR_BALL_NDC) hi = mid;
            else lo = mid;
          }
          tz = hi;
        }
      }
      px = tx;
      py = d * Math.sin(a);
      pz = tz + d * Math.cos(a);
      const lens = (1 - PUSH_IN * c) * (1 - CINE_PUSH * push);
      fov = lens < 1 ? (2 * Math.atan(Math.tan(hf) * lens)) / DEG : FOV;
    }
    this.bRate = f.setPiece ? 2.4 : (3.2 + this.spE * 0.08) * (this.zoomSetting === 'cinematic' && !this.portrait ? CINE_RATE : 1);
    const s = this.bShot;
    s.tx = tx; s.ty = 0; s.tz = tz; s.px = px; s.py = py; s.pz = pz; s.fov = fov;
    return s;
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
    // Once the ball is past the wall, the lens eases in after it (PUSH_RATE, up to PUSH_MAX m along the aim
    // line): the shot is followed on its way to goal, never snapped to.
    const out = Math.hypot(f.bx - this.postSpotX, f.bz - this.postSpotZ);
    const past = out > WALL_DIST + 0.5;
    const pushWant = past ? Math.min(PUSH_MAX, out - WALL_DIST) : this.postPush;
    this.postPush = damp(this.postPush, Math.max(this.postPush, pushWant), PUSH_RATE, dt);
    const fwd = this.postPush - k * 0.9 * (1 - this.postPush / PUSH_MAX);
    const h = {
      ...h0,
      px: h0.px + Math.cos(base) * fwd,
      pz: h0.pz + Math.sin(base) * fwd,
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
    const lr = past ? PUSH_RATE : 3;
    this.postLook.x = damp(this.postLook.x, lx, lr, dt);
    this.postLook.y = damp(this.postLook.y, ly, lr, dt);
    this.postLook.z = damp(this.postLook.z, lz, lr, dt);
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
    /** The broadcast shot: followed by the spring (smooth velocity, limited acceleration). */
    let spring = false;
    // The big-chance weight (see `chance`): the broadcast shot only, eased (fast in, gentle out).
    // (Reduced motion: no push-in either.)
    const cw = this.mode === 'broadcast' && !this.behind && this.shakeFx.enabled ? clamp(this.chance, 0, 1) : 0;
    this.chanceW = clamp(this.chanceE.to(cw, cw > this.chanceE.x ? CHANCE_IN : CHANCE_OUT, dt), 0, 1);
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
        const b = this.broadcastShot(f, dt);
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
        const locked = f.lockAngle !== undefined;
        const tall = (f.tall ?? 1.9) + 0.25;
        // (A scripted move alone in frame: boots clear of the bottom edge, the head just under the lower-third
        // line, so the flip rises through the middle of the picture.)
        // (Your own scorer, f.tight: boots near the bottom edge, the head well above centre: over half the frame's
        // height, from about 6 m. An arms-up hop still fits under the top edge.)
        const tight = !!f.tight && !locked && !this.portrait;
        const feet = this.portrait ? -0.45 : locked ? -0.75 : tight ? -0.86 : -0.9;
        const head = this.portrait ? (locked ? 0.2 : 0.1) : locked ? -0.05 : tight ? 0.45 : -0.3;
        let dist = (tall - feet * g * tanH) / ((head - feet) * tanH);
        dist = Math.max(dist, ((tight ? 1.6 : 3.2) + g) / (tanH * cam.aspect));
        let aimY = -feet * (dist - g) * tanH;
        let lensY = aimY;
        if (f.close) {
          // Head and shoulders: the lens a touch under his eye line looking slightly up, the face above
          // centre, the frame from the waist up (these heads are big: 5.2 m has the head ~45% of the height,
          // and the shush's raised arm still in shot).
          const t0 = f.tall ?? 1.9;
          dist = (this.portrait ? 5.8 : 5.2) * (t0 / 1.94);
          aimY = t0 * 0.72;
          lensY = t0 * 0.66;
        }
        let az: number;
        if (locked) {
          // The move's own angle, exactly: a cut onto it (or to it, from the free angle), then held still.
          const want = f.lockAngle!;
          if (this.celebFresh || Math.abs(wrapAngle(want - this.celebAz)) > 0.6) {
            this.celebAz = want;
            this.snap = true;
          }
          this.celebWant = want;
          this.celebFresh = false;
          this.celebT = 0;
          this.celebAz = dampAngle(this.celebAz, want, 8, dt);
          az = this.celebAz;
        } else {
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
          az = this.celebAz + Math.sin(this.orbit) * 0.12;
        }
        px = sx + Math.cos(az) * dist;
        pz = sz + Math.sin(az) * dist;
        py = lensY;
        tx = sx; tz = sz;
        ty = aimY;
        rate = 5;
        glide = true;
        break;
      }
      case 'scene': {
        // A staged shot: the session hands the lens over outright (a dolly along the line-up, the touchline for a
        // substitution, the man of the match), and it is followed exactly: a cut onto it, never a fly-in.
        const sc = f.scene;
        if (!sc) {
          const b = this.broadcastShot(f, dt);
          ({ tx, ty, tz, px, py, pz, fov } = b);
          rate = this.bRate;
          glide = true;
          spring = true;
          break;
        }
        ({ tx, ty, tz, px, py, pz, fov } = sc);
        rate = 60;
        scripted = true;
        break;
      }
      case 'card': {
        const c = f.card;
        if (!c) {
          const b = this.broadcastShot(f, dt);
          ({ tx, ty, tz, px, py, pz, fov } = b);
          rate = this.bRate;
          glide = true;
          spring = true;
          break;
        }
        // Referee close-up: the lens orbits the midpoint between the referee and the offender he faces,
        // 110-120 degrees off the referee->offender line, on the referee's side (his card hand towards us):
        // the offender's face, the referee three-quarters on with the card held up clear of his head, both
        // full length side by side, filmed from about chest height.
        const q = this.cardLens(c.rx, c.rz, c.fx, c.fz, NO_SKIP, f.tall ?? 1.9);
        const mx = (c.rx + c.fx) / 2;
        const mz = (c.rz + c.fz) / 2;
        px = q.x;
        pz = q.z;
        const tall = f.tall ?? 1.9;
        py = CARD_Y * (tall / 1.9);
        // Framed on the midpoint between the referee (raised card) and the offender he faces.
        tx = mx;
        tz = mz;
        ty = tall * 0.66;
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
          // Always looking at the goal end: never further out than REPLAY_LOOK_MAX from the line (a ball
          // still out on the edge of the box is framed coming in, not chased upfield).
          tx = gs > 0 ? Math.max(f.bx, HALF_L - REPLAY_LOOK_MAX) : Math.min(f.bx, -HALF_L + REPLAY_LOOK_MAX);
          tz = clamp(f.bz, -(GOAL_W / 2 + 8), GOAL_W / 2 + 8);
          // ...and while the ball is still coming in, the look leans towards the goal mouth (up to 30% of the
          // way at 12 m out, none by the line) so the goal it is heading for is in the frame too.
          const lean = 0.3 * clamp((Math.abs(gs * HALF_L - tx) - 3) / 9, 0, 1);
          tx += (gs * HALF_L - tx) * lean;
          tz -= tz * lean;
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
          const b = this.behindShot(piece, f.tall ?? 1.9);
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
          this.postSpotX = piece.x;
          this.postSpotZ = piece.z;
          this.postPush = 0;
          this.wasCorner = false;
          this.pieceShot = null;
          break;
        }
        const bc = this.broadcastShot(f, dt);
        this.easeFromPiece(bc, f, dt);
        ({ tx, ty, tz, px, py, pz, fov } = bc);
        rate = this.bRate;
        glide = true;
        spring = true;
        // A corner has just been struck: the framing swings from the box to the ball (and back in to the
        // chosen camera distance) as a speed-limited glide, never a jump cut at the moment of the kick.
        const corner = !!piece?.corner && !this.portrait;
        if (this.wasCorner && !corner && !piece) this.cornerEase = CORNER_EASE_S;
        this.wasCorner = corner;
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
          spring = false;
          scripted = true;
          this.pieceShot = null;
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
    // Low cameras (goal line, celebrations) step around anyone standing where the lens would be. (The card
    // close-up holds its framing: anyone that close to it is faded out of the shot instead.)
    if ((this.mode === 'replay' && this.replayShot === 'goal') || this.mode === 'celebrate') {
      const o = this.clearOfPlayers(px, pz, f.subject ?? -1);
      px = o.x;
      pz = o.z;
    }
    if (this.mode === 'celebrate') {
      // Every low celebration lens stays in front of the boards, including portrait framing and a move's own
      // requested angle. Apply this after clearing players, which can also nudge a safe lens into the stand.
      px = clamp(px, -(HALF_L + 3.4), HALF_L + 3.4);
      pz = clamp(pz, -(HALF_W + 2.2), HALF_W + 2.2);
    }
    // Cuts: asked for (only when the new framing is far away), or the wanted shot jumped (players reset
    // for a kick-off or a set piece, a new stoppage framing): a cut, never a 50 m whip pan.
    if (this.softCutReq) {
      this.softCutReq = false;
      if (Math.hypot(px - this.pos.x, pz - this.pos.z) > CUT_JUMP || Math.hypot(tx - this.target.x, tz - this.target.z) > CUT_JUMP) this.snap = true;
    }
    const easing = this.cornerEase > 0 && this.mode === 'broadcast' && !behind;
    this.cornerEase = easing ? Math.max(0, this.cornerEase - dt) : 0;
    if (!easing && (glide || this.mode === 'replay') && this.hasWant && (Math.hypot(tx - this.wantT.x, tz - this.wantT.z) > CUT_JUMP || Math.hypot(px - this.wantP.x, py - this.wantP.y, pz - this.wantP.z) > CUT_JUMP)) {
      this.snap = true;
    }
    // The framing's own velocity (fed forward to the spring follow, see FOLLOW_FF): frame to frame, through a
    // critically damped low-pass (sustained motion comes through, a dribbler's weave mostly doesn't); nothing
    // across a cut or out of a camera that isn't the spring-followed broadcast shot.
    const cutting = this.snap || (scripted && rate >= 60);
    if (spring && this.hasWant && !cutting && dt > 0) {
      CameraRig.wantVel(this.wantVT, this.wantAT, tx, ty, tz, this.wantT, dt);
      CameraRig.wantVel(this.wantVP, this.wantAP, px, py, pz, this.wantP, dt);
    } else {
      this.wantVT.set(0, 0, 0);
      this.wantVP.set(0, 0, 0);
      this.wantAT.set(0, 0, 0);
      this.wantAP.set(0, 0, 0);
    }
    this.wantT.set(tx, ty, tz);
    this.wantP.set(px, py, pz);
    this.hasWant = true;
    this.cutNow = cutting;
    if (this.cutNow) {
      this.target.set(tx, ty, tz);
      this.pos.set(px, py, pz);
      this.fov = fov;
      this.snap = false;
      this.velT.set(0, 0, 0);
      this.velP.set(0, 0, 0);
    } else if (spring) {
      // The broadcast lens: a critically damped follow, speed- and acceleration-limited (see FOLLOW_K).
      this.follow(this.target, this.velT, tx, ty, tz, this.wantVT, rate * FOLLOW_K, dt);
      this.follow(this.pos, this.velP, px, py, pz, this.wantVP, rate * FOLLOW_K, dt);
      this.fov = damp(this.fov, fov, rate, dt);
    } else {
      this.velT.set(0, 0, 0);
      this.velP.set(0, 0, 0);
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
        CameraRig.capMove(this.pos, ox, oy, oz, lim);
        CameraRig.capMove(this.target, qx, qy, qz, lim);
      }
      // Lens changes ease with the move, so a zoom never jumps ahead of the dolly.
      this.fov = damp(this.fov, fov, rate, dt);
    }
    cam.fov = this.fov;
    cam.position.copy(this.pos);
    if (this.punch > 0.001 && dt > 0) {
      cam.position.x += Math.sin(time * 61) * this.punch;
      cam.position.y += Math.sin(time * 47 + 1) * this.punch;
      this.punch = damp(this.punch, 0, 7, dt);
    }
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    // Screen shake: the whole picture jolts by whole pixels (the projection's centre moves), so the ball and
    // the players shake with the stands, and nothing the framing or the follow spring reads is touched.
    const sh = this.shakeFx.update(dt);
    if (sh.x !== 0 || sh.y !== 0) {
      const h = Math.max(1, this.viewH);
      const e = cam.projectionMatrix.elements;
      e[8] -= (2 * sh.x) / (h * cam.aspect);
      e[9] -= (2 * sh.y) / h;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
  }

  /**
   * The wanted shot's own velocity `u` (one coordinate at a time, from where it stood last frame, `o`), through
   * a critically damped low-pass at FOLLOW_VEL_W (state `du`), capped at MAX_GLIDE.
   */
  private static wantVel(u: THREE.Vector3, du: THREE.Vector3, x: number, y: number, z: number, o: THREE.Vector3, dt: number): void {
    const w = FOLLOW_VEL_W;
    const e = Math.exp(-w * dt);
    for (let i = 0; i < 3; i++) {
      const raw = ((i === 0 ? x : i === 1 ? y : z) - o.getComponent(i)) / dt;
      const x0 = u.getComponent(i) - raw;
      const k = (du.getComponent(i) + w * x0) * dt;
      du.setComponent(i, (du.getComponent(i) - w * k) * e);
      u.setComponent(i, raw + (x0 + k) * e);
    }
    const s = u.length();
    if (s > MAX_GLIDE) u.multiplyScalar(MAX_GLIDE / s);
  }

  /** Hold `v` to within `lim` m of where it was (x, y, z). */
  private static capMove(v: THREE.Vector3, x: number, y: number, z: number, lim: number): void {
    const d = Math.hypot(v.x - x, v.y - y, v.z - z);
    if (d > lim) {
      const k = lim / d;
      v.set(x + (v.x - x) * k, y + (v.y - y) * k, z + (v.z - z) * k);
    }
  }

  /**
   * One step of the broadcast follow: `x` (velocity `v`) springs towards (gx, gy, gz), which is moving at `u`,
   * at `w` rad/s, critically damped with FOLLOW_FF of `u` fed forward (exact step: x'' = -w^2 (x - g) -
   * 2w (x' - FOLLOW_FF u), solved in the frame moving with the target, where the steady lag is -c u), then the
   * change of velocity is held to MAX_ACC and the speed to MAX_GLIDE. With u = 0 it is the plain spring.
   */
  private follow(x: THREE.Vector3, v: THREE.Vector3, gx: number, gy: number, gz: number, u: THREE.Vector3, w: number, dt: number): void {
    if (dt <= 0) return;
    const e = Math.exp(-w * dt);
    const c = (2 * (1 - FOLLOW_FF)) / w;
    // Shifted error at the start of the step (the target then stood u dt short of where it is now).
    const ox = x.x - gx + u.x * (dt + c), oy = x.y - gy + u.y * (dt + c), oz = x.z - gz + u.z * (dt + c);
    const rx = v.x - u.x, ry = v.y - u.y, rz = v.z - u.z;
    const kx = (rx + w * ox) * dt, ky = (ry + w * oy) * dt, kz = (rz + w * oz) * dt;
    let nx = (rx - w * kx) * e + u.x, ny = (ry - w * ky) * e + u.y, nz = (rz - w * kz) * e + u.z;
    let limited = false;
    const dv = Math.hypot(nx - v.x, ny - v.y, nz - v.z);
    const dvMax = MAX_ACC * dt;
    if (dv > dvMax) {
      const k = dvMax / dv;
      nx = v.x + (nx - v.x) * k;
      ny = v.y + (ny - v.y) * k;
      nz = v.z + (nz - v.z) * k;
      limited = true;
    }
    const s = Math.hypot(nx, ny, nz);
    if (s > MAX_GLIDE) {
      const k = MAX_GLIDE / s;
      nx *= k;
      ny *= k;
      nz *= k;
      limited = true;
    }
    if (limited) x.set(x.x + (v.x + nx) * 0.5 * dt, x.y + (v.y + ny) * 0.5 * dt, x.z + (v.z + nz) * 0.5 * dt);
    else x.set(gx + (ox + kx) * e - c * u.x, gy + (oy + ky) * e - c * u.y, gz + (oz + kz) * e - c * u.z);
    v.set(nx, ny, nz);
  }

  /**
   * Card close-up lens (ground x, z) for a referee at (rx, rz) booking the player at (fx, fz). The side is
   * picked once per booking (setMode('card') resets it): CARD_DEG off the referee->offender line on his card
   * hand side, or 110 / 120 degrees, or (only if that side is out of bounds or packed) the other side.
   */
  cardLens(rx: number, rz: number, fx: number, fz: number, skip: readonly number[] = [], tall = 1.9): { x: number; z: number } {
    // Players drawn bigger (phones) are filmed from further back: the same frame.
    const D = CARD_D * (tall / 1.9);
    let dx = fx - rx;
    let dz = fz - rz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const mx = (rx + fx) / 2;
    const mz = (rz + fz) / 2;
    const at = (sg: number) => {
      const off = Math.abs(sg);
      const ux = dx * Math.cos(off) - dz * Math.sign(sg) * Math.sin(off);
      const uz = dz * Math.cos(off) + dx * Math.sign(sg) * Math.sin(off);
      return { x: mx + ux * D, z: mz + uz * D };
    };
    if (this.cardSide === 0) {
      let best = CARD_HAND * CARD_DEG * DEG;
      let bestScore = Infinity;
      for (const deg of [CARD_DEG, 110, 120]) {
        for (const sgn of [CARD_HAND, -CARD_HAND]) {
          const sg = sgn * deg * DEG;
          const q = at(sg);
          let score = (Math.max(0, Math.abs(q.x) - (HALF_L + 3)) + Math.max(0, Math.abs(q.z) - (HALF_W + 2.2))) * 10;
          // (Anyone crowding the lens or on the sight line is faded out of the shot, so a crowd only tips the
          // balance: the card hand towards the lens matters more, or the card is hidden behind his head.)
          score += this.sightBlock(q.x, q.z, mx, mz, skip);
          score += Math.abs(deg - CARD_DEG) * 0.02 + (sgn !== CARD_HAND ? 3 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = sg;
          }
        }
      }
      this.cardSide = best;
    }
    const q = at(this.cardSide);
    return { x: clamp(q.x, -(HALF_L + 3), HALF_L + 3), z: clamp(q.z, -(HALF_W + 2.2), HALF_W + 2.2) };
  }

  /**
   * Over-the-shoulder set-piece camera: metres behind / above the ball and to the side of the taker. Free
   * kicks at goal: `back` / `up` (for a 1.9 m player; scaled with the draw size) with a `fov` lens, tilted
   * so the crossbar sits at `barNdc` (`barNdcSmall` on small screens, where the set-piece hint along the top
   * is proportionally bigger): the taker stands full length in the lower half, the wall and goal above him.
   */
  readonly behindRig = {
    back: 8, up: 3.3, side: 1.2, fov: 38, look: 9, barNdc: 0.5, barNdcSmall: 0.38,
    penBack: 6.5, penUp: 4.8, cornerBack: 6.5, cornerUp: 4.8,
  };

  /**
   * Our dead ball near goal, filmed from behind the taker. Free kicks at goal: a low lens (`back` 8 m behind
   * the ball, 3.3 m up, 38 degrees) 1.2 m off the aim line on the other side of it from the taker (he waits
   * off to one side for his run-up): the ball in the middle, the taker full length beside it in the lower
   * half (~40% of the height, clear of the touch controls in the corners), and the wall, keeper and goal
   * mouth lined up above them, crossbar just under the set-piece hint. Anyone else within 4 m of the
   * lens is faded out (MatchSession), so only someone further off can block the ball. Penalties: 6.5 m back
   * / 4.8 m up, inside the box, so the players cleared to its edge are behind the lens (goal ~40% wide).
   * Crosses: over the corner taker's shoulder at the drop zone.
   */
  private behindShot(piece: NonNullable<CamFocus['setPiece']>, tall = 1.9): { tx: number; ty: number; tz: number; px: number; py: number; pz: number; fov: number } {
    const rig = this.behindRig;
    const fk = !!piece.goal && !piece.pen;
    // Players drawn bigger (phones) are filmed from proportionally further back and higher: the same frame.
    const k = fk ? tall / 1.9 : 1;
    const back0 = (piece.pen ? rig.penBack : piece.goal ? rig.back : rig.cornerBack) * k;
    const up = (piece.pen ? rig.penUp : piece.goal ? rig.up : rig.cornerUp) * k;
    const dx = piece.tx - piece.x;
    const dz = piece.tz - piece.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl;
    const uz = dz / dl;
    // Step to the side nearer the middle of the pitch, so the taker stands just off the aim line; free kicks
    // step to the other side of the line from the taker (he waits off to one side for his run-up), so he
    // is never between the lens and the ball.
    let ss = piece.z * ux - piece.x * uz > 0 ? -1 : 1;
    const fr = this.players;
    const taker = piece.taker ?? -1;
    if ((fk || piece.pen) && piece.foot) {
      // The sim stands him at his run-up spot on the -foot side of the line: the lens goes on the +foot side,
      // right from the first frame (the drawn frame may still show him at the ball then, and a lens that
      // picked his side and then crossed over filmed the back of his head for ~0.7 s).
      ss = piece.foot > 0 ? 1 : -1;
    } else if (fk && fr && taker >= 0) {
      const lat = (fr[taker * PF] - piece.x) * -uz + (fr[taker * PF + 1] - piece.z) * ux;
      if (Math.abs(lat) > 0.2) ss = lat > 0 ? -1 : 1;
    }
    const side0 = piece.goal ? rig.side : 0;
    // Stay in front of the stands (corners put "behind the ball" over the front rows).
    const place = (b: number, sd: number) => ({
      x: clamp(piece.x - ux * b - uz * ss * sd, -(HALF_L + 4), HALF_L + 4),
      z: clamp(piece.z - uz * b + ux * ss * sd, -(HALF_W + 2.8), HALF_W + 2.8),
    });
    // Someone standing between the lens and the ball (a team-mate, a player lingering by the box): step
    // to one side of him, then (free kicks) back off or (penalties) come in a little, until the ball and
    // taker are clear. Free kicks ignore anyone close enough to the lens to be faded out.
    const backs = fk ? [back0, back0 + 1.2, back0 - 0.8] : [back0, back0 - 1.2, back0 - 2.2];
    const sides = fk ? [side0, side0 + 1.3, side0 + 2.4] : [side0, side0 + 1.8, -side0 - 1.8];
    const near = fk ? 4 : 0;
    let at = place(back0, side0);
    search: for (const b of backs) {
      for (const sd of sides) {
        at = place(b, sd);
        if (!this.blocksBall(at.x, at.z, piece.x, piece.z, taker, near)) break search;
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
    if (fk) {
      const small = typeof window !== 'undefined' && window.innerHeight < 560;
      const tanH = Math.tan((rig.fov / 2) * DEG);
      const pitch = Math.atan2(py - GOAL_H, D) + Math.atan((small ? rig.barNdcSmall : rig.barNdc) * tanH);
      const L = rig.look * k;
      return { tx: px + vx * L, ty: py - L * Math.tan(pitch), tz: pz + vz * L, px, py, pz, fov: rig.fov };
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
  private sightBlock(cx: number, cz: number, sx: number, sz: number, skip: readonly number[]): number {
    const fr = this.players;
    if (!fr) return 0;
    const lx = sx - cx;
    const lz = sz - cz;
    const l2 = lx * lx + lz * lz || 1;
    let score = 0;
    for (let i = 0; i < 22; i++) {
      if (skip.includes(i)) continue;
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

  /**
   * Is a player (other than whoever is over the ball, or `skip`) standing on the sight line from (cx, cz) to
   * the ball? Anyone within `near` m of the lens doesn't count (he is faded out of the shot).
   */
  private blocksBall(cx: number, cz: number, bx: number, bz: number, skip = -1, near = 0): boolean {
    const fr = this.players;
    if (!fr) return false;
    const lx = bx - cx;
    const lz = bz - cz;
    const l2 = lx * lx + lz * lz || 1;
    for (let i = 0; i < 22; i++) {
      if (i === skip) continue;
      const o = i * PF;
      const qx = fr[o];
      const qz = fr[o + 1];
      if (Math.hypot(qx - bx, qz - bz) < 1.3 || Math.hypot(qx - cx, qz - cz) < near) continue;
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

  /** True if the last update() cut rather than glided (a new shot is on air). */
  get justCut(): boolean {
    return this.cutNow;
  }

  get focusX(): number {
    return this.target.x;
  }

  get focusZ(): number {
    return this.target.z;
  }

  /** Screen-stick to world-ground mapping for the current camera. */
  /** (The same object every call: read it at once.) */
  screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // yaw 0: forward (0,-1), right (1,0)
    const rx = -fz;
    const rz = fx;
    const o = this.stw;
    o.x = sx * rx + sy * fx;
    o.z = sx * rz + sy * fz;
    return o;
  }
}
