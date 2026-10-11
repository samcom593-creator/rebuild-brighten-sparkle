import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
  const { user, isAdmin, isManager, isAgent, hasAgentRecord, isVa, isVaManager, isRecruiter, isLoading: authLoading, effectiveMode } = useAuth();
  const { isPreviewing, effectiveRole } = useRolePreview();
  // Applications search opens the recruiting workspace, whose route guard
  // admits admins, managers, VAs, VA managers and recruiters. Nobody else is
  // offered applicant results they could not open.
  const canOpenRecruiting = isAdmin || isManager || isVa || isVaManager || isRecruiter;
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
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
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || authLoading || !canOpenRecruiting || query.trim().length === 1) {
      setAgents([]); setApplications([]); setSearchState("idle"); return;
    }
    let cancelled = false;
    setAgents([]);
    setApplications([]);
    setSearchState("loading");
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("search_people", { p_q: query.trim(), p_limit: query.trim() ? 8 : 4 });
        if (cancelled) return;
        const r = data as unknown as { ok?: boolean; agents?: AgentResult[]; applicants?: ApplicationResult[] } | null;
        if (error || !r?.ok) { setSearchState("error"); return; }
        setAgents(r.agents ?? []);
        setApplications(r.applicants ?? []);
        // Async people arrive after the quick links; Enter should open the first person.
        if (r.agents?.[0]) setSelectedValue(`agent-${r.agents[0].id}`);
        else if (r.applicants?.[0]) setSelectedValue(`app-${r.applicants[0].id}`);
        setSearchState("ok");
      } catch {
        if (!cancelled) setSearchState("error");
      }
    }, query.trim() ? 150 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, open, canOpenRecruiting, authLoading, user?.id, retry]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const filteredRoutes = useMemo(() => {
    if (!query.trim()) return navRoutes.slice(0, 5);
    const q = query.trim().toLowerCase();
    return visibleRoutes.filter((r) => r.label.toLowerCase().includes(q));
  }, [query, visibleRoutes, navRoutes]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} commandProps={{ shouldFilter: false, value: selectedValue, onValueChange: setSelectedValue }}>
      <CommandInput
        aria-label="Search people and pages"
        placeholder="Search name, email, phone or agent code"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[min(65dvh,520px)]" aria-busy={searchState === "loading"}>
        {searchState === "loading" && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Finding people…</p>}
        {searchState === "error" && (
          <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>People could not load.</span>
            <button type="button" className="min-h-11 rounded-md px-3 font-medium text-primary hover:bg-accent" onClick={() => setRetry((n) => n + 1)}>Try again</button>
          </div>
        )}
        {canOpenRecruiting && query.trim().length === 1 && <p className="px-4 py-3 text-sm text-muted-foreground">Type at least two characters to find someone.</p>}
        {!query.trim() && canOpenRecruiting && searchState === "ok" && <p className="px-4 pt-3 text-xs text-muted-foreground">Recently added people · search to find anyone you can access</p>}
        <CommandEmpty>{searchState === "loading" || searchState === "error" || query.trim().length === 1 ? null : "No matches. Try another part of the name, email or phone."}</CommandEmpty>


        {agents.length > 0 && (
          <>
            <CommandGroup heading="People on the team">
              {agents.map((a) => (
                <CommandItem
                  key={`agent-${a.id}`}
                  value={`agent-${a.id}`}
                  onSelect={() => {
                    setOpen(false);
                    setQuery("");
                    openAgentProfile(a.id);
                  }}
                >
                  <Users className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.email || a.code || "Team member"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[a.stage ? STAGE_LABEL[a.stage] ?? a.stage : null, a.status && a.status !== "active" ? a.status.replace(/_/g, " ") : null, a.upline ? `Upline: ${a.upline}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {applications.length > 0 && (
          <>
            <CommandGroup heading="Applicants">
              {applications.map((app) => (
                <CommandItem
                  key={`app-${app.id}`}
                  value={`app-${app.id}`}
                  onSelect={() => go(`/dashboard/recruiting?queue=all_open&person=${app.id}`)}
                >
                  <FileText className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{app.name || "Name not on file"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{app.email || "Applicant"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{app.status?.replace(/_/g, " ") || "Application received"}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {filteredRoutes.length > 0 && (
          <CommandGroup heading={query.trim() ? "Pages" : "Quick links"}>
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

      </CommandList>
    </CommandDialog>
  );
}
