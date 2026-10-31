import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ClipboardCheck, Download, KeyRound, Link2, Mail, MoreHorizontal, Phone, RefreshCw, Send, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useTeamWorkspace } from "@/hooks/useTeamWorkspace";
import { useTeamFacts } from "@/hooks/useTeamFacts";
import { usePortalLoginSender } from "@/hooks/usePortalLoginSender";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { type RosterRow } from "@/lib/teamRoster";
import { ROSTER_PARTS, partRows } from "@/lib/productionMetrics";
import { foldMergedTwins, teamStage, type TeamMember } from "@/lib/teamList";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { TeamEngagementPanel } from "@/components/dashboard/TeamEngagementPanel";
import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";
import { TeamAttendance } from "@/components/team/TeamAttendance";
import { ContractingCallList } from "@/components/team/ContractingCallList";
import { TeamList } from "@/components/team/TeamList";
import { TeamPersonDrawer, type TeamPersonManage } from "@/components/team/TeamPersonDrawer";

/**
 * My Team (OVERHAUL-myteam, 2026-10-31). Sam: "I literally just look at it and it gave me a full headache."
 *
 * One list (src/components/team/TeamList.tsx): four numbers that each open their list, then everyone on the
 * team in the order to work them, each row showing their step in colour and words and one button. Tapping a
 * person opens their card (?person=), which manages their training stage, work days, login and roster status.
 *
 * The support jobs keep their own views, one tap away under the tabs and in the URL (?view=): Attendance,
 * Contracting (the carrier review), Contracting calls, and for the owner Logins (who signed in, what was
 * sent, course progress). ?view=overview, the old name of the list, still lands on it.
 *
 * Every number and row reads the roster functions, which are authorised server-side (admin, manager, VA
 * manager and VA see the agency or their downline; an agent sees their own team), so a VA with no agent
 * record of their own still reads the agency roster.
 */
interface RosterContact {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

type Mode = "team" | "attendance" | "work" | "link" | "logins";
const VIEWS: Array<{ key: Mode; label: string; param: string; icon: typeof Users; adminOnly?: boolean }> = [
  { key: "team", label: "Team", param: "team", icon: Users },
  { key: "attendance", label: "Attendance", param: "attendance", icon: ClipboardCheck },
  { key: "work", label: "Contracting", param: "contracting", icon: ShieldCheck },
  { key: "link", label: "Contracting calls", param: "link", icon: Phone },
  { key: "logins", label: "Logins", param: "logins", icon: KeyRound, adminOnly: true },
];
/** ?view=overview is the list's old name; a link that still carries it lands on the list. */
const modeFromParam = (v: string | null): Mode | null => (v === "overview" ? "team" : VIEWS.find((m) => m.param === v)?.key ?? null);

/** Merged duplicates for these agent ids, read in groups of 100 ids so the request stays short. */
async function readCanonicalMap(agentIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < agentIds.length; i += 100) {
    const result = await supabase.from("v_agent_canonical_map").select("agent_id, canonical_agent_id").in("agent_id", agentIds.slice(i, i + 100));
    for (const row of partRows<{ agent_id: string | null; canonical_agent_id: string | null }>(ROSTER_PARTS.canonical, result)) {
      if (row.agent_id && row.canonical_agent_id) map.set(row.agent_id, row.canonical_agent_id);
    }
  }
  return map;
}

export default function DashboardCRM() {
  usePageTitle("My Team");
  const { user, isAdmin, isManager, isVa, isVaManager, isLoading: authLoading } = useAuth();
  const { agentId: myAgentId } = useAgentIdentity();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayKey = useBusinessToday();
  const portalLogins = usePortalLoginSender();
  const [viewAppTarget, setViewAppTarget] = useState<{ agentId: string } | null>(null);
  const [deactivateAgent, setDeactivateAgent] = useState<{ id: string; name: string; managerId?: string } | null>(null);
  const [editLoginAgent, setEditLoginAgent] = useState<{ id: string; name: string } | null>(null);

  // The canonical roster: who is on this team, with their production, contacts and free-lead status.
  const rosterQuery = useQuery({
    queryKey: ["crm-agent-roster"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterRow[]> => {
      const [rosterResult, pulseResult, contactResult, freeLeadsResult] = await Promise.all([
        supabase.rpc("crm_agent_roster" as never),
        supabase.rpc("crm_agent_sales_pulse" as never),
        supabase.rpc("crm_agent_contacts" as never),
        supabase.rpc("crm_agent_free_leads_status" as never),
      ]);
      // partRows tags a failure with the read that produced it, so the error names the part that did not load. A
      // part that stops exactly at the platform page limit may be cut short, so it fails too rather than showing a
      // roster that quietly ends.
      const rosterRows = partRows<RosterRow>(ROSTER_PARTS.roster, rosterResult);
      const pulseRows = partRows<Pick<RosterRow, "agent_id" | "today_alp" | "today_deals" | "selling_streak_days">>(ROSTER_PARTS.salesPulse, pulseResult);
      const contactRows = partRows<RosterContact>(ROSTER_PARTS.contacts, contactResult);
      const freeLeadsRows = partRows<{ agent_id: string; qualifies: boolean; reason: string; needed_for_qual: number | string }>(ROSTER_PARTS.freeLeads, freeLeadsResult);
      const pulseByAgent = new Map(pulseRows.map((row) => [row.agent_id, row] as const));
      const contactByAgent = new Map(contactRows.map((row) => [row.agent_id, row] as const));
      const freeLeadsByAgent = new Map(freeLeadsRows.map((row) => [row.agent_id, row] as const));
      const merged = rosterRows.map((row) => ({
        ...row,
        full_name: contactByAgent.get(row.agent_id)?.full_name ?? row.full_name,
        email: contactByAgent.get(row.agent_id)?.email ?? row.email,
        phone: contactByAgent.get(row.agent_id)?.phone ?? row.phone,
        today_alp: pulseByAgent.get(row.agent_id)?.today_alp ?? 0,
        today_deals: pulseByAgent.get(row.agent_id)?.today_deals ?? 0,
        selling_streak_days: pulseByAgent.get(row.agent_id)?.selling_streak_days ?? 0,
        free_leads_qualified: freeLeadsByAgent.get(row.agent_id)?.qualifies ?? false,
        free_leads_reason: freeLeadsByAgent.get(row.agent_id)?.reason ?? null,
        free_leads_needed_for_qual: freeLeadsByAgent.get(row.agent_id)?.needed_for_qual ?? null,
      }));
      // crm_agent_roster() lists a merged duplicate as its own person, with whatever was posted under its id. Fold
      // each into its canonical person so nobody is listed twice or shows "no sale" while the duplicate holds it.
      return foldMergedTwins(merged, await readCanonicalMap(merged.map((row) => row.agent_id)));
    },
  });

  // MP-361: every handler below invalidates and ignores the payload, so a burst of row events needs ONE refetch.
  const CRM_COALESCE_MS = 750;
  const refreshRoster = useCallback(() => { void queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] }); }, [queryClient]);
  useRealtimeTable({ table: "agents", channelSuffix: "crm", coalesceMs: CRM_COALESCE_MS }, refreshRoster);
  useRealtimeTable({ table: "deals", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, refreshRoster);
  useRealtimeTable({ table: "agentlink_book", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, refreshRoster);
  useRealtimeTable({ table: "production_external_daily_snapshots", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, refreshRoster);
  useRealtimeTable({ table: "production_external_deals", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, refreshRoster);

  const rows = useMemo(() => rosterQuery.data ?? [], [rosterQuery.data]);
  const team = useTeamWorkspace(rows, !rosterQuery.isLoading);
  const facts = useTeamFacts(team.contractingEnabled);
  const factsById = useMemo(() => new Map((facts.facts?.people ?? []).map((p) => [p.agent_id, p] as const)), [facts.facts]);
  const members = useMemo<TeamMember[]>(() => rows.map((row) => ({ row, facts: factsById.get(row.agent_id) ?? null })), [rows, factsById]);
  const factsState = !facts.canRead ? "none" : facts.facts ? "ready" : facts.query.isError ? "error" : "loading";

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    void queryClient.invalidateQueries({ queryKey: ["team-facts"] });
  }, [queryClient]);

  // Roles with no contracting access only ever see the list; the owner alone sees Logins.
  const requested = modeFromParam(searchParams.get("view")) ?? "team";
  const views = VIEWS.filter((v) => !v.adminOnly || isAdmin);
  const mode: Mode = team.contractingEnabled && views.some((v) => v.key === requested) ? requested : "team";
  const showView = (m: Mode) => {
    const next = new URLSearchParams(searchParams);
    if (m === "team") next.delete("view");
    else next.set("view", VIEWS.find((v) => v.key === m)!.param);
    setSearchParams(next, { replace: true });
  };

  // 2026-09-30 (Sam): "a button to download all agents: first name, last name, email, NPN."
  const downloadAgentsCsv = async () => {
    const { data, error } = await supabase.rpc("crm_agents_export" as never);
    if (error) { toast.error(`Export failed: ${error.message}`); return; }
    const exported = (data ?? []) as Array<Record<string, string | null>>;
    if (exported.length === 0) { toast.error("No agents to export."); return; }
    const cols = ["first_name", "last_name", "email", "npn", "phone", "status", "license_status", "manager_name", "agent_code", "start_date"];
    const cell = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...exported.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-agents-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${exported.length} agents.`);
  };
  const copyCheckInLink = async () => {
    try {
      await navigator.clipboard.writeText("https://apex-financial.org/agent-login");
      toast.success("Check-in link copied. Paste it into a text or DM.");
    } catch {
      toast.error("Could not copy. The link is apex-financial.org/agent-login.");
    }
  };

  // The person card's management actions. Each one is a receipt: it says what landed, never assumes.
  const selected = team.row;
  const selectedName = selected?.full_name ?? "This agent";
  const personFacts = team.selectedId ? factsById.get(team.selectedId) ?? null : null;
  const canManage = isAdmin || isManager;
  const checkIn = async (row: RosterRow) => {
    // The check-in stamp lives on the person's application (what last_contacted_at reads from), never invented on agents.
    const { data: agent, error: readError } = await supabase.from("agents").select("source_application_id").eq("id", row.agent_id).maybeSingle();
    if (readError) { toast.error(`Check-in did not save: ${readError.message}`); return; }
    if (!agent?.source_application_id) { toast.error(`${row.full_name ?? "This agent"} has no application on file to check in against.`); return; }
    const checkedInAt = new Date().toISOString();
    const { error } = await supabase.from("applications").update({ last_contacted_at: checkedInAt }).eq("id", agent.source_application_id);
    if (error) { toast.error(`Check-in did not save: ${error.message}`); return; }
    toast.success(`${row.full_name ?? "Agent"} marked checked in`);
    refreshAll();
  };
  const sendPortalLogin = async (row: RosterRow) => {
    try {
      const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: row.agent_id } });
      if (error) throw error;
      if ((data as { success?: boolean; error?: string } | null)?.success === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success(`Portal login sent to ${row.email ?? row.full_name ?? "the agent"}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to send"); }
  };
  const hideFromRoster = async (row: RosterRow) => {
    const { error } = await supabase.from("agents").update({ is_inactive: true }).eq("id", row.agent_id);
    if (error) { toast.error(`Could not hide: ${error.message}`); return; }
    toast.success(`${row.full_name ?? "Agent"} hidden from the roster`);
    team.closePerson();
    refreshAll();
  };
  const manage: TeamPersonManage | undefined = selected && team.contractingEnabled ? {
    facts: personFacts,
    factsLoading: facts.query.isLoading,
    canEdit: facts.canEdit,
    saving: (what) => facts.isPending(selected.agent_id, what),
    setStage: (s) => { void facts.setStage(selected.agent_id, selectedName, s); },
    setWorkdays: (days, from) => facts.setWorkdays(selected.agent_id, selectedName, days, from),
    ...(canManage ? {
      onCheckIn: () => { void checkIn(selected); },
      ...(isAdmin ? { onSendPortalLogin: () => { void sendPortalLogin(selected); } } : {}),
      onEditLogin: () => setEditLoginAgent({ id: selected.agent_id, name: selectedName }),
      onViewApplication: () => setViewAppTarget({ agentId: selected.agent_id }),
      onHide: () => { void hideFromRoster(selected); },
      onDeactivate: () => setDeactivateAgent({ id: selected.agent_id, name: selectedName, managerId: selected.manager_id ?? undefined }),
    } : {}),
  } : undefined;

  if (authLoading) return <PageLoadingSkeleton variant="table" />;

  const seesOthers = isAdmin || isManager || isVa || isVaManager;
  // One line on a 390px phone, where the header clamps the subtitle to one line.
  const subtitle = "Your team and the next step for each.";
  const currentView = views.find((v) => v.key === mode) ?? views[0];
  const CurrentViewIcon = currentView.icon;
  // The page's less frequent actions. Icon-only on a phone so it shares the list's control row; named from 640px.
  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 w-11 gap-1.5 bg-card px-0 sm:w-auto sm:px-4" aria-label="More actions">
          <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden /> <span className="hidden sm:inline">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {isAdmin ? (
          <DropdownMenuItem className="min-h-11" disabled={portalLogins.sending} onClick={() => portalLogins.send()}>
            <Mail className="mr-2 h-4 w-4" aria-hidden /> {portalLogins.sending ? "Sending..." : "Send portal logins (all)"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="min-h-11" onClick={() => { void copyCheckInLink(); }}>
          <Link2 className="mr-2 h-4 w-4" aria-hidden /> Copy check-in link
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onClick={() => { void downloadAgentsCsv(); }}>
          <Download className="mr-2 h-4 w-4" aria-hidden /> Download agents CSV
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onClick={refreshAll}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Reload
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // A list with no rows yet is how a new manager or agent first sees this page: give them the way to grow it.
  const emptyAction = canManage ? (
    <Button asChild variant="outline" className="h-11"><Link to="/admin/invite-links"><UserPlus className="h-4 w-4" aria-hidden /> Invite an agent</Link></Button>
  ) : !seesOthers ? (
    <Button asChild variant="outline" className="h-11"><Link to="/dashboard/referrals/new"><Send className="h-4 w-4" aria-hidden /> Refer a recruit</Link></Button>
  ) : undefined;

  const rosterStatus = rosterQuery.data !== undefined ? "ready" : rosterQuery.isError ? "error" : "loading";
  const staleSince = rosterQuery.data !== undefined && rosterQuery.isError ? rosterQuery.dataUpdatedAt : null;

  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 pt-4 sm:px-6">
        <PageHeader
          className="mb-0"
          icon={<Users />}
          tone="cool"
          title="My Team"
          subtitle={subtitle}
        />

        {team.contractingEnabled ? (
          // On a phone the views are one menu, so the list starts on the first screen; from 640px they are tabs.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 w-full justify-between bg-card px-4 text-[15px] sm:hidden" aria-label={`Team view: ${currentView.label}`}>
                <span className="inline-flex items-center gap-2">
                  <span className="font-normal text-muted-foreground">View:</span>
                  <CurrentViewIcon className={cn("h-4 w-4", TONE_CLASS.cool.text)} aria-hidden />
                  {currentView.label}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {views.map((v) => {
                const Icon = v.icon;
                return (
                  <DropdownMenuItem key={v.key} className={cn("min-h-11 gap-2 text-[15px]", mode === v.key && "font-semibold")} onSelect={() => showView(v.key)}>
                    <Icon className={cn("h-4 w-4", mode === v.key ? TONE_CLASS.cool.text : "text-muted-foreground")} aria-hidden /> {v.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {team.contractingEnabled ? (
          <div role="group" aria-label="Team view" className="hidden flex-wrap gap-x-1 border-b border-border sm:flex">
            {views.map((v) => {
              const Icon = v.icon;
              const isActive = mode === v.key;
              return (
                <button key={v.key} type="button" onClick={() => showView(v.key)} aria-pressed={isActive}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-[15px] font-medium leading-5 transition-colors",
                    "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}>
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive && TONE_CLASS.cool.text)} aria-hidden />
                  {v.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {mode === "team" ? (
          <TeamList
            members={members}
            status={rosterStatus}
            error={rosterQuery.error}
            staleSince={staleSince}
            fetching={rosterQuery.isFetching}
            onRetry={() => { void rosterQuery.refetch(); }}
            factsState={factsState}
            onRetryFacts={() => { void facts.query.refetch(); }}
            todayKey={todayKey}
            myAgentId={myAgentId}
            showUpline={seesOthers}
            selectedId={team.selectedId}
            onOpenPerson={team.openPerson}
            emptyAction={emptyAction}
            pageActions={moreMenu}
          />
        ) : mode === "attendance" ? (
          <TeamAttendance />
        ) : mode === "work" ? (
          <ContractingReviewWorkspace />
        ) : mode === "link" ? (
          <ContractingCallList />
        ) : (
          <TeamEngagementPanel />
        )}
      </div>

      <TeamPersonDrawer
        open={Boolean(team.selectedId) && Boolean(team.row)}
        onOpenChange={(o) => { if (!o) team.closePerson(); }}
        row={team.row}
        stage={team.row ? teamStage({ row: team.row, facts: personFacts }, todayKey) : undefined}
        manage={manage}
        onOpenContracting={(id) => {
          // Drive the URL: ?view=contracting is what this page reads, ?review= is what the review follows (and what a
          // shared link carries); dropping ?person= closes the drawer.
          const next = new URLSearchParams(searchParams);
          next.set("view", "contracting"); next.set("review", id); next.delete("person");
          setSearchParams(next, { replace: true });
        }}
      />

      <ApplicationDetailSheet open={!!viewAppTarget} onOpenChange={(o) => !o && setViewAppTarget(null)} agentId={viewAppTarget?.agentId} onRefresh={refreshAll} />
      <DeactivateAgentDialog open={!!deactivateAgent} onOpenChange={(o) => !o && setDeactivateAgent(null)} agentId={deactivateAgent?.id || ""} agentName={deactivateAgent?.name || ""} currentManagerId={deactivateAgent?.managerId} onComplete={() => { setDeactivateAgent(null); team.closePerson(); refreshAll(); }} />
      {editLoginAgent ? (
        <AgentQuickEditDialog open onOpenChange={(o) => !o && setEditLoginAgent(null)} agentId={editLoginAgent.id} currentName={editLoginAgent.name} onUpdate={refreshAll} />
      ) : null}
    </>
  );
}
