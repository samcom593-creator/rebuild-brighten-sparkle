// wave-37 (2026-06-08): lazy-loaded sonner toast for cold-landing-eager files.
//
// `import { toast } from "sonner"` creates a static edge from the importer's
// chunk into vendor-ui (sonner is grouped there by vite.config.ts advancedChunks).
// vendor-ui in turn statically imports vendor-radix. So any landing-eager chunk
// that pulls sonner drags 22 KB gz (vendor-ui) + 47 KB gz (vendor-radix) onto
// the cold-landing transfer list — even though sonner only renders ANYTHING
// when a toast fires (post-user-click, never during first paint).
//
// This wrapper defers the sonner import to first call. The shared promise is
// cached so subsequent toasts hit zero overhead. Use this from any file that:
//   - lives in src/components/landing/** AND
//   - is reachable from src/pages/Index.tsx's Suspense block (cold landing).
//
// The pre-commit guard scripts/check-cold-landing-sonner.mjs enforces this:
// any static `from "sonner"` in a cold-landing-eager file fails the build.
//
// Identical surface as sonner.toast for the 5 methods used today
// (info / error / success / warning / message). Add more by mirroring the
// same shape — the return is `Promise<string | number>` since the underlying
// sonner.toast() resolves to its id; in 99% of call sites, callers ignore the
// id, so the async surface is invisible.

type SonnerToast = typeof import("sonner").toast;

let cache: Promise<SonnerToast> | null = null;
function load(): Promise<SonnerToast> {
  if (!cache) cache = import("sonner").then((m) => m.toast);
  return cache;
}

type ToastOpts = Parameters<SonnerToast>[1];

export const toast = {
  info: (msg: string, opts?: ToastOpts) => load().then((t) => t.info(msg, opts)),
  error: (msg: string, opts?: ToastOpts) => load().then((t) => t.error(msg, opts)),
  success: (msg: string, opts?: ToastOpts) => load().then((t) => t.success(msg, opts)),
  warning: (msg: string, opts?: ToastOpts) => load().then((t) => t.warning(msg, opts)),
  message: (msg: string, opts?: ToastOpts) => load().then((t) => t.message(msg, opts)),
};
