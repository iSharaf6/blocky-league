/**
 * The hold over the game while a portal's ad is asked for or is up (main.ts adShield; platform/ads.ts onBusy / onWait).
 *
 * A transparent layer over everything the game draws: its screens (all under #ui, z-index 2) and the pitch's canvas,
 * which takes taps of its own (game/matchSession.ts). #ui going inert is not enough by itself: older Safari has no
 * `inert`, and the canvas is outside #ui. It sits just above #ui and no higher, so an ad an SDK draws inside this
 * page stays above it and keeps its own buttons.
 *
 * While an interstitial is awaited with nothing on screen (before a kick-off the menus are closed) the layer says
 * ONE MOMENT, but only once the wait has lasted AD_WAIT_LINE_MS: an ad that comes at once never flashes it.
 */

/** A wait shorter than this (ms) shows nothing. */
export const AD_WAIT_LINE_MS = 600;

const LAYER_CSS = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:3;display:flex;align-items:center;justify-content:center;'
  + 'background:transparent;pointer-events:auto;touch-action:none;cursor:default;';
const LINE_CSS = 'padding:9px 16px;font:400 16px/1 var(--round, sans-serif);letter-spacing:1px;white-space:nowrap;'
  + 'color:#fbfbf4;background:rgba(38,38,46,0.86);pointer-events:none;';
/** Everything a pointer can do to what lies under the layer. */
const HELD = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'contextmenu', 'wheel'];

let layer: HTMLElement | null = null;
let line: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const hold = (e: Event): void => {
  e.stopPropagation();
  if (e.cancelable) e.preventDefault();
};

/** Put the layer up (true) or take it down (false: the line and its timer go with it, whatever state they were in). */
export function adHold(on: boolean): void {
  if (!on) {
    adWait(false);
    const el = layer;
    layer = null;
    try {
      el?.remove();
    } catch {
      /* already gone */
    }
    return;
  }
  if (layer) return;
  const el = document.createElement('div');
  el.className = 'ad-hold';
  el.style.cssText = LAYER_CSS;
  for (const t of HELD) el.addEventListener(t, hold, { passive: false });
  document.body.appendChild(el);
  layer = el;
}

/** An interstitial is awaited (true): ONE MOMENT after AD_WAIT_LINE_MS, if the layer is still up. false takes it away. */
export function adWait(on: boolean): void {
  clearTimeout(timer);
  timer = undefined;
  if (!on) {
    const el = line;
    line = null;
    try {
      el?.remove();
    } catch {
      /* already gone */
    }
    return;
  }
  if (line) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (!layer || line) return;
    const el = document.createElement('div');
    el.className = 'ad-hold-line';
    el.setAttribute('role', 'status');
    el.textContent = 'ONE MOMENT';
    el.style.cssText = LINE_CSS;
    layer.appendChild(el);
    line = el;
  }, AD_WAIT_LINE_MS);
}

/** Is the layer up, and is its line showing (tests, and main.ts never needs to ask)? */
export function adHoldState(): { up: boolean; line: boolean; pending: boolean } {
  return { up: !!layer, line: !!line, pending: timer !== undefined };
}
