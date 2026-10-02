/**
 * Football Moments on the sim: `applyScenario` sets a match up as a short scripted situation (score, clock,
 * placements, the ball, a restart, ten men, a Blitz cube) and `judgeScenario` grades it every step.
 *
 * Coordinates in a ScenarioSpec are metres in the HUMAN's attacking frame: +x is the goal the human side
 * shoots at, x = +HALF_L its goal line, z = +HALF_W the touchline on the camera side. applyScenario mirrors
 * them (a 180° turn, like Match.setupKickoff) when the human attacks -x, so a spec reads the same whichever
 * side or half it runs in. Facings are radians in that frame (0 = towards the goal you attack).
 *
 * TIME: the moment's `seconds` are seconds of LIVE play. Match.clock runs while the ball is dead too ('out'
 * and 'restart' phases: the wait for a corner, a keeper's hold before a goal kick), so the judge keeps its own
 * count of the clock's advance during the 'play' phase only. A corner moment isn't burned by the restart wait
 * (a human taker has HUMAN_RESTART_WINDOW s to take it, none of which counts), and a goal celebration doesn't
 * count either. Use `scenarioSecondsLeft` for the HUD countdown, never `spec.clock + spec.seconds - m.clock`.
 *
 * ENDING: the judge never ends a moment mid-flight. At time-up with the ball in the air or a shot live it waits
 * up to SETTLE_S for it to land or go dead; a goal in that grace counts. It returns the same outcome object on
 * every call after the verdict; the session decides how to present it (the celebration first, then
 * `finishScenario` to blow the final whistle).
 *
 * Determinism: only `m.rng` (and only through the sim's own restart set-up).
 */
import { blitzClear, blitzState } from './blitz';
import { pickReceiver } from './actions';
import { BALL_R, HALF_L, HALF_W, PEN_SPOT, SIX_DEPTH, SIX_W } from './constants';
import type { Match, Pad, Restart } from './match';
import type { Player } from './player';
import type { ScenarioSpec, Side } from './types';

/** How a Football Moment ended (stars 0 = failed). */
export interface ScenarioOutcome {
  won: boolean;
  stars: 0 | 1 | 2 | 3;
  /** Seconds of the moment left when it ended (0 when time ran out). */
  secondsLeft: number;
}

/** All scenario setup fields are part of the shared simulation contract. */
export type FullScenarioSpec = ScenarioSpec;

/** At time-up, how long (s of play) a live shot / airborne ball gets to settle before the verdict. */
export const SETTLE_S = 1.5;
/** A shot struck within this long (s) still counts as live at time-up. */
const LIVE_SHOT_S = 1.5;
/** The ball this high (m) at time-up is still in the air: wait for it. */
const AIRBORNE_Y = 0.9;
/** Random Blitz spawns hold off this long (s of play) when a moment pre-places its cubes. */
const BLITZ_SPAWN_HOLD = 9;
/** Dead-ball allowance (s) on top of twice the moment's length when the half is stretched to hold it. */
const HALF_SLACK_S = 30;
/** Default star thresholds by goal (see judgeScenario). */
const DEFAULT_STARS: Record<ScenarioSpec['goal'], (spec: ScenarioSpec) => [number, number, number]> = {
  score: (s) => [0, s.seconds * 0.4, s.seconds * 0.65],
  'complete-pass': () => [0, 0, 0],
  lead: () => [1, 2, 3],
  'no-concede': () => [0, 30, 50],
  'draw-or-better': () => [0, 1, 2],
  'win-shootout': () => [0, 1, 2],
};

/** Per-match judge bookkeeping (keyed by the match: the judge is stateless for its callers). */
interface JudgeState {
  /** Seconds of live play since the moment began. */
  played: number;
  lastClock: number;
  /** The score when the moment began. */
  score0: [number, number];
  /** Live seconds each side had the ball at a man's feet. */
  poss: [number, number];
  /** Match clock when the time-up grace began (-1: not waiting). */
  graceFrom: number;
  done: ScenarioOutcome | null;
  initialKick: number;
  passKick: number;
  passTarget: number;
  requiredKick: boolean;
  /** The human has played: a stick push or a button on some step of the moment (padUsed). */
  engaged: boolean;
}

const STATES = new WeakMap<Match, JudgeState>();

/** A pad with something on it: the stick pushed, or any button. */
function padUsed(p: Pad): boolean {
  return Math.hypot(p.mx, p.mz) > 0.3 || p.pass || p.shoot || p.through || p.sprint || !!p.power || !!p.skill;
}

function stateOf(m: Match, spec: ScenarioSpec): JudgeState {
  let st = STATES.get(m);
  if (!st) {
    st = { played: 0, lastClock: m.clock, score0: [spec.score[0], spec.score[1]], poss: [0, 0], graceFrom: -1, done: null,
      initialKick: m.kickId, passKick: -1, passTarget: -1, requiredKick: false, engaged: false };
    STATES.set(m, st);
  }
  return st;
}

const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

function bySlot(m: Match, side: Side, slot: number): Player | undefined {
  return m.teamPlayers(side).find((p) => p.slot === slot) ?? m.teamPlayers(side)[slot];
}

/** Stand `p` at (x, z) (world), still, upright, facing `facing` (world), with no order or run in progress. */
function stand(p: Player, x: number, z: number, facing: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.vel.x = p.vel.z = 0;
  p.facing = facing;
  p.setState('move');
  p.order = null;
  p.y = 0;
  p.vy = 0;
  p.kickT = 0;
  p.wantX = p.wantZ = 0;
  p.running = false;
  p.giveGoT = 0;
  p.claiming = false;
  p.commitT = 0;
  p.jockeyT = 0;
  p.touchT = 0;
}

function giveBall(m: Match, p: Player): void {
  m.ball.reset(p.footX(), p.footZ());
  m.ball.owner = p.idx;
  m.ball.held = false;
  m.ball.lastTouch = p.idx;
  m.ball.lastTouchSide = p.side;
  p.ballT = 0;
}

/**
 * Set the match up for the moment: score and clock, everyone to his formation spot (or where the spec puts
 * him), the ball (at a man's feet, or loose, maybe rolling), ten men, Blitz cubes, and either open play or
 * one of the sim's own restarts (a corner / penalty / free kick set up the way the sim does it, so the AI
 * takes it properly and the set-piece shape is drawn). With a 'kickoff' restart the sim's kick-off placement
 * wins (listed players are ignored). Nothing is frozen: the session holds the sim for the brief.
 */
export function applyScenario(m: Match, spec: ScenarioSpec): void {
  const hs = spec.humanSide;
  m.offside = spec.offside ?? m.cfg.offside ?? true;
  // A penalty in a moment waits for the human's kick (it never goes on its own and scores for him).
  m.humanPenaltyWaits = true;
  const ad = m.attackDir(hs);
  // World point / facing from the human frame.
  const W = (px: number, pz: number): { x: number; z: number } => ({ x: px * ad, z: pz * ad });
  const F = (f: number): number => (ad > 0 ? f : f + Math.PI);

  m.score[0] = spec.score[0];
  m.score[1] = spec.score[1];
  m.clock = spec.clock;
  // The sim's own half-time must never come first: the half holds the moment twice over plus dead-ball time
  // (Match.clock runs while the ball is dead; the judge's count doesn't). Fatigue and the foul scale were set
  // from the configured length at construction and stay as they are; only the half-time trigger, the minute
  // shown and the Blitz AI's end-game item use read it from here on.
  m.cfg.halfLength = spec.untimed ? Number.MAX_SAFE_INTEGER : Math.max(m.cfg.halfLength, spec.clock + spec.seconds * 2 + HALF_SLACK_S);
  m.events.length = 0; // the constructor's kick-off notice: the moment starts its own way
  m.phase = 'play';
  m.phaseT = 0;
  m.restart = null;
  m['pendingRestart'] = null;
  m.ctl[0].queuedKick = m.ctl[1].queuedKick = null;
  m['offWatch'] = null;
  m['adv'] = null;
  m.passTarget = -1;
  m.shotClock = 99;
  m.sinceKick = 99;
  m.sincePossession = 0;
  m.possessionSide = -1;
  m.celebHero = -1;
  m.ball.owner = -1;
  m.ball.held = false;

  // Everyone to his formation spot, facing the goal he attacks.
  for (const p of m.players) {
    if (p.sentOff) continue;
    const pad = m.attackDir(p.side);
    const s = m.slots[p.side][p.slot];
    stand(p, s.x * HALF_L * pad, s.z * HALF_W * pad, pad > 0 ? 0 : Math.PI);
  }
  for (const e of spec.players ?? []) {
    const p = bySlot(m, e.side, e.slot);
    if (!p || p.sentOff) continue;
    const w = W(e.x, e.z);
    const pad = m.attackDir(e.side);
    stand(p, w.x, w.z, e.facing === undefined ? (pad > 0 ? 0 : Math.PI) : F(e.facing));
  }
  // Ten men: off he goes, and he's already by the dugout (no walk-off during the brief).
  for (const e of spec.sentOff ?? []) {
    const p = bySlot(m, e.side, e.slot);
    if (!p || p.sentOff) continue;
    m.sendOff(p);
    const n = m.teamPlayers(e.side).filter((q) => q.sentOff).length;
    p.pos.x = (e.side === 0 ? -1 : 1) * (13.4 + (n - 1) * 1.2);
    p.pos.z = HALF_W + 2;
    p.vel.x = p.vel.z = 0;
  }
  // The AI re-reads the situation: no stale presser / marks / set-piece shape from the kick-off.
  for (const br of m.brains) {
    br.think = 0;
    br.chaser = br.presser = br.cover = br.supporter = br.supporter2 = -1;
    br.marks.clear();
    br.boxZones.clear();
    br.spFor = null;
  }

  // The ball.
  const b = m.ball;
  const owner = spec.owner ? bySlot(m, spec.owner.side, spec.owner.slot) : undefined;
  if (owner && !owner.sentOff) {
    giveBall(m, owner);
  } else if (spec.ball) {
    const w = W(spec.ball.x, spec.ball.z);
    b.reset(w.x, w.z);
    b.pos.y = spec.ball.y ?? BALL_R;
    b.vel.x = (spec.ball.vx ?? 0) * ad;
    b.vel.y = spec.ball.vy ?? 0;
    b.vel.z = (spec.ball.vz ?? 0) * ad;
    b.lastTouchSide = hs;
    if (b.hspeed() > 0.5) {
      // A ball on its way: the human's nearest man behind it played it, the one nearest where it's going
      // meets it (the receive assist and auto-switch read Match.passTarget / kick bookkeeping).
      const passer = nearest(m, hs, w.x - b.vel.x * 0.4, w.z - b.vel.z * 0.4, true);
      const target = nearest(m, hs, w.x + b.vel.x * 1.2, w.z + b.vel.z * 1.2, true, passer);
      b.lastTouch = passer;
      m.kickSide = hs;
      m.kickKind = 'pass';
      m.kickX = w.x;
      m.kickZ = w.z;
      m.sinceKick = 0;
      if (target >= 0) m.passTarget = target;
    }
  } else {
    b.reset(0, 0);
    b.lastTouchSide = hs;
  }

  // Blitz: cubes lying ready (t = 0: collectable at once), the random ones held off for a while.
  if (m.cfg.mode === 'blitz' && spec.powerups?.length) {
    const s = blitzState(m);
    for (const pu of spec.powerups) {
      const w = W(pu.x, pu.z);
      const id = s.nextId++;
      m.powerups.push({ id, kind: pu.kind, x: w.x, z: w.z, t: 0 });
      m.events.push({ type: 'powerupSpawn', id, kind: pu.kind, x: w.x, z: w.z });
    }
    s.spawnT = Math.max(s.spawnT, BLITZ_SPAWN_HOLD);
  }

  // The restart, if any: the sim's own set-up (goOut queues it; the 'out' beat then beginRestart draws the
  // set-piece shape and picks the taker).
  if (spec.restart === 'kickoff') {
    m.setupKickoff(hs);
  } else if (spec.restart) {
    let rx: number;
    let rz: number;
    switch (spec.restart) {
      case 'corner': {
        const side = Math.sign(spec.ball?.z ?? 1) || 1;
        rx = ad * (HALF_L - 0.35);
        rz = side * ad * (HALF_W - 0.35);
        break;
      }
      case 'penalty':
        rx = ad * (HALF_L - PEN_SPOT);
        rz = 0;
        break;
      case 'goalkick':
        rx = -ad * (HALF_L - SIX_DEPTH);
        rz = ad * (Math.sign(spec.ball?.z ?? 1) || 1) * (SIX_W / 2) * 0.55;
        break;
      case 'throwin': {
        const w = W(spec.ball?.x ?? 0, spec.ball?.z ?? HALF_W);
        rx = Math.max(-HALF_L + 1, Math.min(HALF_L - 1, w.x));
        rz = (Math.sign(w.z) || 1) * HALF_W;
        break;
      }
      default: {
        // A free kick where the spec puts the ball (22 m out, central, if it doesn't say).
        const w = W(spec.ball?.x ?? HALF_L - 22, spec.ball?.z ?? 0);
        rx = w.x;
        rz = w.z;
      }
    }
    m.ball.reset(rx, rz);
    m['goOut'](spec.restart, hs, rx, rz);
  }

  // The human's man: the ball carrier, else the man a rolling ball is going to, else whoever's nearest it.
  if (m.human[hs]) {
    m.ctl[hs].active = owner && owner.side === hs && !owner.sentOff ? owner.idx : m.passTarget >= 0 ? m.passTarget : nearest(m, hs, b.pos.x, b.pos.z, true);
    if (owner && owner.side === hs && !owner.sentOff) {
      m.ctl[hs].passPreview = pickReceiver(m, owner, Math.cos(owner.facing), Math.sin(owner.facing), 'pass');
    }
  }
  m.updateBallPath();

  // A shootout moment: straight to the spot.
  if (spec.goal === 'win-shootout') m['startShootout']();

  STATES.delete(m);
  stateOf(m, spec);
}

/** Index of `side`'s player nearest (x, z), outfielders only when `skipKeeper`; -1 with nobody. */
function nearest(m: Match, side: Side, x: number, z: number, skipKeeper: boolean, exclude = -1): number {
  let best = -1;
  let bd = Infinity;
  for (const p of m.teamPlayers(side)) {
    if (p.sentOff || p.idx === exclude || (skipKeeper && p.isKeeper)) continue;
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (d < bd) {
      bd = d;
      best = p.idx;
    }
  }
  return best;
}

/** Seconds of the moment still to play (live play only: see the header). */
export function scenarioSecondsLeft(m: Match, spec: ScenarioSpec): number {
  const st = STATES.get(m);
  return spec.untimed || !st ? spec.seconds : Math.max(0, spec.seconds - st.played);
}

/** Live seconds each side has had the ball at a man's feet during the moment (for a possession read-out). */
export function scenarioPossession(m: Match): [number, number] {
  const st = STATES.get(m);
  return st ? [st.poss[0], st.poss[1]] : [0, 0];
}

/** Stars for `value` against rising thresholds: one per threshold met, at least `min`, at most 3. */
function starsFor(value: number, th: [number, number, number], min: 0 | 1): 0 | 1 | 2 | 3 {
  let s = 0;
  for (const t of th) if (value >= t - 1e-9) s++;
  return Math.max(min, Math.min(3, s)) as 0 | 1 | 2 | 3;
}

/**
 * Judge the moment (call once a step, after Match.step): null while it's still on, else the outcome (the
 * same object on every later call). The session then ends the match (see finishScenario) and hands the
 * outcome to the full-time screen.
 *
 * By `goal` (stars from `spec.stars`, defaults in DEFAULT_STARS):
 *  - 'score': won the moment the human side scores; stars by the seconds LEFT (≥ stars[i] → i+1 stars; a goal
 *    is always one). Lost at time-up, or at once if the other side scores.
 *  - 'lead': judged at time-up: won if ahead; stars by the margin, a clean sheet over the moment counting one
 *    extra (1–0 clean = 2 with [1, 2, 3]; 2–0 = 3; 2–1 = 2).
 *  - 'draw-or-better' (come-backs): judged at time-up: won if level or ahead; stars by the final margin
 *    ([0, 1, 2]: a draw one, a win two, by two clear three).
 *  - 'no-concede': lost at once on a goal against; won at time-up; stars by the human side's share (%) of the
 *    live time either side had the ball ([0, 30, 50]); a goal at the other end is three.
 *  - 'win-shootout': the sim's shootout result; stars by the kicks margin ([0, 1, 2]).
 * Whatever the goal, a human who never pushed the stick or pressed a button in the moment doesn't win it.
 */
export function judgeScenario(m: Match, spec: ScenarioSpec): ScenarioOutcome | null {
  const st = stateOf(m, spec);
  if (st.done) return st.done;
  const hs = spec.humanSide;
  const os = otherSide(hs);
  const th = spec.stars ?? DEFAULT_STARS[spec.goal](spec);
  // The moment is the human's to win: while he touches nothing (no stick, no button on any step), nothing the
  // AI does for his side (a foul on his idle striker and its kick, a team-mate's goal, a hold-out) completes or
  // stars it. (Called after every Match.step, so ctl.prev is that step's pad. A side no human plays: no test.)
  if (!st.engaged && (!m.human[hs] || padUsed(m.ctl[hs].prev))) st.engaged = true;

  // Live time (and possession) only.
  const d = m.clock - st.lastClock;
  st.lastClock = m.clock;
  if (m.phase === 'play' && d > 0 && d < 1) {
    st.played += d;
    const o = m.ball.owner;
    if (o >= 0 && !m.ball.held) st.poss[m.players[o].side] += d;
  }
  const left = spec.untimed ? spec.seconds : Math.max(0, spec.seconds - st.played);
  const goalsFor = m.score[hs] - st.score0[hs];
  const against = m.score[os] - st.score0[os];
  const margin = m.score[hs] - m.score[os];
  const finish = (won0: boolean, stars: 0 | 1 | 2 | 3, secondsLeft = left): ScenarioOutcome => {
    const won = won0 && st.engaged;
    st.done = { won, stars: won ? stars : 0, secondsLeft: Math.round(secondsLeft * 10) / 10 };
    return st.done;
  };

  if (m.kickId !== st.initialKick && m.kickSide === hs && m.kickKind === spec.requireKick) st.requiredKick = true;

  switch (spec.goal) {
    case 'score':
      if (goalsFor > 0) return finish(!spec.requireKick || st.requiredKick, starsFor(left, th, 1));
      if (against > 0) return finish(false, 0);
      break;
    case 'complete-pass':
      // A kick alone is not a completed pass. Remember its intended receiver while it is travelling,
      // then require that same teammate to control it, without an intervening kick or lost possession.
      if (m.kickId !== st.initialKick && m.kickKind === 'pass' && m.kickSide === hs && m.passTarget >= 0 && m.ball.owner < 0 && m.ball.lastTouchSide === hs) {
        st.passKick = m.kickId;
        st.passTarget = m.passTarget;
      }
      if (st.passTarget >= 0 && m.kickId === st.passKick && m.ball.owner === st.passTarget &&
        m.players[st.passTarget]?.side === hs && m.ball.lastTouchSide === hs) return finish(true, 3);
      if (m.ball.lastTouchSide !== hs) st.passTarget = -1;
      if (against > 0 || goalsFor > 0) return finish(false, 0);
      break;
    case 'no-concede':
      if (against > 0) return finish(false, 0);
      break;
    case 'win-shootout': {
      const so = m.shootout;
      if (so && so.winner >= 0) {
        const goals = (k: boolean[]) => k.filter(Boolean).length;
        const won = so.winner === hs;
        return finish(won, starsFor(goals(so.kicks[hs]) - goals(so.kicks[os]), th, 1), spec.seconds);
      }
      return null;
    }
    default:
      break;
  }
  if (spec.untimed || left > 0) return null;

  // Time-up. A shot live or the ball in the air: give it SETTLE_S to land or go dead (a goal then counts).
  const b = m.ball.pos;
  if (m.phase === 'play' && (m.shotClock < LIVE_SHOT_S || b.y > AIRBORNE_Y)) {
    if (st.graceFrom < 0) st.graceFrom = m.clock;
    if (m.clock - st.graceFrom < SETTLE_S) return null;
  }
  switch (spec.goal) {
    case 'lead': {
      if (margin <= 0) return finish(false, 0, 0);
      return finish(true, starsFor(margin + (against === 0 ? 1 : 0), th, 1), 0);
    }
    case 'draw-or-better':
      if (margin < 0) return finish(false, 0, 0);
      return finish(true, starsFor(margin, th, 1), 0);
    case 'no-concede': {
      if (goalsFor > 0) return finish(true, 3, 0);
      const total = st.poss[0] + st.poss[1];
      const share = total > 0 ? (100 * st.poss[hs]) / total : 0;
      return finish(true, starsFor(share, th, 1), 0);
    }
    default:
      return finish(false, 0, 0);
  }
}

/**
 * Blow the final whistle on a settled moment: the sim goes to 'fulltime' from wherever it is (open play, a
 * dead ball, a goal celebration) with the end-of-match events, the way Match ends a second half. Safe to
 * call more than once. (A shootout moment ends itself: the sim reaches 'fulltime' on the winning kick.)
 */
export function finishScenario(m: Match): void {
  if (m.phase === 'fulltime') return;
  if (m.cfg.mode === 'blitz') blitzClear(m);
  m.ball.owner = -1;
  m.ball.held = false;
  m['offWatch'] = null;
  m['adv'] = null;
  m['pendingRestart'] = null as Restart | null;
  for (const p of m.players) {
    p.order = null;
    p.wantX = p.wantZ = 0;
  }
  m.phase = 'fulltime';
  m.phaseT = 0;
  m.events.push({ type: 'whistle', kind: 'end' }, { type: 'fulltime' });
}
