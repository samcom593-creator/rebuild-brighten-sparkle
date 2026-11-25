/**
 * PlatformPulsePanel, on Reports for admins only (MP-BEST-2, 2026-11-19).
 *
 * Sam: "make the platform the best it can be ... more analytics." Every page view has been recorded since June and
 * nothing read it back, so "is anyone using this" was answered from auth.users.last_sign_in_at, a clock that only
 * moves on a fresh sign-in. This panel reads admin_platform_pulse(): real last-seen from page views in a real
 * browser, the agents split by "posted a deal" x "opened the app", the leads each person holds and has never
 * touched, which screens get used, how fast they load and how often an update interrupts someone.
 *
 * Verification sessions (headless browsers) and admin accounts are excluded in the database, so the owner's own
 * visits never read as team adoption. There are no dollar figures here on purpose: production has its own screens.
 *
 * A non-admin never mounts the query (the function refuses them with 42501), so a manager on Reports sees nothing
 * rather than an error card.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Inbox, RefreshCw, Smartphone, Users, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryState, queryStale, queryStatus } from "@/components/ui/query-state";
import { formatTimeAgo } from "@/lib/dateUtils";
import { TONE_CLASS, tonePill, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  AGENT_CLOUD_ACCOUNT_NAV, AGENT_CLOUD_PRIMARY_NAV, APPLICANT_NAV, flattenAgentCloudNav,
} from "@/components/layout/agentCloudNavigation";

export interface PulseAgent {
  agent_id: string;
  user_id: string | null;
  display_name: string | null;
  manager_name: string | null;
  license_status: string | null;
  stage: string | null;
  hired_at: string | null;
  last_seen: string | null;
  views_7d: number;
  views_30d: number;
  days_30d: number;
  phone_views_30d: number;
  top_page: string | null;
  deals_30d: number;
  last_deal: string | null;
  leads_held: number;
  leads_untouched: number;
  leads_sold: number;
  leads_warm: number;
  last_worked: string | null;
}
export interface PlatformPulse {
  generated_at: string;
  team: {
    active_agents: number; with_login: number; seen_7d: number; seen_30d: number; seen_90d: number; sold_30d: number;
    selling_on_platform: number; selling_off_platform: number; on_platform_not_selling: number; dark: number;
  };
  daily: Array<{ day: string; agents: number }>;
  agents: PulseAgent[];
  pages: Array<{ path: string; views: number; people: number; phone_views: number }>;
  speed: Array<{ path: string; samples: number; p75_ms: number }>;
  leads: { held: number; untouched: number; worked: number; sold: number; warm: number; holders: number };
  stability: {
    forced_reloads_7d: number; forced_reload_people_7d: number; forced_reloads_30d: number;
    other_crashes_30d: number; other_crash_people_30d: number;
  };
}

// ---- screen names: the sidebar's own labels, so this panel and the menu never disagree ----
const EXTRA_SCREENS: Record<string, string> = {
  "/": "Public homepage", "/login": "Sign in", "/agent-portal": "Agent portal", "/numbers": "Numbers",
  "/magic-login": "One-tap sign in", "/apply": "Application form", "/reset-password": "Reset password",
  "/r/:id": "Recruiting link", "/hire/:id": "Hire link", "/install": "Install the app",
};
const NAV_SCREENS: Record<string, string> = Object.fromEntries(
  flattenAgentCloudNav([...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV, ...APPLICANT_NAV])
    .map((l) => [l.href.split("?")[0], l.label] as const)
    .reverse(), // the first sidebar entry for a path wins
);
export function screenName(path: string | null | undefined): string {
  if (!path) return "No screen on record";
  return NAV_SCREENS[path] ?? EXTRA_SCREENS[path] ?? path;
}

// ---- the roster's filters; the tiles above the list are these same tests ----
export type PulseFilter = "not_selling" | "untouched" | "week" | "selling" | "dark";
export const PULSE_FILTERS: ReadonlyArray<{ key: PulseFilter; label: string; hint: string; tone: Tone; test: (a: PulseAgent) => boolean }> = [
  { key: "not_selling", label: "Logging in, not selling", hint: "Opened the app in the last 30 days, no deal posted in that time. The people closest to a first sale.", tone: "warm", test: (a) => a.deals_30d === 0 && a.views_30d > 0 },
  { key: "untouched", label: "Holding untouched leads", hint: "Has leads in a live pack that have never been called.", tone: "hot", test: (a) => a.leads_untouched > 0 },
  { key: "week", label: "In the app this week", hint: "At least one screen opened in the last 7 days.", tone: "good", test: (a) => a.views_7d > 0 },
  { key: "selling", label: "Posted a deal", hint: "At least one deal posted in the last 30 days.", tone: "gold", test: (a) => a.deals_30d > 0 },
  { key: "dark", label: "Dark for 30 days", hint: "No deal posted and the app not opened in 30 days.", tone: "slate", test: (a) => a.deals_30d === 0 && a.views_30d === 0 },
];
const ROSTER_PREVIEW = 12;

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const dayLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Web Vitals bands for "largest element on screen": 2.5s and 4s. Icon and word carry the state, never colour alone. */
export function speedBand(ms: number): { label: string; tone: Tone; Icon: typeof CheckCircle2 } {
  if (ms <= 2500) return { label: "Fast", tone: "good", Icon: CheckCircle2 };
  if (ms <= 4000) return { label: "Needs work", tone: "warm", Icon: AlertTriangle };
  return { label: "Slow", tone: "hot", Icon: XCircle };
}

function lastSeenText(a: PulseAgent): string {
  if (!a.user_id) return "No login yet";
  if (!a.last_seen) return "Not in 90 days";
  return formatTimeAgo(a.last_seen);
}

async function fetchPulse(): Promise<PlatformPulse> {
  const { data, error } = await supabase.rpc("admin_platform_pulse" as never);
  if (error) throw error;
  return data as unknown as PlatformPulse;
}

/** Agents in the app per day. One series, one hue; the peak and today are labelled, every bar answers to hover or focus. */
function DailyStrip({ daily }: { daily: PlatformPulse["daily"] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.agents));
  const peak = daily.reduce((best, d) => (d.agents > best.agents ? d : best), daily[0]);
  const today = daily[daily.length - 1];
  const shown = daily.find((d) => d.day === hover) ?? null;
  return (
    <div>
      <div className="flex h-20 items-end gap-[2px]" role="img" aria-label={`Agents in the app per day for the last ${daily.length} days. Peak ${peak.agents} on ${dayLabel(peak.day)}, ${today.agents} today.`}>
        {daily.map((d) => (
          <div
            key={d.day}
            className="group flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHover(d.day)}
            onMouseLeave={() => setHover(null)}
            title={`${dayLabel(d.day)}: ${d.agents} agent${d.agents === 1 ? "" : "s"}`}
          >
            <div
              className={cn("w-full rounded-t-[4px] bg-primary/70 transition-colors group-hover:bg-primary", d.agents === 0 && "bg-muted-foreground/25")}
              style={{ height: `${Math.max(d.agents === 0 ? 3 : 8, (d.agents / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <span className="shrink-0">{dayLabel(daily[0].day)}</span>
        <span className="text-center text-foreground" data-testid="pulse-daily-readout">
          {shown ? `${dayLabel(shown.day)}: ${shown.agents} in the app` : `Peak ${peak.agents} on ${dayLabel(peak.day)} · ${today.agents} today`}
        </span>
        <span className="shrink-0">Today</span>
      </div>
    </div>
  );
}

export function PlatformPulsePanel({ viewerId }: { viewerId: string }) {
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["admin-platform-pulse", viewerId], queryFn: fetchPulse, enabled: isAdmin && Boolean(viewerId), staleTime: 300_000 });
  const [filter, setFilter] = useState<PulseFilter>("not_selling");
  const [showAll, setShowAll] = useState(false);
  const data = q.data;
  const counts = useMemo(() => {
    const out = {} as Record<PulseFilter, number>;
    for (const f of PULSE_FILTERS) out[f.key] = (data?.agents ?? []).filter(f.test).length;
    return out;
  }, [data]);
  if (!isAdmin) return null;

  const active = PULSE_FILTERS.find((f) => f.key === filter) ?? PULSE_FILTERS[0];
  const rows = (data?.agents ?? []).filter(active.test).sort((a, b) =>
    filter === "untouched" ? b.leads_untouched - a.leads_untouched : filter === "dark" ? (a.display_name ?? "").localeCompare(b.display_name ?? "") : b.days_30d - a.days_30d,
  );
  const visibleRows = showAll ? rows : rows.slice(0, ROSTER_PREVIEW);
  const topPages = (data?.pages ?? []).slice(0, 10);
  const maxViews = Math.max(1, ...topPages.map((p) => p.views));

  return (
    <GlassCard className="space-y-5 p-4 sm:p-5" data-testid="platform-pulse">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4 text-primary" aria-hidden="true" /> Platform pulse</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Who is really using the platform, from screens opened in a real browser. Your own visits and test sessions are left out.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /> Refresh
        </Button>
      </div>

      <QueryState status={queryStatus({ ...q, isEmpty: false })} label="the platform pulse" error={q.error} onRetry={() => void q.refetch()} stale={queryStale(q)} asOf={data?.generated_at ?? null}>
        {data && (
          <div className="space-y-5">
            {/* the headline: the team by what they did, each tile also filters the list below */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5" role="group" aria-label="Filter the agent list">
              {PULSE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => { setFilter(f.key); setShowAll(false); }}
                  title={f.hint}
                  className={cn(
                    "rounded-lg border border-b-2 border-border/60 bg-muted/10 p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    filter === f.key && TONE_CLASS[f.tone].activeTile,
                  )}
                >
                  <span className="block text-2xl font-semibold tabular-nums leading-none">{counts[f.key]}</span>
                  <span className="mt-1.5 block text-xs text-muted-foreground">{f.label}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground" data-testid="pulse-headline">
              {data.team.active_agents} active agents. {data.team.sold_30d} posted a deal in the last 30 days and{" "}
              {data.team.selling_off_platform === 0 ? "every one of them uses the platform" : `${data.team.selling_on_platform} of them use the platform`}.{" "}
              {data.team.on_platform_not_selling} log in without selling yet, and {data.team.dark} did neither.
            </p>

            <section aria-labelledby="pulse-roster">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="pulse-roster" className="text-sm font-semibold">{active.label} <span className="font-normal text-muted-foreground">· {rows.length}</span></h3>
                <p className="text-xs text-muted-foreground">{active.hint}</p>
              </div>
              {rows.length === 0 ? (
                <p className="mt-2 rounded-lg border border-border/60 p-3 text-sm text-muted-foreground">Nobody is in this group right now.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60 rounded-lg border border-border/60 text-sm" data-testid="pulse-roster">
                  {visibleRows.map((a) => (
                    <li key={a.agent_id} className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2.5">
                      <div className="min-w-[9rem] flex-1">
                        <p className="truncate font-medium">{a.display_name ?? "Name not on file"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[a.manager_name ? `Reports to ${a.manager_name}` : null, a.license_status].filter(Boolean).join(" · ") || "No manager on file"}
                        </p>
                      </div>
                      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        <div><dt className="text-muted-foreground">Last seen</dt><dd className="font-medium">{lastSeenText(a)}</dd></div>
                        <div><dt className="text-muted-foreground">Days in app</dt><dd className="font-medium tabular-nums">{a.days_30d} of 30</dd></div>
                        <div><dt className="text-muted-foreground">Mostly on</dt><dd className="font-medium">{a.views_30d > 0 ? screenName(a.top_page) : "Nothing opened"}</dd></div>
                        <div><dt className="text-muted-foreground">Deals, 30 days</dt><dd className="font-medium tabular-nums">{a.deals_30d}</dd></div>
                        <div>
                          <dt className="text-muted-foreground">Leads untouched</dt>
                          <dd className="font-medium tabular-nums">{a.leads_held > 0 ? `${a.leads_untouched} of ${a.leads_held}` : "None held"}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
              {rows.length > ROSTER_PREVIEW && (
                <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${rows.length}`}
                </Button>
              )}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <section aria-labelledby="pulse-daily" className="space-y-2">
                <h3 id="pulse-daily" className="flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Agents in the app, per day</h3>
                {data.daily.length > 0 && <DailyStrip daily={data.daily} />}
                <p className="text-xs text-muted-foreground">
                  {data.team.seen_7d} of {data.team.active_agents} opened it in the last 7 days, {data.team.seen_30d} in 30, {data.team.seen_90d} in 90.
                </p>
              </section>

              <section aria-labelledby="pulse-leads" className="space-y-2">
                <h3 id="pulse-leads" className="flex items-center gap-1.5 text-sm font-semibold"><Inbox className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Leads handed out</h3>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${data.leads.worked} of ${data.leads.held} leads have been worked`}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct(data.leads.worked, data.leads.held)}%` }} />
                </div>
                <p className="text-sm" data-testid="pulse-leads-line">
                  <span className="font-semibold tabular-nums">{data.leads.untouched}</span> of {data.leads.held} leads in live packs have never been called
                  {" "}({pct(data.leads.untouched, data.leads.held)}%).
                </p>
                <p className="text-xs text-muted-foreground">
                  {people(data.leads.holders)} hold{data.leads.holders === 1 ? "s" : ""} them. {data.leads.worked} worked, {data.leads.warm} waiting on a call back or appointment, {data.leads.sold} sold.
                </p>
              </section>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section aria-labelledby="pulse-screens" className="space-y-2">
                <h3 id="pulse-screens" className="flex items-center gap-1.5 text-sm font-semibold"><Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Screens people open, 30 days</h3>
                <ul className="space-y-1.5">
                  {topPages.map((p) => (
                    <li key={p.path} className="text-sm" title={`${p.views} views by ${people(p.people)}, ${pct(p.phone_views, p.views)}% on a phone`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate">{screenName(p.path)}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.views} views · {people(p.people)} · {pct(p.phone_views, p.views)}% phone</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted/60"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (p.views / maxViews) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="pulse-speed" className="space-y-2">
                <h3 id="pulse-speed" className="flex items-center gap-1.5 text-sm font-semibold"><Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> How fast screens appear</h3>
                {data.speed.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not enough load measurements in the last 14 days.</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-sm">
                    {data.speed.map((s) => {
                      const band = speedBand(s.p75_ms);
                      return (
                        <li key={s.path} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="min-w-0 truncate">{screenName(s.path)}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular-nums">{(s.p75_ms / 1000).toFixed(1)}s</span>
                            <Badge variant="outline" className={cn("gap-1 font-normal", tonePill(band.tone))}><band.Icon className="h-3 w-3" aria-hidden="true" />{band.label}</Badge>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Time until the main content shows, for 3 out of 4 loads, last 14 days. Updates interrupted someone with a forced reload{" "}
                  {data.stability.forced_reloads_7d} time{data.stability.forced_reloads_7d === 1 ? "" : "s"} this week ({people(data.stability.forced_reload_people_7d)})
                  {data.stability.other_crashes_30d > 0 ? `, and ${data.stability.other_crashes_30d} other error screens were logged in 30 days (${people(data.stability.other_crash_people_30d)}).` : "."}
                </p>
              </section>
            </div>
          </div>
        )}
      </QueryState>
    </GlassCard>
  );
}

export default PlatformPulsePanel;
