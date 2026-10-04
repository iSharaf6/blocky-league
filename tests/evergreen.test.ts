import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave, exportSave, importSave } from '../src/core/save';
import { addGems, gems, PASS_GEMS, SEASON_GEMS, sumGems } from '../src/meta/gems';
import { activatePass, buyPassWithGems, buySignatureSet, claimAllPass, passActive, signatureSets, syncSeasonGems } from '../src/meta/pass';
import { claimAllSeason, journeyList, normalizeSeason, passItemId, seasonAdvance, seasonOf, seasonTitles, selectJourney, tierXp } from '../src/meta/season';
import { BOTTOM_DIVISION, createClub, divisionLevel, matchCoins, migrateCareer, newSeason, nextMatch, resolveCupTie, resolveMatchday, seasonOutcome, startAsLegend, startNextSeason, type CareerState } from '../src/meta/career';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { MASTERY_THRESHOLDS, MASTERY_TRACKS, claimMastery, earnedTitles, masteryLook, recordMatchMeta, syncMasteryRewards, wearTitle, wornTitleDetails, type MasteryMatch } from '../src/meta/mastery';
import { owns, seasonPassItems, shopItem } from '../src/meta/shop';
import { beforeMatchBeats } from '../src/meta/story';

const OCT = new Date(2026, 9, 12, 12), FUTURE = new Date(2099, 4, 5, 12);
const NONE: MasteryMatch = { goals: 0, assists: 0, passes: 0, tackles: 0, cleanSheet: false, skills: 0, saves: 0 };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(OCT); });
afterEach(() => { vi.useRealTimers(); });

function career(division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, 173), team = makeTeam(PRESET_CLUBS[5]);
  st.club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: team.kit, formation: '4-4-2' }, 173);
  newSeason(st, division, 1);
  return st;
}

function playLeague(st: CareerState, wallet: { coins: number }, my = 4, their = 0): void {
  for (let guard = 0; guard < 5; guard++) {
    const next = nextMatch(st)!;
    expect(next).not.toBeNull();
    if (next.competition === 'cup') { expect(resolveCupTie(st, my, their, my >= their)).not.toBeNull(); continue; }
    expect(next.competition).toBe('league');
    expect(resolveMatchday(st, wallet, next.md!, next.userHome ? my : their, next.userHome ? their : my)).toBe(true);
    return;
  }
  throw new Error('The next league match was never reached');
}

describe('permanent Journey save and economy', () => {
  it('lists the same six actual identity pieces for every permanent and legacy receipt ID', () => {
    for (let i = 1; i <= 12; i++) {
      const suffix = String(i).padStart(2, '0');
      const permanent = seasonPassItems(`journey-${suffix}`);
      expect(permanent).toEqual(seasonPassItems(`2025-${suffix}`));
      expect(Object.values(permanent).map(it => it.id)).toEqual([
        `pass${suffix}`, `pass${suffix}`, `pass${suffix}`, `pass${suffix}`, `netpass${suffix}`, `kickpass${suffix}`,
      ]);
    }
  });

  it('migrates a paid legacy track and its original receipts without repaying gems or losing old carry', () => {
    const save = defaultSave();
    save.season = normalizeSeason({ id: '2025-09', xp: tierXp(30), claimed: [10, 20, 30], pass: true,
      passClaimed: [3, 8, 13, 18, 23, 28], carry: { id: '2025-08', coins: 150 }, carryGems: 25,
      carryItems: ['kit:pass08'], titles: ['Training Camp Legend'] }, FUTURE);
    save.gems!.balance = 400;
    save.gems!.claimed.push(...[10, 20, 30].map(t => `season:2025-09:f${t}`), ...[3, 8, 13, 18, 23, 28].map(t => `season:2025-09:p${t}`));
    save.iap!.applied.push('old-paid-pass-receipt');
    save.shop!.tokens = 13;
    const loaded = importSave(exportSave(save))!;
    expect(loaded.season!.id).toBe('2025-09');
    expect(passActive(loaded, FUTURE)).toBe(true);
    expect(syncSeasonGems(loaded)).toBe(25);
    expect(syncSeasonGems(loaded)).toBe(0);
    expect(gems(loaded)).toBe(425);
    expect(selectJourney(loaded.season!, 'pass04')).toBe(true);
    seasonAdvance(loaded.season!, 250, FUTURE);
    loaded.coins += claimAllSeason(loaded.season!);
    expect(syncSeasonGems(loaded)).toBe(0);
    const secondLoad = importSave(exportSave(loaded))!;
    expect(selectJourney(secondLoad.season!, 'pass09')).toBe(true);
    expect(secondLoad.season).toMatchObject({ id: '2025-09', xp: tierXp(30), pass: true, claimed: [10, 20, 30], passClaimed: [3, 8, 13, 18, 23, 28] });
    expect(syncSeasonGems(secondLoad)).toBe(0);
    expect(secondLoad.iap!.applied).toContain('old-paid-pass-receipt');
    expect(secondLoad.shop!.tokens).toBe(13);
    const paid = claimAllSeason(secondLoad.season!);
    expect(paid).toBeGreaterThan(150);
    expect(claimAllSeason(secondLoad.season!)).toBe(0);
    expect(seasonTitles(secondLoad.season!)).toContain('Training Camp Legend');
  });

  it('completes all twelve shipped tracks once, with independent XP and free/paid claims after real reloads', () => {
    let save = defaultSave();
    let paidCoins = 0, paidGems = 0;
    for (const set of signatureSets()) {
      selectJourney(seasonOf(save), set.id);
      expect(activatePass(save, OCT)).toBe(true);
      expect(activatePass(save, FUTURE)).toBe(false);
      expect(seasonAdvance(save.season!, tierXp(30), FUTURE)).toHaveLength(30);
      const free = claimAllSeason(save.season!);
      const premium = claimAllPass(save);
      expect(premium.coins).toBe(5560);
      paidCoins += free + premium.coins;
      save.coins += free + premium.coins;
      paidGems += syncSeasonGems(save);
      expect(claimAllSeason(save.season!)).toBe(0);
      expect(claimAllPass(save).coins).toBe(0);
      expect(syncSeasonGems(save)).toBe(0);
      save = importSave(exportSave(save))!;
    }
    expect(journeyList(save.season!).every(j => j.tier === 30 && j.pass)).toBe(true);
    expect(save.coins).toBe(500 + paidCoins);
    expect(paidGems).toBe(12 * (sumGems(PASS_GEMS) + sumGems(SEASON_GEMS)));
    expect(seasonTitles(save.season!)).toHaveLength(72);
    for (const set of signatureSets()) {
      selectJourney(save.season!, set.id);
      expect(passItemId(save.season!.id)).toBe(set.id);
      expect(claimAllSeason(save.season!)).toBe(0);
      expect(claimAllPass(save).coins).toBe(0);
      expect(syncSeasonGems(save)).toBe(0);
      expect(set.items.every(it => owns(save, it.cat, it.id))).toBe(true);
    }
  });

  it('applies a late store purchase to its captured Journey and prevents gem upgrades during a pending charge', () => {
    const save = defaultSave();
    save.season = normalizeSeason({ id: '2026-09', xp: 700, claimed: [1] });
    const target = save.season.id;
    save.iap!.pendingPass = target;
    selectJourney(save.season, 'pass03');
    addGems(save, 600, 'weekly');
    const before = exportSave(save);
    expect(buyPassWithGems(save)).toEqual({ ok: false, reason: 'pending', short: 0 });
    expect(exportSave(save)).toBe(before);
    const reload = importSave(exportSave(save))!;
    expect(activatePass(reload, FUTURE, target)).toBe(true);
    expect(reload.season).toMatchObject({ id: 'journey-03', pass: false, xp: 0 });
    expect(reload.season!.journeys!.pass09).toMatchObject({ id: '2026-09', pass: true, xp: 700, claimed: [1] });
    expect(owns(reload, 'decor', 'kickpass09')).toBe(true);
    expect(activatePass(reload, FUTURE, target)).toBe(false);
    const saved = exportSave(reload);
    expect(activatePass(reload, FUTURE, 'garbage')).toBe(false);
    expect(exportSave(reload)).toBe(saved);
  });

  it('offers the selected identity immediately for guaranteed gems without changing Journey XP or pass claims', () => {
    const save = defaultSave();
    addGems(save, 600, 'weekly');
    const track = JSON.stringify(save.season);
    expect(buySignatureSet(save, passItemId(save.season!.id), OCT).ok).toBe(true);
    expect(JSON.stringify(save.season)).toBe(track);
    expect(save.season!.pass).toBe(false);
  });

  it('rejects unknown, prototype and theme-mismatched saved Journeys without minting claims', () => {
    const season = normalizeSeason(JSON.parse('{"id":"2026-09","xp":500,"journeys":{"pass01":{"id":"journey-02","xp":4200,"pass":true},"pass99":{"id":"journey-01","xp":4200},"__proto__":{"id":"journey-01","xp":4200},"pass09":{"id":"journey-09","xp":4200}}}'));
    expect(season.xp).toBe(500);
    expect(season.journeys).toBeUndefined();
    expect(journeyList(season).filter(j => j.tier > 0)).toHaveLength(1);
    expect(selectJourney(season, '__proto__')).toBe(false);
  });
});

describe('longer climb and earned prestige', () => {
  it('adds two lower leagues while importing old clubs without moving ranks, squads or fixtures', () => {
    expect(BOTTOM_DIVISION).toBe(8);
    expect([1, 2, 3, 4, 5, 6].map(divisionLevel)).toEqual([88, 79, 70, 60, 51, 42]);
    expect(divisionLevel(7)).toBeLessThan(divisionLevel(6));
    expect(divisionLevel(8)).toBeLessThan(divisionLevel(7));
    for (const division of [1, 4, 6]) {
      const st = career(division);
      const loaded = migrateCareer(JSON.parse(JSON.stringify(st)), 999);
      expect(loaded.season!.division).toBe(division);
      expect(loaded.season!.fixtures).toEqual(st.season!.fixtures);
      expect(loaded.club!.squad).toEqual(st.club!.squad);
    }
    expect(matchCoins(6, 0, 2, 1)).toBe(150);
    expect(matchCoins(1, 0, 0, 0)).toBe(144);
    expect(seasonOutcome(8, 8)).toEqual({ outcome: 'stayed', nextDivision: 8 });
    expect(seasonOutcome(8, 6)).toEqual({ outcome: 'relegated', nextDivision: 7 });
  });

  it('plays the seven-season climb from Park League to Elite through real league and cup settlement', () => {
    const st = career(), wallet = { coins: 100000 };
    for (let division = 8; division >= 2; division--) {
      expect(st.season!.division).toBe(division);
      for (let md = 0; md < 14; md++) playLeague(st, wallet, 9, 0);
      expect(st.summary).toMatchObject({ champion: true, outcome: 'promoted', nextDivision: division - 1 });
      const oldCoins = wallet.coins;
      expect(resolveMatchday(st, wallet, 13, 9, 0)).toBe(false);
      expect(wallet.coins).toBe(oldCoins);
      startNextSeason(st);
    }
    expect(st.season).toMatchObject({ division: 1, number: 8, matchday: 0 });
    expect(st.history).toHaveLength(7);
  });

  it('keeps old paid mastery claims and unlocks earned cosmetic looks plus meaningful eight-tier titles', () => {
    const save = defaultSave();
    for (const track of MASTERY_TRACKS) {
      save.mastery!.counts[track] = MASTERY_THRESHOLDS[track][4];
      save.mastery!.claimed[track] = 5;
      expect(masteryLook(track, 5)).toBeDefined();
      expect(shopItem(masteryLook(track, 5)!.cat, masteryLook(track, 5)!.id)).toBeDefined();
    }
    const wallet = save.coins;
    expect(claimMastery(save.mastery!).coins).toBe(0);
    expect(syncMasteryRewards(save)).toHaveLength(5);
    expect(syncMasteryRewards(save)).toEqual([]);
    expect(save.coins).toBe(wallet);
    recordMatchMeta(save, { ...NONE, goals: 295 }, 100);
    expect(wearTitle(save, 'Immortal Finisher')).toBe(true);
    expect(wornTitleDetails(save)).toMatchObject({ title: 'Immortal Finisher', from: 'FINISHER VIII', tier: 8, reward: { cat: 'goalfx', id: 'supernova' } });
    expect(owns(save, 'goalfx', 'supernova')).toBe(true);
    expect(claimMastery(save.mastery!, 'finisher').coins).toBe(900 + 1400 + 2200);
    const loaded = importSave(exportSave(save))!;
    expect(claimMastery(loaded.mastery!).coins).toBe(0);
    expect(wornTitleDetails(loaded)?.title).toBe('Immortal Finisher');
  });

  it('archives career honours so a new club or rolling history cannot erase an earned title', () => {
    const save = defaultSave(), st = career(1);
    st.history.push({ season: 1, division: 2, position: 1, outcome: 'promoted', cup: 3, continental: 3, world: 3 });
    st.legacy.trebles = 1;
    save.career = st;
    recordMatchMeta(save, NONE, 0);
    expect(earnedTitles(save).map(t => t.title)).toContain('World Club Legend');
    expect(wearTitle(save, 'Treble Master')).toBe(true);
    save.career = career(8);
    const reload = importSave(exportSave(save))!;
    expect(wornTitleDetails(reload)).toMatchObject({ title: 'Treble Master', from: 'ROAD TO GLORY', tier: 8 });
  });

  it('preserves imported old career honours when starting as a legend before playing another match', () => {
    const old = defaultSave(), st = career(1);
    st.history.push(
      { season: 1, division: 2, position: 1, outcome: 'promoted', cup: 3, continental: 3, world: 3 },
      { season: 2, division: 1, position: 1, outcome: 'stayed', cup: 3, continental: 3, world: 3 },
    );
    old.career = st;
    delete old.mastery!.honours; // The old build had no persistent prestige field.
    const raw = exportSave(old);
    for (const selectTitle of [true, false]) {
      const save = importSave(raw)!;
      const imported = migrateCareer(save.career, 1);
      save.career = imported;
      const titles = earnedTitles(save).filter(t => t.from === 'ROAD TO GLORY').map(t => t.title).sort();
      expect(titles).toContain('World Club Legend');
      expect(titles).toContain('Promotion Pioneer');
      expect(save.mastery!.honours).toBeUndefined();
      if (selectTitle) expect(wearTitle(save, 'World Club Legend')).toBe(true);
      expect(startAsLegend(imported, save.mastery)).toBe(true);
      expect(imported.history).toEqual([]);
      expect(imported.club).toBeNull();
      const reload = importSave(exportSave(save))!;
      expect(earnedTitles(reload).filter(t => t.from === 'ROAD TO GLORY').map(t => t.title).sort()).toEqual(titles);
      if (selectTitle) expect(wornTitleDetails(reload)?.title).toBe('World Club Legend');
      expect(reload.coins).toBe(old.coins);
      expect(reload.gems).toEqual(old.gems);
      expect(reload.season).toEqual(old.season);
    }
  });

  it('generates varied stable match news from real results, without replaying headlines on reload or preview', () => {
    const a = career(), b = career(), walletA = { coins: 10000 }, walletB = { coins: 10000 };
    for (let md = 0; md < 4; md++) {
      playLeague(a, walletA, 2, 0);
      playLeague(b, walletB, 2, 0);
    }
    expect(a.tm.news.map(n => n.text)).toEqual(b.tm.news.map(n => n.text));
    const headlines = a.events.timeline.filter(n => /Pixel Park FC/.test(n.text)).map(n => n.text);
    expect(new Set(headlines).size).toBeGreaterThan(4);
    expect(headlines.some(n => /three (?:straight wins|in a row)/i.test(n))).toBe(true);
    const loaded = migrateCareer(JSON.parse(JSON.stringify(a)), 1);
    beforeMatchBeats(loaded, nextMatch(loaded));
    const once = JSON.stringify(loaded.tm.news);
    beforeMatchBeats(loaded, nextMatch(loaded));
    expect(JSON.stringify(loaded.tm.news)).toBe(once);
    expect(resolveMatchday(loaded, walletA, 0, 2, 0)).toBe(false);
    expect(JSON.stringify(loaded.tm.news)).toBe(once);
  });
});
