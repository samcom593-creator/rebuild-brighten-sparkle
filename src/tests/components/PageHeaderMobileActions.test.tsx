import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

describe("PageHeader mobile action disclosure", () => {
  it("keeps the primary action visible and progressively discloses secondary actions", () => {
    render(
      <PageHeader
        title="Clients"
        actions={(
          <>
            <Button variant="outline">Refresh</Button>
            <Button>Add Client</Button>
            <Button variant="outline">Import</Button>
          </>
        )}
      />,
    );

    expect(screen.getByText("Add Client").parentElement?.className).toContain("apex-page-primary-action");
    const disclosure = screen.getByRole("button", { name: /More \(2\)/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
  });

  it("unwraps a layout-only action container before choosing the primary action", () => {
    render(
      <PageHeader
        title="Planner"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline">Export</Button>
            <Button>Add Block</Button>
          </div>
        )}
      />,
    );

    expect(screen.getByText("Add Block").parentElement?.className).toContain("apex-page-primary-action");
    expect(screen.getByRole("button", { name: /More \(1\)/ })).toBeTruthy();
  });
});
