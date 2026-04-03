import { useState, useEffect, useMemo } from "react";
import { Mail, MessageSquare, Bell, Search, RefreshCw, RotateCcw, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

interface NotifMessage {
  id: string;
  channel: string;
  title: string;
  message: string;
  subject?: string;
  body?: string;
  notification_type?: string;
  status: string;
  recipient_email?: string;
  recipient_phone?: string;
  recipient_user_id?: string;
  agent_id?: string;
  created_at: string;
  opened_at?: string;
  error_message?: string;
}

export default function InboxPage() {
  const { isAdmin } = useAuth();
  const [messages, setMessages] = useState<NotifMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "email" | "sms" | "push">("all");
  const [search, setSearch] = useState("");

  const fetchMessages = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notification_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && data) setMessages(data as NotifMessage[]);
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_log" }, (payload) => {
        setMessages(prev => [payload.new as NotifMessage, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = useMemo(() => {
    let result = messages;
    if (filter !== "all") result = result.filter(m => m.channel === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        (m.title || "").toLowerCase().includes(q) ||
        (m.recipient_email || "").toLowerCase().includes(q) ||
        (m.message || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [messages, filter, search]);

  const selected = useMemo(() => filtered.find(m => m.id === selectedId), [filtered, selectedId]);

  // Stats
  const today = new Date().toISOString().split("T")[0];
  const todayMessages = messages.filter(m => m.created_at?.startsWith(today));
  const emailsToday = todayMessages.filter(m => m.channel === "email").length;
  const smsToday = todayMessages.filter(m => m.channel === "sms").length;
  const delivered = todayMessages.filter(m => m.status === "sent" || m.status === "delivered").length;
  const deliveryRate = todayMessages.length > 0 ? Math.round((delivered / todayMessages.length) * 100) : 100;

  const channelIcon = (ch: string) => {
    if (ch === "email") return <Mail className="h-3.5 w-3.5" />;
    if (ch === "sms") return <MessageSquare className="h-3.5 w-3.5" />;
    return <Bell className="h-3.5 w-3.5" />;
  };

  const statusColor = (s: string) => {
    if (s === "sent" || s === "delivered") return "border-l-emerald-500";
    if (s === "pending") return "border-l-amber-500";
    return "border-l-red-500";
  };

  const handleResend = async (msg: NotifMessage) => {
    toast.info("Resending is not yet wired to an edge function.");
  };

  return (
    <div className="space-y-4 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1" style={{ fontFamily: "Syne" }}>APEX Financial</div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Syne" }}>Inbox</h1>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Emails Today", value: emailsToday, icon: Mail },
          { label: "SMS Today", value: smsToday, icon: MessageSquare },
          { label: "Delivery Rate", value: `${deliveryRate}%`, icon: Bell },
          { label: "Total Sent", value: messages.length, icon: RefreshCw },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 min-h-[60vh]">
        {/* Left Panel */}
        <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border space-y-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList className="grid grid-cols-4 h-8">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="email" className="text-xs">Email</TabsTrigger>
                <TabsTrigger value="sms" className="text-xs">SMS</TabsTrigger>
                <TabsTrigger value="push" className="text-xs">Push</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search messages..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 pl-8 text-sm" />
            </div>
          </div>
          <ScrollArea className="flex-1 max-h-[55vh]">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No messages found</p>
            )}
            {filtered.map(msg => (
              <button
                key={msg.id}
                onClick={() => setSelectedId(msg.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/50 border-l-2 transition-colors hover:bg-muted/50",
                  statusColor(msg.status),
                  selectedId === msg.id && "bg-muted/80"
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {channelIcon(msg.channel)}
                  <span className="text-xs font-medium truncate flex-1">{msg.recipient_email || msg.recipient_phone || "Unknown"}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(msg.created_at), "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="text-sm font-medium truncate">{msg.subject || msg.title}</p>
                <p className="text-xs text-muted-foreground truncate">{msg.message}</p>
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Right Panel */}
        <div className="bg-card border border-border rounded-xl p-4 lg:p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Mail className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a message to view details</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold" style={{ fontFamily: "Syne" }}>{selected.subject || selected.title}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs capitalize">{selected.channel}</Badge>
                    <Badge variant={selected.status === "sent" || selected.status === "delivered" ? "default" : "destructive"} className="text-xs capitalize">{selected.status}</Badge>
                  </div>
                </div>
                {(selected.status === "failed" || selected.status === "error") && (
                  <Button variant="outline" size="sm" onClick={() => handleResend(selected)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resend
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">To</p>
                  <p className="font-medium">{selected.recipient_email || selected.recipient_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sent</p>
                  <p className="font-medium">{format(new Date(selected.created_at), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
                {selected.opened_at && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Opened</p>
                    <p className="font-medium">{format(new Date(selected.opened_at), "MMM d 'at' h:mm a")}</p>
                  </div>
                )}
                {selected.error_message && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Error</p>
                    <p className="text-sm text-destructive">{selected.error_message}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Message</p>
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm whitespace-pre-wrap">
                  {selected.body || selected.message}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
