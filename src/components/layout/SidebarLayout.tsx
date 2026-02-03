import { ReactNode, useState, useEffect, useRef, memo } from "react";
import { Menu, Crown } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { GlobalSidebar } from "./GlobalSidebar";
import { PhonePromptBanner } from "@/components/dashboard/PhonePromptBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNavigationGuard } from "@/hooks/useNavigationGuard";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
  children: ReactNode;
  showPhoneBanner?: boolean;
}

// Memoized page content wrapper to prevent unnecessary re-renders
const PageContent = memo(({ children, showPhoneBanner }: { children: ReactNode; showPhoneBanner: boolean }) => (
  <>
    {showPhoneBanner && <PhonePromptBanner />}
    {children}
  </>
));

export function SidebarLayout({ children, showPhoneBanner = true }: SidebarLayoutProps) {
  const { isOpen, isFullscreen, toggleSidebar, toggleFullscreen, sidebarWidth } = useSidebarState();
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const isDesktop = useIsDesktop();

  // Navigation guard: cleans up stuck overlays on route change
  useNavigationGuard();

  // Mobile sidebar state (separate from desktop collapse)
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setMobileOpen(false);
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  // Calculate margin for main content - ONLY on desktop
  const marginLeft = isDesktop ? (isFullscreen ? 0 : sidebarWidth) : 0;

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

      {/* Mobile Sidebar Overlay */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ transition: "opacity 150ms ease-out" }}
        onClick={() => setMobileOpen(false)}
      />
      
      {/* Mobile Sidebar Panel */}
      <div 
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-64 lg:hidden"
        )}
        style={{ 
          transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 150ms ease-out"
        }}
      >
        <GlobalSidebar
          isOpen={true}
          onToggle={() => setMobileOpen(false)}
          isFullscreen={false}
          onFullscreenToggle={() => {}}
        />
      </div>

      {/* Main Content - CSS transitions only, no framer-motion */}
      <main
        className={cn(
          "min-h-screen pt-16 lg:pt-0"
        )}
        style={{ 
          marginLeft: isDesktop ? `${marginLeft}px` : 0,
          transition: isDesktop ? "margin-left 150ms ease-out" : "none"
        }}
      >
        <div className="p-4 sm:p-6 lg:p-8">
          <PageContent showPhoneBanner={showPhoneBanner}>
            {children}
          </PageContent>
        </div>
      </main>
    </div>
  );
}
