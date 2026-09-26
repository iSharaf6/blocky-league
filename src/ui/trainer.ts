import { Vector3, type Camera } from 'three';
import { clamp } from '../core/math';
import { BALL_OFS, PF } from '../game/replay';
import { HALF_L } from '../sim/constants';
import { PITCH_Y } from '../render/stadium';
import type { Match } from '../sim/match';

type Device = 'keyboard' | 'gamepad' | 'touch';
export interface TrainerCue {
  title: string;
  actions: [string, string][];
  detail: string;
}

/** Uses the same possession and charge state as the controller, including passes in flight. */
export function trainerCue(m: Match, device: Device): TrainerCue {
  const keys = device === 'gamepad' ? ['A', 'B', 'X', 'RT'] : device === 'touch'
    ? ['PASS', 'SHOOT', 'THROUGH', 'SPRINT'] : ['SPACE', 'K', 'L', 'SHIFT'];
  const [pass, shoot, through, sprint] = keys;
  const own = m.ball.owner;
  const mine = own === m.active && own >= 0;
  if (mine && m.ball.held) return {
    title: "KEEPER'S BALL", actions: [[pass, 'Roll out'], [through, 'Kick long']],
    detail: 'Point towards an open teammate',
  };
  if (mine && m.shootCharge > 0.06) return {
    title: 'PICK YOUR CORNER', actions: [[shoot, 'Release to shoot']],
    detail: `${through} while charging = chip`,
  };
  if (mine && m.throughCharge > 0.08 && (m.passMode === 'through' || m.passMode === 'lob')) return {
    title: m.throughCharge >= 0.3 ? 'CROSS READY' : 'THROUGH BALL',
    actions: [[through, m.throughCharge >= 0.3 ? 'Release to cross' : 'Release into space']],
    detail: 'Hold longer to lift it over the defence',
  };
  if (mine) return {
    title: 'ON THE BALL', actions: [[pass, 'Pass'], [shoot, 'Shoot'], [through, 'Through']],
    detail: m.players[m.active].sprint ? `${sprint} + ${pass} = pass & run` : `Hold ${through} to cross · ${sprint} sprint`,
  };
  if (own < 0 && m.passTarget === m.active) return {
    title: 'MEET THE PASS', actions: [[pass, 'First-time pass'], [shoot, 'Finish']],
    detail: 'Let go of movement to meet the ball',
  };
  if (own >= 0 && m.players[own].side !== m.cfg.humanSide) return {
    title: 'WIN IT BACK', actions: [[device === 'touch' ? 'TACKLE' : shoot, 'Tackle'], [device === 'touch' ? 'PRESS' : through, 'Hold to press'], [device === 'touch' ? 'SWITCH' : pass, 'Switch']],
    detail: `Hold ${device === 'touch' ? 'TACKLE' : shoot} to slide · aim away to cancel`,
  };
  return { title: 'GET TO THE BALL', actions: [[sprint, 'Sprint'], [pass, 'Switch']], detail: 'Point your movement towards the ball' };
}

/** Small pitch-anchored control card and passing lane. No menus, animations, or per-frame DOM rebuilds. */
export class Trainer {
  readonly root = document.createElement('div');
  private card: HTMLElement;
  private title: HTMLElement;
  private actions: HTMLElement;
  private detail: HTMLElement;
  private recipient: HTMLElement;
  private line: SVGLineElement;
  private shadow: SVGLineElement;
  private guide: SVGSVGElement;
  private v = new Vector3();
  private lastCue = '';
  private target = -1;

  constructor() {
    this.root.className = 'pitch-trainer';
    this.root.hidden = true;
    this.root.innerHTML = `<svg class="trainer-guide" aria-hidden="true"><line class="trainer-line-shadow"/><line class="trainer-line"/></svg>
      <div class="trainer-recipient" aria-hidden="true"></div>
      <div class="trainer-card" role="group" aria-label="On-pitch trainer">
        <div class="trainer-title"></div><div class="trainer-actions"></div><div class="trainer-detail"></div>
      </div>`;
    this.card = this.root.querySelector('.trainer-card')!;
    this.title = this.root.querySelector('.trainer-title')!;
    this.actions = this.root.querySelector('.trainer-actions')!;
    this.detail = this.root.querySelector('.trainer-detail')!;
    this.recipient = this.root.querySelector('.trainer-recipient')!;
    this.line = this.root.querySelector('.trainer-line')!;
    this.shadow = this.root.querySelector('.trainer-line-shadow')!;
    this.guide = this.root.querySelector('svg')!;
  }

  hide(): void { this.root.hidden = true; }

  update(m: Match, frame: Float32Array, camera: Camera, head: number, device: Device): void {
    if (!m.trainer || m.phase !== 'play' || m.active < 0 || m.players[m.active].sentOff) { this.hide(); return; }
    const w = window.innerWidth, h = window.innerHeight;
    const project = (x: number, y: number, z: number) => {
      this.v.set(x, y + PITCH_Y, z).project(camera);
      return { x: (this.v.x + 1) * w / 2, y: (1 - this.v.y) * h / 2, visible: this.v.z > -1 && this.v.z < 1 };
    };
    const a = m.active * PF;
    const at = project(frame[a], head + frame[a + 2], frame[a + 1]);
    if (!at.visible || at.x < 0 || at.x > w || at.y < 65 || at.y > h - 25) { this.hide(); return; }
    this.root.hidden = false;
    const cue = trainerCue(m, device);
    const goal = project(m.attackDir(m.players[m.active].side) * HALF_L, 0, 0);
    const direction = Math.abs(goal.x - at.x) > 70 ? (goal.x > at.x ? ' →' : ' ←') : ' ↑';
    const key = JSON.stringify(cue) + direction;
    if (key !== this.lastCue) {
      this.lastCue = key;
      this.title.textContent = cue.title + (m.ball.owner === m.active ? direction : '');
      this.actions.replaceChildren(...cue.actions.map(([k, label]) => {
        const item = document.createElement('span');
        const cap = document.createElement('kbd');
        cap.textContent = k;
        item.append(cap, document.createTextNode(label));
        return item;
      }));
      this.detail.textContent = cue.detail;
    }
    // Place above the head. Never cover the boots/ball, score, or the bottom touch controls.
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    const x = clamp(at.x - cw / 2, 10, w - cw - 10);
    const y = at.y - ch - 22;
    // Visibility keeps its dimensions measurable near the score bug; display:none would alternate
    // between a zero-height and full-height card every frame at that boundary.
    const cardVisible = y >= 66;
    this.card.style.visibility = cardVisible ? 'visible' : 'hidden';
    this.card.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    const idx = m.passCharge >= 0 ? m.passAim : m.passPreview;
    const valid = m.ball.owner === m.active && m.shootCharge < 0.06 && m.throughCharge < 0.08 &&
      idx >= 0 && idx !== m.active && !m.players[idx].sentOff && m.players[idx].side === m.cfg.humanSide;
    this.guide.style.display = valid ? '' : 'none';
    this.recipient.hidden = !valid;
    if (!valid) { this.target = -1; return; }
    const to = project(frame[idx * PF], 0.14, frame[idx * PF + 1]);
    const tag = project(frame[idx * PF], head + frame[idx * PF + 2] + 0.55, frame[idx * PF + 1]);
    const from = project(frame[BALL_OFS], 0.14, frame[BALL_OFS + 2]);
    if (!to.visible || !from.visible) { this.guide.style.display = 'none'; this.recipient.hidden = true; return; }
    for (const line of [this.line, this.shadow]) {
      line.setAttribute('x1', from.x.toFixed(1)); line.setAttribute('y1', from.y.toFixed(1));
      line.setAttribute('x2', to.x.toFixed(1)); line.setAttribute('y2', to.y.toFixed(1));
    }
    this.recipient.hidden = !tag.visible || tag.x < 38 || tag.x > w - 38 || tag.y < 80 || tag.y > h - 85 ||
      (cardVisible && tag.x > x - 30 && tag.x < x + cw + 30 && tag.y > y - 15 && tag.y < at.y - 10);
    this.recipient.style.transform = `translate(${Math.round(tag.x)}px,${Math.round(tag.y - 12)}px) translate(-50%,-100%)`;
    if (this.target !== idx || this.recipient.dataset.device !== device) {
      this.target = idx;
      this.recipient.dataset.device = device;
      this.recipient.textContent = `${device === 'gamepad' ? 'A' : device === 'touch' ? 'PASS' : 'SPACE'} · ${m.players[idx].def.number}`;
    }
  }
}
