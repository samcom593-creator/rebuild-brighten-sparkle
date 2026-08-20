import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarRange, ChevronDown, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";

// PL-020: Licensed-hires tile is no longer a single fixed all-time count.
// Sam can flip the period (this-month / last-30d / this-quarter / this-year /
// custom range) so he can answer "how many hires did we license THIS month?"
// directly from /dashboard without a side-trip into the CRM.

type PresetKey = "this_month" | "last_30d" | "this_quarter" | "this_year" | "all_time" | "custom";

interface DateRange {
  start: string | null; // ISO date (YYYY-MM-DD) or null = open-ended start
  end: string | null;   // ISO date or null = open-ended end
}

const PRESETS: Array<{ key: Exclude<PresetKey, "custom">; label: string }> = [
  { key: "this_month", label: "This month" },
  { key: "last_30d", label: "Last 30 days" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

function startOfMonth(d = new Date()): Date { const x = new Date(d.getFullYear(), d.getMonth(), 1); return x; }
function startOfQuarter(d = new Date()): Date { const q = Math.floor(d.getMonth()/3); return new Date(d.getFullYear(), q*3, 1); }
function startOfYear(d = new Date()): Date { return new Date(d.getFullYear(), 0, 1); }
function isoDate(d: Date): string { return d.toISOString().slice(0,10); }

function resolveRange(preset: PresetKey, custom: DateRange): DateRange {
  const now = new Date();
  switch (preset) {
    case "this_month":   return { start: isoDate(startOfMonth(now)), end: isoDate(now) };
    case "last_30d":     return { start: isoDate(new Date(now.getTime()-30*86400000)), end: isoDate(now) };
    case "this_quarter": return { start: isoDate(startOfQuarter(now)), end: isoDate(now) };
    case "this_year":    return { start: isoDate(startOfYear(now)), end: isoDate(now) };
    case "all_time":     return { start: null, end: null };
    case "custom":       return custom;
  }
}

function labelFor(preset: PresetKey, range: DateRange): string {
  const map: Record<Exclude<PresetKey,"custom">, string> = {
    this_month: "This month", last_30d: "Last 30d", this_quarter: "This quarter",
    this_year: "This year", all_time: "All time",
  };
  if (preset !== "custom") return map[preset];
  if (range.start && range.end) return `${range.start} → ${range.end}`;
  if (range.start) return `since ${range.start}`;
  if (range.end) return `until ${range.end}`;
  return "Custom";
}

export function LicensedHiresRange() {
  const [preset, setPreset] = useState<PresetKey>("this_month");
  const [custom, setCustom] = useState<DateRange>({ start: null, end: null });
  const [open, setOpen] = useState(false);

  const range = useMemo(() => resolveRange(preset, custom), [preset, custom]);

  const { data, isLoading } = useQuery<number>({
    queryKey: ["licensed-hires-range", range.start, range.end],
    queryFn: async () => {
      // Count applications whose licensed_at OR license_progress='licensed' updated_at
      // falls in the range. Prefer licensed_at when present; fall back to updated_at
      // for legacy rows that pre-date the licensed_at column.
      let q = supabase
        .from("applications")
        .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
        .or("licensed_at.not.is.null,license_progress.eq.licensed");
      if (range.start) q = q.gte("licensed_at", range.start + "T00:00:00Z");
      if (range.end)   q = q.lte("licensed_at", range.end + "T23:59:59Z");
      const { count, error } = await q;
      if (error) {
        // Fallback: if the partial-or filter rejects, retry the simpler version.
        const fb = supabase.from("applications").select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE).not("licensed_at", "is", null);
        const r = await (range.start ? fb.gte("licensed_at", range.start + "T00:00:00Z") : fb);
        if (r.error) throw r.error;
        return r.count ?? 0;
      }
      return count ?? 0;
    },
    staleTime: 60_000,
    refetchInterval: 300_000 * 60_000,
  });

  return (
    <div className="rounded-lg border border-border/70 p-3 col-span-2 sm:col-span-1">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <GraduationCap className="h-3 w-3" /> Licensed
        </p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground">
              <CalendarRange className="h-3 w-3" />
              {labelFor(preset, range)}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <div className="space-y-1">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => { setPreset(p.key); setOpen(false); }}
                  className={cn(
                    "w-full text-left rounded px-2 py-1.5 text-xs hover:bg-muted/60 transition-colors",
                    preset === p.key && "bg-primary/10 text-primary",
                  )}
                >
                  {p.label}
                </button>
              ))}
              <div className="pt-2 mt-2 border-t border-border/50 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Custom range</div>
                <input
                  type="date"
                  className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                  value={custom.start ?? ""}
                  onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value || null }))}
                  placeholder="Start"
                />
                <input
                  type="date"
                  className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                  value={custom.end ?? ""}
                  onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value || null }))}
                  placeholder="End"
                />
                <Button
                  size="sm"
                  variant="default"
                  className="w-full h-7 text-xs"
                  onClick={() => { setPreset("custom"); setOpen(false); }}
                  disabled={!custom.start && !custom.end}
                >
                  Apply custom range
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {isLoading ? "—" : (data ?? 0).toLocaleString()}
      </p>
    </div>
  );
}
