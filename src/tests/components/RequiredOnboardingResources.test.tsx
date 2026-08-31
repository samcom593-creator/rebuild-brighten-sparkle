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
    expect(screen.getByRole("link", { name: /Onboarding help/i })).toHaveAttribute("href", "tel:+19788047212");
  });
});
