import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Shield, CheckCircle2, XCircle, Plus, Search, Flame,
  Calendar as CalendarIcon, User as UserIcon, ShieldAlert, Skull, Filter,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const SEVERITY_LABEL: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  warning:  { label: "Warning",  color: "bg-amber-500/15 text-amber-400 border-amber-500/40",   icon: AlertTriangle },
  minor:    { label: "Minor",    color: "bg-orange-500/15 text-orange-400 border-orange-500/40", icon: ShieldAlert },
  major:    { label: "Major",    color: "bg-rose-500/15 text-rose-400 border-rose-500/40",      icon: Flame },
  terminal: { label: "Terminal", color: "bg-red-600/20 text-red-300 border-red-600/50",         icon: Skull },
};

const REASON_OPTIONS = [
  { value: "no_show", label: "No-show (meeting/training)" },
  { value: "ghosted_lead", label: "Ghosted assigned lead" },
  { value: "customer_complaint", label: "Customer complaint" },
  { value: "false_charge", label: "Billing — false charge" },
  { value: "dnq_application", label: "DNQ application submitted" },
  { value: "no_followup", label: "No follow-up on hot lead" },
  { value: "billing_dispute", label: "Billing dispute (informational)" },
  { value: "compliance", label: "Compliance violation" },
  { value: "misrepresentation", label: "Misrepresentation" },
  { value: "other", label: "Other" },
];

const STANDING_LABEL: Record<string, { label: string; color: string }> = {
  clear:           { label: "Clear",           color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  flagged:         { label: "Flagged",         color: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  on_notice:       { label: "On notice",       color: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  review_required: { label: "Review required", color: "bg-rose-500/15 text-rose-400 border-rose-500/40" },
  terminal:        { label: "Terminal",        color: "bg-red-600/20 text-red-300 border-red-600/50" },
};

interface StrikeRow {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_code: string | null;
  reason_code: string;
  severity: keyof typeof SEVERITY_LABEL;
  description: string;
  status: "active" | "expired" | "resolved" | "voided";
  issued_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  issued_by_name: string | null;
  resolved_by_name: string | null;
}

interface SummaryRow {
  agent_id: string;
  agent_name: string;
  agent_code: string | null;
  active_count: number;
  active_warnings: number;
  active_minor: number;
  active_major: number;
  active_terminal: number;
  resolved_count: number;
  total_count: number;
  most_recent_active_at: string | null;
  standing: keyof typeof STANDING_LABEL;
}

export default function AdminStrikes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [issueOpen, setIssueOpen] = useState(false);
  const [resolveStrikeId, setResolveStrikeId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const { data: strikes = [], isLoading } = useQuery({
    queryKey: ["admin-strikes", statusFilter, severityFilter],
    queryFn: async () => {
      let q = supabase
        .from("v_agent_strikes" as any)
        .select("*")
        .order("issued_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "__all__") q = q.eq("status", statusFilter);
      if (severityFilter !== "__all__") q = q.eq("severity", severityFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StrikeRow[];
    },
  });

  const { data: summary = [] } = useQuery({
    queryKey: ["strike-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_strike_summary" as any)
        .select("*")
        .order("active_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return strikes;
    const s = search.toLowerCase();
    return strikes.filter(
      (r) =>
        r.agent_name.toLowerCase().includes(s) ||
        (r.agent_code ?? "").toLowerCase().includes(s) ||
        r.description.toLowerCase().includes(s),
    );
  }, [strikes, search]);

  const stats = useMemo(() => {
    const active = strikes.filter((s) => s.status === "active");
    return {
      total: strikes.length,
      active: active.length,
      major: active.filter((s) => s.severity === "major" || s.severity === "terminal").length,
      flaggedAgents: summary.filter((s) => s.standing !== "clear").length,
    };
  }, [strikes, summary]);

  async function handleResolve() {
    if (!resolveStrikeId) return;
    if (resolveNote.trim().length < 3) {
      toast.error("Add a resolution note (at least 3 chars).");
      return;
    }
    const { error } = await supabase.rpc("resolve_strike" as any, {
      p_strike_id: resolveStrikeId,
      p_resolution_note: resolveNote.trim(),
    });
    if (error) {
      toast.error(`Resolve failed: ${error.message}`);
      return;
    }
    toast.success("Strike resolved");
    setResolveStrikeId(null);
    setResolveNote("");
    qc.invalidateQueries({ queryKey: ["admin-strikes"] });
    qc.invalidateQueries({ queryKey: ["strike-summary"] });
  }

  async function handleVoid(id: string) {
    const reason = window.prompt("Reason for voiding this strike? (will be appended to notes)");
    if (!reason || reason.trim().length < 3) return;
    const { error } = await supabase.rpc("void_strike" as any, { p_strike_id: id, p_void_reason: reason.trim() });
    if (error) { toast.error(`Void failed: ${error.message}`); return; }
    toast.success("Strike voided");
    qc.invalidateQueries({ queryKey: ["admin-strikes"] });
    qc.invalidateQueries({ queryKey: ["strike-summary"] });
  }

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Conduct"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="Agent Strikes"
        subtitle="Issue, track, and resolve conduct or quality strikes across the team. Strikes are visible to the agent — keep descriptions specific and evidence linked."
        accent="rose"
        actions={
          <IssueStrikeDialog
            open={issueOpen}
            onOpenChange={setIssueOpen}
            onIssued={() => {
              qc.invalidateQueries({ queryKey: ["admin-strikes"] });
              qc.invalidateQueries({ queryKey: ["strike-summary"] });
            }}
          />
        }
      />

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {[
          { label: "Active strikes", value: stats.active, color: "text-rose-400", icon: AlertTriangle },
          { label: "Major / terminal", value: stats.major, color: "text-red-400", icon: Flame },
          { label: "Flagged agents", value: stats.flaggedAgents, color: "text-amber-400", icon: UserIcon },
          { label: "Total on file", value: stats.total, color: "text-muted-foreground", icon: Shield },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <GlassCard variant="subtle" className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</p>
                <p className={`text-3xl font-bold tabular-nums ${s.color} mt-1`}>{s.value}</p>
              </div>
              <s.icon className={`h-8 w-8 ${s.color} opacity-60`} />
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <GlassCard variant="subtle" className="p-3 mb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by agent, code, or description"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="md:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any severity</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="minor">Minor</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="terminal">Terminal</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="hidden md:inline-flex">
            <Filter className="h-3 w-3 mr-1" /> {filtered.length} shown
          </Badge>
        </div>
      </GlassCard>

      {/* Strike list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard variant="subtle" className="p-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3 opacity-70" />
          <p className="text-lg font-semibold">No strikes match these filters</p>
          <p className="text-sm text-muted-foreground mt-1">
            A clear board is the goal — keep it this way.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map((s, i) => {
              const sev = SEVERITY_LABEL[s.severity];
              const SevIcon = sev.icon;
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <GlassCard variant="subtle" className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start">
                      <div className="flex items-center gap-3 md:w-[260px]">
                        <span className={`h-10 w-10 rounded-lg flex items-center justify-center border ${sev.color}`}>
                          <SevIcon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{s.agent_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.agent_code ?? "—"} · {formatDistanceToNow(new Date(s.issued_at))} ago
                          </p>
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="outline" className={sev.color}>{sev.label}</Badge>
                          <Badge variant="outline" className="text-xs">{labelReason(s.reason_code)}</Badge>
                          {s.status !== "active" && (
                            <Badge variant="outline" className="text-xs opacity-70">{s.status}</Badge>
                          )}
                          {s.expires_at && s.status === "active" && (
                            <Badge variant="outline" className="text-xs">
                              <CalendarIcon className="h-3 w-3 mr-1" />
                              Expires {format(new Date(s.expires_at), "MMM d")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">{s.description}</p>
                        {s.resolution_note && (
                          <p className="text-xs text-muted-foreground mt-2 border-l-2 border-emerald-500/40 pl-2 italic">
                            {s.resolution_note}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-2">
                          Issued by {s.issued_by_name ?? "system"} · {format(new Date(s.issued_at), "PPp")}
                          {s.resolved_by_name && <> · Resolved by {s.resolved_by_name}</>}
                        </p>
                      </div>

                      {s.status === "active" && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setResolveStrikeId(s.id); setResolveNote(""); }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleVoid(s.id)}
                            className="text-muted-foreground hover:text-rose-400"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Resolve dialog */}
      <Dialog open={!!resolveStrikeId} onOpenChange={(o) => !o && setResolveStrikeId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve strike</DialogTitle>
          </DialogHeader>
          <Textarea
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
            placeholder="What changed? (visible to the agent)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveStrikeId(null)}>Cancel</Button>
            <Button onClick={handleResolve}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Resolve strike
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function labelReason(code: string): string {
  return REASON_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

interface IssueDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: () => void;
}

function IssueStrikeDialog({ open, onOpenChange, onIssued }: IssueDialogProps) {
  const [agentId, setAgentId] = useState("");
  const [reasonCode, setReasonCode] = useState("no_show");
  const [severity, setSeverity] = useState<"warning" | "minor" | "major" | "terminal">("warning");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [agentSearch, setAgentSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-search", agentSearch],
    enabled: open,
    queryFn: async () => {
      let q: any = supabase
        .from("v_strike_summary" as any)
        .select("agent_id, agent_name, agent_code, active_count, standing")
        .order("agent_name", { ascending: true })
        .limit(50);
      if (agentSearch.trim()) {
        q = q.or(`agent_name.ilike.%${agentSearch}%,agent_code.ilike.%${agentSearch}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  async function submit() {
    if (!agentId) { toast.error("Pick an agent"); return; }
    if (description.trim().length < 5) { toast.error("Description must be 5+ chars"); return; }
    setSubmitting(true);
    const { error } = await supabase.rpc("issue_strike" as any, {
      p_agent_id: agentId,
      p_reason_code: reasonCode,
      p_severity: severity,
      p_description: description.trim(),
      p_expires_at: expiresAt || null,
    });
    setSubmitting(false);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success("Strike issued");
    setAgentId(""); setDescription(""); setExpiresAt(""); setReasonCode("no_show"); setSeverity("warning");
    onOpenChange(false);
    onIssued();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-rose-500 hover:bg-rose-600 text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Issue strike
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue a strike</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent</label>
            <Input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search by name or code"
              className="mt-1"
            />
            <div className="max-h-40 overflow-y-auto mt-2 rounded-md border border-border/60">
              {agents.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matches.</p>}
              {agents.map((a: any) => (
                <button
                  key={a.agent_id}
                  type="button"
                  onClick={() => setAgentId(a.agent_id)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-primary/5 transition-colors ${
                    agentId === a.agent_id ? "bg-primary/10" : ""
                  }`}
                >
                  <span>
                    <span className="font-medium">{a.agent_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{a.agent_code ?? "—"}</span>
                  </span>
                  {a.active_count > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {a.active_count} active
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason</label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Severity</label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="terminal">Terminal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Specific behavior, dates, and context. Visible to the agent."
              rows={4}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expires (optional)</label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-rose-500 hover:bg-rose-600 text-white">
            <Shield className="h-4 w-4 mr-1.5" /> {submitting ? "Issuing…" : "Issue strike"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
