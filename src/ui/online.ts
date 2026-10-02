import { sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import { controlsOf, type SaveData } from '../core/save';
import type { MatchResult, MatchSession, SessionOptions, StepDriver } from '../game/matchSession';
import { PRESET_CLUBS } from '../meta/data';
import { OnlineLink, type PeerInfo, type Role, type Rules } from '../net/link';
import type { Lockstep } from '../net/lockstep';
import { rtcAvailable, rtcHost, rtcJoin, type RtcHosting } from '../net/rtc';
import { applyNetControls, netConfig, NET_HALVES, netKits, netStoppages, netTeams, pickControls, type MatchSetup } from '../net/setup';
import { BroadcastTransport, broadcastAvailable, roomCode, type Transport } from '../net/transport';
import { APP_VERSION } from './brand';
import { crestSvg } from './crest';
import { shirtArt } from './menus';
import { pixelIcon } from './pixelIcons';
import { goalsOf } from '../sim/shootout';
import { escHtml, scoreHtml, sep } from './text';

/**
 * ONLINE: two players, two machines (or two tabs), one match. Home (how to connect), the code exchange (manual
 * WebRTC signalling: an offer code out, an answer code back) or a room in this browser (BroadcastChannel), the
 * lobby (both clubs and kits, the host's rules, READY), the match itself (both sides human, stepped in lockstep:
 * src/net/lockstep.ts), full time with REMATCH. Peer to peer: no game server, and no relay either, so the copy
 * says plainly that some networks won't connect.
 */

export interface OnlineHost {
  save: SaveData;
  input: Input;
  /** Close whatever menu screen is up (the main menu). */
  closeMenus(): void;
  mainMenu(): void;
  /** Put a match on screen (the menu demo goes; the frame loop runs it). The caller sets its driver. */
  play(opt: SessionOptions): MatchSession;
  /** Take the match off screen (the menu demo comes back behind our screens). */
  end(): void;
}

let screenEl: HTMLDivElement | null = null;
let overlayEl: HTMLDivElement | null = null;
/** Cleanup for whatever the current screen started (timers, a pending connection). */
let teardown: (() => void)[] = [];

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

function clearScreen(): void {
  for (const f of teardown.splice(0)) f();
  screenEl?.remove();
  screenEl = null;
}

function mount(html: string, cls = ''): HTMLDivElement {
  clearScreen();
  const d = document.createElement('div');
  d.className = `screen online ${cls}`;
  d.innerHTML = html;
  document.getElementById('ui')!.appendChild(d);
  d.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => sfx.click()));
  screenEl = d;
  return d;
}

function clearOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
}

const panel = (inner: string, cls = ''): string => `<div class="panel-wrap"><div class="panel online-panel ${cls}">${inner}</div></div>`;

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  const was = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'COPIED';
  } catch {
    // (No clipboard permission: the code is selected, ready for the keyboard shortcut.)
    btn.textContent = 'SELECT + COPY';
  }
  setTimeout(() => (btn.textContent = was), 1400);
}

async function pasteInto(ta: HTMLTextAreaElement): Promise<void> {
  try {
    ta.value = (await navigator.clipboard.readText()).trim();
  } catch {
    ta.focus();
  }
}

/** Selecting a code box selects all of it (one tap, then copy). */
function selectAllOnFocus(root: ParentNode): void {
  root.querySelectorAll<HTMLTextAreaElement>('textarea[readonly]').forEach((t) => t.addEventListener('focus', () => t.select()));
}

// ------------------------------------------------------------------ home

export function openOnline(host: OnlineHost): void {
  host.closeMenus();
  clearOverlay();
  const d = mount(panel(`
    <h2>ONLINE</h2>
    <p class="fine big">Play a friend on another machine. Your two games connect directly, peer to peer: no game server in between.</p>
    <section class="net-sec">
      <h3>OVER THE INTERNET</h3>
      <div class="btn-row">
        <button class="btn btn-go" data-a="host">HOST A MATCH</button>
        <button class="btn btn-blue" data-a="join">JOIN WITH A CODE</button>
      </div>
      <p class="fine">You swap two codes (a chat or a text message is fine). There is no relay server, so some networks can't link up: mobile data and strict office or school Wi-Fi are the usual ones. Home broadband usually works.</p>
    </section>
    <section class="net-sec">
      <h3>ON THIS COMPUTER</h3>
      <div class="btn-row">
        <button class="btn btn-white" data-a="lhost">HOST HERE</button>
        <button class="btn btn-white" data-a="ljoin">JOIN HERE</button>
      </div>
      <p class="fine">Two windows of this browser side by side, for trying it out. Only the window in front takes the keyboard.</p>
    </section>
    <div class="btn-row"><button class="btn btn-white" data-a="back">BACK</button></div>`));
  const noRtc = !rtcAvailable();
  const noBc = !broadcastAvailable();
  for (const [a, off] of [['host', noRtc], ['join', noRtc], ['lhost', noBc], ['ljoin', noBc]] as const) {
    const b = $<HTMLButtonElement>(d, `[data-a=${a}]`);
    b.disabled = off;
  }
  $(d, '[data-a=host]').addEventListener('click', () => void internetHost(host));
  $(d, '[data-a=join]').addEventListener('click', () => internetJoin(host));
  $(d, '[data-a=lhost]').addEventListener('click', () => localHost(host));
  $(d, '[data-a=ljoin]').addEventListener('click', () => localJoin(host));
  $(d, '[data-a=back]').addEventListener('click', () => {
    clearScreen();
    host.mainMenu();
  });
}

// ------------------------------------------------------------------ over the internet (WebRTC, manual codes)

async function internetHost(host: OnlineHost): Promise<void> {
  const d = mount(panel(`
    <h2>HOST A MATCH</h2>
    <p class="fine big"><b>1.</b> Send this code to your friend.</p>
    <textarea class="net-code" readonly data-f="offer" placeholder="Making your code"></textarea>
    <div class="btn-row"><button class="btn btn-white" data-a="copy" disabled>COPY CODE</button></div>
    <p class="fine big"><b>2.</b> Paste the code they send back.</p>
    <textarea class="net-code" data-f="answer" placeholder="Their code" spellcheck="false"></textarea>
    <div class="btn-row">
      <button class="btn btn-white" data-a="paste">PASTE</button>
      <button class="btn btn-go" data-a="connect" disabled>CONNECT</button>
    </div>
    <p class="net-status" aria-live="polite">Making your code (a few seconds)</p>
    <div class="btn-row"><button class="btn btn-white" data-a="cancel">CANCEL</button></div>`));
  selectAllOnFocus(d);
  const status = $(d, '.net-status');
  const offerTa = $<HTMLTextAreaElement>(d, '[data-f=offer]');
  const answerTa = $<HTMLTextAreaElement>(d, '[data-f=answer]');
  const copy = $<HTMLButtonElement>(d, '[data-a=copy]');
  const connect = $<HTMLButtonElement>(d, '[data-a=connect]');
  let hosting: RtcHosting | null = null;
  let done = false;
  teardown.push(() => {
    if (!done) hosting?.cancel();
  });
  $(d, '[data-a=cancel]').addEventListener('click', () => openOnline(host));
  $(d, '[data-a=paste]').addEventListener('click', () => void pasteInto(answerTa));
  copy.addEventListener('click', () => void copyText(offerTa.value, copy));
  try {
    hosting = await rtcHost();
  } catch (e) {
    status.textContent = `Couldn't start: ${(e as Error).message}`;
    return;
  }
  if (screenEl !== d) {
    hosting.cancel();
    return;
  }
  offerTa.value = hosting.offer;
  copy.disabled = false;
  connect.disabled = false;
  status.textContent = 'Waiting for their code.';
  connect.addEventListener('click', async () => {
    if (!hosting || !answerTa.value.trim()) return;
    connect.disabled = true;
    status.textContent = 'Connecting';
    try {
      const t = await hosting.accept(answerTa.value);
      if (screenEl !== d) return;
      done = true;
      lobby(host, t, 'host');
    } catch (e) {
      status.textContent = (e as Error).message;
      connect.disabled = false;
    }
  });
}

function internetJoin(host: OnlineHost): void {
  const d = mount(panel(`
    <h2>JOIN A MATCH</h2>
    <p class="fine big"><b>1.</b> Paste the code your friend sent.</p>
    <textarea class="net-code" data-f="offer" placeholder="Their code" spellcheck="false"></textarea>
    <div class="btn-row">
      <button class="btn btn-white" data-a="paste">PASTE</button>
      <button class="btn btn-go" data-a="next">NEXT</button>
    </div>
    <div class="net-step2" hidden>
      <p class="fine big"><b>2.</b> Send this code back to them. The lobby opens when they paste it.</p>
      <textarea class="net-code" readonly data-f="answer"></textarea>
      <div class="btn-row"><button class="btn btn-white" data-a="copy">COPY CODE</button></div>
    </div>
    <p class="net-status" aria-live="polite"></p>
    <div class="btn-row"><button class="btn btn-white" data-a="cancel">CANCEL</button></div>`));
  selectAllOnFocus(d);
  const status = $(d, '.net-status');
  const offerTa = $<HTMLTextAreaElement>(d, '[data-f=offer]');
  const answerTa = $<HTMLTextAreaElement>(d, '[data-f=answer]');
  const next = $<HTMLButtonElement>(d, '[data-a=next]');
  const copy = $<HTMLButtonElement>(d, '[data-a=copy]');
  let cancel: (() => void) | null = null;
  let done = false;
  teardown.push(() => {
    if (!done) cancel?.();
  });
  $(d, '[data-a=cancel]').addEventListener('click', () => openOnline(host));
  $(d, '[data-a=paste]').addEventListener('click', () => void pasteInto(offerTa));
  copy.addEventListener('click', () => void copyText(answerTa.value, copy));
  next.addEventListener('click', async () => {
    if (!offerTa.value.trim()) return;
    next.disabled = true;
    status.textContent = 'Making your code (a few seconds)';
    try {
      cancel?.();
      const j = await rtcJoin(offerTa.value);
      cancel = j.cancel;
      if (screenEl !== d) return j.cancel();
      answerTa.value = j.answer;
      $(d, '.net-step2').hidden = false;
      status.textContent = 'Waiting for them to paste your code.';
      const t = await j.connected;
      if (screenEl !== d) return;
      done = true;
      lobby(host, t, 'guest');
    } catch (e) {
      status.textContent = (e as Error).message;
      next.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ this browser (BroadcastChannel)

function localHost(host: OnlineHost): void {
  const room = roomCode();
  const d = mount(panel(`
    <h2>HOST HERE</h2>
    <p class="fine big">In another window of this browser, open the game, choose ONLINE, then JOIN HERE.</p>
    <div class="net-room" aria-label="Room code">${room}</div>
    <p class="net-status" aria-live="polite">Waiting for the other window</p>
    <div class="btn-row"><button class="btn btn-white" data-a="cancel">CANCEL</button></div>`, 'narrow'));
  const h = BroadcastTransport.host(room, `ROOM ${room}`);
  let done = false;
  teardown.push(() => {
    if (!done) h.cancel();
  });
  $(d, '[data-a=cancel]').addEventListener('click', () => openOnline(host));
  h.ready.then((t) => {
    done = true;
    if (screenEl === d) lobby(host, t, 'host');
    else t.close();
  }, () => {});
}

function localJoin(host: OnlineHost): void {
  const d = mount(panel(`
    <h2>JOIN HERE</h2>
    <p class="fine big">Rooms open in this browser:</p>
    <div class="net-rooms"><p class="fine">None yet. Host one in another window.</p></div>
    <div class="opt-row"><label for="net-room-in">ROOM CODE</label><input id="net-room-in" class="net-room-in" maxlength="4" autocomplete="off" spellcheck="false"></div>
    <p class="net-status" aria-live="polite"></p>
    <div class="btn-row">
      <button class="btn btn-white" data-a="cancel">CANCEL</button>
      <button class="btn btn-go" data-a="join">JOIN</button>
    </div>`, 'narrow'));
  const status = $(d, '.net-status');
  const list = $(d, '.net-rooms');
  const input = $<HTMLInputElement>(d, '.net-room-in');
  let busy = false;
  const join = async (room: string): Promise<void> => {
    if (busy || !/^[A-Z0-9]{4}$/i.test(room)) return;
    busy = true;
    status.textContent = `Joining ${room.toUpperCase()}`;
    try {
      const t = await BroadcastTransport.join(room);
      if (screenEl !== d) return t.close();
      lobby(host, t, 'guest');
    } catch (e) {
      status.textContent = (e as Error).message;
      busy = false;
    }
  };
  const stop = BroadcastTransport.watchRooms((rooms) => {
    list.innerHTML = rooms.length
      ? rooms.map((r) => `<button class="btn btn-blue" data-room="${escHtml(r.room)}">JOIN ${escHtml(r.room)}</button>`).join('')
      : '<p class="fine">None yet. Host one in another window.</p>';
    list.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((b) => b.addEventListener('click', () => void join(b.dataset.room!)));
  });
  teardown.push(stop);
  $(d, '[data-a=cancel]').addEventListener('click', () => openOnline(host));
  $(d, '[data-a=join]').addEventListener('click', () => void join(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void join(input.value.trim());
  });
}

// ------------------------------------------------------------------ the lobby

const TODS: Rules['timeOfDay'][] = ['day', 'sunset', 'night'];

function lobby(host: OnlineHost, t: Transport, role: Role): void {
  const save = host.save;
  const me: PeerInfo = {
    name: role === 'host' ? 'HOST' : 'GUEST',
    club: PRESET_CLUBS[save.clubIdx] ? save.clubIdx : 0,
    controls: pickControls(controlsOf(save.settings)),
    ready: false,
  };
  const link = new OnlineLink(t, role, me, APP_VERSION);
  const how = t.kind === 'broadcast' ? 'IN THIS BROWSER' : 'PEER TO PEER';
  const draw = (): void => drawLobby(host, link, how);
  link.onChange = () => {
    if (link.playing) return;
    if (screenEl?.classList.contains('net-lobby')) draw();
    else if (link.error && screenEl?.classList.contains('net-ft')) fullTimeGone(link);
  };
  link.onStart = (setup, lock) => play(host, link, setup, lock);
  // The lobby's keep-alive, and a timer that still runs while the tab is in the background.
  const iv = setInterval(() => {
    if (link.gone && !link.lock?.running) {
      stopTimer();
      lobbyTimers.delete(link);
      return;
    }
    link.tick();
    if (link.lock && !link.lock.running) return;
    link.lock?.update();
  }, 250);
  const stopTimer = (): void => clearInterval(iv);
  lobbyTimers.set(link, stopTimer);
  draw();
}

/** The background timer of each link (it outlives screens: stopped when the link is left). */
const lobbyTimers = new Map<OnlineLink, () => void>();

function leaveLink(link: OnlineLink): void {
  if (!link.gone) link.leave();
  lobbyTimers.get(link)?.();
  lobbyTimers.delete(link);
}

function clubCard(idx: number, label: string, mine: boolean, ready: boolean, kit = PRESET_CLUBS[idx].kit): string {
  const c = PRESET_CLUBS[idx];
  return `
    <span class="tp-label">${label}</span>
    <div class="tp-body">
      ${mine ? '<button class="arrow" data-d="-1" aria-label="Previous club">←</button>' : ''}
      <div class="tp-kit">${shirtArt(kit, 9)}</div>
      ${mine ? '<button class="arrow" data-d="1" aria-label="Next club">→</button>' : ''}
    </div>
    <b class="tp-name">${crestSvg(c.name, c.short, c.kit, 2)}${escHtml(c.name)}</b>
    <span class="net-ready ${ready ? 'on' : ''}">${ready ? 'READY' : 'NOT READY'}</span>`;
}

function drawLobby(host: OnlineHost, link: OnlineLink, how: string): void {
  const peer = link.peer;
  const r = link.rules;
  const hostSide = link.role === 'host';
  // The kits as they'll be worn: the host's club at home.
  const homeIdx = hostSide ? link.me.club : peer?.club ?? 0;
  const awayIdx = hostSide ? peer?.club ?? 0 : link.me.club;
  const teams = peer ? netTeams({ home: homeIdx, away: awayIdx } as MatchSetup) : null;
  const kits = teams ? netKits(teams[0], teams[1]) : null;
  const myKit = kits ? kits[hostSide ? 0 : 1] : undefined;
  const theirKit = kits ? kits[hostSide ? 1 : 0] : undefined;
  const same = !!peer && peer.club === link.me.club;
  let status = '';
  if (link.error) status = link.error;
  else if (!peer) status = 'Saying hello';
  else if (same) status = 'Both clubs are the same: one of you pick another.';
  else if (!link.me.ready) status = 'Pick your club, then READY.';
  else if (!peer.ready) status = 'Waiting for your opponent to be ready.';
  else status = hostSide ? 'Both ready. Kick off!' : 'Both ready. The host kicks off.';
  const d = mount(panel(`
    <h2>MATCH LOBBY</h2>
    <p class="net-line"><b>CONNECTED</b>${sep()}${how}${sep()}${hostSide ? 'YOU HOST' : 'THEY HOST'}</p>
    <div class="vs-row">
      <div class="team-pick" data-side="me">${clubCard(link.me.club, 'YOU', !link.me.ready && !link.error, link.me.ready, myKit)}</div>
      <div class="vs">VS</div>
      <div class="team-pick" data-side="them">${peer ? clubCard(peer.club, 'OPPONENT', false, peer.ready, theirKit) : '<span class="tp-label">OPPONENT</span><p class="fine">Connecting</p>'}</div>
    </div>
    <div class="opt-row"><label>MODE</label><div class="seg" data-o="mode"></div></div>
    <div class="opt-row"><label>HALF LENGTH</label><div class="seg" data-o="len"></div></div>
    <div class="opt-row"><label>KICK OFF</label><div class="seg" data-o="tod"></div></div>
    <div class="opt-row"><label>IF LEVEL</label><div class="seg" data-o="ko"></div></div>
    ${hostSide ? '' : '<p class="fine">The host sets the rules.</p>'}
    <p class="net-status" aria-live="polite">${escHtml(status)}</p>
    <div class="btn-row">
      <button class="btn btn-white" data-a="leave">LEAVE</button>
      <button class="btn ${link.me.ready ? 'btn-yellow' : 'btn-blue'}" data-a="ready">${link.me.ready ? 'NOT READY' : 'READY'}</button>
      ${hostSide ? '<button class="btn btn-go" data-a="go">KICK OFF</button>' : ''}
    </div>`, 'net-lobby-panel'), 'net-lobby');
  const seg = (key: string, labels: string[], cur: number, set: (i: number) => void): void => {
    const el = $(d, `[data-o=${key}]`);
    el.innerHTML = labels.map((l, i) => `<button class="${i === cur ? 'on' : ''}" data-i="${i}" ${hostSide && !link.error ? '' : 'disabled'}>${l}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      sfx.click();
      set(Number(b.dataset.i));
    }));
  };
  seg('mode', ['CLASSIC', `BLITZ ${pixelIcon('bolt', 'currentColor', 1.6, 'inl')}`], r.mode === 'blitz' ? 1 : 0, (i) => link.setRules({ mode: i ? 'blitz' : 'classic' }));
  seg('len', NET_HALVES.map((m) => `${m} MIN`), Math.max(0, NET_HALVES.indexOf(r.halfMinutes as (typeof NET_HALVES)[number])), (i) => link.setRules({ halfMinutes: NET_HALVES[i] }));
  seg('tod', ['DAY', 'SUNSET', 'NIGHT'], Math.max(0, TODS.indexOf(r.timeOfDay)), (i) => link.setRules({ timeOfDay: TODS[i] }));
  seg('ko', ['DRAW', 'PENALTIES'], r.knockout ? 1 : 0, (i) => link.setRules({ knockout: i === 1 }));
  d.querySelectorAll<HTMLButtonElement>('[data-side=me] .arrow').forEach((b) => b.addEventListener('click', () => {
    const n = PRESET_CLUBS.length;
    let c = (link.me.club + Number(b.dataset.d) + n) % n;
    // (Not the opponent's club: a mirror match would be two identical sides.)
    if (peer && c === peer.club) c = (c + Number(b.dataset.d) + n) % n;
    link.setMe({ club: c });
  }));
  const ready = $<HTMLButtonElement>(d, '[data-a=ready]');
  ready.disabled = !peer || !!link.error || (same && !link.me.ready);
  ready.addEventListener('click', () => link.setMe({ ready: !link.me.ready }));
  const go = d.querySelector<HTMLButtonElement>('[data-a=go]');
  if (go) {
    go.disabled = !link.canStart;
    go.addEventListener('click', () => link.start());
  }
  $(d, '[data-a=leave]').addEventListener('click', () => {
    leaveLink(link);
    openOnline(host);
  });
}

// ------------------------------------------------------------------ the match

/** WAITING shows once the sim has been held this long on the other machine's pads (short hitches pass unseen). */
const WAIT_SHOW_S = 0.6;

function play(host: OnlineHost, link: OnlineLink, setup: MatchSetup, lock: Lockstep): void {
  clearScreen();
  clearOverlay();
  const side = link.role === 'host' ? 0 : 1;
  const teams = netTeams(setup);
  const cfg = netConfig(setup, side, teams);
  const opt: SessionOptions = {
    ...cfg,
    kits: [teams[0].kit, teams[1].kit],
    attendance: 0.9,
    timeOfDay: setup.timeOfDay,
    weather: setup.weather,
    stadiumLevel: 5,
    skipIntro: true,
    tutorial: false,
    camZoom: host.save.settings.camZoom ?? 'normal',
  };
  const s = host.play(opt);
  // Both sides' controls, the same on both machines, before the first step.
  applyNetControls(s.match, setup);
  const ov = document.createElement('div');
  ov.className = 'net-overlay';
  document.getElementById('ui')!.appendChild(ov);
  overlayEl = ov;
  let shown = '';
  const show = (key: string, html: string): void => {
    if (shown === key) return;
    shown = key;
    ov.innerHTML = html;
    ov.querySelector('[data-a=menu]')?.addEventListener('click', () => {
      leaveLink(link);
      clearOverlay();
      host.end();
      host.mainMenu();
    });
  };
  const chip = (): string => {
    const rtt = lock.rtt >= 0 ? `${Math.round(lock.rtt)} MS` : '';
    return `<span class="net-chip">${rtt ? `PING ${rtt}${sep()}` : ''}DELAY ${lock.delay}</span>`;
  };
  const driver: StepDriver = {
    get paused() { return lock.paused || !lock.running; },
    next: (sample) => lock.next(sample),
    after: (m) => {
      lock.stepped(m);
      netStoppages(m);
    },
    frame: () => {
      lock.update();
      link.tick();
      // (At full time the full-time screen says it if the other player goes.)
      if (lock.status !== 'play' && s.match.phase !== 'fulltime') {
        const title = lock.status === 'desync' ? 'CONNECTION LOST SYNC' : 'CONNECTION LOST';
        const why = lock.status === 'desync'
          ? 'The two games stopped matching, so the match has been stopped. (This can happen between different browsers.)'
          : lock.reason;
        show(`stop:${lock.status}`, panel(`<h2>${title}</h2><p class="fine big">${escHtml(why)}</p><div class="btn-row"><button class="btn btn-go" data-a="menu">MENU</button></div>`, 'narrow'));
        return;
      }
      if (s.paused) return show('', '');
      if (lock.pausedByPeer) return show('peer', `<div class="net-banner">PAUSED BY YOUR OPPONENT</div>`);
      if (s.netWaitS > WAIT_SHOW_S && s.match.phase !== 'fulltime') return show('wait', `<div class="net-banner">WAITING FOR YOUR OPPONENT</div>`);
      // The ping chip (redrawn only when what it says changes).
      show(`chip${Math.round(lock.rtt / 5)}:${lock.delay}`, chip());
    },
    pace: () => lock.pace(),
  };
  s.driver = driver;
  s.onPause = () => {
    lock.setPaused(true);
    pauseMenu(host, link, s, lock);
  };
  s.onFinish = (r) => fullTime(host, link, r);
}

function pauseMenu(host: OnlineHost, link: OnlineLink, s: MatchSession, lock: Lockstep): void {
  const d = mount(panel(`
    <h2>PAUSED</h2>
    <p class="fine big">Your opponent's game is paused too.</p>
    <div class="menu-col">
      <button class="btn btn-go btn-lg" data-a="resume">RESUME</button>
      <button class="btn btn-white" data-a="leave">LEAVE MATCH</button>
    </div>`, 'narrow'), 'dim');
  const resume = (): void => {
    window.removeEventListener('keydown', key);
    clearScreen();
    lock.setPaused(false);
    s.resume();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') resume();
  };
  // (Not the key that opened it.)
  setTimeout(() => window.addEventListener('keydown', key), 0);
  teardown.push(() => window.removeEventListener('keydown', key));
  $(d, '[data-a=resume]').addEventListener('click', resume);
  $(d, '[data-a=leave]').addEventListener('click', () => {
    leaveLink(link);
    clearScreen();
    clearOverlay();
    host.end();
    host.mainMenu();
  });
}

function fullTime(host: OnlineHost, link: OnlineLink, r: MatchResult): void {
  clearOverlay();
  const m = r.match;
  const [h, a] = m.teams;
  const mine = link.role === 'host' ? 0 : 1;
  // (Level after a shootout: its winner, r.winner.)
  const verdict = r.winner === undefined ? 'DRAW' : r.winner === mine ? 'YOU WIN' : 'YOU LOSE';
  const so = m.shootout;
  const pens = so ? `<p class="net-line">ON PENALTIES ${scoreHtml(goalsOf(so.kicks[0]), goalsOf(so.kicks[1]))}</p>` : '';
  const d = mount(panel(`
    <h2>FULL TIME</h2>
    <p class="net-verdict">${verdict}</p>
    <div class="net-final">
      <b>${crestSvg(h.name, h.short, r.match.teams[0].kit, 2)}${escHtml(h.short)}</b>
      <span class="net-score">${scoreHtml(r.score[0], r.score[1])}</span>
      <b>${escHtml(a.short)}${crestSvg(a.name, a.short, r.match.teams[1].kit, 2)}</b>
    </div>
    ${pens}
    <p class="net-status" aria-live="polite"></p>
    <div class="btn-row">
      <button class="btn btn-white" data-a="menu">MENU</button>
      <button class="btn btn-go" data-a="rematch">REMATCH</button>
    </div>`, 'narrow'), 'net-ft');
  const status = $(d, '.net-status');
  const rematch = $<HTMLButtonElement>(d, '[data-a=rematch]');
  const refresh = (): void => {
    if (link.error) return fullTimeGone(link);
    status.textContent = link.rematch.me
      ? link.rematch.peer ? 'Starting' : 'Waiting for your opponent to say yes.'
      : link.rematch.peer ? 'Your opponent wants a rematch.' : '';
    rematch.textContent = link.rematch.me ? 'CANCEL REMATCH' : 'REMATCH';
  };
  // (The finished match's engine is still up, pinging, so this isn't gated on link.playing like the lobby's.)
  link.onChange = () => {
    if (screenEl === d) refresh();
  };
  refresh();
  rematch.addEventListener('click', () => {
    link.askRematch(!link.rematch.me);
  });
  // A rematch that starts ends this match on screen first.
  link.onStart = (setup, lock) => {
    host.end();
    play(host, link, setup, lock);
  };
  $(d, '[data-a=menu]').addEventListener('click', () => {
    leaveLink(link);
    clearScreen();
    host.end();
    host.mainMenu();
  });
}

function fullTimeGone(link: OnlineLink): void {
  const d = screenEl;
  if (!d) return;
  const status = d.querySelector('.net-status');
  if (status) status.textContent = link.error ?? 'The other player left.';
  const b = d.querySelector<HTMLButtonElement>('[data-a=rematch]');
  if (b) b.disabled = true;
}
