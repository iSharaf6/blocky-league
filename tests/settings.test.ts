import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYS, DEFAULT_PAD, actionKey, bindKey, bindPad, fillKeys, keyLabel, moveKeys, normalizeKeyMap, normalizePadMap, padLabel, remapKeys,
  setBindings, unbindKey,
} from '../src/core/input';
import { CONTROL_DEFAULTS, controlsOf, defaultSave, exportSave, importSave, loadSave, normalizeSettings, writeSave } from '../src/core/save';
import { PRESET_CLUBS } from '../src/meta/data';

const KEY = 'blocky-league-save-v1';

/** A minimal localStorage holding one stored save. */
function stubStorage(stored: unknown): void {
  const data = new Map<string, string>([[KEY, JSON.stringify(stored)]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings: controls', () => {
  it('every device starts on HIGH graphics; an old save on the phones\' old MEDIUM default moves up; a picked one stays', () => {
    // A phone (coarse pointer) as much as a desktop.
    for (const coarse of [true, false]) {
      vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
      expect(defaultSave().settings).toMatchObject({ quality: 'high', qualityPicked: false });
      stubStorage(null);
      expect(loadSave().settings.quality).toBe('high');
    }
    vi.stubGlobal('matchMedia', () => { throw new Error('unavailable'); });
    expect(defaultSave().settings.quality).toBe('high');
    // A save from before the flag, still on the old phone default: HIGH now.
    const old = { ...defaultSave().settings, quality: 'medium' } as Record<string, unknown>;
    delete old.qualityPicked;
    stubStorage({ ...defaultSave(), settings: old });
    expect(loadSave().settings).toMatchObject({ quality: 'high', qualityPicked: false });
    // ...but one on LOW chose it (no build ever started there): kept, and his from now on.
    stubStorage({ ...defaultSave(), settings: { ...old, quality: 'low' } });
    expect(loadSave().settings).toMatchObject({ quality: 'low', qualityPicked: true });
    // Picked in Settings: kept, whatever it is, through an export too.
    stubStorage({ ...defaultSave(), settings: { ...defaultSave().settings, quality: 'medium', qualityPicked: true } });
    const picked = loadSave();
    expect(picked.settings.quality).toBe('medium');
    expect(importSave(exportSave(picked))!.settings).toMatchObject({ quality: 'medium', qualityPicked: true });
    // Never picked: HIGH, whatever is stored.
    expect(normalizeSettings({ quality: 'low', qualityPicked: false }).quality).toBe('high');
    expect(normalizeSettings({ quality: 'medium', qualityPicked: 'yes' }).quality).toBe('high');
  });

  it('new saves start on the default controls (ground assisted, through assisted, switches on)', () => {
    const s = defaultSave().settings;
    expect(controlsOf(s)).toEqual({
      groundAssist: 'assisted', throughAssist: 'assisted', autoSwitch: true, moveAssist: true, timedFinish: true, trainer: true, quickPass: true,
      autoSprint: true, vibration: 'full',
    });
    expect(controlsOf(s)).toEqual(CONTROL_DEFAULTS);
  });

  it('an old save without the control settings gets the defaults and keeps everything else', () => {
    const old = defaultSave();
    const settings = { ...old.settings } as Record<string, unknown>;
    for (const k of ['groundAssist', 'throughAssist', 'moveAssist', 'timedFinish', 'camZoom', 'trainer', 'quickPass']) delete settings[k];
    settings.autoSwitch = false;
    settings.music = false;
    stubStorage({ ...old, coins: 1234, settings });
    const d = loadSave();
    expect(d.coins).toBe(1234);
    expect(d.settings.music).toBe(false);
    expect(d.settings.autoSwitch).toBe(false);
    expect(d.settings.groundAssist).toBe('assisted');
    expect(d.settings.throughAssist).toBe('assisted');
    expect(d.settings.moveAssist).toBe(true);
    expect(d.settings.timedFinish).toBe(true);
    expect(d.settings.camZoom).toBe('normal');
    expect(d.settings.trainer).toBe(true);
    expect(d.settings.quickPass).toBe(true);
  });

  it('unknown or mistyped values become the defaults; valid ones are kept', () => {
    const s = normalizeSettings({
      groundAssist: 'turbo', throughAssist: 'manual', moveAssist: 'yes', timedFinish: 0, autoSwitch: null, camZoom: 'fisheye',
    });
    expect(s.groundAssist).toBe('assisted');
    expect(s.throughAssist).toBe('manual');
    expect(s.moveAssist).toBe(true);
    expect(s.timedFinish).toBe(true);
    expect(s.autoSwitch).toBe(true);
    expect(s.camZoom).toBe('normal');
    expect(normalizeSettings({ groundAssist: 'manual', timedFinish: false }).groundAssist).toBe('manual');
    expect(normalizeSettings({ groundAssist: 'manual', timedFinish: false }).timedFinish).toBe(false);
  });

  it('AUTO SPRINT on unless switched off; VIBRATION OFF / LIGHT / FULL (FULL by default); junk becomes the default', () => {
    expect(controlsOf(normalizeSettings({}))).toMatchObject({ autoSprint: true, vibration: 'full' });
    expect(controlsOf(normalizeSettings({ autoSprint: false, vibration: 'light' }))).toMatchObject({ autoSprint: false, vibration: 'light' });
    expect(normalizeSettings({ vibration: 'off' }).vibration).toBe('off');
    // (A build that had it as a switch: off stays off, on is FULL.)
    expect(normalizeSettings({ vibration: false }).vibration).toBe('off');
    expect(normalizeSettings({ vibration: true }).vibration).toBe('full');
    expect(normalizeSettings({ autoSprint: 'yes', vibration: 0 })).toMatchObject({ autoSprint: true, vibration: 'full' });
  });

  it('a damaged settings blob still loads', () => {
    stubStorage({ ...defaultSave(), settings: 'garbage' });
    expect(controlsOf(loadSave().settings)).toEqual(CONTROL_DEFAULTS);
    expect(controlsOf(normalizeSettings(null))).toEqual(CONTROL_DEFAULTS);
  });

  it('repairs damaged audio, graphics and match settings before starting a match', () => {
    expect(normalizeSettings({ sfx: 'yes', music: null, crowd: 1, quality: 'ultra', difficulty: 999, halfMinutes: 'forever', weather: 'hail', timeOfDay: 'dawn' }))
      .toMatchObject({ sfx: true, music: true, crowd: true, quality: 'high', difficulty: 1, halfMinutes: 2, weather: 'random', timeOfDay: 'random' });
    for (const halfMinutes of [0, -1, NaN, Infinity, 10000]) expect(normalizeSettings({ halfMinutes }).halfMinutes).toBe(2);
    expect(normalizeSettings({ sfx: false, music: false, crowd: false, quality: 'low', difficulty: 0, halfMinutes: 1.5, weather: 'snow', timeOfDay: 'night' }))
      .toMatchObject({ sfx: false, music: false, crowd: false, quality: 'low', difficulty: 0, halfMinutes: 1.5, weather: 'snow', timeOfDay: 'night' });
  });

  it('trainer and instant-pass preferences survive saving, including explicit OFF', () => {
    const saved = defaultSave();
    saved.seenTutorial = true;
    saved.settings.trainer = false;
    saved.settings.quickPass = false;
    stubStorage(saved);
    expect(controlsOf(loadSave().settings)).toMatchObject({ trainer: false, quickPass: false });
    expect(normalizeSettings({ trainer: 'false', quickPass: 0 })).toMatchObject({ trainer: true, quickPass: true });
  });
});

describe('save backup (Settings > BACKUP)', () => {
  it('repairs corrupt local saves with the same rules as imported backups', () => {
    const damaged = {
      ...defaultSave(), coins: -5, clubIdx: PRESET_CLUBS.length, opponentIdx: -2, seenTutorial: 'true',
      record: { played: 'many', won: -1, drawn: 2.9, lost: null, goalsFor: 10, goalsAgainst: 'none' },
      gift: { last: '2026-09-20', streak: 'seven' }, updatedAt: 'not a date', career: [], cup: [],
    };
    stubStorage(damaged);
    const loaded = loadSave();
    const imported = importSave(damaged)!;
    expect(loaded).toMatchObject({ coins: 500, clubIdx: 5, opponentIdx: 6, seenTutorial: false, career: null, cup: null });
    expect(loaded.record).toEqual({ played: 0, won: 0, drawn: 2, lost: 0, goalsFor: 10, goalsAgainst: 0 });
    expect(loaded.gift).toEqual({ last: '2026-09-20', streak: 1 });
    expect(Number.isFinite(Date.parse(loaded.updatedAt))).toBe(true);
    expect(imported).toMatchObject({ coins: loaded.coins, clubIdx: loaded.clubIdx, opponentIdx: loaded.opponentIdx, record: loaded.record });
    stubStorage({ ...defaultSave(), clubIdx: 6, opponentIdx: 6 });
    expect(loadSave().opponentIdx).not.toBe(6);
  });

  it('keeps play working when browser storage is blocked or full', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } });
    expect(loadSave().coins).toBe(500);
    const save = defaultSave();
    save.coins = 777;
    expect(() => writeSave(save)).not.toThrow();
    expect(save.coins).toBe(777);
  });
  it('an exported save imports back whole, with the settings and progress it had', () => {
    const s = defaultSave();
    s.coins = 4321;
    s.record.played = 12;
    s.settings.difficulty = 2;
    s.settings.ballSkin = 'retro';
    s.settings.celebration = 'knee';
    s.progress.xp = 555;
    s.career = { club: { name: 'Test FC' } };
    const back = importSave(exportSave(s))!;
    expect(back).not.toBeNull();
    expect(back.coins).toBe(4321);
    expect(back.record.played).toBe(12);
    expect(back.settings.difficulty).toBe(2);
    expect(back.settings.ballSkin).toBe('retro');
    expect(back.settings.celebration).toBe('knee');
    expect(back.progress.xp).toBe(555);
    expect(back.career).toEqual({ club: { name: 'Test FC' } });
    expect(back.updatedAt).toBe(s.updatedAt);
  });

  it('refuses anything that is not a Blocky League save, without throwing', () => {
    expect(importSave('not json')).toBeNull();
    expect(importSave('[1,2,3]')).toBeNull();
    expect(importSave({ hello: 'world' })).toBeNull();
    expect(importSave({ version: 2, coins: 1, settings: {} })).toBeNull();
    expect(importSave({ version: 1, coins: 'lots', settings: {} })).toBeNull();
    expect(importSave({ version: 1, coins: 10 })).toBeNull();
    expect(importSave(null)).toBeNull();
  });

  it('a save from an older build, or a hand-edited one, is made whole: defaults fill the gaps and bad values are dropped', () => {
    const got = importSave({ version: 1, coins: -5, clubIdx: 'x', settings: { camZoom: 'huge', ballSkin: 'platinum', lastMode: 'turbo' }, record: { played: 3 }, gift: { last: '2026-09-20', streak: 2 } })!;
    expect(got).not.toBeNull();
    expect(got.coins).toBe(500);
    expect(got.clubIdx).toBe(defaultSave().clubIdx);
    expect(got.settings.camZoom).toBe('normal');
    expect(got.settings.ballSkin).toBeUndefined();
    expect(got.settings.lastMode).toBe('classic');
    expect(got.settings.sfx).toBe(true);
    expect(got.record).toEqual({ played: 3, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
    expect(got.progress.xp).toBe(0);
    expect(got.gift).toEqual({ last: '2026-09-20', streak: 2 });
    expect(got.cup).toBeNull();
    expect(got.career).toBeNull();
    expect(typeof got.updatedAt).toBe('string');
  });
});

describe('save backup: football moments', () => {
  it('moment stars survive an export / import round trip, and a damaged moments blob imports as empty', () => {
    const d = defaultSave();
    d.moments = { cross: 3, hold: 1 };
    const back = importSave(exportSave(d));
    expect(back?.moments).toEqual({ cross: 3, hold: 1 });
    const raw = JSON.parse(exportSave(d)) as Record<string, unknown>;
    raw.moments = [3, 1];
    expect(importSave(JSON.stringify(raw))?.moments).toEqual({});
    delete raw.moments;
    expect(importSave(JSON.stringify(raw))?.moments).toEqual({});
  });
});

describe('settings: ROAD TO GLORY intro flag', () => {
  it('starts unseen, survives a round trip, and a damaged value reads as unseen', () => {
    expect(defaultSave().settings.roadIntroSeen).toBe(false);
    expect(normalizeSettings({}).roadIntroSeen).toBe(false);
    expect(normalizeSettings({ roadIntroSeen: true }).roadIntroSeen).toBe(true);
    expect(normalizeSettings({ roadIntroSeen: 'yes' }).roadIntroSeen).toBe(false);
    const s = defaultSave();
    s.settings.roadIntroSeen = true;
    expect(importSave(exportSave(s))!.settings.roadIntroSeen).toBe(true);
  });
});

describe('settings: the commentator (text stays, the voice is gone)', () => {
  it('an old save with the voice switch loads fine: the switch is dropped, the ticker setting kept', () => {
    const old = { ...defaultSave(), settings: { ...defaultSave().settings, commentary: false, commentaryVoice: true } };
    stubStorage(old);
    const d = loadSave();
    expect(d.settings.commentary).toBe(false);
    expect('commentaryVoice' in d.settings).toBe(false);
    expect(normalizeSettings({ commentary: 'loud' }).commentary).toBe(true);
    expect('commentaryVoice' in defaultSave().settings).toBe(false);
  });
});

describe('settings: key bindings (Settings > Controls > KEYS)', () => {
  afterEach(() => setBindings());

  it('new saves have every default key; a damaged or partial map is made whole', () => {
    const s = defaultSave().settings;
    expect(s.keys).toEqual(normalizeKeyMap(DEFAULT_KEYS));
    expect(s.pad).toEqual(normalizePadMap(DEFAULT_PAD));
    expect(s.stick).toBe('floating');
    expect(s.colorblind).toBe(false);
    const k = normalizeKeyMap({ pass: ['KeyK', 42, 'KeyQ'], shoot: 'nope' });
    // K went to PASS first, so SHOOT (not a list) falls back to its default keys still free.
    expect(k.pass).toEqual(['KeyK', 'KeyQ']);
    expect(k.shoot).toEqual(['KeyX']);
    expect(k.up).toEqual(['KeyW', 'ArrowUp']);
    // No code is ever bound twice, and at most three a action.
    const all = Object.values(normalizeKeyMap({ pass: ['Space', 'Space', 'KeyA', 'KeyB', 'KeyC', 'KeyD'] })).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(normalizeKeyMap({ pass: ['KeyQ', 'KeyR', 'KeyT', 'KeyY'] }).pass.length).toBe(3);
    // Right-hand modifiers count as the left ones.
    expect(normalizeKeyMap({ sprint: ['ShiftRight'] }).sprint).toEqual(['ShiftLeft']);
    expect(normalizePadMap({ pass: [12, 3], power: [] }).pass).toEqual([3]);
    expect(normalizeSettings({ stick: 'wobbly', colorblind: 'yes' })).toMatchObject({ stick: 'floating', colorblind: false });
  });

  it('a key already in use swaps over; the other action keeps a key', () => {
    const r = bindKey(DEFAULT_KEYS, 'pass', 0, 'KeyK');
    expect(r.swapped).toBe('shoot');
    expect(r.map.pass[0]).toBe('KeyK');
    expect(r.map.shoot).toContain('Space');
    expect(r.map.shoot).not.toContain('KeyK');
    // A slot's old key goes to the action that gave its key up (Z for X here)...
    const r2 = bindKey(DEFAULT_KEYS, 'pass', 2, 'KeyX');
    expect(r2.map.pass).toEqual(['Space', 'KeyJ', 'KeyX']);
    expect(r2.map.shoot).toEqual(['KeyK', 'KeyZ']);
    // ...and an empty slot taking another action's key just takes it (that action has others).
    const r2b = bindKey(DEFAULT_KEYS, 'shoot', 2, 'KeyJ');
    expect(r2b.map.shoot).toEqual(['KeyK', 'KeyX', 'KeyJ']);
    expect(r2b.map.pass).toEqual(['Space', 'KeyZ']);
    // ...but never its only key.
    const lonely = { ...normalizeKeyMap(DEFAULT_KEYS), shoot: ['KeyK'] };
    const r3 = bindKey({ ...lonely, pass: ['Space'] }, 'pass', 1, 'KeyK');
    expect(r3.refused).toBe('last');
    expect(r3.map.shoot).toEqual(['KeyK']);
    // Reserved keys can't be bound; clearing never leaves an action keyless.
    expect(bindKey(DEFAULT_KEYS, 'pass', 0, 'Tab').refused).toBe('reserved');
    expect(unbindKey({ ...lonely }, 'shoot', 0).shoot).toEqual(['KeyK']);
    // Gamepad: the same rule; the d-pad is reserved.
    const p = bindPad(DEFAULT_PAD, 'pass', 0, 1);
    expect(p.swapped).toBe('shoot');
    expect(p.map.shoot).toEqual([0]);
    expect(bindPad(DEFAULT_PAD, 'pass', 0, 12).refused).toBe('reserved');
  });

  it('every on-screen key name reads the bindings in force', () => {
    expect(keyLabel('KeyK')).toBe('K');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(keyLabel('ShiftRight')).toBe('SHIFT');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(padLabel(0)).toBe('A');
    expect(padLabel(7)).toBe('RT');
    expect(actionKey('pass', 'keyboard')).toBe('SPACE');
    expect(moveKeys('keyboard')).toBe('WASD / ARROWS');
    // Unchanged bindings: the session's default hints pass through untouched.
    expect(remapKeys('SPACE short · hold L to whip it in · K = driven cross', 'keyboard')).toBe('SPACE short · hold L to whip it in · K = driven cross');
    const km = bindKey(bindKey(DEFAULT_KEYS, 'pass', 0, 'KeyK').map, 'up', 0, 'KeyI');
    setBindings(km.map, DEFAULT_PAD);
    expect(actionKey('pass', 'keyboard')).toBe('K');
    expect(actionKey('shoot', 'keyboard')).toBe('SPACE');
    expect(moveKeys('keyboard')).toBe('IASD / ARROWS');
    // One pass: SPACE and K swapped places without chaining; KICK is a word, not a key.
    expect(remapKeys('SPACE short · KICK OFF · K = driven cross · move with WASD / ARROWS', 'keyboard')).toBe('K short · KICK OFF · SPACE = driven cross · move with IASD / ARROWS');
    expect(fillKeys('SHOOT ({shoot}) and PASS ({pass})', 'keyboard')).toBe('SHOOT (SPACE) and PASS (K)');
    expect(fillKeys('SHOOT ({shoot}) now', 'touch')).toBe('SHOOT now');
    setBindings(DEFAULT_KEYS, bindPad(DEFAULT_PAD, 'shoot', 0, 3).map);
    expect(actionKey('shoot', 'gamepad')).toBe('Y');
    expect(remapKeys('Aim · hold B to strike', 'gamepad')).toBe('Aim · hold Y to strike');
  });

  it('bindings and the touch / colour-blind options survive an export / import round trip', () => {
    const s = defaultSave();
    s.settings.keys = bindKey(s.settings.keys!, 'pass', 0, 'KeyQ').map;
    s.settings.stick = 'fixed';
    s.settings.colorblind = true;
    const back = importSave(exportSave(s))!;
    expect(back.settings.keys!.pass[0]).toBe('KeyQ');
    expect(back.settings.stick).toBe('fixed');
    expect(back.settings.colorblind).toBe(true);
  });
});

describe('settings: text size (menus and HUD only)', () => {
  it('new saves are MEDIUM (the designed size); old saves without it load as MEDIUM', () => {
    expect(defaultSave().settings.textSize).toBe('medium');
    const old = { ...defaultSave().settings } as Record<string, unknown>;
    delete old.textSize;
    expect(normalizeSettings(old).textSize).toBe('medium');
  });

  it('keeps SMALL and LARGE; anything else becomes MEDIUM', () => {
    for (const ok of ['small', 'medium', 'large'] as const) expect(normalizeSettings({ ...defaultSave().settings, textSize: ok }).textSize).toBe(ok);
    for (const bad of ['huge', 3, null, true, 'LARGE']) expect(normalizeSettings({ ...defaultSave().settings, textSize: bad }).textSize).toBe('medium');
  });

  it('survives an export / import round trip', () => {
    const s = defaultSave();
    s.settings.textSize = 'large';
    expect(importSave(exportSave(s))!.settings.textSize).toBe('large');
  });

  it('the Settings row cycles MEDIUM, LARGE, SMALL, and puts a class on the page (MEDIUM: none)', async () => {
    const { applyTextSize, nextTextSize, TEXT_SIZE_LABEL } = await import('../src/ui/textSize');
    expect(nextTextSize('medium')).toBe('large');
    expect(nextTextSize('large')).toBe('small');
    expect(nextTextSize('small')).toBe('medium');
    expect(nextTextSize(undefined)).toBe('large');
    expect(TEXT_SIZE_LABEL.small).toBe('SMALL');
    const classes = new Set<string>();
    vi.stubGlobal('document', { documentElement: { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } } });
    applyTextSize('large');
    expect([...classes]).toEqual(['ts-large']);
    applyTextSize('small');
    expect([...classes]).toEqual(['ts-small']);
    applyTextSize('medium');
    expect([...classes]).toEqual([]);
  });
});
