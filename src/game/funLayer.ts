/**
 * The in-match fun layer's rules (no DOM, no sound: the session presents its cues, ui/funHud.ts draws them, and the
 * tests run it on whole bot matches). It reads the sim's events for the human's side and keeps:
 *
 * - LIVE GOALS (bounties): one small optional objective at a time, only offered in open play ("SCORE A GOAL", "WIN
 *   IT BACK", "3 PASSES + SHOT", "BEAT YOUR MAN"...), each with a few seconds to do it. Done, it pays its coins and
 *   XP into the match's bank (main.ts adds them at full time, like the daily challenges: never doubled). At most
 *   MAX_OFFERS a match, BOUNTY_GAP seconds of play apart. Today's daily challenges tilt which ones come up.
 * - SHOWTIME: style points for playing with flair (a man beaten, a PERFECT skill, one-touch passing, a screamer...),
 *   graded S / A / B / C against the match length; an S or an A adds GRADE_BONUS to the match's coins.
 * - Goal callouts: what made the goal (BRACE / HAT TRICK, LATE WINNER, EQUALISER, SUPER SHOT, SCREAMER, SOLO GOAL,
 *   5 PASS GOAL, HEADER, CHIPPED, CURLER, FIRST TIME; three at most), for either side's goals.
 * - The final minutes: a cue as the last FINAL_FRAC of the second half starts, and the tension (0..1) the session
 *   turns into the heartbeat, the crowd and the camera.
 *
 * Nothing here touches the sim: online peers may each run their own (the session leaves bounties and SHOWTIME off
 * online: an online friendly doesn't touch the save).
 */
import { HALF_L } from '../sim/constants';
import type { Match } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';

// ------------------------------------------------------------------ bounties

export type BountyKind = 'score' | 'passShot' | 'skill' | 'winBack' | 'onTarget' | 'oneTouch' | 'hold' | 'superGoal';

export interface BountyDef {
  /** Short caps (Silkscreen: no hyphens). */
  title: string;
  /** ui/pixelIcons name. */
  icon: string;
  /** Seconds of open play to do it in. */
  seconds: number;
  coins: number;
  xp: number;
  /** How many of the thing (3 passes); 1 for most. */
  need: number;
}

export const BOUNTIES: Readonly<Record<BountyKind, BountyDef>> = {
  score: { title: 'SCORE A GOAL', icon: 'ball', seconds: 30, coins: 40, xp: 20, need: 1 },
  passShot: { title: '3 PASSES + SHOT', icon: 'swap', seconds: 25, coins: 20, xp: 10, need: 3 },
  skill: { title: 'BEAT YOUR MAN', icon: 'run', seconds: 15, coins: 15, xp: 8, need: 1 },
  winBack: { title: 'WIN IT BACK', icon: 'shield', seconds: 6, coins: 10, xp: 5, need: 1 },
  onTarget: { title: 'SHOT ON TARGET', icon: 'flag', seconds: 20, coins: 15, xp: 8, need: 1 },
  oneTouch: { title: 'ONE TOUCH PASS', icon: 'bolt', seconds: 20, coins: 15, xp: 8, need: 1 },
  hold: { title: 'HOLD THE LEAD', icon: 'shield', seconds: 30, coins: 20, xp: 10, need: 1 },
  superGoal: { title: 'SUPER SHOT GOAL', icon: 'fire', seconds: 30, coins: 30, xp: 15, need: 1 },
};

export interface Bounty {
  id: number;
  kind: BountyKind;
  def: BountyDef;
  /** Seconds of open play left. */
  left: number;
  total: number;
  have: number;
}

/** Open play (s) before the first offer; then BOUNTY_GAP (s, scaled up for halves over 2 minutes) between them. */
export const FIRST_OFFER_S = 10;
export const BOUNTY_GAP: readonly [number, number] = [12, 20];
/** Offers a match at most (the economy: docs/ECONOMY.md, a modest bonus on the match fee). */
export const MAX_OFFERS = 5;
/** A daily challenge's kind of bounty comes up this much more often. */
const DAILY_TILT = 2.5;

// ------------------------------------------------------------------ SHOWTIME

export type Grade = 'S' | 'A' | 'B' | 'C';

/** Style points (the human's side). */
export const STYLE = {
  pass: 3,
  oneTouch: 10,
  chain: 3,
  beat: 20,
  perfect: 60,
  good: 35,
  plain: 10,
  show: 5,
  link: 15,
  tackle: 15,
  slide: 20,
  shot: 3,
  onTarget: 15,
  block: 10,
  save: 10,
  goal: 100,
  superShot: 30,
  bounty: 50,
  win: 100,
  draw: 40,
  cleanSheet: 40,
} as const;
/** Grade cut-offs, in style points per GRADE_REF_S seconds of match (two 2-minute halves). */
export const GRADE_CUTS: readonly [Grade, number][] = [['S', 2700], ['A', 2200], ['B', 1400]];
export const GRADE_REF_S = 240;
/** The live grade shows from this many match seconds (before that the pace means little). */
export const LIVE_GRADE_FROM = 40;
/** The coins bonus a grade adds to the match's reward (S +10%, A +5%). */
export const GRADE_BONUS: Readonly<Record<Grade, number>> = { S: 0.1, A: 0.05, B: 0, C: 0 };

/**
 * The grade for `points` over a match of `halfLength` s halves against an AI of `difficulty` (MatchConfig units: a
 * harder AI leaves less room for flair, so its points count for more: GRADE_DIFF a level from NORMAL's 1.8).
 */
export const GRADE_DIFF = 0.25;
export function gradeOf(points: number, halfLength: number, difficulty = 1.8): Grade {
  const k = Math.min(1.5, Math.max(0.8, 1 + GRADE_DIFF * (difficulty - 1.8)));
  const norm = (points * k * GRADE_REF_S) / Math.max(60, 2 * halfLength);
  for (const [g, cut] of GRADE_CUTS) if (norm >= cut) return g;
  return 'C';
}

const GRADE_RANK: Readonly<Record<Grade, number>> = { C: 0, B: 1, A: 2, S: 3 };
/** a beats b. */
export const gradeBetter = (a: Grade, b: Grade | undefined): boolean => !b || GRADE_RANK[a] > GRADE_RANK[b];

// ------------------------------------------------------------------ goals and the final minutes

export interface GoalTag {
  text: string;
  /** The headline one (gold, bigger). */
  big: boolean;
}

/** The final minutes: the last FINAL_FRAC of the second half (FINAL_MIN_S to FINAL_MAX_S real seconds). */
export const FINAL_FRAC = 0.22;
export const FINAL_MIN_S = 15;
export const FINAL_MAX_S = 60;
/**
 * A shot from this far out (m) that goes in is a SCREAMER; a run with the ball this long (m), or two men beaten (one
 * on a run of SOLO_BEAT_CARRY_M), a SOLO GOAL; a possession of TEAM_PASSES passes or more, an "N PASS GOAL".
 */
export const SCREAMER_M = 20;
export const SOLO_CARRY_M = 15;
export const SOLO_BEAT_CARRY_M = 8;
export const TEAM_PASSES = 4;
/** SCORE THE SUPER SHOT: it is over this long (s) after the super shot is struck, unless it went in. */
const SUPER_WATCH_S = 3.5;

export const finalWindow = (halfLength: number): number => Math.min(FINAL_MAX_S, Math.max(FINAL_MIN_S, halfLength * FINAL_FRAC));

// ------------------------------------------------------------------ cues

export type FunCue =
  | { type: 'bounty'; state: 'offer' | 'progress' | 'done' | 'fail'; b: Bounty }
  | { type: 'style'; points: number; total: number; grade: Grade; up: boolean }
  | { type: 'goalCall'; side: Side; scorer: number; ours: boolean; tags: GoalTag[] }
  | { type: 'final'; diff: number }
  | { type: 'daily'; text: string; have: number; goal: number; done: boolean; coins: number };

export interface DailyLive {
  text: string;
  have: number;
  goal: number;
  coins: number;
  claimed: boolean;
}

export interface FunSummary {
  /** Bounties: coins and XP banked, how many done / offered, which. */
  coins: number;
  xp: number;
  done: number;
  offered: number;
  kinds: BountyKind[];
  /** SHOWTIME: points (with the result's), the grade. */
  style: number;
  grade: Grade;
  /** The human side's super shots and the ones that went in. */
  supers: number;
  superGoals: number;
}

export interface FunOptions {
  humanSide: Side | -1;
  /** Offer bounties (an ordinary match against the AI; never online, a moment or the basics). */
  bounties: boolean;
  /** Keep SHOWTIME points (the cues and the grade). */
  showtime: boolean;
  seed: number;
}

interface ShotNote {
  player: number;
  side: Side;
  header: boolean;
  firstTime: boolean;
  style: string | undefined;
  dist: number;
  passes: number;
  solo: boolean;
  super: boolean;
}

export class FunTracker {
  readonly cues: FunCue[] = [];
  bounty: Bounty | null = null;
  /** Coins and XP the bounties banked this match. */
  readonly bank = { coins: 0, xp: 0 };
  readonly kindsDone: BountyKind[] = [];
  offered = 0;
  /** SHOWTIME points so far (the result's are added at full time: summary). */
  style = 0;
  /** The final minutes have begun (the cue went out), and how tense it is now (0..1). */
  finalOn = false;
  tension = 0;
  supers = 0;
  superGoals = 0;
  private readonly hs: Side | -1;
  private rng: number;
  private nextId = 1;
  /** Open-play seconds: all told, and since the last bounty ended (or the kick-off). */
  private playT = 0;
  private sinceEnd = 0;
  private gap: number;
  /** Possession: whose, completed passes in a row, a pass on its way, the carrier and where he got it. */
  private possSide: Side | -1 = -1;
  private passes = 0;
  private passBy = -1;
  private passSide: Side = 0;
  private passFirst = false;
  private carrier = -1;
  private carrierX = 0;
  private carrierZ = 0;
  private carrierByPass = false;
  private beats = new Map<number, number>();
  private lastShot: ShotNote | null = null;
  private superNext: Side | -1 = -1;
  /** The human's side just lost the ball (open play, not off a shot): seconds since (WIN IT BACK is offered). */
  private turnoverT = 99;
  private lastKickShot = false;
  /** Seconds left to see whether the human side's super shot went in. */
  private superWatch = 0;
  private goalsBy = new Map<string, number>();
  private daily: DailyLive[] | null = null;
  private tilt = new Set<BountyKind>();
  private gradeNow: Grade = 'C';
  private gradeShown = false;
  private regradeT = 0;

  constructor(private readonly m: Match, private readonly o: FunOptions) {
    this.hs = o.humanSide;
    this.rng = (Math.imul((o.seed | 0) + 0x5bd1, 2654435761) >>> 0) || 1;
    this.gap = this.gapS();
  }

  private rnd(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private gapS(): number {
    const k = Math.max(1, this.m.cfg.halfLength / 120);
    return (BOUNTY_GAP[0] + this.rnd() * (BOUNTY_GAP[1] - BOUNTY_GAP[0])) * k;
  }

  private get ours(): boolean {
    return this.hs === 0 || this.hs === 1;
  }

  // ---------------------------------------------------------------- daily challenges, live

  /**
   * Today's daily challenges with this match counted in so far (main.ts, after each event): a cue when one moves on
   * (its coins are still paid at full time, by save.ts advanceDaily, never here). The first call sets the baseline.
   */
  setDaily(list: DailyLive[], kinds?: Iterable<BountyKind>): void {
    if (kinds) this.tilt = new Set(kinds);
    const prev = this.daily;
    this.daily = list.map((d) => ({ ...d }));
    if (!prev) return;
    list.forEach((d, i) => {
      const p = prev[i];
      if (!p || d.claimed || p.text !== d.text) return;
      const have = Math.min(d.have, d.goal);
      if (have > Math.min(p.have, p.goal)) this.cues.push({ type: 'daily', text: d.text, have, goal: d.goal, done: have >= d.goal, coins: d.coins });
    });
  }

  // ---------------------------------------------------------------- the step

  /** After every sim step: its events (in order), then the clocks, the offers and the final minutes. */
  after(events: readonly MatchEvent[], dt: number): void {
    for (const e of events) this.event(e);
    this.step(dt);
  }

  private step(dt: number): void {
    const m = this.m;
    const live = m.phase === 'play';
    if (live) {
      this.playT += dt;
      this.turnoverT += dt;
      if (!this.bounty) this.sinceEnd += dt;
    }
    const b = this.bounty;
    if (b && live) {
      b.left -= dt;
      if (b.left <= 0) this.endBounty(b.kind === 'hold' ? 'done' : 'fail');
    }
    // SCORE THE SUPER SHOT: struck and gone wide or saved (no goal within SUPER_WATCH_S).
    if (this.superWatch > 0 && (this.superWatch -= dt) <= 0 && this.bounty?.kind === 'superGoal') this.endBounty('fail');
    if (live && this.o.bounties && this.ours && !this.bounty) this.maybeOffer();
    // The live grade drifts with the pace (no points for a while lowers it): looked at once a second.
    if (this.o.showtime && this.ours && live && (this.regradeT += dt) >= 1) {
      this.regradeT = 0;
      this.regrade(0);
    }
    // The final minutes.
    const fw = finalWindow(m.cfg.halfLength);
    const left = m.cfg.halfLength - m.clock;
    const late = m.half === 2 && left <= fw && (live || m.phase === 'out' || m.phase === 'restart');
    if (late && !this.finalOn && !m.shootout) {
      this.finalOn = true;
      const hs = this.ours ? (this.hs as Side) : 0;
      this.cues.push({ type: 'final', diff: m.score[hs] - m.score[hs === 0 ? 1 : 0] });
    }
    this.tension = late ? Math.min(1, 0.55 + 0.45 * (1 - Math.max(0, left) / fw)) : 0;
    if (m.phase === 'fulltime' || m.phase === 'shootout') this.tension = 0;
  }

  private maybeOffer(): void {
    const m = this.m;
    const hs = this.hs as Side;
    if (this.offered >= MAX_OFFERS || this.playT < FIRST_OFFER_S) return;
    const remaining = m.cfg.halfLength - m.clock;
    // WIN IT BACK: straight after a turnover, a little sooner than the usual gap.
    if (this.turnoverT < 0.3 && this.sinceEnd >= this.gap * 0.6 && remaining > 8) {
      this.offer('winBack');
      return;
    }
    if (this.sinceEnd < this.gap) return;
    const b = m.ball;
    const owner = b.owner >= 0 && !b.held ? m.players[b.owner] : null;
    const cands: [BountyKind, number][] = [];
    const leading = m.score[hs] > m.score[hs === 0 ? 1 : 0];
    if (owner && owner.side === hs && !owner.isKeeper) {
      const adv = (owner.pos.x * m.attackDir(hs)) / HALF_L;
      if (adv > 0) cands.push(['score', 2]);
      if (adv > 0.33) cands.push(['onTarget', 2]);
      if (adv < 0.25) cands.push(['passShot', 2]);
      let near = Infinity;
      for (const p of m.players) if (p.side !== hs && !p.sentOff && !p.isKeeper) near = Math.min(near, Math.hypot(p.pos.x - owner.pos.x, p.pos.z - owner.pos.z));
      if (near < 7) cands.push(['skill', 2]);
      cands.push(['oneTouch', 0.7]);
    }
    if (leading && m.half === 2 && m.clock > m.cfg.halfLength * 0.55) cands.push(['hold', 3]);
    const pool = cands.filter(([k]) => remaining >= BOUNTIES[k].seconds * (k === 'hold' ? 0 : 0.6));
    if (!pool.length) return;
    let total = 0;
    for (const c of pool) {
      if (this.tilt.has(c[0])) c[1] *= DAILY_TILT;
      total += c[1];
    }
    let r = this.rnd() * total;
    for (const [k, w] of pool) {
      r -= w;
      if (r < 0) {
        this.offer(k);
        return;
      }
    }
    this.offer(pool[pool.length - 1][0]);
  }

  /** Put up a bounty (dev builds: window.__bl.objective(kind) calls it straight, the gap and cap aside). */
  offer(kind: BountyKind): Bounty | null {
    if (!this.ours || this.bounty) return null;
    const def = BOUNTIES[kind];
    const m = this.m;
    // HOLD THE LEAD runs to the whistle if that comes first (and is done when it does).
    const secs = kind === 'hold' ? Math.min(def.seconds, Math.max(5, m.cfg.halfLength - m.clock + 3)) : def.seconds;
    const b: Bounty = { id: this.nextId++, kind, def, left: secs, total: secs, have: 0 };
    this.bounty = b;
    this.offered++;
    this.cues.push({ type: 'bounty', state: 'offer', b });
    return b;
  }

  private endBounty(state: 'done' | 'fail', quiet = false): void {
    const b = this.bounty;
    if (!b) return;
    this.bounty = null;
    this.sinceEnd = 0;
    this.gap = this.gapS();
    if (state === 'done') {
      b.have = b.def.need;
      this.bank.coins += b.def.coins;
      this.bank.xp += b.def.xp;
      this.kindsDone.push(b.kind);
      this.addStyle(STYLE.bounty);
    }
    if (!quiet) this.cues.push({ type: 'bounty', state, b });
  }

  private progress(n = 1): void {
    const b = this.bounty;
    if (!b) return;
    b.have = Math.min(b.def.need, b.have + n);
    if (b.have >= b.def.need) this.endBounty('done');
    else this.cues.push({ type: 'bounty', state: 'progress', b });
  }

  // ---------------------------------------------------------------- style

  private addStyle(pts: number): void {
    if (!this.o.showtime || !this.ours || pts <= 0) return;
    this.style += pts;
    this.regrade(pts);
  }

  /**
   * The live grade: the pace so far, as if kept up for the whole match (match seconds played, from LIVE_GRADE_FROM s:
   * before that it isn't shown), so it means the same at 10' as at 90'. A cue when it changes or points come in.
   */
  private regrade(pts: number): void {
    const m = this.m;
    const full = 2 * m.cfg.halfLength;
    const played = (m.half - 1) * m.cfg.halfLength + Math.min(m.clock, m.cfg.halfLength);
    if (played < LIVE_GRADE_FROM) return;
    const g = gradeOf((this.style * full) / Math.max(played, 1), m.cfg.halfLength, m.cfg.difficulty);
    if (g === this.gradeNow && pts <= 0 && this.gradeShown) return;
    const up = this.gradeShown && gradeBetter(g, this.gradeNow);
    this.gradeNow = g;
    this.gradeShown = true;
    this.cues.push({ type: 'style', points: pts, total: this.style, grade: g, up });
  }

  /** The live grade (the chip; null until LIVE_GRADE_FROM s of the match have been played). */
  get grade(): Grade | null {
    return this.gradeShown ? this.gradeNow : null;
  }

  // ---------------------------------------------------------------- events

  private sideOf(i: number | undefined): Side | -1 {
    return i !== undefined && i >= 0 && i < this.m.players.length ? this.m.players[i].side : -1;
  }

  private newPossession(side: Side | -1): void {
    this.possSide = side;
    this.passes = 0;
    this.beats.clear();
  }

  event(e: MatchEvent): void {
    const m = this.m;
    const hs = this.hs;
    const mine = (i: number | undefined) => hs !== -1 && this.sideOf(i) === hs;
    const bk = this.bounty?.kind;
    switch (e.type) {
      case 'superShot':
        this.superNext = e.side;
        if (e.side === hs) {
          this.supers++;
          this.addStyle(STYLE.superShot);
          this.superWatch = SUPER_WATCH_S;
        }
        break;
      case 'hypeFull':
        if (e.side === hs && this.o.bounties && !this.bounty && m.phase === 'play' && this.offered < MAX_OFFERS) this.offer('superGoal');
        break;
      case 'kick': {
        const side = this.sideOf(e.player);
        if (side === -1) break;
        const shot = e.kind === 'shot' || (e.kind === 'header' && m.shotKick === m.kickId && m.shotClock < 0.05);
        this.lastKickShot = shot;
        if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') {
          this.passBy = e.player!;
          this.passSide = side;
          this.passFirst = !!e.firstTime;
        } else this.passBy = -1;
        // Any touch by the other side breaks the chain (a block, a header clear, a throw-in).
        if (side !== this.possSide) this.passes = 0;
        if (!shot) {
          // (A deflection or a clearance off the super shot: it is no longer the super's ball.)
          if (this.lastShot && this.lastShot.side !== side) this.lastShot.super = false;
          break;
        }
        const p = m.players[e.player!];
        const carry = this.carrier === e.player ? Math.hypot(p.pos.x - this.carrierX, p.pos.z - this.carrierZ) : 0;
        const beaten = this.beats.get(e.player!) ?? 0;
        this.lastShot = {
          player: e.player!, side, header: e.kind === 'header', firstTime: !!e.firstTime, style: e.style, dist: m.shotDist,
          passes: this.possSide === side ? this.passes : 0,
          solo: this.carrier === e.player && !this.carrierByPass && (carry >= SOLO_CARRY_M || beaten >= 2 || (beaten >= 1 && carry >= SOLO_BEAT_CARRY_M)),
          super: this.superNext === side,
        };
        this.superNext = -1;
        if (side === hs) {
          this.addStyle(STYLE.shot + (m.shotOnTarget ? STYLE.onTarget : 0));
          if (bk === 'onTarget' && m.shotOnTarget) this.progress();
          if (bk === 'passShot' && this.possSide === hs && this.passes >= 3) this.endBounty('done');
        }
        break;
      }
      case 'control': {
        const side = this.sideOf(e.player);
        if (side === -1) break;
        const completed = this.passBy >= 0 && this.passSide === side && this.passBy !== e.player;
        const first = this.passFirst;
        if (side !== this.possSide) {
          const lost = this.possSide === hs && side !== hs && m.phase === 'play' && !this.lastKickShot;
          this.newPossession(side);
          if (lost) this.turnoverT = 0;
          if (side === hs && bk === 'winBack') this.progress();
        }
        if (completed) {
          this.passes++;
          if (side === hs) {
            this.addStyle(STYLE.pass + (first ? STYLE.oneTouch : 0) + (this.passes >= 3 ? STYLE.chain : 0));
            if (bk === 'passShot') {
              const b = this.bounty!;
              const have = Math.min(3, this.passes);
              if (have > b.have) {
                b.have = have;
                this.cues.push({ type: 'bounty', state: 'progress', b });
              }
            }
            if (bk === 'oneTouch' && first) this.progress();
          }
        } else if (side === hs && bk === 'passShot' && this.passes === 0 && this.bounty!.have > 0) {
          // The chain broke (a new possession): back to none.
          this.bounty!.have = 0;
          this.cues.push({ type: 'bounty', state: 'progress', b: this.bounty! });
        }
        const p = m.players[e.player];
        this.carrier = e.player;
        this.carrierX = p.pos.x;
        this.carrierZ = p.pos.z;
        this.carrierByPass = completed;
        this.passBy = -1;
        this.lastKickShot = false;
        break;
      }
      case 'tackle': {
        if (!e.won) break;
        const side = this.sideOf(e.by);
        if (side === -1) break;
        if (side !== this.possSide) {
          const lost = this.possSide === hs && side !== hs && m.phase === 'play';
          this.newPossession(side);
          if (lost) this.turnoverT = 0;
        }
        if (side === hs) {
          this.addStyle(e.slide ? STYLE.slide : STYLE.tackle);
          if (bk === 'winBack') this.progress();
        }
        break;
      }
      case 'beat':
        this.beats.set(e.by, (this.beats.get(e.by) ?? 0) + 1);
        if (mine(e.by)) {
          this.addStyle(STYLE.beat);
          if (bk === 'skill') this.progress();
        }
        break;
      case 'skillMove':
        if (!mine(e.player)) break;
        if (e.move === 'cut' || e.move === 'knock' || e.move === 'past') {
          this.addStyle(STYLE.link);
          if (bk === 'skill') this.progress();
        } else {
          this.addStyle(STYLE[e.grade]);
          if (bk === 'skill' && (e.grade === 'perfect' || e.grade === 'good')) this.progress();
        }
        break;
      case 'block':
        if (this.sideOf(e.by) !== this.possSide) this.passes = 0;
        if (mine(e.by)) this.addStyle(STYLE.block);
        break;
      case 'restart':
        // A restart is a new move.
        this.passes = 0;
        this.passBy = -1;
        break;
      case 'save':
        if (mine(e.keeper)) this.addStyle(STYLE.save);
        break;
      case 'goal':
        this.onGoal(e);
        break;
      case 'halftime':
        this.endBounty('fail', true);
        this.newPossession(-1);
        break;
      case 'fulltime':
        // HOLD THE LEAD to the whistle: done.
        this.endBounty(this.bounty?.kind === 'hold' ? 'done' : 'fail', this.bounty?.kind !== 'hold');
        this.tension = 0;
        break;
      default:
        break;
    }
  }

  private onGoal(e: Extract<MatchEvent, { type: 'goal' }>): void {
    const m = this.m;
    const hs = this.hs;
    const side = e.side;
    const ours = side === hs;
    const ls = this.lastShot && this.lastShot.player === e.scorer && !e.own ? this.lastShot : null;
    const tags: GoalTag[] = [];
    // The scorer's tally this match (by the man, not the slot: a sub starts at none).
    if (!e.own) {
      const id = m.players[e.scorer]?.def.id ?? String(e.scorer);
      const n = (this.goalsBy.get(id) ?? 0) + 1;
      this.goalsBy.set(id, n);
      if (n === 2) tags.push({ text: 'BRACE', big: true });
      else if (n === 3) tags.push({ text: 'HAT TRICK', big: true });
      else if (n > 3) tags.push({ text: `${n} GOALS`, big: true });
    }
    const my = m.score[side];
    const their = m.score[side === 0 ? 1 : 0];
    const late = m.half === 2 && m.cfg.halfLength - m.clock <= finalWindow(m.cfg.halfLength);
    if (late && my === their + 1) tags.push({ text: 'LATE WINNER', big: true });
    else if (my === their) tags.push({ text: late ? 'LATE EQUALISER' : 'EQUALISER', big: late });
    if (ls) {
      if (ls.super) tags.push({ text: 'SUPER SHOT', big: true });
      if (!ls.header && ls.dist >= SCREAMER_M) tags.push({ text: 'SCREAMER', big: false });
      if (ls.solo) tags.push({ text: 'SOLO GOAL', big: false });
      else if (ls.passes >= TEAM_PASSES) tags.push({ text: `${ls.passes} PASS GOAL`, big: false });
      if (ls.header) tags.push({ text: 'HEADER', big: false });
      else if (ls.style === 'chip') tags.push({ text: 'CHIPPED', big: false });
      else if (ls.style === 'finesse') tags.push({ text: 'CURLER', big: false });
      else if (ls.firstTime) tags.push({ text: 'FIRST TIME', big: false });
    }
    // At most three, the headline first.
    tags.sort((a, b) => Number(b.big) - Number(a.big));
    tags.length = Math.min(tags.length, 3);
    if (tags.length && tags.every((t) => !t.big)) tags[0].big = true;
    this.cues.push({ type: 'goalCall', side, scorer: e.scorer, ours, tags });
    if (ours && ls?.super) this.superGoals++;
    if (ours) {
      let pts = STYLE.goal;
      for (const t of tags) pts += t.big ? 60 : 30;
      this.addStyle(pts);
    }
    // Bounties: a goal of ours does SCORE A GOAL (and the super shot's, if it was); any other one is over.
    const bk = this.bounty?.kind;
    if (bk) {
      if (ours && (bk === 'score' || (bk === 'superGoal' && ls?.super))) this.endBounty('done');
      else if (ours && bk !== 'hold') this.endBounty('fail', true);
      else if (!ours) this.endBounty('fail');
    }
    this.lastShot = null;
    this.newPossession(-1);
  }

  // ---------------------------------------------------------------- full time

  summary(): FunSummary {
    const m = this.m;
    let style = this.style;
    if (this.o.showtime && this.ours) {
      const hs = this.hs as Side;
      const my = m.score[hs];
      const their = m.score[hs === 0 ? 1 : 0];
      style += my > their ? STYLE.win : my === their ? STYLE.draw : 0;
      if (their === 0) style += STYLE.cleanSheet;
    }
    return {
      coins: this.bank.coins, xp: this.bank.xp, done: this.kindsDone.length, offered: this.offered, kinds: [...this.kindsDone],
      style, grade: gradeOf(style, m.cfg.halfLength, m.cfg.difficulty), supers: this.supers, superGoals: this.superGoals,
    };
  }
}
