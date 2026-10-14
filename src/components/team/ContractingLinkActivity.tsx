import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchLinkActivity, type LinkActivityRow } from "@/lib/contractingRequests";
import { Copy, Search } from "lucide-react";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function Step({ on, label }: { on: boolean; label: string }) {
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "border-border text-muted-foreground")}>{label}</span>;
}

/**
 * My Team › Contracting link: who opened the contracting link, newest first, with how far they got (profile saved,
 * carrier details saved, carriers confirmed), then everyone who has not opened it yet, oldest hire first, so the
 * list reads top to bottom as "work through these" (Sam, 2026-10-14).
 */
export function ContractingLinkActivity() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["contracting-link-activity"], queryFn: fetchLinkActivity, staleTime: 30_000 });
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) => !s || r.display_name.toLowerCase().includes(s));
  }, [q.data, search]);
  const opened = rows.filter((r) => r.opened);
  const notYet = rows.filter((r) => !r.opened);
  const link = `${typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org"}/dashboard/contracting-profile`;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Contracting link copied."); }
    catch { toast.error("Could not copy. Long-press the link instead."); }
  };
  const openReview = (r: LinkActivityRow) => {
    const next = new URLSearchParams(params);
    next.set("view", "contracting"); next.set("review", r.agent_id); next.delete("person");
    navigate({ search: `?${next.toString()}` }, { replace: true });
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading link activity…</p>;
  if (q.isError || !q.data) {
    return <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">The link activity did not load. <button type="button" className="font-semibold underline" onClick={() => void qc.invalidateQueries({ queryKey: ["contracting-link-activity"] })}>Retry</button></p>;
  }

  const Row = ({ r }: { r: LinkActivityRow }) => (
    <li className="grid gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{r.display_name}</p>
        <p className="text-xs text-muted-foreground">
          {r.opened ? `Opened ${ago(r.last_opened_at)} · ${r.opens} open${r.opens === 1 ? "" : "s"} · first ${day(r.first_opened_at)}` : `Not opened yet · hired ${day(r.start_date)}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Step on={r.profile_saved} label={r.profile_saved ? "Profile saved" : "Profile not saved"} />
        <Step on={r.details_saved} label={r.details_saved ? "DOB + address" : "DOB + address missing"} />
        <Step on={r.marked_count === 4} label={`${r.marked_count} of 4 carriers`} />
        {r.request_status ? <Step on={r.request_status === "approved" || r.request_status === "submitted"} label={`Request ${r.request_status.replace(/_/g, " ")}`} /> : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-10 md:h-9" onClick={() => openReview(r)}>Open in review</Button>
    </li>
  );

  return (
    <section className="space-y-4" aria-label="Contracting link activity">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contracting link</h2>
          <p className="text-sm text-muted-foreground">{q.data.opened} of {q.data.count} opened the link. Openers first, newest on top; then everyone who should have started.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => void copyLink()}><Copy className="h-4 w-4" aria-hidden /> Copy contracting link</Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" aria-label="Search people" className="h-11 pl-9" />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opened the link · {opened.length}</h3>
        {opened.length === 0 ? <p className="text-sm text-muted-foreground" role="status">Nobody has opened it yet.</p> : <ul className="space-y-2">{opened.map((r) => <Row key={r.agent_id} r={r} />)}</ul>}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Should have started · {notYet.length}</h3>
        {notYet.length === 0 ? <p className="text-sm text-muted-foreground" role="status">Everyone has opened it.</p> : <ul className="space-y-2">{notYet.map((r) => <Row key={r.agent_id} r={r} />)}</ul>}
      </div>
    </section>
  );
}
