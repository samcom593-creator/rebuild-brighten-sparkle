import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCopy, Loader2, RefreshCw, Upload } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { EmailTypoHint } from "@/components/ui/email-typo-hint";
import { formatPhoneDisplay, maskUsPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  ADVANCE_TIER, ETHOS_LEVELS, MGN_DEFAULT, VERDICT_COPY, contractingDownlines, parseGrid, pctLabel,
  type Actor, type BoardRow, type DownlineRow, type Verdict,
} from "@/lib/contractingDownlines";

/**
 * /dashboard/contracting/downlines — MP-304. A manager's whole Ethos contracting lane on one page:
 *   1. their ONE link (Galaxy form → their MGN Agent Hub link),
 *   2. add a downline (verdict before write),
 *   3. upload downlines from a spreadsheet (every row gets a verdict; only ready rows are written; partial is
 *      reported as partial),
 *   4. the board: every downline, their level, where they stand with Ethos, with identity/comp edits that go to
 *      the Agent Updates tab.
 * The database decides everything that matters (scope, cap, default, duplicates); this page shows it.
 */

type Field = "first_name" | "last_name" | "email" | "phone" | "npn";
const EMPTY: Record<Field, string> = { first_name: "", last_name: "", email: "", phone: "", npn: "" };

function levelOptions(cap: number | null | undefined, defaultPct: number) {
  return ETHOS_LEVELS.filter((l) => cap == null || l.pct <= cap).map((l) => ({ ...l, label: `${l.pct}%${l.pct === defaultPct ? " (default)" : ""}` }));
}

function VerdictBadge({ v }: { v: Verdict | null | undefined }) {
  if (!v) return <span className="text-xs text-muted-foreground">Not checked</span>;
  const copy = VERDICT_COPY[v.verdict] ?? VERDICT_COPY.error;
  const tone = v.ok ? "ok" : copy.tone;
  return <Badge variant="outline" className={cn("text-xs", tone === "ok" && "border-emerald-500/50 text-emerald-500", tone === "warn" && "border-amber-500/50 text-amber-500", tone === "block" && "border-destructive/60 text-destructive")}>{v.ok ? (v.dry_run ? "Ready" : "Saved") : copy.label}</Badge>;
}

function ethosStateCopy(r: BoardRow): { label: string; tone: "ok" | "pending" | "warn" | "muted" } {
  if (r.on_sheet) return { label: `On the Ethos sheet${r.sheet_level ? ` · ${r.sheet_level}` : ""}`, tone: "ok" };
  switch (r.ethos_state) {
    case "delivered": return { label: "Sent to Ethos", tone: "ok" };
    case "queued": return { label: "Queued for Ethos", tone: "pending" };
    case "attempting": return { label: "Sending…", tone: "pending" };
    case "manual_review": return { label: "Held for review", tone: "warn" };
    case "not_configured": return { label: "Queued · sheet writes off", tone: "warn" };
    case "awaiting_license": return { label: "Waiting on licence", tone: "muted" };
    case "failed": return { label: "Retrying", tone: "warn" };
    case null: case undefined: return { label: r.npn ? "Not submitted" : "No NPN yet", tone: "muted" };
    default: return { label: r.ethos_state, tone: "muted" };
  }
}

export default function ContractingDownlines() {
  usePageTitle("Downlines & contracting · Galaxy");
  const qc = useQueryClient();
  const actorQ = useQuery({ queryKey: ["contracting-actor"], queryFn: async () => (await contractingDownlines.actor()).data as Actor | null, staleTime: 60_000 });
  const boardQ = useQuery({ queryKey: ["contracting-downlines"], queryFn: async () => (await contractingDownlines.downlines()).data?.rows ?? [], enabled: !!actorQ.data?.ok });
  const actor = actorQ.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";
  const joinUrl = actor?.join_path ? `${origin}${actor.join_path}` : null;
  const options = useMemo(() => levelOptions(actor?.cap_pct, actor?.default_pct ?? 60), [actor?.cap_pct, actor?.default_pct]);

  // ── 1. The one link ─────────────────────────────────────────────────────────────────────────
  const [mgn, setMgn] = useState<string | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const mgnValue = mgn ?? actor?.mgn_url ?? "";
  const saveLink = async () => {
    setSavingLink(true);
    try {
      const r = await contractingDownlines.setMgnLink(mgnValue.trim());
      if (r.data?.ok) { toast.success(mgnValue.trim() ? "MGN link saved. Your one link now lands there." : "MGN link cleared; recruits land on the MGN home page."); setMgn(null); void qc.invalidateQueries({ queryKey: ["contracting-actor"] }); }
      else toast.error(r.data?.error ?? r.error ?? "Not saved.");
    } finally { setSavingLink(false); }
  };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); } catch { toast.error("Could not copy. Select and copy it by hand."); } };

  // ── 2. Add one ──────────────────────────────────────────────────────────────────────────────
  const [one, setOne] = useState<Record<Field, string>>(EMPTY);
  const [oneComp, setOneComp] = useState<string>("");
  const [oneType, setOneType] = useState<"contracting" | "transfer">("contracting");
  const [oneLic, setOneLic] = useState(false);
  const [oneEo, setOneEo] = useState(false);
  const [oneReason, setOneReason] = useState("");
  const [oneConfirmDown, setOneConfirmDown] = useState(false);
  const [oneVerdict, setOneVerdict] = useState<Verdict | null>(null);
  const [oneBusy, setOneBusy] = useState<"check" | "submit" | null>(null);
  const oneRow = (): DownlineRow => ({ row_key: "one", ...one, phone: one.phone, npn: one.npn.replace(/\D/g, ""), comp_pct: oneComp ? Number(oneComp) : null, request_type: oneType, license_attested: oneLic, eo_attested: oneEo, reason: oneReason || undefined, confirm_downgrade: oneConfirmDown });
  const checkOne = async () => { setOneBusy("check"); try { const r = await contractingDownlines.verdict([oneRow()]); setOneVerdict(r.data?.results?.[0] ?? { ok: false, verdict: "error", message: r.error ?? "Could not check." }); } finally { setOneBusy(null); } };
  const submitOne = async () => {
    setOneBusy("submit");
    try {
      const r = await contractingDownlines.submit([oneRow()]);
      const v = r.data?.results?.[0] ?? { ok: false, verdict: "error" as const, message: r.error ?? "Not saved." };
      setOneVerdict(v);
      if (v.ok) { toast.success(`${one.first_name} ${one.last_name} saved at ${pctLabel(v.comp_pct)} · ${ADVANCE_TIER}${v.delivery === "queued" ? " · queued for Ethos" : ""}.`); setOne(EMPTY); setOneComp(""); setOneLic(false); setOneEo(false); setOneReason(""); setOneConfirmDown(false); void qc.invalidateQueries({ queryKey: ["contracting-downlines"] }); }
      else toast.error(v.message ?? VERDICT_COPY[v.verdict]?.label ?? "Not saved.");
    } finally { setOneBusy(null); }
  };

  // ── 3. Upload ──────────────────────────────────────────────────────────────────────────────
  const [paste, setPaste] = useState("");
  const [grid, setGrid] = useState<DownlineRow[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [gridVerdicts, setGridVerdicts] = useState<Record<string, Verdict>>({});
  const [gridBusy, setGridBusy] = useState<"check" | "submit" | null>(null);
  const [gridSummary, setGridSummary] = useState<{ written: number; held: number; total: number } | null>(null);
  const [bulkLic, setBulkLic] = useState(false);
  const parse = (text: string) => { const g = parseGrid(text); setGrid(g.rows); setIgnored(g.ignoredHeaders); setGridVerdicts({}); setGridSummary(null); if (!g.rows.length) toast.error("No rows found. Paste the header row and the agent rows."); };
  const onFile = async (f: File | undefined) => { if (!f) return; parse(await f.text()); };
  const rowFor = (r: DownlineRow): DownlineRow => ({ ...r, npn: r.npn.replace(/\D/g, ""), license_attested: bulkLic || r.license_attested, eo_attested: r.eo_attested ?? false });
  const setRow = (key: string, patch: Partial<DownlineRow>) => setGrid((g) => g.map((r) => (r.row_key === key ? { ...r, ...patch } : r)));
  const checkGrid = async () => {
    if (!grid.length) return;
    setGridBusy("check");
    try { const r = await contractingDownlines.verdict(grid.map(rowFor)); const map: Record<string, Verdict> = {}; for (const v of r.data?.results ?? []) map[String(v.row_key)] = v; setGridVerdicts(map); if (!r.data?.ok) toast.error(r.error ?? "Could not check."); }
    finally { setGridBusy(null); }
  };
  const readyKeys = useMemo(() => grid.filter((r) => gridVerdicts[String(r.row_key)]?.ok && gridVerdicts[String(r.row_key)]?.dry_run).map((r) => String(r.row_key)), [grid, gridVerdicts]);
  const submitGrid = async () => {
    if (!readyKeys.length) return;
    setGridBusy("submit");
    try {
      const rows = grid.filter((r) => readyKeys.includes(String(r.row_key))).map(rowFor);
      const r = await contractingDownlines.submit(rows);
      const map = { ...gridVerdicts }; for (const v of r.data?.results ?? []) map[String(v.row_key)] = v; setGridVerdicts(map);
      const written = r.data?.written ?? 0, held = r.data?.held ?? 0;
      setGridSummary({ written, held, total: rows.length });
      if (written && !held) toast.success(`${written} of ${rows.length} written and queued for Ethos.`);
      else if (written) toast.warning(`${written} written, ${held} held. Fix the held rows and submit again.`);
      else toast.error(r.error ?? "Nothing was written.");
      void qc.invalidateQueries({ queryKey: ["contracting-downlines"] });
    } finally { setGridBusy(null); }
  };

  // ── 4. Board + edit ────────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [edit, setEdit] = useState<Record<Field, string> & { comp_pct: string; reason: string }>({ ...EMPTY, comp_pct: "", reason: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [editProblem, setEditProblem] = useState<{ field: string; text: string; suggestion?: string } | null>(null);
  const openEdit = (r: BoardRow) => { setEditing(r); setEditProblem(null); setEdit({ first_name: r.first_name ?? "", last_name: r.last_name ?? "", email: r.email ?? "", phone: r.phone ? maskUsPhoneInput(formatPhoneDisplay(r.phone)) : "", npn: r.npn ?? "", comp_pct: r.comp_pct != null ? String(r.comp_pct) : "", reason: "" }); };
  const saveEdit = async () => {
    if (!editing?.agent_id) return;
    setEditBusy(true);
    try {
      const payload: Record<string, unknown> = { agent_id: editing.agent_id };
      if (edit.first_name !== (editing.first_name ?? "")) payload.first_name = edit.first_name;
      if (edit.last_name !== (editing.last_name ?? "")) payload.last_name = edit.last_name;
      if (edit.email.trim().toLowerCase() !== (editing.email ?? "")) payload.email = edit.email.trim();
      if (edit.phone.replace(/\D/g, "") !== (editing.phone ?? "").replace(/\D/g, "").replace(/^1/, "")) payload.phone = edit.phone;
      if (edit.npn.replace(/\D/g, "") !== (editing.npn ?? "")) payload.npn = edit.npn;
      if (edit.comp_pct && Number(edit.comp_pct) !== editing.comp_pct) payload.comp_pct = Number(edit.comp_pct);
      if (edit.reason.trim()) payload.reason = edit.reason.trim();
      const r = await contractingDownlines.update(payload);
      if (r.data?.ok) { toast.success(r.data.queued ? `Saved. Update queued for MGN's "Update Agent" tab (${(r.data.changes ?? []).join(", ")}).` : r.data.message ?? "Saved on the roster."); setEditing(null); void qc.invalidateQueries({ queryKey: ["contracting-downlines"] }); }
      else setEditProblem({ field: r.data?.field ?? "form", text: r.data?.message ?? r.error ?? "Not saved.", suggestion: r.data?.suggestion });
    } finally { setEditBusy(false); }
  };
  const refreshSheet = async () => { const r = await contractingDownlines.refreshSheet(); if (r.data?.ok) { toast.success(r.data.refreshed ? "Re-read the Ethos sheet." : r.data.note ?? "Mirror is fresh."); void qc.invalidateQueries({ queryKey: ["contracting-downlines"] }); } else toast.error(r.error ?? "Could not refresh."); };

  if (actorQ.isLoading) return <div className="page-enter mx-auto max-w-5xl px-4 pt-6 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden /> Loading…</div>;
  if (actorQ.isError || !actor) return <div className="page-enter mx-auto max-w-5xl px-4 pt-6" role="alert"><p className="text-sm font-semibold">This page did not load.</p><Button size="sm" variant="outline" className="mt-2 h-10" onClick={() => void actorQ.refetch()}>Try again</Button></div>;
  if (!actor.ok || !actor.is_manager) return <div className="page-enter mx-auto max-w-5xl px-4 pt-6"><GlassCard className="p-4"><p className="text-sm">{actor.error ?? "Managers and admins only."}</p></GlassCard></div>;

  const board = boardQ.data ?? [];

  return (
    <div className="page-enter mx-auto w-full max-w-5xl space-y-6 px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Downlines &amp; contracting</h1>
        <p className="text-sm text-muted-foreground">Ethos only. Everyone is {ADVANCE_TIER}; the default comp is {actor.default_pct}%{actor.cap_pct != null ? `, and you can set up to ${actor.cap_pct}% — your own level` : ""}. Written to MGN&apos;s sheet under <span className="font-medium text-foreground">{actor.sub_agency_label}</span>.</p>
        {!actor.writes_enabled ? <p className="text-xs text-amber-500">Automatic sheet writes are currently off: everything you submit is saved and queued, and goes onto the Ethos sheet the moment writes are switched on.</p> : null}
      </header>

      {/* 1 · the one link */}
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Your one link</h2>
        <p className="text-sm text-muted-foreground">Send this. The recruit fills in their licence details on Galaxy, then lands on your MGN Agent Hub link to finish carrier contracting.</p>
        {joinUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input readOnly value={joinUrl} className="h-11 font-mono text-xs" aria-label="Your contracting link" />
            <Button type="button" variant="outline" className="h-11" onClick={() => void copy(joinUrl, "Your link")}><ClipboardCopy className="mr-1 h-4 w-4" aria-hidden /> Copy</Button>
          </div>
        ) : <p className="text-sm text-destructive">Your agent record has no link slug yet. Ask an admin.</p>}
        <div className="space-y-1">
          <Label htmlFor="mgn-url">Your MGN Agent Hub referral link</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="mgn-url" placeholder={MGN_DEFAULT} value={mgnValue} onChange={(e) => setMgn(e.target.value)} className="h-11 font-mono text-xs" />
            <Button type="button" className="h-11" disabled={savingLink || mgn === null} onClick={() => void saveLink()}>{savingLink ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Paste the referral link MGN gives you (it must start with https://mgnagenthub.com/). Blank = MGN's home page.</p>
        </div>
      </GlassCard>

      {/* 2 · add one */}
      <GlassCard className="space-y-4 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Add a downline</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="o-first">Legal first name</Label><Input id="o-first" className="h-11" value={one.first_name} onChange={(e) => setOne((s) => ({ ...s, first_name: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="o-last">Legal last name</Label><Input id="o-last" className="h-11" value={one.last_name} onChange={(e) => setOne((s) => ({ ...s, last_name: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="o-email">Email</Label><Input id="o-email" type="email" className="h-11" value={one.email} onChange={(e) => setOne((s) => ({ ...s, email: e.target.value }))} /><EmailTypoHint value={one.email} onAccept={(n) => setOne((s) => ({ ...s, email: n }))} /></div>
          <div className="space-y-1"><Label htmlFor="o-phone">Mobile</Label><Input id="o-phone" type="tel" className="h-11" value={one.phone} onChange={(e) => setOne((s) => ({ ...s, phone: maskUsPhoneInput(e.target.value) }))} /></div>
          <div className="space-y-1"><Label htmlFor="o-npn">NPN</Label><Input id="o-npn" inputMode="numeric" className="h-11" value={one.npn} onChange={(e) => setOne((s) => ({ ...s, npn: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))} /></div>
          <div className="space-y-1"><Label htmlFor="o-type">Request</Label>
            <select id="o-type" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={oneType} onChange={(e) => setOneType(e.target.value as "contracting" | "transfer")}><option value="contracting">New contracting</option><option value="transfer">Transfer (already appointed elsewhere)</option></select></div>
          <div className="space-y-1"><Label htmlFor="o-comp">Comp</Label>
            <select id="o-comp" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={oneComp} onChange={(e) => setOneComp(e.target.value)}><option value="">Default · {actor.default_pct}%</option>{options.map((o) => <option key={o.pct} value={o.pct}>{o.label}</option>)}</select></div>
          <div className="space-y-1"><Label>Advance</Label><Input readOnly value={ADVANCE_TIER} className="h-11" aria-label="Advance pay tier" /></div>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={oneLic} onChange={(e) => setOneLic(e.target.checked)} /><span>I confirm this person holds a current life licence and the NPN is theirs. <span className="text-muted-foreground">(Ethos contracts licensed agents only.)</span></span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={oneEo} onChange={(e) => setOneEo(e.target.checked)} /><span>They have $1M E&amp;O coverage. <span className="text-muted-foreground">(Leave unticked if unsure — the sheet will say FALSE.)</span></span></label>
        {oneVerdict && !oneVerdict.ok ? (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p><VerdictBadge v={oneVerdict} /> <span className="ml-2">{oneVerdict.message}</span>{oneVerdict.suggestion ? <> Did you mean <button type="button" className="underline" onClick={() => setOne((s) => ({ ...s, email: oneVerdict.suggestion as string }))}>{oneVerdict.suggestion}</button>?</> : null}</p>
            {oneVerdict.matches?.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{oneVerdict.matches.map((m, i) => <li key={`${m.npn}-${i}`}>{m.display} · NPN {m.npn}</li>)}</ul> : null}
            {oneVerdict.verdict === "would_downgrade_comp" ? (
              <div className="space-y-2">
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={oneConfirmDown} onChange={(e) => setOneConfirmDown(e.target.checked)} /><span>Yes, lower {oneVerdict.existing_name ?? "them"} from {oneVerdict.current_pct}% to {oneVerdict.proposed_pct}%.</span></label>
                <Input placeholder="Reason (required to lower a level)" className="h-11" value={oneReason} onChange={(e) => setOneReason(e.target.value)} />
              </div>
            ) : null}
          </div>
        ) : oneVerdict?.ok && oneVerdict.dry_run ? (
          <p className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" aria-hidden /> Ready: {pctLabel(oneVerdict.comp_pct)} · {oneVerdict.advance} · under {oneVerdict.sub_agency}{oneVerdict.existing_name ? ` · updates ${oneVerdict.existing_name}'s existing record` : ""}.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={oneBusy !== null} onClick={() => void checkOne()}>{oneBusy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Check"}</Button>
          <Button type="button" className="h-11" disabled={oneBusy !== null || !oneLic} onClick={() => void submitOne()}>{oneBusy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Submit to Ethos"}</Button>
        </div>
      </GlassCard>

      {/* 3 · upload */}
      <GlassCard className="space-y-4 p-4 sm:p-5">
        <h2 className="text-base font-semibold">Upload downlines from a spreadsheet</h2>
        <p className="text-sm text-muted-foreground">Copy the rows out of your sheet (with the header row) and paste, or choose a CSV. Columns are matched by name: first, last, email, mobile, NPN, comp (a % or "Level 14"), request type. Blank comp = the default. SSN is never read.</p>
        <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"First\tLast\tEmail\tMobile\tNPN\tComp\nAda\tLovelace\tada@example.com\t(555) 010-0001\t21000002\t60"} className="min-h-28 font-mono text-xs" aria-label="Paste rows" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => parse(paste)}><Upload className="mr-1 h-4 w-4" aria-hidden /> Read rows</Button>
          <label className="inline-flex h-11 cursor-pointer items-center rounded-md border border-input px-3 text-sm">Choose CSV<input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={bulkLic} onChange={(e) => setBulkLic(e.target.checked)} /> I confirm every row below holds a current life licence</label>
        </div>
        {ignored.length ? <p className="text-xs text-muted-foreground">Ignored columns (not read): {ignored.join(", ")}.</p> : null}
        {grid.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left"><tr><th className="p-2">Name</th><th className="p-2">NPN</th><th className="p-2">Email</th><th className="p-2">Mobile</th><th className="p-2">Comp</th><th className="p-2">Verdict</th></tr></thead>
              <tbody>
                {grid.map((r) => { const key = String(r.row_key); const v = gridVerdicts[key]; return (
                  <tr key={key} className="border-t border-border align-top">
                    <td className="p-2 whitespace-nowrap">{r.first_name} {r.last_name}{r.request_type === "transfer" ? <span className="ml-1 text-muted-foreground">(transfer)</span> : null}</td>
                    <td className="p-2 font-mono">{r.npn}</td>
                    <td className="p-2">{r.email}</td>
                    <td className="p-2 whitespace-nowrap">{r.phone}</td>
                    <td className="p-2"><select className="h-9 rounded-md border border-input bg-background px-2" value={r.comp_pct ?? ""} onChange={(e) => setRow(key, { comp_pct: e.target.value ? Number(e.target.value) : null })}><option value="">Default</option>{options.map((o) => <option key={o.pct} value={o.pct}>{o.pct}%</option>)}</select></td>
                    <td className="p-2 min-w-56">
                      <VerdictBadge v={v} />
                      {v && !v.ok ? <p className="mt-1 text-muted-foreground">{v.message}{v.suggestion ? <> · <button type="button" className="underline" onClick={() => setRow(key, { email: v.suggestion as string })}>use {v.suggestion}</button></> : null}</p> : null}
                      {v?.verdict === "would_downgrade_comp" ? (<div className="mt-1 space-y-1"><label className="flex items-center gap-1"><input type="checkbox" className="h-3.5 w-3.5" checked={!!r.confirm_downgrade} onChange={(e) => setRow(key, { confirm_downgrade: e.target.checked })} /> lower {v.current_pct}% → {v.proposed_pct}%</label><Input placeholder="Reason" className="h-8 text-xs" value={r.reason ?? ""} onChange={(e) => setRow(key, { reason: e.target.value })} /></div>) : null}
                      {v?.ok && v.dry_run ? <p className="mt-1 text-muted-foreground">{pctLabel(v.comp_pct)} · {v.sub_agency}{v.existing_name ? ` · updates ${v.existing_name}` : ""}</p> : null}
                      {v?.ok && !v.dry_run ? <p className="mt-1 text-emerald-500">Saved · {pctLabel(v.comp_pct)}{v.delivery === "queued" ? " · queued for Ethos" : v.delivery === "manual_review" ? " · held for review" : ""}{v.provisioned === false ? " · login not created (see admin)" : ""}</p> : null}
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        ) : null}
        {grid.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={gridBusy !== null} onClick={() => void checkGrid()}>{gridBusy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : `Check ${grid.length} row${grid.length === 1 ? "" : "s"}`}</Button>
            <Button type="button" className="h-11" disabled={gridBusy !== null || !readyKeys.length || !bulkLic} onClick={() => void submitGrid()}>{gridBusy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : `Submit ${readyKeys.length} ready`}</Button>
            {gridSummary ? <span className="text-sm text-muted-foreground">{gridSummary.written} written · {gridSummary.held} held · of {gridSummary.total}</span> : null}
          </div>
        ) : null}
      </GlassCard>

      {/* 4 · board */}
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Your downlines ({board.length})</h2>
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => void refreshSheet()}><RefreshCw className="mr-1 h-4 w-4" aria-hidden /> Re-read Ethos sheet</Button>
        </div>
        {boardQ.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading…</p> : boardQ.isError ? <p className="text-sm text-destructive" role="alert">The board did not load. <button type="button" className="underline" onClick={() => void boardQ.refetch()}>Try again</button></p> : !board.length ? <p className="text-sm text-muted-foreground">No downlines yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left"><tr><th className="p-2">Name</th><th className="p-2">NPN</th><th className="p-2">Comp</th><th className="p-2">Ethos</th><th className="p-2">Last update</th><th className="p-2"></th></tr></thead>
              <tbody>
                {board.map((r) => { const st = ethosStateCopy(r); return (
                  <tr key={r.agent_id ?? r.intake_id ?? r.display_name} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{r.display_name}{r.agent_status === "intake_only" ? <span className="ml-1 text-amber-500">(no login yet)</span> : null}<div className="text-muted-foreground">{r.email}</div></td>
                    <td className="p-2 font-mono">{r.npn ?? <span className="text-amber-500">missing</span>}</td>
                    <td className="p-2 whitespace-nowrap">{r.comp_pct != null ? `${r.comp_pct}%` : <span className="text-muted-foreground">not set</span>}</td>
                    <td className="p-2"><span className={cn(st.tone === "ok" && "text-emerald-500", st.tone === "warn" && "text-amber-500", st.tone === "muted" && "text-muted-foreground")}>{st.label}</span>{r.ethos_note && st.tone === "warn" ? <div className="text-muted-foreground">{r.ethos_note}</div> : null}</td>
                    <td className="p-2 whitespace-nowrap text-muted-foreground">{r.last_update_status ? `${r.last_update_status}` : "—"}</td>
                    <td className="p-2">{r.agent_id ? <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => openEdit(r)}>Edit</Button> : null}</td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
        {editing ? (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4" role="dialog" aria-label={`Update ${editing.display_name}`}>
            <h3 className="text-sm font-semibold">Update {editing.display_name}</h3>
            <p className="text-xs text-muted-foreground">Identity changes and comp changes go to Ethos' "Agent Updates" tab. A comp change needs a reason. The login email is not changed here.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="e-first">Legal first name</Label><Input id="e-first" className="h-11" value={edit.first_name} onChange={(e) => setEdit((s) => ({ ...s, first_name: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="e-last">Legal last name</Label><Input id="e-last" className="h-11" value={edit.last_name} onChange={(e) => setEdit((s) => ({ ...s, last_name: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="e-email">Email</Label><Input id="e-email" type="email" className="h-11" value={edit.email} onChange={(e) => setEdit((s) => ({ ...s, email: e.target.value }))} /><EmailTypoHint value={edit.email} onAccept={(n) => setEdit((s) => ({ ...s, email: n }))} /></div>
              <div className="space-y-1"><Label htmlFor="e-phone">Mobile</Label><Input id="e-phone" type="tel" className="h-11" value={edit.phone} onChange={(e) => setEdit((s) => ({ ...s, phone: maskUsPhoneInput(e.target.value) }))} /></div>
              <div className="space-y-1"><Label htmlFor="e-npn">NPN</Label><Input id="e-npn" inputMode="numeric" className="h-11" value={edit.npn} onChange={(e) => setEdit((s) => ({ ...s, npn: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))} /></div>
              <div className="space-y-1"><Label htmlFor="e-comp">Comp</Label><select id="e-comp" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={edit.comp_pct} onChange={(e) => setEdit((s) => ({ ...s, comp_pct: e.target.value }))}><option value="">Keep {editing.comp_pct != null ? `${editing.comp_pct}%` : "(not set)"}</option>{options.map((o) => <option key={o.pct} value={o.pct}>{o.label}</option>)}</select></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="e-reason">Reason</Label><Input id="e-reason" className="h-11" placeholder="Required for a comp change" value={edit.reason} onChange={(e) => setEdit((s) => ({ ...s, reason: e.target.value }))} /></div>
            </div>
            {editProblem ? <p role="alert" className="text-sm text-destructive">{editProblem.text}{editProblem.suggestion ? <> Did you mean <button type="button" className="underline" onClick={() => setEdit((s) => ({ ...s, email: editProblem.suggestion as string }))}>{editProblem.suggestion}</button>?</> : null}</p> : null}
            <div className="flex gap-2"><Button type="button" className="h-11" disabled={editBusy} onClick={() => void saveEdit()}>{editBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save & send update"}</Button><Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(null)}>Cancel</Button></div>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
