import '@fontsource/lilita-one/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './style.css';
import { Vector3 } from 'three';
import type { AppContext, MatchRequest } from './app';
import { sfx } from './audio/sfx';
import { Input } from './core/input';
import {
  CONTROL_DEFAULTS, advanceDaily, controlsOf, dailyChallenges, dailyFor, levelOf, levelTitle, loadSave, matchStars, matchXp, nextStreak,
  streakMult, writeSave, type CamZoom, type ControlSettings, type MatchSummary, nextUnlock, skinUnlocked, type BallSkinId, celebrationUnlocked,
  type CelebrationId, type SaveData, momentStarsTotal, momentXp, recordMoment } from './core/save';
import { MatchSession, type MatchResult, type SessionOptions } from './game/matchSession';
import { PRESET_CLUBS, makeTeam, resolveKitClash } from './meta/data';
import { ads } from './platform/ads';
import { PITCH_Y } from './render/stadium';
import { World, type TimeOfDay } from './render/world';
import { BOX_DEPTH, BOX_W, HALF_L } from './sim/constants';
import type { Match } from './sim/match';
import type { FormationId, KickKind, MatchEvent, MatchMode, Side } from './sim/types';
import { DIFFICULTIES, DIFF_LEVEL, Menus, type MainInfo } from './ui/menus';
import { DIVISION_NAMES, clubRating, migrateCareer, nextMatch } from './meta/career';
import { ROUND_NAMES, clubRating as presetRating, migrateCup } from './meta/cup';
import { overall } from './sim/types';
import { openCareer } from './ui/career';
import { openCup } from './ui/cup';
import { closeMeta, openClub } from './ui/club';
import { stopSpeech } from './ui/commentary';
import type { Projector } from './ui/hud';
import { openMoments } from './ui/moments';
import { openOnline, type OnlineHost } from './ui/online';
import { installSepGuard } from './ui/text';
import { Trainer } from './ui/trainer';
import { cloudAvailable, cloudBoot, cloudUser, openAccount } from './platform/cloud';

/** When the script started: the studio splash stays up at least SPLASH_MS from here. */
const bootAt = performance.now();
const SPLASH_MS = 800;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = new World(canvas);
const input = new Input();
// The trainer's first-match teaching steps watch the stick and PASS through the live input (see ui/trainer.ts).
Trainer.input = input;
const menus = new Menus();
const save = loadSave();
let session: MatchSession | null = null;
let demo: MatchSession | null = null;
/** The main menu (or a screen off it) is up, as opposed to the title screen or a match. */
let atMenu = false;

function persist(): void {
  writeSave(save);
}

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

/** The ball look to play with: the chosen one if this level has earned it, else the classic ball. */
function equippedSkin(): string | undefined {
  const id = save.settings.ballSkin as BallSkinId | undefined;
  return id && skinUnlocked(id, levelOf(save.progress.xp).level) ? id : undefined;
}

/** The goal celebration to play: the chosen one if this level has earned it, else the classic one. */
function equippedCelebration(): string | undefined {
  const id = save.settings.celebration as CelebrationId | undefined;
  return id && celebrationUnlocked(id, levelOf(save.progress.xp).level) ? id : undefined;
}

/** Live camera-distance change (Settings opened from the pause menu). Optional: older sessions lack it. */

function applyCamZoom(s: MatchSession | null): void {
  (s as { setCamZoom?: (z: CamZoom) => void } | null)?.setCamZoom?.(camZoom());
}

/**
 * Settings > Controls onto a match: pass assistance (ground / through), auto switch, switch move assist and
 * timed finishing. The sim reads them every tick, so a change from the pause menu applies at once.
 */
function applyControls(m: Match, c: ControlSettings = controlsOf(save.settings)): void {
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
  lastShot: { player: number; kind: KickKind; x: number; z: number; at: number } | null;
}

const newTally = (): Tally => ({ headers: 0, longGoals: 0, tacklesWon: 0, skills: 0, powerups: 0, lastShot: null });

/** Match seconds over both halves. */
const matchAt = (m: Match) => (m.half - 1) * m.cfg.halfLength + m.clock;

function track(t: Tally, e: MatchEvent, m: Match, hs: Side): void {
  switch (e.type) {
    case 'kick':
      if (e.kind === 'shot' || e.kind === 'header') t.lastShot = { player: m.ball.lastTouch, kind: e.kind, x: e.x, z: e.z, at: matchAt(m) };
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
  if (session) {
    // (Not online: each side's controls there were agreed before the kick-off, and a change on one machine
    // only would split the two games apart.)
    if (!session.driver) applyControls(session.match);
    session.hud?.setCommentary(s.commentary, s.commentaryVoice);
    applyCamZoom(session);
    (session as { setBallSkin?: (id?: string) => void }).setBallSkin?.(equippedSkin());
    (session as { setCelebration?: (id?: string) => void }).setCelebration?.(equippedCelebration());
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

function localDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  if (q) {
    const p = playNowPlan();
    info.playNow = `${q.short} v ${PRESET_CLUBS[p.rival].short} · ${DIFFICULTIES[p.difficulty]}`;
  }
  if (q && o) info.quick = 'PICK TEAMS · RULES';
  const moStars = momentStarsTotal(save);
  info.moments = moStars ? `SHORT CHALLENGES · ★ ${moStars}` : 'SHORT CHALLENGES';
  const user = cloudUser();
  if (user) info.account = user.name;
  try {
    const career = save.career ? migrateCareer(save.career, 1) : null;
    const club = career?.club ?? null;
    if (club && career) {
      const nm = nextMatch(career);
      const div = career.season ? DIVISION_NAMES[career.season.division] ?? '' : '';
      // Opponent first: on small tiles the subtitle is cut with an ellipsis, and the next match matters most.
      info.career = nm ? `v ${nm.rival.short} · ${div}` : div || 'SEASON DONE';
      info.club = `OVR ${clubRating(club)}`;
      const star = [...club.squad.slice(0, 11)].sort((a, b) => overall(b) - overall(a))[0];
      if (star) info.captain = { def: star, kit: club.kit, club: club.name.toUpperCase(), ovr: clubRating(club) };
    } else {
      info.career = 'START YOUR CLUB';
      info.club = 'KIT · SQUAD';
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
  info.level = { level: lv.level, title: levelTitle(lv.level), into: lv.into, need: lv.need };
  info.unlock = nextUnlock(save.progress.xp);
  const dayBefore = p.daily.day;
  const daily = dailyFor(p, localDay());
  if (daily.day !== dayBefore) persist();
  info.daily = { list: dailyChallenges(daily.day), progress: daily.progress, claimed: daily.claimed, fresh: daily.fresh };
  info.streak = p.streak;
  return info;
}

function mainMenu(): void {
  atMenu = true;
  if (!demo) startDemo();
  if (save.settings.music) sfx.startMusic();
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
          save.coins += amount;
          save.gift = { last: localDay(), streak: g.streak };
          persist();
          return true;
        },
        back: mainMenu,
      });
    },
    quick: () => quickMatch(),
    blitz: () => quickMatch('blitz'),
    moments: () => openMoments(app, mainMenu),
    online: () => openOnline(onlineHost),
    unlocks: () => menus.unlocks(save, mainMenu),
    career: () => openCareer(app),
    cup: () => openCup(app),
    club: () => openClub(app),
    settings,
    howto: () => menus.howTo(mainMenu, input.lastDevice),
  }, info);
}

/**
 * ONLINE (src/ui/online.ts): it builds the match and drives it (lockstep); this puts it on screen and takes it
 * off. No coins, XP or record: an online friendly doesn't touch the save.
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
    const s = new MatchSession(world, input, { ...opt, ballSkin: equippedSkin(), celebration: equippedCelebration() });
    session = s;
    s.hud?.setCommentary(save.settings.commentary, save.settings.commentaryVoice);
    s.hud?.setProjector(project);
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
 * What PLAY NOW starts: your club against the closest-rated rival, classic rules; a new player gets Normal
 * and 1.5-minute halves, a returning one the difficulty and half length they set in Quick Match.
 */
function playNowPlan(): { home: number; rival: number; difficulty: number; halfMinutes: number } {
  const home = PRESET_CLUBS[save.clubIdx] ? save.clubIdx : 0;
  const fresh = save.record.played === 0;
  return { home, rival: similarRival(home), difficulty: fresh ? 1 : save.settings.difficulty, halfMinutes: fresh ? 1.5 : save.settings.halfMinutes };
}

/** Matches played on this save so far (a moment is not a match). */
const played = (): number => save.record.played;

/**
 * PLAY NOW: straight into a match, no setup screen and no fly-in. Title → PLAY NOW → kick-off is two taps. On a
 * fresh save it is the first match: the session waits for a button at kick-off, the AI eases off and the
 * trainer teaches MOVE and PASS (MatchRequest.firstMatch).
 */
function playNow(): void {
  const p = playNowPlan();
  const home = makeTeam(PRESET_CLUBS[p.home]);
  const away = makeTeam(PRESET_CLUBS[p.rival]);
  startMatch({
    home, away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: 0,
    difficulty: p.difficulty,
    halfMinutes: p.halfMinutes,
    attendance: 0.9,
    stadiumLevel: 5,
    mode: 'classic',
    firstMatch: played() === 0,
    skipIntro: true,
    rematch: true,
    reward: (r) => standardReward(r, p.difficulty),
    onDone: () => mainMenu(),
    onQuit: () => mainMenu(),
  });
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
  menus.quickMatch(save, mainMenu, (h, a, m) => {
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
      rematch: true,
      reward: (r) => standardReward(r, difficulty),
      onDone: () => mainMenu(),
      onQuit: () => mainMenu(),
    });
  }, mode);
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

let matchesPlayed = 0;

async function startMatch(req: MatchRequest): Promise<void> {
  atMenu = false;
  menus.close();
  sfx.stopMusic();
  // Portal interstitial at the natural break before a new kick-off (never on the first match).
  if (matchesPlayed > 0) await ads.midgame();
  demo?.dispose();
  demo = null;
  const { kits, humanSide } = req;
  // A new player's first three matches are played in daylight and clear weather (no snow on a first kick-off).
  const early = played() < 3;
  session = new MatchSession(world, input, {
    home: req.home,
    away: req.away,
    kits,
    halfLength: req.halfMinutes * 60,
    difficulty: DIFF_LEVEL[req.difficulty] ?? 1.8,
    humanSide,
    attendance: req.attendance,
    seed: Math.floor(Math.random() * 1e9),
    timeOfDay: req.timeOfDay ?? (early ? 'day' : pickTime()),
    weather: req.weather ?? (early ? 'clear' : pickWeather()),
    knockout: req.knockout,
    // Career and the cup stay classic; Quick Match passes the mode the player picked.
    mode: req.mode ?? 'classic',
    firstMatch: !!req.firstMatch && played() === 0,
    scenario: req.scenario,
    skipIntro: req.skipIntro,
    stadiumLevel: Math.max(0, Math.min(5, Math.round(req.stadiumLevel ?? 5))),
    tutorial: !save.seenTutorial,
    camZoom: camZoom(),
    ballSkin: equippedSkin(),
    celebration: equippedCelebration(),
  });
  applyControls(session.match);
  session.hud?.setCommentary(save.settings.commentary, save.settings.commentaryVoice);
  session.hud?.setProjector(project);
  const blitz = req.mode === 'blitz';
  session.hud?.setBlitz(blitz);
  session.touch?.setBlitz(blitz);
  // Count what the human does (headers, long-range goals, tackles, skills, pickups) for XP and the daily challenges.
  const tally = newTally();
  const hs: Side = humanSide === 1 ? 1 : 0;
  if (session.hud) session.hud.onEvent = (e, m) => track(tally, e, m, hs);
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
    stopSpeech();
    const pauseMenu = (): void =>
      menus.pause({
        quitNote: req.quitNote ?? "This match won't count and you won't earn any coins.",
        tactics: () => tacticsMenu(pauseMenu),
        resume: () => {
          menus.close();
          s.resume();
          ads.gameplayStart();
        },
        howto: () => menus.howTo(pauseMenu, input.lastDevice),
        // Mid-match, the options that matter are the controls: open on that tab.
        settings: () => menus.settings(save, applySettings, pauseMenu, 'controls'),
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
    matchesPlayed++;
    if (r.scenarioOutcome && req.scenario) {
      // A Football Moment: not a match (no record, coins, streak or challenges); XP for the try and the stars,
      // the best stars kept by moment id. RETRY runs the same request again, NEXT MOMENT hands back to the list.
      const o = r.scenarioOutcome;
      const p = save.progress;
      const xpFrom = p.xp;
      p.xp += momentXp(o.stars);
      recordMoment(save, req.scenario.id, o.stars);
      persist();
      const leave = (then: () => void) => {
        menus.close();
        endMatch();
        then();
      };
      menus.momentResult(req.scenario, o, { from: xpFrom, to: p.xp }, {
        retry: () => leave(() => void startMatch({ ...req, skipIntro: true })),
        next: () => leave(() => req.onDone(r, 0)),
        nextLabel: req.nextLabel,
        menu: () => leave(() => mainMenu()),
      });
      return;
    }
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
    };
    const xpFrom = p.xp;
    p.xp += matchXp(summary);
    const stars = matchStars(summary);
    p.stars += stars;
    const daily = dailyFor(p, localDay());
    const done = advanceDaily(daily, dailyChallenges(daily.day), summary);
    const bonus = done.reduce((n, x) => n + x.challenge.coins, 0);
    let earned = reward.coins + bonus;
    save.coins += earned;
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
        void startMatch({ ...req, skipIntro: true });
      } : undefined,
    }, r.ratings, {
      stars, xpFrom, xpTo: p.xp, streak: p.streak, mult, done: done.map((x) => ({ text: x.challenge.text, coins: x.challenge.coins })),
    });
  };
  window.addEventListener('keydown', pauseKey);
}

function pauseKey(e: KeyboardEvent): void {
  if ((e.code === 'Escape' || e.code === 'KeyP') && session && !session.paused && !menus.open) session.requestPause();
}

function endMatch(): void {
  window.removeEventListener('keydown', pauseKey);
  stopSpeech();
  session?.dispose();
  session = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !session.paused && !menus.open) session.requestPause();
});
window.addEventListener('resize', () => {
  world.resize();
  canvasRect = canvas.getBoundingClientRect();
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // (Our own work this frame, for the dynamic resolution: a CPU-bound hitch is no reason to drop pixels.)
  const t0 = performance.now();
  canvasRect = canvas.getBoundingClientRect();
  (session ?? demo)?.update(dt);
  syncControlsUi(session);
  world.render();
  world.adapt(dt, (performance.now() - t0) / 1000);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  world.setQuality(save.settings.quality);
  ads.onMute = (m) => sfx.setMuted(m);
  // Every screen's text goes through the divider guard (see ui/text.ts): no glyph the fonts lack.
  installSepGuard(menus.root);
  // Never let a slow or blocked portal SDK hold the title screen hostage; the studio splash gets its moment.
  await Promise.all([
    Promise.race([ads.init(), new Promise<void>((r) => setTimeout(r, 3000))]),
    document.fonts?.ready,
    new Promise<void>((r) => setTimeout(r, Math.max(0, SPLASH_MS - (performance.now() - bootAt)))),
  ]);
  startDemo();
  requestAnimationFrame(frame);
  document.getElementById('boot')?.classList.add('gone');
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
    mainMenu();
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
      for (let i = 0; i < n; i++) (session ?? demo)?.update(dt);
      syncControlsUi(session);
      world.render();
    },
    key(code: string, down: boolean) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
}

void boot();
