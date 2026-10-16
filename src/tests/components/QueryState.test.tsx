/**
 * QueryState (F10 / F15 / F19 / F33): loading never shows the empty copy,
 * error shows the message plus a working Retry, empty shows its title and
 * body, ready renders children, and stale keeps children under an as-of label.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryState, describeQuery } from "@/components/ui/query-state";

describe("QueryState", () => {
  it("loading renders a busy status and neither the empty copy nor the children", () => {
    render(
      <QueryState status="loading" label="deals" title="No deals logged yet">
        <p>rows</p>
      </QueryState>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading deals")).toBeInTheDocument();
    expect(screen.queryByText("No deals logged yet")).not.toBeInTheDocument();
    expect(screen.queryByText("rows")).not.toBeInTheDocument();
  });

  it("error renders the plain-English message and a working Retry, never the empty copy or children", () => {
    const onRetry = vi.fn();
    render(
      <QueryState status="error" label="deals" error={{ message: "permission denied", code: "42501" }} onRetry={onRetry} title="No deals logged yet">
        <p>rows</p>
      </QueryState>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Deals could not load.");
    expect(alert).toHaveTextContent("You do not have permission to view this.");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No deals logged yet")).not.toBeInTheDocument();
    expect(screen.queryByText("rows")).not.toBeInTheDocument();
  });

  it("error without onRetry has no button, and without a label uses generic copy", () => {
    render(<QueryState status="error" error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This could not load.");
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("compact error is one inline line that says Unavailable", () => {
    render(<QueryState status="error" compact error="timed out" onRetry={() => undefined} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Unavailable");
    expect(alert).toHaveTextContent("timed out");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("empty renders the title and body", () => {
    render(<QueryState status="empty" title="No deals logged yet" body="Use Post a Deal to record the first one." />);
    expect(screen.getByText("No deals logged yet")).toBeInTheDocument();
    expect(screen.getByText("Use Post a Deal to record the first one.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ready renders the children and no notice", () => {
    render(
      <QueryState status="ready">
        <p>rows</p>
      </QueryState>,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ready + stale keeps the children on screen under an as-of label with a Retry", () => {
    const onRetry = vi.fn();
    render(
      <QueryState status="ready" stale asOf="2 minutes ago" error={new Error("Failed to fetch")} onRetry={onRetry}>
        <p>rows</p>
      </QueryState>,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Showing data as of 2 minutes ago. The latest refresh failed. Network error. Check your connection and retry.");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("spreads describeQuery straight into its props", () => {
    const q = { isPending: false, isError: true, data: [{ id: 1 }], error: new Error("refresh failed") };
    render(
      <QueryState {...describeQuery(q)} label="deals">
        <p>rows</p>
      </QueryState>,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("refresh failed");
  });
});
