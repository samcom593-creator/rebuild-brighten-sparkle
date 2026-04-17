import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserCog, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  applicationId: string;
}

interface DelegateOption {
  user_id: string;
  full_name: string;
  email: string;
}

export function LicensingDelegateSection({ applicationId }: Props) {
  const qc = useQueryClient();
  const [selectedDelegate, setSelectedDelegate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);

  // Available delegates (admins + managers)
  const { data: candidates = [] } = useQuery({
    queryKey: ["delegate-candidates"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "manager"] as any);
      const userIds = [...new Set((roles || []).map((r: any) => r.user_id))];
      if (!userIds.length) return [] as DelegateOption[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      return (profiles || []).map((p: any) => ({
        user_id: p.user_id,
        full_name: p.full_name || p.email,
        email: p.email,
      })) as DelegateOption[];
    },
  });

  // Existing delegates for this application
  const { data: delegates = [], isLoading } = useQuery({
    queryKey: ["licensing-delegates", applicationId],
    enabled: !!applicationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("licensing_delegates")
        .select("*")
        .eq("application_id", applicationId)
        .eq("is_active", true)
        .order("assigned_at", { ascending: false });
      return data || [];
    },
  });

  const handleAdd = async () => {
    if (!selectedDelegate) return;
    setAdding(true);
    const cand = candidates.find((c) => c.user_id === selectedDelegate);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("licensing_delegates").insert({
      application_id: applicationId,
      delegate_user_id: selectedDelegate,
      delegate_name: cand?.full_name || null,
      notes: notes.trim() || null,
      assigned_by: user?.id,
    });
    setAdding(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Delegate assigned");
      setSelectedDelegate("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["licensing-delegates", applicationId] });
    }
  };

  const handleRemove = async (id: string) => {
    const { error } = await supabase
      .from("licensing_delegates")
      .update({ is_active: false })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Delegate removed");
      qc.invalidateQueries({ queryKey: ["licensing-delegates", applicationId] });
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
      <Label className="flex items-center gap-2">
        <UserCog className="h-4 w-4 text-primary" />
        Licensing Delegates
      </Label>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : delegates.length > 0 ? (
        <div className="space-y-1.5">
          {delegates.map((d: any) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-2 p-2 rounded-md bg-background border border-border text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{d.delegate_name || "Delegate"}</div>
                {d.notes && (
                  <div className="text-xs text-muted-foreground truncate">{d.notes}</div>
                )}
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">Active</Badge>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemove(d.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No delegates assigned</p>
      )}

      <div className="space-y-2">
        <Select value={selectedDelegate} onValueChange={setSelectedDelegate}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Select admin/manager…" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.user_id} value={c.user_id}>
                {c.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!selectedDelegate || adding}
          className="w-full"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
          Assign Delegate
        </Button>
      </div>
    </div>
  );
}
