/**
 * Text helpers shared by every screen: the divider between facts, and HTML escaping.
 *
 * The UI used to separate facts with a middle dot (" · ") and scores with a hyphen ("0 - 0"). Neither font has
 * those glyphs the way we need them: Silkscreen (the pixel font) lacks the dot, so the browser drew a fat
 * fallback bullet ("●"), and its hyphen is a clunky bar. So the divider is an element instead, styled per
 * context in style.css (`.sep`: a thin bar in the text colour; a pixel square on the pixel font; a wide red
 * square between score digits). Plain-text places (textContent, aria-labels) get " / ".
 */

/** The divider element. Decorative: screen readers skip it (the words either side read fine on their own). */
export const SEP_HTML = '<i class="sep" aria-hidden="true"></i>';
/** The divider between the two numbers of a score. */
export const SCORE_SEP_HTML = '<i class="sep score" aria-hidden="true"></i>';

export function sep(): string {
  return SEP_HTML;
}

const GLYPH = /[·•●⏺]/;
const GLYPH_RUN = /\s*[·•●⏺]\s*/g;
/** "0 - 0", "2-1", "1 – 0": a score written with a dash between digits. */
const SCORE_DASH = /(\d)\s*[-–]\s*(\d)/g;

/**
 * HTML with every dot separator turned into the divider and every dashed score into the score divider.
 * For markup only (never a string that ends up inside an attribute: see sepText).
 */
export function seps(html: string): string {
  return html.replace(GLYPH_RUN, SEP_HTML).replace(SCORE_DASH, `$1${SCORE_SEP_HTML}$2`);
}

/** Plain text (textContent, title / aria-label attributes, speech): the dot separators become " / ". */
export function sepText(text: string): string {
  return text.replace(GLYPH_RUN, ' / ');
}

/** A score as HTML: the two numbers either side of the score divider. */
export function scoreHtml(a: number | string, b: number | string): string {
  return `${a}${SCORE_SEP_HTML}${b}`;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Plain text made safe for innerHTML, with its dot separators and dashed scores as dividers. */
export function sepsOfText(text: string): string {
  return seps(escHtml(text));
}

function makeSep(): HTMLElement {
  const i = document.createElement('i');
  i.className = 'sep';
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Split one text node around its dot separators, a divider element between the pieces. */
function fixText(t: Text): void {
  if (!GLYPH.test(t.data) || !t.parentNode) return;
  const parts = t.data.split(GLYPH_RUN);
  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i) frag.appendChild(makeSep());
    if (p) frag.appendChild(document.createTextNode(p));
  });
  t.replaceWith(frag);
}

function fixTree(n: Node): void {
  if (n.nodeType === Node.TEXT_NODE) return fixText(n as Text);
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if (GLYPH.test((t as Text).data)) hits.push(t as Text);
  for (const t of hits) fixText(t);
}

/**
 * Safety net under `root`: any text node that arrives (or changes) with a dot separator in it is split around
 * a divider element. It covers screens whose strings this module's callers don't own (the club and market
 * screens, the meta toasts) and anything added later; text nodes only, so attributes and code are never
 * touched. Returns a function that stops it.
 */
export function installSepGuard(root: Node): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const obs = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'characterData') fixText(r.target as Text);
      else r.addedNodes.forEach(fixTree);
    }
  });
  fixTree(root);
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  return () => obs.disconnect();
}
