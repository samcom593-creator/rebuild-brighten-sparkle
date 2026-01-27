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

  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-fullscreen");
      return saved === "true";
    }
    return false;
  });

  // Persist states
  useEffect(() => {
    localStorage.setItem("sidebar-open", String(isOpen));
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem("sidebar-fullscreen", String(isFullscreen));
  }, [isFullscreen]);

  const toggleSidebar = () => setIsOpen((prev) => !prev);
  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  // Calculate sidebar width based on state
  const sidebarWidth = isFullscreen ? 0 : isOpen ? 256 : 64;

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
