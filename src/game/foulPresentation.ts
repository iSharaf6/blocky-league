import type { Phase, Restart } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';

/**
 * From the contact: the fall, the whistle and the banner naming the decision read in the wide shot for this long
 * before any card close-up takes the picture.
 */
export const FOUL_BEAT_S = 1.0;
/**
 * The same beat where nothing holds the match for the decision (online, a Football Moment, the menu's demo, or a
 * foul still being played on for advantage): no longer than the sim's own dead-ball beat, so the card is up before
 * the free kick can be taken.
 */
export const FOUL_BEAT_LIVE_S = 0.6;

export interface BookingShot {
  player: number;
  playerId: string;
  name: string;
  color: 'yellow' | 'red';
  second: boolean;
  x: number;
  z: number;
  close: boolean;
  restart: Restart | null;
}

type Verdict = { event: Extract<MatchEvent, { type: 'restart' }>; restart: Restart | null };

/** Local presentation only; rendered time advances this beat even while an incident recap holds its restart. */
export class FoulPresentation {
  private left = 0;
  private side: Side | null = null;
  private booking: BookingShot | null = null;
  private verdict: Verdict | null = null;

  get waiting(): boolean { return this.left > 1e-4; }

  contact(side: Side, beat = FOUL_BEAT_S): void {
    this.clear();
    this.side = side;
    this.left = beat;
  }

  /** Called on unpaused rendered frames, before new sim events can start a beat. */
  tick(dt: number): void { this.left = Math.max(0, this.left - dt); }

  queueBooking(shot: BookingShot): void { this.booking = shot; }

  queueRestart(event: Verdict['event'], restart: Restart | null): boolean {
    if (!this.waiting || event.side !== this.side || (event.kind !== 'freekick' && event.kind !== 'penalty')) return false;
    this.verdict = { event, restart };
    return true;
  }

  /** Keep the camera on contact only while its own foul stoppage is still current. */
  impact(phase: Phase, restart: Restart | null): boolean {
    const bound = this.verdict?.restart ?? this.booking?.restart;
    return this.waiting && !!bound && bound === restart && (phase === 'out' || phase === 'restart');
  }

  take(phase: Phase, restart: Restart | null): { booking: BookingShot | null; verdict: Verdict['event'] | null } | null {
    const stopped = phase === 'out' || phase === 'restart';
    if (this.booking && (!stopped || this.booking.restart !== restart)) this.booking = null;
    if (this.verdict && (!stopped || this.verdict.restart !== restart)) this.verdict = null;
    if (this.waiting || (!this.booking && !this.verdict)) return null;
    const ready = { booking: this.booking, verdict: this.verdict?.event ?? null };
    this.booking = null;
    this.verdict = null;
    return ready;
  }

  clear(): void {
    this.left = 0;
    this.side = null;
    this.booking = null;
    this.verdict = null;
  }
}
