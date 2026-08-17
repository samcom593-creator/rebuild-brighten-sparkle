import { useState, useEffect, createContext, useContext, ReactNode } from "react";

interface SidebarContextValue {
  isOpen: boolean;
  isFullscreen: boolean;
  toggleSidebar: () => void;
  toggleFullscreen: () => void;
  setOpen: (open: boolean) => void;
  setFullscreen: (fullscreen: boolean) => void;
  sidebarWidth: number;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  children: ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-open");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  // 2026-08-17: fullscreen NO LONGER PERSISTS. It used to be restored from
  // localStorage on every load, and fullscreen hides the sidebar (width 0) and
  // the top bar with the search field — so one accidental toggle left the app
  // permanently chrome-less across every reload, on every device sharing that
  // profile, with no visible way back. Sam hit exactly this ("stuck in
  // fullscreen, can't see the search bar or tabs"). It is now a per-session
  // view mode that always starts OFF, and the stale key is cleared on boot so
  // anyone already trapped is released without clearing site data.
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("sidebar-fullscreen");
    }
  }, []);

  // Persist states
  useEffect(() => {
    localStorage.setItem("sidebar-open", String(isOpen));
  }, [isOpen]);

  // Deliberately NOT persisted — see the note above.

  // Escape always leaves fullscreen. A hidden-chrome mode needs an exit that
  // does not depend on finding the control that is currently hidden.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const toggleSidebar = () => setIsOpen((prev) => !prev);
  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  // Calculate sidebar width based on state. MUST match GlobalSidebar's actual
  // rendered width (220 open / 64 collapsed) — it was 256 here, leaving a 36px
  // dead gutter between the sidebar and content on every desktop page.
  const sidebarWidth = isFullscreen ? 0 : isOpen ? 220 : 64;

  const value: SidebarContextValue = {
    isOpen,
    isFullscreen,
    toggleSidebar,
    toggleFullscreen,
    setOpen: setIsOpen,
    setFullscreen: setIsFullscreen,
    sidebarWidth,
  };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarState() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebarState must be used within a SidebarProvider");
  }
  return context;
}
