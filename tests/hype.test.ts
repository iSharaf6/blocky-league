import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { stateHash } from '../src/net/hash';
import { DT } from '../src/sim/constants';
import { HYPE_MAX, devFillHype, hypeOf, hypeStats, superArmed, superBall } from '../src/sim/hype';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import type { MatchEvent, Side } from '../src/sim/types';
import { HumanBot } from './humanBot';

declare const process: { env: Record<string, string | undefined>; getBuiltinModule(id: string): { appendFileSync(path: string, data: string): void } };
import { FunTracker, gradeOf, type FunSummary } from '../src/game/funLayer';

function mk(cfg: Partial<MatchConfig> = {}, seed = 7, home = 5, away = 6): Match {
  return new Match({
    home: makeTeam(PRESET_CLUBS[home]),
    away: makeTeam(PRESET_CLUBS[away]),
    halfLength: 120,
    difficulty: 1.8,
    humanSide: 0,
    seed,
    ...cfg,
  });
}

export interface HypeRun {
  m: Match;
  events: MatchEvent[];
  /** Per side: meters filled, super shots struck, super shots that scored, super shots saved. */
  fills: [number, number];
  supers: [number, number];
  superGoals: [number, number];
  superSaves: [number, number];
  superOnTarget: [number, number];
  superBlocked: [number, number];
  /** Shots and goals per side (all shots, for the conversion to compare with). */
  shots: [number, number];
  /** Open-play seconds. */
  playT: number;
  bySource: { [k: string]: [number, number] };
  /** The fun layer's verdict (bounties, SHOWTIME) for the bot's side. */
  fun: FunSummary;
  /** Goal callouts seen (tag text -> count). */
  tags: Record<string, number>;
}

/** A whole match with the casual person-like bot on side 0 (or AI v AI), collecting what HYPE did. */
export function hypeMatch(seed: number, opts: { bot?: boolean; hype?: boolean; home?: number; away?: number; difficulty?: number; halfLength?: number } = {}): HypeRun {
  const m = mk({ hype: opts.hype ?? true, humanSide: opts.bot === false ? -1 : 0, difficulty: opts.difficulty ?? 1.8, halfLength: opts.halfLength ?? 120 }, seed, opts.home ?? 5, opts.away ?? 6);
  const bot = opts.bot === false ? null : new HumanBot(seed, { casual: true, skills: 'react' });
  const fun = new FunTracker(m, { humanSide: opts.bot === false ? -1 : 0, bounties: opts.bot !== false, showtime: opts.bot !== false, seed });
  const tags: Record<string, number> = {};
  const events: MatchEvent[] = [];
  const superGoals: [number, number] = [0, 0];
  const superSaves: [number, number] = [0, 0];
  const superOnTarget: [number, number] = [0, 0];
  const superBlocked: [number, number] = [0, 0];
  let playT = 0;
  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 16; steps++) {
    const pad = bot ? bot.pad(m) : EMPTY_PAD;
    const before = m.ball.owner;
    const live = superBall(m);
    m.step(DT, pad);
    if (m.phase === 'play') playT += DT;
    const evs = m.drainEvents();
    for (const e of evs) {
      events.push(e);
      if (e.type === 'goal' && !e.own && live === e.side) superGoals[e.side]++;
      if (e.type === 'save' && live !== -1 && m.players[e.keeper].side !== live) superSaves[live as Side]++;
      if (e.type === 'block' && e.shot && live !== -1) superBlocked[live as Side]++;
      if (e.type === 'superShot' && m.shotOnTarget) superOnTarget[e.side]++;
    }
    bot?.observe(m, evs, before);
    fun.after(evs, DT);
    for (const c of fun.cues.splice(0)) if (c.type === 'goalCall') for (const t of c.tags) tags[t.text.replace(/^\d+ /, 'N ')] = (tags[t.text.replace(/^\d+ /, 'N ')] ?? 0) + 1;
    if (m.phase === 'halftime') {
      m.aiSubs(1, 2);
      m.continueSecondHalf();
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  const st = hypeStats(m);
  return { m, events, fills: st.fills, supers: st.supers, superGoals, superSaves, superOnTarget, superBlocked, shots: [...m.stats.shots] as [number, number], playT, bySource: st.bySource,
    fun: fun.summary(), tags };
}

describe('HYPE (sim/hype.ts)', () => {
  it('is off unless the match asks for it: no meters, no events, the same match bit for bit', () => {
    const a = mk({}, 11);
    const b = mk({ hype: false }, 11);
    for (let i = 0; i < 60 * 40; i++) {
      a.step(DT, EMPTY_PAD);
      b.step(DT, EMPTY_PAD);
    }
    expect(stateHash(a)).toBe(stateHash(b));
    expect(hypeOf(a, 0)).toBe(0);
    expect(a.drainEvents().some((e) => e.type === 'hypeFull' || e.type === 'superShot')).toBe(false);
  }, 30_000);

  it('is deterministic: the same seed and pads give the same meters, hashes and super shots', () => {
    // (Short halves: two whole matches on a loaded machine.)
    const r1 = hypeMatch(41, { halfLength: 45 });
    const r2 = hypeMatch(41, { halfLength: 45 });
    expect(stateHash(r1.m)).toBe(stateHash(r2.m));
    expect(r1.supers).toEqual(r2.supers);
    expect(r1.events.length).toBe(r2.events.length);
  }, 180_000);

  it('a full meter turns the next open-play shot into a SUPER SHOT, which empties it', () => {
    const m = mk({ hype: true, humanSide: -1 }, 5);
    devFillHype(m, 0);
    devFillHype(m, 1);
    expect(superArmed(m, 0)).toBe(true);
    expect(m.drainEvents().filter((e) => e.type === 'hypeFull').length).toBe(2);
    let struck: MatchEvent | null = null;
    for (let i = 0; i < 60 * 120 && !struck; i++) {
      m.step(DT, EMPTY_PAD);
      for (const e of m.drainEvents()) if (e.type === 'superShot') struck = e;
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
    expect(struck).not.toBeNull();
    const side = (struck as { side: Side }).side;
    expect(hypeOf(m, side)).toBeLessThan(1);
    expect(hypeStats(m).supers[side]).toBe(1);
  }, 30_000);

  it('fills from play for both sides (the AI earns them too), never past the top', () => {
    const r = hypeMatch(77, { halfLength: 90 });
    expect(r.fills[0] + r.fills[1]).toBeGreaterThan(0);
    expect(hypeOf(r.m, 0)).toBeLessThanOrEqual(1);
    expect(hypeOf(r.m, 1)).toBeLessThanOrEqual(1);
    expect(HYPE_MAX).toBe(100);
  }, 180_000);
});

/** Measurement lines go to FUN_OUT (a file) as well as the console. */
export function report(line: string): void {
  console.log(line);
  if (process.env.FUN_OUT) process.getBuiltinModule('node:fs').appendFileSync(process.env.FUN_OUT, `${line}\n`);
}

/** The measurement (FUN_MEASURE=1): the casual bot over a series, what HYPE does per match. */
describe.runIf(!!process.env.FUN_MEASURE)('HYPE measurement', () => {
  it('casual bot series', () => {
    const n = Number(process.env.FUN_N ?? 12);
    const runs: HypeRun[] = [];
    for (let i = 0; i < n; i++) {
      const k = 2 + (Math.floor(i / 2) % 8);
      const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
      runs.push(hypeMatch(1000 + i * 97, { home, away, difficulty: Number(process.env.FUN_DIFF ?? 1.8) }));
    }
    const sum = (f: (r: HypeRun) => number) => runs.reduce((a, r) => a + f(r), 0);
    const per = (f: (r: HypeRun) => number) => (sum(f) / n).toFixed(2);
    const s0 = sum((r) => r.supers[0]);
    const s1 = sum((r) => r.supers[1]);
    report(`HYPE diff ${process.env.FUN_DIFF ?? 1.8} n=${n}: fills/match bot ${per((r) => r.fills[0])} AI ${per((r) => r.fills[1])} | supers/match bot ${per((r) => r.supers[0])} AI ${per((r) => r.supers[1])}` +
      ` | super goals bot ${sum((r) => r.superGoals[0])}/${s0} AI ${sum((r) => r.superGoals[1])}/${s1} | saved bot ${sum((r) => r.superSaves[0])} AI ${sum((r) => r.superSaves[1])}` +
      ` | on target bot ${sum((r) => r.superOnTarget[0])} AI ${sum((r) => r.superOnTarget[1])} | blocked bot ${sum((r) => r.superBlocked[0])} AI ${sum((r) => r.superBlocked[1])}` +
      ` | GF ${per((r) => r.m.score[0])} GA ${per((r) => r.m.score[1])} | shots ${per((r) => r.shots[0])}-${per((r) => r.shots[1])} | play ${per((r) => r.playT)} s`);
    const grades: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const r of runs) grades[r.fun.grade]++;
    const norms = runs.map((r) => Math.round((r.fun.style * 240) / (2 * r.m.cfg.halfLength))).sort((a, b) => a - b);
    const kinds: Record<string, number> = {};
    for (const r of runs) for (const k of r.fun.kinds) kinds[k] = (kinds[k] ?? 0) + 1;
    const tagc: Record<string, number> = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.tags)) tagc[k] = (tagc[k] ?? 0) + v;
    report(`  BOUNTIES offered/match ${per((r) => r.fun.offered)} done ${per((r) => r.fun.done)} | coins/match ${per((r) => r.fun.coins)} xp ${per((r) => r.fun.xp)} | done by kind ${JSON.stringify(kinds)}`);
    report(`  SHOWTIME grades ${JSON.stringify(grades)} | norm points sorted ${norms.join(' ')} | goal tags ${JSON.stringify(tagc)}`);
    void gradeOf;
    const keys = new Set(runs.flatMap((r) => Object.keys(r.bySource)));
    report(`  gain/match by source: ${[...keys].map((k) => `${k} ${per((r) => r.bySource[k]?.[0] ?? 0)}/${per((r) => r.bySource[k]?.[1] ?? 0)}`).join(' | ')}`);
  }, 600_000);
});
