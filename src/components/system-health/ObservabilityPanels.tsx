import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface FnError {
  id: string;
  function_name: string;
  error_message: string;
  created_at: string;
  request_id: string | null;
}

export function FunctionErrorsPanel() {
  const [errors, setErrors] = useState<FnError[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("function_errors")
        .select("id, function_name, error_message, created_at, request_id")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setErrors((data as FnError[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <GlassCard className="p-4">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        Recent Function Errors
        <Badge variant="outline" className="ml-auto text-[10px] h-5">
          {errors.length}
        </Badge>
      </h3>
      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Loading…</div>
      ) : errors.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          No recent errors. ✓
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {errors.map((err) => (
            <div
              key={err.id}
              className="text-xs border-l-2 border-red-400/40 pl-3 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-red-300 truncate">
                  {err.function_name}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(err.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="text-muted-foreground mt-0.5 line-clamp-2">
                {err.error_message}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

interface ClientErrorRow {
  error_class: "crash" | "stale_deploy";
  error_message: string;
  hits: number;
  affected_users: number;
  last_seen: string;
  latest_url: string | null;
}

/**
 * ClientErrorsPanel — front-end crashes users actually hit.
 *
 * error_logs had been collecting since 2026 (1,049 rows, 74 in the trailing 30
 * days) and nothing in the product ever read it, so a React crash on a
 * daily-driver page was invisible to everyone. Collection without surfacing is
 * not monitoring.
 *
 * Crashes and stale-deploy chunk misses are shown separately on purpose. The
 * stale ones are a client holding a previous deploy's index.html asking for a
 * chunk hash that no longer exists; chunkRecovery.ts self-heals them and they
 * must never look like an incident. Folding both into one count would produce a
 * number that is mostly noise, and a panel whose red is usually wrong gets
 * ignored — which is precisely how the cron gate earned 36 false pages a day.
 */
export function ClientErrorsPanel() {
  const [rows, setRows] = useState<ClientErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("v_client_error_summary" as never)
        .select("error_class, error_message, hits, affected_users, last_seen, latest_url")
        .order("hits", { ascending: false })
        .limit(40);
      if (cancelled) return;
      // An empty list and a failed query are different facts. Rendering "0
      // errors ✓" on a broken query is the fake-success pattern this whole
      // panel exists to end.
      if (error) setFailed(true);
      else setRows((data as unknown as ClientErrorRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const crashes = rows.filter((r) => r.error_class === "crash");
  const stale = rows.filter((r) => r.error_class === "stale_deploy");
  const staleHits = stale.reduce((n, r) => n + Number(r.hits ?? 0), 0);

  return (
    <GlassCard className="p-4">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
        <AlertTriangle className={crashes.length ? "h-4 w-4 text-red-400" : "h-4 w-4 text-emerald-400"} />
        Front-End Crashes
        <span className="text-[11px] font-normal text-muted-foreground">last 30 days</span>
        <Badge variant="outline" className="ml-auto text-[10px] h-5">
          {crashes.length}
        </Badge>
      </h3>

      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Loading…</div>
      ) : failed ? (
        <div className="text-xs text-amber-400 py-4">
          Couldn’t load client errors. This panel is not reporting “no crashes” — it could not read them.
        </div>
      ) : (
        <>
          {crashes.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              No front-end crashes in 30 days. ✓
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {crashes.map((r) => (
                <div
                  key={`${r.error_class}:${r.error_message}`}
                  className="text-xs border-l-2 border-red-400/40 pl-3 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-red-300">
                      {r.hits}× · {r.affected_users} user{r.affected_users === 1 ? "" : "s"}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(r.last_seen), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 line-clamp-2">{r.error_message}</div>
                  {r.latest_url && (
                    <div className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                      {r.latest_url}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {stale.length > 0 && (
            <div className="mt-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
              {staleHits} stale-deploy chunk miss{staleHits === 1 ? "" : "es"} across {stale.length} asset
              {stale.length === 1 ? "" : "s"} — clients on a previous build. Self-healed by chunk recovery; not an incident.
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  created_at: string;
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id, action, entity_type, entity_id, actor_user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setEntries((data as AuditEntry[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <GlassCard className="p-4">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-emerald-400" />
        Recent Audit Activity
        <Badge variant="outline" className="ml-auto text-[10px] h-5">
          {entries.length}
        </Badge>
      </h3>
      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          No activity yet. Audit log starts populating as functions are migrated to the new handler.
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {entries.map((e) => (
            <div
              key={e.id}
              className="text-xs border-l-2 border-emerald-400/40 pl-3 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-emerald-300 truncate">
                  {e.action}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                </span>
              </div>
              {e.entity_type && (
                <div className="text-muted-foreground mt-0.5">
                  {e.entity_type}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}…` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
