import { bindings, keyLabel, padLabel, type Input } from '../core/input';
import { QS_SHOW_S, type QuickSubs } from '../game/quickSub';
import { overall, type PlayerDef } from '../sim/types';
import { surname } from './commentary';

/**
 * The quick-sub card (top right, under the pause button) and the substitution board it turns into once the
 * change is made. The rules live in game/quickSub.ts; this only draws them and takes the press: a tap or click on
 * the big button, the B key (B for bench) or the pad's VIEW button (each only while no action is bound to it). Taps
 * stop here: the card never reaches the pitch, the touch buttons or the replay skip, and its buttons never take
 * focus (SPACE is PASS: a focused button would be "clicked" by it).
 */

/** The card's keyboard key and pad button (VIEW / SELECT), unless Settings > KEYS has given them to an action. */
const QS_KEY = 'KeyB';
const QS_PAD = 8;
/** A second tap this soon after the card changed state is the same tap twice: it never undoes the change. */
const TAP_GUARD_MS = 400;

/** Pads, where the browser lets us read them (some embedded frames refuse). */
function pads(): readonly (Gamepad | null)[] {
  try {
    return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

const shortName = (d: PlayerDef): string => surname(d.name).toUpperCase();

export class QuickSubCard {
  readonly root: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly offRow: HTMLElement;
  private readonly onRow: HTMLElement;
  private readonly stam: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly goText: HTMLElement;
  private readonly key: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly board: HTMLElement;
  private drawn = -1;
  private cardOn = false;
  private boardOn = false;
  private stamPct = -1;
  private timerPct = -1;
  private keyText = '';
  /** B and VIEW are the card's while no action is bound to them (checked as the card comes up). */
  private keyFree = true;
  private padFree = true;
  /** A pad button still down from before the card came up never counts as a press. */
  private padHeld = true;
  private changedAt = 0;
  /** Seconds to the next re-measure of where the card sits (see place). */
  private placeT = 0;
  private readonly offKey: () => void;

  constructor(readonly qs: QuickSubs, private readonly input: Input) {
    const root = (this.root = document.createElement('div'));
    root.className = 'hud-qsub';
    root.innerHTML = `
      <div class="qs-card" role="group" aria-label="Quick sub">
        <div class="qs-head"><b class="qs-title">QUICK SUB</b><button class="qs-x" type="button" tabindex="-1" aria-label="Not now"><i></i></button></div>
        <div class="qs-row qs-off"><i class="qs-arrow"></i><b class="qs-num"></b><span class="qs-name"></span><span class="qs-meta"><i class="qs-yc"></i><span class="qs-stam"><i></i></span></span></div>
        <div class="qs-row qs-on"><i class="qs-arrow"></i><b class="qs-num"></b><span class="qs-name"></span><span class="qs-meta"><em class="qs-role"></em></span></div>
        <button class="qs-go" type="button" tabindex="-1"><span class="qs-go-t">MAKE SUB</span><kbd class="qs-key"></kbd></button>
        <i class="qs-timer"></i>
      </div>
      <div class="qs-board" role="status" aria-live="polite">
        <b class="qs-b-head">SUBSTITUTION</b>
        <div class="qs-b-row qs-off"><b class="qs-b-num"></b><span class="qs-b-name"></span></div>
        <div class="qs-b-row qs-on"><b class="qs-b-num"></b><span class="qs-b-name"></span></div>
      </div>`;
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.title = $('.qs-title');
    this.offRow = $('.qs-card .qs-off');
    this.onRow = $('.qs-card .qs-on');
    this.stam = $('.qs-stam i');
    this.go = $('.qs-go');
    this.goText = $('.qs-go-t');
    this.key = $('.qs-key');
    this.timer = $('.qs-timer');
    this.board = $('.qs-board');
    // Every pointer on the card stops here (nothing under it hears about it).
    const card = $('.qs-card');
    for (const t of ['pointerdown', 'pointerup', 'click', 'touchstart'] as const) {
      card.addEventListener(t, (e) => e.stopPropagation());
    }
    this.tap(this.go, () => this.press());
    this.tap($('.qs-x'), () => {
      this.qs.dismiss();
      this.changedAt = performance.now();
    });
    this.offKey = input.onKey((code) => {
      if (code === QS_KEY && this.cardOn && this.keyFree) this.press();
    });
  }

  /**
   * Once a frame (see QuickSubs.update for `shown` and `ready`): the rules step, then the card follows them. An
   * accepted card clears after its acknowledgement; the queued change remains valid until the next stoppage.
   * The board shows whatever the HUD is doing (half time included); CSS hides it in a replay or a close-up.
   */
  update(dt: number, shown: boolean, ready: boolean): void {
    const q = this.qs;
    q.update(dt, shown, ready);
    if (q.rev !== this.drawn) this.draw();
    const cardOn = shown && (q.mode === 'offer' || (q.mode === 'queued' && q.left > 0));
    const boardOn = q.mode === 'board';
    if (cardOn !== this.cardOn || boardOn !== this.boardOn) {
      if (cardOn && !this.cardOn) {
        this.changedAt = performance.now();
        const { keys, pad } = bindings();
        this.keyFree = !Object.values(keys).some((k) => k.includes(QS_KEY));
        this.padFree = !Object.values(pad).some((b) => b.includes(QS_PAD));
      }
      this.cardOn = cardOn;
      this.boardOn = boardOn;
      this.root.classList.toggle('card-on', cardOn);
      this.root.classList.toggle('board-on', boardOn);
      this.root.classList.toggle('on', cardOn || boardOn);
      this.placeT = 0;
    }
    if (cardOn || boardOn) {
      this.placeT -= dt;
      if (this.placeT <= 0) {
        this.placeT = 0.5;
        this.place();
      }
    }
    if (!cardOn) {
      this.padHeld = true;
      return;
    }
    const o = q.offer;
    if (o) {
      // His legs, live (whole percents: no style write unless it moved).
      const s = q.match.players[o.idx]?.stamina ?? 1;
      const pct = Math.round(s * 100);
      if (pct !== this.stamPct) {
        this.stamPct = pct;
        this.stam.style.width = `${pct}%`;
        this.stam.style.background = s > 0.5 ? '#3aff9e' : s > 0.3 ? 'var(--yellow)' : 'var(--red)';
      }
      this.offRow.classList.toggle('booked', q.match.booked.has(o.idx));
    }
    const left = q.mode === 'offer' ? Math.round((Math.max(0, q.left) / QS_SHOW_S) * 100) : 0;
    if (left !== this.timerPct) {
      this.timerPct = left;
      this.timer.style.width = `${left}%`;
    }
    this.drawKey();
    // VIEW on the pad: on the press, not while held.
    let down = false;
    if (this.padFree) for (const gp of pads()) if (gp?.buttons[QS_PAD]?.pressed) down = true;
    if (down && !this.padHeld) this.press();
    this.padHeld = down;
  }

  dispose(): void {
    this.offKey();
    this.root.remove();
  }

  /**
   * Under the pause button, and below the score bug wherever the two would meet (portrait phones: the bug and its
   * booking chips reach across under the pause button). Re-measured twice a second while up (a booking grows it).
   */
  private place(): void {
    const hud = this.root.parentElement;
    if (!hud || typeof window === 'undefined') return;
    const sb = hud.querySelector('.scorebug')?.getBoundingClientRect();
    const pause = hud.querySelector('.hud-pause')?.getBoundingClientRect();
    const me = this.root.getBoundingClientRect();
    let top = pause && pause.height ? pause.bottom + 8 : 0;
    if (sb && sb.height && sb.right + 8 > me.left) top = Math.max(top, sb.bottom + 8);
    const px = top > 0 ? `${Math.round(top)}px` : '';
    if (this.root.style.top !== px) this.root.style.top = px;
  }

  /** The big button (or B / VIEW): queue the change on offer, or undo the queued one. */
  private press(): void {
    const q = this.qs;
    if (performance.now() - this.changedAt < TAP_GUARD_MS) return;
    if (q.mode === 'offer') q.accept();
    else if (q.mode === 'queued') q.cancel();
    else return;
    this.changedAt = performance.now();
  }

  /** Acts on the press itself (a second finger on the stick never gets a click), and never takes focus. */
  private tap(el: HTMLElement, fn: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (this.cardOn) fn();
    });
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('focus', () => el.blur());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private draw(): void {
    const q = this.qs;
    this.drawn = q.rev;
    const queued = q.mode === 'queued';
    this.root.classList.toggle('queued', queued);
    const o = q.offer;
    if (o) {
      this.title.textContent = queued ? 'AT NEXT STOPPAGE' : 'QUICK SUB';
      this.goText.textContent = queued ? 'UNDO' : 'MAKE SUB';
      this.go.setAttribute('aria-label', queued ? `Undo: keep ${shortName(o.off)} on` : `Sub ${shortName(o.off)} off for ${shortName(o.on)} at the next stoppage`);
      this.row(this.offRow, o.off);
      this.row(this.onRow, o.on);
      // (His job and his OVR: who is coming on is a decision, and the number is what he is worth.)
      this.onRow.querySelector('.qs-role')!.textContent = `${o.on.role} ${overall(o.on)}`;
      this.offRow.classList.toggle('booked', q.match.booked.has(o.idx));
      this.stamPct = -1;
    }
    const d = q.done;
    if (d) {
      const rows = this.board.querySelectorAll<HTMLElement>('.qs-b-row');
      rows[0].querySelector('.qs-b-num')!.textContent = String(d.off.number);
      rows[0].querySelector('.qs-b-name')!.textContent = shortName(d.off);
      rows[1].querySelector('.qs-b-num')!.textContent = String(d.on.number);
      rows[1].querySelector('.qs-b-name')!.textContent = shortName(d.on);
      this.board.setAttribute('aria-label', `Substitution: ${d.on.name} on for ${d.off.name}`);
    }
  }

  private row(el: HTMLElement, d: PlayerDef): void {
    el.querySelector('.qs-num')!.textContent = String(d.number);
    el.querySelector('.qs-name')!.textContent = shortName(d);
  }

  /** The key chip on the button: B on a keyboard, VIEW on a pad, nothing on touch (or when the key is taken). */
  private drawKey(): void {
    const dev = this.input.lastDevice;
    const text = dev === 'keyboard' && this.keyFree ? keyLabel(QS_KEY) : dev === 'gamepad' && this.padFree ? padLabel(QS_PAD) : '';
    if (text === this.keyText) return;
    this.keyText = text;
    this.key.textContent = text;
  }
}
