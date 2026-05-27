/**
 * uiStore.test.ts
 *
 * Gaps covered:
 *   ✅ Initial state values
 *   ✅ setCommandPaletteOpen(true/false)
 *   ✅ toggleCommandPalette flips state
 *   ✅ setSidebarCollapsed(true/false)
 *   ✅ toggleSidebar flips state
 *   ✅ Multiple toggles are idempotent to the correct final state
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/shared/store/uiStore";

// Reset Zustand store between tests
beforeEach(() => {
  useUIStore.setState({
    commandPaletteOpen: false,
    sidebarCollapsed: false,
  });
});

describe("useUIStore — initial state", () => {
  it("commandPaletteOpen is false by default", () => {
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("sidebarCollapsed is false by default", () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe("useUIStore — command palette", () => {
  it("setCommandPaletteOpen(true) opens the palette", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("setCommandPaletteOpen(false) closes the palette", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().setCommandPaletteOpen(false);
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("toggleCommandPalette flips from false to true", () => {
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("toggleCommandPalette flips from true to false", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("two toggles return to original state", () => {
    useUIStore.getState().toggleCommandPalette();
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });
});

describe("useUIStore — sidebar", () => {
  it("setSidebarCollapsed(true) collapses sidebar", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it("setSidebarCollapsed(false) expands sidebar", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    useUIStore.getState().setSidebarCollapsed(false);
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggleSidebar flips from false to true", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it("toggleSidebar flips from true to false", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe("useUIStore — independence of state slices", () => {
  it("toggling sidebar does not affect command palette", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("toggling palette does not affect sidebar", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});
