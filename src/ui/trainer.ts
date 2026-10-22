import { Vector3, type Camera } from 'three';
import { BALL_OFS, PF } from '../game/replay';
import { CURLER_MIN_D, knuckleRange } from '../sim/actions';
import { DT, HALF_L } from '../sim/constants';
import { PITCH_Y } from '../render/stadium';
import type { Match } from '../sim/match';
import { skillWindow } from '../sim/skills';
import type { MatchEvent, Side } from '../sim/types';
import type { Device } from '../core/input';
import { plainName } from '../core/displayName';
import type { LessonCue } from '../meta/moments';
import { coachText, defendCue, fillCoach, keeperCue, keyCap, moveCap, moveCue, passCue, pressVerb, skillCue, type CoachCue, type CoachParts } from './coach';

/** What a first-match teaching card waits for. */
export type TeachStep = 'move' | 'pass';
/** The stick and PASS state the teaching steps watch (a subset of core/input Controls). */
export interface TeachControls {
  sx: number;
  sy: number;
  pass: boolean;
  /** Read by the SPRINT lesson (LEARN THE BASICS); optional for older feeds. */
  sprint?: boolean;
}
/** A teaching wait that nothing clears (no input source wired) lets go after this long, so the game can never soft-lock. */
const TEACH_TIMEOUT_MS = 25_000;
/**
 * The controls bar switches to a new situation only once it has held this long (ms): play swings between "on the
 * ball" and "without it" many times a second (a pass, a deflection, a tackle), and the card that changed with every
 * swing over the player was what CrazyGames' review found unreadable.
 */
export const BAR_HOLD_MS = 600;
/** A trainer card is a coach card (ui/coach.ts: title, key caps with short imperatives, one optional line). */
export type TrainerCue = CoachCue;
/** A card as much as he still needs it (learnCue): `quiet` once he has seen it often, drawn a step fainter. */
export type LearnedCue = TrainerCue & { quiet?: boolean };

/**
 * The trainer gets quieter as he learns (the owner: "it takes a big chunk of the screen"). Each in-match card is
 * counted every time it comes up (persisted in this browser): the routine ones (on the ball, defending, off the ball)
 * show in full for their first LEARN_BRIEF appearances, then a step fainter (`quiet`), and from LEARN_QUIET on not at
 * all; the others (the keeper's ball, the shot hints) go fainter and stay. Every key keeps its action word throughout:
 * keys alone ("SPACE K L") were what CrazyGames' review could not read. Switching PITCH TRAINER back on in Settings
 * starts it over (Trainer.resetLearned).
 */
const LEARN_KEY = 'blocky-league-trainer-seen';
const LEARN_BRIEF = 20;
const LEARN_QUIET = 80;
const ROUTINE = new Set(['ON THE BALL', 'GET TO THE BALL', 'MAKE A RUN', 'WIN IT BACK', 'MEET THE PASS']);
let learned: Record<string, number> | null = null;

function learnedCounts(): Record<string, number> {
  if (learned) return learned;
  try {
    const raw = JSON.parse(localStorage.getItem(LEARN_KEY) ?? '{}') as unknown;
    learned = raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    learned = {};
  }
  return learned;
}

/** A card came up once more: counted, and as much of it as he still needs (null: he has it, show nothing). */
export function learnCue(cue: TrainerCue, fresh: boolean): LearnedCue | null {
  const seen = learnedCounts();
  const n = seen[cue.title] ?? 0;
  if (fresh) {
    seen[cue.title] = n + 1;
    try {
      localStorage.setItem(LEARN_KEY, JSON.stringify(seen));
    } catch {
      /* private mode: he just sees the full cards */
    }
  }
  const routine = ROUTINE.has(cue.title);
  if (routine && n >= LEARN_QUIET) return null;
  // (No detail line in play: the lessons keep theirs.)
  return n >= LEARN_BRIEF ? { title: cue.title, actions: cue.actions, quiet: true } : { title: cue.title, actions: cue.actions };
}

/**
 * What the controls bar is about (it changes only with this, and only once a change has held BAR_HOLD_MS): his man
 * on the ball (or a pass on its way to him), his keeper holding it, a team-mate on it (or a pass of ours in flight),
 * or without it (theirs, or loose off their touch).
 */
export type BarSituation = 'ball' | 'keeper' | 'mates' | 'off';

export function barSituation(m: Match): BarSituation {
  const hs = m.cfg.humanSide;
  const own = m.ball.owner;
  if (own >= 0 && own === m.active) return m.ball.held ? 'keeper' : 'ball';
  if (own < 0 && m.passTarget >= 0 && m.passTarget === m.active) return 'ball';
  const touch = own >= 0 ? own : m.ball.lastTouch;
  return touch >= 0 && m.players[touch]?.side === hs ? 'mates' : 'off';
}

/**
 * The controls bar for this situation: the player's own keys (or pad buttons), each with its action word, in the
 * order the keys sit. With the ball: PASS, SHOOT, THROUGH, SKILL. Without it: SWITCH, TACKLE, PRESS. A team-mate on
 * it: SPRINT, SWITCH. The keeper's: WALK, THROW, KICK LONG. The title is the card's name for learnCue's count only
 * (the same names the cards over the player had, so what he has learned carries over); the bar does not show it.
 */
export function controlsCue(m: Match, device: Device): TrainerCue {
  const sit = barSituation(m);
  const a = (k: 'pass' | 'shoot' | 'through' | 'sprint' | 'skill') => keyCap(k, device, 'attack');
  const d = (k: 'pass' | 'shoot' | 'through') => keyCap(k, device, 'defend');
  if (sit === 'keeper') return { title: "KEEPER'S BALL", actions: [[moveCap(device), 'WALK'], [a('pass'), 'THROW'], [a('through'), 'KICK LONG']] };
  if (sit === 'ball') return { title: 'ON THE BALL', actions: [[a('pass'), 'PASS'], [a('shoot'), 'SHOOT'], [a('through'), 'THROUGH'], [a('skill'), 'SKILL']] };
  if (sit === 'mates') return { title: 'MAKE A RUN', actions: [[a('sprint'), 'SPRINT'], [a('pass'), 'SWITCH']] };
  return { title: 'WIN IT BACK', actions: [[d('pass'), 'SWITCH'], [d('shoot'), 'TACKLE'], [d('through'), 'PRESS']] };
}

/**
 * The shot hints (2026-10-14, the owner: "knuckle ball curves allat"): three cards that teach the three things a
 * strike can do that nobody would find alone. KNUCKLEBALL while he has the ball (or is charging SHOOT) in knuckleball
 * range, CURLER while he charges a shot from further out than CURLER_MIN_D m, AFTERTOUCH while his shot is in the air.
 * Each comes up at its moment until he has done the thing once (shotHintLearned: the session calls it when the sim
 * says he struck one), and HINT_SHOWS times at the most; then the usual card has that moment back. They are counted
 * with the other cards (learnCue), so PITCH TRAINER switched back on starts them over too.
 */
export type ShotHint = 'KNUCKLEBALL' | 'CURLER' | 'AFTERTOUCH';
export const HINT_SHOWS = 12;

/** Is this hint still worth showing (not done yet, not shown HINT_SHOWS times)? */
export function shotHintDue(title: ShotHint): boolean {
  return (learnedCounts()[title] ?? 0) < HINT_SHOWS;
}

/** He has done it (a knuckleball struck, a curler, an aftertouch that bit): that hint never comes up again. */
export function shotHintLearned(title: ShotHint): void {
  const seen = learnedCounts();
  if ((seen[title] ?? 0) >= HINT_SHOWS) return;
  seen[title] = HINT_SHOWS;
  try {
    localStorage.setItem(LEARN_KEY, JSON.stringify(seen));
  } catch {
    /* private mode: he sees it again next visit */
  }
}

/** The shot hint for this moment, if one is due (see ShotHint). `mine`: his man has the ball at his feet. */
function shotHint(m: Match, device: Device, mine: boolean): TrainerCue | null {
  const hs = m.cfg.humanSide;
  if (hs !== 0 && hs !== 1) return null;
  const shoot = keyCap('shoot', device, 'attack');
  if (mine) {
    const b = m.ball.pos;
    const d = Math.hypot(b.x - m.attackDir(hs) * HALF_L, b.z);
    const charging = m.shootCharge > 0.06;
    // (A pass or a cross being charged, or a challenge to answer, has the card: this can wait.)
    if (!charging && (m.throughCharge > 0.08 || m.passCharge >= 0 || skillWindow(m, hs))) return null;
    if (knuckleRange(d) && shotHintDue('KNUCKLEBALL')) {
      return charging
        ? { title: 'KNUCKLEBALL', actions: [[shoot, 'Hold to full from range']] }
        : { title: 'KNUCKLEBALL', actions: [[shoot, 'Hold to full from range'], [keyCap('pass', device, 'attack'), 'Pass']] };
    }
    if (charging && d >= CURLER_MIN_D && shotHintDue('CURLER')) {
      return { title: 'CURLER', actions: [[moveCap(device), 'Push sideways as you shoot'], [shoot, 'Let go to shoot']] };
    }
    return null;
  }
  // His strike on its way (not a chip, not a knuckleball: Match.aftertouch's own rule), for a second.
  if (m.ball.owner < 0 && m.shotByHuman && m.shotKick === m.kickId && m.shooter === m.active && m.kickKind === 'shot' && m.shotClock < 1 &&
    m.shotStyle !== 'chip' && m.shotStyle !== 'knuckle' && m.ball.lastTouch === m.active && shotHintDue('AFTERTOUCH')) {
    return { title: 'AFTERTOUCH', actions: [[moveCap(device), 'Move it now to bend the shot']] };
  }
  return null;
}

/** "Let go of the stick" in the device's terms: the assisted run then meets the ball. */
const letGo = (device: Device) => (device === 'keyboard' ? `Let go of ${moveCap('keyboard')} to meet it` : 'Let the stick go to meet it');

/**
 * The contextual card over the controlled player. Uses the same possession and charge state as the controller,
 * including passes in flight. Caps are the player's own bindings, or the label the touch button wears right now.
 */
export function trainerCue(m: Match, device: Device): TrainerCue {
  const k = (a: 'pass' | 'shoot' | 'through' | 'sprint') => keyCap(a, device, 'attack');
  const own = m.ball.owner;
  const mine = own === m.active && own >= 0;
  if (mine && m.ball.held) return keeperCue(device);
  // (A shot hint he has not learned yet has this moment: KNUCKLEBALL, CURLER, AFTERTOUCH.)
  const hint = shotHint(m, device, mine);
  if (hint) return hint;
  if (mine && m.shootCharge > 0.06) return {
    title: 'PICK YOUR CORNER', actions: [[k('shoot'), 'Let go to shoot'], [k('through'), 'Chip it']],
    ...(m.timedFinish ? { detail: `${pressVerb(device)} ${k('shoot')} again as you strike` } : {}),
  };
  if (mine && m.throughCharge > 0.08 && (m.passMode === 'through' || m.passMode === 'lob')) return m.throughCharge >= 0.3
    ? { title: 'CROSS READY', actions: [[k('through'), 'Let go to cross']] }
    : { title: 'THROUGH BALL', actions: [[k('through'), 'Let go to play it']], detail: 'Hold longer to cross' };
  // A defender winding up a challenge on him (sim/skills.ts): the window for a PERFECT is open.
  if (mine && m.cfg.humanSide >= 0 && skillWindow(m, m.cfg.humanSide as Side)) return skillCue(device);
  if (mine) return {
    title: 'ON THE BALL', actions: [[k('pass'), 'Pass'], [k('shoot'), 'Shoot'], [k('through'), 'Through ball']],
    detail: m.players[m.active].sprint ? 'Pass now to run for the return' : `Hold ${k('through')} to cross`,
  };
  if (own < 0 && m.passTarget === m.active) return {
    title: 'MEET THE PASS', actions: [[k('pass'), 'Pass it on'], [k('shoot'), 'Shoot']], detail: letGo(device),
  };
  if (m.canStrikeLoose()) {
    const set = m.players[m.active].order?.looseStrike !== undefined;
    return set
      ? { title: 'STRIKE READY', actions: [[k('shoot'), 'Shoots as it arrives']], detail: letGo(device) }
      : { title: 'LOOSE BALL', actions: [[k('shoot'), 'Shoot first time']], detail: letGo(device) };
  }
  if (own >= 0 && m.players[own].side !== m.cfg.humanSide) return defendCue(device);
  // A team-mate has it (the touch buttons still read PASS / SHOOT / THROUGH); a loose ball (SWITCH / TACKLE / PRESS).
  // (On touch there is no SPRINT button: the stick sprints.)
  const run: [string, string] = device === 'touch' ? [moveCap(device), 'Push to sprint'] : [k('sprint'), 'Sprint'];
  if (own >= 0) return { title: 'MAKE A RUN', actions: [run, [k('pass'), 'Switch']] };
  return { title: 'GET TO THE BALL', actions: [run, [keyCap('pass', device, 'defend'), 'Switch']] };
}

/** A basics prompt's title (the action), over its key cap and line. */
const LESSON_TITLE: Record<LessonCue['key'], string> = { pass: 'PASS', shoot: 'SHOOT', through: 'CROSS', sprint: 'SPRINT', move: 'MOVE' };

/** Where a drill of named steps is (Lesson.progress): step `n` of `of`, called `name`. */
export interface LessonProgress {
  n: number;
  of: number;
  name: string;
}

/**
 * A LEARN THE BASICS prompt as a card: its title (the action, or STEP 1 OF 2: CROSS in a drill of named steps), the
 * cap (the binding, or the button on screen), its line.
 */
export function lessonCue(lc: LessonCue, device: Device, progress: LessonProgress | null = null): TrainerCue {
  const title = progress ? `STEP ${progress.n} OF ${progress.of}: ${progress.name}` : LESSON_TITLE[lc.key];
  // (SPRINT on touch is the stick: there is no button to name.)
  if (lc.key === 'sprint' && device === 'touch') return { title, actions: [[moveCap(device), 'Push the stick to chase the ball']] };
  return { title, actions: [[lc.key === 'move' ? moveCap(device) : keyCap(lc.key, device), coachText(lc.text, device)]] };
}

/**
 * Why a LEARN THE BASICS attempt failed: the AGAIN! banner's line (lessonFailText). CrazyGames' review of the CROSS
 * drill: "AGAIN!" with "One more go" never said what went wrong.
 */
export type DrillFail =
  | 'crossOut' | 'crossFirst' | 'crossLetGo' | 'crossMissed' | 'finishLate' | 'shotMissed'
  | 'passOut' | 'passShot' | 'passMissed' | 'passKeeper' | 'shootOut' | 'shootMissed' | 'ownGoal'
  // (Lesson.watch's dead ends: the ball gone the wrong way or out of the drill's patch, too long without the drill's
  // action, the ball stopped, a keeper's hands, their man on it.)
  | 'wrongWay' | 'passAway' | 'passSlow' | 'shootSlow' | 'crossSlow' | 'ballStopped' | 'saved' | 'tackled' | 'again';
/** How main.ts's watch saw an attempt end: the ball dead (out of play), in their keeper's hands, theirs too long. */
export type DrillEnd = 'dead' | 'caught' | 'lost';

/** The reasons, in the drills' words. {pass} / {shoot} / {through}: the key; {PRESS}: PRESS, or TAP on touch. */
const FAIL_TEXT: Record<DrillFail, string> = {
  crossOut: 'THE BALL WENT OUT. CROSS BEFORE THE BYLINE',
  crossFirst: 'CROSS FIRST. HOLD {through}, THEN LET GO',
  crossLetGo: 'LET GO OF {through} TO CROSS, THEN {PRESS} {shoot}',
  crossMissed: 'THE CROSS MISSED YOUR RUNNER',
  finishLate: '{PRESS} {shoot} AS THE BALL ARRIVES',
  shotMissed: 'SHOT MISSED. TRY AGAIN',
  passOut: 'THE BALL WENT OUT. {PRESS} {pass} TO PASS',
  passShot: 'NO SHOOTING HERE. {PRESS} {pass} TO PASS',
  passMissed: 'THE PASS MISSED HIM. AIM AT YOUR TEAMMATE',
  passKeeper: 'THE KEEPER TOOK IT. {PRESS} {pass} TO PASS',
  shootOut: 'THE BALL WENT OUT. HOLD {shoot}, THEN LET GO',
  shootMissed: 'SHOT MISSED. AIM BETWEEN THE POSTS',
  ownGoal: 'THAT WAS YOUR OWN GOAL. ATTACK THE OTHER ONE',
  wrongWay: 'WRONG WAY. HEAD FOR THE GOAL',
  passAway: 'TOO FAR AWAY. {PRESS} {pass} TO PASS',
  passSlow: 'TOO SLOW. {PRESS} {pass} TO PASS',
  shootSlow: 'TOO SLOW. HOLD {shoot}, THEN LET GO',
  crossSlow: 'TOO SLOW. HOLD {through}, THEN LET GO',
  ballStopped: 'THE BALL STOPPED. GET TO IT FASTER',
  saved: 'THE KEEPER HAS IT. AIM FOR A CORNER',
  tackled: 'THEY WON THE BALL. TRY AGAIN',
  again: 'ONE MORE GO',
};

/** The default names (core/input.ts DEFAULT_HINT_TOKENS): what Hud.show's remapKeys turns into the bindings in force. */
const DEFAULT_CAPS: Record<'keyboard' | 'gamepad', Record<'pass' | 'shoot' | 'through', string>> = {
  keyboard: { pass: 'SPACE', shoot: 'K', through: 'L' },
  gamepad: { pass: 'A', shoot: 'B', through: 'X' },
};

/**
 * A failed attempt's reason in words, with the device's keys: the bound key or pad button (`caps` 'bound'), or the
 * default names for a line that goes through Hud.show (`caps` 'default': it re-writes those for the bindings in
 * force, so a bound name written there could be swapped twice). Touch names its buttons and says TAP.
 */
export function lessonFailText(why: DrillFail, device: Device, caps: 'bound' | 'default' = 'bound'): string {
  const cap = (a: 'pass' | 'shoot' | 'through') => (caps === 'default' && device !== 'touch' ? DEFAULT_CAPS[device][a] : keyCap(a, device));
  // (On touch the button is named as a button: TAP THE PASS BUTTON, never "TAP PASS TO PASS". Keys and pads keep
  // PRESS SPACE TO PASS, PRESS A TO PASS, the bound key or the pad's button.)
  const text = device === 'touch' ? FAIL_TEXT[why].replace('{PRESS} {pass} TO PASS', 'TAP THE PASS BUTTON') : FAIL_TEXT[why];
  return text
    .replace(/\{PRESS\}/g, pressVerb(device).toUpperCase())
    .replace(/\{(pass|shoot|through)\}/g, (_, a: 'pass' | 'shoot' | 'through') => cap(a));
}

/** A quick THROUGH tap in the CROSS step is held this long (s) for the sim, so it is a cross (THROUGH_LOB_HOLD is 0.3). */
const CROSS_HOLD_S = 0.36;
/** The finish: PRESS K NOW comes up once the ball is this close to the runner in time (s) or distance (m)... */
const NOW_LEAD_S = 0.5;
const NOW_D = 2.5;
/** ... and goes (the pace back to normal) this long (s of play) later if he never struck it. */
const NOW_MAX_S = 1;
/** A finish not in this long (s of play) after it was struck has missed (Lesson.watch). */
const FINISH_MISS_S = 2.2;
/**
 * No drill attempt runs on with nothing to say (Lesson.watch; CrazyGames' QA, 22 October: a post, a sprint and K away
 * from goal left him on the ball in midfield, no card, no AGAIN, 16 s on). Seconds of play: the drill's action (the
 * pass, the cross, the first shot) not made this long after play starts; the goal (or the completed pass) not come this
 * long after it (a later shot always gets FINISH_MISS_S to go in); a loose ball at rest this long; a keeper holding it,
 * or their man on it, this long; the ball out of the drill's patch this long.
 */
const DRILL_ACT_S = 6;
const DRILL_AFTER_S = 5;
const DRILL_STOPPED_S = 2;
const DRILL_HELD_S = 0.6;
const DRILL_THEIRS_S = 1;
const DRILL_OUTSIDE_S = 0.25;
/** The drill's patch: its men and the ball at the start, this much (m) round them (for a goal to score, up to the goal). */
const DRILL_AREA_M = 12;
/** A loose ball going away from goal faster than this (m/s) and due out of the patch inside DRILL_AHEAD_S is gone too. */
const DRILL_AWAY_V = 3;
const DRILL_AHEAD_S = 1;
/** A prompt holds the picture (Lesson.hold) only on a ball slower than this (m/s): never on a strike in flight. */
const HOLD_BALL_V = 4;
/** The game's pace while the cross is in the air (the callout's time to be read), and as it reaches the runner. */
const FLIGHT_PACE = 0.6;
const NOW_PACE = 0.35;

/**
 * The runner's name as the callout says it: his surname in capitals, plain letters ("J. Zając" → ZAJAC: the pixel face
 * has no accented capitals, and a fallback glyph in the middle of the word reads as a glitch).
 */
export function calloutName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return plainName(parts[parts.length - 1] ?? name).replace(/[^\p{L}'’]/gu, '').toUpperCase();
}

/** A box on screen (px) and a point on screen. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}
export interface Pt {
  x: number;
  y: number;
}

/**
 * What the card sees round it this frame (CardSlide): its own box at home (bottom centre, not slid), the points it must
 * never cover (his man, feet to head, and the ball, now and SLIDE_AHEAD_S on), the points it had better not cover (in
 * a drill, the other men of ours), the spans at its height it may not cover (the touch controls, the player chip) and
 * the screen's usable span.
 */
export interface SlideScene {
  home: Box;
  must: Pt[];
  soft: Pt[];
  blocked: { l: number; r: number }[];
  minL: number;
  maxR: number;
  /** His man's run across the screen (px/s, + to the right): with him at the card, it gets out of his way behind him. */
  drift?: number;
}

/** How close (px) a man or the ball may come to the card's edge before it moves. */
export const SLIDE_PAD = 18;
/** How clear (px) home must be, and for how long (s), before the card goes back there. */
const HOME_PAD = 56;
const HOME_HOLD_S = 0.6;
/** Once moved, the card stays put this long (s) unless the play is actually under it. */
const SLIDE_DWELL_S = 0.3;
/** The slide's spring (rad/s): critically damped, across in about a quarter of a second, never past its mark. */
const SLIDE_W = 18;
/** ...and when it has to pass over him (he runs the length of the bottom of the screen) or get off him: quicker still. */
const SLIDE_FAST_W = 34;
/** How far ahead (s) his run and the ball's are looked at (and halfway there), so the card is out of the way before they arrive. */
export const SLIDE_AHEAD_S = 0.45;

/**
 * The guide card never goes see-through (CrazyGames' review, 22 October: "the guide is a bit transparent"): when his
 * man or the ball would be under it, it slides along the bottom to the side away from them, clear of the touch controls
 * and the player chip, and back home once home has been clear a while. It moves only when its spot is covered (and not
 * again for SLIDE_DWELL_S unless the play is right under it), on a critically damped spring: it never jitters, never
 * overshoots. `blockedAll`: no spot along the bottom is clear this frame (the session may nudge the camera).
 */
export class CardSlide {
  /** Where the card is drawn (px off home), its speed, and where it is headed. */
  x = 0;
  v = 0;
  target = 0;
  blockedAll = false;
  private homeT = 0;
  private dwell = 0;
  private fast = false;

  reset(): void {
    this.x = this.v = this.target = this.homeT = this.dwell = 0;
    this.blockedAll = this.fast = false;
  }

  /** The offset (px off home) to draw the card at after `dt` s. `snap`: it has just come up, so it starts at its spot. */
  update(s: SlideScene, dt: number, snap = false): number {
    const { home } = s;
    const inside = (off: number, p: Pt, pad: number) =>
      p.x > home.l + off - pad && p.x < home.r + off + pad && p.y > home.t - pad && p.y < home.b + pad;
    const count = (pts: Pt[], off: number, pad: number) => {
      let n = 0;
      for (const p of pts) if (inside(off, p, pad)) n++;
      return n;
    };
    const fits = (off: number) => home.l + off >= s.minL - 0.5 && home.r + off <= s.maxR + 0.5 &&
      !s.blocked.some((q) => q.r > home.l + off - 4 && q.l < home.r + off + 4);
    const clear = (off: number, pad: number) => fits(off) && count(s.must, off, pad) === 0 && count(s.soft, off, pad) === 0;
    this.dwell = Math.max(0, this.dwell - dt);
    if (this.target !== 0) {
      this.homeT = clear(0, HOME_PAD) ? this.homeT + dt : 0;
      if (this.homeT >= HOME_HOLD_S) {
        this.target = 0;
        this.homeT = 0;
        this.dwell = SLIDE_DWELL_S;
      }
    }
    const covered = count(s.must, this.x, 0) > 0;
    if (!clear(this.target, SLIDE_PAD) && (snap || covered || this.dwell <= 0 || !fits(this.target))) {
      const cands = new Set<number>([0, this.target, s.minL - home.l, s.maxR - home.r]);
      // (A spot with room to spare, so a man still speeding up does not catch it again at once.)
      const gap = SLIDE_PAD + 40;
      for (const p of s.must.concat(s.soft)) {
        cands.add(p.x - gap - home.r);
        cands.add(p.x + gap - home.l);
      }
      for (const q of s.blocked) {
        cands.add(q.r + 6 - home.l);
        cands.add(q.l - 6 - home.r);
      }
      let best = this.target;
      let bestCost = Infinity;
      let bestSweep = 0;
      // (His man at the card already and running across: it gets out of his way behind him rather than racing him along,
      // unless it is already on its way ahead of him: it never turns back over him.)
      const drift = s.drift ?? 0;
      const heading = Math.sign(this.target - this.x);
      const atCard = Math.abs(drift) > 60 && count(s.must, this.x, SLIDE_PAD) > 0 && heading !== Math.sign(drift);
      for (const off of cands) {
        if (!fits(off)) continue;
        // (Through his man to get there: only if no other way is clear.)
        const lo = Math.min(this.x, off), hi = Math.max(this.x, off);
        let sweep = 0;
        for (const p of s.must) {
          if (p.x > home.l + lo && p.x < home.r + hi && p.y > home.t && p.y < home.b && !inside(this.x, p, 0)) sweep++;
        }
        const along = atCard && Math.sign(off - this.x) === Math.sign(drift) ? 400 : 0;
        const cost = count(s.must, off, SLIDE_PAD) * 1000 + count(s.soft, off, SLIDE_PAD) * 60 + sweep * 200 + along +
          Math.abs(off - this.x) * 0.1 + Math.abs(off) * 0.02;
        if (cost < bestCost) {
          bestCost = cost;
          best = off;
          bestSweep = sweep;
        }
      }
      if (best !== this.target) {
        this.target = best;
        this.dwell = SLIDE_DWELL_S;
        this.homeT = 0;
        // (Over him to get clear, or off him now: the quick spring, so it is over him for as few frames as can be.)
        this.fast = bestSweep > 0 || covered;
      }
      this.blockedAll = bestCost >= 1000;
    } else this.blockedAll = false;
    if (snap) {
      this.x = this.target;
      this.v = 0;
      return this.x;
    }
    // Critically damped: x(t) = (d + (v + w d) t) e^(-w t) about the target, exact for any frame time.
    const w = this.fast ? SLIDE_FAST_W : SLIDE_W;
    const k = Math.max(0, Math.min(0.05, dt));
    const d = this.x - this.target;
    const e = Math.exp(-w * k);
    const c = this.v + w * d;
    this.x = this.target + (d + c * k) * e;
    this.v = (this.v - w * c * k) * e;
    if (Math.abs(this.x - this.target) < 0.25 && Math.abs(this.v) < 2) {
      this.x = this.target;
      this.v = 0;
      this.fast = false;
    }
    return this.x;
  }
}

/**
 * Where a big call across the picture goes (the drill's NOW FINISH WITH and PRESS K NOW): the spot (its centre `x`, its
 * top `y`, px) among `cands`, in order of preference, that covers none of `pts` (the runner, feet to name tag, and the
 * ball, now and on its way), keeping `cur` while it still covers none; else the one that covers the fewest. `w` / `h`
 * its size.
 */
export function callSpot(cands: Pt[], cur: Pt | null, pts: Pt[], w: number, h: number, pad = 16): Pt {
  const hits = (c: Pt) => pts.filter((p) => p.x > c.x - w / 2 - pad && p.x < c.x + w / 2 + pad && p.y > c.y - pad && p.y < c.y + h + pad).length;
  if (cur && hits(cur) === 0) return cur;
  let best = cands[0];
  let bestN = Infinity;
  for (const c of cands) {
    const n = hits(c);
    if (n < bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

/** The first match's teaching cards (the same look and words as the basics prompts). */
function teachCue(step: TeachStep, device: Device): TrainerCue {
  return step === 'move' ? moveCue(device) : passCue(device);
}

/**
 * LEARN THE BASICS: a drill's prompts (meta/moments.ts BasicsStep.lesson), one at a time. main.ts puts the
 * step's lesson in Trainer.lesson and forwards the match events to event(); the trainer card shows `cue`.
 * A cue waits `after` seconds of play (from the start, or from the previous cue being done) and for its
 * `when` to hold. Cues advance in order; PASS waits for reception, CROSS for a lofted delivery.
 */
export class Lesson {
  private i = 0;
  /** Match clock when the current cue's wait began (-1: not started). */
  private from = -1;
  private sprintT = 0;
  private lastClock = -1;
  private released = false;
  private receiver = -1;
  private receiveKick = -1;
  /** The index of the cue last shown: it stays up for the rest of its step (sticky), never the controls bar mid-step. */
  private seen = -1;
  /** The cross (kickId) and the man it is for: the FINISH step's runner. */
  private crossKick = -1;
  private runner = -1;
  /** THROUGH held (s of play) in the CROSS step: a quick tap is held to a cross (filterPad). */
  private crossHold = 0;
  /** SHOOT pressed during the FINISH step (filterPad). */
  private pressedShoot = false;
  /** The FINISH step's PRESS K NOW: the clock it came up at (-1: not yet). */
  private nowAt = -1;
  private shotTaken = false;
  /** The CROSS drill's finish: the clock it was struck at (-1: not yet), for watch's miss. */
  private finishAt = -1;
  private passed = false;
  /** This attempt is lost now (a shot before the cross, the cross taken down): main.ts ends it. */
  private failNow: DrillFail | null = null;
  private endCause: DrillEnd | null = null;
  /** watch's dead-end clocks (s of play): played, when the drill's action was made (-1: not yet), the last shot. */
  private played = 0;
  private watchClock = -1;
  private actedAt = -1;
  private lastShotAt = -1;
  private stoppedT = 0;
  private heldT = 0;
  private theirsT = 0;
  private outsideT = 0;
  /** The drill's patch (x0..x1, z0..z1), from where its men and the ball start; the goal it attacks (x, the sign). */
  private area: { x0: number; x1: number; z0: number; z1: number; ad: number } | null = null;
  constructor(readonly cues: readonly LessonCue[]) {}

  /** The cue waiting to be learned (null: all done). */
  get current(): LessonCue | null {
    return this.cues[this.i] ?? null;
  }

  private done(what: LessonCue['done']): void {
    // Learn in order: a direct shot must not skip the PASS or CROSS instruction.
    if (this.current?.done !== what) return;
    this.i++;
    this.from = -1;
    this.sprintT = 0;
    this.released = false;
  }

  /** Every match event (main.ts): our kicks clear PASS / SHOOT / CROSS cues, and a wrong one ends the attempt. */
  event(e: MatchEvent, m: Match): void {
    const hs = m.cfg.humanSide;
    // (Dribbled the length of the pitch into his own net: the judge fails it; this says why.)
    if (e.type === 'goal' && e.side !== hs) this.failNow ??= 'ownGoal';
    if (e.type === 'control' && m.players[e.player]?.side === hs) {
      // (The finish struck and the ball back at one of ours' feet: it never went in.)
      if (this.finishAt >= 0) this.failNow ??= 'shotMissed';
      if (e.player === this.receiver && m.kickId === this.receiveKick) {
        this.done('pass');
        this.receiver = -1;
      } else if (this.current?.done === 'shot' && this.current.when === 'incoming' && this.crossKick >= 0 && m.kickId === this.crossKick) {
        // The cross taken down instead of struck as it came: the FINISH step is a first-time strike.
        this.failNow ??= e.player === this.runner ? 'finishLate' : 'crossMissed';
      }
    }
    if (e.type !== 'kick') return;
    const by = m.players[e.player ?? m.ball.lastTouch];
    if (!by || by.side !== hs) return;
    const cue = this.current;
    if (e.kind === 'shot' || e.kind === 'header') {
      // A strike before the step that comes first: the attempt ends now (no goal celebrated that doesn't count).
      if (cue?.done === 'cross') this.failNow ??= e.style === 'chip' || m.ctl[hs]?.prev.through ? 'crossLetGo' : 'crossFirst';
      else if (cue?.done === 'pass') this.failNow ??= 'passShot';
      else {
        this.shotTaken = true;
        if (cue?.done === 'shot' && cue.when === 'incoming') this.finishAt = m.clock;
        // (watch: the drill's action, and every strike after it gets its time to go in.)
        if (this.actedAt < 0) this.actedAt = this.played;
        this.lastShotAt = this.played;
      }
      this.done('shot');
    } else if (e.kind === 'lob') {
      if (cue?.done === 'cross') {
        this.crossKick = m.kickId;
        this.runner = m.passTarget;
        if (this.actedAt < 0) this.actedAt = this.played;
      }
      this.done('cross');
    } else if (e.kind === 'pass' && cue?.done === 'pass') {
      this.receiver = m.passTarget;
      this.receiveKick = m.kickId;
      this.passed = true;
      if (this.actedAt < 0) this.actedAt = this.played;
    }
  }

  /**
   * Give a beginner time to read the drill's first prompt: the picture holds until he acts, and that same fresh action
   * starts live play (a button the prompt ignores doesn't). Never on a ball in the air: the FINISH step's cross flies
   * on, slowed as it comes (pace), where a frozen picture read as a stuck game in CrazyGames' review.
   */
  hold(m: Match, c: TeachControls & { shoot?: boolean; through?: boolean }): boolean {
    const cue = this.current;
    if (this.released || !cue || cue.when === 'incoming' || !this.show(m, c)) return false;
    // (Nor on a ball still flying from a strike: the SHOOT drill's SPRINT prompt froze a second shot a metre off his boot,
    // which read as a stuck game. It holds once the ball has slowed to a roll.)
    const b = m.ball;
    if (b.owner < 0 && !b.held && Math.hypot(b.vel.x, b.vel.y, b.vel.z) > HOLD_BALL_V) return false;
    const ig = cue.ignore ?? [];
    const on = (b: 'pass' | 'shoot' | 'through') => !!c[b] && !ig.includes(b);
    if (on('pass') || on('shoot') || on('through') || c.sprint || Math.hypot(c.sx, c.sy) > 0.3) this.released = true;
    return !this.released;
  }

  /**
   * The drill's buttons for the next sim step (game/matchSession.ts buildPad): those the prompt ignores dropped (in the
   * CROSS step SWITCH does nothing: control stays with the crosser until the cross is away), and in the CROSS step a
   * quick THROUGH tap held until it is a cross, not a through ball.
   */
  filterPad<P extends { pass: boolean; shoot: boolean; through: boolean }>(pad: P, m: Match): P {
    const cue = this.current;
    if (!cue || m.phase !== 'play') {
      this.crossHold = 0;
      return pad;
    }
    const out = { ...pad };
    for (const b of cue.ignore ?? []) out[b] = false;
    if (cue.done === 'cross') {
      const mine = m.active >= 0 && m.ball.owner === m.active;
      if (mine && out.through) this.crossHold += DT;
      else if (mine && this.crossHold > 0 && this.crossHold < CROSS_HOLD_S) {
        out.through = true;
        this.crossHold += DT;
      } else this.crossHold = 0;
    }
    if (cue.done === 'shot' && cue.when === 'incoming' && out.shoot) this.pressedShoot = true;
    return out;
  }

  /** Where a drill of named steps is (STEP 1 OF 2: CROSS); null for a one-step drill, or once every step is done. */
  progress(): LessonProgress | null {
    const names: string[] = [];
    for (const c of this.cues) if (c.step && !names.includes(c.step)) names.push(c.step);
    const name = this.current?.step;
    if (!name || names.length < 2) return null;
    return { n: names.indexOf(name) + 1, of: names.length, name };
  }

  /**
   * What the drill's card shows this frame (`live`: show()'s cue): the prompt while its moment holds, and still for the
   * rest of its step once it has been up (the controls bar never stands in mid-step: CrazyGames' review saw SPRINT and
   * SWITCH where CROSS and SHOOT belonged); the PASS step's "let it reach him" while the pass is on its way. Null:
   * nothing (between steps, or the attempt is over).
   */
  card(live: LessonCue | null, device: Device): TrainerCue | null {
    const cue = this.current;
    if (!cue || this.failNow) return null;
    if (live) this.seen = this.i;
    if (cue.done === 'pass' && this.receiver >= 0) return { title: LESSON_TITLE.pass, actions: [['', 'Let the ball reach him']] };
    if (!live && this.seen !== this.i) return null;
    return lessonCue(cue, device, this.progress());
  }

  /**
   * The FINISH step's moment (the cross on its way to the runner): 'switch' while it flies (NOW FINISH WITH ZAJAC,
   * the arrow on him), 'now' as it reaches him (PRESS K NOW, slower still). Null outside it, or once he has struck it.
   */
  finishCall(m: Match): { phase: 'switch' | 'now'; runner: number } | null {
    const cue = this.current;
    if (!cue || cue.done !== 'shot' || cue.when !== 'incoming' || this.crossKick < 0 || this.failNow || m.phase !== 'play') return null;
    if (m.kickId !== this.crossKick) return null;
    const r = m.players[this.runner] ?? (m.active >= 0 ? m.players[m.active] : undefined);
    if (!r) return null;
    if (this.nowAt < 0) {
      const b = m.ball;
      const d = Math.hypot(b.pos.x - r.pos.x, b.pos.z - r.pos.z);
      const v = Math.max(1, Math.hypot(b.vel.x - r.vel.x, b.vel.z - r.vel.z));
      if (d < NOW_D || d / v < NOW_LEAD_S) this.nowAt = m.clock;
    }
    if (this.nowAt < 0) return { phase: 'switch', runner: r.idx };
    return m.clock - this.nowAt <= NOW_MAX_S ? { phase: 'now', runner: r.idx } : null;
  }

  /** The drill's pace (the session's step rate): slowed while the cross flies to the runner, slower as it arrives. */
  pace(m: Match): number {
    const f = this.finishCall(m);
    return !f ? 1 : f.phase === 'now' ? NOW_PACE : FLIGHT_PACE;
  }

  /**
   * Every frame of a drill (main.ts basicsWatch): the CROSS drill's finish that has not gone in FINISH_MISS_S after it
   * was struck (off the post and still in play, say) is a miss: the attempt ends (SHOT MISSED), never a drill left
   * running with nothing to say.
   */
  watch(m: Match): void {
    if (this.finishAt >= 0 && m.phase === 'play' && m.clock - this.finishAt > FINISH_MISS_S) this.failNow ??= 'shotMissed';
    // Every other way an attempt could run on with nothing to say ends it too, with why (CrazyGames' QA, 22 October):
    // the ball gone the wrong way or out of the drill's patch, too long without the drill's action or, after it,
    // without the goal, the ball stopped dead, a keeper holding it, their man on it. Live play only: the held first
    // prompt, a goal, a dead ball (main.ts's own) never count.
    const d = this.watchClock >= 0 ? m.clock - this.watchClock : 0;
    this.watchClock = m.clock;
    if (this.failNow || m.phase !== 'play' || !(d > 0 && d < 1)) return;
    this.played += d;
    const hs = m.cfg.humanSide;
    const b = m.ball;
    if (!this.area) {
      // (From the first live step: where the drill set its men and the ball.)
      let x0 = b.pos.x, x1 = b.pos.x, z0 = b.pos.z, z1 = b.pos.z;
      for (const p of m.players) {
        if (p.side !== hs || p.sentOff || p.isKeeper) continue;
        x0 = Math.min(x0, p.pos.x);
        x1 = Math.max(x1, p.pos.x);
        z0 = Math.min(z0, p.pos.z);
        z1 = Math.max(z1, p.pos.z);
      }
      const ad = m.attackDir(hs as Side);
      const scoring = this.cues[0]?.done !== 'pass';
      // (A drill with a goal to score reaches the goal line: a shot or a cross is never "out of the patch".)
      if (scoring && ad > 0) x1 = Math.max(x1, HALF_L);
      if (scoring && ad < 0) x0 = Math.min(x0, -HALF_L);
      if (scoring) {
        z0 = Math.min(z0, -4);
        z1 = Math.max(z1, 4);
      }
      this.area = { x0: x0 - DRILL_AREA_M, x1: x1 + DRILL_AREA_M, z0: z0 - DRILL_AREA_M, z1: z1 + DRILL_AREA_M, ad };
    }
    const a = this.area;
    const inside = (x: number, z: number) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
    const own = b.owner;
    const loose = own < 0 && !b.held;
    const holder = own >= 0 ? m.players[own] : null;
    const inHands = !!holder?.isKeeper && b.held;
    // Out of the patch, or loose and on its way out of it away from goal (a rebound off the post comes back in range).
    // (Ours or loose: in a keeper's hands, or theirs, it is that, wherever it is.)
    const away = loose && b.vel.x * a.ad < -DRILL_AWAY_V &&
      !inside(b.pos.x + b.vel.x * DRILL_AHEAD_S, b.pos.z + b.vel.z * DRILL_AHEAD_S);
    const free = loose || (!!holder && holder.side === hs && !inHands);
    this.outsideT = free && (!inside(b.pos.x, b.pos.z) || away) ? this.outsideT + d : 0;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    this.stoppedT = loose && speed < 0.4 && b.pos.y < 0.5 ? this.stoppedT + d : 0;
    this.heldT = inHands ? this.heldT + d : 0;
    // (Their keeper with it at his feet is their man on it too.)
    this.theirsT = holder && holder.side !== hs && !inHands ? this.theirsT + d : 0;
    const acted = this.actedAt >= 0;
    // (A strike made inside the time after the action gets FINISH_MISS_S to go in; none later stretches it again.)
    const flying = this.lastShotAt >= 0 && this.lastShotAt - this.actedAt <= DRILL_AFTER_S && this.played - this.lastShotAt <= FINISH_MISS_S;
    const late = acted ? this.played - this.actedAt > DRILL_AFTER_S && !flying : this.played > DRILL_ACT_S;
    let why: 'area' | 'slow' | 'stopped' | 'keeper' | 'theirs' | null = null;
    if (this.heldT > DRILL_HELD_S) why = 'keeper';
    else if (this.theirsT > DRILL_THEIRS_S) why = 'theirs';
    else if (this.outsideT > DRILL_OUTSIDE_S) why = 'area';
    else if (this.stoppedT > DRILL_STOPPED_S) why = 'stopped';
    else if (late) why = 'slow';
    // (Gone off or stopped after their touch, a keeper's clearance say: their ball.)
    if (why) this.failNow = this.deadEnd((why === 'area' || why === 'stopped') && b.lastTouchSide !== hs ? 'theirs' : why, holder ? holder.side === hs : false);
  }

  /** Why an attempt watch ended (`ours`: the keeper holding it is ours), in the drill's own terms. */
  private deadEnd(why: 'area' | 'slow' | 'stopped' | 'keeper' | 'theirs', ours: boolean): DrillFail {
    const first = this.cues[0]?.done;
    if (why === 'theirs') return 'tackled';
    if (why === 'keeper' && !ours) return first === 'pass' ? 'passKeeper' : 'saved';
    if (this.actedAt >= 0) {
      // After the drill's action: that action's own miss (the reasons a dead ball gives: failReason).
      if (first === 'pass') return 'passMissed';
      if (first === 'cross') return !this.shotTaken ? (this.pressedShoot ? 'finishLate' : 'crossMissed') : 'shotMissed';
      return 'shootMissed';
    }
    // Before it: dribbled the wrong way, or never made it.
    if (why === 'keeper' || why === 'area') return first === 'pass' ? 'passAway' : 'wrongWay';
    if (why === 'stopped') return 'ballStopped';
    return first === 'pass' ? 'passSlow' : first === 'cross' ? 'crossSlow' : 'shootSlow';
  }

  /** The attempt is lost now, whatever the ball does next: main.ts ends it at once (null: play on). */
  get verdict(): DrillFail | null {
    return this.failNow;
  }

  /** main.ts's watch ended the attempt (the ball dead, their keeper's hands, their ball): kept for failReason. */
  ended(cause: DrillEnd): void {
    this.endCause ??= cause;
  }

  /** Why this attempt failed, from what happened in it (the AGAIN! banner's line: lessonFailText). */
  failReason(): DrillFail {
    if (this.failNow) return this.failNow;
    const first = this.cues[0]?.done;
    // (Their man kept it, or their keeper has it in his hands: said as it is, never "THE BALL WENT OUT".)
    if (this.endCause === 'lost') return 'tackled';
    if (this.endCause === 'caught' && first !== 'pass') return 'saved';
    if (first === 'cross') {
      if (this.crossKick < 0) return 'crossOut';
      if (!this.shotTaken) return this.pressedShoot ? 'finishLate' : 'crossMissed';
      return 'shotMissed';
    }
    if (first === 'pass') {
      if (!this.passed) return this.endCause === 'caught' ? 'passKeeper' : 'passOut';
      return 'passMissed';
    }
    if (first === 'shot') return this.shotTaken ? 'shootMissed' : 'shootOut';
    return 'again';
  }

  /** The cue to show now, if its time and moment have come (called by the trainer each frame). */
  show(m: Match, c: TeachControls | null): LessonCue | null {
    const cue = this.current;
    if (!cue || m.phase !== 'play') return null;
    const clock = m.clock;
    if (this.from < 0) this.from = clock;
    const dt = this.lastClock >= 0 ? Math.max(0, Math.min(0.1, clock - this.lastClock)) : 0;
    this.lastClock = clock;
    if (cue.done === 'move' && c && Math.hypot(c.sx, c.sy) > 0.3) {
      this.done('move');
      return null;
    }
    // (AUTO SPRINT on touch: the stick pushed all the way is a sprint too.)
    if (cue.done === 'sprint' && (c?.sprint || (m.active >= 0 && m.players[m.active].sprint && m.players[m.active].speed() > 4))) {
      this.sprintT += dt;
      if (this.sprintT > 0.35) {
        this.done('sprint');
        return null;
      }
    }
    if (clock - this.from < cue.after) return null;
    const hs = m.cfg.humanSide;
    const own = m.ball.owner;
    const ours = own >= 0 && m.players[own]?.side === hs;
    const holds =
      cue.when === 'any' ? true
        : cue.when === 'onBall' ? ours && own === m.active
          : cue.when === 'offBall' ? !ours
            : own < 0 && m.passTarget >= 0 && m.players[m.passTarget]?.side === hs;
    return holds ? cue : null;
  }
}

/**
 * The controls bar and the passing lane. The bar is fixed at the bottom centre of the screen, just above the minimap
 * (coach.css .pitch-trainer .trainer-card): CrazyGames' review found a card riding on the player unreadable ("it
 * moves so fast and changes frequently") and asked for the controls at the bottom. It shows the keys for what he can
 * do now, each with its word (controlsCue), and changes only when the situation has held BAR_HOLD_MS. No text floats
 * over any player (the lane is a line, nothing more). On touch the on-screen buttons wear their own words, so the bar
 * stays off there (lessons and the first match's teaching cards still show, in the same place). No menus, animations,
 * or per-frame DOM rebuilds.
 *
 * First match (MatchConfig.firstMatch, trainer on): the first two cards are teaching steps, MOVE then PASS, that
 * wait for the action. The session reads `waitingFor` and holds the sim while it is set (still drawing, still
 * reading input); the step clears itself when it sees the stick move / PASS pressed through `Trainer.input`
 * (set by main.ts), through `feed()` / the `controls` argument of update(), or, failing all of those, through
 * the match itself (the player moved, the ball left his feet) or the safety timeout.
 */
export class Trainer {
  /** The live input (main.ts: `Trainer.input = input`): how the teaching steps see the action while the sim is held. */
  static input: { read(): TeachControls } | null = null;
  /** LEARN THE BASICS: the drill's prompts, replacing the normal cues (main.ts sets it per step; null otherwise). */
  static lesson: Lesson | null = null;
  /** The basics are done: the first match skips its own MOVE / PASS teaching cards. */
  static taught = false;
  readonly root = document.createElement('div');
  /** First-match teaching: 'move' → 'pass' → 'play' (the normal cues). 'play' from the start on any other match. */
  stage: TeachStep | 'play' = 'play';
  /** The action the teaching card on screen is waiting for; null when no card is waiting (the sim may run). */
  waitingFor: TeachStep | null = null;
  private card: HTMLElement;
  private parts: CoachParts;
  private line: SVGLineElement;
  private shadow: SVGLineElement;
  private guide: SVGSVGElement;
  private v = new Vector3();
  private lastCue = '';
  /** The title of the last in-match card (a new title is one more appearance: learnCue). */
  private lastTitle = '';
  private stageInit = false;
  private fed: TeachControls | null = null;
  private waitSince = 0;
  private startPos: [number, number] | null = null;
  /** The controls bar: the cue it shows ('' key: nothing yet), and a different one waiting out BAR_HOLD_MS. */
  private barKey = '';
  private barCue: TrainerCue | null = null;
  private barNext = '';
  private barNextSince = 0;
  /** The card's slide along the bottom, off his man and the ball (CardSlide), and whether it was up last frame. */
  readonly slide = new CardSlide();
  private cardUp = false;
  private slideDrawn = NaN;
  /** Where his man's feet and the ball were on screen last frame, and how fast they cross it (px/s). */
  private manOnScreen = { i: -1, x: 0, y: 0, vx: 0, vy: 0 };
  private ballOnScreen = { i: -1, x: 0, y: 0, vx: 0, vy: 0 };
  /** LEARN THE BASICS' finish callout (NOW FINISH WITH ZAJAC, PRESS K NOW) and the top it was placed at (null: not up). */
  private call: HTMLElement;
  private callA: HTMLElement;
  private callKey: HTMLElement;
  private callB: HTMLElement;
  private callKeyText = '';
  private callAt: Pt | null = null;

  constructor() {
    this.root.className = 'pitch-trainer';
    this.root.hidden = true;
    this.root.innerHTML = `<svg class="trainer-guide" aria-hidden="true"><line class="trainer-line-shadow"/><line class="trainer-line"/></svg>
      <div class="trainer-card coach bar" role="group" aria-label="Controls">
        <div class="trainer-title coach-title"></div><div class="trainer-actions coach-actions"></div><div class="trainer-detail coach-detail"></div>
      </div>
      <div class="drill-call" role="status" aria-live="polite" hidden><span class="dc-a"></span><kbd class="dc-key" hidden></kbd><span class="dc-b"></span></div>`;
    this.card = this.root.querySelector('.trainer-card')!;
    this.parts = {
      title: this.root.querySelector('.trainer-title')!,
      actions: this.root.querySelector('.trainer-actions')!,
      detail: this.root.querySelector('.trainer-detail')!,
    };
    this.line = this.root.querySelector('.trainer-line')!;
    this.shadow = this.root.querySelector('.trainer-line-shadow')!;
    this.guide = this.root.querySelector('svg')!;
    this.call = this.root.querySelector('.drill-call')!;
    this.callA = this.root.querySelector('.dc-a')!;
    this.callKey = this.root.querySelector('.dc-key')!;
    this.callB = this.root.querySelector('.dc-b')!;
  }

  /** Hidden (intro, pause, replay, cinematic): nothing is waiting, so the session never holds the sim on a card nobody sees. */
  hide(): void {
    this.root.hidden = true;
    this.waitingFor = null;
    this.call.hidden = true;
    this.callAt = null;
    this.cardUp = false;
    this.manOnScreen.i = this.ballOnScreen.i = -1;
    // (Back in play, the bar shows the situation as it is then, at once: nothing stale waits out a hold.)
    this.barKey = this.barNext = '';
    this.barCue = null;
  }

  /**
   * The bar's cue this frame: the situation's controls (controlsCue), switched to a new one only once it has held
   * BAR_HOLD_MS, then as much of it as he still needs (learnCue: fainter, then gone). null: nothing to show (touch,
   * where the buttons say it; or learned).
   */
  private bar(m: Match, device: Device): LearnedCue | null {
    if (device === 'touch') {
      this.barKey = this.barNext = '';
      this.barCue = null;
      return null;
    }
    const want = controlsCue(m, device);
    const key = JSON.stringify(want);
    const now = performance.now();
    if (!this.barKey) {
      this.barKey = key;
      this.barCue = want;
      this.barNext = '';
    } else if (key === this.barKey) {
      this.barNext = '';
    } else if (key !== this.barNext) {
      this.barNext = key;
      this.barNextSince = now;
    } else if (now - this.barNextSince >= BAR_HOLD_MS) {
      this.barKey = key;
      this.barCue = want;
      this.barNext = '';
    }
    const cue = this.barCue!;
    const fresh = cue.title !== this.lastTitle;
    this.lastTitle = cue.title;
    return learnCue(cue, fresh);
  }

  /** The session may hand over this frame's controls (instead of, or as well as, Trainer.input). */
  feed(c: TeachControls | null): void {
    this.fed = c;
  }

  /** PITCH TRAINER switched back on: every card in full again (learnCue). */
  static resetLearned(): void {
    learned = {};
    try {
      localStorage.removeItem(LEARN_KEY);
    } catch {
      /* nothing stored */
    }
  }

  /** Skip the teaching (a returning player, or the session decided): straight to the normal cues. */
  endTeaching(): void {
    this.stage = 'play';
    this.waitingFor = null;
    this.lastCue = '';
  }

  /**
   * One teaching step: draw its card (once) and clear it when the action arrives. Returns true while the step
   * is still waiting (the normal cue is not drawn meanwhile).
   */
  private teach(m: Match, frame: Float32Array, device: Device, controls: TeachControls | null | undefined): boolean {
    const step = this.stage;
    if (step === 'play') return false;
    const a = m.active * PF;
    const mine = m.ball.owner === m.active;
    // PASS is taught the first time the player has the ball; until then the normal cue guides him to it. The ball
    // leaving his feet while the card was up counts as the pass (a press the session let through to the sim).
    if (step === 'pass' && !mine) {
      if (this.waitingFor === 'pass') return this.advance(m, frame, device, controls);
      this.waitingFor = null;
      this.card.classList.remove('lesson');
      return false;
    }
    const now = performance.now();
    if (this.waitingFor !== step) {
      this.waitingFor = step;
      this.waitSince = now;
      this.startPos = [frame[a], frame[a + 1]];
      this.lastCue = `teach:${step}:${device}`;
      fillCoach(this.parts, teachCue(step, device));
      // The basics prompts' look: a size up, the key cap bobbing.
      this.card.classList.add('lesson');
    }
    // With an input source the action itself is what counts (the sim moves him on its own at a kick-off, and
    // move assist keeps him running: neither is the player pushing the stick). Without one, the match has to do.
    const c = controls ?? this.fed ?? Trainer.input?.read() ?? null;
    let done = false;
    if (step === 'move') {
      const moved = this.startPos ? Math.hypot(frame[a] - this.startPos[0], frame[a + 1] - this.startPos[1]) > 0.8 : false;
      done = c ? Math.hypot(c.sx, c.sy) > 0.3 : moved;
    } else {
      done = c ? c.pass : m.passCharge >= 0;
    }
    if (!done && now - this.waitSince > TEACH_TIMEOUT_MS) done = true;
    return done ? this.advance(m, frame, device, controls) : true;
  }

  /** The waited-for action happened: on to the next step (PASS may show at once if he has the ball) or the normal cues. */
  private advance(m: Match, frame: Float32Array, device: Device, controls: TeachControls | null | undefined): boolean {
    this.stage = this.stage === 'move' ? 'pass' : 'play';
    this.waitingFor = null;
    this.lastCue = '';
    this.card.classList.remove('lesson');
    return this.stage !== 'play' && this.teach(m, frame, device, controls);
  }

  /**
   * LEARN THE BASICS' finish (Lesson.finishCall): as the cross goes, NOW FINISH WITH ZAJAC big across the picture
   * (control has just moved to him: his marker's arrow and name tag go with it, the one arrow over him); as it reaches
   * him, PRESS K NOW (TAP SHOOT on touch, the pad's button on a pad). Placed above or below him, clear of the score
   * bug, the card, the touch controls, the ball and the runner (callSpot), and it stays where it is while that stays clear.
   */
  private drillCall(lesson: Lesson | null, m: Match, frame: Float32Array, camera: Camera, head: number, device: Device): void {
    const f = lesson?.finishCall(m) ?? null;
    if (!f) {
      if (!this.call.hidden) this.call.hidden = true;
      this.callAt = null;
      return;
    }
    const now = f.phase === 'now';
    const runner = m.players[f.runner];
    const a = now ? pressVerb(device).toUpperCase() : 'NOW FINISH WITH';
    const k = now ? keyCap('shoot', device) : '';
    const b = now ? 'NOW' : calloutName(runner?.def.name ?? '');
    if (this.callA.textContent !== a) this.callA.textContent = a;
    if (this.callKeyText !== k) {
      this.callKeyText = k;
      this.callKey.textContent = k;
      this.callKey.hidden = !k;
    }
    if (this.callB.textContent !== b) this.callB.textContent = b;
    this.call.classList.toggle('now', now);
    this.call.hidden = false;
    const w = window.innerWidth, h = window.innerHeight;
    const o = f.runner * PF;
    const project = (x: number, y: number, z: number) => {
      this.v.set(x, y + PITCH_Y, z).project(camera);
      return { x: (this.v.x + 1) * w / 2, y: (1 - this.v.y) * h / 2, ok: this.v.z > -1 && this.v.z < 1 };
    };
    const lift = frame[o + 2] || 0;
    // (His name tag tops him: MatchView's marker, headTop + 1.3.)
    const top = project(frame[o], head + 1.55 + lift, frame[o + 1]);
    // The words go in a band clear of the ball and the runner, feet to name tag: under the top cluster, over the card,
    // or just above or below him.
    const r = this.call.getBoundingClientRect();
    const ch = r.height || 40;
    const cw = r.width || 300;
    const B = BALL_OFS;
    const ball = project(frame[B], frame[B + 1], frame[B + 2]);
    // (The ball where it is and a quarter of a second on: a cross climbing up the picture never flies through the words.)
    const soon = project(frame[B] + frame[B + 3] * 0.25, Math.max(0.2, frame[B + 1] + frame[B + 4] * 0.25), frame[B + 2] + frame[B + 5] * 0.25);
    const pts = [ball, soon, project(frame[o], 0.1 + lift, frame[o + 1]), project(frame[o], head * 0.5 + lift, frame[o + 1]), top]
      .filter((p) => p.ok);
    const hud = this.root.parentElement;
    const rect = (sel: string) => {
      const q = hud?.querySelector(sel)?.getBoundingClientRect() ?? document.querySelector?.(sel)?.getBoundingClientRect();
      return q && q.height > 0 && q.width > 0 ? q : null;
    };
    const tops = ['.scorebug', '.hud-pause', '.hud-cam'].map(rect);
    const lows = [this.card.hidden ? null : this.card.getBoundingClientRect(), rect('#ui > .touch:not(.hidden) .touch-btns'), rect('#ui > .touch:not(.hidden) .touch-base')];
    // Across the middle first; then, on a small screen where the middle has him or the ball, to one side of him.
    const m12 = Math.max(12, Math.min(w / 2, cw / 2 + 12));
    const cands: Pt[] = [];
    for (const x of [w / 2, m12, w - m12]) {
      const across = (q: DOMRect | null): q is DOMRect => !!q && q.left < x + cw / 2 && q.right > x - cw / 2;
      let topBand = 0.12 * h;
      for (const q of tops) if (across(q)) topBand = Math.max(topBand, q.bottom + 10);
      let floor = h * 0.8;
      for (const q of lows) if (across(q) && q.height > 0) floor = Math.min(floor, q.top);
      const lowBand = Math.max(topBand, floor - ch - 12);
      const inBand = (y: number) => Math.min(lowBand, Math.max(topBand, y));
      const ys = pts.map((p) => p.y);
      cands.push({ x, y: topBand }, { x, y: lowBand });
      if (ys.length) cands.push({ x, y: inBand(Math.min(...ys) - ch - 18) }, { x, y: inBand(Math.max(...ys) + 18) });
    }
    const at = callSpot(cands, this.callAt, pts, cw, ch);
    this.callAt = at;
    this.call.style.top = `${Math.round(Math.max(4, at.y))}px`;
    this.call.style.left = `${Math.round(at.x)}px`;
  }

  /**
   * The card's slide this frame (CardSlide): his man (feet, body, head) and the ball, now and SLIDE_AHEAD_S on, must
   * never be under it; in a drill the other men of ours had better not be. Fully opaque throughout: it moves, it never
   * fades.
   */
  private placeCard(m: Match, frame: Float32Array, camera: Camera, lesson: Lesson | null, dt: number): void {
    const w = window.innerWidth, h = window.innerHeight;
    const r = this.card.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const drawn = Number.isFinite(this.slideDrawn) ? this.slideDrawn : 0;
    const home: Box = { l: r.left - drawn, t: r.top, r: r.right - drawn, b: r.bottom };
    const pts = (out: Pt[], x: number, y: number, z: number) => {
      this.v.set(x, y + PITCH_Y, z).project(camera);
      if (this.v.z > -1 && this.v.z < 1) out.push({ x: (this.v.x + 1) * w / 2, y: (1 - this.v.y) * h / 2 });
    };
    const man = (out: Pt[], i: number) => {
      const o = i * PF;
      const lift = frame[o + 2] || 0;
      for (const y of [0.2, 0.9, 1.6]) pts(out, frame[o], y + lift, frame[o + 1]);
    };
    // His man and the ball as they move ON SCREEN (the camera's pan included: a man standing still slides across the
    // picture as the lens follows the ball), eased over a few frames; looked at now, halfway and SLIDE_AHEAD_S on.
    const now: Pt[] = [];
    if (m.active >= 0) man(now, m.active);
    const nb = now.length;
    pts(now, frame[BALL_OFS], frame[BALL_OFS + 1], frame[BALL_OFS + 2]);
    const track = (t: { i: number; x: number; y: number; vx: number; vy: number }, i: number, p: Pt | undefined) => {
      if (!p) {
        t.i = -1;
        return;
      }
      if (t.i === i && dt > 0) {
        const cap = (v: number) => Math.max(-3000, Math.min(3000, v));
        t.vx += (cap((p.x - t.x) / dt) - t.vx) * 0.5;
        t.vy += (cap((p.y - t.y) / dt) - t.vy) * 0.5;
      } else t.vx = t.vy = 0;
      t.i = i;
      t.x = p.x;
      t.y = p.y;
    };
    // (Control just moved to a man who stands under the card: it steps off him with the switch, in the same frame as his
    // marker, rather than sliding off him over the next few.)
    const switched = this.manOnScreen.i >= 0 && this.manOnScreen.i !== m.active &&
      now.slice(0, nb).some((p) => p.x > r.left - SLIDE_PAD && p.x < r.right + SLIDE_PAD && p.y > r.top - SLIDE_PAD && p.y < r.bottom + SLIDE_PAD);
    track(this.manOnScreen, m.active, nb ? now[0] : undefined);
    track(this.ballOnScreen, 0, now[nb]);
    const must: Pt[] = [];
    for (const k of [0, SLIDE_AHEAD_S / 2, SLIDE_AHEAD_S]) {
      for (let j = 0; j < now.length; j++) {
        const v = j < nb ? this.manOnScreen : this.ballOnScreen;
        must.push({ x: now[j].x + v.vx * k, y: now[j].y + v.vy * k });
      }
    }
    const drift = nb ? this.manOnScreen.vx : 0;
    const soft: Pt[] = [];
    if (lesson) for (const p of m.players) if (p.side === m.cfg.humanSide && !p.sentOff && p.idx !== m.active) man(soft, p.idx);
    // What it may not slide over at its height: the touch controls, the player chip and the SKILL pips, the minimap.
    const blocked: { l: number; r: number }[] = [];
    const sels = ['.hud-chip', '.hud-radar', '.skill-hud .sk-flair', '#ui > .touch:not(.hidden) .touch-btns', '#ui > .touch:not(.hidden) .touch-base'];
    const found = typeof document.querySelectorAll === 'function' ? document.querySelectorAll<HTMLElement>(sels.join(',')) : [];
    for (const q of found) {
      const b = q.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.bottom > home.t - 4 && b.top < home.b + 4) blocked.push({ l: b.left, r: b.right });
    }
    const x = this.slide.update({ home, must, soft, blocked, minL: 8, maxR: w - 8, drift }, dt, !this.cardUp || switched);
    this.cardUp = true;
    if (Math.abs(x - drawn) > 0.05 || !Number.isFinite(this.slideDrawn)) {
      this.slideDrawn = x;
      this.card.style.setProperty('--slide', `${x.toFixed(1)}px`);
    }
  }

  /** `_head` (the head height the card once rode at) is kept so the session's call stays as it was. `dt`: the frame's time (s). */
  update(m: Match, frame: Float32Array, camera: Camera, _head: number, device: Device, controls?: TeachControls | null, dt = 1 / 60): void {
    if (!this.stageInit) {
      this.stageInit = true;
      if (m.cfg.firstMatch && m.trainer && !Trainer.taught && !Trainer.lesson) this.stage = 'move';
    }
    if (!m.trainer || m.phase !== 'play' || m.active < 0 || m.players[m.active].sentOff) { this.hide(); return; }
    this.root.hidden = false;
    const lesson = Trainer.lesson;
    const teaching = !lesson && this.teach(m, frame, device, controls);
    // A basics prompt, or the first match's MOVE / PASS step (teach() has drawn that one): the lesson look, in the
    // bar's place. Otherwise the controls bar (in a drill, between its prompts too).
    // (In a drill the drill's own card, or nothing: never the controls bar, which named SPRINT and SWITCH mid-step.)
    const lc = lesson ? lesson.card(lesson.show(m, controls ?? this.fed ?? Trainer.input?.read() ?? null), device) : null;
    const taught = !!lc || teaching;
    const cue: LearnedCue | null = lc ? lc : teaching || lesson ? null : this.bar(m, device);
    if (!teaching) this.card.classList.toggle('lesson', !!lc);
    this.drillCall(lesson, m, frame, camera, _head, device);
    this.card.classList.toggle('bar', !taught);
    this.card.classList.toggle('quiet', !taught && !!cue?.quiet);
    this.card.hidden = !taught && !cue;
    if (cue) {
      // (The bar shows no title, only the keys and their words; a lesson keeps its title.)
      const shown: TrainerCue = taught ? cue : { title: '', actions: cue.actions };
      const key = JSON.stringify(shown);
      if (key !== this.lastCue) {
        this.lastCue = key;
        fillCoach(this.parts, shown);
      }
    }
    // The card at the bottom never goes see-through over the play (CrazyGames' review): it slides along the bottom off
    // his man and the ball instead (placeCard), every frame, so it is out of the way before they arrive.
    if (this.card.hidden) this.cardUp = false;
    else this.placeCard(m, frame, camera, lesson, dt);
    // The passing lane: a line from the ball to the man a pass would go to (no words over him).
    const idx = m.passCharge >= 0 ? m.passAim : m.passPreview;
    const valid = m.ball.owner === m.active && m.shootCharge < 0.06 && m.throughCharge < 0.08 &&
      idx >= 0 && idx !== m.active && !m.players[idx].sentOff && m.players[idx].side === m.cfg.humanSide;
    if (!valid) { this.guide.style.display = 'none'; return; }
    const w = window.innerWidth, h = window.innerHeight;
    const project = (x: number, y: number, z: number) => {
      this.v.set(x, y + PITCH_Y, z).project(camera);
      return { x: (this.v.x + 1) * w / 2, y: (1 - this.v.y) * h / 2, visible: this.v.z > -1 && this.v.z < 1 };
    };
    const to = project(frame[idx * PF], 0.14, frame[idx * PF + 1]);
    const from = project(frame[BALL_OFS], 0.14, frame[BALL_OFS + 2]);
    if (!to.visible || !from.visible) { this.guide.style.display = 'none'; return; }
    this.guide.style.display = '';
    for (const line of [this.line, this.shadow]) {
      line.setAttribute('x1', from.x.toFixed(1)); line.setAttribute('y1', from.y.toFixed(1));
      line.setAttribute('x2', to.x.toFixed(1)); line.setAttribute('y2', to.y.toFixed(1));
    }
  }
}
