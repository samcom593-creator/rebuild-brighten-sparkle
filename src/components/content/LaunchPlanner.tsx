// Launch Board plan (MP-BRAND-ENGINE part 4, 2026-11-12).
// Six stages over the existing content_cards workflow, so no card is migrated and the older views keep
// reading the same rows:
//   Idea = idea · Scripted = record · Recorded = edit · Edited = review/ready · Scheduled = scheduled · Posted = published
// The brand fields (account, format, pillar, CTA keyword, slot, outfit note) live in content_cards.brief.
// The database refuses Scheduled without account, title, pillar and CTA keyword (content_cards_brand_gate);
// this page shows the same gaps before the tap. A Scheduled card lands in the Social Media Center
// approval queue by trigger, and comes back Posted when its draft is marked posted there.
// Rule 1 of Q4: decide Tuesday, film Saturday, edit Sunday.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarCheck, Check, Link2, Loader2, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { cn } from "@/lib/utils";
import {
  ACCOUNTS, CARD_FORMATS, FORMAT_BY_KEY, KEYWORDS, KEYWORD_BY_KEY, PILLARS, PILLAR_BY_KEY, accountLabel, addDaysKey, formatLabel, phoenixDay,
  pillarLabel, scheduleGaps, type Keyword,
} from "@/lib/brand";

interface PlanCard {
  id: string; title: string; hook: string; caption: string; status: string; due_date: string | null; brand: string; content_type: string;
  scheduled_for: string | null; published_url: string | null; brief: Record<string, unknown> | null; sort: number; created_at: string;
}
type StageKey = "idea" | "scripted" | "recorded" | "edited" | "scheduled" | "posted";
type View = "board" | "tuesday" | "saturday" | "rants";

const STAGES: { key: StageKey; label: string; statuses: string[] }[] = [
  { key: "idea", label: "Idea", statuses: ["idea"] },
  { key: "scripted", label: "Scripted", statuses: ["record"] },
  { key: "recorded", label: "Recorded", statuses: ["edit", "recorded"] },
  { key: "edited", label: "Edited", statuses: ["review", "ready"] },
  { key: "scheduled", label: "Scheduled", statuses: ["scheduled"] },
  { key: "posted", label: "Posted", statuses: ["published", "posted"] },
];
const stageOf = (status: string): StageKey => STAGES.find((s) => s.statuses.includes(status))?.key ?? "idea";
const VIEWS: { key: View; label: string }[] = [
  { key: "board", label: "Stages" }, { key: "tuesday", label: "Tuesday planning" }, { key: "saturday", label: "Saturday record" }, { key: "rants", label: "Rant batch" },
];
const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-background px-3 text-[16px]";
const COLS = "id,title,hook,caption,status,due_date,brand,content_type,scheduled_for,published_url,brief,sort,created_at";
const b = (c: PlanCard, k: string): string => String((c.brief ?? {})[k] ?? "");
const isLong = (c: PlanCard) => FORMAT_BY_KEY[b(c, "format")]?.long ?? (c.content_type === "long" || c.brand === "YT");

/** The next Saturday on or after `day` (YYYY-MM-DD, Arizona). */
function nextSaturday(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDaysKey(day, (6 - dow + 7) % 7);
}

/** The tracked link a post should carry: the keyword's door + who sent the click and which card. */
export function cardLink(c: { id: string; brief?: Record<string, unknown> | null }): string | null {
  const kw = String((c.brief ?? {}).keyword ?? "") as Keyword;
  const account = String((c.brief ?? {}).account ?? "");
  if (!KEYWORD_BY_KEY[kw] || !account) return null;
  return `${KEYWORD_BY_KEY[kw].url}?utm_source=${encodeURIComponent(account)}&utm_medium=social&utm_content=${c.id}`;
}

export function LaunchPlanner() {
  const [cards, setCards] = useState<PlanCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  const [stage, setStage] = useState<StageKey>("idea");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanCard | null>(null);
  const [quick, setQuick] = useState("");
  const [quickAccount, setQuickAccount] = useState<string>(ACCOUNTS[0].key);
  const [rant, setRant] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("content_cards").select(COLS).is("archived_at", null).order("sort", { ascending: true }).limit(500);
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    setCards((data ?? []) as unknown as PlanCard[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (id: string, changes: Record<string, unknown>, ok: string): Promise<boolean> => {
    setBusy(id);
    const { data, error } = await supabase.from("content_cards").update(changes as never).eq("id", id).select(COLS).maybeSingle();
    setBusy(null);
    if (error || !data) { toast.error(error?.message ?? "The card was not found."); return false; }
    setCards((prev) => (prev ?? []).map((c) => (c.id === id ? (data as unknown as PlanCard) : c)));
    toast.success(ok);
    return true;
  };

  const add = async (title: string, brief: Record<string, unknown>, long = false) => {
    const t = title.trim();
    if (t.length < 3) { toast.error("Type the idea first."); return false; }
    setBusy("new");
    const { data, error } = await supabase.from("content_cards")
      .insert({ title: t.slice(0, 180), brand: long ? "YT" : "SH", content_type: long ? "long" : "short", job: "REACH", status: "idea", sort: Math.floor(Date.now() / 1000), brief } as never)
      .select(COLS).single();
    setBusy(null);
    if (error || !data) { toast.error(`Not added: ${error?.message ?? "no row came back"}`); return false; }
    setCards((prev) => [...(prev ?? []), data as unknown as PlanCard]);
    toast.success("Added as an idea.");
    return true;
  };

  const advance = async (c: PlanCard) => {
    const s = stageOf(c.status);
    if (s === "idea") return patch(c.id, { status: "record" }, "Scripted.");
    if (s === "scripted") return patch(c.id, { status: "edit" }, "Recorded.");
    if (s === "recorded") return patch(c.id, { status: "ready", approved_at: new Date().toISOString() }, "Edited and approved.");
    if (s === "edited") {
      const gaps = scheduleGaps(c);
      if (gaps.length) { toast.error(`Add ${gaps.join(", ")} first.`); setEditing(c); return false; }
      if (!c.due_date) { toast.error("Add a target date first."); setEditing(c); return false; }
      const slot = /^\d{2}:\d{2}$/.test(b(c, "slot")) ? b(c, "slot") : "12:00";
      const when = new Date(`${c.due_date}T${slot}:00-07:00`).toISOString();
      const changes: Record<string, unknown> = { status: "scheduled", scheduled_for: when, schedule_kind: "manual" };
      if (c.status !== "ready") changes.approved_at = new Date().toISOString();
      return patch(c.id, changes, "Scheduled. It is in the Social Media Center approval queue.");
    }
    return false;
  };

  const copyLink = async (c: PlanCard) => {
    const link = cardLink(c);
    if (!link) { toast.error("Add an account and a CTA keyword to get this card's link."); return; }
    try { await navigator.clipboard.writeText(link); toast.success("Tracked link copied."); }
    catch { toast.error("Copy was blocked by the browser."); }
  };

  const all = useMemo(() => cards ?? [], [cards]);
  const byStage = useMemo(() => {
    const m = new Map<StageKey, PlanCard[]>(STAGES.map((s) => [s.key, []]));
    for (const c of all) m.get(stageOf(c.status))?.push(c);
    return m;
  }, [all]);

  // Tuesday: how far each pillar sits under its share of the week, counted over cards already past Idea
  // and not yet Posted. Ideas from the most under-served pillar come first.
  const planning = useMemo(() => {
    const pipeline = all.filter((c) => !["idea", "posted"].includes(stageOf(c.status)));
    const total = pipeline.length;
    const gap = new Map<string, number>();
    for (const p of PILLARS) {
      const have = pipeline.filter((c) => b(c, "pillar") === p.key).length;
      gap.set(p.key, p.mix - (total ? (have / total) * 100 : 0));
    }
    const ideas = (byStage.get("idea") ?? []).slice().sort((x, y) => (gap.get(b(y, "pillar")) ?? -100) - (gap.get(b(x, "pillar")) ?? -100));
    return { gap, ideas, total };
  }, [all, byStage]);
  const defaultPick = useMemo(() => new Set(planning.ideas.filter(isLong).slice(0, 4).map((c) => c.id)), [planning.ideas]);
  const chosen = picked ?? defaultPick;

  const promote = async () => {
    const ids = [...chosen];
    if (ids.length === 0) { toast.error("Pick the ideas first."); return; }
    setBusy("promote");
    const sat = nextSaturday(phoenixDay());
    let ok = 0;
    for (const id of ids) {
      const card = all.find((c) => c.id === id);
      if (!card) continue;
      const { data, error } = await supabase.from("content_cards").update({ status: "record", brief: { ...(card.brief ?? {}), record_day: sat } } as never).eq("id", id).select(COLS).maybeSingle();
      if (!error && data) { ok++; setCards((prev) => (prev ?? []).map((c) => (c.id === id ? (data as unknown as PlanCard) : c))); }
    }
    setBusy(null); setPicked(null);
    if (ok === ids.length) toast.success(`${ok} promoted to Scripted for Saturday ${sat}.`);
    else toast.warning(`${ok} of ${ids.length} promoted. Refresh and try the rest again.`);
  };

  if (loadError) return <p className="rounded-xl border border-border/60 bg-card p-4 text-[15px] text-destructive">The plan did not load: {loadError}</p>;
  if (cards == null) return <Skeleton className="h-64 w-full" />;

  const scripted = byStage.get("scripted") ?? [];
  const satLong = scripted.filter(isLong);
  const satRants = scripted.filter((c) => b(c, "format") === "rant");
  const satBroll = scripted.filter((c) => ["fit-check", "gym", "car"].includes(b(c, "format")));
  const rantPool = all.filter((c) => b(c, "format") === "rant" && ["idea", "scripted"].includes(stageOf(c.status)));
  const rantBatch = rantPool.slice(0, 5);

  const row = (c: PlanCard, extra?: React.ReactNode) => {
    const s = stageOf(c.status);
    const gaps = s === "edited" ? scheduleGaps(c) : [];
    const next = STAGES[STAGES.findIndex((x) => x.key === s) + 1];
    return (
      <li key={c.id} className="rounded-xl border border-border/60 bg-card p-3">
        <div className="flex items-start gap-2">
          {extra}
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold leading-snug">{c.title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {accountLabel(b(c, "account") || null)} · {formatLabel(b(c, "format") || null)} · {pillarLabel(b(c, "pillar") || null)} · {b(c, "keyword") || "no keyword"}{c.due_date ? ` · ${c.due_date}` : ""}
            </p>
            {b(c, "outfit_note") && <p className="mt-1 text-[13px] text-muted-foreground">Outfit: {b(c, "outfit_note")}</p>}
            {b(c, "reject_reason") && s !== "posted" && <p className="mt-1 text-[13px] font-semibold text-tone-hot">Sent back: {b(c, "reject_reason")}</p>}
            {gaps.length > 0 && <p className="mt-1 text-[13px] font-semibold text-tone-warm">Needs {gaps.join(", ")} before it can be Scheduled.</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {next && s !== "scheduled" && (
            <Button className="h-11 flex-1" disabled={busy === c.id} onClick={() => void advance(c)}>
              {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />} {next.label}
            </Button>
          )}
          {s === "scheduled" && <p className="flex-1 self-center text-[13px] text-muted-foreground">Waiting in the Social Media Center. It turns Posted when its link is saved there.</p>}
          <Button variant="outline" className="h-11" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
          <Button variant="outline" className="h-11" onClick={() => void copyLink(c)} aria-label="Copy the tracked link for this card"><Link2 className="h-4 w-4" aria-hidden /></Button>
        </div>
      </li>
    );
  };

  return (
    <div>
      {/* Mobile quick-add: one field + account picker */}
      <form className="mb-4 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_180px_auto]" onSubmit={(e) => { e.preventDefault(); void add(quick, { account: quickAccount }).then((ok) => { if (ok) setQuick(""); }); }}>
        <label className="col-span-2 grid gap-1 text-[13px] font-semibold text-muted-foreground sm:col-span-1">New idea
          <Input className="h-12 text-[16px]" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Type the idea" />
        </label>
        <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">Account
          <select className={SELECT_CLASS} value={quickAccount} onChange={(e) => setQuickAccount(e.target.value)}>
            {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <Button type="submit" className="h-11 self-end" disabled={busy === "new"}><Plus className="h-4 w-4" aria-hidden /> Add</Button>
      </form>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}
            className={cn("h-11 shrink-0 rounded-full border px-4 text-[15px] font-semibold", view === v.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "board" && (
        <section aria-label="Stages">
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {STAGES.map((s) => (
              <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => setStage(s.key)}
                className={cn("h-11 shrink-0 rounded-lg border px-3 text-[15px] font-semibold", stage === s.key ? "border-tone-gold bg-tone-gold/12 text-foreground" : "border-border bg-card text-muted-foreground")}>
                {s.label} <span className="tabular-nums">{byStage.get(s.key)?.length ?? 0}</span>
              </button>
            ))}
          </div>
          {(byStage.get(stage)?.length ?? 0) === 0
            ? <p className="rounded-xl border border-border/60 bg-card p-4 text-[15px] text-muted-foreground">No cards in {STAGES.find((s) => s.key === stage)?.label}.</p>
            : <ul className="space-y-2">{byStage.get(stage)?.map((c) => row(c))}</ul>}
        </section>
      )}

      {view === "tuesday" && (
        <section aria-label="Tuesday planning">
          <div className="mb-3 rounded-xl border border-border/60 bg-card p-3">
            <p className="text-[15px] font-bold">Pillar mix</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{planning.total === 0 ? "Nothing is in production yet, so every pillar is open." : `Across the ${planning.total} cards in production. Under means the week needs more of it.`}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PILLARS.map((p) => {
                const g = Math.round(planning.gap.get(p.key) ?? 0);
                return <TonePill key={p.key} tone={g > 3 ? "warm" : "good"}>{p.label} {p.mix}%{g > 3 ? ` · under by ${g}` : ""}</TonePill>;
              })}
            </div>
          </div>
          <Button className="mb-3 h-12 w-full" disabled={busy === "promote" || chosen.size === 0} onClick={() => void promote()}>
            {busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarCheck className="h-4 w-4" aria-hidden />} Promote {chosen.size} to Scripted for Saturday
          </Button>
          {planning.ideas.length === 0
            ? <p className="rounded-xl border border-border/60 bg-card p-4 text-[15px] text-muted-foreground">No ideas yet. Add one above.</p>
            : (
              <ul className="space-y-2">
                {planning.ideas.map((c) => row(c, (
                  <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[hsl(var(--primary))]" aria-label={`Pick ${c.title} for Saturday`} checked={chosen.has(c.id)}
                    onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n); }} />
                )))}
              </ul>
            )}
        </section>
      )}

      {view === "saturday" && (
        <section aria-label="Saturday record checklist" className="space-y-4">
          {[
            { label: "Long-forms", want: 4, list: satLong },
            { label: "Rants", want: 5, list: satRants },
            { label: "Fit, gym and car b-roll", want: null as number | null, list: satBroll },
            { label: "Other scripted", want: null as number | null, list: scripted.filter((c) => !satLong.includes(c) && !satRants.includes(c) && !satBroll.includes(c)) },
          ].map((g) => (
            <div key={g.label}>
              <h3 className="mb-2 text-[15px] font-bold">{g.label} <span className="font-normal text-muted-foreground">{g.list.length}{g.want != null ? ` of ${g.want} scripted` : " scripted"}</span></h3>
              {g.list.length === 0
                ? <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">Nothing scripted here. Promote ideas on Tuesday planning.</p>
                : <ul className="space-y-2">{g.list.map((c) => row(c))}</ul>}
            </div>
          ))}
        </section>
      )}

      {view === "rants" && (
        <section aria-label="Rant batch">
          <form className="mb-3 grid grid-cols-[1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); void add(rant, { account: "tiktok-rant", format: "rant" }).then((ok) => { if (ok) setRant(""); }); }}>
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">New rant
              <Input className="h-12 text-[16px]" value={rant} onChange={(e) => setRant(e.target.value)} placeholder="What are you ranting about" />
            </label>
            <Button type="submit" className="h-11 self-end" disabled={busy === "new"}><Plus className="h-4 w-4" aria-hidden /> Add</Button>
          </form>
          <p className="mb-2 text-[13px] text-muted-foreground">Five at a time. {rantPool.length} rant{rantPool.length === 1 ? "" : "s"} waiting; this batch shows the first {rantBatch.length}.</p>
          {rantBatch.length === 0
            ? <p className="rounded-xl border border-border/60 bg-card p-4 text-[15px] text-muted-foreground">No rants waiting. Add five, then record them in one sitting.</p>
            : <ul className="space-y-2">{rantBatch.map((c) => row(c))}</ul>}
        </section>
      )}

      <CardEditor card={editing} onClose={() => setEditing(null)} onSave={async (id, changes) => { const ok = await patch(id, changes, "Saved."); if (ok) setEditing(null); }} saving={busy === editing?.id} />
    </div>
  );
}

function CardEditor({ card, onClose, onSave, saving }: { card: PlanCard | null; onClose: () => void; onSave: (id: string, changes: Record<string, unknown>) => Promise<void>; saving: boolean }) {
  const [f, setF] = useState({ title: "", hook: "", account: "", format: "", pillar: "", keyword: "", due_date: "", slot: "12:00", outfit_note: "" });
  useEffect(() => {
    if (!card) return;
    setF({
      title: card.title, hook: card.hook ?? "", account: b(card, "account"), format: b(card, "format"), pillar: b(card, "pillar"), keyword: b(card, "keyword"),
      due_date: card.due_date ?? "", slot: b(card, "slot") || "12:00", outfit_note: b(card, "outfit_note"),
    });
  }, [card]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const link = card ? cardLink({ id: card.id, brief: { keyword: f.keyword, account: f.account } }) : null;

  const save = () => {
    if (!card) return;
    if (f.title.trim().length < 3) { toast.error("Give the card a title."); return; }
    const long = FORMAT_BY_KEY[f.format]?.long;
    const changes: Record<string, unknown> = {
      title: f.title.trim().slice(0, 180), hook: f.hook, due_date: f.due_date || null,
      brief: { ...(card.brief ?? {}), account: f.account, format: f.format, pillar: f.pillar, keyword: f.keyword, slot: f.slot, outfit_note: f.outfit_note.trim() },
    };
    if (long != null) { changes.content_type = long ? "long" : "short"; changes.brand = long ? "YT" : "SH"; }
    void onSave(card.id, changes);
  };

  return (
    <Sheet open={!!card} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit card</SheetTitle>
          <SheetDescription>Account, pillar and CTA keyword are required before a card can be Scheduled.</SheetDescription>
        </SheetHeader>
        <div className="mx-auto mt-3 grid w-full max-w-md gap-3">
          <label className="grid gap-1 text-[15px] font-semibold">Title<Input className="h-11 text-[16px]" value={f.title} onChange={set("title")} /></label>
          <label className="grid gap-1 text-[15px] font-semibold">Hook<Input className="h-11 text-[16px]" value={f.hook} onChange={set("hook")} placeholder="The first line" /></label>
          <label className="grid gap-1 text-[15px] font-semibold">Account
            <select className={SELECT_CLASS} value={f.account} onChange={set("account")}><option value="">Pick an account</option>{ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">Format
            <select className={SELECT_CLASS} value={f.format} onChange={set("format")}><option value="">Pick a format</option>{CARD_FORMATS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">Pillar
            <select className={SELECT_CLASS} value={PILLAR_BY_KEY[f.pillar] ? f.pillar : ""} onChange={set("pillar")}><option value="">Pick a pillar</option>{PILLARS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.mix}%)</option>)}</select>
          </label>
          <label className="grid gap-1 text-[15px] font-semibold">CTA keyword
            <select className={SELECT_CLASS} value={f.keyword} onChange={set("keyword")}><option value="">Pick a keyword</option>{KEYWORDS.map((k) => <option key={k.key} value={k.key}>{k.key}: {k.door}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-[15px] font-semibold">Target date<Input className="h-11 text-[16px]" type="date" value={f.due_date} onChange={set("due_date")} /></label>
            <label className="grid gap-1 text-[15px] font-semibold">Slot (Arizona)<Input className="h-11 text-[16px]" type="time" value={f.slot} onChange={set("slot")} /></label>
          </div>
          <label className="grid gap-1 text-[15px] font-semibold">Outfit note<Input className="h-11 text-[16px]" value={f.outfit_note} onChange={set("outfit_note")} placeholder="Black tee, gold chain" /></label>
          {link && <p className="break-all rounded-lg bg-muted/40 p-2 text-[13px] text-muted-foreground">Link for this post: {link}</p>}
          <Button className="h-12" disabled={saving} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
