import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPathPanel } from "@/components/training/TrainingPathPanel";

const mock = vi.hoisted(() => ({ status: "resolved", filters: [] as any[], progressError: false }));
vi.mock("@/hooks/useTrainingIdentity", () => ({ useTrainingIdentity: () => ({ agentId: mock.status === "resolved" ? "canonical" : null, identity: { status: mock.status, message: "Your saved history has not been reset." }, isLoading: false, isError: ["error", "history_review"].includes(mock.status), refetch: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const chain: any = {};
  for (const method of ["select", "order"]) chain[method] = () => chain;
  chain.eq = (key: string, value: unknown) => { mock.filters.push([table, key, value]); return chain; };
  chain.then = (resolve: any, reject: any) => Promise.resolve({ data: table === "onboarding_modules" ? [{ id: "m", order_index: 1, title: "First module" }] : [{ module_id: "m", passed: true, score: 100 }], error: table === "onboarding_progress" && mock.progressError ? new Error("unavailable") : null }).then(resolve, reject);
  return chain;
} } }));
function setup() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TrainingPathPanel /></MemoryRouter></QueryClientProvider>); }
describe("training path identity", () => {
  beforeEach(() => { mock.status = "resolved"; mock.filters.length = 0; mock.progressError = false; });
  it("uses canonical progress for the same completion shown in the course", async () => {
    setup(); await screen.findByText("1 of 1 module complete (100%)");
    expect(mock.filters).toContainEqual(["onboarding_progress", "agent_id", "canonical"]);
  });
  it("does not show zero progress when account identity is ambiguous", async () => {
    mock.status = "ambiguous"; setup(); await screen.findByText("Your training account needs review");
    expect(mock.filters.some(([table]) => table === "onboarding_progress")).toBe(false);
  });
  it("reports failed progress rather than rendering a completion count", async () => {
    mock.progressError = true; setup(); await screen.findByText("Couldn't load your training path");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("shows known alias history for review without rendering zero progress", async () => {
    mock.status = "history_review"; setup(); await screen.findByText("Your training history needs review");
    expect(screen.getByText("Your saved history has not been reset.")).toBeInTheDocument();
    expect(mock.filters.some(([table]) => table === "onboarding_progress")).toBe(false);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
