// AnnuityTraining · mirrors AgentLink's "Annuity Training" sidebar item
// Curated annuity-specific training: product types, when to recommend,
// commission structure, suitability requirements.

import { useState } from "react";
import {
  TrendingUp, CheckCircle2, AlertCircle, DollarSign, Calculator, FileText,
  ShieldCheck, Clock, Calendar,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { TrainingWorkspaceNav } from "@/components/training/TrainingWorkspaceNav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MODULES = [
  {
    key: "intro", title: "Module 1 · What is an Annuity?", icon: TrendingUp,
    body: `An annuity is a contract between a client and a carrier that converts a lump sum (or a series of payments) into a guaranteed income stream — usually for retirement.

The 3 phases:
1. ACCUMULATION — client deposits money; it grows tax-deferred
2. ANNUITIZATION — they elect to start receiving income
3. PAYOUT — guaranteed income for life or for a term

Annuities are NOT life insurance. They protect against OUTLIVING money (longevity risk).`,
  },
  {
    key: "types", title: "Module 2 · The Annuity Types", icon: Calculator,
    body: `FIXED ANNUITY (FA)
• Guaranteed interest rate (like a CD but tax-deferred)
• Best for: conservative clients, retirees protecting principal
• Carrier examples: Athene, Fidelity & Guaranty

INDEXED ANNUITY (FIA)
• Interest tied to an index (S&P 500 etc.) with a cap and a floor
• Floor = no loss; cap = max upside
• Best for: clients who want upside without market risk
• Carrier examples: Athene, F&G, National Life

VARIABLE ANNUITY (VA)
• Money in subaccounts (essentially mutual funds inside a wrapper)
• Full market risk
• Requires series-6 or series-7 license — most APEX agents do NOT sell these
• Best for: high-net-worth investors with risk tolerance

IMMEDIATE ANNUITY (SPIA)
• Pay lump sum → get income starting next month
• Best for: clients who need income RIGHT NOW`,
  },
  {
    key: "when", title: "Module 3 · When to Recommend", icon: CheckCircle2,
    body: `RECOMMEND an annuity when the client has:
✓ A lump sum ($25K+) sitting in a checking or savings account earning nothing
✓ A maturing CD they need to roll
✓ An old 401(k) they want to move to safe money
✓ Anxiety about market crashes wiping their savings
✓ A need for guaranteed lifetime income
✓ A desire to leave money to a spouse with tax efficiency

DO NOT recommend an annuity when:
✗ The client has no emergency fund (annuities are NOT liquid)
✗ They will need the money in less than 5 years
✗ They're chasing high returns and not understanding the trade-off
✗ The surrender charge schedule would penalize their actual timeline

EVERY annuity sale requires SUITABILITY paperwork. No suitability = no sale.`,
  },
  {
    key: "commission", title: "Module 4 · Commission Structure", icon: DollarSign,
    body: `Annuity commission is paid on premium deposited (not annual face like life).

Typical structure:
• 5-9% commission on the deposit
• Paid as advance OR as-earned
• 0% renewal (the carrier holds the money; you got paid up front)
• 90-day chargeback window if the client surrenders

Example: client deposits $100,000 into a 7-year FIA at 6% commission → you earn $6,000 on day 1.

NOTE: annuity chargebacks are HARSH. If the client withdraws beyond the free-withdrawal amount in the first year, you lose part or all of your commission. Set expectations clearly.

See /dashboard/commission-grids → filter by Annuity for current carriers + rates.`,
  },
  {
    key: "suitability", title: "Module 5 · Suitability + Compliance", icon: ShieldCheck,
    body: `EVERY annuity sale REQUIRES the following:

1) STATE-REQUIRED ANNUITY SUITABILITY CE
   Most states require a one-time 4-hour annuity training course before you can write your FIRST annuity in that state, plus a 1-hour update.

2) SUITABILITY FORM
   Filled out for EVERY annuity sale. Documents the client's age, financial picture, time horizon, liquidity needs, source of funds, and tax bracket. The carrier WILL reject the app if suitability is incomplete.

3) REPLACEMENT FORM (if applicable)
   If the client is moving money from another annuity, life insurance policy, or IRA — you must complete the state's replacement disclosure. Failure here is a license violation.

4) BEST INTEREST DOCUMENTATION (Reg BI states)
   You must document WHY the annuity you recommended is in the client's best interest vs. all alternatives.

DO NOT skip these. Annuity audits are increasingly common and the carriers WILL claw back your commission and report you to the DOI if you got sloppy.`,
  },
  {
    key: "objections", title: "Module 6 · Top Objections", icon: AlertCircle,
    body: `"I'll lose access to my money."
→ "You'll have a 10% free-withdrawal feature each year. If you stay liquid in your other accounts, the annuity becomes your guaranteed-growth bucket. Most retirees love having that lock-box."

"The fees are too high."
→ "Fixed and Indexed annuities have ZERO upfront fees. The carrier makes money on the spread. Variable annuities DO have fees — but I'm not recommending one."

"What if the carrier goes under?"
→ "State Guaranty Associations protect annuity holders up to typically $250K+ per carrier per person. We only contract with A-rated carriers. Look at the rating."

"I can do better in the market."
→ "You might. But you might lose 30% in a year and never recover. An indexed annuity gives you 70-80% of the upside with ZERO downside. That's the trade-off you choose."

"My financial advisor said don't buy one."
→ "Your advisor gets paid on assets under management. The day you move money to an annuity, they stop earning fees. Of course they say don't buy one. Get a second opinion from someone who isn't paid to keep your money in their book."`,
  },
];

const ANNUITY_PRODUCTS = ["Fixed (FA)", "Indexed (FIA)", "Variable (VA)", "Immediate (SPIA)"];

const TOTAL_WORDS = MODULES.reduce((sum, m) => sum + m.body.split(/\s+/).length, 0);
const READ_TIME_MIN = Math.max(1, Math.round(TOTAL_WORDS / 220));

export default function AnnuityTraining() {
  usePageTitle("Annuity Training · APEX");
  const [active, setActive] = useState(MODULES[0].key);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const sec = MODULES.find((m) => m.key === active)!;
  const Icon = sec.icon;
  const allDone = MODULES.every((m) => completed.has(m.key));
  const idx = MODULES.findIndex((m) => m.key === active);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <TrainingWorkspaceNav />
      <PageHeader
        eyebrow="Training"
        eyebrowIcon={<TrendingUp className="h-3 w-3" />}
        title="Annuity Training"
        subtitle="Annuity products, when to recommend, suitability, commission, objections. 6 modules. Read once, refresh quarterly."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-11 ${allDone ? "border-emerald-500 text-emerald-700" : ""}`}>
              {completed.size}/{MODULES.length} complete
            </Badge>
            {allDone && (
              <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-500/30">
                <ShieldCheck className="h-3 w-3 mr-1" /> Training Complete
              </Badge>
            )}
          </div>
        }
      />

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">ANNUITY TRAINING · LIVE</p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>~{READ_TIME_MIN} min read</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">TOTAL MODULES</p>
              <p className="text-[28px] font-black leading-none tabular-nums">{MODULES.length}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">curated curriculum</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">COMPLETED</p>
              <p className="text-[28px] font-black leading-none tabular-nums">{completed.size}<span className="text-muted-foreground">/{MODULES.length}</span></p>
              <p className="text-[10px] tabular-nums text-muted-foreground">{allDone ? "training complete" : "keep going"}</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">READ TIME</p>
              <p className="text-[28px] font-black leading-none tabular-nums">{READ_TIME_MIN}<span className="ml-1 text-[14px] text-muted-foreground">min</span></p>
              <p className="text-[10px] tabular-nums text-muted-foreground">end to end</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">PRODUCTS COVERED</p>
              <p className="text-[28px] font-black leading-none tabular-nums">{ANNUITY_PRODUCTS.length}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">FA · FIA · VA · SPIA</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Module list */}
        <div className="space-y-1 lg:col-span-1">
          {MODULES.map((m, i) => (
            <button
              key={m.key}
              onClick={() => setActive(m.key)}
              className={`w-full text-left p-3 rounded-lg border transition-base flex items-center gap-2 ${
                active === m.key ? "border-amber-500 bg-amber-500/10" : "border-border hover:bg-muted/30"
              }`}
            >
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-11 font-bold shrink-0 ${
                completed.has(m.key) ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}>{completed.has(m.key) ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}</span>
              <span className="text-12 font-medium truncate">{m.title}</span>
            </button>
          ))}
        </div>

        {/* Module body */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="h-5 w-5 text-amber-500" />
                <h2 className="text-16 font-bold">{sec.title}</h2>
              </div>
              <div className="text-13 text-foreground/85 leading-relaxed whitespace-pre-line mb-5">
                {sec.body}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <Button
                  variant="outline" size="sm" disabled={idx === 0}
                  onClick={() => setActive(MODULES[Math.max(0, idx - 1)].key)}
                >
                  ← Previous
                </Button>
                <Button
                  variant={completed.has(sec.key) ? "outline" : "default"}
                  size="sm"
                  onClick={() => setCompleted((s) => new Set(s).add(sec.key))}
                >
                  {completed.has(sec.key) ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Marked Read</> : "Mark as Read"}
                </Button>
                <Button
                  size="sm" disabled={idx === MODULES.length - 1}
                  onClick={() => setActive(MODULES[Math.min(MODULES.length - 1, idx + 1)].key)}
                >
                  Next →
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
