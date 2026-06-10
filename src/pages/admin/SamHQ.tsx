import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Crown, Plus, Trash2, Edit3, Check, X, Calendar as CalIcon,
  Rocket, AlertTriangle, Activity, Send, Radio, Wallet, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

/* ---------------- types ---------------- */
type Bucket = "MUST" | "SHOULD" | "COULD";
type TaskRow = {
  id: string;
  date: string;
  bucket: Bucket;
  task_text: string;
  block_time: string | null;
  status: "pending" | "done" | "skipped";
  goal_tag: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type WeekDay = {
  date: string;
  pending_count: number;
  done_count: number;
  skipped_count: number;
  total_count: number;
};

/* ---------------- date helpers ---------------- */
const CT_TZ = "America/Chicago";
function todayCT(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString("en-US", { timeZone: CT_TZ }));
  const y = ct.getFullYear();
  const m = String(ct.getMonth() + 1).padStart(2, "0");
  const d = String(ct.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dowLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

/* ============================================================
   SECTION 1 — TODAY (editable MUST / SHOULD / COULD checklist)
   ============================================================ */
function TodaySection({ today }: { today: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<Bucket | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["sam_today_tasks", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sam_daily_tasks")
        .select("*")
        .eq("date", today)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as TaskRow[];
    },
    refetchInterval: 60_000, // 60s poll for cross-device sync
  });

  const toggle = useMutation({
    mutationFn: async (t: TaskRow) => {
      const next = t.status === "done" ? "pending" : "done";
      const { error } = await supabase
        .from("sam_daily_tasks")
        .update({ status: next })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sam_today_tasks", today] }),
  });

  const addTask = useMutation({
    mutationFn: async ({ bucket, text }: { bucket: Bucket; text: string }) => {
      const sameBucket = (tasks ?? []).filter(t => t.bucket === bucket);
      const nextPos = sameBucket.length ? Math.max(...sameBucket.map(t => t.position)) + 1 : 1;
      const { error } = await supabase
        .from("sam_daily_tasks")
        .insert({ date: today, bucket, task_text: text, position: nextPos, status: "pending" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sam_today_tasks", today] });
      setDraft("");
      setAdding(null);
    },
  });

  const editTask = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { error } = await supabase
        .from("sam_daily_tasks")
        .update({ task_text: text })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sam_today_tasks", today] });
      setEditingId(null);
      setEditText("");
    },
  });

  const removeTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sam_daily_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sam_today_tasks", today] }),
  });

  const buckets = useMemo(() => {
    const map: Record<Bucket, TaskRow[]> = { MUST: [], SHOULD: [], COULD: [] };
    (tasks ?? []).forEach(t => map[t.bucket].push(t));
    return map;
  }, [tasks]);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  }

  const BUCKET_META: Record<Bucket, { color: string; label: string }> = {
    MUST: { color: "text-red-400 border-red-400/40 bg-red-500/5", label: "MUST" },
    SHOULD: { color: "text-amber-400 border-amber-400/40 bg-amber-500/5", label: "SHOULD" },
    COULD: { color: "text-emerald-400 border-emerald-400/40 bg-emerald-500/5", label: "COULD" },
  };

  return (
    <Card className="border-[#22d3a5]/30">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xl">
          <CalIcon className="w-5 h-5 text-[#22d3a5]" />
          TODAY · {new Date(today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </CardTitle>
        <div className="text-sm text-slate-400">
          {(tasks ?? []).filter(t => t.status === "done").length} / {(tasks ?? []).length} done
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(["MUST", "SHOULD", "COULD"] as Bucket[]).map(bucket => (
          <div key={bucket} className={cn("rounded-lg border p-3", BUCKET_META[bucket].color)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono tracking-wider">{BUCKET_META[bucket].label}</span>
              <Button
                size="sm" variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => { setAdding(bucket); setDraft(""); }}
              ><Plus className="w-3.5 h-3.5 mr-1" />add</Button>
            </div>
            <ul className="space-y-1.5">
              {buckets[bucket].map(t => {
                const isEditing = editingId === t.id;
                return (
                  <li key={t.id} className={cn(
                    "group flex items-start gap-2 py-1.5 px-2 rounded transition-colors",
                    t.status === "done" && "opacity-50",
                    "hover:bg-white/[0.03]"
                  )}>
                    <Checkbox
                      checked={t.status === "done"}
                      onCheckedChange={() => toggle.mutate(t)}
                      className="mt-1 flex-shrink-0"
                    />
                    {isEditing ? (
                      <Input
                        value={editText}
                        autoFocus
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && editText.trim()) {
                            editTask.mutate({ id: t.id, text: editText.trim() });
                          } else if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                        }}
                        onBlur={() => {
                          if (editText.trim() && editText !== t.task_text) editTask.mutate({ id: t.id, text: editText.trim() });
                          else { setEditingId(null); setEditText(""); }
                        }}
                        className="text-sm h-7"
                      />
                    ) : (
                      <div
                        className={cn("flex-1 text-sm cursor-pointer leading-snug", t.status === "done" && "line-through")}
                        onClick={() => { setEditingId(t.id); setEditText(t.task_text); }}
                        title="click to edit"
                      >
                        {t.task_text}
                        {t.block_time && <span className="block text-xs text-slate-600 dark:text-slate-300 mt-0.5">{t.block_time}{t.goal_tag ? ` · ${t.goal_tag}` : ""}</span>}
                      </div>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => { if (confirm("Delete task?")) removeTask.mutate(t.id); }}
                      title="delete"
                    ><Trash2 className="w-3.5 h-3.5" /></Button>
                  </li>
                );
              })}
              {adding === bucket && (
                <li className="flex items-center gap-2 py-1.5 px-2">
                  <Input
                    placeholder="What needs to happen?"
                    value={draft}
                    autoFocus
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && draft.trim()) addTask.mutate({ bucket, text: draft.trim() });
                      else if (e.key === "Escape") { setAdding(null); setDraft(""); }
                    }}
                    className="h-7 text-sm"
                  />
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setAdding(null); setDraft(""); }}><X className="w-3.5 h-3.5" /></Button>
                </li>
              )}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 2 — THIS WEEK (7-day strip)
   ============================================================ */
function ThisWeekSection({ today }: { today: string }) {
  const { data: week } = useQuery({
    queryKey: ["sam_week_tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_sam_week_tasks").select("*");
      if (error) throw error;
      return data as WeekDay[];
    },
    refetchInterval: 60_000,
  });

  // Build 7-day slot grid (today + next 6) even if days have no rows yet
  const days = useMemo(() => {
    const arr: { date: string; row: WeekDay | null }[] = [];
    const base = new Date(today + "T12:00:00");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      arr.push({ date: ds, row: (week ?? []).find(w => w.date === ds) ?? null });
    }
    return arr;
  }, [week, today]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalIcon className="w-4 h-4 text-[#22d3a5]" /> THIS WEEK
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map(d => {
            const isToday = d.date === today;
            const done = d.row?.done_count ?? 0;
            const total = d.row?.total_count ?? 0;
            return (
              <div key={d.date} className={cn(
                "rounded-md p-2.5 text-center border transition-colors",
                isToday ? "border-[#22d3a5] bg-[#22d3a5]/10" : "border-white/10 bg-white/[0.02]"
              )}>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{dowLabel(d.date)}</div>
                <div className="text-xl font-bold mt-1">{new Date(d.date + "T12:00:00").getDate()}</div>
                <div className="text-xs mt-1.5 text-slate-600 dark:text-slate-300">
                  {total > 0 ? `${done}/${total}` : <span className="text-slate-400">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 3 — WHAT SHIPPED (today's commits + bot ledger summary)
   ============================================================ */
function ShippedSection() {
  // Pull from v_recent_hires AS PROXY for "what shipped to the agency today"
  // (people hired since yesterday) + last 5 commits via system_settings note.
  const { data: hires } = useQuery({
    queryKey: ["sam_hq_recent_hires"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recent_hires")
        .select("*")
        .limit(5);
      if (error) throw error;
      return data as Array<{ first_name?: string; full_name?: string; hired_at?: string; created_at?: string }>;
    },
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Rocket className="w-4 h-4 text-[#22d3a5]" /> WHAT SHIPPED (LIVE)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-xs font-mono text-slate-400 mb-1.5">RECENT HIRES (last 5)</div>
          {!hires?.length && <div className="text-xs text-slate-600 dark:text-slate-300">No hires loaded yet</div>}
          <ul className="space-y-1">
            {(hires ?? []).map((h, i) => (
              <li key={i} className="flex items-center justify-between border-b border-white/5 py-1">
                <span>{h.full_name ?? h.first_name ?? "—"}</span>
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {h.hired_at || h.created_at
                    ? formatDistanceToNow(new Date(h.hired_at ?? h.created_at!), { addSuffix: true })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-white/5">
          Build + content + bot ships are in the <code className="text-[#22d3a5]">/dashboard</code> What Shipped Today banner and in each bot's ledger. This panel will surface ledger-feed entries once the <code>get-bot-shipped-feed</code> edge fn ships.
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 4 — CONTENT COMMAND (draft queue + what to post next)
   ============================================================ */
function ContentCommandSection() {
  const { data: drafts } = useQuery({
    queryKey: ["sam_hq_content_drafts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_bot_drafts")
        .select("id, draft_date, platform, title, hook, status, file_path, created_at")
        .in("status", ["pending", "awaiting_approval", "approved"])
        .order("draft_date", { ascending: true, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: number;
        draft_date: string | null;
        platform: string | null;
        title: string | null;
        hook: string | null;
        status: string;
        file_path: string | null;
        created_at: string;
      }>;
    },
    refetchInterval: 60_000,
  });

  const awaiting = useMemo(() => (drafts ?? []).filter((d) => d.status === "awaiting_approval" || d.status === "pending").length, [drafts]);
  const approved = useMemo(() => (drafts ?? []).filter((d) => d.status === "approved").length, [drafts]);

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.03]">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Radio className="w-4 h-4 text-amber-300" /> CONTENT COMMAND
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/admin/content-command">Open drafts</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-2xl font-bold text-amber-300">{awaiting}</div>
            <div className="text-xs text-slate-400">need Sam stamp</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-2xl font-bold text-emerald-300">{approved}</div>
            <div className="text-xs text-slate-400">approved to post</div>
          </div>
        </div>
        {(drafts ?? []).length === 0 ? (
          <div className="text-xs text-slate-600 dark:text-slate-300 rounded-md border border-dashed border-white/10 p-3">
            No active drafts loaded. Source checked: <code>social_bot_drafts</code>.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {(drafts ?? []).slice(0, 3).map((d) => (
              <li key={d.id} className="rounded-md border border-white/10 bg-white/[0.025] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{d.title ?? `Draft ${d.id}`}</span>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                <div className="text-slate-600 dark:text-slate-300 mt-1 truncate">
                  {d.platform ?? "unknown"} · {d.draft_date ?? "no date"}{d.hook ? ` · ${d.hook}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 5 — NEXT ACTIONS (top 3)
   ============================================================ */
function NextActionsSection() {
  const { data } = useQuery({
    queryKey: ["sam_hq_next_actions"],
    queryFn: async () => {
      const [drafts, groups, unclaimed] = await Promise.all([
        (supabase as any).from("social_bot_drafts").select("id", { count: "exact", head: true }).in("status", ["pending", "awaiting_approval"]),
        supabase.from("telegram_groups").select("chat_id", { count: "exact" }).in("type", ["onboarding", "licensing_reference", "daily_movement", "seminar_reminders", "ask_apex_ai"]),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "new"),
      ]);
      const pendingTelegram = ((groups.data ?? []) as Array<{ chat_id: number }>).filter((g) => Number(g.chat_id) > -1000 && Number(g.chat_id) < 0).length;
      return {
        draftCount: drafts.count ?? 0,
        pendingTelegram,
        unclaimedCount: unclaimed.count ?? 0,
      };
    },
    refetchInterval: 60_000,
  });

  const actions = [
    data?.draftCount ? { label: `Stamp ${data.draftCount} content drafts`, href: "/dashboard/admin/content-command", tone: "text-amber-300" } : null,
    data?.pendingTelegram ? { label: `Bind ${data.pendingTelegram} Telegram HQ channels`, href: "/dashboard/admin/telegram-bot", tone: "text-rose-300" } : null,
    data?.unclaimedCount ? { label: `Review ${data.unclaimedCount} new applicants`, href: "/dashboard/admin/unclaimed", tone: "text-cyan-300" } : null,
    { label: "Run final branch QA before merge/deploy", href: "/dashboard/system-health", tone: "text-emerald-300" },
  ].filter(Boolean).slice(0, 3) as Array<{ label: string; href: string; tone: string }>;

  return (
    <Card className="border-[#22d3a5]/30 bg-[#22d3a5]/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="w-4 h-4 text-[#22d3a5]" /> TOP 3 NEXT ACTIONS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action, index) => (
          <Link
            key={action.label}
            to={action.href}
            className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm hover:border-[#22d3a5]/40 transition-colors"
          >
            <span><span className={cn("font-mono mr-2", action.tone)}>#{index + 1}</span>{action.label}</span>
            <span className="text-slate-600 dark:text-slate-300">open</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 6 — LEAKS (live counts from existing views)
   ============================================================ */
function LeaksSection() {
  const { data: leaks } = useQuery({
    queryKey: ["sam_hq_leaks"],
    queryFn: async () => {
      const [unclaimed, premiumGap, ghostAP, ica] = await Promise.all([
        supabase.from("v_unclaimed_new_apps").select("*", { count: "exact", head: true }),
        supabase.from("v_carrier_premium_data_gap").select("*", { count: "exact", head: true }),
        supabase.from("v_carrier_reconciliation").select("*", { count: "exact", head: true }).eq("status", "unreconciled"),
        supabase.from("v_insuracloud_auth_health").select("*").limit(1),
      ]);
      return {
        unclaimed: unclaimed.count ?? null,
        premium_gap: premiumGap.count ?? null,
        ghost_ap: ghostAP.count ?? null,
        ica_health: ica.data?.[0] ?? null,
      };
    },
    refetchInterval: 120_000,
  });

  const tiles = [
    { label: "Unclaimed applicants", value: leaks?.unclaimed ?? "—", href: "/dashboard/applicants?filter=unclaimed", color: "text-amber-400" },
    { label: "Policies missing premium", value: leaks?.premium_gap ?? "—", href: "/dashboard/admin/charges-audit", color: "text-red-400" },
    { label: "Unreconciled commissions", value: leaks?.ghost_ap ?? "—", href: "/dashboard/admin/book-quality", color: "text-red-400" },
    { label: "InsuraCloud auth", value: (leaks?.ica_health as { status?: string } | null)?.status ?? "—", href: "/dashboard/system-health", color: "text-slate-600 dark:text-slate-300" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldAlert className="w-4 h-4 text-amber-400" /> LEAKS
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(t => (
            <a key={t.label} href={t.href} className="rounded-md border border-white/10 bg-white/[0.02] p-3 hover:border-white/20 transition-colors">
              <div className={cn("text-2xl font-bold tabular-nums", t.color)}>{t.value}</div>
              <div className="text-xs text-slate-400 mt-1">{t.label}</div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECTION 7 — BOTS (one-line status per APEX launchd bot)
   ============================================================ */
function BotsSection() {
  const { data: settings } = useQuery({
    queryKey: ["sam_hq_bot_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value, updated_at")
        .in("key", [
          "telegram_bot_username", "telegram_bot_dm_url",
          "readymode_account_id", "readymode_sync_enabled",
          "mentorship_payment_links",
        ]);
      if (error) throw error;
      return data;
    },
  });

  const bots = [
    { key: "telegram-bot", icon: Send, label: "Telegram bot", note: "Pre-hire onboarding + Ask Apex AI" },
    { key: "social-media-bot", icon: Radio, label: "Social bot", note: "Drafts + stamps + IG/TT/YT" },
    { key: "website-integrity-bot", icon: ShieldAlert, label: "Website integrity", note: "Audit passes hourly" },
    { key: "finance-bot", icon: Wallet, label: "CFO bot", note: "Spending + leaks + greenlights" },
    { key: "readymode-bot", icon: Activity, label: "ReadyMode bot", note: "Dialer pulls + audits" },
  ];

  const settingsMap = new Map(settings?.map(s => [s.key, s]) ?? []);
  const tgUsername = settingsMap.get("telegram_bot_username")?.value as string | undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="w-4 h-4 text-[#22d3a5]" /> BOTS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {bots.map(b => (
          <div key={b.key} className="flex items-center justify-between py-1 border-b border-white/5 last:border-b-0">
            <div className="flex items-center gap-2">
              <b.icon className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium">{b.label}</span>
            </div>
            <span className="text-xs text-slate-600 dark:text-slate-300">{b.note}</span>
          </div>
        ))}
        <div className="pt-2 text-xs text-slate-600 dark:text-slate-300">
          Telegram bot: {tgUsername ? <span className="text-[#22d3a5]">@{tgUsername}</span> : <span className="text-amber-400">awaiting BotFather token</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   PAGE — Sam HQ
   ============================================================ */
export default function SamHQ() {
  const [today, setToday] = useState(todayCT());

  // Refresh "today" if it crosses midnight CT during a long session
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayCT();
      if (t !== today) setToday(t);
    }, 60_000);
    return () => clearInterval(id);
  }, [today]);

  return (
    <div className="min-h-screen p-4 lg:p-6 max-w-7xl mx-auto space-y-4 ops-surface ops-fade-in">
      <PageHeader
        title="Sam HQ"
        subtitle="One command surface. Today's must-do, this week, what shipped, what leaks. Edits sync across devices every 60s."
        icon={<Crown className="w-6 h-6 text-[#22d3a5]" />}
      />

      <TelegramStatusTile />

      <TodaySection today={today} />

      <NextActionsSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThisWeekSection today={today} />
        <ContentCommandSection />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ShippedSection />
        <LeaksSection />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <BotsSection />
      </div>

      <div className="text-center text-xs text-slate-400 pt-4 pb-8 italic">
        Hold the Standard. Average is the disease.
      </div>
    </div>
  );
}

/* ============================================================
   TELEGRAM STATUS TILE — loud amber when not proven, slim when green
   ============================================================ */
function TelegramStatusTile() {
  const { data } = useQuery({
    queryKey: ["sam_hq_telegram_status"],
    queryFn: async () => {
      const [groupsResp, sentResp, settingsResp, usersResp] = await Promise.all([
        supabase.from("telegram_groups").select("chat_id, is_active"),
        supabase.from("telegram_scheduled_messages").select("sent_at").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1),
        supabase.from("system_settings").select("key, value").in("key", ["telegram_bot_username", "telegram_bot_dm_url"]),
        supabase.from("telegram_users").select("chat_id", { count: "exact", head: true }),
      ]);
      const groups = (groupsResp.data ?? []) as Array<{ chat_id: string | number; is_active: boolean }>;
      const isSentinel = (n: string | number) => {
        const v = Number(n);
        return Number.isFinite(v) && v > -1000 && v < 0;
      };
      const bound = groups.filter((g) => !isSentinel(g.chat_id)).length;
      const active = groups.filter((g) => !isSentinel(g.chat_id) && g.is_active).length;
      const settingsMap = new Map((settingsResp.data ?? []).map((s: { key: string; value: unknown }) => [s.key, String(s.value ?? "")]));
      const botUsername = settingsMap.get("telegram_bot_username") ?? "";
      const lastSent = (sentResp.data?.[0] as { sent_at?: string } | undefined)?.sent_at ?? null;
      const registeredChats = usersResp.count ?? 0;

      const checks = [
        Boolean(botUsername),
        registeredChats > 0,
        bound >= 5,
        active >= 5,
        Boolean(lastSent),
      ];
      const greenCount = checks.filter(Boolean).length;
      return { greenCount, total: checks.length, botUsername, registeredChats, bound, lastSent };
    },
    refetchInterval: 60_000,
  });

  if (!data) return null;
  const allGreen = data.greenCount === data.total;

  return (
    <Card className={cn(allGreen ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-amber-500/40 bg-amber-500/[0.05]", "ops-card-depth")}>
      <CardContent className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Send className={cn("w-5 h-5 mt-0.5", allGreen ? "text-emerald-300" : "text-amber-300")} />
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              Telegram Pre-Agent HQ
              <Badge variant="outline" className={cn(allGreen ? "text-emerald-300 border-emerald-500/30" : "text-amber-300 border-amber-500/30", "font-mono text-xs")}>
                {data.greenCount}/{data.total} proven
              </Badge>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {allGreen ? (
                <span className="text-emerald-300">All 5 activation steps green. Bot is live.</span>
              ) : (
                <>BotFather token + 5 channel binds pending. <span className="text-amber-300 font-medium">Open Telegram Bot admin → Activation checklist</span> for the exact 7-step fix.</>
              )}
            </div>
          </div>
        </div>
        <Button asChild size="sm" variant={allGreen ? "outline" : "destructive"}>
          <Link to="/dashboard/admin/telegram-bot">{allGreen ? "Open bot" : "Fix Telegram"}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
