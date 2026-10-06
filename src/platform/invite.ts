/** Public playtest link: never share the native WebView's capacitor://localhost address. */
import { inNativeApp } from './native';
import { FRIEND_REWARD_LABEL } from '../meta/referrals';

export const PLAY_URL = 'https://isharaf6.github.io/blocky-league/';

export function inviteMessage(code?: string | null): { title: string; text: string; url: string } {
  const valid = typeof code === 'string' && /^[A-HJ-NP-Z2-9]{7}$/.test(code);
  return {
    title: 'Blocky League',
    text: `Build your club and play Blocky League with me!${valid ? ` Enter my friend code ${code} after your first win and we both get ${FRIEND_REWARD_LABEL}. Sign in and use it within your first 30 days.` : ''}`,
    url: PLAY_URL,
  };
}

export type ShareResult = 'shared' | 'copied' | 'canceled' | 'unavailable';

/** Opening the share sheet is a player's action. Its recipients and send action stay under their control. */
export async function shareInvite(code?: string | null): Promise<ShareResult> {
  const message = inviteMessage(code);
  try {
    if (inNativeApp()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ ...message, dialogTitle: 'Invite friends' });
      return 'shared';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share(message);
      return 'shared';
    }
    await navigator.clipboard.writeText(`${message.text}\n${message.url}`);
    return 'copied';
  } catch (err) {
    // Capacitor iOS reports dismissal as "Share canceled"; web sharing uses AbortError.
    const canceled = err instanceof DOMException && err.name === 'AbortError'
      || err instanceof Error && /^Share cancel(?:ed|led)$/i.test(err.message);
    return canceled ? 'canceled' : 'unavailable';
  }
}
