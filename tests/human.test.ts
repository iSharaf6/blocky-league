import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { CHIP_VY, FINESSE_CURL, FINESSE_MIN_SPEED, interceptRisk, pickReceiver, CURL_SPIN } from '../src/sim/actions';
import { solveLob } from '../src/sim/ball';
import { crossingZ } from '../src/sim/actions';
import { BOX_DEPTH, BOX_W, DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent } from '../src/sim/types';

/** Open-play scenario with the human on side 0 and everyone parked out of the way. */
function scenario(seed: number): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[5]),
    away: makeTeam(PRESET_CLUBS[6]),
    halfLength: 150,
    difficulty: 2,
    humanSide: 0,
    seed,
  });
  m.phase = 'play';
  m.restart = null;
  m.phaseT = 0;
  m.drainEvents();
  // Park everyone along the far touchline so the scenario players have the pitch to themselves.
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
  const b = m.ball;
  b.reset(p.footX(), p.footZ());
  b.owner = p.idx;
  b.lastTouch = p.idx;
  b.lastTouchSide = p.side;
  m.active = p.idx;
  m.updateBallPath();
}

const pad = (mx: number, mz: number, extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, mx, mz, ...extra });

describe('human control', () => {
  it('passes go to the teammate the stick points at, even with a rough aim', () => {
    let ok = 0;
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const ang of [0, 0.8, 1.6, 2.4, -0.8, -1.6]) {
        for (const d of [10, 18, 26]) {
          const m = scenario(seed * 31 + d);
          const ad = m.attackDir(0);
          const c = m.players[6];
          const mate = m.players[9];
          const decoy = m.players[10];
          place(c, 0, 0);
          c.facing = ad > 0 ? 0 : Math.PI;
          const a = (ad > 0 ? 0 : Math.PI) + ang;
          place(mate, Math.cos(a) * d, Math.sin(a) * d);
          place(decoy, Math.cos(a + 1.3) * 14, Math.sin(a + 1.3) * 14);
          giveBall(m, c);
          // Stick ~15 degrees off the true line: players never aim perfectly.
          const sa = a + 0.26 * (seed % 2 ? 1 : -1);
          let got = false;
          for (let i = 0; i < 60 * 3.5 && !got; i++) {
            // Aim and press, then let go of the stick (assisted receive brings the mate to it).
            m.step(DT, i < 2 ? pad(Math.cos(sa), Math.sin(sa), { pass: i === 0 }) : EMPTY_PAD);
            if (m.ball.owner === mate.idx) got = true;
          }
          n++;
          if (got) ok++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`human pass accuracy ${ok}/${n}`);
    expect(ok / n).toBeGreaterThan(0.9);
  }, 60_000);

  it('a first-time shot or header from a cross is possible', () => {
    let shots = 0;
    let goals = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const m = scenario(seed * 7);
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const striker = m.players[9];
      const k = m.keeperOf(1)!;
      place(striker, gx - ad * 10.5, (seed % 3) - 1);
      place(k, gx - ad * 0.8, 0);
      m.active = striker.idx;
      // A cross whipped in from the right wing towards the striker's head.
      const cx = gx - ad * 6;
      const cz = HALF_W - 6;
      const b = m.ball;
      b.reset(cx, cz);
      const tx = striker.pos.x;
      const tz = striker.pos.z;
      const d = Math.hypot(tx - cx, tz - cz);
      const s = solveLob(d, 0.75 + d / 34, 1.4);
      b.vel.x = ((tx - cx) / d) * s.vh;
      b.vel.z = ((tz - cz) / d) * s.vh;
      b.vel.y = s.vy;
      b.pos.y = 0.25;
      b.lastTouch = m.players[8].idx;
      b.lastTouchSide = 0;
      m.passTarget = striker.idx;
      m.updateBallPath();
      const before = m.stats.shots[0];
      let pressed = false;
      for (let i = 0; i < 60 * 4 && m.phase === 'play'; i++) {
        const near = Math.hypot(b.pos.x - striker.pos.x, b.pos.z - striker.pos.z) < 3.5;
        const press = near && !pressed;
        if (press) pressed = true;
        m.step(DT, pad(0, 0, { shoot: press }));
      }
      if (m.stats.shots[0] > before) shots++;
      if (m.score[0] > 0) goals++;
    }
    // eslint-disable-next-line no-console
    console.log(`first-time finishes from crosses: ${shots}/${N} shots, ${goals} goals`);
    expect(shots).toBeGreaterThanOrEqual(N * 0.6);
  }, 60_000);

  it('headers are met in the air: the leap starts ~0.2-0.3 s before contact, so it is near the top of the jump', () => {
    // A high cross to the striker's head, for the human (who presses SHOOT as it arrives) and for the AI.
    const trial = (seed: number, human: boolean) => {
      const m = scenario(seed * 5 + (human ? 0 : 1));
      if (!human) (m.cfg as { humanSide: number }).humanSide = -1;
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      const striker = m.players[9];
      place(striker, gx - ad * 10.5, (seed % 3) - 1);
      place(m.keeperOf(1)!, gx - ad * 0.8, 0);
      if (human) m.active = striker.idx;
      const cx = gx - ad * 6;
      const cz = HALF_W - 6;
      const b = m.ball;
      b.reset(cx, cz);
      const d = Math.hypot(striker.pos.x - cx, striker.pos.z - cz);
      const sl = solveLob(d, 0.75 + d / 34, 2.25);
      b.vel.x = ((striker.pos.x - cx) / d) * sl.vh;
      b.vel.z = ((striker.pos.z - cz) / d) * sl.vh;
      b.vel.y = sl.vy;
      b.pos.y = 0.25;
      b.lastTouch = m.players[8].idx;
      b.lastTouchSide = 0;
      m.passTarget = striker.idx;
      m.updateBallPath();
      let takeoff = -1;
      let pressed = false;
      for (let i = 0; i < 60 * 3 && m.phase === 'play'; i++) {
        const near = Math.hypot(b.pos.x - striker.pos.x, b.pos.z - striker.pos.z) < 3.5;
        const press = human && near && !pressed;
        if (press) pressed = true;
        const was = striker.y;
        m.step(DT, pad(0, 0, { shoot: press }));
        if (was === 0 && striker.y > 0 && takeoff < 0) takeoff = i;
        const hit = m.drainEvents().find((e) => e.type === 'kick' && e.kind === 'header');
        if (hit && hit.type === 'kick' && m.ball.lastTouch === striker.idx) {
          return { lead: takeoff >= 0 ? (i - takeoff) * DT : -1, y: striker.y, ballY: hit.y };
        }
      }
      return null;
    };
    for (const human of [true, false]) {
      let n = 0;
      let good = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const r = trial(seed, human);
        if (!r) continue;
        n++;
        if (r.lead > 0.1 && r.lead < 0.36 && r.y > 0.3 && r.ballY > 1.8) good++;
      }
      // eslint-disable-next-line no-console
      console.log(`${human ? 'human' : 'AI'} headers met in the air: ${good}/${n}`);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(good / n).toBeGreaterThanOrEqual(0.7);
    }
  }, 60_000);

  it('a corner: PASS with no stick plays it short to the man who came for it; SHOOT whips in a driven cross', () => {
    const corner = (seed: number) => {
      const m = scenario(seed);
      m.players.forEach((p) => {
        const slot = m.slots[p.side][p.slot];
        const adp = m.attackDir(p.side);
        const x = p.side === 0 ? slot.x * 0.45 + 0.4 : slot.x * 0.3 - 0.62;
        place(p, x * HALF_L * adp, slot.z * HALF_W * 0.75 * adp);
      });
      const ad = m.attackDir(0);
      m.ball.reset(ad * HALF_L + ad * 1.2, 9);
      m.ball.lastTouchSide = 1;
      m.ball.lastTouch = m.players[13].idx;
      for (let i = 0; i < 60 * 3 && m.phase !== 'restart'; i++) m.step(DT, EMPTY_PAD);
      m.drainEvents();
      expect(m.restart?.kind).toBe('corner');
      return m;
    };
    let short = 0;
    for (const seed of [3, 9, 27, 41]) {
      const m = corner(seed);
      const r = m.restart!;
      const t = m.players[r.taker];
      // Someone has come short for it.
      const near = m.teamPlayers(0).filter((p) => p !== t && !p.isKeeper).map((p) => Math.hypot(p.pos.x - r.x, p.pos.z - r.z));
      expect(Math.min(...near)).toBeLessThan(12);
      let kick: MatchEvent | undefined;
      let pressed = false;
      for (let i = 0; i < 60 * 3 && !kick; i++) {
        const press = m.phaseT > 0.5 && !pressed;
        if (press) pressed = true;
        m.step(DT, pad(0, 0, { pass: press }));
        kick = m.drainEvents().find((e) => e.type === 'kick');
      }
      expect(kick && kick.type === 'kick' && kick.kind).toBe('pass');
      const to = m.passTarget;
      expect(to).toBeGreaterThanOrEqual(0);
      const q = m.players[to];
      expect(q.side).toBe(0);
      expect(Math.hypot(q.pos.x - r.x, q.pos.z - r.z)).toBeLessThan(12.5);
      let got = false;
      for (let i = 0; i < 60 * 3 && !got; i++) {
        m.step(DT, EMPTY_PAD);
        got = m.drainEvents().some((e) => e.type === 'control' && e.player === to);
      }
      if (got) short++;
    }
    expect(short).toBeGreaterThanOrEqual(3);
    // Driven (SHOOT) vs hung up (hold THROUGH): flatter and faster.
    for (const seed of [3, 9]) {
      const hit = (btn: 'shoot' | 'through') => {
        const m = corner(seed);
        let v: { hs: number; vy: number } | null = null;
        for (let i = 0; i < 60 * 8 && !v; i++) {
          const hold = m.phaseT > 0.4 && m.phaseT < 0.9;
          m.step(DT, hold ? pad(0, 0, { [btn]: true }) : EMPTY_PAD);
          if (m.drainEvents().some((e) => e.type === 'kick')) v = { hs: m.ball.hspeed(), vy: m.ball.vel.y };
        }
        return v!;
      };
      const driven = hit('shoot');
      const lofted = hit('through');
      expect(driven.hs).toBeGreaterThan(lofted.hs + 3);
      expect(driven.vy).toBeLessThan(lofted.vy);
    }
  }, 60_000);

  it('AI teammates make themselves available to the human carrier', () => {
    let total = 0;
    let samples = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const m = new Match({
        home: makeTeam(PRESET_CLUBS[5]),
        away: makeTeam(PRESET_CLUBS[6]),
        halfLength: 150,
        difficulty: 2,
        humanSide: 0,
        seed: seed * 13,
      });
      // Let the match run (the human idles) until we have the ball in open play.
      let held = 0;
      for (let i = 0; i < 60 * 120 && samples < seed * 3; i++) {
        m.step(DT, EMPTY_PAD);
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
        if (m.phase === 'halftime') m.continueSecondHalf();
        const o = m.ball.owner;
        if (m.phase === 'play' && o >= 0 && o === m.active && !m.ball.held && !m.players[o].isKeeper) held += DT;
        else held = 0;
        if (held > 1.2) {
          const c = m.players[o];
          let open = 0;
          for (const t of m.teamPlayers(0)) {
            if (t === c || t.isKeeper) continue;
            const d = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
            if (d < 6 || d > 32) continue;
            let near = Infinity;
            for (const q of m.teamPlayers(1)) near = Math.min(near, Math.hypot(q.pos.x - t.pos.x, q.pos.z - t.pos.z));
            if (near > 2.5 && interceptRisk(m, 0, c.pos.x, c.pos.z, t.pos.x, t.pos.z, 16) < 0.5) open++;
          }
          total += open;
          samples++;
          held = -3; // don't resample the same possession immediately
        }
      }
    }
    const avg = total / Math.max(1, samples);
    // eslint-disable-next-line no-console
    console.log(`open passing options for an idle human carrier: ${avg.toFixed(2)} (${samples} samples)`);
    expect(samples).toBeGreaterThan(5);
    expect(avg).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('corners load the box on both sides', () => {
    for (const seed of [3, 9, 27]) {
      const m = scenario(seed);
      // An attack in progress (side 0 camped in the final third), then it's knocked behind.
      m.players.forEach((p) => {
        const slot = m.slots[p.side][p.slot];
        const adp = m.attackDir(p.side);
        const x = p.side === 0 ? slot.x * 0.45 + 0.4 : slot.x * 0.3 - 0.62;
        place(p, x * HALF_L * adp, slot.z * HALF_W * 0.75 * adp);
      });
      const ad = m.attackDir(0);
      const gx = ad * HALF_L;
      m.ball.reset(gx + ad * 1.2, 9);
      m.ball.lastTouchSide = 1;
      m.ball.lastTouch = m.players[13].idx;
      for (let i = 0; i < 60 * 1.2; i++) m.step(DT, EMPTY_PAD);
      expect(m.phase === 'restart' || m.phase === 'out').toBe(true);
      expect(m.restart?.kind).toBe('corner');
      // Give them the usual couple of seconds (the human taker hasn't pressed anything).
      for (let i = 0; i < 60 * 3; i++) m.step(DT, EMPTY_PAD);
      const inBox = (p: Player) => Math.abs(p.pos.x - gx) < BOX_DEPTH && Math.abs(p.pos.z) < BOX_W / 2;
      const atk = m.teamPlayers(0).filter((p) => !p.isKeeper && inBox(p)).length;

      const def = m.teamPlayers(1).filter((p) => !p.isKeeper && inBox(p)).length;
      expect(atk).toBeGreaterThanOrEqual(5);
      expect(def).toBeGreaterThanOrEqual(5);
    }
  }, 60_000);
});

/**
 * Round 6: the human pass assist (pb2.js), the dribbling cut, and the chip / finesse finishes. Seeded,
 * so the rates are exact for this code; the bands are the design targets with a little room.
 */
describe('human assists and skill moves', () => {
  it('pb2.js: the human\'s forward passes are completed about as often as they should be (was ~33%)', () => {
    // The AI plays until our side has it in midfield, then the human pushes the stick forward and taps
    // PASS: completed (a teammate is next on it), intercepted, or out.
    const res: Record<string, number> = {};
    // (Round 12: 14 matches, not 12. The AI reads the human's ball later and closes its receiver rather than
    // running at it (ai.readDelay), so his passes resolve further up the pitch and fewer midfield situations fit
    // in a match: 188 in 12 matches, against the 200 the sample needs.)
    for (let seed = 1; seed <= 14; seed++) {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: 0, seed: seed * 101 + 7 });
      const cfg = m.cfg as { humanSide: number };
      let k = 0;
      const over = () => (m.phase as string) === 'fulltime';
      for (let tries = 0; k < 20 && tries < 120 && !over(); tries++) {
        cfg.humanSide = -1;
        let found = false;
        for (let f = 0; f < 1500 && !found; f++) {
          if (m.phase === 'halftime') m.continueSecondHalf();
          if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
          if (over()) break;
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
          const o = m.ball.owner;
          found = m.phase === 'play' && o >= 0 && m.players[o].side === 0 && !m.players[o].isKeeper && !m.ball.held && Math.abs(m.ball.pos.x) < 20 && f > 120;
        }
        if (!found) continue;
        const o = m.ball.owner;
        cfg.humanSide = 0;
        m.active = o;
        const fwd = m.attackDir(0);
        m.step(DT, pad(fwd, 0));
        m.step(DT, pad(fwd, 0));
        const k0 = m.kickId;
        for (let i = 0; i < 3; i++) m.step(DT, pad(fwd, 0, { pass: true }));
        let r = 'none';
        for (let i = 0; i < 200; i++) {
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
          if (m.phase !== 'play') {
            r = 'out';
            break;
          }
          const q = m.ball.owner;
          if (m.kickId !== k0 && q >= 0 && q !== o) {
            r = m.players[q].side === 0 ? 'ok' : 'int';
            break;
          }
        }
        res[r] = (res[r] ?? 0) + 1;
        k++;
      }
    }
    const n = Object.values(res).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(`human forward passes: ${JSON.stringify(res)} of ${n}`);
    expect(n).toBeGreaterThan(200);
    expect((res.ok ?? 0) / n).toBeGreaterThanOrEqual(0.72);
    expect((res.int ?? 0) / n).toBeLessThanOrEqual(0.24);
  }, 120_000);

  it('the pass assist prefers the open man to one with a defender in the lane or on his back', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const c = m.players[6];
      place(c, 0, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      giveBall(m, c);
      // Straight ahead but covered (a defender in the lane, another tight on him); 35 degrees off, free.
      const covered = m.players[9];
      const open = m.players[10];
      place(covered, ad * 20, 0);
      place(m.players[14], ad * 10, 0.4);
      place(m.players[15], ad * 21.2, 0.3);
      place(open, Math.cos(0.6) * 16 * ad, Math.sin(0.6) * 16);
      expect(pickReceiver(m, c, ad, 0, 'pass')).toBe(open.idx);
      // With the lane clear and his marker gone, the man the stick points at is the one.
      place(m.players[14], ad * 10, 12);
      place(m.players[15], ad * 21.2, 14);
      expect(pickReceiver(m, c, ad, 0, 'pass')).toBe(covered.idx);
      // Nobody ahead at all (everyone behind the ball after a kick-off): the open man out to the side (at most 95
      // degrees off the stick), not a ball rolled into space for the other side...
      m.teamPlayers(0).forEach((p, i) => {
        if (p !== c && !p.isKeeper) place(p, -ad * (6 + i), (i - 5) * 3);
      });
      place(m.players[8], -ad * 1, 18);
      expect(pickReceiver(m, c, ad, 0, 'pass')).toBe(m.players[8].idx);
      // ... and never a man BEHIND the stick (round 12: the stick straight ahead played a man at -119 degrees while
      // the covered winger stood 48 degrees off it).
      place(m.players[8], -ad * 3.5, 18);
      expect(pickReceiver(m, c, ad, 0, 'pass')).toBe(-1);
      place(m.players[8], -ad * 7, 18);
      expect(pickReceiver(m, c, ad, 0, 'pass')).toBe(-1);
    }
  });

  it('dribbling: a 90-degree cut takes ~0.25 s and keeps his pace (was 0.37-0.45 s, down to 3.5 m/s)', () => {
    const cut = (human: boolean) => {
      const m = scenario(9);
      if (!human) (m.cfg as { humanSide: number }).humanSide = -1;
      const p = m.players[6];
      place(p, -10, 0);
      p.facing = 0;
      giveBall(m, p);
      // The AI would steer him itself: drive his controls directly for the comparison.
      const drive = (x: number, z: number) => {
        if (human) m.step(DT, pad(x, z));
        else {
          p.wantX = x;
          p.wantZ = z;
          p.sprint = false;
          p.step(DT, true, false);
        }
      };
      for (let i = 0; i < 90; i++) drive(1, 0);
      let t = -1;
      let low = Infinity;
      for (let i = 0; i < 60 && t < 0; i++) {
        drive(0, 1);
        low = Math.min(low, p.speed());
        if (Math.atan2(p.vel.z, p.vel.x) > Math.PI / 2 - 0.17) t = (i + 1) / 60;
      }
      return { t, low, kept: m.ball.owner === p.idx };
    };
    const h = cut(true);
    // eslint-disable-next-line no-console
    console.log(`human 90-degree cut ${h.t.toFixed(2)} s, lowest ${h.low.toFixed(2)} m/s`);
    expect(h.t).toBeGreaterThan(0);
    expect(h.t).toBeLessThanOrEqual(0.3);
    expect(h.low).toBeGreaterThanOrEqual(4);
    expect(h.kept).toBe(true);
    // AI carriers keep their rounder turn (they steer smoothly anyway).
    expect(cut(false).t).toBeGreaterThan(h.t);
  });

  /** A 1v1: the human striker `dist` m out, the keeper `kOut` m off his line (coming out at `rush` m/s). */
  const oneOnOne = (seed: number, dist: number, kOut: number, rush: number) => {
    const m = scenario(seed);
    const ad = m.attackDir(0);
    const p = m.players[9];
    place(p, ad * (HALF_L - dist), 0);
    p.facing = ad > 0 ? 0 : Math.PI;
    const k = m.keeperOf(1)!;
    place(k, ad * (HALF_L - kOut), 0);
    k.vel.x = -ad * rush;
    giveBall(m, p);
    return { m, p, k, ad };
  };
  const finish = (m: Match) => {
    const g0 = m.score[0];
    const evs: MatchEvent[] = [];
    for (let i = 0; i < 200; i++) {
      m.step(DT, EMPTY_PAD);
      evs.push(...m.drainEvents());
      if (m.score[0] > g0) return { goal: true, evs };
      if (m.phase !== 'play') break;
      if (m.ball.owner >= 0 && m.ball.owner !== m.shooter) break;
    }
    return { goal: false, evs };
  };

  it('chip: SHOOT with THROUGH tapped during the charge (or SHOOT let go with THROUGH held) lifts it over a rushing keeper', () => {
    const N = 30;
    const rate = (dist: number, kOut: number, rush: number, how: 'plain' | 'tap' | 'hold') => {
      let g = 0;
      for (let s = 0; s < N; s++) {
        const { m, p } = oneOnOne(1 + s * 11, dist, kOut, rush);
        const kid = m.kickId;
        // (Round 7: the THROUGH tap fires the chip there and then, at the charge so far, so the strike can
        // come while SHOOT is still held: watch for it from the first frame.)
        const evs: MatchEvent[] = [];
        for (let i = 0; i < 14 && m.kickId === kid; i++) {
          const through = how === 'tap' ? i >= 6 && i < 10 : how === 'hold' ? i >= 9 : false;
          m.step(DT, pad(0, 0, { shoot: true, through }));
          evs.push(...m.drainEvents());
        }
        // The tap is the strike: it's away (after the wind-up) with SHOOT still held.
        if (how === 'tap') expect(m.kickId).not.toBe(kid);
        for (let i = 0; i < 12 && m.kickId === kid; i++) {
          m.step(DT, EMPTY_PAD);
          evs.push(...m.drainEvents());
        }
        const kick = evs.find((e) => e.type === 'kick');
        expect(kick?.type === 'kick' && kick.kind).toBe('shot');
        if (how !== 'plain') {
          // The kick event says so (commentary: "a delicate chip"), and it's lofted.
          expect(kick?.type === 'kick' && kick.style).toBe('chip');
          expect(m.shotStyle).toBe('chip');
          expect(m.ball.vel.y).toBeGreaterThan(CHIP_VY - 3);
          expect(m.ball.hspeed()).toBeLessThan(19);
          // (The THROUGH tap was the chip, not a through ball.)
          expect(evs.some((e) => e.type === 'kick' && e.kind === 'through')).toBe(false);
        } else expect(kick?.type === 'kick' && kick.style).toBeUndefined();
        expect(m.shooter).toBe(p.idx);
        if (finish(m).goal) g++;
      }
      return g / N;
    };
    const plain = rate(15, 7, 4, 'plain');
    const chip = rate(15, 7, 4, 'tap');
    const held = rate(14, 5, 4, 'hold');
    const setKeeper = rate(16, 1, 0, 'tap');
    // eslint-disable-next-line no-console
    console.log(`1v1, keeper rushing out: plain ${(plain * 100).toFixed(0)}% | chip ${(chip * 100).toFixed(0)}% (${(held * 100).toFixed(0)}% from 14 m, keeper 5 m out) | chip at a keeper on his line ${(setKeeper * 100).toFixed(0)}%`);
    expect(chip).toBeGreaterThan(plain + 0.2);
    expect(chip).toBeLessThanOrEqual(0.92);
    // (Round 7: solved against where the keeper will be, and struck on the THROUGH tap: 37% -> ~70%.)
    expect(held).toBeGreaterThanOrEqual(0.5);
    // Against a keeper set on his line it's a gift for him.
    expect(setKeeper).toBeLessThanOrEqual(0.15);
  }, 60_000);

  it('finesse: the stick diagonally at a corner on a placed shot curls it, slower but tidier', () => {
    let wide = 0;
    let goals = 0;
    const N = 30;
    for (let s = 0; s < N; s++) {
      let finSpeed = 0;
      for (const style of ['finesse', 'power'] as const) {
        const { m, ad } = oneOnOne(3 + s * 7, 16, 1.5, 0);
        const lat = s % 2 ? 1 : -1;
        const stick = pad(ad * Math.SQRT1_2, lat * Math.SQRT1_2);
        const kid = m.kickId;
        // Finesse: under 60% power (15 frames of charge, the bar filling in SHOOT_FULL_T = 0.5 s); the same
        // stick at 24 frames is a plain strike.
        for (let i = 0; i < (style === 'finesse' ? 15 : 24); i++) m.step(DT, { ...stick, shoot: true });
        const evs: MatchEvent[] = [];
        for (let i = 0; i < 12 && m.kickId === kid; i++) {
          m.step(DT, stick);
          evs.push(...m.drainEvents());
        }
        const kick = evs.find((e) => e.type === 'kick');
        if (style === 'power') {
          expect(kick?.type === 'kick' && kick.style).toBeUndefined();
          // (Slower than a strike: the full-power one from the same spot is well quicker.)
          expect(m.shotSpeed).toBeGreaterThan(finSpeed + 2);
          continue;
        }
        expect(kick?.type === 'kick' && kick.style).toBe('finesse');
        // Bent towards the corner the stick picked, by the finesse amount (less a touch of spin decay).
        const spin = -m.ball.spin.y * Math.sign(m.ball.vel.x) * lat;
        expect(spin).toBeGreaterThan(FINESSE_CURL * CURL_SPIN * 0.85);
        expect(spin).toBeLessThanOrEqual(FINESSE_CURL * CURL_SPIN + 1e-6);
        // Round 7: struck with some pace (at least FINESSE_MIN_SPEED; it used to be ~21 m/s, and saved).
        expect(m.shotSpeed).toBeGreaterThanOrEqual(FINESSE_MIN_SPEED);
        expect(m.shotSpeed).toBeLessThan(27);
        finSpeed = m.shotSpeed;
        const cross = crossingZ(m.ball.pos.x, m.ball.pos.y, m.ball.pos.z, m.ball.vel.x, m.ball.vel.y, m.ball.vel.z, m.ball.spin.y, ad * HALF_L);
        if (cross === null || Math.abs(cross) > GOAL_W / 2) wide++;
        if (finish(m).goal) goals++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`16 m finesse: ${goals}/${N} scored, ${wide} wide`);
    expect(wide / N).toBeLessThanOrEqual(0.15);
    expect(goals / N).toBeGreaterThanOrEqual(0.3);
  }, 60_000);

  it('the AI now and then chips a keeper who has rushed out at it', () => {
    let chips = 0;
    let shots = 0;
    for (let s = 0; s < 40; s++) {
      const { m, p } = oneOnOne(1 + s * 13, 15, 7, 4);
      (m.cfg as { humanSide: number }).humanSide = -1;
      p.ballT = 0;
      p.aiT = 0;
      for (let i = 0; i < 120 && m.phase === 'play'; i++) {
        m.step(DT, EMPTY_PAD);
        for (const e of m.drainEvents()) {
          if (e.type !== 'kick' || m.ball.lastTouch !== p.idx || m.shotKick !== m.kickId) continue;
          shots++;
          if (e.style === 'chip') chips++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`AI 1v1 against a rushing keeper: ${chips} chips in ${shots} shots`);
    expect(chips).toBeGreaterThanOrEqual(3);
    expect(chips).toBeLessThan(shots * 0.6);
  }, 60_000);
});

describe('round 7: human through balls', () => {
  it('THROUGH at goal with nobody running and a defender in the way plays it to the open man, not to the defender', () => {
    let feet = 0;
    const n = 6;
    for (let seed = 1; seed <= n; seed++) {
      const m = scenario(seed);
      const ad = m.attackDir(0);
      const c = m.players[6];
      place(c, -ad * 2, 0);
      c.facing = ad > 0 ? 0 : Math.PI;
      // Nobody of ours ahead: two midfielders square and one behind; a defender 9 m ahead, in the lane.
      place(m.players[7], -ad * 3, 12);
      place(m.players[8], -ad * 3, -12);
      place(m.players[5], -ad * 14, 2);
      place(m.players[16], ad * 7, 0.3);
      giveBall(m, c);
      for (let i = 0; i < 4; i++) m.step(DT, EMPTY_PAD);
      m.drainEvents();
      let kick: MatchEvent | undefined;
      for (let i = 0; i < 30 && !kick; i++) {
        m.step(DT, pad(ad, 0, { through: i === 0 }));
        kick = m.drainEvents().find((e) => e.type === 'kick');
      }
      expect(kick?.type).toBe('kick');
      // (Round 12: a THROUGH tap is a 'through' whatever its weight; with nobody to run onto it, driven to the open
      // man's feet. It used to register as a 'pass'.)
      if (kick?.type === 'kick' && kick.kind === 'through' && m.passTarget >= 0 && m.players[m.passTarget].side === 0) feet++;
    }
    // (It used to be rolled 18 m along the stick, straight to him.)
    expect(feet).toBe(n);
  });

  it('over whole matches, a human who taps THROUGH whenever he has it in their half keeps the ball (it was 39% / 54% intercepted)', () => {
    const st = { through: [0, 0, 0], pass: [0, 0, 0] } as Record<string, [number, number, number]>;
    for (let s = 0; s < 10; s++) {
      const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 2, humanSide: 0, seed: 700 + s * 11 });
      let pending: string | null = null;
      let awaiting = false;
      let owned = -1;
      let ownT = 0;
      let tapped = false;
      const resolve = (side: number) => {
        if (!pending) return;
        const a = (st[pending] ??= [0, 0, 0]);
        a[0]++;
        if (side === 0) a[1]++;
        else if (side === 1) a[2]++;
        pending = null;
      };
      for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 300; steps++) {
        const b = m.ball;
        const ad = m.attackDir(0);
        let p: Pad = EMPTY_PAD;
        if (m.phase === 'play' && b.owner >= 0 && b.owner === m.active && m.players[b.owner].side === 0 && !b.held) {
          if (owned !== b.owner) {
            owned = b.owner;
            ownT = 0;
            tapped = false;
          }
          ownT += DT;
          const c = m.players[b.owner];
          if (ownT > 0.35 && !tapped) {
            tapped = true;
            // In their half: THROUGH, the stick at goal or 30 degrees either side of it. In ours: a pass forward.
            if (c.pos.x * ad > -5) {
              const a = (((s + steps) % 3) - 1) * 0.5;
              p = pad(Math.cos(a) * ad, Math.sin(a), { through: true });
              awaiting = true;
            } else p = pad(ad, 0, { pass: true });
          }
        } else owned = -1;
        m.step(DT, p);
        for (const e of m.drainEvents()) {
          if (e.type === 'kick') {
            const k = m.players[b.lastTouch];
            if (pending && k) resolve(k.side);
            if (awaiting && k && k.side === 0) {
              pending = e.kind === 'through' ? 'through' : e.kind === 'pass' ? 'pass' : null;
              awaiting = false;
            }
          } else if (e.type === 'control') resolve(m.players[e.player].side);
          else if ((e.type === 'save' && e.caught) || e.type === 'claim') resolve(1);
          else if ((e.type === 'restart' && e.kind !== 'kickoff') || e.type === 'goal') resolve(-1);
        }
        if (m.phase === 'halftime') m.continueSecondHalf();
        if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
      }
    }
    const t = st.through;
    const all = [t[0] + st.pass[0], t[1] + st.pass[1], t[2] + st.pass[2]];
    // eslint-disable-next-line no-console
    console.log(`THROUGH presses: ${all[0]}, ${((all[1] / all[0]) * 100).toFixed(0)}% kept, ${((all[2] / all[0]) * 100).toFixed(0)}% to the opponent | played as through balls ${t[0]}: ${((t[1] / t[0]) * 100).toFixed(0)}% completed, ${((t[2] / t[0]) * 100).toFixed(0)}% intercepted`);
    expect(t[0]).toBeGreaterThan(20);
    expect(t[1] / t[0]).toBeGreaterThanOrEqual(0.55);
    expect(all[1] / all[0]).toBeGreaterThanOrEqual(0.55);
    expect(all[2] / all[0]).toBeLessThanOrEqual(0.35);
  }, 180_000); // ten full simulated matches; the assertions check play, not CPU speed
});
