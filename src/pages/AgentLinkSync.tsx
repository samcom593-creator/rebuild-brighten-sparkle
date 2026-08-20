import { useEffect, useState } from "react";
import { Link2, Loader2, CheckCircle2, AlertCircle, Download, Eye, EyeOff, Save, Zap, History, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";

type SyncLog = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error" | "no_cookie" | "empty" | "stuck";
  upstream_status: number | null;
  policies_seen: number | null;
  deals_inserted: number | null;
  deals_updated: number | null;
  error_message: string | null;
};

function ageLabel(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const minutes = Math.round(Math.max(0, Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function AgentLinkSync() {
  const { user } = useAuth();
  const [cookie, setCookie] = useState("");
  const [showCookie, setShowCookie] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [cookieSet, setCookieSet] = useState(false);

  const loadStatus = async () => {
    const { data: logRows } = await supabase
      .from("agentlink_sync_log" as any)
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);
    setLogs((logRows as unknown as SyncLog[]) ?? []);
    const { data: setting } = await supabase
      .from("system_settings" as any)
      .select("value")
      .eq("key", "agent_link_session_cookie")
      .maybeSingle();
    setCookieSet(!!(setting as any)?.value);
  };
  useEffect(() => { loadStatus(); }, []);

  const save = async () => {
    if (cookie.trim().length < 20) { toast.error("Paste the Agent Link cookie first"); return; }
    if (!user?.id) { toast.error("Not signed in"); return; }
    setLoading(true);
    try {
      // Filter on user_id, not profile_id. After Path B migration profile_id
      // (FK into profiles.id) and the auth uid have diverged for some rows;
      // user_id is the canonical auth linkage. Same fix shipped in the
      // 20260504093000_fix_agent_user_rls migration.
      const { data: agent } = await supabase
        .from("agents").select("id").eq("user_id", user.id).maybeSingle();
      if (!agent?.id) { toast.error("Your user has no agent record — ask an admin to link you"); return; }

      const { error: e1 } = await supabase.from("system_settings" as any).upsert(
        { key: "agent_link_session_cookie", value: cookie.trim() }, { onConflict: "key" });
      const { error: e2 } = await supabase.from("system_settings" as any).upsert(
        { key: "agent_link_live_agent_id", value: agent.id }, { onConflict: "key" });
      if (e1 || e2) { toast.error((e1 ?? e2)!.message); return; }

      toast.success("Cookie saved — live pull will use this on the next sync");
      setCookieSet(true);
      setCookie("");
      loadStatus();
    } finally { setLoading(false); }
  };

  const runNow = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agentlink-cookie-sync", { body: {} });
      if (error) { toast.error(error.message); return; }
      const row = data as any;
      if (row?.ok) toast.success(`Pulled ${row.policies_seen} policies · inserted ${row.deals_inserted} · updated ${row.deals_updated}`);
      else if (row?.policies_seen === 0) toast.info("Empty book from Agent Link (nothing to import)");
      else toast.error(row?.error ?? "Sync failed");
      loadStatus();
    } finally { setLoading(false); }
  };

  // For status card: use the most recent completed run (ignore stuck/running noise)
  const latestOk = logs.find(l => l.status === "ok");
  const latest = logs[0];
  const latestAt = latestOk?.finished_at ?? latestOk?.started_at ?? null;
  const latestAgeMinutes = latestAt ? Math.round((Date.now() - new Date(latestAt).getTime()) / 60_000) : null;
  const isStale = latestAgeMinutes === null || latestAgeMinutes > 360 || !latestOk;
  const writes = Number(latestOk?.deals_inserted ?? 0) + Number(latestOk?.deals_updated ?? 0);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        accent="blue"
        eyebrow="Admin · Sync"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="AgentLink Live Sync"
        subtitle="Paste your AgentLink cookie once. The Edge sync pulls and routes your full book automatically every minute."
        actions={
          cookieSet
            ? <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40"><Zap className="h-3 w-3 mr-1" /> Live</Badge>
            : <Badge variant="outline" className="border-rose-500/40 text-rose-300">Not configured</Badge>
        }
      />

      <GlassCard className={`p-4 ${isStale ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {isStale ? <AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />}
            <div>
              <p className="text-sm font-semibold">
                {isStale ? "AgentLink data needs review" : "AgentLink is fresh"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last sync: {latestOk?.status ?? "no run"} · {ageLabel(latestAt)} · {latestOk?.policies_seen ?? 0} policies seen · {writes} deal writes.
              </p>
              {latest?.status === "stuck" && (
                <p className="mt-1 text-xs text-amber-300/70">Last attempt timed out — sync is auto-retrying</p>
              )}
            </div>
          </div>
          <Badge variant={isStale ? "outline" : "default"} className="w-fit">
            <Clock className="mr-1 h-3 w-3" />
            Source of truth
          </Badge>
        </div>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <div className="text-sm font-semibold">1 · Grab the cookie</div>
        <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
          <li>Open <a href="https://agentlink.insuracloud.ai/" target="_blank" rel="noopener noreferrer" className="text-primary underline">agentlink.insuracloud.ai</a> (signed in)</li>
          <li>DevTools (<span className="font-mono">⌘⌥I</span>/<span className="font-mono">F12</span>) → <b>Application</b> → <b>Cookies</b> → select all → copy</li>
          <li>Or: Network tab → any request → <i>Copy as cURL</i> → grab the <span className="font-mono">Cookie:</span> header</li>
        </ol>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">2 · Paste & save</div>
          <Button size="sm" variant="ghost" onClick={() => setShowCookie(v => !v)}>
            {showCookie ? <EyeOff className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
            {showCookie ? "Hide" : "Show"}
          </Button>
        </div>
        <Textarea
          value={cookie}
          onChange={e => setCookie(e.target.value)}
          rows={4}
          placeholder="connect.sid=s%3Axyz...; csrf=abc...; session=..."
          className="font-mono text-xs"
          style={showCookie ? undefined : { WebkitTextSecurity: "disc" } as React.CSSProperties}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} size="sm" disabled={loading || cookie.trim().length < 20}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save & enable live pull
          </Button>
          <Button onClick={runNow} size="sm" variant="outline" disabled={loading || !cookieSet}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Run now
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Cookie is stored in your project's <span className="font-mono">system_settings</span> (service-role only).
          Live pull runs through the secure Edge sync and writes one audit row per run.
        </div>
      </GlassCard>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 text-sm font-semibold flex items-center gap-2">
          <History className="h-4 w-4" /> Recent syncs
        </div>
        {logs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">No runs yet — click "Run now" after saving a cookie</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left px-3 py-2">Started</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Seen</th>
                <th className="text-right px-3 py-2">New</th>
                <th className="text-right px-3 py-2">Upd</th>
                <th className="text-left px-3 py-2">HTTP</th>
                <th className="text-left px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-t border-border/20">
                  <td className="px-3 py-1.5 text-muted-foreground">{new Date(l.started_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    {l.status === "ok"        && <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />ok</span>}
                    {l.status === "error"     && <span className="text-rose-400 inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" />error</span>}
                    {l.status === "empty"     && <span className="text-amber-400">empty</span>}
                    {l.status === "no_cookie" && <span className="text-muted-foreground">no cookie</span>}
                    {l.status === "running"   && <span className="text-info inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />running</span>}
                    {l.status === "stuck"     && <span className="text-muted-foreground/60">timed out</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.policies_seen ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">{l.deals_inserted ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-info">{l.deals_updated ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{l.upstream_status ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-rose-300 max-w-[240px] truncate" title={l.error_message ?? undefined}>
                    {l.error_message ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}
