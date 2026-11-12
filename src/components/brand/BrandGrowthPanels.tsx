// Brand Command panels for the Glow-Up Ladder, attribution and the proof wall (MP-BRAND-ENGINE parts 6-8).
//   AttributedPosts : Launch Board cards ranked by the leads and applications their tracked link pulled.
//   GlowUpPanel     : glow-up leads by ladder stage, and the 5-email sequence with its switch. The
//                     sequence is OFF until Sam turns it on here; the copy is editable in place.
//   ProofWallPanel  : which agents may appear on sell4daddy.com's proof wall. Everyone starts off.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2, Repeat2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { useConfirm } from "@/hooks/useConfirm";
import { accountLabel, fmtNum, pillarLabel } from "@/lib/brand";
import { cn } from "@/lib/utils";

export interface AttributedPost { card_id: string; title: string; url: string | null; account: string | null; pillar: string | null; hook: string | null; leads: number; applications: number }
export interface GlowUpStats { leads_7d: number; leads_total: number; by_stage: Record<string, number>; nurture_enabled: boolean | null; nurture_sent: number }

const STAGES: Record<string, string> = { "1": "Body", "2": "First $10K", "3": "Break $10K", "4": "Become the man" };

export function AttributedPosts({ rows, onRemake, busyId }: { rows: AttributedPost[]; onRemake: (p: AttributedPost) => void; busyId: string | null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 lg:col-span-2">
      <h3 className="mb-1 text-[15px] font-bold">Top by leads and applications, last 30 days</h3>
      {rows.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No data yet. A post is credited when someone applies or signs up through the tracked link its Launch Board card hands out.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.slice(0, 5).map((p) => (
            <li key={p.card_id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{p.title}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {fmtNum(p.applications)} application{p.applications === 1 ? "" : "s"} · {fmtNum(p.leads)} lead{p.leads === 1 ? "" : "s"} · {accountLabel(p.account)} · {pillarLabel(p.pillar)}
                </p>
              </div>
              <Button variant="outline" className="h-11 shrink-0" disabled={busyId === p.card_id} onClick={() => onRemake(p)}>
                {busyId === p.card_id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat2 className="h-4 w-4" aria-hidden />} Remake this
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface NurtureEmail { step: number; day_offset: number; stage: number | null; subject: string; body: string }

export function GlowUpPanel({ stats, onChanged }: { stats: GlowUpStats | undefined; onChanged: () => void }) {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const [saving, setSaving] = useState(false);
  const emails = useQuery({
    queryKey: ["brand-command", "nurture"],
    queryFn: async () => {
      const { data, error } = await supabase.from("glowup_nurture_emails").select("step,day_offset,stage,subject,body").order("step", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NurtureEmail[];
    },
    staleTime: 60_000,
  });
  const on = stats?.nurture_enabled === true;

  const toggle = async () => {
    const next = !on;
    const ok = await askConfirm({
      title: next ? "Turn the Glow-Up sequence on?" : "Turn the Glow-Up sequence off?",
      description: next
        ? "From the next 9 AM run, every glow-up lead gets the five emails below, in order, over ten days. Read the copy first."
        : "No more sequence emails go out until you turn it back on. Leads keep their place.",
      confirmText: next ? "Turn it on" : "Turn it off",
    });
    if (!ok) return;
    setSaving(true);
    const { data, error } = await supabase.from("system_settings").update({ value: next ? "true" : "false", updated_at: new Date().toISOString() }).eq("key", "glowup_nurture_enabled").select("key");
    setSaving(false);
    if (error || (data?.length ?? 0) !== 1) { toast.error(`Not changed: ${error?.message ?? "the setting was not found"}`); return; }
    toast.success(next ? "The sequence is on." : "The sequence is off.");
    onChanged();
  };

  const saveCopy = async (step: number) => {
    if (draft.subject.trim().length < 3 || draft.body.trim().length < 20) { toast.error("The subject or the email is too short."); return; }
    setSaving(true);
    const { data, error } = await supabase.from("glowup_nurture_emails").update({ subject: draft.subject.trim(), body: draft.body, updated_at: new Date().toISOString() }).eq("step", step).select("step");
    setSaving(false);
    if (error || (data?.length ?? 0) !== 1) { toast.error(`Not saved: ${error?.message ?? "the email was not found"}`); return; }
    toast.success(`Email ${step} saved.`);
    void qc.invalidateQueries({ queryKey: ["brand-command", "nurture"] });
  };

  return (
    <section aria-labelledby="bc-glowup" className="mb-6">
      <h2 id="bc-glowup" className="mb-2 text-lg font-bold tracking-tight">Glow-Up Ladder</h2>
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px]"><span className="font-bold tabular-nums">{fmtNum(stats?.leads_7d ?? null)}</span> leads in the last 7 days · <span className="font-bold tabular-nums">{fmtNum(stats?.leads_total ?? null)}</span> all time</p>
          <a href="https://sell4daddy.com/glowup" target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold underline underline-offset-4">Open the page</a>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(STAGES).map(([k, label]) => <TonePill key={k} tone="gold">{k}. {label}: {fmtNum(stats?.by_stage?.[k] ?? 0)}</TonePill>)}
        </div>
        {(stats?.leads_total ?? 0) === 0 && <p className="mt-2 text-[13px] text-muted-foreground">No data yet. Leads appear here as soon as someone asks for the checklist.</p>}
      </div>

      <div className="mt-2 rounded-xl border border-border/60 bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[15px] font-bold">Email sequence: 5 emails over 10 days</p>
            <p className="text-[13px] text-muted-foreground">{on ? `On. ${fmtNum(stats?.nurture_sent ?? 0)} sent so far.` : "Off. Nothing sends until you approve the copy and turn it on."}</p>
          </div>
          <div className="flex items-center gap-2">
            <TonePill tone={on ? "good" : "slate"} dot>{on ? "On" : "Off"}</TonePill>
            <Button variant={on ? "outline" : "default"} className="h-11" disabled={saving || stats == null} onClick={() => void toggle()}>{on ? "Turn off" : "Turn on"}</Button>
          </div>
        </div>
        {emails.isLoading ? <Skeleton className="mt-3 h-24 w-full" /> : emails.isError ? (
          <p className="mt-3 text-[15px] text-destructive">The emails did not load.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {(emails.data ?? []).map((e) => (
              <li key={e.step} className="py-2">
                <button type="button" aria-expanded={open === e.step} className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
                  onClick={() => { if (open === e.step) setOpen(null); else { setOpen(e.step); setDraft({ subject: e.subject, body: e.body }); } }}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{e.step}. {e.subject}</span>
                    <span className="block text-[13px] text-muted-foreground">Day {e.day_offset} · {e.stage ? `Stage ${e.stage}: ${STAGES[String(e.stage)]}` : "Pick your door"}</span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open === e.step && "rotate-180")} aria-hidden />
                </button>
                {open === e.step && (
                  <div className="mt-2 grid gap-2">
                    <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">Subject
                      <Input className="h-11 text-[16px]" value={draft.subject} onChange={(ev) => setDraft((d) => ({ ...d, subject: ev.target.value }))} />
                    </label>
                    <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">Email
                      <textarea className="min-h-[320px] w-full rounded-md border border-input bg-background p-3 text-[16px] leading-relaxed" value={draft.body} onChange={(ev) => setDraft((d) => ({ ...d, body: ev.target.value }))} />
                    </label>
                    <p className="text-[13px] text-muted-foreground">{"{{first_name}}"} is replaced with the lead's first name. An unsubscribe link and the postal address are added when it sends.</p>
                    <Button className="h-11" disabled={saving} onClick={() => void saveCopy(e.step)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save this email</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface WallAgent { agent_id: string; display_name: string | null; plaques: number; latest: string | null; consent: boolean }

export function ProofWallPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({
    queryKey: ["brand-command", "proof-wall"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("brand_proof_wall_agents");
      if (error) throw error;
      return (data ?? []) as WallAgent[];
    },
    staleTime: 60_000,
  });
  const set = async (a: WallAgent, consent: boolean) => {
    setBusy(a.agent_id);
    const { error } = await supabase.rpc("brand_set_proof_wall_consent", { p_agent_id: a.agent_id, p_consent: consent });
    setBusy(null);
    if (error) { toast.error(`Not changed: ${error.message}`); return; }
    toast.success(consent ? `${a.display_name ?? "This agent"} can appear on the proof wall.` : `${a.display_name ?? "This agent"} is off the proof wall.`);
    void qc.invalidateQueries({ queryKey: ["brand-command", "proof-wall"] });
  };
  const rows = q.data ?? [];
  const shown = showAll ? rows : rows.slice(0, 8);
  const onCount = rows.filter((r) => r.consent).length;

  return (
    <section aria-labelledby="bc-wall" className="mb-6">
      <h2 id="bc-wall" className="mb-2 text-lg font-bold tracking-tight">Proof wall consent</h2>
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <p className="text-[15px] text-muted-foreground">
          {onCount === 0 ? "Nobody is on the wall, so sell4daddy.com hides the section. " : `${onCount} agent${onCount === 1 ? "" : "s"} on the wall. `}
          Turn an agent on only after they have told you yes. The wall shows first name, last initial, the plaque and its month; dollar plaques are labeled production.
        </p>
        {q.isLoading ? <Skeleton className="mt-3 h-24 w-full" /> : q.isError ? (
          <p className="mt-3 text-[15px] text-destructive">The list did not load.</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted-foreground">No data yet. No agent holds a plaque.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border/60">
              {shown.map((a) => (
                <li key={a.agent_id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{a.display_name ?? "Unnamed agent"}</p>
                    <p className="text-[13px] text-muted-foreground">{a.plaques} plaque{a.plaques === 1 ? "" : "s"}{a.latest ? ` · latest ${a.latest}` : ""}</p>
                  </div>
                  <Button variant={a.consent ? "default" : "outline"} className="h-11 shrink-0" disabled={busy === a.agent_id} aria-pressed={a.consent} onClick={() => void set(a, !a.consent)}>
                    {a.consent ? "On the wall" : "Off"}
                  </Button>
                </li>
              ))}
            </ul>
            {rows.length > 8 && <Button variant="ghost" className="mt-2 h-11 w-full" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${rows.length}`}</Button>}
          </>
        )}
      </div>
    </section>
  );
}
