// AgentHandbook · mirrors AgentLink's "Agent Handbook"
// Static reference book for every APEX agent. Sectioned, searchable, scannable.

import { useState, useMemo } from "react";
import {
  BookOpen, Search, ChevronRight, Shield, DollarSign, Phone, Users,
  GraduationCap, AlertTriangle, Star, Award, Crown,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Section {
  key: string;
  title: string;
  icon: any;
  body: string;
}

const SECTIONS: Section[] = [
  {
    key: "mission", title: "The APEX Mission", icon: Crown,
    body: `We build the highest-standard insurance agency in America. Carrier-direct, client-first, agent-owned. Every agent who walks in here gets the same shot at six figures regardless of where they came from — but we hold a standard that filters who stays. "Hold the Standard. Average is the disease." is not a slogan. It's the rule.`,
  },
  {
    key: "code", title: "Code of Conduct", icon: Shield,
    body: `1) We never sell a product the client doesn't need.
2) We never lie about a carrier's rating, premium, or terms.
3) We never skip the underwriting check to get the app through.
4) We never trash a competitor — we beat them with better service.
5) We treat every client like they are our mother.
6) We treat every agent on our team like our brother.
7) When we mess up, we own it before someone catches it.

Violating any of the above = strike. Three strikes = termination.`,
  },
  {
    key: "comp", title: "How You Get Paid", icon: DollarSign,
    body: `Carrier-direct commission. The carrier writes you the check, not APEX. APEX takes nothing off your top — we make our money on overrides on agents YOU recruit downstream.

Commission flows:
• First-year commission (FY%): paid as advance OR as-earned depending on carrier
• Renewal (Y2+): paid on policies that stay in force
• Chargebacks: if a policy lapses in months 1-12, the carrier claws back your commission. Avoid by writing realistic budgets + checking in at 30/60/90.

See /dashboard/commission-grids for every product's FY%, renewal%, and advance schedule. See /dashboard/finances for your live ledger.`,
  },
  {
    key: "selling", title: "How We Sell", icon: Phone,
    body: `The APEX Sales Method has 4 steps:

1) OPEN — Reset the call. "Hey {first_name}, this is {your_name} returning your call about the protection request. The reason I'm reaching out is to walk you through your options."

2) FACT-FIND — 5 questions: existing coverage, age/DOB, major health conditions (heart/stroke/cancer/diabetes/COPD), tobacco, height/weight.

3) PRESENT — Two options that fit budget AND health. Never present price first — present coverage first.

4) CLOSE — Bank info → policy bound. Don't ask "would you like to". Assume the sale. "I'll need your bank info to set up the draft."

Full scripts live at /dashboard/scripts.`,
  },
  {
    key: "leads", title: "Lead Sources + Dialer", icon: Users,
    body: `Inbound: when a lead fills out a form on the public marketing site, they hit ReadyMode dialer. You'll get notified via the Inbound Leads cockpit at /dashboard/inbound-leads.

Outbound: only after you've cleared your inbound queue. Always know your contact rate, conversion rate, and avg premium per call.

Don't buy leads from third-party brokers without your manager approving first. Bad leads waste your dial time and contaminate your data.`,
  },
  {
    key: "recruiting", title: "Recruiting Your Downline", icon: Star,
    body: `Every agent on this platform is an entrepreneur. The fastest path to retiring on this business is building your own downline.

How:
1) DM 10 qualified prospects per day (use /dashboard/scripts → Recruiting)
2) Run the Interview Frame: why now, income goal, license speed
3) Walk them through prelicensing
4) When they're licensed, they roll under YOUR upline by default

You earn override commission on every dollar they write. Your override scales with the level you've earned (Builder → Manager → Agency Owner).`,
  },
  {
    key: "licensing", title: "License Maintenance", icon: GraduationCap,
    body: `You are required by your state to:
• Maintain an active resident license
• Complete continuing education (CE) by the state's deadline (typically 24 hours every 2 years incl. ethics)
• Update the carrier when you move states
• Report any disciplinary action immediately to APEX compliance

If your license lapses, your contracts go inactive. You can't write business. We can help you renew but the responsibility is YOURS. Check /dashboard/profile for your license status.`,
  },
  {
    key: "strikes", title: "Strikes + Termination", icon: AlertTriangle,
    body: `We use a 3-strike system for serious conduct issues. Strikes are issued by leadership and recorded on /dashboard/strikes-review.

Examples of strike-worthy conduct:
• Misrepresenting carrier/product to a client
• Falsifying app information
• Stealing a teammate's client
• Public attacks on APEX or your manager
• No-call/no-show on appointments without notice
• Tobacco lying on your own applications

Resolution: 1st strike = written warning + corrective action plan. 2nd = 30-day probation + pay penalty. 3rd = termination + carrier debit balance handling per contract.`,
  },
  {
    key: "growth", title: "Your Growth Path", icon: Award,
    body: `Year 1: Producer. Goal — $50K+ FYC. Master inbound + close consistency.
Year 2: Builder. Goal — $150K+ FYC + first 3 downline writers. Master interviewing.
Year 3: Manager. Goal — $300K+ FYC personal + $1M team. Master training + retention.
Year 5: Agency Owner. $5M+ team production. Equity-share program eligible.

These are not titles. They are EARNED milestones. Check /dashboard/business-analytics → Trophy Cabinet for your current tier.`,
  },
];

export default function AgentHandbook() {
  usePageTitle("Agent Handbook · APEX");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) =>
      s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Resources"
        eyebrowIcon={<BookOpen className="h-3 w-3" />}
        title="Agent Handbook"
        subtitle="Every APEX agent's reference book. Mission · Code · Comp · Selling · Recruiting · Strikes · Growth path."
        actions={<Badge variant="outline" className="text-11">{SECTIONS.length} chapters</Badge>}
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search the handbook…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: section list */}
        <div className="space-y-2">
          {filtered.map((s) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`w-full text-left p-3 rounded-lg border transition-base flex items-center gap-3 ${
                active === s.key
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <s.icon className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-13 font-medium flex-1 truncate">{s.title}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
          {filtered.length === 0 && (
            <Card><CardContent className="p-6 text-center text-13 text-muted-foreground">No chapter matches "{search}".</CardContent></Card>
          )}
        </div>

        {/* Right: chapter body */}
        <div className="lg:col-span-2">
          <Card className="min-h-[400px]">
            <CardContent className="p-5">
              {active ? (
                (() => {
                  const sec = SECTIONS.find((s) => s.key === active)!;
                  const Icon = sec.icon;
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Icon className="h-5 w-5 text-amber-500" />
                        <h2 className="text-16 font-bold">{sec.title}</h2>
                      </div>
                      <div className="text-13 text-foreground/85 leading-relaxed whitespace-pre-line">
                        {sec.body}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <BookOpen className="h-8 w-8 text-amber-500 mb-3" />
                  <p className="text-15 font-bold mb-1">Pick a chapter</p>
                  <p className="text-12 text-muted-foreground">The handbook lives here. New agents read it cover-to-cover.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
