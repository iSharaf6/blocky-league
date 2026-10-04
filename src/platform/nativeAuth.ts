/** Native sign-in transport. Supabase owns PKCE validation and the account; this file only returns to the app. */
import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

export const NATIVE_AUTH_REDIRECT = 'com.calynx.blockyleague://auth/callback';

/** Ignore unrelated links and token fragments: a native OAuth return must exchange its PKCE code. */
export function authCallback(url: string): { code: string | null; error: string | null } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'com.calynx.blockyleague:' || u.hostname !== 'auth' || u.pathname !== '/callback' || u.username || u.password || u.port || u.hash) return null;
    if (u.searchParams.getAll('code').length > 1) return null;
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    return code || error ? { code, error } : null;
  } catch {
    return null;
  }
}

let listener: { remove(): Promise<void> } | null = null;
let booting: Promise<void> | null = null;

/** Listen before opening sign-in, and also consume a callback that cold-launched the app. */
export async function bootNativeAuth(receive: (url: string) => Promise<unknown>): Promise<void> {
  if (listener) return;
  if (!booting) booting = (async () => {
    listener = await App.addListener('appUrlOpen', ({ url }) => { void receive(url); });
    const launch = await App.getLaunchUrl();
    if (launch?.url) await receive(launch.url);
  })().catch((err) => {
    booting = null;
    throw err;
  });
  await booting;
}

export async function openNativeOAuth(url: string, receive: (url: string) => Promise<unknown>): Promise<void> {
  await bootNativeAuth(receive);
  await Browser.open({ url, presentationStyle: 'popover' });
}

export async function closeNativeOAuth(): Promise<void> {
  await Browser.close().catch(() => {});
}

interface AppleBridge {
  signInWithApple(options: { nonce: string }): Promise<{ idToken: string; fullName?: string }>;
}
const NativeAuth = registerPlugin<AppleBridge>('NativeAuth');

/** Apple receives the hash; Supabase receives the original nonce, binding both halves of this sign-in. */
export async function nativeAppleCredential(): Promise<{ token: string; nonce: string; fullName?: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
  const hashed = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  const credential = await NativeAuth.signInWithApple({ nonce: hashed });
  if (!credential.idToken) throw new Error('Apple did not return an identity token');
  return { token: credential.idToken, nonce, fullName: credential.fullName };
}

export async function _resetNativeAuthForTests(): Promise<void> {
  await listener?.remove();
  listener = null;
  booting = null;
}
