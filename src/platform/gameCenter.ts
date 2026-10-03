/**
 * Game Center in the iPhone / iPad app: sign-in at launch (Apple's own sheet the first time, a welcome banner after),
 * achievements from meta/achievements.ts reported as they move, and Apple's achievements screen. The native half is
 * ios/App/App/GameCenterPlugin.swift ('GameCenter'). Off everywhere else, and quiet when the player isn't signed in
 * to Game Center: the game never asks twice and never blocks on it.
 */
import type { SaveData } from '../core/save';
import { achievementProgress } from '../meta/achievements';
import { inNativeApp } from './native';

interface GameCenterNative {
  signIn(): Promise<{ signedIn: boolean }>;
  report(o: { achievements: { id: string; percent: number }[] }): Promise<{ reported: number }>;
  showAchievements(): Promise<{ shown: boolean }>;
}

/** What was last sent per achievement id (percent), so each step up is reported once. Not part of the save. */
const SENT_KEY = 'blocky-league-gc-sent';
/** Saves come in bursts at full time: report once they settle. */
const SYNC_DELAY_MS = 1500;

// (The plugin is held inside a plain object: a Capacitor plugin proxy answers every property, `then` included, so a
// promise resolved with the proxy itself would wait on it forever.)
let native: Promise<{ gc: GameCenterNative } | null> | null = null;
let signedIn = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function plugin(): Promise<{ gc: GameCenterNative } | null> {
  // (The literal portal check lets the CrazyGames and Poki builds drop Capacitor's chunk altogether.)
  native ??= (!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && inNativeApp()
    ? import('@capacitor/core').then((c) => ({ gc: c.registerPlugin<GameCenterNative>('GameCenter') }), () => null)
    : Promise.resolve(null);
  return native;
}

function readSent(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeSent(sent: Record<string, number>): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    // (Private mode or full storage: the next sync just sends again, which Game Center shrugs off.)
  }
}

/** Sign in at launch; true when the player is in Game Center. */
export async function gameCenterSignIn(): Promise<boolean> {
  const p = (await plugin())?.gc;
  if (!p) return false;
  try {
    signedIn = (await p.signIn()).signedIn;
  } catch (e) {
    signedIn = false;
    console.warn('Game Center unavailable:', e instanceof Error ? e.message : e);
  }
  return signedIn;
}

/** The player is signed in to Game Center (so an achievements button is worth showing). */
export function gameCenterReady(): boolean {
  return signedIn;
}

/** Report whatever moved since the last report (percent up only). Safe to call after every save. */
export async function syncAchievements(save: SaveData): Promise<number> {
  if (!signedIn) return 0;
  const p = (await plugin())?.gc;
  if (!p) return 0;
  const sent = readSent();
  const todo = achievementProgress(save).filter((a) => a.percent > (sent[a.id] ?? 0));
  if (!todo.length) return 0;
  try {
    await p.report({ achievements: todo });
    for (const a of todo) sent[a.id] = a.percent;
    writeSent(sent);
    return todo.length;
  } catch {
    return 0;
  }
}

/** syncAchievements once a burst of saves has settled. */
export function queueAchievementSync(save: SaveData): void {
  if (!signedIn) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncAchievements(save);
  }, SYNC_DELAY_MS);
}

/** Apple's achievements screen; false when Game Center isn't there. */
export async function showGameCenterAchievements(): Promise<boolean> {
  const p = (await plugin())?.gc;
  if (!p || !signedIn) return false;
  try {
    return (await p.showAchievements()).shown;
  } catch {
    return false;
  }
}
