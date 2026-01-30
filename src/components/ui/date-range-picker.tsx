import { useState } from "react";
import { format, subDays, endOfWeek, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { CalendarIcon, Calendar as CalendarDays } from "lucide-react";
import { getNowPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type DateRangePeriod = "today" | "week" | "month" | "custom";

export interface DateRange {
  from?: Date;
  to?: Date;
}

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  period?: DateRangePeriod;
  onPeriodChange?: (period: DateRangePeriod) => void;
  className?: string;
  showPresets?: boolean;
  // Simplified mode - just the calendar picker without presets
  simpleMode?: boolean;
}

export function DateRangePicker({
  value = { from: new Date(), to: new Date() },
  onChange,
  period = "week",
  onPeriodChange,
  className,
  showPresets = true,
  simpleMode = false,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [selectingStart, setSelectingStart] = useState(true);
  const [internalPeriod, setInternalPeriod] = useState<DateRangePeriod>(period);

  const currentPeriod = onPeriodChange ? period : internalPeriod;
  const setPeriod = onPeriodChange || setInternalPeriod;

  const handlePresetClick = (preset: DateRangePeriod) => {
    const pstNow = getNowPST();
    let newRange: DateRange;

    switch (preset) {
      case "today":
        newRange = { from: pstNow, to: pstNow };
        break;
      case "week":
        newRange = {
          from: toZonedTime(new Date(getWeekStartPST()), "America/Los_Angeles"),
          to: endOfWeek(pstNow, { weekStartsOn: 0 }),
        };
        break;
      case "month":
        newRange = {
          from: toZonedTime(new Date(getMonthStartPST()), "America/Los_Angeles"),
          to: endOfMonth(pstNow),
        };
        break;
      default:
        return;
    }

    onChange?.(newRange);
    setPeriod(preset);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;

    if (selectingStart) {
      onChange?.({ from: date, to: date });
      setSelectingStart(false);
    } else {
      const fromDate = value?.from || date;
      const newRange = date < fromDate
        ? { from: date, to: fromDate }
        : { from: fromDate, to: date };
      onChange?.(newRange);
      setPeriod("custom");
      setSelectingStart(true);
      setOpen(false);
    }
  };

  const presetLabels: Record<DateRangePeriod, string> = {
    today: "Today",
    week: "This Week",
    month: "This Month",
    custom: "Custom",
  };

  // Simple mode - just a date range picker button
  if (simpleMode) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "text-xs h-9 gap-1.5 justify-start font-normal",
              !value?.from && "text-muted-foreground",
              className
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {value?.from && value?.to ? (
              <span>
                {format(value.from, "MMM d")} - {format(value.to, "MMM d")}
              </span>
            ) : (
              "Pick dates"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground">
              {selectingStart ? "Select start date" : "Select end date"}
            </p>
            {value?.from && value?.to && (
              <p className="text-sm font-medium">
                {format(value.from, "MMM d, yyyy")}
                {" → "}
                {format(value.to, "MMM d, yyyy")}
              </p>
            )}
          </div>
          <Calendar
            mode="single"
            selected={selectingStart ? value?.from : value?.to}
            onSelect={handleDateSelect}
            disabled={(date) => date > new Date()}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {showPresets && (
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          {(["today", "week", "month"] as DateRangePeriod[]).map((p) => (
            <Button
              key={p}
              variant={currentPeriod === p ? "default" : "ghost"}
              size="sm"
              onClick={() => handlePresetClick(p)}
              className={cn(
                "text-xs h-8 px-3",
                currentPeriod === p && "bg-primary text-primary-foreground"
              )}
            >
              {p === "today" ? "Day" : p === "week" ? "Week" : "Month"}
            </Button>
          ))}

          {/* Custom Date Range Popover */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={currentPeriod === "custom" ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "text-xs h-8 gap-1.5",
                  currentPeriod === "custom" && "bg-primary text-primary-foreground"
                )}
              >
                <CalendarDays className="h-3 w-3" />
                {currentPeriod === "custom" && value?.from && value?.to ? (
                  <span className="hidden sm:inline">
                    {format(value.from, "MMM d")} - {format(value.to, "MMM d")}
                  </span>
                ) : (
                  "Custom Dates"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 border-b border-border">
                <p className="text-xs text-muted-foreground">
                  {selectingStart ? "Select start date" : "Select end date"}
                </p>
                {value?.from && value?.to && (
                  <p className="text-sm font-medium">
                    {format(value.from, "MMM d, yyyy")}
                    {" → "}
                    {format(value.to, "MMM d, yyyy")}
                  </p>
                )}
              </div>
              <Calendar
                mode="single"
                selected={selectingStart ? value?.from : value?.to}
                onSelect={handleDateSelect}
                disabled={(date) => date > new Date()}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}

// Hook for managing date range state - uses PST timezone for consistency
export function useDateRange(initialPeriod: DateRangePeriod = "week") {
  const pstNow = getNowPST();
  
  const getInitialRange = (): DateRange => {
    switch (initialPeriod) {
      case "today":
        return { from: pstNow, to: pstNow };
      case "week":
        return {
          from: toZonedTime(new Date(getWeekStartPST()), "America/Los_Angeles"),
          to: endOfWeek(pstNow, { weekStartsOn: 0 }),
        };
      case "month":
        return {
          from: toZonedTime(new Date(getMonthStartPST()), "America/Los_Angeles"),
          to: endOfMonth(pstNow),
        };
      default:
        return { from: subDays(pstNow, 30), to: pstNow };
    }
  };

  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod);
  const [range, setRange] = useState<DateRange>(getInitialRange);

  return {
    period,
    setPeriod,
    range,
    setRange,
    startDate: range.from ? format(range.from, "yyyy-MM-dd") : "",
    endDate: range.to ? format(range.to, "yyyy-MM-dd") : "",
  };
}
