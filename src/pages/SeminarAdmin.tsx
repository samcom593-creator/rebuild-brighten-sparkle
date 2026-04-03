import { useState, useEffect, useMemo } from "react";
import { format, differenceInSeconds, differenceInDays } from "date-fns";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import {
  Users, Mail, Phone, Search, CheckCircle, XCircle, Plus, Send, Clock,
  CalendarDays, BarChart3, Timer, Zap, TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Registration {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  license_status: string;
  source: string;
  registered_at: string;
  attended: boolean;
}

// Next Thursday at 7PM CST
function getNextSeminarDate(): Date {
  const now = new Date();
  const cst = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const day = cst.getDay();
  const daysUntilThursday = ((4 - day) + 7) % 7 || 7;
  const next = new Date(cst);
  next.setDate(next.getDate() + daysUntilThursday);
  next.setHours(19, 0, 0, 0);
  return next;
}

function CountdownTimer() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = getNextSeminarDate();
  const diff = differenceInSeconds(target, now);
  if (diff <= 0) return <span className="text-primary font-bold">LIVE NOW</span>;

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;

  return (
    <div className="flex items-center gap-2">
      {[
        { v: days, l: "D" },
        { v: hours, l: "H" },
        { v: mins, l: "M" },
        { v: secs, l: "S" },
      ].map(({ v, l }) => (
        <div key={l} className="flex flex-col items-center">
          <span className="text-2xl font-bold font-['Syne'] tabular-nums text-primary">{String(v).padStart(2, "0")}</span>
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{l}</span>
        </div>
      ))}
    </div>
  );
}

export default function SeminarAdmin() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [blasting, setBlasting] = useState(false);
  const [tab, setTab] = useState("registrants");
  const { playSound } = useSoundEffects();

  const fetchRegistrations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("seminar_registrations")
      .select("*")
      .order("registered_at", { ascending: false }) as any;
    setRegistrations(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRegistrations(); }, []);

  const toggleAttended = async (reg: Registration) => {
    await supabase.from("seminar_registrations")
      .update({ attended: !reg.attended } as any)
      .eq("id", reg.id);
    setRegistrations(prev =>
      prev.map(r => r.id === reg.id ? { ...r, attended: !r.attended } : r)
    );
    playSound(reg.attended ? "click" : "success");
  };

  const handleManualAdd = async () => {
    if (!newFirst || !newLast || !newEmail) return;
    const { error } = await supabase.from("seminar_registrations").insert({
      first_name: newFirst.trim(),
      last_name: newLast.trim(),
      email: newEmail.trim().toLowerCase(),
      phone: newPhone.trim() || null,
      source: "manual_add",
    } as any);
    if (error) { toast.error("Failed to add"); playSound("error"); return; }
    toast.success("Registrant added!"); playSound("success");
    setNewFirst(""); setNewLast(""); setNewEmail(""); setNewPhone("");
    setShowAdd(false);
    fetchRegistrations();
  };

  const handleInviteBlast = async () => {
    setBlasting(true);
    try {
      const { error } = await supabase.functions.invoke("send-seminar-invite-blast");
      if (error) throw error;
      toast.success("Seminar invite blast sent!");
      playSound("celebrate");
    } catch {
      toast.error("Blast failed");
    } finally {
      setBlasting(false);
    }
  };

  const filtered = registrations.filter(r => {
    const q = search.toLowerCase();
    return `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q);
  });

  const totalRegs = registrations.length;
  const attendedCount = registrations.filter(r => r.attended).length;
  const showRate = totalRegs > 0 ? Math.round((attendedCount / totalRegs) * 100) : 0;

  // Analytics
  const sourceBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    registrations.forEach(r => { map[r.source] = (map[r.source] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [registrations]);

  const weeklyTrend = useMemo(() => {
    const weeks: Record<string, number> = {};
    registrations.forEach(r => {
      const d = new Date(r.registered_at);
      const weekKey = format(d, "MMM d");
      weeks[weekKey] = (weeks[weekKey] || 0) + 1;
    });
    return Object.entries(weeks).slice(-8);
  }, [registrations]);

  return (
    <>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header with Countdown */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-['Syne']">Seminar Dashboard</h1>
            <p className="text-muted-foreground text-sm">Weekly Thursday Seminar — 7 PM CST</p>
          </div>
          <div className="flex items-center gap-3">
            <GlassCard className="px-4 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Next Seminar</p>
              <CountdownTimer />
            </GlassCard>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4 text-center">
            <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-2xl font-bold text-primary">{totalRegs}</p>
            <p className="text-xs text-muted-foreground">Registered</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <CheckCircle className="h-5 w-5 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold text-emerald-400">{attendedCount}</p>
            <p className="text-xs text-muted-foreground">Attended</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto mb-1 text-amber-400" />
            <p className="text-2xl font-bold text-amber-400">{showRate}%</p>
            <p className="text-xs text-muted-foreground">Show Rate</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <CalendarDays className="h-5 w-5 mx-auto mb-1 text-violet-400" />
            <p className="text-2xl font-bold text-violet-400">{format(getNextSeminarDate(), "MMM d")}</p>
            <p className="text-xs text-muted-foreground">Next Date</p>
          </GlassCard>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Registrant
          </Button>
          <Button size="sm" variant="outline" onClick={handleInviteBlast} disabled={blasting}>
            <Send className="h-4 w-4 mr-1" /> {blasting ? "Sending..." : "Send Invite Blast"}
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="registrants" className="gap-1"><Users className="h-4 w-4" /> Registrants</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="registrants" className="mt-4 space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search registrants..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>

            {/* List */}
            <div className="space-y-2">
              {filtered.map(reg => (
                <div key={reg.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors">
                  <button onClick={() => toggleAttended(reg)}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all flex-shrink-0",
                      reg.attended
                        ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400 scale-110"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}>
                    {reg.attended ? <CheckCircle className="h-4 w-4" /> : null}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{reg.first_name} {reg.last_name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" /> {reg.email}</span>
                      {reg.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {reg.phone}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {reg.source === "manual_add" ? "Manual" : "Landing"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(reg.registered_at), "MMM d")}</span>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && !loading && (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No registrants found</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="mt-4 space-y-4">
            {/* Source Breakdown */}
            <GlassCard className="p-4">
              <h3 className="font-semibold text-sm mb-3">Registration Source</h3>
              <div className="space-y-2">
                {sourceBreakdown.map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground capitalize">{source.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(count / totalRegs) * 100}%` }} />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Weekly Trend */}
            <GlassCard className="p-4">
              <h3 className="font-semibold text-sm mb-3">Registration Trend</h3>
              <div className="flex items-end gap-1 h-24">
                {weeklyTrend.map(([week, count]) => {
                  const max = Math.max(...weeklyTrend.map(w => w[1] as number));
                  const height = max > 0 ? ((count as number) / max) * 100 : 0;
                  return (
                    <div key={week} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-muted-foreground">{count}</span>
                      <div className="w-full bg-primary/20 rounded-t" style={{ height: `${height}%`, minHeight: 4 }}>
                        <div className="w-full h-full bg-primary rounded-t" />
                      </div>
                      <span className="text-[8px] text-muted-foreground">{week}</span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Conversion funnel */}
            <GlassCard className="p-4">
              <h3 className="font-semibold text-sm mb-3">Conversion Funnel</h3>
              <div className="space-y-2">
                {[
                  { label: "Registered", count: totalRegs, pct: 100 },
                  { label: "Attended", count: attendedCount, pct: showRate },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-24">{row.label}</span>
                    <div className="flex-1 h-6 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary/30 rounded flex items-center pl-2" style={{ width: `${row.pct}%` }}>
                        <span className="text-xs font-medium">{row.count} ({row.pct}%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>

      {/* Manual Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Registrant</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Input value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="First Name" />
              <Input value={newLast} onChange={e => setNewLast(e.target.value)} placeholder="Last Name" />
            </div>
            <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" />
            <Input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone (optional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleManualAdd} disabled={!newFirst || !newLast || !newEmail}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
