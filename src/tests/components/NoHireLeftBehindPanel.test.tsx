/**
 * No Hire Left Behind summary row (src/components/recruiting/NoHireLeftBehindPanel.tsx), colour
 * layer 2026-10-28: the two counts are tone pills in the shared vocabulary, with the same words
 * as before. Open steps need a nudge (warm), a hire blocked from writing business is "act now"
 * (hot), and a zero on either reads as going well. Loading and a failed read stay sentences.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const facts = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false, isError: false, error: null as unknown }));

vi.mock("@/components/onboarding/useOnboardingExceptionFacts", () => ({ useOnboardingExceptionFacts: () => facts }));
vi.mock("@/components/onboarding/OnboardingExceptionQueue", () => ({ OnboardingExceptionQueue: () => <p>queue preview</p> }));
// The rule module is covered on its own; here a fact row is already an exception with its primary requirement.
vi.mock("@/lib/onboardingExceptions", () => ({ buildExceptionQueue: (rows: unknown[]) => rows }));

import { NoHireLeftBehindPanel } from "@/components/recruiting/NoHireLeftBehindPanel";

const renderPanel = () => render(<MemoryRouter><NoHireLeftBehindPanel /></MemoryRouter>);

beforeEach(() => {
  facts.data = [];
  facts.isLoading = false;
  facts.isError = false;
  facts.error = null;
});

describe("NoHireLeftBehindPanel", () => {
  it("says the counts in words inside tone pills: open steps warm, blocked hot", () => {
    facts.data = [{ primary: { blocking: true } }, { primary: { blocking: false } }, { primary: null }];
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: "No Hire Left Behind" })).toBeInTheDocument();
    expect(screen.getByText("New hires with an open onboarding step.")).toBeInTheDocument();
    const open = screen.getByText("3 hires with open steps");
    expect(open.className).toMatch(/text-tone-warm/);
    expect(open.className).toMatch(/bg-tone-warm\/12/);
    const blocked = screen.getByText("1 blocked from writing business");
    expect(blocked.className).toMatch(/text-tone-hot/);
    // The title's bubble is decoration; the words carry the meaning.
    const bubble = screen.getByRole("heading", { level: 2 }).querySelector("span[aria-hidden='true']");
    expect(bubble?.className).toMatch(/text-tone-royal/);
    expect(screen.getByRole("link", { name: /Open queue/ })).toHaveAttribute("href", "/dashboard/onboarding-ladder");
  });

  it("reads a zero on either count as going well, one hire in the singular", () => {
    facts.data = [{ primary: { blocking: false } }];
    renderPanel();
    expect(screen.getByText("1 hire with open steps").className).toMatch(/text-tone-warm/);
    expect(screen.getByText("0 blocked from writing business").className).toMatch(/text-tone-good/);
    facts.data = [];
    renderPanel();
    expect(screen.getByText("0 hires with open steps").className).toMatch(/text-tone-good/);
  });

  it("keeps loading and a failed read as plain sentences, never a zero", () => {
    facts.isLoading = true;
    const { unmount } = renderPanel();
    expect(screen.getByText(/Counting them now\./)).toBeInTheDocument();
    expect(screen.queryByText(/with open steps/)).toBeNull();
    unmount();
    facts.isLoading = false;
    facts.isError = true;
    renderPanel();
    expect(screen.getByText(/The queue could not load\. Open it to retry\./)).toBeInTheDocument();
    expect(screen.queryByText(/blocked from writing business/)).toBeNull();
  });

  it("Preview opens the queue one tap away and says so", () => {
    renderPanel();
    const preview = screen.getByRole("button", { name: /Preview/ });
    expect(preview).toHaveAttribute("aria-expanded", "false");
    expect(preview.className).toMatch(/\bh-11\b/);
    fireEvent.click(preview);
    expect(screen.getByRole("button", { name: /Hide/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("queue preview")).toBeInTheDocument();
  });
});
