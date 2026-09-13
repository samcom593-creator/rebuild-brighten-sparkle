// /share/:token — a copy-paste link Sam sends to an editor: view previews and
// download originals for a chosen set of clips, no login. Data comes from the
// public content-share function (token is the only credential); direct
// download links are Dropbox CDN links re-minted every 3h.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Film, Loader2 } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { canShareFiles, pullFile, shareFiles } from "@/lib/saveMedia";

interface SharedClip { id: string; name: string; folder: string; kind: string; title: string | null; tags: string[]; duration_s: number | null; size_bytes: number; thumb_url: string | null; preview_url: string | null; download_url: string | null; phone_url?: string | null; phone_bytes?: number | null }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const fmtDur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

export default function SharePage() {
  usePageTitle("Shared clips");
  const { token = "" } = useParams();
  const [state, setState] = useState<{ loading: boolean; error: string | null; label: string; clips: SharedClip[] }>({ loading: true, error: null, label: "", clips: [] });
  // Phone: two taps — pull the phone-size copy (or a small original) with a percentage, then hand it to the share
  // sheet (Save Video / Save Image → camera roll). Two taps because iOS only lets share() run inside a fresh gesture.
  const mobile = canShareFiles();
  const PHONE_MAX_ORIGINAL = 150 * 1024 * 1024;
  const [pull, setPull] = useState<Record<string, { pct: number | null; loaded: number; file?: File; error?: string }>>({});
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const target = (k: SharedClip) => {
    if (k.phone_url && !(k.download_url && k.size_bytes <= PHONE_MAX_ORIGINAL && k.size_bytes < (k.phone_bytes ?? Infinity))) return { url: k.phone_url, name: k.name.replace(/\.[a-z0-9]+$/i, "") + ".mp4" };
    if (k.download_url && (k.size_bytes <= PHONE_MAX_ORIGINAL || /\.(png|jpe?g|heic)$/i.test(k.name))) return { url: k.download_url, name: k.name };
    return null;
  };
  const save = async (k: SharedClip) => {
    if (!mobile) { if (k.download_url) { const a = document.createElement("a"); a.href = k.download_url; a.download = k.name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); } return; }
    const got = pull[k.id];
    if (got?.file) {
      try { const out = await shareFiles([got.file], k.name); if (out === "shared") setSaveNote("In the share sheet — tap Save Video / Save Image to keep it in your camera roll."); }
      catch (e) { setSaveNote(`Share sheet refused: ${e instanceof Error ? e.message.slice(0, 60) : "unknown"}`); }
      return;
    }
    if (got && got.pct !== null && !got.error) return;
    const t = target(k);
    if (!t) { setSaveNote(`This original is ${fmtSize(k.size_bytes)} — too big to pull on a phone. A phone-size copy is being made; try again shortly, or open it on a computer.`); return; }
    setPull((m) => ({ ...m, [k.id]: { pct: 0, loaded: 0 } })); setSaveNote(null);
    try {
      const file = await pullFile(t, (loaded, total) => setPull((m) => ({ ...m, [k.id]: { pct: total ? Math.round((loaded / total) * 100) : null, loaded } })), 240_000);
      setPull((m) => ({ ...m, [k.id]: { pct: 100, loaded: file.size, file } }));
      setSaveNote(`${fmtSize(file.size)} ready — tap Save to camera roll.`);
    } catch (e) {
      setPull((m) => ({ ...m, [k.id]: { pct: null, loaded: 0, error: String(e) } }));
      setSaveNote(`Couldn't pull the file (${e instanceof Error ? e.message.slice(0, 60) : "unknown"}). Opening it directly instead.`);
      window.open(t.url, "_blank", "noopener");
    }
  };
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
      {saveNote && <p className="mb-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">{saveNote}</p>}
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
                {(k.download_url || k.phone_url)
                  ? <Button size="sm" disabled={mobile && !!pull[k.id] && pull[k.id].pct !== null && pull[k.id].pct! < 100 && !pull[k.id].error} onClick={() => void save(k)} className={`w-full ${pull[k.id]?.file ? "bg-gold text-zinc-950 hover:bg-gold/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`} title={mobile ? "Tap to pull, tap again to save to camera roll" : "Download the original file"}>
                      {mobile && pull[k.id] && !pull[k.id].file && !pull[k.id].error ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                      {!mobile ? "Download original" : pull[k.id]?.file ? "Save to camera roll" : pull[k.id] && !pull[k.id].error ? (pull[k.id].pct !== null ? `Pulling ${pull[k.id].pct}%` : `Pulling ${fmtSize(pull[k.id].loaded)}`) : k.phone_url ? `Get phone copy · ${fmtSize(k.phone_bytes ?? 0)}` : "Get"}
                    </Button>
                  : <Button size="sm" variant="outline" disabled className="w-full">Link refreshing — try again in a minute</Button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
