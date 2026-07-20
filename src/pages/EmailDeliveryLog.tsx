import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Search,
  RefreshCw,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface LogEntry {
  id: string;
  template: string;
  recipient_email: string;
  agent_id: string | null;
  subject: string | null;
  provider: string;
  provider_message_id: string | null;
  status: string;
  error: string | null;
  retries: number;
  related_record_id: string | null;
  related_record_type: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { color: string; icon: any; label: string }> = {
  queued:    { color: "bg-muted/30 text-muted-foreground border-border",          icon: Clock,        label: "Queued" },
  sent:      { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2, label: "Sent" },
  delivered: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2, label: "Delivered" },
  bounced:   { color: "bg-red-500/10 text-red-400 border-red-500/30",             icon: XCircle,      label: "Bounced" },
  failed:    { color: "bg-red-500/20 text-red-400 border-red-500/40",             icon: AlertCircle,  label: "Failed" },
};

export default function EmailDeliveryLog() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState("all");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["email-delivery-log"],
    queryFn: async (): Promise<LogEntry[]> => {
      const { data } = await supabase
        .from("email_delivery_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      return ((data as any) ?? []) as LogEntry[];
    },
  });

  const templates = useMemo(() => {
    const set = new Set(logs.map((l) => l.template));
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (templateFilter !== "all" && l.template !== templateFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.recipient_email.toLowerCase().includes(q) ||
          l.subject?.toLowerCase().includes(q) ||
          l.template.toLowerCase().includes(q) ||
          l.error?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, statusFilter, templateFilter, search]);

  const stats = useMemo(() => {
    const result: Record<string, number> = {
      total: logs.length,
      sent: 0,
      failed: 0,
      bounced: 0,
      queued: 0,
    };
    for (const l of logs) {
      if (l.status in result) result[l.status]++;
    }
    return result;
  }, [logs]);

  const retryEmail = async (entry: LogEntry) => {
    if (entry.template !== "plaque" && entry.template !== "plaque_manager_notify") {
      toast.error("Retry only supported for plaque emails in this build");
      return;
    }
    if (!entry.related_record_id) {
      toast.error("Cannot retry — no related plaque record");
      return;
    }
    try {
      const { data: plaque } = await supabase
        .from("plaque_awards")
        .select("agent_id, milestone_type, amount, milestone_date")
        .eq("id", entry.related_record_id)
        .single();
      if (!plaque) {
        toast.error("Original plaque not found");
        return;
      }

      const { error } = await supabase.functions.invoke("send-plaque-recognition", {
        body: {
          agentId: (plaque as any).agent_id,
          milestoneType: (plaque as any).milestone_type,
          amount: (plaque as any).amount,
          date: (plaque as any).milestone_date,
        },
      });
      if (error) throw error;
      toast.success("Retry triggered");
      await supabase
        .from("email_delivery_log" as any)
        .update({ retries: entry.retries + 1, updated_at: new Date().toISOString() })
        .eq("id", entry.id);
      queryClient.invalidateQueries({ queryKey: ["email-delivery-log"] });
    } catch (e: any) {
      toast.error("Retry failed: " + (e.message || "unknown"));
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <PageHeader
        accent="blue"
        eyebrow="Admin · Notifications"
        eyebrowIcon={<Mail className="h-3 w-3" />}
        title="Email Delivery Log"
        subtitle="Every outbound email across the platform — recipient, template, status, error."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["email-delivery-log"] })
            }
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter("all")}
          className={`p-3 rounded-lg border text-left transition ${statusFilter === "all" ? "ring-2 ring-primary border-primary" : "border-border bg-card"}`}
        >
          <p className="text-[10px] uppercase text-muted-foreground">Total</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </button>
        <button
          onClick={() => setStatusFilter("sent")}
          className={`p-3 rounded-lg border text-left transition ${STATUS_META.sent.color} ${statusFilter === "sent" ? "ring-2 ring-emerald-500" : ""}`}
        >
          <p className="text-[10px] uppercase opacity-70">Sent</p>
          <p className="text-2xl font-bold">{stats.sent}</p>
        </button>
        <button
          onClick={() => setStatusFilter("queued")}
          className={`p-3 rounded-lg border text-left transition ${STATUS_META.queued.color} ${statusFilter === "queued" ? "ring-2 ring-primary" : ""}`}
        >
          <p className="text-[10px] uppercase opacity-70">Queued</p>
          <p className="text-2xl font-bold">{stats.queued}</p>
        </button>
        <button
          onClick={() => setStatusFilter("bounced")}
          className={`p-3 rounded-lg border text-left transition ${STATUS_META.bounced.color} ${statusFilter === "bounced" ? "ring-2 ring-red-500" : ""}`}
        >
          <p className="text-[10px] uppercase opacity-70">Bounced</p>
          <p className="text-2xl font-bold">{stats.bounced}</p>
        </button>
        <button
          onClick={() => setStatusFilter("failed")}
          className={`p-3 rounded-lg border text-left transition ${STATUS_META.failed.color} ${statusFilter === "failed" ? "ring-2 ring-red-500" : ""}`}
        >
          <p className="text-[10px] uppercase opacity-70">Failed</p>
          <p className="text-2xl font-bold">{stats.failed}</p>
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search email, subject, template, error..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={templateFilter} onValueChange={setTemplateFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            /* stable-key-allow:skeleton */
            <div key={i} className="h-16 rounded-lg bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No email logs match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {filtered.map((entry) => {
            const meta = STATUS_META[entry.status] || STATUS_META.queued;
            const StatusIcon = meta.icon;
            return (
              <Card
                key={entry.id}
                className={
                  entry.status === "failed" || entry.status === "bounced"
                    ? "border-red-500/30"
                    : ""
                }
              >
                <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                  <div className={`p-1.5 rounded-lg border ${meta.color}`}>
                    <StatusIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <Badge variant="outline" className={meta.color + " text-[10px]"}>
                        {meta.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {entry.template}
                      </Badge>
                      <span className="text-sm font-medium truncate">
                        {entry.recipient_email}
                      </span>
                      {entry.retries > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          ×{entry.retries} retries
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.subject || "(no subject)"}
                    </p>
                    {entry.error && (
                      <p className="text-[10px] text-red-400 truncate mt-0.5">
                        ⚠ {entry.error}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground whitespace-nowrap">
                    {entry.sent_at ? (
                      <>Sent {formatDistanceToNow(new Date(entry.sent_at), { addSuffix: true })}</>
                    ) : (
                      <>
                        Queued{" "}
                        {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                      </>
                    )}
                  </div>
                  {(entry.status === "failed" || entry.status === "bounced") &&
                    entry.template.startsWith("plaque") && (
                      <Button size="sm" variant="outline" onClick={() => retryEmail(entry)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                      </Button>
                    )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
