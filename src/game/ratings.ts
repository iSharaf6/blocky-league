import type { Match } from '../sim/match';
import type { Side } from '../sim/types';

/** What a player did in the match (the DLS-style rating is made from it). */
export interface Tally {
  goals: number;
  assists: number;
  tackles: number;
  saves: number;
  passes: number;
  shots: number;
}

export interface PlayerRating {
  idx: number;
  name: string;
  side: Side;
  rating: number;
  goals: number;
  assists: number;
}

/** A man who was taken off: his tally as it stood, under his own name (the slot's tally starts again for the sub). */
interface Benched {
  idx: number;
  name: string;
  side: Side;
  keeper: boolean;
  defender: boolean;
  tally: Tally;
}

const zero = (): Tally => ({ goals: 0, assists: 0, tackles: 0, saves: 0, passes: 0, shots: 0 });

/**
 * Per-player tallies keyed by identity, not by lineup slot. The sim reuses the slot (Player.idx) for a
 * substitute, so a slot-keyed tally handed the sub everything the man he replaced had done (round 12's
 * critic: "MAN OF THE MATCH T. Ekström 8.0, 1 goal" for a sub who scored nothing). On a substitution the
 * outgoing man's tally is frozen under his name and the slot's tally restarts at zero for the man coming on;
 * ratings() lists both.
 */
export class MatchTally {
  private readonly slots: Tally[] = Array.from({ length: 22 }, zero);
  private readonly benched: Benched[] = [];

  /** The live tally of whoever occupies slot `idx` now. */
  get(idx: number): Tally {
    return this.slots[idx];
  }

  /** A substitution in slot `idx`: `off` is the name of the man going off, `keeper` / `defender` his job. */
  sub(idx: number, off: string, side: Side, keeper: boolean, defender: boolean): void {
    const t = this.slots[idx];
    this.benched.push({ idx, name: off, side, keeper, defender, tally: { ...t } });
    this.slots[idx] = zero();
  }

  /** DLS-style 1–10 match ratings from what each player actually did, best first (the subs' predecessors included). */
  ratings(m: Match): PlayerRating[] {
    const score = m.score;
    const rate = (t: Tally, side: Side, keeper: boolean, defender: boolean): number => {
      const my = score[side];
      const their = score[side === 0 ? 1 : 0];
      let r = 6.1 + t.goals * 1.15 + t.assists * 0.6 + t.tackles * 0.14 + t.saves * 0.4 + Math.min(t.passes, 40) * 0.025 + t.shots * 0.05;
      r += my > their ? 0.4 : my < their ? -0.35 : 0;
      if (keeper || defender) r -= their * (keeper ? 0.35 : 0.15);
      if (keeper && their === 0) r += 0.6;
      return Math.round(Math.max(3.5, Math.min(10, r)) * 10) / 10;
    };
    const out: PlayerRating[] = m.players.map((p) => {
      const t = this.slots[p.idx];
      return { idx: p.idx, name: p.def.name, side: p.side, rating: rate(t, p.side, p.isKeeper, p.role === 'DF'), goals: t.goals, assists: t.assists };
    });
    for (const b of this.benched) {
      out.push({ idx: b.idx, name: b.name, side: b.side, rating: rate(b.tally, b.side, b.keeper, b.defender), goals: b.tally.goals, assists: b.tally.assists });
    }
    return out.sort((a, b) => b.rating - a.rating || b.goals - a.goals);
  }
}
