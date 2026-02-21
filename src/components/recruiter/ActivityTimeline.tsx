import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Phone, Mail, BookOpen, CalendarClock, MessageSquare,
  ArrowRightLeft, Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActivityItem {
  id: string;
  activity_type: string;
  title: string;
  details: Record<string, unknown> | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
}

const typeIcons: Record<string, React.ElementType> = {
  call_attempt: Phone,
  email_sent: Mail,
  stage_changed: ArrowRightLeft,
  note_added: MessageSquare,
  calendly_link_sent: CalendarClock,
  default: BookOpen,
};

const typeDotColors: Record<string, string> = {
  call_attempt: "bg-emerald-400",
  email_sent: "bg-blue-400",
  stage_changed: "bg-purple-400",
  note_added: "bg-amber-400",
  calendly_link_sent: "bg-pink-400",
  default: "bg-muted-foreground",
};

export function ActivityTimeline({
  leadId,
  limit = 3,
  compact = true,
}: {
  leadId: string;
  limit?: number;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: activities, isLoading } = useQuery({
    queryKey: ["lead_activity", leadId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activity" as any)
        .select("id, activity_type, title, details, actor_name, actor_role, created_at")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as ActivityItem[];
    },
    staleTime: 120_000,
  });

  // Realtime subscription for live updates
  useEffect(() => {
    const channel = supabase
      .channel(`lead_activity_${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_activity",
          filter: `lead_id=eq.${leadId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["lead_activity", leadId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground py-1.5">
        No activity yet
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative pl-3">
        {/* Vertical timeline line */}
        <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />

        <div className={cn("space-y-2", compact && "space-y-1.5")}>
          {activities.map((item) => {
            const Icon = typeIcons[item.activity_type] || typeIcons.default;
            const dotColor = typeDotColors[item.activity_type] || typeDotColors.default;
            const createdAt = new Date(item.created_at);

            return (
              <div key={item.id} className="relative flex items-start gap-2 group">
                {/* Dot */}
                <div
                  className={cn(
                    "absolute -left-3 top-1 h-2.5 w-2.5 rounded-full border-2 border-background z-10",
                    dotColor
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-medium truncate">
                      {item.title}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] text-muted-foreground shrink-0 cursor-default">
                          {formatDistanceToNow(createdAt, { addSuffix: true })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{format(createdAt, "MMM d, yyyy h:mm a")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {item.actor_name && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      by {item.actor_name}
                      {item.actor_role && <span className="opacity-60"> ({item.actor_role})</span>}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
