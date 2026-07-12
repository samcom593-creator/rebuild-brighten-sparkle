import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Play,
  Sparkles,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import {
  OperatorCommandResponse,
  buildImplementationPrompt,
  planOperatorCommand,
} from "@/lib/operatorConsole";
import { getBusinessDayBounds } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";

type RowMap = Record<string, unknown>;

const HISTORY_KEY = "apex-control-terminal-history-v2";
const DEFAULT_SQL = "select count(*)::int total_deals from deals where posted_at >= now() - interval '7 days'";

async function loadStatusSnapshot(): Promise<string> {
  const dayBounds = getBusinessDayBounds();

  const [apps, deals, hires, syncRow] = await Promise.all([
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", dayBounds.startIso).lt("created_at", dayBounds.endIso),
    supabase.from("deals").select("annual_premium", { count: "exact" }).gte("posted_at", dayBounds.startIso).lt("posted_at", dayBounds.endIso).in("status", DEAL_TRUTH_STATUS_FILTER),
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("closed_at", dayBounds.startIso).lt("closed_at", dayBounds.endIso),
    supabase.from("agentlink_sync_log" as any).select("finished_at, started_at").eq("status", "ok").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const todayAlp = ((deals.data || []) as Array<{ annual_premium?: number | null }>).reduce((sum, row) => sum + Number(row.annual_premium ?? 0), 0);
  const latestSync = syncRow.data as { finished_at?: string | null; started_at?: string | null } | null;

  return `Applications Today: ${apps.count || 0} · Deals Today: ${deals.count || 0} · Today's ALP: $${Math.round(todayAlp).toLocaleString()} · Hires Today: ${hires.count || 0} · Last sync: ${latestSync?.finished_at || latestSync?.started_at || "unknown"}`;
}

async function queueOperatorTask(command: string, prompt: string): Promise<string | null> {
  try {
    const typedSupabase = supabase as unknown as {
      from: (table: string) => {
        insert: (values: Record<string, unknown>) => {
          select: (fields: string) => {
            maybeSingle: () => Promise<{ data: { id?: string } | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await typedSupabase
      .from("agent_inbox")
      .insert({
        title: `Website task: ${command.slice(0, 80)}`,
        list: "Build",
        priority: "high",
        source: "ui",
        notes: prompt,
      })
      .select("id")
      .maybeSingle();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export function ControlTerminal() {
  const navigate = useNavigate();
  const askConfirm = useConfirm();
  const [command, setCommand] = useState("");
  const [sqlQuery, setSqlQuery] = useState(DEFAULT_SQL);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowMap[] | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<OperatorCommandResponse[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<OperatorCommandResponse | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 12)));
  }, [history]);

  const isMutatingSql = /^\s*(insert|update|delete|drop|alter|truncate|create)\b/i.test(sqlQuery);

  const executePlannedCommand = useCallback(async (planned: OperatorCommandResponse) => {
    setRunning(true);
    try {
      if (planned.executionType === "navigate" && planned.route) {
        navigate(planned.route);
        const result = { ...planned, executedAction: `Navigated to ${planned.route}`, result: `Opened ${planned.route}.` };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        setCommand("");
        return;
      }

      if (planned.executionType === "sync") {
        const [syncRes, awardsRes] = await Promise.all([
          supabase.rpc("agentlink_live_pull" as never),
          supabase.rpc("agentlink_award_top_producers" as never),
        ]);
        if (syncRes.error || awardsRes.error) throw new Error(syncRes.error?.message || awardsRes.error?.message || "Sync failed");
        const result = { ...planned, executedAction: "Refreshed AgentLink deals and leaderboard cache", result: "Live numbers and leaderboard snapshots were refreshed." };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        toast.success("AgentLink data refreshed");
        setCommand("");
        return;
      }

      if (planned.executionType === "health_check") {
        const { error } = await supabase.functions.invoke("system-health-check");
        if (error) throw error;
        const result = { ...planned, executedAction: "Ran system health check", result: "System check completed successfully." };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        toast.success("System health check complete");
        setCommand("");
        return;
      }

      if (planned.executionType === "licensing_blast") {
        const { error } = await supabase.functions.invoke("bulk-send-licensing");
        if (error) throw error;
        const result = { ...planned, executedAction: "Sent licensing blast", result: "Licensing outreach was sent." };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        toast.success("Licensing blast sent");
        setCommand("");
        return;
      }

      if (planned.executionType === "status_snapshot") {
        const snapshot = await loadStatusSnapshot();
        const result = { ...planned, executedAction: "Pulled live status snapshot", result: snapshot };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        setCommand("");
        return;
      }

      if (planned.executionType === "queue_prompt") {
        const prompt = planned.prompt || buildImplementationPrompt(planned.command);
        const taskId = await queueOperatorTask(planned.command, prompt);
        const result = {
          ...planned,
          executedAction: taskId ? "Queued implementation task and prompt" : "Generated implementation prompt",
          result: taskId ? `Task ${taskId} queued for execution.\n\n${prompt}` : prompt,
          taskId,
          prompt,
        };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        setCommand("");
        return;
      }

      if (planned.executionType === "advanced_sql") {
        setPendingConfirmation(planned);
        setHistory((prev) => [planned, ...prev].slice(0, 12));
        return;
      }

      const result = { ...planned, executedAction: "Logged request", result: "I understood the request but need a more specific operator path." };
      setHistory((prev) => [result, ...prev].slice(0, 12));
    } catch (error: any) {
      const failed = {
        ...planned,
        executedAction: "Execution failed",
        result: error?.message || "Unknown execution failure",
      };
      setHistory((prev) => [failed, ...prev].slice(0, 12));
      toast.error(failed.result);
    } finally {
      setRunning(false);
    }
  }, [navigate]);

  const runOperatorCommand = useCallback(async () => {
    if (!command.trim()) return;
    const planned = planOperatorCommand(command);
    if (planned.requiresConfirmation) {
      setPendingConfirmation(planned);
      setHistory((prev) => [planned, ...prev].slice(0, 12));
      return;
    }
    await executePlannedCommand(planned);
  }, [command, executePlannedCommand]);

  const runSql = useCallback(async () => {
    setSqlError(null);
    setRows(null);
    if (isMutatingSql) {
      const ok = await askConfirm({
        title: "This SQL will mutate the database.",
        description: (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">
            {sqlQuery.slice(0, 400)}
          </pre>
        ),
        confirmText: "Run mutation",
        tone: "danger",
      });
      if (!ok) return;
    }
    setRunning(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-sql", {
        body: { query: sqlQuery },
      });
      if (fnErr) throw fnErr;
      const payload = data as { ok?: boolean; rows?: RowMap[]; error?: string; rowCount?: number };
      if (!payload?.ok) throw new Error(payload?.error ?? "unknown error");
      setRows(payload.rows ?? []);
      toast.success(`${payload.rowCount ?? payload.rows?.length ?? 0} rows`);
    } catch (error: any) {
      setSqlError(error?.message ?? String(error));
      toast.error("SQL query failed");
    } finally {
      setRunning(false);
    }
  }, [isMutatingSql, sqlQuery]);

  const copyRows = () => {
    if (!rows) return;
    navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const headers = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  const quickPrompts = useMemo(() => [
    "Refresh AgentLink and rebuild the leaderboard",
    "Show me today's live numbers",
    "Open CRM",
    "Run the system health check",
    "Fix the homepage trust copy and remove fake metrics",
  ], []);

  return (
    <GlassCard className="space-y-4 border-emerald-500/30 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-emerald-400" />
          <h3 className="text-base font-bold uppercase tracking-wide text-white">Control Terminal</h3>
          <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-200">Prompt operator</Badge>
        </div>
      </div>

      <Tabs defaultValue="operator" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="operator">Prompt Operator</TabsTrigger>
          <TabsTrigger value="sql">Advanced SQL</TabsTrigger>
        </TabsList>

        <TabsContent value="operator" className="space-y-4">
          <div className="rounded-md border border-emerald-500/20 bg-white dark:bg-slate-950/60 p-4">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-emerald-200">Type what you want done</p>
            <textarea
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-emerald-500/20 bg-white dark:bg-slate-950/70 p-3 font-mono text-xs text-emerald-100 focus:border-emerald-400 focus:outline-none md:text-sm"
              placeholder="Examples: refresh the leaderboard, open CRM, show me today's numbers, fix the homepage trust copy"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-full border border-emerald-500/20 px-3 py-1 text-xs text-emerald-100 transition hover:border-emerald-400"
                  onClick={() => setCommand(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end">
              <Button onClick={runOperatorCommand} disabled={running || !command.trim()} className="bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run
              </Button>
            </div>
          </div>

          {pendingConfirmation && (
            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-semibold">Confirmation required</span>
              </div>
              <p className="text-sm text-amber-100">{pendingConfirmation.plannedAction}</p>
              <p className="mt-1 text-xs text-amber-200/80">{pendingConfirmation.why}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    const action = pendingConfirmation;
                    setPendingConfirmation(null);
                    await executePlannedCommand(action);
                  }}
                >
                  Confirm
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingConfirmation(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-300" />
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recent results</p>
            </div>
            {history.length === 0 ? (
              <div className="rounded-md border border-border/40 bg-background/40 p-4 text-sm text-muted-foreground">
                No operator actions yet. Run a sync, open a workflow, or queue a website change prompt.
              </div>
            ) : (
              history.map((item) => (
                <div key={`${item.createdAt}-${item.command}`} className="rounded-md border border-border/40 bg-background/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{item.executionType}</Badge>
                    {item.taskId && <Badge variant="secondary">Task {item.taskId}</Badge>}
                    {item.requiresConfirmation && <Badge variant="secondary">Confirmation</Badge>}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{item.command}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.result}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Why: {item.why}</p>
                  {item.prompt && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await navigator.clipboard.writeText(item.prompt || "");
                          toast.success("Prompt copied");
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copy prompt
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="sql" className="space-y-4">
          <div className="flex items-center gap-2">
            {isMutatingSql && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-300">
                <AlertTriangle className="h-3 w-3" /> mutating
              </span>
            )}
          </div>
          <textarea
            value={sqlQuery}
            onChange={(event) => setSqlQuery(event.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-emerald-500/20 bg-white dark:bg-slate-950/70 p-3 font-mono text-xs text-emerald-200 focus:border-emerald-400 focus:outline-none md:text-sm"
            placeholder="paste SQL — e.g. select * from deals where posted_at >= now() - interval '24 hours' limit 20"
          />

          <div className="flex justify-end">
            <Button onClick={runSql} disabled={running} className="bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400">
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run SQL
            </Button>
          </div>

          {sqlError && (
            <div className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-950/40 p-3 font-mono text-xs text-red-300">
              {sqlError}
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
                <Button variant="ghost" size="sm" onClick={copyRows} className="h-7 text-xs text-slate-600 dark:text-slate-300 hover:text-white">
                  {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />} copy json
                </Button>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border border-emerald-500/20">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900 text-[10px] uppercase tracking-wider text-emerald-300">
                    <tr>{headers.map((header) => <th key={header} className="border-b border-emerald-500/20 px-3 py-2 text-left">{header}</th>)}</tr>
                  </thead>
                  <tbody className="font-mono text-slate-700 dark:text-slate-200">
                    {rows.slice(0, 200).map((row, index) => (
                      <tr key={index} className={index % 2 === 0 ? "bg-white dark:bg-slate-950/50" : "bg-white dark:bg-slate-900/50"}>
                        {headers.map((header) => {
                          const value = row[header];
                          const text = value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
                          return <td key={header} className="max-w-xs truncate border-b border-slate-200 dark:border-slate-800 px-3 py-1.5" title={text}>{text}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rows && rows.length === 0 && (
            <div className="text-xs italic text-slate-400">query returned 0 rows</div>
          )}
        </TabsContent>
      </Tabs>
    </GlassCard>
  );
}
