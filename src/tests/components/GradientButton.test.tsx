import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradientButton } from "@/components/ui/gradient-button";

describe("GradientButton", () => {
  it("renders a native button by default", () => {
    render(<GradientButton>Save</GradientButton>);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("passes button styling to a single child without nesting controls", () => {
    render(
      <GradientButton asChild>
        <a href="/apply">Apply now</a>
      </GradientButton>,
    );

    expect(screen.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/apply");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables and labels the loading state", () => {
    render(<GradientButton loading>Save</GradientButton>);

    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
  });
});
