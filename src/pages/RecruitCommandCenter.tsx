import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Target, Phone, Mail, MessageSquare, Flame, Snowflake, Clock,
  CheckCircle2, Search, ChevronRight, Sparkles, Users, RefreshCw, Loader2,
  UserCheck, FileCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { coinRain, screenFlash, levelUpBanner } from "@/lib/gameFx";

interface Applicant {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  lead_score: number | null;
  license_status: string | null;
  license_progress: string | null;
  contacted_at: string | null;
  last_contacted_at: string | null;
  created_at: string;
  status: string;
}

type Bucket = "hot" | "warm" | "cold" | "ghosted";

function bucketOf(a: Applicant): Bucket {
  const score = a.lead_score ?? 0;
  const hoursContacted = a.last_contacted_at
    ? (Date.now() - new Date(a.last_contacted_at).getTime()) / 3600000
    : 9999;
  const hoursCreated = (Date.now() - new Date(a.created_at).getTime()) / 3600000;
  if (!a.contacted_at && hoursCreated < 48)   return "hot";
  if (hoursContacted < 48 && score >= 70)     return "hot";
  if (hoursContacted < 168 && score >= 50)    return "warm";
  if (hoursContacted > 168)                   return "ghosted";
  return "cold";
}

const BUCKET_META: Record<Bucket, { label: string; icon: any; tint: string; color: string }> = {
  hot:     { label: "🔥 Hot",     icon: Flame,       tint: "from-rose-500/20 to-orange-500/10 border-rose-500/40", color: "text-rose-300" },
  warm:    { label: "☀️ Warm",    icon: Sparkles,    tint: "from-amber-500/15 to-yellow-500/5 border-amber-500/40", color: "text-amber-300" },
  cold:    { label: "❄️ Cold",   icon: Snowflake,   tint: "from-sky-500/10 to-blue-500/5 border-sky-500/30",       color: "text-sky-300" },
  ghosted: { label: "👻 Ghosted", icon: Clock,       tint: "from-slate-500/10 to-slate-700/5 border-slate-500/30",  color: "text-slate-300" },
};

export default function RecruitCommandCenter() {
  const { isAdmin, isManager } = useAuth();
  const [apps, setApps] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<Bucket | "all">("hot");
  const [contractedWeek, setContractedWeek] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const sinceWeek = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ data: list }, { count: ctw }] = await Promise.all([
        // Exclude hired (closed_at) too — Sam: hired people kept appearing
        // in the recruit funnel even after being marked through.
        supabase.from("applications")
          .select("id, first_name, last_name, email, phone, state, city, lead_score, license_status, license_progress, contacted_at, last_contacted_at, created_at, status")
          .is("terminated_at", null).is("contracted_at", null).is("closed_at", null)
          .order("created_at", { ascending: false }).limit(400),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("contracted_at", sinceWeek).is("terminated_at", null),
      ]);
      setApps((list ?? []) as Applicant[]);
      setContractedWeek((ctw as any) ?? 0);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const bucketed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps
      .map(a => ({ a, b: bucketOf(a) }))
      .filter(x => bucket === "all" || x.b === bucket)
      .filter(x => !q || `${x.a.first_name} ${x.a.last_name}`.toLowerCase().includes(q) || (x.a.state ?? "").toLowerCase().includes(q));
  }, [apps, search, bucket]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { hot: 0, warm: 0, cold: 0, ghosted: 0 };
    for (const a of apps) c[bucketOf(a)]++;
    return c;
  }, [apps]);

  // Dynamic target: 1 per 15 live pipeline, capped 5, minimum 1
  const targetToday = Math.min(5, Math.max(1, Math.ceil(apps.length / 15)));
  const pctToTarget = targetToday > 0 ? Math.min(100, Math.round((contractedWeek % targetToday) / targetToday * 100)) : 0;

  const markContacted = async (a: Applicant) => {
    setMarking(a.id);
    try {
      const isFirstContact = !a.contacted_at;
      const { error } = await supabase.from("applications")
        .update({ last_contacted_at: new Date().toISOString(), contacted_at: a.contacted_at ?? new Date().toISOString() })
        .eq("id", a.id);
      if (error) throw error;
      toast.success(`${a.first_name} marked contacted`);
      if (isFirstContact) {
        screenFlash("emerald", 400);
        coinRain(12, 2000);
        levelUpBanner(`FIRST TOUCH · ${a.first_name.toUpperCase()}`, 2600);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setMarking(null); }
  };

  // Mark hired directly from the Recruit page (Sam: "I called Kyle, marked
  // him hired, nothing happened" — that was on a different page; this lets
  // him do it from here so the applicant disappears from the funnel
  // immediately).
  const markHired = async (a: Applicant) => {
    setMarking(a.id);
    try {
      const nowISO = new Date().toISOString();
      const { error } = await supabase.from("applications")
        .update({ closed_at: nowISO, contacted_at: a.contacted_at ?? nowISO })
        .eq("id", a.id);
      if (error) throw error;
      toast.success(`🎉 ${a.first_name} marked HIRED`);
      screenFlash("emerald", 600);
      coinRain(28, 3000);
      levelUpBanner(`HIRED · ${a.first_name.toUpperCase()} ${a.last_name?.toUpperCase() ?? ""}`, 3000);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to mark hired");
    } finally { setMarking(null); }
  };

  const markContracted = async (a: Applicant) => {
    setMarking(a.id);
    try {
      const nowISO = new Date().toISOString();
      const { error } = await supabase.from("applications")
        .update({
          contracted_at: nowISO,
          closed_at: a.contacted_at ?? nowISO, // contracted implies hired first
          contacted_at: a.contacted_at ?? nowISO,
        })
        .eq("id", a.id);
      if (error) throw error;
      toast.success(`💎 ${a.first_name} CONTRACTED`);
      screenFlash("violet", 600);
      coinRain(40, 3500);
      levelUpBanner(`CONTRACTED · ${a.first_name.toUpperCase()} ${a.last_name?.toUpperCase() ?? ""}`, 3200);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to mark contracted");
    } finally { setMarking(null); }
  };

  if (!isAdmin && !isManager) {
    return <div className="p-8 text-center text-muted-foreground">Manager/admin access only.</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <PageHeader
        accent="rose"
        eyebrow="Recruiting · Command"
        eyebrowIcon={<Target className="h-3 w-3" />}
        title="Recruit Command"
        subtitle="Live applicant queue · close the gap to today's target. Hot/Cold scoring, call/text/email in one click."
        actions={
          <Button onClick={load} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {/* Today's target + progress */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-4 bg-gradient-to-br from-rose-500/15 to-transparent border-rose-500/30 win-glow">
          <div className="flex items-center gap-2 mb-1"><Target className="h-4 w-4 text-rose-400" /><span className="text-[10px] uppercase tracking-wider text-rose-300">Target Today</span></div>
          <div className="text-3xl font-bold tabular-nums text-rose-300">{targetToday}</div>
          <div className="text-[11px] text-muted-foreground">close today</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-4 w-4 text-emerald-400" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Contracted 7d</span></div>
          <div className="text-3xl font-bold tabular-nums text-emerald-300">{contractedWeek}</div>
          <div className="text-[11px] text-muted-foreground">week-to-date</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-primary" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live Pipeline</span></div>
          <div className="text-3xl font-bold tabular-nums">{apps.length}</div>
          <div className="text-[11px] text-muted-foreground">not contracted / terminated</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><Flame className="h-4 w-4 text-rose-400" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Hot Right Now</span></div>
          <div className="text-3xl font-bold tabular-nums text-rose-300">{counts.hot}</div>
          <div className="text-[11px] text-muted-foreground">fresh + high-intent</div>
        </GlassCard>
      </div>

      {/* Bucket filters + search */}
      <GlassCard className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or state…" className="pl-9 h-9" />
        </div>
        {(["hot","warm","cold","ghosted","all"] as const).map(b => (
          <button key={b} onClick={() => setBucket(b)}
            className={cn(
              "px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
              bucket === b ? "bg-primary/20 border-primary text-primary" : "border-border/50 hover:border-primary/40 hover:bg-muted/30"
            )}>
            {b === "all" ? `All (${apps.length})` : `${BUCKET_META[b].label} (${counts[b]})`}
          </button>
        ))}
      </GlassCard>

      {/* Queue */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-muted/20 rounded-xl animate-pulse" />)}
        </div>
      ) : bucketed.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          No applicants in this bucket. {bucket === "hot" && "👀 Hot queue is empty — push stale to re-engage."}
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {bucketed.map(({ a, b }) => {
            const meta = BUCKET_META[b];
            return (
              <GlassCard key={a.id} className={cn(
                "p-3 transition-all leaderboard-row relative bg-gradient-to-r",
                meta.tint
              )}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="shrink-0">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/40 to-violet-500/30 flex items-center justify-center font-bold text-sm text-white">
                      {a.first_name?.[0]}{a.last_name?.[0]}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{a.first_name} {a.last_name}</span>
                      <Badge className={cn("text-[10px] border bg-transparent", meta.color)}>{meta.label}</Badge>
                      {a.lead_score !== null && (
                        <Badge variant="outline" className="text-[10px]">AI {a.lead_score}</Badge>
                      )}
                      {a.license_status === "licensed" && (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">Licensed</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                      {a.state && <span>{a.state}</span>}
                      {a.phone && <span>{a.phone}</span>}
                      {a.last_contacted_at
                        ? <span>last contact {formatDistanceToNowStrict(new Date(a.last_contacted_at), { addSuffix: true })}</span>
                        : <span className="text-rose-300">never contacted</span>}
                      <span>applied {formatDistanceToNowStrict(new Date(a.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap ml-auto">
                    {a.phone && (
                      <Button asChild size="sm" variant="outline" className="gap-1.5 h-8">
                        <a href={`tel:${a.phone}`}><Phone className="h-3 w-3" /> Call</a>
                      </Button>
                    )}
                    {a.phone && (
                      <Button asChild size="sm" variant="outline" className="gap-1.5 h-8">
                        <a href={`sms:${a.phone}?body=${encodeURIComponent(`Hey ${a.first_name}, Sam from APEX — got a sec to chat about your application?`)}`}>
                          <MessageSquare className="h-3 w-3" /> SMS
                        </a>
                      </Button>
                    )}
                    {a.email && (
                      <Button asChild size="sm" variant="outline" className="gap-1.5 h-8">
                        <a href={`mailto:${a.email}?subject=APEX Financial — quick call?`}>
                          <Mail className="h-3 w-3" /> Email
                        </a>
                      </Button>
                    )}
                    <Button onClick={() => markContacted(a)} size="sm" variant="outline" className="gap-1.5 h-8" disabled={marking === a.id}>
                      {marking === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Contacted
                    </Button>
                    <Button
                      onClick={() => markHired(a)}
                      size="sm"
                      className="gap-1.5 h-8 bg-emerald-500 hover:bg-emerald-600 text-white"
                      disabled={marking === a.id}
                      title="Mark Hired (closed_at = now)"
                    >
                      <UserCheck className="h-3 w-3" /> Hired
                    </Button>
                    <Button
                      onClick={() => markContracted(a)}
                      size="sm"
                      className="gap-1.5 h-8 bg-violet-500 hover:bg-violet-600 text-white"
                      disabled={marking === a.id}
                      title="Mark Contracted (contracted_at = now)"
                    >
                      <FileCheck className="h-3 w-3" /> Contracted
                    </Button>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
