/**
 * Offer / answer codes for manual WebRTC signalling: a data-channel-only session description squeezed into a
 * short base64url string a player can copy into a chat and paste on the other machine.
 *
 * Format 1 (compact, ~70-200 characters): only what the other side needs to reach us: the ICE username
 * fragment and password, the DTLS certificate's SHA-256 fingerprint, the DTLS role, and the UDP candidates
 * (type, address, port). The other side rebuilds a minimal SDP around them (sctp-port 5000, mid 0).
 * Format 2 (fallback, longer): the whole SDP, deflated, for a description format 1 can't carry (another hash,
 * an unusual mid), so an odd browser still connects, just with a longer code.
 *
 * Both start with a digit (the format) and end with a checksum byte, so a code cut short in the paste is caught.
 */

export type SdpKind = 'offer' | 'answer';

export interface SdpCandidate {
  type: 'host' | 'srflx' | 'prflx' | 'relay';
  address: string;
  port: number;
}

export interface SdpEssentials {
  kind: SdpKind;
  ufrag: string;
  pwd: string;
  /** SHA-256 fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  candidates: SdpCandidate[];
}

const TYPES = ['host', 'srflx', 'prflx', 'relay'] as const;
const SETUPS = ['actpass', 'active', 'passive'] as const;
/** Candidates kept at most (the first ones: browsers list the best first). */
const MAX_CANDIDATES = 8;

/** The essentials of a data-channel-only SDP, or null when format 1 can't carry it. */
export function parseSdp(sdp: string, kind: SdpKind): SdpEssentials | null {
  const lines = sdp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mLines = lines.filter((l) => l.startsWith('m='));
  if (mLines.length !== 1 || !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel/.test(mLines[0])) return null;
  const val = (prefix: string): string | null => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length) ?? null;
  const ufrag = val('a=ice-ufrag:');
  const pwd = val('a=ice-pwd:');
  const fp = val('a=fingerprint:');
  const setup = val('a=setup:');
  const mid = val('a=mid:');
  if (!ufrag || !pwd || !fp || !setup || mid !== '0') return null;
  if (!/^[\x21-\x7e]{1,255}$/.test(ufrag) || !/^[\x21-\x7e]{1,255}$/.test(pwd)) return null;
  const [alg, hex] = fp.split(' ');
  if (alg?.toLowerCase() !== 'sha-256' || !hex) return null;
  const bytes = hex.split(':').map((h) => parseInt(h, 16));
  if (bytes.length !== 32 || bytes.some((b) => !(b >= 0 && b <= 255))) return null;
  if (!(SETUPS as readonly string[]).includes(setup)) return null;
  const sctp = val('a=sctp-port:');
  if (sctp !== null && sctp !== '5000') return null;
  const candidates: SdpCandidate[] = [];
  for (const l of lines) {
    if (!l.startsWith('a=candidate:')) continue;
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
    const f = l.slice('a=candidate:'.length).split(' ');
    if (f.length < 8 || f[1] !== '1' || f[2].toLowerCase() !== 'udp' || f[6] !== 'typ') continue;
    const type = f[7] as SdpCandidate['type'];
    const port = Number(f[5]);
    if (!(TYPES as readonly string[]).includes(type) || !(port > 0 && port < 65536)) continue;
    // (IPv6 in its full form, as the code carries it: the same text on both sides.)
    const v6 = ipv6Bytes(f[4]);
    const address = v6 ? Array.from({ length: 8 }, (_, k) => ((v6[k * 2] << 8) | v6[k * 2 + 1]).toString(16)).join(':') : f[4];
    if (candidates.some((c) => c.address === address && c.port === port)) continue;
    candidates.push({ type, address, port });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { kind, ufrag, pwd, fingerprint: new Uint8Array(bytes), setup: setup as SdpEssentials['setup'], candidates };
}

/** Candidate priority by type (host best), as a browser would give it; the order among ours is kept. */
const PRIORITY: Record<SdpCandidate['type'], number> = { host: 2122260223, prflx: 1845501695, srflx: 1686052607, relay: 41885439 };

/** A minimal SDP that any current browser accepts for a data channel, from the essentials. */
export function buildSdp(e: SdpEssentials): string {
  const hex = Array.from(e.fingerprint, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const out = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  e.candidates.forEach((c, i) => {
    const rel = c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    out.push(`a=candidate:${i + 1} 1 udp ${PRIORITY[c.type] - i} ${c.address} ${c.port} typ ${c.type}${rel} generation 0`);
  });
  if (e.candidates.length) out.push('a=end-of-candidates');
  out.push(
    `a=ice-ufrag:${e.ufrag}`,
    `a=ice-pwd:${e.pwd}`,
    `a=fingerprint:sha-256 ${hex}`,
    `a=setup:${e.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  );
  return out.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ bytes

class Writer {
  private b: number[] = [];
  u8(v: number): void {
    this.b.push(v & 0xff);
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  str(s: string): void {
    this.u8(s.length);
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  bytes(a: ArrayLike<number>): void {
    for (let i = 0; i < a.length; i++) this.u8(a[i]);
  }
  done(): Uint8Array {
    return new Uint8Array(this.b);
  }
}

class Reader {
  i = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Error('short');
    return this.b[this.i++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  str(): string {
    const n = this.u8();
    let s = '';
    for (let k = 0; k < n; k++) s += String.fromCharCode(this.u8());
    return s;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k++) out[k] = this.u8();
    return out;
  }
  get left(): number {
    return this.b.length - this.i;
  }
}

/** An address as bytes: IPv4 (4), IPv6 (16) or a name (an mDNS host candidate: xxxx.local). */
function writeAddress(w: Writer, a: string): number {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4 && v4.slice(1).every((x) => Number(x) <= 255)) {
    w.bytes(v4.slice(1).map(Number));
    return 0;
  }
  const v6 = ipv6Bytes(a);
  if (v6) {
    w.bytes(v6);
    return 1;
  }
  // (An mDNS name is a UUID + ".local": 16 bytes for the UUID, else the string.)
  const uuid = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i.exec(a);
  if (uuid) {
    const hex = uuid.slice(1).join('');
    for (let i = 0; i < 16; i++) w.u8(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    return 2;
  }
  w.str(a.slice(0, 255));
  return 3;
}

function readAddress(r: Reader, kind: number): string {
  if (kind === 0) return Array.from(r.bytes(4)).join('.');
  if (kind === 1) {
    const b = r.bytes(16);
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) parts.push(((b[i] << 8) | b[i + 1]).toString(16));
    return parts.join(':');
  }
  if (kind === 2) {
    const hex = Array.from(r.bytes(16), (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  }
  return r.str();
}

function ipv6Bytes(a: string): number[] | null {
  if (!a.includes(':') || !/^[0-9a-f:]+$/i.test(a)) return null;
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const v = parseInt(g, 16);
    out.push(v >> 8, v & 0xff);
  }
  return out;
}

const checksum = (b: Uint8Array, n = b.length): number => {
  let s = 0x5a;
  for (let i = 0; i < n; i++) s = (Math.imul(s, 31) + b[i]) & 0xff;
  return s;
};

export function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Format 1: the essentials as bytes, then base64url, '1' first. */
export function encodeCompact(e: SdpEssentials): string {
  const w = new Writer();
  w.u8((e.kind === 'offer' ? 0 : 1) | (SETUPS.indexOf(e.setup) << 1));
  w.str(e.ufrag);
  w.str(e.pwd);
  w.bytes(e.fingerprint);
  w.u8(e.candidates.length);
  for (const c of e.candidates) {
    // Type in the low 2 bits, the address kind in the next 2; the address written after.
    const body = new Writer();
    const kind = writeAddress(body, c.address);
    w.u8(TYPES.indexOf(c.type) | (kind << 2));
    w.bytes(body.done());
    w.u16(c.port);
  }
  const b = w.done();
  const out = new Uint8Array(b.length + 1);
  out.set(b);
  out[b.length] = checksum(b);
  return '1' + toBase64Url(out);
}

export function decodeCompact(code: string): SdpEssentials {
  const all = fromBase64Url(code.slice(1));
  if (all.length < 36 || checksum(all, all.length - 1) !== all[all.length - 1]) throw new Error('That code is incomplete or mistyped.');
  const r = new Reader(all.subarray(0, all.length - 1));
  const head = r.u8();
  const kind: SdpKind = head & 1 ? 'answer' : 'offer';
  const setup = SETUPS[(head >> 1) & 3] ?? 'actpass';
  const ufrag = r.str();
  const pwd = r.str();
  const fingerprint = r.bytes(32);
  const n = r.u8();
  const candidates: SdpCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const t = r.u8();
    const address = readAddress(r, (t >> 2) & 3);
    candidates.push({ type: TYPES[t & 3], address, port: r.u16() });
  }
  return { kind, ufrag, pwd, fingerprint, setup, candidates };
}

// ------------------------------------------------------------------ the code a player copies

async function deflate(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([s]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(b: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

/** The code for a local description: format 1 when it fits, else format 2. */
export async function sdpToCode(sdp: string, kind: SdpKind): Promise<string> {
  const e = parseSdp(sdp, kind);
  if (e && e.candidates.length) return encodeCompact(e);
  const z = await deflate(`${kind}\n${sdp}`);
  const out = new Uint8Array(z.length + 1);
  out.set(z);
  out[z.length] = checksum(z);
  return '2' + toBase64Url(out);
}

/** The other side's description from its code (throws with a message a player can act on). */
export async function codeToSdp(raw: string): Promise<{ kind: SdpKind; sdp: string }> {
  const code = raw.replace(/\s+/g, '');
  if (!/^[12][A-Za-z0-9_-]{20,}$/.test(code)) throw new Error("That doesn't look like a Blocky League code.");
  if (code[0] === '1') {
    const e = decodeCompact(code);
    return { kind: e.kind, sdp: buildSdp(e) };
  }
  const all = fromBase64Url(code.slice(1));
  if (all.length < 2 || checksum(all, all.length - 1) !== all[all.length - 1]) throw new Error('That code is incomplete or mistyped.');
  const text = await inflate(all.subarray(0, all.length - 1));
  const nl = text.indexOf('\n');
  const kind = text.slice(0, nl);
  if (kind !== 'offer' && kind !== 'answer') throw new Error('That code is incomplete or mistyped.');
  return { kind, sdp: text.slice(nl + 1) };
}
