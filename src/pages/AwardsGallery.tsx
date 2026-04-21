import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Trophy, Search, Filter, Mail, Loader2, Edit3, Upload, RefreshCw, Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlaqueRow {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string;
  amount: number | null;
  badge_label: string | null;
  color_hex: string | null;
  image_svg_url: string | null;
  image_png_url: string | null;
  email_sent_at: string | null;
  email_delivery_status: string | null;
  awarded_at: string | null;
  custom_photo_url?: string | null;
  agent_name?: string;
  agent_photo?: string | null;
}

const TIER_META: Record<string, { label: string; accent: string; emoji: string }> = {
  single_day_platinum: { label: "Platinum",    accent: "border-purple-400/50 bg-purple-500/10 text-purple-300",  emoji: "💎" },
  single_day:          { label: "Gold",        accent: "border-amber-400/50 bg-amber-500/10 text-amber-300",      emoji: "🥇" },
  single_day_bronze:   { label: "Bronze",      accent: "border-orange-600/50 bg-orange-700/10 text-orange-300",   emoji: "🥉" },
  weekly:              { label: "Weekly",      accent: "border-sky-400/50 bg-sky-500/10 text-sky-300",            emoji: "💠" },
  monthly:             { label: "Monthly",     accent: "border-violet-400/50 bg-violet-500/10 text-violet-300",   emoji: "👑" },
  hot_streak:          { label: "Streak",      accent: "border-rose-400/50 bg-rose-500/10 text-rose-300",         emoji: "🔥" },
  team_week_50k:       { label: "Team Week",   accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "🏆" },
  team_two_day_20k:    { label: "Team 2-Day",  accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "⚡" },
  team_single_day_10k: { label: "Team Day",    accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "⭐" },
  streak_5:            { label: "5-Streak",    accent: "border-rose-400/50 bg-rose-500/10 text-rose-300",         emoji: "🔥" },
  first_deal_of_day:   { label: "First Deal",  accent: "border-primary/50 bg-primary/10 text-primary",            emoji: "🌅" },
  diamond_week:        { label: "Diamond",     accent: "border-cyan-400/50 bg-cyan-500/10 text-cyan-300",         emoji: "💎" },
};

function fmt$(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function AwardsGallery() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<PlaqueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTier] = useState<string>("all");
  const [emailing, setEmailing] = useState(false);
  const [editing, setEditing] = useState<PlaqueRow | null>(null);
  const [rendering, setRendering] = useState(false);
  const [requestingPhotos, setRequestingPhotos] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: pl } = await supabase
          .from("plaque_awards")
          .select("id, agent_id, milestone_type, milestone_date, amount, badge_label, color_hex, image_svg_url, image_png_url, email_sent_at, email_delivery_status, awarded_at, custom_photo_url")
          .order("milestone_date", { ascending: false })
          .limit(500);
        const list = (pl ?? []) as PlaqueRow[];
        const agentIds = [...new Set(list.map(p => p.agent_id).filter(Boolean))];
        const { data: agents } = agentIds.length
          ? await supabase.from("agents").select("id, profile:profiles(full_name, avatar_url, photo_url)").in("id", agentIds)
          : { data: [] } as any;
        const nameMap: Record<string, string> = {};
        const photoMap: Record<string, string | null> = {};
        for (const a of (agents ?? []) as any[]) {
          nameMap[a.id] = a.profile?.full_name ?? "Agent";
          photoMap[a.id] = a.profile?.avatar_url ?? a.profile?.photo_url ?? null;
        }
        if (!cancelled) setRows(list.map(r => ({
          ...r,
          agent_name: nameMap[r.agent_id] ?? "Agent",
          agent_photo: r.custom_photo_url ?? photoMap[r.agent_id] ?? null,
        })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => tierFilter === "all" || r.milestone_type === tierFilter)
      .filter(r => !q || (r.agent_name ?? "").toLowerCase().includes(q) || r.milestone_type.toLowerCase().includes(q));
  }, [rows, search, tierFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.milestone_type] = (c[r.milestone_type] ?? 0) + 1;
    return c;
  }, [rows]);

  const totalValue = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    [filtered],
  );

  const emailAllToMe = async () => {
    setEmailing(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-plaque-batch", {
        body: { limit: 100, admin_email: "info@kingofsales.net", target_admin_email: true },
      });
      if (error) throw error;
      toast.success(`Sent ${(data as any)?.sent ?? 0} plaques to info@kingofsales.net`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — send-plaque-batch may not be deployed yet");
    } finally {
      setEmailing(false);
    }
  };

  const renderAll = async () => {
    setRendering(true);
    try {
      const { data, error } = await supabase.functions.invoke("render-all-plaques", {
        body: { limit: 500, force: true },
      });
      if (error) throw error;
      const d = data as any;
      toast.success(`Rendered ${d?.updated ?? 0} plaques (${d?.with_photo ?? 0} w/ photo, ${d?.no_photo ?? 0} without)`);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — render-all-plaques may not be deployed yet");
    } finally {
      setRendering(false);
    }
  };

  const requestPhotos = async () => {
    setRequestingPhotos(true);
    try {
      const { data, error } = await supabase.functions.invoke("request-agent-photos", {
        body: { limit: 100 },
      });
      if (error) throw error;
      const d = data as any;
      toast.success(`Pinged ${d?.eligible ?? 0} agents (${d?.emails_sent ?? 0} emails, ${d?.sms_sent ?? 0} SMS)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — request-agent-photos may not be deployed yet");
    } finally {
      setRequestingPhotos(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      let photoUrl: string | null = editing.custom_photo_url ?? null;

      if (photoFile) {
        const path = `plaque-photos/${editing.agent_id}/${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("public").upload(path, photoFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("public").getPublicUrl(path);
        photoUrl = pub.publicUrl;
      }

      const { error: updErr } = await supabase
        .from("plaque_awards")
        .update({ custom_photo_url: photoUrl, image_svg_url: null })
        .eq("id", editing.id);
      if (updErr) throw updErr;

      // Trigger re-render for this specific plaque
      await supabase.functions.invoke("render-all-plaques", {
        body: { agent_id: editing.agent_id, force: true, limit: 100 },
      });

      toast.success("Saved — plaque re-rendered");
      setEditing(null);
      setPhotoFile(null);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Trophy className="h-6 w-6 text-amber-400" />
        <h1 className="text-2xl md:text-3xl font-bold">Awards Gallery</h1>
        {isAdmin && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={renderAll} disabled={rendering}>
              {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Render All
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={requestPhotos} disabled={requestingPhotos}>
              {requestingPhotos ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              Request Photos
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={emailAllToMe} disabled={emailing}>
              {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Email Digest
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Plaques</div>
          <div className="text-2xl font-bold tabular-nums">{filtered.length}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Value</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmt$(totalValue)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">💎 Platinum</div>
          <div className="text-2xl font-bold tabular-nums text-purple-300">{counts.single_day_platinum ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥇 Gold</div>
          <div className="text-2xl font-bold tabular-nums text-amber-300">{counts.single_day ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥉 Bronze</div>
          <div className="text-2xl font-bold tabular-nums text-orange-300">{counts.single_day_bronze ?? 0}</div>
        </GlassCard>
      </div>

      <GlassCard className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agent or tier…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTier}>
          <SelectTrigger className="w-[170px] h-9"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            {Object.entries(TIER_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.emoji} {v.label} ({counts[k] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassCard>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassCard key={i} className="p-4 animate-pulse h-48" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          No plaques match these filters yet.
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(p => {
            const meta = TIER_META[p.milestone_type] ?? { label: p.milestone_type, accent: "border-border bg-muted/30 text-foreground", emoji: "🏅" };
            return (
              <GlassCard key={p.id} className={cn(
                "p-4 relative group card-tilt reveal",
                meta.accent.split(" ")[0],
                p.milestone_type === "single_day_platinum" && "win-glow",
                p.milestone_type === "single_day" && "gold-glow",
              )}>
                {isAdmin && (
                  <button
                    onClick={() => setEditing(p)}
                    className="absolute top-3 right-3 h-7 w-7 rounded-full bg-black/60 border border-white/10 backdrop-blur text-white/80 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                    title="Edit plaque"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{meta.emoji}</span>
                    <Badge className={cn("text-[10px] border", meta.accent)}>{meta.label}</Badge>
                  </div>
                  {p.email_sent_at ? (
                    <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-300">emailed</Badge>
                  ) : null}
                </div>
                {p.image_svg_url ? (
                  <div className="mb-3 rounded-md overflow-hidden bg-background/40" style={{ aspectRatio: "9 / 16", maxHeight: 220 }}>
                    <img src={p.image_svg_url} alt="" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="mb-3 h-32 rounded-md bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
                    Image pending
                  </div>
                )}
                <div className="text-sm font-semibold truncate">{p.agent_name}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">
                    {p.milestone_date ? format(new Date(p.milestone_date), "MMM d, yyyy") : "—"}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-emerald-400">{fmt$(p.amount)}</span>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* ── Admin edit dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setPhotoFile(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plaque</DialogTitle>
            <DialogDescription>
              {editing?.agent_name} · {editing && TIER_META[editing.milestone_type]?.label} · {fmt$(editing?.amount ?? 0)}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              {editing.image_svg_url && (
                <img src={editing.image_svg_url} alt="" className="w-full rounded-lg border border-border/40" />
              )}

              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Custom plaque photo</Label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border/60 px-3 py-2 text-sm hover:bg-muted/20">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    {photoFile ? photoFile.name.slice(0, 24) : "Choose image…"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                {editing.custom_photo_url && !photoFile && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Current custom photo set. Pick a file to replace.
                  </p>
                )}
                {!editing.custom_photo_url && !photoFile && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Falls back to agent profile photo if empty.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditing(null); setPhotoFile(null); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Save & re-render
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
