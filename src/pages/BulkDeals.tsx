import { useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { preflightDeal } from "@/lib/bulkDealsPreflight";

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

/** What the paste cannot carry and the deals guard requires: typed per row in the table. */
interface InsuredDetails {
  dob: string;
  phone: string;
}

interface Lookups {
  agentByName: Record<string, string>;
  carrierByName: Record<string, string>;
}

/**
 * The roster/carrier read has its own state so a FAILED read is reported as a
 * failed read. Folding it into "no match" would call every pasted agent
 * "not on the roster" the moment the network blinked (the dead-feed-as-empty
 * lie the admin render-health waves closed elsewhere).
 */
type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lookups: Lookups }
  | { status: "error"; message: string };

interface RowResult {
  index: number;
  ok: boolean;
  client: string;
  err?: string;
}

// 2026-07-30: SEED used to be 10 REAL deals — real agent names (Xaviar Watts,
// Chukwudi Ifediora, Michael Kayembe, Aisha Kebbeh...), real clients, and junk policy
// numbers ("POL", a carrier name in the policy slot). It pre-filled the textarea on every
// visit, so the page loaded with a live "Insert 10 deals" button armed — one accidental
// click away from writing 10 stale rows into the real book. The paste format lives in the
// textarea placeholder; an import tool must start EMPTY.
const SEED = "";

/** The profiles join comes back as one object or a one-element array depending on the relationship shape. */
function profileFullName(profile: unknown): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  if (p && typeof p === "object" && "full_name" in p) {
    const name = (p as { full_name: unknown }).full_name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

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
  const [details, setDetails] = useState<Record<number, InsuredDetails>>({});
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  const setDetail = (index: number, patch: Partial<InsuredDetails>) =>
    setDetails(prev => ({ ...prev, [index]: { dob: "", phone: "", ...prev[index], ...patch } }));

  const loadLookups = async () => {
    setLookup({ status: "loading" });
    const [agentsRes, carriersRes] = await Promise.all([
      supabase.from("agents").select("id, profile:profiles!agents_profile_id_fkey(full_name)").eq("is_deactivated", false),
      supabase.from("carriers").select("id, name").eq("is_active", true),
    ]);
    const err = agentsRes.error ?? carriersRes.error;
    if (err) {
      setLookup({ status: "error", message: err.message });
      toast.error(`Could not load agents and carriers: ${err.message}`);
      return;
    }
    const agentByName: Record<string, string> = {};
    for (const a of agentsRes.data ?? []) {
      const n = profileFullName(a.profile).toLowerCase().trim();
      if (n) agentByName[n] = a.id;
    }
    const carrierByName: Record<string, string> = {};
    for (const c of carriersRes.data ?? []) {
      if (c.name) carrierByName[c.name.toLowerCase().trim()] = c.id;
    }
    setLookup({ status: "ready", lookups: { agentByName, carrierByName } });
  };

  const onParse = async () => {
    const p = parse(raw);
    setParsed(p);
    setResults([]);
    setDetails({});
    if (p.length === 0) {
      toast.error("Nothing parsed. Check the format.");
      return;
    }
    toast.success(`Parsed ${p.length} deals. Add each insured's date of birth and phone.`);
    await loadLookups();
  };

  // 2026-11-26: the deals guard (zz_deal_coverage_review_guard, shipped with the
  // coverage-review release) refuses any authenticated insert that lacks a carrier,
  // a full insured name, a date of birth before today and a 10-digit phone. The paste
  // format carries neither DOB nor phone; the 2026-08-06 fix for the NOT NULL columns
  // wrote '' and 1900-01-01 as "not captured" sentinels, which the guard now rejects
  // with one generic message per row AFTER the click. So every row is graded here,
  // with the guard's own rules, before anything is sent, and a held row says why.
  const rosterReady = lookup.status === "ready";
  const lookups = rosterReady ? lookup.lookups : null;
  const rows = parsed.map((d, i) => {
    const detail = details[i] ?? { dob: "", phone: "" };
    const agentId = lookups ? (lookups.agentByName[d.agentName.toLowerCase().trim()] ?? null) : null;
    const carrierId = lookups ? (lookups.carrierByName[d.carrier.toLowerCase().trim()] ?? null) : null;
    const pre = preflightDeal({
      client: d.client,
      carrier: d.carrier,
      agentName: d.agentName,
      agentId,
      carrierId,
      dob: detail.dob,
      phone: detail.phone,
    });
    return { ...d, index: i, agentId, carrierId, dob: detail.dob, phone: detail.phone, pre };
  });
  const ready = rosterReady ? rows.filter((r) => r.pre.ok) : [];
  const held = rosterReady ? rows.length - ready.length : 0;

  const insertAll = async () => {
    if (!rosterReady || ready.length === 0) return;
    setLoading(true);
    setResults([]);
    try {
      const out: RowResult[] = [];
      for (const r of ready) {
        // pre.ok already proved both ids resolved; this narrows the types and
        // refuses to send a blank id if the roster changed under the table.
        const agentId = r.agentId;
        const carrierId = r.carrierId;
        if (!agentId || !carrierId) {
          out.push({ index: r.index, ok: false, client: r.client, err: "agent or carrier match lost; Parse again" });
          continue;
        }

        // Skip if a deal with this policy_number already exists
        if (r.policyNumber) {
          const { data: existing } = await supabase
            .from("deals").select("id").eq("policy_number", r.policyNumber).maybeSingle();
          if (existing) {
            out.push({ index: r.index, ok: true, client: `${r.client} (already present)` });
            continue;
          }
        }

        // Build row with only core columns (newer columns may not exist yet)
        const row: TablesInsert<"deals"> = {
          agent_id:          agentId,
          carrier_id:        carrierId,
          client_first_name: r.pre.first,
          client_last_name:  r.pre.last,
          // Typed in the table and already graded against the guard's rules.
          // Phone is stored as the normalised digits, the shape the book carries
          // (157 of the last 163 deals) and the shape deal_coverage_phone compares.
          client_phone:      r.pre.normalizedPhone,
          client_dob:        r.dob,
          product_sold:      r.product,
          policy_number:     r.policyNumber || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          monthly_premium:   r.monthly,
          annual_premium:    r.annual,
          // 2026-07-30: was d.annual * 10 — a fabricated face amount that looked
          // captured and passed every check. The column is NOT NULL, so 0: the existing
          // carrier data-gap views treat zero-face as "missing", which is the truth.
          face_amount:       0,
          effective_date:    r.effectiveDate,
          status:            "submitted",
        };

        const { error } = await supabase.from("deals").insert(row);
        if (error) {
          // The guard's second rule (existing coverage on the same carrier + DOB
          // needs manager review through Post a Deal) can only be judged by the
          // database; its message is surfaced here verbatim.
          out.push({ index: r.index, ok: false, client: r.client, err: error.message });
        } else {
          out.push({ index: r.index, ok: true, client: r.client });
        }
      }
      setResults(out);
      const ok = out.filter(r => r.ok).length;
      const bad = out.length - ok;
      const heldNote = held > 0 ? ` · ${held} held until DOB and phone are filled in` : "";
      if (bad === 0) toast.success(`Inserted ${ok} / ${ready.length} ready deals${heldNote}`);
      else toast.error(`Inserted ${ok}/${ready.length} ready; ${bad} failed (see list)${heldNote}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Insert failed");
    } finally { setLoading(false); }
  };

  // Inner admin gate removed — ProtectedRoute already requires auth,
  // and admins / managers can all legitimately bulk-enter deals.

  const totalMonthly = parsed.reduce((s, d) => s + d.monthly, 0);
  const totalAnnual  = parsed.reduce((s, d) => s + d.annual,  0);

  const rosterNote =
    lookup.status === "loading" ? "Loading agents and carriers…"
    : lookup.status === "error" ? "Agents and carriers did not load; nothing can be checked or sent."
    : lookup.status === "idle" ? "Parse first."
    : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
                eyebrow="Admin · Import"
        eyebrowIcon={<Upload className="h-3 w-3" />}
        title="Bulk Deal Import"
        subtitle="Paste raw deal text, fill in each insured's date of birth and phone, then Insert. The deals guard refuses a row without a carrier match, a full insured name, a birth date and a 10-digit phone, so those rows are held here with the reason and never sent. Rows whose policy number already exists are SKIPPED and a re-paste will not update them."
      />

      <GlassCard className="p-4 space-y-3">
        <label className="text-sm font-medium">Paste raw deal text</label>
        <Textarea value={raw} onChange={e => setRaw(e.target.value)} rows={16}
          className="font-mono text-xs"
          placeholder="Agent / Carrier / Product / Policy#—$Monthly $Annual Eff-Date Sub-Date / CLIENT"/>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onParse} variant="outline" size="sm">Parse</Button>
          <Button onClick={insertAll} size="sm" disabled={loading || !rosterReady || ready.length === 0}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
            Insert {ready.length} ready deal{ready.length === 1 ? "" : "s"}
          </Button>
          {parsed.length > 0 && (
            <>
              {held > 0 && <Badge variant="outline" className="border-rose-400/40 text-rose-300">{held} held</Badge>}
              <Badge variant="outline" className="ml-2">Monthly ${totalMonthly.toFixed(2)}</Badge>
              <Badge variant="outline">ALP ${totalAnnual.toLocaleString()}</Badge>
            </>
          )}
        </div>
        {parsed.length > 0 && lookup.status === "error" && (
          <Button onClick={loadLookups} variant="outline" size="sm">Retry loading agents and carriers</Button>
        )}
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
                <th className="text-left px-3 py-2">Date of birth</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const r = results.find(x => x.index === p.index);
                return (
                  <tr key={`${p.policyNumber || p.client}|${p.agentName}|${i}`} className="border-t border-border/20 align-top">
                    <td className="px-3 py-1.5 font-medium">{p.agentName}</td>
                    <td className="px-3 py-1.5">{p.client}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.carrier}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">${p.monthly.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">${p.annual.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.effectiveDate}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="date"
                        value={p.dob}
                        aria-label={`Date of birth for ${p.client}`}
                        onChange={e => setDetail(p.index, { dob: e.target.value })}
                        className="h-8 w-36 text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="tel"
                        inputMode="numeric"
                        placeholder="10 digits"
                        value={p.phone}
                        aria-label={`Phone for ${p.client}`}
                        onChange={e => setDetail(p.index, { phone: e.target.value })}
                        className="h-8 w-36 text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5 max-w-[16rem]">
                      {r?.ok && (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5 inline" /> {r.client.endsWith("(already present)") ? "Already present" : "Inserted"}
                        </span>
                      )}
                      {r && !r.ok && (
                        <span className="inline-flex items-start gap-1 text-rose-300">
                          <AlertCircle className={cn("h-3.5 w-3.5 inline mt-0.5 shrink-0")} /> <span>{r.err}</span>
                        </span>
                      )}
                      {!r && rosterNote && <span className="text-muted-foreground">{rosterNote}</span>}
                      {!r && !rosterNote && p.pre.ok && <span className="text-emerald-400">Ready</span>}
                      {!r && !rosterNote && !p.pre.ok && (
                        <span className="text-rose-300">Held: {p.pre.reasons.join("; ")}</span>
                      )}
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
                <div key={`${r.client}|${r.index}|${r.err ?? ""}`} className="text-rose-200">• {r.client}: {r.err}</div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}
