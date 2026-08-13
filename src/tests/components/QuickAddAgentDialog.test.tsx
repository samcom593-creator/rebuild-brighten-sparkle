import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();

// The component binds supabase.rpc at module load, so the mock's rpc has to
// exist before the import below and must dispatch through a stable wrapper.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { QuickAddAgentDialog } from "@/components/onboarding/QuickAddAgentDialog";

const FIELD_IDS = [
  "quick-agent-first-name",
  "quick-agent-last-name",
  "quick-agent-email",
  "quick-agent-phone",
  "quick-agent-npn",
] as const;

const GOOD: Record<(typeof FIELD_IDS)[number], string> = {
  "quick-agent-first-name": "Avery",
  "quick-agent-last-name": "James",
  "quick-agent-email": "AVERY@Example.com",
  "quick-agent-phone": "(602) 555-0123",
  "quick-agent-npn": "21-346-999",
};

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /add agent/i }));
}

function fill(values: Partial<typeof GOOD> = {}) {
  const merged = { ...GOOD, ...values };
  for (const [id, value] of Object.entries(merged)) {
    fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
  }
}

function submitForm() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

beforeEach(() => {
  rpc.mockReset();
});

describe("QuickAddAgentDialog · the exact five NPN fields", () => {
  it("renders exactly five inputs — NPN, never a PA number", () => {
    render(<QuickAddAgentDialog />);
    openDialog();
    for (const id of FIELD_IDS) {
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.getElementById("quick-agent-pa-number")).toBeNull();
    expect(document.querySelectorAll("form input")).toHaveLength(5);
    // NPN is a numeric identifier; the field must hint the numeric keyboard.
    expect(document.getElementById("quick-agent-npn")!.getAttribute("inputmode")).toBe("numeric");
  });
});

describe("QuickAddAgentDialog · RPC mapping", () => {
  it("calls create_apex_toolkit_agent with normalized p_* args and no p_pa_number", async () => {
    rpc.mockResolvedValue({ data: { agentId: "agent-1" }, error: null });
    const onAgentAdded = vi.fn();
    render(<QuickAddAgentDialog onAgentAdded={onAgentAdded} />);
    openDialog();
    fill();
    submitForm();

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [fnName, payload] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("create_apex_toolkit_agent");
    expect(payload).toEqual({
      p_first_name: "Avery",
      p_last_name: "James",
      p_email: "avery@example.com",
      p_phone: "+16025550123",
      p_npn: "21346999",
    });
    expect(Object.keys(payload)).not.toContain("p_pa_number");
    await waitFor(() => expect(onAgentAdded).toHaveBeenCalledWith("agent-1"));
  });

  it("does not touch the network when validation fails", async () => {
    render(<QuickAddAgentDialog />);
    openDialog();
    fill({ "quick-agent-npn": "1234", "quick-agent-email": "nope" });
    submitForm();
    await waitFor(() =>
      expect(screen.getByText(/NPN must be 5 to 10 digits/i)).toBeTruthy(),
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("QuickAddAgentDialog · idempotent submit guard", () => {
  it("a second submit while the first RPC is in flight does not fire a second RPC", async () => {
    let resolveRpc!: (value: { data: unknown; error: null }) => void;
    rpc.mockImplementation(
      () => new Promise((resolve) => { resolveRpc = resolve; }),
    );
    render(<QuickAddAgentDialog />);
    openDialog();
    fill();

    // Same-tick double submit: setSaving hasn't flushed yet, so only the
    // synchronous submitInFlightRef can block the second one.
    submitForm();
    submitForm();
    expect(rpc).toHaveBeenCalledTimes(1);
    // And again after React has rerendered with saving=true.
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    submitForm();
    expect(rpc).toHaveBeenCalledTimes(1);

    resolveRpc({ data: { agentId: "agent-2" }, error: null });
    // Dialog closes after success; the RPC still ran exactly once.
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
