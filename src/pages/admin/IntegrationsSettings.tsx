import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  MessageSquare, CheckCircle, XCircle, Loader2, Save, Zap,
  Terminal, Copy, ExternalLink, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DISCORD_KEY = "discord_webhook_url";

const SETUP_SQL = `-- Run this in Supabase SQL Editor to activate all features:

-- 1. Set Discord webhook
UPDATE public.system_settings
SET value = 'YOUR_WEBHOOK_URL'
WHERE key = 'discord_webhook_url';

-- 2. Set service role key (Project Settings → API → service_role)
ALTER DATABASE postgres SET "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY';

-- 3. Enable Realtime on applications table
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;`;

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />;
  return (
    <div className={cn("h-2 w-2 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} />
  );
}

export default function IntegrationsSettings() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [webhookDraft, setWebhookDraft] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");

  const { data: currentWebhook = "", isLoading } = useQuery<string>({
    queryKey: ["system_settings", DISCORD_KEY],
    enabled: !!isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings" as any)
        .select("value")
        .eq("key", DISCORD_KEY)
        .maybeSingle();
      const val = (data as any)?.value ?? "";
      if (val && !webhookDraft) setWebhookDraft(val);
      return val;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.rpc("admin_configure_integration" as any, {
        p_key: DISCORD_KEY,
        p_value: url,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Discord webhook saved!");
      queryClient.invalidateQueries({ queryKey: ["system_settings", DISCORD_KEY] });
    },
    onError: (err: any) => {
      if (err?.message?.includes("Could not find the function")) {
        toast.error("Run SETUP.sql in Supabase SQL Editor first — RPC not yet deployed.");
      } else {
        toast.error(err?.message ?? "Failed to save webhook");
      }
    },
  });

  async function handleTest() {
    const url = webhookDraft || currentWebhook;
    if (!url) {
      toast.error("Enter a webhook URL first");
      return;
    }
    setTestStatus("loading");
    setTestMsg("");
    try {
      const { error } = await supabase.functions.invoke("discord-webhook-notify", {
        body: {
          event_type: "stage_change",
          agent_name: "Test Agent",
          details: {
            from_stage: "unlicensed",
            to_stage: "course_purchased",
            email: "test@apex-financial.org",
            recruiter: "Sam James",
          },
        },
      });
      if (error) throw error;
      setTestStatus("ok");
      setTestMsg("Test message sent to Discord!");
      toast.success("Discord test notification sent!");
    } catch (err: any) {
      setTestStatus("error");
      setTestMsg(err?.message ?? "Unknown error");
      toast.error("Discord test failed: " + (err?.message ?? "Unknown error"));
    }
  }

  const webhookActive = !!currentWebhook && currentWebhook.length > 20;
  const hasRpc = true; // optimistic; save will surface the error if not

  if (!isAdmin) {
    return (
      <div className="p-8 text-muted-foreground text-sm">Admin access required.</div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto py-6 px-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Discord, Realtime, and automation services
        </p>
      </div>

      {/* ── Discord Webhook ──────────────────────────────────────────────────── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-indigo-400" />
              <CardTitle className="text-base">Discord Notifications</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot ok={isLoading ? null : webhookActive} />
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  webhookActive
                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                    : "border-amber-500/30 text-amber-400 bg-amber-500/10"
                )}
              >
                {webhookActive ? "Active" : "Not configured"}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            Stage changes, new applicants, deals, milestones — all fire to Discord automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                value={webhookDraft}
                onChange={(e) => setWebhookDraft(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="font-mono text-xs h-9"
              />
              <Button
                size="sm"
                className="h-9 shrink-0"
                disabled={saveMutation.isPending || !webhookDraft}
                onClick={() => saveMutation.mutate(webhookDraft)}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={testStatus === "loading"}
              onClick={handleTest}
            >
              {testStatus === "loading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : testStatus === "ok" ? (
                <CheckCircle className="h-3 w-3 text-emerald-400" />
              ) : testStatus === "error" ? (
                <XCircle className="h-3 w-3 text-red-400" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              Send test message
            </Button>
            {testMsg && (
              <span className={cn(
                "text-xs",
                testStatus === "ok" ? "text-emerald-400" : "text-red-400"
              )}>
                {testMsg}
              </span>
            )}
          </div>

          {!webhookActive && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300 space-y-1">
              <p className="font-medium">Discord not configured yet</p>
              <p>Enter the webhook URL above, then click Save. Or run the SQL setup below.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SQL Setup Helper ─────────────────────────────────────────────────── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-sky-400" />
            <CardTitle className="text-base">First-Time SQL Setup</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Run this once in{" "}
            <a
              href="https://supabase.com/dashboard/project/msydzhzolwourcdmqxvn/sql/new"
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline inline-flex items-center gap-0.5"
            >
              Supabase SQL Editor <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {" "}to activate triggers + automation jobs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="text-[10px] bg-muted/40 rounded-lg p-3 overflow-auto max-h-56 text-muted-foreground font-mono whitespace-pre-wrap">
              {SETUP_SQL}
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6"
              onClick={() => {
                navigator.clipboard.writeText(SETUP_SQL);
                toast.success("SQL copied to clipboard!");
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Replace <code className="bg-muted px-1 rounded">YOUR_SERVICE_ROLE_KEY</code> with your key from
            Supabase → Project Settings → API.
          </p>
        </CardContent>
      </Card>

      {/* ── GitHub CI ──────────────────────────────────────────────────────────── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-violet-400" />
            <CardTitle className="text-base">Auto-Deploy (GitHub CI)</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Once configured, all code pushes auto-deploy to Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>Add these secrets to your GitHub repo:</p>
          <div className="space-y-1 font-mono bg-muted/30 rounded-lg p-3">
            <div>
              <span className="text-primary">SUPABASE_ACCESS_TOKEN</span>
              {" "}— from supabase.com/dashboard/account/tokens
            </div>
            <div>
              <span className="text-primary">SUPABASE_DB_PASSWORD</span>
              {" "}— from Supabase → Project Settings → Database
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <a
              href="https://supabase.com/dashboard/account/tokens"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                Get Access Token <ExternalLink className="h-2.5 w-2.5" />
              </Button>
            </a>
            <a
              href="https://github.com/samcom593-creator/rebuild-brighten-sparkle/settings/secrets/actions"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                Add GitHub Secrets <ExternalLink className="h-2.5 w-2.5" />
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
