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
  Wallet,
  Rocket,
  UserX,
  Route,
  Trophy,
  Activity,
  DollarSign,
  Plug,
  Book,
  MessageSquare,
  Sunrise,
  GraduationCap,
  Database,
  Flame,
  ShieldAlert,
  AlertOctagon,
  Receipt,
  Phone,
  Radio,
  Send,
  Compass,
  AlertTriangle,
  Gauge,
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
  const [isPresenter, setIsPresenter] = useState(false);

  // Presenter detection: KJ (and any other agents.is_presenting=true) need to
  // see "Seminar Control" in the sidebar even when they aren't manager/admin.
  // Async query — sidebar re-renders once it lands.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || isAdmin || isManager) {
      setIsPresenter(false);
      return () => { cancelled = true; };
    }
    supabase
      .from("agents")
      .select("is_presenting")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsPresenter(Boolean(data?.is_presenting));
      });
    return () => { cancelled = true; };
  }, [user?.id, isAdmin, isManager]);

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

  // Sam's launch sidebar (2026-05-14): seven sections only — DASHBOARD,
  // PRODUCTION, RECRUITING, REFERRALS, SEMINAR, TRAINING, ADMIN. Items are
  // role-gated; the section as a whole is hidden when empty. Old groupings
  // (CRM, LEADS, CONTENT, TEAM) are folded into ADMIN to remove clutter.
  const navSections = useMemo(() => {
    const sections: NavSection[] = [];

    // 1. DASHBOARD — what people see when they log in
    const dashboardItems: NavItem[] = [
      { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    ];
    if (isAdmin) {
      dashboardItems.push({ icon: Gauge, label: "APEX Control", href: "/dashboard/apex-control", special: true });
    }
    if (isAdmin || isManager) {
      dashboardItems.push({ icon: Sunrise, label: "Today", href: "/dashboard/today", special: true });
    }
    dashboardItems.push({ icon: BarChart3, label: "Agent Dashboard", href: "/agent-portal" });
    sections.push({ label: "DASHBOARD", items: dashboardItems });

    // 2. PRODUCTION — sales, deals, ALP, leaderboards, BoB
    //    Removed from primary nav per Sam (2026-05-15 10am readiness):
    //    Hall of Fame, My Plaques, Rewards — vanity surfaces, not money/data.
    //    Routes still exist for deep links.
    const productionItems: NavItem[] = [
      { icon: Edit3, label: "Log Numbers", href: "/numbers", special: true },
      // Client Pipeline = client/policy servicing book of business — separate
      // from Recruit Pipeline (applicants/licensing) which lives under RECRUITING.
      { icon: Flame, label: "Client Pipeline", href: "/dashboard/agent-pipeline", special: true },
      { icon: DollarSign, label: "My Deals", href: "/dashboard/my-deals" },
      { icon: Wallet, label: "My Commissions", href: "/dashboard/my-commissions" },
      { icon: Trophy, label: "Leaderboard", href: "/dashboard/leaderboard", special: true },
      { icon: Book, label: "Book of Business", href: "/dashboard/book-of-business" },
    ];
    // PL-036: Hiring Pipeline surfaced into Production (admin/manager only) —
    // Sam wants it visible higher in nav, not buried under Recruiting.
    if (isAdmin || isManager) {
      productionItems.push({ icon: TrendingUp, label: "Hiring Pipeline", href: "/dashboard/hiring-pipeline" });
    }
    sections.push({ label: "PRODUCTION", items: productionItems });

    // 2b. CRM — Sam wants CRM higher than admin (core OS surface, not buried).
    const crmItems: NavItem[] = [
      { icon: Briefcase, label: "CRM", href: "/dashboard/crm" },
      { icon: Headphones, label: "Call Center", href: "/dashboard/call-center" },
    ];
    if (isAdmin || isManager) {
      crmItems.push({ icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads" });
    }
    if (isAdmin) {
      crmItems.push({ icon: Target, label: "Lead Center", href: "/dashboard/leads" });
      // PL-034: Offers groups under Leads/CRM so managers + agents can browse
      // package offers without hunting in Admin. (Was an admin-only top-level tab.)
      crmItems.push({ icon: ShoppingCart, label: "Offers", href: "/dashboard/offers" });
    }
    sections.push({ label: "CRM", items: crmItems });

    // 3. RECRUITING — applicants, pipeline, team
    //    Removed from primary nav: Team Hierarchy, Awards, Agent Management.
    //    Routes still exist; the surfaces had become noise on the side nav.
    const recruitingItems: NavItem[] = [
      // Recruit Pipeline = applicants/licensing/contracting/onboarding flow,
      // distinct from Agent Pipeline (clients/policies) which lives in PRODUCTION.
      { icon: Users, label: "Recruit Pipeline", href: isAdmin || isManager ? "/dashboard/applicants" : "/recruit-pipeline" },
    ];
    if (isAdmin || isManager) {
      recruitingItems.unshift({ icon: Target, label: "Recruit Command", href: "/dashboard/recruit", special: true });
      // PL-036: Hiring Pipeline lives in PRODUCTION now — no duplicate listing here.
      recruitingItems.push({ icon: GraduationCap, label: "Pre-Licensing", href: "/dashboard/pre-licensing", special: true });
      recruitingItems.push({ icon: Compass, label: "Next-Step Board", href: "/dashboard/team/next-step", special: true });
    }
    if (isAdmin) {
      recruitingItems.push({ icon: AlertTriangle, label: "Stuck Pool", href: "/admin/next-step/stuck", special: true });
      recruitingItems.push({ icon: TrendingUp, label: "Funnel Health", href: "/admin/next-step/funnel-health", special: true });
      recruitingItems.push({ icon: UserX, label: "Inactive Agents", href: "/dashboard/inactive-agents" });
    }
    if (isManager && !isAdmin) {
      recruitingItems.push({ icon: Users, label: "My Team", href: "/dashboard/my-team" });
    }
    sections.push({ label: "RECRUITING", items: recruitingItems });

    // 4. REFERRALS — agent submit + manager pipeline
    const referralItems: NavItem[] = [
      { icon: Plus, label: "Submit Referral", href: "/dashboard/referrals/new", special: true },
      { icon: Briefcase, label: "My Referrals", href: "/dashboard/referrals/mine" },
    ];
    // Referral Pipeline removed from sidebar (PL-031) — redundant with My Referrals.
    // Route /dashboard/referrals still exists for admin deep-link.
    sections.push({ label: "REFERRALS", items: referralItems });

    // 5. SEMINAR — group interview workflow.
    // Seminar Control is shown to admins, managers, AND flagged presenters
    // (KJ et al). The presenter check is async — sidebar reveal happens once
    // useIsPresenter resolves.
    const seminarItems: NavItem[] = [];
    if (isAdmin || isManager || isPresenter) {
      seminarItems.push({ icon: Crown, label: "Seminar Control", href: "/dashboard/seminar-control", special: true });
    }
    seminarItems.push({ icon: CalendarDays, label: "Calendar", href: "/dashboard/calendar" });
    sections.push({ label: "SEMINAR", items: seminarItems });

    // 6. TRAINING — courses + licensing
    const trainingItems: NavItem[] = [
      { icon: GraduationCap, label: "Course Catalog", href: "/course-catalog" },
      { icon: Book, label: "Course Progress", href: "/course-progress" },
    ];
    if (isAdmin) {
      trainingItems.push({ icon: GraduationCap, label: "Xcel Pipeline", href: "/dashboard/xcel-pipeline" });
    }
    sections.push({ label: "TRAINING", items: trainingItems });

    // 7. ADMIN — operations + integrations. Trimmed per Sam (2026-05-15):
    // removed Hall of Fame, Plaques, Awards, Team Hierarchy, Rewards,
    // Agent Management, IG Inbox, Team Chat, Instagram Automation, Email Log
    // from the primary nav. Routes still exist for deep links; they just
    // don't clutter the sidebar.
    const adminItems: NavItem[] = [];
    if (isAdmin) {
      // Sam HQ — Sam's single command surface (today's MUST/SHOULD/COULD, week strip, leaks, bots).
      // Pinned to the top of admin nav since this is his daily entry point.
      adminItems.push({ icon: Crown, label: "Sam HQ", href: "/dashboard/admin/sam", special: true });
      // Unclaimed Leads — every stage=new applicant + one-click reassign to Sam
      adminItems.push({ icon: AlertOctagon, label: "Unclaimed", href: "/dashboard/admin/unclaimed" });
      // Manager Command — 3-tab manager view
      adminItems.push({ icon: Users, label: "Manager Command", href: "/dashboard/admin/manager" });
      // Licensing Tracker — 8-stage kanban
      adminItems.push({ icon: GraduationCap, label: "Licensing Tracker", href: "/dashboard/admin/licensing" });
      adminItems.push({ icon: Crown, label: "Command Center", href: "/dashboard/command", special: true });
      adminItems.push({ icon: Mail, label: "Inbox", href: "/dashboard/inbox" });
      // PL-034: Offers now lives under CRM (with Lead Center / Aged Leads) so
      // it's grouped with the rest of the leads / packages surfaces.
      adminItems.push({ icon: Library, label: "Content Library", href: "/dashboard/content" });
      adminItems.push({ icon: Zap, label: "Automation Hub", href: "/dashboard/automation" });
      adminItems.push({ icon: Shield, label: "System Health", href: "/dashboard/system-health" });
      adminItems.push({ icon: Route, label: "Hiring Routing", href: "/dashboard/hiring-routing" });
      adminItems.push({ icon: DollarSign, label: "Comp Tiers", href: "/dashboard/comp-tiers" });
      adminItems.push({ icon: Plug, label: "Integrations", href: "/dashboard/integrations" });
      adminItems.push({ icon: Phone, label: "ReadyMode Sync", href: "/dashboard/readymode" });
      // PL-035: AgentLink Sync moved to bottom of Admin (just above Setup)
      // since it's not daily-priority. Placement now below the daemon block.
      adminItems.push({ icon: Receipt, label: "Charges Audit", href: "/dashboard/charges-audit", special: true });
      adminItems.push({ icon: Book, label: "Book Quality", href: "/dashboard/book-quality", special: true });
      // CONTENT ENGINE pair — two systems, one feedback loop:
      //   SMB (Radio) is the DOER (today's drafts, daemon, analytics, blockers).
      //   ContentWheel (Crown) is the BRAIN (doctrine, wheel, outliers, recruiting).
      // Every shipped SMB draft auto-flows to cw_posts; both pages cross-link.
      adminItems.push({ icon: Radio, label: "Social Media Bot", href: "/dashboard/admin/social-media-bot", special: true });
      adminItems.push({ icon: Send, label: "Telegram Bot", href: "/dashboard/admin/telegram-bot", special: true });
      adminItems.push({ icon: Crown, label: "ContentWheel", href: "/admin/contentwheel", special: true });
      // PL-035: AgentLink Sync demoted to bottom of admin nav (not daily-use).
      adminItems.push({ icon: Zap, label: "AgentLink Sync", href: "/dashboard/agentlink-sync", special: true });
      adminItems.push({ icon: Shield, label: "Setup", href: "/dashboard/setup" });
    }
    adminItems.push({ icon: Settings, label: "Settings", href: "/dashboard/settings" });
    // Notifications moved to bottom — rarely used per Sam's 2026-05-18 punch list.
    if (isAdmin) {
      adminItems.push({ icon: Bell, label: "Notification Hub", href: "/dashboard/notifications" });
    }
    adminItems.push({ icon: Bell, label: "My Notifications", href: "/dashboard/notifications/mine" });
    sections.push({ label: "ADMIN", items: adminItems });
    // Removed from sidebar 2026-05-18 (Sam's punch list — routes still resolve):
    //   - Accounts            (PL-030)
    //   - Purchase Leads      (PL-029)
    //   - Conduct Center      (PL-027)
    //   - Agent Strikes       (PL-028)
    //   - Automation Health   (PL-073, folds into Automation Hub)
    //   - AgentLink Vault     (PL-078, folds into CRM)

    return sections;
  }, [isAdmin, isManager, isAgent, isPresenter]);

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
            ? "text-[#22d3a5] bg-gradient-to-r from-[#22d3a5]/15 via-[#22d3a5]/5 to-transparent border-l-[3px] border-[#22d3a5] shadow-[inset_0_0_20px_hsl(168_80%_50%/0.08)]"
            : item.special
              ? "bg-gradient-to-r from-[#22d3a5]/10 to-transparent text-[#22d3a5] border border-[#22d3a5]/20 hover:from-[#22d3a5]/25 hover:border-[#22d3a5]/50 hover:shadow-[0_0_20px_hsl(168_80%_50%/0.15)] rounded-lg mx-1"
              : "text-[#64748b] hover:text-[#e2e8f0] hover:bg-white/[0.04] hover:translate-x-0.5",
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
        {item.label === "System Health" && !isCollapsed && (
          <span className={`ml-auto h-2 w-2 rounded-full flex-shrink-0 ${
            healthStatus === 'critical' ? 'bg-red-500 animate-pulse' :
            healthStatus === 'degraded' ? 'bg-yellow-500 animate-pulse' :
            'bg-emerald-500'
          }`} />
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
          isFullscreen && "pointer-events-none opacity-0"
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
          {/* Logo & Toggle */}
          <div className={cn(
            "flex items-center border-b border-[#1e293b] transition-all",
            isCollapsed ? "justify-center p-4" : "justify-between px-4 py-4"
          )}>
            {!isCollapsed && (
              <Link to="/dashboard" className="flex items-center gap-3 group shrink-0" style={{ overflow: 'visible', whiteSpace: 'nowrap', minWidth: 0 }}>
                <div className="relative" style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'visible', whiteSpace: 'nowrap' }}>
                  <span
                    className="brand-gradient"
                    style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '17px', letterSpacing: '2.5px', flexShrink: 0 }}
                  >
                    APEX
                  </span>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: '#22d3a5',
                      boxShadow: '0 0 12px hsl(168 80% 50% / 0.8), 0 0 24px hsl(168 80% 50% / 0.4)',
                      flexShrink: 0,
                      animation: 'pulse 2s infinite',
                    }}
                  />
                  <span
                    style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: '13px', color: '#22d3a5', flexShrink: 0, letterSpacing: '0.5px' }}
                  >
                    Financial
                  </span>
                </div>
              </Link>
            )}
            {isCollapsed && (
              <Link to="/dashboard" className="group relative">
                <span
                  className="text-xl brand-gradient"
                  style={{ fontFamily: "'Syne', sans-serif", fontWeight: 900 }}
                >
                  A
                </span>
                <span
                  className="absolute -top-1 -right-2 h-1.5 w-1.5 rounded-full bg-emerald-400"
                  style={{ boxShadow: '0 0 8px hsl(168 80% 50% / 0.8)' }}
                />
              </Link>
            )}
            <div className="flex items-center gap-1">
              {!isCollapsed && (
                <ConditionalTooltip label="Inbox">
                  <NotificationBell className="h-7 w-7 text-[#64748b] hover:text-[#22d3a5]" />
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
                            // PL-016: previously routed everyone to /applicants
                            // and the row was un-clickable for direct profile
                            // view. Deep-link straight to the agent profile.
                            navigate(`/agent/${result.id}`);
                            setSearchQuery("");
                            setSearchResults([]);
                            setShowSearch(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
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
