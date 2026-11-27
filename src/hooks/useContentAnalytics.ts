// Shared content reads stay independent of the lazily loaded analytics UI.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Post = {
  id: number; platform: string; account: string | null; format: string; category: string | null; title: string | null;
  url: string | null; posted_at: string; views: number | null; likes: number | null; purposeful: boolean | null; source: string; external_id: string | null; thumb_url: string | null; watched_pct: number | null; duration_s: number | null;
};
export function usePosts(enabled = true) {
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
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  return { posts, setPosts, loading, failed, load };
}

export type Source = { title?: string; channel?: string; views?: number; video_id?: string; url?: string } | null;
export type Idea = { day: number; theme?: string; format?: string; score: number; title: string; why: string; source?: Source };
export type Insights = {
  niche?: string; generated_at?: string; rules?: string[]; inspiration?: string[];
  audience?: { summary?: string; segments?: { label: string; pct: number }[]; wants?: string[]; pains?: string[] };
  strategy?: { summary?: string; weekly?: string[] };
  coach?: { start?: string[]; keep?: string[]; stop?: string[]; trends?: { title: string; why?: string; url?: string }[] };
  ideas?: Idea[];
};

export function useInsights() {
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
