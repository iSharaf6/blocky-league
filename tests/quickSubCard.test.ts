import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, setBindings } from '../src/core/input';
import { QuickSubs } from '../src/game/quickSub';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import { QuickSubCard } from '../src/ui/quickSub';

/** Event-capable DOM endpoints: the card, input bindings and substitution rules themselves are real. */
class Element extends EventTarget {
  innerHTML = '';
  textContent = '';
  className = '';
  parentElement = null;
  style = { width: '', background: '', top: '' };
  private children = new Map<string, Element>();
  private classes = new Set<string>();
  classList = {
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on = !this.classes.has(c)) => {
      if (on) this.classes.add(c); else this.classes.delete(c);
      return on;
    },
  };
  querySelector(selector: string): Element {
    let child = this.children.get(selector);
    if (!child) this.children.set(selector, child = new Element());
    return child;
  }
  querySelectorAll(selector: string): Element[] {
    return selector === '.qs-b-row' ? [this.querySelector('.off'), this.querySelector('.on')] : [];
  }
  setAttribute(): void {}
  remove(): void {}
  blur(): void {}
}

let now = 1_000;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element() }));
  vi.stubGlobal('navigator', {});
  setBindings();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function rig() {
  const match = new Match({ home: makeTeam(PRESET_CLUBS[4]), away: makeTeam(PRESET_CLUBS[5]),
    halfLength: 120, difficulty: 2, humanSide: 0, seed: 3 });
  match.phase = 'play';
  match.restart = null;
  match.drainEvents();
  match.teamPlayers(0)[7].stamina = 0.2;
  const qs = new QuickSubs(match, 0);
  const input = new Input();
  input.lastDevice = 'touch';
  const card = new QuickSubCard(qs, input);
  const root = card.root as unknown as Element;
  const run = (seconds: number, shown = true, ready = true) => {
    for (let t = 0; t < seconds; t += DT) {
      now += DT * 1_000;
      card.update(DT, shown, ready);
    }
  };
  const press = () => {
    const e = new Event('pointerdown', { cancelable: true });
    Object.assign(e, { pointerType: 'touch', button: 0 });
    root.querySelector('.qs-go').dispatchEvent(e);
    return e;
  };
  run(0.6);
  return { match, qs, card, root, run, press };
}

describe('recommended substitution card lifecycle', () => {
  it('clears accepted feedback during a long attack, then performs the queued change once the ball is dead', () => {
    const h = rig();
    expect(h.root.classList.contains('card-on')).toBe(true);
    const replacement = h.qs.offer!.on.id;
    expect(h.press().defaultPrevented).toBe(true);
    h.run(DT);
    expect(h.qs.mode).toBe('queued');
    expect(h.root.querySelector('.qs-title').textContent).toBe('AT NEXT STOPPAGE');
    expect(h.root.querySelector('.qs-go-t').textContent).toBe('UNDO');
    h.run(5);
    expect(h.root.classList.contains('on')).toBe(false);
    expect(h.root.classList.contains('card-on')).toBe(false);
    h.run(90);
    expect(h.root.classList.contains('on')).toBe(false);
    expect(h.qs.mode).toBe('queued');
    expect(h.match.subsUsed[0]).toBe(0);
    h.match.phase = 'out';
    h.run(DT);
    expect(h.match.teamPlayers(0)[7].def.id).toBe(replacement);
    expect(h.match.subsUsed[0]).toBe(1);
    expect(h.root.classList.contains('board-on')).toBe(true);
    h.run(5);
    expect(h.root.classList.contains('on')).toBe(false);
    expect(h.match.subsUsed[0]).toBe(1);
    h.card.dispose();
  });

  it('allows Undo while the acknowledgement is visible and never makes that cancelled change', () => {
    const h = rig();
    h.press();
    h.run(0.6);
    h.press();
    h.run(DT);
    expect(h.qs.mode).toBe('idle');
    expect(h.root.classList.contains('on')).toBe(false);
    h.match.phase = 'out';
    h.run(3);
    expect(h.match.subsUsed[0]).toBe(0);
    h.card.dispose();
  });

  it('does not reopen expired accepted feedback after a replay or pause', () => {
    const h = rig();
    h.press();
    h.run(5);
    h.run(20, false, false);
    h.run(1);
    expect(h.root.classList.contains('card-on')).toBe(false);
    expect(h.qs.mode).toBe('queued');
    expect(h.match.subsUsed[0]).toBe(0);
    h.card.dispose();
  });

  it('keeps the acknowledgement and Undo window when a replay interrupts immediately after accepting', () => {
    const h = rig();
    h.press();
    h.run(0.2);
    h.run(20, false, false);
    expect(h.root.classList.contains('card-on')).toBe(false);
    h.run(0.5);
    expect(h.root.classList.contains('card-on')).toBe(true);
    h.press();
    h.run(DT);
    expect(h.qs.mode).toBe('idle');
    expect(h.root.classList.contains('on')).toBe(false);
    h.card.dispose();
  });
});
