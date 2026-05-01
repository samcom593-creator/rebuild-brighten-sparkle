import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Shield, ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Edit this list to expose more boards. Each entry is what shows in the
// admin grid; the key matches what useBoardAccess(key) checks.
const BOARDS = [
  { key: "admin_team_overview",     label: "Team Overview Dashboard",  desc: "Full team production stats + manager breakdown" },
  { key: "admin_inactive_agents",   label: "Inactive Agents",          desc: "Roster of deactivated agents + reactivate" },
  { key: "admin_recruit_command",   label: "Recruit Command Center",   desc: "Cross-team applicant routing + hot leads" },
  { key: "admin_xcel_pipeline",     label: "XCEL Pipeline",            desc: "Pre-licensing course progress + bumps" },
  { key: "admin_finances",          label: "Finances · Commissions",   desc: "Override reports + commission roll-ups" },
  { key: "admin_automation_hub",    label: "Automation Hub",           desc: "Cron health + alert dispatcher" },
] as const;

export default function AdminBoardAccess() {
  usePageTitle("Manager Board Access · Admin");
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const { data: managers = [], isLoading } = useQuery({
    queryKey: ["admin-managers-list"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url")
        .in("user_id", ids)
        .order("full_name");
      return profs ?? [];
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const { data: grants = [] } = useQuery({
    queryKey: ["board-grants-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("manager_board_grants")
        .select("manager_user_id, board_key");
      return data ?? [];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const isGranted = (managerId: string, boardKey: string) =>
    grants.some((g: any) => g.manager_user_id === managerId && g.board_key === boardKey);

  async function toggleGrant(managerId: string, boardKey: string, currentlyGranted: boolean) {
    const cellKey = `${managerId}:${boardKey}`;
    setSavingKey(cellKey);
    try {
      if (currentlyGranted) {
        const { error } = await supabase
          .from("manager_board_grants")
          .delete()
          .eq("manager_user_id", managerId)
          .eq("board_key", boardKey);
        if (error) throw error;
        toast.success("Access revoked");
      } else {
        const { error } = await supabase
          .from("manager_board_grants")
          .insert({ manager_user_id: managerId, board_key: boardKey });
        if (error) throw error;
        toast.success("Access granted");
      }
      qc.invalidateQueries({ queryKey: ["board-grants-all"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update access");
    } finally {
      setSavingKey(null);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
        <ChevronLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-3xl font-bold">Manager Board Access</h1>
      </div>
      <p className="text-muted-foreground mb-8 max-w-2xl">
        Grant individual managers access to admin-only boards. Toggle on
        per row + board. Hierarchies — give your top managers access to
        more views without making them full admins.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : managers.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No managers yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold sticky left-0 bg-muted/30 min-w-[180px]">Manager</th>
                {BOARDS.map(b => (
                  <th key={b.key} className="text-left px-3 py-3 font-semibold whitespace-nowrap">
                    <div>{b.label}</div>
                    <div className="text-xs font-normal text-muted-foreground">{b.desc}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {managers.map((m: any) => (
                <tr key={m.user_id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-4 py-3 sticky left-0 bg-background">
                    <div className="font-medium">{m.full_name ?? m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  {BOARDS.map(b => {
                    const granted = isGranted(m.user_id, b.key);
                    const cellKey = `${m.user_id}:${b.key}`;
                    return (
                      <td key={b.key} className="px-3 py-3">
                        <Switch
                          checked={granted}
                          disabled={savingKey === cellKey}
                          onCheckedChange={() => toggleGrant(m.user_id, b.key, granted)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        Pages opt in via <code>useBoardAccess("&lt;board_key&gt;")</code>.
        RLS still enforces row-level access — this just unlocks the page.
      </p>
    </div>
  );
}
