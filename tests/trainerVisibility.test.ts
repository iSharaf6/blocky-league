import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { FRAME_LEN, PF, writeFrame } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { PITCH_Y } from '../src/render/stadium';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { applyScenario } from '../src/sim/scenario';
import { BAR_HOLD_MS, Lesson, Trainer, barSituation, controlsCue, lessonCue } from '../src/ui/trainer';

// The cards' words come from the cue builders (the copy can change; what is checked is that the right card shows).
const CROSS_CUE = lessonCue(BASICS[2].lesson[0], 'touch');
const FINISH_CUE = lessonCue(BASICS[2].lesson[1], 'touch');

/** Only the DOM operations the trainer uses; projection and match state remain real. */
class ElementDouble {
  hidden = false;
  className = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  offsetWidth = 320;
  offsetHeight = 96;
  private ownText = '';
  private children: ElementDouble[] = [];
  private selectors = new Map<string, ElementDouble>();
  private classes = new Set<string>();
  readonly style = {
    display: '', visibility: '', transform: '',
    setProperty: (_key: string, _value: string) => {},
  };
  readonly classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const add = force ?? !this.classes.has(name);
      if (add) this.classes.add(name); else this.classes.delete(name);
      return add;
    },
  };
  get textContent(): string { return this.ownText + this.children.map((node) => node.textContent).join(''); }
  set textContent(text: string) { this.ownText = text; this.children = []; }
  querySelector(selector: string): ElementDouble {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new ElementDouble());
    return this.selectors.get(selector)!;
  }
  append(...nodes: ElementDouble[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: ElementDouble[]): void { this.children = nodes; this.ownText = ''; }
  setAttribute(_name: string, _value: string): void {}
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 0, top: 0, right: this.offsetWidth, bottom: this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
  }
}

const controls = { sx: 0, sy: 0, pass: false, shoot: false, through: false, sprint: false };
const viewports = [
  { name: 'mobile portrait', width: 390, height: 844 },
  { name: 'narrow portrait', width: 320, height: 568 },
  { name: 'mobile landscape', width: 844, height: 390 },
  { name: 'small landscape', width: 568, height: 240 },
];
type Viewport = typeof viewports[number];
const head = 1.8;

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
  vi.stubGlobal('document', {
    createElement: () => new ElementDouble(),
    createTextNode: (text: string) => {
      const node = new ElementDouble();
      node.textContent = text;
      return node;
    },
  });
  Trainer.lesson = null;
  Trainer.input = null;
  Trainer.taught = false;
});

afterEach(() => {
  Trainer.lesson = null;
  Trainer.input = null;
  Trainer.taught = false;
  vi.unstubAllGlobals();
});

function setup() {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 1, assist: 0.8,
  });
  applyScenario(m, BASICS[2].spec);
  const lesson = new Lesson(BASICS[2].lesson);
  Trainer.lesson = lesson;
  const trainer = new Trainer();
  const root = trainer.root as unknown as ElementDouble;
  const card = root.querySelector('.trainer-card');
  const frame = new Float32Array(FRAME_LEN);
  writeFrame(m, frame, 0);
  return { m, lesson, trainer, root, card, frame };
}

/** A real camera puts the active player's projection at a known screen position. */
function cameraFor(frame: Float32Array, active: number, viewport: Viewport, x: number, y: number, clipped = false) {
  const camera = new OrthographicCamera(-50, 50, 40, -40, 0.1, clipped ? 1 : 100);
  const cx = frame[active * PF] + (2 * x / viewport.width - 1) * 50;
  const cz = frame[active * PF + 1] - (1 - 2 * y / viewport.height) * 40;
  camera.up.set(0, 0, 1);
  camera.position.set(cx, 50, cz);
  camera.lookAt(cx, 0, cz);
  camera.updateMatrixWorld();
  const projected = new Vector3(frame[active * PF], head + frame[active * PF + 2] + PITCH_Y, frame[active * PF + 1]).project(camera);
  expect((projected.x + 1) * viewport.width / 2).toBeCloseTo(x);
  expect((1 - projected.y) * viewport.height / 2).toBeCloseTo(y);
  if (clipped) expect(projected.z).toBeGreaterThan(1);
  return camera;
}

function cross(p: ReturnType<typeof setup>): void {
  let kicked = false;
  for (let i = 0; i < 90 && !kicked; i++) {
    const pad = { ...EMPTY_PAD, through: i * DT < 0.7 };
    if (p.lesson.hold(p.m, { ...controls, through: pad.through })) continue;
    p.m.step(DT, pad);
    for (const event of p.m.drainEvents()) {
      p.lesson.event(event, p.m);
      if (event.type === 'kick' && event.kind === 'lob') kicked = true;
    }
  }
  expect(kicked).toBe(true);
  expect(p.m.ball.owner).toBe(-1);
  expect(p.m.passTarget).toBe(p.m.active);
  expect(p.lesson.current?.when).toBe('incoming');
  expect(p.lesson.hold(p.m, controls)).toBe(true);
  writeFrame(p.m, p.frame, p.m.clock);
}

/**
 * The card is never placed from code: it is fixed at the bottom centre by coach.css (CrazyGames' review: the text
 * over the player "moves so fast and changes frequently"). No inline position, no pointer at a player.
 */
function expectFixed(card: ElementDouble): void {
  expect(card.style.transform).toBe('');
  expect(card.classList.contains('docked')).toBe(false);
  expect(card.classList.contains('below')).toBe(false);
}

describe('tutorial instructions for an offscreen receiver', () => {
  it.each(viewports.flatMap((viewport) => ['above', 'left', 'right', 'below', 'clipped'].map((edge) => ({ ...viewport, edge }))))
  ('keeps the incoming cue visible in $name when the receiver is $edge', (viewport) => {
    window.innerWidth = viewport.width;
    window.innerHeight = viewport.height;
    const p = setup();
    p.card.offsetWidth = Math.min(340, viewport.width - 24);
    const initialCamera = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, viewport.height / 2);
    p.trainer.update(p.m, p.frame, initialCamera, head, 'touch', controls);
    expect(p.root.querySelector('.trainer-title').textContent).toBe(CROSS_CUE.title);
    cross(p);
    const x = viewport.edge === 'left' ? -40 : viewport.edge === 'right' ? viewport.width + 40 : viewport.width / 2;
    const y = viewport.edge === 'above' ? 40 : viewport.edge === 'below' ? viewport.height - 10 : viewport.height / 2;
    const camera = cameraFor(p.frame, p.m.active, viewport, x, y, viewport.edge === 'clipped');
    const clock = p.m.clock;
    // While the actual incoming lesson pauses the flight, its next action must replace the stale CROSS card.
    for (let i = 0; i < 30; i++) {
      expect(p.lesson.hold(p.m, controls)).toBe(true);
      p.trainer.update(p.m, p.frame, camera, head, 'touch', controls);
      expect(p.root.hidden).toBe(false);
      expect(p.card.hidden).toBe(false);
      expect(p.root.querySelector('.trainer-title').textContent).toBe(FINISH_CUE.title);
      expect(p.root.querySelector('.trainer-actions').textContent).toContain(FINISH_CUE.actions[0][1]);
      expect(p.card.classList.contains('lesson')).toBe(true);
      expectFixed(p.card);
    }
    expect(p.m.clock).toBe(clock);
    expect(p.lesson.hold(p.m, { ...controls, shoot: true })).toBe(false);
  });
});

describe('the controls bar: fixed at the bottom, steady, every key with its word (CrazyGames review)', () => {
  /** The bar in a match (no lesson), keys on the keyboard, with the clock in the test's hands. */
  function bar() {
    const p = setup();
    Trainer.lesson = null;
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const viewport = viewports[2];
    const camera = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, viewport.height / 2);
    const words = () => p.root.querySelector('.trainer-actions').textContent;
    const tick = (ms = 1000 / 60, device: 'keyboard' | 'touch' = 'keyboard') => {
      now += ms;
      p.trainer.update(p.m, p.frame, camera, head, device, controls);
    };
    const opponent = p.m.players.findIndex((pl) => pl.side !== p.m.cfg.humanSide);
    const mate = p.m.players.findIndex((pl) => pl.side === p.m.cfg.humanSide && pl.idx !== p.m.active);
    return { ...p, words, tick, opponent, mate, camera };
  }
  afterEach(() => vi.restoreAllMocks());

  it('says what he can do with the ball, and without it, in words: PASS SHOOT THROUGH SKILL, SWITCH TACKLE PRESS', () => {
    const p = bar();
    p.m.ball.owner = p.m.active;
    p.m.ball.held = false;
    expect(barSituation(p.m)).toBe('ball');
    const on = controlsCue(p.m, 'keyboard');
    expect(on.actions.map(([, w]) => w)).toEqual(['PASS', 'SHOOT', 'THROUGH', 'SKILL']);
    expect(on.actions[0][0]).toBe('SPACE');
    for (const [k] of on.actions) expect(k).not.toBe('');
    p.m.ball.owner = p.opponent;
    expect(barSituation(p.m)).toBe('off');
    expect(controlsCue(p.m, 'keyboard').actions.map(([, w]) => w)).toEqual(['SWITCH', 'TACKLE', 'PRESS']);
    p.m.ball.owner = p.mate;
    expect(barSituation(p.m)).toBe('mates');
    expect(controlsCue(p.m, 'keyboard').actions.map(([, w]) => w)).toEqual(['SPRINT', 'SWITCH']);
    // (Upper case, no separators in the words.)
    for (const sit of [p.m.active, p.opponent, p.mate]) {
      p.m.ball.owner = sit;
      for (const [, w] of controlsCue(p.m, 'keyboard').actions) expect(w).toMatch(/^[A-Z ]+$/);
    }
  });

  it('never placed over the player: shown wherever he is on screen, with no title, and no words over anyone', () => {
    const p = bar();
    p.m.ball.owner = p.m.active;
    for (const viewport of viewports) {
      window.innerWidth = viewport.width;
      window.innerHeight = viewport.height;
      for (const [x, y] of [[viewport.width / 2, viewport.height / 2], [viewport.width / 2, 40], [-40, viewport.height / 2]]) {
        p.trainer.update(p.m, p.frame, cameraFor(p.frame, p.m.active, viewport, x, y), head, 'keyboard', controls);
        expect(p.root.hidden).toBe(false);
        expect(p.card.hidden).toBe(false);
        expect(p.card.classList.contains('bar')).toBe(true);
        expectFixed(p.card);
        expect(p.words()).toContain('PASS');
      }
    }
    // The pass receiver's tag (a key and his number over him) is gone: only the lane's line is left.
    expect((p.trainer.root as unknown as ElementDouble).innerHTML).not.toContain('trainer-recipient');
  });

  it('changes only once a new situation has held 0.6 s: a ball won and lost again at once does not flicker it', () => {
    const p = bar();
    p.m.ball.owner = p.m.active;
    p.tick();
    expect(p.words()).toContain('SHOOT');
    // Lost and won back inside the hold, again and again: the bar does not move.
    for (let i = 0; i < 10; i++) {
      p.m.ball.owner = p.opponent;
      for (let f = 0; f < 20; f++) p.tick();
      expect(p.words()).toContain('SHOOT');
      p.m.ball.owner = p.m.active;
      p.tick();
      expect(p.words()).toContain('SHOOT');
    }
    // Lost for good: the bar holds through the first 0.6 s, then says what he can do without it.
    p.m.ball.owner = p.opponent;
    p.tick();
    p.tick(BAR_HOLD_MS - 50);
    expect(p.words()).toContain('SHOOT');
    p.tick(60);
    expect(p.words()).toContain('TACKLE');
    expect(p.words()).not.toContain('SHOOT');
    expect(BAR_HOLD_MS).toBeGreaterThanOrEqual(600);
  });

  it('back in play after a stoppage it shows the situation as it is then, at once', () => {
    const p = bar();
    p.m.ball.owner = p.m.active;
    p.tick();
    p.trainer.hide();
    p.m.ball.owner = p.opponent;
    p.tick();
    expect(p.words()).toContain('TACKLE');
  });

  it('on touch the bar is off (the buttons wear their own words); a lesson still shows there', () => {
    const p = bar();
    p.m.ball.owner = p.m.active;
    p.tick(16, 'touch');
    expect(p.card.hidden).toBe(true);
    p.tick(16, 'keyboard');
    expect(p.card.hidden).toBe(false);
  });
});
