import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Mail, MessageSquare, RefreshCw, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

type InboxFilter = "all" | "email" | "sms" | "push";
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

const upsertMessage = (current: InboxMessage[], incoming: InboxMessage) =>
  sortMessages([incoming, ...current.filter((item) => item.messageKey !== incoming.messageKey)]);

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");

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
      toast.error("Inbox data loaded with issues", {
        description: "Some communication records could not be loaded. Refresh to retry.",
      });
    }

    const merged = sortMessages([
      ...(notificationRes.data ?? []).map((row) => normalizeNotificationLog(row as NotificationLogRow)),
      ...(emailRes.data ?? []).map((row) => normalizeEmailTracking(row as EmailTrackingRow)),
    ]);

    setMessages(merged);
    setSelectedId((current) => (current && merged.some((item) => item.messageKey === current) ? current : (merged[0]?.messageKey ?? null)));

    if (showSpinner) setLoading(false);
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_log" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as { id?: string } | null)?.id;
          if (!deletedId) return;
          setMessages((current) => current.filter((item) => item.messageKey !== `notification_log:${deletedId}`));
          return;
        }

        const row = payload.new as NotificationLogRow | null;
        if (!row?.id) return;
        setMessages((current) => upsertMessage(current, normalizeNotificationLog(row)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "email_tracking" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as { id?: string } | null)?.id;
          if (!deletedId) return;
          setMessages((current) => current.filter((item) => item.messageKey !== `email_tracking:${deletedId}`));
          return;
        }

        const row = payload.new as EmailTrackingRow | null;
        if (!row?.id) return;
        setMessages((current) => upsertMessage(current, normalizeEmailTracking(row)));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    let result = messages;

    if (filter !== "all") {
      result = result.filter((message) => message.channel === filter);
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter((message) =>
        [
          message.title,
          message.subject,
          message.message,
          message.notification_type,
          message.recipient_email,
          message.recipient_phone,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [messages, filter, search]);

  const selected = useMemo(
    () => filtered.find((message) => message.messageKey === selectedId),
    [filtered, selectedId],
  );

  const today = new Date().toISOString().split("T")[0];
  const todayMessages = useMemo(
    () => messages.filter((message) => message.created_at?.startsWith(today)),
    [messages, today],
  );
  const emailsToday = todayMessages.filter((message) => message.channel === "email").length;
  const smsToday = todayMessages.filter((message) => message.channel === "sms").length;
  const deliveryCandidates = todayMessages.filter((message) => message.deliveryEligible);
  const deliveredCount = deliveryCandidates.filter(
    (message) => SUCCESS_STATUSES.has(message.status) || !!message.opened_at,
  ).length;
  const deliveryRate = deliveryCandidates.length > 0 ? Math.round((deliveredCount / deliveryCandidates.length) * 100) : 100;

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

  const handleResend = async () => {
    toast.info("Resend is only available from the notification tools right now.");
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground" style={{ fontFamily: "Syne" }}>
            APEX Financial
          </div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>
            Inbox
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchMessages()} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Emails Today", value: emailsToday, icon: Mail },
          { label: "SMS Today", value: smsToday, icon: MessageSquare },
          { label: "Delivery Rate", value: `${deliveryRate}%`, icon: Bell },
          { label: "Total Logged", value: messages.length, icon: RefreshCw },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>
                  {stat.value}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-h-[60vh] grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="space-y-2 border-b border-border p-3">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as InboxFilter)}>
              <TabsList className="grid h-8 grid-cols-4">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="email" className="text-xs">Email</TabsTrigger>
                <TabsTrigger value="sms" className="text-xs">SMS</TabsTrigger>
                <TabsTrigger value="push" className="text-xs">Push</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search messages..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          <ScrollArea className="max-h-[55vh] flex-1">
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No messages found</p>}
            {filtered.map((message) => (
              <button
                key={message.messageKey}
                onClick={() => setSelectedId(message.messageKey)}
                className={cn(
                  "w-full border-b border-border/50 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                  statusColor(message.status),
                  selectedId === message.messageKey && "bg-muted/80",
                )}
              >
                <div className="mb-0.5 flex items-center gap-2">
                  {channelIcon(message.channel)}
                  <span className="flex-1 truncate text-xs font-medium">
                    {message.recipient_email || message.recipient_phone || "Unknown"}
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {format(new Date(message.created_at), "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="truncate text-sm font-medium">{message.subject || message.title}</p>
                <p className="truncate text-xs text-muted-foreground">{message.message}</p>
              </button>
            ))}
          </ScrollArea>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 lg:p-6">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a message to view details</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold" style={{ fontFamily: "Syne" }}>
                    {selected.subject || selected.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{selected.channel}</Badge>
                    <Badge
                      variant={SUCCESS_STATUSES.has(selected.status) ? "default" : selected.status === "pending" ? "outline" : "destructive"}
                      className="text-xs capitalize"
                    >
                      {selected.status}
                    </Badge>
                    {selected.notification_type && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {formatEmailTypeLabel(selected.notification_type)}
                      </Badge>
                    )}
                  </div>
                </div>
                {(selected.status === "failed" || selected.status === "error") && (
                  <Button variant="outline" size="sm" onClick={handleResend}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Resend
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">To</p>
                  <p className="font-medium">{selected.recipient_email || selected.recipient_phone || "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Sent</p>
                  <p className="font-medium">{format(new Date(selected.created_at), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
                {selected.opened_at && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Opened</p>
                    <p className="font-medium">{format(new Date(selected.opened_at), "MMM d 'at' h:mm a")}</p>
                  </div>
                )}
                {typeof selected.open_count === "number" && selected.open_count > 0 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Open Count</p>
                    <p className="font-medium">{selected.open_count}</p>
                  </div>
                )}
                {selected.error_message && (
                  <div className="col-span-2">
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Error</p>
                    <p className="text-sm text-destructive">{selected.error_message}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Message</p>
                <div className="max-w-none whitespace-pre-wrap text-sm">{selected.body || selected.message || "No message content logged."}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
