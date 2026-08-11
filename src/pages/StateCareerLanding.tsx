import { useEffect, useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { JsonLd } from "@/components/landing/JsonLd";
import { ArrowRight, CheckCircle2, MapPin, DollarSign, Clock } from "lucide-react";

/**
 * StateCareerLanding (PL-AHO-WEB-006)
 *
 * Per-state SEO landing page at /careers/:state. Emits Google for Jobs
 * compatible JobPosting JSON-LD on mount so APEX can claim the free
 * Google for Jobs SERP slot for "life insurance agent <state>" queries.
 *
 * 10 launch states cover the heaviest recruiting demand markets per
 * memory project_apex_2026_05_19_*. Adding a state = one entry in
 * STATES below.
 *
 * Routing wired in App.tsx at /careers/:state.
 */

interface StateConfig {
  slug: string;     // url slug, lowercase
  name: string;     // display name
  abbr: string;     // postal abbreviation
  region: string;   // for nearby contracts copy
}

const STATES: StateConfig[] = [
  { slug: "florida",       name: "Florida",        abbr: "FL", region: "Southeast" },
  { slug: "texas",         name: "Texas",          abbr: "TX", region: "South" },
  { slug: "california",    name: "California",     abbr: "CA", region: "West" },
  { slug: "georgia",       name: "Georgia",        abbr: "GA", region: "Southeast" },
  { slug: "arizona",       name: "Arizona",        abbr: "AZ", region: "Southwest" },
  { slug: "north-carolina",name: "North Carolina", abbr: "NC", region: "Southeast" },
  { slug: "ohio",          name: "Ohio",           abbr: "OH", region: "Midwest" },
  { slug: "tennessee",     name: "Tennessee",      abbr: "TN", region: "Southeast" },
  { slug: "michigan",      name: "Michigan",       abbr: "MI", region: "Midwest" },
  { slug: "pennsylvania",  name: "Pennsylvania",   abbr: "PA", region: "Northeast" },
];

const VALID_BY_SLUG = Object.fromEntries(STATES.map((s) => [s.slug, s]));

export default function StateCareerLanding() {
  const { state: slug } = useParams<{ state: string }>();
  const cfg = slug ? VALID_BY_SLUG[slug.toLowerCase()] : undefined;

  // Posting date pinned to today's UTC midnight so the snippet is stable
  // across SSR/CSR renders but still refreshes daily (Google revisits
  // JobPosting often — stale validThrough kills the rich result).
  //
  // These hooks — and the useEffect below — MUST run before the invalid-slug
  // early return. They used to sit after it, so a render with an unknown slug
  // ran zero hooks and a render with a known one ran three. React Router reuses
  // this component instance across /careers/:state, so navigating from a valid
  // state to an unknown one flips the hook count on a mounted component and
  // throws #310 ("Rendered more hooks than during the previous render") on a
  // public SEO landing page. Hooks run unconditionally or not at all.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const validThrough = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().slice(0, 10);
  }, []);


  // Set page <title>, <meta description>, and canonical URL without
  // pulling react-helmet as a dependency. Cleaned up on unmount.
  useEffect(() => {
    // Runs before the invalid-slug guard below, so it must tolerate no cfg.
    if (!cfg) return;
    const prevTitle = document.title;
    document.title = `Life Insurance Agent Jobs in ${cfg.name} | Remote | Apex Financial`;

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

    const setLink = (rel: string, href: string) => {
      let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      const created = !el;
      if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", rel);
        document.head.appendChild(el);
      }
      el.setAttribute("href", href);
      return { el, created };
    };

    const desc = `Hiring licensed and unlicensed life insurance agents in ${cfg.name}. Work from home, A-rated carriers, lead supply, no cold-calling. 1099 contractor, commission only. Top first-year producers have written $120K+ in commissions.`;
    const url = `https://apex-financial.org/careers/${cfg.slug}`;

    const meta1 = setMeta("description", desc);
    const meta2 = setMeta("og:title", `Life Insurance Agent Jobs in ${cfg.name} — Apex Financial`, "property");
    const meta3 = setMeta("og:type", "website", "property");
    const meta4 = setMeta("og:url", url, "property");
    const linkCanonical = setLink("canonical", url);

    return () => {
      document.title = prevTitle;
      // Only remove tags we created on mount — don't strip pre-existing meta.
      [meta1, meta2, meta3, meta4].forEach((m) => { if (m.created && m.el.parentNode) m.el.parentNode.removeChild(m.el); });
      if (linkCanonical.created && linkCanonical.el.parentNode) linkCanonical.el.parentNode.removeChild(linkCanonical.el);
    };
  }, [cfg?.name, cfg?.slug]);

  // Every hook above this line runs on every render. Only now is it safe to
  // bail out — see the note on `today` for why this cannot move back up.
  if (!slug || !cfg) {
    return <Navigate to="/" replace />;
  }

  // Google for Jobs JobPosting schema. CONTRACTOR employmentType
  // (these are 1099 commissioned roles, not W-2). baseSalary intentionally
  // omitted — 100% commission compensation is variable, and Google for Jobs
  // accepts JobPosting without baseSalary for purely commissioned roles.
  // Earnings claims kept to top-producer historical with no fabricated
  // average (book-of-business table empty → no source for "team average").
  const jobPosting = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: `Life Insurance Agent — Remote in ${cfg.name}`,
    description: `Apex Financial is hiring licensed and unlicensed Life Insurance Agents to work remotely from ${cfg.name}. We provide A-rated carrier appointments, lead supply, dialer, CRM, training, and a clear path from licensing to a producing book. 1099 contractor, commission only — earnings are variable. Top first-year producers have written $120K+ in commissions.`,
    datePosted: today,
    validThrough,
    employmentType: "CONTRACTOR",
    hiringOrganization: {
      "@type": "Organization",
      name: "Apex Financial",
      sameAs: "https://apex-financial.org",
      logo: "https://apex-financial.org/og-image.jpg",
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: cfg.name,
        addressRegion: cfg.abbr,
        addressCountry: "US",
      },
    },
    applicantLocationRequirements: {
      "@type": "Country",
      name: "USA",
    },
    jobLocationType: "TELECOMMUTE",
    industry: "Insurance",
    occupationalCategory: "41-3021 Insurance Sales Agents",
    qualifications: "Self-starter. Phone-ready. Coachable. Life insurance license is a plus but not required — we sponsor licensing through the Apex Sales Academy.",
    skills: "Sales, communication, follow-through, time management, work ethic",
    workHours: "Flexible — set your own schedule. Most full-time agents work 35-50 hours/week.",
    directApply: false,
    url: `https://apex-financial.org/careers/${cfg.slug}`,
  };

  return (
    <div className="min-h-screen bg-background">
      <JsonLd id={`job-posting-${cfg.slug}`} data={jobPosting} />

      <main className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center mb-10">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40 mb-4">
            <MapPin className="h-3 w-3 mr-1.5" />
            {cfg.region} · Remote
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Life Insurance Agent Jobs in {cfg.name}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Apex Financial is hiring licensed and unlicensed agents across {cfg.name}.
            Work remotely. Build your book with our lead system, A-rated carrier appointments,
            and Sales Academy training — top first-year producers have written $120K+ in
            commissions. Commission only.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <Button asChild size="lg">
              <Link to="/apply">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/schedule-call">
                Talk to a recruiter
              </Link>
            </Button>
          </div>
        </div>

        {/* Stat tiles. Bounded claims only — no fabricated averages. The $10K+
            tile mirrors the public landing's first-year monthly pace target;
            time-to-license is a real range; carriers tile cites the rating
            tier without claiming a count we can't reconcile to system_settings. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          {[
            { icon: DollarSign, label: "First-year monthly pace", value: "$10K+" },
            { icon: Clock,      label: "Time to license",         value: "2-4 weeks" },
            { icon: CheckCircle2, label: "Carrier rating",        value: "A-rated" },
          ].map((s) => (
            <GlassCard key={s.label} variant="subtle" className="p-4 text-center">
              <s.icon className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.label}</p>
            </GlassCard>
          ))}
        </div>

        {/* What you get */}
        <GlassCard variant="subtle" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">What you get with Apex in {cfg.name}</h2>
          <ul className="space-y-2 text-sm">
            {[
              `A-rated carrier appointments across multiple product lines — write business in ${cfg.name} from day one`,
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

        {/* Requirements */}
        <GlassCard variant="subtle" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Requirements</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>US resident, 18+, eligible to work in the US</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{cfg.name} life insurance license (or willingness to get licensed — we sponsor)</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Phone, laptop, and quiet workspace</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Coachable, self-driven, willing to dial</span>
            </li>
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

        {/* Cross-links to other state pages — good for SEO + internal link graph */}
        <div className="mt-12 pt-8 border-t border-border/30">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3 text-center">
            Also hiring in
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {STATES.filter((s) => s.slug !== cfg.slug).map((s) => (
              <Link
                key={s.slug}
                to={`/careers/${s.slug}`}
                className="text-xs px-3 py-1.5 rounded-full border border-border/40 hover:border-primary/60 hover:bg-primary/10 transition-colors"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// Exported so a sitemap generator or robots feed can iterate the slugs.
export const STATE_CAREER_SLUGS = STATES.map((s) => s.slug);
