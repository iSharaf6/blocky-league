/**
 * The coach: ONE card for every instruction the game gives during play, and the words on it.
 *
 *  - the on-pitch trainer (ui/trainer.ts): contextual tips over the controlled player, the first match's MOVE
 *    and PASS steps and the LEARN THE BASICS prompts (the `lesson` variant: a size up, the key cap bobbing);
 *  - the set-piece / penalty / shootout / keeper's-ball hint (Hud.setHint) and the first-match tutorial tip
 *    for players who turned the trainer off (Hud.setTip).
 *
 * All of them are a CoachCue: a TITLE (1 to 3 words, capitals, no hyphens: the situation or the action), up to
 * three actions (a key cap, then a short imperative: "Pass", "Hold to press", "Let go to shoot") and an
 * optional one-line detail (one fact, a short plain sentence). The cap is the player's own binding on keys and
 * pads (core/input.ts actionKey) and the label on the touch button on screen (it changes with the situation:
 * PASS / SWITCH...). A label never repeats the key name (the cap shows it; on touch a label that IS the button's
 * name is left off). "Tap" is only said on touch; keys and pads "press". No dot or dash separators anywhere:
 * separate facts are separate rows.
 *
 * The look lives in coach.css (dark ink card, gold top rule, Silkscreen title, Lilita One words, cream key
 * caps, a short rise in, gone at once). Where each card sits is its owner's business (the trainer rides on the
 * controlled player; the hint and the tip have their HUD slots).
 */
import './coach.css';
import { actionKey, bindings, keyLabel, moveKeys, padLabel, PAD_ACTIONS, type Device, type PadAction } from '../core/input';
import type { RestartKind } from '../sim/types';

export interface CoachCue {
  /** 1 to 3 words in capitals ('' for none: a hint written as plain text). */
  title: string;
  /** [key cap, what it does]. An empty cap draws the words alone. */
  actions: [string, string][];
  /** One short sentence (optional). */
  detail?: string;
}

/** Which labels the touch buttons wear (mirrors ui/touch.ts LABELS): with the ball, defending, at a set piece. */
export type CoachCtx = 'attack' | 'defend' | 'setpiece' | 'delivery';
const TOUCH_BUTTONS: Record<CoachCtx, Record<'pass' | 'shoot' | 'through', string>> = {
  attack: { pass: 'PASS', shoot: 'SHOOT', through: 'THROUGH' },
  defend: { pass: 'SWITCH', shoot: 'TACKLE', through: 'PRESS' },
  setpiece: { pass: 'PASS', shoot: 'SHOOT', through: 'CROSS' },
  // His corner or wide free kick (sim/setPiece.ts): the three deliveries.
  delivery: { pass: 'SHORT', shoot: 'DRIVEN', through: 'CROSS' },
};

/** The key cap for an action: the bound key / pad button, or the touch button's label in this situation. */
export function keyCap(action: PadAction, device: Device, ctx: CoachCtx = 'attack'): string {
  if (device === 'touch' && (action === 'pass' || action === 'shoot' || action === 'through')) return TOUCH_BUTTONS[ctx][action];
  return actionKey(action, device);
}

/** The movement cap: the four keys as bound ("WASD", "ARROWS", "I J K L"), or STICK. */
export function moveCap(device: Device): string {
  return device === 'keyboard' ? moveKeys('keyboard').split(' / ')[0] : 'STICK';
}

/** A quick press, in the device's own word: "Tap" on a touch screen, "Press" on keys and pads. */
export function pressVerb(device: Device): string {
  return device === 'touch' ? 'Tap' : 'Press';
}

/** Copy with a {tap} / {Tap} token in it, the verb filled for the device in hand. */
export function coachText(text: string, device: Device): string {
  const v = pressVerb(device);
  return text.replace(/\{Tap\}/g, v).replace(/\{tap\}/g, v.toLowerCase());
}

// ------------------------------------------------------------------ cards shown in more than one place

/** MOVE (the first match's first step, the tutorial tip): the movement cap and the device's own verb. */
export function moveCue(device: Device): CoachCue {
  return { title: 'MOVE', actions: [[moveCap(device), device === 'touch' ? 'Drag to run' : device === 'gamepad' ? 'Push to run' : 'Run']] };
}

/** PASS (the first match's second step; the basics PASS prompt says the same). */
export function passCue(device: Device): CoachCue {
  return { title: 'PASS', actions: [[keyCap('pass', device), 'Pass to the ringed teammate']] };
}

/** Defending (the trainer, the tutorial tip). On touch the caps are the defending labels: TACKLE, PRESS, SWITCH. */
export function defendCue(device: Device): CoachCue {
  const d = (a: PadAction) => keyCap(a, device, 'defend');
  return { title: 'WIN IT BACK', actions: [[d('shoot'), 'Tackle'], [d('through'), 'Hold to press'], [d('pass'), 'Switch']], detail: `Hold ${d('shoot')} to slide` };
}

// ------------------------------------------------------------------ set pieces, penalties, the keeper's ball

/**
 * Our restart (kick-off, throw-in, corner, goal kick, free kick; penalties have penaltyCue). `mode` (sim/setPiece.ts):
 * 'goal' a shooting free kick (the reticle on the goal), 'zone' a corner or a wide free kick (the landing ring).
 */
export function restartCue(kind: RestartKind, device: Device, mode?: 'goal' | 'zone'): CoachCue {
  const k = (a: PadAction) => keyCap(a, device, mode === 'zone' ? 'delivery' : 'setpiece');
  const aim = moveCap(device);
  const place: [string, string] = device === 'touch' ? ['', 'Drag to place it'] : [aim, 'Place it'];
  if (mode === 'zone') {
    return { title: kind === 'corner' ? 'CORNER' : 'FREE KICK', actions: [place, [k('through'), 'Float it'], [k('shoot'), 'Drive it low'], [k('pass'), 'Short']] };
  }
  if (mode === 'goal') {
    return { title: 'FREE KICK', actions: [device === 'touch' ? ['', 'Drag to aim'] : [aim, 'Aim'], [k('shoot'), 'Hold for power'], [aim, 'Bend it while held']] };
  }
  switch (kind) {
    case 'kickoff': return { title: 'KICK OFF', actions: [[k('pass'), 'Kick off']] };
    case 'throwin': return { title: 'THROW IN', actions: [[aim, 'Aim'], [k('pass'), 'Throw']] };
    // SHOOT at a corner is a driven cross (flat and fast), not a shot.
    case 'corner': return { title: 'CORNER', actions: [[k('pass'), 'Short pass'], [k('through'), 'Hold to whip in'], [k('shoot'), 'Driven cross']] };
    case 'goalkick': return { title: 'GOAL KICK', actions: [[k('pass'), 'Short pass'], [k('through'), 'Hold to go long']] };
    case 'freekick': return { title: 'FREE KICK', actions: [[aim, 'Aim'], [k('shoot'), 'Hold to shoot'], [k('through'), 'Hold to whip in']] };
    case 'penalty': return penaltyCue(device);
  }
}

/** His penalty (in the match or his shootout kick): aim, then hold SHOOT. Touch aims with a drag anywhere. */
export function penaltyCue(device: Device): CoachCue {
  const shoot = keyCap('shoot', device, 'setpiece');
  return { title: 'PENALTY', actions: [device === 'touch' ? ['', 'Drag to aim'] : [moveCap(device), 'Aim'], [shoot, 'Hold to shoot']] };
}

/** Their shootout kick: our keeper dives the way the stick (or keys) point. */
export function diveCue(device: Device): CoachCue {
  return { title: 'SAVE IT', actions: [[moveCap(device), 'Dive as they shoot']] };
}

/**
 * A defender winding up a challenge on our man (sim/skills.ts, the "!" over him): SKILL now is a PERFECT. On the trainer
 * card while the trainer is on; in the hint band the first few times when it's off (game/matchSession.ts).
 */
export function skillCue(device: Device): CoachCue {
  return { title: 'BEAT HIM', actions: [[keyCap('skill', device), 'Skill now']] };
}

/** Our keeper has it in his hands. */
export function keeperCue(device: Device): CoachCue {
  return { title: "KEEPER'S BALL", actions: [[moveCap(device), 'Walk it'], [keyCap('pass', device), 'Throw'], [keyCap('through', device), 'Kick long']], detail: 'Aim at a free teammate' };
}

// ------------------------------------------------------------------ plain-text hints

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Every key cap the device can show: all its bindings (any action, so new ones count too), the touch labels, STICK. */
function capLabels(device: Device): string[] {
  const out = new Set<string>(['STICK']);
  const b = bindings();
  if (device === 'keyboard') {
    for (const codes of Object.values(b.keys) as string[][]) for (const c of codes) out.add(keyLabel(c));
    out.add(moveCap('keyboard'));
  } else if (device === 'gamepad') {
    for (const btns of Object.values(b.pad) as number[][]) for (const n of btns) out.add(padLabel(n));
    out.add('LEFT STICK');
  } else {
    for (const ctx of Object.values(TOUCH_BUTTONS)) for (const l of Object.values(ctx)) out.add(l);
  }
  for (const a of PAD_ACTIONS) out.add(actionKey(a, device));
  return [...out].filter(Boolean).sort((x, y) => y.length - x.length);
}

/**
 * A hint written as plain text (any code that calls Hud.setHint with words, e.g. "SPACE to kick off" or "Press
 * SKILL to beat him") drawn as the same card: each fact (split at a line break, or an old dot) is a row, its
 * first key name becomes the cap and the rest the words ("SPACE to kick off" → [SPACE] Kick off).
 */
export function cueOfText(text: string, device: Device): CoachCue {
  const labels = capLabels(device);
  const re = new RegExp(`(?<![A-Za-z0-9])(${labels.map(escRe).join('|')})(?![A-Za-z0-9])`);
  const actions = text.split(/\s*(?:\n|[·•●|\u2063])\s*/).filter((s) => s.trim()).map((seg): [string, string] => {
    const m = re.exec(seg);
    if (!m) return ['', upFirst(seg.trim())];
    const rest = `${seg.slice(0, m.index)} ${seg.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim().replace(/^(?:to|=|:)\s+/i, '');
    return [m[1], upFirst(rest)];
  });
  return { title: '', actions };
}

const upFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ drawing

/** The three parts of a coach card. */
export interface CoachParts {
  title: HTMLElement;
  actions: HTMLElement;
  detail: HTMLElement;
}

/** Make `card` a coach card: its three parts, created once (fillCoach writes them). */
export function coachParts(card: HTMLElement): CoachParts {
  card.classList.add('coach');
  const part = (cls: string) => {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  };
  const p = { title: part('coach-title'), actions: part('coach-actions'), detail: part('coach-detail') };
  card.replaceChildren(p.title, p.actions, p.detail);
  return p;
}

/** Write a cue into a card's parts (the trainer's own, or coachParts'). Text only: nothing is parsed as HTML. */
export function fillCoach(p: CoachParts, cue: CoachCue, titleSuffix = ''): void {
  p.title.textContent = cue.title ? cue.title + titleSuffix : '';
  p.title.hidden = !cue.title;
  p.actions.replaceChildren(...cue.actions.map(([k, label]) => {
    const item = document.createElement('span');
    if (k) {
      const cap = document.createElement('kbd');
      cap.textContent = k;
      item.append(cap);
    }
    // A touch button already says what it does ([PASS], not "[PASS] Pass").
    if (label && label.toUpperCase() !== k.toUpperCase()) item.append(document.createTextNode(label));
    return item;
  }));
  p.detail.textContent = cue.detail ?? '';
  p.detail.hidden = !cue.detail;
}

/** A cue's identity (to skip redrawing the same words). */
export function cueKey(cue: CoachCue | null): string {
  return cue ? JSON.stringify(cue) : '';
}
