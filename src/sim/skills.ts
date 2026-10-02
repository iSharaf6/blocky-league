import { angleDiff, clamp, dist2 } from '../core/math';
import { BALL_R, GRAVITY } from './constants';
import { PROTECT_T, vsHuman, wrongFoot } from './dribble';
import type { Match, Pad } from './match';
import type { Player } from './player';
import type { MatchEvent, Side, SkillGrade, SkillMoveKind } from './types';

/**
 * SKILL moves (the SKILL button: Q / U, gamepad LB, the touch SKILL button) for the human's man on the ball, and the
 * timing counter that makes them pay. Everything here acts only on a human-controlled carrier and on the AI defenders
 * going in on him, so AI-vs-AI play never reaches it. Randomness comes from `m.rng` only.
 *
 * The move: SKILL with the stick against his run picks it (skillKind):
 * - across his run: a ROULETTE, a spin that slips him ROULETTE_SLIP m to that side with the ball;
 * - along it: a RAINBOW FLICK, the ball flicked up over a man in front (FLICK_APEX m high), landing FLICK_LAND m on
 *   for him to run onto;
 * - back the way he came: a DRAG BACK, the sole pulling it back as he turns away with it;
 * - the stick left alone: a STEPOVER, the feint where he stands.
 * Each plays for SKILL_T s; there are SKILL_COOL s between two and each costs SKILL_STAMINA of his legs. While one
 * plays (and he isn't protected) the ball is off his foot: tackles on him come off SKILL_EXPOSED x as often.
 *
 * The counter: an AI defender going in on him from in front or beside him (ai.ts: a committed standing tackle, or a
 * chase slide) shows it first: tellTime s of wind-up (the tell: the render's crouch, the HUD's badge over him; he is
 * set meanwhile, so no skill cut fools him as a committed man) before he goes in (with a lunge, TELL_LUNGE). SKILL
 * within the window (the tell and PERFECT_GRACE s more) is a PERFECT: he bites, planted and stumbling for PERFECT_BEAT
 * s (a slide on its way goes under nothing), and the dribbler is protected for
 * PERFECT_PROTECT s with a burst of pace out of it. Otherwise a move with a defender within GOOD_R m is a GOOD when it
 * wrong-foots him on a roll like the skill cut's (half as likely straight after another move: SPAM_T / SPAM_K); a
 * plain move when it doesn't; with nobody within SHOW_R m a show-off move, nothing more. A challenge from behind him
 * (out of view, OUT_OF_VIEW) goes in at once, untold, as every challenge always did and AI-vs-AI ones still do.
 *
 * Moves that beat a man (and skill cuts / knock-ons that do: dribble.ts) within COMBO_T s of each other chain
 * ("SKILL x2", "x3"), and a goal by his side within SKILL_GOAL_T s of one is a SKILL GOAL ('skillGoal').
 */

/** How long each move plays (s): the animation, and the time the ball is off his foot. */
export const SKILL_T: Readonly<Record<SkillMoveKind, number>> = { roulette: 0.42, rainbow: 0.36, stepover: 0.34, dragback: 0.32 };
/** Names for the pop over him (Silkscreen: no hyphens). */
export const SKILL_NAMES: Readonly<Record<SkillMoveKind | 'cut' | 'knock', string>> = {
  roulette: 'ROULETTE', rainbow: 'RAINBOW FLICK', stepover: 'STEPOVER', dragback: 'DRAG BACK', cut: 'SKILL CUT', knock: 'KNOCK ON',
};
/** Frame code per move (replay.ts writeFrame: the render's skill pose). */
export const SKILL_CODE: Readonly<Record<SkillMoveKind, number>> = { roulette: 1, rainbow: 2, stepover: 3, dragback: 4 };
/** Seconds between the start of one move and the next, and the stamina each one costs (times Player.fatigue). */
export const SKILL_COOL = 0.7;
export const SKILL_STAMINA = 0.03;
/** The stick: under this it's left alone (a stepover); within FORWARD_ARC of his run a rainbow, beyond BACK_ARC a drag back. */
const STICK_DEAD = 0.3;
const FORWARD_ARC = (50 * Math.PI) / 180;
const BACK_ARC = (130 * Math.PI) / 180;
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
export const TOLD_TACKLE = 1.3;
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
export const PERFECT_BURST = 0.45;
/** GOOD: defenders within GOOD_R m can be wrong-footed; with nobody within SHOW_R m it's a show-off move. */
export const GOOD_R = 3.2;
export const SHOW_R = 4.5;
/** A move started within SPAM_T s of the last one wrong-foots SPAM_K as often ("he's seen that one"). */
const SPAM_T = 1.6;
const SPAM_K = 0.5;
/** Mid move (unprotected) tackles on him come off this much more often (dribble.ts carrierGuard). */
export const SKILL_EXPOSED = 1.3;
/** Successful skills this close together (s) chain; a goal this soon after one is a SKILL GOAL. */
export const COMBO_T = 4;
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
  /** RAINBOW FLICK: the ball is up (and where it comes down, and until when he chases it: move time). */
  flicked: boolean;
  landX: number;
  landZ: number;
  chaseEnd: number;
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
  /** A defender a PERFECT beat, stumbling (the render): who, from when (skill clock), how long. */
  stumble: { idx: number; at: number; dur: number } | null = null;
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
  chain(m: Match, p: Player, move: SkillMoveKind | 'cut' | 'knock', grade: SkillGrade = 'good', on = -1): number {
    const going = this.t - this.lastWin <= COMBO_T;
    this.combo = going ? this.combo + 1 : 1;
    this.chainMoves = (going ? this.chainMoves : 0) + (move === 'cut' || move === 'knock' ? 0 : 1);
    this.lastWin = this.t;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (move === 'cut' || move === 'knock') {
      if (this.combo >= 2) m.events.push({ type: 'skillMove', player: p.idx, move, grade, combo: this.combo, on });
    }
    return this.combo;
  }

  /** Tackles on carrier `idx` this step: SKILL_EXPOSED while his move plays, else 1 (dribble.ts carrierGuard). */
  exposure(idx: number): number {
    const mv = this.move;
    return mv && mv.player === idx && mv.t < mv.dur && !mv.flicked ? SKILL_EXPOSED : 1;
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

/** `o` winds up his challenge on the human's carrier `c` (a slide or a standing tackle): the tell, and the window. */
export function startTell(m: Match, o: Player, c: Player, slide: boolean): void {
  const st = m.ctl[c.side].skill;
  const t = tellTime(m.aiSkill(o.side));
  o.tellT = t;
  o.tellSlide = slide;
  o.commitT = 0;
  st.threat = { by: o.idx, on: c.idx, at: st.t, until: st.t + t + PERFECT_GRACE, slide };
  st.tells++;
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
}

/** Which move the stick picks against his run (`ux, uz`), and the roulette's side (+1: the stick's turn is anticlockwise). */
export function skillKind(ux: number, uz: number, mx: number, mz: number): { kind: SkillMoveKind; turn: number } {
  if (Math.hypot(mx, mz) < STICK_DEAD) return { kind: 'stepover', turn: 1 };
  const a = angleDiff(Math.atan2(uz, ux), Math.atan2(mz, mx));
  if (Math.abs(a) < FORWARD_ARC) return { kind: 'rainbow', turn: 1 };
  if (Math.abs(a) > BACK_ARC) return { kind: 'dragback', turn: 1 };
  return { kind: 'roulette', turn: Math.sign(a) || 1 };
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
  const { kind, turn } = skillKind(ux, uz, pad.mx, pad.mz);
  const sl = Math.hypot(pad.mx, pad.mz);
  const since = st.t - st.last;
  st.last = st.t;
  st.moves++;
  p.stamina = Math.max(0.15, p.stamina - SKILL_STAMINA * p.fatigue);
  const mv: SkillMove = {
    kind, player: p.idx, t: 0, dur: SKILL_T[kind], ux, uz, lx: -uz * turn, lz: ux * turn,
    bx: sl >= STICK_DEAD ? pad.mx / sl : -ux, bz: sl >= STICK_DEAD ? pad.mz / sl : -uz, entry: sp, grade: 'show',
    flicked: false, landX: 0, landZ: 0, chaseEnd: 0,
  };
  st.move = mv;
  mv.grade = gradeMove(m, p, st, since);
  if (mv.grade === 'perfect') p.burstT = Math.max(p.burstT, mv.dur + PERFECT_BURST);
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
    const pWin = (late ? clamp(0.5 + edge * 0.6 + shift, 0.3, 0.7) : clamp(0.3 + edge * 0.6 + shift, 0.12, 0.5)) * spam;
    if (m.rng.chance(pWin)) {
      wrongFoot(m, p, o);
      if (o.state === 'slide') o.slideHit = true;
      beat = true;
    }
  }
  if (perfect) st.threat = null;
  const grade: SkillGrade = perfect ? 'perfect' : beat ? 'good' : near ? 'plain' : 'show';
  let combo = 0;
  if (beat) {
    p.protectT = Math.max(p.protectT, perfect ? PERFECT_PROTECT : PROTECT_T);
    combo = st.chain(m, p, st.move!.kind, grade);
    m.events.push({ type: 'skill', player: p.idx });
  }
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
  mv.t += dt;
  const u = clamp(mv.t / mv.dur, 0, 1);
  // (The skill cut isn't read off the stick meanwhile: the move is the stick's.)
  const as = m.ctl[p.side].assist;
  as.lastCut = as.t;
  as.hist.length = 0;
  const run = Math.atan2(mv.uz, mv.ux);
  const pace = Math.max(1, p.jogPace());
  switch (mv.kind) {
    case 'roulette': {
      // On along his run, slower, while the spin carries him across: ROULETTE_SLIP m over the move (sin-shaped).
      const on = Math.min(mv.entry, MOVE_PACE_MAX) * ROULETTE_ON;
      p.wantX = (mv.ux * on) / pace;
      p.wantZ = (mv.uz * on) / pace;
      p.sprint = false;
      p.faceTarget = run;
      const slip = ROULETTE_SLIP * (Math.PI / 2) * Math.sin(Math.PI * u) * (dt / mv.dur);
      p.pos.x += mv.lx * slip;
      p.pos.z += mv.lz * slip;
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
    case 'rainbow': {
      if (!mv.flicked) {
        p.wantX = mv.ux * 0.55;
        p.wantZ = mv.uz * 0.55;
        p.sprint = false;
        p.faceTarget = run;
        if (mv.t >= FLICK_AT) flick(m, p, mv);
        break;
      }
      // After it: onto where it comes down, unless the stick takes him somewhere else.
      m.ctl[p.side].switchT = 0;
      const tx = mv.landX - p.pos.x;
      const tz = mv.landZ - p.pos.z;
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
  if (mv.t >= mv.dur) st.move = null;
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

/**
 * A goal (Match: just after the 'goal' event): by `side`'s human within SKILL_GOAL_T s of a skill that beat a man, in a
 * chain with at least one SKILL move in it (a skill cut alone doesn't make one), a SKILL GOAL. Either way the chain
 * ends with it.
 */
export function skillGoal(m: Match, side: Side, own: boolean): void {
  if (!m.human[side]) return;
  const st = m.ctl[side].skill;
  if (!own && st.combo > 0 && st.chainMoves > 0 && st.t - st.lastWin <= SKILL_GOAL_T) {
    st.skillGoals++;
    m.events.push({ type: 'skillGoal', side, combo: st.combo });
  }
  st.combo = 0;
  st.chainMoves = 0;
  st.lastWin = -9;
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
    const turn = own.kind === 'roulette' ? (-own.uz * own.lx + own.ux * own.lz >= 0 ? 1 : -1) : 1;
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
