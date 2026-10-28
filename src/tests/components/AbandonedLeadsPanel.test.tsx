import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A failed load must never read as "no abandoned applications" (unknown is not zero).
const rpc = vi.hoisted(() => ({ fail: false, rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve(rpc.fail
      ? { data: null, error: new Error("canceling statement due to statement timeout") }
      : { data: rpc.rows, error: null }),
  },
}));

import { AbandonedLeadsPanel } from "@/components/dashboard/AbandonedLeadsPanel";

afterEach(() => {
  rpc.fail = false;
  rpc.rows = [];
});

describe("AbandonedLeadsPanel", () => {
  it("a failed load reads as an error with the reason, not as an empty, happy list", async () => {
    rpc.fail = true;
    render(<AbandonedLeadsPanel />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be loaded");
    expect(alert.textContent).toContain("statement timeout");
    expect(screen.queryByText(/No abandoned applications/)).toBeNull();
  });

  it("an empty successful load still says so", async () => {
    render(<AbandonedLeadsPanel />);
    await waitFor(() => expect(screen.getByText(/No abandoned applications/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
