import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Cloud, HandCoins, Loader2, LogOut, Search, Star, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
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
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { useUIStore } from "@/shared/store/uiStore";
import { toast } from "sonner";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  /** Render inside the focus-trapped mobile Actions sheet, not as a fixed rail. */
  mobile?: boolean;
}

export function GlobalSidebar({ isOpen, onToggle, isFullscreen, mobile = false }: GlobalSidebarProps) {
  const brand = useBrand();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAdmin, isManager, effectiveMode, signOut } = useAuth();
  // MP-332: when Sam previews a role, the nav follows the preview too —
  // otherwise "Recruiter View" showed the recruiter home under the full admin
  // sidebar and told him nothing about what a recruiter actually sees.
  const { isPreviewing, effectiveRole } = useRolePreview();
  const viewMode = isPreviewing ? effectiveRole : effectiveMode;
  const seesAll = isAdmin && !isPreviewing;
  const isTouch = useIsTouchDevice();
  // Rendered from the same store the TopBar star writes to, so pinning a page
  // has a visible result instead of vanishing into localStorage.
  const favorites = useFavoriteRoutes((state) => state.favorites);
  const collapsed = !isOpen;
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await signOut();
      if (error) {
        toast.error("Couldn’t sign out. Please try again.");
        return;
      }
      navigate("/login", { replace: true });
    } catch {
      toast.error("Couldn’t sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  // MP-332: an entry is visible when it has no `modes` allowlist, or the
  // viewer's effective mode is in it. Admin always sees everything. Before this
  // the only gate was `adminOnly`, so a Pure Recruiter or a VA got the full
  // selling sidebar (Book of Business, Retention, Quoter...).
  const modeAllows = (modes?: AgentCloudNavItem["modes"]) => seesAll || !modes || modes.includes(viewMode);
  const filterEntries = (entries: AgentCloudNavEntry[]) => entries
    .filter((entry) => !("adminOnly" in entry && entry.adminOnly && !seesAll))
    .filter((entry) => modeAllows(entry.modes))
    .map((entry) => isAgentCloudGroup(entry)
      ? { ...entry, items: entry.items.filter((item) => (!item.adminOnly || seesAll) && modeAllows(item.modes)) }
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
        onClick={mobile ? onToggle : undefined}
        className={cn(
          "flex min-h-9 items-center rounded-md text-[13px] font-medium transition-colors",
          mobile && "min-h-11",
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
      || (group.label === "Grow" && pathname.startsWith("/dashboard/recruiting/"));
    const open = active || !closedGroups[group.label];
    const Icon = group.icon;
    const trigger = (
      <button
        type="button"
        onClick={() => collapsed ? onToggle() : setClosedGroups((value) => ({ ...value, [group.label]: !value[group.label] }))}
        aria-expanded={open}
        className={cn(
          "flex min-h-9 w-full items-center rounded-md text-[13px] font-medium transition-colors",
          mobile && "min-h-11",
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
        "overflow-hidden bg-sidebar",
        mobile
          ? "relative h-full w-full"
          : "fixed inset-y-0 left-0 z-50 border-r border-border transition-[width,opacity] duration-150",
        !mobile && isFullscreen && "pointer-events-none opacity-0",
      )}
      style={mobile ? undefined : { width: isFullscreen ? 0 : collapsed ? 72 : 256 }}
    >
      <div className="flex h-full flex-col">
        <div className={cn("flex h-[60px] shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "px-4", mobile && "pr-14")}>
          <Link to="/dashboard" onClick={mobile ? onToggle : undefined} className="flex min-w-0 items-center gap-3">
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

        {mobile && (
          <div className="shrink-0 space-y-2 border-t border-border p-2">
            <div className="px-2 pt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Quick actions
            </div>
            <SubmitDealDialog
              trigger={(
                <Button size="sm" className="h-11 w-full justify-start gap-3 px-3">
                  <HandCoins className="h-4 w-4" />
                  Post a Deal
                </Button>
              )}
            />
            {(isAdmin || isManager) && (
              <AddAgentModal
                trigger={(
                  <Button variant="outline" size="sm" className="h-11 w-full justify-start gap-3 px-3">
                    <UserPlus className="h-4 w-4" />
                    Add Agent
                  </Button>
                )}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full justify-start gap-3 px-3"
              onClick={() => {
                onToggle();
                useUIStore.getState().setCommandPaletteOpen(true);
              }}
            >
              <Search className="h-4 w-4" />
              Search {brand.shortName}
            </Button>
          </div>
        )}

        {!mobile && (isAdmin || isManager) && (
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

        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={cn("h-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive", mobile && "h-11", collapsed ? "w-full px-0" : "w-full justify-start gap-3 px-3")}
            aria-label="Sign out"
          >
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {!collapsed && <span className="text-xs">{signingOut ? "Signing out…" : "Sign out"}</span>}
          </Button>
        </div>

        {!mobile && <div className="flex h-12 shrink-0 items-center border-t border-border px-2">
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
        </div>}
      </div>
    </aside>
  );
}
