// Brand Command (MP-BRAND-ENGINE, 2026-11-12). Sam's one read on the personal brand: every weekly lane
// against its target, the 7-day funnel from views to offer sales, each account, what is working, and
// what is blocked. Every number is read from the database: brand_command_summary() for the lanes and
// funnel, brand_metrics_daily for the accounts, content_posts for the posts. A number that has no
// source yet says "no data yet"; nothing here is a placeholder.
//
// ?review=1 is the Sunday 4 PM weekly review: this week against last per lane, the accounts side by
// side, a copyable summary, and the two rules.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, ClipboardCopy, Crown, ExternalLink, Loader2, Plus, RefreshCw, Repeat2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  ACCOUNTS, FIVE_NUMBERS, LANE_TONE, LANE_WORD, REVIEW_RULES, accountLabel, addDaysKey, conversion, fmtNum, laneState, phoenixDay,
  pillarLabel, weekPace, type AccountKey, type Lane,
} from "@/lib/brand";

interface Summary {
  week_start: string;
  generated_at: string;
  lanes: Lane[];
  funnel: { key: string; label: string; value: number; prev: number }[];
  views_days_logged: number;
  post_sync_at: string | null;
}
interface MetricRow { metric_date: string; account: string; metric: string; value: number; source: string }
interface PostRow { id: number; platform: string; account: string | null; title: string | null; url: string | null; views: number | null; category: string | null; format: string; posted_at: string | null }
interface DmRow { post_url: string | null; keyword: string }
interface Blocker { id: number; title: string; description: string | null; fix_action: string | null; severity: string | null }

const METRICS = [
  { key: "views", label: "Views (that day)" },
  { key: "followers", label: "Followers (total)" },
  { key: "posts", label: "Posts (that day)" },
  { key: "body_sales", label: "Standard Body sales" },
  { key: "mentorship_sales", label: "Mentorship sales" },
];
const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]";
const INGEST_URL = "https://xrzweoneiieddzxogewk.supabase.co/functions/v1/brand-metrics-ingest";

async function fetchSummary(): Promise<Summary> {
  const { data, error } = await supabase.rpc("brand_command_summary");
  if (error) throw error;
  if (!data) throw new Error("Brand Command is for the owner's login.");
  return data as unknown as Summary;
}

async function fetchBoard() {
  const today = phoenixDay();
  const since = addDaysKey(today, -28);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [m, p, d, b] = await Promise.all([
    supabase.from("brand_metrics_daily").select("metric_date,account,metric,value,source").gte("metric_date", since).order("metric_date", { ascending: true }),
    supabase.from("content_posts").select("id,platform,account,title,url,views,category,format,posted_at").gte("posted_at", weekAgo).order("views", { ascending: false, nullsFirst: false }).limit(60),
    supabase.from("keyword_dm_log").select("post_url,keyword").gte("happened_at", weekAgo),
    supabase.from("social_bot_blockers").select("id,title,description,fix_action,severity").eq("status", "open").order("created_at", { ascending: false }),
  ]);
  if (m.error) throw m.error;
  if (p.error) throw p.error;
  if (d.error) throw d.error;
  if (b.error) throw b.error;
  return {
    metrics: (m.data ?? []) as MetricRow[],
    posts: (p.data ?? []) as PostRow[],
    dms: (d.data ?? []) as DmRow[],
    blockers: (b.data ?? []) as Blocker[],
  };
}

const postAccount = (p: PostRow): AccountKey | null =>
  p.platform === "youtube" ? "youtube" : p.platform === "instagram" ? "instagram" : p.platform === "tiktok" ? "tiktok-main" : null;

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-[13px] text-muted-foreground">No daily views yet</p>;
  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const path = points.map((v, i) => `${(i * step).toFixed(1)},${(28 - (v / max) * 26).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full text-tone-gold" role="img" aria-label={`Daily views, last ${points.length} logged days`}>
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="text-[13px] text-muted-foreground">no change</span>;
  const diff = now - before;
  const tone = diff > 0 ? "good" : diff < 0 ? "hot" : "slate";
  return <span className={cn("text-[13px] font-semibold", TONE_CLASS[tone].text)}>{diff > 0 ? "+" : ""}{fmtNum(diff)} vs last week</span>;
}

export default function BrandCommand() {
  usePageTitle("Brand Command");
  const [params, setParams] = useSearchParams();
  const review = params.get("review") === "1";
  const qc = useQueryClient();
  const [entryOpen, setEntryOpen] = useState(false);
  const [remaking, setRemaking] = useState<number | null>(null);

  const s = useQuery({ queryKey: ["brand-command", "summary"], queryFn: fetchSummary, staleTime: 60_000 });
  const b = useQuery({ queryKey: ["brand-command", "board"], queryFn: fetchBoard, staleTime: 60_000 });

  const pace = s.data ? weekPace(s.data.week_start) : 1;
  const lanes = useMemo(() => s.data?.lanes ?? [], [s.data]);
  const onTarget = lanes.filter((l) => laneState(l.value, l.target, pace) === "green").length;

  const accounts = useMemo(() => {
    const rows = b.data?.metrics ?? [];
    const posts = b.data?.posts ?? [];
    const today = phoenixDay();
    const d7 = addDaysKey(today, -7);
    const d14 = addDaysKey(today, -14);
    return ACCOUNTS.map((a) => {
      const mine = rows.filter((r) => r.account === a.key);
      const followers = mine.filter((r) => r.metric === "followers");
      const latest = followers[followers.length - 1];
      const earlier = [...followers].reverse().find((r) => r.metric_date <= d7);
      const views = mine.filter((r) => r.metric === "views");
      const sum = (from: string, to: string) => views.filter((r) => r.metric_date > from && r.metric_date <= to).reduce((n, r) => n + Number(r.value), 0);
      const logged = mine.filter((r) => r.metric === "posts" && r.metric_date > d7);
      const synced = posts.filter((p) => postAccount(p) === a.key).length;
      return {
        ...a,
        followers: latest ? Number(latest.value) : null,
        followersAsOf: latest?.metric_date ?? null,
        followersBefore: earlier ? Number(earlier.value) : null,
        views7: views.some((r) => r.metric_date > d7) ? sum(d7, today) : null,
        viewsPrev: sum(d14, d7),
        posts7: logged.length ? logged.reduce((n, r) => n + Number(r.value), 0) : synced,
        postsSource: logged.length ? "logged by hand" : "synced posts",
        spark: views.slice(-14).map((r) => Number(r.value)),
      };
    });
  }, [b.data]);

  const topByViews = useMemo(() => (b.data?.posts ?? []).filter((p) => (p.views ?? 0) > 0).slice(0, 5), [b.data]);
  const topByDms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of b.data?.dms ?? []) if (d.post_url) counts.set(d.post_url, (counts.get(d.post_url) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([url, n]) => ({ url, n, post: (b.data?.posts ?? []).find((p) => p.url === url) ?? null }));
  }, [b.data]);

  const remake = async (p: PostRow) => {
    setRemaking(p.id);
    const long = p.format === "long";
    const { error } = await supabase.from("content_cards").insert({
      title: `Remake: ${p.title ?? "untitled post"}`.slice(0, 180),
      hook: p.title ?? "",
      brand: long ? "YT" : "SH",
      content_type: long ? "long" : "short",
      job: "REACH",
      status: "idea",
      sort: Math.floor(Date.now() / 1000),
      brief: { remake_of: p.url, account: postAccount(p) ?? "", pillar: p.category ?? "", format: long ? "long-lesson" : "short", source_views: p.views ?? 0 },
    });
    setRemaking(null);
    if (error) { toast.error(`Could not create the card: ${error.message}`); return; }
    toast.success("Added to the Launch Board as an idea.");
  };

  const copySummary = async () => {
    if (!s.data) return;
    const lines = [
      `Week of ${s.data.week_start}: ${onTarget} of ${lanes.length} lanes on target`,
      ...lanes.map((l) => `${l.label}: ${fmtNum(l.value)} of ${fmtNum(l.target)} (last week ${fmtNum(l.prev)})`),
      "",
      "Funnel, last 7 days: " + s.data.funnel.map((f) => `${f.label} ${f.key === "views" && s.data.views_days_logged === 0 ? "no data" : fmtNum(f.value)}`).join(" > "),
      "",
      ...accounts.map((a) => `${a.label}: followers ${fmtNum(a.followers)}, views ${a.views7 == null ? "no data" : fmtNum(a.views7)}, posts ${fmtNum(a.posts7)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Summary copied.");
    } catch {
      toast.error("Copy was blocked by the browser. Select the text and copy it by hand.");
    }
  };

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["brand-command"] }); };
  const toggleReview = () => { const next = new URLSearchParams(params); if (review) next.delete("review"); else next.set("review", "1"); setParams(next, { replace: true }); };

  const five = FIVE_NUMBERS.map((k) => lanes.find((l) => l.key === k)).filter((l): l is Lane => !!l);
  const missedTwice = lanes.filter((l) => l.kind === "result" && l.value < l.target && l.prev < l.target);
  const outputMissed = lanes.filter((l) => l.kind === "output" && laneState(l.value, l.target, pace) !== "green");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Owner"
        icon={<Crown />}
        tone="gold"
        title={review ? "Weekly review" : "Brand Command"}
        subtitle={review ? "This week against last, account against account, then the two rules." : "Condition the man. Build the income. Every lane against its weekly target."}
        primaryAction={<Button className="h-11" onClick={() => setEntryOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Log a number</Button>}
        secondaryActions={
          <>
            <Button variant="outline" className="h-11" onClick={toggleReview}>{review ? "Back to the dashboard" : "Weekly review"}</Button>
            <Button variant="outline" className="h-11" onClick={refresh} aria-label="Refresh the numbers"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
          </>
        }
      />

      {s.isError && (
        <EmptyState variant="warning" icon={<AlertTriangle />} title="The scorecard did not load" description={(s.error as Error)?.message ?? "Try again."}
          actions={<Button variant="outline" className="h-11" onClick={refresh}>Try again</Button>} />
      )}

      {/* 1. Scorecard */}
      <section aria-labelledby="bc-score" className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="bc-score" className="text-lg font-bold tracking-tight">Scorecard</h2>
          {s.data && <p className="text-[15px] font-semibold"><span className="text-tone-gold">{onTarget} of {lanes.length}</span> lanes on target</p>}
        </div>
        {s.isLoading ? <Skeleton className="h-40 w-full" /> : s.data && (
          <>
            {!review && (
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {five.map((l) => {
                  const st = laneState(l.value, l.target, pace);
                  return (
                    <div key={l.key} className={cn("rounded-xl border bg-card p-3", TONE_CLASS[LANE_TONE[st]].border)}>
                      <p className="text-[13px] font-semibold text-muted-foreground">{l.label}</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums">{fmtNum(l.value)}<span className="text-base font-semibold text-muted-foreground"> / {fmtNum(l.target)}</span></p>
                      <TonePill tone={LANE_TONE[st]} dot className="mt-1">{LANE_WORD[st]}</TonePill>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              <ul className="divide-y divide-border/60">
                {lanes.map((l) => {
                  const st = laneState(l.value, l.target, pace);
                  const width = l.target > 0 ? Math.min(100, Math.round((l.value / l.target) * 100)) : 100;
                  return (
                    <li key={l.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">{l.label} <span className="font-normal text-muted-foreground">· {l.kind}</span></p>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div className={cn("h-full rounded-full", TONE_CLASS[LANE_TONE[st]].dot)} style={{ width: `${width}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[15px] font-bold tabular-nums">{fmtNum(l.value)} / {fmtNum(l.target)}</p>
                        <p className={cn("text-[13px] font-semibold", TONE_CLASS[LANE_TONE[st]].text)}>{LANE_WORD[st]}{review ? ` · last week ${fmtNum(l.prev)}` : ""}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Week of {s.data.week_start}, Arizona time. On target means at or ahead of where the week should be today. Applications count real applications only. Agency numbers are production, not income.
            </p>
          </>
        )}
      </section>

      {/* 2. Funnel */}
      {!review && s.data && (
        <section aria-labelledby="bc-funnel" className="mb-6">
          <h2 id="bc-funnel" className="mb-2 text-lg font-bold tracking-tight">Funnel, last 7 days</h2>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {s.data.funnel.map((f, i) => {
              const noViews = f.key === "views" && s.data.views_days_logged === 0;
              const before = i > 0 ? s.data.funnel[i - 1] : null;
              const beforeMissing = before?.key === "views" && s.data.views_days_logged === 0;
              const rate = before && !beforeMissing ? conversion(before.value, f.value) : null;
              return (
                <li key={f.key} className="rounded-xl border border-border/60 bg-card p-3">
                  <p className="text-[13px] font-semibold text-muted-foreground">{f.label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{noViews ? "–" : fmtNum(f.value)}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {noViews ? "no data yet" : i === 0 ? `prior 7 days ${fmtNum(f.prev)}` : rate == null ? "no rate yet" : `${rate}% of ${before?.label.toLowerCase()}`}
                  </p>
                </li>
              );
            })}
          </ol>
          {s.data.views_days_logged === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">Views have no data yet: no daily view count has been logged in the last 7 days. Log one with "Log a number", or send it from a Shortcut.</p>
          )}
        </section>
      )}

      {/* 3. Accounts */}
      <section aria-labelledby="bc-accounts" className="mb-6">
        <h2 id="bc-accounts" className="mb-2 text-lg font-bold tracking-tight">{review ? "Accounts side by side" : "Accounts"}</h2>
        {b.isLoading ? <Skeleton className="h-40 w-full" /> : b.isError ? (
          <p className="text-[15px] text-destructive">The account numbers did not load, so none are shown.</p>
        ) : review ? (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
            <table className="w-full min-w-[520px] text-left text-[15px]">
              <thead className="text-[13px] text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Account</th><th className="px-3 py-2 font-semibold">Followers</th><th className="px-3 py-2 font-semibold">Views 7d</th><th className="px-3 py-2 font-semibold">Prior 7d</th><th className="px-3 py-2 font-semibold">Posts 7d</th></tr></thead>
              <tbody className="divide-y divide-border/60">
                {accounts.map((a) => (
                  <tr key={a.key}>
                    <td className="px-3 py-2 font-semibold">{a.label}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(a.followers)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.views7 == null ? "no data yet" : fmtNum(a.views7)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.views7 == null ? "–" : fmtNum(a.viewsPrev)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(a.posts7)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <article key={a.key} className="rounded-xl border border-border/60 bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-bold">{a.label}</h3>
                    <p className="truncate text-[13px] text-muted-foreground">{a.handle}</p>
                  </div>
                  {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.label}`} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" aria-hidden /></a>}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div><dt className="text-[13px] text-muted-foreground">Followers</dt><dd className="text-lg font-bold tabular-nums">{fmtNum(a.followers)}</dd></div>
                  <div><dt className="text-[13px] text-muted-foreground">Views 7d</dt><dd className="text-lg font-bold tabular-nums">{a.views7 == null ? "–" : fmtNum(a.views7)}</dd></div>
                  <div><dt className="text-[13px] text-muted-foreground">Posts 7d</dt><dd className="text-lg font-bold tabular-nums">{fmtNum(a.posts7)}</dd></div>
                </dl>
                <div className="mt-2"><Sparkline points={a.spark} /></div>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {a.followers == null ? "No data yet. Log followers and views to start this card." : (
                    <>
                      {a.followersBefore != null ? <Delta now={a.followers} before={a.followersBefore} /> : "First reading"} · followers as of {a.followersAsOf} · posts from {a.postsSource}
                    </>
                  )}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 4. What's working */}
      {!review && (
        <section aria-labelledby="bc-working" className="mb-6">
          <h2 id="bc-working" className="mb-2 text-lg font-bold tracking-tight">What's working, last 7 days</h2>
          {b.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card p-3">
                <h3 className="mb-1 text-[15px] font-bold">Top 5 by views</h3>
                {topByViews.length === 0 ? (
                  <p className="text-[15px] text-muted-foreground">No data yet. No post from the last 7 days has a view count{s.data?.post_sync_at ? ` (posts last synced ${s.data.post_sync_at.slice(0, 10)})` : ""}.</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {topByViews.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold">{p.title ?? "Untitled post"}</p>
                          <p className="truncate text-[13px] text-muted-foreground">{fmtNum(p.views)} views · {accountLabel(postAccount(p))} · {pillarLabel(p.category)}</p>
                        </div>
                        <Button variant="outline" className="h-11 shrink-0" disabled={remaking === p.id} onClick={() => void remake(p)}>
                          {remaking === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat2 className="h-4 w-4" aria-hidden />} Remake this
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-border/60 bg-card p-3">
                <h3 className="mb-1 text-[15px] font-bold">Top 5 by keyword DMs</h3>
                {topByDms.length === 0 ? (
                  <p className="text-[15px] text-muted-foreground">No data yet. A keyword DM counts here once it is logged with the post it came from.</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {topByDms.map((d) => (
                      <li key={d.url} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold">{d.post?.title ?? d.url}</p>
                          <p className="truncate text-[13px] text-muted-foreground">{d.n} keyword DM{d.n === 1 ? "" : "s"}{d.post ? ` · ${pillarLabel(d.post.category)}` : ""}</p>
                        </div>
                        {d.post && (
                          <Button variant="outline" className="h-11 shrink-0" disabled={remaking === d.post.id} onClick={() => d.post && void remake(d.post)}>
                            <Repeat2 className="h-4 w-4" aria-hidden /> Remake this
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5. Blockers */}
      {!review && (
        <section aria-labelledby="bc-blockers" className="mb-6">
          <h2 id="bc-blockers" className="mb-2 text-lg font-bold tracking-tight">Blockers</h2>
          {b.isLoading ? <Skeleton className="h-24 w-full" /> : (b.data?.blockers.length ?? 0) === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">Nothing is blocked.</p>
          ) : (
            <ul className="space-y-2">
              {b.data?.blockers.map((x) => (
                <li key={x.id} className={cn("rounded-xl border bg-card p-3", TONE_CLASS.warm.border)}>
                  <p className="text-[15px] font-bold">{x.title}</p>
                  {x.description && <p className="mt-1 text-[15px] text-muted-foreground">{x.description}</p>}
                  {x.fix_action && <p className="mt-1 flex items-start gap-1.5 text-[15px]"><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-tone-gold" aria-hidden /> {x.fix_action}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Review: the two rules */}
      {review && s.data && (
        <section aria-labelledby="bc-rules" className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="bc-rules" className="text-lg font-bold tracking-tight">The two rules</h2>
            <Button className="h-11" onClick={() => void copySummary()}><ClipboardCopy className="h-4 w-4" aria-hidden /> Copy summary</Button>
          </div>
          <div className="space-y-2">
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <p className="text-[15px] font-bold">1. {REVIEW_RULES[0]}</p>
              <p className="mt-1 text-[15px] text-muted-foreground">
                {missedTwice.length === 0 ? "No result lane has missed two weeks running." : `Missed this week and last: ${missedTwice.map((l) => l.label).join(", ")}.`}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <p className="text-[15px] font-bold">2. {REVIEW_RULES[1]}</p>
              <p className="mt-1 text-[15px] text-muted-foreground">
                {outputMissed.length === 0 ? "Every output lane is on target." : `Output behind: ${outputMissed.map((l) => l.label).join(", ")}.`}
              </p>
            </div>
          </div>
        </section>
      )}

      <QuickEntry open={entryOpen} onOpenChange={setEntryOpen} onSaved={refresh} />
    </div>
  );
}

function QuickEntry({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [account, setAccount] = useState<string>(ACCOUNTS[0].key);
  const [metric, setMetric] = useState("views");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(phoenixDay());
  const [saving, setSaving] = useState(false);
  const key = useQuery({
    queryKey: ["brand-command", "ingest-key"],
    enabled: open,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("system_settings").select("value").eq("key", "brand_ingest_key").maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },
  });

  const save = async () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) { toast.error("Enter a number, 0 or more."); return; }
    setSaving(true);
    const { error } = await supabase.from("brand_metrics_daily")
      .upsert({ metric_date: day, account, metric, value: n, source: "manual", updated_at: new Date().toISOString() }, { onConflict: "metric_date,account,metric" });
    setSaving(false);
    if (error) { toast.error(`Not saved: ${error.message}`); return; }
    toast.success(`Saved ${accountLabel(account)} ${metric} for ${day}.`);
    setValue("");
    onSaved();
  };

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); }
    catch { toast.error("Copy was blocked by the browser."); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log a number</SheetTitle>
          <SheetDescription>Any metric, any account. Saving the same day again replaces that day's number.</SheetDescription>
        </SheetHeader>
        <div className="mx-auto mt-3 grid w-full max-w-md gap-3">
          <label className="grid gap-1 text-[15px] font-semibold">Account
            <select className={SELECT_CLASS} value={account} onChange={(e) => setAccount(e.target.value)}>
              {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">Metric
            <select className={SELECT_CLASS} value={metric} onChange={(e) => setMetric(e.target.value)}>
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">Number
            <Input className="h-11 text-[16px]" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">Day
            <Input className="h-11 text-[16px]" type="date" value={day} max={phoenixDay()} onChange={(e) => setDay(e.target.value)} />
          </label>
          <Button className="h-12" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save</Button>

          <div className="mt-2 rounded-xl border border-border/60 p-3">
            <p className="text-[15px] font-bold">Bots and iOS Shortcuts</p>
            <p className="mt-1 text-[13px] text-muted-foreground">POST JSON with account, metric, value and metric_date to the address below, with the key in an x-brand-key header.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" onClick={() => void copy(INGEST_URL, "Address")}>Copy address</Button>
              <Button variant="outline" className="h-11" disabled={!key.data} onClick={() => key.data && void copy(key.data, "Key")}>{key.isLoading ? "Loading key" : key.data ? "Copy key" : "Key unavailable"}</Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
