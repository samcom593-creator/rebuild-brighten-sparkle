import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RequiredOnboardingResources } from "@/components/training/RequiredOnboardingResources";

describe("RequiredOnboardingResources", () => {
  it("shows one clear course route plus the script and support contact", () => {
    render(
      <MemoryRouter>
        <RequiredOnboardingResources />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Practice toolkit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Field-release course/i })).toHaveAttribute(
      "href",
      "/dashboard/training/sales-course",
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Official .* script/i })).toHaveAttribute("target", "_blank");
    // This assertion used to require href="tel:+19788047212" — it was pinning the
    // 2026-08-16 dead click in place. jsdom reports a fine pointer, i.e. desktop,
    // where a bare tel: opens nothing; @/lib/phone routes desktop through Google
    // Voice and keeps native dialing behind (pointer: coarse). The support number
    // survives as the fallback, so an unnormalisable value still renders a link.
    const support = screen.getByRole("link", { name: /Onboarding help/i });
    expect(support).toHaveAttribute("href", expect.stringContaining("voice.google.com"));
    // Decode the `continue` param rather than asserting on an encoding artifact:
    // the number is escaped once into the Voice URL and again into the account
    // chooser, so a literal-substring assertion pins %252B and breaks the day
    // either layer changes without the contract changing.
    const target = decodeURIComponent(new URL(support.getAttribute("href")!).searchParams.get("continue") ?? "");
    expect(target).toContain("+19788047212");
    expect(support).toHaveAttribute("target", "_blank");
  });
});
