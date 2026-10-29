// DialerLeadsList: every number the ReadyMode dialer ever called, one row per number (MP-310 wave 2, 2026-10-28).
//
// Sam: "pull all the data as much as you can, give us everything possible". v_readymode_leads rolls the whole call
// log up per phone: how many dials, first and last dial, the last outcome and agent, and whether the number ever
// bought, booked an appointment, objected, or asked not to be called. The lists are the ones worth working. Do not
// call is listed so it is honored: those rows never get a Call link, and a number that ever said it is left out of
// every other list. Sam + Aisha only: the view is security_invoker over readymode_dialer_calls, whose read policy
// is can_view_sold_calls().
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

interface LeadRow {
  phone10: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  attempts: number | null;
  first_dialed_at: string | null;
  last_dialed_at: string | null;
  last_disposition: string | null;
  last_agent: string | null;
  ever_sold: boolean | null;
  do_not_call: boolean | null;
  ever_objection: boolean | null;
  ever_appointment: boolean | null;
  ever_reached: boolean | null;
  campaign: string | null;
}
type LeadResult = { data: LeadRow[] | null; error: { message: string } | null; count: number | null };
/** The slice of the PostgREST builder this list uses: or, like and range, which looseSupabase does not model. */
interface LeadQuery extends PromiseLike<LeadResult> {
  eq(column: string, value: boolean): LeadQuery;
  or(filters: string): LeadQuery;
  like(column: string, pattern: string): LeadQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): LeadQuery;
  range(from: number, to: number): LeadQuery;
}
interface LeadSource { select(columns: string, options?: { count?: "exact"; head?: boolean }): LeadQuery }
const leads = () => (supabase as unknown as { from: (relation: string) => LeadSource }).from("v_readymode_leads");

type SegmentKey = "reached" | "appointment" | "objection" | "never_reached" | "sold" | "dnc";
const APPLY: Record<SegmentKey, (q: LeadQuery) => LeadQuery> = {
  reached: (q) => q.eq("ever_reached", true).eq("ever_sold", false).eq("do_not_call", false),
  appointment: (q) => q.eq("ever_appointment", true).eq("ever_sold", false).eq("do_not_call", false),
  objection: (q) => q.eq("ever_objection", true).eq("ever_sold", false).eq("do_not_call", false),
  never_reached: (q) => q.eq("ever_reached", false).eq("do_not_call", false),
  sold: (q) => q.eq("ever_sold", true),
  dnc: (q) => q.eq("do_not_call", true),
};
const SEGMENTS: Array<{ key: SegmentKey; label: string }> = [
  { key: "reached", label: "Reached, never sold" },
  { key: "appointment", label: "Appointment, not sold" },
  { key: "objection", label: "Objected, not sold" },
  { key: "never_reached", label: "Never reached" },
  { key: "sold", label: "Sold" },
  { key: "dnc", label: "Do not call" },
];
const COLUMNS = "phone10, first_name, last_name, email, attempts, first_dialed_at, last_dialed_at, last_disposition, last_agent, ever_sold, do_not_call, ever_objection, ever_appointment, ever_reached, campaign";
const CSV_COLUMNS: Array<keyof LeadRow> = ["first_name", "last_name", "phone10", "email", "attempts", "first_dialed_at", "last_dialed_at", "last_disposition", "last_agent", "ever_sold", "ever_appointment", "ever_objection", "do_not_call", "campaign"];
const STEP = 100;

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/** Digits search the phone; a word searches first or last name. Only letters, apostrophes and hyphens reach the pattern. */
function withSearch(q: LeadQuery, term: string): LeadQuery {
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4) return q.like("phone10", `%${digits}%`);
  const word = term.replace(/[^A-Za-z'-]+/g, " ").trim().split(" ")[0] ?? "";
  return word.length >= 2 ? q.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`) : q;
}

/** One CSV cell: quoted, and a leading = + - @ neutralized so a spreadsheet never runs it as a formula. */
function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function DialerLeadsList() {
  const [segment, setSegment] = useState<SegmentKey>("reached");
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(STEP);
  const [exporting, setExporting] = useState(false);

  const counts = useQuery({
    queryKey: ["dialer-leads-counts"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: Partial<Record<SegmentKey, number>> = {};
      await Promise.all(SEGMENTS.map(async (s) => {
        const { count, error } = await APPLY[s.key](leads().select("phone10", { count: "exact", head: true }));
        if (error) throw new Error(error.message);
        if (typeof count === "number") out[s.key] = count;
      }));
      return out;
    },
  });

  const list = useQuery({
    queryKey: ["dialer-leads", segment, term, limit],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await withSearch(APPLY[segment](leads().select(COLUMNS)), term)
        .order("last_dialed_at", { ascending: false, nullsFirst: false })
        .range(0, limit - 1);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const countLabel = (key: SegmentKey) => {
    const c = counts.data?.[key];
    return c == null ? "–" : c.toLocaleString();
  };

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const rows: LeadRow[] = [];
      for (let page = 0; page < 40; page += 1) {
        const { data, error } = await APPLY[segment](leads().select(COLUMNS))
          .order("phone10", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        const got = data ?? [];
        rows.push(...got);
        if (got.length < 1000) break;
      }
      const lines = [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))];
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `dialer-leads-${segment}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`${rows.length.toLocaleString()} numbers exported`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "unknown error" });
    } finally {
      setExporting(false);
    }
  };

  const rows = list.data ?? [];
  const total = counts.data?.[segment];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every number the dialer has called, one row each, from the full ReadyMode call log. Tap a number to call it; do not call numbers are never linked.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which dialer leads to show">
        {SEGMENTS.map((s) => (
          <Button key={s.key} size="sm" variant={segment === s.key ? "default" : "outline"} aria-pressed={segment === s.key} onClick={() => { setSegment(s.key); setLimit(STEP); }}>
            {s.label}
            <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", segment === s.key ? "bg-background/20" : "bg-muted")}>{countLabel(s.key)}</span>
          </Button>
        ))}
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(input.trim()); setLimit(STEP); }}>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Name or phone, then Enter" aria-label="Search dialer leads" className="pl-9" />
        </div>
        <Button type="submit" size="sm" variant="outline">Search</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void downloadCsv()} disabled={exporting}>
          <Download className="mr-1 h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "CSV of this list"}
        </Button>
      </form>
      {counts.isError && <p className="text-sm text-rose-700 dark:text-rose-300">Counts did not load: {(counts.error as Error).message}</p>}
      {list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`lead-sk-${n}`} className="h-12 w-full" />)}</div>
      ) : list.isError ? (
        <EmptyState icon={<Phone className="h-6 w-6" />} title="Dialer leads did not load" description={(list.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Phone className="h-6 w-6" />} title="Nothing here" description={term ? "No number in this list matches that search." : "No number is in this list."} />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
          {rows.map((r) => {
            const href = r.do_not_call ? null : phoneHref(r.phone10 ?? "");
            const shown = formatPhoneDisplay(r.phone10 ?? "");
            const dials = Number(r.attempts ?? 0);
            return (
              <li key={r.phone10 ?? "no-phone"} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-[9rem] font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                {href ? (
                  <a href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    <Phone className="h-3.5 w-3.5" />
                    {shown}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{shown}</span>
                )}
                <span className="text-muted-foreground">
                  {dials} {dials === 1 ? "dial" : "dials"} · last {dispositionLabel(r.last_disposition)} {shortDate(r.last_dialed_at)}
                  {r.last_agent ? ` by ${r.last_agent}` : ""}
                </span>
                {r.ever_sold && <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Sold</Badge>}
                {r.ever_appointment && <Badge variant="outline">Appointment</Badge>}
                {r.ever_objection && <Badge variant="outline">Objected</Badge>}
                {r.do_not_call && <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-300">Do not call</Badge>}
                {r.email && <span className="text-muted-foreground [overflow-wrap:anywhere]">{r.email}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length >= limit && limit < 1000 && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => setLimit((v) => Math.min(1000, v + STEP))}>Show {STEP} more</Button>
        </div>
      )}
      {total != null && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {rows.length.toLocaleString()} of {total.toLocaleString()}{term ? " (the count is the whole list, before the search)" : ""}. The CSV holds the whole list.
        </p>
      )}
    </div>
  );
}
