/**
 * The match's sound director: reads the sim (each step's events, and its state once a frame) and tells the crowd
 * and the music in sfx.ts what to do. game/matchSession.ts calls it in four places (begin, events, frame, end);
 * the menu's demo match never begins one, so it is ignored.
 *
 * - The kick-off sting at the first kick-off and the second half's (never after a goal: the goal had its own).
 * - HALF TIME: the crowd stops singing and chats; the half-time track once the screen is coming up; it fades out
 *   into the second half. (The full-time music comes with the result screen: main.ts calls sfx.result.)
 * - A SUBSTITUTION's touchline scene: the half-time loop under it (subScene, from the session), every time.
 * - The crowd: olés on a passing move (from the OLE_FROM'th pass in a row), whistles when the other side keeps the
 *   ball against the player (AI_HOLD_S), whistles and boos at a foul on their man, applause for a tackle won by a
 *   slide or by the player, a groan when the player misses a sitter, nerves late on when it's level or one behind,
 *   whistling for the end in the last seconds when ahead, the final whistle (the winners roar and sing).
 * - A goal of the player's: the goal sting under the roar (the roar itself is sfx.goal, from the session).
 *
 * The crowd of side 0 is the home crowd all round the ground; side 1's is the away fans' section (sfx Stand).
 */
import type { Match } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';
import { sfx, type Sfx } from './sfx';

/** What the director needs from the sound engine (a recording fake in tests). */
export type DirectorSink = Pick<
  Sfx,
  'sting' | 'playTrack' | 'stopMusic' | 'setChantGate' | 'applause' | 'groan' | 'crowdWhistles' | 'oleChain' | 'setNerves' | 'fullTimeCrowd' | 'setClubNames'
>;

/** The half-time track starts this far into the break (the session puts the screen up at 1 s), fades out over HT_FADE_S. */
export const HT_MUSIC_AT = 0.8;
export const HT_FADE_S = 1.6;
/**
 * THE SUBSTITUTION'S MUSIC (the owner: "the music of the substitution was so nice"): the half-time loop under the
 * touchline scene. It used to be heard only by accident, as the loop's tail under changes made at the break; the
 * walk back out (3 s) then came between them and it had faded before the scene. Now every substitution scene has it:
 * from its top in a match, carried straight on from the break for changes made there, out over SUB_FADE_S after.
 */
export const SUB_FADE_S = 1.2;
/** Changes made at the break: the loop waits at most this long (s) for their scene (the walk back out is 3 s). */
export const SUB_WAIT_S = 8;
/** The other side keeping the ball this long (s) gets the player's fans whistling, at most every WHISTLE_GAP_S. */
export const AI_HOLD_S = 10;
const WHISTLE_GAP_S = 16;
/** Olés from this pass of a move on. */
export const OLE_FROM = 4;
/** A shot from this close (m) that goes wide is a sitter missed. */
const SITTER_M = 12;
/** Nerves from this far through the second half (level or one behind). */
const NERVES_FROM = 0.72;
/** Whistling for the end: in the last COUNTDOWN_S real seconds of the second half, ahead, every COUNTDOWN_GAP_S. */
const COUNTDOWN_S = 9;
const COUNTDOWN_GAP_S = 3.2;
/** Rate limits (s): applause for tackles and beaten men, whistles at fouls. */
const TACKLE_GAP_S = 4;
const BEAT_GAP_S = 6;
const FOUL_GAP_S = 3;

export interface DirectorOptions {
  /** A Football Moment or a basics drill: no kick-off sting, no half-time or full-time music or crowd. */
  scenario?: boolean;
}

export class MatchAudio {
  private m: Match | null = null;
  private scenario = false;
  /** The player's side (-1: nobody's, an AI match) and the side whose fans are "ours" (the home crowd then). */
  private hs = -1;
  private us: Side = 0;
  private kickoffs = 0;
  private afterHalf = false;
  private htOn = false;
  /** A substitution scene is on; seconds the half-time loop will still wait for one (changes made at the break). */
  private subOn = false;
  private subWait = 0;
  private ftDone = false;
  /** The passing move: whose, how many passes completed, a pass in the air. */
  private chainSide = -1;
  private chain = 0;
  private passOut = false;
  /** Seconds the other side has kept the ball; this match's clock (s, from begin); the rate limits' last times. */
  private aiHold = 0;
  private t = 0;
  private whistleAt = -99;
  private tackleAt = -99;
  private beatAt = -99;
  private foulAt = -99;
  private countdownAt = -99;

  constructor(private readonly out: DirectorSink = sfx) {}

  /** A match starts (the session's constructor; never the menu's demo). */
  begin(m: Match, o: DirectorOptions = {}): void {
    this.m = m;
    this.scenario = !!o.scenario;
    this.hs = m.cfg.humanSide;
    this.us = (this.hs === 1 ? 1 : 0) as Side;
    this.kickoffs = 0;
    this.afterHalf = false;
    this.htOn = false;
    this.subOn = false;
    this.subWait = 0;
    this.ftDone = false;
    this.resetChain();
    this.aiHold = 0;
    this.t = 0;
    this.whistleAt = this.tackleAt = this.beatAt = this.foulAt = this.countdownAt = -99;
    this.out.setClubNames(m.teams[0]?.name ?? '', m.teams[1]?.name ?? '');
    this.out.setChantGate(true);
    this.out.setNerves(0);
  }

  /** A sim step's events (after the session has handled them). Another match's (the demo's) are ignored. */
  events(evs: readonly MatchEvent[], m: Match): void {
    if (m !== this.m) return;
    for (const e of evs) this.event(e, m);
  }

  private event(e: MatchEvent, m: Match): void {
    switch (e.type) {
      case 'kickoffReady':
        // The first kick-off and the second half's (a kick-off after a goal follows the goal's own music).
        if (!this.scenario && (this.kickoffs === 0 || this.afterHalf)) this.out.sting('kickoff');
        this.kickoffs++;
        this.afterHalf = false;
        this.resetChain();
        break;
      case 'kick': {
        const p = m.players[e.player ?? m.ball.lastTouch];
        if (!p) break;
        if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') {
          if (p.side !== this.chainSide) {
            this.chainSide = p.side;
            this.chain = 0;
          }
          this.passOut = true;
        } else this.resetChain();
        break;
      }
      case 'control': {
        const p = m.players[e.player];
        if (!p) break;
        if (p.side !== this.chainSide) this.resetChain();
        else if (this.passOut) {
          // A pass found its man: olé from the fourth.
          this.passOut = false;
          this.chain++;
          if (this.chain >= OLE_FROM && m.phase === 'play') this.out.oleChain(this.chain, p.side);
        }
        break;
      }
      case 'tackle': {
        if (!e.won) break;
        this.resetChain();
        const p = m.players[e.by];
        if (p && (e.slide || m.human[p.side]) && this.t - this.tackleAt > TACKLE_GAP_S) {
          this.tackleAt = this.t;
          this.out.applause(e.slide ? 0.75 : 0.55, p.side);
        }
        break;
      }
      case 'beat': {
        const p = m.players[e.by];
        if (p && m.human[p.side] && this.t - this.beatAt > BEAT_GAP_S) {
          this.beatAt = this.t;
          this.out.applause(0.4, p.side);
        }
        break;
      }
      case 'foul': {
        this.resetChain();
        const on = m.players[e.on];
        if (on && this.t - this.foulAt > FOUL_GAP_S) {
          this.foulAt = this.t;
          this.out.crowdWhistles(e.penalty ? 1 : 0.8, on.side, true);
        }
        break;
      }
      case 'card':
        if (e.color === 'red') {
          const p = m.players[e.player];
          // His side's fans boo the referee (whatever the cool-down).
          if (p) {
            this.foulAt = this.t;
            this.out.crowdWhistles(1, p.side, true);
          }
        }
        break;
      case 'restart':
        // Out for a goal kick straight off a close-range shot of ours: a sitter missed.
        if (e.kind === 'goalkick' && m.shotClock < 3 && m.shotDist > 0 && m.shotDist <= SITTER_M && m.shotSide === this.us && (m.shotByHuman || this.hs < 0)) {
          this.out.groan(1, m.shotSide);
        }
        this.resetChain();
        break;
      case 'goal':
        if (e.side === this.hs) this.out.sting('goal');
        this.resetChain();
        break;
      case 'halftime':
        this.out.setChantGate(false);
        break;
      case 'fulltime':
        this.fullTime(m);
        break;
      case 'shootoutKick':
        // A penalty missed: its taker's fans groan (a goal's cheer is the session's).
        if (!e.scored) this.out.groan(0.85, e.side);
        break;
      default:
        break;
    }
  }

  private fullTime(m: Match): void {
    if (this.ftDone) return;
    this.ftDone = true;
    this.out.setNerves(0);
    this.out.setChantGate(false);
    if (this.scenario) return;
    const so = m.shootout;
    const w = so && so.winner >= 0 ? so.winner : m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
    this.out.fullTimeCrowd(w as -1 | 0 | 1);
  }

  /**
   * A substitution's touchline scene starts (true) or ends (false; the session, startSubCut / endSubCut): its music is
   * the half-time loop. Already playing (changes made at the break) it simply carries on; it fades when the scene ends.
   */
  subScene(on: boolean): void {
    if (!this.m || this.subOn === on) return;
    this.subOn = on;
    this.subWait = 0;
    if (on) this.out.playTrack('halftime');
    else if (!this.htOn) this.out.stopMusic(SUB_FADE_S);
  }

  /**
   * Once a frame (dt 0 while paused), after the session's own crowd calls. `subsWaiting`: changes are queued for
   * their touchline scene (the session's subQueue), so the half-time loop is kept for it.
   */
  frame(dt: number, m: Match, subsWaiting = false): void {
    if (m !== this.m) return;
    this.t += dt;
    const ph = m.phase;
    // HALF TIME: the crowd chats (a little murmur), the track once the screen is coming up; out with it after.
    if (ph === 'halftime' && !this.scenario) {
      if (!this.htOn && m.phaseT >= HT_MUSIC_AT) {
        this.htOn = true;
        this.afterHalf = true;
        this.out.playTrack('halftime');
        this.out.setNerves(0.3);
      }
      return;
    }
    if (this.htOn) {
      this.htOn = false;
      // Changes made at the break are shown at the kick-off: the loop carries on to their scene (and through it).
      if (this.subOn) this.subWait = 0;
      else if (subsWaiting) this.subWait = SUB_WAIT_S;
      else this.out.stopMusic(HT_FADE_S);
      this.out.setNerves(0);
      this.out.setChantGate(true);
    }
    if (this.subWait > 0 && !this.subOn) {
      // (Their scene never came, or the queue was dropped: the loop goes as it always did.)
      this.subWait = subsWaiting ? this.subWait - dt : 0;
      if (this.subWait <= 0) {
        this.subWait = 0;
        this.out.stopMusic(HT_FADE_S);
      }
    }
    // (A kick-off the session drained some other way: never a sting later in open play.)
    if (this.kickoffs === 0 && ph === 'play') this.kickoffs = 1;
    if (ph === 'fulltime' || ph === 'halftime') return;
    if (ph === 'shootout') {
      this.out.setNerves(0.85);
      return;
    }
    // The other side keeping the ball from the player: his fans whistle at it.
    if (ph === 'play' && this.hs >= 0) {
      const own = m.ball.owner;
      const side = own >= 0 ? m.players[own]?.side ?? -1 : -1;
      if (side === this.hs) this.aiHold = 0;
      else if (side >= 0) this.aiHold += dt;
      if (this.aiHold > AI_HOLD_S && this.t - this.whistleAt > WHISTLE_GAP_S) {
        this.whistleAt = this.t;
        this.aiHold = AI_HOLD_S * 0.5;
        this.out.crowdWhistles(0.6, this.us, false);
      }
    }
    // Late on: nerves when it's level or one behind; whistling for the end when ahead.
    const hl = m.cfg.halfLength;
    const late = m.half === 2 && hl > 0 ? m.clock / hl : 0;
    const diff = m.score[this.us] - m.score[this.us === 0 ? 1 : 0];
    let nerves = 0;
    if (late >= NERVES_FROM && (diff === 0 || diff === -1)) nerves = Math.min(1, 0.35 + ((late - NERVES_FROM) / (1 - NERVES_FROM)) * 0.65);
    this.out.setNerves(nerves);
    if (m.half === 2 && diff >= 1 && hl - m.clock <= COUNTDOWN_S && ph === 'play' && this.t - this.countdownAt > COUNTDOWN_GAP_S) {
      this.countdownAt = this.t;
      this.out.crowdWhistles(0.85, this.us, false);
    }
  }

  /** The match is over and gone (the session's dispose): a half-time track still up goes; the crowd's state resets. */
  end(m: Match): void {
    if (m !== this.m) return;
    if (this.htOn || this.subOn || this.subWait > 0) this.out.stopMusic(0.5);
    this.htOn = false;
    this.subOn = false;
    this.subWait = 0;
    this.out.setNerves(0);
    this.out.setChantGate(true);
    this.m = null;
  }

  /** The state, for the dev panel and tests. */
  get state(): { active: boolean; kickoffs: number; halftimeMusic: boolean; subMusic: boolean; chain: number; aiHold: number } {
    return {
      active: this.m !== null, kickoffs: this.kickoffs, halftimeMusic: this.htOn, subMusic: this.subOn || this.subWait > 0, chain: this.chain,
      aiHold: +this.aiHold.toFixed(2),
    };
  }

  private resetChain(): void {
    this.chainSide = -1;
    this.chain = 0;
    this.passOut = false;
  }
}

/** The one the match session uses. */
export const matchAudio = new MatchAudio();
