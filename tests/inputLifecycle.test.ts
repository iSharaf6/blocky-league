import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, setBindings } from '../src/core/input';
import { Menus } from '../src/ui/menus';
import { TouchControls } from '../src/ui/touch';
import { buzz } from '../src/platform/haptics';
import { defaultSave } from '../src/core/save';
import { openAccountPanel } from '../src/ui/account';
import { _resetForTests as resetCloud, _setEnvForTests } from '../src/platform/cloud';

vi.mock('../src/platform/haptics', async (original) => ({
  ...await original<typeof import('../src/platform/haptics')>(),
  buzz: vi.fn(),
}));

/** Event-capable elements for testing focus and pointer lifecycles without a WebGL renderer. */
class Element extends EventTarget {
  tagName = 'DIV';
  dataset: Record<string, string> = {};
  innerHTML = '';
  textContent = '';
  className = '';
  hidden = false;
  removed = false;
  children: Element[] = [];
  private matches = new Map<string, Element>();
  private classes = new Set<string>();
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const v = on ?? !this.classes.has(c);
      if (v) this.classes.add(c); else this.classes.delete(c);
      return v;
    },
  };
  style = { left: '', top: '', transform: '', setProperty: vi.fn() };
  querySelector(selector: string): Element {
    let el = this.matches.get(selector);
    if (!el) {
      el = new Element();
      this.matches.set(selector, el);
    }
    return el;
  }
  querySelectorAll(selector: string): Element[] {
    if (selector !== '.tb:not(.tb-power)') return [];
    return ['pass', 'shoot', 'through', 'keeper', 'skill'].map((k) => {
      const el = this.querySelector(`.tb-${k}`);
      el.dataset.k = k;
      return el;
    });
  }
  appendChild(el: Element): void { this.children.push(el); }
  remove(): void { this.removed = true; }
  focus(): void {}
  setAttribute(): void {}
  setPointerCapture(): void {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 112, height: 112 }; }
}

let win: EventTarget;
let doc: EventTarget & { hidden: boolean };
let root: Element;

function key(code: string, repeat = false, origin?: Element): Event {
  const e = new Event('keydown', { cancelable: true });
  Object.assign(e, { code, key: code, repeat });
  if (origin) Object.defineProperty(e, 'target', { value: origin });
  win.dispatchEvent(e);
  return e;
}

function pointer(el: Element, type: string, pointerId = 1, clientX = 0, clientY = 0): void {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { pointerId, clientX, clientY });
  el.dispatchEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  root = new Element();
  win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  doc = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: () => root,
    createElement: () => new Element(),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', {});
  resetCloud();
  _setEnvForTests({});
  setBindings();
});

afterEach(() => {
  resetCloud();
  _setEnvForTests(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('embedded input and focus', () => {
  it('keeps keyboard play working when frame policy denies gamepad access', () => {
    vi.stubGlobal('navigator', { getGamepads: () => { throw new DOMException('Denied', 'SecurityError'); } });
    const input = new Input();
    key('KeyW');
    expect(input.read().sy).toBe(1);
    expect(input.gamepadPause()).toBe(false);
    expect(Input.padButtonDown(new Set())).toBe(-1);
    expect(Input.padButtonsHeld().size).toBe(0);
  });

  it('clears keyboard and touch holds on blur and hidden-tab transitions', () => {
    const input = new Input();
    key('KeyW');
    Object.assign(input.touch, { enabled: true, sx: 1, sy: 0, shoot: true });
    win.dispatchEvent(new Event('blur'));
    expect(input.read()).toEqual({ sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false, power: false, skill: false });
    key('Space');
    input.touch.through = true;
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(input.read().pass).toBe(false);
    expect(input.read().through).toBe(false);
  });

  it('reports a d-pad as a gamepad and limits diagonals to the stick maximum', () => {
    const buttons = Array.from({ length: 18 }, (_, i) => ({ pressed: i === 12 || i === 15, value: 0 }));
    vi.stubGlobal('navigator', { getGamepads: () => [{ axes: [0, 0], buttons }] });
    const input = new Input();
    const c = input.read();
    expect(Math.hypot(c.sx, c.sy)).toBeCloseTo(1);
    expect(c.sx).toBeGreaterThan(0);
    expect(c.sy).toBeGreaterThan(0);
    expect(input.lastDevice).toBe('gamepad');
  });
});

describe('menu keyboard lifecycle', () => {
  it('the developer screen returns by its back button and retires its Escape shortcut', () => {
    const menus = new Menus();
    const back = vi.fn(() => menus.close());
    menus.developerAbout(back);
    const screen = root.children.at(-1)!;
    expect(screen.innerHTML).toContain('data-a="back"');
    screen.querySelector('[data-a=back]').dispatchEvent(new Event('click'));
    key('Escape');
    expect(back).toHaveBeenCalledOnce();
    expect(menus.open).toBe(false);
  });

  it('Settings > More opens About without carrying the settings Escape shortcut into it', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const menus = new Menus();
    const settingsBack = vi.fn();
    const destinationBack = vi.fn(() => menus.close());
    const open = vi.fn(() => menus.developerAbout(destinationBack));
    menus.settings(defaultSave(), vi.fn(), settingsBack, 'more', { about: open });
    const screen = root.children.at(-1)!;
    expect(screen.innerHTML).toContain('data-a="about"');
    screen.querySelector('[data-a=about]').dispatchEvent(new Event('click'));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.removed).toBe(true);
    key('Escape');
    expect(destinationBack).toHaveBeenCalledOnce();
    expect(settingsBack).not.toHaveBeenCalled();
  });

  it.each([
    ['account', 'body'], ['account', 'button'], ['account', 'input'],
    ['invite', 'body'], ['invite', 'button'], ['invite', 'input'],
  ] as const)('Settings > More opens the real %s overlay; Escape from %s focus returns only to settings', (action, focus) => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const menus = new Menus();
    const save = defaultSave();
    const settingsBack = vi.fn(() => menus.close());
    const ctx = { save, persist: vi.fn(), reload: vi.fn() };
    const showSettings = (): void => menus.settings(save, vi.fn(), settingsBack, 'more', {
      [action]: () => openAccountPanel(ctx, showSettings, action === 'invite' ? 'friend' : 'main'),
    });
    showSettings();
    const settings = root.children.at(-1)!;
    settings.querySelector(`[data-a=${action}]`).dispatchEvent(new Event('click'));
    const overlay = root.children.at(-1)!;
    expect(overlay.className).toContain('ac-account');
    expect(overlay.querySelector('.panel').innerHTML).toContain(action === 'invite' ? 'INVITE FRIENDS' : 'ACCOUNT');
    expect(settings.removed).toBe(true);
    expect(menus.open).toBe(false);

    const origin = new Element();
    origin.tagName = focus.toUpperCase();
    key('Escape', true, origin);
    expect(overlay.removed).toBe(false);
    expect(key('Escape', false, origin).defaultPrevented).toBe(true);
    expect(overlay.removed).toBe(true);
    expect(menus.open).toBe(true);
    // onClose mounts settings synchronously; the original Escape must not reach its new shortcut.
    expect(settingsBack).not.toHaveBeenCalled();
    key('Escape');
    expect(settingsBack).toHaveBeenCalledOnce();
  });

  it('replacing an account overlay retires its closure and leaves no Escape shortcut after closing', () => {
    const ctx = { save: defaultSave(), persist: vi.fn(), reload: vi.fn() };
    const firstBack = vi.fn();
    const secondBack = vi.fn();
    openAccountPanel(ctx, firstBack);
    const first = root.children.at(-1)!;
    openAccountPanel(ctx, secondBack, 'friend');
    const second = root.children.at(-1)!;
    expect(first.removed).toBe(true);
    key('Escape');
    expect(second.removed).toBe(true);
    expect(secondBack).toHaveBeenCalledOnce();
    expect(firstBack).not.toHaveBeenCalled();
    expect(key('Escape').defaultPrevented).toBe(false);
    expect(secondBack).toHaveBeenCalledOnce();
  });

  it('retiring a pause screen removes its Escape handler before controls open', () => {
    const menus = new Menus();
    const resume = vi.fn();
    menus.pause({ resume, howto: () => menus.howTo(() => {}, 'keyboard'), quit: vi.fn(), settings: vi.fn() });
    root.children.at(-1)!.querySelector('[data-a=howto]').dispatchEvent(new Event('click'));
    key('Escape');
    expect(resume).not.toHaveBeenCalled();
    expect(menus.open).toBe(true);
    menus.close();
  });

  it('ignores held pause repeats and removes shortcuts when closed or resumed', () => {
    const menus = new Menus();
    const resume = vi.fn(() => menus.close());
    menus.pause({ resume, howto: vi.fn(), quit: vi.fn(), settings: vi.fn() });
    key('Escape', true);
    expect(resume).not.toHaveBeenCalled();
    key('Escape');
    key('Escape');
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe('touch lifecycle', () => {
  it('notifies the session immediately when TAP TO SKIP is tapped, even while controls are hidden', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    touch.setVisible(false);
    const onPress = vi.fn();
    touch.onPress = onPress;
    pointer((touch.root as unknown as Element).querySelector('.touch-skip'), 'pointerdown');
    expect(onPress).toHaveBeenCalledExactlyOnceWith('pass');
    expect(input.read().pass).toBe(true);
    vi.advanceTimersByTime(121);
    expect(input.read().pass).toBe(false);
    expect(onPress).toHaveBeenCalledOnce();
    touch.dispose();
  });

  it('acknowledges every attack, defence, keeper and power button once per press, even before an action succeeds', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    const el = touch.root as unknown as Element;
    for (const ctx of ['attack', 'defend'] as const) {
      touch.setContext(ctx);
      for (const k of ['pass', 'shoot', 'through', 'skill', 'keeper']) {
        const b = el.querySelector(`.tb-${k}`);
        const before = vi.mocked(buzz).mock.calls.length;
        pointer(b, 'pointerdown');
        expect(buzz).toHaveBeenLastCalledWith('button');
        expect(vi.mocked(buzz).mock.calls.length).toBe(before + 1);
        // A held PRESS / keeper rush / charge is sampled every frame, but never repeats the acknowledgement.
        for (let frame = 0; frame < 120; frame++) input.read();
        pointer(b, 'pointerdown', 2);
        pointer(b, 'pointerup', 2);
        expect(b.classList.contains('down')).toBe(true);
        expect(vi.mocked(buzz).mock.calls.length).toBe(before + 1);
        pointer(b, 'pointercancel');
      }
    }
    const before = vi.mocked(buzz).mock.calls.length;
    pointer(el.querySelector('.tb-power'), 'pointerdown');
    pointer(el.querySelector('.tb-power'), 'pointerdown', 2);
    vi.advanceTimersByTime(1000);
    expect(vi.mocked(buzz).mock.calls.length).toBe(before + 1);
    touch.setVisible(false);
    pointer(el.querySelector('.touch-skip'), 'pointerdown');
    expect(vi.mocked(buzz).mock.calls.length).toBe(before + 2);
    touch.dispose();
  });

  it('drops stick and action holds on blur, then accepts a fresh touch', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    const el = touch.root as unknown as Element;
    const stick = el.querySelector('.touch-stick-zone');
    pointer(stick, 'pointerdown', 1);
    pointer(stick, 'pointermove', 1, 50, 0);
    pointer(el.querySelector('.tb-shoot'), 'pointerdown', 2);
    expect(input.read().sx).toBeGreaterThan(0);
    expect(input.read().shoot).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(input.read().sx).toBe(0);
    expect(input.read().shoot).toBe(false);
    pointer(stick, 'pointerdown', 3);
    pointer(stick, 'pointermove', 3, 30, 0);
    expect(input.read().sx).toBeGreaterThan(0);
    touch.dispose();
  });

  it('without the ball the big button is PRESS and the top one SWITCH; a held press keeps what it sent', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    const pressed: string[] = [];
    touch.onPress = (k) => pressed.push(k);
    const el = touch.root as unknown as Element;
    const big = el.querySelector('.tb-pass');
    const top = el.querySelector('.tb-through');
    expect(touch.labels).toEqual(['PASS', 'SHOOT', 'THROUGH']);
    touch.setContext('defend');
    expect(touch.labels).toEqual(['PRESS', 'TACKLE', 'SWITCH']);
    pointer(big, 'pointerdown', 1);
    expect(input.read().through).toBe(true);
    expect(input.read().pass).toBe(false);
    // Won the ball mid-press: the held button is still PRESS until it's let go.
    touch.setContext('attack');
    expect(input.read().through).toBe(true);
    pointer(big, 'pointerup', 1);
    expect(input.read().through).toBe(false);
    pointer(big, 'pointerdown', 2);
    expect(input.read().pass).toBe(true);
    pointer(big, 'pointerup', 2);
    touch.setContext('defend');
    pointer(top, 'pointerdown', 3);
    expect(input.read().pass).toBe(true);
    expect(input.read().through).toBe(false);
    pointer(top, 'pointerup', 3);
    expect(pressed).toEqual(['through', 'pass', 'pass']);
    touch.dispose();
  });

  it('there is no SPRINT button; KEEPER is the pad\'s SKILL while it is held, and hiding it lets go', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    const el = touch.root as unknown as Element;
    expect(el.innerHTML).not.toContain('tb-sprint');
    expect(el.innerHTML).not.toContain('SPRINT');
    expect(el.innerHTML).toContain('tb-keeper');
    const keeper = el.querySelector('.tb-keeper');
    touch.setContext('defend');
    touch.setKeeper(true);
    expect(el.classList.contains('keeper-on')).toBe(true);
    pointer(keeper, 'pointerdown', 1);
    expect(input.read().skill).toBe(true);
    expect(input.read().sprint).toBe(false);
    pointer(keeper, 'pointerup', 1);
    expect(input.read().skill).toBe(false);
    // Held as the ball is won (the button goes): the hold is over.
    pointer(keeper, 'pointerdown', 2);
    expect(input.read().skill).toBe(true);
    touch.setKeeper(false);
    expect(el.classList.contains('keeper-on')).toBe(false);
    expect(input.read().skill).toBe(false);
    // TACKLE lights up while the carrier is in reach.
    touch.setTackleReady(true);
    expect(el.classList.contains('tackle-ready')).toBe(true);
    touch.setTackleReady(false);
    expect(el.classList.contains('tackle-ready')).toBe(false);
    touch.dispose();
  });

  it('disposes held controls and tap timers before the next match reuses Input', () => {
    const input = new Input();
    const touch = new TouchControls(input);
    touch.setEnabled(true);
    const el = touch.root as unknown as Element;
    pointer(el.querySelector('.tb-shoot'), 'pointerdown');
    pointer(el.querySelector('.tb-power'), 'pointerdown');
    pointer(el.querySelector('.touch-skip'), 'pointerdown');
    touch.dispose();
    expect(input.touch.enabled).toBe(false);
    expect(el.removed).toBe(true);
    input.touch.enabled = true;
    vi.runAllTimers();
    expect(input.read().shoot).toBe(false);
    expect(input.read().pass).toBe(false);
    expect(input.read().power).toBe(false);
  });
});
