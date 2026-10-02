import '@fontsource/lilita-one/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './style.css';
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
  type SaveData, momentStarsTotal, momentXp, recordMoment } from './core/save';
import { SKILL_GOAL_COINS, adoptPortalStore } from './core/save';
import { MatchSession, type MatchResult, type SessionOptions } from './game/matchSession';
import { PRESET_CLUBS, dedupeSurnames, makeTeam, resolveKitClash } from './meta/data';
import { CAT_LABEL, DEFAULT_ID, equippedId, inReach, newInShop, shopOf, type ShopCat, type ShopItem } from './meta/shop';
import { ads } from './platform/ads';
import { adFree, iap } from './platform/iap';
import { PITCH_Y } from './render/stadium';
import { World, type TimeOfDay } from './render/world';
import { BOX_DEPTH, BOX_W, HALF_L } from './sim/constants';
import { finishScenario } from './sim/scenario';
import type { Match } from './sim/match';
import type { FormationId, KickKind, MatchEvent, MatchMode, Side } from './sim/types';
import { DIFFICULTIES, DIFF_LEVEL, Menus, type MainInfo } from './ui/menus';
import { DIVISION_NAMES, clubRating, clubTeam, migrateCareer, nextMatch, type ClubState } from './meta/career';
import { ROUND_NAMES, clubRating as presetRating, migrateCup } from './meta/cup';
import { overall } from './sim/types';
import { openCareer } from './ui/career';
import { openCup } from './ui/cup';
import { careerState, closeMeta, openClub } from './ui/club';
import { openShop, shopOpen } from './ui/shop';
import type { Projector } from './ui/hud';
import { openMoments } from './ui/moments';
import type { OnlineHost } from './ui/online';
import { SEP_MARK, installSepGuard } from './ui/text';
import { Lesson, Trainer } from './ui/trainer';
import { TouchControls } from './ui/touch';
import { saveClip, shareClip } from './ui/clips';
import { openRun } from './ui/run';
import { openBadges } from './ui/badges';
import { BASICS } from './meta/moments';
import { badgePending, nextBadgeGoal, recordMatchMeta, wornTitle, type MasteryMatch } from './meta/mastery';
import { runTileText } from './meta/run';
import type { ClipSource } from './ui/menus';
import { cloudAvailable, cloudBoot, cloudUser, openAccount } from './platform/cloud';

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
/** A portal build (CrazyGames / Poki; in dev, ?portal=): a first visit goes straight from TAP TO PLAY to the first drill. */
const PORTAL = import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki'
  || (import.meta.env.DEV && new URLSearchParams(location.search).has('portal'));
let session: MatchSession | null = null;
let demo: MatchSession | null = null;
/** The main menu (or a screen off it) is up, as opposed to the title screen or a match. */
let atMenu = false;

function persist(): void {
  writeSave(save);
}

// Store purchases (platform/iap.ts) pay out into the one save and store it before the store is told it arrived.
// NO ADS switches the interstitials off (rewarded ads stay: they are the player's choice). Both read the live save.
ads.adFree = () => adFree(save);
iap.bind({ save, persist });
iap.onGrant((g) => {
  // A purchase that completes while the shop is shut (a family approval, one the store re-delivers at launch) still says so.
  if (!shopOpen() && !g.restored) menus.toast(`PURCHASE ARRIVED${g.coins ? `: +${g.coins.toLocaleString('en-US')} COINS` : ''}`);
});

/**
 * Replace the running save with another (a file the player imported, or the cloud copy): every module holds
 * the one `save` object, so its contents are swapped in place. Then it is stored, the settings applied, and
 * the menu redrawn if one is up (a match in progress carries on and sees the new save at full time).
 */
function reload(d: SaveData): void {
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
  document.body.classList.toggle('cb', !!s.colorblind);
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

/** Today's gift if not yet claimed: 100 coins on day 1, +50 per consecutive day up to day 7. */
function giftToday(): { amount: number; streak: number } | null {
  const g = save.gift;
  const today = localDay();
  if (g?.last === today) return null;
  const streak = g && g.last === localDay(-1) ? (g.streak % 7) + 1 : 1;
  return { amount: 100 + 50 * (streak - 1), streak };
}

function mainInfo(): MainInfo {
  const info: MainInfo = {};
  const q = PRESET_CLUBS[save.clubIdx];
  const o = PRESET_CLUBS[save.opponentIdx];
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
  info.locked = LOCKED_FEATURES.filter((f) => !featureOpen(onboarding(), f));
  const run = save.run;
  try {
    info.run = runTileText(save);
  } catch {
    info.run = run?.best ? `BEST: ROUND ${run.best}` : 'ONE MORE RUN';
  }
  if (q && o) info.quick = `PICK TEAMS ${SEP_MARK} RULES`;
  const moStars = momentStarsTotal(save);
  info.moments = moStars ? `SHORT CHALLENGES ${SEP_MARK} ★ ${moStars}` : 'SHORT CHALLENGES';
  const user = cloudUser();
  if (user) info.account = user.name;
  try {
    const career = save.career ? migrateCareer(save.career, 1) : null;
    const club = career?.club ?? null;
    if (club && career) {
      const nm = nextMatch(career);
      const div = career.season ? DIVISION_NAMES[career.season.division] ?? '' : '';
      // Opponent first: on small tiles the subtitle is cut with an ellipsis, and the next match matters most.
      info.career = nm ? `v ${nm.rival.short} ${SEP_MARK} ${div}` : div || 'SEASON DONE';
      info.club = `OVR ${clubRating(club)}`;
      const star = [...club.squad.slice(0, 11)].sort((a, b) => overall(b) - overall(a))[0];
      if (star) info.captain = { def: star, kit: club.kit, club: club.name.toUpperCase(), ovr: clubRating(club) };
    } else {
      info.career = 'START AT THE BOTTOM';
      info.club = `KIT ${SEP_MARK} SQUAD`;
    }
    const cup = migrateCup(save.cup);
    info.cup = cup && cup.status === 'active' ? `NEXT: ${ROUND_NAMES[Math.min(cup.round, 2)]}` : 'WIN THE TROPHY';
  } catch {
    // A damaged career blob must never break the menu.
  }
  if (!info.captain && q) {
    const team = makeTeam(q);
    info.captain = { def: team.players[9], kit: q.kit, club: q.name.toUpperCase(), ovr: presetRating(save.clubIdx) };
  }
  const gift = giftToday();
  if (gift) info.gift = gift;
  // Progression: the level badge and today's challenges (rolled over to a new day here, and saved if so).
  const p = save.progress;
  const lv = levelOf(p.xp);
  info.level = { level: lv.level, title: wornTitle(save) ?? levelTitle(lv.level), into: lv.into, need: lv.need };
  try {
    // The nearest badge tier (always a near goal on the level badge) and anything waiting to be claimed.
    info.badgeGoal = save.mastery ? nextBadgeGoal(save.mastery)?.text : undefined;
    info.badgesPending = badgePending(save);
  } catch {
    // (Retention bookkeeping never breaks the menu.)
  }
  info.unlock = nextUnlock(save.progress.xp, shopOf(save).owned);
  try {
    // The count on the coins / SHOP button: affordable things not seen yet, and the free daily pack.
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

/** The save's campaign state (always whole once loaded: core/save.ts). */
function onboarding(): NonNullable<typeof save.onboarding> {
  save.onboarding ??= { basics: played() > 0 ? BASICS_STEPS : 0, firstGoal: played() > 0, unlockSeen: played() > 0 };
  return save.onboarding;
}

/** What the daily gift just brought into the SHOP's reach (said once, back on the menu). */
let giftReach: ShopItem | null = null;

const FEATURE_NAMES: Record<LockedFeature, string> = { career: 'ROAD TO GLORY', moments: 'MOMENTS', run: 'CLUB RUN', blitz: 'BLITZ' };

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
  const info = mainInfo();
  const backup = (): void => menus.backup(save, { onImport: reload, back: () => settings() });
  const settings = (): void => menus.settings(save, applySettings, mainMenu, 'general', { backup });
  menus.main(save, {
    playNow: () => playNow(),
    account: cloudAvailable() ? () => openAccount({ save, persist, reload }, mainMenu) : undefined,
    gift: () => {
      const g = giftToday();
      if (!g) return mainMenu();
      menus.gift(g.amount, g.streak, ads.rewardedAvailable, {
        claim: async (double) => {
          let amount = g.amount;
          if (double && (await ads.rewarded())) amount *= 2;
          const before = save.coins;
          save.coins += amount;
          save.gift = { last: localDay(), streak: g.streak };
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
      });
    },
    quick: () => quickMatch(),
    blitz: () => quickMatch('blitz'),
    moments: () => openMoments(app, mainMenu),
    // (The condition written out here, not through a variable: the bundler drops the whole branch, the import
    // with it, only when it can see the literal: see ONLINE below.)
    online: !import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none'
      ? () => void import('./ui/online').then((o) => o.openOnline(onlineHost))
      : undefined,
    run: () => openRun(app, mainMenu),
    locked: (f) => menus.toast(`SCORE YOUR FIRST GOAL TO UNLOCK ${FEATURE_NAMES[f]}`),
    unlocks: () => {
      const ladder = (): void => menus.unlocks(save, mainMenu, () => openBadges(app, ladder));
      ladder();
    },
    career: () => openCareer(app),
    cup: () => openCup(app),
    club: () => openClub(app),
    shop: () => openShop(app),
    settings,
    howto: () => menus.howTo(mainMenu, input.lastDevice),
  }, info);
}

/*
 * ONLINE ships in the web builds only: the own site and itch (VITE_PORTAL 'none'), and dev (unset). The portal builds
 * (CrazyGames, Poki) leave it out altogether: no tile, and none of its code in the bundle (the main menu's lazy
 * import is dead there once VITE_PORTAL is a literal), so a portal submission makes no WebRTC or STUN request.
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
  const mult = [0.8, 1, 1.35, 1.7][difficulty] ?? 1;
  const base = my > their ? 150 : my === their ? 70 : 30;
  return { coins: Math.round((base + my * 20) * mult), label: my > their ? 'WIN BONUS' : 'MATCH FEE' };
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

function pickWeather(): 'clear' | 'rain' | 'snow' {
  const w = save.settings.weather;
  if (w !== 'random') return w;
  const r = Math.random();
  return r < 0.72 ? 'clear' : r < 0.9 ? 'rain' : 'snow';
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

async function startMatch(req: MatchRequest): Promise<void> {
  atMenu = false;
  menus.close();
  sfx.stopMusic();
  const basics = req.kind === 'basics';
  // Portal interstitial only at a natural break before a new kick-off: never the first thing this visit, never
  // in or right after the basics, never before the first real match.
  if (finishedThisVisit > 0 && !basics && !req.firstMatch && played() > 0) await ads.midgame();
  demo?.dispose();
  demo = null;
  const { kits, humanSide } = req;
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
    attendance: req.attendance,
    seed: Math.floor(Math.random() * 1e9),
    timeOfDay: req.timeOfDay ?? (early || basics ? 'day' : pickTime()),
    weather: req.weather ?? (early || basics ? 'clear' : pickWeather()),
    knockout: req.knockout,
    // Career and the cup stay classic; Quick Match passes the mode the player picked.
    mode: req.mode ?? 'classic',
    firstMatch: !!req.firstMatch && played() === 0,
    scenario: req.scenario,
    skipIntro: req.skipIntro,
    stadiumLevel: Math.max(0, Math.min(5, Math.round(req.stadiumLevel ?? 5))),
    tutorial: !save.seenTutorial && !basics,
    camZoom: camZoom(),
    ballSkin: equippedSkin(),
    celebration: equippedCelebration(),
    goalFx: equipped('goalfx'),
    trail: equipped('trail'),
    colorblind: !!save.settings.colorblind,
    quickSubs: save.settings.quickSubs !== false,
    assist,
    startScore: req.startScore,
    keeperBoost: req.keeperBoost,
    goldenFirst: req.goldenFirst,
    startPower: req.startPower,
    sideDifficulty: req.sideDifficulty,
  });
  applyControls(session.match, basics ? CONTROL_DEFAULTS : controlsOf(save.settings));
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
  const hs: Side = humanSide === 1 ? 1 : 0;
  const lesson = Trainer.lesson;
  if (session.hud) {
    session.hud.onEvent = (e, m) => {
      track(tally, e, m, hs);
      lesson?.event(e, m);
    };
  }
  const s = session;
  ads.gameplayStart();
  const tacticsMenu = (back: () => void) =>
    menus.tactics(s.match, humanSide, kits, {
      setMentality: (v) => s.setMentality(humanSide, v),
      substitute: (slot, benchIdx) => s.substitute(humanSide, slot, benchIdx),
      // Match.setFormation is new in the sim; the optional call keeps older builds working (picker is a no-op).
      setFormation: (id) => (s.match as Match & { setFormation?: (side: Side, f: FormationId) => unknown }).setFormation?.(humanSide, id),
      back,
    });
  s.onPause = () => {
    ads.gameplayStop();
    const pauseMenu = (): void =>
      menus.pause({
        quitNote: req.quitNote ?? "This match won't count and you won't earn any coins.",
        quitLabel: basics ? 'BACK TO MENU' : undefined,
        tactics: basics ? undefined : () => tacticsMenu(pauseMenu),
        resume: () => {
          menus.close();
          s.resume();
          ads.gameplayStart();
        },
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
        quit: () => {
          menus.close();
          endMatch();
          (req.onQuit ?? mainMenu)();
        },
      });
    pauseMenu();
  };
  s.onHalftime = () => {
    ads.gameplayStop();
    const ht = (): void =>
      menus.halftime(s.match, kits, () => {
        menus.close();
        s.continueSecondHalf();
        ads.gameplayStart();
      }, () => tacticsMenu(ht));
    ht();
  };
  s.onFinish = (r) => {
    ads.gameplayStop();
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
    if (r.scenarioOutcome && req.scenario) {
      // A Football Moment: not a match (no record, coins, streak or challenges); XP for the try and the stars,
      // the best stars kept by moment id. RETRY runs the same request again, NEXT MOMENT hands back to the list.
      const o = r.scenarioOutcome;
      const p = save.progress;
      const xpFrom = p.xp;
      p.xp += momentXp(o.stars);
      recordMoment(save, req.scenario.id, o.stars);
      noteGoals(onboarding(), 'moment', Math.max(0, r.score[hs] - (req.scenario.score?.[hs] ?? 0)));
      retention(null, p.xp - xpFrom);
      persist();
      const leave = (then: () => void) => {
        menus.close();
        endMatch();
        then();
      };
      menus.momentResult(req.scenario, o, { from: xpFrom, to: p.xp, owned: shopOf(save).owned }, {
        retry: () => leave(() => void startMatch({ ...req, skipIntro: true })),
        next: () => leave(() => req.onDone(r, 0)),
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
    const base = req.reward(r);
    const reward = { coins: Math.round(base.coins * mult), label: base.label };
    const summary: MatchSummary = {
      won, drawn, goals: my, conceded: their,
      assists: (r.ratings ?? []).filter((x) => x.side === hs).reduce((n, x) => n + x.assists, 0),
      tacklesWon: tally.tacklesWon, passes: r.match.stats.passes[hs], skills: tally.skills, headers: tally.headers,
      longGoals: tally.longGoals, powerups: tally.powerups, motm: r.ratings?.[0]?.side === hs, blitz, difficulty: req.difficulty,
      skillGoals: tally.skillGoals,
    };
    const xpFrom = p.xp;
    p.xp += matchXp(summary);
    const stars = matchStars(summary);
    p.stars += stars;
    const daily = dailyFor(p, localDay());
    const done = advanceDaily(daily, dailyChallenges(daily.day), summary);
    const bonus = done.reduce((n, x) => n + x.challenge.coins, 0);
    // SKILL GOALs pay a little on top (shown with the challenges done on the full-time screen).
    const skillCoins = tally.skillGoals * SKILL_GOAL_COINS;
    const skillLine = tally.skillGoals ? [{ text: tally.skillGoals > 1 ? `${tally.skillGoals} SKILL GOALS` : 'SKILL GOAL', coins: skillCoins }] : [];
    let earned = reward.coins + bonus + skillCoins;
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
    persist();
    let doubled = false;
    menus.fulltime(r.match, kits, humanSide, reward, ads.rewardedAvailable && reward.coins > 0, {
      nextLabel: req.nextLabel,
      double: async () => {
        if (doubled) return false;
        const ok = await ads.rewarded();
        if (ok) {
          doubled = true;
          save.coins += reward.coins;
          earned += reward.coins;
          persist();
        }
        return ok;
      },
      next: () => {
        menus.close();
        endMatch();
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
      stars, xpFrom, xpTo: p.xp, streak: p.streak, mult, done: [...done.map((x) => ({ text: x.challenge.text, coins: x.challenge.coins })), ...skillLine],
      owned: shopOf(save).owned,
    }, { tierUps, tryEasy, clip: clipOf(s), noAds: firstEver, shopReach: reach ? { name: reach.name, kind: CAT_LABEL[reach.cat] } : undefined });
  };
  window.addEventListener('keydown', pauseKey);
}

function pauseKey(e: KeyboardEvent): void {
  if (e.repeat || (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))) return;
  if (isKey('pause', e.code) && session && !session.paused && !menus.open) session.requestPause();
}

function endMatch(): void {
  window.removeEventListener('keydown', pauseKey);
  session?.dispose();
  session = null;
  basicsNow = false;
  Trainer.lesson = null;
}

// Tabbed away, or the portal's frame lost focus (a click outside the game): the match pauses itself.
const autoPause = (): void => {
  if (session && !session.paused && !menus.open) session.requestPause();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autoPause();
});
window.addEventListener('blur', autoPause);
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

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // (Our own work this frame, for the dynamic resolution: a CPU-bound hitch is no reason to drop pixels.)
  const t0 = performance.now();
  canvasRect = canvas.getBoundingClientRect();
  (session ?? demo)?.update(dt);
  basicsWatch(dt);
  syncControlsUi(session);
  world.render();
  world.adapt(dt, (performance.now() - t0) / 1000);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  world.setQuality(save.settings.quality);
  // Bindings before anything reads a key (the title's SPACE / ENTER is fixed; the match keys are the player's).
  setBindings(save.settings.keys, save.settings.pad);
  TouchControls.stickMode = save.settings.stick === 'fixed' ? 'fixed' : 'floating';
  menus.stick = TouchControls.stickMode;
  ads.onMute = (m) => sfx.setMuted(m);
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
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('quick')) {
    const home = makeTeam(PRESET_CLUBS[save.clubIdx]);
    const away = makeTeam(PRESET_CLUBS[save.opponentIdx]);
    startMatch({
      home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)], humanSide: 0,
      difficulty: save.settings.difficulty, halfMinutes: save.settings.halfMinutes, attendance: 0.9, stadiumLevel: 5,
      mode: params.has('blitz') ? 'blitz' : 'classic',
      reward: (r) => standardReward(r, save.settings.difficulty), onDone: () => mainMenu(),
    });
    return;
  }
  menus.title(() => {
    sfx.unlock();
    applySettings();
    // Portal builds, first visit: TAP TO PLAY is the one click to gameplay (the first basics drill).
    if (straightToBasics(onboarding(), played(), PORTAL)) startBasics(0);
    else mainMenu();
  });
  // Cloud saves (a no-op until a backend is configured): pull the newer copy, then keep pushing changes.
  void cloudBoot({ save, persist, reload });
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
    key(code: string, down: boolean) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
}

export const ready = boot();
