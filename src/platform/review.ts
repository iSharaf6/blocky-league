/**
 * Apple's own rating prompt (StoreKit, the native 'AppReview' plugin in ios/App/App/GameCenterPlugin.swift), in the
 * iPhone / iPad app only. Asked rarely and at a happy moment: right after a win, once the player has played a few
 * matches and won some, and no sooner than REVIEW_GAP_DAYS after the last ask. Apple decides whether it shows (at most
 * three times a year) and never tells the app the rating, so nobody is filtered: anyone can tell us what's wrong
 * through Settings, FEEDBACK. (Asking only happy players first, "review gating", is against the App Store's rules.)
 */
import type { SaveData } from '../core/save';
import { localDay } from '../core/day';
import { inNativeApp } from './native';

const ASKED_KEY = 'blocky-league-review-asked';
export const REVIEW_MIN_PLAYED = 5;
export const REVIEW_MIN_WON = 3;
export const REVIEW_GAP_DAYS = 60;

/** Whether this moment qualifies (pure, for tests): enough played and won, and the last ask long enough ago. */
export function reviewDue(record: Pick<SaveData['record'], 'played' | 'won'>, lastAsked: string, today: string): boolean {
  if (record.played < REVIEW_MIN_PLAYED || record.won < REVIEW_MIN_WON) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastAsked)) return true;
  const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastAsked}T12:00:00Z`)) / 86_400_000;
  return days >= REVIEW_GAP_DAYS;
}

/** After a win: ask Apple for its rating prompt if the moment qualifies (a quiet no-op anywhere but the app). */
export async function maybeAskForReview(save: Pick<SaveData, 'record'>): Promise<boolean> {
  if ((import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') || !inNativeApp()) return false;
  let last = '';
  try {
    last = localStorage.getItem(ASKED_KEY) ?? '';
  } catch {
    // (No storage: ask as if never asked; Apple's own cap still applies.)
  }
  const today = localDay();
  if (!reviewDue(save.record, last, today)) return false;
  try {
    const c = await import('@capacitor/core');
    // (Called straight off the registration: a plugin proxy must never be returned through a promise.)
    const asked = (await c.registerPlugin<{ request(): Promise<{ asked: boolean }> }>('AppReview').request()).asked;
    if (asked) {
      try {
        localStorage.setItem(ASKED_KEY, today);
      } catch {
        /* ignore */
      }
    }
    return asked;
  } catch {
    return false;
  }
}
