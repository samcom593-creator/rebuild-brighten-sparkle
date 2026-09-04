import { ReactNode, useState, useEffect, useRef, memo } from "react";
import { Cloud, Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { GlobalSidebar } from "./GlobalSidebar";
import { TopBar } from "./TopBar";
import { ScrollProgress } from "./ScrollProgress";
import { PhonePromptBanner } from "@/components/dashboard/PhonePromptBanner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNavigationGuard } from "@/hooks/useNavigationGuard";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/useBrand";
import { MobileBottomNav } from "./MobileBottomNav";

interface SidebarLayoutProps {
  children: ReactNode;
  showPhoneBanner?: boolean;
}

// Memoized page content wrapper to prevent unnecessary re-renders
const PageContent = memo(({ children, showPhoneBanner }: { children: ReactNode; showPhoneBanner: boolean }) => (
  <>
    {showPhoneBanner && <PhonePromptBanner />}
    <div className="apex-page-slot min-w-0">{children}</div>
  </>
));

export function SidebarLayout({ children, showPhoneBanner = true }: SidebarLayoutProps) {
  const brand = useBrand();
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
    <div className="apex-app-shell agentcloud-parity min-h-screen relative bg-background">
      {/* Mobile Header - only visible on small screens */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background lg:hidden">
        <div className="flex h-[60px] items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2">
            {/* 2026-08-23 light/dark wave: the brand name was text-white on a
                bg-background header. Light mode's background is cream
                (`44 27% 92%`), so the agency's own name was invisible on the
                mobile header in light. The mark was the dark-gold literal
                #C9A961 on #0A0A0A; both are now tokens so the chip tracks the
                deeper light-mode gold. */}
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Cloud className="h-[18px] w-[18px]" /></span>
            <span className="truncate text-sm font-semibold text-foreground">{brand.legalName}</span>
          </Link>
          {/* One explicit mobile entry replaces the old row of unlabeled icon
              buttons. The sheet below contains the same role-aware navigation,
              search, support, and permitted money actions in a focus trap. */}
          <Button
            variant="outline"
            size="sm"
            className="h-10 shrink-0 gap-2 px-3"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="apex-mobile-actions"
          >
            <Menu className="h-4 w-4" />
            Actions
          </Button>
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

      {/* Mobile actions + navigation. Radix supplies focus trapping, Escape,
          scroll locking, and focus restoration to the labeled trigger. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          id="apex-mobile-actions"
          side="left"
          className="w-[min(90vw,320px)] overflow-hidden p-0 sm:max-w-[320px] lg:hidden"
        >
          <SheetTitle className="sr-only">Actions and navigation</SheetTitle>
          <GlobalSidebar
            mobile
            isOpen
            onToggle={() => setMobileOpen(false)}
            isFullscreen={false}
            onFullscreenToggle={() => {}}
          />
        </SheetContent>
      </Sheet>

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
          "apex-main-canvas min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-[calc(3.75rem+env(safe-area-inset-top,0px))] lg:pb-0 lg:pt-0"
        )}
        style={{
          marginLeft: isDesktop ? `${marginLeft}px` : 0,
          transition: isDesktop ? "margin-left 150ms ease-out" : "none"
        }}
      >
        <TopBar />
        <div className="apex-content-frame px-3 py-3 sm:p-4 lg:p-5">
          <PageContent showPhoneBanner={showPhoneBanner}>
            {children}
          </PageContent>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
