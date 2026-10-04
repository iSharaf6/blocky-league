import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clipSupported, ClipRecorder } from '../src/game/clip';
import { GHOST_MAX_PTS, flyGhost, lobLaunch, penaltyGhost, strikeLaunch, type GhostLaunch } from '../src/game/ghostArc';
import { PRESENTATION } from '../src/game/matchSession';
import { CameraRig, type CamFocus } from '../src/render/cameraRig';
import {
  HIT_STOP, PUSH_IN, PUSH_LEAN_M, SHAKE_MAX_PX, SHAKE_PX, Shake, TRAIL_FROM, TRAIL_FULL, ballFlashScale, endHeat, kickTrailStyle, trailStrength,
} from '../src/render/juice';
import { CutFlash, FLASH_MAX_S } from '../src/render/transition';
import { GOAL_H, GOAL_W, HALF_L } from '../src/sim/constants';

/**
 * Impact juice (render/juice.ts and what uses it): every impact the owner listed holds, shakes and flashes by a
 * set, visible amount, never more than the caps, and nothing of it touches the sim.
 */

const TALL = 1.94;

function focusAt(bx: number, bz: number, extra: Partial<CamFocus> = {}): CamFocus {
  return { bx, by: 0.2, bz, bvx: 0, bvz: 0, ax: bx, az: bz, attack: 1, lean: 0, setPiece: null, hold: true, tall: TALL, ...extra };
}

function newRig(aspect = 16 / 9): { rig: CameraRig; cam: THREE.PerspectiveCamera } {
  const cam = new THREE.PerspectiveCamera(24, aspect, 0.5, 900);
  const rig = new CameraRig(cam);
  rig.setZoom('normal');
  rig.setMode('broadcast');
  return { rig, cam };
}

/** Screen position (px, 1280 x 720) of world point p through `cam`. */
function screen(cam: THREE.PerspectiveCamera, p: THREE.Vector3, w = 1280, h = 720): { x: number; y: number } {
  cam.updateMatrixWorld();
  const v = p.clone().project(cam);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

describe('hit-stop: the owner\'s frame counts', () => {
  it('posts / bar 3 frames (2 for a soft knock), a slide that connects 3, a won tackle 2, a big save 2, a goal 3', () => {
    expect(HIT_STOP.post).toBe(3);
    expect(HIT_STOP.postSlow).toBe(2);
    expect(HIT_STOP.slide).toBe(3);
    expect(HIT_STOP.tackle).toBe(2);
    expect(HIT_STOP.save).toBe(2);
    expect(HIT_STOP.goal).toBe(3);
    // (The session reports the same numbers it runs.)
    expect(PRESENTATION.hitStopTackle).toBe(2);
    expect(PRESENTATION.hitStopGoal).toBe(3);
    expect(PRESENTATION.hitStopPost).toBe(3);
    expect(PRESENTATION.hitStopPostSlow).toBe(2);
    expect(PRESENTATION.hitStopSlide).toBe(3);
    expect(PRESENTATION.hitStopSave).toBe(2);
  });
});

describe('screen shake', () => {
  it('peaks at the jolt asked for, never over 8 px, and is gone within ~0.35 s', () => {
    for (const px of [SHAKE_PX.goal, SHAKE_PX.post, SHAKE_PX.tackleHeavy, 30]) {
      const sh = new Shake();
      sh.add(px);
      let peak = 0;
      let lastBig = 0;
      for (let i = 0; i < 60; i++) {
        const o = sh.update(1 / 60);
        const d = Math.hypot(o.x, o.y);
        peak = Math.max(peak, d);
        if (d > 1) lastBig = (i + 1) / 60;
      }
      expect(peak).toBeLessThanOrEqual(SHAKE_MAX_PX + 1e-9);
      expect(peak).toBeGreaterThan(Math.min(px, SHAKE_MAX_PX) * 0.45);
      expect(lastBig).toBeLessThan(0.36);
      expect(sh.amp).toBeLessThan(0.1);
    }
  });

  it('under reduced motion there is none at all', () => {
    const sh = new Shake();
    sh.enabled = false;
    sh.add(8);
    const o = sh.update(1 / 60);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });

  it('moves the whole broadcast picture by whole-screen pixels (the ball too), and never the framing itself', () => {
    const { rig, cam } = newRig();
    rig.viewH = 720;
    const ball = new THREE.Vector3(10, 0.2, 4);
    for (let i = 0; i < 90; i++) rig.update(1 / 60, focusAt(10, 4), i / 60);
    const still = screen(cam, ball);
    const pos0 = cam.position.clone();
    rig.shakePx(SHAKE_PX.goal);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 60, focusAt(10, 4), (90 + i) / 60);
      const s = screen(cam, ball);
      peak = Math.max(peak, Math.hypot(s.x - still.x, s.y - still.y));
      // (The lens itself doesn't move: nothing the follow or the tests' motion checks read is shaken.)
      expect(cam.position.distanceTo(pos0)).toBeLessThan(0.05);
    }
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThanOrEqual(SHAKE_MAX_PX + 0.5);
    // ...and it settles back to the same picture.
    for (let i = 0; i < 60; i++) rig.update(1 / 60, focusAt(10, 4), (120 + i) / 60);
    const after = screen(cam, ball);
    expect(Math.hypot(after.x - still.x, after.y - still.y)).toBeLessThan(0.6);
  });

  it('reduced motion turns the rig\'s shake and punch off', () => {
    const { rig, cam } = newRig();
    rig.setReducedMotion(true);
    const ball = new THREE.Vector3(0, 0.2, 0);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, focusAt(0, 0), i / 60);
    const still = screen(cam, ball);
    rig.shakePx(8);
    rig.kick(0.3);
    rig.update(1 / 60, focusAt(0, 0), 1);
    const s = screen(cam, ball);
    expect(Math.hypot(s.x - still.x, s.y - still.y)).toBeLessThan(0.05);
  });
});

describe('camera push-in on a big chance', () => {
  function run(chanceOn: (i: number) => number, frames: number): { d: number[]; tx: number[]; pos: THREE.Vector3[]; look: THREE.Vector3[] } {
    const { rig, cam } = newRig();
    const out = { d: [] as number[], tx: [] as number[], pos: [] as THREE.Vector3[], look: [] as THREE.Vector3[] };
    const dir = new THREE.Vector3();
    for (let i = 0; i < frames; i++) {
      rig.chance = chanceOn(i);
      rig.chanceGoal = 1;
      rig.update(1 / 60, focusAt(30, 2), i / 60);
      cam.getWorldDirection(dir);
      const k = cam.position.y / Math.max(1e-3, -dir.y);
      const look = dir.clone().multiplyScalar(k).add(cam.position);
      // (The width of pitch in shot at the look point: the lens's distance x its field of view.)
      out.d.push(cam.position.distanceTo(look) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
      out.tx.push(rig.focusX);
      out.pos.push(cam.position.clone());
      out.look.push(look);
    }
    return out;
  }

  it('pushes in at most 8% and leans at most 3 m towards the goal, then eases back to the plain shot', () => {
    const base = run(() => 0, 200);
    const push = run((i) => (i >= 60 && i < 120 ? 1 : 0), 260);
    const d0 = base.d[199];
    const dMin = Math.min(...push.d);
    expect(dMin).toBeGreaterThanOrEqual(d0 * (1 - PUSH_IN) - 0.3);
    // (A clear push: most of the 8%.)
    expect(dMin).toBeLessThan(d0 * (1 - PUSH_IN * 0.6));
    const lean = Math.max(...push.tx) - base.tx[199];
    expect(lean).toBeGreaterThan(1);
    expect(lean).toBeLessThanOrEqual(PUSH_LEAN_M + 0.3);
    // Back to the plain shot within ~2 s of the chance ending.
    expect(Math.abs(push.d[259] - d0)).toBeLessThan(d0 * 0.01);
  });

  it('is a glide: no acceleration past what the broadcast lens may do (150 m/s^2)', () => {
    const push = run((i) => (i >= 60 && i < 100 ? 1 : 0), 240);
    let acc = 0;
    const a = new THREE.Vector3();
    for (let i = 62; i < push.pos.length; i++) {
      for (const k of ['pos', 'look'] as const) {
        a.copy(push[k][i]).addScaledVector(push[k][i - 1], -2).add(push[k][i - 2]).multiplyScalar(3600);
        acc = Math.max(acc, a.length());
      }
    }
    expect(acc).toBeLessThan(150);
  });

  it('none under reduced motion', () => {
    const { rig, cam } = newRig();
    rig.setReducedMotion(true);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, focusAt(30, 2), i / 60);
    const f0 = cam.fov;
    rig.chance = 1;
    for (let i = 0; i < 60; i++) rig.update(1 / 60, focusAt(30, 2), (60 + i) / 60);
    expect(rig.chanceWeight).toBe(0);
    expect(cam.fov).toBeCloseTo(f0, 6);
  });

  it('never on a set piece framing', () => {
    const { rig } = newRig();
    rig.chance = 1;
    const piece = { x: 30, z: -20, tx: 40, tz: 0, corner: false };
    for (let i = 0; i < 60; i++) rig.update(1 / 60, focusAt(30, -20, { setPiece: piece }), i / 60);
    const a = rig.focusX;
    const { rig: r2 } = newRig();
    for (let i = 0; i < 60; i++) r2.update(1 / 60, focusAt(30, -20, { setPiece: piece }), i / 60);
    expect(Math.abs(a - r2.focusX)).toBeLessThan(1e-6);
  });
});

describe('ball juice', () => {
  it('the trail is nothing under 12 m/s, full from 30, and grows in between', () => {
    expect(trailStrength(0)).toBe(0);
    expect(trailStrength(TRAIL_FROM - 0.01)).toBe(0);
    expect(trailStrength(TRAIL_FULL)).toBe(1);
    expect(trailStrength(40)).toBe(1);
    let prev = 0;
    for (let v = TRAIL_FROM; v <= TRAIL_FULL; v += 1) {
      const k = trailStrength(v);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(trailStrength(21)).toBeGreaterThan(0.3);
    expect(trailStrength(21)).toBeLessThan(0.7);
  });

  it('headers, volleys and first-time strikes glow; long balls get the long trail; a plain strike is white', () => {
    expect(kickTrailStyle('header', 0.5, 1.8, true)).toBe('glow');
    expect(kickTrailStyle('shot', 0.8, 0.9, false)).toBe('glow');
    expect(kickTrailStyle('shot', 0.8, 0.22, true)).toBe('glow');
    expect(kickTrailStyle('shot', 0.8, 0.22, false)).toBe('strike');
    expect(kickTrailStyle('lob', 0.6, 0.22, false)).toBe('long');
    expect(kickTrailStyle('clear', 0.9, 0.22, false)).toBe('long');
    expect(kickTrailStyle('pass', 0.4, 0.22, false)).toBe('strike');
  });

  it('a hard strike pops the ball to 1.25x and back within ~80 ms', () => {
    expect(ballFlashScale(0)).toBeCloseTo(1.25, 5);
    expect(ballFlashScale(0.04)).toBeGreaterThan(1.1);
    expect(ballFlashScale(0.08)).toBe(1);
    expect(ballFlashScale(-1)).toBe(1);
  });
});

describe('crowd heat behind each goal', () => {
  it('murmurs far away, roars with a carrier in the box, and a carrier bearing down beats a loose ball', () => {
    expect(endHeat(60, true, false)).toBe(0);
    expect(endHeat(10, true, false)).toBeCloseTo(1, 5);
    expect(endHeat(25, true, false)).toBeGreaterThan(endHeat(25, false, true));
    expect(endHeat(25, false, true)).toBeGreaterThan(endHeat(25, false, false));
  });
});

describe('set-piece ghost arc (sim ball physics, no RNG)', () => {
  const L: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const path = new Float32Array(GHOST_MAX_PTS * 3);

  it('a free kick from 22 m arrives at the goal line where it is aimed, higher the harder it is struck', () => {
    const bx = HALF_L - 22;
    let lastH = -1;
    for (const p of [0.45, 0.7, 1]) {
      strikeLaunch(bx, 0.22, 3, HALF_L, 2.4, p, 0.8, L);
      const n = flyGhost(L, path);
      expect(n).toBeGreaterThan(4);
      // The dot at the goal line (interpolated).
      let hz = NaN;
      let hy = NaN;
      for (let i = 1; i < n; i++) {
        const x0 = path[(i - 1) * 3], x1 = path[i * 3];
        if (x0 < HALF_L && x1 >= HALF_L) {
          const u = (HALF_L - x0) / (x1 - x0);
          hz = path[(i - 1) * 3 + 2] + (path[i * 3 + 2] - path[(i - 1) * 3 + 2]) * u;
          hy = path[(i - 1) * 3 + 1] + (path[i * 3 + 1] - path[(i - 1) * 3 + 1]) * u;
        }
      }
      expect(Number.isFinite(hz)).toBe(true);
      expect(Math.abs(hz - 2.4)).toBeLessThan(0.5);
      expect(hy).toBeGreaterThan(0);
      expect(hy).toBeGreaterThan(lastH);
      lastH = hy;
    }
    // (A full-power one rises towards the bar, never miles over it.)
    expect(lastH).toBeLessThan(GOAL_H + 1.2);
  });

  it('a corner lands near where it is sent and flies over head height on the way', () => {
    lobLaunch(HALF_L, 0.22, -29.5, HALF_L - 8, 0, 0.7, false, L);
    const n = flyGhost(L, path);
    let top = 0;
    for (let i = 0; i < n; i++) top = Math.max(top, path[i * 3 + 1]);
    expect(top).toBeGreaterThan(2.5);
    // The first dot below 1.4 m after the apex is near the target.
    let land = -1;
    let rising = true;
    for (let i = 1; i < n; i++) {
      if (path[i * 3 + 1] < path[(i - 1) * 3 + 1]) rising = false;
      if (!rising && path[i * 3 + 1] < 1.4) {
        land = i;
        break;
      }
    }
    expect(land).toBeGreaterThan(0);
    expect(Math.hypot(path[land * 3] - (HALF_L - 8), path[land * 3 + 2])).toBeLessThan(3);
  });

  it('a shootout penalty goes where it is aimed inside the posts', () => {
    penaltyGhost(HALF_L - 10, 0.22, 0, HALF_L, -2.5, 0.6, 0.7, L);
    const n = flyGhost(L, path);
    const zs: number[] = [];
    for (let i = 0; i < n; i++) if (path[i * 3] > HALF_L - 1) zs.push(path[i * 3 + 2]);
    expect(zs.length).toBeGreaterThan(0);
    expect(Math.abs(zs[0] + 2.5)).toBeLessThan(0.6);
    expect(Math.abs(zs[0])).toBeLessThan(GOAL_W / 2);
  });
});

describe('replay transitions and clips', () => {
  it('the flash cut clears in at most 0.25 s', () => {
    const f = new CutFlash();
    f.play(0xffffff, 0.85, 1);
    expect(f.alpha).toBeGreaterThan(0.8);
    let t = 0;
    while (f.alpha > 0.004 && t < 1) {
      f.update(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThanOrEqual(FLASH_MAX_S + 1e-6);
    expect(f.mesh.visible).toBe(false);
  });

  it('a browser with no MediaRecorder simply has no clips (nothing throws)', () => {
    expect(clipSupported()).toBe(false);
    const r = new ClipRecorder();
    expect(r.start({} as HTMLCanvasElement, 'x.webm')).toBe(false);
    r.update(1);
    r.stop();
    expect(r.last).toBeNull();
  });
});

// ------------------------------------------------------------------ sound (a recording mock of WebAudio)

interface MockNode {
  kind: string;
  outs: unknown[];
  starts: number[];
  type?: string;
  [k: string]: unknown;
}

/** A WebAudio stand-in that records every node made, what it connects to and when sources start. */
function mockAudio(): { ctx: { currentTime: number }; nodes: MockNode[]; targets: { n: number }; AC: new () => unknown } {
  const nodes: MockNode[] = [];
  const targets = { n: 0 };
  const ctx = { currentTime: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    setTargetAtTime() { targets.n++; return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const node = (kind: string, extra: Record<string, unknown> = {}): MockNode => {
    const n: MockNode = {
      kind, outs: [], starts: [],
      connect(d: unknown) { n.outs.push(d); return d; },
      disconnect() { n.outs.length = 0; },
      start(t = 0) { n.starts.push(t); },
      stop() {},
      gain: param(), frequency: param(), Q: param(), pan: param(), playbackRate: param(),
      ...extra,
    };
    nodes.push(n);
    return n;
  };
  class AC {
    state = 'running';
    sampleRate = 8000;
    destination = node('destination');
    get currentTime() { return ctx.currentTime; }
    resume() { return Promise.resolve(); }
    createGain() { return node('gain'); }
    createDynamicsCompressor() { return node('compressor', { threshold: param(), ratio: param() }); }
    createBiquadFilter() { return node('filter'); }
    createOscillator() { return node('osc'); }
    createBufferSource() { return node('source'); }
    createConvolver() { return node('convolver'); }
    createStereoPanner() { return node('panner'); }
    createMediaStreamDestination() { return node('streamdest', { stream: { getAudioTracks: () => [] } }); }
    createBuffer(ch: number, len: number) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { length: len, getChannelData: (i: number) => data[i] };
    }
  }
  return { ctx, nodes, targets, AC };
}

describe('sound: layered, synthesised, cheap per frame', async () => {
  const { Sfx } = await import('../src/audio/sfx');
  const g = globalThis as { window?: unknown };

  function unlocked(): { s: InstanceType<typeof Sfx>; m: ReturnType<typeof mockAudio> } {
    const m = mockAudio();
    g.window = { AudioContext: m.AC };
    const s = new Sfx();
    s.unlock();
    s.setAmbienceActive(true);
    return { s, m };
  }
  const reverbIn = (m: ReturnType<typeof mockAudio>) => m.nodes.find((n) => n.kind === 'gain' && n.outs.some((o) => (o as MockNode).kind === 'convolver'));
  const wetCount = (m: ReturnType<typeof mockAudio>) => {
    const r = reverbIn(m);
    return m.nodes.filter((n) => n.outs.includes(r)).length;
  };

  it('the crowd behind each goal moves every frame without making a single node (and only touches params on a change)', () => {
    const { s, m } = unlocked();
    s.setStadium(0, 0);
    const n0 = m.nodes.length;
    const t0 = m.targets.n;
    for (let i = 0; i < 600; i++) {
      m.ctx.currentTime = i / 60;
      s.setEnds(0.5 + 0.5 * Math.sin(i / 90), 0.2);
      s.tick(1 / 60);
    }
    expect(m.nodes.length).toBe(n0);
    // Well under one automation call per param per frame.
    expect(m.targets.n - t0).toBeLessThan(600);
    // Two end beds, panned hard to their ends.
    const pans = m.nodes.filter((n) => n.kind === 'panner').map((n) => (n.pan as { value: number }).value);
    expect(pans.some((p) => p < -0.5)).toBe(true);
    expect(pans.some((p) => p > 0.5)).toBe(true);
  });

  it('a big, full ground sings now and then (nodes made only when a chant starts); so does a muddy park (the owner: "crowd chants non existent"); an empty ground never does', () => {
    const { s, m } = unlocked();
    s.setStadium(5, 1);
    const frames = new Set<number>();
    for (let i = 0; i < 60 * 90; i++) {
      m.ctx.currentTime = i / 60;
      const before = m.nodes.length;
      s.tick(1 / 60);
      if (m.nodes.length > before) frames.add(i);
    }
    expect(frames.size).toBeGreaterThanOrEqual(2);
    expect(frames.size).toBeLessThanOrEqual(12);
    // ROAD TO GLORY's first ground: level 0, a Sunday League gate (0.35 x 0.55 full).
    const park = unlocked();
    park.s.setStadium(0, 0.19);
    const p0 = park.m.nodes.length;
    for (let i = 0; i < 60 * 90; i++) {
      park.m.ctx.currentTime = i / 60;
      park.s.tick(1 / 60);
    }
    expect(park.m.nodes.length).toBeGreaterThan(p0);
    const empty = unlocked();
    empty.s.setStadium(0, 0);
    const n0 = empty.m.nodes.length;
    for (let i = 0; i < 60 * 90; i++) {
      empty.m.ctx.currentTime = i / 60;
      empty.s.tick(1 / 60);
    }
    expect(empty.m.nodes.length).toBe(n0);
  });

  it('a shot gets a room tail and an "oooh" on target; a header is a dry thock', () => {
    const { s, m } = unlocked();
    m.ctx.currentTime = 10;
    const w0 = wetCount(m);
    s.header(0.8);
    expect(wetCount(m)).toBe(w0);
    const c0 = m.nodes.length;
    s.shot(0.9, true);
    expect(wetCount(m)).toBeGreaterThan(w0);
    // The crowd's "oooh" is scheduled a beat after the strike.
    const later = m.nodes.slice(c0).filter((n) => n.kind === 'source' && n.starts.some((t) => t > 10.2));
    expect(later.length).toBeGreaterThan(0);
  });

  it('a goal is three beats: the net, then the crowd swelling, then the horn', () => {
    const { s, m } = unlocked();
    m.ctx.currentTime = 20;
    const c0 = m.nodes.length;
    s.goal();
    const made = m.nodes.slice(c0);
    const first = (pred: (n: MockNode) => boolean) => Math.min(...made.filter(pred).flatMap((n) => n.starts));
    const net = first((n) => n.kind === 'osc' && n.type === 'sine');
    const crowd = first((n) => n.kind === 'source' && n.starts[0] > 20.05);
    const horn = first((n) => n.kind === 'osc' && n.type === 'sawtooth');
    expect(net).toBeCloseTo(20, 5);
    expect(crowd).toBeGreaterThan(net);
    expect(horn).toBeGreaterThan(crowd);
    expect(horn - net).toBeGreaterThanOrEqual(0.4);
  });

  it('every impact sound plays without throwing (post clang, save and gasp, tackle thump and grunt, block)', () => {
    const { s, m } = unlocked();
    m.ctx.currentTime = 5;
    expect(() => {
      s.post(24);
      s.save(false, true);
      s.save(true, false);
      s.tackleHit(true);
      s.tackleHit(false);
      s.block(true);
      s.kick(0.6);
      s.chant();
    }).not.toThrow();
    // The clang is metallic: inharmonic partials, not a musical chord.
    const c0 = m.nodes.length;
    s.post(24);
    const osc = m.nodes.slice(c0).filter((n) => n.kind === 'osc');
    expect(osc.length).toBeGreaterThanOrEqual(4);
  });

  it('a clip can tap the match audio and lets go of it afterwards', () => {
    const { s, m } = unlocked();
    expect(s.captureStream()).not.toBeNull();
    const dest = m.nodes.find((n) => n.kind === 'streamdest');
    const comp = m.nodes.find((n) => n.kind === 'compressor')!;
    expect(comp.outs).toContain(dest);
    s.endCapture();
    delete g.window;
  });
});
