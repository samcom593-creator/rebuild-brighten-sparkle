// Social Media Center (MP-BRAND-ENGINE part 3, 2026-11-12). The rebuilt social admin page.
// Top to bottom: open blockers in plain words, today's expected-vs-posted strip per account, then one
// tab per account with its approval queue, an Inbound tab (TEAM / BODY / BUILD with a saved reply), and
// the earlier engine views (pack, hooks, scoreboard, runs) kept whole under Engine.
//
// Approve: marks the draft approved and asks postiz-bridge to schedule it at its slot. Until a Postiz
// key and channel map exist the bridge answers "not connected" and the page says so: the draft is
// approved, posted by hand, and closed with its live link ("Mark posted").
// Reject: needs a reason. A draft that came from a Launch Board card sends the card back to Edited with
// the reason on it (database trigger); a draft with no card becomes a new idea card carrying the reason.
// Inbound: no platform here accepts an automated DM from this page (Instagram automation is paused on
// purpose, YouTube has no DM API), so "Reply" copies the saved reply, opens the thread, marks the row
// replied and writes keyword_dm_log in one tap.
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink, Loader2, Megaphone, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  ACCOUNTS, KEYWORDS, KEYWORD_BY_KEY, accountLabel, accountOfDraft, keywordOf, phoenixDay, pillarLabel, type AccountKey, type Keyword,
} from "@/lib/brand";

const Engine = lazy(() => import("./SocialMediaBot"));

interface Draft {
  id: number; draft_date: string | null; platform: string | null; account: string | null; slot: string | null; pillar: string | null;
  title: string | null; hook: string | null; caption: string | null; cta: string | null; status: string; card_id: string | null;
  shipped_at: string | null; shipped_url: string | null; postiz_post_id: string | null;
}
interface Inbound {
  id: number; ts: string; platform: string | null; handle: string | null; intent: string | null; message: string | null; status: string | null;
  tier: string | null; draft_reply: string | null; source_url: string | null;
}
interface Blocker { id: number; title: string; description: string | null; fix_action: string | null }
type TabKey = AccountKey | "inbound" | "engine";

const DRAFT_COLS = "id,draft_date,platform,account,slot,pillar,title,hook,caption,cta,status,card_id,shipped_at,shipped_url,postiz_post_id";

async function fetchCenter() {
  const today = phoenixDay();
  const dayStart = new Date(`${today}T00:00:00-07:00`).toISOString();
  const [open, shipped, posts, logged, inbound, blockers, pause] = await Promise.all([
    supabase.from("social_bot_drafts").select(DRAFT_COLS).in("status", ["awaiting_approval", "approved"]).order("draft_date", { ascending: true }).limit(300),
    supabase.from("social_bot_drafts").select(DRAFT_COLS).eq("status", "shipped").gte("shipped_at", dayStart).limit(100),
    supabase.from("content_posts").select("id,platform,posted_at").gte("posted_at", dayStart).limit(200),
    supabase.from("brand_metrics_daily").select("account,value").eq("metric", "posts").eq("metric_date", today),
    supabase.from("social_bot_inbound").select("id,ts,platform,handle,intent,message,status,tier,draft_reply,source_url").neq("status", "replied").order("ts", { ascending: false }).limit(200),
    supabase.from("social_bot_blockers").select("id,title,description,fix_action").eq("status", "open").order("created_at", { ascending: false }),
    supabase.from("system_settings").select("value").eq("key", "instagram_automation_paused_at").maybeSingle(),
  ]);
  for (const r of [open, shipped, posts, logged, inbound, blockers, pause]) if (r.error) throw r.error;
  return {
    today,
    open: (open.data ?? []) as Draft[],
    shippedToday: (shipped.data ?? []) as Draft[],
    postsToday: (posts.data ?? []) as { id: number; platform: string; posted_at: string }[],
    loggedToday: (logged.data ?? []) as { account: string; value: number }[],
    inbound: (inbound.data ?? []) as Inbound[],
    blockers: (blockers.data ?? []) as Blocker[],
    igPaused: !!(pause.data?.value ?? "").trim(),
  };
}

async function postizStatus(): Promise<{ configured: boolean }> {
  const { data, error } = await supabase.functions.invoke("postiz-bridge", { body: { action: "status" } });
  if (error) return { configured: false };
  return { configured: !!(data as { configured?: boolean } | null)?.configured };
}

export default function SocialMediaCenter() {
  usePageTitle("Social Media Center");
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("youtube");
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [posting, setPosting] = useState<number | null>(null);
  const [liveUrl, setLiveUrl] = useState("");
  const [kwFilter, setKwFilter] = useState<Keyword | "all" | "none">("all");

  const q = useQuery({ queryKey: ["social-center"], queryFn: fetchCenter, staleTime: 30_000, refetchInterval: 5 * 60_000 });
  const pz = useQuery({ queryKey: ["social-center", "postiz"], queryFn: postizStatus, staleTime: 10 * 60_000 });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["social-center"] }); };

  const strip = useMemo(() => {
    const d = q.data;
    return ACCOUNTS.map((a) => {
      const paused = a.key === "instagram" && !!d?.igPaused;
      const shipped = (d?.shippedToday ?? []).filter((x) => accountOfDraft(x) === a.key).length;
      const synced = (d?.postsToday ?? []).filter((p) => accountOfDraft({ platform: p.platform }) === a.key).length;
      const logged = (d?.loggedToday ?? []).filter((r) => r.account === a.key).reduce((n, r) => n + Number(r.value), 0);
      const slotted = (d?.open ?? []).filter((x) => accountOfDraft(x) === a.key && x.draft_date === d?.today).length;
      const expected = paused ? 0 : Math.max(a.dailyExpected, slotted + shipped);
      const posted = Math.max(shipped, synced, logged);
      return { ...a, paused, expected, posted, red: expected > 0 && posted === 0 };
    });
  }, [q.data]);

  const queueFor = (key: AccountKey) => (q.data?.open ?? []).filter((d) => accountOfDraft(d) === key);
  const inbound = useMemo(() => (q.data?.inbound ?? []).map((r) => ({ ...r, keyword: keywordOf(r) })), [q.data]);
  const inboundShown = inbound.filter((r) => (kwFilter === "all" ? true : kwFilter === "none" ? r.keyword == null : r.keyword === kwFilter));

  const approve = async (d: Draft) => {
    setBusy(d.id);
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("social_bot_drafts").update({ status: "approved", approved_at: now, approved_by: "sam", updated_at: now }).eq("id", d.id).eq("status", "awaiting_approval").select("id");
    if (error || (data?.length ?? 0) !== 1) { setBusy(null); toast.error(error ? `Not approved: ${error.message}` : "Not approved: this draft was already handled."); refresh(); return; }
    const res = await supabase.functions.invoke("postiz-bridge", { body: { action: "schedule", draft_id: d.id } });
    setBusy(null);
    const out = (res.data ?? {}) as { configured?: boolean; scheduled?: boolean; reason?: string; at?: string };
    if (res.error) toast.warning("Approved. The Postiz check failed, so post it by hand at its slot.");
    else if (!out.configured) toast.success("Approved. Postiz is not connected yet: post it by hand at its slot, then tap Mark posted.");
    else if (out.scheduled) toast.success(`Approved and scheduled in Postiz${d.slot ? ` for ${d.slot}` : ""}.`);
    else toast.warning(`Approved, not scheduled: ${out.reason ?? "Postiz gave no reason"}. Post it by hand.`);
    refresh();
  };

  const reject = async (d: Draft) => {
    const why = reason.trim();
    if (why.length < 3) { toast.error("Say why, in a few words."); return; }
    setBusy(d.id);
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("social_bot_drafts").update({ status: "rejected", reject_reason: why, updated_at: now }).eq("id", d.id).select("id");
    if (error || (data?.length ?? 0) !== 1) { setBusy(null); toast.error(`Not rejected: ${error?.message ?? "the draft was not found"}`); return; }
    let where = "Sent back to its Launch Board card with your reason.";
    if (!d.card_id) {
      const acct = accountOfDraft(d);
      const card = await supabase.from("content_cards").insert({
        title: (d.title || d.hook || "Rejected draft").slice(0, 180), hook: d.hook ?? "", caption: d.caption ?? "",
        brand: acct === "youtube" ? "YT" : "SH", content_type: "short", job: "REACH", status: "idea", sort: Math.floor(Date.now() / 1000),
        brief: { account: acct ?? "", pillar: d.pillar ?? "", keyword: KEYWORDS.some((k) => k.key === d.cta) ? d.cta : "", reject_reason: why, rejected_at: now, from_draft: d.id },
      });
      where = card.error ? `Rejected, but the Launch Board card was not created: ${card.error.message}` : "Sent to the Launch Board as an idea with your reason.";
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
    const { data, error } = await supabase.from("social_bot_drafts").update({ status: "shipped", shipped_at: now, shipped_url: url, ship_source: "manual", updated_at: now }).eq("id", d.id).select("id");
    setBusy(null);
    if (error || (data?.length ?? 0) !== 1) { toast.error(`Not saved: ${error?.message ?? "the draft was not found"}`); return; }
    setPosting(null); setLiveUrl("");
    toast.success("Marked posted.");
    refresh();
  };

  const replyInbound = async (r: Inbound & { keyword: Keyword | null }, kw: Keyword) => {
    const text = KEYWORD_BY_KEY[kw].reply;
    setBusy(r.id);
    let copied = true;
    try { await navigator.clipboard.writeText(text); } catch { copied = false; }
    if (r.source_url && /^https:\/\//.test(r.source_url)) window.open(r.source_url, "_blank", "noopener,noreferrer");
    const acct = accountOfDraft({ platform: r.platform }) ?? "instagram";
    const log = await supabase.from("keyword_dm_log").upsert(
      { inbound_id: r.id, account: acct, keyword: kw, handle: r.handle, status: "pitched", post_url: r.source_url, happened_at: new Date().toISOString() },
      { onConflict: "inbound_id" },
    );
    const upd = log.error ? null : await supabase.from("social_bot_inbound").update({ status: "replied", draft_reply: text }).eq("id", r.id).select("id");
    setBusy(null);
    if (log.error) { toast.error(`Not logged: ${log.error.message}`); return; }
    if (upd?.error || (upd?.data?.length ?? 0) !== 1) { toast.warning("Logged, but the message is still marked open. Refresh and try again."); refresh(); return; }
    toast.success(copied ? `${kw} reply copied and logged. Paste it in the thread.` : `${kw} logged. Copy was blocked, so copy the reply from the card.`);
    refresh();
  };

  const tabs: { key: TabKey; label: string; count: number | null }[] = [
    ...ACCOUNTS.map((a) => ({ key: a.key as TabKey, label: a.label, count: queueFor(a.key).filter((d) => d.status === "awaiting_approval").length })),
    { key: "inbound", label: "Inbound", count: inbound.length },
    { key: "engine", label: "Engine", count: null },
  ];
  const active = ACCOUNTS.find((a) => a.key === tab);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Owner"
        icon={<Megaphone />}
        tone="gold"
        title="Social Media Center"
        subtitle="Approve the queue, see what shipped today, answer TEAM, BODY and BUILD."
        secondaryActions={<Button variant="outline" className="h-11" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>}
      />

      {q.isError && (
        <EmptyState variant="warning" icon={<AlertTriangle />} title="The center did not load" description={(q.error as Error)?.message ?? "Try again."}
          actions={<Button variant="outline" className="h-11" onClick={refresh}>Try again</Button>} />
      )}

      {/* Blockers, pinned */}
      {(q.data?.blockers.length ?? 0) > 0 && (
        <section aria-label="Open blockers" className="mb-4 space-y-2">
          {q.data?.blockers.map((x) => (
            <div key={x.id} className={cn("rounded-xl border bg-card p-3", TONE_CLASS.warm.border)}>
              <p className="flex items-start gap-2 text-[15px] font-bold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-warm" aria-hidden /> {x.title}</p>
              {x.fix_action && <p className="mt-1 flex items-start gap-2 text-[15px] text-muted-foreground"><ArrowRight className="mt-1 h-4 w-4 shrink-0" aria-hidden /> {x.fix_action}</p>}
            </div>
          ))}
        </section>
      )}

      {/* Today strip */}
      <section aria-labelledby="smc-today" className="mb-4">
        <h2 id="smc-today" className="mb-2 text-lg font-bold tracking-tight">Today</h2>
        {q.isLoading ? <Skeleton className="h-20 w-full" /> : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {strip.map((a) => {
              const tone = a.paused ? "slate" : a.red ? "hot" : a.posted >= a.expected ? "good" : "warm";
              return (
                <li key={a.key} className={cn("rounded-xl border bg-card p-3", TONE_CLASS[tone].border)}>
                  <p className="truncate text-[13px] font-semibold text-muted-foreground">{a.label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{a.posted}<span className="text-base font-semibold text-muted-foreground"> / {a.expected}</span></p>
                  <p className={cn("text-[13px] font-semibold", TONE_CLASS[tone].text)}>{a.paused ? "Paused" : a.red ? "Nothing posted" : a.posted >= a.expected ? "Done" : "Behind"}</p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[13px] text-muted-foreground">Posted over expected, Arizona day. Posted counts links marked here, synced posts, or a post count logged on Brand Command, whichever is highest.{pz.data && !pz.data.configured ? " Postiz is not connected: approvals are posted by hand." : ""}</p>
      </section>

      {/* Tabs */}
      <div role="tablist" aria-label="Accounts" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold", tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground")}>
            {t.label}{t.count != null && t.count > 0 ? <span className="tabular-nums opacity-80">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {active && (
        <section aria-label={`${active.label} approval queue`}>
          {q.isLoading ? <Skeleton className="h-40 w-full" /> : queueFor(active.key).length === 0 ? (
            <EmptyState icon={<CheckCircle2 />} variant="success" title="Nothing waiting" description={`No ${active.label} draft is waiting for approval. Cards reach this queue when they are Scheduled on the Launch Board.`} />
          ) : (
            <ul className="space-y-2">
              {queueFor(active.key).map((d) => (
                <li key={d.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <TonePill tone={d.status === "approved" ? "good" : "gold"}>{d.status === "approved" ? "Approved, not posted" : "Waiting for approval"}</TonePill>
                    <span className="text-[13px] text-muted-foreground">{d.draft_date ?? "no date"} · {d.slot || "any time"}</span>
                  </div>
                  <p className="mt-2 text-[16px] font-bold leading-snug">{d.hook || d.title || "No hook written"}</p>
                  {d.caption && <p className="mt-1 whitespace-pre-line text-[15px] text-muted-foreground">{d.caption}</p>}
                  <p className="mt-2 text-[13px] text-muted-foreground">Pillar: {pillarLabel(d.pillar)} · CTA: {d.cta || "none"}</p>

                  {rejecting === d.id ? (
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
                        <Button className="h-11 flex-1" disabled={busy === d.id} onClick={() => void markPosted(d)}>Save as posted</Button>
                        <Button variant="outline" className="h-11" onClick={() => { setPosting(null); setLiveUrl(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      {d.status === "awaiting_approval" ? (
                        <Button className="h-12 flex-1" disabled={busy === d.id} onClick={() => void approve(d)}>
                          {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve
                        </Button>
                      ) : (
                        <Button className="h-12 flex-1" onClick={() => { setPosting(d.id); setLiveUrl(""); }}><ExternalLink className="h-4 w-4" aria-hidden /> Mark posted</Button>
                      )}
                      <Button variant="outline" className="h-12" onClick={() => { setRejecting(d.id); setReason(""); }}><X className="h-4 w-4" aria-hidden /> Reject</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "inbound" && (
        <section aria-label="Inbound messages">
          <div className="mb-3 flex flex-wrap gap-2">
            {(["all", "TEAM", "BODY", "BUILD", "none"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kwFilter === k} onClick={() => setKwFilter(k)}
                className={cn("h-11 rounded-full border px-4 text-[15px] font-semibold", kwFilter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
                {k === "all" ? "All" : k === "none" ? "No keyword" : k}
              </button>
            ))}
          </div>
          {q.isLoading ? <Skeleton className="h-40 w-full" /> : inboundShown.length === 0 ? (
            <EmptyState icon={<MessageSquare />} variant="success" title="Inbox clear" description="No open message matches this filter." />
          ) : (
            <ul className="space-y-2">
              {inboundShown.map((r) => (
                <li key={r.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.keyword ? <TonePill tone={KEYWORD_BY_KEY[r.keyword].tone}>{r.keyword}</TonePill> : <TonePill tone="slate">No keyword</TonePill>}
                    <span className="text-[13px] text-muted-foreground">{r.platform ?? "unknown"} · {r.handle ?? "no handle"} · {r.ts.slice(0, 10)}</span>
                  </div>
                  <p className="mt-2 text-[15px]">{r.message || "No message text"}</p>
                  {r.keyword && <p className="mt-2 rounded-lg bg-muted/40 p-2 text-[15px] text-muted-foreground">{KEYWORD_BY_KEY[r.keyword].reply}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.keyword ? (
                      <Button className="h-12 flex-1" disabled={busy === r.id} onClick={() => r.keyword && void replyInbound(r, r.keyword)}>
                        {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Reply {r.keyword} and log
                      </Button>
                    ) : KEYWORDS.map((k) => (
                      <Button key={k.key} variant="outline" className="h-11" disabled={busy === r.id} onClick={() => void replyInbound(r, k.key)}>{k.key}</Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">One tap copies the saved reply, opens the thread, marks the message answered and logs the keyword DM. Sending inside the app stays by hand: Instagram automation is paused and YouTube has no DM API.</p>
        </section>
      )}

      {tab === "engine" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Engine />
        </Suspense>
      )}
    </div>
  );
}
