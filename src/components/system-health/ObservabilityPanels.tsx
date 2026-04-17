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
