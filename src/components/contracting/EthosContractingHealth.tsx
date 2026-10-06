/**
 * EthosContractingHealth — /dashboard/contracting/ethos
 *
 * One queue for getting producers onto the Ethos "Agent Portal Signup" sheet correctly:
 * collect -> verify -> approve -> submit once -> reconcile Ethos's response.
 *
 * Every verdict here comes from supabase/functions/_shared/ethos-contract.ts, the same module
 * the outbox dispatcher and the sheet sync run, so the rule that blocks a row in production is
 * the rule this page shows. Counts are distinct producers. Nothing on this page writes to the
 * carrier sheet: the "Copy ready rows" action produces the exact A:L cells for a reviewed paste,
 * and the next sheet refresh is what moves a producer to "Submitted".
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCopy, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  ADVANCE_TIERS, ETHOS_COMP_GRID_VERSION, ETHOS_COMP_LEVELS, PIPELINE_STAGES, PIPELINE_STAGE_LABELS,
  SIGNUP_HEADERS, digitsOnly, derivePipelineStage, evaluateSignupGate, readCarrierState,
  type Finding, type PipelineStage, type SheetCell, type SignupApproval,
} from "../../../supabase/functions/_shared/ethos-contract.ts";

type Snapshot = {
  id: string; fetched_at: string; status: string; error: string | null;
  counts: Record<string, number> | null; updates_counts: Record<string, number | boolean> | null;
  duplicates: Array<{ key_masked: string; rows: number[]; kind: string; differing_columns: string[] }> | null;
};
type SheetRow = {
  row_number: number; first_name: string | null; last_name: string | null; npn: string | null; upline_npn: string | null;
  mobile: string | null; email: string | null; comp_level: string | null; advance_tier: string | null; sub_agency: string | null;
  sub_agent_head: string | null; life_licensed: string | null; eo: string | null; portal_created: string | null;
  portal_date_raw: string | null; partner_id: string | null; partner_code: string | null; invite_unique: boolean | null;
  blockers: string[]; review: string[];
};
type AuditRow = {
  agent_id: string; display_name: string; email: string | null; phone: string | null; manager_name: string | null;
  license_status: string | null; npn_db: string | null; npn_al: string | null; comp_pct: number | null;
};
type Intake = {
  id: string; first_name: string; last_name: string; email: string; phone_e164: string; npn: string | null;
  status: string; agent_id: string | null; license_status: string | null;
};
type Approval = SignupApproval & {
  id: string; agent_id: string | null; intake_id: string | null; legal_first_name: string | null; legal_last_name: string | null;
  owner_name: string | null; note: string | null; updated_at: string;
};
type Producer = {
  key: string; agentId: string | null; intakeId: string | null; name: string; manager: string | null;
  candidate: { first_name: string; last_name: string; npn: string; mobile: string; email: string };
  approval: Approval | null; internalPct: number | null; sheetRow: SheetRow | null;
  stage: PipelineStage; blockers: Finding[]; review: Finding[]; payload: SheetCell[] | null; deliveryState: string | null;
};

const PAGE = 1000;
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function sheetRowToCells(r: SheetRow): unknown[] {
  return [r.first_name, r.last_name, r.npn, r.upline_npn, r.mobile, r.email, r.comp_level, r.advance_tier, r.sub_agency,
    r.sub_agent_head, r.life_licensed, r.eo, r.portal_created, r.portal_date_raw, r.partner_id, r.partner_code,
    r.invite_unique ? "https://agents.ethoslife.com/invite/x" : "", "", ""].map((v) => v ?? "");
}

const ON_SHEET_NEXT: Partial<Record<PipelineStage, string>> = {
  submitted_awaiting_ethos: "On the sheet. Wait for Ethos to create the portal; escalate after two business days with no change.",
  reparenting: "Agent submits their own reparenting request (Ethos form or agents@getethos.com). Record consent and Ethos acknowledgment.",
  carrier_confirmed: "Portal confirmed by Ethos. Product/state authorization to sell is a separate check.",
  failed_sync: "The automated export failed or its outcome is unknown. Check the sheet before any retry.",
};

export function EthosContractingHealth() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<PipelineStage | "all">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Producer | null>(null);

  const data = useQuery({
    queryKey: ["ethos-contracting-health"],
    staleTime: 60_000,
    queryFn: async () => {
      const snaps = await supabase.from("ethos_sheet_snapshots" as never)
        .select("id, fetched_at, status, error, counts, updates_counts, duplicates")
        .order("fetched_at", { ascending: false }).limit(10);
      if (snaps.error) throw new Error(snaps.error.message);
      const snapshots = (snaps.data ?? []) as unknown as Snapshot[];
      const latest = snapshots.find((s) => s.status === "complete") ?? null;
      const lastAttempt = snapshots[0] ?? null;
      const [rows, audit, intakes, approvals, deliveries] = await Promise.all([
        latest
          ? readAll<SheetRow>((a, b) => supabase.from("ethos_sheet_rows" as never).select("*").eq("snapshot_id", latest.id).order("row_number").range(a, b))
          : Promise.resolve([] as SheetRow[]),
        readAll<AuditRow>((a, b) => supabase.from("v_contracting_audit" as never)
          .select("agent_id, display_name, email, phone, manager_name, license_status, npn_db, npn_al, comp_pct")
          .eq("license_status", "licensed").order("display_name").range(a, b)),
        readAll<Intake>((a, b) => supabase.from("contracting_intakes" as never)
          .select("id, first_name, last_name, email, phone_e164, npn, status, agent_id, license_status").order("created_at").range(a, b)),
        readAll<Approval>((a, b) => supabase.from("contracting_ethos_approvals" as never).select("*").range(a, b)),
        readAll<{ intake_id: string; state: string }>((a, b) => supabase.from("contracting_intake_deliveries" as never)
          .select("intake_id, state").eq("destination", "ethos_sheet").range(a, b)),
      ]);
      return { latest, lastAttempt, rows, audit, intakes, approvals, deliveries };
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      const { data: body, error } = await supabase.functions.invoke("ethos-sheet-sync", { body: {} });
      if (error) {
        // functions.invoke resolves {error} on non-2xx; the function's own sentence is in the body.
        let detail: string | null = null;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            detail = ((await ctx.json()) as { error?: string })?.error ?? null;
          } catch (parseError) {
            detail = `unreadable error body (${String(parseError)})`;
          }
        }
        throw new Error(detail || error.message);
      }
      if (!body?.ok) throw new Error(body?.error ?? "The sheet read did not complete");
      return body as { counts: Record<string, number> };
    },
    onSuccess: (body) => {
      toast.success(`Sheet refreshed: ${body.counts.populatedRows} rows, ${body.counts.repeatedNpnGroups} repeated-NPN groups.`);
      queryClient.invalidateQueries({ queryKey: ["ethos-contracting-health"] });
    },
    onError: (e: Error) => toast.error(`Sheet refresh failed: ${e.message}`),
  });

  const producers = useMemo<Producer[]>(() => {
    const d = data.data;
    if (!d) return [];
    const sheetRows: unknown[][] = [[...SIGNUP_HEADERS]];
    for (const r of d.rows) sheetRows[r.row_number - 1] = sheetRowToCells(r);
    for (let i = 0; i < sheetRows.length; i++) if (!sheetRows[i]) sheetRows[i] = [];
    const byNpn = new Map<string, SheetRow>();
    for (const r of d.rows) { const k = digitsOnly(r.npn); if (k && !byNpn.has(k)) byNpn.set(k, r); }
    const approvalByAgent = new Map(d.approvals.filter((a) => a.agent_id).map((a) => [a.agent_id as string, a]));
    const approvalByIntake = new Map(d.approvals.filter((a) => a.intake_id).map((a) => [a.intake_id as string, a]));
    const deliveryByIntake = new Map(d.deliveries.map((x) => [x.intake_id, x.state]));
    const intakeByAgent = new Map<string, Intake>();
    for (const i of d.intakes) if (i.agent_id) intakeByAgent.set(i.agent_id, i);

    const base: Array<Omit<Producer, "stage" | "blockers" | "review" | "payload">> = [];
    for (const a of d.audit) {
      const intake = intakeByAgent.get(a.agent_id) ?? null;
      const approval = approvalByAgent.get(a.agent_id) ?? (intake ? approvalByIntake.get(intake.id) ?? null : null);
      const [first, ...rest] = a.display_name.trim().split(/\s+/);
      base.push({
        key: `agent:${a.agent_id}`, agentId: a.agent_id, intakeId: intake?.id ?? null, name: a.display_name, manager: a.manager_name,
        candidate: {
          first_name: approval?.legal_first_name || intake?.first_name || first || "",
          last_name: approval?.legal_last_name || intake?.last_name || rest.join(" "),
          npn: a.npn_db || a.npn_al || intake?.npn || "",
          mobile: a.phone || intake?.phone_e164 || "",
          email: a.email || intake?.email || "",
        },
        approval, internalPct: a.comp_pct, sheetRow: null,
        deliveryState: intake ? deliveryByIntake.get(intake.id) ?? null : null,
      });
    }
    for (const i of d.intakes) {
      if (i.agent_id || (i.license_status && i.license_status !== "licensed") || !i.npn) continue;
      const approval = approvalByIntake.get(i.id) ?? null;
      base.push({
        key: `intake:${i.id}`, agentId: null, intakeId: i.id, name: `${i.first_name} ${i.last_name}`, manager: null,
        candidate: {
          first_name: approval?.legal_first_name || i.first_name, last_name: approval?.legal_last_name || i.last_name,
          npn: i.npn, mobile: i.phone_e164, email: i.email,
        },
        approval, internalPct: null, sheetRow: null, deliveryState: deliveryByIntake.get(i.id) ?? null,
      });
    }
    const queue = base.map((p) => ({ id: p.key, npn: p.candidate.npn, email: p.candidate.email, mobile: p.candidate.mobile }));
    const now = Date.now();
    return base.map((p) => {
      const sheetRow = byNpn.get(digitsOnly(p.candidate.npn)) ?? null;
      const gate = evaluateSignupGate(p.candidate, p.approval, { now, sheetRows, queue, selfId: p.key });
      const findings = [...gate.blockers, ...gate.review];
      const stageValue = derivePipelineStage({
        deliveryState: p.deliveryState,
        findings,
        onSheet: Boolean(sheetRow),
        carrier: sheetRow ? readCarrierState(sheetRowToCells(sheetRow)) : null,
      });
      return { ...p, sheetRow, stage: stageValue, blockers: gate.blockers, review: gate.review, payload: gate.ready ? gate.payload : null };
    });
  }, [data.data]);

  const counts = useMemo(() => {
    const c = new Map<PipelineStage, number>();
    for (const p of producers) c.set(p.stage, (c.get(p.stage) ?? 0) + 1);
    return c;
  }, [producers]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return producers.filter((p) => (stage === "all" || p.stage === stage)
      && (!needle || [p.name, p.candidate.email, p.candidate.npn, p.manager, p.approval?.owner_name].some((v) => (v ?? "").toLowerCase().includes(needle))));
  }, [producers, stage, q]);

  const ready = producers.filter((p) => p.stage === "ready_to_submit" && p.payload);
  const copyReady = async () => {
    if (!ready.length) { toast.info("No producer has passed the gate yet."); return; }
    const tsv = ready.map((p) => (p.payload as SheetCell[]).map((v) => (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v))).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      toast.success(`${ready.length} gate-checked row(s) copied (A:L only). Paste at the first empty row of agwnts, then refresh from the sheet.`);
    } catch {
      toast.error("Clipboard is blocked in this browser. Allow clipboard access and try again.");
    }
  };

  const snapshot = data.data?.latest ?? null;
  const lastAttempt = data.data?.lastAttempt ?? null;
  const stale = !snapshot || Date.now() - new Date(snapshot.fetched_at).getTime() > 6 * 3_600_000;

  if (data.isLoading) return <Skeleton className="h-64 w-full" />;
  if (data.isError) {
    return (
      <Card><CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Could not load the Ethos queue: {(data.error as Error).message}. This is a read failure, not an empty pipeline.
      </CardContent></Card>
    );
  }

  const sc = snapshot?.counts ?? {};
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Ethos sheet · live mirror</p>
              <p className="text-xs text-muted-foreground">
                {snapshot ? <>Read {formatTimeAgo(snapshot.fetched_at)} from the carrier sheet (read-only).</> : <>Not read yet — the audit falls back to the 24 Sep copy.</>}
                {lastAttempt && lastAttempt.status === "failed" && <span className="text-destructive"> Last attempt failed: {lastAttempt.error}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", sync.isPending && "animate-spin")} />{stale ? "Refresh from sheet (stale)" : "Refresh from sheet"}
              </Button>
              <Button size="sm" onClick={copyReady} disabled={!ready.length}>
                <ClipboardCopy className="mr-1.5 h-4 w-4" />Copy {ready.length} ready row{ready.length === 1 ? "" : "s"} (A:L)
              </Button>
            </div>
          </div>
          {snapshot && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
              {[
                ["Sheet rows", sc.populatedRows],
                ["Distinct NPNs", sc.distinctNpn],
                ["Repeated NPN groups", `${sc.repeatedNpnGroups ?? 0} (${sc.repeatedNpnGroupsConflicting ?? 0} conflicting)`],
                ["Needs reparenting", `${sc.needsReparentingRows ?? 0} rows / ${sc.needsReparentingDistinctNpn ?? 0} NPNs`],
                ["Portal created", sc.portalCreatedRows],
                ["License / E&O unchecked", `${sc.lifeUnchecked ?? 0} / ${sc.eoUnchecked ?? 0}`],
                ["Rows with blockers", sc.rowsWithBlockers],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border border-border px-3 py-2">
                  <p className="text-muted-foreground">{label}</p>
                  <p className="font-semibold tabular-nums">{value ?? "—"}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Counts below are distinct producers (licensed agents plus unlinked licensed intakes), not sheet rows. "Ready to submit" is an internal gate, not Ethos approval and not authorization to sell.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStage("all")}
          className={cn("rounded-full border px-3 py-1 text-xs", stage === "all" ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}>
          All producers · {producers.length}
        </button>
        {PIPELINE_STAGES.map((s) => (
          <button key={s} type="button" onClick={() => setStage(stage === s ? "all" : s)}
            className={cn("rounded-full border px-3 py-1 text-xs", stage === s ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}>
            {PIPELINE_STAGE_LABELS[s].split(" (")[0]} · {counts.get(s) ?? 0}
          </button>
        ))}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, NPN, upline, owner…" className="max-w-sm" aria-label="Search producers" />

      <Card>
        <CardContent className="overflow-x-auto p-2 sm:p-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Producer</th>
                <th className="py-1 pr-3">Stage</th>
                <th className="py-1 pr-3">Blockers</th>
                <th className="py-1 pr-3">Next action</th>
                <th className="py-1 pr-3">Owner</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const next = ON_SHEET_NEXT[p.stage] ?? p.blockers[0]?.resolution ?? (p.stage === "ready_to_submit" ? "Copy the row and paste it into agwnts once." : "—");
                return (
                  <tr key={p.key} className="border-t border-border/60 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        NPN {p.candidate.npn || "missing"}{p.manager ? ` · ↑ ${p.manager}` : ""}{p.sheetRow ? ` · sheet row ${p.sheetRow.row_number}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <Badge variant="outline" className="whitespace-nowrap text-[11px]">{PIPELINE_STAGE_LABELS[p.stage].split(" (")[0]}</Badge>
                      {p.sheetRow && <div className="mt-1 text-muted-foreground">sheet: {p.sheetRow.comp_level ?? "no level"} · {p.sheetRow.advance_tier ?? "no tier"}</div>}
                      {p.approval?.approved_comp_level && <div className="text-muted-foreground">approved: {p.approval.approved_comp_level}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {p.blockers.length === 0 ? <span className="text-muted-foreground">none</span> : (
                        <ul className="space-y-0.5">{p.blockers.slice(0, 4).map((b) => <li key={b.code}>{b.message}</li>)}
                          {p.blockers.length > 4 && <li className="text-muted-foreground">+{p.blockers.length - 4} more</li>}</ul>
                      )}
                      {p.review.length > 0 && <div className="mt-1 text-muted-foreground">review: {p.review.map((r) => r.code.replace(/_/g, " ")).join(", ")}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">{next}</td>
                    <td className="py-2 pr-3 text-xs">{p.approval?.owner_name ?? <span className="text-muted-foreground">unassigned</span>}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Review</Button>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No producers in this view.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {snapshot?.duplicates && snapshot.duplicates.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4 text-xs">
            <p className="text-sm font-semibold">Repeated NPNs on the sheet</p>
            <p className="text-muted-foreground">Rows are never deleted automatically. A conflicting group needs a person to decide which values are true.</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {snapshot.duplicates.map((g) => (
                <li key={g.key_masked + g.rows.join("-")} className={cn(g.kind === "conflict" && "text-destructive")}>
                  NPN {g.key_masked}: rows {g.rows.join(", ")} — {g.kind === "conflict" ? `conflict on ${g.differing_columns.join(", ")}` : "identical repeat"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {editing && (
        <ReviewDialog producer={editing} isAdmin={!!isAdmin} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["ethos-contracting-health"] }); }} />
      )}
    </div>
  );
}

function ReviewDialog({ producer, isAdmin, onClose, onSaved }: { producer: Producer; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const a = producer.approval;
  const [ev, setEv] = useState({
    legal_first_name: a?.legal_first_name ?? producer.candidate.first_name,
    legal_last_name: a?.legal_last_name ?? producer.candidate.last_name,
    npn_verified: Boolean(a?.npn_verified_at), npn_verified_source: a?.npn_verified_source ?? "",
    license_verified: Boolean(a?.license_verified_at), license_evidence_ref: a?.license_evidence_ref ?? "",
    eo_verified: Boolean(a?.eo_verified_at), eo_expires_at: a?.eo_expires_at ?? "", eo_evidence_ref: a?.eo_evidence_ref ?? "",
    contact_confirmed: Boolean(a?.contact_confirmed_at), owner_name: a?.owner_name ?? "", note: a?.note ?? "",
  });
  const [ap, setAp] = useState({
    approved_comp_level: a?.approved_comp_level ?? "", approved_advance_tier: a?.approved_advance_tier ?? "",
    approved_upline_npn: a?.approved_upline_npn ?? "", approved_sub_agency: a?.approved_sub_agency ?? "",
    approved_sub_agent_head: a?.approved_sub_agent_head ?? null as boolean | null,
  });
  const [approve, setApprove] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("contracting_save_ethos_review" as never, {
        p_agent_id: producer.agentId, p_intake_id: producer.agentId ? null : producer.intakeId,
        p_evidence: ev,
        p_approval: isAdmin && approve ? { ...ap, comp_grid_version: ETHOS_COMP_GRID_VERSION } : null,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Saved. The gate re-evaluates immediately."); onSaved(); },
    onError: (e: Error) => toast.error(`Not saved: ${e.message}`),
  });

  const check = (key: "npn_verified" | "license_verified" | "eo_verified" | "contact_confirmed", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={ev[key]} onCheckedChange={(v) => setEv({ ...ev, [key]: v === true })} aria-label={label} />{label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{producer.name}</DialogTitle>
          <DialogDescription>
            Evidence is recorded by contracting staff; level, advance, upline, sub-agency and head designation need an admin approval. Internal comp ({producer.internalPct ?? "—"}%) is shown for reference only and never becomes the Ethos level.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="lf">Legal first name</Label><Input id="lf" value={ev.legal_first_name} onChange={(e) => setEv({ ...ev, legal_first_name: e.target.value })} /></div>
          <div><Label htmlFor="ll">Legal last name</Label><Input id="ll" value={ev.legal_last_name} onChange={(e) => setEv({ ...ev, legal_last_name: e.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2">
            {check("npn_verified", "NPN verified as this person's individual NPN")}
            <Input value={ev.npn_verified_source} onChange={(e) => setEv({ ...ev, npn_verified_source: e.target.value })} placeholder="Verification source (e.g. NIPR lookup)" aria-label="NPN verification source" />
            {check("license_verified", "Current life license verified")}
            <Input value={ev.license_evidence_ref} onChange={(e) => setEv({ ...ev, license_evidence_ref: e.target.value })} placeholder="License evidence reference" aria-label="License evidence reference" />
            {check("eo_verified", "$1M E&O certificate reviewed (name, limit, dates)")}
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="date" value={ev.eo_expires_at} onChange={(e) => setEv({ ...ev, eo_expires_at: e.target.value })} aria-label="E&O expiration date" />
              <Input value={ev.eo_evidence_ref} onChange={(e) => setEv({ ...ev, eo_evidence_ref: e.target.value })} placeholder="E&O evidence reference" aria-label="E&O evidence reference" />
            </div>
            {check("contact_confirmed", `Agent confirmed ${producer.candidate.email || "email"} and ${producer.candidate.mobile || "mobile"} are theirs`)}
          </div>
          <div><Label htmlFor="own">Accountable owner</Label><Input id="own" value={ev.owner_name} onChange={(e) => setEv({ ...ev, owner_name: e.target.value })} placeholder="e.g. contracting operator" /></div>
          <div><Label htmlFor="note">Note</Label><Input id="note" value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} /></div>
        </div>

        {isAdmin && (
          <div className="mt-2 space-y-3 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={approve} onCheckedChange={(v) => setApprove(v === true)} aria-label="Record leadership approval" />
              Record leadership approval ({ETHOS_COMP_GRID_VERSION})
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Ethos comp level</Label>
                <Select value={ap.approved_comp_level} onValueChange={(v) => setAp({ ...ap, approved_comp_level: v })}>
                  <SelectTrigger aria-label="Approved Ethos comp level"><SelectValue placeholder="Pick a grid level" /></SelectTrigger>
                  <SelectContent>{ETHOS_COMP_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Advance pay tier</Label>
                <Select value={ap.approved_advance_tier} onValueChange={(v) => setAp({ ...ap, approved_advance_tier: v })}>
                  <SelectTrigger aria-label="Approved advance pay tier"><SelectValue placeholder="Pick a tier" /></SelectTrigger>
                  <SelectContent>{ADVANCE_TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="up">Direct upline NPN</Label><Input id="up" inputMode="numeric" value={ap.approved_upline_npn} onChange={(e) => setAp({ ...ap, approved_upline_npn: e.target.value.replace(/[^0-9]/g, "") })} /></div>
              <div><Label htmlFor="sa">Sub-agency name</Label><Input id="sa" value={ap.approved_sub_agency} onChange={(e) => setAp({ ...ap, approved_sub_agency: e.target.value })} /></div>
              <div>
                <Label>Sub-agent head?</Label>
                <Select value={ap.approved_sub_agent_head === null ? "" : ap.approved_sub_agent_head ? "yes" : "no"} onValueChange={(v) => setAp({ ...ap, approved_sub_agent_head: v === "yes" })}>
                  <SelectTrigger aria-label="Approved sub-agent head designation"><SelectValue placeholder="Decide" /></SelectTrigger>
                  <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EthosContractingHealth;
