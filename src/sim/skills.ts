import { angleDiff, clamp, dist2 } from '../core/math';
import { BALL_R, GRAVITY, HALF_L, HALF_W, ROLL_A, ROLL_B } from './constants';
import { LINE_GAP, PROTECT_T, straightRead, vsHuman, wrongFoot } from './dribble';
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
 *   a RAINBOW FLICK, the ball flicked up over the man in front (FLICK_CLEAR m over him at least: a slide too), landing
 *   FLICK_BEYOND m beyond him for him to run round onto (see FLICK_AT);
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
 *
 * 2026-10-04, the owner: "skill button in the game feels utterly useless to use". Measured with the casual touch bot
 * (12 matches, NORMAL): 16.3 presses a match, 22% of them did nothing at all (the cooldown), and of the moves that did
 * play 41% were a plain or show-off feint that slowed him down with the ball off his foot (tackles on him 1.3 x as
 * likely); with his thumb pushing the way he runs every press was a rainbow flick, over nobody. Now EVERY press pays:
 * - FLAIR (SkillState.flair, FLAIR_MAX pips, one back every FLAIR_REGEN_S s on the ball, one for a PERFECT, half of one
 *   for a man skinned): a move with a pip to spend is CHARGED: he is not exposed while it plays, it fools a man near him
 *   far more often (CHARGED_WIN), and he comes out of it with a BURST of pace the way the stick points (EXIT_KICK,
 *   EXIT_BURST). With no pip left the move still plays, as it always did, without the burst (so it can't be spammed).
 * - The stick along his run reads what is in front of him: a man sliding in gets a SOMBRERO (flicked low over him), a
 *   man squared up a NUTMEG, a man standing off a RAINBOW FLICK, and open grass a BURST (`boost`: a step and away at a
 *   sprint and a bit).
 * - The PERFECT window is the tell and perfectGrace(skill) more: 0.64 s on EASY, 0.52 on NORMAL (it was 0.42 and 0.38).
 * - Two more moves off other buttons: the FAKE SHOT (PASS while SHOOT is charging: fakeShot) and the FLICK ON (SKILL as
 *   a pass arrives: the first touch goes the stick's way and he is off after it).
 */

/** How long each move plays (s): the animation, and the time the ball is off his foot. */
export const SKILL_T: Readonly<Record<SkillMoveKind, number>> = {
  roulette: 0.42, rainbow: 0.36, stepover: 0.34, dragback: 0.32, elastico: 0.3, croqueta: 0.26, nutmeg: 0.3, heelchop: 0.28, ballroll: 0.36,
  boost: 0.24, sombrero: 0.3, fakeshot: 0.36, flickon: 0.22,
};
/** Names for the pop over him (Silkscreen: no hyphens). */
export const SKILL_NAMES: Readonly<Record<SkillMoveKind | ChainKind, string>> = {
  roulette: 'ROULETTE', rainbow: 'RAINBOW FLICK', stepover: 'STEPOVER', dragback: 'DRAG BACK', elastico: 'ELASTICO', croqueta: 'LA CROQUETA',
  nutmeg: 'NUTMEG', heelchop: 'HEEL CHOP', ballroll: 'BALL ROLL', boost: 'BURST', sombrero: 'SOMBRERO', fakeshot: 'FAKE SHOT',
  flickon: 'FLICK ON', cut: 'SKILL CUT', knock: 'KNOCK ON', past: 'SKINNED HIM',
};
/** The chain's other links: a skill cut and a knock-on (dribble.ts), and dribbling clean past a man (`past`: watchPast). */
export type ChainKind = 'cut' | 'knock' | 'past';
/** Frame code per move (replay.ts writeFrame: the render's skill pose). */
export const SKILL_CODE: Readonly<Record<SkillMoveKind, number>> = {
  roulette: 1, rainbow: 2, stepover: 3, dragback: 4, elastico: 5, croqueta: 6, nutmeg: 7, heelchop: 8, ballroll: 9,
  boost: 10, sombrero: 11, fakeshot: 12, flickon: 13,
};
/** Seconds between the start of one move and the next, and the stamina each one costs (times Player.fatigue). */
export const SKILL_COOL = 0.7;
export const SKILL_STAMINA = 0.03;
/**
 * FLAIR: the pips a move spends, one each, to be CHARGED (see the file comment). FLAIR_MAX of them, full at kick-off,
 * one back every FLAIR_REGEN_S s of open play. A PERFECT gives its pip back (FLAIR_PERFECT), a GOOD half of it
 * (FLAIR_GOOD), and a man skinned (the chain's `past` link) FLAIR_PAST more.
 */
export const FLAIR_MAX = 3;
export const FLAIR_REGEN_S = 4;
export const FLAIR_PERFECT = 1;
export const FLAIR_GOOD = 0.5;
export const FLAIR_PAST = 0.5;
/**
 * Out of a CHARGED move he goes at EXIT_KICK of his sprint at once, the way the stick points (else the move's own way),
 * and for EXIT_BURST s he is quicker than a sprint (Player.burstT): by the move's grade. (A PERFECT's were always
 * PERFECT_KICK and PERFECT_BURST.)
 */
export const EXIT_KICK: Readonly<Record<SkillGrade, number>> = { perfect: 0.92, good: 0.88, plain: 0.82, show: 0.78 };
export const EXIT_BURST: Readonly<Record<SkillGrade, number>> = { perfect: 0.9, good: 0.65, plain: 0.5, show: 0.4 };
/** A man skinned (`past`) is left behind: this long (s) quicker than a sprint. */
export const PAST_BURST = 0.35;
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
/** The least grace (LEGEND's); perfectGrace is each difficulty's. */
export const PERFECT_GRACE = 0.06;
/**
 * The grace after the tell by the AI's difficulty: EASY 0.28 s, NORMAL 0.2, HARD 0.12, LEGEND 0.06 (it was 0.06 for
 * all: the casual bot, reacting in 0.2 to 0.45 s to a 0.32 s tell, was too late for one in three). The man is already
 * lunging through it: SKILL then is a dodge of the lunge, as late as it can be left.
 */
export function perfectGrace(skill: number): number {
  return clamp(0.28 - (skill - 0.6) * (0.08 / 1.2), PERFECT_GRACE, 0.28);
}
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
/**
 * A CHARGED move's GOOD roll: its odds start CHARGED_WIN higher (a man still jockeying: 0.48 against 0.3; one already
 * in: 0.68 against 0.5) and may reach CHARGED_TOP more (0.72 / 0.92 against 0.6 / 0.8); and "he's seen that one"
 * (SPAM_K) is for moves with no pip behind them: the pips are what stops a CHARGED one being mashed.
 */
export const CHARGED_WIN = 0.18;
const CHARGED_TOP = 0.12;
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
/**
 * RAINBOW FLICK (2026-10-03, the owner: "rainbow flick is basically failing dosnt go over the player goes back"): flicked
 * up FLICK_AT s into the move (he brakes on it first, FLICK_BRAKE of his run), the way the stick points (else his run).
 * It goes over the man in front of him (the nearest within FLICK_LANE m of its line, up to FLICK_SEEK m on) at least
 * FLICK_CLEAR m high (a man is drawn up to ~2.15 m tall on a landscape phone: render/characters.ts screenCharK) and comes
 * down FLICK_BEYOND m beyond him: FLICK_LAND_MIN..FLICK_LAND_MAX m from where it left the
 * boot (FLICK_LAND_MIN with nobody there), its top FLICK_APEX_MIN..FLICK_APEX_MAX m. He can't take it back for
 * FLICK_COOL s. Measured before: it went up 2.1 m and came down 5.5 m on whatever was there, so a man 5 m off headed it
 * straight back, one 1.5 m off had it pass him on the grass before it rose, and a sprinting dribbler ran under it and
 * left it behind him.
 */
export const FLICK_AT = 0.1;
const FLICK_BRAKE = 0.15;
export const FLICK_CLEAR = 2.9;
export const FLICK_BEYOND = 3.6;
export const FLICK_LAND_MIN = 4.5;
export const FLICK_LAND_MAX = 8.5;
export const FLICK_APEX_MIN = 2.1;
export const FLICK_APEX_MAX = 3.6;
const FLICK_LANE = 1.6;
const FLICK_SEEK = 6;
/** It leaves him at this share of his own pace at least (he's braking on it): it never drops behind him. */
const FLICK_AWAY = 0.95;
/** ... where he'll be (s ahead, at his pace now) as it goes over him, and how far on he'll have turned and gone after it (m). */
const FLICK_LOOK = 0.5;
const FLICK_STEP = 0.5;
const FLICK_DRIFT = 1;
const FLICK_COOL = 0.3;
/**
 * The man it goes over has to turn round to it: planted (Player.wrongFootT) FLICK_PLANT s as it goes up, then slowed
 * (Player.slowT) to FLICK_TURN s. (Measured: left alone, a man 5 m off ran back with the ball and had it drop on his head.)
 */
const FLICK_PLANT = 0.55;
const FLICK_TURN = 0.7;
/** It comes down this far (m) inside the touchlines and goal lines at least: its bounce and roll stay in play too. */
const FLICK_IN = 3.5;
/** ... and he's after it until he has it, someone else does, or this long (s) after it lands. */
const FLICK_CHASE = 0.8;
/**
 * Going after his flick or nutmeg he's run onto it (the stick only takes him elsewhere pulled back against the move,
 * CHASE_OWN): flat out to CHASE_UNDER m short of where a flick comes down, but never level with the ball as it flies
 * (CHASE_BEHIND m behind it at least: run under it and past, it would drop behind him); on the grass at it flat out with
 * CHASE_LEAD s of lead. Round the man it went over or through until he's past him.
 */
const CHASE_OWN = -0.3;
const CHASE_UNDER = 0.5;
const CHASE_BEHIND = 0.4;
const CHASE_LEAD = 0.25;
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
/** ... and takes it no sooner than this far (m) beyond him. */
const NUTMEG_BEYOND = 0.5;
const NUTMEG_CHASE = 0.8;
/**
 * A move that fits the moment fools a man more often (gradeMove's GOOD roll): a nutmeg on the man squared up, a rainbow
 * over a slide, a side move (elastico, roulette, la croqueta) past a man in front, a heel chop or drag back away from a
 * man closing in. Added to the roll's odds.
 */
const FIT_NUTMEG = 0.15;
const FIT_OVER_SLIDE = 0.25;
const FIT_SIDE = 0.1;
const FIT_AWAY = 0.12;
/** ... a FAKE SHOT in range of goal (FAKE_RANGE m) on a man between him and it, a FLICK ON with a man tight on him. */
const FIT_FAKE = 0.2;
const FAKE_RANGE = 30;
const FIT_FIRST = 0.15;
/**
 * BURST (`boost`): the stick along his run with nobody in the way. A step, then away: he is at BOOST_KICK of his sprint
 * BOOST_AT of the way into the move and quicker than a sprint for BOOST_BURST s after it (CHARGED; with no pip it is a
 * plain step and a jog on).
 */
const BOOST_AT = 0.35;
const BOOST_KICK = 0.95;
const BOOST_BURST = 1.0;
/**
 * SOMBRERO: the flick over a man sliding in (or winding up a slide) within SOMBRERO_R m along the run: lower and shorter
 * than a rainbow (he is on the grass): SOMBRERO_CLEAR m over him, down SOMBRERO_BEYOND m beyond him.
 */
const SOMBRERO_R = 5;
const SOMBRERO_CLEAR = 1.5;
const SOMBRERO_BEYOND = 2.4;
const SOMBRERO_APEX_MIN = 1.3;
const SOMBRERO_LAND_MIN = 3.2;
/**
 * FAKE SHOT: he shapes to strike it for FAKE_AT of the move, then drags it FAKE_SLIP m across him (the stick's side,
 * else away from the nearest man) at FAKE_ON of his pace going in.
 */
const FAKE_AT = 0.42;
const FAKE_SLIP = 1.25;
const FAKE_ON = 0.5;
/**
 * FLICK ON: SKILL pressed with a pass on its way to him (within FLICK_ON_BUF s of taking it) is played the moment he
 * has it: knocked FLICK_ON_D m the stick's way (else his run) for him to run onto.
 */
export const FLICK_ON_BUF = 0.7;
const FLICK_ON_D = 3.4;

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
  /** NUTMEG / RAINBOW FLICK: the man it goes through or over (-1: none), and the side (+1 / -1 across) he goes round him. */
  through: number;
  round: number;
  /** RAINBOW FLICK / NUTMEG: the way the ball goes (the stick, else his run); a flick has come down (its first bounce). */
  fx: number;
  fz: number;
  landed: boolean;
  /** It spent a pip of FLAIR (or was a PERFECT): not exposed while it plays, and a burst out of it (EXIT_KICK). */
  charged: boolean;
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
  /** FLAIR: the pips he has to spend (0..FLAIR_MAX, see FLAIR_MAX). */
  flair = FLAIR_MAX;
  /** When SKILL was last pressed with a pass on its way to him (the FLICK ON's buffer: FLICK_ON_BUF). */
  flickBuf = -9;
  /** This match: moves that spent a pip (CHARGED), and presses that did nothing at all (the cooldown, a busy button). */
  charged = 0;
  wasted = 0;
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
    if (move === 'past' && straightRead(m, p) <= 0) {
      // Skinned him: a little flair back, and he is away from him for a moment. (Not for a man just running one
      // straight line through them, dribble.ts straightRead: that is no dribble.)
      this.flair = Math.min(FLAIR_MAX, this.flair + FLAIR_PAST);
      p.burstT = Math.max(p.burstT, PAST_BURST);
    }
    return this.combo;
  }

  /**
   * Tackles on carrier `idx` this step: SKILL_EXPOSED while a move with no FLAIR behind it plays (the ball is off his
   * foot), else 1 (dribble.ts carrierGuard). A CHARGED move keeps it as safe as his dribble.
   */
  exposure(idx: number): number {
    const mv = this.move;
    return mv && mv.player === idx && mv.t < mv.dur && !mv.flicked && !mv.charged ? SKILL_EXPOSED : 1;
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
  // (A man running one straight line, dribble.ts straightRead, has the next man in his way wind up sooner: LINE_GAP.)
  return st.threat === null && st.t - st.tellAt >= TELL_GAP * (1 - LINE_GAP * straightRead(m, c)) && c.ballT >= DUEL_SETTLE;
}

/** `o` winds up his challenge on the human's carrier `c` (a slide or a standing tackle): the tell, and the window. */
export function startTell(m: Match, o: Player, c: Player, slide: boolean, duel = false): void {
  const st = m.ctl[c.side].skill;
  const t = tellTime(m.aiSkill(o.side));
  o.tellT = t;
  o.tellSlide = slide;
  o.tellDuel = duel;
  o.commitT = 0;
  st.threat = { by: o.idx, on: c.idx, at: st.t, until: st.t + t + perfectGrace(m.aiSkill(o.side)), slide };
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
  st.flair = Math.min(FLAIR_MAX, st.flair + dt / FLAIR_REGEN_S);
  if (st.threat && st.t > st.threat.until) st.threat = null;
  const b = m.ball;
  if (pad.skill && !h.prev.skill) {
    // With a pass on its way to him the press is kept for his first touch (the FLICK ON).
    if (b.owner < 0 && !b.held && m.passTarget === p.idx) st.flickBuf = st.t;
    else if (!trySkill(m, p, pad, st)) st.wasted++;
  } else if (b.owner === p.idx && !b.held && st.t - st.flickBuf <= FLICK_ON_BUF) {
    st.flickBuf = -9;
    trySkill(m, p, pad, st, 'flickon');
  }
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

/** The men a flick or a push along (`fx, fz`) from `p` would meet: within `reach` m on, `lane` m of its line. */
function laneMan(m: Match, p: Player, fx: number, fz: number, reach: number, lane: number, sliding = false): Player | null {
  let best: Player | null = null;
  let bd = reach;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.isKeeper || o.sentOff) continue;
    if (sliding && o.state !== 'slide' && !(o.tellT > 0 && o.tellSlide)) continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const along = ox * fx + oz * fz;
    if (along < 0.3 || along > bd || Math.abs(-fz * ox + fx * oz) > lane) continue;
    bd = along;
    best = o;
  }
  return best;
}

/**
 * A SKILL press with the ball at his feet: the move the stick picks (skillKind), or `force` (a FAKE SHOT, a FLICK ON).
 * False when nothing came of it (not his ball, a move under way, the cooldown, a button busy).
 */
function trySkill(m: Match, p: Player, pad: Pad, st: SkillState, force?: SkillMoveKind): boolean {
  const b = m.ball;
  if (b.owner !== p.idx || b.held || p.state !== 'move' || p.sentOff) return false;
  if (st.move || st.t - st.last < SKILL_COOL) return false;
  // (Charging a shot or a pass, or aiming one, the buttons are busy: no move. A FAKE SHOT is the shot called off.)
  if (force !== 'fakeshot' && (pad.shoot || pad.pass || pad.through || m.ctl[p.side].passMode !== null)) return false;
  const sp = p.speed();
  const ux = sp > 1 ? p.vel.x / sp : Math.cos(p.facing);
  const uz = sp > 1 ? p.vel.z / sp : Math.sin(p.facing);
  const sl = Math.hypot(pad.mx, pad.mz);
  const pushed = sl >= STICK_DEAD;
  const sq = force ? null : squaredUp(m, p, ux, uz);
  const pick = skillKind(ux, uz, pad.mx, pad.mz, sp, sq !== null);
  let kind = force ?? pick.kind;
  // (A flick, a burst and a flick-on go the way the stick points when it's pushed: the run can still be coming round to it.)
  const fx = pushed ? pad.mx / sl : ux;
  const fz = pushed ? pad.mz / sl : uz;
  if (kind === 'rainbow') {
    // The stick along his run reads what is in front of him: a man sliding in, a man standing off, or open grass.
    if (laneMan(m, p, fx, fz, SOMBRERO_R, FLICK_LANE, true)) kind = 'sombrero';
    else if (!laneMan(m, p, fx, fz, FLICK_SEEK, FLICK_LANE)) kind = 'boost';
  }
  // The side a FAKE SHOT is dragged to: the stick's when it's pushed across him, else away from the nearest man.
  const across = pushed ? -uz * pad.mx + ux * pad.mz : 0;
  const turn = kind === 'ballroll' || (kind === 'fakeshot' && (!pushed || Math.abs(across) < sl * 0.35)) ? awaySide(m, p, ux, uz)
    : kind === 'fakeshot' ? Math.sign(across) || 1 : pick.turn;
  const since = st.t - st.last;
  st.last = st.t;
  st.moves++;
  // (A move is a change of line: the AI's read of a straight run, dribble.ts straightRead, starts again.)
  m.ctl[p.side].assist.line = 0;
  p.stamina = Math.max(0.15, p.stamina - SKILL_STAMINA * p.fatigue);
  const own = kind === 'rainbow' || kind === 'sombrero' || kind === 'boost' || kind === 'flickon';
  const mv: SkillMove = {
    kind, player: p.idx, t: 0, dur: SKILL_T[kind], ux, uz, lx: -uz * turn, lz: ux * turn,
    bx: pushed ? pad.mx / sl : -ux, bz: pushed ? pad.mz / sl : -uz, entry: sp, grade: 'show',
    flicked: false, landX: 0, landZ: 0, chaseEnd: 0, through: kind === 'nutmeg' && sq ? sq.idx : -1, round: 1,
    fx: own ? fx : ux, fz: own ? fz : uz, landed: false, charged: false,
  };
  if (kind === 'nutmeg' && sq) mv.round = -Math.sign(-uz * (sq.pos.x - p.pos.x) + ux * (sq.pos.z - p.pos.z)) || 1;
  // A pip of FLAIR behind it: CHARGED (a PERFECT is, whatever he has left: gradeMove).
  if (st.flair >= 1) {
    st.flair -= 1;
    mv.charged = true;
    st.charged++;
  }
  st.move = mv;
  mv.grade = gradeMove(m, p, st, since);
  if (mv.grade === 'perfect') p.burstT = Math.max(p.burstT, mv.dur + PERFECT_BURST);
  else if (mv.charged && kind === 'boost') p.burstT = Math.max(p.burstT, mv.dur + BOOST_BURST);
  return true;
}

/**
 * FAKE SHOT (Match.applyHuman: PASS pressed while SHOOT is charging, the ball at his feet): the shot is called off for a
 * feint. He shapes to strike it, then drags it across him and is away. True when it played (the caller drops the shot).
 */
export function fakeShot(m: Match, p: Player, pad: Pad): boolean {
  return trySkill(m, p, pad, m.ctl[p.side].skill, 'fakeshot');
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
function moveFit(m: Match, p: Player, mv: SkillMove, o: Player): number {
  const ox = o.pos.x - p.pos.x;
  const oz = o.pos.z - p.pos.z;
  const ol = Math.hypot(ox, oz) || 1;
  const front = (ox * mv.ux + oz * mv.uz) / ol;
  switch (mv.kind) {
    case 'nutmeg': return o.idx === mv.through ? FIT_NUTMEG : 0;
    case 'rainbow':
    case 'sombrero': return o.state === 'slide' ? FIT_OVER_SLIDE : 0;
    // A man beside him or behind him is left standing by a burst; one in front isn't fooled by it.
    case 'boost': return front < 0.3 ? FIT_AWAY : 0;
    case 'fakeshot': {
      // In range of goal, the man between him and it buys the shot.
      const gx = m.attackDir(p.side) * HALF_L - p.pos.x;
      const gz = -p.pos.z;
      const gl = Math.hypot(gx, gz) || 1;
      return gl < FAKE_RANGE && (ox * gx + oz * gz) / (ol * gl) > 0.5 ? FIT_FAKE : 0;
    }
    case 'flickon': return ol < 2.5 ? FIT_FIRST : 0;
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
    const mv = st.move!;
    const fit = moveFit(m, p, mv, o);
    // (A CHARGED move fools him more often: CHARGED_WIN, up to CHARGED_TOP more.)
    const up = mv.charged ? CHARGED_WIN : 0;
    const top = mv.charged ? CHARGED_TOP : 0;
    const pWin = (late ? clamp(0.5 + up + edge * 0.6 + shift + fit, 0.3, 0.8 + top) : clamp(0.3 + up + edge * 0.6 + shift + fit, 0.12, 0.6 + top)) *
      (mv.charged ? 1 : spam);
    // (A sombrero over the man on the grass: his slide goes under it, whatever the roll says.)
    const under = mv.kind === 'sombrero' && o.state === 'slide' && mv.charged;
    if (m.rng.chance(pWin) || under) {
      wrongFoot(m, p, o);
      if (o.state === 'slide') o.slideHit = true;
      // (Beaten: he doesn't get it back off the move itself; a flick or a nutmeg till the dribbler has it again.)
      st.guard(o, mv.dur + GOOD_SHIELD, offFoot(mv.kind));
      beat = true;
    }
  }
  if (perfect) st.threat = null;
  const grade: SkillGrade = perfect ? 'perfect' : beat ? 'good' : near ? 'plain' : 'show';
  const mv = st.move!;
  if (perfect) {
    // A PERFECT is CHARGED whatever he had left, and costs him nothing.
    if (mv.charged) st.flair = Math.min(FLAIR_MAX, st.flair + FLAIR_PERFECT);
    else st.charged++;
    mv.charged = true;
  } else if (beat && mv.charged) st.flair = Math.min(FLAIR_MAX, st.flair + FLAIR_GOOD);
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
  st.guard(o, mv.dur + PERFECT_SHIELD, offFoot(mv.kind));
}

/** The moves that send the ball off his foot on purpose, for him to run onto (a flick, a nutmeg, a flick-on). */
function offFoot(kind: SkillMoveKind): boolean {
  return kind === 'rainbow' || kind === 'sombrero' || kind === 'nutmeg' || kind === 'flickon';
}

/** The flicks: up over a man (a rainbow), or low over one on the grass (a sombrero). */
function lofted(kind: SkillMoveKind): boolean {
  return kind === 'rainbow' || kind === 'sombrero';
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
    case 'boost': {
      // A step (the shoulders drop), then away: at a sprint the moment the step is done (a CHARGED one: BOOST_KICK).
      if (u < BOOST_AT) runAt(p, mv.fx, mv.fz, Math.max(2.5, mv.entry * 0.85));
      else {
        runAt(p, mv.fx, mv.fz, 99);
        if (u0 < BOOST_AT && mv.charged) {
          const v = Math.max(p.speed(), p.sprintPace() * BOOST_KICK);
          p.vel.x = mv.fx * v;
          p.vel.z = mv.fz * v;
        }
      }
      p.faceTarget = Math.atan2(mv.fz, mv.fx);
      break;
    }
    case 'fakeshot': {
      // Planted, shaping to strike it; then the sole drags it across him and he goes with it.
      if (u < FAKE_AT) {
        p.wantX = mv.ux * 0.15;
        p.wantZ = mv.uz * 0.15;
        p.sprint = false;
      } else runAt(p, mv.ux, mv.uz, Math.max(2.2, mv.entry * FAKE_ON));
      p.faceTarget = run;
      slip((x) => FAKE_SLIP * smooth((x - FAKE_AT) / (1 - FAKE_AT)));
      break;
    }
    case 'flickon': {
      if (!mv.flicked) {
        // His first touch: knocked on the stick's way, and he turns after it.
        p.faceTarget = Math.atan2(mv.fz, mv.fx);
        runAt(p, mv.fx, mv.fz, 99);
        knockTo(m, p, mv, FLICK_ON_D);
        break;
      }
      chase(m, p, pad, st, mv);
      return;
    }
    case 'rainbow':
    case 'sombrero':
    case 'nutmeg': {
      if (!mv.flicked) {
        // Braking on it, the sole rolling it up the back of his standing leg (a flick), or squared up to it (a nutmeg).
        const k = lofted(mv.kind) ? FLICK_BRAKE : 0.55;
        p.wantX = mv.fx * k;
        p.wantZ = mv.fz * k;
        p.sprint = false;
        p.faceTarget = Math.atan2(mv.fz, mv.fx);
        if (lofted(mv.kind) && mv.t >= FLICK_AT) flick(m, p, mv, st);
        else if (mv.kind === 'nutmeg' && mv.t >= NUTMEG_AT) nutmeg(m, p, mv);
        break;
      }
      chase(m, p, pad, st, mv);
      return;
    }
  }
  if (mv.t >= mv.dur) {
    st.move = null;
    exitBurst(p, pad, mv);
  }
}

/**
 * Out of a CHARGED move (a PERFECT always is): off and away at once, EXIT_KICK of his sprint the way the stick points
 * (a drag back or a heel chop: the way it turned him), and quicker than a sprint for EXIT_BURST s (Player.burstT).
 */
function exitBurst(p: Player, pad: Pad, mv: SkillMove): void {
  if (!mv.charged) return;
  const back = mv.kind === 'dragback' || mv.kind === 'heelchop';
  const sl = Math.hypot(pad.mx, pad.mz);
  let dx = back ? mv.bx : mv.kind === 'boost' ? mv.fx : mv.ux;
  let dz = back ? mv.bz : mv.kind === 'boost' ? mv.fz : mv.uz;
  if (!back && sl > STICK_DEAD && (pad.mx * dx + pad.mz * dz) / sl > -0.2) {
    dx = pad.mx / sl;
    dz = pad.mz / sl;
  }
  const v = Math.max(p.speed(), p.sprintPace() * EXIT_KICK[mv.grade]);
  p.vel.x = dx * v;
  p.vel.z = dz * v;
  p.burstT = Math.max(p.burstT, EXIT_BURST[mv.grade]);
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

/**
 * RAINBOW FLICK: the ball up off the back of his heel the way it's going (mv.fx, fz), over the man in front of him at
 * least FLICK_CLEAR m high, to come down FLICK_BEYOND m beyond him (see FLICK_AT). A crowd's gasp when it goes over a man.
 */
function flick(m: Match, p: Player, mv: SkillMove, st: SkillState): void {
  const b = m.ball;
  const fx = mv.fx;
  const fz = mv.fz;
  const y0 = Math.max(b.pos.y, BALL_R);
  // The man it goes over: the nearest of theirs in its lane (where he'll be as it passes him, roughly).
  let over: Player | null = null;
  let oAlong = FLICK_SEEK;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.sentOff || o.isKeeper) continue;
    const ox = o.pos.x + o.vel.x * FLICK_LOOK - b.pos.x;
    const oz = o.pos.z + o.vel.z * FLICK_LOOK - b.pos.z;
    const along = ox * fx + oz * fz;
    if (along < -0.2 || along > oAlong || Math.abs(-fz * ox + fx * oz) > FLICK_LANE) continue;
    oAlong = along;
    over = o;
  }
  // (A sombrero: lower and shorter, over a man on the grass.)
  const low = mv.kind === 'sombrero';
  const clear = low ? SOMBRERO_CLEAR : FLICK_CLEAR;
  const landMin = low ? SOMBRERO_LAND_MIN : FLICK_LAND_MIN;
  let D = over ? clamp(Math.max(0, oAlong) + (low ? SOMBRERO_BEYOND : FLICK_BEYOND), landMin, FLICK_LAND_MAX) : landMin;
  // Never out of play: shortened to land inside the lines.
  const room = Math.max(1, roomAlong(b.pos.x, b.pos.z, fx, fz, FLICK_IN));
  D = Math.min(D, room);
  /** Its top for a carry of `d` m: high enough over him (a parabola from the boot to the grass, 4 s (1 - s) of its rise at s). */
  const apexFor = (d: number) => {
    let a = low ? SOMBRERO_APEX_MIN : FLICK_APEX_MIN;
    if (over) {
      // (Over him wherever he is as it passes: from FLICK_STEP m nearer, stepping in, to FLICK_DRIFT m on, turning after it.)
      const lo = clamp((Math.max(0.3, oAlong) - FLICK_STEP) / d, 0.12, 0.88);
      const hi = clamp((Math.max(0.3, oAlong) + FLICK_DRIFT) / d, 0.12, 0.88);
      const f = Math.min(4 * lo * (1 - lo), 4 * hi * (1 - hi));
      a = Math.max(a, y0 + (clear - y0) / f);
    }
    return Math.min(a, FLICK_APEX_MAX);
  };
  const flight = (a: number) => {
    const vy0 = Math.sqrt(2 * GRAVITY * Math.max(0.2, a - y0));
    return { vy: vy0, T: (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * Math.max(0, y0 - BALL_R))) / GRAVITY };
  };
  let { vy, T } = flight(apexFor(D));
  // Going away from him however fast he came in (a longer carry, not a ball he runs under and past), as long as it still
  // clears the man: over him comes first (he brakes for it, chase).
  const atLeast = p.speed() * FLICK_AWAY;
  if (D / T < atLeast) {
    const D2 = Math.min(room, atLeast * T);
    const a2 = apexFor(D2);
    const sMan = over ? clamp(Math.max(0.3, oAlong) / D2, 0, 1) : 0.5;
    if (!over || y0 + (a2 - y0) * 4 * sMan * (1 - sMan) >= clear) {
      D = D2;
      ({ vy, T } = flight(a2));
    }
  }
  // (Air drag takes a little off the carry: a touch more pace to land on the spot.)
  const vh = (D / T) * 1.03;
  b.owner = -1;
  b.vel.x = fx * vh;
  b.vel.z = fz * vh;
  b.vel.y = vy;
  b.spin.x = b.spin.y = b.spin.z = 0;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  p.kickCooldown = Math.max(p.kickCooldown, FLICK_COOL);
  m.passTarget = -1;
  mv.flicked = true;
  mv.landed = false;
  mv.landX = b.pos.x + fx * D;
  mv.landZ = b.pos.z + fz * D;
  mv.chaseEnd = mv.t + T + FLICK_CHASE;
  if (over) {
    mv.through = over.idx;
    const lat = -fz * (p.pos.x - over.pos.x) + fx * (p.pos.z - over.pos.z);
    mv.round = Math.sign(lat) || mv.round;
    // (He isn't "past" him by dribbling: the flick's own link says so when it's his again.)
    st.ahead[over.idx] = -9;
    // Over his head: he has to turn round to it, and can't take it out of the air as it goes up past him (this step's
    // touches are still to come: chase keeps him off it from the next one until it lands).
    over.wrongFootT = Math.max(over.wrongFootT, FLICK_PLANT);
    over.slowT = Math.max(over.slowT, FLICK_TURN);
    over.kickCooldown = Math.max(over.kickCooldown, SHIELD_STEP);
    if (over.order?.firstTime) over.order = null;
    m.events.push({ type: 'ooh' });
  }
}

/** How far (m) from (x, z) along (fx, fz) the ball can go and stay `inset` m inside the pitch. */
function roomAlong(x: number, z: number, fx: number, fz: number, inset: number): number {
  let d = 99;
  if (fx > 1e-6) d = Math.min(d, (HALF_L - inset - x) / fx);
  else if (fx < -1e-6) d = Math.min(d, (-HALF_L + inset - x) / fx);
  if (fz > 1e-6) d = Math.min(d, (HALF_W - inset - z) / fz);
  else if (fz < -1e-6) d = Math.min(d, (-HALF_W + inset - z) / fz);
  return Math.max(0, d);
}

/**
 * After his flick or nutmeg (mv.flicked): he goes and gets it. A flick in the air: none of theirs can head or volley it
 * (it's over them) and he's paced to be just short of where it lands as it comes down; on the grass (or a nutmeg): at it
 * flat out with a little lead. Round the man it went over or through first. The stick only takes over pulled back against
 * the move (CHASE_OWN). It ends when he has it (beyond the man: a link in the chain, SKINNED HIM), someone else does, or
 * at chaseEnd.
 */
function chase(m: Match, p: Player, pad: Pad, st: SkillState, mv: SkillMove): void {
  const b = m.ball;
  m.ctl[p.side].switchT = 0;
  const o = mv.through >= 0 ? m.players[mv.through] : null;
  if (b.owner === p.idx) {
    if (o && (o.pos.x - p.pos.x) * mv.fx + (o.pos.z - p.pos.z) * mv.fz < -0.3) {
      st.ahead[o.idx] = -9;
      st.chain(m, p, 'past', 'good', o.idx);
    }
    st.move = null;
    return;
  }
  if (mv.t > mv.chaseEnd) {
    st.move = null;
    return;
  }
  const air = lofted(mv.kind) && !mv.landed;
  if (air && b.pos.y <= BALL_R + 0.06 && b.vel.y <= 0.5) mv.landed = true;
  // A nutmeg is taken beyond the man, never level with him (it went through his legs, he went round).
  if (mv.kind === 'nutmeg' && o && (b.pos.x - o.pos.x) * mv.fx + (b.pos.z - o.pos.z) * mv.fz < NUTMEG_BEYOND) {
    p.kickCooldown = Math.max(p.kickCooldown, SHIELD_STEP);
  }
  if (air) {
    // Over their heads: nobody of theirs meets it first time on the way (only the keeper, in his box, may claim it), and
    // the man it went over, turning, can't take it out of the air over his shoulder: on the grass it's a race.
    for (const q of m.teamPlayers(p.side === 0 ? 1 : 0)) if (!q.isKeeper && q.order?.firstTime) q.order = null;
    if (o) o.kickCooldown = Math.max(o.kickCooldown, SHIELD_STEP);
  }
  const sl = Math.hypot(pad.mx, pad.mz);
  if (sl > STICK_DEAD && (pad.mx * mv.fx + pad.mz * mv.fz) / sl < CHASE_OWN) return;
  let gx: number;
  let gz: number;
  let v: number;
  let faceBall = false;
  if (lofted(mv.kind) && !mv.landed) {
    // Where it comes down (from the ball as it flies now): just short of there, round the man; never ahead of the ball as
    // it flies (it stays in front of him: run under it and past, it would drop behind him).
    const tl = (b.vel.y + Math.sqrt(Math.max(0, b.vel.y * b.vel.y + 2 * GRAVITY * Math.max(0, b.pos.y - BALL_R)))) / GRAVITY;
    gx = b.pos.x + b.vel.x * tl - mv.fx * CHASE_UNDER;
    gz = b.pos.z + b.vel.z * tl - mv.fz * CHASE_UNDER;
    // (Flat out: a man it went over may be turning to race him to it. Never level with the ball as it flies, though: below.)
    v = 99;
  } else {
    gx = b.pos.x + b.vel.x * CHASE_LEAD;
    gz = b.pos.z + b.vel.z * CHASE_LEAD;
    v = 99;
    // Already level with it or ahead of it on its way: step to the ball itself and meet it facing it.
    if ((p.pos.x - b.pos.x) * b.vel.x + (p.pos.z - b.pos.z) * b.vel.z > 0) {
      gx = b.pos.x;
      gz = b.pos.z;
    }
    faceBall = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 1.6;
  }
  if (o && (o.pos.x - p.pos.x) * mv.fx + (o.pos.z - p.pos.z) * mv.fz > -0.3) {
    // Not past him yet: round his side first (a stride beyond his shoulder), unless the way there is already clear of him.
    const tx = gx - p.pos.x;
    const tz = gz - p.pos.z;
    const tl = Math.hypot(tx, tz) || 1;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const along = (ox * tx + oz * tz) / tl;
    const off = Math.abs(-tz * ox + tx * oz) / tl;
    if (along > 0 && along < tl && off < NUTMEG_ROUND) {
      gx = o.pos.x - mv.fz * mv.round * NUTMEG_ROUND + mv.fx * 0.6;
      gz = o.pos.z + mv.fx * mv.round * NUTMEG_ROUND + mv.fz * 0.6;
      v = Math.max(v, p.jogPace());
    }
  }
  if (lofted(mv.kind) && !mv.landed && (p.pos.x - b.pos.x) * mv.fx + (p.pos.z - b.pos.z) * mv.fz > -CHASE_BEHIND) {
    v = Math.min(v, Math.hypot(b.vel.x, b.vel.z) * 0.95);
  }
  const tx = gx - p.pos.x;
  const tz = gz - p.pos.z;
  const tl = Math.hypot(tx, tz);
  if (tl < 0.12) {
    p.wantX = p.wantZ = 0;
    p.sprint = false;
  } else {
    runAt(p, tx / tl, tz / tl, Math.min(v, tl * 8));
  }
  p.faceTarget = faceBall ? Math.atan2(b.pos.z - p.pos.z, b.pos.x - p.pos.x) : tl < 1 ? Math.atan2(mv.fz, mv.fx) : null;
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

/** FLICK ON: his first touch knocked `d` m on along the move's way (mv.fx, fz), for him to run onto. */
function knockTo(m: Match, p: Player, mv: SkillMove, d: number): void {
  const b = m.ball;
  // (Never out of play: shortened to stop inside the lines.)
  const D = Math.max(1.2, Math.min(d, roomAlong(b.pos.x, b.pos.z, mv.fx, mv.fz, 1.5)));
  const v = Math.max(rollSpeedFor(D), p.speed() * 1.05);
  b.owner = -1;
  b.vel.x = mv.fx * v;
  b.vel.z = mv.fz * v;
  b.vel.y = 0;
  b.spin.x = b.spin.y = b.spin.z = 0;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  p.kickCooldown = Math.max(p.kickCooldown, 0.16);
  m.passTarget = -1;
  mv.flicked = true;
  mv.landX = b.pos.x + mv.fx * D;
  mv.landZ = b.pos.z + mv.fz * D;
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
    const sided = own.kind === 'roulette' || own.kind === 'elastico' || own.kind === 'croqueta' || own.kind === 'ballroll' || own.kind === 'fakeshot';
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

/** `side`'s FLAIR for the HUD: the pips he has (0..FLAIR_MAX, fractional while one refills). */
export function skillFlair(m: Match, side: Side): number {
  return m.ctl[side].skill.flair;
}

/** A skill event (the session, main.ts, the commentary). */
export type SkillEvent = Extract<MatchEvent, { type: 'skillMove' | 'skillTell' | 'skillGoal' }>;
