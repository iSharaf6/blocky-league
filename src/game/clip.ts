/**
 * Goal clips to save or share (MatchSession.lastClip / clipSupported / lastPoster): the canvas recorded with
 * MediaRecorder (canvas.captureStream at CLIP_FPS, webm VP9 or VP8, at most CLIP_BPS) with the match audio when
 * the synth can hand over a stream. Everything is guarded: a browser without MediaRecorder / captureStream simply
 * has no clips, and nothing here ever throws into the frame loop. Encoding runs in the browser's media pipeline,
 * off the main thread; the frame loop only starts and stops it.
 */
import { inNativeApp } from '../platform/native';
export const CLIP_FPS = 30;
/** Video bitrate cap (bits/s): 4 Mbps for the picture and sound together. */
export const CLIP_BPS = 4_000_000;
const AUDIO_BPS = 96_000;
/** Longest clip (s): the replay (~5.5 s) with a little room. */
export const CLIP_MAX_S = 6.5;
/** Shorter than this (s) is not worth keeping (a replay skipped at once). */
export const CLIP_MIN_S = 1.2;

const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** The best webm type this browser records (with sound when `audio`), or null. */
export function clipMime(audio: boolean): string | null {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return null;
  for (const t of audio ? TYPES : VIDEO_TYPES) {
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      // (Some browsers throw on a type they don't know.)
    }
  }
  return null;
}

/** Can this browser record the game canvas at all? */
export function clipSupported(): boolean {
  // (Not in the iPhone / iPad app: a WebM can't go to Photos there, and a download goes nowhere.)
  if (inNativeApp()) return false;
  if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
  return clipMime(false) !== null;
}

export interface Clip {
  blob: Blob;
  name: string;
}

export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private name = '';
  private t = 0;
  private onDone: (() => void) | null = null;
  /** Keep what the recorder hands over when it stops (false: too short, thrown away). */
  private keep = true;
  /** The last finished clip (kept until the next one is finished). */
  last: Clip | null = null;

  get recording(): boolean {
    return this.rec !== null;
  }

  /** Seconds recorded so far (0 when idle). */
  get seconds(): number {
    return this.rec ? this.t : 0;
  }

  /**
   * Start recording `canvas` (with `audio`'s tracks, if any) as `name`. False when this browser can't, or a clip
   * is already rolling. `onDone` runs when the recorder has let go of the stream (the audio tap can close then).
   */
  start(canvas: HTMLCanvasElement, name: string, audio: MediaStream | null = null, onDone: (() => void) | null = null): boolean {
    if (this.rec || !clipSupported()) return false;
    try {
      const video = canvas.captureStream(CLIP_FPS);
      const tracks = [...video.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
      const withAudio = tracks.length > video.getVideoTracks().length;
      const mimeType = clipMime(withAudio) ?? clipMime(false);
      if (!mimeType) {
        for (const t of video.getTracks()) t.stop();
        return false;
      }
      const stream = new MediaStream(mimeType.includes('opus') ? tracks : video.getVideoTracks());
      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: CLIP_BPS - (mimeType.includes('opus') ? AUDIO_BPS : 0),
        ...(mimeType.includes('opus') ? { audioBitsPerSecond: AUDIO_BPS } : {}),
      });
      this.chunks = [];
      this.name = name;
      this.t = 0;
      this.keep = true;
      this.onDone = onDone;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      rec.onstop = () => this.finish(mimeType);
      rec.onerror = () => this.abort();
      // (A timeslice: the data arrives in pieces, so a stop never has one big encode to flush.)
      rec.start(500);
      this.rec = rec;
      this.stream = video;
      return true;
    } catch {
      this.abort();
      return false;
    }
  }

  /** Advance the clock; the clip stops itself at CLIP_MAX_S. */
  update(dt: number): void {
    if (!this.rec) return;
    this.t += dt;
    if (this.t >= CLIP_MAX_S) this.stop();
  }

  /** Stop and keep what was recorded (if it's long enough). */
  stop(): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    this.keep = this.t >= CLIP_MIN_S;
    try {
      if (rec.state !== 'inactive') rec.stop();
      else this.finish(rec.mimeType);
    } catch {
      this.abort();
    }
  }

  private finish(mimeType: string): void {
    if (this.keep && this.chunks.length) this.last = { blob: new Blob(this.chunks, { type: mimeType.split(';')[0] }), name: this.name };
    this.chunks = [];
    this.release();
  }

  private abort(): void {
    this.rec = null;
    this.chunks = [];
    this.release();
  }

  private release(): void {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  dispose(): void {
    const rec = this.rec;
    this.rec = null;
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch {
      // (Already gone.)
    }
    this.release();
  }
}
