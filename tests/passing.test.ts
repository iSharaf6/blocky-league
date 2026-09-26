import { describe, expect, it } from 'vitest';
import { angleDiff } from '../src/core/math';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { humanPassSpread } from '../src/sim/actions';
import { DT, HALF_L, HALF_W, SPRINT_SPEED } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/**
 * Human passing assistance (Match.groundAssist / throughAssist), the body turn before the strike, the error
 * margin, auto switching and move assist: scripted-human scenarios, deterministic for a given seed.
 */

/** Open play with the human on side 0 and everyone parked along the far touchline, out of the way. */
function scenario(seed: number): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: 0, seed });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  m.players.forEach((p, i) => place(p, -40 + i * 3.6, -HALF_W + 1.5));
  return m;
}

function place(p: Player, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.setState('move');
  p.order = null;
}

function giveBall(m: Match, p: Player): void {
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });
const deg = (r: number) => (r * 180) / Math.PI;
const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));

/** Step until the first strike of the ball (or `max` frames): the kick event, the frame, the passer's facing then. */
function untilKick(m: Match, input: (i: number) => Pad, max = 60): { e: MatchEvent; i: number; facing: number; dir: number } | null {
  for (let i = 0; i < max; i++) {
    const kicker = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
    m.step(DT, input(i));
    const e = m.drainEvents().find((x) => x.type === 'kick');
    if (e) return { e, i, facing: (kicker ?? m.players[m.ball.lastTouch]).facing, dir: Math.atan2(m.ball.vel.z, m.ball.vel.x) };
  }
  return null;
}

describe('human pass assistance', () => {
  it('assisted: a tap with the stick 25 degrees off a free teammate 15 m away reaches him (stick still held after)', () => {
    let ok = 0;
    let n = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const m = scenario(seed * 17);
      const ad = m.attackDir(0);
      const c = m.players[6];
      const mate = m.players[9];
      place(c, 0, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      // All round him: ahead, either side, square, behind him.
      const a = c.facing + [0, 0.7, -0.7, 1.4, -1.4, 2.2][seed % 6];
      place(mate, Math.cos(a) * 15, Math.sin(a) * 15);
      giveBall(m, c);
      const sa = a + (seed % 2 ? 1 : -1) * ((25 * Math.PI) / 180);
      let got = false;
      // Tap PASS, and (as a casual player does) keep the stick held that way while the ball travels.
      for (let i = 0; i < 60 * 3.5 && !got; i++) {
        m.step(DT, pad(Math.cos(sa), Math.sin(sa), { pass: i < 2 }));
        got = m.drainEvents().some((e) => e.type === 'control' && e.player === mate.idx) || m.ball.owner === mate.idx;
      }
      n++;
      if (got) ok++;
    }
    // eslint-disable-next-line no-console
    console.log(`assisted tap, stick 25 deg off, 15 m: ${ok}/${n} reached`);
    expect(ok / n).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('the body turns to the man before the strike: a pass 120 degrees off his facing is struck square (within 20)', () => {
    const offs: number[] = [];
    const delays: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      for (const hold of [false, true]) {
        const m = scenario(seed * 13 + (hold ? 1 : 0));
        const c = m.players[6];
        const mate = m.players[8];
        place(c, 0, 0);
        c.facing = 0;
        const a = (seed % 2 ? 1 : -1) * ((120 * Math.PI) / 180);
        place(mate, Math.cos(a) * 15, Math.sin(a) * 15);
        giveBall(m, c);
        let charge = -1;
        let aim = -1;
        // A tap (2 frames), or held for 0.4 s: the stick straight at him.
        const frames = hold ? 24 : 2;
        const k = untilKick(m, (i) => {
          if (i === frames - 1) {
            charge = m.passCharge;
            aim = m.passAim;
          }
          return pad(Math.cos(a), Math.sin(a), { pass: i < frames });
        });
        expect(k).not.toBeNull();
        expect(k!.e.type === 'kick' && k!.e.kind).toBe('pass');
        expect(m.passTarget).toBe(mate.idx);
        // While it's held: locked onto him, the bar filling.
        expect(aim).toBe(mate.idx);
        if (hold) expect(charge).toBeGreaterThan(0.35);
        offs.push(Math.abs(angleDiff(k!.facing, k!.dir)));
        delays.push((k!.i + 1 - frames) * DT);
      }
    }
    const worst = Math.max(...offs);
    // eslint-disable-next-line no-console
    console.log(`120-degree pass: body ${deg(worst).toFixed(1)} deg off the line at worst at the strike; strike ${Math.max(...delays).toFixed(2)} s after release at worst`);
    expect(worst).toBeLessThan((20 * Math.PI) / 180);
    // It still goes promptly (the old strike came 0.11 s after the press).
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.3);
  }, 60_000);

  it('manual: the ball goes along the stick, not to the man 20 degrees off it (assisted: to him)', () => {
    const run = (level: 'manual' | 'assisted') => {
      const errs: number[] = [];
      let nearer = 0;
      let locked = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const m = scenario(seed * 29);
        m.groundAssist = level;
        const c = m.players[6];
        const mate = m.players[9];
        place(c, 0, 0);
        c.facing = 0;
        const ma = (seed % 2 ? 1 : -1) * 0.35;
        place(mate, Math.cos(ma) * 16, Math.sin(ma) * 16);
        giveBall(m, c);
        const k = untilKick(m, (i) => {
          if (i === 10 && m.passAim >= 0) locked++;
          return pad(1, 0, { pass: i < 12 });
        });
        const d = k!.dir;
        errs.push(angleDiff(0, d));
        if (Math.abs(angleDiff(0, d)) < Math.abs(angleDiff(Math.atan2(mate.pos.z, mate.pos.x), d))) nearer++;
      }
      return { errs, nearer, locked };
    };
    const man = run('manual');
    const ast = run('assisted');
    const mean = (xs: number[]) => xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length;
    // eslint-disable-next-line no-console
    console.log(`stick along +x, mate 20 deg off: manual ${deg(mean(man.errs)).toFixed(1)} deg off the stick (${man.nearer}/20 nearer the stick, locked ${man.locked}) | assisted ${deg(mean(ast.errs)).toFixed(1)} deg off it (locked ${ast.locked})`);
    expect(man.locked).toBe(0);
    expect(man.nearer).toBe(20);
    expect(mean(man.errs)).toBeLessThan((4 * Math.PI) / 180);
    expect(ast.locked).toBe(20);
    expect(mean(ast.errs)).toBeGreaterThan((12 * Math.PI) / 180);
  }, 60_000);

  it('error margin: a blind pass behind his back at a sprint sprays clearly more than a set, facing one', () => {
    // The formula itself: set and square vs flat out and facing the other way.
    const m0 = scenario(1);
    const c0 = m0.players[6];
    place(c0, 0, 0);
    c0.facing = 0;
    const set = humanPassSpread(m0, c0, 'assisted', 0, 0);
    const blind = humanPassSpread(m0, c0, 'assisted', Math.PI, SPRINT_SPEED);
    expect(blind / set).toBeGreaterThan(3.5);
    // In play (manual, so the stick is the intended line and every degree off it is error).
    const trial = (sprint: boolean, seed: number) => {
      const m = scenario(seed);
      m.groundAssist = 'manual';
      const c = m.players[6];
      place(c, -20, 0);
      c.facing = 0;
      giveBall(m, c);
      // Flat out along +x with the ball, then the stick flipped behind him and PASS tapped.
      if (sprint) for (let i = 0; i < 80; i++) m.step(DT, pad(1, 0, { sprint: true }));
      const want = sprint ? Math.PI : 0;
      const speed = c.speed();
      const k = untilKick(m, (i) => pad(Math.cos(want), Math.sin(want), { pass: i < 2, sprint }));
      return { err: angleDiff(want, k!.dir), speed };
    };
    const a: number[] = [];
    const b: number[] = [];
    let topSpeed = 0;
    for (let s = 1; s <= 40; s++) {
      a.push(trial(false, s * 7).err);
      const t = trial(true, s * 7);
      b.push(t.err);
      topSpeed += t.speed / 40;
    }
    // eslint-disable-next-line no-console
    console.log(`error margin sd: set & facing ${deg(sd(a)).toFixed(2)} deg | blind behind his back at ${topSpeed.toFixed(1)} m/s ${deg(sd(b)).toFixed(2)} deg (formula ratio ${(blind / set).toFixed(2)})`);
    expect(topSpeed).toBeGreaterThan(6);
    expect(sd(b)).toBeGreaterThan(sd(a) * 1.8);
  }, 60_000);
});

describe('auto switching and move assist', () => {
  /**
   * Our midfielder (the human's man) is goal-side of their carrier; our centre-back is 20 m behind him. The
   * ball is in their keeper's hands for a second (nothing to switch for), then a through ball is rolled past
   * the midfielder into the space behind, towards their runner, and the centre-back is the one to get there.
   */
  const throughAgainst = (seed: number, stick: (m: Match, mf: Player) => Pad = () => EMPTY_PAD, moveAssist = true) => {
    const m = scenario(seed);
    m.moveAssist = moveAssist;
    const ad = m.attackDir(0);
    const mf = m.players[6];
    const cb = m.players[2];
    const carrier = m.players[18];
    const runner = m.players[20];
    const k = m.keeperOf(1)!;
    const setup = () => {
      place(mf, -ad * 7, -3);
      place(cb, -ad * 26, -4);
      place(carrier, -ad * 5, 0);
      place(runner, -ad * 22, 8);
      runner.vel.x = -ad * 6;
    };
    setup();
    m.active = mf.idx;
    m.keeperHoldTime = 99;
    place(k, ad * (HALF_L - 2), 0);
    k.setState('hold');
    m.ball.reset(k.pos.x, k.pos.z);
    m.ball.owner = k.idx;
    m.ball.held = true;
    for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
    // The through ball.
    m.ball.held = false;
    k.setState('move');
    setup();
    const b = m.ball;
    b.reset(carrier.pos.x - ad * 0.6, 0);
    const tx = -ad * 32;
    const tz = 4;
    const d = Math.hypot(tx - b.pos.x, tz - b.pos.z);
    b.vel.x = ((tx - b.pos.x) / d) * 18.5;
    b.vel.z = ((tz - b.pos.z) / d) * 18.5;
    b.lastTouch = carrier.idx;
    b.lastTouchSide = 1;
    m.passTarget = runner.idx;
    m.updateBallPath();
    let at = -1;
    let to = -1;
    const speeds: number[] = [];
    for (let i = 0; i < 90; i++) {
      m.step(DT, stick(m, mf));
      if (at < 0 && m.active !== mf.idx) {
        at = (i + 1) * DT;
        to = m.active;
      }
      if (at >= 0 && (i + 1) * DT - at <= 0.5) speeds.push(m.players[to].speed());
    }
    return { m, at, to, cb, mf, speeds };
  };

  it('a through ball in behind switches to the man who gets there first, at once', () => {
    const lat: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const r = throughAgainst(seed * 5);
      expect(r.at).toBeGreaterThan(0);
      expect(r.to).toBe(r.cb.idx);
      lat.push(r.at);
    }
    // eslint-disable-next-line no-console
    console.log(`auto switch on a through ball: ${lat.map((t) => t.toFixed(2)).join(' ')} s after it was played`);
    expect(Math.max(...lat)).toBeLessThanOrEqual(1);
  }, 60_000);

  it('a loose ball a teammate is clearly first to switches to him (not only when the man is hopelessly far off)', () => {
    const lat: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const m = scenario(seed * 3);
      const me = m.players[6];
      const mate = m.players[7];
      const k = m.keeperOf(1)!;
      m.active = me.idx;
      m.keeperHoldTime = 99;
      const ad = m.attackDir(0);
      place(k, ad * (HALF_L - 2), 0);
      k.setState('hold');
      m.ball.reset(k.pos.x, k.pos.z);
      m.ball.owner = k.idx;
      m.ball.held = true;
      for (let i = 0; i < 60; i++) m.step(DT, EMPTY_PAD);
      m.ball.held = false;
      k.setState('move');
      // About a second away for him, a third of that for his teammate.
      place(me, -7, 0);
      place(mate, 0, 5);
      m.ball.reset(0, 0);
      m.ball.vel.z = 2;
      m.ball.lastTouch = m.players[15].idx;
      m.ball.lastTouchSide = 1;
      m.updateBallPath();
      let at = -1;
      for (let i = 0; i < 40 && at < 0; i++) {
        m.step(DT, EMPTY_PAD);
        if (m.active === mate.idx) at = (i + 1) * DT;
      }
      lat.push(at);
    }
    // eslint-disable-next-line no-console
    console.log(`loose ball, ~1.0 s away vs ~0.35 s: switched after ${lat.map((t) => t.toFixed(2)).join(' ')} s`);
    expect(Math.min(...lat)).toBeGreaterThan(0);
    expect(Math.max(...lat)).toBeLessThanOrEqual(0.3);
  }, 60_000);

  it('never away from the man the stick is running onto the ball', () => {
    // The human sprints his man at a loose ball; a teammate is clearly closer to it. While the stick
    // steers him in: no switch. Let go of the stick: it switches.
    const trial = (steer: boolean) => {
      const m = scenario(3);
      const me = m.players[6];
      const mate = m.players[7];
      const k = m.keeperOf(1)!;
      m.active = me.idx;
      m.keeperHoldTime = 99;
      const ad = m.attackDir(0);
      place(k, ad * (HALF_L - 2), 0);
      k.setState('hold');
      m.ball.reset(k.pos.x, k.pos.z);
      m.ball.owner = k.idx;
      m.ball.held = true;
      const spot = { x: 10, z: 0 };
      const toward = () => {
        const tx = spot.x - me.pos.x;
        const tz = spot.z - me.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        return pad(tx / tl, tz / tl, { sprint: true });
      };
      // A second of build-up (the ball in their keeper's hands): he's already running at the spot.
      place(me, -8, 0);
      for (let i = 0; i < 60; i++) {
        m.step(DT, toward());
        place(mate, 10, 7);
      }
      m.ball.held = false;
      k.setState('move');
      m.ball.reset(spot.x, spot.z);
      m.ball.vel.z = 2;
      m.ball.lastTouch = m.players[15].idx;
      m.ball.lastTouchSide = 1;
      m.updateBallPath();
      let switched = false;
      for (let i = 0; i < 30 && !switched; i++) {
        m.step(DT, steer ? toward() : EMPTY_PAD);
        switched = m.active !== me.idx;
      }
      return switched;
    };
    expect(trial(true)).toBe(false);
    expect(trial(false)).toBe(true);
  }, 60_000);

  it('move assist: the man switched to keeps making his run instead of stopping dead', () => {
    let on = 0;
    let off = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = throughAgainst(seed * 5, undefined, true);
      const b = throughAgainst(seed * 5, undefined, false);
      on += a.speeds.reduce((s, x) => s + x, 0) / a.speeds.length / 6;
      off += b.speeds.reduce((s, x) => s + x, 0) / b.speeds.length / 6;
    }
    // eslint-disable-next-line no-console
    console.log(`first 0.5 s after the switch: ${on.toFixed(1)} m/s with move assist, ${off.toFixed(1)} m/s without`);
    // (He starts from a standstill: ~4.5 m/s on average over the half-second is flat out from the switch.)
    expect(on).toBeGreaterThan(3.5);
    expect(off).toBeLessThan(on - 2);
  }, 60_000);

  it('move assist: off the ball with the stick left alone he follows his AI positioning at a jog', () => {
    const trial = (assist: boolean) => {
      const m = scenario(11);
      m.moveAssist = assist;
      // (Auto switch off: this is about the man he has, not about handing control to another.)
      m.autoSwitch = false;
      const ad = m.attackDir(0);
      // Their carrier in our half; the human's man (a centre-back) left standing upfield.
      const me = m.players[3];
      place(me, ad * 10, 6);
      const carrier = m.players[19];
      place(carrier, -ad * 12, 0);
      giveBall(m, carrier);
      m.active = me.idx;
      const x0 = me.pos.x;
      const z0 = me.pos.z;
      let maxSp = 0;
      for (let i = 0; i < 120; i++) {
        m.step(DT, EMPTY_PAD);
        // (The first half-second is the switch's own move assist, which runs as the AI would.)
        if (i > 40) maxSp = Math.max(maxSp, me.speed());
      }
      return { moved: Math.hypot(me.pos.x - x0, me.pos.z - z0), maxSp, jog: me.jog };
    };
    const a = trial(true);
    const b = trial(false);
    // eslint-disable-next-line no-console
    console.log(`idle 2 s off the ball: moved ${a.moved.toFixed(1)} m (top ${a.maxSp.toFixed(1)} m/s) with move assist, ${b.moved.toFixed(1)} m without`);
    expect(a.moved).toBeGreaterThan(4);
    expect(a.maxSp).toBeLessThanOrEqual(a.jog * 1.02);
    expect(b.moved).toBeLessThan(1);
  }, 60_000);
});

/**
 * A casual human over whole matches: when his man has had it a moment he aims roughly (up to 25 degrees
 * off) at a teammate 8-30 m away, taps PASS (or THROUGH at a forward making a run in their half) and keeps
 * the stick held that way while the ball travels; off the ball he leaves the stick alone. Outcome of each
 * ball: the next player to control it (ours or theirs), or out.
 */
export function casualHuman(
  seeds: number[], hold = true, setup?: (m: Match) => void,
): { pass: [number, number, number]; through: [number, number, number] } {
  const st = { pass: [0, 0, 0] as [number, number, number], through: [0, 0, 0] as [number, number, number] };
  for (const seed of seeds) {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: 0, seed });
    setup?.(m);
    let owned = -1;
    let ownT = 0;
    let aim: { x: number; z: number; btn: 'pass' | 'through'; t: number } | null = null;
    let pending: 'pass' | 'through' | null = null;
    let h = seed * 7919;
    const rnd = () => {
      h = (h * 1103515245 + 12345) % 2147483648;
      return h / 2147483648;
    };
    const resolve = (r: 0 | 1 | 2) => {
      if (!pending) return;
      st[pending][0]++;
      if (r === 0) st[pending][1]++;
      else if (r === 1) st[pending][2]++;
      pending = null;
    };
    for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 300; steps++) {
      const b = m.ball;
      const ad = m.attackDir(0);
      let p: Pad = EMPTY_PAD;
      const mine = m.phase === 'play' && b.owner >= 0 && b.owner === m.active && m.players[b.owner].side === 0 && !b.held && !m.players[b.owner].isKeeper;
      if (mine) {
        if (owned !== b.owner) {
          owned = b.owner;
          ownT = 0;
          aim = null;
        }
        ownT += DT;
        const c = m.players[b.owner];
        if (ownT > 0.4 && !aim) {
          // Pick a teammate: forward and free if there is one.
          let best: Player | null = null;
          let bs = -Infinity;
          let through = false;
          for (const t of m.teamPlayers(0)) {
            if (t === c || t.isKeeper || t.sentOff) continue;
            const d = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
            if (d < 8 || d > 30) continue;
            let near = Infinity;
            for (const o of m.teamPlayers(1)) near = Math.min(near, Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z));
            const run = t.vel.x * ad > 4 && t.pos.x * ad > 0 && c.pos.x * ad > -10;
            const s = ((t.pos.x - c.pos.x) * ad) / 10 + Math.min(near, 6) * 0.5 + rnd() * 2 + (run ? 1.5 : 0);
            if (s > bs) {
              bs = s;
              best = t;
              through = run;
            }
          }
          if (best) {
            const a = Math.atan2(best.pos.z - c.pos.z, best.pos.x - c.pos.x) + (rnd() * 2 - 1) * ((25 * Math.PI) / 180);
            aim = { x: Math.cos(a), z: Math.sin(a), btn: through ? 'through' : 'pass', t: 0 };
          }
        }
      } else owned = -1;
      if (aim) {
        aim.t++;
        if (mine || (hold && aim.t < 200)) p = pad(aim.x, aim.z, { [aim.btn]: aim.t <= 2 && mine });
        if (!mine && !hold) aim = null;
      }
      m.step(DT, p);
      for (const e of m.drainEvents()) {
        if (e.type === 'kick') {
          const k = m.players[b.lastTouch];
          if (pending && k) resolve(k.side === 0 ? 0 : 1);
          if (aim && k && k.side === 0 && k.idx === owned && (e.kind === 'pass' || e.kind === 'through')) pending = e.kind;
        } else if (e.type === 'control') {
          resolve(m.players[e.player].side === 0 ? 0 : 1);
          if (m.players[e.player].side === 0 && aim && !mine) aim = null;
        } else if ((e.type === 'save' && e.caught) || e.type === 'claim') resolve(1);
        else if ((e.type === 'restart' && e.kind !== 'kickoff') || e.type === 'goal') {
          resolve(2);
          aim = null;
        }
      }
      if (aim && m.ball.owner >= 0 && m.players[m.ball.owner].side === 1) aim = null;
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  return st;
}

describe('whole matches with a casual human', () => {
  it('passes tapped roughly at a teammate, stick still held, mostly arrive', () => {
    const st = casualHuman([11, 25, 39, 53, 67, 81]);
    const pc = (a: [number, number, number], i: number) => ((a[i] / Math.max(1, a[0])) * 100).toFixed(0);
    // eslint-disable-next-line no-console
    console.log(`casual human: ground ${st.pass[0]} passes, ${pc(st.pass, 1)}% completed, ${pc(st.pass, 2)}% intercepted | through ${st.through[0]}, ${pc(st.through, 1)}% completed, ${pc(st.through, 2)}% intercepted`);
    expect(st.pass[0]).toBeGreaterThan(150);
    expect(st.pass[1] / st.pass[0]).toBeGreaterThanOrEqual(0.8);
    expect(st.pass[2] / st.pass[0]).toBeLessThanOrEqual(0.16);
  }, 120_000);
});
