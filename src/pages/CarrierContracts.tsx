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
import {
  ContractsBoard, useContractSummary, useContractRows,
} from "@/components/contracting/ContractsBoard";

/**
 * Contracting — carrier appointments, commission levels, writing numbers.
 *
 * 2026-08-23: the Contracts view showed a grid of share links and not one
 * contract. Its only contract source was v_my_carrier_contracts filtered
 * `.eq("user_id", user.id)`, and that view carries 0 of 21 rows with a
 * non-null user_id — so it returned nothing for every viewer since the day it
 * shipped. agentlink_contracts held 467 real rows that no screen displayed.
 * Contracts and Documents now read the real book through
 * apex_contracts_list / apex_contracts_summary (server-aggregated counts,
 * scope-resolved in one place so rows and headline cannot disagree).
 *
 * The share-link grid was not deleted — it moved to Requests, where sending a
 * link is the action, instead of standing in for the contracts themselves.
 */

type Carrier = { id: number; name: string | null; website: string | null };

export default function CarrierContracts() {
  const pathname = useLocation().pathname;
  const mode = pathname.endsWith("/contracts") ? "contracts"
    : pathname.endsWith("/carriers") ? "carriers"
    : pathname.endsWith("/ops") ? "ops"
    : pathname.endsWith("/documents") ? "documents"
    : "requests";
  usePageTitle(`${mode.charAt(0).toUpperCase() + mode.slice(1)} · APEX`);
  const { isAdmin, isManager } = useAuth();
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
        .from("agentlink_carriers" as never)
        .select("id, name, website")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Carrier[];
    },
  });

  const workspaceNav = (
    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Contracting sections">
      {([
        ["requests", "/dashboard/contracting", "Requests"],
        ["carriers", "/dashboard/contracting/carriers", "Carriers"],
        ["contracts", "/dashboard/contracting/contracts", "Contracts"],
        ["ops", "/dashboard/contracting/ops", "Operations"],
        ["documents", "/dashboard/contracting/documents", "Documents"],
      ] as const).map(([key, to, label]) => (
        <Button
          key={key}
          asChild
          variant="ghost"
          className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
        >
          <Link to={to}>{label}</Link>
        </Button>
      ))}
    </nav>
  );

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
    : mode === "requests" ? "Contracting Requests"
    : "Contract Documents";
  const subtitle = mode === "carriers"
    ? "Active carrier access, portals, and contracting availability."
    : mode === "ops"
    ? "Licensing, carrier contracting, writing numbers, compensation and hierarchy — prepared here, submitted through whichever system each carrier requires."
    : mode === "requests"
    ? "Start and monitor producer contracting requests."
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
          <StartContractingCard copyLink={copyLink} copiedId={copiedId} />
          <ContractingIntakeAdmin showEmptyState />
        </>
      )}
      {mode === "documents" && <ContractDocuments />}
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

      <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
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
            const href = carrier.website;
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

function ContractingOps({ canInvite, isAdmin }: { canInvite: boolean; isAdmin: boolean }) {
  const summaryQ = useContractSummary("agency", "");
  const s = summaryQ.data ?? { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };

  const stats: Array<[string, number, string]> = [
    ["Contracts on file", s.total, "Across the agency book"],
    ["Active appointments", s.active, "Writing today"],
    ["Requests in progress", (s.by_status.requested ?? 0) + (s.by_status.submitted ?? 0) + (s.by_status.pending_upline_assignment ?? 0), "Requested, submitted or awaiting upline"],
    ["Needs attention", s.issues, s.issues > 0 ? "Issue, jail or rejected" : "Nothing outstanding"],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <GlassCard key={label} className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
            {summaryQ.isLoading ? <Skeleton className="mt-1 h-8 w-14" /> : <p className="mt-0.5 text-3xl font-bold tabular-nums">{value}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Requests by status</h3>
          {summaryQ.isLoading ? (
            <div className="mt-3 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : Object.keys(s.by_status).length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-7 w-7" />}
              title="No contracting requests yet"
              description="A request appears here when a producer needs a new carrier contract, transfer, state appointment or hierarchy change."
            />
          ) : (
            <ul className="mt-3 space-y-1.5">
              {Object.entries(s.by_status)
                .sort((a, b) => b[1] - a[1])
                .map(([key, n]) => (
                  <li key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                    <span className="capitalize">{key.replace(/_/g, " ")}</span>
                    <span className="font-bold tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
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

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
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

function StartContractingCard({
  copyLink, copiedId,
}: {
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
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
            Five fields create one spreadsheet row and one private contracting Discord post. No agent invite link is used.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href="/start-contracting">Open the intake</a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => copyLink("start-contracting-link", intakeUrl)}>
              {copiedId === "start-contracting-link"
                ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
                : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy shareable link</>}
            </Button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
