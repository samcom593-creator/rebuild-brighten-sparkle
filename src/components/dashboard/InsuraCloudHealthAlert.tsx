import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { AlertOctagon, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

interface AuthHealthRow {
  pipeline: string;
  status: string;
  last_event_at: string | null;
  total_rows: number | null;
  last_7d: number | null;
  days_dark: number | null;
}

/**
 * InsuraCloud sync auth health — only renders when broken.
 *
 * Backing view: v_insuracloud_auth_health (one-row pipeline classifier).
 * When the status string includes 🔴, this card screams. Hidden completely
 * when the pipeline is green so the dashboard stays clean once auth heals.
 *
 * Edge-fn patch (2026-05-19, commit forthcoming): insuracloud-sync now
 * rejects HTML masquerade and writes status='auth_failed' instead of
 * silent fake-success. This card surfaces that state to Sam visually.
 */
export function InsuraCloudHealthAlert() {
  const { data } = useQuery({
    queryKey: ["v_insuracloud_auth_health"],
    queryFn: async (): Promise<AuthHealthRow | null> => {
      const { data, error } = await supabase
        .from("v_insuracloud_auth_health")
        .select("*")
        .maybeSingle();
      if (error) return null;
      return data as unknown as AuthHealthRow;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  if (!data) return null;

  // Status string from the view — "🔴 AUTH BROKEN ..." or "🟢 HEALTHY"
  const broken = (data.status ?? "").startsWith("🔴") || /broken|fail|html|masquerade/i.test(data.status ?? "");
  if (!broken) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="p-5 sm:p-6 border-2 border-rose-500/60 bg-rose-500/[0.06] relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-rose-500/20 rounded-full  pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-rose-500/25 p-3 border border-rose-500/50 shrink-0">
              <AlertOctagon className="h-6 w-6 text-rose-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-rose-300 font-bold">
                Revenue pipeline · auth broken
              </p>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-0.5">
                InsuraCloud commissions are flying blind
              </h2>
              <p className="text-[12px] text-muted-foreground leading-snug mt-1.5 max-w-2xl">
                {data.status}
              </p>
            </div>
          </div>
        </div>

        <div className="relative grid gap-3 grid-cols-2 sm:grid-cols-4 mt-4">
          <Stat label="Total sync rows" value={(data.total_rows ?? 0).toLocaleString()} />
          <Stat label="Last 7 days" value={(data.last_7d ?? 0).toLocaleString()} />
          <Stat label="Days dark" value={data.days_dark ? `${data.days_dark}d` : "—"} />
          <Stat
            label="Last event"
            value={
              data.last_event_at
                ? new Date(data.last_event_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "never"
            }
          />
        </div>

        <div className="relative mt-4 pt-4 border-t border-rose-500/30">
          <p className="text-[11px] text-muted-foreground mb-3">
            Single action to fix: drop the real <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">SAMUEL_JAMES_API_TOKEN</code> at <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">~/.config/apex-creds/insuracloud.token</code>. Edge fn now writes <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">auth_failed</code> instead of fake success — once the token is real, sync_log starts logging the truth.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://replit.com/~"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 px-3 py-2 transition-colors font-medium"
            >
              <KeyRound className="h-3 w-3" />
              Open Replit · grab token
              <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              to="/dashboard/system-health"
              className="text-xs inline-flex items-center gap-1 rounded-md border border-border bg-card hover:bg-muted text-foreground px-3 py-2 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              System Health
            </Link>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums leading-none text-rose-200">{value}</div>
    </div>
  );
}
