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

const ROUTES = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, group: "Navigate" },
  { label: "Command Center", path: "/dashboard/command-center", icon: Activity, group: "Navigate" },
  { label: "Team Directory", path: "/dashboard/team", icon: Users, group: "Navigate" },
  { label: "Hiring Pipeline", path: "/dashboard/hiring-pipeline", icon: UserPlus, group: "Navigate" },
  { label: "Agent CRM", path: "/dashboard/crm", icon: Briefcase, group: "Navigate" },
  { label: "Lead Center", path: "/dashboard/lead-center", icon: TrendingUp, group: "Navigate" },
  { label: "Aged Leads", path: "/dashboard/aged-leads", icon: Users, group: "Navigate" },
  { label: "Call Center", path: "/dashboard/call-center", icon: Phone, group: "Navigate" },
  { label: "Course Catalog", path: "/course-catalog", icon: GraduationCap, group: "Navigate" },
  { label: "Calendar", path: "/dashboard/calendar", icon: Calendar, group: "Navigate" },
  { label: "Inbox", path: "/dashboard/inbox", icon: Inbox, group: "Navigate" },
  { label: "Notifications", path: "/dashboard/notifications", icon: Bell, group: "Navigate" },
  { label: "Content Library", path: "/dashboard/content", icon: ImageIcon, group: "Navigate" },
  { label: "Award Graphics", path: "/dashboard/awards", icon: ImageIcon, group: "Navigate" },
  { label: "Purchase Leads", path: "/dashboard/purchase-leads", icon: ShoppingCart, group: "Navigate" },
  { label: "Automation Hub", path: "/dashboard/automation", icon: Activity, group: "Navigate" },
  { label: "System Health", path: "/dashboard/system-health", icon: Activity, group: "Navigate" },
  { label: "Deleted Leads Vault", path: "/dashboard/deleted-leads", icon: Trash2, group: "Navigate" },
  { label: "Settings", path: "/dashboard/settings", icon: SettingsIcon, group: "Navigate" },
];

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<AgentResult[]>([]);
  const [applications, setApplications] = useState<ApplicationResult[]>([]);

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
    if (!query) return ROUTES;
    const q = query.toLowerCase();
    return ROUTES.filter((r) => r.label.toLowerCase().includes(q));
  }, [query]);

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
                  onSelect={() => go(`/dashboard/team`)}
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
                  onSelect={() => go(`/dashboard/applicants`)}
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
