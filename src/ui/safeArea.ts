/**
 * The notch and home-indicator insets (CSS env(safe-area-inset-*): about 62 px each side on a landscape iPhone,
 * 0 off notched screens), for layout done in script rather than CSS. A hidden probe padded by them, read back.
 */

export interface Insets {
  l: number;
  t: number;
  r: number;
  b: number;
}

let probe: HTMLDivElement | null = null;

/** Fills `out` with the current insets in CSS px (all 0 without a DOM). */
export function safeAreaInsets(out: Insets): Insets {
  out.l = out.t = out.r = out.b = 0;
  if (typeof document === 'undefined' || !document.body) return out;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  out.l = parseFloat(s.paddingLeft) || 0;
  out.t = parseFloat(s.paddingTop) || 0;
  out.r = parseFloat(s.paddingRight) || 0;
  out.b = parseFloat(s.paddingBottom) || 0;
  return out;
}
