import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { PRESENTATION } from '../src/game/matchSession';
import { intercept } from '../src/sim/ai';
import { DT, HALF_L } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, RestartKind, Side } from '../src/sim/types';
import { HumanBot, type BotOptions } from './humanBot';

/**
 * A playtester's stopwatch over WHOLE matches (2026-10-04, the owner: "gameplay does feel slow an boring", "hard to
 * control players"): the person-like bot (tests/humanBot.ts) on touch with AUTO SPRINT, casual, at the default
 * 2-minute halves, with the match session's presentation clock modelled around the sim (MatchSession.flow: the goal's
 * wide shot, celebration and replay, the half-time hold and menu, the full-time hold). It reports what a person
 * holding the phone lives through: how much of the time the ball is in play, how long each stoppage costs, how often
 * HE does something that matters, and how often the man he is given is the wrong one.
 *
 * Human side 0. Deterministic per seed.
 */
export interface PlaytestOptions {
  seed: number;
  difficulty?: number;
  halfLength?: number;
  home?: number;
  away?: number;
  bot?: BotOptions;
  /** The human's goal celebration hold (render/celebration.ts HOLD_S: classic 0, backflip 3.7...). */
  celebHoldS?: number;
  /** A SHOP goal explosion on (the 1.8 s wide shot after his goals). */
  explosion?: boolean;
  /** He taps through a replay this long after it starts (s); undefined: he watches it all. */
  replaySkipS?: number;
  /** He taps through a goal's celebration this long after it can be skipped (s); undefined: he watches it. */
  goalSkipS?: number;
  /** Seconds he spends on the half-time menu (reading the score, tapping SECOND HALF). */
  htMenuS?: number;
  /** He skips the pre-match fly-in this long in (s); undefined: he watches it. */
  introSkipS?: number;
  /** The AI coach (MatchConfig.coach, as the game's own matches have it): default off. */
  coach?: boolean;
}

export type DeadKind = RestartKind | 'goal' | 'replay' | 'halftime' | 'fulltime' | 'intro' | 'kickoffHalf';

export interface PlaytestMatch {
  gf: number;
  ga: number;
  /** Wall seconds by bucket. */
  wall: number;
  inPlay: number;
  dead: Record<string, number>;
  /** Stoppage episodes by kind: count and the longest (s). */
  stops: Record<string, { n: number; total: number; max: number }>;
  /** In play, but the ball in a keeper's hands (s): ours / theirs. */
  keeperHold: [number, number];
  /** His man on the floor / getting up / sliding while in play (s). */
  downT: number;
  /** Human possession spells (from our first control to their first control / a goal). */
  spells: number;
  spellsWithShot: number;
  spellWall: number;
  /** Seconds his controlled man had it at his feet. */
  onBall: number;
  /** Win-to-shot times (s) of the spells with a shot; same, for spells won in the attacking half. */
  winToShot: number[];
  winToShotAtt: number[];
  spellsAtt: number;
  spellsAttWithShot: number;
  /** Their (the AI's) spells: count, with a shot, wall s, and those that got into his defensive third. */
  theirSpells: number;
  theirShotSpells: number;
  theirSpellWall: number;
  theirDeep: number;
  shotsFor: number;
  shotsAgainst: number;
  onTargetFor: number;
  savesFor: number;
  savesAgainst: number;
  /** Meaningful actions of his: shot, skill move, through / key pass, tackle try, save by his keeper. */
  actions: { shot: number; skill: number; keyPass: number; tackle: number; save: number; won: number };
  /** Gaps between his meaningful actions (wall s). */
  actionGaps: number[];
  /** Defending samples (their ball, or loose from their touch): his man the right one / all. */
  defSamples: number;
  defRight: number;
  /** ...and how far off (s of intercept time) when wrong. */
  defOff: number;
  /** Seconds (in play, not ours) his man was > 20 m from the ball; standing (< 1 m/s) > 4 m from it while defending. */
  farT: number;
  idleT: number;
  /** Changes of his man: automatic (no press), by SWITCH, those that handed him a WORSE-placed man, and automatic flip-backs (to the man before, within 1.5 s). */
  autoSwitches: number;
  manualSwitches: number;
  wrongSwitches: number;
  flipBacks: number;
  /** His passes: count, to the man he picked (the bot's intent) / not, completed. */
  passes: number;
  /** ...of those, the ones he aimed at somebody in open play (not a restart's default). */
  passAimed: number;
  passIntended: number;
  passCmp: number;
  /** Mean ball speed (m/s) in play, loose; players' mean speed in play (all outfielders), his man's. */
  ballSpeed: number;
  playerSpeed: number;
  manSpeed: number;
  /** His side's time on the ball in the attacking third (share 0..1). */
  attThird: number;
}

const P = PRESENTATION;
/** MatchSession: the goal with no replay runs this long (s) before the kick-off (NO_REPLAY_AT); one against him (THEIR_GOAL_AT). */
const PX = P as typeof P & { noReplayAtS?: number; theirGoalAtS?: number; goalSkipGraceS?: number };
export const NO_REPLAY_AT = PX.noReplayAtS ?? 3.4;
const THEIR_GOAL_AT = PX.theirGoalAtS ?? NO_REPLAY_AT;
/** A tap after the wide shot skips the rest (the session since 2026-10-04; undefined before: nothing to tap). */
const SKIP_GRACE = PX.goalSkipGraceS;
/** The replay's wall time when watched to the end. */
export const REPLAY_WALL = (P.replayLeadS - P.slowFromS) / P.buildRate + (P.slowFromS + P.replayTailS) / P.slowRate;

const HS: Side = 0;

/**
 * How soon each of his outfielders wins the ball (idx -> s): to the first point of its path he can reach, or, for
 * their pass on its way, to where its receiver takes it if he can't get to the ball's line before him (past the
 * receiver the predicted flight runs on through a man who will have controlled it).
 */
function interceptTimes(m: Match): Map<number, number> {
  const out = new Map<number, number>();
  const b = m.ball;
  const rcv = b.owner < 0 && m.passTarget >= 0 && m.players[m.passTarget].side !== HS ? m.players[m.passTarget] : null;
  const ri = rcv && rcv.state === 'move' ? intercept(m, rcv) : null;
  for (const p of m.teamPlayers(HS)) {
    if (p.isKeeper || p.sentOff) continue;
    const down = p.state !== 'move' && p.state !== 'kick';
    let t = intercept(m, p).t;
    if (ri && t > ri.t) t = Math.max(ri.t, Math.max(0, Math.hypot(p.pos.x - ri.x, p.pos.z - ri.z) - 0.55) / (p.top * 0.92));
    out.set(p.idx, t + (down ? 1 : 0));
  }
  return out;
}

function bestOf(t: Map<number, number>): { idx: number; t: number } {
  let idx = -1;
  let bt = Infinity;
  for (const [i, v] of t) if (v < bt) {
    bt = v;
    idx = i;
  }
  return { idx, t: bt };
}

/** The bot's intended receiver: HumanBot.pickTeammate's pick, recorded (a person points at somebody). */
type Spy = { lastPick: Player | null };
const proto = HumanBot.prototype as unknown as { pickTeammate: (m: Match, c: Player) => Player | null; __spied?: boolean };
if (!proto.__spied) {
  const orig = proto.pickTeammate;
  proto.pickTeammate = function (this: Spy, m: Match, c: Player) {
    const t = orig.call(this, m, c);
    this.lastPick = t;
    return t;
  };
  proto.__spied = true;
}

export function playtestMatch(o: PlaytestOptions): PlaytestMatch {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[o.home ?? 5]),
    away: makeTeam(PRESET_CLUBS[o.away ?? 6]),
    halfLength: o.halfLength ?? 120,
    difficulty: o.difficulty ?? 1.8,
    humanSide: HS,
    seed: o.seed,
    coach: o.coach,
  });
  const bot = new HumanBot(o.seed, { casual: true, sprint: 'auto', skills: 'react', ...o.bot });
  const spy = bot as unknown as Spy;
  const r: PlaytestMatch = {
    gf: 0, ga: 0, wall: 0, inPlay: 0, dead: {}, stops: {}, keeperHold: [0, 0], downT: 0,
    spells: 0, spellsWithShot: 0, spellWall: 0, onBall: 0, winToShot: [], winToShotAtt: [], spellsAtt: 0, spellsAttWithShot: 0,
    theirSpells: 0, theirShotSpells: 0, theirSpellWall: 0, theirDeep: 0,
    shotsFor: 0, shotsAgainst: 0, onTargetFor: 0, savesFor: 0, savesAgainst: 0,
    actions: { shot: 0, skill: 0, keyPass: 0, tackle: 0, save: 0, won: 0 }, actionGaps: [],
    defSamples: 0, defRight: 0, defOff: 0, farT: 0, idleT: 0,
    autoSwitches: 0, manualSwitches: 0, wrongSwitches: 0, flipBacks: 0,
    passes: 0, passAimed: 0, passIntended: 0, passCmp: 0, ballSpeed: 0, playerSpeed: 0, manSpeed: 0, attThird: 0,
  };
  const dead = (k: string, s: number) => (r.dead[k] = (r.dead[k] ?? 0) + s);
  // The pre-match fly-in.
  const intro = o.introSkipS ?? P.introS;
  dead('intro', intro);
  r.wall += intro;

  let stop: { kind: string; t: number } | null = { kind: 'kickoffHalf', t: 0 };
  const endStop = () => {
    if (!stop) return;
    const s = (r.stops[stop.kind] ??= { n: 0, total: 0, max: 0 });
    s.n++;
    s.total += stop.t;
    s.max = Math.max(s.max, stop.t);
    stop = null;
  };
  let lastAction = r.wall;
  const act = (k: keyof PlaytestMatch['actions']) => {
    r.actions[k]++;
    r.actionGaps.push(r.wall - lastAction);
    lastAction = r.wall;
  };
  // Possession spells.
  let own: Side | -1 = -1;
  let spell: { t0: number; shot: boolean; att: boolean } | null = null;
  let their: { t0: number; shot: boolean; deep: boolean } | null = null;
  const closeTheirs = () => {
    if (!their) return;
    r.theirSpells++;
    r.theirSpellWall += r.wall - their.t0;
    if (their.shot) r.theirShotSpells++;
    if (their.deep) r.theirDeep++;
    their = null;
  };
  const closeSpell = () => {
    if (!spell) return;
    r.spells++;
    r.spellWall += r.wall - spell.t0;
    if (spell.shot) r.spellsWithShot++;
    if (spell.att) {
      r.spellsAtt++;
      if (spell.shot) r.spellsAttWithShot++;
    }
    spell = null;
  };
  let ballN = 0;
  let playN = 0;
  let lastActive = -1;
  let lastPass = false;
  let prevActive = -1;
  let prevActiveT = -9;
  let passOpen: { kick: number; intended: number } | null = null;
  let thirds = [0, 0, 0];
  let frame = 0;
  let replayDone = false;
  let replayWanted = false;
  let celebLate = 0;

  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 20; steps++) {
    frame++;
    const phase = m.phase;
    const pad = bot.pad(m);
    const before = m.ball.owner;
    const activeBefore = m.active;
    // Their ball / loose off their touch: is his man the right one? (Sampled every 4th frame.)
    const b = m.ball;
    const theirs = b.owner >= 0 && m.players[b.owner].side !== HS && !b.held;
    const looseTheirs = b.owner < 0 && !b.held && b.lastTouchSide === 1 && !(m.passTarget >= 0 && m.players[m.passTarget].side === HS);
    if (phase === 'play' && (theirs || looseTheirs) && frame % 4 === 0 && m.active >= 0 && !m.players[m.active].isKeeper) {
      const ts = interceptTimes(m);
      const best = bestOf(ts);
      const mine = ts.get(m.active) ?? Infinity;
      r.defSamples++;
      if (mine <= best.t * 1.15 + 0.25) r.defRight++;
      else r.defOff += Math.min(5, mine - best.t);
    }
    const deadKind: string = phase === 'kickoff' ? (stop?.kind === 'kickoffHalf' ? 'kickoffHalf' : 'kickoff') : m.restart?.kind ?? 'out';
    m.step(DT, pad);
    const evs = m.drainEvents();
    bot.observe(m, evs, before);

    // ---- time
    r.wall += DT;
    if (phase === 'play') {
      r.inPlay += DT;
      endStop();
      if (b.held && b.owner >= 0) r.keeperHold[m.players[b.owner].side]++;
      const a = m.active >= 0 ? m.players[m.active] : null;
      if (a && a.state !== 'move' && a.state !== 'kick') r.downT += DT;
      if (a && b.owner === a.idx) r.onBall += DT;
      const ours = b.owner >= 0 && m.players[b.owner].side === HS;
      if (a && !ours) {
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        if (d > 20) r.farT += DT;
        if ((theirs || looseTheirs) && a.speed() < 1 && d > 4) r.idleT += DT;
      }
      if (ours) {
        const u = (b.pos.x * m.attackDir(HS)) / HALF_L;
        thirds[u < -1 / 3 ? 0 : u < 1 / 3 ? 1 : 2] += DT;
      }
      if (b.owner < 0 && !b.held) {
        r.ballSpeed += Math.hypot(b.vel.x, b.vel.z);
        ballN++;
      }
      if (frame % 6 === 0) {
        let s = 0;
        let n = 0;
        for (const p of m.players) if (!p.isKeeper && !p.sentOff) {
          s += p.speed();
          n++;
        }
        r.playerSpeed += s / n;
        r.manSpeed += a ? a.speed() : 0;
        playN++;
      }
    } else if (phase === 'kickoff' || phase === 'out' || phase === 'restart') {
      const kind: string = deadKind;
      dead(kind, DT);
      if (!stop || (stop.kind !== kind && phase !== 'kickoff')) {
        if (stop && stop.kind !== 'goal') endStop();
        if (!stop) stop = { kind, t: 0 };
      }
      stop.t += DT;
    } else if (phase === 'goal') {
      dead('goal', DT);
      if (stop) stop.t += DT;
    }

    // ---- switches (his man changed hands without a pass received or a restart)
    if (m.phase === 'play' && phase === 'play' && m.active !== activeBefore && activeBefore >= 0 && m.active >= 0) {
      const got = evs.some((e) => (e.type === 'control' && e.player === m.active) || (e.type === 'kick' && (e.player ?? -1) >= 0 && m.players[e.player!].side === HS));
      const keeper = m.players[m.active].isKeeper || m.players[activeBefore].isKeeper;
      if (!got && !keeper && m.ball.owner !== m.active) {
        const manual = pad.pass && !lastPass;
        if (manual) r.manualSwitches++;
        else r.autoSwitches++;
        if (m.ball.owner < 0 || m.players[m.ball.owner].side !== HS) {
          const ts = interceptTimes(m);
          const tNew = ts.get(m.active) ?? Infinity;
          const tOld = ts.get(activeBefore) ?? Infinity;
          if (tNew > tOld + 0.1) r.wrongSwitches++;
        }
        if (!manual && m.active === prevActive && r.wall - prevActiveT < 1.5) r.flipBacks++;
        prevActive = activeBefore;
        prevActiveT = r.wall;
      }
    }
    lastActive = m.active;
    lastPass = pad.pass;

    // ---- events
    for (const e of evs) handle(e, activeBefore);

    // ---- possession spells
    const ob = m.ball.owner;
    if (ob >= 0 && m.phase !== 'goal') {
      const s = m.players[ob].side;
      if (s !== own) {
        if (own === HS) closeSpell();
        else if (own === 1) closeTheirs();
        own = s;
        if (s === HS) spell = { t0: r.wall, shot: false, att: m.ball.pos.x * m.attackDir(HS) > 0 };
        else their = { t0: r.wall, shot: false, deep: false };
      }
      if (their && s === 1 && (m.ball.pos.x * m.attackDir(HS)) / HALF_L < -1 / 3) their.deep = true;
    }

    // ---- presentation (MatchSession.flow)
    if (m.phase === 'goal') {
      const theirGoal = m.goalSide !== HS && !replayWanted;
      let at = theirGoal ? THEIR_GOAL_AT : Math.max(replayWanted ? P.replayAtS : NO_REPLAY_AT, m.goalSide === HS ? o.celebHoldS ?? 0 : 0) + celebLate;
      let tapped = false;
      if (SKIP_GRACE !== undefined && o.goalSkipS !== undefined) {
        const tap = P.goalWideS + celebLate + SKIP_GRACE + o.goalSkipS;
        if (tap < at) {
          at = tap;
          tapped = true;
        }
      }
      if (m.phaseT > at && !replayDone) {
        replayDone = true;
        if (replayWanted && !tapped) {
          const w = o.replaySkipS !== undefined ? Math.min(o.replaySkipS, REPLAY_WALL) : REPLAY_WALL;
          dead('replay', w);
          r.wall += w;
          if (stop) stop.t += w;
        }
        m.resumeAfterGoal();
        endStop();
        stop = { kind: 'kickoff', t: 0 };
      }
    }
    if (m.phase === 'halftime') {
      endStop();
      const ht = P.halftimeHoldS + (o.htMenuS ?? 3);
      dead('halftime', ht);
      r.wall += ht;
      m.aiSubs(1, 2);
      m.continueSecondHalf();
      stop = { kind: 'kickoffHalf', t: 0 };
      closeSpell();
      closeTheirs();
      own = -1;
    }
  }
  endStop();
  dead('fulltime', P.fulltimeHoldS);
  r.wall += P.fulltimeHoldS;
  closeSpell();
  r.gf = m.score[0];
  r.ga = m.score[1];
  r.ballSpeed /= Math.max(1, ballN);
  r.playerSpeed /= Math.max(1, playN);
  r.manSpeed /= Math.max(1, playN);
  const tt = thirds[0] + thirds[1] + thirds[2];
  r.attThird = tt > 0 ? thirds[2] / tt : 0;
  r.keeperHold = [r.keeperHold[0] * DT, r.keeperHold[1] * DT];
  void lastActive;
  return r;

  function handle(e: MatchEvent, activeBefore: number): void {
    const side = (i: number | undefined) => (i !== undefined && i >= 0 ? m.players[i].side : -1);
    switch (e.type) {
      case 'kick': {
        const k = e.player ?? m.ball.lastTouch;
        if (side(k) !== HS || m.phase === 'shootout') {
          if (e.kind === 'shot' && side(k) === 1) {
            r.shotsAgainst++;
            if (their) their.shot = true;
          }
          break;
        }
        if (e.kind === 'shot') {
          r.shotsFor++;
          act('shot');
          if (spell && !spell.shot) {
            spell.shot = true;
            r.winToShot.push(r.wall - spell.t0);
            if (spell.att) r.winToShotAtt.push(r.wall - spell.t0);
          }
        } else if ((e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') && m.phase === 'play' && k === activeBefore) {
          r.passes++;
          const intended = spy.lastPick ? spy.lastPick.idx : -1;
          spy.lastPick = null;
          if (intended >= 0) r.passAimed++;
          if (intended >= 0 && m.passTarget === intended) r.passIntended++;
          passOpen = { kick: m.kickId, intended };
          const tgt = m.passTarget >= 0 ? m.players[m.passTarget] : null;
          const gain = tgt ? (tgt.pos.x - m.players[k].pos.x) * m.attackDir(HS) : 0;
          if (e.kind === 'through' || e.kind === 'lob' || gain > 12) act('keyPass');
        }
        break;
      }
      case 'control':
        if (passOpen) {
          if (side(e.player) === HS) r.passCmp++;
          passOpen = null;
        }
        break;
      case 'skillMove':
        if (side(e.player) === HS && e.move !== 'cut' && e.move !== 'knock') act('skill');
        break;
      case 'tackleTry':
        if (side(e.by) === HS) act('tackle');
        break;
      case 'tackle':
        if (side(e.by) === HS && e.won && !e.slide) r.actions.won++;
        break;
      case 'save':
        if (side(e.keeper) === HS) {
          r.savesFor++;
          act('save');
        } else r.savesAgainst++;
        break;
      case 'goal': {
        closeSpell();
        closeTheirs();
        own = -1;
        replayDone = false;
        const special = e.own || m.shotDist >= 16 || m.kickKind === 'header' || m.shotStyle === 'chip' || m.shotStyle === 'finesse';
        replayWanted = (e.side === HS || e.own) && special;
        celebLate = e.side === HS && o.explosion ? 1.8 - P.goalWideS : 0;
        endStop();
        stop = { kind: 'goal', t: 0 };
        break;
      }
    }
    if (e.type === 'kick' && e.kind === 'shot' && side(e.player ?? m.ball.lastTouch) === HS && m.shotOnTarget) r.onTargetFor++;
  }

}

export interface PlaytestSummary {
  n: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  wall: number;
  inPlayPct: number;
  /** Dead seconds per match by kind, and the average / longest single stoppage by kind. */
  deadPerMatch: Record<string, number>;
  stopAvg: Record<string, number>;
  stopMax: Record<string, number>;
  stopN: Record<string, number>;
  keeperHold: [number, number];
  downT: number;
  spells: number;
  shotSpellPct: number;
  spellAvg: number;
  onBallPerSpell: number;
  winToShot: number;
  winToShotAtt: number;
  attShotPct: number;
  theirSpells: number;
  theirShotPct: number;
  theirSpellAvg: number;
  theirDeepPct: number;
  shotsFor: number;
  shotsAgainst: number;
  onTargetFor: number;
  savesFor: number;
  savesAgainst: number;
  actionsPerMin: number;
  actionGap: number;
  /** Share of gaps over 15 s. */
  longGaps: number;
  actions: PlaytestMatch['actions'];
  rightMan: number;
  offWhenWrong: number;
  farPerMin: number;
  idlePerMin: number;
  autoSwitches: number;
  manualSwitches: number;
  wrongSwitchPct: number;
  flipBacks: number;
  passes: number;
  passIntendedPct: number;
  passCmpPct: number;
  ballSpeed: number;
  playerSpeed: number;
  manSpeed: number;
  attThird: number;
}

export function playtestSeries(n: number, o: Omit<PlaytestOptions, 'seed' | 'home' | 'away'> & { seed0?: number } = {}): PlaytestSummary {
  const list: PlaytestMatch[] = [];
  for (let i = 0; i < n; i++) {
    const k = 2 + (Math.floor(i / 2) % 8);
    const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
    list.push(playtestMatch({ ...o, seed: (o.seed0 ?? 3000) + i * 131, home, away }));
  }
  return summarise(list);
}

export function summarise(list: PlaytestMatch[]): PlaytestSummary {
  const n = list.length;
  const sum = (f: (r: PlaytestMatch) => number) => list.reduce((a, r) => a + f(r), 0);
  const all = <T>(f: (r: PlaytestMatch) => T[]) => list.flatMap(f);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const wall = sum((r) => r.wall);
  const deadPerMatch: Record<string, number> = {};
  const stopAvg: Record<string, number> = {};
  const stopMax: Record<string, number> = {};
  const stopN: Record<string, number> = {};
  for (const r of list) {
    for (const [k, v] of Object.entries(r.dead)) deadPerMatch[k] = (deadPerMatch[k] ?? 0) + v / n;
    for (const [k, v] of Object.entries(r.stops)) {
      stopN[k] = (stopN[k] ?? 0) + v.n;
      stopAvg[k] = (stopAvg[k] ?? 0) + v.total;
      stopMax[k] = Math.max(stopMax[k] ?? 0, v.max);
    }
  }
  for (const k of Object.keys(stopAvg)) stopAvg[k] /= Math.max(1, stopN[k]);
  for (const k of Object.keys(stopN)) stopN[k] /= n;
  const acts = { shot: 0, skill: 0, keyPass: 0, tackle: 0, save: 0, won: 0 };
  for (const r of list) for (const k of Object.keys(acts) as (keyof typeof acts)[]) acts[k] += r.actions[k] / n;
  const nActs = acts.shot + acts.skill + acts.keyPass + acts.tackle + acts.save;
  const gaps = all((r) => r.actionGaps);
  const spells = sum((r) => r.spells);
  const attSp = sum((r) => r.spellsAtt);
  return {
    n,
    w: list.filter((r) => r.gf > r.ga).length,
    d: list.filter((r) => r.gf === r.ga).length,
    l: list.filter((r) => r.gf < r.ga).length,
    gf: sum((r) => r.gf) / n,
    ga: sum((r) => r.ga) / n,
    wall: wall / n,
    inPlayPct: (sum((r) => r.inPlay) / wall) * 100,
    deadPerMatch,
    stopAvg,
    stopMax,
    stopN,
    keeperHold: [sum((r) => r.keeperHold[0]) / n, sum((r) => r.keeperHold[1]) / n],
    downT: sum((r) => r.downT) / n,
    spells: spells / n,
    shotSpellPct: (sum((r) => r.spellsWithShot) / Math.max(1, spells)) * 100,
    spellAvg: sum((r) => r.spellWall) / Math.max(1, spells),
    onBallPerSpell: sum((r) => r.onBall) / Math.max(1, spells),
    winToShot: mean(all((r) => r.winToShot)),
    winToShotAtt: mean(all((r) => r.winToShotAtt)),
    attShotPct: (sum((r) => r.spellsAttWithShot) / Math.max(1, attSp)) * 100,
    theirSpells: sum((r) => r.theirSpells) / n,
    theirShotPct: (sum((r) => r.theirShotSpells) / Math.max(1, sum((r) => r.theirSpells))) * 100,
    theirSpellAvg: sum((r) => r.theirSpellWall) / Math.max(1, sum((r) => r.theirSpells)),
    theirDeepPct: (sum((r) => r.theirDeep) / Math.max(1, sum((r) => r.theirSpells))) * 100,
    shotsFor: sum((r) => r.shotsFor) / n,
    shotsAgainst: sum((r) => r.shotsAgainst) / n,
    onTargetFor: sum((r) => r.onTargetFor) / n,
    savesFor: sum((r) => r.savesFor) / n,
    savesAgainst: sum((r) => r.savesAgainst) / n,
    actionsPerMin: nActs / (wall / n / 60),
    actionGap: wall / n / Math.max(1e-6, nActs),
    longGaps: (gaps.filter((g) => g > 15).length / Math.max(1, gaps.length)) * 100,
    actions: acts,
    rightMan: (sum((r) => r.defRight) / Math.max(1, sum((r) => r.defSamples))) * 100,
    offWhenWrong: sum((r) => r.defOff) / Math.max(1, sum((r) => r.defSamples - r.defRight)),
    farPerMin: sum((r) => r.farT) / (wall / 60),
    idlePerMin: sum((r) => r.idleT) / (wall / 60),
    autoSwitches: sum((r) => r.autoSwitches) / n,
    manualSwitches: sum((r) => r.manualSwitches) / n,
    wrongSwitchPct: (sum((r) => r.wrongSwitches) / Math.max(1, sum((r) => r.autoSwitches + r.manualSwitches))) * 100,
    flipBacks: sum((r) => r.flipBacks) / n,
    passes: sum((r) => r.passes) / n,
    passIntendedPct: (sum((r) => r.passIntended) / Math.max(1, sum((r) => r.passAimed))) * 100,
    passCmpPct: (sum((r) => r.passCmp) / Math.max(1, sum((r) => r.passes))) * 100,
    ballSpeed: sum((r) => r.ballSpeed) / n,
    playerSpeed: sum((r) => r.playerSpeed) / n,
    manSpeed: sum((r) => r.manSpeed) / n,
    attThird: (sum((r) => r.attThird) / n) * 100,
  };
}

export function fmtPlaytest(s: PlaytestSummary): string {
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const kv = (o: Record<string, number>, d = 1) => Object.entries(o).sort().map(([k, v]) => `${k} ${f(v, d)}`).join(', ');
  return [
    `N=${s.n} W${s.w} D${s.d} L${s.l} GF ${f(s.gf, 2)} GA ${f(s.ga, 2)} | wall ${f(s.wall)} s/match | BALL IN PLAY ${f(s.inPlayPct)}%`,
    `dead s/match: ${kv(s.deadPerMatch)}`,
    `stoppages/match: ${kv(s.stopN)}`,
    `avg stoppage s: ${kv(s.stopAvg, 2)}`,
    `max stoppage s: ${kv(s.stopMax, 2)}`,
    `keeper holds ours/theirs ${f(s.keeperHold[0])}/${f(s.keeperHold[1])} s | his man down ${f(s.downT)} s`,
    `spells ${f(s.spells)}/m, avg ${f(s.spellAvg)} s, on ball ${f(s.onBallPerSpell, 2)} s/spell, with shot ${f(s.shotSpellPct)}% | win->shot ${f(s.winToShot)} s (att half ${f(s.winToShotAtt)} s, ${f(s.attShotPct)}% of att-half spells shoot)`,
    `THEIR spells ${f(s.theirSpells)}/m avg ${f(s.theirSpellAvg)} s, reach his third ${f(s.theirDeepPct)}%, shoot ${f(s.theirShotPct)}%`,
    `shots ${f(s.shotsFor)}-${f(s.shotsAgainst)} on target ${f(s.onTargetFor)} | saves ours ${f(s.savesFor)} theirs ${f(s.savesAgainst)} | att third ${f(s.attThird)}%`,
    `ACTIONS ${f(s.actionsPerMin, 2)}/min = one per ${f(s.actionGap)} s (gaps > 15 s: ${f(s.longGaps)}%) | shot ${f(s.actions.shot)} skill ${f(s.actions.skill)} key pass ${f(s.actions.keyPass)} tackle ${f(s.actions.tackle)} (won ${f(s.actions.won)}) save ${f(s.actions.save)}`,
    `RIGHT MAN ${f(s.rightMan)}% (off by ${f(s.offWhenWrong, 2)} s when wrong) | far >20 m ${f(s.farPerMin)} s/min, idle ${f(s.idlePerMin)} s/min | switches auto ${f(s.autoSwitches)} manual ${f(s.manualSwitches)} wrong ${f(s.wrongSwitchPct)}% flip-backs ${f(s.flipBacks)}`,
    `passes ${f(s.passes)}/m to intended ${f(s.passIntendedPct)}% completed ${f(s.passCmpPct)}% | ball ${f(s.ballSpeed)} m/s loose, players ${f(s.playerSpeed, 2)} m/s, his man ${f(s.manSpeed, 2)} m/s`,
  ].join('\n');
}
