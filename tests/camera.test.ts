import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CamZoom } from '../src/core/save';
import { playFocus } from '../src/game/camFocus';
import { KIT_MIN_DL, contrastAwayKit, kitLightnessGap, readKit, readsApart } from '../src/game/kitContrast';
import { PRESENTATION } from '../src/game/matchSession';
import { MatchTally } from '../src/game/ratings';
import { BALL_OFS, FRAME_LEN, LUNGE_KICK_T0, LUNGE_S, LUNGE_STATE_T0, PF, STATE_CODE, writeFrame } from '../src/game/replay';
import { grassLike, grassSafeKit, makeTeam, PRESET_CLUBS, resolveKitClash } from '../src/meta/data';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';
import { ResolutionGovernor } from '../src/render/world';
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
    // It gets there, with the wider lens reaching the soft end-of-pitch limit sooner.
    expect(s[149].q.x - s[399].q.x).toBeGreaterThan(3.5);
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

describe('broadcast camera: locked on, and wide enough to see who to pass to', { timeout: 60_000 }, () => {
  /** Ball offset (px, 1280 x 720) between the lens and the shot the rig wants this frame. */
  function lagPx(rig: CameraRig, cam: THREE.PerspectiveCamera, want: THREE.PerspectiveCamera, x: number, y: number, z: number): number {
    const r = rig as unknown as { wantT: THREE.Vector3; wantP: THREE.Vector3 };
    want.fov = cam.fov;
    want.aspect = cam.aspect;
    want.position.copy(r.wantP);
    want.lookAt(r.wantT);
    want.updateProjectionMatrix();
    want.updateMatrixWorld();
    cam.updateMatrixWorld();
    const a = new THREE.Vector3(x, y, z).project(cam);
    const b = new THREE.Vector3(x, y, z).project(want);
    return Math.hypot(((a.x - b.x) * 1280) / 2, ((a.y - b.y) * 720) / 2);
  }

  it('a sprint dribble and a long pass are followed, not trailed', () => {
    // HEAD 709a690 ('normal', then 31.5 m wide): a sprint dribble trailed by ~93 px (2.3 m) all the way, a long
    // pass by 90 px (p50). Same width now (41 m) before / after: 69 -> ~14 px, 71 -> ~8 px.
    for (const zoom of ZOOMS) {
      for (const kind of ['sprint', 'pass'] as const) {
        const { rig, cam } = newRig(LANDSCAPE, zoom);
        const want = new THREE.PerspectiveCamera(24, LANDSCAPE, 0.5, 900);
        let x = -30, z = 4, y = 0, vx = 0, vz = 0, vy = 0;
        const lags: number[] = [];
        for (let i = 0; i < 60 * 6; i++) {
          const t = i / 60;
          if (kind === 'sprint') vx = t < 1 ? 0 : x > 36 ? 0 : Math.min(8, (t - 1) * 17);
          else {
            if (i === 60) { vx = 22; vz = -12; vy = 7; }
            const sp = Math.hypot(vx, vz);
            if (sp > 0 && y <= 0.01) { const d = Math.min(sp, (2.3 + 0.3 * sp) / 60); vx -= (vx / sp) * d; vz -= (vz / sp) * d; }
            if (y > 0 || vy > 0) vy -= 11.5 / 60;
            y = Math.max(0, y + vy / 60);
            if (y <= 0 && vy < 0) vy = 0;
          }
          x += vx / 60;
          z += vz / 60;
          rig.update(1 / 60, focusAt(x, z, { by: y, bvx: vx, bvz: vz, lean: 1 }), t);
          if (t > 1) lags.push(lagPx(rig, cam, want, x, y, z));
        }
        lags.sort((a, b) => a - b);
        const p50 = lags[Math.floor(lags.length / 2)];
        expect(p50, `${zoom} ${kind}`).toBeLessThan(zoom === 'close' ? 30 : 24);
      }
    }
  });

  it("'normal' shows most of the team building from the back and through midfield", () => {
    // HEAD 709a690's 'normal' (31.5 m of pitch across the screen): a median 5 of the 10 team-mates on screen,
    // p25 3. Now (41 m): a median 6, and at least 5 about three quarters of the time.
    const counts: number[] = [];
    for (const seed of [3, 7]) {
      const m = newMatch(seed, -1);
      const { rig, cam } = newRig(LANDSCAPE, 'normal');
      const f = new Float32Array(FRAME_LEN);
      rig.players = f;
      const v = new THREE.Vector3();
      let sample = 0;
      for (let fr = 0; fr < 150 * 60 && m.phase !== 'fulltime'; fr++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) if (e.type === 'setpiece') rig.softCut();
        if (m.phase === 'goal' && m.phaseT > 2) {
          m.resumeAfterGoal();
          rig.cut();
        } else if (m.phase === 'halftime') {
          m.continueSecondHalf();
          rig.cut();
        }
        writeFrame(m, f, fr / 60);
        rig.update(DT, playFocus(m, f, TALL), fr / 60);
        if (++sample % 6 || m.phase !== 'play' || rig.behindActive || rig.justCut) continue;
        const own = m.ball.owner;
        if (own < 0 || m.players[own].side !== 0 || m.ball.pos.x * m.attackDir(0) > 16) continue;
        cam.updateMatrixWorld();
        let n = 0;
        for (const p of m.teamPlayers(0)) {
          if (p.idx === own) continue;
          v.set(p.pos.x, 1, p.pos.z).project(cam);
          if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) n++;
        }
        counts.push(n);
      }
    }
    counts.sort((a, b) => a - b);
    expect(counts.length).toBeGreaterThan(200);
    expect(counts[Math.floor(counts.length / 2)]).toBeGreaterThanOrEqual(6);
    expect(counts.filter((n) => n >= 5).length / counts.length).toBeGreaterThan(0.65);
  });

  it('normal shows more passing options (~47 m at focus), with distinct wide and close settings', () => {
    const seen: Record<string, number> = {};
    for (const zoom of ZOOMS) {
      const { rig, cam } = newRig(LANDSCAPE, zoom);
      for (let i = 0; i < 120; i++) rig.update(1 / 60, focusAt(0, 0), i / 60);
      cam.updateMatrixWorld();
      // Metres of the ball's line across the screen (two points 10 m either side of the ball, projected).
      const l = new THREE.Vector3(-10, 0, 0).project(cam).x;
      const r = new THREE.Vector3(10, 0, 0).project(cam).x;
      seen[zoom] = (20 * 2) / (r - l);
    }
    const txt = JSON.stringify(seen);
    // 47 m at the look point, a few metres beyond the ball: ~43.6 m on the ball's own line.
    expect(seen.normal, txt).toBeGreaterThan(42);
    expect(seen.normal, txt).toBeLessThan(46);
    expect(seen.wide / seen.normal, txt).toBeGreaterThan(1.1);
    expect(seen.close / seen.normal, txt).toBeLessThan(0.82);
  });
});

describe('dynamic resolution (World.adapt)', () => {
  const feedDts = (g: ResolutionGovernor, seconds: number, dt: (i: number) => number): number[] => {
    const out: number[] = [];
    let t = 0;
    for (let i = 0; t < seconds; i++) {
      const d = dt(i);
      t += d;
      g.frame(d);
      out.push(g.ratio);
    }
    return out;
  };

  it('rAF jitter at 60 Hz (and 120 Hz falling back to 60) never costs resolution', () => {
    const g = new ResolutionGovernor(2);
    // Headless Chrome's vsync intervals: 15.2 .. 18.7 ms.
    const r = feedDts(g, 20, (i) => (i % 3 === 0 ? 0.0187 : i % 3 === 1 ? 0.0152 : 0.0161));
    expect(Math.min(...r)).toBe(2);
    const g2 = new ResolutionGovernor(2);
    expect(Math.min(...feedDts(g2, 10, (i) => (i % 2 ? 1 / 120 : 1 / 60)))).toBe(2);
  });

  it('a sudden load drops the pixel ratio within ~1.5 s and it is all back ~7 s after the load ends', () => {
    const g = new ResolutionGovernor(2);
    feedDts(g, 2, () => 1 / 60);
    // Every other frame dropped (a GPU just over budget at 60 Hz), for 3 s.
    const loaded = feedDts(g, 3, (i) => (i % 2 ? 1 / 30 : 1 / 60));
    const at = (arr: number[], s: number, dt: number) => arr[Math.min(arr.length - 1, Math.floor(s / dt))];
    expect(at(loaded, 1.6, 1 / 40)).toBeLessThanOrEqual(1.05);
    const low = g.ratio;
    expect(low).toBeGreaterThanOrEqual(0.6);
    const calm = feedDts(g, 10, () => 1 / 60);
    const back = calm.findIndex((r) => r >= 2);
    expect(back).toBeGreaterThan(0);
    expect(back / 60).toBeLessThan(9);
  });

  it('slow frames our own main-thread work explains (a busy CPU) cost no pixels: fewer would not help', () => {
    const g = new ResolutionGovernor(2);
    let t = 0;
    for (let i = 0; t < 6; i++) {
      const dt = i % 2 ? 1 / 30 : 1 / 60;
      t += dt;
      g.frame(dt, dt * 0.9);
    }
    expect(g.ratio).toBe(2);
  });

  it('a lone hitch (a GC pause) is ignored, and a raise that brings the stutter back is not tried again at once', () => {
    const g = new ResolutionGovernor(2);
    const r = feedDts(g, 10, (i) => (i === 300 ? 0.08 : 1 / 60));
    expect(Math.min(...r)).toBe(2);
    // A GPU that manages 60 Hz at ratio <= 1.2 only: it settles instead of sawing up and down.
    const g2 = new ResolutionGovernor(2);
    let changes = 0;
    let last = g2.ratio;
    let t = 0;
    for (let i = 0; t < 30; i++) {
      const dt = g2.ratio > 1.2 ? (i % 2 ? 1 / 30 : 1 / 60) : 1 / 60;
      t += dt;
      g2.frame(dt);
      if (g2.ratio !== last && t > 10) changes++;
      last = g2.ratio;
    }
    expect(g2.ratio).toBeLessThanOrEqual(1.2);
    expect(changes).toBeLessThanOrEqual(4);
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

  it('a strike reads at once: the first frame of a kick already shows ~half the strike pose', () => {
    // HEAD 709a690: an 0.08 s smoothstep showed 11% of it on the first frame and 38% on the second.
    const def = makeTeam(PRESET_CLUBS[5]).players[3];
    const kit = { shirt: 0xe0b23a, shirt2: 0x222222, pattern: 'plain' as const, shorts: 0x222222, socks: 0xe0b23a, gk: 0xff8a2b };
    const live = new Footballer(def, kit, false);
    const raw = new Footballer(def, kit, false);
    const limbs = ['body', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
    const read = (fb: Footballer) => limbs.flatMap((k) => {
      const r = (fb as unknown as Record<string, THREE.Object3D>)[k].rotation;
      return [r.x, r.y, r.z];
    });
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    const input = (state: number, st: number, speed: number, phase: number, dt: number): PoseInput => ({
      state, stateT: st, speed, runPhase: phase, kickT: state === PSTATE.kick ? Math.min(1, st / 0.34) : 0, kickLeg: 1,
      lean: 0.1, diveDir: 0, headerT: 0, celebrate: 0, y: 0, keeper: false, hasBall: true, look: 0.2, turn: 0, dt,
    });
    let t = 0;
    let phase = 0;
    for (let f = 0; f < 24; f++) {
      phase = (phase + 5 / 60 / 2.1) % 1;
      live.pose(input(PSTATE.move, f / 60, 5, phase, 1 / 60), t);
      raw.pose(input(PSTATE.move, f / 60, 5, phase, 1 / 60), t);
      t += 1 / 60;
    }
    const from = read(live);
    const progress: number[] = [];
    for (let f = 0; f < 4; f++) {
      live.pose(input(PSTATE.kick, f / 60, 4, phase, 1 / 60), t);
      // (dt 0: the pose as it is, no cross-fade: what the fade is heading for this frame.)
      raw.pose(input(PSTATE.kick, f / 60, 4, phase, 0), t);
      t += 1 / 60;
      const want = read(raw);
      progress.push(1 - dist(read(live), want) / Math.max(1e-6, dist(from, want)));
    }
    // (The head's own easing towards the ball keeps the last few % apart: that isn't the cross-fade.)
    expect(progress[0], progress.join(' ')).toBeGreaterThan(0.4);
    expect(progress[1], progress.join(' ')).toBeGreaterThan(0.75);
    expect(progress[3], progress.join(' ')).toBeGreaterThan(0.95);
  });

  it('a strike out of a run or a sprint blends in no faster than the swing itself', () => {
    // HEAD 2889c15: 0.73 rad in one frame into a kick from a jog (the strike's own swing peaks ~0.55).
    expect(spike([{ state: PSTATE.move, dur: 0.4, speed: () => 4 }, { state: PSTATE.kick, dur: 0.34, speed: () => 3, kick: true }, { state: PSTATE.move, dur: 0.4, speed: () => 4 }])).toBeLessThan(0.5);
    expect(spike([{ state: PSTATE.move, dur: 0.5, speed: () => 8 }, { state: PSTATE.kick, dur: 0.34, speed: (t) => 8 - t * 10, kick: true }, { state: PSTATE.move, dur: 0.5, speed: () => 4 }])).toBeLessThan(0.5);
  });
});

describe('action readability: tackles, slides, dives, pace (render / session)', () => {
  const kit = { shirt: 0xe0b23a, shirt2: 0x222222, pattern: 'plain' as const, shorts: 0x222222, socks: 0xe0b23a, gk: 0xff8a2b };
  const parts = (fb: Footballer) => fb as unknown as Record<'body' | 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR', THREE.Object3D>;
  const input = (state: number, st: number, speed: number, phase: number, dt: number, extra: Partial<PoseInput> = {}): PoseInput => ({
    state, stateT: st, speed, runPhase: phase, kickT: 0, kickLeg: 1,
    lean: 0.1, diveDir: 1, headerT: 0, celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0.2, turn: 0, dt, ...extra,
  });

  it("a TACKLE press is baked into the frame as the sim's own poke: live and replays lunge alike", () => {
    // Owner: "there is no animation for standing tackle whatsoever". The sim's 'tackleTry' fires before any
    // contact; the session writes the lunge into the frame for LUNGE_S, so a missed tackle lunges too.
    const m = newMatch(11, 0);
    for (let i = 0; i < 30; i++) m.step(DT, EMPTY_PAD);
    const f = new Float32Array(FRAME_LEN);
    const lunge = new Float32Array(22).fill(-1);
    const leg = new Float32Array(22).fill(1);
    const p = m.players.find((q) => q.state === 'move' && !q.isKeeper)!;
    lunge[p.idx] = 0.05;
    leg[p.idx] = -1;
    writeFrame(m, f, 1, lunge, leg);
    const o = p.idx * PF;
    expect(f[o + 4]).toBe(STATE_CODE.kick);
    expect(f[o + 9]).toBe(-2);
    expect(f[o + 5]).toBeCloseTo(LUNGE_STATE_T0 + 0.05, 5);
    expect(f[o + 8]).toBeCloseTo(LUNGE_KICK_T0 + 0.05 / 0.34, 5);
    // Everyone else untouched; and the lunge is over after LUNGE_S.
    for (const q of m.players) if (q.idx !== p.idx) expect(f[q.idx * PF + 4]).toBe(STATE_CODE[q.state] ?? 0);
    lunge[p.idx] = LUNGE_S + 0.01;
    writeFrame(m, f, 1, lunge, leg);
    expect(f[o + 4]).toBe(STATE_CODE.move);
    // The sim's own poke (a won tackle) is written the same way; a plain strike keeps its foot code.
    p.setState('kick');
    p.poke = true;
    p.kickLeg = 1;
    writeFrame(m, f, 1);
    expect(f[o + 9]).toBe(2);
    p.poke = false;
    writeFrame(m, f, 1);
    expect(f[o + 9]).toBe(1);
  });

  it('the standing tackle is a real lunge, all there within two frames of the press', () => {
    // HEAD 15ab47a: the poke was a 0.9 rad jab eased in over 0.06 s (a leg twitch nobody saw).
    const def = makeTeam(PRESET_CLUBS[5]).players[3];
    const fb = new Footballer(def, kit, false);
    let t = 0;
    let phase = 0;
    for (let f = 0; f < 24; f++) {
      phase = (phase + 5 / 60 / 2.1) % 1;
      fb.pose(input(PSTATE.move, f / 60, 5, phase, 1 / 60), t);
      t += 1 / 60;
    }
    const legs: number[] = [];
    const hips: number[] = [];
    const torso: number[] = [];
    for (let f = 0; f < 15; f++) {
      const st = LUNGE_STATE_T0 + f / 60;
      fb.pose(input(PSTATE.kick, st, 4, phase, 1 / 60, { kickT: LUNGE_KICK_T0 + (f / 60) / 0.34, kickLeg: 2 }), t);
      t += 1 / 60;
      const q = parts(fb);
      legs.push(q.legR.rotation.z);
      hips.push(q.body.position.y);
      torso.push(q.torso.rotation.z);
    }
    // Frame 1 already most of the way (the blend is all but a snap), frame 2 there: the leading leg out low
    // (> 1.2 rad), the hips dropped > 12 cm, the torso pitched forward.
    expect(legs[0], legs.join(' ')).toBeGreaterThan(0.9);
    expect(legs[1], legs.join(' ')).toBeGreaterThan(1.2);
    expect(hips[1], hips.join(' ')).toBeLessThan(5 * 0.075 - 0.12);
    expect(torso[1], torso.join(' ')).toBeLessThan(-0.5);
    // Held through the middle of the lunge, back out by its end.
    expect(legs[6]).toBeGreaterThan(1.2);
    expect(legs[14]).toBeLessThan(0.5);
  });

  it('a slide is laid out long and low, and a keeper dives at full stretch', () => {
    const def = makeTeam(PRESET_CLUBS[5]).players[3];
    const fb = new Footballer(def, kit, false);
    fb.pose(input(PSTATE.slide, 0.3, 6, 0.2, 0), 1);
    let q = parts(fb);
    expect(q.legR.rotation.z).toBeGreaterThan(1);
    expect(q.body.rotation.z).toBeGreaterThan(1.1);
    expect(q.body.position.y).toBeLessThan(0.16);
    const gk = new Footballer(makeTeam(PRESET_CLUBS[5]).players[0], kit, true);
    gk.pose(input(PSTATE.dive, 0.3, 4, 0, 0, { keeper: true, diveDir: 1 }), 1);
    q = parts(gk);
    expect(Math.abs(q.body.rotation.x)).toBeGreaterThan(1.4);
    expect(q.armL.rotation.z).toBeGreaterThan(2.9);
    expect(Math.abs(q.legL.rotation.x - q.legR.rotation.x)).toBeGreaterThan(0.6);
  });

  it('presentation dead time is short: intro <= 2.5 s, replay <= 6 s and rolling within 3 s of the goal', () => {
    // HEAD 15ab47a: a 3.4 s fly-in, the replay at 3.6 s, then ~10 s of replay (3.3 s lead, 1.3 s tail, 0.36x
    // slow-mo from 1.6 s out): ~13.7 s a goal before the kick-off framing. Now ~2.6 + 5.6 s.
    const P = PRESENTATION;
    expect(P.introS).toBeLessThanOrEqual(2.5);
    expect(P.replayAtS).toBeLessThanOrEqual(3);
    expect(P.goalWideS).toBeLessThan(1);
    const replayWall = (P.replayLeadS - P.slowFromS) / P.buildRate + (P.slowFromS + P.replayTailS) / P.slowRate;
    expect(replayWall).toBeLessThanOrEqual(6);
    expect(P.halftimeHoldS).toBeLessThanOrEqual(1.2);
    expect(P.hitStopTackle).toBe(2);
    expect(P.hitStopGoal).toBe(3);
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

describe('match ratings follow the man, not the slot (session / game/ratings.ts)', () => {
  it("a substitute inherits nothing; the man he replaced keeps his goals and stays man of the match", () => {
    const m = newMatch(3, 0);
    const t = new MatchTally();
    const striker = m.teamPlayers(0).find((p) => p.role === 'FW')!;
    const slot = striker.slot;
    const offName = striker.def.name;
    t.get(striker.idx).goals += 2;
    t.get(striker.idx).shots += 3;
    // Somebody else's assist stays his own too.
    const mid = m.teamPlayers(0).find((p) => p.role === 'MF')!;
    t.get(mid.idx).assists += 1;
    if (!m.bench[0].some((p) => p.role !== 'GK')) m.bench[0].push({ ...striker.def, id: 'test-sub', name: 'Test Sub', number: 99 });
    const benchIdx = m.bench[0].findIndex((p) => p.role !== 'GK');
    expect(m.substitute(0, slot, benchIdx)).toBe(true);
    const e = m.drainEvents().find((x) => x.type === 'sub');
    expect(e && e.type === 'sub' && e.off === offName && e.slot === slot).toBe(true);
    // (What the session does on the 'sub' event.)
    const on = m.teamPlayers(0)[slot];
    expect(on.idx).toBe(striker.idx);
    t.sub(on.idx, offName, 0, on.isKeeper, on.role === 'DF');
    t.get(on.idx).passes += 4;
    m.score[0] = 2;
    const r = t.ratings(m);
    const sub = r.find((x) => x.name === on.def.name)!;
    const gone = r.find((x) => x.name === offName)!;
    expect(sub.goals).toBe(0);
    expect(sub.rating).toBeLessThan(7);
    expect(gone.goals).toBe(2);
    expect(gone.rating).toBeGreaterThan(sub.rating);
    expect(r[0].name).toBe(offName);
    expect(r.find((x) => x.idx === mid.idx)!.assists).toBe(1);
    // Everyone on the pitch is still rated (22), plus the man who went off.
    expect(r.length).toBe(23);
  });
});
