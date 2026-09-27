import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { stateHash } from '../src/net/hash';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../src/sim/match';
import type { Side } from '../src/sim/types';

/**
 * Deterministic "button masher" pads for the netcode tests: the stick held one way for a while (analog or
 * 8-way digital), sprint toggled, PASS / THROUGH tapped, SHOOT held for a charge, THROUGH held for a lob,
 * the blitz power button now and then. Its own LCG: the match rng is untouched.
 */
export class FuzzPad {
  private s: number;
  private hold = 0;
  private mx = 0;
  private mz = 0;
  private digital = false;
  private sprint = false;
  private sprintT = 0;
  private down = { pass: 0, shoot: 0, through: 0, power: 0 };

  constructor(seed: number) {
    this.s = (Math.imul(seed + 101, 2654435761) >>> 0) || 1;
  }

  private rnd(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  pad(): Pad {
    if (--this.hold <= 0) {
      this.hold = 15 + Math.floor(this.rnd() * 50);
      const r = this.rnd();
      this.digital = this.rnd() < 0.4;
      if (r < 0.15) {
        this.mx = this.mz = 0;
      } else {
        let a = this.rnd() * Math.PI * 2;
        let l = r < 0.35 ? 0.55 : 1;
        if (this.digital) {
          a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
          l = 1;
        }
        this.mx = Math.cos(a) * l;
        this.mz = Math.sin(a) * l;
      }
    }
    if (--this.sprintT <= 0) {
      this.sprintT = 30 + Math.floor(this.rnd() * 90);
      this.sprint = this.rnd() < 0.45;
    }
    const d = this.down;
    const idle = d.pass <= 0 && d.shoot <= 0 && d.through <= 0;
    if (idle) {
      const r = this.rnd();
      if (r < 0.03) d.pass = 3 + Math.floor(this.rnd() * 3);
      else if (r < 0.045) d.shoot = 5 + Math.floor(this.rnd() * 30);
      else if (r < 0.055) d.through = this.rnd() < 0.5 ? 3 : 20 + Math.floor(this.rnd() * 25);
    }
    if (d.power <= 0 && this.rnd() < 0.004) d.power = 3;
    const pad: Pad = {
      mx: this.mx, mz: this.mz, sprint: this.sprint,
      pass: d.pass > 0, shoot: d.shoot > 0, through: d.through > 0, digital: this.digital, power: d.power > 0,
    };
    // (A gap of one frame after each press, so the next one is a fresh press edge.)
    d.pass--;
    d.shoot--;
    d.through--;
    d.power--;
    return pad;
  }
}

/** A match config for the tests: two preset clubs (by index), short halves. */
export function netConfig(o: Partial<MatchConfig> & { seed: number }, homeIdx = 5, awayIdx = 6): MatchConfig {
  return {
    home: makeTeam(PRESET_CLUBS[homeIdx]),
    away: makeTeam(PRESET_CLUBS[awayIdx]),
    halfLength: 60,
    difficulty: 1.8,
    humanSide: -1,
    ...o,
  };
}

/**
 * What a session does between steps that changes the sim, deterministically (the online driver does the
 * same): the second half after the break, the kick-off after a goal. `humans`: sides the AI manager must not
 * touch at half time.
 */
export function stoppages(m: Match, humans: readonly boolean[]): void {
  if (m.phase === 'halftime') {
    for (const side of [0, 1] as Side[]) if (!humans[side]) m.aiSubs(side, 2);
    m.continueSecondHalf();
  }
  if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
}

export interface RunResult {
  m: Match;
  steps: number;
  /** stateHash at the end. */
  end: number;
  /** A running fold of stateHash every 60 steps (any divergence along the way changes it). */
  trail: number;
}

/** Runs a match to full time, `pads(m)` giving the step's input (one pad, or a pair). */
export function runToEnd(m: Match, pads: (m: Match) => Pad | readonly [Pad, Pad], humans: readonly boolean[], limit = 60 * 60 * 20): RunResult {
  let steps = 0;
  let trail = 0;
  while (m.phase !== 'fulltime' && steps < limit) {
    // (The step's signature before and after two-human support takes a single pad; a pair only once it exists.)
    (m.step as (dt: number, p: Pad | readonly [Pad, Pad]) => void).call(m, DT, pads(m));
    m.drainEvents();
    stoppages(m, humans);
    steps++;
    if (steps % 60 === 0) trail = (Math.imul(trail ^ stateHash(m), 16777619) + steps) >>> 0;
  }
  return { m, steps, end: stateHash(m), trail };
}

export { EMPTY_PAD };
