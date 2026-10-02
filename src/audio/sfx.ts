import { rainSamples } from './ambience';

/**
 * Every sound is synthesised with WebAudio — no asset downloads, no licences, no voices.
 * Crowd bed + reactions, whistle, kicks, woodwork, net, UI blips and a chiptune menu loop.
 *
 * Impacts are layered (the owner's brief): a shot is the boot's transient, a low body, a short room tail and,
 * on target, a crowd "oooh"; a header is a dry, higher "thock"; a won tackle or a foul a low thump and a short
 * grunt (the referee's whistle comes from the sim); the woodwork a metallic clang; a goal the net, then the
 * crowd swelling, then the horn; a save a glove slap and a gasp. The crowd is two panned beds, one behind each
 * goal, that swell and get restless as the ball nears that end (setEnds), over a wash that follows the match's
 * excitement; the ground's size and crowd set how loud it all is and how often they sing (setStadium).
 *
 * CPU: the beds, the reverb and the buses are made once; per-frame calls only move AudioParams (and only when
 * the value really changes); nodes are only made when a sound plays.
 */
/** Room tail: a short, dark impulse (s) and how much of it each kind of hit sends. */
const REVERB_S = 0.55;
/** Crowd beds behind each goal: pan (left goal = -x on the broadcast shot) and loudness from calm to roaring. */
const END_PAN = 0.72;
const END_CALM = 0.012;
const END_ROAR = 0.15;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private crowdBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  /** Master output (after the compressor): what a clip's audio tap listens to. */
  private out!: DynamicsCompressorNode;
  /** The room tail's input (anything connected here gets the short reverb). */
  private reverbIn!: GainNode;
  /** Crowd beds behind the two goals (index 0: the -x end, 1: the +x end). */
  private ends: { gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode; heat: number }[] = [];
  /** How big and full the ground is: 0 (a muddy park) .. 1 (a sold-out Mega Dome). */
  private stadiumK = 1;
  private stadiumLevel = 5;
  private fill = 0.9;
  /** Seconds to the crowd's next chant, and the audio time until which a goal roar owns the stands. */
  private chantT = 8;
  private roarUntil = 0;
  private lastOoh = -9;
  /** A clip's audio tap (MediaStreamAudioDestinationNode), made on first use. */
  private tap: MediaStreamAudioDestinationNode | null = null;
  private tapping = false;
  private excitement = 0.2;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private effectsEnabled = true;
  private crowdEnabled = true;
  private ambienceActive = false;
  private rainActive = false;
  musicOn = true;
  private muted = false;

  get sfxOn(): boolean { return this.effectsEnabled; }
  set sfxOn(on: boolean) { this.effectsEnabled = on; this.mixAmbience(); }
  get crowdOn(): boolean { return this.crowdEnabled; }
  set crowdOn(on: boolean) { this.crowdEnabled = on; this.mixAmbience(); }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.out = comp;
      this.sfxBus = c.createGain();
      this.crowdBus = c.createGain();
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.32;
      this.sfxBus.connect(this.master);
      this.crowdBus.connect(this.master);
      this.musicBus.connect(this.master);
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
      this.startCrowd();
      this.startReverb();
      this.startEnds();
      this.applyStadium();
      this.setRain(this.rainActive);
      this.mixAmbience();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
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
    this.crowdFilter.connect(rumbleCut).connect(this.crowdGain).connect(this.crowdBus);
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
      src.connect(filter).connect(gain).connect(pan).connect(this.crowdBus);
      src.start(0, Math.random() * 2 + k);
      this.ends.push({ gain, filter, lfo, lfoGain, heat: -1 });
    }
  }

  /**
   * How hot each end is (0 a murmur .. 1 a roar): `left` the goal at -x, `right` the one at +x. Cheap to call
   * every frame: the params only move when a value changes by a step.
   */
  setEnds(left: number, right: number): void {
    if (!this.ctx || this.ends.length < 2) return;
    const t = this.ctx.currentTime;
    const on = this.ambienceActive && this.crowdOn;
    for (let k = 0; k < 2; k++) {
      const e = this.ends[k];
      const h = on ? Math.max(0, Math.min(1, k ? right : left)) : -0.5;
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
    this.stadiumLevel = Math.max(0, Math.min(5, level));
    this.fill = Math.max(0, Math.min(1, fill));
    this.stadiumK = (0.4 + 0.12 * this.stadiumLevel) * (0.55 + 0.45 * this.fill);
    this.chantT = this.chantGap() * (0.3 + Math.random() * 0.4);
    this.applyStadium();
  }

  private applyStadium(): void {
    if (!this.ctx || !this.crowdBus) return;
    this.crowdBus.gain.setTargetAtTime(Math.min(1.05, 0.5 + this.stadiumK * 0.55), this.ctx.currentTime, 0.3);
    for (const e of this.ends) e.heat = -1;
  }

  /** Seconds between chants for this ground (Infinity: a park with hardly anyone there never sings). */
  private chantGap(): number {
    const people = this.fill * (0.25 + this.stadiumLevel * 0.15);
    if (people < 0.12) return Infinity;
    return (40 - this.stadiumLevel * 5.5) / (0.6 + this.fill * 0.6);
  }

  /** Once a frame in a match: the crowd's chants (made only when one starts; never over a goal roar). */
  tick(dt: number): void {
    if (!this.ready || !this.crowdOn || !this.ambienceActive) return;
    this.chantT -= dt;
    if (this.chantT > 0) return;
    const gap = this.chantGap();
    this.chantT = Number.isFinite(gap) ? gap * (0.7 + Math.random() * 0.6) : 30;
    if (!Number.isFinite(gap) || this.ctx!.currentTime < this.roarUntil) return;
    this.chant();
  }

  /**
   * A chant: the classic clap rhythm (clap clap, clap-clap-clap) twice, and from a mid-sized ground up a sung
   * "oh-oh" line on top (more voices, a drum, the bigger the ground).
   */
  chant(): void {
    if (!this.ready || !this.crowdOn) return;
    const c = this.ctx!;
    const t = c.currentTime + 0.05;
    const lv = this.stadiumLevel;
    const k = 0.6 + 0.4 * this.fill;
    const beat = 0.34;
    const claps = [0, 1, 2.5, 3, 3.5];
    for (let r = 0; r < 2; r++) {
      for (const b of claps) {
        const ct = t + (r * 5 + b) * beat;
        this.noiseBurst(ct, 0.06, 'bandpass', 1500 + Math.random() * 300, 1.1, 0.11 * k, this.crowdBus, 0.004);
        if (lv >= 4) this.tone(ct, 'sine', 95, 55, 0.12, 0.12 * k, this.crowdBus);
      }
    }
    if (lv < 2) return;
    // Sung: two notes, a crowd of detuned voices through vowel formants ("oh"), louder the bigger the ground.
    const voices = lv >= 5 ? 5 : lv >= 3 ? 4 : 3;
    const notes: [number, number][] = [[0, 220], [2, 262], [5, 220], [7, 196]];
    const vf = c.createBiquadFilter();
    vf.type = 'bandpass';
    vf.frequency.value = 620;
    vf.Q.value = 1.4;
    const vf2 = c.createBiquadFilter();
    vf2.type = 'bandpass';
    vf2.frequency.value = 1050;
    vf2.Q.value = 2;
    const vg = c.createGain();
    vg.gain.value = 0.05 * k * (0.6 + lv * 0.1);
    vf.connect(vg);
    vf2.connect(vg);
    vg.connect(this.crowdBus);
    for (const [b, f] of notes) {
      const st = t + b * beat;
      for (let v = 0; v < voices; v++) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.03) * (v % 2 ? 0.5 : 1);
        const g = c.createGain();
        this.env(g, st, 0.08, 0.5 / voices, beat * 1.7);
        o.connect(g);
        g.connect(vf);
        g.connect(vf2);
        o.start(st);
        o.stop(st + beat * 2);
      }
    }
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
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Menu / pause / match transitions share one gate, so weather cannot leak between games. */
  setAmbienceActive(active: boolean): void {
    this.ambienceActive = active;
    this.mixAmbience();
  }

  private mixAmbience(): void {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    // About 10 dB less continuous crowd wash; cheers still provide the big moments.
    const target = this.ambienceActive && this.crowdOn ? 0.03 + this.excitement * 0.08 : 0;
    this.crowdGain.gain.setTargetAtTime(target, t, target ? 0.6 : 0.12);
    const rain = this.ambienceActive && this.rainActive && this.sfxOn ? 0.16 : 0;
    this.rainGain?.gain.setTargetAtTime(rain, t, rain ? 0.8 : 0.12);
    if (!(this.ambienceActive && this.crowdOn)) {
      // The end beds go quiet with the rest of the ambience (setEnds brings them back).
      for (const e of this.ends) {
        e.heat = -1;
        e.gain.gain.setTargetAtTime(0, t, 0.12);
        e.lfoGain.gain.setTargetAtTime(0, t, 0.12);
      }
    }
  }

  /** 0 calm .. 1 edge-of-seat. */
  setExcitement(x: number): void {
    if (!this.ctx) return;
    this.excitement = Math.max(0, Math.min(1, x));
    const t = this.ctx.currentTime;
    this.mixAmbience();
    this.crowdFilter.frequency.setTargetAtTime(950 + this.excitement * 450, t, 0.8);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, bus = this.sfxBus, attack = 0.005): { f: BiquadFilterNode; g: GainNode } {
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

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bus = this.sfxBus, attack = 0.004): OscillatorNode {
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
  private toneG(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bus = this.sfxBus, attack = 0.004): GainNode {
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
    const blow = (t: number, dur: number) => {
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
    };
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
   * it, then the stadium horn over the roar (and the claps after).
   */
  goal(): void {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    this.roarUntil = t + 6;
    if (this.sfxOn) {
      // 1. The net: a low thud and the rigging's rustle.
      const thud = this.toneG(t, 'sine', 95, 42, 0.26, 0.55, this.sfxBus, 0.004);
      this.wet(thud, 0.3);
      const rig = this.noiseBurst(t, 0.42, 'bandpass', 2200, 0.7, 0.26, this.sfxBus, 0.006);
      rig.f.frequency.exponentialRampToValueAtTime(800, t + 0.42);
    }
    if (this.crowdOn) {
      // 2. The crowd swelling up (from a beat after the net).
      const s0 = t + 0.1;
      const a = this.noiseBurst(s0, 4.2, 'bandpass', 480, 0.6, 0.85, this.crowdBus, 0.45);
      a.f.frequency.exponentialRampToValueAtTime(1300, s0 + 0.9);
      a.f.frequency.exponentialRampToValueAtTime(800, s0 + 4);
      this.noiseBurst(s0, 3.4, 'lowpass', 900, 0.5, 0.5, this.crowdBus, 0.4);
      // Rhythmic claps a few seconds later.
      for (let i = 0; i < 9; i++) {
        const ct = t + 2.4 + i * 0.36 + (i % 3 === 2 ? 0.12 : 0);
        this.noiseBurst(ct, 0.07, 'bandpass', 1700, 1.2, 0.22, this.crowdBus);
      }
    }
    if (this.sfxOn) {
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
  ole(at?: number): void {
    if (!this.ready || !this.crowdOn) return;
    const t = at ?? this.ctx!.currentTime;
    const o = this.noiseBurst(t, 0.22, 'bandpass', 480, 4, 0.32, this.crowdBus, 0.05);
    o.f.frequency.exponentialRampToValueAtTime(620, t + 0.2);
    this.noiseBurst(t, 0.2, 'bandpass', 1050, 5, 0.12, this.crowdBus, 0.05);
    const le = this.noiseBurst(t + 0.26, 0.6, 'bandpass', 760, 4, 0.42, this.crowdBus, 0.06);
    le.f.frequency.exponentialRampToValueAtTime(1050, t + 0.5);
    le.f.frequency.exponentialRampToValueAtTime(820, t + 0.9);
    this.noiseBurst(t + 0.26, 0.55, 'bandpass', 1900, 6, 0.14, this.crowdBus, 0.06);
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

  // ------------------------------------------------------------------ chiptune menu loop

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null || !this.musicOn) return;
    this.musicStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 30);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private schedule(): void {
    const c = this.ctx!;
    const spb = 60 / 132 / 2; // eighth notes
    // I–vi–IV–V in C, bouncy.
    const roots = [48, 45, 41, 43];
    const arp = [0, 7, 12, 16, 12, 7, 4, 7];
    const lead = [
      76, -1, 79, 76, 74, -1, 72, -1,
      72, -1, 76, 72, 69, -1, 67, -1,
      69, -1, 72, 69, 65, -1, 69, 72,
      71, -1, 74, 71, 67, 71, 74, 79,
    ];
    const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    // A throttled timer (a background tab runs intervals about once a second, or less) leaves the loop behind
    // the audio clock. Skip the missed notes, keeping the bar, instead of starting them all at once in a burst.
    if (this.nextNoteTime < c.currentTime) {
      const missed = Math.ceil((c.currentTime - this.nextNoteTime) / spb);
      this.musicStep += missed;
      this.nextNoteTime += missed * spb;
    }
    while (this.nextNoteTime < c.currentTime + 0.12) {
      const s = this.musicStep % 32;
      const bar = Math.floor(s / 8);
      const t = this.nextNoteTime;
      const root = roots[bar];
      if (s % 2 === 0) this.tone(t, 'triangle', hz(root), hz(root), spb * 1.6, 0.28, this.musicBus);
      this.tone(t, 'square', hz(root + 12 + arp[s % 8]), hz(root + 12 + arp[s % 8]), spb * 0.5, 0.05, this.musicBus);
      const ln = lead[s];
      if (ln > 0 && this.musicStep >= 32) this.tone(t, 'square', hz(ln), hz(ln), spb * 0.9, 0.06, this.musicBus);
      if (s % 2 === 1) this.noiseBurst(t, 0.03, 'highpass', 7000, 0.7, 0.05, this.musicBus);
      if (s % 8 === 4) this.noiseBurst(t, 0.08, 'bandpass', 1800, 0.8, 0.12, this.musicBus);
      this.nextNoteTime += spb;
      this.musicStep++;
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) this.stopMusic();
  }
}

export const sfx = new Sfx();
