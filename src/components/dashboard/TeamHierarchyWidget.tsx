import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Users, GitBranch, Search } from "lucide-react";

// Sam-feedback 2026-06-01: track who recruited who. When Sam hires under a manager,
// surface that hierarchy + the manager's downline production. Reads from
// v_agent_with_downline_production.

type Row = {
  agent_id: string;
  name: string;
  email: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  status: string;
  license_status: string | null;
  hired: string | null;
  own_ap_mtd: number;
  own_deals_mtd: number;
  direct_recruits: number;
  downline_size: number;
  downline_ap_mtd: number;
  team_ap_mtd: number;
};

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function TeamHierarchyWidget() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["v_agent_with_downline_production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_with_downline_production")
        .select("*")
        .order("team_ap_mtd", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" /> Team Hierarchy
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];
  // Filter to recruiters (anyone with direct recruits)
  const recruiters = rows.filter((r) => r.direct_recruits > 0);
  const filtered = search
    ? recruiters.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : recruiters;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" /> Team Hierarchy + Downline Production
          </span>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="border-info/30 text-info">
              {recruiters.length} recruiters
            </Badge>
            <Badge variant="outline" className="border-emerald-600/40 text-emerald-400">
              {recruiters.reduce((a, r) => a + r.downline_size, 0)} total downline
            </Badge>
            <Badge variant="outline" className="border-amber-600/40 text-amber-300">
              {fmtMoney(recruiters.reduce((a, r) => a + r.team_ap_mtd, 0))} team MTD
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name (e.g. Sam, Moody, Obi...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background z-10 border-b">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="text-left p-2">Recruiter</th>
                <th className="text-right p-2 hidden sm:table-cell">Direct</th>
                <th className="text-right p-2">Downline</th>
                <th className="text-right p-2 hidden md:table-cell">Own AP MTD</th>
                <th className="text-right p-2 hidden md:table-cell">Downline AP MTD</th>
                <th className="text-right p-2">Team AP MTD</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.agent_id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-2">
                    <div className="font-medium">{r.name}</div>
                    {r.email && (
                      <div className="text-[10px] text-muted-foreground">{r.email}</div>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums hidden sm:table-cell">
                    {r.direct_recruits}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    <Users className="inline h-3 w-3 mr-1 text-muted-foreground" />
                    {r.downline_size}
                  </td>
                  <td className="p-2 text-right tabular-nums hidden md:table-cell">
                    {r.own_ap_mtd > 0 ? fmtMoney(r.own_ap_mtd) : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums hidden md:table-cell">
                    {r.downline_ap_mtd > 0 ? fmtMoney(r.downline_ap_mtd) : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums font-bold">
                    {fmtMoney(r.team_ap_mtd)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    {search ? "No recruiter matches that name." : "No recruiters yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
