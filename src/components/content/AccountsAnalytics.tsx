// Launch Board → Analytics (Sam 2026-10-06): every post across every account, short vs long,
// purposeful vs not, by content category. YouTube fills itself (apex-youtube-sync.py, every 3h);
// Instagram / TikTok / Facebook posts are logged here with one tap.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimeAgo } from "@/lib/dateUtils";
import { DAY_THEMES, THEME_TONE, WEEKLY_TARGETS, countPieces, phoenixDateKey, phoenixWeekday, piecesByDay } from "@/lib/contentWeek";
import { level, nextMilestone, streak, totalPieces, weekOverWeek } from "@/lib/contentMomentum";

type Post = {
  id: number; platform: string; account: string | null; format: string; category: string | null; title: string | null;
  url: string | null; posted_at: string; views: number | null; likes: number | null; purposeful: boolean | null; source: string; external_id: string | null; thumb_url: string | null; watched_pct: number | null; duration_s: number | null;
};
const PLATFORMS = [
  { k: "youtube", label: "YouTube" }, { k: "instagram", label: "Instagram" }, { k: "tiktok", label: "TikTok" }, { k: "snapchat", label: "Snapchat" }, { k: "facebook", label: "Facebook" },
] as const;
export const CATEGORIES = [
  { k: "fitness", label: "Fitness" }, { k: "cars", label: "Cars" }, { k: "my_life", label: "My Life" },
  { k: "insurance", label: "Insurance" }, { k: "top_of_funnel", label: "Top of Funnel" }, { k: "education", label: "Education" },
] as const;
const SUGGESTED_ACCOUNTS = ["Samuel James", "Fit for Daddy"];
const catLabel = (k: string | null) => CATEGORIES.find((c) => c.k === k)?.label ?? "Untagged";
const platLabel = (k: string) => PLATFORMS.find((p) => p.k === k)?.label ?? k;
// Days are Phoenix days everywhere, so Analytics, Today and the Week tab agree on any device.
const dayKey = (d: Date) => phoenixDateKey(d);
const localDay = (iso: string) => phoenixDateKey(new Date(iso));
const acct = (p: { platform: string; account: string | null }) => `${p.platform}|${(p.account ?? "").trim()}`;
// Many Shorts are literally titled "unknown" on YouTube (vidIQ flagged it); show that plainly.
const showTitle = (t: string | null) => (!t || t.trim().toLowerCase() === "unknown" ? "Untitled Short (no title on YouTube)" : t);
const thumbOf = (p: { platform: string; external_id: string | null; thumb_url?: string | null }) =>
  p.thumb_url || (p.platform === "youtube" && p.external_id ? `https://i.ytimg.com/vi/${p.external_id}/hqdefault.jpg` : null);
// Score 0-100: 50 = this account's normal for this FORMAT (median views over 30 days), 75 = 2x,
// 100 = 4x or better, 25 = half. Long-form is only compared with long-form (a Short-heavy
// baseline scored every long video 0-37), a baseline needs 5+ posts, and a post younger
// than a day has no score yet (hours-old views against a 30-day median always look bad).
type Scored = { platform: string; account: string | null; format: string; views: number | null; posted_at: string };
const scoreKey = (p: Scored) => `${acct(p)}|${p.format}`;
function scorer(posts: Scored[]) {
  const by = new Map<string, number[]>();
  posts.forEach((p) => { if (p.views != null && Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000) { const k = scoreKey(p); by.set(k, [...(by.get(k) ?? []), p.views]); } });
  const med = new Map([...by].filter(([, v]) => v.length >= 5).map(([k, v]) => { const s = [...v].sort((a, b) => a - b); return [k, s[Math.floor(s.length / 2)] || 1]; }));
  return (p: Scored) => {
    const base = med.get(scoreKey(p));
    if (p.views == null || base == null || Date.now() - new Date(p.posted_at).getTime() < 86400_000) return null;
    return Math.max(0, Math.min(100, Math.round(50 + 25 * Math.log2(Math.max(p.views, 1) / base))));
  };
}
const scoreTone = (n: number) => (n >= 80 ? "bg-emerald-500 text-emerald-950" : n >= 50 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground");
const fmtNum = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:border-primary/60"}`}>
      {children}
    </button>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}

function usePosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    // Everything on these pages looks back 30 days. PostgREST answers at most 1000 rows a
    // request, so page until a short page instead of trusting a .limit() it silently caps.
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const all: Post[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("content_posts")
        .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source, external_id, thumb_url, watched_pct, duration_s")
        .gte("posted_at", since).order("posted_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 999);
      if (error) {
        toast.error(`Couldn't load posts: ${error.message.slice(0, 100)}`);
        setFailed(true);
        setLoading(false);
        return;
      }
      all.push(...((data ?? []) as Post[]));
      if (!data || data.length < 1000) break;
    }
    setPosts(all);
    setFailed(false);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { posts, setPosts, loading, failed, load };
}

type Source = { title?: string; channel?: string; views?: number; video_id?: string; url?: string } | null;
export type Idea = { day: number; theme?: string; format?: string; score: number; title: string; why: string; source?: Source };
type Insights = {
  niche?: string; generated_at?: string; rules?: string[]; inspiration?: string[];
  audience?: { summary?: string; segments?: { label: string; pct: number }[]; wants?: string[]; pains?: string[] };
  strategy?: { summary?: string; weekly?: string[] };
  coach?: { start?: string[]; keep?: string[]; stop?: string[]; trends?: { title: string; why?: string; url?: string }[] };
  ideas?: Idea[];
};

function useInsights() {
  const [ins, setIns] = useState<Insights | null>(null);
  useEffect(() => {
    void supabase.from("system_settings").select("value, updated_at").eq("key", "vidiq_insights").maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn("vidiq_insights load failed", error.message); return; }
        try {
          const v = data?.value ? JSON.parse(data.value) as Insights : null;
          // Fall back to the row's updated_at so the page can always say how old the snapshot is.
          setIns(v ? { ...v, generated_at: v.generated_at ?? (data as { updated_at?: string } | null)?.updated_at } : null);
        } catch { setIns(null); }
      });
  }, []);
  return ins;
}

/** "as of Oct 7" for a snapshot, in Phoenix. */
const asOf = (iso?: string) => (iso ? `as of ${new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" })}` : "");

/** Where an idea came from: a small thumbnail + "Inspired by channel · views". */
function SourceLink({ source }: { source?: Source }) {
  if (!source || (!source.title && !source.channel)) return null;
  const inner = (
    <>
      {source.video_id && <img src={`https://i.ytimg.com/vi/${source.video_id}/mqdefault.jpg`} alt="" loading="lazy" className="h-10 w-[72px] shrink-0 rounded object-cover bg-muted" />}
      <span className="min-w-0 text-sm leading-snug text-muted-foreground">
        <span className="block truncate">Inspired by <b className="text-foreground">{source.channel ?? "a top video"}</b>{source.views != null ? ` · ${fmtNum(source.views)} views` : ""}</span>
        {source.title && <span className="block truncate">{source.title}</span>}
      </span>
    </>
  );
  return source.url
    ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 p-1.5 hover:bg-muted/70">{inner}</a>
    : <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 p-1.5">{inner}</div>;
}

function IdeaRow({ idea, onPick, busy, top }: { idea: Idea; onPick?: (idea: Idea) => void; busy?: boolean; top?: boolean }) {
  return (
    <li className={`rounded-xl border bg-background/40 p-4 ${top ? "border-primary/60 bg-primary/5" : "border-border"}`}>
      {top && <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-primary">★ Top pick — film this next</div>}
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${scoreTone(idea.score)}`} title="Editorial priority, 0–100; not a prediction of views">{idea.score}</span>
        <div className="min-w-0">
          <div className="text-base font-semibold leading-snug text-foreground">
            {idea.format && <span className="mr-2 rounded border border-border px-1.5 py-0.5 align-middle text-[13px] font-semibold text-muted-foreground">{idea.format}</span>}{idea.title}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{idea.why}</div>
        </div>
      </div>
      <SourceLink source={idea.source} />
      {onPick && <Button className="mt-3" disabled={busy} onClick={() => onPick(idea)}>Film this</Button>}
    </li>
  );
}

const sortIdeas = (a: Idea, b: Idea) => (a.format === b.format ? 0 : a.format === "Long" ? -1 : 1) || b.score - a.score;

type YtStats = { subs: number | null; long: number | null; short: number | null; weekDelta: number | null };
/** Live YouTube channel stats from the 3-hourly sync: current subscribers + the whole-channel long-form /
 *  Shorts counts, plus the subscriber change over the last 7 days read from the daily history snapshot
 *  (youtube_stats_history). Anything missing stays null — never a fake 0 or a made-up delta. */
function useYtStats(): YtStats {
  const [st, setSt] = useState<YtStats>({ subs: null, long: null, short: null, weekDelta: null });
  useEffect(() => {
    void (async () => {
      const cur = await supabase.from("system_settings").select("value").eq("key", "youtube_channel_stats").maybeSingle();
      let subs: number | null = null, long: number | null = null, short: number | null = null;
      try {
        const v = cur.data?.value ? JSON.parse(cur.data.value) : null;
        subs = typeof v?.subscribers === "number" ? v.subscribers : null;
        long = typeof v?.long_videos === "number" ? v.long_videos : null;
        short = typeof v?.shorts === "number" ? v.shorts : null;
      } catch { /* empty-catch-allow:stats-parse — keep the null defaults; the sync rewrites valid stats on its next run */ }
      let weekDelta: number | null = null;
      const h = await supabase.from("system_settings").select("value").eq("key", "youtube_stats_history").maybeSingle();
      try {
        const hist = h.data?.value ? JSON.parse(h.data.value) : [];
        if (Array.isArray(hist) && subs != null) {
          const cutoff = Date.now() - 7 * 86400_000;
          // The most recent snapshot that is already at least 7 days old; null until the history is that deep.
          const old = [...hist].reverse().find((x) => x?.d && new Date(`${x.d}T00:00:00Z`).getTime() <= cutoff && typeof x.subscribers === "number");
          if (old) weekDelta = subs - old.subscribers;
        }
      } catch { /* empty-catch-allow:no-history-yet — weekDelta stays null until the history snapshot is readable + deep enough */ }
      setSt({ subs, long, short, weekDelta });
    })();
  }, []);
  return st;
}

/** A small up/down/flat delta chip. Hidden when there's no honest comparison (prior window empty). */
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const tone = pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-muted-foreground";
  return <span className={`text-sm font-bold tabular-nums ${tone}`}>{pct > 0 ? "↑" : pct < 0 ? "↓" : "→"} {Math.abs(pct)}%</span>;
}

/** The momentum header for the Today tab: the streak you don't want to break, the climb to the next
 *  subscriber milestone, a creator level that ticks up with every upload, and honest week-over-week.
 *  Every number is real (from the posts already loaded + the live sub count); anything we can't
 *  compute honestly is hidden rather than faked. */
export function MomentumStrip({ posts, yt }: { posts: Post[]; yt: YtStats }) {
  const s = useMemo(() => streak(posts), [posts]);
  // Long-form only — Shorts post daily, so an all-YouTube streak just mirrors the main one. This is the
  // lever Sam cares about: a long-form streak, and days-since when he's lapsed (last long-form was weeks ago).
  const ytS = useMemo(() => streak(posts.filter((p) => p.platform === "youtube" && p.format === "long")), [posts]);
  const lv = useMemo(() => level(totalPieces(posts)), [posts]);
  const ms = useMemo(() => nextMilestone(yt.subs), [yt.subs]);
  const wow = useMemo(() => weekOverWeek(posts), [posts]);
  const broken = s.days === 0 && s.missed > 0;
  const bannerTone = broken ? "border-red-400/50 bg-red-400/10" : s.atRisk ? "border-amber-400/50 bg-amber-400/10" : s.days > 0 ? "border-primary/40 bg-primary/5" : "border-border bg-card";
  const statusLine = broken ? `You haven't posted in ${s.missed} day${s.missed === 1 ? "" : "s"}. Post one to reset it to zero.`
    : s.days === 0 ? "Post one video today and start the streak."
    : s.alive ? "Posted today — don't break the chain."
    : "Post today to keep the streak alive.";
  // A streak that is live shows its length; a broken one shows the days-not-posted as a negative.
  const streakNum = (x: { days: number; missed: number }) => (x.days > 0 ? String(x.days) : x.missed > 0 ? `−${x.missed}` : "0");
  const bar = (frac: number) => <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(frac * 100))}%` }} /></div>;
  return (
    <section aria-label="Your momentum" className="flex flex-col gap-4">
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border p-4 ${bannerTone}`}>
        <div className="flex items-center gap-4">
          <div className="text-4xl leading-none" aria-hidden>{broken ? "❄️" : "🔥"}</div>
          <div className="min-w-0">
            <div className={`text-3xl font-extrabold tabular-nums leading-none ${broken ? "text-red-400" : "text-foreground"}`}>{broken ? `−${s.missed}` : s.days}<span className="ml-1.5 text-base font-bold text-muted-foreground">{broken ? `day${s.missed === 1 ? "" : "s"} no post` : `day${s.days === 1 ? "" : "s"} in a row`}</span></div>
            <div className={`mt-1 text-sm font-semibold ${broken ? "text-red-400" : s.atRisk ? "text-amber-400" : "text-primary"}`}>{statusLine}</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-xl border border-border bg-background/50 px-3 py-1.5 text-center"><span className="block text-lg font-extrabold tabular-nums text-foreground">{streakNum(ytS)}</span><span className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">YT long-form streak</span></span>
          <span className="rounded-xl border border-border bg-background/50 px-3 py-1.5 text-center"><span className="block text-lg font-extrabold tabular-nums text-foreground">Lvl {lv.level}</span><span className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{lv.next == null ? "max" : `${lv.span - lv.into} to next`}</span></span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-muted-foreground">YouTube subscribers</span>
            {yt.weekDelta != null && yt.weekDelta !== 0 && <span className={`text-sm font-bold tabular-nums ${yt.weekDelta > 0 ? "text-emerald-400" : "text-red-400"}`}>{yt.weekDelta > 0 ? "↑" : "↓"} {fmtNum(Math.abs(yt.weekDelta))} / wk</span>}
          </div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-foreground">{yt.subs != null ? fmtNum(yt.subs) : "—"}</div>
          {ms ? (<>{bar(ms.pct / 100)}<div className="mt-1 text-[13px] font-semibold text-primary">{fmtNum(ms.remaining)} to {fmtNum(ms.next)}</div></>) : <div className="mt-2 text-[13px] text-muted-foreground">updates every 3 hours</div>}
          {(yt.long != null || yt.short != null) && <div className="mt-2 border-t border-border/60 pt-2 text-[13px] text-muted-foreground"><b className="tabular-nums text-foreground">{yt.long ?? "—"}</b> long-form · <b className="tabular-nums text-foreground">{yt.short ?? "—"}</b> Shorts on YouTube</div>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-muted-foreground">Long-form this week</span><Delta pct={wow.long.deltaPct} /></div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-foreground">{wow.long.now}</div>
          {bar(wow.long.now / WEEKLY_TARGETS.long)}
          <div className="mt-1 text-[13px] text-muted-foreground">goal {WEEKLY_TARGETS.long}/wk · last week {wow.long.prev}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-muted-foreground">Shorts this week</span><Delta pct={wow.short.deltaPct} /></div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-foreground">{wow.short.now}</div>
          {bar(wow.short.now / WEEKLY_TARGETS.shortsMin)}
          <div className="mt-1 text-[13px] text-muted-foreground">goal {WEEKLY_TARGETS.shortsMin}–{WEEKLY_TARGETS.shortsMax}/wk · last week {wow.short.prev}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-muted-foreground">Views this week</span><Delta pct={wow.views.deltaPct} /></div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-foreground">{fmtNum(wow.views.now)}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">last week {fmtNum(wow.views.prev)}</div>
        </div>
      </div>
    </section>
  );
}

/** Today tab: what today is for, and exactly what to make (with where each idea came from). */
export function ContentHome({ onOpenAnalytics, onPick, picking }: { onOpenAnalytics: () => void; onPick?: (idea: Idea) => void; picking?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { posts } = usePosts();
  const yt = useYtStats();
  const ins = useInsights();
  const wd = phoenixWeekday();
  const t = DAY_THEMES[wd];
  const tone = THEME_TONE[t.theme];
  const todayKey = phoenixDateKey();
  // Repurpose posts one Short to every platform: count pieces as the busiest platform today, not the sum.
  const shortsToday = useMemo(() => piecesByDay(posts, "short")[todayKey] ?? 0, [posts, todayKey]);
  const showDay = wd === 7 ? 1 : wd;
  const ideas = useMemo(() => [...(ins?.ideas ?? [])].sort((a, b) => (a.format === b.format ? 0 : a.format === "Long" ? -1 : 1) || Number(b.day === showDay) - Number(a.day === showDay) || b.score - a.score), [ins, showDay]);
  const pct = t.shortsTarget > 0 ? Math.min(100, Math.round((shortsToday / t.shortsTarget) * 100)) : 0;
  return (
    <div className="flex flex-col gap-6">
      <MomentumStrip posts={posts} yt={yt} />
      <section aria-label="Today's plan" className={`rounded-xl border bg-card p-4 ${tone.ring}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">Today · {t.name}</h2>
          <span className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold ${tone.chip}`}>{t.themeLabel}: {t.angle}</span>
        </div>
        {t.longForm && <p className="mt-2 text-sm text-foreground"><b>Long-form:</b> <span className="text-muted-foreground">{t.longForm}</span></p>}
        {t.shortsTarget > 0 ? (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-foreground">{shortsToday}/{t.shortsTarget} Shorts posted</span><span className="text-sm text-muted-foreground">{t.shorts}</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} /></div>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">{t.shorts}</p>}
      </section>

      <section aria-label="Make today" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-bold text-foreground">{showAll ? "All video ideas" : "Pick a video to film"}</h2>
          <button type="button" onClick={onOpenAnalytics} className="ml-auto text-sm font-semibold text-primary hover:underline">See what's working →</button>
        </div>
        {ideas.length === 0
          ? <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No ideas queued for this day yet.</div>
          : <ol className="flex flex-col gap-3">{(showAll ? ideas : ideas.slice(0, 3)).map((idea, i) => <IdeaRow key={`${idea.format}-${idea.title}`} idea={idea} onPick={onPick} busy={picking} top={!showAll && i === 0} />)}</ol>}
        {ideas.length > 3 && <Button variant="outline" onClick={() => setShowAll(!showAll)}>{showAll ? "Back to three choices" : `See all ${ideas.length} ideas`}</Button>}
      </section>
    </div>
  );
}

/** One-line counter for the Today tab. */
export function PostedTodayStrip({ onOpen }: { onOpen: () => void }) {
  const { posts } = usePosts();
  const today = dayKey(new Date());
  const t = posts.filter((p) => localDay(p.posted_at) === today);
  const week = posts.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 7 * 86400_000);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-sm text-foreground"><b className="text-lg tabular-nums">{countPieces(t, "short") + countPieces(t, "long")}</b> posted today
        <span className="text-muted-foreground"> · {countPieces(t, "short")} short · {countPieces(t, "long")} long · {countPieces(week, "short") + countPieces(week, "long")} this week</span></span>
      <Button size="sm" variant="outline" onClick={onOpen} className="ml-auto h-8">Log a post / Analytics</Button>
    </div>
  );
}

export default function AccountsAnalytics() {
  const { posts, setPosts, loading, failed, load: reloadPosts } = usePosts();
  const ins = useInsights();
  const [logOpen, setLogOpen] = useState(false);
  const [platform, setPlatform] = useState<string>("instagram");
  const [account, setAccount] = useState<string>("Fit for Daddy");
  const [format, setFormat] = useState<"short" | "long">("short");
  const [category, setCategory] = useState<string | null>(null);
  const [purposeful, setPurposeful] = useState<boolean>(true);
  const [title, setTitle] = useState("");
  const [views, setViews] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [sort, setSort] = useState<"new" | "views">("new");
  const [yt, setYt] = useState<{ subscribers?: number; at?: string } | null>(null);

  useEffect(() => {
    void supabase.from("system_settings").select("value").eq("key", "youtube_channel_stats").maybeSingle()
      .then(({ data }) => { try { setYt(data?.value ? JSON.parse(data.value) : null); } catch { setYt(null); } });
  }, []);

  const accounts = useMemo(() => {
    const set = new Set<string>(SUGGESTED_ACCOUNTS);
    posts.forEach((p) => p.account?.trim() && set.add(p.account.trim()));
    return [...set];
  }, [posts]);
  const accountKeys = useMemo(() => [...new Map(posts.map((p) => [acct(p), `${platLabel(p.platform)} · ${p.account?.trim() || "no account"}`])).entries()], [posts]);

  const today = dayKey(new Date());
  const shown = filterAccount === "all" ? posts : posts.filter((p) => acct(p) === filterAccount);
  const todayPosts = shown.filter((p) => localDay(p.posted_at) === today);
  const week = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 7 * 86400_000);
  const month = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);
  const views30 = month.reduce((n, p) => n + (p.views ?? 0), 0);
  const [gridLimit, setGridLimit] = useState(24);
  const recent30 = useMemo(() => {
    const recent = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);
    return sort === "views" ? [...recent].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)) : recent;
  }, [shown, sort]);
  const grid = useMemo(() => recent30.slice(0, gridLimit), [recent30, gridLimit]);

  // 14 Phoenix days. A Short counts once per day (busiest platform), like every other count here.
  const days = useMemo(() => {
    const shortBy = piecesByDay(shown, "short");
    const longBy = piecesByDay(shown, "long");
    const [y, m, d] = phoenixDateKey().split("-").map(Number);
    return Array.from({ length: 14 }, (_, i) => {
      const k = new Date(Date.UTC(y, m - 1, d) - (13 - i) * 86400_000).toISOString().slice(0, 10);
      const label = new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
      return { k, label, short: shortBy[k] ?? 0, long: longBy[k] ?? 0 };
    });
  }, [shown]);
  const maxDay = Math.max(1, ...days.map((d) => d.short + d.long));

  const logPost = async () => {
    if (!account.trim()) { toast.error("Pick or type the account"); return; }
    const viewsNum = views.trim() ? Math.max(0, Math.round(Number(views.replace(/[,\s]/g, "")))) : null;
    if (views.trim() && !Number.isFinite(viewsNum)) { toast.error("Views must be a number"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("content_posts")
      .insert({ platform, account: account.trim(), format, category, purposeful, title: title.trim() || null, url: url.trim() || null, views: viewsNum, stats_at: viewsNum != null ? new Date().toISOString() : null, source: "manual" })
      .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source, external_id, thumb_url, watched_pct, duration_s").single();
    setSaving(false);
    if (error || !data) { toast.error(`Couldn't log it: ${error?.message.slice(0, 100) ?? "not saved"}`); return; }
    setPosts((ps) => [data as Post, ...ps]); setTitle(""); setViews(""); setUrl(""); setLogOpen(false);
    toast.success(`Logged: ${platLabel(platform)} ${format} · ${account.trim()}${viewsNum != null ? ` · ${fmtNum(viewsNum)} views` : ""}`);
  };

  const thumb = (p: Post) => thumbOf(p);
  const score = useMemo(() => scorer(posts), [posts]);
  const ago = (iso: string) => formatTimeAgo(iso);
  const realTitle = (t: string | null) => (t && t.trim().toLowerCase() !== "unknown" ? t : null);

  // "What's working": plain-sentence comparisons of medians over the last 30 days (only when both groups have 5+ posts).
  const insightCards = useMemo(() => {
    const rows = posts.filter((p) => p.views != null && Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);
    const med = (xs: Post[]) => { const s = xs.map((p) => p.views ?? 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const cards: { ratio: number; text: string }[] = [];
    const cmp = (a: Post[], b: Post[], text: (r: number, ma: number, mb: number) => string) => {
      if (a.length < 5 || b.length < 5) return;
      const ma = med(a), mb = med(b);
      if (ma <= 0 || mb <= 0) return;
      const r = ma / mb;
      if (r >= 1.3) cards.push({ ratio: r, text: text(r, ma, mb) });
      else if (r <= 1 / 1.3) cards.push({ ratio: 1 / r, text: text(r, ma, mb) });
    };
    const x = (r: number) => `${(r >= 1 ? r : 1 / r).toFixed(1)}x`;
    const reels = rows.filter((p) => p.format === "short" && p.duration_s != null);
    cmp(reels.filter((p) => (p.duration_s ?? 0) <= 12), reels.filter((p) => (p.duration_s ?? 0) > 12),
      (r) => r >= 1 ? `Shorts 12 seconds or under get ${x(r)} the views of longer ones.` : `Shorts over 12 seconds get ${x(r)} the views of the very short ones.`);
    const shorts = rows.filter((p) => p.format === "short");
    const untitled = (p: Post) => !p.title || p.title.trim().toLowerCase() === "unknown";
    cmp(shorts.filter((p) => !untitled(p)), shorts.filter(untitled),
      (r) => r >= 1 ? `Shorts with a real title get ${x(r)} the views of untitled ones.` : `Untitled Shorts are beating titled ones by ${x(r)}.`);
    const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", hour: "numeric", hour12: false }).format(new Date(iso))) % 24;
    const eve = rows.filter((p) => { const h = hourOf(p.posted_at); return h >= 18 && h < 22; });
    cmp(eve, rows.filter((p) => { const h = hourOf(p.posted_at); return h < 18 || h >= 22; }),
      (r) => r >= 1 ? `Evening posts (6 to 10 pm) get ${x(r)} the views of other times.` : `Posts outside 6 to 10 pm get ${x(r)} the views of evening posts.`);
    cmp(rows.filter((p) => p.platform === "instagram" && p.format === "short"), rows.filter((p) => p.platform === "youtube" && p.format === "short"),
      (r) => r >= 1 ? `Instagram reels average ${x(r)} the views of your YouTube Shorts.` : `YouTube Shorts average ${x(r)} the views of your Instagram reels.`);
    return cards.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
  }, [posts]);
  const weekScored = useMemo(() => posts.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 7 * 86400_000 && p.views != null), [posts]);
  const winnersShort = useMemo(() => weekScored.filter((p) => p.format === "short").sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0) || (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [weekScored, score]);
  const winnersLong = useMemo(() => weekScored.filter((p) => p.format === "long").sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0) || (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [weekScored, score]);
  const ideasByDay = useMemo(() => [1, 2, 3, 4, 5, 6].map((d) => ({ d, items: (ins?.ideas ?? []).filter((i) => i.day === d).sort(sortIdeas) })).filter((g) => g.items.length > 0), [ins]);
  const coach = ins?.coach;
  const coachCols: { k: "start" | "keep" | "stop"; label: string; tone: string }[] = [
    { k: "start", label: "Start", tone: "text-emerald-400" }, { k: "keep", label: "Keep", tone: "text-primary" }, { k: "stop", label: "Stop", tone: "text-red-400" },
  ];
  const aud = ins?.audience;
  const winnerCard = (p: Post, rank: number) => { const tb = thumb(p); const sc = score(p); return (
    <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-1 hover:bg-muted/40">
      <div className={`relative overflow-hidden rounded-lg bg-muted ${p.format === "long" ? "aspect-video" : "aspect-[9/16]"}`}>
        {tb ? <img src={tb} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[13px] font-bold text-foreground">#{rank + 1} · {platLabel(p.platform)}</span>
        {sc != null && <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-sm font-bold ${scoreTone(sc)}`}>{sc}</span>}
      </div>
      <div className="mt-2 text-lg font-bold tabular-nums text-foreground">{fmtNum(p.views ?? 0)} <span className="text-sm font-normal text-muted-foreground">views</span></div>
      <div className="text-sm text-muted-foreground">{p.account?.trim()}{p.watched_pct != null ? ` · ${Math.round(p.watched_pct)}% watched` : ""}</div>
    </a>
  ); };

  return (
    <div className="flex flex-col gap-6">
      {failed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          Couldn't load your posts, so the numbers below are not real yet.
          <button type="button" onClick={() => void reloadPosts()} className="rounded-full border border-border px-3 py-1 font-semibold hover:border-primary/60">Retry</button>
        </div>
      )}
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Posted today" value={loading || failed ? "…" : String(countPieces(todayPosts, "short") + countPieces(todayPosts, "long"))} sub={`${countPieces(todayPosts, "short")} short · ${countPieces(todayPosts, "long")} long · ${todayPosts.length} platform posts`} />
        <Stat label="Last 7 days" value={loading || failed ? "…" : String(countPieces(week, "short") + countPieces(week, "long"))} sub={`${countPieces(week, "short")} short · ${countPieces(week, "long")} long · ${week.length} platform posts`} />
        <Stat label="Views, 30 days" value={loading || failed ? "…" : fmtNum(views30)} sub={`${month.length} posts`} />
        <Stat label="YouTube subs" value={yt?.subscribers != null ? fmtNum(yt.subscribers) : "—"} sub="updates every 3 hours" />
      </section>

      <section aria-label="What's working" className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-foreground">What's working</h2>
        {insightCards.length === 0
          ? <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{loading ? "Loading…" : "Not enough posts yet to compare. Keep posting; patterns show up at about 5 posts per group."}</div>
          : <div className="grid gap-3 sm:grid-cols-2">{insightCards.map((c) => (
              <div key={c.text} className="rounded-lg border border-primary/30 bg-card p-4 text-base font-semibold leading-snug text-foreground">{c.text}</div>
            ))}</div>}
      </section>

      <section aria-label="Winners this week" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-bold text-foreground">Winners this week</h2>
          <span className="text-sm text-muted-foreground">score 50 = your normal, 75 = double, 100 = 4x</span>
        </div>
        {weekScored.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{loading ? "Loading…" : "No posts with views this week yet."}</div> : (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Shorts</h3>
              {winnersShort.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No Shorts with views this week yet.</div>
                : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{winnersShort.map(winnerCard)}</div>}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Long-form</h3>
              {winnersLong.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No long-form with views this week yet.</div>
                : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{winnersLong.map(winnerCard)}</div>}
            </div>
          </div>
        )}
      </section>

      {coach && (
        <section aria-label="Coach" className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-foreground">Coach <span className="text-sm font-normal text-muted-foreground">{asOf(ins?.generated_at)}</span></h2>
          <div className="grid gap-3 md:grid-cols-3">
            {coachCols.map((c) => (
              <div key={c.k} className="rounded-lg border border-border bg-card p-4">
                <div className={`text-sm font-bold uppercase tracking-wide ${c.tone}`}>{c.label}</div>
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground">{(coach[c.k] ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
          {(coach.trends?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-sm font-bold text-foreground">Trends in your niche</div>
              <ul className="mt-2 flex flex-col gap-2.5">
                {coach.trends!.map((tr) => (
                  <li key={tr.title} className="text-sm">
                    {tr.url ? <a href={tr.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">{tr.title}</a> : <span className="font-semibold text-foreground">{tr.title}</span>}
                    {tr.why && <span className="block text-muted-foreground">{tr.why}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {ideasByDay.length > 0 && (
        <section aria-label="Ideas for this week" className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-foreground">Ideas for this week <span className="text-sm font-normal text-muted-foreground">{asOf(ins?.generated_at)}</span></h2>
          {ideasByDay.map(({ d, items }) => { const dt = DAY_THEMES[d]; return (
            <div key={d} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-foreground">{dt.name}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold ${THEME_TONE[dt.theme].chip}`}>{dt.themeLabel}: {dt.angle}</span>
              </div>
              <ol className="grid gap-3 lg:grid-cols-2">{items.map((idea) => <IdeaRow key={`${idea.format}-${idea.title}`} idea={idea} />)}</ol>
            </div>
          ); })}
        </section>
      )}

      {ins && (ins.niche || aud || ins.strategy) && (
        <section aria-label="Your niche and audience" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-bold text-foreground">Your niche & audience</h2>
          {ins.niche && <p className="text-sm text-foreground">{ins.niche}</p>}
          {aud?.summary && <p className="text-sm text-muted-foreground">{aud.summary}</p>}
          {(aud?.segments?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-2">
              {aud!.segments!.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm"><span className="text-foreground">{s.label}</span><span className="tabular-nums text-muted-foreground">{s.pct}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {(aud?.wants?.length ?? 0) > 0 && <div><div className="text-sm font-bold text-foreground">They want</div><ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{aud!.wants!.map((w) => <li key={w}>{w}</li>)}</ul></div>}
            {(aud?.pains?.length ?? 0) > 0 && <div><div className="text-sm font-bold text-foreground">They struggle with</div><ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{aud!.pains!.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          </div>
          {ins.strategy && (
            <div>
              <div className="text-sm font-bold text-foreground">Strategy</div>
              {ins.strategy.summary && <p className="mt-1 text-sm text-muted-foreground">{ins.strategy.summary}</p>}
              {(ins.strategy.weekly?.length ?? 0) > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{ins.strategy.weekly!.map((w) => <li key={w}>{w}</li>)}</ul>}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Pill on={filterAccount === "all"} onClick={() => setFilterAccount("all")}>All accounts</Pill>
        {accountKeys.map(([k, label]) => <Pill key={k} on={filterAccount === k} onClick={() => setFilterAccount(k)}>{label}</Pill>)}
        <Button size="sm" onClick={() => setLogOpen(!logOpen)} className="ml-auto h-9 bg-primary px-4 text-primary-foreground hover:bg-primary/90">{logOpen ? "Close" : "+ Log a post (IG / TikTok / Snapchat / FB)"}</Button>
      </div>

      {logOpen && (
        <section aria-label="Log a post" className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-card p-4">
          <div className="flex flex-wrap gap-2">{PLATFORMS.map((p) => <Pill key={p.k} on={platform === p.k} onClick={() => setPlatform(p.k)}>{p.label}</Pill>)}</div>
          <div className="flex flex-wrap items-center gap-2">
            {accounts.map((a) => <Pill key={a} on={account === a} onClick={() => setAccount(a)}>{a}</Pill>)}
            <Input value={accounts.includes(account) ? "" : account} onChange={(e) => setAccount(e.target.value)} placeholder="Other account…" className="h-9 w-44" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill on={format === "short"} onClick={() => setFormat("short")}>Short</Pill>
            <Pill on={format === "long"} onClick={() => setFormat("long")}>Long-form</Pill>
            <span className="mx-1 w-px self-stretch bg-border" />
            <Pill on={purposeful} onClick={() => setPurposeful(true)}>Purposeful</Pill>
            <Pill on={!purposeful} onClick={() => setPurposeful(false)}>Just posting</Pill>
          </div>
          <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => <Pill key={c.k} on={category === c.k} onClick={() => setCategory(category === c.k ? null : c.k)}>{c.label}</Pill>)}</div>
          <div className="flex flex-wrap gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title or hook (optional)" className="h-10 min-w-[200px] flex-1" />
            <Input value={views} onChange={(e) => setViews(e.target.value)} inputMode="numeric" placeholder="Views (optional)" className="h-10 w-36" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional)" className="h-10 min-w-[160px] flex-1" />
            <Button onClick={() => void logPost()} disabled={saving} className="h-10 bg-primary px-6 text-primary-foreground hover:bg-primary/90">{saving ? "Saving…" : "Log it"}</Button>
          </div>
        </section>
      )}

      <section aria-label="Posts per day" className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-4 text-sm"><b className="text-foreground">Posts per day</b>
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-3 w-3 rounded-sm bg-primary" />short</span>
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-3 w-3 rounded-sm bg-sky-400" />long</span></div>
        <div className="flex h-40 items-end gap-1.5">
          {days.map((d) => (
            <div key={d.k} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.short} short, ${d.long} long`}>
              <span className="text-sm tabular-nums text-foreground">{d.short + d.long || ""}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm" style={{ height: Math.max(2, Math.round(((d.short + d.long) / maxDay) * 96)) }}>
                <div className="bg-sky-400" style={{ flex: d.long }} /><div className="bg-primary" style={{ flex: d.short }} />
              </div>
              <span className="text-[13px] text-muted-foreground">{new Date(`${d.k}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</span>
            </div>
          ))}
        </div>
      </section>

      <details aria-label="Your videos" className="group flex flex-col gap-3">
        <summary className="cursor-pointer text-base font-bold text-foreground">Recent posts ({grid.length} of {recent30.length}, last 30 days)</summary>
        <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-foreground">Your posts, last 30 days</h2>
          <span className="ml-auto" />
          <Pill on={sort === "new"} onClick={() => setSort("new")}>Newest</Pill>
          <Pill on={sort === "views"} onClick={() => setSort("views")}>Most viewed</Pill>
        </div>
        {grid.length === 0 && <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">{loading ? "Loading…" : "Nothing in the last 30 days yet."}</div>}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {grid.map((p) => {
            const t = thumb(p);
            const inner = (
              <>
                <div className={`relative overflow-hidden rounded-lg bg-muted ${p.format === "short" ? "aspect-[9/16]" : "aspect-video"}`}>
                  {t ? <img src={t} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{platLabel(p.platform)}</div>}
                  <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[13px] font-semibold text-foreground">{platLabel(p.platform)} · {p.format === "short" ? "Short" : "Long"}</span>
                  {score(p) != null && <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[13px] font-bold ${scoreTone(score(p)!)}`} title="50 = your normal, 75 = double, 100 = 4x or better">{score(p)}</span>}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums text-foreground">{p.views != null ? fmtNum(p.views) : "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">views</span></span>
                  <span className="text-sm text-muted-foreground">{ago(p.posted_at)}</span>
                </div>
                {realTitle(p.title) && <div className="line-clamp-2 text-sm text-foreground">{realTitle(p.title)}</div>}
              </>
            );
            return p.url
              ? <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-1 hover:bg-muted/40">{inner}</a>
              : <div key={p.id} className="rounded-lg p-1">{inner}</div>;
          })}
        </div>
        {grid.length < recent30.length && (
          <button type="button" onClick={() => setGridLimit((n) => n + 24)} className="mt-3 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-foreground hover:border-primary/60">
            Show {Math.min(24, recent30.length - grid.length)} more
          </button>
        )}
        </div>
      </details>
    </div>
  );
}
