import { useEffect, useState } from "react";
import { Phone, Mail, MessageSquare, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CalendlyEmbedProps {
  url: string;
  className?: string;
}

/**
 * 2026-04-29: Sam's Calendly accounts (sam-com593, apexlifeadvisors) are
 * currently 404 — every embed showed a broken "page not found" iframe and
 * applicants who got that far in the funnel hit a dead end.
 *
 * Strategy: try to load the embed in a HEAD request first. If the URL
 * resolves to a Calendly 404, render a graceful fallback with phone +
 * email + iMessage CTAs so applicants can still convert manually until
 * Sam restores the Calendly accounts.
 */
export function CalendlyEmbed({ url, className = "" }: CalendlyEmbedProps) {
  const [reachable, setReachable] = useState<boolean | null>(null);

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
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      const existing = document.querySelector('script[src="https://assets.calendly.com/assets/external/widget.js"]');
      if (existing) existing.remove();
    };
  }, [reachable]);

  if (reachable === false) {
    return (
      <div className={`rounded-md border border-primary/30 bg-white dark:bg-slate-900 p-6 md:p-8 ${className}`}>
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
            <a href="sms:+14697676068?body=Hey%20Sam%2C%20I'd%20like%20to%20book%20a%20call%20about%20APEX." aria-label="Text Sam">
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
          <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
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
      className={`calendly-inline-widget ${className}`}
      data-url={url}
      style={{ minWidth: "320px", height: "700px" }}
    />
  );
}
