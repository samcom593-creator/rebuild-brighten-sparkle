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
import {
  LayoutDashboard,
  Users,
  Phone,
  GraduationCap,
  Calendar,
  Inbox,
  Bell,
  Settings as SettingsIcon,
  Image as ImageIcon,
  Briefcase,
  TrendingUp,
  Activity,
  FileText,
  UserPlus,
  ShoppingCart,
  Trash2,
} from "lucide-react";

interface AgentResult {
  id: string;
  display_name: string | null;
  agent_code: string | null;
}
interface ApplicationResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

type RouteRole = "any" | "agent" | "manager" | "admin";
interface RouteEntry {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  /** Minimum role required to even SEE this in the palette. */
  requires?: RouteRole;
}

const ROUTES: RouteEntry[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, group: "Navigate" },
  { label: "Command Center", path: "/dashboard/command", icon: Activity, group: "Navigate", requires: "admin" },
  { label: "Team Directory", path: "/dashboard/team", icon: Users, group: "Navigate", requires: "manager" },
  { label: "Hiring Pipeline", path: "/dashboard/hiring-pipeline", icon: UserPlus, group: "Navigate", requires: "manager" },
  { label: "Agent CRM", path: "/dashboard/crm", icon: Briefcase, group: "Navigate", requires: "manager" },
  { label: "Lead Center", path: "/dashboard/leads", icon: TrendingUp, group: "Navigate", requires: "admin" },
  { label: "Aged Leads", path: "/dashboard/aged-leads", icon: Users, group: "Navigate", requires: "manager" },
  { label: "Call Center", path: "/dashboard/call-center", icon: Phone, group: "Navigate" },
  { label: "Course Catalog", path: "/course-catalog", icon: GraduationCap, group: "Navigate" },
  { label: "Calendar", path: "/dashboard/calendar", icon: Calendar, group: "Navigate" },
  { label: "Inbox", path: "/dashboard/inbox", icon: Inbox, group: "Navigate", requires: "admin" },
  { label: "My Notifications", path: "/dashboard/notifications/mine", icon: Bell, group: "Navigate" },
  { label: "Notification Hub", path: "/dashboard/notifications", icon: Bell, group: "Navigate", requires: "admin" },
  { label: "Content Library", path: "/dashboard/content", icon: ImageIcon, group: "Navigate", requires: "manager" },
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
  const { isAdmin, isManager } = useAuth();
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<AgentResult[]>([]);
  const [applications, setApplications] = useState<ApplicationResult[]>([]);

  // Only show routes the current role can actually open. Previously this
  // exposed every admin route to every user, leading to access-denied bounces.
  const visibleRoutes = useMemo(() => {
    return ROUTES.filter((r) => {
      const req = r.requires ?? "any";
      if (req === "any") return true;
      if (req === "agent") return true; // any authenticated user
      if (req === "manager") return isAdmin || isManager;
      if (req === "admin") return isAdmin;
      return true;
    });
  }, [isAdmin, isManager]);

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

  // Debounced entity search
  useEffect(() => {
    if (!open || query.length < 2) {
      setAgents([]);
      setApplications([]);
      return;
    }
    const timer = setTimeout(async () => {
      const [agentRes, appRes] = await Promise.all([
        supabase
          .from("agents")
          .select("id, display_name, agent_code")
          .or(`display_name.ilike.%${query}%,agent_code.ilike.%${query}%`)
          .limit(5),
        supabase
          .from("applications")
          .select("id, first_name, last_name, email")
          .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
          .limit(5),
      ]);
      setAgents((agentRes.data as AgentResult[]) ?? []);
      setApplications((appRes.data as ApplicationResult[]) ?? []);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

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
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search pages, agents, leads… (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
            <CommandGroup heading="Agents">
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
                  <Users className="mr-2 h-4 w-4" />
                  <span>{a.display_name || "Unnamed"}</span>
                  {a.agent_code && (
                    <span className="ml-auto text-xs text-muted-foreground">{a.agent_code}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {applications.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Applications / Leads">
              {applications.map((app) => (
                <CommandItem
                  key={`app-${app.id}`}
                  value={`app-${app.id}`}
                  // 2026-07-29: same bug — app.id was dropped, so picking a named
                  // applicant opened the unfiltered list. DashboardApplicants already reads
                  // ?id= to focus a row.
                  onSelect={() => go(`/dashboard/applicants?id=${app.id}`)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span>{app.first_name} {app.last_name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{app.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
