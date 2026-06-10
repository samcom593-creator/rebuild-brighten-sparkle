import { useState, useCallback, useMemo, useRef, useEffect, type ElementType, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Archive,
  BarChart3,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Crown,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Network,
  PhoneCall,
  PhoneIncoming,
  Plus,
  Search,
  Settings,
  TrendingUp,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { NotificationBell } from "@/components/layout/NotificationBell";

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
  icon: ElementType;
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
  const { user, isAdmin, isManager } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouchDevice();
  const { playSound } = useSoundEffects();

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("log-production", {
          body: { action: "search", query: searchQuery.trim() },
        });
        if (error || !data?.agents) {
          setSearchResults([]);
          return;
        }
        const results = (data.agents as Array<{ id: string; name: string; email: string }>)
          .slice(0, 6)
          .map((agent) => ({ id: agent.id, name: agent.name, email: agent.email }));
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setShowSearch(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const navSections = useMemo<NavSection[]>(() => {
    const operations: NavItem[] = [
      { icon: LayoutDashboard, label: "Command Center", href: "/dashboard", special: true },
    ];
    const oldApplicants: NavItem[] = [];

    if (isAdmin) {
      operations.push(
        { icon: PhoneIncoming, label: "Inbound Leads", href: "/dashboard/inbound-leads", special: true },
        { icon: PhoneCall, label: "Calls Today", href: "/dashboard/calls-today", special: true },
        { icon: Briefcase, label: "Book", href: "/dashboard/book-of-business" },
        { icon: Users, label: "Clients", href: "/dashboard/clients" },
        { icon: Network, label: "Builders", href: "/dashboard/builders", special: true },
        { icon: UserCog, label: "Managers", href: "/dashboard/managers" },
        { icon: Crown, label: "Agency Owners", href: "/dashboard/agency-owners" },
        { icon: Users, label: "Agents", href: "/dashboard/agent-management" },
        { icon: Briefcase, label: "Applicants", href: "/dashboard/applicants" },
        { icon: GraduationCap, label: "Apex Course", href: "/course-catalog" },
        { icon: GraduationCap, label: "Licensing", href: "/dashboard/pre-licensing" },
        { icon: BarChart3, label: "Production", href: "/dashboard/leaderboard" },
        { icon: TrendingUp, label: "Social", href: "/dashboard/social" },
        { icon: Library, label: "Content", href: "/dashboard/admin/content-command" },
        { icon: Settings, label: "Admin", href: "/dashboard/admin" },
      );
      oldApplicants.push(
        { icon: Archive, label: "Old Managers", href: "/dashboard/old-applicants/managers" },
        { icon: Archive, label: "Old Licensed Recruiters", href: "/dashboard/old-applicants/licensed-recruiters" },
      );
    } else if (isManager) {
      operations.push(
        { icon: PhoneIncoming, label: "Inbound Leads", href: "/dashboard/inbound-leads", special: true },
        { icon: PhoneCall, label: "Calls Today", href: "/dashboard/calls-today", special: true },
        { icon: Briefcase, label: "Book", href: "/dashboard/book-of-business" },
        { icon: Users, label: "Clients", href: "/dashboard/clients" },
        { icon: Users, label: "Agents", href: "/dashboard/my-team" },
        { icon: Briefcase, label: "Applicants", href: "/dashboard/applicants" },
        { icon: GraduationCap, label: "Apex Course", href: "/course-catalog" },
        { icon: GraduationCap, label: "Licensing", href: "/dashboard/pre-licensing" },
        { icon: BarChart3, label: "Production", href: "/dashboard/leaderboard" },
      );
      oldApplicants.push(
        { icon: Archive, label: "Old Managers", href: "/dashboard/old-applicants/managers" },
        { icon: Archive, label: "Old Licensed Recruiters", href: "/dashboard/old-applicants/licensed-recruiters" },
      );
    } else {
      operations.push(
        { icon: BarChart3, label: "Production", href: "/numbers" },
        { icon: Briefcase, label: "Applicants", href: "/recruit-pipeline" },
        { icon: GraduationCap, label: "Training", href: "/course-progress" },
      );
    }

    return [
      { label: "OPERATIONS", items: operations },
      ...(oldApplicants.length ? [{ label: "OLD APPLICANTS", items: oldApplicants }] : []),
    ];
  }, [isAdmin, isManager]);

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
    children: ReactNode;
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
          "flex items-center gap-3 px-3 py-2.5 transition-all duration-200 min-h-[44px] lg:min-h-[40px]",
          "touch-action-manipulation select-none group/nav",
          isActive
            ? "text-[#22d3a5] bg-gradient-to-r from-[#22d3a5]/15 via-[#22d3a5]/5 to-transparent border-l-[3px] border-[#22d3a5] shadow-[inset_0_0_20px_hsl(168_80%_50%/0.08)]"
            : item.special
              ? "bg-gradient-to-r from-[#22d3a5]/10 to-transparent text-[#22d3a5] border border-[#22d3a5]/20 hover:from-[#22d3a5]/25 hover:border-[#22d3a5]/50 hover:shadow-[0_0_20px_hsl(168_80%_50%/0.15)] rounded-lg mx-1"
              : "text-[#8395ab] hover:text-[#e2e8f0] hover:bg-white/[0.04] hover:translate-x-0.5",
          isCollapsed && "justify-center px-2",
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon
          className={cn(
            "h-[18px] w-[18px] flex-shrink-0 transition-transform duration-150",
            item.special && !isActive && "text-[#22d3a5]",
            isCollapsed && "group-hover/nav:scale-110",
          )}
        />
        {!isCollapsed && (
          <span
            className={cn(
              "font-semibold text-[13px] truncate tracking-wide",
              item.special && !isActive && "font-bold",
            )}
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            {item.label}
          </span>
        )}
        {isActive && !isCollapsed && (
          <ChevronRight className="h-4 w-4 ml-auto flex-shrink-0 text-[#22d3a5]" />
        )}
        {item.special && !isActive && !isCollapsed && (
          <span className="ml-auto h-2 w-2 rounded-full bg-[#22d3a5] animate-pulse flex-shrink-0" />
        )}
      </Link>
    );

    return <ConditionalTooltip label={item.label}>{linkContent}</ConditionalTooltip>;
  };

  const sidebarWidth = isFullscreen ? 0 : isCollapsed ? 64 : 220;

  return (
    <>
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full overflow-hidden",
          "transition-all duration-150 ease-in-out",
          isFullscreen && "pointer-events-none opacity-0",
        )}
        style={{
          width: sidebarWidth,
          background:
            "linear-gradient(180deg, hsl(222 47% 4% / 0.985) 0%, hsl(222 60% 2% / 0.99) 100%)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          borderRight: "1px solid hsl(168 60% 50% / 0.15)",
          boxShadow:
            "inset -1px 0 0 hsl(255 100% 100% / 0.04), 4px 0 30px hsl(222 60% 0% / 0.5)",
        }}
      >
        <div className="flex flex-col h-full">
          <div className={cn(
            "flex items-center border-b border-[#1e293b] transition-all",
            isCollapsed ? "justify-center p-4" : "justify-between px-4 py-4",
          )}>
            {!isCollapsed && (
              // v9 wave-C complaint #13: clean wordmark, no gradient, no glow,
              // no emoji. Letter-spacing 0.15em, size 16, color text-apex-text.
              <Link
                to="/dashboard"
                className="flex items-center shrink-0 text-apex-text hover:text-apex-accent transition-colors"
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontWeight: 700,
                  fontSize: "16px",
                  letterSpacing: "0.15em",
                  whiteSpace: "nowrap",
                }}
              >
                APEX
              </Link>
            )}
            {isCollapsed && (
              <Link
                to="/dashboard"
                className="text-apex-text hover:text-apex-accent transition-colors"
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontWeight: 800,
                  fontSize: "16px",
                  letterSpacing: "0.05em",
                }}
              >
                A
              </Link>
            )}
            <div className="flex items-center gap-1">
              {!isCollapsed && (
                <ConditionalTooltip label="Inbox">
                  <NotificationBell className="h-7 w-7 text-[#8395ab] hover:text-[#22d3a5]" />
                </ConditionalTooltip>
              )}
              {!isCollapsed && (isAdmin || isManager) && (
                <AddAgentModal
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[#22d3a5] hover:bg-[#22d3a5]/10"
                      style={{ touchAction: "manipulation" }}
                      aria-label="Add agent"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  }
                />
              )}
              <ConditionalTooltip label={isCollapsed ? "Expand" : "Collapse"}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggle}
                  className="h-7 w-7 text-[#8395ab] hover:text-[#94a3b8]"
                  style={{ touchAction: "manipulation" }}
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </ConditionalTooltip>
            </div>
          </div>

          {isCollapsed && (isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-[#1e293b]">
              <AddAgentModal
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center text-[#22d3a5] hover:bg-[#22d3a5]/10"
                    style={{ touchAction: "manipulation" }}
                    aria-label="Add agent"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                }
              />
            </div>
          )}

          {(isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-[#1e293b]" ref={searchRef}>
              {isCollapsed ? (
                <ConditionalTooltip label="Search Agents">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { onToggle(); setTimeout(() => setShowSearch(true), 200); }}
                    className="w-full justify-center text-[#8395ab] hover:text-[#94a3b8]"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </ConditionalTooltip>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#475569]" />
                    <Input
                      placeholder="Search agents..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onFocus={() => setShowSearch(true)}
                      className="h-8 pl-8 pr-8 text-sm bg-white dark:bg-[#0f172a] border-[#1e293b] text-[#94a3b8] placeholder:text-[#334155]"
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
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-[#0f172a] border border-[#1e293b] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            navigate(`/agent/${result.id}`);
                            setSearchQuery("");
                            setSearchResults([]);
                            setShowSearch(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
                        >
                          <p className="text-sm font-medium truncate text-[#e2e8f0]">{result.name}</p>
                          <p className="text-xs text-[#8395ab] truncate">{result.email}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <nav className="flex-1 p-2 overflow-y-auto sidebar-nav-scroll relative">
            {navSections.map((section, sIdx) => (
              <div key={section.label}>
                {!isCollapsed && (
                  <div
                    className="px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[3px] text-[#334155]"
                    style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                  >
                    {section.label}
                  </div>
                )}
                {isCollapsed && sIdx > 0 && (
                  <div className="my-2 mx-2 border-t border-[#1e293b]/50" />
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = item.href === "/dashboard"
                      ? location.pathname === item.href
                      : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
                    return <NavItemComponent key={item.href} item={item} isActive={isActive} />;
                  })}
                </div>
              </div>
            ))}
            <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#030712] to-transparent" />
          </nav>

          <div className="border-t border-[#1e293b] p-2">
            {user && !isCollapsed && (isAdmin || isManager) && (
              <div className="mb-2 px-2">
                <AddAgentModal
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2 border-[#22d3a5]/25 bg-[#22d3a5]/10 text-[#22d3a5] hover:bg-[#22d3a5]/15"
                      style={{ touchAction: "manipulation" }}
                    >
                      <Plus className="h-4 w-4" />
                      Add Agent
                    </Button>
                  }
                />
              </div>
            )}

            {user && !isCollapsed && (
              <div className="mb-2 px-3 py-2">
                <p className="text-sm font-medium truncate text-[#e2e8f0]">
                  {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-xs text-[#8395ab] truncate">{user.email}</p>
              </div>
            )}

            <div className={cn(
              "flex items-center mb-2",
              isCollapsed ? "justify-center px-2" : "justify-between px-3",
            )}>
              {!isCollapsed && <span className="text-sm text-[#8395ab]">Theme</span>}
              <ThemeToggle />
            </div>

            <ConditionalTooltip label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreenToggle}
                className={cn(
                  "w-full mb-1 text-[#8395ab] hover:text-[#94a3b8] hover:bg-white/[0.03]",
                  isCollapsed ? "justify-center" : "justify-start px-3",
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
                  "w-full text-[#8395ab] hover:text-red-400 hover:bg-red-500/10",
                  isCollapsed ? "justify-center" : "justify-start px-3",
                )}
                style={{ touchAction: "manipulation" }}
              >
                <LogOut className="h-4 w-4" />
                {!isCollapsed && <span className="text-sm ml-2">Sign Out</span>}
              </Button>
            </ConditionalTooltip>

            {!isCollapsed && (
              <div className="mt-3 pt-3 border-t border-[#1e293b]/50 text-center">
                <p className="text-[9px] text-[#475569] uppercase tracking-widest">
                  Powered by <span className="font-semibold text-[#22d3a5]/80">Apex Financial</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

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
    </>
  );
}
