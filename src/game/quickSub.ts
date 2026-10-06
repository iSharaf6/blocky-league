import type { Match } from '../sim/match';
import type { PlayerDef, ScenarioSpec, Side } from '../sim/types';

/**
 * Quick subs: the manager's shortcut to a change without opening the pause menu. When one of the human side's
 * outfielders is running on empty (or is walking a tightrope on a yellow) a small card offers the change the AI
 * bench would make for him (Match.subPick: like for like, else any outfielder); one press queues it and it is
 * made at the next dead ball, through the same substitute path as the tactics screen. This is the rules half (no
 * DOM, so the tests drive it with a bare Match); src/ui/quickSub.ts draws the card and the board.
 *
 * The AI benches never touch the human's side (Match.autoSubs, MatchSession.continueSecondHalf), so the two
 * never fight over a player: every change on this side is the human's own choice.
 */

/** Offered once an outfielder's stamina drops under this (the player chip goes red at 0.3, amber under 0.5). */
export const QS_TIRED = 0.4;
/** Seconds an offer stays up if it's ignored (counted only while it's on screen). */
export const QS_SHOW_S = 9;
/** Brief acknowledgement/Undo window after accepting; the change still waits for a safe stoppage. */
export const QS_QUEUED_SHOW_S = 3;
/** A player whose offer was ignored, dismissed or undone isn't offered again for this long (real seconds) ... */
export const QS_SNOOZE_S = 25;
/** ... nor for this many match minutes, whichever is longer (long halves: a minute is a lot of seconds). */
export const QS_SNOOZE_MIN = 3;
/** A breather after any card goes before the next one comes up (no card popping straight back). */
export const QS_GAP_S = 6;
/** After a dismiss (×): the manager said "not now", so nothing for a while. */
export const QS_QUIET_S = 20;
/** Seconds the substitution board stays up once the change is made. */
export const QS_BOARD_S = 2.8;

export type QuickSubMode = 'idle' | 'offer' | 'queued' | 'board';

/** A change on offer (or queued): who goes off (by player index, as he was when offered) and who comes on. */
export interface QuickSubOffer {
  /** Match.players index of the man going off, and his identity then (a change made meanwhile voids the offer). */
  idx: number;
  offId: string;
  off: PlayerDef;
  /** The bench player coming on (re-picked if a change made meanwhile used him). */
  on: PlayerDef;
  reason: 'tired' | 'booked';
}

/** The change just made, for the board. */
export interface QuickSubDone {
  off: PlayerDef;
  on: PlayerDef;
}

/**
 * Quick subs belong to an ordinary match against the AI: never online (no subs there: src/net/setup.ts), a
 * Football Moment or a LEARN THE BASICS step (both are scenarios), the menu's demo match or AI v AI.
 */
export function quickSubsAllowed(o: {
  humanSide: Side | -1; humanSides?: readonly [boolean, boolean]; scenario?: ScenarioSpec | null; demo?: boolean;
}): boolean {
  return !o.demo && !o.scenario && !o.humanSides && (o.humanSide === 0 || o.humanSide === 1);
}

/**
 * A dead ball the change can be made at, as far as the sim goes: the ball out (a throw, corner, goal kick or free
 * kick), half time, or the kick-off after a goal. Never with a penalty given (the AI benches wait too), and never
 * pulling off the man about to take the restart or holding the ball for it, or once a taker is stepping in.
 */
export function quickSubStoppage(m: Match, off: number): boolean {
  if (m.phase === 'halftime') return true;
  const r = m.restart;
  if (r?.kind === 'penalty') return false;
  if (m.phase === 'out') return true;
  if (m.phase !== 'restart' && m.phase !== 'kickoff') return false;
  return m.ball.owner !== off && r?.taker !== off && m.stepIn < 0;
}

export class QuickSubs {
  mode: QuickSubMode = 'idle';
  offer: QuickSubOffer | null = null;
  /** The board's change while mode is 'board'. */
  done: QuickSubDone | null = null;
  /** Seconds left: the offer, queued acknowledgement or completed board's time on screen. */
  left = 0;
  /** Settings > QUICK SUBS. Off: nothing is offered and a queued change is dropped. */
  enabled = true;
  /** Bumped on every change of mode or of the players shown (the card redraws on it). */
  rev = 0;
  private t = 0;
  private quietUntil = 0;
  /** Seconds to the next look for someone to offer (a few times a second is plenty). */
  private lookT = 0;
  /** By player identity: when he can be offered again. */
  private readonly snoozed = new Map<string, number>();
  /** Players already offered for their yellow card (once per booking is plenty). */
  private readonly bookedSeen = new Set<string>();
  /** The change this made, until its 'sub' event comes through (the session shows the board instead of the toast). */
  private claim: { slot: number; on: string } | null = null;

  constructor(
    readonly match: Match,
    readonly side: Side,
    /** Makes the change (the session's substitute: the sim, the drawn model and the ratings tally). */
    private readonly sub: (slot: number, benchIdx: number) => boolean = (slot, benchIdx) => match.substitute(side, slot, benchIdx),
  ) {}

  /** Changes still allowed. */
  get subsLeft(): number {
    return Math.max(0, this.match.maxSubs - this.match.subsUsed[this.side]);
  }

  /**
   * Once a frame. `shown`: the card can be on screen (live play or a dead ball on the broadcast lens: never a
   * replay, a celebration, the card close-up or the pause menu); offers only come up, and only count down, then.
   * `ready`: the picture is free for a change now (no card close-up, no foul beat, not paused). A queued change is
   * made the first frame both that and the sim say it's a stoppage (quickSubStoppage).
   */
  update(dt: number, shown: boolean, ready: boolean): void {
    this.t += dt;
    const m = this.match;
    if (this.mode === 'board') {
      this.left -= dt;
      if (this.left <= 0) this.toIdle(QS_GAP_S);
      return;
    }
    if (!this.enabled || m.phase === 'fulltime' || m.phase === 'shootout') {
      if (this.mode !== 'idle') this.toIdle(0);
      return;
    }
    if (this.mode === 'queued') {
      // The pending change can wait through a whole attack; its full card should not cover that attack.
      // Count only visible time so a replay/pause cannot swallow the acknowledgement or Undo window.
      if (shown) this.left = Math.max(0, this.left - dt);
      const o = this.offer;
      if (!o || !this.valid(o)) this.toIdle(QS_GAP_S);
      else if (ready && quickSubStoppage(m, o.idx)) this.execute(o);
      return;
    }
    if (this.mode === 'offer') {
      const o = this.offer;
      if (!o || !this.valid(o)) {
        this.toIdle(QS_GAP_S);
        return;
      }
      if (!shown) return;
      this.left -= dt;
      if (this.left <= 0) {
        this.snooze(o, 1);
        this.toIdle(QS_GAP_S);
      }
      return;
    }
    this.lookT -= dt;
    if (!shown || this.t < this.quietUntil || this.lookT > 0) return;
    this.lookT = 0.25;
    const o = this.pick();
    if (!o) return;
    if (o.reason === 'booked') this.bookedSeen.add(o.offId);
    this.offer = o;
    this.mode = 'offer';
    this.left = QS_SHOW_S;
    this.rev++;
  }

  /**
   * The change to offer now, or null: the most tired outfielder under QS_TIRED, else one on a yellow (once per
   * booking); never a keeper, a man sent off, one snoozed, or with no change left or nobody on the bench to send on.
   */
  pick(): QuickSubOffer | null {
    const m = this.match;
    if (this.subsLeft <= 0) return null;
    const team = m.teamPlayers(this.side).filter((p) => !p.isKeeper && !p.sentOff && (this.snoozed.get(p.def.id) ?? -1) <= this.t);
    const tired = team.filter((p) => p.stamina < QS_TIRED).sort((a, b) => a.stamina - b.stamina || a.slot - b.slot);
    const booked = team.filter((p) => m.booked.has(p.idx) && !this.bookedSeen.has(p.def.id));
    for (const [list, reason] of [[tired, 'tired'], [booked, 'booked']] as const) {
      for (const p of list) {
        const i = m.subPick(this.side, p.slot);
        if (i >= 0) return { idx: p.idx, offId: p.def.id, off: p.def, on: m.bench[this.side][i], reason };
      }
    }
    return null;
  }

  /** The big button: queue the change on offer. */
  accept(): boolean {
    if (this.mode !== 'offer' || !this.offer) return false;
    this.mode = 'queued';
    this.left = QS_QUEUED_SHOW_S;
    this.rev++;
    return true;
  }

  /** Undo a queued change (he isn't offered again for a while). */
  cancel(): void {
    if (this.mode !== 'queued' || !this.offer) return;
    this.snooze(this.offer, 1);
    this.toIdle(QS_GAP_S);
  }

  /** ×: not now. That player is left alone for longer, and nothing else comes up for a while. */
  dismiss(): void {
    if (this.mode === 'queued') {
      this.cancel();
      return;
    }
    if (this.mode !== 'offer' || !this.offer) return;
    this.snooze(this.offer, 2);
    this.toIdle(QS_QUIET_S);
  }

  /** Is this 'sub' event the change a quick sub just made (claimed once)? */
  claims(e: { side: Side; slot: number; on: string }): boolean {
    const c = this.claim;
    if (!c || e.side !== this.side || e.slot !== c.slot || e.on !== c.on) return false;
    this.claim = null;
    return true;
  }

  /**
   * The offer still stands: changes left, the same man still on (not sent off, not already changed through the
   * tactics screen), and someone to bring on (re-picked if the tactics screen used the one offered).
   */
  private valid(o: QuickSubOffer): boolean {
    const m = this.match;
    const p = m.players[o.idx];
    if (this.subsLeft <= 0 || !p || p.side !== this.side || p.sentOff || p.def.id !== o.offId) return false;
    if (m.bench[this.side].some((d) => d.id === o.on.id)) return true;
    const i = m.subPick(this.side, p.slot);
    if (i < 0) return false;
    o.on = m.bench[this.side][i];
    this.rev++;
    return true;
  }

  private execute(o: QuickSubOffer): void {
    const m = this.match;
    const p = m.players[o.idx];
    const bi = m.bench[this.side].findIndex((d) => d.id === o.on.id);
    const off = p.def;
    const on = o.on;
    const slot = p.slot;
    this.claim = { slot, on: on.name };
    if (bi < 0 || !this.sub(slot, bi)) {
      this.claim = null;
      this.toIdle(QS_GAP_S);
      return;
    }
    this.offer = null;
    this.done = { off, on };
    this.mode = 'board';
    this.left = QS_BOARD_S;
    this.rev++;
  }

  private snooze(o: QuickSubOffer, times: number): void {
    const minute = this.match.cfg.halfLength / 45;
    this.snoozed.set(o.offId, this.t + times * Math.max(QS_SNOOZE_S, QS_SNOOZE_MIN * minute));
  }

  private toIdle(gap: number): void {
    this.mode = 'idle';
    this.offer = null;
    this.done = null;
    this.left = 0;
    this.quietUntil = Math.max(this.quietUntil, this.t + gap);
    this.rev++;
  }
}
