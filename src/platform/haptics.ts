/**
 * Haptics across the game (the owner: "no haptic feedback", then "add haptic feedback pls as much as where feasible
 * and good to make it more engaging and have ablitiy t disable without making haptic feedbackannnoying", then, on his
 * phone, "i cant fel the vibration in full, i think it can be better"). The iPhone / iPad app only: the native 'Haptics'
 * plugin (ios/App/App/GameCenterPlugin.swift HapticsPlugin: Core Haptics, with the UIKit generators as the fallback).
 * On the web and the portals there is nothing to feel, and Settings hides the row.
 *
 * A single transient tap is easy to miss with a thumb on the glass, so the match's contacts are short CONTINUOUS
 * buzzes (40 to 120 ms: HapticFeel.buzzMs) under the tap, and the big moments are patterns of their own
 * (HapticFeel.pattern, played whole by the plugin):
 * - in a match (hapticForEvent, from the match session): his own pass (a firm tap) and shot (a 70 ms buzz), a timed or
 *   perfect finish (a crisp tap and a short buzz), a tackle his man wins or loses (a 90 ms thud), a skill move that
 *   beats a man (a tap; a PERFECT a buzz too), a save by his keeper (a 110 ms slap), the woodwork ('post': a sharp
 *   crack that rings on), a goal for his side ('goal': 0.6 s of rumble rising through four thumps into a heavy double),
 *   one conceded ('concede': a low sinking rumble), a SUPER SHOT ('super': a wind-up, a slam and its aftershock), the
 *   half-time and full-time whistles ('whistle': two short blasts and a long one), a win ('win': three rising thumps
 *   and a long buzz dying away), a substitution's high five ('sub': a quick double tap), the camera button;
 * - in the menus: a tick on every button and tab pressed (installUiHaptics), and the success pattern for coins bought
 *   or claimed, a level up, the daily gift, a season or pass tier claimed, the cup won, and each card of a pack as it
 *   flips (a legend or epic one: the success pattern).
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
  | 'concede' | 'goal' | 'win' | 'success'
  /** HYPE (sim/hype.ts): his side's SUPER SHOT struck (a heavy double); a live goal done (game/funLayer.ts). */
  | 'super' | 'bounty'
  /** A substitution's high five on the touchline (game/matchSession.ts). */
  | 'sub';

/** The patterns the plugin plays whole (HapticsPlugin.pattern): each a different shape, so they are told apart by feel. */
export type HapticPattern = 'goal' | 'win' | 'super' | 'post' | 'whistle' | 'sub' | 'concede';

type Style = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'selection';

/**
 * How one feels: the tap's style and strength (0..1), a continuous buzz under it (`buzzMs`), or a whole pattern of
 * its own (`pattern`). `notify` and `count` are what an older build of the app (no patterns) plays instead.
 */
export interface HapticFeel {
  style: Style;
  intensity: number;
  /** A continuous buzz this long (ms, 40..120) starting with the tap: what makes a contact unmistakable. */
  buzzMs?: number;
  /** One of the plugin's own patterns, played instead of the tap. */
  pattern?: HapticPattern;
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
  tap: { style: 'selection', intensity: 1, gap: 60, rank: 0, big: false },
  camera: { style: 'light', intensity: 0.8, gap: 200, rank: 0, big: false },
  pass: { style: 'light', intensity: 0.85, gap: 140, rank: 0, big: false },
  shot: { style: 'medium', intensity: 1, buzzMs: 70, gap: 140, rank: 1, big: false },
  finish: { style: 'rigid', intensity: 1, buzzMs: 50, gap: 200, rank: 2, big: false },
  whistle: { style: 'light', intensity: 0.9, pattern: 'whistle', gap: 400, rank: 0, big: false },
  skill: { style: 'medium', intensity: 0.85, gap: 250, rank: 1, big: false },
  perfect: { style: 'rigid', intensity: 1, buzzMs: 60, gap: 250, rank: 2, big: false },
  tackle: { style: 'heavy', intensity: 1, buzzMs: 90, gap: 250, rank: 2, big: false },
  save: { style: 'heavy', intensity: 0.95, buzzMs: 110, gap: 300, rank: 2, big: false },
  post: { style: 'rigid', intensity: 1, pattern: 'post', gap: 300, rank: 2, big: false },
  reveal: { style: 'medium', intensity: 0.95, buzzMs: 40, gap: 150, rank: 1, big: false },
  concede: { style: 'soft', intensity: 0.8, pattern: 'concede', gap: 1000, rank: 2, big: true },
  goal: { style: 'heavy', intensity: 1, pattern: 'goal', notify: 'success', count: 2, apart: 110, gap: 1500, rank: 3, big: true },
  win: { style: 'heavy', intensity: 1, pattern: 'win', notify: 'success', gap: 1500, rank: 3, big: true },
  success: { style: 'medium', intensity: 0.9, notify: 'success', gap: 400, rank: 3, big: true },
  super: { style: 'heavy', intensity: 1, pattern: 'super', count: 2, apart: 90, gap: 800, rank: 3, big: true },
  bounty: { style: 'medium', intensity: 0.9, notify: 'success', gap: 600, rank: 2, big: false },
  sub: { style: 'medium', intensity: 0.8, pattern: 'sub', gap: 500, rank: 1, big: false },
};

/** Any two taps at least GAP_MS apart (unless the second ranks higher), heavy ones HEAVY_GAP_MS, and MAX_PER_S a second. */
export const GAP_MS = 80;
export const HEAVY_GAP_MS = 600;
export const MAX_PER_S = 6;

/** The ones kept HEAVY_GAP_MS apart: the long patterns and the notifications (a tackle's thud is not one of them). */
const heavy = (f: HapticFeel) => (f.style === 'heavy' && !f.buzzMs) || !!f.notify || f.pattern === 'super';

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
  /** `duration` (ms): a continuous buzz that long under the tap. */
  impact(o: { style: Style; intensity: number; count?: number; apart?: number; duration?: number }): Promise<void>;
  /** One of the plugin's own patterns (rejects on a build of the app from before they existed). */
  pattern(o: { name: HapticPattern }): Promise<void>;
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
    const taps = (): void => {
      if (f.notify) p.h.notify({ type: f.notify }).catch(() => undefined);
      if (f.style === 'selection') p.h.selection().catch(() => undefined);
      else p.h.impact({ style: f.style, intensity: f.intensity, count: f.count, apart: f.apart, duration: f.buzzMs }).catch(() => undefined);
    };
    // A pattern of its own; an app built before the patterns plays the taps it always did.
    if (f.pattern) p.h.pattern({ name: f.pattern }).catch(taps);
    else taps();
  });
}

/** What ticks in the menus: anything that is a button, a tab or a tile. */
const UI_TICK = 'button, [role="button"], [role="tab"], .btn, .tile, summary, select, input[type="checkbox"], input[type="range"]';

/**
 * Menus: a tick as a control is pressed (the owner couldn't feel the app "in full": only the green buttons used to
 * tick). Every button, tab and tile, on the press itself; never the match's own touch controls (the match's events are
 * felt instead: a pass, a shot), and the gate keeps a flurry of taps from buzzing. One listener on the document, for
 * the life of the page (main.ts).
 */
export function installUiHaptics(doc: Document): void {
  doc.addEventListener('pointerdown', (e) => {
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('.touch') || !t.closest(UI_TICK)) return;
    const el = t.closest(UI_TICK) as HTMLButtonElement | null;
    if (el && 'disabled' in el && el.disabled) return;
    buzz('tap');
  }, { passive: true, capture: true });
}
