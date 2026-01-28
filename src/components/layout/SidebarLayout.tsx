import { ReactNode, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Crown } from "lucide-react";
import { GlobalSidebar } from "./GlobalSidebar";
import { PhonePromptBanner } from "@/components/dashboard/PhonePromptBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useSidebarState } from "@/hooks/useSidebarState";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
  children: ReactNode;
  showPhoneBanner?: boolean;
}

export function SidebarLayout({ children, showPhoneBanner = true }: SidebarLayoutProps) {
  const { isOpen, isFullscreen, toggleSidebar, toggleFullscreen, sidebarWidth } = useSidebarState();
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  // Mobile sidebar state (separate from desktop collapse)
  const [mobileOpen, setMobileOpen] = useState(false);
  
  // Track if we're transitioning to prevent double renders
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Close mobile sidebar on route change and handle transitions smoothly
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setMobileOpen(false);
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  // Calculate margin for main content - use CSS variable for smoother transitions
  const marginLeft = isFullscreen ? 0 : sidebarWidth;

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header - only visible on small screens */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
        <div className="flex items-center justify-between p-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Crown className="h-8 w-8 text-primary" />
            <span className="text-lg font-bold gradient-text">APEX</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Desktop Sidebar - always mounted, visibility controlled by CSS */}
      <div className="hidden lg:block">
        <GlobalSidebar
          isOpen={isOpen}
          onToggle={toggleSidebar}
          isFullscreen={isFullscreen}
          onFullscreenToggle={toggleFullscreen}
        />
      </div>

      {/* Mobile Sidebar Overlay - uses CSS transitions instead of AnimatePresence */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-200",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileOpen(false)}
      />
      
      {/* Mobile Sidebar Panel */}
      <div 
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-64 lg:hidden transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <GlobalSidebar
          isOpen={true}
          onToggle={() => setMobileOpen(false)}
          isFullscreen={false}
          onFullscreenToggle={() => {}}
        />
      </div>

      {/* Main Content - unified for both mobile and desktop */}
      <main
        className={cn(
          "min-h-screen transition-[margin-left] duration-200 ease-out",
          "pt-16 lg:pt-0" // Mobile has header padding, desktop doesn't
        )}
        style={{ marginLeft: `${marginLeft}px` }}
      >
        <div className="p-4 sm:p-6 lg:p-8">
          {showPhoneBanner && <PhonePromptBanner />}
          {children}
        </div>
      </main>
    </div>
  );
}
