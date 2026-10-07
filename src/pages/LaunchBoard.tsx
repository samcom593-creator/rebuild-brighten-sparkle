// Launch Board — the one content workspace (§11, 2026-10-06).
//
// v4: one workflow, Idea → Record → Edit → Review → Ready → Scheduled →
// Published (src/lib/contentWorkflow.ts + migration 20261006150000). Today
// answers four questions (record next / needs editing / ready to publish /
// actually published) above a ≤7 item prioritized queue. Copying a caption or
// downloading a clip changes nothing; Ready needs an admin approval; Scheduled
// is a "Manual plan" unless a scheduler job backs it; Published needs a live
// https post URL on a known platform (server-enforced). The old Content page
// (/dashboard/content, the content-ops approval queue + invite list) now lives
// here as the Queue tab and its URL redirects here.
//
// Earlier history:
//
// v1 (2026-09-07 morning) ported the standalone board. Sam: "make it easier
// on the eyes, easier to use, more functional — and pull content from my
// Dropbox (YouTube + TikToks)." v2 is built around four questions, one tab
// each: what do I post TODAY, where is everything (BOARD), what's the WEEK,
// and what have I already shot (LIBRARY — a metadata index of the Dropbox
// video archive, content_clips, ~4,000 clips, no bytes copied).
//
// Library → card is one click ("New card" mints a Recorded card with the clip
// attached; "Attach" drops the clip onto an existing idea). Post copies the
// caption and stamps the date — publishing stays in Sam's hands.
//
// v3 (2026-09-15, vidIQ channel audit): Instagram is retired — every card
// funnels to apex-financial.org/apply. Brands are now channels (YouTube
// long-form / Shorts auto-republished by Repurpose.io). Pillars follow the
// 80/20 rule: 80% insurance sales · money at 20 · recruiting, 20% fitness
// framed for closers; cars/AZ are b-roll only. The Week tab is a real
// Mon–Sun calendar with a slot per day and a live 80/20 mix meter.

import { useRef, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { externalHref } from "@/lib/externalHref";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ContentHome } from "@/components/content/AccountsAnalytics";
import {
  STAGE_LABEL, STAGE_ORDER, WORKFLOW, checkPublishUrl, fourQuestions, nextAction, nextStatus, phoenixDate, previousStatus,
  scheduleLabel, stageOf, todayQueue, type Stage, type WorkflowStatus,
} from "@/lib/contentWorkflow";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { DAY_THEMES, THEME_TONE, WEEKLY_TARGETS, phoenixDateKey, phoenixWeekday } from "@/lib/contentWeek";
import { canShareFiles, pullFile, saveMedia, shareFiles } from "@/lib/saveMedia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight, CalendarClock, Check, Copy, Crown, Download, ExternalLink, Film, Image as ImageIcon, Link2, Loader2, MessageSquareQuote, Paperclip, Pencil, Plus, Search, ShieldCheck, ThumbsDown, ThumbsUp, Trash2, Undo2,
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

// Stage styling with semantic tokens only. Published (confirmed) reads as done; unconfirmed reads as a warning.
const STAGES: Stage[] = [...WORKFLOW.slice(0, 6), "published_unconfirmed", "published"];
const STAGE_TONE: Record<Stage, string> = {
  idea: "border-border text-muted-foreground",
  record: "border-border text-foreground",
  edit: "border-border text-foreground",
  review: "border-primary/40 text-primary",
  ready: "border-primary/60 bg-primary/10 text-primary",
  scheduled: "border-primary/40 text-primary",
  published_unconfirmed: "border-destructive/40 text-destructive",
  published: "border-border bg-muted text-muted-foreground",
};
const STAGE_BAR: Record<Stage, string> = {
  idea: "border-l-border", record: "border-l-muted-foreground", edit: "border-l-muted-foreground", review: "border-l-primary/60",
  ready: "border-l-primary", scheduled: "border-l-primary", published_unconfirmed: "border-l-destructive", published: "border-l-border",
};
function StageChip({ stage }: { stage: Stage }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}
const JOBS: { k: Job; label: string; desc: string; accent: string; border: string }[] = [
  { k: "REACH", label: "Reach", desc: "Get seen — who you are, wider than the offer.", accent: "text-amber-400", border: "border-t-amber-400/70" },
  { k: "AUTHORITY", label: "Authority", desc: "Give value — a lesson people keep.", accent: "text-sky-400", border: "border-t-sky-400/70" },
  { k: "PROOF", label: "Proof", desc: "Show it's real — the system, the results.", accent: "text-violet-400", border: "border-t-violet-400/70" },
  { k: "CONVERT", label: "Convert", desc: "One clear ask — apply.", accent: "text-emerald-400", border: "border-t-emerald-400/70" },
];
const TABS: { k: Tab; label: string }[] = [
  { k: "today", label: "Today" }, { k: "board", label: "Board" }, { k: "week", label: "Week" }, { k: "library", label: "Library" }, { k: "analytics", label: "Analytics" },
];
// Queue is hidden from the bar while its Mac mini feed is offline (it showed 14 empty "Nothing slated" boxes);
// ?tab=queue and /dashboard/content still open it.
const TAB_KEYS = new Set<Tab>([...TABS.map((t) => t.k), "queue"]);

// The 80/20 pillars (2026-09-15, from the vidIQ channel audit). CORE = 80% of posts: insurance sales, money at 20,
// recruiting/team proof. FLEX = 20%: fitness framed for closers. Cars / Arizona are b-roll, never the subject.
// A clip's pillar is read off its existing AI tags/title/description, so nothing needs re-tagging; a tap on a chip pins it by writing the pillar word into tags.
type PillarKey = "sales" | "money" | "recruiting" | "fitness" | "lifestyle";
const PILLARS: { k: PillarKey; label: string; core: boolean; re: RegExp }[] = [
  { k: "sales", label: "Insurance sales", core: true, re: /\b(sales?|insurance|closing|close|calls?|dialer|policy|policies|pitch|objection|license|licensed|carrier|ethos|leads?)\b/i },
  { k: "money", label: "Money at 20", core: true, re: /\b(money|income|deposit|paid|pay|\$[\d,]+k?|production|revenue|rich|millionaire|cash|commission)\b/i },
  { k: "recruiting", label: "Recruiting / team", core: true, re: /\b(recruit(?:ing)?|apply|application|hiring|hired|join|team|agents?|agency|onboard(?:ing)?|cta)\b/i },
  { k: "fitness", label: "Fitness for closers", core: false, re: /\b(gym|workout|lift(?:ing)?|physique|training|fitness|bench|squat|deadlift|cardio|abs|muscle|shirtless|run(?:ning)?)\b/i },
  { k: "lifestyle", label: "Lifestyle b-roll", core: false, re: /\b(cars?|corvette|vette|c8|lambo|lamborghini|porsche|exotic|rental|driving|garage|arizona|tempe|rooftop|pool|sunset)\b/i },
];
const clipHay = (k: Clip) => `${k.title ?? ""} ${k.description ?? ""} ${(k.tags ?? []).join(" ")} ${k.name}`;
const pillarsOf = (k: Clip): PillarKey[] => PILLARS.filter((p) => p.re.test(clipHay(k))).map((p) => p.k);
const cardPillars = (c: Card): PillarKey[] => { const hay = `${c.title} ${c.hook} ${c.caption}`; return PILLARS.filter((p) => p.re.test(hay)).map((p) => p.k); };
const isCoreCard = (c: Card) => { const ps = cardPillars(c); return ps.length === 0 ? null : ps.some((k) => PILLARS.find((p) => p.k === k)?.core); };

// Channels (Instagram retired 2026-09-15). YT = YouTube long-form, SH = Shorts (Repurpose.io republishes to TikTok).
// Legacy SFD / IMS cards were the two Instagram handles; they render as retired so old rows still make sense.
const CTA = "Want to sell life insurance with my team? Apply: https://apex-financial.org/apply";
const hasCta = (s: string) => /apex-financial\.org/i.test(s);
const brandHandle = (b: string) => (b === "SH" ? "YouTube Shorts → Repurpose" : b === "YT" ? "YouTube" : b === "IMS" ? "@imakesystems · retired" : b === "SFD" ? "@sellfordaddy · retired" : b);
const brandClass = (b: string) => (b === "SH" ? "text-sky-300 border-sky-400/30 bg-sky-400/10" : b === "YT" ? "text-red-300 border-red-400/30 bg-red-400/10" : "text-zinc-400 border-zinc-500/30 bg-zinc-500/10");
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

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className ?? "border-border text-muted-foreground"}`}>{children}</span>;
}
function Head({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const emptyDraft = { title: "", brand: "SH", job: "REACH", content_type: "short", hook: "", caption: "", clip: "", day: 0, status: "idea", record_script: "", edit_prompt: "", cta: "", owner: "", due_date: "" };
// Fields the editor writes. Status is never written from the editor: stage moves go through the workflow actions.
const WORKFLOW_FIELDS = ["cta", "owner", "due_date"] as const;

// MP-233 video kit (2026-09-15): two copy-paste blocks per card. "Fill from template" writes these from the
// title + hook + channel so a brand-new idea is recordable and hand-off-able in one tap; the seeded 80/20
// cards carry hand-written versions. Delivery format lives in master-prompts/233-video-format-and-prompt-kit.md.
const isLongForm = (d: Record<string, unknown>) => String(d.brand) === "YT" || String(d.content_type) === "long";
const recordTemplate = (d: Record<string, unknown>) => {
  const title = String(d.title ?? "").trim() || "<title>"; const hook = String(d.hook ?? "").split(/[.!?]\s/)[0].trim() || "<the hook line>";
  return isLongForm(d)
    ? `RECORD: ${title}\nCamera: DJI or phone HORIZONTAL   Where: desk / car / gym   Length to shoot: 20-30 min of talking\n1. HOOK to camera, one sentence, say it twice: "${hook}"\n2. CHAPTER 1 — open on camera mid-energy, then show the thing (whiteboard, not a screen)\n3. CHAPTER 2 — the numbers, said out loud (every $ gets a card in the edit)\n4. CHAPTER 3 — a second voice: an agent, a friend, a real call (client names cut)\n5. CHAPTER 4 — the mistake most people make\n6. LESSON to camera, 30-45 s uncut, the last thing you say\nCTA to camera: "If you want to sell life insurance with my team, apply at apex-financial.org/apply."\nDo NOT: read a script, film a phone screen, name a client, mention anyone you have beef with.`
    : `RECORD: ${title}\nCamera: phone VERTICAL   Where: car / desk / gym   Length to shoot: 3 takes of 30 s\n1. HOOK in the first 1.5 s: "${hook}"\n2. ONE idea, ONE payoff — say the number or the line, then stop\n3. Last line: "Apply at apex-financial.org/apply" (the edit adds the text card)\nDo NOT: read a script, film a phone screen, name a client, mention anyone you have beef with.`;
};
const editTemplate = (d: Record<string, unknown>) => {
  const title = String(d.title ?? "").trim() || "<title>"; const hook = String(d.hook ?? "").split(/[.!?]\s/)[0].trim() || "<the hook line>";
  const fmt = isLongForm(d) ? "long-form 16:9, 8-12 min, 1080p30 render then 4K upscale, 5-7 chapters, NumberCards on every stated figure, lesson → CTA → end card over the last shot" : "Short 9:16 1080x1920, 20-45 s, burned word captions ≤ 6 words per page, apply text card over the last 3 s";
  return `Cut "${title}" per MP-234 (~/business-ops/master-prompts/234-apex-video-editor.md).\nFormat: ${fmt}. Sources: the clip(s) attached to this Launch Board card${d.clip ? ` (${String(d.clip)})` : ""}, plus any clip from the same date with his voice on it.\nHook: "${hook}".\nExclude: slurs, sexual lines, beef, client PII, phone screens. music: [].\nPackage: title "${title}", description = hook + the channel description block + chapters, tags TAGS_CORE. Deliver 4K + 1080p to ~/Desktop/YouTube-Ready/, attach the 1080p to this card, write the YouTube chapters, ntfy me when done.`;
};
const FORMAT_LINE = "Long-form: 3840×2160 16:9 30 fps, −14 LUFS, no music, chapters in the description, end card over the last shot. Shorts: 1080×1920 9:16 ≤ 45 s, burned captions, apply card last 3 s.";

// ── Week tab (2026-10-06): 7 themed days driven by src/lib/contentWeek.ts. Drag a card between days (or tap the
// Move select on a phone). Long-form planned vs 5/week, Shorts posted vs 30–60/week.
type MixInfo = { pct: number | null; core: number; flex: number; blank: number; noCta: number };
const cardIsLong = (c: Card) => c.brand === "YT" || c.content_type === "long";
const DAY_OPTIONS = [{ v: 0, label: "Unplanned" }, ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ v: d, label: DAY_THEMES[d].short }))];

function WeekCard({ c, onOpen, onMove }: { c: Card; onOpen: (c: Card) => void; onMove: (c: Card, day: number) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  const stage = stageOf(c);
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`touch-manipulation rounded-xl border border-l-[3px] border-border bg-background/60 p-2.5 ${STAGE_BAR[stage]} ${isDragging ? "opacity-40" : ""}`}>
      <button type="button" onClick={() => onOpen(c)} className="line-clamp-2 w-full text-left text-sm font-semibold leading-snug text-foreground hover:text-primary">{c.title.replace(/^Story · /, "")}</button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StageChip stage={stage} />
        <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">{cardIsLong(c) ? "Long" : "Short"}</span>
      </div>
      <select value={c.day} aria-label={`Move ${c.title}`} onChange={(e) => onMove(c, Number(e.target.value))}
        className="mt-2 h-8 w-full rounded-md border border-border bg-card px-1.5 text-[13px] text-muted-foreground">
        {DAY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  );
}

function DropZone({ id, className, children }: { id: string; className: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className} ${isOver ? "ring-2 ring-primary/60" : ""}`}>{children}</div>;
}

function WeekTab({ cards, mix, onOpen, onMove, onAdd }: { cards: Card[]; mix: MixInfo; onOpen: (c: Card) => void; onMove: (c: Card, day: number) => void; onAdd: (day: number) => void }) {
  const todayDow = phoenixWeekday();
  const [shortsByDay, setShortsByDay] = useState<Record<number, number> | null>(null);
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  const [showMix, setShowMix] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const dayKeys = useMemo(() => {
    const [y, m, d] = phoenixDateKey().split("-").map(Number);
    const base = Date.UTC(y, m - 1, d) - (todayDow - 1) * 86400_000;
    return Array.from({ length: 7 }, (_, i) => new Date(base + i * 86400_000).toISOString().slice(0, 10));
  }, [todayDow]);
  useEffect(() => {
    let off = false;
    void (async () => {
      const { data, error } = await supabase.from("content_posts").select("posted_at, format, platform").gte("posted_at", `${dayKeys[0]}T00:00:00-07:00`);
      if (off || error) { if (!off) setShortsByDay({}); return; }
      // Repurpose sends one Short to every platform, so a day's Shorts = its busiest platform, not the sum.
      const per: Record<number, Record<string, number>> = {};
      for (const r of (data ?? []) as { posted_at: string | null; format: string | null; platform: string | null }[]) {
        if (r.format !== "short" || !r.posted_at) continue;
        const idx = dayKeys.indexOf(phoenixDateKey(new Date(r.posted_at)));
        if (idx < 0) continue;
        const day = (per[idx + 1] ??= {});
        const pl = r.platform ?? "other";
        day[pl] = (day[pl] ?? 0) + 1;
      }
      const m: Record<number, number> = {};
      for (const [k, v] of Object.entries(per)) m[Number(k)] = Math.max(...Object.values(v));
      setShortsByDay(m);
    })();
    return () => { off = true; };
  }, [dayKeys]);
  const shortsTotal = Object.values(shortsByDay ?? {}).reduce((a, b) => a + b, 0);
  const longPlanned = cards.filter((c) => c.day > 0 && cardIsLong(c)).length;
  const ideas = useMemo(() => cards.filter((c) => !c.day).sort((a, b) => b.sort - a.sort), [cards]);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const day = Number(String(e.over.id).replace("day-", ""));
    const c = cards.find((x) => x.id === String(e.active.id));
    if (c && Number.isFinite(day) && c.day !== day) onMove(c, day);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="text-base font-extrabold text-foreground">This week</h2>
          <span className="text-sm text-muted-foreground">Long-form planned <b className="tabular-nums text-foreground">{longPlanned}/{WEEKLY_TARGETS.long}</b></span>
          <span className="text-sm text-muted-foreground">Shorts posted <b className="tabular-nums text-foreground">{shortsByDay ? shortsTotal : "…"}</b> <span className="text-[13px]">(goal {WEEKLY_TARGETS.shortsMin}–{WEEKLY_TARGETS.shortsMax})</span></span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
            const t = DAY_THEMES[d];
            const tone = THEME_TONE[t.theme];
            const items = cards.filter((c) => c.day === d);
            const posted = shortsByDay?.[d] ?? 0;
            const isToday = d === todayDow;
            return (
              <div key={d} className={`flex flex-col gap-2.5 rounded-2xl border bg-card p-3 ${isToday ? `${tone.ring} ring-1 ring-primary/40` : "border-border"}`}>
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-extrabold text-foreground">{t.name}</span>
                    {isToday && <span className="text-[12px] font-bold uppercase tracking-wide text-primary">Today</span>}
                  </div>
                  <span className={`mt-1.5 inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${tone.chip}`}>{t.themeLabel} · {t.angle}</span>
                </div>
                <DropZone id={`day-${d}`} className="flex min-h-[96px] flex-1 flex-col gap-2 rounded-xl border border-dashed border-border p-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{t.longTarget > 0 ? "Long-form" : d === 7 ? "Plan & batch" : "Long-form (bonus)"}</div>
                  {items.map((c) => <WeekCard key={c.id} c={c} onOpen={onOpen} onMove={onMove} />)}
                  {items.length === 0 && <div className="py-2 text-center text-[13px] text-muted-foreground">Drop a video here</div>}
                  <button type="button" onClick={() => onAdd(d)} className="mt-auto rounded-lg border border-dashed border-border px-2 py-1.5 text-[13px] text-muted-foreground hover:border-primary/50 hover:text-primary">+ Add</button>
                </DropZone>
                {t.shortsTarget > 0 && (
                  <div>
                    <div className="flex justify-between text-[13px] text-muted-foreground"><span>Shorts</span><span className="tabular-nums">{posted}/{t.shortsTarget}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.round((posted / t.shortsTarget) * 100))}%` }} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DropZone id="day-0" className="rounded-2xl border border-dashed border-border bg-card/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Ideas (not planned) <span className="font-normal text-muted-foreground">{ideas.length}</span></h3>
            <span className="text-[13px] text-muted-foreground">Drag onto a day, or use Move</span>
          </div>
          {ideas.length === 0 ? <div className="py-2 text-sm text-muted-foreground">Everything is planned.</div> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {(showAllIdeas ? ideas : ideas.slice(0, 8)).map((c) => <WeekCard key={c.id} c={c} onOpen={onOpen} onMove={onMove} />)}
            </div>
          )}
          {ideas.length > 8 && <button type="button" onClick={() => setShowAllIdeas(!showAllIdeas)} className="mt-3 rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-foreground hover:border-primary/60">{showAllIdeas ? "Show fewer" : `Show all (${ideas.length})`}</button>}
        </DropZone>
        <div>
          <button type="button" onClick={() => setShowMix(!showMix)} aria-expanded={showMix} className="rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-foreground hover:border-primary/60">{showMix ? "Hide details" : "Show details"}</button>
          {showMix && (
            <div className="mt-3 space-y-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">80/20 mix</span>
                <span className={`text-lg font-extrabold tabular-nums ${mix.pct === null ? "text-muted-foreground" : mix.pct >= 75 ? "text-emerald-400" : "text-amber-400"}`}>{mix.pct === null ? "—" : `${mix.pct}%`}</span>
                <span className="text-xs text-muted-foreground">core · target 80%</span>
                <div className="h-2 w-40 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-400" style={{ width: `${mix.pct ?? 0}%` }} /></div>
                <span className="text-xs text-muted-foreground">{mix.core} insurance / money / recruiting · {mix.flex} fitness / lifestyle · {mix.blank} untagged</span>
                {mix.noCta > 0 && <span className="text-xs font-semibold text-amber-400">{mix.noCta} caption{mix.noCta === 1 ? "" : "s"} missing the apex-financial.org/apply CTA</span>}
              </div>
              <p className="text-xs text-muted-foreground"><span className="font-bold uppercase tracking-[0.12em] text-foreground">Delivery format</span> · {FORMAT_LINE} Every card carries a script to record and an edit prompt: open the card, copy, paste.</p>
            </div>
          )}
        </div>
      </div>
    </DndContext>
  );
}

export default function LaunchBoard() {
  usePageTitle("Launch Board");
  const askConfirm = useConfirm();
  const { isAdmin } = useAuth();
  const [tab, setTabState] = useState<Tab>("today");
  const [cards, setCards] = useState<Card[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pillar, setPillar] = useState<"all" | PillarKey>("all");
  const [folder, setFolder] = useState<"all" | "YouTube" | "Reels" | "Screenshots">("all");
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
  const setTab = (t: Tab) => {
    setTabState(t);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === "today") next.delete("tab"); else next.set("tab", t);
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
  const [length, setLength] = useState<"all" | "short" | "mid" | "long">("all");
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
  const [boardDetails, setBoardDetails] = useState(false);   // Board: destination / source media / owner hide behind "Show details"
  const [todayAll, setTodayAll] = useState(false);
  const [todayDetails, setTodayDetails] = useState(false);
  const [stageFilter, setStageFilter] = useState<"open" | "all" | Stage>("open");
  // null = not probed yet; false = the §11 migration is not on this database, so new stages cannot be written.
  const [workflowReady, setWorkflowReady] = useState<boolean | null>(null);
  const [attachTarget, setAttachTarget] = useState<Card | null>(null);   // card waiting for a clip from the Library

  const load = useCallback(async () => {
    try {
      const c = await supabase.from("content_cards").select("*").order("day", { ascending: true }).order("sort", { ascending: true });
      if (c.error) throw c.error;
      setCards((c.data as Card[]) ?? []);
      // Probe the §11 columns once. A missing column (42703) means the migration has not reached this database:
      // the board still reads, and says plainly that stage moves are unavailable rather than failing on every tap.
      const probe = await supabase.from("content_cards").select("published_url" as never).limit(1);
      setWorkflowReady(!probe.error);
      // The whole library, paged: PostgREST returns at most 1,000 rows per request.
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
      toast.error(`Couldn't load the board: ${(e instanceof Error ? e.message : "unknown error").slice(0, 120)}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);


  const patch = useCallback(async (id: string, changes: Partial<Card>) => {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    const { data, error } = await supabase.from("content_cards").update(changes as never).eq("id", id).select("*").maybeSingle();
    if (error) { setCards(prev); toast.error(`Save failed: ${error.message.slice(0, 160)}`); return false; }
    if (!data) { setCards(prev); toast.error("Save failed: the card was not updated (no access, or it was deleted). Reload the board."); return false; }
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
      if (ok) toast.success(msg ?? `Moved to ${STAGE_LABEL[to]}`);
      return ok;
    } finally { setBusyId(null); }
  };
  const forward = (c: Card) => {
    const stage = stageOf(c);
    const to = nextStatus(stage);
    if (!to) return;
    if (stage === "review") return void approve(c);
    if (to === "scheduled") { openSchedule(c); return; }
    if (to === "published") { openPublish(c); return; }
    void move(c, to);
  };
  const sendBack = (c: Card) => {
    const to = previousStatus(stageOf(c));
    if (!to) return;
    // Leaving Ready/Scheduled/Published for an earlier stage drops the approval and any schedule/evidence on the row.
    const extra: Partial<Card> = to === "edit" || to === "record" || to === "idea"
      ? { approved_at: null, scheduled_for: null, schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null }
      : to === "ready" ? { scheduled_for: null, schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null } : {};
    void move(c, to, extra, `Sent back to ${STAGE_LABEL[to]}`);
  };
  // Approval is admin-only and enforced by the database trigger; the button is hidden for everyone else.
  const approve = (c: Card) => {
    if (!isAdmin) { toast.error("Only an admin can approve content for publishing."); return; }
    if (!(c.caption ?? "").trim()) { toast.error("Write the caption before approving."); return; }
    void move(c, "ready", { approved_at: new Date().toISOString() }, "Approved — Ready to publish");
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
    if (await move(scheduleTarget, "scheduled", { scheduled_for: when.toISOString(), schedule_kind: "manual", schedule_job_ref: null }, "Planned — labelled Manual plan (nothing will post automatically)")) setScheduleTarget(null);
  };
  const openPublish = (c: Card) => { setPostTarget(c); setPublishUrl(c.published_url ?? ""); };
  const publishCheck = useMemo(() => checkPublishUrl(publishUrl, postTarget?.brand), [publishUrl, postTarget]);
  const confirmPublished = async () => {
    if (!postTarget) return;
    if (!publishCheck.ok) { toast.error(publishCheck.reason); return; }
    if (await move(postTarget, "published", { published_url: publishUrl.trim(), publish_evidence: "manual_confirmation", posted_at: postTarget.posted_at ?? new Date().toISOString() }, `Published — confirmed on ${publishCheck.platform}`)) setPostTarget(null);
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
    if (!ok) return;
    const prev = cards; setCards((cs) => cs.filter((x) => x.id !== c.id));
    const { error } = await supabase.from("content_cards").delete().eq("id", c.id);
    if (error) { setCards(prev); toast.error(`Delete failed: ${error.message.slice(0, 120)}`); } else toast.success("Deleted");
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
    setAttachTarget(null); toast.success(`Attached to “${card.title}”`); setTab("board");
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

  const openNew = () => { setEditing(null); setDraft({ ...emptyDraft }); setEditorOpen(true); };
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

  // The four questions + Today. content_cards is small (29 rows on 2026-10-06) and loaded whole; if it ever
  // passes 1,000 rows the load above must page the way content_clips does.
  const isOpen = (c: Card) => { const st = stageOf(c); return st !== "published" && st !== "published_unconfirmed"; };
  const q4 = useMemo(() => fourQuestions(cards), [cards]);
  const today = useMemo(() => todayQueue(cards, new Date(), 7), [cards]);
  const stageCounts = useMemo(() => {
    const m = Object.fromEntries(STAGES.map((st) => [st, 0])) as Record<Stage, number>;
    for (const c of cards) m[stageOf(c)] += 1;
    return m;
  }, [cards]);
  const boardRows = useMemo(() => {
    const rows = cards.filter((c) => (stageFilter === "all" ? true : stageFilter === "open" ? isOpen(c) : stageOf(c) === stageFilter));
    return rows.sort((a, b) => STAGE_ORDER[stageOf(b)] - STAGE_ORDER[stageOf(a)] || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || (a.day || 9) - (b.day || 9) || a.sort - b.sort);
  }, [cards, stageFilter]);
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
  const bangerColor = (s?: number | null) => (s == null ? "bg-zinc-600" : s >= 70 ? "bg-emerald-400" : s >= 45 ? "bg-gold" : "bg-zinc-500");
  const fmtDur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
  // 80/20 mix over every open card (posted excluded): core pillars vs fitness/lifestyle. Untagged cards don't vote.
  const mix = useMemo(() => {
    const open = cards.filter(isOpen);
    let core = 0, flex = 0, blank = 0;
    for (const c of open) { const v = isCoreCard(c); if (v === null) blank++; else if (v) core++; else flex++; }
    const voted = core + flex;
    return { core, flex, blank, pct: voted ? Math.round((core / voted) * 100) : null, noCta: open.filter((c) => c.caption && !hasCta(c.caption) && !hasCta(c.cta ?? "")).length };
  }, [cards]);

  if (loading) return <PageSkeleton />;

  const todayStr = phoenixDate(new Date());
  const fmtDue = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
  const dueTone = (d?: string | null) => (!d ? "text-muted-foreground" : d.slice(0, 10) < todayStr ? "font-semibold text-destructive" : d.slice(0, 10) === todayStr ? "font-semibold text-foreground" : "text-muted-foreground");
  const locked = workflowReady === false;

  const clipLine = (c: Card) => c.clip ? (
    <a href={(() => { const k = clips.find((x) => x.path === c.clip); return (k && directUrl(k)) || dropboxUrl(c.clip); })()} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1.5 text-[13px] text-primary hover:underline" title={c.clip}>
      <Film className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{c.clip.split("/").pop()}</span>
    </a>
  ) : (
    <button onClick={() => { setAttachTarget(c); setTab("library"); }} className="flex items-center gap-1.5 text-left text-[13px] text-muted-foreground hover:text-primary">
      <Paperclip className="h-3 w-3" aria-hidden /> Attach footage
    </button>
  );

  // One obvious primary action per card, derived from its stage. Nothing here publishes anything.
  const primaryAction = (c: Card) => {
    const stage = stageOf(c);
    const busy = busyId === c.id;
    const base = "h-7 px-2.5 text-[12.5px] font-semibold";
    if (stage === "published") {
      const liveHref = externalHref(c.published_url);
      return liveHref ? <Button asChild size="sm" variant="outline" className={base}><a href={liveHref} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-3 w-3" aria-hidden />View post</a></Button> : null;
    }
    if (stage === "review" && !isAdmin) return <span className="text-[12.5px] text-muted-foreground">Awaiting approval</span>;
    const label: Record<Stage, string> = {
      idea: "Plan recording", record: "Footage in", edit: "Send to review", review: "Approve", ready: "Publish kit",
      scheduled: "Confirm live", published_unconfirmed: "Add live URL", published: "",
    };
    const icon = stage === "review" ? <ShieldCheck className="mr-1 h-3 w-3" aria-hidden /> : stage === "ready" || stage === "scheduled" || stage === "published_unconfirmed" ? <Link2 className="mr-1 h-3 w-3" aria-hidden /> : <ArrowRight className="mr-1 h-3 w-3" aria-hidden />;
    const opensDialog = stage === "ready" || stage === "scheduled" || stage === "published_unconfirmed";
    return (
      <Button size="sm" disabled={busy || (locked && !opensDialog)} onClick={() => (opensDialog ? openPublish(c) : forward(c))} className={`${base} bg-primary text-primary-foreground hover:bg-primary/90`}>
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : icon}{label[stage]}
      </Button>
    );
  };
  const secondaryActions = (c: Card) => {
    const stage = stageOf(c);
    return (
      <>
        {stage === "ready" && <Button size="sm" variant="outline" disabled={locked || busyId === c.id} onClick={() => openSchedule(c)} className="h-7 px-2 text-[12.5px]"><CalendarClock className="mr-1 h-3 w-3" aria-hidden />Plan time</Button>}
        {previousStatus(stage) && <Button size="sm" variant="ghost" disabled={locked || busyId === c.id} onClick={() => sendBack(c)} className="h-7 px-2 text-[12.5px] text-muted-foreground" aria-label={`Send ${c.title} back to ${STAGE_LABEL[previousStatus(stage) as Stage]}`}><Undo2 className="h-3.5 w-3.5" aria-hidden /></Button>}
        <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="h-7 px-2 text-muted-foreground" aria-label={`Edit ${c.title}`}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
        <Button size="sm" variant="ghost" onClick={() => remove(c)} className="h-7 px-2 text-muted-foreground hover:text-destructive" aria-label={`Delete ${c.title}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
      </>
    );
  };
  const scheduleNote = (c: Card) => {
    const s = scheduleLabel(c);
    if (!s || !c.scheduled_for) return null;
    return <span className="text-[12px] text-muted-foreground">{s.label} · {new Date(c.scheduled_for).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>;
  };

  const questions: { key: string; q: string; items: Card[]; count: number; note?: string; noteTone?: string; go: "open" | Stage }[] = [
    { key: "record", q: "What should I record next?", items: q4.recordNext, count: q4.recordNext.length, go: q4.recordNext.some((c) => stageOf(c) === "record") ? "record" : "idea" },
    { key: "edit", q: "What needs editing?", items: q4.needsEditing, count: q4.needsEditing.length, note: q4.awaitingApproval.length ? `${q4.awaitingApproval.length} awaiting approval` : undefined, go: "edit" },
    { key: "ready", q: "What is ready to publish?", items: q4.readyToPublish, count: q4.readyToPublish.length, go: "ready" },
    { key: "published", q: "What has actually been published?", items: q4.published, count: q4.published.length, note: q4.unconfirmed.length ? `${q4.unconfirmed.length} marked posted with no live URL` : "only cards with a live post URL count", noteTone: q4.unconfirmed.length ? "text-destructive" : undefined, go: "published" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Crown className="h-7 w-7 text-primary" aria-hidden />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Launch Board</h1>
            <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">Idea → Record → Edit → Review → Ready → Scheduled → Published. Publishing stays approval-gated and in your hands.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { n: cards.filter(isOpen).length, l: "In progress" },
            { n: q4.readyToPublish.length, l: "Ready" },
            { n: q4.published.length, l: "Published" },
            { n: clips.length.toLocaleString(), l: "Clips indexed" },
          ].map((s) => (
            <div key={s.l} className="min-w-[76px] rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-lg font-extrabold tabular-nums text-foreground">{s.n}</div>
              <div className="mt-0.5 text-[11.5px] uppercase tracking-[0.09em] text-muted-foreground">{s.l}</div>
            </div>
          ))}
          <button onClick={() => { chooseProof("testimonials"); setTab("library"); }} className="min-w-[76px] rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10" title="Every testimonial — calls, videos, screenshots, texts — one tap from download">
            <div className="text-lg font-extrabold tabular-nums text-primary">{testimonialClips.length.toLocaleString()}</div>
            <div className="mt-0.5 text-[11.5px] uppercase tracking-[0.09em] text-primary">Testimonials</div>
          </button>
        </div>
      </header>

      <nav aria-label="Board sections" className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-border bg-background px-4 py-2 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} aria-current={tab === t.k ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === t.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
        <span className="ml-auto self-center whitespace-nowrap text-xs text-muted-foreground">{attachTarget ? <>Attaching to <b className="text-foreground">{attachTarget.title}</b> · <button className="underline" onClick={() => setAttachTarget(null)}>cancel</button></> : null}</span>
        <Button size="sm" onClick={openNew} className="ml-2 h-8 bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="mr-1 h-3.5 w-3.5" aria-hidden />New idea</Button>
      </nav>

      {locked && (
        <div role="status" className="mb-5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          The content workflow migration (20261006150000) is not on this database yet. The board, library and downloads work; stage moves, approvals, schedules and publish confirmations are disabled until it is applied.
        </div>
      )}

      {tab === "today" && (
        <div className="space-y-8">
          <ContentHome onOpenAnalytics={() => setTab("analytics")} />
          <section>
            <Head title="Your work today" hint={today.length ? `${today.length} to work, most urgent first` : "nothing urgent"} />
            {today.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">Nothing is due, ready or waiting on approval. Plan a recording from an idea, or add one.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="w-8 px-3 py-2">#</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Next action</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Do it</th></tr>
                  </thead>
                  <tbody>
                    {(todayAll ? today : today.slice(0, 5)).map((t, i) => (
                      <tr key={t.card.id} className="border-t border-border align-top">
                        <td className="px-3 py-2.5 font-bold tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => openEdit(t.card)} className="text-left font-semibold text-foreground hover:text-primary">{t.card.title}</button>
                          <div className="text-[12.5px] text-muted-foreground">{t.reason}{t.card.owner ? ` · ${t.card.owner}` : ""}</div>
                        </td>
                        <td className="px-3 py-2.5"><StageChip stage={t.stage} /></td>
                        <td className="px-3 py-2.5 text-[13.5px] text-foreground">{nextAction(t.card)}</td>
                        <td className={`px-3 py-2.5 text-[13px] ${dueTone(t.card.due_date)}`}>{fmtDue(t.card.due_date) || "—"}</td>
                        <td className="px-3 py-2.5 text-right">{primaryAction(t.card)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {today.length > 5 && <button type="button" onClick={() => setTodayAll(!todayAll)} className="mt-3 rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-foreground hover:border-primary/60">{todayAll ? "Show fewer" : `Show all (${today.length})`}</button>}
          </section>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <MessageSquareQuote className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 truncate text-sm" title={health && health.waiting > 0 ? `${health.waiting.toLocaleString()} clips still being judged` : undefined}>
              <b className="text-foreground">{testimonialClips.length.toLocaleString()} testimonials</b>
              <span className="text-muted-foreground"> · {testimonialClips.filter((k) => k.media !== "image").length} calls &amp; videos · {testimonialClips.filter((k) => k.media === "image").length} screenshots</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => { chooseProof("testimonials"); setTab("library"); }} className="h-8 shrink-0"><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />Open pack</Button>
          </div>

          <div>
            <button type="button" onClick={() => setTodayDetails(!todayDetails)} aria-expanded={todayDetails} className="rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-foreground hover:border-primary/60">{todayDetails ? "Hide details" : "Show details"}</button>
            {todayDetails && (
          <section aria-label="Four questions" className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {questions.map((qq) => (
              <div key={qq.key} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <div className="text-[13px] font-semibold text-muted-foreground">{qq.q}</div>
                <button onClick={() => { setStageFilter(qq.go); setTab("board"); }} className="self-start text-2xl font-extrabold tabular-nums text-foreground hover:text-primary" aria-label={`${qq.q} ${qq.count} — open on the board`}>{qq.count}</button>
                {qq.note && <div className={`text-[12.5px] ${qq.noteTone ?? "text-muted-foreground"}`}>{qq.note}</div>}
                <ul className="mt-auto space-y-1">
                  {qq.items.slice(0, 3).map((c) => (
                    <li key={c.id}><button onClick={() => openEdit(c)} className="w-full line-clamp-2 text-left text-[13.5px] text-foreground hover:text-primary" title={c.title}>{c.title}</button></li>
                  ))}
                  {qq.items.length === 0 && <li className="text-[13px] text-muted-foreground">None</li>}
                </ul>
              </div>
            ))}
          </section>

            )}
          </div>
        </div>
      )}

      {tab === "board" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by stage">
            {([{ k: "open", label: "In progress", n: cards.filter(isOpen).length }, ...STAGES.map((st) => ({ k: st, label: STAGE_LABEL[st], n: stageCounts[st] })), { k: "all", label: "All", n: cards.length }] as { k: "open" | "all" | Stage; label: string; n: number }[])
              .filter((f) => f.k !== "published_unconfirmed" || f.n > 0)
              .map((f) => (
                <button key={f.k} onClick={() => setStageFilter(f.k)} aria-pressed={stageFilter === f.k} className={`rounded-full border px-3 py-1 text-xs font-semibold ${stageFilter === f.k ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {f.label} <span className="opacity-60 tabular-nums">{f.n}</span>
                </button>
              ))}
          </div>
          <div className="flex justify-end"><button type="button" onClick={() => setBoardDetails(!boardDetails)} aria-pressed={boardDetails} className="rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-foreground hover:border-primary/60">{boardDetails ? "Hide details" : "Show details"}</button></div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className={`w-full text-sm ${boardDetails ? "min-w-[880px]" : "min-w-[560px]"}`}>
              <thead className="bg-muted/50 text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Item</th><th className="px-3 py-2">Stage</th>{boardDetails && <><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Source media</th><th className="px-3 py-2">Owner</th></>}<th className="px-3 py-2">Due</th><th className="px-3 py-2">Next action</th><th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {boardRows.length === 0 && <tr><td colSpan={boardDetails ? 8 : 5} className="px-3 py-6 text-center text-sm text-muted-foreground">No cards in this stage.</td></tr>}
                {boardRows.map((c) => (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="max-w-[280px] px-3 py-3.5">
                      <button onClick={() => openEdit(c)} className="text-left font-semibold leading-snug text-foreground hover:text-primary">{c.title}</button>
                      {c.hook && <div className="line-clamp-2 text-[12.5px] text-muted-foreground">{c.hook}</div>}
                      {scheduleNote(c)}
                    </td>
                    <td className="px-3 py-3.5"><StageChip stage={stageOf(c)} /></td>
                    {boardDetails && <><td className="px-3 py-3.5"><Chip className={brandClass(c.brand)}>{brandHandle(c.brand)}</Chip>{c.day > 0 && <div className="mt-1 text-[12px] text-muted-foreground">{WEEKDAY[c.day]} slot</div>}</td>
                    <td className="max-w-[180px] px-3 py-3.5">{clipLine(c)}</td>
                    <td className="px-3 py-3.5 text-[13px] text-foreground">{c.owner || <span className="text-muted-foreground">—</span>}</td></>}
                    <td className={`px-3 py-3.5 text-[13px] ${dueTone(c.due_date)}`}>{fmtDue(c.due_date) || "—"}</td>
                    <td className="max-w-[220px] px-3 py-3.5 text-[13px] text-foreground">{nextAction(c)}</td>
                    <td className="px-3 py-3.5"><div className="flex flex-wrap items-center justify-end gap-1">{primaryAction(c)}{secondaryActions(c)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "week" && (
        <WeekTab cards={cards} mix={mix} onOpen={openEdit}
          onMove={(c, day) => { void patch(c.id, { day }).then((ok) => { if (ok) toast.success(day ? `Moved to ${DAY_THEMES[day].name}` : "Moved to Ideas"); }); }}
          onAdd={(d) => { const long = DAY_THEMES[d].longTarget > 0; setDraft({ ...emptyDraft, day: d, brand: long ? "YT" : "SH", content_type: long ? "long" : "short" }); setEditing(null); setEditorOpen(true); }} />
      )}

      {tab === "library" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by what's in the clip — car, gym, drone, office…" className="pl-8" />
            </div>
            {/* Testimonials: FaceTime/phone calls where someone praises Sam, plus screenshots and texts saying how good it is.
                Verdicts come from what the clip SAYS (whisper transcript / OCR), judged by the classifier daemon; Sam's tap wins. */}
            <button onClick={() => chooseProof(proof === "testimonials" ? "all" : "testimonials")} title="FaceTime calls, videos with someone praising the agency, screenshots and texts"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${proof === "testimonials" ? "border-gold bg-gold/20 text-gold" : "border-gold/40 text-gold/90 hover:bg-gold/10"}`}>
              <MessageSquareQuote className="h-3.5 w-3.5" /> Testimonials <span className="opacity-70">{testimonialClips.length}</span>
            </button>
            {proof === "testimonials" && ([{ k: "all", label: "All" }, { k: "video", label: "Calls & videos" }, { k: "image", label: "Screenshots & texts" }] as { k: ProofKind; label: string }[]).map((p) => {
              const n = p.k === "all" ? testimonialClips.length : testimonialClips.filter((k) => proofKindOf(k) === p.k).length;
              return (
                <button key={p.k} onClick={() => setProofKind(p.k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${proofKind === p.k ? "border-gold/60 bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {p.label} <span className="opacity-60">{n}</span>
                </button>
              );
            })}
            {proof === "testimonials" && (
              <Button size="sm" disabled={downloadingAll || visibleClips.length === 0} onClick={() => void downloadAll(visibleClips)} className="h-7 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25" title="Fire every fresh direct link in this set — allow multiple downloads when Chrome asks once">
                {downloadingAll ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}{downloadingAll && pulling ? `Pulling ${pulling}` : batch?.files.length && mobileSave ? `Save ${batch.files.length} to camera roll` : `${mobileSave ? "Get all" : "Download all"} ${visibleClips.length}`}
              </Button>
            )}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            {(["all", "YouTube", "Reels", "Screenshots"] as const).filter((f) => f !== "Screenshots" || clips.some((k) => k.folder === "Screenshots")).map((f) => (
              <button key={f} onClick={() => setFolder(f)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${folder === f ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "All" : f === "YouTube" ? "YouTube · horizontal" : f === "Reels" ? "Reels · vertical" : "Screenshots"}
              </button>
            ))}
            {(["all", "short", "mid", "long"] as const).map((l) => (
              <button key={l} onClick={() => setLength(l)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${length === l ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {l === "all" ? "Any length" : l === "short" ? "≤ 1 min" : l === "mid" ? "1–5 min" : "5 min +"}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            {([{ k: "all" as const, label: "All pillars" }, ...PILLARS] as { k: "all" | PillarKey; label: string }[]).map((p) => {
              const n = p.k === "all" ? clips.length : clips.filter((k) => pillarsOf(k).includes(p.k as PillarKey)).length;
              return (
                <button key={p.k} onClick={() => setPillar(p.k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${pillar === p.k ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {p.label} <span className="opacity-60">{n}</span>
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-1.5">
              {(["banger", "newest"] as const).map((s) => (
                <button key={s} onClick={() => setSortBy(s)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${sortBy === s ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {s === "banger" ? "🔥 Bangers first" : "Newest"}
                </button>
              ))}
            </div>
            <span className="w-full text-xs text-muted-foreground">
              <button onClick={() => setShowDetails(!showDetails)} aria-pressed={showDetails} className="mr-2 rounded-full border border-border px-2.5 py-0.5 font-semibold text-foreground hover:border-primary/60">{showDetails ? "Hide details" : "Show details"}</button>
              {visibleClips.length.toLocaleString()} match · {clips.filter((k) => k.thumb_url).length.toLocaleString()} with previews
              {health && (proof === "testimonials" || health.waiting > 0) && (
                <> · classifier: <b className="text-foreground">{health.judged.toLocaleString()}</b> judged, <b className="text-foreground">{health.waiting.toLocaleString()}</b> still waiting{health.last_judged_at ? ` · last ${fmtDate(health.last_judged_at)}` : ""} — the list grows as it works</>
              )}
            </span>
          </div>
          {attachTarget && <div className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-foreground">Pick the clip for <b>{attachTarget.title}</b> — tap <b>Attach</b> on a row.</div>}
          {picked.size > 0 && (
            <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-background/95 px-3 py-2 text-sm backdrop-blur">
              <span className="font-semibold text-foreground">{picked.size} selected</span>
              <Button size="sm" onClick={shareSelected} className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy share link</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} className="h-8 text-muted-foreground">Clear</Button>
              <span className="text-xs text-muted-foreground">Anyone with the link can preview and download these originals — no login.</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleClips.length === 0 && <p className="col-span-full p-4 text-sm text-muted-foreground">No clips match. Previews and titles fill in as the mini indexes your Dropbox (newest first).</p>}
            {visibleClips.slice(0, shown).map((k) => (
              <div key={k.id} className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card ${picked.has(k.id) ? "border-primary ring-1 ring-primary/50" : "border-border"}`}>
                <label className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background/85 text-primary" title="Select to share">
                  <input type="checkbox" checked={picked.has(k.id)} onChange={() => togglePick(k.id)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                </label>
                <a href={directUrl(k) ?? dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => {
                    // Phones and tablets have no hover: the first tap plays the preview, the next tap opens the clip.
                    const v = e.currentTarget.querySelector("video");
                    if (v && v.paused && window.matchMedia("(hover: none)").matches) { e.preventDefault(); v.style.opacity = "1"; void v.play(); }
                  }}
                  className={`relative block bg-muted/40 ${k.kind === "vertical" ? "aspect-[9/16] max-h-64" : "aspect-video"}`} title={k.media === "image" ? "Open the screenshot" : "Open in Dropbox"}>
                  {k.thumb_url ? (
                    <>
                      <img src={k.thumb_url} alt="" loading="lazy" className={`h-full w-full ${k.media === "image" ? "object-contain bg-black/40" : "object-cover"}`} />
                      {isTestimonial(k) && (
                        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-gold px-1.5 py-0.5 text-[11px] font-extrabold text-zinc-950" title={k.testimonial_reason ?? "testimonial"}>
                          <MessageSquareQuote className="h-3 w-3" /> {k.media === "image" ? "TEXT" : k.testimonial_kind === "video_call" ? "CALL" : "TESTIMONIAL"}
                        </span>
                      )}
                      {k.preview_url && k.media !== "image" && (
                        <video src={k.preview_url} muted loop playsInline preload="none" onMouseEnter={(e) => { void e.currentTarget.play(); }} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">{k.media === "image" ? <ImageIcon className="h-6 w-6" /> : <Film className="h-6 w-6" />}</div>
                  )}
                  {k.duration_s ? <span className="absolute bottom-1.5 right-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">{fmtDur(k.duration_s)}</span> : null}
                  {k.used_by_card && <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-950">on a card</span>}
                  {k.banger_score != null && (
                    <span className={`absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums text-zinc-950 ${bangerColor(k.banger_score)}`} title={k.banger_reason ?? "traction potential"}>🔥 {k.banger_score}</span>
                  )}
                </a>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  {renaming?.id === k.id ? (
                    <input autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: k.id, text: e.target.value })} onBlur={() => void saveRename()} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(); if (e.key === "Escape") { renameDone.current = true; setRenaming(null); } }} aria-label="Clip title" className="w-full rounded border border-primary/60 bg-background px-2 py-1 text-sm font-bold text-foreground outline-none" />
                  ) : (
                    <button onClick={() => { renameDone.current = false; setRenaming({ id: k.id, text: k.find_label || k.title || cleanName(k.name) }); }} title="Tap to rename" className="line-clamp-2 text-left text-sm font-bold leading-snug text-foreground hover:text-primary">{k.find_label || k.title || cleanName(k.name)}</button>
                  )}
                  {k.hook_title && <button onClick={() => { void navigator.clipboard?.writeText(k.hook_title ?? "").then(() => toast.success("Hook copied")).catch(() => toast.error("Clipboard blocked")); }} title="Tap to copy the hook" className="line-clamp-1 text-left text-[13px] italic text-muted-foreground hover:text-foreground">🎬 {k.hook_title}</button>}
                  {isTestimonial(k) && k.testimonial_reason && <div className="line-clamp-2 text-[12px] text-gold/90" title={k.testimonial_reason}>{k.testimonial_reason}</div>}
                  {!isTestimonial(k) && k.transcript && proof === "all" && query && <div className="line-clamp-2 text-[11.5px] italic text-muted-foreground" title={k.transcript}>“{k.transcript.slice(0, 140)}”</div>}
                  {(showDetails || proof === "testimonials") && <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">{k.testimonial == null ? "not judged yet" : isTestimonial(k) ? (k.testimonial_source === "manual" ? "testimonial · you" : "testimonial") : "not a testimonial"}</span>
                    <button onClick={() => void setVerdict(k, true)} title="Mark as a testimonial" className={`rounded border p-0.5 ${isTestimonial(k) ? "border-gold/60 bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-gold"}`}><ThumbsUp className="h-3 w-3" /></button>
                    <button onClick={() => void setVerdict(k, false)} title="Not a testimonial" className={`rounded border p-0.5 ${k.testimonial === false ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}><ThumbsDown className="h-3 w-3" /></button>
                  </div>}
                  {showDetails && k.banger_score != null && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${bangerColor(k.banger_score)}`} style={{ width: `${k.banger_score}%` }} /></div>
                    </div>
                  )}
                  {showDetails && <div className="flex flex-wrap gap-1">
                    {PILLARS.map((p) => {
                      const on = pillarsOf(k).includes(p.k);
                      return (
                        <button key={p.k} title={on ? `Tagged ${p.label}` : `Tag as ${p.label}`} onClick={() => void togglePillar(k, p.k)}
                          className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                          {p.label.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>}
                  {showDetails && k.tags && k.tags.length > 0 && <div className="flex flex-wrap gap-1">{k.tags.slice(0, 4).map((tg) => <button key={tg} onClick={() => setQuery(tg)} className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">{tg}</button>)}</div>}
                  <div className="mt-auto text-[12px] text-muted-foreground">{k.folder} · {fmtDate(k.modified_at)} · {fmtSize(k.size_bytes)}</div>
                  <div className="flex gap-1.5">
                    {attachTarget
                      ? <Button size="sm" onClick={() => attachClip(k, attachTarget)} className="h-7 flex-1 bg-primary px-2.5 text-[12.5px] text-primary-foreground hover:bg-primary/90"><Paperclip className="mr-1 h-3 w-3" />Attach</Button>
                      : <Button size="sm" variant="outline" onClick={() => cardFromClip(k)} className="h-7 flex-1 px-2.5 text-[12.5px]"><Plus className="mr-1 h-3 w-3" />New card</Button>}
                    {(directUrl(k) || k.phone_url)
                      ? <Button size="sm" disabled={mobileSave && !!pull[k.id] && pull[k.id].pct !== null && pull[k.id].pct! < 100 && !pull[k.id].error} onClick={() => void saveOne(k)}
                          className={`h-7 px-2.5 text-[12.5px] font-semibold ${pull[k.id]?.file ? "bg-gold text-zinc-950 hover:bg-gold/90" : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"}`}
                          title={mobileSave ? (k.phone_url ? "Phone-size copy — tap to pull, tap again to save to camera roll" : "Tap to pull, tap again to save to camera roll") : "Download the original — one tap"}>
                          {mobileSave && pull[k.id] && !pull[k.id].file && !pull[k.id].error ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                          {!mobileSave ? "Download" : pull[k.id]?.file ? "Save to camera roll" : pull[k.id] && !pull[k.id].error ? (pull[k.id].pct !== null ? `${pull[k.id].pct}%` : fmtSize(pull[k.id].loaded)) : k.phone_url ? `Get · ${fmtSize(k.phone_bytes ?? 0)}` : "Get"}
                        </Button>
                      : <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[12.5px] text-muted-foreground"><a href={dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer" title="Direct link is being re-minted (every 20 min) — this opens the file in Dropbox, where Download is one tap"><ExternalLink className="mr-1 h-3.5 w-3.5" />Dropbox</a></Button>}
                    <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(k.path).then(() => toast.success("Path copied")).catch(() => toast.error("Clipboard blocked")); }} className="h-7 px-2 text-muted-foreground" title="Copy Dropbox path (for getclips / editors)"><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {visibleClips.length > shown && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setShown((n) => n + 96)}>Load more · {visibleClips.length - shown} left</Button>
            </div>
          )}
        </div>
      )}

      {tab === "analytics" && (
        <Suspense fallback={<PageSkeleton />}>
          <AccountsAnalytics />
        </Suspense>
      )}
      {tab === "queue" && (
        <Suspense fallback={<PageSkeleton />}>
          <ContentQueue embedded />
        </Suspense>
      )}

      <p className="pt-10 text-center text-xs leading-relaxed text-muted-foreground">Saves on every change. Copying a caption or downloading a clip never changes a stage; Published needs the live post URL.</p>

      {/* Publish kit: caption + clip to post by hand, then the live URL that proves it. */}
      <Dialog open={!!postTarget} onOpenChange={(o) => !o && setPostTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Publish: {postTarget?.title}</DialogTitle></DialogHeader>
          {postTarget && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip className={brandClass(postTarget.brand)}>{brandHandle(postTarget.brand)}</Chip>
                <StageChip stage={stageOf(postTarget)} />
                {scheduleNote(postTarget)}
              </div>
              <Textarea readOnly rows={5} aria-label="Caption" value={postTarget.caption || "(no caption yet — edit the card to add one)"} className="text-sm" />
              {postTarget.cta && <p className="text-xs text-muted-foreground">Call to action: <span className="text-foreground">{postTarget.cta}</span></p>}
              {postTarget.caption && !hasCta(postTarget.caption) && !hasCta(postTarget.cta ?? "") && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                  <span>No website CTA in this caption.</span>
                  <Button size="sm" variant="outline" className="h-7 text-[12.5px]" onClick={async () => { const cap = `${postTarget.caption.trim()}\n\n${CTA}`; if (await patch(postTarget.id, { caption: cap })) setPostTarget({ ...postTarget, caption: cap }); }}>Add apex-financial.org/apply</Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyCaption(postTarget.caption)} disabled={!postTarget.caption}><Copy className="mr-1.5 h-4 w-4" aria-hidden />Copy caption</Button>
                {postTarget.clip && (() => { const k = clips.find((x) => x.path === postTarget.clip); const d = k ? directUrl(k) : null; return d
                  ? <Button asChild variant="outline"><a href={d} download={k?.name}><Download className="mr-1.5 h-4 w-4" aria-hidden />Download the clip</a></Button>
                  : <Button asChild variant="outline"><a href={dropboxUrl(postTarget.clip)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />Open clip in Dropbox</a></Button>; })()}
              </div>
              <p className="text-[12.5px] text-muted-foreground">Copying and downloading do not change the stage. Post it on the platform yourself, then paste the live link below.</p>
              <div className="grid gap-1.5 border-t border-border pt-3">
                <Label htmlFor="lb-live-url">Live post URL</Label>
                <Input id="lb-live-url" inputMode="url" autoComplete="off" value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} placeholder="https://www.youtube.com/shorts/…" />
                {publishUrl.trim() !== "" && (publishCheck.ok
                  ? <p className="text-[12.5px] text-muted-foreground">Looks like a {publishCheck.platform} post.{publishCheck.warning ? ` ${publishCheck.warning}` : ""}</p>
                  : <p className="text-[12.5px] text-destructive">{publishCheck.reason}</p>)}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostTarget(null)}>Not yet</Button>
            <Button onClick={() => void confirmPublished()} disabled={locked || !publishCheck.ok || (postTarget ? busyId === postTarget.id : false) || (postTarget ? !["ready", "scheduled", "published_unconfirmed", "published"].includes(stageOf(postTarget)) : true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Check className="mr-1.5 h-4 w-4" aria-hidden />Confirm published
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan a time. No scheduler integration writes to this board, so it is always a labelled manual plan. */}
      <Dialog open={!!scheduleTarget} onOpenChange={(o) => !o && setScheduleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Plan a post time: {scheduleTarget?.title}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="lb-schedule-at">Post at (your local time)</Label>
            <Input id="lb-schedule-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            <p className="text-[12.5px] text-muted-foreground">This is a <b className="text-foreground">Manual plan</b>: nothing posts automatically. It shows on Today when the time comes; post it yourself, then confirm the live URL.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleTarget(null)}>Cancel</Button>
            <Button onClick={() => void saveSchedule()} disabled={locked || (scheduleTarget ? busyId === scheduleTarget.id : false)} className="bg-primary text-primary-foreground hover:bg-primary/90"><CalendarClock className="mr-1.5 h-4 w-4" aria-hidden />Save manual plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor: only execution fields. Stage moves happen through the workflow actions, never from here. */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit card" : "New idea"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              <StageChip stage={stageOf(editing)} />
              <span className="text-muted-foreground">Next action:</span>
              <span className="font-semibold text-foreground">{nextAction({ ...editing, ...(draft as Partial<Card>) } as Card)}</span>
              {editing.approved_at && <span className="text-muted-foreground">· approved {fmtDate(editing.approved_at)}</span>}
              {externalHref(editing.published_url) && <a href={externalHref(editing.published_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">· live post</a>}
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="lb-title">Title</Label><Input id="lb-title" value={draftStr("title")} onChange={(e) => setDraftField("title", e.target.value)} placeholder="What's the video?" /></div>
            <div className="grid gap-1.5"><Label htmlFor="lb-hook">Hook</Label><Textarea id="lb-hook" rows={2} value={draftStr("hook")} onChange={(e) => setDraftField("hook", e.target.value)} placeholder="The opening line, in the first 1.5 seconds" /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-script" className="flex items-center justify-between">Recording script / shot list <span className="flex gap-2">
                {!draftStr("record_script") && <button type="button" onClick={() => setDraftField("record_script", recordTemplate(draft))} className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">Fill from template</button>}
                {draftStr("record_script") && <button type="button" onClick={() => copyText(draftStr("record_script"), "Shot list")} className="text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Copy</button>}
              </span></Label>
              <Textarea id="lb-script" rows={5} value={draftStr("record_script")} onChange={(e) => setDraftField("record_script", e.target.value)} placeholder="Camera, where, the hook line, the beats, the lesson" className="font-mono text-[13px]" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-clip" className="flex items-center justify-between">Source media
                {editing && <button type="button" onClick={() => { setAttachTarget(editing); setEditorOpen(false); setTab("library"); }} className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">Pick from Library</button>}
              </Label>
              <Input id="lb-clip" value={draftStr("clip")} onChange={(e) => setDraftField("clip", e.target.value)} placeholder="Reels/2026/09/clip.mp4 (Dropbox path)" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-edit" className="flex items-center justify-between">Edit instructions <span className="flex gap-2">
                {!draftStr("edit_prompt") && <button type="button" onClick={() => setDraftField("edit_prompt", editTemplate(draft))} className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">Fill from template</button>}
                {draftStr("edit_prompt") && <button type="button" onClick={() => copyText(draftStr("edit_prompt"), "Edit instructions")} className="text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Copy</button>}
              </span></Label>
              <Textarea id="lb-edit" rows={4} value={draftStr("edit_prompt")} onChange={(e) => setDraftField("edit_prompt", e.target.value)} placeholder="How to cut it (format, length, captions, what to exclude)" className="font-mono text-[13px]" />
              <p className="text-[12px] text-muted-foreground">{FORMAT_LINE}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-cap">Caption</Label>
              <Textarea id="lb-cap" rows={3} value={draftStr("caption")} onChange={(e) => setDraftField("caption", e.target.value)} placeholder="The caption you'll post with" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lb-cta" className="flex items-center justify-between">Call to action
                {!draftStr("cta") && <button type="button" onClick={() => setDraftField("cta", CTA)} className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline">Use the apply CTA</button>}
              </Label>
              <Input id="lb-cta" value={draftStr("cta")} disabled={!workflowReady} onChange={(e) => setDraftField("cta", e.target.value)} placeholder="What the viewer should do" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label className="text-[12px] uppercase tracking-wide text-muted-foreground">Destination</Label>
                <Select value={draftStr("brand")} onValueChange={(v) => setDraftField("brand", v)}><SelectTrigger aria-label="Destination channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SH">Shorts → Repurpose</SelectItem><SelectItem value="YT">YouTube long-form</SelectItem>{(draftStr("brand") === "SFD" || draftStr("brand") === "IMS") && <SelectItem value={draftStr("brand")}>{brandHandle(draftStr("brand"))}</SelectItem>}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label className="text-[12px] uppercase tracking-wide text-muted-foreground">Job</Label>
                <Select value={draftStr("job")} onValueChange={(v) => setDraftField("job", v)}><SelectTrigger aria-label="Content job"><SelectValue /></SelectTrigger><SelectContent>{JOBS.map((j) => <SelectItem key={j.k} value={j.k}>{j.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label className="text-[12px] uppercase tracking-wide text-muted-foreground">Week slot</Label>
                <Select value={draftStr("day")} onValueChange={(v) => setDraftField("day", Number(v))}><SelectTrigger aria-label="Week slot"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">—</SelectItem>{[1, 2, 3, 4, 5, 6, 7].map((d) => <SelectItem key={d} value={String(d)}>{WEEKDAY[d]} · {DAY_THEMES[d].angle}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-owner" className="text-[12px] uppercase tracking-wide text-muted-foreground">Owner</Label>
                <Input id="lb-owner" value={draftStr("owner")} disabled={!workflowReady} onChange={(e) => setDraftField("owner", e.target.value)} placeholder="Who does the next step" /></div>
              <div className="grid gap-1.5"><Label htmlFor="lb-due" className="text-[12px] uppercase tracking-wide text-muted-foreground">Deadline</Label>
                <Input id="lb-due" type="date" value={draftStr("due_date").slice(0, 10)} disabled={!workflowReady} onChange={(e) => setDraftField("due_date", e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{editing ? "Save" : "Add idea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
