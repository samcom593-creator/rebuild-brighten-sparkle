import { Link, useLocation } from "react-router-dom";
import { Command, Home, Menu, Moon, Search, Star, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useUIStore } from "@/shared/store/uiStore";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { agentCloudBreadcrumb } from "./agentCloudNavigation";

export function TopBar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useSidebarState();
  const setSearchOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const name = String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "there";
  const initials = (name || user?.email || "U").split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const crumbs = agentCloudBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-40 hidden h-[60px] items-center justify-between border-b border-[#29292d] bg-[#0b0b0d] px-5 lg:flex">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#77767c] hover:bg-white/[0.04] hover:text-white" onClick={toggleSidebar} aria-label="Toggle navigation">
          <Menu className="h-4 w-4" />
        </Button>
        {pathname === "/dashboard" ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-white">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {firstName}</span>
            <span className="truncate text-xs text-[#77767c]">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          </div>
        ) : (
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs">
            <Link to="/dashboard" className="text-[#77767c] hover:text-white"><Home className="h-3.5 w-3.5" /></Link>
            {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className={index === crumbs.length - 1 ? "font-medium text-white" : "text-[#77767c]"}>{index > 0 && <span className="mr-2 text-[#46454a]">/</span>}{crumb}</span>)}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setSearchOpen(true)} className="hidden h-8 w-[210px] items-center gap-2 rounded-md border border-[#303034] bg-[#151517] px-2.5 text-xs text-[#77767c] hover:border-[#45444a] md:flex">
          <Search className="h-3.5 w-3.5" /><span>Search</span>
          <span className="ml-auto flex items-center gap-0.5 rounded border border-[#353539] px-1 py-0.5 text-[9px]"><Command className="h-2.5 w-2.5" />K</span>
        </button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#77767c] hover:bg-white/[0.04] hover:text-white" aria-label="Favorite page"><Star className="h-4 w-4" /></Button>
        <NotificationBell className="h-8 w-8 text-[#77767c]" />
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#77767c] hover:bg-white/[0.04] hover:text-white" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <SubmitDealDialog trigger={<Button size="sm" className="h-8 rounded-md bg-[#d8a83e] px-3 text-xs font-semibold text-[#15120c] shadow-none hover:bg-[#e0b44e]">Post a Deal</Button>} />
        <Avatar className="ml-1 h-8 w-8 border border-[#3a393e]">
          <AvatarFallback className="bg-[#242327] text-[10px] font-semibold text-white">{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
