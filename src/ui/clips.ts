/**
 * Goal clips (GIF/MP4 replay sharing, as the browser can record it: a WebM from the match canvas, made by the
 * session's clip API). SAVE CLIP downloads the file; SHARE hands it to the system share sheet
 * (navigator.share with files) where the browser supports that, and falls back to the download.
 */
export interface Clip {
  blob: Blob;
  name: string;
}

export type ShareResult = 'shared' | 'saved' | 'cancelled';

/** Download a blob as a file (a temporary object URL, revoked a few seconds later). */
export function downloadBlob(blob: Blob, name: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    // A sandboxed frame may refuse downloads: nothing else to do.
  }
}

export function saveClip(c: Clip): void {
  downloadBlob(c.blob, c.name);
}

/** Share the clip as a file when the browser can; otherwise download it. */
export async function shareClip(c: Clip): Promise<ShareResult> {
  try {
    const file = new File([c.blob], c.name, { type: c.blob.type || 'video/webm' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'Blocky League', text: 'My goal in Blocky League' });
      return 'shared';
    }
  } catch (e) {
    // The player closed the share sheet: leave it there.
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
  }
  saveClip(c);
  return 'saved';
}
