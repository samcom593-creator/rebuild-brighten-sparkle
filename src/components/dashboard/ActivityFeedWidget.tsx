import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Activity, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  created_at: string;
}

interface ProfileLite {
  user_id: string;
  full_name: string | null;
}

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  application: (id) => `/dashboard/applicants?focus=${id}`,
  applicant: (id) => `/dashboard/applicants?focus=${id}`,
  agent: () => `/dashboard/team`,
  notification: () => `/dashboard/notifications`,
  lead: () => `/dashboard/lead-center`,
  aged_lead: () => `/dashboard/aged-leads`,
};

function prettyAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ActivityFeedWidgetProps {
  limit?: number;
  /** Optional title override */
  title?: string;
  /** Restrict to a single entity_type (e.g. "agent") */
  entityType?: string;
}

export function ActivityFeedWidget({
  limit = 15,
  title = "Recent Activity",
  entityType,
}: ActivityFeedWidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit_log", "feed", limit, entityType ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, action, entity_type, entity_id, actor_user_id, actor_role, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (entityType) q = q.eq("entity_type", entityType);
      const { data: rows, error } = await q;
      if (error) throw error;

      const userIds = Array.from(
        new Set((rows ?? []).map((r) => r.actor_user_id).filter(Boolean) as string[])
      );
      let profileMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", userIds);
        profileMap = new Map(
          (profs as ProfileLite[] | null)?.map((p) => [p.user_id, p.full_name ?? ""]) ?? []
        );
      }
      return (rows as AuditEntry[]).map((r) => ({
        ...r,
        actor_name: r.actor_user_id ? profileMap.get(r.actor_user_id) ?? null : null,
      }));
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const items = useMemo(() => data ?? [], [data]);

  return (
    <Card className="glass">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {title}
          <Badge variant="outline" className="ml-auto text-[10px] h-5">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No recent activity yet.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {items.map((e) => {
              const route =
                e.entity_type && e.entity_id && ENTITY_ROUTES[e.entity_type]
                  ? ENTITY_ROUTES[e.entity_type](e.entity_id)
                  : null;

              const inner = (
                <div className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
                  <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold truncate">{prettyAction(e.action)}</span>
                      {e.actor_role && (
                        <Badge variant="outline" className="h-4 text-[9px] px-1.5">
                          {e.actor_role}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {e.actor_name && <span>{e.actor_name}</span>}
                      {e.actor_name && e.entity_type && <span> · </span>}
                      {e.entity_type && (
                        <span>
                          {e.entity_type}
                          {e.entity_id ? ` ${e.entity_id.slice(0, 8)}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {route && <ArrowUpRight className="h-3 w-3 text-muted-foreground mt-1 shrink-0" />}
                </div>
              );

              return route ? (
                <Link key={e.id} to={route} className="block">
                  {inner}
                </Link>
              ) : (
                <div key={e.id}>{inner}</div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
