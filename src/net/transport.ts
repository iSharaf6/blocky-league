/**
 * Transports for online play: something that carries the lockstep engine's messages (src/net/lockstep.ts) to the
 * other peer. Two kinds, behind one interface:
 *
 * - BroadcastChannel (BroadcastTransport): two tabs or windows of the same browser on one machine. For testing
 *   and a couch demo; no network at all. A host announces a room on a discovery channel, a guest joins it.
 * - WebRTC DataChannel (src/net/rtc.ts): two machines, peer to peer, with manual signalling (an offer code and
 *   an answer code pasted across). Pads go on an unordered channel with no retransmits (the engine repeats every
 *   unacknowledged pad in each packet), control messages on a reliable ordered one.
 *
 * Messages are either a string (JSON control) or an ArrayBuffer (a binary input packet).
 */

export type NetData = string | ArrayBuffer;

export interface Transport {
  readonly kind: 'broadcast' | 'webrtc' | 'loopback';
  /** `reliable`: must arrive, in order (control). Otherwise it may be dropped or overtaken (pads, pings). */
  send(data: NetData, reliable: boolean): void;
  /** Incoming data from the peer (set by whoever owns the transport). */
  onMessage: ((data: NetData) => void) | null;
  /** The link went down (the peer closed it, the connection failed): called once. */
  onClose: ((reason: string) => void) | null;
  close(): void;
  readonly open: boolean;
}

// ------------------------------------------------------------------ BroadcastChannel (same browser)

const ROOM_PREFIX = 'blocky-league-net:';
/** Hosts waiting for a guest announce themselves here (the guest's FIND list). */
const DISCOVERY = 'blocky-league-net-rooms';
const ANNOUNCE_MS = 400;

export const broadcastAvailable = (): boolean => typeof BroadcastChannel !== 'undefined';

interface Envelope {
  /** Sender id, and the one it's for ('*' while the guest is knocking). */
  from: string;
  to: string;
  /** 'join' (guest knocks), 'welcome' (host answers), 'data', 'bye'. */
  k: 'join' | 'welcome' | 'data' | 'bye';
  d?: NetData;
}

const randomId = (n = 8): string => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};

/** A 4-letter room code, easy to read out (no 0 / O, 1 / I / L). */
export function roomCode(): string {
  return randomId(4).toUpperCase();
}

/** One end of a paired BroadcastChannel room. */
export class BroadcastTransport implements Transport {
  readonly kind = 'broadcast' as const;
  onMessage: ((data: NetData) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private closed = false;
  private readonly bye = (): void => this.close();

  private constructor(private readonly ch: BroadcastChannel, private readonly me: string, private readonly peer: string) {
    ch.onmessage = (e: MessageEvent<Envelope>) => {
      const m = e.data;
      if (!m || m.to !== this.me || m.from !== this.peer) return;
      if (m.k === 'data' && m.d !== undefined) this.onMessage?.(m.d);
      else if (m.k === 'bye') this.shut('the other tab left');
    };
    addEventListener('pagehide', this.bye);
  }

  get open(): boolean {
    return !this.closed;
  }

  send(data: NetData, _reliable: boolean): void {
    if (this.closed) return;
    this.ch.postMessage({ from: this.me, to: this.peer, k: 'data', d: data } satisfies Envelope);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.ch.postMessage({ from: this.me, to: this.peer, k: 'bye' } satisfies Envelope);
    } catch {
      // (already gone)
    }
    this.shut('closed');
  }

  private shut(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    removeEventListener('pagehide', this.bye);
    this.ch.onmessage = null;
    this.ch.close();
    this.onClose?.(reason);
  }

  /**
   * Host a room: announce it until a guest joins, then resolve with the paired transport. `cancel()` stops
   * waiting (the promise then rejects).
   */
  static host(room: string, name: string): { ready: Promise<BroadcastTransport>; cancel: () => void } {
    const me = randomId();
    const ch = new BroadcastChannel(ROOM_PREFIX + room);
    const disc = new BroadcastChannel(DISCOVERY);
    let done = false;
    let rejectIt: (e: Error) => void = () => {};
    const announce = (): void => disc.postMessage({ room, name, at: Date.now() });
    announce();
    const timer = setInterval(announce, ANNOUNCE_MS);
    const stop = (): void => {
      done = true;
      clearInterval(timer);
      disc.close();
    };
    const ready = new Promise<BroadcastTransport>((resolve, reject) => {
      rejectIt = reject;
      ch.onmessage = (e: MessageEvent<Envelope>) => {
        const m = e.data;
        if (done || !m || m.k !== 'join' || m.to !== '*') return;
        stop();
        ch.postMessage({ from: me, to: m.from, k: 'welcome' } satisfies Envelope);
        resolve(new BroadcastTransport(ch, me, m.from));
      };
    });
    return {
      ready,
      cancel: () => {
        if (done) return;
        stop();
        ch.close();
        rejectIt(new Error('cancelled'));
      },
    };
  }

  /** Join a room by its code: knock until the host answers (or `timeoutMs` passes). */
  static join(room: string, timeoutMs = 5000): Promise<BroadcastTransport> {
    const me = randomId();
    const ch = new BroadcastChannel(ROOM_PREFIX + room.trim().toUpperCase());
    return new Promise<BroadcastTransport>((resolve, reject) => {
      const knock = (): void => ch.postMessage({ from: me, to: '*', k: 'join' } satisfies Envelope);
      const timer = setInterval(knock, 250);
      const give = setTimeout(() => {
        clearInterval(timer);
        ch.close();
        reject(new Error('No host with that code in this browser.'));
      }, timeoutMs);
      ch.onmessage = (e: MessageEvent<Envelope>) => {
        const m = e.data;
        if (!m || m.k !== 'welcome' || m.to !== me) return;
        clearInterval(timer);
        clearTimeout(give);
        resolve(new BroadcastTransport(ch, me, m.from));
      };
      knock();
    });
  }

  /** Rooms being hosted in this browser right now: `onRooms` gets the list as it changes. Returns a stop function. */
  static watchRooms(onRooms: (rooms: { room: string; name: string }[]) => void): () => void {
    const disc = new BroadcastChannel(DISCOVERY);
    const seen = new Map<string, { name: string; at: number }>();
    const emit = (): void => {
      const now = Date.now();
      for (const [k, v] of seen) if (now - v.at > ANNOUNCE_MS * 4) seen.delete(k);
      onRooms([...seen].map(([room, v]) => ({ room, name: v.name })));
    };
    disc.onmessage = (e: MessageEvent<{ room: string; name: string }>) => {
      if (!e.data?.room) return;
      seen.set(e.data.room, { name: String(e.data.name ?? ''), at: Date.now() });
      emit();
    };
    const timer = setInterval(emit, ANNOUNCE_MS * 2);
    return () => {
      clearInterval(timer);
      disc.close();
    };
  }
}

// ------------------------------------------------------------------ in-memory pair (tests, dev)

/**
 * Two transports wired back to back in memory, delivering through `deliver` (default: straight away). Tests use
 * it with a scheduler that adds latency, jitter, loss and reordering to the unreliable messages.
 */
export function transportPair(
  deliver: (fn: () => void, reliable: boolean, from: 0 | 1) => void = (fn) => fn(),
): [Transport, Transport] {
  const make = (idx: 0 | 1): Transport & { peer?: Transport & { closed: boolean }; closed: boolean } => ({
    kind: 'loopback',
    onMessage: null,
    onClose: null,
    closed: false,
    get open() {
      return !this.closed;
    },
    send(data: NetData, reliable: boolean) {
      if (this.closed) return;
      const peer = this.peer!;
      // (A copy: the receiver never shares the sender's buffer.)
      const copy = typeof data === 'string' ? data : data.slice(0);
      deliver(() => {
        if (!peer.closed) peer.onMessage?.(copy);
      }, reliable, idx);
    },
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onClose?.('closed');
      const peer = this.peer!;
      deliver(() => {
        if (peer.closed) return;
        peer.closed = true;
        peer.onClose?.('the other side left');
      }, true, idx);
    },
  });
  const a = make(0);
  const b = make(1);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
