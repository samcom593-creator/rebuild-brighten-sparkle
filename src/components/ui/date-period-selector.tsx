import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { startOfDay, startOfWeek, startOfMonth, endOfDay } from "date-fns";

export type DatePeriod = "today" | "week" | "month" | "custom";

interface DatePeriodSelectorProps {
  value: DatePeriod;
  onChange: (period: DatePeriod, range: { start: Date; end: Date }) => void;
  className?: string;
}

function getRange(period: DatePeriod): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfDay(now) };
    case "month":
      return { start: startOfMonth(now), end: endOfDay(now) };
    default:
      return { start: startOfMonth(now), end: endOfDay(now) };
  }
}

export function DatePeriodSelector({ value, onChange, className }: DatePeriodSelectorProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState<Date | undefined>();

  const periods: { key: DatePeriod; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {periods.map((p) => (
        <Button
          key={p.key}
          variant={value === p.key ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => onChange(p.key, getRange(p.key))}
        >
          {p.label}
        </Button>
      ))}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={value === "custom" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3 gap-1"
          >
            <CalendarDays className="h-3 w-3" />
            Custom
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={customDate}
            onSelect={(date) => {
              if (date) {
                setCustomDate(date);
                onChange("custom", { start: startOfDay(date), end: endOfDay(new Date()) });
                setCustomOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
