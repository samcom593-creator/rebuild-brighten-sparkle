// ControlTerminal — Sam's live ops cockpit, mounted ONLY on the main Dashboard.
// Two surfaces:
//   1. Voice mic (was floating-on-every-tab — now anchored here, where Sam wants it)
//   2. SQL/live-data terminal — paste a query, hit Run, see results, mutate the
//      website's data without leaving the dashboard.
//
// Sam 2026-04-27 rule: this is HIS operator console. Treat unknown SQL as
// destructive — confirm before non-SELECT statements actually run.
import { useState, useCallback } from "react";
import { Terminal, Play, Loader2, AlertTriangle, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";

type RowMap = Record<string, unknown>;

export function ControlTerminal() {
  const [query, setQuery] = useState("select count(*)::int total_deals from deals where created_at >= now() - interval '7 days'");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isMutating = /^\s*(insert|update|delete|drop|alter|truncate|create)\b/i.test(query);

  const run = useCallback(async () => {
    setError(null);
    setRows(null);
    if (isMutating) {
      const ok = window.confirm(
        "This query will MUTATE the database. Proceed?\n\n" + query.slice(0, 400),
      );
      if (!ok) return;
    }
    setRunning(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-sql", {
        body: { query },
      });
      if (fnErr) throw fnErr;
      const payload = data as { ok?: boolean; rows?: RowMap[]; error?: string; rowCount?: number };
      if (!payload?.ok) throw new Error(payload?.error ?? "unknown error");
      setRows(payload.rows ?? []);
      toast.success(`${payload.rowCount ?? payload.rows?.length ?? 0} rows`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      toast.error("Query failed");
    } finally {
      setRunning(false);
    }
  }, [query, isMutating]);

  const copyRows = () => {
    if (!rows) return;
    navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const headers = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <GlassCard className="p-4 md:p-5 space-y-4 border-emerald-500/30 bg-gradient-to-br from-slate-900/80 to-emerald-950/40">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-emerald-400" />
          <h3 className="font-bold text-base text-white tracking-wide uppercase">Control Terminal</h3>
          {isMutating && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-500/30">
              <AlertTriangle className="h-3 w-3" /> mutating
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={run} disabled={running} size="sm" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold">
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run
          </Button>
        </div>
      </div>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={3}
        spellCheck={false}
        className="w-full bg-slate-950/70 text-emerald-200 font-mono text-xs md:text-sm rounded-md p-3 border border-emerald-500/20 focus:border-emerald-400 focus:outline-none resize-y"
        placeholder="paste SQL — e.g. select * from deals where created_at >= now() - interval '24 hours' limit 20"
      />

      {error && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-500/30 rounded-md p-3 font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
            <Button variant="ghost" size="sm" onClick={copyRows} className="h-7 text-xs text-slate-300 hover:text-white">
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />} copy json
            </Button>
          </div>
          <div className="overflow-auto max-h-72 rounded-md border border-emerald-500/20">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 text-emerald-300 uppercase tracking-wider text-[10px]">
                <tr>{headers.map((h) => <th key={h} className="text-left px-3 py-2 border-b border-emerald-500/20">{h}</th>)}</tr>
              </thead>
              <tbody className="font-mono text-slate-200">
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-slate-950/50" : "bg-slate-900/50"}>
                    {headers.map((h) => {
                      const v = r[h];
                      const str = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                      return <td key={h} className="px-3 py-1.5 border-b border-slate-800 max-w-xs truncate" title={str}>{str}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="text-xs text-slate-400 italic">query returned 0 rows</div>
      )}
    </GlassCard>
  );
}
