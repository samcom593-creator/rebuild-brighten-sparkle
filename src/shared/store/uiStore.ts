import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  // MP-254 (2026-07-08): AppShell rebuild moves Ask APEX out of the
  // bottom-right FAB (Sam's complaint: "Ask Apex button blocks important
  // bottom-right content") and into the sidebar footer. Global open state
  // lets the sidebar button drive the same panel the FAB used to open.
  askApexOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setAskApexOpen: (open: boolean) => void;
  toggleAskApex: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  askApexOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setAskApexOpen: (open) => set({ askApexOpen: open }),
  toggleAskApex: () => set((s) => ({ askApexOpen: !s.askApexOpen })),
}));
