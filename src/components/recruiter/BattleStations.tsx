import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  Phone,
  MessageSquare,
  Clock,
  GraduationCap,
  Target,
  ChevronRight,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type HotLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  license_status: string | null;
  lead_score: number | null;
  last_contacted_at: string | null;
  created_at: string;
  reason: string;
  reasonColor: string;
  urgency: number;
};

function hoursAgo(ts: string | null): number {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 3_600_000;
}

export function BattleStations({ onLeadClick }: { onLeadClick?: (id: string) => void }) {
  const [leads, setLeads] = useState<HotLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    overdue24h: 0,
    licensedReady: 0,
    apptsToday: 0,
    contactedToday: 0,
  });

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      try {
        const todayISO = new Date().toISOString().slice(0, 10);
        const yesterdayISO = new Date(Date.now() - 86400_000).toISOString();

        const { data: apps } = await (supabase
          .from("applications")
          .select("id, first_name, last_name, phone, email, city, state, license_status, lead_score, last_contacted_at, created_at, status")
          .neq("status", "rejected")
          .neq("status", "hired" as any) // 'hired' isn't in the enum; if applied, no rows match — non-breaking
          .order("created_at", { ascending: false })
          .limit(200) as any);

        if (dead) return;

        const list = (apps ?? []) as any[];

        // Build hot-5: prioritize licensed-untouched > 24h > stale-licensed > new-uncontacted
        const scored: HotLead[] = list.map((l) => {
          const hLast = hoursAgo(l.last_contacted_at);
          const hCreate = hoursAgo(l.created_at);
          const score = Number(l.lead_score ?? 50);
          let urgency = 0;
          let reason = "Fresh lead — call now";
          let reasonColor = "border-amber-500/40 text-amber-300 bg-amber-500/10";

          if (l.license_status === "licensed" && !l.last_contacted_at) {
            urgency = 100 + score;
            reason = "Licensed · never contacted";
            reasonColor = "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
          } else if (l.license_status === "licensed" && hLast > 24) {
            urgency = 90 + score - Math.min(hLast / 24, 5);
            reason = `Licensed · ${Math.floor(hLast)}h cold`;
            reasonColor = "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
          } else if (!l.last_contacted_at && hCreate < 24) {
            urgency = 80 + score;
            reason = `New · ${Math.floor(hCreate)}h fresh`;
            reasonColor = "border-pink-500/40 text-pink-300 bg-pink-500/10";
          } else if (hLast > 48) {
            urgency = 50 + score - hLast / 24;
            reason = `Cold ${Math.floor(hLast / 24)}d — re-engage`;
            reasonColor = "border-rose-500/40 text-rose-300 bg-rose-500/10";
          } else {
            urgency = score / 2;
            reason = `Score ${score}`;
            reasonColor = "border-sky-500/40 text-sky-300 bg-sky-500/10";
          }
          return { ...l, urgency, reason, reasonColor } as HotLead;
        });

        scored.sort((a, b) => b.urgency - a.urgency);
        setLeads(scored.slice(0, 5));

        // Stats
        const overdue = list.filter(
          (l) => l.last_contacted_at && hoursAgo(l.last_contacted_at) > 24,
        ).length;
        const licensedReady = list.filter((l) => l.license_status === "licensed").length;
        const contactedToday = list.filter(
          (l) => l.last_contacted_at && l.last_contacted_at.slice(0, 10) === todayISO,
        ).length;

        // scheduled_calls table doesn't exist yet; fall back to scheduled_tasks
        // for now. Empty result is acceptable — UI just shows 0.
        const { count: apptsToday } = await (supabase
          .from("scheduled_tasks" as any)
          .select("id", { count: "exact", head: true })
          .gte("scheduled_for", `${todayISO}T00:00:00Z`)
          .lt("scheduled_for", `${todayISO}T23:59:59Z`) as any);

        setStats({
          overdue24h: overdue,
          licensedReady,
          apptsToday: apptsToday ?? 0,
          contactedToday,
        });
      } catch (e) {
        console.error("BattleStations fetch failed", e);
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, []);

  const markContacted = async (id: string) => {
    try {
      await supabase
        .from("applications")
        .update({ last_contacted_at: new Date().toISOString() } as any)
        .eq("id", id);
      setLeads((prev) => prev.filter((l) => l.id !== id));
      toast.success("Logged. Next 🎯");
    } catch (e: any) {
      toast.error("Failed to log");
    }
  };

  return (
    <GlassCard className="relative overflow-hidden p-5 border-rose-500/30">
      <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />

      <div className="relative space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500/30 to-orange-500/20 border border-rose-500/40">
              <Flame className="h-5 w-5 text-rose-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                Battle Stations
                <Badge className="text-[10px] bg-rose-500/20 text-rose-300 border-rose-500/30 border">LIVE</Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                Your next 5 calls — ranked by urgency
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 flex-1 min-w-0 max-w-md">
            <StatPill icon={Clock} value={stats.overdue24h} label="Cold 24h+" tint="rose" />
            <StatPill icon={GraduationCap} value={stats.licensedReady} label="Licensed" tint="emerald" />
            <StatPill icon={Target} value={stats.apptsToday} label="Appts" tint="amber" />
            <StatPill icon={TrendingUp} value={stats.contactedToday} label="Today" tint="cyan" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            🎉 Inbox zero. Hunt new applications.
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((l, i) => {
              const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Lead";
              return (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 items-center p-3 rounded-xl bg-background/40 border border-border/50 hover:border-rose-500/30 transition-colors"
                >
                  <div className="flex items-center justify-center h-9 w-9 rounded-full bg-gradient-to-br from-rose-500/30 to-orange-500/20 border border-rose-500/40 text-sm font-bold text-rose-200">
                    {i + 1}
                  </div>
                  <button
                    onClick={() => onLeadClick?.(l.id)}
                    className="text-left min-w-0"
                  >
                    <p className="text-sm font-semibold truncate">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <Badge className={cn("border text-[10px] px-1.5 py-0", l.reasonColor)}>
                        {l.reason}
                      </Badge>
                      {l.city && l.state && (
                        <span className="truncate">{l.city}, {l.state}</span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {l.phone && (
                      <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-emerald-400 hover:bg-emerald-500/10" title="Call">
                        <a href={`tel:${l.phone}`} onClick={() => markContacted(l.id)}>
                          <Phone className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {l.phone && (
                      <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-blue-400 hover:bg-blue-500/10" title="Text">
                        <a href={`sms:${l.phone}`} onClick={() => markContacted(l.id)}>
                          <MessageSquare className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Open"
                      onClick={() => onLeadClick?.(l.id)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function StatPill({
  icon: Icon, value, label, tint,
}: {
  icon: any; value: number; label: string; tint: "rose" | "emerald" | "amber" | "cyan";
}) {
  const palette: Record<string, string> = {
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-300",
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
  };
  return (
    <div className={cn("p-2 rounded-lg border flex items-center gap-2 min-w-0", palette[tint])}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-bold tabular-nums leading-none">{value}</p>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight truncate">{label}</p>
      </div>
    </div>
  );
}
