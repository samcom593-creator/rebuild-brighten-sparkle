import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Crown, Loader2, Plus, ArrowRight, Check, Undo2, Paperclip, Pencil, Trash2,
} from "lucide-react";

type Status = "idea" | "recorded" | "ready" | "posted";
type Job = "REACH" | "AUTHORITY" | "PROOF" | "CONVERT";

interface Card {
  id: string;
  title: string;
  brand: string;
  content_type: string;
  job: string;
  hook: string;
  caption: string;
  status: string;
  day: number;
  clip: string;
  sort: number;
  posted_at: string | null;
}

const STATUSES: Status[] = ["idea", "recorded", "ready", "posted"];
const STATUS_LABEL: Record<Status, string> = { idea: "Ideas", recorded: "Recorded", ready: "Ready", posted: "Posted" };
const STATUS_SUB: Record<Status, string> = { idea: "to record", recorded: "drop the clip in", ready: "cleared to post", posted: "live" };
const STATUS_RANK: Record<string, number> = { ready: 3, recorded: 2, idea: 1, posted: 0 };
const STATUS_DOT: Record<Status, string> = { idea: "bg-zinc-500", recorded: "bg-sky-400", ready: "bg-gold", posted: "bg-emerald-400" };
const STATUS_TEXT: Record<Status, string> = { idea: "text-zinc-400", recorded: "text-sky-400", ready: "text-gold", posted: "text-emerald-400" };

const JOBS: { k: Job; label: string; desc: string; accent: string; border: string }[] = [
  { k: "REACH", label: "Reach", desc: "Get seen. Who you are, broader than the offer.", accent: "text-amber-400", border: "border-t-amber-400/70" },
  { k: "AUTHORITY", label: "Authority", desc: "Give value. A real lesson people keep.", accent: "text-sky-400", border: "border-t-sky-400/70" },
  { k: "PROOF", label: "Proof", desc: "Show it's real. The system, the results.", accent: "text-violet-400", border: "border-t-violet-400/70" },
  { k: "CONVERT", label: "Convert", desc: "One clear ask: apply to join the team.", accent: "text-emerald-400", border: "border-t-emerald-400/70" },
];

const LOOP = [
  { k: "1 · IDEA", t: "Write the idea", d: "A hook plus which of the 4 jobs it does. Lands in Ideas." },
  { k: "2 · RECORD", t: "Shoot it", d: "Footage already lives in Dropbox. Move it to Recorded." },
  { k: "3 · DROP CLIP", t: "Attach the finished file", d: "Paste the clip filename, caption it, move to Ready." },
  { k: "4 · POST", t: "Tap Post", d: "Copies the caption and stamps the date. You publish on the app." },
];

const brandHandle = (b: string) => (b === "IMS" ? "@imakesystems" : "@sellfordaddy");
const brandClass = (b: string) =>
  b === "IMS" ? "text-sky-300 border-sky-400/30 bg-sky-400/10" : "text-amber-300 border-amber-400/30 bg-amber-400/10";

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className ?? "border-border text-muted-foreground"}`}>
      {children}
    </span>
  );
}

const emptyDraft = { title: "", brand: "SFD", job: "REACH", content_type: "short", hook: "", caption: "", clip: "", day: 0, status: "idea" };

export default function LaunchBoard() {
  const askConfirm = useConfirm();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("content_cards")
        .select("*")
        .order("day", { ascending: true })
        .order("sort", { ascending: true });
      if (error) throw error;
      setCards((data as Card[]) ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Couldn't load the board: ${msg.slice(0, 120)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (id: string, changes: Partial<Card>) => {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    try {
      const { error } = await supabase.from("content_cards").update(changes).eq("id", id);
      if (error) throw error;
    } catch (e: unknown) {
      setCards(prev);
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Save failed: ${msg.slice(0, 120)}`);
    }
  }, [cards]);

  const advance = (c: Card) => patch(c.id, { status: c.status === "idea" ? "recorded" : "ready" });
  const back = (c: Card) => patch(c.id, { status: c.status === "ready" ? "recorded" : "idea" });
  const toggleBrand = (c: Card) => patch(c.id, { brand: c.brand === "SFD" ? "IMS" : "SFD" });

  const post = async (c: Card) => {
    if (c.caption && navigator.clipboard) {
      try { await navigator.clipboard.writeText(c.caption); toast.success("Caption copied — marked posted"); }
      catch { toast.success("Marked posted"); /* clipboard blocked, still post */ }
    } else {
      toast.success("Marked posted");
    }
    await patch(c.id, { status: "posted", posted_at: new Date().toISOString() });
  };

  const unpost = (c: Card) => patch(c.id, { status: "ready", posted_at: null });

  const remove = async (c: Card) => {
    const ok = await askConfirm({ title: "Delete this card?", description: c.title, confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    const prev = cards;
    setCards((cs) => cs.filter((x) => x.id !== c.id));
    try {
      const { error } = await supabase.from("content_cards").delete().eq("id", c.id);
      if (error) throw error;
      toast.success("Deleted");
    } catch (e: unknown) {
      setCards(prev);
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Delete failed: ${msg.slice(0, 120)}`);
    }
  };

  const openNew = () => { setEditing(null); setDraft({ ...emptyDraft }); setEditorOpen(true); };
  const openEdit = (c: Card) => { setEditing(c); setDraft({ ...c }); setEditorOpen(true); };

  const saveDraft = async () => {
    const title = String(draft.title ?? "").trim();
    if (!title) { toast.error("Give the card a title"); return; }
    setSaving(true);
    const payload = {
      title,
      brand: String(draft.brand ?? "SFD"),
      job: String(draft.job ?? "REACH"),
      content_type: String(draft.content_type ?? "short"),
      hook: String(draft.hook ?? ""),
      caption: String(draft.caption ?? ""),
      clip: String(draft.clip ?? ""),
      day: Number(draft.day ?? 0),
      status: String(draft.status ?? "idea"),
    };
    try {
      if (editing) {
        const { error } = await supabase.from("content_cards").update(payload).eq("id", editing.id);
        if (error) throw error;
        setCards((cs) => cs.map((c) => (c.id === editing.id ? { ...c, ...payload } : c)));
      } else {
        const nextSort = (cards.reduce((m, c) => Math.max(m, c.sort), 0) || 0) + 10;
        const { data, error } = await supabase
          .from("content_cards")
          .insert({ ...payload, sort: nextSort })
          .select("*")
          .single();
        if (error) throw error;
        setCards((cs) => [...cs, data as Card]);
      }
      setEditorOpen(false);
      toast.success(editing ? "Saved" : "Idea added");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Couldn't save: ${msg.slice(0, 120)}`);
    } finally {
      setSaving(false);
    }
  };

  const launch4 = useMemo(() => JOBS.map((j) => {
    const pick = cards
      .filter((c) => c.job === j.k && c.status !== "posted")
      .sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || ((a.day || 9) - (b.day || 9)))[0] ?? null;
    return { job: j, pick };
  }), [cards]);

  const counts = useMemo(() => ({
    total: cards.length,
    ready: cards.filter((c) => c.status === "ready").length,
    posted: cards.filter((c) => c.status === "posted").length,
  }), [cards]);

  const draftStr = (k: string) => String(draft[k] ?? "");
  const setDraftField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your board…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <Crown className="h-8 w-8 text-gold" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-[28px]">Launch Board</h1>
            <p className="mt-1 max-w-[52ch] text-sm text-muted-foreground">
              Ideas to record, the clip you drop in when it's done, and one tap to post. Your Dropbox is the source — this tracks the finished pieces.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {[
            { n: counts.total, l: "Planned", c: "text-foreground" },
            { n: counts.ready, l: "Ready", c: "text-gold" },
            { n: counts.posted, l: "Posted", c: "text-emerald-400" },
          ].map((s) => (
            <div key={s.l} className="min-w-[76px] rounded-xl border border-border bg-card px-3.5 py-2.5">
              <div className={`text-xl font-extrabold tabular-nums ${s.c}`}>{s.n}</div>
              <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.09em] text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </header>

      {/* loop */}
      <section className="pt-7">
        <SectionHead title="The loop" hint="it's just this" />
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {LOOP.map((s) => (
            <div key={s.k} className="bg-card p-4">
              <div className="text-[13px] font-extrabold tracking-wide text-gold">{s.k}</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{s.t}</div>
              <div className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* launch 4 */}
      <section className="pt-8">
        <SectionHead title="Today's Launch 4" />
        <p className="-mt-1 mb-4 text-[12.5px] text-muted-foreground">
          <span className="font-semibold text-foreground">The formula</span> — not four random posts. One for each job the launch has to do:{" "}
          <span className="font-semibold text-amber-400">Reach</span> · <span className="font-semibold text-sky-400">Authority</span> ·{" "}
          <span className="font-semibold text-violet-400">Proof</span> · <span className="font-semibold text-emerald-400">Convert</span>. Each slot auto-picks your strongest card for that job.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {launch4.map(({ job, pick }) => (
            <div key={job.k} className={`flex min-h-[190px] flex-col gap-2 rounded-2xl border border-t-[3px] border-border ${job.border} bg-card p-4`}>
              <div className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${job.accent}`}>{job.label}</div>
              <div className="text-[11.5px] leading-snug text-muted-foreground">{job.desc}</div>
              {pick ? (
                <button onClick={() => openEdit(pick)} className="mt-auto rounded-xl border border-border bg-background/60 p-3 text-left transition-colors hover:border-border/80">
                  <div className="text-sm font-bold leading-tight text-foreground">{pick.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Chip className={brandClass(pick.brand)}>{brandHandle(pick.brand)}</Chip>
                    <Chip className={`border-border ${STATUS_TEXT[pick.status as Status]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[pick.status as Status]}`} />{pick.status}
                    </Chip>
                  </div>
                </button>
              ) : (
                <div className="mt-auto rounded-xl border border-dashed border-border p-3 text-center text-[12.5px] text-muted-foreground">
                  No card yet for {job.label}.
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* week */}
      <section className="pt-8">
        <SectionHead title="The week" hint="Day 1 = launch day · tap a card to edit" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
            const items = cards.filter((c) => c.day === d);
            return (
              <div key={d} className={`flex min-h-[120px] flex-col gap-1.5 rounded-xl border bg-card p-2.5 ${d === 1 ? "border-gold/50" : "border-border"}`}>
                <div className="flex items-baseline justify-between">
                  <span className={`text-[12px] font-extrabold tracking-wide ${d === 1 ? "text-gold" : "text-muted-foreground"}`}>DAY {d}</span>
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{d === 1 ? "launch" : `${items.length}`}</span>
                </div>
                {items.length === 0 ? (
                  <span className="mt-auto text-[10px] text-muted-foreground">—</span>
                ) : items.map((c) => (
                  <button key={c.id} onClick={() => openEdit(c)} className={`rounded-lg border border-l-[3px] border-border bg-background/50 p-2 text-left ${DAY_BORDER(c.status)}`}>
                    <div className="text-[11.5px] font-semibold leading-tight text-foreground">{c.title.replace(/^Story · /, "")}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Chip className={brandClass(c.brand)}>{c.brand}</Chip>
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.status as Status]}`} />
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* pipeline */}
      <section className="pt-8">
        <SectionHead title="Pipeline" hint="move cards left → right as they get made" />
        <div className="grid items-start gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {STATUSES.map((st) => {
            const items = cards.filter((c) => c.status === st);
            return (
              <div key={st} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between px-0.5 pt-0.5">
                  <span className={`flex items-center gap-2 text-[12.5px] font-extrabold uppercase tracking-wide ${STATUS_TEXT[st]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[st]}`} />{STATUS_LABEL[st]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{items.length} · {STATUS_SUB[st]}</span>
                </div>
                {items.map((c) => (
                  <div key={c.id} className={`flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 ${c.status === "posted" ? "opacity-70" : ""}`}>
                    <button onClick={() => openEdit(c)} className="text-left text-[14.5px] font-bold leading-tight text-foreground">{c.title}</button>
                    {c.hook && <p className="text-[12.5px] leading-snug text-muted-foreground">{c.hook}</p>}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip className={brandClass(c.brand)}>{brandHandle(c.brand)}</Chip>
                      {c.day > 0 && <Chip className="border-border bg-background/60 text-muted-foreground">Day {c.day}</Chip>}
                    </div>
                    <button onClick={() => openEdit(c)} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11.5px] ${c.clip ? "border-sky-400/30 text-sky-400" : "border-dashed border-border text-muted-foreground"}`}>
                      <Paperclip className="h-3 w-3" />{c.clip || "attach clip file"}
                    </button>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {(c.status === "idea" || c.status === "recorded") && (
                        <Button size="sm" onClick={() => advance(c)} className="h-7 bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground hover:bg-primary/90">
                          <ArrowRight className="mr-1 h-3 w-3" />{c.status === "idea" ? "Recorded" : "Ready"}
                        </Button>
                      )}
                      {c.status === "ready" && (
                        <Button size="sm" onClick={() => post(c)} className="h-7 border border-emerald-400/35 bg-emerald-400/15 px-2.5 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-400/25">
                          <Check className="mr-1 h-3 w-3" />Post
                        </Button>
                      )}
                      {c.status === "posted" && (
                        <Button size="sm" variant="outline" onClick={() => unpost(c)} className="h-7 px-2.5 text-[11.5px]">
                          <Undo2 className="mr-1 h-3 w-3" />Undo
                        </Button>
                      )}
                      {(c.status === "recorded" || c.status === "ready") && (
                        <Button size="sm" variant="outline" onClick={() => back(c)} className="h-7 px-2 text-[11.5px] text-muted-foreground">back</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => toggleBrand(c)} className="h-7 px-2 text-[11.5px] text-muted-foreground" title="switch brand">{c.brand}</Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="h-7 px-2 text-muted-foreground" title="edit"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c)} className="h-7 px-2 text-muted-foreground hover:text-destructive" title="delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
                {st === "idea" && (
                  <Button variant="outline" onClick={openNew} className="border-dashed text-muted-foreground hover:border-gold/50 hover:text-gold">
                    <Plus className="mr-1.5 h-4 w-4" />New idea
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <p className="pt-8 text-center text-xs leading-relaxed text-muted-foreground">
        Saves to your account on every change — open this page on your phone or Mac and it's here.<br />
        Publishing stays your hands — no blind auto-posting. Google Sheet auto-sync still needs a Google service account.
      </p>

      {/* editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit card" : "New idea"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cc-title">Title</Label>
              <Input id="cc-title" value={draftStr("title")} onChange={(e) => setDraftField("title", e.target.value)} placeholder="What's the video?" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cc-hook">Hook / notes</Label>
              <Textarea id="cc-hook" rows={2} value={draftStr("hook")} onChange={(e) => setDraftField("hook", e.target.value)} placeholder="The opening line or the idea in a sentence" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cc-cap">Caption <span className="text-muted-foreground">(copied when you tap Post)</span></Label>
              <Textarea id="cc-cap" rows={3} value={draftStr("caption")} onChange={(e) => setDraftField("caption", e.target.value)} placeholder="The caption you'll post with" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cc-clip">Finished clip filename</Label>
              <Input id="cc-clip" value={draftStr("clip")} onChange={(e) => setDraftField("clip", e.target.value)} placeholder="e.g. 2026-09-07_intro-final.mp4" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Brand">
                <Select value={draftStr("brand")} onValueChange={(v) => setDraftField("brand", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SFD">@sellfordaddy</SelectItem>
                    <SelectItem value="IMS">@imakesystems</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Job">
                <Select value={draftStr("job")} onValueChange={(v) => setDraftField("job", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOBS.map((j) => <SelectItem key={j.k} value={j.k}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Day">
                <Select value={draftStr("day")} onValueChange={(v) => setDraftField("day", Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">—</SelectItem>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => <SelectItem key={d} value={String(d)}>Day {d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={draftStr("status")} onValueChange={(v) => setDraftField("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save" : "Add idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-3">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function DAY_BORDER(status: string) {
  switch (status) {
    case "recorded": return "border-l-sky-400";
    case "ready": return "border-l-gold";
    case "posted": return "border-l-emerald-400";
    default: return "border-l-zinc-500";
  }
}
