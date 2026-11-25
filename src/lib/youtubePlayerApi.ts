export const YOUTUBE_PLAYER_TIMEOUT_MS = 12_000;

let pending: Promise<void> | null = null;

/** Share one API request, but let a failed or blocked request be retried. */
export function loadYouTubeAPI(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    const previousReady = window.onYouTubeIframeAPIReady;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      script.removeEventListener("error", fail);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previousReady;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      pending = null;
      reject(new Error("The YouTube player could not load."));
    };
    const ready = () => {
      if (settled || !window.YT?.Player) return;
      settled = true;
      cleanup();
      pending = null;
      resolve();
      previousReady?.();
    };
    const timer = window.setTimeout(fail, YOUTUBE_PLAYER_TIMEOUT_MS);
    script.addEventListener("error", fail, { once: true });
    window.onYouTubeIframeAPIReady = ready;
    document.head.appendChild(script);
  });
  return pending;
}
