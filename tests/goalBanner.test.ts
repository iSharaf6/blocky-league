import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

afterEach(() => vi.unstubAllGlobals());

describe('scored-goal corner announcement', () => {
  it.each([
    { w: 320, h: 568, left: 8, top: 20, right: 8 },
    { w: 393, h: 852, left: 12, top: 59, right: 12 },
    { w: 568, h: 240, left: 8, top: 8, right: 8 },
    { w: 852, h: 393, left: 59, top: 8, right: 59 },
    { w: 1024, h: 1366, left: 12, top: 24, right: 12 },
    { w: 1920, h: 1080, left: 12, top: 12, right: 12 },
  ])('keeps the plate under the score and inside the safe corner at $w×$h', ({ w, h, left, top, right }) => {
    vi.stubGlobal('window', { innerWidth: w, innerHeight: h });
    const style = { left: '', top: '', width: '', setProperty: vi.fn() };
    const banner = { style, className: '', innerHTML: '' };
    const hud = Object.assign(Object.create(Hud.prototype), {
      banner, bugRect: () => ({ l: left, t: top, r: left + 200, b: top + 46 }),
      topRight: () => ({ l: w - right - 40, t: top, r: w - right, b: top + 40 }), cmLine: null,
    }) as Hud;
    hud.show('GOAL!', "Long Scorer Name 64'", 'goal against', 3.2);
    expect(banner.className).toContain('score-flash');
    expect(banner.className).toContain('plate');
    expect(parseFloat(style.left)).toBe(left);
    expect(parseFloat(style.top)).toBe(top + 54);
    expect(parseFloat(style.width) + left).toBeLessThanOrEqual(w - right);
    expect(parseFloat(style.width)).toBeLessThanOrEqual(240);
    if (w > h) expect(parseFloat(style.width) + left).toBeLessThan(w / 2);
    // Scenario verdicts retain their own centred treatment.
    hud.show('MOMENT COMPLETE', '', 'goal', 2);
    expect(banner.className).not.toContain('score-flash');
    expect(style.left).toBe(''); expect(style.width).toBe('');
  });
  it('treats imported worn titles and banner text as plain text while preserving fact dividers', () => {
    const banner = { style: { left: '', top: '', width: '', setProperty: vi.fn() }, className: '', innerHTML: '' };
    const hud = Object.assign(Object.create(Hud.prototype), { banner }) as Hud;
    hud.show('<MATCH>', 'BFC · <img src=x onerror=alert(1)>', 'small intro', 2);
    expect(banner.innerHTML).not.toContain('<img');
    expect(banner.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(banner.innerHTML).toContain('&lt;</i>');
    expect(banner.innerHTML).toContain('class="sep"');
  });

});
