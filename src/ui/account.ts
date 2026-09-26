/**
 * The account / cloud-sync panel, the "which save?" choice and the cloud toast. src/platform/cloud.ts owns
 * the logic and loads this file on demand; this file owns the DOM. Panels mount into #ui on top of whatever
 * screen is open and never block play: BACK (or Escape) always closes them.
 */
import './account.css';
import { sfx } from '../audio/sfx';
import {
  PROVIDER_LABEL, cloudAvailable, cloudStatus, cloudUser, deleteCloudSave, loadFromCloud, onCloudChange, signInAsGuest, signInWith,
  signInWithEmail, signOutCloud, syncNow, upgradeGuest, upgradeGuestEmail, type CloudContext, type CloudToastKind, type SaveSummary,
} from '../platform/cloud';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T | null => root.querySelector(sel) as T | null;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

type Mode = 'main' | 'email' | 'link-email' | 'confirm-load' | 'confirm-delete' | 'confirm-signout';

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
    <button class="btn btn-white" data-a="${prefix}google" ${dis}><i class="ac-g" aria-hidden="true">G</i>GOOGLE</button>
    <button class="btn btn-ink" data-a="${prefix}github" ${dis}>GITHUB</button>
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
  return `
    <h2>PROTECT YOUR CLUB</h2>
    <p class="fine big ac-lead">Sign in to save your progress across devices.</p>
    ${working ? `<div class="ac-status busy"><i></i><span>${esc(working)}...</span></div>` : ''}
    ${providerButtons('', dis)}
    ${mode === 'email' ? emailForm('sendlink', 'SEND LINK', dis) : `<button class="btn btn-blue" data-a="email" ${dis}>EMAIL LINK</button>`}
    <button class="btn btn-yellow" data-a="guest" ${dis}>CONTINUE AS GUEST</button>
    <p class="fine ac-note">No account is needed to play: progress stays on this device either way. A guest account backs it up now; add Google, GitHub or email later.</p>
    ${backRow}`;
}

function signedInHtml(mode: Mode, working: string): string {
  const u = cloudUser();
  if (!u) return signedOutHtml('main', working);
  const st = cloudStatus();
  const dis = working ? 'disabled' : '';
  const via = u.guest ? 'Guest account' : `Signed in with ${u.provider === 'google' ? 'Google' : u.provider === 'github' ? 'GitHub' : 'email'}`;
  const who = `<div class="ac-who"><b>${esc(u.name)}</b><span>${via}${u.email && u.email !== u.name ? ` (${esc(u.email)})` : ''}</span></div>`;

  let cls = 'on';
  let text: string;
  if (working) {
    cls = 'busy';
    text = `${working}...`;
  } else if (st.busy) {
    cls = 'busy';
    text = 'Cloud sync: syncing...';
  } else if (st.offline) {
    cls = 'off';
    text = 'Cloud sync: offline, will retry';
  } else if (st.paused) {
    cls = 'off';
    text = 'Cloud sync: paused';
  } else if (st.lastError) {
    cls = 'bad';
    text = 'Cloud sync: retrying';
  } else if (st.pending) {
    cls = 'busy';
    text = 'Cloud sync: on, changes waiting';
  } else {
    text = `Cloud sync: on${st.lastSynced ? `, last synced ${timeOf(st.lastSynced)}` : ''}`;
  }
  const status = `<div class="ac-status ${cls}"><i></i><span>${esc(text)}</span></div>`;

  let body: string;
  if (mode === 'confirm-load') {
    body = confirmBox('calm', 'Replace the save on this device with your cloud copy? Anything not yet synced from here is lost.', 'load-yes', 'YES, LOAD', 'btn-blue', dis);
  } else if (mode === 'confirm-delete') {
    body = confirmBox('', 'Delete your cloud save? This device keeps its copy. Sync pauses until you press SYNC NOW.', 'delete-yes', 'YES, DELETE', 'btn-red', dis);
  } else if (mode === 'confirm-signout') {
    body = confirmBox('', 'A guest account cannot be signed into again, so its cloud copy goes out of reach. Add Google, GitHub or email first to keep it. Your progress stays on this device either way.', 'signout-yes', 'SIGN OUT ANYWAY', 'btn-red', dis);
  } else if (mode === 'link-email') {
    body = emailForm('sendlinkemail', 'ADD EMAIL', dis);
  } else {
    body = `
      ${u.guest ? `<p class="fine ac-note">Add a sign-in to open this account on other devices:</p>${providerButtons('link-', dis)}<button class="btn btn-blue" data-a="link-email" ${dis}>EMAIL LINK</button>` : ''}
      <div class="menu-col ac-actions">
        <button class="btn btn-go" data-a="sync" ${dis}>SYNC NOW</button>
        <button class="btn btn-blue" data-a="load" ${dis}>LOAD FROM CLOUD</button>
        <button class="btn btn-white" data-a="signout" ${dis}>SIGN OUT</button>
        <button class="btn btn-red" data-a="delete" ${dis}>DELETE CLOUD SAVE</button>
      </div>`;
  }
  return `<h2>YOUR ACCOUNT</h2>${who}${status}${body}${backRow}`;
}

/** The panel behind the ACCOUNT button (cloud.ts `openAccount` loads this file and calls it). */
export function openAccountPanel(ctx: CloudContext, onClose: () => void): void {
  activeAccount?.remove();
  const { root, panel } = mount('ac-account', 'narrow ac-panel');
  activeAccount = root;
  let mode: Mode = 'main';
  let working = '';
  let focusNext = false;
  let closed = false;

  const render = (): void => {
    if (closed) return;
    const keep = $<HTMLInputElement>(panel, 'input')?.value;
    panel.innerHTML = !cloudAvailable() ? unavailableHtml() : cloudUser() ? signedInHtml(mode, working) : signedOutHtml(mode, working);
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
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    if (working) return;
    working = label;
    render();
    try {
      await fn();
    } catch (err) {
      console.warn('[cloud] account action failed:', err);
    } finally {
      working = '';
      mode = 'main';
      render();
    }
  };
  const email = (): string => ($<HTMLInputElement>(panel, 'input')?.value ?? '').trim();
  const badEmail = (): boolean => {
    const input = $<HTMLInputElement>(panel, 'input');
    if (!input || EMAIL_RE.test(input.value.trim())) return false;
    input.classList.remove('bad');
    void input.offsetWidth;
    input.classList.add('bad');
    input.focus();
    return true;
  };
  const show = (m: Mode, focus = false): void => {
    mode = m;
    focusNext = focus;
    render();
  };

  panel.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    switch (el.dataset.a) {
      case 'back': close(); break;
      case 'cancel': show('main'); break;
      case 'google': void run('Opening Google', () => signInWith('google')); break;
      case 'github': void run('Opening GitHub', () => signInWith('github')); break;
      case 'email': show('email', true); break;
      case 'sendlink': if (!badEmail()) void run('Sending the link', () => signInWithEmail(email())); break;
      case 'guest': void run('Setting up a guest account', () => signInAsGuest()); break;
      case 'link-google': void run(`Opening ${PROVIDER_LABEL.google}`, () => upgradeGuest('google')); break;
      case 'link-github': void run(`Opening ${PROVIDER_LABEL.github}`, () => upgradeGuest('github')); break;
      case 'link-email': show('link-email', true); break;
      case 'sendlinkemail': if (!badEmail()) void run('Sending the link', () => upgradeGuestEmail(email())); break;
      case 'sync': void run('Syncing', () => syncNow(ctx)); break;
      case 'load': show('confirm-load'); break;
      case 'load-yes': void run('Loading', () => loadFromCloud(ctx)); break;
      case 'delete': show('confirm-delete'); break;
      case 'delete-yes': void run('Deleting', () => deleteCloudSave()); break;
      case 'signout':
        if (cloudUser()?.guest) show('confirm-signout');
        else void run('Signing out', () => signOutCloud());
        break;
      case 'signout-yes': void run('Signing out', () => signOutCloud()); break;
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && (e.target as Element).matches('input')) $<HTMLElement>(panel, '[data-a="sendlink"], [data-a="sendlinkemail"]')?.click();
  });
  render();
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
