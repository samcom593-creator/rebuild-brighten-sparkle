import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Megaphone,
  Phone,
  Send,
  Users,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";

/**
 * /admin/june-hires — the punch list of every agent hired this month with
 * one or more gaps (missing email, phone, Apex account, or AgentLink link).
 *
 * Sam directive 2026-06-18 (verbatim): "Go through every single hire from
 * this month. Ensure that their contracts have been sent out flag with
 * whose profile has not been filled... done or flag who doesn't have a
 * Apex Financial account. And make their account... make them an account
 * using their phone number and email and send them to log in now."
 *
 * Reads v_june_hires_needs_attention shipped in migration 20260618090000.
 * Each row's next_action drives the primary CTA: type in the missing
 * contact info inline, then tap Create Account / Send Course / Mark
 * Invited as appropriate.
 */

interface HireRow {
  agent_id: string;
  display_name: string | null;
  agent_code: string | null;
  license: string | null;
  hired_date: string | null;
  profile_email: string | null;
  profile_phone: string | null;
  has_apex_account: boolean;
  has_agentlink_link: boolean;
  course_sent: boolean | null;
  next_action: "NEEDS_EMAIL" | "NEEDS_PHONE" | "NEEDS_ACCOUNT" | "NEEDS_AGENTLINK" | "OK" | string;
}

const ACTION_META: Record<string, { label: string; icon: any; color: string }> = {
  NEEDS_EMAIL:     { label: "Needs email",     icon: Mail,         color: "border-rose-500/40 bg-rose-500/10 text-rose-400" },
  NEEDS_PHONE:     { label: "Needs phone",     icon: Phone,        color: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  NEEDS_ACCOUNT:   { label: "Needs account",   icon: AlertCircle,  color: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  NEEDS_AGENTLINK: { label: "Needs AgentLink", icon: LinkIcon,     color: "border-violet-500/40 bg-violet-500/10 text-violet-400" },
  OK:              { label: "Ready",           icon: CheckCircle2, color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
};

export default function AdminJuneHires() {
  usePageTitle("June Hires Punch List · Apex Admin");
  const qc = useQueryClient();
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);
  const [filter, setFilter] = useState<"all" | "NEEDS_EMAIL" | "NEEDS_PHONE" | "NEEDS_ACCOUNT" | "NEEDS_AGENTLINK" | "OK">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { email?: string; phone?: string }>>({});

  const { data: rows = [], isLoading } = useQuery<HireRow[]>({
    queryKey: ["admin-june-hires"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_june_hires_needs_attention")
        .select("*");
      if (error) {
        toast.error(`Load failed: ${error.message.slice(0, 80)}`);
        return [];
      }
      return (data as HireRow[]) ?? [];
    },
    staleTime: 30_000,
  });

  const stats = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.next_action] = (acc[r.next_action] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = filter === "all" ? rows : rows.filter((r) => r.next_action === filter);

  function setDraft(agentId: string, patch: { email?: string; phone?: string }) {
    setDrafts((prev) => ({ ...prev, [agentId]: { ...prev[agentId], ...patch } }));
  }

  async function saveContact(row: HireRow) {
    const d = drafts[row.agent_id] ?? {};
    const email = (d.email ?? row.profile_email ?? "").trim();
    const phone = (d.phone ?? row.profile_phone ?? "").trim();
    if (!email && !phone) return;
    setBusyId(row.agent_id);
    try {
      const { data: agentData } = await (supabase as any)
        .from("agents")
        .select("profile_id")
        .eq("id", row.agent_id)
        .maybeSingle();
      const profile_id = (agentData as any)?.profile_id;
      if (profile_id) {
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (email) patch.email = email;
        if (phone) patch.phone = phone;
        await (supabase as any).from("profiles").update(patch).eq("id", profile_id);
      } else if (email) {
        // No profile yet — create one with email so create-new-agent-account can pick up.
        const { data: pData, error: pErr } = await (supabase as any)
          .from("profiles")
          .insert({ email, phone: phone || null, full_name: row.display_name })
          .select("id")
          .single();
        if (pErr) throw pErr;
        await (supabase as any).from("agents").update({ profile_id: (pData as any).id }).eq("id", row.agent_id);
      }
      toast.success("Saved");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.agent_id];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["admin-june-hires"] });
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function createAccount(row: HireRow) {
    if (!row.profile_email) {
      toast.error("Need an email first");
      return;
    }
    setBusyId(row.agent_id);
    try {
      const { data, error } = await supabase.functions.invoke("create-new-agent-account", {
        body: {
          email: row.profile_email,
          fullName: row.display_name ?? "—",
          phone: (row.profile_phone ?? "").replace(/\D/g, "") || null,
          licenseStatus: row.license ?? "unlicensed",
        },
      });
      if (error) throw error;
      const userId = (data as any)?.userId;
      const profileId = (data as any)?.profileId;
      if (!userId) throw new Error("No userId returned");
      await (supabase as any)
        .from("agents")
        .update({ user_id: userId, profile_id: profileId })
        .eq("id", row.agent_id);
      toast.success("Account created");
      await qc.invalidateQueries({ queryKey: ["admin-june-hires"] });
    } catch (e: any) {
      toast.error(`Account create failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function sendCourse(row: HireRow) {
    setBusyId(row.agent_id);
    try {
      await (supabase as any)
        .from("agent_onboarding_queue")
        .upsert(
          [
            { agent_id: row.agent_id, email_kind: "course",  target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
            { agent_id: row.agent_id, email_kind: "discord", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
          ],
          { onConflict: "agent_id,email_kind" },
        );
      await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
      toast.success(`Course + Discord sent to ${row.display_name}`);
      await qc.invalidateQueries({ queryKey: ["admin-june-hires"] });
    } catch (e: any) {
      toast.error(`Send failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        title="June Hires Punch List"
        subtitle="Every hire this month — fill what's missing, fire the course, link AgentLink."
        accent="amber"
      />

      {/* Stat strip — tap to filter */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(["NEEDS_EMAIL", "NEEDS_PHONE", "NEEDS_ACCOUNT", "NEEDS_AGENTLINK", "OK"] as const).map((s) => {
          const m = ACTION_META[s];
          const Icon = m.icon;
          const n = stats[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? "all" : s)}
              className={cn(
                "rounded-3xl border bg-card/40 px-4 py-3 text-left hover:bg-card/70 transition-colors",
                filter === s ? "ring-2 ring-amber-500/40" : "",
              )}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-wider font-semibold">{m.label}</span>
              </div>
              <p className="mt-1 text-2xl font-black tabular-nums">{n}</p>
            </button>
          );
        })}
      </div>

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : !filtered.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No hires in this state.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const m = ACTION_META[row.next_action] ?? ACTION_META.OK;
            const Icon = m.icon;
            const isBusy = busyId === row.agent_id;
            const draftEmail = drafts[row.agent_id]?.email ?? "";
            const draftPhone = drafts[row.agent_id]?.phone ?? "";
            const hasDraft = (draftEmail && draftEmail !== (row.profile_email ?? "")) ||
                             (draftPhone && draftPhone !== (row.profile_phone ?? ""));
            return (
              <Card key={row.agent_id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <button
                      onClick={() => openAgent(row.agent_id)}
                      className="min-w-0 text-left"
                    >
                      <p className="text-sm font-bold leading-tight truncate flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        {row.display_name?.trim() || "—"}
                        {row.agent_code && <span className="text-muted-foreground font-normal">· {row.agent_code}</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Hired {row.hired_date} · {row.license}
                      </p>
                    </button>
                    <Badge variant="outline" className={cn("gap-1 text-[10px]", m.color)}>
                      <Icon className="h-3 w-3" /> {m.label}
                    </Badge>
                  </div>

                  {/* Email + Phone inline edit (always shown · pre-fill from profile) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        defaultValue={row.profile_email ?? ""}
                        placeholder="email@example.com"
                        type="email"
                        className="h-8 text-xs"
                        onChange={(e) => setDraft(row.agent_id, { email: e.target.value })}
                        disabled={isBusy}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        defaultValue={row.profile_phone ?? ""}
                        placeholder="(xxx) xxx-xxxx"
                        type="tel"
                        className="h-8 text-xs"
                        onChange={(e) => setDraft(row.agent_id, { phone: e.target.value })}
                        disabled={isBusy}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {hasDraft && (
                      <Button
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={isBusy}
                        onClick={() => saveContact(row)}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Save contact
                      </Button>
                    )}
                    {row.next_action === "NEEDS_ACCOUNT" && row.profile_email && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        disabled={isBusy}
                        onClick={() => createAccount(row)}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
                        Create Apex account
                      </Button>
                    )}
                    {row.next_action !== "NEEDS_EMAIL" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        disabled={isBusy}
                        onClick={() => sendCourse(row)}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Megaphone className="h-3 w-3" />}
                        {row.course_sent ? "Resend course" : "Send course"}
                      </Button>
                    )}
                    {row.next_action === "NEEDS_AGENTLINK" && (
                      <a
                        href="https://agentlink.insuracloud.ai/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-400 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Invite to AgentLink
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
