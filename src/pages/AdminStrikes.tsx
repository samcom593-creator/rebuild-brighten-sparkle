import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle, Shield, CheckCircle2, XCircle, Plus, Search, Flame,
  Calendar as CalendarIcon, User as UserIcon, ShieldAlert, Skull, Filter,
  Sparkles, Link as LinkIcon, X, BarChart3, Eye,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

// v26 audit fix: severity was 5-color rainbow (amber/orange/rose/red-600).
// Collapsed to AgentLink 2-color palette · amber (lighter severities) +
// rose (heavier severities). Same visual hierarchy, no rainbow.
const SEVERITY_LABEL: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  warning:  { label: "Warning",  color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: AlertTriangle },
  minor:    { label: "Minor",    color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: ShieldAlert },
  major:    { label: "Major",    color: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",     icon: Flame },
  terminal: { label: "Terminal", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",     icon: Skull },
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

interface StrikeRow {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_code: string | null;
  reason_code: string;
  severity: keyof typeof SEVERITY_LABEL;
  description: string;
  evidence_urls: string[] | null;
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
  standing: "clear" | "flagged" | "on_notice" | "review_required" | "terminal";
}

interface TrendRow { day: string; warnings: number; minor: number; major: number; terminal: number; total: number; }

export default function AdminStrikes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [issueOpen, setIssueOpen] = useState(false);
  const [resolveStrikeId, setResolveStrikeId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [drillAgentId, setDrillAgentId] = useState<string | null>(null);

  // Real-time bumps invalidate everything
  useRealtimeTable({ table: "agent_strikes", channelSuffix: "admin" }, () => {
    qc.invalidateQueries({ queryKey: ["admin-strikes"] });
    qc.invalidateQueries({ queryKey: ["strike-summary"] });
    qc.invalidateQueries({ queryKey: ["strike-trend"] });
  });

  const { data: strikes = [], isLoading } = useQuery({
    queryKey: ["admin-strikes", statusFilter, severityFilter],
    queryFn: async () => {
      let q: any = supabase
        .from("v_agent_strikes" as any).select("id,agent_id,agent_name,agent_code,reason_code,severity,description,evidence_urls,status,issued_at,expires_at,resolved_at,resolution_note,issued_by_name,resolved_by_name")
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
        .from("v_strike_summary" as any).select("agent_id,agent_name,agent_code,active_count,active_major,active_terminal,resolved_count,total_count,standing")
        .order("active_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SummaryRow[];
    },
  });

  const { data: trend = [] } = useQuery({
    queryKey: ["strike-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_strike_trend" as any).select("day,warnings,minor,major,terminal")
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrendRow[];
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
  }

  async function handleVoid(id: string) {
    const reason = window.prompt("Reason for voiding this strike? (will be appended to notes)");
    if (!reason || reason.trim().length < 3) return;
    const { error } = await supabase.rpc("void_strike" as any, { p_strike_id: id, p_void_reason: reason.trim() });
    if (error) { toast.error(`Void failed: ${error.message}`); return; }
    toast.success("Strike voided");
  }

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Conduct"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="Agent Strikes"
        subtitle="Issue, track, and resolve conduct strikes. Templates pre-fill the most common scenarios. Strikes are visible to the agent — keep descriptions specific and evidence linked."
        accent="rose"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40">
              <span className="live-indicator h-2 w-2 mr-1.5" /> Live
            </Badge>
            <IssueStrikeDialog
              open={issueOpen}
              onOpenChange={setIssueOpen}
            />
          </div>
        }
      />

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
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

      {/* Two-up: trend chart + top-flagged agents */}
      <div className="grid gap-3 lg:grid-cols-3 mb-5">
        <GlassCard variant="subtle" className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">30-day trend</p>
              <h3 className="text-lg font-bold">Strikes by severity</h3>
            </div>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
              <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                labelFormatter={(d) => format(new Date(d), "MMM d, yyyy")}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="warnings" stackId="a" fill="hsl(38 95% 55%)" name="Warning" />
              <Bar dataKey="minor"    stackId="a" fill="hsl(25 95% 53%)" name="Minor" />
              <Bar dataKey="major"    stackId="a" fill="hsl(0 70% 55%)"  name="Major" />
              <Bar dataKey="terminal" stackId="a" fill="hsl(0 80% 35%)" name="Terminal" />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard variant="subtle" className="p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Reverse leaderboard</p>
              <h3 className="text-lg font-bold">Most active strikes</h3>
            </div>
            <Flame className="h-5 w-5 text-rose-400 opacity-70" />
          </div>
          {summary.filter((s) => s.active_count > 0).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nobody on the wrong side. 🟢</p>
          ) : (
            <ul className="space-y-2 max-h-[200px] overflow-y-auto scrollbar-custom pr-1">
              {summary.filter((s) => s.active_count > 0).slice(0, 6).map((s, i) => (
                <li key={s.agent_id}>
                  <button
                    type="button"
                    onClick={() => setDrillAgentId(s.agent_id)}
                    className="w-full text-left flex items-center justify-between gap-2 rounded-lg border border-border/30 px-3 py-2 hover:border-rose-500/40 hover:bg-rose-500/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-6 w-6 rounded-md bg-rose-500/15 text-rose-400 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium truncate">{s.agent_name}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{s.active_count} active</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
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
            <div key={i} className="h-24 rounded-md skeleton-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          title="Clear board"
          description="No strikes match these filters. A clear board is the goal — keep it this way."
          variant="success"
        />
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
                      <button
                        type="button"
                        onClick={() => setDrillAgentId(s.agent_id)}
                        className="flex items-center gap-3 md:w-[260px] text-left hover:opacity-80 transition-opacity"
                      >
                        <span className={`h-10 w-10 rounded-lg flex items-center justify-center border ${sev.color}`}>
                          <SevIcon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{s.agent_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.agent_code ?? "—"} · {formatDistanceToNow(new Date(s.issued_at))} ago
                          </p>
                        </div>
                      </button>

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
                          {s.evidence_urls && s.evidence_urls.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <LinkIcon className="h-3 w-3 mr-1" />
                              {s.evidence_urls.length} link{s.evidence_urls.length > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">{s.description}</p>
                        {s.evidence_urls && s.evidence_urls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {s.evidence_urls.map((url, idx) => (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-primary hover:underline truncate max-w-[260px] inline-flex items-center gap-1"
                              >
                                <LinkIcon className="h-3 w-3" /> {new URL(url).hostname}
                              </a>
                            ))}
                          </div>
                        )}
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

      {/* Per-agent drill-in sheet */}
      <AgentDrillSheet
        agentId={drillAgentId}
        summary={summary.find((s) => s.agent_id === drillAgentId) ?? null}
        onClose={() => setDrillAgentId(null)}
      />
    </div>
  );
}

function labelReason(code: string): string {
  return REASON_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

// ─── Issue dialog with templates + evidence URLs ─────────────────────────────
interface IssueDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}
interface Template {
  id: string;
  slug: string;
  reason_code: string;
  severity: "warning" | "minor" | "major" | "terminal";
  title: string;
  description: string;
  default_expires_days: number | null;
}

function IssueStrikeDialog({ open, onOpenChange }: IssueDialogProps) {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [reasonCode, setReasonCode] = useState("no_show");
  const [severity, setSeverity] = useState<"warning" | "minor" | "major" | "terminal">("warning");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [agentSearch, setAgentSearch] = useState("");
  const [evidenceInput, setEvidenceInput] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [templateSlug, setTemplateSlug] = useState<string>("__custom__");
  const [submitting, setSubmitting] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["strike-templates"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strike_templates" as any).select("id,slug,reason_code,severity,title,description,default_expires_days")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Template[];
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-search-strike", agentSearch],
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

  function applyTemplate(slug: string) {
    setTemplateSlug(slug);
    if (slug === "__custom__") return;
    const t = templates.find((x) => x.slug === slug);
    if (!t) return;
    setReasonCode(t.reason_code);
    setSeverity(t.severity);
    setDescription(t.description);
    if (t.default_expires_days) {
      const d = new Date();
      d.setDate(d.getDate() + t.default_expires_days);
      setExpiresAt(d.toISOString().slice(0, 10));
    } else {
      setExpiresAt("");
    }
  }

  function addEvidence() {
    const url = evidenceInput.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      toast.error("Not a valid URL");
      return;
    }
    setEvidenceUrls((prev) => Array.from(new Set([...prev, url])));
    setEvidenceInput("");
  }

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
      p_evidence_urls: evidenceUrls,
    });
    setSubmitting(false);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success("Strike issued");
    setAgentId(""); setDescription(""); setExpiresAt("");
    setReasonCode("no_show"); setSeverity("warning");
    setEvidenceUrls([]); setTemplateSlug("__custom__");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["admin-strikes"] });
    qc.invalidateQueries({ queryKey: ["strike-summary"] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-rose-500 hover:bg-rose-600 text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Issue strike
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Issue a strike</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Template picker */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Template
            </label>
            <Select value={templateSlug} onValueChange={applyTemplate}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">Start from scratch</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.slug} value={t.slug}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Agent */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent</label>
            <Input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search by name or code"
              className="mt-1"
            />
            <div className="max-h-32 overflow-y-auto mt-2 rounded-md border border-border/60">
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

          {/* Reason + severity */}
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

          {/* Evidence URLs */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence (URLs)</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={evidenceInput}
                onChange={(e) => setEvidenceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEvidence(); } }}
                placeholder="https://drive.google.com/… or call recording link"
              />
              <Button type="button" variant="outline" onClick={addEvidence}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {evidenceUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {evidenceUrls.map((u) => (
                  <Badge key={u} variant="outline" className="text-[11px] gap-1 pr-1">
                    <span className="truncate max-w-[180px]">{new URL(u).hostname}</span>
                    <button
                      type="button"
                      onClick={() => setEvidenceUrls((prev) => prev.filter((x) => x !== u))}
                      className="h-4 w-4 rounded-sm hover:bg-rose-500/20 flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
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

// ─── Per-agent drilldown sheet ──────────────────────────────────────────────
interface DrillProps {
  agentId: string | null;
  summary: SummaryRow | null;
  onClose: () => void;
}
function AgentDrillSheet({ agentId, summary, onClose }: DrillProps) {
  const { data: agentStrikes = [], isLoading } = useQuery({
    queryKey: ["agent-strikes-drill", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_strikes" as any).select("id,agent_id,reason_code,severity,description,status,issued_at,resolution_note")
        .eq("agent_id", agentId!)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StrikeRow[];
    },
  });

  return (
    <Sheet open={!!agentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {summary?.agent_name ?? "Agent"}
            {summary?.agent_code && <span className="text-sm text-muted-foreground ml-2 font-normal">{summary.agent_code}</span>}
          </SheetTitle>
        </SheetHeader>
        {summary && (
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <div className="rounded-md border border-border/40 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Active</p>
              <p className="text-xl font-bold text-rose-400">{summary.active_count}</p>
            </div>
            <div className="rounded-md border border-border/40 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Major+</p>
              <p className="text-xl font-bold text-red-400">{summary.active_major + summary.active_terminal}</p>
            </div>
            <div className="rounded-md border border-border/40 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Resolved</p>
              <p className="text-xl font-bold text-emerald-400">{summary.resolved_count}</p>
            </div>
            <div className="rounded-md border border-border/40 p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Total</p>
              <p className="text-xl font-bold">{summary.total_count}</p>
            </div>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {isLoading && <div className="h-16 rounded-lg skeleton-shimmer" />}
          {!isLoading && agentStrikes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No strikes on file.</p>
          )}
          {agentStrikes.map((s) => {
            const sev = SEVERITY_LABEL[s.severity];
            const SevIcon = sev.icon;
            return (
              <div key={s.id} className={`p-3 rounded-lg border border-border/40 ${s.status !== "active" ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`h-7 w-7 rounded-md flex items-center justify-center border ${sev.color}`}>
                    <SevIcon className="h-3.5 w-3.5" />
                  </span>
                  <Badge variant="outline" className={`${sev.color} text-[10px]`}>{sev.label}</Badge>
                  <Badge variant="outline" className="text-[10px]">{labelReason(s.reason_code)}</Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(s.issued_at))} ago
                  </span>
                </div>
                <p className="text-sm">{s.description}</p>
                {s.resolution_note && (
                  <p className="text-xs text-muted-foreground mt-1 border-l-2 border-emerald-500/40 pl-2 italic">
                    {s.resolution_note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
