import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
  Layers, Send, Download, Archive, DollarSign, AlertTriangle, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// CSV-injection-safe cell: quote commas/quotes/newlines, and neutralise a
// leading =,+,-,@ so a spreadsheet renders it as text instead of a formula.
function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const deFanged = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(deFanged) ? `"${deFanged.replace(/"/g, '""')}"` : deFanged;
}

/**
 * Lead Manager — Sam/Aisha console for the owned aged-lead resale pool
 * (public.client_leads). Set a filter, type a live agent's name, drop the pack
 * straight into their portal. No "create bundle" step. Everything is gated
 * server-side by can_view_sold_calls(); the resale ledger stops a lead going
 * out twice, and DNC numbers are excluded by default.
 *
 * Leads here are aged marketing PROSPECTS, not policyholders — so they carry no
 * chargeback; the "under 9 months" tag and the chargeback-first sort order on
 * the lead_date age, the window where a resold prospect is freshest.
 */

// The generated Functions union is near TypeScript's instantiation-depth limit
// and the committed types.ts is drifted (missing these admin RPCs), so they are
// called through a shallow cast — the repo's standard rpc pattern.
type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = supabase.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

const GRADES = ["A", "B", "C", "D"] as const;
const GRADE_HINT: Record<string, string> = {
  A: "A list", B: "B list", C: "C list", D: "Ungraded / remaining",
};
const ATTRS = [
  { key: "wants_mortgage", label: "Mortgage" },
  { key: "is_veteran", label: "Veteran" },
  { key: "is_homeowner", label: "Homeowner" },
  { key: "policyholders_only", label: "Has a policy" },
] as const;

type PoolCounts = {
  total: number;
  by_grade: Record<string, number>;
  under_9mo: number;
  sample: Array<{
    first_name: string | null; last_name: string | null; phone_masked: string;
    state: string | null; age: number | null; grade: string;
    wants_mortgage: boolean; is_veteran: boolean; is_policyholder: boolean;
    lead_age_days: number; under_9mo: boolean;
  }>;
};

type AssignableAgent = { user_id: string; agent_id: string; display_name: string; subagency: string | null };

type RecentBundle = {
  bundle_id: string; name: string; note: string | null; created_at: string; archived_at: string | null;
  live_items: number; sold: number; under_9mo: number; resold: boolean;
  holders: Array<{ user_id: string; name: string | null; granted_at: string }>;
};

type ExportRow = {
  first_name: string | null; last_name: string | null; phone10: string | null; email: string | null;
  state: string | null; age: number | null; grade: string | null; tags: string | null; status: string | null;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
  const blob = new Blob([`${body}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LeadManager() {
  const queryClient = useQueryClient();

  // ---- filter state ----
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [attrs, setAttrs] = useState<Set<string>>(new Set());
  const [states, setStates] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [maxLeadAge, setMaxLeadAge] = useState("");
  const [excludeDnc, setExcludeDnc] = useState(true);
  const [excludeResold, setExcludeResold] = useState(true);
  const [sort, setSort] = useState("grade");
  const [limit, setLimit] = useState(100);
  const [note, setNote] = useState("");

  // ---- agent picker ----
  const [agentSearch, setAgentSearch] = useState("");
  const [agent, setAgent] = useState<AssignableAgent | null>(null);
  const debouncedAgentSearch = useDebounced(agentSearch, 250);

  const filters = useMemo(() => {
    const f: Record<string, unknown> = { exclude_dnc: excludeDnc, exclude_resold: excludeResold, sort };
    if (grades.size) f.grades = Array.from(grades);
    for (const a of attrs) f[a] = true;
    const st = states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (st.length) f.states = st;
    if (minAge) f.min_age = Number(minAge);
    if (maxAge) f.max_age = Number(maxAge);
    if (maxLeadAge) f.max_lead_age_days = Number(maxLeadAge);
    return f;
  }, [grades, attrs, states, minAge, maxAge, maxLeadAge, excludeDnc, excludeResold, sort]);

  const debouncedFilters = useDebounced(filters, 400);

  const { data: pool, isFetching } = useQuery<PoolCounts>({
    queryKey: ["lead-pool", debouncedFilters],
    queryFn: async () => {
      const { data, error } = await rpc("lead_resale_pool_counts", { p_filters: debouncedFilters });
      if (error) throw error;
      return (data as PoolCounts) ?? { total: 0, by_grade: {}, under_9mo: 0, sample: [] };
    },
    staleTime: 15_000,
  });

  const { data: agents = [] } = useQuery<AssignableAgent[]>({
    queryKey: ["assignable-agents", debouncedAgentSearch],
    queryFn: async () => {
      const { data, error } = await rpc("lead_assignable_agents", { p_search: debouncedAgentSearch || null });
      if (error) throw error;
      return (data as AssignableAgent[]) ?? [];
    },
    staleTime: 60_000,
  });

  const { data: recent = [] } = useQuery<RecentBundle[]>({
    queryKey: ["lead-bundles-recent"],
    queryFn: async () => {
      const { data, error } = await rpc("lead_bundle_recent", { p_limit: 50 });
      if (error) throw error;
      return (data as RecentBundle[]) ?? [];
    },
    staleTime: 15_000,
  });

  const dropCount = Math.min(limit, pool?.total ?? 0);

  const assign = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error("Pick a live agent first.");
      const { data, error } = await rpc("lead_bundle_assign", {
        p_filters: filters,
        p_limit: limit,
        p_agent_user_id: agent.user_id,
        p_name: null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as { items: number; agent: string };
    },
    onSuccess: (res) => {
      toast.success(`${res.items} lead${res.items === 1 ? "" : "s"} dropped into ${res.agent}'s portal`);
      setAgent(null);
      setAgentSearch("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
      queryClient.invalidateQueries({ queryKey: ["lead-pool"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not assign"),
  });

  const archive = useMutation({
    mutationFn: async (bundleId: string) => {
      const { error } = await rpc("lead_bundle_archive", { p_bundle: bundleId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Archived");
      queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not archive"),
  });

  async function exportPack(b: RecentBundle) {
    const { data, error } = await rpc("lead_bundle_export", { p_bundle: b.bundle_id });
    if (error) {
      toast.error("Could not export pack");
      return;
    }
    const rows = ((data as ExportRow[]) ?? []).map((r) => [
      r.first_name, r.last_name, r.phone10, r.email, r.state, r.age, r.grade, r.tags, r.status,
    ]);
    downloadCsv(
      `${b.name.replace(/[^\w.-]+/g, "_")}.csv`,
      ["First", "Last", "Phone", "Email", "State", "Age", "Grade", "Tags", "Status"],
      rows,
    );
    toast.success(`Exported ${rows.length} leads`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrowIcon={<Layers className="h-5 w-5" />}
        title="Lead Manager"
        subtitle="Filter the owned lead pool, pick a live agent, drop the pack straight into their portal."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1 · Filter the pool</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Grade</Label>
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => {
                const on = grades.has(g);
                return (
                  <Button
                    key={g}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() =>
                      setGrades((prev) => {
                        const next = new Set(prev);
                        if (next.has(g)) next.delete(g); else next.add(g);
                        return next;
                      })
                    }
                    title={GRADE_HINT[g]}
                  >
                    {g}
                    {pool?.by_grade?.[g] != null && (
                      <span className="ml-1.5 text-xs opacity-70">{pool.by_grade[g]}</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Attributes</Label>
            <div className="flex flex-wrap gap-2">
              {ATTRS.map((a) => {
                const on = attrs.has(a.key);
                return (
                  <Button
                    key={a.key}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() =>
                      setAttrs((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.key)) next.delete(a.key); else next.add(a.key);
                        return next;
                      })
                    }
                  >
                    {a.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">States (e.g. TX, FL)</Label>
              <Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="All states" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Min age</Label>
              <Input type="number" inputMode="numeric" value={minAge} onChange={(e) => setMinAge(e.target.value)} placeholder="—" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max age</Label>
              <Input type="number" inputMode="numeric" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="—" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger aria-label="Sort order"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grade">Best grade first</SelectItem>
                  <SelectItem value="chargeback">Chargeback window first (under 9mo)</SelectItem>
                  <SelectItem value="oldest">Oldest leads first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={excludeDnc} onCheckedChange={(v) => setExcludeDnc(Boolean(v))} />
              Exclude Do-Not-Call
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={excludeResold} onCheckedChange={(v) => setExcludeResold(Boolean(v))} />
              Exclude already-sold
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Max in pack</span>
              <Input
                type="number"
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
                className="h-9 w-24"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="text-2xl font-bold tabular-nums">
              {isFetching ? "…" : (pool?.total ?? 0).toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground">leads match</div>
            {(pool?.under_9mo ?? 0) > 0 && (
              <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-300">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {pool?.under_9mo?.toLocaleString()} under 9mo
              </Badge>
            )}
          </div>

          {(pool?.sample?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">State</th>
                    <th className="px-3 py-2 text-left">Age</th>
                    <th className="px-3 py-2 text-left">Grade</th>
                    <th className="px-3 py-2 text-left">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {(pool?.sample ?? []).slice(0, 12).map((s, i) => (
                    <tr key={`${s.phone_masked}-${i}`} className="border-t border-border/40">
                      <td className="px-3 py-1.5">{[s.first_name, s.last_name].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{s.phone_masked}</td>
                      <td className="px-3 py-1.5">{s.state ?? "—"}</td>
                      <td className="px-3 py-1.5">{s.age ?? "—"}</td>
                      <td className="px-3 py-1.5">{s.grade}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {[
                          s.wants_mortgage && "mortgage",
                          s.is_veteran && "veteran",
                          s.is_policyholder && "policyholder",
                          s.under_9mo && "under-9mo",
                        ].filter(Boolean).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-xs text-muted-foreground">Preview of the first matches. Phones are masked until dropped.</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2 · Drop into an agent's portal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {agent ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 bg-emerald-500/15 border-emerald-500/40 text-emerald-300 py-1.5 px-3">
                <UserRound className="h-3.5 w-3.5" />
                {agent.display_name}
                {agent.subagency && <span className="opacity-70">· {agent.subagency}</span>}
              </Badge>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAgent(null)}>
                <X className="h-4 w-4" /> Change
              </Button>
            </div>
          ) : (
            <div className="relative max-w-md">
              <Input
                placeholder="Type a live agent's name…"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
              {agentSearch.trim().length > 0 && agents.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                  {agents.map((a) => (
                    <button
                      key={a.user_id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => { setAgent(a); setAgentSearch(""); }}
                    >
                      <span>{a.display_name}</span>
                      {a.subagency && <span className="text-xs text-muted-foreground">{a.subagency}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Input
            placeholder="Optional note (shown with the pack)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="max-w-md"
          />

          <Button
            type="button"
            data-primary-action
            disabled={!agent || dropCount < 1 || assign.isPending}
            onClick={() => assign.mutate()}
          >
            <Send className="mr-1.5 h-4 w-4" />
            {assign.isPending
              ? "Dropping…"
              : agent
                ? `Drop ${dropCount.toLocaleString()} into ${agent.display_name}'s portal`
                : "Pick an agent to drop into"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Recent drops</h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nothing dropped yet. Build a pack above and it shows up here.
            </CardContent>
          </Card>
        ) : (
          recent.map((b) => (
            <Card key={b.bundle_id} className={cn(b.archived_at && "opacity-60")}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="font-medium">{b.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{b.live_items} live</span>
                    {b.sold > 0 && <span className="text-green-400">{b.sold} sold</span>}
                    {b.under_9mo > 0 && (
                      <span className="text-amber-400">{b.under_9mo} under-9mo</span>
                    )}
                    <span>·</span>
                    <span>{b.holders.map((h) => h.name).filter(Boolean).join(", ") || "unassigned"}</span>
                    <span>·</span>
                    <span>{new Date(b.created_at).toLocaleDateString()}</span>
                    {b.resold && <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300">sold</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => exportPack(b)}>
                    <Download className="mr-1 h-4 w-4" /> Pack
                  </Button>
                  <MarkSoldDialog bundle={b} onDone={() => {
                    queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
                    queryClient.invalidateQueries({ queryKey: ["lead-pool"] });
                  }} />
                  {!b.archived_at && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => archive.mutate(b.bundle_id)}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function MarkSoldDialog({ bundle, onDone }: { bundle: RecentBundle; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [buyer, setBuyer] = useState("");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const { data, error } = await rpc("lead_bundle_mark_sold", {
        p_bundle: bundle.bundle_id,
        p_sold_to: buyer.trim() || null,
        p_price_cents: price ? Math.round(Number(price) * 100) : null,
        p_note: null,
      });
      if (error) throw error;
      const res = data as { newly_ledgered: number };
      toast.success(`Marked sold — ${res.newly_ledgered} leads locked from resale`);
      setOpen(false);
      setBuyer("");
      setPrice("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark sold");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <DollarSign className="mr-1 h-4 w-4" /> Sold
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark "{bundle.name}" sold</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Every lead in this pack gets locked in the resale ledger so it can never go out again.
          </p>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sold to (optional)</Label>
            <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Buyer name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Price (optional)</Label>
            <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" data-primary-action disabled={pending} onClick={submit}>
            {pending ? "Saving…" : "Lock as sold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
