import { DEFAULT_DELAY, Lockstep } from './lockstep';
import { cleanControls, clubIdx, NET_HALVES, NET_VERSION, netSeed, type MatchSetup, type NetControls } from './setup';
import type { NetData, Transport } from './transport';
import type { MatchMode } from '../sim/types';

/**
 * The online lobby over a connected transport: who's who, the host's rules, both players' clubs and READY, the
 * kick-off, the rematch. UI-free (src/ui/online.ts draws it). The host decides the match (its club is home);
 * the guest brings its club and control settings. Once a match starts, its Lockstep engine takes the link's
 * input packets and its own control messages; everything else here stays the lobby's.
 */

export interface PeerInfo {
  name: string;
  /** PRESET_CLUBS index. */
  club: number;
  controls: NetControls;
  ready: boolean;
}

export interface Rules {
  mode: MatchMode;
  halfMinutes: number;
  timeOfDay: 'day' | 'sunset' | 'night';
  weather: 'clear' | 'rain' | 'snow';
}

export const DEFAULT_RULES: Rules = { mode: 'classic', halfMinutes: 2, timeOfDay: 'day', weather: 'clear' };

type LobbyMsg =
  | { t: 'hello'; v: number; app: string; me: PeerInfo }
  | { t: 'me'; me: PeerInfo }
  | { t: 'rules'; rules: Rules }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'rematch'; want: boolean }
  | { t: 'leave' }
  | { t: 'ka' };

/** Lobby keep-alive, and how long without a word the other player counts as gone (not during a match: the engine watches then). */
const KEEPALIVE_MS = 1000;
const LOBBY_TIMEOUT_MS = 10_000;

export type Role = 'host' | 'guest';

export class OnlineLink {
  peer: PeerInfo | null = null;
  rules: Rules;
  /** The match being played (or just played): its setup and lockstep engine. */
  setup: MatchSetup | null = null;
  lock: Lockstep | null = null;
  /** A rematch asked for: by this side, by the other. */
  rematch = { me: false, peer: false };
  /** Why the lobby can't go on (a version mismatch, the other player gone), else null. */
  error: string | null = null;
  gone = false;

  onChange: (() => void) | null = null;
  /** A match starts (both sides, the same setup): build it and play. */
  onStart: ((s: MatchSetup, lock: Lockstep) => void) | null = null;

  private epoch = -1;
  private lastHeard = performance.now();
  private lastSent = 0;

  constructor(readonly tx: Transport, readonly role: Role, public me: PeerInfo, readonly app: string, rules: Rules = DEFAULT_RULES) {
    this.rules = { ...rules };
    tx.onMessage = (d) => this.receive(d);
    tx.onClose = (reason) => {
      this.lock?.linkClosed(reason);
      this.fail(reason === 'closed' ? 'The other player left.' : reason);
    };
    this.send({ t: 'hello', v: NET_VERSION, app, me: this.me });
    if (role === 'host') this.send({ t: 'rules', rules: this.rules });
  }

  /** Both ready, different clubs, and nothing wrong: the host may kick off. */
  get canStart(): boolean {
    return this.role === 'host' && !!this.peer && this.me.ready && this.peer.ready && this.me.club !== this.peer.club && !this.error;
  }

  /** In a match right now (the engine running, not stopped). */
  get playing(): boolean {
    return !!this.lock && this.lock.running;
  }

  setMe(p: Partial<PeerInfo>): void {
    this.me = { ...this.me, ...p };
    this.send({ t: 'me', me: this.me });
    this.changed();
  }

  setRules(r: Partial<Rules>): void {
    if (this.role !== 'host') return;
    this.rules = { ...this.rules, ...r };
    this.send({ t: 'rules', rules: this.rules });
    this.changed();
  }

  /** Host: kick off (both ready). */
  start(): boolean {
    if (!this.canStart || !this.peer) return false;
    // (Cleaned here as the guest cleans it: both then hold exactly the same numbers.)
    const setup: MatchSetup = cleanSetup({
      epoch: this.epoch + 1,
      seed: netSeed(),
      home: this.me.club,
      away: this.peer.club,
      mode: this.rules.mode,
      halfMinutes: this.rules.halfMinutes,
      timeOfDay: this.rules.timeOfDay,
      weather: this.rules.weather,
      controls: [this.me.controls, this.peer.controls],
      delay: DEFAULT_DELAY,
    });
    this.send({ t: 'start', setup });
    this.begin(setup);
    return true;
  }

  /** Full time: ask for another (the host starts it once both have). */
  askRematch(want = true): void {
    this.rematch.me = want;
    this.send({ t: 'rematch', want });
    this.changed();
    this.maybeRematch();
  }

  /** Walk away: the other side is told, the link closed. */
  leave(): void {
    if (this.lock?.running) this.lock.leave();
    this.send({ t: 'leave' });
    this.gone = true;
    // (Give the goodbye a moment to leave before the channel does.)
    setTimeout(() => this.tx.close(), 150);
  }

  /** Once a frame or so: the lobby's keep-alive and timeout (a match's engine keeps its own). */
  tick(): void {
    if (this.gone) return;
    const now = performance.now();
    if (now - this.lastSent > KEEPALIVE_MS) this.send({ t: 'ka' });
    if (!this.playing && now - this.lastHeard > LOBBY_TIMEOUT_MS) this.fail('Lost touch with the other player.');
  }

  // ---------------------------------------------------------------- internals

  private receive(d: NetData): void {
    this.lastHeard = performance.now();
    if (this.lock?.receive(d)) return;
    if (typeof d !== 'string') return;
    let m: LobbyMsg;
    try {
      m = JSON.parse(d) as LobbyMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case 'hello':
        if (m.v !== NET_VERSION || m.app !== this.app) {
          this.fail(`The two games are different versions (${this.app} here, ${String(m.app)} there). Update both, then try again.`);
          return;
        }
        this.peer = cleanPeer(m.me);
        break;
      case 'me':
        this.peer = cleanPeer(m.me);
        break;
      case 'rules':
        if (this.role === 'guest') this.rules = cleanRules(m.rules);
        break;
      case 'start':
        if (this.role === 'guest' && m.setup && m.setup.epoch > this.epoch) this.begin(cleanSetup(m.setup));
        return;
      case 'rematch':
        this.rematch.peer = !!m.want;
        this.maybeRematch();
        break;
      case 'leave':
        this.lock?.linkClosed('The other player left the match.');
        this.fail('The other player left.');
        return;
      default:
        return;
    }
    this.changed();
  }

  private begin(s: MatchSetup): void {
    this.epoch = s.epoch;
    this.setup = s;
    this.rematch = { me: false, peer: false };
    this.me = { ...this.me, ready: false };
    if (this.peer) this.peer = { ...this.peer, ready: false };
    const side = this.role === 'host' ? 0 : 1;
    this.lock = new Lockstep(this.tx, { side, epoch: s.epoch, delay: s.delay });
    this.onStart?.(s, this.lock);
    this.changed();
  }

  private maybeRematch(): void {
    if (this.role !== 'host' || !this.rematch.me || !this.rematch.peer || !this.peer) return;
    // (Same clubs and rules; a new seed.)
    this.me = { ...this.me, ready: true };
    this.peer = { ...this.peer, ready: true };
    this.start();
  }

  private fail(msg: string): void {
    if (this.gone && this.error) return;
    this.error = msg;
    this.gone = true;
    this.changed();
  }

  private send(m: LobbyMsg): void {
    this.lastSent = performance.now();
    this.tx.send(JSON.stringify(m), true);
  }

  private changed(): void {
    this.onChange?.();
  }
}

function cleanPeer(p: Partial<PeerInfo> | undefined): PeerInfo {
  return {
    name: String(p?.name ?? 'PLAYER').slice(0, 16).toUpperCase(),
    club: clubIdx(p?.club, 0),
    controls: cleanControls(p?.controls),
    ready: !!p?.ready,
  };
}

function cleanRules(r: Partial<Rules> | undefined): Rules {
  return {
    mode: r?.mode === 'blitz' ? 'blitz' : 'classic',
    halfMinutes: (NET_HALVES as readonly number[]).includes(r?.halfMinutes ?? -1) ? r!.halfMinutes! : DEFAULT_RULES.halfMinutes,
    timeOfDay: r?.timeOfDay === 'sunset' || r?.timeOfDay === 'night' ? r.timeOfDay : 'day',
    weather: r?.weather === 'rain' || r?.weather === 'snow' ? r.weather : 'clear',
  };
}

function cleanSetup(s: MatchSetup): MatchSetup {
  const r = cleanRules(s);
  return {
    epoch: Math.max(0, Math.floor(Number(s.epoch) || 0)),
    seed: Math.floor(Number(s.seed) || 0) >>> 0,
    home: clubIdx(s.home, 0),
    away: clubIdx(s.away, 1),
    ...r,
    controls: [cleanControls(s.controls?.[0]), cleanControls(s.controls?.[1])],
    delay: Math.max(2, Math.min(8, Math.round(Number(s.delay) || DEFAULT_DELAY))),
  };
}
