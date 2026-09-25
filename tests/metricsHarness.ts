import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BOX_DEPTH, BOX_W, DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import type { Side } from '../src/sim/types';

/**
 * Aggregate football-feel metrics for AI vs AI matches. Everything here is measured from
 * the outside (events + state after each step) so the sim stays free of test hooks.
 */
export interface MatchMetrics {
  goals: number;
  score: [number, number];
  shots: number;
  onTarget: number;
  boxShots: number;
  longShots: number;
  headerShots: number;
  passAtt: [number, number];
  passCmp: [number, number];
  carrierStretches: number;
  carrierTime: number;
  tackleAttempts: number;
  tacklesWon: number;
  slides: number;
  corners: number;
  throwins: number;
  goalkicks: number;
  freekicks: number;
  penalties: number;
  fouls: number;
  yellows: number;
  reds: number;
  saves: number;
  maxStall: number;
  finalThird: [number, number];
  crosses: number;
  headers: number;
  blocks: number;
  rawPasses: number;
  shotOut: Record<string, number>;
  byKind: Record<string, [number, number]>;
  runs: number;
  overlaps: number;
  beats: number;
  claims: number;
  ownGoals: number;
  offsides: number;
  advantages: number;
  /** Substitutions made after half time (the automatic 60' / 75' changes). */
  lateSubs: number;
  subs: [number, number];
  /** Lowest outfield stamina on the pitch at full time. */
  minStamina: number;
}

const PASS_KINDS = new Set(['pass', 'through', 'lob', 'throw', 'keeper']);

export function runMatch(cfg: Partial<MatchConfig> & { seed: number }, homeIdx = 5, awayIdx = 6): MatchMetrics {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[homeIdx]),
    away: makeTeam(PRESET_CLUBS[awayIdx]),
    halfLength: 150,
    difficulty: 2,
    humanSide: -1,
    ...cfg,
  });
  const r: MatchMetrics = {
    goals: 0, score: [0, 0], shots: 0, onTarget: 0, boxShots: 0, longShots: 0, headerShots: 0,
    passAtt: [0, 0], passCmp: [0, 0], carrierStretches: 0, carrierTime: 0,
    tackleAttempts: 0, tacklesWon: 0, slides: 0, corners: 0, throwins: 0, goalkicks: 0, freekicks: 0,
    penalties: 0, fouls: 0, yellows: 0, reds: 0, saves: 0, maxStall: 0, finalThird: [0, 0], crosses: 0, headers: 0, blocks: 0,
    rawPasses: 0, shotOut: {}, byKind: {}, runs: 0, overlaps: 0, beats: 0, claims: 0,
    ownGoals: 0, offsides: 0, advantages: 0, lateSubs: 0, subs: [0, 0], minStamina: 1,
  };
  const wasRunning = new Set<number>();
  const lastOverlap: [number, number] = [-1, -1];
  // Shot being tracked until something resolves it.
  let shot: { side: Side } | null = null;
  const shotDone = (k: string) => {
    if (!shot) return;
    r.shotOut[k] = (r.shotOut[k] ?? 0) + 1;
    shot = null;
  };
  let steps = 0;
  // Pending pass: resolved by the side of the next player to control / strike the ball.
  let pending: { side: Side; kicker: number; kind: string } | null = null;
  const resolve = (side: Side | -1) => {
    if (!pending) return;
    const bk = (r.byKind[pending.kind] ??= [0, 0]);
    bk[0]++;
    if (side === pending.side) {
      r.passCmp[pending.side]++;
      bk[1]++;
    }
    pending = null;
  };
  // Carrier stretches (merging brief control flickers by the same player).
  let curOwner = -1;
  let curT = 0;
  let lostT = 0;
  // Stall: the ball staying inside a small circle during open play.
  let anchorX = 0;
  let anchorZ = 0;
  let stallT = 0;
  const inFinal: [boolean, boolean] = [false, false];
  let shotsSeen = 0;

  while (m.phase !== 'fulltime' && steps < 60 * 60 * 14) {
    m.step(DT, EMPTY_PAD);
    steps++;
    const b = m.ball;
    for (const e of m.drainEvents()) {
      switch (e.type) {
        case 'kick': {
          const k = m.players[b.lastTouch];
          if (!k) break;
          const ad = m.attackDir(k.side);
          if (pending && pending.kicker !== k.idx) resolve(k.side);
          if (shot && m.shotClock > 0) shotDone(k.side === shot.side ? 'reboundKick' : 'cleared');
          if (e.kind === 'header') r.headers++;
          if (PASS_KINDS.has(e.kind) && m.passTarget >= 0) {
            r.passAtt[k.side]++;
            pending = { side: k.side, kicker: k.idx, kind: e.kind };
          }
          if (e.kind === 'lob' && Math.abs(e.z) > HALF_W * 0.42 && e.x * ad > HALF_L * 0.45) r.crosses++;
          break;
        }
        case 'control': {
          const p = m.players[e.player];
          resolve(p.side);
          if (shot) shotDone(p.side === shot.side ? 'rebound' : 'blockedOrLoose');
          break;
        }
        case 'save':
          if (e.caught) resolve(m.players[e.keeper].side);
          if (shot) shotDone(e.caught ? 'caught' : 'parried');
          break;
        case 'restart':
          if (e.kind === 'throwin') r.throwins++;
          else if (e.kind === 'goalkick') r.goalkicks++;
          else if (e.kind === 'freekick') r.freekicks++;
          else if (e.kind === 'penalty') r.penalties++;
          if (e.kind !== 'kickoff') resolve(-1);
          if (shot) shotDone(`out:${e.kind}`);
          break;
        case 'goal':
          resolve(-1);
          shotDone('goal');
          if (e.own) r.ownGoals++;
          break;
        case 'tackle':
          if (e.slide && !e.won) {
            r.slides++;
            r.tackleAttempts++;
          } else if (!e.slide) r.tackleAttempts++;
          break;
        case 'block':
          r.blocks++;
          break;
        case 'card':
          if (e.color === 'red') r.reds++;
          else r.yellows++;
          break;
        case 'beat':
          r.beats++;
          break;
        case 'claim':
          r.claims++;
          resolve(m.players[e.keeper].side);
          break;
        case 'offside':
          r.offsides++;
          break;
        case 'advantage':
          r.advantages++;
          break;
        case 'sub':
          r.subs[e.side]++;
          // Half-time changes are drained on the first step of the second half (clock still 0).
          if (m.half === 2 && m.clock > 1) r.lateSubs++;
          break;
        default:
          break;
      }
    }
    const shotsNow = m.stats.shots[0] + m.stats.shots[1];
    if (shotsNow > shotsSeen) {
      const k = m.players[b.lastTouch];
      if (k) {
        const gx = m.attackDir(k.side) * HALF_L;
        const inBox = Math.abs(b.pos.x - gx) < BOX_DEPTH && Math.abs(b.pos.z) < BOX_W / 2;
        const d = Math.hypot(gx - b.pos.x, b.pos.z);
        if (inBox) r.boxShots++;
        if (d > 22) r.longShots++;
        if (b.pos.y > 1) r.headerShots++;
        shotDone('unresolved');
        shot = { side: k.side };
      }
      shotsSeen = shotsNow;
    }

    // Carrier stretches.
    const owner = m.phase === 'play' && b.owner >= 0 && !b.held && !m.players[b.owner].isKeeper ? b.owner : -1;
    if (owner >= 0) {
      if (owner !== curOwner) {
        if (curOwner >= 0) {
          r.carrierStretches++;
          r.carrierTime += curT;
        }
        curOwner = owner;
        curT = 0;
      }
      curT += DT;
      lostT = 0;
    } else if (curOwner >= 0) {
      lostT += DT;
      if (lostT > 0.4 || m.phase !== 'play') {
        r.carrierStretches++;
        r.carrierTime += curT;
        curOwner = -1;
        curT = 0;
      }
    }
    // Runs in behind and overlaps (edge-triggered).
    for (const p of m.players) {
      if (p.running && !wasRunning.has(p.idx)) {
        r.runs++;
        wasRunning.add(p.idx);
      } else if (!p.running) wasRunning.delete(p.idx);
    }
    for (const s of [0, 1] as Side[]) {
      const o = m.brains[s].overlap;
      if (o >= 0 && o !== lastOverlap[s]) r.overlaps++;
      lastOverlap[s] = o;
    }
    // Final-third entries.
    for (const s of [0, 1] as Side[]) {
      const has = m.phase === 'play' && b.owner >= 0 && m.players[b.owner].side === s;
      const deep = has && b.pos.x * m.attackDir(s) > HALF_L / 3;
      if (deep && !inFinal[s]) r.finalThird[s]++;
      inFinal[s] = deep;
    }
    // Stall.
    if (m.phase === 'play') {
      if (Math.hypot(b.pos.x - anchorX, b.pos.z - anchorZ) > 2.5) {
        anchorX = b.pos.x;
        anchorZ = b.pos.z;
        stallT = 0;
      } else stallT += DT;
      r.maxStall = Math.max(r.maxStall, stallT);
    } else {
      anchorX = b.pos.x;
      anchorZ = b.pos.z;
      stallT = 0;
    }

    if (m.phase === 'halftime') {
      // What the match session does at the break: each AI manager freshens up two tired players.
      m.aiSubs(0, 2);
      m.aiSubs(1, 2);
      m.continueSecondHalf();
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  if (curOwner >= 0) {
    r.carrierStretches++;
    r.carrierTime += curT;
  }
  r.rawPasses = m.stats.passes[0] + m.stats.passes[1];
  r.goals = m.goals.length;
  r.score = [m.score[0], m.score[1]];
  r.shots = m.stats.shots[0] + m.stats.shots[1];
  r.onTarget = m.stats.onTarget[0] + m.stats.onTarget[1];
  r.tacklesWon = m.stats.tackles[0] + m.stats.tackles[1];
  r.corners = m.stats.corners[0] + m.stats.corners[1];
  r.fouls = m.stats.fouls[0] + m.stats.fouls[1];
  r.saves = m.stats.saves[0] + m.stats.saves[1];
  r.minStamina = Math.min(...m.players.filter((p) => !p.isKeeper && !p.sentOff).map((p) => p.stamina));
  return r;
}

export interface Summary {
  n: number;
  goals: number;
  shots: number;
  onTargetPct: number;
  boxShots: number;
  longShots: number;
  headerShots: number;
  passAttPerTeam: number;
  passCmpPerTeam: number;
  passPct: number;
  carrierAvg: number;
  tackleAttempts: number;
  tacklesWon: number;
  slides: number;
  corners: number;
  throwins: number;
  goalkicks: number;
  freekicks: number;
  penalties: number;
  fouls: number;
  yellows: number;
  reds: number;
  savePct: number;
  maxStall: number;
  finalThirdPerTeam: number;
  minFinalThird: number;
  /** Team-matches in which a side never had the ball in the final third. */
  zeroFinalThird: number;
  crosses: number;
  headers: number;
  blocks: number;
  rawPasses: number;
  shotOut: string;
  passKinds: string;
  runs: number;
  overlaps: number;
  beats: number;
  claims: number;
  /** Share of goals that were own goals, %. */
  ownGoalPct: number;
  offsides: number;
  advantages: number;
  lateSubs: number;
  maxSubs: number;
  minStamina: number;
}

export function summarise(list: MatchMetrics[]): Summary {
  const n = list.length;
  const sum = (f: (r: MatchMetrics) => number) => list.reduce((a, r) => a + f(r), 0);
  const avg = (f: (r: MatchMetrics) => number) => sum(f) / n;
  const saves = sum((r) => r.saves);
  const goals = sum((r) => r.goals);
  return {
    n,
    goals: avg((r) => r.goals),
    shots: avg((r) => r.shots),
    onTargetPct: (sum((r) => r.onTarget) / Math.max(1, sum((r) => r.shots))) * 100,
    boxShots: avg((r) => r.boxShots),
    longShots: avg((r) => r.longShots),
    headerShots: avg((r) => r.headerShots),
    passAttPerTeam: avg((r) => (r.passAtt[0] + r.passAtt[1]) / 2),
    passCmpPerTeam: avg((r) => (r.passCmp[0] + r.passCmp[1]) / 2),
    passPct: (sum((r) => r.passCmp[0] + r.passCmp[1]) / Math.max(1, sum((r) => r.passAtt[0] + r.passAtt[1]))) * 100,
    carrierAvg: sum((r) => r.carrierTime) / Math.max(1, sum((r) => r.carrierStretches)),
    tackleAttempts: avg((r) => r.tackleAttempts),
    tacklesWon: avg((r) => r.tacklesWon),
    slides: avg((r) => r.slides),
    corners: avg((r) => r.corners),
    throwins: avg((r) => r.throwins),
    goalkicks: avg((r) => r.goalkicks),
    freekicks: avg((r) => r.freekicks),
    penalties: avg((r) => r.penalties),
    fouls: avg((r) => r.fouls),
    yellows: avg((r) => r.yellows),
    reds: avg((r) => r.reds),
    savePct: (saves / Math.max(1, saves + goals)) * 100,
    maxStall: Math.max(...list.map((r) => r.maxStall)),
    finalThirdPerTeam: avg((r) => (r.finalThird[0] + r.finalThird[1]) / 2),
    minFinalThird: Math.min(...list.map((r) => Math.min(r.finalThird[0], r.finalThird[1]))),
    zeroFinalThird: list.reduce((a, r) => a + (r.finalThird[0] === 0 ? 1 : 0) + (r.finalThird[1] === 0 ? 1 : 0), 0),
    crosses: avg((r) => r.crosses),
    headers: avg((r) => r.headers),
    blocks: avg((r) => r.blocks),
    rawPasses: avg((r) => r.rawPasses),
    runs: avg((r) => r.runs),
    overlaps: avg((r) => r.overlaps),
    beats: avg((r) => r.beats),
    claims: avg((r) => r.claims),
    ownGoalPct: (sum((r) => r.ownGoals) / Math.max(1, goals)) * 100,
    offsides: avg((r) => r.offsides),
    advantages: avg((r) => r.advantages),
    lateSubs: avg((r) => r.lateSubs),
    maxSubs: Math.max(...list.map((r) => Math.max(r.subs[0], r.subs[1]))),
    minStamina: avg((r) => r.minStamina),
    passKinds: (() => {
      const agg: Record<string, [number, number]> = {};
      for (const r of list) {
        for (const [k, v] of Object.entries(r.byKind)) {
          const a = (agg[k] ??= [0, 0]);
          a[0] += v[0];
          a[1] += v[1];
        }
      }
      return Object.entries(agg).map(([k, v]) => `${k}:${(v[0] / n).toFixed(1)}@${((v[1] / Math.max(1, v[0])) * 100).toFixed(0)}%`).join(' ');
    })(),
    shotOut: (() => {
      const agg: Record<string, number> = {};
      for (const r of list) for (const [k, v] of Object.entries(r.shotOut)) agg[k] = (agg[k] ?? 0) + v;
      return Object.entries(agg).map(([k, v]) => `${k}:${(v / n).toFixed(1)}`).join(' ');
    })(),
  };
}

export function fmt(s: Summary): string {
  return Object.entries(s)
    .map(([k, v]) => `${k.padEnd(18)} ${typeof v === 'number' ? v.toFixed(2) : v}`)
    .join('\n');
}
