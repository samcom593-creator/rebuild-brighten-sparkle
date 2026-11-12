/**
 * OwnerSystemPanel (MP-302 part 8, 2026-11-12): the owner's view of what he pays for, what is
 * connected, and what is owed. Owner only: every read and write here goes through is_sam().
 *
 *   Daily overview   the one owner email: its Arizona send time, on/off, the inbox mute, a
 *                    preview of today's message and a send-now.
 *   Needs you        failed scheduled jobs, critical alerts, open blockers, recorded renewals.
 *   Subscriptions    a manual record. A cost or renewal date appears only if someone entered
 *                    it; every row shows its source and when it was last verified.
 *   Integrations     read live from the health views the database already keeps.
 *
 * Cloud systems only. Jobs that run on the Studio are not visible from a browser, and the
 * panel says so rather than implying they are covered.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import type { Tone } from "@/lib/tones";
import {
  HEALTH_LABEL, HEALTH_TONE, STATUS_LABEL, STATUS_TONE, emptyDraft, formatCost, groupIntegrations, obligationCount, validateSubscription,
  type Integration, type Obligations, type Subscription, type SubscriptionDraft,
} from "@/lib/ownerSystem";

type DbError = { message: string };
type Rows = PromiseLike<{ data: unknown[] | null; error: DbError | null }>;
interface Chain extends Rows {
  select(columns: string): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  eq(column: string, value: unknown): Chain;
  insert(values: Record<string, unknown>): Chain;
  update(values: Record<string, unknown>): Chain;
}
const db = supabase as unknown as {
  from: (table: string) => Chain;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError | null }>;
};

interface OverviewSettings { enabled: boolean; time_az: string; to: string | null; last_sent: string | null; mute_enabled: boolean; mute_subjects: string[] }
interface SystemOverview { as_of: string; integrations: Integration[]; obligations: Obligations }

const whenWords = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "unreadable date";
  return t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }) + " AZ";
};

function Section({ title, count, tone, children, defaultOpen = false }: { title: string; count?: string; tone?: Tone; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-2xl border border-border bg-card [&[open]_.chev]:rotate-180">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-semibold text-foreground">
        {title}
        {count ? <TonePill tone={tone ?? "slate"}>{count}</TonePill> : null}
        <ChevronDown className="chev ml-auto h-4 w-4 text-muted-foreground transition-transform" aria-hidden />
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function SubscriptionForm({ initial, onDone }: { initial: SubscriptionDraft; onDone: () => void }) {
  const [draft, setDraft] = useState<SubscriptionDraft>(initial);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof SubscriptionDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const save = async () => {
    const checked = validateSubscription(draft);
    if (checked.ok === false) { toast.error(checked.error); return; }
    setSaving(true);
    const res = draft.id
      ? await db.from("owner_subscriptions").update({ ...checked.row, updated_at: new Date().toISOString() }).eq("id", draft.id).select("id")
      : await db.from("owner_subscriptions").insert(checked.row).select("id");
    setSaving(false);
    if (res.error || (res.data?.length ?? 0) !== 1) { toast.error(`Not saved: ${res.error?.message ?? "nothing was written"}`); return; }
    toast.success("Saved.");
    onDone();
  };
  const field = (key: keyof SubscriptionDraft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="grid gap-1 text-[13px] font-medium text-muted-foreground">
      {label}
      <Input className="h-11 text-[16px]" value={draft[key] ?? ""} onChange={(e) => set(key, e.target.value)} {...props} />
    </label>
  );
  const pick = (key: "billing_frequency" | "status", label: string, options: Array<[string, string]>) => (
    <label className="grid gap-1 text-[13px] font-medium text-muted-foreground">
      {label}
      <select className="h-11 rounded-md border border-input bg-background px-3 text-[16px] text-foreground" value={draft[key]} onChange={(e) => set(key, e.target.value)}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background/40 p-3 sm:grid-cols-2">
      {field("service", "Service")}
      {field("purpose", "What it is for")}
      {field("plan", "Plan")}
      {field("cost", "Cost (leave blank if not known)", { inputMode: "decimal", placeholder: "49.00" })}
      {pick("billing_frequency", "Billed", [["", "Not recorded"], ["monthly", "Monthly"], ["yearly", "Yearly"], ["quarterly", "Quarterly"], ["weekly", "Weekly"], ["usage", "By usage"], ["one_time", "One time"]])}
      {field("renewal_date", "Renewal date (leave blank if not known)", { type: "date" })}
      {field("account_owner", "Account it is under")}
      {field("billing_url", "Billing page link", { inputMode: "url", placeholder: "https://" })}
      {pick("status", "Status", [["active", "Active"], ["needs_review", "Needs review"], ["canceled", "Canceled"]])}
      {field("last_verified", "Last verified on", { type: "date" })}
      {field("source", "Where this information came from")}
      {field("notes", "Notes")}
      <div className="flex gap-2 sm:col-span-2">
        <Button className="h-11 flex-1" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save</Button>
        <Button variant="outline" className="h-11" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function OwnerSystemPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SubscriptionDraft | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  const settings = useQuery({
    queryKey: ["owner-system", "overview-settings"],
    queryFn: async (): Promise<OverviewSettings> => {
      const { data, error } = await db.rpc("owner_overview_settings");
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Owner access required.");
      return data as OverviewSettings;
    },
  });
  const system = useQuery({
    queryKey: ["owner-system", "overview"],
    staleTime: 120_000,
    queryFn: async (): Promise<SystemOverview> => {
      const { data, error } = await db.rpc("owner_system_overview");
      if (error) throw new Error(error.message);
      return data as SystemOverview;
    },
  });
  const subs = useQuery({
    queryKey: ["owner-system", "subscriptions"],
    queryFn: async (): Promise<Subscription[]> => {
      const { data, error } = await db.from("owner_subscriptions").select("*").order("service", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Subscription[];
    },
  });

  const saveSettings = async (args: Record<string, unknown>, done: string) => {
    setBusy("settings");
    const { error } = await db.rpc("set_owner_overview_settings", args);
    setBusy(null);
    if (error) { toast.error(`Not saved: ${error.message}`); return; }
    toast.success(done);
    setTime(null);
    void qc.invalidateQueries({ queryKey: ["owner-system", "overview-settings"] });
  };

  const callOverview = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke("owner-daily-overview", { body });
    setBusy(null);
    if (error) { toast.error(`Did not run: ${error.message}`); return null; }
    return data as { subject?: string; html?: string; sent?: boolean; to?: string; error?: string };
  };

  const s = settings.data;
  const ob = system.data?.obligations;
  const owed = ob ? obligationCount(ob) : 0;
  const groups = system.data ? groupIntegrations(system.data.integrations) : [];
  const failing = system.data ? system.data.integrations.filter((i) => i.health === "failing" || i.health === "not_connected").length : 0;

  return (
    <section aria-label="Owner system overview" className="space-y-3">
      <p className="text-[13px] text-muted-foreground">Cloud systems only. Jobs that run on the Studio are not visible from here.</p>

      <Section title="Daily overview email" count={s ? (s.enabled ? `${s.time_az} AZ` : "Off") : undefined} tone={s?.enabled ? "good" : "slate"} defaultOpen>
        {settings.isLoading ? <Skeleton className="h-24 w-full" /> : settings.isError || !s ? (
          <p role="status" className="text-sm text-tone-hot">Settings did not load: {(settings.error as Error)?.message ?? "no answer"}</p>
        ) : (
          <>
            <p className="text-[14px] leading-5 text-muted-foreground">
              One message a day to {s.to ?? "the owner inbox"}: new applicants, interviews, follow-ups, new hires, production, content and system issues. Last sent: {s.last_sent ?? "not yet"}.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-[13px] font-medium text-muted-foreground">
                Send time (Arizona)
                <Input type="time" step={3600} className="h-11 w-36 text-[16px]" value={time ?? s.time_az} onChange={(e) => setTime(e.target.value)} />
              </label>
              <Button className="h-11" disabled={busy !== null || time === null || time === s.time_az} onClick={() => time && void saveSettings({ p_time_az: time.slice(0, 5) }, "Send time saved. It sends in that hour.")}>Save time</Button>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
              <span>Send the daily overview</span>
              <Switch checked={s.enabled} disabled={busy !== null} onCheckedChange={(v) => void saveSettings({ p_enabled: v }, v ? "Daily overview on." : "Daily overview off.")} aria-label="Send the daily overview" />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
              <span>Keep per-person notices out of my inbox<span className="block text-[13px] text-muted-foreground">{s.mute_subjects.length} notice types muted for your addresses only. Applicant alerts and sign-in mail are never muted.</span></span>
              <Switch checked={s.mute_enabled} disabled={busy !== null} onCheckedChange={(v) => void saveSettings({ p_mute_enabled: v }, v ? "Notices muted." : "Notices will reach your inbox again.")} aria-label="Keep per-person notices out of my inbox" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" disabled={busy !== null} onClick={async () => {
                const out = await callOverview({ preview: true }, "preview");
                if (out?.html) setPreview({ subject: out.subject ?? "", html: out.html });
              }}>{busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Preview today's</Button>
              <Button variant="outline" className="h-11" disabled={busy !== null} onClick={async () => {
                const out = await callOverview({ force: true }, "send");
                if (!out) return;
                if (out.sent) toast.success(`Sent to ${out.to}.`); else toast.error(`Not sent: ${out.error ?? "no reason given"}`);
              }}>{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Send it now</Button>
            </div>
            {preview ? (
              <div className="rounded-xl border border-border bg-card p-2">
                <p className="px-2 pb-1 text-[13px] font-semibold text-muted-foreground">{preview.subject}</p>
                {/* The email is written for a light inbox, so the preview frame carries its own light page. */}
                <iframe title="Daily overview preview" sandbox="" srcDoc={`<body style="margin:0;background:white">${preview.html}</body>`} className="h-96 w-full rounded-lg" />
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Needs you" count={system.isLoading ? undefined : system.isError ? "Did not load" : String(owed)} tone={system.isError ? "hot" : owed > 0 ? "warm" : "good"} defaultOpen>
        {system.isLoading ? <Skeleton className="h-24 w-full" /> : system.isError || !ob ? (
          <p role="status" className="text-sm text-tone-hot">Did not load: {(system.error as Error)?.message ?? "no answer"}. Nothing is being guessed.</p>
        ) : owed === 0 ? (
          <p className="text-[15px] text-muted-foreground">Nothing is owed: no failed jobs or critical alerts in 24 hours, no open blockers, no renewal in the next 30 days.</p>
        ) : (
          <ul className="space-y-2 text-[15px]">
            {ob.failed_jobs_24h.map((j) => <li key={`job-${j.job}`}><span className="font-semibold">Scheduled job failing: {j.job}</span><span className="block text-[13px] text-muted-foreground">{j.failures} failures in 24 hours · last {whenWords(j.last)}{j.message ? ` · ${j.message}` : ""}</span></li>)}
            {ob.critical_alerts_24h.map((a, i) => <li key={`alert-${i}`}><span className="font-semibold">{a.subject ?? "Critical alert"}</span><span className="block text-[13px] text-muted-foreground">{whenWords(a.at)}</span></li>)}
            {ob.open_blockers.map((b, i) => <li key={`blocker-${i}`}><span className="font-semibold">{b.title}</span>{b.fix ? <span className="block text-[13px] text-muted-foreground">Fix: {b.fix}</span> : null}</li>)}
            {ob.renewals_30d.map((r) => <li key={`renew-${r.service}`}><span className="font-semibold">{r.service} renews {r.renewal_date}</span><span className="block text-[13px] text-muted-foreground">{formatCost(r.cost_cents, r.currency)}</span></li>)}
            {ob.subscriptions_to_review > 0 ? <li><span className="font-semibold">{ob.subscriptions_to_review} subscription {ob.subscriptions_to_review === 1 ? "record needs" : "records need"} review</span><span className="block text-[13px] text-muted-foreground">Confirm each is still billed, then mark it active or canceled below.</span></li> : null}
          </ul>
        )}
      </Section>

      <Section title="Subscriptions" count={subs.data ? String(subs.data.length) : undefined}>
        <p className="text-[13px] leading-5 text-muted-foreground">A record you keep by hand. Nothing here is read from a bank or a card, and this list is only as complete as what has been entered.</p>
        {subs.isLoading ? <Skeleton className="h-24 w-full" /> : subs.isError ? (
          <p role="status" className="text-sm text-tone-hot">Did not load: {(subs.error as Error)?.message}</p>
        ) : (
          <ul className="space-y-2">
            {(subs.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-bold">{row.service}</span>
                  <TonePill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</TonePill>
                  <span className="ml-auto text-[15px] font-semibold tabular-nums">{formatCost(row.cost_cents, row.currency, row.billing_frequency)}</span>
                </div>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  {[row.purpose, row.plan, row.renewal_date ? `renews ${row.renewal_date}` : "renewal date not recorded", row.account_owner ? `under ${row.account_owner}` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="text-[13px] leading-5 text-muted-foreground">Source: {row.source} · {row.last_verified ? `verified ${row.last_verified}` : "never verified"}</p>
                {row.notes ? <p className="text-[13px] leading-5 text-muted-foreground">{row.notes}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" className="h-10" onClick={() => setEditing(emptyDraft(row))}>Edit</Button>
                  {row.billing_url ? <Button asChild variant="outline" className="h-10"><a href={row.billing_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /> Billing page</a></Button> : null}
                </div>
                {editing?.id === row.id ? <div className="mt-3"><SubscriptionForm initial={editing} onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["owner-system"] }); }} /></div> : null}
              </li>
            ))}
            {(subs.data ?? []).length === 0 ? <li className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted-foreground">No subscription has been recorded yet.</li> : null}
          </ul>
        )}
        {editing && !editing.id ? (
          <SubscriptionForm initial={editing} onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["owner-system"] }); }} />
        ) : (
          <Button className="h-11" onClick={() => setEditing(emptyDraft())}><Plus className="h-4 w-4" aria-hidden /> Add a subscription</Button>
        )}
      </Section>

      <Section title="Integrations" count={system.isLoading ? undefined : system.isError ? "Did not load" : failing > 0 ? `${failing} need a look` : "All answering"} tone={system.isError ? "hot" : failing > 0 ? "warm" : "good"}>
        {system.isLoading ? <Skeleton className="h-24 w-full" /> : system.isError ? (
          <p role="status" className="text-sm text-tone-hot">Did not load: {(system.error as Error)?.message}</p>
        ) : groups.map((g) => (
          <div key={g.group} className="space-y-1.5">
            <h4 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{g.group}</h4>
            <ul className="space-y-1.5">
              {g.items.map((i) => (
                <li key={`${g.group}-${i.service}`} className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{i.service.replace(/_/g, " ")}</span>
                    <TonePill tone={HEALTH_TONE[i.health] ?? "slate"}>{HEALTH_LABEL[i.health] ?? i.health}</TonePill>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Last success: {whenWords(i.last_success)} · {i.detail}</p>
                  {i.recovery ? <p className="text-[13px] leading-5 text-foreground">Fix: {i.recovery}</p> : null}
                  {i.recovery && i.affects ? <p className="text-[13px] leading-5 text-muted-foreground">Affects: {i.affects}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </section>
  );
}
