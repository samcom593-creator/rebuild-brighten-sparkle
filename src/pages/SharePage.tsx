// /share/:token — a copy-paste link Sam sends to an editor: view previews and
// download originals for a chosen set of clips, no login. Data comes from the
// public content-share function (token is the only credential); direct
// download links are Dropbox CDN links re-minted every 3h.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Film, Loader2 } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";

interface SharedClip { id: string; name: string; folder: string; kind: string; title: string | null; tags: string[]; duration_s: number | null; size_bytes: number; thumb_url: string | null; preview_url: string | null; download_url: string | null }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const fmtDur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

export default function SharePage() {
  usePageTitle("Shared clips");
  const { token = "" } = useParams();
  const [state, setState] = useState<{ loading: boolean; error: string | null; label: string; clips: SharedClip[] }>({ loading: true, error: null, label: "", clips: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/content-share?t=${encodeURIComponent(token)}`);
        const d = await r.json();
        if (!alive) return;
        if (!d.ok) { setState({ loading: false, error: d.error === "not found or expired" ? "This link has expired or doesn't exist." : "Couldn't load this share.", label: "", clips: [] }); return; }
        setState({ loading: false, error: null, label: d.label ?? "", clips: d.clips ?? [] });
      } catch (e: unknown) {
        if (alive) setState({ loading: false, error: `Couldn't load this share: ${(e instanceof Error ? e.message : "network error").slice(0, 80)}`, label: "", clips: [] });
      }
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Shared clips</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">{state.label || "Clips for you"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Hover to preview. Download gives you the original file.</p>
      </header>
      {state.loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {state.error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {state.clips.map((k) => (
          <div key={k.id} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div className={`relative bg-muted/40 ${k.kind === "vertical" ? "aspect-[9/16] max-h-72" : "aspect-video"}`}>
              {k.thumb_url ? <img src={k.thumb_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Film className="h-6 w-6" /></div>}
              {k.preview_url && <video src={k.preview_url} muted loop playsInline preload="none" onMouseEnter={(e) => { void e.currentTarget.play(); }} onMouseLeave={(e) => { e.currentTarget.pause(); }} className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />}
              {k.duration_s ? <span className="absolute bottom-1.5 right-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">{fmtDur(k.duration_s)}</span> : null}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-3">
              <div className="line-clamp-2 text-sm font-semibold text-foreground">{k.title || k.name}</div>
              <div className="text-[11px] text-muted-foreground">{k.folder} · {fmtSize(k.size_bytes)}{k.tags?.length ? ` · ${k.tags.slice(0, 3).join(", ")}` : ""}</div>
              <div className="mt-auto pt-1">
                {k.download_url
                  ? <Button asChild size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90"><a href={k.download_url} download={k.name}><Download className="mr-1.5 h-4 w-4" />Download original</a></Button>
                  : <Button size="sm" variant="outline" disabled className="w-full">Link refreshing — try again in a minute</Button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
