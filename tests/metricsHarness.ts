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
  /** Passes (by kind) that the other side took: [attempts, lost to an opponent]. */
  lostByKind: Record<string, [number, number]>;
  /**
   * Launch speed (m/s, the ball's speed the step after the strike) by kick kind, headed and cleared balls
   * (never shots): count, sum, max. Header shots are 'headerShot'.
   */
  kickSpeed: Record<string, [number, number, number]>;
  /** Goals per scorer, keyed `side:slot` (own goals left out). */
  scorers: Record<string, number>;
  /** Every second-half substitution: side, minute, whether it was that side's first change of the match. */
  subLog: { side: Side; minute: number; first: boolean }[];
  /** Seconds the ball was in open play, dead (out / restart / kick-off) and in the goal celebration. */
  liveT: number;
  deadT: number;
  goalT: number;
  /** Shots from 25 m or more, and how many of them went in. */
  long25: number;
  long25Goals: number;
  /** Goals scored with the head. */
  headerGoals: number;
  /** Team shape (sampleShape) and each side's possession (s), shots and passes tried. */
  shape: ShapeStats;
  possession: [number, number];
  shotsSide: [number, number];
}

const PASS_KINDS = new Set(['pass', 'through', 'lob', 'throw', 'keeper']);

/**
 * Team shape, sampled at 10 Hz in open play (the owner, round 13: "everybody just chasing the ball ... like
 * children in primary"). Per side:
 * - swarm: outfield players within SWARM_R m of the ball (the swarm index is its mean);
 * - length / width: the outfield block's extent along / across the pitch (m);
 * - lineDef: how far (m) the deepest outfield man stands from his own goal line while the other side has it;
 * - press: passes the other side played in their own 60% of the pitch, and our defensive actions there (tackles
 *   tried, interceptions, fouls): passes per defensive action is the PPDA-style pressure stat (lower = more press).
 */
export const SWARM_R = 8;
export interface ShapeStats {
  samples: [number, number];
  swarm: [number, number];
  length: [number, number];
  width: [number, number];
  defSamples: [number, number];
  lineDef: [number, number];
  /** Opponent passes in their own 60%, our defensive actions there (for the side named by the index). */
  pressPasses: [number, number];
  pressActions: [number, number];
  /** Samples with 3+ of the side's outfield men within SWARM_R m of the ball; men within 12 m (summed). */
  crowd3: [number, number];
  near12: [number, number];
  /** The same, split by who has the ball: while the side is defending (the other side on it) / attacking. */
  swarmDef: [number, number];
  swarmAtt: [number, number];
  attSamples: [number, number];
  /** Open-play passes played, and those played 5 m or more forward (to where the man it was for stood). */
  passes: [number, number];
  fwdPasses: [number, number];
}
export const emptyShape = (): ShapeStats => ({
  samples: [0, 0], swarm: [0, 0], length: [0, 0], width: [0, 0], defSamples: [0, 0], lineDef: [0, 0], pressPasses: [0, 0], pressActions: [0, 0],
  crowd3: [0, 0], near12: [0, 0], swarmDef: [0, 0], swarmAtt: [0, 0], attSamples: [0, 0], passes: [0, 0], fwdPasses: [0, 0],
});

/** One shape sample of `m` (open play only), into `s`. */
export function sampleShape(m: Match, s: ShapeStats): void {
  if (m.phase !== 'play') return;
  const b = m.ball.pos;
  const owner = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
  for (const side of [0, 1] as Side[]) {
    const ad = m.attackDir(side);
    let near = 0;
    let near12 = 0;
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of m.teamPlayers(side)) {
      if (p.isKeeper || p.sentOff) continue;
      const d = Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      if (d < SWARM_R) near++;
      if (d < 12) near12++;
      const x = p.pos.x * ad;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      zMin = Math.min(zMin, p.pos.z);
      zMax = Math.max(zMax, p.pos.z);
    }
    s.samples[side]++;
    s.swarm[side] += near;
    s.near12[side] += near12;
    if (near >= 3) s.crowd3[side]++;
    if (owner && owner.side === side) {
      s.attSamples[side]++;
      s.swarmAtt[side] += near;
    }
    s.length[side] += xMax - xMin;
    s.width[side] += zMax - zMin;
    if (owner && owner.side !== side) {
      s.defSamples[side]++;
      s.lineDef[side] += xMin + HALF_L;
      s.swarmDef[side] += near;
    }
  }
}

/** The shape's averages: swarm index (both sides, and each), block length / width, line height, PPDA. */
export interface ShapeSummary {
  swarm: number;
  swarmSide: [number, number];
  length: [number, number];
  width: [number, number];
  lineDef: [number, number];
  ppda: [number, number];
  /** Share (%) of samples with 3+ men within SWARM_R, men within 12 m, swarm while defending / attacking. */
  crowd3: [number, number];
  near12: [number, number];
  swarmDef: [number, number];
  swarmAtt: [number, number];
  /** Share (%) of open-play passes played 5 m or more forward. */
  fwdShare: [number, number];
}
export function summariseShape(list: ShapeStats[]): ShapeSummary {
  const t = emptyShape();
  for (const s of list) {
    for (const k of Object.keys(t) as (keyof ShapeStats)[]) for (const i of [0, 1]) t[k][i] += s[k][i];
  }
  const per = (a: [number, number], n: [number, number]): [number, number] => [a[0] / Math.max(1, n[0]), a[1] / Math.max(1, n[1])];
  const sw = per(t.swarm, t.samples);
  return {
    swarm: (t.swarm[0] + t.swarm[1]) / Math.max(1, t.samples[0] + t.samples[1]),
    swarmSide: sw,
    length: per(t.length, t.samples),
    width: per(t.width, t.samples),
    lineDef: per(t.lineDef, t.defSamples),
    ppda: per(t.pressPasses, t.pressActions),
    crowd3: per(t.crowd3, t.samples).map((v) => v * 100) as [number, number],
    near12: per(t.near12, t.samples),
    swarmDef: per(t.swarmDef, t.defSamples),
    swarmAtt: per(t.swarmAtt, t.attSamples),
    fwdShare: per(t.fwdPasses, t.passes).map((v) => v * 100) as [number, number],
  };
}
/** Per side over a list of matches: possession (%), passes tried per shot, goals for, and the shape. */
export interface SideSummary extends ShapeSummary {
  poss: [number, number];
  passesPerShot: [number, number];
  goalsFor: [number, number];
  shots: [number, number];
}
export function sideSummary(list: MatchMetrics[]): SideSummary {
  const sum = (f: (r: MatchMetrics) => number) => list.reduce((a, r) => a + f(r), 0);
  const poss0 = sum((r) => r.possession[0]);
  const poss1 = sum((r) => r.possession[1]);
  const n = Math.max(1, list.length);
  return {
    ...summariseShape(list.map((r) => r.shape)),
    poss: [(poss0 / Math.max(1e-6, poss0 + poss1)) * 100, (poss1 / Math.max(1e-6, poss0 + poss1)) * 100],
    passesPerShot: [sum((r) => r.passAtt[0]) / Math.max(1, sum((r) => r.shotsSide[0])), sum((r) => r.passAtt[1]) / Math.max(1, sum((r) => r.shotsSide[1]))],
    goalsFor: [sum((r) => r.score[0]) / n, sum((r) => r.score[1]) / n],
    shots: [sum((r) => r.shotsSide[0]) / n, sum((r) => r.shotsSide[1]) / n],
  };
}
export function fmtSide(s: SideSummary): string {
  const f = (v: [number, number], d = 1) => `${v[0].toFixed(d)}/${v[1].toFixed(d)}`;
  return `${fmtShape(s)} | poss ${f(s.poss)}% | passes/shot ${f(s.passesPerShot)} | shots ${f(s.shots)} | goals ${f(s.goalsFor, 2)}`;
}

export function fmtShape(s: ShapeSummary): string {
  const f = (v: [number, number], d = 1) => `${v[0].toFixed(d)}/${v[1].toFixed(d)}`;
  return `swarm ${s.swarm.toFixed(2)} (${f(s.swarmSide, 2)}; def ${f(s.swarmDef, 2)} att ${f(s.swarmAtt, 2)}; 3+ ${f(s.crowd3, 0)}%; <12m ${f(s.near12, 2)}) | length ${f(s.length)} m | width ${f(s.width)} m | line (defending) ${f(s.lineDef)} m | PPDA ${f(s.ppda)} | forward passes ${f(s.fwdShare, 0)}%`;
}

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
    lostByKind: {}, kickSpeed: {}, scorers: {}, subLog: [], liveT: 0, deadT: 0, goalT: 0, long25: 0, long25Goals: 0, headerGoals: 0,
    shape: emptyShape(), possession: [0, 0], shotsSide: [0, 0],
  };
  // In `side`'s frame, is the ball in the other side's own 60% of the pitch (the PPDA pressing zone)?
  const inPressZone = (side: Side, x: number) => (x * m.attackDir(side)) / HALF_L > -0.2;
  const wasRunning = new Set<number>();
  const lastOverlap: [number, number] = [-1, -1];
  // Shot being tracked until something resolves it.
  let shot: { side: Side; d: number; header: boolean } | null = null;
  const shotDone = (k: string) => {
    if (!shot) return;
    r.shotOut[k] = (r.shotOut[k] ?? 0) + 1;
    if (k === 'goal' && shot.d >= 25) r.long25Goals++;
    if (k === 'goal' && shot.header) r.headerGoals++;
    shot = null;
  };
  let steps = 0;
  // Pending pass: resolved by the side of the next player to control / strike the ball.
  let pending: { side: Side; kicker: number; kind: string } | null = null;
  const resolve = (side: Side | -1) => {
    if (!pending) return;
    const bk = (r.byKind[pending.kind] ??= [0, 0]);
    bk[0]++;
    const lk = (r.lostByKind[pending.kind] ??= [0, 0]);
    lk[0]++;
    if (side === pending.side) {
      r.passCmp[pending.side]++;
      bk[1]++;
    } else if (side !== -1) {
      lk[1]++;
      if (inPressZone(side, m.ball.pos.x)) r.shape.pressActions[side]++;
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
    const shotsBefore = m.stats.shots[0] + m.stats.shots[1];
    m.step(DT, EMPTY_PAD);
    steps++;
    const ph = m.phase as string;
    if (ph === 'play') r.liveT += DT;
    else if (ph === 'out' || ph === 'restart' || ph === 'kickoff') r.deadT += DT;
    else if (ph === 'goal') r.goalT += DT;
    const b = m.ball;
    for (const e of m.drainEvents()) {
      switch (e.type) {
        case 'kick': {
          const k = m.players[b.lastTouch];
          if (!k) break;
          const isShot = m.stats.shots[0] + m.stats.shots[1] > shotsBefore;
          // (Read after the step: the ball has flown one frame since the strike.)
          const kk = e.kind === 'header' && isShot ? 'headerShot' : isShot ? 'shot' : e.kind;
          if (b.owner < 0) {
            const ks = (r.kickSpeed[kk] ??= [0, 0, 0]);
            const sp = b.speed();
            ks[0]++;
            ks[1] += sp;
            ks[2] = Math.max(ks[2], sp);
          }
          const ad = m.attackDir(k.side);
          if (pending && pending.kicker !== k.idx) resolve(k.side);
          if (shot && m.shotClock > 0) shotDone(k.side === shot.side ? 'reboundKick' : 'cleared');
          if (e.kind === 'header') r.headers++;
          if (PASS_KINDS.has(e.kind) && m.passTarget >= 0) {
            r.passAtt[k.side]++;
            pending = { side: k.side, kicker: k.idx, kind: e.kind };
            const dSide = (1 - k.side) as Side;
            if (m.phase === 'play' && inPressZone(dSide, e.x)) r.shape.pressPasses[dSide]++;
            if (m.phase === 'play' && e.kind !== 'throw' && e.kind !== 'keeper') {
              r.shape.passes[k.side]++;
              if ((m.players[m.passTarget].pos.x - e.x) * ad >= 5) r.shape.fwdPasses[k.side]++;
            }
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
          else {
            const sc = m.players[e.scorer];
            const key = `${sc.side}:${sc.slot}`;
            r.scorers[key] = (r.scorers[key] ?? 0) + 1;
          }
          break;
        case 'tackle':
          if (inPressZone(m.players[e.by].side, b.pos.x)) r.shape.pressActions[m.players[e.by].side]++;
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
          if (m.half === 2 && m.clock > 1) {
            r.lateSubs++;
            r.subLog.push({ side: e.side, minute: m.minute(), first: r.subs[e.side] === 1 });
          }
          break;
        default:
          break;
      }
    }
    if (steps % 6 === 0) sampleShape(m, r.shape);
    const shotsNow = m.stats.shots[0] + m.stats.shots[1];
    if (shotsNow > shotsSeen) {
      const k = m.players[b.lastTouch];
      if (k) {
        const gx = m.attackDir(k.side) * HALF_L;
        const inBox = Math.abs(b.pos.x - gx) < BOX_DEPTH && Math.abs(b.pos.z) < BOX_W / 2;
        const d = Math.hypot(gx - b.pos.x, b.pos.z);
        if (inBox) r.boxShots++;
        if (d > 22) r.longShots++;
        if (d >= 25) r.long25++;
        if (b.pos.y > 1) r.headerShots++;
        shotDone('unresolved');
        shot = { side: k.side, d, header: m.kickKind === 'header' };
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
  r.possession = [m.stats.possession[0], m.stats.possession[1]];
  r.shotsSide = [m.stats.shots[0], m.stats.shots[1]];
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
  /** Through balls: completed / taken by the other side, %. */
  throughPct: number;
  throughLostPct: number;
  /** Launch speeds (m/s): mean and max per kind, `kind:mean/max`. */
  kickSpeeds: string;
  /** Fastest headed ball that wasn't a shot, and fastest clearance / lofted ball (m/s). */
  headerMax: number;
  clearMax: number;
  lobMax: number;
  /** Share (%) of a side's goals scored by its top scorer, summed over all the matches (same two clubs). */
  topScorerPct: number;
  /** Minutes of each side's first change of the match when it came in the second half (the forced one). */
  firstLateSubMinutes: number[];
  /** Open-play seconds a match, dead-ball seconds (out / restart / kick-off), and live as a share (%) of both plus the goal celebrations. */
  liveT: number;
  deadT: number;
  livePct: number;
  /** Shots from 25 m or more a match, and the share (%) of them that went in. */
  long25: number;
  long25GoalPct: number;
  /** Share (%) of all goals scored with the head. */
  headerGoalPct: number;
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
    throughPct: (() => {
      const a = list.reduce((x, r) => x + (r.lostByKind.through?.[0] ?? 0), 0);
      return (list.reduce((x, r) => x + (r.byKind.through?.[1] ?? 0), 0) / Math.max(1, a)) * 100;
    })(),
    throughLostPct: (() => {
      const a = list.reduce((x, r) => x + (r.lostByKind.through?.[0] ?? 0), 0);
      return (list.reduce((x, r) => x + (r.lostByKind.through?.[1] ?? 0), 0) / Math.max(1, a)) * 100;
    })(),
    kickSpeeds: (() => {
      const agg: Record<string, [number, number, number]> = {};
      for (const r of list) {
        for (const [k, v] of Object.entries(r.kickSpeed)) {
          const a = (agg[k] ??= [0, 0, 0]);
          a[0] += v[0];
          a[1] += v[1];
          a[2] = Math.max(a[2], v[2]);
        }
      }
      return Object.entries(agg).map(([k, v]) => `${k}:${(v[1] / Math.max(1, v[0])).toFixed(1)}/${v[2].toFixed(1)}`).join(' ');
    })(),
    headerMax: Math.max(0, ...list.map((r) => r.kickSpeed.header?.[2] ?? 0)),
    clearMax: Math.max(0, ...list.map((r) => r.kickSpeed.clear?.[2] ?? 0)),
    lobMax: Math.max(0, ...list.map((r) => r.kickSpeed.lob?.[2] ?? 0)),
    topScorerPct: (() => {
      const bySide: [Record<string, number>, Record<string, number>] = [{}, {}];
      for (const r of list) {
        for (const [k, v] of Object.entries(r.scorers)) {
          const side = Number(k.split(':')[0]) as Side;
          bySide[side][k] = (bySide[side][k] ?? 0) + v;
        }
      }
      let top = 0;
      let tot = 0;
      for (const s of bySide) {
        const vals = Object.values(s);
        top += Math.max(0, ...vals);
        tot += vals.reduce((a, v) => a + v, 0);
      }
      return (top / Math.max(1, tot)) * 100;
    })(),
    firstLateSubMinutes: list.flatMap((r) => r.subLog.filter((x) => x.first).map((x) => x.minute)),
    liveT: avg((r) => r.liveT),
    deadT: avg((r) => r.deadT),
    livePct: (sum((r) => r.liveT) / Math.max(1, sum((r) => r.liveT + r.deadT + r.goalT))) * 100,
    long25: avg((r) => r.long25),
    long25GoalPct: (sum((r) => r.long25Goals) / Math.max(1, sum((r) => r.long25))) * 100,
    headerGoalPct: (sum((r) => r.headerGoals) / Math.max(1, goals)) * 100,
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
    .map(([k, v]) => `${k.padEnd(18)} ${typeof v === 'number' ? v.toFixed(2) : Array.isArray(v) ? v.join(',') : v}`)
    .join('\n');
}
