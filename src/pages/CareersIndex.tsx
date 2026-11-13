import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { JsonLd } from "@/components/landing/JsonLd";
import { ArrowRight, CheckCircle2, MapPin, DollarSign, Clock } from "lucide-react";
import { STATES } from "./StateCareerLanding";

/**
 * CareersIndex (/careers) — the hub for the 10 per-state recruiting pages.
 *
 * WHY THIS EXISTS. Only /careers/:state was routed; bare /careers fell through
 * to the catch-all NotFound and served HTTP 200 with a "404 NOT FOUND" body —
 * a soft-404 on the PARENT of a live Google-for-Jobs cluster. A recruit who
 * types "<brand> careers" and a crawler that walks up from /careers/florida
 * both hit a dead page, and Google can index the thin NOT-FOUND shell, diluting
 * the whole /careers/* subtree. This page turns that dead parent into a real
 * crawlable hub that links every state page (strengthening the internal link
 * graph) and drives to /apply.
 *
 * Single source of truth is STATES, imported from StateCareerLanding so adding a
 * state lights up here and on its own page at once. The hub↔states completeness
 * invariant is locked by scripts/check-careers-hub.mjs.
 *
 * Routing wired in App.tsx at /careers (before /careers/:state).
 */

// Bounded, Sam-canonical claims — identical phrasing to the state pages' stat
// tiles (already truth-reconciled in landing brand-truth wave-5). No fabricated
// averages; no first-year promise.
const STAT_TILES = [
  { icon: DollarSign, label: "First-year monthly pace", value: "$10K+" },
  { icon: Clock, label: "Time to license", value: "2-4 weeks" },
  { icon: CheckCircle2, label: "Carrier rating", value: "A-rated" },
] as const;

export default function CareersIndex() {
  // Set page <title>, <meta description>, and og tags without react-helmet.
  // RouteCanonical (app-level) owns rel=canonical for /careers, so this effect
  // deliberately does NOT touch the canonical link. Cleaned up on unmount.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Life Insurance Agent Jobs — Remote, Nationwide | Galaxy Financial";

    const setMeta = (name: string, content: string, attr: "name" | "property" = "name") => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      const created = !el;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
      return { el, created };
    };

    const desc =
      "Galaxy Financial is hiring licensed and unlicensed life insurance agents across 10 states. Work remotely, A-rated carriers, lead supply, no cold-calling. 1099 contractor, commission only. Top first-year producers have written $120K+ in commissions.";
    const url = "https://apex-financial.org/careers";
    const created = [
      setMeta("description", desc),
      setMeta("og:title", "Life Insurance Agent Jobs — Remote, Nationwide — Galaxy Financial", "property"),
      setMeta("og:type", "website", "property"),
      setMeta("og:url", url, "property"),
    ];

    return () => {
      document.title = prevTitle;
      created.forEach((m) => {
        if (m.created && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      });
    };
  }, []);

  // ItemList of the state job pages — a valid hub schema that tells Google the
  // 10 pages below are one collection, reinforcing the cluster crawl. No
  // JobPosting here (the per-state pages own that); no earnings claims in schema.
  const itemList = {
    "@context": "https://schema.org/",
    "@type": "ItemList",
    name: "Life Insurance Agent Jobs by State — Galaxy Financial",
    itemListElement: STATES.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `Life Insurance Agent Jobs in ${s.name}`,
      url: `https://apex-financial.org/careers/${s.slug}`,
    })),
  };

  return (
    <div className="min-h-screen bg-background">
      <JsonLd id="careers-index-itemlist" data={itemList} />

      <main className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center mb-10">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40 mb-4">
            <MapPin className="h-3 w-3 mr-1.5" />
            Remote · {STATES.length} states hiring
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Life Insurance Agent Jobs — Remote
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Galaxy Financial is hiring licensed and unlicensed agents across {STATES.length} states.
            Work from home, build your book with our lead system, A-rated carrier appointments, and
            Sales Academy training — top first-year producers have written $120K+ in commissions.
            Commission only.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <Button asChild size="lg">
              <Link to="/apply">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/schedule-call">Talk to a recruiter</Link>
            </Button>
          </div>
        </div>

        {/* Stat tiles — bounded claims, shared with the state pages. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          {STAT_TILES.map((s) => (
            <GlassCard key={s.label} variant="subtle" className="p-4 text-center">
              <s.icon className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.label}</p>
            </GlassCard>
          ))}
        </div>

        {/* The hub: every state page, linked. */}
        <GlassCard variant="subtle" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Where we're hiring</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STATES.map((s) => (
              <Link
                key={s.slug}
                to={`/careers/${s.slug}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/40 px-4 py-3 hover:border-primary/60 hover:bg-primary/10 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
                  {s.name}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {s.region}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Don't see your state? We contract nationwide — apply and we'll map the cleanest path for
            where you live.
          </p>
        </GlassCard>

        {/* What you get */}
        <GlassCard variant="subtle" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">What you get with Galaxy</h2>
          <ul className="space-y-2 text-sm">
            {[
              "A-rated carrier appointments across multiple product lines — write business from day one",
              "Lead supply: exclusive web + dialer leads, no cold calling",
              "Free Sales Academy training (licensing sponsorship available)",
              "Live training calls multiple times a week — including Sam James",
              "1099 contractor — set your own schedule, work from anywhere in the US",
              "Path to leadership: top producers build their own downline + override income",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </GlassCard>

        {/* Bottom CTA */}
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to run with the Standard?</h2>
          <p className="text-muted-foreground mb-6">
            Application takes 3 minutes. Every application gets reviewed.
          </p>
          <Button asChild size="lg">
            <Link to="/apply">
              Start your application <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
