import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  CONTRACTING_HEADERS, FIELD_LABEL, STATUS_LABEL, VIEWS, fetchContractingRequests, inView, setContractingRequestStatus,
  setDefaultAdvance, submitContractingRequest, syncContractingSheet, toCsv, toExportRow, type RequestRow, type RequestView,
} from "@/lib/contractingRequests";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Search } from "lucide-react";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/**
 * The contracting requests dashboard (Sam's 2026-10-14 brief): one row per active agent, the 14 template values
 * built by the database from verified records, what is missing and who owns the next action, and the submitted
 * requests with their sheet-sync state. Nothing here invents a value; blanks are shown as blanks with a reason.
 */
export function ContractingRequestsBoard() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contracting-requests"], queryFn: fetchContractingRequests, staleTime: 30_000 });
  const [view, setView] = useState<RequestView>("attention");
  const [search, setSearch] = useState("");
  const [upline, setUpline] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const uplines = useMemo(() => Array.from(new Set(rows.map((r) => r.direct_upline).filter((x): x is string => !!x))).sort(), [rows]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, rows.filter((r) => inView(r, v.key)).length])) as Record<RequestView, number>, [rows]);
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => inView(r, view) && (upline === "all" || r.direct_upline === upline)
      && (!s || [r.display_name, r.first_name, r.last_name, r.npn, r.email, r.direct_upline].some((x) => (x ?? "").toLowerCase().includes(s))));
  }, [rows, view, upline, search]);
  const open = rows.find((r) => r.agent_id === openId) ?? null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["contracting-requests"] });

  const exportCsv = (which: "ready" | "submitted") => {
    const set = rows.filter((r) => (which === "ready" ? r.status === "ready_to_submit" : r.status === "submitted" || r.status === "approved"));
    if (!set.length) { toast.message(which === "ready" ? "Nothing is ready to submit yet." : "Nothing has been submitted yet."); return; }
    const blob = new Blob([toCsv(set)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `apex-contracting-${which}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`${set.length} row${set.length === 1 ? "" : "s"} exported with the 14 template columns.`);
  };

  const submit = async (r: RequestRow) => {
    setBusy(r.agent_id);
    try {
      const res = await submitContractingRequest(r.agent_id);
      if (!res.ok) { toast.error(res.error ?? "Not submitted."); return; }
      toast.success(`Submitted for ${r.display_name}. Queued for the sheet.`);
      refresh();
      const sync = await syncContractingSheet();
      if (sync.ok) toast.success(`Sheet updated (${sync.synced ?? 0} row${(sync.synced ?? 0) === 1 ? "" : "s"}).`);
      else toast.message(`Saved. Sheet sync is waiting: ${sync.blocker ?? sync.error ?? "see the sync banner"}.`);
      refresh();
    } finally { setBusy(null); }
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const res = await syncContractingSheet();
      if (res.ok) toast.success(`Sheet in sync: ${res.synced ?? 0} written, ${res.processed ?? 0} checked.`);
      else toast.error(`Sheet sync blocked: ${res.blocker ?? res.error ?? "unknown"}${res.service_email ? ` (share the sheet with ${res.service_email})` : ""}`);
      refresh();
    } finally { setBusy(null); }
  };

  const toggleDefaultAdvance = async () => {
    const next = q.data?.default_advance ? null : "6 month";
    const res = await setDefaultAdvance(next);
    if (!res.ok) { toast.error(res.error ?? "Not saved."); return; }
    toast.success(next ? "Default advance approved: 6 month applies to every request without its own." : "Default advance cleared: each request needs its own.");
    refresh();
  };

  const setStatus = async (r: RequestRow, status: "approved" | "declined" | "archived") => {
    if (!r.request_id) return;
    const res = await setContractingRequestStatus(r.request_id, status);
    if (!res.ok) { toast.error(res.error ?? "Not changed."); return; }
    toast.success(`${r.display_name}: ${STATUS_LABEL[status]}.`);
    refresh();
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading contracting requests…</p>;
  if (q.isError || !q.data) {
    return (
      <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
        The contracting requests did not load. <button type="button" className="font-semibold underline" onClick={refresh}>Retry</button>
      </p>
    );
  }
  const sheet = q.data.sheet;
  const sheetUrl = sheet.id ? `https://docs.google.com/spreadsheets/d/${sheet.id}/edit` : null;

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{q.data.agents} agents</span> · <span className="font-semibold">{q.data.requests}</span> open request{q.data.requests === 1 ? "" : "s"}
              {sheet.queued ? <> · <span className="text-amber-700 dark:text-amber-400">{sheet.queued} waiting for the sheet</span></> : null}
              {sheet.failed ? <> · <span className="text-destructive">{sheet.failed} failed to reach the sheet</span></> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              Destination: {sheetUrl ? <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="underline">apex new contracting</a> : "no sheet configured"} · last synced {when(sheet.last_synced_at)}.
              {" "}Every value is read from the agent's own entries and the agent record; nothing is guessed.
            </p>
            {sheet.last_error ? <p className="text-xs text-destructive" role="alert"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />{sheet.last_error}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              <Button type="button" variant={q.data.default_advance ? "secondary" : "outline"} size="sm" className="h-10" onClick={() => void toggleDefaultAdvance()} aria-pressed={!!q.data.default_advance}>
                {q.data.default_advance ? <><CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden /> Default advance: {q.data.default_advance}</> : "Approve default advance (6 month)"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => exportCsv("ready")}><Download className="mr-1.5 h-4 w-4" aria-hidden /> Export ready (CSV)</Button>
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => exportCsv("submitted")}><Download className="mr-1.5 h-4 w-4" aria-hidden /> Export submitted</Button>
            {isAdmin ? <Button type="button" variant="outline" size="sm" className="h-10" disabled={busy === "sync"} onClick={() => void syncNow()}><RefreshCw className={cn("mr-1.5 h-4 w-4", busy === "sync" && "animate-spin")} aria-hidden /> Sync sheet now</Button> : null}
          </div>
        </div>
      </GlassCard>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1" role="group" aria-label="Request view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}
              className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-sm font-medium", view === v.key ? "bg-primary/10 text-foreground ring-1 ring-primary/60" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
              {v.label} <span className="tabular-nums opacity-80">{counts[v.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, NPN, email or upline" aria-label="Search requests" className="h-11 pl-9" />
        </div>
        <select aria-label="Direct upline" value={upline} onChange={(e) => setUpline(e.target.value)} className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground">
          <option value="all">All uplines</option>
          {uplines.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              {["Agent", "NPN", "Direct upline", "Level", "Advance", "Status", "Missing", "Owner", "Next action", "Last sync"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground" role="status">Nobody matches this view.</td></tr>
            ) : visible.map((r) => (
              <tr key={r.agent_id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2"><button type="button" className="text-left font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setOpenId(r.agent_id)}>{r.display_name}</button></td>
                <td className="px-3 py-2 tabular-nums">{r.npn ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">{r.direct_upline ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 tabular-nums">{r.commission_level ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">{r.advance ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2"><span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", r.status === "ready_to_submit" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : r.status === "submitted" || r.status === "approved" ? "border-primary/50 text-foreground" : "border-amber-500/40 text-amber-700 dark:text-amber-300")}>{STATUS_LABEL[r.status]}</span></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.missing.length ? r.missing.map((m) => FIELD_LABEL[m] ?? m).join(", ") : "—"}</td>
                <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{r.owner === "none" ? "—" : r.owner}</td>
                <td className="px-3 py-2 text-xs text-foreground">{r.next_action}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.request_id ? `${r.sheet_status ?? "—"} · ${when(r.sheet_synced_at)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open ? (
            <div className="space-y-4">
              <SheetHeader><SheetTitle>{open.display_name}</SheetTitle></SheetHeader>
              <p className="text-sm text-foreground">
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", open.status === "ready_to_submit" ? "border-emerald-500/40" : "border-border")}>{STATUS_LABEL[open.status]}</span>
                <span className="ml-2 text-muted-foreground">{open.next_action}</span>
              </p>
              <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm">
                {CONTRACTING_HEADERS.map((h, i) => {
                  const v = toExportRow(open)[i].replace(/^'/, "");
                  const key = (["request_type", "first_name", "last_name", "npn", "email", "agency_name", "agency_tin", "agency_npn", "direct_upline", "commission_level", "advance", "dob", "residential_address", "phone"] as const)[i];
                  const src = (open as unknown as Record<string, unknown>)[`${key}_source`] as string | undefined;
                  return (
                    <div key={h} className="contents">
                      <dt className="text-muted-foreground">{h}</dt>
                      <dd className={cn("min-w-0 break-words", !v && "text-muted-foreground")}>{v || (key.startsWith("agency") ? "not applicable (no entity on file)" : "missing")}{src ? <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{src}</span> : null}</dd>
                    </div>
                  );
                })}
              </dl>
              {open.missing.length ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <p className="font-semibold text-foreground">Blocking</p>
                  <ul className="mt-1 list-disc pl-5 text-foreground">{open.missing.map((m) => <li key={m}>{FIELD_LABEL[m] ?? m}</li>)}</ul>
                  <p className="mt-1 text-xs text-muted-foreground">Owner: {open.owner}. {open.next_action}.</p>
                </div>
              ) : null}
              {open.request_id ? (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-semibold text-foreground">Request</p>
                  <p className="text-xs text-muted-foreground">Submitted {when(open.submitted_at)} · version {open.request_version ?? 1} · sheet {open.sheet_status ?? "—"}{open.sheet_row ? ` (row ${open.sheet_row})` : ""} · {when(open.sheet_synced_at)}</p>
                  {open.sheet_error ? <p className="mt-1 text-xs text-destructive">{open.sheet_error}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">The submitted snapshot is what the sheet holds; later profile edits make a new version, never a silent rewrite.</p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="h-10"><Link to={`/dashboard/team?view=contracting&review=${open.agent_id}`}>Open in review</Link></Button>
                {open.status === "ready_to_submit" ? <Button type="button" size="sm" className="h-10" disabled={busy === open.agent_id} onClick={() => void submit(open)}>Submit request</Button> : null}
                {isAdmin && open.request_id && open.status === "submitted" ? (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => void setStatus(open, "approved")}>Mark approved</Button>
                    <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => void setStatus(open, "declined")}>Mark declined</Button>
                  </>
                ) : null}
                {isAdmin && open.request_id && open.status === "approved" ? <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => void setStatus(open, "archived")}>Archive</Button> : null}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
