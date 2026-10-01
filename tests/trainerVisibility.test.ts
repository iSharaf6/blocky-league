import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { FRAME_LEN, PF, writeFrame } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { PITCH_Y } from '../src/render/stadium';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { applyScenario } from '../src/sim/scenario';
import { Lesson, Trainer } from '../src/ui/trainer';

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

function expectInside(card: ElementDouble, viewport: Viewport): void {
  const position = /^translate\((-?\d+)px,(-?\d+)px\)$/.exec(card.style.transform);
  expect(position).not.toBeNull();
  const x = Number(position![1]), y = Number(position![2]);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + card.offsetWidth).toBeLessThanOrEqual(viewport.width);
  expect(y + card.offsetHeight).toBeLessThanOrEqual(viewport.height);
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
    expect(p.root.querySelector('.trainer-title').textContent).toBe('CROSS');
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
      expect(p.card.style.visibility).toBe('visible');
      expect(p.root.querySelector('.trainer-title').textContent).toBe('SHOOT');
      expect(p.root.querySelector('.trainer-actions').textContent).toContain('Tap to finish the incoming cross');
      expect(p.card.classList.contains('docked')).toBe(true);
      expectInside(p.card, viewport);
    }
    expect(p.m.clock).toBe(clock);
    expect(p.lesson.hold(p.m, { ...controls, shoot: true })).toBe(false);
  });

  it('returns to the player anchor when the receiver comes back into view', () => {
    const viewport = viewports[0];
    const p = setup();
    cross(p);
    const offscreen = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, 40);
    p.trainer.update(p.m, p.frame, offscreen, head, 'touch', controls);
    expect(p.card.classList.contains('docked')).toBe(true);
    const onscreen = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, viewport.height / 2);
    p.trainer.update(p.m, p.frame, onscreen, head, 'touch', controls);
    expect(p.root.hidden).toBe(false);
    expect(p.card.classList.contains('docked')).toBe(false);
    expect(p.root.querySelector('.trainer-title').textContent).toBe('SHOOT');
    expectInside(p.card, viewport);
  });

  it('continues hiding ordinary match guidance for an offscreen player', () => {
    const viewport = viewports[0];
    const p = setup();
    Trainer.lesson = null;
    const onscreen = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, viewport.height / 2);
    p.trainer.update(p.m, p.frame, onscreen, head, 'touch', controls);
    expect(p.root.hidden).toBe(false);
    const offscreen = cameraFor(p.frame, p.m.active, viewport, viewport.width / 2, 40);
    p.trainer.update(p.m, p.frame, offscreen, head, 'touch', controls);
    expect(p.root.hidden).toBe(true);
    expect(p.trainer.waitingFor).toBeNull();
  });
});
