import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Search, Phone, MessageSquare, Mail, Eye, Send, UserX,
  Flame, AlertTriangle, CheckCircle2, Clock, TrendingUp, KeyRound,
  LayoutGrid, Table as TableIcon, Columns, X,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { getBusinessMonthBounds, getBusinessWeekBounds } from "@/lib/dateUtils";

// ─── Types ─────────────────────────────────────────────────────
interface AgentRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: "admin" | "manager" | "agent";
  onboardingStage: string;
  licenseStatus: string;
  isDeactivated: boolean;
  isPresenting: boolean;
  stageChangedAt: string | null;
  lastProductionDate: string | null;
  lifetimeAlp: number;
  weekAlp: number;
  monthAlp: number;
  health: "green" | "yellow" | "red";
}

type ViewMode = "board" | "table" | "pipeline";
type SortKey = "name" | "weekAlp" | "monthAlp" | "lifetimeAlp" | "lastLogged" | "health";

const STAGE_OPTIONS = [
  { value: "__all__", label: "All stages" },
  { value: "applied", label: "Applied" },
  { value: "onboarding", label: "Onboarding" },
  { value: "pre_licensed", label: "Pre-Licensed" },
  { value: "training_online", label: "Training Online" },
  { value: "transfer", label: "Transfer" },
  { value: "in_field_training", label: "Field Training" },
  { value: "live", label: "Live" },
  { value: "evaluated", label: "Evaluated" },
  { value: "inactive", label: "Inactive" },
];

const LICENSE_OPTIONS = [
  { value: "__all__", label: "Any license" },
  { value: "licensed", label: "Licensed" },
  { value: "unlicensed", label: "Unlicensed" },
];

// ─── Health calculation ───────────────────────────────────────
function computeHealth(row: {
  lastProductionDate: string | null;
  stageChangedAt: string | null;
  isDeactivated: boolean;
  onboardingStage: string;
}): "green" | "yellow" | "red" {
  if (row.isDeactivated || row.onboardingStage === "inactive") return "red";
  const daysSinceProd = row.lastProductionDate
    ? (Date.now() - new Date(row.lastProductionDate).getTime()) / 86400000
    : 999;
  const daysSinceStage = row.stageChangedAt
    ? (Date.now() - new Date(row.stageChangedAt).getTime()) / 86400000
    : 999;
  if (daysSinceProd <= 3) return "green";
  if (daysSinceProd <= 7 || daysSinceStage <= 7) return "yellow";
  return "red";
}

const healthStyle = {
  green: { ring: "ring-emerald-500/40", dot: "bg-emerald-500", label: "Healthy" },
  yellow: { ring: "ring-amber-500/40", dot: "bg-amber-500", label: "Watch" },
  red: { ring: "ring-red-500/40", dot: "bg-red-500", label: "Risk" },
};

// ─── Main Component ───────────────────────────────────────────
export default function AgentManagement() {
  const { isAdmin, isManager } = useAuth();
  const queryClient = useQueryClient();
  const { data: downlineIds = [] } = useMyDownline();

  const [view, setView] = useState<ViewMode>("board");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("__all__");
  const [licenseFilter, setLicenseFilter] = useState("__all__");
  const [producingOnly, setProducingOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("weekAlp");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<"sms" | "email" | "portal_logins" | "deactivate" | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [quickEditId, setQuickEditId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["agent-mgmt-rows", isAdmin, downlineIds.join(",")],
    queryFn: async (): Promise<AgentRow[]> => {
      let agentQ = supabase
        .from("agents")
        .select(`
          id, user_id, display_name, is_deactivated, is_presenting, stage_changed_at,
          onboarding_stage, license_status, created_at,
          profile:profiles!agents_profile_id_fkey(full_name, email, phone, avatar_url)
        `);

      // Always scope non-admin reads. Empty downline must filter to nothing
      // rather than silently dropping the scope and returning all agents.
      if (!isAdmin) {
        if (downlineIds.length === 0) {
          agentQ = agentQ.in("id", ["00000000-0000-0000-0000-000000000000"]);
        } else {
          agentQ = agentQ.in("id", downlineIds);
        }
      }

      const { data: agents } = await agentQ;

      const userIds = (agents || []).map((a: any) => a.user_id).filter(Boolean);
      const { data: roles } = userIds.length
        ? await supabase.from("user_roles").select("user_id, role").in("user_id", userIds)
        : { data: [] as any[] };
      const roleMap = new Map<string, "admin" | "manager" | "agent">(
        (roles || []).map((r: any) => [r.user_id, r.role as any]),
      );

      const agentIds = (agents || []).map((a: any) => a.id);

      const weekBounds = getBusinessWeekBounds();
      const monthBounds = getBusinessMonthBounds();

      const [prodWeek, prodMonth, prodLast] = agentIds.length
        ? await Promise.all([
            supabase.from("deals").select("agent_id, annual_premium").in("agent_id", agentIds)
              .gte("posted_at", weekBounds.startIso)
              .lt("posted_at", weekBounds.endIso)
              .in("status", ["submitted", "active"]),
            supabase.from("deals").select("agent_id, annual_premium").in("agent_id", agentIds)
              .gte("posted_at", monthBounds.startIso)
              .lt("posted_at", monthBounds.endIso)
              .in("status", ["submitted", "active"]),
            supabase.from("agent_lifetime_production" as any)
              .select("agent_id, lifetime_alp, last_production_date")
              .in("agent_id", agentIds),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }];

      const weekMap = new Map<string, number>();
      for (const r of (prodWeek.data || []) as any[]) {
        weekMap.set(r.agent_id, (weekMap.get(r.agent_id) || 0) + Number(r.annual_premium || 0));
      }
      const monthMap = new Map<string, number>();
      for (const r of (prodMonth.data || []) as any[]) {
        monthMap.set(r.agent_id, (monthMap.get(r.agent_id) || 0) + Number(r.annual_premium || 0));
      }
      const lifetimeMap = new Map<string, { lifetime: number; last: string | null }>();
      for (const r of (prodLast.data || []) as any[]) {
        lifetimeMap.set(r.agent_id, {
          lifetime: Number(r.lifetime_alp || 0),
          last: r.last_production_date || null,
        });
      }

      return (agents || []).map((a: any): AgentRow => {
        const profile = a.profile;
        const lifetime = lifetimeMap.get(a.id);
        const health = computeHealth({
          lastProductionDate: lifetime?.last || null,
          stageChangedAt: a.stage_changed_at,
          isDeactivated: a.is_deactivated,
          onboardingStage: a.onboarding_stage,
        });
        return {
          id: a.id,
          name: profile?.full_name || a.display_name || "Unknown",
          email: profile?.email || "",
          phone: profile?.phone || null,
          avatarUrl: profile?.avatar_url || null,
          role: roleMap.get(a.user_id) || "agent",
          onboardingStage: a.onboarding_stage || "onboarding",
          licenseStatus: a.license_status || "unlicensed",
          isDeactivated: a.is_deactivated || false,
          isPresenting: a.is_presenting || false,
          stageChangedAt: a.stage_changed_at,
          lastProductionDate: lifetime?.last || null,
          lifetimeAlp: lifetime?.lifetime || 0,
          weekAlp: weekMap.get(a.id) || 0,
          monthAlp: monthMap.get(a.id) || 0,
          health,
        };
      });
    },
    enabled: !!(isAdmin || isManager),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.phone || "").includes(q),
      );
    }
    if (stageFilter !== "__all__") out = out.filter(r => r.onboardingStage === stageFilter);
    if (licenseFilter !== "__all__") out = out.filter(r => r.licenseStatus === licenseFilter);
    if (producingOnly) out = out.filter(r => r.weekAlp > 0 || r.monthAlp > 0);

    const sorted = [...out].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name);
        case "weekAlp": return b.weekAlp - a.weekAlp;
        case "monthAlp": return b.monthAlp - a.monthAlp;
        case "lifetimeAlp": return b.lifetimeAlp - a.lifetimeAlp;
        case "lastLogged": {
          const aT = a.lastProductionDate ? new Date(a.lastProductionDate).getTime() : 0;
          const bT = b.lastProductionDate ? new Date(b.lastProductionDate).getTime() : 0;
          return bT - aT;
        }
        case "health": {
          const order = { red: 0, yellow: 1, green: 2 };
          return order[a.health] - order[b.health];
        }
      }
    });
    return sorted;
  }, [rows, search, stageFilter, licenseFilter, producingOnly, sortKey]);

  const counts = useMemo(() => ({
    total: rows.length,
    healthy: rows.filter(r => r.health === "green").length,
    watch: rows.filter(r => r.health === "yellow").length,
    risk: rows.filter(r => r.health === "red").length,
    presenting: rows.filter(r => r.isPresenting).length,
  }), [rows]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelectedIds(new Set(filtered.map(r => r.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const runBulk = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.error("Select agents first"); return; }

    if (bulkAction === "portal_logins") {
      const { error } = await supabase.functions.invoke("send-bulk-portal-logins", {
        body: { agent_ids: ids },
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`Portal logins sent to ${ids.length} agents`);
    } else if (bulkAction === "sms" || bulkAction === "email") {
      const { error } = await supabase.functions.invoke("bulk-agent-message", {
        body: { agent_ids: ids, channel: bulkAction, message: bulkMessage },
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`${bulkAction.toUpperCase()} sent to ${ids.length} agents`);
    } else if (bulkAction === "deactivate") {
      const { error } = await supabase.from("agents")
        .update({ is_deactivated: true, onboarding_stage: "inactive" })
        .in("id", ids);
      if (error) { toast.error(error.message); return; }
      toast.success(`Deactivated ${ids.length} agents`);
      queryClient.invalidateQueries({ queryKey: ["agent-mgmt-rows"] });
    }

    setBulkDialogOpen(false);
    setBulkMessage("");
    clearSelection();
  };

  if (!isAdmin && !isManager) {
    return <div className="p-6 text-muted-foreground">Manager or admin access required.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/10 border border-primary/30">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Agent Management</h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "All agents in your agency" : "Your downline"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {[
            { k: "board", icon: LayoutGrid, label: "Board" },
            { k: "table", icon: TableIcon, label: "Table" },
            { k: "pipeline", icon: Columns, label: "Pipeline" },
          ].map(v => {
            const Icon = v.icon;
            return (
              <Button
                key={v.k}
                size="sm"
                variant={view === v.k ? "default" : "ghost"}
                className="h-8 gap-1.5"
                onClick={() => setView(v.k as ViewMode)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{v.label}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatPill label="Total" value={counts.total} />
        <StatPill label="Healthy" value={counts.healthy} color="emerald" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setStageFilter("__all__"); setProducingOnly(true); setSortKey("health"); }} />
        <StatPill label="Watch" value={counts.watch} color="amber" icon={<Clock className="h-4 w-4" />} />
        <StatPill label="Risk" value={counts.risk} color="red" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setSortKey("health")} />
        <StatPill label="Presenting Now" value={counts.presenting} color="rose" icon={<Flame className="h-4 w-4" />} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>{STAGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={licenseFilter} onValueChange={setLicenseFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>{LICENSE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button
          size="sm"
          variant={producingOnly ? "default" : "outline"}
          onClick={() => setProducingOnly(v => !v)}
          className="gap-1.5"
        >
          <TrendingUp className="h-3.5 w-3.5" /> Producing only
        </Button>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="weekAlp">Sort: Week ALP</SelectItem>
            <SelectItem value="monthAlp">Sort: Month ALP</SelectItem>
            <SelectItem value="lifetimeAlp">Sort: Lifetime</SelectItem>
            <SelectItem value="lastLogged">Sort: Last Logged</SelectItem>
            <SelectItem value="health">Sort: Health</SelectItem>
            <SelectItem value="name">Sort: Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5 backdrop-blur">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { setBulkAction("sms"); setBulkDialogOpen(true); }}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> SMS
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setBulkAction("email"); setBulkDialogOpen(true); }}>
              <Mail className="h-3.5 w-3.5 mr-1" /> Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setBulkAction("portal_logins"); setBulkDialogOpen(true); }}>
              <KeyRound className="h-3.5 w-3.5 mr-1" /> Portal Logins
            </Button>
            {isAdmin && (
              <Button size="sm" variant="outline" className="text-red-400 hover:bg-red-500/10" onClick={() => { setBulkAction("deactivate"); setBulkDialogOpen(true); }}>
                <UserX className="h-3.5 w-3.5 mr-1" /> Deactivate
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Select-all link */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button onClick={selectAllVisible} className="hover:text-foreground underline underline-offset-2">
            Select all {filtered.length} visible
          </button>
          <span>·</span>
          <span>{rows.length} total agents {rows.length !== filtered.length && `(${filtered.length} after filters)`}</span>
        </div>
      )}

      {/* Views */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(9)].map((_, i) => <div key={i} className="h-32 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No agents match this filter. Try clearing search or changing stage.
        </CardContent></Card>
      ) : view === "board" ? (
        <BoardView
          rows={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onQuickEdit={setQuickEditId}
        />
      ) : view === "table" ? (
        <TableView
          rows={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onQuickEdit={setQuickEditId}
        />
      ) : (
        <PipelineHint />
      )}

      {/* Bulk dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "sms" && `SMS ${selectedIds.size} agents`}
              {bulkAction === "email" && `Email ${selectedIds.size} agents`}
              {bulkAction === "portal_logins" && `Send portal logins to ${selectedIds.size} agents`}
              {bulkAction === "deactivate" && `Deactivate ${selectedIds.size} agents`}
            </DialogTitle>
          </DialogHeader>
          {(bulkAction === "sms" || bulkAction === "email") && (
            <Textarea
              value={bulkMessage}
              onChange={e => setBulkMessage(e.target.value)}
              placeholder={bulkAction === "sms" ? "Keep it short (160 chars)" : "Message body"}
              rows={5}
            />
          )}
          {bulkAction === "portal_logins" && (
            <p className="text-sm text-muted-foreground">Each selected agent will receive a portal login link at their email.</p>
          )}
          {bulkAction === "deactivate" && (
            <p className="text-sm text-red-400">
              This deactivates {selectedIds.size} agents and moves them to Inactive. Reversible via agent profile.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBulkDialogOpen(false)}>Cancel</Button>
            <Button onClick={runBulk} disabled={(bulkAction === "sms" || bulkAction === "email") && !bulkMessage.trim()}>
              {bulkAction === "deactivate" ? "Deactivate" : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick-edit dialog */}
      {quickEditId && (
        <AgentQuickEditDialog
          open={!!quickEditId}
          onOpenChange={(o) => !o && setQuickEditId(null)}
          agentId={quickEditId}
          currentName={rows.find(r => r.id === quickEditId)?.name || ""}
          onUpdate={() => queryClient.invalidateQueries({ queryKey: ["agent-mgmt-rows"] })}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────
function StatPill({ label, value, color = "primary", icon, onClick }: {
  label: string; value: number; color?: "primary" | "emerald" | "amber" | "red" | "rose"; icon?: React.ReactNode; onClick?: () => void;
}) {
  const colors: Record<string, string> = {
    primary: "bg-primary/10 text-primary border-primary/30",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    red: "bg-red-500/10 text-red-400 border-red-500/30",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`p-3 rounded-xl border text-left transition ${colors[color]} ${onClick ? "hover:ring-2 ring-current/30 cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center gap-1.5 mb-0.5 opacity-80">{icon}<span className="text-[10px] uppercase tracking-wide font-semibold">{label}</span></div>
      <p className="text-2xl font-bold">{value}</p>
    </button>
  );
}

function BoardView({ rows, selectedIds, onToggleSelect, onQuickEdit }: {
  rows: AgentRow[]; selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onQuickEdit: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {rows.map(r => {
        const hs = healthStyle[r.health];
        const isSelected = selectedIds.has(r.id);
        return (
          <Card
            key={r.id}
            className={`relative transition hover:border-primary/50 ${isSelected ? "ring-2 ring-primary" : ""}`}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
                <div className={`relative shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background ${hs.ring}`}>
                  <Avatar className="h-11 w-11">
                    <AvatarImage src={r.avatarUrl || undefined} />
                    <AvatarFallback>{r.name.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?"}</AvatarFallback>
                  </Avatar>
                  {r.isPresenting && (
                    <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-rose-500 h-3.5 w-3.5 ring-2 ring-background flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] capitalize">{r.role}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.onboardingStage.replace(/_/g, " ")}</Badge>
                    {r.licenseStatus === "licensed" && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Licensed</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 text-center">
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Week</p>
                  <p className="text-sm font-semibold">${r.weekAlp.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Month</p>
                  <p className="text-sm font-semibold">${r.monthAlp.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Lifetime</p>
                  <p className="text-sm font-semibold">${r.lifetimeAlp.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                <span>
                  {r.lastProductionDate
                    ? `Logged ${formatDistanceToNow(new Date(r.lastProductionDate), { addSuffix: true })}`
                    : "No production yet"}
                </span>
                <span className="flex items-center gap-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${hs.dot}`} />
                  {hs.label}
                </span>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                {r.phone && (
                  <a href={`tel:${r.phone}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2" title={`Call ${r.phone}`}>
                      <Phone className="h-3 w-3" />
                    </Button>
                  </a>
                )}
                {r.phone && (
                  <a href={`sms:${r.phone}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2" title="Text">
                      <MessageSquare className="h-3 w-3" />
                    </Button>
                  </a>
                )}
                {r.email && (
                  <a href={`mailto:${r.email}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2" title="Email">
                      <Mail className="h-3 w-3" />
                    </Button>
                  </a>
                )}
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onQuickEdit(r.id)} title="Quick edit">
                  <Eye className="h-3 w-3" />
                </Button>
                <NudgeButton agent={r} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TableView({ rows, selectedIds, onToggleSelect, onQuickEdit }: {
  rows: AgentRow[]; selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onQuickEdit: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 w-8"></th>
              <th className="p-2 text-left">Agent</th>
              <th className="p-2 text-left">Stage</th>
              <th className="p-2 text-right">Week</th>
              <th className="p-2 text-right">Month</th>
              <th className="p-2 text-right">Lifetime</th>
              <th className="p-2 text-left">Last Logged</th>
              <th className="p-2 w-8"></th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => {
              const hs = healthStyle[r.health];
              const isSelected = selectedIds.has(r.id);
              return (
                <tr key={r.id} className={`hover:bg-muted/20 ${isSelected ? "bg-primary/5" : ""}`}>
                  <td className="p-2">
                    <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(r.id)} />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${hs.dot} shrink-0`} title={hs.label} />
                      <Avatar className="h-6 w-6 shrink-0"><AvatarImage src={r.avatarUrl || undefined} /><AvatarFallback className="text-[10px]">{r.name[0]}</AvatarFallback></Avatar>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-2 text-xs capitalize">{r.onboardingStage.replace(/_/g, " ")}</td>
                  <td className="p-2 text-right font-semibold">${r.weekAlp.toLocaleString()}</td>
                  <td className="p-2 text-right">${r.monthAlp.toLocaleString()}</td>
                  <td className="p-2 text-right text-muted-foreground">${r.lifetimeAlp.toLocaleString()}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {r.lastProductionDate ? format(new Date(r.lastProductionDate), "MMM d") : "—"}
                  </td>
                  <td className="p-2">
                    {r.isPresenting && <Flame className="h-3.5 w-3.5 text-rose-500" />}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1 justify-end">
                      {r.phone && <a href={`tel:${r.phone}`}><Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Phone className="h-3 w-3" /></Button></a>}
                      {r.phone && <a href={`sms:${r.phone}`}><Button size="sm" variant="ghost" className="h-7 w-7 p-0"><MessageSquare className="h-3 w-3" /></Button></a>}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onQuickEdit(r.id)}><Eye className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineHint() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-3">
        <Columns className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
        <h3 className="text-lg font-semibold">Pipeline view lives in CRM</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Your full kanban by onboarding stage is on the CRM page — same data, same agents, arranged by stage. Agent Management is optimized for individual agent drill-down; CRM is optimized for stage flow.
        </p>
        <Link to="/dashboard/crm">
          <Button>Open CRM</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function NudgeButton({ agent }: { agent: AgentRow }) {
  const [sending, setSending] = useState(false);
  const nudge = async () => {
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-agent-nudge", {
        body: {
          agent_id: agent.id,
          reason: agent.health === "red" ? "no_production_7d" : "check_in",
        },
      });
      if (error) throw error;
      toast.success(`Nudge sent to ${agent.name}`);
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "unknown"));
    } finally {
      setSending(false);
    }
  };
  return (
    <Button size="sm" variant="outline" className="h-7 px-2 ml-auto" onClick={nudge} disabled={sending} title="Send nudge">
      <Send className="h-3 w-3" />
    </Button>
  );
}
