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
  Terminal, Copy, ExternalLink, RefreshCw, Bot, KeyRound
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DISCORD_KEY = "discord_webhook_url";

const SETUP_SQL = `-- ══════════════════════════════════════════════════════════════════════
-- APEX MASTER ACTIVATION — paste once, run once. Safe to re-run.
-- Applies every stuck migration: deal sync, plaque photos, avatars,
-- comp grid, Instagram inbox, team chat, overseer + morning-brief
-- crons, email-spam kill-list.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Discord webhook
INSERT INTO public.system_settings (key, value)
VALUES ('discord_webhook_url',
  'YOUR_DISCORD_WEBHOOK_URL')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. Service role key — replace with yours from Project Settings → API
-- ALTER DATABASE postgres SET "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY';

-- 3. Realtime
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;      EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;             EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.plaque_awards;     EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_production; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 4. Deal-sync schema
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'apex';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'submitted';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_deal_id text;
CREATE TABLE IF NOT EXISTS public.deal_sync_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL, direction text DEFAULT 'outbound',
  status text DEFAULT 'pending', attempts int DEFAULT 0, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), synced_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.deal_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid, event_type text, direction text,
  payload jsonb, response jsonb, error text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.deal_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sync_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents   ADD COLUMN IF NOT EXISTS insuracloud_user_id    int;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS insuracloud_carrier_id int;

-- 5. Plaque + storage bucket
ALTER TABLE public.plaque_awards ADD COLUMN IF NOT EXISTS custom_photo_url text;
ALTER TABLE public.plaque_awards ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE public.plaque_awards SET created_at = COALESCE(awarded_at, generated_at, now()) WHERE created_at IS NULL;
INSERT INTO storage.buckets (id, name, public) VALUES ('public', 'public', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
DROP POLICY IF EXISTS "authenticated_upload_plaque_photos" ON storage.objects;
CREATE POLICY "authenticated_upload_plaque_photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public' AND (storage.foldername(name))[1] = 'plaque-photos');
DROP POLICY IF EXISTS "public_read_plaque_photos" ON storage.objects;
CREATE POLICY "public_read_plaque_photos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'public');

-- 6. Auto-avatars for every profile missing one
UPDATE public.profiles p
SET avatar_url = 'https://ui-avatars.com/api/?name=' || REPLACE(COALESCE(p.full_name, 'Agent'), ' ', '+') ||
  '&background=' || CASE (ABS(HASHTEXT(p.id::text)) % 5) WHEN 0 THEN '0a0f1a' WHEN 1 THEN '0d1526' WHEN 2 THEN '1a1035' WHEN 3 THEN '0d2925' ELSE '1a1a2e' END ||
  '&color=' || CASE (ABS(HASHTEXT(p.id::text)) % 4) WHEN 0 THEN '22d3a5' WHEN 1 THEN 'f59e0b' WHEN 2 THEN '8b5cf6' ELSE '06b6d4' END ||
  '&size=512&bold=true&font-size=0.42&length=2&rounded=true'
WHERE (p.avatar_url IS NULL OR p.avatar_url = '') AND p.full_name IS NOT NULL AND LENGTH(p.full_name) > 0;

-- 7. Comp grid
CREATE TABLE IF NOT EXISTS public.agent_carrier_comp (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE,
  carrier_name text NOT NULL, contract_code text,
  contract_pct numeric(5,2), effective_pct numeric(5,2), override_pct numeric(5,2) DEFAULT 0,
  notes text, updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, carrier_name)
);
ALTER TABLE public.agent_carrier_comp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_manage_acc ON public.agent_carrier_comp;
CREATE POLICY admins_manage_acc ON public.agent_carrier_comp FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.carriers (name, is_active)
SELECT v.name, true FROM (VALUES
  ('American Amicable'),('American Home Life'),('Baltimore Life'),('Foresters'),
  ('Guarantee Trust Life'),('Mutual of Omaha'),('Newbridge'),('Prudential'),
  ('Royal Neighbors'),('SBLI'),('Transamerica')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.carriers c WHERE LOWER(c.name) = LOWER(v.name));

INSERT INTO public.agent_carrier_comp (agent_id, carrier_id, carrier_name, contract_pct, effective_pct, override_pct)
SELECT a.id, c.id, c.name,
  COALESCE(a.contract_percentage, 50)::numeric(5,2),
  COALESCE(a.contract_percentage, 50)::numeric(5,2),
  COALESCE(a.override_rate, 0)::numeric(5,2)
FROM public.agents a CROSS JOIN public.carriers c
WHERE a.is_deactivated = false AND a.is_inactive = false AND c.is_active = true
ON CONFLICT (agent_id, carrier_name) DO NOTHING;

-- 8. Meta + IG tables
CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL, reason text, status text DEFAULT 'pending',
  requested_at timestamptz DEFAULT now(), completed_at timestamptz,
  handled_by uuid, notes text
);
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_insert_deletion_requests ON public.data_deletion_requests;
CREATE POLICY public_insert_deletion_requests ON public.data_deletion_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.instagram_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL, instagram_user_id text NOT NULL,
  instagram_username text, access_token text NOT NULL,
  token_expires_at timestamptz, scopes text[] DEFAULT '{}',
  connected_at timestamptz DEFAULT now(), last_used_at timestamptz,
  UNIQUE(user_id, instagram_user_id)
);
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_own_instagram ON public.instagram_connections;
CREATE POLICY user_own_instagram ON public.instagram_connections FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.instagram_dm_threads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL, ig_user_id text NOT NULL,
  conversation_id text, username text, last_msg_at timestamptz,
  last_sender text, last_msg_preview text, bucket text DEFAULT 'stale',
  outreach_status text DEFAULT 'pending', last_sent_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ig_user_id)
);
ALTER TABLE public.instagram_dm_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_ig_threads ON public.instagram_dm_threads;
CREATE POLICY own_ig_threads ON public.instagram_dm_threads FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- 9. Team chat
CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL, author_name text NOT NULL, author_avatar text,
  body text NOT NULL, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read_team_chat   ON public.team_chat_messages;
DROP POLICY IF EXISTS auth_insert_team_chat ON public.team_chat_messages;
CREATE POLICY auth_read_team_chat   ON public.team_chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_team_chat ON public.team_chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DO $$ BEGIN BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END; END $$;

-- 10. Kill spam crons + schedule overseer + morning-brief
DO $$ DECLARE jn text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  FOR jn IN SELECT jobname FROM cron.job WHERE jobname IN (
    'apex-abandoned-applications','apex-ghosted-applicants','apex-dropped-leads',
    'onboarding-nudge-sweep','send-aged-lead-email-cron',
    'send-followup-emails-cron','send-course-hurry-emails-cron'
  ) LOOP PERFORM cron.unschedule(jn); END LOOP;
  PERFORM cron.unschedule('overseer-bot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overseer-bot');
  PERFORM cron.schedule('overseer-bot', '0 * * * *',
    $c$SELECT public.run_automation_job('overseer-bot','overseer-bot','{}'::jsonb)$c$);
  PERFORM cron.unschedule('morning-brief') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief');
  PERFORM cron.schedule('morning-brief', '0 11 * * *',
    $c$SELECT public.run_automation_job('morning-brief','morning-brief','{}'::jsonb)$c$);
END $$;

-- 11. Done — confirmation row
SELECT 'APEX ACTIVATED ✅' AS status,
  (SELECT count(*)::int FROM public.plaque_awards)                AS plaques,
  (SELECT count(*)::int FROM public.profiles WHERE avatar_url IS NOT NULL) AS profiles_with_avatar,
  (SELECT count(*)::int FROM public.agent_carrier_comp)           AS comp_grid_rows,
  (SELECT count(*)::int FROM public.carriers WHERE is_active)     AS active_carriers;`;

function BotSqlSection() {
  const qc = useQueryClient();
  const [visible, setVisible] = useState(false);

  const { data: currentToken = "", isLoading } = useQuery<string>({
    queryKey: ["system_settings", "apex_bot_token"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings" as any)
        .select("value")
        .eq("key", "apex_bot_token")
        .maybeSingle();
      return (data as any)?.value ?? "";
    },
  });

  const activate = useMutation({
    mutationFn: async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const { error } = await supabase.rpc("admin_configure_integration" as any, {
        p_key: "apex_bot_token",
        p_value: token,
      });
      if (error) throw error;
      return token;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system_settings", "apex_bot_token"] });
      toast.success("Bot access activated");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to activate"),
  });

  const testActive = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL ?? "https://msydzhzolwourcdmqxvn.supabase.co"}/functions/v1/bot-sql`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${currentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "SELECT 1 as ok" }),
      });
      const body = await res.json();
      if (body?.ok && body?.rows?.[0]?.ok === 1) {
        toast.success("Bot endpoint responded OK");
      } else {
        toast.error(`Bot returned: ${body?.error ?? res.statusText}`);
      }
    } catch (e: any) {
      toast.error(`Test failed: ${e?.message ?? e}`);
    }
  };

  const endpoint = "https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/bot-sql";
  const masked = currentToken ? `${currentToken.slice(0, 8)}…${currentToken.slice(-4)}` : "";

  return (
    <Card className="border-2 border-primary/50 bg-gradient-to-br from-primary/10 via-violet-500/5 to-amber-500/10 shadow-xl shadow-primary/20 win-glow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">🤖 Bot SQL Access</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">For Claude assistants — run SQL remotely</p>
            </div>
          </div>
          <Badge variant="outline" className={cn(
            "text-xs",
            currentToken
              ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/20 shadow-lg shadow-emerald-500/20"
              : "border-amber-500/50 text-amber-300 bg-amber-500/20",
          )}>
            {isLoading ? "…" : currentToken ? "● ACTIVE" : "⚠ NOT CONFIGURED"}
          </Badge>
        </div>
        <CardDescription className="text-sm mt-3 leading-relaxed">
          Click <strong className="text-primary">{currentToken ? "Reveal" : "Activate Bot Access"}</strong> below, then the <strong className="text-primary">copy</strong> icon to grab your bearer token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Endpoint</Label>
          <div className="flex gap-2">
            <code className="flex-1 font-mono text-xs bg-muted/40 rounded px-3 py-2 overflow-x-auto">{endpoint}</code>
            <Button size="sm" variant="outline" className="h-9"
              onClick={() => { navigator.clipboard.writeText(endpoint); toast.success("Endpoint copied"); }}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {currentToken && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Bearer token
            </Label>
            <div className="flex gap-2">
              <code className="flex-1 font-mono text-xs bg-muted/40 rounded px-3 py-2 overflow-x-auto">
                {visible ? currentToken : masked}
              </code>
              <Button size="sm" variant="outline" className="h-9" onClick={() => setVisible(v => !v)}>
                {visible ? "Hide" : "Reveal"}
              </Button>
              <Button size="sm" variant="outline" className="h-9"
                onClick={() => { navigator.clipboard.writeText(currentToken); toast.success("Token copied"); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Anyone with this token can run arbitrary SQL. Rotate if leaked.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" className="h-8 text-xs gap-1.5"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}>
            {activate.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Zap className="h-3 w-3" />}
            {currentToken ? "Rotate Token" : "Activate Bot Access"}
          </Button>
          {currentToken && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={testActive}>
              <CheckCircle className="h-3 w-3" /> Test Endpoint
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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
      if (!webhookDraft) setWebhookDraft(val);
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
        toast.error("Run SETUP.sql in Supabase SQL Editor to persist the URL.");
      } else {
        toast.error(err?.message ?? "Failed to save webhook");
      }
    },
  });

  async function handleTest() {
    if (!currentWebhook) {
      setTestStatus("error");
      setTestMsg("Save a Discord webhook first.");
      toast.error("Save a Discord webhook first.");
      return;
    }

    setTestStatus("loading");
    setTestMsg("");
    try {
      // discord-webhook-notify only knows 8 event types (see fn source).
      // "stage_change" / "milestone" used to be sent here and from
      // AgentPipeline; the fn returned 400 "Unknown event_type" and the
      // call silently failed. Use new_application for the test ping —
      // it's the lightest supported event and produces a visible Discord
      // post so the admin can confirm wiring end-to-end.
      const { data, error } = await supabase.functions.invoke("discord-webhook-notify", {
        body: {
          event_type: "new_application",
          details: {
            first_name: "Test",
            last_name: "Ping",
            state: "TX",
            instagram_handle: null,
          },
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
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

      {/* ══════════════════════════════════════════════════════ */}
      {/*  BOT SQL ACCESS — loud, unmissable, at the very top   */}
      {/* ══════════════════════════════════════════════════════ */}
      <BotSqlSection />


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
                {currentWebhook ? "Configured" : "Not configured"}
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
              target="_blank" rel="noopener noreferrer"
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
              target="_blank" rel="noopener noreferrer"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                Get Access Token <ExternalLink className="h-2.5 w-2.5" />
              </Button>
            </a>
            <a
              href="https://github.com/samcom593-creator/rebuild-brighten-sparkle/settings/secrets/actions"
              target="_blank" rel="noopener noreferrer"
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
