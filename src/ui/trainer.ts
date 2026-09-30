import { Vector3, type Camera } from 'three';
import { clamp } from '../core/math';
import { BALL_OFS, PF } from '../game/replay';
import { HALF_L } from '../sim/constants';
import { PITCH_Y } from '../render/stadium';
import type { Match } from '../sim/match';
import type { MatchEvent } from '../sim/types';
import { actionKey, moveKeys } from '../core/input';
import type { LessonCue } from '../meta/moments';
import { escHtml, sep, sepsOfText } from './text';

type Device = 'keyboard' | 'gamepad' | 'touch';
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
export interface TrainerCue {
  title: string;
  actions: [string, string][];
  detail: string;
}

/** Uses the same possession and charge state as the controller, including passes in flight. */
export function trainerCue(m: Match, device: Device): TrainerCue {
  // The player's own bindings (Settings > Controls > KEYS), or the touch buttons' names.
  const [pass, shoot, through, sprint] = (['pass', 'shoot', 'through', 'sprint'] as const).map((a) => actionKey(a, device));
  const own = m.ball.owner;
  const mine = own === m.active && own >= 0;
  if (mine && m.ball.held) return {
    title: "KEEPER'S BALL", actions: [[pass, 'Roll out'], [through, 'Kick long']],
    detail: 'Point towards an open teammate',
  };
  if (mine && m.shootCharge > 0.06) return {
    title: 'PICK YOUR CORNER', actions: [[shoot, 'Release to shoot']],
    detail: `${through} while charging = chip`,
  };
  if (mine && m.throughCharge > 0.08 && (m.passMode === 'through' || m.passMode === 'lob')) return {
    title: m.throughCharge >= 0.3 ? 'CROSS READY' : 'THROUGH BALL',
    actions: [[through, m.throughCharge >= 0.3 ? 'Release to cross' : 'Release into space']],
    detail: 'Hold longer to lift it over the defence',
  };
  if (mine) return {
    title: 'ON THE BALL', actions: [[pass, 'Pass'], [shoot, 'Shoot'], [through, 'Through']],
    detail: m.players[m.active].sprint ? `${sprint} + ${pass} = pass & run` : `Hold ${through} to cross · ${sprint} sprint`,
  };
  if (own < 0 && m.passTarget === m.active) return {
    title: 'MEET THE PASS', actions: [[pass, 'First-time pass'], [shoot, 'Finish']],
    detail: 'Let go of movement to meet the ball',
  };
  if (own >= 0 && m.players[own].side !== m.cfg.humanSide) return {
    title: 'WIN IT BACK', actions: [[device === 'touch' ? 'TACKLE' : shoot, 'Tackle'], [device === 'touch' ? 'PRESS' : through, 'Hold to press'], [device === 'touch' ? 'SWITCH' : pass, 'Switch']],
    detail: `Hold ${device === 'touch' ? 'TACKLE' : shoot} to slide · aim away to cancel`,
  };
  return { title: 'GET TO THE BALL', actions: [[sprint, 'Sprint'], [pass, 'Switch']], detail: 'Point your movement towards the ball' };
}

/** A basics prompt's title (the action), over its key cap and line. */
const LESSON_TITLE: Record<LessonCue['key'], string> = { pass: 'PASS', shoot: 'SHOOT', through: 'CROSS', sprint: 'SPRINT', move: 'MOVE' };

/** The teaching cards, by device: the key cap, what to do, and one line of detail. */
function teachCue(step: TeachStep, device: Device): TrainerCue {
  const keys = moveKeys('keyboard').split(' / ')[0];
  const stick = device === 'keyboard' ? keys : 'STICK';
  const pass = actionKey('pass', device);
  if (step === 'move') return {
    title: 'STEP 1 · MOVE', actions: [[stick, device === 'keyboard' ? `Run with ${[...keys].join(' ')}${moveKeys('keyboard').includes('ARROWS') ? ' (or the arrows)' : ''}` : 'Push the stick to run']],
    detail: 'Head for the goal the arrow points at',
  };
  return {
    title: 'STEP 2 · PASS', actions: [[pass, device === 'touch' ? 'Tap PASS to the ringed mate' : `Tap ${pass} to the ringed mate`]],
    detail: 'Point the stick at a mate to pick him',
  };
}

/**
 * LEARN THE BASICS: a drill's prompts (meta/moments.ts BasicsStep.lesson), one at a time. main.ts puts the
 * step's lesson in Trainer.lesson and forwards the match events to event(); the trainer card shows `cue`.
 * A cue waits `after` seconds of play (from the start, or from the previous cue being done) and for its
 * `when` to hold; the action it teaches clears it, even one done early (a quick pass skips the PASS card).
 */
export class Lesson {
  private i = 0;
  /** Match clock when the current cue's wait began (-1: not started). */
  private from = -1;
  private sprintT = 0;
  private lastClock = -1;
  constructor(readonly cues: readonly LessonCue[]) {}

  /** The cue waiting to be learned (null: all done). */
  get current(): LessonCue | null {
    return this.cues[this.i] ?? null;
  }

  private done(what: LessonCue['done']): void {
    // An action done early counts for its cue, and for any cue before it that taught the same thing.
    const at = this.cues.findIndex((c, k) => k >= this.i && c.done === what);
    if (at < 0) return;
    this.i = at + 1;
    this.from = -1;
    this.sprintT = 0;
  }

  /** Every match event (main.ts): our kicks clear PASS / SHOOT / CROSS cues. */
  event(e: MatchEvent, m: Match): void {
    if (e.type !== 'kick') return;
    const hs = m.cfg.humanSide;
    const by = m.players[m.ball.lastTouch];
    if (!by || by.side !== hs) return;
    if (e.kind === 'shot' || e.kind === 'header') this.done('shot');
    else if (e.kind === 'through' || e.kind === 'lob') {
      this.done('cross');
      this.done('pass');
    } else if (e.kind === 'pass') this.done('pass');
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
    if (cue.done === 'sprint' && c?.sprint) {
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
  private title: HTMLElement;
  private actions: HTMLElement;
  private detail: HTMLElement;
  private recipient: HTMLElement;
  private line: SVGLineElement;
  private shadow: SVGLineElement;
  private guide: SVGSVGElement;
  private v = new Vector3();
  private lastCue = '';
  private target = -1;
  private stageInit = false;
  private fed: TeachControls | null = null;
  private waitSince = 0;
  private startPos: [number, number] | null = null;

  constructor() {
    this.root.className = 'pitch-trainer';
    this.root.hidden = true;
    this.root.innerHTML = `<svg class="trainer-guide" aria-hidden="true"><line class="trainer-line-shadow"/><line class="trainer-line"/></svg>
      <div class="trainer-recipient" aria-hidden="true"></div>
      <div class="trainer-card" role="group" aria-label="On-pitch trainer">
        <div class="trainer-title"></div><div class="trainer-actions"></div><div class="trainer-detail"></div>
      </div>`;
    this.card = this.root.querySelector('.trainer-card')!;
    this.title = this.root.querySelector('.trainer-title')!;
    this.actions = this.root.querySelector('.trainer-actions')!;
    this.detail = this.root.querySelector('.trainer-detail')!;
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
      this.card.classList.remove('teach');
      return false;
    }
    const now = performance.now();
    if (this.waitingFor !== step) {
      this.waitingFor = step;
      this.waitSince = now;
      this.startPos = [frame[a], frame[a + 1]];
      const cue = teachCue(step, device);
      this.lastCue = `teach:${step}:${device}`;
      this.title.textContent = cue.title;
      this.actions.replaceChildren(...cue.actions.map(([k, label]) => {
        const item = document.createElement('span');
        const cap = document.createElement('kbd');
        cap.textContent = k;
        item.append(cap, document.createTextNode(label));
        return item;
      }));
      this.detail.innerHTML = sepsOfText(cue.detail);
      this.card.classList.add('teach');
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
    this.card.classList.remove('teach');
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
    if (!at.visible || at.x < 0 || at.x > w || at.y < 65 || at.y > h - 25) { this.hide(); return; }
    this.root.hidden = false;
    const goal = project(m.attackDir(m.players[m.active].side) * HALF_L, 0, 0);
    const direction = Math.abs(goal.x - at.x) > 70 ? (goal.x > at.x ? ' →' : ' ←') : ' ↑';
    const lesson = Trainer.lesson;
    const teaching = !lesson && this.teach(m, frame, device, controls);
    let cue: TrainerCue | null = null;
    if (lesson) {
      // A basics drill: its one prompt (or nothing, while the next one waits its turn).
      const lc = lesson.show(m, controls ?? this.fed ?? Trainer.input?.read() ?? null);
      cue = lc ? { title: LESSON_TITLE[lc.key], actions: [[lc.key === 'move' ? moveKeys(device).split(' / ')[0] : actionKey(lc.key, device), lc.text]], detail: '' } : null;
      this.card.classList.toggle('lesson', !!lc);
      this.card.classList.toggle('teach', !!lc);
      this.card.hidden = !lc;
    } else {
      this.card.hidden = false;
      cue = teaching ? null : trainerCue(m, device);
    }
    const key = cue ? JSON.stringify(cue) + direction : this.lastCue;
    if (cue && key !== this.lastCue) {
      this.lastCue = key;
      this.title.textContent = cue.title + (m.ball.owner === m.active && !lesson ? direction : '');
      this.actions.replaceChildren(...cue.actions.map(([k, label]) => {
        const item = document.createElement('span');
        const cap = document.createElement('kbd');
        cap.textContent = k;
        item.append(cap, document.createTextNode(label));
        return item;
      }));
      // Two facts in one line ("Hold L to cross · SHIFT sprint") are split with the divider element.
      this.detail.innerHTML = sepsOfText(cue.detail);
    }
    // The card rides on the controlled player (the owner: "keep the trainer on top of the player controlled"),
    // never off in a corner. Above his head, its tip pointing down at him; if the ball is where the card
    // would be, it slides to his side away from the ball (still touching him); near the top of the screen it
    // hangs under his feet instead. Never over the score, or the bottom touch controls.
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    const feet = project(frame[a], 0, frame[a + 1]);
    let x = at.x - cw / 2;
    let y = at.y - ch - CARD_GAP;
    let below = false;
    if (y < 70) {
      y = feet.y + CARD_GAP;
      below = true;
    }
    const ball = project(frame[BALL_OFS], 0.14, frame[BALL_OFS + 2]);
    if (ball.visible && ball.x > x - 24 && ball.x < x + cw + 24 && ball.y > y - 24 && ball.y < y + ch + 24) {
      x = ball.x > at.x ? at.x - cw + CARD_TIP_IN : at.x - CARD_TIP_IN;
    }
    x = clamp(x, 10, w - cw - 10);
    y = clamp(y, 70, h - ch - 90);
    // The tip sits over the player, wherever the card had to slide.
    this.card.style.setProperty('--tip', `${Math.round(clamp(at.x - x, 12, cw - 12))}px`);
    this.card.classList.toggle('below', below);
    this.card.style.visibility = 'visible';
    this.card.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
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
    this.recipient.style.transform = `translate(${Math.round(tag.x)}px,${Math.round(tag.y - 12)}px) translate(-50%,-100%)`;
    if (this.target !== idx || this.recipient.dataset.device !== device) {
      this.target = idx;
      this.recipient.dataset.device = device;
      this.recipient.innerHTML = `${escHtml(actionKey('pass', device))}${sep()}${escHtml(String(m.players[idx].def.number))}`;
    }
  }
}
