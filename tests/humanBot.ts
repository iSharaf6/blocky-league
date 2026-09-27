import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, GOAL_W, HALF_L, HALF_W } from '../src/sim/constants';
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
}

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
}

const emptyTally = (): BotTally => ({
  cutAttempts: 0, cutBeats: 0, cutKept: 0, knockOns: 0, knockKept: 0,
  tackleTaps: 0, tackleWon: 0, tackleBall: 0, tackleFouls: 0, freeTackles: 0,
  aiTackles: 0, aiTacklesWon: 0, dispossessed: 0, passes: 0, passCmp: 0, shots: 0, fouls: 0, foulsAgainst: 0, thirds: [0, 0, 0],
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

  constructor(seed: number, opts: BotOptions = {}) {
    this.s = (Math.imul(seed + 17, 2654435761) >>> 0) || 1;
    this.o = { cuts: true, tackles: true, press: true, knockOns: true, wing: false, ...opts };
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
    const out: Pad = { ...EMPTY_PAD, mx: this.stick.x, mz: this.stick.z };
    out.sprint = this.sprintHeld;
    if (this.dbl > 0) {
      out.sprint = this.dbl > 7 || this.dbl <= 3;
      this.dbl--;
    }
    out.through = this.pressHeld;
    for (const b of ['pass', 'shoot', 'through', 'sprint'] as Btn[]) {
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

  private reset(): void {
    this.stick.x = this.stick.z = 0;
    this.sprintHeld = false;
    this.pressHeld = false;
    this.plan = null;
    this.owned = -1;
  }

  // ---------------------------------------------------------------- on the ball

  private attack(m: Match, c: Player): void {
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
    this.think = 0.15 + this.rnd() * 0.06;

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
    if (dGoal < 19 && ang < 1.0 && this.ownT > 0.15) {
      const k = m.keeperOf(1);
      const side = k && Math.abs(k.pos.z) > 0.3 ? -Math.sign(k.pos.z) : this.rnd() < 0.5 ? -1 : 1;
      const tz = side * GOAL_W * (0.28 + this.rnd() * 0.1);
      const clear = laneClear(m, c.pos.x, c.pos.z, gx, tz, 0.8);
      if ((clear && this.rnd() < 0.85) || (dGoal < 12 && this.rnd() < 0.55)) {
        const sx = gx - c.pos.x;
        const sz = tz - c.pos.z;
        const sl = Math.hypot(sx, sz) || 1;
        const hold = 0.22 + this.rnd() * 0.18 + (dGoal > 14 ? 0.05 : 0);
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
      if (this.o.cuts && r < 0.45) {
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
        const err = (this.rnd() * 2 - 1) * (20 * Math.PI / 180);
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
    this.think = 0.15 + this.rnd() * 0.06;
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

  /** Feed the step's events (and the ball owner before the step). */
  observe(m: Match, evs: MatchEvent[], ownerBefore: number): void {
    const side = (i: number) => (i >= 0 ? m.players[i].side : -1);
    if (m.phase === 'play' && m.ball.owner >= 0 && side(m.ball.owner) === HS) {
      const u = (m.ball.pos.x * m.attackDir(HS)) / HALF_L;
      this.tally.thirds[u < -1 / 3 ? 0 : u < 1 / 3 ? 1 : 2] += DT;
    }
    for (const e of evs) {
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
}

/**
 * `n` matches at `difficulty` between equal-rated sides on average: adjacent preset clubs (levels ~5 apart),
 * with the bot on the weaker club in half of them and on the stronger in the other half.
 */
export function botSeries(n: number, difficulty: number, opts: { halfLength?: number; seed0?: number; bot?: BotOptions } = {}): BotSummary {
  const list: BotMatch[] = [];
  for (let i = 0; i < n; i++) {
    const k = 2 + (Math.floor(i / 2) % 8);
    const [home, away] = i % 2 === 0 ? [k, k + 1] : [k + 1, k];
    list.push(playBotMatch({ seed: (opts.seed0 ?? 1000) + i * 97, difficulty, home, away, halfLength: opts.halfLength, bot: opts.bot }));
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
  };
}

export function fmtBot(s: BotSummary): string {
  const f = (v: number, d = 1) => v.toFixed(d);
  return `diff ${s.difficulty} N=${s.n}: W${s.w} D${s.d} L${s.l} | GF ${f(s.gf, 2)} GA ${f(s.ga, 2)} | poss ${f(s.poss)}% | shots ${f(s.shotsFor)}-${f(s.shotsAgainst)}` +
    ` | cuts ${f(s.cutsPerMatch)}/m beat ${f(s.beatPct)}% kept ${f(s.cutKeptPct)}% | knock kept ${f(s.knockKeptPct)}%` +
    ` | TACKLE taps ${f(s.tapsPerMatch)}/m won ${f(s.tackleWonPct)}% ball ${f(s.tackleBallPct)}% foul ${f(s.tackleFoulPct)}% | free tackles ${f(s.freeTackles)}/m` +
    ` | dispossessed ${f(s.dispossessed)}/m | pass ${f(s.passPct)}% | fouls ${f(s.fouls)}-${f(s.foulsAgainst)} | att third ${f(s.attThird)}% | ${fmtShape(s.shape)}`;
}
