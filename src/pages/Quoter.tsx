// Quoter · mirrors AgentLink's "Quoter" sidebar tool
// Quick illustrative premium estimator. NOT a binding quote — for in-call use only.
//
// Uses simple rate tables per product category, age band, gender, and tobacco status.
// Real binding rates come from each carrier's actual rate engine.

import { useMemo, useState } from "react";
import {
  Calculator, RefreshCw, Share2, Filter, DollarSign, User as UserIcon,
  Cigarette, Calendar,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Gender = "male" | "female";
type Health = "preferred" | "standard" | "graded" | "gi";

// Rate per $1,000 face per month — illustrative APEX averages
// Indexed by [category][age-band][gender][tobacco][health]
const RATE_TABLE: Record<string, Record<string, Record<Gender, Record<"non"|"tob", Record<Health, number>>>>> = {
  final_expense: {
    "40-50": { male:   { non: { preferred: 1.10, standard: 1.30, graded: 1.70, gi: 2.20 }, tob: { preferred: 1.70, standard: 1.95, graded: 2.40, gi: 3.20 } },
              female: { non: { preferred: 0.90, standard: 1.10, graded: 1.40, gi: 1.80 }, tob: { preferred: 1.40, standard: 1.60, graded: 2.00, gi: 2.60 } } },
    "50-60": { male:   { non: { preferred: 1.80, standard: 2.20, graded: 2.80, gi: 3.60 }, tob: { preferred: 2.80, standard: 3.30, graded: 4.00, gi: 5.20 } },
              female: { non: { preferred: 1.50, standard: 1.80, graded: 2.30, gi: 3.00 }, tob: { preferred: 2.30, standard: 2.70, graded: 3.30, gi: 4.20 } } },
    "60-70": { male:   { non: { preferred: 3.00, standard: 3.60, graded: 4.60, gi: 6.00 }, tob: { preferred: 4.60, standard: 5.40, graded: 6.60, gi: 8.50 } },
              female: { non: { preferred: 2.40, standard: 2.90, graded: 3.70, gi: 4.80 }, tob: { preferred: 3.70, standard: 4.30, graded: 5.30, gi: 6.80 } } },
    "70-80": { male:   { non: { preferred: 5.50, standard: 6.60, graded: 8.40, gi: 11.00 }, tob: { preferred: 8.40, standard: 9.90, graded: 12.00, gi: 15.50 } },
              female: { non: { preferred: 4.40, standard: 5.30, graded: 6.80, gi: 8.80 }, tob: { preferred: 6.80, standard: 7.90, graded: 9.60, gi: 12.50 } } },
    "80-89": { male:   { non: { preferred: 11.00, standard: 13.00, graded: 16.50, gi: 22.00 }, tob: { preferred: 16.50, standard: 19.50, graded: 24.00, gi: 31.00 } },
              female: { non: { preferred: 8.80, standard: 10.50, graded: 13.30, gi: 17.50 }, tob: { preferred: 13.30, standard: 15.70, graded: 19.30, gi: 25.00 } } },
  },
  term_20: {
    "18-30": { male:   { non: { preferred: 0.06, standard: 0.09, graded: 0.13, gi: 0.20 }, tob: { preferred: 0.13, standard: 0.18, graded: 0.26, gi: 0.40 } },
              female: { non: { preferred: 0.05, standard: 0.07, graded: 0.10, gi: 0.16 }, tob: { preferred: 0.10, standard: 0.14, graded: 0.21, gi: 0.32 } } },
    "30-40": { male:   { non: { preferred: 0.08, standard: 0.12, graded: 0.18, gi: 0.28 }, tob: { preferred: 0.18, standard: 0.26, graded: 0.38, gi: 0.58 } },
              female: { non: { preferred: 0.07, standard: 0.10, graded: 0.15, gi: 0.22 }, tob: { preferred: 0.15, standard: 0.21, graded: 0.31, gi: 0.46 } } },
    "40-50": { male:   { non: { preferred: 0.15, standard: 0.22, graded: 0.33, gi: 0.50 }, tob: { preferred: 0.33, standard: 0.48, graded: 0.70, gi: 1.10 } },
              female: { non: { preferred: 0.12, standard: 0.18, graded: 0.27, gi: 0.40 }, tob: { preferred: 0.27, standard: 0.39, graded: 0.57, gi: 0.88 } } },
    "50-60": { male:   { non: { preferred: 0.38, standard: 0.55, graded: 0.82, gi: 1.20 }, tob: { preferred: 0.82, standard: 1.18, graded: 1.70, gi: 2.50 } },
              female: { non: { preferred: 0.30, standard: 0.44, graded: 0.65, gi: 0.95 }, tob: { preferred: 0.65, standard: 0.94, graded: 1.35, gi: 2.00 } } },
    "60-70": { male:   { non: { preferred: 0.95, standard: 1.40, graded: 2.05, gi: 3.00 }, tob: { preferred: 2.05, standard: 2.95, graded: 4.25, gi: 6.20 } },
              female: { non: { preferred: 0.75, standard: 1.10, graded: 1.65, gi: 2.40 }, tob: { preferred: 1.65, standard: 2.40, graded: 3.45, gi: 5.00 } } },
  },
  whole_life: {
    "18-30": { male:   { non: { preferred: 0.65, standard: 0.80, graded: 1.05, gi: 1.40 }, tob: { preferred: 1.05, standard: 1.25, graded: 1.55, gi: 2.00 } },
              female: { non: { preferred: 0.55, standard: 0.65, graded: 0.85, gi: 1.10 }, tob: { preferred: 0.85, standard: 1.00, graded: 1.25, gi: 1.60 } } },
    "30-40": { male:   { non: { preferred: 0.95, standard: 1.15, graded: 1.50, gi: 2.00 }, tob: { preferred: 1.50, standard: 1.80, graded: 2.20, gi: 2.85 } },
              female: { non: { preferred: 0.80, standard: 0.95, graded: 1.20, gi: 1.60 }, tob: { preferred: 1.20, standard: 1.45, graded: 1.80, gi: 2.30 } } },
    "40-50": { male:   { non: { preferred: 1.65, standard: 2.00, graded: 2.60, gi: 3.40 }, tob: { preferred: 2.60, standard: 3.10, graded: 3.80, gi: 4.90 } },
              female: { non: { preferred: 1.30, standard: 1.60, graded: 2.05, gi: 2.70 }, tob: { preferred: 2.05, standard: 2.45, graded: 3.05, gi: 3.95 } } },
    "50-60": { male:   { non: { preferred: 2.85, standard: 3.40, graded: 4.40, gi: 5.80 }, tob: { preferred: 4.40, standard: 5.25, graded: 6.50, gi: 8.40 } },
              female: { non: { preferred: 2.30, standard: 2.75, graded: 3.55, gi: 4.65 }, tob: { preferred: 3.55, standard: 4.25, graded: 5.25, gi: 6.80 } } },
    "60-70": { male:   { non: { preferred: 4.95, standard: 5.95, graded: 7.65, gi: 10.00 }, tob: { preferred: 7.65, standard: 9.15, graded: 11.30, gi: 14.60 } },
              female: { non: { preferred: 3.95, standard: 4.75, graded: 6.15, gi: 8.00 }, tob: { preferred: 6.15, standard: 7.30, graded: 9.00, gi: 11.70 } } },
  },
};

const PRODUCTS = [
  { key: "final_expense", label: "Final Expense (WL)" },
  { key: "whole_life",    label: "Whole Life" },
  { key: "term_20",       label: "Term 20" },
];

function ageBand(age: number, product: string): string | null {
  const bands = Object.keys(RATE_TABLE[product] ?? {});
  for (const b of bands) {
    const [lo, hi] = b.split("-").map(Number);
    if (age >= lo && age <= hi) return b;
  }
  return null;
}

export default function Quoter() {
  usePageTitle("Quoter · APEX");

  const [age, setAge] = useState("55");
  const [gender, setGender] = useState<Gender>("male");
  const [tobacco, setTobacco] = useState(false);
  const [face, setFace] = useState("10000");

  const results = useMemo(() => {
    const ageNum = parseInt(age) || 0;
    const faceNum = parseFloat(face) || 0;
    const out: Array<{ key: string; label: string; rates: { health: Health; mo: number }[] }> = [];
    for (const p of PRODUCTS) {
      const band = ageBand(ageNum, p.key);
      if (!band) continue;
      const tbl = RATE_TABLE[p.key][band][gender][tobacco ? "tob" : "non"];
      out.push({
        key: p.key,
        label: p.label,
        rates: (["preferred", "standard", "graded", "gi"] as Health[]).map((h) => ({
          health: h,
          mo: (tbl[h] * faceNum) / 1000,
        })),
      });
    }
    return out;
  }, [age, gender, tobacco, face]);

  const fmt = (v: number) => `$${v.toFixed(2)}/mo`;
  const fmtAnnual = (v: number) => `$${(v * 12).toFixed(0)}/yr`;

  const copyQuote = async () => {
    const lines = [
      `APEX Quick Quote · ${age}yo ${gender}${tobacco ? " · TOBACCO" : ""} · $${parseInt(face).toLocaleString()} face`,
      "—".repeat(60),
    ];
    for (const r of results) {
      lines.push(`${r.label}:`);
      for (const x of r.rates) {
        lines.push(`  ${x.health.padEnd(10)} ${fmt(x.mo)}  (${fmtAnnual(x.mo)})`);
      }
      lines.push("");
    }
    lines.push("ILLUSTRATIVE ONLY — binding quote from carrier rate engine.");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Quote copied to clipboard");
    } catch { toast.error("Could not copy"); }
  };

  const reset = () => { setAge("55"); setGender("male"); setTobacco(false); setFace("10000"); };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Tools"
        eyebrowIcon={<Calculator className="h-3 w-3" />}
        title="Quoter"
        subtitle="Quick illustrative premium estimates. Use it live with clients — confirm with carrier's actual rate engine before binding."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reset
            </Button>
            <Button size="sm" onClick={copyQuote}>
              <Share2 className="h-3.5 w-3.5 mr-1.5" /> Copy Quote
            </Button>
          </div>
        }
      />

      {/* Inputs */}
      <Card>
        <CardContent className="p-4 grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div>
            <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><Calendar className="h-3 w-3" /> Age</label>
            <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} min={18} max={89} />
          </div>
          <div>
            <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><UserIcon className="h-3 w-3" /> Gender</label>
            <select
              className="w-full border border-border bg-background rounded-md px-3 py-2 text-13"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div>
            <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><Cigarette className="h-3 w-3" /> Tobacco</label>
            <button
              onClick={() => setTobacco(!tobacco)}
              className={`w-full h-10 rounded-md border text-13 font-medium transition-base ${
                tobacco ? "bg-rose-500/20 border-rose-500/40 text-rose-700" : "bg-emerald-500/20 border-emerald-500/40 text-emerald-700"
              }`}
            >
              {tobacco ? "YES (12-mo)" : "NO"}
            </button>
          </div>
          <div>
            <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><DollarSign className="h-3 w-3" /> Face Amount ($)</label>
            <Input type="number" value={face} onChange={(e) => setFace(e.target.value)} step="1000" />
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-13 text-muted-foreground">
          <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
          No products available for age {age}. Try a different age.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {results.map((r) => (
            <Card key={r.key}>
              <CardContent className="p-4">
                <h3 className="text-13 font-bold mb-3">{r.label}</h3>
                <div className="space-y-2">
                  {r.rates.map((x) => (
                    <div key={x.health} className="flex items-center justify-between text-12 border-b border-border/30 pb-1.5">
                      <Badge variant="outline" className="text-11 capitalize">{x.health}</Badge>
                      <div className="text-right">
                        <p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(x.mo)}</p>
                        <p className="text-11 text-muted-foreground tabular-nums">{fmtAnnual(x.mo)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="text-12 text-muted-foreground">
            <strong>Illustrative only.</strong> Rates here are APEX-internal averages used for in-call rough quoting. Always pull the BINDING quote from the carrier's actual rate engine before promising a number. Tobacco = any usage in the last 12 months. Preferred = excellent health; Standard = some history; Graded = significant history; GI = guaranteed issue (no underwriting).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
