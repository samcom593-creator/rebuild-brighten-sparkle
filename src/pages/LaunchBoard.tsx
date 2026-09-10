// Launch Board v2 — the page where Sam sees his content to post.
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight, Check, Clapperboard, Copy, Crown, Download, ExternalLink, Film, Loader2, Paperclip, Pencil, Plus, Search, Trash2, Undo2,
} from "lucide-react";

type Status = "idea" | "recorded" | "ready" | "posted";
type Job = "REACH" | "AUTHORITY" | "PROOF" | "CONVERT";
type Tab = "today" | "board" | "week" | "library";

interface Card {
  id: string; title: string; brand: string; content_type: string; job: string; hook: string; caption: string;
  status: string; day: number; clip: string; sort: number; posted_at: string | null;
}
interface Clip {
  id: string; path: string; name: string; folder: string; kind: string; size_bytes: number; modified_at: string | null; used_by_card: string | null;
  thumb_url?: string | null; preview_url?: string | null; duration_s?: number | null; title?: string | null; description?: string | null; tags?: string[];
  download_url?: string | null; download_expires_at?: string | null;
  hook_title?: string | null; banger_score?: number | null; banger_reason?: string | null;
}

const STATUSES: Status[] = ["idea", "recorded", "ready", "posted"];
const STATUS_LABEL: Record<Status, string> = { idea: "Ideas", recorded: "Recorded", ready: "Ready", posted: "Posted" };
const STATUS_SUB: Record<Status, string> = { idea: "to record", recorded: "attach + caption", ready: "post it", posted: "live" };
const STATUS_RANK: Record<string, number> = { ready: 3, recorded: 2, idea: 1, posted: 0 };
const DOT: Record<Status, string> = { idea: "bg-zinc-500", recorded: "bg-sky-400", ready: "bg-gold", posted: "bg-emerald-400" };
const TXT: Record<Status, string> = { idea: "text-zinc-400", recorded: "text-sky-400", ready: "text-gold", posted: "text-emerald-400" };
const JOBS: { k: Job; label: string; desc: string; accent: string; border: string }[] = [
  { k: "REACH", label: "Reach", desc: "Get seen — who you are, wider than the offer.", accent: "text-amber-400", border: "border-t-amber-400/70" },
  { k: "AUTHORITY", label: "Authority", desc: "Give value — a lesson people keep.", accent: "text-sky-400", border: "border-t-sky-400/70" },
  { k: "PROOF", label: "Proof", desc: "Show it's real — the system, the results.", accent: "text-violet-400", border: "border-t-violet-400/70" },
  { k: "CONVERT", label: "Convert", desc: "One clear ask — apply.", accent: "text-emerald-400", border: "border-t-emerald-400/70" },
];
const TABS: { k: Tab; label: string }[] = [
  { k: "today", label: "Today" }, { k: "board", label: "Board" }, { k: "week", label: "Week" }, { k: "library", label: "Library" },
];

// Sam's three brand pillars (2026-09-10): cars, fitness, entrepreneurship — plus the two jobs that pay: sales/insurance and the APEX ask.
// A clip's pillar is read off its existing AI tags/title/description, so nothing needs re-tagging; a tap on a chip pins it by writing the pillar word into tags.
type PillarKey = "cars" | "fitness" | "entrepreneurship" | "sales" | "cta";
const PILLARS: { k: PillarKey; label: string; re: RegExp }[] = [
  { k: "cars", label: "Cars", re: /\b(cars?|corvette|vette|lambo|lamborghini|porsche|mercedes|benz|bmw|tesla|exotic|fleet|rental|turo|driving|wheels|garage)\b/i },
  { k: "fitness", label: "Fitness", re: /\b(gym|workout|lift(?:ing)?|physique|training|fitness|bench|squat|deadlift|cardio|abs|muscle|shirtless|run(?:ning)?)\b/i },
  { k: "entrepreneurship", label: "Entrepreneurship", re: /\b(office|desk|meeting|business|laptop|entrepreneur(?:ship)?|money|team|talking-head|whiteboard|podcast|mic|apex)\b/i },
  { k: "sales", label: "Sales & insurance", re: /\b(sales?|insurance|agents?|closing|calls?|dialer|policy|policies|pitch|objection)\b/i },
  { k: "cta", label: "CTA / recruiting", re: /\b(cta|recruit(?:ing)?|apply|application|hiring|join)\b/i },
];
const clipHay = (k: Clip) => `${k.title ?? ""} ${k.description ?? ""} ${(k.tags ?? []).join(" ")} ${k.name}`;
const pillarsOf = (k: Clip): PillarKey[] => PILLARS.filter((p) => p.re.test(clipHay(k))).map((p) => p.k);

const brandHandle = (b: string) => (b === "IMS" ? "@imakesystems" : "@sellfordaddy");
const brandClass = (b: string) => (b === "IMS" ? "text-sky-300 border-sky-400/30 bg-sky-400/10" : "text-amber-300 border-amber-400/30 bg-amber-400/10");
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
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className ?? "border-border text-muted-foreground"}`}>{children}</span>;
}
function Head({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const emptyDraft = { title: "", brand: "SFD", job: "REACH", content_type: "short", hook: "", caption: "", clip: "", day: 0, status: "idea" };

export default function LaunchBoard() {
  usePageTitle("Launch Board");
  const askConfirm = useConfirm();
  const [tab, setTab] = useState<Tab>("today");
  const [cards, setCards] = useState<Card[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pillar, setPillar] = useState<"all" | PillarKey>("all");
  const [folder, setFolder] = useState<"all" | "YouTube" | "Reels">("all");
  const [length, setLength] = useState<"all" | "short" | "mid" | "long">("all");
  const [sortBy, setSortBy] = useState<"banger" | "newest">("banger");
  const [shown, setShown] = useState(96);
  const [picked, setPicked] = useState<Set<string>>(new Set());   // Library multi-select for sharing
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
  useEffect(() => { setShown(96); }, [query, folder, length, pillar]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [postTarget, setPostTarget] = useState<Card | null>(null);
  const [attachTarget, setAttachTarget] = useState<Card | null>(null);   // card waiting for a clip from the Library

  const load = useCallback(async () => {
    try {
      const c = await supabase.from("content_cards").select("*").order("day", { ascending: true }).order("sort", { ascending: true });
      if (c.error) throw c.error;
      setCards((c.data as Card[]) ?? []);
      // The whole library, paged: PostgREST returns at most 1,000 rows per request.
      const all: Clip[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const k = await supabase.from("content_clips")
          .select("id, path, name, folder, kind, size_bytes, modified_at, used_by_card, thumb_url, preview_url, duration_s, title, description, tags, download_url, download_expires_at, hook_title, banger_score, banger_reason").order("modified_at", { ascending: false, nullsFirst: false }).range(from, from + 999);
        if (k.error) throw k.error;
        const page = (k.data as Clip[]) ?? [];
        all.push(...page);
        setClips([...all]);
        if (page.length < 1000) break;
      }
    } catch (e: unknown) {
      toast.error(`Couldn't load the board: ${(e instanceof Error ? e.message : "unknown error").slice(0, 120)}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);


  const patch = useCallback(async (id: string, changes: Partial<Card>) => {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    const { error } = await supabase.from("content_cards").update(changes).eq("id", id);
    if (error) { setCards(prev); toast.error(`Save failed: ${error.message.slice(0, 120)}`); return false; }
    return true;
  }, [cards]);

  const advance = (c: Card) => patch(c.id, { status: c.status === "idea" ? "recorded" : "ready" });
  const back = (c: Card) => patch(c.id, { status: c.status === "ready" ? "recorded" : "idea" });
  const unpost = (c: Card) => patch(c.id, { status: "ready", posted_at: null });
  const markPosted = async (c: Card) => {
    if (await patch(c.id, { status: "posted", posted_at: new Date().toISOString() })) { toast.success("Marked posted"); setPostTarget(null); }
  };
  const copyCaption = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Caption copied"); }
    catch { toast.error("Clipboard blocked — select the text and copy it"); }
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
    const ok = await patch(card.id, { clip: clip.path, status: card.status === "idea" ? "recorded" : card.status });
    if (!ok) return;
    await supabase.from("content_clips").update({ used_by_card: card.id }).eq("id", clip.id);
    setClips((ks) => ks.map((k) => (k.id === clip.id ? { ...k, used_by_card: card.id } : k)));
    setAttachTarget(null); toast.success(`Attached to “${card.title}”`); setTab("board");
  };
  const cardFromClip = async (clip: Clip) => {
    const nextSort = (cards.reduce((m, c) => Math.max(m, c.sort), 0) || 0) + 10;
    const { data, error } = await supabase.from("content_cards")
      .insert({ title: cleanName(clip.name), brand: "SFD", job: "REACH", content_type: clip.kind === "vertical" ? "short" : "long", hook: "", caption: "", clip: clip.path, day: 0, status: "recorded", sort: nextSort })
      .select("*").single();
    if (error) { toast.error(`Couldn't create the card: ${error.message.slice(0, 120)}`); return; }
    setCards((cs) => [...cs, data as Card]);
    await supabase.from("content_clips").update({ used_by_card: (data as Card).id }).eq("id", clip.id);
    setClips((ks) => ks.map((k) => (k.id === clip.id ? { ...k, used_by_card: (data as Card).id } : k)));
    toast.success("Card created in Recorded — add a caption, then it's ready");
  };

  const openNew = () => { setEditing(null); setDraft({ ...emptyDraft }); setEditorOpen(true); };
  const openEdit = (c: Card) => { setEditing(c); setDraft({ ...c }); setEditorOpen(true); };
  const draftStr = (k: string) => String(draft[k] ?? "");
  const setDraftField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const saveDraft = async () => {
    const title = draftStr("title").trim();
    if (!title) { toast.error("Give the card a title"); return; }
    setSaving(true);
    const payload = { title, brand: draftStr("brand") || "SFD", job: draftStr("job") || "REACH", content_type: draftStr("content_type") || "short", hook: draftStr("hook"), caption: draftStr("caption"), clip: draftStr("clip"), day: Number(draft.day ?? 0), status: draftStr("status") || "idea" };
    try {
      if (editing) {
        const { error } = await supabase.from("content_cards").update(payload).eq("id", editing.id);
        if (error) throw error;
        setCards((cs) => cs.map((c) => (c.id === editing.id ? { ...c, ...payload } : c)));
      } else {
        const nextSort = (cards.reduce((m, c) => Math.max(m, c.sort), 0) || 0) + 10;
        const { data, error } = await supabase.from("content_cards").insert({ ...payload, sort: nextSort }).select("*").single();
        if (error) throw error;
        setCards((cs) => [...cs, data as Card]);
      }
      setEditorOpen(false); toast.success(editing ? "Saved" : "Idea added");
    } catch (e: unknown) {
      toast.error(`Couldn't save: ${(e instanceof Error ? e.message : "unknown error").slice(0, 120)}`);
    } finally { setSaving(false); }
  };

  const launch4 = useMemo(() => JOBS.map((j) => ({
    job: j,
    pick: cards.filter((c) => c.job === j.k && c.status !== "posted").sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || ((a.day || 9) - (b.day || 9)))[0] ?? null,
  })), [cards]);
  const ready = useMemo(() => cards.filter((c) => c.status === "ready"), [cards]);
  const recordNext = useMemo(() => cards.filter((c) => c.status === "idea").sort((a, b) => (a.day || 9) - (b.day || 9)).slice(0, 5), [cards]);
  const needsClip = useMemo(() => cards.filter((c) => c.status !== "posted" && !c.clip), [cards]);
  const visibleClips = useMemo(() => {
    const q = query.trim().toLowerCase();
    const SYN: Record<string, string> = { gym: "workout", exercise: "workout", weights: "workout", lifting: "workout", fitness: "workout", cars: "car", vehicle: "car", corvette: "car", driving: "car", aerial: "drone", dji: "drone", desk: "office", computer: "office", laptop: "office", talking: "talking-head", speaking: "talking-head", podcast: "talking-head", vlog: "talking-head", outside: "outdoors", street: "outdoors", sunset: "outdoors", crowd: "event", seminar: "event", conference: "event", tiktok: "vertical", reel: "vertical", reels: "vertical", youtube: "horizontal" };
    const words = q.split(/\s+/).filter(Boolean).map((w) => SYN[w] ?? w);
    const hay = (k: Clip) => `${k.title ?? ""} ${k.description ?? ""} ${(k.tags ?? []).join(" ")} ${k.name}`.toLowerCase();
    const lenOk = (k: Clip) => {
      const d = Number(k.duration_s ?? 0);
      return length === "all" || (length === "short" ? d > 0 && d <= 60 : length === "mid" ? d > 60 && d <= 300 : d > 300);
    };
    const out = clips.filter((k) => (folder === "all" || k.folder === folder) && lenOk(k) && (pillar === "all" || pillarsOf(k).includes(pillar)) && (!words.length || words.every((w) => hay(k).includes(w))));
    if (sortBy === "banger") out.sort((a, b) => (b.banger_score ?? -1) - (a.banger_score ?? -1) || (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
    else out.sort((a, b) => (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
    return out;
  }, [clips, query, folder, length, pillar, sortBy]);
  const bangerColor = (s?: number | null) => (s == null ? "bg-zinc-600" : s >= 70 ? "bg-emerald-400" : s >= 45 ? "bg-gold" : "bg-zinc-500");
  const fmtDur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
  const counts = useMemo(() => ({ total: cards.length, ready: ready.length, posted: cards.filter((c) => c.status === "posted").length }), [cards, ready]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your board…</div>;

  const clipLine = (c: Card) => c.clip ? (
    <a href={dropboxUrl(c.clip)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 truncate rounded-lg border border-sky-400/30 px-2 py-1.5 text-[11.5px] text-sky-400 hover:bg-sky-400/10">
      <Film className="h-3 w-3 shrink-0" /><span className="truncate">{c.clip.split("/").pop()}</span><ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-70" />
    </a>
  ) : (
    <button onClick={() => { setAttachTarget(c); setTab("library"); }} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5 text-left text-[11.5px] text-muted-foreground hover:border-gold/50 hover:text-gold">
      <Paperclip className="h-3 w-3" /> Attach a clip from the library
    </button>
  );

  const CardView = ({ c }: { c: Card }) => (
    <div className={`flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 ${c.status === "posted" ? "opacity-70" : ""}`}>
      <button onClick={() => openEdit(c)} className="text-left text-[15px] font-bold leading-tight text-foreground">{c.title}</button>
      {c.hook && <p className="text-[12.5px] leading-snug text-muted-foreground">{c.hook}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className={brandClass(c.brand)}>{brandHandle(c.brand)}</Chip>
        {c.day > 0 && <Chip className="border-border bg-background/60 text-muted-foreground">Day {c.day}</Chip>}
        <Chip className="border-border text-muted-foreground">{c.job.toLowerCase()}</Chip>
      </div>
      {clipLine(c)}
      <div className="mt-0.5 flex flex-wrap gap-1.5">
        {(c.status === "idea" || c.status === "recorded") && (
          <Button size="sm" onClick={() => advance(c)} className="h-7 bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground hover:bg-primary/90"><ArrowRight className="mr-1 h-3 w-3" />{c.status === "idea" ? "Recorded" : "Ready"}</Button>
        )}
        {c.status === "ready" && <Button size="sm" onClick={() => setPostTarget(c)} className="h-7 border border-emerald-400/35 bg-emerald-400/15 px-2.5 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-400/25"><Check className="mr-1 h-3 w-3" />Post</Button>}
        {c.status === "posted" && <Button size="sm" variant="outline" onClick={() => unpost(c)} className="h-7 px-2.5 text-[11.5px]"><Undo2 className="mr-1 h-3 w-3" />Undo</Button>}
        {(c.status === "recorded" || c.status === "ready") && <Button size="sm" variant="outline" onClick={() => back(c)} className="h-7 px-2 text-[11.5px] text-muted-foreground">back</Button>}
        <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="h-7 px-2 text-muted-foreground" title="edit"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={() => remove(c)} className="h-7 px-2 text-muted-foreground hover:text-destructive" title="delete"><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Crown className="h-8 w-8 text-gold" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Launch Board</h1>
            <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">What to post today, where everything stands, and your whole Dropbox library one click from a card.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {[{ n: counts.total, l: "Cards", c: "text-foreground" }, { n: counts.ready, l: "Ready", c: "text-gold" }, { n: counts.posted, l: "Posted", c: "text-emerald-400" }, { n: clips.length.toLocaleString(), l: "Clips indexed", c: "text-foreground" }].map((s) => (
            <div key={s.l} className="min-w-[76px] rounded-xl border border-border bg-card px-3.5 py-2.5">
              <div className={`text-xl font-extrabold tabular-nums ${s.c}`}>{s.n}</div>
              <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.09em] text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </header>

      <nav className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === t.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">{attachTarget ? <>Attaching to <b className="text-foreground">{attachTarget.title}</b> · <button className="underline" onClick={() => setAttachTarget(null)}>cancel</button></> : null}</span>
        <Button asChild size="sm" variant="outline" className="ml-2 h-8"><Link to="/dashboard/content">Queue &amp; approvals</Link></Button>
        <Button size="sm" onClick={openNew} className="ml-2 h-8 bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="mr-1 h-3.5 w-3.5" />New idea</Button>
      </nav>

      {tab === "today" && (
        <div className="space-y-8">
          <section>
            <Head title="Post today" hint={ready.length ? `${ready.length} ready` : "nothing is Ready yet"} />
            {ready.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Move a card to <b className="text-gold">Ready</b> (clip attached + caption written) and it shows up here with a one-tap Post.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">{ready.map((c) => <CardView key={c.id} c={c} />)}</div>
            )}
          </section>
          <section>
            <Head title="Launch 4" hint="one card per job — auto-picked, strongest first" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {launch4.map(({ job, pick }) => (
                <div key={job.k} className={`flex min-h-[150px] flex-col gap-2 rounded-2xl border border-t-[3px] border-border ${job.border} bg-card p-4`}>
                  <div className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${job.accent}`}>{job.label}</div>
                  <div className="text-[11.5px] leading-snug text-muted-foreground">{job.desc}</div>
                  {pick ? (
                    <button onClick={() => openEdit(pick)} className="mt-auto rounded-xl border border-border bg-background/60 p-3 text-left">
                      <div className="text-sm font-bold leading-tight text-foreground">{pick.title}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Chip className={brandClass(pick.brand)}>{pick.brand}</Chip><Chip className={`border-border ${TXT[pick.status as Status]}`}><span className={`h-1.5 w-1.5 rounded-full ${DOT[pick.status as Status]}`} />{pick.status}</Chip></div>
                    </button>
                  ) : <div className="mt-auto rounded-xl border border-dashed border-border p-3 text-center text-[12px] text-muted-foreground">No card for {job.label} yet.</div>}
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <Head title="Record next" hint="ideas, earliest day first" />
              <ol className="space-y-2">
                {recordNext.length === 0 && <li className="text-sm text-muted-foreground">No ideas queued — add one.</li>}
                {recordNext.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                    <span className="w-5 text-center text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                    <button onClick={() => openEdit(c)} className="min-w-0 flex-1 text-left text-sm font-semibold text-foreground">{c.title}</button>
                    {c.day > 0 && <Chip className="border-border text-muted-foreground">Day {c.day}</Chip>}
                    <Button size="sm" onClick={() => advance(c)} className="h-7 bg-primary px-2.5 text-[11.5px] text-primary-foreground hover:bg-primary/90">Recorded</Button>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <Head title="Needs a clip" hint={`${needsClip.length}`} />
              <ul className="space-y-2">
                {needsClip.length === 0 && <li className="text-sm text-muted-foreground">Every open card has a clip.</li>}
                {needsClip.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                    <Clapperboard className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.title}</span>
                    <Button size="sm" variant="outline" onClick={() => { setAttachTarget(c); setTab("library"); }} className="h-7 px-2.5 text-[11.5px]"><Paperclip className="mr-1 h-3 w-3" />Pick a clip</Button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === "board" && (
        <div className="grid items-start gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {STATUSES.map((st) => {
            const items = cards.filter((c) => c.status === st);
            return (
              <div key={st} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between px-0.5 pt-0.5">
                  <span className={`flex items-center gap-2 text-[12.5px] font-extrabold uppercase tracking-wide ${TXT[st]}`}><span className={`h-1.5 w-1.5 rounded-full ${DOT[st]}`} />{STATUS_LABEL[st]}</span>
                  <span className="text-[11px] text-muted-foreground">{items.length} · {STATUS_SUB[st]}</span>
                </div>
                {items.map((c) => <CardView key={c.id} c={c} />)}
                {st === "idea" && <Button variant="outline" onClick={openNew} className="border-dashed text-muted-foreground hover:border-gold/50 hover:text-gold"><Plus className="mr-1.5 h-4 w-4" />New idea</Button>}
              </div>
            );
          })}
        </div>
      )}

      {tab === "week" && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
            const items = cards.filter((c) => c.day === d);
            return (
              <div key={d} className={`flex min-h-[140px] flex-col gap-1.5 rounded-xl border bg-card p-2.5 ${d === 1 ? "border-gold/50" : "border-border"}`}>
                <div className="flex items-baseline justify-between"><span className={`text-[12px] font-extrabold tracking-wide ${d === 1 ? "text-gold" : "text-muted-foreground"}`}>DAY {d}</span><span className="text-[9px] uppercase tracking-wide text-muted-foreground">{d === 1 ? "launch" : items.length}</span></div>
                {items.length === 0 ? <span className="mt-auto text-[10px] text-muted-foreground">—</span> : items.map((c) => (
                  <button key={c.id} onClick={() => openEdit(c)} className={`rounded-lg border border-l-[3px] border-border bg-background/50 p-2 text-left ${c.status === "recorded" ? "border-l-sky-400" : c.status === "ready" ? "border-l-gold" : c.status === "posted" ? "border-l-emerald-400" : "border-l-zinc-500"}`}>
                    <div className="text-[11.5px] font-semibold leading-tight text-foreground">{c.title.replace(/^Story · /, "")}</div>
                    <div className="mt-1 flex items-center gap-1.5"><Chip className={brandClass(c.brand)}>{c.brand}</Chip><span className={`h-1.5 w-1.5 rounded-full ${DOT[c.status as Status]}`} /></div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === "library" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by what\u2019s in the clip — desk, drone, gym, car, event…" className="pl-8" />
            </div>
            {(["all", "YouTube", "Reels"] as const).map((f) => (
              <button key={f} onClick={() => setFolder(f)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${folder === f ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "All" : f === "YouTube" ? "YouTube · horizontal" : "Reels · vertical"}
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
            <span className="w-full text-xs text-muted-foreground">{visibleClips.length.toLocaleString()} match · {clips.filter((k) => k.thumb_url).length.toLocaleString()} with previews</span>
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
                <a href={dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer" className={`relative block bg-muted/40 ${k.kind === "vertical" ? "aspect-[9/16] max-h-64" : "aspect-video"}`} title="Open in Dropbox">
                  {k.thumb_url ? (
                    <>
                      <img src={k.thumb_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      {k.preview_url && (
                        <video src={k.preview_url} muted loop playsInline preload="none" onMouseEnter={(e) => { void e.currentTarget.play(); }} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-6 w-6" /></div>
                  )}
                  {k.duration_s ? <span className="absolute bottom-1.5 right-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">{fmtDur(k.duration_s)}</span> : null}
                  {k.used_by_card && <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-950">on a card</span>}
                  {k.banger_score != null && (
                    <span className={`absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums text-zinc-950 ${bangerColor(k.banger_score)}`} title={k.banger_reason ?? "traction potential"}>🔥 {k.banger_score}</span>
                  )}
                </a>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <div className="line-clamp-2 text-sm font-bold leading-snug text-foreground">{k.hook_title || k.title || cleanName(k.name)}</div>
                  {k.banger_score != null && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${bangerColor(k.banger_score)}`} style={{ width: `${k.banger_score}%` }} /></div>
                      <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{k.banger_score}</span>
                    </div>
                  )}
                  {k.hook_title && <button onClick={() => { void navigator.clipboard?.writeText(k.hook_title ?? "").then(() => toast.success("Hook copied")).catch(() => toast.error("Clipboard blocked")); }} className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline">copy hook</button>}
                  <div className="flex flex-wrap gap-1">
                    {PILLARS.map((p) => {
                      const on = pillarsOf(k).includes(p.k);
                      return (
                        <button key={p.k} title={on ? `Tagged ${p.label}` : `Tag as ${p.label}`} onClick={() => void togglePillar(k, p.k)}
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                          {p.label.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                  {k.tags && k.tags.length > 0 && <div className="flex flex-wrap gap-1">{k.tags.slice(0, 4).map((tg) => <button key={tg} onClick={() => setQuery(tg)} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">{tg}</button>)}</div>}
                  <div className="mt-auto text-[11px] text-muted-foreground">{k.folder} · {fmtDate(k.modified_at)} · {fmtSize(k.size_bytes)}</div>
                  <div className="flex gap-1.5">
                    {attachTarget
                      ? <Button size="sm" onClick={() => attachClip(k, attachTarget)} className="h-7 flex-1 bg-primary px-2.5 text-[11.5px] text-primary-foreground hover:bg-primary/90"><Paperclip className="mr-1 h-3 w-3" />Attach</Button>
                      : <Button size="sm" variant="outline" onClick={() => cardFromClip(k)} className="h-7 flex-1 px-2.5 text-[11.5px]"><Plus className="mr-1 h-3 w-3" />New card</Button>}
                    {directUrl(k)
                      ? <Button asChild size="sm" className="h-7 bg-emerald-500/15 px-2.5 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-500/25"><a href={directUrl(k) ?? undefined} download={k.name} title="Download the original — one click"><Download className="mr-1 h-3.5 w-3.5" />Download</a></Button>
                      : <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"><a href={dropboxUrl(k.path)} target="_blank" rel="noopener noreferrer" title="Open in Dropbox"><ExternalLink className="h-3.5 w-3.5" /></a></Button>}
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

      <p className="pt-10 text-center text-xs leading-relaxed text-muted-foreground">Saves to your account on every change. Publishing stays in your hands — Post copies the caption and stamps the date.</p>

      {/* Post dialog */}
      <Dialog open={!!postTarget} onOpenChange={(o) => !o && setPostTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Post: {postTarget?.title}</DialogTitle></DialogHeader>
          {postTarget && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-1.5"><Chip className={brandClass(postTarget.brand)}>{brandHandle(postTarget.brand)}</Chip>{postTarget.clip && <Chip className="border-sky-400/30 text-sky-300">{postTarget.clip.split("/").pop()}</Chip>}</div>
              <Textarea readOnly rows={6} value={postTarget.caption || "(no caption yet — edit the card to add one)"} className="text-sm" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyCaption(postTarget.caption)} disabled={!postTarget.caption}><Copy className="mr-1.5 h-4 w-4" />Copy caption</Button>
                {postTarget.clip && (() => { const k = clips.find((x) => x.path === postTarget.clip); const d = k ? directUrl(k) : null; return d
                  ? <Button asChild variant="outline"><a href={d} download={k?.name}><Download className="mr-1.5 h-4 w-4" />Download the clip</a></Button>
                  : <Button asChild variant="outline"><a href={dropboxUrl(postTarget.clip)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" />Open clip in Dropbox</a></Button>; })()}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostTarget(null)}>Not yet</Button>
            <Button onClick={() => postTarget && markPosted(postTarget)} className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"><Check className="mr-1.5 h-4 w-4" />I posted it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit card" : "New idea"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="lb-title">Title</Label><Input id="lb-title" value={draftStr("title")} onChange={(e) => setDraftField("title", e.target.value)} placeholder="What's the video?" /></div>
            <div className="grid gap-1.5"><Label htmlFor="lb-hook">Hook / notes</Label><Textarea id="lb-hook" rows={2} value={draftStr("hook")} onChange={(e) => setDraftField("hook", e.target.value)} placeholder="The opening line, or the idea in one sentence" /></div>
            <div className="grid gap-1.5"><Label htmlFor="lb-cap">Caption <span className="text-muted-foreground">(copied when you post)</span></Label><Textarea id="lb-cap" rows={3} value={draftStr("caption")} onChange={(e) => setDraftField("caption", e.target.value)} placeholder="The caption you'll post with" /></div>
            <div className="grid gap-1.5"><Label htmlFor="lb-clip">Clip path <span className="text-muted-foreground">(or pick one in Library)</span></Label><Input id="lb-clip" value={draftStr("clip")} onChange={(e) => setDraftField("clip", e.target.value)} placeholder="Reels/2026/09/clip.mp4" /></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5"><Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Brand</Label>
                <Select value={draftStr("brand")} onValueChange={(v) => setDraftField("brand", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SFD">@sellfordaddy</SelectItem><SelectItem value="IMS">@imakesystems</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Job</Label>
                <Select value={draftStr("job")} onValueChange={(v) => setDraftField("job", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{JOBS.map((j) => <SelectItem key={j.k} value={j.k}>{j.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Day</Label>
                <Select value={draftStr("day")} onValueChange={(v) => setDraftField("day", Number(v))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">—</SelectItem>{[1, 2, 3, 4, 5, 6, 7].map((d) => <SelectItem key={d} value={String(d)}>Day {d}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</Label>
                <Select value={draftStr("status")} onValueChange={(v) => setDraftField("status", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save" : "Add idea"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
