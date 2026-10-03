import { angleDiff, clamp, dist2 } from '../core/math';
import { BALL_R, GRAVITY, ROLL_A, ROLL_B } from './constants';
import { PROTECT_T, vsHuman, wrongFoot } from './dribble';
import type { Match, Pad } from './match';
import type { Player } from './player';
import type { MatchEvent, Side, SkillGrade, SkillMoveKind } from './types';

/**
 * SKILL moves (the SKILL button: Q / U, gamepad LB, the touch SKILL button) for the human's man on the ball, and the
 * timing counter that makes them pay. Everything here acts only on a human-controlled carrier and on the AI defenders
 * going in on him, so AI-vs-AI play never reaches it. Randomness comes from `m.rng` only.
 *
 * The move: SKILL with the stick against his run picks it (skillKind), each with its use:
 * - along it: a NUTMEG with a man squared up in front of him (NUTMEG_R m: through his legs and round him to it), else
 *   a RAINBOW FLICK, the ball flicked up over a man in front (FLICK_APEX m high: it goes over a slide too), landing
 *   FLICK_LAND m on for him to run onto;
 * - half across it: an ELASTICO, out and back in with the outside of the boot: ELASTICO_SLIP m to that side at speed;
 * - across his run: a ROULETTE at pace, a spin that slips him ROULETTE_SLIP m to that side with the ball, or LA
 *   CROQUETA from a jog or less (the ball shifted foot to foot, CROQUETA_SLIP m, quick);
 * - half back: a HEEL CHOP, cut behind the standing leg and away that way at speed (reverse away from pressure);
 * - back the way he came: a DRAG BACK, the sole pulling it back as he turns away with it;
 * - the stick left alone: a STEPOVER, the feint where he stands (a BALL ROLL standing still: the sole rolls it across
 *   him, away from the nearest man).
 * Each plays for SKILL_T s; there are SKILL_COOL s between two and each costs SKILL_STAMINA of his legs. While one
 * plays (and he isn't protected) the ball is off his foot: tackles on him come off SKILL_EXPOSED x as often.
 *
 * The counter: an AI defender going in on him from in front or beside him (ai.ts: a committed standing tackle, or a
 * chase slide) shows it first: tellTime s of wind-up (the tell: the render's crouch, the HUD's badge over him; he is
 * set meanwhile, so no skill cut fools him as a committed man) before he goes in (with a lunge, TELL_LUNGE). SKILL
 * within the window (the tell and PERFECT_GRACE s more) is a PERFECT: he bites, planted and stumbling for PERFECT_BEAT
 * s (a slide on its way goes under nothing), he can't touch the ball again until the move is done and PERFECT_SHIELD s
 * more (SkillState.shield: no tackle, no touch, no header; only a covering man or the keeper can still stop it: the
 * owner, "skill when done perfectly always gets intercepted"), and the dribbler is protected for PERFECT_PROTECT s
 * with a burst of pace out of it (PERFECT_BURST, and PERFECT_KICK of his sprint the moment the move ends). Otherwise a move with a defender within GOOD_R m is a GOOD when it
 * wrong-foots him on a roll like the skill cut's (half as likely straight after another move: SPAM_T / SPAM_K); a
 * plain move when it doesn't; with nobody within SHOW_R m a show-off move, nothing more. A challenge from behind him
 * (out of view, OUT_OF_VIEW) goes in at once, untold, as every challenge always did and AI-vs-AI ones still do.
 *
 * Moves that beat a man (and skill cuts / knock-ons that do: dribble.ts) within COMBO_T s of each other chain
 * ("SKILL x2", "x3"), and a goal by his side within SKILL_GOAL_T s of one is a SKILL GOAL ('skillGoal').
 */

/** How long each move plays (s): the animation, and the time the ball is off his foot. */
export const SKILL_T: Readonly<Record<SkillMoveKind, number>> = {
  roulette: 0.42, rainbow: 0.36, stepover: 0.34, dragback: 0.32, elastico: 0.3, croqueta: 0.26, nutmeg: 0.3, heelchop: 0.28, ballroll: 0.36,
};
/** Names for the pop over him (Silkscreen: no hyphens). */
export const SKILL_NAMES: Readonly<Record<SkillMoveKind | ChainKind, string>> = {
  roulette: 'ROULETTE', rainbow: 'RAINBOW FLICK', stepover: 'STEPOVER', dragback: 'DRAG BACK', elastico: 'ELASTICO', croqueta: 'LA CROQUETA',
  nutmeg: 'NUTMEG', heelchop: 'HEEL CHOP', ballroll: 'BALL ROLL', cut: 'SKILL CUT', knock: 'KNOCK ON', past: 'SKINNED HIM',
};
/** The chain's other links: a skill cut and a knock-on (dribble.ts), and dribbling clean past a man (`past`: watchPast). */
export type ChainKind = 'cut' | 'knock' | 'past';
/** Frame code per move (replay.ts writeFrame: the render's skill pose). */
export const SKILL_CODE: Readonly<Record<SkillMoveKind, number>> = {
  roulette: 1, rainbow: 2, stepover: 3, dragback: 4, elastico: 5, croqueta: 6, nutmeg: 7, heelchop: 8, ballroll: 9,
};
/** Seconds between the start of one move and the next, and the stamina each one costs (times Player.fatigue). */
export const SKILL_COOL = 0.7;
export const SKILL_STAMINA = 0.03;
/**
 * The stick against his run: under STICK_DEAD it's left alone (a stepover, a ball roll standing); within FORWARD_ARC of
 * his run a nutmeg or a rainbow flick, to ELASTICO_ARC an elastico, to CROSS_ARC a roulette (la croqueta under
 * ROULETTE_PACE m/s), to BACK_ARC a heel chop, beyond it a drag back.
 */
const STICK_DEAD = 0.3;
const FORWARD_ARC = (25 * Math.PI) / 180;
const ELASTICO_ARC = (65 * Math.PI) / 180;
const CROSS_ARC = (115 * Math.PI) / 180;
const BACK_ARC = (155 * Math.PI) / 180;
const ROULETTE_PACE = 3.5;
/** Under this pace (m/s) with the stick left alone it's a ball roll, not a stepover. */
const BALL_ROLL_PACE = 1.6;
/**
 * The tell (s) by the AI's difficulty (Match.aiSkill: EASY 0.6 ~0.36 s, NORMAL 1.8 ~0.32, HARD 3 ~0.28, LEGEND 4
 * ~0.24), and the grace after it (the lunge's first frames) that still counts: the PERFECT window is both.
 */
export function tellTime(skill: number): number {
  return clamp(0.36 - (skill - 0.6) * 0.035, 0.24, 0.36);
}
export const PERFECT_GRACE = 0.06;
/**
 * A told standing tackle (ai.ts press) is committed to this much more often than an untold one would be: the tell is a
 * warning, and without the extra challenges a player who never touches SKILL would keep the ball noticeably more.
 */
export const TELL_PRESS = 1.8;
/** ... and the tackle a tell led into (Player.toldT, while it's committed) comes off this much more often. */
export const TOLD_TACKLE = 1;
/**
 * The duel (the owner's favourite: "make it much more frequent"): a man in front of the human's dribbler, within
 * TELL_REACH m, winds up a told challenge at TELL_DUEL a second on top of his usual press, so taking a man on almost
 * always brings a tell. One at a time, and TELL_GAP s from the start of one to the next (never a wall of them).
 * (32 bot matches, 2x90 s, NORMAL, SKILL never pressed: ~41 tells a match against ~16 before; W-D-L 22-6-4 against
 * 22-10-0, goals 1.28-0.28 against 1.34-0.22, balls lost to tackles 2.5 against 2.35 a match.)
 */
export const TELL_REACH = 3.8;
export const TELL_DUEL = 2.4;
export const TELL_GAP = 0.9;
/**
 * A duel's tell barks more than it bites: ignored, its tackle comes off this much as often as a usual one. The
 * duel is there for the SKILL counter (a PERFECT is the payoff); a player who never presses SKILL mustn't lose the
 * ball every time he takes a man on, so it's no poke after the lunge either (ai.ts press).
 */
export const DUEL_TACKLE = 0.08;
export const DUEL_SETTLE = 0.6;
/** Dribbled past (watchPast): a man within PAST_AHEAD m goal-side and PAST_SIDE m of the line, beaten within PAST_T s. */
const PAST_AHEAD = 3;
const PAST_SIDE = 1.6;
const PAST_T = 1.2;
/** A challenge from further behind him than this (cos of the angle off his facing, negated) is out of view: untold. */
const OUT_OF_VIEW = 0.35;
/** A telegraphed challenge is called off with the carrier further away than this (m). */
const TELL_BREAK = 4.2;
/**
 * When the tell is up he goes in with a lunge at the ball, at TELL_LUNGE m/s at least, committed for COMMIT_T s (ai.ts
 * press's commit): the time the tell gives the carrier, the lunge takes back.
 */
const TELL_LUNGE = 8;
const COMMIT_T = 0.55;
/** PERFECT: the man who bit is planted and stumbling this long (s), and the dribbler protected, with a burst after the move. */
export const PERFECT_BEAT_MIN = 0.8;
export const PERFECT_BEAT_MAX = 1.0;
export const PERFECT_PROTECT = 0.8;
export const PERFECT_BURST = 0.9;
/** PERFECT: the man who bit can't touch the ball for the move and this long (s) after it (a flick or a nutmeg: till he has it back). */
export const PERFECT_SHIELD = 1.2;
/** The shield's lock-out is topped up this far (s) ahead each step (SkillState.shield, applyShield). */
const SHIELD_STEP = 0.1;
/** GOOD: a man the move wrong-footed can't touch it until the move is done (a flick or a nutmeg: till he has it back). */
export const GOOD_SHIELD = 0.15;
/** PERFECT: out of the move he goes at this share of his sprint at once (the burst). */
export const PERFECT_KICK = 0.92;
/** GOOD: defenders within GOOD_R m can be wrong-footed; with nobody within SHOW_R m it's a show-off move. */
export const GOOD_R = 3.2;
export const SHOW_R = 4.5;
/** A move started within SPAM_T s of the last one wrong-foots SPAM_K as often ("he's seen that one"). */
const SPAM_T = 1.6;
const SPAM_K = 0.5;
/** Mid move (unprotected) tackles on him come off this much more often (dribble.ts carrierGuard). */
export const SKILL_EXPOSED = 1.3;
/**
 * Skills this close together (s) chain: every move, cut, knock-on and man dribbled past adds a link (the "SKILL ×n"
 * over him), show-offs too. A goal this soon (SKILL_GOAL_T) after one that beat a man, in a chain with a SKILL move
 * that beat one, is a SKILL GOAL: the pops are free, the rewards are earned.
 */
export const COMBO_T = 5;
export const SKILL_GOAL_T = 5;
/** ROULETTE: the slip to the side (m), and his pace along the run meanwhile (share of his pace going in, at most m/s). */
const ROULETTE_SLIP = 1.3;
const ROULETTE_ON = 0.45;
const MOVE_PACE_MAX = 3.2;
/** RAINBOW FLICK: flicked up this far into the move (s), FLICK_APEX m high, landing FLICK_LAND m on; he can't take it back for FLICK_COOL s. */
export const FLICK_AT = 0.14;
export const FLICK_APEX = 2.1;
export const FLICK_LAND = 5.5;
const FLICK_COOL = 0.3;
/** ... and he's after it until he has it, someone else does, or this long (s) after it lands. */
const FLICK_CHASE = 0.6;
/** STEPOVER: his pace meanwhile (share of his pace going in); DRAG BACK: his pace back the other way (m/s). */
const STEPOVER_ON = 0.35;
const DRAG_PACE = 3;
/** ELASTICO: out and back in, ELASTICO_SLIP m to the stick's side (ELASTICO_FEINT m the other way first), at ELASTICO_ON of his pace. */
const ELASTICO_SLIP = 1.5;
const ELASTICO_FEINT = 0.25;
const ELASTICO_ON = 0.8;
/** LA CROQUETA: foot to foot, CROQUETA_SLIP m to the side, on at CROQUETA_ON of his pace (at most CROQUETA_MAX m/s). */
const CROQUETA_SLIP = 1.15;
const CROQUETA_ON = 0.35;
const CROQUETA_MAX = 2.4;
/** BALL ROLL: the sole rolls it BALL_ROLL_SLIP m across him. */
const BALL_ROLL_SLIP = 1.0;
/** HEEL CHOP: off the other way (the stick's) at HEEL_CHOP_ON of his pace going in, at least HEEL_CHOP_MIN m/s, from HEEL_CHOP_AT of the move. */
const HEEL_CHOP_ON = 0.7;
const HEEL_CHOP_MIN = 4;
const HEEL_CHOP_AT = 0.25;
/**
 * NUTMEG: a man squared up in front (within NUTMEG_R m along the run, NUTMEG_LANE m of its line, facing him) gets it
 * through his legs: knocked NUTMEG_AT s into the move to roll NUTMEG_PAST m beyond him, and the dribbler goes round him
 * (NUTMEG_ROUND m to the side) to run onto it, until NUTMEG_CHASE s after it stops at most.
 */
const NUTMEG_R = 3.2;
const NUTMEG_LANE = 0.9;
const NUTMEG_AT = 0.12;
const NUTMEG_PAST = 2.6;
const NUTMEG_ROUND = 1.1;
const NUTMEG_CHASE = 0.8;
/**
 * A move that fits the moment fools a man more often (gradeMove's GOOD roll): a nutmeg on the man squared up, a rainbow
 * over a slide, a side move (elastico, roulette, la croqueta) past a man in front, a heel chop or drag back away from a
 * man closing in. Added to the roll's odds.
 */
const FIT_NUTMEG = 0.15;
const FIT_OVER_SLIDE = 0.25;
const FIT_SIDE = 0.05;
const FIT_AWAY = 0.1;

/** A move under way. `ux, uz`: his run going in; `lx, lz`: the roulette's side; `bx, bz`: the drag back's way. */
export interface SkillMove {
  kind: SkillMoveKind;
  player: number;
  t: number;
  dur: number;
  ux: number;
  uz: number;
  lx: number;
  lz: number;
  bx: number;
  bz: number;
  /** His pace going in (m/s). */
  entry: number;
  grade: SkillGrade;
  /**
   * RAINBOW FLICK / NUTMEG: the ball is off his foot on purpose (up over the man, or through his legs), where it comes
   * down (or stops), and until when he chases it (move time).
   */
  flicked: boolean;
  landX: number;
  landZ: number;
  chaseEnd: number;
  /** NUTMEG: the man it goes through (-1: none), and the side (+1 / -1 across the run) he goes round him. */
  through: number;
  round: number;
}

/** A defender's telegraphed challenge on him: `until` (skill clock) closes the PERFECT window. */
export interface SkillThreat {
  by: number;
  on: number;
  at: number;
  until: number;
  slide: boolean;
}

/** Per-side SKILL state (HumanCtl.skill). */
export class SkillState {
  /** Seconds of open play under the human's control (the skill clock). */
  t = 0;
  /** When the last move started (-9: none yet). */
  last = -9;
  move: SkillMove | null = null;
  /** The newest telegraphed challenge on his man (the HUD's tell). */
  threat: SkillThreat | null = null;
  /**
   * The chain: how many successful skills in a row (moves, and skill cuts / knock-ons), how many of them were SKILL
   * moves (a SKILL GOAL wants one), and when the last one was.
   */
  combo = 0;
  chainMoves = 0;
  lastWin = -9;
  /** When a link last beat a man (the SKILL GOAL clock), and when the newest tell on his man started (TELL_GAP). */
  lastBeat = -9;
  tellAt = -9;
  /** Per player: when he was last square in front of the dribbler (watchPast: once he's behind him, he's been skinned). */
  readonly ahead: number[] = new Array(22).fill(-9);
  /** A defender a PERFECT beat, stumbling (the render): who, from when (skill clock), how long. */
  stumble: { idx: number; at: number; dur: number } | null = null;
  /**
   * Men a move beat who can't touch the ball until `until` (skill clock; a flick or a nutmeg's: till the dribbler has
   * it back, `flick`): no tackle, no touch on a loose ball, no header, no slide (applyShield). PERFECT_SHIELD, GOOD_SHIELD.
   */
  readonly shield: { idx: number; until: number; flick: boolean }[] = [];
  /** This match: tells shown, moves made, PERFECTs, the best chain, SKILL GOALs. */
  tells = 0;
  moves = 0;
  perfects = 0;
  bestCombo = 0;
  skillGoals = 0;

  /**
   * A skill that beat a man (a move, or a skill cut / knock-on: dribble.ts): extends the chain (COMBO_T), and a chain
   * of two or more is shown ('skillMove' with `combo`). Returns the chain.
   */
  chain(m: Match, p: Player, move: SkillMoveKind | ChainKind, grade: SkillGrade = 'good', on = -1, beat = true): number {
    const going = this.t - this.lastWin <= COMBO_T;
    this.combo = going ? this.combo + 1 : 1;
    if (!going) this.chainMoves = 0;
    if (beat && move !== 'cut' && move !== 'knock' && move !== 'past') this.chainMoves++;
    this.lastWin = this.t;
    if (beat) this.lastBeat = this.t;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (move === 'cut' || move === 'knock' || move === 'past') m.events.push({ type: 'skillMove', player: p.idx, move, grade, combo: this.combo, on });
    return this.combo;
  }

  /** Tackles on carrier `idx` this step: SKILL_EXPOSED while his move plays, else 1 (dribble.ts carrierGuard). */
  exposure(idx: number): number {
    const mv = this.move;
    return mv && mv.player === idx && mv.t < mv.dur && !mv.flicked ? SKILL_EXPOSED : 1;
  }

  /** Is `idx` out of it, beaten by a move (shield)? */
  shielded(idx: number): boolean {
    return this.shield.some((s) => s.idx === idx && s.until > this.t);
  }

  /** `o` can't touch the ball for `dur` s from now (the longer of this and any he already has). */
  guard(o: Player, dur: number, flick: boolean): void {
    const until = this.t + dur;
    const e = this.shield.find((s) => s.idx === o.idx);
    if (e) {
      e.until = Math.max(e.until, until);
      e.flick ||= flick;
    } else this.shield.push({ idx: o.idx, until, flick });
  }
}

// ------------------------------------------------------------------ the tell (the AI's side of it)

/**
 * Does AI defender `o`'s challenge on `c` get a tell (ai.ts asks before it commits or slides)? Only on the human's
 * man, in open play, and only from in front of him or beside him: from behind it goes in untold.
 */
export function telegraphs(m: Match, o: Player, c: Player): boolean {
  if (m.phase !== 'play' || !m.isHumanControlled(c) || m.isHumanControlled(o) || o.side === c.side) return false;
  const tx = o.pos.x - c.pos.x;
  const tz = o.pos.z - c.pos.z;
  const tl = Math.hypot(tx, tz) || 1;
  return (Math.cos(c.facing) * tx + Math.sin(c.facing) * tz) / tl > -OUT_OF_VIEW;
}

/**
 * May a duel's tell go up on the human's carrier `c`: none winding up on him now, TELL_GAP s since the last began, and
 * he has had it DUEL_SETTLE s (taking a man on, not a first-time pass: a man sprinting in to wind up stood in its lane).
 */
export function tellReady(m: Match, c: Player): boolean {
  const st = m.ctl[c.side].skill;
  return st.threat === null && st.t - st.tellAt >= TELL_GAP && c.ballT >= DUEL_SETTLE;
}

/** `o` winds up his challenge on the human's carrier `c` (a slide or a standing tackle): the tell, and the window. */
export function startTell(m: Match, o: Player, c: Player, slide: boolean, duel = false): void {
  const st = m.ctl[c.side].skill;
  const t = tellTime(m.aiSkill(o.side));
  o.tellT = t;
  o.tellSlide = slide;
  o.tellDuel = duel;
  o.commitT = 0;
  st.threat = { by: o.idx, on: c.idx, at: st.t, until: st.t + t + PERFECT_GRACE, slide };
  st.tells++;
  st.tellAt = st.t;
  m.events.push({ type: 'skillTell', by: o.idx, on: c.idx, slide });
}

/**
 * Once a step (first thing in Match.step): every telegraphed challenge counts down, and goes in when its tell is up (a
 * committed standing tackle, or the slide, aimed where the ball is going); one whose carrier has moved the ball on,
 * got away or beaten him is called off. Out of open play the moves and windows are dropped.
 */
export function skillTells(m: Match, dt: number): void {
  if (m.phase !== 'play') {
    for (const h of m.ctl) {
      h.skill.move = null;
      h.skill.threat = null;
    }
  }
  const b = m.ball;
  const c = b.owner >= 0 && !b.held ? m.players[b.owner] : null;
  for (const o of m.players) {
    if (o.toldT > 0) o.toldT = Math.max(0, o.toldT - dt);
    if (o.tellT <= 0) continue;
    const live = m.phase === 'play' && c !== null && c.side !== o.side && m.isHumanControlled(c) && o.state === 'move' && !o.sentOff &&
      o.wrongFootT <= 0 && dist2(o.pos.x, o.pos.z, c.pos.x, c.pos.z) < TELL_BREAK;
    if (!live || !c) {
      o.tellT = 0;
      const st = m.ctl[o.side === 0 ? 1 : 0].skill;
      if (st.threat?.by === o.idx) st.threat = null;
      continue;
    }
    o.tellT -= dt;
    if (o.tellT > 1e-9) continue;
    o.toldT = COMMIT_T;
    o.tellT = 0;
    if (o.tellSlide) {
      const lead = 0.18;
      o.facing = Math.atan2(b.pos.z + c.vel.z * lead - o.pos.z, b.pos.x + c.vel.x * lead - o.pos.x);
      m.startSlide(o);
    } else {
      o.commitT = COMMIT_T;
      const lx = b.pos.x + b.vel.x * 0.1 - o.pos.x;
      const lz = b.pos.z + b.vel.z * 0.1 - o.pos.z;
      const ll = Math.hypot(lx, lz) || 1;
      const sp = Math.max(o.speed(), TELL_LUNGE);
      o.vel.x = (lx / ll) * sp;
      o.vel.z = (lz / ll) * sp;
      o.facing = Math.atan2(lz, lx);
    }
  }
}

// ------------------------------------------------------------------ the human's moves

/**
 * The human's man this step (Match.applyHuman, open play, after everything else has set his run): a SKILL press on
 * the ball starts a move (trySkill), and a move under way steers him (stepMove).
 */
export function humanSkill(m: Match, p: Player, pad: Pad, dt: number): void {
  const h = m.ctl[p.side];
  const st = h.skill;
  st.t += dt;
  if (st.threat && st.t > st.threat.until) st.threat = null;
  if (pad.skill && !h.prev.skill) trySkill(m, p, pad, st);
  if (st.move) stepMove(m, p, pad, st, dt);
  applyShield(m, p, st);
  watchPast(m, p, st);
}

/**
 * The men a move beat (SkillState.shield) stay out of it: no tackle (tackleCooldown), no touch on a loose ball
 * (kickCooldown: Match.checkPossession), no header or volley ordered this step (it runs after the AI's, before the
 * orders are struck), no slide reaching it (slideHit), no new tell. It ends when their side has the ball, or with the
 * dribbler's flick / nutmeg once he has it back (and GOOD_SHIELD more).
 */
function applyShield(m: Match, p: Player, st: SkillState): void {
  if (!st.shield.length) return;
  const b = m.ball;
  const mv = st.move;
  const theirs = b.owner >= 0 && m.players[b.owner].side !== p.side;
  for (let i = st.shield.length - 1; i >= 0; i--) {
    const e = st.shield[i];
    // (A flick's or nutmeg's shield lasts till he has it back: the move ends then.)
    if (e.flick && mv && mv.flicked && mv.player === b.lastTouch) e.until = Math.max(e.until, st.t + GOOD_SHIELD);
    const left = e.until - st.t;
    if (left <= 0 || theirs || m.phase !== 'play') {
      st.shield.splice(i, 1);
      continue;
    }
    const o = m.players[e.idx];
    // (Topped up a step or two ahead each step: once the shield ends, so does his lock-out.)
    const hold = Math.min(left, SHIELD_STEP);
    o.kickCooldown = Math.max(o.kickCooldown, hold);
    o.tackleCooldown = Math.max(o.tackleCooldown, hold);
    o.tellT = 0;
    if (o.order?.firstTime) o.order = null;
    if (o.state === 'slide') o.slideHit = true;
  }
}

/**
 * Dribbling clean past a man: one who stood square between the dribbler and goal (PAST_AHEAD m on, within PAST_SIDE m
 * of his line) and is goal-side of him no more within PAST_T s, the ball still at his feet, is a link in the chain
 * ('past': SKINNED HIM). Measured towards goal, so turning back doesn't "beat" anyone.
 */
function watchPast(m: Match, p: Player, st: SkillState): void {
  const b = m.ball;
  if (b.owner !== p.idx || b.held || p.speed() < 2) return;
  const ad = m.attackDir(p.side);
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.isKeeper || o.sentOff) continue;
    const along = (o.pos.x - p.pos.x) * ad;
    const across = Math.abs(o.pos.z - p.pos.z);
    if (along > 0.4 && along < PAST_AHEAD && across < PAST_SIDE) st.ahead[o.idx] = st.t;
    else if (along < -0.6 && across < PAST_SIDE + 1 && st.t - st.ahead[o.idx] < PAST_T) {
      st.ahead[o.idx] = -9;
      st.chain(m, p, 'past', 'good', o.idx);
    }
  }
}

/**
 * Which move the stick (`mx, mz`) picks against his run (`ux, uz`) at `pace` m/s, with a man squared up in front of him
 * or not (`squared`: a nutmeg), and its side (+1: the stick's turn is anticlockwise).
 */
export function skillKind(ux: number, uz: number, mx: number, mz: number, pace = 9, squared = false): { kind: SkillMoveKind; turn: number } {
  if (Math.hypot(mx, mz) < STICK_DEAD) return { kind: pace < BALL_ROLL_PACE ? 'ballroll' : 'stepover', turn: 1 };
  const a = angleDiff(Math.atan2(uz, ux), Math.atan2(mz, mx));
  const turn = Math.sign(a) || 1;
  const abs = Math.abs(a);
  if (abs < FORWARD_ARC) return { kind: squared ? 'nutmeg' : 'rainbow', turn: 1 };
  if (abs < ELASTICO_ARC) return { kind: 'elastico', turn };
  if (abs < CROSS_ARC) return { kind: pace >= ROULETTE_PACE ? 'roulette' : 'croqueta', turn };
  if (abs < BACK_ARC) return { kind: 'heelchop', turn };
  return { kind: 'dragback', turn: 1 };
}

/** The man squared up in front of `p` (along his run `ux, uz`) a nutmeg would go through, or null. */
function squaredUp(m: Match, p: Player, ux: number, uz: number): Player | null {
  let best: Player | null = null;
  let bd = NUTMEG_R;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.isKeeper || o.sentOff || o.state !== 'move') continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const along = ox * ux + oz * uz;
    if (along < 0.6 || along > bd || Math.abs(-uz * ox + ux * oz) > NUTMEG_LANE) continue;
    // (Facing him, more or less: a man turned side-on or running away has his legs closed to it.)
    if (-(Math.cos(o.facing) * ux + Math.sin(o.facing) * uz) < 0.35) continue;
    bd = along;
    best = o;
  }
  return best;
}

function trySkill(m: Match, p: Player, pad: Pad, st: SkillState): void {
  const b = m.ball;
  if (b.owner !== p.idx || b.held || p.state !== 'move' || p.sentOff) return;
  if (st.move || st.t - st.last < SKILL_COOL) return;
  // (Charging a shot or a pass, or aiming one, the buttons are busy: no move.)
  if (pad.shoot || pad.pass || pad.through || m.ctl[p.side].passMode !== null) return;
  const sp = p.speed();
  const ux = sp > 1 ? p.vel.x / sp : Math.cos(p.facing);
  const uz = sp > 1 ? p.vel.z / sp : Math.sin(p.facing);
  const sq = squaredUp(m, p, ux, uz);
  const pick = skillKind(ux, uz, pad.mx, pad.mz, sp, sq !== null);
  const kind = pick.kind;
  const turn = kind === 'ballroll' ? awaySide(m, p, ux, uz) : pick.turn;
  const sl = Math.hypot(pad.mx, pad.mz);
  const since = st.t - st.last;
  st.last = st.t;
  st.moves++;
  p.stamina = Math.max(0.15, p.stamina - SKILL_STAMINA * p.fatigue);
  const mv: SkillMove = {
    kind, player: p.idx, t: 0, dur: SKILL_T[kind], ux, uz, lx: -uz * turn, lz: ux * turn,
    bx: sl >= STICK_DEAD ? pad.mx / sl : -ux, bz: sl >= STICK_DEAD ? pad.mz / sl : -uz, entry: sp, grade: 'show',
    flicked: false, landX: 0, landZ: 0, chaseEnd: 0, through: kind === 'nutmeg' && sq ? sq.idx : -1, round: 1,
  };
  if (kind === 'nutmeg' && sq) mv.round = -Math.sign(-uz * (sq.pos.x - p.pos.x) + ux * (sq.pos.z - p.pos.z)) || 1;
  st.move = mv;
  mv.grade = gradeMove(m, p, st, since);
  if (mv.grade === 'perfect') p.burstT = Math.max(p.burstT, mv.dur + PERFECT_BURST);
}

/** BALL ROLL: across him away from the nearest man (+1 / -1 across his facing `ux, uz`; nobody near: +1). */
function awaySide(m: Match, p: Player, ux: number, uz: number): number {
  let best = Infinity;
  let side = 1;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.sentOff) continue;
    const d = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (d >= best) continue;
    best = d;
    side = -Math.sign(-uz * (o.pos.x - p.pos.x) + ux * (o.pos.z - p.pos.z)) || 1;
  }
  return side;
}

/** How well the move suits beating `o` (FIT_*: added to the GOOD roll's odds). */
function moveFit(p: Player, mv: SkillMove, o: Player): number {
  const ox = o.pos.x - p.pos.x;
  const oz = o.pos.z - p.pos.z;
  const ol = Math.hypot(ox, oz) || 1;
  const front = (ox * mv.ux + oz * mv.uz) / ol;
  switch (mv.kind) {
    case 'nutmeg': return o.idx === mv.through ? FIT_NUTMEG : 0;
    case 'rainbow': return o.state === 'slide' ? FIT_OVER_SLIDE : 0;
    case 'elastico':
    case 'roulette':
    case 'croqueta': return front > 0.5 ? FIT_SIDE : 0;
    case 'heelchop':
    case 'dragback': {
      const closing = -(o.vel.x * ox + o.vel.z * oz) / ol;
      return closing > 2 ? FIT_AWAY : 0;
    }
    default: return 0;
  }
}

/**
 * Who the move fools, and so its grade: every defender winding up a challenge on him (and the newest one through
 * its grace) is beaten outright (PERFECT); the others within GOOD_R m are wrong-footed on a roll (GOOD).
 */
function gradeMove(m: Match, p: Player, st: SkillState, since: number): SkillGrade {
  const thr = st.threat;
  const graceBy = thr && thr.on === p.idx && st.t <= thr.until ? thr.by : -1;
  const spam = since < SPAM_T ? SPAM_K : 1;
  let perfect: Player | null = null;
  let near = false;
  let beat = false;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.isKeeper || o.sentOff || o.wrongFootT > 0) continue;
    if (o.state !== 'move' && o.state !== 'slide') continue;
    const d = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
    if ((o.tellT > 0 || o.idx === graceBy) && d < TELL_BREAK) {
      beatPerfect(m, p, o, st);
      perfect ??= o;
      near = beat = true;
      continue;
    }
    if (d > SHOW_R) continue;
    near = true;
    if (d > GOOD_R) continue;
    // Late (he's already in: committed, or on the floor): likelier than a man still jockeying.
    const edge = (p.stat.dribbling - o.stat.defending) / 100;
    const shift = vsHuman(m.aiSkill(o.side)).cut;
    const late = o.commitT > 0 || o.state === 'slide';
    const fit = moveFit(p, st.move!, o);
    const pWin = (late ? clamp(0.5 + edge * 0.6 + shift + fit, 0.3, 0.8) : clamp(0.3 + edge * 0.6 + shift + fit, 0.12, 0.6)) * spam;
    if (m.rng.chance(pWin)) {
      wrongFoot(m, p, o);
      if (o.state === 'slide') o.slideHit = true;
      // (Beaten: he doesn't get it back off the move itself; a flick or a nutmeg till the dribbler has it again.)
      st.guard(o, st.move!.dur + GOOD_SHIELD, st.move!.kind === 'rainbow' || st.move!.kind === 'nutmeg');
      beat = true;
    }
  }
  if (perfect) st.threat = null;
  const grade: SkillGrade = perfect ? 'perfect' : beat ? 'good' : near ? 'plain' : 'show';
  if (beat) {
    p.protectT = Math.max(p.protectT, perfect ? PERFECT_PROTECT : PROTECT_T);
    m.events.push({ type: 'skill', player: p.idx });
  }
  const combo = st.chain(m, p, st.move!.kind, grade, -1, beat);
  m.events.push({ type: 'skillMove', player: p.idx, move: st.move!.kind, grade, combo, on: perfect ? perfect.idx : -1 });
  return grade;
}

/** `o` bit on it: planted the wrong way and stumbling PERFECT_BEAT s, his challenge (a slide on its way too) spent. */
function beatPerfect(m: Match, p: Player, o: Player, st: SkillState): void {
  wrongFoot(m, p, o, 2);
  const dur = clamp(o.wrongFootT, PERFECT_BEAT_MIN, PERFECT_BEAT_MAX);
  o.wrongFootT = dur;
  o.slowT = Math.max(o.slowT, dur + 0.3);
  o.tackleCooldown = Math.max(o.tackleCooldown, dur + 0.3);
  o.tellT = 0;
  o.commitT = 0;
  if (o.state === 'slide') o.slideHit = true;
  st.stumble = { idx: o.idx, at: st.t, dur };
  st.perfects++;
  // Out of it: he can't touch the ball for the move and PERFECT_SHIELD s more (a flick or a nutmeg: till it's back).
  const mv = st.move!;
  st.guard(o, mv.dur + PERFECT_SHIELD, mv.kind === 'rainbow' || mv.kind === 'nutmeg');
}

/** The move under way: how it carries him and the ball this step; it ends on time, or the moment the ball isn't his. */
function stepMove(m: Match, p: Player, pad: Pad, st: SkillState, dt: number): void {
  const mv = st.move!;
  const b = m.ball;
  const theirs = mv.flicked ? b.owner >= 0 && b.owner !== p.idx : b.owner !== p.idx;
  if (mv.player !== p.idx || p.state !== 'move' || p.sentOff || theirs || b.held) {
    st.move = null;
    return;
  }
  const u0 = clamp(mv.t / mv.dur, 0, 1);
  mv.t += dt;
  const u = clamp(mv.t / mv.dur, 0, 1);
  // (The skill cut isn't read off the stick meanwhile: the move is the stick's.)
  const as = m.ctl[p.side].assist;
  as.lastCut = as.t;
  as.hist.length = 0;
  const run = Math.atan2(mv.uz, mv.ux);
  const pace = Math.max(1, p.jogPace());
  /** Slip him sideways (mv.lx, lz) by the change in `f` (m) over this step. */
  const slip = (f: (x: number) => number) => {
    const d = f(u) - f(u0);
    p.pos.x += mv.lx * d;
    p.pos.z += mv.lz * d;
  };
  switch (mv.kind) {
    case 'roulette': {
      // On along his run, slower, while the spin carries him across: ROULETTE_SLIP m over the move (sin-shaped).
      const on = Math.min(mv.entry, MOVE_PACE_MAX) * ROULETTE_ON;
      p.wantX = (mv.ux * on) / pace;
      p.wantZ = (mv.uz * on) / pace;
      p.sprint = false;
      p.faceTarget = run;
      slip((x) => ROULETTE_SLIP * 0.5 * (1 - Math.cos(Math.PI * x)));
      break;
    }
    case 'elastico': {
      // Out with the outside of the boot (a feint the other way), then snapped back in across him, at speed.
      runAt(p, mv.ux, mv.uz, Math.max(2.5, mv.entry * ELASTICO_ON));
      p.faceTarget = run;
      slip((x) => (x < 0.35 ? -ELASTICO_FEINT * Math.sin((Math.PI / 2) * (x / 0.35)) :
        -ELASTICO_FEINT + (ELASTICO_SLIP + ELASTICO_FEINT) * smooth((x - 0.35) / 0.65)));
      break;
    }
    case 'croqueta': {
      // Foot to foot: a quick shift across him, still going.
      runAt(p, mv.ux, mv.uz, Math.min(mv.entry * CROQUETA_ON + 1, CROQUETA_MAX));
      p.faceTarget = run;
      slip((x) => CROQUETA_SLIP * smooth(x));
      break;
    }
    case 'ballroll': {
      // Standing: the sole rolls it across him, away from his man; he keeps his shape.
      p.wantX = p.wantZ = 0;
      p.sprint = false;
      p.faceTarget = run;
      slip((x) => BALL_ROLL_SLIP * smooth(x));
      break;
    }
    case 'stepover': {
      const on = Math.min(mv.entry, MOVE_PACE_MAX) * STEPOVER_ON;
      p.wantX = (mv.ux * on) / pace;
      p.wantZ = (mv.uz * on) / pace;
      p.sprint = false;
      p.faceTarget = run;
      break;
    }
    case 'dragback': {
      // Brakes on the ball, then away the other way with it, turning as he goes.
      const k = clamp((u - 0.2) / 0.5, 0, 1);
      p.wantX = (mv.bx * DRAG_PACE * k) / pace;
      p.wantZ = (mv.bz * DRAG_PACE * k) / pace;
      p.sprint = false;
      p.faceTarget = u > 0.25 ? Math.atan2(mv.bz, mv.bx) : run;
      break;
    }
    case 'heelchop': {
      // Planted, then chopped behind the standing leg and away the stick's way at pace.
      if (u < HEEL_CHOP_AT) {
        p.wantX = mv.ux * 0.2;
        p.wantZ = mv.uz * 0.2;
        p.sprint = false;
        p.faceTarget = run;
      } else {
        runAt(p, mv.bx, mv.bz, Math.max(HEEL_CHOP_MIN, mv.entry * HEEL_CHOP_ON));
        p.faceTarget = Math.atan2(mv.bz, mv.bx);
      }
      break;
    }
    case 'rainbow':
    case 'nutmeg': {
      if (!mv.flicked) {
        p.wantX = mv.ux * 0.55;
        p.wantZ = mv.uz * 0.55;
        p.sprint = false;
        p.faceTarget = run;
        if (mv.kind === 'rainbow' && mv.t >= FLICK_AT) flick(m, p, mv);
        else if (mv.kind === 'nutmeg' && mv.t >= NUTMEG_AT) nutmeg(m, p, mv);
        break;
      }
      // After it: onto where it comes down (round the man it went through), unless the stick takes him elsewhere.
      m.ctl[p.side].switchT = 0;
      let gx = mv.kind === 'nutmeg' ? b.pos.x : mv.landX;
      let gz = mv.kind === 'nutmeg' ? b.pos.z : mv.landZ;
      const o = mv.through >= 0 ? m.players[mv.through] : null;
      if (o && (o.pos.x - p.pos.x) * mv.ux + (o.pos.z - p.pos.z) * mv.uz > -0.3) {
        // Not past him yet: round his side first.
        gx = o.pos.x - mv.uz * mv.round * NUTMEG_ROUND + mv.ux * 0.6;
        gz = o.pos.z + mv.ux * mv.round * NUTMEG_ROUND + mv.uz * 0.6;
      }
      const tx = gx - p.pos.x;
      const tz = gz - p.pos.z;
      const tl = Math.hypot(tx, tz);
      const sl = Math.hypot(pad.mx, pad.mz);
      const own = sl > STICK_DEAD && tl > 0.5 && (pad.mx * tx + pad.mz * tz) / (sl * tl) < 0.5;
      if (!own && tl > 0.15) {
        p.wantX = (tx / tl) * Math.min(1, tl / 0.8);
        p.wantZ = (tz / tl) * Math.min(1, tl / 0.8);
        p.sprint = tl > 1.2;
        p.faceTarget = null;
      }
      if (b.owner === p.idx || mv.t > mv.chaseEnd) st.move = null;
      return;
    }
  }
  if (mv.t >= mv.dur) {
    st.move = null;
    // A PERFECT: off and away at once (the burst: PERFECT_BURST, Player.burstT).
    if (mv.grade === 'perfect') {
      const back = mv.kind === 'dragback' || mv.kind === 'heelchop';
      const sl = Math.hypot(pad.mx, pad.mz);
      let dx = back ? mv.bx : mv.ux;
      let dz = back ? mv.bz : mv.uz;
      if (!back && sl > STICK_DEAD && (pad.mx * dx + pad.mz * dz) / sl > -0.2) {
        dx = pad.mx / sl;
        dz = pad.mz / sl;
      }
      const v = Math.max(p.speed(), p.sprintPace() * PERFECT_KICK);
      p.vel.x = dx * v;
      p.vel.z = dz * v;
    }
  }
}

const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Run him at `v` m/s along (`dx, dz`) with the ball: a sprint when a jog can't make it. */
function runAt(p: Player, dx: number, dz: number, v: number): void {
  const jog = Math.max(1, p.jogPace() * 0.95);
  p.sprint = v > jog;
  const top = Math.max(1, p.sprint ? p.sprintPace() * 0.95 : jog);
  const k = Math.min(1, v / top);
  p.wantX = dx * k;
  p.wantZ = dz * k;
}

/** RAINBOW FLICK: the ball up off the back of his heel, over a man in front, to come down FLICK_LAND m on. */
function flick(m: Match, p: Player, mv: SkillMove): void {
  const b = m.ball;
  const y0 = Math.max(b.pos.y, BALL_R);
  const vy = Math.sqrt(2 * GRAVITY * Math.max(0.2, FLICK_APEX - y0));
  const T = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, y0 - BALL_R))) / GRAVITY;
  const vh = FLICK_LAND / T;
  b.owner = -1;
  b.vel.x = mv.ux * vh;
  b.vel.z = mv.uz * vh;
  b.vel.y = vy;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  p.kickCooldown = Math.max(p.kickCooldown, FLICK_COOL);
  m.passTarget = -1;
  mv.flicked = true;
  // (Air drag takes a little off the carry.)
  mv.landX = b.pos.x + mv.ux * FLICK_LAND * 0.94;
  mv.landZ = b.pos.z + mv.uz * FLICK_LAND * 0.94;
  mv.chaseEnd = mv.t + T + FLICK_CHASE;
}

/** NUTMEG: knocked through the man's legs (mv.through) to stop NUTMEG_PAST m beyond him; he goes round to it. */
function nutmeg(m: Match, p: Player, mv: SkillMove): void {
  const b = m.ball;
  const o = mv.through >= 0 ? m.players[mv.through] : null;
  const along = o ? Math.max(1, (o.pos.x - b.pos.x) * mv.ux + (o.pos.z - b.pos.z) * mv.uz) : 2;
  const D = along + NUTMEG_PAST;
  const v = rollSpeedFor(D);
  b.owner = -1;
  b.vel.x = mv.ux * v;
  b.vel.z = mv.uz * v;
  b.vel.y = 0;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  p.kickCooldown = Math.max(p.kickCooldown, FLICK_COOL);
  m.passTarget = -1;
  mv.flicked = true;
  mv.landX = b.pos.x + mv.ux * D;
  mv.landZ = b.pos.z + mv.uz * D;
  mv.chaseEnd = mv.t + (2 * D) / v + NUTMEG_CHASE;
}

/** The pace (m/s) a ball rolled along the grass needs to stop `d` m on (ROLL_A + ROLL_B v of rolling resistance). */
function rollSpeedFor(d: number): number {
  const dist = (v: number) => (v - (ROLL_A / ROLL_B) * Math.log(1 + (ROLL_B * v) / ROLL_A)) / ROLL_B;
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (dist(mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A goal (Match: just after the 'goal' event): by `side`'s human within SKILL_GOAL_T s of a skill that beat a man, in a
 * chain with at least one SKILL move in it (a skill cut alone doesn't make one), a SKILL GOAL. Either way the chain
 * ends with it.
 */
export function skillGoal(m: Match, side: Side, own: boolean): void {
  if (!m.human[side]) return;
  const st = m.ctl[side].skill;
  if (!own && st.combo > 0 && st.chainMoves > 0 && st.t - st.lastBeat <= SKILL_GOAL_T) {
    st.skillGoals++;
    m.events.push({ type: 'skillGoal', side, combo: st.combo });
  }
  st.combo = 0;
  st.chainMoves = 0;
  st.lastWin = -9;
  st.lastBeat = -9;
}

// ------------------------------------------------------------------ for the render and the HUD

/**
 * The skill pose for player `p` this step, for the frame (replay.ts writeFrame): his move (SKILL_CODE, its clock and
 * length, the roulette's side: +1 the stick's turn anticlockwise), a defender winding up (`load`: the tell's clock, of
 * its length) or one a PERFECT left stumbling (`stumble`); null for none.
 */
export function skillPose(m: Match, p: Player): { kind: 'move' | 'load' | 'stumble'; code: number; t: number; dur: number; turn: number } | null {
  if (p.tellT > 0) {
    const dur = tellTime(m.aiSkill(p.side));
    return { kind: 'load', code: 0, t: Math.max(0, dur - p.tellT), dur, turn: 0 };
  }
  const own = m.ctl[p.side].skill.move;
  if (own && own.player === p.idx && own.t < own.dur) {
    const sided = own.kind === 'roulette' || own.kind === 'elastico' || own.kind === 'croqueta' || own.kind === 'ballroll';
    const chop = own.kind === 'heelchop' ? (-own.uz * own.bx + own.ux * own.bz >= 0 ? 1 : -1) : 1;
    const turn = sided ? (-own.uz * own.lx + own.ux * own.lz >= 0 ? 1 : -1) : own.kind === 'nutmeg' ? own.round : chop;
    return { kind: 'move', code: SKILL_CODE[own.kind], t: own.t, dur: own.dur, turn };
  }
  const st = m.ctl[p.side === 0 ? 1 : 0].skill;
  const sb = st.stumble;
  if (sb && sb.idx === p.idx && p.wrongFootT > 0 && st.t - sb.at < sb.dur) return { kind: 'stumble', code: 0, t: st.t - sb.at, dur: sb.dur, turn: 0 };
  return null;
}

/**
 * The tell on `side`'s man right now, for the HUD: the defender winding up (or just going in, within the grace),
 * and how much of the window is left (1 .. 0). Null when there's no window open.
 */
export function skillWindow(m: Match, side: Side): { by: number; on: number; left: number; slide: boolean } | null {
  const st = m.ctl[side].skill;
  const thr = st.threat;
  if (!thr || m.phase !== 'play' || st.t > thr.until) return null;
  const span = Math.max(1e-3, thr.until - thr.at);
  return { by: thr.by, on: thr.on, left: clamp((thr.until - st.t) / span, 0, 1), slide: thr.slide };
}

/** A skill event (the session, main.ts, the commentary). */
export type SkillEvent = Extract<MatchEvent, { type: 'skillMove' | 'skillTell' | 'skillGoal' }>;
