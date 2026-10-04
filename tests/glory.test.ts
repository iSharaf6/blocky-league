/**
 * The long game of ROAD TO GLORY (the owner: "Make the road to glory long and worth it, so it is a forever game"):
 * the home and away season and how an old save moves into it, the event cards and their rules (deterministic, never
 * unwinnable, never punishing absence, kid-safe), RPG player development (potential, XP, focus, mentors, traits),
 * the staff and their scouts, morale and chemistry, SIM THIS MATCH, the gem shortcuts, the come-back hooks, and a
 * twenty season soak that stays stable and solvent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rng, hashString } from '../src/core/rng';
import {
  BOTTOM_DIVISION, HALF_SEASON, MATCHDAYS, SQUAD_MAX, SQUAD_MIN, STAT_CAP, TOP_DIVISION, YOU, afterMatch, buildPart, compsDue, createClub, cupDue,
  groundBonus, leagueTable, matchReward, migrateCareer, newSeason, nextMatch, resolveCompTie, resolveCupTie, resolveMatchday, startAsLegend,
  startNextSeason, trainPlayer, userFixture, type CareerState,
} from '../src/meta/career';
import { payBoard } from '../src/meta/board';
import { KIT_COLORS } from '../src/meta/data';
import {
  EVENT_ICON, QUEUE_MAX, TIMELINE_MAX, choiceOpen, injuryCard, isBigMatch, pendingEvent, resolveEvent, rollEvents, rollPress, seasonHeadlines,
  tickEvents, youthCard, type EventCard,
} from '../src/meta/events';
import { GEM_PRICES, SCOUT_NETWORKS, addGems, gems, normalizeGems, spendGems } from '../src/meta/gems';
import { nextGoal } from '../src/meta/goal';
import {
  FOCUS_INFO, MENTOR_TRAIT_AFTER, XP_LEVEL, ageRate, autoMentors, ceilOf, focusOf, gainXp, growthChart, hasRoom, mentorOf, setFocus,
  setGroupFocus, setMentor, tickMentors, traitLift, traitsOf, xpRate, type GrowPlayer,
} from '../src/meta/growth';
import { academyIntake, bestProspectIndex, chemistry, matchLift, promoteProspect } from '../src/meta/life';
import { ageSquad, playerAge, playerPotential } from '../src/meta/market';
import {
  MORALE_START, TALK_COOLDOWN, WIN_LIFT, expectsToPlay, moraleOf, partnerships, rotate, rotateSuggestion, talkWait, teamMood, teamTalk, weekMorale,
} from '../src/meta/morale';
import { finishBuildCost, finishBuildNow, healNow, skipBuildMatchday, syncNetwork } from '../src/meta/premium';
import { autoLineupFit } from '../src/meta/squad';
import {
  REGIONS, STAFF, STAFF_ROLES, canSignFind, commercialIncome, hireStaff, payStaff, releaseStaff, reportOf, setScout, signFind, staffLevel,
  staffNeeds, staffWages, tickScouts, unseenReports, type StaffRole,
} from '../src/meta/staff';
import { ICONS } from '../src/ui/pixelIcons';
import {
  INJURY_MAX, SIM_PAY, UNLOCKS, checkUnlocks, comingUp, isOpen, openAll, simBlock, simMatch, weekTick,
} from '../src/meta/week';
import { overall, type Kit, type PlayerDef, type PlayerStats } from '../src/sim/types';

// Whole seasons are simulated here (a season is 14 league matchdays and three cups): a longer limit than a unit test's.
vi.setConfig({ testTimeout: 60_000 });

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };
const g = (p: PlayerDef) => p as GrowPlayer;

function career(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, division, 1);
  return st;
}

/** Whatever is next (a cup tie, a comp fixture or the league), with this score. */
function playNext(st: CareerState, wallet: { coins: number }, my: number, their: number): void {
  if (cupDue(st) >= 0) {
    resolveCupTie(st, my, their, my >= their);
    return;
  }
  if (compsDue(st)) {
    resolveCompTie(st, my, their, my >= their);
    return;
  }
  const s = st.season!;
  const f = userFixture(s, s.matchday)!;
  const home = f.home === YOU;
  expect(resolveMatchday(st, wallet, s.matchday, home ? my : their, home ? their : my)).toBe(true);
}

/** Answer every card waiting with the first answer the wallet covers (never gems). */
function answerAll(st: CareerState, wallet: { coins: number }, pick = 0): EventCard[] {
  const seen: EventCard[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const c = pendingEvent(st);
    if (!c) break;
    seen.push(c);
    const open = c.choices.map((ch, i) => ({ ch, i })).filter((x) => !x.ch.gems && choiceOpen(x.ch, wallet.coins));
    expect(open.length, c.kind).toBeGreaterThan(0);
    expect(resolveEvent(st, wallet, c.id, open[pick % open.length].i).ok).toBe(true);
  }
  return seen;
}

/** Open every feature (as a manager a season in), so a test can go straight to what it tests. */
function seasoned(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = career(seed, division);
  openAll(st);
  st.events.played = 20;
  return st;
}

describe('the home and away season, and old saves', () => {
  it('a save from the seven matchday season keeps every result and gains the return fixtures', () => {
    const st = career(3);
    const wallet = { coins: 0 };
    for (let i = 0; i < 3; i++) playNext(st, wallet, 2, 1);
    expect(st.season!.matchday).toBe(3);
    // The save as the old game wrote it: one round robin, no staff, no events, players without the long game's fields.
    const raw = JSON.parse(JSON.stringify(st));
    raw.season.fixtures = raw.season.fixtures.filter((f: { md: number }) => f.md < HALF_SEASON);
    expect(raw.season.fixtures).toHaveLength(28);
    delete raw.staff;
    delete raw.events;
    for (const p of raw.club.squad) for (const k of ['ceil', 'xp', 'mor', 'sat', 'run', 'hist', 'inj', 'focus', 'traits']) delete p[k];
    const before = leagueTable(st).map((r) => ({ id: r.id, PTS: r.PTS, GF: r.GF, P: r.P }));
    const back = migrateCareer(raw, 1);
    expect(back.season!.fixtures).toHaveLength(56);
    expect(back.season!.matchday).toBe(3);
    // Nothing played was touched, and the table reads the same.
    expect(back.season!.fixtures.slice(0, 28)).toEqual(raw.season.fixtures);
    expect(leagueTable(back).map((r) => ({ id: r.id, PTS: r.PTS, GF: r.GF, P: r.P }))).toEqual(before);
    // The second half is the first, at the other ground.
    for (const f of back.season!.fixtures.slice(0, 28)) {
      expect(back.season!.fixtures.some((x) => x.md === f.md + HALF_SEASON && x.home === f.away && x.away === f.home && x.hg === null)).toBe(true);
    }
    expect(back.club!.squad.map((p) => p.name)).toEqual(st.club!.squad.map((p) => p.name));
    expect(back.season!.cup).toEqual(st.season!.cup);
    // A manager already under way: the long game is open at once, with no flood of cards.
    for (const u of UNLOCKS) expect(isOpen(back, u.id)).toBe(true);
    expect(back.story.moments).toEqual(st.story.moments);
    expect(back.events.queue).toEqual([]);
    // And it plays on to matchday 14.
    for (let guard = 0; guard < 40 && !back.summary; guard++) {
      playNext(back, wallet, 1, 0);
      answerAll(back, wallet);
    }
    expect(back.season!.matchday).toBe(MATCHDAYS);
    expect(leagueTable(back).every((r) => r.P === MATCHDAYS)).toBe(true);
  });

  it('an old season that was already over stays over, with its summary and prize as they were', () => {
    const st = career(5);
    const wallet = { coins: 0 };
    for (let guard = 0; guard < 40 && !st.summary; guard++) playNext(st, wallet, 3, 0);
    const raw = JSON.parse(JSON.stringify(st));
    // (As the old game left it: seven matchdays played, the summary waiting.)
    raw.season.fixtures = raw.season.fixtures.filter((f: { md: number }) => f.md < HALF_SEASON);
    raw.season.matchday = HALF_SEASON;
    delete raw.staff;
    delete raw.events;
    const back = migrateCareer(raw, 1);
    expect(back.summary).toEqual(st.summary);
    expect(nextMatch(back)).toBeNull();
    expect(back.history).toEqual(st.history);
    const s2 = startNextSeason(back)!;
    expect(s2.fixtures).toHaveLength(56);
    expect(s2.matchday).toBe(0);
  });

  it('a fresh save has nothing of the long game open yet, and a new field never breaks an old reader', () => {
    const st = career(9);
    expect(st.events.open).toEqual([]);
    expect(st.staff.hired).toEqual({});
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
  });
});

describe('pace: something new every match or two', () => {
  it('opens a piece of the long game after each of the first matches, each with its moment', () => {
    const st = career(11);
    const wallet = { coins: 0 };
    const opened: number[] = [];
    for (let i = 0; i < 9; i++) {
      const before = st.events.open.length;
      playNext(st, wallet, 1, 0);
      answerAll(st, wallet);
      if (st.events.open.length > before) opened.push(st.events.played);
    }
    expect(st.events.open).toEqual(UNLOCKS.map((u) => u.id));
    // Never more than two matches between one new thing and the next.
    const at = [0, ...UNLOCKS.map((u) => u.after)];
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeLessThanOrEqual(2);
    expect(opened.length).toBeGreaterThanOrEqual(5);
    for (const u of UNLOCKS) expect(ICONS[u.icon], u.icon).toBeDefined();
  });

  it('there is always something coming up, and NEXT GOAL says what is waiting', () => {
    const st = career(12);
    const wallet = { coins: 0 };
    for (let i = 0; i < 20 && !st.summary; i++) {
      const soon = comingUp(st);
      expect(soon.length, `matchday ${st.season!.matchday}`).toBeGreaterThan(0);
      for (const x of soon) {
        expect(x.text).not.toMatch(/[·•●—–]/);
        expect(x.in).toBeGreaterThanOrEqual(0);
        expect(ICONS[x.icon], x.icon).toBeDefined();
      }
      // Sorted, the nearest first.
      expect(soon.map((x) => x.in)).toEqual([...soon.map((x) => x.in)].sort((a, b) => a - b));
      const card = pendingEvent(st);
      if (card) expect(nextGoal(st, wallet.coins)?.text).toContain(card.title);
      playNext(st, wallet, 2, 1);
    }
  });

  it('a build, a scout report and an injured player on his way back are all on the list', () => {
    const st = seasoned(13);
    const wallet = { coins: 20000 };
    buildPart(st, wallet, 'main');
    hireStaff(st, wallet, 'scout1', 'south');
    g(st.club!.squad[14]).inj = 2;
    st.board.objectives = [];
    const kinds = comingUp(st).map((x) => x.kind);
    expect(kinds).toContain('build');
    expect(kinds).toContain('scout');
    expect(kinds).toContain('injury');
    expect(nextGoal(st, 0)?.text).toMatch(/SCOUT REPORT|IS BACK|OPENS/);
  });
});

describe('event cards', () => {
  it('are deterministic: the same career played the same way sees the same cards and the same story', () => {
    const run = () => {
      const st = career(21);
      const wallet = { coins: 500 };
      const cards: string[] = [];
      for (let i = 0; i < 40 && !st.summary; i++) {
        playNext(st, wallet, (i * 7) % 4, (i * 3) % 3);
        for (const c of answerAll(st, wallet, i)) cards.push(`${c.id}:${c.kind}:${c.title}:${c.text}`);
      }
      return { cards, json: JSON.stringify(st), coins: wallet.coins };
    };
    const a = run();
    const b = run();
    expect(a.cards.length).toBeGreaterThan(5);
    expect(b.cards).toEqual(a.cards);
    expect(b.json).toBe(a.json);
    expect(b.coins).toBe(a.coins);
  });

  it('never punish absence: nothing reads a clock, and a card waits as long as you like', () => {
    const run = (jump: boolean) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
      const st = career(22);
      const wallet = { coins: 300 };
      for (let i = 0; i < 30 && !st.summary; i++) {
        // A year away between every match changes nothing at all.
        if (jump) vi.setSystemTime(new Date(Date.UTC(2026 + i, 5, 1)));
        playNext(st, wallet, 2, 1);
        answerAll(st, wallet);
      }
      vi.useRealTimers();
      return JSON.stringify(st) + wallet.coins;
    };
    expect(run(true)).toBe(run(false));
    // A card nobody answers is still there, unchanged, however many matches go by.
    const st = career(23);
    const wallet = { coins: 0 };
    for (let i = 0; i < 6 && !pendingEvent(st); i++) playNext(st, wallet, 1, 0);
    const first = JSON.stringify(pendingEvent(st));
    expect(first).not.toBe('null');
    for (let i = 0; i < 8; i++) playNext(st, wallet, 1, 0);
    expect(JSON.stringify(pendingEvent(st))).toBe(first);
    expect(st.events.queue.length).toBeLessThanOrEqual(QUEUE_MAX);
  });

  it('the rule files never read a clock', () => {
    const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): { readFileSync(p: string, e: string): string }; cwd(): string } }).process;
    const fs = proc.getBuiltinModule('node:fs');
    for (const f of ['events', 'week', 'staff', 'growth', 'morale', 'premium']) {
      const src = fs.readFileSync(`${proc.cwd()}/src/meta/${f}.ts`, 'utf8');
      expect(src, f).not.toMatch(/\bDate\b|performance\.now|setTimeout|setInterval/);
    }
  });

  it('are never unwinnable: every card has a free answer, no answer takes coins you lack, and the squad stays whole', () => {
    const kinds = new Set<string>();
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const st = seasoned(seed, seed % 2 ? BOTTOM_DIVISION : 3);
      const wallet = { coins: 0 };
      // A club in trouble: nervous board, unhappy bench, contracts running out, hot heads.
      st.board.confidence = 20;
      st.club!.squad.forEach((p, i) => {
        if (i >= 11) Object.assign(g(p), { mor: 30, sat: 6 });
        if (i % 3 === 0) g(p).contract = 1;
        if (i % 4 === 0) g(p).traits = ['hothead'];
      });
      for (let i = 0; i < 60 && !st.summary; i++) {
        playNext(st, wallet, i % 5 === 0 ? 2 : 0, i % 5 === 0 ? 0 : 1);
        for (const c of st.events.queue) {
          kinds.add(c.kind);
          expect(c.choices.length, c.kind).toBeGreaterThanOrEqual(2);
          expect(c.choices.length, c.kind).toBeLessThanOrEqual(3);
          expect(c.choices.some((ch) => !ch.coins && !ch.gems), c.kind).toBe(true);
          expect(ICONS[c.icon], c.icon).toBeDefined();
          // Kid-safe copy in the game's taste: no forbidden separators, short labels, a consequence on every answer.
          for (const text of [c.title, c.text, ...c.choices.flatMap((ch) => [ch.label, ch.hint, ch.say])]) {
            expect(text).not.toMatch(/[·•●—–]/);
            expect(text.length).toBeGreaterThan(2);
          }
          expect(c.text.length).toBeLessThanOrEqual(140);
          for (const ch of c.choices) expect(ch.label.length).toBeLessThanOrEqual(24);
        }
        // Broke: an answer that costs coins is refused and nothing changes.
        const c = pendingEvent(st);
        const paid = c?.choices.findIndex((ch) => (ch.coins ?? 0) > wallet.coins) ?? -1;
        if (c && paid >= 0) {
          const before = JSON.stringify(st);
          expect(resolveEvent(st, wallet, c.id, paid)).toEqual({ ok: false, reason: 'no-coins' });
          expect(JSON.stringify(st)).toBe(before);
        }
        answerAll(st, wallet, i);
        expect(wallet.coins).toBeGreaterThanOrEqual(0);
        const squad = st.club!.squad;
        expect(squad.length).toBeGreaterThanOrEqual(SQUAD_MIN);
        expect(squad.some((p) => p.role === 'GK')).toBe(true);
        expect(squad.filter((p) => (g(p).inj ?? 0) > 0).length).toBeLessThanOrEqual(INJURY_MAX);
        expect(squad.filter((p) => !(g(p).inj ?? 0)).length).toBeGreaterThanOrEqual(11);
        expect(st.board.confidence).toBeGreaterThanOrEqual(0);
        expect(nextMatch(st) !== null || st.summary !== null).toBe(true);
      }
      // The board never sacks anyone: the season always ends with a summary and a next season.
      expect(st.summary).not.toBeNull();
      expect(startNextSeason(st)).not.toBeNull();
    }
    // The club's real state brought the stories out.
    for (const k of ['press', 'sponsor', 'ultimatum', 'bench', 'contract', 'clash', 'protest']) expect([...kinds], k).toContain(k);
    for (const k of Object.keys(EVENT_ICON)) expect(ICONS[EVENT_ICON[k as keyof typeof EVENT_ICON]], k).toBeDefined();
  }, 120_000);

  it('the press before a derby: what you say shows up in the derby, then it is spent', () => {
    const st = seasoned(41);
    const wallet = { coins: 0 };
    const derbyId = st.season!.derby!;
    for (let guard = 0; guard < 30; guard++) {
      const nm = nextMatch(st)!;
      if (nm.competition === 'league' && nm.rival.id === derbyId) break;
      st.events.queue = [];
      playNext(st, wallet, 1, 1);
    }
    const press = st.events.queue.find((c) => c.kind === 'press')!;
    expect(press).toBeDefined();
    expect(press.text).toMatch(/derby/i);
    expect(isBigMatch(st, nextMatch(st))).toBe(true);
    const rating = (s: CareerState) => {
      const nm = nextMatch(s)!;
      const them = nm.userHome ? nm.away : nm.home;
      return them.players.reduce((n, p) => n + p.stats.pace, 0);
    };
    const calm = rating(st);
    // FIRE BACK: your squad lifts, and so do they.
    const mor = moraleOf(st.club!.squad[0]);
    expect(resolveEvent(st, wallet, press.id, 0).ok).toBe(true);
    expect(st.events.rivalFire).toBe(1);
    expect(moraleOf(st.club!.squad[0])).toBeGreaterThan(mor);
    expect(rating(st)).toBe(calm + 11);
    expect(st.events.timeline[0].text).toMatch(/fired back/i);
    // Played: the fire is spent, and the press does not come twice for one match.
    playNext(st, wallet, 2, 0);
    expect(st.events.rivalFire).toBe(0);
    expect(rollPress(st)).toBe(false);
    // STAY HUMBLE relaxes them instead.
    const st2 = seasoned(41);
    for (let guard = 0; guard < 30; guard++) {
      const nm = nextMatch(st2)!;
      if (nm.competition === 'league' && nm.rival.id === st2.season!.derby) break;
      st2.events.queue = [];
      playNext(st2, wallet, 1, 1);
    }
    const p2 = st2.events.queue.find((c) => c.kind === 'press')!;
    const calm2 = rating(st2);
    resolveEvent(st2, wallet, p2.id, 1);
    expect(st2.events.rivalFire).toBe(-1);
    expect(rating(st2)).toBe(calm2 - 11);
  });

  it('a promise of a start is kept or broken, and both are felt', () => {
    const st = seasoned(42);
    const wallet = { coins: 0 };
    const club = st.club!;
    const sad = club.squad[12];
    Object.assign(g(sad), { mor: 30, sat: 6 });
    for (const k of Object.keys(sad.stats) as (keyof PlayerStats)[]) sad.stats[k] = 80;
    st.events.queue = [];
    st.events.sponsor = { name: 'X', pay: 'match', amount: 0, left: 99, paid: 0 };
    st.events.clock = 30;
    // (Press, the board and the transfer window would come first: play to a quiet week.)
    let bench: EventCard | undefined;
    for (let i = 0; i < 8 && !bench; i++) {
      st.events.queue = [];
      Object.assign(g(sad), { mor: 30, sat: 6 });
      rollEvents(st, { my: 1, their: 1 });
      bench = st.events.queue.find((c) => c.kind === 'bench');
      if (!bench) playNext(st, wallet, 1, 1);
    }
    expect(bench).toBeDefined();
    expect(bench!.who).toEqual([sad.id]);
    expect(resolveEvent(st, wallet, bench!.id, 0).ok).toBe(true);
    expect(st.events.promises).toHaveLength(1);
    expect(comingUp(st).some((x) => x.kind === 'promise')).toBe(true);
    // Broken: he never starts, and when the matches run out he takes it badly.
    const broken = JSON.parse(JSON.stringify(st)) as CareerState;
    const b = migrateCareer(broken, 1);
    const sadB = b.club!.squad.find((p) => p.id === sad.id)!;
    const before = moraleOf(sadB);
    for (let i = 0; i < 4; i++) {
      b.events.queue = [];
      playNext(b, wallet, 1, 1);
    }
    expect(b.events.promises).toHaveLength(0);
    expect(moraleOf(sadB)).toBeLessThan(before);
    expect(b.events.timeline.some((t) => /Promise broken/.test(t.text))).toBe(true);
    // Kept: put him in the eleven and play.
    const idx = club.squad.indexOf(sad);
    [club.squad[5], club.squad[idx]] = [club.squad[idx], club.squad[5]];
    const m0 = moraleOf(sad);
    while (cupDue(st) >= 0) playNext(st, wallet, 1, 0);
    playNext(st, wallet, 1, 1);
    expect(st.events.promises).toHaveLength(0);
    expect(moraleOf(sad)).toBeGreaterThan(m0);
    expect(st.events.timeline.some((t) => /Promise kept/.test(t.text))).toBe(true);
  });

  it('a pledge to the board pays when it is met and only costs confidence when it is not', () => {
    const st = seasoned(43);
    const wallet = { coins: 0 };
    st.board.confidence = 20;
    st.events.queue = [];
    st.events.sponsor = { name: 'X', pay: 'match', amount: 0, left: 99, paid: 0 };
    let card: EventCard | undefined;
    for (let i = 0; i < 6 && !card; i++) {
      st.events.queue = [];
      st.board.confidence = 20;
      playNext(st, wallet, 0, 1);
      card = st.events.queue.find((c) => c.kind === 'ultimatum');
    }
    expect(card).toBeDefined();
    const met = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(resolveEvent(met, wallet, card!.id, 0).ok).toBe(true);
    expect(met.events.pledge).toMatchObject({ wins: 2, have: 0 });
    const conf = met.board.confidence;
    for (let i = 0; i < 3 && met.events.pledge; i++) {
      met.events.queue = [];
      while (cupDue(met) >= 0) playNext(met, wallet, 2, 0);
      playNext(met, wallet, 2, 0);
    }
    expect(met.events.pledge).toBeNull();
    expect(met.board.confidence).toBeGreaterThanOrEqual(conf + 15);
    expect(met.board.owed).toBeGreaterThan(0);
    const coins = wallet.coins;
    expect(payBoard(met, wallet)).toBeGreaterThan(0);
    expect(wallet.coins).toBeGreaterThan(coins);
    // Not met: confidence drops, and that is all.
    const miss = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    resolveEvent(miss, wallet, card!.id, 0);
    const c0 = miss.board.confidence;
    for (let i = 0; i < 6 && miss.events.pledge; i++) {
      miss.events.queue = [];
      playNext(miss, wallet, 0, 1);
    }
    expect(miss.events.pledge).toBeNull();
    expect(miss.board.confidence).toBeLessThan(c0);
    expect(miss.club).not.toBeNull();
    expect(nextMatch(miss)).not.toBeNull();
  });

  it('a sponsor pays what the card said, match by match, and the deal is tracked', () => {
    const st = career(44);
    const wallet = { coins: 0 };
    playNext(st, wallet, 1, 0);
    const card = st.events.queue.find((c) => c.kind === 'sponsor')!;
    expect(card).toBeDefined();
    expect(card.choices).toHaveLength(3);
    // EVERY MATCH.
    const a = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    const wa = { coins: 0 };
    resolveEvent(a, wa, card.id, 0);
    const amount = a.events.sponsor!.amount;
    expect(amount).toBeGreaterThan(0);
    playNext(a, wa, 0, 3);
    expect(wa.coins).toBe(amount);
    expect(a.events.sponsor).toMatchObject({ left: 13, paid: amount });
    // WIN BONUS pays only when you win, and pays more.
    const b = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    const wb = { coins: 0 };
    resolveEvent(b, wb, card.id, 1);
    expect(b.events.sponsor!.amount).toBeGreaterThan(amount);
    playNext(b, wb, 0, 3);
    expect(wb.coins).toBe(0);
    playNext(b, wb, 3, 0);
    expect(wb.coins).toBe(b.events.sponsor!.amount);
    // CASH NOW.
    const c = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    const wc = { coins: 0 };
    resolveEvent(c, wc, card.id, 2);
    expect(wc.coins).toBeGreaterThan(amount * 4);
    expect(c.events.sponsor).toBeNull();
  });

  it('selling the star to a bid, a contract running out, and a player leaving in the summer', () => {
    const st = seasoned(45);
    const wallet = { coins: 0 };
    const club = st.club!;
    const star = [...club.squad].sort((x, y) => overall(y) - overall(x))[0];
    // A contract talk he does not get: he leaves in the summer, with a farewell line.
    g(star).contract = 1;
    g(star).traits = [];
    st.events.sponsor = { name: 'X', pay: 'match', amount: 0, left: 99, paid: 0 };
    let talk: EventCard | undefined;
    for (let guard = 0; guard < 40 && !talk && !st.summary; guard++) {
      st.events.queue = [];
      playNext(st, wallet, 1, 1);
      talk = st.events.queue.find((c) => c.kind === 'contract' && c.who[0] === star.id);
    }
    expect(talk).toBeDefined();
    expect(talk!.choices[0].coins).toBeGreaterThan(0);
    // Too poor for the new deal: the free answer is still there.
    expect(resolveEvent(st, wallet, talk!.id, 0)).toEqual({ ok: false, reason: 'no-coins' });
    expect(resolveEvent(st, wallet, talk!.id, 2).ok).toBe(true);
    expect(g(star).leaving).toBe(true);
    for (let guard = 0; guard < 40 && !st.summary; guard++) {
      st.events.queue = [];
      playNext(st, wallet, 1, 1);
    }
    const n = club.squad.length;
    startNextSeason(st);
    expect(club.squad.some((p) => p.id === star.id)).toBe(false);
    expect(club.squad.length).toBeGreaterThanOrEqual(Math.min(n - 1, SQUAD_MIN));
    expect(st.events.timeline.some((t) => t.text.includes(star.name) && /left/.test(t.text))).toBe(true);
    // A renewed player stays.
    const st2 = seasoned(46);
    const p = st2.club!.squad[3];
    g(p).contract = 1;
    g(p).leaving = true;
    st2.events.queue.push({ id: 'x1', kind: 'contract', season: 1, md: 0, title: 'T', text: 'text', icon: 'gift', who: [p.id], choices: [
      { label: 'A', hint: 'h', say: 's', tone: 'good', coins: 50, fx: [{ t: 'renew', who: p.id, years: 3 }] }, { label: 'B', hint: 'h', say: 's', tone: 'info', fx: [] },
    ] });
    const w2 = { coins: 60 };
    expect(resolveEvent(st2, w2, 'x1', 0).ok).toBe(true);
    expect(w2.coins).toBe(10);
    expect(g(p).contract).toBe(4);
    expect(g(p).leaving).toBeUndefined();
  }, 30_000);

  it('an academy graduate scoring in a win is a story, once', () => {
    const st = seasoned(47);
    const kid = st.club!.squad[9];
    Object.assign(g(kid), { academy: true, age: 18 });
    afterMatch(st, { played: st.club!.squad.slice(0, 11).map((p) => p.id), scorers: [kid.id], my: 1, their: 0, vs: 'Rivals FC' });
    const card = st.events.queue.find((c) => c.kind === 'youth')!;
    expect(card).toBeDefined();
    expect(card.text).toMatch(/scored the winner against Rivals FC/);
    expect(st.story.moments.some((m) => m.title === 'ACADEMY HERO')).toBe(true);
    expect(seasonHeadlines(st).some((t) => t.text.includes(kid.name))).toBe(true);
    // Once per player.
    expect(youthCard(st, [kid.id], 2, 0, 'X')).toBe(false);
    // A defeat is not the story.
    const other = st.club!.squad[8];
    Object.assign(g(other), { academy: true, age: 17 });
    expect(youthCard(st, [other.id], 1, 2, 'X')).toBe(false);
  });

  it('a card saved in a damaged state without a free answer is dropped on load', () => {
    const st = seasoned(48);
    st.events.queue.push({ id: 'bad', kind: 'bid', season: 1, md: 0, title: 'T', text: 'text', icon: 'swap', who: [], choices: [
      { label: 'A', hint: 'h', say: 's', tone: 'good', coins: 50, fx: [] }, { label: 'B', hint: 'h', say: 's', tone: 'info', coins: 9, fx: [] },
    ] });
    expect(migrateCareer(JSON.parse(JSON.stringify(st)), 1).events.queue.some((c) => c.id === 'bad')).toBe(false);
  });
});

describe('RPG player development', () => {
  it('the curve: teenagers learn fastest, it tails off, and nobody learns after thirty', () => {
    const rates = [16, 19, 20, 22, 24, 27, 29, 30, 31, 35].map(ageRate);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
    expect(ageRate(17)).toBe(1);
    expect(ageRate(31)).toBe(0);
  });

  it('playing grows a youngster faster than the bench, never past his potential, and paid training never moves it', () => {
    const st = seasoned(51);
    const club = st.club!;
    const mk = (i: number) => {
      const p = club.squad[i];
      Object.assign(g(p), { age: 17, potential: 4, traits: [] });
      delete g(p).ceil;
      return p;
    };
    const starter = mk(5);
    const sub = mk(13);
    for (const k of Object.keys(starter.stats) as (keyof PlayerStats)[]) sub.stats[k] = starter.stats[k];
    sub.role = starter.role;
    const ceil = ceilOf(starter);
    expect(ceil).toBeGreaterThan(overall(starter) + 10);
    const o0 = overall(starter);
    const wallet = { coins: 0 };
    for (let i = 0; i < 14 && !st.summary; i++) {
      st.events.queue = [];
      for (const p of club.squad) g(p).inj = 0;
      const xi = club.squad.slice(0, 11).map((p) => p.id);
      playNext(st, wallet, 1, 0);
      afterMatch(st, { played: xi, scorers: [], my: 1, their: 0, vs: 'X' });
    }
    expect(overall(starter)).toBeGreaterThan(o0 + 2);
    expect(overall(starter) - o0).toBeGreaterThan(overall(sub) - o0);
    expect(overall(sub)).toBeGreaterThan(o0);
    // His potential was pinned the first time he grew, and growing never moved it.
    expect(g(starter).ceil).toBe(ceil);
    // At his potential the bar fills and stays: no growth past it, whatever the XP.
    g(starter).ceil = overall(starter);
    const at = overall(starter);
    expect(gainXp(st, starter, 5000)).toBe(0);
    expect(overall(starter)).toBe(at);
    expect(g(starter).xp).toBe(XP_LEVEL);
    expect(hasRoom(starter)).toBe(false);
    // A paid +2 session still works (and leaves his potential where it was).
    const w = { coins: 5000 };
    expect(trainPlayer(club, w, starter.id, 'pace').ok).toBe(true);
    expect(g(starter).ceil).toBe(at);
    // The summer's growth respects it too.
    const before = overall(starter);
    ageSquad(club);
    expect(overall(starter)).toBeLessThanOrEqual(before);
    for (const p of club.squad) for (const k of Object.keys(p.stats) as (keyof PlayerStats)[]) expect(p.stats[k]).toBeLessThanOrEqual(STAT_CAP);
  });

  it('the training focus decides which stats grow, per player or for a whole position in one tap', () => {
    const st = seasoned(52);
    const club = st.club!;
    const fw = club.squad.find((p) => p.role === 'FW')!;
    Object.assign(g(fw), { age: 17, ceil: 99, traits: [] });
    expect(focusOf(fw)).toBe('allround');
    expect(setFocus(club, fw.id, 'sharp')).toBe(true);
    const s0 = { ...fw.stats };
    expect(gainXp(st, fw, XP_LEVEL)).toBeGreaterThanOrEqual(0);
    expect(fw.stats.shooting).toBe(s0.shooting + 2);
    expect(fw.stats.dribbling).toBe(s0.dribbling + 1);
    expect(fw.stats.pace).toBe(s0.pace);
    setFocus(club, fw.id, 'athlete');
    gainXp(st, fw, XP_LEVEL);
    expect(fw.stats.pace).toBe(s0.pace + 2);
    // Every position has three, each with a name and three stat points.
    for (const role of ['GK', 'DF', 'MF', 'FW'] as const) for (const f of ['sharp', 'athlete', 'allround'] as const) {
      expect(FOCUS_INFO[role][f].name.length).toBeGreaterThan(3);
      expect(FOCUS_INFO[role][f].stats).toHaveLength(3);
    }
    // One tap for the whole defence.
    const n = club.squad.filter((p) => p.role === 'DF').length;
    expect(setGroupFocus(club, 'DF', 'athlete')).toBe(n);
    expect(club.squad.filter((p) => p.role === 'DF').every((p) => focusOf(p) === 'athlete')).toBe(true);
    expect(setGroupFocus(club, 'DF', 'athlete')).toBe(0);
  });

  it('a veteran mentors a youngster: faster growth, and after ten matchdays a trait rubs off', () => {
    const st = seasoned(53);
    const club = st.club!;
    const mids = club.squad.filter((p) => p.role === 'MF');
    const [vet, kid, other] = mids;
    Object.assign(g(vet), { age: 31, traits: ['leader'] });
    Object.assign(g(kid), { age: 18, traits: [], ceil: 99 });
    Object.assign(g(other), { age: 25, traits: [] });
    for (const k of Object.keys(vet.stats) as (keyof PlayerStats)[]) vet.stats[k] = Math.max(vet.stats[k], kid.stats[k] + 5);
    // Too young to teach, or the wrong position: no.
    expect(setMentor(club, kid.id, other.id)).toBe(false);
    expect(setMentor(club, kid.id, club.squad.find((p) => p.role === 'GK')!.id)).toBe(false);
    const alone = xpRate(st, kid);
    expect(setMentor(club, kid.id, vet.id)).toBe(true);
    expect(mentorOf(club, kid)).toBe(vet);
    expect(xpRate(st, kid)).toBeCloseTo(alone * 1.25, 5);
    expect(comingUp(st).some((x) => x.kind === 'mentor')).toBe(true);
    let learned: ReturnType<typeof tickMentors> = [];
    for (let i = 0; i < MENTOR_TRAIT_AFTER; i++) learned = tickMentors(club);
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({ trait: 'leader' });
    expect(traitsOf(kid)).toContain('leader');
    // Only once.
    expect(tickMentors(club)).toEqual([]);
    // The veteran leaves: the pairing ends.
    club.squad.splice(club.squad.indexOf(vet), 1);
    tickMentors(club);
    expect(g(kid).mentor).toBeUndefined();
    // AUTO: every youngster gets the best free veteran of his position, one pupil each.
    const st2 = seasoned(54);
    const c2 = st2.club!;
    c2.squad.forEach((p, i) => Object.assign(g(p), { age: i % 2 ? 30 : 19, traits: [] }));
    for (const p of c2.squad) if (playerAge(p) >= 28) for (const k of Object.keys(p.stats) as (keyof PlayerStats)[]) p.stats[k] = 70;
    const pairs = autoMentors(c2);
    expect(pairs.length).toBeGreaterThan(2);
    expect(new Set(pairs.map((x) => x.vet.id)).size).toBe(pairs.length);
    for (const { kid: k2, vet: v2 } of pairs) expect(k2.role).toBe(v2.role);
  });

  it('traits give small tendencies on the day, and nothing more', () => {
    const st = seasoned(55);
    const p = st.club!.squad[9];
    g(p).traits = ['biggame'];
    expect(traitLift(p, { big: true, bench: false })).toBe(2);
    expect(traitLift(p, { big: false, bench: false })).toBe(0);
    g(p).traits = ['supersub'];
    expect(traitLift(p, { big: false, bench: true })).toBe(2);
    expect(traitLift(p, { big: false, bench: false })).toBe(0);
    g(p).traits = ['hothead'];
    expect(traitLift(p, { big: false, bench: false })).toMatchObject({ defending: 2, passing: -2 });
    // About four in ten have a trait without anyone giving them one, never more than two.
    const all = [1, 2, 3, 4, 5, 6].flatMap((s) => career(s).club!.squad);
    const withTrait = all.filter((x) => traitsOf(x).length > 0).length;
    expect(withTrait / all.length).toBeGreaterThan(0.2);
    expect(withTrait / all.length).toBeLessThan(0.6);
    expect(all.every((x) => traitsOf(x).length <= 2)).toBe(true);
    // In the match: a BIG GAME player in the derby is two points up, everyone else as they are.
    const st2 = seasoned(56);
    for (const q of st2.club!.squad) g(q).traits = [];
    const derby = st2.season!.derby!;
    for (let guard = 0; guard < 30; guard++) {
      const nm = nextMatch(st2)!;
      if (nm.competition === 'league' && nm.rival.id === derby) break;
      st2.events.queue = [];
      playNext(st2, { coins: 0 }, 1, 1);
    }
    for (const q of st2.club!.squad) g(q).mor = MORALE_START;
    st2.events.rivalFire = 0;
    const star = st2.club!.squad[10];
    g(star).traits = ['biggame'];
    const nm = nextMatch(st2)!;
    const mine = nm.userHome ? nm.home : nm.away;
    const lift = matchLift(st2, nm.userHome);
    expect(mine.players[10].stats.shooting).toBe(Math.min(STAT_CAP, star.stats.shooting + 2 + lift));
    expect(mine.players[9].stats.shooting).toBe(Math.min(STAT_CAP, st2.club!.squad[9].stats.shooting + lift));
  });

  it('the chart gets a point at the start of a season and at its halfway point', () => {
    const st = career(57);
    const wallet = { coins: 0 };
    const p = st.club!.squad[4];
    expect(growthChart(p).points).toEqual([overall(p)]);
    for (let i = 0; i < 40 && !st.summary; i++) {
      st.events.queue = [];
      playNext(st, wallet, 1, 0);
    }
    expect(g(p).hist).toHaveLength(1);
    startNextSeason(st);
    expect(g(p).hist).toHaveLength(2);
    const chart = growthChart(p);
    expect(chart.points[chart.points.length - 1]).toBe(overall(p));
    expect(chart.ceil).toBeGreaterThanOrEqual(overall(p));
    // Never more than sixteen points kept.
    g(p).hist = Array.from({ length: 40 }, (_, i) => 40 + (i % 5));
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(g(back.club!.squad[4]).hist!.length).toBeLessThanOrEqual(16);
  });
});

describe('the staff', () => {
  it('every job has three levels with a fee, a wage and a line that says what it does', () => {
    expect(STAFF.map((d) => d.role)).toEqual([...STAFF_ROLES]);
    for (const d of STAFF) {
      expect(d.levels).toHaveLength(3);
      expect(ICONS[d.icon], d.icon).toBeDefined();
      for (let i = 0; i < 3; i++) {
        const l = d.levels[i];
        expect(l.fee).toBeGreaterThan(0);
        expect(l.wage).toBeGreaterThan(0);
        expect(l.does).not.toMatch(/[·•●—–]/);
        if (i) {
          expect(l.fee).toBeGreaterThan(d.levels[i - 1].fee);
          expect(l.wage).toBeGreaterThan(d.levels[i - 1].wage);
        }
      }
    }
    for (const r of Object.values(REGIONS)) {
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.does).not.toMatch(/[·•●—–]/);
      expect(r.roles.length).toBeGreaterThan(2);
    }
  });

  it('hiring costs the fee now and the wage every league matchday; the higher levels need the buildings', () => {
    const st = seasoned(61);
    const wallet = { coins: 10000 };
    expect(staffWages(st)).toBe(0);
    expect(hireStaff(st, wallet, 'assistant')).toEqual({ ok: true, cost: 400, level: 1 });
    expect(wallet.coins).toBe(9600);
    expect(staffLevel(st, 'assistant')).toBe(1);
    expect(st.staff.hired.assistant!.name.length).toBeGreaterThan(2);
    // Level 2 needs the TRAINING GROUND.
    expect(staffNeeds(st, 'assistant')).toMatch(/TRAINING GROUND/);
    expect(hireStaff(st, wallet, 'assistant')).toEqual({ ok: false, reason: 'locked' });
    st.ground.built.training = 1;
    expect(hireStaff(st, wallet, 'assistant')).toEqual({ ok: true, cost: 1200, level: 2 });
    expect(hireStaff(st, wallet, 'assistant')).toMatchObject({ ok: true, level: 3 });
    expect(hireStaff(st, wallet, 'assistant')).toEqual({ ok: false, reason: 'maxed' });
    // A second scout needs a first; the director's upper levels need the academy; no coins, no hire.
    expect(hireStaff(st, wallet, 'scout2')).toEqual({ ok: false, reason: 'locked' });
    expect(hireStaff(st, { coins: 100 }, 'physio')).toEqual({ ok: false, reason: 'no-coins' });
    expect(hireStaff(st, wallet, 'academy')).toMatchObject({ ok: true, level: 1 });
    expect(hireStaff(st, wallet, 'academy')).toEqual({ ok: false, reason: 'locked' });
    // The wage bill leaves the wallet after a league matchday (never a cup tie).
    const wages = staffWages(st);
    expect(wages).toBe(60 + 14);
    const coins = wallet.coins;
    playNext(st, wallet, 0, 3);
    expect(wallet.coins).toBe(coins - wages);
    expect(releaseStaff(st, 'academy')).toBe(true);
    expect(staffWages(st)).toBe(60);
  });

  it('wages the wallet cannot cover are never a debt: the staff wait, and work again when paid', () => {
    const st = seasoned(62);
    const wallet = { coins: 400 };
    hireStaff(st, wallet, 'assistant');
    expect(wallet.coins).toBe(0);
    const kid = st.club!.squad[5];
    Object.assign(g(kid), { age: 18, ceil: 99, traits: [] });
    const boosted = xpRate(st, kid);
    expect(payStaff(st, wallet)).toBe(0);
    expect(wallet.coins).toBe(0);
    expect(st.staff.unpaid).toBe(true);
    expect(staffLevel(st, 'assistant')).toBe(0);
    expect(xpRate(st, kid)).toBeLessThan(boosted);
    expect(st.staff.hired.assistant).toBeDefined();
    wallet.coins = 100;
    expect(payStaff(st, wallet)).toBe(12);
    expect(st.staff.unpaid).toBe(false);
    expect(xpRate(st, kid)).toBeCloseTo(boosted, 5);
  });

  it('the assistant coach speeds up learning, level by level', () => {
    const rate = (level: number) => {
      const st = seasoned(63);
      st.ground.built.training = 1;
      const w = { coins: 1e6 };
      for (let i = 0; i < level; i++) hireStaff(st, w, 'assistant');
      const kid = st.club!.squad[5];
      Object.assign(g(kid), { age: 18, traits: [] });
      return xpRate(st, kid);
    };
    expect(rate(1)).toBeGreaterThan(rate(0));
    expect(rate(2)).toBeGreaterThan(rate(1));
    expect(rate(3)).toBeCloseTo(1 + 0.5 + 0.1, 5);
  });

  it('the physio makes injuries shorter and rarer; the injured come out of the eleven by themselves', () => {
    const out = (physio: number) => {
      let weeks = 0;
      let count = 0;
      for (let seed = 100; seed < 112; seed++) {
        const st = seasoned(seed);
        st.ground.built.training = 1;
        const w = { coins: 1e6 };
        for (let i = 0; i < physio; i++) hireStaff(st, w, 'physio');
        for (let i = 0; i < 14 && !st.summary; i++) {
          st.events.queue = [];
          const hurtBefore = new Set(st.club!.squad.filter((p) => (g(p).inj ?? 0) > 0).map((p) => p.id));
          playNext(st, w, 1, 1);
          for (const p of st.club!.squad) {
            if ((g(p).inj ?? 0) > 0 && !hurtBefore.has(p.id)) {
              count++;
              weeks += g(p).inj!;
              // Never left in the eleven hurt, and there is a card to answer about him.
              expect(st.club!.squad.indexOf(p)).toBeGreaterThanOrEqual(11);
              expect(st.events.queue.some((c) => c.kind === 'injury' && c.who[0] === p.id)).toBe(true);
            }
          }
        }
      }
      return { weeks, count };
    };
    const none = out(0);
    const best = out(3);
    expect(none.count).toBeGreaterThan(5);
    expect(best.count).toBeLessThan(none.count);
    expect(best.weeks / Math.max(1, best.count)).toBeLessThan(none.weeks / none.count);
  }, 60_000);

  it('a fresh career has no injuries in its first matches', () => {
    for (const seed of [71, 72, 73, 74]) {
      const st = career(seed);
      for (let i = 0; i < 3; i++) playNext(st, { coins: 0 }, 1, 1);
      expect(st.club!.squad.some((p) => (g(p).inj ?? 0) > 0)).toBe(false);
    }
  });

  it('a scout reports every few matchdays with the kind of player his region is known for', () => {
    const st = seasoned(64);
    const wallet = { coins: 50000 };
    expect(hireStaff(st, wallet, 'scout1', 'north')).toMatchObject({ ok: true, level: 1 });
    expect(st.staff.hired.scout1).toMatchObject({ region: 'north', task: 'north', brief: 'youth' });
    expect(st.staff.due.scout1).toBe(3);
    expect(tickScouts(st)).toEqual([]);
    expect(tickScouts(st)).toEqual([]);
    const [report] = tickScouts(st);
    expect(report).toMatchObject({ slot: 'scout1', region: 'north', seen: false });
    expect(report.finds).toHaveLength(2);
    expect(unseenReports(st)).toHaveLength(1);
    expect(st.staff.due.scout1).toBe(3);
    // The same matchday always brings the same report.
    const twin = seasoned(64);
    hireStaff(twin, { coins: 50000 }, 'scout1', 'north');
    tickScouts(twin);
    tickScouts(twin);
    expect(tickScouts(twin)[0].finds.map((f) => f.player.name)).toEqual(report.finds.map((f) => f.player.name));
    // Regions lean their own way: many reports from the north are mostly defenders and keepers, the south forwards.
    const roles = (region: 'north' | 'south') => {
      const s = seasoned(65);
      hireStaff(s, { coins: 50000 }, 'scout1', region);
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        s.season!.matchday = i % 13;
        s.staff.due.scout1 = 1;
        out.push(...tickScouts(s)[0].finds.map((f) => f.player.role));
      }
      return out;
    };
    const north = roles('north');
    const south = roles('south');
    const share = (xs: string[], r: string[]) => xs.filter((x) => r.includes(x)).length / xs.length;
    expect(share(north, ['DF', 'GK'])).toBeGreaterThan(0.6);
    expect(share(south, ['FW'])).toBeGreaterThan(0.5);
    // A youngster found has real potential; a ready player is about the division's level.
    const youth = report.finds.find((f) => f.kind === 'youth')!;
    expect(playerAge(youth.player)).toBeLessThanOrEqual(19);
    expect(ceilOf(youth.player)).toBeGreaterThan(overall(youth.player) + 8);
    expect(youth.fee).toBeGreaterThan(0);
    // A region he does not know takes a matchday longer; a better scout is quicker and finds three.
    expect(setScout(st, 'scout1', { task: 'east' })).toBe(true);
    expect(st.staff.due.scout1).toBe(4);
    setScout(st, 'scout1', { task: 'north', brief: 'ready' });
    hireStaff(st, wallet, 'scout1');
    expect(st.staff.due.scout1).toBe(2);
    st.staff.due.scout1 = 1;
    const second = tickScouts(st)[0];
    expect(second.finds).toHaveLength(3);
    expect(second.finds.filter((f) => f.kind === 'ready')).toHaveLength(2);
    expect(st.staff.reports).toHaveLength(1);
  });

  it('a find signs at the scout\'s price, in or out of the window, under the squad and wage rules', () => {
    const st = seasoned(66);
    const wallet = { coins: 50000 };
    hireStaff(st, wallet, 'scout1', 'home');
    st.staff.due.scout1 = 1;
    st.season!.matchday = 5;
    tickScouts(st);
    const report = reportOf(st, 'scout1')!;
    const find = report.finds[0];
    const n = st.club!.squad.length;
    expect(canSignFind(st, 0, 'scout1', 0)).toEqual({ ok: false, reason: 'no-coins' });
    const coins = wallet.coins;
    const r = signFind(st, wallet, 'scout1', 0);
    expect(r.ok).toBe(true);
    expect(wallet.coins).toBe(coins - find.fee);
    expect(st.club!.squad).toHaveLength(n + 1);
    const p = st.club!.squad[n] as GrowPlayer;
    expect(p.name).toBe(find.player.name);
    expect(p).toMatchObject({ paid: find.fee, boughtSeason: 1, joined: 1 });
    expect(/^c\d+$/.test(p.id)).toBe(true);
    expect(report.finds).toHaveLength(1);
    expect(signFind(st, wallet, 'scout1', 5)).toEqual({ ok: false, reason: 'not-found' });
    // A full squad can't take one.
    while (st.club!.squad.length < SQUAD_MAX) st.club!.squad.push({ ...st.club!.squad[5], id: `x${st.club!.squad.length}` });
    expect(signFind(st, wallet, 'scout1', 0)).toEqual({ ok: false, reason: 'squad-full' });
    // Letting the first scout go moves the second into his chair.
    const s2 = seasoned(67);
    hireStaff(s2, wallet, 'scout1', 'east');
    hireStaff(s2, wallet, 'scout2', 'west');
    releaseStaff(s2, 'scout1');
    expect(s2.staff.hired.scout1).toMatchObject({ region: 'west' });
    expect(s2.staff.hired.scout2).toBeUndefined();
  });

  it('the academy director and the Scouting Network make every intake better, as stated', () => {
    const intake = (setup: (st: CareerState) => void) => {
      const st = seasoned(68);
      st.ground.built.academy = 1;
      setup(st);
      st.academy.season = 0;
      st.season!.number = 2;
      academyIntake(st);
      return st.academy.prospects;
    };
    const base = intake(() => undefined);
    expect(base).toHaveLength(3);
    const directed = intake((st) => {
      const w = { coins: 1e6 };
      for (let i = 0; i < 3; i++) expect(hireStaff(st, w, 'academy').ok).toBe(true);
    });
    expect(directed).toHaveLength(4);
    expect(directed.slice(0, 3).reduce((s, p) => s + overall(p), 0)).toBeGreaterThan(base.reduce((s, p) => s + overall(p), 0));
    expect(Math.max(...directed.map(playerPotential))).toBeGreaterThanOrEqual(Math.max(...base.map(playerPotential)));
    // The network is a guarantee, never odds: the best of every intake has at least its stars, every seed.
    for (const tier of SCOUT_NETWORKS) {
      for (const seed of [201, 202, 203, 204, 205, 206]) {
        const st = seasoned(seed);
        const plain = st.academy.prospects.length;
        expect(plain).toBe(0);
        st.staff.network = tier.tier;
        st.season!.number = 2;
        academyIntake(st);
        const ps = st.academy.prospects;
        expect(ps).toHaveLength(2 + tier.extra);
        expect(playerPotential(ps[bestProspectIndex(st)])).toBeGreaterThanOrEqual(tier.minStars);
      }
    }
    // The career's copy follows the save's (gems.ts owns the tier), and survives starting again as a legend.
    const st = seasoned(69);
    const save = { gems: normalizeGems({ balance: 0, network: 2, claimed: [], log: [] }) };
    syncNetwork(st, save);
    expect(st.staff.network).toBe(2);
    st.history.push({ season: 1, division: TOP_DIVISION, position: 1, outcome: 'stayed' });
    expect(startAsLegend(st)).toBe(true);
    expect(st.staff.network).toBe(2);
    expect(st.events.open).toEqual(UNLOCKS.map((u) => u.id));
    expect(st.staff.hired).toEqual({});
  });

  it('the commercial manager brings coins at home matches only', () => {
    const st = seasoned(70);
    const wallet = { coins: 1e6 };
    hireStaff(st, wallet, 'commercial');
    expect(commercialIncome(st)).toBe(40);
    st.staff.unpaid = true;
    expect(commercialIncome(st)).toBe(0);
    st.staff.unpaid = false;
    st.events.sponsor = { name: 'X', pay: 'match', amount: 0, left: 99, paid: 0 };
    let home = 0;
    let away = 0;
    for (let i = 0; i < 6; i++) {
      while (cupDue(st) >= 0) playNext(st, wallet, 1, 0);
      st.events.queue = [];
      const s = st.season!;
      const atHome = userFixture(s, s.matchday)!.home === YOU;
      const before = wallet.coins;
      playNext(st, wallet, 0, 3);
      const d = wallet.coins - before + staffWages(st);
      if (atHome) home += d;
      else away += d;
    }
    expect(home).toBe(3 * 40);
    expect(away).toBe(0);
  });
});

describe('morale and chemistry', () => {
  it('results and playing time move each player\'s morale; a leader softens a defeat', () => {
    const st = seasoned(81);
    const club = st.club!;
    for (const p of club.squad) g(p).traits = [];
    expect(teamMood(st)).toBe(1);
    weekMorale(st, 2, 0);
    // A win: the starters most (and a point for playing), the rest of the squad a little.
    expect(moraleOf(club.squad[0])).toBe(MORALE_START + WIN_LIFT + 1);
    expect(moraleOf(club.squad[12])).toBe(MORALE_START + 2);
    for (let i = 0; i < 3; i++) weekMorale(st, 2, 0);
    expect(teamMood(st)).toBe(2);
    expect(matchLift(st, false)).toBe(1);
    // Defeats bring it down; LOW morale costs a point on the pitch.
    for (let i = 0; i < 12; i++) weekMorale(st, 0, 2);
    expect(teamMood(st)).toBe(0);
    expect(matchLift(st, false)).toBe(-1);
    // With a leader in the eleven a defeat costs the starters half.
    const a = seasoned(82);
    const b = seasoned(82);
    for (const p of [...a.club!.squad, ...b.club!.squad]) g(p).traits = [];
    g(b.club!.squad[3]).traits = ['leader'];
    weekMorale(a, 0, 1);
    weekMorale(b, 0, 1);
    expect(moraleOf(b.club!.squad[0])).toBeGreaterThan(moraleOf(a.club!.squad[0]));
    for (const p of club.squad) {
      expect(moraleOf(p)).toBeGreaterThanOrEqual(0);
      expect(moraleOf(p)).toBeLessThanOrEqual(100);
      expect(Number.isInteger(g(p).mor)).toBe(true);
    }
  });

  it('a bench player good enough to expect a game gets unhappy; ROTATE finds the swap, in one tap', () => {
    const st = seasoned(83);
    const club = st.club!;
    for (const p of club.squad) g(p).traits = [];
    // A reserve forward as good as the starters, and a weak one.
    const fwd = club.squad.findIndex((p, i) => i >= 11 && p.role === 'FW');
    const good = club.squad[fwd];
    const starter = club.squad.find((p, i) => i < 11 && p.role === 'FW')!;
    for (const k of Object.keys(good.stats) as (keyof PlayerStats)[]) good.stats[k] = starter.stats[k];
    g(good).age = 25;
    const weak = club.squad.find((p, i) => i >= 11 && p !== good && p.role !== 'GK')!;
    for (const k of Object.keys(weak.stats) as (keyof PlayerStats)[]) weak.stats[k] = 10;
    expect(expectsToPlay(club, good)).toBe(true);
    expect(expectsToPlay(club, weak)).toBe(false);
    expect(rotateSuggestion(st)).toBeNull();
    for (let i = 0; i < 9; i++) weekMorale(st, 1, 1);
    expect(moraleOf(good)).toBeLessThan(50);
    expect(moraleOf(weak)).toBeGreaterThanOrEqual(MORALE_START - 2);
    // A super sub is happy on the bench.
    const st2 = seasoned(83);
    const g2 = st2.club!.squad[fwd];
    for (const k of Object.keys(g2.stats) as (keyof PlayerStats)[]) g2.stats[k] = 99;
    g(g2).traits = ['supersub'];
    for (let i = 0; i < 9; i++) weekMorale(st2, 1, 1);
    expect(moraleOf(g2)).toBeGreaterThanOrEqual(MORALE_START - 2);
    // ROTATE: him in for a forward, the eleven no more than four points weaker.
    const pick = rotateSuggestion(st)!;
    expect(pick).toMatchObject({ in: club.squad.indexOf(good), why: 'unhappy' });
    expect(club.squad[pick.out].role).toBe('FW');
    expect(rotate(st)).toEqual(pick);
    expect(club.squad.indexOf(good)).toBeLessThan(11);
    // An injured starter comes first.
    const st3 = seasoned(84);
    g(st3.club!.squad[4]).inj = 2;
    const p3 = rotateSuggestion(st3)!;
    expect(p3).toMatchObject({ out: 4, why: 'injured' });
    expect(st3.club!.squad[p3.in].role).toBe(st3.club!.squad[4].role);
    // AUTO PICK leaves the injured out too.
    const xi = autoLineupFit(st3.club!.squad, st3.club!.formation).slice(0, 11);
    expect(xi.some((p) => (g(p).inj ?? 0) > 0)).toBe(false);
    expect(autoLineupFit(st3.club!.squad, st3.club!.formation)).toHaveLength(st3.club!.squad.length);
  });

  it('TEAM TALK lifts everyone and the next match, then needs three matchdays', () => {
    const st = seasoned(85);
    const wallet = { coins: 0 };
    for (const p of st.club!.squad) g(p).traits = [];
    for (const p of st.club!.squad) g(p).mor = MORALE_START;
    expect(talkWait(st)).toBe(0);
    const lift0 = matchLift(st, false);
    expect(teamTalk(st)).toBe(6);
    expect(moraleOf(st.club!.squad[15])).toBe(MORALE_START + 6);
    expect(matchLift(st, false)).toBe(lift0 + 1);
    expect(teamTalk(st)).toBe(0);
    while (cupDue(st) >= 0) playNext(st, wallet, 1, 1);
    playNext(st, wallet, 1, 1);
    // Spent on that match, and not ready again yet.
    expect(st.events.talk).toBe(false);
    expect(talkWait(st)).toBe(TALK_COOLDOWN - 1);
    expect(teamTalk(st)).toBe(0);
    for (let i = 0; i < TALK_COOLDOWN - 1; i++) {
      st.events.queue = [];
      while (cupDue(st) >= 0) playNext(st, wallet, 1, 1);
      playNext(st, wallet, 1, 1);
    }
    expect(talkWait(st)).toBe(0);
    // A leader in the eleven makes it worth more.
    g(st.club!.squad[2]).traits = ['leader'];
    expect(teamTalk(st)).toBe(9);
    // The lift on the match card never leaves -1 to +2.
    st.ground.built.fanzone = 1;
    for (const p of st.club!.squad) g(p).mor = 95;
    expect(matchLift(st, true)).toBe(2);
  });

  it('a settled eleven builds partnerships and chemistry sooner', () => {
    const st = seasoned(86);
    const club = st.club!;
    expect(partnerships(club)).toEqual([]);
    expect(chemistry(club, 1)).toBe(0);
    for (let i = 0; i < 6; i++) weekMorale(st, 1, 1);
    const pairs = partnerships(club);
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const p of pairs) expect(p.a.role).toBeDefined();
    expect(chemistry(club, 1)).toBe(1);
    expect(chemistry(club, 2)).toBe(2);
    // Chop and change: the runs reset.
    [club.squad[3], club.squad[13]] = [club.squad[13], club.squad[3]];
    weekMorale(st, 1, 1);
    expect(g(club.squad[13]).run).toBe(0);
    expect(g(club.squad[3]).run).toBe(1);
  });
});

describe('SIM THIS MATCH', () => {
  it('settles an ordinary league match in one tap for half the coins, and the season moves on as if played', () => {
    const st = career(91);
    const wallet = { coins: 0 };
    // Not open in a career's first matches.
    expect(simBlock(st)).toMatch(/OPENS/);
    expect(simMatch(st, wallet)).toBeNull();
    for (let i = 0; i < 7; i++) {
      playNext(st, wallet, 1, 0);
      answerAll(st, wallet);
    }
    expect(isOpen(st, 'sim')).toBe(true);
    // Find an ordinary league match (no cup tie due, no derby, no decider).
    let guard = 0;
    while (simBlock(st) && guard++ < 10) {
      playNext(st, wallet, 1, 0);
      answerAll(st, wallet);
    }
    expect(simBlock(st)).toBeNull();
    const twin = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    const md = st.season!.matchday;
    const nm = nextMatch(st)!;
    const stadium = st.stadium;
    const coins = wallet.coins;
    const apps = (st.club!.squad[0] as GrowPlayer).apps ?? 0;
    const r = simMatch(st, wallet)!;
    expect(r).not.toBeNull();
    expect(st.season!.matchday).toBe(md + 1);
    const f = userFixture(st.season!, md)!;
    expect(nm.userHome ? [f.hg, f.ag] : [f.ag, f.hg]).toEqual([r.my, r.their]);
    expect(r.scorers).toHaveLength(r.my);
    // Half of what playing it would have paid (the sponsor and the staff are the week's own business).
    const full = groundBonus(st, matchReward(st.season!.division, stadium, r.my, r.their), nm.userHome, st.season!.division).coins;
    expect(r.coins).toBe(Math.round(full * SIM_PAY));
    expect(SIM_PAY).toBe(0.5);
    expect(wallet.coins).toBeGreaterThanOrEqual(coins + r.coins - staffWages(st));
    // The record book moved: the eleven played.
    expect((st.club!.squad.find((p) => p.id === nm.home.players[0].id || p.id === nm.away.players[0].id) as GrowPlayer).apps).toBe(apps + 1);
    // The same fixture always sims to the same score.
    const r2 = simMatch(twin, { coins: 0 })!;
    expect([r2.my, r2.their, r2.scorers]).toEqual([r.my, r.their, r.scorers]);
  });

  it('a derby, a decider and a cup tie are always played', () => {
    const st = seasoned(92);
    const wallet = { coins: 0 };
    const seen = new Set<string>();
    for (let i = 0; i < 40 && !st.summary; i++) {
      const nm = nextMatch(st)!;
      const block = simBlock(st);
      if (nm.competition !== 'league') {
        expect(block).toBe('CUP TIES ARE PLAYED');
        expect(simMatch(st, wallet)).toBeNull();
        seen.add('cup');
      } else if (nm.rival.id === st.season!.derby) {
        expect(block).toBe('TOO BIG TO SIM');
        seen.add('derby');
      }
      st.events.queue = [];
      playNext(st, wallet, 2, 0);
    }
    expect([...seen].sort()).toEqual(['cup', 'derby']);
  });
});

describe('the gem shortcuts (meta/gems.ts owns the wallet and the prices)', () => {
  const save = (n: number) => {
    const s = { gems: normalizeGems(undefined) };
    spendGems(s, gems(s), 'test');
    addGems(s, n, 'test');
    return s;
  };

  it('FINISH NOW opens the part being built for its shown price, and never without the gems', () => {
    const st = seasoned(95);
    const wallet = { coins: 10000 };
    expect(finishBuildCost(st)).toBe(0);
    expect(finishBuildNow(st, save(500))).toBe(false);
    buildPart(st, wallet, 'main');
    buildPart(st, wallet, 'training');
    expect(st.ground.building).toMatchObject({ id: 'main', left: 1 });
    expect(finishBuildCost(st)).toBe(GEM_PRICES.finishBuildPerMatchday);
    const poor = save(GEM_PRICES.finishBuildPerMatchday - 1);
    expect(finishBuildNow(st, poor)).toBe(false);
    expect(st.ground.building).not.toBeNull();
    expect(gems(poor)).toBe(GEM_PRICES.finishBuildPerMatchday - 1);
    const rich = save(100);
    expect(finishBuildNow(st, rich)).toBe(true);
    expect(gems(rich)).toBe(100 - GEM_PRICES.finishBuildPerMatchday);
    expect(st.ground.built.main).toBe(1);
    expect(st.stadium).toBe(1);
    expect(st.ground.building).toBeNull();
    expect(st.story.moments.some((m) => m.kind === 'build')).toBe(true);
    // The free way: a matchday off the build without a match (the rewarded ad).
    buildPart(st, wallet, 'academy');
    expect(st.ground.building).toBeNull();
    st.ground.built.training = 1;
    expect(buildPart(st, wallet, 'academy')).toMatchObject({ ok: true, weeks: 2 });
    expect(finishBuildCost(st)).toBe(GEM_PRICES.finishBuildPerMatchday * 2);
    expect(skipBuildMatchday(st)).toBe(true);
    expect(st.ground.building).toMatchObject({ left: 1 });
  });

  it('HEAL NOW puts an injured player back for its shown price, on his card or on the event card', () => {
    const st = seasoned(96);
    const p = st.club!.squad[12];
    const s = save(GEM_PRICES.healPlayer + 5);
    expect(healNow(st, s, p.id)).toBe(false);
    g(p).inj = 3;
    expect(healNow(st, save(1), p.id)).toBe(false);
    expect(g(p).inj).toBe(3);
    expect(healNow(st, s, p.id)).toBe(true);
    expect(g(p).inj).toBe(0);
    expect(gems(s)).toBe(5);
    // On the card: the answer costs gems, is refused without them, and the free answer always works.
    g(p).inj = 3;
    expect(injuryCard(st, p, 3, false, GEM_PRICES.healPlayer)).toBe(true);
    const card = st.events.queue.find((c) => c.kind === 'injury')!;
    expect(card.choices.map((c) => c.label)).toEqual(['REST HIM', 'EXTRA PHYSIO', 'HEAL NOW']);
    expect(card.choices[2].gems).toBe(GEM_PRICES.healPlayer);
    const wallet = { coins: 0 };
    expect(resolveEvent(st, wallet, card.id, 2)).toEqual({ ok: false, reason: 'no-gems' });
    const s2 = save(GEM_PRICES.healPlayer);
    expect(resolveEvent(st, wallet, card.id, 2, (n, why) => spendGems(s2, n, why)).ok).toBe(true);
    expect(g(p).inj).toBe(0);
    expect(gems(s2)).toBe(0);
    // EXTRA PHYSIO takes a matchday off for coins.
    g(p).inj = 3;
    injuryCard(st, p, 3, true, GEM_PRICES.healPlayer);
    const c2 = st.events.queue.find((c) => c.kind === 'injury')!;
    const w = { coins: 1000 };
    expect(resolveEvent(st, w, c2.id, 1).ok).toBe(true);
    expect(g(p).inj).toBe(2);
    expect(w.coins).toBe(1000 - c2.choices[1].coins!);
  });
});

describe('the save', () => {
  it('round-trips a career deep in the long game through JSON unchanged', () => {
    const st = seasoned(111);
    const wallet = { coins: 60000 };
    st.ground.built.training = 1;
    for (const role of ['assistant', 'physio', 'scout1', 'scout2', 'academy', 'commercial'] as StaffRole[]) hireStaff(st, wallet, role, 'south');
    setFocus(st.club!, st.club!.squad[3].id, 'sharp');
    autoMentors(st.club!);
    teamTalk(st);
    for (let i = 0; i < 12; i++) {
      const xi = st.club!.squad.slice(0, 11).map((p) => p.id);
      playNext(st, wallet, i % 3, 1);
      afterMatch(st, { played: xi, scorers: [xi[9]], my: 1, their: 1, vs: 'X' });
      if (i % 2) answerAll(st, wallet, i);
    }
    g(st.club!.squad[14]).inj = 2;
    g(st.club!.squad[15]).leaving = true;
    expect(st.staff.reports.length).toBeGreaterThan(0);
    expect(st.events.timeline.length).toBeGreaterThan(5);
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
    // Twice is the same as once.
    expect(migrateCareer(JSON.parse(JSON.stringify(back)), 1)).toEqual(back);
  });

  it('garbage in the new fields falls back to defaults instead of breaking the career', () => {
    const st = seasoned(112);
    const raw = JSON.parse(JSON.stringify(st));
    raw.staff = { hired: { assistant: { level: 99, name: 5 }, scout2: { level: 1, region: 'mars' }, bogus: { level: 1 } }, due: { scout1: -5 }, reports: [{ slot: 'scout1', finds: [{ player: 3 }] }, 7], network: 44, unpaid: 'yes' };
    raw.events = { queue: [{ id: 3 }, { id: 'e1', kind: 'nope' }], timeline: [{ text: 5 }, { text: 'ok', tone: 'x' }], last: { a: 'b', c: 4 }, clock: -9, promises: 'no', pledge: { wins: 'x' }, sponsor: { name: 5 }, fans: { d: 99, left: 'x' }, rivalFire: 77, open: [1, 'staff'] };
    raw.club.squad[0].ceil = 5000;
    raw.club.squad[0].mor = -40;
    raw.club.squad[0].traits = ['leader', 'pirate', 'leader'];
    raw.club.squad[0].focus = 'nope';
    raw.club.squad[0].hist = ['a', 50];
    const back = migrateCareer(raw, 1);
    expect(back.staff.hired.assistant).toMatchObject({ level: 3 });
    // (A second scout with no first takes the first chair, at home when his region is unknown.)
    expect(back.staff.hired.scout1).toMatchObject({ level: 1, region: 'home' });
    expect(back.staff.hired.scout2).toBeUndefined();
    expect(back.staff.network).toBe(3);
    expect(back.staff.unpaid).toBe(false);
    expect(back.staff.reports.every((r) => r.finds.length === 0)).toBe(true);
    expect(back.events.queue).toEqual([]);
    expect(back.events.timeline).toHaveLength(1);
    expect(back.events.last).toEqual({ c: 4 });
    expect(back.events.clock).toBe(0);
    expect(back.events.promises).toEqual([]);
    expect(back.events.pledge).toBeNull();
    expect(back.events.sponsor).toBeNull();
    expect(back.events.fans).toMatchObject({ d: 2, left: 1 });
    expect(back.events.rivalFire).toBe(2);
    expect(back.events.open).toEqual(['staff']);
    const p = back.club!.squad[0] as GrowPlayer;
    expect(p.ceil).toBe(STAT_CAP);
    expect(p.mor).toBe(0);
    expect(p.traits).toEqual(['leader']);
    expect(p.focus).toBeUndefined();
    expect(p.hist).toEqual([50]);
    // The season still plays.
    playNext(back, { coins: 0 }, 1, 0);
  });
});

describe('a twenty season career stays stable and solvent', () => {
  afterEach(() => vi.useRealTimers());

  it('twenty seasons with a manager who uses everything: never in debt, never stuck, a save that stays small', () => {
    const st = career(2026);
    const wallet = { coins: 0 };
    const rng = new Rng(hashString('soak'));
    let unpaid = 0;
    let weeks = 0;
    let cards = 0;
    let maxJson = 0;
    const kinds = new Set<string>();
    const sane = (where: string) => {
      const club = st.club!;
      expect(Number.isFinite(wallet.coins), where).toBe(true);
      expect(wallet.coins, where).toBeGreaterThanOrEqual(0);
      expect(club.squad.length, where).toBeGreaterThanOrEqual(SQUAD_MIN);
      expect(club.squad.length, where).toBeLessThanOrEqual(SQUAD_MAX);
      expect(club.squad.filter((p) => p.role === 'GK').length, where).toBeGreaterThanOrEqual(1);
      expect(st.events.queue.length, where).toBeLessThanOrEqual(QUEUE_MAX);
      expect(st.events.timeline.length, where).toBeLessThanOrEqual(TIMELINE_MAX);
      expect(st.board.confidence, where).toBeGreaterThanOrEqual(0);
      expect(st.board.confidence, where).toBeLessThanOrEqual(100);
      for (const p of club.squad) {
        for (const k of Object.keys(p.stats) as (keyof PlayerStats)[]) {
          expect(Number.isInteger(p.stats[k]) && p.stats[k] >= 1 && p.stats[k] <= STAT_CAP, `${where} ${p.name} ${k}`).toBe(true);
        }
        const m = moraleOf(p);
        expect(m >= 0 && m <= 100, where).toBe(true);
        expect((g(p).inj ?? 0) <= 12, where).toBe(true);
      }
      expect(new Set(club.squad.map((p) => p.id)).size, where).toBe(club.squad.length);
    };
    for (let season = 1; season <= 20; season++) {
      expect(st.season!.number).toBe(season);
      expect(st.season!.fixtures).toHaveLength(56);
      for (let guard = 0; guard < 60 && !st.summary; guard++) {
        const where = `s${season} md${st.season!.matchday}`;
        // Answer the cards (any answer the wallet covers, a different one each time).
        for (const c of st.events.queue) kinds.add(c.kind);
        cards += answerAll(st, wallet, rng.int(3)).length;
        // Pick the team: the fit eleven, then whatever ROTATE suggests; a team talk when it is ready.
        const club = st.club!;
        if (guard % 3 === 0) club.squad = autoLineupFit(club.squad, club.formation);
        rotate(st);
        teamTalk(st);
        if (guard % 5 === 0) autoMentors(club);
        // Spend like a careful manager: staff and the ground when there is a cushion, a scout's find now and then.
        for (const role of STAFF_ROLES) {
          const lv = STAFF.find((d) => d.role === role)!.levels[st.staff.hired[role]?.level ?? 0];
          if (lv && wallet.coins > lv.fee + 1500 + staffWages(st) * 6) hireStaff(st, wallet, role, (['home', 'north', 'south', 'east', 'west'] as const)[rng.int(5)]);
        }
        if (!st.ground.building && wallet.coins > 4000) {
          for (const id of ['main', 'training', 'near', 'lights', 'academy', 'screen', 'store', 'fanzone', 'north', 'south', 'roof'] as const) if (buildPart(st, wallet, id).ok) break;
        }
        for (const r of st.staff.reports) {
          r.seen = true;
          if (r.finds.length && club.squad.length < SQUAD_MAX - 2 && wallet.coins > r.finds[0].fee + 2000) signFind(st, wallet, r.slot, 0);
        }
        while (st.academy.prospects.length && club.squad.length < SQUAD_MAX - 1 && promoteProspect(st, bestProspectIndex(st)).ok);
        // Play (or sim when it can be): a decent side that wins more than it loses.
        const nm = nextMatch(st)!;
        expect(nm, where).not.toBeNull();
        const xi = club.squad.slice(0, 11);
        const my = rng.int(4);
        const their = rng.int(3);
        const stadium = st.stadium;
        const division = st.season!.division;
        if (!simBlock(st) && rng.chance(0.3)) {
          expect(simMatch(st, wallet), where).not.toBeNull();
          weeks++;
          if (st.staff.unpaid) unpaid++;
        } else if (cupDue(st) >= 0) {
          const out = resolveCupTie(st, my, their, my >= their);
          wallet.coins += matchReward(division, stadium, my, their).coins + (out?.coins ?? 0);
          afterMatch(st, { played: xi.map((p) => p.id), scorers: Array.from({ length: my }, () => xi[7 + rng.int(4)].id), my, their, vs: nm.rival.name });
        } else if (compsDue(st)) {
          const out = resolveCompTie(st, my, their, my >= their);
          wallet.coins += matchReward(division, stadium, my, their).coins + (out?.coins ?? 0);
          afterMatch(st, { played: xi.map((p) => p.id), scorers: Array.from({ length: my }, () => xi[7 + rng.int(4)].id), my, their, vs: nm.rival.name });
        } else {
          playNext(st, wallet, my, their);
          wallet.coins += groundBonus(st, matchReward(division, stadium, my, their), nm.userHome, division).coins;
          afterMatch(st, { played: xi.map((p) => p.id), scorers: Array.from({ length: my }, () => xi[7 + rng.int(4)].id), my, their, vs: nm.rival.name });
          weeks++;
          if (st.staff.unpaid) unpaid++;
        }
        payBoard(st, wallet);
        st.story.moments = [];
        sane(where);
        // Something is always on its way, and NEXT GOAL always has a line.
        if (!st.summary) {
          expect(comingUp(st).length, where).toBeGreaterThan(0);
          expect(nextGoal(st, wallet.coins), where).not.toBeNull();
        }
      }
      expect(st.summary, `season ${season}`).not.toBeNull();
      maxJson = Math.max(maxJson, JSON.stringify(st).length);
      // The save round-trips exactly, every season.
      expect(migrateCareer(JSON.parse(JSON.stringify(st)), 1), `season ${season}`).toEqual(st);
      answerAll(st, wallet, season);
      expect(startNextSeason(st), `season ${season}`).not.toBeNull();
      sane(`summer ${season}`);
    }
    // Solvent: never a debt (checked every match), the staff were paid nearly every week, and coins are in the bank.
    expect(weeks).toBe(20 * MATCHDAYS);
    expect(unpaid / weeks).toBeLessThan(0.05);
    expect(wallet.coins).toBeGreaterThan(0);
    // The stories kept coming: a card every couple of matches, of many kinds.
    expect(cards).toBeGreaterThan(20 * 5);
    expect(kinds.size).toBeGreaterThanOrEqual(8);
    // The staff were worth hiring by the end, the club has a story, and the save stays small enough to sync.
    expect(Object.keys(st.staff.hired).length).toBeGreaterThanOrEqual(4);
    expect(st.events.timeline.length).toBeGreaterThan(20);
    expect(maxJson).toBeLessThan(200_000);
    expect(st.season!.number).toBe(21);
    expect(checkUnlocks(st)).toEqual([]);
    void weekTick;
    void tickEvents;
  }, 240_000);
});
