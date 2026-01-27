import { useState, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crown,
  LayoutDashboard,
  Users,
  Shield,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserCog,
  UsersRound,
  Briefcase,
  Archive,
  BarChart3,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MiniLeaderboard } from "@/components/dashboard/MiniLeaderboard";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  // Role-based navigation items
  const navItems = useMemo(() => {
    const items = [];

    // All authenticated users get dashboard access
    items.push({ 
      icon: LayoutDashboard, 
      label: "Dashboard", 
      href: "/dashboard",
      roles: ["admin", "manager", "agent"]
    });

    // Admin-only: Command Center
    if (isAdmin) {
      items.push({ 
        icon: Crown, 
        label: "Command Center", 
        href: "/dashboard/command",
        roles: ["admin"]
      });
    }

    // All users see applicants
    items.push({ 
      icon: Users, 
      label: "Applicants", 
      href: "/dashboard/applicants",
      roles: ["admin", "manager", "agent"]
    });

    // Admin/Manager: CRM, Aged Leads, Agent Portal
    if (isAdmin || isManager) {
      items.push(
        { icon: BarChart3, label: "Agent Portal", href: "/agent-portal", roles: ["admin", "manager"] },
        { icon: Briefcase, label: "CRM", href: "/dashboard/crm", roles: ["admin", "manager"] },
        { icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads", roles: ["admin", "manager"] }
      );
    }

    // Agent-only portal access
    if (isAgent && !isAdmin && !isManager) {
      items.push({ 
        icon: BarChart3, 
        label: "My Portal", 
        href: "/agent-portal",
        roles: ["agent"]
      });
    }

    // All users get team view
    items.push({ 
      icon: UsersRound, 
      label: "My Team", 
      href: "/dashboard/team",
      roles: ["admin", "manager", "agent"]
    });

    // Admin/Manager: Admin Panel, Accounts
    if (isAdmin || isManager) {
      items.push(
        { icon: Shield, label: "Admin Panel", href: "/dashboard/admin", roles: ["admin", "manager"] },
        { icon: UserCog, label: "Accounts", href: "/dashboard/accounts", roles: ["admin", "manager"] }
      );
    }

    // All users get settings
    items.push({ 
      icon: Settings, 
      label: "Settings", 
      href: "/dashboard/settings",
      roles: ["admin", "manager", "agent"]
    });

    return items;
  }, [isAdmin, isManager, isAgent]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    navigate("/login");
  }, [navigate]);

  // Collapsed (mini) state shows only icons
  const isCollapsed = !isOpen;

  return (
    <>
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          width: isFullscreen ? 0 : isCollapsed ? 64 : 256,
          opacity: isFullscreen ? 0 : 1,
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={cn(
          "fixed top-0 left-0 z-40 h-full glass-strong border-r border-border overflow-hidden",
          isFullscreen && "pointer-events-none"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo & Toggle */}
          <div className={cn(
            "flex items-center border-b border-border transition-all",
            isCollapsed ? "justify-center p-4" : "justify-between p-4"
          )}>
            {!isCollapsed && (
              <Link to="/dashboard" className="flex items-center gap-2">
                <Crown className="h-7 w-7 text-primary" />
                <span className="text-lg font-bold gradient-text">APEX</span>
              </Link>
            )}
            {isCollapsed && (
              <Link to="/dashboard">
                <Crown className="h-7 w-7 text-primary" />
              </Link>
            )}
          </div>

          {/* Collapse Toggle Button */}
          <div className="px-2 py-2 border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className={cn(
                "w-full transition-all",
                isCollapsed ? "justify-center" : "justify-start"
              )}
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
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.href;
              
              const linkContent = (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    isCollapsed && "justify-center px-2"
                  )}
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

              if (isCollapsed) {
                return (
                  <Tooltip key={item.href} delayDuration={0}>
                    <TooltipTrigger asChild>
                      {linkContent}
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return linkContent;
            })}
          </nav>

          {/* Mini Leaderboard - only when expanded */}
          {!isCollapsed && <MiniLeaderboard />}

          {/* User & Actions */}
          <div className="border-t border-border p-2">
            {/* User info - only when expanded */}
            {user && !isCollapsed && (
              <div className="mb-2 px-3 py-2">
                <p className="text-sm font-medium truncate">
                  {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            )}

            {/* Theme toggle */}
            <div className={cn(
              "flex items-center mb-2",
              isCollapsed ? "justify-center px-2" : "justify-between px-3"
            )}>
              {!isCollapsed && <span className="text-sm text-muted-foreground">Theme</span>}
              <ThemeToggle />
            </div>

            {/* Fullscreen toggle */}
            {isCollapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onFullscreenToggle}
                    className="w-full justify-center"
                  >
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreenToggle}
                className="w-full justify-start px-3 mb-1"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-4 w-4 mr-2" />
                    <span className="text-sm">Exit Fullscreen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4 mr-2" />
                    <span className="text-sm">Fullscreen</span>
                  </>
                )}
              </Button>
            )}

            {/* Logout */}
            {isCollapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="w-full justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Sign Out
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                <span className="text-sm">Sign Out</span>
              </Button>
            )}
          </div>
        </div>
      </motion.aside>

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
            >
              <Menu className="h-5 w-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
