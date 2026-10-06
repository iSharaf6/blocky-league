/**
 * Who signs in, and how (the owner: "Use built-in logins like Apple Game Center"). No passwords and no emails:
 *
 *  - The iPhone / iPad app: Game Center. The app hands over Apple's signed identity (gameCenter.ts
 *    `gameCenterIdentity`), the gc-login edge function checks the signature and answers with a session for that
 *    player's account. A new device with the same Game Center player gets the same account and its cloud save.
 *  - No Game Center (the player declined it, or this is the web game): a device account. A random secret kept
 *    on the device goes to the device-login edge function, which answers with a session for that device's
 *    account. Nobody is locked out, and nothing is asked.
 *  - Later the same player signs in to Game Center: the device account becomes the Game Center account (no
 *    merge needed). If that Game Center player already has an account, the game switches to it and cloud.ts
 *    compares the two saves: a fresh one gives way silently, two real ones ask once (WHICH SAVE?).
 *
 * All of it is silent: `connect()` runs after launch, when the connection comes back, and from the CONNECT TO
 * PLAY panel's RETRY. The web game keeps its Google / GitHub / email / guest sign-in in the ACCOUNT panel.
 *
 * Also here: DELETE ACCOUNT (the App Store requires it wherever an account exists) and the friend code.
 * main.ts loads this file behind the literal VITE_PORTAL check, so portal builds carry none of it.
 */
import { defaultSave } from '../core/save';
import { addGems, normalizeGems } from '../meta/gems';
import { FRIEND_LIMIT, friendRewards, normalizeFriendReceipts, type FriendReward } from '../meta/referrals';
import {
  accountsRequired, adoptSession, callFunction, cloudAvailable, cloudNotice, cloudSession, cloudStatus, cloudUser, flushNow, forgetAccount, onCloudChange, syncSoon,
  type CloudContext,
} from './cloud';
import { gameCenterIdentity, gameCenterPlayerId, gameCenterSignInOnce } from './gameCenter';
import { inNativeApp } from './native';
import { setConnecting } from './online';

/** The device's own secret (random, never shown): the credential of its device account. */
export const DEVICE_SECRET_KEY = 'blocky-league-device-v1';
/** The Game Center player the session on this device was made for (so another player signing in is noticed). */
export const GC_PLAYER_KEY = 'blocky-league-gc-player';
/** The friend-code panel has been opened here: only then is a reward looked for at launch. */
export const FRIEND_SEEN_KEY = 'blocky-league-friend-seen';
/** How long the launch waits for Game Center's answer before the device account steps in. */
export const GAME_CENTER_WAIT_MS = 6000;
const RETRY_MIN_MS = 20_000;
const RETRY_MAX_MS = 5 * 60_000;

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null): void => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Storage unavailable: a new secret is made next time, which only means a new account.
  }
};

/** 48 random bytes as 64 URL-safe characters. */
export function newSecret(): string {
  const b = new Uint8Array(48);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** This device's secret, made on first use. */
export function deviceSecret(): string {
  const have = read(DEVICE_SECRET_KEY);
  if (have && /^[A-Za-z0-9_-]{32,128}$/.test(have)) return have;
  const made = newSecret();
  write(DEVICE_SECRET_KEY, made);
  return made;
}

// ------------------------------------------------------------------ the plan (pure: tests/signin.test.ts)

export type SignInPlan = 'none' | 'gamecenter' | 'device';

export interface SignInFacts {
  /** This build has a backend. */
  available: boolean;
  /** An account is signed in, and which kind ('gamecenter', 'device', 'google', 'guest', ...). */
  signedIn: boolean;
  kind: string | null;
  /** The player is signed in to Game Center on this device (the app only). */
  gameCenter: boolean;
  /** Game Center's player is not the one the current session was made for. */
  gameCenterChanged: boolean;
  /** The player pressed SIGN OUT (or DELETE ACCOUNT) this session. */
  signedOutByPlayer: boolean;
  /** The player asked for it (RETRY), as opposed to the silent attempt. */
  explicit: boolean;
}

/** What the sign-in should try. */
export function planSignIn(f: SignInFacts): SignInPlan {
  if (!f.available) return 'none';
  // He signed out himself: nothing signs him back in behind his back.
  if (f.signedOutByPlayer && !f.explicit) return 'none';
  if (f.gameCenter) {
    if (!f.signedIn) return 'gamecenter';
    // A device account moves under Game Center; another Game Center player on this device gets his own account.
    if (f.kind === 'device' || (f.kind === 'gamecenter' && f.gameCenterChanged)) return 'gamecenter';
    // (Google, GitHub, email, guest: the player chose that account himself. It stays.)
    return 'none';
  }
  return f.signedIn ? 'none' : 'device';
}

// ------------------------------------------------------------------ connect

interface Tokens {
  access_token: string;
  refresh_token: string;
  kind?: string;
  created?: boolean;
  switched?: boolean;
}

let running: Promise<boolean> | null = null;
let lastError: string | null = null;

/** Why the last attempt failed ('network', 'rate_limited', 'server', ...), or null. */
export function connectError(): string | null {
  return lastError;
}

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, () => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

const tokensOk = (d: Tokens | null): d is Tokens => !!d && typeof d.access_token === 'string' && typeof d.refresh_token === 'string';

/**
 * Sign in, silently. True when the game ends up signed in. One attempt at a time: a second caller gets the
 * running one's answer. `explicit`: the player pressed RETRY (it also signs back in after his own SIGN OUT).
 */
export function connect(explicit = false): Promise<boolean> {
  running ??= attempt(explicit).finally(() => {
    running = null;
  });
  return running;
}

async function attempt(explicit: boolean): Promise<boolean> {
  // (Switched off, or no backend: the game makes no account by itself.)
  if (!accountsRequired() && !(explicit && cloudAvailable())) return false;
  setConnecting(true);
  try {
    const gc = inNativeApp() ? await timeout(gameCenterSignInOnce(), GAME_CENTER_WAIT_MS, false) : false;
    const player = gc ? gameCenterPlayerId() : null;
    const plan = planSignIn({
      available: true, signedIn: !!cloudSession(), kind: cloudUser()?.provider ?? null, gameCenter: gc,
      gameCenterChanged: !!player && read(GC_PLAYER_KEY) !== player,
      signedOutByPlayer: cloudStatus().signedOut, explicit,
    });
    if (plan === 'none') {
      lastError = null;
      return !!cloudSession();
    }
    if (plan === 'gamecenter') {
      // Apple signs the player's identity; the gc-login function checks that signature before it trusts the id.
      const identity = await gameCenterIdentity();
      const r = identity ? await callFunction<Tokens>('gc-login', { ...identity, deviceSecret: deviceSecret() }) : null;
      if (identity && r?.ok && tokensOk(r.data) && (await adoptSession(r.data))) {
        write(GC_PLAYER_KEY, identity.teamPlayerId);
        lastError = null;
        return true;
      }
      lastError = r?.error ?? 'game_center';
      console.warn('[cloud] Game Center sign-in failed:', lastError);
      // Game Center could not be confirmed now: an account already in keeps the player playing, else the device's does.
      if (cloudSession()) return true;
    }
    const r = await callFunction<Tokens>('device-login', { secret: deviceSecret() }, { auth: false });
    if (r.ok && tokensOk(r.data) && (await adoptSession(r.data))) {
      lastError = null;
      return true;
    }
    lastError = r.error ?? 'session';
    console.warn('[cloud] device sign-in failed:', lastError);
    return false;
  } catch (err) {
    lastError = 'network';
    console.warn('[cloud] sign-in failed:', err);
    return false;
  } finally {
    setConnecting(false);
  }
}

let watching = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIn = RETRY_MIN_MS;

/**
 * Keep the player signed in from here on: now, whenever the connection comes back, when the app returns to the
 * foreground, and (backing off) while an attempt keeps failing. Game Center answering late moves a device account
 * under it. Call once, after cloudBoot.
 */
export function watchConnection(ctx: CloudContext): void {
  if (watching || !accountsRequired() || typeof window === 'undefined') return;
  watching = true;
  const offline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
  const again = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (cloudSession() || cloudStatus().signedOut || offline()) return;
    retryTimer = setTimeout(go, retryIn);
    retryIn = Math.min(RETRY_MAX_MS, retryIn * 2);
  };
  let friendChecked = false;
  const go = (): void => {
    if (offline()) return;
    void connect().then((ok) => {
      if (ok) {
        retryIn = RETRY_MIN_MS;
        if (!friendChecked) {
          friendChecked = true;
          void friendCoinsAtLaunch(ctx);
        }
      } else {
        again();
      }
    });
  };
  go();
  window.addEventListener('online', go);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !cloudSession()) go();
    });
  }
  // Game Center answered after the wait (its sheet was up): a device account moves under it.
  if (inNativeApp()) void gameCenterSignInOnce().then((ok) => ok && go());
  // The server ended the session (the account was removed elsewhere): sign in again.
  let had = !!cloudSession();
  onCloudChange(() => {
    const has = !!cloudSession();
    if (had && !has && !cloudStatus().signedOut) go();
    had = has;
  });
}

// ------------------------------------------------------------------ delete account

export type DeleteResult = 'ok' | 'offline' | 'failed';

/**
 * DELETE ACCOUNT: the delete-account edge function removes the account and every row it owns; then this device
 * forgets it too: the session, the device secret, and the progress (a fresh save), so nothing of the account is left
 * anywhere. Purchases stay with the store account and come back through the shop's restore.
 */
export async function deleteAccount(ctx: CloudContext): Promise<DeleteResult> {
  if (!cloudSession()) return 'failed';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const r = await callFunction('delete-account', {});
  if (!r.ok) return r.error === 'network' ? 'offline' : 'failed';
  await forgetAccount();
  write(DEVICE_SECRET_KEY, null);
  write(GC_PLAYER_KEY, null);
  write(FRIEND_SEEN_KEY, null);
  ctx.reload(defaultSave());
  ctx.persist();
  return 'ok';
}

// ------------------------------------------------------------------ friend codes

export type ClaimResult = 'ok' | 'unknown_code' | 'own_code' | 'already_used' | 'win_first' | 'too_late' | 'friend_full' | 'rate_limited' | 'offline' | 'failed';

const CLAIM_ERRORS: readonly string[] = ['unknown_code', 'own_code', 'already_used', 'win_first', 'too_late', 'friend_full', 'rate_limited'];

export interface FriendStatus {
  ok: boolean;
  coins: number;
  gems: number;
  friends: number;
  claimed: boolean;
  rewards: FriendReward[];
}
const emptyFriendStatus = (): FriendStatus => ({ ok: false, coins: 0, gems: 0, friends: 0, claimed: false, rewards: [] });

/** Read durable grants. The server never consumes them merely because a response was sent. */
export async function friendRewardStatus(ctx: CloudContext): Promise<FriendStatus> {
  const uid = cloudSession()?.userId;
  if (!uid) return emptyFriendStatus();
  const r = await callFunction<{ rewards?: unknown; friends?: unknown; claimed?: unknown }>('referral', { action: 'collect', protocol: 2 });
  if (!r.ok || cloudSession()?.userId !== uid || !Array.isArray(r.data?.rewards)) return emptyFriendStatus();
  const applied = new Set(normalizeFriendReceipts(ctx.save.friendReceipts));
  const rewards = friendRewards(r.data.rewards).filter((grant) => !applied.has(grant.id));
  return {
    ok: true,
    coins: rewards.reduce((n, r) => n + r.coins, 0),
    gems: rewards.reduce((n, r) => n + r.gems, 0),
    friends: typeof r.data.friends === 'number' && Number.isFinite(r.data.friends) ? Math.max(0, Math.min(FRIEND_LIMIT, Math.floor(r.data.friends))) : 0,
    claimed: r.data.claimed === true,
    rewards,
  };
}

const collections = new WeakMap<CloudContext, Promise<FriendStatus>>();

/** Coins AND gems, retained under the old exported name for callers. One receipt is applied per saved wallet. */
export function collectFriendCoins(ctx: CloudContext): Promise<FriendStatus> {
  const running = collections.get(ctx);
  if (running) return running;
  const next = collectFriendRewards(ctx).finally(() => collections.delete(ctx));
  collections.set(ctx, next);
  return next;
}

async function collectFriendRewards(ctx: CloudContext): Promise<FriendStatus> {
  const uid = cloudSession()?.userId;
  const save = ctx.save;
  const receiptsBeforeFetch = save.friendReceipts;
  const paid = await friendRewardStatus(ctx);
  // Account switches and cloud loads can happen while a request is in flight, even by mutating the same save.
  if (!uid || cloudSession()?.userId !== uid || ctx.save !== save || save.friendReceipts !== receiptsBeforeFetch) return emptyFriendStatus();
  if (!paid.ok || !paid.rewards.length) return paid;
  const before = { coins: save.coins, gems: save.gems, receipts: save.friendReceipts };
  save.gems = normalizeGems(save.gems);
  save.coins += paid.coins;
  addGems(save, paid.gems, 'friend referral');
  save.friendReceipts = [...normalizeFriendReceipts(save.friendReceipts), ...paid.rewards.map((r) => r.id)];
  try {
    // Currency and receipts are one save, so a retry or another device's cloud copy cannot add them twice.
    if (ctx.persist() === false) throw new Error('save unavailable');
  } catch {
    save.coins = before.coins;
    save.gems = before.gems;
    save.friendReceipts = before.receipts;
    return emptyFriendStatus();
  }
  syncSoon();
  return paid;
}

/** Claims are idempotent for the same code, including after an interrupted response. */
export async function claimFriendCode(ctx: CloudContext, code: string): Promise<{ result: ClaimResult; coins: number; gems: number; pending?: boolean }> {
  const uid = cloudSession()?.userId;
  if (!uid) return { result: 'failed', coins: 0, gems: 0 };
  // The server checks the first win in the cloud copy. Never claim against a failed/stale upload.
  if (!(await flushNow()) || cloudSession()?.userId !== uid) return { result: 'offline', coins: 0, gems: 0 };
  const r = await callFunction('referral', { action: 'claim', protocol: 2, code: code.trim().toUpperCase() });
  if (cloudSession()?.userId !== uid) return { result: 'failed', coins: 0, gems: 0 };
  if (!r.ok) {
    const e = r.error ?? '';
    return { result: e === 'network' ? 'offline' : CLAIM_ERRORS.includes(e) ? (e as ClaimResult) : 'failed', coins: 0, gems: 0 };
  }
  friendCodeSeen();
  const paid = await collectFriendCoins(ctx);
  return { result: 'ok', coins: paid.coins, gems: paid.gems, pending: !paid.ok };
}

/** The friend-code panel was opened here: from now on a reward is looked for at launch. */
export function friendCodeSeen(): void {
  write(FRIEND_SEEN_KEY, '1');
}

async function friendCoinsAtLaunch(ctx: CloudContext): Promise<void> {
  if (read(FRIEND_SEEN_KEY) !== '1') return;
  const paid = await collectFriendCoins(ctx);
  if (paid.coins > 0 || paid.gems > 0) cloudNotice(`Friend rewards: +${paid.coins.toLocaleString()} coins + ${paid.gems} gems`, 'good');
}

export function _resetSigninForTests(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryIn = RETRY_MIN_MS;
  running = null;
  lastError = null;
  watching = false;
}
