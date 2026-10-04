import { Vector3, type Camera } from 'three';
import { clamp } from '../core/math';
import { PF } from '../game/replay';
import { PITCH_Y } from '../render/stadium';
import type { TackleCue } from '../sim/types';
import './actionPop.css';

/** How long (s) a word stays up (matches the CSS animation). */
const POP_S = 0.85;
/** Head clearance (m) of the word over his man. */
const POP_UP = 0.8;
/** The top band (px) the score bar and pause button own. */
const TOP_CLEAR = 64;

/** The word for each outcome of a TACKLE press (sim/dribble.ts: the 'tackleCue' event). */
export const TACKLE_WORDS: Readonly<Record<TackleCue, string>> = {
  won: 'TACKLE!',
  far: 'TOO FAR',
  mistimed: 'MISTIMED',
  behind: 'FROM BEHIND',
};

/**
 * The answer to a TACKLE press, in a word over the man who made it (2026-10-04, the owner: "the button feels useless
 * ... im not sure if this is relatded to teh players skill level or not ... so the other people playing the game wouldnt
 * be sure either"): TACKLE! in green when he wins it, and when he doesn't the reason, small and white (TOO FAR, MISTIMED,
 * FROM BEHIND). Pitch-anchored DOM, placed every frame while it is up; the words are only rewritten on an event.
 */
export class ActionPop {
  readonly root = document.createElement('div');
  private v = new Vector3();
  private t = 0;
  private player = -1;

  constructor() {
    this.root.className = 'act-pop';
    this.root.setAttribute('aria-live', 'polite');
  }

  /** A TACKLE press came off this way: the word over `player`. */
  tackle(player: number, cue: TackleCue): void {
    const el = this.root;
    el.dataset.cue = cue;
    el.textContent = TACKLE_WORDS[cue];
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.t = POP_S;
    this.player = player;
  }

  clear(): void {
    this.root.classList.remove('on');
    this.t = 0;
  }

  /** Once a frame: `head` is the drawn head height (m); `hidden`: nothing is drawn (a replay, a pause, a cut away). */
  update(frame: Float32Array, camera: Camera, head: number, hidden: boolean, dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0 || hidden || this.player < 0 || this.player >= 22) {
      this.clear();
      return;
    }
    const o = this.player * PF;
    this.v.set(frame[o], frame[o + 2] + head + POP_UP + PITCH_Y, frame[o + 1]).project(camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = ((this.v.x + 1) / 2) * w;
    const y = ((1 - this.v.y) / 2) * h;
    this.root.style.left = `${Math.round(clamp(x, 70, w - 70))}px`;
    this.root.style.top = `${Math.round(clamp(y, TOP_CLEAR + 24, h - 110))}px`;
  }
}
