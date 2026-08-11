import { ReactNode, useState, useEffect, useRef, memo } from "react";
import { Menu, Crown, Plus, Search } from "lucide-react";
import { useUIStore } from "@/shared/store/uiStore";
import { Link, useLocation } from "react-router-dom";
import { GlobalSidebar } from "./GlobalSidebar";
import { TopBar } from "./TopBar";
import { ScrollProgress } from "./ScrollProgress";
import { PhonePromptBanner } from "@/components/dashboard/PhonePromptBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { RolePreviewBubbles } from "@/components/layout/RolePreviewBubbles";
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
    <div className="apex-app-shell min-h-screen relative bg-background">
      {/* Mobile Header - only visible on small screens */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border shadow-sm">
        <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Crown className="h-8 w-8 text-primary" />
            <span className="text-lg font-bold gradient-text">APEX</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open command palette (⌘K)"
              onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
            >
              <Search className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 px-2.5"
              onClick={() => setMobileOpen(true)}
              aria-label="Open Add Agent and Add Deal actions"
            >
              <Plus className="h-4 w-4" />
              Actions
            </Button>
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
          "fixed inset-0 z-30 bg-background/80  lg:hidden",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ transition: "opacity 100ms ease-out" }}
        onClick={() => setMobileOpen(false)}
      />
      
      {/* Mobile Sidebar Panel */}
      <div 
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-64 lg:hidden pt-[max(1rem,env(safe-area-inset-top))]"
        )}
        style={{ 
          transform: mobileOpen ? "translateX(0) scale(1)" : "translateX(-100%) scale(0.98)",
          transition: "transform 120ms ease-out"
        }}
      >
        <GlobalSidebar
          isOpen={true}
          onToggle={() => setMobileOpen(false)}
          isFullscreen={false}
          onFullscreenToggle={() => {}}
        />
      </div>

      {/* Skip link — keyboard users otherwise have to tab through the entire
          sidebar nav on every single route change before reaching content.
          Visually hidden until focused, then pinned top-left above the sidebar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Skip to main content
      </a>

      {/* Main Content - CSS transitions only, no framer-motion */}
      <ScrollProgress />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          // Mobile header = p-4 (16+16) + h-10 icon row (40) = 72px base (4.5rem),
          // plus env(safe-area-inset-top) on notched iPhones. Reserving the real
          // height keeps the first page heading from sliding under the fixed header.
          "apex-main-canvas min-h-screen pt-[calc(4.5rem+env(safe-area-inset-top,0px))] lg:pt-0"
        )}
        style={{
          marginLeft: isDesktop ? `${marginLeft}px` : 0,
          transition: isDesktop ? "margin-left 150ms ease-out" : "none"
        }}
      >
        <TopBar />
        <RolePreviewBubbles />
        <div className="apex-content-frame p-4 sm:p-6 lg:p-8">
          <PageContent showPhoneBanner={showPhoneBanner}>
            {children}
          </PageContent>
        </div>
      </main>
    </div>
  );
}
