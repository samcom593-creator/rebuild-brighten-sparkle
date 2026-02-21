import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface IntegrityIssue {
  type: string;
  label: string;
  count: number;
  details?: string[];
}

export function SystemIntegrityCard() {
  const [expanded, setExpanded] = useState(false);

  const { data: issues, isLoading, refetch } = useQuery({
    queryKey: ["system-integrity"],
    queryFn: async (): Promise<IntegrityIssue[]> => {
      const results: IntegrityIssue[] = [];

      // 1. Duplicate emails in applications
      const { data: apps } = await supabase
        .from("applications")
        .select("email")
        .is("terminated_at", null);
      if (apps) {
        const emailCounts = new Map<string, number>();
        apps.forEach((a) => {
          const e = a.email.toLowerCase().trim();
          emailCounts.set(e, (emailCounts.get(e) || 0) + 1);
        });
        const dupes = [...emailCounts.entries()].filter(([, c]) => c > 1);
        if (dupes.length > 0) {
          results.push({
            type: "duplicate_emails",
            label: "Duplicate emails in applications",
            count: dupes.length,
            details: dupes.slice(0, 5).map(([email, count]) => `${email} (${count}x)`),
          });
        }
      }

      // 2. Agents without user_ids
      const { data: orphanAgents } = await supabase
        .from("agents")
        .select("id, display_name")
        .is("user_id", null)
        .eq("status", "active");
      if (orphanAgents && orphanAgents.length > 0) {
        results.push({
          type: "orphan_agents",
          label: "Active agents without user accounts",
          count: orphanAgents.length,
          details: orphanAgents.slice(0, 5).map((a) => a.display_name || a.id),
        });
      }

      // 3. Applications with terminated_at but status not rejected
      const { data: badStatus } = await supabase
        .from("applications")
        .select("id, first_name, last_name, status")
        .not("terminated_at", "is", null)
        .not("status", "eq", "rejected")
        .limit(10);
      if (badStatus && badStatus.length > 0) {
        results.push({
          type: "invalid_status",
          label: "Terminated leads with non-rejected status",
          count: badStatus.length,
          details: badStatus.slice(0, 5).map((a) => `${a.first_name} ${a.last_name} (${a.status})`),
        });
      }

      return results;
    },
    staleTime: 300_000,
  });

  const totalIssues = issues?.reduce((sum, i) => sum + i.count, 0) || 0;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className={cn("h-4 w-4", totalIssues > 0 ? "text-amber-400" : "text-emerald-400")} />
          <h4 className="font-semibold text-sm">System Integrity</h4>
        </div>
        <div className="flex items-center gap-2">
          {totalIssues > 0 ? (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
              {totalIssues} issue{totalIssues > 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
              All clear
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refetch()}>
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {totalIssues > 0 && issues && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full">
              <span>View Details</span>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 mt-2">
              {issues.map((issue) => (
                <div key={issue.type} className="rounded-lg border border-border/50 p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                    <span className="font-medium">{issue.label}</span>
                    <Badge variant="outline" className="text-[9px] ml-auto">{issue.count}</Badge>
                  </div>
                  {issue.details && (
                    <div className="mt-1 space-y-0.5">
                      {issue.details.map((d, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground pl-5">{d}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </GlassCard>
  );
}
