import { useState, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InviteTeamModal } from "@/components/dashboard/InviteTeamModal";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
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
  const [showInviteModal, setShowInviteModal] = useState(false);
  const isTouch = useIsTouchDevice();

  const navItems = useMemo(() => {
    const items = [];

    items.push({ 
      icon: LayoutDashboard, 
      label: "Dashboard", 
      href: "/dashboard",
    });
    items.push({
      icon: Edit3,
      label: "Log Numbers",
      href: "/numbers",
    });

    if (isAdmin) {
      items.push({ 
        icon: Crown, 
        label: "Command Center", 
        href: "/dashboard/command",
      });
    }

    if (isAdmin || isManager) {
      items.push({
        icon: BarChart3,
        label: "Course Progress",
        href: "/course-progress",
      });
      items.push({ 
        icon: Users, 
        label: "Pipeline", 
        href: "/dashboard/applicants",
      });
      items.push({ 
        icon: BarChart3, 
        label: "Agent Portal", 
        href: "/agent-portal",
      });
      items.push({ 
        icon: Briefcase, 
        label: "CRM", 
        href: "/dashboard/crm",
      });
    }

    if (isAdmin) {
      items.push({ 
        icon: Archive, 
        label: "Aged Leads", 
        href: "/dashboard/aged-leads",
      });
      items.push({ 
        icon: UserCog, 
        label: "Accounts", 
        href: "/dashboard/accounts",
      });
    }

    if (isAgent && !isAdmin && !isManager) {
      items.push({ 
        icon: BarChart3, 
        label: "My Portal", 
        href: "/agent-portal",
      });
      items.push({ 
        icon: BarChart3, 
        label: "My Course", 
        href: "/onboarding-course",
      });
    }

    items.push({ 
      icon: Settings, 
      label: "Settings", 
      href: "/dashboard/settings",
    });

    return items;
  }, [isAdmin, isManager, isAgent]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    navigate("/login");
  }, [navigate]);

  const isCollapsed = !isOpen;

  // Only show tooltips on desktop when sidebar is collapsed
  const showTooltips = isCollapsed && !isTouch;

  // Wrapper for conditional tooltip
  const ConditionalTooltip = ({ 
    children, 
    label 
  }: { 
    children: React.ReactNode; 
    label: string;
  }) => {
    if (!showTooltips) {
      return <>{children}</>;
    }
    return (
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="font-medium">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  // Navigation item component with tap hardening
  const NavItem = ({ item, isActive }: { item: typeof navItems[0], isActive: boolean }) => {
    const linkContent = (
      <Link
        to={item.href}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-100",
          "touch-action-manipulation select-none",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80",
          isCollapsed && "justify-center px-2"
        )}
        style={{ touchAction: "manipulation" }}
      >
        <item.icon className="h-5 w-5 flex-shrink-0" />
        {!isCollapsed && (
          <span className="font-medium text-sm truncate">{item.label}</span>
        )}
        {isActive && !isCollapsed && (
          <ChevronRight className="h-4 w-4 ml-auto flex-shrink-0" />
        )}
      </Link>
    );

    return (
      <ConditionalTooltip label={item.label}>
        {linkContent}
      </ConditionalTooltip>
    );
  };

  // Calculate width for CSS transition
  const sidebarWidth = isFullscreen ? 0 : isCollapsed ? 64 : 256;

  return (
    <>
      {/* Sidebar with CSS transitions instead of Framer Motion */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full glass-strong border-r border-border overflow-hidden",
          "transition-all duration-200 ease-in-out",
          isFullscreen && "pointer-events-none opacity-0"
        )}
        style={{ width: sidebarWidth }}
      >
        <div className="flex flex-col h-full">
          {/* Logo & Toggle */}
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
            {!isCollapsed && (isAdmin || isManager) && (
              <ConditionalTooltip label="Add Team Member">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowInviteModal(true)}
                  className="h-8 w-8 text-primary hover:bg-primary/10"
                  style={{ touchAction: "manipulation" }}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </ConditionalTooltip>
            )}
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

          {/* Collapse Toggle Button */}
          <div className="px-2 py-2 border-b border-border">
            <ConditionalTooltip label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                  "w-full transition-all",
                  isCollapsed ? "justify-center" : "justify-start"
                )}
                style={{ touchAction: "manipulation" }}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    <span className="text-sm">Collapse</span>
                  </>
                )}
              </Button>
            </ConditionalTooltip>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <NavItem key={item.href} item={item} isActive={isActive} />
              );
            })}
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

            {/* Fullscreen toggle */}
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

            {/* Logout */}
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
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="fixed top-4 left-4 z-50"
          >
            <Button
              variant="secondary"
              size="icon"
              onClick={onFullscreenToggle}
              className="shadow-lg"
              style={{ touchAction: "manipulation" }}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <InviteTeamModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />
    </>
  );
}
