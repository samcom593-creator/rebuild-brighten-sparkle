// Announcements + News Feed · mirrors AgentLink's Announcements + News Feed pages
//
// Two stacked sections:
//   1. ACTIVE ANNOUNCEMENTS — announcements table (pinned first, then by published_at)
//      Admin can post a new one via the inline form (priority + pin + body).
//   2. NEWS FEED — v_culture_feed (live deal_posted celebrations w/ agent name + photo)
//
// Both fed from existing tables. No new SQL — schema verified 2026-06-13.
//
// 2026-07-26 — presentation converged onto the APEX visual contract
// (business-ops/2026-07-24-apex-implementation/APEX-VISUAL-CONTRACT.md).
// Queries, mutations, branches, and rendered values are untouched.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pin, TrendingUp, RefreshCw, Send, Plus, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatTimeAgo } from "@/lib/dateUtils";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";

interface Announcement {
  id: string;
  title: string | null;
  body: string | null;
  content: string | null;
  category: string | null;
  priority: string | null;
  pinned: boolean | null;
  is_active: boolean | null;
  published_at: string | null;
  created_at: string;
}

interface CultureFeedRow {
  id: number;
  event_type: string;
  created_at: string;
  annual_premium: number | null;
  product_sold: string | null;
  agent_name: string | null;
  agent_photo: string | null;
  draft_hook: string | null;
}

// MP-264 declutter: was a third local copy of the same relative-time ladder.
// Routed through the shared formatTimeAgo(), which clamps the delta so a
// clock-skewed future timestamp can't render "-3m ago".
function relativeTime(iso: string): string {
  return formatTimeAgo(iso);
}

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export default function Announcements() {
  usePageTitle("Announcements + News Feed · APEX");
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", priority: "normal", pinned: false });

  const announcements = useQuery({
    queryKey: ["announcements-active"],
    queryFn: async () => {
      const { data, error } = await looseSupabase
        .from<Announcement>("announcements")
        .select("id, title, body, content, category, priority, pinned, is_active, published_at, created_at")
        .eq("is_active", true)
        .order("pinned", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as Announcement[];
    },
    refetchInterval: 60_000,
  });

  const feed = useQuery({
    queryKey: ["news-feed"],
    queryFn: async () => {
      const { data, error } = await looseSupabase
        .from<CultureFeedRow>("v_culture_feed")
        .select("id, event_type, created_at, annual_premium, product_sold, agent_name, agent_photo, draft_hook")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as CultureFeedRow[];
    },
    refetchInterval: 30_000,
  });

  const postAnnouncement = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        content: form.body.trim().slice(0, 240),
        category: "general",
        priority: form.priority,
        pinned: form.pinned,
        is_active: true,
        published_at: new Date().toISOString(),
      };
      const { error } = await looseSupabase.from<Announcement>("announcements").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Announcement posted");
      setForm({ title: "", body: "", priority: "normal", pinned: false });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Failed to post"),
  });

  // Severity text tone only — the priority word itself is the second channel
  // (WCAG 1.4.1), so colour is never carrying the meaning on its own.
  const priorityColor = (p: string | null) => {
    if (p === "high" || p === "urgent") return "text-rose-600 dark:text-rose-400";
    if (p === "normal") return "text-amber-600 dark:text-amber-400";
    return "text-muted-foreground";
  };

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Updates"
        eyebrowIcon={<Megaphone className="h-3 w-3" />}
        title="Announcements + News Feed"
        subtitle="Active company announcements + live celebrations stream. Mirrors AgentLink's Announcements + News Feed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px] tabular-nums">
              {(announcements.data?.length ?? 0)} active · {(feed.data?.length ?? 0)} events
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-10 sm:h-9"
              onClick={() => { announcements.refetch(); feed.refetch(); }}
            >
              <RefreshCw className={cn("mr-1.5 h-4 w-4", announcements.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <SubmitDealDialog
              trigger={
                <Button size="sm" variant="default" className="h-10 sm:h-9">
                  <Trophy className="mr-1.5 h-4 w-4" />
                  Add Deal
                </Button>
              }
            />
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 sm:h-9"
                aria-pressed={showForm}
                onClick={() => setShowForm((v) => !v)}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Post
              </Button>
            )}
          </div>
        }
      />

      {/* ADMIN POST FORM */}
      {isAdmin && showForm && (
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">New announcement</span>
            </h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Anything published here sits at the top of every agent's feed until it is deactivated.
          </p>

          <div className="space-y-3">
            <Input
              placeholder="Title…"
              aria-label="Announcement title"
              className="h-10 sm:h-9"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <Textarea
              placeholder="Announcement body…"
              aria-label="Announcement body"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex min-h-10 items-center gap-2 text-xs font-medium text-foreground sm:min-h-9">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                  checked={form.pinned}
                  onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                />
                Pin to top
              </label>
              <select
                aria-label="Announcement priority"
                className="h-10 rounded-sm border border-border bg-background px-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 flex-1 sm:h-9 sm:flex-none"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-10 flex-1 sm:h-9 sm:flex-none"
                  disabled={!form.title.trim() || !form.body.trim() || postAnnouncement.isPending}
                  onClick={() => postAnnouncement.mutate()}
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  Publish
                </Button>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ANNOUNCEMENTS */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Active announcements</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {announcements.data?.length ?? 0}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Everything the floor is expected to have read — pinned notices sit first, the rest run newest to oldest.
        </p>

        {announcements.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                key={i}
                className="h-[80px] animate-pulse rounded-lg bg-muted/30"
              />
            ))}
          </div>
        ) : (announcements.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Megaphone className="h-7 w-7" />}
            variant="default"
            title="No active announcements"
            description="Nothing is published for the floor right now. Post one the moment there is something everyone has to know."
          />
        ) : (
          <ul className="space-y-2">
            {announcements.data!.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "rounded-lg border border-border/60 bg-card/60 px-3 py-2.5",
                  a.pinned && "border-amber-500/35",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {a.pinned && (
                      <Pin
                        aria-label="Pinned"
                        className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                      />
                    )}
                    <span className="truncate text-sm font-medium text-foreground">
                      {a.title ?? "Announcement"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wide",
                        priorityColor(a.priority),
                      )}
                    >
                      {a.priority ?? "normal"}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {relativeTime(a.published_at ?? a.created_at)}
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                  {a.body ?? a.content ?? ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* NEWS FEED */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Live news feed</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {feed.data?.length ?? 0}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Every deal posted by the floor, newest first — the premium on the right is what the win was worth.
        </p>

        {feed.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                key={i}
                className="h-[60px] animate-pulse rounded-lg bg-muted/30"
              />
            ))}
          </div>
        ) : (feed.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Trophy className="h-7 w-7" />}
            variant="default"
            title="No deals on the feed yet"
            description="The stream fills the second someone posts a win. Post yours and start it."
          />
        ) : (
          <ul className="space-y-2">
            {feed.data!.map((ev) => (
              <li
                key={ev.id}
                className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
              >
                <div className="flex items-start gap-3">
                  {ev.agent_photo ? (
                    <img
                      src={ev.agent_photo}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                      {(ev.agent_name ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {ev.agent_name ?? "Someone"}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      closed
                      {ev.product_sold && <> · {ev.product_sold}</>}
                    </div>
                    {ev.draft_hook && (
                      <p className="mt-0.5 truncate text-[11px] italic text-muted-foreground">
                        "{ev.draft_hook}"
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmtUsd(ev.annual_premium)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums text-muted-foreground">
                      {relativeTime(ev.created_at)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
