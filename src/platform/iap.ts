/**
 * Store purchases (real money): coin packs, the Starter Pack and NO ADS, behind one provider-agnostic API.
 *
 * Who sells what, where:
 * - `native`: the iOS and Android apps (Capacitor wrapping the web build, cordova-plugin-purchase installed). The
 *   plugin puts `window.CdvPurchase` on the page; we only feature-detect it, there is no import, so nothing
 *   native touches the web bundle. Prices and titles come from the store, in the player's currency.
 * - `dev`: a fake store for trying the shop UI. Only in a dev server (import.meta.env.DEV) with ?iap=dev in
 *   the URL; instant success. ?iapresult=cancelled|failed|pending forces that outcome.
 * - `none`: everywhere else, and ALWAYS on CrazyGames, Poki, itch and the plain website: their rules and
 *   payment integrations differ, so coins there come from play and rewarded ads (meta/shop.ts FREE COINS).
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
import { creditCoins, grantItem, iapOf, itemKey, type ShopCat } from '../meta/shop';
import { inNativeApp } from './native';

// ------------------------------------------------------------------ the catalogue

export type IapProvider = 'native' | 'dev' | 'none';
export type IapKind = 'consumable' | 'non-consumable';
export type IapBuyResult = 'ok' | 'cancelled' | 'failed' | 'pending';

export interface IapEntry {
  /** The product id in App Store Connect and Play Console: stable for good, never reuse one. */
  id: string;
  kind: IapKind;
  title: string;
  /** Coins in the pack, before the bonus. */
  coins: number;
  /** Extra coins on top, in % of `coins` (real: it is added to the grant). */
  bonusPct: number;
  /** Shop items handed over with it (the Starter Pack's Gold ball). */
  items: readonly { cat: ShopCat; id: string }[];
  /** NO ADS: no interstitial ads (rewarded ads stay: they are the player's choice). */
  noAds?: true;
  /** A tag on the card: an editorial call, keep it true if the prices move. */
  tag?: 'POPULAR' | 'BEST VALUE';
  /** The price to set in the store consoles, in US dollars (docs and the dev store only: the UI shows the store's own string). */
  usd: number;
}

export const PRODUCT_STARTER = 'bl.starter';
export const PRODUCT_NOADS = 'bl.noads';

/**
 * What is for sale, in display order. About what a Normal win pays (170 to 210 coins): 500 coins is two or three
 * wins, so the smallest pack is a small head start, never a wall; bonuses grow with the pack. The Starter Pack
 * is worth more than its price on purpose (it is the once-only first purchase) and says so with real numbers.
 */
export const CATALOGUE: readonly IapEntry[] = [
  { id: 'bl.coins.500', kind: 'consumable', title: '500 Coins', coins: 500, bonusPct: 0, items: [], usd: 0.99 },
  { id: 'bl.coins.1500', kind: 'consumable', title: '1500 Coins', coins: 1500, bonusPct: 10, items: [], usd: 2.99, tag: 'POPULAR' },
  { id: 'bl.coins.4000', kind: 'consumable', title: '4000 Coins', coins: 4000, bonusPct: 25, items: [], usd: 6.99 },
  { id: 'bl.coins.10000', kind: 'consumable', title: '10000 Coins', coins: 10000, bonusPct: 40, items: [], usd: 14.99, tag: 'BEST VALUE' },
  { id: PRODUCT_STARTER, kind: 'non-consumable', title: 'Starter Pack', coins: 2000, bonusPct: 0, items: [{ cat: 'ball', id: 'gold' }], usd: 1.99 },
  { id: PRODUCT_NOADS, kind: 'non-consumable', title: 'No Ads', coins: 0, bonusPct: 0, items: [], noAds: true, usd: 3.99 },
];

export function entryOf(id: string): IapEntry | undefined {
  return CATALOGUE.find((e) => e.id === id);
}

/** The coins a product hands over: the pack plus its bonus. */
export function coinsOf(e: Pick<IapEntry, 'coins' | 'bonusPct'>): number {
  return e.coins + Math.floor((e.coins * e.bonusPct) / 100);
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
  /** Item keys handed over ('ball:gold'). */
  items: string[];
  noAds: boolean;
  tag?: IapEntry['tag'];
  /** A one-time product the player already has (never true for coin packs). */
  owned: boolean;
}

/** What a delivered purchase changed. */
export interface IapGrant {
  productId: string;
  coins: number;
  items: string[];
  noAds: boolean;
  /** Came with a restore (or the store's owned list), not a fresh purchase. */
  restored: boolean;
}

export interface IapRestoreResult {
  /** False when the store could not be reached. */
  ok: boolean;
  /** One-time products this restore handed back (not the ones already on the device). */
  restored: string[];
}

export type DeliverResult = 'applied' | 'duplicate' | 'unknown' | 'unbound';

// ------------------------------------------------------------------ the rules (pure, no store)

/** NO ADS is owned. */
export function adFree(save: Pick<SaveData, 'iap'>): boolean {
  return iapOf(save).owned.includes(PRODUCT_NOADS);
}

/** A one-time product is already owned. */
export function ownsProduct(save: Pick<SaveData, 'iap'>, id: string): boolean {
  return iapOf(save).owned.includes(id);
}

/**
 * Pay one transaction of one product out into the save: coins, items, the ownership record and the
 * transaction's id. Null, and nothing changes, when it was paid before: the same transaction id again, or a
 * one-time product that is already owned (a restore's transactions carry new ids). A one-time product handed back
 * by a restore (a new device) brings its items and ownership back but not its coins: coins were spent where they
 * were paid, and a reinstall must not be a coin tap. The caller saves, then finishes the transaction with the store.
 */
export function applyPurchase(save: SaveData, entry: IapEntry, txId: string, restored = false): IapGrant | null {
  const st = iapOf(save);
  const key = `${txId}|${entry.id}`;
  if (st.applied.includes(key)) return null;
  if (entry.kind === 'non-consumable' && st.owned.includes(entry.id)) return null;
  const coins = restored && entry.kind === 'non-consumable' ? 0 : coinsOf(entry);
  if (coins > 0) creditCoins(save, coins);
  const items = entry.items.filter((it) => grantItem(save, it.cat, it.id)).map((it) => itemKey(it.cat, it.id));
  if (entry.kind === 'non-consumable') st.owned.push(entry.id);
  st.applied.push(key);
  if (st.applied.length > IAP_APPLIED_MAX) st.applied.splice(0, st.applied.length - IAP_APPLIED_MAX);
  return { productId: entry.id, coins, items, noAds: !!entry.noAds, restored: false };
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

  constructor(private cdv: CdvPurchaseGlobal, private deliver: Deliver) {}

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
      if (r === 'unknown' || r === 'unbound') finish = false;
      else this.waiters.get(p.id)?.('ok');
    }
    if (finish) await t.finish().catch(() => {});
  }

  private failed(e: CdvError): void {
    const r: IapBuyResult = this.cancelled(e) ? 'cancelled' : 'failed';
    if (e.productId && this.waiters.has(e.productId)) this.waiters.get(e.productId)!(r);
    else for (const w of [...this.waiters.values()]) w(r);
  }

  private cancelled(e: CdvError): boolean {
    return e.code === (this.cdv.ErrorCode?.PAYMENT_CANCELLED ?? CANCELLED) || /cancel/i.test(e.message ?? '');
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
        if (err) done(this.cancelled(err) ? 'cancelled' : 'failed');
      }, () => done('failed'));
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
    if (r === 'unbound' || r === 'unknown') return 'failed';
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
  private ctx: { save: SaveData; persist: () => void } | null = null;
  private impl: Provider | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Set<(g: IapGrant) => void>();
  private restoreLog: string[] | null = null;
  private buying = false;

  /** Point the store at the running save (main.ts holds the one save object; a reload swaps its contents in place). */
  bind(ctx: { save: SaveData; persist: () => void }): void {
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
        const store = new NativeStore(cdv, deliver);
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
      if (!price) return [];
      return [{
        id: e.id, title: e.title, price, kind: e.kind, coins: coinsOf(e), baseCoins: e.coins, bonusPct: e.bonusPct,
        items: e.items.map((it) => itemKey(it.cat, it.id)), noAds: !!e.noAds, tag: e.tag,
        owned: e.kind === 'non-consumable' && !!this.ctx && ownsProduct(this.ctx.save, e.id),
      }];
    });
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
    // A one-time product is buyable once (the Starter Pack, NO ADS).
    if (e.kind === 'non-consumable' && this.owns(id)) return 'failed';
    if (this.buying) return 'pending';
    this.buying = true;
    try {
      return await this.impl.buy(id);
    } catch {
      return 'failed';
    } finally {
      this.buying = false;
    }
  }

  /**
   * RESTORE PURCHASES (Apple requires the button): hands back the one-time products the store says this account
   * owns (NO ADS, the Starter Pack and its Gold ball). Coin packs are consumed on purchase and never come back.
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

  /**
   * A provider calls this for every transaction the store delivers. Idempotent: 'duplicate' = already paid out
   * (nothing changed; the provider may finish the transaction), 'applied' = paid out and saved. 'unknown'
   * (not our product) and 'unbound' (no save yet) must NOT be finished: the store brings them back.
   */
  deliver(productId: string, txId: string, restored: boolean): DeliverResult {
    const ctx = this.ctx;
    if (!ctx) return 'unbound';
    const entry = entryOf(productId);
    if (!entry) return 'unknown';
    // Inside a restore (the store's restored transactions arrive as ordinary approvals) a one-time product is "restored".
    const inRestore = this.restoreLog !== null && entry.kind === 'non-consumable';
    const grant = applyPurchase(ctx.save, entry, txId, restored || inRestore);
    if (!grant) return 'duplicate';
    grant.restored = restored || inRestore;
    ctx.persist();
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
