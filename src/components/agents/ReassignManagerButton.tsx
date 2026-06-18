import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * ReassignManagerButton — shared picker for changing the manager assigned
 * to either an applicant (applications.assigned_agent_id) or an existing
 * agent (agents.manager_id).
 *
 * Sam directive 2026-06-17 (verbatim): "Change the manager's things. It
 * needs everything updated and fixed."
 *
 * Pulls every active agent who has at least one direct report as a
 * potential manager. Falls back to active licensed agents if no managers
 * exist yet. Sam can override the manager on any row in one tap.
 */

interface ManagerOption {
  id: string;
  name: string;
}

interface Props {
  /** What we're updating. */
  kind: "agent" | "applicant";
  /** Target row id (agents.id or applications.id). */
  targetId: string;
  /** Current manager_id / assigned_agent_id for visual hint. */
  currentManagerId?: string | null;
  /** Optional compact icon-only variant for tight rows. */
  compact?: boolean;
  onReassigned?: (newManagerId: string | null) => void;
}

const SAM_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d"; // SJAMES01 canonical

export function ReassignManagerButton({
  kind,
  targetId,
  currentManagerId,
  compact,
  onReassigned,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const qc = useQueryClient();

  const { data: managers = [], isLoading } = useQuery<ManagerOption[]>({
    queryKey: ["reassign-manager-options"],
    enabled: open,
    queryFn: async () => {
      // Anyone who manages at least one active agent OR who is the canonical
      // Sam / KJ + any flagged manager_track row.
      const { data: managersWithReports } = await (supabase as any)
        .from("agents")
        .select("manager_id")
        .not("manager_id", "is", null)
        .eq("is_deactivated", false);
      const managerIds = Array.from(
        new Set(((managersWithReports as any[]) ?? []).map((r) => r.manager_id).filter(Boolean)),
      );
      // Always include Sam.
      if (!managerIds.includes(SAM_AGENT_ID)) managerIds.push(SAM_AGENT_ID);
      if (!managerIds.length) return [];
      const { data: agents, error } = await (supabase as any)
        .from("agents")
        .select("id, display_name, agent_code")
        .in("id", managerIds)
        .eq("is_deactivated", false);
      if (error) {
        toast.error(`Manager list failed: ${error.message?.slice(0, 80)}`);
        return [];
      }
      return ((agents as any[]) ?? [])
        .map((a) => ({ id: a.id, name: a.display_name?.trim() || a.agent_code || "—" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 30_000,
  });

  const filtered = managers.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
  const currentName = managers.find((m) => m.id === currentManagerId)?.name;

  async function assign(newManagerId: string | null) {
    setBusy(true);
    try {
      if (kind === "agent") {
        const { error } = await (supabase as any)
          .from("agents")
          .update({ manager_id: newManagerId, updated_at: new Date().toISOString() })
          .eq("id", targetId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("applications")
          .update({ assigned_agent_id: newManagerId, updated_at: new Date().toISOString() })
          .eq("id", targetId);
        if (error) throw error;
      }
      const targetName = managers.find((m) => m.id === newManagerId)?.name ?? "—";
      toast.success(newManagerId ? `Reassigned to ${targetName}` : "Unassigned");
      onReassigned?.(newManagerId);
      setOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["applications"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-applicants"] }),
        qc.invalidateQueries({ queryKey: ["agents"] }),
        qc.invalidateQueries({ queryKey: ["agent-profile-drawer", targetId] }),
      ]);
    } catch (e: any) {
      toast.error(`Reassign failed: ${e?.message?.slice(0, 120) ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={busy}
            title={currentName ? `Manager: ${currentName} · tap to change` : "Assign a manager"}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 max-w-[160px]"
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate text-xs">{currentName ?? "Assign manager"}</span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="p-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter managers…"
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">No managers</div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                disabled={busy}
                onClick={() => assign(m.id)}
                className={cn(
                  "w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-center justify-between gap-2 text-sm",
                  m.id === currentManagerId && "bg-muted/40 font-medium",
                )}
              >
                <span className="truncate">{m.name}</span>
                {m.id === currentManagerId && <Check className="h-3.5 w-3.5 text-emerald-500" />}
              </button>
            ))
          )}
          {currentManagerId && (
            <button
              disabled={busy}
              onClick={() => assign(null)}
              className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors text-xs text-rose-500 border-t border-border"
            >
              Unassign
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ReassignManagerButton;
