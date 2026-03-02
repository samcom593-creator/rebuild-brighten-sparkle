import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck, AlertTriangle, BookOpen } from "lucide-react";
import { getTodayPST } from "@/lib/dateUtils";
import { startOfWeek, format } from "date-fns";

interface CheckinRow {
  id: string;
  application_id: string;
  checkin_date: string;
  license_progress: string | null;
  study_hours: number;
  test_scheduled: boolean;
  blocker: string | null;
  notes: string | null;
  first_name?: string;
  last_name?: string;
}

export function CheckinActivityPanel() {
  const [checkins, setCheckins] = useState<CheckinRow[]>([]);
  const [loading, setLoading] = useState(true);

  const todayPST = getTodayPST();
  const weekStart = format(startOfWeek(new Date(todayPST), { weekStartsOn: 1 }), "yyyy-MM-dd");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("applicant_checkins")
        .select("*")
        .gte("checkin_date", weekStart)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        // Fetch applicant names
        const appIds = [...new Set(data.map(c => c.application_id))];
        const { data: apps } = await supabase
          .from("applications")
          .select("id, first_name, last_name")
          .in("id", appIds);

        const nameMap = new Map((apps || []).map(a => [a.id, a]));
        const enriched = data.map(c => ({
          ...c,
          first_name: nameMap.get(c.application_id)?.first_name || "Unknown",
          last_name: nameMap.get(c.application_id)?.last_name || "",
        }));
        setCheckins(enriched);
      }
      setLoading(false);
    })();
  }, []);

  const todayCheckins = checkins.filter(c => c.checkin_date === todayPST);
  const blockersCount = checkins.filter(c => c.blocker).length;

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        Daily Check-Ins
        <Badge variant="outline" className="ml-auto text-xs">{todayCheckins.length} today</Badge>
      </h3>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-primary/5 border border-primary/10">
          <p className="text-lg font-bold text-foreground">{todayCheckins.length}</p>
          <p className="text-[10px] text-muted-foreground">Today</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50 border border-border">
          <p className="text-lg font-bold text-foreground">{checkins.length}</p>
          <p className="text-[10px] text-muted-foreground">This Week</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <p className="text-lg font-bold text-foreground">{blockersCount}</p>
          <p className="text-[10px] text-muted-foreground">Blockers</p>
        </div>
      </div>

      {/* Recent checkins */}
      {todayCheckins.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No check-ins today yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {todayCheckins.slice(0, 8).map(c => (
            <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-card/50 border border-border text-xs">
              <BookOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="font-medium truncate">{c.first_name} {c.last_name}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{c.license_progress?.replace(/_/g, " ") || "—"}</Badge>
              {c.blocker && <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
