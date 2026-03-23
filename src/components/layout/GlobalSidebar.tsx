import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Crown,
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserCog,
  Briefcase,
  Archive,
  BarChart3,
  TrendingUp,
  Maximize2,
  Minimize2,
  Plus,
  Edit3,
  ShoppingCart,
  Headphones,
  Target,
  Sparkles,
  CalendarDays,
  Bell,
  Search,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InviteTeamModal } from "@/components/dashboard/InviteTeamModal";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  special?: boolean;
}

export function GlobalSidebar({
  isOpen,
  onToggle,
  isFullscreen,
  onFullscreenToggle,
}: GlobalSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isManager, isAgent } = useAuth();
  const AISHA_EMAIL = "kebbeh045@gmail.com";
  const isAisha = user?.email === AISHA_EMAIL;
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouchDevice();
  const { playSound } = useSoundEffects();

  // Search agents
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("log-production", {
          body: { action: "search", query: searchQuery.trim() }
        });
        if (error || !data?.agents) {
          setSearchResults([]);
          return;
        }
        const results = (data.agents as Array<{ id: string; name: string; email: string }>)
          .slice(0, 6)
          .map(a => ({ id: a.id, name: a.name, email: a.email }));
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const navSections = useMemo(() => {
    const sections: NavSection[] = [];

    // NAVIGATION section
    const navItems: NavItem[] = [
      { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
      { icon: Edit3, label: "Log Numbers", href: "/numbers", special: true },
    ];

    if (isAdmin) {
      navItems.push({ icon: Crown, label: "Command Center", href: "/dashboard/command" });
      navItems.push({ icon: Target, label: "Lead Center", href: "/dashboard/leads" });
      navItems.push({ icon: Bell, label: "Notifications", href: "/dashboard/notifications" });
    }

    sections.push({ label: "NAVIGATION", items: navItems });

    // TOOLS section — core items visible to ALL authenticated users
    const toolItems: NavItem[] = [
      { icon: BarChart3, label: "My Course", href: "/onboarding-course" },
      { icon: BarChart3, label: "Portal", href: "/agent-portal" },
      { icon: Users, label: "Pipeline", href: isAgent && !isAdmin && !isManager ? "/agent-pipeline" : "/dashboard/applicants" },
      { icon: Briefcase, label: "CRM", href: "/dashboard/crm" },
      { icon: CalendarDays, label: "Calendar", href: "/dashboard/calendar" },
    ];

    // Manager/Admin extras
    if (isAdmin || isManager) {
      toolItems.push({ icon: Sparkles, label: "Recruiter HQ ✨", href: "/dashboard/recruiter", special: true });
      toolItems.push({ icon: BarChart3, label: "Course Progress", href: "/course-progress" });
      toolItems.push({ icon: Headphones, label: "Call Center", href: "/dashboard/call-center" });
      toolItems.push({ icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads" });
      toolItems.push({ icon: TrendingUp, label: "Growth", href: "/dashboard/growth" });
      toolItems.push({ icon: Users, label: "Seminar", href: "/dashboard/seminar" });
    }

    // Admin-only extras
    if (isAdmin) {
      toolItems.push({ icon: CalendarDays, label: "Day Planner", href: "/dashboard/planner" });
    }

    toolItems.push({ icon: ShoppingCart, label: "Purchase Leads", href: "/purchase-leads" });

    sections.push({ label: "TOOLS", items: toolItems });

    // SETTINGS section
    sections.push({
      label: "SETTINGS",
      items: [{ icon: Settings, label: "Settings", href: "/dashboard/settings" }],
    });

    return sections;
  }, [isAdmin, isManager, isAgent]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    navigate("/login");
  }, [navigate]);

  const isCollapsed = !isOpen;
  const showTooltips = isCollapsed && !isTouch;

  const ConditionalTooltip = ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) => {
    if (!showTooltips) return <>{children}</>;
    return (
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="font-medium">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const NavItemComponent = ({ item, isActive }: { item: NavItem; isActive: boolean }) => {
    const linkContent = (
      <Link
        to={item.href}
        onClick={() => { if (!isActive) playSound("click"); }}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-r-lg transition-all duration-200 min-h-[44px] lg:min-h-[40px]",
          "touch-action-manipulation select-none group/nav",
          isActive
            ? "nav-item-active"
            : item.special
              ? "bg-gradient-to-r from-primary/15 to-primary/5 text-primary border border-primary/25 hover:from-primary/25 hover:to-primary/10 hover:border-primary/40 shadow-sm rounded-lg"
              : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 rounded-lg",
          isCollapsed && "justify-center px-2 rounded-lg"
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon
          className={cn(
            "h-5 w-5 flex-shrink-0 transition-transform duration-150",
            item.special && !isActive && "text-primary",
            isCollapsed && "group-hover/nav:scale-110"
          )}
        />
        {!isCollapsed && (
          <span className={cn("font-medium text-sm truncate", item.special && !isActive && "font-semibold")}>
            {item.label}
          </span>
        )}
        {isActive && !isCollapsed && (
          <ChevronRight className="h-4 w-4 ml-auto flex-shrink-0" />
        )}
        {item.special && !isActive && !isCollapsed && (
          <span className="ml-auto h-2 w-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
        )}
      </Link>
    );

    return <ConditionalTooltip label={item.label}>{linkContent}</ConditionalTooltip>;
  };

  const sidebarWidth = isFullscreen ? 0 : isCollapsed ? 64 : 256;

  return (
    <>
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full glass-strong border-r border-border overflow-hidden",
          "transition-all duration-150 ease-in-out",
          isFullscreen && "pointer-events-none opacity-0"
        )}
        style={{ width: sidebarWidth }}
      >
        <div className="flex flex-col h-full">
          {/* Logo & Toggle - collapse toggle integrated into header */}
          <div className={cn(
            "flex items-center border-b border-border transition-all",
            isCollapsed ? "justify-center p-4" : "justify-between p-4"
          )}>
            {!isCollapsed && (
              <Link to="/dashboard" className="flex items-center gap-2 group">
                <div className="relative">
                  <Crown className="h-7 w-7 text-primary transition-transform group-hover:scale-110" />
                  <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-bold gradient-text leading-tight">APEX</span>
                  <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Financial</span>
                </div>
              </Link>
            )}
            {isCollapsed && (
              <Link to="/dashboard" className="group relative">
                <Crown className="h-7 w-7 text-primary transition-transform group-hover:scale-110" />
                <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            )}
            {/* Slim collapse toggle in header row */}
            <div className="flex items-center gap-1">
              {!isCollapsed && (isAdmin || isManager) && (
                <ConditionalTooltip label="Add Team Member">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowInviteModal(true)}
                    className="h-7 w-7 text-primary hover:bg-primary/10"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </ConditionalTooltip>
              )}
              <ConditionalTooltip label={isCollapsed ? "Expand" : "Collapse"}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggle}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  style={{ touchAction: "manipulation" }}
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </ConditionalTooltip>
            </div>
          </div>

          {/* Quick Add Button - Collapsed State */}
          {isCollapsed && (isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-border">
              <ConditionalTooltip label="Add Team Member">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInviteModal(true)}
                  className="w-full justify-center text-primary hover:bg-primary/10"
                  style={{ touchAction: "manipulation" }}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </ConditionalTooltip>
            </div>
          )}

          {/* Agent Search */}
          {(isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-border" ref={searchRef}>
              {isCollapsed ? (
                <ConditionalTooltip label="Search Agents">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { onToggle(); setTimeout(() => setShowSearch(true), 200); }}
                    className="w-full justify-center text-muted-foreground hover:text-foreground"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </ConditionalTooltip>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search agents..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setShowSearch(true)}
                      className="h-8 pl-8 pr-8 text-sm bg-muted/50 border-border/50"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {showSearch && searchResults.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            navigate(`/dashboard/applicants`);
                            setSearchQuery("");
                            setSearchResults([]);
                            setShowSearch(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                        >
                          <p className="text-sm font-medium truncate">{result.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{result.email}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Navigation with section groups */}
          <nav className="flex-1 p-2 overflow-y-auto sidebar-nav-scroll relative">
            {navSections.map((section, sIdx) => (
              <div key={section.label}>
                {/* Section label - only when expanded */}
                {!isCollapsed && (
                  <div className="nav-section-label">{section.label}</div>
                )}
                {/* Divider for collapsed state between sections */}
                {isCollapsed && sIdx > 0 && (
                  <div className="my-2 mx-2 border-t border-border/50" />
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = location.pathname === item.href;
                    return <NavItemComponent key={item.href} item={item} isActive={isActive} />;
                  })}
                </div>
                {/* Add Agent button after NAVIGATION section */}
                {section.label === "NAVIGATION" && isAdmin && (
                  <div className={cn("mt-1", isCollapsed ? "px-1" : "px-1")}>
                    <AddAgentModal />
                  </div>
                )}
              </div>
            ))}
            {/* Gradient fade at bottom when content overflows */}
            <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-sidebar-background to-transparent" />
          </nav>

          {/* User & Actions */}
          <div className="border-t border-border p-2">
            {user && !isCollapsed && (
              <div className="mb-2 px-3 py-2">
                <p className="text-sm font-medium truncate">
                  {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            )}

            <div className={cn(
              "flex items-center mb-2",
              isCollapsed ? "justify-center px-2" : "justify-between px-3"
            )}>
              {!isCollapsed && <span className="text-sm text-muted-foreground">Theme</span>}
              <ThemeToggle />
            </div>

            <ConditionalTooltip label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreenToggle}
                className={cn(
                  "w-full mb-1",
                  isCollapsed ? "justify-center" : "justify-start px-3"
                )}
                style={{ touchAction: "manipulation" }}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-4 w-4" />
                    {!isCollapsed && <span className="text-sm ml-2">Exit Fullscreen</span>}
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4" />
                    {!isCollapsed && <span className="text-sm ml-2">Fullscreen</span>}
                  </>
                )}
              </Button>
            </ConditionalTooltip>

            <ConditionalTooltip label="Sign Out">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className={cn(
                  "w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                  isCollapsed ? "justify-center" : "justify-start px-3"
                )}
                style={{ touchAction: "manipulation" }}
              >
                <LogOut className="h-4 w-4" />
                {!isCollapsed && <span className="text-sm ml-2">Sign Out</span>}
              </Button>
            </ConditionalTooltip>

            {!isCollapsed && (
              <div className="mt-3 pt-3 border-t border-border/50 text-center">
                <p className="text-[9px] text-muted-foreground/70 uppercase tracking-widest">
                  Powered by <span className="font-semibold text-primary/80">Apex Financial</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Floating toggle when fullscreen */}
      {isFullscreen && (
        <div className="fixed top-4 left-4 z-50 animate-fade-in">
          <Button
            variant="secondary"
            size="icon"
            onClick={onFullscreenToggle}
            className="shadow-lg"
            style={{ touchAction: "manipulation" }}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      )}

      <InviteTeamModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />
    </>
  );
}
