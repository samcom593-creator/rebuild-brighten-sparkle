// Easy Resells (2026-10-16) — one short list of the people easiest to resell, easiest first.
// Sam: "all pages overwhelming so much info to crawl, hard to prioritize easy resells like everyone
// under vantage ... showing easy as possible to resell". Sold Calls, Book Flips and Book of Business
// stay the full working surfaces; this page is the start of the day: who to call, why they are easy,
// one tap to call, one tap to mark it. easy_resells() ranks and keeps one row per phone, and takes a
// person off the list once any of their rows is closed (resold, not interested, DNC, pushback...).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquare, Phone, Search, ShieldAlert, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FlipActions, type FlipSetOptions } from "@/components/books/FlipActions";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { splitClientName } from "@/lib/clientFacts";
import type { FlipStatus } from "@/lib/bookFlips";
import { cn } from "@/lib/utils";
import {
  BUCKET_LABEL, BUCKET_TONE, RESELL_FILTERS, matchesResellFilter, matchesResellSearch, resellCounts, sortResells, touchedText,
  type EasyResell, type ResellFilter,
} from "@/lib/easyResells";

const PAGE = 50;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type RangedRpc = (fn: string) => { range: (from: number, to: number) => Promise<{ data: unknown; error: { message: string } | null }> };

async function fetchResells(): Promise<EasyResell[]> {
  // PostgREST answers at most 1000 rows per request, so page until a short page; the order is
  // re-applied afterwards (sortResells) so it never depends on how the pages arrive.
  const out: EasyResell[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase.rpc as unknown as RangedRpc)("easy_resells").range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (Array.isArray(data) ? data : []) as EasyResell[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return sortResells(out);
}

const money = (n: number | null | undefined) =>
  n == null ? null : `${Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}/mo`;
const shortDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" });
};

export default function EasyResells() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Easy Resells");
  const q = useQuery({ queryKey: ["easy-resells"], queryFn: fetchResells, staleTime: 30_000, enabled: canView });
  const [filter, setFilter] = useState<ResellFilter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => resellCounts(rows), [rows]);
  const visible = useMemo(
    () => rows.filter((r) => matchesResellFilter(r, filter) && matchesResellSearch(r, search)),
    [rows, filter, search],
  );

  if (!canView) {
    return <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">This page is restricted.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="My Business"
        title="Easy Resells"
        subtitle="The easiest people to resell, easiest first. Call, mark it, next."
      />

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Which resells to show">
        {RESELL_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            aria-pressed={filter === f.key}
            onClick={() => { setFilter(f.key); setShown(PAGE); }}
          >
            {f.label}
            <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", filter === f.key ? "bg-background/20" : "bg-muted")}>
              {q.isSuccess ? counts[f.key] : "–"}
            </span>
          </Button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
          placeholder="Search name, phone, agent or carrier"
          aria-label="Search easy resells"
          className="h-11 pl-9 text-base"
        />
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }, (_, n) => <Skeleton key={`er-sk-${n}`} className="h-36 w-full rounded-xl" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load the resell list" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="Nothing here" description={search ? "Nobody matches that search." : "Nobody left in this list. Pick another one above."} />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "person" : "people"}, easiest first. Showing {Math.min(shown, visible.length)}.
          </p>
          <ul className="flex flex-col gap-3">
            {visible.slice(0, shown).map((r) => <ResellRow key={r.item_key} r={r} />)}
          </ul>
          {shown < visible.length && (
            <Button variant="outline" className="mt-4 h-11 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ResellRow({ r }: { r: EasyResell }) {
  const tel = phoneHref(r.phone);
  const sms = smsHref(r.phone);
  const name = r.client_name || "Name not on file";
  const facts = [
    r.carrier,
    r.product,
    money(r.monthly_premium),
    r.policy_status,
    r.age_years != null ? `${r.age_years} yrs` : null,
    r.state,
    r.agent_name ? `sold by ${r.agent_name}` : null,
  ].filter(Boolean).join(" · ");
  const touched = touchedText(r);
  const detailHref = r.call_id
    ? `/dashboard/sold-calls?${r.bucket === "warm_objection" ? "view=objections&" : ""}call=${encodeURIComponent(r.call_id)}`
    : r.flip_carrier
      ? `/dashboard/books?carrier=${encodeURIComponent(r.flip_carrier)}${r.agent_name ? `&agent=${encodeURIComponent(r.agent_name)}` : ""}&book=all`
      : null;

  return (
    <li className="rounded-xl border border-border bg-card p-4" aria-label={`Resell: ${name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold leading-tight text-foreground">{name}</p>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", BUCKET_TONE[r.bucket])}>{BUCKET_LABEL[r.bucket]}</span>
            {r.agent_group === "Vantage" && r.bucket !== "vantage" && (
              <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", BUCKET_TONE.vantage)}>Vantage</span>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground">{r.reason}</p>
          {facts && <p className="mt-0.5 text-sm text-muted-foreground">{facts}</p>}
          {touched && <p className="mt-0.5 text-xs font-medium text-muted-foreground">{touched}</p>}
        </div>
        {r.event_at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortDay(r.event_at)}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tel ? (
          <a href={tel} {...contactLinkProps(tel)} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">
            <Phone className="h-4 w-4" aria-hidden /> {formatPhoneDisplay(r.phone)}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">No phone on file</span>
        )}
        {sms && (
          <Button asChild size="sm" variant="outline" className="h-10">
            <a href={sms} {...contactLinkProps(sms)}><MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />Text</a>
          </Button>
        )}
        {detailHref && (
          <Button asChild size="sm" variant="ghost" className="h-10">
            <Link to={detailHref}>{r.call_id ? "Full call card" : "In Book Flips"} →</Link>
          </Button>
        )}
      </div>

      <div className="mt-3">
        {r.call_id ? <CallMarks r={r} /> : r.flip_carrier && r.flip_policy_number ? <BookMarks r={r} /> : null}
      </div>
    </li>
  );
}

/** The four call marks Sold Calls uses (sold_call_set_status), on one line. Resold posts the deal first. */
function CallMarks({ r }: { r: EasyResell }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { firstName, lastName } = splitClientName(r.client_name);
  const mark = async (status: "contacted" | "resold" | "pushed" | "pushback") => {
    if (busy || !r.call_id) return;
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as unknown as Rpc)("sold_call_set_status", { p_call_id: r.call_id, p_status: status, p_note: null });
      if (error) throw new Error(error.message);
      toast.success(`${r.client_name || "Client"}: ${status === "pushed" ? "Pushed" : status[0].toUpperCase() + status.slice(1)}.`);
      void qc.invalidateQueries({ queryKey: ["easy-resells"] });
      void qc.invalidateQueries({ queryKey: ["sold-calls-queue"] });
      void qc.invalidateQueries({ queryKey: ["objection-calls"] });
    } catch (e) {
      toast.error(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark("contacted")}>Contacted</Button>
      <SubmitDealDialog
        trigger={<Button size="sm" disabled={busy}>Resold</Button>}
        title="Post the new policy"
        description="Posting counts the sale in production and marks this call resold."
        initialClient={{ firstName, lastName, phone: r.phone ?? "", dob: "" }}
        onPosted={() => void mark("resold")}
        secondaryAction={{ label: "Already posted: just mark resold", onClick: () => void mark("resold") }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark("pushed")}>Push</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark("pushback")}>Pushback</Button>
      {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-hidden />}
    </div>
  );
}

/** Book Flips' own call-outcome buttons (book_flip_set), so a mark here shows on the Book Flips card. */
function BookMarks({ r }: { r: EasyResell }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { firstName, lastName } = splitClientName(r.client_name);
  const onSet = async (status: FlipStatus, opts: FlipSetOptions = {}): Promise<boolean> => {
    if (busy || !r.flip_carrier || !r.flip_policy_number) return false;
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as unknown as Rpc)("book_flip_set", {
        p_carrier: r.flip_carrier,
        p_policy_number: r.flip_policy_number,
        p_client_key: r.flip_client_key,
        p_status: status,
        p_count_attempt: !!opts.countAttempt,
        ...(opts.note ? { p_note: opts.note } : {}),
        ...(opts.callbackAt ? { p_callback_at: opts.callbackAt } : {}),
        ...(opts.receipt ? {
          p_resold_deal_id: opts.receipt.dealId,
          p_resold_policy_number: opts.receipt.policyNumber,
          p_resold_annual_premium: opts.receipt.annualPaid,
        } : {}),
      });
      if (error) throw new Error(error.message);
      if (status === "resold") toast.success("Marked resold.");
      void qc.invalidateQueries({ queryKey: ["easy-resells"] });
      void qc.invalidateQueries({ queryKey: ["book-flips"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: ["book-flip-counts"] });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save.";
      toast.error(opts.receipt
        ? `The new deal posted, but this policy was not marked resold (${msg}). Tap Resold, then "Already posted" to retry.`
        : `Not saved: ${msg}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const status = (r.flip_status ?? "to_call") as FlipStatus;
  return (
    <FlipActions
      idBase={r.item_key}
      status={status}
      busy={busy}
      client={{ firstName, lastName, phone: r.phone ?? "", dob: "" }}
      onSet={onSet}
    />
  );
}
