/**
 * Store purchases (real money): GEM packs, the Starter Pack, NO ADS, the Coin Doubler, the Club Pass and the PRO
 * bundle, behind one provider-agnostic API. Money buys gems (meta/gems.ts), never coins directly: one ladder, one
 * currency for money, and coins come from playing or from swapping gems at a shown rate (economy v3, docs/ECONOMY.md).
 *
 * Who sells what, where:
 * - `native`: the iOS and Android apps (Capacitor wrapping the web build, cordova-plugin-purchase installed). The
 *   plugin puts `window.CdvPurchase` on the page; we only feature-detect it, there is no import, so nothing
 *   native touches the web bundle. Prices and titles come from the store, in the player's currency.
 * - `dev`: a fake store for trying the shop UI. Only in a dev server (import.meta.env.DEV) with ?iap=dev in
 *   the URL; instant success. ?iapresult=cancelled|failed|pending forces that outcome.
 * - `none`: everywhere else, and ALWAYS on CrazyGames, Poki, itch and the plain website: their rules and
 *   payment integrations differ, so coins and gems there come from play and rewarded ads (meta/shop.ts FREE COINS).
 *
 * Grants are idempotent. Every payout is recorded in the save (SaveData.iap) as `${transactionId}|${productId}`
 * and a one-time product is recorded as owned, so a store that delivers a transaction twice (a crash before it
 * was finished, a restore) never pays twice. The order is always: grant, save, THEN finish the transaction with
 * the store; a crash in between only re-delivers a transaction we then recognise.
 *
 * v1 trusts the plugin's own receipt handling (no server). To validate on a server, point the plugin's
 * `store.validator` at it and move the grant from `approved` to `verified` (NativeStore.approved below).
 * See docs/MONETIZATION.md.
 */
import { IAP_APPLIED_MAX, type SaveData } from '../core/save';
import { addGems } from '../meta/gems';
import { activatePass, passActive } from '../meta/pass';
import { seasonOf } from '../meta/season';
import { creditCoins, grantItem, iapOf, itemKey, type ShopCat } from '../meta/shop';
import { inNativeApp } from './native';
import { watchPurchaseRejections, type PurchaseRejection } from './purchaseEvents';

// ------------------------------------------------------------------ the catalogue

export type IapProvider = 'native' | 'dev' | 'none';
export type IapKind = 'consumable' | 'non-consumable';
export type IapBuyResult = 'ok' | 'cancelled' | 'failed' | 'pending';

export interface IapEntry {
  /** The product id in App Store Connect and Play Console: stable for good, never reuse one. */
  id: string;
  kind: IapKind;
  title: string;
  /** Coins handed over with it (the Starter Pack's), before the bonus. */
  coins: number;
  /** Gems in the pack, before the bonus. */
  gems: number;
  /** Extra on top, in % of the pack (real: it is added to the grant). */
  bonusPct: number;
  /** Shop items handed over with it (the Starter Pack's Gold ball). */
  items: readonly { cat: ShopCat; id: string }[];
  /** NO ADS: no interstitial ads (rewarded ads stay: they are the player's choice). The PRO bundle has it too. */
  noAds?: true;
  /** The Club Pass: permanently upgrades the Journey selected at checkout (meta/pass.ts). One purchase per track. */
  pass?: true;
  /** The Coin Doubler: every match pays double coins, for good (main.ts full time). The PRO bundle has it too. */
  doubler?: true;
  /** A tag on the card: an editorial call, keep it true if the prices move. */
  tag?: 'POPULAR' | 'BEST VALUE';
  /** The price to set in the store consoles, in US dollars (docs and the dev store only: the UI shows the store's own string). */
  usd: number;
}

export const PRODUCT_STARTER = 'bl.starter';
export const PRODUCT_NOADS = 'bl.noads';
export const PRODUCT_PASS = 'bl.pass';
export const PRODUCT_DOUBLER = 'bl.doubler';
export const PRODUCT_PRO = 'bl.pro';

/**
 * What is for sale, in display order (economy v3). The ladder: 100 gems for $0.99, and every bigger pack a better
 * rate (101, 110, 120, 130 and 150 gems a dollar), up to $19.99: no pack above that in a game children play. 100 gems
 * is two replays, or five finished builds, or about 1,500 coins: a real head start, never a wall.
 * The one-time offers are worth more than their price on purpose and say so with real numbers: the Starter Pack
 * (the first purchase) and the PRO bundle (NO ADS, the Coin Doubler and 600 gems: $13.97 of products for $9.99).
 */
export const CATALOGUE: readonly IapEntry[] = [
  { id: 'bl.gems.100', kind: 'consumable', title: '100 Gems', coins: 0, gems: 100, bonusPct: 0, items: [], usd: 0.99 },
  { id: 'bl.gems.300', kind: 'consumable', title: '300 Gems', coins: 0, gems: 300, bonusPct: 10, items: [], usd: 2.99 },
  { id: 'bl.gems.500', kind: 'consumable', title: '500 Gems', coins: 0, gems: 500, bonusPct: 20, items: [], usd: 4.99, tag: 'POPULAR' },
  { id: 'bl.gems.1000', kind: 'consumable', title: '1000 Gems', coins: 0, gems: 1000, bonusPct: 30, items: [], usd: 9.99 },
  { id: 'bl.gems.2000', kind: 'consumable', title: '2000 Gems', coins: 0, gems: 2000, bonusPct: 50, items: [], usd: 19.99, tag: 'BEST VALUE' },
  { id: PRODUCT_STARTER, kind: 'non-consumable', title: 'Starter Pack', coins: 2000, gems: 150, bonusPct: 0, items: [{ cat: 'ball', id: 'gold' }], usd: 1.99 },
  { id: PRODUCT_NOADS, kind: 'non-consumable', title: 'No Ads', coins: 0, gems: 0, bonusPct: 0, items: [], noAds: true, usd: 3.99 },
  { id: PRODUCT_PASS, kind: 'consumable', title: 'Club Pass', coins: 0, gems: 0, bonusPct: 0, items: [], pass: true, usd: 3.99 },
  { id: PRODUCT_DOUBLER, kind: 'non-consumable', title: 'Coin Doubler', coins: 0, gems: 0, bonusPct: 0, items: [], doubler: true, usd: 4.99 },
  { id: PRODUCT_PRO, kind: 'non-consumable', title: 'Pro Bundle', coins: 0, gems: 600, bonusPct: 0, items: [], noAds: true, doubler: true, usd: 9.99 },
];

/** A gem pack (not the pass or a one-time offer): the first buy of each pays double (FIRST_BUY_MULT, IapState.firsts). */
export const isGemPack = (e: Pick<IapEntry, 'kind' | 'pass' | 'gems'>): boolean => e.kind === 'consumable' && !e.pass && e.gems > 0;
export const FIRST_BUY_MULT = 2;
/** The dearest thing in the store, in US dollars: a ceiling on purpose (kids play this; tests pin it). */
export const MAX_PRICE_USD = 19.99;

export function entryOf(id: string): IapEntry | undefined {
  return CATALOGUE.find((e) => e.id === id);
}

/** The coins a product hands over: the pack plus its bonus. */
export function coinsOf(e: Pick<IapEntry, 'coins' | 'bonusPct'>): number {
  return e.coins + Math.floor((e.coins * e.bonusPct) / 100);
}

/** The gems a product hands over: the pack plus its bonus (before any first-buy doubling). */
export function gemsOf(e: Pick<IapEntry, 'gems' | 'bonusPct'>): number {
  return e.gems + Math.floor((e.gems * e.bonusPct) / 100);
}

/** One product as the shop shows it. */
export interface IapProduct {
  id: string;
  title: string;
  /** The store's own price string in the player's currency ("$0.99", "0,99 EUR"): shown as is. */
  price: string;
  kind: IapKind;
  /** Total coins handed over (pack plus bonus), the pack alone and the bonus in %. */
  coins: number;
  baseCoins: number;
  bonusPct: number;
  /** Total gems handed over (pack plus bonus, before the first-buy doubling) and the pack alone. */
  gems: number;
  baseGems: number;
  /** Item keys handed over ('ball:gold'). */
  items: string[];
  noAds: boolean;
  tag?: IapEntry['tag'];
  /**
   * A one-time product the player already has (never true for gem packs; the Club Pass: on for this month; NO ADS
   * and the Coin Doubler: also once the PRO bundle is owned).
   */
  owned: boolean;
  pass: boolean;
  doubler: boolean;
  /** A gem pack never bought before: this buy pays FIRST_BUY_MULT times its gems. */
  firstBonus: boolean;
  /**
   * The store can sell it right now. False only on Iap.shelf()'s stand-ins: the app's store hasn't answered for
   * this product (not set up in App Store Connect yet, offline), so the card shows the catalogue price and a tap
   * says the store isn't ready. Nothing is ever granted without the store.
   */
  sellable: boolean;
}

/** Explicitly label the US catalogue estimate until the store supplies its localized price. */
export function cataloguePrice(e: Pick<IapEntry, 'usd'>): string {
  return `US$${e.usd.toFixed(2)}`;
}

/** What a delivered purchase changed. */
export interface IapGrant {
  productId: string;
  coins: number;
  /** Gems handed over (the first-buy bonus included). */
  gems: number;
  items: string[];
  noAds: boolean;
  /** Extra gems from the first-buy bonus (already in `gems`). */
  firstBonus: number;
  /** The Club Pass went on for this month. */
  pass: boolean;
  /** The Coin Doubler is now owned. */
  doubler: boolean;
  /** Came with a restore (or the store's owned list), not a fresh purchase. */
  restored: boolean;
}

export interface IapRestoreResult {
  /** False when the store could not be reached. */
  ok: boolean;
  /** One-time products this restore handed back (not the ones already on the device). */
  restored: string[];
}

export type DeliverResult = 'applied' | 'duplicate' | 'unknown' | 'unbound' | 'unsaved';

/** Purchases can touch every wallet/entitlement track. Keep the save object held by the app on rollback. */
function restorePurchaseSave(save: SaveData, before: SaveData): void {
  for (const key of Object.keys(save)) delete (save as unknown as Record<string, unknown>)[key];
  Object.assign(save, before);
}

function nativeFailureReceiptsAvailable(): boolean {
  if (!inNativeApp()) return false;
  const host = window as unknown as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } };
  return host.Capacitor?.isPluginAvailable?.('PurchaseEvents') === true;
}

// ------------------------------------------------------------------ the rules (pure, no store)

/** NO ADS is owned (on its own, or in the PRO bundle). */
export function adFree(save: Pick<SaveData, 'iap'>): boolean {
  const owned = iapOf(save).owned;
  return owned.includes(PRODUCT_NOADS) || owned.includes(PRODUCT_PRO);
}

/** The Coin Doubler is owned (on its own, or in the PRO bundle): every match pays double coins. */
export function coinDoubler(save: Pick<SaveData, 'iap'>): boolean {
  const owned = iapOf(save).owned;
  return owned.includes(PRODUCT_DOUBLER) || owned.includes(PRODUCT_PRO);
}

/**
 * The PRO bundle is an honest offer only while neither of its parts is owned (it is priced against both): the
 * shop shows it then, and never once NO ADS or the Coin Doubler was bought on its own.
 */
export function proOffered(save: Pick<SaveData, 'iap'>): boolean {
  const owned = iapOf(save).owned;
  return !owned.includes(PRODUCT_PRO) && !owned.includes(PRODUCT_NOADS) && !owned.includes(PRODUCT_DOUBLER);
}

/** What the PRO bundle's parts cost bought one by one, in US dollars (the card's "worth" line; tests pin the saving). */
export function proWorthUsd(): number {
  const usd = (id: string) => entryOf(id)?.usd ?? 0;
  const pro = entryOf(PRODUCT_PRO);
  // (Its gems at the rate of the pack that sells that many: the 500 pack hands over 600.)
  const pack = CATALOGUE.find((e) => isGemPack(e) && gemsOf(e) === (pro?.gems ?? 0));
  return Math.round((usd(PRODUCT_NOADS) + usd(PRODUCT_DOUBLER) + (pack?.usd ?? 0)) * 100) / 100;
}

/** A one-time product is already owned. */
export function ownsProduct(save: Pick<SaveData, 'iap'>, id: string): boolean {
  return iapOf(save).owned.includes(id);
}

/**
 * Pay one transaction of one product out into the save: gems, coins, items, the ownership record and the
 * transaction's id. Null, and nothing changes, when it was paid before: the same transaction id again, or a
 * one-time product that is already owned (a restore's transactions carry new ids). A one-time product handed back
 * by a restore (a new device) brings its items and ownership back but not its coins or gems: those were spent where
 * they were paid, and a reinstall must not be a currency tap. The caller saves, then finishes the transaction with
 * the store. Everything paid out is fixed and stated: nothing here is random.
 */
export function applyPurchase(save: SaveData, entry: IapEntry, txId: string, restored = false, passTarget?: string): IapGrant | null {
  const st = iapOf(save);
  const key = `${txId}|${entry.id}`;
  if (st.applied.includes(key)) return null;
  if (entry.kind === 'non-consumable' && st.owned.includes(entry.id)) return null;
  const back = restored && entry.kind === 'non-consumable';
  const coins = back ? 0 : coinsOf(entry);
  let gems = back ? 0 : gemsOf(entry);
  // The first buy of each gem pack pays double, once ever per pack (the save remembers which were bought).
  let firstBonus = 0;
  if (isGemPack(entry) && !st.firsts.includes(entry.id)) {
    firstBonus = gems * (FIRST_BUY_MULT - 1);
    gems += firstBonus;
    st.firsts.push(entry.id);
  }
  if (coins > 0) creditCoins(save, coins);
  if (gems > 0) addGems(save, gems, `iap:${entry.id}`);
  const items = entry.items.filter((it) => grantItem(save, it.cat, it.id)).map((it) => itemKey(it.cat, it.id));
  const pass = !!entry.pass && activatePass(save, new Date(), passTarget);
  if (entry.kind === 'non-consumable') st.owned.push(entry.id);
  st.applied.push(key);
  if (st.applied.length > IAP_APPLIED_MAX) st.applied.splice(0, st.applied.length - IAP_APPLIED_MAX);
  return { productId: entry.id, coins, gems, items, noAds: !!entry.noAds, firstBonus, pass, doubler: !!entry.doubler, restored: false };
}

// ------------------------------------------------------------------ cordova-plugin-purchase (v13): the slice we use

/*
 * Written from the plugin's v13 API (https://github.com/j3k0/cordova-plugin-purchase). It is NOT imported: the
 * plugin lives only in the native app and puts `CdvPurchase` on window. Check every name below against the
 * version you install (npm ls cordova-plugin-purchase); the plugin's own types ship with it (www/store.d.ts).
 */
export interface CdvError {
  code: number;
  message?: string;
  productId?: string;
}
export interface CdvOffer {
  id: string;
  pricingPhases?: { price?: string }[];
  /** Starts the purchase; resolves with an error, or undefined once the store took the order. */
  order(additionalData?: unknown): Promise<CdvError | undefined>;
}
export interface CdvProduct {
  id: string;
  title?: string;
  owned?: boolean;
  pricing?: { price?: string };
  offers?: CdvOffer[];
  getOffer(offerId?: string): CdvOffer | undefined;
}
export interface CdvTransaction {
  transactionId?: string;
  products: { id: string }[];
  state?: string;
  finish(): Promise<void>;
  verify?(): Promise<unknown>;
}
export interface CdvReceipt {
  finish(): Promise<void>;
  transactions?: CdvTransaction[];
}
export interface CdvWhen {
  /** The store approved the payment: grant here for local trust (v1). */
  approved(cb: (t: CdvTransaction) => void): CdvWhen;
  /** A validation server confirmed the receipt: move the grant here once `store.validator` is set. */
  verified(cb: (r: CdvReceipt) => void): CdvWhen;
  finished(cb: (t: CdvTransaction) => void): CdvWhen;
}
export interface CdvStore {
  register(products: { id: string; type: string; platform: string }[]): void;
  initialize(platforms?: string[]): Promise<CdvError[]>;
  when(): CdvWhen;
  get(id: string, platform?: string): CdvProduct | undefined;
  owned?(id: string): boolean;
  restorePurchases(): Promise<CdvError | undefined>;
  defaultPlatform(): string;
  error(cb: (e: CdvError) => void): void;
}
export interface CdvPurchaseGlobal {
  store: CdvStore;
  ProductType: { CONSUMABLE: string; NON_CONSUMABLE: string };
  Platform: { APPLE_APPSTORE: string; GOOGLE_PLAY: string };
  ErrorCode?: { PAYMENT_CANCELLED?: number };
}

declare global {
  interface Window {
    CdvPurchase?: CdvPurchaseGlobal;
  }
}

// ------------------------------------------------------------------ providers

type Deliver = (productId: string, txId: string, restored: boolean) => DeliverResult;

interface Provider {
  readonly ready: boolean;
  /** Products the store can actually sell right now, with the store's price strings. */
  prices(): { id: string; price: string }[];
  buy(id: string): Promise<IapBuyResult>;
  /** False when the store could not be reached. */
  restore(): Promise<boolean>;
}

/** How long a purchase may sit with the store (a family approval, a slow bank) before the shop calls it pending. */
const PENDING_MS = 60_000;
/** After restorePurchases() resolves, the approved events still arrive: give them a moment before counting. */
const RESTORE_SETTLE_MS = 1500;
const CANCELLED = 6777006; // CdvPurchase.ErrorCode.PAYMENT_CANCELLED in v13 (read from the global when it has it)

class NativeStore implements Provider {
  ready = false;
  private platform = '';
  private waiters = new Map<string, (r: IapBuyResult) => void>();

  constructor(private cdv: CdvPurchaseGlobal, private deliver: Deliver, private rejectOrder: (id: string) => boolean) {}

  async init(): Promise<void> {
    const { store, ProductType, Platform } = this.cdv;
    this.platform = store.defaultPlatform();
    // Both stores know every id (the same ids in both consoles); the plugin talks to the one this device has.
    store.register(CATALOGUE.flatMap((e) => [Platform.APPLE_APPSTORE, Platform.GOOGLE_PLAY].map((platform) => ({
      id: e.id, platform, type: e.kind === 'consumable' ? ProductType.CONSUMABLE : ProductType.NON_CONSUMABLE,
    }))));
    store.when().approved((t) => void this.approved(t));
    store.error((e) => this.failed(e));
    const errors = await store.initialize([this.platform]);
    // A store that could not load at all (offline, no Play services): the shop shows no packs. Per-product
    // problems (an id not set up yet) just leave that product out of prices().
    if (errors.length && !this.prices().length) throw new Error(errors[0]?.message ?? 'store unavailable');
    this.ready = true;
    this.syncOwned();
  }

  /** The store approved a payment: pay it out, save, and only then finish it (finishing consumes or acknowledges it). */
  private async approved(t: CdvTransaction): Promise<void> {
    const txId = t.transactionId || `anon:${t.products.map((p) => p.id).join('+')}:${Date.now()}`;
    let finish = t.products.length > 0;
    for (const p of t.products) {
      const r = this.deliver(p.id, txId, false);
      // An id we don't sell, or no save to pay into yet: leave it unfinished, the store brings it back next launch.
      if (r !== 'applied' && r !== 'duplicate') finish = false;
      else this.waiters.get(p.id)?.('ok');
    }
    if (finish) await t.finish().catch(() => {});
  }

  private failed(e: CdvError): void {
    const cancelled = this.cancelled(e);
    // Payment rejection codes from the plugin's ErrorCode enum. Metadata/receipt/network errors do not
    // establish whether an unfinished order was charged, so a pending Journey must retain its target.
    const definitive = cancelled || [6777003, 6777005, 6777007, 6777008].includes(e.code);
    const result = (id: string, cleared: boolean): IapBuyResult => id === PRODUCT_PASS && (!definitive || !cleared) ? 'pending' : cancelled ? 'cancelled' : 'failed';
    if (e.productId) {
      const cleared = !definitive || this.rejectOrder(e.productId);
      this.waiters.get(e.productId)?.(result(e.productId, cleared));
    } else {
      for (const [id, waiter] of [...this.waiters.entries()]) {
        const cleared = !definitive || this.rejectOrder(id);
        waiter(result(id, cleared));
      }
    }
  }

  private cancelled(e: CdvError): boolean {
    return e.code === (this.cdv.ErrorCode?.PAYMENT_CANCELLED ?? CANCELLED) || /cancel/i.test(e.message ?? '');
  }

  /** A definitive failure from the app's StoreKit observer has already been durably recorded. */
  rejected(id: string, result: 'cancelled' | 'failed'): void {
    this.waiters.get(id)?.(result);
  }

  prices(): { id: string; price: string }[] {
    return CATALOGUE.flatMap((e) => {
      const p = this.cdv.store.get(e.id, this.platform);
      const price = p?.pricing?.price ?? p?.offers?.[0]?.pricingPhases?.[0]?.price;
      return price ? [{ id: e.id, price }] : [];
    });
  }

  buy(id: string): Promise<IapBuyResult> {
    const offer = this.cdv.store.get(id, this.platform)?.getOffer();
    if (!offer) return Promise.resolve('failed');
    if (this.waiters.has(id)) return Promise.resolve('pending');
    return new Promise<IapBuyResult>((resolve) => {
      const timer = setTimeout(() => done('pending'), PENDING_MS);
      const done = (r: IapBuyResult) => {
        clearTimeout(timer);
        this.waiters.delete(id);
        resolve(r);
      };
      this.waiters.set(id, done);
      // order() resolves once the store took the order, long before the player has paid: the result is the
      // approved event (granted: 'ok') or the plugin's error callback (cancelled / failed).
      offer.order().then((err) => {
        if (err) this.failed({ ...err, productId: id });
      }, () => done(id === PRODUCT_PASS ? 'pending' : 'failed'));
    });
  }

  async restore(): Promise<boolean> {
    const err = await this.cdv.store.restorePurchases().catch((e: unknown) => ({ code: 0, message: String(e) }));
    if (err) return false;
    this.syncOwned();
    await new Promise<void>((r) => setTimeout(r, RESTORE_SETTLE_MS));
    return true;
  }

  /** The store lists a one-time product as owned (Google Play after a reinstall, an iOS receipt): hand it over. */
  private syncOwned(): void {
    const { store } = this.cdv;
    for (const e of CATALOGUE) {
      if (e.kind !== 'non-consumable') continue;
      const owned = store.owned ? store.owned(e.id) : !!store.get(e.id, this.platform)?.owned;
      if (owned) this.deliver(e.id, `owned:${e.id}`, true);
    }
  }
}

/** The fake store: instant success, its own "owned" ledger (kept across reloads) so RESTORE has something to restore. */
class DevStore implements Provider {
  readonly ready = true;
  private owned = new Set<string>();
  private seq = 0;
  static readonly KEY = 'blocky-league-iap-dev';

  constructor(private deliver: Deliver, private force: IapBuyResult) {
    try {
      const raw = JSON.parse(localStorage.getItem(DevStore.KEY) ?? '[]') as unknown;
      if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string') this.owned.add(id);
    } catch {
      /* no storage: the ledger lives for this page only */
    }
  }

  private keep(): void {
    try {
      localStorage.setItem(DevStore.KEY, JSON.stringify([...this.owned]));
    } catch {
      /* ignore */
    }
  }

  prices(): { id: string; price: string }[] {
    return CATALOGUE.map((e) => ({ id: e.id, price: `$${e.usd.toFixed(2)}` }));
  }

  async buy(id: string): Promise<IapBuyResult> {
    const e = entryOf(id);
    if (!e) return 'failed';
    if (this.force !== 'ok') return this.force;
    // A real store refuses a one-time product you already own: that is what RESTORE is for.
    if (e.kind === 'non-consumable' && this.owned.has(id)) return 'failed';
    const r = this.deliver(id, `dev-${Date.now()}-${++this.seq}`, false);
    if (r === 'unbound' || r === 'unknown' || r === 'unsaved') return 'failed';
    if (e.kind === 'non-consumable') {
      this.owned.add(id);
      this.keep();
    }
    return 'ok';
  }

  async restore(): Promise<boolean> {
    for (const id of this.owned) this.deliver(id, `dev-restore-${id}`, true);
    return true;
  }
}

// ------------------------------------------------------------------ choosing the provider

/** The plugin's global, waiting a moment for Cordova's deviceready inside a native shell (it loads the plugin's script). */
async function nativeStore(): Promise<CdvPurchaseGlobal | null> {
  if (typeof window === 'undefined') return null;
  if (window.CdvPurchase?.store) return window.CdvPurchase;
  if (!(window as unknown as { cordova?: unknown }).cordova && !inNativeApp()) return null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    document.addEventListener('deviceready', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  return window.CdvPurchase?.store ? window.CdvPurchase : null;
}

function devRequested(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('iap') === 'dev';
}

function devForce(): IapBuyResult {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('iapresult') : null;
  return q === 'cancelled' || q === 'failed' || q === 'pending' ? q : 'ok';
}

// ------------------------------------------------------------------ the store

export class Iap {
  provider: IapProvider = 'none';
  private ctx: { save: SaveData; persist: () => boolean | void } | null = null;
  private impl: Provider | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Set<(g: IapGrant) => void>();
  private stateListeners = new Set<() => void>();
  private restoreLog: string[] | null = null;
  private buying = false;
  /** Also true during initialization, before native approvals can arrive and provider is assigned. */
  private durableNativeReceipts = false;

  constructor(private readonly watchRejections = watchPurchaseRejections) {}

  /** Point the store at the running save (main.ts holds the one save object; a reload swaps its contents in place). */
  bind(ctx: { save: SaveData; persist: () => boolean | void }): void {
    this.ctx = ctx;
  }

  /** Pick the provider and load the store. Never throws; slow stores don't hold anything up (the shop reads `available` when opened). */
  init(): Promise<void> {
    return this.initPromise ??= this.start();
  }

  private async start(): Promise<void> {
    try {
      // No real-money purchases on a CrazyGames or Poki build (in dev, ?portal=), whatever else is on the page. Written
      // out with the literals so a portal bundle drops everything below (the native bridge, the dev store) as dead code.
      if (import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki') return;
      if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('portal')) return;
      const deliver: Deliver = (id, tx, restored) => this.deliver(id, tx, restored);
      const cdv = await nativeStore();
      if (cdv) {
        this.durableNativeReceipts = true;
        const store = new NativeStore(cdv, deliver, (id) => {
          if (id !== PRODUCT_PASS || !this.ctx?.save.iap?.pendingPass) return true;
          // The durable native event supplies its replay receipt. A Cordova error must not clear the target
          // first and allow a retry while an older native failure is still retained on disk.
          if (nativeFailureReceiptsAvailable()) return false;
          return this.clearPendingPass();
        });
        // Attach before Cordova initializes and drains StoreKit's queue. Its Apple adapter suppresses late
        // cancellations after deferral, so the app's durable observer supplies those definitive outcomes.
        await this.watchRejections((event) => this.nativeRejected(event, () => store.rejected(event.productId, event.result)));
        await store.init();
        this.impl = store;
        this.provider = 'native';
      } else if (devRequested()) {
        this.impl = new DevStore(deliver, devForce());
        this.provider = 'dev';
      }
    } catch {
      this.impl = null;
      this.provider = 'none';
    }
  }

  private nativeRejected(event: PurchaseRejection, settled: () => void): boolean {
    if (!this.ctx || !event || !/^[a-zA-Z0-9-]{1,64}$/.test(event.id)
      || !entryOf(event.productId) || (event.result !== 'cancelled' && event.result !== 'failed')) return false;
    const state = iapOf(this.ctx.save);
    const receipt = `native-rejection:${event.id}|${event.productId}`;
    if (state.applied.includes(receipt)) return true;
    const previous = { applied: [...state.applied], pending: state.pendingPass, updatedAt: this.ctx.save.updatedAt };
    const changed = event.productId === PRODUCT_PASS && !!state.pendingPass;
    if (changed) delete state.pendingPass;
    state.applied.push(receipt);
    if (state.applied.length > IAP_APPLIED_MAX) state.applied.splice(0, state.applied.length - IAP_APPLIED_MAX);
    let stored = false;
    try { stored = this.ctx.persist() === true; } catch { /* Native keeps the event until a retry can save. */ }
    if (!stored) {
      state.applied = previous.applied;
      if (previous.pending) state.pendingPass = previous.pending;
      else delete state.pendingPass;
      this.ctx.save.updatedAt = previous.updatedAt;
      return false;
    }
    settled();
    if (changed) for (const fn of [...this.stateListeners]) { try { fn(); } catch { /* presentation is optional */ } }
    return true;
  }

  /** Legacy shell/provider cancellation: save the cleared target, or restore it until storage recovers. */
  private clearPendingPass(): boolean {
    if (!this.ctx || !this.ctx.save.iap?.pendingPass) return true;
    let before: SaveData;
    try { before = structuredClone(this.ctx.save); } catch { return false; }
    delete this.ctx.save.iap.pendingPass;
    let stored = false;
    try { stored = this.durableNativeReceipts ? this.ctx.persist() === true : this.ctx.persist() !== false; }
    catch { /* Preserve the exact Journey on an unsuccessful write. */ }
    if (!stored) {
      restorePurchaseSave(this.ctx.save, before);
      return false;
    }
    for (const fn of [...this.stateListeners]) { try { fn(); } catch { /* presentation is optional */ } }
    return true;
  }

  /** The shop can sell for real money (or pretend to, in dev) right now. */
  get available(): boolean {
    return !!this.impl?.ready;
  }

  /** What the store can sell now, in display order, with its prices; empty when there is no store. */
  products(): IapProduct[] {
    if (!this.impl) return [];
    const prices = new Map(this.impl.prices().map((p) => [p.id, p.price]));
    return CATALOGUE.flatMap((e) => {
      const price = prices.get(e.id);
      return price ? [this.product(e, price, true)] : [];
    });
  }

  /**
   * This build sells for real money: the iPhone / iPad app (whether or not its store has answered yet), or the dev
   * store. False on the web and the portals: coins come from play and rewarded ads there, and no price is shown.
   */
  get storefront(): boolean {
    if (import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki') return false;
    return this.available || inNativeApp();
  }

  /**
   * Everything for sale, in display order, for the shop in the app: the store's own products where it has them,
   * else a stand-in at the catalogue price with `sellable` false (the store can't sell it yet: a tap says so).
   * So the Club Pass, NO ADS, the Coin Doubler, the Starter Pack, the PRO bundle and the gem packs always show in
   * the app, even before App Store Connect has them. Empty off the storefront (the web, the portals).
   */
  shelf(): IapProduct[] {
    if (!this.storefront) return [];
    const live = new Map(this.products().map((p) => [p.id, p]));
    return CATALOGUE.map((e) => live.get(e.id) ?? this.product(e, cataloguePrice(e), false));
  }

  /** The store can sell this product right now (a tap on a stand-in that can't says the store isn't ready). */
  canSell(id: string): boolean {
    return this.products().some((p) => p.id === id);
  }

  private product(e: IapEntry, price: string, sellable: boolean): IapProduct {
    const save = this.ctx?.save;
    // (NO ADS and the Coin Doubler read OWNED once the PRO bundle brought them.)
    const owned = !save ? false
      : e.pass ? passActive(save)
        : e.id === PRODUCT_NOADS ? adFree(save)
          : e.id === PRODUCT_DOUBLER ? coinDoubler(save)
            : e.kind === 'non-consumable' && ownsProduct(save, e.id);
    return {
      id: e.id, title: e.title, price, kind: e.kind, coins: coinsOf(e), baseCoins: e.coins, bonusPct: e.bonusPct,
      gems: gemsOf(e), baseGems: e.gems,
      items: e.items.map((it) => itemKey(it.cat, it.id)), noAds: !!e.noAds, tag: e.tag,
      owned,
      pass: !!e.pass, doubler: !!e.doubler,
      firstBonus: isGemPack(e) && !!save && !iapOf(save).firsts.includes(e.id),
      sellable,
    };
  }

  /** A one-time product the player already has. */
  owns(id: string): boolean {
    return !!this.ctx && ownsProduct(this.ctx.save, id);
  }

  /**
   * Buy a product. 'ok' = paid out (the grant listeners have fired), 'cancelled' = the player backed out,
   * 'failed' = nothing was charged or the store said no, 'pending' = the store has it but it isn't through yet
   * (a family approval, a slow payment): if it completes, onGrant fires later, whatever screen is up.
   */
  async buy(id: string): Promise<IapBuyResult> {
    const e = entryOf(id);
    if (!this.impl || !e || !this.ctx) return 'failed';
    // A one-time product is buyable once (the Starter Pack, NO ADS, the Coin Doubler, the PRO bundle: its parts
    // count as owned through it); the Club Pass once per permanent Journey.
    if (e.kind === 'non-consumable' && this.owns(id)) return 'failed';
    if ((id === PRODUCT_NOADS && adFree(this.ctx.save)) || (id === PRODUCT_DOUBLER && coinDoubler(this.ctx.save))) return 'failed';
    if (e.pass && passActive(this.ctx.save)) return 'failed';
    if (e.pass && iapOf(this.ctx.save).pendingPass) return 'pending';
    if (this.buying) return 'pending';
    this.buying = true;
    const state = iapOf(this.ctx.save);
    if (e.pass) {
      state.pendingPass = seasonOf(this.ctx.save).id;
      let stored = false;
      try {
        const result = this.ctx.persist();
        stored = this.durableNativeReceipts ? result === true : result !== false;
      } catch { /* No order without its stored target. */ }
      if (!stored) {
        delete state.pendingPass;
        this.buying = false;
        return 'failed'; // Do not place an order whose original Journey cannot be stored.
      }
    }
    try {
      const result = await this.impl.buy(id);
      if (e.pass && (result === 'cancelled' || result === 'failed')) {
        if (!this.clearPendingPass()) return 'pending';
      }
      return result;
    } catch {
      // An unexpected provider exception is an unknown outcome, not proof the payment was cancelled.
      // Keep its original Journey until a late approval arrives instead of allowing a second charge.
      return e.pass ? 'pending' : 'failed';
    } finally {
      this.buying = false;
    }
  }

  /**
   * RESTORE PURCHASES (Apple requires the button): hands back the one-time products the store says this account
   * owns (NO ADS, the Coin Doubler, the PRO bundle, the Starter Pack and its Gold ball). Gem packs are consumed on
   * purchase and never come back.
   */
  async restore(): Promise<IapRestoreResult> {
    if (!this.impl || !this.ctx) return { ok: false, restored: [] };
    this.restoreLog = [];
    const ok = await this.impl.restore().catch(() => false);
    const restored = this.restoreLog;
    this.restoreLog = null;
    return { ok, restored };
  }

  /** Be told of every grant (a purchase, a late approval, a restore). Returns the way to stop listening. */
  onGrant(fn: (g: IapGrant) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** An unfinished order was definitively declined; open shop controls can reflect that without a fake grant. */
  onStateChange(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  }

  /**
   * A provider calls this for every transaction the store delivers. Idempotent: 'duplicate' = already paid out
   * (nothing changed; the provider may finish the transaction), 'applied' = paid out and saved. 'unknown'
   * (not our product), 'unbound' (no save yet) and 'unsaved' (write failed) must NOT be finished: the store brings them back.
   */
  deliver(productId: string, txId: string, restored: boolean): DeliverResult {
    const ctx = this.ctx;
    if (!ctx) return 'unbound';
    const entry = entryOf(productId);
    if (!entry) return 'unknown';
    // Inside a restore (the store's restored transactions arrive as ordinary approvals) a one-time product is "restored".
    const inRestore = this.restoreLog !== null && entry.kind === 'non-consumable';
    let before: SaveData;
    try { before = structuredClone(ctx.save); } catch { return 'unsaved'; }
    let grant: IapGrant | null;
    try {
      const state = iapOf(ctx.save);
      grant = applyPurchase(ctx.save, entry, txId, restored || inRestore, entry.pass ? state.pendingPass : undefined);
      if (!grant) return 'duplicate';
      if (entry.pass) delete state.pendingPass;
      grant.restored = restored || inRestore;
      const stored = ctx.persist();
      if (this.durableNativeReceipts ? stored !== true : stored === false) throw new Error('Purchase save was not stored');
    } catch {
      restorePurchaseSave(ctx.save, before);
      return 'unsaved';
    }
    if (grant.restored && entry.kind === 'non-consumable') this.restoreLog?.push(productId);
    for (const fn of [...this.listeners]) {
      try {
        fn(grant);
      } catch {
        /* a listener's bug never undoes a payment */
      }
    }
    return 'applied';
  }
}

export const iap = new Iap();
