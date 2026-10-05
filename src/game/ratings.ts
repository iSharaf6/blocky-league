import type { Match } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';

/** What a player did in the match (the DLS-style rating is made from it). */
export interface Tally {
  goals: number;
  assists: number;
  tackles: number;
  saves: number;
  passes: number;
  shots: number;
  /** The club's record book (meta/stats.ts) also wants these; absent on a tally from before (read as zero). */
  conceded?: number;
  pensSaved?: number;
  yellow?: number;
  red?: number;
}

export interface PlayerRating {
  idx: number;
  name: string;
  side: Side;
  rating: number;
  goals: number;
  assists: number;
  /** What the record book wants (ui/forever.ts matchFacts): his keeping, his cards, and the minutes he was on for. */
  saves?: number;
  conceded?: number;
  pensSaved?: number;
  yellow?: number;
  red?: number;
  keeper?: boolean;
  /** The football minute he came on (0: he started) and went off (or the end, 90 at the most). */
  on?: number;
  off?: number;
}

/** A man who was taken off: his tally as it stood, under his own name (the slot's tally starts again for the sub). */
interface Benched {
  idx: number;
  name: string;
  side: Side;
  keeper: boolean;
  defender: boolean;
  tally: Tally;
  on?: number;
  off?: number;
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
  /** The minute the man in each slot came on / went off (a red card), and the minute of the change being made. */
  private onAt?: number[];
  private offAt?: (number | undefined)[];
  private subMin?: number;
  /** The side a penalty was awarded to, until it is taken (a save from then on is a penalty saved). */
  private penFor?: Side | -1;

  /** The live tally of whoever occupies slot `idx` now. */
  get(idx: number): Tally {
    return this.slots[idx];
  }

  /**
   * A substitution in slot `idx`: `off` is the name of the man going off, `keeper` / `defender` his job. The minute of
   * the change is the one observe() saw on its 'sub' event.
   */
  sub(idx: number, off: string, side: Side, keeper: boolean, defender: boolean): void {
    const t = this.slots[idx];
    const at = this.subMin ?? 0;
    const on = (this.onAt ??= [])[idx] ?? 0;
    this.benched.push({ idx, name: off, side, keeper, defender, tally: { ...t }, on, off: Math.min(this.offAt?.[idx] ?? at, at) });
    this.slots[idx] = zero();
    this.onAt[idx] = at;
    if (this.offAt) this.offAt[idx] = undefined;
  }

  /**
   * Every event of the match goes through here (matchSession.ts handleEvents): the minute of a change, the cards,
   * the goals a keeper lets in, and the penalties he saves. These only feed the club's record book.
   */
  observe(e: MatchEvent, m: Match): void {
    switch (e.type) {
      case 'sub':
        this.subMin = Math.min(90, m.minute());
        break;
      case 'restart':
        this.penFor = e.kind === 'penalty' ? e.side : -1;
        break;
      case 'goal': {
        this.penFor = -1;
        // The side the goal counts for scored it; the other keeper let it in.
        const k = m.keeperOf(e.side === 0 ? 1 : 0);
        if (k) {
          const t = this.slots[k.idx];
          t.conceded = (t.conceded ?? 0) + 1;
        }
        break;
      }
      case 'save': {
        const k = m.players[e.keeper];
        if (k && !m.shootout && this.penFor !== undefined && this.penFor >= 0 && this.penFor !== k.side && m.shotClock < 2) {
          const t = this.slots[k.idx];
          t.pensSaved = (t.pensSaved ?? 0) + 1;
          this.penFor = -1;
        }
        break;
      }
      case 'card': {
        const p = m.players[e.player];
        if (!p) break;
        const t = this.slots[p.idx];
        if (e.color === 'red') {
          t.red = (t.red ?? 0) + 1;
          (this.offAt ??= [])[p.idx] = Math.min(90, m.minute());
        } else t.yellow = (t.yellow ?? 0) + 1;
        break;
      }
      default:
    }
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
    // The minutes: a starter is on from 0, a sub from the minute he came on, to a red card, his change, or the end.
    const end = Math.max(1, Math.min(90, m.minute()));
    const detail = (t: Tally, keeper: boolean, on: number, off: number): Partial<PlayerRating> => ({
      saves: t.saves, conceded: t.conceded ?? 0, pensSaved: t.pensSaved ?? 0, yellow: t.yellow ?? 0, red: t.red ?? 0, keeper, on, off,
    });
    const out: PlayerRating[] = m.players.map((p) => {
      const t = this.slots[p.idx];
      const on = Math.min(end, this.onAt?.[p.idx] ?? 0);
      return {
        idx: p.idx, name: p.def.name, side: p.side, rating: rate(t, p.side, p.isKeeper, p.role === 'DF'), goals: t.goals, assists: t.assists,
        ...detail(t, p.isKeeper, on, Math.max(on, this.offAt?.[p.idx] ?? end)),
      };
    });
    for (const b of this.benched) {
      out.push({
        idx: b.idx, name: b.name, side: b.side, rating: rate(b.tally, b.side, b.keeper, b.defender), goals: b.tally.goals, assists: b.tally.assists,
        ...detail(b.tally, b.keeper, b.on ?? 0, b.off ?? end),
      });
    }
    return out.sort((a, b) => b.rating - a.rating || b.goals - a.goals);
  }
}
