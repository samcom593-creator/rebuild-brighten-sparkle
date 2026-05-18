// ReadyModeIntegration — operator surface for the dialer sync.
//
// Until Sam drops API credentials into system_settings, this page shows
// "awaiting credentials" + the connection form. Once enabled, it surfaces:
//   - Today's call feed (v_readymode_today)
//   - Per-agent dial activity (v_readymode_agent_today)
//   - Last sync timestamp + recent errors (readymode_sync_log)
//   - Manual "Sync now" button
//
// Recording playback uses native HTML5 <audio> once recording_url comes back.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Phone, RefreshCw, Settings, PlayCircle, CheckCircle2, XCircle,
  AlertCircle, Activity, Clock, Headphones, Loader2,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface Setting { key: string; value: string; updated_at: string; }
interface CallRow {
  id: string;
  external_call_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  campaign_name: string | null;
  lead_phone: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  disposition: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  call_started_at: string | null;
  matched_lead_id: string | null;
  matched_application_id: string | null;
}
interface AgentRow {
  agent_id: string | null;
  agent_name: string;
  calls_today: number;
  connects: number;
  voicemails: number;
  no_answers: number;
  hours_called: number | string;
  last_call_at: string | null;
}
interface SyncLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  pulled_count: number | null;
  inserted_count: number | null;
  matched_count: number | null;
  error_message: string | null;
}

const SETTING_KEYS = [
  "readymode_api_base_url",
  "readymode_api_key",
  "readymode_account_id",
  "readymode_sync_enabled",
];

export default function ReadyModeIntegration() {
  usePageTitle("ReadyMode · APEX");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const settings = useQuery({
    queryKey: ["readymode-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value, updated_at")
        .in("key", SETTING_KEYS);
      if (error) throw error;
      return (data ?? []) as Setting[];
    },
  });

  const calls = useQuery({
    queryKey: ["readymode-today"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_readymode_today" as any)
        .select("*")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as CallRow[];
    },
  });

  const agents = useQuery({
    queryKey: ["readymode-agents-today"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_readymode_agent_today" as any)
        .select("*")
        .order("calls_today", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AgentRow[];
    },
  });

  const syncLogs = useQuery({
    queryKey: ["readymode-sync-log"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("readymode_sync_log" as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as SyncLog[];
    },
  });

  const settingsByKey = useMemo(() => {
    const m: Record<string, Setting> = {};
    for (const s of settings.data ?? []) m[s.key] = s;
    return m;
  }, [settings.data]);

  const syncEnabled = settingsByKey.readymode_sync_enabled?.value === "true";
  const hasCredentials = !!settingsByKey.readymode_api_base_url?.value && !!settingsByKey.readymode_api_key?.value;

  async function saveSettings() {
    setBusy(true);
    try {
      const updates = Object.entries(editValues).map(([key, value]) => ({
        key, value, updated_at: new Date().toISOString(),
      }));
      if (updates.length === 0) { toast.info("No changes"); return; }
      const { error } = await supabase
        .from("system_settings")
        .upsert(updates, { onConflict: "key" });
      if (error) throw error;
      toast.success(`Saved ${updates.length} setting(s)`);
      setEditValues({});
      qc.invalidateQueries({ queryKey: ["readymode-settings"] });
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("readymode-sync");
      if (error) throw error;
      const d = data as { ok?: boolean; pulled?: number; inserted?: number; matched?: number; error?: string; skipped?: boolean };
      if (d?.skipped) toast.info("Sync is disabled — flip readymode_sync_enabled to 'true' first");
      else if (d?.ok) toast.success(`Synced ${d.pulled ?? 0} calls · ${d.inserted ?? 0} new · ${d.matched ?? 0} matched to agents`);
      else toast.error(`Sync failed: ${d?.error ?? "unknown"}`);
      qc.invalidateQueries({ queryKey: ["readymode-today"] });
      qc.invalidateQueries({ queryKey: ["readymode-agents-today"] });
      qc.invalidateQueries({ queryKey: ["readymode-sync-log"] });
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  }

  const lastSync = syncLogs.data?.find((l) => l.status === "ok");
  const lastError = syncLogs.data?.find((l) => l.status === "error");

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Integration · Dialer"
        eyebrowIcon={<Phone className="h-3 w-3" />}
        title="ReadyMode Sync"
        subtitle={hasCredentials && syncEnabled
          ? <>Live · pulling dialer calls every 5 minutes. Last successful sync {lastSync?.finished_at ? formatDistanceToNow(parseISO(lastSync.finished_at), { addSuffix: true }) : "—"}</>
          : <>Awaiting credentials. Drop the ReadyMode API key + base URL below, set <span className="font-mono">readymode_sync_enabled=true</span>, then hit Sync now.</>}
        accent="cyan"
        actions={
          <Button onClick={syncNow} disabled={busy} variant="outline" size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Sync now
          </Button>
        }
      />

      {/* Connection status */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatusTile
          label="Credentials"
          status={hasCredentials ? "ok" : "missing"}
          okText="Present"
          errText="Missing"
        />
        <StatusTile
          label="Sync enabled"
          status={syncEnabled ? "ok" : "missing"}
          okText="ON"
          errText="OFF"
        />
        <StatusTile
          label="Last sync"
          status={lastSync ? "ok" : "missing"}
          okText={lastSync?.finished_at ? formatDistanceToNow(parseISO(lastSync.finished_at), { addSuffix: true }) : "—"}
          errText="Never"
        />
        <StatusTile
          label="Calls today"
          status={(calls.data?.length ?? 0) > 0 ? "ok" : "missing"}
          okText={`${calls.data?.length ?? 0}`}
          errText="0"
        />
      </div>

      {lastError && (
        <GlassCard className="p-4 border-l-4 border-rose-500">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-rose-500 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-rose-500 dark:text-rose-400">Last sync error</p>
              <p className="text-muted-foreground mt-1">{lastError.error_message ?? "unknown"}</p>
              <p className="text-xs text-muted-foreground mt-1">{format(parseISO(lastError.started_at), "PPp")}</p>
            </div>
          </div>
        </GlassCard>
      )}

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings"><Settings className="h-3.5 w-3.5 mr-1.5" /> Settings</TabsTrigger>
          <TabsTrigger value="calls"><Phone className="h-3.5 w-3.5 mr-1.5" /> Today's calls <Badge variant="outline" className="ml-1">{calls.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="agents"><Activity className="h-3.5 w-3.5 mr-1.5" /> Per-agent <Badge variant="outline" className="ml-1">{agents.data?.length ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="logs"><Clock className="h-3.5 w-3.5 mr-1.5" /> Sync log</TabsTrigger>
        </TabsList>

        {/* SETTINGS */}
        <TabsContent value="settings" className="mt-4 space-y-3">
          <GlassCard className="p-5 space-y-3">
            {SETTING_KEYS.map((k) => {
              const current = settingsByKey[k]?.value ?? "";
              const isSecret = k.includes("key");
              return (
                <div key={k}>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{k}</Label>
                  <Input
                    type={isSecret ? "password" : "text"}
                    value={editValues[k] ?? current}
                    onChange={(e) => setEditValues((p) => ({ ...p, [k]: e.target.value }))}
                    placeholder={isSecret ? "••••••••" : k === "readymode_sync_enabled" ? "true / false" : "(value)"}
                    className="mt-1 font-mono text-sm"
                  />
                  {settingsByKey[k]?.updated_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      updated {formatDistanceToNow(parseISO(settingsByKey[k].updated_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="pt-3 border-t border-border/40 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditValues({})}>Reset</Button>
              <Button onClick={saveSettings} disabled={busy || Object.keys(editValues).length === 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save {Object.keys(editValues).length} change(s)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">
              ReadyMode endpoints + auth shape can vary by account tier. The edge function at
              <span className="font-mono"> supabase/functions/readymode-sync</span> assumes a
              <span className="font-mono"> GET /v1/calls?account_id=X&since=Y</span> response shape;
              if ReadyMode returns something different, swap the URL builder + the normalize() block
              and the rest of the pipeline keeps working.
            </p>
          </GlassCard>
        </TabsContent>

        {/* TODAY'S CALLS */}
        <TabsContent value="calls" className="mt-4 space-y-2">
          {calls.isLoading ? (
            <SkelList />
          ) : (calls.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Phone className="h-7 w-7" />}
              title="No calls synced today"
              description="Once credentials are in place and sync_enabled='true', calls land here as they happen."
              actions={<Button onClick={syncNow} disabled={busy}><RefreshCw className="h-4 w-4 mr-1.5" /> Sync now</Button>}
            />
          ) : (calls.data ?? []).map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.01, 0.2) }}
            >
              <GlassCard className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">
                      {[c.lead_first_name, c.lead_last_name].filter(Boolean).join(" ") || c.lead_phone || "(unknown)"}
                    </p>
                    {c.disposition && <Badge variant="outline" className="text-[10px]">{c.disposition}</Badge>}
                    {c.matched_application_id && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/40">App linked</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.agent_name ?? "(unassigned)"} · {c.campaign_name ?? "—"} · {c.lead_phone ?? "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.call_started_at ? format(parseISO(c.call_started_at), "h:mm a") : "—"}
                    {c.duration_seconds != null && <> · {Math.floor(c.duration_seconds / 60)}m {c.duration_seconds % 60}s</>}
                  </p>
                </div>
                {c.recording_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={c.recording_url} target="_blank" rel="noreferrer">
                      <Headphones className="h-3.5 w-3.5 mr-1" /> Listen
                    </a>
                  </Button>
                )}
              </GlassCard>
            </motion.div>
          ))}
        </TabsContent>

        {/* PER-AGENT */}
        <TabsContent value="agents" className="mt-4 space-y-2">
          {agents.isLoading ? <SkelList /> :
            (agents.data ?? []).length === 0 ? (
              <EmptyState icon={<Activity className="h-7 w-7" />} title="No dialer activity today" />
            ) : (agents.data ?? []).map((a, i) => (
              <motion.div key={a.agent_id ?? a.agent_name} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.01, 0.2) }}>
                <GlassCard className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{a.agent_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.calls_today} calls · {a.connects} connects · {a.voicemails} VM · {a.no_answers} NA
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold tabular-nums text-primary">{a.hours_called}h</p>
                    <p className="text-[10px] uppercase text-muted-foreground">dialed</p>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          }
        </TabsContent>

        {/* LOGS */}
        <TabsContent value="logs" className="mt-4 space-y-2">
          {syncLogs.isLoading ? <SkelList /> :
            (syncLogs.data ?? []).length === 0 ? (
              <EmptyState icon={<Clock className="h-7 w-7" />} title="No sync runs yet" />
            ) : (syncLogs.data ?? []).map((l) => (
              <GlassCard key={l.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {l.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
                     l.status === "error" ? <XCircle className="h-4 w-4 text-rose-500" /> :
                     <AlertCircle className="h-4 w-4 text-amber-500" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {l.status === "ok"
                          ? `Synced ${l.pulled_count ?? 0} pulled · ${l.inserted_count ?? 0} inserted · ${l.matched_count ?? 0} matched`
                          : l.error_message ?? "running…"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(parseISO(l.started_at), "PPp")}
                        {l.finished_at && <> · took {Math.round((parseISO(l.finished_at).getTime() - parseISO(l.started_at).getTime()) / 1000)}s</>}
                      </p>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))
          }
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkelList() {
  return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
}

function StatusTile({ label, status, okText, errText }: {
  label: string; status: "ok" | "missing"; okText: string; errText: string;
}) {
  const isOk = status === "ok";
  return (
    <GlassCard className="p-4 flex items-center justify-between">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
        <p className={`text-xl font-bold mt-1 ${isOk ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
          {isOk ? okText : errText}
        </p>
      </div>
      {isOk ? <CheckCircle2 className="h-7 w-7 text-emerald-500 opacity-70" /> : <AlertCircle className="h-7 w-7 text-rose-500 opacity-70" />}
    </GlassCard>
  );
}
