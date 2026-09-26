import { rainSamples } from './ambience';

/**
 * Every sound is synthesised with WebAudio — no asset downloads, no licences.
 * Crowd bed + reactions, whistle, kicks, woodwork, net, UI blips and a chiptune menu loop.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private crowdBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
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

  kick(power: number, header = false): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const p = Math.max(0.15, Math.min(1, power));
    if (header) {
      this.tone(t, 'sine', 260, 120, 0.08, 0.25 + p * 0.2);
      this.noiseBurst(t, 0.03, 'bandpass', 1400, 1, 0.12);
      return;
    }
    this.tone(t, 'sine', 170 + p * 30, 48, 0.1 + p * 0.05, 0.35 + p * 0.45);
    this.noiseBurst(t, 0.025 + p * 0.02, 'highpass', 1800, 0.7, 0.18 + p * 0.25);
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

  post(speed: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const v = Math.min(1, speed / 20);
    this.tone(t, 'sine', 523, 520, 1.1, 0.22 * v + 0.05);
    this.tone(t, 'sine', 1319, 1310, 0.7, 0.14 * v + 0.03);
    this.tone(t, 'triangle', 2217, 2200, 0.45, 0.09 * v + 0.02);
    this.noiseBurst(t, 0.04, 'highpass', 3000, 0.7, 0.2 * v);
  }

  net(speed: number): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 0.35, 'bandpass', 2400, 0.6, Math.min(0.3, 0.05 + speed * 0.012), this.sfxBus, 0.01);
    n.f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
  }

  ooh(): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime;
    for (const [f0, f1, pk] of [[640, 380, 0.5], [1150, 820, 0.25]] as const) {
      const n = this.noiseBurst(t, 1.2, 'bandpass', f0, 5, pk, this.crowdBus, 0.18);
      n.f.frequency.exponentialRampToValueAtTime(f1, t + 1.3);
    }
  }

  cheer(level = 1): void {
    if (!this.ready || !this.crowdOn) return;
    const t = this.ctx!.currentTime;
    const n = this.noiseBurst(t, 1.6 * level, 'bandpass', 900, 0.7, 0.35 * level, this.crowdBus, 0.12);
    n.f.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
  }

  goal(): void {
    if (!this.ready) return;
    const c = this.ctx!;
    const t = c.currentTime;
    if (this.crowdOn) {
      const a = this.noiseBurst(t, 4.2, 'bandpass', 500, 0.6, 0.85, this.crowdBus, 0.35);
      a.f.frequency.exponentialRampToValueAtTime(1300, t + 0.8);
      a.f.frequency.exponentialRampToValueAtTime(800, t + 4);
      this.noiseBurst(t, 3.4, 'lowpass', 900, 0.5, 0.5, this.crowdBus, 0.3);
      // Rhythmic claps a few seconds later.
      for (let i = 0; i < 9; i++) {
        const ct = t + 2.2 + i * 0.36 + (i % 3 === 2 ? 0.12 : 0);
        this.noiseBurst(ct, 0.07, 'bandpass', 1700, 1.2, 0.22, this.crowdBus);
      }
    }
    if (this.sfxOn) {
      // Stadium air horn.
      for (const [f, pk] of [[233, 0.12], [466, 0.06], [349, 0.07]] as const) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1600;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t + 0.15);
        g.gain.exponentialRampToValueAtTime(pk, t + 0.22);
        g.gain.setValueAtTime(pk, t + 1.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(lp).connect(g).connect(this.sfxBus);
        o.start(t + 0.15);
        o.stop(t + 1.6);
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

  save(): void {
    if (!this.ready || !this.sfxOn) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 140, 70, 0.12, 0.35);
    this.noiseBurst(t, 0.06, 'bandpass', 900, 1, 0.2);
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
    this.tone(t, 'sine', 150, 40, 0.16, 0.6);
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
