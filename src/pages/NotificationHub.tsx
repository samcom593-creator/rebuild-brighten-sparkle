import { useState, useEffect, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Bell, Mail, MessageSquare, Smartphone, AlertTriangle, Send, Search, RefreshCw, Zap, Phone, Radio, CheckCircle, ChevronLeft, ChevronRight, RotateCcw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { CARRIER_OPTIONS } from "@/lib/carrierOptions";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

// ─── Summary Stats ───
function NotificationStats({ logs, onFilterChannel }: { logs: any[]; onFilterChannel: (ch: string) => void }) {
  const { playSound } = useSoundEffects();
  const today = new Date().toISOString().split("T")[0];
  const todayLogs = logs.filter((l) => l.created_at?.startsWith(today));

  const sentCount = todayLogs.filter(l => l.status === "sent").length;
  const failedCount = todayLogs.filter(l => l.status === "failed").length;
  const successRate = todayLogs.length > 0 ? Math.round((sentCount / todayLogs.length) * 100) : 100;

  const stats = [
    { label: "Total Today", value: todayLogs.length, icon: Bell, gradient: "from-primary/20 to-primary/5 border-primary/20", color: "text-primary", filter: "all" },
    { label: "Push", value: todayLogs.filter((l) => l.channel === "push").length, icon: Smartphone, gradient: "from-blue-500/20 to-blue-500/5 border-blue-500/20", color: "text-blue-400", filter: "push" },
    { label: "SMS", value: todayLogs.filter((l) => l.channel === "sms").length, icon: MessageSquare, gradient: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20", color: "text-emerald-400", filter: "sms" },
    { label: "Auto SMS", value: todayLogs.filter((l) => l.channel === "sms-auto").length, icon: Radio, gradient: "from-purple-500/20 to-purple-500/5 border-purple-500/20", color: "text-purple-400", filter: "sms-auto" },
    { label: "Email", value: todayLogs.filter((l) => l.channel === "email").length, icon: Mail, gradient: "from-amber-500/20 to-amber-500/5 border-amber-500/20", color: "text-amber-400", filter: "email" },
    { label: "Failed", value: failedCount, icon: AlertTriangle, gradient: "from-red-500/20 to-red-500/5 border-red-500/20", color: "text-red-400", filter: "failed" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 200 }}
          >
            <button
              onClick={() => {
                playSound("click");
                onFilterChannel(s.filter === "failed" ? "all" : s.filter);
              }}
              className={cn(
                "relative w-full overflow-hidden rounded-xl border bg-gradient-to-br p-4 backdrop-blur-sm transition-all hover:scale-[1.03] hover:shadow-lg text-left",
                s.gradient
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
                  <s.icon className={cn("h-5 w-5", s.color)} />
                </div>
                <div>
                  <p className={cn("text-2xl font-bold", s.color)}>
                    <AnimatedCounter value={s.value} />
                  </p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
              <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-current opacity-10 blur-xl" />
            </button>
          </motion.div>
        ))}
      </div>

      {/* Success Rate Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex items-center gap-3 px-1"
      >
        <span className="text-xs text-muted-foreground whitespace-nowrap">Success Rate (today)</span>
        <Progress value={successRate} className="h-2 flex-1" />
        <span className={cn("text-sm font-bold", successRate >= 90 ? "text-emerald-400" : successRate >= 70 ? "text-amber-400" : "text-red-400")}>
          {successRate}%
        </span>
      </motion.div>
    </div>
  );
}

// ─── Channel Badge ───
function ChannelBadge({ channel }: { channel: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; className?: string }> = {
    push: { variant: "default", label: "Push" },
    sms: { variant: "secondary", label: "SMS" },
    "sms-auto": { variant: "outline", label: "SMS Auto", className: "border-purple-500 text-purple-600" },
    email: { variant: "outline", label: "Email" },
  };
  const c = config[channel] || { variant: "outline" as const, label: channel };
  return <Badge variant={c.variant} className={c.className}>{c.label}</Badge>;
}

const channelBorderColor: Record<string, string> = {
  push: "border-l-blue-500",
  sms: "border-l-emerald-500",
  "sms-auto": "border-l-purple-500",
  email: "border-l-amber-500",
};

// ─── Carrier Auto-Save Indicator (replaces MarkDeliveredButton) ───
function CarrierIndicator({ log }: { log: any }) {
  if (log.channel !== "sms-auto") return null;
  
  const carrierSelected = log.metadata?.carrierSelected || log.metadata?.carrier_selected;
  const carrierId = carrierSelected || log.metadata?.carrier;
  
  if (!carrierId) return null;
  
  const carrierLabel = CARRIER_OPTIONS.find(c => c.value === carrierId)?.label || carrierId;
  
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-purple-500">
      <CheckCircle className="h-3 w-3" />
      {carrierLabel}
    </span>
  );
}

// ─── Notification Log Table with Pagination ───
const PAGE_SIZE = 25;

function NotificationLogTable({ logs, search, channelFilter, statusFilter, onRefresh }: {
  logs: any[];
  search: string;
  channelFilter: string;
  statusFilter: string;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { playSound } = useSoundEffects();

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (channelFilter && channelFilter !== "all" && l.channel !== channelFilter) return false;
      if (statusFilter && statusFilter !== "all" && l.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.recipient_email?.toLowerCase().includes(q) ||
          l.recipient_phone?.toLowerCase().includes(q) ||
          l.title?.toLowerCase().includes(q) ||
          l.message?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, search, channelFilter, statusFilter]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, channelFilter, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, filtered.length);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="hidden md:table-cell">Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No notifications found
                </TableCell>
              </TableRow>
            ) : (
              paged.map((log) => (
                <Fragment key={log.id}>
                  <TableRow
                    className={cn(
                      "border-l-[3px] cursor-pointer transition-colors hover:bg-muted/50",
                      channelBorderColor[log.channel] || "border-l-transparent"
                    )}
                    onClick={() => {
                      playSound("click");
                      setExpandedId(expandedId === log.id ? null : log.id);
                    }}
                  >
                    <TableCell className="text-xs whitespace-nowrap">
                      {log.created_at ? format(new Date(log.created_at), "MMM d, h:mm a") : "—"}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {log.recipient_email || log.recipient_phone || "—"}
                    </TableCell>
                    <TableCell><ChannelBadge channel={log.channel} /></TableCell>
                    <TableCell className="text-sm font-medium max-w-[200px] truncate">{log.title}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[250px] truncate">
                      {log.message}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <CarrierIndicator log={log} />
                    </TableCell>
                  </TableRow>
                  {/* Expanded detail row */}
                  {expandedId === log.id && (
                    <TableRow key={`${log.id}-detail`} className="bg-muted/30">
                      <TableCell colSpan={7} className="py-3 px-6">
                        <div className="text-sm space-y-1">
                          <p><span className="text-muted-foreground">Full Message:</span> {log.message || "—"}</p>
                          {log.error_message && <p className="text-red-400"><span className="text-muted-foreground">Error:</span> {log.error_message}</p>}
                          {log.recipient_email && <p><span className="text-muted-foreground">Email:</span> {log.recipient_email}</p>}
                          {log.recipient_phone && <p><span className="text-muted-foreground">Phone:</span> {log.recipient_phone}</p>}
                          <p className="text-muted-foreground text-xs">
                            Sent {log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "—"}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {start}–{end} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-muted-foreground">Page {page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Carrier Assignment Tool ───
function CarrierAssignmentTool() {
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCarrier, setBulkCarrier] = useState("");
  const [autoBlasting, setAutoBlasting] = useState(false);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads-missing-carrier"],
    queryFn: async () => {
      const { data: apps } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, carrier")
        .not("phone", "is", null)
        .is("terminated_at", null)
        .order("created_at", { ascending: false });
      return (apps || []).filter((a: any) => !a.carrier);
    },
  });

  const updateCarrier = useMutation({
    mutationFn: async ({ id, carrier }: { id: string; carrier: string }) => {
      const { error } = await supabase.from("applications").update({ carrier }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads-missing-carrier"] });
      playSound("success");
      toast.success("Carrier updated");
    },
  });

  const bulkAssign = async () => {
    if (!bulkCarrier || selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await updateCarrier.mutateAsync({ id, carrier: bulkCarrier });
    }
    setSelectedIds(new Set());
    setBulkCarrier("");
    playSound("celebrate");
    toast.success(`Carrier assigned to ${selectedIds.size} leads`);
  };

  const handleAutoBlast = async () => {
    if (!leads?.length) return;
    setAutoBlasting(true);
    let sent = 0;
    try {
      for (const lead of leads) {
        if (!lead.phone) continue;
        const { error } = await supabase.functions.invoke("send-sms-auto-detect", {
          body: {
            phone: lead.phone,
            message: `Hey ${lead.first_name}! Apex Financial has an opportunity for you — check your email! 🚀`.substring(0, 160),
            applicationId: lead.id,
          },
        });
        if (!error) sent++;
      }
      playSound("celebrate");
      toast.success(`Auto-blast sent to ${sent} leads across all carriers`);
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Auto-blast failed");
    } finally {
      setAutoBlasting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === (leads?.length || 0)) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads?.map((l: any) => l.id) || []));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className={cn(
        "relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 backdrop-blur-sm",
        "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20"
      )}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
            <Phone className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Carrier Assignment</h3>
            <p className="text-sm text-muted-foreground">
              <span className="text-emerald-400 font-bold">{leads?.length || 0}</span> leads missing carrier
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Select value={bulkCarrier} onValueChange={setBulkCarrier}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Bulk carrier..." />
                </SelectTrigger>
                <SelectContent>
                  {CARRIER_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={bulkAssign} disabled={!bulkCarrier}>
                Assign All
              </Button>
            </div>
          )}

          {(leads?.length || 0) > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={autoBlasting} className="border-purple-500 text-purple-600 hover:bg-purple-50">
                  {autoBlasting ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Auto-Blasting...</>
                  ) : (
                    <><Radio className="h-4 w-4 mr-2" />Auto-Blast All ({leads?.length})</>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Auto-Blast SMS to All Carriers</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will send an SMS through <strong>all 8 carrier gateways</strong> for each of the <strong>{leads?.length} leads</strong> without a carrier assigned.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleAutoBlast}>Auto-Blast Now</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <div className="rounded-lg border border-border overflow-hidden max-h-[400px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={leads?.length > 0 && selectedIds.size === leads?.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Carrier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6">Loading...</TableCell></TableRow>
              ) : leads?.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">All leads have carriers assigned ✓</TableCell></TableRow>
              ) : (
                leads?.map((lead: any) => (
                  <TableRow key={lead.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                      />
                    </TableCell>
                    <TableCell className="text-sm font-medium">{lead.first_name} {lead.last_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.phone}</TableCell>
                    <TableCell>
                      <Select onValueChange={(v) => updateCarrier.mutate({ id: lead.id, carrier: v })}>
                        <SelectTrigger className="w-[150px] h-8">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {CARRIER_OPTIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500 opacity-5 blur-2xl" />
      </div>
    </motion.div>
  );
}

// ─── Quick Action Cards ───
function QuickActionCards({ boostLocked }: { boostLocked?: boolean }) {
  const [textingAll, setTextingAll] = useState(false);
  const [textingCourse, setTextingCourse] = useState(false);
  const [sendingOptIn, setSendingOptIn] = useState(false);
  const [resendingFailed, setResendingFailed] = useState(false);
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();

  // Batch-based "Text All" — processes in chunks of 5, never times out
  const handleTextAll = async () => {
    setTextingAll(true);
    playSound("whoosh");
    try {
      // Fetch all IDs client-side
      const { data: apps } = await supabase
        .from("applications")
        .select("id")
        .is("terminated_at", null)
        .not("email", "is", null);
      const { data: aged } = await supabase
        .from("aged_leads")
        .select("id")
        .not("email", "is", null);

      const appIds = (apps || []).map((a: any) => a.id);
      const agedIds = (aged || []).map((a: any) => a.id);
      const totalLeads = appIds.length + agedIds.length;

      if (totalLeads === 0) {
        toast.info("No leads to blast");
        return;
      }

      // This is handled by BulkBlastSection now — just redirect user
      toast.info("Use the Bulk Blast tab for the full batch blast with live progress!");
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Text all failed");
    } finally {
      setTextingAll(false);
    }
  };

  const handleTextCourseProgress = async () => {
    setTextingCourse(true);
    playSound("whoosh");
    try {
      const { data: apps } = await supabase
        .from("applications")
        .select("id, first_name, phone, license_progress")
        .is("terminated_at", null)
        .not("phone", "is", null)
        .in("license_progress", ["finished_course", "course_purchased"]);

      if (!apps?.length) {
        toast.info("No applicants with course progress found");
        return;
      }

      let sent = 0;
      for (const app of apps) {
        try {
          await supabase.functions.invoke("send-sms-auto-detect", {
            body: {
              phone: app.phone,
              message: `Hey ${app.first_name}! You're making great progress on your course. Let's schedule a call to discuss next steps! 📞`,
              applicationId: app.id,
            },
          });
          sent++;
        } catch {
          // continue
        }
      }
      playSound("celebrate");
      toast.success(`Sent scheduling SMS to ${sent} applicants with course progress`);
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Course progress text failed");
    } finally {
      setTextingCourse(false);
    }
  };

  const handleSendOptIn = async () => {
    setSendingOptIn(true);
    playSound("whoosh");
    try {
      const { data, error } = await supabase.functions.invoke("send-push-optin-email", {
        method: "POST",
        body: {},
      });
      if (error) throw error;
      playSound("celebrate");
      toast.success(`Opt-in emails sent: ${data?.sent || 0}`);
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Opt-in email failed");
    } finally {
      setSendingOptIn(false);
    }
  };

  const handleResendFailed = async () => {
    setResendingFailed(true);
    playSound("whoosh");
    try {
      const today = new Date().toISOString().split("T")[0];

      // 1. Load today's failed + sent logs in parallel
      const [failedRes, sentRes] = await Promise.all([
        supabase
          .from("notification_log")
          .select("id, channel, recipient_user_id, recipient_email, recipient_phone, title, message, metadata, error_message")
          .eq("status", "failed")
          .gte("created_at", `${today}T00:00:00`)
          .order("created_at", { ascending: false }),
        supabase
          .from("notification_log")
          .select("channel, recipient_user_id, recipient_email, recipient_phone, title, message, metadata")
          .eq("status", "sent")
          .gte("created_at", `${today}T00:00:00`),
      ]);

      if (failedRes.error) throw failedRes.error;
      const failedLogs = failedRes.data || [];
      const sentLogs = sentRes.data || [];

      if (!failedLogs.length) {
        toast.info("No failed notifications today!");
        return;
      }

      // 2. Build target key for deduplication
      const getTargetKey = (log: any): string => {
        const meta = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
          ? (log.metadata as Record<string, unknown>)
          : {};
        const ch = log.channel === "sms-auto" ? "sms" : log.channel; // normalize sms channels
        if (ch === "push") return `push|${log.recipient_user_id}|${log.title}`;
        if (ch === "email") return `email|${log.recipient_email}|${log.title}`;
        // SMS — key by phone + applicationId/agedLeadId
        const leadKey = meta.applicationId || meta.agedLeadId || log.recipient_phone || "";
        return `sms|${leadKey}|${log.message?.substring(0, 40)}`;
      };

      // 3. Build set of already-delivered target keys
      const deliveredKeys = new Set<string>();
      for (const s of sentLogs) {
        deliveredKeys.add(getTargetKey(s));
      }

      // 4. Deduplicate failed logs — one retry candidate per target key
      const seen = new Map<string, any>();
      let skippedDelivered = 0;
      let skippedNoSub = 0;

      for (const log of failedLogs) {
        const key = getTargetKey(log);
        // Skip if already delivered today
        if (deliveredKeys.has(key)) { skippedDelivered++; continue; }
        // Skip non-actionable push failures (no subscriptions)
        if (log.channel === "push" && log.error_message?.includes("No push subscriptions")) { skippedNoSub++; continue; }
        // Keep first occurrence only
        if (!seen.has(key)) seen.set(key, log);
      }

      const candidates = Array.from(seen.values());

      if (candidates.length === 0) {
        toast.info(`All ${failedLogs.length} failures resolved or non-actionable (${skippedDelivered} already delivered, ${skippedNoSub} no push subs)`);
        return;
      }

      // 5. Retry with pacing
      let attempted = 0;
      let resent = 0;
      const channelSummary = {
        push: { attempted: 0, resent: 0 },
        email: { attempted: 0, resent: 0 },
        sms: { attempted: 0, resent: 0 },
      };

      const paceDelay = (ms: number) => new Promise(r => setTimeout(r, ms));

      for (const log of candidates) {
        try {
          if (log.channel === "push" && log.recipient_user_id) {
            attempted++;
            channelSummary.push.attempted++;
            const { data } = await supabase.functions.invoke("send-push-notification", {
              body: { userId: log.recipient_user_id, title: log.title, body: log.message },
            });
            if (data?.sent > 0) {
              resent++;
              channelSummary.push.resent++;
            }
          } else if (log.channel === "email" && log.recipient_email) {
            attempted++;
            channelSummary.email.attempted++;
            const { data, error } = await supabase.functions.invoke("send-notification", {
              body: { email: log.recipient_email, title: log.title, message: log.message },
            });
            if (!error && data?.channels?.email) {
              resent++;
              channelSummary.email.resent++;
            }
          } else if ((log.channel === "sms-auto" || log.channel === "sms") && log.recipient_phone) {
            attempted++;
            channelSummary.sms.attempted++;
            const meta = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
              ? (log.metadata as Record<string, unknown>)
              : {};
            const { data, error } = await supabase.functions.invoke("send-sms-auto-detect", {
              body: {
                phone: log.recipient_phone,
                message: (log.message || `${log.title}: retry`).substring(0, 160),
                applicationId: typeof meta.applicationId === "string" ? meta.applicationId : null,
                agedLeadId: typeof meta.agedLeadId === "string" ? meta.agedLeadId : null,
              },
            });
            if (!error && (data?.successCount || 0) > 0) {
              resent++;
              channelSummary.sms.resent++;
            }
          }
        } catch {
          // skip individual failures
        }
        await paceDelay(300);
      }

      playSound("celebrate");
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });

      const parts = [
        `✅ ${resent}/${attempted} retried`,
        skippedDelivered > 0 ? `${skippedDelivered} already delivered` : "",
        skippedNoSub > 0 ? `${skippedNoSub} no push subs` : "",
        `Push ${channelSummary.push.resent}/${channelSummary.push.attempted}`,
        `SMS ${channelSummary.sms.resent}/${channelSummary.sms.attempted}`,
        `Email ${channelSummary.email.resent}/${channelSummary.email.attempted}`,
      ].filter(Boolean);

      toast.success(parts.join(" · "));
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Resend failed");
    } finally {
      setResendingFailed(false);
    }
  };

  const actions = [
    {
      title: "Text All Applicants",
      desc: "Push + SMS + Email blast",
      icon: Send,
      gradient: "from-primary/20 to-primary/5 border-primary/20",
      color: "text-primary",
      loading: textingAll,
      handler: handleTextAll,
      confirmTitle: "Text All Applicants",
      confirmDesc: "This sends push notifications, SMS, and email to every active applicant and aged lead.",
    },
    {
      title: "Course Progress Leads",
      desc: "SMS to schedule meeting",
      icon: MessageSquare,
      gradient: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20",
      color: "text-emerald-400",
      loading: textingCourse,
      handler: handleTextCourseProgress,
      confirmTitle: "Text Course Progress Leads",
      confirmDesc: "Send an SMS to all applicants who have started or completed their course.",
    },
    {
      title: "Send Opt-In Email",
      desc: "Enable push notifications",
      icon: Bell,
      gradient: "from-amber-500/20 to-amber-500/5 border-amber-500/20",
      color: "text-amber-400",
      loading: sendingOptIn,
      handler: handleSendOptIn,
      confirmTitle: "Send Push Notification Opt-In Email",
      confirmDesc: "Send an email to all active applicants encouraging them to enable push notifications.",
    },
    {
      title: "Resend All Failed",
      desc: "Retry unresolved failures (deduped)",
      icon: RotateCcw,
      gradient: "from-red-500/20 to-red-500/5 border-red-500/20",
      color: "text-red-400",
      loading: resendingFailed,
      handler: handleResendFailed,
      confirmTitle: "Resend Unresolved Failures",
      confirmDesc: "Deduplicates failed logs, skips already-delivered and non-actionable entries, then retries only unresolved targets with pacing.",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      {actions.map((action, i) => (
        <motion.div
          key={action.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={action.loading || boostLocked}
                className={cn(
                  "relative w-full overflow-hidden rounded-xl border bg-gradient-to-br p-5 backdrop-blur-sm transition-all text-left",
                  boostLocked ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.03] hover:shadow-lg",
                  action.gradient
                )}
                title={boostLocked ? "Finish or discard the current boost first" : undefined}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background/50">
                    {action.loading ? (
                      <RefreshCw className={cn("h-6 w-6 animate-spin", action.color)} />
                    ) : (
                      <action.icon className={cn("h-6 w-6", action.color)} />
                    )}
                  </div>
                  <span className="font-semibold text-sm">{action.title}</span>
                  <span className="text-xs text-muted-foreground">{action.desc}</span>
                </div>
                <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-current opacity-10 blur-xl" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{action.confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>{action.confirmDesc}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={action.handler}>Send Now</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Blast Progress Persistence ───
const BLAST_STORAGE_KEY = "apex_blast_progress";

interface BlastProgress {
  batchIndex: number;
  totalBatches: number;
  batches: { ids: string[]; type: "applicant" | "aged" }[];
  stats: { push_sent: number; sms_sent: number; emailed: number; failed: number };
  startedAt: string;
}

function saveBlastProgress(progress: BlastProgress) {
  localStorage.setItem(BLAST_STORAGE_KEY, JSON.stringify(progress));
}

function loadBlastProgress(): BlastProgress | null {
  try {
    const raw = localStorage.getItem(BLAST_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function clearBlastProgress() {
  localStorage.removeItem(BLAST_STORAGE_KEY);
}

// ─── Bulk Blast Section ───
function BulkBlastSection({ onBoostLockChange }: { onBoostLockChange?: (locked: boolean) => void }) {
  const [blasting, setBlasting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [stats, setStats] = useState({ push_sent: 0, sms_sent: 0, emailed: 0, failed: 0 });
  const [lastResult, setLastResult] = useState<any>(null);
  const [savedProgress, setSavedProgress] = useState<BlastProgress | null>(null);
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [autoResumeCountdown, setAutoResumeCountdown] = useState<number | null>(null);

  // Load saved progress on mount + auto-resume countdown
  useEffect(() => {
    const saved = loadBlastProgress();
    if (saved && saved.batchIndex < saved.totalBatches) {
      setSavedProgress(saved);
      onBoostLockChange?.(true);
      setAutoResumeCountdown(3);
    } else if (saved) {
      clearBlastProgress();
    }
  }, []);

  // Auto-resume countdown timer
  useEffect(() => {
    if (autoResumeCountdown === null || autoResumeCountdown <= 0) return;
    const timer = setTimeout(() => setAutoResumeCountdown(autoResumeCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [autoResumeCountdown]);

  // Auto-resume when countdown hits 0
  useEffect(() => {
    if (autoResumeCountdown === 0 && savedProgress && !blasting) {
      setAutoResumeCountdown(null);
      handleResume();
    }
  }, [autoResumeCountdown]);

  const { data: counts } = useQuery({
    queryKey: ["blast-counts"],
    queryFn: async () => {
      const { count: appCount } = await supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .is("terminated_at", null);
      const { count: agedCount } = await supabase
        .from("aged_leads")
        .select("*", { count: "exact", head: true });
      return { applicants: appCount || 0, agedLeads: agedCount || 0 };
    },
  });

  const runBlast = async (startFromIndex: number, batches: { ids: string[]; type: "applicant" | "aged" }[], initialStats?: typeof stats) => {
    setBlasting(true);
    setLastResult(null);
    const accumulated = initialStats ? { ...initialStats } : { push_sent: 0, sms_sent: 0, emailed: 0, failed: 0 };
    setStats(accumulated);
    playSound("whoosh");

    const totalBatches = batches.length;
    setProgress({ current: startFromIndex, total: totalBatches, percent: Math.round((startFromIndex / totalBatches) * 100) });

    try {
      for (let i = startFromIndex; i < batches.length; i++) {
        const batch = batches[i];
        try {
          const { data, error } = await supabase.functions.invoke("send-batch-blast", {
            body: { leadIds: batch.ids, type: batch.type },
          });

          if (!error && data?.stats) {
            accumulated.push_sent += data.stats.push_sent || 0;
            accumulated.sms_sent += data.stats.sms_sent || 0;
            accumulated.emailed += data.stats.emailed || 0;
            accumulated.failed += data.stats.failed || 0;
          } else {
            accumulated.failed += batch.ids.length;
          }
        } catch {
          accumulated.failed += batch.ids.length;
        }

        const pct = Math.round(((i + 1) / totalBatches) * 100);
        setProgress({ current: i + 1, total: totalBatches, percent: pct });
        setStats({ ...accumulated });

        // Save progress after each batch
        saveBlastProgress({
          batchIndex: i + 1,
          totalBatches,
          batches,
          stats: { ...accumulated },
          startedAt: savedProgress?.startedAt || new Date().toISOString(),
        });

        if (i < batches.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Blast complete
      clearBlastProgress();
      setSavedProgress(null);
      setLastResult(accumulated);
      onBoostLockChange?.(false);
      playSound("celebrate");
      confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 } });
      toast.success(`Blast complete! Push: ${accumulated.push_sent}, SMS: ${accumulated.sms_sent}, Email: ${accumulated.emailed}`);
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Blast failed");
    } finally {
      setBlasting(false);
    }
  };

  const handleBlast = async () => {
    try {
      const { data: apps } = await supabase
        .from("applications")
        .select("id")
        .is("terminated_at", null)
        .not("email", "is", null);
      const { data: aged } = await supabase
        .from("aged_leads")
        .select("id")
        .not("email", "is", null);

      const appIds = (apps || []).map((a: any) => a.id);
      const agedIds = (aged || []).map((a: any) => a.id);

      const BATCH_SIZE = 5;
      const batches: { ids: string[]; type: "applicant" | "aged" }[] = [];
      for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
        batches.push({ ids: appIds.slice(i, i + BATCH_SIZE), type: "applicant" });
      }
      for (let i = 0; i < agedIds.length; i += BATCH_SIZE) {
        batches.push({ ids: agedIds.slice(i, i + BATCH_SIZE), type: "aged" });
      }

      await runBlast(0, batches);
    } catch (err: any) {
      playSound("error");
      toast.error(err.message || "Blast failed");
    }
  };

  const handleResume = async () => {
    if (!savedProgress) return;
    const sp = savedProgress;
    setSavedProgress(null);
    await runBlast(sp.batchIndex, sp.batches, sp.stats);
  };

  const handleDiscard = () => {
    clearBlastProgress();
    setSavedProgress(null);
    setAutoResumeCountdown(null);
    onBoostLockChange?.(false);
    toast.info("Previous blast progress discarded");
  };

  const totalLeads = (counts?.applicants || 0) + (counts?.agedLeads || 0);
  const estimatedBatches = Math.ceil(totalLeads / 5);

  return (
    <div className="space-y-4">
      <QuickActionCards boostLocked={!!(savedProgress || blasting)} />

      {/* Resume Blast Card */}
      {savedProgress && !blasting && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className={cn(
            "relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 backdrop-blur-sm",
            "from-blue-500/10 to-blue-500/5 border-blue-500/20"
          )}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
                <Zap className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">
                  {autoResumeCountdown !== null && autoResumeCountdown > 0
                    ? `Auto-resuming in ${autoResumeCountdown}…`
                    : "Resume Previous Blast"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {Math.round((savedProgress.batchIndex / savedProgress.totalBatches) * 100)}% complete — {savedProgress.batchIndex} of {savedProgress.totalBatches} batches sent
                </p>
              </div>
            </div>

            <Progress value={Math.round((savedProgress.batchIndex / savedProgress.totalBatches) * 100)} className="h-3 mb-4" />

            <div className="grid grid-cols-3 gap-2 text-center mb-4">
              <div className="rounded-lg bg-blue-500/10 p-2">
                <p className="text-lg font-bold text-blue-400">{savedProgress.stats.push_sent}</p>
                <p className="text-[10px] text-muted-foreground">Push</p>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <p className="text-lg font-bold text-emerald-400">{savedProgress.stats.sms_sent}</p>
                <p className="text-[10px] text-muted-foreground">SMS</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-2">
                <p className="text-lg font-bold text-amber-400">{savedProgress.stats.emailed}</p>
                <p className="text-[10px] text-muted-foreground">Email</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button className="flex-1" size="lg" onClick={handleResume}>
                <Send className="h-4 w-4 mr-2" />
                Continue Blast ({savedProgress.totalBatches - savedProgress.batchIndex} batches left)
              </Button>
              <Button variant="outline" size="lg" onClick={handleDiscard}>
                Discard
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className={cn(
          "relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 backdrop-blur-sm",
          "from-amber-500/10 to-amber-500/5 border-amber-500/20"
        )}>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
              <Rocket className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Bulk Blast — Send to All Leads</h3>
              <p className="text-sm text-muted-foreground">Push + SMS + Email · Batched (never times out)</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={cn("rounded-xl border bg-gradient-to-br p-4 from-blue-500/10 to-blue-500/5 border-blue-500/20")}>
              <p className="text-2xl font-bold text-blue-400"><AnimatedCounter value={counts?.applicants || 0} /></p>
              <p className="text-xs text-muted-foreground">Active Applicants</p>
            </div>
            <div className={cn("rounded-xl border bg-gradient-to-br p-4 from-purple-500/10 to-purple-500/5 border-purple-500/20")}>
              <p className="text-2xl font-bold text-purple-400"><AnimatedCounter value={counts?.agedLeads || 0} /></p>
              <p className="text-xs text-muted-foreground">Aged Leads</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Processes in batches of 5. ~{estimatedBatches} batches total. Each batch takes ~5-8 seconds.
          </p>

          {/* Live Progress */}
          <AnimatePresence>
            {blasting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 space-y-3 p-4 rounded-xl bg-muted/30 border border-border"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    Sending... {progress.current}/{progress.total} batches ({progress.percent}%)
                  </span>
                  <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                </div>
                <Progress value={progress.percent} className="h-3" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-blue-500/10 p-2">
                    <p className="text-lg font-bold text-blue-400">{stats.push_sent}</p>
                    <p className="text-[10px] text-muted-foreground">Push</p>
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 p-2">
                    <p className="text-lg font-bold text-emerald-400">{stats.sms_sent}</p>
                    <p className="text-[10px] text-muted-foreground">SMS</p>
                  </div>
                  <div className="rounded-lg bg-amber-500/10 p-2">
                    <p className="text-lg font-bold text-amber-400">{stats.emailed}</p>
                    <p className="text-[10px] text-muted-foreground">Email</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" size="lg" disabled={blasting}>
                {blasting ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sending ({progress.percent}%)...</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" />Blast All Leads (All Channels)</>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Full Blast</AlertDialogTitle>
                <AlertDialogDescription>
                  This will send push, SMS, and email to <strong>{counts?.applicants || 0} applicants</strong> and <strong>{counts?.agedLeads || 0} aged leads</strong> in batches of 5.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBlast}>Send Now</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Blast Results */}
          <AnimatePresence>
            {lastResult && !blasting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2"
              >
                {[
                  { label: "Push Sent", value: lastResult.push_sent || 0, color: "text-blue-400" },
                  { label: "SMS Sent", value: lastResult.sms_sent || 0, color: "text-emerald-400" },
                  { label: "Emailed", value: lastResult.emailed || 0, color: "text-amber-400" },
                  { label: "Failed", value: lastResult.failed || 0, color: "text-red-400" },
                ].map(r => (
                  <div key={r.label} className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className={cn("text-xl font-bold", r.color)}><AnimatedCounter value={r.value} /></p>
                    <p className="text-[10px] text-muted-foreground">{r.label}</p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500 opacity-5 blur-2xl" />
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Page ───
export default function NotificationHub() {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("logs");
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // Single-boost lock: check if there's a blast in progress
  const [boostLocked, setBoostLocked] = useState(() => {
    const saved = loadBlastProgress();
    return !!(saved && saved.batchIndex < saved.totalBatches);
  });

  // Auto-resume: if saved progress exists, switch to blast tab
  useEffect(() => {
    const saved = loadBlastProgress();
    if (saved && saved.batchIndex < saved.totalBatches) {
      setActiveTab("blast");
      setBoostLocked(true);
    }
  }, []);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["notification-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setLastRefreshed(new Date());
      return data || [];
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    playSound("whoosh");
    await queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    setTimeout(() => setRefreshing(false), 600);
  };

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("notification-log-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_log" }, () => {
        queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const tabCounts = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const todayLogs = logs.filter(l => l.created_at?.startsWith(today));
    return {
      logs: todayLogs.length,
      carriers: 0, // loaded lazily
      blast: 0,
    };
  }, [logs]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Premium Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-blue-500/5 to-background p-6 backdrop-blur-sm"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                <Bell className="h-6 w-6 text-primary" />
              </div>
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Notification Hub</h1>
              <p className="text-sm text-muted-foreground">
                Track every push, SMS, auto-SMS, and email · Last refreshed {formatDistanceToNow(lastRefreshed, { addSuffix: true })}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4 mr-1", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary opacity-5 blur-3xl" />
      </motion.div>

      <NotificationStats logs={logs} onFilterChannel={(ch) => {
        setChannelFilter(ch);
        setActiveTab("logs");
      }} />

      <Tabs value={activeTab} onValueChange={(v) => {
        playSound("click");
        setActiveTab(v);
      }} className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs" className="gap-1">
            Notification Log
            {tabCounts.logs > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{tabCounts.logs}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="carriers">Carrier Assignment</TabsTrigger>
          <TabsTrigger value="blast">Bulk Blast</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email, phone, or title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="push">Push</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="sms-auto">SMS Auto</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <NotificationLogTable logs={logs} search={search} channelFilter={channelFilter} statusFilter={statusFilter} onRefresh={handleRefresh} />
          )}
        </TabsContent>

        <TabsContent value="carriers">
          <CarrierAssignmentTool />
        </TabsContent>

        <TabsContent value="blast">
          <BulkBlastSection onBoostLockChange={setBoostLocked} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
