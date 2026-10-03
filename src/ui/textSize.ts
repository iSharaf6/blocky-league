/**
 * Settings > TEXT SIZE: SMALL / MEDIUM / LARGE for the menus and the HUD. MEDIUM is the designed size (nothing
 * changes). The others put a class on <html> (ts-small, ts-large) that sets --ts, the text scale: the main menu's
 * own type is sized with it, and src/style.css ("text size") scales the panels' contents and the HUD's text
 * blocks with it. The touch controls, the pitch and the camera never read it, so gameplay is untouched.
 */
import { TEXT_SIZES, type TextSize } from '../core/save';

export const TEXT_SIZE_LABEL: Record<TextSize, string> = { small: 'SMALL', medium: 'MEDIUM', large: 'LARGE' };

/** The next size when the Settings row is tapped: MEDIUM, LARGE, SMALL, MEDIUM... */
export function nextTextSize(cur: TextSize | undefined): TextSize {
  const order: readonly TextSize[] = ['medium', 'large', 'small'];
  const i = order.indexOf(cur && TEXT_SIZES.includes(cur) ? cur : 'medium');
  return order[(i + 1) % order.length];
}

/** Put the text size on the page (a class on <html>; MEDIUM removes both). */
export function applyTextSize(size: TextSize | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('ts-small', size === 'small');
  root.classList.toggle('ts-large', size === 'large');
}
