import { describe, expect, it } from 'vitest';
import { BOTTOM_DIVISION, MATCHDAYS, YOU, createClub, cupDue, migrateCareer, newSeason, refreshMarket, resolveCupTie, resolveMatchday, userFixture,
  type CareerState } from '../src/meta/career';
import { KIT_COLORS } from '../src/meta/data';
import { markNewsSeen, marketUnread, placeBid, scoutListing, toggleShortlist, type NewsItem } from '../src/meta/market';
import { defaultCrest } from '../src/core/crest';
import type { Kit } from '../src/sim/types';
import { clubPreviewHtml } from '../src/ui/club';
import { transfersTiming } from '../src/ui/hubInfo';
import { marketNewsHtml } from '../src/ui/market';

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };
function career(): CareerState {
  const st = migrateCareer(null, 173);
  st.club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 173);
  newSeason(st, BOTTOM_DIVISION, 1);
  return st;
}
function play(st: CareerState, wallet: { coins: number }): void {
  if (cupDue(st) >= 0) resolveCupTie(st, 1, 1, true);
  const s = st.season!;
  const f = userFixture(s, s.matchday)!;
  const [home, away] = f.home === YOU ? [2, 1] : [1, 2];
  expect(resolveMatchday(st, wallet, s.matchday, home, away)).toBe(true);
}

describe('transfer refresh cadence survives reopen and reload', () => {
  it('keeps scouted players, offers, shortlist and coins stable on revisits, then refreshes exactly once per league matchday', () => {
    const st = career();
    const wallet = { coins: 8000 };
    const youth = st.tm.listings.find((l) => l.youth)!;
    expect(scoutListing(st, wallet, youth.id).ok).toBe(true);
    expect(toggleShortlist(st, youth.id).ok).toBe(true);
    const target = st.tm.listings.find((l) => l.club && !l.hot)!;
    const offer = Math.round(target.asking * 1.1 / 10) * 10;
    expect(placeBid(st, wallet, target.id, offer).ok).toBe(true);
    const savedMarket = JSON.stringify(st.tm);
    const savedCoins = wallet.coins;
    const reloaded = migrateCareer(JSON.parse(JSON.stringify(st)), st.seed);
    const reloadedWallet = { coins: savedCoins };
    for (let visit = 0; visit < 5; visit++) {
      refreshMarket(st, wallet);
      refreshMarket(reloaded, reloadedWallet);
      expect(JSON.stringify(st.tm)).toBe(savedMarket);
      expect(JSON.stringify(reloaded.tm)).toBe(savedMarket);
      expect(wallet.coins).toBe(savedCoins);
      expect(reloadedWallet.coins).toBe(savedCoins);
      expect(st.tm.listings.find((l) => l.id === youth.id)?.scouted).toBe(true);
      expect(st.tm.shortlist).toContain(youth.id);
      expect(st.tm.bids[0]).toMatchObject({ listingId: target.id, amount: offer, status: 'pending' });
    }
    const original = new Set(st.tm.listings.map((l) => l.id));
    for (let matchday = 1; matchday <= 4; matchday++) {
      play(st, wallet);
      play(reloaded, reloadedWallet);
      expect(st.tm.key).toBe(`1:${matchday}`);
      expect(reloaded.tm).toEqual(st.tm);
      expect(reloadedWallet.coins).toBe(wallet.coins);
      const current = JSON.stringify(st.tm);
      const coins = wallet.coins;
      refreshMarket(st, wallet);
      expect(JSON.stringify(st.tm)).toBe(current);
      expect(wallet.coins).toBe(coins);
    }
    expect(st.tm.listings.some((l) => original.has(l.id))).toBe(false);
    expect(st.club!.squad.some((p) => p.name === target.player.name)).toBe(true);
  });

  it('explains opening, closing, mid-season and season-end timing using league matchdays', () => {
    const st = career();
    expect(transfersTiming(null)).toBeNull();
    expect(transfersTiming(st)).toMatchObject({ updated: 'SEASON OPENING MARKET',
      window: 'WINDOW OPEN FOR 3 MORE LEAGUE MATCHDAYS', next: 'NEXT REFRESH AFTER LEAGUE MATCHDAY 1' });
    for (const [week, window] of [
      [2, 'WINDOW CLOSES AFTER THIS LEAGUE MATCHDAY'], [3, 'WINDOW OPENS IN 4 LEAGUE MATCHDAYS'],
      [6, 'WINDOW OPENS AFTER THIS LEAGUE MATCHDAY'], [7, 'WINDOW OPEN FOR 2 MORE LEAGUE MATCHDAYS'],
      [8, 'WINDOW CLOSES AFTER THIS LEAGUE MATCHDAY'], [9, 'WINDOW CLOSED UNTIL NEXT SEASON'],
    ] as const) {
      st.season!.matchday = week;
      const before = JSON.stringify(st);
      expect(transfersTiming(st)?.window).toBe(window);
      expect(transfersTiming(st)?.updated).toBe(`UPDATED AFTER MATCHDAY ${week}`);
      expect(transfersTiming(st)?.next).toBe(`NEXT REFRESH AFTER LEAGUE MATCHDAY ${week + 1}`);
      expect(JSON.stringify(st)).toBe(before);
    }
    st.season!.matchday = MATCHDAYS - 1;
    expect(transfersTiming(st)?.next).toBe('NEXT REFRESH AT THE START OF NEXT SEASON');
    expect(transfersTiming(st)?.note).toContain('Cup and quick matches keep the same market');
  });
});

describe('readable transfer news and club identity', () => {
  it('renders dates, your club/league labels and NEW tags without changing unread state or injecting saved text', () => {
    const st = career();
    const own: NewsItem = { season: 1, week: 2, text: 'O\'Neill joins <script> & Rovers for 1,250', kind: 'good', own: true, seen: false };
    const league: NewsItem = { season: 1, week: 0, text: 'Mossvale sign Alan Doe', kind: 'info', own: false, seen: false };
    st.tm.news = [own, league];
    const fresh = new Set([own]);
    const html = marketNewsHtml(st.tm.news, fresh);
    expect(html).toContain('YOUR CLUB');
    expect(html).toContain('LEAGUE');
    expect(html).toContain('SEASON 1 / AFTER MATCHDAY 2');
    expect(html).toContain('SEASON 1 / PRE SEASON');
    expect(html).toContain('O&#39;Neill joins &lt;script&gt; &amp; Rovers for 1,250');
    expect(html).not.toContain('<script>');
    expect(html.match(/class="mk-tag new"/g)).toHaveLength(1);
    expect(marketUnread(st)).toBe(1);
    markNewsSeen(st);
    expect(marketUnread(st)).toBe(0);
    expect(marketNewsHtml(st.tm.news, fresh)).toContain('NEW');
    expect(marketNewsHtml([])).toContain('No transfer news yet');
  });

  it('gives kit and crest their own labelled art slots and escapes the club identity', () => {
    const name = 'O\'Neill & Rovers';
    const html = clubPreviewHtml(KIT, name, 'ONR', defaultCrest(name, 'ONR', KIT), 'crest');
    expect(html).toContain('ck-art ck-crest');
    expect(html).toContain('ck-art ck-shirt');
    expect(html).toContain('aria-label="O&#39;Neill &amp; Rovers crest"');
    expect(html).toContain('aria-label="O&#39;Neill &amp; Rovers kit"');
    expect(html).toContain('<b class="ck-name">O&#39;Neill &amp; Rovers</b>');
    expect(clubPreviewHtml(KIT, '', '')).toContain('kit-only');
    expect(clubPreviewHtml(KIT, '', '')).not.toContain('ck-art ck-crest');
  });
});
