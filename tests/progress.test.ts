import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHALLENGE_POOL, LEVEL_TITLES, MAX_LEVEL, advanceDaily, dailyChallenges, dailyFor, defaultProgress, defaultSave, levelOf, levelTitle,
  loadSave, matchStars, matchXp, nextStreak, normalizeProgress, normalizeSettings, streakMult, xpToNext, type MatchSummary, BALL_SKIN_LEVEL, LEGEND_STARS, legendUnlocked, nextUnlock, skinUnlocked, xpAt,
  BALL_SKIN_IDS, CELEBRATION_IDS, CELEBRATION_LEVEL, celebrationUnlocked, unlockLadder, momentStars, momentStarsTotal, momentXp, normalizeMoments, recordMoment } from '../src/core/save';

const KEY = 'blocky-league-save-v1';

function stubStorage(stored: unknown): void {
  const data = new Map<string, string>([[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

afterEach(() => vi.unstubAllGlobals());

const summary = (o: Partial<MatchSummary> = {}): MatchSummary => ({
  won: false, drawn: false, goals: 0, conceded: 0, assists: 0, tacklesWon: 0, passes: 0, skills: 0, headers: 0, longGoals: 0,
  powerups: 0, motm: false, blitz: false, difficulty: 1, ...o,
});

describe('XP and levels', () => {
  it('level thresholds grow: 100 for the first, then 160, 240, 340 ...', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(160);
    expect(xpToNext(3)).toBe(240);
    expect(xpToNext(4)).toBe(340);
    for (let l = 1; l < 40; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('levelOf turns total XP into a level and the progress into it', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelOf(99)).toEqual({ level: 1, into: 99, need: 100 });
    expect(levelOf(100)).toEqual({ level: 2, into: 0, need: 160 });
    expect(levelOf(100 + 160 + 50)).toEqual({ level: 3, into: 50, need: 240 });
    expect(levelOf(-5).level).toBe(1);
    expect(levelOf(1e9).level).toBe(MAX_LEVEL);
  });

  it('a match pays base XP, more for a win, goals, assists, tackles, skills, clean sheets and harder difficulty', () => {
    const loss = matchXp(summary({ conceded: 2 }));
    const draw = matchXp(summary({ drawn: true, goals: 1, conceded: 1 }));
    const win = matchXp(summary({ won: true, goals: 1 }));
    expect(loss).toBeGreaterThan(0);
    expect(draw).toBeGreaterThan(loss);
    expect(win).toBeGreaterThan(draw);
    expect(matchXp(summary({ won: true, goals: 3 }))).toBeGreaterThan(win);
    expect(matchXp(summary({ won: true, goals: 1, assists: 2 }))).toBeGreaterThan(win);
    expect(matchXp(summary({ won: true, goals: 1, tacklesWon: 5 }))).toBeGreaterThan(win);
    expect(matchXp(summary({ won: true, goals: 1, skills: 3 }))).toBeGreaterThan(win);
    expect(matchXp(summary({ won: true, goals: 1, conceded: 1 }))).toBeLessThan(win);
    expect(matchXp(summary({ won: true, goals: 1, difficulty: 3 }))).toBeGreaterThan(win);
    expect(matchXp(summary({ won: true, goals: 1, difficulty: 0 }))).toBeLessThan(win);
    // A 0-0 loss can't happen, but a goalless defeat gets no clean-sheet bonus.
    expect(matchXp(summary({ conceded: 0 }))).toBe(matchXp(summary({ conceded: 3 })));
  });

  it('titles climb from Rookie to Blocky Legend, and none reads like a division name', () => {
    expect(levelTitle(1)).toBe('Rookie');
    expect(levelTitle(2)).toBe('Rookie');
    for (const e of LEVEL_TITLES) expect(e.title).not.toMatch(/sunday|park|district|county|national|league|championship|elite/i);
    expect(levelTitle(5)).toBe('Rising Star');
    expect(levelTitle(30)).toBe('Blocky Legend');
    expect(levelTitle(99)).toBe('Blocky Legend');
    for (let i = 1; i < LEVEL_TITLES.length; i++) expect(LEVEL_TITLES[i].level).toBeGreaterThan(LEVEL_TITLES[i - 1].level);
  });
});

describe('win streaks', () => {
  it('multiply coins by 1.1 per win up to 2x', () => {
    expect(streakMult(0)).toBe(1);
    expect(streakMult(1)).toBe(1.1);
    expect(streakMult(3)).toBe(1.3);
    expect(streakMult(10)).toBe(2);
    expect(streakMult(50)).toBe(2);
  });

  it('a win extends, a draw keeps, a loss resets', () => {
    expect(nextStreak(2, true, false)).toBe(3);
    expect(nextStreak(2, false, true)).toBe(2);
    expect(nextStreak(2, false, false)).toBe(0);
  });
});

describe('match stars', () => {
  it('one for playing, two for a win, three for a win with two of margin, clean sheet and man of the match', () => {
    expect(matchStars({ won: false, goals: 0, conceded: 3, motm: false })).toBe(1);
    expect(matchStars({ won: false, goals: 2, conceded: 2, motm: true })).toBe(1);
    expect(matchStars({ won: true, goals: 2, conceded: 1, motm: false })).toBe(2);
    expect(matchStars({ won: true, goals: 1, conceded: 0, motm: false })).toBe(2);
    expect(matchStars({ won: true, goals: 3, conceded: 0, motm: false })).toBe(3);
    expect(matchStars({ won: true, goals: 1, conceded: 0, motm: true })).toBe(3);
    expect(matchStars({ won: true, goals: 4, conceded: 2, motm: true })).toBe(3);
  });
});

describe('daily challenges', () => {
  it('are three distinct ones, the same for a date every time, and differ between dates', () => {
    const a = dailyChallenges('2026-09-26');
    const b = dailyChallenges('2026-09-26');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const keys = new Set(days.map((d) => dailyChallenges(d).map((c) => c.id).join(',')));
    expect(keys.size).toBeGreaterThan(20);
    for (const c of a) expect(CHALLENGE_POOL).toContain(c);
  });

  it('never draws two Blitz-only challenges on one day', () => {
    for (let i = 1; i <= 200; i++) {
      const cs = dailyChallenges(`2027-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`);
      expect(cs.filter((c) => c.kind === 'blitzWins' || c.kind === 'powerups').length).toBeLessThanOrEqual(1);
    }
  });

  it('roll over with the date, clearing progress and marking the day fresh', () => {
    const p = defaultProgress();
    const d1 = dailyFor(p, '2026-09-26');
    d1.progress[0] = 5;
    d1.fresh = false;
    expect(dailyFor(p, '2026-09-26')).toBe(d1);
    const d2 = dailyFor(p, '2026-09-27');
    expect(d2.day).toBe('2026-09-27');
    expect(d2.progress).toEqual([0, 0, 0]);
    expect(d2.fresh).toBe(true);
  });

  it('track match events, pay once when done, and treat a hat-trick as a single-match target', () => {
    const cs = [CHALLENGE_POOL.find((c) => c.id === 'goals2')!, CHALLENGE_POOL.find((c) => c.id === 'goals3')!, CHALLENGE_POOL.find((c) => c.id === 'headers2')!];
    const d = dailyFor(defaultProgress(), '2026-09-26');
    let done = advanceDaily(d, cs, summary({ won: true, goals: 1, headers: 1 }));
    expect(done).toEqual([]);
    expect(d.progress).toEqual([1, 1, 1]);
    expect(d.fresh).toBe(false);
    done = advanceDaily(d, cs, summary({ won: true, goals: 2, headers: 1 }));
    expect(done.map((x) => x.index)).toEqual([0, 2]);
    expect(done[0].challenge.coins).toBe(120);
    expect(d.progress).toEqual([2, 2, 2]);
    expect(d.claimed).toEqual([true, false, true]);
    // Already paid: not again. The hat-trick needs three in one match, not three over the day.
    done = advanceDaily(d, cs, summary({ won: true, goals: 2 }));
    expect(done).toEqual([]);
    expect(d.progress[1]).toBe(2);
    done = advanceDaily(d, cs, summary({ goals: 3, conceded: 4 }));
    expect(done.map((x) => x.index)).toEqual([1]);
  });

  it('count blitz wins, clean-sheet wins, hard wins and power-ups only when they apply', () => {
    const by = (id: string) => CHALLENGE_POOL.find((c) => c.id === id)!;
    const cs = [by('blitzWin'), by('cleanWin'), by('hardWin')];
    const d = dailyFor(defaultProgress(), '2026-09-26');
    advanceDaily(d, cs, summary({ won: true, goals: 1, conceded: 1, difficulty: 1 }));
    expect(d.progress).toEqual([0, 0, 0]);
    advanceDaily(d, cs, summary({ won: true, goals: 1, conceded: 0, difficulty: 2, blitz: true }));
    expect(d.progress).toEqual([1, 1, 1]);
  });
});

describe('save migration', () => {
  it('an old save without progress starts at level 1 with no streak and keeps its coins', () => {
    const old = defaultSave() as unknown as Record<string, unknown>;
    delete old.progress;
    const settings = { ...(old.settings as object) } as Record<string, unknown>;
    delete settings.lastMode;
    stubStorage({ ...old, coins: 777, settings });
    const d = loadSave();
    expect(d.coins).toBe(777);
    expect(d.progress).toEqual(defaultProgress());
    expect(levelOf(d.progress.xp).level).toBe(1);
    expect(d.settings.lastMode).toBe('classic');
  });

  it('damaged progress fields fall back to defaults; good ones are kept', () => {
    const p = normalizeProgress({ xp: 350, streak: 2, bestStreak: 1, stars: 'many', daily: { day: '2026-09-25', progress: [1, 'x'], claimed: [true] } });
    expect(p.xp).toBe(350);
    expect(p.streak).toBe(2);
    expect(p.bestStreak).toBe(2);
    expect(p.stars).toBe(0);
    expect(p.daily).toEqual({ day: '2026-09-25', progress: [1, 0, 0], claimed: [true, false, false], fresh: true });
    expect(normalizeProgress('garbage')).toEqual(defaultProgress());
    expect(normalizeProgress({ xp: -40 }).xp).toBe(0);
  });

  it('the remembered quick-match mode survives saving and unknown values become classic', () => {
    const s = defaultSave();
    s.settings.lastMode = 'blitz';
    stubStorage(s);
    expect(loadSave().settings.lastMode).toBe('blitz');
    expect(normalizeSettings({ lastMode: 'turbo' }).lastMode).toBe('classic');
  });
});

describe('unlock ladder (earned only)', () => {
  it('ball looks open by level, the classic one always', () => {
    expect(skinUnlocked('classic', 1)).toBe(true);
    expect(skinUnlocked('retro', 1)).toBe(false);
    expect(skinUnlocked('retro', BALL_SKIN_LEVEL.retro)).toBe(true);
    expect(skinUnlocked('gold', BALL_SKIN_LEVEL.gold - 1)).toBe(false);
    // The ladder climbs in list order, one ball a level at most, the Diamond last at 30 (14 looks: the later ones
    // fill the levels past the last celebration, so a long career keeps earning something).
    for (let i = 1; i < BALL_SKIN_IDS.length; i++) expect(BALL_SKIN_LEVEL[BALL_SKIN_IDS[i]]).toBeGreaterThan(BALL_SKIN_LEVEL[BALL_SKIN_IDS[i - 1]]);
    expect(BALL_SKIN_IDS[BALL_SKIN_IDS.length - 1]).toBe('diamond');
    expect(BALL_SKIN_LEVEL.diamond).toBe(30);
    expect(BALL_SKIN_IDS.filter((id) => BALL_SKIN_LEVEL[id] > CELEBRATION_LEVEL.pile).length).toBeGreaterThanOrEqual(5);
  });
  it('xpAt is the running total of the per-level needs', () => {
    expect(xpAt(1)).toBe(0);
    expect(xpAt(2)).toBe(xpToNext(1));
    expect(xpAt(4)).toBe(xpToNext(1) + xpToNext(2) + xpToNext(3));
  });
  it('celebrations open by level, the classic one always', () => {
    expect(celebrationUnlocked('classic', 1)).toBe(true);
    expect(celebrationUnlocked('knee', CELEBRATION_LEVEL.knee - 1)).toBe(false);
    expect(celebrationUnlocked('knee', CELEBRATION_LEVEL.knee)).toBe(true);
    expect(celebrationUnlocked('pile', CELEBRATION_LEVEL.pile - 1)).toBe(false);
    for (const id of CELEBRATION_IDS) expect(CELEBRATION_LEVEL[id]).toBeGreaterThanOrEqual(1);
  });
  it('the ladder holds every ball look and celebration in level order, balls first on a shared level', () => {
    const ladder = unlockLadder();
    expect(ladder.length).toBe(BALL_SKIN_IDS.length + CELEBRATION_IDS.length);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i].level).toBeGreaterThanOrEqual(ladder[i - 1].level);
    expect(ladder[0]).toMatchObject({ kind: 'ball', id: 'classic', level: 1 });
    expect(ladder[1]).toMatchObject({ kind: 'celebration', id: 'classic', level: 1 });
    expect(ladder.find((u) => u.id === 'knee')?.name).toBe('Knee slide celebration');
    expect(ladder.find((u) => u.id === 'retro')?.name).toBe('Retro ball');
  });
  it('nextUnlock names whichever of the two ladders comes first above the level, counts the XP left, then runs out', () => {
    // Level 1: the retro ball (level 2) comes before the knee slide (level 3).
    const n0 = nextUnlock(0)!;
    expect(n0).toMatchObject({ kind: 'ball', id: 'retro', level: BALL_SKIN_LEVEL.retro });
    expect(n0.xpLeft).toBe(xpAt(BALL_SKIN_LEVEL.retro));
    // At level 2 the knee slide (3) is nearer than the blaze ball (4): the earliest next level wins.
    const atRetro = nextUnlock(xpAt(BALL_SKIN_LEVEL.retro))!;
    expect(atRetro).toMatchObject({ kind: 'celebration', id: 'knee', level: CELEBRATION_LEVEL.knee });
    expect(atRetro.xpLeft).toBe(xpAt(CELEBRATION_LEVEL.knee) - xpAt(BALL_SKIN_LEVEL.retro));
    const atKnee = nextUnlock(xpAt(CELEBRATION_LEVEL.knee))!;
    expect(atKnee).toMatchObject({ kind: 'ball', id: 'blaze' });
    // Past the gold ball there are still celebrations to earn; past the last of everything, nothing.
    expect(nextUnlock(xpAt(BALL_SKIN_LEVEL.gold))?.kind).toBe('celebration');
    const top = Math.max(...Object.values(BALL_SKIN_LEVEL), ...Object.values(CELEBRATION_LEVEL));
    expect(nextUnlock(xpAt(top))).toBeNull();
  });
  it('LEGEND opens at the star count', () => {
    expect(legendUnlocked({ stars: LEGEND_STARS - 1 })).toBe(false);
    expect(legendUnlocked({ stars: LEGEND_STARS })).toBe(true);
  });
});

describe('football moments (best stars by id)', () => {
  it('a new save has no moment stars; recordMoment keeps only the best and says when it improved', () => {
    const d = defaultSave();
    expect(d.moments).toEqual({});
    expect(momentStars(d, 'cross')).toBe(0);
    expect(recordMoment(d, 'cross', 2)).toBe(true);
    expect(recordMoment(d, 'cross', 1)).toBe(false);
    expect(recordMoment(d, 'cross', 2)).toBe(false);
    expect(recordMoment(d, 'cross', 3)).toBe(true);
    expect(momentStars(d, 'cross')).toBe(3);
    // A failed attempt (0 stars) is still remembered as tried.
    expect(recordMoment(d, 'onevone', 0)).toBe(true);
    expect(d.moments).toEqual({ cross: 3, onevone: 0 });
    expect(momentStarsTotal(d)).toBe(3);
  });

  it('pays XP for the try and per star, never coins: 30, 55, 80, 105', () => {
    expect([0, 1, 2, 3].map(momentXp)).toEqual([30, 55, 80, 105]);
    expect(momentXp(9)).toBe(105);
    expect(momentXp(-2)).toBe(30);
  });

  it('normalizeMoments keeps sane stars, clamps to 0..3 and drops anything else', () => {
    expect(normalizeMoments(undefined)).toEqual({});
    expect(normalizeMoments('x')).toEqual({});
    expect(normalizeMoments([1, 2])).toEqual({});
    expect(normalizeMoments({ a: 2, b: 7, c: -1, d: 1.9, e: 'two', f: NaN, '': 3 })).toEqual({ a: 2, b: 3, c: 0, d: 1 });
  });

  it('an old save without moments loads with an empty ladder; damaged stars are dropped, good ones kept', () => {
    const old = defaultSave() as unknown as Record<string, unknown>;
    delete old.moments;
    stubStorage(old);
    expect(loadSave().moments).toEqual({});
    const s2 = defaultSave();
    s2.moments = { cross: 2, bad: 'no' as unknown as number };
    stubStorage(s2);
    expect(loadSave().moments).toEqual({ cross: 2 });
  });
});
