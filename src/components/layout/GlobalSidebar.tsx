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
  CreditCard,
  Globe,
  GraduationCap,
  Heart,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Library,
  DollarSign,
  FileSpreadsheet,
  Flame,
  LogOut,
  Maximize2,
  Megaphone,
  PenSquare,
  ScrollText,
  Menu,
  Minimize2,
  Percent,
  PhoneCall,
  Rocket,
  Plus,
  Search,
  Settings,
  Sparkles,
  GitMerge,
  TrendingDown,
  TrendingUp,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { QuickAddAgentDialog } from "@/components/onboarding/QuickAddAgentDialog";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { useUIStore } from "@/shared/store/uiStore";
import { toast } from "sonner";

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

const SIDEBAR_GROUPS_STORAGE_KEY = "apex.sidebar.collapsedGroups.v1";
const COLLAPSIBLE_GROUP_LABELS = ["MORE", "OLD APPLICANTS"] as const;

export function GlobalSidebar({
  isOpen,
  onToggle,
  isFullscreen,
  onFullscreenToggle,
}: GlobalSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isManager, isVaManager, isVa } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; email: string; kind: "agent" | "applicant"; licenseStatus?: string | null; phone?: string }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  // 2026-06-15 — Sam directive (voice): "I tap their name, I should push a pull
  // up that I'm inside the CRM." Search results now open the AgentProfileDrawer
  // overlay instead of route-navigating to /agent/:id.
  const openAgentProfile = useAgentProfileDrawer((s) => s.openAgent);
  // MP-254 (2026-07-08): Ask APEX button in sidebar footer drives the same
  // panel that used to live as a bottom-right FAB (Sam directive: "Ask Apex
  // button blocks important bottom-right content"). See uiStore.
  const setAskApexOpen = useUIStore((s) => s.setAskApexOpen);
  const searchRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouchDevice();
  const { playSound } = useSoundEffects();

  // v7.15 Section 4 · collapsible sidebar groups (MORE / OLD APPLICANTS).
  // PRIMARY is never collapsible (always-visible daily flow).
  // State persists in localStorage so reload restores user preference.
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
    } catch { // empty-catch-allow:localstorage-incognito
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
        if (error || !data) {
          setSearchResults([]);
          return;
        }
        // 2026-06-17 Sam directive: search now returns BOTH agents + applicants.
        // Agents tap → AgentProfileDrawer (IT/AV/Legs + email-status + Send-now).
        // Applicants tap → /dashboard/applicants?id=<id> for inline edit/promote.
        const agents = ((data.agents as Array<{ id: string; name: string; email: string; phone?: string; licenseStatus?: string }>) ?? [])
          .slice(0, 8)
          .map((a) => ({ ...a, kind: "agent" as const }));
        const applicants = ((data.applicants as Array<{ id: string; name: string; email: string; phone?: string; licenseStatus?: string }>) ?? [])
          .slice(0, 8)
          .map((a) => ({ ...a, kind: "applicant" as const }));
        setSearchResults([...agents, ...applicants]);
      } catch {
        setSearchResults([]);
      }
    }, 250);
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
    const items: NavItem[] = [
      { icon: LayoutDashboard, label: "Command Center", href: "/dashboard", special: true },
    ];

    if (isAdmin || isManager || isVaManager || isVa) {
      items.push({ icon: Briefcase, label: "Recruiting", href: "/dashboard/recruiting", special: true });
      items.push({ icon: CalendarDays, label: "Interviews", href: "/dashboard/interviews" });
    }
    items.push({ icon: PhoneCall, label: "Call Center", href: "/dashboard/call-center" });
    if (isAdmin || isManager || isVaManager || isVa) {
      items.push({ icon: Users, label: "Team", href: "/dashboard/team" });
    }
    items.push(
      { icon: Award, label: "Contracting", href: "/dashboard/contracting" },
      { icon: BarChart3, label: "Production", href: "/dashboard/production" },
      { icon: TrendingUp, label: "Analytics", href: "/dashboard/analytics" },
      { icon: Megaphone, label: "Community", href: "/dashboard/community" },
      { icon: Library, label: "Resources", href: "/dashboard/resources" },
    );
    if (isAdmin) items.push({ icon: Settings, label: "Admin", href: "/dashboard/admin" });

    return [{ label: "WORKSPACES", items: items.slice(0, 10) }];
  }, [isAdmin, isManager, isVaManager, isVa]);

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
    // MP-254 (2026-07-08): visuals aligned to apexTokens.
    //   - active  = teal-500/12 bg + border-l-2 teal-400 + text teal-200
    //   - special = gold border-l-2 (Add Agent, Command Center)
    //   - default = muted secondary text, hover white/[0.04]
    const linkContent = (
      <Link
        to={item.href}
        onClick={() => { if (!isActive) playSound("click"); }}
        className={cn(
          "flex items-center gap-3 px-3 py-2 transition-colors duration-150 min-h-[40px] rounded-md",
          "touch-action-manipulation select-none group/nav",
          isActive
            ? "text-teal-200 bg-teal-500/[0.12] border-l-2 border-teal-400"
            : item.special
              ? "text-amber-400 border-l-2 border-amber-400 hover:bg-white/[0.04]"
              : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]",
          isCollapsed && "justify-center px-2 border-l-0",
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon
          className={cn(
            "h-4 w-4 flex-shrink-0",
            item.special && !isActive && "text-amber-400",
            isActive && "text-teal-300",
          )}
        />
        {!isCollapsed && (
          <span
            className={cn(
              "text-[13px] truncate max-w-[160px] tracking-wide",
              item.special ? "font-semibold" : "font-medium",
            )}
          >
            {item.label}
          </span>
        )}
        {item.special && !isActive && !isCollapsed && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
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
        // MP-254 (2026-07-08): sidebar bg comes from apexTokens
        // (MP-253 foundation). The Brand-Bible palette guard predates the
        // apex-tokens rollout — this file is a deliberate token adopter.
        style={{
          width: sidebarWidth,
          // palette-allow:mp254-apex-sidebar-token-bg
          background: "#060A10",
          backdropFilter: "blur(14px) saturate(130%)",
          WebkitBackdropFilter: "blur(14px) saturate(130%)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.03)",
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
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-800 rounded-lg shadow-lg max-h-[24rem] overflow-y-auto">
                      {searchResults.map((result) => (
                        <div
                          key={`${result.kind}:${result.id}`}
                          className="px-2 py-1.5 hover:bg-white/[0.04] transition-colors flex items-center gap-2 border-b border-slate-800/50 last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              // BUG-2 trace: when search→tap doesn't open the drawer, this
                              // line proves the click fired + which id was passed. Pair with
                              // AgentProfileDrawer's [AgentProfileDrawer] logs to isolate
                              // click-vs-store-vs-query as the failing step.

                              console.info("[GlobalSidebar] search result click", { kind: result.kind, id: result.id, name: result.name }); // console-in-prod-allow:BUG-2 diagnostic breadcrumb — needed in prod so Sam's next click yields a trace
                              setSearchQuery("");
                              setSearchResults([]);
                              setShowSearch(false);
                              if (result.kind === "agent") {
                                try { openAgentProfile(result.id); }
                                catch (err) { toast.error(`Drawer crashed: ${err instanceof Error ? err.message : String(err)}`); }
                              } else {
                                navigate(`/dashboard/applicants?id=${result.id}`);
                              }
                            }}
                            className="flex-1 min-w-0 text-left flex items-center gap-2"
                          >
                            <span
                              className={cn(
                                "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums",
                                result.kind === "agent"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-amber-500/40 bg-amber-500/10 text-amber-300",
                              )}
                            >
                              {result.kind === "agent" ? "Agent" : "Applicant"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate text-slate-200">{result.name}</p>
                              <p className="text-xs text-slate-400 truncate">
                                {result.email || result.phone || "—"}
                                {result.licenseStatus ? ` · ${result.licenseStatus}` : ""}
                              </p>
                            </span>
                          </button>
                          {/* 2026-06-18 Sam: 'send course' button right from search */}
                          <button
                            type="button"
                            title="Send course + Discord email to this person"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const target = e.currentTarget;
                              target.setAttribute("data-busy", "1");
                              try {
                                if (result.kind === "agent") {
                                  const { error: queueError } = await looseSupabase.from("agent_onboarding_queue").upsert(
                                    [
                                      { agent_id: result.id, email_kind: "course",  target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
                                      { agent_id: result.id, email_kind: "discord", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
                                    ],
                                    { onConflict: "agent_id,email_kind" },
                                  );
                                  if (queueError) throw queueError;
                                  await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
                                  toast.success(`Course + Discord sent to ${result.name}`);
                                } else {
                                  // Applicant: promote → agent → fires onboarding queue automatically.
                                  const { data: newAgentId, error: promoteError } = await supabase.rpc(
                                    "promote_applicant_to_agent" as never,
                                    { p_application_id: result.id } as never,
                                  );
                                  if (promoteError) throw promoteError;
                                  await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
                                  toast.success(`Promoted + course sent to ${result.name}`);
                                  if (newAgentId) openAgentProfile(newAgentId);
                                }
                              } catch (error: unknown) {
                                const message = error instanceof Error ? error.message : "unknown";
                                toast.error(`Send failed: ${message.slice(0, 80)}`);
                              } finally {
                                target.removeAttribute("data-busy");
                              }
                            }}
                            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors data-[busy=1]:opacity-50"
                          >
                            <Megaphone className="h-3 w-3" />
                          </button>
                        </div>
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
                    // MP-254 · section header: 10px uppercase tracking-[0.15em] muted
                    collapsible ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(section.label)}
                        aria-expanded={!groupCollapsed}
                        aria-controls={`sidebar-group-${section.label}`}
                        className="w-full flex items-center justify-between px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 hover:text-slate-400 transition-colors"
                        style={{ touchAction: "manipulation" }}
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
                      <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
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
            {/* MP-254: subtle fade at nav base — matches sidebar bg */}
            {/* palette-allow:mp254-apex-sidebar-token-bg */}
            <div
              className="pointer-events-none sticky bottom-0 left-0 right-0 h-6"
              style={{ background: "linear-gradient(180deg, rgba(6,10,16,0) 0%, #060A10 100%)" }}
            />
          </nav>

          <div className="border-t border-slate-800 p-2">
            {user && (
              <div className={cn("mb-2 grid gap-1", isCollapsed ? "px-0" : "px-2")} aria-label="Global actions">
                {(isAdmin || isManager || isVaManager || isVa) && (
                  <QuickAddAgentDialog
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "gap-2 border-amber-400/25 bg-amber-400/10 text-amber-400 hover:bg-amber-400/15",
                          isCollapsed ? "w-full justify-center px-0" : "w-full justify-start",
                        )}
                        style={{ touchAction: "manipulation" }}
                        aria-label="Add Agent"
                      >
                        <Plus className="h-4 w-4" />
                        {!isCollapsed && "Add Agent"}
                      </Button>
                    }
                  />
                )}
                {!isVa && !isVaManager && (
                  <SubmitDealDialog
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "gap-2 border-teal-400/25 bg-teal-400/10 text-teal-300 hover:bg-teal-400/15",
                          isCollapsed ? "w-full justify-center px-0" : "w-full justify-start",
                        )}
                        style={{ touchAction: "manipulation" }}
                        aria-label="Add Deal"
                      >
                        <Trophy className="h-4 w-4" />
                        {!isCollapsed && "Add Deal"}
                      </Button>
                    }
                  />
                )}
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

            {/* MP-254 · Ask APEX docks in the sidebar footer (not a floating
                FAB) so it never covers the bottom-right of any page. Gold
                accent — special item per token spec. */}
            <ConditionalTooltip label="Ask APEX">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAskApexOpen(true)}
                className={cn(
                  "w-full mb-1 border-l-2 border-amber-400 text-amber-400 hover:bg-amber-400/10",
                  isCollapsed ? "justify-center px-0" : "justify-start px-3",
                )}
                style={{ touchAction: "manipulation" }}
                aria-label="Ask APEX"
              >
                <Sparkles className="h-4 w-4" />
                {!isCollapsed && <span className="text-sm ml-2 font-semibold">Ask APEX</span>}
              </Button>
            </ConditionalTooltip>

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
