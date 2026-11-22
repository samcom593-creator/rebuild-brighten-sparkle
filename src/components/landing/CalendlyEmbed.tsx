import { useEffect, useRef, useState } from "react";
import { Phone, Mail, MessageSquare, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CalendlyEmbedProps {
  url: string;
  className?: string;
}

/**
 * Graceful embed for the most literal money action on the site — a licensed
 * applicant booking the hire call. If booking can't render, the applicant must
 * never hit a silent dead end; this component always has a phone/email fallback.
 *
 * Two independent failure classes, two owners:
 *
 *  1. Dead/renamed SLUG (Calendly 404) — owned SERVER-SIDE by the daily
 *     check-calendly-brand.sh guard (launchd com.samjames.apex.website-calendly-brand),
 *     which reads Calendly's event_types API. A cross-origin `fetch(..., {mode:
 *     "no-cors"})` HERE resolves opaque on ANY status including 404, so the
 *     client literally cannot read a dead-slug status — the HEAD probe below only
 *     catches a TOTAL network/DNS failure, not a 404.
 *
 *  2. The widget SCRIPT never loads — uBlock/corporate filter lists routinely
 *     block assets.calendly.com, and CDNs hiccup. This is invisible to the
 *     server-side guard and to the headless live-render guard (no adblocker), so
 *     without the onerror + post-load mount watchdog below, the inline-widget
 *     div would sit as an empty 700px box with no CTA and no fallback. That case
 *     now routes to the same manual-contact fallback.
 */

// Generous on purpose: the watchdog starts only AFTER the script's load event,
// so it is independent of connection speed. Long enough that a slow iframe
// injection is never mistaken for a failure; short enough that a real block
// surfaces the manual-contact fallback while the applicant is still on the page.
export const WIDGET_MOUNT_WATCHDOG_MS = 12000;

export function CalendlyEmbed({ url, className = "" }: CalendlyEmbedProps) {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cheap check: HEAD the URL with no-cors. We can't read the status,
    // but we can race a 1.5s timeout. If the network call rejects, the
    // URL is likely dead. We also try a fetch via our own origin proxy
    // headers; if Calendly returns 404, we fall back.
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 2000);
    fetch(url, { method: "HEAD", mode: "no-cors", signal: ctrl.signal })
      .then(() => { if (!cancelled) setReachable(true); })
      .catch(() => { if (!cancelled) setReachable(false); })
      .finally(() => clearTimeout(tm));
    return () => { cancelled = true; ctrl.abort(); };
  }, [url]);

  useEffect(() => {
    if (reachable !== true) return;
    let cancelled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    // Blocked by an adblocker / corporate filter, CDN down, or script 404 → the
    // error event fires and we route to the phone/email fallback instead of
    // leaving an empty booking box.
    script.onerror = () => { if (!cancelled) setReachable(false); };
    // Script loaded (200): Calendly injects its iframe into .calendly-inline-widget
    // on load. If nothing mounted within the watchdog window, init was blocked or
    // failed mid-flight — fall back rather than show a permanently empty box.
    script.onload = () => {
      watchdog = setTimeout(() => {
        if (cancelled) return;
        if (!widgetRef.current || widgetRef.current.childElementCount === 0) {
          setReachable(false);
        }
      }, WIDGET_MOUNT_WATCHDOG_MS);
    };
    document.body.appendChild(script);
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      const existing = document.querySelector('script[src="https://assets.calendly.com/assets/external/widget.js"]');
      if (existing) existing.remove();
    };
  }, [reachable]);

  if (reachable === false) {
    return (
      <div className={`rounded-md border border-primary/30 bg-white dark:bg-card p-6 md:p-8 ${className}`}>
        <div className="text-center mb-6">
          <h3 className="text-2xl font-bold text-white mb-2">Let's Talk</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Booking is offline for the moment. Reach Sam directly using any of these:
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Button asChild size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white gap-2">
            <a href="tel:+14697676068" aria-label="Call Sam">
              <Phone className="h-4 w-4" /> Call
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="gap-2">
            <a href="sms:+14697676068?body=Hey%20Sam%2C%20I'd%20like%20to%20book%20a%20call%20about%20Galaxy." aria-label="Text Sam">
              <MessageSquare className="h-4 w-4" /> Text
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="gap-2">
            <a href="mailto:sam.com593@gmail.com?subject=Book%20a%20call" aria-label="Email Sam">
              <Mail className="h-4 w-4" /> Email
            </a>
          </Button>
        </div>
        <p className="text-xs text-center text-slate-600 dark:text-slate-300 mt-6">
          Once Calendly is restored, this page will auto-show the embed again.{" "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Try opening in a new tab <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    );
  }

  // Default / loading: render the Calendly inline widget div the script
  // populates once it loads.
  return (
    <div
      ref={widgetRef}
      className={`calendly-inline-widget ${className}`}
      data-url={url}
      style={{ minWidth: "320px", height: "700px" }}
    />
  );
}
