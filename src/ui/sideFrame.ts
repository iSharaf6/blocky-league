import './sideFrame.css';

/**
 * The frame round a side show (game/sideShow.ts): a chunky border and a tag in the corner under the camera and pause
 * buttons, or (a big goal's commentary cut) the whole screen with a headline plate. The picture inside it is drawn on
 * the game's canvas by render/sideStage.ts, which asks this where the box is.
 */
export class SideFrame {
  readonly root: HTMLDivElement;
  private readonly tag: HTMLElement;
  private readonly line: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = (this.root = document.createElement('div'));
    root.className = 'side-cam';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="sc-plate"><b class="sc-tag"><i></i><span></span></b><strong class="sc-line"></strong></div>';
    this.tag = root.querySelector('.sc-tag span')!;
    this.line = root.querySelector('.sc-line')!;
    parent.appendChild(root);
  }

  show(label: string, line: string, full: boolean, accent: string): void {
    this.tag.textContent = label;
    this.line.textContent = line;
    this.root.style.setProperty('--sc', accent);
    this.root.classList.toggle('full', full);
    this.root.classList.toggle('lined', line !== '');
    this.root.classList.add('on');
  }

  hide(): void {
    this.root.classList.remove('on', 'full');
  }

  /** The box on the page (CSS px), and whether a style has hidden it (the quick-sub card has that corner). */
  rect(): DOMRect {
    return this.root.getBoundingClientRect();
  }

  get hidden(): boolean {
    return getComputedStyle(this.root).visibility === 'hidden';
  }

  dispose(): void {
    this.root.remove();
  }
}
