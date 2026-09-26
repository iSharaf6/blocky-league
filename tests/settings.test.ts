import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_DEFAULTS, controlsOf, defaultSave, exportSave, importSave, loadSave, normalizeSettings } from '../src/core/save';

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
  it('new saves start on the default controls (ground assisted, through assisted, switches on)', () => {
    const s = defaultSave().settings;
    expect(controlsOf(s)).toEqual({ groundAssist: 'assisted', throughAssist: 'assisted', autoSwitch: true, moveAssist: true, timedFinish: true, trainer: true, quickPass: true });
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

  it('a damaged settings blob still loads', () => {
    stubStorage({ ...defaultSave(), settings: 'garbage' });
    expect(controlsOf(loadSave().settings)).toEqual(CONTROL_DEFAULTS);
    expect(controlsOf(normalizeSettings(null))).toEqual(CONTROL_DEFAULTS);
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
    const got = importSave({ version: 1, coins: -5, clubIdx: 'x', settings: { camZoom: 'huge', ballSkin: 'diamond', lastMode: 'turbo' }, record: { played: 3 }, gift: { last: '2026-09-20', streak: 2 } })!;
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
