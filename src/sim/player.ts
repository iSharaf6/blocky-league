import { angleDiff, clamp, turnToward, wrapAngle } from '../core/math';
import { hashString } from '../core/rng';
import { ACCEL, CONTROL_R, DECEL, DRIBBLE_MULT, JOG_SPEED, KICK_WINDUP, SPRINT_SPEED, STRIDE, TEMPO } from './constants';
import { FREEZE_ACCEL, FREEZE_PACE, MAGNET_CONTROL_R, TURBO_ACCEL, TURBO_PACE } from './blitz';
import type { PowerUpKind, KickKind, PlayerDef, Role, ShotStyle, Side } from './types';

/**
 * A player's stronger foot: 1 right, -1 left. An explicit `foot` on the definition wins; otherwise it's
 * fixed by his name (about 78% of players are right-footed), so the same player always has the same foot.
 */
export function preferredFoot(def: PlayerDef): 1 | -1 {
  const own = (def as { foot?: unknown }).foot;
  if (own === 1 || own === -1) return own;
  return hashString(`${def.name}|foot`) % 100 < 78 ? 1 : -1;
}

/**
 * How good his other foot is, 1 (hopeless) .. 5 (two-footed). An explicit `weakFoot` on the definition
 * wins; otherwise it's fixed by his name: 1 6%, 2 26%, 3 42%, 4 20%, 5 6%.
 */
export function weakFootRating(def: PlayerDef): number {
  const own = (def as { weakFoot?: unknown }).weakFoot;
  if (typeof own === 'number' && Number.isFinite(own)) return clamp(Math.round(own), 1, 5);
  const h = hashString(`${def.name}|weak`) % 100;
  return h < 6 ? 1 : h < 32 ? 2 : h < 74 ? 3 : h < 94 ? 4 : 5;
}

/** Seconds a player stays off balance after losing the ball in a challenge (a 50/50, a poke or a slide)... */
export const STUMBLE_LOST = 0.45;
/** ... after riding a challenge or a shoulder barge and keeping it... */
export const STUMBLE_BUMP = 0.3;
/** ... and after getting back up off the floor. */
export const STUMBLE_UP = 0.25;
/** How fast (rad/s) a shooter opens his body towards goal during the wind-up (Player.kickFace). */
export const KICK_TURN = 9;

export type PState =
  | 'move' // normal locomotion, can dribble
  | 'kick' // wind-up then strike
  | 'slide' // slide tackle
  | 'fallen' // on the floor after being tackled
  | 'stand' // getting back up
  | 'dive' // keeper dive
  | 'hold' // keeper holding the ball
  | 'throw' // throw-in / keeper throw wind-up
  | 'celebrate'
  | 'dejected';

/**
 * An intent to strike the ball. The actual launch velocity is solved at the moment of
 * contact (see actions.resolveKick) so first-time volleys aim from wherever the ball is.
 */
export interface KickOrder {
  kind: KickKind;
  /** World-space aim direction (stick or AI choice); zero = use facing. */
  dirX: number;
  dirZ: number;
  power: number; // 0..1
  /** Receiver chosen by the AI, or -1 to let the solver pick from the direction. */
  target: number;
  /** Optional explicit landing / aim point (AI through balls, clearances). */
  aimX?: number;
  aimZ?: number;
  /** Optional landing height for lofted balls (default: head height for lobs, grass for clears). */
  land?: number;
  /** Seconds this order stays valid while waiting for a loose ball to arrive. */
  expires: number;
  firstTime: boolean;
  /** A human's loose-ball strike belongs to this kick; another kick or possession cancels it. */
  looseStrike?: number;
  /**
   * Shots only: sidespin, -1..1 (world z sign = the way it bends). The launch is re-aimed so the
   * bend brings it back onto the target: it starts outside the aim point and swings in.
   */
  curl?: number;
  /** Lofted balls only: whipped in flat and fast (a driven cross) instead of hung up. */
  driven?: boolean;
  /** Shots only: a chip over the keeper, or a finesse (curled, placed) shot. */
  style?: ShotStyle;
  /** Lofted balls only: extra seconds of hang time (a far-post corner is hung up over the near post). */
  hang?: number;
  /**
   * Shots only (timed finishing, the human's second SHOOT tap judged before the strike): the shot's error
   * times this (0.4 perfect, 0.7 good, 1.9 mistimed), and `wild` adds the mistimed shot's extra lift.
   */
  finish?: number;
  wild?: boolean;
  /**
   * Human passes only: the charged power (0..1) of a held PASS / THROUGH; left out for a tap (the assist
   * judges the pace) and for every AI kick. See actions.assistPace.
   */
  charge?: number;
  /** Human passes only: the passer's speed (m/s) when he let the button go (the error margin's speed term). */
  runSpeed?: number;
  /**
   * Human passes only: how far (rad) his body was still turned off the pass line when the kick was ordered
   * (the error margin's body term; he squares up the rest of the way during the wind-up).
   */
  bodyOff?: number;
  /** A human's THROUGH with nobody to run onto it: driven to the locked man's feet (actions.humanThroughTarget's `feet`). */
  toFeet?: boolean;
}

/** Top speed allowed while celebrating (adrenaline: a scorer can outrun his stamina). */
export const CELEBRATE_SPRINT = 9;

/** Stamina per second at the reference half length (2 minutes); see Player.fatigue. (A faster game, TEMPO, is that much more physical.) */
const SPRINT_DRAIN = 0.017 * TEMPO;
const JOG_DRAIN = 0.0036 * TEMPO;
const RECOVERY = 0.008;
/** Half length (s) the stamina rates are tuned for. */
export const FATIGUE_REF_HALF = 120;
/**
 * The human's dribbler cuts rather than brakes: turns sharper than a plant-and-turn (up to
 * DRIBBLE_CUT_MAX rad off his run) bend the run round at DRIBBLE_TURN rad/s (90 degrees in ~0.27 s),
 * losing at most DRIBBLE_CUT_LOSS of his pace through a right-angle cut. The body (and the ball on his
 * foot) turns DRIBBLE_FACE_TURN times faster so it keeps up. (AI carriers steer smoothly and keep the
 * velocity-blend turn.)
 */
export const DRIBBLE_TURN = 5.8 * TEMPO;
const DRIBBLE_CUT_MAX = 2.4;
const DRIBBLE_CUT_LOSS = 0.16;
const DRIBBLE_FACE_TURN = 1.8;
/**
 * The drawn body (Player.drawFacing) keeps turning to a face target the controller drops for this long (s). Rules
 * that face the ball only inside some range ask on one step and not the next at its edge, and every body on the
 * pitch flicked back and forth on screen (~170 reversals a minute in AI v AI). Drawing only: what the sim plays with
 * (`facing`, and so every kick, tackle and stat) is untouched.
 */
export const FACE_HOLD_T = 0.12;
/**
 * The human's man answers the stick quicker than the AI's players (snappy, Mario-Strikers style): he speeds
 * up and slows down HUMAN_ACCEL x as hard, turns (body, and his run with the ball) HUMAN_TURN x as fast, and
 * with the stick let go he stops dead (HUMAN_STOP m/s², ~0.13 s from a sprint) rather than drifting on.
 */
export const HUMAN_ACCEL = 2.1;
export const HUMAN_TURN = 1.75;
const HUMAN_STOP = 60 * TEMPO;
/** Close control (the human's dribbler jogging, not sprinting): he turns this much quicker again. */
export const CLOSE_TURN = 1.2;
/**
 * A skill cut (see dribble.ts): for Player.cutT s the run and the body swing round this much faster again,
 * losing only CUT_KEEP_LOSS of the usual pace loss. (A cut-back past DRIBBLE_CUT_MAX brakes and goes, which
 * the human's quicker legs make quicker still.)
 */
export const CUT_TURN_BOOST = 1.5;
const CUT_KEEP_LOSS = 0.35;
/** The human's long slide: glides (light drag) this long, and he's back up to stand after HUMAN_SLIDE_END s. */
const HUMAN_SLIDE_GLIDE = 0.5;
const HUMAN_SLIDE_END = 0.85;
/** Wrong-footed (Player.wrongFootT): top pace and acceleration are cut to these fractions. */
const WRONG_FOOT_PACE = 0.3;
const WRONG_FOOT_ACCEL = 0.3;

export class Player {
  pos = { x: 0, z: 0 };
  vel = { x: 0, z: 0 };
  facing = 0;
  state: PState = 'move';
  stateT = 0;

  // Controls, written every tick by the human controller or the AI.
  wantX = 0;
  wantZ = 0;
  sprint = false;
  faceTarget: number | null = null;
  /**
   * The body as drawn (render only: the sim never reads it, see drawnFacing): `facing`, except that a face target
   * the controller stops asking for is still turned to for FACE_HOLD_T. The last such target and the hold left (s),
   * and `facing` as locomote last left it (anything else turning him since snaps the drawn body to it).
   */
  drawFacing = 0;
  private faceHeld = 0;
  private faceHeldT = 0;
  private drawSeen = 0;

  stamina = 1;
  kickCooldown = 0;
  tackleCooldown = 0;
  order: KickOrder | null = null;

  // Keeper dive / jump physics.
  y = 0;
  vy = 0;
  diveDir = 0; // -1 / +1 relative to facing for animation
  /** Lateral ground (m) the current dive can still cover before the keeper is at full stretch. */
  diveTravel = Infinity;
  // Animation bookkeeping (recorded for replays).
  runPhase = 0;
  kickT = 0; // 0..1 swing progress, drives the kicking leg
  kickLeg = 1; // 1 right, -1 left
  headerT = 0;
  celebrate = 0; // style index
  lean = 0;

  slideHit = false;
  /** This slide is mistimed: if it reaches the ball it takes the man too (a foul). */
  slideFoul = false;
  /** The current slide is the human's long, forgiving one (HUMAN_SLIDE_GLIDE s of glide; see dribble.ts). */
  longSlide = false;
  /**
   * The human's man is being driven by the human (the stick, PRESS, a TACKLE closing in): his quick legs apply
   * (HUMAN_ACCEL). Not while he winds up a shot (he plants and aims), nor on a run the sim makes for him with the
   * stick left alone (move assist, meeting a pass or a cross), which keeps an AI player's pace of reaction.
   */
  quickLegs = false;
  /** Human strikes release locomotion shortly after contact; the pose blends back into the run. */
  quickRecovery = false;
  /** The current 'kick' state is a quick tackle poke, not a strike (lighter braking, can chain a kick). */
  poke = false;
  /** Blitz mode: the power-up acting on this player right now (null = none) and seconds left on it. */
  boost: PowerUpKind | null = null;
  boostT = 0;
  /** Red-carded: off the pitch for the rest of the match, takes no further part. */
  sentOff = false;
  /** Stamina drain multiplier, set by the match so fatigue builds over a match of any length. */
  fatigue = 1;
  /** Seconds of extra pace after a knock-on. */
  burstT = 0;

  // AI scratch state.
  aiT = 0;
  aiDirX = 1;
  aiDirZ = 0;
  runT = 0;
  running = false;
  /** Sprint + pass sends the passer forward for a return ball. */
  giveGoT = 0;
  /** This run has already prompted the carrier to look up (see ai.updateRun). */
  runCued = false;
  /** Seconds this player has had the ball at their feet (reset on every new control). */
  ballT = 0;
  /** What the AI carrier is currently doing between decisions. */
  aiMode: 'dribble' | 'shield' = 'dribble';
  /** Kick id of the last ball this player already tried (and failed) to block. */
  blockKick = -1;
  /** Keeper: kick id of the cross last judged, and whether they decided to come for it. */
  claimKick = -1;
  claiming = false;
  /** Kick id of the last ball this player already decided whether to hit first time. */
  volleyKick = -1;
  /** Seconds left on a committed tackle attempt (pressing AI). */
  commitT = 0;
  /** How long the AI carrier means to keep the ball before moving it on (set on each control). */
  holdT = 1;
  /** Seconds spent jockeying the current carrier (presser escalates to a tackle over time). */
  jockeyT = 0;
  /** Wrong-footed by a take-on: slower to react for this long. */
  slowT = 0;
  /**
   * Dribble assists (the human's man only; see dribble.ts). cutT: seconds left of a skill cut's burst turn.
   * wrongFootT: this defender was wrong-footed by it and is planted the wrong way (nearly frozen).
   * protectT: just beaten his man with a skill, the dribbler can't be tackled cleanly. shieldT: he's
   * shielding the ball (body between it and a close defender), so tackles on him mostly fail.
   */
  cutT = 0;
  wrongFootT = 0;
  protectT = 0;
  shieldT = 0;
  /**
   * An AI defender's challenge on the human's carrier, telegraphed (skills.ts): seconds left of the wind-up before
   * he goes in (a slide when tellSlide, else a committed standing tackle). The human's SKILL meanwhile is a PERFECT.
   */
  tellT = 0;
  tellSlide = false;
  /** That tell came from the duel (skills.ts TELL_DUEL): its tackle, if he ignores it, is a soft one (DUEL_TACKLE). */
  tellDuel = false;
  /** Seconds left of the committed challenge a tell led into (its tackle is the surer for it: skills.ts TOLD_TACKLE). */
  toldT = 0;
  /**
   * Off balance, seconds left: bumped off the ball or riding a challenge, beaten to a 50/50, just back on
   * his feet. A shot or a first touch taken meanwhile is rougher (it doesn't slow his running).
   */
  stumbleT = 0;
  /**
   * The current 'kick' state's moment of contact (s after it started): KICK_WINDUP, a little longer for a
   * human's open-play shot (the timed-finish window) and for a plant step. kickT is paced so the swing
   * meets the ball then, however long the wind-up.
   */
  kickWindup = KICK_WINDUP;
  /** 0..1: the current kick is a plant step, braking out of a sprint before the strike (1 = flat out). */
  plant = 0;
  /**
   * A shot's wind-up: the way (world angle) he opens his body to as he shapes up to strike it, at up to
   * KICK_TURN rad/s until contact (null: he strikes it the way he's facing).
   */
  kickFace: number | null = null;
  /**
   * First touch: seconds left of the touch settling (0 = the ball is on his foot), and the offset (m, world)
   * it was pushed to ahead of his foot; it shrinks to nothing as he runs onto it.
   */
  touchT = 0;
  touchX = 0;
  touchZ = 0;

  /** His stronger foot (1 right, -1 left): see preferredFoot. */
  get foot(): 1 | -1 {
    return preferredFoot(this.def);
  }

  /** His weaker foot, 1 (hopeless) .. 5 (two-footed): see weakFootRating. */
  get weakFoot(): number {
    return weakFootRating(this.def);
  }

  role: Role;
  readonly isKeeper: boolean;
  jog: number;
  top: number;

  /**
   * Formation slot (index into Match.slots[side]); slot 0 is always the keeper. Outfielders can move
   * to another slot when the formation changes (Match.setFormation).
   */
  slot: number;

  constructor(
    readonly idx: number,
    readonly side: Side,
    slot: number,
    public def: PlayerDef,
  ) {
    this.slot = slot;
    this.role = def.role;
    this.isKeeper = slot === 0;
    const pace = def.stats.pace / 100;
    this.jog = JOG_SPEED * (0.86 + pace * 0.22);
    this.top = SPRINT_SPEED * (0.82 + pace * 0.26);
  }

  get stat() {
    return this.def.stats;
  }

  /** Where the ball sits when this player dribbles. */
  footX(): number {
    return this.pos.x + Math.cos(this.facing) * this.footReach();
  }

  footZ(): number {
    return this.pos.z + Math.sin(this.facing) * this.footReach();
  }

  footReach(): number {
    const sp = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    return 0.52 + Math.min(sp / TEMPO, 8) * 0.045;
  }

  controlRadius(): number {
    if (this.boost === 'magnet') return MAGNET_CONTROL_R;
    return CONTROL_R + (this.stat.dribbling / 100) * 0.18;
  }

  speed(): number {
    return Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }

  setState(s: PState): void {
    this.state = s;
    if (s !== 'kick') this.quickRecovery = false;
    this.stateT = 0;
    this.poke = false;
    this.kickWindup = KICK_WINDUP;
    this.plant = 0;
    this.kickFace = null;
  }

  canAct(): boolean {
    return this.state === 'move' && !this.sentOff;
  }

  /**
   * `agile`: the human-controlled player: quicker to speed up, slow down and turn (HUMAN_ACCEL, HUMAN_TURN),
   * stopping dead when the stick is let go, and with the ball he cuts sharply (DRIBBLE_TURN) instead of the AI's
   * rounder turn through the velocity blend.
   */
  step(dt: number, dribbling: boolean, agile = false): void {
    this.stateT += dt;
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.giveGoT = Math.max(0, this.giveGoT - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.cutT = Math.max(0, this.cutT - dt);
    this.wrongFootT = Math.max(0, this.wrongFootT - dt);
    this.protectT = Math.max(0, this.protectT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.touchT = Math.max(0, this.touchT - dt);

    switch (this.state) {
      case 'move':
        this.locomote(dt, dribbling, agile);
        break;
      case 'kick':
      case 'throw': {
        if (this.quickRecovery && this.state === 'kick' && !this.order && this.stateT >= this.kickWindup + 0.06) {
          this.quickRecovery = false;
          this.setState('move');
          this.locomote(dt, dribbling, agile);
          break;
        }
        this.brake(dt, this.poke ? 3 : 10);
        // A longer wind-up (a human's shot, a plant step) slows the back-swing so the boot still meets the
        // ball at contact (kickT ~0.32), and the follow-through is as long as ever.
        const extra = this.state === 'kick' ? Math.max(0, this.kickWindup - KICK_WINDUP) : 0;
        const pace = extra > 0 && this.stateT <= this.kickWindup ? KICK_WINDUP / this.kickWindup : 1;
        // Shaping up to a shot: he opens his body towards goal as he winds up (a strike on the turn with
        // his back to goal is still off balance at contact).
        if (this.kickFace !== null && !this.poke && this.stateT < this.kickWindup) {
          this.facing = wrapAngle(turnToward(this.facing, this.kickFace, KICK_TURN * dt));
        }
        this.kickT = Math.min(1, this.kickT + (dt * pace) / 0.34);
        if (this.stateT > 0.34 + extra) {
          this.setState('move');
          this.kickT = 0;
        }
        break;
      }
      case 'slide':
        if (this.longSlide) {
          this.brake(dt, this.stateT < HUMAN_SLIDE_GLIDE ? 0.9 : 6);
          if (this.stateT > HUMAN_SLIDE_END) this.setState('stand');
        } else {
          this.brake(dt, this.stateT < 0.35 ? 1.2 : 6);
          if (this.stateT > 0.75) this.setState('stand');
        }
        break;
      case 'fallen':
        this.brake(dt, 5);
        if (this.stateT > 1.05) this.setState('stand');
        break;
      case 'stand':
        this.brake(dt, 12);
        if (this.stateT > 0.38) {
          this.setState('move');
          // Back up, but not steady on his feet yet.
          if (!this.isKeeper) this.stumbleT = Math.max(this.stumbleT, STUMBLE_UP);
        }
        break;
      case 'dive':
        // At full stretch the body stops going sideways (the arms are the reach from there).
        if (this.diveTravel < Infinity) {
          this.diveTravel -= Math.abs(this.vel.z) * dt;
          if (this.diveTravel <= 0) this.vel.z *= Math.exp(-25 * dt);
        }
        this.y += this.vy * dt;
        this.vy -= 14 * dt;
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.brake(dt, 6);
        }
        if (this.stateT > 1.25) {
          this.setState('stand');
          this.y = 0;
        }
        break;
      case 'hold':
        this.brake(dt, 10);
        break;
      case 'celebrate':
      case 'dejected':
        this.locomote(dt, false);
        break;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.state !== 'dive' && this.y > 0) {
      this.y = Math.max(0, this.y + this.vy * dt);
      this.vy -= 18 * dt;
      if (this.y <= 0) this.vy = 0;
    }

    const sp = this.speed();
    this.runPhase = (this.runPhase + (sp * dt) / (STRIDE * 2)) % 1;

    // Stamina: sprinting drains hard, running about drains a little, only standing / walking
    // recovers. `fatigue` compresses a full match's worth of it into however long the halves are.
    const sprinting = this.sprint && sp > this.jog * 0.95;
    const fit = this.stat.stamina / 100;
    let rate: number;
    if (sprinting) rate = -SPRINT_DRAIN * (1.35 - fit);
    else if (sp > this.jog * 0.5) rate = -JOG_DRAIN * (1.3 - fit * 0.6);
    else rate = RECOVERY;
    this.stamina = clamp(this.stamina + rate * this.fatigue * dt, 0.15, 1);
    if (this.headerT > 0) this.headerT = Math.max(0, this.headerT - dt / 0.45);
  }

  /** Jogging pace, a touch slower when spent. */
  jogPace(): number {
    return this.jog * (0.93 + 0.07 * this.stamina);
  }

  /** Flat-out pace: tired legs lose a lot of it (never below a jog). */
  sprintPace(): number {
    return Math.max(this.jogPace() * 1.04, this.top * (0.7 + 0.3 * this.stamina));
  }

  private locomote(dt: number, dribbling: boolean, agile = false): void {
    let max = this.sprint ? this.sprintPace() : this.jogPace();
    if (this.state === 'celebrate' && this.sprint) max = Math.max(max, CELEBRATE_SPRINT);
    if (this.burstT > 0) max = Math.max(max, this.top) * 1.1;
    if (dribbling) max *= DRIBBLE_MULT * (0.9 + (this.stat.dribbling / 100) * 0.12);
    let tx = this.wantX;
    let tz = this.wantZ;
    const tl = Math.sqrt(tx * tx + tz * tz);
    if (tl > 1) {
      tx /= tl;
      tz /= tl;
    }
    // Backpedalling while facing a target (jockeying) is slower than running forwards.
    if (this.faceTarget !== null && tl > 0.05) {
      const back = -(Math.cos(this.facing) * tx + Math.sin(this.facing) * tz) / Math.min(tl, 1);
      if (back > 0.3) max *= 1 - 0.2 * Math.min(1, (back - 0.3) / 0.5);
    }
    if (this.slowT > 0) max *= 0.55;
    if (this.wrongFootT > 0) max *= WRONG_FOOT_PACE;
    if (this.boost === 'turbo') max *= TURBO_PACE; else if (this.boost === 'freeze') max *= FREEZE_PACE;
    tx *= max;
    tz *= max;

    // Sharp turns at speed bleed momentum like a real plant-and-turn.
    const sp = this.speed();
    let accel = tl > 0.05 ? ACCEL : DECEL;
    if (this.slowT > 0) accel *= 0.5;
    if (this.wrongFootT > 0) accel *= WRONG_FOOT_ACCEL;
    if (this.boost === 'turbo') accel *= TURBO_ACCEL; else if (this.boost === 'freeze') accel *= FREEZE_ACCEL;
    let turn = 0;
    if (sp > 2 && tl > 0.05) {
      const cur = Math.atan2(this.vel.z, this.vel.x);
      const want = Math.atan2(tz, tx);
      turn = Math.abs(angleDiff(cur, want));
      if (turn > 1.6) accel = DECEL * 1.1;
    }
    // The human's man: quicker legs, and the stick let go means stop.
    const quickLegs = agile && this.quickLegs ? HUMAN_ACCEL : 1;
    if (agile) accel = tl > 0.05 ? accel * quickLegs : HUMAN_STOP;
    const cut = dribbling && agile;
    // The human's man turns quicker; close control (jogging with it) quicker still; a skill cut's burst more.
    const quick = agile ? HUMAN_TURN * (cut ? (this.sprint ? 1 : CLOSE_TURN) * (this.cutT > 0 ? CUT_TURN_BOOST : 1) : 1) : 1;
    if (cut && sp > 1.5 && tl > 0.05 && turn > 0.05 && turn < DRIBBLE_CUT_MAX) {
      // A cut with the ball: the run bends round instead of braking through the turn.
      const cur = Math.atan2(this.vel.z, this.vel.x);
      const a = turnToward(cur, Math.atan2(tz, tx), DRIBBLE_TURN * quick * (this.slowT > 0 ? 0.5 : 1) * dt);
      const loss = DRIBBLE_CUT_LOSS * (this.cutT > 0 ? CUT_KEEP_LOSS : 1);
      const want = Math.hypot(tx, tz) * (1 - loss * Math.min(1, turn / (Math.PI / 2)));
      const nsp = sp + clamp(want - sp, -ACCEL * quickLegs * dt, ACCEL * quickLegs * dt);
      this.vel.x = Math.cos(a) * nsp;
      this.vel.z = Math.sin(a) * nsp;
    } else {
      const dx = tx - this.vel.x;
      const dz = tz - this.vel.z;
      const dl = Math.sqrt(dx * dx + dz * dz);
      const step = accel * dt;
      if (dl <= step) {
        this.vel.x = tx;
        this.vel.z = tz;
      } else {
        this.vel.x += (dx / dl) * step;
        this.vel.z += (dz / dl) * step;
      }
    }

    const nsp = this.speed();
    // (The body turn scales with the tempo, its speed term read in round-8 units, so a faster runner turns as
    // sharply through a corner as he did at the old pace.)
    const nT = nsp / TEMPO;
    const turnRate = (dribbling ? (9 - nT * 0.5) * (cut ? DRIBBLE_FACE_TURN : 1) : 13 - nT * 0.7) * TEMPO * quick;
    const step = Math.max(4, turnRate) * dt;
    // The body as drawn first: turned by something else since this ran last (a kick, a tackle, a restart), it is
    // just there. It turns as `facing` does, but to a face target the controller dropped for FACE_HOLD_T longer.
    if (this.facing !== this.drawSeen) this.drawFacing = this.facing;
    let shown: number | null = this.faceTarget;
    if (shown !== null) {
      this.faceHeld = shown;
      this.faceHeldT = FACE_HOLD_T;
    } else if (this.faceHeldT > 0) {
      this.faceHeldT -= dt;
      shown = this.faceHeld;
    }
    let face: number | null = this.faceTarget;
    if (face === null && nsp > 0.35) face = Math.atan2(this.vel.z, this.vel.x);
    if (shown === null) shown = face;
    if (face !== null) this.facing = turnToward(this.facing, face, step);
    this.facing = wrapAngle(this.facing);
    if (shown !== null) this.drawFacing = wrapAngle(turnToward(this.drawFacing, shown, step));
    this.drawSeen = this.facing;
    // Lean into acceleration for the animation.
    this.lean += ((nsp / this.top) * 0.35 - this.lean) * Math.min(1, dt * 6);
  }

  /** The facing to draw: drawFacing while nothing has turned him since locomote last ran, else `facing` itself. */
  drawnFacing(): number {
    return this.facing === this.drawSeen ? this.drawFacing : this.facing;
  }

  brake(dt: number, rate: number): void {
    const k = Math.exp(-rate * dt);
    this.vel.x *= k;
    this.vel.z *= k;
  }
}
