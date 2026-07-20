// CarrierPasteDialog — paste-in tool for carrier portal exports.
//
// Accepts the tab-separated rows Sam sends ("Client name<TAB>Carrier<TAB>...").
// Parses, previews, ingests via supabase.from(carrier_policies).upsert,
// then calls fn_match_carrier_policy_agents() to link to internal agents.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, CheckCircle2, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  client_first_name: string | null;
  client_last_name: string | null;
  carrier_name: string;
  policy_number: string | null;
  policy_status: string | null;
  effective_date: string | null;
  face_amount: number | null;
  annual_premium: number | null;
  agent_raw: string | null;
}

function parseMoney(s: string | undefined): number | null {
  if (!s || s.trim() === "-" || s.trim() === "—" || !s.trim()) return null;
  const cleaned = s.replace(/[$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string | undefined): string | null {
  if (!s || s.trim() === "-" || s.trim() === "—" || !s.trim()) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  if (yy.length === 2) yy = (parseInt(yy) > 50 ? "19" : "20") + yy;
  if (parseInt(yy) < 1900) return null;   // skip sentinel 1800 dates
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function splitName(s: string): [string | null, string | null] {
  const parts = s.trim().split(/\s+/);
  if (parts.length === 0) return [null, null];
  if (parts.length === 1) return [parts[0], null];
  return [parts[0], parts.slice(1).join(" ")];
}

function parsePaste(text: string): Row[] {
  const out: Row[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    // Try tabs first, then 2+ spaces
    let cells = line.split("\t");
    if (cells.length < 8) cells = line.split(/ {2,}/);
    if (cells.length < 8) continue;
    const [client, carrier, policy, status, eff, face, prem, agent] = cells;
    const [fn, ln] = splitName(client);
    out.push({
      client_first_name: fn,
      client_last_name: ln,
      carrier_name: carrier.trim(),
      policy_number: (policy.trim() === "-" || !policy.trim()) ? null : policy.trim(),
      policy_status: status.trim() || null,
      effective_date: parseDate(eff),
      face_amount: parseMoney(face),
      annual_premium: parseMoney(prem),
      agent_raw: (agent.trim() === "-" || !agent.trim()) ? null : agent.trim(),
    });
  }
  return out;
}

interface Props { onDone?: () => void; }

export function CarrierPasteDialog({ onDone }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [view, setView] = useState<"paste" | "preview">("paste");
  const [parsed, setParsed] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  function handleParse() {
    const rows = parsePaste(text);
    if (rows.length === 0) {
      toast.error("No rows parsed — expected tab-separated columns: client, carrier, policy#, status, eff, face, premium, agent");
      return;
    }
    setParsed(rows);
    setView("preview");
  }

  async function handleIngest() {
    if (!parsed) return;
    setBusy(true);
    try {
      const batchId = crypto.randomUUID();
      const payload = parsed.map((r) => ({ ...r, source: "paste_dialog", source_batch_id: batchId }));
      // Upsert in batches of 100 to keep payloads modest
      const CHUNK = 100;
      let inserted = 0;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const chunk = payload.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("carrier_policies" as any)
          .upsert(chunk, { onConflict: "carrier_name,policy_number", ignoreDuplicates: false });
        if (error) throw error;
        inserted += chunk.length;
      }
      const { data: matched } = await supabase.rpc("fn_match_carrier_policy_agents" as any);
      toast.success(`Ingested ${inserted} rows · matched ${matched ?? 0} to agents`, { duration: 6000 });
      setOpen(false);
      setText("");
      setParsed(null);
      setView("paste");
      qc.invalidateQueries();
      onDone?.();
    } catch (e: any) {
      toast.error(`Ingest failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    if (!parsed) return null;
    const carriers = new Set(parsed.map((r) => r.carrier_name));
    const noPolicy = parsed.filter((r) => !r.policy_number).length;
    const totalPremium = parsed.reduce((s, r) => s + (r.annual_premium ?? 0), 0);
    return { count: parsed.length, carriers: carriers.size, noPolicy, totalPremium };
  }, [parsed]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload className="h-4 w-4 mr-1.5" /> Paste carrier export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Ingest carrier portal export
          </DialogTitle>
        </DialogHeader>

        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="paste">1. Paste rows</TabsTrigger>
            <TabsTrigger value="preview" disabled={!parsed}>2. Preview & ingest</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              Paste tab-separated rows from any carrier portal. Expected columns
              (left to right): <em>Client Name · Carrier · Policy # · Status · Effective Date · Face Amount · Premium · Agent</em>.
              Multi-space columns also work. "—" / "-" / blank → null.
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Aisha Cooper	American Home Life	AMH6315651	Active	04/30/2026	$40,000.00	$1,438.40	Kaeden Vaughns"
              rows={16}
              className="font-mono text-xs"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleParse} disabled={!text.trim()}>Parse → preview</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="preview" className="space-y-3 mt-3">
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Tile label="Rows" value={summary.count} />
                <Tile label="Carriers" value={summary.carriers} />
                <Tile label="No policy #" value={summary.noPolicy} color="text-rose-500 dark:text-rose-400" />
                <Tile label="Premium $" value={`$${Math.round(summary.totalPremium).toLocaleString()}`} color="text-emerald-500 dark:text-emerald-400" />
              </div>
            )}
            <div className="rounded-md border border-border/40 p-2 max-h-64 overflow-y-auto text-xs space-y-1">
              {(parsed ?? []).slice(0, 50).map((r, i) => (
                <div key={`${r.policy_number ?? ""}|${r.client_first_name ?? ""}|${r.client_last_name ?? ""}|${i}`} className="flex items-center justify-between gap-2 border-b border-border/30 pb-1">
                  <span className="truncate">
                    <strong>{r.client_first_name} {r.client_last_name}</strong> ·{" "}
                    <span className="text-muted-foreground">{r.carrier_name}</span> ·{" "}
                    {r.policy_number ? (
                      <span className="font-mono">{r.policy_number}</span>
                    ) : (
                      <span className="text-rose-500 dark:text-rose-400 font-semibold">NO POLICY #</span>
                    )}
                    {" · "}<span className="text-muted-foreground">{r.policy_status ?? "?"}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-emerald-500 dark:text-emerald-400">
                    {r.annual_premium ? `$${r.annual_premium.toLocaleString()}` : "—"}
                  </span>
                </div>
              ))}
              {(parsed?.length ?? 0) > 50 && (
                <p className="text-center text-muted-foreground py-2">… {(parsed?.length ?? 0) - 50} more rows</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p>Ingest will <strong>upsert</strong> by (carrier, policy#). Rows without a policy # are inserted fresh each time.</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setView("paste")}>← Back</Button>
              <Button onClick={handleIngest} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                {busy ? "Ingesting…" : `Ingest ${parsed?.length ?? 0} rows`}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-md border border-border/40 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color ?? ""}`}>{value}</p>
    </div>
  );
}
