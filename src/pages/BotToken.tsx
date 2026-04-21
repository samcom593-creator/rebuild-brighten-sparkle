import { useState, useEffect } from "react";
import { Bot, Copy, KeyRound, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Dedicated one-purpose page at /bot-token (and /dashboard/bot-token).
 * Shows the apex_bot_token plainly in one giant box with copy + rotate.
 * Admin-only. Exists because users got lost on /dashboard/integrations
 * scrolling past multiple cards.
 */
export default function BotToken() {
  const { isAdmin } = useAuth();
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("system_settings" as any)
      .select("value")
      .eq("key", "apex_bot_token")
      .maybeSingle();
    setToken((data as any)?.value ?? "");
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const copy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success("Token copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const fresh = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

      // Try RPC first (preferred — defined as SECURITY DEFINER in some envs)
      const { error: rpcErr } = await supabase.rpc("admin_configure_integration" as any, {
        p_key: "apex_bot_token",
        p_value: fresh,
      });

      // RPC not available → fall back to direct table upsert. Admin RLS
      // on system_settings lets authenticated admins write.
      if (rpcErr && /Could not find the function|schema cache/i.test(rpcErr.message || "")) {
        const { error: upErr } = await supabase
          .from("system_settings" as any)
          .upsert({ key: "apex_bot_token", value: fresh }, { onConflict: "key" });
        if (upErr) throw upErr;
      } else if (rpcErr) {
        throw rpcErr;
      }

      setToken(fresh);
      toast.success("New token generated");
    } catch (e: any) {
      toast.error(e?.message ?? "Rotation failed");
    } finally {
      setRotating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <GlassCard className="p-6 max-w-md text-center">
          <p className="text-sm text-muted-foreground">Admin access required.</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 flex flex-col items-center justify-start gap-6 pt-16">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-2xl bg-primary/20 flex items-center justify-center">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="apex-headline text-3xl md:text-4xl font-bold">Bot SQL Token</h1>
          <p className="text-sm text-muted-foreground">Paste this into your Claude chat to unlock remote SQL.</p>
        </div>
      </div>

      <GlassCard className="w-full max-w-2xl p-8 border-2 border-primary/50 bg-gradient-to-br from-primary/10 via-violet-500/5 to-amber-500/10 win-glow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Current bearer token</h2>
          </div>
          <Badge variant="outline" className={cn(
            "text-xs",
            token
              ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/20"
              : "border-amber-500/50 text-amber-300 bg-amber-500/20",
          )}>
            {loading ? "…" : token ? "● ACTIVE" : "⚠ NOT SET"}
          </Badge>
        </div>

        {loading ? (
          <div className="h-16 bg-muted/20 rounded-lg animate-pulse" />
        ) : token ? (
          <>
            <div
              className="bg-background/60 border border-primary/30 rounded-lg p-4 font-mono text-sm md:text-base break-all select-all cursor-text select-text"
              title="Click to select all"
            >
              {token}
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={copy} className="flex-1 gap-2" size="lg">
                {copied ? <CheckCircle2 className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? "Copied!" : "Copy token"}
              </Button>
              <Button
                variant="outline"
                onClick={rotate}
                disabled={rotating}
                className="gap-2"
                size="lg"
                title="Generate a new token (invalidates the current one)"
              >
                {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Rotate
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Anyone holding this token can run SQL against your database. Rotate if shared in the wrong chat.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">No token configured yet. Click below to generate one.</p>
            <Button onClick={rotate} disabled={rotating} className="w-full gap-2" size="lg">
              {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Generate Token
            </Button>
          </>
        )}
      </GlassCard>

      <GlassCard className="w-full max-w-2xl p-5 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground mb-2">Endpoint</p>
        <code className="block bg-background/60 border border-border/40 rounded p-2 font-mono text-[11px] break-all">
          https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/bot-sql
        </code>
        <p className="font-semibold text-foreground mt-4 mb-2">Usage</p>
        <code className="block bg-background/60 border border-border/40 rounded p-2 font-mono text-[11px] leading-relaxed whitespace-pre">{`POST ${"${endpoint}"}
Authorization: Bearer <token above>
Content-Type: application/json
Body: { "query": "SELECT 1" }`}</code>
      </GlassCard>
    </div>
  );
}
