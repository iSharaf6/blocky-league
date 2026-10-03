/**
 * Haptic taps across the game (the owner: "no haptic feedback", then "add haptic feedback pls as much as where feasible
 * and good to make it more engaging and have ablitiy t disable without making haptic feedbackannnoying"). The iPhone /
 * iPad app only: the native 'Haptics' plugin (ios/App/App/GameCenterPlugin.swift: UIImpactFeedbackGenerator light,
 * medium, heavy, rigid, soft; UISelectionFeedbackGenerator; UINotificationFeedbackGenerator's success). On the web and the
 * portals there is nothing to feel, and Settings hides the row.
 *
 * What fires where (HAPTIC_FEEL is how each one feels):
 * - in a match (hapticForEvent, from the match session): his own pass (light) and shot (light, firmer), a timed or perfect
 *   finish (a crisp rigid tap), a tackle his man wins or loses (medium), a skill move that beats a man (medium; a PERFECT
 *   firmer), a goal for his side (the success pattern and a heavy double), one conceded (one soft tap), the woodwork
 *   (medium), a save by his keeper (medium), the half-time whistle (light), full time (a win: the success pattern; else a
 *   light whistle), a shootout won, the camera button (light);
 * - in the menus: a selection tick on the primary buttons only (the green GO buttons and the hub's big cards:
 *   installUiHaptics), and the success pattern for coins bought or claimed, a level up, the daily gift, a season or pass
 *   tier claimed, the cup won, and each card of a pack as it flips (a legend or epic one: the success pattern).
 *
 * VIBRATION (Settings > Controls, the app only): OFF, LIGHT (only the big moments: goals, wins, level ups, purchases and
 * rewards; HapticFeel.big) or FULL (the default). Never annoying (HapticGate): at most one tap every GAP_MS (a stronger one
 * may cut in), at most one heavy every HEAVY_GAP_MS, a longer gap between two of the same kind, no more than MAX_PER_S a
 * second; nothing while the app is hidden or an ad is up (setHapticsQuiet), nothing for a match the player isn't in.
 */
import type { Match } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';
import { inNativeApp } from './native';

export type HapticLevel = 'off' | 'light' | 'full';
export const HAPTIC_LEVELS: readonly HapticLevel[] = ['off', 'light', 'full'];

export type HapticKind =
  | 'tap' | 'camera' | 'pass' | 'shot' | 'finish' | 'whistle' | 'skill' | 'perfect' | 'tackle' | 'save' | 'post' | 'reveal'
  | 'concede' | 'goal' | 'win' | 'success';

type Style = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'selection';

/** How one feels: the generator, its intensity (0..1), a notification first, a repeat (the goal's double). */
export interface HapticFeel {
  style: Style;
  intensity: number;
  notify?: 'success';
  /** Impacts in a row (the goal's heavy double), `apart` ms apart. */
  count?: number;
  apart?: number;
  /** Least time (ms) between two of this kind. */
  gap: number;
  /** A stronger tap (higher rank) may cut into a weaker one's GAP_MS. */
  rank: number;
  /** One of the big moments VIBRATION: LIGHT keeps. */
  big: boolean;
}

export const HAPTIC_FEEL: Readonly<Record<HapticKind, HapticFeel>> = {
  tap: { style: 'selection', intensity: 1, gap: 120, rank: 0, big: false },
  camera: { style: 'light', intensity: 0.5, gap: 200, rank: 0, big: false },
  pass: { style: 'light', intensity: 0.55, gap: 140, rank: 0, big: false },
  shot: { style: 'light', intensity: 1, gap: 140, rank: 1, big: false },
  finish: { style: 'rigid', intensity: 0.95, gap: 200, rank: 2, big: false },
  whistle: { style: 'light', intensity: 0.7, gap: 400, rank: 0, big: false },
  skill: { style: 'medium', intensity: 0.6, gap: 250, rank: 1, big: false },
  perfect: { style: 'medium', intensity: 0.9, gap: 250, rank: 2, big: false },
  tackle: { style: 'medium', intensity: 0.85, gap: 250, rank: 2, big: false },
  save: { style: 'medium', intensity: 0.7, gap: 300, rank: 2, big: false },
  post: { style: 'medium', intensity: 1, gap: 300, rank: 2, big: false },
  reveal: { style: 'medium', intensity: 0.8, gap: 150, rank: 1, big: false },
  concede: { style: 'soft', intensity: 0.6, gap: 1000, rank: 2, big: true },
  goal: { style: 'heavy', intensity: 1, notify: 'success', count: 2, apart: 110, gap: 1500, rank: 3, big: true },
  win: { style: 'heavy', intensity: 0.8, notify: 'success', gap: 1500, rank: 3, big: true },
  success: { style: 'medium', intensity: 0.7, notify: 'success', gap: 400, rank: 3, big: true },
};

/** Any two taps at least GAP_MS apart (unless the second ranks higher), heavy ones HEAVY_GAP_MS, and MAX_PER_S a second. */
export const GAP_MS = 80;
export const HEAVY_GAP_MS = 600;
export const MAX_PER_S = 6;

const heavy = (f: HapticFeel) => f.style === 'heavy' || !!f.notify;

/** The throttle (pure: the clock is passed in, for tests). */
export class HapticGate {
  private last = -1e9;
  private lastRank = -1;
  private lastHeavy = -1e9;
  private readonly lastOf = new Map<HapticKind, number>();
  private readonly recent: number[] = [];

  allow(kind: HapticKind, now: number, level: HapticLevel = 'full'): boolean {
    const f = HAPTIC_FEEL[kind];
    if (level === 'off' || (level === 'light' && !f.big)) return false;
    if (now - (this.lastOf.get(kind) ?? -1e9) < f.gap) return false;
    if (now - this.last < GAP_MS && f.rank <= this.lastRank) return false;
    if (heavy(f) && now - this.lastHeavy < HEAVY_GAP_MS) return false;
    while (this.recent.length && now - this.recent[0] >= 1000) this.recent.shift();
    if (this.recent.length >= MAX_PER_S && f.rank < 3) return false;
    this.last = now;
    this.lastRank = f.rank;
    if (heavy(f)) this.lastHeavy = now;
    this.lastOf.set(kind, now);
    this.recent.push(now);
    return true;
  }
}

/**
 * The tap a match event is worth to the player on `side` (null: none). `ownerBefore`: who had the ball before the step
 * (a tackle on his own carrier is felt; one elsewhere on the pitch is not). A match with nobody at the controls (the
 * menu's demo) never gets here.
 */
export function hapticForEvent(e: MatchEvent, m: Match, side: Side, ownerBefore: number): HapticKind | null {
  const me = m.activeOf(side);
  const ours = (i: number | undefined) => i !== undefined && i >= 0 && m.players[i]?.side === side;
  switch (e.type) {
    case 'kick': {
      const k = e.player ?? m.ball.lastTouch;
      if (k < 0 || k !== me) return null;
      return e.kind === 'shot' || e.kind === 'header' ? 'shot' : e.kind === 'throw' ? null : 'pass';
    }
    case 'timing':
      return e.player === me && (e.grade === 'perfect' || e.grade === 'good') ? 'finish' : null;
    case 'tackle':
      if (!e.won) return null;
      // Won by his man, or his man (on the ball a moment ago) lost it.
      return e.by === me || (ownerBefore >= 0 && ownerBefore === me && !ours(e.by)) ? 'tackle' : null;
    case 'skillMove':
      if (!ours(e.player)) return null;
      return e.grade === 'perfect' ? 'perfect' : e.grade === 'good' ? 'skill' : null;
    case 'goal':
      return e.side === side ? 'goal' : 'concede';
    case 'post':
      return 'post';
    case 'save':
      return ours(e.keeper) ? 'save' : null;
    case 'halftime':
      return 'whistle';
    case 'fulltime':
      return m.score[side] > m.score[side === 0 ? 1 : 0] ? 'win' : 'whistle';
    case 'shootoutEnd':
      return e.winner === side ? 'win' : null;
    default:
      return null;
  }
}

interface HapticsNative {
  impact(o: { style: Style; intensity: number; count?: number; apart?: number }): Promise<void>;
  selection(): Promise<void>;
  notify(o: { type: 'success' | 'warning' | 'error' }): Promise<void>;
  prepare(): Promise<void>;
}

let level: HapticLevel = 'full';
let quiet = false;
const gate = new HapticGate();
// (The plugin is held inside a plain object: a Capacitor plugin proxy answers every property, `then` included, so a
// promise resolved with the proxy itself would wait on it forever.)
let native: Promise<{ h: HapticsNative } | null> | null = null;

/** Haptics can work here: the app (never the web or a portal build). Settings shows VIBRATION only then. */
export function hapticsAvailable(): boolean {
  return (!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && inNativeApp();
}

function plugin(): Promise<{ h: HapticsNative } | null> {
  // (The literal portal check lets the CrazyGames and Poki builds drop Capacitor's chunk altogether.)
  native ??= (!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && inNativeApp()
    ? import('@capacitor/core').then((c) => ({ h: c.registerPlugin<HapticsNative>('Haptics') }), () => null)
    : Promise.resolve(null);
  return native;
}

/** Settings > Controls > VIBRATION (main.ts, from the save). */
export function setHapticsLevel(v: HapticLevel): void {
  level = HAPTIC_LEVELS.includes(v) ? v : 'full';
  primeHaptics();
}

export function hapticsLevel(): HapticLevel {
  return level;
}

/** An ad on screen (main.ts: the ads' mute): no taps meanwhile. */
export function setHapticsQuiet(on: boolean): void {
  quiet = on;
}

/** Wake the generators so the next tap lands on time (a match starting, the setting turned on). */
export function primeHaptics(): void {
  if (level === 'off' || !hapticsAvailable()) return;
  void plugin().then((p) => p?.h.prepare().catch(() => undefined));
}

/** A tap of this kind, if VIBRATION allows it and the gate lets it through. Fire and forget. */
export function buzz(kind: HapticKind): void {
  if (level === 'off' || quiet || !hapticsAvailable()) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!gate.allow(kind, now, level)) return;
  const f = HAPTIC_FEEL[kind];
  void plugin().then((p) => {
    if (!p) return;
    // (Called straight off the registration, never returned through a promise.)
    if (f.notify) p.h.notify({ type: f.notify }).catch(() => undefined);
    if (f.style === 'selection') p.h.selection().catch(() => undefined);
    else p.h.impact({ style: f.style, intensity: f.intensity, count: f.count, apart: f.apart }).catch(() => undefined);
  });
}

/**
 * Menus: a selection tick when a primary button is pressed (the green GO buttons, the hub's big cards), never on every
 * tap. One listener on the document, for the life of the page (main.ts).
 */
export function installUiHaptics(doc: Document): void {
  doc.addEventListener('pointerdown', (e) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('.btn-go, .hub-hero')) buzz('tap');
  }, { passive: true, capture: true });
}
