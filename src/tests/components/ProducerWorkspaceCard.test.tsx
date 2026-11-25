import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { producerWorkspaceFixture } from "@/tests/helpers/producerWorkspaceFixture";
import type { ProducerWorkspace } from "@/lib/producerWorkspace";

const facts = vi.hoisted(() => ({ data: undefined as ProducerWorkspace | undefined, isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock("@/hooks/useProducerWorkspace", () => ({ useProducerWorkspace: () => facts }));
import { ProducerWorkspaceCard } from "@/components/dashboard/ProducerWorkspaceCard";

const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProducerWorkspaceCard agentId="producer-a" /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { facts.data = producerWorkspaceFixture(); facts.isLoading = false; facts.isError = false; });

describe("producer workspace card", () => {
  it("distinguishes posted ALP from partial carrier evidence and missing payment evidence", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Your $20,000 month" })).toBeInTheDocument();
    expect(screen.getByText("of $20,000 posted ALP")).toBeInTheDocument();
    expect(screen.getByText(/Payment confirmation: —/)).toBeInTheDocument();
    expect(screen.getByText("Carrier in force · written this month")).toBeInTheDocument();
    expect(screen.getByText("Active after 90 days")).toBeInTheDocument();
    expect(screen.getByText(/Recorded sale-disposition rate: 10%/)).toBeInTheDocument();
    expect(screen.getByText(/Required calls are unavailable because provider sale dispositions are not linked/)).toBeInTheDocument();
    expect(screen.queryByText("20 completed calls per selling day")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Work my clients" })).toHaveAttribute("href", "/dashboard/agent-pipeline");
  });

  it("does not fabricate zero production or a streak when the verified read fails", () => {
    facts.data = undefined; facts.isError = true;
    mount();
    expect(screen.getByText(/Your plan could not be verified/)).toBeInTheDocument();
    expect(screen.queryByText(/selling-day production streak/)).toBeNull();
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not ask a producer who already hit the goal to build a calling baseline", () => {
    facts.data!.production_ap = 21000;
    facts.data!.activity.sample_policies = 0;
    facts.data!.activity.sample_calls = 0;
    facts.data!.activity.sample_sold_calls = 0;
    mount();
    expect(screen.getByText("Goal hit")).toBeInTheDocument();
    expect(screen.getByText(/Your monthly production goal is complete/)).toBeInTheDocument();
    expect(screen.queryByText(/Your calling estimate needs/)).toBeNull();
  });

  it("keeps unsaved selling days during a production refresh and disables an unchanged save", () => {
    const view = mount();
    fireEvent.click(screen.getByText(/Selling schedule ·/));
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    facts.data = { ...producerWorkspaceFixture(), production_ap: 6000 };
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProducerWorkspaceCard agentId="producer-a" /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeDisabled();
  });
});
