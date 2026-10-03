/**
 * The SHOP (from the coins on the main menu): celebrations, ball looks, goal explosion themes and sprint trails
 * to buy and equip, with the selected item live on a 3D stage (ui/shopStage.ts), and PLAYERS: scout packs (a
 * random card for MY CLUB, with a reveal) and the way into the transfer market, and COINS: the coin packs, Starter
 * Pack, NO ADS and RESTORE PURCHASES where a store sells them (the iOS and Android apps: platform/iap.ts), or
 * FREE COINS (a few rewarded ads a day) on the web portals. No real-money offer is ever drawn without a store.
 * Rules live in meta/shop.ts; this file only draws them and wires them to AppContext.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { localDay } from '../core/day';
import { STAT_SHORT, KEY_STATS, SQUAD_MAX, clubRating, type ClubState } from '../meta/career';
import { PRESET_CLUBS, makeTeam } from '../meta/data';
import {
  CAT_LABEL, DEFAULT_ID, FREE_AD_COINS, FREE_AD_DAILY_CAP, PACKS, pendingCard, settlePack, RARITIES, RARITY_OVR, buyItem, claimFreeAd, equipItem, equippedId, freeAdsLeft,
  freePackReady, itemKey, makeRoom, markSeen, openPack, owns, PACK_TOKENS, scoutTokens, DEAL_OFF, ITEM_TIER_NAMES, dailyDeal, itemTier, priceOn,
  seasonPassItems,
  packPrice, releaseCandidate, sellCard, shopItem, shopItems, shopOf, signCard, type PackCard, type PackKind, type Rarity, type ShopCat,
  type ShopItem,
} from '../meta/shop';
import { ads } from '../platform/ads';
import { FIRST_BUY_MULT, PRODUCT_NOADS, PRODUCT_STARTER, iap, type IapGrant, type IapProduct } from '../platform/iap';
import { passTotals } from '../meta/pass';
import { seasonDaysLeft, seasonOf, seasonTheme } from '../meta/season';
import { quickSaleValue, squadWages, wageBudget, wageOf } from '../meta/market';
import { GOAL_FX_COLORS, TRAIL_COLORS } from '../render/cosmetics';
import { cssHex } from '../render/palette';
import { overall, type Kit, type PlayerDef } from '../sim/types';
import { careerState, clubCreate, closeMeta, esc, fmt, mountMeta, onMetaClose, openClub, roleBadge, topBar, type MetaScreen } from './club';
import { openMarket } from './market';
import { shirtArt } from './menus';
import { pixelIcon } from './pixelIcons';
import { faceHtml, hydrateFaces } from './preview';
import { ShopStage } from './shopStage';
import { sep } from './text';
import './shop.css';

export type ShopTab = ShopCat | 'players' | 'coins';

const isCat = (t: ShopTab): t is ShopCat => t !== 'players' && t !== 'coins';

/** The COINS tab exists where coins can be topped up: a store's coin packs (the apps) or a portal's rewarded ads. Plain web: no tab. */
function coinsTab(): boolean {
  return iap.available || ads.portal !== 'none';
}

let open = false;
/** The shop is on screen (main.ts then leaves a late purchase's message to it). */
export function shopOpen(): boolean {
  return open;
}

export interface ShopOpts {
  tab?: ShopTab;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

const TABS: [ShopTab, string, string][] = [
  ['celebration', 'CELEBRATIONS', 'CELEBS'],
  ['ball', 'BALLS', 'BALLS'],
  ['goalfx', 'GOAL FX', 'GOAL FX'],
  ['trail', 'TRAILS', 'TRAILS'],
  ['players', 'PLAYERS', 'PLAYERS'],
  ['coins', 'COINS', 'COINS'],
];

const RARITY_NAME: { readonly [k in Rarity]: string } = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legend: 'LEGEND' };

/** The local day (YYYY-MM-DD): the free pack is one a day, like the daily gift. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const coin = (n: number) => `<i class="sh-coin" aria-hidden="true"></i>${fmt(n)}`;

/** Crisp pixel art for a goal theme: a starburst in its colours. */
function burstArt(colors: readonly number[]): string {
  const rows = ['...X.X...', '.X..X..X.', '..X.X.X..', 'X..XXX..X', '.XXXXXXX.', 'X..XXX..X', '..X.X.X..', '.X..X..X.', '...X.X...'];
  let rects = '';
  let k = 0;
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${cssHex(colors[k++ % colors.length])}"/>`;
  }));
  return `<svg class="sh-px" viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** Crisp pixel art for a trail: speed lines in its colours, trailing a pixel ball. */
function trailArt(colors: readonly number[]): string {
  const lines: [number, number, number][] = [[1, 2, 5], [0, 4, 6], [2, 6, 4], [1, 8, 5]];
  let rects = '';
  lines.forEach(([x, y, w], i) => {
    rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${cssHex(colors[i % colors.length])}"/>`;
  });
  rects += '<rect x="7" y="3" width="3" height="3" fill="#fbfbf4"/><rect x="8" y="4" width="1" height="1" fill="#26262e"/>';
  return `<svg class="sh-px" viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** Crisp pixel art for a coin pack: a pile of 1, 3, 6 or 10 coins (the bigger the pack the bigger the pile). */
function coinPile(tier: number): string {
  const rows = Math.max(1, Math.min(4, tier));
  let rects = '';
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      // The same coin size in every pile (a 15 by 12 canvas), sitting on the bottom edge and centred.
      const x = (4 - 1 - r) * 2 + i * 4;
      const y = r * 3 + (4 - rows) * 3;
      rects += `<rect x="${x}" y="${y}" width="3" height="3" fill="#c7970f"/><rect x="${x}" y="${y}" width="3" height="2" fill="#ffd23a"/><rect x="${x}" y="${y}" width="2" height="1" fill="#fff3b0"/>`;
    }
  }
  return `<svg class="sh-px" viewBox="0 0 15 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** A small play triangle for the watch-an-ad button. */
const PLAY_ART = '<svg class="sh-play" viewBox="0 0 7 7" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v7H0zM1 1h1v5H1zM2 1h1v5H2zM3 2h1v3H3zM4 2h1v3H4zM5 3h1v1H5z" fill="currentColor"/></svg>';

/** Tile stills (3D shots of celebrations and balls), cached across visits by item and kit. */
const stills = new Map<string, string>();

/** The star the stage dresses up: MY CLUB's best player in its kit, else the Quick Match club's striker. */
function starOf(app: AppContext, club: ClubState | null): { def: PlayerDef; kit: Kit } {
  if (club) {
    const star = [...club.squad.slice(0, 11)].sort((a, b) => overall(b) - overall(a))[0];
    if (star && star.role !== 'GK') return { def: star, kit: club.kit };
    const fw = club.squad.find((p) => p.role === 'FW') ?? club.squad[club.squad.length - 1];
    if (fw) return { def: fw, kit: club.kit };
  }
  const seed = PRESET_CLUBS[app.save.clubIdx] ?? PRESET_CLUBS[0];
  return { def: makeTeam(seed).players[9], kit: seed.kit };
}

/** Open the shop (on the celebrations unless `opts.tab` says otherwise). */
export function openShop(app: AppContext, opts: ShopOpts = {}): void {
  const backLabel = opts.backLabel ?? 'MENU';
  const back =
    opts.onBack ??
    (() => {
      closeMeta();
      app.mainMenu();
    });
  // MY CLUB, once founded (the career blob is only touched when there is a club in it).
  const clubOf = (): ClubState | null => {
    const raw = app.save.career as { club?: unknown } | null;
    return raw && typeof raw === 'object' && raw.club ? careerState(app).club : null;
  };
  shopScreen(app, opts.tab ?? 'celebration', back, backLabel, clubOf);
}

function shopScreen(app: AppContext, tab0: ShopTab, back: () => void, backLabel: string, clubOf: () => ClubState | null): void {
  const scr = mountMeta(app, 'sh-screen');
  const save = app.save;
  shopOf(save);
  let tab: ShopTab = tab0 === 'coins' && !coinsTab() ? 'celebration' : tab0;
  open = true;
  onMetaClose(() => {
    open = false;
  });
  /** The item on the stage, per category (the equipped one first). */
  const pick: { [k in ShopCat]: string } = {
    celebration: equippedId(save, 'celebration'), ball: equippedId(save, 'ball'), goalfx: equippedId(save, 'goalfx'), trail: equippedId(save, 'trail'),
  };
  const star = starOf(app, clubOf());
  const stage = new ShopStage(star.def, star.kit);
  onMetaClose(() => stage.dispose());
  const kitKey = `${star.def.id}|${star.kit.shirt}|${star.kit.shirt2}|${star.kit.pattern}`;
  /** Coins shown in the top bar before the last purchase (the counter runs down from it). */
  let shownCoins = save.coins;
  let popKey = '';

  const say = (msg: string, kind: 'good' | 'bad' | 'info' = 'good') => scr.toast(msg, kind);

  // ---- coins (store packs, or a few rewarded ads a day)

  /** What is in flight: a product id, 'restore' or 'ad' (its buttons wait; the rest of the screen stays usable). */
  let busy = '';

  // Any grant while the shop is up (a purchase, a late approval, a restore) runs the wallet up and chimes.
  const offGrant = iap.onGrant((g: IapGrant) => {
    shownCoins = Math.min(shownCoins, save.coins - g.coins);
    if (g.items.includes(itemKey('ball', 'gold'))) equipItem(save, 'ball', 'gold');
    // (This draw runs the wallet up: nothing may redraw over it right after. A restore in flight keeps its button waiting.)
    if (busy !== 'restore') busy = '';
    app.persist();
    sfx.coin();
    window.setTimeout(() => sfx.powerup(), 120);
    draw();
    // (A restore reports once, as a whole: see handlers.restore.)
    if (!g.restored) say(grantText(g), 'good');
  });
  onMetaClose(offGrant);

  const storeHtml = (): string => {
    const list = iap.products();
    const packs = list.filter((p) => p.kind === 'consumable' && !p.pass);
    const starter = list.find((p) => p.id === PRODUCT_STARTER);
    const noAds = list.find((p) => p.id === PRODUCT_NOADS);
    const pass = list.find((p) => p.pass);
    const doubler = list.find((p) => p.doubler);
    const off = busy !== '' ? 'disabled' : '';
    const pack = (p: IapProduct, i: number) => `<button class="sh-iap ${p.tag ? 'tagged' : ''} ${busy === p.id ? 'wait' : ''}" data-a="iap" data-id="${esc(p.id)}" ${off}
        aria-label="${fmt(p.coins)} coins, ${esc(p.price)}${p.tag ? `, ${p.tag.toLowerCase()}` : ''}">
        ${p.firstBonus ? `<i class="sh-ribbon first">FIRST BUY X${FIRST_BUY_MULT}</i>` : p.tag ? `<i class="sh-ribbon ${p.tag === 'BEST VALUE' ? 'best' : 'pop'}">${p.tag}</i>` : ''}
        <span class="sh-pile">${coinPile(i + 1)}</span>
        <b>${fmt(p.coins * (p.firstBonus ? FIRST_BUY_MULT : 1))} COINS</b>
        <small>${p.firstBonus ? `DOUBLED ON YOUR FIRST BUY` : p.bonusPct ? `${fmt(p.baseCoins)} + ${p.bonusPct}% BONUS` : 'A QUICK TOP UP'}</small>
        <em class="sh-tag price buy">${esc(busy === p.id ? 'ONE MOMENT' : p.price)}</em>
      </button>`;
    // The Starter Pack is a one-time offer: gone once bought. NO ADS only where this build has ads to remove.
    const showNoAds = noAds && (noAds.owned || ads.showsInterstitials || iap.provider === 'dev');
    const season = seasonOf(save);
    const totals = passTotals(season.id);
    const days = seasonDaysLeft();
    const passCard = pass ? `<section class="sh-deal pass">
          <div class="sh-dealtxt"><b>CLUB PASS: ${esc(seasonTheme(season.id).name.toUpperCase())}</b>
            <span>${fmt(totals.coins)} coins on top of the free season, plus the ${esc(seasonTheme(season.id).name)} trail and goal explosion: only in the pass. Tiers you have already reached unlock at once. ${days} ${days === 1 ? 'day' : 'days'} left this month.</span></div>
          ${pass.owned ? '<em class="sh-tag own">ON THIS MONTH</em>' : `<button class="btn btn-yellow" data-a="iap" data-id="${esc(pass.id)}" ${off}>${esc(busy === pass.id ? 'ONE MOMENT' : pass.price)}</button>`}
        </section>` : '';
    const doublerCard = doubler ? `<section class="sh-deal doubler">
          <div class="sh-dealtxt"><b>COIN DOUBLER</b><span>Every match pays double coins, for good. Challenges and gifts stay as they are.</span></div>
          ${doubler.owned ? '<em class="sh-tag own">OWNED</em>' : `<button class="btn btn-white" data-a="iap" data-id="${esc(doubler.id)}" ${off}>${esc(busy === doubler.id ? 'ONE MOMENT' : doubler.price)}</button>`}
        </section>` : '';
    return `<p class="sh-lede">Coins buy looks and more. Every match pays coins too, so top up only if you like.</p>
      ${passCard}
      <div class="sh-iaps">${packs.map(pack).join('')}</div>
      ${doublerCard}
      ${starter && !starter.owned ? `<section class="sh-deal starter">
          <span class="sh-dealart" aria-hidden="true">${pixelIcon('ball', '#ffd23a', 6)}</span>
          <div class="sh-dealtxt"><b>STARTER PACK</b><span>${fmt(starter.coins)} COINS AND THE GOLD BALL${sep()}ONE TIME ONLY</span></div>
          <button class="btn btn-yellow" data-a="iap" data-id="${esc(starter.id)}" ${off}>${esc(busy === starter.id ? 'ONE MOMENT' : starter.price)}</button>
        </section>` : ''}
      ${showNoAds ? `<section class="sh-deal noads">
          <div class="sh-dealtxt"><b>NO ADS</b><span>No ad breaks between matches. Ads you choose to watch for a bonus stay.</span></div>
          ${noAds.owned ? '<em class="sh-tag own">OWNED</em>' : `<button class="btn btn-white" data-a="iap" data-id="${esc(noAds.id)}" ${off}>${esc(busy === noAds.id ? 'ONE MOMENT' : noAds.price)}</button>`}
        </section>` : ''}
      <div class="sh-restore"><button class="btn btn-white" data-a="restore" ${off}>${busy === 'restore' ? 'ONE MOMENT' : 'RESTORE PURCHASES'}</button></div>
      <p class="mc-hint">Coins have no cash value and can't buy scout packs (those take Scout Tokens, earned by playing). Nothing you buy changes a match.</p>`;
  };

  const freeHtml = (): string => {
    const left = freeAdsLeft(save, localDay());
    const ready = ads.rewardedAvailable;
    const state = left <= 0 ? 'done' : !ready ? 'none' : busy === 'ad' ? 'wait' : 'go';
    const label = state === 'done' ? 'ALL DONE TODAY' : state === 'none' ? 'NO AD RIGHT NOW' : state === 'wait' ? 'ONE MOMENT' : `${PLAY_ART}WATCH AN AD, +${FREE_AD_COINS}`;
    const note = state === 'done' ? 'You have used all of today\'s free coins. Come back tomorrow.'
      : state === 'none' ? 'There is no ad to show right now. Come back a little later.'
        : `${left} of ${FREE_AD_DAILY_CAP} left today.`;
    return `<section class="sh-gift">
        <span class="sh-giftart" aria-hidden="true">${coinPile(3)}</span>
        <div class="sh-gifttxt">
          <h3>FREE COINS</h3>
          <p>Watch a short ad and get ${FREE_AD_COINS} coins. Up to ${FREE_AD_DAILY_CAP} a day.</p>
          <p class="sh-left ${state}">${note}</p>
        </div>
        <button class="btn btn-yellow btn-lg sh-watch" data-a="ad" ${state === 'go' ? '' : 'disabled'}>${label}</button>
      </section>`;
  };

  const coinsHtml = (): string => `<div class="sh-coins">${iap.available ? storeHtml() : ''}${ads.portal !== 'none' ? freeHtml() : ''}</div>`;

  // ---- cosmetics

  const artOf = (it: ShopItem): string => {
    if (it.cat === 'goalfx') return burstArt(it.id === 'club' ? [star.kit.shirt, star.kit.shirt2, 0xffd23a, 0xfbfbf4] : GOAL_FX_COLORS[it.id as keyof typeof GOAL_FX_COLORS]);
    if (it.cat === 'trail') return trailArt(TRAIL_COLORS[it.id as keyof typeof TRAIL_COLORS]);
    const key = `${it.cat}:${it.id}|${it.cat === 'celebration' ? kitKey : ''}`;
    let url = stills.get(key);
    if (!url && stage.ok) {
      // A characteristic moment of each move (seconds into its loop on the stage).
      const at: { [k: string]: number } = { classic: 0.4, knee: 1.5, shush: 1.6, plane: 0.9, robot: 0.6, backflip: 1.32, pile: 2.6 };
      url = stage.still({ cat: it.cat, id: it.id }, it.cat === 'ball' ? 0.95 : at[it.id] ?? 1, 144) ?? undefined;
      if (url) stills.set(key, url);
    }
    if (url) return `<img class="sh-img" src="${url}" alt="" draggable="false">`;
    return it.cat === 'ball' ? pixelIcon('ball', '#fbfbf4', 5) : pixelIcon('star', '#ffd23a', 5);
  };

  /** What a look costs today (today's deal price for the deal look). */
  const priceOf = (it: ShopItem): number => priceOn(save, it, today());
  const dealOf = (it: ShopItem): boolean => priceOf(it) < it.price;

  /** The state an item is in for the wallet and the save ('pass': a Club Pass look not yet earned). */
  const stateOf = (it: ShopItem): 'on' | 'owned' | 'buy' | 'poor' | 'pass' =>
    equippedId(save, it.cat) === it.id ? 'on' : owns(save, it.cat, it.id) ? 'owned' : it.pass ? 'pass' : save.coins >= priceOf(it) ? 'buy' : 'poor';

  /** The rarity badge (status): every look above COMMON wears one. */
  const tierHtml = (it: ShopItem): string => {
    const t = itemTier(it);
    return t === 'common' ? '' : `<i class="sh-tier t-${t}">${ITEM_TIER_NAMES[t]}</i>`;
  };

  const tileHtml = (it: ShopItem, selected: boolean, fresh: boolean) => {
    const s = stateOf(it);
    const tag =
      s === 'on' ? '<em class="sh-tag on">EQUIPPED</em>'
        : s === 'owned' ? '<em class="sh-tag own">OWNED</em>'
          : s === 'pass' ? '<em class="sh-tag pass">CLUB PASS</em>'
            : `<em class="sh-tag price ${s}">${coin(priceOf(it))}</em>`;
    return `<button class="sh-tile ${s} ${selected ? 'sel' : ''} ${popKey === itemKey(it.cat, it.id) ? 'pop' : ''}" data-a="pick" data-id="${esc(it.id)}"
        aria-label="${esc(it.name)}, ${s === 'on' ? 'equipped' : s === 'owned' ? 'owned' : s === 'pass' ? 'Club Pass' : `${priceOf(it)} coins`}" aria-pressed="${selected}">
      ${fresh ? '<i class="sh-new">NEW</i>' : dealOf(it) && s !== 'on' && s !== 'owned' ? `<i class="sh-new deal">${DEAL_OFF}% OFF</i>` : ''}
      ${tierHtml(it)}
      <span class="sh-art">${artOf(it)}</span>
      <b>${esc(it.name.toUpperCase())}</b>
      ${tag}
    </button>`;
  };

  const actionHtml = (it: ShopItem): string => {
    const s = stateOf(it);
    if (s === 'on') return '<button class="btn btn-white btn-lg sh-act" disabled>EQUIPPED</button>';
    if (s === 'owned') return `<button class="btn btn-go btn-lg sh-act" data-a="equip">EQUIP</button>`;
    if (s === 'pass') {
      return `<p class="sh-short">EARN IT IN THE ${esc(it.name.toUpperCase())} CLUB PASS</p>
        ${iap.available ? '<button class="btn btn-blue sh-more" data-a="tab" data-v="coins">SEE THE CLUB PASS</button>' : ''}`;
    }
    const price = priceOf(it);
    const was = price < it.price ? `<s class="sh-was">${fmt(it.price)}</s> ` : '';
    if (s === 'buy') return `<button class="btn btn-yellow btn-lg sh-act" data-a="buy">BUY ${was}${coin(price)}</button>`;
    return `<button class="btn btn-white btn-lg sh-act poor" data-a="buy" aria-describedby="sh-short">${was}${coin(price)}</button>
      <p class="sh-short" id="sh-short">${fmt(price - save.coins)} COINS SHORT${sep()}EVERY MATCH PAYS</p>
      ${coinsTab() ? '<button class="btn btn-blue sh-more" data-a="tab" data-v="coins">GET COINS</button>' : ''}`;
  };

  const showcaseHtml = (it: ShopItem): string => {
    const s = stateOf(it);
    const lv = it.level !== undefined && s !== 'on' && s !== 'owned' ? `<p class="sh-free">OR FREE AT LEVEL ${it.level}</p>` : '';
    return `<section class="sh-show">
        <div class="sh-stage ${stage.ok ? '' : 'flat'}">
          ${stage.ok ? '<canvas class="sh-3d" aria-hidden="true"></canvas>' : `<span class="sh-art big">${artOf(it)}</span>`}
          <div class="sh-burst" aria-hidden="true"></div>
        </div>
        <div class="sh-info">
          <small class="sh-kind">${CAT_LABEL[it.cat].toUpperCase()}${itemTier(it) === 'common' ? '' : `${sep()}<b class="t-${itemTier(it)}">${ITEM_TIER_NAMES[itemTier(it)]}</b>`}</small>
          <h3 class="sh-name">${esc(it.name.toUpperCase())}</h3>
          <p class="sh-blurb">${esc(it.blurb)}</p>
          ${actionHtml(it)}
          ${lv}
        </div>
      </section>`;
  };

  /** Today's deal, on top of every looks tab: one look a day at DEAL_OFF % off, honestly rotating. */
  const dealHtml = (): string => {
    const d = dailyDeal(save, today());
    if (!d) return '';
    return `<section class="sh-dealbar">
        <b>TODAY'S DEAL</b>
        <span>${esc(d.item.name.toUpperCase())} ${CAT_LABEL[d.item.cat].toUpperCase()}, ${DEAL_OFF}% OFF: <s>${fmt(d.item.price)}</s> ${coin(d.price)}. A new deal every day.</span>
        <button class="btn btn-yellow" data-a="deal">SEE IT</button>
      </section>`;
  };

  const catHtml = (cat: ShopCat): string => {
    // Club Pass looks: this month's (to earn) and any already earned; past months' don't clutter the shop.
    const passId = seasonPassItems(seasonOf(save).id)[cat === 'goalfx' ? 'goalfx' : 'trail'].id;
    const items = shopItems(cat).filter((x) => !x.pass || x.id === passId || owns(save, x.cat, x.id));
    const seen = new Set(shopOf(save).seen);
    const it = shopItem(cat, pick[cat]) ?? items[0];
    const tiles = items.map((x) => tileHtml(x, x.id === it.id, x.price > 0 && x.price <= save.coins && !owns(save, x.cat, x.id) && !seen.has(itemKey(x.cat, x.id)))).join('');
    return `${dealHtml()}${showcaseHtml(it)}<div class="sh-grid">${tiles}</div>`;
  };

  // ---- players (scout packs + the market)

  const playersHtml = (): string => {
    const club = clubOf();
    if (!club) {
      return `<section class="sh-noclub">
          ${pixelIcon('shirt', '#26262e', 6)}
          <h3>FOUND YOUR CLUB FIRST</h3>
          <p>Packs sign real players into <b>MY CLUB</b>, the team you take into PLAY NOW and ROAD TO GLORY. Pick a name, a kit and a formation: it takes a minute.</p>
          <button class="btn btn-go btn-lg" data-a="found">FOUND YOUR CLUB</button>
        </section>`;
    }
    const day = today();
    const rating = clubRating(club);
    const full = club.squad.length >= SQUAD_MAX;
    const wages = squadWages(club);
    const odds = (k: PackKind) => `<ul class="sh-odds">${RARITIES.map((r, i) => (PACKS[k].odds[i] ? `<li class="r-${r}"><i></i>${RARITY_NAME[r]} ${PACKS[k].odds[i]}%</li>` : '')).join('')}</ul>`;
    const tokens = scoutTokens(save);
    const pack = (k: PackKind, free: boolean) => {
      const cost = PACK_TOKENS[k];
      const poor = !free && tokens < cost;
      const name = free ? 'FREE DAILY PACK' : PACKS[k].name;
      const lo = RARITY_OVR[k === 'elite' ? 'rare' : 'common'][0];
      return `<button class="sh-pack p-${free ? 'free' : k} ${poor ? 'poor' : ''}" data-a="pack" data-k="${k}" data-free="${free ? 1 : 0}" aria-label="${name}, ${free ? 'free' : `${cost} scout ${cost === 1 ? 'token' : 'tokens'}`}">
          <span class="sh-cardback" aria-hidden="true"><i></i></span>
          <b>${name}</b>
          <small>${free ? 'A SCOUT PACK ON THE HOUSE, EVERY DAY' : `OVR ${Math.max(30, rating + lo)} TO ${Math.min(95, rating + 16)}`}</small>
          ${odds(k)}
          <em class="sh-tag price ${poor ? 'poor' : 'buy'}">${free ? 'FREE' : `${cost} ${cost === 1 ? 'TOKEN' : 'TOKENS'}`}</em>
        </button>`;
    };
    return `<section class="sh-club">
        ${shirtArt(club.kit, 4)}
        <div class="sh-clubtxt"><b>${esc(club.name)}</b><span>OVR ${rating}${sep()}SQUAD ${club.squad.length}/${SQUAD_MAX}${sep()}WAGES ${fmt(wages)}</span></div>
        <button class="btn btn-white" data-a="squad">SQUAD</button>
      </section>
      ${full ? `<p class="mc-hint warn">Squad full (${SQUAD_MAX}): a new card can still join if you let your weakest sub go, or sell him on.</p>` : ''}
      <p class="sh-tokens"><b>${tokens}</b> SCOUT ${tokens === 1 ? 'TOKEN' : 'TOKENS'}<span>Every daily challenge you finish earns one. Tokens are earned, never sold.</span></p>
      <div class="sh-packs">
        ${freePackReady(save, day) ? pack('scout', true) : ''}
        ${pack('scout', false)}
        ${pack('elite', false)}
      </div>
      <p class="mc-hint">Every card is a real player for MY CLUB, rated against your XI. Sign him (straight into the starting XI when he beats a starter) or sell him on. Odds are shown on every pack.</p>
      <section class="sh-market">
        <div><b>TRANSFER MARKET</b><span>Bid for named players from the clubs in your league, sell yours, scout the youth.</span></div>
        <button class="btn btn-blue" data-a="market">OPEN MARKET</button>
      </section>`;
  };

  // ---- the pack reveal (a sheet on the screen root, so panel re-renders leave it alone)

  let sheet: HTMLDivElement | null = null;
  const closeSheet = () => {
    sheet?.remove();
    sheet = null;
  };
  onMetaClose(closeSheet);

  const reveal = (card: PackCard, price: number) => {
    const club = clubOf();
    if (!club) return;
    closeSheet();
    const p = card.player;
    const value = quickSaleValue(p);
    const bars = KEY_STATS[p.role].map((k) => `<div class="mc-bar"><span>${STAT_SHORT[k]}</span><div><i style="width:${p.stats[k]}%"></i></div><b>${p.stats[k]}</b></div>`).join('');
    sheet = document.createElement('div');
    sheet.className = `sh-modal r-${card.rarity}`;
    sheet.innerHTML = `<div class="sh-reveal" role="dialog" aria-modal="true" aria-label="Pack opening">
        <div class="sh-rays" aria-hidden="true"></div>
        <div class="sh-card">
          <div class="sh-face sh-back"><span class="sh-cardback big"><i></i></span><b>TAP TO SKIP</b></div>
          <div class="sh-face sh-front">
            <span class="sh-rtag">${RARITY_NAME[card.rarity]}</span>
            <div class="sh-cardtop">${faceHtml(p, club.kit, 'xl')}<div class="sh-ovr"><b>${card.ovr}</b><small>OVR</small></div></div>
            <b class="sh-pname">${esc(p.name.toUpperCase())}</b>
            <span class="sh-pmeta">${roleBadge(p.role)}<em>AGE ${p.age ?? '?'}</em></span>
            <div class="mc-bars sh-bars">${bars}</div>
          </div>
        </div>
        <div class="sh-after"></div>
      </div>`;
    scr.root.appendChild(sheet);
    hydrateFaces(sheet);
    const after = sheet.querySelector<HTMLElement>('.sh-after')!;
    let flipped = false;
    let ticks: number[] = [];
    const flip = () => {
      if (flipped || !sheet) return;
      flipped = true;
      ticks.forEach((t) => window.clearTimeout(t));
      ticks = [];
      sheet.classList.add('flipped');
      sfx.whoosh();
      // The bigger the pull, the bigger the noise: a coin, the power-up chime, a cheer, the stadium horn.
      if (card.rarity === 'legend') sfx.goal();
      else if (card.rarity === 'epic') {
        sfx.powerup();
        sfx.cheer(0.8);
      } else if (card.rarity === 'rare') sfx.powerup();
      else sfx.coin();
      window.setTimeout(drawAfter, 380);
    };
    const drawAfter = () => {
      if (!sheet) return;
      const c = clubOf();
      if (!c) return;
      const full = c.squad.length >= SQUAD_MAX;
      const out = full ? releaseCandidate(c) : -1;
      const gone = out >= 0 ? c.squad[out] : null;
      const st = careerState(app);
      const overWages = squadWages(c) + wageOf(p) > wageBudget(st.season?.division ?? 6, st.stadium);
      // What signing him would do to the XI (worked out on a copy of the squad, the sub who would go left out).
      const copy = { ...c, squad: c.squad.filter((_, i) => i !== out) };
      const trial = signCard(copy, card);
      const lift = trial.ok && trial.starter && trial.replaced
        ? `<b>STRAIGHT INTO YOUR XI</b>${sep()}REPLACES ${esc(lastName(trial.replaced.name).toUpperCase())} (${overall(trial.replaced)})${
          trial.ovrTo > trial.ovrFrom ? `${sep()}CLUB OVR ${trial.ovrFrom} TO ${trial.ovrTo}` : ''}`
        : '<b>SQUAD DEPTH</b>: he would start on the bench';
      after.innerHTML = `
        <p class="sh-verdict">${lift}</p>
        ${overWages ? '<p class="sh-warn">Over your wage budget: wages would cost coins after each ROAD TO GLORY match.</p>' : ''}
        <div class="btn-row no-stick">
          <button class="btn btn-white" data-a="sell">SELL ${coin(value)}</button>
          ${full
            ? gone ? `<button class="btn btn-go btn-lg" data-a="swap">LET ${esc(lastName(gone.name).toUpperCase())} GO AND SIGN</button>` : ''
            : '<button class="btn btn-go btn-lg" data-a="sign">SIGN HIM</button>'}
        </div>`;
      after.classList.add('on');
      after.querySelector<HTMLElement>('button[data-a=sign], button[data-a=swap]')?.focus({ preventScroll: true });
    };
    const sign = (swap: boolean) => {
      const st = careerState(app);
      const c = st.club;
      if (!c) return;
      let let_go = '';
      if (swap) {
        const r = makeRoom(st, save);
        if (!r.ok) {
          say('NOBODY CAN GO RIGHT NOW', 'bad');
          return;
        }
        let_go = ` (${lastName(r.player.name).toUpperCase()} LEFT, +${fmt(r.coins)})`;
      }
      const r = signCard(c, card, price || packPrice('scout', clubRating(c)), st.season?.number ?? 1);
      if (!r.ok) {
        say(`SQUAD FULL (${SQUAD_MAX} MAX)`, 'bad');
        return;
      }
      settlePack(save);
      app.persist();
      sfx.coin();
      closeSheet();
      draw();
      const lifted = r.ovrTo > r.ovrFrom ? `: CLUB OVR ${r.ovrFrom} TO ${r.ovrTo}` : '';
      say(r.starter ? `${p.name.toUpperCase()} STARTS${lifted}${let_go}` : `${p.name.toUpperCase()} JOINS THE BENCH${let_go}`, 'good');
    };
    sheet.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-a]');
      if (!flipped) {
        flip();
        return;
      }
      if (!el) return;
      sfx.click();
      if (el.dataset.a === 'sign') sign(false);
      else if (el.dataset.a === 'swap') sign(true);
      else if (el.dataset.a === 'sell') {
        const v = sellCard(save, card);
        settlePack(save);
        app.persist();
        sfx.coin();
        closeSheet();
        draw();
        say(`SOLD ${p.name.toUpperCase()} +${fmt(v)}`, 'info');
      }
    });
    // The build-up: the card shakes harder and glows in the rarity's colour, ticking faster, then turns.
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const beats = reduced ? [0] : [0, 380, 680, 900, 1060, 1180];
    beats.forEach((ms, i) => ticks.push(window.setTimeout(() => {
      if (!sheet) return;
      sheet.style.setProperty('--charge', String((i + 1) / beats.length));
      sfx.click();
    }, ms)));
    ticks.push(window.setTimeout(flip, reduced ? 200 : 1450));
  };

  // ---- drawing

  const draw = () => {
    const cats = TABS.filter(([k]) => k !== 'coins' || coinsTab()).map(([k, long, short]) => {
      const dot = k === 'players' ? freePackReady(save, today()) : false;
      return `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}"><span class="sh-long">${long}</span><span class="sh-shortl">${short}</span>${dot ? '<i class="sh-dot">FREE</i>' : ''}</button>`;
    }).join('');
    const body = tab === 'players' ? playersHtml() : tab === 'coins' ? coinsHtml() : catHtml(tab);
    scr.render(
      `${topBar(backLabel, 'SHOP', iap.available ? 'EARN COINS PLAYING OR TOP UP' : 'COINS COME FROM PLAYING', shownCoins)}
      <div class="seg mc-tabs sh-tabs">${cats}</div>
      ${body}`,
      handlers,
    );
    hydrateFaces(scr.panel);
    // The wallet runs down to its new total after a purchase.
    const span = scr.panel.querySelector<HTMLElement>('.mc-top .coins span');
    if (span && shownCoins !== save.coins) runCoins(span, shownCoins, save.coins);
    shownCoins = save.coins;
    popKey = '';
    if (isCat(tab)) {
      const cv = scr.panel.querySelector<HTMLCanvasElement>('.sh-3d');
      if (cv) stage.attach(cv);
      markSeen(save, tab);
      app.persist();
    }
  };

  const showItem = (cat: ShopCat, id: string) => {
    pick[cat] = id;
    stage.set({ cat, id });
  };

  const handlers = {
    // (A pack being opened has to be signed or sold first: its card is paid for.)
    back: () => {
      if (!sheet) back();
    },
    tab: (el: HTMLElement) => {
      tab = el.dataset.v as ShopTab;
      scr.panel.scrollTop = 0;
      if (isCat(tab)) stage.set({ cat: tab, id: pick[tab] });
      draw();
    },
    // TODAY'S DEAL: its tab, with the look on the stage.
    deal: () => {
      const d = dailyDeal(save, today());
      if (!d) return;
      tab = d.item.cat;
      scr.panel.scrollTop = 0;
      showItem(d.item.cat, d.item.id);
      draw();
    },
    pick: (el: HTMLElement) => {
      if (!isCat(tab)) return;
      showItem(tab, el.dataset.id ?? DEFAULT_ID[tab]);
      draw();
    },
    buy: () => {
      if (!isCat(tab)) return;
      const id = pick[tab];
      const before = save.coins;
      const r = buyItem(save, tab, id, today());
      if (!r.ok) {
        if (r.reason === 'no-coins') {
          say(`${fmt(r.short)} MORE COINS NEEDED`, 'bad');
          scr.panel.querySelector('.sh-act')?.classList.remove('nope');
          void (scr.panel.querySelector('.sh-act') as HTMLElement | null)?.offsetWidth;
          scr.panel.querySelector('.sh-act')?.classList.add('nope');
        }
        return;
      }
      // Bought: it goes straight on, the coins run down, the tile pops and the stage bursts.
      equipItem(save, tab, id);
      app.persist();
      shownCoins = before;
      popKey = itemKey(tab, id);
      sfx.coin();
      window.setTimeout(() => sfx.powerup(), 120);
      draw();
      burst(scr, r.item);
      say(`${r.item.name.toUpperCase()} IS YOURS. EQUIPPED!`, 'good');
    },
    equip: () => {
      if (!isCat(tab)) return;
      if (equipItem(save, tab, pick[tab])) {
        app.persist();
        sfx.coin();
        draw();
        say(`${(shopItem(tab, pick[tab])?.name ?? '').toUpperCase()} EQUIPPED`, 'good');
      }
    },
    found: () => {
      clubCreate(app, () => shopScreen(app, 'players', back, backLabel, clubOf), () => shopScreen(app, 'players', back, backLabel, clubOf));
    },
    squad: () => {
      // MY CLUB's squad screen, BACK returning here.
      openClub(app, { tab: 'squad', backLabel: 'SHOP', onBack: () => shopScreen(app, 'players', back, backLabel, clubOf) });
    },
    market: () => {
      openMarket(app, { backLabel: 'SHOP', onBack: () => shopScreen(app, 'players', back, backLabel, clubOf) });
    },
    pack: (el: HTMLElement) => {
      const kind = (el.dataset.k === 'elite' ? 'elite' : 'scout') as PackKind;
      const free = el.dataset.free === '1';
      const before = save.coins;
      const r = openPack(save, clubOf(), kind, today(), free);
      if (!r.ok) {
        if (r.reason === 'no-tokens') say(`${r.short} MORE SCOUT ${r.short === 1 ? 'TOKEN' : 'TOKENS'} NEEDED. DAILY CHALLENGES EARN THEM`, 'bad');
        else if (r.reason === 'free-used') say('TODAY\'S FREE PACK IS OPENED. BACK TOMORROW', 'info');
        return;
      }
      app.persist();
      shownCoins = before;
      sfx.coin();
      draw();
      reveal(r.card, r.price);
    },
    // A coin pack, the Starter Pack or NO ADS: the store takes the payment and the grant listener (above) does the rest.
    iap: async (el: HTMLElement) => {
      const id = el.dataset.id;
      if (!id || busy) return;
      busy = id;
      draw();
      const r = await iap.buy(id);
      busy = '';
      // (A paid purchase was drawn by the grant listener already, with the wallet running up.)
      if (r !== 'ok') draw();
      if (r === 'cancelled') say('NO PROBLEM. NOTHING WAS CHARGED', 'info');
      else if (r === 'pending') say('WAITING FOR THE STORE. YOUR COINS ARRIVE WHEN IT CONFIRMS', 'info');
      else if (r === 'failed') say('THAT DID NOT GO THROUGH. TRY AGAIN IN A MOMENT', 'bad');
    },
    restore: async () => {
      if (busy) return;
      busy = 'restore';
      draw();
      const r = await iap.restore();
      busy = '';
      // (What came back was drawn as it arrived, the wallet running up: let that finish before the button comes back.)
      if (r.restored.length) window.setTimeout(draw, 700);
      else draw();
      if (!r.ok) say('COULD NOT REACH THE STORE. TRY AGAIN LATER', 'bad');
      else if (r.restored.length) say('PURCHASES RESTORED', 'good');
      else say('NOTHING NEW TO RESTORE', 'info');
    },
    // Only ever on the player's own tap (the portals' rule): no ad starts by itself.
    ad: async () => {
      if (busy) return;
      if (freeAdsLeft(save, localDay()) <= 0) {
        say('ALL OF TODAY\'S FREE COINS ARE USED. BACK TOMORROW', 'info');
        return;
      }
      if (!ads.rewardedAvailable) {
        say('NO AD RIGHT NOW. TRY AGAIN LATER', 'info');
        return;
      }
      busy = 'ad';
      draw();
      const watched = await ads.rewarded();
      busy = '';
      // (Read the day again: an ad can run across midnight.)
      const r = watched ? claimFreeAd(save, localDay()) : null;
      if (r?.ok) {
        app.persist();
        shownCoins = Math.min(shownCoins, r.coins - FREE_AD_COINS);
        sfx.coin();
        draw();
        say(`+${FREE_AD_COINS} COINS${r.left > 0 ? `. ${r.left} MORE ${r.left === 1 ? 'AD' : 'ADS'} TODAY` : '. THAT IS TODAY\'S LAST ONE'}`, 'good');
        return;
      }
      draw();
      say(watched ? 'ALL OF TODAY\'S FREE COINS ARE USED. BACK TOMORROW' : 'THE AD DID NOT FINISH, SO NO COINS THIS TIME', 'info');
    },
  };

  if (isCat(tab)) stage.set({ cat: tab, id: pick[tab] });
  draw();
  // (In the app the next ad loads after each one plays: the FREE COINS card lights up again when it's in.)
  onMetaClose(ads.onAdReady(() => {
    if (tab === 'coins' && !busy) draw();
  }));
  // A pack opened last time but never signed or sold (the tab closed mid-reveal): its card is still yours.
  const waiting = pendingCard(save, clubOf());
  if (waiting) reveal(waiting.card, waiting.price);
}

/** One line for what a purchase handed over: "+2,000 COINS AND THE GOLD BALL LOOK", "NO ADS IS ON". */
function grantText(g: IapGrant): string {
  const things: string[] = [];
  if (g.coins) things.push(`+${fmt(g.coins)} COINS`);
  for (const key of g.items) {
    const [cat, id] = key.split(':') as [ShopCat, string];
    const it = shopItem(cat, id);
    if (it) things.push(`THE ${it.name.toUpperCase()} ${CAT_LABEL[it.cat].toUpperCase()}`);
  }
  if (g.noAds) things.push('NO ADS IS ON');
  if (g.pass) things.push('THE CLUB PASS IS ON: CLAIM YOUR TIERS IN BADGES, SEASON');
  if (g.doubler) things.push('EVERY MATCH NOW PAYS DOUBLE');
  if (g.firstBonus) things.push('FIRST BUY DOUBLED');
  return things.length ? things.join(' AND ') : 'THANK YOU';
}

function lastName(name: string): string {
  const parts = name.split(' ');
  return parts[parts.length - 1] ?? name;
}

/** The top bar's coin count running from `from` to `to` (a purchase: down; a sale: up). */
function runCoins(span: HTMLElement, from: number, to: number): void {
  const t0 = performance.now();
  const chip = span.closest('.coins');
  chip?.classList.add('spend');
  const tick = () => {
    if (!span.isConnected) return;
    const k = Math.min(1, (performance.now() - t0) / 650);
    span.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
    else chip?.classList.remove('spend');
  };
  tick();
}

/** A shower of pixel bits over the stage in the item's colours (the purchase moment). */
function burst(scr: MetaScreen, it: ShopItem): void {
  const host = scr.panel.querySelector<HTMLElement>('.sh-burst');
  if (!host) return;
  const cols =
    it.cat === 'goalfx' ? GOAL_FX_COLORS[it.id as keyof typeof GOAL_FX_COLORS] ?? [0xffd23a]
      : it.cat === 'trail' ? TRAIL_COLORS[it.id as keyof typeof TRAIL_COLORS]
        : [0xffd23a, 0xfbfbf4, 0x3cc15a, 0x2f7be8];
  let html = '';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
    const d = 70 + Math.random() * 90;
    html += `<i style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d - 30)}px;--c:${cssHex(cols[i % cols.length])};--d:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
  }
  host.innerHTML = html;
  host.classList.remove('on');
  void host.offsetWidth;
  host.classList.add('on');
}
