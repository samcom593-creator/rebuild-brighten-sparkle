/**
 * Analytics bootstrap — loads GA4 + PostHog + Meta Pixel only if their
 * env vars are set in the build. Each vendor is independent: a missing
 * env keeps that vendor dark, the rest still wire up.
 *
 * Called once from src/main.tsx before the React tree mounts.
 *
 * Env vars (set in Vercel → Project Settings → Environment Variables):
 *   VITE_GA4_MEASUREMENT_ID    e.g. G-XXXXXXXXXX
 *   VITE_META_PIXEL_ID         digits only
 *   VITE_POSTHOG_KEY           e.g. phc_xxxxxxxxxxxxxxxx
 *   VITE_POSTHOG_HOST          optional, default https://us.i.posthog.com
 *
 * No env? Calls to track()/identify() still succeed — they just no-op.
 */

const env = (k: string): string | undefined => {
  // Vite inlines import.meta.env.* at build. Guarded for SSR / test envs.
  try { return (import.meta as { env?: Record<string, string> }).env?.[k]; }
  catch { return undefined; }
};

function loadGA4(measurementId: string): void {
  if (typeof document === "undefined") return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(s);
  // C11: removed 4× unused @ts-expect-error directives. Under strict:false +
  // noImplicitAny:false (tsconfig.app.json), window.dataLayer / window.gtag
  // resolve via ambient any-indexing — the suppression was dead code.
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function () { w.dataLayer.push(arguments); };
  w.gtag("js", new Date());
  w.gtag("config", measurementId, { anonymize_ip: true, send_page_view: true });
}

function loadMetaPixel(pixelId: string): void {
  if (typeof document === "undefined" || (window as { fbq?: unknown }).fbq) return;
  // Standard Meta Pixel snippet, condensed. We cast `window` to `any` for the
  // vendor IIFE because the snippet attaches multiple globals (fbq, _fbq) that
  // are not in lib.dom.d.ts. Wider cast > one @ts-expect-error per access.
  /* eslint-disable */
  const w = window as any;
  const d = document as any;
  !function(f: any,b: any,e: any,v: any,n?: any,t?: any,s?: any){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,
  d,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  w.fbq("init", pixelId);
  w.fbq("track", "PageView");
}

async function loadPostHog(key: string, host: string): Promise<void> {
  try {
    // Dynamic import keeps PostHog out of the LCP critical path.
    const posthogModule = "posthog-js";
    const mod = await import(/* @vite-ignore */ posthogModule);
    const ph = (mod as { default?: { init: (k: string, opts: Record<string, unknown>) => void } }).default
            ?? (mod as unknown as { init: (k: string, opts: Record<string, unknown>) => void });
    ph.init(key, {
      api_host: host,
      autocapture: false,             // we emit named events via track()
      capture_pageview: true,
      session_recording: { maskAllInputs: true }, // record sessions, never PII
      person_profiles: "identified_only",
    });
    (window as { posthog?: unknown }).posthog = ph;
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    // posthog-js not installed yet — skip silently. Run `npm i posthog-js` to enable.
  }
}

let booted = false;
export function bootAnalytics(): void {
  if (booted || typeof window === "undefined") return;
  booted = true;
  const ga = env("VITE_GA4_MEASUREMENT_ID");
  const meta = env("VITE_META_PIXEL_ID");
  const ph = env("VITE_POSTHOG_KEY");
  const phHost = env("VITE_POSTHOG_HOST") || "https://us.i.posthog.com";
  if (ga) loadGA4(ga);
  if (meta) loadMetaPixel(meta);
  if (ph) void loadPostHog(ph, phHost);
}
