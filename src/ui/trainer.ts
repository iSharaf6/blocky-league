import { Vector3, type Camera } from 'three';
import { BALL_OFS, PF } from '../game/replay';
import { CURLER_MIN_D, knuckleRange } from '../sim/actions';
import { HALF_L } from '../sim/constants';
import { PITCH_Y } from '../render/stadium';
import type { Match } from '../sim/match';
import { skillWindow } from '../sim/skills';
import type { MatchEvent, Side } from '../sim/types';
import type { Device } from '../core/input';
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

/** A LEARN THE BASICS prompt as a card: its title, the cap (the binding, or the button on screen), its line. */
export function lessonCue(lc: LessonCue, device: Device): TrainerCue {
  // (SPRINT on touch is the stick: there is no button to name.)
  if (lc.key === 'sprint' && device === 'touch') return { title: LESSON_TITLE.sprint, actions: [[moveCap(device), 'Push the stick to chase the ball']] };
  return { title: LESSON_TITLE[lc.key], actions: [[lc.key === 'move' ? moveCap(device) : keyCap(lc.key, device), coachText(lc.text, device)]] };
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

  /** Every match event (main.ts): our kicks clear PASS / SHOOT / CROSS cues. */
  event(e: MatchEvent, m: Match): void {
    if (e.type === 'control' && e.player === this.receiver && m.kickId === this.receiveKick && m.players[e.player]?.side === m.cfg.humanSide) {
      this.done('pass');
      this.receiver = -1;
    }
    if (e.type !== 'kick') return;
    const hs = m.cfg.humanSide;
    const by = m.players[e.player ?? m.ball.lastTouch];
    if (!by || by.side !== hs) return;
    if (e.kind === 'shot' || e.kind === 'header') this.done('shot');
    else if (e.kind === 'lob') this.done('cross');
    else if (e.kind === 'pass' && this.current?.done === 'pass') {
      this.receiver = m.passTarget;
      this.receiveKick = m.kickId;
    }
  }

  /** Give a beginner time to read each cue. The same fresh action then starts live play. */
  hold(m: Match, c: TeachControls & { shoot?: boolean; through?: boolean }): boolean {
    if (this.released || !this.current || !this.show(m, c)) return false;
    if (c.pass || c.shoot || c.through || c.sprint || Math.hypot(c.sx, c.sy) > 0.3) this.released = true;
    return !this.released;
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

  constructor() {
    this.root.className = 'pitch-trainer';
    this.root.hidden = true;
    this.root.innerHTML = `<svg class="trainer-guide" aria-hidden="true"><line class="trainer-line-shadow"/><line class="trainer-line"/></svg>
      <div class="trainer-card coach bar" role="group" aria-label="Controls">
        <div class="trainer-title coach-title"></div><div class="trainer-actions coach-actions"></div><div class="trainer-detail coach-detail"></div>
      </div>`;
    this.card = this.root.querySelector('.trainer-card')!;
    this.parts = {
      title: this.root.querySelector('.trainer-title')!,
      actions: this.root.querySelector('.trainer-actions')!,
      detail: this.root.querySelector('.trainer-detail')!,
    };
    this.line = this.root.querySelector('.trainer-line')!;
    this.shadow = this.root.querySelector('.trainer-line-shadow')!;
    this.guide = this.root.querySelector('svg')!;
  }

  /** Hidden (intro, pause, replay, cinematic): nothing is waiting, so the session never holds the sim on a card nobody sees. */
  hide(): void {
    this.root.hidden = true;
    this.waitingFor = null;
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

  /** `_head` (the head height the card once rode at) is kept so the session's call stays as it was. */
  update(m: Match, frame: Float32Array, camera: Camera, _head: number, device: Device, controls?: TeachControls | null): void {
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
    const lc = lesson ? lesson.show(m, controls ?? this.fed ?? Trainer.input?.read() ?? null) : null;
    const taught = !!lc || teaching;
    const cue: LearnedCue | null = lc ? lessonCue(lc, device) : teaching ? null : this.bar(m, device);
    if (!teaching) this.card.classList.toggle('lesson', !!lc);
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
