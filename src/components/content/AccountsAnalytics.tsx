// Launch Board → Analytics (Sam 2026-10-06): every post across every account, short vs long,
// purposeful vs not, by content category. YouTube fills itself (apex-youtube-sync.py, every 3h);
// Instagram / TikTok / Facebook posts are logged here with one tap.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimeAgo } from "@/lib/dateUtils";

type Post = {
  id: number; platform: string; account: string | null; format: string; category: string | null; title: string | null;
  url: string | null; posted_at: string; views: number | null; likes: number | null; purposeful: boolean | null; source: string; external_id: string | null; thumb_url: string | null; watched_pct: number | null;
};
const PLATFORMS = [
  { k: "youtube", label: "YouTube" }, { k: "instagram", label: "Instagram" }, { k: "tiktok", label: "TikTok" }, { k: "facebook", label: "Facebook" },
] as const;
export const CATEGORIES = [
  { k: "fitness", label: "Fitness" }, { k: "cars", label: "Cars" }, { k: "my_life", label: "My Life" },
  { k: "insurance", label: "Insurance" }, { k: "top_of_funnel", label: "Top of Funnel" }, { k: "education", label: "Education" },
] as const;
const SUGGESTED_ACCOUNTS = ["Samuel James", "Fit for Daddy"];
const catLabel = (k: string | null) => CATEGORIES.find((c) => c.k === k)?.label ?? "Untagged";
const platLabel = (k: string) => PLATFORMS.find((p) => p.k === k)?.label ?? k;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localDay = (iso: string) => dayKey(new Date(iso));
const acct = (p: { platform: string; account: string | null }) => `${p.platform}|${(p.account ?? "").trim()}`;
// Many Shorts are literally titled "unknown" on YouTube (vidIQ flagged it); show that plainly.
const showTitle = (t: string | null) => (!t || t.trim().toLowerCase() === "unknown" ? "Untitled Short (no title on YouTube)" : t);
const thumbOf = (p: { platform: string; external_id: string | null; thumb_url?: string | null }) =>
  p.thumb_url || (p.platform === "youtube" && p.external_id ? `https://i.ytimg.com/vi/${p.external_id}/hqdefault.jpg` : null);
// Score 0-100: 50 = this account's normal (its median views over 30 days), 75 = 2x, 100 = 4x or better, 25 = half.
function scorer(posts: { platform: string; account: string | null; views: number | null; posted_at: string }[]) {
  const by = new Map<string, number[]>();
  posts.forEach((p) => { if (p.views != null && Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000) { const k = acct(p); by.set(k, [...(by.get(k) ?? []), p.views]); } });
  const med = new Map([...by].map(([k, v]) => { const s = [...v].sort((a, b) => a - b); return [k, s[Math.floor(s.length / 2)] || 1]; }));
  return (p: { platform: string; account: string | null; views: number | null }) => (p.views == null ? null
    : Math.max(0, Math.min(100, Math.round(50 + 25 * Math.log2(Math.max(p.views, 1) / (med.get(acct(p)) ?? 1))))));
}
const scoreTone = (n: number) => (n >= 80 ? "bg-emerald-500 text-emerald-950" : n >= 50 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground");
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

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
      <div className="text-[13px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[13px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function usePosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const { data, error } = await supabase.from("content_posts")
      .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source, external_id, thumb_url, watched_pct")
      .gte("posted_at", since).order("posted_at", { ascending: false }).limit(2000);
    if (error) toast.error(`Couldn't load posts: ${error.message.slice(0, 100)}`);
    setPosts((data ?? []) as Post[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { posts, setPosts, loading, load };
}

type Insights = { niche: string; rules: string[]; inspiration?: string[]; ideas: { title: string; why: string; score: number; example?: string; format?: string }[]; generated_at: string };

/** Today tab, video-first: this week's winners across accounts + what to make next (vidIQ). */
export function ContentHome({ onOpenAnalytics }: { onOpenAnalytics: () => void }) {
  const { posts } = usePosts();
  const [ins, setIns] = useState<Insights | null>(null);
  useEffect(() => {
    void supabase.from("system_settings").select("value").eq("key", "vidiq_insights").maybeSingle()
      .then(({ data }) => { try { setIns(data?.value ? JSON.parse(data.value) : null); } catch { setIns(null); } });
  }, []);
  const score = useMemo(() => scorer(posts), [posts]);
  const today = dayKey(new Date());
  const todayN = posts.filter((p) => localDay(p.posted_at) === today).length;
  const winners = useMemo(() => posts.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 7 * 86400_000 && p.views != null)
    .sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0) || (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [posts, score]);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Your winners this week" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-bold text-foreground">Your winners this week</h2>
          <span className="text-sm text-muted-foreground">{todayN} posted today · score 50 = your normal, 75 = double, 100 = 4x</span>
          <button onClick={onOpenAnalytics} className="ml-auto text-sm font-semibold text-primary hover:underline">All posts & accounts →</button>
        </div>
        {winners.length === 0 ? <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No posts with views this week yet.</div> : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {winners.map((p, i) => { const t = thumbOf(p); const sc = score(p); return (
              <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-1 hover:bg-muted/40">
                <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-muted">
                  {t ? <img src={t} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                  <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[12px] font-bold text-foreground">#{i + 1} · {platLabel(p.platform)}</span>
                  {sc != null && <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[13px] font-bold ${scoreTone(sc)}`}>{sc}</span>}
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums text-foreground">{fmtNum(p.views ?? 0)} <span className="text-[13px] font-normal text-muted-foreground">views</span></div>
                <div className="text-[13px] text-muted-foreground">{p.account?.trim()}{p.watched_pct != null ? ` · ${Math.round(p.watched_pct)}% watched` : ""}</div>
              </a>
            ); })}
          </div>
        )}
      </section>
      {ins && (
        <section aria-label="What to make next" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-bold text-foreground">What to make next</h2>
            <span className="text-sm text-muted-foreground">from vidIQ · {new Date(ins.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          </div>
          <ol className="flex flex-col gap-3">
            {ins.ideas.slice(0, 7).map((idea) => (
              <li key={idea.title} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${scoreTone(idea.score)}`} title="How likely this idea is to break out for you, 0-100">{idea.score}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{idea.format && <span className="mr-2 rounded border border-border px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground">{idea.format}</span>}{idea.title}</div>
                  <div className="text-[13px] text-muted-foreground">{idea.why}{idea.example && <> · <a href={idea.example} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">see example</a></>}</div>
                </div>
              </li>
            ))}
          </ol>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-foreground">Why these? Your niche and what you save for inspiration</summary>
            <p className="mt-2 text-muted-foreground">{ins.niche}</p>
            {ins.inspiration && <ul className="mt-2 list-disc pl-5 text-muted-foreground">{ins.inspiration.map((r) => <li key={r}>{r}</li>)}</ul>}
            <div className="mt-3 font-semibold text-foreground">Rules from your numbers</div>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">{ins.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        </section>
      )}
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
      <span className="text-sm text-foreground"><b className="text-lg tabular-nums">{t.length}</b> posted today
        <span className="text-muted-foreground"> · {t.filter((p) => p.format === "short").length} short · {t.filter((p) => p.format === "long").length} long · {week.length} this week</span></span>
      <Button size="sm" variant="outline" onClick={onOpen} className="ml-auto h-8">Log a post / Analytics</Button>
    </div>
  );
}

export default function AccountsAnalytics() {
  const { posts, setPosts, loading } = usePosts();
  const [logOpen, setLogOpen] = useState(false);
  const [platform, setPlatform] = useState<string>("instagram");
  const [account, setAccount] = useState<string>("Fit for Daddy");
  const [format, setFormat] = useState<"short" | "long">("short");
  const [category, setCategory] = useState<string | null>(null);
  const [purposeful, setPurposeful] = useState<boolean>(true);
  const [title, setTitle] = useState("");
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
  const grid = useMemo(() => {
    const recent = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);
    return (sort === "views" ? [...recent].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)) : recent).slice(0, 24);
  }, [shown, sort]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i)); const k = dayKey(d);
    const ps = shown.filter((p) => localDay(p.posted_at) === k);
    return { k, label: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), short: ps.filter((p) => p.format === "short").length, long: ps.filter((p) => p.format === "long").length };
  }), [shown]);
  const maxDay = Math.max(1, ...days.map((d) => d.short + d.long));

  const logPost = async () => {
    if (!account.trim()) { toast.error("Pick or type the account"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("content_posts")
      .insert({ platform, account: account.trim(), format, category, purposeful, title: title.trim() || null, source: "manual" })
      .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source, external_id, thumb_url, watched_pct").single();
    setSaving(false);
    if (error || !data) { toast.error(`Couldn't log it: ${error?.message.slice(0, 100) ?? "not saved"}`); return; }
    setPosts((ps) => [data as Post, ...ps]); setTitle(""); setLogOpen(false);
    toast.success(`Logged: ${platLabel(platform)} ${format} · ${account.trim()}`);
  };

  const thumb = (p: Post) => thumbOf(p);
  const score = useMemo(() => scorer(posts), [posts]);
  const ago = (iso: string) => formatTimeAgo(iso);
  const realTitle = (t: string | null) => (t && t.trim().toLowerCase() !== "unknown" ? t : null);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Posted today" value={String(todayPosts.length)} sub={`${todayPosts.filter((p) => p.format === "short").length} short · ${todayPosts.filter((p) => p.format === "long").length} long`} />
        <Stat label="Last 7 days" value={String(week.length)} sub={`${week.filter((p) => p.format === "short").length} short · ${week.filter((p) => p.format === "long").length} long`} />
        <Stat label="Views, last 30 days" value={fmtNum(views30)} sub={`${month.length} posts`} />
        <Stat label="YouTube subscribers" value={yt?.subscribers != null ? fmtNum(yt.subscribers) : "—"} sub="updates every 3 hours" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Pill on={filterAccount === "all"} onClick={() => setFilterAccount("all")}>All accounts</Pill>
        {accountKeys.map(([k, label]) => <Pill key={k} on={filterAccount === k} onClick={() => setFilterAccount(k)}>{label}</Pill>)}
        <Button size="sm" onClick={() => setLogOpen(!logOpen)} className="ml-auto h-9 bg-primary px-4 text-primary-foreground hover:bg-primary/90">{logOpen ? "Close" : "+ Log an Instagram / TikTok post"}</Button>
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
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title or hook (optional)" className="h-10 min-w-[220px] flex-1" />
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
              <span className="text-[13px] tabular-nums text-foreground">{d.short + d.long || ""}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm" style={{ height: Math.max(2, Math.round(((d.short + d.long) / maxDay) * 96)) }}>
                <div className="bg-sky-400" style={{ flex: d.long }} /><div className="bg-primary" style={{ flex: d.short }} />
              </div>
              <span className="text-[12px] text-muted-foreground">{d.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Your videos" className="flex flex-col gap-3">
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
                  <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[12px] font-semibold text-foreground">{platLabel(p.platform)} · {p.format === "short" ? "Short" : "Long"}</span>
                  {score(p) != null && <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[12px] font-bold ${scoreTone(score(p)!)}`} title="50 = your normal, 75 = double, 100 = 4x or better">{score(p)}</span>}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums text-foreground">{p.views != null ? fmtNum(p.views) : "—"}<span className="ml-1 text-[13px] font-normal text-muted-foreground">views</span></span>
                  <span className="text-[13px] text-muted-foreground">{ago(p.posted_at)}</span>
                </div>
                {realTitle(p.title) && <div className="line-clamp-2 text-[13px] text-foreground">{realTitle(p.title)}</div>}
              </>
            );
            return p.url
              ? <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-1 hover:bg-muted/40">{inner}</a>
              : <div key={p.id} className="rounded-lg p-1">{inner}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
