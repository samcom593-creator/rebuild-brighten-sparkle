import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Award, Download, Share2, ExternalLink, Trophy, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Plaque {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string | null;
  amount: number;
  image_png_url: string | null;
  share_slug: string | null;
  color_hex: string | null;
  badge_label: string | null;
  created_at: string;
  agents?: {
    display_name: string | null;
    profiles?: { full_name: string | null; avatar_url: string | null } | null;
  } | null;
}

function CreatePlaqueDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [milestoneType, setMilestoneType] = useState("single_day");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [sending, setSending] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-for-plaque"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id, display_name, profile:profiles!agents_profile_id_fkey(full_name)")
        .eq("is_deactivated", false)
        .order("display_name", { ascending: true });
      return (data || []).map((a: any) => ({
        id: a.id,
        name: (a.profile as any)?.full_name || a.display_name || "Unnamed",
      }));
    },
    enabled: open,
  });

  const handleCreate = async () => {
    if (!selectedAgentId || !amount) {
      toast.error("Pick an agent and amount");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-plaque-recognition", {
        body: {
          agentId: selectedAgentId,
          milestoneType,
          amount: Number(amount),
          date,
        },
      });
      if (error) throw error;
      toast.success("Plaque created and sent");
      setOpen(false);
      setSelectedAgentId("");
      setAmount("");
      onCreated();
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "unknown"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-1" /> Create Plaque
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send New Plaque</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Agent</Label>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick agent..." />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Milestone Type</Label>
            <Select value={milestoneType} onValueChange={setMilestoneType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single_day_bronze">Bronze ($1,000+)</SelectItem>
                <SelectItem value="single_day">Gold ($3,000+)</SelectItem>
                <SelectItem value="single_day_platinum">Platinum ($5,000+)</SelectItem>
                <SelectItem value="weekly">Weekly Diamond ($10,000+)</SelectItem>
                <SelectItem value="monthly">Elite Producer ($25,000+)</SelectItem>
                <SelectItem value="comeback_champion">Comeback Champion</SelectItem>
                <SelectItem value="hot_streak">Hot Streak</SelectItem>
                <SelectItem value="on_fire">On Fire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount ($)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
            />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={sending}>
            {sending ? "Creating..." : "Create & Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MyPlaques() {
  const { user, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const canManage = isAdmin || isManager;

  const { data: agentId } = useQuery({
    queryKey: ["my-agent-id-plaques", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!user?.id,
  });

  const { data: plaques = [], isLoading, refetch } = useQuery({
    queryKey: ["plaques", canManage ? "all" : agentId],
    queryFn: async (): Promise<Plaque[]> => {
      let query = supabase
        .from("plaque_awards" as any)
        .select("*, agents(display_name, profiles!agents_profile_id_fkey(full_name, avatar_url))");
      if (!canManage && agentId) {
        query = query.eq("agent_id", agentId);
      }
      const { data } = await query
        .order("milestone_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      return ((data as any) ?? []) as Plaque[];
    },
    enabled: !!agentId || canManage,
  });

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of plaques) {
      map.set(p.milestone_type, (map.get(p.milestone_type) || 0) + 1);
    }
    return map;
  }, [plaques]);

  const totalEarnings = plaques.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const downloadOne = async (p: Plaque) => {
    if (!p.image_png_url) {
      toast.error("Image not ready");
      return;
    }
    try {
      const res = await fetch(p.image_png_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apex-${p.milestone_type}-${p.milestone_date || "plaque"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch {
      toast.error("Download failed");
    }
  };

  const shareOne = (p: Plaque) => {
    if (!p.share_slug) {
      toast.error("Share link not available");
      return;
    }
    const url = `${window.location.origin}/plaque/${p.share_slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  const agentNameOf = (p: Plaque) =>
    p.agents?.profiles?.full_name || p.agents?.display_name || "Agent";

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30">
            <Trophy className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{canManage ? "All Plaques" : "My Plaques"}</h1>
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "Every plaque sent across the agency. Create new ones below."
                : "Every achievement you've earned — download, share, celebrate."}
            </p>
          </div>
        </div>
        {canManage && <CreatePlaqueDialog onCreated={refetch} />}
      </div>

      {plaques.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase mb-1">Total Plaques</p>
              <p className="text-2xl font-bold">{plaques.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase mb-1">Total {canManage ? "Awarded" : "Earned"}</p>
              <p className="text-2xl font-bold">${Math.round(totalEarnings).toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase mb-1">Unique Types</p>
              <p className="text-2xl font-bold">{byType.size}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase mb-1">Latest</p>
              <p className="text-2xl font-bold">
                {plaques[0]?.milestone_date
                  ? format(new Date(plaques[0].milestone_date), "MMM d")
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : plaques.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            {canManage ? (
              <>
                <Trophy className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
                <h3 className="text-lg font-semibold">No plaques sent yet</h3>
                <p className="text-sm text-muted-foreground">
                  Click "Create Plaque" above to send the team's first one.
                </p>
              </>
            ) : (
              <>
                <Lock className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
                <h3 className="text-lg font-semibold">No plaques yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Hit your first milestone and a plaque will appear here. Single-day production of
                  $1,000+ earns a Bronze. $3,000+ = Gold. $5,000+ = Platinum.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plaques.map((p) => (
            <Card key={p.id} className="overflow-hidden group">
              {p.image_png_url ? (
                <div
                  className="aspect-[4/5] bg-[#0a0a0a] cursor-pointer hover:opacity-90 transition"
                  onClick={() => p.share_slug && navigate(`/plaque/${p.share_slug}`)}
                >
                  <img
                    src={p.image_png_url}
                    alt={`${p.badge_label} plaque`}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="aspect-[4/5] bg-muted/30 flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Rendering...</p>
                </div>
              )}

              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {canManage && (
                      <p className="text-xs font-semibold text-foreground truncate mb-1">
                        {agentNameOf(p)}
                      </p>
                    )}
                    <Badge
                      variant="outline"
                      className="text-[10px] mb-1"
                      style={
                        p.color_hex
                          ? { color: p.color_hex, borderColor: p.color_hex + "40" }
                          : {}
                      }
                    >
                      {p.badge_label || p.milestone_type}
                    </Badge>
                    <p className="font-bold">${Math.round(p.amount).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.milestone_date
                        ? format(new Date(p.milestone_date), "MMM d, yyyy")
                        : "—"}
                    </p>
                  </div>
                  <Award
                    className="h-4 w-4 shrink-0"
                    style={p.color_hex ? { color: p.color_hex } : {}}
                  />
                </div>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => downloadOne(p)}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> PNG
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => shareOne(p)}
                  >
                    <Share2 className="h-3.5 w-3.5 mr-1" /> Share
                  </Button>
                  {p.share_slug && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/plaque/${p.share_slug}`)}
                      title="Open full view"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
