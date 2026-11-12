// Social Media Center. Owner only: the route, the nav entry and the four tables behind it all
// answer to Sam alone (public.is_sam(); migration 20261112210000).
//
// MP-302 (2026-11-12) rebuilt the everyday screen as a work queue:
//   one account selector that filters EVERYTHING below it (counts, queue, history, inbound,
//   blockers), then four views: Needs approval, Scheduled, Published, Inbound.
//
// What each state means, and what proves it:
//   Needs approval  status awaiting_approval. Approve sends back the content_hash this page
//                   displayed; the database approves only if the draft still has that content
//                   (approve_social_draft). A double tap approves once.
//   Scheduled       status approved. Approved is not scheduled: a card says "Scheduled in Postiz"
//                   only when Postiz returned a post id, otherwise "Approved, post it by hand".
//                   Editing the copy, media or destination of an approved draft sends it back to
//                   Needs approval (database trigger). An approved draft past its slot with no
//                   post is shown first as "Missed its slot": it stays here until it is posted
//                   or sent back.
//   Published       status shipped, with its live link. "Confirmed by Postiz" or "Link added by hand".
//   Inbound         unanswered messages. Copy reply only copies. Open thread only opens. A message
//                   leaves the queue when Sam taps "I sent it", and only then is it logged.
//
// Today's limits, shown instead of hidden: Postiz has no key or channel map, the post sync has
// been dead since 2026-11-02 and Instagram automation is paused. Nothing on this page sends a
// message or publishes a post by itself.
import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, ImageOff, Loader2, Megaphone, MessageSquare, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { isSamEmail } from "@/lib/samOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { cn } from "@/lib/utils";
import {
  ACCOUNTS, ACCOUNT_BY_KEY, KEYWORDS, KEYWORD_BY_KEY, accountLabel, accountOfDraft, keywordOf, phoenixDay, pillarLabel, type AccountKey, type Keyword,
} from "@/lib/brand";
import {
  SOCIAL_VIEWS, blockerMatchesAccount, draftState, isSocialView, publishedSource, type DraftLike, type SocialView,
} from "@/lib/socialCenter";

const Engine = lazy(() => import("./SocialMediaBot"));

interface Draft extends DraftLike {
  id: number; pillar: string | null; title: string | null; hook: string | null; body: string | null; caption: string | null;
  hashtags: string | null; cta: string | null; card_id: string | null; file_path: string | null; content_hash: string | null;
}
interface Inbound {
  id: number; ts: string; platform: string | null; handle: string | null; intent: string | null; message: string | null; status: string | null;
  tier: string | null; draft_reply: string | null; source_url: string | null;
}
interface Blocker { id: number; title: string; description: string | null; fix_action: string | null }

const DRAFT_COLS = "id,draft_date,platform,account,slot,pillar,title,hook,body,caption,hashtags,cta,status,card_id,file_path,content_hash,shipped_at,shipped_url,postiz_post_id,ship_source";
const PUBLISHED_DAYS = 30;

// content_hash / approve_social_draft are newer than the generated types, so this page talks
// to the client through a narrow untyped facade (the worklist does the same).
type DbError = { message: string };
type Rows = PromiseLike<{ data: unknown[] | null; error: DbError | null }>;
interface Chain extends Rows {
  select(columns: string): Chain;
  in(column: string, values: unknown[]): Chain;
  eq(column: string, value: unknown): Chain;
  neq(column: string, value: unknown): Chain;
  gte(column: string, value: unknown): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  limit(count: number): Chain;
  update(values: Record<string, unknown>): Chain;
  insert(values: Record<string, unknown>): Chain;
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): Chain;
  maybeSingle(): PromiseLike<{ data: unknown; error: DbError | null }>;
}
const db = supabase as unknown as {
  from: (table: string) => Chain;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError | null }>;
};

async function fetchCenter() {
  const since = new Date(Date.now() - PUBLISHED_DAYS * 86_400_000).toISOString();
  const [open, shipped, inbound, blockers, pause] = await Promise.all([
    db.from("social_bot_drafts").select(DRAFT_COLS).in("status", ["awaiting_approval", "approved"]).order("draft_date", { ascending: true }).limit(300),
    db.from("social_bot_drafts").select(DRAFT_COLS).eq("status", "shipped").gte("shipped_at", since).order("shipped_at", { ascending: false }).limit(200),
    db.from("social_bot_inbound").select("id,ts,platform,handle,intent,message,status,tier,draft_reply,source_url").neq("status", "replied").order("ts", { ascending: false }).limit(200),
    db.from("social_bot_blockers").select("id,title,description,fix_action").eq("status", "open").order("created_at", { ascending: false }),
    db.from("system_settings").select("value").eq("key", "instagram_automation_paused_at").maybeSingle(),
  ]);
  for (const r of [open, shipped, inbound, blockers, pause]) if (r.error) throw r.error;
  return {
    open: (open.data ?? []) as unknown as Draft[],
    published: (shipped.data ?? []) as unknown as Draft[],
    inbound: (inbound.data ?? []) as unknown as Inbound[],
    blockers: (blockers.data ?? []) as unknown as Blocker[],
    igPaused: !!String((pause.data as { value?: string } | null)?.value ?? "").trim(),
  };
}

/** null = the check itself failed; that is "unknown", never "connected". */
async function postizStatus(): Promise<{ configured: boolean } | null> {
  const { data, error } = await supabase.functions.invoke("postiz-bridge", { body: { action: "status" } });
  if (error) return null;
  return { configured: !!(data as { configured?: boolean } | null)?.configured };
}

const isImage = (path: string | null) => !!path && /^https:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(path);

function Media({ path }: { path: string | null }) {
  if (isImage(path)) return <img src={path ?? ""} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover" />;
  return (
    <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-[11px] leading-3 text-muted-foreground" aria-label={path ? "Media attached, no preview" : "No media attached"}>
      <ImageOff className="h-4 w-4" aria-hidden />
      <span>{path ? "No preview" : "No media"}</span>
    </div>
  );
}

function when(d: DraftLike): string {
  if (!d.draft_date) return "No date set";
  const [y, m, day] = d.draft_date.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${date} · ${/^\d{2}:\d{2}$/.test(d.slot ?? "") ? `${d.slot} AZ` : "any time"}`;
}

export default function SocialMediaCenter() {
  usePageTitle("Social Media Center");
  const { user } = useAuth();
  const isSam = isSamEmail(user?.email);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rawAccount = params.get("account");
  const account: AccountKey | "all" = rawAccount && ACCOUNT_BY_KEY[rawAccount] ? (rawAccount as AccountKey) : "all";
  const rawView = params.get("view");
  const view: SocialView = isSocialView(rawView) ? rawView : "approval";
  const setParam = (key: string, value: string | null) => setParams((prev) => {
    const out = new URLSearchParams(prev);
    if (value) out.set(key, value); else out.delete(key);
    return out;
  }, { replace: true });

  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [posting, setPosting] = useState<number | null>(null);
  const [liveUrl, setLiveUrl] = useState("");
  const [kwFilter, setKwFilter] = useState<Keyword | "all" | "none">("all");
  const [showEngine, setShowEngine] = useState(false);

  const q = useQuery({ queryKey: ["social-center"], queryFn: fetchCenter, enabled: isSam, staleTime: 30_000, refetchInterval: 5 * 60_000 });
  const pz = useQuery({ queryKey: ["social-center", "postiz"], queryFn: postizStatus, enabled: isSam, staleTime: 10 * 60_000 });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["social-center"] }); };
  const today = phoenixDay();
  const postizOn = pz.data?.configured === true;

  // ONE filter. Everything rendered below reads these four lists, so choosing an account
  // changes every count and every card together.
  const inAccount = <T extends { account?: string | null; platform?: string | null }>(row: T) => account === "all" || accountOfDraft(row) === account;
  const scoped = useMemo(() => {
    const d = q.data;
    const open = (d?.open ?? []).filter(inAccount);
    return {
      approval: open.filter((x) => x.status === "awaiting_approval"),
      scheduled: open.filter((x) => x.status === "approved")
        .sort((a, b) => Number(draftState(b, today, postizOn).missed) - Number(draftState(a, today, postizOn).missed)),
      published: (d?.published ?? []).filter(inAccount),
      inbound: (d?.inbound ?? []).filter(inAccount).map((r) => ({ ...r, keyword: keywordOf(r) })),
      blockers: (d?.blockers ?? []).filter((b) => blockerMatchesAccount(b, account)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, account, today, postizOn]);
  const counts: Record<SocialView, number> = {
    approval: scoped.approval.length, scheduled: scoped.scheduled.length, published: scoped.published.length, inbound: scoped.inbound.length,
  };
  const inboundShown = scoped.inbound.filter((r) => (kwFilter === "all" ? true : kwFilter === "none" ? r.keyword == null : r.keyword === kwFilter));

  const approve = async (d: Draft) => {
    if (busy !== null) return; // a second tap while the first is in flight does nothing
    setBusy(d.id);
    const res = await db.rpc("approve_social_draft", { p_id: d.id, p_seen_hash: d.content_hash ?? "" });
    if (res.error) { setBusy(null); toast.error(`Not approved: ${res.error.message}`); return; }
    if (res.data === "changed") { setBusy(null); toast.warning("Not approved: this draft changed after it loaded. Review the new version."); refresh(); return; }
    if (res.data !== "approved") { setBusy(null); toast.message("This draft was already handled."); refresh(); return; }
    const sched = await supabase.functions.invoke("postiz-bridge", { body: { action: "schedule", draft_id: d.id } });
    setBusy(null);
    const out = (sched.data ?? {}) as { configured?: boolean; scheduled?: boolean; reason?: string };
    if (sched.error) toast.warning("Approved. Scheduling could not be checked, so post it by hand at its slot.");
    else if (!out.configured) toast.success("Approved. Postiz is not connected: post it by hand, then mark it posted under Scheduled.");
    else if (out.scheduled) toast.success("Approved and scheduled in Postiz.");
    else toast.warning(`Approved, not scheduled: ${out.reason ?? "Postiz gave no reason"}. Post it by hand.`);
    refresh();
  };

  const retrySchedule = async (d: Draft) => {
    if (busy !== null) return;
    setBusy(d.id);
    const sched = await supabase.functions.invoke("postiz-bridge", { body: { action: "schedule", draft_id: d.id } });
    setBusy(null);
    const out = (sched.data ?? {}) as { scheduled?: boolean; reason?: string };
    if (sched.error || !out.scheduled) toast.error(`Not scheduled: ${out.reason ?? "the scheduling check failed"}.`);
    else toast.success("Scheduled in Postiz.");
    refresh();
  };

  const reject = async (d: Draft) => {
    const why = reason.trim();
    if (why.length < 3) { toast.error("Say why, in a few words."); return; }
    setBusy(d.id);
    const now = new Date().toISOString();
    const { data, error } = await db.from("social_bot_drafts").update({ status: "rejected", reject_reason: why, updated_at: now }).eq("id", d.id).select("id");
    if (error || (data?.length ?? 0) !== 1) { setBusy(null); toast.error(`Not sent back: ${error?.message ?? "the draft was not found"}`); return; }
    let where = "Sent back to its Launch Board card with your reason.";
    if (!d.card_id) {
      const acct = accountOfDraft(d);
      const card = await db.from("content_cards").insert({
        title: (d.title || d.hook || "Rejected draft").slice(0, 180), hook: d.hook ?? "", caption: d.caption ?? "",
        brand: acct === "youtube" ? "YT" : "SH", content_type: "short", job: "REACH", status: "idea", sort: Math.floor(Date.now() / 1000),
        brief: { account: acct ?? "", pillar: d.pillar ?? "", keyword: KEYWORDS.some((k) => k.key === d.cta) ? d.cta : "", reject_reason: why, rejected_at: now, from_draft: d.id },
      });
      where = card.error ? `Sent back, but the Launch Board card was not created: ${card.error.message}` : "Sent to the Launch Board as an idea with your reason.";
    }
    setBusy(null); setRejecting(null); setReason("");
    toast.success(where);
    refresh();
  };

  const markPosted = async (d: Draft) => {
    const url = liveUrl.trim();
    if (!/^https:\/\/\S+$/.test(url)) { toast.error("Paste the live post link (https)."); return; }
    setBusy(d.id);
    const now = new Date().toISOString();
    const { data, error } = await db.from("social_bot_drafts")
      .update({ status: "shipped", shipped_at: now, shipped_url: url, ship_source: "manual", updated_at: now })
      .eq("id", d.id).eq("status", "approved").select("id");
    setBusy(null);
    if (error || (data?.length ?? 0) !== 1) { toast.error(`Not saved: ${error?.message ?? "this draft is no longer approved"}`); refresh(); return; }
    setPosting(null); setLiveUrl("");
    toast.success("Saved as published.");
    refresh();
  };

  // Copying is not sending: this changes nothing in the database.
  const copyReply = async (kw: Keyword) => {
    try { await navigator.clipboard.writeText(KEYWORD_BY_KEY[kw].reply); toast.success(`${kw} reply copied. It is not marked sent.`); }
    catch { toast.error("Copy was blocked. Select the reply text on the card and copy it."); }
  };

  // The only thing that takes a message out of the queue.
  const confirmSent = async (r: Inbound, kw: Keyword | null) => {
    if (busy !== null) return;
    setBusy(r.id);
    const acct = accountOfDraft({ platform: r.platform }) ?? "instagram";
    if (kw) {
      const log = await db.from("keyword_dm_log").upsert(
        { inbound_id: r.id, account: acct, keyword: kw, handle: r.handle, status: "pitched", post_url: r.source_url, happened_at: new Date().toISOString() } as never,
        { onConflict: "inbound_id" },
      );
      if (log.error) { setBusy(null); toast.error(`Not saved: ${log.error.message}`); return; }
    }
    const upd = await db.from("social_bot_inbound").update({ status: "replied", ...(kw ? { draft_reply: KEYWORD_BY_KEY[kw].reply } : {}) }).eq("id", r.id).neq("status", "replied").select("id");
    setBusy(null);
    if (upd.error || (upd.data?.length ?? 0) !== 1) { toast.error(`Still open: ${upd.error?.message ?? "the message was not updated"}`); refresh(); return; }
    toast.success("Marked sent.");
    refresh();
  };

  if (!isSam) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-6">
        <EmptyState variant="warning" icon={<AlertTriangle />} title="Owner only" description="The Social Media Center is the owner's. Team social work lives in Social Command." />
      </div>
    );
  }

  const connection = pz.isLoading ? { text: "Checking Postiz", tone: "slate" as const }
    : pz.data == null ? { text: "Postiz status unknown: the check failed", tone: "warm" as const }
    : pz.data.configured ? { text: "Postiz connected", tone: "good" as const }
    : { text: "Postiz not connected: posts go out by hand", tone: "warm" as const };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Owner"
        icon={<Megaphone />}
        tone="gold"
        title="Social Media Center"
        subtitle="Approve, post, answer."
        secondaryActions={<Button variant="outline" className="h-11" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>}
      />

      {q.isError && (
        <EmptyState variant="warning" icon={<AlertTriangle />} title="The center did not load" description={(q.error as Error)?.message ?? "Try again."}
          actions={<Button variant="outline" className="h-11" onClick={refresh}>Try again</Button>} />
      )}

      {/* Account: one compact selector that scopes the whole page. */}
      <div role="radiogroup" aria-label="Account" className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[{ key: "all" as const, label: "All accounts" }, ...ACCOUNTS.map((a) => ({ key: a.key, label: a.label }))].map((a) => (
          <button key={a.key} type="button" role="radio" aria-checked={account === a.key} onClick={() => setParam("account", a.key === "all" ? null : a.key)}
            className={cn("min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold", account === a.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {a.label}
          </button>
        ))}
      </div>

      {/* One quiet line of status; blockers only when there is one to act on. */}
      <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <TonePill tone={connection.tone}>{connection.text}</TonePill>
        {q.data?.igPaused && (account === "all" || account === "instagram") ? <span>Instagram automation is paused on purpose.</span> : null}
      </p>
      {scoped.blockers.length > 0 && (
        <details className="group mb-4 rounded-xl border border-tone-warm/35 bg-card [&[open]_.chev]:rotate-180">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-[15px] font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-tone-warm" aria-hidden />
            {scoped.blockers.length} {scoped.blockers.length === 1 ? "blocker" : "blockers"}{account === "all" ? "" : ` for ${accountLabel(account)}`}
            <ChevronDown className="chev ml-auto h-4 w-4 transition-transform" aria-hidden />
          </summary>
          <ul className="space-y-2 px-3 pb-3">
            {scoped.blockers.map((x) => (
              <li key={x.id} className="text-[15px]">
                <p className="font-semibold">{x.title}</p>
                {x.fix_action && <p className="text-muted-foreground">Fix: {x.fix_action}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Views */}
      <div role="tablist" aria-label="Views" className="mb-3 grid grid-cols-4 gap-1 rounded-xl border border-border bg-card p-1">
        {SOCIAL_VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setParam("view", v.key === "approval" ? null : v.key)}
            className={cn("flex min-h-12 flex-col items-center justify-center rounded-lg px-1 text-[13px] font-semibold leading-4", view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <span className="text-base tabular-nums">{q.isLoading ? "…" : q.isError ? "–" : counts[v.key]}</span>
            <span className="text-center">{v.label}</span>
          </button>
        ))}
      </div>

      {q.isLoading && <Skeleton className="h-48 w-full" />}

      {!q.isLoading && !q.isError && view !== "inbound" && (() => {
        const list = view === "approval" ? scoped.approval : view === "scheduled" ? scoped.scheduled : scoped.published;
        if (list.length === 0) {
          const where = account === "all" ? "" : ` for ${accountLabel(account)}`;
          return view === "approval"
            ? <EmptyState icon={<CheckCircle2 />} variant="success" title="Nothing to approve" description={`No draft is waiting${where}. Cards reach this queue when they are Scheduled on the Launch Board.`} />
            : view === "scheduled"
              ? <EmptyState icon={<CheckCircle2 />} variant="success" title="Nothing approved and waiting" description={`No approved post is waiting to go out${where}.`} />
              : <EmptyState icon={<Megaphone />} title="Nothing published here yet" description={`No post was marked published${where} in the last ${PUBLISHED_DAYS} days. Posts made outside this page appear only once their link is added.`} />;
        }
        return (
          <ul className="space-y-2">
            {list.map((d) => {
              const st = draftState(d, today, postizOn);
              return (
                <li key={d.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex gap-3">
                    <Media path={d.file_path} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <TonePill tone={st.tone}>{st.label}</TonePill>
                        <span className="text-[13px] font-semibold text-foreground">{accountLabel(accountOfDraft(d))}</span>
                      </div>
                      {/* Sam talks off a title and a hook (2026-11-12): those two lead the card. Any
                          longer script or caption stays behind Details. */}
                      <p className="mt-1 line-clamp-2 text-[17px] font-bold leading-snug">{d.title || d.hook || "No title written"}</p>
                      {d.title && d.hook && d.hook !== d.title ? (
                        <p className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-5 text-foreground"><span className="text-muted-foreground">Hook: </span>{d.hook}</p>
                      ) : null}
                      {d.caption ? <p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-muted-foreground">{d.caption}</p> : null}
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {view === "published"
                          ? `${d.shipped_at ? new Date(d.shipped_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" }) : "Date unknown"} · ${publishedSource(d)}`
                          : when(d)}
                      </p>
                    </div>
                  </div>

                  {view === "published" ? (
                    <div className="mt-3">
                      {d.shipped_url ? (
                        <Button asChild variant="outline" className="h-11 w-full"><a href={d.shipped_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /> Open the post</a></Button>
                      ) : <p className="text-[13px] text-tone-warm">Marked published with no link on file.</p>}
                    </div>
                  ) : rejecting === d.id ? (
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1 text-[15px] font-semibold">Why is this going back?
                        <Input className="h-11 text-[16px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Weak hook, wrong account, off-brand" />
                      </label>
                      <div className="flex gap-2">
                        <Button className="h-11 flex-1" disabled={busy === d.id} onClick={() => void reject(d)}>Send back</Button>
                        <Button variant="outline" className="h-11" onClick={() => { setRejecting(null); setReason(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : posting === d.id ? (
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1 text-[15px] font-semibold">Live post link
                        <Input className="h-11 text-[16px]" inputMode="url" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://" />
                      </label>
                      <div className="flex gap-2">
                        <Button className="h-11 flex-1" disabled={busy === d.id} onClick={() => void markPosted(d)}>Save as published</Button>
                        <Button variant="outline" className="h-11" onClick={() => { setPosting(null); setLiveUrl(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {view === "approval" ? (
                        <Button className="h-12 min-w-0 flex-1" disabled={busy !== null} onClick={() => void approve(d)}>
                          {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve this version
                        </Button>
                      ) : (
                        <Button className="h-12 flex-1" onClick={() => { setPosting(d.id); setLiveUrl(""); }}><ExternalLink className="h-4 w-4" aria-hidden /> I posted it</Button>
                      )}
                      {view === "scheduled" && postizOn && !st.scheduled ? (
                        <Button variant="outline" className="h-12" disabled={busy !== null} onClick={() => void retrySchedule(d)}>Retry schedule</Button>
                      ) : null}
                      <Button variant="outline" className="h-12" aria-label="Send back" onClick={() => { setRejecting(d.id); setReason(""); }}><X className="h-4 w-4" aria-hidden /> Send back</Button>
                    </div>
                  )}

                  <details className="mt-2 [&[open]_.chev]:rotate-180">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-muted-foreground">
                      Details <ChevronDown className="chev h-3.5 w-3.5 transition-transform" aria-hidden />
                    </summary>
                    <div className="space-y-1.5 pb-1 text-[14px] leading-5 text-muted-foreground">
                      {d.caption ? <p className="whitespace-pre-line text-foreground">{d.caption}</p> : null}
                      {d.body ? <p className="whitespace-pre-line">{d.body}</p> : null}
                      {d.hashtags ? <p>{d.hashtags}</p> : null}
                      <p>Pillar: {pillarLabel(d.pillar)} · CTA: {d.cta || "none"} · Platform: {d.platform ?? "not set"}</p>
                      <p className="break-all">Media: {d.file_path || "none attached"}</p>
                      <p>Draft #{d.id}{d.card_id ? " · from a Launch Board card" : ""}{d.postiz_post_id ? ` · Postiz post ${d.postiz_post_id}` : ""}</p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        );
      })()}

      {!q.isLoading && !q.isError && view === "inbound" && (
        <section aria-label="Unanswered messages">
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {(["all", "TEAM", "BODY", "BUILD", "none"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kwFilter === k} onClick={() => setKwFilter(k)}
                className={cn("min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-semibold", kwFilter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>
                {k === "all" ? "All" : k === "none" ? "No keyword" : k}
              </button>
            ))}
          </div>
          {inboundShown.length === 0 ? (
            <EmptyState icon={<MessageSquare />} variant="success" title="Nothing unanswered" description="No open message matches this account and keyword." />
          ) : (
            <ul className="space-y-2">
              {inboundShown.map((r) => (
                <li key={r.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.keyword ? <TonePill tone={KEYWORD_BY_KEY[r.keyword].tone}>{r.keyword}</TonePill> : <TonePill tone="slate">No keyword</TonePill>}
                    <span className="text-[13px] font-semibold text-foreground">{accountLabel(accountOfDraft({ platform: r.platform }))}</span>
                    <span className="text-[13px] text-muted-foreground">{r.handle ?? "no handle"} · {r.ts.slice(0, 10)}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[15px]">{r.message || "No message text"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.keyword ? (
                      <Button variant="outline" className="h-11" onClick={() => r.keyword && void copyReply(r.keyword)}><Copy className="h-4 w-4" aria-hidden /> Copy reply</Button>
                    ) : KEYWORDS.map((k) => (
                      <Button key={k.key} variant="outline" className="h-11" onClick={() => void copyReply(k.key)}><Copy className="h-4 w-4" aria-hidden /> {k.key}</Button>
                    ))}
                    {r.source_url && /^https:\/\//.test(r.source_url) ? (
                      <Button asChild variant="outline" className="h-11"><a href={r.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /> Open thread</a></Button>
                    ) : null}
                    <Button className="h-11 flex-1" disabled={busy !== null} onClick={() => void confirmSent(r, r.keyword)}>
                      {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} I sent it
                    </Button>
                  </div>
                  {r.keyword ? (
                    <details className="mt-2 [&[open]_.chev]:rotate-180">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-muted-foreground">Saved reply <ChevronDown className="chev h-3.5 w-3.5 transition-transform" aria-hidden /></summary>
                      <p className="select-all rounded-lg bg-muted/40 p-2 text-[15px] text-muted-foreground">{KEYWORD_BY_KEY[r.keyword].reply}</p>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Everything technical: the pack, hooks, scoreboard and run logs. Loaded only when opened. */}
      <details className="mt-8 [&[open]_.chev]:rotate-180" onToggle={(e) => { if (e.currentTarget.open) setShowEngine(true); }}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Engine, logs and history <ChevronDown className="chev ml-auto h-4 w-4 transition-transform" aria-hidden />
        </summary>
        <div className="mt-3">{showEngine ? <Suspense fallback={<Skeleton className="h-64 w-full" />}><Engine /></Suspense> : null}</div>
      </details>
    </div>
  );
}
