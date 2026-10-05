import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BOX_DEPTH, BOX_W, DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { MatchEvent, Side } from '../src/sim/types';
import { emptyShape, fmtShape, sampleShape, summariseShape, type ShapeStats, type ShapeSummary } from './metricsHarness';

/**
 * A realistic scripted human for whole-match measurements: it plays the pad (never the sim) the way a
 * decent casual player does, with a reaction delay (decisions every ~0.15-0.2 s):
 *
 * - on the ball: dribbles at goal (sprinting into space), taps PASS at an open teammate (aimed roughly,
 *   ~20 degrees of error) when pressed or after a second or two, now and then a THROUGH tap for a runner,
 *   cuts sharply (a 80-100 degree stick change) when a defender closes in front, now and then knocks it past
 *   him (double-tap SPRINT) or lets the stick go to shield, and shoots from inside ~18 m with a clear lane
 *   (SHOOT held ~0.25-0.4 s, the stick at a corner);
 * - defending: runs at the carrier, holds PRESS (THROUGH, stick neutral) inside ~7 m, taps TACKLE (SHOOT)
 *   when within ~2.3 m (sometimes from 3-5 m), rarely holds it for a slide from behind, and taps PASS to
 *   switch when he's far from the ball and a teammate is much nearer;
 * - loose balls: runs onto them (stick left alone for a pass on its way to him);
 * - restarts: a quick PASS tap.
 *
 * Human side 0. Deterministic for a given seed (its own LCG; the match rng is untouched).
 */
export interface BotOptions {
  /** Skill cuts when a defender closes (default true). */
  cuts?: boolean;
  /** Taps TACKLE near the carrier (default true). */
  tackles?: boolean;
  /** Holds PRESS near the carrier (default true). */
  press?: boolean;
  /** Double-tap SPRINT knock-ons now and then (default true). */
  knockOns?: boolean;
  /**
   * Plays it out to the wings the way the owner does (default false): a man within 8 m of a touchline, 10-32 m
   * away, is passed to whenever he's not marked tight (within 1.2 m), whoever else is on.
   */
  wing?: boolean;
  /**
   * The SKILL button (src/sim/skills.ts), default 'off': 'react' answers a defender's tell (the "!" over him) after a
   * human reaction time (0.16-0.30 s), four times in five, the stick across his run away from the man; 'spam' presses
   * it every ~0.75 s whenever a defender is within 3 m, whatever he is doing, the stick anywhere; 'use' is a player
   * who has found the button worth pressing: he answers the tells as 'react' does, takes on a man in his way (within
   * 3.5 m ahead, a pip of FLAIR to spend: the stick across his run away from him, or still ahead for a casual thumb),
   * and with all his pips and open grass ahead presses it for the burst.
   */
  skills?: 'off' | 'react' | 'spam' | 'use';
  /**
   * SPRINT (default 'button'): held the way a keyboard player holds it; 'none' never (a thumb on a phone with no
   * free finger for it, and so no knock-on double taps either); 'auto' the touch AUTO SPRINT (Pad.autoSprint: the
   * stick pushed all the way sprints).
   */
  sprint?: 'button' | 'none' | 'auto';
  /**
   * A casual phone player (default false), the way the owner plays rather than a tidy bot: slower to decide (0.3 to
   * 0.45 s), passes aimed 30 degrees either way, shoots from up to 22 m whether the lane is clear or not (SHOOT held
   * 0.2 to 0.6 s), turns sharply past a man less often, answers three tells in five and later (0.2 to 0.45 s), and
   * taps SKILL with the thumb still pushing the stick the way he runs half the time.
   */
  casual?: boolean;
  /**
   * The owner (2026-10-04): "i been walking in a straight line t opposie goal and i always make it to keeper and
   * score". With the ball: the stick held at the middle of their goal and nothing else (no pass, no cut, no shield, no
   * knock-on, no SKILL), and SHOOT the moment he is in their box. Without it he defends as the bot always does.
   */
  straight?: boolean;
  /**
   * The owner (2026-10-05): "i can keep spinning around ina circle with a joy stick and no one will ever get the ball
   * from me". With the ball: the stick pushed all the way and turned through a full circle every `circle` seconds
   * (0: off), and nothing else (no pass, no shot, no SKILL). Without it he defends as the bot always does.
   */
  circle?: number;
  /**
   * The owner (2026-10-05): "when the skill timing thing pops up, they don't tackle the player". With the ball: he
   * runs AT the nearest defender between him and their goal (the goal itself with nobody in his way), never presses
   * SKILL, never passes, and shoots once he is in their box. Every tell is ignored.
   */
  takeOn?: boolean;
}

/** How a carry of the bot's ended (BotTally.runEnds). */
export type RunEnd = 'shot' | 'tackled' | 'lost' | 'out' | 'fouled' | 'pass';

export interface BotTally {
  /** Skill cuts tried with a defender within ~3.2 m; how many drew a 'beat'; how many still had the ball 1.2 s on. */
  cutAttempts: number;
  cutBeats: number;
  cutKept: number;
  knockOns: number;
  knockKept: number;
  /** TACKLE taps near the carrier: won the tackle (a 'tackle' won by our man within 1 s), our ball within 1.5 s, fouls. */
  tackleTaps: number;
  tackleWon: number;
  tackleBall: number;
  tackleFouls: number;
  /** Tackles won by our men with no tap (auto tackles, press steals). */
  freeTackles: number;
  /** AI standing / slide tackles on our carriers: attempts, won. */
  aiTackles: number;
  aiTacklesWon: number;
  /** Our carriers dispossessed by a tackle (a 'tackle' won by the AI). */
  dispossessed: number;
  passes: number;
  passCmp: number;
  shots: number;
  fouls: number;
  foulsAgainst: number;
  /** Seconds our men had it at their feet in our defensive / middle / attacking third. */
  thirds: [number, number, number];
  /** SKILL moves made, and how they came off (PERFECT / GOOD: beat a man); tells shown on our carriers; SKILL GOALs. */
  skillMoves: number;
  skillPerfect: number;
  skillGood: number;
  skillTells: number;
  skillGoals: number;
  /**
   * His carries (the active man with the ball in open play, until he loses it, shoots or it goes dead): how many, how
   * many began with a man of theirs goal-side of him in his way (`runsFaced`), how many of those he got goal-side of
   * that man with the ball (`runsPast`), how many of all reached their box (`runsBox`), ended in his shot
   * (`runsShot`) and in a goal (`runsGoal`); and how each ended.
   */
  runs: number;
  runsFaced: number;
  runsPast: number;
  runsBox: number;
  runsShot: number;
  runsGoal: number;
  runEnds: Record<RunEnd, number>;
  /**
   * The carries that faced a man: the AI's tackle attempts on him and the tells it wound up (totals), the first
   * defender's nearest approach (m, summed), and the times that man was going backwards (towards his own goal, over
   * 2 m/s) when the carrier first came within 3 m of him (`backedOff`) against the times he came that near (`metFirst`).
   */
  runTackles: number;
  runTackleWon: number;
  runTells: number;
  runNearest: number;
  metFirst: number;
  backedOff: number;
  /** Carries that began in his own half with a man in the way, and how many of those ended in his shot. */
  longRuns: number;
  longShots: number;
  /**
   * RUNS: carries that began RUN_FROM m or more from their goal line with a man in the way (a run at the defence, not
   * a rebound in the box): how many, how many got goal-side of that first man, reached their box, ended in his shot,
   * and were scored.
   */
  farRuns: number;
  farPast: number;
  farBox: number;
  farShots: number;
  farGoals: number;
}

/** A carry is a RUN (BotTally.farRuns) when it begins this far (m) or more from their goal line. */
export const RUN_FROM = 30;

const emptyTally = (): BotTally => ({
  cutAttempts: 0, cutBeats: 0, cutKept: 0, knockOns: 0, knockKept: 0,
  tackleTaps: 0, tackleWon: 0, tackleBall: 0, tackleFouls: 0, freeTackles: 0,
  aiTackles: 0, aiTacklesWon: 0, dispossessed: 0, passes: 0, passCmp: 0, shots: 0, fouls: 0, foulsAgainst: 0, thirds: [0, 0, 0],
  skillMoves: 0, skillPerfect: 0, skillGood: 0, skillTells: 0, skillGoals: 0,
  runs: 0, runsFaced: 0, runsPast: 0, runsBox: 0, runsShot: 0, runsGoal: 0,
  runEnds: { shot: 0, tackled: 0, lost: 0, out: 0, fouled: 0, pass: 0 },
  runTackles: 0, runTackleWon: 0, runTells: 0, runNearest: 0, metFirst: 0, backedOff: 0, longRuns: 0, longShots: 0,
  farRuns: 0, farPast: 0, farBox: 0, farShots: 0, farGoals: 0,
});

type Btn = 'pass' | 'shoot' | 'through' | 'sprint';
type Plan =
  | { kind: 'shoot'; t: number; hold: number; x: number; z: number }
  | { kind: 'pass' | 'through'; t: number; x: number; z: number }
  | { kind: 'cut'; t: number; len: number; x: number; z: number; sprint: boolean }
  | { kind: 'shield'; t: number; len: number }
  | { kind: 'knock'; t: number; x: number; z: number };

const HS: Side = 0;

export class HumanBot {
  readonly tally = emptyTally();
  private s: number;
  private frame = 0;
  private think = 0;
  private stick = { x: 0, z: 0 };
  private sprintHeld = false;
  private pressHeld = false;
  private down: Record<Btn, number> = { pass: 0, shoot: 0, through: 0, sprint: 0 };
  private gap: Record<Btn, number> = { pass: 0, shoot: 0, through: 0, sprint: 0 };
  /** Scripted double tap of SPRINT: frames left (down 3, up 4, down 3). */
  private dbl = 0;
  private plan: Plan | null = null;
  private owned = -1;
  private ownT = 0;
  private passAfter = 1.5;
  private cutCool = 0;
  private tackleCool = 0;
  private switchCool = 0;
  private restartT = 0;
  private o: Required<BotOptions>;
  /** Open measurements: skill cuts / knock-ons (resolved 1.2 s on), tackle taps (1.5 s on). */
  private cuts: { f: number; knock: boolean; beat: boolean; lost: boolean }[] = [];
  private taps: { f: number; won: boolean; ball: boolean; foul: boolean }[] = [];
  private pendingPass: number | null = null;
  /** SKILL: the frame to press it on (-1: none), frames left down, the stick with it, the tells answered, the spam clock. */
  private skillAt = -1;
  private skillDown = 0;
  private skillDir = { x: 0, z: 0 };
  private tellsSeen = 0;
  private skillCool = 0;
  /** Its own generator for the SKILL decisions, so the bot's other choices draw exactly as they did without them. */
  private sk: number;
  /** The carry being measured (BotTally.runs): the carrier, the first man in his way (-1: none), and what has happened to it. */
  private run: { idx: number; first: number; past: boolean; box: boolean; loose: number; near: number; met: boolean; long: boolean; far: boolean } | null = null;
  private shotRun = -999;
  private shotFar = false;

  constructor(seed: number, opts: BotOptions = {}) {
    this.s = (Math.imul(seed + 17, 2654435761) >>> 0) || 1;
    this.sk = (Math.imul(seed + 71, 2246822519) >>> 0) || 1;
    this.o = { cuts: true, tackles: true, press: true, knockOns: true, wing: false, skills: 'off', sprint: 'button', casual: false, straight: false, circle: 0, takeOn: false, ...opts };
  }

  private skRnd(): number {
    this.sk = (Math.imul(this.sk, 1664525) + 1013904223) >>> 0;
    return this.sk / 4294967296;
  }

  private rnd(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  private tap(b: Btn, frames = 4): boolean {
    if (this.down[b] > 0 || this.gap[b] > 0) return false;
    this.down[b] = frames;
    return true;
  }

  /** The pad for this frame (call once per step, before Match.step). */
  pad(m: Match): Pad {
    this.frame++;
    this.cutCool = Math.max(0, this.cutCool - DT);
    this.tackleCool = Math.max(0, this.tackleCool - DT);
    this.switchCool = Math.max(0, this.switchCool - DT);
    this.decide(m);
    this.skillPlan(m);
    const out: Pad = { ...EMPTY_PAD, mx: this.stick.x, mz: this.stick.z };
    if (this.skillDown > 0) {
      // SKILL down, the stick where the move should go (only the press's frame picks the move).
      out.skill = true;
      out.mx = this.skillDir.x;
      out.mz = this.skillDir.z;
      this.skillDown--;
    }
    out.sprint = this.sprintHeld;
    if (this.dbl > 0) {
      out.sprint = this.dbl > 7 || this.dbl <= 3;
      this.dbl--;
    }
    out.through = this.pressHeld;
    const btns: Btn[] = this.o.sprint === 'button' ? ['pass', 'shoot', 'through', 'sprint'] : ['pass', 'shoot', 'through'];
    if (this.o.sprint !== 'button') {
      out.sprint = false;
      this.dbl = 0;
      if (this.o.sprint === 'auto') out.autoSprint = true;
    }
    for (const b of btns) {
      if (this.down[b] > 0) {
        if (b === 'sprint') out.sprint = true;
        else out[b] = true;
        this.down[b]--;
        if (this.down[b] === 0) this.gap[b] = 3;
      } else if (this.gap[b] > 0) {
        this.gap[b]--;
        if (b === 'through') out.through = false;
      }
    }
    return out;
  }

  private decide(m: Match): void {
    const b = m.ball;
    const a = m.active >= 0 ? m.players[m.active] : null;
    // Set pieces / kick-offs we take: a quick PASS with the default aim.
    if ((m.phase === 'restart' || m.phase === 'kickoff') && m.restart) {
      this.reset();
      if (m.restart.side === HS) {
        this.restartT += DT;
        if (this.restartT > 0.7 + this.rnd() * 0.02) {
          this.tap('pass');
          this.restartT = -1.5;
        }
      }
      return;
    }
    this.restartT = 0;
    if (m.phase !== 'play' || !a) {
      this.reset();
      return;
    }
    if (b.held) {
      this.reset();
      // Our keeper has it in his hands: roll it out.
      if (b.owner >= 0 && m.players[b.owner].side === HS && m.players[b.owner].stateT > 0.8) this.tap('pass');
      return;
    }
    const mine = b.owner === a.idx;
    if (mine) {
      if (this.owned !== a.idx) {
        this.owned = a.idx;
        this.ownT = 0;
        this.plan = null;
        this.passAfter = 1.0 + this.rnd() * 1.6;
      }
      this.ownT += DT;
      this.pressHeld = false;
      this.attack(m, a);
      return;
    }
    this.owned = -1;
    if (this.plan && this.plan.kind !== 'pass' && this.plan.kind !== 'through' && this.plan.kind !== 'shoot') this.plan = null;
    if (this.plan) {
      // (Keep the stick where the pass / shot went for a few frames, the way a thumb stays put.)
      this.plan.t += DT;
      if (this.plan.t > 0.3) this.plan = null;
      else return;
    }
    const opp = b.owner >= 0 && m.players[b.owner].side !== HS;
    if (opp) this.defend(m, a, m.players[b.owner]);
    else this.loose(m, a);
  }

  /** SKILL (BotOptions.skills): answer a tell after a reaction time, or mash it near a defender. */
  private skillPlan(m: Match): void {
    this.skillCool = Math.max(0, this.skillCool - DT);
    const tells = m.ctl[HS].skill.tells;
    const fresh = tells !== this.tellsSeen;
    this.tellsSeen = tells;
    if (this.o.skills === 'off') return;
    const a = m.active >= 0 ? m.players[m.active] : null;
    if (!a || m.phase !== 'play' || m.ball.owner !== a.idx || m.ball.held) {
      this.skillAt = -1;
      return;
    }
    if (this.skillAt >= 0) {
      if (this.frame >= this.skillAt) {
        this.skillAt = -1;
        this.skillDown = 3;
      }
      return;
    }
    const sp = a.speed();
    const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.facing);
    const hz = sp > 1 ? a.vel.z / sp : Math.sin(a.facing);
    if (this.o.skills === 'react' || this.o.skills === 'use') {
      if (fresh && this.skRnd() < (this.o.casual ? 0.6 : 0.8)) {
        const thr = m.ctl[HS].skill.threat;
        const o = thr ? m.players[thr.by] : null;
        // Across the run, away from the side he comes from (casual: half the time the thumb is still pushing ahead).
        const side = o ? lateral(a, o, hx, hz) : 1;
        this.skillDir = this.o.casual && this.skRnd() < 0.5 ? { x: hx, z: hz } : { x: -hz * side, z: hx * side };
        this.skillAt = this.frame + Math.round((this.o.casual ? 0.2 + this.skRnd() * 0.25 : 0.16 + this.skRnd() * 0.14) / DT);
        this.skillCool = 1;
        return;
      }
      if (this.o.skills === 'react' || this.skillCool > 0 || m.ctl[HS].skill.flair < 1 || a.ballT < 0.5) return;
      // 'use': a man in his way, or open grass and a full gauge.
      let ahead: Player | null = null;
      let ad = 9;
      for (const o of m.teamPlayers(1)) {
        if (o.sentOff || o.isKeeper) continue;
        const ox = o.pos.x - a.pos.x;
        const oz = o.pos.z - a.pos.z;
        const along = ox * hx + oz * hz;
        if (along < 0.5 || along > ad || Math.abs(-hz * ox + hx * oz) > Math.max(1.6, along * 0.5)) continue;
        ad = along;
        ahead = o;
      }
      if (ahead && ad < 3.5) {
        if (this.skRnd() < 0.5) {
          const side = lateral(a, ahead, hx, hz);
          this.skillDir = this.o.casual && this.skRnd() < 0.5 ? { x: hx, z: hz } : { x: -hz * side, z: hx * side };
          this.skillDown = 3;
        }
        this.skillCool = 1.1 + this.skRnd() * 0.6;
      } else if (!ahead && m.ctl[HS].skill.flair >= 2.9 && sp > 3 && hx * m.attackDir(HS) > 0.3) {
        this.skillDir = { x: hx, z: hz };
        this.skillDown = 3;
        this.skillCool = 2 + this.skRnd();
      }
      return;
    }
    // 'spam'
    if (this.skillCool > 0) return;
    let near = false;
    for (const o of m.teamPlayers(1)) if (!o.sentOff && !o.isKeeper && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < 3) near = true;
    if (!near) return;
    const r = this.skRnd();
    const ang = Math.atan2(hz, hx) + (r < 0.25 ? 0 : r < 0.5 ? Math.PI / 2 : r < 0.75 ? -Math.PI / 2 : Math.PI);
    this.skillDir = r < 0.1 ? { x: 0, z: 0 } : { x: Math.cos(ang), z: Math.sin(ang) };
    this.skillDown = 3;
    this.skillCool = 0.72 + this.skRnd() * 0.08;
  }

  private reset(): void {
    this.stick.x = this.stick.z = 0;
    this.sprintHeld = false;
    this.pressHeld = false;
    this.plan = null;
    this.owned = -1;
  }

  // ---------------------------------------------------------------- on the ball

  /** BotOptions.straight: the stick at the middle of their goal, SHOOT once he is in their box; nothing else. */
  private straightAttack(m: Match, c: Player): void {
    const gx = m.attackDir(HS) * HALF_L;
    const dx = gx - c.pos.x;
    const dz = -c.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    this.stick.x = dx / dl;
    this.stick.z = dz / dl;
    this.sprintHeld = true;
    const pl = this.plan;
    if (pl && pl.kind === 'shoot') {
      pl.t += DT;
      if (pl.t >= pl.hold + 0.2) this.plan = null;
      return;
    }
    this.plan = null;
    if (Math.abs(dx) < BOX_DEPTH && Math.abs(c.pos.z) < BOX_W / 2 && this.ownT > 0.1) {
      const hold = 0.3;
      this.plan = { kind: 'shoot', t: 0, hold, x: this.stick.x, z: this.stick.z };
      this.down.shoot = Math.round(hold / DT);
      this.gap.shoot = 0;
      this.tally.shots++;
    }
  }

  /** BotOptions.circle: the stick turned through a full circle every `circle` s, pushed all the way; nothing else. */
  private circleAttack(): void {
    const a = (this.ownT / this.o.circle) * Math.PI * 2;
    this.stick.x = Math.cos(a);
    this.stick.z = Math.sin(a);
    this.sprintHeld = true;
    this.plan = null;
  }

  /** BotOptions.takeOn: the stick at the nearest defender in his way (else their goal), SHOOT in their box; nothing else. */
  private takeOnAttack(m: Match, c: Player): void {
    const ad = m.attackDir(HS);
    let tx = ad * HALF_L;
    let tz = 0;
    let bd = 14;
    for (const o of m.teamPlayers(1)) {
      if (o.isKeeper || o.sentOff) continue;
      const ahead = (o.pos.x - c.pos.x) * ad;
      const d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
      // (A man he has reached is behind him the next moment: on to the next one, or the goal.)
      if (ahead < 1.2 || d >= bd || Math.abs(o.pos.z - c.pos.z) > 8) continue;
      bd = d;
      tx = o.pos.x;
      tz = o.pos.z;
    }
    const dx = tx - c.pos.x;
    const dz = tz - c.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    this.stick.x = dx / dl;
    this.stick.z = dz / dl;
    this.sprintHeld = true;
    const pl = this.plan;
    if (pl && pl.kind === 'shoot') {
      pl.t += DT;
      if (pl.t >= pl.hold + 0.2) this.plan = null;
      return;
    }
    this.plan = null;
    if (Math.abs(ad * HALF_L - c.pos.x) < BOX_DEPTH && Math.abs(c.pos.z) < BOX_W / 2 && this.ownT > 0.1) {
      const gl = Math.hypot(ad * HALF_L - c.pos.x, c.pos.z) || 1;
      this.stick.x = (ad * HALF_L - c.pos.x) / gl;
      this.stick.z = -c.pos.z / gl;
      const hold = 0.3;
      this.plan = { kind: 'shoot', t: 0, hold, x: this.stick.x, z: this.stick.z };
      this.down.shoot = Math.round(hold / DT);
      this.gap.shoot = 0;
      this.tally.shots++;
    }
  }

  private attack(m: Match, c: Player): void {
    if (this.o.straight) {
      this.straightAttack(m, c);
      return;
    }
    if (this.o.circle > 0) {
      this.circleAttack();
      return;
    }
    if (this.o.takeOn) {
      this.takeOnAttack(m, c);
      return;
    }
    const ad = m.attackDir(HS);
    const gx = ad * HALF_L;
    const pl = this.plan;
    if (pl) {
      pl.t += DT;
      switch (pl.kind) {
        case 'shoot':
          this.stick.x = pl.x;
          this.stick.z = pl.z;
          this.sprintHeld = false;
          if (pl.t >= pl.hold + 0.2) this.plan = null;
          return;
        case 'pass':
        case 'through':
          this.stick.x = pl.x;
          this.stick.z = pl.z;
          if (pl.t > 0.45) this.plan = null;
          return;
        case 'cut':
          this.stick.x = pl.x;
          this.stick.z = pl.z;
          this.sprintHeld = pl.sprint;
          if (pl.t >= pl.len) this.plan = null;
          return;
        case 'shield':
          this.stick.x = this.stick.z = 0;
          this.sprintHeld = false;
          if (pl.t >= pl.len) {
            this.plan = null;
            this.passAfter = Math.min(this.passAfter, this.ownT);
          }
          return;
        case 'knock':
          this.stick.x = pl.x;
          this.stick.z = pl.z;
          this.sprintHeld = true;
          if (pl.t > 0.5) this.plan = null;
          return;
      }
    }
    this.think -= DT;
    if (this.think > 0) return;
    this.think = this.o.casual ? 0.3 + this.rnd() * 0.15 : 0.15 + this.rnd() * 0.06;

    const toGx = gx - c.pos.x;
    const toGz = -c.pos.z;
    const dGoal = Math.hypot(toGx, toGz);
    // Nearest outfield opponent, and whether he's in front of us (towards goal / along our run).
    let near = Infinity;
    let no: Player | null = null;
    for (const o of m.teamPlayers(1)) {
      if (o.sentOff || o.isKeeper) continue;
      const d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
      if (d < near) {
        near = d;
        no = o;
      }
    }
    const sp = c.speed();
    const hx = sp > 1 ? c.vel.x / sp : toGx / dGoal;
    const hz = sp > 1 ? c.vel.z / sp : toGz / dGoal;
    const ahead = no ? ((no.pos.x - c.pos.x) * hx + (no.pos.z - c.pos.z) * hz) / Math.max(near, 0.1) : -1;

    // ---- Shoot: inside ~18 m, at a decent angle, with a clear lane (from close in, whatever).
    const ang = Math.abs(Math.atan2(Math.abs(c.pos.z), Math.abs(gx - c.pos.x)));
    const cas = this.o.casual;
    if (dGoal < (cas ? 22 : 19) && ang < (cas ? 1.1 : 1.0) && this.ownT > 0.15) {
      const k = m.keeperOf(1);
      const side = k && Math.abs(k.pos.z) > 0.3 ? -Math.sign(k.pos.z) : this.rnd() < 0.5 ? -1 : 1;
      const tz = side * GOAL_W * (0.28 + this.rnd() * 0.1);
      const clear = laneClear(m, c.pos.x, c.pos.z, gx, tz, 0.8);
      if ((clear && this.rnd() < 0.85) || (dGoal < (cas ? 22 : 12) && this.rnd() < (cas ? 0.5 : 0.55))) {
        const sx = gx - c.pos.x;
        const sz = tz - c.pos.z;
        const sl = Math.hypot(sx, sz) || 1;
        const hold = cas ? 0.2 + this.rnd() * 0.4 : 0.22 + this.rnd() * 0.18 + (dGoal > 14 ? 0.05 : 0);
        this.plan = { kind: 'shoot', t: 0, hold, x: sx / sl, z: sz / sl };
        this.down.shoot = Math.round(hold / DT);
        this.gap.shoot = 0;
        this.stick.x = sx / sl;
        this.stick.z = sz / sl;
        this.tally.shots++;
        return;
      }
    }

    // ---- A defender closing in front: cut past him (sometimes knock it by him, or shield), else pass.
    const closing = no ? -((no.vel.x * (no.pos.x - c.pos.x) + no.vel.z * (no.pos.z - c.pos.z)) / Math.max(near, 0.1)) + sp * ahead : 0;
    if (no && near < 3.0 && ahead > 0.5 && (closing > 1.5 || near < 2) && this.ownT > 0.25 && this.cutCool <= 0) {
      const r = this.rnd();
      this.cutCool = 1.2;
      if (this.o.knockOns && r < 0.07 && near > 2.2 && spaceBehind(m, c, no, hx, hz)) {
        const side = lateral(c, no, hx, hz);
        const a = Math.atan2(hz, hx) + side * 0.35;
        this.plan = { kind: 'knock', t: 0, x: Math.cos(a), z: Math.sin(a) };
        this.dbl = 10;
        this.cutCool = 1.5;
        this.cuts.push({ f: this.frame, knock: true, beat: false, lost: false });
        this.tally.knockOns++;
        return;
      }
      if (this.o.cuts && r < (this.o.casual ? 0.2 : 0.45)) {
        // Away from the side he's shading, 80-100 degrees off the run.
        const side = lateral(c, no, hx, hz);
        const turn = (80 + this.rnd() * 20) * (Math.PI / 180);
        const a = Math.atan2(hz, hx) + side * turn;
        let x = Math.cos(a);
        let z = Math.sin(a);
        // (Not straight into the touchline.)
        if (Math.abs(c.pos.z + z * 4) > HALF_W - 1) {
          const a2 = Math.atan2(hz, hx) - side * turn;
          x = Math.cos(a2);
          z = Math.sin(a2);
        }
        this.plan = { kind: 'cut', t: 0, len: 0.3 + this.rnd() * 0.2, x, z, sprint: this.rnd() < 0.5 };
        this.stick.x = x;
        this.stick.z = z;
        this.cutCool = 1.1;
        this.cuts.push({ f: this.frame, knock: false, beat: false, lost: false });
        this.tally.cutAttempts++;
        return;
      }
      if (r < 0.55 && near < 1.6) {
        this.plan = { kind: 'shield', t: 0, len: 0.25 + this.rnd() * 0.2 };
        return;
      }
      this.passAfter = Math.min(this.passAfter, this.ownT);
    }

    // ---- Pass: pressed, or he's had it a while.
    if (this.ownT > 0.3 && (near < 2.2 || this.ownT > this.passAfter)) {
      const t = this.pickTeammate(m, c);
      if (t) {
        const run = t.vel.x * ad > 4 && (t.pos.x - c.pos.x) * ad > 6;
        const kind = run && this.rnd() < 0.35 ? 'through' : 'pass';
        const err = (this.rnd() * 2 - 1) * ((this.o.casual ? 30 : 20) * Math.PI / 180);
        const a = Math.atan2(t.pos.z - c.pos.z, t.pos.x - c.pos.x) + err;
        this.plan = { kind, t: 0, x: Math.cos(a), z: Math.sin(a) };
        this.stick.x = Math.cos(a);
        this.stick.z = Math.sin(a);
        this.sprintHeld = false;
        this.tap(kind === 'pass' ? 'pass' : 'through', kind === 'pass' ? 4 : 2);
        this.pendingPass = this.frame;
        return;
      }
      this.passAfter = this.ownT + 0.6;
    }

    // ---- Dribble at goal, sprinting into space.
    const shade = Math.abs(c.pos.z) > HALF_W * 0.5 ? 0.9 : 0.5;
    const dx = toGx;
    const dz = toGz * shade;
    const dl = Math.hypot(dx, dz) || 1;
    const wob = (this.rnd() * 2 - 1) * 0.12;
    const a = Math.atan2(dz, dx) + wob;
    this.stick.x = Math.cos(a);
    this.stick.z = Math.sin(a);
    this.sprintHeld = near > 3.5 && c.stamina > 0.25;
    void dl;
  }

  private pickTeammate(m: Match, c: Player): Player | null {
    const ad = m.attackDir(HS);
    let best: Player | null = null;
    let bs = -Infinity;
    for (const t of m.teamPlayers(HS)) {
      if (t === c || t.isKeeper || t.sentOff) continue;
      const d = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
      const wing = this.o.wing && Math.abs(t.pos.z) >= HALF_W - 8 && d >= 10 && d <= 32;
      if (!wing && (d < 7 || d > 30)) continue;
      let mark = Infinity;
      for (const o of m.teamPlayers(1)) if (!o.sentOff) mark = Math.min(mark, Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z));
      if (mark < (wing ? 1.2 : 2)) continue;
      const lane = laneClear(m, c.pos.x, c.pos.z, t.pos.x, t.pos.z, 1.4);
      const fwd = ((t.pos.x - c.pos.x) * ad) / 10;
      const s = fwd * 1.2 + Math.min(mark, 7) * 0.35 + (lane ? 0.8 : -1.2) + this.rnd() * 2 - d * 0.03 + (wing ? 3 : 0);
      if (s > bs) {
        bs = s;
        best = t;
      }
    }
    return bs > -0.5 ? best : null;
  }

  // ---------------------------------------------------------------- defending

  private defend(m: Match, p: Player, c: Player): void {
    const b = m.ball;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    this.think -= DT;
    // Holding a slide: keep the button down (the scripted hold), stick along the chase.
    if (this.down.shoot > 0) return;
    if (this.think > 0) return;
    this.think = this.o.casual ? 0.3 + this.rnd() * 0.15 : 0.15 + this.rnd() * 0.06;
    // Far from it, and a teammate much nearer: switch.
    if (d > 14 && this.switchCool <= 0) {
      let best = Infinity;
      for (const q of m.teamPlayers(HS)) {
        if (q === p || q.isKeeper || q.sentOff) continue;
        best = Math.min(best, Math.hypot(b.pos.x - q.pos.x, b.pos.z - q.pos.z));
      }
      if (best < d - 6) {
        this.tap('pass');
        this.switchCool = 1;
      }
    }
    if (d > 7 || !this.o.press) {
      const lx = b.pos.x + c.vel.x * 0.35 - p.pos.x;
      const lz = b.pos.z + c.vel.z * 0.35 - p.pos.z;
      const ll = Math.hypot(lx, lz) || 1;
      this.stick.x = lx / ll;
      this.stick.z = lz / ll;
      this.sprintHeld = ll > 3;
      this.pressHeld = false;
    } else {
      // PRESS: hold THROUGH, stick neutral.
      this.stick.x = this.stick.z = 0;
      this.sprintHeld = false;
      this.pressHeld = true;
    }
    if (!this.o.tackles || this.tackleCool > 0 || p.state !== 'move') return;
    const r = this.rnd();
    // Behind him and he's getting away: now and then go to ground (TACKLE held).
    const tx = p.pos.x - c.pos.x;
    const tz = p.pos.z - c.pos.z;
    const behind = -(Math.cos(c.facing) * tx + Math.sin(c.facing) * tz) / Math.max(0.1, Math.hypot(tx, tz));
    if (d < 2.2 && behind > 0.5 && c.speed() > 4 && r < 0.06) {
      const lx = b.pos.x + c.vel.x * 0.2 - p.pos.x;
      const lz = b.pos.z + c.vel.z * 0.2 - p.pos.z;
      const ll = Math.hypot(lx, lz) || 1;
      this.stick.x = lx / ll;
      this.stick.z = lz / ll;
      this.pressHeld = false;
      this.down.shoot = 20;
      this.gap.shoot = 0;
      this.tackleCool = 1.2;
      this.openTap();
      return;
    }
    if ((d < 2.3 && r < 0.5) || (d > 2.8 && d < 5 && r < 0.06)) {
      if (this.tap('shoot', 4)) {
        this.tackleCool = 0.75;
        this.openTap();
      }
    }
  }

  private openTap(): void {
    this.taps.push({ f: this.frame, won: false, ball: false, foul: false });
    this.tally.tackleTaps++;
  }

  private loose(m: Match, p: Player): void {
    const b = m.ball;
    this.pressHeld = false;
    if (m.passTarget === p.idx) {
      // A pass on its way to him: leave the stick (the assisted receive runs him onto it).
      this.stick.x = this.stick.z = 0;
      this.sprintHeld = false;
      return;
    }
    this.think -= DT;
    if (this.think > 0) return;
    this.think = 0.14 + this.rnd() * 0.05;
    const lx = b.pos.x + b.vel.x * 0.3 - p.pos.x;
    const lz = b.pos.z + b.vel.z * 0.3 - p.pos.z;
    const ll = Math.hypot(lx, lz);
    if (ll < 0.3) {
      this.stick.x = this.stick.z = 0;
      return;
    }
    this.stick.x = lx / ll;
    this.stick.z = lz / ll;
    this.sprintHeld = ll > 3;
  }

  // ---------------------------------------------------------------- measurement

  /** His carries (BotTally.runs): one step of the count. */
  private trackRun(m: Match, evs: MatchEvent[]): void {
    const side = (i: number) => (i >= 0 ? m.players[i].side : -1);
    const ad = m.attackDir(HS);
    const gx = ad * HALF_L;
    const b = m.ball;
    const T = this.tally;
    for (const e of evs) {
      if (e.type !== 'goal' || e.side !== HS || e.own || this.frame - this.shotRun >= 240) continue;
      T.runsGoal++;
      if (this.shotFar) T.farGoals++;
      this.shotRun = -999;
    }
    let r = this.run;
    if (!r) {
      const a = m.active >= 0 ? m.players[m.active] : null;
      if (m.phase !== 'play' || !a || b.owner !== a.idx || b.held || a.isKeeper) return;
      // The first man in his way: the nearest outfielder of theirs goal-side of him, in a lane towards their goal.
      const tx = gx - a.pos.x;
      const tz = -a.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      let first = -1;
      let fd = 40;
      for (const o of m.teamPlayers(1)) {
        if (o.sentOff || o.isKeeper) continue;
        const ox = o.pos.x - a.pos.x;
        const oz = o.pos.z - a.pos.z;
        const along = (ox * tx + oz * tz) / tl;
        if (along < 1 || along > fd || Math.abs(-tz * ox + tx * oz) / tl > 7) continue;
        fd = along;
        first = o.idx;
      }
      r = this.run = {
        idx: a.idx, first, past: false, box: false, loose: 0, near: 99, met: false, long: first >= 0 && a.pos.x * ad < 0,
        far: first >= 0 && Math.abs(gx - a.pos.x) >= RUN_FROM,
      };
      T.runs++;
      if (first >= 0) T.runsFaced++;
      if (r.long) T.longRuns++;
      if (r.far) T.farRuns++;
    }
    const c = m.players[r.idx];
    let end: RunEnd | null = null;
    for (const e of evs) {
      if (e.type === 'skillTell' && e.on === r.idx && r.first >= 0) T.runTells++;
      else if (e.type === 'tackle' && side(e.by) === 1) {
        if (r.first >= 0 && (!e.won || !e.slide)) T.runTackles++;
        if (e.won) {
          if (r.first >= 0) T.runTackleWon++;
          end = 'tackled';
        }
      } else if (e.type === 'foul' && e.on === r.idx) end ??= 'fouled';
      else if (e.type === 'kick' && e.kind === 'shot' && (e.player ?? b.lastTouch) === r.idx) end ??= 'shot';
    }
    if (b.owner === r.idx && !end) {
      r.loose = 0;
      if (r.first >= 0) {
        const o = m.players[r.first];
        const d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
        r.near = Math.min(r.near, d);
        if (!r.met && d < 3) {
          r.met = true;
          T.metFirst++;
          if (o.vel.x * -ad > 2) T.backedOff++;
        }
        if (!r.past && c.pos.x * ad > o.pos.x * ad + 1) {
          r.past = true;
          T.runsPast++;
          if (r.far) T.farPast++;
        }
      }
      if (!r.box && Math.abs(gx - c.pos.x) < BOX_DEPTH && Math.abs(c.pos.z) < BOX_W / 2) {
        r.box = true;
        T.runsBox++;
        if (r.far) T.farBox++;
      }
    } else if (!end) {
      if (b.owner >= 0 && side(b.owner) === 1) end = 'lost';
      else if (m.phase !== 'play') end = 'out';
      else if (b.owner >= 0) end = 'pass';
      else if ((r.loose += DT) > 1.2) end = 'lost';
    }
    if (!end) return;
    T.runEnds[end]++;
    if (end === 'shot') {
      T.runsShot++;
      if (r.long) T.longShots++;
      if (r.far) T.farShots++;
      this.shotRun = this.frame;
      this.shotFar = r.far;
    }
    if (r.first >= 0) T.runNearest += r.near;
    this.run = null;
  }

  /** Feed the step's events (and the ball owner before the step). */
  observe(m: Match, evs: MatchEvent[], ownerBefore: number): void {
    const side = (i: number) => (i >= 0 ? m.players[i].side : -1);
    this.trackRun(m, evs);
    if (m.phase === 'play' && m.ball.owner >= 0 && side(m.ball.owner) === HS) {
      const u = (m.ball.pos.x * m.attackDir(HS)) / HALF_L;
      this.tally.thirds[u < -1 / 3 ? 0 : u < 1 / 3 ? 1 : 2] += DT;
    }
    for (const e of evs) {
      if (e.type === 'skillMove' && side(e.player) === HS && e.move !== 'cut' && e.move !== 'knock') {
        this.tally.skillMoves++;
        if (e.grade === 'perfect') this.tally.skillPerfect++;
        else if (e.grade === 'good') this.tally.skillGood++;
      } else if (e.type === 'skillTell' && side(e.on) === HS) this.tally.skillTells++;
      else if (e.type === 'skillGoal' && e.side === HS) this.tally.skillGoals++;
      if (e.type === 'beat' && side(e.by) === HS) {
        for (const c of this.cuts) if (!c.beat && this.frame - c.f < 40) c.beat = true;
      } else if (e.type === 'tackle') {
        if (side(e.by) === HS) {
          if (e.won) {
            const t = this.taps.find((x) => !x.won && this.frame - x.f <= 60);
            if (t) t.won = true;
            else this.tally.freeTackles++;
          }
        } else if (ownerBefore >= 0 && side(ownerBefore) === HS) {
          // (A slide shows twice: 'won: false' as he goes in, 'won: true' if it gets the ball.)
          if (!e.won || !e.slide) this.tally.aiTackles++;
          if (e.won) {
            this.tally.aiTacklesWon++;
            this.tally.dispossessed++;
          }
        }
      } else if (e.type === 'control') {
        const s = side(e.player);
        if (s === HS) {
          for (const t of this.taps) if (!t.ball && this.frame - t.f <= 90) t.ball = true;
          if (this.pendingPass !== null) {
            this.tally.passes++;
            this.tally.passCmp++;
            this.pendingPass = null;
          }
        } else {
          for (const c of this.cuts) if (this.frame - c.f < 72) c.lost = true;
          if (this.pendingPass !== null) {
            this.tally.passes++;
            this.pendingPass = null;
          }
        }
      } else if (e.type === 'foul') {
        if (side(e.by) === HS) {
          this.tally.fouls++;
          for (const t of this.taps) if (!t.foul && this.frame - t.f <= 60) t.foul = true;
        } else this.tally.foulsAgainst++;
      } else if (e.type === 'restart' || e.type === 'goal') {
        if (this.pendingPass !== null && this.frame - this.pendingPass > 0) {
          this.tally.passes++;
          this.pendingPass = null;
        }
        for (const c of this.cuts) if (this.frame - c.f < 72 && e.type === 'restart' && e.side !== HS) c.lost = true;
      }
    }
    // Close measurements that have run their time.
    while (this.cuts.length && this.frame - this.cuts[0].f >= 72) {
      const c = this.cuts.shift()!;
      const kept = !c.lost && (m.ball.owner < 0 ? m.ball.lastTouchSide === HS : side(m.ball.owner) === HS);
      if (c.knock) {
        if (kept) this.tally.knockKept++;
      } else {
        if (c.beat) this.tally.cutBeats++;
        if (kept) this.tally.cutKept++;
      }
    }
    while (this.taps.length && this.frame - this.taps[0].f > 90) {
      const t = this.taps.shift()!;
      if (t.won) this.tally.tackleWon++;
      if (t.ball) this.tally.tackleBall++;
      if (t.foul) this.tally.tackleFouls++;
    }
  }
}

/** Nobody of theirs (keeper aside) within `r` m of the line from (x0, z0) to (x1, z1). */
function laneClear(m: Match, x0: number, z0: number, x1: number, z1: number, r: number): boolean {
  const vx = x1 - x0;
  const vz = z1 - z0;
  const l2 = vx * vx + vz * vz || 1;
  for (const o of m.teamPlayers(1)) {
    if (o.sentOff || o.isKeeper) continue;
    const t = Math.max(0, Math.min(1, ((o.pos.x - x0) * vx + (o.pos.z - z0) * vz) / l2));
    if (Math.hypot(x0 + vx * t - o.pos.x, z0 + vz * t - o.pos.z) < r) return false;
  }
  return true;
}

/** Which way (+1 / -1, turning from the run) is away from the defender's side of it. */
function lateral(c: Player, o: Player, hx: number, hz: number): number {
  const lat = -hz * (o.pos.x - c.pos.x) + hx * (o.pos.z - c.pos.z);
  return lat > 0 ? -1 : 1;
}

/** Nobody else within 9 m beyond the defender along the run: room to knock it past him. */
function spaceBehind(m: Match, c: Player, o: Player, hx: number, hz: number): boolean {
  for (const q of m.teamPlayers(1)) {
    if (q === o || q.sentOff) continue;
    const ax = q.pos.x - c.pos.x;
    const az = q.pos.z - c.pos.z;
    const along = ax * hx + az * hz;
    if (along > 0 && along < 12 && Math.abs(-hz * ax + hx * az) < 4) return false;
  }
  return true;
}

// ------------------------------------------------------------------ whole matches

export interface BotMatch {
  gf: number;
  ga: number;
  /** Side 0 (the bot's) share of possession, 0..1. */
  poss: number;
  shotsFor: number;
  shotsAgainst: number;
  tally: BotTally;
  /** Team shape over the match (metricsHarness.sampleShape; the pressure counts are left at zero). */
  shape: ShapeStats;
}

export interface BotMatchOptions {
  seed: number;
  /** MatchConfig.difficulty (the menu's EASY 0.6 · NORMAL 1.8 · HARD 3 · LEGEND 4). */
  difficulty: number;
  home?: number;
  away?: number;
  halfLength?: number;
  bot?: BotOptions;
  /** MatchConfig.assist (dynamic difficulty) for the match. */
  assist?: number;
  /** The AI coach (MatchConfig.coach, as the game's own matches have it): default off. */
  coach?: boolean;
}

export function playBotMatch(o: BotMatchOptions): BotMatch {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[o.home ?? 5]),
    away: makeTeam(PRESET_CLUBS[o.away ?? 6]),
    halfLength: o.halfLength ?? 120,
    difficulty: o.difficulty,
    humanSide: HS,
    seed: o.seed,
    assist: o.assist,
    coach: o.coach,
  });
  const bot = new HumanBot(o.seed, o.bot);
  const shape = emptyShape();
  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 16; steps++) {
    if (steps % 6 === 0) sampleShape(m, shape);
    const pad = bot.pad(m);
    const before = m.ball.owner;
    m.step(DT, pad);
    bot.observe(m, m.drainEvents(), before);
    if (m.phase === 'halftime') {
      // What the match session does at the break: the AI manager freshens up two tired players.
      m.aiSubs(1, 2);
      m.continueSecondHalf();
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  const pz = m.stats.possession;
  return {
    gf: m.score[0],
    ga: m.score[1],
    poss: pz[0] / Math.max(1e-6, pz[0] + pz[1]),
    shotsFor: m.stats.shots[0],
    shotsAgainst: m.stats.shots[1],
    tally: bot.tally,
    shape,
  };
}

export interface BotSummary {
  n: number;
  difficulty: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  poss: number;
  shotsFor: number;
  shotsAgainst: number;
  /** Skill cuts: 'beat' per attempt, and still ours 1.2 s later. */
  beatPct: number;
  cutKeptPct: number;
  cutsPerMatch: number;
  knockKeptPct: number;
  /** TACKLE taps: won the tackle, won the ball back, fouls. */
  tackleWonPct: number;
  tackleBallPct: number;
  tackleFoulPct: number;
  tapsPerMatch: number;
  freeTackles: number;
  /** AI tackles on our carriers per match, and dispossessions per match. */
  aiTacklesWon: number;
  dispossessed: number;
  passPct: number;
  fouls: number;
  foulsAgainst: number;
  /** Share (%) of our time on the ball spent in the attacking third. */
  attThird: number;
  /** Team shape (side 0 is the bot's). */
  shape: ShapeSummary;
  /** SKILL moves per match, the share PERFECT / GOOD, tells per match, SKILL GOALs per match. */
  skillMoves: number;
  skillPerfectPct: number;
  skillGoodPct: number;
  skillTells: number;
  skillGoals: number;
}

/**
 * `n` matches at `difficulty` between equal-rated sides on average: adjacent preset clubs (levels ~5 apart),
 * with the bot on the weaker club in half of them and on the stronger in the other half.
 */
export function botSeries(n: number, difficulty: number, opts: { halfLength?: number; seed0?: number; bot?: BotOptions; coach?: boolean } = {}): BotSummary {
  const list: BotMatch[] = [];
  for (let i = 0; i < n; i++) {
    const k = 2 + (Math.floor(i / 2) % 8);
    const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
    list.push(playBotMatch({ seed: (opts.seed0 ?? 1000) + i * 97, difficulty, home, away, halfLength: opts.halfLength, bot: opts.bot, coach: opts.coach }));
  }
  return summariseBot(list, difficulty);
}

export function summariseBot(list: BotMatch[], difficulty: number): BotSummary {
  const n = list.length;
  const sum = (f: (r: BotMatch) => number) => list.reduce((a, r) => a + f(r), 0);
  const t = (f: (x: BotTally) => number) => sum((r) => f(r.tally));
  const pct = (a: number, b: number) => (a / Math.max(1, b)) * 100;
  return {
    n,
    difficulty,
    w: list.filter((r) => r.gf > r.ga).length,
    d: list.filter((r) => r.gf === r.ga).length,
    l: list.filter((r) => r.gf < r.ga).length,
    gf: sum((r) => r.gf) / n,
    ga: sum((r) => r.ga) / n,
    poss: (sum((r) => r.poss) / n) * 100,
    shotsFor: sum((r) => r.shotsFor) / n,
    shotsAgainst: sum((r) => r.shotsAgainst) / n,
    beatPct: pct(t((x) => x.cutBeats), t((x) => x.cutAttempts)),
    cutKeptPct: pct(t((x) => x.cutKept), t((x) => x.cutAttempts)),
    cutsPerMatch: t((x) => x.cutAttempts) / n,
    knockKeptPct: pct(t((x) => x.knockKept), t((x) => x.knockOns)),
    tackleWonPct: pct(t((x) => x.tackleWon), t((x) => x.tackleTaps)),
    tackleBallPct: pct(t((x) => x.tackleBall), t((x) => x.tackleTaps)),
    tackleFoulPct: pct(t((x) => x.tackleFouls), t((x) => x.tackleTaps)),
    tapsPerMatch: t((x) => x.tackleTaps) / n,
    freeTackles: t((x) => x.freeTackles) / n,
    aiTacklesWon: t((x) => x.aiTacklesWon) / n,
    dispossessed: t((x) => x.dispossessed) / n,
    passPct: pct(t((x) => x.passCmp), t((x) => x.passes)),
    fouls: t((x) => x.fouls) / n,
    foulsAgainst: t((x) => x.foulsAgainst) / n,
    attThird: pct(t((x) => x.thirds[2]), t((x) => x.thirds[0] + x.thirds[1] + x.thirds[2])),
    shape: summariseShape(list.map((r) => r.shape)),
    skillMoves: t((x) => x.skillMoves) / n,
    skillPerfectPct: pct(t((x) => x.skillPerfect), t((x) => x.skillMoves)),
    skillGoodPct: pct(t((x) => x.skillGood), t((x) => x.skillMoves)),
    skillTells: t((x) => x.skillTells) / n,
    skillGoals: t((x) => x.skillGoals) / n,
  };
}

export function fmtBot(s: BotSummary): string {
  const f = (v: number, d = 1) => v.toFixed(d);
  return `diff ${s.difficulty} N=${s.n}: W${s.w} D${s.d} L${s.l} | GF ${f(s.gf, 2)} GA ${f(s.ga, 2)} | poss ${f(s.poss)}% | shots ${f(s.shotsFor)}-${f(s.shotsAgainst)}` +
    ` | cuts ${f(s.cutsPerMatch)}/m beat ${f(s.beatPct)}% kept ${f(s.cutKeptPct)}% | knock kept ${f(s.knockKeptPct)}%` +
    ` | TACKLE taps ${f(s.tapsPerMatch)}/m won ${f(s.tackleWonPct)}% ball ${f(s.tackleBallPct)}% foul ${f(s.tackleFoulPct)}% | free tackles ${f(s.freeTackles)}/m` +
    ` | dispossessed ${f(s.dispossessed)}/m | pass ${f(s.passPct)}% | fouls ${f(s.fouls)}-${f(s.foulsAgainst)} | att third ${f(s.attThird)}% | ${fmtShape(s.shape)}` +
    ` | tells ${f(s.skillTells)}/m SKILL ${f(s.skillMoves)}/m perfect ${f(s.skillPerfectPct)}% good ${f(s.skillGoodPct)}% skill goals ${f(s.skillGoals, 2)}/m`;
}

// ------------------------------------------------------------------ the straight run

/** The straight-run bot's carries over a series (BotOptions.straight): see BotTally.runs. */
export interface StraightSummary {
  n: number;
  difficulty: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  /** Carries a match, and those with a man in the way. */
  runs: number;
  faced: number;
  /** Of the carries with a man in the way (%): past him, into the box, a shot, a goal. */
  pastPct: number;
  boxPct: number;
  shotPct: number;
  goalPct: number;
  /** Of the carries that began in his own half with a man in the way: how many a match, and the share that ended in his shot (%). */
  longRuns: number;
  longShotPct: number;
  /** RUNS (begun RUN_FROM m or more out, a man in the way): how many a match, and of them (%): past the first man, into the box, a shot, a goal. */
  farRuns: number;
  farPastPct: number;
  farBoxPct: number;
  farShotPct: number;
  farGoalPct: number;
  /** How the carries ended (% of all). */
  ends: Record<RunEnd, number>;
  /** Per carry with a man in the way: the AI's tackle attempts, the share of them won (%), tells, the first man's nearest approach (m). */
  tackles: number;
  tackleWonPct: number;
  tells: number;
  nearest: number;
  /** Of the times he came within 3 m of the first man: that man going backwards (%). */
  backedOffPct: number;
}

export function straightSeries(n: number, difficulty: number, opts: { halfLength?: number; seed0?: number; bot?: BotOptions; coach?: boolean } = {}): StraightSummary {
  const list: BotMatch[] = [];
  for (let i = 0; i < n; i++) {
    const k = 2 + (Math.floor(i / 2) % 8);
    const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
    list.push(playBotMatch({
      seed: (opts.seed0 ?? 7000) + i * 113, difficulty, home, away, halfLength: opts.halfLength, coach: opts.coach,
      bot: { straight: true, sprint: 'auto', skills: 'off', ...opts.bot },
    }));
  }
  const sum = (f: (r: BotMatch) => number) => list.reduce((a, r) => a + f(r), 0);
  const t = (f: (x: BotTally) => number) => sum((r) => f(r.tally));
  const pct = (a: number, b: number) => (a / Math.max(1, b)) * 100;
  const runs = t((x) => x.runs);
  const faced = t((x) => x.runsFaced);
  const ends = { shot: 0, tackled: 0, lost: 0, out: 0, fouled: 0, pass: 0 } as Record<RunEnd, number>;
  for (const k of Object.keys(ends) as RunEnd[]) ends[k] = pct(t((x) => x.runEnds[k]), runs);
  return {
    n, difficulty,
    w: list.filter((r) => r.gf > r.ga).length, d: list.filter((r) => r.gf === r.ga).length, l: list.filter((r) => r.gf < r.ga).length,
    gf: sum((r) => r.gf) / n, ga: sum((r) => r.ga) / n,
    runs: runs / n, faced: faced / n,
    pastPct: pct(t((x) => x.runsPast), faced), boxPct: pct(t((x) => x.runsBox), runs), shotPct: pct(t((x) => x.runsShot), runs),
    goalPct: pct(t((x) => x.runsGoal), runs),
    longRuns: t((x) => x.longRuns) / n, longShotPct: pct(t((x) => x.longShots), t((x) => x.longRuns)),
    farRuns: t((x) => x.farRuns) / n, farPastPct: pct(t((x) => x.farPast), t((x) => x.farRuns)), farBoxPct: pct(t((x) => x.farBox), t((x) => x.farRuns)),
    farShotPct: pct(t((x) => x.farShots), t((x) => x.farRuns)), farGoalPct: pct(t((x) => x.farGoals), t((x) => x.farRuns)),
    ends,
    tackles: t((x) => x.runTackles) / Math.max(1, faced), tackleWonPct: pct(t((x) => x.runTackleWon), t((x) => x.runTackles)),
    tells: t((x) => x.runTells) / Math.max(1, faced), nearest: t((x) => x.runNearest) / Math.max(1, faced),
    backedOffPct: pct(t((x) => x.backedOff), t((x) => x.metFirst)),
  };
}

export function fmtStraight(s: StraightSummary): string {
  const f = (v: number, d = 1) => v.toFixed(d);
  return `diff ${s.difficulty} N=${s.n}: W${s.w} D${s.d} L${s.l} GF ${f(s.gf, 2)} GA ${f(s.ga, 2)}` +
    ` | RUNS from ${RUN_FROM} m out ${f(s.farRuns)}/m: PAST THE FIRST MAN ${f(s.farPastPct)}% INTO THE BOX ${f(s.farBoxPct)}% SHOT ${f(s.farShotPct)}% GOAL ${f(s.farGoalPct)}%` +
    ` | all carries ${f(s.runs)}/m: past ${f(s.pastPct)}% box ${f(s.boxPct)}% shot ${f(s.shotPct)}% goal ${f(s.goalPct)}%` +
    ` | from his own half ${f(s.longRuns)}/m, shot ${f(s.longShotPct)}%` +
    ` | ended: shot ${f(s.ends.shot)}% tackled ${f(s.ends.tackled)}% lost ${f(s.ends.lost)}% out ${f(s.ends.out)}% fouled ${f(s.ends.fouled)}%` +
    ` | per carry: AI tackles ${f(s.tackles, 2)} (won ${f(s.tackleWonPct)}%) tells ${f(s.tells, 2)} first man nearest ${f(s.nearest, 2)} m, backing off ${f(s.backedOffPct)}%`;
}
