import { Link, useLocation } from "react-router-dom";
import { HelpCircle, Home, Menu, Moon, Star, Sun } from "lucide-react";
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
import { NotificationBell } from "@/components/layout/NotificationBell";
import { RolePreviewMenu } from "@/components/layout/RolePreviewBubbles";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SoundToggle } from "@/components/ui/delight/SoundToggle";
import { agentCloudBreadcrumb } from "./agentCloudNavigation";
import { favoriteLabelFor, useFavoriteRoutes } from "./favoriteRoutes";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Context and utilities only (2026-10-15). The shell's search entry and its
// Add Agent / Post a Deal pair live in the sidebar, which every desktop
// viewport shows beside this bar; the copies that used to sit here opened the
// same command palette and the same two dialogs, so each desktop screen
// carried two identical search boxes and two identical creation buttons.
// Ctrl or Command K still opens search from anywhere.
export function TopBar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useSidebarState();
  const favorites = useFavoriteRoutes((state) => state.favorites);
  const toggleFavorite = useFavoriteRoutes((state) => state.toggleFavorite);
  const isFavorite = favorites.some((entry) => entry.href === pathname);
  // The greeting must never show an email address. Auth metadata full_name is
  // set at signup and for some logins it IS the raw email (proven live:
  // info@kingofsales.net rendered "Good evening, info@kingofsales.net"). The
  // profiles table holds the curated name, so it wins; metadata is trusted
  // only when it doesn't look like an email; the last resort is the email's
  // local part with a capital, never the full address.
  const { data: profileName } = useQuery({
    queryKey: ["topbar-profile-name", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles").select("full_name").eq("user_id", user!.id).limit(1);
      return data?.[0]?.full_name?.trim() || null;
    },
  });
  const metaName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
  const emailLocal = (user?.email ?? "").split("@")[0];
  const name = profileName
    || (metaName && !metaName.includes("@") ? metaName : "")
    || (emailLocal ? emailLocal[0].toUpperCase() + emailLocal.slice(1) : "");
  const firstName = name.split(/\s+/)[0] || "there";
  const initials = (name || user?.email || "U").split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const crumbs = agentCloudBreadcrumb(pathname);
  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-40 hidden h-[60px] items-center justify-between border-b border-border bg-background px-5 lg:flex">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={toggleSidebar} aria-label="Toggle navigation">
          <Menu className="h-5 w-5" />
        </Button>
        {/* Colour layer (2026-10-28): the bar sits outside .apex-page-slot, so text-xs would still
            render 12px here. The greeting is 15px, the date and the breadcrumb 13px, the current
            crumb semibold. Nothing under 13px on a signed-in screen. */}
        {pathname === "/dashboard" ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold leading-5 text-foreground">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {firstName}</span>
            <span className="truncate text-[13px] leading-5 text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          </div>
        ) : (
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] leading-5">
            <Link to="/dashboard" aria-label="Dashboard home" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><Home className="h-4 w-4" aria-hidden="true" /></Link>
            {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className={index === crumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>{index > 0 && <span className="mr-2 text-muted-foreground">/</span>}{crumb}</span>)}
          </nav>
        )}
      </div>

      {/* Every control here is 44px (2026-10-28): the first-timer lens fails anything smaller,
          and the pages under this bar already meet it. The bar is 60px, so they fit. */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-11 w-11 hover:bg-accent hover:text-foreground",
            isFavorite ? "text-primary hover:text-primary" : "text-muted-foreground",
          )}
          onClick={() => toggleFavorite(pathname, favoriteLabelFor(pathname))}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove this page from favorites" : "Add this page to favorites"}
        >
          <Star className={cn("h-5 w-5", isFavorite && "fill-current")} />
        </Button>
        <NotificationBell className="h-11 w-11 text-muted-foreground [&>svg]:h-5 [&>svg]:w-5" />
        <Button asChild variant="ghost" size="icon" aria-label="Open support desk" className="h-11 w-11 text-muted-foreground hover:bg-accent hover:text-foreground">
          <Link to="/dashboard/help?tab=desk" aria-label="Open support desk"><HelpCircle className="h-5 w-5" /></Link>
        </Button>
        <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <SoundToggle />
        <RolePreviewMenu />
        <Avatar className="ml-1 h-9 w-9 border border-border">
          <AvatarFallback className="bg-card text-[13px] font-semibold text-foreground">{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
