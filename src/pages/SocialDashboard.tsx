import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Instagram, Music2, Camera, Youtube, TrendingUp, Users, Eye, BarChart3 } from "lucide-react";

import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface SocialSnapshot {
  platform: string;
  handle: string;
  followers: number | null;
  following: number | null;
  posts_total: number | null;
  engagement_rate: number | null;
  growth_7d: number | null;
  views_7d: number | null;
  taken_at: string;
  source: string;
}

const PLATFORMS = [
  { key: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-500", handle: "theprincejames" },
  { key: "tiktok",    label: "TikTok",    icon: Music2,    color: "text-slate-700 dark:text-slate-200", handle: "theprincejames" },
  { key: "youtube",   label: "YouTube",   icon: Youtube,   color: "text-red-500", handle: "@SamuelJamesHQ" },
  { key: "snapchat",  label: "Snapchat",  icon: Camera,    color: "text-yellow-500", handle: "theprincejames" },
] as const;

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function SocialDashboard() {
  usePageTitle("Social · APEX");

  const snapshots = useQuery({
    queryKey: ["social-latest"],
    staleTime: 60_000,
    queryFn: async (): Promise<SocialSnapshot[]> => {
      const { data, error } = await supabase
        .from("v_social_latest")
        .select("*");
      if (error) throw error;
      return (data ?? []) as SocialSnapshot[];
    },
  });

  const latest = (platform: string) =>
    snapshots.data?.find((s) => s.platform === platform) ?? null;

  const isImported = (key: string) => latest(key)?.source === "imported";
  const metricoolConnected = PLATFORMS.filter((p) => isImported(p.key)).length;

  const PLATFORM_LINK: Record<string, (h: string) => string> = {
    instagram: (h) => `https://instagram.com/${h.replace(/^@/, "")}`,
    youtube: (h) => h.startsWith("UC") ? `https://youtube.com/channel/${h}` : `https://youtube.com/${h}`,
    tiktok: (h) => `https://tiktok.com/@${h.replace(/^@/, "")}`,
    snapchat: (h) => `https://snapchat.com/add/${h.replace(/^@/, "")}`,
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Brand · Growth"
        eyebrowIcon={<TrendingUp className="h-3 w-3" />}
        title="Social analytics"
        subtitle={
          metricoolConnected > 0
            ? `${metricoolConnected} platforms wired to Metricool · auto-syncs every 6h`
            : "Drop a Metricool token + run metricool-sync to wire follower auto-pull."
        }
        accent="emerald"
      />

      {/* Top-line summary across platforms */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLATFORMS.map(({ key, label, icon: Icon, color, handle }) => {
          const s = latest(key);
          const connected = s?.source === "imported";
          const link = PLATFORM_LINK[key]?.(handle);
          return (
            <Card
              key={key}
              className={`bg-white dark:bg-slate-900 border ${
                connected ? "border-emerald-500/40" : "border-slate-200 dark:border-slate-800"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${color}`} />
                    <span className="text-12 font-semibold uppercase tracking-wider text-slate-500">{label}</span>
                  </div>
                  {connected && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                      Metricool
                    </Badge>
                  )}
                </div>
                <p className="text-28 font-bold tabular-nums">{fmt(s?.followers ?? null)}</p>
                <p className="text-12 text-slate-500">
                  followers ·{" "}
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600">
                      @{handle}
                    </a>
                  ) : (
                    <span>@{handle}</span>
                  )}
                </p>
                {s?.growth_7d != null && (
                  <p className={`mt-1 text-12 ${s.growth_7d >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                    {s.growth_7d >= 0 ? "+" : ""}{fmt(s.growth_7d)} this week
                  </p>
                )}
                {!connected && s == null && (
                  <p className="text-11 text-slate-400 mt-1">No data yet — paste your weekly numbers below.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Per-platform tabs */}
      <Tabs defaultValue="instagram" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-3 bg-slate-100 dark:bg-slate-800">
          {PLATFORMS.map(({ key, label, icon: Icon }) => (
            <TabsTrigger key={key} value={key} className="text-12 gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {PLATFORMS.map(({ key, label, handle }) => (
          <TabsContent key={key} value={key} className="space-y-3">
            <PlatformDetail platform={key} label={label} handle={handle} snapshot={latest(key)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function PlatformDetail({
  platform,
  label,
  handle,
  snapshot,
}: {
  platform: string;
  label: string;
  handle: string;
  snapshot: SocialSnapshot | null;
}) {
  const [draft, setDraft] = useState({
    followers: "",
    following: "",
    posts_total: "",
    engagement_rate: "",
    reach_7d: "",
    views_7d: "",
    growth_7d: "",
  });

  const save = async () => {
    const num = (v: string) => v.trim() ? Number(v.replace(/,/g, "")) : null;
    const { error } = await supabase.from("social_snapshots").insert({
      platform,
      handle,
      followers: num(draft.followers),
      following: num(draft.following),
      posts_total: num(draft.posts_total),
      engagement_rate: num(draft.engagement_rate),
      reach_7d: num(draft.reach_7d),
      views_7d: num(draft.views_7d),
      growth_7d: num(draft.growth_7d),
      source: "manual",
    });
    if (error) toast.error(`Save failed: ${error.message}`);
    else {
      toast.success(`${label} snapshot saved`);
      setDraft({ followers: "", following: "", posts_total: "", engagement_rate: "", reach_7d: "", views_7d: "", growth_7d: "" });
    }
  };

  return (
    <>
      {snapshot ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat icon={Users}     label="Followers"      value={snapshot.followers} />
          <Stat icon={Eye}       label="Views (7d)"     value={snapshot.views_7d} />
          <Stat icon={BarChart3} label="Engagement %"   value={snapshot.engagement_rate} format={(n) => n != null ? `${n.toFixed(2)}%` : "—"} />
          <Stat icon={Users}     label="Following"      value={snapshot.following} />
          <Stat icon={TrendingUp} label="Posts total"   value={snapshot.posts_total} />
          <Stat icon={TrendingUp} label="Growth (7d)"   value={snapshot.growth_7d} format={(n) => n != null ? `${n >= 0 ? "+" : ""}${n}` : "—"} />
        </div>
      ) : null}

      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardHeader>
          <CardTitle className="text-16">
            {snapshot ? "Add a fresh snapshot" : `No ${label} data yet`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-12 text-slate-500">
            {platform === "instagram"
              ? "Your IG profile is private, so the auto-pull can't reach it. Open the Insights screen in the Instagram app and paste the numbers here."
              : platform === "tiktok"
              ? "TikTok analytics API requires a creator-account approval. Until that's wired, drop your weekly numbers from the TikTok Studio app."
              : platform === "snapchat"
              ? "Snapchat doesn't expose third-party analytics. Drop your weekly numbers from Snap Insights here."
              : "YouTube auto-pull runs every 6h via vidIQ. You can also drop a fresh snapshot any time."}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Followers"      value={draft.followers}       onChange={(v) => setDraft((d) => ({ ...d, followers: v }))} />
            <Field label="Following"      value={draft.following}       onChange={(v) => setDraft((d) => ({ ...d, following: v }))} />
            <Field label="Posts total"    value={draft.posts_total}     onChange={(v) => setDraft((d) => ({ ...d, posts_total: v }))} />
            <Field label="Engagement %"   value={draft.engagement_rate} onChange={(v) => setDraft((d) => ({ ...d, engagement_rate: v }))} placeholder="3.2" />
            <Field label="Reach (7d)"     value={draft.reach_7d}        onChange={(v) => setDraft((d) => ({ ...d, reach_7d: v }))} />
            <Field label="Views (7d)"     value={draft.views_7d}        onChange={(v) => setDraft((d) => ({ ...d, views_7d: v }))} />
            <Field label="Growth (7d)"    value={draft.growth_7d}       onChange={(v) => setDraft((d) => ({ ...d, growth_7d: v }))} placeholder="+150" />
          </div>
          <Button onClick={save} className="w-full sm:w-auto">Save snapshot</Button>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ icon: Icon, label, value, format }: { icon: React.ElementType; label: string; value: number | null | undefined; format?: (n: number | null) => string }) {
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-12 text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="text-20 font-bold tabular-nums mt-1">{format ? format(value ?? null) : fmt(value ?? null)}</p>
        </div>
        <Icon className="h-5 w-5 text-slate-400" />
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-12 text-slate-500">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "0"} inputMode="numeric" className="mt-1" />
    </div>
  );
}
