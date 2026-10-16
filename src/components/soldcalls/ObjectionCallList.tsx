// ObjectionCallList — the calls a client nearly bought on: ReadyMode dispositions Bank Objection,
// No Bank Account and Social Objection (v_objection_calls). Each card has Call/Text, when the call
// happened, the agent, what the transcript says (as the recordings are transcribed), and the same
// contacted / resold / push / pushback buttons as a sold call. A client whose phone later bought
// shows "Bought later" so nobody calls a closed client as a lost one.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Phone, RefreshCw, Search } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { ResellSignals, WorkActions } from "@/components/soldcalls/ResellWork";
import { callStamp, isResellLead, type ResellFields } from "@/lib/resellSignals";

export interface ObjectionRow extends ResellFields {
  call_id: string;
  call_at: string | null;
  agent_raw: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  disposition: string;
  duration_seconds: number | null;
  rec_seconds: number | null;
  has_transcript: boolean | null;
  download_status: string | null;
  sold_later: boolean | null;
}

type ObjFilter = "bank" | "social" | "leads" | "contacted" | "pushback" | "all";
const FILTERS: Array<{ key: ObjFilter; label: string; match: (r: ObjectionRow) => boolean }> = [
  { key: "bank", label: "Bank objection", match: (r) => !r.sold_later && (r.disposition === "Bank Objection" || r.disposition === "No Bank Account") },
  { key: "social", label: "Social objection", match: (r) => !r.sold_later && r.disposition === "Social Objection" },
  { key: "leads", label: "Price / bank / spouse / mortgage", match: (r) => !r.sold_later && isResellLead(r) },
  { key: "contacted", label: "Contacted", match: (r) => r.work_status === "contacted" },
  { key: "pushback", label: "Pushback", match: (r) => r.work_status === "pushback" },
  { key: "all", label: "All", match: () => true },
];

const mmss = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const nameOf = (r: ObjectionRow) => [r.lead_first_name, r.lead_last_name].filter(Boolean).join(" ") || "Name not on file";

// PostgREST returns at most 1,000 rows per request; page until a short page.
async function fetchObjections(): Promise<ObjectionRow[]> {
  const out: ObjectionRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const page = looseSupabase
      .from("v_objection_calls")
      .select("*")
      .order("call_at", { ascending: false }) as unknown as {
        range: (a: number, b: number) => Promise<{ data: ObjectionRow[] | null; error: { message: string } | null }>;
      };
    const { data, error } = await page.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function ObjectionCallList() {
  const q = useQuery({ queryKey: ["objection-calls"], queryFn: fetchObjections, staleTime: 30_000 });
  const [filter, setFilter] = useState<ObjFilter>("bank");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.match).length])) as Record<ObjFilter, number>, [rows]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[FILTERS.length - 1];
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return rows.filter((r) => {
      if (!f.match(r)) return false;
      if (!term) return true;
      if (digits.length >= 4 && (r.lead_phone ?? "").replace(/\D/g, "").includes(digits)) return true;
      return [nameOf(r), r.agent_raw, r.disposition].some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [rows, filter, search]);
  // Render a page at a time: 600+ social objections as full cards would stall a phone.
  const [visible, setVisible] = useState(40);

  return (
    <div>
      <div className="z-30 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur lg:sticky lg:top-[60px]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which objection calls to show">
            {FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setVisible(40); }}>
                {f.label}
                <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", filter === f.key ? "bg-background/20" : "bg-muted")}>{counts[f.key]}</span>
              </Button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, agent" aria-label="Search objection calls" className="pl-9" />
          </div>
        </div>
      </div>
      {q.isPending ? (
        // stable-key-allow:skeleton loader, three fixed placeholders
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
      ) : q.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span>Objection calls did not load: {(q.error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" />Try again</Button>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<Phone className="h-6 w-6" />} title="Nothing here" description={search ? "No objection call matches that search." : "No calls in this list right now."} />
      ) : (
        <div className="space-y-4">
          {shown.slice(0, visible).map((r) => <ObjectionCard key={r.call_id} row={r} />)}
          {visible < shown.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setVisible((v) => v + 40)}>Show more ({shown.length - visible} left)</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ObjectionCard({ row }: { row: ObjectionRow }) {
  const callHref = phoneHref(row.lead_phone);
  const textHref = smsHref(row.lead_phone);
  const name = nameOf(row);
  const tone = row.disposition === "Social Objection"
    ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
    : "bg-red-500/15 text-red-800 dark:text-red-300";
  const transcribing = !row.has_transcript && row.download_status === "ok";
  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5" aria-label={`Objection call: ${name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.agent_raw ? `Agent ${row.agent_raw}` : "Agent not on file"}{row.duration_seconds ?? row.rec_seconds ? ` · ${mmss(row.duration_seconds ?? row.rec_seconds)} call` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-sm font-semibold tabular-nums">{callStamp(row.call_at)}</span>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", tone)}>{row.disposition}</span>
          {row.sold_later && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">Bought later</span>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {callHref ? (
          <Button asChild size="sm" className="h-9">
            <a href={callHref} {...contactLinkProps(callHref)}><Phone className="mr-1.5 h-4 w-4" />Call {formatPhoneDisplay(row.lead_phone)}</a>
          </Button>
        ) : (
          <span className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">No phone number on file</span>
        )}
        {textHref && (
          <Button asChild size="sm" variant="outline" className="h-9">
            <a href={textHref} {...contactLinkProps(textHref)}><MessageSquare className="mr-1.5 h-4 w-4" />Text</a>
          </Button>
        )}
        {row.lead_email && <span className="text-xs text-muted-foreground">{row.lead_email}</span>}
      </div>
      <ResellSignals data={row} hasTranscript={Boolean(row.has_transcript) || transcribing} />
      <WorkActions callId={row.call_id} data={row} clientLabel={name} />
    </article>
  );
}
