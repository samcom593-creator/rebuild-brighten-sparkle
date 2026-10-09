import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import {
  ExternalLink, Copy, Check, Link2, ClipboardList,
  FileSignature, Building2, Files, Settings2, Search, UserPlus,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ContractingIntakeAdmin } from "@/components/contracting/ContractingIntakeAdmin";
import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";
import { ContractingAuditPanel } from "@/components/contracting/ContractingAuditPanel";
import { EthosContractingHealth } from "@/components/contracting/EthosContractingHealth";
import { CarrierCasesWorkspace } from "@/components/contracting/CarrierCasesWorkspace";
import {
  ContractsBoard, useContractSummary, useContractRows,
} from "@/components/contracting/ContractsBoard";
import { externalHref } from "@/lib/externalHref";

/**
 * Contracting. The front page is the manual portal review: find a person, correct their five profile fields, confirm
 * the four carriers (Combine, AFLAC, GTO, Ethos) and set their placement level. It is the SAME review My Team shows,
 * the same component over the same records, so the two cannot disagree.
 *
 * Carrier contracting itself happens in each carrier's own portal. Nothing here submits to a carrier.
 *
 * The older tabs (requests, carrier directory, contracts board, cases, operations, documents, audit, Ethos) are kept as
 * "Earlier records": history and reference, not the working flow.
 */

type Carrier = { id: string; name: string | null; website: string | null };

export default function CarrierContracts() {
  const pathname = useLocation().pathname;
  const mode = pathname.endsWith("/requests") ? "requests"
    : pathname.endsWith("/contracts") ? "contracts"
    : pathname.endsWith("/carriers") ? "carriers"
    : pathname.endsWith("/ops") ? "ops"
    : pathname.endsWith("/documents") ? "documents"
    : pathname.endsWith("/audit") ? "audit"
    : pathname.endsWith("/ethos") ? "ethos"
    : pathname.endsWith("/cases") ? "cases"
    : "review";
  usePageTitle(`${mode === "review" ? "Contracting" : mode.charAt(0).toUpperCase() + mode.slice(1)} · Galaxy`);
  const { isAdmin, isManager, isVa, isVaManager } = useAuth();
  const isContractingStaff = !!(isAdmin || isVa || isVaManager);
  const canInvite = !!(isAdmin || isManager);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      toast.error("Couldn't copy. Long-press to share instead.");
    }
  };

  const carriersQ = useQuery({
    queryKey: ["link-hub-carriers"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Carrier[]> => {
      const { data, error } = await supabase
        .from("carriers" as never)
        .select("id, name, website")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Carrier[];
    },
  });

  // Each tab is offered only to the roles its route admits (src/App.tsx):
  // every contracting route is requireAdmin, and only /cases and /ethos also
  // let va_manager and va through. A tab a role cannot open would bounce it.
  const reviewItem = [["review", "/dashboard/contracting", "Review"]] as Array<[string, string, string]>;
  const earlierItems = [
    ...(isAdmin ? [
      ["requests", "/dashboard/contracting/requests", "Requests"],
      ["carriers", "/dashboard/contracting/carriers", "Carriers"],
      ["contracts", "/dashboard/contracting/contracts", "Contracts board"],
    ] : []),
    ...(isContractingStaff ? [["cases", "/dashboard/contracting/cases", "Cases"]] : []),
    ...(isAdmin ? [
      ["aflac", "/dashboard/contracting/aflac", "Aflac sends"],
      ["ops", "/dashboard/contracting/ops", "Operations"],
      ["documents", "/dashboard/contracting/documents", "Documents"],
      ["audit", "/dashboard/contracting/audit", "Audit"],
    ] : []),
    ...(isContractingStaff ? [["ethos", "/dashboard/contracting/ethos", "Ethos"]] : []),
  ] as Array<[string, string, string]>;

  const navButton = ([key, to, label]: [string, string, string]) => (
    <Button
      key={key}
      asChild
      variant="ghost"
      className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
    >
      <Link to={to} aria-current={mode === key ? "page" : undefined}>{label}</Link>
    </Button>
  );
  const workspaceNav = (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-border" aria-label="Contracting sections">
      {reviewItem.map(navButton)}
      {earlierItems.length > 0 ? <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Earlier records</span> : null}
      {earlierItems.map(navButton)}
    </nav>
  );

  if (mode === "review") {
    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Contracting"
          eyebrowIcon={<ClipboardList className="h-4 w-4" />}
          title="Contracting review"
          subtitle="Find a person, check their profile, confirm Combine, AFLAC, GTO and Ethos, and set their placement level."
        />
        {workspaceNav}
        {canInvite ? <ContractingLinkCard copyLink={copyLink} copiedId={copiedId} /> : null}
        <GlassCard className="p-3 sm:p-4"><ContractingReviewWorkspace /></GlassCard>
      </div>
    );
  }

  if (mode === "contracts") {
    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Contracting"
          eyebrowIcon={<Link2 className="h-3 w-3" />}
          title="Contracts"
          subtitle="Carrier appointments, commission levels, writing numbers, and transfers — all in one place."
        />
        {workspaceNav}
        <ContractsBoard canInvite={canInvite} canSeeImo={!!isAdmin} initialScope="agency" />
      </div>
    );
  }

  const title = mode === "carriers" ? "Carrier Directory"
    : mode === "ops" ? "Contracting Operations"
    : mode === "requests" ? (canInvite ? "Contracting Requests" : "Start Contracting")
    : mode === "audit" ? "Contracting Audit"
    : mode === "ethos" ? "Ethos Contracting"
    : mode === "cases" ? "Carrier Cases"
    : "Contract Documents";
  const subtitle = mode === "carriers"
    ? "Active carrier access, portals, and contracting availability."
    : mode === "ops"
    ? "Licensing, carrier contracting, writing numbers, compensation and hierarchy — prepared here, submitted through whichever system each carrier requires."
    : mode === "requests"
    ? (canInvite
      ? "Start and monitor producer contracting requests."
      : "Use the details already on your profile, add only what's missing, and start your carrier setup.")
    : mode === "cases"
    ? "Every agent × carrier: lifecycle, blocker and accountable owner, worked queue by queue."
    : mode === "ethos"
    ? "Verify, approve and submit each producer to the Ethos sheet once — then reconcile what Ethos does with it."
    : mode === "audit"
    ? "Every agent against imported AgentLink carrier records and the Ethos sheet: valid NPN, profile, upline, carrier contracts, Ethos level. One next action each."
    : "Writing numbers, contract numbers, and appointment records for the producers you cover.";

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={
          mode === "carriers" ? <Building2 className="h-4 w-4" />
          : mode === "ops" ? <Settings2 className="h-4 w-4" />
          : mode === "documents" ? <Files className="h-4 w-4" />
          : <ClipboardList className="h-4 w-4" />
        }
        title={title}
        subtitle={subtitle}
      />
      {workspaceNav}

      {mode === "carriers" && <CarrierDirectory carriersQ={carriersQ} />}
      {mode === "ops" && <ContractingOps canInvite={canInvite} isAdmin={!!isAdmin} />}
      {mode === "requests" && (
        <>
          <StartContractingCard copyLink={copyLink} copiedId={copiedId} canShare={canInvite} />
          {canInvite && <ContractingIntakeAdmin showEmptyState />}
        </>
      )}
      {mode === "documents" && <ContractDocuments />}
      {mode === "ethos" && <EthosContractingHealth />}
      {mode === "cases" && <CarrierCasesWorkspace />}
      {mode === "audit" && (isAdmin ? <ContractingAuditPanel /> : <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Admins only" description="The contracting audit is an admin surface." />)}
    </div>
  );
}

/* ───────────────────────── Carrier Directory ───────────────────────── */

function CarrierDirectory({ carriersQ }: {
  carriersQ: { data?: Carrier[]; isLoading: boolean; error: unknown };
}) {
  const [search, setSearch] = useState("");
  const all = carriersQ.data ?? [];
  const rows = all.filter((c) => !search || (c.name ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carriers" className="pl-9" data-testid="carrier-search" />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{rows.length}</span> of{" "}
          <span className="font-semibold tabular-nums text-foreground">{all.length}</span> active carriers
        </p>
      </div>

      <div className="border-b border-border bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
        Contracting is recorded through the shared spreadsheet and then posted to the private contracting Discord. No invite link is used.
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px] border-b border-border bg-muted/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Contracting</span><span>Access</span>
      </div>

      {carriersQ.isLoading ? (
        <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title={all.length === 0 ? "No active carriers" : "No carrier matches that search"}
          description={all.length === 0 ? "No carrier records are currently visible for this workspace." : "Clear the search to see every active carrier."}
        />
      ) : (
        <ul>
          {rows.map((carrier) => {
            // Raw DB text in an href is not a link to that site: a scheme-less
            // value resolves relative to this page and lands in the catch-all (MP-495).
            const href = externalHref(carrier.website);
            return (
              <li key={carrier.id} className="grid grid-cols-2 items-center gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_140px_120px]">
                <span className="truncate font-medium">{carrier.name ?? `Carrier ${carrier.id}`}</span>
                <span className="text-muted-foreground">Spreadsheet workflow</span>
                <span className="justify-self-end sm:justify-self-auto">
                  {href ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Website <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No URL on file</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Operations ───────────────────────── */

type CaseQueue = { key: string; label: string; cases: number };

function ContractingOps({ canInvite, isAdmin }: { canInvite: boolean; isAdmin: boolean }) {
  // Carrier cases (one agent x one carrier) are the contracting source of truth. The legacy
  // contracts summary read an empty table, so this page showed "0 · Nothing outstanding" over
  // 200+ live cases. A failed read shows the error, never a zero.
  const digestQ = useQuery({
    queryKey: ["contracting-ops-digest"],
    staleTime: 60_000,
    queryFn: async (): Promise<CaseQueue[]> => {
      const { data, error } = await supabase.rpc("contracting_exception_digest" as never);
      if (error) throw new Error(error.message);
      return (data as { queues?: CaseQueue[] } | null)?.queues ?? [];
    },
  });
  const queues = digestQ.data ?? [];
  const count = (key: string) => queues.find((q) => q.key === key)?.cases ?? 0;

  // [label, value, note, queue key]. Each tile opens the queue it counts.
  const stats: Array<[string, number, string, string]> = [
    ["Verified · ready to write", count("verified"), "Carrier cases confirmed", "verified"],
    ["Ready to submit", count("ready_to_submit"), "Prepared, not sent yet", "ready_to_submit"],
    ["With carriers", count("carrier_review"), "Submitted, awaiting the carrier", "carrier_review"],
    ["Needs staff action", count("staff_action"), `${count("agent_action")} waiting on agents · ${count("support")} with support`, "staff_action"],
  ];

  return (
    <div className="space-y-5">
      {digestQ.isError ? (
        <GlassCard className="p-4 text-sm text-destructive" role="alert">
          Couldn't load contracting cases: {(digestQ.error as Error).message}
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(([label, value, note, queueKey]) => (
            <Link key={label} to={`/dashboard/contracting/cases?queue=${queueKey}`} className="block rounded-lg focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
              <GlassCard className="h-full p-4 transition-colors hover:border-primary/40">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
                {digestQ.isLoading ? <Skeleton className="mt-1 h-8 w-14" /> : <p className="mt-0.5 text-3xl font-bold tabular-nums">{value}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{note}</p>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Carrier cases by queue</h3>
          {digestQ.isLoading ? (
            <div className="mt-3 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : digestQ.isError ? (
            <p className="mt-3 text-sm text-muted-foreground">Unavailable until the case read succeeds.</p>
          ) : queues.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-7 w-7" />}
              title="No carrier cases yet"
              description="A case opens when an agent needs a carrier contract, then moves through documents, submission and carrier review to verified."
            />
          ) : (
            <>
              <ul className="mt-3 space-y-1.5">
                {queues.map((q) => (
                  <li key={q.key}>
                    <Link to={`/dashboard/contracting/cases?queue=${encodeURIComponent(q.key)}`} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm transition-colors hover:border-primary/40">
                      <span>{q.label}</span>
                      <span className="font-bold tabular-nums">{q.cases}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">One case is one agent with one carrier. A case can sit in more than one queue, so these don't add up to a total.</p>
            </>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Quick actions</h3>
          {/* Every entry navigates somewhere real AND somewhere this viewer is
              allowed to land. /dashboard/contracting/requests and /documents are
              requireAdmin routes (App.tsx), but they used to render for every
              authenticated agent — a plain agent who clicked either one was
              bounced by the route guard. An action that is visible but refused
              is the same failure as an action wired to nothing, so each entry is
              now gated on the guard its own destination enforces. */}
          <div className="mt-3 grid grid-cols-1 gap-2">
            {canInvite && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/admin/invite-links"><UserPlus className="h-4 w-4" /> Invite an agent</Link>
              </Button>
            )}
            {isAdmin && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/dashboard/contracting/requests"><ClipboardList className="h-4 w-4" /> Start a contracting request</Link>
              </Button>
            )}
            <Button asChild variant="outline" className="justify-start">
              <Link to="/dashboard/contracting/carriers"><Building2 className="h-4 w-4" /> Carrier directory</Link>
            </Button>
            {isAdmin && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/dashboard/contracting/documents"><Files className="h-4 w-4" /> Writing numbers</Link>
              </Button>
            )}
          </div>
        </GlassCard>
      </div>

      <ContractingIntakeAdmin showEmptyState />
    </div>
  );
}

/* ───────────────────────── Requests in flight ───────────────────────── */

function RequestsInFlight() {
  const rowsQ = useContractRows("agency", "requested", "", 0);
  const rows = rowsQ.data ?? [];
  return (
    <GlassCard className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Carrier requests in flight</h3>
      </div>
      {rowsQ.isLoading ? (
        <div className="p-4"><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="No requested contracts" description="Carrier contracts sitting in a requested state appear here." />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-3">
              <span className="truncate font-medium">{r.carrier_name ?? "Carrier not on file"}</span>
              <span className="truncate text-muted-foreground">{r.agent_name ?? "Producer not on file"}</span>
              <span className="truncate text-xs text-muted-foreground">
                {r.requested_at ? `Requested ${new Date(r.requested_at).toLocaleDateString()}` : "Request date not on file"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Documents ───────────────────────── */

function ContractDocuments() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const summaryQ = useContractSummary("agency", search);
  const rowsQ = useContractRows("agency", status, search, 0);
  const rows = rowsQ.data ?? [];
  const s = summaryQ.data ?? { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };
  const shown = status === "all" ? s.total : (s.by_status[status] ?? 0);

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carrier, producer, or writing number" className="pl-9" data-testid="documents-search" />
        </div>
        {(["all", "active", "submitted", "requested"] as const).map((k) => (
          <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)} className="capitalize" data-testid={`doc-status-${k}`}>
            {k === "all" ? "All statuses" : k}
          </Button>
        ))}
        <p className="w-full text-xs text-muted-foreground sm:w-auto">
          <span className="font-semibold tabular-nums text-foreground">{shown}</span> records
        </p>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)] border-b border-border bg-muted/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Producer</span><span>Status</span><span>Contract record</span>
      </div>

      {rowsQ.isLoading ? (
        <div className="p-4"><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Files className="h-7 w-7" />}
          title="No contract records match"
          description="Writing numbers and contract numbers appear here once a carrier issues them. Expiry alerts, including E&O certificates, appear when a verified document source is connected. Clear the search or widen the status filter."
        />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)]">
              <span className="truncate font-medium">{r.carrier_name ?? "Carrier not on file"}</span>
              <span className="truncate text-muted-foreground">{r.agent_name ?? "Producer not on file"}</span>
              <span className="truncate capitalize text-muted-foreground">{(r.status ?? "unknown").replace(/_/g, " ")}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {r.writing_number ? `Writing # ${r.writing_number}` : r.contract_number ? `Contract # ${r.contract_number}` : "No number issued yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Shared pieces ───────────────────────── */

/**
 * The contracting link. One link for everyone: it opens the signed-in "Complete your contracting profile" page, where the
 * person's own details are prefilled and they add the rest. Staff type no name and no email to make it, and it works the
 * same for every agent. Copying it sends nothing.
 */
function ContractingLinkCard({ copyLink, copiedId }: { copyLink: (id: string, url: string) => Promise<void>; copiedId: string | null }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";
  const url = `${origin}/dashboard/contracting-profile`;
  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Contracting link</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Send this to any agent. They sign in, check the details we already have, and add their NPN, name, email and resident state. You type nothing.</p>
        </div>
        <Button size="sm" variant="outline" className="h-10" onClick={() => copyLink("contracting-profile-link", url)}>
          {copiedId === "contracting-profile-link"
            ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
            : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy contracting link</>}
        </Button>
      </div>
    </GlassCard>
  );
}

function StartContractingCard({
  copyLink, copiedId, canShare,
}: {
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
  canShare: boolean;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";
  const intakeUrl = `${origin}/start-contracting`;

  return (
    <GlassCard className="border-primary/30 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FileSignature className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Start contracting</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Saved profile and application details fill automatically. The producer adds only what's missing, then one request starts the spreadsheet and private support workflow.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href="/start-contracting">Open the intake</a>
            </Button>
            {canShare && (
              <Button size="sm" variant="outline" onClick={() => copyLink("start-contracting-link", intakeUrl)}>
                {copiedId === "start-contracting-link"
                  ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
                  : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy shareable link</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
