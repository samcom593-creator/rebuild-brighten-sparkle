import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchLinkActivity, type LinkActivityRow } from "@/lib/contractingRequests";
import { ChevronDown, Copy, Search } from "lucide-react";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "no hire date");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

/**
 * My Team › Contracting link. A working queue, not a roster (Sam, 2026-10-14): the people who opened the contracting
 * link and never finished it come first, newest open on top; then the people who never opened it, longest-hired first.
 * Anyone finished (profile saved, all four carriers confirmed, or a request submitted) is counted and tucked away.
 * The viewer's own row and admin logins are never listed: the owner opening the page is not an agent starting.
 */
export function ContractingLinkActivity() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["contracting-link-activity"], queryFn: fetchLinkActivity, staleTime: 30_000, refetchOnWindowFocus: true });
  const [search, setSearch] = useState("");
  const [showFinished, setShowFinished] = useState(false);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) => !s || r.display_name.toLowerCase().includes(s));
  }, [q.data, search]);
  const clicked = rows.filter((r) => r.bucket === "clicked_not_finished");
  const never = rows.filter((r) => r.bucket === "never_clicked");
  const finished = rows.filter((r) => r.bucket === "finished");

  const link = `${typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org"}/dashboard/contracting-profile`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Contracting link copied. Paste it in a text."); }
    catch { toast.error("Could not copy. Long-press the link instead."); }
  };
  const go = (mutate: (p: URLSearchParams) => void) => { const next = new URLSearchParams(params); mutate(next); navigate({ search: `?${next.toString()}` }, { replace: true }); };
  const openPerson = (r: LinkActivityRow) => go((p) => { p.set("person", r.agent_id); });
  const openReview = (r: LinkActivityRow) => go((p) => { p.set("view", "contracting"); p.set("review", r.agent_id); p.delete("person"); });

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (q.isError || !q.data) {
    return <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">The list did not load. <button type="button" className="font-semibold underline" onClick={() => void qc.invalidateQueries({ queryKey: ["contracting-link-activity"] })}>Retry</button></p>;
  }
  const c = q.data.counts;

  const Row = ({ r }: { r: LinkActivityRow }) => {
    const stuck = r.bucket === "clicked_not_finished";
    const meta = stuck
      ? `Opened ${ago(r.last_opened_at)}${r.opens > 1 ? ` · ${r.opens} times` : ""} · first ${day(r.first_opened_at)} · nothing saved`
      : r.bucket === "never_clicked" ? `Never opened · hired ${day(r.start_date)}`
      : r.profile_saved ? `Profile saved${r.details_saved ? ", DOB + address on file" : ", DOB + address still missing"}` : r.marked_count === 4 ? "All four carriers confirmed" : `Request ${(r.request_status ?? "").replace(/_/g, " ")}`;
    return (
      <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
        <button type="button" onClick={() => openPerson(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open ${r.display_name}`}>
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", stuck ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : r.bucket === "finished" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground")} aria-hidden>{initials(r.display_name)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{r.display_name}</span>
            <span className="block truncate text-xs text-muted-foreground">{meta}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => void copyLink()} aria-label={`Copy the contracting link for ${r.display_name}`}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
          <Button type="button" variant="outline" size="sm" className="h-9 text-xs" onClick={() => openReview(r)}>Review</Button>
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-5" aria-label="Contracting link">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Who clicked the contracting link and never finished</h2>
          <p className="text-sm text-muted-foreground">Tap a name to call or text them. Finished people are kept out of the way.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => void copyLink()}><Copy className="h-4 w-4" aria-hidden /> Copy link</Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.clicked_not_finished}</p><p className="text-xs text-muted-foreground">clicked, never finished</p></div>
        <div className="rounded-xl border border-border bg-card px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.never_clicked}</p><p className="text-xs text-muted-foreground">never clicked</p></div>
        <div className="rounded-xl border border-border bg-card px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.finished}</p><p className="text-xs text-muted-foreground">finished</p></div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a name" aria-label="Search people" className="h-11 pl-9" />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Clicked, never finished · {clicked.length}</h3>
        {clicked.length === 0
          ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground" role="status">Nobody is stuck on the link right now.</p>
          : <ul className="space-y-2">{clicked.map((r) => <Row key={r.agent_id} r={r} />)}</ul>}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Never clicked · {never.length}</h3>
        {never.length === 0
          ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground" role="status">Everyone has opened it.</p>
          : <ul className="space-y-2">{never.map((r) => <Row key={r.agent_id} r={r} />)}</ul>}
      </div>

      <div>
        <button type="button" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}>
          Finished · {finished.length} <ChevronDown className={cn("h-4 w-4 transition-transform", showFinished && "rotate-180")} aria-hidden />
        </button>
        {showFinished ? (finished.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nobody yet.</p> : <ul className="mt-2 space-y-2">{finished.map((r) => <Row key={r.agent_id} r={r} />)}</ul>) : null}
      </div>
    </section>
  );
}
