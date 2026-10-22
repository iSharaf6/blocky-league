import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import { landingSpot } from '../src/game/landing';
import { BALL_OFS, FRAME_LEN } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS } from '../src/meta/moments';
import { MatchView } from '../src/render/matchView';
import { BALL_R, DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { applyScenario } from '../src/sim/scenario';
import { CardSlide, SLIDE_AHEAD_S, SLIDE_PAD, Lesson, callSpot, type Box, type Pt, type SlideScene } from '../src/ui/trainer';

declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

// CrazyGames' review, 22 October: "During our check, the guide is a bit transparent. Please prevent it." and "The circle
// indicator is also glitching when the ball is passed to the character during the last tutorial."

/** The card at home at 1920 by 945: 300 px wide, bottom centre, above the minimap. */
const HOME: Box = { l: 810, r: 1110, t: 740, b: 812 };
const W = 1920;

/** His man's feet, body and head on screen at x (and his run ahead, as Trainer.placeCard looks at it). */
function man(x: number, vx = 0, y = 800): Pt[] {
  const out: Pt[] = [];
  for (const k of [0, SLIDE_AHEAD_S / 2, SLIDE_AHEAD_S]) for (const dy of [0, -32, -64]) out.push({ x: x + vx * k, y: y + dy });
  return out;
}
const scene = (must: Pt[], extra: Partial<SlideScene> = {}): SlideScene => ({ home: HOME, must, soft: [], blocked: [], minL: 8, maxR: W - 8, ...extra });
const inside = (x: number, p: Pt) => p.x > HOME.l + x && p.x < HOME.r + x && p.y > HOME.t && p.y < HOME.b;

describe('the guide card moves off the play, it never fades (CardSlide)', () => {
  it('a man standing under it: it slides to the side away from him, once, smoothly, and stays clear', () => {
    const s = new CardSlide();
    s.update(scene([]), 1 / 60, true);
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) xs.push(s.update(scene(man(1000)), 1 / 60));
    // (He is right of centre: it goes left, never through him.)
    expect(s.target).toBeLessThan(0);
    expect(HOME.r + s.target).toBeLessThanOrEqual(1000 - SLIDE_PAD);
    // One way only, never past its mark (no jitter, no overshoot), and there in about a quarter of a second.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-9);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(s.target - 1e-6);
    expect(Math.abs(xs[24] - s.target)).toBeLessThan(2);
  });

  it('he runs along the bottom: at a jog never under it; at a sprint the whole width, over him once for 4 frames at most', () => {
    // (One row along the bottom and a man sprinting its whole length: once the card meets the edge of the screen it can
    // only pass over him, and it does so on its quick spring, in at most 4 frames, 67 ms.)
    for (const [vx, most] of [[-200, 0], [200, 0], [-400, 4], [400, 4], [-700, 4], [700, 4]]) {
      const s = new CardSlide();
      let x0 = vx < 0 ? 1700 : 220;
      s.update(scene(man(x0, vx)), 1 / 60, true);
      let under = 0;
      for (let i = 0; i < 300; i++) {
        x0 += vx / 60;
        const x = s.update(scene(man(x0, vx), { drift: vx }), 1 / 60);
        if (man(x0).slice(0, 3).some((p) => inside(x, p))) under++;
      }
      expect(under, `vx ${vx}`).toBeLessThanOrEqual(most);
    }
  });

  it('never slides over the touch controls or the player chip, and stays on screen', () => {
    const blocked = [{ l: 10, r: 330 }, { l: 1560, r: 1910 }];
    const s = new CardSlide();
    for (let i = 0; i < 300; i++) {
      const at = 700 + Math.sin(i / 30) * 500;
      const x = s.update(scene(man(at), { blocked }), 1 / 60, i === 0);
      for (const b of blocked) expect(HOME.r + x <= b.l || HOME.l + x >= b.r).toBe(true);
      expect(HOME.l + x).toBeGreaterThanOrEqual(8);
      expect(HOME.r + x).toBeLessThanOrEqual(W - 8);
    }
  });

  it('back home only once home has been clear a while: one move out, one move back', () => {
    const s = new CardSlide();
    s.update(scene([]), 1 / 60, true);
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) xs.push(s.update(scene(man(1000)), 1 / 60));
    const out = s.target;
    // He leaves: the card waits 0.6 s, then goes home.
    for (let i = 0; i < 30; i++) xs.push(s.update(scene(man(1000, 0, 300)), 1 / 60));
    expect(s.target).toBe(out);
    for (let i = 0; i < 60; i++) xs.push(s.update(scene(man(1000, 0, 300)), 1 / 60));
    expect(s.target).toBe(0);
    let turns = 0;
    let dir = 0;
    for (let i = 1; i < xs.length; i++) {
      const d = Math.sign(xs[i] - xs[i - 1]);
      if (d && dir && d !== dir) turns++;
      if (d) dir = d;
    }
    expect(turns).toBe(1);
  });

  it('comes up already clear of him (it never appears over him and then slides off)', () => {
    const s = new CardSlide();
    const x = s.update(scene(man(960)), 1 / 60, true);
    for (const p of man(960)) expect(inside(x, p)).toBe(false);
  });
});

describe('a call across the picture sits above, below or beside the runner, never over him (callSpot)', () => {
  const runner = [{ x: 960, y: 300 }, { x: 960, y: 330 }, { x: 960, y: 360 }];
  it('the first spot clear of him, and it stays there while it stays clear', () => {
    expect(callSpot([{ x: 960, y: 300 }, { x: 960, y: 600 }], null, runner, 560, 60)).toEqual({ x: 960, y: 600 });
    expect(callSpot([{ x: 960, y: 120 }, { x: 960, y: 600 }], { x: 960, y: 600 }, runner, 560, 60)).toEqual({ x: 960, y: 600 });
    expect(callSpot([{ x: 960, y: 120 }, { x: 960, y: 600 }], { x: 960, y: 320 }, runner, 560, 60)).toEqual({ x: 960, y: 120 });
  });
  it('a small screen with him in every band across the middle: to one side of him', () => {
    const small = [{ x: 370, y: 40 }, { x: 370, y: 100 }, { x: 362, y: 140 }];
    const cands = [{ x: 372, y: 50 }, { x: 372, y: 120 }, { x: 152, y: 50 }, { x: 593, y: 50 }];
    const at = callSpot(cands, null, small, 280, 40);
    expect(at.x).not.toBe(372);
    for (const p of small) expect(p.x > at.x - 140 - 16 && p.x < at.x + 140 + 16 && p.y > at.y - 16 && p.y < at.y + 56).toBe(false);
  });
});

describe('every guide is solid: no fade over the play (coach.css, style.css)', () => {
  const coach = readFileSync('src/ui/coach.css', 'utf8');
  const style = readFileSync('src/style.css', 'utf8');
  it('the card, the drill calls and the kick-off prompt are opaque, and only fade in, in 0.2 s or less', () => {
    expect(coach).toMatch(/--coach-bg:\s*rgb\(38, 38, 46\)/);
    expect(coach).not.toMatch(/\.under/);
    expect(coach).not.toMatch(/filter:\s*opacity/);
    expect(coach).not.toMatch(/\.quiet\s*\{[^}]*opacity/);
    const ms = (s: string) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);
    for (const m of coach.matchAll(/transition:\s*opacity\s+([\d.]+m?s)/g)) expect(ms(m[1])).toBeLessThanOrEqual(200);
    expect(coach).toMatch(/transform:\s*translateX\(calc\(-50% \+ var\(--slide, 0px\)\)\)/);
  });
  it("LEARN THE BASICS' AGAIN! and NICE! come up solid: no letter or line fading in", () => {
    expect(style).toMatch(/\.hud-banner\.drill \{ transition: opacity 0\.16s; \}/);
    for (const k of ['drill-letter', 'drill-drop']) {
      const kf = new RegExp(`@keyframes ${k} \\{([^}]*)\\}`).exec(style)?.[1] ?? '';
      expect(kf).not.toBe('');
      expect(kf).not.toMatch(/opacity/);
    }
    expect(readFileSync('src/main.ts', 'utf8')).toMatch(/title: 'AGAIN!'[^\n]*kind: `\$\{b\.kind\} drill`/);
  });
  it('words over the play dim no lower than 0.75 (the minimap and the touch buttons still give way fully)', () => {
    for (const m of style.matchAll(/([^{}]*\.under[^{}]*)\{([^}]*)\}/g)) {
      const sel = m[1];
      const op = /opacity\(([\d.]+)\)/.exec(m[2]) ?? /opacity:\s*([\d.]+)/.exec(m[2]);
      if (!op) continue;
      if (/hud-radar|\.touch /.test(sel)) continue;
      expect(parseFloat(op[1]), sel.trim()).toBeGreaterThanOrEqual(0.75);
    }
  });
});

/** Drill 3 as the session plays it: the winger holds THROUGH, lets go, the cross flies to the runner. */
function crossDrill() {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 1, assist: 0.8,
  });
  applyScenario(m, BASICS[2].spec);
  const lesson = new Lesson(BASICS[2].lesson);
  let kicked = false;
  for (let i = 0; i < 90 && !kicked; i++) {
    const through = i * DT < 0.7;
    if (lesson.hold(m, { sx: 0, sy: 0, pass: false, through })) continue;
    m.step(DT, { ...EMPTY_PAD, through });
    for (const e of m.drainEvents()) {
      lesson.event(e, m);
      if (e.type === 'kick' && e.kind === 'lob') kicked = true;
    }
  }
  expect(kicked).toBe(true);
  return m;
}

describe("the cross's landing ring stays on one spot (the circle CrazyGames saw glitching in drill 3)", () => {
  it('the spot holds still frame to frame all the way in, and is where the ball comes down', () => {
    const m = crossDrill();
    const spots: { x: number; z: number }[] = [];
    let down: { x: number; z: number } | null = null;
    const kick = m.kickId;
    let touched = false;
    for (let i = 0; i < 240 && !down && !touched; i++) {
      const b = m.ball;
      if (b.owner < 0 && b.pos.y > 1.2) {
        const s = landingSpot(b.pos, b.vel, b.spin);
        if (s) spots.push(s);
      }
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
      touched = m.kickId !== kick || m.ball.owner >= 0;
      if (!touched && spots.length && m.ball.pos.y <= BALL_R + 0.02) down = { x: m.ball.pos.x, z: m.ball.pos.z };
    }
    expect(spots.length).toBeGreaterThan(20);
    for (let i = 1; i < spots.length; i++) expect(Math.hypot(spots[i].x - spots[i - 1].x, spots[i].z - spots[i - 1].z)).toBeLessThan(0.1);
    // (Untouched on the way down, it lands where the ring said.)
    if (down) expect(Math.hypot(down.x - spots[spots.length - 1].x, down.z - spots[spots.length - 1].z)).toBeLessThan(0.5);
  });

  it('nobody meets it: the ball comes down within half a metre of the ring', () => {
    const m = crossDrill();
    // (The runner taken far away, so the cross lands untouched.)
    const r = m.players[m.passTarget >= 0 ? m.passTarget : 9];
    r.pos.x = -40;
    r.pos.z = -20;
    const kick = m.kickId;
    let spot: { x: number; z: number } | null = null;
    let down: { x: number; z: number } | null = null;
    for (let i = 0; i < 300 && !down; i++) {
      const b = m.ball;
      if (b.owner < 0 && b.pos.y > 1.2) spot = landingSpot(b.pos, b.vel, b.spin) ?? spot;
      m.step(DT, EMPTY_PAD);
      m.drainEvents();
      if (m.kickId !== kick) break;
      if (spot && m.ball.pos.y <= BALL_R + 0.02) down = { x: m.ball.pos.x, z: m.ball.pos.z };
    }
    expect(spot).not.toBeNull();
    expect(down).not.toBeNull();
    expect(Math.hypot(down!.x - spot!.x, down!.z - spot!.z)).toBeLessThan(0.5);
  });

  /** MatchView's own ring code on a bare view: the parts setLanding and setPassPreview touch. */
  function bareView(active = 9): Record<string, unknown> {
    const frame = new Float32Array(FRAME_LEN);
    frame[BALL_OFS + 8] = active;
    return {
      group: new Group(), landingRing: null, landingLocked: false, landingAt: { x: 0, z: 0 }, landingSize: 1, landingClock: 0,
      frame, marker: { visible: true }, pipIdx: [8, 9], previewW: new Float32Array(22), throughW: new Float32Array(22),
      previewRings: new Array(22).fill(null), throughRings: new Array(22).fill(null), throughAt: new Float32Array(44), charK: 1,
      makePreviewRing() { const g = new Group(); g.add(new Mesh(), new Mesh()); return g; },
      makeThroughRing() { return new Mesh(); },
    };
  }

  it('one landing ring: it comes up on its spot, glides (never jumps) a short way, and a new ball is there at once', () => {
    const v = bareView();
    const set = (x: number, z: number, t: number, locked = false) => MatchView.prototype.setLanding.call(v as never, true, x, z, t, locked);
    set(44.3, 0.2, 10);
    const ring = v.landingRing as Group;
    expect(ring.position.x).toBeCloseTo(44.3);
    expect(ring.position.z).toBeCloseTo(0.2);
    // The aerial lock lights it 1.5 m on, bigger: no frame moves it more than a third of the way, nor pops its size.
    let t = 10;
    let last = { x: ring.position.x, s: ring.scale.x };
    for (let i = 0; i < 30; i++) {
      set(45.8, 0.2, (t += 1 / 60), true);
      expect(Math.abs(ring.position.x - last.x)).toBeLessThan(0.5);
      expect(Math.abs(ring.scale.x - last.s)).toBeLessThan(0.1);
      last = { x: ring.position.x, s: ring.scale.x };
    }
    expect(ring.position.x).toBeCloseTo(45.8, 1);
    // A header sends it 12 m away: one ring, on its new spot at once (never swept across the grass).
    set(33.8, -4, (t += 1 / 60), true);
    expect(ring.position.x).toBeCloseTo(33.8);
    expect((v.group as Group).children.length).toBe(1);
  });

  it('a pass that makes him the active man takes its preview ring off him at once: one ring under him, his marker', () => {
    const v = bareView(9);
    const pw = v.previewW as Float32Array;
    pw[8] = pw[9] = 1;
    const rings = v.previewRings as (Group | null)[];
    rings[8] = (v.makePreviewRing as () => Group)();
    rings[9] = (v.makePreviewRing as () => Group)();
    MatchView.prototype.setPassPreview.call(v as never, -1, -1, 0, 0, 1 / 60);
    expect(pw[9]).toBe(0);
    expect(rings[9]!.visible).toBe(false);
    // (A team-mate who is not his man still fades out as before.)
    expect(pw[8]).toBeGreaterThan(0);
    expect(pw[8]).toBeLessThan(1);
  });
});
