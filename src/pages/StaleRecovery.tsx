import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Phone,
  MessageCircle,
  Mail,
  Send,
  UserCheck,
  Snowflake,
  Flame,
  Clock,
  ArrowRight,
  Ghost,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface StaleRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  license_status: string;
  status: string;
  assigned_agent_id: string | null;
  instagram_handle: string | null;
  created_at: string;
  hours_since_application: number;
  staleness: "fresh" | "stale" | "icy" | "cold";
  assigned_manager_name: string | null;
  assigned_manager_avatar: string | null;
}

const stalenessConfig: Record<StaleRow["staleness"], { label: string; cls: string; icon: any }> = {
  fresh: { label: "Fresh", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Flame },
  stale: { label: "Stale (24h)", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Clock },
  icy:   { label: "Icy (72h+)", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", icon: Snowflake },
  cold:  { label: "Cold (7d+)", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: Snowflake },
};

export default function StaleRecovery() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "stale" | "icy" | "cold">("all");

  const { data: rows, isLoading } = useQuery<StaleRow[]>({
    queryKey: ["stale-applicants"],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_stale_applicants")
        .select(
          "id, first_name, last_name, email, phone, city, state, license_status, status, assigned_agent_id, instagram_handle, created_at, hours_since_application, staleness, assigned_manager_name, assigned_manager_avatar",
        )
        .order("hours_since_application", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaleRow[];
    },
  });

  const { data: funnel } = useQuery({
    queryKey: ["application-conversion-funnel"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_application_conversion_funnel")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.staleness === filter);
  }, [rows, filter]);

  async function callAction(applicationId: string, action: "mark_contacted" | "ghost" | "dismiss") {
    const { data, error } = await (supabase.rpc as any)("fn_recover_stale_applicant", {
      p_application_id: applicationId,
      p_action: action,
      p_new_agent_id: null,
      p_note: action === "dismiss" ? "Cleared via Stale Recovery panel" : null,
    });
    if (error || !data?.ok) {
      toast.error(data?.error || error?.message || "Action failed");
      return;
    }
    toast.success(`Marked ${action.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["stale-applicants"] });
    qc.invalidateQueries({ queryKey: ["application-conversion-funnel"] });
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <PageHeader
        title="Stale Applicant Recovery"
        description="Applicants who applied >24h ago and no one has contacted yet. Reach out, reassign, or dismiss."
      />

      {/* Funnel snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Applied (7d)", value: funnel?.applied_7d ?? 0 },
          { label: "Manager Assigned (7d)", value: funnel?.assigned_7d ?? 0 },
          { label: "Contacted (7d)", value: funnel?.contacted_7d ?? 0 },
          { label: "Open Stale", value: funnel?.stale_open_total ?? rows?.length ?? 0 },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
          </GlassCard>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stale ({rows?.length ?? 0})</SelectItem>
            <SelectItem value="stale">Stale (24h+)</SelectItem>
            <SelectItem value="icy">Icy (72h+)</SelectItem>
            <SelectItem value="cold">Cold (7d+)</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["stale-applicants"] })}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading stale applicants…</p>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Flame className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
          <p className="font-semibold">No stale applicants in this bucket.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Every applicant who came in &gt;24h ago has been contacted. Hold the Standard.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const cfg = stalenessConfig[r.staleness];
            const StIcon = cfg.icon;
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <GlassCard className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                    <Avatar className="h-12 w-12 ring-1 ring-border/60">
                      <AvatarImage src={r.assigned_manager_avatar ?? undefined} alt={r.assigned_manager_name ?? "Unassigned"} />
                      <AvatarFallback>{(r.first_name?.[0] ?? "?")}{(r.last_name?.[0] ?? "")}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-base">
                          {r.first_name} {r.last_name}
                        </p>
                        <Badge variant="outline" className={cfg.cls}>
                          <StIcon className="h-3 w-3 mr-1" /> {cfg.label}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {r.license_status}
                        </Badge>
                        {!r.assigned_manager_name ? (
                          <Badge variant="outline" className="bg-rose-500/10 text-rose-300 border-rose-500/30">
                            <AlertTriangle className="h-3 w-3 mr-1" /> No manager
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>{Math.round(r.hours_since_application)}h since apply</span>
                        {r.city || r.state ? <span>{[r.city, r.state].filter(Boolean).join(", ")}</span> : null}
                        {r.assigned_manager_name ? (
                          <span>Mgr: <span className="text-foreground">{r.assigned_manager_name}</span></span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        {r.phone ? (
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Phone className="h-3.5 w-3.5" /> {r.phone}
                          </a>
                        ) : null}
                        <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Mail className="h-3.5 w-3.5" /> {r.email}
                        </a>
                        {r.phone ? (
                          <a
                            href={`sms:${r.phone}?body=${encodeURIComponent(`Hey ${r.first_name}, this is APEX Financial — saw your application. Quick text to confirm: are you still looking to get started with insurance recruiting?`)}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <MessageCircle className="h-3.5 w-3.5" /> SMS template
                          </a>
                        ) : null}
                        {r.instagram_handle ? (
                          <a href={`https://instagram.com/${r.instagram_handle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Send className="h-3.5 w-3.5" /> @{r.instagram_handle}
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:flex-col md:gap-1">
                      <Button size="sm" onClick={() => callAction(r.id, "mark_contacted")}>
                        <UserCheck className="h-4 w-4 mr-1" /> Mark Contacted
                      </Button>
                      <Link to={`/dashboard/applicants?id=${r.id}`}>
                        <Button size="sm" variant="outline" className="w-full">
                          Open <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" className="text-amber-300 border-amber-500/30 hover:bg-amber-500/10" onClick={() => callAction(r.id, "ghost")}>
                        <Ghost className="h-4 w-4 mr-1" /> Ghost
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
