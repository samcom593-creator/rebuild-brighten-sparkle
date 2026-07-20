// Announcements + News Feed · mirrors AgentLink's Announcements + News Feed pages
//
// Two stacked sections:
//   1. ACTIVE ANNOUNCEMENTS — announcements table (pinned first, then by published_at)
//      Admin can post a new one via the inline form (priority + pin + body).
//   2. NEWS FEED — v_culture_feed (live deal_posted celebrations w/ agent name + photo)
//
// Both fed from existing tables. No new SQL — schema verified 2026-06-13.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pin, Sparkles, TrendingUp, RefreshCw, Send, Plus, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

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

function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export default function Announcements() {
  usePageTitle("Announcements + News Feed · APEX");
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user as any)?.role === "admin" || (user as any)?.app_metadata?.role === "admin";

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", priority: "normal", pinned: false });
  const [showDealForm, setShowDealForm] = useState(false);
  const [dealForm, setDealForm] = useState({ premium: "", product: "Final Expense", note: "" });

  const myAgent = useQuery({
    queryKey: ["my-agent-id", (user as any)?.id],
    enabled: !!(user as any)?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents" as any)
        .select("id, full_name, display_name, avatar_url")
        .eq("user_id", (user as any).id)
        .maybeSingle();
      return data as any;
    },
  });

  const announcements = useQuery({
    queryKey: ["announcements-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements" as any)
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
      const { data, error } = await supabase
        .from("v_culture_feed" as any)
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
      const { error } = await supabase.from("announcements" as any).insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Announcement posted");
      setForm({ title: "", body: "", priority: "normal", pinned: false });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to post"),
  });

  const postDeal = useMutation({
    mutationFn: async () => {
      if (!myAgent.data?.id) throw new Error("No agent profile linked to your user · ask admin to link agents.user_id");
      const premium = parseFloat(dealForm.premium);
      if (!Number.isFinite(premium) || premium <= 0) throw new Error("Enter a premium > 0");
      const { error } = await supabase.rpc("fn_post_deal_celebration" as any, {
        p_agent_id: myAgent.data.id,
        p_annual_premium: premium,
        p_product_sold: dealForm.product,
        p_note: dealForm.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deal posted to the feed");
      setDealForm({ premium: "", product: "Final Expense", note: "" });
      setShowDealForm(false);
      qc.invalidateQueries({ queryKey: ["news-feed"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to post deal"),
  });

  const priorityColor = (p: string | null) => {
    if (p === "high" || p === "urgent") return "bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300";
    if (p === "normal") return "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300";
    return "bg-slate-500/15 border-slate-500/30 text-slate-700 dark:text-slate-300";
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-6">
      <PageHeader
        eyebrow="Updates"
        eyebrowIcon={<Megaphone className="h-3 w-3" />}
        title="Announcements + News Feed"
        subtitle="Active company announcements + live celebrations stream. Mirrors AgentLink's Announcements + News Feed."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">
              {(announcements.data?.length ?? 0)} active · {(feed.data?.length ?? 0)} events
            </Badge>
            <Button variant="outline" size="sm" onClick={() => { announcements.refetch(); feed.refetch(); }}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${announcements.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setShowDealForm((v) => !v)}
            >
              <Trophy className="h-3.5 w-3.5 mr-1.5" />
              Post a Deal
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowForm((v) => !v)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Post
              </Button>
            )}
          </div>
        }
      />

      {/* ADMIN POST FORM */}
      {isAdmin && showForm && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-3">
            <Input
              placeholder="Title…"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <Textarea
              placeholder="Announcement body…"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
            />
            <div className="flex items-center gap-3 text-13">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                />
                Pin to top
              </label>
              <select
                className="border border-border bg-background rounded-md px-2 py-1 text-13"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!form.title.trim() || !form.body.trim() || postAnnouncement.isPending}
                  onClick={() => postAnnouncement.mutate()}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Publish
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* POST A DEAL FORM */}
      {showDealForm && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-emerald-600" />
              <p className="text-13 font-bold">Post a Deal</p>
              {!myAgent.data?.id && (
                <Badge variant="outline" className="text-11 ml-auto text-rose-600 border-rose-500/30">
                  No agent linked
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Annual premium ($)"
                value={dealForm.premium}
                onChange={(e) => setDealForm({ ...dealForm, premium: e.target.value })}
              />
              <select
                className="border border-border bg-background rounded-md px-3 py-2 text-13"
                value={dealForm.product}
                onChange={(e) => setDealForm({ ...dealForm, product: e.target.value })}
              >
                <option>Final Expense</option>
                <option>Whole Life</option>
                <option>Term Life</option>
                <option>IUL</option>
                <option>Annuity</option>
                <option>Mortgage Protection</option>
                <option>Children's Whole Life</option>
                <option>Supplemental Health</option>
                <option>Other</option>
              </select>
            </div>
            <Textarea
              placeholder="Brag a little — what made this one yours? (optional)"
              value={dealForm.note}
              onChange={(e) => setDealForm({ ...dealForm, note: e.target.value })}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDealForm(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!dealForm.premium || postDeal.isPending || !myAgent.data?.id}
                onClick={() => postDeal.mutate()}
              >
                <Trophy className="h-3.5 w-3.5 mr-1.5" />
                {postDeal.isPending ? "Posting…" : "Celebrate It"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ANNOUNCEMENTS */}
      <section className="space-y-3">
        <h2 className="text-15 font-bold flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-amber-500" /> Active Announcements
        </h2>
        {announcements.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} /* stable-key-allow:skeleton — fixed-length loading placeholder */ className="h-24" />)}
          </div>
        ) : (announcements.data?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-6 text-center text-13 text-muted-foreground">No active announcements.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {announcements.data!.map((a) => (
              <Card key={a.id} className={a.pinned ? "border-amber-500/40 bg-amber-500/5" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {a.pinned && <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <p className="text-14 font-bold truncate">{a.title ?? "Announcement"}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className={`text-11 ${priorityColor(a.priority)}`}>
                        {a.priority ?? "normal"}
                      </Badge>
                      <span className="text-11 text-muted-foreground tabular-nums">
                        {relativeTime(a.published_at ?? a.created_at)}
                      </span>
                    </div>
                  </div>
                  <p className="text-13 text-foreground/85 leading-relaxed whitespace-pre-line">
                    {a.body ?? a.content ?? ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* NEWS FEED */}
      <section className="space-y-3">
        <h2 className="text-15 font-bold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" /> Live News Feed
        </h2>
        {feed.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} /* stable-key-allow:skeleton — fixed-length loading placeholder */ className="h-14" />)}
          </div>
        ) : (feed.data?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-6 text-center text-13 text-muted-foreground">No recent activity.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {feed.data!.map((ev) => (
              <Card key={ev.id} className="hover:bg-muted/30 transition-base">
                <CardContent className="p-3 flex items-center gap-3">
                  {ev.agent_photo ? (
                    <img src={ev.agent_photo} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-12 font-bold flex items-center justify-center">
                      {(ev.agent_name ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-13 leading-snug">
                      <span className="font-semibold">{ev.agent_name ?? "Someone"}</span>
                      <span className="text-foreground/70">
                        {" "}closed{" "}
                      </span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {fmtUsd(ev.annual_premium)}
                      </span>
                      {ev.product_sold && (
                        <>
                          <span className="text-foreground/70"> · </span>
                          <span className="text-foreground/85">{ev.product_sold}</span>
                        </>
                      )}
                    </p>
                    {ev.draft_hook && (
                      <p className="text-11 text-muted-foreground truncate italic">"{ev.draft_hook}"</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500 ml-auto mb-0.5" />
                    <span className="text-11 text-muted-foreground tabular-nums">
                      {relativeTime(ev.created_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
