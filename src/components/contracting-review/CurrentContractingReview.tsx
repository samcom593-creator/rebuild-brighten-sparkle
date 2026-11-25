import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useContractReview } from "@/hooks/useContractReview";
import { levelText, teamOptions } from "@/lib/contractReview";
import { CONTRACTING_LINK_URL } from "@/lib/contractingLinks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CarrierContractsPanel } from "@/components/team/CarrierContractsPanel";
import { ReviewDetailsDrawer } from "./ReviewDetailsDrawer";

/**
 * The roster supplies authorized people, profile details and placement levels only. Current receipts are read
 * separately from the existing team carrier-status RPC; old portal-circle counts never determine this view.
 */
export function CurrentContractingReview({ className }: { className?: string }) {
  const review = useContractReview(true);
  const { isAdmin, isManager } = useAuth();
  const [params] = useSearchParams();
  const linkedAgent = params.get("review");
  const [selectedId, setSelectedId] = useState<string | null>(linkedAgent);
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [managerId, setManagerId] = useState("all");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const agents = useMemo(() => review.roster?.agents ?? [], [review.roster]);
  const teams = useMemo(() => teamOptions(agents), [agents]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return agents.filter((a) => (managerId === "all" || a.manager_id === managerId)
      && (!needle || [a.display_name, a.email, a.profile.npn].some((v) => v?.toLowerCase().includes(needle))));
  }, [agents, managerId, search]);
  const missingLink = !!linkedAgent && !!review.roster && !agents.some((a) => a.agent_id === linkedAgent);
  const selected = visible.find((a) => a.agent_id === selectedId) ?? (missingLink ? undefined : visible[0]);
  const detailsAgent = agents.find((a) => a.agent_id === detailsId);

  useEffect(() => { setSelectedId(linkedAgent); }, [linkedAgent]);

  if (!review.canRead) return <p className={cn("text-sm text-muted-foreground", className)}>Contracting records are available to admins, managers and their support team.</p>;
  if (review.query.isLoading) return <p role="status" className={cn("text-sm text-muted-foreground", className)}>Loading contracting profiles…</p>;
  if (review.query.isError || !review.roster) return (
    <div role="alert" className={cn("space-y-2 rounded-lg border border-destructive/40 p-4", className)}>
      <p className="text-sm">Contracting profiles did not load. No receipt status is inferred.</p>
      <Button variant="outline" size="sm" onClick={() => void review.query.refetch()}>Retry contracting profiles</Button>
    </div>
  );

  return (
    <section aria-label="Agent contract receipts" className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent contract receipts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Select an agent to check their saved profile and received contracts. Available contracting options are confirmed in MGN.</p>
        </div>
        <Button asChild variant="outline"><a href={CONTRACTING_LINK_URL} target="_blank" rel="noopener noreferrer">Open MGN portal</a></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setSelectedId(null); }} placeholder="Search name, email or NPN" aria-label="Search contracting agents" />
        {teams.length > 1 ? <select value={managerId} onChange={(e) => { setManagerId(e.target.value); setSelectedId(null); }} aria-label="Contracting team" className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All visible teams</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select> : null}
      </div>
      {missingLink ? <p role="status" className="text-sm text-muted-foreground">The linked agent is not in this authorized roster. Choose an available agent.</p> : null}
      {visible.length ? <label className="block space-y-1 text-sm font-medium">
        <span>Agent · {visible.length} available</span>
        <select aria-label="Choose contracting agent" value={selected?.agent_id ?? ""} onChange={(e) => setSelectedId(e.target.value)} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
          {!selected ? <option value="">Choose an agent</option> : null}
          {visible.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.display_name}</option>)}
        </select>
      </label> : <p role="status" className="text-sm text-muted-foreground">{agents.length ? "No agents match this search." : "No active agents are available in this roster."}</p>}
      {selected ? <article aria-label={`Contracting records for ${selected.display_name}`} className="space-y-4 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold">{selected.display_name}</h3>
            <p className="break-words text-sm text-muted-foreground">{selected.profile.email ?? selected.email ?? "Email not on file"}</p>
          </div>
          <Button variant="outline" onClick={() => setDetailsId(selected.agent_id)}>Profile and placement level</Button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Profile</dt><dd className="font-medium">{selected.profile.complete ? "Details saved" : "Details incomplete"}</dd></div>
          <div><dt className="text-muted-foreground">Resident state</dt><dd className="font-medium">{selected.profile.resident_state ?? "Not on file"}</dd></div>
          <div><dt className="text-muted-foreground">Placement level</dt><dd className="font-medium">{levelText(selected.level)}</dd></div>
        </dl>
        {isAdmin || isManager ? <CarrierContractsPanel key={selected.agent_id} agentId={selected.agent_id} /> : <p className="text-sm text-muted-foreground">Admins and managers record carrier contract receipts.</p>}
        <p className="text-sm text-muted-foreground">A saved profile or a submission receipt does not establish carrier approval.</p>
      </article> : null}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium underline" to={isAdmin ? "/dashboard/contracting?view=legacy" : "/dashboard/team?view=contracting&reviewMode=legacy"}>Historical carrier review</Link>
      <ReviewDetailsDrawer open={!!detailsAgent} onOpenChange={(open) => { if (!open) setDetailsId(null); }} agent={detailsAgent} carriers={[]} canEdit={review.canEdit}
        isSaving={review.isPending} onToggle={(a, c, value) => { void review.setCircle(a.agent_id, c, value); }} onSaveProfile={review.saveProfile} onSetLevel={review.setLevel}
        hasNext={false} onSaveAndNext={() => setDetailsId(null)} />
    </section>
  );
}
