/**
 * What the main menu (the hub, ui/menus.ts main()) shows about the player's own club and season, worked out from
 * the save: pure functions (no DOM, nothing written back) so tests/mainMenu.test.ts can pin them down.
 * - captainCard: the player on the left, in YOUR club's kit (MY CLUB once founded, else the Quick Match club).
 * - roadCard: the ROAD TO GLORY hero card (create your club, the next fixture, or the season's end).
 * - seasonCard: the SEASON tile (tier of 30, rewards waiting, the Club Pass).
 */
import type { SaveData } from '../core/save';
import { BOTTOM_DIVISION, DIVISION_NAMES, MATCHDAYS, clubRating, migrateCareer, nextMatch, type CareerState, type ClubState } from '../meta/career';
import { clubRating as presetRating } from '../meta/cup';
import { PRESET_CLUBS, makeTeam } from '../meta/data';
import { boardView } from '../meta/board';
import { COMP_NAMES } from '../meta/comps';
import { nextGoal, type NextGoal, type UnlockHint } from '../meta/goal';
import { marketUnread, windowInfo } from '../meta/market';
import { badgePending, nextBadgeGoal } from '../meta/mastery';
import { passActive } from '../meta/pass';
import { SEASON_TIERS, seasonDaysLeft, seasonOf, seasonProgress, seasonTheme } from '../meta/season';
import { overall, type Kit, type PlayerDef } from '../sim/types';

/** A club as the hub draws it: crest (name, short, kit) and rating. */
export interface ClubBadge {
  name: string;
  short: string;
  kit: Kit;
  ovr: number;
}

/** The player on the left of the hub. `own`: it is MY CLUB (else a Quick Match club until one is founded). */
export interface CaptainCard {
  def: PlayerDef;
  kit: Kit;
  club: string;
  short: string;
  ovr: number;
  /** MY CLUB's division ("SUNDAY LEAGUE"); absent for a Quick Match club. */
  division?: string;
  own: boolean;
}

/** The ROAD TO GLORY hero card. */
export type RoadCard =
  | { kind: 'create' }
  /** A club with no season yet: the first one starts on the next visit. */
  | { kind: 'start'; club: ClubBadge; division: string }
  | {
    kind: 'next'; club: ClubBadge; division: string; season: number; md: number; of: number; home: boolean; rival: ClubBadge;
    /** What the match is when the career names it ("MATCHDAY 3", "BLOCKY CUP QUARTER FINAL"), and a cup tie. */
    label?: string; cup?: boolean;
    /** Neither side at home (the cup final). */
    neutral?: boolean;
    /** The competition's name when it isn't the league ("BLOCKY CUP", "CONTINENTAL CUP"). */
    comp?: string;
    /** THIS SEASON: the board's objectives as chips (meta/board.ts). */
    board?: BoardPip[];
    /** Things waiting for you inside: event cards to answer and scout reports not read (meta/events.ts, meta/staff.ts). */
    waiting?: number;
  }
  /** The season is over (the summary waits in ROAD TO GLORY). */
  | { kind: 'over'; club: ClubBadge; division: string; season: number };

/** One board objective on the hero card: the short goal, its live progress, and whether it's met. */
export interface BoardPip {
  short: string;
  progress: string;
  state: 'open' | 'done' | 'failed';
}

/** The SEASON tile. */
export interface SeasonCard {
  /** Tier reached (0..tiers), of `tiers`, and the way into the next one (0..1; 1 when every tier is reached). */
  tier: number;
  tiers: number;
  frac: number;
  /** Badge tiers, season tiers and pass tiers waiting to be claimed. */
  pending: number;
  /** The selected Journey has its permanent Club Pass. */
  pass: boolean;
  /** Offer the Club Pass on the tile (a build that sells it, and it isn't on). */
  offer: boolean;
  /** The selected Journey and its colour. `days` is a legacy zero sentinel; never show a countdown. */
  name: string;
  color: string;
  days: number;
  /** The nearest badge tier ("2 MORE GOALS FOR FINISHER II"), when nothing is waiting. */
  goal?: string;
}

/** The career blob, read without side effects on the save (a damaged one reads as none). */
export function careerOf(save: Pick<SaveData, 'career'>): CareerState | null {
  if (!save.career) return null;
  try {
    return migrateCareer(save.career, 1);
  } catch {
    return null;
  }
}

function badge(club: ClubState): ClubBadge {
  return { name: club.name.toUpperCase(), short: club.short.toUpperCase(), kit: club.kit, ovr: clubRating(club) };
}

/** The club's face: its best outfield starter (a keeper only if the XI has nobody else). */
export function starOf(club: ClubState): PlayerDef | undefined {
  const xi = [...club.squad.slice(0, 11)].sort((a, b) => overall(b) - overall(a));
  return xi.find((p) => p.role !== 'GK') ?? xi[0] ?? club.squad[0];
}

/** The player on the hub's left: MY CLUB's star in its kit once founded, else the Quick Match club's number 10. */
export function captainCard(save: Pick<SaveData, 'career' | 'clubIdx'>, career: CareerState | null = careerOf(save)): CaptainCard | undefined {
  const club = career?.club;
  const star = club ? starOf(club) : undefined;
  if (club && star) {
    const div = career?.season?.division ?? BOTTOM_DIVISION;
    return { def: star, kit: club.kit, club: club.name.toUpperCase(), short: club.short.toUpperCase(), ovr: clubRating(club), division: DIVISION_NAMES[div] ?? '', own: true };
  }
  const idx = PRESET_CLUBS[save.clubIdx] ? save.clubIdx : 0;
  const seed = PRESET_CLUBS[idx];
  if (!seed) return undefined;
  return { def: makeTeam(seed).players[9], kit: seed.kit, club: seed.name.toUpperCase(), short: seed.short.toUpperCase(), ovr: presetRating(idx), own: false };
}

/** The ROAD TO GLORY card: CREATE YOUR CLUB, the next fixture, or the season's end. */
export function roadCard(career: CareerState | null): RoadCard {
  const club = career?.club;
  if (!career || !club) return { kind: 'create' };
  const me = badge(club);
  const season = career.season;
  if (!season) return { kind: 'start', club: me, division: DIVISION_NAMES[BOTTOM_DIVISION] };
  const division = DIVISION_NAMES[season.division] ?? '';
  if (career.summary) return { kind: 'over', club: me, division, season: season.number };
  let nm: ReturnType<typeof nextMatch> = null;
  try {
    nm = nextMatch(career);
  } catch {
    nm = null;
  }
  if (!nm) return { kind: 'over', club: me, division, season: season.number };
  const r = nm.rival;
  let board: BoardPip[] = [];
  try {
    board = boardView(career).map((v) => ({ short: v.short, progress: v.progress, state: v.obj.state }));
  } catch {
    board = [];
  }
  // A BLOCKY CUP tie inside the season names itself ("BLOCKY CUP QUARTER FINAL"), a league match its matchday.
  const card: RoadCard = {
    kind: 'next', club: me, division, season: season.number, md: nm.md + 1, of: MATCHDAYS, home: nm.userHome,
    rival: { name: r.name.toUpperCase(), short: r.short.toUpperCase(), kit: r.kit, ovr: r.rating },
    label: nm.label ? nm.label.toUpperCase() : undefined,
    cup: nm.competition !== 'league',
    neutral: !!nm.neutral,
  };
  if (nm.competition === 'continental' || nm.competition === 'world') card.comp = COMP_NAMES[nm.competition];
  if (board.length) card.board = board;
  // What is waiting inside: a card to answer, a scout's report (the count on the hero card).
  const waiting = (career.events?.queue.length ?? 0) + (career.staff?.reports.filter((x) => !x.seen && x.finds.length > 0).length ?? 0);
  if (waiting > 0) card.waiting = waiting;
  return card;
}

/** NEXT GOAL on the hub (meta/goal.ts): the one thing to go for now; null without a club (or on a damaged save). */
export function goalOf(career: CareerState | null, coins: number, unlock?: UnlockHint | null): NextGoal | null {
  try {
    return nextGoal(career, coins, unlock);
  } catch {
    return null;
  }
}

/** Unread news about your own transfers (offers answered, players sold): the TRANSFERS tile's count. */
export function transfersNews(career: CareerState | null): number {
  if (!career?.club) return 0;
  try {
    return marketUnread(career);
  } catch {
    return 0;
  }
}

/** The transfer calendar advances with league results, never device time or a visit to the store. */
export function transfersTiming(career: CareerState | null): { window: string; updated: string; next: string; note: string } | null {
  const season = career?.season;
  if (!season || !career?.club) return null;
  const week = season.matchday;
  const over = !!career.summary || week >= MATCHDAYS;
  return {
    window: over ? 'WINDOW CLOSED UNTIL NEXT SEASON' : windowInfo(week).label.replace(/\bMATCHES\b/g, 'LEAGUE MATCHDAYS').replace(/\bMATCH\b/g, 'LEAGUE MATCHDAY'),
    updated: week > 0 ? `UPDATED AFTER MATCHDAY ${Math.min(week, MATCHDAYS)}` : 'SEASON OPENING MARKET',
    next: over || week >= MATCHDAYS - 1 ? 'NEXT REFRESH AT THE START OF NEXT SEASON' : `NEXT REFRESH AFTER LEAGUE MATCHDAY ${week + 1}`,
    note: 'League matchdays refresh players and answer offers. Cup and quick matches keep the same market.',
  };
}

/**
 * The JOURNEYS tile: progress through the selected permanent 30-tier track and claimable rewards.
 * Reading never changes its identity or resets progress.
 */
export function seasonCard(save: Pick<SaveData, 'season' | 'mastery'>, sells: boolean, now: Date = new Date()): SeasonCard {
  const pass = passActive(save, now);
  const s = seasonOf(save, now);
  const p = seasonProgress(s);
  const theme = seasonTheme(s.id);
  const pending = badgePending(save);
  let goal: string | undefined;
  try {
    goal = !pending && save.mastery ? nextBadgeGoal(save.mastery)?.text : undefined;
  } catch {
    goal = undefined;
  }
  return {
    tier: p.tier, tiers: SEASON_TIERS, frac: p.need ? Math.max(0, Math.min(1, p.into / p.need)) : 1,
    pending, pass, offer: sells && !pass, name: theme.name, color: theme.color, days: seasonDaysLeft(now), goal,
  };
}
