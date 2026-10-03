/**
 * Helpers for the app-shell screens (docs/UX.md, shell.css): each `.pane-scroll` list keeps its place across
 * re-renders (keyed by `data-scroll-key`, or `data-key`), a row is brought into view inside its own pane without
 * moving the page around it, and Escape works as an action while a meta screen is up.
 *
 * (Shared: mountMeta in ui/club.ts calls paneScrolls / restorePaneScrolls on every render; the market and the ROAD TO
 * GLORY screens use revealInPane, PaneScroll and escBack.)
 */
import { onMetaClose } from './club';

/** A keyed pane's key: `data-scroll-key`, else `data-key`. */
function keyOf(el: HTMLElement): string {
  return el.dataset.scrollKey ?? el.dataset.key ?? '';
}

const KEYED = '[data-scroll-key], .pane-scroll[data-key]';

/** Every keyed pane's scroll position under `root` (call before replacing its markup). */
export function paneScrolls(root: ParentNode): Map<string, number> {
  const out = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(KEYED).forEach((el) => {
    const k = keyOf(el);
    if (k) out.set(k, el.scrollTop);
  });
  return out;
}

/** Put each keyed pane back where it was (call after the new markup is in). */
export function restorePaneScrolls(root: ParentNode, lists: ReadonlyMap<string, number>): void {
  root.querySelectorAll<HTMLElement>(KEYED).forEach((el) => {
    const v = lists.get(keyOf(el));
    if (v !== undefined) el.scrollTop = v;
  });
}

/** Scroll `el` into view inside the `.pane-scroll` that holds it: just enough ('nearest') or to the middle ('center'). */
export function revealInPane(el: Element | null | undefined, block: 'nearest' | 'center' = 'nearest'): void {
  const box = el?.closest<HTMLElement>('.pane-scroll');
  if (!el || !box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (block === 'center') {
    box.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
    return;
  }
  if (r.top < b.top) box.scrollTop += r.top - b.top - 4;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
}

/**
 * Pane scroll positions that outlive one screen visit (BACK returns to the same place): save() before a re-render or
 * when leaving, restore() after the markup is in.
 */
export class PaneScroll {
  private readonly at = new Map<string, number>();

  save(root: ParentNode): void {
    for (const [k, v] of paneScrolls(root)) this.at.set(k, v);
  }

  restore(root: ParentNode): void {
    restorePaneScrolls(root, this.at);
  }

  forget(key: string): void {
    this.at.delete(key);
  }

  has(key: string): boolean {
    return this.at.has(key);
  }
}

/**
 * Escape runs `fn` while this meta screen is up (removed when it closes). For screens without a BACK button (mountMeta
 * already sends Escape to `[data-a=back]`). `busy` lets a sheet on top keep the key; a handler that took it wins.
 */
export function escBack(fn: () => void, busy: () => boolean = () => false): void {
  const onKey = (e: KeyboardEvent) => {
    if ((e.key !== 'Escape' && e.code !== 'Escape') || e.defaultPrevented || e.repeat || busy()) return;
    e.preventDefault();
    fn();
  };
  window.addEventListener('keydown', onKey);
  onMetaClose(() => window.removeEventListener('keydown', onKey));
}
