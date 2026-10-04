/**
 * The match's music, as note tables for the chiptune sequencer in sfx.ts (Sfx.schedule / playStep). All of it is in
 * the menu loop's key family (C major and its relatives) and on the same instruments: a triangle bass, a square
 * arpeggio, a square or triangle lead, noise hats and snare; the fanfares add a "brass" voice (detuned saws through
 * an opening low-pass) and a soft kick. The menu loop (MENU) is the owner's favourite and is kept note for note.
 *
 * Grid: every step is an eighth note at the track's bpm; a bar is 8 steps; `roots` and `minor` are per bar.
 *
 * - lead: a MIDI note per step, -1 a rest, -2 holds the note before (a tie).
 * - bass / arp: semitones over the bar's root (the arp an octave up), cycled; -1 a rest. On a minor bar the arp's
 *   major thirds (4, 16) drop to minor ones.
 * - drums: one character per step, cycled: k kick, s snare, h hat, x snare and hat, r a snare roll (two taps),
 *   c a crash, - nothing.
 * - brass: chord stabs on the bar's chord, as [step, length in steps].
 */

export type TrackId = 'menu' | 'halftime' | 'win' | 'draw' | 'loss';
export type StingId = 'kickoff' | 'goal' | 'trophy' | 'promotion';

export interface Track {
  bpm: number;
  /** Length in steps (eighth notes). */
  steps: number;
  roots: readonly number[];
  minor?: readonly boolean[];
  bass: readonly number[];
  bassLevel: number;
  /** Bass note length, in steps. */
  bassLen: number;
  arp: readonly number[];
  arpLevel: number;
  lead: readonly number[];
  /** The lead comes in from this step of the song (the menu: its second time round). */
  leadFrom?: number;
  leadType: 'square' | 'triangle' | 'brass';
  leadLevel: number;
  drums: string;
  /** Scale on every drum hit. */
  drumLevel?: number;
  brass?: readonly (readonly [number, number])[];
  brassLevel?: number;
}

/** A song: an optional intro played once, then its loop for as long as the screen is up. */
export interface Song {
  intro?: Track;
  loop: Track;
  /** The song's gain under the music bus (the menu: 1). */
  level: number;
}

export const midiHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

const R = -1;
const H = -2;

/** The menu loop: I vi IV V in C, bouncy (unchanged: the owner likes it). */
const MENU_LOOP: Track = {
  bpm: 132,
  steps: 32,
  roots: [48, 45, 41, 43],
  bass: [0, R],
  bassLevel: 0.28,
  bassLen: 1.6,
  arp: [0, 7, 12, 16, 12, 7, 4, 7],
  arpLevel: 0.05,
  lead: [
    76, R, 79, 76, 74, R, 72, R,
    72, R, 76, 72, 69, R, 67, R,
    69, R, 72, 69, 65, R, 69, 72,
    71, R, 74, 71, 67, 71, 74, 79,
  ],
  leadFrom: 32,
  leadType: 'square',
  leadLevel: 0.06,
  drums: '-h-hsh-h',
};
export const MENU: Song = { loop: MENU_LOOP, level: 1 };

/** HALF TIME: a short, upbeat loop (IV V iii vi, then home to C) with a proper kick and snare under it. */
const HALFTIME: Song = {
  level: 0.95,
  loop: {
    bpm: 144,
    steps: 64,
    roots: [41, 43, 40, 45, 41, 43, 48, 48],
    minor: [false, false, true, true, false, false, false, false],
    bass: [0, R, 12, R, 0, 0, 12, R],
    bassLevel: 0.25,
    bassLen: 0.9,
    arp: [0, 4, 7, 12, 7, 4, 12, 16],
    arpLevel: 0.04,
    lead: [
      72, R, 74, 72, 69, R, 72, R,
      71, R, 74, 71, 67, R, 71, 74,
      76, R, 79, 76, 74, R, 71, R,
      72, R, 76, R, 69, H, H, R,
      77, R, 76, R, 74, R, 72, R,
      74, R, 72, R, 71, R, 67, R,
      72, 74, 76, 79, 84, H, 79, R,
      76, R, 72, R, 67, H, H, R,
    ],
    leadType: 'square',
    leadLevel: 0.055,
    drums: 'khshkhsh',
    drumLevel: 0.9,
  },
};

/** The victory fanfare: ta, ta-ta TAAA, up through G to the top C, timpani and a crash. */
const WIN_FANFARE: Track = {
  bpm: 132,
  steps: 24,
  roots: [48, 43, 48],
  bass: [0, R, R, R],
  bassLevel: 0.26,
  bassLen: 3,
  arp: [R],
  arpLevel: 0,
  lead: [
    67, R, 67, 67, 72, H, H, H,
    76, R, 74, 72, 74, H, 79, H,
    84, H, H, H, H, H, H, R,
  ],
  leadType: 'brass',
  leadLevel: 0.058,
  drums: 'k---k---k-k-rrrrc-------',
  brass: [[0, 1], [2, 1], [3, 1], [4, 4], [8, 2], [12, 4], [16, 8]],
  brassLevel: 0.04,
};

/** The victory loop: I V vi IV, I V IV I, bright and full. */
const WIN_LOOP: Track = {
  bpm: 138,
  steps: 64,
  roots: [48, 43, 45, 41, 48, 43, 41, 48],
  minor: [false, false, true, false, false, false, false, false],
  bass: [0, R, 0, 12, 0, R, 12, R],
  bassLevel: 0.25,
  bassLen: 0.9,
  arp: [0, 7, 12, 16, 19, 16, 12, 7],
  arpLevel: 0.04,
  lead: [
    72, R, 76, R, 79, H, 76, R,
    74, R, 71, R, 67, H, H, R,
    72, R, 76, R, 81, H, 79, R,
    77, R, 76, R, 74, H, H, R,
    72, R, 76, R, 79, H, 84, R,
    83, R, 81, R, 79, H, H, R,
    77, R, 81, R, 79, R, 77, 76,
    72, H, H, H, R, R, R, R,
  ],
  leadType: 'square',
  leadLevel: 0.055,
  drums: 'khshkhsh',
  brass: [[0, 2], [32, 2], [56, 4]],
  brassLevel: 0.04,
};

/** A draw: a warm, short theme (IV I ii V), then a soft bed under the result screen. */
const DRAW_THEME: Track = {
  bpm: 104,
  steps: 64,
  roots: [41, 48, 50, 43, 41, 48, 43, 48],
  minor: [false, false, true, false, false, false, false, false],
  bass: [0, R, R, R, 7, R, R, R],
  bassLevel: 0.24,
  bassLen: 3,
  arp: [0, 7, 12, 16, 12, 7, 4, 7],
  arpLevel: 0.028,
  lead: [
    69, H, 72, H, 77, H, 76, H,
    72, H, H, H, 67, H, R, R,
    69, H, 74, H, 77, H, 76, H,
    74, H, H, H, R, R, 71, H,
    72, H, 69, H, 72, H, 77, H,
    76, H, H, H, 72, H, H, H,
    74, H, 71, H, 67, H, 71, H,
    72, H, H, H, H, H, R, R,
  ],
  leadType: 'triangle',
  leadLevel: 0.1,
  drums: 'k-h---h-',
  drumLevel: 0.7,
};
const DRAW_BED: Track = { ...DRAW_THEME, lead: [R], arpLevel: 0.024, bassLevel: 0.2, drums: '--h---h-', drumLevel: 0.6 };

/** A defeat: a gentle "go again" (vi IV I V), climbing, and hanging on the V so it asks for another go. */
const LOSS_THEME: Track = {
  bpm: 96,
  steps: 64,
  roots: [45, 41, 48, 43, 45, 41, 43, 43],
  minor: [true, false, false, false, true, false, false, false],
  bass: [0, R, R, R, 12, R, R, R],
  bassLevel: 0.22,
  bassLen: 3,
  arp: [0, 7, 12, 7, 16, 12, 7, 4],
  arpLevel: 0.026,
  lead: [
    76, H, H, H, 72, H, 69, H,
    72, H, H, H, 69, H, 65, H,
    67, H, 72, H, 76, H, 79, H,
    79, H, H, H, 74, H, H, H,
    76, H, 77, H, 76, H, 72, H,
    72, H, 74, H, 76, H, 77, H,
    79, H, H, H, 81, H, 83, H,
    86, H, H, H, H, H, R, R,
  ],
  leadType: 'triangle',
  leadLevel: 0.1,
  drums: '--h---h-',
  drumLevel: 0.6,
};
const LOSS_BED: Track = { ...LOSS_THEME, lead: [R], arpLevel: 0.022, bassLevel: 0.18 };

export const SONGS: Record<TrackId, Song> = {
  menu: MENU,
  halftime: HALFTIME,
  win: { intro: WIN_FANFARE, loop: WIN_LOOP, level: 1 },
  draw: { intro: DRAW_THEME, loop: DRAW_BED, level: 0.9 },
  loss: { intro: LOSS_THEME, loop: LOSS_BED, level: 0.85 },
};

/** The trophy (and a cup final won): a longer fanfare with a timpani roll into the last chord. */
const TROPHY: Track = {
  bpm: 120,
  steps: 32,
  roots: [48, 41, 43, 48],
  bass: [0, R, R, R],
  bassLevel: 0.26,
  bassLen: 3,
  arp: [R],
  arpLevel: 0,
  lead: [
    67, R, 67, 67, 72, H, H, H,
    77, H, 76, H, 74, H, 72, H,
    74, H, 76, H, 79, H, H, H,
    84, H, H, H, H, H, H, R,
  ],
  leadType: 'brass',
  leadLevel: 0.06,
  drums: 'k---k---k---k---k-k-rrrrc---k---',
  brass: [[0, 1], [2, 1], [3, 1], [4, 4], [8, 8], [16, 8], [24, 8]],
  brassLevel: 0.044,
};

/** A cup final won: the trophy fanfare into the victory loop. */
export const WIN_FINAL: Song = { intro: TROPHY, loop: WIN_LOOP, level: 1 };

/** One-shot cues (scheduled whole when they fire; Sfx.sting). */
export const STINGS: Record<StingId, Track> = {
  /** The kick-off: a snare roll up to a G, then the C with a crash (the referee's whistle comes from the sim). */
  kickoff: {
    bpm: 132,
    steps: 16,
    roots: [43, 48],
    bass: [R, R, R, R, R, R, R, R, 0, R, R, R, R, R, R, R],
    bassLevel: 0.26,
    bassLen: 4,
    arp: [R],
    arpLevel: 0,
    lead: [60, 64, 67, 72, 64, 67, 71, 74, 79, H, H, H, H, H, R, R],
    leadType: 'square',
    leadLevel: 0.05,
    drums: 'rrrrrrrrc---k---',
    brass: [[6, 2], [8, 6]],
    brassLevel: 0.05,
  },
  /** A goal: a fast run up the C chord and a brass hit, under the roar. */
  goal: {
    bpm: 150,
    steps: 16,
    roots: [48, 48],
    bass: [0, R, R, R, 12, R, R, R],
    bassLevel: 0.24,
    bassLen: 3,
    arp: [R],
    arpLevel: 0,
    lead: [72, 76, 79, 84, 79, 84, 88, H, H, H, H, H, R, R, R, R],
    leadType: 'square',
    leadLevel: 0.05,
    drums: 'c---k-k-k---k---',
    brass: [[0, 1], [4, 8]],
    brassLevel: 0.05,
  },
  trophy: TROPHY,
  promotion: { ...TROPHY, bpm: 128, brassLevel: 0.04, drums: 'k---k---k---k---k---k-rrc-------' },
};
