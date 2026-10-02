import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, DEFAULT_PAD, KEY_ACTIONS, PAD_ACTIONS, actionKey, normalizeKeyMap, normalizePadMap } from '../src/core/input';
import { matchXp, SKILL_GOAL_XP, type MatchSummary } from '../src/core/save';
import { BALL_OFS, FRAME_LEN, PF, STATE_CODE, writeFrame } from '../src/game/replay';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { decodeInput, encodeInput, quantizePad } from '../src/net/lockstep';
import { NET_VERSION } from '../src/net/setup';
import { DT, HALF_W } from '../src/sim/constants';
import { carrierGuard } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import {
  COMBO_T, PERFECT_BEAT_MIN, PERFECT_GRACE, SKILL_CODE, SKILL_COOL, SKILL_EXPOSED, SKILL_STAMINA, SKILL_T, skillGoal, skillKind, startTell,
  telegraphs, tellTime,
} from '../src/sim/skills';
import type { MatchEvent } from '../src/sim/types';
import { botSeries, fmtBot } from './humanBot';

/**
 * SKILL moves (src/sim/skills.ts): the button picks a move off the stick, a press timed into a defender's tell is a
 * PERFECT, anything else is a GOOD on a roll at best, a cooldown and stamina keep it honest, and none of it reaches a
 * match without a human in it.
 */

/** Open play, the human on side 0, everyone parked along the far touchline (as tests/dribble.test.ts). */
function scenario(seed: number, difficulty = 1.8): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty, humanSide: 0, seed });
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

/** Our dribbler jogging along +x from x0, up to speed (he's had it a while: no first-touch guard). */
function runUp(m: Match, x0 = -12, frames = 45): Player {
  const p = m.players[9];
  place(p, x0, 0);
  p.facing = 0;
  giveBall(m, p);
  for (let i = 0; i < frames; i++) m.step(DT, pad(1, 0));
  p.ballT = 2;
  m.drainEvents();
  return p;
}

/** Step `n` frames with this pad, collecting the events. */
function steps(m: Match, n: number, pd: Pad, evs: MatchEvent[] = []): MatchEvent[] {
  for (let i = 0; i < n; i++) {
    m.step(DT, pd);
    evs.push(...m.drainEvents());
  }
  return evs;
}

/** A defender `ahead` m in front of the dribbler, facing him. */
function defenderAhead(m: Match, p: Player, ahead = 2.2): Player {
  const o = m.players[14];
  place(o, p.pos.x + ahead, p.pos.z + 0.2);
  o.facing = Math.PI;
  return o;
}

const moveOf = (evs: MatchEvent[]) => evs.find((e): e is Extract<MatchEvent, { type: 'skillMove' }> => e.type === 'skillMove');

describe('SKILL: the stick picks the move', () => {
  it('neutral: stepover; along the run: rainbow flick; across it: roulette (to that side); back: drag back', () => {
    expect(skillKind(1, 0, 0, 0).kind).toBe('stepover');
    expect(skillKind(1, 0, 1, 0.3).kind).toBe('rainbow');
    expect(skillKind(1, 0, 0, 1)).toEqual({ kind: 'roulette', turn: 1 });
    expect(skillKind(1, 0, 0.2, -1)).toEqual({ kind: 'roulette', turn: -1 });
    expect(skillKind(1, 0, -1, 0.2).kind).toBe('dragback');
    // Relative to his run, not the screen: running up the pitch (+z), +x is across.
    expect(skillKind(0, 1, 1, 0).kind).toBe('roulette');
    expect(skillKind(0, 1, 0, -1).kind).toBe('dragback');
  });
});

describe('SKILL: each move', () => {
  it('ROULETTE: he slips about a metre and a bit to the stick side, keeping the ball (nobody near: a show-off move)', () => {
    const base = scenario(11);
    const b0 = runUp(base);
    steps(base, 30, pad(1, 0));
    const m = scenario(11);
    const p = runUp(m);
    const evs = steps(m, 1, pad(0, 1, { skill: true }));
    steps(m, 29, pad(1, 0), evs);
    const mv = moveOf(evs);
    expect(mv).toMatchObject({ move: 'roulette', grade: 'show', combo: 0, on: -1 });
    expect(p.pos.z - b0.pos.z).toBeGreaterThan(0.9);
    expect(p.pos.z - b0.pos.z).toBeLessThan(1.8);
    expect(m.ball.owner).toBe(p.idx);
    // A show-off move: no protection, no 'skill' (nothing for the challenge or the chain).
    expect(p.protectT).toBe(0);
    expect(evs.some((e) => e.type === 'skill')).toBe(false);
  });

  it('RAINBOW FLICK: up over head height, down a few metres on, and he runs onto it', () => {
    const m = scenario(12);
    const p = runUp(m);
    const x0 = p.pos.x;
    const evs = steps(m, 1, pad(1, 0, { skill: true }));
    let top = 0;
    let back = -1;
    for (let i = 0; i < 150 && back < 0; i++) {
      m.step(DT, pad(0, 0));
      evs.push(...m.drainEvents());
      top = Math.max(top, m.ball.pos.y);
      if (m.ball.owner === p.idx && i > 20) back = i;
    }
    expect(moveOf(evs)?.move).toBe('rainbow');
    expect(top).toBeGreaterThan(1.9);
    expect(back).toBeGreaterThan(0);
    // Taken back on the run, well up the pitch.
    expect(p.pos.x - x0).toBeGreaterThan(4);
  });

  it('STEPOVER: the feint where he stands, ball kept; DRAG BACK: he turns back the way he came with it', () => {
    const m = scenario(13);
    const p = runUp(m);
    const sp = p.speed();
    const z0 = p.pos.z;
    const evs = steps(m, 1, pad(0, 0, { skill: true }));
    steps(m, Math.round(SKILL_T.stepover / DT) - 2, pad(0, 0), evs);
    expect(moveOf(evs)?.move).toBe('stepover');
    expect(p.speed()).toBeLessThan(sp * 0.7);
    expect(Math.abs(p.pos.z - z0)).toBeLessThan(0.3);
    expect(m.ball.owner).toBe(p.idx);

    const m2 = scenario(14);
    const q = runUp(m2);
    const evs2 = steps(m2, 1, pad(-1, 0, { skill: true }));
    steps(m2, Math.round(SKILL_T.dragback / DT) + 6, pad(-1, 0), evs2);
    expect(moveOf(evs2)?.move).toBe('dragback');
    expect(q.vel.x).toBeLessThan(-1);
    expect(Math.cos(q.facing)).toBeLessThan(-0.5);
    expect(m2.ball.owner).toBe(q.idx);
  });

  it('every move is drawn: the frame carries the skill pose, the move and its clock', () => {
    const m = scenario(15);
    const p = runUp(m);
    steps(m, 4, pad(0, 1, { skill: true }));
    const f = new Float32Array(FRAME_LEN);
    writeFrame(m, f, 0);
    const o = p.idx * PF;
    expect(f[o + 4]).toBe(STATE_CODE.skill);
    expect(f[o + 11]).toBe(SKILL_CODE.roulette);
    expect(f[o + 8]).toBeGreaterThan(0);
    expect(f[o + 8]).toBeLessThan(1);
    expect(f[BALL_OFS + 7]).toBe(p.idx);
  });
});

describe('SKILL: the PERFECT window', () => {
  /** A defender in front winds up a standing tackle; SKILL `frames` steps after the tell (negative: before it). */
  const counter = (seed: number, frames: number) => {
    const m = scenario(seed);
    const p = runUp(m);
    const o = defenderAhead(m, p);
    const evs: MatchEvent[] = [];
    if (frames < 0) {
      steps(m, 1, pad(1, 0, { skill: true }), evs);
      steps(m, -frames - 1, pad(1, 0), evs);
    }
    expect(telegraphs(m, o, p)).toBe(true);
    startTell(m, o, p, false);
    if (frames >= 0) {
      steps(m, frames, pad(1, 0), evs);
      // (Late: kept from going in meanwhile, so the ball is still there to skill.)
      if (frames * DT > tellTime(m.aiSkill(1))) o.tackleCooldown = 5;
      steps(m, 1, pad(0, 1, { skill: true }), evs);
    } else steps(m, 3, pad(0, 1, { skill: true }), evs);
    steps(m, 2, pad(1, 0), evs);
    return { m, p, o, evs, moves: evs.filter((e) => e.type === 'skillMove') };
  };

  it('SKILL inside the tell is a PERFECT: he bites (stumbling ~1 s), the dribbler is protected and bursts away', () => {
    const t = tellTime(1.8);
    for (const k of [3, Math.round((t * 0.5) / DT), Math.round(t / DT) - 1]) {
      const r = counter(30 + k, k);
      const mv = r.moves[0];
      expect(mv, `${k} frames in`).toMatchObject({ type: 'skillMove', grade: 'perfect', on: r.o.idx });
      expect(r.o.wrongFootT).toBeGreaterThan(PERFECT_BEAT_MIN - 4 * DT);
      expect(r.o.tellT).toBe(0);
      expect(r.p.protectT).toBeGreaterThan(0.7);
      expect(r.p.burstT).toBeGreaterThan(0.5);
      expect(r.evs.some((e) => e.type === 'beat' && e.on === r.o.idx)).toBe(true);
      expect(r.evs.some((e) => e.type === 'skill')).toBe(true);
      expect(r.m.ball.owner).toBe(r.p.idx);
      // Half a second on he still hasn't laid a glove on it.
      const after = steps(r.m, 30, pad(1, 0));
      expect(after.some((e) => e.type === 'tackle' && e.by === r.o.idx)).toBe(false);
      expect(r.m.ball.owner).toBe(r.p.idx);
    }
  }, 60_000);

  it('early (before the tell) or late (after the window) is no PERFECT, and an early press burns the cooldown', () => {
    const early = counter(40, -6);
    expect(early.moves.length).toBe(1);
    expect(early.moves[0]).not.toMatchObject({ grade: 'perfect' });
    const t = tellTime(1.8);
    const late = counter(41, Math.round((t + PERFECT_GRACE) / DT) + 6);
    expect(late.moves.length).toBe(1);
    expect(late.moves[0]).not.toMatchObject({ grade: 'perfect' });
    expect(late.o.wrongFootT).toBeLessThan(PERFECT_BEAT_MIN);
  });

  it('a slide from beside him is told and countered too (it goes under nothing); one from behind is not told', () => {
    const m = scenario(50);
    const p = runUp(m);
    const o = m.players[14];
    place(o, p.pos.x + 0.6, p.pos.z + 1.8);
    expect(telegraphs(m, o, p)).toBe(true);
    startTell(m, o, p, true);
    const evs = steps(m, 8, pad(1, 0));
    steps(m, 1, pad(0, -1, { skill: true }), evs);
    expect(moveOf(evs)?.grade).toBe('perfect');
    steps(m, 30, pad(1, 0), evs);
    expect(evs.some((e) => e.type === 'tackle' && e.by === o.idx && e.won)).toBe(false);
    // From behind (out of view): no tell, as it always was.
    const m2 = scenario(51);
    const q = runUp(m2);
    const r = m2.players[14];
    place(r, q.pos.x - 1.6, q.pos.z + 0.3);
    expect(telegraphs(m2, r, q)).toBe(false);
  });

  it("the AI's own challenges on his man come with a tell, and answering one in time is a PERFECT", () => {
    let told = 0;
    let perfect = 0;
    for (let s = 0; s < 12; s++) {
      const m = scenario(60 + s);
      const p = runUp(m, -10, 30);
      const o = defenderAhead(m, p, 2.4);
      o.jockeyT = 3;
      let at = -1;
      let pressed = false;
      for (let i = 0; i < 240 && !pressed && m.ball.owner === p.idx; i++) {
        const tell = m.drainEvents().find((e) => e.type === 'skillTell');
        if (tell && at < 0) {
          told++;
          at = i;
        }
        const press = at >= 0 && i === at + 12;
        if (press) pressed = true;
        m.step(DT, pad(0.4, 0, { skill: press }));
        if (press && m.drainEvents().some((e) => e.type === 'skillMove' && e.grade === 'perfect')) perfect++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`AI challenges told ${told}/12, answered 0.2 s later: PERFECT ${perfect}`);
    expect(told).toBeGreaterThanOrEqual(6);
    expect(perfect).toBe(told);
  }, 60_000);
});

describe('SKILL: not overpowered', () => {
  it('one move at a time and SKILL_COOL s between two; each costs stamina', () => {
    const m = scenario(70);
    const p = runUp(m);
    const st0 = p.stamina;
    const evs: MatchEvent[] = [];
    // Mashed: a press every 6 frames for ~1 s.
    for (let i = 0; i < 60; i++) steps(m, 1, pad(0, i % 12 < 6 ? 1 : -1, { skill: i % 6 === 0 }), evs);
    const n = evs.filter((e) => e.type === 'skillMove').length;
    expect(n).toBeLessThanOrEqual(Math.ceil(1 / SKILL_COOL));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(m.ctl[0].skill.moves).toBe(n);
    expect(st0 - p.stamina).toBeGreaterThan(n * SKILL_STAMINA * p.fatigue * 0.8);
  });

  it('mid move the ball is off his foot: a tackle on him is likelier (unless a skill has him protected)', () => {
    const m = scenario(71);
    const p = runUp(m);
    const o = defenderAhead(m, p, 1.2);
    const open = carrierGuard(m, o, p);
    steps(m, 1, pad(0, 0, { skill: true }));
    p.protectT = 0;
    expect(carrierGuard(m, o, p)).toBeCloseTo(open * SKILL_EXPOSED, 5);
    steps(m, Math.round(SKILL_T.stepover / DT) + 2, pad(1, 0));
    expect(carrierGuard(m, o, p)).toBeCloseTo(open, 5);
  });

  it('mashing next to a man who is only jockeying beats him less than a fresh move; nobody near gains nothing', () => {
    let fresh = 0;
    let mashed = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      for (const mash of [false, true]) {
        const m = scenario(300 + s);
        const p = runUp(m);
        const o = defenderAhead(m, p, 2.4);
        o.tackleCooldown = 5;
        if (mash) m.ctl[0].skill.last = m.ctl[0].skill.t - SKILL_COOL - 0.05;
        const evs = steps(m, 1, pad(0, 1, { skill: true }));
        if (evs.some((e) => e.type === 'beat' && e.on === o.idx)) mash ? mashed++ : fresh++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`a jockeying defender beaten: fresh move ${fresh}/${N}, straight after another ${mashed}/${N}`);
    expect(fresh).toBeGreaterThan(0);
    expect(fresh).toBeLessThan(N * 0.55);
    expect(mashed).toBeLessThan(fresh * 0.8);
  }, 120_000);
});

describe('SKILL: chains and SKILL GOALs', () => {
  it('moves that beat a man within COMBO_T s chain; a goal soon after is a SKILL GOAL (never an own goal), worth XP', () => {
    const m = scenario(80);
    const p = runUp(m);
    const st = m.ctl[0].skill;
    expect(st.chain(m, p, 'roulette')).toBe(1);
    st.t += COMBO_T - 0.5;
    expect(st.chain(m, p, 'stepover')).toBe(2);
    st.t += COMBO_T + 0.5;
    expect(st.chain(m, p, 'dragback')).toBe(1);
    // A cut that extends a chain shows ("SKILL x2"); a lone one doesn't.
    m.drainEvents();
    st.chain(m, p, 'cut');
    expect(m.drainEvents()).toContainEqual({ type: 'skillMove', player: p.idx, move: 'cut', grade: 'good', combo: 2, on: -1 });
    skillGoal(m, 0, false);
    expect(m.drainEvents()).toContainEqual({ type: 'skillGoal', side: 0, combo: 2 });
    expect(st.combo).toBe(0);
    st.chain(m, p, 'roulette');
    skillGoal(m, 0, true);
    st.chain(m, p, 'roulette');
    st.t += 6;
    skillGoal(m, 0, false);
    expect(m.drainEvents().some((e) => e.type === 'skillGoal')).toBe(false);
    // A skill cut alone (no SKILL move in the chain) doesn't make one either.
    st.t += 6;
    st.chain(m, p, 'cut');
    skillGoal(m, 0, false);
    expect(m.drainEvents().some((e) => e.type === 'skillGoal')).toBe(false);
    expect(st.skillGoals).toBe(1);
    const base: MatchSummary = {
      won: true, drawn: false, goals: 2, conceded: 0, assists: 0, tacklesWon: 1, passes: 10, skills: 2, headers: 0, longGoals: 0, powerups: 0,
      motm: false, blitz: false, difficulty: 0,
    };
    expect(matchXp({ ...base, skillGoals: 1 }) - matchXp(base)).toBe(SKILL_GOAL_XP);
  });
});

describe('SKILL: AI v AI never sees it', () => {
  it('no tells, no moves, nobody winding up, in a match with no human', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[3]), away: makeTeam(PRESET_CLUBS[4]), halfLength: 40, difficulty: 2.5, humanSide: -1, seed: 9 });
    let tells = 0;
    let wound = 0;
    for (let i = 0; i < 60 * 60 && m.phase !== 'fulltime'; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) if (e.type === 'skillTell' || e.type === 'skillMove' || e.type === 'skillGoal') tells++;
      for (const p of m.players) if (p.tellT > 0) wound++;
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    expect(tells).toBe(0);
    expect(wound).toBe(0);
  }, 120_000);

  it('two sims fed the same pads (SKILL mashed) stay identical', () => {
    const run = () => {
      const m = scenario(90);
      const p = runUp(m);
      defenderAhead(m, p, 2.6).jockeyT = 3;
      const trace: number[] = [];
      for (let i = 0; i < 240; i++) {
        m.step(DT, pad(Math.cos(i / 20), Math.sin(i / 20), { skill: i % 9 === 0 }));
        m.drainEvents();
        trace.push(m.ball.pos.x, m.ball.pos.z, m.players[9].pos.x, m.players[14].pos.z, m.rng.state());
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});

describe('SKILL: controls and the wire', () => {
  it('Q / U, pad LB, the touch SKILL button: bound by default, no clash, old saves get them', () => {
    expect(DEFAULT_KEYS.skill).toEqual(['KeyQ', 'KeyU']);
    expect(DEFAULT_PAD.skill).toEqual([4]);
    expect(KEY_ACTIONS).toContain('skill');
    expect(PAD_ACTIONS).toContain('skill');
    const keys = KEY_ACTIONS.flatMap((a) => DEFAULT_KEYS[a]);
    expect(new Set(keys).size).toBe(keys.length);
    const btns = PAD_ACTIONS.flatMap((a) => DEFAULT_PAD[a]);
    expect(new Set(btns).size).toBe(btns.length);
    expect(normalizeKeyMap(DEFAULT_KEYS)).toEqual(DEFAULT_KEYS);
    // A save from before the button: its map gets SKILL's defaults (those still free).
    const { skill: _k, ...oldKeys } = DEFAULT_KEYS;
    expect(normalizeKeyMap(oldKeys).skill).toEqual(['KeyQ', 'KeyU']);
    const { skill: _p, ...oldPad } = DEFAULT_PAD;
    expect(normalizePadMap(oldPad).skill).toEqual([4]);
    expect(actionKey('skill', 'keyboard')).toBe('Q');
    expect(actionKey('skill', 'gamepad')).toBe('LB');
    expect(actionKey('skill', 'touch')).toBe('SKILL');
  });

  it('the SKILL flag survives the wire, and the protocol version moved on', () => {
    const p: Pad = { ...EMPTY_PAD, mx: 0.5, mz: -0.25, skill: true, power: true };
    expect(quantizePad(p).skill).toBe(true);
    expect(quantizePad({ ...p, skill: false }).skill).toBe(false);
    const buf = encodeInput({ epoch: 3, first: 100, ack: 90, tick: 101, pads: [p, { ...p, skill: false }] });
    const back = decodeInput(buf)!;
    expect(back.pads.map((x) => x.skill)).toEqual([true, false]);
    expect(back.pads[0].power).toBe(true);
    expect(NET_VERSION).toBeGreaterThanOrEqual(3);
  });
});

describe('SKILL: whole matches against the scripted human', () => {
  it('answering the tells pays off fairly; mashing SKILL gains nothing worth having', () => {
    // (A short paired series, the same seeds for each: the full measurement, N=24 a level, is in the round's report.)
    const N = 4;
    const opts = { halfLength: 60, seed0: 4000 };
    const off = botSeries(N, 1.8, { ...opts, bot: { skills: 'off' } });
    const react = botSeries(N, 1.8, { ...opts, bot: { skills: 'react' } });
    const spam = botSeries(N, 1.8, { ...opts, bot: { skills: 'spam' } });
    // eslint-disable-next-line no-console
    console.log([off, react, spam].map((s, i) => `${['off', 'react', 'spam'][i]}: ${fmtBot(s)}`).join('\n'));
    expect(react.skillTells).toBeGreaterThan(0);
    expect(react.skillPerfectPct).toBeGreaterThan(50);
    expect(spam.skillMoves).toBeGreaterThan(react.skillMoves);
    expect(spam.skillPerfectPct).toBeLessThan(react.skillPerfectPct);
    // No runaway: goal difference within a goal a match of not using it at all.
    expect(spam.gf - spam.ga).toBeLessThan(off.gf - off.ga + 1);
    expect(react.gf - react.ga).toBeLessThan(off.gf - off.ga + 1.2);
  }, 900_000);
});
