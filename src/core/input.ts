/** Screen-space controls: stick (sx right, sy up) plus the four action buttons. */
export interface Controls {
  sx: number;
  sy: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
  /** Blitz mode: use the held power-up (a press; nothing outside blitz). */
  power: boolean;
  /** SKILL: a skill move with the ball (a press; sim/skills.ts). */
  skill: boolean;
}

export interface TouchState extends Controls {
  enabled: boolean;
}

export type Device = 'keyboard' | 'touch' | 'gamepad';

// ------------------------------------------------------------------ bindings (Settings > Controls > KEYS)

/** Everything a key can be bound to: the four move directions, the six buttons and pause. */
export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'pass' | 'shoot' | 'through' | 'sprint' | 'skill' | 'power' | 'pause';
export const KEY_ACTIONS: readonly KeyAction[] = ['up', 'down', 'left', 'right', 'pass', 'shoot', 'through', 'sprint', 'skill', 'power', 'pause'];
/** Keys per action (a primary and up to two alternates). */
export const KEY_SLOTS = 3;
export type KeyMap = { [k in KeyAction]: string[] };

/**
 * The defaults: WASD + arrows, SPACE / J / Z pass, K / X shoot, L / C through, SHIFT / I sprint, Q / U skill (a left-hand
 * key by the movement keys, a right-hand one by the action keys), E / O power, ESC / P pause.
 */
export const DEFAULT_KEYS: Readonly<KeyMap> = Object.freeze({
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  pass: ['Space', 'KeyJ', 'KeyZ'],
  shoot: ['KeyK', 'KeyX'],
  through: ['KeyL', 'KeyC'],
  sprint: ['ShiftLeft', 'KeyI'],
  skill: ['KeyQ', 'KeyU'],
  power: ['KeyE', 'KeyO'],
  pause: ['Escape', 'KeyP'],
});

/** Gamepad buttons (standard mapping) the actions can be bound to; the d-pad always moves. */
export type PadAction = 'pass' | 'shoot' | 'through' | 'sprint' | 'skill' | 'power' | 'pause';
export const PAD_ACTIONS: readonly PadAction[] = ['pass', 'shoot', 'through', 'sprint', 'skill', 'power', 'pause'];
export const PAD_SLOTS = 2;
export type PadMap = { [k in PadAction]: number[] };
/** A pass, B shoot, X through, RT / RB sprint, LB skill, Y power, START pause. */
export const DEFAULT_PAD: Readonly<PadMap> = Object.freeze({ pass: [0], shoot: [1], through: [2], sprint: [7, 5], skill: [4], power: [3], pause: [9] });

/** Buttons that can't be bound: the d-pad (movement) and the home / guide button. */
const PAD_RESERVED = new Set([12, 13, 14, 15, 16]);
/** Keys that can't be bound: focus and browser keys. (Escape cancels a rebind; Backspace / Delete clears a slot.) */
const KEY_RESERVED = new Set(['Tab', 'MetaLeft', 'MetaRight', 'ContextMenu', 'F5', 'F11', 'F12', 'Escape', 'Backspace', 'Delete']);

/** Left and right modifier keys count as one (SHIFT is SHIFT whichever side). */
export function normCode(code: string): string {
  switch (code) {
    case 'ShiftRight': return 'ShiftLeft';
    case 'ControlRight': return 'ControlLeft';
    case 'AltRight': return 'AltLeft';
    default: return code;
  }
}

function cloneKeys(m: Readonly<KeyMap>): KeyMap {
  const out = {} as KeyMap;
  for (const a of KEY_ACTIONS) out[a] = [...m[a]];
  return out;
}

function clonePad(m: Readonly<PadMap>): PadMap {
  const out = {} as PadMap;
  for (const a of PAD_ACTIONS) out[a] = [...m[a]];
  return out;
}

/**
 * A stored key map (any build's, or hand-edited) made whole: every action present, codes as strings, at most
 * KEY_SLOTS each, no code bound twice (the first action to claim it keeps it), and an action left with no key
 * falls back to its default keys that are still free.
 */
export function normalizeKeyMap(raw: unknown): KeyMap {
  const src = raw && typeof raw === 'object' ? (raw as Partial<Record<KeyAction, unknown>>) : {};
  const used = new Set<string>();
  const out = {} as KeyMap;
  for (const a of KEY_ACTIONS) {
    const list = Array.isArray(src[a]) ? (src[a] as unknown[]) : [...DEFAULT_KEYS[a]];
    out[a] = [];
    for (const c of list) {
      if (typeof c !== 'string' || !c || out[a].length >= KEY_SLOTS) continue;
      const k = normCode(c);
      if (used.has(k)) continue;
      used.add(k);
      out[a].push(k);
    }
  }
  for (const a of KEY_ACTIONS) {
    if (out[a].length) continue;
    for (const k of DEFAULT_KEYS[a]) if (!used.has(k)) {
      used.add(k);
      out[a].push(k);
    }
  }
  return out;
}

/** The gamepad map made whole the same way (buttons 0..17, the d-pad and home reserved). */
export function normalizePadMap(raw: unknown): PadMap {
  const src = raw && typeof raw === 'object' ? (raw as Partial<Record<PadAction, unknown>>) : {};
  const used = new Set<number>();
  const out = {} as PadMap;
  for (const a of PAD_ACTIONS) {
    const list = Array.isArray(src[a]) ? (src[a] as unknown[]) : [...DEFAULT_PAD[a]];
    out[a] = [];
    for (const b of list) {
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 17 || PAD_RESERVED.has(b) || used.has(b) || out[a].length >= PAD_SLOTS) continue;
      used.add(b);
      out[a].push(b);
    }
  }
  for (const a of PAD_ACTIONS) {
    if (out[a].length) continue;
    for (const b of DEFAULT_PAD[a]) if (!used.has(b)) {
      used.add(b);
      out[a].push(b);
    }
  }
  return out;
}

export interface BindResult<M, A> {
  /** The map after the change (a new object; the input one is untouched). */
  map: M;
  /** The action that gave the key up (it now has the slot's old key, if there was one); null = no conflict. */
  swapped: A | null;
  /** Why nothing changed: 'reserved' key, or 'last' (it is the other action's only key and there is nothing to swap in). */
  refused?: 'reserved' | 'last';
}

/**
 * Bind `code` to `action`'s `slot`. A code already bound elsewhere moves: the other action takes this slot's
 * old key in its place (a swap), so nothing is ever bound twice. Refused when the key is reserved, or when it
 * is the other action's only key and this slot was empty (that action would be left with none).
 */
export function bindKey(map: Readonly<KeyMap>, action: KeyAction, slot: number, code: string): BindResult<KeyMap, KeyAction> {
  const k = normCode(code);
  const out = cloneKeys(map);
  if (KEY_RESERVED.has(k) || slot < 0 || slot >= KEY_SLOTS) return { map: out, swapped: null, refused: 'reserved' };
  const mine = out[action];
  const old = mine[slot] as string | undefined;
  if (old === k) return { map: out, swapped: null };
  const owner = KEY_ACTIONS.find((a) => out[a].includes(k)) ?? null;
  if (owner && owner !== action) {
    const theirs = out[owner];
    const at = theirs.indexOf(k);
    if (old) theirs[at] = old;
    else if (theirs.length > 1) theirs.splice(at, 1);
    else return { map: cloneKeys(map), swapped: null, refused: 'last' };
  } else if (owner === action) {
    // Moving a key between this action's own slots: swap the two.
    const at = mine.indexOf(k);
    if (old) mine[at] = old;
    else mine.splice(at, 1);
  }
  if (slot < mine.length) mine[slot] = k;
  else mine.push(k);
  return { map: out, swapped: owner && owner !== action ? owner : null };
}

/** Clear one of an action's keys (never its last one). */
export function unbindKey(map: Readonly<KeyMap>, action: KeyAction, slot: number): KeyMap {
  const out = cloneKeys(map);
  if (out[action].length > 1 && slot < out[action].length) out[action].splice(slot, 1);
  return out;
}

/** Bind gamepad `button` to `action`'s `slot`, with the same swap rule as bindKey. */
export function bindPad(map: Readonly<PadMap>, action: PadAction, slot: number, button: number): BindResult<PadMap, PadAction> {
  const out = clonePad(map);
  if (PAD_RESERVED.has(button) || button < 0 || button > 17 || slot < 0 || slot >= PAD_SLOTS) return { map: out, swapped: null, refused: 'reserved' };
  const mine = out[action];
  const old = mine[slot] as number | undefined;
  if (old === button) return { map: out, swapped: null };
  const owner = PAD_ACTIONS.find((a) => out[a].includes(button)) ?? null;
  if (owner && owner !== action) {
    const theirs = out[owner];
    const at = theirs.indexOf(button);
    if (old !== undefined) theirs[at] = old;
    else if (theirs.length > 1) theirs.splice(at, 1);
    else return { map: clonePad(map), swapped: null, refused: 'last' };
  } else if (owner === action) {
    const at = mine.indexOf(button);
    if (old !== undefined) mine[at] = old;
    else mine.splice(at, 1);
  }
  if (slot < mine.length) mine[slot] = button;
  else mine.push(button);
  return { map: out, swapped: owner && owner !== action ? owner : null };
}

export function unbindPad(map: Readonly<PadMap>, action: PadAction, slot: number): PadMap {
  const out = clonePad(map);
  if (out[action].length > 1 && slot < out[action].length) out[action].splice(slot, 1);
  return out;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'SPACE', ShiftLeft: 'SHIFT', ControlLeft: 'CTRL', AltLeft: 'ALT', Enter: 'ENTER', Escape: 'ESC', CapsLock: 'CAPS',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: 'MINUS', Equal: '=', Backquote: '`', NumpadEnter: 'NUM ENTER',
  NumpadAdd: 'NUM +', NumpadSubtract: 'NUM MINUS', NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
  PageUp: 'PG UP', PageDown: 'PG DN', Home: 'HOME', End: 'END', Insert: 'INS',
};

/** What a key code reads as on a key cap ("KeyK" → "K", "Space" → "SPACE", "ArrowUp" → "↑"). */
export function keyLabel(code: string): string {
  const k = normCode(code);
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  let m = /^Key([A-Z])$/.exec(k);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(k);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(k);
  if (m) return `NUM ${m[1]}`;
  return k.toUpperCase();
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'HOME', 'SHARE'];

/** A gamepad button by its standard-mapping name (Xbox letters: A B X Y, LB RB LT RT). */
export function padLabel(button: number): string {
  return PAD_NAMES[button] ?? `B${button}`;
}

// The bindings in force (main.ts sets them from the save; every key hint on screen reads them from here).
let keysNow: KeyMap = cloneKeys(DEFAULT_KEYS);
let padNow: PadMap = clonePad(DEFAULT_PAD);

/** Put a key map and gamepad map in force (both made whole first). */
export function setBindings(keys?: unknown, pad?: unknown): void {
  keysNow = normalizeKeyMap(keys);
  padNow = normalizePadMap(pad);
}

/** The bindings in force (read-only copies for the Settings screen). */
export function bindings(): { keys: KeyMap; pad: PadMap } {
  return { keys: cloneKeys(keysNow), pad: clonePad(padNow) };
}

/** The label of an action's first binding for the device in hand: "SPACE" / "A" / the touch button's name. */
export function actionKey(action: PadAction, device: Device): string {
  if (device === 'gamepad') return padLabel(padNow[action][0] ?? DEFAULT_PAD[action][0]);
  // (Touch has no SPRINT button: the stick sprints.)
  if (device === 'touch') return { pass: 'PASS', shoot: 'SHOOT', through: 'THROUGH', sprint: 'STICK', skill: 'SKILL', power: 'POWER', pause: 'II' }[action];
  return keyLabel(keysNow[action][0] ?? DEFAULT_KEYS[action][0]);
}

/**
 * How moving reads: "WASD / ARROWS" on the defaults, else the four first keys (up, left, down, right: "IJKL"),
 * plus " / ARROWS" while the arrows are still bound to the four directions. Gamepad: LEFT STICK.
 */
export function moveKeys(device: Device = 'keyboard'): string {
  if (device === 'gamepad') return 'LEFT STICK';
  if (device === 'touch') return 'the thumbstick';
  const order: KeyAction[] = ['up', 'left', 'down', 'right'];
  const firsts = order.map((a) => keyLabel(keysNow[a][0] ?? DEFAULT_KEYS[a][0]));
  const joined = firsts.every((l) => l.length === 1) ? firsts.join('') : firsts.join(' ');
  const arrows = order.every((a, i) => keysNow[a].includes(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][i]));
  if (firsts.join('') === '↑←↓→') return 'ARROWS';
  return arrows ? `${joined} / ARROWS` : joined;
}

let deviceOf: () => Device = () => 'keyboard';

/** Where the device in hand is read from (main.ts: the live Input's lastDevice), for screens that name keys. */
export function setDeviceSource(fn: () => Device): void {
  deviceOf = fn;
}

/** The device in hand (keyboard / gamepad / touch), for key hints. */
export function currentDevice(): Device {
  try {
    return deviceOf();
  } catch {
    return 'keyboard';
  }
}

/**
 * Fill {pass} / {shoot} / {through} / {sprint} / {skill} / {power} / {pause} / {move} tokens in copy with the player's own
 * bindings for the device in hand ("SHOOT ({shoot})" reads "SHOOT (K)", "SHOOT (B)", or "SHOOT (SHOOT)" → on touch
 * the brackets would repeat the button's name, so a bracketed token is dropped there).
 */
export function fillKeys(text: string, device: Device = currentDevice()): string {
  const withTouch = device === 'touch' ? text.replace(/\s*\(\{(pass|shoot|through|sprint|skill)\}\)/g, '') : text;
  return withTouch.replace(/\{(pass|shoot|through|sprint|skill|power|pause|move)\}/g, (_, a: string) =>
    a === 'move' ? moveKeys(device) : actionKey(a as PadAction, device),
  );
}

/** The default key names the match session writes into its hints, by device. */
const DEFAULT_HINT_TOKENS: { [d in 'keyboard' | 'gamepad']: [string, PadAction | 'move'][] } = {
  keyboard: [['WASD / ARROWS', 'move'], ['SPACE', 'pass'], ['K', 'shoot'], ['L', 'through'], ['SHIFT', 'sprint']],
  gamepad: [['A', 'pass'], ['B', 'shoot'], ['X', 'through'], ['RT', 'sprint'], ['Y', 'power']],
};

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Copy written with the DEFAULT key names ("SPACE to kick off", "hold K to strike", "move with WASD / ARROWS")
 * re-written for the bindings in force. Only whole key names in capitals are touched ("K", never the K of
 * "KICK"), in one pass (so swapping two keys can't chain), and only for names that actually changed.
 */
export function remapKeys(text: string, device: Device = currentDevice()): string {
  if (!text || device === 'touch') return text;
  const r = remapper(device);
  return r ? text.replace(r.re, (t) => r.swap.get(t) ?? t) : text;
}

/** The swap table and its pattern for the bindings in force (the HUD asks every frame: built once per change). */
let remapMemo: { key: string; value: { re: RegExp; swap: Map<string, string> } | null } | null = null;

function remapper(device: 'keyboard' | 'gamepad'): { re: RegExp; swap: Map<string, string> } | null {
  const pairs = DEFAULT_HINT_TOKENS[device].map(([token, a]) => [token, a === 'move' ? moveKeys(device) : actionKey(a, device)] as const);
  const key = `${device}|${pairs.map((p) => p[1]).join('|')}`;
  if (remapMemo?.key === key) return remapMemo.value;
  const swap = new Map<string, string>();
  for (const [token, now] of pairs) if (now !== token) swap.set(token, now);
  let value: { re: RegExp; swap: Map<string, string> } | null = null;
  if (swap.size) {
    const alt = [...swap.keys()].sort((x, y) => y.length - x.length).map(escRe).join('|');
    value = { re: new RegExp(`(?<![A-Za-z])(?:${alt})(?![A-Za-z])`, 'g'), swap };
  }
  remapMemo = { key, value };
  return value;
}

/** Is `code` bound to `action` right now (main.ts: the pause key)? */
export function isKey(action: KeyAction, code: string): boolean {
  return keysNow[action].includes(normCode(code));
}

/** `code` isn't bound to any action (a fixed extra key, like the match camera's V, gives way to a binding). */
export function freeKey(code: string): boolean {
  const c = normCode(code);
  return !KEY_ACTIONS.some((a) => keysNow[a].includes(c));
}

/** Gamepad button `i` is down on any pad and isn't bound to any action (the match camera's VIEW / BACK button). */
export function freePadButton(i: number): boolean {
  if (PAD_ACTIONS.some((a) => padNow[a].includes(i))) return false;
  return gamepads().some((gp) => !!gp?.buttons[i]?.pressed);
}

/** A key the game uses: the page mustn't scroll or tab away on it while playing. */
function gameKey(code: string): boolean {
  if (code === 'Space' || code.startsWith('Arrow')) return true;
  for (const a of KEY_ACTIONS) if (keysNow[a].includes(code)) return true;
  return false;
}

/** Typing in a text box (club name, account form) is never play. */
function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

const MOVE_DIRS: [KeyAction, number, number][] = [['up', 0, 1], ['down', 0, -1], ['left', -1, 0], ['right', 1, 0]];

/** Some embedded browsers deny the gamepad API through their frame permissions policy. */
function gamepads(): readonly (Gamepad | null)[] {
  try {
    return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

export class Input {
  private keys = new Set<string>();
  readonly touch: TouchState = { enabled: false, sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false, power: false, skill: false };
  private listeners: ((code: string) => void)[] = [];
  // (The same test that puts the touch buttons on screen, ui/touch.ts isTouchDevice: a coarse pointer or touch events.)
  lastDevice: Device =
    typeof window !== 'undefined' && ((typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window)
      ? 'touch' : 'keyboard';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || editable(e.target)) return;
      const code = normCode(e.code);
      if (gameKey(code)) e.preventDefault();
      this.keys.add(code);
      this.lastDevice = 'keyboard';
      for (const l of this.listeners) l(code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(normCode(e.code)));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  /** Drop held controls when focus is lost or a match is interrupted. */
  reset(): void {
    this.keys.clear();
    const t = this.touch;
    t.sx = t.sy = 0;
    t.pass = t.shoot = t.through = t.sprint = t.power = t.skill = false;
  }

  onKey(fn: (code: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private any(codes: readonly string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  read(): Controls {
    const k = keysNow;
    let sx = 0;
    let sy = 0;
    for (const [a, dx, dy] of MOVE_DIRS) {
      if (this.any(k[a])) {
        sx += dx;
        sy += dy;
      }
    }
    const l = Math.hypot(sx, sy);
    if (l > 1) {
      sx /= l;
      sy /= l;
    }
    const out: Controls = {
      sx, sy,
      sprint: this.any(k.sprint),
      pass: this.any(k.pass),
      shoot: this.any(k.shoot),
      through: this.any(k.through),
      power: this.any(k.power),
      skill: this.any(k.skill),
    };
    // Gamepad
    const pads = gamepads();
    const pm = padNow;
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const gl = Math.hypot(ax, ay);
      if (gl > 0.18) {
        const kk = Math.min(1, (gl - 0.18) / 0.72) / gl;
        out.sx = ax * kk;
        out.sy = -ay * kk;
        this.lastDevice = 'gamepad';
      }
      const b = (i: number) => {
        const btn = gp.buttons[i];
        return !!btn && (btn.pressed || (btn.value ?? 0) > 0.3);
      };
      const on = (a: PadAction) => pm[a].some(b);
      const pass = on('pass');
      const shoot = on('shoot');
      const through = on('through');
      const power = on('power');
      const sprint = on('sprint');
      const skill = on('skill');
      if (pass || shoot || through || power || sprint || skill || on('pause')) this.lastDevice = 'gamepad';
      out.pass ||= pass;
      out.shoot ||= shoot;
      out.through ||= through;
      out.power ||= power;
      out.sprint ||= sprint;
      out.skill ||= skill;
      if (b(12)) out.sy = 1;
      if (b(13)) out.sy = -1;
      if (b(14)) out.sx = -1;
      if (b(15)) out.sx = 1;
      if (b(12) || b(13) || b(14) || b(15)) this.lastDevice = 'gamepad';
    }
    const t = this.touch;
    if (t.enabled) {
      if (Math.hypot(t.sx, t.sy) > 0.05) {
        out.sx = t.sx;
        out.sy = t.sy;
      }
      out.pass ||= t.pass;
      out.shoot ||= t.shoot;
      out.through ||= t.through;
      out.sprint ||= t.sprint;
      out.power ||= t.power;
      out.skill ||= t.skill;
    }
    // D-pad diagonals and mixed keyboard / pad movement must have the same top speed as a stick.
    const length = Math.hypot(out.sx, out.sy);
    if (length > 1) {
      out.sx /= length;
      out.sy /= length;
    }
    return out;
  }

  gamepadPause(): boolean {
    const pads = gamepads();
    for (const gp of pads) if (gp && padNow.pause.some((i) => gp.buttons[i]?.pressed)) return true;
    return false;
  }

  /**
   * The first gamepad button down right now that isn't in `ignore` (Settings > KEYS listening for a button),
   * or -1. Reserved buttons (the d-pad, home) never count.
   */
  static padButtonDown(ignore: ReadonlySet<number>): number {
    const pads = gamepads();
    for (const gp of pads) {
      if (!gp) continue;
      for (let i = 0; i < gp.buttons.length; i++) {
        if (PAD_RESERVED.has(i) || ignore.has(i)) continue;
        if (gp.buttons[i]?.pressed) return i;
      }
    }
    return -1;
  }

  /** Every gamepad button down right now (so a held button isn't taken as the new binding). */
  static padButtonsHeld(): Set<number> {
    const held = new Set<number>();
    const pads = gamepads();
    for (const gp of pads) {
      if (!gp) continue;
      gp.buttons.forEach((b, i) => b?.pressed && held.add(i));
    }
    return held;
  }
}
