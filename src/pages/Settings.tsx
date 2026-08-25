import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Bell, Bot, Building2, CreditCard, Database, LockKeyhole, Palette, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { CalendarSyncSection } from "@/components/dashboard/CalendarSyncSection";
import { IPhoneShortcutsSection } from "@/components/dashboard/IPhoneShortcutsSection";
import { ProfileSettings } from "@/components/dashboard/ProfileSettings";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { resolveBrand } from "@/config/brand";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SettingMode = "profile" | "agency" | "notifications" | "security" | "billing" | "nova-pro";
type AgencyState = { name: string; subdomain: string; accent: string; personalDeals: boolean; leaderboard: boolean; recruiting: boolean };
type AgencyBranding = { display_name: string; subdomain: string; accent_color: string; show_personal_deals: boolean; show_leaderboard: boolean; show_recruiting: boolean; can_edit: boolean };
type NotificationState = { achievement_alert: boolean; deal_celebration: boolean; discord_enabled: boolean; morning_huddle: boolean; weekly_summary: boolean };

const nav: Array<{ key: SettingMode; label: string; icon: typeof Building2 }> = [
  { key: "agency", label: "Agency", icon: Building2 },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "security", label: "Security", icon: LockKeyhole },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "nova-pro", label: "Assistant", icon: Bot },
];

function SettingsNav({ mode }: { mode: SettingMode }) {
  return <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Settings sections">
    {nav.map(({ key, label, icon: Icon }) => <Button key={key} asChild variant="ghost" className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}><Link to={`/dashboard/settings/${key}`}><Icon className="mr-2 h-4 w-4" />{label}</Link></Button>)}
  </nav>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <GlassCard className="p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p><div className="mt-5 space-y-4">{children}</div></GlassCard>;
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border/70 pb-4 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>;
}

function AgencySettings() {
  const brand = resolveBrand();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgencyState>({ name: brand.legalName, subdomain: "apex", accent: "#d4a900", personalDeals: true, leaderboard: true, recruiting: true });
  const [samplePreview, setSamplePreview] = useState(() => window.localStorage.getItem("agentcloud_sample_preview") === "true");
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
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
    <div className="space-y-4">
      {!settings.isLoading && !settings.data?.can_edit && <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">You are viewing your agency's live branding. Only the pre-wired agency owner can change it.</div>}
      <Section title="Agency identity" description="The name and color your team sees throughout the operating system.">
        <label className="block text-xs font-medium">Agency name<Input disabled={!settings.data?.can_edit} className="mt-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Workspace subdomain<Input disabled={!settings.data?.can_edit} className="mt-1.5" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></label><label className="block text-xs font-medium">Accent color<div className="mt-1.5 flex gap-2"><Input disabled={!settings.data?.can_edit} type="color" className="h-10 w-14 p-1" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /><Input disabled={!settings.data?.can_edit} value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /></div></label></div>
      </Section>
      <Section title="Workspace visibility" description="Choose which operating areas appear for producers.">
        <ToggleRow label="Personal deals" description="Allow producers to see and manage their own deal pipeline." checked={form.personalDeals} onCheckedChange={(value) => setForm({ ...form, personalDeals: value })} />
        <ToggleRow label="Leaderboard" description="Show team production rankings and recognition." checked={form.leaderboard} onCheckedChange={(value) => setForm({ ...form, leaderboard: value })} />
        <ToggleRow label="Recruiting" description="Expose recruiting pipeline and funnel tools to permitted roles." checked={form.recruiting} onCheckedChange={(value) => setForm({ ...form, recruiting: value })} />
      </Section>
      <Button onClick={() => save.mutate()} disabled={!settings.data?.can_edit || save.isPending || settings.isLoading}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save agency settings"}</Button>
    </div>
    <div className="space-y-4"><Section title="White-label readiness" description="Agency-level branding controls are connected. Custom domains and outbound email branding require DNS verification."><div className="grid h-28 place-items-center rounded-md border border-dashed border-border" style={{ borderTopColor: form.accent, borderTopWidth: 4 }}><div className="text-center"><Palette className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{form.name || brand.legalName}</p><p className="text-xs text-muted-foreground">{form.subdomain || "workspace"}.agency</p></div></div><Button variant="outline" className="w-full" disabled>Connect custom domain</Button></Section><Section title="Add sample data" description="Preview a labelled example workspace without writing fake policies, applicants, or revenue to production."><ToggleRow label="Sample preview" description={samplePreview ? "Labelled sample preview is on for this browser." : "Production data remains unchanged."} checked={samplePreview} onCheckedChange={(value) => { setSamplePreview(value); window.localStorage.setItem("agentcloud_sample_preview", String(value)); toast.success(value ? "Sample preview enabled" : "Sample preview disabled"); }} /></Section></div>
  </div>;
}

function NotificationSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationState>({ achievement_alert: true, deal_celebration: true, discord_enabled: false, morning_huddle: true, weekly_summary: true });
  const query = useQuery({ queryKey: ["notification-prefs", user?.id], enabled: Boolean(user), queryFn: async () => { const { data, error } = await supabase.from("notification_prefs").select("achievement_alert,deal_celebration,discord_enabled,morning_huddle,weekly_summary").eq("user_id", user!.id).maybeSingle(); if (error) throw error; return data; } });
  useEffect(() => { if (query.data) setPrefs({ achievement_alert: query.data.achievement_alert ?? true, deal_celebration: query.data.deal_celebration ?? true, discord_enabled: query.data.discord_enabled ?? false, morning_huddle: query.data.morning_huddle ?? true, weekly_summary: query.data.weekly_summary ?? true }); }, [query.data]);
  const save = useMutation({ mutationFn: async () => { if (!user) throw new Error("Sign in required"); const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" }); if (error) throw error; }, onSuccess: () => toast.success("Notification preferences saved"), onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save preferences") });
  const items: Array<[keyof NotificationState, string, string]> = [["morning_huddle", "Morning huddle", "Daily priorities, meetings, recruiting opportunity, and money alert."], ["weekly_summary", "Weekly summary", "Production, recruiting, and retention recap."], ["deal_celebration", "Deal celebrations", "Notify me when business is submitted or issued."], ["achievement_alert", "Achievements", "Notify me when team milestones are reached."], ["discord_enabled", "Discord delivery", "Also deliver enabled alerts to the configured team channel."]];
  return <div className="max-w-3xl space-y-4"><Section title="Notification preferences" description="Control the operational updates sent to your account.">{items.map(([key, label, description]) => <ToggleRow key={key} label={label} description={description} checked={prefs[key]} onCheckedChange={(value) => setPrefs({ ...prefs, [key]: value })} />)}</Section><Button onClick={() => save.mutate()} disabled={save.isPending || query.isLoading}><Save className="mr-2 h-4 w-4" />Save preferences</Button></div>;
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
    <Section title="Active sessions" description="Sign out everywhere except this device — use after logging in on a shared computer.">
      <Button variant="outline" onClick={() => signOutOthers.mutate()} disabled={signOutOthers.isPending}><LockKeyhole className="mr-2 h-4 w-4" />{signOutOthers.isPending ? "Signing out…" : "Sign out other devices"}</Button>
    </Section>
  </div>;
}

function SecuritySettings() { return <div className="space-y-4"><SecurityControls /><div className="max-w-4xl space-y-4"><CalendarSyncSection /><IPhoneShortcutsSection /></div></div>; }

function BillingSettings() { const brand = resolveBrand(); return <div className="max-w-3xl"><Section title="Billing & plan" description={`Manage the subscription and billing connection for ${brand.productName}.`}><div className="flex items-start gap-3 rounded-md border border-border p-4"><Database className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><p className="text-sm font-semibold">Billing connection required</p><p className="mt-1 text-xs text-muted-foreground">No verified billing provider is connected to this workspace, so invoices and plan data are intentionally not fabricated.</p></div></div><Button variant="outline" disabled>Open billing portal</Button></Section></div>; }

function AssistantSettings() { return <div className="max-w-3xl"><Section title="AI assistant" description="Use the assistant for daily priorities, recruiting follow-up, sales execution, and operational questions."><div className="flex items-start gap-3 rounded-md border border-border p-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-500" /><div><p className="text-sm font-semibold">Workspace assistant enabled</p><p className="mt-1 text-xs text-muted-foreground">Answers use the permissions of the signed-in account. Sensitive actions still require confirmation.</p></div></div><Button asChild><Link to="/dashboard/nova"><Bot className="mr-2 h-4 w-4" />Open assistant</Link></Button></Section></div>; }

export default function Settings() {
  const path = useLocation().pathname;
  const mode = useMemo<SettingMode>(() => nav.find(({ key }) => path.endsWith(`/${key}`))?.key ?? "profile", [path]);
  usePageTitle(`${mode === "nova-pro" ? "Assistant" : mode.charAt(0).toUpperCase() + mode.slice(1)} Settings`);
  const body = mode === "agency" ? <AgencySettings /> : mode === "notifications" ? <NotificationSettings /> : mode === "security" ? <SecuritySettings /> : mode === "billing" ? <BillingSettings /> : mode === "nova-pro" ? <AssistantSettings /> : <div className="space-y-4"><ProfileSettings /><div className="max-w-4xl space-y-4"><CalendarSyncSection /><IPhoneShortcutsSection /></div></div>;
  return <div className="space-y-5"><PageHeader eyebrow="Settings" title={mode === "profile" ? "Account settings" : mode === "nova-pro" ? "AI assistant" : `${mode.charAt(0).toUpperCase() + mode.slice(1)} settings`} subtitle="Configure your workspace without leaving the operating system." /><SettingsNav mode={mode} />{body}</div>;
}
