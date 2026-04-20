import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, RefreshCw, CheckCircle2, XCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface CronJob {
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
  last_run: string | null;
  last_status: string | null;
  last_error: string | null;
  runs_24h: number;
  errors_24h: number;
}

// Cron schedule -> human readable
function humanizeSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (cron === "* * * * *") return "Every minute";
  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} min`;
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  if (min === "0" && hour === "*") return "Every hour";
  if (dom === "*" && mon === "*" && dow === "*") {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return `Daily at ${h12}:${m.toString().padStart(2, "0")} ${ampm} UTC`;
    }
  }
  if (dow !== "*" && dow !== "?") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = days[parseInt(dow, 10)] ?? `dow=${dow}`;
    return `${dayName} at ${hour}:${min.padStart(2, "0")} UTC`;
  }
  if (dom !== "*") return `Day ${dom} of month at ${hour}:${min.padStart(2, "0")} UTC`;
  return cron;
}

export function CronJobsPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "errors" | "inactive">("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_cron_jobs_with_status" as any);
    if (error) {
      console.error(error);
      setJobs([]);
    } else {
      setJobs((data as unknown as CronJob[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = jobs.filter((j) => {
    if (filter === "errors" && j.errors_24h === 0) return false;
    if (filter === "inactive" && j.active) return false;
    if (search && !j.jobname.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const total = jobs.length;
  const totalErrors = jobs.filter((j) => j.errors_24h > 0).length;
  const totalInactive = jobs.filter((j) => !j.active).length;

  return (
    <div className="space-y-3">
      {/* Header stats */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
            filter === "all" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          All ({total})
        </button>
        <button
          onClick={() => setFilter("errors")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
            filter === "errors" ? "bg-destructive text-destructive-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          Failing ({totalErrors})
        </button>
        <button
          onClick={() => setFilter("inactive")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
            filter === "inactive" ? "bg-muted-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          Inactive ({totalInactive})
        </button>
        <div className="relative ml-auto">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs pl-8 w-44"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2 font-semibold">Job</th>
                <th className="text-left p-2 font-semibold">Schedule</th>
                <th className="text-left p-2 font-semibold">Last Run</th>
                <th className="text-center p-2 font-semibold">24h</th>
                <th className="text-center p-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No jobs match.</td></tr>
              ) : (
                filtered.map((j) => (
                  <tr key={j.jobname} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-mono text-[11px] max-w-[260px] truncate" title={j.jobname}>
                      {!j.active && <Badge variant="outline" className="mr-1 text-[9px] h-4">off</Badge>}
                      {j.jobname}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span title={j.schedule}>{humanizeSchedule(j.schedule)}</span>
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {j.last_run ? formatDistanceToNow(new Date(j.last_run), { addSuffix: true }) : "—"}
                    </td>
                    <td className="p-2 text-center">
                      <span className="text-foreground">{j.runs_24h}</span>
                      {j.errors_24h > 0 && (
                        <span className="text-destructive ml-1">/{j.errors_24h} err</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {j.last_status === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline" />
                      ) : j.last_status === "error" ? (
                        <span title={j.last_error || "error"}>
                          <XCircle className="h-3.5 w-3.5 text-destructive inline" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
