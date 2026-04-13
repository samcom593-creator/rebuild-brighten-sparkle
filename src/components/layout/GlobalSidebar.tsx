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
  Mail,
  Zap,
  Network,
  Library,
  TrendingUp,
  Shield,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouchDevice();
  const { playSound } = useSoundEffects();
  const [healthStatus, setHealthStatus] = useState<'healthy'|'degraded'|'critical'>('healthy');

  // Poll system health status every 5 min (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    const checkHealth = async () => {
      try {
        const { data } = await supabase
          .from("system_health_logs")
          .select("overall_status")
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.overall_status) setHealthStatus(data.overall_status as any);
      } catch {}
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAdmin]);

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

    // OPERATIONS
    const opsItems: NavItem[] = [
      { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
      { icon: BarChart3, label: "Agent Dashboard", href: "/agent-portal" },
      { icon: Briefcase, label: "CRM", href: "/dashboard/crm" },
    ];
    if (isAdmin || isManager) {
      opsItems.push({ icon: Headphones, label: "Call Center", href: "/dashboard/call-center" });
    }
    opsItems.push({ icon: Users, label: "Pipeline", href: isAgent && !isAdmin && !isManager ? "/agent-pipeline" : "/dashboard/applicants" });
    if (isAdmin || isManager) {
      opsItems.push({ icon: TrendingUp, label: "Hiring Pipeline", href: "/dashboard/hiring-pipeline" });
      opsItems.push({ icon: UserCog, label: "Agent Management", href: "/dashboard/agent-management" });
    }
    opsItems.push({ icon: Edit3, label: "Log Numbers", href: "/numbers", special: true });
    sections.push({ label: "OPERATIONS", items: opsItems });

    // TEAM
    const teamItems: NavItem[] = [
      { icon: Users, label: "Team Directory", href: "/dashboard/team" },
    ];
    if (isAdmin) {
      teamItems.push({ icon: Network, label: "Hierarchy", href: "/dashboard/hierarchy" });
    }
    sections.push({ label: "TEAM", items: teamItems });

    // COMMUNICATIONS
    const commItems: NavItem[] = [];
    if (isAdmin || isManager) {
      commItems.push({ icon: Mail, label: "Inbox", href: "/dashboard/inbox" });
    }
    if (isAdmin) {
      commItems.push({ icon: Bell, label: "Notification Hub", href: "/dashboard/notifications" });
    }
    if (commItems.length > 0) {
      sections.push({ label: "COMMUNICATIONS", items: commItems });
    }

    // TRAINING
    const trainingItems: NavItem[] = [
      { icon: BarChart3, label: "Course Catalog", href: "/course-catalog" },
    ];
    if (isAdmin || isManager) {
      trainingItems.push({ icon: BarChart3, label: "Course Progress", href: "/course-progress" });
    }
    sections.push({ label: "TRAINING", items: trainingItems });

    // LEADS
    const leadItems: NavItem[] = [
      { icon: ShoppingCart, label: "Purchase Leads", href: "/purchase-leads" },
    ];
    if (isAdmin || isManager) {
      leadItems.push({ icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads" });
    }
    if (isAdmin) {
      leadItems.push({ icon: Target, label: "Lead Center", href: "/dashboard/leads" });
    }
    sections.push({ label: "LEADS", items: leadItems });

    // CONTENT
    const contentItems: NavItem[] = [
      { icon: Library, label: "Content Library", href: "/dashboard/content" },
    ];
    if (isAdmin) {
      contentItems.push({ icon: Sparkles, label: "Instagram Automation", href: "/dashboard/instagram-automation" });
    }
    sections.push({ label: "CONTENT", items: contentItems });

    // EVENTS
    const eventItems: NavItem[] = [
      { icon: CalendarDays, label: "Calendar", href: "/dashboard/calendar" },
    ];
    sections.push({ label: "EVENTS", items: eventItems });

    // AUTOMATION (admin only)
    if (isAdmin) {
      sections.push({
        label: "AUTOMATION",
        items: [
          { icon: Zap, label: "Automation Hub", href: "/dashboard/automation" },
        ],
      });
    }

    // ADMIN
    const adminItems: NavItem[] = [];
    if (isAdmin) {
      adminItems.push({ icon: Crown, label: "Command Center", href: "/dashboard/command" });
      adminItems.push({ icon: UserCog, label: "Accounts", href: "/dashboard/accounts" });
    }
    adminItems.push({ icon: Settings, label: "Settings", href: "/dashboard/settings" });
    sections.push({ label: "ADMIN", items: adminItems });

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
          "flex items-center gap-3 px-3 py-2.5 transition-all duration-200 min-h-[44px] lg:min-h-[40px]",
          "touch-action-manipulation select-none group/nav",
          isActive
            ? "text-[#22d3a5] border-l-2 border-[#22d3a5] bg-[#22d3a5]/5"
            : item.special
              ? "bg-gradient-to-r from-[#22d3a5]/10 to-transparent text-[#22d3a5] border border-[#22d3a5]/20 hover:from-[#22d3a5]/20 hover:border-[#22d3a5]/40 shadow-sm rounded-lg mx-1"
              : "text-[#64748b] hover:text-[#94a3b8] hover:bg-white/[0.03]",
          isCollapsed && "justify-center px-2"
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon
          className={cn(
            "h-[18px] w-[18px] flex-shrink-0 transition-transform duration-150",
            item.special && !isActive && "text-[#22d3a5]",
            isCollapsed && "group-hover/nav:scale-110"
          )}
        />
        {!isCollapsed && (
          <span className={cn(
            "font-semibold text-[13px] truncate tracking-wide",
            item.special && !isActive && "font-bold"
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
          "fixed top-0 left-0 z-40 h-full overflow-hidden border-r border-[#1e293b]",
          "transition-all duration-150 ease-in-out",
          isFullscreen && "pointer-events-none opacity-0"
        )}
        style={{
          width: sidebarWidth,
          background: "linear-gradient(180deg, #070d1b 0%, #030712 100%)",
        }}
      >
        <div className="flex flex-col h-full">
          {/* Logo & Toggle */}
          <div className={cn(
            "flex items-center border-b border-[#1e293b] transition-all",
            isCollapsed ? "justify-center p-4" : "justify-between px-4 py-4"
          )}>
            {!isCollapsed && (
              <Link to="/dashboard" className="flex items-center gap-2 group" style={{ overflow: 'visible', whiteSpace: 'nowrap', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'visible', whiteSpace: 'nowrap' }}>
                  <span
                    style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '16px', color: 'white', letterSpacing: '1px', flexShrink: 0 }}
                  >
                    APEX
                  </span>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22d3a5', flexShrink: 0, animation: 'pulse 2s infinite' }} />
                  <span
                    style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: '16px', color: '#22d3a5', flexShrink: 0 }}
                  >
                    Financial
                  </span>
                </div>
              </Link>
            )}
            {isCollapsed && (
              <Link to="/dashboard" className="group relative">
                <span
                  className="text-lg font-extrabold text-white"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  A
                </span>
              </Link>
            )}
            <div className="flex items-center gap-1">
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
                  className="h-7 w-7 text-[#64748b] hover:text-[#94a3b8]"
                  style={{ touchAction: "manipulation" }}
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </ConditionalTooltip>
            </div>
          </div>

          {/* Quick Add Button - Collapsed State */}
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

          {/* Agent Search */}
          {(isAdmin || isManager) && (
            <div className="px-2 py-2 border-b border-[#1e293b]" ref={searchRef}>
              {isCollapsed ? (
                <ConditionalTooltip label="Search Agents">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { onToggle(); setTimeout(() => setShowSearch(true), 200); }}
                    className="w-full justify-center text-[#64748b] hover:text-[#94a3b8]"
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
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setShowSearch(true)}
                      className="h-8 pl-8 pr-8 text-sm bg-[#0f172a] border-[#1e293b] text-[#94a3b8] placeholder:text-[#334155]"
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
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-[#0f172a] border border-[#1e293b] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            navigate(`/dashboard/applicants`);
                            setSearchQuery("");
                            setSearchResults([]);
                            setShowSearch(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-white/[0.03] transition-colors"
                        >
                          <p className="text-sm font-medium truncate text-[#e2e8f0]">{result.name}</p>
                          <p className="text-xs text-[#64748b] truncate">{result.email}</p>
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
                {/* Section label */}
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
                    const isActive = location.pathname === item.href;
                    return <NavItemComponent key={item.href} item={item} isActive={isActive} />;
                  })}
                </div>
              </div>
            ))}
            <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#030712] to-transparent" />
          </nav>

          {/* Add Agent FAB */}
          {(isAdmin || isManager) && (
            <div style={{ padding: '8px 12px', borderTop: '0.5px solid #1e293b' }}>
              <AddAgentModal
                trigger={
                  <button
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'rgba(34,211,165,0.1)',
                      border: '1px solid rgba(34,211,165,0.2)',
                      color: '#22d3a5',
                      fontFamily: "'Syne', sans-serif",
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={16} />
                    {!isCollapsed && "Add Agent"}
                  </button>
                }
              />
            </div>
          )}

          {/* User & Actions */}
          <div className="border-t border-[#1e293b] p-2">
            {user && !isCollapsed && (
              <div className="mb-2 px-3 py-2">
                <p className="text-sm font-medium truncate text-[#e2e8f0]">
                  {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-xs text-[#64748b] truncate">{user.email}</p>
              </div>
            )}

            <div className={cn(
              "flex items-center mb-2",
              isCollapsed ? "justify-center px-2" : "justify-between px-3"
            )}>
              {!isCollapsed && <span className="text-sm text-[#64748b]">Theme</span>}
              <ThemeToggle />
            </div>

            <ConditionalTooltip label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreenToggle}
                className={cn(
                  "w-full mb-1 text-[#64748b] hover:text-[#94a3b8] hover:bg-white/[0.03]",
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
                  "w-full text-[#64748b] hover:text-red-400 hover:bg-red-500/10",
                  isCollapsed ? "justify-center" : "justify-start px-3"
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
    </>
  );
}
