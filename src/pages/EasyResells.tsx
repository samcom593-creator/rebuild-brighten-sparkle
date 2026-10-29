// Easy Resells (2026-10-16) — one short list of the people easiest to resell.
// Sam: "all pages overwhelming so much info to crawl, hard to prioritize easy resells like everyone
// under vantage ... showing easy as possible to resell". Sold Calls, Book Flips and Book of Business
// stay the full working surfaces; this page is the start of the day: who to call, why they are easy,
// one tap to call, one tap to mark it. easy_resells() keeps one row per phone, and takes a person off
// the list once any of their rows is closed (resold, not interested, DNC, pushback...).
//
// OVERHAUL-resells (2026-10-29), Sam: "cleaner cards, and rank opportunities by evidence (recently
// lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each one ranks
// where it does." The list is ranked by an evidence score (src/lib/resellEvidence.ts), each card shows
// its rank, its score and one chip per piece of evidence with its points, and four tiles count the
// evidence and open exactly the people they count. Only the first card's Call is gold.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquare, Phone, Search, ShieldAlert, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { useResellEvidence } from "@/hooks/useResellEvidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { FlipActions, type FlipSetOptions } from "@/components/books/FlipActions";
import { SubmitDealDialog, type PostedDealReceipt } from "@/components/deals/SubmitDealDialog";
import { EvidenceBoard, EvidenceChips, RankBadge, RankedListHeader, ScoreBadge } from "@/components/resells/Evidence";
import { BOOK_CLIENT_DETAILS_KEY } from "@/hooks/useBookClientDetails";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { splitClientName } from "@/lib/clientFacts";
import { shortDate, type FlipStatus } from "@/lib/bookFlips";
import { celebrate } from "@/lib/celebrate";
import { cn } from "@/lib/utils";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { resellBucketTone } from "@/lib/tones";
import {
  BUCKET_LABEL, EASY_RESELLS_KEY, RESELL_FILTERS, closesBookRow, closesCallRow, matchesResellFilter, matchesResellSearch,
  rankResells, resellSubject, sortResells, touchedText, type EasyResell, type ResellFilter,
} from "@/lib/easyResells";
import { EMPTY_EVIDENCE, NO_EVIDENCE, evidenceCounts, evidenceFor, hasEvidence, type Evidence, type EvidenceKey } from "@/lib/resellEvidence";

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
const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? "person" : "people"}`;

const chipClass = (active: boolean) => cn(
  "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground hover:bg-muted",
);

export default function EasyResells() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Easy Resells");
  const q = useQuery({ queryKey: [EASY_RESELLS_KEY], queryFn: fetchResells, staleTime: 30_000, enabled: canView });
  const [filter, setFilter] = useState<ResellFilter>("all");
  const [proof, setProof] = useState<EvidenceKey | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const subjects = useMemo(() => rows.map(resellSubject), [rows]);
  const ev = useResellEvidence(subjects, { enabled: canView && q.isSuccess, scope: "easy-resells" });
  const evidence = useMemo(() => {
    const now = new Date();
    const index = ev.index ?? EMPTY_EVIDENCE;
    return new Map(rows.map((r, i) => [r.item_key, evidenceFor(subjects[i], index, now)]));
  }, [rows, subjects, ev.index]);
  const evidenceKnown = ev.isReady && !ev.isError;
  const evOf = (r: EasyResell): Evidence => evidence.get(r.item_key) ?? NO_EVIDENCE;

  // Ranked by evidence once it is in; if it failed, the database's own order stands and the board says so.
  const ranked = useMemo(
    () => (evidenceKnown ? rankResells(rows, (r) => evidence.get(r.item_key)?.score ?? 0) : rows),
    [rows, evidence, evidenceKnown],
  );
  const searched = useMemo(() => ranked.filter((r) => matchesResellSearch(r, search)), [ranked, search]);
  // Each chip and tile counts the people it would show with the other filter as it is, so a count equals
  // the list it opens.
  const { counts, tileCounts, visible } = useMemo(() => {
    const ofRow = (r: EasyResell) => evidence.get(r.item_key) ?? NO_EVIDENCE;
    const proofOk = (r: EasyResell) => !proof || hasEvidence(ofRow(r), proof);
    const byChip = Object.fromEntries(RESELL_FILTERS.map((f) => [f.key, 0])) as Record<ResellFilter, number>;
    for (const f of RESELL_FILTERS) byChip[f.key] = searched.filter((r) => matchesResellFilter(r, f.key) && proofOk(r)).length;
    const inChip = searched.filter((r) => matchesResellFilter(r, filter));
    return {
      counts: byChip,
      tileCounts: evidenceKnown ? evidenceCounts(inChip.map(ofRow)) : null,
      visible: inChip.filter(proofOk),
    };
  }, [searched, filter, proof, evidence, evidenceKnown]);

  if (!canView) {
    return <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">This page is restricted.</div>;
  }

  const listLoading = q.isLoading || (q.isSuccess && ev.isLoading);
  const boardNotice = ev.isError ? (
    <>
      <span role="alert">Call evidence did not load, so the list is in its usual order and nothing is ranked.</span>
      <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={() => void ev.refetch()}>Try again</Button>
    </>
  ) : undefined;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="My Business"
        icon={<Sparkles />}
        tone="good"
        title="Easy Resells"
        subtitle="Who to call first, and why."
      />

      <EvidenceBoard
        counts={q.isSuccess ? tileCounts : null}
        active={proof}
        onSelect={(k) => { setProof(k); setShown(PAGE); }}
        notice={boardNotice}
      />

      <div className="space-y-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Which resells to show">
          {RESELL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => { setFilter(f.key); setShown(PAGE); }}
              className={chipClass(filter === f.key)}
            >
              {f.label}
              <span className="tabular-nums text-muted-foreground">{q.isSuccess && !ev.isLoading ? counts[f.key] : "—"}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
            placeholder="Search name, phone, agent or carrier"
            aria-label="Search easy resells"
            className="h-11 bg-card pl-9 text-base"
          />
        </div>
      </div>

      {listLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the resell list">
          {Array.from({ length: 4 }, (_, n) => <Skeleton key={`er-sk-${n}`} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          variant="warning"
          title="Could not load the resell list"
          description={String((q.error as Error)?.message ?? "Unknown error")}
          actions={<Button type="button" variant="outline" className="h-11" onClick={() => void q.refetch()}>Try again</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Nobody to resell right now"
          description="When a sold call, a lapse or a departed writer's policy needs a call, the person shows up here."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Nothing here"
          description={search ? "Nobody matches that search." : "Nobody in this list. Pick another tile or chip above."}
          actions={proof || filter !== "all" ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => { setProof(null); setFilter("all"); setShown(PAGE); }}>Show everyone</Button>
          ) : undefined}
        />
      ) : (
        <>
          <RankedListHeader
            summary={`${people(visible.length)}${evidenceKnown ? ", most evidence first" : ""}`}
            ranked={evidenceKnown}
            only={proof}
            onShowAll={() => { setProof(null); setShown(PAGE); }}
            tieBreak="the usual order: ready to finish, bought but never booked, lapsing, dropped, Vantage clients, agent left, warm calls, and nobody called yet before the rest"
          />
          <ul className="apex-rise-list flex flex-col gap-3">
            {visible.slice(0, shown).map((r, i) => (
              <ResellRow key={r.item_key} r={r} rank={i + 1} evidence={evOf(r)} evidenceKnown={evidenceKnown} gold={i === 0} />
            ))}
          </ul>
          {shown < visible.length && (
            <Button variant="outline" className="h-11 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more ({(visible.length - shown).toLocaleString()} not shown yet)
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ResellRow({ r, rank, evidence, evidenceKnown, gold }: { r: EasyResell; rank: number; evidence: Evidence; evidenceKnown: boolean; gold: boolean }) {
  const cardRef = useRef<HTMLLIElement>(null);
  const tel = phoneHref(r.phone);
  const sms = smsHref(r.phone);
  const name = r.client_name || "Name not on file";
  // A call is a moment (Phoenix time); a book row's date is a calendar date, read as stored.
  const when = r.event_at ? (r.call_id ? `call ${shortDay(r.event_at)}` : `started ${shortDate(r.event_at)}`) : null;
  const facts = [
    r.carrier,
    r.product,
    money(r.monthly_premium),
    r.call_id ? null : r.policy_status,
    r.age_years != null ? `${r.age_years} yrs` : null,
    r.state,
    r.agent_name ? `sold by ${r.agent_name}` : null,
    when,
  ].filter(Boolean).join(" · ");
  const touched = touchedText(r);
  const detailHref = r.call_id
    ? `/dashboard/sold-calls?${r.bucket === "warm_objection" ? "view=objections&" : ""}call=${encodeURIComponent(r.call_id)}`
    : r.flip_carrier
      ? `/dashboard/books?carrier=${encodeURIComponent(r.flip_carrier)}${r.agent_name ? `&agent=${encodeURIComponent(r.agent_name)}` : ""}&book=all`
      : null;

  return (
    // On a phone the Call row comes straight after the reason, so the first card's Call is on the first
    // screen; from sm up the chips sit first, beside the score they add up to.
    <li ref={cardRef} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 sm:p-5" aria-label={`Resell: ${name}`}>
      <div className="order-1 flex items-start gap-3">
        {evidenceKnown && <RankBadge rank={rank} />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <p className="min-w-0 break-words text-[17px] font-bold leading-tight text-foreground">{name}</p>
          <TonePill tone={resellBucketTone(r.bucket)} className="whitespace-nowrap">{BUCKET_LABEL[r.bucket]}</TonePill>
          {r.agent_group === "Vantage" && r.bucket !== "vantage" && (
            <TonePill tone={resellBucketTone("vantage")} className="whitespace-nowrap">Vantage</TonePill>
          )}
        </div>
        {evidenceKnown && <ScoreBadge evidence={evidence} />}
      </div>
      <p className="order-2 mt-2 text-[15px] leading-[22px] text-foreground">{r.reason}</p>

      {evidenceKnown && <div className="order-4 mt-3 sm:order-3"><EvidenceChips evidence={evidence} /></div>}

      <div className="order-5">
        {facts && <p className="mt-3 break-words text-sm text-muted-foreground">{facts}</p>}
        {touched && <p className="mt-1 text-[13px] font-medium leading-[18px] text-muted-foreground">{touched}</p>}
        {/* A sold or objection call plays here (loads on tap), so "hear the call" needs no other page. */}
        {r.call_id && <div className="mt-2"><CallAudioPlayer callId={r.call_id} compact /></div>}
      </div>

      <div className="order-3 mt-3 flex flex-wrap items-center gap-2 sm:order-4">
        {tel ? (
          <Button asChild variant={gold ? "default" : "outline"} className="h-11 px-4 text-[15px] font-bold">
            <a href={tel} {...contactLinkProps(tel)}><Phone className="mr-2 h-4 w-4" aria-hidden />{formatPhoneDisplay(r.phone)}</a>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">No phone on file</span>
        )}
        {sms && (
          <Button asChild variant="outline" className="h-11">
            <a href={sms} {...contactLinkProps(sms)}><MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />Text</a>
          </Button>
        )}
        {detailHref && (
          <Button asChild variant="ghost" className="h-11">
            <Link to={detailHref}>{r.call_id ? "Full call card" : "In Book Flips"} →</Link>
          </Button>
        )}
      </div>

      <div className="order-6 mt-3 border-t border-border pt-3">
        {r.call_id ? <CallMarks r={r} cardRef={cardRef} /> : r.flip_carrier && r.flip_policy_number ? <BookMarks r={r} cardRef={cardRef} /> : null}
      </div>
    </li>
  );
}

/** Patch one row in the cached list (or drop it once the person is closed) so it does not jump mid-call. */
function patchRow(qc: ReturnType<typeof useQueryClient>, itemKey: string, closed: boolean, patch: Partial<EasyResell>) {
  qc.setQueryData<EasyResell[]>([EASY_RESELLS_KEY], (list) => list && (closed
    ? list.filter((x) => x.item_key !== itemKey)
    : list.map((x) => (x.item_key === itemKey ? { ...x, ...patch } : x))));
  // Stale for next time, without a reload now that would re-sort the list under the caller.
  void qc.invalidateQueries({ queryKey: [EASY_RESELLS_KEY], refetchType: "none" });
}

type CardRef = { current: HTMLLIElement | null };

/** The four call marks Sold Calls uses (sold_call_set_status), on one line. Resold posts the deal first. */
function CallMarks({ r, cardRef }: { r: EasyResell; cardRef: CardRef }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { firstName, lastName } = splitClientName(r.client_name);
  const mark = async (status: "contacted" | "resold" | "pushed" | "pushback", receipt?: PostedDealReceipt) => {
    if (busy || !r.call_id) return;
    setBusy(true);
    try {
      // Same order as Sold Calls: a sold call's packet is marked resold first, with the new policy number.
      if (status === "resold" && r.packet_id) {
        const { error: bookErr } = await (supabase.rpc as unknown as Rpc)("booking_packet_mark_booked", { p_id: r.packet_id, p_policy: receipt?.policyNumber ?? "" });
        if (bookErr) throw new Error(bookErr.message);
      }
      const { error } = await (supabase.rpc as unknown as Rpc)("sold_call_set_status", { p_call_id: r.call_id, p_status: status, p_note: null });
      if (error) throw new Error(error.message);
      toast.success(`${r.client_name || "Client"}: ${status === "pushed" ? "Pushed" : status[0].toUpperCase() + status.slice(1)}.`);
      // A resell is a sale: the bubbles rise from the card, after the server said it saved.
      if (status === "resold") void celebrate("win", cardRef.current);
      patchRow(qc, r.item_key, closesCallRow(status), { work_status: status, last_touch_at: new Date().toISOString() });
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
        trigger={<Button size="sm" variant="outline" disabled={busy}>Resold</Button>}
        title="Post the new policy"
        description="Posting counts the sale in production and marks this call resold."
        initialClient={{ firstName, lastName, phone: r.phone ?? "", dob: r.dob ?? "" }}
        initialDeal={r.bucket === "ready_to_finish" || r.bucket === "sold_not_booked" || r.bucket === "vantage"
          ? { carrierName: r.carrier, product: r.product, monthlyPremium: r.monthly_premium }
          : undefined}
        onPosted={(receipt) => void mark("resold", receipt)}
        secondaryAction={{ label: "Already posted: just mark resold", onClick: () => void mark("resold") }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark("pushed")}>Push</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark("pushback")}>Pushback</Button>
      {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-hidden />}
    </div>
  );
}

/** Book Flips' own call-outcome buttons (book_flip_set), so a mark here shows on the Book Flips card. */
function BookMarks({ r, cardRef }: { r: EasyResell; cardRef: CardRef }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { firstName, lastName } = splitClientName(r.client_name);
  const onSet = async (status: FlipStatus, opts: FlipSetOptions = {}): Promise<boolean> => {
    if (busy || !r.flip_carrier || !r.flip_policy_number) return false;
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("book_flip_set", {
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
      const saved = (data ?? {}) as { flip_status?: string; attempts?: number; last_contact_at?: string | null; callback_at?: string | null };
      const next = saved.flip_status ?? status;
      // The bubbles rise from the card before a resold person leaves the list (the server has said it saved).
      if (status === "resold") {
        toast.success("Marked resold.");
        void celebrate("win", cardRef.current);
      }
      patchRow(qc, r.item_key, closesBookRow(next, saved.callback_at ?? opts.callbackAt ?? null), {
        flip_status: next,
        attempts: saved.attempts ?? r.attempts,
        last_touch_at: saved.last_contact_at ?? (opts.countAttempt ? new Date().toISOString() : r.last_touch_at),
        callback_at: saved.callback_at ?? null,
      });
      void qc.invalidateQueries({ queryKey: ["book-flips"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: [BOOK_CLIENT_DETAILS_KEY] });
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
      client={{ firstName, lastName, phone: r.phone ?? "", dob: r.dob ?? "" }}
      onSet={onSet}
      resoldVariant="outline"
    />
  );
}
