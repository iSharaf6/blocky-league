import { pixelIcon } from './pixelIcons';
import { escHtml } from './text';
import './present.css';

/**
 * The match presentation's own captions (the session hangs this off the HUD's root, like the trainer and the skill
 * pops; ui/present.css places them):
 *
 * - the CHANT caption: a small line under the camera and pause buttons when the crowd starts a chant ("CROWD: OLE
 *   OLE OLE", with a pixel note), up for a few seconds, clear of the score bug, the HYPE bars and the live goal on the
 *   left. Off with Settings > COMMENTARY (the session only calls it when the ticker is on);
 * - the SUBSTITUTION caption, a lower third under the touchline shot: "OFF 9 CINDER" in red, "ON 14 TUFFET" in green;
 * - the lower-third PLATE for the line-up (your club, your captain) and the MAN OF THE MATCH (his name and rating).
 *
 * No emojis (pixel icons), no monospace, no dots or dashes as separators.
 */
export class PresentHud {
  readonly root: HTMLDivElement;
  private readonly chant: HTMLDivElement;
  private readonly chantText: HTMLElement;
  private chantLeft = 0;
  private readonly sub: HTMLDivElement;
  private readonly subTag: HTMLElement;
  private readonly subOff: HTMLElement;
  private readonly subOn: HTMLElement;
  private readonly plate: HTMLDivElement;
  private readonly plateTag: HTMLElement;
  private readonly plateTitle: HTMLElement;
  private readonly plateSub: HTMLElement;
  private readonly plateArt: HTMLElement;

  constructor() {
    const root = (this.root = document.createElement('div'));
    root.className = 'hud-pz';
    root.innerHTML = `
      <div class="pz-chant" role="status" aria-live="off">${pixelIcon('note', '#ffd23a', 2, 'pz-note')}<span class="pz-chant-t"></span></div>
      <div class="pz-sub" role="status" aria-live="polite">
        <b class="pz-sub-tag">SUBSTITUTION</b>
        <div class="pz-sub-row">
          <span class="pz-off"></span>
          ${pixelIcon('swap', '#fbfbf4', 2, 'pz-swap')}
          <span class="pz-on"></span>
        </div>
      </div>
      <div class="pz-plate" role="status" aria-live="polite">
        <span class="pz-art"></span>
        <span class="pz-words"><b class="pz-tag"></b><strong class="pz-title"></strong><em class="pz-line"></em></span>
      </div>`;
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.chant = $('.pz-chant');
    this.chantText = $('.pz-chant-t');
    this.sub = $('.pz-sub');
    this.subTag = $('.pz-sub-tag');
    this.subOff = $('.pz-off');
    this.subOn = $('.pz-on');
    this.plate = $('.pz-plate');
    this.plateTag = $('.pz-tag');
    this.plateTitle = $('.pz-title');
    this.plateSub = $('.pz-line');
    this.plateArt = $('.pz-art');
  }

  /** The crowd has started a chant: its words, for `seconds`. */
  showChant(text: string, seconds = 3.4): void {
    this.chantText.textContent = text;
    this.chant.classList.remove('on');
    void this.chant.offsetWidth;
    this.chant.classList.add('on');
    this.chantLeft = seconds;
  }

  hideChant(): void {
    this.chantLeft = 0;
    this.chant.classList.remove('on');
  }

  /** The chant caption up now ('' when none): tests and the dev panel. */
  get chantShown(): string {
    return this.chant.classList.contains('on') ? this.chantText.textContent ?? '' : '';
  }

  /** A change on the touchline: who goes off, who comes on, and which change of how many this stoppage. */
  showSub(off: { number: number; name: string }, on: { number: number; name: string }, i: number, n: number): void {
    this.subTag.textContent = n > 1 ? `SUBSTITUTION ${i} OF ${n}` : 'SUBSTITUTION';
    this.subOff.innerHTML = `<b>OFF</b><i>${off.number}</i><span>${escHtml(off.name.toUpperCase())}</span>`;
    this.subOn.innerHTML = `<b>ON</b><i>${on.number}</i><span>${escHtml(on.name.toUpperCase())}</span>`;
    this.sub.setAttribute('aria-label', `Substitution: off ${off.number} ${off.name}, on ${on.number} ${on.name}`);
    this.sub.classList.remove('on');
    void this.sub.offsetWidth;
    this.sub.classList.add('on');
  }

  hideSub(): void {
    this.sub.classList.remove('on');
  }

  /** The substitution caption up now, as plain words ("OFF 9 CINDER, ON 14 TUFFET"; '' when none). */
  get subShown(): string {
    if (!this.sub.classList.contains('on')) return '';
    const words = (el: HTMLElement) => [...el.children].map((c) => c.textContent ?? '').join(' ');
    return `${words(this.subOff)}, ${words(this.subOn)}`;
  }

  /**
   * The lower-third plate: a small tag over a title and one line. `art`: markup for its left end (a crest); `accent`:
   * a CSS colour for the stripe (the club's shirt).
   */
  showPlate(tag: string, title: string, line = '', art = '', accent = ''): void {
    this.plateTag.textContent = tag;
    this.plateTitle.textContent = title;
    this.plateSub.textContent = line;
    this.plateSub.hidden = !line;
    this.plateArt.innerHTML = art;
    this.plateArt.hidden = !art;
    this.plate.style.setProperty('--pz', accent || 'var(--yellow)');
    this.plate.classList.remove('on');
    void this.plate.offsetWidth;
    this.plate.classList.add('on');
  }

  hidePlate(): void {
    this.plate.classList.remove('on');
  }

  get plateShown(): string {
    return this.plate.classList.contains('on') ? `${this.plateTag.textContent} / ${this.plateTitle.textContent}` : '';
  }

  update(dt: number): void {
    if (this.chantLeft > 0 && (this.chantLeft -= dt) <= 0) this.chant.classList.remove('on');
  }

  dispose(): void {
    this.root.remove();
  }
}
