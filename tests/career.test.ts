import { describe, expect, it } from 'vitest';
import {
  BOTTOM_DIVISION, CAREER_VERSION, CLUBS_PER_DIVISION, HALF_SEASON, MARKET_SIZE, MATCHDAYS, SQUAD_MAX, SQUAD_MIN, STADIUM_MAX, STAT_CAP, YOU,
  autoPick, buyPlayer, canBuy, canSell, clubTeam, computeTable, createClub, cupDue, deriveShort, divisionLevel, divisionPlayerOverall,
  finishSeason, forfeitScore, resolveCupTie,
  leagueTable, lineupIssues, matchAttendance, matchCoins, matchDifficulty, migrateCareer, newSeason, nextMatch, playerPrice,
  refreshMarket, resolveMatchday, sanitizeName, sanitizeShort, seasonOutcome, seasonPrizeLines, sellPlayer, sellValue, setFormation,
  stadiumUpgradeCost, startNextSeason, swapPlayers, trainPlayer, trainingCost, upgradeStadium, userFixture,
  type CareerState, type Fixture,
} from '../src/meta/career';
import { dedupeSurnames, KIT_COLORS, makePlayer, makeTeam, PRESET_CLUBS, randomClubSeed, surnameOf, uniqueName } from '../src/meta/data';
import { defaultMarket, playerValue, quickSaleValue } from '../src/meta/market';
import { defaultBoard } from '../src/meta/board';
import { defaultGround } from '../src/meta/ground';
import { defaultAcademy } from '../src/meta/life';
import { defaultLegacy } from '../src/meta/legacy';
import { defaultStory } from '../src/meta/story';
import { defaultStaff } from '../src/meta/staff';
import { defaultEvents } from '../src/meta/events';
import { Rng } from '../src/core/rng';
import { FORMATIONS } from '../src/sim/formations';
import { overall, type Kit } from '../src/sim/types';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function freshCareer(seed = 7, division = BOTTOM_DIVISION): CareerState {
  const st = migrateCareer(null, seed);
  st.club = createClub({ name: 'Test Town', short: 'TST', kit: KIT, formation: '4-4-2' }, seed);
  newSeason(st, division, 1);
  return st;
}

/**
 * Play the player's match for the current matchday with the given goals-for / goals-against. A BLOCKY CUP tie due
 * first (the league waits for it) is played with the same score, through on penalties if level.
 */
function playMine(st: CareerState, wallet: { coins: number }, my: number, their: number): boolean {
  if (cupDue(st) >= 0) resolveCupTie(st, my, their, my >= their);
  const s = st.season!;
  const f = userFixture(s, s.matchday);
  const home = f ? f.home === YOU : true;
  return resolveMatchday(st, wallet, s.matchday, home ? my : their, home ? their : my);
}

describe('squad names', () => {
  it('no two players in a generated squad (XI and bench) share a surname', () => {
    const seeds = [...PRESET_CLUBS];
    const rng = new Rng(99);
    for (let i = 0; i < 80; i++) seeds.push(randomClubSeed(rng, 40 + (i % 50)));
    for (const seed of seeds) {
      const t = makeTeam(seed);
      const names = [...t.players, ...(t.bench ?? [])].map((p) => surnameOf(p.name));
      expect(names.length).toBe(16);
      expect(new Set(names).size).toBe(names.length);
    }
    // Still deterministic per club.
    expect(JSON.stringify(makeTeam(PRESET_CLUBS[3]))).toBe(JSON.stringify(makeTeam(PRESET_CLUBS[3])));
  });

  it('uniqueName skips surnames already used (and records the one it picks), with or without an rng', () => {
    const used = new Set<string>(['Pebble', 'Novak']);
    const rng = new Rng(5);
    for (let i = 0; i < 40; i++) {
      const n = uniqueName(used, rng);
      expect(n).toMatch(/^[A-Z]\. /);
      expect(used.has(surnameOf(n))).toBe(true);
    }
    expect(used.size).toBe(42);
    const a = new Set(['Stone']);
    const b = new Set(['Stone']);
    expect(uniqueName(a)).toBe(uniqueName(b));
    // Past the whole list (240-odd surnames) it numbers the repeats rather than repeating.
    const all = new Set<string>();
    for (let i = 0; i < 300; i++) uniqueName(all, rng);
    expect(all.size).toBe(300);
    expect([...all].some((n) => / \d+$/.test(n))).toBe(true);
    expect(surnameOf('A. Pebble')).toBe('Pebble');
  });

  it('no fixture between two preset clubs has a surname twice (they share one pool)', () => {
    const squads = PRESET_CLUBS.map((c) => {
      const t = makeTeam(c);
      return [...t.players, ...(t.bench ?? [])].map((p) => surnameOf(p.name));
    });
    const seen = new Map<string, number>();
    squads.forEach((names, i) => {
      for (const n of names) {
        expect(seen.get(n), `${n} in ${PRESET_CLUBS[i].name} and ${PRESET_CLUBS[seen.get(n) ?? 0].name}`).toBeUndefined();
        seen.set(n, i);
      }
    });
    // (No numbered repeats needed for that, and still deterministic whatever order clubs are built in.)
    expect([...seen.keys()].every((n) => !/\d/.test(n))).toBe(true);
    const a = JSON.stringify(makeTeam(PRESET_CLUBS[7]));
    makeTeam(PRESET_CLUBS[2]);
    expect(JSON.stringify(makeTeam(PRESET_CLUBS[7]))).toBe(a);
    // The preset squads' stats are what they always were (only clashing names changed).
    const plain = makeTeam({ ...PRESET_CLUBS[4] }, PRESET_CLUBS[4].short, []);
    expect(makeTeam(PRESET_CLUBS[4]).players.map((p) => p.stats)).toEqual(plain.players.map((p) => p.stats));
  });

  it('a new career club, the transfer market and every career fixture keep surnames unique', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-3-3' }, seed);
      const names = c.squad.map((p) => surnameOf(p.name));
      expect(new Set(names).size).toBe(names.length);
    }
    for (const seed of [3, 9, 21, 44]) {
      const st = freshCareer(seed);
      const squad = new Set(st.club!.squad.map((p) => surnameOf(p.name)));
      refreshMarket(st);
      const market = st.market.map((p) => surnameOf(p.name));
      expect(new Set(market).size).toBe(market.length);
      for (const n of market) expect(squad.has(n)).toBe(false);
      // Every matchday's fixture: nobody on either side shares a surname with anyone on the other.
      const wallet = { coins: 0 };
      for (let md = 0; md < MATCHDAYS; md++) {
        const nm = nextMatch(st);
        if (!nm) break;
        const all = [nm.home, nm.away].flatMap((t) => [...t.players, ...(t.bench ?? [])].map((p) => surnameOf(p.name)));
        expect(new Set(all).size).toBe(all.length);
        // (The user's own players are never renamed.)
        const mine = nm.userHome ? nm.home : nm.away;
        expect(mine.players.map((p) => p.name)).toEqual(st.club!.squad.slice(0, 11).map((p) => p.name));
        playMine(st, wallet, 1, 1);
      }
    }
    // (Four whole home and away seasons: a longer limit than a unit test's.)
  }, 30_000);

  it('dedupeSurnames renames the clashing players of one side, deterministically, keeping their initials', () => {
    const a = makeTeam(PRESET_CLUBS[3]);
    const b = makeTeam(randomClubSeed(new Rng(5), 60));
    // Force clashes: three of b's players take surnames from a.
    b.players[2].name = `Q. ${surnameOf(a.players[4].name)}`;
    b.players[5].name = `Z. ${surnameOf(a.players[7].name)}`;
    b.bench![1].name = `Q. ${surnameOf(a.bench![0].name)}`;
    const b2 = JSON.parse(JSON.stringify(b));
    const aNames = [...a.players, ...(a.bench ?? [])].map((p) => p.name);
    expect(dedupeSurnames(a, b)).toBeGreaterThanOrEqual(3);
    expect([...a.players, ...(a.bench ?? [])].map((p) => p.name)).toEqual(aNames);
    const all = [a, b].flatMap((t) => [...t.players, ...(t.bench ?? [])].map((p) => surnameOf(p.name)));
    expect(new Set(all).size).toBe(all.length);
    expect(b.players[2].name.startsWith('Q. ')).toBe(true);
    expect(b.players[5].name.startsWith('Z. ')).toBe(true);
    dedupeSurnames(a, b2);
    expect(b2).toEqual(b);
    expect(dedupeSurnames(a, b)).toBe(0);
  });
});

describe('club creation', () => {
  it('builds a 16-man squad (1 GK, 5 DF, 6 MF, 4 FW) with unique ids and shirt numbers', () => {
    const c = createClub({ name: 'Pixel Park FC', short: 'pix', kit: KIT, formation: '4-3-3' }, 42);
    expect(c.squad).toHaveLength(16);
    const count = (r: string) => c.squad.filter((p) => p.role === r).length;
    expect([count('GK'), count('DF'), count('MF'), count('FW')]).toEqual([1, 5, 6, 4]);
    expect(new Set(c.squad.map((p) => p.number)).size).toBe(16);
    expect(new Set(c.squad.map((p) => p.id)).size).toBe(16);
    expect(c.short).toBe('PIX');
    expect(c.kit.gk).not.toBe(0);
    const avg = c.squad.reduce((s, p) => s + overall(p), 0) / c.squad.length;
    expect(avg).toBeGreaterThan(40);
    expect(avg).toBeLessThan(58);
  });

  it('auto-picks an XI whose roles match every formation slot', () => {
    const c = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 3);
    for (const f of ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2'] as const) {
      setFormation(c, f);
      autoPick(c);
      expect(lineupIssues(c)).toEqual([]);
      expect(clubTeam(c).players).toHaveLength(11);
      FORMATIONS[f].forEach((slot, i) => expect(c.squad[i].role).toBe(slot.role));
    }
  });

  it('flags out-of-position starters after a swap', () => {
    const c = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 3);
    const benchFw = c.squad.findIndex((p, i) => i >= 11 && p.role === 'FW');
    expect(swapPlayers(c, 1, benchFw)).toBe(true);
    expect(lineupIssues(c)).toEqual([1]);
    expect(swapPlayers(c, 1, 1)).toBe(false);
    expect(swapPlayers(c, 1, 99)).toBe(false);
  });

  it('sanitises names and short codes', () => {
    expect(sanitizeName('  <b>Rovers</b>   of   Town  ')).toBe('bRoversb of Town');
    expect(sanitizeName('A'.repeat(40))).toHaveLength(18);
    expect(sanitizeShort('ab-c1')).toBe('ABC');
    expect(deriveShort('Pixel Park FC')).toBe('PIX');
    expect(deriveShort('Al')).toBe('ALX');
    expect(deriveShort('A B C')).toBe('ABC');
  });
});

describe('season generation', () => {
  it('has 14 matchdays of 4 fixtures: home and away, you face each rival twice, once at each ground', () => {
    const st = freshCareer(11);
    const s = st.season!;
    expect(MATCHDAYS).toBe(14);
    expect(HALF_SEASON).toBe(7);
    expect(s.rivals).toHaveLength(CLUBS_PER_DIVISION - 1);
    expect(s.fixtures).toHaveLength(56);
    const mine: Fixture[] = [];
    for (let md = 0; md < MATCHDAYS; md++) {
      const day = s.fixtures.filter((f) => f.md === md);
      expect(day).toHaveLength(4);
      const teams = day.flatMap((f) => [f.home, f.away]);
      expect(new Set(teams).size).toBe(8);
      const f = userFixture(s, md)!;
      mine.push(f);
      // The first half alternates from a home game; the second half is the same fixtures at the other ground.
      expect(f.home === YOU).toBe(md < HALF_SEASON ? md % 2 === 0 : (md - HALF_SEASON) % 2 === 1);
    }
    for (const half of [mine.slice(0, HALF_SEASON), mine.slice(HALF_SEASON)]) {
      const opponents = half.map((f) => (f.home === YOU ? f.away : f.home));
      expect(new Set(opponents)).toEqual(new Set(s.rivals.map((r) => r.id)));
    }
    // Seven at home, seven away.
    expect(mine.filter((f) => f.home === YOU)).toHaveLength(HALF_SEASON);
  });

  it('every pair of clubs meets exactly twice, once at each ground', () => {
    const s = freshCareer(99).season!;
    const pairs = new Set(s.fixtures.map((f) => [f.home, f.away].sort().join('|')));
    expect(pairs.size).toBe(28);
    const legs = new Set(s.fixtures.map((f) => `${f.home}|${f.away}`));
    expect(legs.size).toBe(56);
  });

  it('rivals sit within ±5 of the division level, are unique, and are deterministic from the seed', () => {
    for (let div = 1; div <= 6; div++) {
      const s = freshCareer(5, div).season!;
      const lvl = divisionLevel(div);
      for (const r of s.rivals) {
        expect(Math.abs(r.level - lvl)).toBeLessThanOrEqual(5);
        expect(r.rating).toBeGreaterThan(20);
      }
      expect(new Set(s.rivals.map((r) => r.short)).size).toBe(7);
      expect(s.rivals.map((r) => r.short)).not.toContain('TST');
    }
    expect(freshCareer(5).season!.rivals.map((r) => r.name)).toEqual(freshCareer(5).season!.rivals.map((r) => r.name));
    expect(divisionLevel(6)).toBe(42);
    expect(divisionLevel(1)).toBe(88);
  });

  it('builds the next match with the home side keeping its kit', () => {
    const st = freshCareer(21);
    const nm = nextMatch(st)!;
    expect(nm.md).toBe(0);
    expect(nm.userHome).toBe(true);
    expect(nm.home.players).toHaveLength(11);
    expect(nm.away.players).toHaveLength(11);
    expect(nm.kits[0]).toEqual(nm.home.kit);
  });
});

describe('league table', () => {
  const clubs = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Hotel'].map((n) => ({ id: n[0].toLowerCase(), name: n }));
  const fx = (home: string, away: string, hg: number | null, ag: number | null): Fixture => ({ md: 0, home, away, hg, ag });

  it('counts P W D L GF GA GD PTS and ignores unplayed fixtures', () => {
    const t = computeTable(clubs, [fx('a', 'b', 2, 1), fx('c', 'd', 1, 1), fx('e', 'h', null, null)]);
    const row = (id: string) => t.find((r) => r.id === id)!;
    expect(row('a')).toMatchObject({ P: 1, W: 1, D: 0, L: 0, GF: 2, GA: 1, GD: 1, PTS: 3 });
    expect(row('b')).toMatchObject({ P: 1, W: 0, D: 0, L: 1, GF: 1, GA: 2, GD: -1, PTS: 0 });
    expect(row('c')).toMatchObject({ P: 1, D: 1, PTS: 1 });
    expect(row('e')).toMatchObject({ P: 0, PTS: 0 });
  });

  it('orders by PTS, then GD, then GF, then name', () => {
    const t = computeTable(clubs, [
      fx('h', 'e', 1, 0), fx('e', 'h', 0, 1), // Hotel: 6 pts, GD +2
      fx('a', 'e', 3, 0), // Alpha: 3 pts, GD +3
      fx('c', 'e', 3, 1), // Charlie: 3 pts, GD +2, GF 3
      fx('e', 'd', 0, 2), // Delta: 3 pts, GD +2, GF 2
      fx('b', 'e', 2, 0), // Bravo: 3 pts, GD +2, GF 2 (beats Delta on name)
    ]);
    expect(t.map((r) => r.name)).toEqual(['Hotel', 'Alpha', 'Charlie', 'Bravo', 'Delta', 'Echo']);
    expect(t[5]).toMatchObject({ P: 6, L: 6, GF: 1, GA: 12, GD: -11, PTS: 0 });
  });
});

describe('matchday flow', () => {
  it('records your result, simulates the other three fixtures (0-4 goals) and moves on', () => {
    const st = freshCareer(8);
    const wallet = { coins: 0 };
    const market0 = st.market.map((p) => p.id);
    expect(playMine(st, wallet, 2, 1)).toBe(true);
    const s = st.season!;
    expect(s.matchday).toBe(1);
    const day = s.fixtures.filter((f) => f.md === 0);
    for (const f of day) {
      expect(f.hg).not.toBeNull();
      expect(f.hg!).toBeGreaterThanOrEqual(0);
      expect(f.hg!).toBeLessThanOrEqual(4);
      expect(f.ag!).toBeLessThanOrEqual(4);
    }
    expect(s.fixtures.filter((f) => f.md > 0).every((f) => f.hg === null)).toBe(true);
    const me = leagueTable(st).find((r) => r.id === YOU)!;
    expect(me).toMatchObject({ P: 1, W: 1, GF: 2, GA: 1, PTS: 3 });
    expect(leagueTable(st).every((r) => r.P === 1)).toBe(true);
    // Free agents stay on the market for two to four weeks, so the list has turned over after four.
    for (let i = 0; i < 3; i++) playMine(st, wallet, 1, 1);
    expect(st.market.map((p) => p.id)).not.toEqual(market0);
    expect(st.market.map((p) => p.id).some((id) => market0.includes(id))).toBe(false);
  });

  it('refuses stale or repeated results', () => {
    const st = freshCareer(8);
    const wallet = { coins: 0 };
    expect(resolveMatchday(st, wallet, 3, 1, 0)).toBe(false);
    expect(playMine(st, wallet, 1, 0)).toBe(true);
    expect(resolveMatchday(st, wallet, 0, 5, 0)).toBe(false);
    expect(st.season!.matchday).toBe(1);
  });

  it('a forfeit counts as a 3-0 defeat', () => {
    const st = freshCareer(8);
    const f = userFixture(st.season!, 0)!;
    const [hg, ag] = forfeitScore(f.home === YOU);
    expect(resolveMatchday(st, { coins: 0 }, 0, hg, ag, true)).toBe(true);
    expect(f.forfeit).toBe(true);
    expect(leagueTable(st).find((r) => r.id === YOU)).toMatchObject({ L: 1, GF: 0, GA: 3, PTS: 0 });
  });

  it('a perfect season wins the league, pays the prize exactly once and promotes', () => {
    const st = freshCareer(13);
    const wallet = { coins: 0 };
    for (let i = 0; i < MATCHDAYS; i++) expect(playMine(st, wallet, 9, 0)).toBe(true);
    expect(st.season!.matchday).toBe(MATCHDAYS);
    expect(leagueTable(st).every((r) => r.P === MATCHDAYS)).toBe(true);
    const sum = st.summary!;
    expect(sum).toMatchObject({ position: 1, outcome: 'promoted', champion: true, nextDivision: BOTTOM_DIVISION - 1 });
    expect(sum.prize).toBe(7 * 20 + 600 + 300);
    expect(wallet.coins).toBe(sum.prize);
    expect(finishSeason(st, wallet)).toBe(sum);
    expect(wallet.coins).toBe(sum.prize);
    expect(playMine(st, wallet, 1, 0)).toBe(false);
    expect(nextMatch(st)).toBeNull();
    const oldRivals = st.season!.rivals.map((r) => r.name).join();
    startNextSeason(st);
    expect(st.summary).toBeNull();
    expect(st.season).toMatchObject({ number: 2, division: BOTTOM_DIVISION - 1, matchday: 0 });
    expect(st.season!.rivals.map((r) => r.name).join()).not.toBe(oldRivals);
    // (Every cup tie won 9-0 as well: the BLOCKY CUP went in the cabinet too.)
    expect(st.history).toEqual([{ season: 1, division: BOTTOM_DIVISION, position: 1, outcome: 'promoted', cup: 3 }]);
  });

  it('losing every game at the bottom division keeps you in division 8', () => {
    const st = freshCareer(17);
    const wallet = { coins: 0 };
    for (let i = 0; i < MATCHDAYS; i++) playMine(st, wallet, 0, 9);
    expect(st.summary).toMatchObject({ position: 8, outcome: 'stayed', nextDivision: BOTTOM_DIVISION, prize: 0 });
  });
});

describe('promotion and relegation', () => {
  it('moves the top two up and the bottom two down within bounds', () => {
    expect(seasonOutcome(1, 6)).toEqual({ outcome: 'promoted', nextDivision: 5 });
    expect(seasonOutcome(2, 3)).toEqual({ outcome: 'promoted', nextDivision: 2 });
    expect(seasonOutcome(3, 3)).toEqual({ outcome: 'stayed', nextDivision: 3 });
    expect(seasonOutcome(6, 3)).toEqual({ outcome: 'stayed', nextDivision: 3 });
    expect(seasonOutcome(7, 3)).toEqual({ outcome: 'relegated', nextDivision: 4 });
    expect(seasonOutcome(8, 1)).toEqual({ outcome: 'relegated', nextDivision: 2 });
    expect(seasonOutcome(1, 1)).toEqual({ outcome: 'stayed', nextDivision: 1 });
    expect(seasonOutcome(8, BOTTOM_DIVISION)).toEqual({ outcome: 'stayed', nextDivision: BOTTOM_DIVISION });
  });

  it('pays promotion, top-two and champion prizes by division', () => {
    const total = (p: number, d: number) => seasonPrizeLines(p, d).reduce((s, l) => s + l.coins, 0);
    expect(total(1, 6)).toBe(140 + 600 + 300);
    expect(total(2, 4)).toBe(6 * 40 + 600 + 500);
    expect(seasonPrizeLines(1, 1).map((l) => l.label)).toEqual(['LEAGUE POSITION', 'TOP TWO PRIZE', 'CHAMPIONS BONUS']);
    expect(total(8, 6)).toBe(0);
  });
});

describe('transfers', () => {
  it('lists 4 free agents rated around the division level at round(ovr² x 0.25 / 10) x 10', () => {
    for (let div = 1; div <= 6; div++) {
      const st = freshCareer(31, div);
      for (let md = 0; md < 5; md++) {
        expect(st.market).toHaveLength(MARKET_SIZE);
        for (const p of st.market) {
          expect(Math.abs(overall(p) - divisionPlayerOverall(div, p.role))).toBeLessThanOrEqual(6);
          expect(playerPrice(p)).toBe(Math.round((overall(p) ** 2 * 0.25) / 10) * 10);
        }
        playMine(st, { coins: 0 }, 1, 1);
      }
    }
  });

  it('buying a free agent needs enough coins and a squad under SQUAD_MAX', () => {
    const st = freshCareer(4);
    const price = playerPrice(st.market[0]);
    expect(canBuy(st, price - 1, 0)).toEqual({ ok: false, reason: 'no-coins' });
    const wallet = { coins: price + 5 };
    const r = buyPlayer(st, wallet, 0);
    expect(r.ok).toBe(true);
    expect(wallet.coins).toBe(5);
    expect(st.club!.squad).toHaveLength(17);
    expect(st.market).toHaveLength(MARKET_SIZE - 1);
    const numbers = st.club!.squad.map((p) => p.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(new Set(st.club!.squad.map((p) => p.id)).size).toBe(17);
    const rich = { coins: 1e9 };
    while (st.club!.squad.length < SQUAD_MAX) st.club!.squad.push(makePlayer(new Rng(st.club!.squad.length), 'MF', 40, 60 + st.club!.squad.length, `x${st.club!.squad.length}`));
    expect(canBuy(st, rich.coins, 0)).toEqual({ ok: false, reason: 'squad-full' });
    expect(buyPlayer(st, rich, 0).ok).toBe(false);
    expect(rich.coins).toBe(1e9);
    expect(canBuy(st, rich.coins, 42)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('a quick sale pays 45% of value, keeps 14 players and at least one keeper', () => {
    const st = freshCareer(4);
    const club = st.club!;
    const gk = club.squad.find((p) => p.role === 'GK')!;
    expect(canSell(st, gk.id)).toEqual({ ok: false, reason: 'last-gk' });
    const starter = club.squad[5];
    const wallet = { coins: 0 };
    const r = sellPlayer(st, wallet, starter.id);
    expect(r).toEqual({ ok: true, delta: sellValue(starter) });
    expect(sellValue(starter)).toBe(quickSaleValue(starter));
    expect(sellValue(starter)).toBe(Math.round((playerValue(starter) * 0.45) / 10) * 10);
    expect(playerValue(starter)).toBeGreaterThan(playerPrice(starter) * 0.5);
    expect(wallet.coins).toBe(sellValue(starter));
    expect(club.squad).toHaveLength(15);
    expect(club.squad.some((p) => p.id === starter.id)).toBe(false);
    expect(club.squad[5].role).toBe(FORMATIONS[club.formation][5].role);
    sellPlayer(st, wallet, club.squad[12].id);
    expect(club.squad).toHaveLength(SQUAD_MIN);
    expect(canSell(st, club.squad[12].id)).toEqual({ ok: false, reason: 'min-squad' });
  });
});

describe('training, stadium and match economy', () => {
  it('training costs 40 + 3 x OVR for +2 and caps at 99', () => {
    const st = freshCareer(2);
    const p = st.club!.squad[9];
    const cost = trainingCost(p);
    expect(cost).toBe(40 + overall(p) * 3);
    const wallet = { coins: cost };
    const before = p.stats.shooting;
    expect(trainPlayer(st.club!, wallet, p.id, 'shooting')).toEqual({ ok: true, delta: -cost });
    expect(p.stats.shooting).toBe(Math.min(STAT_CAP, before + 2));
    expect(wallet.coins).toBe(0);
    expect(trainPlayer(st.club!, wallet, p.id, 'shooting')).toEqual({ ok: false, reason: 'no-coins' });
    p.stats.pace = 98;
    trainPlayer(st.club!, { coins: 1e6 }, p.id, 'pace');
    expect(p.stats.pace).toBe(99);
    expect(trainPlayer(st.club!, { coins: 1e6 }, p.id, 'pace')).toEqual({ ok: false, reason: 'maxed' });
  });

  it('stadium upgrades cost 800 x (level+1)^1.6 and stop at level 5', () => {
    expect(stadiumUpgradeCost(0)).toBe(800);
    expect(stadiumUpgradeCost(1)).toBe(Math.round((800 * 2 ** 1.6) / 10) * 10);
    const st = freshCareer(2);
    const wallet = { coins: 1e6 };
    for (let i = 0; i < STADIUM_MAX; i++) expect(upgradeStadium(st, wallet).ok).toBe(true);
    expect(st.stadium).toBe(5);
    expect(upgradeStadium(st, wallet)).toEqual({ ok: false, reason: 'maxed' });
    expect(upgradeStadium(freshCareer(2), { coins: 799 })).toEqual({ ok: false, reason: 'no-coins' });
  });

  it('maps divisions to difficulty, stadium to crowd, and results to coins', () => {
    // (The bottom divisions are NORMAL, not EASY: the rivals' ratings are the division's difficulty.)
    expect([8, 7, 6, 5, 4, 3, 2, 1].map(matchDifficulty)).toEqual([1, 1, 1, 1, 1, 1, 2, 3]);
    expect(matchAttendance(0)).toBeCloseTo(0.35);
    expect(matchAttendance(5)).toBe(0.95);
    expect(matchCoins(6, 0, 2, 1)).toBe(120 + 30);
    expect(matchCoins(1, 0, 0, 0)).toBe(Math.round(320 * 0.45));
    expect(matchCoins(6, 0, 0, 3)).toBe(24);
    expect(matchCoins(6, 2, 1, 0)).toBe(Math.round(135 * 1.2));
  });
});

describe('save migration', () => {
  it('turns a null career into safe defaults', () => {
    const st = migrateCareer(null, 1234);
    expect(st).toEqual({
      version: CAREER_VERSION, seed: 1234, club: null, season: null, summary: null, market: [], marketKey: '', tm: defaultMarket(), stadium: 0, history: [], notice: null,
      // The forever game (board, ground, academy, legacy, story): empty to start.
      board: defaultBoard(), ground: defaultGround(), academy: defaultAcademy(), legacy: defaultLegacy(), story: defaultStory(),
      // The long game (staff, event cards and the timeline): empty to start.
      staff: defaultStaff(), events: defaultEvents(),
    });
  });

  it('survives garbage and clamps bad values', () => {
    expect(migrateCareer('nope', 1).club).toBeNull();
    expect(migrateCareer([1, 2], 1).version).toBe(CAREER_VERSION);
    const st = migrateCareer({ version: 1, seed: 9, stadium: 42, club: { name: 'x' }, history: [{ outcome: 'bogus' }] }, 1);
    expect(st).toMatchObject({ seed: 9, stadium: STADIUM_MAX, club: null, season: null, history: [] });
  });

  it('round-trips a mid-season career through JSON unchanged', () => {
    const st = freshCareer(77);
    st.stadium = 2;
    st.notice = 'hello';
    playMine(st, { coins: 0 }, 3, 2);
    const back = migrateCareer(JSON.parse(JSON.stringify(st)), 1);
    expect(back).toEqual(st);
  });

  it('drops a corrupt season but keeps the club', () => {
    const st = freshCareer(77);
    const raw = JSON.parse(JSON.stringify(st));
    raw.season.fixtures = raw.season.fixtures.slice(0, 5);
    const back = migrateCareer(raw, 1);
    expect(back.club).toEqual(st.club);
    expect(back.season).toBeNull();
    expect(back.market).toEqual([]);
  });
});
