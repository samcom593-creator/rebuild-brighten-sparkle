import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Bell, Mail, MessageSquare, Smartphone, AlertTriangle, Send, Search, RefreshCw, Zap, Phone, Radio, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CARRIER_OPTIONS } from "@/lib/carrierOptions";

// ─── Summary Stats ───
function NotificationStats({ logs }: { logs: any[] }) {
  const today = new Date().toISOString().split("T")[0];
  const todayLogs = logs.filter((l) => l.created_at?.startsWith(today));

  const stats = [
    { label: "Total Today", value: todayLogs.length, icon: Bell, color: "text-primary" },
    { label: "Push", value: todayLogs.filter((l) => l.channel === "push").length, icon: Smartphone, color: "text-blue-500" },
    { label: "SMS", value: todayLogs.filter((l) => l.channel === "sms").length, icon: MessageSquare, color: "text-green-500" },
    { label: "Auto SMS", value: todayLogs.filter((l) => l.channel === "sms-auto").length, icon: Radio, color: "text-purple-500" },
    { label: "Email", value: todayLogs.filter((l) => l.channel === "email").length, icon: Mail, color: "text-amber-500" },
    { label: "Failed", value: todayLogs.filter((l) => l.status === "failed").length, icon: AlertTriangle, color: "text-destructive" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
      {stats.map((s) => (
        <Card key={s.label} className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <s.icon className={`h-5 w-5 ${s.color}`} />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
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

// ─── Mark Delivered Button ───
function MarkDeliveredButton({ log, onMarked }: { log: any; onMarked: () => void }) {
  const [saving, setSaving] = useState(false);

  if (log.channel !== "sms-auto" || log.status !== "sent") return null;

  const carrier = log.metadata?.carrier;
  const applicationId = log.metadata?.applicationId;
  const agedLeadId = log.metadata?.agedLeadId;

  const handleMark = async () => {
    if (!carrier) return;
    setSaving(true);
    try {
      if (applicationId) {
        await supabase.from("applications").update({ carrier }).eq("id", applicationId);
      }
      toast.success(`Carrier "${carrier}" saved for this lead`);
      onMarked();
    } catch (err: any) {
      toast.error("Failed to save carrier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs text-purple-600 hover:text-purple-700"
      onClick={handleMark}
      disabled={saving || !carrier}
      title={`Mark ${carrier} as confirmed carrier`}
    >
      <CheckCircle className="h-3 w-3 mr-1" />
      Mark {carrier}
    </Button>
  );
}

// ─── Notification Log Table ───
function NotificationLogTable({ logs, search, channelFilter, statusFilter, onRefresh }: {
  logs: any[];
  search: string;
  channelFilter: string;
  statusFilter: string;
  onRefresh: () => void;
}) {
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

  return (
    <div className="rounded-lg border border-border overflow-hidden">
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
            filtered.slice(0, 100).map((log) => (
              <TableRow key={log.id}>
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
                  <MarkDeliveredButton log={log} onMarked={onRefresh} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Carrier Assignment Tool ───
function CarrierAssignmentTool() {
  const queryClient = useQueryClient();
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
      toast.success(`Auto-blast sent to ${sent} leads across all carriers`);
      queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
    } catch (err: any) {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-green-500" />
          Carrier Assignment — {leads?.length || 0} leads missing carrier
        </CardTitle>
      </CardHeader>
      <CardContent>
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
                    This will send an SMS through <strong>all 8 carrier gateways</strong> for each of the <strong>{leads?.length} leads</strong> without a carrier assigned. The message will arrive on whichever carrier matches their phone. Estimated: ~{Math.ceil((leads?.length || 0) * 8 * 0.2 / 60)} minutes.
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
                  <TableRow key={lead.id}>
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
      </CardContent>
    </Card>
  );
}

// ─── Bulk Blast Section ───
function BulkBlastSection() {
  const [blasting, setBlasting] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

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

  const handleBlast = async () => {
    setBlasting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-bulk-notification-blast", {
        method: "POST",
        body: {},
      });
      if (error) throw error;
      setLastResult(data?.stats);
      toast.success("Bulk blast complete!");
    } catch (err: any) {
      toast.error(err.message || "Blast failed");
    } finally {
      setBlasting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          Bulk Blast — Send to All Leads
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-muted">
            <p className="text-2xl font-bold">{counts?.applicants || "—"}</p>
            <p className="text-xs text-muted-foreground">Active Applicants → Licensing Instructions</p>
          </div>
          <div className="p-4 rounded-lg bg-muted">
            <p className="text-2xl font-bold">{counts?.agedLeads || "—"}</p>
            <p className="text-xs text-muted-foreground">Aged Leads → Re-engagement Email</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          This will send emails at 1/second. Leads with a carrier get direct SMS; leads without a carrier get auto-detected across all 8 gateways.
          Estimated time: ~{Math.ceil(((counts?.applicants || 0) + (counts?.agedLeads || 0)) / 60)} minutes.
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="w-full" size="lg" disabled={blasting}>
              {blasting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Blast All Leads
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Bulk Blast</AlertDialogTitle>
              <AlertDialogDescription>
                This will send emails to <strong>{counts?.applicants || 0} applicants</strong> and <strong>{counts?.agedLeads || 0} aged leads</strong>.
                Leads without carriers will get SMS auto-detected across all gateways.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBlast}>Send Now</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {lastResult && (
          <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
            <p>✅ Applicants emailed: <strong>{lastResult.applicants_emailed}</strong></p>
            <p>✅ Aged leads emailed: <strong>{lastResult.aged_emailed}</strong></p>
            <p>📱 SMS sent (known carrier): <strong>{lastResult.sms_sent}</strong></p>
            <p>📡 SMS auto-detected: <strong>{lastResult.sms_auto_detected}</strong></p>
            <p>❌ Failed: <strong>{lastResult.failed}</strong></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───
export default function NotificationHub() {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["notification-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const refreshLogs = () => queryClient.invalidateQueries({ queryKey: ["notification-logs"] });

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

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Notification Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track every push, SMS, auto-SMS, and email sent across the platform
          </p>
        </div>
      </div>

      <NotificationStats logs={logs} />

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">Notification Log</TabsTrigger>
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
            <p className="text-center text-muted-foreground py-8">Loading notifications...</p>
          ) : (
            <NotificationLogTable logs={logs} search={search} channelFilter={channelFilter} statusFilter={statusFilter} onRefresh={refreshLogs} />
          )}
        </TabsContent>

        <TabsContent value="carriers">
          <CarrierAssignmentTool />
        </TabsContent>

        <TabsContent value="blast">
          <BulkBlastSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
