/**
 * The SHOP (from the coins on the main menu). A compact rail on the left, grouped the way players shop:
 * - FEATURED: this week's shelf (a set as the hero and four looks, new every Monday) and every THEMED SET, with a
 *   COMPLETE THE SET price for the ones you have started;
 * - LOOKS: premium KITS, PLAYER looks (hair, headgear, armband, boots, gloves, shades; by slot), BALLS;
 * - GOALS: goal explosions (GOAL FX), sprint TRAILS, CELEBrations;
 * - STADIUM style for your home ground (by slot);
 * - SCOUT: scout packs for MY CLUB (a random card, earned tokens only) and the way into the transfer market;
 * - STORE: everything to do with money and gems, in five sections: GEMS (the gem packs where a store sells them,
 *   the iOS and Android apps: platform/iap.ts; the free daily gems), COINS (gems swapped for coins at a shown rate,
 *   FREE COINS from a few rewarded ads a day), OFFERS (the PRO bundle, the Starter Pack, NO ADS, the Coin Doubler),
 *   CLUB (the Scouting Network, and what else gems do), and CLUB PASS (its rewards and both purchase options).
 * Every look is master and detail (docs/UX.md): tiles on the left, the picked look live on a 3D stage on the right
 * (ui/shopStage.ts) with one-tap BUY, TRY IT ON (your whole team in it, with your ball, lawn and goal explosion) and,
 * for kits, the whole line-up and a night view. Rules live in meta/shop.ts; this file only draws them.
 * Honest by design: every price on show, no timers, nothing random for money or gems, nothing that changes a match,
 * and every gem spend asks once with its price (ui/gemUi.ts confirmGems).
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { localDay } from '../core/day';
import { STAT_SHORT, KEY_STATS, SQUAD_MAX, clubRating, type ClubState } from '../meta/career';
import { PRESET_CLUBS, makeTeam } from '../meta/data';
import {
  BUNDLES, BUNDLE_OFF, CAT_LABEL, FREE_AD_COINS, FREE_AD_DAILY_CAP, LOOK_WHO, PACKS, PACK_TOKENS, RARITIES, RARITY_OVR, SHOP_CATS,
  SLOT_LABEL, DEAL_OFF, ITEM_TIER_NAMES, bundleItems, bundleMissing, bundleOf, bundlePrice, bundleValue, buyBundle, buyItem, claimFreeAd,
  dailyDeal, equipItem, equippedId, equippedSlots, featuredShelf, freeAdsLeft, freePackReady, isEquipped, isSlotCat, itemKey, itemTier,
  makeRoom, markSeen, nextDeal, openPack, owns, packPrice, pendingCard, priceOn, releaseCandidate, rerollDeal, scoutTokens, seasonPassItems, sellCard,
  settlePack, shopItem, shopItems, shopOf, signCard, unequipItem,
  type Bundle, type PackCard, type PackKind, type Rarity, type ShopCat, type ShopItem,
} from '../meta/shop';
import { ads } from '../platform/ads';
import { buzz } from '../platform/haptics';
import {
  FIRST_BUY_MULT, PRODUCT_DOUBLER, PRODUCT_NOADS, PRODUCT_PRO, PRODUCT_STARTER, iap, proOffered, type IapGrant, type IapProduct,
} from '../platform/iap';
import { atmosphereOf, decorBonusParts, decorBonusShort, INCOME_CAP } from '../meta/atmosphere';
import {
  COIN_OFFERS, GEM_PRICES, GEM_REWARDS, SCOUT_NETWORKS, buyCoinsWithGems, buyScoutNetwork, coverShortfall, gems, nextScoutNetwork, scoutNetworkTier,
  spendGems, topUpGems,
} from '../meta/gems';
import { AD_CAPS, adsLeft, claimDailyGems, useAd } from '../meta/loops';
import { syncNetwork } from '../meta/premium';
import { syncMasteryRewards } from '../meta/mastery';
import { buyPassWithGems, buySignatureSet, equipSignatureSet, passActive, passTotals, signatureMissing, signaturePrice, signatureSet, signatureSets, syncSignatureEntitlements } from '../meta/pass';
import { openBadges } from './badges';
import type { GroundState } from '../meta/ground';
import { confirmGems, gemArt, gemPrice } from './gemUi';
import { passItemId, seasonOf, seasonTheme, selectJourney } from '../meta/season';
import { RESALE_STARTS, quickSaleValue, scoutResaleCap, squadWages, wageBudget, wageOf } from '../meta/market';
import { GOAL_FX_COLORS, TRAIL_COLORS } from '../render/cosmetics';
import { KIT_DESIGNS } from '../render/kitDesigns';
import { cssHex } from '../render/palette';
import { overall } from '../sim/types';
import { careerState, clubCreate, closeMeta, esc, fmt, mountMeta, onMetaClose, openClub, roleBadge, topBar, type MetaScreen } from './club';
import { openMarket } from './market';
import { shirtArt } from './menus';
import { pixelIcon } from './pixelIcons';
import { faceHtml, hydrateFaces } from './preview';
import { ShopStage, type StageClub, type StageShow, type StageWear } from './shopStage';
import { sep } from './text';
import { gemPackBadge } from './storeOffers';
import './shop.css';
import './store.css';

export type ShopTab = 'featured' | 'signature' | ShopCat | 'players' | 'coins';

const isCat = (t: ShopTab): t is ShopCat => (SHOP_CATS as readonly string[]).includes(t);

/**
 * The STORE tab is in every build (economy v3): gems are earned by playing everywhere, so there is always something
 * to swap them for (coins, the Club Pass, the Scouting Network). The app adds its store's products (shown even before
 * the store has answered, see Iap.shelf), a portal its rewarded ads.
 */
function coinsTab(): boolean {
  return true;
}

/** The STORE tab's sections (the chips over its right pane), remembered for the session. */
export type StoreSec = 'gems' | 'coins' | 'offers' | 'club' | 'pass';
const STORE_SECS: readonly { sec: StoreSec; label: string }[] = [
  { sec: 'gems', label: 'GEMS' }, { sec: 'coins', label: 'COINS' }, { sec: 'offers', label: 'OFFERS' }, { sec: 'club', label: 'CLUB' }, { sec: 'pass', label: 'CLUB PASS' },
];
let lastStore: StoreSec = 'gems';

/** A tap on something the app's store can't sell yet (not set up in App Store Connect, offline): said plainly, nothing charged. */
export const STORE_NOT_READY = "THE APP STORE ISN'T READY YET. TRY AGAIN SOON";

let open = false;
/** The shop is on screen (main.ts then leaves a late purchase's message to it). */
export function shopOpen(): boolean {
  return open;
}

// This session's memory (docs/UX.md 8): the last tab, the look picked per category, the slot filter, the featured
// pick, TRY IT ON and the kit view, and each list's scroll.
let lastTab: ShopTab | null = null;
const lastPick: Partial<Record<ShopCat, string>> = {};
const lastSlot: Partial<Record<ShopCat, string>> = {};
let lastFeat: FeatPick | null = null;
let tryMode = false;
let kitView: 'solo' | 'team' = 'solo';
const scrolls = new Map<string, number>();

/** What FEATURED has picked: a set, or one of the shelf's looks. */
type FeatPick = { kind: 'set'; id: string } | { kind: 'item'; cat: ShopCat; id: string };

/** Note every keyed list's scroll (`data-scroll-key`) before the panel is redrawn... */
function keepScrolls(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
    scrolls.set(el.dataset.scrollKey ?? '', el.classList.contains('x') ? el.scrollLeft : el.scrollTop);
  });
}

/** ...and put it back after (a list never jumps to the top because something was bought or picked). */
function restoreScrolls(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
    const v = scrolls.get(el.dataset.scrollKey ?? '');
    if (v === undefined) return;
    if (el.classList.contains('x')) el.scrollLeft = v;
    else el.scrollTop = v;
  });
}

/**
 * Scroll `el` into view inside its own list only (scrollIntoView could move the fixed panel too). Layout offsets
 * (the list is positioned), not client rects: the panel may still be mid entrance animation.
 */
function revealIn(list: HTMLElement, el: HTMLElement): void {
  const top = el.offsetTop - 12;
  const bottom = el.offsetTop + el.offsetHeight + 10;
  if (top < list.scrollTop) list.scrollTop = Math.max(0, top);
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

export interface ShopOpts {
  tab?: ShopTab;
  /** On the STORE tab ('coins'): the section to open (GEMS unless said, or this session's last). */
  section?: StoreSec;
  /** An item to have picked on that tab (a look id; on FEATURED a set id). */
  pick?: string;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

/**
 * The rail: icon, label and group (a gap between groups: FEATURED, the LOOKS, the GOALS, the rest, the money). GOALS
 * holds the goal explosions, trails and celebrations behind chips, so the rail keeps 8 rows a thumb can hit.
 */
type RailTab = ShopTab | 'goals';
const RAIL: readonly { tab: RailTab; label: string; icon: string; group: number }[] = [
  { tab: 'featured', label: 'FEATURED', icon: 'star', group: 0 },
  { tab: 'signature', label: 'SIGNATURES', icon: 'crown', group: 0 },
  { tab: 'kit', label: 'KITS', icon: 'shirt', group: 1 },
  { tab: 'look', label: 'PLAYERS', icon: 'crown', group: 1 },
  { tab: 'ball', label: 'BALLS', icon: 'ball', group: 1 },
  { tab: 'goals', label: 'GOALS', icon: 'burst', group: 2 },
  { tab: 'decor', label: 'STADIUM', icon: 'flag', group: 2 },
  { tab: 'players', label: 'SCOUT', icon: 'duo', group: 3 },
  { tab: 'coins', label: 'STORE', icon: 'gift', group: 4 },
];
/** The GOALS section's chips. */
const GOALS: readonly { tab: ShopCat; label: string }[] = [
  { tab: 'goalfx', label: 'GOAL FX' }, { tab: 'trail', label: 'TRAILS' }, { tab: 'celebration', label: 'CELEBRATIONS' },
];
const isGoals = (t: ShopTab): boolean => t === 'goalfx' || t === 'trail' || t === 'celebration';
let lastGoals: ShopCat = 'goalfx';

/** The slots of the slot categories, in shop order (the filter chips). */
const SLOTS: { readonly [k in 'look' | 'decor']: readonly string[] } = {
  look: ['hair', 'head', 'arm', 'boots', 'gloves', 'shades'],
  decor: ['pitch', 'net', 'flags', 'seats', 'tifo', 'kickoff', 'lights', 'mascot'],
};
/** The chip words (short, no hyphens). */
const SLOT_CHIP: { readonly [k: string]: string } = {
  hair: 'HAIR', head: 'HEAD', arm: 'ARMBAND', boots: 'BOOTS', gloves: 'GLOVES', shades: 'SHADES',
  pitch: 'PITCH', net: 'NETS', flags: 'FLAGS', seats: 'SEATS', tifo: 'CROWD', kickoff: 'KICK OFF', lights: 'LIGHTS', mascot: 'MASCOT',
};

/** Kits and looks with a glowing part (the stage offers the NIGHT view for them). */
const GLOWS = new Set(['inferno', 'bolt', 'galaxy', 'neonglow', 'pass10', 'pass11', 'headband', 'halo', 'flamehair', 'bootneon', 'bootlight', 'shadestar', 'glovefire']);

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

/** Crisp pixel art for a gem pack: 1 to 5 gems in a pile (the bigger the pack the bigger the pile). */
function gemPile(tier: number): string {
  const n = Math.max(1, Math.min(5, tier));
  // (Centres on a 5 by 2 grid of slots, bottom row first, so the pile grows like the coins'.)
  const spots: [number, number][] = [[2, 1], [1, 1], [3, 1], [1.5, 0], [2.5, 0]];
  const shown = spots.slice(0, n);
  const minX = Math.min(...shown.map((p) => p[0]));
  const maxX = Math.max(...shown.map((p) => p[0]));
  const off = 2 - (minX + maxX) / 2;
  const one = (x: number, y: number): string => `<span style="left:${((x + off) / 4) * 100}%;top:${n > 3 ? (y === 0 ? 18 : 62) : 50}%">${gemArt(2.4)}</span>`;
  return `<span class="sh-gempile" aria-hidden="true">${shown.map(([x, y]) => one(x, y)).join('')}</span>`;
}

/** A small play triangle for the watch-an-ad button. */
const PLAY_ART = '<svg class="sh-play" viewBox="0 0 7 7" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v7H0zM1 1h1v5H1zM2 1h1v5H2zM3 2h1v3H3zM4 2h1v3H4zM5 3h1v1H5z" fill="currentColor"/></svg>';

/** The pixel icon for a category (rail, set parts). */
const CAT_ICON: { readonly [k in ShopCat]: string } = {
  celebration: 'trophy', ball: 'ball', goalfx: 'burst', trail: 'bolt', kit: 'shirt', look: 'crown', decor: 'flag',
};

/** Tile stills (3D shots), cached across visits by item, kit and what is worn. */
const stills = new Map<string, string>();

/** Who stands on the stage: MY CLUB's captain, four team-mates and a keeper in its kit, else the Quick Match club's. */
function stageClub(app: AppContext, club: ClubState | null): StageClub {
  if (club) {
    const xi = club.squad.slice(0, 11);
    const out = xi.filter((p) => p.role !== 'GK').sort((a, b) => overall(b) - overall(a));
    const keeper = xi.find((p) => p.role === 'GK') ?? club.squad.find((p) => p.role === 'GK');
    if (out.length) return { kit: club.kit, short: club.short, name: club.name, star: out[0], mates: out.slice(1, 5), keeper: keeper ?? out[out.length - 1] };
  }
  const seed = PRESET_CLUBS[app.save.clubIdx] ?? PRESET_CLUBS[0];
  const team = makeTeam(seed);
  const out = team.players.filter((p) => p.role !== 'GK').sort((a, b) => overall(b) - overall(a));
  return { kit: seed.kit, short: team.short, name: team.name, star: out[0] ?? team.players[9], mates: out.slice(1, 5), keeper: team.players[0] };
}

/** Open the shop (FEATURED unless `opts.tab` or this session's last tab says otherwise). */
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
  const tab = opts.tab ?? lastTab ?? 'featured';
  if (opts.section) lastStore = opts.section;
  if (opts.pick) {
    if (tab === 'featured') lastFeat = { kind: 'set', id: opts.pick };
    else if (isCat(tab)) lastPick[tab] = opts.pick;
  }
  shopScreen(app, tab, back, backLabel, clubOf);
}

function shopScreen(app: AppContext, tab0: ShopTab, back: () => void, backLabel: string, clubOf: () => ClubState | null): void {
  const scr = mountMeta(app, 'sh-screen shell');
  const save = app.save;
  shopOf(save);
  if ([...syncSignatureEntitlements(save), ...syncMasteryRewards(save)].length) app.persist();
  let signaturePick = passItemId(seasonOf(save).id);
  let signaturePiece = -1;
  let tab: ShopTab = tab0 === 'coins' && !coinsTab() ? 'featured' : tab0;
  if (isGoals(tab)) lastGoals = tab as ShopCat;
  open = true;
  onMetaClose(() => {
    open = false;
  });
  /** The item on the stage, per category (this session's pick, else the equipped one, else the first). */
  const pickOf = (cat: ShopCat): string => {
    const id = lastPick[cat];
    if (id && shopItem(cat, id)) return id;
    if (isSlotCat(cat)) return Object.values(equippedSlots(save, cat))[0] ?? shopItems(cat).find((x) => !x.pass)?.id ?? '';
    return equippedId(save, cat);
  };
  const pick = {} as { [k in ShopCat]: string };
  for (const c of SHOP_CATS) pick[c] = pickOf(c);
  const shelf = featuredShelf(today());
  let feat: FeatPick = lastFeat ?? { kind: 'set', id: shelf.bundle.id };
  /** The picked tile is brought into view on the next draw (on opening, and after a jump to it). */
  let revealPick = true;
  const club = stageClub(app, clubOf());
  const stage = new ShopStage(club);
  onMetaClose(() => stage.dispose());
  stage.view = kitView;
  const kitKey = `${club.star.id}|${club.kit.shirt}|${club.kit.shirt2}|${club.kit.pattern}`;
  /** Coins shown in the top bar before the last purchase (the counter runs down from it). */
  let shownCoins = save.coins;
  /** Gems as last drawn (the counter pops when they change). */
  let shownGems = gems(save);
  /** The STORE tab's section. */
  let sec: StoreSec = lastStore;
  let popKey = '';

  const say = (msg: string, kind: 'good' | 'bad' | 'info' = 'good') => scr.toast(msg, kind);

  /** What the team wears now (the stage dresses everyone in it, but the item on show). */
  const wearOf = (): StageWear => ({
    kit: equippedId(save, 'kit'), looks: equippedSlots(save, 'look'), ball: equippedId(save, 'ball'), goalfx: equippedId(save, 'goalfx'),
    decor: equippedSlots(save, 'decor'),
  });
  let wearKey = JSON.stringify(wearOf());
  stage.setWear(wearOf());
  /** After an equip or a purchase: the stage's team changes, and the stills that showed the old outfit go. */
  const rewear = () => {
    const w = wearOf();
    const k = JSON.stringify(w);
    if (k === wearKey) return;
    wearKey = k;
    stage.setWear(w);
  };

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
    buzz('success');
    rewear();
    draw();
    // (A restore reports once, as a whole: see handlers.restore.)
    if (!g.restored) say(grantText(g), 'good');
  });
  onMetaClose(offGrant);
  onMetaClose(iap.onStateChange(() => { if (!busy) draw(); }));

  const storeHtml = (): string => {
    // (Every product, the store's own where it has them; until it answers, stand-ins at the catalogue price.)
    const list = iap.shelf();
    const packs = list.filter((p) => p.kind === 'consumable' && !p.pass && p.gems > 0);
    const starter = list.find((p) => p.id === PRODUCT_STARTER);
    const noAds = list.find((p) => p.id === PRODUCT_NOADS);
    const pass = list.find((p) => p.pass);
    const doubler = list.find((p) => p.id === PRODUCT_DOUBLER);
    const pro = list.find((p) => p.id === PRODUCT_PRO);
    const off = busy !== '' ? 'disabled' : '';
    const have = gems(save);
    const label = (p: IapProduct) => esc(busy === p.id ? 'ONE MOMENT' : p.price);
    // A gem pack: what you get in big numbers (doubled on the first buy, and it says so), the store's price.
    const pack = (p: IapProduct, i: number) => {
      const total = p.gems * (p.firstBonus ? FIRST_BUY_MULT : 1);
      const badge = gemPackBadge(p);
      return `<button class="sh-iap gem ${p.tag ? 'tagged' : ''} ${busy === p.id ? 'wait' : ''}" data-a="iap" data-id="${esc(p.id)}" ${off}
        aria-label="${fmt(total)} gems, ${esc(p.price)}${p.firstBonus ? ', doubled on your first buy' : badge ? `, ${badge.toLowerCase()}` : ''}">
        ${badge ? `<i class="sh-ribbon ${p.firstBonus ? 'first' : p.tag === 'BEST VALUE' ? 'best' : 'pop'}">${badge}</i>` : ''}
        <span class="sh-pile gems">${gemPile(i + 1)}</span>
        <b>${fmt(total)}</b>
        <small>${p.firstBonus ? 'GEMS, DOUBLED' : p.bonusPct ? `GEMS +${p.bonusPct}%` : 'GEMS'}</small>
        <em class="sh-tag price buy">${label(p)}</em>
      </button>`;
    };
    // Gems swapped for coins: the coins in big numbers, the gem price on the tag (a tap asks once, with the price).
    const swap = (o: (typeof COIN_OFFERS)[number], i: number) => `<button class="sh-iap ${o.tag ? 'tagged' : ''} ${have < o.gems ? 'poor' : ''}" data-a="swap" data-id="${o.id}"
        aria-label="${fmt(o.coins)} coins for ${o.gems} gems${o.tag ? `, ${o.tag.toLowerCase()}` : ''}">
        ${o.tag ? `<i class="sh-ribbon ${o.tag === 'BEST VALUE' ? 'best' : 'pop'}">${o.tag}</i>` : ''}
        <span class="sh-pile">${coinPile(i + 1)}</span>
        <b>${fmt(o.coins)}</b>
        <small>COINS</small>
        <em class="sh-tag price ${have < o.gems ? 'poor' : 'buy'}">${gemPrice(o.gems)}</em>
      </button>`;
    // A compact offer: icon, name, a few words, the price on its button (or OWNED).
    const offer = (cls: string, p: IapProduct, icon: string, name: string, what: string, btn: string) => `<section class="sh-offer ${cls}">
        <span class="sh-offart" aria-hidden="true">${icon}</span>
        <div class="sh-offtxt"><b>${name}</b><small>${what}</small></div>
        ${p.owned ? '<em class="sh-tag own">OWNED</em>' : `<button class="btn ${btn} sh-offbuy" data-a="iap" data-id="${esc(p.id)}" ${off} aria-label="${name}, ${esc(p.price)}">${label(p)}</button>`}
      </section>`;
    const season = seasonOf(save);
    const theme = seasonTheme(season.id).name.toUpperCase();
    const totals = passTotals(season.id);
    const newLooks = totals.items.filter(it => !owns(save, it.cat, it.id)).length;
    const passOn = passActive(save);
    const passPending = !!save.iap?.pendingPass;
    // The pass has its own section so its full reward list and both prices have room on phones.
    // Tiers already reached unlock at once.
    const passCard = `<section class="sh-passcard ${passOn ? 'on' : ''}">
          <div class="sh-pc-details"><span class="sh-pc-ic" aria-hidden="true">${pixelIcon('crown', '#ffd23a', 4)}</span>
          <b class="sh-pc-name">CLUB PASS</b>
          <small class="sh-pc-theme">${esc(theme)}${sep()}PERMANENT JOURNEY</small>
          <ul class="sh-pc-facts">
            <li><b>+${fmt(totals.coins)}</b>COINS</li>
            <li><b>+${fmt(totals.gems)}</b>GEMS</li>
            <li><b>${newLooks}</b>NEW PASS LOOKS</li>
          </ul>
          <small class="sh-pc-note">PERMANENT FOR THIS JOURNEY. CEREMONY NOW; THE REST ON ITS TIERS. OWNED LOOKS ARE ALREADY YOURS</small>
          </div><div class="sh-pc-actions"><button class="btn btn-white" data-a="signaturepick" data-id="${passItemId(season.id)}">PREVIEW ALL SIX</button>
          ${passOn ? '<em class="sh-tag own sh-pc-on">OWNED FOR GOOD</em>' : `
            ${pass ? `<button class="btn btn-yellow btn-lg sh-pc-buy" data-a="iap" data-id="${esc(pass.id)}" ${off} ${passPending ? 'disabled' : ''} aria-label="Get the Club Pass, ${esc(pass.price)}"><small>GET IT</small><b>${label(pass)}</b></button>` : ''}
            <button class="btn btn-white sh-pc-gems" data-a="passgems" ${off} ${passPending ? 'disabled' : ''} aria-label="Get the Club Pass for ${GEM_PRICES.clubPass} gems">${pass ? 'OR' : 'GET IT'} ${gemPrice(GEM_PRICES.clubPass)}</button>`}
          ${passPending ? '<small class="sh-pc-note">STORE PAYMENT PENDING. NO NEED TO BUY AGAIN</small>' : ''}</div>
        </section>`;
    const chips = `<div class="chips sh-slots sh-secs x" data-scroll-key="sh-store-sections" role="group" aria-label="Store sections">${STORE_SECS.map((x) =>
      `<button class="${x.sec === sec ? 'on' : ''}" data-a="sec" data-v="${x.sec}" aria-pressed="${x.sec === sec}">${x.label}</button>`).join('')}</div>`;
    let main = '';
    if (sec === 'gems') {
      // The gem packs (the app), the free daily gems (an ad, where there are ads), and where gems come from in play.
      const earn = `<p class="sh-earn"><b>FREE BY PLAYING</b>BOARD GOALS +${GEM_REWARDS.boardObjective}${sep()}CUPS +${GEM_REWARDS.cup}${sep()}WEEKLY +${GEM_REWARDS.weekly}${sep()}DAILY GIFT${sep()}SEASON TIERS</p>`;
      main = `${packs.length ? `<div class="sh-iaps n5">${packs.map(pack).join('')}</div>` : ''}
        <div class="sh-offers n1"><p class="sh-earn"><b>GEMS GIVE YOUR CLUB AN IDENTITY</b>Guaranteed signature collections, the Club Pass, and useful shortcuts. Earn them playing or buy a top-up.<button class="btn btn-blue" data-a="signaturepick">PREVIEW SIGNATURE COLLECTIONS</button></p>${ads.portal !== 'none' ? gemAdHtml() : ''}${earn}</div>`;
    } else if (sec === 'coins') {
      const extra = [
        ads.portal !== 'none' ? freeHtml(false) : '',
        doubler && !doubler.owned ? offer('doubler', doubler, pixelIcon('bolt', '#ffd23a', 3), 'COIN DOUBLER', 'EVERY MATCH PAYS X2', 'btn-white') : '',
      ].filter(Boolean);
      main = `<div class="sh-iaps">${COIN_OFFERS.map(swap).join('')}</div>
        <div class="sh-offers n${extra.length}">${extra.join('')}</div>`;
    } else if (sec === 'offers') {
      // State the bundle contents. Localized StoreKit prices cannot support a saving calculated from US defaults.
      // The PRO bundle only appears while neither permanent benefit is owned.
      const list2 = [
        pro && proOffered(save) ? offer('pro', pro, pixelIcon('crown', '#ffd23a', 3), 'PRO BUNDLE', `NO ADS + DOUBLER + ${fmt(pro.gems)} GEMS`, 'btn-yellow') : '',
        starter && !starter.owned ? offer('starter', starter, pixelIcon('ball', '#ffd23a', 3), 'STARTER PACK', `${fmt(starter.coins)} COINS + ${fmt(starter.gems)} GEMS + GOLD BALL`, 'btn-yellow') : '',
        noAds ? offer('noads', noAds, pixelIcon('film', '#fff', 3), 'REMOVE ADS', 'NO AD BREAKS, FOR GOOD', 'btn-red') : '',
        doubler ? offer('doubler', doubler, pixelIcon('bolt', '#ffd23a', 3), 'COIN DOUBLER', 'EVERY MATCH PAYS X2, FOR GOOD', 'btn-white') : '',
      ].filter(Boolean);
      main = list2.length
        ? `<div class="sh-offers wide n${list2.length}">${list2.join('')}</div>`
        : '<div class="sh-offers n1"><p class="sh-earn"><b>NO OFFERS HERE</b>THE STORE IS IN THE IPHONE AND IPAD APP. EVERYTHING ELSE IS EARNED BY PLAYING</p></div>';
    } else if (sec === 'pass') {
      main = passCard;
    } else {
      main = clubHtml();
    }
    return `${chips}
      <div class="sh-storemain pane-scroll s-${sec}" data-scroll-key="sh-store-${sec}">${main}
      <div class="sh-foot">
        ${iap.storefront ? `<button class="btn btn-white sh-restore" data-a="restore" ${off}>${busy === 'restore' ? 'ONE MOMENT' : 'RESTORE'}</button>` : ''}
        <p class="sh-fine">${iap.storefront && !iap.available ? '<b>STORE NOT READY YET.</b> ' : ''}No cash value. Gems and coins never buy anything random. Signature items are cosmetic. Online friendlies use preset teams.</p>
      </div></div>`;
  };

  /** The STORE's CLUB section: the Scouting Network (permanent tiers, each a stated guarantee) and what else gems do. */
  const clubHtml = (): string => {
    const tier = scoutNetworkTier(save);
    const next = nextScoutNetwork(save);
    const cur = SCOUT_NETWORKS[tier - 1];
    const steps = SCOUT_NETWORKS.map((n) => `<i class="${n.tier <= tier ? 'on' : ''}" aria-hidden="true"></i>`).join('');
    const net = `<section class="sh-net">
        <span class="sh-offart" aria-hidden="true">${pixelIcon('star', '#ffd23a', 3)}</span>
        <div class="sh-offtxt">
          <b>SCOUTING NETWORK <span class="sh-netsteps" aria-label="Tier ${tier} of ${SCOUT_NETWORKS.length}">${steps}</span></b>
          <small>${next ? `${esc(next.name)}: ${esc(next.text)}` : `${esc(cur?.name ?? '')}: ${esc(cur?.text ?? '')}`}</small>
          <small class="sh-netnote">${next ? 'FOR GOOD, FROM YOUR NEXT ACADEMY INTAKE. GUARANTEED, NEVER A CHANCE' : 'THE BEST NETWORK THERE IS. YOURS FOR GOOD'}</small>
        </div>
        ${next ? `<button class="btn btn-go sh-offbuy" data-a="network" aria-label="Buy the ${esc(next.name.toLowerCase())}, ${next.price} gems">${gemPrice(next.price)}</button>` : '<em class="sh-tag own">OWNED</em>'}
      </section>`;
    const use = (what: string, price: string, where: string) => `<li><b>${what}</b><em>${price}</em><small>${where}</small></li>`;
    return `${net}
      <ul class="sh-uses" aria-label="What else gems do">
        ${use('FINISH A BUILD NOW', `${gemPrice(GEM_PRICES.finishBuildPerMatchday)} A MATCHDAY`, 'MY CLUB, STADIUM')}
        ${use('HEAL A PLAYER NOW', gemPrice(GEM_PRICES.healPlayer), 'WHEN HE IS INJURED')}
        ${use('REPLAY A LOST DECIDER', gemPrice(GEM_PRICES.replayMatch), 'AT FULL TIME')}
      </ul>`;
  };

  /** FREE GEMS for one rewarded ad, once a day (meta/loops.ts): the player's tap, a stated reward, a daily cap. */
  const gemAdHtml = (): string => {
    const left = adsLeft(save, 'gem', localDay());
    const ready = ads.rewardedAvailable;
    const state = left <= 0 ? 'done' : !ready ? 'none' : busy === 'gemad' ? 'wait' : 'go';
    const lbl = state === 'done' ? 'DONE TODAY' : state === 'none' ? 'NO AD YET' : state === 'wait' ? 'ONE MOMENT' : `${PLAY_ART}+${GEM_REWARDS.dailyAd}`;
    const note = state === 'done' ? 'BACK TOMORROW' : state === 'none' ? 'TRY AGAIN SOON' : `WATCH AN AD${sep()}${AD_CAPS.gem === 1 ? 'ONCE A DAY' : `${left} LEFT TODAY`}`;
    return `<section class="sh-offer free gemad">
        <span class="sh-offart" aria-hidden="true">${gemArt(3)}</span>
        <div class="sh-offtxt"><b>FREE GEMS</b><small class="sh-left ${state}">${note}</small></div>
        <button class="btn btn-yellow sh-offbuy sh-watch" data-a="gemad" ${state === 'go' ? '' : 'disabled'} aria-label="Watch an ad for ${GEM_REWARDS.dailyAd} gems">${lbl}</button>
      </section>`;
  };

  /** FREE COINS from a rewarded ad: a compact offer beside the store's, or the one big card on a portal. */
  const freeHtml = (big: boolean): string => {
    const left = freeAdsLeft(save, localDay());
    const ready = ads.rewardedAvailable;
    const state = left <= 0 ? 'done' : !ready ? 'none' : busy === 'ad' ? 'wait' : 'go';
    const label = state === 'done' ? 'DONE TODAY' : state === 'none' ? 'NO AD YET' : state === 'wait' ? 'ONE MOMENT' : `${PLAY_ART}+${FREE_AD_COINS}`;
    const note = state === 'done' ? 'BACK TOMORROW' : state === 'none' ? 'TRY AGAIN SOON' : `${left} OF ${FREE_AD_DAILY_CAP} LEFT TODAY`;
    return `<section class="sh-offer free ${big ? 'big' : ''}">
        <span class="sh-offart" aria-hidden="true">${coinPile(3)}</span>
        <div class="sh-offtxt"><b>FREE COINS</b><small class="sh-left ${state}">${big ? `WATCH AN AD FOR ${FREE_AD_COINS}${sep()}` : ''}${note}</small></div>
        <button class="btn btn-yellow sh-offbuy sh-watch ${big ? 'btn-lg' : ''}" data-a="ad" ${state === 'go' ? '' : 'disabled'} aria-label="Watch an ad for ${FREE_AD_COINS} coins">${label}</button>
      </section>`;
  };

  // The STORE: fixed section tabs, with one scrollable product area. No card or price is squeezed to fit the screen height.
  const coinsHtml = (): string => `<div class="sh-content sh-money v3">${storeHtml()}</div>`;

  // ---- tile art (3D stills of the real thing, taken one a frame after a draw; flat art stands in till then)

  const stillQueue: { show: StageShow; key: string }[] = [];
  let stillRaf = 0;
  /** Stills that depend on what the team wears are keyed by it (a kit's still shows the captain's hair, and so on). */
  const stillKey = (show: StageShow): string =>
    `${show.cat}:${show.id}|${kitKey}${show.cat === 'kit' || show.cat === 'look' || show.cat === 'bundle' ? `|${wearKey}` : ''}`;
  const takeStill = () => {
    stillRaf = 0;
    const job = stillQueue.shift();
    if (!job || !scr.panel.isConnected) return;
    let url = stills.get(job.key);
    if (!url) {
      // (A kit faces the lens at the start of its turn; a stadium style once its diorama is going; a set as it lines up.)
      const t = job.show.cat === 'goalfx' || job.show.cat === 'trail' ? undefined : job.show.cat === 'decor' ? 2.2 : job.show.cat === 'bundle' ? 0.6 : job.show.cat === 'kit' ? 0.01 : 1;
      url = stage.still(job.show, t, 144) ?? undefined;
      if (url) stills.set(job.key, url);
    }
    const sel = job.show.cat === 'bundle' ? `.sh-set[data-set="${CSS.escape(job.show.id)}"] .sh-art` : `.sh-tile[data-cat="${job.show.cat}"][data-id="${CSS.escape(job.show.id)}"] .sh-art`;
    if (url) scr.panel.querySelectorAll<HTMLElement>(sel).forEach((art) => (art.innerHTML = `<img class="sh-img" src="${url}" alt="" draggable="false">`));
    if (stillQueue.length) stillRaf = requestAnimationFrame(takeStill);
  };
  onMetaClose(() => cancelAnimationFrame(stillRaf));
  const queueStill = (show: StageShow): string | null => {
    const key = stillKey(show);
    const url = stills.get(key);
    if (url) return url;
    if (stage.ok && !stillQueue.some((j) => j.key === key)) {
      stillQueue.push({ show, key });
      if (!stillRaf) stillRaf = requestAnimationFrame(takeStill);
    }
    return null;
  };

  const flatArt = (it: ShopItem): string => {
    if (it.cat === 'goalfx') return burstArt(it.id === 'club' ? [club.kit.shirt, club.kit.shirt2, 0xffd23a, 0xfbfbf4] : GOAL_FX_COLORS[it.id as keyof typeof GOAL_FX_COLORS]);
    if (it.cat === 'trail') return trailArt(TRAIL_COLORS[it.id as keyof typeof TRAIL_COLORS]);
    if (it.cat === 'kit') {
      const d = KIT_DESIGNS[it.id];
      return shirtArt(d ? { shirt: d.shirt, shirt2: d.shirt2, pattern: d.pattern, shorts: d.shorts, socks: d.socks, gk: 0 } : club.kit, 4);
    }
    return pixelIcon(CAT_ICON[it.cat], it.cat === 'ball' ? '#fbfbf4' : '#ffd23a', 5);
  };

  const artOf = (it: ShopItem): string => {
    let url: string | null | undefined;
    if (it.cat === 'celebration' || it.cat === 'ball') {
      // A characteristic moment of each move (seconds into its loop on the stage), taken at once.
      const key = `${it.cat}:${it.id}|${it.cat === 'celebration' ? `${kitKey}|${wearKey}` : ''}`;
      url = stills.get(key);
      if (!url && stage.ok) {
        const at: { [k: string]: number } = { classic: 0.4, knee: 1.5, shush: 1.6, plane: 0.9, robot: 0.6, backflip: 1.32, pile: 2.6 };
        url = stage.still({ cat: it.cat, id: it.id }, it.cat === 'ball' ? 0.95 : at[it.id] ?? 1, 144) ?? undefined;
        if (url) stills.set(key, url);
      }
    } else url = queueStill({ cat: it.cat, id: it.id });
    return url ? `<img class="sh-img" src="${url}" alt="" draggable="false">` : flatArt(it);
  };

  // ---- items: state, tiles, detail

  /** What a look costs today (today's deal price for the deal look). */
  const priceOf = (it: ShopItem): number => priceOn(save, it, today());
  const dealOf = (it: ShopItem): boolean => priceOf(it) < it.price;

  /** The state an item is in for the wallet and the save ('pass': a Club Pass look not yet earned). */
  const stateOf = (it: ShopItem): 'on' | 'owned' | 'buy' | 'poor' | 'pass' =>
    isEquipped(save, it.cat, it.id) ? 'on' : owns(save, it.cat, it.id) ? 'owned' : it.pass ? 'pass' : save.coins >= priceOf(it) ? 'buy' : 'poor';

  /** The rarity badge (status): every look above COMMON wears one. */
  const tierHtml = (it: ShopItem): string => {
    const t = itemTier(it);
    return t === 'common' ? '' : `<i class="sh-tier t-${t}">${ITEM_TIER_NAMES[t]}</i>`;
  };

  const seen = () => new Set(shopOf(save).seen);
  /** NEW: in reach of the wallet and not yet shown here. */
  const freshOf = (it: ShopItem, s = seen()): boolean => it.price > 0 && it.price <= save.coins && !owns(save, it.cat, it.id) && !s.has(itemKey(it.cat, it.id));

  const tileHtml = (it: ShopItem, selected: boolean, fresh: boolean) => {
    const s = stateOf(it);
    const tag =
      s === 'on' ? `<em class="sh-tag on">${isSlotCat(it.cat) ? 'WORN' : 'EQUIPPED'}</em>`
        : s === 'owned' ? '<em class="sh-tag own">OWNED</em>'
          : s === 'pass' ? '<em class="sh-tag pass">CLUB PASS</em>'
            : `<em class="sh-tag price ${s}">${coin(priceOf(it))}</em>`;
    return `<button class="sh-tile ${s} ${selected ? 'sel' : ''} ${popKey === itemKey(it.cat, it.id) ? 'pop' : ''}" data-a="pick" data-cat="${it.cat}" data-id="${esc(it.id)}"
        aria-label="${esc(it.name)}, ${s === 'on' ? 'equipped' : s === 'owned' ? 'owned' : s === 'pass' ? 'Club Pass' : `${priceOf(it)} coins`}" aria-pressed="${selected}">
      ${fresh ? '<i class="sh-new">NEW</i>' : dealOf(it) && s !== 'on' && s !== 'owned' ? `<i class="sh-new deal">${DEAL_OFF}% OFF</i>` : ''}
      ${tierHtml(it)}
      <span class="sh-art">${artOf(it)}</span>
      <b>${esc(it.name.toUpperCase())}</b>
      ${it.cat === 'decor' ? `<small class="sh-perk">${decorBonusShort(it.id)}</small>` : ''}
      ${tag}
    </button>`;
  };

  /** The first set an item belongs to (the detail's COMPLETE THE SET chip). */
  const setOf = (it: ShopItem): Bundle | undefined => BUNDLES.find((b) => b.parts.some((p) => p.cat === it.cat && p.id === it.id));

  /** The detail pane's action: BUY (one tap), EQUIP, EQUIPPED (and TAKE OFF for a slot), or what's missing. */
  const actionHtml = (it: ShopItem): string => {
    const s = stateOf(it);
    const lv = it.level !== undefined && s !== 'on' && s !== 'owned' && s !== 'pass' ? `FREE AT LV ${it.level}` : '';
    const line = (txt: string, cls = '') => (txt ? `<p class="sh-short ${cls}" id="sh-short">${txt}</p>` : '');
    if (s === 'on') {
      return isSlotCat(it.cat)
        ? '<div class="sh-btns"><button class="btn btn-white btn-lg sh-act" disabled>WORN</button><button class="btn btn-white btn-lg sh-act" data-a="off">TAKE OFF</button></div>'
        : '<div class="sh-btns"><button class="btn btn-white btn-lg sh-act" disabled>EQUIPPED</button></div>';
    }
    if (s === 'owned') return `<div class="sh-btns"><button class="btn btn-go btn-lg sh-act" data-a="equip">${isSlotCat(it.cat) ? 'WEAR IT' : 'EQUIP'}</button></div>`;
    if (s === 'pass') {
      const collectionId = /pass\d{2}$/.exec(it.id)?.[0] ?? passItemId(seasonOf(save).id);
      const current = collectionId === passItemId(seasonOf(save).id);
      return `<div class="sh-btns"><button class="btn btn-blue btn-lg sh-act" data-a="signaturepick" data-id="${esc(collectionId)}">PREVIEW COLLECTION</button></div>
        ${line(current ? 'EARNED ON THIS JOURNEY OR BOUGHT AS A COLLECTION' : 'PERMANENT GEM COLLECTION. EARNED GEMS WORK TOO', 'pass')}`;
    }
    const price = priceOf(it);
    const was = price < it.price ? `<s class="sh-was">${fmt(it.price)}</s> ` : '';
    if (s === 'buy') return `<div class="sh-btns"><button class="btn btn-yellow btn-lg sh-act" data-a="buy">BUY ${was}${coin(price)}</button></div>${line(lv, 'free')}`;
    // Short of coins: gems can cover the difference (a stated price, asked once), else the way to more coins.
    const need = topUpGems(price - save.coins);
    return `<div class="sh-btns">
        <button class="btn btn-white btn-lg sh-act poor" data-a="buy" aria-describedby="sh-short">${was}${coin(price)}</button>
        ${gems(save) >= need
          ? `<button class="btn btn-blue btn-lg sh-more" data-a="topup" aria-label="Cover the ${fmt(price - save.coins)} coins you are short with ${need} gems">ADD ${gemPrice(need)}</button>`
          : '<button class="btn btn-blue btn-lg sh-more" data-a="getcoins">GET COINS</button>'}
      </div>
      ${line(`${fmt(price - save.coins)} SHORT${lv ? `${sep()}${lv}` : ''}`)}`;
  };

  /** The kind line: the category, the slot and who wears it, the rarity. */
  const kindHtml = (it: ShopItem): string => {
    // (Rarity first: on a phone the line is cut at the end. Who wears a look, and where a stadium style shows, after.)
    const t = itemTier(it);
    const parts = t === 'common' ? [] : [`<b class="t-${t}">${ITEM_TIER_NAMES[t]}</b>`];
    if (it.cat === 'look' && it.slot) parts.push(`${SLOT_LABEL[it.slot].toUpperCase()} FOR ${LOOK_WHO[it.slot as keyof typeof LOOK_WHO]}`);
    else if (it.cat === 'decor' && it.slot) parts.push(`HOME GROUND ${SLOT_LABEL[it.slot].toUpperCase()}`);
    else parts.push(CAT_LABEL[it.cat].toUpperCase());
    return parts.join(sep());
  };

  /** What the picked look is (kind, rarity, name, a line on wide screens) and its action. */
  const infoHtml = (it: ShopItem): string => `
      <div class="sh-id">
        <small class="sh-kind">${kindHtml(it)}</small>
        <h3 class="sh-name">${esc(it.name.toUpperCase())}</h3>
        ${it.cat === 'decor' ? `<p class="sh-bonus" aria-label="What it does at your home matches">${decorBonusParts(it.id).map((x) => `<i>${x}</i>`).join('')}</p>` : ''}
        <p class="sh-blurb">${esc(it.blurb)}</p>
      </div>
      <div class="sh-actrow">${actionHtml(it)}</div>`;

  /** The stage's own controls: SOLO and TEAM for kits, NIGHT where something glows, TRY IT ON, and the item's set. */
  const stageCtlHtml = (it: ShopItem | null, set: Bundle | null): string => {
    if (!stage.ok) return '';
    const cosmetic = !!it && it.cat !== 'decor';
    const view = it?.cat === 'kit' && !tryMode
      ? `<div class="sh-seg" role="group" aria-label="Kit view"><button class="${kitView === 'solo' ? 'on' : ''}" data-a="view" data-v="solo" aria-pressed="${kitView === 'solo'}">CAPTAIN</button><button class="${kitView === 'team' ? 'on' : ''}" data-a="view" data-v="team" aria-pressed="${kitView === 'team'}">TEAM</button></div>`
      : '';
    const glow = (it && nighty(it)) || set;
    const night = glow ? `<button class="sh-chip ${stage.night ? 'on' : ''}" data-a="night" aria-pressed="${stage.night}">NIGHT</button>` : '';
    const tryOn = cosmetic ? `<button class="sh-chip try ${tryMode ? 'on' : ''}" data-a="try" aria-pressed="${tryMode}">${tryMode ? 'ITEM VIEW' : 'TRY IT ON'}</button>` : '';
    const inSet = it ? setOf(it) : undefined;
    const nudge = inSet && !set
      ? (() => {
        const have = inSet.parts.length - bundleMissing(save, inSet).length;
        return `<button class="sh-chip set" data-a="seeset" data-set="${inSet.id}" aria-label="Part of the ${esc(inSet.name)}: ${have} of ${inSet.parts.length} owned">${esc(inSet.name.toUpperCase())} ${have}/${inSet.parts.length}</button>`;
      })()
      : '';
    return `<div class="sh-ctl tl">${view}</div><div class="sh-ctl tr">${night}</div><div class="sh-ctl bl">${tryOn}</div><div class="sh-ctl br">${nudge}</div>`;
  };

  /** The detail pane: the look live on the stage, its name and the button. It never scrolls. */
  const detailHtml = (it: ShopItem): string => `<section class="pane sh-detail">
        <div class="sh-stage ${stage.ok ? '' : 'flat'}">
          ${stage.ok ? '<canvas class="sh-3d" aria-hidden="true"></canvas>' : `<span class="sh-art big">${flatArt(it)}</span>`}
          <div class="sh-burst" aria-hidden="true"></div>
          ${stageCtlHtml(it, null)}
        </div>
        <div class="sh-info">${infoHtml(it)}</div>
      </section>`;

  /** Today's deal as a chip over the looks: one look a day at DEAL_OFF % off, honestly rotating. A tap shows it. */
  const dealHtml = (): string => {
    const d = dailyDeal(save, today());
    if (!d) return '';
    const got = owns(save, d.item.cat, d.item.id);
    // A NEW DEAL TODAY: one rewarded ad a day where there are ads (the player's tap), else a few gems (asked first).
    const adOk = ads.portal !== 'none' && adsLeft(save, 'deal', localDay()) > 0;
    const again = `<button class="sh-dealnew" data-a="newdeal" aria-label="A new deal today: ${adOk ? 'watch an ad' : `${GEM_PRICES.dealRefresh} gems`}">${adOk ? PLAY_ART : gemArt(1.4)}<span>NEW</span></button>`;
    return `<button class="sh-dealchip ${got ? 'got' : ''}" data-a="deal" aria-label="Today's deal: ${esc(d.item.name)} ${esc(CAT_LABEL[d.item.cat])}, ${DEAL_OFF}% off, ${d.price} coins">
        <b>TODAY'S DEAL</b><span>${esc(d.item.name.toUpperCase())}</span><em>${got ? 'OWNED' : `${DEAL_OFF}% OFF`}</em>${got ? '' : `<i class="sh-dealprice">${coin(d.price)}</i>`}
      </button>${again}`;
  };

  /**
   * STADIUM's header: your club's ATMOSPHERE from what is worn (and, in ROAD TO GLORY, the ground as built), and what
   * it is worth at every home match (meta/atmosphere.ts). The stadium style's reason to exist, said in one line.
   */
  const atmoHtml = (): string => {
    let ground: GroundState | null = null;
    try {
      ground = clubOf() ? careerState(app).ground : null;
    } catch {
      ground = null;
    }
    const a = atmosphereOf(save, ground);
    const bits = [
      `+${a.income}% INCOME${a.raw.income >= INCOME_CAP ? ' MAX' : ''}`,
      a.crowd ? `+${a.crowd}% CROWD` : '',
      a.chants ? `+${a.chants} ${a.chants === 1 ? 'CHANT' : 'CHANTS'}` : '',
      a.show ? `SHOW +${a.show}` : '',
    ].filter(Boolean);
    return `<div class="sh-atmo" aria-label="Atmosphere ${a.rating} of 100, ${a.word.toLowerCase()}. At your home matches: ${bits.join(', ').toLowerCase()}">
        <span class="sh-atmotop"><b>ATMOSPHERE</b><em>${a.rating}</em><i class="sh-atmobar"><u style="width:${a.rating}%"></u></i><b class="sh-atmoword">${a.word}</b></span>
        <small>${bits.join(sep())}</small>
      </div>`;
  };

  /** The items a category lists: Club Pass looks of this month (to earn) and any earned; past months' stay out. */
  const listOf = (cat: ShopCat): ShopItem[] => {
    const mine = seasonPassItems(seasonOf(save).id);
    const passIds = cat === 'decor' ? [mine.nets.id, mine.entrance.id] : (cat === 'goalfx' || cat === 'trail' || cat === 'kit' || cat === 'look') ? [mine[cat].id] : [];
    return shopItems(cat).filter((x) => !x.pass || passIds.includes(x.id) || owns(save, x.cat, x.id));
  };

  /** A looks tab: slot chips (players, stadium), the tiles (the only thing that scrolls), the stage and BUY. */
  const catHtml = (cat: ShopCat): string => {
    const all = listOf(cat);
    const slots = cat === 'look' || cat === 'decor' ? SLOTS[cat] : null;
    const slot = slots ? lastSlot[cat] ?? '' : '';
    const items = slot ? all.filter((x) => x.slot === slot) : all;
    const s = seen();
    const it = shopItem(cat, pick[cat]) ?? items[0] ?? all[0];
    const tiles = items.map((x) => tileHtml(x, x.id === it.id, freshOf(x, s))).join('');
    const mine = all.filter((x) => owns(save, x.cat, x.id)).length;
    const goalChips = isGoals(cat)
      ? `<div class="chips sh-slots" role="group" aria-label="Goals">${GOALS.map((g) => `<button class="${g.tab === cat ? 'on' : ''}" data-a="tab" data-v="${g.tab}" aria-pressed="${g.tab === cat}">${g.label}${railBadge(g.tab, s)}</button>`).join('')}</div>`
      : '';
    const chips = goalChips || (slots
      ? `<div class="chips sh-slots pane-scroll x" data-scroll-key="sh-slots-${cat}" role="group" aria-label="Show">
          <button class="${slot === '' ? 'on' : ''}" data-a="slot" data-v="" aria-pressed="${slot === ''}">ALL</button>
          ${slots.map((sl) => {
            const worn = cat === 'look' || cat === 'decor' ? !!equippedSlots(save, cat)[sl] : false;
            return `<button class="${slot === sl ? 'on' : ''} ${worn ? 'worn' : ''}" data-a="slot" data-v="${sl}" aria-pressed="${slot === sl}">${SLOT_CHIP[sl]}</button>`;
          }).join('')}
        </div>`
      : '');
    return `<div class="sh-content split sh-cat">
        <section class="pane sh-list">
          <div class="pane-h sh-listh"><span class="sh-count">${mine}/${all.length} OWNED</span><span class="grow"></span>${dealHtml()}</div>
          ${cat === 'decor' ? atmoHtml() : ''}
          ${chips}
          <div class="pane-scroll sh-grid" data-scroll-key="sh-${cat}-${slot}">${tiles}</div>
        </section>
        ${detailHtml(it)}
      </div>`;
  };

  // ---- FEATURED: this week's shelf and the sets

  /** A set's tile: its still, name, what you own of it and its price (or COMPLETE). */
  const setTileHtml = (b: Bundle, hero = false): string => {
    const items = bundleItems(b);
    const missing = bundleMissing(save, b);
    const have = items.length - missing.length;
    const price = bundlePrice(save, b);
    const done = missing.length === 0;
    const sel = feat.kind === 'set' && feat.id === b.id;
    const url = queueStill({ cat: 'bundle', id: b.id });
    const tag = done ? '<em class="sh-tag on">COMPLETE</em>' : `<em class="sh-tag price ${save.coins >= price ? 'buy' : 'poor'}">${coin(price)}</em>`;
    return `<button class="sh-set ${hero ? 'hero' : ''} ${sel ? 'sel' : ''}" data-a="feat" data-k="set" data-set="${b.id}" style="--sb:${b.bg};--sa:${b.accent}" aria-pressed="${sel}"
        aria-label="${esc(b.name)}, ${have} of ${items.length} owned, ${done ? 'complete' : `${price} coins`}">
        ${hero ? '<i class="sh-new feat">THIS WEEK</i>' : ''}
        ${have > 0 && !done ? `<i class="sh-new prog">${have}/${items.length}</i>` : ''}
        <span class="sh-art">${url ? `<img class="sh-img" src="${url}" alt="" draggable="false">` : pixelIcon('gift', '#fff', 5)}</span>
        <span class="sh-settxt"><b>${esc(b.name.toUpperCase())}</b><small>${done ? 'ALL 6 OWNED' : have ? `COMPLETE THE SET: ${missing.length} LEFT` : `${items.length} LOOKS, ${BUNDLE_OFF}% OFF`}</small></span>
        ${tag}
      </button>`;
  };

  const featuredHtml = (): string => {
    const s = seen();
    const started = BUNDLES.filter((b) => {
      const m = bundleMissing(save, b).length;
      return m > 0 && m < b.parts.length;
    });
    const rest = BUNDLES.filter((b) => b.id !== shelf.bundle.id);
    const itemTiles = shelf.items.map((x) => {
      const sel = feat.kind === 'item' && feat.cat === x.cat && feat.id === x.id;
      return tileHtml(x, sel, freshOf(x, s));
    }).join('');
    const detail = feat.kind === 'set' ? bundleDetailHtml(bundleOf(feat.id) ?? shelf.bundle) : detailHtml(shopItem(feat.cat, feat.id) ?? shelf.items[0]);
    return `<div class="sh-content split sh-cat sh-feat">
        <section class="pane sh-list">
          <div class="pane-h sh-listh"><span class="sh-count">THIS WEEK</span><small class="sh-weeknote">NEW SHELF EVERY MONDAY</small><span class="grow"></span>${dealHtml()}</div>
          <div class="pane-scroll sh-grid sh-featgrid" data-scroll-key="sh-featured">
            ${setTileHtml(shelf.bundle, true)}
            ${itemTiles}
            ${started.length ? `<h4 class="sh-sect">COMPLETE THE SET</h4>${started.map((b) => setTileHtml(b)).join('')}` : ''}
            <h4 class="sh-sect">ALL SETS</h4>
            ${rest.filter((b) => !started.includes(b)).map((b) => setTileHtml(b)).join('')}
          </div>
        </section>
        ${detail}
      </div>`;
  };

  /** A set's detail: the full look on the stage, its parts (tap one to see it), the honest price and BUY SET. */
  const bundleDetailHtml = (b: Bundle): string => {
    const items = bundleItems(b);
    const missing = bundleMissing(save, b);
    const price = bundlePrice(save, b);
    const full = bundleValue(b, missing);
    const done = missing.length === 0;
    const parts = items.map((it) => {
      const got = owns(save, it.cat, it.id);
      return `<button class="sh-part ${got ? 'got' : ''}" data-a="part" data-cat="${it.cat}" data-id="${esc(it.id)}" aria-label="${esc(it.name)} ${esc(CAT_LABEL[it.cat])}${got ? ', owned' : ''}">
          ${pixelIcon(CAT_ICON[it.cat], got ? '#26262e' : '#fbfbf4', 2)}<span>${esc(it.name.toUpperCase())}</span>${got ? '<i aria-hidden="true">OWNED</i>' : ''}
        </button>`;
    }).join('');
    const action = done
      ? '<div class="sh-btns"><button class="btn btn-go btn-lg sh-act" data-a="wearset">WEAR THE WHOLE SET</button></div>'
      : `<div class="sh-btns"><button class="btn ${save.coins >= price ? 'btn-yellow' : 'btn-white poor'} btn-lg sh-act" data-a="buyset">${missing.length < items.length ? 'COMPLETE IT' : 'BUY SET'} <s class="sh-was">${fmt(full)}</s>${coin(price)}</button>
          ${save.coins < price
            ? gems(save) >= topUpGems(price - save.coins)
              ? `<button class="btn btn-blue btn-lg sh-more" data-a="topupset" aria-label="Cover the ${fmt(price - save.coins)} coins you are short with ${topUpGems(price - save.coins)} gems">ADD ${gemPrice(topUpGems(price - save.coins))}</button>`
              : '<button class="btn btn-blue btn-lg sh-more" data-a="getcoins">GET COINS</button>'
            : ''}</div>
          <p class="sh-short free">SAVE ${fmt(full - price)}${missing.length < items.length ? `${sep()}ONLY THE ${missing.length} YOU DON'T OWN` : ''}</p>`;
    return `<section class="pane sh-detail sh-setdetail">
        <div class="sh-stage ${stage.ok ? '' : 'flat'}" style="--sb:${b.bg}">
          ${stage.ok ? '<canvas class="sh-3d" aria-hidden="true"></canvas>' : `<span class="sh-art big">${pixelIcon('gift', '#fff', 6)}</span>`}
          <div class="sh-burst" aria-hidden="true"></div>
          ${stageCtlHtml(null, b)}
        </div>
        <div class="sh-info">
          <div class="sh-id">
            <small class="sh-kind">THEMED SET${sep()}${items.length} LOOKS${sep()}${BUNDLE_OFF}% OFF</small>
            <h3 class="sh-name">${esc(b.name.toUpperCase())}</h3>
            <p class="sh-blurb">${esc(b.blurb)}</p>
          </div>
          <div class="sh-parts">${parts}</div>
          <div class="sh-actrow">${action}</div>
        </div>
      </section>`;
  };

  /** Every collection shows its actual six pieces, a shared live preview, and the exact owned-item discount. */
  const signatureHtml = (): string => {
    const set = signatureSet(signaturePick) ?? signatureSets()[0];
    const missing = signatureMissing(save, set);
    const price = signaturePrice(save, set);
    const current = set.id === passItemId(seasonOf(save).id);
    const tiles = signatureSets().map((s) => `<button class="sh-signature-tile ${s.id === set.id ? 'sel' : ''}" style="--signature:${s.colour}" data-a="signaturepick" data-id="${s.id}" aria-pressed="${s.id === set.id}"><b>${esc(s.name.toUpperCase())}</b><small>${6 - signatureMissing(save, s).length} OF 6 OWNED</small></button>`).join('');
    const action = !missing.length ? '<button class="btn btn-go btn-lg" data-a="signaturewear">EQUIP ALL SIX</button>'
      : `<button class="btn btn-blue btn-lg" data-a="signaturebuy">${missing.length < 6 ? 'COMPLETE' : 'BUY AND EQUIP'} ${gemPrice(price)}</button>`;
    const journeyAction = `<button class="btn btn-white" data-a="signatureseason">${current ? 'OPEN THIS JOURNEY' : 'SELECT THIS JOURNEY'}</button>`;
    return `<div class="sh-content split sh-cat sh-signature"><section class="pane sh-list"><div class="pane-h"><b>SIGNATURE COLLECTIONS</b></div><div class="sh-signature-grid pane-scroll" data-scroll-key="sh-signatures">${tiles}</div></section>
      <section class="sh-detail"><div class="sh-stage ${stage.ok ? '' : 'flat'}" style="--sb:${set.colour}">${stage.ok ? '<canvas class="sh-3d" aria-hidden="true"></canvas>' : pixelIcon('crown', '#ffd23a', 5)}</div>
      <div class="sh-info"><div class="sh-id"><small class="sh-kind">GEM IDENTITY COLLECTION${sep()}PERMANENT</small><h3 class="sh-name">${esc(set.name.toUpperCase())}</h3><p class="sh-blurb">Your own match spectacle, from the captain's look to the walkout and both goals. Choose a piece to see it move. Cosmetic only.</p></div>
      <div class="sh-signature-pieces"><button class="${signaturePiece < 0 ? 'on' : ''}" data-a="signaturepart" data-i="-1">FULL CLUB</button>${set.items.map((it, i) => `<button class="${signaturePiece === i ? 'on' : ''}" data-a="signaturepart" data-i="${i}" aria-pressed="${signaturePiece === i}">${esc(it.name)}${owns(save, it.cat, it.id) ? ' OWNED' : ''}</button>`).join('')}</div>
      <small>${missing.length < 6 ? `${6 - missing.length} ALREADY OWNED. YOU ONLY PAY FOR ${missing.length} MISSING PIECES.` : 'ALL SIX GUARANTEED. NO RANDOM REWARD. ALWAYS AVAILABLE.'} EARNED GEMS WORK TOO. OR PROGRESS ITS PERMANENT CLUB JOURNEY.</small><div class="sh-actrow">${action}${journeyAction}</div></div></section></div>`;
  };

  // ---- players (scout packs + the market)

  const playersHtml = (): string => {
    const club = clubOf();
    if (!club) {
      return `<div class="sh-content sh-players">
          <section class="sh-noclub">
            ${pixelIcon('shirt', '#26262e', 5)}
            <h3>FOUND YOUR CLUB FIRST</h3>
            <p>Packs sign real players into MY CLUB.</p>
            <button class="btn btn-go btn-lg" data-a="found">FOUND YOUR CLUB</button>
          </section>
        </div>`;
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
      return `<button class="sh-pack p-${free ? 'free' : k} ${poor ? 'poor' : ''}" data-a="pack" data-k="${k}" data-free="${free ? 1 : 0}" aria-label="${name}, ${free ? 'free' : `${cost} scout ${cost === 1 ? 'ticket' : 'tickets'}`}">
          <span class="sh-cardback" aria-hidden="true"><i></i></span>
          <b>${name}</b>
          <small>${free ? 'ONE A DAY' : `OVR ${Math.max(30, rating + lo)} TO ${Math.min(95, rating + 16)}`}</small>
          ${odds(k)}
          <em class="sh-tag price ${poor ? 'poor' : 'buy'}">${free ? 'FREE' : `${cost} ${cost === 1 ? 'TICKET' : 'TICKETS'}`}</em>
        </button>`;
    };
    // One bar for the club (its numbers, SQUAD and the MARKET), the packs side by side, one line of fine print.
    return `<div class="sh-content sh-players">
        <section class="sh-club">
          ${shirtArt(club.kit, 3)}
          <div class="sh-clubtxt"><b>${esc(club.name)}</b><span>OVR ${rating}${sep()}<em class="${full ? 'full' : ''}">${full ? 'SQUAD FULL' : `SQUAD ${club.squad.length}/${SQUAD_MAX}`}</em>${sep()}WAGES ${fmt(wages)}</span></div>
          <span class="sh-tokens" aria-label="${tokens} scout ${tokens === 1 ? 'ticket' : 'tickets'}"><b>${tokens}</b>${tokens === 1 ? 'TICKET' : 'TICKETS'}</span>
          <button class="btn btn-white" data-a="squad">SQUAD</button>
          <button class="btn btn-blue" data-a="market">MARKET</button>
        </section>
        <div class="sh-packs pane-scroll" data-scroll-key="sh-packs">
          ${freePackReady(save, day) ? pack('scout', true) : ''}
          ${pack('scout', false)}
          ${pack('elite', false)}
        </div>
        <p class="mc-hint sh-fine">Scout tickets are earned from daily challenges and gifts. 1 opens a Scout Pack; 3 open an Elite Pack. Coins and gems never buy tickets. Odds are shown.</p>
      </div>`;
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
      // (Felt card by card: a legend or an epic is a success.)
      buzz(card.rarity === 'legend' || card.rarity === 'epic' ? 'success' : 'reveal');
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
        ${scoutResaleCap(p) !== null ? `<p class="sh-verdict">SCOUT RESALE CREDIT UNTIL ${RESALE_STARTS} COMPLETED LEAGUE STARTS.</p>` : ''}
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

  // ---- the stage: what it shows for the tab and the pick

  /** The item the detail pane shows now (null on FEATURED with a set picked, and on the non-look tabs). */
  const shownItem = (): ShopItem | null => {
    if (tab === 'featured') return feat.kind === 'item' ? shopItem(feat.cat, feat.id) ?? null : null;
    return isCat(tab) ? shopItem(tab, pick[tab]) ?? null : null;
  };

  /** TRY IT ON's mix: everything equipped with `it` put on. */
  const tryWear = (it: ShopItem): StageWear => {
    const w = wearOf();
    if (it.cat === 'kit') w.kit = it.id;
    else if (it.cat === 'ball') w.ball = it.id;
    else if (it.cat === 'goalfx') w.goalfx = it.id;
    else if (it.cat === 'look' && it.slot) w.looks = { ...w.looks, [it.slot]: it.id };
    else if (it.cat === 'decor' && it.slot) w.decor = { ...w.decor, [it.slot]: it.id };
    return w;
  };

  /** Looks with something to see under the floodlights (glowing trim, neon, the light show): the stage offers NIGHT. */
  const nighty = (it: ShopItem): boolean => GLOWS.has(it.id) || it.cat === 'kit' || it.cat === 'look' || it.cat === 'decor';

  /** Put the right show on the stage for the tab, the pick and TRY IT ON. */
  const stageFor = () => {
    if (tab === 'signature') {
      const set = signatureSet(signaturePick);
      if (!set) return;
      const it = set.items[signaturePiece];
      if (it) { stage.set({ cat: it.cat, id: it.id }); return; }
      const w = wearOf();
      for (const item of set.items) {
        if (item.cat === 'kit') w.kit = item.id;
        else if (item.cat === 'goalfx') w.goalfx = item.id;
        else if (item.cat === 'look' && item.slot) w.looks = { ...w.looks, [item.slot]: item.id };
        else if (item.cat === 'decor' && item.slot) w.decor = { ...w.decor, [item.slot]: item.id };
      }
      stage.setTryOn(w);
      stage.set({ cat: 'tryon', id: `signature:${set.id}` });
      return;
    }
    // (The night view goes off where there is no NIGHT button to turn it off again.)
    const shown = shownItem();
    if (stage.night && !(tab === 'featured' && feat.kind === 'set') && !(shown && nighty(shown))) stage.setNight(false);
    if (tab === 'featured' && feat.kind === 'set') {
      stage.set({ cat: 'bundle', id: feat.id });
      return;
    }
    const it = shownItem();
    if (!it) return;
    if (tryMode && it.cat !== 'decor') {
      stage.setTryOn(tryWear(it));
      stage.set({ cat: 'tryon', id: itemKey(it.cat, it.id) });
      return;
    }
    stage.setView(it.cat === 'kit' ? kitView : 'solo');
    stage.set({ cat: it.cat, id: it.id });
  };

  // ---- drawing

  /** NEW looks per rail tab (affordable and not shown yet), and the free pack. */
  const railBadge = (t: RailTab, s: Set<string>): string => {
    if (t === 'players') return freePackReady(save, today()) ? '<i class="sh-dot">FREE</i>' : '';
    if (t === 'featured') return setsReadyBadge();
    const cats: ShopCat[] = t === 'goals' ? GOALS.map((g) => g.tab) : isCat(t as ShopTab) ? [t as ShopCat] : [];
    const n = cats.reduce((k, c) => k + shopItems(c).filter((x) => freshOf(x, s)).length, 0);
    return n ? '<i class="sh-dot new">NEW</i>' : '';
  };
  /** A started set you can now afford to complete: FEATURED says so. */
  const setsReadyBadge = (): string => {
    const ready = BUNDLES.some((b) => {
      const m = bundleMissing(save, b).length;
      return m > 0 && m < b.parts.length && bundlePrice(save, b) <= save.coins;
    });
    return ready ? '<i class="sh-dot new">SET</i>' : '';
  };

  const railHtml = (): string => {
    const s = seen();
    let lastGroup = -1;
    return RAIL.filter((r) => r.tab !== 'coins' || coinsTab()).map((r) => {
      const gap = r.group !== lastGroup && lastGroup >= 0 ? 'gap' : '';
      lastGroup = r.group;
      const money = r.tab === 'coins';
      const label = r.label;
      const on = r.tab === tab || (r.tab === 'goals' && isGoals(tab));
      return `<button class="sh-rb ${gap} ${on ? 'on' : ''} ${money ? 'money' : ''} ${r.tab === 'featured' ? 'feat' : ''}" data-a="tab" data-v="${r.tab}" aria-pressed="${on}" aria-label="${label}">
          <span class="sh-ri" aria-hidden="true">${pixelIcon(r.icon, on ? '#ffd23a' : money ? '#26262e' : '#fbfbf4', 2)}</span><span class="sh-rl">${label}</span>${railBadge(r.tab, s)}
        </button>`;
    }).join('');
  };

  let drawnTab: ShopTab | null = null;
  const draw = () => {
    lastTab = tab;
    lastFeat = feat;
    const body = tab === 'players' ? playersHtml() : tab === 'coins' ? coinsHtml() : tab === 'featured' ? featuredHtml() : tab === 'signature' ? signatureHtml() : catHtml(tab);
    keepScrolls(scr.panel);
    scr.render(
      `${topBar(backLabel, 'SHOP', iap.storefront ? 'EARN COINS AND GEMS PLAYING OR TOP UP' : 'COINS AND GEMS COME FROM PLAYING', shownCoins)}
      <div class="mc-body sh-body">
        <nav class="sh-rail pane-scroll" data-scroll-key="sh-rail" aria-label="Shop sections">${railHtml()}</nav>
        ${body}
      </div>`,
      handlers,
    );
    restoreScrolls(scr.panel);
    if (tab !== drawnTab) {
      // Keep the selected section visible when entering Store from a wallet shortcut. Only its rail moves.
      const rail = scr.panel.querySelector<HTMLElement>('.sh-rail');
      const active = rail?.querySelector<HTMLElement>('.sh-rb.on');
      if (rail && active) {
        const box = rail.getBoundingClientRect();
        const item = active.getBoundingClientRect();
        if (item.top < box.top) rail.scrollTop += item.top - box.top;
        else if (item.bottom > box.bottom) rail.scrollTop += item.bottom - box.bottom;
        if (item.left < box.left) rail.scrollLeft += item.left - box.left;
        else if (item.right > box.right) rail.scrollLeft += item.right - box.right;
      }
    }
    drawnTab = tab;
    hydrateFaces(scr.panel);
    // The wallet runs down to its new total after a purchase.
    const span = scr.panel.querySelector<HTMLElement>('.mc-top .coins span');
    if (span && shownCoins !== save.coins) runCoins(span, shownCoins, save.coins);
    shownCoins = save.coins;
    // (The gem counter pops when it moved: a purchase, a swap, a reward.)
    if (gems(save) !== shownGems) scr.panel.querySelector('.mc-top .gems')?.classList.add('up');
    shownGems = gems(save);
    popKey = '';
    const cv = scr.panel.querySelector<HTMLCanvasElement>('.sh-3d');
    if (cv) stage.attach(cv);
    if (isCat(tab)) {
      markSeen(save, tab);
      app.persist();
    }
    const list = scr.panel.querySelector<HTMLElement>('.sh-grid');
    const sel = list?.querySelector<HTMLElement>('.sh-tile.sel, .sh-set.sel');
    if (revealPick && list && sel) revealIn(list, sel);
    revealPick = false;
  };

  /** A tile tap: the look goes on the stage at once and the detail pane follows; the list is left where it was. */
  const showPick = () => {
    const it = shownItem();
    scr.panel.querySelectorAll<HTMLElement>('.sh-tile, .sh-set').forEach((t) => {
      const on = it ? t.dataset.cat === it.cat && t.dataset.id === it.id : t.dataset.set === (feat.kind === 'set' ? feat.id : '');
      t.classList.toggle('sel', on);
      t.setAttribute('aria-pressed', String(on));
    });
    const detail = scr.panel.querySelector<HTMLElement>('.sh-detail');
    if (!detail) return;
    // (The stage canvas stays: only the info and the stage's controls are redrawn.)
    if (tab === 'featured' && feat.kind === 'set') {
      draw();
      return;
    }
    if (!it) return;
    if (detail.classList.contains('sh-setdetail')) {
      draw();
      return;
    }
    const info = detail.querySelector<HTMLElement>('.sh-info');
    if (info) info.innerHTML = infoHtml(it);
    const stg = detail.querySelector<HTMLElement>('.sh-stage');
    if (stg) {
      stg.querySelectorAll('.sh-ctl').forEach((c) => c.remove());
      stg.insertAdjacentHTML('beforeend', stageCtlHtml(it, null));
    }
    const flat = scr.panel.querySelector<HTMLElement>('.sh-stage.flat .sh-art.big');
    if (flat) flat.innerHTML = flatArt(it);
  };

  /** Bought: it goes straight on, the coins run down, the tile pops, the stage bursts, a line says so. */
  const bought = (items: readonly ShopItem[], before: number, msg: string) => {
    for (const x of items) equipItem(save, x.cat, x.id);
    app.persist();
    shownCoins = before;
    popKey = items.length ? itemKey(items[0].cat, items[0].id) : '';
    sfx.coin();
    window.setTimeout(() => sfx.powerup(), 120);
    buzz('success');
    rewear();
    stageFor();
    draw();
    if (items[0]) burst(scr, items[0]);
    say(msg, 'good');
  };

  /** Jump to an item: its tab, picked, its slot chip on, its tile in view. */
  const goItem = (cat: ShopCat, id: string) => {
    tab = cat;
    pick[cat] = id;
    lastPick[cat] = id;
    const it = shopItem(cat, id);
    if (it?.slot && lastSlot[cat]) lastSlot[cat] = it.slot;
    revealPick = true;
    stageFor();
    draw();
  };

  /** To a section of the STORE tab. */
  const goStore = (to: StoreSec): void => {
    tab = 'coins';
    sec = to;
    lastStore = to;
    draw();
  };
  /** Where a confirm sheet's GET GEMS goes: the gem packs, where a store sells them (else it only says what is missing). */
  const getGems = (): (() => void) | undefined => (iap.storefront ? () => goStore('gems') : undefined);

  // (Esc: mountMeta sends it to BACK, which waits while a pack reveal is up.)
  const handlers = {
    signaturepick: (el: HTMLElement) => {
      const id = el.dataset.id;
      if (id && signatureSet(id)) signaturePick = id;
      tab = 'signature'; signaturePiece = -1;
      stageFor(); draw();
    },
    signaturepart: (el: HTMLElement) => {
      signaturePiece = Number(el.dataset.i ?? -1);
      stageFor(); draw();
    },
    signatureseason: () => {
      if (selectJourney(seasonOf(save), signaturePick)) app.persist();
      openBadges(app, () => openShop(app, { tab: 'signature', onBack: back, backLabel }), 'season');
    },
    signaturewear: () => {
      if (!equipSignatureSet(save, signaturePick)) return;
      app.persist(); rewear(); stageFor(); draw(); buzz('success'); say('ALL SIX EQUIPPED', 'good');
    },
    signaturebuy: () => {
      const set = signatureSet(signaturePick);
      if (!set) return;
      const price = signaturePrice(save, set);
      if (price <= 0) return;
      const missing = signatureMissing(save, set);
      confirmGems(scr.root, { title: `OWN ${set.name.toUpperCase()}?`, text: `${missing.length} GUARANTEED PIECES: ${missing.map((it) => it.name).join(', ')}. OWNED FOR GOOD. EQUIPPED TOGETHER`, price, have: gems(save), yes: 'BUY AND EQUIP', getGems: getGems(), free: 'GEMS EARNED BY PLAYING BUY THE SAME COLLECTION',
        onYes: () => {
          if (signaturePrice(save, set) !== price) { draw(); say('YOUR COLLECTION CHANGED. CHECK ITS NEW PRICE', 'info'); return; }
          const r = buySignatureSet(save, set.id);
          if (!r.ok) return;
          equipSignatureSet(save, set.id); app.persist(); rewear(); stageFor(); draw(); sfx.powerup(); buzz('success'); say(`${set.name.toUpperCase()} IS YOURS. ALL SIX ON!`, 'good');
        } });
    },
    // (A pack being opened has to be signed or sold first: its card is paid for.)
    back: () => {
      if (!sheet) back();
    },
    tab: (el: HTMLElement) => {
      const v = el.dataset.v as RailTab;
      const next: ShopTab = v === 'goals' ? (isGoals(tab) ? tab : lastGoals) : v;
      if (next === tab) return;
      if (isGoals(next)) lastGoals = next as ShopCat;
      tab = next;
      revealPick = true;
      stageFor();
      draw();
    },
    slot: (el: HTMLElement) => {
      if (!isCat(tab)) return;
      const v = el.dataset.v ?? '';
      if ((lastSlot[tab] ?? '') === v) return;
      lastSlot[tab] = v;
      // The pick follows the filter (the first look of that slot, or the one worn there).
      const it = shopItem(tab, pick[tab]);
      if (v && it?.slot !== v) {
        const worn = isSlotCat(tab) ? equippedSlots(save, tab)[v] : undefined;
        const first = worn ?? listOf(tab).find((x) => x.slot === v)?.id;
        if (first) {
          pick[tab] = first;
          lastPick[tab] = first;
          stageFor();
        }
      }
      revealPick = true;
      draw();
    },
    // TODAY'S DEAL: its tab, with the look on the stage and its tile in view.
    deal: () => {
      const d = dailyDeal(save, today());
      if (d) goItem(d.item.cat, d.item.id);
    },
    pick: (el: HTMLElement) => {
      const cat = el.dataset.cat as ShopCat | undefined;
      const id = el.dataset.id;
      if (!cat || !id) return;
      if (tab === 'featured') {
        if (feat.kind === 'item' && feat.cat === cat && feat.id === id) return;
        const wasSet = feat.kind === 'set';
        feat = { kind: 'item', cat, id };
        stageFor();
        if (wasSet) draw();
        else showPick();
        return;
      }
      if (!isCat(tab) || id === pick[tab]) return;
      pick[tab] = id;
      lastPick[tab] = id;
      stageFor();
      showPick();
    },
    feat: (el: HTMLElement) => {
      const id = el.dataset.set;
      if (!id || (feat.kind === 'set' && feat.id === id)) return;
      feat = { kind: 'set', id };
      stageFor();
      draw();
    },
    part: (el: HTMLElement) => {
      const cat = el.dataset.cat as ShopCat | undefined;
      const id = el.dataset.id;
      if (cat && id) goItem(cat, id);
    },
    seeset: (el: HTMLElement) => {
      const id = el.dataset.set;
      if (!id) return;
      tab = 'featured';
      feat = { kind: 'set', id };
      revealPick = true;
      stageFor();
      draw();
    },
    view: (el: HTMLElement) => {
      const v = el.dataset.v === 'team' ? 'team' : 'solo';
      if (v === kitView) return;
      kitView = v;
      stage.setView(v);
      showPick();
    },
    night: () => {
      stage.setNight(!stage.night);
      showPick();
    },
    try: () => {
      tryMode = !tryMode;
      stageFor();
      showPick();
    },
    buy: (): void => {
      const it = shownItem();
      if (!it) return;
      const before = save.coins;
      const r = buyItem(save, it.cat, it.id, today());
      if (!r.ok) {
        if (r.reason === 'no-coins') {
          say(`${fmt(r.short)} MORE COINS NEEDED`, 'bad');
          nope();
        }
        return;
      }
      bought([r.item], before, `${r.item.name.toUpperCase()} IS YOURS. ${isSlotCat(r.item.cat) ? 'YOU WEAR IT NOW' : 'EQUIPPED'}!`);
    },
    buyset: (): void => {
      const b = feat.kind === 'set' ? bundleOf(feat.id) : undefined;
      if (!b) return;
      const before = save.coins;
      const r = buyBundle(save, b.id);
      if (!r.ok) {
        if (r.reason === 'no-coins') {
          say(`${fmt(r.short)} MORE COINS NEEDED`, 'bad');
          nope();
        }
        return;
      }
      bought(bundleItems(b), before, `${b.name.toUpperCase()} IS YOURS. ALL ${b.parts.length} ON!`);
    },
    wearset: () => {
      const b = feat.kind === 'set' ? bundleOf(feat.id) : undefined;
      if (!b) return;
      for (const it of bundleItems(b)) equipItem(save, it.cat, it.id);
      app.persist();
      sfx.coin();
      rewear();
      stageFor();
      draw();
      say(`THE WHOLE ${b.name.toUpperCase()} IS ON`, 'good');
    },
    equip: () => {
      const it = shownItem();
      if (!it || !equipItem(save, it.cat, it.id)) return;
      app.persist();
      sfx.coin();
      rewear();
      stageFor();
      draw();
      say(`${it.name.toUpperCase()} ${isSlotCat(it.cat) ? 'ON' : 'EQUIPPED'}`, 'good');
    },
    off: () => {
      const it = shownItem();
      if (!it || !unequipItem(save, it.cat, it.id)) return;
      app.persist();
      sfx.click();
      rewear();
      stageFor();
      draw();
      say(`${it.name.toUpperCase()} OFF`, 'info');
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
        if (r.reason === 'no-tokens') say(`${r.short} MORE SCOUT ${r.short === 1 ? 'TICKET' : 'TICKETS'} NEEDED. DAILY CHALLENGES EARN THEM`, 'bad');
        else if (r.reason === 'free-used') say('TODAY\'S FREE PACK IS OPENED. BACK TOMORROW', 'info');
        return;
      }
      app.persist();
      shownCoins = before;
      sfx.coin();
      draw();
      reveal(r.card, r.price);
    },
    // ---- the STORE (gems): every spend asks once, with its price (ui/gemUi.ts)
    sec: (el: HTMLElement) => {
      const v = el.dataset.v as StoreSec;
      if (v === sec) return;
      sec = v;
      lastStore = v;
      draw();
    },
    getcoins: () => goStore('coins'),
    swap: (el: HTMLElement) => {
      const o = COIN_OFFERS.find((x) => x.id === el.dataset.id);
      if (!o) return;
      confirmGems(scr.root, {
        title: `SWAP FOR ${fmt(o.coins)} COINS?`, price: o.gems, have: gems(save), yes: 'SWAP', getGems: getGems(),
        onYes: () => {
          const before = save.coins;
          if (!buyCoinsWithGems(save, o.id).ok) return;
          app.persist();
          shownCoins = before;
          sfx.coin();
          draw();
          say(`+${fmt(o.coins)} COINS`, 'good');
        },
      });
    },
    passgems: () => {
      if (save.iap?.pendingPass) { say('STORE PAYMENT PENDING. YOUR JOURNEY WILL UNLOCK WHEN IT CONFIRMS', 'info'); return; }
      confirmGems(scr.root, {
        title: 'GET THE CLUB PASS?', text: 'PERMANENT FOR THIS JOURNEY. REACHED TIERS UNLOCK AT ONCE', price: GEM_PRICES.clubPass, have: gems(save), yes: 'GET IT', getGems: getGems(),
        onYes: () => {
          if (!buyPassWithGems(save).ok) return;
          app.persist();
          sfx.coin();
          window.setTimeout(() => sfx.powerup(), 120);
          draw();
          say('THE CLUB PASS IS ON: CLAIM YOUR TIERS IN JOURNEYS', 'good');
        },
      });
    },
    network: () => {
      const next = nextScoutNetwork(save);
      if (!next) return;
      confirmGems(scr.root, {
        title: `BUY THE ${next.name}?`, text: `${next.text}. FOR GOOD`, price: next.price, have: gems(save), yes: 'BUY', getGems: getGems(),
        free: 'YOUR ACADEMY BRINGS PROSPECTS EVERY SEASON WITHOUT IT',
        onYes: () => {
          if (!buyScoutNetwork(save).ok) return;
          // (The career keeps a mirror of the tier for its academy intake: meta/premium.ts.)
          try {
            if (clubOf()) syncNetwork(careerState(app), save);
          } catch {
            // No club yet (or a damaged career): the tier is kept in the save and mirrored when the career opens.
          }
          app.persist();
          sfx.coin();
          window.setTimeout(() => sfx.powerup(), 120);
          draw();
          say(`${next.name} IS YOURS: ${next.text}`, 'good');
        },
      });
    },
    // Short of coins for the look on show: gems cover the difference, then it is bought as usual.
    topup: (): void => {
      const it = shownItem();
      if (!it) return;
      const price = priceOf(it);
      const need = topUpGems(price - save.coins);
      if (need <= 0) {
        handlers.buy();
        return;
      }
      confirmGems(scr.root, {
        title: `BUY ${it.name.toUpperCase()}?`, text: `YOUR ${fmt(save.coins)} COINS AND ${need} GEMS FOR THE REST`, price: need, have: gems(save), yes: 'BUY', getGems: getGems(),
        onYes: () => {
          if (!coverShortfall(save, price, `${it.cat}:${it.id}`)) return;
          handlers.buy();
        },
      });
    },
    topupset: (): void => {
      const b = feat.kind === 'set' ? bundleOf(feat.id) : undefined;
      if (!b) return;
      const price = bundlePrice(save, b);
      const need = topUpGems(price - save.coins);
      if (need <= 0) {
        handlers.buyset();
        return;
      }
      confirmGems(scr.root, {
        title: `BUY THE ${b.name.toUpperCase()}?`, text: `YOUR ${fmt(save.coins)} COINS AND ${need} GEMS FOR THE REST`, price: need, have: gems(save), yes: 'BUY', getGems: getGems(),
        onYes: () => {
          if (!coverShortfall(save, price, `set:${b.id}`)) return;
          handlers.buyset();
        },
      });
    },
    // The free daily gems: only ever on the player's own tap, once a day.
    gemad: async () => {
      if (busy) return;
      if (adsLeft(save, 'gem', localDay()) <= 0) {
        say('TODAY\'S FREE GEMS ARE TAKEN. BACK TOMORROW', 'info');
        return;
      }
      if (!ads.rewardedAvailable) {
        say('NO AD RIGHT NOW. TRY AGAIN LATER', 'info');
        return;
      }
      busy = 'gemad';
      draw();
      const watched = await ads.rewarded();
      busy = '';
      const n = watched ? claimDailyGems(save, localDay()) : 0;
      if (n > 0) {
        app.persist();
        sfx.coin();
        buzz('success');
      }
      draw();
      say(n > 0 ? `+${n} GEMS. BACK TOMORROW FOR MORE` : watched ? 'TODAY\'S FREE GEMS ARE TAKEN. BACK TOMORROW' : 'THE AD DID NOT FINISH, SO NO GEMS THIS TIME', n > 0 ? 'good' : 'info');
    },
    // A NEW DEAL TODAY: a rewarded ad once a day (where there are ads), else a few gems, asked first.
    newdeal: async () => {
      if (busy) return;
      const day = localDay();
      const preview = nextDeal(save, day);
      if (!preview) {
        say('NOTHING ELSE LEFT TO SELL', 'info');
        return;
      }
      const moved = (): void => {
        const d = rerollDeal(save, today());
        app.persist();
        if (d) goItem(d.item.cat, d.item.id);
        else draw();
        say(d ? `NEW DEAL: ${d.item.name.toUpperCase()} ${DEAL_OFF}% OFF` : 'NOTHING ELSE LEFT TO SELL', d ? 'good' : 'info');
      };
      if (ads.portal !== 'none' && adsLeft(save, 'deal', day) > 0 && ads.rewardedAvailable) {
        busy = 'dealad';
        const watched = await ads.rewarded();
        busy = '';
        if (watched && useAd(save, 'deal', localDay())) moved();
        else say('THE AD DID NOT FINISH, SO THE DEAL STAYS', 'info');
        return;
      }
      confirmGems(scr.root, {
        title: 'A NEW DEAL TODAY?', text: `${preview.item.name.toUpperCase()} FOR ${preview.price.toLocaleString('en-US')} COINS (${DEAL_OFF}% OFF)`, price: GEM_PRICES.dealRefresh, have: gems(save), yes: 'NEW DEAL', getGems: getGems(),
        free: 'THE DEAL CHANGES BY ITSELF EVERY DAY',
        onYes: () => {
          // A purchase elsewhere or midnight must not swap the disclosed deal before charging.
          const current = nextDeal(save, localDay());
          if (localDay() !== day || current?.item.cat !== preview.item.cat || current.item.id !== preview.item.id || current.price !== preview.price) {
            say('THE DEAL CHANGED. TAKE ANOTHER LOOK', 'info');
            draw();
            return;
          }
          if (spendGems(save, GEM_PRICES.dealRefresh, 'dealRefresh')) moved();
        },
      });
    },
    // A gem pack, the Starter Pack, NO ADS, the PRO bundle: the store takes the payment and the grant listener (above) does the rest.
    iap: async (el: HTMLElement) => {
      const id = el.dataset.id;
      if (!id || busy) return;
      // A stand-in the store can't sell yet: say so, and nothing happens (no purchase is ever faked).
      if (!iap.canSell(id)) {
        say(STORE_NOT_READY, 'info');
        return;
      }
      busy = id;
      draw();
      const r = await iap.buy(id);
      busy = '';
      // (A paid purchase was drawn by the grant listener already, with the wallet running up.)
      if (r !== 'ok') draw();
      if (r === 'cancelled') say('NO PROBLEM. NOTHING WAS CHARGED', 'info');
      else if (r === 'pending') say('WAITING FOR THE STORE. IT ARRIVES WHEN THE STORE CONFIRMS', 'info');
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
        buzz('success');
        draw();
        say(`+${FREE_AD_COINS} COINS${r.left > 0 ? `. ${r.left} MORE ${r.left === 1 ? 'AD' : 'ADS'} TODAY` : '. THAT IS TODAY\'S LAST ONE'}`, 'good');
        return;
      }
      draw();
      say(watched ? 'ALL OF TODAY\'S FREE COINS ARE USED. BACK TOMORROW' : 'THE AD DID NOT FINISH, SO NO COINS THIS TIME', 'info');
    },
  };

  /** The BUY button shakes (not enough coins). */
  const nope = () => {
    const b = scr.panel.querySelector('.sh-act');
    b?.classList.remove('nope');
    void (b as HTMLElement | null)?.offsetWidth;
    b?.classList.add('nope');
  };

  stageFor();
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
  if (g.gems) things.push(`+${fmt(g.gems)} GEMS`);
  if (g.coins) things.push(`+${fmt(g.coins)} COINS`);
  for (const key of g.items) {
    const [cat, id] = key.split(':') as [ShopCat, string];
    const it = shopItem(cat, id);
    if (it) things.push(`THE ${it.name.toUpperCase()} ${CAT_LABEL[it.cat].toUpperCase()}`);
  }
  if (g.noAds) things.push('NO ADS IS ON');
  if (g.pass) things.push('THE CLUB PASS IS ON: CLAIM YOUR TIERS IN JOURNEYS');
  if (g.doubler) things.push('EVERY MATCH NOW PAYS DOUBLE');
  if (g.firstBonus) things.push('FIRST BUY DOUBLED');
  return things.length ? things.join(', ') : 'THANK YOU';
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
  const d = it.cat === 'kit' ? KIT_DESIGNS[it.id] : undefined;
  const cols =
    it.cat === 'goalfx' ? GOAL_FX_COLORS[it.id as keyof typeof GOAL_FX_COLORS] ?? [0xffd23a]
      : it.cat === 'trail' ? TRAIL_COLORS[it.id as keyof typeof TRAIL_COLORS]
        : d ? [d.shirt, d.shirt2, d.shorts, 0xffd23a]
          : [0xffd23a, 0xfbfbf4, 0x3cc15a, 0x2f7be8];
  let html = '';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
    const dd = 70 + Math.random() * 90;
    html += `<i style="--x:${Math.round(Math.cos(a) * dd)}px;--y:${Math.round(Math.sin(a) * dd - 30)}px;--c:${cssHex(cols[i % cols.length])};--d:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
  }
  host.innerHTML = html;
  host.classList.remove('on');
  void host.offsetWidth;
  host.classList.add('on');
}

// ------------------------------------------------------------------ dev: open the shop anywhere

if (import.meta.env.DEV && typeof window !== 'undefined') {
  /** window.__blfx.shop(tab?, id?) (dev builds only): the shop on a tab ('featured', 'kit', 'look', 'decor'...), `id` picked. */
  const w = window as unknown as { __blfx?: { [k: string]: unknown }; __bl?: { app?: AppContext } };
  w.__blfx ??= {};
  w.__blfx.shop = (tab?: ShopTab, id?: string): void => {
    const app = w.__bl?.app;
    if (app) openShop(app, { tab, pick: id });
  };
}
