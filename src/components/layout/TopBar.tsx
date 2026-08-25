import { Link, useLocation } from "react-router-dom";
import { Command, Home, Menu, Moon, Search, Star, Sun, UserPlus } from "lucide-react";
// 2026-08-23 light/dark wave: this file used to import useTheme from
// "next-themes". No <ThemeProvider> is mounted anywhere in this app, and
// next-themes' hook falls back to a stub context when the provider is absent
// (node_modules/next-themes/dist/index.js: `b={setTheme:e=>{},themes:[]}`,
// `q=()=>useContext(M) ?? b`). So `setTheme` was a no-op function and `theme`
// was permanently `undefined` — the toggle did nothing on click, and because
// `theme === "dark"` was always false it always drew the Moon ("switch to
// dark") icon even while the app was in dark mode. The app's real theme
// implementation is @/hooks/useTheme, which writes the class onto <html> and
// persists to `apex:theme:v2`.
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useUIStore } from "@/shared/store/uiStore";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { RolePreviewMenu } from "@/components/layout/RolePreviewBubbles";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { agentCloudBreadcrumb } from "./agentCloudNavigation";
import { favoriteLabelFor, useFavoriteRoutes } from "./favoriteRoutes";
import { cn } from "@/lib/utils";

export function TopBar() {
  const { pathname } = useLocation();
  const { user, isAdmin, isManager } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useSidebarState();
  const setSearchOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const favorites = useFavoriteRoutes((state) => state.favorites);
  const toggleFavorite = useFavoriteRoutes((state) => state.toggleFavorite);
  const isFavorite = favorites.some((entry) => entry.href === pathname);
  const name = String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "there";
  const initials = (name || user?.email || "U").split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const crumbs = agentCloudBreadcrumb(pathname);
  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-40 hidden h-[60px] items-center justify-between border-b border-border bg-background px-5 lg:flex">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={toggleSidebar} aria-label="Toggle navigation">
          <Menu className="h-4 w-4" />
        </Button>
        {pathname === "/dashboard" ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {firstName}</span>
            <span className="truncate text-xs text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          </div>
        ) : (
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs">
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground"><Home className="h-3.5 w-3.5" /></Link>
            {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className={index === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>{index > 0 && <span className="mr-2 text-muted-foreground">/</span>}{crumb}</span>)}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setSearchOpen(true)} className="hidden h-8 w-[210px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground hover:border-primary/40 md:flex">
          <Search className="h-3.5 w-3.5" /><span>Search</span>
          <span className="ml-auto flex items-center gap-0.5 rounded border border-border px-1 py-0.5 text-[9px]"><Command className="h-2.5 w-2.5" />K</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 hover:bg-accent hover:text-foreground",
            isFavorite ? "text-primary hover:text-primary" : "text-muted-foreground",
          )}
          onClick={() => toggleFavorite(pathname, favoriteLabelFor(pathname))}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove this page from favorites" : "Add this page to favorites"}
        >
          <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
        </Button>
        <NotificationBell className="h-8 w-8 text-muted-foreground" />
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <RolePreviewMenu />
        {(isAdmin || isManager) && (
          <AddAgentModal
            trigger={(
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-md px-2.5 text-xs font-semibold">
                <UserPlus className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Add Agent</span>
              </Button>
            )}
          />
        )}
        <SubmitDealDialog trigger={<Button size="sm" className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">Post a Deal</Button>} />
        <Avatar className="ml-1 h-8 w-8 border border-border">
          <AvatarFallback className="bg-card text-[10px] font-semibold text-foreground">{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
