/**
 * ContractingAuditPanel — /dashboard/contracting/audit (2026-09-24, Sam directive).
 *
 * One row per live agent from v_contracting_audit: the DB, AgentLink (agentlink_roster) and the Ethos
 * "Agent Portal Signup" sheet (ethos_roster) reconciled on NPN, email and name. Each row carries ONE
 * next_action (the first gap in the contracting chain: license -> real NPN -> AgentLink profile ->
 * upline assignment -> carrier contracts -> Ethos sheet row -> Ethos comp level -> live). The summary
 * buckets at the top are the queue; the two Ethos exports are the exact column order of the sheet's
 * `agwnts` and `Agent Updates` tabs so a paste is the whole job (we cannot write that sheet — no service
 * account — so the panel produces the rows instead).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ClipboardCopy, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Row = {
  agent_id: string; display_name: string; email: string | null; phone: string | null; manager_name: string | null;
  status: string; license_status: string | null; recon_bucket: string | null;
  npn_db: string | null; npn_al: string | null; npn_ethos: string | null; npn_verdict: string; dup_npn_with: string | null;
  comp_pct: number; ethos_status: string; ethos_level: string | null; ethos_level_expected: string; ethos_level_verdict: string | null;
  al_id: string | null; al_approval: string | null; al_active: number | null; al_carriers_active: string | null;
  al_carriers_inflight: string | null; al_carriers_blocked: string | null; next_action: string;
  al_synced_at: string | null; ethos_synced_at: string | null;
};
type Summary = { next_action: string; agents: number; licensed: number; who: string };

const ACTION_LABEL: Record<string, string> = {
  merge_duplicate_agent_rows: "Merge duplicate agent rows",
  get_licensed: "Not licensed yet",
  collect_real_npn: "Collect a real NPN",
  resolve_npn_conflict: "NPN conflict (DB vs AgentLink/Ethos)",
  backfill_npn_from_source: "NPN known upstream, blank here",
  create_agentlink_profile: "No AgentLink profile",
  complete_agentlink_profile: "AgentLink profile incomplete",
  upline_assign_in_agentlink: "Assign upline in AgentLink",
  fix_rejected_contracts: "Carrier rejected / issue",
  add_to_ethos_sheet: "Add to Ethos sheet (agwnts tab)",
  agent_sends_ethos_reparenting_email: "Agent must email agents@getethos.com (reparenting)",
  ethos_agent_update_comp_level: "Ethos comp level wrong → Agent Updates tab",
  waiting_on_ethos_portal: "Waiting on Ethos to create portal",
  no_active_carrier_contracts: "No active carrier contract",
  carrier_contracts_in_flight: "Carrier contracts in flight",
  contracted_ok: "Contracted · ready to write",
};
const ACTION_TONE: Record<string, string> = {
  contracted_ok: "border-emerald-500/40 text-emerald-400",
  carrier_contracts_in_flight: "border-sky-500/40 text-sky-300",
  waiting_on_ethos_portal: "border-sky-500/40 text-sky-300",
  get_licensed: "border-border text-muted-foreground",
};

const tsv = (rows: Record<string, unknown>[], cols: string[]) =>
  [cols.join("\t"), ...rows.map((r) => cols.map((c) => String(r[c] ?? "").replace(/[\t\n]/g, " ")).join("\t"))].join("\n");
const csv = (rows: Record<string, unknown>[], cols: string[]) => {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
};
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const AGWNTS_COLS = ["Agent First Name", "Agent Last Name", "Agent NPN", "Direct Upline NPN", "Agent Mobile Number", "Agent Email", "Comp Level", "Advance Pay Tier", "Sub-Agency Name", "Sub-Agent Head?", "Life Licensed?", "$1M in E&O coverage?", "Portal Created", "Date Portal Created", "Ethos Partner ID", "Ethos Partner Code", "Invite", "Ethos Partnership Ops Notes", "Comments"];
const UPDATES_COLS = ["Agent First Name", "Agent Last Name", "Agent NPN", "Direct Upline's NPN", "Comp Level", "Advanced Payments", "PII Information", "Termination", "Information submitted Date"];

export function ContractingAuditPanel() {
  const [action, setAction] = useState<string>("all");
  const [q, setQ] = useState("");

  const auditQ = useQuery({
    queryKey: ["contracting-audit"],
    staleTime: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.from("v_contracting_audit" as never).select("*").order("display_name").limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  const summaryQ = useQuery({
    queryKey: ["contracting-audit-summary"],
    staleTime: 60_000,
    queryFn: async (): Promise<Summary[]> => {
      const { data, error } = await supabase.from("v_contracting_audit_summary" as never).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Summary[];
    },
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (auditQ.data ?? []).filter((r) =>
      (action === "all" || r.next_action === action) &&
      (!needle || [r.display_name, r.email, r.manager_name, r.npn_db, r.npn_al, r.npn_ethos].some((v) => (v ?? "").toLowerCase().includes(needle))),
    );
  }, [auditQ.data, action, q]);

  const freshness = useMemo(() => {
    const al = (auditQ.data ?? []).map((r) => r.al_synced_at).filter(Boolean).sort().pop();
    const et = (auditQ.data ?? []).map((r) => r.ethos_synced_at).filter(Boolean).sort().pop();
    return { al, et };
  }, [auditQ.data]);

  const exportView = async (view: "v_ethos_paste_rows" | "v_ethos_agent_updates", cols: string[], mode: "copy" | "download") => {
    const { data, error } = await supabase.from(view as never).select("*");
    if (error) { toast.error(`Could not read ${view}: ${error.message}`); return; }
    const list = (data ?? []) as unknown as Record<string, unknown>[];
    if (!list.length) { toast.info("Nothing to paste — that tab is already in sync."); return; }
    if (mode === "copy") {
      try {
        await navigator.clipboard.writeText(tsv(list, cols));
        toast.success(`${list.length} row(s) copied as tab-separated — paste straight into the sheet.`);
      } catch {
        download(`${view}.tsv`, tsv(list, cols));
      }
    } else {
      download(`${view}-${new Date().toISOString().slice(0, 10)}.csv`, csv(list, cols));
    }
  };

  const exportAudit = () =>
    download(
      `contracting-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      csv(rows as unknown as Record<string, unknown>[], ["display_name", "manager_name", "license_status", "next_action", "npn_db", "npn_al", "npn_ethos", "npn_verdict", "dup_npn_with", "ethos_status", "ethos_level", "ethos_level_expected", "ethos_level_verdict", "comp_pct", "al_approval", "al_active", "al_carriers_active", "al_carriers_inflight", "al_carriers_blocked", "email", "phone"]),
    );

  return (
    <div className="space-y-4">
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Where every agent stands</div>
            <p className="text-xs text-muted-foreground">
              DB ↔ AgentLink ↔ Ethos sheet, reconciled on NPN / email / name. Each agent gets one next action — the first gap in the chain.
              {freshness.al && <> AgentLink roster synced {new Date(freshness.al).toLocaleString()}.</>}
              {freshness.et && <> Ethos sheet snapshot {new Date(freshness.et).toLocaleString()}.</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportView("v_ethos_paste_rows", AGWNTS_COLS, "copy")}>
              <ClipboardCopy className="mr-1.5 h-4 w-4" /> Copy Ethos agwnts rows
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportView("v_ethos_agent_updates", UPDATES_COLS, "copy")}>
              <ClipboardCopy className="mr-1.5 h-4 w-4" /> Copy Ethos Agent Updates
            </Button>
            <Button variant="outline" size="sm" onClick={exportAudit} disabled={!rows.length}>
              <Download className="mr-1.5 h-4 w-4" /> Export audit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { auditQ.refetch(); summaryQ.refetch(); }}>
              <RefreshCw className={cn("h-4 w-4", auditQ.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {(auditQ.isError || summaryQ.isError) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mr-1 inline h-4 w-4" /> The audit view did not load — a read failure, not a clean roster.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAction("all")}
            className={cn("rounded-full border px-3 py-1 text-xs", action === "all" ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}
          >
            All · {auditQ.data?.length ?? 0}
          </button>
          {summaryQ.isLoading && <Skeleton className="h-6 w-40" />}
          {(summaryQ.data ?? []).map((s) => (
            <button
              key={s.next_action}
              type="button"
              onClick={() => setAction(action === s.next_action ? "all" : s.next_action)}
              title={s.who}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                action === s.next_action ? "border-primary bg-primary/10" : (ACTION_TONE[s.next_action] ?? "border-amber-500/40 text-amber-300"),
              )}
            >
              {ACTION_LABEL[s.next_action] ?? s.next_action} · {s.agents}
            </button>
          ))}
        </div>

        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, manager, NPN…" className="max-w-sm" />
      </GlassCard>

      <GlassCard className="overflow-x-auto p-2 sm:p-3">
        {auditQ.isLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Agent</th>
                <th className="py-1 pr-3">Next action</th>
                <th className="py-1 pr-3">License</th>
                <th className="py-1 pr-3">NPN (DB / AgentLink / Ethos)</th>
                <th className="py-1 pr-3">Ethos</th>
                <th className="py-1 pr-3">AgentLink carriers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agent_id} className="border-t border-border/50 align-top">
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{r.display_name}</div>
                    <div className="text-xs text-muted-foreground">{r.manager_name ? `↑ ${r.manager_name}` : "no manager"}{r.email ? ` · ${r.email}` : ""}</div>
                    {r.dup_npn_with && <div className="text-xs text-destructive">shares NPN with {r.dup_npn_with}</div>}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", ACTION_TONE[r.next_action] ?? "border-amber-500/40 text-amber-300")}>
                      {ACTION_LABEL[r.next_action] ?? r.next_action}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-xs">{r.license_status ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    <span className={cn(r.npn_verdict === "valid" ? "text-emerald-400" : r.npn_verdict.startsWith("valid") ? "" : "text-amber-300")}>{r.npn_db ?? "∅"}</span>
                    {" / "}{r.npn_al ?? "∅"}{" / "}{r.npn_ethos ?? "∅"}
                    <div className="text-[10px] text-muted-foreground">{r.npn_verdict.replace(/_/g, " ")}</div>
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    <div>{r.ethos_status.replace(/_/g, " ")}</div>
                    {r.ethos_status !== "not_on_sheet" && (
                      <div className={cn("text-[11px]", r.ethos_level_verdict === "ok" ? "text-muted-foreground" : "text-amber-300")}>
                        sheet: {r.ethos_level ?? "blank"} · expected {r.ethos_level_expected} ({r.comp_pct}%)
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    {r.al_id == null ? (
                      <span className="text-amber-300">no AgentLink profile</span>
                    ) : (
                      <>
                        <div>{r.al_active ?? 0} active{r.al_carriers_active ? `: ${r.al_carriers_active}` : ""}</div>
                        {r.al_carriers_inflight && <div className="text-sky-300">in flight: {r.al_carriers_inflight}</div>}
                        {r.al_carriers_blocked && <div className="text-destructive">blocked: {r.al_carriers_blocked}</div>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No agents under this filter.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}

export default ContractingAuditPanel;
