import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Cloud, Star, UserPlus } from "lucide-react";
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
import { useFavoriteRoutes } from "./favoriteRoutes";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
}

export function GlobalSidebar({ isOpen, onToggle, isFullscreen }: GlobalSidebarProps) {
  const brand = useBrand();
  const { pathname } = useLocation();
  const { isAdmin, isManager } = useAuth();
  const isTouch = useIsTouchDevice();
  // Rendered from the same store the TopBar star writes to, so pinning a page
  // has a visible result instead of vanishing into localStorage.
  const favorites = useFavoriteRoutes((state) => state.favorites);
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
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {Icon && <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-primary")} />}
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
          active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-primary")} />
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
              <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
        "fixed inset-y-0 left-0 z-50 overflow-hidden border-r border-border bg-sidebar transition-[width,opacity] duration-150",
        isFullscreen && "pointer-events-none opacity-0",
      )}
      style={{ width: isFullscreen ? 0 : collapsed ? 72 : 256 }}
    >
      <div className="flex h-full flex-col">
        <div className={cn("flex h-[60px] shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "px-4")}>
          <Link to="/dashboard" className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Cloud className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-none">
                <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">{brand.legalName}</span>
                
              </span>
            )}
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
          {favorites.length > 0 && (
            <div className="mb-3">
              {!collapsed && (
                <div className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Favorites
                </div>
              )}
              <div className="space-y-0.5">
                {favorites.map((favorite) => (
                  <div key={favorite.href}>
                    {renderLeaf({ label: favorite.label, href: favorite.href, icon: Star })}
                  </div>
                ))}
              </div>
              <div className="my-3 border-t border-border" />
            </div>
          )}
          <div className="space-y-0.5">{renderEntries(primary)}</div>
          <div className="my-3 border-t border-border" />
          {!collapsed && <div className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Account</div>}
          <div className="space-y-0.5">{renderEntries(account)}</div>
        </nav>

        {(isAdmin || isManager) && (
          <div className="shrink-0 border-t border-border p-2">
            <AddAgentModal
              trigger={(
                <Button
                  size="sm"
                  className={cn("h-9 gap-2", collapsed ? "w-full px-0" : "w-full justify-start px-3")}
                  aria-label="Add Agent"
                >
                  <UserPlus className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Add Agent</span>}
                </Button>
              )}
            />
          </div>
        )}

        <div className="flex h-12 shrink-0 items-center border-t border-border px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn("h-8 text-muted-foreground hover:bg-accent hover:text-foreground", collapsed ? "w-full px-0" : "w-full justify-start gap-3 px-3")}
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
