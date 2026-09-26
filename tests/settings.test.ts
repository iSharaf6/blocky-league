import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_DEFAULTS, controlsOf, defaultSave, loadSave, normalizeSettings } from '../src/core/save';

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
