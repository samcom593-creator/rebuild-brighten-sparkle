import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useUIStore } from "@/shared/store/uiStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { useRolePreview } from "@/hooks/useRolePreview";
import {
  AGENT_CLOUD_ACCOUNT_NAV,
  AGENT_CLOUD_PRIMARY_NAV,
  APPLICANT_NAV,
  filterAgentCloudNav,
  flattenAgentCloudNav,
} from "@/components/layout/agentCloudNavigation";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Inbox,
  Bell,
  Settings as SettingsIcon,
  Image as ImageIcon,
  TrendingUp,
  Activity,
  FileText,
  UserPlus,
  ShoppingCart,
  Trash2,
} from "lucide-react";

interface AgentResult {
  id: string; name: string; email: string | null; phone: string | null; code: string | null;
  status: string | null; license: string | null; stage: string | null; upline: string | null;
}
interface ApplicationResult { id: string; name: string; email: string | null; phone: string | null; status: string | null; license: string | null; applied_at: string | null }
const STAGE_LABEL: Record<string, string> = { online_training: "Online training", training: "Training", released_in_field: "Released in field" };

type RouteRole = "any" | "agent" | "manager" | "admin";
interface RouteEntry {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  /** Minimum role required to even SEE this in the palette. */
  requires?: RouteRole;
}

/**
 * Pages the sidebar does not list but the palette still offers. Primary
 * destinations come from agentCloudNavigation.ts (see navRoutes below), so the
 * palette and the sidebar can never disagree on what exists or who may open
 * it. Every path here is a live route in App.tsx (no legacy redirects), and
 * `requires` is never wider than that route's guard.
 */
const EXTRA_ROUTES: RouteEntry[] = [
  { label: "Command Center", path: "/dashboard/admin", icon: Activity, group: "Navigate", requires: "admin" },
  { label: "Unclaimed Leads", path: "/dashboard/admin/unclaimed", icon: TrendingUp, group: "Navigate", requires: "admin" },
  { label: "Hiring Pipeline", path: "/dashboard/hiring-pipeline", icon: UserPlus, group: "Navigate", requires: "manager" },
  { label: "Aged Leads", path: "/dashboard/aged-leads", icon: Users, group: "Navigate", requires: "manager" },
  { label: "Inbox", path: "/dashboard/inbox", icon: Inbox, group: "Navigate", requires: "admin" },
  { label: "My Notifications", path: "/dashboard/notifications/mine", icon: Bell, group: "Navigate" },
  { label: "Notification Hub", path: "/dashboard/notifications", icon: Bell, group: "Navigate", requires: "admin" },
  { label: "Award Graphics", path: "/dashboard/awards", icon: ImageIcon, group: "Navigate", requires: "admin" },
  { label: "Purchase Leads", path: "/purchase-leads", icon: ShoppingCart, group: "Navigate" },
  { label: "Automation Hub", path: "/dashboard/automation", icon: Activity, group: "Navigate", requires: "admin" },
  { label: "System Health", path: "/dashboard/system-health", icon: Activity, group: "Navigate", requires: "admin" },
  { label: "Deleted Leads Vault", path: "/dashboard/settings/deleted-leads", icon: Trash2, group: "Navigate", requires: "admin" },
  { label: "Seminar Control", path: "/dashboard/seminar-control", icon: Calendar, group: "Navigate", requires: "manager" },
  { label: "Referral Pipeline", path: "/dashboard/referrals", icon: UserPlus, group: "Navigate", requires: "manager" },
  { label: "Submit Referral", path: "/dashboard/referrals/new", icon: UserPlus, group: "Navigate" },
  { label: "My Referrals", path: "/dashboard/referrals/mine", icon: UserPlus, group: "Navigate" },
  { label: "Settings", path: "/dashboard/settings", icon: SettingsIcon, group: "Navigate" },
];

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  // Same store the sidebar search uses, so both surfaces open the identical drawer.
  const openAgentProfile = useAgentProfileDrawer((s) => s.openAgent);
  const { isAdmin, isManager, isAgent, hasAgentRecord, isVa, isVaManager, isRecruiter, isLoading: authLoading, effectiveMode } = useAuth();
  const { isPreviewing, effectiveRole } = useRolePreview();
  // Applications search opens the recruiting workspace, whose route guard
  // admits admins, managers, VAs, VA managers and recruiters. Nobody else is
  // offered applicant results they could not open.
  const canOpenRecruiting = isAdmin || isManager || isVa || isVaManager || isRecruiter;
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<AgentResult[]>([]);
  const [applications, setApplications] = useState<ApplicationResult[]>([]);

  // Primary destinations: the sidebar's own entries, filtered by the sidebar's
  // own rule (same viewer, same role preview, same applicant nav), so Cmd+K
  // offers exactly what the sidebar offers.
  const navRoutes = useMemo<RouteEntry[]>(() => {
    const viewMode = isPreviewing ? effectiveRole : effectiveMode;
    const seesAll = isAdmin && !isPreviewing;
    const isApplicant = !authLoading && !isAdmin && !isManager && isAgent && !hasAgentRecord && !isPreviewing;
    const primary = isApplicant ? APPLICANT_NAV : filterAgentCloudNav(AGENT_CLOUD_PRIMARY_NAV, { seesAll, viewMode });
    const account = filterAgentCloudNav(AGENT_CLOUD_ACCOUNT_NAV, { seesAll, viewMode });
    return flattenAgentCloudNav([...primary, ...account]).map((link) => ({
      label: link.label,
      path: link.href,
      icon: (link.icon ?? LayoutDashboard) as RouteEntry["icon"],
      group: "Navigate",
    }));
  }, [authLoading, effectiveMode, effectiveRole, hasAgentRecord, isAdmin, isAgent, isManager, isPreviewing]);

  // Only show extra routes the current role can actually open. Previously this
  // exposed every admin route to every user, leading to access-denied bounces.
  const visibleRoutes = useMemo(() => {
    const navPaths = new Set(navRoutes.map((r) => r.path.split("?")[0]));
    const extras = EXTRA_ROUTES.filter((r) => {
      if (navPaths.has(r.path)) return false;
      const req = r.requires ?? "any";
      if (req === "any") return true;
      if (req === "agent") return true; // any authenticated user
      if (req === "manager") return isAdmin || isManager;
      if (req === "admin") return isAdmin;
      return true;
    });
    return [...navRoutes, ...extras];
  }, [isAdmin, isManager, navRoutes]);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  // Voice-to-chat: listen for apex:voice-prompt events and prefill the palette
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ transcript: string }>).detail;
      if (!detail?.transcript) return;
      setQuery(detail.transcript);
      setOpen(true);
    };
    window.addEventListener("apex:voice-prompt", handler as EventListener);
    return () => window.removeEventListener("apex:voice-prompt", handler as EventListener);
  }, [setOpen]);

  // One scoped server search (search_people): every piece of what was typed must match somewhere in the person's
  // name, email, phone digits or agent code, in any order. Escaping and role scope live in the function.
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  useEffect(() => {
    if (!open || query.trim().length < 2) { setAgents([]); setApplications([]); setSearchState("idle"); return; }
    let cancelled = false;
    setSearchState("loading");
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_people", { p_q: query, p_limit: 8 });
      if (cancelled) return;
      const r = data as unknown as { ok?: boolean; agents?: AgentResult[]; applicants?: ApplicationResult[] } | null;
      if (error || !r?.ok) { setAgents([]); setApplications([]); setSearchState("error"); return; }
      setAgents(r.agents ?? []);
      setApplications(canOpenRecruiting ? r.applicants ?? [] : []);
      setSearchState("ok");
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, open, canOpenRecruiting]);

  const filteredRoutes = useMemo(() => {
    if (!query) return visibleRoutes;
    const q = query.toLowerCase();
    return visibleRoutes.filter((r) => r.label.toLowerCase().includes(q));
  }, [query, visibleRoutes]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} commandProps={{ shouldFilter: false }}>
      <CommandInput
        placeholder="Type any part of a name, email, phone or code… (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{searchState === "loading" ? "Searching…" : searchState === "error" ? "The people search did not answer. Try again." : "No results found."}</CommandEmpty>

        {filteredRoutes.length > 0 && (
          <CommandGroup heading="Navigate">
            {filteredRoutes.map((route) => {
              const Icon = route.icon;
              return (
                <CommandItem
                  key={route.path}
                  value={`nav-${route.label}`}
                  onSelect={() => go(route.path)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span>{route.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="People on the team">
              {agents.map((a) => (
                <CommandItem
                  key={`agent-${a.id}`}
                  value={`agent-${a.id}`}
                  // 2026-07-29: was go(`/dashboard/team`) — a template literal with no
                  // interpolation, so a.id was discarded and every agent row landed on the
                  // same unfiltered CRM list (/dashboard/team is itself just a redirect to
                  // /dashboard/crm, which is admin+manager only — so agents and VAs got
                  // bounced to /dashboard entirely). The sidebar's identical search already
                  // does the right thing via openAgentProfile; this now mirrors it.
                  onSelect={() => {
                    setOpen(false);
                    setQuery("");
                    openAgentProfile(a.id);
                  }}
                >
                  <Users className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                    {[a.stage ? STAGE_LABEL[a.stage] ?? a.stage : null, a.license === "licensed" ? "Licensed" : null, a.status && a.status !== "active" ? a.status : null, a.upline ? `Upline ${a.upline}` : null].filter(Boolean).join(" · ")}
                  </span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{a.code ?? a.email ?? a.phone ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {applications.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Applicants">
              {applications.map((app) => (
                <CommandItem
                  key={`app-${app.id}`}
                  value={`app-${app.id}`}
                  // 2026-07-29: same bug — app.id was dropped, so picking a named
                  // applicant opened the unfiltered list. DashboardApplicants already reads
                  // ?id= to focus a row. 2026-10-06: the worklist is now the default view at
                  // the canonical /dashboard/recruiting and it selects a row by ?person=.
                  onSelect={() => go(`/dashboard/recruiting?queue=all_open&person=${app.id}`)}
                >
                  <FileText className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{app.name || "Name not on file"}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{[app.status ? `Applicant · ${app.status.replace(/_/g, " ")}` : "Applicant", app.license === "licensed" ? "Licensed" : null].filter(Boolean).join(" · ")}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{app.email ?? app.phone ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
