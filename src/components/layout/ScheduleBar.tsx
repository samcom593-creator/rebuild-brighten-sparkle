import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Clock, AlertTriangle, ChevronDown, ChevronUp, Phone, CheckCircle2, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isToday, isBefore, format } from "date-fns";
import { toast } from "sonner";

interface ScheduleItem {
  id: string;
  type: "interview" | "overdue" | "no_contact";
  title: string;
  subtitle?: string;
  time: Date;
  color: "red" | "orange" | "blue" | "green";
  leadId?: string;
}

export function ScheduleBar() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(!isMobile);
  const [detailItem, setDetailItem] = useState<ScheduleItem | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const enabled = isFeatureEnabled("scheduleBar");

  const { data: interviews } = useQuery({
    queryKey: ["schedule-bar-interviews", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_interviews")
        .select("id, interview_date, status, notes, application_id, applications!inner(first_name, last_name)")
        .gte("interview_date", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .lte("interview_date", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
        .order("interview_date", { ascending: true })
        .limit(20);
      return data || [];
    },
    enabled: !!user && enabled,
    staleTime: 120_000,
    refetchInterval: 60_000,
  });

  const { data: overdueLeads } = useQuery({
    queryKey: ["schedule-bar-overdue", user?.id],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("applications")
        .select("id, first_name, last_name, last_contacted_at, contacted_at, created_at")
        .is("terminated_at", null)
        .neq("license_status", "licensed")
        .or(`last_contacted_at.lt.${cutoff},last_contacted_at.is.null`)
        .limit(20);
      return data || [];
    },
    enabled: !!user && enabled,
    staleTime: 120_000,
    refetchInterval: 60_000,
  });

  const handleDismiss = async (item: ScheduleItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissingId(item.id);
    
    try {
      if (item.type === "interview") {
        await supabase
          .from("scheduled_interviews")
          .update({ status: "completed" })
          .eq("id", item.id);
      } else if (item.leadId) {
        await supabase
          .from("applications")
          .update({ last_contacted_at: new Date().toISOString() })
          .eq("id", item.leadId);
      }
      
      playSound("success");
      toast.success(`${item.title} marked as handled`);
      
      // Refetch to remove dismissed item
      queryClient.invalidateQueries({ queryKey: ["schedule-bar-interviews"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-bar-overdue"] });
    } catch {
      playSound("error");
      toast.error("Failed to dismiss");
    } finally {
      setDismissingId(null);
    }
  };

  const items = useMemo<ScheduleItem[]>(() => {
    const result: ScheduleItem[] = [];
    const now = new Date();

    if (interviews) {
      for (const iv of interviews) {
        if (iv.status === "completed") continue;
        const date = new Date(iv.interview_date);
        const app = (iv as any).applications;
        const name = app ? `${app.first_name} ${app.last_name}`.trim() : "Unknown";
        let color: ScheduleItem["color"] = "blue";
        if (isBefore(date, now)) color = "red";
        else if (isToday(date)) color = "orange";

        result.push({
          id: iv.id,
          type: "interview",
          title: name,
          subtitle: format(date, "h:mm a"),
          time: date,
          color,
          leadId: iv.application_id,
        });
      }
    }

    if (overdueLeads) {
      for (const lead of overdueLeads.slice(0, 8)) {
        const name = `${lead.first_name} ${lead.last_name || ""}`.trim();
        const lastContact = lead.last_contacted_at || lead.contacted_at;
        result.push({
          id: `overdue-${lead.id}`,
          type: lastContact ? "overdue" : "no_contact",
          title: name,
          subtitle: lastContact
            ? `Last: ${formatDistanceToNow(new Date(lastContact), { addSuffix: true })}`
            : "Never contacted",
          time: lastContact ? new Date(lastContact) : new Date(lead.created_at),
          color: lastContact ? "orange" : "red",
          leadId: lead.id,
        });
      }
    }

    return result.sort((a, b) => {
      const priority = { red: 0, orange: 1, blue: 2, green: 3 };
      return priority[a.color] - priority[b.color];
    });
  }, [interviews, overdueLeads]);

  if (!enabled || items.length === 0) return null;

  const colorMap = {
    red: "border-rose-500/40 bg-rose-500/10 text-rose-400",
    orange: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    blue: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  };

  const iconMap = {
    interview: Calendar,
    overdue: AlertTriangle,
    no_contact: Phone,
  };

  return (
    <>
      <div className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <button
          onClick={() => {
            playSound("click");
            setExpanded((v) => !v);
          }}
          className={cn("flex items-center gap-2 w-full px-4 text-xs text-muted-foreground hover:text-foreground transition-colors", isMobile ? "py-2.5" : "py-1.5")}
        >
          <Clock className="h-3.5 w-3.5" />
          <span className="font-medium">Schedule</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1.5">
            {items.length}
          </Badge>
          {items.filter((i) => i.color === "red").length > 0 && (
            <Badge className="text-[9px] h-4 px-1.5 bg-rose-500/20 text-rose-400 border-rose-500/30">
              {items.filter((i) => i.color === "red").length} urgent
            </Badge>
          )}
          <span className="ml-auto">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className={cn("h-3 w-3", !expanded && "animate-bounce")} />}
          </span>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-thin">
                {items.map((item) => {
                  const Icon = iconMap[item.type];
                  return (
                    <motion.button
                      key={item.id}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setDetailItem(item)}
                      className={cn(
                        "group relative flex items-center gap-1.5 shrink-0 rounded-full border text-xs font-medium transition-all hover:scale-[1.02]",
                        isMobile ? "px-3 py-2" : "px-3 py-1",
                        colorMap[item.color],
                        item.color === "red" && "animate-pulse"
                      )}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="max-w-[100px] truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="opacity-70 text-[10px]">{item.subtitle}</span>
                      )}
                      {/* Dismiss X button */}
                      <span
                        role="button"
                        onClick={(e) => handleDismiss(item, e)}
                        className={cn(
                          "ml-1 flex items-center justify-center rounded-full bg-background/60 transition-opacity hover:bg-background",
                          isMobile ? "h-6 w-6 opacity-100" : "h-4 w-4 opacity-0 group-hover:opacity-100",
                          dismissingId === item.id && "animate-spin opacity-100"
                        )}
                      >
                        <X className={isMobile ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Detail sheet */}
      <Sheet open={!!detailItem} onOpenChange={(open) => !open && setDetailItem(null)}>
        <SheetContent side="right" className="w-[320px] sm:w-[380px]">
          <SheetHeader>
            <SheetTitle>{detailItem?.title}</SheetTitle>
            <SheetDescription>
              {detailItem?.type === "interview" && "Scheduled interview"}
              {detailItem?.type === "overdue" && "Overdue follow-up"}
              {detailItem?.type === "no_contact" && "Never contacted"}
            </SheetDescription>
          </SheetHeader>
          {detailItem && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{detailItem.subtitle}</span>
              </div>
              {detailItem.type === "interview" && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{format(detailItem.time, "PPP 'at' h:mm a")}</span>
                </div>
              )}
              <div className="flex gap-2 pt-2">
              {detailItem.leadId && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={async () => {
                        if (detailItem.type !== "interview") {
                          await supabase
                            .from("applications")
                            .update({ last_contacted_at: new Date().toISOString() })
                            .eq("id", detailItem.leadId!);
                        }
                        playSound("success");
                        setDetailItem(null);
                        queryClient.invalidateQueries({ queryKey: ["schedule-bar-overdue"] });
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {detailItem.type === "interview" ? "View Lead" : "Mark Contacted"}
                    </Button>
                    {detailItem.type === "interview" && detailItem.color === "red" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                        onClick={async () => {
                          try {
                            await supabase
                              .from("scheduled_interviews")
                              .update({ status: "no_show" })
                              .eq("id", detailItem.id);
                            const { logLeadActivity } = await import("@/lib/logLeadActivity");
                            if (detailItem.leadId) {
                              logLeadActivity({
                                leadId: detailItem.leadId,
                                type: "interview_no_show",
                                title: "Interview marked as no-show",
                                details: { interview_id: detailItem.id },
                              });
                            }
                            playSound("whoosh");
                            toast.success("Marked as no-show. Consider rescheduling.");
                            setDetailItem(null);
                            queryClient.invalidateQueries({ queryKey: ["schedule-bar-interviews"] });
                          } catch {
                            playSound("error");
                            toast.error("Failed to update");
                          }
                        }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                        No-Show
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
