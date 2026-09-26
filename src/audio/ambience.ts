/** Quiet, decorrelated droplets rather than a full-volume loop of crowd noise. */
export function rainSamples(sampleRate: number, random = Math.random): [Float32Array, Float32Array] {
  const seconds = 6;
  const length = Math.round(sampleRate * seconds);
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (const samples of channels) {
    // A very faint distant shower underneath individual soft impacts.
    for (let i = 0; i < length; i++) samples[i] = (random() * 2 - 1) * 0.004;
    for (let drop = 0; drop < seconds * 95; drop++) {
      const start = Math.floor(random() * length);
      const decay = 0.004 + random() * 0.009;
      const duration = Math.ceil(decay * 6 * sampleRate);
      const amplitude = 0.035 + random() * 0.065;
      const frequency = 1700 + random() * 2300;
      for (let i = 0; i < duration; i++) {
        const t = i / sampleRate;
        const envelope = Math.min(1, t / 0.002) * Math.exp(-t / decay);
        const splash = (random() * 2 - 1) * 0.8 + Math.sin(t * frequency * Math.PI * 2) * 0.2;
        samples[(start + i) % length] += splash * envelope * amplitude;
      }
    }
    // A tiny seam fade prevents the loop boundary from clicking; it is not a repeating swell.
    const fade = Math.round(sampleRate * 0.012);
    for (let i = 0; i < length; i++) {
      samples[i] *= Math.min(1, i / fade, (length - 1 - i) / fade);
    }
  }
  return channels;
}
