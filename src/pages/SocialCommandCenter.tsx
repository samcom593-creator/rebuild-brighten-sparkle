// Social Command Center (MP-308, 2026-10-28). Sam: "a dashboard to review prioritized messages as a
// full command center, a full dashboard of conversions and overall all-platform metrics to see what
// works and pulls applications, and metrics to make sure this never happens again (tokens ending,
// webhooks not working)". One read, social_command_center(), gated to Sam + Aisha like Sold Calls:
// every lane's liveness with its fix, the 30-day funnel per platform, what pulled applications in 90
// days, the prioritized inbox across Instagram / TikTok / YouTube, and the content queue with one-tap
// approve. The 30-minute lane alarm (fn_social_lane_alert) pages Sam on the same view this page shows.
//
// Colour, motion and sound layer (2026-10-28, docs/DESIGN_SYSTEM.md "Colour, motion and sound"):
// the four buckets that need a hand are tiles that open exactly the rows they count; every bucket,
// lane verdict and platform keeps its one tone from src/lib/tones.ts with the word beside it; lists
// rise once; a draft approved celebrates from the button pressed, after the save succeeded. Same
// read, same RPCs, same predicates and labels as before.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Archive, CalendarCheck, CheckCircle2, Clock, Download, ExternalLink, Flame, Ghost, Instagram, Link2, Loader2, Music2,
  PhoneCall, Radio, RefreshCw, RotateCcw, Search, ShieldAlert, UserRound, XCircle, Youtube, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { RevealList } from "@/components/ui/delight/Reveal";
import { celebrate, prefersReducedMotion } from "@/lib/celebrate";
import { formatTimeAgo } from "@/lib/dateUtils";
import { TONE_CLASS, inboxBucketTone, laneTone, platformTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  BUCKET_HINT, BUCKET_LABEL, SOCIAL_COMMAND_KEY, bucketCounts, filterInbox, fmtWhen, groupDrafts, laneLink, laneStatus, laneVerdictLabel, num, pct,
  platformLabel, poolSummary, profileHref, replyRate, replyRateTone, sortLanes,
  type Bucket, type CommandCenterPayload, type DraftRow, type InboxRow, type LaneRow,
} from "@/lib/socialCommand";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

async function fetchCommandCenter(): Promise<CommandCenterPayload> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)("social_command_center");
  if (error) throw new Error(error.message);
  return (data ?? { inbox: [], funnel: [], pulls: [], lanes: [], drafts: [], generated_at: "" }) as CommandCenterPayload;
}

const PLATFORMS = ["all", "instagram", "tiktok", "youtube"] as const;
type PlatformFilter = (typeof PLATFORMS)[number];

/** The four buckets someone has to act on get a tile; "All open", "Answered" and "Silent by design" are chips under them. */
const TILE_BUCKETS: { bucket: Bucket; icon: ReactNode }[] = [
  { bucket: "hot", icon: <Flame /> },
  { bucket: "waiting", icon: <Clock /> },
  { bucket: "booked", icon: <CalendarCheck /> },
  { bucket: "human_lane", icon: <UserRound /> },
];
const CHIP_BUCKETS: Bucket[] = ["answered", "silent"];

const PLATFORM_ICON: Record<string, LucideIcon> = { instagram: Instagram, tiktok: Music2, youtube: Youtube, snapchat: Ghost, bio_link: Link2 };

export default function SocialCommandCenter() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Social Command Center");
  const q = useQuery({ queryKey: [SOCIAL_COMMAND_KEY], queryFn: fetchCommandCenter, staleTime: 60_000, refetchInterval: 5 * 60_000, enabled: canView });

  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(60);
  const messagesRef = useRef<HTMLElement | null>(null);

  const inbox = useMemo(() => q.data?.inbox ?? [], [q.data]);
  const counts = useMemo(() => bucketCounts(inbox), [inbox]);
  const visible = useMemo(() => filterInbox(inbox, bucket, platform, search), [inbox, bucket, platform, search]);
  const lanes = useMemo(() => sortLanes(q.data?.lanes ?? []), [q.data]);
  const deadLanes = lanes.filter((l) => l.verdict !== "alive").length;
  const laneHealth: Tone = lanes.some((l) => l.verdict === "dead") ? "hot" : lanes.some((l) => l.verdict === "never") ? "warm" : "good";
  // "All open" is every row except the silent-by-design ones: the same rule filterInbox applies to "all".
  const openCount = inbox.length - counts.silent;
  // While the read is loading or failed the numbers are withheld (a dash), never shown as 0.
  const unknown = q.isLoading || q.isError;

  function chooseBucket(next: Bucket | "all") {
    setBucket(next);
    setShown(60);
  }
  /** A tile or chip at the top picks the list far below it, so bring that list into view. */
  function pickBucket(next: Bucket | "all") {
    chooseBucket(next);
    messagesRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  if (!canView) {
    return <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">This page is restricted.</div>;
  }

  const pools = poolSummary(q.data?.pools);
  const bucketWord = bucket === "all" ? "All open" : BUCKET_LABEL[bucket];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Grow"
        icon={<Radio />}
        tone="royal"
        title="Social Command Center"
        subtitle="Who to answer first, and which lane is dead."
      />

      <GrowScoreboard
        label="Message numbers"
        className="mb-3"
        notice={q.isError ? (
          <>
            <span className="text-destructive">The command center did not load, so the numbers are hidden rather than shown as 0.</span>
            <Button variant="outline" className="h-11 shrink-0" onClick={() => void q.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Try again
            </Button>
          </>
        ) : q.isLoading ? (
          <span>Loading the messages. Each number shows a dash until it arrives.</span>
        ) : null}
        tiles={TILE_BUCKETS.map(({ bucket: b, icon }) => ({
          label: BUCKET_LABEL[b],
          value: unknown ? null : counts[b],
          hint: BUCKET_HINT[b],
          onSelect: () => pickBucket(b),
          active: bucket === b,
          emphasis: b === "hot",
          tone: inboxBucketTone(b),
          icon,
        }))}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Bucket">
        <span className="text-sm text-muted-foreground">Also:</span>
        <Chip label="All open" count={unknown ? null : openCount} active={bucket === "all"} onPick={() => pickBucket("all")} />
        {CHIP_BUCKETS.map((b) => (
          <Chip key={b} label={BUCKET_LABEL[b]} count={unknown ? null : counts[b]} active={bucket === b} onPick={() => pickBucket(b)} />
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={`sc-sk-${i}`} className="h-40 w-full rounded-xl" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load the command center" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : (
        <>
          {/* Lanes: the "never again" strip. Dead first, each with its fix. */}
          <section className="mb-4 rounded-xl border border-border bg-card p-4" aria-label="Lane health">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2.5 text-xl font-bold text-foreground">
                <ToneBubble tone={laneHealth} size="sm"><Activity /></ToneBubble> Lanes
              </h2>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {deadLanes === 0 ? (
                  <span className="inline-flex items-center gap-2 font-medium text-tone-good">
                    <span aria-hidden="true" className="apex-breathe inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-tone-good" />
                    Every lane is alive.
                  </span>
                ) : (
                  <span className="font-medium text-tone-hot">{deadLanes} of {lanes.length} lanes need a fix.</span>
                )}
                <span>The alarm runs every 30 minutes and pages Sam when a lane marked "pages Sam" dies, then once a day until it is fixed.</span>
              </p>
            </div>
            <RevealList as="ul" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lanes.map((l) => (
                <LaneCard key={l.lane} lane={l} href={l.verdict === "dead" ? laneLink(l.lane, q.data?.youtube_reconnect_url) : null} />
              ))}
            </RevealList>
            <p className="mt-3 text-xs text-muted-foreground">
              {q.data?.alarm?.checked_at
                ? `Alarm last ran ${fmtWhen(q.data.alarm.checked_at)}${q.data.alarm.last_alert_at ? `; last page ${fmtWhen(q.data.alarm.last_alert_at)}: ${q.data.alarm.last_alert_subject ?? ""}` : "; it has not had to page yet"}.`
                : "The alarm has not run yet."}
            </p>
          </section>

          {/* Call lists the brain keeps warm: old applicants for ReadyMode, former agents to bring back */}
          <section className="mb-4 rounded-xl border border-border bg-card p-4" aria-label="Call lists">
            <h2 className="text-xl font-bold text-foreground">Call lists</h2>
            <p className="text-sm text-muted-foreground">Built live from the application book and the roster, minus Do Not Call numbers, bad phones and anyone already on the team. Download, load into ReadyMode, dial.</p>
            <RevealList as="ul" className="mt-3 grid gap-2 sm:grid-cols-2">
              <PoolCard tone="cool" icon={<PhoneCall />} title="ReadyMode: old applicants" summary={pools.readymode || "Not available"} csvUrl={q.data?.pools?.readymode_csv_url} />
              <PoolCard tone="warm" icon={<RotateCcw />} title="Win-back: former agents" summary={pools.winback || "Not available"} csvUrl={q.data?.pools?.winback_csv_url} />
            </RevealList>
          </section>

          {/* Conversions per platform, 30 days */}
          <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card" aria-label="Conversions by platform">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-xl font-bold text-foreground">Last 30 days, by platform</h2>
              <p className="text-sm text-muted-foreground">Posts and views from the content log, people who wrote in and how many got a reply, abandoned applications, finished applications, licensed, booked or further.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {["Platform", "Posts", "Views", "Wrote in", "Replied", "Reply rate", "Abandoned", "Applications", "Licensed", "Booked+"].map((h) => (
                      <th key={h} className={cn("px-3 py-2 font-semibold", h !== "Platform" && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.funnel ?? []).map((f) => {
                    const rate = replyRate(f);
                    return (
                      <tr key={f.platform} className="border-b border-border/60 last:border-b-0">
                        <td className="px-3 py-2"><PlatformMark platform={f.platform} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.posts)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.views)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.people_in)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.people_replied)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <TonePill tone={replyRateTone(f)} className="whitespace-nowrap">{rate == null ? "Nobody wrote in" : pct(rate)}</TonePill>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.partials_abandoned)}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">{num(f.applications)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.licensed)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(f.booked_or_further)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* What pulls applications, 90 days */}
          <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card" aria-label="What pulls applications">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-xl font-bold text-foreground">What pulls applications (90 days)</h2>
              <p className="text-sm text-muted-foreground">By platform and campaign / landing page. "Untracked" means the application carried no source at all.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Platform</th><th className="px-3 py-2 font-semibold">Lever</th>
                    <th className="px-3 py-2 text-right font-semibold">Applications</th><th className="px-3 py-2 text-right font-semibold">Last 30d</th>
                    <th className="px-3 py-2 text-right font-semibold">Licensed</th><th className="px-3 py-2 text-right font-semibold">Booked+</th><th className="px-3 py-2 font-semibold">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.pulls ?? []).map((w) => {
                    const untracked = w.platform === "untracked";
                    return (
                      <tr key={`${w.platform}|${w.lever}`} className={cn("border-b border-border/60 last:border-b-0", untracked && "text-muted-foreground")}>
                        <td className="px-3 py-2"><PlatformMark platform={w.platform} muted={untracked} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{w.lever}</td>
                        <td className={cn("px-3 py-2 text-right font-bold tabular-nums", !untracked && "text-foreground")}>{num(w.applications)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(w.last_30d)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(w.licensed)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(w.booked_or_further)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{w.last_application ? new Date(w.last_application).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Prioritized messages */}
          {/* scroll-mt clears the shell's fixed top bar (61px on phones, 60px on desktop) when a tile brings this section into view. */}
          <section ref={messagesRef} className="mb-4 scroll-mt-20 rounded-xl border border-border bg-card" aria-label="Prioritized messages">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-xl font-bold text-foreground">Messages, hottest first</h2>
              <p className="text-sm text-muted-foreground">Instagram DMs, TikTok comments and YouTube comments from the last 30 days, one row per person. Hot = business intent nobody has answered.</p>
            </header>
            <div className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Platform">
                  {PLATFORMS.map((p) => (
                    <Chip key={p} label={p === "all" ? "All platforms" : platformLabel(p)} active={platform === p} onPick={() => { setPlatform(p); setShown(60); }} />
                  ))}
                </div>
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); setShown(60); }} placeholder="Search handle, name, text or intent" aria-label="Search messages" className="h-11 pl-10 text-base md:text-base" />
                </div>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{visible.length.toLocaleString()}</span> {visible.length === 1 ? "person" : "people"} shown · {bucketWord}
                  {platform !== "all" ? ` · ${platformLabel(platform)}` : ""}
                  {search.trim() ? ` · matching "${search.trim()}"` : ""}
                </span>
                {bucket !== "all" && (
                  <Button variant="ghost" className="h-11" onClick={() => chooseBucket("all")}>Show all open</Button>
                )}
              </p>
              {visible.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing here" description="Nobody matches these filters." />
              ) : (
                <>
                  <RevealList as="ul" className="divide-y divide-border/60">
                    {visible.slice(0, shown).map((r) => <MessageRow key={`${r.source}|${r.sender_handle}`} r={r} />)}
                  </RevealList>
                  {shown < visible.length && (
                    <Button variant="outline" className="h-11 w-full" onClick={() => setShown((n) => n + 60)}>Show {Math.min(60, visible.length - shown)} more</Button>
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

/**
 * A 44px filter chip that says whether it is picked. With `count` it is a list's number: a figure,
 * or a dash while the read is loading or failed, when it is also disabled, so a dash is never a
 * button that opens an empty list.
 */
function Chip({ label, count, active, onPick }: { label: string; count?: number | null; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={count === null}
      onClick={onPick}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:opacity-60",
        active ? "border-primary/60 bg-primary/15 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/50",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", active ? "bg-primary/20" : "bg-muted")}>{count === null ? "—" : count.toLocaleString()}</span>
      )}
    </button>
  );
}

/** A platform's icon in its tone (Instagram royal, TikTok cool, YouTube hot; anything unknown slate), decorative beside the name. */
function PlatformBubble({ platform }: { platform: string | null | undefined }) {
  const Icon = PLATFORM_ICON[(platform ?? "").trim().toLowerCase()];
  return (
    <ToneBubble tone={platformTone(platform)} size="sm">
      {Icon ? <Icon /> : <span className="text-[13px] font-bold leading-none">{platformLabel(platform).charAt(0).toUpperCase()}</span>}
    </ToneBubble>
  );
}

function PlatformMark({ platform, muted = false }: { platform: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PlatformBubble platform={platform} />
      <span className={cn("font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{platformLabel(platform)}</span>
    </span>
  );
}

function LaneCard({ lane: l, href }: { lane: LaneRow; href: string | null }) {
  const tone = laneTone(l.verdict);
  const Icon = l.verdict === "alive" ? Activity : l.verdict === "dead" ? AlertTriangle : Clock;
  return (
    <li className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", TONE_CLASS[tone].border)}>
      <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-base font-semibold text-foreground">{l.lane.replace(/_/g, " ")}</span>
          <TonePill tone={tone}>{laneVerdictLabel(l.verdict)}</TonePill>
        </div>
        <p className="text-sm tabular-nums text-foreground">{laneStatus(l)}</p>
        <p className="text-xs text-muted-foreground">{l.owner} · {l.tier === "page" ? "pages Sam" : "report only"}</p>
        {l.verdict !== "alive" && l.fix && (
          <p className="mt-1 text-sm font-medium text-foreground">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
                Reconnect YouTube (Google consent, as the channel owner) <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              </a>
            ) : null}
            {href ? <span className="block">{l.fix}</span> : l.fix}
          </p>
        )}
      </div>
    </li>
  );
}

function PoolCard({ tone, icon, title, summary, csvUrl }: { tone: Tone; icon: ReactNode; title: string; summary: string; csvUrl?: string | null }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border px-3 py-3">
      <ToneBubble tone={tone}>{icon}</ToneBubble>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{summary}</p>
        {csvUrl && (
          <a
            href={csvUrl}
            aria-label={`Download CSV, ${title}`}
            className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          >
            <Download className="h-4 w-4" aria-hidden /> Download CSV
          </a>
        )}
      </div>
    </li>
  );
}

function MessageRow({ r }: { r: InboxRow }) {
  const href = profileHref(r);
  const name = r.sender_name || r.sender_handle;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5" aria-label={`${BUCKET_LABEL[r.bucket]}: ${r.sender_handle}`}>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-11 flex-wrap items-center gap-2">
          <TonePill tone={inboxBucketTone(r.bucket)}>{BUCKET_LABEL[r.bucket]}</TonePill>
          <TonePill tone={platformTone(r.source)}>{platformLabel(r.source)}</TonePill>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-base font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">{name}</a>
          ) : (
            <span className="text-base font-semibold text-foreground">{name}</span>
          )}
          {r.last_intent && <span className="text-sm text-muted-foreground">{r.last_intent.replace(/_/g, " ")}</span>}
          {r.application_status && <span className="text-sm text-muted-foreground">application: {r.application_status}</span>}
        </div>
        {r.last_text && <p className="mt-0.5 truncate text-sm text-foreground">{r.last_text}</p>}
      </div>
      {/* On a phone the facts sit under the message on one line, so the name and text keep the full width; from sm up they stack on the right. */}
      <div className="flex w-full flex-wrap gap-x-2 text-sm tabular-nums text-muted-foreground sm:block sm:w-auto sm:shrink-0 sm:text-right">
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
  /** `origin` is the control pressed, read from the event before any await so the bubbles rise from it. */
  async function setStatus(d: DraftRow, status: "approved" | "archived" | "rejected", origin: Element | null) {
    setBusy(d.id);
    const { error } = await (supabase.rpc as unknown as Rpc)("social_draft_set_status", { p_id: d.id, p_status: status });
    setBusy(null);
    if (error) { toast.error(`Could not update draft: ${error.message}`); return; }
    toast.success(`${d.title ?? "Draft"}: ${status}`);
    // Only after the save went through: approving is the small win, archiving sends it away, rejecting moves it on.
    if (status === "approved") void celebrate("save", origin);
    else playSoundEffect(status === "archived" ? "whoosh" : "tick");
    await qc.invalidateQueries({ queryKey: [SOCIAL_COMMAND_KEY] });
  }
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Content queue">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-xl font-bold text-foreground">Content queue</h2>
        <p className="text-sm text-muted-foreground">{drafts.length} drafts waiting. Approve means the content engine may schedule it; nothing posts unapproved.</p>
      </header>
      {groups.length === 0 ? (
        <div className="px-4 py-6"><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Queue is empty" description="The Monday content run will fill it." /></div>
      ) : (
        <div className="divide-y divide-border px-4">
          {groups.map((g) => (
            <div key={g.platform} className="py-3">
              <h3 className="mb-2 text-base font-bold text-foreground">{platformLabel(g.platform)} <span className="font-normal text-muted-foreground">· {g.drafts.length}</span></h3>
              <RevealList as="ul" className="space-y-2">
                {g.drafts.slice(0, 12).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <PlatformBubble platform={g.platform} />
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-foreground">{d.title || d.hook || "Untitled draft"}</p>
                        <p className="text-sm text-muted-foreground">{[d.status.replace(/_/g, " "), d.pillar, d.slot, d.draft_date].filter(Boolean).join(" · ")}</p>
                        {d.hook && d.title && <p className="mt-0.5 text-sm text-muted-foreground">{d.hook}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {d.status !== "approved" && (
                        <Button variant="default" className="h-11" disabled={busy === d.id} onClick={(e) => { const origin = e.currentTarget; void setStatus(d, "approved", origin); }} aria-label={`Approve ${d.title ?? "draft"}`}>
                          {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Approve
                        </Button>
                      )}
                      <Button variant="outline" className="h-11" disabled={busy === d.id} onClick={(e) => { const origin = e.currentTarget; void setStatus(d, "archived", origin); }} aria-label={`Archive ${d.title ?? "draft"}`}>
                        <Archive className="h-4 w-4" aria-hidden /> Archive
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11" disabled={busy === d.id} onClick={(e) => { const origin = e.currentTarget; void setStatus(d, "rejected", origin); }} aria-label={`Reject ${d.title ?? "draft"}`}>
                        <XCircle className="h-5 w-5" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
                {g.drafts.length > 12 && <li className="text-sm text-muted-foreground">+{g.drafts.length - 12} more {platformLabel(g.platform)} drafts in the queue</li>}
              </RevealList>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
