import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { DEFAULT_KEYS, DEFAULT_PAD, setBindings, type Device } from '../src/core/input';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS, MOMENTS } from '../src/meta/moments';
import { POWER_INFO } from '../src/ui/commentary';
import { ICONS, ICON_NAMES } from '../src/ui/pixelIcons';
import { Match } from '../src/sim/match';
import type { RestartKind } from '../src/sim/types';
import {
  coachText, cueOfText, defendCue, diveCue, keeperCue, moveCue, passCue, penaltyCue, restartCue, type CoachCue,
} from '../src/ui/coach';
import { lessonCue, trainerCue } from '../src/ui/trainer';

// This game typechecks against browser types; the copy checks read the source with Node 22+.
declare const process: {
  getBuiltinModule(id: 'node:fs'): {
    readFileSync(path: string, enc: 'utf8'): string;
    readdirSync(path: string): string[];
    statSync(path: string): { isDirectory(): boolean };
  };
  getBuiltinModule(id: 'node:path'): { join(...paths: string[]): string };
  cwd(): string;
};
const { readFileSync, readdirSync, statSync } = process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');

/**
 * The owner's taste, enforced: no middle dot, bullet or dash between facts in anything a player can read (they
 * render as fat fallback blobs or long bars in the pixel face). Separators are the styled divider (ui/text.ts
 * sep() / SEP_MARK), a line break, or plain words. And no typewriter face behind the pixel one.
 */
const FORBIDDEN = /[·•●—–]/;

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, ext));
    else if (ext.test(name)) out.push(path);
  }
  return out;
}

/** Every string and template literal in a TS file (comments and regular expressions are not copy). */
function literals(path: string): { text: string; line: number }[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { text: string; line: number }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ text: n.text, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    n.forEachChild(visit);
  };
  visit(src);
  return out;
}

const root = process.cwd();
/** Parsing every source file is the slow part (a loaded machine: give it room), so it happens once. */
const SCAN_MS = 60_000;
let parsed: { file: string; text: string; line: number }[] | null = null;
function allLiterals(): { file: string; text: string; line: number }[] {
  parsed ??= files(join(root, 'src'), /\.ts$/).flatMap((f) => literals(f).map((l) => ({ file: f.slice(root.length + 1), ...l })));
  return parsed;
}

describe('user-visible copy: separators and fonts', () => {
  it('no string in src/ writes a dot, bullet or dash as a separator', () => {
    const hits = allLiterals().filter((l) => FORBIDDEN.test(l.text)).map((l) => `${l.file}:${l.line} ${JSON.stringify(l.text)}`);
    expect(hits).toEqual([]);
  }, SCAN_MS);

  it('no stylesheet draws one with content:, and no font stack falls back to a typewriter face', () => {
    const bad: string[] = [];
    const sheets = [...files(join(root, 'src'), /\.css$/), join(root, 'index.html')];
    for (const f of sheets) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/content:\s*(['"])(.*?)\1/g)) if (FORBIDDEN.test(m[2])) bad.push(`${f}: content ${m[2]}`);
      for (const m of text.matchAll(/[^\n]*\b(monospace|Courier)\b[^\n]*/gi)) if (!/^\s*(\/\*|\*|\/\/)/.test(m[0])) bad.push(`${f}: ${m[0].trim()}`);
    }
    for (const l of allLiterals()) if (/\b(monospace|Courier)\b/i.test(l.text)) bad.push(`${l.file}:${l.line} ${l.text}`);
    expect(bad).toEqual([]);
  }, SCAN_MS);
});

/**
 * No emoji either: they come from each platform's own set and read as AI slop beside the chunky pixel look. Every
 * icon is a pixel icon (ui/pixelIcons.ts). Plain typographic glyphs stay: ★ (match stars), ✓, ✕, and the arrows
 * ← → ↑ ↓. (★ is the only one of those the pictograph class also holds, so it is the one allowed through.)
 */
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}]/u;
const ALLOWED_GLYPHS = new Set(['★']);
const emojiIn = (text: string): string[] => [...text].filter((c) => PICTOGRAPH.test(c) && !ALLOWED_GLYPHS.has(c));

describe('user-visible copy: pixel icons, no emoji', () => {
  it('no string in src/ holds an emoji or pictograph', () => {
    const hits = allLiterals().filter((l) => emojiIn(l.text).length).map((l) => `${l.file}:${l.line} ${JSON.stringify(l.text)}`);
    expect(hits).toEqual([]);
  }, SCAN_MS);

  it('no stylesheet draws one with content:, and the page shell has none', () => {
    const bad: string[] = [];
    for (const f of [...files(join(root, 'src'), /\.css$/), join(root, 'index.html')]) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/content:\s*(['"])(.*?)\1/g)) if (emojiIn(m[2]).length) bad.push(`${f}: content ${m[2]}`);
      if (f.endsWith('.html') && emojiIn(text).length) bad.push(`${f}: ${emojiIn(text).join('')}`);
    }
    expect(bad).toEqual([]);
  });

  it('every pixel icon is a 10 by 10 grid, and every icon a moment, a step or a power-up names exists', () => {
    for (const name of ICON_NAMES) {
      const rows = ICONS[name];
      expect(rows.length, name).toBe(10);
      for (const r of rows) expect(r, name).toMatch(/^[X.]{10}$/);
      expect(rows.join(''), name).toContain('X');
    }
    for (const mo of MOMENTS) expect(ICONS[mo.icon], `moment ${mo.id}`).toBeDefined();
    for (const b of BASICS) expect(ICONS[b.icon], `basics ${b.id}`).toBeDefined();
    for (const [kind, info] of Object.entries(POWER_INFO)) expect(ICONS[info.icon], `power-up ${kind}`).toBeDefined();
  });
});

describe('user-visible copy: the mode is ROAD TO GLORY', () => {
  it('no visible label or sentence in src/ still calls it CAREER', () => {
    const hits = allLiterals().filter((l) => /\bCAREER\b/.test(l.text)).map((l) => `${l.file}:${l.line} ${JSON.stringify(l.text)}`);
    expect(hits).toEqual([]);
  }, SCAN_MS);
});

// ------------------------------------------------------------------ the coach's words (ui/coach.ts, ui/trainer.ts)

const DEVICES: Device[] = ['keyboard', 'gamepad', 'touch'];
const KINDS: RestartKind[] = ['kickoff', 'throwin', 'corner', 'goalkick', 'freekick', 'penalty'];

function match(): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 600, difficulty: 0.6, humanSide: 0, seed: 1, assist: 0.8 });
}

/** Every card the trainer, the hints and the tips can show, per device (the trainer's in each situation it names). */
function everyCue(device: Device): CoachCue[] {
  const cues: CoachCue[] = [
    ...KINDS.map((k) => restartCue(k, device)), penaltyCue(device), diveCue(device), keeperCue(device),
    moveCue(device), passCue(device), defendCue(device),
    ...BASICS.flatMap((b) => b.lesson.map((lc) => lessonCue(lc, device))),
  ];
  const m = match();
  const p = m.players[m.active];
  m.ball.owner = p.idx;
  cues.push(trainerCue(m, device));
  m.shootCharge = 0.3;
  m.timedFinish = true;
  cues.push(trainerCue(m, device));
  m.shootCharge = 0;
  m.passMode = 'lob';
  m.throughCharge = 0.1;
  cues.push(trainerCue(m, device));
  m.throughCharge = 0.4;
  cues.push(trainerCue(m, device));
  m.throughCharge = 0;
  m.ball.held = true;
  cues.push(trainerCue(m, device));
  m.ball.held = false;
  m.ball.owner = -1;
  m.passTarget = p.idx;
  cues.push(trainerCue(m, device));
  m.passTarget = -1;
  m.ball.owner = m.players.find((q) => q.side === 1 && !q.isKeeper)!.idx;
  cues.push(trainerCue(m, device));
  m.ball.owner = m.players.find((q) => q.side === 0 && q.idx !== p.idx && !q.isKeeper)!.idx;
  cues.push(trainerCue(m, device));
  return cues;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('the coach card copy', () => {
  afterEach(() => setBindings());

  it.each(DEVICES)('is short, in capitals up top, separator free and device-correct (%s)', (device) => {
    for (const cue of everyCue(device)) {
      const all = [cue.title, ...cue.actions.flat(), cue.detail ?? ''].join(' ');
      expect(all, all).not.toMatch(FORBIDDEN);
      expect(all, all).not.toMatch(/[|{}]/);
      // A title is 1 to 3 words in capitals, never hyphenated (the pixel face's hyphen is a bar).
      expect(cue.title, cue.title).toMatch(/^[A-Z' ]+$/);
      expect(words(cue.title)).toBeLessThanOrEqual(3);
      expect(cue.actions.length).toBeGreaterThan(0);
      expect(cue.actions.length).toBeLessThanOrEqual(3);
      for (const [, label] of cue.actions) expect(words(label), label).toBeLessThanOrEqual(7);
      if (cue.detail) expect(words(cue.detail), cue.detail).toBeLessThanOrEqual(7);
      // "Tap" is touch's word; keys and pads are pressed. (Lower-case "press" is the defending one: "Hold to press".)
      if (device === 'touch') expect(all, all).not.toMatch(/\bPress\b/);
      else expect(all, all).not.toMatch(/\b[Tt]ap\b/);
    }
  });

  it('names the player\'s own keys, the pad buttons, and the touch button on screen', () => {
    expect(restartCue('corner', 'keyboard').actions.map((a) => a[0])).toEqual(['SPACE', 'L', 'K']);
    expect(restartCue('corner', 'gamepad').actions.map((a) => a[0])).toEqual(['A', 'X', 'B']);
    // At a set piece the through button reads CROSS on a touch screen; defending, SWITCH / TACKLE / PRESS.
    expect(restartCue('corner', 'touch').actions.map((a) => a[0])).toEqual(['PASS', 'CROSS', 'SHOOT']);
    expect(defendCue('touch').actions.map((a) => a[0])).toEqual(['TACKLE', 'PRESS', 'SWITCH']);
    setBindings({ ...DEFAULT_KEYS, pass: ['KeyJ'], through: ['KeyU'] }, { ...DEFAULT_PAD, pass: [3] });
    expect(restartCue('goalkick', 'keyboard').actions.map((a) => a[0])).toEqual(['J', 'U']);
    expect(restartCue('kickoff', 'gamepad').actions[0][0]).toBe('Y');
  });

  it('a loose ball on touch names SWITCH, the label the button wears then (not PASS)', () => {
    const m = match();
    m.ball.owner = -1;
    m.passTarget = -1;
    const cue = trainerCue(m, 'touch');
    if (!m.canStrikeLoose()) expect(cue.actions.map((a) => a[0])).toContain('SWITCH');
  });

  it('a lesson line and a moment tip say "tap" on touch and "press" on keys and pads', () => {
    const finish = BASICS[2].lesson[1];
    expect(lessonCue(finish, 'touch').actions[0][1]).toBe('Tap as the cross arrives');
    expect(lessonCue(finish, 'keyboard').actions[0][1]).toBe('Press as the cross arrives');
    for (const mo of MOMENTS) {
      expect(coachText(mo.tip, 'keyboard')).not.toMatch(/\b[Tt]ap\b|\{[Tt]ap\}/);
      expect(coachText(mo.tip, 'touch')).not.toMatch(/\{[Tt]ap\}/);
    }
  });

  it('plain-text hints (any new hint) draw as the same card: the key a cap, the rest the words', () => {
    expect(cueOfText('SPACE to kick off', 'keyboard')).toEqual({ title: '', actions: [['SPACE', 'Kick off']] });
    expect(cueOfText('hold L to whip it in\nK = driven cross', 'keyboard').actions).toEqual([['L', 'Hold to whip it in'], ['K', 'Driven cross']]);
    expect(cueOfText('Tap PASS to switch', 'touch').actions).toEqual([['PASS', 'Tap to switch']]);
    expect(cueOfText('Keep it moving', 'gamepad').actions).toEqual([['', 'Keep it moving']]);
  });
});
