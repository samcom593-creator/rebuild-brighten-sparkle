import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell, Mail, MessageSquare, RefreshCw, RotateCcw, Search,
  Phone, Copy, Trash2, ExternalLink, MoreVertical, CheckCheck,
  Download, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

type InboxFilter = "all" | "email" | "sms" | "push" | "failed";
type InboxChannel = "email" | "sms" | "push";
type InboxSource = "notification_log" | "email_tracking";

type NotificationLogRow = {
  id: string;
  channel: string;
  title: string;
  message: string;
  subject: string | null;
  body: string | null;
  notification_type: string | null;
  status: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_user_id: string | null;
  agent_id: string | null;
  created_at: string;
  opened_at: string | null;
  error_message: string | null;
  metadata?: unknown;
};

type EmailTrackingRow = {
  id: string;
  agent_id: string | null;
  created_at: string;
  email_type: string;
  metadata: unknown;
  open_count: number | null;
  opened_at: string | null;
  recipient_email: string;
  sent_at: string;
};

interface InboxMessage {
  id: string;
  messageKey: string;
  source: InboxSource;
  channel: InboxChannel;
  rawChannel: string;
  title: string;
  message: string;
  subject?: string;
  body?: string;
  notification_type?: string;
  status: string;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  recipient_user_id?: string | null;
  agent_id?: string | null;
  created_at: string;
  opened_at?: string | null;
  open_count?: number | null;
  error_message?: string | null;
  deliveryEligible: boolean;
}

const MAX_ROWS_PER_SOURCE = 1000;
const SUCCESS_STATUSES = new Set(["sent", "delivered", "opened"]);
const FAILURE_STATUSES = new Set(["failed", "error", "bounced", "complained", "undelivered"]);

const normalizeChannel = (channel?: string | null): InboxChannel => {
  if (channel === "push") return "push";
  if (channel === "sms" || channel === "sms-auto") return "sms";
  return "email";
};

const asMetaRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const getText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const titleCase = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatEmailTypeLabel = (emailType?: string | null) => {
  if (!emailType) return "Tracked Email";
  return titleCase(emailType.replace(/[_-]+/g, " "));
};

const sortMessages = (items: InboxMessage[]) =>
  [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

const normalizeNotificationLog = (row: NotificationLogRow): InboxMessage => {
  const noPushSubscriptionFailure =
    row.channel === "push" &&
    row.status === "failed" &&
    row.error_message?.toLowerCase().includes("no push subscriptions");

  return {
    id: row.id,
    messageKey: `notification_log:${row.id}`,
    source: "notification_log",
    channel: normalizeChannel(row.channel),
    rawChannel: row.channel,
    title: row.title || row.subject || "Notification",
    subject: row.subject || undefined,
    message: row.message || row.body || "",
    body: row.body || row.message || "",
    notification_type: row.notification_type || undefined,
    status: row.opened_at && row.status === "sent" ? "opened" : row.status,
    recipient_email: row.recipient_email,
    recipient_phone: row.recipient_phone,
    recipient_user_id: row.recipient_user_id,
    agent_id: row.agent_id,
    created_at: row.created_at,
    opened_at: row.opened_at,
    error_message: row.error_message,
    deliveryEligible:
      !noPushSubscriptionFailure &&
      (SUCCESS_STATUSES.has(row.status) || FAILURE_STATUSES.has(row.status) || !!row.opened_at),
  };
};

const normalizeEmailTracking = (row: EmailTrackingRow): InboxMessage => {
  const metadata = asMetaRecord(row.metadata);
  const title = getText(metadata.subject, metadata.title) || formatEmailTypeLabel(row.email_type);
  const preview =
    getText(metadata.preview, metadata.preview_text, metadata.message, metadata.body_text, metadata.body) ||
    `Tracked ${formatEmailTypeLabel(row.email_type).toLowerCase()} email.`;

  return {
    id: row.id,
    messageKey: `email_tracking:${row.id}`,
    source: "email_tracking",
    channel: "email",
    rawChannel: "email",
    title,
    subject: title,
    message: preview,
    body: getText(metadata.body_text, metadata.body, metadata.html, preview),
    notification_type: row.email_type,
    status: row.opened_at ? "opened" : "sent",
    recipient_email: row.recipient_email,
    recipient_phone: null,
    recipient_user_id: null,
    agent_id: row.agent_id,
    created_at: row.sent_at || row.created_at,
    opened_at: row.opened_at,
    open_count: row.open_count,
    error_message: null,
    deliveryEligible: true,
  };
};

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resending, setResending] = useState(false);

  const fetchMessages = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);

    const [notificationRes, emailRes] = await Promise.all([
      supabase
        .from("notification_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS_PER_SOURCE),
      supabase
        .from("email_tracking")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(MAX_ROWS_PER_SOURCE),
    ]);

    if (notificationRes.error || emailRes.error) {
      console.error(notificationRes.error || emailRes.error);
      toast.error("Failed to load inbox");
      setLoading(false);
      return;
    }

    const all: InboxMessage[] = [
      ...(notificationRes.data || []).map((r: any) => normalizeNotificationLog(r as NotificationLogRow)),
      ...(emailRes.data || []).map((r: any) => normalizeEmailTracking(r as EmailTrackingRow)),
    ];
    setMessages(sortMessages(all));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const filtered = useMemo(() => {
    let out = messages;
    if (filter === "failed") {
      out = out.filter((m) => FAILURE_STATUSES.has(m.status));
    } else if (filter !== "all") {
      out = out.filter((m) => m.channel === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((m) =>
        [m.title, m.subject, m.message, m.body, m.recipient_email, m.recipient_phone, m.notification_type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [messages, filter, search]);

  const selectedMessage = useMemo(
    () => filtered.find((m) => m.messageKey === selectedId) || null,
    [filtered, selectedId],
  );

  const today = new Date().toISOString().split("T")[0];
  const todayMessages = useMemo(
    () => messages.filter((m) => m.created_at?.startsWith(today)),
    [messages, today],
  );
  const emailsToday = todayMessages.filter((m) => m.channel === "email").length;
  const smsToday = todayMessages.filter((m) => m.channel === "sms").length;
  const deliveryCandidates = todayMessages.filter((m) => m.deliveryEligible);
  const deliveredCount = deliveryCandidates.filter(
    (m) => SUCCESS_STATUSES.has(m.status) || !!m.opened_at,
  ).length;
  const deliveryRate = deliveryCandidates.length > 0 ? Math.round((deliveredCount / deliveryCandidates.length) * 100) : 100;
  const failedCount = messages.filter((m) => FAILURE_STATUSES.has(m.status)).length;

  const channelIcon = (channel: InboxChannel) => {
    if (channel === "email") return <Mail className="h-3.5 w-3.5" />;
    if (channel === "sms") return <MessageSquare className="h-3.5 w-3.5" />;
    return <Bell className="h-3.5 w-3.5" />;
  };

  const statusColor = (status: string) => {
    if (SUCCESS_STATUSES.has(status)) return "border-l-primary";
    if (status === "pending" || status === "queued" || status === "retried") return "border-l-accent";
    return "border-l-destructive";
  };

  // === ACTIONS ===

  const resendSingle = async (m: InboxMessage) => {
    setResending(true);
    try {
      if (m.channel === "push" && m.recipient_user_id) {
        const { error } = await supabase.functions.invoke("send-notification", {
          body: {
            userId: m.recipient_user_id,
            title: m.title,
            message: m.message,
          },
        });
        if (error) throw error;
      } else if (m.channel === "email" && m.recipient_email) {
        const { error } = await supabase.functions.invoke("send-outreach-email", {
          body: {
            to: m.recipient_email,
            subject: m.subject || m.title,
            body: m.body || m.message,
          },
        }).catch(async () => {
          return await supabase.functions.invoke("send-notification", {
            body: {
              email: m.recipient_email,
              title: m.title,
              message: m.message,
            },
          });
        });
        if (error) throw error;
      } else if (m.channel === "sms" && m.recipient_phone) {
        const { error } = await supabase.functions.invoke("send-sms-auto-detect", {
          body: {
            to: m.recipient_phone,
            message: m.message,
          },
        });
        if (error) throw error;
      } else {
        toast.error("Can't resend: missing recipient for this channel");
        return;
      }
      toast.success("Resent successfully");
      fetchMessages(false);
    } catch (e: any) {
      toast.error(`Resend failed: ${e.message || "unknown error"}`);
    } finally {
      setResending(false);
    }
  };

  const copyRecipient = (m: InboxMessage) => {
    const val = m.recipient_email || m.recipient_phone;
    if (!val) { toast.error("Nothing to copy"); return; }
    navigator.clipboard.writeText(val);
    toast.success(`Copied ${val}`);
  };

  const deleteMessage = async (m: InboxMessage) => {
    const table = m.source === "notification_log" ? "notification_log" : "email_tracking";
    const { error } = await supabase.from(table).delete().eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted from log");
    setMessages((prev) => prev.filter((x) => x.messageKey !== m.messageKey));
    if (selectedId === m.messageKey) setSelectedId(null);
  };

  const markRead = async (m: InboxMessage) => {
    if (m.source !== "notification_log") { toast.error("Only notifications can be marked"); return; }
    const { error } = await supabase
      .from("notification_log")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked as read");
    fetchMessages(false);
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((m) => m.messageKey)));
  };

  const bulkRetry = async () => {
    const picks = filtered.filter((m) => selected.has(m.messageKey) && FAILURE_STATUSES.has(m.status));
    if (picks.length === 0) { toast.error("No failed messages in selection"); return; }
    setResending(true);
    let ok = 0, fail = 0;
    for (const m of picks) {
      try {
        await resendSingle(m);
        ok++;
      } catch {
        fail++;
      }
    }
    setResending(false);
    toast.success(`Retried ${ok}${fail ? `, ${fail} failed` : ""}`);
    setSelected(new Set());
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} log entries? This cannot be undone.`)) return;
    const notifIds: string[] = [];
    const emailIds: string[] = [];
    filtered.forEach((m) => {
      if (!selected.has(m.messageKey)) return;
      if (m.source === "notification_log") notifIds.push(m.id);
      else emailIds.push(m.id);
    });
    if (notifIds.length) await supabase.from("notification_log").delete().in("id", notifIds);
    if (emailIds.length) await supabase.from("email_tracking").delete().in("id", emailIds);
    toast.success(`Deleted ${notifIds.length + emailIds.length}`);
    setSelected(new Set());
    fetchMessages(false);
  };

  const exportCSV = () => {
    const rows = filtered.map((m) => ({
      channel: m.channel,
      status: m.status,
      recipient: m.recipient_email || m.recipient_phone || "",
      title: m.title,
      message: m.message,
      sent_at: m.created_at,
      opened_at: m.opened_at || "",
      error: m.error_message || "",
    }));
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    const header = Object.keys(rows[0]).join(",");
    const body = rows.map((r) =>
      Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    ).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inbox-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length}`);
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground" style={{ fontFamily: "Syne" }}>
            APEX Financial
          </div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>Inbox</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchMessages()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Clickable stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <button
          onClick={() => { setFilter("email"); setSearch(""); }}
          className={cn(
            "rounded-xl border bg-card p-3 text-left transition hover:border-primary/50",
            filter === "email" ? "border-primary ring-2 ring-primary/20" : "border-border",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{emailsToday}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Emails Today</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => { setFilter("sms"); setSearch(""); }}
          className={cn(
            "rounded-xl border bg-card p-3 text-left transition hover:border-primary/50",
            filter === "sms" ? "border-primary ring-2 ring-primary/20" : "border-border",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{smsToday}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">SMS Today</p>
            </div>
          </div>
        </button>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{deliveryRate}%</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivery Rate</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => { setFilter("failed"); setSearch(""); }}
          className={cn(
            "rounded-xl border bg-card p-3 text-left transition hover:border-destructive/50",
            filter === "failed" ? "border-destructive ring-2 ring-destructive/20" : "border-border",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-lg font-bold", failedCount > 0 && "text-destructive")} style={{ fontFamily: "Syne" }}>{failedCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Failed · Click to Retry</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => { setFilter("all"); setSearch(""); }}
          className={cn(
            "rounded-xl border bg-card p-3 text-left transition hover:border-primary/50",
            filter === "all" && !search ? "border-primary ring-2 ring-primary/20" : "border-border",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{messages.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Logged</p>
            </div>
          </div>
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="h-4 w-px bg-border mx-1" />
          <Button size="sm" variant="outline" onClick={bulkRetry} disabled={resending}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry Failed
          </Button>
          <Button size="sm" variant="outline" onClick={bulkDelete} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="grid min-h-[60vh] grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        {/* Message list */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="space-y-2 border-b border-border p-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as InboxFilter)}>
              <TabsList className="grid h-8 grid-cols-5">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="email" className="text-xs">Email</TabsTrigger>
                <TabsTrigger value="sms" className="text-xs">SMS</TabsTrigger>
                <TabsTrigger value="push" className="text-xs">Push</TabsTrigger>
                <TabsTrigger value="failed" className="text-xs text-destructive">Failed</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search messages..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              {filtered.length > 0 && (
                <Checkbox
                  checked={selected.size === filtered.length}
                  onCheckedChange={toggleAll}
                  title="Select all"
                />
              )}
            </div>
          </div>

          <ScrollArea className="max-h-[55vh] flex-1">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages found</p>
            )}
            {filtered.map((m) => {
              const isSelected = selected.has(m.messageKey);
              return (
                <div
                  key={m.messageKey}
                  className={cn(
                    "flex items-start gap-2 w-full border-b border-border/50 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                    statusColor(m.status),
                    selectedId === m.messageKey && "bg-muted/80",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleOne(m.messageKey)}
                    className="mt-0.5"
                  />
                  <button
                    onClick={() => setSelectedId(m.messageKey)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="mb-0.5 flex items-center gap-2">
                      {channelIcon(m.channel)}
                      <span className="flex-1 truncate text-xs font-medium">
                        {m.recipient_email || m.recipient_phone || "Unknown"}
                      </span>
                      <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                        {format(new Date(m.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="truncate text-sm font-medium">{m.subject || m.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.message}</p>
                    {FAILURE_STATUSES.has(m.status) && (
                      <Badge variant="destructive" className="mt-1 text-[10px] h-4 px-1">
                        {m.status}
                      </Badge>
                    )}
                  </button>
                </div>
              );
            })}
          </ScrollArea>
        </div>

        {/* Detail pane */}
        <div className="rounded-xl border border-border bg-card p-4 lg:p-6">
          {!selectedMessage ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a message to view details</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold" style={{ fontFamily: "Syne" }}>
                    {selectedMessage.subject || selectedMessage.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{selectedMessage.channel}</Badge>
                    <Badge
                      variant={SUCCESS_STATUSES.has(selectedMessage.status) ? "default" : selectedMessage.status === "pending" ? "outline" : "destructive"}
                      className="text-xs capitalize"
                    >
                      {selectedMessage.status}
                    </Badge>
                    {selectedMessage.notification_type && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {formatEmailTypeLabel(selectedMessage.notification_type)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Real actions */}
                <div className="flex items-center gap-1 flex-wrap">
                  {selectedMessage.recipient_phone && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${selectedMessage.recipient_phone}`}>
                        <Phone className="mr-1 h-3.5 w-3.5" /> Call
                      </a>
                    </Button>
                  )}
                  {selectedMessage.recipient_phone && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`sms:${selectedMessage.recipient_phone}`}>
                        <MessageSquare className="mr-1 h-3.5 w-3.5" /> Text
                      </a>
                    </Button>
                  )}
                  {selectedMessage.recipient_email && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`mailto:${selectedMessage.recipient_email}?subject=Re: ${encodeURIComponent(selectedMessage.subject || selectedMessage.title)}`}>
                        <Mail className="mr-1 h-3.5 w-3.5" /> Reply
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => resendSingle(selectedMessage)} disabled={resending}>
                    <RotateCcw className={cn("mr-1 h-3.5 w-3.5", resending && "animate-spin")} /> Resend
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => copyRecipient(selectedMessage)}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Copy Recipient
                      </DropdownMenuItem>
                      {!selectedMessage.opened_at && selectedMessage.source === "notification_log" && (
                        <DropdownMenuItem onClick={() => markRead(selectedMessage)}>
                          <CheckCheck className="mr-2 h-3.5 w-3.5" /> Mark Read
                        </DropdownMenuItem>
                      )}
                      {selectedMessage.agent_id && (
                        <DropdownMenuItem asChild>
                          <a href={`/dashboard/agent-management?agent=${selectedMessage.agent_id}`}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" /> View Agent
                          </a>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteMessage(selectedMessage)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete from Log
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">To</p>
                  <p className="font-medium break-all">
                    {selectedMessage.recipient_email || selectedMessage.recipient_phone || "—"}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Sent</p>
                  <p className="font-medium">{format(new Date(selectedMessage.created_at), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
                {selectedMessage.opened_at && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Opened</p>
                    <p className="font-medium">{format(new Date(selectedMessage.opened_at), "MMM d 'at' h:mm a")}</p>
                  </div>
                )}
                {typeof selectedMessage.open_count === "number" && selectedMessage.open_count > 0 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Open Count</p>
                    <p className="font-medium">{selectedMessage.open_count}</p>
                  </div>
                )}
                {selectedMessage.error_message && (
                  <div className="col-span-2">
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Error</p>
                    <p className="text-sm text-destructive">{selectedMessage.error_message}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Message</p>
                <div className="max-w-none whitespace-pre-wrap text-sm">
                  {selectedMessage.body || selectedMessage.message || "No message content logged."}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
