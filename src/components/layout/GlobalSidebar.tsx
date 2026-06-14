import { useState, useCallback, useMemo, useRef, useEffect, type ElementType, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Archive,
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Trophy,
  ArrowRightLeft,
  CreditCard,
  Filter,
  Globe,
  GraduationCap,
  Heart,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Library,
  DollarSign,
  LogOut,
  Maximize2,
  Megaphone,
  ScrollText,
  Menu,
  Minimize2,
  Network,
  Percent,
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

  // v7.15 Section 4 · collapsible sidebar groups (MORE / OLD APPLICANTS).
  // PRIMARY is never collapsible (always-visible daily flow).
  // State persists in localStorage so reload restores user preference.
  const SIDEBAR_GROUPS_STORAGE_KEY = "apex.sidebar.collapsedGroups.v1";
  const COLLAPSIBLE_GROUP_LABELS = ["MORE", "OLD APPLICANTS"] as const;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, boolean>;
      }
      return {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(collapsedGroups));
    } catch {
      // localStorage quota / private-mode failures are non-fatal
    }
  }, [collapsedGroups]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      return next;
    });
    playSound("click");
  }, [playSound]);

  const isGroupCollapsible = useCallback(
    (label: string) => (COLLAPSIBLE_GROUP_LABELS as readonly string[]).includes(label),
    [],
  );

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
    // v24 Phase 7 · AgentLink fidelity sidebar prune
    // PRIMARY: 6 top-level items (mirrors AgentLink's restraint)
    // MORE: collapsible group with the long tail
    // OLD: only renders if there are archive entries
    const primary: NavItem[] = [
      { icon: LayoutDashboard, label: "Command Center", href: "/dashboard", special: true },
    ];
    const more: NavItem[] = [];
    const oldApplicants: NavItem[] = [];

    if (isAdmin) {
      // 2026-06-14 LESS-IS-MORE refactor (Sam's directive):
      // "should probably be less than half · make this practical · use logic
      //  for a high-level agency · Sam = owner · managers = franchise · agents."
      //
      // PRIMARY = daily-flow surfaces (Applications hoisted per Sam: "applications
      // always should be the highest").
      // MORE = the franchise+admin tail. ~14 items max. Anything not used daily,
      // weekly, or as a recurring leak-detection step is GONE.
      primary.push(
        { icon: Briefcase, label: "Applications", href: "/dashboard/applicants", special: true },
        { icon: PhoneIncoming, label: "Inbound Leads", href: "/dashboard/inbound-leads", special: true },
        { icon: PhoneCall, label: "Calls Today", href: "/dashboard/calls-today", special: true },
        { icon: Award, label: "Contracts", href: "/dashboard/contracts", special: true },
        { icon: BarChart3, label: "Production", href: "/dashboard/leaderboard" },
      );
      more.push(
        // Headhunters (where applications come from → who joins)
        { icon: Inbox, label: "Headhunters Inbox", href: "/admin/recruiting-inbox", special: true },
        { icon: Filter, label: "Headhunters Funnels", href: "/dashboard/recruiting-funnels", special: true },
        { icon: Trophy, label: "Headhunters Tracker", href: "/dashboard/recruiting-tracker", special: true },
        { icon: CalendarDays, label: "Headhunters · Calendar", href: "/dashboard/headhunters-calendar", special: true },
        { icon: Crown, label: "Whales", href: "/dashboard/whales", special: true },
        // Production + money
        { icon: Briefcase, label: "Book of Business", href: "/dashboard/book-of-business" },
        { icon: TrendingUp, label: "Business Analytics", href: "/dashboard/business-analytics", special: true },
        { icon: DollarSign, label: "Finances · CFO", href: "/dashboard/finances", special: true },
        // Franchise mgmt (Sam owns · managers run their own)
        { icon: Users, label: "Team Analytics", href: "/dashboard/team-analytics" },
        { icon: Network, label: "Builders + Managers", href: "/dashboard/managers" },
        // Culture + comms (drives momentum, low maintenance)
        { icon: Megaphone, label: "Announcements", href: "/dashboard/announcements", special: true },
        { icon: ScrollText, label: "Scripts", href: "/dashboard/scripts" },
        { icon: Briefcase, label: "Carriers", href: "/dashboard/carriers" },
        // Admin hub (everything that isn't daily flow)
        { icon: Settings, label: "Admin", href: "/dashboard/command" },
      );
      oldApplicants.push(
        { icon: Archive, label: "Old Managers", href: "/dashboard/old-applicants/managers" },
        { icon: Archive, label: "Old Licensed Recruiters", href: "/dashboard/old-applicants/licensed-recruiters" },
      );
    } else if (isManager) {
      // MANAGER = franchise operator. Their daily flow is recruiting + running
      // their downline of producing agents. They do NOT need: client marketing,
      // calling cards, my landing page, training modules. Those are noise.
      primary.push(
        { icon: Briefcase, label: "Applications", href: "/dashboard/applicants", special: true },
        { icon: PhoneIncoming, label: "Inbound Leads", href: "/dashboard/inbound-leads", special: true },
        { icon: PhoneCall, label: "Calls Today", href: "/dashboard/calls-today", special: true },
        { icon: Users, label: "My Team", href: "/dashboard/my-team", special: true },
        { icon: BarChart3, label: "Production", href: "/dashboard/leaderboard" },
      );
      more.push(
        { icon: Inbox, label: "Headhunters Inbox", href: "/admin/recruiting-inbox", special: true },
        { icon: Filter, label: "Headhunters Funnels", href: "/dashboard/recruiting-funnels" },
        { icon: Trophy, label: "Headhunters Tracker", href: "/dashboard/recruiting-tracker" },
        { icon: CalendarDays, label: "Headhunters · Calendar", href: "/dashboard/headhunters-calendar", special: true },
        { icon: Briefcase, label: "Book of Business", href: "/dashboard/book-of-business" },
        { icon: TrendingUp, label: "Business Analytics", href: "/dashboard/business-analytics" },
        { icon: Award, label: "My Contracts", href: "/dashboard/contracts", special: true },
        { icon: Megaphone, label: "Announcements", href: "/dashboard/announcements" },
        { icon: ScrollText, label: "Scripts", href: "/dashboard/scripts" },
        { icon: Briefcase, label: "Carriers", href: "/dashboard/carriers" },
      );
      oldApplicants.push(
        { icon: Archive, label: "Old Managers", href: "/dashboard/old-applicants/managers" },
        { icon: Archive, label: "Old Licensed Recruiters", href: "/dashboard/old-applicants/licensed-recruiters" },
      );
    } else {
      // AGENT = the daily producer. Their flow: take inbound calls → write apps
      // → check production → reference scripts/carriers/comp. Anything beyond
      // that is friction. KILLED: Calling Cards, Client Marketing, My Landing
      // Page, Annuity Training, Transfer Requests, Calendar (lives in cockpit),
      // Help Center (footer link), Needs Analysis + Quoter (in-call tools live
      // in the dialer dock, not nav).
      primary.push(
        { icon: PhoneIncoming, label: "Inbound Leads", href: "/dashboard/inbound-leads", special: true },
        { icon: PhoneCall, label: "Calls Today", href: "/dashboard/calls-today", special: true },
        { icon: BarChart3, label: "Production", href: "/numbers" },
        { icon: Trophy, label: "Business Analytics", href: "/dashboard/business-analytics", special: true },
        { icon: Megaphone, label: "Announcements", href: "/dashboard/announcements", special: true },
      );
      more.push(
        { icon: Briefcase, label: "Book of Business", href: "/dashboard/book-of-business" },
        { icon: Award, label: "My Contracts", href: "/dashboard/contracts", special: true },
        { icon: ScrollText, label: "Scripts", href: "/dashboard/scripts" },
        { icon: Briefcase, label: "Carriers", href: "/dashboard/carriers" },
        { icon: GraduationCap, label: "Apex Course", href: "/course-catalog" },
        { icon: GraduationCap, label: "Licensing", href: "/dashboard/pre-licensing" },
      );
    }

    return [
      { label: "PRIMARY", items: primary },
      ...(more.length ? [{ label: "MORE", items: more }] : []),
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
            ? "text-amber-400 bg-white dark:bg-slate-900 border-l-[3px] border-amber-400 shadow-[inset_0_0_20px_hsl(168_80%_50%/0.08)]"
            : item.special
              ? "bg-white dark:bg-slate-900 text-amber-400 border border-amber-400/20 hover:from-amber-400/25 hover:border-amber-400/50 hover: rounded-lg mx-1"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] hover:translate-x-0.5",
          isCollapsed && "justify-center px-2",
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon
          className={cn(
            "h-[18px] w-[18px] flex-shrink-0 transition-base",
            item.special && !isActive && "text-amber-400",
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
          <ChevronRight className="h-4 w-4 ml-auto flex-shrink-0 text-amber-400" />
        )}
        {item.special && !isActive && !isCollapsed && (
          <span className="ml-auto h-2 w-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
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
            "flex items-center border-b border-slate-800 transition-all",
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
                  <NotificationBell className="h-7 w-7 text-slate-400 hover:text-amber-400" />
                </ConditionalTooltip>
              )}
              {!isCollapsed && (isAdmin || isManager) && (
                <AddAgentModal
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-amber-400 hover:bg-amber-400/10"
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
                  className="h-7 w-7 text-slate-400 hover:text-slate-300"
                  style={{ touchAction: "manipulation" }}
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </ConditionalTooltip>
            </div>
          </div>

          {isCollapsed && (isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-slate-800">
              <AddAgentModal
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center text-amber-400 hover:bg-amber-400/10"
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
            <div className="px-2 py-2 border-b border-slate-800" ref={searchRef}>
              {isCollapsed ? (
                <ConditionalTooltip label="Search Agents">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { onToggle(); setTimeout(() => setShowSearch(true), 200); }}
                    className="w-full justify-center text-slate-400 hover:text-slate-300"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </ConditionalTooltip>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
                    <Input
                      placeholder="Search agents..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onFocus={() => setShowSearch(true)}
                      className="h-8 pl-8 pr-8 text-sm bg-white dark:bg-slate-900 border-slate-800 text-slate-300 placeholder:text-slate-700"
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
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-800 rounded-lg shadow-lg max-h-48 overflow-y-auto">
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
                          <p className="text-sm font-medium truncate text-slate-200">{result.name}</p>
                          <p className="text-xs text-slate-400 truncate">{result.email}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <nav className="flex-1 p-2 overflow-y-auto sidebar-nav-scroll relative">
            {navSections.map((section, sIdx) => {
              const collapsible = isGroupCollapsible(section.label);
              // Collapsed-sidebar mode (icon rail) shows every item — group toggle
              // only applies when the sidebar is expanded.
              const groupCollapsed = collapsible && !isCollapsed && collapsedGroups[section.label] === true;
              return (
                <div key={section.label}>
                  {!isCollapsed && (
                    collapsible ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(section.label)}
                        aria-expanded={!groupCollapsed}
                        aria-controls={`sidebar-group-${section.label}`}
                        className="w-full flex items-center justify-between px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[3px] text-slate-700 hover:text-slate-400 transition-colors"
                        style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, touchAction: "manipulation" }}
                      >
                        <span>{section.label}</span>
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 flex-shrink-0 transition-transform duration-200",
                            groupCollapsed && "-rotate-90",
                          )}
                        />
                      </button>
                    ) : (
                      <div
                        className="px-3 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[3px] text-slate-700"
                        style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                      >
                        {section.label}
                      </div>
                    )
                  )}
                  {isCollapsed && sIdx > 0 && (
                    <div className="my-2 mx-2 border-t border-slate-800/50" />
                  )}
                  {!groupCollapsed && (
                    <div
                      id={`sidebar-group-${section.label}`}
                      className="space-y-0.5"
                    >
                      {section.items.map((item) => {
                        const isActive = item.href === "/dashboard"
                          ? location.pathname === item.href
                          : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
                        return <NavItemComponent key={item.href} item={item} isActive={isActive} />;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-white dark:bg-slate-900" />
          </nav>

          <div className="border-t border-slate-800 p-2">
            {user && !isCollapsed && (isAdmin || isManager) && (
              <div className="mb-2 px-2">
                <AddAgentModal
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2 border-amber-400/25 bg-amber-400/10 text-amber-400 hover:bg-amber-400/15"
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
                <p className="text-sm font-medium truncate text-slate-200">
                  {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
            )}

            <div className={cn(
              "flex items-center mb-2",
              isCollapsed ? "justify-center px-2" : "justify-between px-3",
            )}>
              {!isCollapsed && <span className="text-sm text-slate-400">Theme</span>}
              <ThemeToggle />
            </div>

            <ConditionalTooltip label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreenToggle}
                className={cn(
                  "w-full mb-1 text-slate-400 hover:text-slate-300 hover:bg-white/[0.03]",
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
                  "w-full text-slate-400 hover:text-red-400 hover:bg-red-500/10",
                  isCollapsed ? "justify-center" : "justify-start px-3",
                )}
                style={{ touchAction: "manipulation" }}
              >
                <LogOut className="h-4 w-4" />
                {!isCollapsed && <span className="text-sm ml-2">Sign Out</span>}
              </Button>
            </ConditionalTooltip>

            {!isCollapsed && (
              <div className="mt-3 pt-3 border-t border-slate-800/50 text-center">
                <p className="text-[9px] text-slate-600 uppercase tracking-widest">
                  Powered by <span className="font-semibold text-amber-400/80">Apex Financial</span>
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
