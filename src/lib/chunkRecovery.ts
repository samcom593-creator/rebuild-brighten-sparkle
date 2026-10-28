const RECOVERY_KEY = "apex.chunk-recovery.started-at";
const RECOVERY_QUERY = "_apex_refresh";
const RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;

// The last two alternatives are what React.lazy throws when a stale chunk import resolved to
// nothing: Chrome "Cannot read properties of undefined (reading 'default')", Safari "undefined is
// not an object (evaluating 's._result.default')". They were 25 crash screens in error_logs
// (2026-10-26..28), all after a deploy, all unrecognised here, so no reload ever ran.
const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading chunk \d+ failed|reading 'default'|_result\.default/i

let reloading = false;

/** True once this tab has started its recovery reload. */
export function isChunkRecoveryReloading(): boolean {
  return reloading;
}

/** True when this tab may start a recovery reload now (outside the cooldown). */
export function canRecoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  const startedAt = Number(window.sessionStorage.getItem(RECOVERY_KEY) ?? 0);
  return !(Number.isFinite(startedAt) && Date.now() - startedAt < RECOVERY_COOLDOWN_MS);
};

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CHUNK_ERROR_PATTERN.test(message);
}

/**
 * A deployment can remove an old content-hashed route chunk while an installed
 * PWA still has the previous HTML/router graph open. Clear only browser caches
 * controlled by APEX, unregister the stale worker, and retry the current route
 * once. The cooldown prevents a missing asset from becoming a reload loop.
 */
export async function recoverFromChunkError(error: unknown): Promise<boolean> {
  if (!isChunkLoadError(error) || typeof window === "undefined") return false;

  if (!canRecoverFromChunkError()) return false;

  window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  reloading = true;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      const ownedCaches = cacheNames.filter((name) =>
        /apex|workbox-precache|supabase-rest/i.test(name),
      );
      await Promise.all(ownedCaches.map((name) => window.caches.delete(name)));
    }
  } finally {
    const next = new URL(window.location.href);
    next.searchParams.set(RECOVERY_QUERY, Date.now().toString(36));
    window.location.replace(next.toString());
  }

  return true;
}

export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    // Swallow the error only when this tab is about to reload. preventDefault makes Vite resolve
    // the import to undefined; without a reload React.lazy then crashed on ".default" and the
    // tab showed "Something went wrong" instead of a real, recoverable chunk error.
    if (!reloading && !canRecoverFromChunkError()) return;
    event.preventDefault();
    const payload = (event as Event & { payload?: unknown }).payload;
    void recoverFromChunkError(payload);
  });

  window.addEventListener("error", (event) => {
    const candidate = event.error ?? event.message;
    if (isChunkLoadError(candidate)) void recoverFromChunkError(candidate);
  });

  // A successful boot proves the current shell and entry graph agree. Keep the
  // marker long enough to catch startup lazy imports, then clean the URL.
  window.setTimeout(() => {
    window.sessionStorage.removeItem(RECOVERY_KEY);
    const current = new URL(window.location.href);
    if (!current.searchParams.has(RECOVERY_QUERY)) return;
    current.searchParams.delete(RECOVERY_QUERY);
    window.history.replaceState(window.history.state, "", current.toString());
  }, 15_000);
}
