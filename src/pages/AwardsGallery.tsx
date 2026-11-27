import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Trophy, Search, Filter, Mail, Loader2, Edit3, Upload, RefreshCw, Camera, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveAgentNames,
  AGENT_NAME_FALLBACK,
  type AgentNameSource,
} from "@/shared/api/agentDisplayNames";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
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
import { AwardCopyActions, useOwnedAwardSelection } from "@/components/awards/AwardCopyActions";
import { presentPlaqueDate, presentPlaqueMetric } from "@/components/awards/plaqueAwardPresentation";
import { TrophyProgression } from "@/components/awards/TrophyProgression";
import "@/components/awards/awards.css";

export interface PlaqueRow {
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

const AWARD_LIMIT = 500;
const AWARD_WINDOWS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "Loaded history" },
] as const;
type AwardWindow = typeof AWARD_WINDOWS[number]["value"];

async function loadAwards(signal: AbortSignal): Promise<{ rows: PlaqueRow[]; capped: boolean }> {
  const { data, error } = await supabase
    .from("plaque_awards")
    .select("id, agent_id, milestone_type, milestone_date, amount, badge_label, color_hex, image_svg_url, image_png_url, email_sent_at, email_delivery_status, awarded_at, custom_photo_url")
    .order("milestone_date", { ascending: false })
    .order("id", { ascending: true })
    .limit(AWARD_LIMIT + 1)
    .abortSignal(signal);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The award records could not be verified.");

  // The extra row identifies a truncated history without claiming a full-agency total.
  const list = data.slice(0, AWARD_LIMIT) as PlaqueRow[];
  const agentIds = [...new Set(list.map(row => row.agent_id).filter(Boolean))];
  const agents: AgentNameSource[] = [];
  if (agentIds.length) {
    const result = await supabase.from("agents").select("id, user_id, display_name")
      .in("id", agentIds).abortSignal(signal);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error("The award recipients could not be verified.");
    agents.push(...result.data);
  }
  const resolved = await resolveAgentNames(agents);
  return {
    capped: data.length > AWARD_LIMIT,
    rows: list.map(row => ({
      ...row,
      agent_name: resolved.get(row.agent_id)?.name ?? AGENT_NAME_FALLBACK,
      agent_photo: row.custom_photo_url ?? resolved.get(row.agent_id)?.avatarUrl ?? null,
    })),
  };
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
  weekly:             { label: "Diamond Week", accent: TONE.elite, emoji: "💠" },
  monthly:            { label: "Elite Producer", accent: TONE.elite, emoji: "👑" },
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
  team_single_day_25k: { label: "Team Day",     accent: TONE.team,      emoji: "⭐" },
  day_on_the_board:    { label: "On the Board", accent: TONE.team, emoji: "🏆" },
  day_recruiter_rising: { label: "Recruiter Rising", accent: TONE.team, emoji: "🏆" },
  day_hiring_champion: { label: "Hiring Champion", accent: TONE.team, emoji: "🏆" },
  month_first_hire: { label: "First Hire", accent: TONE.team, emoji: "🏆" },
  month_builder: { label: "Builder", accent: TONE.team, emoji: "🏆" },
  month_team_builder: { label: "Team Builder", accent: TONE.team, emoji: "🏆" },
  month_agency_builder: { label: "Agency Builder", accent: TONE.team, emoji: "🏆" },
  month_empire_builder: { label: "Empire Builder", accent: TONE.team, emoji: "🏆" },
  hiring_champion: { label: "Hiring Champion", accent: TONE.team, emoji: "🏆" },
  recruiter_rising: { label: "Recruiter Rising", accent: TONE.team, emoji: "🏆" },
  team_builder: { label: "Team Builder", accent: TONE.team, emoji: "🏆" },
  on_fire: { label: "On Fire", accent: TONE.streak, emoji: "🔥" },
  unstoppable: { label: "Unstoppable", accent: TONE.streak, emoji: "🔥" },
  streak_5: { label: "5-Day Streak", accent: TONE.streak, emoji: "🔥" },
  streak_10: { label: "10-Day Streak", accent: TONE.streak, emoji: "🔥" },
  streak_20: { label: "20-Day Streak", accent: TONE.streak, emoji: "🔥" },
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

function displayName(n?: string): string {
  // Some AgentLink names arrive all-lowercase ("dudley bowman"); normalize for
  // display only — the underlying row is untouched.
  return (n ?? "Agent").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initialsOf(n?: string): string {
  const parts = displayName(n).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "A";
}

/** Copy only the award record; thresholds and personal earnings are never inferred. */
export function buildPlaqueCaption(row: PlaqueRow): string {
  const metric = presentPlaqueMetric(row);
  const date = presentPlaqueDate(row);
  return [
    `${displayName(row.agent_name)}. ${tierMeta(row.milestone_type).label}.`,
    `${metric.label}: ${metric.value ?? metric.missingText}.`,
    `${date.label}: ${date.value}.`,
    `Earned recognition. ${BRAND.legalName}.`,
  ].join("\n");
}

export function buildPlaqueSummary(row: PlaqueRow): string {
  const metric = presentPlaqueMetric(row);
  const date = presentPlaqueDate(row);
  return [
    BRAND.legalName,
    `Agent: ${displayName(row.agent_name)}`,
    `Award: ${tierMeta(row.milestone_type).label}`,
    `${date.label}: ${date.value}`,
    `${metric.label}: ${metric.value ?? metric.missingText}`,
  ].join("\n");
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
export function PlaqueFace({ row }: { row: PlaqueRow }) {
  const meta = tierMeta(row.milestone_type);
  const metric = presentPlaqueMetric(row);
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => { setPhotoBroken(false); }, [row.agent_photo]);
  const photo = !photoBroken ? row.agent_photo ?? null : null;

  return (
    <div className="award-face">
      <p className="award-face__brand">{BRAND.legalName}</p>
      <h3 className="award-face__title">{meta.label}</h3>
      {metric.value !== null ? (
        <><p className="award-face__amount">{metric.value}</p><p className="award-face__unit">{metric.label}</p></>
      ) : <p className="award-face__unknown">{metric.missingText}</p>}
      <div className="award-face__recipient">
        {photo ? (
          <img src={photo} alt="" loading="lazy" onError={() => setPhotoBroken(true)} className="award-face__photo" />
        ) : <span className="award-face__initials" aria-hidden="true">{initialsOf(row.agent_name)}</span>}
        <div className="min-w-0">
          <p className="award-face__name">{displayName(row.agent_name)}</p>
          <span className="award-face__date">{presentPlaqueDate(row).value}</span>
        </div>
      </div>
    </div>
  );
}

/** Recorded-row card for the gallery and synthetic visual QA; no remote actions. */
export function AwardRecordCard({ row, onOpen, onOriginalArt, onEdit }: {
  row: PlaqueRow;
  onOpen?: (row: PlaqueRow) => void;
  onOriginalArt?: (row: PlaqueRow) => void;
  onEdit?: (row: PlaqueRow) => void;
}) {
  const hasArt = Boolean(row.image_png_url || row.image_svg_url);
  const metric = presentPlaqueMetric(row);
  return (
    <article className="award-record-card" aria-label={`${displayName(row.agent_name)} ${tierMeta(row.milestone_type).label} award`}>
      {onOpen ? (
        <button type="button" className="award-record-card__preview" aria-label={`Open award for ${displayName(row.agent_name)}`} onClick={() => onOpen(row)}>
          <PlaqueFace row={row} />
        </button>
      ) : <PlaqueFace row={row} />}
      <AwardCopyActions caption={buildPlaqueCaption(row)} summary={buildPlaqueSummary(row)} />
      <div className="award-record-card__footer">
        {hasArt && onOriginalArt ? (
          <Button type="button" variant="ghost" onClick={() => onOriginalArt(row)}><ImageIcon className="mr-1.5 h-4 w-4" /> Original art</Button>
        ) : <span>{hasArt ? "Original art available" : "No stored artwork"}</span>}
        {onEdit && <Button type="button" variant="ghost" size="icon" aria-label={`Edit award for ${displayName(row.agent_name)}`} onClick={() => onEdit(row)}><Edit3 className="h-4 w-4" /></Button>}
        {metric.value === null && <span>{metric.missingPremium ? "no premium on file" : metric.missingText.toLowerCase()}</span>}
        {row.email_sent_at && <span>Previously emailed</span>}
      </div>
    </article>
  );
}

export default function AwardsGallery() {
  const { isAdmin, user } = useAuth();
  const today = useBusinessToday();
  const [awardWindow, setAwardWindow] = useState<AwardWindow>("30");
  const awards = useQuery({
    queryKey: ["plaque-awards", "wins", user?.id],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => loadAwards(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const rows = awards.data?.rows ?? [];
  const loading = awards.isPending;
  const hasSnapshot = awards.data !== undefined;
  const windowStart = useMemo(() => {
    if (awardWindow === "all") return null;
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - Number(awardWindow) + 1);
    return date.toISOString().slice(0, 10);
  }, [awardWindow, today]);
  const windowLabel = AWARD_WINDOWS.find(window => window.value === awardWindow)!.label;
  const [search, setSearch] = useState("");
  const [tierFilter, setTier] = useState<string>("all");
  const [emailing, setEmailing] = useState(false);
  const [editing, setEditing] = useOwnedAwardSelection<PlaqueRow>(user?.id);
  const [artOf, setArtOf] = useOwnedAwardSelection<PlaqueRow>(user?.id);
  const [selectedAward, setSelectedAward] = useOwnedAwardSelection<PlaqueRow>(user?.id);
  const [rendering, setRendering] = useState(false);
  const [requestingPhotos, setRequestingPhotos] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  useEffect(() => { setPhotoFile(null); }, [user?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => !windowStart || (r.milestone_date >= windowStart && r.milestone_date <= today))
      .filter(r => tierFilter === "all" || r.milestone_type === tierFilter)
      .filter(r => {
        if (!q) return true;
        // Search the LABEL as well as the raw key, so typing "first deal" finds
        // both first_deal_of_day and the legacy "FIRST DEAL" rows.
        return (r.agent_name ?? "").toLowerCase().includes(q)
          || r.milestone_type.toLowerCase().includes(q)
          || tierMeta(r.milestone_type).label.toLowerCase().includes(q);
      });
  }, [rows, search, tierFilter, windowStart, today]);

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

  const milestoneCounts = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const row of filtered) {
      const label = tierMeta(row.milestone_type).label;
      byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    }
    const ordered = [...byLabel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const visible = ordered.slice(0, 6);
    if (ordered.length > 6) visible.push(["Other milestones", ordered.slice(6).reduce((sum, [, count]) => sum + count, 0)]);
    return visible;
  }, [filtered]);
  const honorees = new Set(filtered.map(row => row.agent_id).filter(Boolean)).size;
  const maxCount = Math.max(1, ...milestoneCounts.map(([, count]) => count));

  /* Plaques whose premium never made it onto the row. Surfaced as a number
     rather than left to be discovered one blank card at a time. */
  const missingAmount = useMemo(
    () => filtered.filter(r => presentPlaqueMetric(r).missingPremium).length,
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
    <div className="awards-stage">
      <PageHeader
        className="awards-heading awards-hero"
        accent="primary"
        eyebrow="Earned recognition"
        eyebrowIcon={<Trophy className="h-4 w-4" />}
        title="The win wall."
        subtitle="Earned milestones. Big moments. Copy the recognition."
        primaryAction={
          <Button size="sm" variant="outline" className="gap-2" onClick={() => void awards.refetch()} disabled={awards.isFetching}>
            <RefreshCw className={cn("h-4 w-4", awards.isFetching && "animate-spin")} aria-hidden="true" />
            {awards.isFetching ? "Refreshing…" : "Refresh awards"}
          </Button>
        }
        secondaryActions={isAdmin ? (
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={renderAll} disabled={rendering}>
              {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Render All
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={requestPhotos} disabled={requestingPhotos}>
              {requestingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Request Photos
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={emailAllToMe} disabled={emailing}>
              {emailing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Email Digest
            </Button>
          </>
        ) : undefined}
      />

      <nav aria-label="Recognition" className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link to="/dashboard/leaderboard">Leaderboard</Link></Button>
        <Button asChild variant="outline"><Link to="/dashboard/my-plaques">Award history</Link></Button>
        <Button asChild variant="outline"><Link to="/dashboard/hall-of-fame">Hall of Fame</Link></Button>
        {isAdmin && <Button asChild variant="outline"><Link to="/awards">Win Post Studio</Link></Button>}
      </nav>

      <TrophyProgression />

      {awards.isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-base text-foreground">
            {hasSnapshot ? "Refresh failed. Showing the last verified award records." : "Awards could not be loaded. No award counts are available."}
          </p>
          <Button variant="outline" onClick={() => void awards.refetch()} disabled={awards.isFetching}>Retry awards</Button>
        </div>
      )}

      {hasSnapshot && (
        <>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Updated {format(new Date(awards.dataUpdatedAt), "MMM d, h:mm a")}. Refreshes every minute while visible.</p>
            {awards.data.capped && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground">
                Showing the newest {AWARD_LIMIT} awards. Counts and charts cover these loaded records; older awards are not included.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Award window">
            {AWARD_WINDOWS.map(window => (
              <Button key={window.value} variant={awardWindow === window.value ? "default" : "outline"}
                aria-pressed={awardWindow === window.value} onClick={() => setAwardWindow(window.value)}>
                {window.label}
              </Button>
            ))}
          </div>

          <GlassCard className="flex flex-wrap items-center gap-3 p-3">
            <div className="relative min-w-0 flex-1 basis-52">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search awards" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search agent or milestone…" className="h-11 pl-9" />
            </div>
            <Select value={tierFilter} onValueChange={setTier}>
              <SelectTrigger aria-label="Award milestone" className="h-11 w-full sm:w-[230px]">
                <Filter className="mr-1.5 h-4 w-4" /><SelectValue placeholder="All milestones" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All milestones</SelectItem>
                {tierOptions.map(({ key, meta }) => (
                  <SelectItem key={key} value={key}>{meta.emoji} {meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(tierFilter !== "all" || search.trim()) && (
              <Button variant="outline" onClick={() => { setTier("all"); setSearch(""); }}>Clear filters</Button>
            )}
          </GlassCard>

          <div role="group" aria-label="Award summary" className="awards-summary">
            <div className="awards-summary__tile">
              <p>Awards in view</p>
              <p className="awards-summary__value">{filtered.length.toLocaleString()}</p>
              <p className="awards-summary__detail">{windowLabel} · matching filters</p>
            </div>
            <div className="awards-summary__tile" data-tone="cool">
              <p>Agents recognized</p>
              <p className="awards-summary__value">{honorees.toLocaleString()}</p>
              <p className="awards-summary__detail">Distinct recipients in view</p>
            </div>
            <div className="awards-summary__tile" data-tone="warm">
              <p>Premium not on file</p>
              <p className="awards-summary__value">{missingAmount.toLocaleString()}</p>
              <p className="awards-summary__detail">Premium-based awards with no positive amount</p>
            </div>
          </div>

          {filtered.length > 0 && (
            <figure aria-labelledby="awards-chart-title" className="rounded-lg border-2 border-border bg-card p-4 sm:p-5">
              <figcaption>
                <h2 id="awards-chart-title" className="text-xl font-black italic uppercase text-foreground">Milestones earned</h2>
                <p className="mt-1 text-sm text-muted-foreground">{windowLabel} · {filtered.length} awards in view. Each bar counts recorded awards.</p>
              </figcaption>
              <ul className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Award counts by milestone">
                {milestoneCounts.map(([label, count]) => (
                  <li key={label} className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-foreground">{label}</span>
                      <span className="font-bold tabular-nums text-primary">{count} {count === 1 ? "award" : "awards"}</span>
                    </div>
                    <div aria-hidden="true" className="h-6 overflow-hidden rounded-sm bg-muted">
                      <div className="h-full rounded-sm bg-primary" style={{ width: `${count / maxCount * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </figure>
          )}
        </>
      )}

      {loading ? (
        <div role="status" aria-label="Loading awards" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // stable-key-allow:skeleton
            <GlassCard key={i} className="p-4 animate-pulse h-48" />
          ))}
        </div>
      ) : !hasSnapshot ? null : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          No recorded awards match this window and these filters.
        </GlassCard>
      ) : (
        <div className="awards-card-grid">
          {filtered.map(row => (
            <AwardRecordCard
              key={`${user?.id}-${row.id}`}
              row={row}
              onOpen={setSelectedAward}
              onOriginalArt={setArtOf}
              onEdit={isAdmin ? setEditing : undefined}
            />
          ))}
        </div>
      )}

      <Dialog open={!!selectedAward} onOpenChange={(open) => { if (!open) setSelectedAward(null); }}>
        <DialogContent className="awards-dialog max-w-xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="awards-dialog__title">Recognition kit</DialogTitle>
            <DialogDescription>{displayName(selectedAward?.agent_name)} · {selectedAward ? presentPlaqueDate(selectedAward).value : ""}</DialogDescription>
          </DialogHeader>
          {selectedAward && <>
            <PlaqueFace row={selectedAward} />
            <AwardCopyActions key={`${user?.id}-${selectedAward.id}`} caption={buildPlaqueCaption(selectedAward)} summary={buildPlaqueSummary(selectedAward)} showText />
          </>}
        </DialogContent>
      </Dialog>

      {/* ── Original artwork lightbox ─────────────────────────────────────
          The baked asset, shown at size and labelled for what it is. Where the
          artwork's frozen number disagrees with the row, the row is stated
          underneath rather than leaving the picture to argue its own case. */}
      <Dialog open={!!artOf} onOpenChange={(open) => { if (!open) setArtOf(null); }}>
        <DialogContent className="awards-dialog max-w-sm">
          <DialogHeader className="pr-8">
            <DialogTitle>Original art · {displayName(artOf?.agent_name)}</DialogTitle>
            <DialogDescription>
              {artOf ? tierMeta(artOf.milestone_type).label : ""}
              {artOf ? ` · ${presentPlaqueDate(artOf).value}` : ""}
            </DialogDescription>
          </DialogHeader>
          {artOf && (
            <div className="space-y-3">
              <p className="awards-original-note">Stored artwork from the earlier design. The award card and copied stats use the current record.</p>
              <p className="text-sm">{presentPlaqueMetric(artOf).label}: {presentPlaqueMetric(artOf).value ?? presentPlaqueMetric(artOf).missingText}</p>
              <img
                src={artOf.image_png_url ?? artOf.image_svg_url ?? undefined}
                alt={`Original plaque artwork for ${displayName(artOf.agent_name)}`}
                className="w-full rounded-lg border border-border"
              />
              {presentPlaqueMetric(artOf).value === null && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {presentPlaqueMetric(artOf).missingText}. Any amount baked into this image is unverified against the current record.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Admin edit dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setPhotoFile(null); } }}>
        <DialogContent className="awards-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plaque</DialogTitle>
            <DialogDescription>
              {displayName(editing?.agent_name)}
              {editing ? ` · ${tierMeta(editing.milestone_type).label}` : ""}
              {editing ? ` · ${presentPlaqueMetric(editing).label}: ${presentPlaqueMetric(editing).value ?? presentPlaqueMetric(editing).missingText}` : ""}
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
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Current custom photo set. Pick a file to replace.
                  </p>
                )}
                {!editing.custom_photo_url && !photoFile && (
                  <p className="text-[12px] text-muted-foreground mt-1">
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
