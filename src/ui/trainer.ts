import { Vector3, type Camera } from 'three';
import { clamp } from '../core/math';
import { BALL_OFS, PF } from '../game/replay';
import { HALF_L } from '../sim/constants';
import { PITCH_Y } from '../render/stadium';
import type { Match } from '../sim/match';
import { skillWindow } from '../sim/skills';
import type { MatchEvent, Side } from '../sim/types';
import type { Device } from '../core/input';
import type { LessonCue } from '../meta/moments';
import { coachText, defendCue, fillCoach, keeperCue, keyCap, moveCap, moveCue, passCue, pressVerb, skillCue, type CoachCue, type CoachParts } from './coach';
import { escHtml, sep } from './text';

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
/** Gap (px) between the trainer card and the player's head (or feet), room for its pointer tip. */
const CARD_GAP = 26;
/** When the card slides beside the player, this much of it (px) stays over him, so the tip still reaches. */
const CARD_TIP_IN = 34;
/** A teaching wait that nothing clears (no input source wired) lets go after this long, so the game can never soft-lock. */
const TEACH_TIMEOUT_MS = 25_000;
/**
 * The card, its tip and the pass tag sit on DEVICE pixels (crisp text) and hold still until where they should be
 * has moved by more than this many device pixels: whole CSS pixels made the card step and flicker between two
 * spots while the player under it moved smoothly (the owner's "glitching while playing").
 */
const SNAP_HOLD = 0.75;
/** Slots in Trainer.at: the card's x and y, its tip, the pass tag's x and y. */
const AT_X = 0, AT_Y = 1, AT_TIP = 2, AT_TAG_X = 3, AT_TAG_Y = 4;
/** A trainer card is a coach card (ui/coach.ts: title, key caps with short imperatives, one optional line). */
export type TrainerCue = CoachCue;

/**
 * The trainer gets quieter as he learns (the owner: "it takes a big chunk of the screen"). Each in-match card is
 * counted every time it comes up (persisted in this browser): the routine ones (on the ball, defending, off the ball)
 * show in full for their first LEARN_BRIEF appearances, then as the keys alone, and from LEARN_QUIET on not at all;
 * the moment-to-moment ones (BEAT HIM, a loose ball, a set piece) go to the keys alone and stay. Switching PITCH
 * TRAINER back on in Settings starts it over (Trainer.resetLearned).
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
export function learnCue(cue: TrainerCue, fresh: boolean): TrainerCue | null {
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
  if (n >= LEARN_BRIEF) return { title: cue.title, actions: cue.actions.map(([k]) => [k, ''] as [string, string]) };
  // (No detail line over the play: the lessons keep theirs.)
  return { title: cue.title, actions: cue.actions };
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
  if (own >= 0) return { title: 'MAKE A RUN', actions: [[k('sprint'), 'Sprint'], [k('pass'), 'Switch']] };
  return { title: 'GET TO THE BALL', actions: [[k('sprint'), 'Sprint'], [keyCap('pass', device, 'defend'), 'Switch']] };
}

/** A basics prompt's title (the action), over its key cap and line. */
const LESSON_TITLE: Record<LessonCue['key'], string> = { pass: 'PASS', shoot: 'SHOOT', through: 'CROSS', sprint: 'SPRINT', move: 'MOVE' };

/** A LEARN THE BASICS prompt as a card: its title, the cap (the binding, or the button on screen), its line. */
export function lessonCue(lc: LessonCue, device: Device): TrainerCue {
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
 * Small pitch-anchored control card and passing lane. No menus, animations, or per-frame DOM rebuilds.
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
  private recipient: HTMLElement;
  private line: SVGLineElement;
  private shadow: SVGLineElement;
  private guide: SVGSVGElement;
  private v = new Vector3();
  private lastCue = '';
  /** The title of the last in-match card (a new title is one more appearance: learnCue). */
  private lastTitle = '';
  private target = -1;
  private stageInit = false;
  private fed: TeachControls | null = null;
  private waitSince = 0;
  private startPos: [number, number] | null = null;
  /** Where the card, its tip and the tag are drawn now (CSS px on the device-pixel grid; NaN: not yet). */
  private at = new Float64Array(5).fill(NaN);

  /** Slot `i` moved to `v` (CSS px), on the device-pixel grid with SNAP_HOLD's hold; returns the CSS px to draw. */
  private snap(i: number, v: number): number {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cur = this.at[i];
    if (!(Math.abs(v - cur) * dpr <= SNAP_HOLD)) this.at[i] = Math.round(v * dpr) / dpr;
    return Math.round(this.at[i] * 100) / 100;
  }

  constructor() {
    this.root.className = 'pitch-trainer';
    this.root.hidden = true;
    this.root.innerHTML = `<svg class="trainer-guide" aria-hidden="true"><line class="trainer-line-shadow"/><line class="trainer-line"/></svg>
      <div class="trainer-recipient" aria-hidden="true"></div>
      <div class="trainer-card coach" role="group" aria-label="On-pitch trainer">
        <div class="trainer-title coach-title"></div><div class="trainer-actions coach-actions"></div><div class="trainer-detail coach-detail"></div>
      </div>`;
    this.card = this.root.querySelector('.trainer-card')!;
    this.parts = {
      title: this.root.querySelector('.trainer-title')!,
      actions: this.root.querySelector('.trainer-actions')!,
      detail: this.root.querySelector('.trainer-detail')!,
    };
    this.recipient = this.root.querySelector('.trainer-recipient')!;
    this.line = this.root.querySelector('.trainer-line')!;
    this.shadow = this.root.querySelector('.trainer-line-shadow')!;
    this.guide = this.root.querySelector('svg')!;
  }

  /** Hidden (intro, pause, replay, cinematic): nothing is waiting, so the session never holds the sim on a card nobody sees. */
  hide(): void {
    this.root.hidden = true;
    this.waitingFor = null;
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

  update(m: Match, frame: Float32Array, camera: Camera, head: number, device: Device, controls?: TeachControls | null): void {
    if (!this.stageInit) {
      this.stageInit = true;
      if (m.cfg.firstMatch && m.trainer && !Trainer.taught && !Trainer.lesson) this.stage = 'move';
    }
    if (!m.trainer || m.phase !== 'play' || m.active < 0 || m.players[m.active].sentOff) { this.hide(); return; }
    const w = window.innerWidth, h = window.innerHeight;
    const project = (x: number, y: number, z: number) => {
      this.v.set(x, y + PITCH_Y, z).project(camera);
      return { x: (this.v.x + 1) * w / 2, y: (1 - this.v.y) * h / 2, visible: this.v.z > -1 && this.v.z < 1 };
    };
    const a = m.active * PF;
    const at = project(frame[a], head + frame[a + 2], frame[a + 1]);
    const lesson = Trainer.lesson;
    const docked = !at.visible || at.x < 0 || at.x > w || at.y < 65 || at.y > h - 25;
    // A teaching hold can switch control to a runner near the screen edge. Keep its instruction visible:
    // hiding it would freeze the ball while the player has no cue telling them how to continue.
    if (docked && !lesson) { this.hide(); return; }
    this.root.hidden = false;
    const goal = project(m.attackDir(m.players[m.active].side) * HALF_L, 0, 0);
    const direction = Math.abs(goal.x - at.x) > 70 ? (goal.x > at.x ? ' →' : ' ←') : ' ↑';
    const teaching = !lesson && this.teach(m, frame, device, controls);
    let cue: TrainerCue | null = null;
    if (lesson) {
      // In flight, after a miss, or once the taught action is done, keep useful recovery guidance visible.
      const lc = lesson.show(m, controls ?? this.fed ?? Trainer.input?.read() ?? null);
      cue = lc ? lessonCue(lc, device) : trainerCue(m, device);
      this.card.classList.toggle('lesson', !!lc);
      this.card.hidden = false;
    } else {
      const full = teaching ? null : trainerCue(m, device);
      const fresh = !!full && full.title !== this.lastTitle;
      if (full) this.lastTitle = full.title;
      cue = full ? learnCue(full, fresh) : null;
      // (A card he has learned: nothing over him; the pass recipient's tag below still shows.)
      this.card.hidden = !!full && !cue;
    }
    const key = cue ? JSON.stringify(cue) + direction : this.lastCue;
    if (cue && key !== this.lastCue) {
      this.lastCue = key;
      // On the ball, the title points the way he attacks.
      fillCoach(this.parts, cue, m.ball.owner === m.active && !lesson ? direction : '');
    }
    // The card rides on the controlled player (the owner: "keep the trainer on top of the player controlled"),
    // never off in a corner. Above his head, its tip pointing down at him; if the ball is where the card
    // would be, it slides to his side away from the ball (still touching him); near the top of the screen it
    // hangs under his feet instead. Never over the score, or the bottom touch controls.
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    const feet = project(frame[a], 0, frame[a + 1]);
    let x = docked ? (w - cw) / 2 : at.x - cw / 2;
    let y = docked ? 70 : at.y - ch - CARD_GAP;
    let below = false;
    if (!docked && y < 70) {
      y = feet.y + CARD_GAP;
      below = true;
    }
    const ball = project(frame[BALL_OFS], 0.14, frame[BALL_OFS + 2]);
    if (!docked && ball.visible && ball.x > x - 24 && ball.x < x + cw + 24 && ball.y > y - 24 && ball.y < y + ch + 24) {
      x = ball.x > at.x ? at.x - cw + CARD_TIP_IN : at.x - CARD_TIP_IN;
    }
    x = clamp(x, 10, w - cw - 10);
    y = clamp(y, 70, h - ch - 90);
    const sx = this.snap(AT_X, x), sy = this.snap(AT_Y, y);
    // The tip sits over the player, wherever the card had to slide.
    this.card.style.setProperty('--tip', `${this.snap(AT_TIP, clamp(at.x - sx, 12, cw - 12))}px`);
    this.card.classList.toggle('below', below);
    this.card.classList.toggle('docked', docked);
    this.card.style.visibility = 'visible';
    this.card.style.transform = `translate(${sx}px,${sy}px)`;
    const idx = m.passCharge >= 0 ? m.passAim : m.passPreview;
    const valid = m.ball.owner === m.active && m.shootCharge < 0.06 && m.throughCharge < 0.08 &&
      idx >= 0 && idx !== m.active && !m.players[idx].sentOff && m.players[idx].side === m.cfg.humanSide;
    this.guide.style.display = valid ? '' : 'none';
    this.recipient.hidden = !valid;
    if (!valid) { this.target = -1; return; }
    const to = project(frame[idx * PF], 0.14, frame[idx * PF + 1]);
    const tag = project(frame[idx * PF], head + frame[idx * PF + 2] + 0.55, frame[idx * PF + 1]);
    const from = project(frame[BALL_OFS], 0.14, frame[BALL_OFS + 2]);
    if (!to.visible || !from.visible) { this.guide.style.display = 'none'; this.recipient.hidden = true; return; }
    for (const line of [this.line, this.shadow]) {
      line.setAttribute('x1', from.x.toFixed(1)); line.setAttribute('y1', from.y.toFixed(1));
      line.setAttribute('x2', to.x.toFixed(1)); line.setAttribute('y2', to.y.toFixed(1));
    }
    this.recipient.hidden = !tag.visible || tag.x < 38 || tag.x > w - 38 || tag.y < 80 || tag.y > h - 85 ||
      (tag.x > x - 30 && tag.x < x + cw + 30 && tag.y > y - 15 && tag.y < at.y - 10);
    this.recipient.style.transform = `translate(${this.snap(AT_TAG_X, tag.x)}px,${this.snap(AT_TAG_Y, tag.y - 12)}px) translate(-50%,-100%)`;
    if (this.target !== idx || this.recipient.dataset.device !== device) {
      this.target = idx;
      this.recipient.dataset.device = device;
      this.recipient.innerHTML = `${escHtml(keyCap('pass', device))}${sep()}${escHtml(String(m.players[idx].def.number))}`;
    }
  }
}
