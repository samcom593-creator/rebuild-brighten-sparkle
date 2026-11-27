import { useState, type ElementType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Instagram, Music2, Camera, Youtube, RefreshCw } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { ContentWorkspaceNav } from "@/components/content/ContentWorkspaceNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { parseSnapshotNumber, snapshotAccounts, snapshotObservation, snapshotWindow, socialProfileUrl, type SocialSnapshot } from "@/lib/socialSnapshots";

const PLATFORMS = [
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "tiktok", label: "TikTok", icon: Music2 },
  { key: "youtube", label: "YouTube", icon: Youtube },
  { key: "snapchat", label: "Snapchat", icon: Camera },
];
const fmt = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";

export default function SocialDashboard() {
  usePageTitle("Social analytics · Galaxy");
  const snapshots = useQuery({
    queryKey: ["social-latest"], staleTime: 60_000,
    queryFn: async (): Promise<SocialSnapshot[]> => {
      const { data, error } = await supabase.from("v_social_latest").select("*");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Social observations could not be verified.");
      return data as SocialSnapshot[];
    },
  });
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-4 sm:px-6">
      <PageHeader title="Social analytics" eyebrow="Grow" subtitle="Saved account observations. Each number keeps its source and date." actions={<Button variant="outline" onClick={() => void snapshots.refetch()} disabled={snapshots.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} />
      <ContentWorkspaceNav />
      <p className="text-sm text-muted-foreground">An imported snapshot does not confirm that an account is connected now. Recruiting outcomes live in Social Command.</p>
      {snapshots.isLoading ? <p role="status">Loading account observations…</p> : snapshots.isError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4">Social observations could not be loaded. Use Refresh to try again.</div>
      ) : <div className="grid gap-4 lg:grid-cols-2">{PLATFORMS.map(platform => <PlatformCard key={platform.key} platform={platform.key} label={platform.label} icon={platform.icon} rows={snapshotAccounts(snapshots.data ?? [], platform.key)} />)}</div>}
    </div>
  );
}

function PlatformCard({ platform, label, icon: Icon, rows }: { platform: string; label: string; icon: ElementType; rows: SocialSnapshot[] }) {
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const snapshot = rows.find(row => row.handle === selected) ?? rows[0] ?? null;
  const handle = snapshot?.handle.trim().replace(/^@/, "") ?? "";
  const href = socialProfileUrl(platform, handle);
  const windowDays = snapshot ? snapshotWindow(snapshot) : 7;
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5" />{label}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {rows.length > 1 && <label className="block text-sm">Account<select aria-label={`${label} account`} value={snapshot?.handle ?? ""} onChange={event => { setSelected(event.target.value); setEditing(false); }} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3">{rows.map(row => <option key={row.handle} value={row.handle}>@{row.handle.replace(/^@/, "")}</option>)}</select></label>}
      {snapshot ? <>
        <p className="font-medium">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">@{handle}</a> : handle || "Account not recorded"}</p>
        <p className="text-sm text-muted-foreground">{snapshotObservation(snapshot)}</p>
        <dl className="grid grid-cols-3 gap-3">
          <div><dt className="text-sm text-muted-foreground">Followers</dt><dd className="text-xl font-semibold tabular-nums">{fmt(snapshot.followers)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Views · {windowDays}d</dt><dd className="text-xl font-semibold tabular-nums">{fmt(snapshot.views_7d)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Reach · {windowDays}d</dt><dd className="text-xl font-semibold tabular-nums">{fmt(snapshot.reach_7d)}</dd></div>
        </dl>
        {snapshot.growth_7d != null && <p className="text-sm">Follower change · 7d: {fmt(snapshot.growth_7d)}</p>}
      </> : <p className="text-sm text-muted-foreground">No account observation recorded.</p>}
      <Button variant="outline" onClick={() => setEditing(value => !value)}>{editing ? "Close entry" : "Add manual observation"}</Button>
      {editing && <SnapshotForm key={`${platform}:${handle}`} platform={platform} label={label} initialHandle={handle} onSaved={() => setEditing(false)} />}
    </CardContent>
  </Card>;
}

function SnapshotForm({ platform, label, initialHandle, onSaved }: { platform: string; label: string; initialHandle: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState(initialHandle);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ followers: "", following: "", posts_total: "", engagement_rate: "", reach_7d: "", views_7d: "", growth_7d: "" });
  const fields = [{ key: "followers", label: "Followers" }, { key: "following", label: "Following" }, { key: "posts_total", label: "Posts total" }, { key: "engagement_rate", label: "Engagement %" }, { key: "reach_7d", label: "Reach (7d)" }, { key: "views_7d", label: "Views (7d)" }, { key: "growth_7d", label: "Growth (7d)" }] as const;
  async function save() {
    if (saving) return;
    try {
      const account = handle.trim().replace(/^@/, "");
      if (!socialProfileUrl(platform, account)) throw new Error("Enter the account handle these numbers belong to.");
      const values = Object.fromEntries(fields.map(field => [field.key, parseSnapshotNumber(draft[field.key], field.label, field.key === "growth_7d", field.key === "engagement_rate")]));
      if (Object.values(values).every(value => value === null)) throw new Error("Enter at least one observed number.");
      setSaving(true);
      const { data, error } = await supabase.from("social_snapshots").insert({ platform, handle: account, ...values, source: "manual", payload: { window_days: 7 } }).select("id").single();
      if (error) throw error;
      if (!data?.id) throw new Error("The observation was not confirmed. Refresh before retrying.");
      await qc.invalidateQueries({ queryKey: ["social-latest"] });
      toast.success(`${label} observation saved`); onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Observation could not be saved."); }
    finally { setSaving(false); }
  }
  return <div className="space-y-3 border-t pt-4">
    <p className="text-sm text-muted-foreground">Enter the account and its current figures from the platform’s own analytics. Reach, views and growth cover seven days.</p>
    <label className="block text-sm">Account handle<Input aria-label={`${label} account handle`} value={handle} onChange={event => setHandle(event.target.value)} className="mt-1" /></label>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <div key={field.key}><Label htmlFor={`${platform}-${field.key}`}>{field.label}</Label><Input id={`${platform}-${field.key}`} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} inputMode="decimal" className="mt-1" /></div>)}</div>
    <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save observation"}</Button>
  </div>;
}
