import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Clock, AlertTriangle, ChevronDown, ChevronUp, Phone, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isToday, isBefore, format } from "date-fns";

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
  const [expanded, setExpanded] = useState(!isMobile);
  const [detailItem, setDetailItem] = useState<ScheduleItem | null>(null);

  const enabled = isFeatureEnabled("scheduleBar");

  // Fetch interviews
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

  // Fetch overdue leads (last_contacted_at > 48h or null)
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

  const items = useMemo<ScheduleItem[]>(() => {
    const result: ScheduleItem[] = [];
    const now = new Date();

    // Interviews
    if (interviews) {
      for (const iv of interviews) {
        const date = new Date(iv.interview_date);
        const app = (iv as any).applications;
        const name = app ? `${app.first_name} ${app.last_name}`.trim() : "Unknown";
        let color: ScheduleItem["color"] = "blue";
        if (iv.status === "completed") color = "green";
        else if (isBefore(date, now)) color = "red";
        else if (isToday(date)) color = "orange";

        result.push({
          id: iv.id,
          type: "interview",
          title: name,
          subtitle: iv.status === "completed" ? "Completed" : format(date, "h:mm a"),
          time: date,
          color,
          leadId: iv.application_id,
        });
      }
    }

    // Overdue leads
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
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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
                    <button
                      key={item.id}
                      onClick={() => setDetailItem(item)}
                      className={cn(
                        "flex items-center gap-1.5 shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all hover:scale-[1.02]",
                        colorMap[item.color]
                      )}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="max-w-[100px] truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="opacity-70 text-[10px]">{item.subtitle}</span>
                      )}
                    </button>
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
                        setDetailItem(null);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {detailItem.type === "interview" ? "View Lead" : "Mark Contacted"}
                    </Button>
                    {/* No-Show Recovery for past-due interviews */}
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
                            const { toast } = await import("sonner");
                            toast.success("Marked as no-show. Consider rescheduling.");
                            setDetailItem(null);
                          } catch {
                            const { toast } = await import("sonner");
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
