// saveMedia — get a clip onto the device the user is holding.
//
// Sam, 2026-09-13: "make it so I can download videos directly to camera roll
// through the website." On iPhone, <a download> against a cross-origin Dropbox
// link does not save anything — Safari opens the video in a tab. The only web
// path into the Photos app is the share sheet: navigator.share({ files }) with
// the bytes already in hand, where the sheet offers "Save Video" / "Save Image".
// Dropbox temporary links answer with Access-Control-Allow-Origin: * (measured
// 2026-09-13), so the browser can pull the bytes itself; nothing is proxied.
//
// Desktop (or any browser without file sharing) keeps the plain download link.

export interface SaveTarget { url: string; name: string }

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;
const IMAGE_EXT = /\.(png|jpe?g|heic|webp|gif)$/i;

export const mimeFor = (name: string): string => {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[ext] ?? "application/octet-stream";
};

/** True when this browser can hand files to the OS share sheet (iOS/iPadOS Safari, Android Chrome). */
export const canShareFiles = (): boolean => {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

export const isMediaName = (name: string): boolean => VIDEO_EXT.test(name) || IMAGE_EXT.test(name);

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

async function fetchFile(t: SaveTarget, onProgress?: (loadedBytes: number, totalBytes: number | null) => void): Promise<File> {
  const res = await fetch(t.url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0) || null;
  if (!res.body || !onProgress) {
    const blob = await res.blob();
    return new File([blob], t.name, { type: mimeFor(t.name) });
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); loaded += value.byteLength; onProgress(loaded, total); }
  }
  return new File(chunks, t.name, { type: mimeFor(t.name) });
}

/**
 * Save one or more clips. Mobile: pulls the bytes and opens the share sheet
 * (Save Video / Save Image lands in the camera roll). Elsewhere: fires a
 * download link per file. Must be called from a user gesture on iOS; the fetch
 * happens first, then share() — Safari allows that as long as the gesture's
 * transient activation has not expired, so keep files reasonably small.
 */
export async function saveMedia(targets: SaveTarget[], onProgress?: (done: number, total: number, loadedBytes: number, totalBytes: number | null) => void): Promise<SaveOutcome> {
  if (targets.length === 0) return "cancelled";
  if (canShareFiles()) {
    const files: File[] = [];
    for (let i = 0; i < targets.length; i++) {
      files.push(await fetchFile(targets[i], (l, tot) => onProgress?.(i, targets.length, l, tot)));
    }
    if (!navigator.canShare({ files })) throw new Error("This browser cannot share these files");
    try {
      await navigator.share({ files, title: targets.length === 1 ? targets[0].name : `${targets.length} clips` });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      throw e;
    }
  }
  for (const t of targets) {
    const a = document.createElement("a");
    a.href = t.url; a.download = t.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    if (targets.length > 1) await new Promise((r) => setTimeout(r, 450));
  }
  return "downloaded";
}
