import { codeToSdp, sdpToCode } from './sdpCode';
import type { NetData, Transport } from './transport';

/**
 * WebRTC DataChannel transport, peer to peer, no game server. Two channels, negotiated up front (fixed ids, so
 * neither side waits on the other to announce them): 'ctl' reliable and ordered for control messages, 'pad'
 * unordered with no retransmits for pads and pings (the lockstep engine repeats unacknowledged pads itself, so a
 * lost packet is never waited on).
 *
 * Signalling is manual: the host's offer code goes to the guest (a chat, a text), the guest's answer code comes
 * back; see sdpCode.ts for the codes. ICE is gathered in full before a code is made (no trickle: one code each
 * way). NAT traversal is by a public STUN server only. There is no TURN relay (that would be a paid service), so
 * two networks that both block direct UDP (some mobile carriers, strict corporate or university firewalls,
 * symmetric NATs on both ends) won't connect; the UI says so.
 *
 * Adapter point for automated signalling: `Signaller` (below) is all a host / guest flow needs; rtcHostVia /
 * rtcJoinVia run the same handshake over one. A Supabase Realtime channel (the client in src/platform/cloud.ts,
 * once the owner configures a project) would implement it in a few lines; nothing uses it yet.
 */

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** Longest wait for ICE candidates before the code is made with what was found. */
const GATHER_MS = 5000;
/** Longest wait from the answer to the channels opening. */
const CONNECT_MS = 20_000;

export const rtcAvailable = (): boolean => typeof RTCPeerConnection !== 'undefined';

export class RtcTransport implements Transport {
  readonly kind = 'webrtc' as const;
  onMessage: ((data: NetData) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private closed = false;
  /** Resolves when both channels are open. */
  readonly ready: Promise<void>;

  constructor(readonly pc: RTCPeerConnection, private readonly ctl: RTCDataChannel, private readonly pad: RTCDataChannel) {
    for (const ch of [ctl, pad]) {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (e: MessageEvent<string | ArrayBuffer>) => this.onMessage?.(e.data);
      ch.onclose = () => this.shut('The connection closed.');
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.shut('The connection failed (the networks may block peer-to-peer).');
      else if (pc.connectionState === 'closed') this.shut('The connection closed.');
    };
    this.ready = new Promise<void>((resolve) => {
      const check = (): void => {
        if (ctl.readyState === 'open' && pad.readyState === 'open') resolve();
      };
      ctl.onopen = check;
      pad.onopen = check;
      check();
    });
  }

  get open(): boolean {
    return !this.closed;
  }

  send(data: NetData, reliable: boolean): void {
    const ch = reliable ? this.ctl : this.pad;
    if (this.closed || ch.readyState !== 'open') return;
    try {
      // (The overloads want one type at a time.)
      if (typeof data === 'string') ch.send(data);
      else ch.send(data);
    } catch {
      // A full send buffer on the unreliable channel: that packet is lost like any other.
    }
  }

  close(): void {
    this.shut('closed');
  }

  private shut(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ctl.close();
      this.pad.close();
      this.pc.close();
    } catch {
      // (already down)
    }
    this.onClose?.(reason);
  }
}

function peer(): { pc: RTCPeerConnection; t: RtcTransport } {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true });
  const pad = pc.createDataChannel('pad', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
  return { pc, t: new RtcTransport(pc, ctl, pad) };
}

/** `t` open within CONNECT_MS of both descriptions being set, or a message a player can act on. */
function opened(t: RtcTransport): Promise<RtcTransport> {
  return new Promise<RtcTransport>((resolve, reject) => {
    const timer = setTimeout(() => {
      t.close();
      reject(new Error("Couldn't connect. The two networks may not allow a direct peer-to-peer link (there is no relay server)."));
    }, CONNECT_MS);
    void t.ready.then(() => {
      clearTimeout(timer);
      resolve(t);
    });
  });
}

/** The local description once ICE gathering is complete (or GATHER_MS has passed). */
async function gathered(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, GATHER_MS);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error('The browser gave no connection details.');
  return sdp;
}

export interface RtcHosting {
  /** The code to send to the guest. */
  offer: string;
  /** The guest's answer code: resolves once the link is up. */
  accept(answer: string): Promise<RtcTransport>;
  cancel(): void;
}

/** Host: make the offer code. */
export async function rtcHost(): Promise<RtcHosting> {
  const { pc, t } = peer();
  await pc.setLocalDescription(await pc.createOffer());
  const offer = await sdpToCode(await gathered(pc), 'offer');
  return {
    offer,
    accept: async (code) => {
      const { kind, sdp } = await codeToSdp(code);
      if (kind !== 'answer') throw new Error("That's an offer code. Paste the code your friend's game gave back (the answer).");
      await pc.setRemoteDescription({ type: 'answer', sdp });
      return opened(t);
    },
    cancel: () => t.close(),
  };
}

export interface RtcJoining {
  /** The code to send back to the host. */
  answer: string;
  /** Resolves once the host has pasted the answer and the link is up. */
  connected: Promise<RtcTransport>;
  cancel(): void;
}

/** Guest: answer the host's offer code. */
export async function rtcJoin(offerCode: string): Promise<RtcJoining> {
  const { kind, sdp } = await codeToSdp(offerCode);
  if (kind !== 'offer') throw new Error("That's an answer code. Paste the host's code (the offer) here.");
  const { pc, t } = peer();
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  const answer = await sdpToCode(await gathered(pc), 'answer');
  return { answer, connected: t.ready.then(() => t), cancel: () => t.close() };
}

// ------------------------------------------------------------------ automated signalling (adapter, unused)

/**
 * Carries the two codes between host and guest for a room name, instead of the players copying them. Not
 * implemented yet: it needs a service (e.g. Supabase Realtime broadcast on a `room:<code>` channel), which is
 * the owner's call to set up.
 */
export interface Signaller {
  /** Host: publish the offer for `room`, then wait for the guest's answer. */
  offer(room: string, offer: string, signal: AbortSignal): Promise<string>;
  /** Guest: fetch the offer for `room`; `answer` sends ours back. */
  join(room: string, signal: AbortSignal): Promise<{ offer: string; answer: (code: string) => Promise<void> }>;
}

export async function rtcHostVia(s: Signaller, room: string, signal: AbortSignal): Promise<RtcTransport> {
  const h = await rtcHost();
  signal.addEventListener('abort', () => h.cancel());
  return h.accept(await s.offer(room, h.offer, signal));
}

export async function rtcJoinVia(s: Signaller, room: string, signal: AbortSignal): Promise<RtcTransport> {
  const { offer, answer } = await s.join(room, signal);
  const j = await rtcJoin(offer);
  signal.addEventListener('abort', () => j.cancel());
  await answer(j.answer);
  return j.connected;
}
