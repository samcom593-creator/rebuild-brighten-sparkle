import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/hooks/use-toast";
import { Instagram, Save, Upload, User } from "lucide-react";

interface AgentProfile {
  id: string;
  display_name: string | null;
  user_id: string | null;
  profile_name: string | null;
  avatar_url: string | null;
  profile_instagram: string | null;
  // from agent_award_profiles
  award_photo_url: string | null;
  award_instagram: string | null;
  award_display_name: string | null;
  award_profile_id: string | null;
}

export default function AwardProfilesPanel() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIG, setEditIG] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  const { data: agents, isLoading } = useQuery({
    queryKey: ["award-agent-profiles"],
    queryFn: async () => {
      // Get all active agents
      const { data: agentData, error } = await supabase
        .from("agents")
        .select("id, display_name, user_id, is_deactivated, profile:profiles!agents_profile_id_fkey(full_name, avatar_url, instagram_handle)")
        .or("is_deactivated.is.null,is_deactivated.eq.false")
        .order("display_name");
      if (error) throw error;

      // Get award profiles
      const agentIds = (agentData || []).map(a => a.id);
      const { data: awardProfiles } = await supabase
        .from("agent_award_profiles")
        .select("*")
        .in("agent_id", agentIds);

      const apMap: Record<string, any> = {};
      for (const ap of awardProfiles || []) {
        apMap[ap.agent_id] = ap;
      }

      return (agentData || []).map((a: any) => {
        const pfk = a.profile as any;
        const ap = apMap[a.id];
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
        } as AgentProfile;
      });
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
      queryClient.invalidateQueries({ queryKey: ["award-agent-profiles"] });
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
      queryClient.invalidateQueries({ queryKey: ["award-agent-profiles"] });
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

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Loading agents...</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <User className="h-5 w-5" />Agent Award Profiles
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {(agents || []).map((agent) => {
            const name = agent.award_display_name || agent.display_name || agent.profile_name || "Unknown";
            const photoUrl = agent.award_photo_url || agent.avatar_url;
            const ig = agent.award_instagram || agent.profile_instagram;
            const isEditMode = editingId === agent.id;

            return (
              <div key={agent.id} className="border rounded-lg p-3 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                <div className="flex items-center gap-2">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={photoUrl || undefined} />
                    <AvatarFallback className="bg-muted text-xs">{name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{name}</p>
                    {ig && <p className="text-xs text-muted-foreground truncate">@{ig}</p>}
                  </div>
                </div>

                {isEditMode ? (
                  <div className="space-y-2">
                    <Input placeholder="Display name override" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} className="h-8 text-xs" />
                    <div className="flex items-center gap-1">
                      <Instagram className="h-3 w-3 text-muted-foreground" />
                      <Input placeholder="@handle" value={editIG} onChange={e => setEditIG(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 text-xs flex-1 gap-1" onClick={() => saveMutation.mutate({ agentId: agent.id, instagram: editIG, displayName: editDisplayName })} disabled={saveMutation.isPending}>
                        <Save className="h-3 w-3" />Save
                      </Button>
                      <label className="cursor-pointer">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                          <span><Upload className="h-3 w-3" />Photo</span>
                        </Button>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) photoMutation.mutate({ agentId: agent.id, file });
                        }} />
                      </label>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>✕</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 text-xs w-full" onClick={() => startEdit(agent)}>
                    Edit Profile
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
