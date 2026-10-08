import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const ideas = Array.from({ length: 6 }, (_, i) => ({ day: i + 1, format: "Long", score: 90 - i, title: `Video ${i + 1}`, why: "A real story" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const query = {
    select: () => query, eq: () => query, gte: () => query, order: () => query,
    range: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: table === "system_settings" ? { value: JSON.stringify({ ideas }) } : null, error: null }),
  };
  return query;
} } }));
import { ContentHome } from "@/components/content/AccountsAnalytics";

describe("filming picker", () => {
  it("shows three choices, sends the chosen idea to the board, and expands on demand", async () => {
    const pick = vi.fn();
    render(<ContentHome onOpenAnalytics={() => {}} onPick={pick} />);
    const choices = await screen.findAllByRole("button", { name: "Film this" });
    expect(choices).toHaveLength(3);
    fireEvent.click(choices[0]);
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^Video /), format: "Long" }));
    fireEvent.click(screen.getByRole("button", { name: "See all 6 ideas" }));
    expect(screen.getAllByRole("button", { name: "Film this" })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Back to three choices" }));
    expect(screen.getAllByRole("button", { name: "Film this" })).toHaveLength(3);
  });
  it("disables selection while a save or workflow check is pending", async () => {
    render(<ContentHome onOpenAnalytics={() => {}} onPick={vi.fn()} picking />);
    for (const button of await screen.findAllByRole("button", { name: "Film this" })) expect(button).toBeDisabled();
  });
});
