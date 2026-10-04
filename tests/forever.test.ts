/**
 * The forever game (the owner: "i want it to be a forever game, just like terraria is a forever game and sims is a
 * forever game"): board objectives every season, the ground built part by part, the living squad (aging, retirement,
 * the academy, milestones, the Hall of Fame), club legacy and starting again as a legend, the Continental and World
 * Club Cups after the Elite League, the rival, and old saves loading with all of it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext, MatchRequest } from '../src/app';
import { defaultSave } from '../src/core/save';
import type { MatchResult } from '../src/game/matchSession';
import type { Match } from '../src/sim/match';
import { playMatchday } from '../src/ui/career';
import { careerState } from '../src/ui/club';
import {
  BOTTOM_DIVISION, MATCHDAYS, SQUAD_MAX, SQUAD_MIN, TOP_DIVISION, YOU, afterMatch, buildPart, compsDue, createClub, cupDue, finishSeason,
  matchReward, migrateCareer, newSeason, nextMatch, resolveCompTie, resolveCupTie, resolveMatchday, startAsLegend, startNextSeason, trainingCost,
  trainingDiscount, upgradeStadium, userFixture, type CareerState,
} from '../src/meta/career';
import { boardView, checkBoard, confidenceBudget, payBoard, setObjectives } from '../src/meta/board';
import { CONT_FINAL_AFTER, CONT_GROUP_AFTER, CONT_SF_AFTER, compFinish, groupTable } from '../src/meta/comps';
import { KIT_COLORS } from '../src/meta/data';
import { nextGoal } from '../src/meta/goal';
import { PARTS, canBuild, capacity, groundFromLevel, groundLevel, megastoreCoins, partView, type PartId } from '../src/meta/ground';
import { LEGACY_PERKS, canStartAsLegend, legacyLevel, legacyNeed } from '../src/meta/legacy';
import {
  academyIntake, bestProspectIndex, chemistry, decideRetirements, morale, promoteProspect, releaseProspect, type LifePlayer,
} from '../src/meta/life';
import { clubWageBudget, playerAge, wageBudget } from '../src/meta/market';
import { storyTag, takeMoment } from '../src/meta/story';
import type { Kit } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, division, 1);
  return st;
}

/** Whatever is next (a cup tie, a comp fixture or the league), with this score; level knockouts go to `my >= their`. */
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

function playSeason(st: CareerState, wallet: { coins: number }, my: number, their: number): void {
  for (let guard = 0; guard < 40 && !st.summary; guard++) playNext(st, wallet, my, their);
  expect(st.summary).not.toBeNull();
}

describe('board objectives', () => {
  it('sets three each season: the league, a cup, and one more; scaled to the club', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const st = career(seed);
      const objs = st.board.objectives;
      expect(objs).toHaveLength(3);
      expect(objs[0].kind).toBe('finish');
      expect(objs[1].kind).toBe('cup');
      expect(objs.every((o) => o.reward > 0 && o.state === 'open')).toBe(true);
      expect(st.board.season).toBe(1);
      // Readable on the hub: a label, a short chip and live progress for every one.
      for (const v of boardView(st)) {
        expect(v.label.length).toBeGreaterThan(4);
        expect(v.short.length).toBeGreaterThan(2);
        expect(v.progress.length).toBeGreaterThan(1);
      }
    }
    // Setting them twice in a season changes nothing.
    const st = career(9);
    const before = JSON.stringify(st.board);
    setObjectives(st);
    expect(JSON.stringify(st.board)).toBe(before);
  });

  it('a strong club is asked for more than a weak one', () => {
    const strong = career(11);
    for (const p of strong.club!.squad) for (const k of Object.keys(p.stats) as (keyof typeof p.stats)[]) p.stats[k] = 90;
    strong.board.season = 0;
    setObjectives(strong);
    const weak = career(11);
    for (const p of weak.club!.squad) for (const k of Object.keys(p.stats) as (keyof typeof p.stats)[]) p.stats[k] = 20;
    weak.board.season = 0;
    setObjectives(weak);
    expect(strong.board.objectives[0].target).toBeLessThan(weak.board.objectives[0].target);
    expect(strong.board.objectives[1].target).toBeGreaterThan(weak.board.objectives[1].target);
  });

  it('checks an objective off the moment it is met: coins owed (paid once, with the moment), confidence up', () => {
    const st = career(21);
    const wallet = { coins: 0 };
    // Force a clean-sheet objective we can meet.
    st.board.objectives[2] = { kind: 'cleanSheets', target: 2, reward: 150, state: 'open' };
    playNext(st, wallet, 1, 0);
    expect(st.board.objectives[2].state).toBe('open');
    playNext(st, wallet, 2, 0);
    expect(st.board.objectives[2].state).toBe('done');
    expect(st.board.owed).toBeGreaterThanOrEqual(150);
    expect(st.board.confidence).toBeGreaterThan(50);
    // The league's wallet is untouched until the hub pays it with the moment.
    const owed = st.board.owed;
    const coins = wallet.coins;
    expect(payBoard(st, wallet)).toBe(owed);
    expect(wallet.coins).toBe(coins + owed);
    expect(payBoard(st, wallet)).toBe(0);
    const moments = [];
    for (let m = takeMoment(st); m; m = takeMoment(st)) moments.push(m);
    expect(moments.some((m) => m.kind === 'board' && m.coins === 150)).toBe(true);
    // Checking again pays nothing twice.
    expect(checkBoard(st)).toEqual([]);
  });

  it('judges the league finish at the season end, and fails what is left', () => {
    const st = career(31);
    const wallet = { coins: 0 };
    playSeason(st, wallet, 4, 0);
    const finish = st.board.objectives.find((o) => o.kind === 'finish')!;
    expect(finish.state).toBe('done');
    expect(st.board.objectives.every((o) => o.state !== 'open')).toBe(true);
    const lost = career(32);
    playSeason(lost, { coins: 0 }, 0, 3);
    expect(lost.board.objectives.find((o) => o.kind === 'finish')!.state).toBe('failed');
    expect(lost.board.confidence).toBeLessThan(50);
    // Confidence moves the wage budget a little (never more than 10% either way).
    expect(confidenceBudget({ season: 1, objectives: [], confidence: 100, owed: 0 })).toBeCloseTo(1.1);
    expect(confidenceBudget({ season: 1, objectives: [], confidence: 0, owed: 0 })).toBeCloseTo(0.9);
    expect(clubWageBudget(lost)).toBeLessThan(wageBudget(BOTTOM_DIVISION, lost.stadium));
  });
});

describe('the ground, part by part', () => {
  it('old stadium levels are exactly the parts that made them', () => {
    for (let l = 0; l <= 5; l++) expect(groundLevel(groundFromLevel(l))).toBe(l);
    expect(capacity(groundFromLevel(0))).toBe(300);
    expect(capacity(groundFromLevel(1))).toBe(2500);
    expect(capacity(groundFromLevel(2))).toBe(6000);
    expect(capacity(groundFromLevel(3))).toBe(14000);
    expect(capacity(groundFromLevel(4))).toBe(26000);
    expect(capacity(groundFromLevel(5))).toBe(42000);
  });

  it('a part costs coins now and opens after its matchdays; one build at a time, never bought faster', () => {
    const st = career(41);
    const wallet = { coins: 10000 };
    expect(canBuild(st.ground, wallet.coins, 'near')).toEqual({ ok: false, reason: 'locked' });
    const r = buildPart(st, wallet, 'main');
    expect(r).toEqual({ ok: true, cost: 800, weeks: 1 });
    expect(wallet.coins).toBe(9200);
    expect(partView(st.ground, 'main').status).toBe('building');
    expect(buildPart(st, wallet, 'training')).toEqual({ ok: false, reason: 'busy' });
    expect(st.stadium).toBe(0);
    playNext(st, wallet, 1, 0);
    expect(st.ground.built.main).toBe(1);
    expect(st.stadium).toBe(1);
    expect(st.ground.opened).toContain('main');
    expect(st.story.moments.some((m) => m.kind === 'build')).toBe(true);
    // A two-week build is still going after one matchday.
    expect(buildPart(st, wallet, 'training').ok).toBe(true);
    playNext(st, wallet, 1, 0);
    expect(st.ground.built.training).toBe(1);
    expect(trainingDiscount(st)).toBeCloseTo(0.25);
    expect(trainingCost(st.club!.squad[0], trainingDiscount(st))).toBeLessThan(trainingCost(st.club!.squad[0]));
    expect(buildPart(st, wallet, 'academy')).toMatchObject({ ok: true, weeks: 2 });
    // (Builds move with league matchdays, not cup ties.)
    const md = st.season!.matchday;
    while (st.season!.matchday === md) playNext(st, wallet, 1, 0);
    expect(st.ground.building?.left).toBe(1);
    expect(buildPart({ ...st, ground: { built: {}, building: null, opened: [] } } as CareerState, { coins: 10 }, 'training')).toEqual({ ok: false, reason: 'no-coins' });
  });

  it('every part says what it needs, and the stand path reaches the dome', () => {
    const g = groundFromLevel(0);
    const order: PartId[] = ['main', 'near', 'lights', 'main', 'near', 'north', 'south', 'roof'];
    for (const id of order) {
      expect(partView(g, id).status, id).toBe('ready');
      g.built[id] = (g.built[id] ?? 0) + 1;
    }
    expect(groundLevel(g)).toBe(5);
    for (const p of PARTS) expect(p.steps.every((s) => s.cost > 0 && s.weeks >= 1 && s.weeks <= 2), p.id).toBe(true);
  });

  it('the old one-step upgrade still works and keeps the parts in step', () => {
    const st = career(42);
    const wallet = { coins: 1e6 };
    for (let i = 0; i < 5; i++) expect(upgradeStadium(st, wallet).ok).toBe(true);
    expect(groundLevel(st.ground)).toBe(5);
  });
});

describe('the living squad', () => {
  it('the old retire at the season end, legends go into the Hall of Fame, and the squad stays playable', () => {
    const st = career(51);
    const club = st.club!;
    // Three veterans: one a club legend.
    const vets = club.squad.slice(1, 4) as LifePlayer[];
    for (const p of vets) p.age = 37;
    vets[0].apps = 80;
    vets[0].goals = 12;
    playSeason(st, { coins: 0 }, 2, 1);
    const leaving = st.summary!.retiring ?? [];
    for (const p of vets) expect(leaving.some((f) => f.id === p.id)).toBe(true);
    expect(leaving.find((f) => f.id === vets[0].id)!.legend).toBe(true);
    // Deterministic: the same call decides the same.
    expect(decideRetirements(st).map((f) => f.id)).toEqual(leaving.map((f) => f.id));
    // Down to the minimum: the gaps are filled from youth.
    while (club.squad.length > SQUAD_MIN) club.squad.pop();
    startNextSeason(st);
    for (const p of vets) expect(club.squad.some((q) => q.id === p.id)).toBe(false);
    expect(club.squad.length).toBeGreaterThanOrEqual(SQUAD_MIN);
    expect(club.squad.filter((p) => p.role === 'GK').length).toBeGreaterThanOrEqual(2);
    expect(st.legacy.legends.some((l) => l.name === vets[0].name)).toBe(true);
    expect(st.tm.news.some((n) => /Farewell/.test(n.text))).toBe(true);
  });

  it('nobody under 33 retires', () => {
    const st = career(52);
    for (const p of st.club!.squad as LifePlayer[]) p.age = 30;
    st.season!.matchday = MATCHDAYS;
    expect(decideRetirements(st)).toEqual([]);
  });

  it('the academy brings two prospects a season (three with the building), from the second season', () => {
    const st = career(61);
    expect(st.academy.prospects).toHaveLength(0);
    playSeason(st, { coins: 0 }, 1, 0);
    startNextSeason(st);
    expect(st.academy.season).toBe(2);
    expect(st.academy.prospects).toHaveLength(2);
    for (const p of st.academy.prospects) {
      expect(playerAge(p)).toBeLessThanOrEqual(17);
      expect(p.academy).toBe(true);
    }
    // PROMOTE: into the squad with a new id; RELEASE: gone.
    const n = st.club!.squad.length;
    const best = bestProspectIndex(st);
    const name = st.academy.prospects[best].name;
    const r = promoteProspect(st, best);
    expect(r.ok).toBe(true);
    expect(st.club!.squad).toHaveLength(n + 1);
    expect(st.club!.squad.some((p) => p.name === name && /^c\d+$/.test(p.id) && (p as LifePlayer).joined === 2)).toBe(true);
    expect(st.academy.promoted).toBe(2);
    expect(releaseProspect(st, 0)).toBe(true);
    expect(st.academy.prospects).toHaveLength(0);
    // A full squad can't take one.
    st.academy.season = 0;
    st.ground.built.academy = 1;
    academyIntake(st);
    expect(st.academy.prospects).toHaveLength(3);
    while (st.club!.squad.length < SQUAD_MAX) st.club!.squad.push({ ...st.club!.squad[5], id: `x${st.club!.squad.length}` });
    expect(promoteProspect(st, 0)).toEqual({ ok: false, reason: 'squad-full' });
  });

  it('appearances, goals, milestones and the record book', () => {
    const st = career(71);
    const club = st.club!;
    const star = club.squad[9] as LifePlayer;
    star.goals = 9;
    afterMatch(st, { played: club.squad.slice(0, 11).map((p) => p.id), scorers: [star.id, star.id], my: 4, their: 0, vs: 'Rivals FC' });
    expect(star.goals).toBe(11);
    expect(club.squad[0] as LifePlayer).toMatchObject({ apps: 1 });
    expect(st.season!.scorers![star.id]).toEqual({ name: star.name, goals: 2 });
    expect(st.legacy.records.biggestWin).toMatchObject({ my: 4, their: 0, vs: 'Rivals FC' });
    expect(st.legacy.records.topScorer).toEqual({ name: star.name, goals: 11 });
    // 10 goals passed on the way: a milestone moment, once.
    expect(st.story.moments.some((m) => m.kind === 'milestone' && m.text.includes(star.name.toUpperCase()))).toBe(true);
    const n = st.story.moments.length;
    afterMatch(st, { played: [], scorers: [], my: 1, their: 0, vs: 'X' });
    expect(st.story.moments.length).toBe(n);
  });

  it('morale and chemistry are three words each', () => {
    expect(morale(['W', 'W', 'D'])).toBe(2);
    expect(morale(['L', 'L', 'D'])).toBe(0);
    expect(morale(['W', 'L', 'D'])).toBe(1);
    expect(morale([])).toBe(1);
    const st = career(81);
    expect(chemistry(st.club!, 1)).toBe(0);
    expect(chemistry(st.club!, 2)).toBe(1);
    expect(chemistry(st.club!, 3)).toBe(2);
  });
});

describe('legacy and starting again as a legend', () => {
  it('levels never run out, and the perks come with them', () => {
    expect(legacyNeed(1)).toBe(100);
    expect(legacyLevel(0).level).toBe(0);
    expect(legacyLevel(99).level).toBe(0);
    expect(legacyLevel(100).level).toBe(1);
    expect(legacyLevel(1e6).level).toBeGreaterThan(100);
    expect(LEGACY_PERKS.every((p, i) => i === 0 || p.level > LEGACY_PERKS[i - 1].level)).toBe(true);
  });

  it('a title season adds legacy (and its level-ups are moments)', () => {
    const st = career(91);
    playSeason(st, { coins: 0 }, 5, 0);
    expect(st.summary!.champion).toBe(true);
    expect(st.legacy.points).toBeGreaterThanOrEqual(100 + 60);
    expect(st.summary!.legacy).toBe(st.legacy.points);
    expect(st.legacy.log.length).toBeGreaterThan(0);
  });

  it('after an Elite League title, the club can be handed on: a new club starts with the legacy kept', () => {
    const st = career(101, TOP_DIVISION);
    expect(canStartAsLegend(st)).toBe(false);
    expect(startAsLegend(st)).toBe(false);
    playSeason(st, { coins: 0 }, 5, 0);
    expect(st.summary!.champion).toBe(true);
    expect(canStartAsLegend(st)).toBe(true);
    const points = st.legacy.points;
    const name = st.club!.name;
    expect(startAsLegend(st)).toBe(true);
    expect(st.club).toBeNull();
    expect(st.season).toBeNull();
    expect(st.history).toEqual([]);
    expect(st.stadium).toBe(0);
    expect(st.legacy.points).toBe(points);
    expect(st.legacy.gen).toBe(1);
    expect(st.legacy.past[0]).toMatchObject({ name, titles: 1, best: 1 });
  });
});

describe('the Continental Cup and the World Club Cup', () => {
  it('only the Elite League plays the Continental Cup', () => {
    expect(career(111).season!.continental).toBeUndefined();
    const st = career(112, TOP_DIVISION);
    const c = st.season!.continental!;
    expect(c.groups).toHaveLength(2);
    expect(c.groups[0]).toContain(YOU);
    expect(c.groups.flat()).toHaveLength(8);
    expect(c.fixtures.filter((f) => f.stage === 'group')).toHaveLength(12);
    expect(c.fixtures.filter((f) => f.home === YOU || f.away === YOU)).toHaveLength(3);
  });

  it('slots between league matchdays: three group games in the first half, the semi after 10, the final after 13', () => {
    const st = career(113, TOP_DIVISION);
    const wallet = { coins: 0 };
    const c = st.season!.continental!;
    expect(compsDue(st)).toBeNull();
    const seen: { md: number; comp: string }[] = [];
    for (let guard = 0; guard < 40 && !st.summary; guard++) {
      const nm = nextMatch(st)!;
      seen.push({ md: st.season!.matchday, comp: nm.competition });
      if (nm.competition === 'continental') {
        // The league waits for it.
        const s = st.season!;
        expect(resolveMatchday(st, wallet, s.matchday, 1, 0)).toBe(false);
      }
      playNext(st, wallet, 3, 0);
    }
    const cont = seen.filter((x) => x.comp === 'continental').map((x) => x.md);
    expect(cont).toEqual([...CONT_GROUP_AFTER, CONT_SF_AFTER, CONT_FINAL_AFTER]);
    expect(c.status).toBe('won');
    expect(compFinish(c)).toBe(3);
    expect(st.summary!.continental).toBe(3);
    expect(st.history[st.history.length - 1].continental).toBe(3);
    // Every group game was played, and the tables add up.
    expect(c.fixtures.every((f) => f.hg !== null)).toBe(true);
    for (const gi of [0, 1]) expect(groupTable(c, gi).reduce((s, r) => s + r.P, 0)).toBe(12);
  });

  it('losing every group game knocks you out, and the rest is settled with the calendar', () => {
    const st = career(114, TOP_DIVISION);
    playSeason(st, { coins: 0 }, 0, 2);
    const c = st.season!.continental!;
    expect(c.status).toBe('out');
    expect(compFinish(c)).toBe(0);
    expect(c.fixtures.every((f) => f.home !== '' && f.hg !== null)).toBe(true);
  });

  it('Elite champions (or continental winners) open the next season at the World Club Cup', () => {
    const st = career(115, TOP_DIVISION);
    const wallet = { coins: 0 };
    playSeason(st, wallet, 4, 0);
    expect(st.summary!.champion).toBe(true);
    expect(st.summary!.treble).toBe(true);
    expect(st.legacy.trebles).toBe(1);
    startNextSeason(st);
    const w = st.season!.world!;
    expect(w).toBeTruthy();
    // Both rounds come before the first league matchday.
    expect(nextMatch(st)!.competition).toBe('world');
    playNext(st, wallet, 2, 0);
    expect(nextMatch(st)!.competition).toBe('world');
    expect(nextMatch(st)!.neutral).toBe(true);
    playNext(st, wallet, 2, 0);
    expect(w.status).toBe('won');
    expect(nextMatch(st)!.competition).toBe('league');
  });
});

describe('the rival and the story', () => {
  it('a named rival is in your league every season and follows you up', () => {
    const st = career(121);
    const rival = st.story.rival!;
    expect(rival).toBeTruthy();
    expect(st.season!.rivals.some((r) => r.id === st.season!.derby && r.name === rival.name)).toBe(true);
    playSeason(st, { coins: 0 }, 3, 0);
    startNextSeason(st);
    expect(st.season!.division).toBe(BOTTOM_DIVISION - 1);
    const d = st.season!.rivals.find((r) => r.id === st.season!.derby)!;
    expect(d.name).toBe(rival.name);
    expect(st.season!.rivals.filter((r) => r.name === rival.name)).toHaveLength(1);
    // Both derbies (home and away) were played last season and counted.
    expect(rival.met).toBe(2);
    expect(st.tm.news.some((n) => n.story)).toBe(true);
  });

  it('the derby is tagged on the next match', () => {
    const st = career(122);
    const s = st.season!;
    for (let guard = 0; guard < 20; guard++) {
      const nm = nextMatch(st)!;
      if (nm.competition === 'league' && nm.rival.id === s.derby) {
        expect(storyTag(st, nm)?.tag).toBe('DERBY DAY');
        return;
      }
      playNext(st, { coins: 0 }, 1, 1);
    }
    throw new Error('no derby in the season');
  });

  it('NEXT GOAL always has something once there is a club', () => {
    expect(nextGoal(null, 0)).toBeNull();
    for (const seed of [131, 132, 133]) {
      const st = career(seed);
      const wallet = { coins: 0 };
      for (let i = 0; i < 6; i++) {
        const g = nextGoal(st, wallet.coins, { name: 'Galaxy', level: 12, xpLeft: 300 });
        expect(g).not.toBeNull();
        expect(g!.text.length).toBeGreaterThan(5);
        expect(g!.text).not.toMatch(/[·•●—–]/);
        playNext(st, wallet, 1, 0);
      }
    }
    // With coins for a part of the ground and nothing closer, it says build.
    const st = career(134);
    st.board.objectives = [];
    expect(nextGoal(st, 5000)?.go).toBe('stadium');
  });
});

describe('save migration', () => {
  it('a save from before the forever game loads: the ground from its level, the board set, nothing lost', () => {
    const st = career(141);
    playNext(st, { coins: 0 }, 2, 0);
    const raw = JSON.parse(JSON.stringify(st));
    for (const k of ['board', 'ground', 'academy', 'legacy', 'story']) delete raw[k];
    delete raw.season.derby;
    raw.stadium = 3;
    const back = migrateCareer(raw, 1);
    expect(back.club).toEqual(st.club);
    expect(back.season!.matchday).toBe(st.season!.matchday);
    expect(back.stadium).toBe(3);
    expect(groundLevel(back.ground)).toBe(3);
    expect(back.board.objectives).toHaveLength(3);
    expect(back.board.season).toBe(1);
    expect(back.legacy.points).toBe(0);
    expect(back.story.rival).toBeNull();
    // And it plays on.
    playNext(back, { coins: 0 }, 1, 0);
    expect(back.season!.matchday).toBe(st.season!.matchday + 1);
  });

  it('round-trips a deep career (Elite, comps, academy, legacy, rival, a build) through JSON unchanged', () => {
    const st = career(151, TOP_DIVISION);
    const wallet = { coins: 50000 };
    playSeason(st, wallet, 3, 0);
    startNextSeason(st);
    playNext(st, wallet, 2, 1);
    buildPart(st, wallet, 'training');
    afterMatch(st, { played: st.club!.squad.slice(0, 11).map((p) => p.id), scorers: [st.club!.squad[10].id], my: 2, their: 1, vs: 'Y' });
    expect(st.season!.world).toBeTruthy();
    expect(st.season!.continental).toBeTruthy();
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
  });

  it('garbage in the new fields falls back to defaults instead of breaking the career', () => {
    const st = career(161);
    const raw = JSON.parse(JSON.stringify(st));
    raw.board = { objectives: [{ kind: 'nope' }, 5], confidence: 'x' };
    raw.ground = { built: { main: 99, bogus: 3 }, building: { id: 'roof', level: 9, left: -4 } };
    raw.academy = { prospects: [{ id: 1 }], season: 'x' };
    raw.legacy = { points: -5, legends: [{}], past: 'no' };
    raw.story = { rival: { name: 3 }, moments: [{ kind: 'x' }], form: ['W', 'Q'] };
    raw.season.continental = { kind: 'continental', clubs: [], fixtures: [{ home: 'nobody' }] };
    const back = migrateCareer(raw, 1);
    expect(back.club).toEqual(st.club);
    expect(back.board.objectives).toEqual([]);
    expect(back.ground.built.main).toBe(2);
    expect(back.ground.building).toBeNull();
    expect(back.academy.prospects).toEqual([]);
    expect(back.legacy.points).toBe(0);
    expect(back.story.rival).toBeNull();
    expect(back.story.form).toEqual(['W']);
    expect(back.season!.continental).toBeNull();
    // The season still plays.
    playNext(back, { coins: 0 }, 1, 0);
  });
});

describe('a long career never runs dry', () => {
  it('twelve seasons: always a next match, a squad to pick, objectives, and the Elite League keeps its cups', () => {
    const st = career(171);
    const wallet = { coins: 0 };
    for (let season = 0; season < 12; season++) {
      expect(st.board.objectives.length).toBe(3);
      playSeason(st, wallet, 3, 1);
      startNextSeason(st);
      expect(st.club!.squad.length).toBeGreaterThanOrEqual(SQUAD_MIN);
      expect(st.club!.squad.length).toBeLessThanOrEqual(SQUAD_MAX);
      expect(st.club!.squad.some((p) => p.role === 'GK')).toBe(true);
      expect(nextMatch(st)).not.toBeNull();
      // Prospects promoted when there is room, like a player would.
      while (st.academy.prospects.length && promoteProspect(st, 0).ok);
    }
    expect(st.season!.division).toBe(TOP_DIVISION);
    expect(st.season!.continental).toBeTruthy();
    expect(st.legacy.points).toBeGreaterThan(1000);
    expect(finishSeason(st, wallet)).toBeNull();
    // (Twelve home and away seasons are over two hundred matches: a longer limit than a unit test's.)
  }, 60_000);
});

describe('the full-time wiring (ui/career.ts)', () => {
  function rig(seed = 181) {
    const save = defaultSave();
    const st0 = career(seed);
    save.career = st0;
    let req: MatchRequest | null = null;
    const app = {
      save,
      menus: null as unknown as AppContext['menus'],
      persist: vi.fn(),
      startMatch: (r: MatchRequest) => {
        req = r;
      },
      mainMenu: vi.fn(),
    } satisfies AppContext;
    return { app, st: careerState(app), started: () => req };
  }

  it('a home match is played at your ground as built, pays the megastore and records the scorers', () => {
    const { app, st, started } = rig();
    // Find a home league match.
    while (userFixture(st.season!, st.season!.matchday)!.home !== YOU || cupDue(st) >= 0) playNext(st, app.save, 1, 0);
    st.ground.built = { main: 1, store: 1, screen: 1 };
    st.stadium = 1;
    playMatchday(app, st);
    const req = started()!;
    expect(req.ground).toEqual({ main: 1, store: 1, screen: 1 });
    const scorer = st.club!.squad[9];
    const match = { goals: [{ side: 0, scorer: 9, name: scorer.name, minute: 10, own: false }], players: [] } as unknown as Match;
    const reward = req.reward({ score: [2, 0], humanSide: 0, match } as MatchResult);
    const base = matchReward(st.season!.division, 1, 2, 0).coins;
    expect(reward.coins).toBe(Math.round(base * 1.05) + megastoreCoins(st.season!.division));
    expect(reward.label).toMatch(/MEGASTORE/);
    expect((scorer as LifePlayer).goals).toBe(1);
    expect((st.club!.squad[0] as LifePlayer).apps).toBe(1);
  });
});
