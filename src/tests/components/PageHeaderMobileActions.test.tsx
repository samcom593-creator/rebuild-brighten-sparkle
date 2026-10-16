import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("gives every action a key, so React does not warn about an unkeyed list whether there is one action or several", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PageHeader title="One" actions={<Button>Only</Button>} />);
    render(<PageHeader title="Many" actions={(<><Button variant="outline">Refresh</Button><Button>Add</Button><Button variant="outline">Import</Button></>)} />);
    const keyWarnings = spy.mock.calls.filter((c) => String(c[0]).includes("unique \"key\" prop"));
    spy.mockRestore();
    expect(keyWarnings).toHaveLength(0);
  });
});

describe("PageHeader explicit slots (F38)", () => {
  it("renders the declared primary, keeps view controls out of More, and discloses the secondaries", () => {
    render(
      <PageHeader
        title="Calendar"
        primaryAction={<Button>New appointment</Button>}
        secondaryActions={(
          <>
            <Button variant="outline">Export</Button>
            <Button variant="outline">Settings</Button>
          </>
        )}
        viewControls={(
          <div role="tablist">
            <button type="button" role="tab">Day</button>
            <button type="button" role="tab">Week</button>
          </div>
        )}
      />,
    );

    expect(screen.getByText("New appointment").parentElement?.className).toContain("apex-page-primary-action");
    const tablist = screen.getByRole("tablist");
    expect(tablist.closest(".apex-page-view-controls")).toBeTruthy();
    expect(tablist.closest(".apex-page-secondary-actions")).toBeNull();
    const disclosure = screen.getByRole("button", { name: /More \(2\)/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Export" }).closest(".apex-page-secondary-actions")).toBeTruthy();
  });

  it("shows view controls on their own without a More button", () => {
    render(<PageHeader title="Attendance" viewControls={<Button variant="outline">Previous week</Button>} />);
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
  });

  it("folds a legacy actions bag into the secondary slot when a primary is declared", () => {
    render(
      <PageHeader
        title="Team"
        primaryAction={<Button>Add Agent</Button>}
        actions={(
          <>
            <Button variant="outline">Import</Button>
            <Button variant="outline">Export</Button>
          </>
        )}
      />,
    );
    expect(screen.getByText("Add Agent").parentElement?.className).toContain("apex-page-primary-action");
    expect(screen.getByRole("button", { name: /More \(2\)/ })).toBeTruthy();
  });

  it("keeps the legacy primary when a page moves only its view controls to the new slot", () => {
    render(
      <PageHeader
        title="Calendar"
        viewControls={<Button variant="outline">Previous day</Button>}
        actions={(
          <>
            <Button>New appointment</Button>
            <Button variant="outline">Export</Button>
          </>
        )}
      />,
    );
    expect(screen.getByText("New appointment").parentElement?.className).toContain("apex-page-primary-action");
    expect(screen.getByRole("button", { name: /More \(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" }).closest(".apex-page-secondary-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous day" }).closest(".apex-page-view-controls")).toBeTruthy();
  });

  it("ranks the legacy bag by props even beside declared secondaries, and keeps a lone legacy item visible", () => {
    render(
      <PageHeader
        title="Attendance"
        secondaryActions={<Button variant="outline">Settings</Button>}
        actions={<Button variant="outline">Export</Button>}
      />,
    );
    expect(screen.getByText("Export").parentElement?.className).toContain("apex-page-primary-action");
    expect(screen.getByRole("button", { name: "Settings" }).closest(".apex-page-secondary-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: /More \(1\)/ })).toBeTruthy();
  });

  it("does not infer a primary once primaryAction is declared, even as null", () => {
    const { container } = render(
      <PageHeader
        title="Team"
        primaryAction={null}
        actions={(
          <>
            <Button>New appointment</Button>
            <Button variant="outline">Export</Button>
          </>
        )}
      />,
    );
    expect(container.querySelector(".apex-page-primary-action")).toBeNull();
    expect(screen.getByRole("button", { name: /More \(2\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New appointment" }).closest(".apex-page-secondary-actions")).toBeTruthy();
  });

  it("never guesses the primary from a component's name", () => {
    function AddThing() {
      return <button type="button">Add thing</button>;
    }
    render(
      <PageHeader
        title="Things"
        actions={(
          <>
            <Button variant="outline">Refresh</Button>
            <AddThing />
            <Button variant="outline">Import</Button>
          </>
        )}
      />,
    );
    expect(screen.getByText("Add thing").closest(".apex-page-primary-action")).toBeNull();
  });
});
