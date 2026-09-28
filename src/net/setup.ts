import type { ControlSettings } from '../core/save';
import { contrastAwayKit } from '../game/kitContrast';
import { grassSafeKit, makeTeam, PRESET_CLUBS, resolveKitClash } from '../meta/data';
import type { Match, MatchConfig } from '../sim/match';
import type { Kit, MatchMode, Side, TeamDef } from '../sim/types';

/**
 * What both peers must agree on before an online kick-off, and how each turns it into the very same match. The
 * host decides it (seed, rules, lighting) and sends it in the lobby's 'start' message; the guest adds nothing of
 * its own but its club and its control settings, which reached the host earlier. Anything left out of here that
 * the sim reads would desync the match, so the sim's inputs are all built from this, never from a local save.
 */

/** Wire version of the lobby and lockstep protocol: peers on different versions don't start a match. */
export const NET_VERSION = 1;

/** A player's Settings > Controls that the sim reads (the trainer is his screen only, so it stays local). */
export type NetControls = Omit<ControlSettings, 'trainer'>;

export interface MatchSetup {
  /** The match's number on this link (0, then 1 for the first rematch...): stale packets are told apart by it. */
  epoch: number;
  seed: number;
  /** PRESET_CLUBS indices: the host's club is home (side 0), the guest's away (side 1). */
  home: number;
  away: number;
  mode: MatchMode;
  halfMinutes: number;
  timeOfDay: 'day' | 'sunset' | 'night';
  weather: 'clear' | 'rain' | 'snow';
  /** Level at full time: a penalty shootout (true) or a draw. */
  knockout?: boolean;
  /** Each side's controls (index = side). */
  controls: [NetControls, NetControls];
  /** Starting input delay (ticks). */
  delay: number;
}

/** Half lengths an online match can have (minutes), and the default. */
export const NET_HALVES = [1.5, 2, 3] as const;

/** The sim holds the goal celebration this long (s of match time) before the kick-off, on both peers alike... */
export const NET_GOAL_HOLD_S = 4.2;
/** ... and the half-time break this long, then kicks off the second half itself (no menu to wait on). */
export const NET_HALFTIME_HOLD_S = 4;

export const pickControls = (c: ControlSettings): NetControls => ({
  groundAssist: c.groundAssist, throughAssist: c.throughAssist, autoSwitch: c.autoSwitch, moveAssist: c.moveAssist,
  timedFinish: c.timedFinish, quickPass: c.quickPass,
});

/** Sanitise controls that came over the wire (an old or odd peer never breaks the sim). */
export function cleanControls(c: Partial<NetControls> | undefined): NetControls {
  const lvl = (v: unknown) => (v === 'assisted' || v === 'semi' || v === 'manual' ? v : 'assisted');
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    groundAssist: lvl(c?.groundAssist), throughAssist: lvl(c?.throughAssist), autoSwitch: b(c?.autoSwitch, true),
    moveAssist: b(c?.moveAssist, true), timedFinish: b(c?.timedFinish, true), quickPass: b(c?.quickPass, true),
  };
}

/** A valid club index, or `dflt`. */
export const clubIdx = (i: unknown, dflt: number): number =>
  typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < PRESET_CLUBS.length ? i : dflt;

/** The two squads, built the same on both machines (preset clubs: their surnames come from one shared pool). */
export function netTeams(s: MatchSetup): [TeamDef, TeamDef] {
  const home = makeTeam(PRESET_CLUBS[s.home]);
  const away = makeTeam(PRESET_CLUBS[s.away]);
  return [home, away];
}

/** The kits worn, the same on both screens (the session's own clash handling is skipped for online matches). */
export function netKits(home: TeamDef, away: TeamDef): [Kit, Kit] {
  const h = grassSafeKit(home.kit);
  const a = resolveKitClash(h, grassSafeKit(away.kit));
  return [h, contrastAwayKit(h, a)];
}

/**
 * The MatchConfig for this machine's view of the match. Identical on both peers except `humanSide` (this
 * machine's player), which the sim ignores when `humanSides` is set.
 */
export function netConfig(s: MatchSetup, localSide: Side, teams = netTeams(s)): MatchConfig {
  return {
    home: teams[0],
    away: teams[1],
    halfLength: s.halfMinutes * 60,
    // (Nobody plays the AI: both sides are human. The level only shapes the AI teammates' pace edge, which
    // human sides never get, so any fixed value will do.)
    difficulty: 1.8,
    humanSide: localSide,
    humanSides: [true, true],
    seed: s.seed,
    mode: s.mode,
    knockout: !!s.knockout,
  };
}

/** Each side's controls onto the match (per side, whoever is looking). */
export function applyNetControls(m: Match, s: MatchSetup): void {
  for (const side of [0, 1] as Side[]) {
    const c = cleanControls(s.controls[side]);
    const h = m.ctl[side];
    h.groundAssist = c.groundAssist;
    h.throughAssist = c.throughAssist;
    h.autoSwitch = c.autoSwitch;
    h.moveAssist = c.moveAssist;
    h.timedFinish = c.timedFinish;
    h.quickPass = c.quickPass;
  }
}

/**
 * The stoppages an online match moves on from by itself, on both peers at the same tick (called after every
 * step): the kick-off NET_GOAL_HOLD_S after a goal (no replay: the replay would hold one screen and not the
 * other), the second half NET_HALFTIME_HOLD_S into the break (no half-time menu, no substitutions).
 */
export function netStoppages(m: Match): void {
  if (m.phase === 'goal' && m.phaseT >= NET_GOAL_HOLD_S) m.resumeAfterGoal();
  else if (m.phase === 'halftime' && m.phaseT >= NET_HALFTIME_HOLD_S) m.continueSecondHalf();
}

/** A fresh match seed (the host's). */
export const netSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
