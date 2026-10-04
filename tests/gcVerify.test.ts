/**
 * The server's Game Center check (supabase/functions/_shared/gc.ts, used by the gc-login edge function): Apple's
 * signature over teamPlayerID + bundleID + timestamp + salt, the bundle id, the timestamp's freshness, where the
 * certificate comes from and whether it is in date. The keys and certificates here are made in the test (WebCrypto
 * and a few lines of DER), plus one real Apple certificate to prove the parser reads the real thing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GC_MAX_AGE_MS, GC_MAX_SKEW_MS, appleKeyUrl, certificateKey, fromBase64, parseIdentity, signedPayload, verifyGameCenter, type GcIdentity, type GcOptions,
} from '../supabase/functions/_shared/gc';

const BUNDLE = 'com.calynx.blockyleague';
const KEY_URL = 'https://static.gc.apple.com/public-key/gc-prod-12.cer';
const NOW = Date.UTC(2026, 9, 4, 7, 0, 0);
const PLAYER = 'T:_a1b2c3d4e5f6';

// https://static.gc.apple.com/public-key/gc-prod-12.cer (public; valid 17 March 2026 to 27 May 2027), base64 DER.
const APPLE_GC_PROD_12 = [
  'MIIHgDCCBWigAwIBAgIQBk0do4Dwm6AjBxh0JnrXnDANBgkqhkiG9w0BAQsFADBpMQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xQTA/BgNVBAMTOERpZ2lDZXJ0',
  'IFRydXN0ZWQgRzQgQ29kZSBTaWduaW5nIFJTQTQwOTYgU0hBMzg0IDIwMjEgQ0ExMB4XDTI2MDMxNzAwMDAwMFoXDTI3MDUyNzIzNTk1OVowgYcxCzAJBgNVBAYTAlVTMRMwEQYDVQQI',
  'EwpDYWxpZm9ybmlhMRIwEAYDVQQHEwlDdXBlcnRpbm8xEzARBgNVBAoTCkFwcGxlIEluYy4xJTAjBgNVBAsTHG1hbmFnZW1lbnQ6aWRtcy5ncm91cC41MzM3NzExEzARBgNVBAMTCkFw',
  'cGxlIEluYy4wggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQC3P74pn/Y1trDGtp/WoIe4L/zqNznntO8281/TWs9XYGSYi3N3Dlac7RAkkPOolTnrB7Q+YX8cgUNUnPVi8wp8',
  'SJE9DNrjgrH/seh0WTQe0RfiSfHVwzA9wdlgl21Nfet/BSOfq3Ul0IDRJ0yrd1Jz4UTmUpsKNj5/S8/pkrUdhky+sb65fU7mxdVEa5JQojuvlrJ0czOKEioHKTAj3F2gHuKgTjCybXxv',
  'ax7g7yECAzWmZkwaQBulFCH7AqdN+wTCvtKOOspz/koTguUHYR+FwnQkPTIIAtTbdKDrdvINF/AVlsh8Ai/mHiIX9fdrXg427Uwbr8EZWH0WdEBa8yHv7o9Wb5AMEAK/hM5iZbNcsz+h',
  'njNA8DRIPMj06Ezt6xcc2mLnyPhpMpOa3MdXjZ5Iel/YF7vmUAEjLPm2tkfgW+ZQJo/ktHgf7R4dtwtKLB1PgygBmNRD1+9jVAvPtIwxPHifLJvg8N3CpzK6iGbF6E8XqwJzvx4Uco+e',
  'vj57mZSYUQXstD6ylailxSz6NILSuTMiujg2LGF6vqt5IyaGfUrEdmEfchxSKwnKwP5dC81Og0XPaEKqbE6V+eZZX8J7s4vwf/FL63GGdE8G3NWg39axo0VO+vb/dyC/ZN7R9gr/FCFn',
  'skGpDJBIzidznIVY/Zcy3GKpGVqcDxteFCW7mwIDAQABo4ICAzCCAf8wHwYDVR0jBBgwFoAUaDfg67Y7+F8Rhvv+YXsIiGX0TkIwHQYDVR0OBBYEFJH+kK9nKBAuyfCvSRhKIbIooS7M',
  'MD4GA1UdIAQ3MDUwMwYGZ4EMAQQBMCkwJwYIKwYBBQUHAgEWG2h0dHA6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMwgbUG',
  'A1UdHwSBrTCBqjBToFGgT4ZNaHR0cDovL2NybDMuZGlnaWNlcnQuY29tL0RpZ2lDZXJ0VHJ1c3RlZEc0Q29kZVNpZ25pbmdSU0E0MDk2U0hBMzg0MjAyMUNBMS5jcmwwU6BRoE+GTWh0',
  'dHA6Ly9jcmw0LmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydFRydXN0ZWRHNENvZGVTaWduaW5nUlNBNDA5NlNIQTM4NDIwMjFDQTEuY3JsMIGUBggrBgEFBQcBAQSBhzCBhDAkBggrBgEFBQcw',
  'AYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMFwGCCsGAQUFBzAChlBodHRwOi8vY2FjZXJ0cy5kaWdpY2VydC5jb20vRGlnaUNlcnRUcnVzdGVkRzRDb2RlU2lnbmluZ1JTQTQwOTZT',
  'SEEzODQyMDIxQ0ExLmNydDAJBgNVHRMEAjAAMA0GCSqGSIb3DQEBCwUAA4ICAQC1MkepSXIRoQ0CmpIq2z2obVjbW59fU0eSp8kmMV/K6fGAM7zsdV98C+dPE4WZ0KOpQsCiLMlaGUjg',
  'BQMFiHT885k6XIJsfNvIIuiCMvi0FTgbkxATkKoa2LR0qUKUJt67NqrdBEjBvbMvvGzWMQVbJf5SlyZHvkccH5XD6aWqZQUDHTFRnIddBksbZ6DVIYsg9w5Irw0MHiw7PMDeror/FPmt',
  '4NxpyMQlwyfpAqHw+B6+lSPVHvGX+8YTpkwo/Thei4nB89Fn/8VGB1tLzAf3QK+WwoqMxR43lLOqNQqiMZfxUFpn7Fjg8V1Ea0m1B+J9Drinpo6mo6/8M3dyh2LVolmcmWrlsIQZ8EnE',
  'vkuG6Pi2ai4XA3OoJwMFq78QuPWYwBKqsO4zZF1d9OPuZHRxg0ItOyB8/n/m6y+RJ2fik+D9vdbNmQlXNedYusB4nVWQv2qhVTpEF3VM6+glj8xAhmOkBHOPlclfp3Vy72/WY6rnPRas',
  'fuqrKBgAzIuC5yEQirpyi316U0Rg+rBtOvoGGWeXI8YRS2smU5MLfYJf04iLq1oMobHC+4XtB2ir0IhbHBlGmh3RcWacQFSXrR2BfpRgzs/j8aWda5zW3gKODuQOBO9oug07OXHxoYs5',
  'CYkywmfLDIcaHxGUsL11SdxDBl4/Ven8iInnUb40/Uu+fg==',
].join('');

// ------------------------------------------------------------------ a certificate made here

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** One DER element: tag, length, content. */
function der(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  const n = body.length;
  const head = n < 0x80 ? [tag, n] : n < 0x100 ? [tag, 0x81, n] : [tag, 0x82, n >> 8, n & 0xff];
  return concat(Uint8Array.from(head), body);
}

const ascii = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const two = (n: number): string => String(n).padStart(2, '0');

/** UTCTime, as certificates carry dates before 2050. */
function utcTime(msEpoch: number): Uint8Array {
  const d = new Date(msEpoch);
  return der(0x17, ascii(`${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`));
}

/** The shape of an X.509 certificate around a public key (its own signature is not what this code checks). */
function certificate(spki: Uint8Array, notBefore: number, notAfter: number, withVersion = true): Uint8Array {
  const empty = der(0x30);
  const tbs = der(0x30,
    ...(withVersion ? [der(0xa0, der(0x02, Uint8Array.of(2)))] : []),
    der(0x02, Uint8Array.of(1, 2, 3)), empty, empty, der(0x30, utcTime(notBefore), utcTime(notAfter)), empty, spki);
  return der(0x30, tbs, empty, der(0x03, Uint8Array.of(0)));
}

const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const own = (b: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
};

interface Signer {
  cert: Uint8Array;
  sign: (teamPlayerId: string, bundleId: string, timestamp: string, salt: Uint8Array) => Promise<string>;
}

async function makeSigner(notBefore = NOW - 86400_000, notAfter = NOW + 86400_000): Promise<Signer> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    cert: certificate(spki, notBefore, notAfter),
    sign: async (teamPlayerId, bundleId, timestamp, salt) =>
      b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, own(signedPayload(teamPlayerId, bundleId, timestamp, salt))))),
  };
}

let apple: Signer;
let other: Signer;
const SALT = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2);

// (Making RSA keys is quick, but not on a machine busy with other work: generous limits.)
vi.setConfig({ testTimeout: 120_000 });

beforeAll(async () => {
  apple = await makeSigner();
  other = await makeSigner();
}, 120_000);

async function identity(o: Partial<GcIdentity> = {}, signer: Signer = apple): Promise<GcIdentity> {
  const timestamp = o.timestamp ?? String(NOW - 5000);
  return {
    publicKeyUrl: KEY_URL, salt: b64(SALT), timestamp, teamPlayerId: PLAYER, bundleId: BUNDLE,
    signature: await signer.sign(o.teamPlayerId ?? PLAYER, o.bundleId ?? BUNDLE, timestamp, SALT),
    ...o,
  };
}

const options = (o: Partial<GcOptions> = {}): GcOptions => ({ bundleIds: [BUNDLE], now: NOW, fetchCert: async () => apple.cert, ...o });

// ------------------------------------------------------------------ the check

describe('verifyGameCenter', () => {
  it('accepts a player Apple signed for this app', async () => {
    expect(await verifyGameCenter(await identity(), options())).toEqual({ ok: true, teamPlayerId: PLAYER });
  });

  it('fetches the certificate from the URL it was given, once it has passed the host check', async () => {
    const asked: string[] = [];
    await verifyGameCenter(await identity(), options({ fetchCert: async (u) => {
      asked.push(u);
      return apple.cert;
    } }));
    expect(asked).toEqual([KEY_URL]);
  });

  it('refuses another app\'s bundle id, even with a valid signature for it', async () => {
    const id = await identity({ bundleId: 'com.evil.app' });
    expect(await verifyGameCenter(id, options())).toEqual({ ok: false, reason: 'bad_bundle' });
  });

  it('refuses a signature that is too old, or from the future', async () => {
    const old = await identity({ timestamp: String(NOW - GC_MAX_AGE_MS - 1000) });
    expect(await verifyGameCenter(old, options())).toEqual({ ok: false, reason: 'stale' });
    const ahead = await identity({ timestamp: String(NOW + GC_MAX_SKEW_MS + 1000) });
    expect(await verifyGameCenter(ahead, options())).toEqual({ ok: false, reason: 'stale' });
    // Just inside both edges is fine.
    expect((await verifyGameCenter(await identity({ timestamp: String(NOW - GC_MAX_AGE_MS + 1000) }), options())).ok).toBe(true);
    expect((await verifyGameCenter(await identity({ timestamp: String(NOW + GC_MAX_SKEW_MS - 1000) }), options())).ok).toBe(true);
  });

  it('never fetches a key from anywhere but Apple\'s Game Center host', async () => {
    let fetched = 0;
    const o = options({ fetchCert: async () => {
      fetched++;
      return apple.cert;
    } });
    for (const publicKeyUrl of [
      'https://evil.example/public-key/gc-prod-12.cer',
      'https://static.gc.apple.com.evil.example/public-key/gc-prod-12.cer',
      'https://evil.example/static.gc.apple.com/gc-prod-12.cer',
      'http://static.gc.apple.com/public-key/gc-prod-12.cer',
      'https://static.gc.apple.com:8443/public-key/gc-prod-12.cer',
      'https://user:pw@static.gc.apple.com/public-key/gc-prod-12.cer',
      'https://static.gc.apple.com/public-key/gc-prod-12.txt',
      'https://www.apple.com/public-key/gc-prod-12.cer',
      'https://notgc.apple.com/key.cer',
      'not a url',
    ]) {
      expect(await verifyGameCenter(await identity({ publicKeyUrl }), o), publicKeyUrl).toEqual({ ok: false, reason: 'bad_key_url' });
    }
    expect(fetched).toBe(0);
    for (const good of [KEY_URL, 'https://sandbox.gc.apple.com/public-key/gc-sb-2.cer', 'https://STATIC.GC.APPLE.COM/public-key/gc-prod-12.CER']) expect(appleKeyUrl(good), good).toBe(true);
  });

  it('refuses a forged or altered identity', async () => {
    const good = await identity();
    // Another player's id under a real signature.
    expect(await verifyGameCenter({ ...good, teamPlayerId: 'T:_someone_else' }, options())).toEqual({ ok: false, reason: 'bad_signature' });
    // A newer timestamp pasted onto an old signature (a replay made to look fresh).
    expect(await verifyGameCenter({ ...good, timestamp: String(NOW - 1000) }, options())).toEqual({ ok: false, reason: 'bad_signature' });
    // A different salt.
    expect(await verifyGameCenter({ ...good, salt: b64(Uint8Array.of(1, 1, 1, 1)) }, options())).toEqual({ ok: false, reason: 'bad_signature' });
    // Signed by a key that is not the one in Apple's certificate.
    expect(await verifyGameCenter(await identity({}, other), options())).toEqual({ ok: false, reason: 'bad_signature' });
    // Random bytes.
    expect(await verifyGameCenter({ ...good, signature: b64(crypto.getRandomValues(new Uint8Array(256))) }, options())).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an expired or not yet valid certificate', async () => {
    const expired = await makeSigner(NOW - 2 * 86400_000, NOW - 86400_000);
    expect(await verifyGameCenter(await identity({}, expired), options({ fetchCert: async () => expired.cert }))).toEqual({ ok: false, reason: 'certificate_expired' });
    const early = await makeSigner(NOW + 86400_000, NOW + 2 * 86400_000);
    expect(await verifyGameCenter(await identity({}, early), options({ fetchCert: async () => early.cert }))).toEqual({ ok: false, reason: 'certificate_expired' });
  });

  it('refuses what is not a certificate, and says when Apple could not be reached', async () => {
    const id = await identity();
    expect(await verifyGameCenter(id, options({ fetchCert: async () => Uint8Array.of(1, 2, 3, 4) }))).toEqual({ ok: false, reason: 'bad_certificate' });
    expect(await verifyGameCenter(id, options({ fetchCert: async () => new Uint8Array(0) }))).toEqual({ ok: false, reason: 'bad_certificate' });
    expect(await verifyGameCenter(id, options({ fetchCert: async () => {
      throw new Error('timeout');
    } }))).toEqual({ ok: false, reason: 'key_fetch_failed' });
  });

  it('refuses a malformed request', async () => {
    const good = await identity();
    expect(await verifyGameCenter({ ...good, timestamp: 'yesterday' }, options())).toEqual({ ok: false, reason: 'bad_request' });
    expect(await verifyGameCenter({ ...good, signature: '***' }, options())).toEqual({ ok: false, reason: 'bad_request' });
    expect(await verifyGameCenter({ ...good, teamPlayerId: '' }, options())).toEqual({ ok: false, reason: 'bad_request' });
  });

  it('takes a PEM certificate too, and one without the version field', async () => {
    const pem = ascii(`-----BEGIN CERTIFICATE-----\n${b64(apple.cert).replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`);
    expect((await verifyGameCenter(await identity(), options({ fetchCert: async () => pem }))).ok).toBe(true);
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const c = certificateKey(certificate(spki, NOW - 1000, NOW + 1000, false));
    expect([...c.spki]).toEqual([...spki]);
  });
});

describe('parseIdentity', () => {
  it('takes the app\'s payload (timestamp as a string or a number)', async () => {
    const id = await identity();
    expect(parseIdentity(id)).toEqual(id);
    expect(parseIdentity({ ...id, timestamp: NOW, deviceSecret: 'ignored' })).toEqual({ ...id, timestamp: String(NOW) });
  });

  it('refuses missing, empty, oversized or wrongly typed fields', async () => {
    const id = await identity();
    expect(parseIdentity(null)).toBeNull();
    expect(parseIdentity('x')).toBeNull();
    for (const k of Object.keys(id)) expect(parseIdentity({ ...id, [k]: undefined }), k).toBeNull();
    expect(parseIdentity({ ...id, teamPlayerId: '' })).toBeNull();
    expect(parseIdentity({ ...id, teamPlayerId: 'x'.repeat(129) })).toBeNull();
    expect(parseIdentity({ ...id, signature: 'x'.repeat(5000) })).toBeNull();
    expect(parseIdentity({ ...id, timestamp: '12ab' })).toBeNull();
    expect(parseIdentity({ ...id, timestamp: 1.5 })).toBeNull();
    expect(parseIdentity({ ...id, bundleId: 42 })).toBeNull();
  });
});

describe('Apple\'s real certificate', () => {
  it('is read correctly: the validity dates and an RSA key that imports', async () => {
    const derBytes = fromBase64(APPLE_GC_PROD_12)!;
    expect(derBytes.length).toBe(1924);
    const c = certificateKey(derBytes);
    expect(new Date(c.notBefore).toISOString()).toBe('2026-03-17T00:00:00.000Z');
    expect(new Date(c.notAfter).toISOString()).toBe('2027-05-27T23:59:59.000Z');
    const key = await crypto.subtle.importKey('spki', own(c.spki), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    expect(key.type).toBe('public');
    expect((key.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBeGreaterThanOrEqual(2048);
  });

  it('a forged signature against it is refused; outside its dates it is expired', async () => {
    const real = fromBase64(APPLE_GC_PROD_12)!;
    const id = await identity();
    expect(await verifyGameCenter(id, options({ fetchCert: async () => real }))).toEqual({ ok: false, reason: 'bad_signature' });
    const late = Date.UTC(2027, 5, 1);
    const later = await identity({ timestamp: String(late - 1000) });
    expect(await verifyGameCenter(later, options({ now: late, fetchCert: async () => real }))).toEqual({ ok: false, reason: 'certificate_expired' });
  });
});
