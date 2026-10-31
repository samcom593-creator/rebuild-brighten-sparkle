// Launch Board — the one content workspace (§11, 2026-10-06).
//
// v6 (OVERHAUL-launchboard, 2026-10-31). Sam: "still pretty ugly." The Videos view is one list in the order to
// finish it (src/components/content/LaunchBoardList.tsx over the tested rules in src/lib/launchBoardList.ts): Up next
// with the page's one gold button, four numbers that each open their list (Ideas, To film, To edit, To post), and
// every row showing where its video is as a coloured bar and word, with one button for the next step. The Today and
// Board tabs are that one view now (?tab=board still opens it). Film next lives in New idea; Remake a winner and the
// momentum numbers moved to Analytics; the testimonials shortcut is the Library's Testimonials chip; the four question
// cards are the four numbers. Week, Library and Analytics keep their jobs, restyled, with one gold button a screen.
// Nothing in the database changed.
//
// v4: one workflow, Idea → Record → Edit → Review → Ready → Scheduled → Published (src/lib/contentWorkflow.ts +
// migration 20261006150000). Copying a caption or downloading a clip changes nothing; Ready needs an admin approval;
// Scheduled is a "Manual plan" unless a scheduler job backs it; Published needs a live https post URL on a known
// platform (server-enforced). The old Content page (/dashboard/content, the content-ops approval queue + invite list)
// lives here as the Queue tab and its URL redirects here.
//
// Earlier history:
//
// v1 (2026-09-07 morning) ported the standalone board. Sam: "make it easier on the eyes, easier to use, more
// functional — and pull content from my Dropbox (YouTube + TikToks)." v2 was built around four questions, one tab
// each: what do I post TODAY, where is everything (BOARD), what's the WEEK, and what have I already shot (LIBRARY — a
// metadata index of the Dropbox video archive, content_clips, ~4,000 clips, no bytes copied).
//
// Library → card is one click ("New card" mints a card in Edit with the clip attached; "Attach" drops the clip onto an
// existing idea). Publishing stays in Sam's hands.
//
// v3 (2026-09-15, vidIQ channel audit): Instagram is retired — every card funnels to apex-financial.org/apply. Brands
// are now channels (YouTube long-form / Shorts auto-republished by Repurpose.io). The Week tab is a real Mon–Sun
// calendar with a slot per day.
//
// v5 (2026-10-08): repositioned off insurance-sales talking-head to the come-up / self-improvement lane
// (src/lib/contentWeek.ts themes). The old "80/20 insurance mix" grading is gone; momentum (streak, subscriber
// milestone, creator level, week-over-week) and a ranked "film this next" pick were added.

import { useRef, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { externalHref } from "@/lib/externalHref";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { useInsights, usePosts, type Insights } from "@/components/content/AccountsAnalytics";
import { FilmNextPanel } from "@/components/content/FilmNextPanel";
import { FilmingPackSheet } from "@/components/content/FilmingPackSheet";
import { WinnersPanel } from "@/components/content/WinnersPanel";
import { LaunchBoardList, VideoStageMark } from "@/components/content/LaunchBoardList";
import { WeekPlan } from "@/components/content/WeekPlan";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { ideaFromInsight, usedMarkers, type IdeaEdits, type PickIdea } from "@/lib/contentPicks";
import {
  createProjectFromIdea, createRemake, dismissIdea as dismissIdeaRow, loadDismissals, saveIdeaForLater, savePack, undoDismissal,
  type DbClient, type Dismissal,
} from "@/lib/contentProjects";
import type { RemakeDraft } from "@/lib/contentWinners";
import { checkPublishUrl, previousStatus, scheduleLabel, stageOf, type WorkflowStatus } from "@/lib/contentWorkflow";
import { videoNextStep, videoStep, type BoardVideo, type VideoNextStep } from "@/lib/launchBoardList";
import { DAY_THEMES, phoenixWeekStart, phoenixWeekday } from "@/lib/contentWeek";
import { canShareFiles, pullFile, saveMedia, shareFiles } from "@/lib/saveMedia";
import { celebrate } from "@/lib/celebrate";
import { TONE_CLASS, platformTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock, Check, ChevronDown, Clapperboard, Copy, Download, ExternalLink, Film, Flame, Image as ImageIcon, Lightbulb, Loader2,
  MessageSquareQuote, Paperclip, Plus, Search, SlidersHorizontal, ThumbsDown, ThumbsUp, Trash2, Undo2, X,
} from "lucide-react";

// The content-ops approval queue + invite list (formerly /dashboard/content) renders as the Queue tab.
const ContentQueue = lazy(() => import("./ContentQueue"));
const AccountsAnalytics = lazy(() => import("@/components/content/AccountsAnalytics"));

type Job = "REACH" | "AUTHORITY" | "PROOF" | "CONVERT";
type Tab = "today" | "board" | "week" | "library" | "queue" | "analytics";

interface Card {
  id: string; title: string; brand: string; content_type: string; job: string; hook: string; caption: string;
  status: string; day: number; clip: string; sort: number; posted_at: string | null;
  record_script: string; edit_prompt: string;   // MP-233 kit: what to record, and the prompt that cuts it
  // §11 execution + evidence fields (migration 20261006150000). Optional: absent until the migration is live.
  cta?: string; owner?: string; due_date?: string | null;
  approved_at?: string | null; approved_by?: string | null;
  scheduled_for?: string | null; schedule_kind?: string | null; schedule_job_ref?: string | null;
  published_url?: string | null; publish_evidence?: string | null; published_confirmed_at?: string | null;
  planned_week?: string | null;   // Phoenix Monday of the week the card sits on a day (set by trigger)
  brief?: Record<string, unknown> | null;   // saved brief: idea key, premise, payoff, effort, remake link (migration 20261009160000)
  archived_at?: string | null;
}
interface Clip {
  id: string; path: string; name: string; folder: string; kind: string; size_bytes: number; modified_at: string | null; used_by_card: string | null;
  thumb_url?: string | null; preview_url?: string | null; duration_s?: number | null; title?: string | null; description?: string | null; tags?: string[];
  download_url?: string | null; download_expires_at?: string | null;
  hook_title?: string | null; banger_score?: number | null; banger_reason?: string | null; find_label?: string | null;
  // Testimonial layer (2026-09-12): media 'video' | 'image' (screenshots indexed from Dropbox), what the clip SAYS
  // (whisper / OCR), and the verdict. testimonial null = the classifier hasn't reached this row yet.
  media?: string | null; transcript?: string | null; testimonial?: boolean | null; testimonial_kind?: string | null;
  testimonial_reason?: string | null; testimonial_source?: string | null; width?: number | null; height?: number | null;
  phone_url?: string | null; phone_bytes?: number | null;   // 720p H.264 copy in public storage — what a phone pulls instead of the 4K original
}
type ProofKind = "all" | "video" | "image";
const isTestimonial = (k: Clip) => k.testimonial === true || (k.tags ?? []).includes("testimonial");
const proofKindOf = (k: Clip): Exclude<ProofKind, "all"> => (k.media === "image" ? "image" : "video");

// The editor's Job select. Labels only: the job is a note on the card, not a grade.
const JOBS: { k: Job; label: string }[] = [
  { k: "REACH", label: "Reach" }, { k: "AUTHORITY", label: "Authority" }, { k: "PROOF", label: "Proof" }, { k: "CONVERT", label: "Convert" },
];
// The views. Videos is the default (?tab=board, the old Board tab, opens it too). Queue is hidden from the bar while
// its Mac mini feed is offline (it showed 14 empty "Nothing slated" boxes); ?tab=queue and /dashboard/content open it.
const VIEWS: { k: Tab; label: string }[] = [
  { k: "today", label: "Videos" }, { k: "week", label: "Week" }, { k: "library", label: "Library" }, { k: "analytics", label: "Analytics" },
];
const TAB_KEYS = new Set<Tab>(["today", "board", "week", "library", "analytics", "queue"]);

// Library footage filters — a way to find clips in the archive, not a grading system. A clip's
// category is read off its existing AI tags / title / description, so nothing needs re-tagging.
type PillarKey = "sales" | "money" | "recruiting" | "fitness" | "lifestyle";
const PILLARS: { k: PillarKey; label: string; re: RegExp }[] = [
  { k: "sales", label: "Sales", re: /\b(sales?|insurance|closing|close|calls?|dialer|policy|policies|pitch|objection|license|licensed|carrier|ethos|leads?)\b/i },
  { k: "money", label: "Money", re: /\b(money|income|deposit|paid|pay|\$[\d,]+k?|production|revenue|rich|millionaire|cash|commission)\b/i },
  { k: "recruiting", label: "Team", re: /\b(recruit(?:ing)?|apply|application|hiring|hired|join|team|agents?|agency|onboard(?:ing)?|cta)\b/i },
  { k: "fitness", label: "Fitness", re: /\b(gym|workout|lift(?:ing)?|physique|training|fitness|bench|squat|deadlift|cardio|abs|muscle|shirtless|run(?:ning)?)\b/i },
  { k: "lifestyle", label: "Lifestyle", re: /\b(cars?|corvette|vette|c8|lambo|lamborghini|porsche|exotic|rental|driving|garage|arizona|tempe|rooftop|pool|sunset)\b/i },
];
const clipHay = (k: Clip) => `${k.title ?? ""} ${k.description ?? ""} ${(k.tags ?? []).join(" ")} ${k.name}`;
const pillarsOf = (k: Clip): PillarKey[] => PILLARS.filter((p) => p.re.test(clipHay(k))).map((p) => p.k);
type FolderKey = "all" | "YouTube" | "Reels" | "Screenshots";
type LengthKey = "all" | "short" | "mid" | "long";
const FOLDER_LABEL: Record<FolderKey, string> = { all: "Any folder", YouTube: "YouTube · horizontal", Reels: "Reels · vertical", Screenshots: "Screenshots" };
const LENGTH_LABEL: Record<LengthKey, string> = { all: "Any length", short: "1 min or less", mid: "1 to 5 min", long: "5 min or more" };

// Channels (Instagram retired 2026-09-15). YT = YouTube long-form, SH = Shorts (Repurpose.io republishes to TikTok).
// Legacy SFD / IMS cards were the two Instagram handles; they render as retired so old rows still make sense.
const CTA = "Want to sell life insurance with my team? Apply: https://apex-financial.org/apply";
const hasCta = (s: string) => /apex-financial\.org/i.test(s);
const brandHandle = (b: string) => (b === "SH" ? "YouTube Shorts → Repurpose" : b === "YT" ? "YouTube" : b === "IMS" ? "@imakesystems · retired" : b === "SFD" ? "@sellfordaddy · retired" : b);
const brandTone = (b: string) => (b === "SH" || b === "YT" ? platformTone("youtube") : "slate");
const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const cleanName = (n: string) => n.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
// Direct CDN link to the original file, minted on the mini every 3h (4h validity). Falls back to the Dropbox page.
const directUrl = (k: { download_url?: string | null; download_expires_at?: string | null; path: string }) =>
  k.download_url && k.download_expires_at && new Date(k.download_expires_at).getTime() > Date.now() + 60_000 ? k.download_url : null;
const dropboxUrl = (path: string) => {
  const parts = path.split("/"); const name = parts.pop() ?? "";
  return `https://www.dropbox.com/home/${parts.map(encodeURIComponent).join("/")}?preview=${encodeURIComponent(name)}`;
};
/** A filter chip: gold hairline and tint when on, a quiet card when off. */
const chipClass = (on: boolean) => cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  on ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
);
/** The traction score's tone, as words beside it: 70+ is strong, 45+ is good, the rest is quiet. */
const bangerTone = (s: number): Tone => (s >= 70 ? "good" : s >= 45 ? "gold" : "slate");
/** Where the stage moves when it is sent back, in the list's words. */
const SEND_BACK_WORDS: Record<WorkflowStatus, string> = {
  idea: "Ideas", record: "filming", edit: "editing", review: "review", ready: "Ready", scheduled: "Ready", published: "Published",
};

const emptyDraft = { title: "", brand: "SH", job: "REACH", content_type: "short", hook: "", caption: "", clip: "", day: 0, status: "idea", record_script: "", edit_prompt: "", cta: "", owner: "", due_date: "" };
// Fields the editor writes. Status is never written from the editor: stage moves go through the workflow actions.
const WORKFLOW_FIELDS = ["cta", "owner", "due_date"] as const;

// MP-233 video kit (2026-09-15): two copy-paste blocks per card. "Fill from template" writes these from the
// title + hook + channel so a brand-new idea is recordable and hand-off-able in one tap; the seeded
// cards carry hand-written versions. Delivery format lives in master-prompts/233-video-format-and-prompt-kit.md.
const isLongForm = (d: Record<string, unknown>) => String(d.brand) === "YT" || String(d.content_type) === "long";
const recordTemplate = (d: Record<string, unknown>) => {
  const title = String(d.title ?? "").trim() || "<title>"; const hook = String(d.hook ?? "").split(/[.!?]\s/)[0].trim() || "<the hook line>";
  const ending = String(d.cta ?? "").trim() || "End on the lesson; invite viewers to follow the journey if it fits.";
  return `RECORD: ${title}\nCamera: ${isLongForm(d) ? "HORIZONTAL, aim for an 8–12 minute finished story" : "VERTICAL, one 20–45 second idea"}\n1. Open with the real moment or tension: "${hook}"\n2. Show what happened: capture the place, the work, and the detail the viewer needs.\n3. Tell the turning point in your own words. Use only numbers and events you can substantiate.\n4. Share one useful lesson. Pick up natural B-roll between short takes.\nEnding: ${ending}\nKeep private conversations and client information off camera. Use your own experience, not promises about viewers' results.`;
};
const editTemplate = (d: Record<string, unknown>) => {
  const title = String(d.title ?? "").trim() || "<title>"; const hook = String(d.hook ?? "").split(/[.!?]\s/)[0].trim() || "<the hook line>";
  const fmt = isLongForm(d) ? "long-form 16:9, 8-12 min, 1080p30 render then 4K upscale, 5-7 chapters, NumberCards on every stated figure, lesson → CTA → end card over the last shot" : "Short 9:16 1080x1920, 20-45 s, burned word captions ≤ 6 words per page, end on the lesson; use the card CTA only if supplied";
  return `Cut "${title}" per MP-234 (~/business-ops/master-prompts/234-apex-video-editor.md).\nFormat: ${fmt}. Sources: the clip(s) attached to this Launch Board card${d.clip ? ` (${String(d.clip)})` : ""}, plus any clip from the same date with his voice on it.\nHook: "${hook}".\nExclude: slurs, sexual lines, beef, client PII, phone screens. music: [].\nPackage: title "${title}", description = hook + the channel description block + chapters, tags TAGS_CORE. Deliver 4K + 1080p to ~/Desktop/YouTube-Ready/, attach the 1080p to this card, write the YouTube chapters, ntfy me when done.`;
};
const FORMAT_LINE = "Long-form: 3840×2160 16:9 30 fps, −14 LUFS, no music, chapters in the description, end card over the last shot. Shorts: 1080×1920 9:16 ≤ 45 s, burned captions, optional CTA over the last shot.";

export default function LaunchBoard() {
  usePageTitle("Launch Board");
  const askConfirm = useConfirm();
  const { isAdmin } = useAuth();
  const [tab, setTabState] = useState<Tab>("today");
  const [cards, setCards] = useState<Card[]>([]);
  const [archivedCards, setArchivedCards] = useState<Card[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  // Film next: dismissals, the shared results read, and which project's filming pack is open.
  const [dismissals, setDismissals] = useState<Dismissal[]>([]);
  const [dismissalsFailed, setDismissalsFailed] = useState(false);
  const [busyIdeaKey, setBusyIdeaKey] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [remaking, setRemaking] = useState(false);
  const postsRead = usePosts();
  const insights = useInsights();
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  // The board read failed: the list says so and shows no numbers, rather than an empty board that reads as zero.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pillar, setPillar] = useState<"all" | PillarKey>("all");
  const [folder, setFolder] = useState<FolderKey>("all");
  // Testimonials filter. Deep link: /dashboard/launch-board?tab=library&filter=testimonials
  const [searchParams, setSearchParams] = useSearchParams();
  const [proof, setProof] = useState<"all" | "testimonials">(searchParams.get("filter") === "testimonials" ? "testimonials" : "all");
  const [proofKind, setProofKind] = useState<ProofKind>("all");
  const [health, setHealth] = useState<{ judged: number; waiting: number; testimonials: number; last_judged_at: string | null } | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  // The tab lives in the URL (?tab=queue is where /dashboard/content redirects), so a reload or a shared link opens the same view.
  useEffect(() => {
    const t = searchParams.get("tab") as Tab | null;
    if (t && TAB_KEYS.has(t)) setTabState(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let live = true;
    void loadDismissals(supabase as unknown as DbClient).then((r) => {
      if (!live) return;
      if (r.ok) { setDismissals(r.rows); setDismissalsFailed(false); } else setDismissalsFailed(true);
    });
    return () => { live = false; };
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === "today" || t === "board") next.delete("tab"); else next.set("tab", t);
      if (t !== "library") next.delete("filter");
      return next;
    }, { replace: true });
  };
  const chooseProof = (p: "all" | "testimonials") => {
    setProof(p);
    if (p === "all") setProofKind("all");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p === "testimonials") { next.set("tab", "library"); next.set("filter", "testimonials"); } else { next.delete("filter"); }
      return next;
    }, { replace: true });
  };
  // Tap a clip's title to rename it (saved as its find_label, the label the Library shows first).
  // NOTE: hand renames live in find_label. Any future find_label backfill must only fill NULLs
  // (as apex-testimonial-classifier.py does) or it will wipe Sam's titles.
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  // Library cards show the video, title, hook and buttons; votes/score/pillars/tags hide behind "Show details" (Sam: less clutter).
  const [showDetails, setShowDetailsState] = useState<boolean>(() => { try { return localStorage.getItem("lb:details") === "1"; } catch { return false; } });
  // empty-catch-allow:private-mode-storage (the switch still works for this visit; only the memory of it is lost)
  const setShowDetails = (v: boolean) => { setShowDetailsState(v); try { localStorage.setItem("lb:details", v ? "1" : "0"); } catch { /* private mode: keep it in memory */ } };
  const renameDone = useRef(false);   // Enter/Escape already handled it: the blur that follows must not save again
  const saveRename = async () => {
    if (!renaming || renameDone.current) return;
    renameDone.current = true;
    const { id, text } = renaming; const label = text.trim(); setRenaming(null);
    const k = clips.find((c) => c.id === id); if (!k || !label || label === (k.find_label || k.title || cleanName(k.name))) return;
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, find_label: label } : c)));
    const { data, error } = await supabase.from("content_clips").update({ find_label: label }).eq("id", id).select("id");
    if (error || !data?.length) { setClips((cs) => cs.map((c) => (c.id === id ? { ...c, find_label: k.find_label } : c))); toast.error(`Couldn't rename: ${error ? error.message.slice(0, 100) : "not saved (no permission)"}`); }
    else toast.success("Renamed");
  };
  // Sam's tap beats the classifier: source='manual' is never overwritten by the daemon.
  const setVerdict = async (k: Clip, value: boolean) => {
    const prev = { testimonial: k.testimonial, testimonial_source: k.testimonial_source, testimonial_reason: k.testimonial_reason };
    setClips((cs) => cs.map((c) => (c.id === k.id ? { ...c, testimonial: value, testimonial_source: "manual", testimonial_reason: value ? "marked by Sam" : "not a testimonial (Sam)" } : c)));
    const { error } = await supabase.from("content_clips")
      .update({ testimonial: value, testimonial_source: "manual", testimonial_reason: value ? "marked by Sam" : "not a testimonial (Sam)", testimonial_at: new Date().toISOString(), testimonial_kind: value ? (k.testimonial_kind && k.testimonial_kind !== "not_testimonial" ? k.testimonial_kind : k.media === "image" ? "text_message" : "video_call") : "not_testimonial" })
      .eq("id", k.id);
    if (error) { setClips((cs) => cs.map((c) => (c.id === k.id ? { ...c, ...prev } : c))); toast.error(`Couldn't save: ${error.message.slice(0, 100)}`); }
    else toast.success(value ? "Marked as a testimonial" : "Removed from testimonials");
  };
  // Phone: two taps, never a spinner that can't end. Tap 1 pulls the PHONE-SIZE copy (720p, ~20 MB/min, made by
  // the classifier) with a visible percentage and holds it; tap 2 opens the share sheet (Save Video / Save Image
  // → camera roll). Two taps because iOS only lets share() run inside a fresh user gesture, and a pull that takes
  // longer than that gesture would throw. Originals over 150 MB are never pulled on a phone — they are the reason
  // the button spun forever (median testimonial original 283 MB, mean 1.5 GB). Desktop: plain download.
  const mobileSave = canShareFiles();
  const PHONE_MAX_ORIGINAL = 150 * 1024 * 1024;
  const [pull, setPull] = useState<Record<string, { pct: number | null; loaded: number; file?: File; error?: string }>>({});
  const pullTarget = (k: Clip): { url: string; name: string; bytes: number; kind: "phone" | "original" } | null => {
    const url = directUrl(k);
    // Prefer the smaller of the two: a 10 s phone screen recording is smaller than its 720p copy.
    if (k.phone_url && !(url && k.size_bytes <= PHONE_MAX_ORIGINAL && k.size_bytes < (k.phone_bytes ?? Infinity))) return { url: k.phone_url, name: k.name.replace(/\.[a-z0-9]+$/i, "") + ".mp4", bytes: k.phone_bytes ?? 0, kind: "phone" };
    if (!url) return null;
    if (k.media === "image" || k.size_bytes <= PHONE_MAX_ORIGINAL) return { url, name: k.name, bytes: k.size_bytes, kind: "original" };
    return null;
  };
  const pullOne = async (k: Clip) => {
    const t = pullTarget(k);
    if (!t) {
      toast.error(k.phone_url === null && k.size_bytes > PHONE_MAX_ORIGINAL ? `Original is ${fmtSize(k.size_bytes)} — a phone-size copy is being made by the classifier (small ones first). Try again shortly.` : "No fresh link yet — re-minted every 20 min.");
      return;
    }
    setPull((m) => ({ ...m, [k.id]: { pct: 0, loaded: 0 } }));
    try {
      const file = await pullFile(t, (loaded, total) => setPull((m) => ({ ...m, [k.id]: { pct: total ? Math.round((loaded / total) * 100) : null, loaded } })), 240_000);
      setPull((m) => ({ ...m, [k.id]: { pct: 100, loaded: file.size, file } }));
      toast.success(`${fmtSize(file.size)} ready — tap Save to open the share sheet`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 80) : "unknown";
      setPull((m) => ({ ...m, [k.id]: { pct: null, loaded: 0, error: msg } }));
      toast.error(`Couldn't pull it (${msg}). Opening the file directly instead.`);
      window.open(t.url, "_blank", "noopener");
    }
  };
  const shareOne = async (k: Clip) => {
    const file = pull[k.id]?.file;
    if (!file) return;
    try {
      const out = await shareFiles([file], k.name);
      if (out === "shared") toast.success("Sent to the share sheet — tap Save Video / Save Image");
    } catch (e) {
      toast.error(`Share sheet refused: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);
    }
  };
  const saveOne = async (k: Clip) => {
    const url = directUrl(k);
    if (!mobileSave) {
      if (!url) { window.open(dropboxUrl(k.path), "_blank", "noopener"); return; }
      const a = document.createElement("a"); a.href = url; a.download = k.name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    if (pull[k.id]?.file) return void shareOne(k);
    if (pull[k.id] && pull[k.id].pct !== null && !pull[k.id].error && !pull[k.id].file) return;   // already pulling
    return void pullOne(k);
  };
  // One tap for the whole filtered set. Desktop: fires each fresh direct link (Chrome asks once). Phone: pulls the
  // phone-size copies (up to 250 MB per batch) with a percentage, then a second tap hands the batch to the share sheet.
  const MOBILE_BATCH_BYTES = 250 * 1024 * 1024;
  const [batch, setBatch] = useState<{ files: File[]; left: number; stale: number } | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const downloadAll = async (rows: Clip[]) => {
    if (batch?.files.length && mobileSave) {
      try { const out = await shareFiles(batch.files, `${batch.files.length} clips`); if (out === "shared") { toast.success(`${batch.files.length} in the share sheet — Save to camera roll${batch.left ? ` · ${batch.left} more, run it again` : ""}`); setBatch(null); } }
      catch (e) { toast.error(`Share sheet refused: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`); }
      return;
    }
    const ready = rows.filter((k) => directUrl(k) || k.phone_url);
    const stale = rows.length - ready.length;
    if (ready.length === 0) { toast.error("No fresh download links yet — the classifier re-mints them every 20 min."); return; }
    setDownloadingAll(true);
    try {
      if (mobileSave) {
        const targets = ready.map((k) => ({ k, t: pullTarget(k) })).filter((x): x is { k: Clip; t: NonNullable<ReturnType<typeof pullTarget>> } => Boolean(x.t));
        let bytes = 0; const picked: typeof targets = [];
        for (const x of targets) { if (picked.length && bytes + x.t.bytes > MOBILE_BATCH_BYTES) break; picked.push(x); bytes += x.t.bytes; }
        if (picked.length === 0) { toast.error("These originals are too big for a phone — phone-size copies are being made. Try again shortly."); return; }
        const files: File[] = [];
        for (let i = 0; i < picked.length; i++) {
          setPulling(`${i + 1}/${picked.length}`);
          files.push(await pullFile(picked[i].t, (loaded, total) => setPulling(`${i + 1}/${picked.length} ${total ? Math.round((loaded / total) * 100) + "%" : fmtSize(loaded)}`), 240_000));
        }
        setBatch({ files, left: ready.length - picked.length, stale });
        toast.success(`${files.length} clip${files.length === 1 ? "" : "s"} ready (${fmtSize(files.reduce((n, f) => n + f.size, 0))}) — tap Save all again to open the share sheet`);
      } else {
        await saveMedia(ready.map((k) => ({ url: directUrl(k) as string, name: k.name })));
        toast.success(`${ready.length} download${ready.length === 1 ? "" : "s"} started${stale ? ` · ${stale} waiting on a fresh link` : ""}`);
      }
    } catch (e) {
      toast.error(`Couldn't pull the pack: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);
    } finally { setDownloadingAll(false); setPulling(null); }
  };
  const [length, setLength] = useState<LengthKey>("all");
  const [sortBy, setSortBy] = useState<"banger" | "newest">("banger");
  const [shown, setShown] = useState(96);
  const [picked, setPicked] = useState<Set<string>>(new Set());   // Library multi-select for sharing
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shareSelected = async () => {
    if (picked.size === 0) return;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
    const { error } = await supabase.from("content_shares").insert({ token, clip_ids: Array.from(picked), label: `${picked.size} clip${picked.size === 1 ? "" : "s"} from the Launch Board` });
    if (error) { toast.error(`Couldn't create the share: ${error.message.slice(0, 100)}`); return; }
    const url = `${window.location.origin}/share/${token}`;
    try { await navigator.clipboard.writeText(url); toast.success("Share link copied — paste it anywhere"); }
    catch { toast.success(`Share link: ${url}`); }
    setPicked(new Set());
  };
  useEffect(() => { setShown(96); }, [query, folder, length, pillar, proof, proofKind]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [postTarget, setPostTarget] = useState<Card | null>(null);        // publish kit: caption, clip, live-URL confirmation
  const [publishUrl, setPublishUrl] = useState("");
  const [scheduleTarget, setScheduleTarget] = useState<Card | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);   // the burst rises from Confirm published
  // null = not probed yet; false = the §11 migration is not on this database, so new stages cannot be written.
  const [workflowReady, setWorkflowReady] = useState<boolean | null>(null);
  const [attachTarget, setAttachTarget] = useState<Card | null>(null);   // card waiting for a clip from the Library

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // Only a failed read of the cards themselves blanks the list. A clip page or the classifier read failing later
    // leaves the board as loaded and says so in a toast.
    let cardsOk = false;
    try {
      const c = await supabase.from("content_cards").select("*").order("day", { ascending: true }).order("sort", { ascending: true });
      if (c.error) throw c.error;
      const loaded = (c.data ?? []) as (Card & { archived_at?: string | null })[];
      setCards(loaded.filter((card) => !card.archived_at));
      setArchivedCards(loaded.filter((card) => card.archived_at));
      cardsOk = true;
      // Probe the §11 columns once. A missing column (42703) means the migration has not reached this database:
      // the board still reads, and says plainly that stage moves are unavailable rather than failing on every tap.
      const probe = await supabase.from("content_cards").select("published_url" as never).limit(1);
      setWorkflowReady(!probe.error);
      // The whole library, paged in PARALLEL: PostgREST returns at most 1,000 rows per request, and seven
      // sequential round-trips were the visible half of "Loading your board…" (the other half was RLS
      // evaluating a SECURITY DEFINER function per row — fixed in migration 20260913031500). Eight ranges
      // fire at once; the first empty page bounds the set.
      const PAGE = 1000;
      const fetchPage = async (from: number) => {
        const k = await supabase.from("content_clips")
          .select("id, path, name, folder, kind, size_bytes, modified_at, used_by_card, thumb_url, preview_url, duration_s, title, description, find_label, tags, download_url, download_expires_at, hook_title, banger_score, banger_reason, media, transcript, testimonial, testimonial_kind, testimonial_reason, testimonial_source, width, height, phone_url, phone_bytes")
          .is("missing_at", null)   // Dropbox said path/not_found for these — a dead Download button is worse than no card
          .order("modified_at", { ascending: false, nullsFirst: false }).order("id", { ascending: true }).range(from, from + PAGE - 1);
        if (k.error) throw k.error;
        return (k.data as Clip[]) ?? [];
      };
      const all: Clip[] = [];
      for (let base = 0; base < 40000; base += 8 * PAGE) {
        const pages = await Promise.all(Array.from({ length: 8 }, (_, i) => fetchPage(base + i * PAGE)));
        for (const page of pages) all.push(...page);
        setClips([...all]);
        if (pages.some((page) => page.length < PAGE)) break;
      }
      // Classifier progress, so "N testimonials" never reads as a finished count while thousands are still unjudged.
      const h = await supabase.from("v_testimonial_classifier_health").select("judged, waiting, testimonials, last_judged_at").maybeSingle();
      if (!h.error && h.data) setHealth({ judged: h.data.judged ?? 0, waiting: h.data.waiting ?? 0, testimonials: h.data.testimonials ?? 0, last_judged_at: h.data.last_judged_at });
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "unknown error").slice(0, 160);
      if (cardsOk) toast.error(`The board loaded, but the Library did not: ${message}`);
      else setLoadError(message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);


  const patch = useCallback(async (id: string, changes: Partial<Card>) => {
    // Roll back only this card on failure; a whole-board snapshot would also undo other moves that saved.
    const before = cards.find((c) => c.id === id);
    const undo = () => { if (before) setCards((cs) => cs.map((c) => (c.id === id ? before : c))); };
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    const { data, error } = await supabase.from("content_cards").update(changes as never).eq("id", id).select("*").maybeSingle();
    if (error) { undo(); toast.error(`Save failed: ${error.message.slice(0, 160)}`); return false; }
    if (!data) { undo(); toast.error("Save failed: the card was not updated (no access, or it was deleted). Reload the board."); return false; }
    // The server is the truth: the workflow trigger stamps approval / confirmation and may map legacy values.
    setCards((cs) => cs.map((c) => (c.id === id ? (data as Card) : c)));
    return true;
  }, [cards]);

  // Workflow moves. Each one is a single server-validated write; the toast only fires after it lands.
  const move = async (c: Card, to: WorkflowStatus, extra: Partial<Card> = {}, msg?: string) => {
    if (workflowReady === false) { toast.error("Stage moves are unavailable until the Launch Board workflow migration is applied."); return false; }
    setBusyId(c.id);
    try {
      const ok = await patch(c.id, { status: to, ...extra });
      if (ok) toast.success(msg ?? "Moved");
      return ok;
    } finally { setBusyId(null); }
  };
  const sendBack = async (c: Card) => {
    const to = previousStatus(stageOf(c));
    if (!to) return false;
    // Leaving Ready/Scheduled/Published for an earlier stage drops the approval and any schedule/evidence on the row.
    const extra: Partial<Card> = to === "edit" || to === "record" || to === "idea"
      ? { approved_at: null, scheduled_for: null, schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null }
      : to === "ready" ? { scheduled_for: null, schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null } : {};
    return move(c, to, extra, `Sent back to ${SEND_BACK_WORDS[to]}`);
  };
  // Approval is admin-only and enforced by the database trigger; the button is hidden for everyone else.
  const approve = async (c: Card) => {
    if (!isAdmin) { toast.error("Only an admin can approve content for publishing."); return false; }
    if (!(c.caption ?? "").trim()) { toast.error("Write the caption before approving."); return false; }
    return move(c, "ready", { approved_at: new Date().toISOString() }, "Approved. It is ready to post.");
  };
  const openSchedule = (c: Card) => {
    setScheduleTarget(c);
    const d = c.scheduled_for ? new Date(c.scheduled_for) : new Date(Date.now() + 24 * 3600_000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    setScheduleAt(local);
  };
  const saveSchedule = async () => {
    if (!scheduleTarget) return;
    const when = new Date(scheduleAt);
    if (!scheduleAt || Number.isNaN(when.getTime())) { toast.error("Pick a date and time."); return; }
    // No scheduler integration writes jobs to this board yet, so every schedule a person sets is a manual plan.
    if (await move(scheduleTarget, "scheduled", { scheduled_for: when.toISOString(), schedule_kind: "manual", schedule_job_ref: null }, "Planned. It is a manual plan: nothing posts by itself.")) setScheduleTarget(null);
  };
  const openPublish = (c: Card) => { setPostTarget(c); setPublishUrl(c.published_url ?? ""); };
  const publishCheck = useMemo(() => checkPublishUrl(publishUrl, postTarget?.brand), [publishUrl, postTarget]);
  const confirmPublished = async () => {
    if (!postTarget) return;
    if (!publishCheck.ok) { toast.error(publishCheck.reason); return; }
    if (await move(postTarget, "published", { published_url: publishUrl.trim(), publish_evidence: "manual_confirmation", posted_at: postTarget.posted_at ?? new Date().toISOString() }, `Published — confirmed on ${publishCheck.platform}`)) {
      void celebrate("win", confirmRef.current);
      setPostTarget(null);
    }
  };
  const copyCaption = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Caption copied"); }
    catch { toast.error("Clipboard blocked — select the text and copy it"); }
  };
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
    catch { toast.error("Clipboard blocked — open the card and select the text"); }
  };
  const togglePillar = async (k: Clip, p: PillarKey) => {
    const cur = k.tags ?? [];
    const on = cur.some((t) => t.toLowerCase() === p);
    const next = on ? cur.filter((t) => t.toLowerCase() !== p) : [...cur, p];
    const { error } = await supabase.from("content_clips").update({ tags: next }).eq("id", k.id);
    if (error) { toast.error(error.message); return; }
    setClips((prev) => prev.map((c) => (c.id === k.id ? { ...c, tags: next } : c)));
    toast.success(on ? `Removed ${p}` : `Tagged ${p}`);
  };

  const remove = async (c: Card) => {
    const ok = await askConfirm({ title: "Delete this card?", description: c.title, confirmText: "Delete", tone: "danger" });
    if (!ok) return false;
    const prev = cards; setCards((cs) => cs.filter((x) => x.id !== c.id));
    const { error } = await supabase.from("content_cards").delete().eq("id", c.id);
    if (error) { setCards(prev); toast.error(`Delete failed: ${error.message.slice(0, 120)}`); return false; }
    toast.success("Deleted");
    return true;
  };

  // Library → card
  const attachClip = async (clip: Clip, card: Card) => {
    // Attaching footage is source media, not a stage move: an Idea/Record card goes to Edit only when the workflow is live.
    const st = stageOf(card);
    const ok = await patch(card.id, workflowReady && (st === "idea" || st === "record") ? { clip: clip.path, status: "edit" } : { clip: clip.path });
    if (!ok) return;
    const link = await supabase.from("content_clips").update({ used_by_card: card.id }).eq("id", clip.id);
    if (link.error) toast.error(`Clip attached to the card, but the library link did not save: ${link.error.message.slice(0, 100)}`);
    setClips((ks) => ks.map((k) => (k.id === clip.id ? { ...k, used_by_card: card.id } : k)));
    setAttachTarget(null); toast.success(`Attached to “${card.title}”`); setTab("today");
  };
  const cardFromClip = async (clip: Clip) => {
    const nextSort = (cards.reduce((m, c) => Math.max(m, c.sort), 0) || 0) + 10;
    const { data, error } = await supabase.from("content_cards")
      .insert({ title: cleanName(clip.name), brand: clip.kind === "vertical" ? "SH" : "YT", job: "REACH", content_type: clip.kind === "vertical" ? "short" : "long", hook: "", caption: "", clip: clip.path, day: 0, status: workflowReady ? "edit" : "recorded", sort: nextSort, record_script: "", edit_prompt: "" } as never)
      .select("*").single();
    if (error) { toast.error(`Couldn't create the card: ${error.message.slice(0, 120)}`); return; }
    setCards((cs) => [...cs, data as Card]);
    const link = await supabase.from("content_clips").update({ used_by_card: (data as Card).id }).eq("id", clip.id);
    if (link.error) toast.error(`Card created, but the library link did not save: ${link.error.message.slice(0, 100)}`);
    else setClips((ks) => ks.map((k) => (k.id === clip.id ? { ...k, used_by_card: (data as Card).id } : k)));
    toast.success("Card created in Edit with the footage attached — write the edit instructions and caption next");
  };

  // Only untouched idea cards can be cleared. Footage and work in progress stay visible.
  const unusedIdeas = cards.filter((c) => c.status === "idea" && !(c.clip ?? "").trim());
  const archiveIdeas = async (restore = false) => {
    if (archiveBusy) return;
    const targets = restore ? archivedCards : unusedIdeas;
    if (!targets.length) return;
    setArchiveBusy(true);
    try {
      let query = supabase.from("content_cards").update({ archived_at: restore ? null : new Date().toISOString() } as never).in("id", targets.map((c) => c.id));
      if (!restore) query = query.eq("status", "idea").or("clip.is.null,clip.eq.");
      const { data, error } = await query.select("*");
      if (error) throw error;
      if (!data?.length) throw new Error("No cards changed. Reload the board and try again.");
      const changed = data as Card[];
      const ids = new Set(changed.map((c) => c.id));
      if (restore) {
        setArchivedCards((prev) => prev.filter((c) => !ids.has(c.id)));
        setCards((prev) => [...prev.filter((c) => !ids.has(c.id)), ...changed]);
      } else {
        setCards((prev) => prev.filter((c) => !ids.has(c.id)));
        setArchivedCards((prev) => [...prev.filter((c) => !ids.has(c.id)), ...changed]);
      }
      toast.success(`${changed.length} idea${changed.length === 1 ? "" : "s"} ${restore ? "restored" : "cleared — you can restore them here"}`);
    } catch (e) { toast.error(`Couldn't ${restore ? "restore" : "clear"} ideas: ${e instanceof Error ? e.message : "save failed"}`); }
    finally { setArchiveBusy(false); }
  };

  // ── Film next: choose, dismiss, remake and save progress. Every write goes through src/lib/contentProjects.ts. ──
  const db = supabase as unknown as DbClient;
  const ideas = useMemo<PickIdea[]>(() => {
    const seen = new Set(BANK_IDEAS.map((i) => i.title.trim().toLowerCase()));
    const fromInsights = ((insights as Insights | null)?.ideas ?? []).map(ideaFromInsight).filter((i) => !seen.has(i.title.trim().toLowerCase()));
    return [...BANK_IDEAS, ...fromInsights];
  }, [insights]);
  const usedIdeas = useMemo(() => usedMarkers([...cards, ...archivedCards]), [cards, archivedCards]);
  const putCard = (card: Card) => {
    setCards((prev) => (prev.some((c) => c.id === card.id) ? prev.map((c) => (c.id === card.id ? card : c)) : [...prev, card]));
    setArchivedCards((prev) => prev.filter((c) => c.id !== card.id));
  };

  const pickIdea = async (idea: PickIdea, edits?: IdeaEdits) => {
    if (picking) return;
    if (workflowReady !== true) { toast.error("Picking is unavailable until the Launch Board workflow migration is applied."); return; }
    setPicking(true); setBusyIdeaKey(idea.key);
    try {
      const r = await createProjectFromIdea(db, idea, edits, {
        live: cards, archived: archivedCards, weekday: phoenixWeekday(), plannedWeek: phoenixWeekStart(),
        editPrompt: (d) => editTemplate({ ...emptyDraft, ...d }),
      });
      if (!r.ok) { toast.error(`Couldn't pick this video: ${r.error}`); return; }
      putCard(r.card as unknown as Card);
      setNewIdeaOpen(false);
      setPackId(r.card.id);
      toast.success(r.created ? "Picked for filming. Your pack is ready." : r.restored ? "Brought back from your archive." : "That one is already on your board. Opened it.");
    } finally { setPicking(false); setBusyIdeaKey(null); }
  };
  const saveIdeaLater = async (idea: PickIdea) => {
    if (picking) return;
    setPicking(true); setBusyIdeaKey(idea.key);
    try {
      const r = await saveIdeaForLater(db, idea, { live: cards, archived: archivedCards });
      if (!r.ok) { toast.error(`Couldn't save the idea: ${r.error}`); return; }
      putCard(r.card as unknown as Card);
      toast.success(r.created ? "Saved to your ideas." : "That idea is already on your board.");
    } finally { setPicking(false); setBusyIdeaKey(null); }
  };
  const undoDismiss = async (ideaKey: string) => {
    const r = await undoDismissal(db, ideaKey);
    if (!r.ok) { toast.error(`Couldn't bring it back: ${r.error}`); return; }
    setDismissals((prev) => prev.filter((d) => d.idea_key !== ideaKey));
  };
  const dismissIdea = async (idea: PickIdea, reason: string) => {
    if (picking) return;
    setPicking(true); setBusyIdeaKey(idea.key);
    try {
      const r = await dismissIdeaRow(db, idea, reason);
      if (!r.ok) { toast.error(`Couldn't dismiss it: ${r.error}`); return; }
      setDismissals((prev) => (prev.some((d) => d.idea_key === idea.key) ? prev : [{ idea_key: idea.key, title: idea.title, reason: reason.trim() || null, dismissed_at: new Date().toISOString() }, ...prev]));
      toast.success("Dismissed. It will not come back unless you ask.", { action: { label: "Undo", onClick: () => void undoDismiss(idea.key) } });
    } finally { setPicking(false); setBusyIdeaKey(null); }
  };
  const remake = async (draft: RemakeDraft) => {
    if (remaking) return;
    setRemaking(true);
    try {
      const r = await createRemake(db, draft, { live: cards, archived: archivedCards, weekday: phoenixWeekday(), plannedWeek: phoenixWeekStart() });
      if (!r.ok) { toast.error(`Couldn't create the draft: ${r.error}`); return; }
      putCard(r.card as unknown as Card);
      setPackId(r.card.id);
      toast.success(r.created ? "Draft created. The original post is untouched." : "You already made that remake. Opened it.");
    } finally { setRemaking(false); }
  };
  const savePackText = async (cardId: string, text: string): Promise<boolean> => {
    const r = await savePack(db, cardId, text);
    if (!r.ok) { toast.error(`Not saved: ${r.error}`); return false; }
    putCard(r.card as unknown as Card);
    return true;
  };
  const packCard = packId ? [...cards, ...archivedCards].find((c) => c.id === packId) ?? null : null;

  const openEdit = (c: Card) => { setEditing(c); setDraft({ ...c }); setEditorOpen(true); };
  const draftStr = (k: string) => String(draft[k] ?? "");
  const setDraftField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const saveDraft = async () => {
    const title = draftStr("title").trim();
    if (!title) { toast.error("Give the card a title"); return; }
    setSaving(true);
    const base: Record<string, unknown> = { title, brand: draftStr("brand") || "SH", job: draftStr("job") || "REACH", content_type: draftStr("content_type") || "short", hook: draftStr("hook"), caption: draftStr("caption"), clip: draftStr("clip"), day: Number(draft.day ?? 0), record_script: draftStr("record_script"), edit_prompt: draftStr("edit_prompt") };
    // The §11 fields are only sent once the migration is live, so the editor keeps working on the legacy schema.
    if (workflowReady) for (const f of WORKFLOW_FIELDS) base[f] = f === "due_date" ? (draftStr(f) || null) : draftStr(f);
    const payload = editing ? base : { ...base, status: "idea" };
    try {
      if (editing) {
        const { data, error } = await supabase.from("content_cards").update(payload as never).eq("id", editing.id).select("*").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("the card was not updated (no access, or it was deleted)");
        setCards((cs) => cs.map((c) => (c.id === editing.id ? (data as Card) : c)));
      } else {
        const nextSort = (cards.reduce((m, c) => Math.max(m, c.sort), 0) || 0) + 10;
        const { data, error } = await supabase.from("content_cards").insert({ ...payload, sort: nextSort } as never).select("*").single();
        if (error) throw error;
        setCards((cs) => [...cs, data as Card]);
      }
      setEditorOpen(false); toast.success(editing ? "Saved" : "Idea added");
    } catch (e: unknown) {
      toast.error(`Couldn't save: ${(e instanceof Error ? e.message : "unknown error").slice(0, 120)}`);
    } finally { setSaving(false); }
  };
  const sendBackFromEditor = async (c: Card) => { if (await sendBack(c)) setEditorOpen(false); };
  const deleteFromEditor = async (c: Card) => { if (await remove(c)) setEditorOpen(false); };

  // The one next step on a row or on Up next. Moves are one server-validated write each; the rest open what the step
  // needs. A burst follows only a move the server confirmed, from the button that was pressed.
  const act = async (v: BoardVideo, next: VideoNextStep, origin: HTMLElement | null) => {
    const c = cards.find((x) => x.id === v.id);
    if (!c) return;
    switch (next.kind) {
      case "film": {
        const ok = await move(c, "record", {}, "Picked to film. It is in Selected now.");
        if (!ok) return;
        void celebrate("save", origin);
        if ((c.record_script ?? "").trim()) setPackId(c.id);
        return;
      }
      case "advance": {
        if (!next.to) return;
        const ok = await move(c, next.to, {}, next.to === "edit" ? "Moved to editing" : "Sent for approval");
        if (ok) void celebrate("save", origin);
        return;
      }
      case "approve": {
        if (await approve(c)) void celebrate("booked", origin);
        return;
      }
      case "pack": setPackId(c.id); return;
      case "attach": setAttachTarget(c); setTab("library"); return;
      case "post":
      case "link": openPublish(c); return;
      default: openEdit(c);
    }
  };

  // Library: the clips that match the search and filters, best first.
  const visibleClips = useMemo(() => {
    const q = query.trim().toLowerCase();
    const SYN: Record<string, string> = { gym: "workout", exercise: "workout", weights: "workout", lifting: "workout", fitness: "workout", cars: "car", vehicle: "car", corvette: "car", driving: "car", aerial: "drone", dji: "drone", desk: "office", computer: "office", laptop: "office", talking: "talking-head", speaking: "talking-head", podcast: "talking-head", vlog: "talking-head", outside: "outdoors", street: "outdoors", sunset: "outdoors", crowd: "event", seminar: "event", conference: "event", tiktok: "vertical", reel: "vertical", reels: "vertical", youtube: "horizontal" };
    const words = q.split(/\s+/).filter(Boolean).map((w) => SYN[w] ?? w);
    // What the clip SAYS (whisper transcript / screenshot OCR) is searchable too — "first deal", "license", a person's name.
    const hay = (k: Clip) => `${k.find_label ?? ""} ${k.title ?? ""} ${k.description ?? ""} ${(k.tags ?? []).join(" ")} ${k.name} ${k.transcript ?? ""} ${k.testimonial_reason ?? ""}`.toLowerCase();
    const lenOk = (k: Clip) => {
      const d = Number(k.duration_s ?? 0);
      return length === "all" || k.media === "image" || (length === "short" ? d > 0 && d <= 60 : length === "mid" ? d > 60 && d <= 300 : d > 300);
    };
    const proofOk = (k: Clip) => proof === "all" || (isTestimonial(k) && (proofKind === "all" || proofKindOf(k) === proofKind));
    const out = clips.filter((k) => proofOk(k) && (folder === "all" || k.folder === folder) && lenOk(k) && (pillar === "all" || pillarsOf(k).includes(pillar)) && (!words.length || words.every((w) => hay(k).includes(w))));
    if (sortBy === "banger") out.sort((a, b) => (b.banger_score ?? -1) - (a.banger_score ?? -1) || (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
    else out.sort((a, b) => (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
    return out;
  }, [clips, query, folder, length, pillar, sortBy, proof, proofKind]);
  const testimonialClips = useMemo(() => clips.filter(isTestimonial), [clips]);
  const fmtDur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

  if (loading && cards.length === 0 && !loadError) return <PageSkeleton />;

  const locked = workflowReady === false;
  const view: Tab = tab === "board" ? "today" : tab;
  const hasScreenshots = clips.some((k) => k.folder === "Screenshots");
  const activeFilters: { key: string; label: string; clear: () => void }[] = [
    ...(folder !== "all" ? [{ key: "folder", label: FOLDER_LABEL[folder], clear: () => setFolder("all") }] : []),
    ...(length !== "all" ? [{ key: "length", label: LENGTH_LABEL[length], clear: () => setLength("all") }] : []),
    ...(pillar !== "all" ? [{ key: "pillar", label: PILLARS.find((p) => p.k === pillar)?.label ?? pillar, clear: () => setPillar("all") }] : []),
  ];

  const scheduleNote = (c: Card) => {
    const s = scheduleLabel(c);
    if (!s || !c.scheduled_for) return null;
    return <span className="text-[13px] text-muted-foreground">{s.label} · {new Date(c.scheduled_for).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>;
  };

  const ideasFooter = (unusedIdeas.length > 0 || archivedCards.length > 0) ? (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[15px] leading-6 text-muted-foreground">Clear the ideas nobody started. Anything with footage stays, and you can bring them back here.</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {unusedIdeas.length > 0 && <Button type="button" variant="outline" className="h-11" disabled={archiveBusy} onClick={() => void archiveIdeas()}>Clear {unusedIdeas.length} unused {unusedIdeas.length === 1 ? "idea" : "ideas"}</Button>}
        {archivedCards.length > 0 && <Button type="button" variant="ghost" className="h-11" disabled={archiveBusy} onClick={() => void archiveIdeas(true)}>Bring back {archivedCards.length} cleared</Button>}
      </div>
    </div>
  ) : null;

  const editingStep = editing ? videoStep({ ...editing, ...(draft as Partial<Card>) } as Card, new Date()) : null;
  const editingNext = editing ? videoNextStep({ ...editing, ...(draft as Partial<Card>) } as Card, { isAdmin, now: new Date() }) : null;
  const editingBack = editing ? previousStatus(stageOf(editing)) : null;
  const postStep = postTarget ? videoStep(postTarget, new Date()) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        className="mb-3"
        eyebrow="Owner"
        icon={<Clapperboard />}
        tone="gold"
        title="Launch Board"
        subtitle="Every video from idea to published."
        primaryAction={
          // Outline on purpose: the one gold button is Up next's.
          <Button type="button" variant="outline" className="h-11 bg-card" onClick={() => setNewIdeaOpen(true)}>
            <Lightbulb className="h-4 w-4" aria-hidden /> New idea
          </Button>
        }
      />

      <nav aria-label="Launch Board views" className="mb-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {VIEWS.map((v) => {
          const active = view === v.k;
          return (
            <button
              key={v.k}
              type="button"
              onClick={() => setTab(v.k)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </nav>

      {locked && (
        <div role="status" className={cn("mb-5 rounded-lg border px-4 py-3 text-[15px] leading-6 text-foreground", TONE_CLASS.hot.border, "bg-tone-hot/8")}>
          The content workflow migration (20261006150000) is not on this database yet. The board, library and downloads work; stage moves, approvals, plans and publish confirmations are off until it is applied.
        </div>
      )}

      {view === "today" && (
        <LaunchBoardList
          cards={cards}
          status={loadError ? "error" : loading && cards.length === 0 ? "loading" : "ready"}
          error={loadError}
          onRetry={() => void load()}
          isAdmin={isAdmin}
          busyId={busyId}
          locked={locked}
          onAct={(v, next, origin) => void act(v, next, origin)}
          onOpen={(v) => { const c = cards.find((x) => x.id === v.id); if (c) openEdit(c); }}
          onNewIdea={() => setNewIdeaOpen(true)}
          ideasFooter={ideasFooter}
        />
      )}

      {view === "week" && (
        <WeekPlan cards={cards} formatLine={FORMAT_LINE} onOpen={(c) => openEdit(c as Card)}
          onMove={(c, day) => { void patch(c.id, { day, planned_week: day ? phoenixWeekStart() : null }).then((ok) => { if (ok) toast.success(day ? `Moved to ${DAY_THEMES[day].name}` : "Moved to Not planned yet"); }); }}
          onAdd={(d) => { const long = DAY_THEMES[d].longTarget > 0; setDraft({ ...emptyDraft, day: d, brand: long ? "YT" : "SH", content_type: long ? "long" : "short" }); setEditing(null); setEditorOpen(true); }} />
      )}

      {view === "library" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what's in a clip: car, gym, drone, office" aria-label="Search the library" enterKeyHint="search" className="h-11 bg-card pl-9 text-base" />
            </div>
            <div className="flex gap-2">
              {/* Testimonials: FaceTime/phone calls where someone praises Sam, plus screenshots and texts saying how good it is.
                  Verdicts come from what the clip SAYS (whisper transcript / OCR), judged by the classifier daemon; Sam's tap wins. */}
              <button type="button" aria-pressed={proof === "testimonials"} onClick={() => chooseProof(proof === "testimonials" ? "all" : "testimonials")} title="FaceTime calls, videos with someone praising the agency, screenshots and texts" className={chipClass(proof === "testimonials")}>
                <MessageSquareQuote className="h-4 w-4" aria-hidden /> Testimonials <span className="tabular-nums text-muted-foreground">{testimonialClips.length.toLocaleString()}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={chipClass(activeFilters.length > 0 || sortBy !== "banger")} aria-label={activeFilters.length ? `Filters, ${activeFilters.length} on` : "Filters and order"}>
                    <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{activeFilters.length ? <span className="tabular-nums text-muted-foreground">{activeFilters.length}</span> : null}
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[70dvh] w-72 overflow-y-auto">
                  <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">Folder</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={folder} onValueChange={(v) => setFolder(v as FolderKey)}>
                    {(["all", "YouTube", "Reels", "Screenshots"] as const).filter((f) => f !== "Screenshots" || hasScreenshots).map((f) => (
                      <DropdownMenuRadioItem key={f} value={f} className="min-h-11 text-[15px]">{FOLDER_LABEL[f]}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">Length</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={length} onValueChange={(v) => setLength(v as LengthKey)}>
                    {(["all", "short", "mid", "long"] as const).map((l) => <DropdownMenuRadioItem key={l} value={l} className="min-h-11 text-[15px]">{LENGTH_LABEL[l]}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">Topic</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={pillar} onValueChange={(v) => setPillar(v as "all" | PillarKey)}>
                    <DropdownMenuRadioItem value="all" className="min-h-11 justify-between text-[15px]"><span>Any topic</span><span className="tabular-nums text-muted-foreground">{clips.length.toLocaleString()}</span></DropdownMenuRadioItem>
                    {PILLARS.map((p) => (
                      <DropdownMenuRadioItem key={p.k} value={p.k} className="min-h-11 justify-between gap-3 text-[15px]">
                        <span>{p.label}</span><span className="tabular-nums text-muted-foreground">{clips.filter((k) => pillarsOf(k).includes(p.k)).length.toLocaleString()}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">Order</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as "banger" | "newest")}>
                    <DropdownMenuRadioItem value="banger" className="min-h-11 text-[15px]">Strongest first</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="newest" className="min-h-11 text-[15px]">Newest first</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {proof === "testimonials" && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Which testimonials">
              {([{ k: "all", label: "All" }, { k: "video", label: "Calls and videos" }, { k: "image", label: "Screenshots and texts" }] as { k: ProofKind; label: string }[]).map((p) => {
                const n = p.k === "all" ? testimonialClips.length : testimonialClips.filter((k) => proofKindOf(k) === p.k).length;
                return (
                  <button key={p.k} type="button" aria-pressed={proofKind === p.k} onClick={() => setProofKind(p.k)} className={chipClass(proofKind === p.k)}>
                    {p.label} <span className="tabular-nums text-muted-foreground">{n.toLocaleString()}</span>
                  </button>
                );
              })}
              <Button type="button" variant="outline" disabled={downloadingAll || visibleClips.length === 0} onClick={() => void downloadAll(visibleClips)} className={cn("h-11 sm:ml-auto", TONE_CLASS.good.text, TONE_CLASS.good.border)} title="Fire every fresh direct link in this set — allow multiple downloads when Chrome asks once">
                {downloadingAll ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}{downloadingAll && pulling ? `Pulling ${pulling}` : batch?.files.length && mobileSave ? `Save ${batch.files.length} to camera roll` : `${mobileSave ? "Get all" : "Download all"} ${visibleClips.length.toLocaleString()}`}
              </Button>
            </div>
          )}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filters on">
              {activeFilters.map((f) => (
                <button key={f.key} type="button" onClick={f.clear} aria-label={`Remove filter: ${f.label}`} className={cn(chipClass(true), "min-h-10 px-3")}>
                  {f.label} <X className="h-4 w-4" aria-hidden />
                </button>
              ))}
            </div>
          )}
          <p className="text-[15px] leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground">{visibleClips.length.toLocaleString()} {visibleClips.length === 1 ? "clip" : "clips"}</span>
            {sortBy === "banger" ? ", strongest first" : ", newest first"}
            {health && (proof === "testimonials" || health.waiting > 0) && (
              <> · The classifier has judged {health.judged.toLocaleString()} and has {health.waiting.toLocaleString()} still to go{health.last_judged_at ? ` (last ${fmtDate(health.last_judged_at)})` : ""}, so this list grows as it works.</>
            )}
            {" "}<button type="button" onClick={() => setShowDetails(!showDetails)} aria-pressed={showDetails} className="font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">{showDetails ? "Hide details" : "Show details"}</button>
          </p>
          {attachTarget && (
            <div role="status" className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3 text-[15px] text-foreground sm:flex-row sm:items-center sm:justify-between", TONE_CLASS.gold.border, "bg-tone-gold/8")}>
              <span>Pick the footage for <b>{attachTarget.title}</b>, then tap Attach on its clip.</span>
              <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => { setAttachTarget(null); setTab("today"); }}>Cancel</Button>
            </div>
          )}
          {picked.size > 0 && (
            <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-background px-3 py-2 text-[15px]">
              <span className="font-semibold text-foreground">{picked.size} selected</span>
              <Button size="sm" onClick={shareSelected} className="h-11"><Copy className="h-4 w-4" aria-hidden />Copy share link</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} className="h-11 text-muted-foreground">Clear</Button>
              <span className="text-sm text-muted-foreground">Anyone with the link can preview and download these originals, no login.</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleClips.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-border p-6 text-[15px] text-muted-foreground">No clips match. Previews and titles fill in as the Mac mini indexes your Dropbox, newest first.</p>}
            {visibleClips.slice(0, shown).map((k) => (
              <div key={k.id} className={cn("group relative flex flex-col overflow-hidden rounded-xl border bg-card", picked.has(k.id) ? "border-primary" : "border-border")}>
                <label className="absolute left-2 top-2 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border bg-background/90 text-primary" title="Select to share">
                  <input type="checkbox" checked={picked.has(k.id)} onChange={() => togglePick(k.id)} aria-label={`Select ${k.find_label || k.title || cleanName(k.name)} to share`} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                </label>
                <a href={directUrl(k) ?? dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => {
                    // Phones and tablets have no hover: the first tap plays the preview, the next tap opens the clip.
                    const v = e.currentTarget.querySelector("video");
                    if (v && v.paused && window.matchMedia("(hover: none)").matches) { e.preventDefault(); v.style.opacity = "1"; void v.play(); }
                  }}
                  className={cn("relative block bg-muted/40", k.kind === "vertical" ? "aspect-[9/16] max-h-64" : "aspect-video")} title={k.media === "image" ? "Open the screenshot" : "Open in Dropbox"}>
                  {k.thumb_url ? (
                    <>
                      <img src={k.thumb_url} alt="" loading="lazy" className={cn("h-full w-full", k.media === "image" ? "object-contain bg-muted" : "object-cover")} />
                      {isTestimonial(k) && (
                        <span className={cn("absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[13px] font-semibold", TONE_CLASS.gold.text)} title={k.testimonial_reason ?? "testimonial"}>
                          <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden /> {k.media === "image" ? "Text" : k.testimonial_kind === "video_call" ? "Call" : "Testimonial"}
                        </span>
                      )}
                      {k.preview_url && k.media !== "image" && (
                        <video src={k.preview_url} muted loop playsInline preload="none" onMouseEnter={(e) => { void e.currentTarget.play(); }} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">{k.media === "image" ? <ImageIcon className="h-6 w-6" aria-hidden /> : <Film className="h-6 w-6" aria-hidden />}</div>
                  )}
                  {k.duration_s ? <span className="absolute bottom-1.5 right-1.5 rounded-md bg-background/90 px-1.5 py-0.5 text-[13px] font-semibold tabular-nums text-foreground">{fmtDur(k.duration_s)}</span> : null}
                  {k.used_by_card && <span className={cn("absolute left-11 top-2.5 rounded-md bg-background/90 px-1.5 py-0.5 text-[13px] font-semibold", TONE_CLASS.good.text)}>On a card</span>}
                  {k.banger_score != null && (
                    <span className={cn("absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[13px] font-semibold tabular-nums", TONE_CLASS[bangerTone(k.banger_score)].text)} title={k.banger_reason ?? "traction potential"}>
                      <Flame className="h-3.5 w-3.5" aria-hidden /> {k.banger_score}
                    </span>
                  )}
                </a>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  {renaming?.id === k.id ? (
                    <input autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: k.id, text: e.target.value })} onBlur={() => void saveRename()} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(); if (e.key === "Escape") { renameDone.current = true; setRenaming(null); } }} aria-label="Clip title" className="w-full rounded-md border border-primary/60 bg-background px-2 py-1 text-base font-semibold text-foreground outline-none" />
                  ) : (
                    <button type="button" onClick={() => { renameDone.current = false; setRenaming({ id: k.id, text: k.find_label || k.title || cleanName(k.name) }); }} title="Tap to rename" className="line-clamp-2 text-left text-[15px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary">{k.find_label || k.title || cleanName(k.name)}</button>
                  )}
                  {k.hook_title && <button type="button" onClick={() => { void navigator.clipboard?.writeText(k.hook_title ?? "").then(() => toast.success("Hook copied")).catch(() => toast.error("Clipboard blocked")); }} title="Tap to copy the hook" className="line-clamp-1 text-left text-sm italic text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground">Hook: {k.hook_title}</button>}
                  {isTestimonial(k) && k.testimonial_reason && <div className={cn("line-clamp-2 text-sm", TONE_CLASS.gold.text)} title={k.testimonial_reason}>{k.testimonial_reason}</div>}
                  {!isTestimonial(k) && k.transcript && proof === "all" && query && <div className="line-clamp-2 text-sm italic text-muted-foreground" title={k.transcript}>“{k.transcript.slice(0, 140)}”</div>}
                  {(showDetails || proof === "testimonials") && <div className="flex items-center gap-1.5">
                    <span className="text-[13px] text-muted-foreground">{k.testimonial == null ? "Not judged yet" : isTestimonial(k) ? (k.testimonial_source === "manual" ? "Testimonial, marked by you" : "Testimonial") : "Not a testimonial"}</span>
                    <button type="button" onClick={() => void setVerdict(k, true)} aria-label="Mark as a testimonial" title="Mark as a testimonial" className={cn("rounded-md border p-1", isTestimonial(k) ? cn(TONE_CLASS.gold.border, TONE_CLASS.gold.soft, TONE_CLASS.gold.text) : "border-border text-muted-foreground")}><ThumbsUp className="h-3.5 w-3.5" aria-hidden /></button>
                    <button type="button" onClick={() => void setVerdict(k, false)} aria-label="Not a testimonial" title="Not a testimonial" className={cn("rounded-md border p-1", k.testimonial === false ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground")}><ThumbsDown className="h-3.5 w-3.5" aria-hidden /></button>
                  </div>}
                  {showDetails && k.banger_score != null && (
                    <div className="flex items-center gap-2" aria-hidden>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", TONE_CLASS[bangerTone(k.banger_score)].dot)} style={{ width: `${k.banger_score}%` }} /></div>
                    </div>
                  )}
                  {showDetails && <div className="flex flex-wrap gap-1">
                    {PILLARS.map((p) => {
                      const on = pillarsOf(k).includes(p.k);
                      return (
                        <button key={p.k} type="button" title={on ? `Tagged ${p.label}` : `Tag as ${p.label}`} onClick={() => void togglePillar(k, p.k)}
                          className={cn("rounded-md border px-1.5 py-0.5 text-[13px] font-semibold", on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground")}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>}
                  {showDetails && k.tags && k.tags.length > 0 && <div className="flex flex-wrap gap-1">{k.tags.slice(0, 4).map((tg) => <button key={tg} type="button" onClick={() => setQuery(tg)} className="rounded-full border border-border px-2 py-0.5 text-[13px] text-muted-foreground">{tg}</button>)}</div>}
                  <div className="mt-auto text-[13px] text-muted-foreground">{k.folder} · {fmtDate(k.modified_at)} · {fmtSize(k.size_bytes)}</div>
                  <div className="flex gap-1.5">
                    {attachTarget
                      ? <Button size="sm" variant="outline" onClick={() => attachClip(k, attachTarget)} className="h-10 flex-1 px-2.5 text-[13px]"><Paperclip className="h-3.5 w-3.5" aria-hidden />Attach</Button>
                      : <Button size="sm" variant="outline" onClick={() => cardFromClip(k)} className="h-10 flex-1 px-2.5 text-[13px]"><Plus className="h-3.5 w-3.5" aria-hidden />New card</Button>}
                    {(directUrl(k) || k.phone_url)
                      ? <Button size="sm" variant="outline" disabled={mobileSave && !!pull[k.id] && pull[k.id].pct !== null && pull[k.id].pct! < 100 && !pull[k.id].error} onClick={() => void saveOne(k)}
                          className={cn("h-10 px-2.5 text-[13px] font-semibold", TONE_CLASS.good.text, TONE_CLASS.good.border, pull[k.id]?.file && TONE_CLASS.good.soft)}
                          title={mobileSave ? (k.phone_url ? "Phone-size copy — tap to pull, tap again to save to camera roll" : "Tap to pull, tap again to save to camera roll") : "Download the original — one tap"}>
                          {mobileSave && pull[k.id] && !pull[k.id].file && !pull[k.id].error ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
                          {!mobileSave ? "Download" : pull[k.id]?.file ? "Save to camera roll" : pull[k.id] && !pull[k.id].error ? (pull[k.id].pct !== null ? `${pull[k.id].pct}%` : fmtSize(pull[k.id].loaded)) : k.phone_url ? `Get · ${fmtSize(k.phone_bytes ?? 0)}` : "Get"}
                        </Button>
                      : <Button asChild size="sm" variant="outline" className="h-10 px-2.5 text-[13px] text-muted-foreground"><a href={dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer" title="Direct link is being re-minted (every 20 min) — this opens the file in Dropbox, where Download is one tap"><ExternalLink className="h-3.5 w-3.5" aria-hidden />Dropbox</a></Button>}
                    <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(k.path).then(() => toast.success("Path copied")).catch(() => toast.error("Clipboard blocked")); }} className="h-10 w-10 px-0 text-muted-foreground" aria-label="Copy the Dropbox path" title="Copy Dropbox path (for getclips / editors)"><Copy className="h-4 w-4" aria-hidden /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {visibleClips.length > shown && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" className="h-11" onClick={() => setShown((n) => n + 96)}>Show {Math.min(96, visibleClips.length - shown)} more ({(visibleClips.length - shown).toLocaleString()} not shown yet)</Button>
            </div>
          )}
        </div>
      )}

      {view === "analytics" && (
        <Suspense fallback={<PageSkeleton />}>
          <AccountsAnalytics
            lead={(
              <WinnersPanel
                posts={postsRead.posts} loading={postsRead.loading} failed={postsRead.failed} onRetry={() => void postsRead.load()}
                cards={[...cards, ...archivedCards]} busy={remaking} onRemake={(d) => void remake(d)}
                onOpenCard={(id) => setPackId(id)} onLogResults={() => { document.getElementById("log-a-post")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
              />
            )}
          />
        </Suspense>
      )}
      {view === "queue" && (
        <Suspense fallback={<PageSkeleton />}>
          <ContentQueue embedded />
        </Suspense>
      )}

      {/* New idea: three picks from the idea bank, or write your own. Picking one opens its filming pack. */}
      <Sheet open={newIdeaOpen} onOpenChange={setNewIdeaOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-2xl sm:p-6" aria-describedby="new-idea-desc">
          <SheetHeader className="pr-10 text-left">
            <SheetTitle className="text-xl">New idea</SheetTitle>
            <SheetDescription id="new-idea-desc">The one you pick goes on the board in Selected, with its filming pack open.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <FilmNextPanel
              ideas={ideas} used={usedIdeas} dismissed={dismissals} dismissalsFailed={dismissalsFailed} busyKey={busyIdeaKey}
              onFilm={(i, e) => void pickIdea(i, e)} onSaveLater={(i) => void saveIdeaLater(i)}
              onDismiss={(i, r) => void dismissIdea(i, r)} onBringBack={(k) => void undoDismiss(k)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Publish kit: caption + clip to post by hand, then the live URL that proves it. */}
      <Dialog open={!!postTarget} onOpenChange={(o) => !o && setPostTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="pr-8 leading-snug">Post it: {postTarget?.title}</DialogTitle></DialogHeader>
          {postTarget && postStep && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <VideoStageMark step={postStep} />
                <TonePill tone={brandTone(postTarget.brand)}>{brandHandle(postTarget.brand)}</TonePill>
                {scheduleNote(postTarget)}
              </div>
              <Textarea readOnly rows={5} aria-label="Caption" value={postTarget.caption || "(no caption yet — edit the card to add one)"} className="text-base" />
              {postTarget.cta && <p className="text-sm text-muted-foreground">Call to action: <span className="text-foreground">{postTarget.cta}</span></p>}
              {postTarget.caption && !hasCta(postTarget.caption) && !hasCta(postTarget.cta ?? "") && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                  <span>No website link in this caption.</span>
                  <Button size="sm" variant="outline" className="h-10" onClick={async () => { const cap = `${postTarget.caption.trim()}\n\n${CTA}`; if (await patch(postTarget.id, { caption: cap })) setPostTarget({ ...postTarget, caption: cap }); }}>Add apex-financial.org/apply</Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-11" onClick={() => copyCaption(postTarget.caption)} disabled={!postTarget.caption}><Copy className="h-4 w-4" aria-hidden />Copy caption</Button>
                {postTarget.clip && (() => { const k = clips.find((x) => x.path === postTarget.clip); const d = k ? directUrl(k) : null; return d
                  ? <Button asChild variant="outline" className="h-11"><a href={d} download={k?.name}><Download className="h-4 w-4" aria-hidden />Download the clip</a></Button>
                  : <Button asChild variant="outline" className="h-11"><a href={dropboxUrl(postTarget.clip)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden />Open clip in Dropbox</a></Button>; })()}
                {stageOf(postTarget) === "ready" && <Button variant="ghost" className="h-11" disabled={locked} onClick={() => { const c = postTarget; setPostTarget(null); openSchedule(c); }}><CalendarClock className="h-4 w-4" aria-hidden />Plan a time instead</Button>}
              </div>
              <p className="text-[13px] text-muted-foreground">Copying and downloading do not change the stage. Post it on the platform yourself, then paste the live link below.</p>
              <div className="grid gap-1.5 border-t border-border pt-3">
                <Label htmlFor="lb-live-url">Live post link</Label>
                <Input id="lb-live-url" inputMode="url" autoComplete="off" value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} placeholder="https://www.youtube.com/shorts/…" className="h-11 text-base" />
                {publishUrl.trim() !== "" && (publishCheck.ok
                  ? <p className="text-[13px] text-muted-foreground">Looks like a {publishCheck.platform} post.{publishCheck.warning ? ` ${publishCheck.warning}` : ""}</p>
                  : <p className={cn("text-[13px]", TONE_CLASS.hot.text)}>{publishCheck.reason}</p>)}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setPostTarget(null)}>Not yet</Button>
            <Button ref={confirmRef} className="h-11" onClick={() => void confirmPublished()} disabled={locked || !publishCheck.ok || (postTarget ? busyId === postTarget.id : false) || (postTarget ? !["ready", "scheduled", "published_unconfirmed", "published"].includes(stageOf(postTarget)) : true)}>
              <Check className="h-4 w-4" aria-hidden />Confirm published
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan a time. No scheduler integration writes to this board, so it is always a labelled manual plan. */}
      <Dialog open={!!scheduleTarget} onOpenChange={(o) => !o && setScheduleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="pr-8 leading-snug">Plan a post time: {scheduleTarget?.title}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="lb-schedule-at">Post at (your local time)</Label>
            <Input id="lb-schedule-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-11 text-base" />
            <p className="text-[13px] text-muted-foreground">This is a <b className="text-foreground">manual plan</b>: nothing posts by itself. It moves to the top of the list when the time comes; post it, then paste the live link.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setScheduleTarget(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => void saveSchedule()} disabled={locked || (scheduleTarget ? busyId === scheduleTarget.id : false)}><CalendarClock className="h-4 w-4" aria-hidden />Save the plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor: only execution fields. Stage moves happen through the workflow actions, never from here. */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit the card" : "New idea"}</DialogTitle></DialogHeader>
          {editing && editingStep && editingNext && (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <VideoStageMark step={editingStep} />
              <span className="text-sm leading-5 text-foreground"><span className="text-muted-foreground">Next: </span>{editingNext.title}</span>
              {editing.approved_at && <span className="text-sm leading-5 text-muted-foreground">Approved {fmtDate(editing.approved_at)}</span>}
              {externalHref(editing.published_url) && <a href={externalHref(editing.published_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-sm leading-5 text-foreground underline underline-offset-4">Live post</a>}
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="lb-title">Title</Label><Input id="lb-title" value={draftStr("title")} onChange={(e) => setDraftField("title", e.target.value)} placeholder="What's the video?" className="text-base" /></div>
            <div className="grid gap-1.5"><Label htmlFor="lb-hook">Opening line</Label><Textarea id="lb-hook" rows={2} value={draftStr("hook")} onChange={(e) => setDraftField("hook", e.target.value)} placeholder="The first thing they hear, in the first 1.5 seconds" className="text-base" /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-script" className="flex items-center justify-between">Shot list and script <span className="flex gap-3">
                {!draftStr("record_script") && <button type="button" onClick={() => setDraftField("record_script", recordTemplate(draft))} className="text-[13px] font-semibold text-foreground underline underline-offset-4">Fill from template</button>}
                {draftStr("record_script") && <button type="button" onClick={() => copyText(draftStr("record_script"), "Shot list")} className="text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Copy</button>}
              </span></Label>
              <Textarea id="lb-script" rows={5} value={draftStr("record_script")} onChange={(e) => setDraftField("record_script", e.target.value)} placeholder="Camera, where, the opening line, the beats, the lesson" className="font-mono text-sm" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-clip" className="flex items-center justify-between">Footage
                {editing && <button type="button" onClick={() => { setAttachTarget(editing); setEditorOpen(false); setTab("library"); }} className="text-[13px] font-semibold text-foreground underline underline-offset-4">Pick from the Library</button>}
              </Label>
              <Input id="lb-clip" value={draftStr("clip")} onChange={(e) => setDraftField("clip", e.target.value)} placeholder="Reels/2026/09/clip.mp4 (Dropbox path)" className="text-base" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-edit" className="flex items-center justify-between">Edit instructions <span className="flex gap-3">
                {!draftStr("edit_prompt") && <button type="button" onClick={() => setDraftField("edit_prompt", editTemplate(draft))} className="text-[13px] font-semibold text-foreground underline underline-offset-4">Fill from template</button>}
                {draftStr("edit_prompt") && <button type="button" onClick={() => copyText(draftStr("edit_prompt"), "Edit instructions")} className="text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Copy</button>}
              </span></Label>
              <Textarea id="lb-edit" rows={4} value={draftStr("edit_prompt")} onChange={(e) => setDraftField("edit_prompt", e.target.value)} placeholder="How to cut it: format, length, captions, what to leave out" className="font-mono text-sm" />
              <p className="text-[13px] text-muted-foreground">{FORMAT_LINE}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-cap">Caption</Label>
              <Textarea id="lb-cap" rows={3} value={draftStr("caption")} onChange={(e) => setDraftField("caption", e.target.value)} placeholder="The caption you'll post with" className="text-base" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-cta" className="flex items-center justify-between">Call to action
                {!draftStr("cta") && <button type="button" onClick={() => setDraftField("cta", CTA)} className="text-[13px] font-semibold text-foreground underline underline-offset-4">Use the apply link</button>}
              </Label>
              <Input id="lb-cta" value={draftStr("cta")} disabled={!workflowReady} onChange={(e) => setDraftField("cta", e.target.value)} placeholder="What the viewer should do" className="text-base" />
            </div>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label htmlFor="lb-destination">Destination</Label>
                <Select value={draftStr("brand")} onValueChange={(v) => setDraftField("brand", v)}><SelectTrigger id="lb-destination" aria-label="Destination channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SH">Shorts → Repurpose</SelectItem><SelectItem value="YT">YouTube long-form</SelectItem>{(draftStr("brand") === "SFD" || draftStr("brand") === "IMS") && <SelectItem value={draftStr("brand")}>{brandHandle(draftStr("brand"))}</SelectItem>}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-job">Job</Label>
                <Select value={draftStr("job")} onValueChange={(v) => setDraftField("job", v)}><SelectTrigger id="lb-job" aria-label="Content job"><SelectValue /></SelectTrigger><SelectContent>{JOBS.map((j) => <SelectItem key={j.k} value={j.k}>{j.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-slot">Week slot</Label>
                <Select value={draftStr("day")} onValueChange={(v) => setDraftField("day", Number(v))}><SelectTrigger id="lb-slot" aria-label="Week slot"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Not planned</SelectItem>{[1, 2, 3, 4, 5, 6, 7].map((d) => <SelectItem key={d} value={String(d)}>{WEEKDAY[d]} · {DAY_THEMES[d].angle}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-owner">Owner</Label>
                <Input id="lb-owner" value={draftStr("owner")} disabled={!workflowReady} onChange={(e) => setDraftField("owner", e.target.value)} placeholder="Who does the next step" className="text-base" /></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-due">Due date</Label>
                <Input id="lb-due" type="date" value={draftStr("due_date").slice(0, 10)} disabled={!workflowReady} onChange={(e) => setDraftField("due_date", e.target.value)} className="text-base" /></div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <div className="flex flex-wrap gap-2">
                {editingBack && <Button type="button" variant="ghost" className="h-11" disabled={locked || busyId === editing.id} onClick={() => void sendBackFromEditor(editing)}><Undo2 className="h-4 w-4" aria-hidden />Send back to {SEND_BACK_WORDS[editingBack]}</Button>}
                <Button type="button" variant="ghost" className={cn("h-11", TONE_CLASS.hot.text)} onClick={() => void deleteFromEditor(editing)}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>
              </div>
            ) : <span aria-hidden className="hidden sm:block" />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="h-11" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={saveDraft} disabled={saving} className="h-11">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{editing ? "Save" : "Add idea"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FilmingPackSheet
        card={packCard}
        open={packCard !== null}
        onOpenChange={(o) => { if (!o) setPackId(null); }}
        onSave={savePackText}
        onOpenEditor={(id) => { const c = [...cards, ...archivedCards].find((x) => x.id === id); setPackId(null); if (c) openEdit(c); }}
      />
    </div>
  );
}
