import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CamZoom } from '../src/core/save';
import { playFocus } from '../src/game/camFocus';
import { KIT_MIN_DL, contrastAwayKit, kitLightnessGap, readKit, readsApart } from '../src/game/kitContrast';
import { BALL_OFS, FRAME_LEN, writeFrame } from '../src/game/replay';
import { grassLike, grassSafeKit, makeTeam, PRESET_CLUBS, resolveKitClash } from '../src/meta/data';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';
import { Footballer, PSTATE, type PoseInput } from '../src/render/characters';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';

/**
 * The broadcast camera must never "spaz": every frame of open play is a smooth glide (no velocity jumps,
 * no back-and-forth), whatever the ball, possession or the controlled player do, at every camera distance,
 * in landscape and portrait. Everything runs headless through CameraRig with a plain PerspectiveCamera.
 */

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const ZOOMS: CamZoom[] = ['wide', 'normal', 'close'];
/** Standing head height fed to the rig (MatchView.headTop on desktop). */
const TALL = 1.94;
/**
 * Hardest the look target / lens may accelerate in open play (m/s^2). The rig's own cap is 110; before the
 * fix a possession flip, a switch of player or a pitch-angle flip hit ~1800 (30 m/s in one frame).
 */
const MAX_ACC = 150;

interface Sample {
  t: number;
  p: THREE.Vector3;
  q: THREE.Vector3;
  cut: boolean;
  behind: boolean;
  play: boolean;
  ndcX: number;
  ndcY: number;
  /** Ball velocity on the ground (m/s). */
  bvx: number;
  bvz: number;
}

function newMatch(seed: number, humanSide: -1 | 0): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide, seed });
}

function newRig(aspect: number, zoom: CamZoom): { rig: CameraRig; cam: THREE.PerspectiveCamera } {
  const cam = new THREE.PerspectiveCamera(24, aspect, 0.5, 900);
  const rig = new CameraRig(cam);
  rig.setZoom(zoom);
  rig.setMode('broadcast');
  return { rig, cam };
}

/** The look target (the lens looks at it; recovered from the camera: 40 m along its view axis). */
function lookPoint(cam: THREE.PerspectiveCamera, rig: CameraRig, out: THREE.Vector3): THREE.Vector3 {
  // CameraRig exposes the ground focus; the lens direction gives the rest.
  cam.getWorldDirection(out);
  const k = cam.position.y / Math.max(1e-3, -out.y);
  out.multiplyScalar(k).add(cam.position);
  void rig;
  return out;
}

/** Waypoints for side 0's dribbler: into the box it attacks, along both touchlines, into its own box. */
function route(ad: number): [number, number][] {
  return [
    [ad * 20, 2], [ad * 40, 3], [ad * 34, 26], [0, 27.5], [-ad * 34, 27], [-ad * 41, -2], [-ad * 32, -26], [0, -27.5], [ad * 34, -26], [ad * 41, 1],
  ];
}

/**
 * Play `seconds` of a match at `fps` through the rig. `scripted`: the human (side 0) dribbles the route
 * at a sprint, passing every ~5 s and getting the ball back (a cut) when it has been lost for a while; the
 * sim plays everything else. Goals and half time restart play with a cut, as the session does.
 */
function drive(o: { seed: number; aspect: number; zoom: CamZoom; seconds: number; humanSide: -1 | 0; scripted?: boolean; fps?: number }): Sample[] {
  const m = newMatch(o.seed, o.humanSide);
  const { rig, cam } = newRig(o.aspect, o.zoom);
  const f = new Float32Array(FRAME_LEN);
  rig.players = f;
  writeFrame(m, f, 0);
  const fps = o.fps ?? 60;
  const rdt = 1 / fps;
  const pts = route(m.attackDir(0));
  const out: Sample[] = [];
  const look = new THREE.Vector3();
  const ball = new THREE.Vector3();
  let acc = 0;
  let time = 0;
  let wp = 0;
  let lostT = 0;
  let passT = 0;
  for (let fr = 0; fr < o.seconds * fps && m.phase !== 'fulltime'; fr++) {
    time += rdt;
    acc += rdt;
    let cut = false;
    while (acc >= DT - 1e-9) {
      acc -= DT;
      let pad: Pad = EMPTY_PAD;
      if (o.scripted && m.phase === 'play' && m.active >= 0) {
        const a = m.players[m.active];
        const mine = m.ball.owner === a.idx;
        let gx = m.ball.pos.x - a.pos.x;
        let gz = m.ball.pos.z - a.pos.z;
        if (mine) {
          const [wx, wz] = pts[wp % pts.length];
          if (Math.hypot(wx - a.pos.x, wz - a.pos.z) < 3.5) wp++;
          gx = wx - a.pos.x;
          gz = wz - a.pos.z;
        }
        const l = Math.hypot(gx, gz) || 1;
        passT += DT;
        const pass = mine && passT > 5.5;
        if (pass) passT = 0;
        pad = { ...EMPTY_PAD, mx: gx / l, mz: gz / l, sprint: true, pass };
        const ours = m.ball.owner >= 0 && m.players[m.ball.owner].side === 0;
        lostT = ours ? 0 : lostT + DT;
        if (lostT > 2.5 && m.ball.owner >= 0) {
          // Back to our nearest outfielder (a teleport: the camera cuts, as for any reset).
          lostT = 0;
          let best = m.teamPlayers(0).find((p) => !p.isKeeper)!;
          for (const p of m.teamPlayers(0)) {
            if (!p.isKeeper && Math.hypot(p.pos.x - m.ball.pos.x, p.pos.z - m.ball.pos.z) < Math.hypot(best.pos.x - m.ball.pos.x, best.pos.z - m.ball.pos.z)) best = p;
          }
          m.ball.reset(best.footX(), best.footZ());
          m.ball.owner = best.idx;
          m.ball.lastTouch = best.idx;
          m.ball.lastTouchSide = 0;
          m.active = best.idx;
          cut = true;
        }
      }
      m.step(DT, pad);
      for (const e of m.drainEvents()) if (e.type === 'setpiece') rig.softCut();
      if (m.phase === 'goal' && m.phaseT > 2) {
        m.resumeAfterGoal();
        cut = true;
      } else if (m.phase === 'halftime') {
        m.continueSecondHalf();
        cut = true;
      }
      writeFrame(m, f, time);
    }
    if (cut) rig.cut();
    rig.update(rdt, playFocus(m, f, TALL), time);
    cam.updateMatrixWorld();
    ball.set(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2]).project(cam);
    out.push({
      t: time, p: cam.position.clone(), q: lookPoint(cam, rig, look).clone(), cut: rig.justCut, behind: rig.behindActive,
      play: m.phase === 'play', ndcX: ball.x, ndcY: ball.y, bvx: f[BALL_OFS + 3], bvz: f[BALL_OFS + 5],
    });
  }
  return out;
}

interface Motion {
  /** Peak acceleration (m/s^2) of the lens and of its ground look point, open play and set pieces alike. */
  acc: number;
  /**
   * Swaying: a direction reversal of a lens / look-point coordinate, then another within 0.8 s, both bigger
   * than 0.5 m (the look point, and the lens sideways) or 1 m (the lens height and depth, ~2% of its 40-60 m
   * throw), while the ball itself did not reverse (a dribble back and forth, a pass back are followed).
   */
  wobbles: number;
  /**
   * Jitter: a coordinate darting out and back, i.e. one swing between two reversals that reaches > 4 m/s yet
   * lasts < 0.25 s, while the ball itself did not reverse (a save, a rebound, a pass back are followed). The
   * old possession / pitch flips did this at 30 m/s.
   */
  jitter: number;
  /** Frames of open play with the ball off the screen / all open-play frames. */
  off: number;
  frames: number;
}

/** Did the ball change direction by more than 90 degrees (both ways > 3 m/s) between samples i0 and i1? */
function ballReversed(s: Sample[], i0: number, i1: number): boolean {
  const a = Math.max(0, i0);
  for (let i = a; i <= i1; i++) {
    if (Math.hypot(s[i].bvx, s[i].bvz) < 3) continue;
    for (let j = i + 1; j <= i1; j++) {
      if (Math.hypot(s[j].bvx, s[j].bvz) >= 3 && s[i].bvx * s[j].bvx + s[i].bvz * s[j].bvz < 0) return true;
    }
  }
  return false;
}

/** Motion of the broadcast shots (not the over-the-shoulder set-piece lens), skipping the frames around a cut. */
function motion(s: Sample[]): Motion {
  let acc = 0;
  let lastCut = -99;
  const a = new THREE.Vector3();
  for (let i = 0; i < s.length; i++) {
    if (s[i].cut || s[i].behind) lastCut = i;
    if (i - lastCut < 3 || i < 2) continue;
    const dt = s[i].t - s[i - 1].t;
    for (const k of ['p', 'q'] as const) {
      a.copy(s[i][k]).addScaledVector(s[i - 1][k], -2).add(s[i - 2][k]).divideScalar(dt * dt);
      acc = Math.max(acc, a.length());
    }
  }
  let wobbles = 0;
  for (const k of ['p', 'q'] as const) {
    for (const ax of ['x', 'y', 'z'] as const) {
      const min = k === 'p' && ax !== 'x' ? 1 : 0.5;
      let ext: { i: number; v: number }[] = [];
      let dir = 0;
      for (let i = 1; i < s.length; i++) {
        if (s[i].cut || s[i].behind) {
          ext = [];
          dir = 0;
          continue;
        }
        const d = s[i][k][ax] - s[i - 1][k][ax];
        if (Math.abs(d) < 1e-5) continue;
        const nd = Math.sign(d);
        if (dir !== 0 && nd !== dir) {
          ext.push({ i: i - 1, v: s[i - 1][k][ax] });
          const n = ext.length;
          if (n >= 3) {
            const [e0, e1, e2] = [ext[n - 3], ext[n - 2], ext[n - 1]];
            if (s[e2.i].t - s[e0.i].t < 0.8 && Math.abs(e1.v - e0.v) > min && Math.abs(e2.v - e1.v) > min && !ballReversed(s, e0.i - 12, e2.i)) wobbles++;
          }
        }
        dir = nd;
      }
    }
  }
  let jitter = 0;
  for (const k of ['p', 'q'] as const) {
    for (const ax of ['x', 'y', 'z'] as const) {
      let dir = 0;
      let since = -1;
      let peak = 0;
      for (let i = 1; i < s.length; i++) {
        if (s[i].cut || s[i].behind) {
          dir = 0;
          since = -1;
          continue;
        }
        const v = (s[i][k][ax] - s[i - 1][k][ax]) / (s[i].t - s[i - 1].t);
        if (Math.abs(v) < 0.2) continue;
        if (Math.sign(v) !== dir) {
          if (since >= 0 && peak > 4 && s[i].t - s[since].t < 0.25 && !ballReversed(s, since - 12, i)) jitter++;
          dir = Math.sign(v);
          since = i;
          peak = 0;
        }
        peak = Math.max(peak, Math.abs(v));
      }
    }
  }
  let off = 0;
  let frames = 0;
  for (const q of s) {
    if (!q.play || q.behind) continue;
    frames++;
    if (Math.abs(q.ndcX) > 1 || Math.abs(q.ndcY) > 1) off++;
  }
  return { acc, wobbles, jitter, off, frames };
}

/** A synthetic open-play focus (no sim): the rig in isolation. */
function focusAt(bx: number, bz: number, extra: Partial<CamFocus> = {}): CamFocus {
  return { bx, by: 0, bz, bvx: 0, bvz: 0, ax: bx, az: bz, attack: 1, lean: 0, setPiece: null, hold: true, tall: TALL, ...extra };
}

/** Run a synthetic focus sequence (one per 60 Hz frame) and return the samples. */
function feed(aspect: number, zoom: CamZoom, frames: number, at: (i: number) => CamFocus): Sample[] {
  const { rig, cam } = newRig(aspect, zoom);
  const out: Sample[] = [];
  const look = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    const fi = at(i);
    rig.update(1 / 60, fi, i / 60);
    cam.updateMatrixWorld();
    out.push({ t: i / 60, p: cam.position.clone(), q: lookPoint(cam, rig, look).clone(), cut: rig.justCut, behind: false, play: true, ndcX: 0, ndcY: 0, bvx: fi.bvx, bvz: fi.bvz });
  }
  return out;
}

describe('broadcast camera: the inputs that used to jump are eased', { timeout: 60_000 }, () => {
  it('possession flip-flopping by the box (passes, loose balls, tackles) does not rock the shot', () => {
    for (const zoom of ZOOMS) {
      // Ball on the edge of the box; the side on the ball flips every 10 frames (+1, loose, -1, loose, ...).
      const s = feed(LANDSCAPE, zoom, 600, (i) => focusAt(32, 4, { lean: [1, 0, -1, 0][Math.floor(i / 10) % 4] }));
      const settled = s.slice(240);
      const xs = settled.map((q) => q.q.x);
      // Before: the look point swung ~5 m back and forth with every flip.
      expect(Math.max(...xs) - Math.min(...xs), zoom).toBeLessThan(0.3);
      expect(motion(s).wobbles, zoom).toBe(0);
      expect(motion(s).jitter, zoom).toBe(0);
    }
  });

  it('a real change of possession swings the lean over gently (~1 s), with no jolt', () => {
    const s = feed(LANDSCAPE, 'normal', 400, (i) => focusAt(30, 0, { lean: i < 150 ? 1 : -1 }));
    const m = motion(s);
    expect(m.acc).toBeLessThan(MAX_ACC);
    expect(m.wobbles).toBe(0);
    expect(m.jitter).toBe(0);
    // It does get there: the ~4.6 m lean towards the goal they were attacking (30 m out) is gone.
    expect(s[149].q.x - s[399].q.x).toBeGreaterThan(4);
  });

  it('a switch of controlled player 25 m away eases the framing over instead of jumping', () => {
    for (const aspect of [LANDSCAPE, PORTRAIT]) {
      const s = feed(aspect, 'normal', 300, (i) => focusAt(0, 0, { ax: i < 100 ? -12 : 13, az: 0 }));
      const m = motion(s);
      expect(m.acc).toBeLessThan(MAX_ACC);
      expect(m.wobbles).toBe(0);
      expect(m.jitter).toBe(0);
      const step = s.slice(100, 110).map((q, k, arr) => (k ? Math.abs(q.q.x - arr[k - 1].q.x) : 0));
      // Before: ~4.5 m of framing jump at 30 m/s (0.5 m a frame) the frame after the switch.
      expect(Math.max(...step)).toBeLessThan(0.12);
    }
  });

  it('play on the far side at the closer settings keeps one pitch angle (no 27 <-> 38 degree flips)', () => {
    for (const zoom of ['normal', 'close'] as CamZoom[]) {
      // The ball struck and stopped again and again out on the far side (the spot the lens used to lurch at).
      const s = feed(LANDSCAPE, zoom, 600, (i) => {
        const kicked = Math.floor(i / 30) % 2 === 1;
        return focusAt(-9 + Math.sin(i / 60) * 2, -13.6 + Math.cos(i / 45), { bvx: kicked ? 24 : 0 });
      });
      const m = motion(s);
      expect(m.acc, zoom).toBeLessThan(MAX_ACC);
      expect(m.wobbles, zoom).toBe(0);
      expect(m.jitter, zoom).toBe(0);
      // The lens height only breathes with the ball-speed dolly-out (a few %), never jumps.
      let dy = 0;
      for (let i = 1; i < s.length; i++) dy = Math.max(dy, Math.abs(s[i].p.y - s[i - 1].p.y));
      expect(dy, zoom).toBeLessThan(0.05);
    }
  });

  it('a carrier standing by the camera-side touchline stays above the bottom HUD band at every zoom', () => {
    // HEAD 2889c15: NORMAL at z = 26 put the ball at y 746 px of 720 (off screen), CLOSE at z = 22 at 790 px.
    // The HUD band starts at ~612 px (NDC -0.7); the framing keeps the ball and his feet above NDC -0.62.
    for (const zoom of ZOOMS) {
      for (const bz of [14, 18, 22, 26, 29]) {
        const { rig, cam } = newRig(LANDSCAPE, zoom);
        const v = new THREE.Vector3();
        for (let i = 0; i < 180; i++) rig.update(1 / 60, focusAt(-5, bz), i / 60);
        cam.updateMatrixWorld();
        const y = v.set(-5, 0, bz).project(cam).y;
        expect(y, `${zoom} z=${bz}`).toBeGreaterThan(-0.64);
        expect(y, `${zoom} z=${bz}`).toBeLessThan(0.5);
      }
    }
  });

  it('a ball hugging the near touchline stays on screen and the lens rises smoothly', () => {
    for (const zoom of ZOOMS) {
      const { rig, cam } = newRig(LANDSCAPE, zoom);
      const v = new THREE.Vector3();
      let worst = 0;
      const ys: number[] = [];
      for (let i = 0; i < 600; i++) {
        // The ball carried from mid-pitch out to the near touchline and along it.
        const bz = Math.min(29.5, i * 0.08);
        const bx = -30 + i * 0.1;
        rig.update(1 / 60, focusAt(bx, bz, { bvx: 6, bvz: i * 0.08 < 29.5 ? 4.8 : 0 }), i / 60);
        cam.updateMatrixWorld();
        if (i > 60) worst = Math.min(worst, v.set(bx, 0, bz).project(cam).y);
        ys.push(cam.position.y);
      }
      expect(worst, zoom).toBeGreaterThan(-0.85);
      let dy = 0;
      for (let i = 1; i < ys.length; i++) dy = Math.max(dy, Math.abs(ys[i] - ys[i - 1]));
      expect(dy, zoom).toBeLessThan(0.3);
    }
  });
});

describe('broadcast camera through real play', { timeout: 60_000 }, () => {
  const cases: { name: string; aspect: number; zoom: CamZoom }[] = [
    ...ZOOMS.map((zoom) => ({ name: `landscape ${zoom}`, aspect: LANDSCAPE, zoom })),
    ...ZOOMS.map((zoom) => ({ name: `portrait ${zoom}`, aspect: PORTRAIT, zoom })),
  ];

  for (const c of cases) {
    it(`${c.name}: a simulated match glides (no jolts, no oscillation)`, () => {
      const s = drive({ seed: c.aspect > 1 ? 7 : 11, aspect: c.aspect, zoom: c.zoom, seconds: 60, humanSide: -1 });
      const m = motion(s);
      expect(m.acc).toBeLessThan(MAX_ACC);
      expect(m.wobbles).toBe(0);
      expect(m.jitter).toBe(0);
      // The ball stays in the (narrow, on portrait) frame through open play.
      expect(m.off / m.frames).toBeLessThan(c.aspect > 1 ? 0.05 : 0.1);
    });

    it(`${c.name}: dribbling into both boxes and along both touchlines`, () => {
      const s = drive({ seed: 5, aspect: c.aspect, zoom: c.zoom, seconds: 60, humanSide: 0, scripted: true });
      const m = motion(s);
      expect(m.acc).toBeLessThan(MAX_ACC);
      expect(m.wobbles).toBe(0);
      expect(m.jitter).toBe(0);
      expect(m.off / m.frames).toBeLessThan(c.aspect > 1 ? 0.05 : 0.12);
    });
  }

  it('frame rate does not change the motion (30 and 144 Hz)', () => {
    for (const fps of [30, 144]) {
      const m = motion(drive({ seed: 5, aspect: LANDSCAPE, zoom: 'normal', seconds: 30, humanSide: 0, scripted: true, fps }));
      expect(m.acc, `${fps} Hz`).toBeLessThan(MAX_ACC);
      expect(m.wobbles, `${fps} Hz`).toBe(0);
      expect(m.jitter, `${fps} Hz`).toBe(0);
    }
  });
});

describe('footballer poses cross-fade between states (render)', { timeout: 60_000 }, () => {
  type Seg = { state: number; dur: number; speed: (t: number) => number; kick?: boolean };
  /** Biggest single-frame limb rotation (rad) in the first frames after each change of state, at 60 Hz. */
  function spike(seq: Seg[], keeper = false): number {
    const def = makeTeam(PRESET_CLUBS[5]).players[3];
    const fb = new Footballer(def, { shirt: 0xe0b23a, shirt2: 0x222222, pattern: 'plain', shorts: 0x222222, socks: 0xe0b23a, gk: 0xff8a2b }, keeper);
    const limbs = ['body', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
    const read = () => limbs.flatMap((k) => {
      const r = (fb as unknown as Record<string, THREE.Object3D>)[k].rotation;
      return [r.x, r.y, r.z];
    });
    let prev: number[] | null = null;
    let worst = 0;
    let t = 0;
    let phase = 0;
    seq.forEach((seg, si) => {
      for (let f = 0; f < Math.round(seg.dur * 60); f++) {
        const st = f / 60;
        const speed = seg.speed(st);
        phase = (phase + speed / 60 / 2.1) % 1;
        const p: PoseInput = {
          state: seg.state, stateT: st, speed, runPhase: phase, kickT: seg.kick ? Math.min(1, st / 0.34) : 0, kickLeg: 1,
          lean: 0.1, diveDir: 0, headerT: 0, celebrate: 0, y: 0, keeper, hasBall: false, look: 0.2, turn: 0, dt: 1 / 60,
        };
        fb.pose(p, t);
        t += 1 / 60;
        const cur = read();
        // Around each change of state (a keeper's first strides included: the sim gets him running in a few frames).
        const win = si > 0 ? (keeper ? 20 : 3) : 0;
        if (prev && f < win) for (let i = 0; i < cur.length; i++) worst = Math.max(worst, Math.abs(cur[i] - prev[i]));
        prev = cur;
      }
    });
    return worst;
  }

  it('getting up after a slide or a tackle, and a keeper setting off, never snap the limbs', () => {
    // HEAD 2889c15: 1.14, 1.33 and 0.91 rad in one frame.
    const run = (t: number) => Math.min(5, t * 12);
    expect(spike([{ state: PSTATE.slide, dur: 0.75, speed: (t) => Math.max(0, 7 - t * 9) }, { state: PSTATE.stand, dur: 0.38, speed: () => 0 }, { state: PSTATE.move, dur: 0.5, speed: run }])).toBeLessThan(0.3);
    expect(spike([{ state: PSTATE.move, dur: 0.3, speed: () => 7 }, { state: PSTATE.fallen, dur: 1.05, speed: (t) => Math.max(0, 5 - t * 8) }, { state: PSTATE.stand, dur: 0.38, speed: () => 0 }])).toBeLessThan(0.35);
    expect(spike([{ state: PSTATE.move, dur: 0.5, speed: () => 0 }, { state: PSTATE.move, dur: 0.6, speed: (t) => Math.min(6, t * 14) }], true)).toBeLessThan(0.3);
  });

  it('a strike out of a run or a sprint blends in no faster than the swing itself', () => {
    // HEAD 2889c15: 0.73 rad in one frame into a kick from a jog (the strike's own swing peaks ~0.55).
    expect(spike([{ state: PSTATE.move, dur: 0.4, speed: () => 4 }, { state: PSTATE.kick, dur: 0.34, speed: () => 3, kick: true }, { state: PSTATE.move, dur: 0.4, speed: () => 4 }])).toBeLessThan(0.5);
    expect(spike([{ state: PSTATE.move, dur: 0.5, speed: () => 8 }, { state: PSTATE.kick, dur: 0.34, speed: (t) => 8 - t * 10, kick: true }, { state: PSTATE.move, dur: 0.5, speed: () => 4 }])).toBeLessThan(0.5);
  });
});

describe('kit contrast (render / session)', () => {
  it('every preset fixture ends up with two sides that read apart from the gantry (light against dark)', () => {
    for (const H of PRESET_CLUBS) {
      for (const A of PRESET_CLUBS) {
        if (H === A) continue;
        const home = grassSafeKit(H.kit);
        const before = resolveKitClash(home, grassSafeKit(A.kit));
        const away = contrastAwayKit(home, before);
        const tag = `${H.short} v ${A.short}`;
        expect(readsApart(readKit(home), readKit(away)), tag).toBe(true);
        expect(kitLightnessGap(home, away), tag).toBeGreaterThanOrEqual(KIT_MIN_DL);
        // A change strip is never lawn-green (a kit left as it was keeps whatever grassSafeKit allowed).
        if (away !== before) expect(grassLike(away.shirt), tag).toBe(false);
      }
    }
  });

  it('a pairing that already reads apart is left alone', () => {
    const navy = { shirt: 0x223a78, shirt2: 0x223a78, pattern: 'plain' as const, shorts: 0x223a78, socks: 0x223a78, gk: 0xff8a2b };
    const white = { ...navy, shirt: 0xf6f4ec, shirt2: 0xf6f4ec, shorts: 0xf6f4ec, socks: 0xf6f4ec };
    expect(contrastAwayKit(navy, white)).toBe(white);
  });
});
