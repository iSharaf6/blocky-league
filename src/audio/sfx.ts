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
  sfxOn = true;
  musicOn = true;
  crowdOn = true;

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
      this.master.gain.value = 0.9;
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
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private startCrowd(): void {
    const c = this.ctx!;
    this.crowdFilter = c.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 650;
    this.crowdFilter.Q.value = 0.5;
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
    this.crowdFilter.connect(this.crowdGain).connect(this.crowdBus);
  }

  setCrowd(active: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = active && this.crowdOn ? 0.1 + this.excitement * 0.28 : 0;
    this.crowdGain.gain.setTargetAtTime(target, t, 0.6);
  }

  /** 0 calm .. 1 edge-of-seat. */
  setExcitement(x: number): void {
    if (!this.ctx) return;
    this.excitement = x;
    const t = this.ctx.currentTime;
    if (this.crowdOn) this.crowdGain.gain.setTargetAtTime(0.1 + x * 0.28, t, 0.5);
    this.crowdFilter.frequency.setTargetAtTime(560 + x * 600, t, 0.5);
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
