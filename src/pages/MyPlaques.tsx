import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Award, Download, Share2, ExternalLink, Trophy, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Plaque {
  id: string;
  milestone_type: string;
  milestone_date: string | null;
  amount: number;
  image_png_url: string | null;
  share_slug: string | null;
  color_hex: string | null;
  badge_label: string | null;
  created_at: string;
}

export default function MyPlaques() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  const { data: plaques = [], isLoading } = useQuery({
    queryKey: ["my-plaques", agentId],
    queryFn: async (): Promise<Plaque[]> => {
      if (!agentId) return [];
      const { data } = await supabase
        .from("plaque_awards" as any)
        .select("*")
        .eq("agent_id", agentId)
        .order("milestone_date", { ascending: false })
        .order("created_at", { ascending: false });
      return ((data as any) ?? []) as Plaque[];
    },
    enabled: !!agentId,
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

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30">
          <Trophy className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">My Plaques</h1>
          <p className="text-sm text-muted-foreground">
            Every achievement you've earned — download, share, celebrate.
          </p>
        </div>
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
              <p className="text-xs text-muted-foreground uppercase mb-1">Total Earned</p>
              <p className="text-2xl font-bold">
                ${Math.round(totalEarnings).toLocaleString()}
              </p>
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
            <Lock className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-lg font-semibold">No plaques yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Hit your first milestone and a plaque will appear here. Single-day production of
              $1,000+ earns a Bronze. $3,000+ = Gold. $5,000+ = Platinum.
            </p>
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
