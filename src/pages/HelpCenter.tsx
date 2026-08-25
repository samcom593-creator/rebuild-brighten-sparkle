// APEX Help Center + tracked support desk.
//
// Static FAQ + how-to library covering APEX's most-asked questions.
// Curated as code so we don't need a CMS round-trip. Easy to extend.

import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  HelpCircle, Search, ChevronDown, BookOpen, DollarSign, Phone,
  Shield, Users, FileText, GraduationCap, Briefcase, Wrench, Sparkles,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SupportDesk } from "@/components/support/SupportDesk";

interface FaqItem {
  q: string;
  a: string;
  category: string;
}

const FAQ: FaqItem[] = [
  // Getting Started
  { category: "Getting Started", q: "I just got hired. What's the very first thing I do?",
    a: "1) Schedule your prelicensing course immediately. 2) Pass your state exam (most people do it in 14 days if serious). 3) The day you're licensed, your manager onboards you, runs your carrier contracts, and gives you your first lead block. Until you're licensed you can't write business, so don't waste days." },
  { category: "Getting Started", q: "Where do I find my carrier contracting links?",
    a: "Go to /dashboard/contracting. Your contracting profile, carrier checklist, status, writing numbers, E&O, EFT readiness, and issues are tracked there." },
  { category: "Getting Started", q: "What's the agent code on my profile?",
    a: "Your agent code is your internal identifier across recruiting, contracting, production, and reporting. You can see it on /dashboard/profile." },

  // Licensing
  { category: "Licensing", q: "How long does prelicensing take?",
    a: "If you're serious: 7-14 days of focused study. Some states require a fixed minimum number of hours — check /dashboard/pre-licensing for state-specific guidance." },
  { category: "Licensing", q: "What states should I get licensed in first?",
    a: "Your resident state first (required). Then prioritize high-volume FE/IUL states: TX, FL, GA, NC, OH, AZ. We'll guide you on which carriers we're already appointed in." },
  { category: "Licensing", q: "Do I need to take continuing education (CE)?",
    a: "Yes. Each state has its own CE requirements (typically 24 hrs every 2 years, including ethics). We track it on your Producer Profile so you don't lapse." },

  // Selling
  { category: "Selling", q: "What products do we sell most?",
    a: "Final Expense (FE) is our top volume. Then Whole Life, IUL, Term, Annuity, Mortgage Protection, and supplemental health. Carrier mix on /dashboard/carriers shows current 30-day production split." },
  { category: "Selling", q: "What's the right script for an inbound call?",
    a: "Use the Switch Center scripts on /dashboard/scripts → Inbound. Open → Fact Find → Close. Run it every time. The scripts work; agents who freelance underperform." },
  { category: "Selling", q: "How do I handle 'I need to talk to my spouse'?",
    a: "Don't lose them. The exact rebuttal is in /dashboard/scripts → Objections → spouse. Frame: locking in today's health rate + 30-day free look. If they cancel, they cancel — but they won't." },
  { category: "Selling", q: "What if the carrier rejects my client?",
    a: "Most carriers we partner with have a 'Plan B' tier. Re-quote in the field using the carrier's underwriting matrix. If it's truly uninsurable, we have guaranteed-issue carriers." },

  // Commission + Payouts
  { category: "Commission + Payouts", q: "When do I get paid?",
    a: "Carrier-direct commissions hit your account on the carrier's schedule (usually weekly or daily after the policy is in force and the first premium clears). Check /dashboard/finances for your live ledger." },
  { category: "Commission + Payouts", q: "What's a chargeback and how do I avoid them?",
    a: "If a policy lapses within the first 6-12 months, the carrier claws back the commission. To avoid: solid fact-finding + realistic budgeting + post-sale check-in calls at 30/60/90 days." },
  { category: "Commission + Payouts", q: "Where do I see my real numbers?",
    a: "Use /dashboard/production for policies and production, /dashboard/analytics for performance, and the home scoreboard for personal production, team production, policies, and estimated earnings based on your saved comp." },

  // Carriers
  { category: "Carriers", q: "How do I request a carrier contract?",
    a: "/dashboard/contracting → open your carrier checklist and complete the required profile, E&O, and EFT readiness. The site tracks sent, action-required, submitted, active, and issue statuses without an AgentLink handoff." },
  { category: "Carriers", q: "Which carrier is best for diabetic clients?",
    a: "Depends on A1C, age, and other conditions. Generally: American Home Life or Royal Neighbors for milder cases. For guaranteed issue, look at our GI carriers. The Carrier Resources page shows 'Best For' tags per carrier." },

  // Tools
  { category: "Tools", q: "How do I use the dialer?",
    a: "Open /dashboard/readymode for live sync health and management, or /dashboard/call-center for your call queue. If access or call data is missing, submit a ReadyMode request in the Support Desk on this page." },
  { category: "Tools", q: "Where's the AI assistant?",
    a: "Ask Apex AI is the floating dock at the bottom-right of every dashboard route. Hit it anytime — it knows your data and can answer questions about your book or our products." },
  { category: "Tools", q: "How do I share an APEX win on social?",
    a: "/dashboard/announcements → 'Post a Deal' button → fill in premium + product. It posts to the live News Feed and we'll auto-feed it to the public landing page ticker." },

  // Brand + Culture
  { category: "Brand + Culture", q: "What's the Apex Standard?",
    a: "Hold the Standard. Average is the disease. Read the full brand voice script on /dashboard/scripts → Brand. We don't chase low-rated carriers, we don't compromise client coverage for commission, and we don't work with agents who do." },
  { category: "Brand + Culture", q: "I want to post content but I'm new — what's safe to say?",
    a: "Talk about what you're learning, who you're protecting, and what you're discovering about the industry. Avoid: client names, claim amounts, anything that could be construed as advice without a license, and lying about ratings. When in doubt: ask your manager." },
];

const CATEGORIES = Array.from(new Set(FAQ.map((f) => f.category)));

// Read-time estimate: ~30s avg per Q&A read (skim a question + scan answer).
const READ_TIME_MIN = Math.max(1, Math.round((FAQ.length * 30) / 60));

// Curated last-updated date — bump when FAQ array changes.
const LAST_UPDATED = "Jun 14";

const CATEGORY_ICONS: Record<string, any> = {
  "Getting Started":      BookOpen,
  "Licensing":            GraduationCap,
  "Selling":              Phone,
  "Commission + Payouts": DollarSign,
  "Carriers":             Briefcase,
  "Tools":                Wrench,
  "Brand + Culture":      Sparkles,
};

function FaqRow({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  const Icon = CATEGORY_ICONS[item.category] ?? FileText;
  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={onToggle}
          className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-base"
        >
          <Icon className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-13 font-bold">{item.q}</p>
            <Badge variant="outline" className="text-11 mt-1">{item.category}</Badge>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="px-4 pb-4 pl-11 text-13 text-foreground/85 leading-relaxed whitespace-pre-line border-t border-border/30">
            <p className="pt-3">{item.a}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function HelpCenter() {
  usePageTitle("Help Center · APEX");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "desk" ? "desk" : "faq";
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("All");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return FAQ.filter((f) => {
      if (activeCat !== "All" && f.category !== activeCat) return false;
      if (!lowered) return true;
      return f.q.toLowerCase().includes(lowered) || f.a.toLowerCase().includes(lowered);
    });
  }, [search, activeCat]);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Support"
        eyebrowIcon={<HelpCircle className="h-3 w-3" />}
        title="Help Center"
        subtitle="Answers plus one tracked place for website, contracting, ReadyMode, recruiting, training, sales, and account questions."
        actions={<Badge variant="outline" className="text-11">{FAQ.length} FAQ</Badge>}
      />

      <div className="flex w-fit rounded-lg border border-border bg-card p-1">
        <button type="button" onClick={() => setSearchParams({})} className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${activeTab === "faq" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>FAQ</button>
        <button type="button" onClick={() => setSearchParams({ tab: "desk" })} className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${activeTab === "desk" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Support Desk</button>
      </div>

      {activeTab === "desk" ? <SupportDesk /> : <>

      {/* Canonical v6 §31 premium gradient hero */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-[#0A0A0A] via-[#0A0A0A] to-[#8A7340]/20 text-white shadow-[0_0_48px_-12px_hsl(46_68%_47%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/8 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">KNOWLEDGE BASE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TOTAL FAQ</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{FAQ.length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">questions answered</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CATEGORIES</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{CATEGORIES.length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">topic clusters</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">READ TIME</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{READ_TIME_MIN}<span className="text-[16px] text-white/60"> min</span></p>
              <p className="text-[10px] text-white/40 tabular-nums">full library scan</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">LAST UPDATED</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{LAST_UPDATED}</p>
              <p className="text-[10px] text-white/40 tabular-nums">content date</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search + category */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search FAQ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCat("All")}
            className={`px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
              activeCat === "All" ? "bg-amber-500 text-white" : "bg-muted text-foreground hover:bg-muted/80"
            }`}
          >
            All ({FAQ.length})
          </button>
          {CATEGORIES.map((c) => {
            const count = FAQ.filter((f) => f.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
                  activeCat === c ? "bg-amber-500 text-white" : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-13 text-muted-foreground">Nothing matches yet — try a broader search term, or tap "All" to see every answer in the library.</CardContent></Card>
        ) : (
          filtered.map((f) => {
            const key = `${f.category}::${f.q}`;
            return <FaqRow key={key} item={f} open={!!open[key]} onToggle={() => setOpen((s) => ({ ...s, [key]: !s[key] }))} />;
          })
        )}
      </div>

      {/* Still stuck callout */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-13 font-bold">Still stuck?</p>
            <p className="text-12 text-foreground/80">
              Open Ask Apex AI (bottom-right dock on any dashboard page) or DM your manager directly.
              For escalations: <a href="mailto:info@kingofsales.net" className="text-amber-600 hover:underline">info@kingofsales.net</a>.
            </p>
          </div>
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
