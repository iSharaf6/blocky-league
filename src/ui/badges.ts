/**
 * The SEASON and BADGES screen (the hub's SEASON tile), an app shell screen (docs/UX.md: one screen, only a list
 * scrolls, inside its own pane) with three tabs and CLAIM ALL pinned beside them whenever anything is waiting:
 * - SEASON: one strip with this month's theme, the tier, the XP bar, the days left and the pass state; then the
 *   30-tier track as one sideways list (opened on the current tier), the FREE row over the PASS row, column by
 *   column; and, where the app sells it and it isn't on yet, a compact CLUB PASS card beside the track.
 * - BADGES: the five mastery tracks (meta/mastery.ts) as cards, the claimable and the nearest to a tier first.
 * - TITLES: the title worn, then every title earned, then the next ones to earn, nearest first; tap one to wear it.
 * The free track, badges and titles are earned by playing; the pass track needs the Club Pass.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { levelOf, levelTitle } from '../core/save';
import {
  MASTERY_TIERS, MASTERY_TRACKS, TIER_NAMES, TRACK_INFO, badgePending, claimAll, claimMastery, masteryOf,
  earnedTitles, tierReward, trackProgress, wearTitle, wornTitle, type MasteryState, type MasteryTrack,
} from '../meta/mastery';
import {
  PASS_BIG_COINS, SEASON_TIERS, claimCarry, claimSeasonTier, passReward, rollSeason, seasonOf, seasonDaysLeft, seasonName,
  seasonProgress, seasonReward, seasonTheme, seasonTier, type SeasonState,
} from '../meta/season';
import { buyPassWithGems, claimAllPass, claimCarryItems, claimPassTier, passTotals, syncSeasonGems, syncSignatureEntitlements } from '../meta/pass';
import { GEM_PRICES, PASS_GEMS, SEASON_GEMS, gems } from '../meta/gems';
import { confirmGems, gemArt, gemPrice } from './gemUi';
import { gameCenterReady, showGameCenterAchievements, showGameCenterLeaderboards } from '../platform/gameCenter';
import { buzz } from '../platform/haptics';
import { PRODUCT_PASS, iap } from '../platform/iap';
import { closeMeta, esc, fmt, mountMeta, topBar, type MetaScreen } from './club';
import { pixelIcon } from './menus';
import { maskIcon } from './run';
import { STORE_NOT_READY, openShop } from './shop';
import { sep } from './text';
import './badges.css';

export type BadgesTab = 'badges' | 'season' | 'titles';

const TRACK_ICON: { [k in MasteryTrack]: string } = {
  finisher: 'target', playmaker: 'pass', wall: 'wall', magician: 'spark', keeper: 'glove',
};

function mastery(app: AppContext): MasteryState {
  return masteryOf(app.save);
}

function season(app: AppContext): SeasonState {
  return seasonOf(app.save);
}

// This session's memory (docs/UX.md 8): each list's scroll, kept across claims and tab switches.
const scrolls = new Map<string, number>();

function keepScrolls(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
    scrolls.set(el.dataset.scrollKey ?? '', el.classList.contains('x') ? el.scrollLeft : el.scrollTop);
  });
}

function restoreScrolls(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
    const v = scrolls.get(el.dataset.scrollKey ?? '');
    if (v === undefined) return;
    if (el.classList.contains('x')) el.scrollLeft = v;
    else el.scrollTop = v;
  });
}

/** The season track opens on the tier that matters: the first one waiting to be claimed, else the next to reach. */
function aimTrack(panel: HTMLElement, s: SeasonState): void {
  const rail = panel.querySelector<HTMLElement>('.bd-rail');
  if (!rail) return;
  const reached = seasonTier(s.xp);
  let t = Math.min(SEASON_TIERS, reached + 1);
  for (let i = 1; i <= reached; i++) {
    if (!s.claimed.includes(i) || (s.pass && !s.passClaimed.includes(i))) {
      t = i;
      break;
    }
  }
  const col = rail.querySelector<HTMLElement>(`.bd-tn[data-t="${t}"]`);
  const lab = rail.querySelector<HTMLElement>('.bd-lab');
  if (!col) return;
  // (Layout offsets, not client rects: the panel may still be mid entrance animation. Past the sticky labels,
  // one column of the tiers before it still showing.)
  rail.scrollLeft = Math.max(0, col.offsetLeft - (lab?.offsetWidth ?? 0) - col.offsetWidth - 14);
}

/** The BADGES screen (mastery badges, the season track, titles). `tab` picks the first tab shown. */
export function openBadges(app: AppContext, onBack: () => void, tab: BadgesTab = 'badges'): void {
  const scr = mountMeta(app, 'bd-screen shell');
  const back = (): void => {
    closeMeta();
    onBack();
  };
  // (Esc: mountMeta sends it to BACK.)
  // A month that ended while the game was open rolls over here (its unclaimed coins carry into `carry`).
  if (rollSeason(season(app))) app.persist();
  render(app, scr, back, tab, true);
}

function render(app: AppContext, scr: MetaScreen, back: () => void, tab: BadgesTab, fresh = false): void {
  // The season's gems (free tiers 10, 20 and 30; six pass tiers): paid once per tier claimed, here after any claim.
  const newSignature = syncSignatureEntitlements(app.save);
  const gemsPaid = syncSeasonGems(app.save);
  if (gemsPaid > 0 || newSignature.length) app.persist();
  const pending = badgePending(app.save);
  const m = mastery(app);
  const s = season(app);
  const tiers = MASTERY_TRACKS.reduce((n, k) => n + trackProgress(m, k).tier, 0);
  const sub = tab === 'season' ? seasonName(s.id) : tab === 'badges' ? `${tiers}/${MASTERY_TRACKS.length * MASTERY_TIERS} TIERS` : `${earnedTitles(app.save).length} EARNED`;
  // SEASON first: the hub's SEASON tile opens here.
  const tabs: [BadgesTab, string][] = [['season', 'SEASON'], ['badges', 'BADGES'], ['titles', 'TITLES']];
  const title = tab === 'season' ? 'SEASON' : tab === 'titles' ? 'TITLES' : 'BADGES';
  const badgeClaims = MASTERY_TRACKS.reduce((x, t) => x + trackProgress(m, t).claimable, 0);
  const dot = (k: BadgesTab): string => {
    const n = k === 'badges' ? badgeClaims : k === 'season' ? pending - badgeClaims : 0;
    return n > 0 ? `<i class="bd-dot" aria-label="${n} to claim">${n}</i>` : '';
  };
  const body = tab === 'season' ? seasonHtml(app) : tab === 'titles' ? titlesHtml(app) : badgesHtml(app);
  const redraw = (t: BadgesTab = tab): void => render(app, scr, back, t);
  keepScrolls(scr.panel);
  scr.render(
    `${topBar('MENU', title, sub, app.save.coins)}
    <div class="bd-tabrow">
      <nav class="seg mc-tabs bd-tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}" aria-pressed="${k === tab}">${l}${dot(k)}</button>`).join('')}</nav>
      ${pending ? `<button class="btn btn-yellow pulse bd-all" data-a="all">CLAIM ALL<b>${pending}</b></button>` : ''}
    </div>
    ${body}`,
    {
      back,
      passPreview: () => openShop(app, { tab: 'signature', onBack: () => openBadges(app, back, 'season'), backLabel: 'SEASON' }),
      gc: () => void showGameCenterAchievements(),
      gcBoards: () => void showGameCenterLeaderboards(),
      tab: (el) => {
        const next = (el.dataset.v as BadgesTab) ?? 'badges';
        if (next === tab) return;
        render(app, scr, back, next, next === 'season');
      },
      claimTrack: (el) => {
        const k = el.dataset.k as MasteryTrack;
        const got = claimMastery(m, k);
        if (got.coins > 0) paid(app, scr, got.coins, got.tiers.length === 1 ? `${TRACK_INFO[k].name} ${TIER_NAMES[got.tiers[0].tier - 1]}` : `${got.tiers.length} TIERS`);
        redraw();
      },
      tier: (el) => {
        const t = Number(el.dataset.t);
        const coins = claimSeasonTier(s, t);
        if (coins > 0) {
          const name = seasonReward(t, s.id).title;
          paid(app, scr, coins, name ? `TITLE: ${name.toUpperCase()}` : `TIER ${t}`);
          redraw();
        } else {
          const rw = seasonReward(t, s.id);
          const state = s.claimed.includes(t) ? 'CLAIMED' : `${fmt(rw.coins)} COINS`;
          scr.toast(`TIER ${t}: ${rw.title ? `${rw.title.toUpperCase()}, ` : ''}${state}`);
        }
      },
      ptier: (el) => {
        const t = Number(el.dataset.t);
        if (!s.pass) {
          scr.toast('GET THE CLUB PASS TO CLAIM THIS TIER', 'info');
          return;
        }
        const got = claimPassTier(app.save, t);
        if (got.coins > 0) paid(app, scr, got.coins, `PASS TIER ${t}`);
        if (got.items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast('NEW LOOK: EQUIP IT IN THE SHOP', 'good');
        }
        if (!got.coins && !got.items.length) scr.toast(t > seasonTier(s.xp) ? `REACH TIER ${t} TO CLAIM IT` : `PASS TIER ${t} CLAIMED`, 'info');
        redraw();
      },
      // The Club Pass, bought here: the store's own sheet confirms it; a store not ready yet says so (nothing charged).
      passBuy: async (el) => {
        if (!iap.canSell(PRODUCT_PASS)) {
          scr.toast(STORE_NOT_READY, 'info');
          return;
        }
        (el as HTMLButtonElement).disabled = true;
        const r = await iap.buy(PRODUCT_PASS);
        if (r === 'ok') {
          sfx.coin();
          buzz('success');
          scr.toast('CLUB PASS ON: CLAIM YOUR PASS TIERS', 'good');
        } else if (r === 'pending') scr.toast('WAITING FOR THE STORE. THE PASS SWITCHES ON WHEN IT CONFIRMS', 'info');
        else if (r === 'failed') scr.toast('THAT DID NOT GO THROUGH. TRY AGAIN IN A MOMENT', 'bad');
        if (scr.root.isConnected) redraw('season');
      },
      // The Club Pass for gems (earned by playing, or bought): asked once, with the price.
      passGems: () => {
        confirmGems(scr.root, {
          title: 'GET THE CLUB PASS?', text: 'THIS MONTH. TIERS YOU HAVE REACHED UNLOCK AT ONCE', price: GEM_PRICES.clubPass, have: gems(app.save), yes: 'GET IT',
          getGems: iap.storefront ? () => openShop(app, { tab: 'coins', section: 'gems', backLabel: 'SEASON', onBack: () => openBadges(app, back, 'season') }) : undefined,
          free: 'THE FREE TRACK PAYS EVERY TIER WITHOUT IT',
          onYes: () => {
            if (!buyPassWithGems(app.save).ok) return;
            app.persist();
            sfx.coin();
            buzz('success');
            redraw('season');
            scr.toast('CLUB PASS ON: CLAIM YOUR PASS TIERS', 'good');
          },
        });
      },
      pcarry: () => {
        const items = claimCarryItems(app.save);
        if (items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast(items.length === 1 ? 'NEW LOOK: EQUIP IT IN THE SHOP' : `${items.length} NEW LOOKS: EQUIP THEM IN THE SHOP`, 'good');
        }
        redraw();
      },
      carry: () => {
        const coins = claimCarry(s);
        if (coins > 0) paid(app, scr, coins, 'LAST SEASON');
        redraw();
      },
      all: () => {
        // (claimAll pays its own coins into the wallet; the pass's are returned, so they're paid here.)
        const pass = claimAllPass(app.save);
        app.save.coins += pass.coins;
        const coins = claimAll(app.save) + pass.coins;
        if (coins > 0 || pass.items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast(`+${fmt(coins)} COINS${pass.items.length ? ' AND NEW LOOKS: EQUIP THEM IN THE SHOP' : ''}`, 'good');
        }
        redraw();
      },
      wear: (el) => {
        if (wearTitle(app.save, el.dataset.v ?? '')) {
          app.persist();
          sfx.click();
          scr.toast(el.dataset.v ? `WEARING: ${el.dataset.v.toUpperCase()}` : 'WEARING YOUR LEVEL TITLE', 'good');
        }
        redraw();
      },
      // A title not earned yet: how far there is to go.
      soon: (el) => {
        const k = el.dataset.k as MasteryTrack;
        const p = trackProgress(m, k);
        if (p.next !== null) scr.toast(`${fmt(p.next - p.count)} MORE ${TRACK_INFO[k].unit} FOR ${(el.dataset.v ?? '').toUpperCase()}`, 'info');
      },
    },
  );
  restoreScrolls(scr.panel);
  if (tab === 'season' && fresh) aimTrack(scr.panel, s);
  // (After the claim's own line: the gems that came with it.)
  if (gemsPaid > 0) window.setTimeout(() => scr.root.isConnected && scr.toast(`+${gemsPaid} GEMS FROM THE SEASON`, 'good'), 900);
}

/** Coins claimed: bank them, save, and say so. */
function paid(app: AppContext, scr: MetaScreen, coins: number, what: string): void {
  app.save.coins += coins;
  app.persist();
  sfx.coin();
  buzz('success');
  scr.toast(`+${fmt(coins)} COINS${what ? `  ${what}` : ''}`, 'good');
}

// ------------------------------------------------------------------ badges

/** The five badge cards, the claimable first, then the nearest to their next tier, the maxed last. */
function badgesHtml(app: AppContext): string {
  const m = mastery(app);
  const order = [...MASTERY_TRACKS].sort((a, b) => {
    const pa = trackProgress(m, a);
    const pb = trackProgress(m, b);
    const rank = (p: typeof pa) => (p.claimable ? 2 : p.next === null ? 0 : 1);
    return rank(pb) - rank(pa) || pb.frac - pa.frac;
  });
  const cards = order.map((k) => {
    const info = TRACK_INFO[k];
    const p = trackProgress(m, k);
    const pips = TIER_NAMES.map((n, i) => `<i class="${i < p.tier ? 'on' : ''}" title="Tier ${n}">${n}</i>`).join('');
    const nextRw = p.next !== null ? tierReward(k, p.tier + 1) : null;
    const next = nextRw
      ? `<p class="bd-next"><span>NEXT</span><em><i class="bd-coin"></i>${fmt(nextRw.coins)}</em><em>${esc(nextRw.title.toUpperCase())}</em></p>`
      : '<p class="bd-next done"><span>MAXED</span></p>';
    const claim = p.claimable
      ? `<button class="btn btn-yellow bd-claim pulse" data-a="claimTrack" data-k="${k}"><i class="bd-coin"></i>${fmt(claimCoins(k, m))}</button>`
      : '';
    const count = p.next !== null ? `${fmt(p.count)} / ${fmt(p.next)} ${info.unit}` : `${fmt(p.count)} ${info.unit}`;
    return `<div class="bd-track ${p.claimable ? 'ready' : ''}" style="--c:${info.color}" title="${esc(info.how)}">
      <span class="bd-ic">${maskIcon(TRACK_ICON[k], '#fff', 3)}</span>
      <div class="bd-body">
        <div class="bd-head"><b>${info.name}</b><span class="bd-pips" aria-label="Tier ${p.tier} of ${MASTERY_TIERS}">${pips}</span></div>
        <div class="bd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}"><i style="width:${(p.frac * 100).toFixed(1)}%"></i><span>${count}</span></div>
        <div class="bd-foot">${next}${claim}</div>
      </div>
    </div>`;
  }).join('');
  const gc = gameCenterReady()
    ? '<button class="btn btn-white bd-gc" data-a="gc">ACHIEVEMENTS</button><button class="btn btn-white bd-gc" data-a="gcBoards">LEADERBOARDS</button>'
    : '';
  return `<div class="mc-body bd-bbody">
      <section class="pane">
        <div class="pane-h"><span>EVERY TIER PAYS COINS AND A TITLE</span><span class="grow"></span>${gc}</div>
        <div class="pane-scroll bd-list" data-scroll-key="bd-badges">${cards}</div>
      </section>
    </div>`;
}

function claimCoins(k: MasteryTrack, m: MasteryState): number {
  const p = trackProgress(m, k);
  let c = 0;
  for (let t = m.claimed[k] + 1; t <= p.tier; t++) c += tierReward(k, t).coins;
  return c;
}

// ------------------------------------------------------------------ season

/**
 * The SEASON tab: one purple strip (the month's theme, TIER n/30, the XP bar, days left, the pass state), then the
 * track as one sideways list beside the compact CLUB PASS card (where the app sells it and it isn't on). Last
 * season's leftovers are chips over the track; CLAIM ALL (beside the tabs) takes them too.
 */
function seasonHtml(app: AppContext): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const p = seasonProgress(s);
  const days = seasonDaysLeft();
  const pct = p.need ? (p.into / p.need) * 100 : 100;
  const bar = `<div class="bd-bar big" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Season XP"><i style="width:${pct.toFixed(1)}%"></i><span>${p.need ? `${fmt(p.into)} / ${fmt(p.need)} XP` : 'ALL TIERS REACHED'}</span></div>`;
  const chips = [
    s.carry ? `<button class="bd-chip" data-a="carry">LAST SEASON<b><i class="bd-coin"></i>${fmt(s.carry.coins)}</b><em>CLAIM</em></button>` : '',
    s.carryItems.length ? `<button class="bd-chip" data-a="pcarry">LAST PASS<b>${s.carryItems.length} ${s.carryItems.length === 1 ? 'LOOK' : 'LOOKS'}</b><em>CLAIM</em></button>` : '',
  ].join('');
  // (The pass is for sale everywhere now: for gems, and for money where a store sells it.)
  const offer = !s.pass ? passOfferHtml(app) : '';
  return `<div class="bd-season" style="--c:${th.color}">
      <i class="bd-swatch" aria-hidden="true"></i>
      <b class="bd-theme">${esc(th.name.toUpperCase())}</b>
      <div class="bd-stier" aria-label="Tier ${p.tier} of ${SEASON_TIERS}"><small>TIER</small><b>${p.tier}</b><small>/${SEASON_TIERS}</small></div>
      ${bar}
      <small class="bd-days">${days === 1 ? 'LAST DAY' : `${days} DAYS`}</small>
      ${s.pass ? '<small class="bd-passon">PASS ON</small>' : ''}
    </div>
    <div class="mc-body bd-sbody ${offer ? 'with-offer' : ''}">
      ${offer}
      <section class="pane bd-trackpane">
        <div class="pane-h"><span class="bd-legend">${pixelIcon('star', '#c7970f', 1.4)}EVERY 5TH TIER${sep()}A TITLE</span><span class="grow"></span>${chips}</div>
        <div class="pane-scroll x bd-rail" data-scroll-key="bd-season">${trackHtml(app, true)}</div>
      </section>
    </div>`;
}

/** The CLUB PASS offer, compact: its numbers, and its price on the button (the store's own sheet confirms). */
function passOfferHtml(app: AppContext): string {
  const s = season(app);
  const totals = passTotals(s.id);
  const price = iap.shelf().find((x) => x.id === PRODUCT_PASS)?.price ?? '';
  // Everything it pays, in real numbers, and both prices: the store's (where there is one) and gems.
  return `<aside class="bd-passoffer">
      <span class="bd-po-ic" aria-hidden="true">${pixelIcon('crown', '#ffd23a', 3)}</span>
      <b class="bd-po-name">CLUB PASS</b>
      <ul class="bd-po-facts"><li><b>+${fmt(totals.coins)}</b>COINS</li><li><b class="bd-po-gems">+${fmt(totals.gems)}</b>GEMS</li><li><b>${totals.items.length}</b>LOOKS</li></ul>
      <small class="bd-po-note">STAR CEREMONY NOW. SIX PIECES FOR YOUR WHOLE CLUB. REACHED TIERS UNLOCK AT ONCE</small>
      <button class="btn btn-white" data-a="passPreview">PREVIEW COLLECTION</button>
      ${price ? `<button class="btn btn-yellow bd-po-buy" data-a="passBuy" aria-label="Get the Club Pass, ${esc(price)}"><small>GET IT</small><b>${esc(price)}</b></button>` : ''}
      <button class="btn btn-white bd-po-gembuy" data-a="passGems" aria-label="Get the Club Pass for ${GEM_PRICES.clubPass} gems">${price ? 'OR' : 'GET IT'} ${gemPrice(GEM_PRICES.clubPass)}</button>
    </aside>`;
}

/**
 * The track: a sticky label column (TIER, FREE, PASS), then a column per tier: its number, the free prize and
 * (where the pass exists) the pass prize, so the two rows always line up.
 */

/** How each Club Pass look reads on the pass track (its tile word, its spoken name, its icon). */
const PASS_KIND: { readonly [k in 'goalfx' | 'trail' | 'kit' | 'look' | 'decor']: { short: string; long: string; icon: 'bolt' | 'star' | 'shirt' | 'crown' } } = {
  trail: { short: 'TRAIL', long: 'sprint trail', icon: 'bolt' },
  goalfx: { short: 'GOAL FX', long: 'goal explosion', icon: 'star' },
  kit: { short: 'KIT', long: 'premium kit', icon: 'shirt' },
  look: { short: 'LOOK', long: 'player look', icon: 'crown' },
  decor: { short: 'STADIUM', long: 'signature stadium piece', icon: 'star' },
};

function trackHtml(app: AppContext, withPass: boolean): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const reached = seasonTier(s.xp);
  const cells: string[] = [
    `<span class="bd-lab num">TIER</span><span class="bd-lab free">FREE</span>${withPass ? `<span class="bd-lab pass">${s.pass ? 'PASS' : `${pixelIcon('lock', '#ffd23a', 1.4)}PASS`}</span>` : ''}`,
  ];
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const rw = seasonReward(t, s.id);
    const got = s.claimed.includes(t);
    const ready = !got && t <= reached;
    // (Economy v3: free tiers 10, 20 and 30 pay gems too, and six pass tiers pay more.)
    const fGems = SEASON_GEMS[t] ?? 0;
    const pGems = PASS_GEMS[t] ?? 0;
    const gemTag = (n: number, done: boolean) => (n && !done ? `<u class="bd-gem">${gemArt(1.4)}${n}</u>` : '');
    const label = `Tier ${t}: ${rw.coins} coins${fGems ? ` and ${fGems} gems` : ''}${rw.title ? ` and the title ${rw.title}` : ''}${got ? ', claimed' : ready ? ', ready to claim' : ''}`;
    cells.push(`<b class="bd-tn ${t <= reached ? 'on' : ''} ${t === reached + 1 ? 'next' : ''}" data-t="${t}">${t}</b>`);
    cells.push(`<button class="bd-tile ${got ? 'got' : ready ? 'ready' : 'lock'} ${rw.title ? 'big' : ''}" data-a="tier" data-t="${t}" aria-label="${esc(label)}">
        ${rw.title ? `<span class="bd-star">${pixelIcon('star', got ? '#26262e' : '#c7970f', 1.4)}</span>` : ''}
        <span class="bd-coins">${got ? maskIcon('tick', '#238a3b', 1.6) : `<i class="bd-coin"></i>${rw.coins}`}</span>
        ${gemTag(fGems, got)}
        ${ready ? '<em>CLAIM</em>' : ''}
      </button>`);
    if (!withPass) continue;
    const pr = passReward(t, s.id);
    const pGot = s.passClaimed.includes(t);
    const pReady = s.pass && !pGot && t <= reached;
    const kind = pr.item ? pr.item.cat === 'decor' ? { ...PASS_KIND.decor, short: t === 1 ? 'CEREMONY' : 'NETS', long: t === 1 ? 'star ceremony' : 'signature nets' } : PASS_KIND[pr.item.cat] : null;
    const what = pr.item && kind ? `the ${th.name} ${kind.long}${pr.coins ? ` and ${pr.coins} coins` : ''}${pGems ? ` and ${pGems} gems` : ''}` : `${pr.coins} coins${pGems ? ` and ${pGems} gems` : ''}`;
    const pLabel = `Club Pass tier ${t}: ${what}${pGot ? ', claimed' : pReady ? ', ready to claim' : s.pass ? '' : ', with the pass'}`;
    const prize = pr.item
      ? `<span class="bd-coins bd-item">${kind!.short}${pr.coins ? `<small>+${pr.coins} COINS</small>` : ''}</span>`
      : `<span class="bd-coins">${pGot ? maskIcon('tick', '#238a3b', 1.6) : `<i class="bd-coin"></i>${pr.coins}`}</span>`;
    cells.push(`<button class="bd-tile ptile ${pGot ? 'got' : pReady ? 'ready' : 'lock'} ${pr.item || PASS_BIG_COINS[t] ? 'big' : ''}" data-a="ptier" data-t="${t}" aria-label="${esc(pLabel)}">
        ${pr.item ? `<span class="bd-star">${pixelIcon(kind!.icon, pGot ? '#26262e' : '#ffd23a', 1.4)}</span>` : ''}
        ${prize}
        ${gemTag(pGems, pGot)}
        ${pReady ? '<em>CLAIM</em>' : ''}
      </button>`);
  }
  return `<div class="bd-railgrid ${withPass ? 'with-pass' : ''} ${s.pass ? 'pass-on' : ''}">${cells.join('')}</div>`;
}

// ------------------------------------------------------------------ titles

/** The title worn, every title earned, then the next badge titles to earn (nearest first). */
function titlesHtml(app: AppContext): string {
  const list = earnedTitles(app.save);
  const worn = wornTitle(app.save);
  const lvl = levelTitle(levelOf(app.save.progress.xp).level);
  const seen = new Set<string>();
  // (Newest and highest first: earnedTitles lists each track's tiers upwards.)
  const earned = list.filter((e) => (seen.has(e.title) ? false : (seen.add(e.title), true))).reverse();
  earned.sort((a, b) => Number(b.title === worn) - Number(a.title === worn));
  const items = earned.map((e) => `<button class="bd-title ${e.title === worn ? 'on' : ''}" data-a="wear" data-v="${esc(e.title)}" aria-pressed="${e.title === worn}">
      <b>${esc(e.title)}</b><small>${esc(e.from)}</small>
    </button>`);
  const level = `<button class="bd-title lvl ${worn ? '' : 'on'}" data-a="wear" data-v="" aria-pressed="${!worn}"><b>${esc(lvl)}</b><small>LEVEL TITLE</small></button>`;
  if (worn) items.splice(1, 0, level);
  else items.unshift(level);
  const m = mastery(app);
  const next = MASTERY_TRACKS.map((k) => ({ k, p: trackProgress(m, k) }))
    .filter(({ p }) => p.next !== null)
    .sort((a, b) => b.p.frac - a.p.frac)
    .map(({ k, p }) => {
      const t = tierReward(k, p.tier + 1).title;
      return `<button class="bd-title soon" data-a="soon" data-k="${k}" data-v="${esc(t)}" aria-label="${esc(t)}, not earned yet, ${Math.round(p.frac * 100)}%">
        <b>${esc(t)}</b><small>${TRACK_INFO[k].name} ${TIER_NAMES[p.tier]}</small><i class="bd-mini" style="--c:${TRACK_INFO[k].color}"><i style="width:${(p.frac * 100).toFixed(0)}%"></i></i>
      </button>`;
    });
  return `<div class="mc-body bd-tbody">
      <section class="pane">
        <div class="pane-h"><span>TAP ONE TO WEAR IT</span></div>
        <div class="pane-scroll bd-titles" data-scroll-key="bd-titles">${items.join('')}${next.join('')}</div>
      </section>
    </div>`;
}
