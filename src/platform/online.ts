/**
 * The online rule (the owner: "the game has to be played online, and if players aren't connected they can only
 * play exhibition"). Where a build has it switched on (the iPhone / iPad app and the plain web game, with a backend
 * and VITE_ONLINE_ACCOUNTS=on: cloud.ts `accountsRequired`), progression needs a connection AND a signed-in account: ROAD TO GLORY, MY CLUB, TRANSFERS,
 * EVENTS, the SHOP and SEASON show CONNECT TO PLAY (src/ui/connect.ts) until both are there. QUICK MATCH with the
 * preset clubs, the first match and the basics always play.
 *
 * Graceful: a connection that drops mid-session keeps everything open for OFFLINE_GRACE_MS, a match in progress is
 * never interrupted, and its result is saved on the device and goes up when the connection is back (cloud.ts
 * queues it). Portal builds (CrazyGames, Poki) and the itch zip have no backend, so the rule never applies there.
 *
 * `gateOf` and `exhibition` are pure (tests/online.test.ts); the rest reads cloud.ts and the browser.
 */
import { cloudStatus, onCloudChange } from './cloud';

/** A dropped connection is forgiven this long. */
export const OFFLINE_GRACE_MS = 3 * 60_000;

/** 'open': play anything. 'connecting': a sign-in is under way. 'connect': CONNECT TO PLAY. */
export type Gate = 'open' | 'connecting' | 'connect';

export interface GateFacts {
  /** This build needs a connection for progression (it has a backend). */
  required: boolean;
  /** The device has a network connection. */
  online: boolean;
  /** An account is signed in. */
  signedIn: boolean;
  /** A sign-in attempt is running. */
  connecting: boolean;
  /** When a connection held earlier this session was lost (ms); null if none was, or it is back. */
  droppedAt: number | null;
  now: number;
}

export function gateOf(f: GateFacts): Gate {
  if (!f.required) return 'open';
  if (f.online && f.signedIn) return 'open';
  if (f.droppedAt !== null && f.now - f.droppedAt < OFFLINE_GRACE_MS) return 'open';
  return f.connecting ? 'connecting' : 'connect';
}

/**
 * Exhibition: playable with no connection. QUICK MATCH ('quick'), the first match and PLAY NOW ('playnow'), the
 * basics ('basics') and a plain friendly (no kind). ROAD TO GLORY and its cups, CLUB RUN and MOMENTS are not.
 */
export function exhibition(kind: string | undefined): boolean {
  return kind === undefined || kind === 'quick' || kind === 'playnow' || kind === 'basics';
}

/** Why the gate is shut, for the panel's one line. */
export type GateWhy = 'offline' | 'account';

// ------------------------------------------------------------------ the running game

let connecting = false;
let wasConnected = false;
let droppedAt: number | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let lastGate: Gate | null = null;
let wired = false;
const subs = new Set<(g: Gate) => void>();

function facts(now: number): GateFacts {
  const st = cloudStatus();
  const online = !st.offline;
  const signedIn = st.user !== null;
  if (online && signedIn) {
    wasConnected = true;
    droppedAt = null;
  } else if (st.signedOut) {
    // The player signed out (or deleted the account) himself: that is not a dropped connection.
    wasConnected = false;
    droppedAt = null;
  } else if (wasConnected) {
    wasConnected = false;
    droppedAt = now;
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = setTimeout(check, OFFLINE_GRACE_MS + 50);
  }
  return { required: st.required, online, signedIn, connecting, droppedAt, now };
}

/** The gate right now. */
export function gateNow(now: number = Date.now()): Gate {
  return gateOf(facts(now));
}

/** May a match of this kind kick off now? */
export function canStart(kind: string | undefined): boolean {
  return exhibition(kind) || gateNow() === 'open';
}

export function gateWhy(): GateWhy {
  return cloudStatus().offline ? 'offline' : 'account';
}

function check(): void {
  const g = gateNow();
  if (g === lastGate) return;
  lastGate = g;
  for (const fn of subs) {
    try {
      fn(g);
    } catch {
      // A listener's error must not stop the others.
    }
  }
}

/** A sign-in attempt started or ended (src/platform/signin.ts). */
export function setConnecting(v: boolean): void {
  connecting = v;
  check();
}

/** Called whenever the gate changes (the hub redraws its tiles, the CONNECT TO PLAY panel closes itself). */
export function onGateChange(fn: (g: Gate) => void): () => void {
  if (!wired && typeof window !== 'undefined') {
    wired = true;
    lastGate = gateNow();
    onCloudChange(check);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
  }
  subs.add(fn);
  return () => void subs.delete(fn);
}

export function _resetOnlineForTests(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
  connecting = wasConnected = wired = false;
  droppedAt = null;
  lastGate = null;
  subs.clear();
}
