import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Cloud } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/useBrand";
import {
  AGENT_CLOUD_ACCOUNT_NAV,
  AGENT_CLOUD_PRIMARY_NAV,
  agentCloudPathIsActive,
  isAgentCloudGroup,
  type AgentCloudNavEntry,
  type AgentCloudNavGroup,
  type AgentCloudNavItem,
} from "./agentCloudNavigation";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
}

export function GlobalSidebar({ isOpen, onToggle, isFullscreen }: GlobalSidebarProps) {
  const brand = useBrand();
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();
  const isTouch = useIsTouchDevice();
  const collapsed = !isOpen;
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});

  const filterEntries = (entries: AgentCloudNavEntry[]) => entries
    .filter((entry) => !("adminOnly" in entry && entry.adminOnly && !isAdmin))
    .map((entry) => isAgentCloudGroup(entry)
      ? { ...entry, items: entry.items.filter((item) => !item.adminOnly || isAdmin) }
      : entry)
    .filter((entry) => !isAgentCloudGroup(entry) || entry.items.length > 0);

  const primary = filterEntries(AGENT_CLOUD_PRIMARY_NAV);
  const account = filterEntries(AGENT_CLOUD_ACCOUNT_NAV);

  const withTooltip = (label: string, child: ReactNode) => {
    if (!collapsed || isTouch) return child;
    return (
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>{child}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
      </Tooltip>
    );
  };

  const renderLeaf = (item: AgentCloudNavItem, nested = false) => {
    const active = agentCloudPathIsActive(pathname, item.href);
    const Icon = item.icon;
    return withTooltip(item.label, (
      <Link
        to={item.href}
        className={cn(
          "flex min-h-9 items-center rounded-md text-[13px] font-medium transition-colors",
          collapsed ? "justify-center px-2" : nested ? "gap-2.5 px-3" : "gap-3 px-3",
          active
            ? "bg-[#C9A961]/15 text-[#C9A961]"
            : "text-[#9A9A9A] hover:bg-white/[0.045] hover:text-white",
        )}
      >
        {Icon && <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-[#C9A961]")} />}
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    ));
  };

  const renderGroup = (group: AgentCloudNavGroup) => {
    const active = group.items.some((item) => agentCloudPathIsActive(pathname, item.href))
      || (group.label === "Recruiting" && pathname.startsWith("/dashboard/recruiting/"));
    const open = active || !closedGroups[group.label];
    const Icon = group.icon;
    const trigger = (
      <button
        type="button"
        onClick={() => collapsed ? onToggle() : setClosedGroups((value) => ({ ...value, [group.label]: !value[group.label] }))}
        aria-expanded={open}
        className={cn(
          "flex min-h-9 w-full items-center rounded-md text-[13px] font-medium transition-colors",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
          active ? "text-white" : "text-[#9A9A9A] hover:bg-white/[0.045] hover:text-white",
        )}
      >
        <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-[#C9A961]")} />
        {!collapsed && <span className="flex-1 text-left">{group.label}</span>}
        {!collapsed && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />}
      </button>
    );

    return (
      <div key={group.label} className="space-y-0.5">
        {withTooltip(group.label, trigger)}
        {!collapsed && open && (
          <div className="ml-[20px] space-y-0.5 border-l border-border pl-2">
            {group.kicker && (
              <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9A9A9A]">
                {group.kicker}
              </div>
            )}
            {group.items.map((item) => <div key={item.href}>{renderLeaf(item, true)}</div>)}
          </div>
        )}
      </div>
    );
  };

  const renderEntries = (entries: AgentCloudNavEntry[]) => entries.map((entry) => (
    <div key={entry.label}>{isAgentCloudGroup(entry) ? renderGroup(entry) : renderLeaf(entry)}</div>
  ));

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 overflow-hidden border-r border-border bg-[#0A0A0A] transition-[width,opacity] duration-150",
        isFullscreen && "pointer-events-none opacity-0",
      )}
      style={{ width: isFullscreen ? 0 : collapsed ? 72 : 256 }}
    >
      <div className="flex h-full flex-col">
        <div className={cn("flex h-[60px] shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "px-4")}>
          <Link to="/dashboard" className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#C9A961] text-[#0A0A0A]">
              <Cloud className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-none">
                <span className="block truncate text-[15px] font-semibold tracking-tight text-white">{brand.legalName}</span>
                
              </span>
            )}
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
          <div className="space-y-0.5">{renderEntries(primary)}</div>
          <div className="my-3 border-t border-border" />
          {!collapsed && <div className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#9A9A9A]">Account</div>}
          <div className="space-y-0.5">{renderEntries(account)}</div>
        </nav>

        <div className="flex h-12 shrink-0 items-center border-t border-border px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn("h-8 text-[#9A9A9A] hover:bg-white/[0.045] hover:text-white", collapsed ? "w-full px-0" : "w-full justify-start gap-3 px-3")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span className="text-xs">Collapse sidebar</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
