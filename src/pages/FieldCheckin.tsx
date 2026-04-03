import { useState, useEffect, useCallback } from "react";
import { MapPin, User, Phone, Clock, Send, Wifi, WifiOff, CheckCircle, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CheckinEntry {
  client_name: string;
  outcome: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  synced: boolean;
}

const OUTCOMES = [
  { value: "sale", label: "Sale Closed 💰", color: "bg-emerald-500/20 text-emerald-400" },
  { value: "callback", label: "Callback Scheduled 📅", color: "bg-blue-500/20 text-blue-400" },
  { value: "no_answer", label: "No Answer 📵", color: "bg-amber-500/20 text-amber-400" },
  { value: "not_home", label: "Not Home 🏠", color: "bg-slate-500/20 text-slate-400" },
  { value: "presentation", label: "Presentation Given 📊", color: "bg-violet-500/20 text-violet-400" },
  { value: "referral", label: "Referral Obtained 🤝", color: "bg-primary/20 text-primary" },
];

const QUEUE_KEY = "apex_field_checkin_queue";

export default function FieldCheckin() {
  const { user } = useAuth();
  const [clientName, setClientName] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [todayCheckins, setTodayCheckins] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    setQueueCount(queue.length);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("agents").select("id").eq("user_id", user.id).single();
      if (data) {
        setAgentId(data.id);
        // Fetch today's checkins
        const today = new Date().toISOString().split("T")[0];
        const { data: checkins } = await supabase
          .from("field_checkins")
          .select("*")
          .eq("agent_id", data.id)
          .eq("checkin_date", today)
          .order("created_at", { ascending: false });
        setTodayCheckins(checkins || []);
      }
    })();
  }, [user]);

  const getLocation = useCallback(() => {
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setGpsLoading(false);
        toast.success("Location captured!");
      },
      () => {
        setGpsLoading(false);
        toast.error("Could not get location. Please enable GPS.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const syncQueue = useCallback(async () => {
    if (!agentId || !isOnline) return;
    const queue: CheckinEntry[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    if (queue.length === 0) return;

    let synced = 0;
    for (const entry of queue) {
      const { error } = await supabase.from("field_checkins").insert({
        agent_id: agentId,
        client_name: entry.client_name,
        outcome: entry.outcome,
        notes: entry.notes,
        latitude: entry.latitude,
        longitude: entry.longitude,
        synced: true,
      });
      if (!error) synced++;
    }
    if (synced > 0) {
      localStorage.setItem(QUEUE_KEY, "[]");
      setQueueCount(0);
      toast.success(`Synced ${synced} offline check-ins!`);
    }
  }, [agentId, isOnline]);

  useEffect(() => {
    if (isOnline) syncQueue();
  }, [isOnline, syncQueue]);

  const handleSubmit = async () => {
    if (!clientName.trim() || !outcome) {
      toast.error("Client name and outcome are required");
      return;
    }
    setSubmitting(true);

    const entry: CheckinEntry = {
      client_name: clientName.trim(),
      outcome,
      notes: notes.trim(),
      latitude: lat,
      longitude: lng,
      synced: isOnline,
    };

    if (!isOnline || !agentId) {
      // Save to offline queue
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      queue.push(entry);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      setQueueCount(queue.length);
      toast.info("Saved offline — will sync when connected");
    } else {
      const { error } = await supabase.from("field_checkins").insert({
        agent_id: agentId,
        ...entry,
      });
      if (error) {
        toast.error("Failed to submit check-in");
        // Fallback to queue
        const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
        queue.push(entry);
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        setQueueCount(queue.length);
      } else {
        toast.success("Check-in submitted! 🎯");
        setTodayCheckins(prev => [{ ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...prev]);
      }
    }

    setClientName("");
    setOutcome("");
    setNotes("");
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background p-4 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Field Check-In</h1>
          <p className="text-sm text-muted-foreground">Log your field visits</p>
        </div>
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
              <Wifi className="h-3 w-3" /> Online
            </Badge>
          ) : (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}
          {queueCount > 0 && (
            <Badge variant="destructive" className="text-xs">{queueCount} queued</Badge>
          )}
        </div>
      </div>

      {/* GPS Section */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Location</p>
              {lat && lng ? (
                <p className="text-xs text-muted-foreground">{lat.toFixed(4)}, {lng.toFixed(4)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Not captured yet</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={getLocation} disabled={gpsLoading}>
            {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {lat ? "Update" : "Capture"}
          </Button>
        </div>
      </GlassCard>

      {/* Check-in Form */}
      <GlassCard className="p-4 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Client Name
          </label>
          <Input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Enter client's name"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Outcome</label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger>
              <SelectValue placeholder="Select outcome" />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Notes (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any details about the visit..."
            rows={3}
          />
        </div>

        <Button onClick={handleSubmit} disabled={submitting || !clientName.trim() || !outcome} className="w-full font-display font-bold">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
          Submit Check-In
        </Button>
      </GlassCard>

      {/* Today's History */}
      <GlassCard className="p-4 space-y-3">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Today's Visits
          <Badge variant="outline" className="ml-auto">{todayCheckins.length}</Badge>
        </h3>
        {todayCheckins.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No check-ins yet today. Get out there! 🏃</p>
        ) : (
          <div className="space-y-2">
            {todayCheckins.map((c: any) => {
              const outcomeData = OUTCOMES.find(o => o.value === c.outcome);
              return (
                <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-card/50 border border-border">
                  <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.client_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleTimeString()}</p>
                  </div>
                  <Badge className={cn("text-[10px]", outcomeData?.color)}>
                    {outcomeData?.label?.split(" ")[0] || c.outcome}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
