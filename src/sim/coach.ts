import { STYLES, type StyleParams } from './ai';
import { HALF_L, HALF_W } from './constants';
import type { Match } from './match';
import type { CoachCover, CoachPlan, FormationId, KickKind, MatchEvent, Side } from './types';

/**
 * The AI coach (MatchConfig.coach): an AI side playing a human changes how it plays as the match goes, the way a
 * manager on the touchline does. The owner (2026-10-04): "The computer opponent adapts mid-game. If the player is
 * winning 2-0, the AI switches formations and presses higher, forcing the user to constantly think and adjust."
 *
 * It changes TACTICS only: the formation (Match.setFormation), the mentality (Match.mentality) and the style its team
 * brain reads (ai.ts styleOf: the line's height, the press, the runs in behind, how long the carrier holds it). No stat,
 * no pace, no finishing, no keeper is touched, and nothing here draws from the match's random generator, so a match is
 * the same on both machines and the same every time for the same pads.
 *
 * The plan, from the scoreline and the clock (planFor):
 * - losing by two or more, or by one from COACH_CHASE_FROM of the match: CHASE (a more attacking shape, the line up,
 *   the press on in his half with a third man, more runners in behind);
 * - losing late (by two from COACH_ALLOUT_TWO, by one from COACH_ALLOUT_ONE): ALL OUT (the same, more of it);
 * - winning late (by one from COACH_HOLD_ONE, by two or more from COACH_HOLD_TWO): HOLD (a more defensive shape, a
 *   low block that screens instead of pressing, the ball kept longer, the break when it is on);
 * - level but pinned back (the human COACH_FLOW_SHOTS shots up over the last COACH_FLOW_WINDOW of the match, the AI with
 *   one at most): CHASE, to get up the pitch;
 * - otherwise its own way (BASE).
 * A change waits for a dead ball (a goal, the ball out, half time), COACH_WAIT_S of open play at most, and there are
 * COACH_GAP_S between two that no goal brought about.
 *
 * The cover: how the human's goals came (his pass before it struck from a wing in the last third, a through ball or a
 * ball over the top, a shot from COACH_RANGE_D m or more). Two the same way and the side moves to stop it: the block
 * slides to that wing and widens, the line drops, or the midfield sits on the edge of the box.
 *
 * Every change is a 'tactics' event (the commentary ticker says it: "LAKEMOOR GO 4-3-3, PRESSING HIGH").
 */

/** Share of the match played (0..1) from which each plan is on: see the file comment. */
export const COACH_CHASE_FROM = 0.55;
export const COACH_ALLOUT_TWO = 0.72;
export const COACH_ALLOUT_ONE = 0.86;
export const COACH_HOLD_ONE = 0.72;
export const COACH_HOLD_TWO = 0.5;
/** Pinned back: the human this many shots up over this share of the match, from COACH_FLOW_FROM of it on. */
export const COACH_FLOW_SHOTS = 4;
export const COACH_FLOW_WINDOW = 0.3;
const COACH_FLOW_FROM = 0.25;
/** Seconds (of the match clock) between two changes of plan no goal brought about, and the longest one waits in open play. */
export const COACH_GAP_S = 20;
export const COACH_WAIT_S = 8;
/** A goal struck from this far (m) is one from range; his pass counts for a goal scored within COACH_PASS_S s of it. */
export const COACH_RANGE_D = 18;
const COACH_PASS_S = 7;
/** A side whose human is being eased (MatchConfig.assist at or over this) never shuts up shop on him. */
const COACH_EASED = 0.3;
/** How far (m, world z) the block slides to the wing it is covering. */
const COACH_FLANK_M = 3.5;

/** The shape a side goes to when it has to score, and when it has a lead to keep. */
const ATTACK_SHAPE: Record<FormationId, FormationId> = {
  '4-4-2': '4-3-3', '4-2-3-1': '4-3-3', '5-3-2': '3-5-2', '3-5-2': '4-3-3', '4-3-3': '3-5-2',
};
const HOLD_SHAPE: Record<FormationId, FormationId> = {
  '4-4-2': '5-3-2', '4-3-3': '4-4-2', '4-2-3-1': '5-3-2', '3-5-2': '5-3-2', '5-3-2': '5-3-2',
};

export interface CoachState {
  plan: CoachPlan;
  cover: CoachCover | null;
  /** The shape it came out in (its own way). */
  baseFormation: FormationId;
  /** The style it plays now: its club's, changed by the plan and the cover (ai.ts styleOf reads it). */
  style: StyleParams;
  /** Match time (s, both halves) of its last change of plan, and the goals in the match when it was made. */
  changedAt: number;
  changedGoals: number;
  /** The plan it wants while it waits for a dead ball, and since when. */
  want: CoachPlan;
  wantSince: number;
  /** The human's goals and the last kick it has looked at. */
  seenGoals: number;
  seenKick: number;
  /** The human's last pass in open play: its kind, where it was struck from, when (match time). */
  pass: { kind: KickKind; x: number; z: number; t: number } | null;
  /** How the human's goals came. */
  ways: Record<CoachCover, number>;
  /** Both sides' shots, sampled through the match (the flow). */
  flow: { t: number; mine: number; his: number }[];
  /** Changes of plan and of cover made this match. */
  changes: number;
  /** A change made under a goal's celebration or at half time, to be announced when play is about to go on. */
  say: Extract<MatchEvent, { type: 'tactics' }>[];
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

/** Seconds of the match played (both halves; added time counts as the half's last second). */
function matchTime(m: Match): number {
  return (m.half - 1) * m.cfg.halfLength + Math.min(m.clock, m.cfg.halfLength);
}

function baseStyle(m: Match, side: Side): StyleParams {
  return STYLES[m.teams[side].style ?? 'balanced'] ?? STYLES.balanced;
}

/**
 * `base` as it is played under `plan`, covering `cover` (world z: 'wingL' is -z). Tactics only: see the file comment.
 */
export function coachStyle(base: StyleParams, plan: CoachPlan, cover: CoachCover | null): StyleParams {
  const s: StyleParams = { ...base };
  if (plan === 'chase' || plan === 'allout') {
    const all = plan === 'allout';
    s.line = Math.min(0.22, base.line + (all ? 0.15 : 0.11));
    s.lineMax = Math.max(base.lineMax, all ? 0.06 : 0);
    s.fwdGap = Math.max(base.fwdGap, 0.36);
    s.pressFrom = 1;
    s.pressRate = Math.max(base.pressRate, all ? 1.4 : 1.25);
    s.pressHigh = Math.max(base.pressHigh, all ? 2.6 : 2.2);
    s.trap = true;
    s.safe = base.safe * (all ? 0.8 : 0.9);
    s.forward = base.forward + (all ? 0.25 : 0.15);
    s.hold = base.hold * (all ? 0.75 : 0.85);
    s.shoot = base.shoot * (all ? 1.15 : 1.05);
    s.counter = Math.max(base.counter, 1.5);
    s.runs = base.runs * (all ? 1.4 : 1.2);
  } else if (plan === 'hold') {
    s.line = base.line - 0.08;
    s.lineMax = Math.min(base.lineMax, -0.34);
    s.midMin = 0.17;
    s.midMax = 0.22;
    s.fwdGap = Math.min(base.fwdGap, 0.28);
    s.defWidth = base.defWidth * 0.9;
    s.pressFrom = Math.min(base.pressFrom, 0.05);
    s.pressHigh = 1;
    s.trap = false;
    s.safe = base.safe * 1.4;
    s.hold = base.hold * 1.5;
    s.shoot = base.shoot * 0.9;
    s.direct = Math.max(base.direct, 0.006);
    s.counter = Math.max(base.counter, 3.5);
    s.runs = base.runs * 0.85;
  }
  if (cover === 'wingL' || cover === 'wingR') {
    s.defWidth = Math.min(1.15, s.defWidth * 1.12);
    s.flank = (cover === 'wingL' ? -1 : 1) * COACH_FLANK_M;
  } else if (cover === 'behind') {
    s.line -= 0.07;
    s.lineMax = Math.min(s.lineMax, base.lineMax - 0.12);
  } else if (cover === 'range') {
    s.midMin = Math.min(s.midMin, 0.1);
    s.midMax = Math.min(s.midMax, 0.2);
  }
  return s;
}

function makeCoach(m: Match, side: Side): CoachState {
  return {
    plan: 'base', cover: null, baseFormation: m.formation[side], style: baseStyle(m, side),
    changedAt: -COACH_GAP_S, changedGoals: m.score[0] + m.score[1], want: 'base', wantSince: 0,
    seenGoals: m.score[other(side)], seenKick: m.kickId, pass: null,
    ways: { wingL: 0, wingR: 0, behind: 0, range: 0 }, flow: [], changes: 0, say: [],
  };
}

/**
 * The plan for a side `diff` goals up (down: negative) with `played` of the match gone (0..1), `flow` its shots less
 * the human's over the last COACH_FLOW_WINDOW (and `mine` its own in that time); `eased`: the human is being eased
 * (dynamic difficulty), so no shutting up shop.
 */
export function planFor(diff: number, played: number, flow = 0, mine = 9, eased = false): CoachPlan {
  if (diff <= -2) return played >= COACH_ALLOUT_TWO ? 'allout' : 'chase';
  if (diff === -1) return played >= COACH_ALLOUT_ONE ? 'allout' : played >= COACH_CHASE_FROM ? 'chase' : 'base';
  if (diff === 1) return played >= COACH_HOLD_ONE && !eased ? 'hold' : 'base';
  if (diff >= 2) return played >= COACH_HOLD_TWO && !eased ? 'hold' : 'base';
  return played >= COACH_FLOW_FROM && flow <= -COACH_FLOW_SHOTS && mine <= 1 ? 'chase' : 'base';
}

/** Once a step (Match.step, every phase): each coached side watches the match and changes its plan when it should. */
export function coachStep(m: Match): void {
  if (!m.cfg.coach || m.cfg.firstMatch || m.phase === 'shootout' || m.phase === 'fulltime') return;
  for (const side of [0, 1] as Side[]) {
    const opp = other(side);
    // (An AI side against a human: never a side a human plays, never AI v AI.)
    if (m.human[side] || !m.human[opp]) continue;
    const c = (m.coach[side] ??= makeCoach(m, side));
    watch(m, side, c);
    decide(m, side, c);
    // (Said once the goal's celebration and the break are over: the ticker is the goal's until then.)
    if (c.say.length && m.phase !== 'goal' && m.phase !== 'halftime') {
      m.events.push(...c.say);
      c.say.length = 0;
    }
  }
}

/** The human's passes, his goals and how they came, and both sides' shots through the match. */
function watch(m: Match, side: Side, c: CoachState): void {
  const opp = other(side);
  const now = matchTime(m);
  if (m.kickId !== c.seenKick) {
    c.seenKick = m.kickId;
    const k = m.kickKind;
    // (His passes in open play: not a corner or a free kick's delivery.)
    if (m.kickSide === opp && (k === 'pass' || k === 'through' || k === 'lob') && m.setPieceKick !== m.kickId) {
      c.pass = { kind: k, x: m.ball.pos.x, z: m.ball.pos.z, t: now };
    }
  }
  const g = m.score[opp];
  if (g !== c.seenGoals) {
    const rec = m.goals[m.goals.length - 1];
    if (g > c.seenGoals && rec && rec.side === opp && !rec.own) {
      const ad = m.attackDir(opp);
      const pass = c.pass && now - c.pass.t <= COACH_PASS_S ? c.pass : null;
      const wide = !!pass && Math.abs(pass.z) > HALF_W * 0.5 && pass.x * ad > HALF_L * 0.3;
      let way: CoachCover | null = null;
      if (m.kickKind === 'shot' && m.shotDist >= COACH_RANGE_D) way = 'range';
      else if (pass && wide) way = pass.z > 0 ? 'wingR' : 'wingL';
      else if (pass && (pass.kind === 'through' || pass.kind === 'lob')) way = 'behind';
      if (way) {
        c.ways[way]++;
        // Two the same way (and no other way more often): it moves to stop it.
        let best: CoachCover | null = null;
        for (const w of ['wingL', 'wingR', 'behind', 'range'] as CoachCover[]) {
          if (c.ways[w] >= 2 && (!best || c.ways[w] > c.ways[best])) best = w;
        }
        if (best && best !== c.cover) {
          c.cover = best;
          c.style = coachStyle(baseStyle(m, side), c.plan, c.cover);
          c.changes++;
          c.say.push({ type: 'tactics', side, plan: c.plan, formation: m.formation[side], shape: false, cover: best });
        }
      }
    }
    c.seenGoals = g;
    c.pass = null;
  }
  // The flow: both sides' shots, sampled every twentieth of the match.
  const total = m.cfg.halfLength * 2;
  const last = c.flow[c.flow.length - 1];
  if (!last || now - last.t >= total * 0.05) c.flow.push({ t: now, mine: m.stats.shots[side], his: m.stats.shots[opp] });
}

function decide(m: Match, side: Side, c: CoachState): void {
  const opp = other(side);
  const now = matchTime(m);
  const total = m.cfg.halfLength * 2;
  // Shots over the last COACH_FLOW_WINDOW of the match: ours, and ours less his.
  let from = c.flow[0];
  for (const f of c.flow) if (f.t <= now - total * COACH_FLOW_WINDOW) from = f;
  const mine = from ? m.stats.shots[side] - from.mine : 0;
  const his = from ? m.stats.shots[opp] - from.his : 0;
  const want = planFor(m.score[side] - m.score[opp], now / total, mine - his, mine, (m.cfg.assist ?? 0) >= COACH_EASED);
  if (want !== c.want) {
    c.want = want;
    c.wantSince = now;
  }
  if (want === c.plan) return;
  // A goal since the last change makes the next one at once; otherwise COACH_GAP_S between two.
  const goals = m.score[0] + m.score[1];
  if (goals === c.changedGoals && now - c.changedAt < COACH_GAP_S) return;
  // Made at a dead ball; in open play only once it has waited COACH_WAIT_S (never with a restart lined up).
  const dead = m.phase === 'goal' || m.phase === 'out' || m.phase === 'halftime';
  if (!dead && !(m.phase === 'play' && now - c.wantSince >= COACH_WAIT_S)) return;
  const formation = want === 'base' ? c.baseFormation : want === 'hold' ? HOLD_SHAPE[c.baseFormation] : ATTACK_SHAPE[c.baseFormation];
  const shape = formation !== m.formation[side] && m.setFormation(side, formation);
  m.mentality[side] = want === 'hold' ? -1 : want === 'base' ? 0 : 1;
  c.plan = want;
  c.style = coachStyle(baseStyle(m, side), want, c.cover);
  c.changedAt = now;
  c.changedGoals = goals;
  c.changes++;
  // (One line for the plan: a newer one replaces one not yet said.)
  c.say = c.say.filter((e) => e.cover !== null);
  c.say.push({ type: 'tactics', side, plan: want, formation: m.formation[side], shape, cover: null });
}
