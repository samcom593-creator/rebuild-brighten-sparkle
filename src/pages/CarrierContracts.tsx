import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, CheckCircle2, Clock, XCircle, Send, Award, Copy, Briefcase, Phone, Check } from "lucide-react";
import { format } from "date-fns";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

interface ContractRow {
  carrier_id: number;
  carrier_name: string | null;
  carrier_logo: string | null;
  status: string | null;
  writing_number: string | null;
  contract_number: string | null;
  activated_date: string | null;
  carrier_portal_url: string | null;
  contracting_speed: number | null;
}

// wave-72 audit fix: 'submitted' was border-blue-500/40 bg-blue-500/5 text-blue-700
// — palette violation breaking AgentLink slate/amber/emerald/rose-only contract.
// Swapped to slate (matches the Submitted summary chip already used on the same
// page) so per-row status pill + section heading + summary chip all align.
const STATUS_META: Record<string, { label: string; icon: React.ElementType; tint: string }> = {
  active: { label: "Active", icon: CheckCircle2, tint: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" },
  pending_upline_assignment: { label: "Pending upline", icon: Clock, tint: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
  submitted: { label: "Submitted", icon: Send, tint: "border-slate-500/40 bg-slate-500/5 text-slate-700 dark:text-slate-300" },
  rejected: { label: "Rejected", icon: XCircle, tint: "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300" },
};

// wave-72 audit fix: render-order priority for grouped status sections. Was a
// hard-coded `as const` 5-tuple in the render loop which silently dropped any
// new status the view emits (e.g. 'terminated', 'in_review'). Now: priority
// orders the known statuses, unknown statuses append in alpha order so they
// surface instead of vanish.
const STATUS_PRIORITY = ["active", "pending_upline_assignment", "submitted", "rejected", "none"] as const;

/**
 * CarrierContracts — v22 Wave B (2026-06-10)
 *
 * Sam: "Send out contract requests for American Home Life and Combined
 * Chubb through the website. They use InsurancePay. Build the way."
 *
 * Phase 1 (shipped): admin grid showing every carrier with current contract
 * status + writing number + direct-link to carrier portal (e.g. Chubb's
 * insuranceadmin.com URL). Sam can jump straight to the carrier dashboard
 * to manage in-flight contracts. Data mirrors AgentLink's
 * /api/contract-requests endpoint, synced via apex_carrier_contracts table.
 *
 * Phase 2 (next): in-app contract submission form — file an upline
 * request that pushes to InsurancePay / Surancebay API on submit, sets
 * status to 'submitted', notifies Sam via Telegram.
 */
interface MyContractRow {
  id: string;
  carrier_id: number;
  carrier_name: string | null;
  carrier_logo: string | null;
  carrier_website: string | null;
  carrier_phone: string | null;
  contract_invite_url: string | null;
  writing_number: string | null;
  contract_number: string | null;
  commission_level_id: string | null;
  status: string | null;
  activated_date: string | null;
  appointment_date: string | null;
  carrier_portal_url: string | null;
}

export default function CarrierContracts() {
  usePageTitle("Carrier Contracts · APEX");
  const { isAdmin, user } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 2026-06-14 Sam-directive: per-agent contracts surface BEFORE admin grid.
  // Each row shows carrier + writing # + level + portal link + INVITE LINK.
  // "What it should do is just copy the link · agent number and account level"
  const myContracts = useQuery({
    queryKey: ["my-contracts", (user as any)?.id],
    enabled: !!(user as any)?.id,
    queryFn: async (): Promise<MyContractRow[]> => {
      const { data } = await supabase
        .from("v_my_carrier_contracts" as any)
        .select("*")
        .eq("user_id", (user as any).id);
      return ((data ?? []) as unknown) as MyContractRow[];
    },
  });

  // Master AgentLink invite link from system_settings
  const masterInvite = useQuery({
    queryKey: ["agentlink-master-invite"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings" as any)
        .select("value")
        .eq("key", "agentlink_master_invite")
        .maybeSingle();
      return (data as any)?.value as { url: string; label: string } | null;
    },
    staleTime: 60 * 60_000,
  });

  const copyLink = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success("Link copied");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const contracts = useQuery({
    queryKey: ["carrier-contracts-summary"],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase
        .from("v_apex_contracts_summary" as any)
        .select("*");
      if (error) throw error;
      return ((data ?? []) as unknown) as ContractRow[];
    },
  });

  const grouped = useMemo(() => {
    const byStatus: Record<string, ContractRow[]> = {
      active: [],
      pending_upline_assignment: [],
      submitted: [],
      rejected: [],
      none: [],
    };
    for (const row of contracts.data ?? []) {
      const k = row.status ?? "none";
      (byStatus[k] ??= []).push(row);
    }
    return byStatus;
  }, [contracts.data]);

  // For non-admins: render ONLY the per-agent section
  if (!isAdmin) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
        <PageHeader
          eyebrow="Your Contracts"
          eyebrowIcon={<Award className="h-3 w-3" />}
          title="My Carrier Contracts"
          subtitle="Your active writing numbers, levels, and direct portal links."
        />
        <MyContractsSection
          rows={myContracts.data ?? []}
          isLoading={myContracts.isLoading}
          masterInvite={masterInvite.data ?? null}
          copyLink={copyLink}
          copiedId={copiedId}
        />
      </div>
    );
  }

  const totalActive = grouped.active?.length ?? 0;
  const totalPending = (grouped.pending_upline_assignment?.length ?? 0) + (grouped.submitted?.length ?? 0);
  const totalNone = grouped.none?.length ?? 0;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Carriers · Contracts"
        eyebrowIcon={<Award className="h-3 w-3" />}
        title="Carrier contracts"
        subtitle="Your contracts + agency-wide grid · tap Copy to share contract links"
      />

      {/* 2026-06-14 NEW · Sam's contracts at the top (writing # · level · portal · invite copy) */}
      <MyContractsSection
        rows={myContracts.data ?? []}
        isLoading={myContracts.isLoading}
        masterInvite={masterInvite.data ?? null}
        copyLink={copyLink}
        copiedId={copiedId}
      />

      <div className="border-t border-border/40 pt-3">
        <p className="text-11 font-semibold uppercase tracking-wider text-muted-foreground">Agency-wide grid · admin only</p>
      </div>

      {/* v26 audit fix: isError state was missing (silent failure). Added below. */}
      {contracts.isLoading ? (
        <>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40" />
        </>
      ) : contracts.isError ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="Couldn't load contracts"
          description={`Query failed: ${(contracts.error as any)?.message?.slice(0, 80) ?? "unknown error"}. Check Supabase RLS or v_apex_contracts_summary view.`}
        />
      ) : (contracts.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No contracts synced yet"
          description="Run the AgentLink sync from /admin or wait for the next cron tick. Contracts will surface here automatically."
        />
      ) : (
        <>
          {/* v26 audit fix: 4-up KPI tile grid → single inline summary strip.
              Was: 4 tall tiles eating ~120px. Now: one chip row with same
              counts but ~32px tall. Matches AgentLink restraint. */}
          <div className="flex flex-wrap gap-2 text-12">
            <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-2.5 py-1">
              <span className="font-bold tabular-nums">{totalActive}</span> &nbsp;Active
            </Badge>
            <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 px-2.5 py-1">
              <span className="font-bold tabular-nums">{grouped.pending_upline_assignment?.length ?? 0}</span> &nbsp;Pending
            </Badge>
            <Badge variant="outline" className="bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300 px-2.5 py-1">
              <span className="font-bold tabular-nums">{grouped.submitted?.length ?? 0}</span> &nbsp;Submitted
            </Badge>
            <Badge variant="outline" className="bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 px-2.5 py-1">
              <span className="font-bold tabular-nums">{grouped.rejected?.length ?? 0}</span> &nbsp;Rejected
            </Badge>
          </div>

          {/* Status sections — rows hover directly against page bg
              (no card-within-card double-surface per audit complaint).
              wave-72: dynamic key iteration so an unrecognized status from
              the view (e.g. 'terminated', 'in_review') still renders instead
              of being silently dropped by a hard-coded 5-tuple. */}
          {(() => {
            const known = new Set<string>(STATUS_PRIORITY);
            const unknownKeys = Object.keys(grouped).filter((k) => !known.has(k)).sort();
            const ordered = [...STATUS_PRIORITY, ...unknownKeys];
            return ordered.map((s) => {
              const rows = grouped[s] ?? [];
              if (rows.length === 0) return null;
              return (
                <section key={s} className="space-y-2">
                  <p className="text-11 font-semibold uppercase tracking-wider text-slate-500 pt-2">
                    {s === "none" ? "Not contracted yet" : STATUS_META[s]?.label ?? s} · {rows.length}
                  </p>
                  <div className="space-y-2">
                    {rows.map((row, i) => (
                      <ContractRowView key={`${row.carrier_id}-${i}`} row={row} />
                    ))}
                  </div>
                </section>
              );
            });
          })()}
        </>
      )}
    </div>
  );
}

// wave-72 audit fix: removed dead SummaryTile component (lines 166-190 pre-wave-72).
// v26 audit collapsed the 4-up KPI tile grid into inline summary chips above,
// so SummaryTile has had zero call sites since that ship. The component still
// hard-coded `bg-blue-500` for 'submitted', shipping the palette violation in
// any future re-introduction. Deleting kills the dead code + the latent bug.
// Card/CardContent/CardHeader/CardTitle imports cleaned up — only SummaryTile
// used them.

function ContractRowView({ row }: { row: ContractRow }) {
  const meta = row.status ? STATUS_META[row.status] : null;
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-base">
      {row.carrier_logo ? (
        <img src={row.carrier_logo} alt={row.carrier_name ?? ""} className="h-9 w-9 rounded object-contain bg-white" />
      ) : (
        <div className="h-9 w-9 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-12 font-semibold text-slate-500">
          {row.carrier_name?.[0] ?? "—"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {/* wave-73 audit fix: was `flex items-center gap-2 flex-wrap` which let
            badges drop to a second line when carrier_name was long, swinging
            row height 56→88px on every long-name row. Removed flex-wrap +
            added min-w-0 so the name truncates first and badges stay inline.
            Badge shrink-0 keeps the meta + fast pills at full width. */}
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-14 font-semibold truncate flex-1 min-w-0">{row.carrier_name ?? "—"}</p>
          {meta && (
            <Badge variant="outline" className={`text-11 shrink-0 ${meta.tint}`}>
              {meta.label}
            </Badge>
          )}
          {row.contracting_speed && row.contracting_speed > 1 && (
            // wave-73 audit fix: was `Badge variant="outline"` with no explicit
            // tint — fell back to the default --border CSS var, off-palette in
            // both themes. Swapped to amber-400 (gold-accent register matching
            // brand-bible #C9A961) distinct from amber-500 "Pending" so the
            // speed signal reads as a positive modifier without colliding with
            // the status palette. shrink-0 holds it inline with meta + name.
            <Badge variant="outline" className="text-11 shrink-0 border-amber-400/40 bg-amber-400/5 text-amber-700 dark:text-amber-300">⚡ fast</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-12 text-slate-500 mt-1">
          {row.writing_number && (
            <span>Writing #: <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{row.writing_number}</span></span>
          )}
          {row.contract_number && (
            <span>Contract: <span className="font-mono">{row.contract_number}</span></span>
          )}
          {row.activated_date && (
            <span>Activated {format(new Date(row.activated_date), "MMM d, yyyy")}</span>
          )}
          {!row.status && (
            <span className="text-amber-700 dark:text-amber-400 italic">No contract yet — request via portal</span>
          )}
        </div>
      </div>
      {row.carrier_portal_url && (
        <Button asChild size="sm" variant="outline">
          <a href={row.carrier_portal_url} target="_blank" rel="noopener noreferrer">
            Portal <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
      )}
    </div>
  );
}

/**
 * MyContractsSection · 2026-06-14
 * Sam: "It should just be like the contract is — your agent number and
 * account level. The contract links that I have placed inside of [the carrier],
 * a lot of people took to put in their login crazily so you can harvest the
 * data and do the same thing for them. So right there, [agents] should let
 * them kind of see when they have contracts."
 *
 * Each carrier row shows: logo · carrier name · status badge · writing #
 * · level · activated date · Portal button · Contract LINK copy button.
 */
function MyContractsSection({
  rows, isLoading, masterInvite, copyLink, copiedId,
}: {
  rows: MyContractRow[];
  isLoading: boolean;
  masterInvite: { url: string; label: string } | null;
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
}) {
  const active = rows.filter((r) => r.status === "active");
  const pending = rows.filter((r) => r.status && r.status !== "active");

  return (
    <>
      {/* Master AgentLink invite — top action */}
      {masterInvite && (
        <Card className="border-amber-500/30 bg-amber-500/[0.04]">
          <CardContent className="p-3 flex items-center gap-3">
            <Award className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-12 font-bold">{masterInvite.label}</p>
              <p className="text-11 text-muted-foreground truncate font-mono">{masterInvite.url}</p>
            </div>
            <Button
              size="sm"
              variant={copiedId === "master" ? "default" : "outline"}
              className={copiedId === "master" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              onClick={() => copyLink("master", masterInvite.url)}
            >
              {copiedId === "master" ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy</>}
            </Button>
            <Button asChild size="sm">
              <a href={masterInvite.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active contracts */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : active.length === 0 && pending.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-6 w-6" />}
          title="No carrier contracts on file yet"
          description="Once you contract through APEX, your writing numbers + levels show up here. Ask your manager to send you carrier invite links."
        />
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-2">
              <p className="text-11 font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Active · {active.length}
              </p>
              <div className="space-y-2">
                {active.map((row) => <MyContractRowView key={row.id} row={row} copyLink={copyLink} copiedId={copiedId} />)}
              </div>
            </section>
          )}
          {pending.length > 0 && (
            <section className="space-y-2">
              <p className="text-11 font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 pt-2">
                Pending · {pending.length}
              </p>
              <div className="space-y-2">
                {pending.map((row) => <MyContractRowView key={row.id} row={row} copyLink={copyLink} copiedId={copiedId} />)}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function MyContractRowView({
  row, copyLink, copiedId,
}: {
  row: MyContractRow;
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
}) {
  const meta = row.status ? STATUS_META[row.status] : null;
  const inviteUrl = row.contract_invite_url ?? row.carrier_portal_url ?? row.carrier_website;
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-base">
      {row.carrier_logo ? (
        <img src={row.carrier_logo} alt="" className="h-10 w-10 rounded object-contain bg-white shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-13 font-bold text-slate-500 shrink-0">
          {(row.carrier_name ?? "?").slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-14 font-bold truncate">{row.carrier_name ?? "—"}</p>
          {meta && (
            <Badge variant="outline" className={`text-11 shrink-0 ${meta.tint}`}>{meta.label}</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-11 text-muted-foreground">
          {row.writing_number && (
            <span><span className="opacity-70">Writing #:</span> <span className="font-mono font-semibold text-foreground tabular-nums">{row.writing_number}</span></span>
          )}
          {row.contract_number && (
            <span><span className="opacity-70">Contract #:</span> <span className="font-mono font-semibold text-foreground tabular-nums">{row.contract_number}</span></span>
          )}
          {row.commission_level_id && (
            <span><span className="opacity-70">Level:</span> <span className="font-semibold text-foreground">{row.commission_level_id}</span></span>
          )}
          {row.activated_date && (
            <span><span className="opacity-70">Activated:</span> <span className="font-semibold text-foreground">{format(new Date(row.activated_date), "MMM d, yyyy")}</span></span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {row.carrier_phone && (
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <a href={`tel:${row.carrier_phone}`}><Phone className="h-3.5 w-3.5" /></a>
          </Button>
        )}
        {inviteUrl && (
          <Button
            size="sm"
            variant={copiedId === row.id ? "default" : "outline"}
            className={copiedId === row.id ? "bg-emerald-600 hover:bg-emerald-700" : ""}
            onClick={() => copyLink(row.id, inviteUrl)}
          >
            {copiedId === row.id ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Link</>}
          </Button>
        )}
        {row.carrier_portal_url && (
          <Button asChild size="sm">
            <a href={row.carrier_portal_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Portal
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
