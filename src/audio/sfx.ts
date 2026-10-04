import { rainSamples } from './ambience';
import { MENU, SONGS, STINGS, WIN_FINAL, midiHz, type Song, type StingId, type Track, type TrackId } from './music';

/**
 * Every sound is synthesised with WebAudio — no asset downloads, no licences, no voices.
 * Crowd bed + reactions, whistle, kicks, woodwork, net, UI blips, the menu loop and the match's music.
 *
 * Impacts are layered (the owner's brief): a shot is the boot's transient, a low body, a short room tail and,
 * on target, a crowd "oooh"; a header is a dry, higher "thock"; a won tackle or a foul a low thump and a short
 * grunt (the referee's whistle comes from the sim); the woodwork a metallic clang; a goal the net, then the
 * crowd swelling, then the horn; a save a glove slap and a gasp. The crowd is two panned beds, one behind each
 * goal, that swell and get restless as the ball nears that end (setEnds), over a wash that follows the match's
 * excitement; the ground's size and crowd set how loud it all is (setStadium).
 *
 * THE CROWD SINGS AT EVERY GROUND (the owner: "crowd chants non existent"; a level-0 ground used to never sing).
 * A small ground is a few fans, loud and passionate: a drum, a trumpet, claps and shouts; a big one is many voices.
 * Every 15 to 30 s (tick) one of CHANT_KINDS: seventeen chants (see chant()), each a football rhythm with claps and a
 * drum. The owner again: "have more chants but make it obvious that it is chants because it kind of isnt". So the
 * voices are WORDS now, not a pad: every syllable has its own vowel through the choir's formants, the vowel MOVES
 * inside the syllable where the word does ("o-LE", "hEY", "OH"), consonants are closures and bursts in front of it,
 * the stand sings in ragged unison (two groups a breath apart, some an octave down, each voice scooping into the
 * note), the two ends call and answer each other (panned left and right), the beds duck under it (bedBus), and
 * onChant hands the words to the screen ("CROWD: OLE, OLE OLE OLE"). The away fans' section (panned to one side,
 * quieter) answers sometimes. On top, reactions: a rising roar as an attack gets to the box (setEnds), olés on a passing move, whistles at the
 * other side keeping the ball and at fouls, groans at a sitter missed, applause, the home crowd singing after a
 * home goal, nerves late on, the final whistle (the sim and src/audio/director.ts say when).
 *
 * MUSIC (src/audio/music.ts): the menu loop, the half-time loop, the full-time themes (a fanfare and a loop for a
 * win, a warm theme for a draw, a "go again" for a defeat), stings for the kick-off and a goal, and the trophy and
 * promotion fanfares; one sequencer, a song's gain fading in and out as it changes, ducked under goal roars.
 *
 * Mix (phone speakers): everything sits in the mids; the master runs through a low cut, a gentle shelf and a
 * presence lift, a glue compressor and a limiter, so the game is loud without clipping (levels: tests/crowdMusic).
 *
 * CPU: the beds, the choirs, the reverb and the buses are made once; per-frame calls only move AudioParams (and
 * only when the value really changes); nodes are only made when a sound plays, and the crowd's one-shots share a
 * voice budget (VOICE_CAP).
 */
/** Room tail: a short, dark impulse (s) and how much of it each kind of hit sends. */
const REVERB_S = 0.55;
/** Crowd beds behind each goal: pan (left goal = -x on the broadcast shot) and loudness from calm to roaring. */
const END_PAN = 0.72;
const END_CALM = 0.012;
const END_ROAR = 0.15;
/** The away fans' section: where it sits on the broadcast shot and how loud it is next to the home crowd. */
const AWAY_PAN = 0.55;
const AWAY_K = 0.55;
/** The master: its gain into the chain, the music bus (the menu loop was 0.32 into a quieter chain). */
const MASTER_GAIN = 1;
const MUSIC_BUS = 0.75;
/** How loud the crowd's own voices are (chants, shouts, reactions) next to the beds. */
const VOICE_LEVEL = 1;
/** Tuned on offline renders (src/audio/dev.ts measureMix): a chant sits about 6 dB under a goal roar, the final
 * minutes' heartbeat well under play. */
const CHANT_LEVEL = 0.5;
/** While a chant is on, the beds (the wash, the two ends, the murmur) drop to this: the song has its moment. */
const BED_DUCK = 0.55;
/** The two ends of the home crowd, for a call and its answer: where each sits on the broadcast shot. */
const CALL_PAN = 0.6;
const ROAR_LEVEL = 1.4;
const HEART_LEVEL = 0.55;
/** Seconds between chants in open play (random in the range), and the first one after the ground is set. */
const CHANT_MIN = 15;
const CHANT_MAX = 30;
const CHANT_FIRST = [4, 9] as const;
/** How often the away section answers a home chant. */
const AWAY_ANSWER = 0.3;
/** A ground this empty (fill) never sings, shouts or surges: nobody there. */
const EMPTY_FILL = 0.05;
/** The rising roar: an end's heat past SURGE_AT (an attack in the final third), re-armed under SURGE_REARM. */
const SURGE_AT = 0.45;
const SURGE_REARM = 0.15;
const SURGE_GAP = 7;
/** The crowd's one-shot voices at once at most (a source or an oscillator each); past it, a new sound is dropped. */
const VOICE_CAP = 64;
/** The nervous murmur: always a little chatter, and this much more at full nerves. */
const MURMUR_BASE = 0.006;
const MURMUR_NERVES = 0.07;

/** Who is singing: 0 the home crowd (all round the ground), 1 the away fans' section. */
export type Stand = 0 | 1;
/** The chants (Sfx.chant says what each is). The first five are the originals; ids are used by the dev panel and tests. */
export const CHANT_KINDS = [
  'claps', 'ohs', 'name', 'drum', 'horn', 'ole', 'comeon', 'hey', 'callname', 'stomp', 'lala', 'letsgo', 'whoa',
  'allez', 'herewego', 'standup', 'weare',
] as const;
export type ChantKind = (typeof CHANT_KINDS)[number];
export type Outcome = 'win' | 'draw' | 'loss';

/**
 * Crowd vowels: the first two formants (Hz) of a few thousand men singing them. `u` is the "uh" of "come", `w` the
 * closed "oo" an "oh" ends on.
 */
const VOWELS: Record<string, readonly [number, number]> = {
  a: [730, 1090], e: [530, 1840], i: [330, 2200], o: [570, 840], u: [640, 1190], w: [330, 870],
};
/** A voiced closure in front of a vowel (the tongue or lips shut, the voice still going): its two formants. */
const CLOSURES: Record<string, readonly [number, number]> = {
  l: [310, 1250], n: [260, 1150], m: [250, 950], w: [300, 750], y: [280, 2100], r: [420, 1300], v: [280, 1100], z: [280, 1500],
};
/**
 * One sung syllable: [start (s, from the chant's start), length (s), MIDI note, vowel, consonant]. The vowel is one
 * letter of VOWELS, or two for a vowel that moves ("ei" in HEY, "ow" in OH, "ai" in a shouted name); the consonant
 * in front of it is a closure (l n m w y), a breath (h) or a burst (anything else: k t p b d g s), or absent.
 */
type SungNote = readonly [number, number, number, string, string?];
/** A syllable to sing: its vowel(s) and the consonant in front. */
type Syl = readonly [string, string];

/**
 * The vowels of a club's name for its chant: the first word, one per syllable (a vowel group, a silent final e
 * or "ue" dropped), at most four: "Mossvale Rovers" -> o a ("MOSS-VALE"), "Pebbleport" -> e e o. No name: BLOCKY LEAGUE.
 */
export function chantSyllables(name: string): string[] {
  const words = name.trim().toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter(Boolean);
  const src = words.length ? [words[0]] : ['blocky', 'league'];
  const out: string[] = [];
  for (const w of src) {
    let groups: string[] = w.match(/[aeiouy]+/g) ?? [];
    if (groups.length > 1 && /(?:[^aeiouy]e|ue)$/.test(w)) groups = groups.slice(0, -1);
    for (const g of groups) out.push(g[0] === 'y' || g.startsWith('ea') || g.startsWith('ee') ? 'i' : g[0]);
  }
  return out.length ? out.slice(0, 4) : ['o'];
}

/**
 * The words of a club's name as its fans chant them: the first two words (a name over 18 letters: the first only), in
 * capitals. "Mossvale Rovers" -> ["MOSSVALE", "ROVERS"]; no name: BLOCKY LEAGUE.
 */
export function chantWords(name: string): string[] {
  const words = name.trim().toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z0-9']/g, '')).filter(Boolean);
  if (!words.length) return ['BLOCKY', 'LEAGUE'];
  const two = words.slice(0, 2);
  return two.join(' ').length > 18 ? [two[0]] : two;
}

/** A word's syllables to sing: each vowel group with the consonant in front of it (at most three a word). */
function wordSyllables(word: string): Syl[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: Syl[] = [];
  const re = /([^aeiouy]*)([aeiouy]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(w))) {
    // A silent final e ("vale", "league"): not a syllable.
    if (out.length && m.index + m[0].length === w.length && /^(e|ue)$/.test(m[2]) && m[1].length <= 2) break;
    const g = m[2];
    const v = g[0] === 'y' || g.startsWith('ea') || g.startsWith('ee') ? 'i' : g.startsWith('ou') || g.startsWith('ow') ? 'ow' : g.startsWith('ai') || g.startsWith('ay') ? 'ei' : g[0];
    out.push([v, m[1].slice(-1)]);
  }
  return out.length ? out.slice(0, 3) : [['o', '']];
}

/**
 * What the screen says the crowd is singing (the chant caption; `words`: chantWords of the club singing). Short,
 * capitals, the claps and drums in brackets.
 */
export function chantCaption(kind: ChantKind, words: readonly string[]): string {
  const first = words[0] ?? 'BLOCKY';
  const name = words.join(' ');
  switch (kind) {
    case 'claps': return `(CLAP CLAP, CLAP CLAP CLAP) ${first}!`;
    case 'ohs': return 'OH OH OH, OH OH OH!';
    case 'name': return `${name}! (CLAP CLAP CLAP)`;
    case 'drum': return '(DRUMS) HEY! HEY!';
    case 'horn': return '(TRUMPET) CHARGE!';
    case 'ole': return 'OLE, OLE OLE OLE!';
    case 'comeon': return `COME ON ${first}!`;
    case 'hey': return 'HEY! HEY! HEY! HEY!';
    case 'callname': return words.length > 1 ? `${words[0]}! (CLAP CLAP CLAP) ${words[1]}!` : `${first}! ${first}!`;
    case 'stomp': return 'BOOM BOOM CLAP! OH!';
    case 'lala': return 'LA LA LA LA, HEY!';
    case 'letsgo': return `LET'S GO ${first}! (CLAP CLAP)`;
    case 'allez': return `ALLEZ ALLEZ ${first}! (DRUMS)`;
    case 'herewego': return 'HERE WE GO! HERE WE GO! (CLAP CLAP)';
    case 'standup': return `STAND UP FOR ${first}! (CLAP CLAP)`;
    case 'weare': return `WE ARE ${name}! OH OH!`;
    default: return 'OOOOOH, HEY!';
  }
}

/** A formant bank the crowd sings through (one per stand, made once; one chant at a time moves its filters). */
interface Choir {
  input: GainNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  /** Audio time until which a chant owns it. */
  busy: number;
}

/** Set an AudioParam that a stand-in (tests) or an older WebKit may lack. */
function setP(p: AudioParam | undefined, v: number): void {
  if (p) p.value = v;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private crowdBus!: GainNode;
  private musicBus!: GainNode;
  /** Between the songs and the music bus: ducked under goal roars and fanfares. */
  private musicDuck!: GainNode;
  /** The away fans' section: their voices, quieter and panned to one side, into the crowd bus. */
  private awayBus!: GainNode;
  /** The beds (the wash, the two ends, the murmur) on their way to the crowd bus: ducked while a chant is on. */
  private bedBus!: GainNode;
  /** The two ends of the home crowd (panned left and right), for a call and its answer. */
  private endBus: GainNode[] = [];
  private noise!: AudioBuffer;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  /** Master output (after the limiter): what a clip's audio tap listens to. */
  private out!: DynamicsCompressorNode;
  /** The room tail's input (anything connected here gets the short reverb). */
  private reverbIn!: GainNode;
  /** Crowd beds behind the two goals (index 0: the -x end, 1: the +x end). */
  private ends: { gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode; heat: number; armed: boolean; surgeAt: number }[] = [];
  /** The choirs: 0 home (all round the ground), 1 away, 2 and 3 the home crowd's two ends (a call and its answer). */
  private choirs: Choir[] = [];
  /**
   * A chant has started: its kind, who is singing, the words for the screen and how long it runs (s). The match
   * session shows the caption (game/matchSession.ts); null in the menus.
   */
  onChant: ((c: { kind: ChantKind; stand: Stand; caption: string; seconds: number }) => void) | null = null;
  /** Each side's name as chanted (chantWords), and its words' syllables. */
  private words: string[][] = [['BLOCKY', 'LEAGUE'], ['BLOCKY', 'LEAGUE']];
  /** The murmur bed (chatter, nerves) and the level it was last set to. */
  private murmurGain: GainNode | null = null;
  private murmurLfo: GainNode | null = null;
  private murmurLevel = -1;
  /** How big and full the ground is: 0 (a muddy park) .. 1 (a sold-out Mega Dome). */
  private stadiumK = 1;
  private stadiumLevel = 5;
  private fill = 0.9;
  /** Seconds to the crowd's next chant, and the audio time until which a goal roar owns the stands. */
  private chantT = 8;
  private roarUntil = 0;
  private lastOoh = -9;
  /** The chant the crowd sings next whatever the gap (after a goal: theirs, louder), and the stand singing it. */
  private forced: { kind: ChantKind; stand: Stand; anthem: boolean } | null = null;
  /** Each scoring end cycles its own celebration songs instead of repeating one anthem after every goal. */
  private goalSongs: [number, number] = [0, 0];
  /** Seconds to the away section's answer (Infinity: none due), to the next lone shout. */
  private answerT = Infinity;
  private shoutT = 5;
  private lastChant: ChantKind | null = null;
  /** Regular chants allowed (the director closes it at half time and full time). */
  private chantGate = true;
  /** The vowels of each side's name (chantSyllables). */
  private syllables: string[][] = [['o', 'i', 'i'], ['o', 'i', 'i']];
  /** The voice budget: the audio time each of VOICE_CAP slots is busy until. */
  private voiceEnd = new Float64Array(VOICE_CAP);
  /** Nerves (director: late and close) and tension (the fun layer's final minutes), 0..1. */
  private nerves = 0;
  private tension = 0;
  /** The final minutes' heartbeat: on, and the audio time of the next beat. */
  private finalOn = false;
  private beatNext = 0;
  private beatN = 0;
  /** Rate limits (audio time) for the hooks other code may call twice. */
  private superAt = -9;
  private oleAt = -9;
  private applauseAt = -9;
  private whistlesAt = -9;
  private lastGroan = -9;
  /** A clip's audio tap (MediaStreamAudioDestinationNode), made on first use. */
  private tap: MediaStreamAudioDestinationNode | null = null;
  private tapping = false;
  private excitement = 0.2;
  private washLevel = -1;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  /** The song playing (null: none), which part of it (its intro, then its loop), its gain and its size. */
  private song: Song | null = null;
  private part: Track | null = null;
  private trackId: TrackId | null = null;
  private trackGain: GainNode | null = null;
  private big = 0;
  /** Stings fired (for the dev panel and tests). */
  private lastSting: StingId | null = null;
  private stings = 0;
  private effectsEnabled = true;
  private crowdEnabled = true;
  private ambienceActive = false;
  private rainActive = false;
  musicOn = true;
  private muted = false;
  /** Measuring the mix (src/audio/dev.ts): built on an OfflineAudioContext, always ready, no wake hooks. */
  private offline = false;
  /** The page is hidden (the app in the background, another tab): the context sleeps until it's back (wake). */
  private hidden = false;
  private wakeOn = false;
  /** The context needs building again from the next tap: iOS left it stuck, or its clock stopped (see wake). */
  private stale = false;
  private aliveTimer: number | null = null;

  get sfxOn(): boolean { return this.effectsEnabled; }
  set sfxOn(on: boolean) { this.effectsEnabled = on; this.mixAmbience(); }
  get crowdOn(): boolean { return this.crowdEnabled; }
  set crowdOn(on: boolean) { this.crowdEnabled = on; this.mixAmbience(); }

  get ready(): boolean {
    return this.ctx !== null && (this.offline || this.ctx.state === 'running');
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.build();
      this.installWake();
      // A call, Siri or a full-screen ad taking the audio session while we're on screen: try to come straight back
      // (the next tap does it if the system wants a gesture first).
      c.addEventListener?.('statechange', () => {
        const st = c.state as string;
        if (this.ctx === c && !this.hidden && st !== 'running' && st !== 'closed') this.wake(false);
      });
    }
    // (WebKit also has 'interrupted': a call, Siri, the app sent to the background.)
    if ((this.ctx.state as string) !== 'running') void this.ctx.resume().catch(() => {});
  }

  /**
   * Measuring the mix only (src/audio/dev.ts): the whole graph on `ctx` (an OfflineAudioContext), so a render can
   * be scored for peak and loudness. Never used for play.
   */
  attachOffline(ctx: BaseAudioContext): void {
    this.offline = true;
    this.ctx = ctx as AudioContext;
    this.build();
  }

  /**
   * The graph, made once per context: the master chain (low cut, shelf, presence, glue compressor, limiter), the
   * buses, the shared noise, the crowd's beds and choirs, the room tail and the rain.
   */
  private build(): void {
    const c = this.ctx!;
    // The limiter is made first (the clip tap and the tests find it as the first compressor): a fast, hard knee.
    const lim = c.createDynamicsCompressor();
    setP(lim.threshold, -6);
    setP(lim.ratio, 20);
    setP(lim.knee, 0);
    setP(lim.attack, 0.001);
    setP(lim.release, 0.1);
    // Glue: a gentle squeeze that brings the quiet crowd and music up (WebAudio adds its own make-up gain).
    const glue = c.createDynamicsCompressor();
    setP(glue.threshold, -16);
    setP(glue.ratio, 2);
    setP(glue.knee, 10);
    setP(glue.attack, 0.008);
    setP(glue.release, 0.22);
    // Phone speakers: nothing under ~150 Hz comes out, so the sub only eats headroom; a little presence instead.
    const lowCut = c.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 70;
    lowCut.Q.value = 0.6;
    const shelf = c.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 150;
    setP(shelf.gain, -3);
    const presence = c.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2400;
    presence.Q.value = 0.8;
    setP(presence.gain, 2);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    this.master.connect(lowCut).connect(shelf).connect(presence).connect(glue).connect(lim).connect(c.destination);
    this.out = lim;
    this.sfxBus = c.createGain();
    this.crowdBus = c.createGain();
    this.musicBus = c.createGain();
    this.musicBus.gain.value = MUSIC_BUS;
    this.musicDuck = c.createGain();
    this.musicDuck.connect(this.musicBus);
    this.sfxBus.connect(this.master);
    this.crowdBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.awayBus = c.createGain();
    this.awayBus.gain.value = AWAY_K;
    const awayPan = c.createStereoPanner();
    awayPan.pan.value = AWAY_PAN;
    this.awayBus.connect(awayPan).connect(this.crowdBus);
    this.bedBus = c.createGain();
    this.bedBus.connect(this.crowdBus);
    this.endBus = [-CALL_PAN, CALL_PAN].map((pan) => {
      const g = c.createGain();
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.crowdBus);
      return g;
    });
    const len = c.sampleRate * 3;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    // Slightly pinked noise sounds more like a crowd than white noise.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2 + w * 0.12) * 0.9;
    }
    this.washLevel = -1;
    this.murmurLevel = -1;
    this.startCrowd();
    this.startReverb();
    this.startEnds();
    this.choirs = [this.makeChoir(this.crowdBus), this.makeChoir(this.awayBus), this.makeChoir(this.endBus[0]), this.makeChoir(this.endBus[1])];
    this.startMurmur();
    this.applyStadium();
    this.setRain(this.rainActive);
    this.mixAmbience();
  }

  /**
   * Leaving the app and coming back (the owner: "audio is compleetely silent"). iOS interrupts the context when the
   * app goes to the background and may leave it 'interrupted' or 'suspended', which a resume from script can't
   * always undo. So: the context sleeps while the page is hidden; on the way back (visibilitychange, pageshow,
   * focus) it is resumed; while it still isn't running, the next tap, click or key resumes it (a user gesture
   * always may); and if even that leaves it stuck, or it says 'running' with its clock stood still (WebKit's
   * silent context), the tap after builds the whole graph again: crowd beds, rain, the room and the menu music
   * (rebuild), the old context closed first so nothing plays twice.
   */
  private installWake(): void {
    if (this.wakeOn || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof window.addEventListener !== 'function' || typeof document.addEventListener !== 'function') return;
    this.wakeOn = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.sleep();
      else this.wake(false);
    });
    window.addEventListener('pagehide', () => this.sleep());
    window.addEventListener('pageshow', () => this.wake(false));
    window.addEventListener('focus', () => this.wake(false));
    const gesture = (): void => {
      const c = this.ctx;
      if (c && (this.stale || (c.state as string) !== 'running')) this.wake(true);
    };
    for (const type of ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown'] as const) {
      window.addEventListener(type, gesture, { capture: true, passive: true });
    }
  }

  private sleep(): void {
    this.hidden = true;
    const c = this.ctx;
    if (c && c.state === 'running') void c.suspend().catch(() => {});
  }

  /** Bring the context back (`gesture`: from inside a tap / click / key handler, where a resume is always allowed). */
  private wake(gesture: boolean): void {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    this.hidden = false;
    const c = this.ctx;
    if (!c) return;
    if (gesture && this.stale) {
      this.rebuild();
      return;
    }
    if ((c.state as string) === 'running') {
      this.watchClock(c);
      return;
    }
    c.resume().then(
      () => {
        if (this.ctx !== c) return;
        if ((c.state as string) === 'running') this.watchClock(c);
        else if (gesture) this.stale = true;
      },
      () => {
        if (gesture && this.ctx === c) this.stale = true;
      },
    );
  }

  /** A 'running' context whose clock doesn't move is a silent one: the next tap builds it again. */
  private watchClock(c: AudioContext): void {
    if (this.aliveTimer !== null) return;
    const t0 = c.currentTime;
    this.aliveTimer = window.setTimeout(() => {
      this.aliveTimer = null;
      if (this.ctx === c && !this.hidden && (c.state as string) === 'running' && c.currentTime - t0 < 0.15) this.stale = true;
    }, 600);
  }

  /** A fresh context with everything that was playing on the old one (from a user gesture: see installWake). */
  private rebuild(): void {
    const old = this.ctx;
    this.stale = false;
    // Whatever song was up comes back on the new context (once: the old one is closed first, its timer cleared).
    const song = this.musicTimer !== null ? this.trackId : null;
    const big = this.big;
    this.stopMusic(0);
    this.endCapture();
    this.ctx = null;
    this.ends = [];
    this.choirs = [];
    this.murmurGain = null;
    this.murmurLfo = null;
    this.rainGain = null;
    this.trackGain = null;
    this.tap = null;
    this.tapping = false;
    // (Times on the old context's clock: the new one starts again from zero.)
    this.roarUntil = 0;
    this.lastOoh = -9;
    this.superAt = this.oleAt = this.applauseAt = this.whistlesAt = this.lastGroan = -9;
    this.beatNext = 0;
    this.voiceEnd.fill(0);
    if (old) void old.close().catch(() => {});
    this.unlock();
    if (!this.ctx) return;
    this.setExcitement(this.excitement);
    if (song) this.playTrack(song, big);
  }

  private startCrowd(): void {
    const c = this.ctx!;
    this.crowdFilter = c.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 1050;
    this.crowdFilter.Q.value = 0.8;
    const rumbleCut = c.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 350;
    rumbleCut.Q.value = 0.707;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = 0;
    for (let k = 0; k < 2; k++) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = k ? 0.93 : 1.07;
      const g = c.createGain();
      g.gain.value = 0.5;
      // Slow swells so it breathes.
      const lfo = c.createOscillator();
      lfo.frequency.value = k ? 0.13 : 0.21;
      const lg = c.createGain();
      lg.gain.value = 0.18;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      src.connect(g).connect(this.crowdFilter);
      src.start(0, Math.random() * 2);
    }
    this.crowdFilter.connect(rumbleCut).connect(this.crowdGain).connect(this.bedBus);
  }

  /**
   * The room tail: one ConvolverNode on a synthesised impulse (REVERB_S of dark, decaying stereo noise with a
   * 12 ms pre-delay), fed through reverbIn, into the effects bus. Shared by every sound that wants some.
   */
  private startReverb(): void {
    const c = this.ctx!;
    const len = Math.round(c.sampleRate * REVERB_S);
    const ir = c.createBuffer(2, len, c.sampleRate);
    const pre = Math.round(c.sampleRate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / c.sampleRate;
        // One-pole low-pass on the noise: a dull stadium concourse, not a bright hall.
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t / 0.11) * 0.9;
      }
    }
    const conv = c.createConvolver();
    conv.normalize = true;
    conv.buffer = ir;
    this.reverbIn = c.createGain();
    this.reverbIn.gain.value = 0.55;
    this.reverbIn.connect(conv).connect(this.sfxBus);
  }

  /** Send `node`'s output into the room tail at `amount` (a per-sound gain: made when the sound plays). */
  private wet(node: AudioNode, amount: number): void {
    if (!this.reverbIn || amount <= 0) return;
    const g = this.ctx!.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.reverbIn);
  }

  /**
   * The crowd behind each goal: a looped bed each (the shared noise at its own rate), band-passed, panned to its
   * end of the broadcast shot and breathing on a slow LFO. setEnds swells one as the ball nears that goal and
   * quickens its LFO (restless), so the noise moves round the ground with the play.
   */
  private startEnds(): void {
    const c = this.ctx!;
    for (let k = 0; k < 2; k++) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = k ? 1.02 : 0.96;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 850;
      filter.Q.value = 0.9;
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner();
      pan.pan.value = k ? END_PAN : -END_PAN;
      const lfo = c.createOscillator();
      lfo.frequency.value = k ? 0.23 : 0.17;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start();
      src.connect(filter).connect(gain).connect(pan).connect(this.bedBus);
      src.start(0, Math.random() * 2 + k);
      this.ends.push({ gain, filter, lfo, lfoGain, heat: -1, armed: true, surgeAt: -99 });
    }
  }

  /**
   * A stand's choir: the crowd's voices go in at `input`, through two vowel formants (moved per sung syllable, and
   * within it where the vowel moves), a fixed third (the "singer's" ring a phone speaker carries the words on) and a
   * little of the chest under them, out to `dest`. The formants are narrow (Q 6 and 9): wide ones only colour the
   * noise, narrow ones say a vowel.
   */
  private makeChoir(dest: AudioNode): Choir {
    const c = this.ctx!;
    const input = c.createGain();
    const out = c.createGain();
    out.gain.value = 1.7;
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 570;
    f1.Q.value = 6;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 840;
    f2.Q.value = 9;
    const g2 = c.createGain();
    g2.gain.value = 0.85;
    const f3 = c.createBiquadFilter();
    f3.type = 'bandpass';
    f3.frequency.value = 2600;
    f3.Q.value = 4;
    const g3 = c.createGain();
    g3.gain.value = 0.3;
    const chest = c.createBiquadFilter();
    chest.type = 'lowpass';
    chest.frequency.value = 340;
    chest.Q.value = 0.7;
    const gc = c.createGain();
    gc.gain.value = 0.14;
    input.connect(f1).connect(out);
    input.connect(f2).connect(g2).connect(out);
    input.connect(f3).connect(g3).connect(out);
    input.connect(chest).connect(gc).connect(out);
    out.connect(dest);
    return { input, f1, f2, busy: 0 };
  }

  /**
   * The murmur: low chatter all round the ground (a babbling LFO on a band of the noise), up with the nerves late
   * in a close game and through the break (setNerves, setTension).
   */
  private startMurmur(): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.88;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 1.1;
    const g = c.createGain();
    g.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.frequency.value = 3.7;
    const lg = c.createGain();
    lg.gain.value = 0;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    src.connect(f).connect(g).connect(this.bedBus);
    src.start(0, Math.random() * 2);
    this.murmurGain = g;
    this.murmurLfo = lg;
  }

  /**
   * How hot each end is (0 a murmur .. 1 a roar): `left` the goal at -x, `right` the one at +x. Cheap to call
   * every frame: the params only move when a value changes by a step. An attack getting into the final third
   * lifts that end with a rising roar (surge), once per attack.
   */
  setEnds(left: number, right: number): void {
    if (!this.ctx || this.ends.length < 2) return;
    const t = this.ctx.currentTime;
    const on = this.ambienceActive && this.crowdOn;
    for (let k = 0; k < 2; k++) {
      const e = this.ends[k];
      const raw = Math.max(0, Math.min(1, k ? right : left));
      if (on && this.fill >= EMPTY_FILL) {
        if (raw >= SURGE_AT && e.armed && t - e.surgeAt > SURGE_GAP && t >= this.roarUntil) {
          e.armed = false;
          e.surgeAt = t;
          this.surge(k, raw);
        } else if (raw < SURGE_REARM) e.armed = true;
      }
      // (-2: silenced, the same mark mixAmbience leaves, so the two never undo each other every frame.)
      const h = on ? raw : -2;
      if (Math.abs(h - e.heat) < 0.02) continue;
      e.heat = h;
      const heat = Math.max(0, h);
      const level = on ? (END_CALM + heat * heat * (END_ROAR - END_CALM)) * this.stadiumK : 0;
      e.gain.gain.setTargetAtTime(level, t, heat > 0.5 ? 0.25 : 0.6);
      // Restless: a quicker, deeper breath, and brighter as they get up off their seats.
      e.lfoGain.gain.setTargetAtTime(level * (0.18 + heat * 0.45), t, 0.4);
      e.lfo.frequency.setTargetAtTime(0.17 + k * 0.06 + heat * 1.6, t, 0.5);
      e.filter.frequency.setTargetAtTime(820 + heat * 700, t, 0.5);
    }
  }

  /**
   * The ground: `level` 0 (a muddy park) .. 5 (the Mega Dome) and `fill` 0..1 (how full it is). A bigger, fuller
   * ground is louder all round and sings more often, with more voices.
   */
  setStadium(level: number, fill: number): void {
    this.chantRate = 1;
    this.stadiumLevel = Math.max(0, Math.min(5, level));
    this.fill = Math.max(0, Math.min(1, fill));
    this.stadiumK = (0.4 + 0.12 * this.stadiumLevel) * (0.55 + 0.45 * this.fill);
    this.chantT = CHANT_FIRST[0] + Math.random() * (CHANT_FIRST[1] - CHANT_FIRST[0]);
    this.shoutT = 2 + Math.random() * 3;
    this.answerT = Infinity;
    this.forced = null;
    this.goalSongs = [0, 0];
    this.lastChant = null;
    this.applyStadium();
  }

  /** 0 at a muddy park .. 1 at the Mega Dome. */
  private get size(): number {
    return this.stadiumLevel / 5;
  }

  private applyStadium(): void {
    if (!this.ctx || !this.crowdBus) return;
    // A small ground is a small crowd, but a loud one: the bus barely drops (its beds are quieter: stadiumK).
    this.crowdBus.gain.setTargetAtTime(Math.min(1.1, 0.8 + this.stadiumK * 0.3), this.ctx.currentTime, 0.3);
    for (const e of this.ends) e.heat = -1;
    this.murmurLevel = -1;
    this.mixMurmur();
  }

  /**
   * Seconds to the next chant for this ground: every CHANT_MIN to CHANT_MAX at every ground (a muddy park's few
   * fans sing too); Infinity only when nobody is there.
   */
  private chantGap(): number {
    if (this.fill < EMPTY_FILL) return Infinity;
    return (CHANT_MIN + Math.random() * (CHANT_MAX - CHANT_MIN)) / this.chantRate;
  }

  /** How much more often the crowd sings (1 = as usual, up to 2): the home club's ATMOSPHERE (meta/atmosphere.ts). */
  private chantRate = 1;

  /** The home club's atmosphere makes the crowd sing more often for this match (setStadium puts it back to 1). */
  setChantRate(k: number): void {
    this.chantRate = Number.isFinite(k) ? Math.max(1, Math.min(2, k)) : 1;
  }

  /** Regular chants on or off (src/audio/director.ts: off through half time and after the final whistle). */
  setChantGate(open: boolean): void {
    this.chantGate = open;
  }

  /** The two sides' names, for the name chant (each side's fans sing their own). */
  setClubNames(home: string, away: string): void {
    this.syllables = [chantSyllables(home), chantSyllables(away)];
    this.words = [chantWords(home), chantWords(away)];
  }

  /**
   * Once a frame in a match: the crowd's chants (made only when one starts; never over a goal roar), the away
   * section's answer, the lone shouts at a small ground and the final minutes' heartbeat.
   */
  tick(dt: number): void {
    if (!this.ready || !this.ambienceActive) return;
    const now = this.ctx!.currentTime;
    if (this.finalOn && this.sfxOn) this.heartbeat(now);
    if (!this.crowdOn || dt <= 0) return;
    // A small ground: the odd fan shouting in the gaps (lost in the noise of a big one).
    if ((this.shoutT -= dt) <= 0) {
      const small = 1 - this.size;
      this.shoutT = small > 0.5 ? 3 + Math.random() * 4 : 7 + Math.random() * 7;
      if (small > 0.35 && this.fill >= EMPTY_FILL && this.chantGate && now >= this.roarUntil) {
        this.shout(now + 0.05, VOICE_LEVEL * (0.65 + this.excitement * 0.5), Math.random() < 0.8 ? 0 : 1);
      }
    }
    if ((this.answerT -= dt) <= 0) {
      this.answerT = Infinity;
      if (this.chantGate && now >= this.roarUntil) this.chant(Sfx.AWAY_ANSWERS[Math.floor(Math.random() * Sfx.AWAY_ANSWERS.length)], 1);
    }
    if ((this.chantT -= dt) > 0) return;
    const gap = this.chantGap();
    this.chantT = Number.isFinite(gap) ? gap : 30;
    const f = this.forced;
    if (f) {
      if (now < this.roarUntil - 0.1) {
        this.chantT = this.roarUntil - now;
        return;
      }
      this.forced = null;
      this.chant(f.kind, f.stand, f.anthem);
      return;
    }
    if (!Number.isFinite(gap) || !this.chantGate || now < this.roarUntil) return;
    this.chant();
  }

  /**
   * A chant from `stand` (one at a time per stand; a home one is sometimes answered by the away section). Seventeen
   * of them, each a football rhythm with words the screen can caption (chantCaption):
   * - claps: clap clap, clap-clap-clap, clap-clap-clap-clap, and the club's name shouted; twice;
   * - ohs: a sung "oh oh oh" line and its answer (an anthem after a goal: louder, longer, more voices);
   * - name: the club's name in its own syllables, clap clap clap after each, four times;
   * - drum: a drum march, BOOM BOOM BOOM, with a "HEY!";
   * - horn: a trumpet in the stand plays the charge, the fans shout "CHARGE!" back and clap;
   * - ole: "o-LE, o-le o-le o-LE", the drum under it;
   * - comeon: "COME ON" and the club's name, clap clap clap, three times;
   * - hey: the two ends call and answer, "HEY!" from one, "HEY!" from the other, over the drum, getting quicker;
   * - callname: one end sings the club's first word, the other end its second, claps between;
   * - stomp: boom boom CLAP, with an "OH!" on the clap from the third bar;
   * - lala: "la la la la" down and back up, and a "HEY!";
   * - letsgo: "LET'S GO" and the club's name, clap clap;
   * - whoa: a long rising "oooooh" over a drum roll, and the "HEY!" it breaks into.
   * - allez: "ALLEZ ALLEZ" and the club, a rolling terrace march with two claps;
   * - herewego: a quick "HERE WE GO", three times, climbing into the last shout;
   * - standup: one end calls "STAND UP FOR", the other answers the club name;
   * - weare: "WE ARE" the club, then a long answering "OH OH" over the drum.
   * At a small ground a lone drummer bangs along to most of them. `kind` omitted: picked for the ground, never the
   * same twice running. The beds duck under it, and onChant gets its words.
   */
  chant(kind?: ChantKind, stand: Stand = 0, anthem = false): void {
    if (!this.ready || !this.crowdOn) return;
    const c = this.ctx!;
    const t = c.currentTime + 0.05;
    const choir = this.choirs[stand];
    if (choir && t < choir.busy) return;
    const k = kind ?? this.pickChant();
    const voices = Math.round(4 + this.size * 4 + this.fill) + (anthem ? 2 : 0);
    if (!this.claim(voices + 6, t + 6)) return;
    const level = VOICE_LEVEL * CHANT_LEVEL * (anthem ? 1.25 : 1);
    let end = t;
    switch (k) {
      case 'claps': end = this.chantClaps(t, level, stand, voices); break;
      case 'ohs': end = this.chantOhs(t, level, stand, voices, anthem); break;
      case 'name': end = this.chantName(t, level, stand, voices); break;
      case 'drum': end = this.chantDrum(t, level, stand, voices); break;
      case 'horn': end = this.chantHorn(t, level, stand, voices); break;
      case 'ole': end = this.chantOle(t, level, stand, voices); break;
      case 'comeon': end = this.chantComeOn(t, level, stand, voices); break;
      case 'hey': end = this.chantHey(t, level, stand, voices); break;
      case 'callname': end = this.chantCallName(t, level, stand, voices); break;
      case 'stomp': end = this.chantStomp(t, level, stand, voices); break;
      case 'lala': end = this.chantLaLa(t, level, stand, voices); break;
      case 'letsgo': end = this.chantLetsGo(t, level, stand, voices); break;
      case 'allez': end = this.chantAllez(t, level, stand, voices); break;
      case 'herewego': end = this.chantHereWeGo(t, level, stand, voices); break;
      case 'standup': end = this.chantStandUp(t, level, stand, voices); break;
      case 'weare': end = this.chantWeAre(t, level, stand, voices); break;
      default: end = this.chantWhoa(t, level, stand, voices); break;
    }
    if (choir) choir.busy = end;
    // The song has its moment: the beds drop under it and come back as it ends.
    this.duckBed(t, end);
    // (The home crowd's own run of chants: an away answer in between never makes them repeat themselves.)
    if (stand === 0) this.lastChant = k;
    if (stand === 0 && !anthem && this.chantGate && Math.random() < AWAY_ANSWER) this.answerT = end - t + 1 + Math.random() * 1.5;
    this.onChant?.({ kind: k, stand, caption: chantCaption(k, this.words[stand]), seconds: end - t });
  }

  /** The beds down to BED_DUCK from `t`, back up from `until` (audio times). */
  private duckBed(t: number, until: number): void {
    const g = this.bedBus?.gain;
    if (!g) return;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(BED_DUCK, t, 0.2);
    g.setTargetAtTime(1, Math.max(t + 0.5, until - 0.3), 0.5);
  }

  /**
   * Clip audio: a MediaStream of everything the player hears (connected only while a clip records), or null
   * where the browser can't.
   */
  captureStream(): MediaStream | null {
    if (!this.ctx || !this.out) return null;
    try {
      this.tap ??= this.ctx.createMediaStreamDestination();
      if (!this.tapping) {
        this.out.connect(this.tap);
        this.tapping = true;
      }
      return this.tap.stream;
    } catch {
      return null;
    }
  }

  /** The clip has finished: stop feeding it. */
  endCapture(): void {
    if (!this.tap || !this.tapping) return;
    try {
      this.out.disconnect(this.tap);
    } catch {
      // (Already disconnected.)
    }
    this.tapping = false;
  }

  private rainGain: GainNode | null = null;

  /** Soft rain bed during wet matches. */
  setRain(on: boolean): void {
    this.rainActive = on;
    if (!this.ctx) return;
    const c = this.ctx;
    if (on && !this.rainGain) {
      const src = c.createBufferSource();
      const channels = rainSamples(c.sampleRate);
      src.buffer = c.createBuffer(2, channels[0].length, c.sampleRate);
      channels.forEach((samples, channel) => src.buffer!.getChannelData(channel).set(samples));
      src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 950;
      hp.Q.value = 0.707;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4400;
      lp.Q.value = 0.707;
      this.rainGain = c.createGain();
      this.rainGain.gain.value = 0;
      src.connect(hp).connect(lp).connect(this.rainGain).connect(this.sfxBus);
      src.start();
    }
    this.mixAmbience();
  }

  /** Portal ads / platform mute: silence everything without losing state. */
  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05);
    // (A full-screen ad can take the audio session; the game's sound comes back when it closes.)
    if (!m) this.wake(false);
  }

  /** Menu / pause / match transitions share one gate, so weather cannot leak between games. */
  setAmbienceActive(active: boolean): void {
    this.ambienceActive = active;
    this.mixAmbience();
  }

  private mixAmbience(): void {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    // About 10 dB less continuous crowd wash; cheers still provide the big moments. (Only moved on a real change:
    // setExcitement comes every frame.)
    const target = this.ambienceActive && this.crowdOn ? 0.03 + this.excitement * 0.08 : 0;
    if (Math.abs(target - this.washLevel) > 0.002 || (target === 0) !== (this.washLevel === 0)) {
      this.washLevel = target;
      this.crowdGain.gain.setTargetAtTime(target, t, target ? 0.6 : 0.12);
      const rain = this.ambienceActive && this.rainActive && this.sfxOn ? 0.16 : 0;
      this.rainGain?.gain.setTargetAtTime(rain, t, rain ? 0.8 : 0.12);
    }
    this.mixMurmur();
    if (!(this.ambienceActive && this.crowdOn)) {
      // The end beds go quiet with the rest of the ambience (setEnds brings them back).
      for (const e of this.ends) {
        if (e.heat === -2) continue;
        e.heat = -2;
        e.gain.gain.setTargetAtTime(0, t, 0.12);
        e.lfoGain.gain.setTargetAtTime(0, t, 0.12);
      }
    }
  }

  /** The murmur's level: a little chatter, more with the nerves (or the final minutes' tension). */
  private mixMurmur(): void {
    if (!this.ctx || !this.murmurGain) return;
    const on = this.ambienceActive && this.crowdOn;
    const x = Math.max(this.nerves, this.tension * 0.7);
    const target = on && this.fill >= EMPTY_FILL ? (MURMUR_BASE + x * MURMUR_NERVES) * (0.7 + 0.3 * this.stadiumK) : 0;
    if (Math.abs(target - this.murmurLevel) < 0.001) return;
    this.murmurLevel = target;
    const t = this.ctx.currentTime;
    this.murmurGain.gain.setTargetAtTime(target, t, target ? 0.9 : 0.15);
    this.murmurLfo?.gain.setTargetAtTime(target * 0.45, t, 0.9);
  }

  /**
   * Nerves, 0..1 (src/audio/director.ts: late on with it level or one behind, the shootout; a little through the
   * break): the murmur rises. Cheap every frame (moves only on a change).
   */
  setNerves(x: number): void {
    this.nerves = Math.max(0, Math.min(1, x));
    this.mixMurmur();
  }

  /** 0 calm .. 1 edge-of-seat. */
  setExcitement(x: number): void {
    if (!this.ctx) return;
    const v = Math.max(0, Math.min(1, x));
    // (Every frame from the match: the params move only on a real change, or the first time on a new context.)
    if (Math.abs(v - this.excitement) < 0.01 && this.washLevel >= 0) {
      this.mixAmbience();
      return;
    }
    this.excitement = v;
    const t = this.ctx.currentTime;
    this.mixAmbience();
    this.crowdFilter.frequency.setTargetAtTime(950 + this.excitement * 450, t, 0.8);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, bus: AudioNode = this.sfxBus, attack = 0.005): { f: BiquadFilterNode; g: GainNode } {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 2, attack + dur + 0.05);
    return { f, g };
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bus: AudioNode = this.sfxBus, attack = 0.004): OscillatorNode {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  /** A pass, a clearance, a throw's first touch: the boot on the ball (a header gets its own thock). */
  /** tone(), returning its gain node (to send it on to the room tail). */
  private toneG(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bus: AudioNode = this.sfxBus, attack = 0.004): GainNode {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return g;
  }

  kick(power: number, header = false): void {
    if (!this.ready || !this.sfxOn) return;
    if (header) {
      this.header(power);
      return;
    }
    const t = this.ctx!.currentTime;
    const p = Math.max(0.15, Math.min(1, power));
    this.tone(t, 'sine', 170 + p * 30, 48, 0.1 + p * 0.05, 0.35 + p * 0.45);
    this.noiseBurst(t, 0.025 + p * 0.02, 'highpass', 1800, 0.7, 0.18 + p * 0.25);
  }

  /**
   * A shot: the boot's crack (a short bright transient), a low body under it, a hard one's whoosh of air, a short
   * room tail on it all, and, if it's on target, the crowd's "oooh" a beat later.
   */
  shot(power: number, onTarget = false): void {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const p = Math.max(0.2, Math.min(1, power));
    if (this.sfxOn) {
      const crack = this.noiseBurst(t, 0.014 + p * 0.01, 'highpass', 2600, 0.7, 0.3 + p * 0.3, this.sfxBus, 0.002);
      const body = this.toneG(t, 'sine', 140 + p * 50, 50, 0.11 + p * 0.07, 0.5 + p * 0.4);
      this.tone(t, 'triangle', 460, 190, 0.04, 0.14 + p * 0.06);
      this.wet(crack.g, 0.5);
      this.wet(body, 0.35);
      if (p > 0.55) {
        const air = this.noiseBurst(t + 0.02, 0.2, 'bandpass', 1900, 1.3, 0.06 + p * 0.07, this.sfxBus, 0.03);
        air.f.frequency.exponentialRampToValueAtTime(650, t + 0.24);
      }
    }
    if (onTarget) this.oohAt(t + 0.26, 0.55);
  }

  /** A header: a distinct dry "thock" (higher and hollower than a strike, no low body, no room tail). */
  header(power: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const p = Math.max(0.2, Math.min(1, power));
    this.tone(t, 'sine', 640, 360, 0.055, 0.3 + p * 0.18, this.sfxBus, 0.002);
    this.tone(t, 'triangle', 1280, 880, 0.028, 0.1 + p * 0.05, this.sfxBus, 0.001);
    this.noiseBurst(t, 0.018, 'bandpass', 2300, 2.2, 0.16 + p * 0.08, this.sfxBus, 0.001);
  }

  /** A short effortful grunt (a man going into or taking a challenge): no words, a voiced "hff". */
  grunt(): void {
    if (!this.ready || !this.sfxOn) return;
    const c = this.ctx!;
    const t = c.currentTime + 0.01;
    const f0 = 135 * (0.85 + Math.random() * 0.3);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + 0.14);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 650;
    f1.Q.value = 3;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1150;
    f2.Q.value = 4;
    const g = c.createGain();
    this.env(g, t, 0.012, 0.16, 0.13);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.2);
    this.noiseBurst(t, 0.09, 'bandpass', 900, 1.2, 0.07, this.sfxBus, 0.01);
  }

  /** A crunching challenge that won it (or a foul): the low thump, a heavier one for a slide, and a grunt. */
  tackleHit(heavy: boolean): void {
    if (!this.ready || !this.sfxOn) return;
    this.thump();
    if (heavy) {
      const t = this.ctx!.currentTime;
      const g = this.toneG(t, 'sine', 90, 34, 0.22, 0.45);
      this.wet(g, 0.2);
    }
    this.grunt();
  }

  bounce(speed: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 110, 55, 0.07, Math.min(0.28, speed * 0.03));
  }

  whistle(kind: 'short' | 'long' | 'end'): void {
    if (!this.ready || !this.sfxOn) return;
    const c = this.ctx!;
    const blow = (t: number, dur: number) => this.whistleBlow(t, dur);
    const t = c.currentTime;
    if (kind === 'short') blow(t, 0.28);
    else if (kind === 'long') {
      blow(t, 0.3);
      blow(t + 0.42, 0.9);
    } else {
      blow(t, 0.3);
      blow(t + 0.42, 0.3);
      blow(t + 0.84, 1.2);
    }
  }

  /** The referee's half-time whistle: two short blasts and a long one (matchSession, the 'whistle' event 'long'). */
  whistleHalf(): void {
    this.whistleBlows([0.24, 0.24, 1.0]);
  }

  /** The full-time whistle: three blasts, the last the longest (matchSession, the 'whistle' event 'end'). */
  whistleFull(): void {
    this.whistleBlows([0.5, 0.5, 1.3]);
  }

  /** Blasts of the given lengths (s), a short breath apart. */
  private whistleBlows(lengths: readonly number[]): void {
    if (!this.ready || !this.sfxOn) return;
    let t = this.ctx!.currentTime;
    for (const d of lengths) {
      this.whistleBlow(t, d);
      t += d + 0.14;
    }
  }

  /** One blast of the pea whistle at `t`, `dur` s long. */
  private whistleBlow(t: number, dur: number): void {
    const c = this.ctx!;
    for (const f of [2950, 3020]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = c.createOscillator();
      lfo.frequency.value = 26;
      const lg = c.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.setValueAtTime(0.14, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
    }
    this.noiseBurst(t, dur, 'bandpass', 3000, 3, 0.04);
  }

  /**
   * Off the woodwork: a metallic clang (a struck tube's inharmonic partials, the high ones dying first), the
   * strike's crack and a dull thunk of the frame, with a room tail.
   */
  post(speed: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const v = Math.min(1, speed / 22);
    const f0 = 360 + Math.random() * 50;
    const parts: [number, number, number][] = [[1, 1.0, 0.24], [2.76, 0.62, 0.16], [5.4, 0.34, 0.1], [8.93, 0.2, 0.06]];
    for (const [r, dur, pk] of parts) {
      const g = this.toneG(t, r > 5 ? 'triangle' : 'sine', f0 * r, f0 * r * 0.995, dur * (0.7 + v * 0.5), pk * (0.35 + v * 0.75), this.sfxBus, 0.001);
      this.wet(g, 0.45);
    }
    const crack = this.noiseBurst(t, 0.03, 'highpass', 3400, 0.7, 0.22 + 0.2 * v, this.sfxBus, 0.001);
    this.wet(crack.g, 0.3);
    this.tone(t, 'sine', 130, 70, 0.1, 0.25 * v + 0.08);
  }

  net(speed: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 0.35, 'bandpass', 2400, 0.6, Math.min(0.3, 0.05 + speed * 0.012), this.sfxBus, 0.01);
    n.f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
  }

  ooh(): void {
    if (!this.ready || !this.crowdOn) return;
    this.oohAt(this.ctx!.currentTime, 1);
  }

  /** The crowd's "oooh" at audio time `t`, `k` loud (never two on top of each other). */
  private oohAt(t: number, k: number): void {
    if (!this.ready || !this.crowdOn || t - this.lastOoh < 0.9) return;
    this.lastOoh = t;
    for (const [f0, f1, pk] of [[640, 380, 0.5], [1150, 820, 0.25]] as const) {
      const n = this.noiseBurst(t, 1.2, 'bandpass', f0, 5, pk * k, this.crowdBus, 0.18);
      n.f.frequency.exponentialRampToValueAtTime(f1, t + 1.3);
    }
  }

  /** The crowd drawing breath at a big save: a quick bright gasp falling away. */
  gasp(): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime + 0.05;
    const n = this.noiseBurst(t, 0.55, 'bandpass', 1650, 1.6, 0.38, this.crowdBus, 0.04);
    n.f.frequency.exponentialRampToValueAtTime(820, t + 0.6);
    this.noiseBurst(t + 0.05, 0.7, 'bandpass', 700, 1.2, 0.18, this.crowdBus, 0.08);
  }

  cheer(level = 1): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 1.6 * level, 'bandpass', 900, 0.7, 0.35 * level, this.crowdBus, 0.12);
    n.f.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
  }

  /**
   * A goal, in three beats: the ball hitting the net (a fat thud in the rigging), the crowd swelling up out of
   * it, then the stadium horn over the roar (and the claps after). `side` (a match): the home side's goal is the
   * whole ground going up and then singing; the away side's is their section going wild (panned, smaller) while
   * the home crowd groans. Omitted (a menu's celebration): the home roar, no song. The music ducks under it.
   */
  goal(side?: 0 | 1): void {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const away = side === 1;
    this.roarUntil = t + 6;
    this.duck(0.3, 4.5);
    if (this.sfxOn) {
      // 1. The net: a low thud and the rigging's rustle.
      const thud = this.toneG(t, 'sine', 95, 42, 0.26, 0.55, this.sfxBus, 0.004);
      this.wet(thud, 0.3);
      const rig = this.noiseBurst(t, 0.42, 'bandpass', 2200, 0.7, 0.26, this.sfxBus, 0.006);
      rig.f.frequency.exponentialRampToValueAtTime(800, t + 0.42);
    }
    if (this.crowdOn) {
      // 2. The crowd swelling up (from a beat after the net). (The away section's own gain makes theirs smaller.)
      const s0 = t + 0.1;
      const bus = away ? this.awayBus : this.crowdBus;
      const k = (away ? 1.3 : 1) * ROAR_LEVEL;
      const a = this.noiseBurst(s0, 4.2, 'bandpass', 480, 0.6, 0.85 * k, bus, 0.45);
      a.f.frequency.exponentialRampToValueAtTime(1300, s0 + 0.9);
      a.f.frequency.exponentialRampToValueAtTime(800, s0 + 4);
      this.noiseBurst(s0, 3.4, 'lowpass', 900, 0.5, 0.5 * k, bus, 0.4);
      // Rhythmic claps a few seconds later.
      for (let i = 0; i < 9; i++) {
        const ct = t + 2.4 + i * 0.36 + (i % 3 === 2 ? 0.12 : 0);
        this.noiseBurst(ct, 0.07, 'bandpass', 1700, 1.2, 0.22 * k, bus);
      }
      if (away) this.groanAt(t + 0.35, 0.8, 0);
      // Then the scorers' fans sing (once the roar has had its moment).
      if (side !== undefined) {
        const songs = side === 0 ? Sfx.HOME_GOAL_SONGS : Sfx.AWAY_GOAL_SONGS;
        this.forced = { kind: songs[this.goalSongs[side]++ % songs.length], stand: side, anthem: !away };
        this.chantT = 6;
        // (Whatever they were singing is drowned by the roar: the song after it never waits on it.)
        const ch = this.choirs[side];
        if (ch) ch.busy = 0;
      }
    }
    if (this.sfxOn && !away) {
      // 3. The stadium air horn, once the roar is up.
      const h0 = t + 0.55;
      for (const [f, pk] of [[233, 0.12], [466, 0.06], [349, 0.07]] as const) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1600;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, h0);
        g.gain.exponentialRampToValueAtTime(pk, h0 + 0.07);
        g.gain.setValueAtTime(pk, h0 + 1.05);
        g.gain.exponentialRampToValueAtTime(0.0001, h0 + 1.35);
        o.connect(lp).connect(g).connect(this.sfxBus);
        this.wet(g, 0.25);
        o.start(h0);
        o.stop(h0 + 1.45);
      }
    }
  }

  click(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 660, 990, 0.05, 0.07);
  }

  coin(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 988, 988, 0.07, 0.07);
    this.tone(t + 0.08, 'square', 1319, 1319, 0.22, 0.07);
  }

  /** Gloves on the ball: a bright slap and a thump (a catch muffles it). A big save: and the crowd's gasp. */
  save(caught = false, big = false): void {
    if (this.ready && this.sfxOn) {
      const t = this.ctx!.currentTime;
      const slap = this.noiseBurst(t, 0.035, 'highpass', 2100, 0.8, caught ? 0.2 : 0.32, this.sfxBus, 0.001);
      this.wet(slap.g, 0.3);
      this.tone(t, 'sine', 170, 75, 0.1, 0.38);
      if (caught) this.noiseBurst(t + 0.02, 0.08, 'lowpass', 600, 0.6, 0.22, this.sfxBus, 0.004);
      else this.noiseBurst(t, 0.06, 'bandpass', 900, 1, 0.2);
    }
    if (big) this.gasp();
  }

  /** "SAVE!": a bright two-note flash on top of the glove thump (a real stop, not a routine catch). */
  saveFlash(caught: boolean): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 880, 880, 0.06, 0.07);
    this.tone(t + 0.07, 'square', caught ? 1319 : 1175, caught ? 1319 : 1175, 0.16, 0.08);
    this.noiseBurst(t, 0.12, 'highpass', 2600, 0.7, 0.14, this.sfxBus, 0.01);
  }

  // ------------------------------------------------------------------ tackles

  /** A TACKLE press: the lunge itself, a quick whip of air (a slide gets a longer, lower swish). */
  whip(slide = false): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, slide ? 0.22 : 0.09, 'bandpass', slide ? 900 : 2200, 1.4, slide ? 0.22 : 0.26, this.sfxBus, 0.008);
    n.f.frequency.exponentialRampToValueAtTime(slide ? 400 : 700, t + (slide ? 0.24 : 0.1));
    if (!slide) this.tone(t, 'sine', 320, 90, 0.07, 0.12);
  }

  /** WON IT: a fat thump with a bright crack on top. */
  thump(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.wet(this.toneG(t, 'sine', 150, 40, 0.16, 0.6), 0.15);
    this.tone(t, 'triangle', 620, 180, 0.05, 0.18);
    this.noiseBurst(t, 0.05, 'highpass', 1500, 0.7, 0.3);
    this.noiseBurst(t + 0.02, 0.14, 'lowpass', 500, 0.5, 0.25);
  }

  /** A backflip: a quick swept whoosh of air. */
  whoosh(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 0.34, 'bandpass', 600, 1.1, 0.24, this.sfxBus, 0.06);
    n.f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    n.f.frequency.exponentialRampToValueAtTime(500, t + 0.34);
  }

  /** A body landing on the pile: a soft, low flop (no crack: nobody got tackled). */
  flop(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 120, 45, 0.14, 0.4);
    this.noiseBurst(t + 0.01, 0.12, 'lowpass', 420, 0.6, 0.22);
  }

  /** The ball cannoned off a body (a block): a dull thud, heavier for a shot. */
  block(shot = false): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 150, 62, 0.1, shot ? 0.5 : 0.34);
    this.noiseBurst(t, 0.07, 'lowpass', 520, 0.6, shot ? 0.26 : 0.16, this.sfxBus, 0.003);
  }

  // ------------------------------------------------------------------ SKILL moves (sim/skills.ts)

  /** A defender winding up a challenge on the human's man (the tell): a bright rising "ting", the cue to press SKILL. */
  skillTell(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 1480, 1980, 0.07, 0.11, this.sfxBus, 0.002);
    this.tone(t + 0.06, 'triangle', 1980, 2350, 0.08, 0.08, this.sfxBus, 0.002);
  }

  /**
   * A skill move: the swish of the move (a PERFECT also gets a bright metallic "shing" over it and the crowd's olé; a GOOD
   * a smaller shing and a lift from the stands). A plain or show-off move is just the swish, softer.
   */
  skillMove(grade: 'perfect' | 'good' | 'plain' | 'show'): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const big = grade === 'perfect';
    if (this.sfxOn) {
      const k = big ? 1 : grade === 'good' ? 0.8 : 0.55;
      const n = this.noiseBurst(t, 0.26, 'bandpass', 700, 1.2, 0.2 * k, this.sfxBus, 0.04);
      n.f.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      n.f.frequency.exponentialRampToValueAtTime(600, t + 0.26);
      if (big || grade === 'good') {
        for (const [f, pk] of (big ? [[2093, 0.11], [3136, 0.07], [4186, 0.04]] : [[1760, 0.08], [2637, 0.05]]) as [number, number][]) {
          const g = this.toneG(t + 0.02, 'triangle', f, f * 1.01, big ? 0.32 : 0.2, pk, this.sfxBus, 0.002);
          this.wet(g, 0.35);
        }
      }
    }
    if (big) this.ole(t + 0.12);
    else if (grade === 'good' && this.crowdOn) this.cheer(0.4);
  }

  /** The crowd's "o-LÉ!": two vowel-ish swells off the stands, the second higher and longer. */
  ole(at?: number, k = 1, stand: Stand = 0): void {
    if (!this.ready || !this.crowdOn) return;
    const t = at ?? this.ctx!.currentTime;
    const bus = this.standBus(stand);
    const o = this.noiseBurst(t, 0.22, 'bandpass', 480, 4, 0.32 * k, bus, 0.05);
    o.f.frequency.exponentialRampToValueAtTime(620, t + 0.2);
    this.noiseBurst(t, 0.2, 'bandpass', 1050, 5, 0.12 * k, bus, 0.05);
    const le = this.noiseBurst(t + 0.26, 0.6, 'bandpass', 760, 4, 0.42 * k, bus, 0.06);
    le.f.frequency.exponentialRampToValueAtTime(1050, t + 0.5);
    le.f.frequency.exponentialRampToValueAtTime(820, t + 0.9);
    this.noiseBurst(t + 0.26, 0.55, 'bandpass', 1900, 6, 0.14 * k, bus, 0.06);
  }

  /** Missed him: a soft scuff of boot on grass. */
  scuff(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 0.13, 'bandpass', 1300, 0.9, 0.14, this.sfxBus, 0.015);
    n.f.frequency.exponentialRampToValueAtTime(500, t + 0.14);
  }

  // ------------------------------------------------------------------ blitz power-ups

  /** A pickup collected: a quick rising arpeggio. */
  powerup(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const notes = [659, 880, 1109, 1319];
    notes.forEach((f, i) => this.tone(t + i * 0.055, 'square', f, f, 0.09, 0.07));
    this.tone(t + 0.22, 'triangle', 1319, 1760, 0.18, 0.08);
  }

  /** A power-up fired: each kind has its own voice. */
  powerUse(kind: string): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'turbo': {
        // A rev and a whoosh.
        this.tone(t, 'sawtooth', 120, 720, 0.35, 0.12);
        const n = this.noiseBurst(t + 0.05, 0.4, 'bandpass', 600, 1.2, 0.2, this.sfxBus, 0.06);
        n.f.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
        break;
      }
      case 'mega': {
        // Ignition: a low boom under a rising roar.
        this.tone(t, 'sine', 90, 30, 0.35, 0.55);
        const n = this.noiseBurst(t, 0.5, 'lowpass', 400, 0.7, 0.35, this.sfxBus, 0.02);
        n.f.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
        this.tone(t + 0.05, 'sawtooth', 160, 420, 0.4, 0.08);
        break;
      }
      case 'freeze': {
        // A glassy descending shimmer.
        [1976, 1568, 1319, 988].forEach((f, i) => this.tone(t + i * 0.07, 'sine', f, f * 0.98, 0.3, 0.09));
        const n = this.noiseBurst(t, 0.6, 'highpass', 5000, 0.7, 0.08, this.sfxBus, 0.05);
        n.f.frequency.exponentialRampToValueAtTime(9000, t + 0.6);
        break;
      }
      case 'magnet': {
        // An electric hum with a crackle.
        this.tone(t, 'square', 55, 110, 0.5, 0.09);
        this.tone(t, 'sawtooth', 220, 440, 0.45, 0.05);
        for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.04 + i * 0.07, 0.02, 'highpass', 3000, 1, 0.1);
        break;
      }
      default: {
        // Shield: a warm bubble popping up.
        this.tone(t, 'sine', 330, 660, 0.2, 0.14);
        this.tone(t + 0.08, 'triangle', 660, 990, 0.3, 0.1);
        this.noiseBurst(t, 0.12, 'bandpass', 1800, 2, 0.06, this.sfxBus, 0.02);
        break;
      }
    }
  }

  /** A pickup landing on the pitch: a soft two-note blip (the eye goes to the pop). */
  spawnBlip(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 784, 784, 0.06, 0.05);
    this.tone(t + 0.07, 'triangle', 1175, 1175, 0.12, 0.05);
  }

  /** A power-up wearing off: a short falling blip. */
  powerEnd(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 660, 330, 0.16, 0.06);
  }

  /** The shield took a tackle: a bright bonk. */
  shieldHit(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 520, 260, 0.14, 0.2);
    this.noiseBurst(t, 0.04, 'bandpass', 2000, 1.5, 0.12);
  }

  // ------------------------------------------------------------------ the crowd: chants and reactions

  /** What the away section answers a home chant with. */
  private static readonly AWAY_ANSWERS: readonly ChantKind[] = ['name', 'claps', 'ole', 'comeon', 'allez', 'weare'];
  private static readonly HOME_GOAL_SONGS: readonly ChantKind[] = ['ohs', 'allez', 'weare', 'herewego'];
  private static readonly AWAY_GOAL_SONGS: readonly ChantKind[] = ['name', 'comeon', 'letsgo', 'weare'];
  /** "Oh oh oh": [beat, beats long, MIDI] (G3 A3 G3 E3 G3 C3, then the answer down to C, an anthem's third line up). */
  private static readonly OH_LINES: readonly (readonly (readonly [number, number, number])[])[] = [
    [[0, 1.5, 55], [1.5, 0.5, 57], [2, 1, 55], [3, 1, 52], [4, 1, 55], [5, 2.6, 48]],
    [[8, 1.5, 55], [9.5, 0.5, 57], [10, 1, 55], [11, 1, 52], [12, 1, 50], [13, 2.6, 48]],
    [[16, 1.5, 55], [17.5, 0.5, 57], [18, 1, 59], [19, 1, 60], [20, 1, 59], [21, 2.6, 60]],
  ];
  /** The trumpet's charge: [sixteenth, sixteenths long, MIDI] (G C E G, E G). */
  private static readonly CHARGE: readonly (readonly [number, number, number])[] = [[0, 1, 67], [1, 1, 72], [2, 1, 76], [3, 2, 79], [5, 1, 76], [6, 4, 79]];
  /** "O-LE, o-le o-le o-LE": [beat, beats long, MIDI, vowel, consonant]; the last LE takes the line's top note. */
  private static readonly OLE_LINE: readonly (readonly [number, number, number, string, string])[] = [
    [0, 0.45, 57, 'o', ''], [0.5, 1.3, 62, 'e', 'l'],
    [2.25, 0.35, 57, 'o', ''], [2.6, 0.55, 60, 'e', 'l'], [3.25, 0.35, 57, 'o', ''], [3.6, 0.55, 60, 'e', 'l'],
    [4.25, 0.4, 59, 'o', ''], [4.7, 1.5, 0, 'e', 'l'],
  ];
  private chantWeights = new Float32Array(CHANT_KINDS.length);

  /** Where a choir's voices go: 0 the home crowd, 1 the away section (quieter, panned to one side), 2 / 3 the home crowd's two ends. */
  private standBus(who: number): AudioNode {
    if (who === 1 && this.awayBus) return this.awayBus;
    if (who >= 2 && this.endBus[who - 2]) return this.endBus[who - 2];
    return this.crowdBus;
  }

  /** The two choirs a call and its answer come from: the home crowd's two ends; the away section has only itself. */
  private callEnds(stand: Stand): readonly [number, number] {
    return stand === 0 && this.choirs.length >= 4 ? [2, 3] : [stand, stand];
  }

  /** Room in the crowd's voice budget for `n` more voices until audio time `until` (booked if so). */
  private claim(n: number, until: number): boolean {
    const now = this.ctx!.currentTime;
    let busy = 0;
    for (let i = 0; i < VOICE_CAP; i++) if (this.voiceEnd[i] > now) busy++;
    if (busy + n > VOICE_CAP) return false;
    for (let i = 0; i < VOICE_CAP && n > 0; i++) {
      if (this.voiceEnd[i] <= now) {
        this.voiceEnd[i] = until;
        n--;
      }
    }
    return true;
  }

  /** The next chant for this ground: a small one drums and blows its trumpet more, a big one sings more. */
  private pickChant(): ChantKind {
    const size = this.size;
    const small = 1 - size;
    const w = this.chantWeights;
    // (In CHANT_KINDS order.)
    w[0] = 1;
    w[1] = 0.9 + size * 0.5;
    w[2] = 1.2;
    w[3] = 0.5 + small * 0.7;
    w[4] = 0.15 + small * 0.8;
    w[5] = 1.2 + size * 0.3;
    w[6] = 1;
    w[7] = 0.9;
    w[8] = 0.6 + size * 0.7;
    w[9] = 0.8;
    w[10] = 0.7 + size * 0.3;
    w[11] = 0.9;
    w[12] = 0.6;
    w[13] = 1.1;
    w[14] = 1;
    w[15] = 0.7 + size * 0.5;
    w[16] = 0.8 + size * 0.3;
    const kinds = CHANT_KINDS;
    let sum = 0;
    for (let i = 0; i < kinds.length; i++) if (kinds[i] !== this.lastChant) sum += w[i];
    let r = Math.random() * sum;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === this.lastChant) continue;
      r -= w[i];
      if (r <= 0) return kinds[i];
    }
    return 'claps';
  }

  /**
   * A crowd singing `notes` on choir `who`: `voices` saws in ragged unison (two groups a breath apart, one voice in
   * four an octave down, one in six an octave up and softer, each scooping up into its note and sagging off the end
   * of it) and a little breath, through the choir's vowel formants. What makes it WORDS: each syllable sets the
   * formants to its vowel, a vowel that moves glides them inside the syllable ("ei", "ow"), a voiced consonant shuts
   * them first and opens into the vowel (l n m w y r v), a breath or a burst is noise in front of it (h; k t p ...).
   * Notes in time order; a chant calls this in time order too (each call takes the formants from its first note on).
   * Returns the end.
   */
  private sing(t0: number, notes: readonly SungNote[], voices: number, level: number, who: number, spread = 0.022): number {
    const ch = this.choirs[who] ?? this.choirs[0];
    if (!ch || !notes.length) return t0;
    const c = this.ctx!;
    const last = notes[notes.length - 1];
    const start = t0 + notes[0][0];
    const end = t0 + last[0] + last[1];
    const f1 = ch.f1.frequency;
    const f2 = ch.f2.frequency;
    f1.cancelScheduledValues(start);
    f2.cancelScheduledValues(start);
    const groups = voices >= 4 ? 2 : 1;
    const envs: GainNode[] = [];
    for (let g = 0; g < groups; g++) {
      const e = c.createGain();
      e.gain.value = 0;
      e.gain.setValueAtTime(0, start);
      e.connect(ch.input);
      envs.push(e);
    }
    const lv = level / Math.sqrt(voices);
    const bus = this.standBus(who);
    for (const [at, dur, , v, on] of notes) {
      const s = t0 + at;
      const [F1, F2] = VOWELS[v[0]] ?? VOWELS.o;
      const to = v.length > 1 ? VOWELS[v[1]] : undefined;
      const shut = on ? CLOSURES[on] : undefined;
      let open = s;
      if (shut) {
        // Shut, then open into the vowel: "l", "n", "m".
        open = s + Math.min(0.07, dur * 0.3);
        f1.setValueAtTime(shut[0], s);
        f2.setValueAtTime(shut[1], s);
        f1.linearRampToValueAtTime(F1, open);
        f2.linearRampToValueAtTime(F2, open);
      } else {
        f1.setValueAtTime(F1, s);
        f2.setValueAtTime(F2, s);
        // (A breath for "h"; a hard edge for the rest: the crowd spitting the word out.)
        if (on === 'h') this.noiseBurst(Math.max(start, s - 0.03), 0.07, 'bandpass', 1700, 0.8, 0.14 * level, bus, 0.012);
        else if (on) this.noiseBurst(s, 0.028, 'highpass', 2300, 0.8, 0.1 * level, bus, 0.002);
      }
      if (to) {
        // The vowel moves: "hEY" closes towards "i", "OH" rounds off to "oo".
        const g0 = Math.max(open + 0.01, s + dur * 0.3);
        const g1 = Math.max(g0 + 0.03, s + dur * 0.8);
        f1.setValueAtTime(F1, g0);
        f2.setValueAtTime(F2, g0);
        f1.linearRampToValueAtTime(to[0], g1);
        f2.linearRampToValueAtTime(to[1], g1);
      }
      const a = Math.min(0.05, dur * 0.3);
      for (let g = 0; g < groups; g++) {
        const off = g * 0.028;
        const p = envs[g].gain;
        p.setValueAtTime(0.0001, s + off);
        let up = s + off + a;
        if (shut) {
          p.linearRampToValueAtTime(lv * 0.4, s + off + 0.012);
          p.setValueAtTime(lv * 0.4, open + off);
          up = open + off + 0.03;
        }
        p.linearRampToValueAtTime(lv, up);
        p.setValueAtTime(lv * 0.82, Math.max(up + 0.01, s + off + dur - 0.07));
        p.linearRampToValueAtTime(0.0001, Math.max(up + 0.02, s + off + dur));
      }
    }
    for (let v = 0; v < voices; v++) {
      const o = c.createOscillator();
      const oct = v % 4 === 1 ? 0.5 : v % 6 === 5 ? 2 : 1;
      o.type = oct === 2 ? 'triangle' : 'sawtooth';
      const det = (1 + (Math.random() * 2 - 1) * spread) * oct;
      // (A crowd is never quite together: each voice a touch late in its own way.)
      const late = Math.random() * 0.03;
      for (const [at, dur, midi] of notes) {
        const f = midiHz(midi) * det;
        const s = t0 + at + late;
        o.frequency.setValueAtTime(f * 0.95, s);
        o.frequency.linearRampToValueAtTime(f, s + 0.06);
        o.frequency.setValueAtTime(f, s + Math.max(0.07, dur * 0.72));
        o.frequency.linearRampToValueAtTime(f * 0.975, s + Math.max(0.08, dur * 0.96));
      }
      o.connect(envs[v % groups]);
      o.start(start);
      o.stop(end + 0.1);
    }
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const ng = c.createGain();
    ng.gain.value = 0.7;
    n.connect(ng).connect(envs[0]);
    n.start(start, Math.random() * 2);
    n.stop(end + 0.1);
    return end + (groups - 1) * 0.028;
  }

  /**
   * A word shouted syllable by syllable from `at` s (wordSyllables), `step` s apart on `midi`, the last one held and
   * dropped a tone (how a terrace lands a name). Appends to `out`; returns when it ends (s).
   */
  private wordNotes(word: string, at: number, step: number, midi: number, out: SungNote[]): number {
    const syl = wordSyllables(word);
    for (let i = 0; i < syl.length; i++) {
      const lastOne = i === syl.length - 1;
      out.push([at + i * step, lastOne ? step * 1.5 : step * 0.92, lastOne ? midi - 2 : midi, syl[i][0], syl[i][1]]);
    }
    return at + (syl.length - 1) * step + step * 1.5;
  }

  /** A clap from a crowd: a few distinct pairs of hands at a small ground, one smeared crack from a big one. */
  private clap(t: number, k: number, bus: AudioNode): void {
    const hands = this.size < 0.3 ? 3 : this.size < 0.7 ? 2 : 1;
    if (hands === 1) {
      this.noiseBurst(t, 0.09, 'bandpass', 1500, 0.6, 0.26 * k, bus, 0.012);
      return;
    }
    for (let i = 0; i < hands; i++) {
      this.noiseBurst(t + Math.random() * 0.03, 0.045, 'bandpass', 1200 + Math.random() * 1000, 1.3, (0.26 / Math.sqrt(hands)) * k, bus, 0.002);
    }
  }

  /** The crowd's bass drum (a phone speaker hears the skin's knock more than the boom). */
  private drum(t: number, k: number, bus: AudioNode): void {
    this.tone(t, 'sine', 140, 62, 0.2, 0.42 * k, bus, 0.002);
    this.tone(t, 'triangle', 280, 120, 0.07, 0.16 * k, bus, 0.001);
    this.noiseBurst(t, 0.03, 'bandpass', 1100, 0.9, 0.12 * k, bus, 0.001);
  }

  /** A whole end shouting "HEY!": a breath, then "e" closing to "i". */
  private hey(t: number, k: number, who: number, voices: number, midi = 57): void {
    this.sing(t, [[0, 0.32, midi, 'ei', 'h']], voices, 0.6 * k, who, 0.035);
  }

  /** Clap clap, clap-clap-clap, clap-clap-clap-clap, and the club's name shouted; twice (a small ground's drummer banging along). */
  private chantClaps(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.28;
    const small = this.size < 0.5;
    let at = t;
    for (let r = 0; r < 2; r++) {
      for (const x of [0, 1, 2.5, 3, 3.5, 5, 5.5, 6, 6.5]) this.clap(at + x * b, k, bus);
      for (const x of small ? [0, 2.5, 5] : [0]) this.drum(at + x * b, (small ? 0.8 : 0.6) * k, bus);
      const notes: SungNote[] = [];
      const done = this.wordNotes(this.words[stand][0], 8 * b, 0.24, 59, notes);
      this.sing(at, notes, voices, k, stand);
      this.drum(at + 8 * b, 0.9 * k, bus);
      at += done + 0.42;
    }
    return at;
  }

  /** "Oh oh oh": a sung line and its answer (an anthem after a goal: a third line climbing, louder, faster). */
  private chantOhs(t: number, k: number, stand: Stand, voices: number, anthem: boolean): number {
    const b = anthem ? 0.4 : 0.42;
    const lines = anthem ? 3 : 2;
    const notes: SungNote[] = [];
    // (The long ones round off: "ohhh-oo".)
    for (let i = 0; i < lines; i++) for (const [at, len, m] of Sfx.OH_LINES[i]) notes.push([at * b, len * b * 0.95, m, len >= 1 ? 'ow' : 'o']);
    const bus = this.standBus(stand);
    const small = this.size < 0.5;
    for (let i = 0; i < lines; i++) {
      const l0 = t + i * 8 * b;
      for (const x of small ? [0, 2, 4] : [0, 4]) this.drum(l0 + x * b, 0.75 * k, bus);
      for (const x of [6, 6.5, 7]) this.clap(l0 + x * b, k, bus);
    }
    return this.sing(t, notes, voices, 0.9 * k, stand);
  }

  /** The club's name, every word of it, syllable by syllable, clap clap clap after it; three times. */
  private chantName(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const words = this.words[stand];
    let at = t;
    for (let r = 0; r < 3; r++) {
      const notes: SungNote[] = [];
      let x = 0;
      for (const w of words) x = this.wordNotes(w, x, 0.23, r === 2 ? 59 : 57, notes) + 0.06;
      this.sing(at, notes, voices, k, stand);
      this.drum(at, 0.8 * k, bus);
      for (let i = 0; i < 3; i++) this.clap(at + x + 0.1 + i * 0.2, k, bus);
      at += x + 0.9;
    }
    return at;
  }

  /** A drum march: BOOM BOOM BOOM (clap) four bars, a snare roll into the last, HEY on the second and fourth. */
  private chantDrum(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.4;
    for (let bar = 0; bar < 4; bar++) {
      const b0 = t + bar * 4 * b;
      for (let x = 0; x < 3; x++) this.drum(b0 + x * b, (x === 0 ? 1 : 0.8) * k, bus);
      if (bar === 3) {
        for (let i = 0; i < 4; i++) this.noiseBurst(b0 + (2.5 + i * 0.25) * b, 0.05, 'bandpass', 1900, 0.9, (0.08 + i * 0.02) * k, bus, 0.002);
      } else this.clap(b0 + 3 * b, k, bus);
    }
    this.hey(t + 7 * b, k, stand, voices);
    this.hey(t + 15 * b, k, stand, voices, 59);
    return t + 16 * b + 0.3;
  }

  /** A trumpet in the stand plays the charge, the fans roar "CHARGE!" back and clap; twice. */
  private chantHorn(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const e = 0.15;
    let at = t;
    for (let r = 0; r < 2; r++) {
      for (const [x, len, m] of Sfx.CHARGE) this.brassNote(at + x * e, m + r * 2, len * e * 0.9, 0.06 * k, bus, false);
      const shout = at + 10 * e + 0.1;
      this.drum(shout, k, bus);
      this.sing(shout, [[0, 0.45, 57 + r * 2, 'a', 't']], voices, 0.65 * k, stand, 0.04);
      for (let i = 0; i < 3; i++) this.clap(shout + 0.6 + i * 0.3, k, bus);
      at = shout + 1.6;
    }
    return at;
  }

  /** "O-LE, o-le o-le o-LE", twice (the second time up a tone at the top), the drum on every "o". */
  private chantOle(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.4;
    const notes: SungNote[] = [];
    for (let line = 0; line < 2; line++) {
      const l0 = line * 7 * b;
      for (const [at, len, m, v, on] of Sfx.OLE_LINE) {
        notes.push([l0 + at * b, len * b, m || (line ? 64 : 62), v, on || undefined]);
        if (!on) this.drum(t + l0 + at * b, 0.75 * k, bus);
      }
      for (const x of [6.2, 6.6]) this.clap(t + l0 + x * b, k, bus);
    }
    return this.sing(t, notes, voices, k, stand) + 0.1;
  }

  /** "COME ON" and the club's first word, clap clap clap; three times, the last one up a tone. */
  private chantComeOn(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.36;
    for (let r = 0; r < 3; r++) {
      const r0 = t + r * 6 * b;
      const up = r === 2 ? 2 : 0;
      const notes: SungNote[] = [[0, 0.42 * b, 55 + up, 'u', 'k'], [0.5 * b, 0.9 * b, 59 + up, 'o']];
      this.wordNotes(this.words[stand][0], 1.6 * b, 0.5 * b, 57 + up, notes);
      this.sing(r0, notes, voices, k, stand);
      this.drum(r0, 0.8 * k, bus);
      for (const x of [4, 4.5, 5]) this.clap(r0 + x * b, k, bus);
    }
    return t + 18 * b;
  }

  /** The two ends call and answer: "HEY!" from one, "HEY!" from the other, over the drum, quicker each time; then both. */
  private chantHey(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const [a, z] = this.callEnds(stand);
    let at = t;
    let b = 0.42;
    for (let r = 0; r < 4; r++) {
      this.drum(at, k, bus);
      this.drum(at + b, 0.85 * k, bus);
      this.hey(at + 2 * b, k, r % 2 ? z : a, voices, 57 + (r > 1 ? 2 : 0));
      this.clap(at + 3 * b, k, bus);
      at += 4 * b;
      b *= 0.9;
    }
    this.drum(at, k, bus);
    this.hey(at, 1.1 * k, a, voices, 62);
    if (z !== a) this.hey(at, 1.1 * k, z, voices, 62);
    return at + 0.45;
  }

  /** One end sings the club's first word, the other end its second (one word: the same back), claps after each; twice. */
  private chantCallName(t: number, k: number, stand: Stand, voices: number): number {
    const [a, z] = this.callEnds(stand);
    const words = this.words[stand];
    const b = 0.4;
    for (let r = 0; r < 2; r++) {
      const r0 = t + r * 8 * b;
      for (let half = 0; half < 2; half++) {
        const who = half ? z : a;
        const bus = this.standBus(who);
        const h0 = r0 + half * 4 * b;
        const notes: SungNote[] = [];
        this.wordNotes(words[half] ?? words[0], 0, 0.24, half ? 57 : 59, notes);
        this.sing(h0, notes, voices, k, who);
        this.drum(h0, 0.8 * k, bus);
        for (const x of [2.25, 2.75, 3.25]) this.clap(h0 + x * b, k, bus);
      }
    }
    return t + 16 * b;
  }

  /** Boom boom CLAP, five bars; from the third the whole stand shouts "OH!" on the clap. */
  private chantStomp(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.3;
    for (let bar = 0; bar < 5; bar++) {
      const b0 = t + bar * 4 * b;
      this.drum(b0, k, bus);
      this.drum(b0 + b, k, bus);
      this.clap(b0 + 2 * b, 1.2 * k, bus);
      if (bar >= 2) this.sing(b0 + 2 * b, [[0, 0.3, bar === 4 ? 62 : 59, 'ow']], voices, 0.6 * k, stand, 0.035);
    }
    return t + 20 * b;
  }

  /** "La la la la" down, "la la la la" back up, and a "HEY!" with three claps. */
  private chantLaLa(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.4;
    const tune: readonly (readonly [number, number, number])[] = [
      [0, 0.8, 60], [1, 0.8, 59], [2, 0.8, 57], [3, 1.6, 55], [5, 0.8, 57], [6, 0.8, 59], [7, 0.8, 60], [8, 1.6, 62],
    ];
    const notes: SungNote[] = tune.map(([at, len, m]) => [at * b, len * b, m, 'a', 'l']);
    this.sing(t, notes, voices, 0.95 * k, stand);
    for (const x of [0, 3, 5, 8]) this.drum(t + x * b, 0.75 * k, bus);
    const h = t + 10.2 * b;
    this.hey(h, 1.05 * k, stand, voices, 64);
    for (let i = 0; i < 3; i++) this.clap(h + 0.5 + i * 0.22, k, bus);
    return h + 1.2;
  }

  /** "LET'S GO" and the club's first word, clap clap; three times. */
  private chantLetsGo(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.38;
    for (let r = 0; r < 3; r++) {
      const r0 = t + r * 5.5 * b;
      const notes: SungNote[] = [[0, 0.45 * b, 57, 'e', 'l'], [0.5 * b, 0.95 * b, 60, 'ow', 'g']];
      this.wordNotes(this.words[stand][0], 1.75 * b, 0.5 * b, r === 2 ? 59 : 57, notes);
      this.sing(r0, notes, voices, k, stand);
      this.drum(r0, 0.8 * k, bus);
      for (const x of [4, 4.5]) this.clap(r0 + x * b, 1.1 * k, bus);
    }
    return t + 16.5 * b;
  }

  /** A rolling "AL LEZ, AL LEZ" march, landing on the club name; the second line a tone higher. */
  private chantAllez(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.36;
    for (let r = 0; r < 2; r++) {
      const r0 = t + r * 10 * b;
      const up = r * 2;
      const notes: SungNote[] = [
        [0, 0.7 * b, 57 + up, 'a'], [b, 1.25 * b, 60 + up, 'e', 'l'],
        [2.8 * b, 0.7 * b, 59 + up, 'a'], [3.8 * b, 1.2 * b, 62 + up, 'e', 'l'],
      ];
      this.wordNotes(this.words[stand][0], 5.3 * b, 0.48 * b, 60 + up, notes);
      this.sing(r0, notes, voices, k, stand);
      for (const x of [0, 2.8, 5.3]) this.drum(r0 + x * b, 0.8 * k, bus);
      for (const x of [8, 9]) this.clap(r0 + x * b, k, bus);
    }
    return t + 20 * b;
  }

  /** A quick "HERE WE GO" three times, with an extra clap and higher last shout. */
  private chantHereWeGo(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    const b = 0.34;
    for (let r = 0; r < 3; r++) {
      const r0 = t + r * 5.5 * b;
      const notes: SungNote[] = [
        [0, 0.65 * b, 59, 'i', 'h'], [b, 0.65 * b, 57, 'i', 'w'],
        [2 * b, 1.25 * b, r === 2 ? 64 : 60, 'ow', 'g'],
      ];
      this.sing(r0, notes, voices, k, stand);
      this.drum(r0, 0.85 * k, bus);
      for (const x of [3.7, 4.3]) this.clap(r0 + x * b, k, bus);
    }
    return t + 16.5 * b;
  }

  /** One end calls "STAND UP FOR", the other answers the club name; clap clap. */
  private chantStandUp(t: number, k: number, stand: Stand, voices: number): number {
    const [a, z] = this.callEnds(stand);
    for (let r = 0; r < 2; r++) {
      const r0 = t + r * 3.4;
      this.sing(r0, [[0, 0.32, 57, 'a', 's'], [0.43, 0.32, 60, 'u'], [0.85, 0.38, 59, 'o', 'f']], voices, k, a);
      const answer: SungNote[] = [];
      this.wordNotes(this.words[stand][0], 0, 0.27, 62, answer);
      this.sing(r0 + 1.5, answer, voices, 1.05 * k, z);
      this.drum(r0, 0.8 * k, this.standBus(a));
      this.drum(r0 + 1.5, 0.8 * k, this.standBus(z));
      for (const x of [2.7, 3.05]) this.clap(r0 + x, k, this.standBus(stand));
    }
    return t + 6.8;
  }

  /** "WE ARE" the club, then a drawn-out "OH OH"; the club answers from both ends on the last line. */
  private chantWeAre(t: number, k: number, stand: Stand, voices: number): number {
    const bus = this.standBus(stand);
    for (let r = 0; r < 2; r++) {
      const r0 = t + r * 4;
      const notes: SungNote[] = [[0, 0.33, 57, 'i', 'w'], [0.4, 0.4, 59, 'a']];
      let at = 0.95;
      for (const word of this.words[stand]) at = this.wordNotes(word, at, 0.17, r ? 62 : 60, notes) + 0.06;
      notes.push([2.35, 0.5, 59, 'ow'], [2.95, 0.75, 55, 'ow']);
      this.sing(r0, notes, voices, k, stand);
      for (const x of [0, 0.8, 2.35, 2.95]) this.drum(r0 + x, 0.8 * k, bus);
      this.clap(r0 + 3.75, k, bus);
    }
    return t + 8;
  }

  /** A long rising "oooooh" over a quickening drum, breaking into "HEY!" and three claps. */
  private chantWhoa(t: number, k: number, stand: Stand, voices: number): number {
    const ch = this.choirs[stand];
    const c = this.ctx!;
    const bus = this.standBus(stand);
    const dur = 2.5;
    if (ch) {
      const [F1, F2] = VOWELS.o;
      ch.f1.frequency.cancelScheduledValues(t);
      ch.f2.frequency.cancelScheduledValues(t);
      ch.f1.frequency.setValueAtTime(F1 * 0.85, t);
      ch.f2.frequency.setValueAtTime(F2, t);
      // (The mouths open as it climbs.)
      ch.f1.frequency.linearRampToValueAtTime(F1 * 1.15, t + dur);
      ch.f2.frequency.linearRampToValueAtTime(F2 * 1.2, t + dur);
      const lv = (0.9 * k) / Math.sqrt(voices);
      const env = c.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(lv * 0.45, t + 0.3);
      env.gain.linearRampToValueAtTime(lv * 1.1, t + dur - 0.05);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + 0.06);
      env.connect(ch.input);
      for (let v = 0; v < voices; v++) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        const det = (1 + (Math.random() * 2 - 1) * 0.03) * (v % 4 === 1 ? 0.5 : 1);
        o.frequency.setValueAtTime(midiHz(50) * det, t);
        o.frequency.exponentialRampToValueAtTime(midiHz(61) * det, t + dur);
        o.connect(env);
        o.start(t);
        o.stop(t + dur + 0.15);
      }
      const n = c.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const ng = c.createGain();
      ng.gain.value = 0.7;
      n.connect(ng).connect(env);
      n.start(t, Math.random() * 2);
      n.stop(t + dur + 0.15);
    }
    // The drum: slow, then a roll.
    let x = 0;
    let gap = 0.42;
    while (x < dur - 0.05) {
      this.drum(t + x, (0.6 + 0.4 * (x / dur)) * k, bus);
      x += gap;
      gap = Math.max(0.09, gap * 0.82);
    }
    const h = t + dur + 0.12;
    this.drum(h, 1.1 * k, bus);
    this.hey(h, 1.15 * k, stand, voices, 62);
    for (let i = 0; i < 3; i++) this.clap(h + 0.5 + i * 0.22, k, bus);
    return h + 1.2;
  }

  /** Palms meeting on the touchline: a substitution's high five (game/matchSession.ts). */
  highFive(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.05, 'bandpass', 2100, 1.4, 0.3, this.sfxBus, 0.002);
    this.tone(t, 'triangle', 320, 180, 0.05, 0.08);
  }

  /** One fan shouting in a gap ("COME ON!", "GO ON!"): one voice through its own vowels, a little room on it. */
  private shout(t: number, k: number, stand: Stand): void {
    if (!this.claim(2, t + 0.8)) return;
    const c = this.ctx!;
    const syl = Math.random() < 0.5 ? 1 : 2;
    const f0 = 150 + Math.random() * 120;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 6;
    const g = c.createGain();
    g.gain.value = 0;
    let s = t;
    for (let i = 0; i < syl; i++) {
      const d = syl === 1 ? 0.42 : i === 0 ? 0.16 : 0.34;
      const [F1, F2] = VOWELS[i === syl - 1 ? 'o' : 'u'];
      f1.frequency.setValueAtTime(F1, s);
      f2.frequency.setValueAtTime(F2, s);
      o.frequency.setValueAtTime(f0 * (i ? 1.2 : 1), s);
      o.frequency.linearRampToValueAtTime(f0 * (i ? 1.4 : 1.1), s + d * 0.35);
      o.frequency.linearRampToValueAtTime(f0 * 0.85, s + d);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.3 * k, s + 0.03);
      g.gain.setValueAtTime(0.26 * k, s + d - 0.05);
      g.gain.linearRampToValueAtTime(0.0001, s + d);
      s += d + 0.03;
    }
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.standBus(stand));
    this.wet(g, 0.4);
    o.start(t);
    o.stop(s + 0.05);
  }

  /** The rising roar from end `end` as an attack gets into the final third ("ooooOOH"). */
  private surge(end: number, heat: number): void {
    const c = this.ctx!;
    const t = c.currentTime;
    if (!this.claim(2, t + 2.6)) return;
    const k = VOICE_LEVEL * (0.6 + 0.4 * this.stadiumK) * (0.7 + heat * 0.4);
    const pan = c.createStereoPanner();
    pan.pan.value = (end ? END_PAN : -END_PAN) * 0.8;
    pan.connect(this.crowdBus);
    const a = this.noiseBurst(t, 2.2, 'bandpass', 520, 0.8, 0.3 * k, pan, 0.8);
    a.f.frequency.exponentialRampToValueAtTime(1350, t + 1.4);
    const v = this.noiseBurst(t + 0.2, 1.8, 'bandpass', 700, 3, 0.16 * k, pan, 0.7);
    v.f.frequency.exponentialRampToValueAtTime(1150, t + 1.6);
  }

  /** The crowd's "awww" (a sitter missed, a penalty missed, a goal against at home): falling, deflated. */
  groan(k = 1, stand: Stand = 0): void {
    if (!this.ready || !this.crowdOn) return;
    this.groanAt(this.ctx!.currentTime + 0.05, k, stand);
  }

  private groanAt(t: number, k: number, stand: Stand): void {
    if (!this.crowdOn || t - this.lastGroan < 1.2 || !this.claim(5, t + 1.8)) return;
    this.lastGroan = t;
    const c = this.ctx!;
    const bus = this.standBus(stand);
    const kk = k * VOICE_LEVEL;
    const a = this.noiseBurst(t, 1.5, 'bandpass', 760, 4, 0.42 * kk, bus, 0.12);
    a.f.frequency.exponentialRampToValueAtTime(480, t + 1.5);
    const b = this.noiseBurst(t, 1.4, 'bandpass', 1250, 5, 0.2 * kk, bus, 0.12);
    b.f.frequency.exponentialRampToValueAtTime(880, t + 1.4);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 1.5;
    const g = c.createGain();
    this.env(g, t, 0.15, 0.09 * kk, 1.3);
    f.connect(g).connect(bus);
    for (let v = 0; v < 3; v++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      const f0 = (180 + v * 23) * (0.97 + Math.random() * 0.06);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.68, t + 1.4);
      o.connect(f);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  /** Applause from `stand` (a good tackle, a skill, the final whistle): a hiss of hands and the claps you pick out. */
  applause(k = 0.6, stand: Stand = 0): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime + 0.03;
    if (t - this.applauseAt < 1.5) return;
    const hands = 6 + Math.round((1 - this.size) * 8);
    if (!this.claim(1 + Math.min(hands, 8), t + 2.6)) return;
    this.applauseAt = t;
    const bus = this.standBus(stand);
    const kk = k * VOICE_LEVEL;
    this.noiseBurst(t, 2.4, 'bandpass', 2100, 0.6, (0.08 + 0.14 * this.size) * kk, bus, 0.18);
    for (let i = 0; i < hands; i++) {
      const at = t + (i / hands) * 1.8 + Math.random() * 0.25;
      this.noiseBurst(at, 0.04, 'bandpass', 1300 + Math.random() * 1100, 1.3, (0.09 + Math.random() * 0.06) * kk, bus, 0.002);
    }
  }

  /**
   * `stand` whistling (and, `boo`, booing): at the other side keeping the ball, at a foul on their man, and for the
   * final whistle when they're ahead. More whistlers the bigger the ground.
   */
  crowdWhistles(k = 0.7, stand: Stand = 0, boo = false): void {
    if (!this.ready || !this.crowdOn) return;
    const c = this.ctx!;
    const t = c.currentTime + 0.03;
    if (t - this.whistlesAt < 1) return;
    const n = 3 + Math.round(this.size * 4);
    if (!this.claim(n + (boo ? 4 : 0), t + 2)) return;
    this.whistlesAt = t;
    const bus = this.standBus(stand);
    const kk = k * VOICE_LEVEL;
    for (let i = 0; i < n; i++) {
      const s = t + Math.random() * 0.7;
      const dur = 0.45 + Math.random() * 0.7;
      const f = 2300 + Math.random() * 1100;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 0.9, s);
      o.frequency.exponentialRampToValueAtTime(f, s + 0.08);
      o.frequency.setValueAtTime(f, s + dur - 0.12);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, s + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05 * kk, s + 0.04);
      g.gain.setValueAtTime(0.05 * kk, s + dur - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g).connect(bus);
      o.start(s);
      o.stop(s + dur + 0.02);
    }
    if (!boo) return;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 330;
    f.Q.value = 1.2;
    const g = c.createGain();
    this.env(g, t + 0.1, 0.25, 0.14 * kk, 1.3);
    f.connect(g).connect(bus);
    for (let v = 0; v < 3; v++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      const f0 = (108 + v * 9) * (0.98 + Math.random() * 0.04);
      o.frequency.setValueAtTime(f0, t + 0.1);
      o.frequency.linearRampToValueAtTime(f0 * 0.93, t + 1.6);
      o.connect(f);
      o.start(t + 0.1);
      o.stop(t + 1.7);
    }
    this.noiseBurst(t + 0.1, 1.3, 'bandpass', 340, 3, 0.25 * kk, bus, 0.25);
  }

  /** A passing move: the olé on each pass from the fourth, louder the longer it goes (`n`: passes so far). */
  oleChain(n: number, stand: Stand = 0): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime + 0.05;
    if (t - this.oleAt < 0.8 || t < this.roarUntil || !this.claim(4, t + 1)) return;
    this.oleAt = t;
    this.ole(t, Math.min(1.25, 0.55 + (n - 4) * 0.12) * VOICE_LEVEL, stand);
  }

  /**
   * The final whistle (src/audio/director.ts): the winners' fans roar (the home crowd a huge one) and then sing,
   * the losers' groan; a draw gets applause from both ends. Regular chants stop.
   */
  fullTimeCrowd(winner: -1 | 0 | 1): void {
    this.chantGate = false;
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime + 0.05;
    if (winner < 0) {
      this.applause(0.8, 0);
      this.applauseAt = -9;
      this.applause(0.7, 1);
      return;
    }
    const w = winner as Stand;
    const l: Stand = w === 0 ? 1 : 0;
    const bus = this.standBus(w);
    const k = (w === 1 ? 1.3 : 1) * ROAR_LEVEL * 0.85;
    this.roarUntil = t + 4.5;
    const a = this.noiseBurst(t, 3.6, 'bandpass', 520, 0.6, 0.75 * k, bus, 0.3);
    a.f.frequency.exponentialRampToValueAtTime(1300, t + 0.7);
    a.f.frequency.exponentialRampToValueAtTime(850, t + 3.4);
    this.noiseBurst(t, 3, 'lowpass', 900, 0.5, 0.4 * k, bus, 0.3);
    this.applauseAt = -9;
    this.applause(1, w);
    this.groanAt(t + 0.2, 0.7, l);
    this.forced = { kind: w === 0 ? 'ohs' : 'name', stand: w, anthem: true };
    this.chantT = 4.6;
    const ch = this.choirs[w];
    if (ch) ch.busy = 0;
  }

  // ------------------------------------------------------------------ hooks for the HYPE layer (game/funPresent.ts)

  /**
   * The final minutes' tension, 0..1 (game/funPresent.ts, every frame; 0 outside them): the crowd's murmur rises
   * and the heartbeat (finalMinute) quickens. Cheap every frame: params move only on a change.
   */
  setTension(k: number): void {
    const v = Math.max(0, Math.min(1, k));
    if (Math.abs(v - this.tension) < 0.02 && !(v === 0 && this.tension !== 0)) return;
    this.tension = v;
    this.mixMurmur();
  }

  /**
   * FINAL MINUTE (on: the banner; off: the final whistle, the shootout, leaving the match): a heartbeat under the
   * match, quickening with setTension, the crowd's drum joining it once it's tight, and both ends rising as it
   * starts. Calling it twice with the same value changes nothing.
   */
  finalMinute(on: boolean): void {
    if (on === this.finalOn) return;
    this.finalOn = on;
    if (!on || !this.ready) return;
    const t = this.ctx!.currentTime;
    this.beatNext = t + 0.25;
    this.beatN = 0;
    if (this.crowdOn && this.ambienceActive && this.fill >= EMPTY_FILL) {
      this.surge(0, 0.8);
      this.surge(1, 0.8);
    }
  }

  /** The final minutes' heartbeat: lub-dub, 70 to 118 a minute with the tension; the crowd's drum on it when tight. */
  private heartbeat(now: number): void {
    // (After a pause or a hitch: on from now, never a burst of the beats missed.)
    if (this.beatNext < now - 0.1) this.beatNext = now + 0.05;
    while (this.beatNext < now + 0.15) {
      const t = this.beatNext;
      const k = (0.7 + this.tension * 0.3) * HEART_LEVEL;
      this.tone(t, 'sine', 92, 50, 0.13, 0.5 * k, this.sfxBus, 0.006);
      this.tone(t, 'triangle', 180, 95, 0.06, 0.12 * k, this.sfxBus, 0.004);
      this.tone(t + 0.17, 'sine', 80, 46, 0.11, 0.34 * k, this.sfxBus, 0.006);
      this.tone(t + 0.17, 'triangle', 160, 85, 0.05, 0.08 * k, this.sfxBus, 0.004);
      if (this.crowdOn && this.tension > 0.7 && this.beatN % 2 === 0 && this.fill >= EMPTY_FILL) this.drum(t, 0.7 * this.tension, this.crowdBus);
      this.beatN++;
      this.beatNext += 60 / (70 + this.tension * 48);
    }
  }

  /**
   * The SUPER SHOT struck (game/funPresent.ts): a thunderclap and a boom at the boot, then the riser, the ball
   * screaming towards goal, and a crackle of lightning off it. A second call within a second is ignored.
   */
  superShot(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    if (t - this.superAt < 1) return;
    this.superAt = t;
    this.duck(0.5, 1.5);
    const crack = this.noiseBurst(t, 0.06, 'highpass', 2400, 0.7, 0.5, this.sfxBus, 0.001);
    this.wet(crack.g, 0.6);
    this.wet(this.toneG(t, 'sine', 120, 38, 0.55, 0.7, this.sfxBus, 0.003), 0.5);
    this.tone(t, 'triangle', 240, 70, 0.3, 0.22, this.sfxBus, 0.002);
    const r = this.noiseBurst(t + 0.04, 0.9, 'bandpass', 500, 1.6, 0.22, this.sfxBus, 0.5);
    r.f.frequency.exponentialRampToValueAtTime(3600, t + 0.85);
    this.tone(t + 0.02, 'sawtooth', 220, 1760, 0.75, 0.05, this.sfxBus, 0.25);
    this.tone(t + 0.02, 'square', 330, 2640, 0.75, 0.025, this.sfxBus, 0.25);
    for (let i = 0; i < 7; i++) this.noiseBurst(t + 0.05 + Math.random() * 0.6, 0.015, 'highpass', 4000, 0.8, 0.14, this.sfxBus, 0.001);
  }

  /** A live objective done (game/funPresent.ts): a bright chime up the C chord with a sparkle, a lift from the stands. */
  objectiveDone(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    if (this.sfxOn) {
      const notes = [1047, 1319, 1568, 2093];
      for (let i = 0; i < notes.length; i++) this.wet(this.toneG(t + i * 0.07, 'triangle', notes[i], notes[i], 0.32, 0.1, this.sfxBus, 0.003), 0.3);
      this.tone(t, 'square', 523, 523, 0.12, 0.04);
      this.noiseBurst(t + 0.2, 0.35, 'highpass', 6000, 0.7, 0.05, this.sfxBus, 0.01);
    }
    if (this.crowdOn && this.ambienceActive) this.cheer(0.4);
  }

  /**
   * Coins flying to the bank (game/funPresent.ts, a live objective's payout): a cascade of coin blips climbing in
   * pitch, 3 to 14 of them for `n` coins, over about a second.
   */
  coinsBurst(n: number): void {
    if (!this.ready || !this.sfxOn) return;
    const c = this.ctx!;
    const t0 = c.currentTime + 0.02;
    const count = Math.max(3, Math.min(14, Math.round(Math.sqrt(Math.max(0, n)) * 1.4)));
    for (let i = 0; i < count; i++) {
      const t = t0 + i * 0.065 + Math.random() * 0.02;
      const up = Math.pow(2, (i / count) * 0.6);
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(988 * up, t);
      o.frequency.setValueAtTime(1319 * up, t + 0.05);
      const g = c.createGain();
      this.env(g, t, 0.003, 0.05, 0.14);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  // ------------------------------------------------------------------ music: the menu loop, the match's songs, stings

  /** The song up now ('off': none; a sting may still be ringing). */
  get musicState(): TrackId | 'off' {
    return this.musicTimer !== null && this.trackId ? this.trackId : 'off';
  }

  /** The menu loop (the owner's favourite): another song playing crossfades into it; the menu already up, nothing. */
  startMusic(): void {
    this.playTrack('menu');
  }

  /**
   * Song `id` (music.ts SONGS): its intro once, then its loop, until another song or stopMusic. The song before
   * fades out under it; asking for the one already playing does nothing (it never doubles). `big`: a cup tie (1)
   * or a final (2): fatter brass, and a final won opens with the trophy fanfare.
   */
  playTrack(id: TrackId, big = 0): void {
    if (!this.ctx || !this.musicOn) return;
    if (this.trackId === id && this.musicTimer !== null) return;
    const c = this.ctx;
    const t = c.currentTime;
    this.fadeTrack(0.12);
    const song = id === 'win' && big >= 2 ? WIN_FINAL : SONGS[id];
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(song.level, t + (id === 'menu' ? 0.5 : 0.12));
    g.connect(this.musicDuck);
    this.trackGain = g;
    this.song = song;
    this.part = song.intro ?? song.loop;
    this.trackId = id;
    this.big = big;
    this.musicStep = 0;
    this.nextNoteTime = t + 0.1;
    // (Measuring offline, src/audio/dev.ts drives schedule() itself.)
    if (this.musicTimer === null) this.musicTimer = this.offline ? -1 : window.setInterval(() => this.schedule(), 30);
  }

  /**
   * The full-time music (main.ts, with the result screen): a win's fanfare and victory loop, a draw's warm theme,
   * a defeat's "go again"; `big` 1 a cup tie, 2 a final.
   */
  result(outcome: Outcome, big = 0): void {
    this.playTrack(outcome, big);
  }

  /** Stop the song, fading over `fadeS` s (0: at once, as a rebuild does). Stings already ringing finish. */
  stopMusic(fadeS = 0.15): void {
    if (this.musicTimer !== null) {
      if (this.musicTimer >= 0) clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.fadeTrack(fadeS / 3);
    this.trackId = null;
    this.song = null;
    this.part = null;
  }

  /** The playing song's gain out (time constant `tau`), and let go of it. */
  private fadeTrack(tau: number): void {
    const g = this.trackGain;
    this.trackGain = null;
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.setTargetAtTime(0, t, Math.max(0.01, tau));
  }

  /**
   * A one-shot cue (music.ts STINGS): the kick-off, a goal of ours (under the roar), the trophy and promotion
   * fanfares. Scheduled whole when it fires; the song playing ducks under it (not under a goal's: the roar does).
   */
  sting(id: StingId, big = 0): void {
    if (!this.ready || !this.musicOn) return;
    const c = this.ctx!;
    const tr = STINGS[id];
    const spb = 60 / tr.bpm / 2;
    const t0 = c.currentTime + 0.05;
    const g = c.createGain();
    g.gain.value = id === 'goal' ? 0.75 : 1;
    g.connect(this.musicBus);
    for (let s = 0; s < tr.steps; s++) this.playStep(tr, s, t0 + s * spb, g, big);
    if (id !== 'goal') this.duck(0.25, tr.steps * spb + 0.3);
    this.lastSting = id;
    this.stings++;
  }

  /** The career's big moments (ui/career.ts, ui/cup.ts): a trophy lifted, or promotion. */
  fanfare(kind: 'trophy' | 'promotion'): void {
    this.sting(kind, kind === 'trophy' ? 2 : 1);
  }

  /** Duck the songs to `depth` (0..1) for `holdS` s, then bring them back smoothly (goal roars, fanfares). */
  duck(depth: number, holdS: number): void {
    if (!this.ctx || !this.musicDuck) return;
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(depth, t, 0.08);
    g.setTargetAtTime(1, t + holdS, 0.6);
  }

  private schedule(): void {
    const c = this.ctx!;
    let tr = this.part ?? MENU.loop;
    // A throttled timer (a background tab runs intervals about once a second, or less) leaves the loop behind
    // the audio clock. Skip the missed notes, keeping the bar, instead of starting them all at once in a burst.
    if (this.nextNoteTime < c.currentTime) {
      const spb = 60 / tr.bpm / 2;
      const missed = Math.ceil((c.currentTime - this.nextNoteTime) / spb);
      this.musicStep += missed;
      this.nextNoteTime += missed * spb;
      tr = this.nextPart(tr);
    }
    const bus = this.trackGain ?? this.musicBus;
    while (this.nextNoteTime < c.currentTime + 0.12) {
      this.playStep(tr, this.musicStep, this.nextNoteTime, bus, this.big);
      this.nextNoteTime += 60 / tr.bpm / 2;
      this.musicStep++;
      tr = this.nextPart(tr);
    }
  }

  /** The intro has played through: on to the loop (the steps counting on from its start). */
  private nextPart(tr: Track): Track {
    const song = this.song;
    if (song?.intro && tr === song.intro && this.musicStep >= tr.steps) {
      this.musicStep -= tr.steps;
      this.part = song.loop;
      return song.loop;
    }
    return tr;
  }

  /** One eighth-note step of `tr` (music.ts) at audio time `t` into `bus`. */
  private playStep(tr: Track, step: number, t: number, bus: AudioNode, big: number): void {
    const s = step % tr.steps;
    const spb = 60 / tr.bpm / 2;
    const bar = Math.floor(s / 8) % tr.roots.length;
    const root = tr.roots[bar];
    const minor = tr.minor ? tr.minor[bar] : false;
    const b = tr.bass[s % tr.bass.length];
    if (b >= 0 && tr.bassLevel > 0) {
      const f = midiHz(root + b);
      this.tone(t, 'triangle', f, f, spb * tr.bassLen, tr.bassLevel, bus);
    }
    let a = tr.arp[s % tr.arp.length];
    if (a >= 0 && tr.arpLevel > 0) {
      if (minor && a % 12 === 4) a -= 1;
      const f = midiHz(root + 12 + a);
      this.tone(t, 'square', f, f, spb * 0.5, tr.arpLevel, bus);
    }
    const ln = tr.lead[s % tr.lead.length];
    if (ln > 0 && step >= (tr.leadFrom ?? 0)) {
      let len = 1;
      while (len < 16 && tr.lead[(s + len) % tr.lead.length] === -2) len++;
      const dur = spb * (len - 0.1);
      if (tr.leadType === 'brass') this.brassNote(t, ln, dur, tr.leadLevel * (1 + big * 0.2), bus, big > 0);
      else {
        const f = midiHz(ln);
        this.tone(t, tr.leadType, f, f, dur, tr.leadLevel, bus);
      }
    }
    const dl = tr.drumLevel ?? 1;
    switch (tr.drums[s % tr.drums.length]) {
      case 'h':
        this.hat(t, dl, bus);
        break;
      case 's':
        this.snare(t, dl, bus);
        break;
      case 'x':
        this.snare(t, dl, bus);
        this.hat(t, dl, bus);
        break;
      case 'k':
        this.kickDrum(t, dl, bus);
        break;
      case 'r':
        this.snare(t, 0.55 * dl, bus);
        this.snare(t + spb / 2, 0.7 * dl, bus);
        break;
      case 'c':
        this.crash(t, dl, bus);
        this.kickDrum(t, dl, bus);
        break;
      default:
        break;
    }
    if (tr.brass) {
      for (const [at, len] of tr.brass) {
        if (at === s) this.brassChord(t, root, minor, len * spb * 0.95, (tr.brassLevel ?? 0.05) * (1 + big * 0.25), bus, big);
      }
    }
  }

  private hat(t: number, k: number, bus: AudioNode): void {
    this.noiseBurst(t, 0.03, 'highpass', 7000, 0.7, 0.05 * k, bus);
  }

  private snare(t: number, k: number, bus: AudioNode): void {
    this.noiseBurst(t, 0.08, 'bandpass', 1800, 0.8, 0.12 * k, bus);
  }

  /** The music's kick: a short sine thump with a click a phone speaker can play. */
  private kickDrum(t: number, k: number, bus: AudioNode): void {
    this.tone(t, 'sine', 150, 52, 0.13, 0.3 * k, bus, 0.002);
    this.tone(t, 'triangle', 320, 110, 0.03, 0.1 * k, bus, 0.001);
  }

  private crash(t: number, k: number, bus: AudioNode): void {
    this.noiseBurst(t, 1.1, 'highpass', 4500, 0.6, 0.08 * k, bus, 0.002);
    this.noiseBurst(t, 0.45, 'bandpass', 3000, 0.8, 0.05 * k, bus, 0.002);
  }

  /** A brass note: two saws a few cents apart (and an octave up, `wide`) through a low-pass that opens like a lip. */
  private brassNote(t: number, midi: number, dur: number, level: number, bus: AudioNode, wide: boolean): void {
    const c = this.ctx!;
    const f = midiHz(midi);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(2800, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1500, t + Math.max(0.06, Math.min(0.3, dur)));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.025);
    g.gain.setValueAtTime(level * 0.85, t + Math.max(0.03, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    lp.connect(g).connect(bus);
    const n = wide ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (i === 2 ? 2 : i ? 1.004 : 0.996);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  /** A brass chord on `root` (root, third, fifth; the octave too for a cup tie or a final), around middle C. */
  private brassChord(t: number, root: number, minor: boolean, dur: number, level: number, bus: AudioNode, big: number): void {
    const c = this.ctx!;
    let base = root + 12;
    while (base < 55) base += 12;
    while (base > 66) base -= 12;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1;
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1700, t + Math.max(0.07, Math.min(0.35, dur)));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.03);
    g.gain.setValueAtTime(level * 0.85, t + Math.max(0.035, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    lp.connect(g).connect(bus);
    const tones = big > 0 ? 4 : 3;
    for (let i = 0; i < tones; i++) {
      const m = base + (i === 0 ? 0 : i === 1 ? (minor ? 3 : 4) : i === 2 ? 7 : 12);
      for (const d of [0.997, 1.003]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m) * d;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.12);
      }
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) this.stopMusic();
  }

  /** The dev panel (src/audio/dev.ts): what the sound is doing now. */
  debugState(): Record<string, unknown> {
    const c = this.ctx;
    const now = c?.currentTime ?? 0;
    let voices = 0;
    for (let i = 0; i < VOICE_CAP; i++) if (this.voiceEnd[i] > now) voices++;
    const v = (g: GainNode | null | undefined): number | null => (g ? +g.gain.value.toFixed(4) : null);
    return {
      ctx: c ? (this.offline ? 'offline' : c.state) : 'none',
      time: +now.toFixed(2),
      music: this.musicState,
      part: this.part && this.song ? (this.part === this.song.intro ? 'intro' : 'loop') : '-',
      step: this.musicStep,
      big: this.big,
      duck: v(this.musicDuck),
      trackGain: v(this.trackGain),
      lastSting: this.lastSting,
      stings: this.stings,
      musicOn: this.musicOn,
      sfxOn: this.sfxOn,
      crowdOn: this.crowdOn,
      ambience: this.ambienceActive,
      stadium: { level: this.stadiumLevel, fill: +this.fill.toFixed(2), k: +this.stadiumK.toFixed(2) },
      crowdBus: v(this.crowdBus),
      chantIn: +this.chantT.toFixed(1),
      lastChant: this.lastChant,
      chantGate: this.chantGate,
      forced: this.forced?.kind ?? null,
      syllables: this.syllables,
      words: this.words,
      bedDuck: v(this.bedBus),
      voices,
      nerves: this.nerves,
      tension: this.tension,
      finalOn: this.finalOn,
      murmur: +this.murmurLevel.toFixed(4),
      ends: this.ends.map((e) => +e.heat.toFixed(2)),
    };
  }
}

export const sfx = new Sfx();
