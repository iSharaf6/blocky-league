import '@fontsource/lilita-one/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './style.css';
import './ui/shell.css';
import { Vector3 } from 'three';
import type { AppContext, MatchKind, MatchRequest } from './app';
import { sfx } from './audio/sfx';
import { localDay } from './core/day';
import { ddaAssist, ddaRecord, suggestEasy, type Outcome } from './core/dda';
import { Input, isKey, setBindings, setDeviceSource } from './core/input';
import {
  BASICS_STEPS, LOCKED_FEATURES, basicsDone, completeBasics, featureOpen, heroOf, noteGoals, straightToBasics, type LockedFeature,
} from './core/onboarding';
import {
  CONTROL_DEFAULTS, advanceDaily, controlsOf, dailyChallenges, dailyFor, levelOf, levelTitle, loadSave, matchStars, matchXp, nextStreak,
  streakMult, writeSave, type CamZoom, type ControlSettings, type MatchSummary, nextUnlock,
  type SaveData, momentStarsTotal, claimMomentXp } from './core/save';
import { adoptPortalStore, challengeCounts, recordShowtime, showtimeMode, type ChallengeKind } from './core/save';
import { GRADE_BONUS, type BountyKind, type DailyLive } from './game/funLayer';
import { MatchSession, type MatchResult, type SessionOptions } from './game/matchSession';
import { PRESET_CLUBS, dedupeSurnames, makeTeam, resolveKitClash } from './meta/data';
import { CAT_LABEL, DEFAULT_ID, earnTokens, equippedId, iapOf, inReach, newInShop, shopItem, shopOf, type ShopCat, type ShopItem } from './meta/shop';
import { decorOf, styleMatch } from './meta/style';
import { atmosphereOf, chantRate, withCrowd, type Atmosphere } from './meta/atmosphere';
import { GEM_PRICES, GEM_REWARDS, gems, rewardGems, spendGems } from './meta/gems';
import { CALENDAR, adsLeft, advanceWeekly, calendarNext, calendarToday, claimCalendar, claimSweep, useAd, weeklyFor, weeklyObjectives } from './meta/loops';
import { payoutText, syncAchievementGems } from './meta/gemSources';
import { syncSeasonGems, syncSignatureEntitlements } from './meta/pass';
import { ads } from './platform/ads';
import { adFree, coinDoubler, iap, PRODUCT_NOADS, PRODUCT_STARTER } from './platform/iap';
import { PITCH_Y } from './render/stadium';
import { World, type TimeOfDay } from './render/world';
import { BOX_DEPTH, BOX_W, HALF_L } from './sim/constants';
import { finishScenario } from './sim/scenario';
import type { Match } from './sim/match';
import type { FormationId, KickKind, MatchEvent, MatchMode, Side } from './sim/types';
import { DIFFICULTIES, DIFF_LEVEL, Menus, type MainInfo } from './ui/menus';
import { clubRating, clubTeam, type ClubState } from './meta/career';
import { clubRating as presetRating } from './meta/cup';
import { openCareer } from './ui/career';
import { careerState, closeMeta, openClub } from './ui/club';
import { STORE_NOT_READY, openShop, shopOpen } from './ui/shop';
import { captainCard, careerOf, goalOf, roadCard, seasonCard, transfersNews } from './ui/hubInfo';
import { openMarket } from './ui/market';
import { applyTextSize } from './ui/textSize';
import type { Projector } from './ui/hud';
import { openMoments } from './ui/moments';
import type { OnlineHost } from './ui/online';
import { SEP_MARK, installSepGuard, scoreHtml, sep } from './ui/text';
import { Lesson, Trainer } from './ui/trainer';
import { TouchControls } from './ui/touch';
import { saveClip, shareClip } from './ui/clips';
import { openRun } from './ui/run';
import { openBadges } from './ui/badges';
import { BASICS } from './meta/moments';
import { recordMatchMeta, wornTitle, wornTitleDetails, type MasteryMatch } from './meta/mastery';
import { runTileText } from './meta/run';
import type { ClipSource } from './ui/menus';
import { accountsRequired, cloudAvailable, cloudBoot, cloudSession, cloudUser, openAccount, syncSoon } from './platform/cloud';
import { gameCenterSignInOnce, queueGameCenterSync, syncGameCenter } from './platform/gameCenter';
import { canStart, gateNow, gateWhy, onGateChange } from './platform/online';
import { connectOpen, markHub, openConnect } from './ui/connect';
import { buzz, installUiHaptics, setHapticsLevel, setHapticsQuiet } from './platform/haptics';
import { inNativeApp } from './platform/native';
import type { WeatherKind } from './render/weather';
import { MatchRecoveryStore, RECOVERY_INTERVAL_S, recoveryRequest, recoveryRoute, type PendingMatch } from './game/matchRecovery';
import { rebuildRecoveryRequest, recoveryContext } from './game/matchRecoveryRequest';
import { standardCoinReward, skillGoalCoins, MAX_REWARDED_SKILL_GOALS, matchCoinPayout } from './meta/matchEconomy';
import { maybeAskForReview } from './platform/review';

/** A brief studio entrance on the standalone site; portals only wait for actual loading. */
const bootAt = performance.now();
const SPLASH_MS = 1100;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = new World(canvas);
const input = new Input();
// The trainer's first-match teaching steps watch the stick and PASS through the live input (see ui/trainer.ts).
Trainer.input = input;
// Every on-screen key hint names the device in hand (core/input.ts).
setDeviceSource(() => input.lastDevice);
const menus = new Menus();
menus.clipActions = { save: saveClip, share: shareClip };
const save = loadSave();
let saveGeneration = 0;
/** An ad must pay the save/account that requested it, even though reload replaces contents in place. */
function rewardSaveGuard(): () => boolean {
  const generation = saveGeneration;
  const account = cloudSession()?.userId;
  return () => generation === saveGeneration && account === cloudSession()?.userId;
}
/** A portal build (CrazyGames / Poki; in dev, ?portal=): a first visit goes straight from TAP TO PLAY to the first drill. */
const PORTAL = import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki'
  || (import.meta.env.DEV && new URLSearchParams(location.search).has('portal'));
let session: MatchSession | null = null;
let demo: MatchSession | null = null;
/** The main menu (or a screen off it) is up, as opposed to the title screen or a match. */
let atMenu = false;
const matchRecovery = new MatchRecoveryStore({
  getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: k => localStorage.removeItem(k),
});
let ongoing: { session: MatchSession; request: MatchRequest; tally: Tally; recordPlayed: number; progressXp: number; context: string } | null = null;
let recoveryT = 0;

function clearMatchRecovery(): void { ongoing = null; matchRecovery.clear(); }

function checkpointMatch(force = false): void {
  const o = ongoing;
  if (!o || session !== o.session || o.session.driver) return;
  if (save.record.played !== o.recordPlayed || save.progress.xp !== o.progressXp) { clearMatchRecovery(); return; }
  if (!force && recoveryT < RECOVERY_INTERVAL_S) return;
  recoveryT = 0;
  try {
    const runtime = o.session.checkpoint();
    if (!runtime) return;
    matchRecovery.write({ version: 1, savedAt: new Date().toISOString(), recordPlayed: o.recordPlayed, progressXp: o.progressXp,
      context: o.context, route: recoveryRoute(o.request), request: recoveryRequest(o.request), options: o.session.opt, runtime, tally: { ...o.tally } });
  } catch { /* Recovery storage is optional; a quota or unavailable store must never freeze a match. */ }
}

function persist(): boolean {
  const stored = writeSave(save);
  if (ongoing && (save.record.played !== ongoing.recordPlayed || save.progress.xp !== ongoing.progressXp)) clearMatchRecovery();
  // (Game Center, in the app: anything a save moved goes up once the burst settles. A no-op elsewhere.)
  queueGameCenterSync(save);
  return stored;
}

// Store purchases (platform/iap.ts) pay out into the one save and store it before the store is told it arrived.
// NO ADS switches the interstitials off (rewarded ads stay: they are the player's choice). Both read the live save.
ads.adFree = () => adFree(save);
iap.bind({ save, persist });
iap.onGrant((g) => {
  // A purchase that completes while the shop is shut (a family approval, one the store re-delivers at launch) still says so.
  if (!shopOpen() && !g.restored) {
    const got = [g.gems ? `+${g.gems.toLocaleString('en-US')} GEMS` : '', g.coins ? `+${g.coins.toLocaleString('en-US')} COINS` : ''].filter(Boolean).join(' AND ');
    menus.toast(`PURCHASE ARRIVED${got ? `: ${got}` : ''}`);
  }
});

/**
 * Replace the running save with another (a file the player imported, or the cloud copy): every module holds
 * the one `save` object, so its contents are swapped in place. Then it is stored, the settings applied, and
 * the menu redrawn if one is up (a match in progress carries on and sees the new save at full time).
 */
function reload(d: SaveData): void {
  saveGeneration++;
  const n = PRESET_CLUBS.length;
  const idx = (i: number, dflt: number) => (Number.isInteger(i) && i >= 0 && i < n ? i : dflt);
  for (const k of Object.keys(save)) delete (save as unknown as Record<string, unknown>)[k];
  Object.assign(save, d);
  save.clubIdx = idx(save.clubIdx, 5);
  save.opponentIdx = idx(save.opponentIdx, save.clubIdx === 6 ? 5 : 6);
  applySettings();
  if (atMenu && !session) {
    closeMeta();
    mainMenu();
  }
}

/** The match camera distance from Settings (older saves: normal). */
function camZoom(): CamZoom {
  return save.settings.camZoom ?? 'normal';
}

/** A SHOP category's look to play with: the chosen one while it is yours (earned by level or bought), else none (the default). */
function equipped(cat: ShopCat): string | undefined {
  const id = equippedId(save, cat);
  return id === DEFAULT_ID[cat] ? undefined : id;
}

/** The ball look to play with: the chosen one if this level has earned it or it was bought, else the classic ball. */
function equippedSkin(): string | undefined {
  return equipped('ball');
}

/** The goal celebration to play: the chosen one if this level has earned it or it was bought, else the classic one. */
function equippedCelebration(): string | undefined {
  return equipped('celebration');
}

/** Live camera-distance change (Settings opened from the pause menu). Optional: older sessions lack it. */

function applyCamZoom(s: MatchSession | null): void {
  (s as { setCamZoom?: (z: CamZoom) => void } | null)?.setCamZoom?.(camZoom());
}

/** The PITCH TRAINER setting as last applied (applyControls: null before the first match). */
let trainerWas: boolean | null = null;

/**
 * Settings > Controls onto a match: pass assistance (ground / through), auto switch, switch move assist and
 * timed finishing. The sim reads them every tick, so a change from the pause menu applies at once.
 */
function applyControls(m: Match, c: ControlSettings = controlsOf(save.settings)): void {
  // (PITCH TRAINER switched back on: the cards he had outgrown come back in full.)
  if (trainerWas === false && c.trainer) Trainer.resetLearned();
  trainerWas = c.trainer;
  m.groundAssist = c.groundAssist;
  m.throughAssist = c.throughAssist;
  m.autoSwitch = c.autoSwitch;
  m.moveAssist = c.moveAssist;
  m.timedFinish = c.timedFinish;
  m.trainer = c.trainer;
  m.quickPass = c.quickPass;
}

/**
 * Per-frame control feedback for the match UI: the touch PASS / THROUGH buttons fill up while the pass is
 * charged (PASS: the sim's passCharge, 0..1 while held with the ball; THROUGH: its hold time against the
 * 0.8 s full-power lob), and the HUD drops a set-piece hint the moment an action button is pressed.
 */
function syncControlsUi(s: MatchSession | null): void {
  if (!s) return;
  const m = s.match;
  if (s.touch) {
    const pass = typeof m.passCharge === 'number' ? m.passCharge : -1;
    const lofting = m.passMode === 'through' || m.passMode === 'lob' || m.phase === 'restart';
    const through = lofting && m.throughCharge > 0 ? Math.min(1, m.throughCharge / 0.8) : -1;
    s.touch.setCharge(pass, through);
  }
  if (s.hud && !s.paused) {
    const c = input.read();
    s.hud.buttons(c.pass || c.shoot || c.through);
  }
  // Blitz: the HUD slot (and the touch ⚡ button) follow the power-up the human side holds.
  const hs = m.cfg.humanSide;
  if (s.hud && (hs === 0 || hs === 1) && m.cfg.mode === 'blitz') {
    const held = m.heldPower?.[hs] ?? null;
    s.hud.setHeldPower(held);
    s.hud.setPowerDevice(input.lastDevice);
    s.touch?.setPowerHeld(held);
  }
}

/** What the human side did this match, counted from events: headers, goals from outside the box, tackles won, skill moves, pickups. */
interface Tally {
  headers: number;
  longGoals: number;
  tacklesWon: number;
  skills: number;
  powerups: number;
  /** SKILL GOALs (sim/skills.ts 'skillGoal'): bonus XP and coins, a line on the full-time screen. */
  skillGoals: number;
  lastShot: { player: number; kind: KickKind; x: number; z: number; at: number } | null;
}

const newTally = (): Tally => ({ headers: 0, longGoals: 0, tacklesWon: 0, skills: 0, powerups: 0, skillGoals: 0, lastShot: null });

/** Match seconds over both halves. */
const matchAt = (m: Match) => (m.half - 1) * m.cfg.halfLength + m.clock;

function track(t: Tally, e: MatchEvent, m: Match, hs: Side): void {
  switch (e.type) {
    case 'kick':
      if (e.kind === 'shot' || e.kind === 'header') t.lastShot = { player: e.player ?? m.ball.lastTouch, kind: e.kind, x: e.x, z: e.z, at: matchAt(m) };
      break;
    case 'goal': {
      if (e.side !== hs || e.own) break;
      const ls = t.lastShot;
      if (!ls || ls.player !== e.scorer || matchAt(m) - ls.at > 6) break;
      if (ls.kind === 'header') t.headers++;
      else if (HALF_L - m.attackDir(hs) * ls.x > BOX_DEPTH + 0.5 || Math.abs(ls.z) > BOX_W / 2 + 0.5) t.longGoals++;
      break;
    }
    case 'tackle':
      if (e.won && m.players[e.by]?.side === hs) t.tacklesWon++;
      break;
    case 'skill':
      if (m.players[e.player]?.side === hs) t.skills++;
      break;
    case 'beat':
      if (m.players[e.by]?.side === hs) t.skills++;
      break;
    case 'powerupTaken':
      if (e.side === hs) t.powerups++;
      break;
    case 'skillGoal':
      if (e.side === hs) t.skillGoals++;
      break;
    default:
      break;
  }
}

/** The daily challenges a match moves on as it is played (the rest are settled at full time: a win, the man of the match). */
const LIVE_KINDS: ReadonlySet<ChallengeKind> = new Set(['goals', 'goalsOne', 'headers', 'passes', 'longGoals', 'tackles', 'skills', 'powerups']);
/** Which live goals a daily challenge's kind leans the offers towards. */
const TILT: { readonly [k in ChallengeKind]?: readonly BountyKind[] } = {
  goals: ['score'], goalsOne: ['score'], headers: ['score'], longGoals: ['score', 'onTarget'], passes: ['passShot', 'oneTouch'],
  assists: ['passShot'], tackles: ['winBack'], skills: ['skill'], cleanWins: ['hold'], wins: ['hold'], hardWins: ['hold'],
};

const blitzOf = (req: MatchRequest): boolean => req.mode === 'blitz';

/**
 * Today's challenges as this match moves them (game/funLayer.ts DailyLive): what's stored, plus what the match has
 * counted so far (the same counts full time uses: save.ts challengeCounts), for the kinds that move during play.
 */
function liveDaily(t: Tally, hs: Side, blitz: boolean, difficulty: number): { list: (m: Match) => DailyLive[]; tilt: BountyKind[] } {
  const d = dailyFor(save.progress, localDay());
  const cs = dailyChallenges(d.day);
  const tilt = cs.filter((_, i) => !d.claimed[i]).flatMap((c) => TILT[c.kind] ?? []);
  const list = (m: Match): DailyLive[] => {
    const counts = challengeCounts({
      won: false, drawn: false, goals: m.score[hs], conceded: 0, assists: 0, tacklesWon: t.tacklesWon, passes: m.stats.passes[hs],
      skills: t.skills, headers: t.headers, longGoals: t.longGoals, powerups: t.powerups, motm: false, blitz, difficulty,
    });
    return cs.map((c, i) => {
      const now = LIVE_KINDS.has(c.kind) ? counts[c.kind] : 0;
      const have = c.kind === 'goalsOne' ? Math.max(d.progress[i], now) : d.progress[i] + now;
      return { text: c.text, have: Math.min(c.goal, have), goal: c.goal, coins: c.coins, claimed: d.claimed[i] };
    });
  };
  return { list, tilt };
}

function applySettings(): void {
  const s = save.settings;
  sfx.sfxOn = s.sfx;
  sfx.crowdOn = s.crowd;
  sfx.setMusic(s.music);
  if (s.music && !session) sfx.startMusic();
  world.setQuality(s.quality);
  // Key bindings, the touch stick style and the colour-blind aid (Settings), live in a match too.
  setBindings(s.keys, s.pad);
  TouchControls.stickMode = s.stick === 'fixed' ? 'fixed' : 'floating';
  menus.stick = TouchControls.stickMode;
  // AUTO SPRINT (the touch stick) and VIBRATION (haptics), Settings > Controls.
  TouchControls.autoSprint = controlsOf(s).autoSprint;
  setHapticsLevel(controlsOf(s).vibration);
  document.body.classList.toggle('cb', !!s.colorblind);
  // Menu and HUD text size (Settings > TEXT SIZE): never the touch controls, the pitch or the camera.
  applyTextSize(s.textSize);
  if (session) {
    // (Not online: each side's controls there were agreed before the kick-off, and a change on one machine
    // only would split the two games apart.)
    if (!session.driver) applyControls(session.match, basicsNow ? CONTROL_DEFAULTS : controlsOf(save.settings));
    if (basicsNow) session.match.trainer = true;
    session.hud?.setCommentary(s.commentary);
    session.hud?.setColorblind(!!s.colorblind);
    session.touch?.setStickMode(TouchControls.stickMode);
    applyCamZoom(session);
    (session as { setBallSkin?: (id?: string) => void }).setBallSkin?.(equippedSkin());
    (session as { setCelebration?: (id?: string) => void }).setCelebration?.(equippedCelebration());
    session.setQuickSubs(s.quickSubs !== false);
    session.setSideShows(s.sideShows !== false);
  }
  persist();
}

/** World point -> viewport CSS px through the match camera (the HUD keeps its captions off the ball). */
const projV = new Vector3();
/** The canvas box, read once a frame (and on resize): the HUD projects dozens of points a frame. */
let canvasRect = canvas.getBoundingClientRect();
const project: Projector = (x, y, z) => {
  projV.set(x, y + PITCH_Y, z).project(world.camera);
  if (!Number.isFinite(projV.x) || projV.z > 1) return null;
  const r = canvasRect;
  return { x: r.left + ((projV.x + 1) / 2) * r.width, y: r.top + ((1 - projV.y) / 2) * r.height };
};

function startDemo(): void {
  demo?.dispose();
  const a = Math.floor(Math.random() * PRESET_CLUBS.length);
  let b = Math.floor(Math.random() * PRESET_CLUBS.length);
  if (b === a) b = (a + 3) % PRESET_CLUBS.length;
  const home = makeTeam(PRESET_CLUBS[a]);
  const away = makeTeam(PRESET_CLUBS[b]);
  demo = new MatchSession(world, input, {
    home, away, halfLength: 600, difficulty: 3, humanSide: -1, seed: Math.floor(Math.random() * 1e9),
    kits: [home.kit, resolveKitClash(home.kit, away.kit)], attendance: 0.8, demo: true, timeOfDay: 'day',
    camZoom: camZoom(),
  });
  // Nobody plays the menu demo: it stays on the default controls whatever the player picked.
  applyControls(demo.match, CONTROL_DEFAULTS);
}

const app: AppContext = {
  save,
  menus,
  persist,
  startMatch: (req) => void startMatch(req),
  mainMenu: () => mainMenu(),
};

/**
 * Today's gift if not yet claimed: the 7-day login calendar (meta/loops.ts CALENDAR: 100 coins on day 1, +50 a day
 * up to day 7, gems on days 3 and 7, a Scout Token on day 5, then round again). It counts the days the gift was
 * claimed, not days in a row: missing a day never costs the player their place (rewarding a return, never punishing
 * an absence: docs/ECONOMY.md).
 */
function giftToday(): { amount: number; streak: number; gems: number; tokens: number } | null {
  const c = calendarToday(save, localDay());
  return c ? { amount: c.reward.coins, streak: c.step, gems: c.reward.gems, tokens: c.reward.tokens } : null;
}

function mainInfo(): MainInfo {
  const info: MainInfo = modeInfo();
  const q = PRESET_CLUBS[save.clubIdx];
  // The campaign (core/onboarding.ts): the big tile is the next basics drill, then the first match, then PLAY NOW.
  const hero = heroOf(onboarding(), played());
  if (hero.kind === 'basics') {
    info.hero = { title: 'LEARN THE BASICS', kind: 'basics' };
    info.playNow = `STEP ${hero.step + 1} OF ${BASICS_STEPS} ${SEP_MARK} ${BASICS[hero.step]?.title ?? ''}`;
  } else if (q) {
    const p = playNowPlan();
    if (hero.kind === 'first') info.hero = { title: 'FIRST MATCH', kind: 'first' };
    info.playNow = `${p.club?.short ?? q.short} v ${PRESET_CLUBS[p.rival].short} ${SEP_MARK} ${DIFFICULTIES[p.difficulty]}`;
  }
  const user = cloudUser();
  // (An account the game made by itself, Game Center or this device, has no name to show: the button reads ACCOUNT.)
  if (user && !user.auto) info.account = user.name;
  // The hub (ui/hubInfo.ts): your captain in your club's kit, ROAD TO GLORY's next fixture, the transfer news.
  let career: ReturnType<typeof careerOf> = null;
  try {
    career = careerOf(save);
    info.road = roadCard(career);
    info.transfers = transfersNews(career);
  } catch {
    // A damaged career blob must never break the menu.
    career = null;
    info.road = { kind: 'create' };
  }
  try {
    info.captain = captainCard(save, career);
  } catch {
    info.captain = undefined;
  }
  try {
    // The SEASON tile: tier of 30, rewards waiting (badges too), and the Club Pass where this build sells it.
    info.season = seasonCard(save, iap.storefront);
  } catch {
    // (Retention bookkeeping never breaks the menu.)
  }
  // REMOVE ADS in the top bar: the app, until NO ADS is bought (the store's price, else the catalogue's).
  if (iap.storefront && !adFree(save)) {
    const noAds = iap.shelf().find((x) => x.id === PRODUCT_NOADS);
    if (noAds) info.noAds = { price: noAds.price };
  }
  const gift = giftToday();
  if (gift) info.gift = gift;
  // Tomorrow's gift once today's is claimed: the reason to come back, said plainly (no timer, no penalty).
  else if (save.gift) info.tomorrow = calendarNext(save).reward;
  try {
    // Gems (economy v3): any season tier's gems still owed are paid here, then the balance beside the coins. (The
    // career's gems are paid on the road itself, where it says so: ui/career.ts.)
    const newSignature = syncSignatureEntitlements(save);
    const gemsPaid = syncSeasonGems(save);
    if (gemsPaid > 0 || newSignature.length) persist();
    info.gems = gems(save);
    // This week's objectives, under today's challenges.
    const wk = weeklyFor(save, localDay());
    info.weekly = { list: weeklyObjectives(wk.week), progress: wk.progress, claimed: wk.claimed, gems: GEM_REWARDS.weekly };
  } catch {
    // (Retention bookkeeping never breaks the menu.)
  }
  // Progression: the level badge and today's challenges (rolled over to a new day here, and saved if so).
  const p = save.progress;
  const lv = levelOf(p.xp);
  info.level = { level: lv.level, title: wornTitle(save) ?? levelTitle(lv.level), into: lv.into, need: lv.need };
  info.unlock = nextUnlock(save.progress.xp, shopOf(save).owned);
  // NEXT GOAL under the hero (meta/goal.ts): the one thing to go for now in ROAD TO GLORY.
  const goal = goalOf(career, save.coins, info.unlock);
  if (goal) info.goal = goal;
  try {
    // The count on the SHOP tile: affordable things not seen yet, and the free daily pack.
    info.shopNew = newInShop(save, localDay());
  } catch {
    // (The shop's bookkeeping never breaks the menu.)
  }
  const dayBefore = p.daily.day;
  const daily = dailyFor(p, localDay());
  if (daily.day !== dayBefore) persist();
  info.daily = { list: dailyChallenges(daily.day), progress: daily.progress, claimed: daily.claimed, fresh: daily.fresh };
  info.streak = p.streak;
  return info;
}

/** What EVENTS shows (and the hub's locks): MOMENTS' stars, the Club Run's best, the modes still locked. */
function modeInfo(): Pick<MainInfo, 'moments' | 'run' | 'locked'> {
  const info: Pick<MainInfo, 'moments' | 'run' | 'locked'> = {};
  info.locked = LOCKED_FEATURES.filter((f) => !featureOpen(onboarding(), f));
  try {
    info.run = runTileText(save);
  } catch {
    info.run = save.run?.best ? `BEST: ROUND ${save.run.best}` : 'ONE MORE RUN';
  }
  const moStars = momentStarsTotal(save);
  info.moments = moStars ? `SHORT CHALLENGES ${SEP_MARK} ★ ${moStars}` : 'SHORT CHALLENGES';
  return info;
}

/** The save's campaign state (always whole once loaded: core/save.ts). */
function onboarding(): NonNullable<typeof save.onboarding> {
  save.onboarding ??= { basics: played() > 0 ? BASICS_STEPS : 0, firstGoal: played() > 0, unlockSeen: played() > 0 };
  return save.onboarding;
}

/** What the daily gift just brought into the SHOP's reach (said once, back on the menu). */
let giftReach: ShopItem | null = null;

const FEATURE_NAMES: Record<LockedFeature, string> = { career: 'ROAD TO GLORY', moments: 'MOMENTS', run: 'CLUB RUN', blitz: 'BLITZ' };

/**
 * The online rule (platform/online.ts; the app and the plain web game): what is progression needs a connection and a
 * signed-in account. Connected, `go` runs at once; otherwise CONNECT TO PLAY opens (RETRY signs in again) and `go`
 * runs as soon as the game is connected. QUICK MATCH, the first match and the basics never come through here.
 */
function online(go: () => void): () => void {
  return () => {
    if (gateNow() === 'open') go();
    else connectPanel(go);
  };
}

function connectPanel(go: () => void): void {
  openConnect({
    done: go,
    gate: gateNow,
    why: gateWhy,
    // (The sign-in code talks to the backend: the literal check keeps it out of the portal builds altogether.)
    retry: () => (!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none'
      ? import('./platform/signin').then((m) => m.connect(true), () => false)
      : Promise.resolve(false)),
  });
}

// Connected or dropped while the hub is up: its tiles change with it.
onGateChange(() => {
  if (atMenu && !session && !connectOpen() && document.querySelector('.hub-screen')) mainMenu();
});

function mainMenu(): void {
  atMenu = true;
  basicsNow = false;
  Trainer.lesson = null;
  if (!demo) startDemo();
  if (save.settings.music) sfx.startMusic();
  // The first goal opened the locked modes: say so once, over the menu.
  const ob = onboarding();
  if (ob.firstGoal && !ob.unlockSeen) {
    ob.unlockSeen = true;
    persist();
    menus.unlocked(() => mainMenu());
    return;
  }
  // The welcome offer, once ever, after the first win, where a store sells it (the app): the Starter Pack, told
  // plainly. Never shown twice and never on a timer.
  const starter = iap.available && !iap.owns(PRODUCT_STARTER) && !iapOf(save).welcome && save.record.won >= 1
    ? iap.products().find((x) => x.id === PRODUCT_STARTER) : undefined;
  if (starter) {
    iapOf(save).welcome = true;
    persist();
    const worth = starter.coins + (shopItem('ball', 'gold')?.price ?? 0);
    menus.welcomeOffer({ price: starter.price, coins: starter.coins, worth, gems: starter.gems }, {
      // (The STORE's OFFERS section, where the pack is.)
      see: () => openShop(app, { tab: 'coins', section: 'offers' }),
      later: () => mainMenu(),
    });
    return;
  }
  // Achievements earned since the last visit pay their gems here, once each (meta/gemSources.ts), and say so below.
  let achPaid: ReturnType<typeof syncAchievementGems> = [];
  try {
    achPaid = syncAchievementGems(save);
    if (achPaid.length) persist();
  } catch {
    achPaid = [];
  }
  const info = mainInfo();
  const backup = (): void => menus.backup(save, { onImport: reload, back: () => settings() });
  // (No BACKUP inside the iPhone / iPad app: its export is a browser download, and iOS backs the app up itself.)
  // REMOVE ADS, first in Settings where this build sells it (the app): bought, it reads NO ADS: ON.
  const settings = (): void => menus.settings(save, applySettings, mainMenu, 'general', {
    backup: inNativeApp() ? undefined : backup,
    removeAds: iap.storefront ? { price: info.noAds?.price ?? '', owned: adFree(save), buy: buyNoAds } : undefined,
    account: cloudAvailable() ? () => openAccount({ save, persist, reload }, settings) : undefined,
    invite: !PORTAL ? () => openAccount({ save, persist, reload }, settings, 'friend') : undefined,
    about: () => menus.developerAbout(settings),
  });
  menus.main(save, {
    playNow: () => playNow(),
    account: cloudAvailable() ? () => openAccount({ save, persist, reload }, mainMenu) : undefined,
    invite: !PORTAL ? () => openAccount({ save, persist, reload }, mainMenu, 'friend') : undefined,
    gift: () => {
      const g = giftToday();
      if (!g) return mainMenu();
      const sameSave = rewardSaveGuard();
      const giftDay = localDay();
      menus.gift(g.amount, g.streak, ads.rewardedAvailable, {
        claim: async (double) => {
          if (!sameSave()) return false;
          const doubled = double && (await ads.rewarded());
          if (!sameSave()) return false;
          const before = save.coins;
          if (!claimCalendar(save, giftDay, g.streak, doubled)) return false;
          persist();
          giftReach = inReach(save, before, save.coins);
          return true;
        },
        back: () => {
          mainMenu();
          // The gift put something in the SHOP within reach: say so once, over the menu.
          if (giftReach) menus.toast(`NOW IN REACH IN THE SHOP: ${giftReach.name.toUpperCase()} ${CAT_LABEL[giftReach.cat].toUpperCase()}`);
          giftReach = null;
        },
      }, CALENDAR);
    },
    quick: () => quickMatch(),
    events: online(() => eventsMenu()),
    locked: (f) => menus.toast(`SCORE YOUR FIRST GOAL TO UNLOCK ${FEATURE_NAMES[f]}`),
    unlocks: () => {
      const ladder = (): void => menus.unlocks(save, mainMenu, () => openBadges(app, ladder));
      ladder();
    },
    career: online(() => openCareer(app)),
    // NEXT GOAL: straight to where it points (the ground, the market, the unlocks, the club tab or the road).
    goal: (go) => online(() => {
      if (go === 'stadium') openClub(app, { tab: 'stadium' });
      else if (go === 'market') openMarket(app);
      else if (go === 'unlocks') menus.unlocks(save, mainMenu, () => openBadges(app, mainMenu));
      // (The long game's goals: a scout report in MY CLUB > STAFF, a promise to keep on SQUAD, a mentor on TRAIN.)
      else if (go === 'staff' || go === 'squad' || go === 'train') openClub(app, { tab: go });
      else openCareer(app, undefined, go === 'academy' || go === 'board' ? 'club' : undefined);
    })(),
    club: online(() => openClub(app)),
    // TRANSFERS: straight into the market (no club yet: MY CLUB founds one first); its BACK comes home.
    transfers: online(() => openMarket(app)),
    season: online(() => openBadges(app, mainMenu, 'season')),
    shop: online(() => openShop(app)),
    // The coins: the shop's COINS tab where coins can be topped up (the app's store, a portal's free coins).
    coins: online(() => openShop(app, { tab: 'coins', section: 'coins' })),
    // The gems: the STORE's gem packs (the app), the free daily gems, the Scouting Network.
    gems: online(() => openShop(app, { tab: 'coins', section: 'gems' })),
    removeAds: info.noAds
      ? () => void buyNoAds().then((ok) => {
        // (Bought: the hub loses the button, if the player is still on it.)
        if (ok && atMenu && !session && document.querySelector('.hub-screen')) mainMenu();
      })
      : undefined,
    settings,
    howto: () => menus.howTo(mainMenu, input.lastDevice),
  }, info);
  if (achPaid.length) menus.toast(payoutText(achPaid));
  // Not connected (the app and the web game): the tiles that need it say CONNECT TO PLAY.
  markHub(document.querySelector('.hub-screen'), gateNow() !== 'open');
}

/**
 * REMOVE ADS from the hub or Settings (the app): the store's own sheet confirms the purchase. Where the store can't
 * sell it yet (not set up in App Store Connect, offline) it says so and nothing happens: no purchase is ever faked.
 */
async function buyNoAds(): Promise<boolean> {
  if (!iap.canSell(PRODUCT_NOADS)) {
    menus.toast(STORE_NOT_READY);
    return false;
  }
  const r = await iap.buy(PRODUCT_NOADS);
  if (r === 'ok') {
    menus.toast('NO ADS IS ON. THANK YOU!');
    buzz('success');
  }
  else if (r === 'pending') menus.toast('WAITING FOR THE STORE. NO ADS SWITCHES ON WHEN IT CONFIRMS');
  else if (r === 'failed') menus.toast('THAT DID NOT GO THROUGH. TRY AGAIN IN A MOMENT');
  return r === 'ok';
}

/** EVENTS (the hub's third tier): MOMENTS, CLUB RUN, BLITZ and, on the web, ONLINE. Their BACK comes here. */
function eventsMenu(): void {
  menus.events({
    back: () => mainMenu(),
    moments: () => openMoments(app, eventsMenu),
    run: () => openRun(app, eventsMenu),
    blitz: () => quickMatch('blitz'),
    // (The condition written out here, not through a variable: the bundler drops the whole branch, the import
    // with it, only when it can see the literal: see ONLINE below.)
    online: !import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none'
      ? inNativeApp() ? undefined : () => void import('./ui/online').then((o) => o.openOnline(onlineHost))
      : undefined,
    locked: (f) => menus.toast(`SCORE YOUR FIRST GOAL TO UNLOCK ${FEATURE_NAMES[f]}`),
  }, modeInfo());
}

/*
 * ONLINE ships in the web builds only: the own site and itch (VITE_PORTAL 'none'), and dev (unset). The portal builds
 * (CrazyGames, Poki) leave it out altogether: no tile, and none of its code in the bundle (the main menu's lazy
 * import is dead there once VITE_PORTAL is a literal), so a portal submission makes no WebRTC or STUN request.
 * The iPhone / iPad app wraps the itch build but shows no tile either (inNativeApp): hand-swapped codes with no
 * relay mostly fail on mobile data, and its "this browser" room means nothing in an app.
 */

/**
 * ONLINE (src/ui/online.ts, loaded on first use): it builds the match and drives it (lockstep); this puts it on
 * screen and takes it off. No coins, XP or record: an online friendly doesn't touch the save.
 */
const onlineHost: OnlineHost = {
  save,
  input,
  closeMenus: () => {
    atMenu = false;
    menus.close();
  },
  mainMenu: () => mainMenu(),
  play: (opt: SessionOptions) => {
    atMenu = false;
    menus.close();
    sfx.stopMusic();
    demo?.dispose();
    demo = null;
    endMatch();
    // (No basics lesson in an online match; the trainer's cards follow Settings as ever.)
    basicsNow = false;
    Trainer.lesson = null;
    Trainer.taught = basicsDone(onboarding());
    const s = new MatchSession(world, input, {
      ...opt, ballSkin: equippedSkin(), celebration: equippedCelebration(), goalFx: equipped('goalfx'), trail: equipped('trail'), colorblind: !!save.settings.colorblind,
    });
    session = s;
    s.hud?.setCommentary(save.settings.commentary);
    s.hud?.setColorblind(!!save.settings.colorblind);
    s.hud?.setProjector(project);
    s.touch?.setStickMode(TouchControls.stickMode);
    const blitz = opt.mode === 'blitz';
    s.hud?.setBlitz(blitz);
    s.touch?.setBlitz(blitz);
    ads.gameplayStart();
    window.addEventListener('keydown', pauseKey);
    return s;
  },
  end: () => {
    ads.gameplayStop();
    endMatch();
  },
};

/** The preset club whose squad rating is closest to `mine`'s (a fair game): a tie goes to the next one along. */
function similarRival(mine: number): number {
  const n = PRESET_CLUBS.length;
  const r0 = presetRating(mine);
  let best = (mine + 1) % n;
  let gap = Infinity;
  for (let k = 1; k < n; k++) {
    const i = (mine + k) % n;
    const g = Math.abs(presetRating(i) - r0);
    if (g < gap) {
      gap = g;
      best = i;
    }
  }
  return best;
}

/**
 * MY CLUB (meta/career.ts), once founded: PLAY NOW kicks off with it, so every signing (the SHOP's scout packs,
 * the transfer market) and every training session plays. Null until a club exists (the blob isn't touched).
 */
function myClub(): ClubState | null {
  const raw = save.career as { club?: unknown } | null;
  if (!raw || typeof raw !== 'object' || !raw.club) return null;
  try {
    const club = careerState(app).club;
    return club && club.squad.length >= 11 ? club : null;
  } catch {
    return null;
  }
}

/** The preset club rated closest to `rating` (a fair game for MY CLUB). */
function rivalFor(rating: number): number {
  let best = 0;
  let gap = Infinity;
  for (let i = 0; i < PRESET_CLUBS.length; i++) {
    const g = Math.abs(presetRating(i) - rating);
    if (g < gap) {
      gap = g;
      best = i;
    }
  }
  return best;
}

/**
 * What PLAY NOW starts: your club (MY CLUB once you have founded one, else the Quick Match club) against the
 * closest-rated rival, classic rules; a new player gets Normal and 1.5-minute halves, a returning one the
 * difficulty and half length they set in Quick Match.
 */
function playNowPlan(): { home: number; rival: number; difficulty: number; halfMinutes: number; club: ClubState | null } {
  const home = PRESET_CLUBS[save.clubIdx] ? save.clubIdx : 0;
  const fresh = save.record.played === 0;
  const club = myClub();
  const rival = club ? rivalFor(clubRating(club)) : similarRival(home);
  // The very first match is on Easy (with the first-match ease on top: core/dda.ts), and short.
  return { home, rival, difficulty: fresh ? 0 : save.settings.difficulty, halfMinutes: fresh ? 1.5 : save.settings.halfMinutes, club };
}

/** Matches played on this save so far (a moment is not a match). */
const played = (): number => save.record.played;

/**
 * PLAY NOW: straight into a match, no setup screen and no fly-in. Title → PLAY NOW → kick-off is two taps. On a
 * fresh save it is the first match: the session waits for a button at kick-off, the AI eases off and the
 * trainer teaches MOVE and PASS (MatchRequest.firstMatch).
 */
function playNow(): void {
  const hero = heroOf(onboarding(), played());
  if (hero.kind === 'basics') {
    startBasics(hero.step);
    return;
  }
  const p = playNowPlan();
  const home = p.club ? clubTeam(p.club) : makeTeam(PRESET_CLUBS[p.home]);
  const away = makeTeam(PRESET_CLUBS[p.rival]);
  // (MY CLUB's names are its own: the rival's clashing surnames give way, as in a career fixture.)
  if (p.club) dedupeSurnames(home, away);
  startMatch({
    home, away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: 0,
    difficulty: p.difficulty,
    halfMinutes: p.halfMinutes,
    attendance: 0.9,
    stadiumLevel: 5,
    mode: 'classic',
    kind: 'playnow',
    firstMatch: played() === 0,
    skipIntro: true,
    rematch: true,
    reward: (r) => standardReward(r, p.difficulty),
    onDone: () => mainMenu(),
    onQuit: () => mainMenu(),
  });
}

/** Coins-free XP for finishing a basics drill (a taste of the level bar). */
const BASICS_XP = 30;
/** A basics drill is running (the trainer stays on, the prompts show; applySettings keeps it that way). */
let basicsNow = false;

/**
 * LEARN THE BASICS step `step` (meta/moments.ts BASICS): a tiny staged drill on the Moments engine, with the
 * trainer's one-at-a-time prompts. No result screen: a miss restarts it at once (`again`), a completed pass
 * or scoring drill goes to the next step, then the YOU'RE READY card offers the first match.
 */
function startBasics(step: number, again = false): void {
  const b = BASICS[Math.max(0, Math.min(BASICS.length - 1, step))];
  const homeIdx = PRESET_CLUBS[save.clubIdx] ? save.clubIdx : 0;
  const awayIdx = similarRival(homeIdx);
  const home = makeTeam(PRESET_CLUBS[homeIdx]);
  const away = makeTeam(PRESET_CLUBS[awayIdx]);
  const spec = again ? { ...b.spec, brief: `One more go. ${b.spec.brief}` } : b.spec;
  startMatch({
    home, away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: 0,
    difficulty: 0,
    // Never reached: the drill ends itself.
    halfMinutes: 10,
    attendance: 0.6,
    stadiumLevel: 4,
    mode: 'classic',
    kind: 'basics',
    basicsStep: step,
    scenario: spec,
    skipIntro: true,
    // The AI barely competes: this is a lesson, not a test.
    assist: 0.8,
    quitNote: 'You can pick the basics up again from the menu.',
    reward: () => ({ coins: 0, label: 'BASICS' }),
    onDone: () => mainMenu(),
    onQuit: () => mainMenu(),
  });
}

/** After the basics: the first real match (Easy, short, the first-match ease and kick-off hold). */
function firstMatch(): void {
  playNow();
}

/** Standard coin payout, scaled by difficulty. */
export function standardReward(r: MatchResult, difficulty: number): { coins: number; label: string } {
  const hs: Side = r.humanSide === 1 ? 1 : 0;
  const my = r.score[hs];
  const their = r.score[hs === 0 ? 1 : 0];
  return standardCoinReward(my, their, difficulty);
}

/** Quick Match. `mode` preselects CLASSIC / BLITZ (the BLITZ tile); otherwise the last one played. */
function quickMatch(mode?: MatchMode): void {
  // BACK keeps the options changed here (difficulty, half length, kick-off time, weather, mode): saved now, not only
  // at the next kick-off, so a reload doesn't lose them.
  const back = (): void => {
    persist();
    mainMenu();
  };
  menus.quickMatch(save, back, (h, a, m) => {
    save.clubIdx = h;
    save.opponentIdx = a;
    save.settings.lastMode = m;
    persist();
    const home = makeTeam(PRESET_CLUBS[h]);
    const away = makeTeam(PRESET_CLUBS[a]);
    const difficulty = save.settings.difficulty;
    startMatch({
      home, away,
      kits: [home.kit, resolveKitClash(home.kit, away.kit)],
      humanSide: 0,
      difficulty,
      halfMinutes: save.settings.halfMinutes,
      attendance: 0.9,
      stadiumLevel: 5,
      mode: m,
      kind: 'quick',
      rematch: true,
      reward: (r) => standardReward(r, difficulty),
      onDone: () => mainMenu(),
      onQuit: () => mainMenu(),
    });
  }, mode, !featureOpen(onboarding(), 'blitz'));
}

function pickTime(): TimeOfDay {
  const t = save.settings.timeOfDay;
  if (t !== 'random') return t;
  const r = Math.random();
  return r < 0.5 ? 'day' : r < 0.75 ? 'sunset' : 'night';
}

function pickWeather(): WeatherKind {
  const w = save.settings.weather;
  if (w !== 'random') return w;
  const r = Math.random();
  return r < 0.52 ? 'clear' : r < 0.7 ? 'overcast' : r < 0.8 ? 'drizzle' : r < 0.9 ? 'rain' : r < 0.98 ? 'snow' : 'blizzard';
}

function recordResult(r: MatchResult): void {
  const hs: Side = r.humanSide === 1 ? 1 : 0;
  const my = r.score[hs];
  const their = r.score[hs === 0 ? 1 : 0];
  const rec = save.record;
  rec.played++;
  rec.goalsFor += my;
  rec.goalsAgainst += their;
  if (my > their) {
    rec.won++;
    if (my - their >= 3) ads.happyTime();
  } else if (my === their) rec.drawn++;
  else rec.lost++;
}

/** Matches and moments finished this visit (an ad break is only ever between two of them). */
let finishedThisVisit = 0;
/** Results follow the whole scene chain. A fast rematch never cuts that moment short with an automatic ad. */
let resultShownAt = Infinity;

/** Roman numerals for badge tiers (the FT line: "FINISHER II"). */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Mastery and season progress for a finished match or moment: the tier-ups as lines for the full-time screen.
 * The retention modules own the rules (meta/mastery.ts, meta/season.ts); a failure there never breaks full time.
 */
function retention(m: MasteryMatch | null, xp: number): string[] {
  const lines: string[] = [];
  try {
    // (recordMatchMeta creates the badge / season state on a brand-new save; a moment or drill adds no match numbers.)
    const none: MasteryMatch = { goals: 0, assists: 0, passes: 0, tackles: 0, cleanSheet: false, skills: 0, saves: 0 };
    const { badgeUps, seasonUps } = recordMatchMeta(save, m ?? none, xp);
    for (const up of badgeUps) lines.push(`BADGE UP: ${up.track.toUpperCase()} ${ROMAN[up.tier] ?? up.tier}`);
    if (seasonUps.length) lines.push(`SEASON TIER ${seasonUps[seasonUps.length - 1]} REACHED`);
  } catch {
    // Progress bookkeeping must never stop the result screen.
  }
  return lines;
}

/** The session's goal clip, if the browser can record one and a goal was caught (the RENDER side's API). */
function clipOf(s: MatchSession): ClipSource | undefined {
  const api = s as MatchSession & {
    lastClip?: () => { blob: Blob; name: string } | null;
    clipSupported?: () => boolean;
    lastPoster?: () => Blob | null;
  };
  if (!api.clipSupported?.()) return undefined;
  return { clip: () => api.lastClip?.() ?? null, poster: () => api.lastPoster?.() ?? null };
}

async function startMatch(req: MatchRequest, recovered?: PendingMatch): Promise<void> {
  // The online rule: only exhibition (QUICK MATCH, the first match, the basics) kicks off without a connection.
  // Reached from a screen that was open when the connection went: back to the hub, and the match starts on RETRY.
  if (!recovered && !canStart(req.kind)) {
    mainMenu();
    connectPanel(() => void startMatch(req));
    return;
  }
  atMenu = false;
  menus.close();
  sfx.stopMusic();
  const basics = req.kind === 'basics';
  // Portal interstitial only at a natural break before a new kick-off: never the first thing this visit, never
  // in or right after the basics, never before the first real match.
  if (!recovered && finishedThisVisit > 0 && performance.now() - resultShownAt >= 8000 && !basics && !req.firstMatch && played() > 0) {
    await ads.midgame(req.scenario ? 'moment' : 'match');
  }
  if (!recovered) clearMatchRecovery();
  demo?.dispose();
  demo = null;
  const { humanSide } = req;
  // COSMETICS 2.0 (meta/style.ts): your side in its premium kit and player looks (any clash is fixed on the other
  // side), and at home your ground in its stadium style. Looks only: nothing here changes play.
  const kits = recovered?.options.kits ?? styleMatch(save, req.kits, [req.home, req.away], humanSide);
  const decor = humanSide === 0 ? decorOf(save, req.kits[0], req.home.short, req.home.name) : null;
  // CLUB ATMOSPHERE (meta/atmosphere.ts): at a home match, what the stadium style worn and the ground as built are
  // worth: a fuller ground, more chants, matchday income and the mascot's half time show. The meta only: nothing
  // here touches the match itself. (A career match is at home when it brings its ground; the others when you host.)
  let atmo: Atmosphere | null = null;
  try {
    const hosting = humanSide === 0 && !basics && !req.scenario && (req.kind === 'career' ? !!req.ground : !!decor);
    if (hosting) atmo = atmosphereOf(save, req.kind === 'career' ? careerState(app).ground : null);
    if (atmo && atmo.rating <= 0) atmo = null;
  } catch {
    atmo = null;
  }
  // A new player's first three matches are played in daylight and clear weather (no snow on a first kick-off).
  const early = played() < 3;
  // The hidden ease (core/dda.ts): the request's own, else the save's streaks decide. Shown nowhere.
  const assist = req.assist ?? ddaAssist(save.dda ?? { careerLosses: 0, quickLosses: [0, 0, 0, 0] }, played(), req.kind, req.difficulty);
  basicsNow = basics;
  Trainer.lesson = basics ? new Lesson(BASICS[req.basicsStep ?? 0]?.lesson ?? []) : null;
  Trainer.taught = basicsDone(onboarding());
  session = new MatchSession(world, input, {
    home: req.home,
    away: req.away,
    kits,
    halfLength: req.halfMinutes * 60,
    difficulty: DIFF_LEVEL[req.difficulty] ?? 1.8,
    humanSide,
    attendance: atmo ? withCrowd(req.attendance, atmo) : req.attendance,
    seed: Math.floor(Math.random() * 1e9),
    timeOfDay: req.timeOfDay ?? (early || basics ? 'day' : pickTime()),
    weather: req.weather ?? (early || basics ? 'clear' : pickWeather()),
    knockout: req.knockout,
    // Career and the cup stay classic; Quick Match passes the mode the player picked.
    mode: req.mode ?? 'classic',
    // HYPE and the SUPER SHOT (sim/hype.ts): every classic match (Blitz has its power-ups; not a moment or the basics).
    hype: (req.mode ?? 'classic') === 'classic' && !req.scenario && !basics,
    // The AI coach (sim/coach.ts): the other side changes its shape and its press with the scoreline (not a moment or the basics).
    coach: !req.scenario && !basics,
    firstMatch: !!req.firstMatch && played() === 0,
    scenario: req.scenario,
    skipIntro: req.skipIntro,
    stadiumLevel: Math.max(0, Math.min(5, Math.round(req.stadiumLevel ?? 5))),
    ground: req.ground,
    tutorial: !save.seenTutorial && !basics,
    camZoom: camZoom(),
    ballSkin: equippedSkin(),
    celebration: equippedCelebration(),
    goalFx: equipped('goalfx'),
    trail: equipped('trail'),
    clubTitle: wornTitleDetails(save) ?? undefined,
    decor,
    colorblind: !!save.settings.colorblind,
    quickSubs: save.settings.quickSubs !== false,
    sideShows: save.settings.sideShows !== false,
    assist,
    startScore: req.startScore,
    keeperBoost: req.keeperBoost,
    goldenFirst: req.goldenFirst,
    startPower: req.startPower,
    sideDifficulty: req.sideDifficulty,
    ...(recovered?.options ?? {}),
    ...(recovered ? { skipIntro: true } : {}),
  });
  if (recovered) session.restoreCheckpoint(recovered.runtime);
  applyControls(session.match, basics ? CONTROL_DEFAULTS : controlsOf(save.settings));
  // (The session set the ground's crowd; a better atmosphere makes the home crowd sing more often.)
  if (atmo) sfx.setChantRate(chantRate(atmo));
  // The basics prompts live in the trainer: it is on for them whatever Settings says.
  if (basics) session.match.trainer = true;
  session.hud?.setCommentary(save.settings.commentary && !basics);
  session.hud?.setColorblind(!!save.settings.colorblind);
  session.hud?.setProjector(project);
  session.touch?.setStickMode(TouchControls.stickMode);
  const blitz = req.mode === 'blitz';
  session.hud?.setBlitz(blitz);
  session.touch?.setBlitz(blitz);
  if (basics && session.hud) {
    const hud = session.hud;
    const step = (req.basicsStep ?? 0) + 1;
    // No clock to beat and no fail state: the step number where the countdown was, no 5-4-3-2-1, and the
    // moment's verdicts in the drill's own words.
    hud.countdownLabel = `${step}/${BASICS_STEPS}`;
    hud.retitle = (b) => {
      if (/^\d+$/.test(b.title)) return null;
      if (b.title === 'FAILED') return { ...b, title: 'AGAIN!', sub: 'One more go' };
      if (b.title === 'COMPLETE!') return { ...b, title: 'NICE!', sub: step < BASICS_STEPS ? `Step ${step} of ${BASICS_STEPS} done` : 'Basics done' };
      return b;
    };
  }
  // Count what the human does (headers, long-range goals, tackles, skills, pickups) for XP and the daily challenges.
  const tally = newTally();
  if (recovered) Object.assign(tally, recovered.tally);
  const hs: Side = humanSide === 1 ? 1 : 0;
  const lesson = Trainer.lesson;
  // LIVE GOALS (game/funLayer.ts): today's challenges, with this match counted in, move on the HUD as they happen
  // (their coins are still paid at full time, below). The bounties lean towards the ones still open.
  const fun = session.fun;
  const dailyLive = fun && !req.scenario && !basics ? liveDaily(tally, hs, blitzOf(req), req.difficulty) : null;
  if (fun && dailyLive) fun.setDaily(dailyLive.list(session.match), dailyLive.tilt);
  if (session.hud) {
    session.hud.onEvent = (e, m) => {
      track(tally, e, m, hs);
      lesson?.event(e, m);
      if (fun && dailyLive) fun.setDaily(dailyLive.list(m));
    };
  }
  const s = session;
  // The HUD's camera button (and V / VIEW) steps the camera: kept, so Settings > CAMERA and the next match agree.
  s.onCamZoom = (z) => {
    save.settings.camZoom = z;
    persist();
  };
  ads.gameplayStart();
  // TACTICS & SUBS: BACK returns to the pause (or half-time) screen; RESUME (SECOND HALF) goes straight back to play.
  const tacticsMenu = (back: () => void, resume?: () => void, resumeLabel?: string) =>
    menus.tactics(s.match, humanSide, kits, {
      setMentality: (v) => s.setMentality(humanSide, v),
      substitute: (slot, benchIdx) => s.substitute(humanSide, slot, benchIdx),
      // Match.setFormation is new in the sim; the optional call keeps older builds working (picker is a no-op).
      setFormation: (id) => (s.match as Match & { setFormation?: (side: Side, f: FormationId) => unknown }).setFormation?.(humanSide, id),
      back,
      resume,
      resumeLabel,
    });
  // QUIT at the pause and at half time alike: what walking off costs (a forfeit defeat where the request says so: the
  // career, the cup, a run), then out to where the match came from.
  const quitNote = req.quitNote ?? "This match won't count and you won't earn any coins.";
  const forfeit = !basics && /defeat/i.test(quitNote);
  const quitMatch = (): void => {
    if (forfeit) save.progress.streak = 0;
    menus.close();
    endMatch();
    menuMusic();
    (req.onQuit ?? mainMenu)();
  };
  s.onPause = () => {
    ads.gameplayStop();
    const resumeMatch = (): void => {
      menus.close();
      s.resume();
      ads.gameplayStart();
    };
    const pauseMenu = (): void =>
      menus.pause({
        quitNote,
        quitLabel: basics ? 'BACK TO MENU' : undefined,
        forfeit,
        tactics: basics ? undefined : () => tacticsMenu(pauseMenu, resumeMatch),
        resume: resumeMatch,
        howto: () => menus.howTo(pauseMenu, input.lastDevice),
        // Mid-match, the options that matter are the controls: open on that tab.
        settings: () => menus.settings(save, applySettings, pauseMenu, 'controls'),
        // The last goal's clip, once there is one.
        clip: basics ? undefined : clipOf(s),
        // LEARN THE BASICS: an experienced player can skip the rest (the modes still wait for a real goal).
        skip: basics ? () => {
          onboarding().basics = BASICS_STEPS;
          persist();
          menus.close();
          endMatch();
          mainMenu();
        } : undefined,
        quit: quitMatch,
      });
    pauseMenu();
  };
  s.onHalftime = () => {
    ads.gameplayStop();
    const secondHalf = (): void => {
      menus.close();
      s.continueSecondHalf();
      ads.gameplayStart();
    };
    // The same set as the pause menu: TACTICS & SUBS, CONTROLS, SETTINGS and QUIT (FORFEIT), each back to this screen.
    const ht = (): void => menus.halftime(s.match, kits, secondHalf, () => tacticsMenu(ht, secondHalf, 'SECOND HALF'), {
      howto: () => menus.howTo(ht, input.lastDevice),
      settings: () => menus.settings(save, applySettings, ht, 'controls'),
      quit: quitMatch,
      quitNote,
      forfeit,
      ratings: s.ratings(),
    });
    // The mascot's HALF TIME SHOW (a home match with a mascot on the touchline): its coins are paid with the match at
    // full time, and said here.
    const show = (): void => {
      ht();
      if (atmo && atmo.show > 0 && !showSaid) {
        showSaid = true;
        menus.toast(`HALF TIME SHOW: +${atmo.show} COINS AT FULL TIME`);
      }
    };
    // Let the dressing-room scene land and keep tactics/SECOND HALF immediately usable. Automatic breaks
    // happen before a later kick-off, after the player has had time with the complete post-match sequence.
    show();
  };
  /** The half time show was announced (the half-time screen is redrawn from its sub-screens). */
  let showSaid = false;
  /** The replay of a lost decider was offered (once per match: economy v3). */
  let replayAsked = false;
  s.onFinish = (r) => {
    checkpointMatch(true);
    ads.gameplayStop();
    // A LOST DECIDER (a cup tie, a final, a title or promotion decider: req.decider): one chance to play it again,
    // BEFORE anything is recorded or paid. Gems (a shown price, one tap) or a rewarded ad once a day; NO THANKS takes
    // the result as it stands. The replay carries no `decider`, so no match is ever replayed twice.
    if (req.decider && !replayAsked && !r.scenarioOutcome) {
      const mine = r.score[hs];
      const theirs = r.score[hs === 0 ? 1 : 0];
      const lost = r.winner !== undefined ? r.winner !== hs : mine < theirs;
      if (lost) {
        replayAsked = true;
        const again = (): void => {
          persist();
          menus.close();
          endMatch();
          void startMatch({ ...req, decider: undefined, skipIntro: true });
        };
        const offer = (): void => menus.replayOffer({
          what: req.decider ?? 'DECIDER', score: scoreHtml(mine, theirs), price: GEM_PRICES.replayMatch, have: gems(save),
          canAd: ads.rewardedAvailable && adsLeft(save, 'replay', localDay()) > 0,
        }, {
          gems: () => {
            if (spendGems(save, GEM_PRICES.replayMatch, 'replayMatch')) again();
            else s.onFinish?.(r);
          },
          ad: async () => {
            const ok = (await ads.rewarded()) && useAd(save, 'replay', localDay());
            if (ok) again();
            return ok;
          },
          no: () => {
            menus.close();
            s.onFinish?.(r);
          },
          // (Back from the store the offer is still there: nothing was decided.)
          getGems: iap.storefront ? () => openShop(app, { tab: 'coins', section: 'gems', backLabel: 'BACK', onBack: () => { closeMeta(); offer(); } }) : undefined,
        });
        offer();
        return;
      }
    }
    if (basics && r.scenarioOutcome) {
      // LEARN THE BASICS: no result screen. A miss restarts the step at once; a goal goes on to the next one,
      // and the last one hands over to the first match. (Its goals don't count for the unlock: noteGoals.)
      const step = req.basicsStep ?? 0;
      const won = r.scenarioOutcome.won;
      let next = step;
      if (won) {
        save.progress.xp += BASICS_XP;
        next = completeBasics(onboarding(), step);
        retention(null, BASICS_XP);
        persist();
      }
      menus.close();
      endMatch();
      if (!won) startBasics(step, true);
      else if (next >= 0) startBasics(next);
      else {
        // The menu's live pitch behind the card (the drill's session is gone).
        if (!demo) startDemo();
        menus.basicsDone({ play: () => firstMatch(), menu: () => mainMenu() });
      }
      return;
    }
    finishedThisVisit++;
    resultShownAt = performance.now();
    if (r.scenarioOutcome && req.scenario) {
      // A Football Moment: not a match (no record, coins, streak or challenges); XP for the try and the stars,
      // the best stars kept by moment id. RETRY runs the same request again, NEXT MOMENT hands back to the list.
      const o = r.scenarioOutcome;
      const p = save.progress;
      const xpFrom = p.xp;
      p.xp += claimMomentXp(save, req.scenario.id, o.stars);
      noteGoals(onboarding(), 'moment', Math.max(0, r.score[hs] - (req.scenario.score?.[hs] ?? 0)));
      retention(null, p.xp - xpFrom);
      persist();
      const leave = (then: () => void) => {
        menus.close();
        endMatch();
        then();
      };
      // The verdict's music (src/audio/sfx.ts result): a win's fanfare, or the "go again" theme.
      sfx.result(o.won ? 'win' : 'loss');
      menus.momentResult(req.scenario, o, { from: xpFrom, to: p.xp, owned: shopOf(save).owned }, {
        retry: () => leave(() => void startMatch({ ...req, skipIntro: true })),
        next: () => leave(() => {
          menuMusic();
          req.onDone(r, 0);
        }),
        nextLabel: req.nextLabel,
        menu: () => leave(() => mainMenu()),
      });
      return;
    }
    const firstEver = played() === 0;
    recordResult(r);
    save.seenTutorial = true;
    // Progression: the win streak boosts the coins (×1.1 a win, up to ×2); XP, stars and today's challenges.
    const my = r.score[hs];
    const their = r.score[hs === 0 ? 1 : 0];
    const won = r.winner === hs;
    const drawn = r.winner === undefined && my === their;
    const p = save.progress;
    p.streak = nextStreak(p.streak, won, drawn);
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    const mult = won ? streakMult(p.streak) : 1;
    const paid = req.reward(r);
    // CLUB ATMOSPHERE at a home match: the matchday income on top of what the match pays (capped: meta/atmosphere.ts).
    const rewardLabel = atmo && atmo.income > 0 && paid.coins > 0 ? `${paid.label}${sep()}+${atmo.income}% ATMOSPHERE` : paid.label;
    // The Coin Doubler (a store purchase) doubles what the match itself pays (not challenges or ads).
    const doubler = coinDoubler(save);
    // SHOWTIME (game/funLayer.ts): an S adds 10% to the match's coins, an A 5%.
    const fun = r.fun;
    const gradeK = fun ? GRADE_BONUS[fun.grade] : 0;
    const payout = matchCoinPayout(paid, { streak: won ? p.streak : 0, atmosphere: atmo?.income ?? 0, gradeBonus: gradeK, doubler });
    const reward = { coins: payout.coins, adBonus: payout.adBonus, label: doubler && payout.matchCoins > 0 ? `${rewardLabel}${sep()}MATCH FEE X2` : rewardLabel };
    const summary: MatchSummary = {
      won, drawn, goals: my, conceded: their,
      assists: (r.ratings ?? []).filter((x) => x.side === hs).reduce((n, x) => n + x.assists, 0),
      tacklesWon: tally.tacklesWon, passes: r.match.stats.passes[hs], skills: tally.skills, headers: tally.headers,
      longGoals: tally.longGoals, powerups: tally.powerups, motm: r.ratings?.[0]?.side === hs, blitz, difficulty: req.difficulty,
      skillGoals: tally.skillGoals,
    };
    const xpFrom = p.xp;
    // (LIVE GOALS done in the match bank their XP too.)
    p.xp += matchXp(summary) + (fun?.xp ?? 0);
    // Gems, in small steady amounts from play (meta/gems.ts GEM_REWARDS): every new level pays a couple.
    const levelsUp = Math.max(0, levelOf(p.xp).level - levelOf(xpFrom).level);
    let gemsEarned = levelsUp > 0 ? rewardGems(save, 'levelUp', levelsUp) : 0;
    const stars = matchStars(summary);
    p.stars += stars;
    const daily = dailyFor(p, localDay());
    const done = advanceDaily(daily, dailyChallenges(daily.day), summary);
    const bonus = done.reduce((n, x) => n + x.challenge.coins, 0);
    // Each daily challenge done also earns a Scout Token (packs cost tokens: earned, never bought).
    if (done.length) earnTokens(save, done.length);
    // All three of today's challenges done: the daily sweep's gems (once a day).
    const sweep = claimSweep(save, daily.day);
    gemsEarned += sweep;
    // THIS WEEK's objectives (meta/loops.ts): the ones this match completed pay coins (never doubled) and gems.
    const weeklyDone = advanceWeekly(save, daily.day, summary, done.length);
    const weeklyCoins = weeklyDone.reduce((n, x) => n + x.objective.coins, 0);
    gemsEarned += weeklyDone.reduce((n, x) => n + x.gems, 0);
    const weeklyLines = weeklyDone.map((x) => ({ text: `WEEKLY: ${x.objective.text} +${x.gems} GEMS`, coins: x.objective.coins }));
    // The mascot's HALF TIME SHOW at a home match (meta/atmosphere.ts): a few coins, never doubled.
    const showCoins = atmo?.show ?? 0;
    const showLine = showCoins ? [{ text: 'MASCOT HALF TIME SHOW', coins: showCoins }] : [];
    const sweepLine = sweep ? [{ text: `ALL 3 DAILY CHALLENGES +${sweep} GEMS`, coins: 0 }] : [];
    const levelLine = levelsUp ? [{ text: `LEVEL UP +${levelsUp * GEM_REWARDS.levelUp} GEMS`, coins: 0 }] : [];
    // SKILL GOALs pay a little on top (shown with the challenges done on the full-time screen).
    const skillCoins = skillGoalCoins(tally.skillGoals);
    const rewardedSkillGoals = Math.min(MAX_REWARDED_SKILL_GOALS, tally.skillGoals);
    const skillLine = rewardedSkillGoals ? [{ text: rewardedSkillGoals > 1 ? `${rewardedSkillGoals} SKILL GOALS` : 'SKILL GOAL', coins: skillCoins }] : [];
    // LIVE GOALS: their coins, like the challenges' (never doubled).
    const liveCoins = fun?.coins ?? 0;
    const liveLine = fun && fun.done ? [{ text: fun.done > 1 ? `${fun.done} LIVE GOALS` : 'LIVE GOAL', coins: liveCoins }] : [];
    const show = fun && fun.style > 0 ? recordShowtime(save, showtimeMode(req.kind, blitz), fun.grade, fun.style) : null;
    let earned = reward.coins + bonus + skillCoins + liveCoins + weeklyCoins + showCoins;
    void gemsEarned;
    const coinsBefore = save.coins;
    save.coins += earned;
    // The SHOP item this match's coins brought into reach, if any (one line at full time; nothing otherwise).
    const reach = inReach(save, coinsBefore, save.coins);
    // The first real goal opens CAREER, MOMENTS, CLUB RUN and BLITZ (the menu says so next).
    noteGoals(onboarding(), req.kind, my);
    // The hidden ease's streaks, and the one visible hint: three quick-match defeats in a row above Easy.
    const outcome: Outcome = won ? 'win' : drawn ? 'draw' : 'loss';
    const kind: MatchKind | undefined = req.kind;
    let tryEasy: (() => void) | undefined;
    /** TRY EASY was pressed: Quick Match is on Easy from now, and a REMATCH from this screen is too. */
    let easyNow = false;
    if (save.dda) {
      ddaRecord(save.dda, kind, req.difficulty, outcome);
      if (suggestEasy(save.dda, kind, req.difficulty, outcome)) {
        tryEasy = () => {
          save.settings.difficulty = 0;
          easyNow = true;
          persist();
        };
      }
    }
    // Mastery badges and the season track (the RETENTION modules): tier-ups become a line at full time.
    // (Goals our own players scored, from the ratings: a HEAD START perk's goal or a golden double isn't a finish.)
    const scored = (r.ratings ?? []).filter((x) => x.side === hs).reduce((n, x) => n + x.goals, 0);
    const tierUps = retention({
      goals: scored, assists: summary.assists, passes: summary.passes, tackles: tally.tacklesWon, cleanSheet: their === 0,
      skills: tally.skills, saves: r.match.stats.saves?.[hs] ?? 0,
    }, p.xp - xpFrom);
    req.onBanked?.(r, earned);
    persist();
    // Full time: the result goes to the cloud now (offline it waits on the device and goes up when the connection is back).
    syncSoon();
    let doubled = false;
    let doubling = false;
    const sameRewardSave = rewardSaveGuard();
    // A happy moment: after a win, Apple's own rating prompt (the app only, rarely: platform/review.ts).
    if (won) window.setTimeout(() => void maybeAskForReview(save), 2500);
    // The full-time music with the screen (src/audio/sfx.ts result): a cup tie's brass is bigger, and a final's
    // (a knockout at a full neutral ground) opens with the trophy fanfare.
    sfx.result(outcome, req.knockout ? (req.attendance >= 1 ? 2 : 1) : 0);
    menus.fulltime(r.match, kits, humanSide, reward, ads.rewardedAvailable && payout.adBonus > 0, {
      nextLabel: req.nextLabel,
      double: async () => {
        if (doubled || doubling || !sameRewardSave()) return false;
        doubling = true;
        try {
          const ok = await ads.rewarded();
          if (!ok || !sameRewardSave()) return false;
          doubled = true;
          save.coins += payout.adBonus;
          earned += payout.adBonus;
          req.onBanked?.(r, earned);
          persist();
          return true;
        } finally { doubling = false; }
      },
      next: () => {
        menus.close();
        endMatch();
        menuMusic();
        req.onDone(r, earned);
      },
      // One more: the same fixture and settings, straight to the kick-off (the coins above are already banked).
      rematch: req.rematch ? () => {
        menus.close();
        endMatch();
        const easy = easyNow ? { difficulty: 0, reward: (x: MatchResult) => standardReward(x, 0) } : {};
        void startMatch({ ...req, ...easy, firstMatch: false, skipIntro: true });
      } : undefined,
    }, r.ratings, {
      stars, xpFrom, xpTo: p.xp, streak: p.streak, mult,
      done: [...done.map((x) => ({ text: `${x.challenge.text} +1 SCOUT TICKET`, coins: x.challenge.coins })), ...sweepLine, ...weeklyLines, ...skillLine, ...liveLine, ...showLine, ...levelLine],
      owned: shopOf(save).owned,
    }, { tierUps, tryEasy, clip: clipOf(s), noAds: firstEver, shopReach: reach ? { name: reach.name, kind: CAT_LABEL[reach.cat] } : undefined,
      showtime: fun && show ? { grade: fun.grade, score: fun.style, best: show.before?.grade ?? null, newBest: show.newBest, bonus: gradeK } : undefined });
  };
  window.addEventListener('keydown', pauseKey);
  ongoing = { session: s, request: req, tally, recordPlayed: recovered?.recordPlayed ?? save.record.played, progressXp: recovered?.progressXp ?? save.progress.xp,
    context: recovered?.context ?? recoveryContext(app, recoveryRoute(req)) };
  checkpointMatch(true);
  if (recovered) {
    if (s.match.phase === 'halftime') s.onHalftime?.();
    else if (s.match.phase !== 'fulltime') s.requestPause();
  }
}

/** Rebuild the pending competition's callbacks without opening a hub that could mark its match abandoned. */
function tryResumeMatch(): boolean {
  const pending = matchRecovery.read(save.record.played, save.progress.xp);
  if (!pending) return false;
  const req = rebuildRecoveryRequest(app, pending, standardReward);
  if (!req) {
    matchRecovery.clear();
    return false;
  }
  // Saved setup wins over later preferences, while the fresh callbacks settle the original pending fixture.
  void startMatch(req, pending).catch(() => {
    endMatch();
    mainMenu();
    menus.toast('THE UNFINISHED MATCH COULD NOT BE RESTORED');
  });
  return true;
}

function pauseKey(e: KeyboardEvent): void {
  if (e.repeat || (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))) return;
  if (isKey('pause', e.code) && session && !session.paused && !menus.open) session.requestPause();
}

function endMatch(): void {
  clearMatchRecovery();
  window.removeEventListener('keydown', pauseKey);
  session?.dispose();
  session = null;
  basicsNow = false;
  Trainer.lesson = null;
}

/**
 * Back from a match to the menus (the career's road, the moments' list, the main menu): the menu loop comes back,
 * crossfading out of the result screen's music (the career and its screens never start it themselves).
 */
function menuMusic(): void {
  if (save.settings.music) sfx.startMusic();
}

// Tabbed away, or the portal's frame lost focus (a click outside the game): the match pauses itself.
const autoPause = (): void => {
  // A full-screen half-time ad can blur the webview before its menu is mounted. The match is already at a
  // break: do not replace it with a hidden pause that survives the SECOND HALF action.
  if (session && !session.paused && !menus.open && session.match.phase !== 'halftime' && session.match.phase !== 'fulltime') session.requestPause();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { checkpointMatch(true); autoPause(); }
});
window.addEventListener('blur', () => { checkpointMatch(true); autoPause(); });
window.addEventListener('pagehide', () => checkpointMatch(true));
window.addEventListener('resize', () => {
  world.resize();
  canvasRect = canvas.getBoundingClientRect();
});

/** LEARN THE BASICS: once the other side has kept the ball this long (s), the drill restarts at once. */
const BASICS_LOST_S = 2.5;
/**
 * A drill has only the players it needs (no one to take a throw-in, nobody to find from a goal kick), so the
 * ball going dead or the keeper holding it ends the attempt: AGAIN!, and the step starts over. A beat first,
 * so the whistle or the catch reads.
 */
const BASICS_DEAD_S = 0.9;
let basicsLostT = 0;
let basicsDeadT = 0;

/** No chasing an AI player round the pitch for half a minute in a lesson: lose it, and the step starts again. */
function basicsWatch(dt: number): void {
  const s = session;
  if (!basicsNow || !s || s.paused || s.teachingHeld) {
    basicsLostT = basicsDeadT = 0;
    return;
  }
  const m = s.match;
  const own = m.ball.owner;
  const theirs = m.phase === 'play' && own >= 0 && m.players[own].side !== m.cfg.humanSide && !m.players[own].isKeeper;
  const caught = m.phase === 'play' && own >= 0 && m.players[own].side !== m.cfg.humanSide && m.players[own].isKeeper && m.ball.held;
  const dead = m.phase === 'out' || m.phase === 'restart';
  basicsLostT = theirs ? basicsLostT + dt : 0;
  basicsDeadT = dead || caught ? basicsDeadT + dt : 0;
  if (basicsLostT > BASICS_LOST_S || basicsDeadT > BASICS_DEAD_S) {
    basicsLostT = basicsDeadT = 0;
    // The session sees the whistle and ends the drill unsettled: AGAIN!, then main.ts restarts the step.
    finishScenario(m);
  }
}

/**
 * The iPhone / iPad app's perf line, every PERF_S s of a match (read off the phone through the device console):
 * frame rate, slow frames, the pixel ratio drawn at, the graphics setting and the viewport, then the display's
 * own pace (Hz), our main-thread ms a frame (mean / worst) and the longest frame. (`import.meta.env.VITE_PORTAL`
 * is a literal in every build: the portal builds drop all of it.)
 */
const PERF_BUILD = !import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none';
const PERF_S = 10;
const perf = { t: 0, frames: 0, slow: 0, work: 0, workMax: 0, worst: 0 };
function perfLog(dt: number, work: number): void {
  const g = world.governor;
  if (!session || session.paused) {
    perf.t = perf.frames = perf.work = perf.workMax = perf.worst = 0;
    perf.slow = g.slowFrames;
    return;
  }
  // (Longer is the app coming back from the background, not a frame.)
  if (dt > 0.25) return;
  perf.t += dt;
  perf.frames++;
  perf.work += work;
  perf.workMax = Math.max(perf.workMax, work);
  perf.worst = Math.max(perf.worst, dt);
  if (perf.t < PERF_S) return;
  const ms = (s: number) => (s * 1000).toFixed(1);
  console.log(`[perf] fps ${(perf.frames / perf.t).toFixed(1)} slow ${g.slowFrames - perf.slow} ratio ${world.pixelRatio.toFixed(2)} q ${world.quality} ${window.innerWidth}x${window.innerHeight}`
    + ` hz ${g.pace > 0 ? Math.round(1 / g.pace) : 0} work ${ms(perf.work / perf.frames)}/${ms(perf.workMax)}ms worst ${ms(perf.worst)}ms dpr ${window.devicePixelRatio}`);
  perf.t = perf.frames = perf.work = perf.workMax = perf.worst = 0;
  perf.slow = g.slowFrames;
}

let last = performance.now();
/** The match (or menu demo) whose shaders are all compiled (World.warmShaders). */
let warmed: MatchSession | null = null;
function frame(now: number): void {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.1, raw);
  last = now;
  // (Our own work this frame, for the dynamic resolution: a CPU-bound hitch is no reason to drop pixels.)
  const t0 = performance.now();
  canvasRect = canvas.getBoundingClientRect();
  const shown = session ?? demo;
  shown?.update(dt);
  basicsWatch(dt);
  syncControlsUi(session);
  recoveryT += dt;
  checkpointMatch();
  // A new match: every shader up front, not one hitch per first goal, effect or marker mid-play.
  if (shown && shown !== warmed) {
    warmed = shown;
    world.warmShaders();
  }
  world.render();
  const work = (performance.now() - t0) / 1000;
  // A resolution change (a canvas reallocation: a hitch) waits for a dead ball, a pause or the menus, never
  // mid-move. (The real frame time: a stall over the 0.1 s cap is a hidden app, not a slow GPU.)
  const phase = session?.match.phase;
  world.adapt(raw, work, !session || session.paused || (phase !== 'play' && phase !== 'shootout'));
  if (PERF_BUILD && inNativeApp()) perfLog(raw, work);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  world.setQuality(save.settings.quality);
  // Bindings before anything reads a key (the title's SPACE / ENTER is fixed; the match keys are the player's).
  setBindings(save.settings.keys, save.settings.pad);
  applyTextSize(save.settings.textSize);
  TouchControls.stickMode = save.settings.stick === 'fixed' ? 'fixed' : 'floating';
  TouchControls.autoSprint = controlsOf(save.settings).autoSprint;
  setHapticsLevel(controlsOf(save.settings).vibration);
  // (Haptics: a tick on the primary buttons, platform/haptics.ts; none while an ad is up, below.)
  installUiHaptics(document);
  menus.stick = TouchControls.stickMode;
  ads.onMute = (m) => {
    sfx.setMuted(m);
    setHapticsQuiet(m);
  };
  // The store (the apps' native one, or the dev fake): loads in the background, the shop looks when it opens.
  void iap.init();
  // Every screen's text goes through the divider guard (see ui/text.ts): no glyph the fonts lack.
  // (The whole page: menus, the HUD, the trainer card and anything else that writes text.)
  installSepGuard(document.body);
  // Never let a slow or blocked portal SDK hold the title screen hostage; the studio splash gets its moment.
  // Both UI fonts are asked for now (the pixel face used to arrive only once the title drew with it, a swap
  // after the splash had gone).
  const ready = Promise.all([
    Promise.race([ads.init(), new Promise<void>((r) => setTimeout(r, 3000))]),
    // Fonts must not strand the player on the loader when a font request hangs.
    Promise.race([
      Promise.all([
        document.fonts?.load("16px 'Silkscreen'").catch(() => []),
        document.fonts?.load("16px 'Lilita One'").catch(() => []),
      ]),
      new Promise<void>((r) => setTimeout(r, 3000)),
    ]),
    new Promise<void>((r) => setTimeout(r, PORTAL ? 0 : Math.max(0, SPLASH_MS - (performance.now() - bootAt)))),
  ]);
  // The menu's live pitch is built, and drawn once (compiling its shaders), UNDER the splash while it plays:
  // the splash only moves on the compositor, so this work doesn't stall it, and the title then comes in on a
  // ready scene instead of the build (and a frozen first frame) coming after the splash. One frame first, so
  // the splash is on screen and animating before the main thread gets busy. (Or a moment, in a background tab
  // or a portal's hidden preload: no frames come there, and the boot must not wait for one.)
  await new Promise<void>((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 60);
  });
  const status = document.getElementById('boot-status');
  if (status) status.textContent = 'GETTING THE PITCH READY';
  const t0 = performance.now();
  startDemo();
  const t1 = performance.now();
  world.render();
  const t2 = performance.now();
  performance.measure('bl:demo', { start: t0, end: t1 });
  performance.measure('bl:firstRender', { start: t1, end: t2 });
  await ready;
  // CrazyGames: the save also lives in its Data Module (the player's account). A newer copy there wins (he played
  // on another device), swapped in before any menu reads it, and its settings applied.
  const store = ads.portalStore();
  const theirs = store ? adoptPortalStore(store, save) : null;
  if (theirs) {
    for (const k of Object.keys(save)) delete (save as unknown as Record<string, unknown>)[k];
    Object.assign(save, theirs);
    applySettings();
  }
  performance.mark('bl:ready');
  requestAnimationFrame(frame);
  document.getElementById('boot')?.setAttribute('aria-busy', 'false');
  document.getElementById('boot')?.classList.add('gone');
  // The browser chrome was grey for the splash; the game itself sits under a sky.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#5cc8f5');
  ads.loadingDone();
  // Game Center (the iPhone / iPad app only): sign in, then report anything earned or beaten since last time.
  void gameCenterSignInOnce().then((ok) => {
    if (ok) void syncGameCenter(save);
  });
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('quick')) {
    if (tryResumeMatch()) return;
    const home = makeTeam(PRESET_CLUBS[save.clubIdx]);
    const away = makeTeam(PRESET_CLUBS[save.opponentIdx]);
    startMatch({
      home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)], humanSide: 0,
      difficulty: save.settings.difficulty, halfMinutes: save.settings.halfMinutes, attendance: 0.9,
      // (Dev: ?quick=1&level=2&tod=night looks at a smaller ground or another time of day; &club=1 plays MY CLUB.)
      stadiumLevel: params.has('level') ? Number(params.get('level')) : 5,
      ...(['day', 'sunset', 'night'].includes(params.get('tod') ?? '') ? { timeOfDay: params.get('tod') as 'day' | 'sunset' | 'night', weather: 'clear' as const } : {}),
      mode: params.has('blitz') ? 'blitz' : 'classic',
      reward: (r) => standardReward(r, save.settings.difficulty), onDone: () => mainMenu(),
    });
    return;
  }
  menus.title(() => {
    sfx.unlock();
    applySettings();
    if (tryResumeMatch()) return;
    // Portal builds, first visit: TAP TO PLAY is the one click to gameplay (the first basics drill).
    if (straightToBasics(onboarding(), played(), PORTAL)) startBasics(0);
    else mainMenu();
  });
  // Cloud saves (a no-op until a backend is configured): pull the newer copy, then keep pushing changes. Then the
  // silent sign-in (platform/signin.ts: Game Center in the app, else this device's own account), kept up from here on.
  // (The literal check keeps the sign-in code out of the portal builds altogether.)
  void cloudBoot({ save, persist, reload }).then(() => {
    if ((!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && accountsRequired()) {
      void import('./platform/signin').then((m) => m.watchConnection({ save, persist, reload }), () => {});
    }
  });
}

if (import.meta.env.DEV) {
  (window as unknown as { __bl: unknown }).__bl = {
    get session() {
      return session;
    },
    get demo() {
      return demo;
    },
    world,
    input,
    save,
    app,
    /** Advance the game by n frames even when the pane is hidden (rAF paused). */
    step(n: number, dt = 1 / 60) {
      for (let i = 0; i < n; i++) {
        (session ?? demo)?.update(dt);
        basicsWatch(dt);
      }
      syncControlsUi(session);
      world.render();
    },
    /** HYPE: fill a side's meter now (default the human's): his next open-play shot is a SUPER SHOT (classic matches). */
    superShot(side?: 0 | 1) {
      return session?.fun?.devSuperShot(side) ?? false;
    },
    /** LIVE GOALS: put one up now ('score', 'passShot', 'skill', 'winBack', 'onTarget', 'oneTouch', 'hold', 'superGoal'). */
    objective(kind?: BountyKind) {
      return session?.fun?.devObjective(kind) ?? false;
    },
    key(code: string, down: boolean) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
    /**
     * Set pieces: give yourself one now (in open play): 'freekick' (in range: the reticle on the goal), 'wide' (a wide
     * free kick: the landing ring), 'corner', 'penalty', or 'shootout' (straight to penalties).
     */
    stage(kind: 'freekick' | 'wide' | 'corner' | 'penalty' | 'shootout' = 'freekick') {
      return session?.devStage(kind) ?? false;
    },
    /** The AI coach: put the score at (yours, theirs) now; it changes its plan at the next dead ball and says so on the ticker. */
    score(mine: number, theirs: number) {
      return session?.devScore(mine, theirs) ?? false;
    },
  };
  // The sound's dev panel: window.__blaudio (src/audio/dev.ts: cues, half / full time jumps, mix measurements).
  void import('./audio/dev').then((d) => d.installAudioDev());
}

export const ready = boot();
