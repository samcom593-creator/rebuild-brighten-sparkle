import { useState, useEffect } from "react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AttendanceMark = Database["public"]["Enums"]["attendance_mark"];
type AttendanceType = Database["public"]["Enums"]["attendance_type"];

interface AttendanceRecord {
  date: Date;
  status: AttendanceMark;
}

interface AttendanceGridProps {
  agentId: string;
  type: AttendanceType;
  label: string;
  onMarkAbsent?: () => void;
  readOnly?: boolean;
}

// 7 days: Sun-Sat (weekStartsOn: 0) or Su M T W Th F Sa
const DAYS = ["Su", "M", "T", "W", "Th", "F", "Sa"];

export function AttendanceGrid({
  agentId,
  type,
  label,
  onMarkAbsent,
  readOnly = false,
}: AttendanceGridProps) {
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [updating, setUpdating] = useState<number | null>(null);

  // Get current week's Sun-Sat dates (7 days)
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 }); // Sunday
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    fetchAttendance();
  }, [agentId, type]);

  const fetchAttendance = async () => {
    try {
      const startDate = format(weekDays[0], "yyyy-MM-dd");
      const endDate = format(weekDays[6], "yyyy-MM-dd"); // Now includes full week
      const { data, error } = await supabase
        .from("agent_attendance")
        .select("attendance_date, status")
        .eq("agent_id", agentId)
        .eq("attendance_type", type)
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate);

      if (error) throw error;

      const records: AttendanceRecord[] = weekDays.map((day) => {
        const found = data?.find(
          (d) => d.attendance_date === format(day, "yyyy-MM-dd")
        );
        return {
          date: day,
          status: found?.status || "unmarked",
        };
      });

      setAttendance(records);
    } catch (error) {
      console.error("Error fetching attendance:", error);
    }
  };

  const handleToggle = async (dayIndex: number) => {
    if (readOnly) return;
    
    const day = weekDays[dayIndex];
    const currentRecord = attendance[dayIndex];
    
    // Cycle through: unmarked -> present -> absent -> unmarked
    const statusCycle: AttendanceMark[] = ["unmarked", "present", "absent"];
    const currentIndex = statusCycle.indexOf(currentRecord.status);
    const nextStatus = statusCycle[(currentIndex + 1) % statusCycle.length];

    setUpdating(dayIndex);

    try {
      const dateStr = format(day, "yyyy-MM-dd");

      // Upsert the attendance record
      const { error } = await supabase
        .from("agent_attendance")
        .upsert(
          {
            agent_id: agentId,
            attendance_date: dateStr,
            attendance_type: type,
            status: nextStatus,
            marked_by: user?.id,
          },
          { onConflict: "agent_id,attendance_date,attendance_type" }
        );

      if (error) throw error;

      setAttendance((prev) =>
        prev.map((r, i) => (i === dayIndex ? { ...r, status: nextStatus } : r))
      );

      // Trigger notification if marked absent
      if (nextStatus === "absent") {
        onMarkAbsent?.();
      }
      
      // Play celebration sound when marking "Sold" as present
      if (type === "daily_sale" && nextStatus === "present") {
        playSound("celebrate");
      }
    } catch (error) {
      console.error("Error updating attendance:", error);
      toast.error("Failed to update attendance");
    } finally {
      setUpdating(null);
    }
  };

  const getStatusIcon = (status: AttendanceMark) => {
    switch (status) {
      case "present":
        return <Check className="h-3.5 w-3.5" />;
      case "absent":
        return <X className="h-3.5 w-3.5" />;
      default:
        return <Minus className="h-3.5 w-3.5 opacity-50" />;
    }
  };

  const getStatusClass = (status: AttendanceMark, date: Date) => {
    const isToday = isSameDay(date, today);
    const baseClass = "transition-all";
    
    switch (status) {
      case "present":
        return cn(baseClass, "bg-green-500/20 text-green-400 border-green-500/30");
      case "absent":
        return cn(baseClass, "bg-red-500/20 text-red-400 border-red-500/30");
      default:
        return cn(
          baseClass,
          isToday
            ? "bg-primary/10 text-primary border-primary/30"
            : "bg-muted text-muted-foreground border-border"
        );
    }
  };

  const getStatusLabel = (status: AttendanceMark) => {
    switch (status) {
      case "present": return "✓ Present";
      case "absent": return "✗ Absent";
      default: return "— Not marked";
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-10 shrink-0 font-medium">{label}:</span>
        <div className="flex flex-col gap-0.5">
          {/* Day letter headers */}
          <div className="flex gap-0.5">
            {DAYS.map((dayLabel, index) => (
              <div
                key={`header-${index}`}
                className="w-5 h-3 flex items-center justify-center text-[8px] text-muted-foreground font-medium"
              >
                {dayLabel}
              </div>
            ))}
          </div>
          {/* Attendance buttons */}
          <div className="flex gap-0.5">
          {weekDays.map((day, index) => {
            const record = attendance[index] || { status: "unmarked" };
            const isToday = isSameDay(day, today);
            
            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleToggle(index)}
                    disabled={readOnly || updating === index}
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center border text-[9px] font-medium transition-all",
                      getStatusClass(record.status, day),
                      !readOnly && "hover:scale-110 cursor-pointer",
                      updating === index && "opacity-50 animate-pulse",
                      isToday && "ring-1 ring-primary ring-offset-1 ring-offset-background"
                    )}
                  >
                    {getStatusIcon(record.status)}
                  </button>
                </TooltipTrigger>
                <TooltipContent 
                  side="top" 
                  className="bg-popover border border-border shadow-lg px-3 py-2"
                >
                  <div className="text-xs space-y-0.5">
                    <p className="font-semibold">{format(day, "EEEE, MMM d")}</p>
                    <p className="text-muted-foreground">{getStatusLabel(record.status)}</p>
                    {!readOnly && <p className="text-[10px] text-muted-foreground/70">Click to toggle</p>}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
