// Social Command Center (MP-308, 2026-10-28). Sam: "a dashboard to review prioritized messages as a
// full command center, a full dashboard of conversions and overall all-platform metrics to see what
// works and pulls applications, and metrics to make sure this never happens again (tokens ending,
// webhooks not working)". One read, social_command_center(), gated to Sam + Aisha like Sold Calls:
// every lane's liveness with its fix, the 30-day funnel per platform, what pulled applications in 90
// days, the prioritized inbox across Instagram / TikTok / YouTube, and the content queue with one-tap
// approve. The 30-minute lane alarm (fn_social_lane_alert) pages Sam on the same view this page shows.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Archive, CheckCircle2, Download, ExternalLink, Loader2, Search, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import {
  BUCKET_LABEL, BUCKET_ORDER, BUCKET_TONE, LANE_TONE, SOCIAL_COMMAND_KEY, bucketCounts, filterInbox, fmtWhen, groupDrafts, laneLink, laneStatus, num, pct,
  platformLabel, poolSummary, profileHref, replyRate, sortLanes,
  type Bucket, type CommandCenterPayload, type DraftRow, type InboxRow,
} from "@/lib/socialCommand";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

async function fetchCommandCenter(): Promise<CommandCenterPayload> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)("social_command_center");
  if (error) throw new Error(error.message);
  return (data ?? { inbox: [], funnel: [], pulls: [], lanes: [], drafts: [], generated_at: "" }) as CommandCenterPayload;
}

const PLATFORMS = ["all", "instagram", "tiktok", "youtube"] as const;

export default function SocialCommandCenter() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Social Command Center");
  const q = useQuery({ queryKey: [SOCIAL_COMMAND_KEY], queryFn: fetchCommandCenter, staleTime: 60_000, refetchInterval: 5 * 60_000, enabled: canView });

  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(60);

  const inbox = useMemo(() => q.data?.inbox ?? [], [q.data]);
  const counts = useMemo(() => bucketCounts(inbox), [inbox]);
  const visible = useMemo(() => filterInbox(inbox, bucket, platform, search), [inbox, bucket, platform, search]);
  const lanes = useMemo(() => sortLanes(q.data?.lanes ?? []), [q.data]);
  const deadLanes = lanes.filter((l) => l.verdict !== "alive").length;

  if (!canView) {
    return <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">This page is restricted.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Grow"
        title="Social Command Center"
        subtitle="Every platform in one place: who to answer first, what to post, what actually pulls applications, and which lane is dead."
      />

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={`sc-sk-${i}`} className="h-40 w-full rounded-xl" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load the command center" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : (
        <>
          {/* Lanes: the "never again" strip. Dead first, each with its fix. */}
          <section className="mb-4 rounded-xl border border-border bg-card p-4" aria-label="Lane health">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><Activity className="h-4 w-4" aria-hidden /> Lanes</h2>
              <p className="text-sm text-muted-foreground">
                {deadLanes === 0 ? "Every lane is alive." : `${deadLanes} of ${lanes.length} lanes need a fix.`}
                {" "}The alarm runs every 30 minutes and pages Sam when a lane marked "pages Sam" dies, then once a day until it is fixed.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lanes.map((l) => {
                const href = l.verdict === "dead" ? laneLink(l.lane, q.data?.youtube_reconnect_url) : null;
                return (
                  <li key={l.lane} className={cn("rounded-lg border px-3 py-2 text-sm", LANE_TONE[l.verdict])}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{l.lane.replace(/_/g, " ")}</span>
                      <span className="text-xs tabular-nums">{laneStatus(l)}</span>
                    </div>
                    <p className="mt-0.5 text-xs opacity-80">{l.owner} · {l.tier === "page" ? "pages Sam" : "report only"}</p>
                    {l.verdict !== "alive" && l.fix && (
                      <p className="mt-1 text-xs font-medium">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                            Reconnect YouTube (Google consent, as the channel owner) <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : null}
                        {href ? <span className="block opacity-90">{l.fix}</span> : l.fix}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {q.data?.alarm?.checked_at
                ? `Alarm last ran ${fmtWhen(q.data.alarm.checked_at)}${q.data.alarm.last_alert_at ? `; last page ${fmtWhen(q.data.alarm.last_alert_at)}: ${q.data.alarm.last_alert_subject ?? ""}` : "; it has not had to page yet"}.`
                : "The alarm has not run yet."}
            </p>
          </section>

          {/* Call lists the brain keeps warm: old applicants for ReadyMode, former agents to bring back */}
          <section className="mb-4 rounded-xl border border-border bg-card p-4" aria-label="Call lists">
            <h2 className="text-lg font-bold text-foreground">Call lists</h2>
            <p className="text-sm text-muted-foreground">Built live from the application book and the roster, minus Do Not Call numbers, bad phones and anyone already on the team. Download, load into ReadyMode, dial.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              <li className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="font-semibold text-foreground">ReadyMode: old applicants</p>
                <p className="text-xs text-muted-foreground">{poolSummary(q.data?.pools).readymode || "Not available"}</p>
                {q.data?.pools?.readymode_csv_url && (
                  <a href={q.data.pools.readymode_csv_url} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted">
                    <Download className="h-4 w-4" aria-hidden /> Download CSV
                  </a>
                )}
              </li>
              <li className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="font-semibold text-foreground">Win-back: former agents</p>
                <p className="text-xs text-muted-foreground">{poolSummary(q.data?.pools).winback || "Not available"}</p>
                {q.data?.pools?.winback_csv_url && (
                  <a href={q.data.pools.winback_csv_url} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted">
                    <Download className="h-4 w-4" aria-hidden /> Download CSV
                  </a>
                )}
              </li>
            </ul>
          </section>

          {/* Conversions per platform, 30 days */}
          <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card" aria-label="Conversions by platform">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-lg font-bold text-foreground">Last 30 days, by platform</h2>
              <p className="text-sm text-muted-foreground">Posts and views from the content log, people who wrote in and how many got a reply, abandoned applications, finished applications, licensed, booked or further.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {["Platform", "Posts", "Views", "Wrote in", "Replied", "Reply rate", "Abandoned", "Applications", "Licensed", "Booked+"].map((h) => (
                      <th key={h} className={cn("px-3 py-2 font-semibold", h !== "Platform" && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.funnel ?? []).map((f) => (
                    <tr key={f.platform} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-foreground">{platformLabel(f.platform)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.posts)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.views)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.people_in)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.people_replied)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", (replyRate(f) ?? 1) < 0.5 && f.people_in > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{pct(replyRate(f))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.partials_abandoned)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{num(f.applications)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.licensed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(f.booked_or_further)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* What pulls applications, 90 days */}
          <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card" aria-label="What pulls applications">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-lg font-bold text-foreground">What pulls applications (90 days)</h2>
              <p className="text-sm text-muted-foreground">By platform and campaign / landing page. "Untracked" means the application carried no source at all.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Platform</th><th className="px-3 py-2 font-semibold">Lever</th>
                    <th className="px-3 py-2 text-right font-semibold">Applications</th><th className="px-3 py-2 text-right font-semibold">Last 30d</th>
                    <th className="px-3 py-2 text-right font-semibold">Licensed</th><th className="px-3 py-2 text-right font-semibold">Booked+</th><th className="px-3 py-2 font-semibold">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.pulls ?? []).map((w) => (
                    <tr key={`${w.platform}|${w.lever}`} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-foreground">{platformLabel(w.platform)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{w.lever}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{num(w.applications)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(w.last_30d)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(w.licensed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(w.booked_or_further)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{w.last_application ? new Date(w.last_application).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Prioritized messages */}
          <section className="mb-4 rounded-xl border border-border bg-card" aria-label="Prioritized messages">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-lg font-bold text-foreground">Messages, hottest first</h2>
              <p className="text-sm text-muted-foreground">Instagram DMs, TikTok comments and YouTube comments from the last 30 days, one row per person. Hot = business intent nobody has answered.</p>
            </header>
            <div className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Bucket">
                <Button size="sm" variant={bucket === "all" ? "default" : "outline"} aria-pressed={bucket === "all"} onClick={() => { setBucket("all"); setShown(60); }}>All open</Button>
                {BUCKET_ORDER.map((b) => (
                  <Button key={b} size="sm" variant={bucket === b ? "default" : "outline"} aria-pressed={bucket === b} onClick={() => { setBucket(b); setShown(60); }}>
                    {BUCKET_LABEL[b]} <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", bucket === b ? "bg-background/20" : "bg-muted")}>{counts[b]}</span>
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform">
                  {PLATFORMS.map((p) => (
                    <Button key={p} size="sm" variant={platform === p ? "default" : "outline"} aria-pressed={platform === p} onClick={() => { setPlatform(p); setShown(60); }}>
                      {p === "all" ? "All platforms" : platformLabel(p)}
                    </Button>
                  ))}
                </div>
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); setShown(60); }} placeholder="Search handle, name, text or intent" aria-label="Search messages" className="h-9 pl-9" />
                </div>
              </div>
              {visible.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing here" description="Nobody matches these filters." />
              ) : (
                <>
                  <ul className="divide-y divide-border/60">
                    {visible.slice(0, shown).map((r) => <MessageRow key={`${r.source}|${r.sender_handle}`} r={r} />)}
                  </ul>
                  {shown < visible.length && (
                    <Button variant="outline" className="h-10 w-full" onClick={() => setShown((n) => n + 60)}>Show {Math.min(60, visible.length - shown)} more</Button>
                  )}
                </>
              )}
            </div>
          </section>

          <DraftsQueue drafts={q.data?.drafts ?? []} />

          <p className="mt-4 text-xs text-muted-foreground">
            Data as of {fmtWhen(q.data?.generated_at)} (Phoenix). Messages come from inbox_messages; funnel sources from the application's UTM or referrer; "Booked+" is any application at interview, contracting, paid or onboarding.
          </p>
        </>
      )}
    </div>
  );
}

function MessageRow({ r }: { r: InboxRow }) {
  const href = profileHref(r);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5" aria-label={`${BUCKET_LABEL[r.bucket]}: ${r.sender_handle}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", BUCKET_TONE[r.bucket])}>{BUCKET_LABEL[r.bucket]}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{platformLabel(r.source)}</span>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline-offset-2 hover:underline">{r.sender_name || r.sender_handle}</a>
          ) : (
            <span className="font-semibold text-foreground">{r.sender_name || r.sender_handle}</span>
          )}
          {r.last_intent && <span className="text-xs text-muted-foreground">{r.last_intent.replace(/_/g, " ")}</span>}
          {r.application_status && <span className="text-xs text-muted-foreground">application: {r.application_status}</span>}
        </div>
        {r.last_text && <p className="mt-0.5 truncate text-sm text-foreground">{r.last_text}</p>}
      </div>
      <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        <div>{r.last_in ? formatTimeAgo(r.last_in) : ""}</div>
        <div>{r.inbound_count} in{r.last_out ? ` · last reply ${formatTimeAgo(r.last_out)}` : " · no reply yet"}</div>
      </div>
    </li>
  );
}

function DraftsQueue({ drafts }: { drafts: DraftRow[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const groups = useMemo(() => groupDrafts(drafts), [drafts]);
  async function setStatus(d: DraftRow, status: "approved" | "archived" | "rejected") {
    setBusy(d.id);
    const { error } = await (supabase.rpc as unknown as Rpc)("social_draft_set_status", { p_id: d.id, p_status: status });
    setBusy(null);
    if (error) { toast.error(`Could not update draft: ${error.message}`); return; }
    toast.success(`${d.title ?? "Draft"}: ${status}`);
    await qc.invalidateQueries({ queryKey: [SOCIAL_COMMAND_KEY] });
  }
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Content queue">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-bold text-foreground">Content queue</h2>
        <p className="text-sm text-muted-foreground">{drafts.length} drafts waiting. Approve means the content engine may schedule it; nothing posts unapproved.</p>
      </header>
      {groups.length === 0 ? (
        <div className="px-4 py-6"><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Queue is empty" description="The Monday content run will fill it." /></div>
      ) : (
        <div className="divide-y divide-border px-4">
          {groups.map((g) => (
            <div key={g.platform} className="py-3">
              <h3 className="mb-2 text-sm font-bold text-foreground">{platformLabel(g.platform)} <span className="font-normal text-muted-foreground">· {g.drafts.length}</span></h3>
              <ul className="space-y-2">
                {g.drafts.slice(0, 12).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{d.title || d.hook || "Untitled draft"}</p>
                      <p className="text-xs text-muted-foreground">{[d.status.replace(/_/g, " "), d.pillar, d.slot, d.draft_date].filter(Boolean).join(" · ")}</p>
                      {d.hook && d.title && <p className="mt-0.5 text-sm text-muted-foreground">{d.hook}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {d.status !== "approved" && (
                        <Button size="sm" variant="default" disabled={busy === d.id} onClick={() => setStatus(d, "approved")} aria-label={`Approve ${d.title ?? "draft"}`}>
                          {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />} Approve
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => setStatus(d, "archived")} aria-label={`Archive ${d.title ?? "draft"}`}>
                        <Archive className="mr-1 h-4 w-4" aria-hidden /> Archive
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => setStatus(d, "rejected")} aria-label={`Reject ${d.title ?? "draft"}`}>
                        <XCircle className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
                {g.drafts.length > 12 && <li className="text-xs text-muted-foreground">+{g.drafts.length - 12} more {platformLabel(g.platform)} drafts in the queue</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
