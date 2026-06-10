import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  GraduationCap, Flame, Clock, AlertTriangle, CheckCircle2,
  Phone, Mail, RefreshCw, Search, Users, Calendar,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

interface Row {
  student_email: string;
  student_name: string | null;
  last_login: string | null;
  xcel_state: "active" | "recent" | "stalled" | "never_started";
  days_since_login: number | null;
  application_id: string | null;
  app_first_name: string | null;
  app_last_name: string | null;
  app_phone: string | null;
  license_status: string | null;
  license_progress: string | null;
  manager_name: string | null;
  manager_avatar: string | null;
  action_label: string | null;
}

const STATE_META: Record<Row["xcel_state"], { label: string; color: string; Icon: any; tint: string }> = {
  active:        { label: "Active",        color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", Icon: Flame,         tint: "from-emerald-500/20 to-transparent" },
  recent:        { label: "Recent",        color: "text-amber-300 border-amber-500/40 bg-amber-500/10",       Icon: Clock,         tint: "from-amber-500/20 to-transparent" },
  stalled:       { label: "Stalled",       color: "text-rose-300 border-rose-500/40 bg-rose-500/10",          Icon: AlertTriangle, tint: "from-rose-500/20 to-transparent" },
  never_started: { label: "Never started", color: "text-slate-600 dark:text-slate-300 border-slate-500/40 bg-slate-500/10",       Icon: GraduationCap, tint: "from-slate-500/20 to-transparent" },
};

const STATE_ORDER: Row["xcel_state"][] = ["never_started", "stalled", "recent", "active"];

export default function XcelPipeline() {
  usePageTitle("Xcel Pipeline · APEX Financial");
  const [filter, setFilter] = useState<"all" | Row["xcel_state"]>("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], refetch, isFetching } = useQuery({
    queryKey: ["v_xcel_pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_xcel_pipeline" as any)
        .select("*")
        .order("last_login", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Row[];
    },
    staleTime: 60_000,
  });

  const counts = useMemo(() => {
    const c = { active: 0, recent: 0, stalled: 0, never_started: 0 };
    for (const r of rows) c[r.xcel_state] = (c[r.xcel_state] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== "all" && r.xcel_state !== filter) return false;
      if (!q) return true;
      return (r.student_name || "").toLowerCase().includes(q)
        || r.student_email.toLowerCase().includes(q)
        || (r.manager_name || "").toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <PageHeader
        accent="purple"
        eyebrow="Recruiting · Pre-Licensing"
        eyebrowIcon={<GraduationCap className="h-3 w-3" />}
        title="Xcel Pipeline"
        subtitle="Every paid pre-licensing student. State derived from XCEL last-login. Sync runs daily."
        actions={
          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4 mr-1.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* State chips */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-md border bg-card p-4 text-left transition",
            filter === "all" && "ring-2 ring-primary/40"
          )}
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total</div>
          <div className="text-2xl font-bold tabular-nums">{rows.length}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Users className="h-3 w-3" /> Students</div>
        </button>
        {STATE_ORDER.map(s => {
          const m = STATE_META[s];
          const n = counts[s] || 0;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-md border p-4 text-left transition relative overflow-hidden",
                m.color,
                filter === s && "ring-2 ring-primary/40"
              )}
            >
              <div className={cn("absolute inset-0  opacity-50", m.tint)} />
              <div className="relative">
                <div className="text-xs uppercase tracking-wide opacity-80">{m.label}</div>
                <div className="text-2xl font-bold tabular-nums mt-0.5">{n}</div>
                <div className="text-xs opacity-75 mt-1 flex items-center gap-1"><m.Icon className="h-3 w-3" /> {s.replace("_", " ")}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or manager…"
          className="pl-9"
        />
      </div>

      {/* List */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="divide-y divide-border">
          {filtered.length === 0 && (
            <div className="p-10 text-center text-muted-foreground text-sm">
              No students match this filter.
            </div>
          )}
          {filtered.map(r => {
            const m = STATE_META[r.xcel_state];
            const initials = (r.student_name || r.student_email)
              .split(/[\s.@]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map(s => s[0]?.toUpperCase())
              .join("");
            return (
              <div key={r.student_email} className="p-4 flex items-start gap-3 hover:bg-muted/30 transition">
                <div className="h-10 w-10 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center font-bold text-sm text-white shrink-0">
                  {initials || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{r.student_name || r.student_email.split("@")[0]}</span>
                    <Badge variant="outline" className={cn("text-[10px] gap-1", m.color)}>
                      <m.Icon className="h-3 w-3" /> {m.label}
                    </Badge>
                    {r.license_progress && (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {r.license_progress.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {!r.application_id && (
                      <Badge variant="outline" className="text-[10px] text-rose-300 border-rose-500/40 bg-rose-500/10">
                        No CRM record
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                    <span>{r.student_email}</span>
                    {r.app_phone && <span>📱 {r.app_phone}</span>}
                    {r.last_login ? (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        last login {r.days_since_login}d ago
                      </span>
                    ) : (
                      <span className="text-rose-300">never logged in</span>
                    )}
                  </div>
                  {r.manager_name && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                      <Avatar className="h-4 w-4">
                        {r.manager_avatar && <AvatarImage src={r.manager_avatar} />}
                        <AvatarFallback className="text-[8px]">M</AvatarFallback>
                      </Avatar>
                      Manager: <span className="text-foreground">{r.manager_name}</span>
                    </div>
                  )}
                  {r.action_label && (
                    <div className="text-xs text-primary mt-1">→ {r.action_label}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {r.app_phone && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[11px] gap-1">
                      <a href={`tel:${r.app_phone}`}><Phone className="h-3 w-3" /> Call</a>
                    </Button>
                  )}
                  {r.student_email && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-[11px] gap-1">
                      <a href={`mailto:${r.student_email}?subject=${encodeURIComponent("Quick check-in on your APEX licensing course")}`}>
                        <Mail className="h-3 w-3" /> Email
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <p className="text-xs text-muted-foreground">
        Source: <code>v_xcel_pipeline</code> · refreshed when Mac launchd <code>com.samjames.xcel-applicant-sync</code> fires.
      </p>
    </div>
  );
}
