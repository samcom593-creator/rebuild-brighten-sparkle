import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { formatDistanceToNow } from "date-fns";
import { filterActionableNotifications } from "@/lib/notificationFilters";

interface NotifRow {
  id: string;
  user_id: string;
  title: string | null;
  body: string | null;
  type: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string | null;
  priority: string | null;
}

export default function MyNotifications() {
  usePageTitle("My Notifications · APEX");
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["my-notifications", user?.id],
    enabled: !!user?.id,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return filterActionableNotifications((data ?? []) as Array<NotifRow & Record<string, unknown>>) as NotifRow[];
    },
  });

  // Mark visible notifications as read on mount (no spam if already read)
  useEffect(() => {
    if (!user?.id) return;
    const unread = (data ?? []).filter((n) => !n.read_at).map((n) => n.id);
    if (unread.length === 0) return;
    supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", unread)
      .then(() => qc.invalidateQueries({ queryKey: ["my-notifications"] }));
  }, [data, user?.id, qc]);

  if (isLoading) return <PageLoadingSkeleton />;
  if (!user) return <div className="p-6">Sign in to view notifications.</div>;

  const unreadCount = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        accent="primary"
        eyebrow="Notifications"
        eyebrowIcon={<Bell className="h-3 w-3" />}
        title="My Notifications"
        subtitle={
          unreadCount > 0
            ? `${data?.length ?? 0} total · ${unreadCount} unread`
            : `${data?.length ?? 0} total · all caught up`
        }
      />

      {(!data || data.length === 0) && (
        <Card>
          <CardContent className="text-center py-16 text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-3 opacity-50" />
            No notifications yet.
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/50 p-0">
            {data.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{n.title ?? "Notification"}</span>
                    {!n.read_at && <Badge variant="default" className="text-[10px]">new</Badge>}
                    {n.priority === "high" && (
                      <Badge variant="destructive" className="text-[10px]">high</Badge>
                    )}
                    {n.type && <Badge variant="outline" className="text-[10px]">{n.type}</Badge>}
                  </div>
                  {n.body && (
                    <p className="text-sm text-muted-foreground mt-1">{n.body}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : "recently"}
                  </p>
                </div>
                {n.link && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={n.link}>Open</a>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        <CheckCircle2 className="inline h-3 w-3 mr-1" />
        Items mark read automatically when viewed.
      </p>
    </div>
  );
}
