// Launch Board → Analytics (Sam 2026-10-06): every post across every account, short vs long,
// purposeful vs not, by content category. YouTube fills itself (apex-youtube-sync.py, every 3h);
// Instagram / TikTok / Facebook posts are logged here with one tap.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Post = {
  id: number; platform: string; account: string | null; format: string; category: string | null; title: string | null;
  url: string | null; posted_at: string; views: number | null; likes: number | null; purposeful: boolean | null; source: string;
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
      .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source")
      .gte("posted_at", since).order("posted_at", { ascending: false }).limit(2000);
    if (error) toast.error(`Couldn't load posts: ${error.message.slice(0, 100)}`);
    setPosts((data ?? []) as Post[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { posts, setPosts, loading, load };
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
  const { posts, setPosts, loading, load } = usePosts();
  const [platform, setPlatform] = useState<string>("instagram");
  const [account, setAccount] = useState<string>("Fit for Daddy");
  const [format, setFormat] = useState<"short" | "long">("short");
  const [category, setCategory] = useState<string | null>(null);
  const [purposeful, setPurposeful] = useState<boolean>(true);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string>("all");
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

  const today = dayKey(new Date());
  const shown = filterAccount === "all" ? posts : posts.filter((p) => acct(p) === filterAccount);
  const todayPosts = shown.filter((p) => localDay(p.posted_at) === today);
  const week = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 7 * 86400_000);
  const month = shown.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);
  const tagged = week.filter((p) => p.purposeful != null);
  const purposefulPct = tagged.length ? Math.round((tagged.filter((p) => p.purposeful).length / tagged.length) * 100) : null;
  const views30 = month.reduce((n, p) => n + (p.views ?? 0), 0);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i)); const k = dayKey(d);
    const ps = shown.filter((p) => localDay(p.posted_at) === k);
    return { k, label: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), short: ps.filter((p) => p.format === "short").length, long: ps.filter((p) => p.format === "long").length };
  }), [shown]);
  const maxDay = Math.max(1, ...days.map((d) => d.short + d.long));

  const accountRows = useMemo(() => {
    const m = new Map<string, { platform: string; account: string; d7: number; d30: number; views30: number; last: string }>();
    posts.forEach((p) => {
      const key = acct(p);
      const r = m.get(key) ?? { platform: p.platform, account: p.account?.trim() || "(no account)", d7: 0, d30: 0, views30: 0, last: p.posted_at };
      const age = Date.now() - new Date(p.posted_at).getTime();
      if (age < 7 * 86400_000) r.d7++;
      if (age < 30 * 86400_000) { r.d30++; r.views30 += p.views ?? 0; }
      if (p.posted_at > r.last) r.last = p.posted_at;
      m.set(key, r);
    });
    return [...m.entries()].sort((a, b) => b[1].d30 - a[1].d30);
  }, [posts]);

  const logPost = async () => {
    if (!account.trim()) { toast.error("Pick or type the account"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("content_posts")
      .insert({ platform, account: account.trim(), format, category, purposeful, title: title.trim() || null, source: "manual" })
      .select("id, platform, account, format, category, title, url, posted_at, views, likes, purposeful, source").single();
    setSaving(false);
    if (error || !data) { toast.error(`Couldn't log it: ${error?.message.slice(0, 100) ?? "not saved"}`); return; }
    setPosts((ps) => [data as Post, ...ps]); setTitle("");
    toast.success(`Logged: ${platLabel(platform)} ${format} · ${account.trim()}`);
  };

  const update = async (p: Post, changes: Partial<Post>) => {
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...changes } : x)));
    const { data, error } = await supabase.from("content_posts").update(changes).eq("id", p.id).select("id");
    if (error || !data?.length) { setPosts((ps) => ps.map((x) => (x.id === p.id ? p : x))); toast.error("Couldn't save that change"); }
  };
  const remove = async (p: Post) => {
    setPosts((ps) => ps.filter((x) => x.id !== p.id));
    const { data, error } = await supabase.from("content_posts").delete().eq("id", p.id).select("id");
    if (error || !data?.length) { void load(); toast.error("Couldn't remove it"); } else toast.success("Removed");
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Posted today" value={String(todayPosts.length)} sub={`${todayPosts.filter((p) => p.format === "short").length} short · ${todayPosts.filter((p) => p.format === "long").length} long`} />
        <Stat label="Last 7 days" value={String(week.length)} sub={purposefulPct == null ? "tag posts purposeful or not below" : `${purposefulPct}% purposeful`} />
        <Stat label="Views, last 30 days" value={fmtNum(views30)} sub={`${month.length} posts`} />
        <Stat label="YouTube subscribers" value={yt?.subscribers != null ? fmtNum(yt.subscribers) : "—"} sub={yt?.at ? `updated ${new Date(yt.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "syncs every 3 hours"} />
      </section>

      <section aria-label="Log a post" className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-card p-4">
        <h2 className="text-base font-bold text-foreground">Log a post</h2>
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

      <section aria-label="Accounts" className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">Accounts</h2>
        {accountRows.length === 0 && <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">{loading ? "Loading…" : "No posts yet. YouTube fills in automatically; log Instagram and TikTok posts above."}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accountRows.map(([key, r]) => (
            <button key={key} onClick={() => setFilterAccount(filterAccount === key ? "all" : key)} aria-pressed={filterAccount === key}
              className={`rounded-lg border bg-card p-4 text-left transition ${filterAccount === key ? "border-primary" : "border-border hover:border-primary/60"}`}>
              <div className="text-[13px] font-semibold text-muted-foreground">{platLabel(r.platform)}</div>
              <div className="text-lg font-bold text-foreground">{r.account}</div>
              <div className="mt-1 text-sm text-foreground">{r.d7} this week · {r.d30} in 30 days{r.views30 ? ` · ${fmtNum(r.views30)} views` : ""}</div>
              <div className="text-[13px] text-muted-foreground">last post {new Date(r.last).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            </button>
          ))}
        </div>
        {filterAccount !== "all" && <button onClick={() => setFilterAccount("all")} className="self-start text-sm font-semibold text-primary">Show all accounts</button>}
      </section>

      <section aria-label="Last 14 days" className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-4 text-sm"><b className="text-foreground">Posts per day</b>
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-3 w-3 rounded-sm bg-primary" />short</span>
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-3 w-3 rounded-sm bg-sky-400" />long</span></div>
        <div className="flex h-40 items-end gap-1.5">
          {days.map((d) => (
            <div key={d.k} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.short} short, ${d.long} long`}>
              <span className="text-[12px] tabular-nums text-foreground">{d.short + d.long || ""}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm" style={{ height: Math.max(2, Math.round(((d.short + d.long) / maxDay) * 96)) }}>
                <div className="bg-sky-400" style={{ flex: d.long }} /><div className="bg-primary" style={{ flex: d.short }} />
              </div>
              <span className="text-[11px] text-muted-foreground">{d.label.split(" ")[1]}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {[...CATEGORIES.map((c) => c.k), null].map((k) => {
            const n = month.filter((p) => p.category === k).length;
            return n ? <span key={k ?? "none"} className="rounded-full border border-border px-3 py-1 text-foreground">{catLabel(k)} <b className="tabular-nums">{n}</b></span> : null;
          })}
        </div>
      </section>

      <section aria-label="Recent posts" className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-[12px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Post</th><th className="px-3 py-2">Views</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Purposeful?</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {shown.slice(0, 100).map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{new Date(p.posted_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className="px-3 py-2.5 text-foreground">{platLabel(p.platform)}<div className="text-[12px] text-muted-foreground">{p.account ?? ""} · {p.format === "short" ? "short" : "long"}</div></td>
                <td className="max-w-[320px] px-3 py-2.5">{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-semibold text-foreground hover:text-primary">{showTitle(p.title)}</a> : <span className="line-clamp-2 text-foreground">{showTitle(p.title)}</span>}</td>
                <td className="px-3 py-2.5 tabular-nums text-foreground">{p.views != null ? fmtNum(p.views) : "—"}</td>
                <td className="px-3 py-2.5">
                  <select value={p.category ?? ""} onChange={(e) => void update(p, { category: e.target.value || null })} aria-label="Category"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
                    <option value="">Untagged</option>{CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    <Pill on={p.purposeful === true} onClick={() => void update(p, { purposeful: p.purposeful === true ? null : true })}>Yes</Pill>
                    <Pill on={p.purposeful === false} onClick={() => void update(p, { purposeful: p.purposeful === false ? null : false })}>No</Pill>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right">{p.source === "manual" && <button onClick={() => void remove(p)} className="text-[12px] text-muted-foreground hover:text-destructive">remove</button>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{loading ? "Loading…" : "Nothing in the last 60 days yet."}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
