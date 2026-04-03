import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Instagram, Save, Camera, User, ChevronDown, Search,
  CheckCircle2, AlertCircle, X, TrendingUp, Hash, Crown,
  Shield, Sparkles, ImagePlus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface AgentProfile {
  id: string;
  display_name: string | null;
  user_id: string | null;
  profile_name: string | null;
  avatar_url: string | null;
  profile_instagram: string | null;
  award_photo_url: string | null;
  award_instagram: string | null;
  award_display_name: string | null;
  award_profile_id: string | null;
  total_alp: number;
  total_deals: number;
  updated_at: string | null;
}

function getRankIcon(index: number) {
  if (index === 0) return <Crown className="h-3.5 w-3.5 text-amber-400" />;
  if (index === 1) return <Shield className="h-3.5 w-3.5 text-slate-400" />;
  if (index === 2) return <Sparkles className="h-3.5 w-3.5 text-amber-600" />;
  return null;
}

function getRankBorder(index: number) {
  if (index === 0) return "ring-amber-400/80 shadow-amber-400/20 shadow-lg";
  if (index === 1) return "ring-slate-300/60";
  if (index === 2) return "ring-amber-600/50";
  return "ring-border/40";
}

export default function AwardProfilesPanel() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIG, setEditIG] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: agents, isLoading } = useQuery({
    queryKey: ["award-agent-profiles-elite"],
    queryFn: async () => {
      const { data: prodData } = await supabase
        .from("daily_production")
        .select("agent_id, deals_closed, aop");

      const prodMap: Record<string, { alp: number; deals: number }> = {};
      for (const row of prodData || []) {
        if (!prodMap[row.agent_id]) prodMap[row.agent_id] = { alp: 0, deals: 0 };
        prodMap[row.agent_id].alp += Number(row.aop) || 0;
        prodMap[row.agent_id].deals += Number(row.deals_closed) || 0;
      }

      const producingIds = Object.entries(prodMap)
        .filter(([, v]) => v.deals > 0)
        .map(([id]) => id);

      if (producingIds.length === 0) return [];

      const { data: agentData, error } = await supabase
        .from("agents")
        .select("id, display_name, user_id, is_deactivated, profile:profiles!agents_profile_id_fkey(full_name, avatar_url, instagram_handle)")
        .in("id", producingIds)
        .or("is_deactivated.is.null,is_deactivated.eq.false");
      if (error) throw error;

      const agentIds = (agentData || []).map(a => a.id);
      const { data: awardProfiles } = await supabase
        .from("agent_award_profiles")
        .select("*")
        .in("agent_id", agentIds);

      const apMap: Record<string, any> = {};
      for (const ap of awardProfiles || []) apMap[ap.agent_id] = ap;

      return (agentData || []).map((a: any) => {
        const pfk = a.profile as any;
        const ap = apMap[a.id];
        const prod = prodMap[a.id] || { alp: 0, deals: 0 };
        return {
          id: a.id,
          display_name: a.display_name,
          user_id: a.user_id,
          profile_name: pfk?.full_name || null,
          avatar_url: pfk?.avatar_url || null,
          profile_instagram: pfk?.instagram_handle || null,
          award_photo_url: ap?.photo_url || null,
          award_instagram: ap?.instagram_handle || null,
          award_display_name: ap?.display_name_override || null,
          award_profile_id: ap?.id || null,
          total_alp: prod.alp,
          total_deals: prod.deals,
          updated_at: ap?.updated_at || null,
        } as AgentProfile;
      }).sort((a, b) => b.total_alp - a.total_alp);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ agentId, instagram, displayName }: { agentId: string; instagram: string; displayName: string }) => {
      const existing = agents?.find(a => a.id === agentId);
      if (existing?.award_profile_id) {
        const { error } = await supabase
          .from("agent_award_profiles")
          .update({ instagram_handle: instagram || null, display_name_override: displayName || null, updated_at: new Date().toISOString() })
          .eq("id", existing.award_profile_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("agent_award_profiles")
          .insert({ agent_id: agentId, instagram_handle: instagram || null, display_name_override: displayName || null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["award-agent-profiles-elite"] });
      setEditingId(null);
      toast({ title: "Profile Saved ✅" });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const photoMutation = useMutation({
    mutationFn: async ({ agentId, file }: { agentId: string; file: File }) => {
      const path = `award-photos/${agentId}.${file.name.split(".").pop()}`;
      const { error: uploadError } = await supabase.storage.from("award-graphics").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const url = supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;

      const existing = agents?.find(a => a.id === agentId);
      if (existing?.award_profile_id) {
        const { error } = await supabase.from("agent_award_profiles").update({ photo_url: url, updated_at: new Date().toISOString() }).eq("id", existing.award_profile_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agent_award_profiles").insert({ agent_id: agentId, photo_url: url });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["award-agent-profiles-elite"] });
      toast({ title: "Photo Updated 📸" });
    },
    onError: (err: Error) => {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    },
  });

  function startEdit(agent: AgentProfile) {
    setEditingId(agent.id);
    setEditIG(agent.award_instagram || agent.profile_instagram || "");
    setEditDisplayName(agent.award_display_name || "");
  }

  const filtered = useMemo(() => {
    return (agents || []).filter(a => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const name = (a.award_display_name || a.display_name || a.profile_name || "").toLowerCase();
      return name.includes(q);
    });
  }, [agents, searchQuery]);

  const profileComplete = (a: AgentProfile) => !!a.award_photo_url && !!(a.award_instagram || a.profile_instagram);

  const stats = useMemo(() => {
    if (!agents) return { total: 0, complete: 0, totalAlp: 0, totalDeals: 0 };
    const complete = agents.filter(profileComplete).length;
    const totalAlp = agents.reduce((s, a) => s + a.total_alp, 0);
    const totalDeals = agents.reduce((s, a) => s + a.total_deals, 0);
    return { total: agents.length, complete, totalAlp, totalDeals };
  }, [agents]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/30 bg-card/40 backdrop-blur-md p-10">
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading producers...
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-card/90 via-card/70 to-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-6 py-5 hover:bg-accent/5 transition-colors group">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/25 to-orange-600/25 flex items-center justify-center ring-1 ring-amber-500/20">
                <Crown className="h-5 w-5 text-amber-500" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold tracking-tight">Award Profiles</h3>
                <p className="text-xs text-muted-foreground">Photos & handles for Instagram graphics</p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-0 font-semibold">
                  {stats.total} producers
                </Badge>
                <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 border-0">
                  {stats.complete}/{stats.total} ready
                </Badge>
              </div>
            </div>
            <ChevronDown className={cn(
              "h-5 w-5 text-muted-foreground transition-transform duration-300",
              isOpen && "rotate-180"
            )} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {/* Stats Bar */}
          <div className="px-6 pb-4 grid grid-cols-4 gap-3">
            {[
              { label: "Producers", value: stats.total, icon: User, color: "text-primary" },
              { label: "Profiles Ready", value: stats.complete, icon: CheckCircle2, color: "text-emerald-500" },
              { label: "Total ALP", value: `$${Math.round(stats.totalAlp).toLocaleString()}`, icon: TrendingUp, color: "text-amber-500" },
              { label: "Total Deals", value: stats.totalDeals, icon: Hash, color: "text-blue-500" },
            ].map((s, i) => (
              <div key={i} className="rounded-lg bg-background/40 border border-border/30 px-3 py-2.5 flex items-center gap-2.5">
                <s.icon className={cn("h-4 w-4", s.color)} />
                <div>
                  <p className="text-sm font-bold">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground leading-none">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="px-6 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search producers..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 h-10 bg-background/40 border-border/30 text-sm rounded-lg"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence mode="popLayout">
              {filtered.map((agent, index) => {
                const name = agent.award_display_name || agent.display_name || agent.profile_name || "Unknown";
                const photoUrl = agent.award_photo_url || agent.avatar_url;
                const ig = agent.award_instagram || agent.profile_instagram;
                const isEditMode = editingId === agent.id;
                const complete = profileComplete(agent);
                const rankIcon = getRankIcon(index);

                return (
                  <motion.div
                    key={agent.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.25, delay: index * 0.03 }}
                    className={cn(
                      "relative rounded-xl border p-4 transition-all duration-300",
                      "bg-gradient-to-b from-card/95 to-card/70 backdrop-blur-sm",
                      "hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-0.5",
                      isEditMode
                        ? "ring-2 ring-primary/40 shadow-xl shadow-primary/10 border-primary/30"
                        : "hover:border-primary/20",
                      index === 0 && "border-amber-400/30 bg-gradient-to-b from-amber-500/5 to-card/70"
                    )}
                  >
                    {/* Rank badge for top 3 */}
                    {rankIcon && (
                      <div className="absolute -top-2 -left-2 h-7 w-7 rounded-full bg-background border border-border/50 flex items-center justify-center shadow-md z-10">
                        {rankIcon}
                      </div>
                    )}

                    {/* Status dot */}
                    <div className={cn(
                      "absolute top-3 right-3 h-2.5 w-2.5 rounded-full transition-all",
                      complete
                        ? "bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse"
                        : "bg-amber-500 shadow-sm shadow-amber-500/50"
                    )} />

                    {/* Avatar + Info */}
                    <div className="flex items-start gap-3.5 mb-3">
                      <div
                        className="relative group cursor-pointer shrink-0"
                        onClick={() => {
                          const ref = fileInputRefs.current[agent.id];
                          if (ref) ref.click();
                        }}
                      >
                        <Avatar className={cn(
                          "h-16 w-16 ring-2 transition-all duration-300",
                          agent.award_photo_url ? getRankBorder(index) : "ring-border/40"
                        )}>
                          <AvatarImage src={photoUrl || undefined} className="object-cover" />
                          <AvatarFallback className="bg-gradient-to-br from-muted to-muted/60 text-base font-bold">
                            {name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 scale-90 group-hover:scale-100">
                          <Camera className="h-5 w-5 text-white" />
                        </div>
                        {!agent.award_photo_url && (
                          <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center shadow-sm">
                            <ImagePlus className="h-2.5 w-2.5 text-white" />
                          </div>
                        )}
                        <input
                          ref={el => { fileInputRefs.current[agent.id] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) photoMutation.mutate({ agentId: agent.id, file });
                          }}
                        />
                      </div>

                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm font-bold truncate leading-tight">{name}</p>
                        {ig ? (
                          <Badge variant="outline" className="mt-1.5 text-[10px] px-1.5 py-0 h-5 gap-0.5 border-pink-500/30 text-pink-500 bg-pink-500/5">
                            <Instagram className="h-2.5 w-2.5" />@{ig}
                          </Badge>
                        ) : (
                          <p className="mt-1.5 text-[10px] text-muted-foreground/60 italic">No IG handle</p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            <TrendingUp className="h-3 w-3" />${agent.total_alp.toLocaleString()}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Hash className="h-3 w-3" />{agent.total_deals}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="mb-3">
                      {complete ? (
                        <Badge className="text-[10px] h-5 bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15 gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />Ready for Awards
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] h-5 bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15 gap-1">
                          <AlertCircle className="h-2.5 w-2.5" />
                          Needs {!agent.award_photo_url && !ig ? "Photo & IG" : !agent.award_photo_url ? "Photo" : "IG"}
                        </Badge>
                      )}
                    </div>

                    {/* Edit mode */}
                    <AnimatePresence mode="wait">
                      {isEditMode ? (
                        <motion.div
                          key="edit"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-2.5 overflow-hidden"
                        >
                          <Input
                            placeholder="Display name override"
                            value={editDisplayName}
                            onChange={e => setEditDisplayName(e.target.value)}
                            className="h-9 text-xs bg-background/60 border-border/40"
                          />
                          <div className="flex items-center gap-2">
                            <Instagram className="h-4 w-4 text-pink-500 shrink-0" />
                            <Input
                              placeholder="@handle"
                              value={editIG}
                              onChange={e => setEditIG(e.target.value)}
                              className="h-9 text-xs bg-background/60 border-border/40"
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              className="h-8 text-xs flex-1 gap-1.5 bg-primary hover:bg-primary/90"
                              onClick={() => saveMutation.mutate({ agentId: agent.id, instagram: editIG, displayName: editDisplayName })}
                              disabled={saveMutation.isPending}
                            >
                              <Save className="h-3.5 w-3.5" />Save
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs px-3" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs w-full hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all"
                            onClick={() => startEdit(agent)}
                          >
                            Edit Profile
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Updated timestamp */}
                    {agent.updated_at && (
                      <p className="text-[9px] text-muted-foreground/50 mt-2.5 text-center">
                        Updated {new Date(agent.updated_at).toLocaleDateString()}
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {filtered.length === 0 && (
            <div className="px-6 pb-6 text-center text-sm text-muted-foreground py-8">
              {searchQuery ? "No agents match your search" : "No agents with production found"}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
