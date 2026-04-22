import { useState } from "react";
import { Link2, Loader2, CheckCircle2, AlertCircle, Download, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type SyncResult = {
  ok?: boolean;
  policies_seen?: number;
  deals_inserted?: number;
  deals_skipped?: number;
  errors?: string[];
  note?: string;
  me?: unknown;
  error?: string;
  hint?: string;
  upstream_status?: number;
  upstream_body?: string;
};

export default function AgentLinkSync() {
  const [cookie, setCookie] = useState("");
  const [showCookie, setShowCookie] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const run = async (dryRun: boolean) => {
    if (cookie.trim().length < 20) {
      toast.error("Paste the Agent Link session cookie first");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("agentlink-cookie-sync", {
        body: { cookie: cookie.trim(), dry_run: dryRun },
      });
      if (error) {
        const ctx = (error as any).context;
        let body: SyncResult = { error: error.message };
        try { if (ctx) body = await ctx.json(); } catch {}
        setResult(body);
        toast.error(body.error ?? error.message);
      } else {
        setResult(data as SyncResult);
        const d = data as SyncResult;
        if (dryRun) toast.success(`Dry run: ${d.policies_seen ?? 0} policies found`);
        else        toast.success(`Imported ${d.deals_inserted ?? 0} deals`);
      }
    } catch (e: any) {
      setResult({ error: e?.message ?? "Request failed" });
      toast.error(e?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-blue-500/20 flex items-center justify-center">
          <Link2 className="h-6 w-6 text-indigo-300" />
        </div>
        <div>
          <h1 className="apex-headline text-3xl font-bold">Agent Link Sync</h1>
          <p className="text-sm text-muted-foreground">
            Pull your Agent Link book-of-business using session cookie auth (API-token path is broken upstream).
          </p>
        </div>
      </div>

      <GlassCard className="p-4 space-y-3">
        <div className="text-sm font-semibold">Step 1 · Grab the cookie</div>
        <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
          <li>Open <a href="https://agentlink.insuracloud.ai/" target="_blank" rel="noreferrer" className="text-primary underline">agentlink.insuracloud.ai</a> in a new tab and sign in</li>
          <li>Open DevTools (<span className="font-mono">⌘⌥I</span> / <span className="font-mono">F12</span>) → <b>Application</b> (or <b>Storage</b>) → <b>Cookies</b> → <span className="font-mono">https://agentlink.insuracloud.ai</span></li>
          <li>Select all cookies (<span className="font-mono">⌘A</span> inside the cookie list) → copy → paste below</li>
          <li>Alternative: <b>Network</b> tab → any XHR request → right-click → <i>Copy as cURL</i> → extract the <span className="font-mono">Cookie:</span> header value</li>
        </ol>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Step 2 · Paste the cookie</div>
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
          className={"font-mono text-xs " + (showCookie ? "" : "text-transparent caret-primary selection:bg-primary/30")}
          style={showCookie ? undefined : { WebkitTextSecurity: "disc" } as React.CSSProperties}
        />
        <div className="text-[10px] text-muted-foreground">
          Cookie is sent only to your own Supabase project; never logged, never committed.
        </div>
      </GlassCard>

      <GlassCard className="p-4 space-y-3">
        <div className="text-sm font-semibold">Step 3 · Import</div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(true)} variant="outline" size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
            Dry run (preview)
          </Button>
          <Button onClick={() => run(false)} size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Import all
          </Button>
        </div>
      </GlassCard>

      {result && (
        <GlassCard className={"p-4 space-y-2 text-sm " + (result.error ? "border border-rose-500/40 bg-rose-500/5" : "")}>
          <div className="flex items-center gap-2">
            {result.error
              ? <><AlertCircle className="h-4 w-4 text-rose-400" /><span className="font-semibold text-rose-300">Error</span></>
              : <><CheckCircle2 className="h-4 w-4 text-emerald-400" /><span className="font-semibold text-emerald-300">Success</span></>}
          </div>
          {result.error && (
            <>
              <div className="text-rose-200">{result.error}</div>
              {result.hint && <div className="text-xs text-rose-300/80">💡 {result.hint}</div>}
              {result.upstream_status && <div className="text-xs text-muted-foreground">Upstream: HTTP {result.upstream_status}</div>}
              {result.upstream_body && <pre className="text-[10px] bg-black/30 p-2 rounded overflow-x-auto">{result.upstream_body}</pre>}
            </>
          )}
          {!result.error && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Policies seen: {result.policies_seen ?? 0}</Badge>
              {result.dry_run === undefined && <Badge variant="outline">Inserted: {result.deals_inserted ?? 0}</Badge>}
              {result.deals_skipped ? <Badge variant="outline">Skipped: {result.deals_skipped}</Badge> : null}
              {result.errors && result.errors.length > 0 && <Badge variant="outline" className="border-rose-400 text-rose-300">Errors: {result.errors.length}</Badge>}
            </div>
          )}
          {result.note && <div className="text-xs text-muted-foreground">{result.note}</div>}
          {result.errors && result.errors.length > 0 && (
            <pre className="text-[10px] bg-black/30 p-2 rounded overflow-x-auto max-h-40">
              {result.errors.slice(0, 20).join("\n")}
            </pre>
          )}
        </GlassCard>
      )}
    </div>
  );
}
