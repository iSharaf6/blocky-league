import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYS, Input, bindKey, normalizeKeyMap, setBindings } from '../src/core/input';
import { defaultOnboarding, straightToBasics } from '../src/core/onboarding';
import { ADBLOCKER_NOTE, AD_AFTER_RESULT_MS, AD_FREE_MATCHES, PLAY_SETTLE_S, PORTAL_HALF_GAP_MS, breakDue, halfBreakDue, playIsHeld, playIsLive, playStep, type PlayState } from '../src/platform/ads';
import { devPortal, inNativeApp } from '../src/platform/native';
import { developerAboutHtml } from '../src/ui/developerAbout';
import { NO_AD_TEXT, adIcon } from '../src/ui/pixelIcons';

// This game typechecks against browser types; the source checks read files with Node 22+.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');
const source = (path: string): string => readFileSync(path, 'utf8');

/** `src` from the first `from` up to the next `to` after it. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a, `missing: ${from}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + from.length);
  expect(b, `missing after it: ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setBindings(undefined, undefined);
});

/**
 * What CrazyGames asks of a full launch (docs.crazygames.com/requirements), as far as it can be checked without a
 * browser: when an ad may be asked for, when play counts as started, which keys the game leaves to the browser, how
 * a rewarded offer reads, and what a portal build must not carry. The adapter itself: tests/ads.test.ts; the save:
 * tests/portalSave.test.ts.
 */
describe('interstitials: only at a kick-off, and never for a new player', () => {
  const due = { recovered: false, basics: false, firstMatch: false, finishedThisVisit: 1, sinceResultMs: AD_AFTER_RESULT_MS, played: AD_FREE_MATCHES };

  it('two whole matches come first: a REMATCH straight after the first ever match gets no ad', () => {
    expect(AD_FREE_MATCHES).toBe(2);
    expect(breakDue({ ...due, played: 0 })).toBe(false);
    expect(breakDue({ ...due, played: 1 })).toBe(false);
    expect(breakDue({ ...due, played: 2 })).toBe(true);
    expect(breakDue({ ...due, played: 40 })).toBe(true);
  });

  it('never the first thing of a visit, and never straight off a result screen', () => {
    expect(breakDue({ ...due, finishedThisVisit: 0, played: 40 })).toBe(false);
    expect(breakDue({ ...due, sinceResultMs: AD_AFTER_RESULT_MS - 1 })).toBe(false);
    // (Before any result this visit the clock reads minus infinity.)
    expect(breakDue({ ...due, sinceResultMs: -Infinity })).toBe(false);
  });

  it('never in the basics, before the first match, or into a match being restored', () => {
    expect(breakDue({ ...due, basics: true })).toBe(false);
    expect(breakDue({ ...due, firstMatch: true })).toBe(false);
    expect(breakDue({ ...due, recovered: true })).toBe(false);
  });

  it('is asked at two natural breaks only: before a kick-off and at half time (no menu, tab or screen change asks for an ad)', () => {
    const src = [...['src/main.ts'], ...['club', 'shop', 'menus', 'career', 'cup', 'market', 'moments', 'run', 'badges', 'glory'].map((f) => `src/ui/${f}.ts`)].map(source).join('\n');
    expect(src.match(/ads\.midgame\(/g)).toHaveLength(2);
    const kickoff = between(source('src/main.ts'), 'async function startMatch(', 'demo?.dispose();');
    expect(kickoff).toContain('if (breakDue({');
    expect(kickoff).toContain("await ads.midgame(req.scenario ? 'moment' : 'match');");
    // The half-time break (2026-10-14): asked once a match, in the half-time handler, behind its own rule, and the
    // half-time screen comes up after it whether an ad played or not.
    const half = between(source('src/main.ts'), 's.onHalftime = () => {', 'let halfAdAsked = false;');
    expect(half).toContain('halfBreakDue({');
    expect(half).toContain("void ads.midgame('halftime').then(show, show);");
    expect(half).toContain('halfAdAsked = true;');
  });
});

describe('"gameplay started" means a ball is playable', () => {
  it('not until the sim steps: the fly-in, a brief and the first-match hold are not play', () => {
    expect(playIsLive('kickoff', false, false)).toBe(false);
    expect(playIsLive('play', false, false)).toBe(false);
    expect(playIsLive('kickoff', true, false)).toBe(true);
    expect(playIsLive('play', true, false)).toBe(true);
    expect(playIsLive('restart', true, false)).toBe(true);
    expect(playIsLive('shootout', true, false)).toBe(true);
  });

  it('not under a pause or a menu, not in a celebration, at half time or at full time', () => {
    expect(playIsLive('play', true, true)).toBe(false);
    for (const phase of ['goal', 'halftime', 'fulltime']) expect(playIsLive(phase, true, false)).toBe(false);
  });

  it('a match owes it at the kick-off and the second half; a pause, half time and full time take it back', () => {
    const main = source('src/main.ts');
    const match = between(main, 'async function startMatch(', '\nfunction tryResumeMatch(');
    // Never sent as the session is made: the frame loop pays it (payPlay) once the sim is stepping. The one start
    // here is a resume straight back into live play.
    const starts = match.match(/ads\.gameplayStart\(\)/g) ?? [];
    expect(starts).toHaveLength(1);
    const pause = between(match, 's.onPause = () => {', 'const pauseMenu');
    expect(pause).toContain('if (owed || playIsHeld(s.match.phase, s.cutScene)) owePlay();');
    expect(pause).toContain('ads.gameplayStart();');
    expect(match).toContain('owePlay();');
    expect(between(match, 's.onHalftime = () => {', 'const ht = ')).toContain('owePlay();');
    for (const stop of ['s.onPause = () => {', 's.onHalftime = () => {', 's.onFinish = (r) => {']) {
      expect(between(match, stop, 'menus.')).toContain('stopPlay();');
    }
    // Every stop goes through stopPlay or the frame loop: only ever when a start is out.
    expect(between(main, 'function stopPlay(): void {', '\n}')).toContain('if (play.out) ads.gameplayStop();');
    expect(main.match(/ads\.gameplayStop\(\)/g)).toHaveLength(2);
    expect(between(main, 'function frame(now: number): void {', 'requestAnimationFrame(frame);')).toContain('payPlay(dt);');
    expect(between(main, 'function endMatch(): void {', '\n}')).toContain('stopPlay();');
    // An online match goes by the same rule: owed at the start, never sent as the session is made.
    expect(between(main, 'const s = new MatchSession(world, input, {', 'return s;')).toContain('owePlay();');
  });
});

describe('"gameplay stopped" at a goal and at every cut scene, until play is live again (CrazyGames review)', () => {
  type Frame = { phase: string; scene?: boolean; stepped?: boolean; held?: boolean };
  /** Run frames at 60 fps through the rule main.ts runs every frame; returns what the portal heard, with frame numbers. */
  function run(frames: Frame[], st: PlayState = { out: false, owed: true, liveS: -1 }): { said: string[]; at: number[]; st: PlayState } {
    const said: string[] = [];
    const at: number[] = [];
    frames.forEach((f, i) => {
      const s = playStep(st, { phase: f.phase, scene: !!f.scene, stepped: f.stepped ?? true, held: !!f.held, dt: 1 / 60 });
      if (s) {
        said.push(s);
        at.push(i);
      }
    });
    return { said, at, st };
  }
  const n = (k: number, f: Frame): Frame[] => Array.from({ length: k }, () => f);

  it('a goal: one stop on the goal\'s first frame, nothing through the celebration and the replay, one start once the kick-off is live', () => {
    const frames = [
      ...n(20, { phase: 'kickoff' }), ...n(60, { phase: 'play' }),
      // The goal: the celebration (the sim steps), the replay (it does not: a cut scene), the walk back.
      ...n(120, { phase: 'goal' }), ...n(300, { phase: 'goal', scene: true, stepped: false }), ...n(30, { phase: 'goal' }),
      ...n(60, { phase: 'kickoff' }), ...n(60, { phase: 'play' }),
    ];
    const { said, at } = run(frames);
    expect(said).toEqual(['start', 'stop', 'start']);
    expect(at[1]).toBe(80);
    // Back on at the kick-off, once it has held for PLAY_SETTLE_S.
    expect(at[2]).toBeGreaterThanOrEqual(530);
    expect(at[2]).toBeLessThanOrEqual(530 + Math.ceil(PLAY_SETTLE_S * 60) + 1);
  });

  it('a substitution\'s touchline shot right after the kick-off: no start in between, so never a start and a stop back to back', () => {
    const frames = [
      ...n(60, { phase: 'play' }), ...n(200, { phase: 'goal' }),
      ...n(2, { phase: 'kickoff' }), ...n(240, { phase: 'kickoff', scene: true, stepped: false }), ...n(60, { phase: 'kickoff' }),
    ];
    expect(run(frames).said).toEqual(['start', 'stop', 'start']);
  });

  it('an incident (offside, a foul, a penalty awarded): stopped for its decision, recap and the referee\'s close-up, started at the restart', () => {
    const frames = [
      ...n(60, { phase: 'play' }), ...n(90, { phase: 'out', scene: true, stepped: false }), ...n(4, { phase: 'restart' }),
      ...n(108, { phase: 'restart', scene: true }), ...n(60, { phase: 'restart' }), ...n(60, { phase: 'play' }),
    ];
    expect(run(frames).said).toEqual(['start', 'stop', 'start']);
  });

  it('half time and full time stop it at the whistle; the half-time screen and the result add no second stop', () => {
    const frames = [...n(60, { phase: 'play' }), ...n(120, { phase: 'halftime' }), ...n(30, { phase: 'halftime', held: true })];
    const { said, st } = run(frames);
    expect(said).toEqual(['start', 'stop']);
    // (main.ts onHalftime then calls stopPlay, which sends nothing: no start is out.)
    expect(st.out).toBe(false);
  });

  it('a pause is left to onPause, and a hit-stop or a frame the sim does not step is not a stoppage', () => {
    const frames = [...n(60, { phase: 'play' }), ...n(30, { phase: 'play', held: true }), ...n(2, { phase: 'play', stepped: false }), ...n(60, { phase: 'play' })];
    expect(run(frames).said).toEqual(['start']);
    // The fly-in and a brief (no step): owed, never paid.
    expect(run(n(200, { phase: 'kickoff', stepped: false })).said).toEqual([]);
    expect(run(n(200, { phase: 'kickoff', scene: true, stepped: false })).said).toEqual([]);
  });

  it('starts and stops strictly alternate, whatever the match does frame to frame', () => {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const phases = ['kickoff', 'play', 'out', 'restart', 'goal', 'halftime', 'fulltime', 'shootout'];
    const frames: Frame[] = [];
    for (let i = 0; i < 4000; i++) {
      const k = 1 + Math.floor(rnd() * 40);
      const f = { phase: phases[Math.floor(rnd() * phases.length)], scene: rnd() < 0.2, stepped: rnd() < 0.8, held: rnd() < 0.05 };
      for (let j = 0; j < k; j++) frames.push(f);
    }
    const { said } = run(frames);
    expect(said.length).toBeGreaterThan(10);
    said.forEach((s, i) => expect(s).toBe(i % 2 === 0 ? 'start' : 'stop'));
  });

  it('what counts: the goal phase, half and full time, and any cut scene; never a pause by itself', () => {
    for (const phase of ['goal', 'halftime', 'fulltime']) expect(playIsHeld(phase, false)).toBe(true);
    for (const phase of ['kickoff', 'play', 'out', 'restart', 'shootout']) {
      expect(playIsHeld(phase, false)).toBe(false);
      expect(playIsHeld(phase, true)).toBe(true);
      expect(playIsLive(phase, true, false, true)).toBe(false);
    }
  });

  it('call sites: the session says when a cut scene is on, and the frame loop and the dev step both run the rule', () => {
    const session = source('src/game/matchSession.ts');
    const cut = between(session, 'get cutScene(): boolean {', '\n  }');
    for (const part of ['this.introLeft > 0', '!!this.replay', 'this.incidents().waiting(this.match)', '!!this.subCut', '!!this.interlude',
      '!this.motmDone', "this.cam.mode === 'card'", "this.cam.mode === 'scene'"]) expect(cut).toContain(part);
    const main = source('src/main.ts');
    const pay = between(main, 'function payPlay(dt: number): void {', '\n}');
    expect(pay).toContain('playStep(play, { phase: s.match.phase, scene: s.cutScene, stepped, held: s.paused || menus.open, dt });');
    expect(pay).toContain("if (said === 'stop') ads.gameplayStop();");
    expect(pay).toContain("else if (said === 'start') ads.gameplayStart();");
    expect(between(main, 'step(n: number, dt = 1 / 60) {', 'world.render();')).toContain('payPlay(dt);');
  });
});

describe('a portal build starts in the game, with no title to click through', () => {
  it('a first visit goes straight to the first drill; a returning player to the hub', () => {
    const fresh = defaultOnboarding();
    expect(straightToBasics(fresh, 0, true)).toBe(true);
    expect(straightToBasics(fresh, 0, false)).toBe(false);
    expect(straightToBasics({ ...fresh, basics: 1 }, 0, true)).toBe(false);
    expect(straightToBasics(fresh, 3, true)).toBe(false);
  });

  it('boot: no TAP TO PLAY on a portal, the sound wakes on the first gesture, and every other build keeps its title', () => {
    const boot = between(source('src/main.ts'), 'async function boot(): Promise<void> {', '\nif (import.meta.env.DEV) {');
    const portal = between(boot, 'if (PORTAL) {', '} else {');
    expect(portal).toContain('wakeAudioOnGesture();');
    expect(portal).toContain('enter();');
    expect(portal).not.toContain('menus.title(');
    const rest = boot.slice(boot.indexOf(portal) + portal.length);
    expect(rest).toMatch(/menus\.title\(\(\) => \{\s*sfx\.unlock\(\);\s*enter\(\);/);
    // An unfinished match comes back first; then the drill or the hub.
    const enter = between(boot, 'const enter = (): void => {', '  };');
    expect(enter.indexOf('tryResumeMatch()')).toBeLessThan(enter.indexOf('straightToBasics('));
    expect(enter).toContain('else mainMenu();');
    // Loading is reported done before the game is entered, on every build.
    expect(boot.indexOf('ads.loadingDone();')).toBeGreaterThan(0);
    expect(boot.indexOf('ads.loadingDone();')).toBeLessThan(boot.indexOf('const enter = (): void => {'));
  });

  it('boot: the save is settled with CrazyGames before any screen reads it, and again when a slow SDK arrives', () => {
    const main = source('src/main.ts');
    const boot = between(main, 'async function boot(): Promise<void> {', '\nif (import.meta.env.DEV) {');
    expect(boot).toContain('const sdkUp = ads.init();');
    expect(boot).toContain('adoptPortalSave();\n  void sdkUp.then(adoptPortalSave);');
    expect(boot.indexOf('adoptPortalSave();')).toBeLessThan(boot.indexOf('const enter = (): void => {'));
    // Measured against the save as the visit began, taken before anything writes.
    expect(main.indexOf('const saveAtLoad = saveBaseline(save);')).toBeGreaterThan(main.indexOf('const save = loadSave();'));
    // ... and for whoever CrazyGames says is playing: one browser shared by two accounts never mixes their saves.
    expect(main).toContain('adoptPortalStore(store, save, saveAtLoad, ads.portalUser())');
    // A guest who signs in mid-visit: settled again for the account, through the same hold and the same door.
    expect(main).toContain('if (PORTAL) ads.onAuth = portalAuthChanged;');
    // An SDK that only came up on its background retry settles the save then, the same way.
    expect(main).toContain('if (PORTAL) ads.onLate = adoptPortalSave;');
    const auth = between(main, 'function portalAuthChanged(uid: string): void {', '\n}');
    expect(auth).toContain('adoptPortalStore(store, waiting ?? save, undefined, uid)');
    expect(auth).toContain('if (!theirs && waiting) holdPortalWrites();');
    expect(auth.trimEnd().endsWith('settlePortalSave();')).toBe(true);
    // Swapped in through reload, never while a match is on; the hub and every kick-off ask first.
    const settle = between(main, 'function settlePortalSave(): boolean {', '\n}');
    expect(settle).toContain('if (!theirs || session) return false;');
    expect(settle.indexOf('portalSaveSwapped();')).toBeLessThan(settle.indexOf('reload(theirs);'));
    expect(between(main, 'function mainMenu(): void {', 'basicsNow = false;')).toContain('if (settlePortalSave()) return;');
    expect(between(main, 'async function startMatch(', 'atMenu = false;')).toContain('if (portalSave && !session) {');
    // A match that ends or is walked off while his copy waits hands back to the hub, not to its own screen (the
    // career road, the moments list: they would only show a save about to be replaced).
    expect(between(main, 'function handBack(go: () => void): void {', '\n}')).toContain('if (portalSave && !session) mainMenu();\n  else go();');
    expect(main).toContain('handBack(req.onQuit ?? mainMenu);');
    expect(main).toContain('handBack(() => req.onDone(r, 0));');
    expect(main).toContain('handBack(() => req.onDone(r, earned));');
    expect(main.match(/req\.onDone\(/g)).toHaveLength(2);
    expect(main).not.toContain('(req.onQuit ?? mainMenu)()');
  });

  it('while an ad is asked for or is up the game takes no input, and a match it came up over is paused', () => {
    const main = source('src/main.ts');
    const shield = between(main, 'function adShield(busy: boolean): void {', '\n}');
    expect(shield).toContain('ui.inert = busy;');
    expect(shield).toContain("window.addEventListener('keydown', swallowKey, true);");
    expect(shield).toContain('autoPause();');
    expect(main).toContain('if (PORTAL) ads.onBusy = adShield;');
    // The layer over the pitch and the screens (ui/adHold.ts) goes up and comes down first, whatever follows; an
    // interstitial awaited with nothing on screen says ONE MOMENT on it; and a held key still never scrolls the page.
    expect(shield.indexOf('adHold(busy);')).toBeGreaterThan(-1);
    expect(shield.indexOf('adHold(busy);')).toBeLessThan(shield.indexOf('ui.inert = busy;'));
    expect(main).toContain('if (PORTAL) ads.onWait = adWait;');
    expect(between(main, 'const swallowKey = (e: KeyboardEvent): void => {', '\n};')).toContain('if (holdsPage(e)) e.preventDefault();');
  });
});

describe('keys: CTRL and CMD are the browser\'s', () => {
  it('neither can be bound, on either side of the keyboard', () => {
    for (const code of ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'OSLeft']) {
      const r = bindKey(DEFAULT_KEYS, 'sprint', 0, code);
      expect(r.refused).toBe('reserved');
      expect(r.map.sprint).toEqual(DEFAULT_KEYS.sprint);
    }
    // (Other modifiers still can: SHIFT is the default sprint, ALT is a player's choice.)
    expect(bindKey(DEFAULT_KEYS, 'sprint', 1, 'AltLeft').refused).toBeUndefined();
  });

  it('a map saved before the rule loses them, and an action left with nothing gets its defaults back', () => {
    const map = normalizeKeyMap({ ...DEFAULT_KEYS, sprint: ['ControlLeft', 'KeyI'], skill: ['ControlRight'], power: ['MetaLeft', 'KeyE'] });
    expect(map.sprint).toEqual(['KeyI']);
    expect(map.skill).toEqual(DEFAULT_KEYS.skill);
    expect(map.power).toEqual(['KeyE']);
    for (const keys of Object.values(map)) for (const k of keys) expect(k).not.toMatch(/^(Control|Meta|OS)/);
  });

  it('pause is never ESCAPE alone by default', () => {
    expect(DEFAULT_KEYS.pause).toContain('Escape');
    expect(DEFAULT_KEYS.pause.length).toBeGreaterThan(1);
  });

  it('a key pressed with CTRL or CMD held is a browser shortcut: not played, and not blocked', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    setBindings(undefined, undefined);
    const input = new Input();
    const press = (code: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event => {
      const e = new Event('keydown', { cancelable: true });
      Object.assign(e, { code, repeat: false, ctrlKey: false, metaKey: false, ...mods });
      win.dispatchEvent(e);
      return e;
    };
    const release = (code: string): void => {
      const e = new Event('keyup');
      Object.assign(e, { code });
      win.dispatchEvent(e);
    };
    // CTRL+W (close the tab), CMD+S (save the page): W and S are the default up and down.
    expect(press('KeyW', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('KeyS', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('Space', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(input.read()).toMatchObject({ sx: 0, sy: 0, pass: false });
    // The same keys by themselves are the game's.
    expect(press('KeyW').defaultPrevented).toBe(true);
    expect(input.read().sy).toBe(1);
    release('KeyW');
    expect(input.read().sy).toBe(0);
  });

  it('the pause key and a card\'s 1 2 3 follow the same rules (the physical key, no browser combo)', () => {
    const pause = between(source('src/main.ts'), 'function pauseKey(e: KeyboardEvent): void {', '\n}');
    expect(pause).toContain('if (e.ctrlKey || e.metaKey) return;');
    const glory = source('src/ui/glory.ts');
    expect(glory).toContain('/^(?:Digit|Numpad)([1-3])$/.exec(e.code)');
    expect(glory).not.toContain('Number(e.key)');
  });
});

describe('a rewarded offer reads the same everywhere', () => {
  it('carries the film icon, and says one thing when its ad did not play', () => {
    expect(adIcon()).toContain('<svg class="picon inl"');
    expect(adIcon()).toContain('aria-hidden="true"');
    expect(NO_AD_TEXT).toBe('NO AD RIGHT NOW, TRY LATER');
  });

  it('all seven: the icon beside words that say AD, switched off with a reason when none can be shown, one request a tap', () => {
    const menus = source('src/ui/menus.ts');
    const shop = source('src/ui/shop.ts');
    const club = source('src/ui/club.ts');
    // The daily gift's 2X, full time's bonus and the lost decider's replay (ui/menus.ts).
    expect(menus).toContain('${adIcon()}AD 2X COINS</button>');
    expect(menus).toContain('${adIcon()}AD +${reward.adBonus ?? reward.coins} COINS</button>');
    expect(menus).toContain('${adIcon()}WATCH AN AD</button>');
    for (const off of ['disabled>${adIcon()}${escHtml(h.adNote())}', 'disabled>${adIcon()}${escHtml(adOff)}', 'disabled>${adIcon()}${escHtml(o.adNote)}']) expect(menus).toContain(off);
    expect(menus.match(/this\.toast\(NO_AD_TEXT\)/g)).toHaveLength(3);
    // FREE COINS, FREE GEMS and the NEW DEAL (ui/shop.ts).
    expect(shop).toContain('`${adIcon()}+${FREE_AD_COINS}`');
    expect(shop).toContain('`${adIcon()}+${GEM_REWARDS.dailyAd}`');
    expect(shop).toContain('`WATCH AN AD${sep()}${left} LEFT TODAY`');
    expect(shop).toContain('<span>NEW (AD)</span>');
    expect(shop).toContain("const adOk = ads.rewardedAvailable && adsLeft(save, 'deal', localDay()) > 0;");
    // (Named once, on the button; the line beside it says what the offer is.)
    expect(shop).toContain("{ label: ads.adBlocked ? `<span class=\"ad-blocked\">${ADBLOCKER_NOTE}</span>` : 'NO AD YET', note: ads.adBlocked ? 'FREE WITH AN AD' : ads.rewardedNote || 'NO AD RIGHT NOW' }");
    expect(shop.match(/NO_AD_TEXT/g)!.length).toBeGreaterThanOrEqual(5);
    // A stadium build's matchday (ui/club.ts).
    expect(club).toContain('${adIcon()}WATCH AD</button>');
    expect(club).toContain('AD TAKES 1 MATCHDAY OFF');
    expect(club).toContain("disabled>${adIcon()}${buildAdBusy ? 'ONE MOMENT' : ads.adBlocked ? `<span class=\"ad-blocked\">${ADBLOCKER_NOTE}</span>` : 'NO AD NOW'}</button>");
    expect(between(club, 'buildad: async () => {', 'skipBuildMatchday(st);')).toContain('if (buildAdBusy || !st.ground.building) return;');
    // No offer is drawn from "this build has ads" alone any more: each asks whether one can be shown.
    for (const src of [menus, shop, club]) expect(src).not.toMatch(/pixelIcon\('film', '#26262e', 2, 'inl'\)/);
  });

  it('nothing is granted unless the ad played through', () => {
    const main = source('src/main.ts');
    // The gift: an ad that did not play claims nothing (the base gift is still there to take).
    const gift = between(main, 'menus.gift(g.amount, g.streak, ads.rewardedAvailable, {', '}, CALENDAR);');
    expect(gift).toContain('if (double && !(await ads.rewarded())) return false;');
    expect(gift.indexOf('await ads.rewarded()')).toBeLessThan(gift.indexOf('claimCalendar('));
    // Full time: the bonus is added only after a true, and nothing leaves the screen while the ad is in flight.
    const ft = between(main, 'menus.fulltime(r.match, kits, humanSide, reward,', '}, r.ratings, {');
    expect(ft).toContain('if (!ok || !sameRewardSave()) return false;');
    expect(ft.match(/if \(doubling\) return;/g)).toHaveLength(2);
    const ftUi = between(source('src/ui/menus.ts'), "const dbl = d.querySelector<HTMLButtonElement>('[data-a=double]');", 'this.wireClip(d, extra.clip);');
    expect(ftUi).toContain('const held = [dbl, nextBtn, rematchBtn]');
    expect(ftUi).toContain('if (adBusy || dbl.disabled) return;');
    // The replay: the day's ad is only used up by an ad that played.
    expect(main).toContain("const ok = (await ads.rewarded()) && useAd(save, 'replay', localDay());");
  });

  it('an ad blocker is named as CrazyGames asked, ADBLOCKER DETECTED, on every offer (never ADS BLOCKED)', () => {
    expect(ADBLOCKER_NOTE).toBe('ADBLOCKER DETECTED');
    const files = ['src/main.ts', 'src/platform/ads.ts', ...['shop', 'menus', 'club', 'glory', 'gemUi', 'career', 'cup'].map((f) => `src/ui/${f}.ts`)];
    for (const f of files) expect(source(f), f).not.toMatch(/['"`](ADS )?BLOCKED['"`]/);
    // The gift's 2X, the replay offer (drawn, and on a tap) and full time's bonus: all four say it.
    expect(source('src/main.ts').match(/ads\.adBlocked[^\n]*\? ADBLOCKER_NOTE/g)).toHaveLength(4);
    expect(source('src/platform/ads.ts')).toContain("this.blocked ? ADBLOCKER_NOTE : 'NO AD RIGHT NOW'");
    // The two narrow buttons let the longer words wrap to two lines, a step smaller, rather than overflow.
    expect(source('src/ui/shop.css')).toContain('.sh-watch .ad-blocked { white-space: normal;');
    expect(source('src/ui/gems.css')).toContain('.sd-now .btn.sd-ad .ad-blocked { white-space: normal;');
  });
});

/** Just enough of a page for a menu screen: buttons found by their data-a (only those the markup really has). */
class FakeEl extends EventTarget {
  innerHTML = '';
  className = '';
  textContent = '';
  disabled = false;
  removed = false;
  children: FakeEl[] = [];
  private found = new Map<string, FakeEl>();
  querySelector(sel: string): FakeEl | null {
    const action = /^\[data-a=(\w+)\]$/.exec(sel);
    if (action && !this.innerHTML.includes(`data-a="${action[1]}"`)) return null;
    let el = this.found.get(sel);
    if (!el) {
      el = new FakeEl();
      this.found.set(sel, el);
    }
    return el;
  }
  querySelectorAll(sel: string): FakeEl[] {
    return sel === 'button' ? [...this.found.values()] : [];
  }
  appendChild(el: FakeEl): void { this.children.push(el); }
  remove(): void { this.removed = true; }
  setAttribute(): void {}
  click(): void { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

describe('a rewarded offer on a screen: one request a tap, nothing for an ad that did not play', () => {
  async function screen() {
    const root = new FakeEl();
    let shown: FakeEl | null = null;
    vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), {
      hidden: false,
      getElementById: () => root,
      createElement: () => (shown = new FakeEl()),
    }));
    const { Menus } = await import('../src/ui/menus');
    const menus = new Menus();
    const toasts = (): string[] => root.children.filter((c) => c.className === 'menu-toast' && !c.removed).map((c) => c.textContent);
    /** The screen on show (the last element made that is not a toast). */
    const mounted = (): FakeEl => root.children.filter((c) => c.className !== 'menu-toast').at(-1) ?? shown!;
    return { menus, root, toasts, mounted };
  }
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  it('the daily gift: the ad way says it is an ad, and an ad that did not play leaves the gift to take', async () => {
    const { menus, toasts, mounted } = await screen();
    let answer!: (ok: boolean) => void;
    const claim = vi.fn((_double: boolean) => new Promise<boolean>((r) => { answer = r; }));
    const back = vi.fn();
    menus.gift(100, 1, true, { claim, back });
    const d = mounted();
    expect(d.innerHTML).toContain('AD 2X COINS');
    expect(d.innerHTML).toContain('class="picon inl"');
    const dbl = d.querySelector('[data-a=double]')!;
    const take = d.querySelector('[data-a=claim]')!;
    dbl.click();
    // In flight: both buttons are off, and a second tap (were it to get through) asks for nothing.
    expect(dbl.disabled && take.disabled).toBe(true);
    dbl.dispatchEvent(new Event('click'));
    take.dispatchEvent(new Event('click'));
    expect(claim.mock.calls).toEqual([[true]]);
    answer(false);
    await settle();
    // Nothing claimed, nothing left: said in one line, and the gift is still there either way.
    expect(back).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['NO AD RIGHT NOW, TRY LATER']);
    expect(dbl.disabled || take.disabled).toBe(false);
    take.click();
    expect(claim.mock.calls).toEqual([[true], [false]]);
    answer(true);
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('the daily gift: with a blocker on, the ad way shows switched off and says so; found on a tap, it switches off then', async () => {
    const { menus, mounted } = await screen();
    menus.gift(100, 1, false, { claim: async () => true, back: vi.fn(), adNote: () => 'ADBLOCKER DETECTED' });
    let d = mounted();
    expect(d.querySelector('[data-a=double]')).toBeNull();
    expect(d.innerHTML).toMatch(/<button class="btn btn-white" disabled>.*ADBLOCKER DETECTED<\/button>/);
    expect(d.querySelector('[data-a=claim]')).not.toBeNull();
    // No ads in this build at all (the web game): no ad button of any kind.
    menus.gift(100, 1, false, { claim: async () => true, back: vi.fn() });
    d = mounted();
    expect(d.innerHTML).not.toContain('disabled');
    expect(d.innerHTML).not.toContain('picon');
    // The blocker turns up on the first request.
    let blocked = false;
    menus.gift(100, 1, true, { claim: async (double) => { if (double) blocked = true; return !double; }, back: vi.fn(), adNote: () => (blocked ? 'ADBLOCKER DETECTED' : '') });
    d = mounted();
    const dbl = d.querySelector('[data-a=double]')!;
    dbl.click();
    await settle();
    expect(dbl.disabled).toBe(true);
    expect(dbl.innerHTML).toContain('ADBLOCKER DETECTED');
    expect(d.querySelector('[data-a=claim]')!.disabled).toBe(false);
  });

  it('a lost decider: one ad request a tap, NO THANKS waits for it, and an ad that did not play keeps the offer', async () => {
    const { menus, toasts, mounted } = await screen();
    let answer!: (ok: boolean) => void;
    const ad = vi.fn(() => new Promise<boolean>((r) => { answer = r; }));
    const no = vi.fn();
    menus.replayOffer({ what: 'CUP FINAL', score: '1:2', price: 30, have: 50, canAd: true }, { gems: vi.fn(), ad, no });
    const d = mounted();
    expect(d.innerHTML).toContain('WATCH AN AD');
    const adBtn = d.querySelector('[data-a=ad]')!;
    const noBtn = d.querySelector('[data-a=no]')!;
    adBtn.click();
    adBtn.dispatchEvent(new Event('click'));
    noBtn.dispatchEvent(new Event('click'));
    expect(ad).toHaveBeenCalledTimes(1);
    expect(no).not.toHaveBeenCalled();
    answer(false);
    await settle();
    expect(toasts()).toEqual(['NO AD RIGHT NOW, TRY LATER']);
    expect(adBtn.disabled).toBe(false);
    adBtn.click();
    expect(ad).toHaveBeenCalledTimes(2);
    answer(true);
    await settle();
    // (Played through: main.ts restarts the match; nothing more is said here.)
    expect(toasts()).toEqual(['NO AD RIGHT NOW, TRY LATER']);
    // With a blocker on and today's ad replay unused: switched off, with the reason.
    menus.replayOffer({ what: 'CUP FINAL', score: '1:2', price: 30, have: 50, canAd: false, adNote: 'ADBLOCKER DETECTED' }, { gems: vi.fn(), ad, no });
    expect(mounted().querySelector('[data-a=ad]')).toBeNull();
    expect(mounted().innerHTML).toMatch(/<button class="btn btn-yellow" disabled>.*ADBLOCKER DETECTED<\/button>/);
  });
});

describe('a portal build keeps the player in the game', () => {
  it('the About page has no mail link there, and keeps it everywhere else', () => {
    vi.stubEnv('DEV', false);
    for (const portal of ['crazygames', 'poki']) {
      vi.stubEnv('VITE_PORTAL', portal);
      const html = developerAboutHtml();
      expect(html).not.toContain('mailto:');
      expect(html).not.toContain('href=');
      expect(html).not.toContain('SEND FEEDBACK');
      expect(html).toContain('ABOUT THE DEVELOPER');
    }
    for (const build of ['none', '']) {
      vi.stubEnv('VITE_PORTAL', build);
      expect(developerAboutHtml()).toContain('href="mailto:');
    }
  });

  it('the dev server follows ?portal=, so the portal screens can be looked at without a build', () => {
    vi.stubEnv('VITE_PORTAL', '');
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { search: '?portal=crazygames' });
    expect(devPortal()).toBe(true);
    expect(developerAboutHtml()).not.toContain('mailto:');
    vi.stubGlobal('location', { search: '' });
    expect(devPortal()).toBe(false);
    expect(developerAboutHtml()).toContain('mailto:');
  });

  it('never looks for the app\'s native shell, whatever is on the page', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    vi.stubEnv('VITE_PORTAL', 'crazygames');
    expect(inNativeApp()).toBe(false);
    vi.stubEnv('VITE_PORTAL', 'none');
    expect(inNativeApp()).toBe(true);
  });

  it('no mail link, download, share sheet or app-store copy is reachable (each sits behind the literal build check)', () => {
    const portal = "import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki'";
    const menus = source('src/ui/menus.ts');
    const main = source('src/main.ts');
    const shop = source('src/ui/shop.ts');
    // Settings > MORE: no FEEDBACK row, and no handler behind it.
    expect(between(menus, 'data-pane="more"', '<p class="set-hint')).toContain(`\${${portal} || (import.meta.env.DEV && devPortal())\n                ? '' : '<button data-a="feedback"`);
    expect(menus).toContain(`if (!(${portal})) {\n      d.querySelector('[data-a=feedback]')`);
    // (One mail link in the file, and it is the one inside that check.)
    expect(menus.match(/`mailto:/g)).toHaveLength(1);
    expect(menus.indexOf('`mailto:')).toBeGreaterThan(menus.indexOf(`if (!(${portal})) {\n      d.querySelector('[data-a=feedback]')`));
    // BACKUP: not offered, and its screen (the export download) leaves at once.
    expect(main).toContain('backup: PORTAL || inNativeApp() ? undefined : backup,');
    expect(between(menus, '  backup(save: SaveData', 'const line = ')).toContain(`if (${portal}) {\n      h.back();\n      return;`);
    // Goal clips: no SAVE CLIP or SHARE.
    expect(main).toContain(`if (!(${portal} || (import.meta.env.DEV && devPortal()))) {\n  menus.clipActions = { save: saveClip, share: shareClip };`);
    expect(between(main, 'function clipOf(s: MatchSession)', 'if (!api.clipSupported')).toContain(`if (${portal} || (import.meta.env.DEV && devPortal())) return undefined;`);
    expect(between(menus, 'private clipRow(', 'return `<div class="clip-row')).toContain('if (!c || !this.clipActions) return');
    // The STORE: no OFFERS section (the app's products), no line about the app, a top-up or online play.
    expect(shop).toContain(`} else if (!(${portal}) && sec === 'offers') {`);
    expect(between(shop, 'const secs = STORE_SECS.filter(', 'const chips = ')).toContain(`!(${portal} || (import.meta.env.DEV && devPortal()))`);
    expect(shop).toContain("iap.storefront ? 'Earn them playing or buy a top-up.' : 'Earn them by playing.'");
    expect(shop).toContain(`${portal} || (import.meta.env.DEV && devPortal()) ? '' : ' Online friendlies use preset teams.'`);
    expect(shop.match(/IPHONE/g)).toHaveLength(1);
    expect(shop.indexOf('IPHONE')).toBeGreaterThan(shop.indexOf(`} else if (!(${portal}) && sec === 'offers') {`));
    expect(shop.indexOf('IPHONE')).toBeLessThan(shop.indexOf("} else if (sec === 'pass') {"));
  });

  it('the app\'s ad provider and Poki\'s SDK sit behind literal build checks in the adapter (a CrazyGames build drops both)', () => {
    const ads = source('src/platform/ads.ts');
    const app = "(!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'none') && this.portal === 'app'";
    const poki = "(!import.meta.env.VITE_PORTAL || import.meta.env.VITE_PORTAL === 'poki') && this.portal === 'poki'";
    expect(ads.match(/this\.portal === 'app'/g)).toHaveLength(ads.split(app).length - 1);
    expect(ads.match(/this\.portal === 'poki'/g)).toHaveLength(ads.split(poki).length - 1);
    for (const method of ['private prepareApp(kind: AppAd): void {', 'private showApp(kind: AppAd): Promise<boolean> {', 'private async initApp(): Promise<void> {']) {
      expect(between(ads, method, 'const ')).toContain("if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return");
    }
    // Every use of Poki's global is inside one of those checks or the literal-gated init branch.
    for (const line of ads.split('\n').filter((l) => l.includes('window.PokiSDK') && !l.trim().startsWith('if (window.PokiSDK &&'))) {
      expect(line.includes(poki) || /^\s*(return )?await withTimeout\(window\.PokiSDK!/.test(line), line.trim()).toBe(true);
    }
    const cloud = source('src/platform/cloud.ts');
    expect(cloud.match(/import\('\.\/nativeAuth'\)/g)).toHaveLength(2);
    expect(between(cloud, 'function nativeBridge()', "return import('./nativeAuth');")).toContain("if (import.meta.env.VITE_PORTAL && import.meta.env.VITE_PORTAL !== 'none') return Promise.reject(");
  });

  it('asks CrazyGames for no user token (its review): none in the source, none in the built bundle', () => {
    type Fs = { readdirSync(p: string, o: { recursive: true }): string[]; existsSync(p: string): boolean; readFileSync(p: string, e: 'utf8'): string };
    const fs = (process as unknown as { getBuiltinModule(id: 'node:fs'): Fs }).getBuiltinModule('node:fs');
    const hits = (dir: string, ext: RegExp): string[] => fs.readdirSync(dir, { recursive: true })
      .filter((f) => ext.test(f) && fs.readFileSync(`${dir}/${f}`, 'utf8').includes('getUserToken')).map((f) => `${dir}/${f}`);
    expect(hits('src', /\.ts$/)).toEqual([]);
    // The zip CrazyGames gets (npm run build:crazygames): checked whenever it has been built.
    if (fs.existsSync('dist-crazygames')) expect(hits('dist-crazygames', /\.(js|mjs|html)$/)).toEqual([]);
  });
});

describe('happytime is for the big moments only', () => {
  it('a big win, a trophy lifted, and a title or a promotion (once each)', () => {
    const calls = ['src/main.ts', 'src/ui/cup.ts', 'src/ui/career.ts'].map((f) => (source(f).match(/ads\.happyTime\(\)/g) ?? []).length);
    expect(calls).toEqual([1, 1, 1]);
    expect(source('src/main.ts')).toContain('if (my - their >= 3) ads.happyTime();');
    expect(between(source('src/ui/cup.ts'), 'export function cupTrophyScreen(', '\n}')).toContain('ads.happyTime();');
    const party = between(source('src/ui/career.ts'), "if (cls === 'champ' || cls === 'up') {", '// The board');
    expect(party).toContain('if (happySeason !== season.number) {');
    expect(party).toContain('ads.happyTime();');
  });
});

describe('the half-time break (2026-10-14: "perfect placement for ads")', () => {
  const due = { recovered: false, basics: false, firstMatch: false, moment: false, played: AD_FREE_MATCHES };

  it('is asked for at half time of an ordinary match once two matches are behind the player', () => {
    expect(halfBreakDue(due)).toBe(true);
    expect(halfBreakDue({ ...due, played: 40 })).toBe(true);
  });

  it('never in a drill, a moment, the first match or a restored match, and never before two matches are played', () => {
    expect(halfBreakDue({ ...due, basics: true })).toBe(false);
    expect(halfBreakDue({ ...due, moment: true })).toBe(false);
    expect(halfBreakDue({ ...due, firstMatch: true })).toBe(false);
    expect(halfBreakDue({ ...due, recovered: true })).toBe(false);
    expect(halfBreakDue({ ...due, played: AD_FREE_MATCHES - 1 })).toBe(false);
    expect(halfBreakDue({ ...due, played: 0 })).toBe(false);
  });

  it('a portal waits out its SDK\'s spacing: under the 3 minutes CrazyGames allows between interstitials, over a 2 minute half', () => {
    expect(PORTAL_HALF_GAP_MS).toBeLessThan(180_000);
    expect(PORTAL_HALF_GAP_MS).toBeGreaterThan(120_000);
  });
});
