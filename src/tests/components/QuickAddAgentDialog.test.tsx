import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canonicalModal = vi.fn();

vi.mock("@/components/dashboard/AddAgentModal", () => ({
  AddAgentModal: (props: { trigger?: ReactNode; onAgentAdded?: (id?: string) => void }) => {
    canonicalModal(props);
    return (
      <div>
        {props.trigger}
        <button onClick={() => props.onAgentAdded?.("agent-1")}>Complete canonical add</button>
      </div>
    );
  },
}));

import { QuickAddAgentDialog } from "@/components/onboarding/QuickAddAgentDialog";

beforeEach(() => canonicalModal.mockClear());

describe("QuickAddAgentDialog", () => {
  it("routes every legacy quick-add surface through the canonical workflow", () => {
    const onAgentAdded = vi.fn();
    render(
      <QuickAddAgentDialog
        trigger={<button>Legacy trigger</button>}
        onAgentAdded={onAgentAdded}
      />,
    );

    expect(screen.getByRole("button", { name: "Legacy trigger" })).toBeTruthy();
    expect(canonicalModal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Complete canonical add" }));
    expect(onAgentAdded).toHaveBeenCalledWith("agent-1");
  });

  it("does not report an add when the canonical workflow returns no agent id", () => {
    const onAgentAdded = vi.fn();
    render(<QuickAddAgentDialog onAgentAdded={onAgentAdded} />);
    const props = canonicalModal.mock.calls[0][0] as { onAgentAdded: (id?: string) => void };
    props.onAgentAdded(undefined);
    expect(onAgentAdded).not.toHaveBeenCalled();
  });
});
