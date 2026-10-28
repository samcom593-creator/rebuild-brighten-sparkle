/**
 * The one removable filter chip shared by the Call list, Pipeline and New hires pages
 * (src/components/recruiting/FilterChip.tsx, Grow review 2026-10-28, finding 36).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterChip } from "@/components/recruiting/FilterChip";

describe("FilterChip", () => {
  it("is one 44px button named for what it removes, showing the label and the count", () => {
    const onRemove = vi.fn();
    render(<FilterChip label="License: Pending" count={7} onRemove={onRemove} />);
    const chip = screen.getByRole("button", { name: "Remove License: Pending filter" });
    expect(chip).toHaveTextContent(/^License: Pending\s*7$/);
    expect(chip.className).toMatch(/\bh-11\b/);
    expect(chip.className).toMatch(/\brounded-full\b/);
    expect(chip.className).toMatch(/\btext-sm\b/);
    // The cross is decoration; the name says what the tap does.
    expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(chip);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows no number when the page gives none, and a real zero when it does", () => {
    const { rerender } = render(<FilterChip label="Board view" onRemove={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove Board view filter" })).toHaveTextContent(/^Board view$/);
    rerender(<FilterChip label="Board view" count={0} onRemove={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove Board view filter" })).toHaveTextContent(/^Board view\s*0$/);
  });
});
