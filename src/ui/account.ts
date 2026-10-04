/**
 * The account / cloud-sync panel, the "which save?" choice and the cloud toast. src/platform/cloud.ts owns
 * the logic and loads this file on demand; this file owns the DOM. Panels mount into #ui on top of whatever
 * screen is open and never block play: BACK (or Escape) always closes them.
 *
 * The iPhone / iPad app signs in by itself (Game Center, else this device: src/platform/signin.ts), so there the
 * panel has no sign-in buttons: it shows the account, SYNC NOW, the FRIEND CODE and DELETE ACCOUNT. The web game
 * also offers Google / GitHub / email.
 */
import './account.css';
import { sfx } from '../audio/sfx';
import {
  PROVIDER_LABEL, cloudAvailable, cloudProfile, cloudStatus, cloudUser, deleteCloudSave, loadFromCloud, onCloudChange, signInAsGuest,
  signInWith, signInWithEmail, signOutCloud, syncNow, upgradeGuest, upgradeGuestEmail, type CloudContext, type CloudToastKind, type SaveSummary,
} from '../platform/cloud';
import { inNativeApp } from '../platform/native';
import { PLAY_URL, shareInvite } from '../platform/invite';
import { claimFriendCode, connect, deleteAccount, friendCodeSeen, type ClaimResult } from '../platform/signin';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T | null => root.querySelector(sel) as T | null;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A friend code as the server makes it: 7 characters, no look-alikes (0 O 1 I). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{7}$/;

function uiRoot(): HTMLElement {
  return document.getElementById('ui') ?? document.body;
}

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateOf(t: number | null): string {
  if (!t) return 'an unknown date';
  return `${new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${timeOf(t)}`;
}

function mount(cls: string, panelCls: string): { root: HTMLDivElement; panel: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = `screen ac-screen ${cls}`;
  root.innerHTML = `<div class="panel-wrap dim"><div class="panel ${panelCls}" role="dialog" aria-modal="true"></div></div>`;
  uiRoot().appendChild(root);
  const panel = root.querySelector('.panel') as HTMLDivElement;
  panel.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button:not(:disabled)')) sfx.click();
  });
  // The match Input listens on window and preventDefaults WASD / Space: keep typing inside our field.
  panel.addEventListener('keydown', (e) => {
    if ((e.target as Element).matches('input')) e.stopPropagation();
  });
  return { root, panel };
}

// ------------------------------------------------------------------ account panel

type Mode = 'main' | 'email' | 'link-email' | 'confirm-load' | 'confirm-delete' | 'confirm-signout' | 'confirm-account' | 'friend';

let activeAccount: HTMLDivElement | null = null;

const emailForm = (action: string, label: string, dis: string): string => `
  <div class="ac-field">
    <label for="ac-email">YOUR EMAIL</label>
    <input id="ac-email" class="ac-input" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@example.com" ${dis}>
    <div class="ac-field-row">
      <button class="btn btn-go" data-a="${action}" ${dis}>${label}</button>
      <button class="btn btn-ghost" data-a="cancel" ${dis}>CANCEL</button>
    </div>
  </div>`;

const providerButtons = (prefix: string, dis: string): string => `
  <div class="ac-providers">
    <button class="btn btn-white" data-a="${prefix}google" ${dis}>SIGN IN WITH GOOGLE</button>
    <button class="btn btn-ink" data-a="${prefix}apple" ${dis}><span aria-hidden="true"></span> SIGN IN WITH APPLE</button>
  </div>`;

const confirmBox = (cls: string, text: string, action: string, label: string, btn: string, dis: string): string => `
  <div class="ac-confirm ${cls}">
    <p class="fine big">${text}</p>
    <div class="ac-field-row">
      <button class="btn ${btn}" data-a="${action}" ${dis}>${label}</button>
      <button class="btn btn-ghost" data-a="cancel" ${dis}>CANCEL</button>
    </div>
  </div>`;

const backRow = '<div class="btn-row"><button class="btn btn-white" data-a="back">BACK</button></div>';

function unavailableHtml(): string {
  return `
    <h2>ACCOUNT</h2>
    <p class="fine big ac-lead">Cloud saves are not set up in this build. Your progress is saved on this device.</p>
    ${backRow}`;
}

function signedOutHtml(mode: Mode, working: string): string {
  const dis = working ? 'disabled' : '';
  const busy = working ? `<div class="ac-status busy"><i></i><span>${esc(working)}...</span></div>` : '';
  // The app signs in by itself (Game Center, else this device): one button to try again, nothing to type.
  if (inNativeApp()) {
    return `
      <h2>PROTECT YOUR CLUB</h2>
      <p class="fine big ac-lead">Sign in to back up your club and open it on another device.</p>
      ${busy}
      ${providerButtons('', dis)}
      <button class="btn btn-blue" data-a="connect" ${dis}>USE GAME CENTER / THIS DEVICE</button>
      <p class="fine ac-note">Your progress stays on this device while you choose. You can keep playing without signing in.</p>
      ${backRow}`;
  }
  return `
    <h2>PROTECT YOUR CLUB</h2>
    <p class="fine big ac-lead">Sign in to save your progress across devices.</p>
    ${busy}
    ${providerButtons('', dis)}
    ${mode === 'email' ? emailForm('sendlink', 'SEND LINK', dis) : `<button class="btn btn-blue" data-a="email" ${dis}>EMAIL LINK</button>`}
    <button class="btn btn-yellow" data-a="guest" ${dis}>CONTINUE AS GUEST</button>
    <p class="fine ac-note">A guest account backs your progress up now. Add Google, Apple or email later to open it on other devices. You can keep playing without signing in.</p>
    ${backRow}`;
}

/** What the friend-code view knows (loaded when it opens). */
interface FriendView {
  code: string | null;
  loading: boolean;
  note: string;
  noteKind: 'good' | 'bad' | '';
}

const CLAIM_SAYS: Record<ClaimResult, string> = {
  ok: '',
  unknown_code: 'No club has that code. Check it and try again.',
  own_code: 'That is your own code. Send it to a friend.',
  already_used: 'You have already used a friend code.',
  win_first: 'Win a match first, then enter the code.',
  too_late: 'Friend codes are for new players only.',
  friend_full: 'That friend has already invited the most players allowed.',
  rate_limited: 'Too many tries. Try again tomorrow.',
  offline: 'You are offline. Connect and try again.',
  failed: 'That did not work. Try again in a moment.',
};

function friendHtml(f: FriendView, working: string): string {
  const signedIn = !!cloudUser();
  const dis = working ? 'disabled' : '';
  const code = f.code
    ? `<div class="ac-code" aria-label="Your friend code">${esc(f.code)}</div>`
    : `<div class="ac-status ${f.loading ? 'busy' : 'off'}"><i></i><span>${f.loading ? 'Getting your code...' : 'Your code is not ready. Connect and open this again.'}</span></div>`;
  const note = working
    ? `<div class="ac-status busy"><i></i><span>${esc(working)}...</span></div>`
    : f.note ? `<div class="ac-status ${f.noteKind === 'bad' ? 'bad' : 'on'}"><i></i><span>${esc(f.note)}</span></div>` : '';
  return `
    <h2>INVITE FRIENDS</h2>
    <p class="fine big ac-lead">${signedIn ? 'A friend enters your code after their first win. You both get 100 coins.' : 'Send your friends the game and build your clubs together.'}</p>
    ${signedIn ? code : `<p class="fine ac-note ac-play-link">${esc(PLAY_URL)}</p>`}
    <button class="btn btn-go" data-a="share" ${dis}>${f.code ? 'SHARE GAME + MY CODE' : 'SHARE THE GAME'}</button>
    ${signedIn ? `<div class="ac-field">
      <label for="ac-code">GOT A FRIEND'S CODE?</label>
      <input id="ac-code" class="ac-input ac-code-in" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="ABC2345" ${dis}>
      <div class="ac-field-row">
        <button class="btn btn-blue" data-a="claim" ${dis}>USE CODE</button>
        <button class="btn btn-ghost" data-a="cancel" ${dis}>DONE</button>
      </div>
    </div>` : cloudAvailable() ? `<button class="btn btn-blue" data-a="cancel" ${dis}>SIGN IN FOR A FRIEND CODE</button>` : ''}
    ${note}${backRow}`;
}

function signedInHtml(mode: Mode, working: string, friend: FriendView): string {
  const u = cloudUser();
  if (!u) return signedOutHtml('main', working);
  if (mode === 'friend') return friendHtml(friend, working);
  const st = cloudStatus();
  const dis = working ? 'disabled' : '';
  const native = inNativeApp();
  const via = u.provider === 'gamecenter' ? 'Signed in with Game Center'
    : u.provider === 'device' ? 'An account for this device'
      : u.guest ? 'Guest account' : `Signed in with ${u.provider === 'google' ? 'Google' : u.provider === 'apple' ? 'Apple' : u.provider === 'github' ? 'GitHub' : 'email'}`;
  const who = u.auto
    ? `<div class="ac-who"><b>${u.provider === 'gamecenter' ? 'GAME CENTER' : 'THIS DEVICE'}</b><span>${via}</span></div>`
    : `<div class="ac-who"><b>${esc(u.name)}</b><span>${via}${u.email && u.email !== u.name ? ` (${esc(u.email)})` : ''}</span></div>`;

  let cls = 'on';
  let text: string;
  if (working) {
    cls = 'busy';
    text = `${working}...`;
  } else if (st.busy) {
    cls = 'busy';
    text = 'Cloud save: syncing...';
  } else if (st.offline) {
    cls = 'off';
    text = 'Cloud save: offline, will retry';
  } else if (st.paused) {
    cls = 'off';
    text = 'Cloud save: paused';
  } else if (st.lastError) {
    cls = 'bad';
    text = 'Cloud save: retrying';
  } else if (st.pending) {
    cls = 'busy';
    text = 'Cloud save: on, changes waiting';
  } else {
    text = `Cloud save: on${st.lastSynced ? `, last synced ${timeOf(st.lastSynced)}` : ''}`;
  }
  const status = `<div class="ac-status ${cls}"><i></i><span>${esc(text)}</span></div>`;

  // A guest or a device account on the web can add a sign-in, to open the account on other devices.
  const canLink = u.guest || !!u.auto;
  let body: string;
  if (mode === 'confirm-load') {
    body = confirmBox('calm', 'Replace the save on this device with your cloud copy? Anything not yet synced from here is lost.', 'load-yes', 'YES, LOAD', 'btn-blue', dis);
  } else if (mode === 'confirm-delete') {
    body = confirmBox('', 'Delete your cloud save? This device keeps its copy. Sync pauses until you press SYNC NOW.', 'delete-yes', 'YES, DELETE', 'btn-red', dis);
  } else if (mode === 'confirm-account') {
    body = confirmBox('', 'Delete your account for good? Your cloud save and your progress on this device are erased. This cannot be undone.', 'account-yes', 'YES, DELETE', 'btn-red', dis);
  } else if (mode === 'confirm-signout') {
    body = confirmBox('', 'A guest account cannot be signed into again, so its cloud copy goes out of reach. Add Google, Apple or email first to keep it. Your progress stays on this device either way.', 'signout-yes', 'SIGN OUT ANYWAY', 'btn-red', dis);
  } else if (mode === 'link-email') {
    body = emailForm('sendlinkemail', 'ADD EMAIL', dis);
  } else {
    // An account the game made itself has nothing to sign out of or to load by hand: three actions.
    // (FRIEND CODE and DELETE ACCOUNT come with required accounts; switched off, the panel is the one it always was.)
    const actions = u.auto
      ? `<button class="btn btn-go" data-a="sync" ${dis}>SYNC NOW</button>
        <button class="btn btn-yellow" data-a="friend" ${dis}>INVITE FRIENDS</button>
        <button class="btn btn-white" data-a="signout" ${dis}>SIGN OUT</button>
        <button class="btn btn-red" data-a="account" ${dis}>DELETE ACCOUNT</button>`
      : `<button class="btn btn-go" data-a="sync" ${dis}>SYNC NOW</button>
        <button class="btn btn-blue" data-a="load" ${dis}>LOAD FROM CLOUD</button>
        <button class="btn btn-yellow" data-a="friend" ${dis}>INVITE FRIENDS</button>
        <button class="btn btn-white" data-a="signout" ${dis}>SIGN OUT</button>
        <button class="btn btn-red" data-a="delete" ${dis}>DELETE CLOUD SAVE</button>
        <button class="btn btn-red" data-a="account" ${dis}>DELETE ACCOUNT</button>`;
    body = `
      ${canLink ? `<p class="fine ac-note">Sign in to keep your club across devices. If that account already has a club, you choose which save to keep.</p>${providerButtons('link-', dis)}${native ? '' : `<button class="btn btn-blue" data-a="link-email" ${dis}>EMAIL LINK</button>`}` : ''}
      <div class="menu-col ac-actions">${actions}</div>`;
  }
  return `<h2>YOUR ACCOUNT</h2>${who}${status}${body}${backRow}`;
}

/** The panel behind the ACCOUNT button (cloud.ts `openAccount` loads this file and calls it). */
export function openAccountPanel(ctx: CloudContext, onClose: () => void, initial: 'main' | 'friend' = 'main'): void {
  activeAccount?.remove();
  const { root, panel } = mount('ac-account', 'narrow ac-panel');
  activeAccount = root;
  let mode: Mode = initial;
  let working = '';
  let focusNext = false;
  let closed = false;
  const friend: FriendView = { code: null, loading: false, note: '', noteKind: '' };

  const render = (): void => {
    if (closed) return;
    const keep = $<HTMLInputElement>(panel, 'input')?.value;
    panel.innerHTML = mode === 'friend' ? friendHtml(friend, working) : !cloudAvailable() ? unavailableHtml() : cloudUser() ? signedInHtml(mode, working, friend) : signedOutHtml(mode, working);
    const input = $<HTMLInputElement>(panel, 'input');
    if (input && keep !== undefined) input.value = keep;
    if (input && focusNext) {
      focusNext = false;
      input.focus();
    }
  };
  const unsub = onCloudChange(render);
  const close = (): void => {
    if (closed) return;
    closed = true;
    unsub();
    root.remove();
    if (activeAccount === root) activeAccount = null;
    onClose();
  };
  /** Run an action with the buttons off; `stay` keeps the current view afterwards (else back to the main one). */
  const run = async (label: string, fn: () => Promise<unknown>, stay = false): Promise<void> => {
    if (working) return;
    working = label;
    render();
    try {
      await fn();
    } catch (err) {
      console.warn('[cloud] account action failed:', err);
    } finally {
      working = '';
      if (!stay) mode = 'main';
      render();
    }
  };
  const email = (): string => ($<HTMLInputElement>(panel, 'input')?.value ?? '').trim();
  const shake = (input: HTMLInputElement): void => {
    input.classList.remove('bad');
    void input.offsetWidth;
    input.classList.add('bad');
    input.focus();
  };
  const badEmail = (): boolean => {
    const input = $<HTMLInputElement>(panel, 'input');
    if (!input || EMAIL_RE.test(input.value.trim())) return false;
    shake(input);
    return true;
  };
  const show = (m: Mode, focus = false): void => {
    mode = m;
    focusNext = focus;
    render();
  };
  const openFriend = (): void => {
    friend.note = '';
    friend.loading = !friend.code;
    show('friend');
    friendCodeSeen();
    if (friend.code || !cloudUser()) { friend.loading = false; render(); return; }
    void cloudProfile().then((p) => {
      friend.code = p?.code ?? null;
      friend.loading = false;
      render();
    });
  };
  const shareCode = async (): Promise<void> => {
    const result = await shareInvite(friend.code);
    if (result === 'copied') cloudToast('Copied the game link. Paste it to a friend', 'good');
    if (result === 'unavailable') cloudToast('Share is unavailable here. The game link is shown above', 'info');
  };
  const claim = (): void => {
    const input = $<HTMLInputElement>(panel, '#ac-code');
    const code = (input?.value ?? '').trim().toUpperCase();
    if (!input || !CODE_RE.test(code)) {
      if (input) shake(input);
      return;
    }
    void run('Checking the code', async () => {
      const r = await claimFriendCode(ctx, code);
      if (r.result === 'ok') {
        friend.note = `Done! +${r.coins || 100} coins for you, and 100 for your friend.`;
        friend.noteKind = 'good';
        input.value = '';
      } else {
        friend.note = CLAIM_SAYS[r.result];
        friend.noteKind = 'bad';
      }
    }, true);
  };
  const removeAccount = (): void => {
    void run('Deleting your account', async () => {
      const r = await deleteAccount(ctx);
      if (r === 'ok') {
        cloudToast('Your account and its data are deleted', 'good');
        close();
      } else {
        cloudToast(r === 'offline' ? 'You are offline. Connect to delete your account' : 'Could not delete the account. Try again in a moment', 'bad');
      }
    });
  };

  panel.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    switch (el.dataset.a) {
      case 'back': close(); break;
      case 'cancel': show('main'); break;
      case 'connect': void run('Connecting', () => connect(true)); break;
      case 'google': void run('Opening Google', () => signInWith('google')); break;
      case 'apple': void run('Opening Apple', () => signInWith('apple')); break;
      case 'github': void run('Opening GitHub', () => signInWith('github')); break;
      case 'email': show('email', true); break;
      case 'sendlink': if (!badEmail()) void run('Sending the link', () => signInWithEmail(email())); break;
      // A guest: this device's own account (nothing to type); the anonymous sign-in is the fallback.
      case 'guest': void run('Setting up a guest account', async () => (await connect(true)) || signInAsGuest()); break;
      case 'link-google': void run(`Opening ${PROVIDER_LABEL.google}`, () => upgradeGuest('google')); break;
      case 'link-apple': void run(`Opening ${PROVIDER_LABEL.apple}`, () => upgradeGuest('apple')); break;
      case 'link-github': void run(`Opening ${PROVIDER_LABEL.github}`, () => upgradeGuest('github')); break;
      case 'link-email': show('link-email', true); break;
      case 'sendlinkemail': if (!badEmail()) void run('Sending the link', () => upgradeGuestEmail(email())); break;
      case 'sync': void run('Syncing', () => syncNow(ctx)); break;
      case 'load': show('confirm-load'); break;
      case 'load-yes': void run('Loading', () => loadFromCloud(ctx)); break;
      case 'delete': show('confirm-delete'); break;
      case 'delete-yes': void run('Deleting', () => deleteCloudSave()); break;
      case 'account': show('confirm-account'); break;
      case 'account-yes': removeAccount(); break;
      case 'friend': openFriend(); break;
      case 'share': void shareCode(); break;
      case 'claim': claim(); break;
      case 'signout':
        if (cloudUser()?.guest) show('confirm-signout');
        else void run('Signing out', () => signOutCloud());
        break;
      case 'signout-yes': void run('Signing out', () => signOutCloud()); break;
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && (e.target as Element).matches('input')) $<HTMLElement>(panel, '[data-a="sendlink"], [data-a="sendlinkemail"], [data-a="claim"]')?.click();
  });
  if (initial === 'friend') openFriend();
  else render();
}

// ------------------------------------------------------------------ "which save?" (boot conflict)

/** Both sides have progress: the player keeps one. Resolves exactly once. */
export function openSyncChoice(cloud: SaveSummary, device: SaveSummary, pick: (choice: 'cloud' | 'device') => void): void {
  const { root, panel } = mount('ac-choice-screen', 'ac-choice-panel');
  const card = (title: string, s: SaveSummary, action: string, label: string, btn: string): string => `
    <div class="ac-card">
      <h3>${title}</h3>
      <ul>
        <li><b>Level ${s.level}</b></li>
        <li>${s.coins.toLocaleString()} coins</li>
        <li>${s.played} match${s.played === 1 ? '' : 'es'} played</li>
        <li>${esc(s.career)}</li>
      </ul>
      <small>Saved ${esc(dateOf(s.when))}</small>
      <button class="btn ${btn}" data-a="${action}">${label}</button>
    </div>`;
  panel.innerHTML = `
    <h2>WHICH SAVE?</h2>
    <p class="fine big ac-lead">This device and your cloud both have progress. Keep one; the other is replaced.</p>
    <div class="ac-choice">
      ${card('CLOUD', cloud, 'cloud', 'LOAD CLOUD', 'btn-blue')}
      ${card('THIS DEVICE', device, 'device', 'KEEP THIS DEVICE', 'btn-go')}
    </div>`;
  let done = false;
  panel.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!el || done) return;
    done = true;
    root.remove();
    pick(el.dataset.a === 'cloud' ? 'cloud' : 'device');
  });
}

// ------------------------------------------------------------------ toast

let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** A small line at the top of the screen, 3.4 s; the only way cloud errors show. */
export function cloudToast(msg: string, kind: CloudToastKind = 'info'): void {
  if (!toastEl || !toastEl.isConnected) {
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    uiRoot().appendChild(toastEl);
  }
  toastEl.className = `cloud-toast ${kind}`;
  toastEl.textContent = msg;
  void toastEl.offsetWidth;
  toastEl.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('on'), 3400);
}
