// NeedsAnalysis · mirrors AgentLink's "Needs Analysis Calculator"
// Interactive DIME-style needs calculator agents use with clients live on calls.

import { useMemo, useState } from "react";
import {
  Calculator, Home, GraduationCap, DollarSign, Heart, CreditCard, RefreshCw, Share2, Download,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Inputs {
  income: string;          // annual gross income
  yearsReplacement: string;
  mortgage: string;
  otherDebt: string;
  kidCount: string;
  collegeCostPerKid: string;
  finalExpenses: string;
  savings: string;         // existing savings/insurance offsetting need
}

function n(v: string): number {
  const x = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

export default function NeedsAnalysis() {
  usePageTitle("Needs Analysis · APEX");

  const [inputs, setInputs] = useState<Inputs>({
    income: "60000", yearsReplacement: "10", mortgage: "180000", otherDebt: "20000",
    kidCount: "2", collegeCostPerKid: "100000", finalExpenses: "15000", savings: "25000",
  });

  const calc = useMemo(() => {
    const incomeNeed   = n(inputs.income) * n(inputs.yearsReplacement);
    const mortgageNeed = n(inputs.mortgage);
    const debtNeed     = n(inputs.otherDebt);
    const collegeNeed  = n(inputs.kidCount) * n(inputs.collegeCostPerKid);
    const finalNeed    = n(inputs.finalExpenses);
    const gross        = incomeNeed + mortgageNeed + debtNeed + collegeNeed + finalNeed;
    const offset       = n(inputs.savings);
    const totalNeed    = Math.max(0, gross - offset);
    return { incomeNeed, mortgageNeed, debtNeed, collegeNeed, finalNeed, gross, offset, totalNeed };
  }, [inputs]);

  const reset = () => setInputs({
    income: "60000", yearsReplacement: "10", mortgage: "180000", otherDebt: "20000",
    kidCount: "2", collegeCostPerKid: "100000", finalExpenses: "15000", savings: "25000",
  });

  const shareSummary = async () => {
    const text = `APEX Needs Analysis
Income replacement (${inputs.yearsReplacement} yrs): ${fmt(calc.incomeNeed)}
Mortgage: ${fmt(calc.mortgageNeed)}
Other debt: ${fmt(calc.debtNeed)}
College (${inputs.kidCount} kid${n(inputs.kidCount)===1?"":"s"}): ${fmt(calc.collegeNeed)}
Final expenses: ${fmt(calc.finalNeed)}
Less existing savings/coverage: −${fmt(calc.offset)}
═══════════════════════════════════
TOTAL COVERAGE NEED: ${fmt(calc.totalNeed)}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Summary copied to clipboard");
    } catch { toast.error("Could not copy"); }
  };

  const Field = ({ label, val, set, icon: Icon, hint }: any) => (
    <div>
      <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3" /> {label}
      </label>
      <Input
        type="text" inputMode="decimal"
        value={val}
        onChange={(e: any) => set(e.target.value)}
        placeholder="0"
      />
      {hint && <p className="text-11 text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Tools"
        eyebrowIcon={<Calculator className="h-3 w-3" />}
        title="Needs Analysis"
        subtitle="DIME-method coverage calculator (Debt · Income · Mortgage · Education). Run it live with your client on the call."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reset
            </Button>
            <Button size="sm" onClick={shareSummary}>
              <Share2 className="h-3.5 w-3.5 mr-1.5" /> Copy Summary
            </Button>
          </div>
        }
      />

      {/* v6 §31 premium gradient hero — live needs analysis */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">DIME CALCULATOR · LIVE</p>
            </div>
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-200">{inputs.yearsReplacement} yr replacement</Badge>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">INCOME NEED</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmt(calc.incomeNeed)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{fmt(n(inputs.income))} × {inputs.yearsReplacement} yrs</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MORTGAGE</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmt(calc.mortgageNeed)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">payoff balance</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">DEBT</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmt(calc.debtNeed)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">cards · auto · student</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TOTAL COVERAGE NEED</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-emerald-300">{fmt(calc.totalNeed)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">gross {fmt(calc.gross)} − {fmt(calc.offset)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Inputs */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5 grid gap-4 sm:grid-cols-2">
            <Field label="Annual income to replace ($)" val={inputs.income} set={(v: string) => setInputs({ ...inputs, income: v })} icon={DollarSign} hint="Their before-tax annual salary" />
            <Field label="Years of replacement" val={inputs.yearsReplacement} set={(v: string) => setInputs({ ...inputs, yearsReplacement: v })} icon={DollarSign} hint="Usually 7–10 years for working-age adults" />
            <Field label="Mortgage balance ($)" val={inputs.mortgage} set={(v: string) => setInputs({ ...inputs, mortgage: v })} icon={Home} />
            <Field label="Other debt ($)" val={inputs.otherDebt} set={(v: string) => setInputs({ ...inputs, otherDebt: v })} icon={CreditCard} hint="Cards, auto, student loans" />
            <Field label="Kids" val={inputs.kidCount} set={(v: string) => setInputs({ ...inputs, kidCount: v })} icon={Heart} />
            <Field label="College cost per kid ($)" val={inputs.collegeCostPerKid} set={(v: string) => setInputs({ ...inputs, collegeCostPerKid: v })} icon={GraduationCap} hint="State school ≈ $100K · Private ≈ $250K" />
            <Field label="Final expenses ($)" val={inputs.finalExpenses} set={(v: string) => setInputs({ ...inputs, finalExpenses: v })} icon={Heart} hint="Funeral + medical ≈ $10–20K" />
            <Field label="Existing coverage + savings ($)" val={inputs.savings} set={(v: string) => setInputs({ ...inputs, savings: v })} icon={DollarSign} hint="Subtracted from gross need" />
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-13 font-bold flex items-center gap-1.5"><Calculator className="h-4 w-4 text-amber-500" /> Coverage Need</h3>
            <div className="text-13 space-y-2 border-b border-border/40 pb-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Income replacement</span><span className="tabular-nums">{fmt(calc.incomeNeed)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Mortgage</span><span className="tabular-nums">{fmt(calc.mortgageNeed)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Other debt</span><span className="tabular-nums">{fmt(calc.debtNeed)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">College</span><span className="tabular-nums">{fmt(calc.collegeNeed)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Final expenses</span><span className="tabular-nums">{fmt(calc.finalNeed)}</span></div>
              <div className="flex justify-between font-bold text-foreground"><span>Gross need</span><span className="tabular-nums">{fmt(calc.gross)}</span></div>
              <div className="flex justify-between text-emerald-600"><span>Less savings/coverage</span><span className="tabular-nums">−{fmt(calc.offset)}</span></div>
            </div>
            <div className="pt-2">
              <p className="text-11 uppercase tracking-wider text-amber-700 dark:text-amber-300 font-semibold">Total Coverage Need</p>
              <p className="text-32 font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(calc.totalNeed)}</p>
              <Badge variant="outline" className="text-11 mt-2">DIME method</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-12 text-muted-foreground">
            <strong>DIME</strong> = <strong>D</strong>ebt + <strong>I</strong>ncome × years + <strong>M</strong>ortgage + <strong>E</strong>ducation, minus existing assets. This is a starting point for the conversation, not a guarantee — adjust for the client's situation, lifestyle goals, and inflation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
