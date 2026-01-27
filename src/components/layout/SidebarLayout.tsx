import { ReactNode, useState } from "react";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Link } from "react-router-dom";
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

  // Mobile sidebar state (separate from desktop collapse)
  const [mobileOpen, setMobileOpen] = useState(false);

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
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <GlobalSidebar
          isOpen={isOpen}
          onToggle={toggleSidebar}
          isFullscreen={isFullscreen}
          onFullscreenToggle={toggleFullscreen}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed top-0 left-0 z-40 h-full w-64 lg:hidden">
            <GlobalSidebar
              isOpen={true}
              onToggle={() => setMobileOpen(false)}
              isFullscreen={false}
              onFullscreenToggle={() => {}}
            />
          </div>
        </>
      )}

      {/* Main Content */}
      <motion.main
        initial={false}
        animate={{ marginLeft: sidebarWidth }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={cn(
          "min-h-screen pt-16 lg:pt-0 transition-all",
          "hidden lg:block"
        )}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-6 lg:p-8"
        >
          {showPhoneBanner && <PhonePromptBanner />}
          {children}
        </motion.div>
      </motion.main>

      {/* Mobile Main Content (no animation for margin) */}
      <main className="lg:hidden min-h-screen pt-16">
        <div className="p-4 sm:p-6">
          {showPhoneBanner && <PhonePromptBanner />}
          {children}
        </div>
      </main>
    </div>
  );
}
