/**
 * Game Center identity verification, pure: WebCrypto only, and the certificate fetch is passed in. Shared by the
 * gc-login edge function and tests/gcVerify.test.ts (so it imports nothing and uses no Deno API).
 *
 * The app calls GKLocalPlayer.local.fetchItems(forIdentityVerificationSignature:) and sends what it gets. Apple
 * signs, with the key in the certificate at `publicKeyUrl`, the SHA-256 of:
 *   teamPlayerID (UTF-8) + bundleID (UTF-8) + timestamp (big-endian UInt64) + salt
 * A request is accepted only when the bundle id is this app's, the timestamp is fresh, the certificate comes from
 * Apple's Game Center host over HTTPS and is inside its validity dates, and the RSA signature checks out.
 */

export interface GcIdentity {
  publicKeyUrl: string;
  /** Base64. */
  signature: string;
  /** Base64. */
  salt: string;
  /** Milliseconds since 1970 as Game Center gave it (a decimal string keeps all 64 bits). */
  timestamp: string;
  teamPlayerId: string;
  bundleId: string;
}

export type GcReject =
  | 'bad_request' | 'bad_bundle' | 'stale' | 'bad_key_url' | 'key_fetch_failed' | 'bad_certificate' | 'certificate_expired' | 'bad_signature';

export type GcResult = { ok: true; teamPlayerId: string } | { ok: false; reason: GcReject };

export interface GcOptions {
  /** The bundle ids this backend serves. */
  bundleIds: readonly string[];
  /** Now, ms. */
  now: number;
  /** How old a signature may be (default one hour: GameKit may hand back the one it made earlier this session). */
  maxAgeMs?: number;
  /** How far ahead of this clock a timestamp may be (default five minutes). */
  maxSkewMs?: number;
  /** Fetch the certificate bytes (DER or PEM) from an already validated URL. */
  fetchCert: (url: string) => Promise<Uint8Array>;
}

export const GC_MAX_AGE_MS = 60 * 60 * 1000;
export const GC_MAX_SKEW_MS = 5 * 60 * 1000;

/** Apple's Game Center key host, over HTTPS on the default port, a .cer file, no credentials. */
export function appleKeyUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.port && !u.username && !u.password
      && (host === 'gc.apple.com' || host.endsWith('.gc.apple.com')) && u.pathname.toLowerCase().endsWith('.cer');
  } catch {
    return false;
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** The request body made into an identity, or null when a field is missing or oversized. */
export function parseIdentity(raw: unknown): GcIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ts = typeof o.timestamp === 'number' && Number.isSafeInteger(o.timestamp) ? String(o.timestamp) : str(o.timestamp, 20);
  const id = {
    publicKeyUrl: str(o.publicKeyUrl, 300), signature: str(o.signature, 2048), salt: str(o.salt, 256),
    timestamp: ts && /^\d{1,20}$/.test(ts) ? ts : null, teamPlayerId: str(o.teamPlayerId, 128), bundleId: str(o.bundleId, 200),
  };
  for (const v of Object.values(id)) if (v === null) return null;
  return id as GcIdentity;
}

export function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A copy in a buffer of its own (WebCrypto wants a plain ArrayBuffer). */
function buf(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}

/** The bytes Apple signed. */
export function signedPayload(teamPlayerId: string, bundleId: string, timestamp: string, salt: Uint8Array): Uint8Array {
  const ts = new Uint8Array(8);
  new DataView(ts.buffer).setBigUint64(0, BigInt(timestamp), false);
  return concat(utf8(teamPlayerId), utf8(bundleId), ts, salt);
}

// ------------------------------------------------------------------ X.509 (just enough DER to reach the key)

interface Tlv {
  tag: number;
  /** Where the tag byte is. */
  head: number;
  /** The content. */
  start: number;
  end: number;
}

function tlv(b: Uint8Array, at: number): Tlv {
  if (at + 2 > b.length) throw new Error('der');
  const tag = b[at];
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > b.length) throw new Error('der');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
    start += n;
  }
  const end = start + len;
  if (end > b.length) throw new Error('der');
  return { tag, head: at, start, end };
}

/** UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime (YYYYMMDDHHMMSSZ) as ms. */
function derTime(b: Uint8Array, t: Tlv): number {
  let s = '';
  for (let i = t.start; i < t.end; i++) s += String.fromCharCode(b[i]);
  const m = t.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : t.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : null;
  if (!m) throw new Error('der time');
  let year = Number(m[1]);
  if (t.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}

/** A PEM certificate as DER; DER comes back as it is. */
export function pemToDer(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 11 || bytes[0] !== 0x2d) return bytes;
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  const body = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(text);
  const der = body ? fromBase64(body[1]) : null;
  if (!der) throw new Error('pem');
  return der;
}

/** The certificate's public key (its SubjectPublicKeyInfo, as importKey('spki') takes it) and validity dates. */
export function certificateKey(der: Uint8Array): { spki: Uint8Array; notBefore: number; notAfter: number } {
  const cert = tlv(der, 0);
  if (cert.tag !== 0x30) throw new Error('not a certificate');
  const tbs = tlv(der, cert.start);
  if (tbs.tag !== 0x30) throw new Error('not a certificate');
  const fields: Tlv[] = [];
  for (let at = tbs.start; at < tbs.end && fields.length < 8;) {
    const f = tlv(der, at);
    fields.push(f);
    at = f.end;
  }
  // version [0] (optional), serial, signature algorithm, issuer, validity, subject, subjectPublicKeyInfo.
  const body = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields;
  const [serial, , , validity, , spki] = body;
  if (!serial || !validity || !spki || serial.tag !== 0x02 || validity.tag !== 0x30 || spki.tag !== 0x30) throw new Error('not a certificate');
  const from = tlv(der, validity.start);
  const to = tlv(der, from.end);
  return { spki: der.slice(spki.head, spki.end), notBefore: derTime(der, from), notAfter: derTime(der, to) };
}

// ------------------------------------------------------------------ the check

export async function verifyGameCenter(id: GcIdentity, o: GcOptions): Promise<GcResult> {
  const no = (reason: GcReject): GcResult => ({ ok: false, reason });
  if (!o.bundleIds.includes(id.bundleId)) return no('bad_bundle');
  if (!/^\d{1,20}$/.test(id.timestamp)) return no('bad_request');
  const ts = Number(id.timestamp);
  if (!Number.isSafeInteger(ts) || ts <= 0) return no('bad_request');
  if (ts < o.now - (o.maxAgeMs ?? GC_MAX_AGE_MS) || ts > o.now + (o.maxSkewMs ?? GC_MAX_SKEW_MS)) return no('stale');
  if (!appleKeyUrl(id.publicKeyUrl)) return no('bad_key_url');
  const signature = fromBase64(id.signature);
  const salt = fromBase64(id.salt);
  if (!signature || !salt || !signature.length || !id.teamPlayerId) return no('bad_request');
  let raw: Uint8Array;
  try {
    raw = await o.fetchCert(id.publicKeyUrl);
  } catch {
    return no('key_fetch_failed');
  }
  let key: CryptoKey;
  try {
    const c = certificateKey(pemToDer(raw));
    if (o.now < c.notBefore || o.now > c.notAfter) return no('certificate_expired');
    key = await crypto.subtle.importKey('spki', buf(c.spki), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    return no('bad_certificate');
  }
  try {
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, buf(signature), buf(signedPayload(id.teamPlayerId, id.bundleId, id.timestamp, salt)));
    return ok ? { ok: true, teamPlayerId: id.teamPlayerId } : no('bad_signature');
  } catch {
    return no('bad_signature');
  }
}
