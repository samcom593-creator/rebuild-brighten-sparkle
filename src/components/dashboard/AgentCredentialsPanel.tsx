/**
 * AgentCredentialsPanel — admin-only "Access & Credentials" surface for /dashboard/crm.
 *
 * Sam said (voice 2026-06-15): "I want full CRM access, CRM management for
 * passwords for them to be able to log in and out of ReadyMode, etcetera."
 *
 * Backing store: public.agent_credentials (encrypted at rest with pgcrypto +
 * vault.agent_credentials_key). All reads/writes go through SECURITY DEFINER
 * RPCs that gate on has_role(auth.uid(),'admin'). RLS hard-blocks every other
 * client path.
 *
 * Sam IS the admin → reveal toggle + copy-to-clipboard + "Resend password
 * reset" CTA are all wired here. Managers + agents cannot read passwords;
 * the panel collapses to "admin only" for them.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Copy, Save, KeyRound, ShieldAlert, RefreshCw, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ServiceKey = "readymode" | "insuracloud" | "agentlink" | "xcel" | "other";

interface ServiceMeta {
  key: ServiceKey;
  label: string;
  hint: string;
}

const SERVICES: ServiceMeta[] = [
  { key: "readymode",   label: "ReadyMode dialer",     hint: "Username + password the agent uses to log into ReadyMode." },
  { key: "insuracloud", label: "InsuraCloud / AgentLink", hint: "InsuraCloud carrier portal login." },
  { key: "agentlink",   label: "AgentLink CRM",        hint: "AgentLink agent portal credentials." },
  { key: "xcel",        label: "Xcel pre-licensing",   hint: "Xcel student account if Sam paid for the course." },
  { key: "other",       label: "Other",                hint: "Anything else (Discord recovery, etc.)." },
];

interface CredentialMeta {
  service: ServiceKey;
  username: string | null;
  has_password: boolean;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface AgentCredentialsPanelProps {
  agentId: string;
  agentName: string;
  agentEmail?: string | null;
}

export function AgentCredentialsPanel({ agentId, agentName, agentEmail }: AgentCredentialsPanelProps) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Non-admin viewers see a polite refusal — never a password.
  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Credential vault is admin-only. Ask Sam to set or reveal a password for this agent.</span>
      </div>
    );
  }

  const metaQuery = useQuery({
    queryKey: ["agent-credentials", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("agent_credentials_list", { p_agent_id: agentId });
      if (error) throw error;
      return (data ?? []) as CredentialMeta[];
    },
    staleTime: 30_000,
  });

  const metaByService = new Map<ServiceKey, CredentialMeta>(
    (metaQuery.data ?? []).map((m) => [m.service, m]),
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card/95 shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-semibold uppercase tracking-wide">Access &amp; Credentials</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] gap-1"
          onClick={() => metaQuery.refetch()}
          disabled={metaQuery.isFetching}
        >
          <RefreshCw className={cn("h-3 w-3", metaQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {SERVICES.map((svc) => (
          <CredentialRow
            key={svc.key}
            service={svc}
            agentId={agentId}
            agentName={agentName}
            agentEmail={agentEmail}
            meta={metaByService.get(svc.key) ?? null}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["agent-credentials", agentId] })}
          />
        ))}
      </div>
    </div>
  );
}

interface CredentialRowProps {
  service: ServiceMeta;
  agentId: string;
  agentName: string;
  agentEmail?: string | null;
  meta: CredentialMeta | null;
  onSaved: () => void;
}

function CredentialRow({ service, agentId, agentName, agentEmail, meta, onSaved }: CredentialRowProps) {
  const [username, setUsername] = useState<string>(meta?.username ?? "");
  const [password, setPassword] = useState<string>("");
  const [notes, setNotes] = useState<string>(meta?.notes ?? "");
  const [reveal, setReveal] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  // Reset local state if meta changes (refresh after another tab edits).
  React.useEffect(() => {
    setUsername(meta?.username ?? "");
    setNotes(meta?.notes ?? "");
    setPassword("");
    setReveal(false);
    setRevealed(null);
  }, [meta?.updated_at, meta?.username]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("agent_credentials_upsert", {
        p_agent_id: agentId,
        p_service: service.key,
        p_username: username,
        p_password: password.length > 0 ? password : null,
        p_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Saved ${service.label} for ${agentName}`);
      setPassword("");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save credentials"),
  });

  const handleReveal = async () => {
    if (reveal) {
      setReveal(false);
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const { data, error } = await supabase.rpc("agent_credentials_reveal", {
        p_agent_id: agentId,
        p_service: service.key,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setRevealed(row?.password ?? null);
      setReveal(true);
    } catch (e: any) {
      toast.error(e?.message || "Reveal failed");
    } finally {
      setRevealing(false);
    }
  };

  const handleCopyPassword = async () => {
    let value = revealed;
    if (!value) {
      try {
        const { data, error } = await supabase.rpc("agent_credentials_reveal", {
          p_agent_id: agentId,
          p_service: service.key,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        value = row?.password ?? null;
      } catch (e: any) {
        toast.error(e?.message || "Copy failed");
        return;
      }
    }
    if (!value) {
      toast.message("No password saved yet for this service.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Password copied");
    } catch {
      toast.error("Clipboard blocked — reveal then copy manually");
    }
  };

  const handleSendResetEmail = async () => {
    if (!agentEmail) {
      toast.error("No email on file for this agent");
      return;
    }
    setSendingReset(true);
    try {
      // supabase.auth.resetPasswordForEmail is the user-portal reset for the
      // platform login. Wire it; the ReadyMode reset is a separate manual flow
      // until ReadyMode exposes an API.
      const { error } = await supabase.auth.resetPasswordForEmail(agentEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(`Reset link sent to ${agentEmail}`);
    } catch (e: any) {
      toast.error(e?.message || "Password reset failed");
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold">{service.label}</span>
          {meta?.has_password ? (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" /> Saved
            </Badge>
          ) : (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">Empty</Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {meta ? `Updated ${new Date(meta.updated_at).toLocaleDateString()}` : "—"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{service.hint}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Username</label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username@apex"
            autoComplete="off"
            className="h-8 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            {meta?.has_password ? "Change password" : "Password"}
          </label>
          <div className="flex gap-1">
            <Input
              type={reveal ? "text" : "password"}
              value={reveal && revealed != null ? revealed : password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (reveal) {
                  setRevealed(e.target.value);
                }
              }}
              placeholder={meta?.has_password ? "Leave blank to keep current" : "Set a password"}
              autoComplete="new-password"
              className="h-8 text-xs font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title={reveal ? "Hide saved password" : "Reveal saved password"}
              onClick={handleReveal}
              disabled={revealing}
            >
              {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="Copy saved password"
              onClick={handleCopyPassword}
              disabled={!meta?.has_password}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional — security questions, account number, recovery email…"
          autoComplete="off"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-7 gap-1.5 text-[11px]"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || (!username && !password && !notes)}
        >
          <Save className="h-3 w-3" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
        {service.key === "readymode" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px]"
            onClick={handleSendResetEmail}
            disabled={sendingReset || !agentEmail}
            title={agentEmail ? "Send Supabase reset email to the agent" : "No email on file"}
          >
            <Mail className="h-3 w-3" />
            {sendingReset ? "Sending…" : "Send portal reset link"}
          </Button>
        )}
      </div>
    </div>
  );
}
