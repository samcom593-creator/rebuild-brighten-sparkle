import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Activity, Bell, Bot, Building2, CreditCard, Database, LifeBuoy, LockKeyhole, MessageSquare, Palette, Plug, Save, Smartphone, User } from "lucide-react";
import { toast } from "sonner";

import { CalendarSyncSection } from "@/components/dashboard/CalendarSyncSection";
import { IPhoneShortcutsSection } from "@/components/dashboard/IPhoneShortcutsSection";
import { ProfileSettings } from "@/components/dashboard/ProfileSettings";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { QueryState, describeQuery, formatAsOf } from "@/components/ui/query-state";
import { Switch } from "@/components/ui/switch";
import { resolveBrand } from "@/config/brand";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { ASSISTANT_PROBE_BODY, classifyAssistantProbe, type AssistantProbeVerdict } from "@/lib/assistantProbe";
import { NOTIFICATION_PREF_DEFAULTS, canSaveNotificationPrefs, notificationPrefsFromRow, notificationPrefsRead, type NotificationState } from "@/lib/notificationPrefsState";
import { ADMIN_SETTING_MODES, SETTINGS_TABS, resolveSettingMode, settingsTabHref, type SettingMode } from "@/lib/settingsTabs";
import { cn } from "@/lib/utils";

type AgencyState = { name: string; subdomain: string; accent: string; personalDeals: boolean; leaderboard: boolean; recruiting: boolean };
type AgencyBranding = { display_name: string; subdomain: string; accent_color: string; show_personal_deals: boolean; show_leaderboard: boolean; show_recruiting: boolean; can_edit: boolean };

// Tab order. Labels and hrefs come from src/lib/settingsTabs: path tabs have
// their own route in src/App.tsx; Integrations and Personal automation ride on
// the base route as ?tab=<key>, so no new route was needed to give them a
// destination (F35). Agency and Billing are owner-level and hidden otherwise.
const nav: Array<{ key: SettingMode; icon: typeof Building2 }> = [
  { key: "profile", icon: User },
  { key: "agency", icon: Building2 },
  { key: "notifications", icon: Bell },
  { key: "security", icon: LockKeyhole },
  { key: "integrations", icon: Plug },
  { key: "automation", icon: Smartphone },
  { key: "billing", icon: CreditCard },
  { key: "nova-pro", icon: Bot },
];

function SettingsNav({ mode, isAdmin }: { mode: SettingMode; isAdmin: boolean }) {
  const visible = isAdmin ? nav : nav.filter(({ key }) => !ADMIN_SETTING_MODES.includes(key));
  return <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Settings sections">
    {visible.map(({ key, icon: Icon }) => <Button key={key} asChild variant="ghost" className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}><Link to={settingsTabHref(key)} aria-current={mode === key ? "page" : undefined}><Icon className="mr-2 h-4 w-4" />{SETTINGS_TABS[key].label}</Link></Button>)}
  </nav>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <GlassCard className="p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p><div className="mt-5 space-y-4">{children}</div></GlassCard>;
}


function ToggleRow({ label, description, checked, onCheckedChange, disabled }: { label: string; description: string; checked: boolean; onCheckedChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border/70 pb-4 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} /></div>;
}

function AgencySettings() {
  const brand = resolveBrand();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgencyState>({ name: brand.legalName, subdomain: "apex", accent: "#d4a900", personalDeals: true, leaderboard: true, recruiting: true });
  const settings = useQuery({
    queryKey: ["agency-branding", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => { const { data, error } = await supabase.rpc("get_my_agency_branding" as never); if (error) throw error; return data as unknown as AgencyBranding; },
  });
  useEffect(() => {
    if (!settings.data) return;
    setForm({ name: settings.data.display_name ?? brand.legalName, subdomain: settings.data.subdomain ?? "apex", accent: settings.data.accent_color ?? "#d4a900", personalDeals: settings.data.show_personal_deals ?? true, leaderboard: settings.data.show_leaderboard ?? true, recruiting: settings.data.show_recruiting ?? true });
  }, [settings.data, brand.legalName]);
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("save_my_agency_branding" as never, { p_display_name: form.name, p_subdomain: form.subdomain, p_accent_color: form.accent, p_show_personal_deals: form.personalDeals, p_show_leaderboard: form.leaderboard, p_show_recruiting: form.recruiting } as never); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["agency-branding"] }); toast.success("Agency settings saved"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save settings"),
  });
  // The form only renders over a completed read: a failed first read shows the
  // error state with Retry instead of defaults labeled as live branding, and a
  // failed refresh keeps the last read with the stale notice. A non-owner sees
  // read-only values and no Save button rather than one that never enables.
  const canEdit = settings.data?.can_edit === true;
  return <QueryState {...describeQuery({ isPending: settings.isPending, isError: settings.isError, data: settings.data, isEmpty: false, error: settings.error })} label="agency branding" onRetry={() => void settings.refetch()} asOf={settings.dataUpdatedAt}>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {!canEdit && <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">You are viewing your agency's live branding. Only the pre-wired agency owner can change it.</div>}
        <Section title="Agency identity" description="The name and color your team sees throughout the operating system.">
          <label className="block text-xs font-medium">Agency name<Input disabled={!canEdit} className="mt-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Workspace subdomain<Input disabled={!canEdit} className="mt-1.5" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></label><label className="block text-xs font-medium">Accent color<div className="mt-1.5 flex gap-2"><Input disabled={!canEdit} type="color" className="h-10 w-14 p-1" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /><Input disabled={!canEdit} value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /></div></label></div>
        </Section>
        <Section title="Workspace visibility" description="Choose which operating areas appear for producers.">
          <ToggleRow disabled={!canEdit} label="Personal deals" description="Allow producers to see and manage their own deal pipeline." checked={form.personalDeals} onCheckedChange={(value) => setForm({ ...form, personalDeals: value })} />
          <ToggleRow disabled={!canEdit} label="Leaderboard" description="Show team production rankings and recognition." checked={form.leaderboard} onCheckedChange={(value) => setForm({ ...form, leaderboard: value })} />
          <ToggleRow disabled={!canEdit} label="Recruiting" description="Expose recruiting pipeline and funnel tools to permitted roles." checked={form.recruiting} onCheckedChange={(value) => setForm({ ...form, recruiting: value })} />
        </Section>
        {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save agency settings"}</Button>}
      </div>
      <div className="space-y-4"><Section title="White-label readiness" description="Agency-level branding controls are connected. Custom domains and outbound email branding are not set up: they would need DNS verification, which this workspace does not offer yet."><div className="grid h-28 place-items-center rounded-md border border-dashed border-border" style={{ borderTopColor: form.accent, borderTopWidth: 4 }}><div className="text-center"><Palette className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{form.name || brand.legalName}</p><p className="text-xs text-muted-foreground">{form.subdomain || "workspace"}.agency</p></div></div><p className="text-xs text-muted-foreground">Custom domain: not set up. There is no DNS verification flow in this workspace, so there is nothing to connect here.</p></Section></div>
    </div>
  </QueryState>;
}

function NotificationSettings() {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["notification-prefs", user?.id];
  const [prefs, setPrefs] = useState<NotificationState>(NOTIFICATION_PREF_DEFAULTS);
  // Set when a toggle changes, cleared by a successful save. While set, a
  // background refetch must not replace what the user changed (F34).
  const [dirty, setDirty] = useState(false);
  const query = useQuery({
    queryKey,
    enabled: Boolean(user),
    queryFn: async () => {
      // user_id is the primary key of notification_prefs, so maybeSingle cannot be ambiguous here.
      const { data, error } = await supabase.from("notification_prefs").select("achievement_alert,deal_celebration,discord_enabled,morning_huddle,weekly_summary").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      // null is a completed read with no row: a confirmed new record, not a failure.
      return data;
    },
  });
  useEffect(() => { if (!dirty && query.data) setPrefs(notificationPrefsFromRow(query.data)); }, [query.data, dirty]);
  const read = notificationPrefsRead({ hasUser: Boolean(user), authLoading, isPending: query.isPending, isError: query.isError, data: query.data });
  const canSave = canSaveNotificationPrefs(read);
  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      // Never upsert the defaults over a row that was never read (F34).
      if (!canSave) throw new Error("Your saved preferences have not loaded, so nothing was written.");
      const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      return prefs;
    },
    onSuccess: (saved) => {
      // Seed the cache with what was written before clearing dirty, so the form
      // does not flash the previous server row while the confirming refetch runs.
      queryClient.setQueryData(queryKey, saved);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Notification preferences saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save preferences"),
  });
  const items: Array<[keyof NotificationState, string, string]> = [["morning_huddle", "Morning huddle", "Daily priorities, meetings, recruiting opportunity, and money alert."], ["weekly_summary", "Weekly summary", "Production, recruiting, and retention recap."], ["deal_celebration", "Deal celebrations", "Notify me when business is submitted or issued."], ["achievement_alert", "Achievements", "Notify me when team milestones are reached."]];
  const update = (key: keyof NotificationState, value: boolean) => { setPrefs((current) => ({ ...current, [key]: value })); setDirty(true); };
  if (read === "signed-out") return <div className="max-w-3xl"><QueryState status="error" label="notification preferences" error="Not signed in." /></div>;
  return <div className="max-w-3xl space-y-4">
    <QueryState {...describeQuery({ isPending: query.isPending, isError: query.isError, data: query.data, isEmpty: false, error: query.error })} label="notification preferences" onRetry={() => void query.refetch()} asOf={query.dataUpdatedAt}>
      {read === "new" && <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">No preferences are saved for this account yet. The toggles show the defaults; Save creates your record.</p>}
      <Section title="Notification preferences" description="Control the operational updates sent to your account.">{items.map(([key, label, description]) => <ToggleRow key={key} label={label} description={description} checked={prefs[key]} onCheckedChange={(value) => update(key, value)} />)}</Section>
      <Button onClick={() => save.mutate()} disabled={save.isPending || !canSave}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save preferences"}</Button>
    </QueryState>
  </div>;
}

function SecurityControls() {
  // The audit found the Security tab titled "Security settings" while carrying
  // zero security controls. These are the two real ones the auth layer offers.
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const changePw = useMutation({
    mutationFn: async () => {
      if (pw.next.length < 8) throw new Error("Password must be at least 8 characters");
      if (pw.next !== pw.confirm) throw new Error("Passwords do not match");
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
    },
    onSuccess: () => { setPw({ next: "", confirm: "" }); toast.success("Password updated"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update password"),
  });
  const signOutOthers = useMutation({
    mutationFn: async () => { const { error } = await supabase.auth.signOut({ scope: "others" }); if (error) throw error; },
    onSuccess: () => toast.success("Signed out of all other devices"),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not sign out other sessions"),
  });
  return <div className="max-w-3xl space-y-4">
    <Section title="Change password" description="Set a new password for signing in with email.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium">New password<Input className="mt-1.5" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        <label className="block text-xs font-medium">Confirm password<Input className="mt-1.5" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
      </div>
      <Button onClick={() => changePw.mutate()} disabled={changePw.isPending || !pw.next}><Save className="mr-2 h-4 w-4" />{changePw.isPending ? "Updating…" : "Update password"}</Button>
    </Section>
    <Section title="Active sessions" description="Sign out everywhere except this device. Use this after logging in on a shared computer.">
      <Button variant="outline" onClick={() => signOutOthers.mutate()} disabled={signOutOthers.isPending}><LockKeyhole className="mr-2 h-4 w-4" />{signOutOthers.isPending ? "Signing out…" : "Sign out other devices"}</Button>
    </Section>
  </div>;
}

// Security holds identity and session controls only. The calendar feed and the
// iPhone shortcuts were listed here too (F35); they now have tabs of their own.
function SecuritySettings() { return <SecurityControls />; }

function AccountSettings() { return <ProfileSettings />; }

// Connections between this app and tools outside it (F35). The calendar feed
// is per person. Discord is workspace-wide and admin-only: every alert sender
// resolves its webhook from system_settings.discord_webhook_url* or the
// DISCORD_WEBHOOK_URL* env (supabase/functions/_shared/apex.ts), which the
// admin Integrations page (/dashboard/integrations) saves and tests. This tab
// opens that page instead of keeping a second editor for the same webhook.
function IntegrationsSettings({ isAdmin }: { isAdmin: boolean }) {
  return <div className="max-w-3xl space-y-4">
    <CalendarSyncSection />
    {isAdmin && <Section title="Discord notifications" description="Deal, applicant and milestone alerts post to your team's Discord channel through a webhook. The webhook is saved, and checked with a test message, on the admin Integrations page.">
      <Button asChild variant="outline"><Link to="/dashboard/integrations"><MessageSquare className="mr-2 h-4 w-4" />Open Discord notifications</Link></Button>
    </Section>}
  </div>;
}

// One-tap shortcuts for the phone. They open pages in this app and change
// nothing on the account, which is why they are not under Security (F35).
function AutomationSettings() {
  return <div className="max-w-3xl space-y-4"><IPhoneShortcutsSection /></div>;
}

// No billing provider is wired to this workspace and no portal function exists,
// so there is no owner action to offer. The state says so instead of showing a
// button that can never be pressed (F36).
function BillingSettings() { const brand = resolveBrand(); return <div className="max-w-3xl"><Section title="Billing & plan" description={`Subscription and billing for ${brand.productName}.`}><div className="flex items-start gap-3 rounded-md border border-border p-4"><Database className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><p className="text-sm font-semibold">Not set up</p><p className="mt-1 text-xs text-muted-foreground">No billing provider is connected to this workspace, so there is no portal to open and no invoices or plan details to show. Nothing on this page is estimated.</p></div></div></Section></div>; }

// /dashboard/nova is the built-in Help Center (static FAQ + support desk); it
// calls no AI service. The AI service behind applicant summaries, the lead
// qualification chat and the AI summary report is ai-assistant. Its state is
// never asserted from copy: it reads "Not verified" until a check runs (F36).
function AssistantSettings() {
  const probe = useMutation({
    mutationFn: async (): Promise<AssistantProbeVerdict & { checkedAt: number }> => {
      const { data, error } = await supabase.functions.invoke("ai-assistant", { body: ASSISTANT_PROBE_BODY });
      let httpStatus: number | null = error ? null : 200;
      let body: unknown = data;
      let transportError: string | null = null;
      if (error) {
        // supabase-js wraps a non-2xx answer as FunctionsHttpError with the raw Response in error.context.
        const ctx = (error as { context?: unknown }).context;
        if (ctx instanceof Response) {
          httpStatus = ctx.status;
          try { body = await ctx.json(); } catch { body = null; }
        } else {
          transportError = error.message || "no response";
        }
      }
      return { ...classifyAssistantProbe({ httpStatus, body, transportError }), checkedAt: Date.now() };
    },
  });
  const verdict = probe.data;
  const headline = probe.isError ? "Check failed" : (verdict?.headline ?? "Not verified");
  const detail = probe.isError
    ? (probe.error instanceof Error ? probe.error.message : "The check did not complete.")
    : (verdict?.detail ?? "No check has run since this tab was opened. Check service sends the AI service a request it must reject, which shows it is up and configured without spending a model call.");
  const tone = verdict?.status === "reachable" ? "text-primary" : verdict && verdict.status !== "unverified" ? "text-destructive" : "text-muted-foreground";
  return <div className="max-w-3xl space-y-4">
    <Section title="Help Center" description="The Assistant tab opens the built-in Help Center: a searchable FAQ and support desk that runs inside this app and does not call an AI service.">
      <Button asChild><Link to="/dashboard/nova"><LifeBuoy className="mr-2 h-4 w-4" />Open Help Center</Link></Button>
    </Section>
    <Section title="AI assistant" description="Applicant summaries, the lead qualification chat and the AI summary report call the ai-assistant service. Its state is only known after a check; nothing here is assumed.">
      <div className="flex items-start gap-3 rounded-md border border-border p-4" role="status" aria-live="polite">
        <Activity className={cn("mt-0.5 h-5 w-5", tone)} />
        <div>
          <p className="text-sm font-semibold">{headline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          {verdict && !probe.isError && <p className="mt-1 text-xs text-muted-foreground">Checked {formatAsOf(verdict.checkedAt)}.</p>}
        </div>
      </div>
      <Button variant="outline" onClick={() => probe.mutate()} disabled={probe.isPending}><Activity className="mr-2 h-4 w-4" />{probe.isPending ? "Checking…" : verdict ? "Check again" : "Check service"}</Button>
    </Section>
  </div>;
}

export default function Settings() {
  const { isAdmin } = useAuth();
  const { pathname, search } = useLocation();
  const requested = useMemo(() => resolveSettingMode(pathname, search), [pathname, search]);
  // A non-admin landing on an owner-only tab (old link, direct URL) falls back to their profile.
  const mode: SettingMode = !isAdmin && ADMIN_SETTING_MODES.includes(requested) ? "profile" : requested;
  const tab = SETTINGS_TABS[mode];
  usePageTitle(tab.title);
  const body = mode === "agency" ? <AgencySettings /> : mode === "notifications" ? <NotificationSettings /> : mode === "security" ? <SecuritySettings /> : mode === "integrations" ? <IntegrationsSettings isAdmin={isAdmin} /> : mode === "automation" ? <AutomationSettings /> : mode === "billing" ? <BillingSettings /> : mode === "nova-pro" ? <AssistantSettings /> : <AccountSettings />;
  return <div className="space-y-5"><PageHeader eyebrow="Settings" title={tab.title} subtitle="Configure your workspace without leaving the operating system." /><SettingsNav mode={mode} isAdmin={isAdmin} />{body}</div>;
}
