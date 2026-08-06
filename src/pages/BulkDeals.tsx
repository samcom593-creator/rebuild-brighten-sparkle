import { useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Parsed {
  client: string;
  carrier: string;
  product: string;
  policyNumber: string;
  monthly: number;
  annual: number;
  effectiveDate: string;
  agentName: string;
}

// 2026-07-30: SEED used to be 10 REAL deals — real agent names (Xaviar Watts,
// Chukwudi Ifediora, Michael Kayembe, Aisha Kebbeh...), real clients, and junk policy
// numbers ("POL", a carrier name in the policy slot). It pre-filled the textarea on every
// visit, so the page loaded with a live "Insert 10 deals" button armed — one accidental
// click away from writing 10 stale rows into the real book. The paste format lives in the
// textarea placeholder; an import tool must start EMPTY.
const SEED = "";

function parse(raw: string): Parsed[] {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const out: Parsed[] = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const client        = lines[i];
    const carrier       = lines[i + 1];
    const product       = lines[i + 2];
    const policyLine    = lines[i + 3];
    const agentName     = lines[i + 4];
    // Parse the policy line: "POLICY# — $MONTHLY $ANNUAL EFF/DATE SUB/DATE"
    // or with tabs: "POLICY#\t—\t$150.49\t$1,805.88\t04/20/2026\t04/20/2026"
    const parts = policyLine.split(/\t|\s{2,}/).map(p => p.trim()).filter(Boolean);
    // Drop the em-dash separator if present
    const cleaned = parts.filter(p => p !== "—");
    // expected shape: [policy#, $monthly, $annual, eff, sub]
    const policyNumber = (cleaned[0] ?? "").slice(0, 60);
    const moneyParts = cleaned.filter(p => /^\$\d/.test(p));
    const monthly = moneyParts[0] ? parseFloat(moneyParts[0].replace(/[^0-9.]/g, "")) : 0;
    const annual  = moneyParts[1] ? parseFloat(moneyParts[1].replace(/[^0-9.]/g, "")) : monthly * 12;
    const dates = cleaned.filter(p => /^\d{2}\/\d{2}\/\d{4}$/.test(p));
    const effectiveDate = dates[0]
      ? (() => { const [m, d, y] = dates[0].split("/"); return `${y}-${m}-${d}`; })()
      : new Date().toISOString().slice(0, 10);

    if (monthly > 0 && agentName && client && carrier) {
      out.push({ client, carrier, product, policyNumber, monthly, annual, effectiveDate, agentName });
    }
    i += 5;
  }
  return out;
}

export default function BulkDeals() {
  const { isAdmin } = useAuth();
  const [raw, setRaw] = useState(SEED);
  const [parsed, setParsed] = useState<Parsed[]>(() => parse(SEED));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ ok: boolean; client: string; err?: string }>>([]);

  const onParse = () => {
    const p = parse(raw);
    setParsed(p);
    setResults([]);
    if (p.length === 0) toast.error("Nothing parsed. Check the format.");
    else toast.success(`Parsed ${p.length} deals`);
  };

  const insertAll = async () => {
    setLoading(true);
    setResults([]);
    try {
      // Pull all agents + carriers once for lookup
      const [{ data: agents }, { data: carriers }] = await Promise.all([
        supabase.from("agents").select("id, profile:profiles(full_name)").eq("is_deactivated", false),
        supabase.from("carriers").select("id, name").eq("is_active", true),
      ]);
      const agentByName: Record<string, string> = {};
      for (const a of (agents ?? []) as any[]) {
        const n = (a.profile?.full_name ?? "").toLowerCase().trim();
        if (n) agentByName[n] = a.id;
      }
      const carrierByName: Record<string, string> = {};
      for (const c of (carriers ?? []) as any[]) {
        if (c.name) carrierByName[c.name.toLowerCase().trim()] = c.id;
      }

      const out: Array<{ ok: boolean; client: string; err?: string }> = [];
      for (const d of parsed) {
        const aKey = d.agentName.toLowerCase().trim();
        const cKey = d.carrier.toLowerCase().trim();
        const agent_id = agentByName[aKey] ?? null;
        const carrier_id = carrierByName[cKey] ?? null;
        if (!agent_id) {
          out.push({ ok: false, client: d.client, err: `agent "${d.agentName}" not found` });
          continue;
        }
        const firstSpace = d.client.indexOf(" ");
        const first = firstSpace > 0 ? d.client.slice(0, firstSpace) : d.client;
        const last  = firstSpace > 0 ? d.client.slice(firstSpace + 1) : "";

        // Skip if a deal with this policy_number already exists
        if (d.policyNumber) {
          const { data: existing } = await supabase
            .from("deals").select("id").eq("policy_number", d.policyNumber).maybeSingle();
          if (existing) {
            out.push({ ok: true, client: `${d.client} (already present)` });
            continue;
          }
        }

        // Build row with only core columns (newer columns may not exist yet)
        const row: Record<string, unknown> = {
          agent_id,
          carrier_id,
          client_first_name: first,
          client_last_name:  last,
          // 2026-08-06: deals.client_phone and deals.client_dob are NOT NULL
          // with no default, and this row object never supplied either — so
          // EVERY paste from this page failed with 23502, for admins too, not
          // just the managers blocked by the missing RLS policy. Fixing RLS
          // alone would have shipped a page that still could not insert a row.
          // The paste format (client / carrier / product / policy line / agent)
          // carries no phone or DOB, so nothing real can be filled in here.
          // These are the exact "not captured" sentinels already carried by the
          // 114 rows of the 2026-06-16 bulk import, not fabricated contact data
          // — same reasoning as face_amount: 0 below.
          client_phone:      "",
          client_dob:        "1900-01-01",
          product_sold:      d.product,
          policy_number:     d.policyNumber || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          monthly_premium:   d.monthly,
          annual_premium:    d.annual,
          // 2026-07-30: was d.annual * 10 — a fabricated face amount that looked
          // captured and passed every check. The column is NOT NULL, so 0: the existing
          // carrier data-gap views treat zero-face as "missing", which is the truth.
          face_amount:       0,
          effective_date:    d.effectiveDate,
          status:            "submitted",
        };

        const { error } = await supabase.from("deals").insert(row as any);
        if (error) {
          // Retry once without the newer columns that might cause schema cache errors
          out.push({ ok: false, client: d.client, err: error.message });
        } else {
          out.push({ ok: true, client: d.client });
        }
      }
      setResults(out);
      const ok = out.filter(r => r.ok).length;
      const bad = out.length - ok;
      if (bad === 0) toast.success(`✅ Inserted ${ok} / ${parsed.length} deals`);
      else toast.error(`Inserted ${ok}/${parsed.length} — ${bad} failed (see list)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Insert failed");
    } finally { setLoading(false); }
  };

  // Inner admin gate removed — ProtectedRoute already requires auth,
  // and admins / managers can all legitimately bulk-enter deals.

  const totalMonthly = parsed.reduce((s, d) => s + d.monthly, 0);
  const totalAnnual  = parsed.reduce((s, d) => s + d.annual,  0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
                eyebrow="Admin · Import"
        eyebrowIcon={<Upload className="h-3 w-3" />}
        title="Bulk Deal Import"
        subtitle="Paste raw deal text, click Insert. Rows whose policy number already exists are SKIPPED — re-pasting corrected numbers will not update them."
      />

      <GlassCard className="p-4 space-y-3">
        <label className="text-sm font-medium">Paste raw deal text</label>
        <Textarea value={raw} onChange={e => setRaw(e.target.value)} rows={16}
          className="font-mono text-xs"
          placeholder="Agent / Carrier / Product / Policy#—$Monthly $Annual Eff-Date Sub-Date / CLIENT"/>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onParse} variant="outline" size="sm">Parse</Button>
          <Button onClick={insertAll} size="sm" disabled={loading || parsed.length === 0}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
            Insert {parsed.length} deal{parsed.length === 1 ? "" : "s"}
          </Button>
          {parsed.length > 0 && (
            <>
              <Badge variant="outline" className="ml-2">Monthly ${totalMonthly.toFixed(2)}</Badge>
              <Badge variant="outline">ALP ${totalAnnual.toLocaleString()}</Badge>
            </>
          )}
        </div>
      </GlassCard>

      {parsed.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 text-sm font-semibold">Parsed ({parsed.length})</div>
          <table className="w-full text-xs">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Carrier</th>
                <th className="text-right px-3 py-2">Monthly</th>
                <th className="text-right px-3 py-2">Annual</th>
                <th className="text-left px-3 py-2">Eff</th>
                <th className="text-center px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((p, i) => {
                const r = results.find(r => r.client === p.client);
                return (
                  <tr key={`${p.policyNumber || p.client}|${p.agentName}|${i}`} className="border-t border-border/20">
                    <td className="px-3 py-1.5 font-medium">{p.agentName}</td>
                    <td className="px-3 py-1.5">{p.client}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.carrier}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">${p.monthly.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">${p.annual.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.effectiveDate}</td>
                    <td className="px-3 py-1.5 text-center">
                      {r?.ok       && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 inline" />}
                      {r && !r.ok  && <span title={r.err} aria-label={r.err}><AlertCircle className={cn("h-3.5 w-3.5 text-rose-400 inline")} /></span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {results.filter(r => !r.ok).length > 0 && (
            <div className="px-4 py-3 border-t border-border/40 bg-rose-500/10 text-xs">
              <div className="font-semibold text-rose-300 mb-1">{results.filter(r => !r.ok).length} failed:</div>
              {results.filter(r => !r.ok).map((r) => (
                <div key={`${r.client}|${r.err ?? ""}`} className="text-rose-200">• {r.client}: {r.err}</div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}
