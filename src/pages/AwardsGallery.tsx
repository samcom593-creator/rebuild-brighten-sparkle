import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Trophy, Search, Filter, Mail, Loader2, Edit3, Upload, RefreshCw, Camera, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveBrand } from "@/config/brand";

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

/* ────────────────────────────────────────────────────────────────────────────
   TIER TAXONOMY
   ────────────────────────────────────────────────────────────────────────────
   plaque_awards.milestone_type carries TWO generations of keys: the current
   snake_case ones the awarder writes today, and legacy shouty strings pasted in
   by hand ("10K CLUB", "7-DAY STREAK", "40K ELITE"). The old hardcoded map knew
   only the snake_case half, which broke this page in both directions at once:

     · 8 live tiers — 48 of the 332 plaques — had no entry, so their badge
       rendered the raw token ("first_deal_ever") and, worse, the tier filter
       never offered them, making those plaques unreachable by any filter.
     · 4 map entries (weekly, monthly, streak_5, team_total) match nothing in
       the table, so the dropdown advertised filters that always return empty.

   The fix is to stop hardcoding the option list. TIER_META supplies presentation
   for the tiers we have opinions about; tierMeta() title-cases anything it has
   never seen so a raw token can never reach the screen; and the filter options
   are derived from the rows actually loaded, so the dropdown is always exactly
   the set of tiers that exist, with counts that match the grid below.
──────────────────────────────────────────────────────────────────────────── */

/** Brand-safe accents. Every tone carries an explicit light AND dark colour —
 *  a value that only reads on near-black is a bug on Sam's light theme. */
const TONE: Record<string, string> = {
  gold:      "border-primary/50 bg-primary/10 text-primary",
  elite:     "border-primary/60 bg-primary/15 text-primary",
  bronze:    "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  team:      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  streak:    "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  milestone: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  neutral:   "border-border bg-muted/40 text-muted-foreground",
};

interface TierMeta { label: string; accent: string; emoji: string }

const BRAND = resolveBrand();

const TIER_META: Record<string, TierMeta> = {
  // ── current snake_case keys ──────────────────────────────────────────────
  single_day_platinum: { label: "Platinum",     accent: TONE.elite,     emoji: "💎" },
  single_day:          { label: "Gold",         accent: TONE.gold,      emoji: "🥇" },
  single_day_bronze:   { label: "Bronze",       accent: TONE.bronze,    emoji: "🥉" },
  diamond_week:        { label: "Diamond Week", accent: TONE.elite,     emoji: "💠" },
  hot_streak:          { label: "Hot Streak",   accent: TONE.streak,    emoji: "🔥" },
  // Two different awards, previously both reading "First Deal": the daily race
  // (8 rows across 6 agents, one agent can win it repeatedly) versus the career
  // milestone (one per agent). first_deal_ever and the legacy "FIRST DEAL" are
  // the SAME milestone under two key generations, so they share a label and the
  // filter groups them into one option.
  first_deal_of_day:   { label: "First Deal of Day", accent: TONE.gold, emoji: "🌅" },
  first_deal_ever:     { label: "First Ever Deal",   accent: TONE.gold, emoji: "🌱" },
  comeback_champion:   { label: "Comeback",     accent: TONE.streak,    emoji: "💪" },
  monthly_20k:         { label: "$20K Month",   accent: TONE.milestone, emoji: "👑" },
  monthly_top6:        { label: "Top 6 Month",  accent: TONE.team,      emoji: "🏆" },
  march_2026_top6:     { label: "March Top 6",  accent: TONE.team,      emoji: "🏆" },
  lifetime_100k:       { label: "$100K Club",   accent: TONE.elite,     emoji: "💎" },
  team_week_50k:       { label: "Team Week",    accent: TONE.team,      emoji: "🏆" },
  team_two_day_20k:    { label: "Team 2-Day",   accent: TONE.team,      emoji: "⚡" },
  team_single_day_10k: { label: "Team Day",     accent: TONE.team,      emoji: "⭐" },
  // ── legacy hand-pasted keys, previously rendered raw ─────────────────────
  "FIRST DEAL":        { label: "First Ever Deal", accent: TONE.gold,  emoji: "🌱" },
  "10K CLUB":          { label: "$10K Club",    accent: TONE.milestone, emoji: "🎖️" },
  "25K CRUSHER":       { label: "$25K Crusher", accent: TONE.milestone, emoji: "🚀" },
  "40K ELITE":         { label: "$40K Elite",   accent: TONE.elite,     emoji: "👑" },
  [`75K ${BRAND.shortName}`]: { label: `$75K ${BRAND.shortName}`, accent: TONE.elite, emoji: "🏔️" },
  "7-DAY STREAK":      { label: "7-Day Streak", accent: TONE.streak,    emoji: "🔥" },
};

/** Title-cases an unknown milestone key so a raw token ("first_deal_ever",
 *  "40K ELITE") can never reach the screen. Acronyms and $-amounts are kept. */
function titleCaseTier(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (/^\d+[A-Z]*$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function tierMeta(key: string): TierMeta {
  return TIER_META[key] ?? { label: titleCaseTier(key), accent: TONE.neutral, emoji: "🏅" };
}

/** Compact USD for the stat tiles, where a running total is genuinely 0-able. */
function usdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Returns null — never "$0" — when a plaque carries no amount. A plaque with
 *  no premium on file is a data gap, and rendering it as a $0 award states
 *  something about the agent that the row does not support. */
function usdOrNull(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return null;
  return usdCompact(v);
}

function displayName(n?: string): string {
  // Some AgentLink names arrive all-lowercase ("dudley bowman"); normalize for
  // display only — the underlying row is untouched.
  return (n ?? "Agent").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initialsOf(n?: string): string {
  const parts = displayName(n).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "A";
}

/* ────────────────────────────────────────────────────────────────────────────
   THE PLAQUE FACE
   ────────────────────────────────────────────────────────────────────────────
   Why this is drawn in-app rather than shown from storage.

   Every stored plaque is a 1080x1920 raster baked by the awarder, and the baked
   copies carry three defects Sam reported, none of which can be corrected by
   re-reading the row:

     · the agent photo is a small avatar JPEG stretched to fill a 500x1100 panel,
       so it renders as a blurred smear — the "green block" is one agent's
       out-of-focus background at roughly 8x its native size;
     · the wordmark is painted #22d3a5, a teal that predates the black+gold
       identity and now clashes with every other surface;
     · the amount is frozen at whatever was known the day it rendered. Chukwudi
       Ifediora's 2026-05-12 First Deal plaque reads "$0" in the artwork while
       the book shows the deal at $1,031.76.

   The last one is the reason this is a truth fix and not a styling preference.
   A baked number cannot be corrected, cannot be marked unknown, and keeps
   asserting itself long after the row behind it has moved on.

   So the card face is drawn from the row on every render: the amount is whatever
   the row currently holds, an absent amount says so in words instead of showing
   a confident $0, and the photo sits in a small circular frame at a size an
   avatar can actually fill. The baked artwork is not deleted or hidden — it
   stays one click away under "Original art", labelled, for anyone who wants the
   shareable asset.
──────────────────────────────────────────────────────────────────────────── */
function PlaqueFace({ row }: { row: PlaqueRow }) {
  const meta = tierMeta(row.milestone_type);
  const amount = usdOrNull(row.amount);
  const [photoBroken, setPhotoBroken] = useState(false);
  const photo = !photoBroken ? row.agent_photo ?? null : null;

  return (
    <div className="relative min-h-[184px] overflow-hidden rounded-lg border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-background px-4 py-3.5">
      {/* ghosted tier watermark — scaled to sit inside the card at any width */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-3 bottom-8 truncate text-right text-3xl font-black uppercase leading-none tracking-tight text-primary/[0.06]"
      >
        {meta.label}
      </div>

      <div className="relative flex h-full flex-col">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-extrabold tracking-[0.18em] text-primary">APEX</span>
          <span className="text-[11px] font-medium tracking-[0.18em] text-foreground/80">FINANCIAL</span>
        </div>
        <div className="mt-1 h-px w-10 bg-primary/60" />

        <Badge className={cn("mt-2.5 w-fit border text-[9px] tracking-[0.14em]", meta.accent)}>
          {meta.emoji} {meta.label.toUpperCase()}
        </Badge>

        <div className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Winner&apos;s Circle
        </div>

        {/* The number, or an honest absence of one. */}
        <div className="mt-0.5">
          {amount ? (
            <div className="text-3xl font-black leading-none tracking-tight text-primary tabular-nums">{amount}</div>
          ) : (
            <div className="py-1 text-[11px] font-semibold leading-tight text-muted-foreground">
              Premium not on file
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2.5 pt-4">
          {photo ? (
            <img
              src={photo}
              alt=""
              loading="lazy"
              onError={() => setPhotoBroken(true)}
              className="h-11 w-11 shrink-0 rounded-full border border-primary/40 object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-bold text-primary">
              {initialsOf(row.agent_name)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Agent</div>
            <div className="truncate text-xs font-bold text-foreground">{displayName(row.agent_name)}</div>
          </div>
        </div>

        <div className="mt-2 border-t border-primary/20 pt-1.5 text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
          Earned in the field
        </div>
      </div>
    </div>
  );
}

export default function AwardsGallery() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<PlaqueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTier] = useState<string>("all");
  const [emailing, setEmailing] = useState(false);
  const [editing, setEditing] = useState<PlaqueRow | null>(null);
  const [artOf, setArtOf] = useState<PlaqueRow | null>(null);
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
      .filter(r => {
        if (!q) return true;
        // Search the LABEL as well as the raw key, so typing "first deal" finds
        // both first_deal_of_day and the legacy "FIRST DEAL" rows.
        return (r.agent_name ?? "").toLowerCase().includes(q)
          || r.milestone_type.toLowerCase().includes(q)
          || tierMeta(r.milestone_type).label.toLowerCase().includes(q);
      });
  }, [rows, search, tierFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.milestone_type] = (c[r.milestone_type] ?? 0) + 1;
    return c;
  }, [rows]);

  /* Filter options come from the loaded rows, never from a hardcoded list, so
     the dropdown can neither omit a tier that exists nor offer one that does
     not. Sorted by volume — the tiers Sam looks at most sit at the top. */
  const tierOptions = useMemo(
    () => Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || tierMeta(a[0]).label.localeCompare(tierMeta(b[0]).label))
      .map(([key, n]) => ({ key, n, meta: tierMeta(key) })),
    [counts],
  );

  const totalValue = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    [filtered],
  );

  /* Plaques whose premium never made it onto the row. Surfaced as a number
     rather than left to be discovered one blank card at a time. */
  const missingAmount = useMemo(
    () => filtered.filter(r => !usdOrNull(r.amount)).length,
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
      <PageHeader
        accent="amber"
        eyebrow="Production · Awards"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Awards Gallery"
        subtitle="Every plaque earned across the agency. Filter by agent, milestone, or year."
        actions={
          isAdmin && (
            <>
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
            </>
          )
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Plaques</div>
          <div className="text-2xl font-bold tabular-nums">{filtered.length}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Value</div>
          <div className="text-2xl font-bold tabular-nums text-primary">{usdCompact(totalValue)}</div>
          {missingAmount > 0 && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              excludes {missingAmount} with no premium on file
            </div>
          )}
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">💎 Platinum</div>
          <div className="text-2xl font-bold tabular-nums text-primary">{counts.single_day_platinum ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥇 Gold</div>
          <div className="text-2xl font-bold tabular-nums text-primary">{counts.single_day ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥉 Bronze</div>
          <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">{counts.single_day_bronze ?? 0}</div>
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
          <SelectTrigger className="w-[210px] h-9"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers ({rows.length})</SelectItem>
            {tierOptions.map(({ key, n, meta }) => (
              <SelectItem key={key} value={key}>{meta.emoji} {meta.label} ({n})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(tierFilter !== "all" || search.trim()) && (
          <Button variant="outline" size="sm" className="h-9"
            onClick={() => { setTier("all"); setSearch(""); }}>
            Clear
          </Button>
        )}
      </GlassCard>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // stable-key-allow:skeleton
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
            const meta = tierMeta(p.milestone_type);
            const amount = usdOrNull(p.amount);
            const hasArt = Boolean(p.image_png_url || p.image_svg_url);
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
                    className="absolute top-3 right-3 h-7 w-7 rounded-full bg-background/80 border border-border backdrop-blur text-muted-foreground hover:text-foreground hover:bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center z-10"
                    title="Edit plaque"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                )}

                <PlaqueFace row={p} />

                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{displayName(p.agent_name)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.milestone_date ? format(new Date(p.milestone_date), "MMM d, yyyy") : "Date not on file"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {amount
                      ? <span className="text-sm font-bold tabular-nums text-primary">{amount}</span>
                      : <span className="text-[11px] text-muted-foreground">no premium on file</span>}
                    {p.email_sent_at ? (
                      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">emailed</div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                  {hasArt ? (
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]"
                      onClick={() => setArtOf(p)}>
                      <ImageIcon className="h-3 w-3" /> Original art
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No artwork rendered yet</span>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* ── Original artwork lightbox ─────────────────────────────────────
          The baked asset, shown at size and labelled for what it is. Where the
          artwork's frozen number disagrees with the row, the row is stated
          underneath rather than leaving the picture to argue its own case. */}
      <Dialog open={!!artOf} onOpenChange={(open) => { if (!open) setArtOf(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{displayName(artOf?.agent_name)}</DialogTitle>
            <DialogDescription>
              {artOf ? tierMeta(artOf.milestone_type).label : ""}
              {artOf?.milestone_date ? ` · ${format(new Date(artOf.milestone_date), "MMM d, yyyy")}` : ""}
            </DialogDescription>
          </DialogHeader>
          {artOf && (
            <div className="space-y-3">
              <img
                src={artOf.image_png_url ?? artOf.image_svg_url ?? undefined}
                alt={`Plaque artwork for ${displayName(artOf.agent_name)}`}
                className="w-full rounded-lg border border-border"
              />
              {!usdOrNull(artOf.amount) && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  This artwork was rendered before a premium was recorded against the award, so any
                  figure printed on it is not backed by the row. The plaque record itself carries no
                  premium.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Admin edit dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setPhotoFile(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plaque</DialogTitle>
            <DialogDescription>
              {displayName(editing?.agent_name)}
              {editing ? ` · ${tierMeta(editing.milestone_type).label}` : ""}
              {editing ? ` · ${usdOrNull(editing.amount) ?? "no premium on file"}` : ""}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              {(editing.image_png_url || editing.image_svg_url) && (
                <img src={editing.image_png_url ?? editing.image_svg_url ?? undefined} alt="" className="w-full rounded-lg border border-border/40" />
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
