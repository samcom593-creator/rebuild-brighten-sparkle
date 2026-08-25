import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));

import StartContracting from "@/pages/StartContracting";

const GOOD = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone: "(602) 555-0143",
  npn: "21346999",
};

function fill(values: Partial<typeof GOOD> = {}) {
  const merged = { ...GOOD, ...values };
  for (const [name, value] of Object.entries(merged)) {
    const input = document.querySelector(`#${name}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
  }
}

beforeEach(() => {
  invoke.mockReset();
  window.localStorage.clear();
});

describe("StartContracting · the five-field contract", () => {
  it("asks for exactly five fields and nothing forbidden", () => {
    render(<StartContracting />);
    for (const name of Object.keys(GOOD)) {
      expect(document.querySelector(`#${name}`)).toBeTruthy();
    }
    // The liability check: none of these may ever appear on a public form.
    for (const forbidden of ["pa_number", "paNumber", "ssn", "dob", "password", "routing_number"]) {
      expect(document.querySelector(`#${forbidden}`)).toBeNull();
    }
    expect(document.querySelectorAll("form input:not([tabindex='-1'])")).toHaveLength(5);
  });

  it("states plainly that it does not ask for sensitive data", () => {
    render(<StartContracting />);
    expect(screen.getByText(/never ask for your SSN/i)).toBeTruthy();
  });
});

describe("StartContracting · validation before the network", () => {
  it("marks every bad field at once and does not call the server", async () => {
    render(<StartContracting />);
    fill({ phone: "123", npn: "1234", email: "nope" });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/10-digit US mobile number/i)).toBeTruthy();
    expect(screen.getByText(/valid email address/i)).toBeTruthy();
    // Too short is a different problem from missing, and says so.
    expect(screen.getByText(/NPN is 5 to 10 digits/i)).toBeTruthy();
  });

  it("distinguishes a missing NPN from a malformed one", async () => {
    render(<StartContracting />);
    fill({ npn: "abc" });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    // "abc" normalizes to no digits at all, so the honest message is that the
    // field is empty, not that its length is wrong.
    await waitFor(() => expect(screen.getByText(/Enter your NPN/i)).toBeTruthy());
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("StartContracting · after a durable acceptance", () => {
  it("never claims support has been notified", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted" },
      error: null,
    });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/queued/i)).toBeTruthy());
    // Nothing has been sent at this point — the dispatcher has not run. Saying
    // "notified" would report a side effect that has not happened.
    expect(screen.queryByText(/has been notified/i)).toBeNull();
    expect(screen.queryByText(/delivered/i)).toBeNull();
    expect(screen.queryByText(/sent/i)).toBeNull();
  });

  it("ignores an obsolete external continuation and shows only approved next steps", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted", continue_url: "https://example.com/obsolete" },
      error: null,
    });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await screen.findByText(/queued/i);
    const links = screen.getAllByRole("link") as HTMLAnchorElement[];
    expect(links.map((link) => link.href)).not.toContain("https://example.com/obsolete");
    expect(screen.getByRole("link", { name: /open onboarding training/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /e&o coverage/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /join team discord/i })).toHaveAttribute(
      "href",
      "https://discord.gg/JpUWA73UZX",
    );
  });

  it("survives a reload", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted" },
      error: null,
    });
    const first = render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await screen.findByText(/queued/i);
    first.unmount();

    // A producer who refreshes must not see an empty form and submit again.
    render(<StartContracting />);
    expect(screen.getByText(/queued/i)).toBeTruthy();
  });

  it("explains a held review without blaming the producer", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-2", status: "needs_review", review_reason: "email_matches_a_different_npn" },
      error: null,
    });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/already on file under a different NPN/i)).toBeTruthy());
    expect(screen.getByText(/Nothing was overwritten/i)).toBeTruthy();
  });
});

describe("StartContracting · failure paths", () => {
  it("shows a real error instead of a success screen when the call fails", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/could not record that/i)).toBeTruthy());
    expect(screen.queryByText(/queued/i)).toBeNull();
  });

  it("does not show success when the server returns no intake id", async () => {
    // This is the honeypot's answer. A client that treated it as success would
    // show a producer a confirmation for a row that does not exist.
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: null, status: "discarded", delivery: "none" },
      error: null,
    });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/could not record that/i)).toBeTruthy());
    expect(screen.queryByText(/You're in the queue/i)).toBeNull();
  });

  it("maps a server field error back onto its field", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: "npn_invalid", field: "npn" },
      error: null,
    });
    render(<StartContracting />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/NPN is 5 to 10 digits/i)).toBeTruthy());
  });
});
