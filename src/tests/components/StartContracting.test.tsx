import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const invoke = vi.fn();
const getSession = vi.fn();
const prefillRows: Record<string, unknown> = {};

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

function queryFor(table: string) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: prefillRows[table] ?? null, error: null }),
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
    from: (table: string) => queryFor(table),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));
vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import StartContracting from "@/pages/StartContracting";

const GOOD = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone: "(602) 555-0143",
  npn: "21346999",
};

async function fill(values: Partial<typeof GOOD> = {}) {
  await waitFor(() => expect(document.querySelector("#first_name")).toBeTruthy());
  const merged = { ...GOOD, ...values };
  for (const [name, value] of Object.entries(merged)) {
    const input = document.querySelector(`#${name}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
  }
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  invoke.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null } });
  for (const key of Object.keys(prefillRows)) delete prefillRows[key];
  window.localStorage.clear();
});

describe("StartContracting · the five-field contract", () => {
  it("asks for exactly five fields and nothing forbidden", async () => {
    render(<StartContracting />);
    await waitFor(() => expect(document.querySelector("#first_name")).toBeTruthy());
    for (const name of Object.keys(GOOD)) {
      expect(document.querySelector(`#${name}`)).toBeTruthy();
    }
    // The liability check: none of these may ever appear on a public form.
    for (const forbidden of ["pa_number", "paNumber", "ssn", "dob", "password", "routing_number"]) {
      expect(document.querySelector(`#${forbidden}`)).toBeNull();
    }
    expect(document.querySelectorAll("form input:not([tabindex='-1'])")).toHaveLength(5);
  });

  it("uses signed-in profile data and asks only for what is missing", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "auth@example.com" } } },
    });
    prefillRows.profiles = {
      full_name: "Morgan Archer",
      email: "jane@example.com",
      phone: "(602) 555-0143",
    };
    prefillRows.agents = {
      display_name: "Morgan Archer",
      nipr_number: "21346999",
      source_application_id: null,
    };

    render(<StartContracting />);

    expect(await screen.findByRole("heading", { name: "Your details are ready" })).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
    expect(screen.getByText("jane@example.com")).toBeTruthy();
    expect(screen.getByText("21346999")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("First name")).toHaveValue("Morgan");
    expect(screen.getByLabelText("Last name")).toHaveValue("Archer");
  });

  it("shows only the missing detail when saved information is incomplete", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "auth@example.com" } } },
    });
    prefillRows.profiles = {
      full_name: "Morgan Archer",
      email: "jane@example.com",
      phone: "(602) 555-0143",
    };
    prefillRows.agents = {
      display_name: "Morgan Archer",
      nipr_number: null,
      source_application_id: null,
    };

    render(<StartContracting />);

    expect(await screen.findByRole("heading", { name: "4 details already filled" })).toBeTruthy();
    expect(screen.getByText("One detail left")).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
    expect(screen.getByLabelText("NPN")).toBeTruthy();
    expect(document.querySelectorAll("form input:not([tabindex='-1'])")).toHaveLength(1);
  });

  it("states plainly that it does not ask for sensitive data", async () => {
    render(<StartContracting />);
    await screen.findByLabelText("First name");
    expect(screen.getByText(/sensitive identity and banking details/i)).toBeTruthy();
  });
});

describe("StartContracting · validation before the network", () => {
  it("marks every bad field at once and does not call the server", async () => {
    render(<StartContracting />);
    await fill({ phone: "123", npn: "1234", email: "nope" });
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/10-digit US mobile number/i)).toBeTruthy();
    expect(screen.getByText(/valid email address/i)).toBeTruthy();
    // Too short is a different problem from missing, and says so.
    expect(screen.getByText(/NPN is 5 to 10 digits/i)).toBeTruthy();
  });

  it("distinguishes a missing NPN from a malformed one", async () => {
    render(<StartContracting />);
    await fill({ npn: "abc" });
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    // "abc" normalizes to no digits at all, so the honest message is that the
    // field is empty, not that its length is wrong.
    await waitFor(() => expect(screen.getByText(/Enter your NPN/i)).toBeTruthy());
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("StartContracting · after a durable acceptance", () => {
  it("activates the profile without exposing an internal queue", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted" },
      error: null,
    });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getByText(/profile is active/i)).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Contracting Initiated — Fast Track Active" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /book with milver taca/i })).toHaveAttribute(
      "href",
      "https://calendly.com/apexfinancialempire/apex-onboarding-call",
    );
    expect(screen.queryByText(/queued/i)).toBeNull();
    expect(screen.queryByText(/has been notified/i)).toBeNull();
  });

  it("ignores an obsolete external continuation and shows only approved next steps", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted", continue_url: "https://example.com/obsolete" },
      error: null,
    });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await screen.findByText(/profile is active/i);
    const links = screen.getAllByRole("link") as HTMLAnchorElement[];
    expect(links.map((link) => link.href)).not.toContain("https://example.com/obsolete");
    expect(screen.getByRole("link", { name: /continue to your onboarding roadmap/i })).toHaveAttribute(
      "href",
      "/agent-portal",
    );
    expect(screen.getByRole("link", { name: /e&o coverage/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /join team slack/i })).toHaveAttribute(
      "href",
      "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ",
    );
  });

  it("survives a reload", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-1", status: "accepted" },
      error: null,
    });
    const first = render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));
    await screen.findByText(/profile is active/i);
    first.unmount();

    // A producer who refreshes must not see an empty form and submit again.
    render(<StartContracting />);
    expect(screen.getByText(/profile is active/i)).toBeTruthy();
  });

  it("explains a held review without blaming the producer", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, intake_id: "id-2", status: "needs_review", review_reason: "email_matches_a_different_npn" },
      error: null,
    });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getByText(/already on file under a different NPN/i)).toBeTruthy());
    expect(screen.getByText(/Nothing was overwritten/i)).toBeTruthy();
  });
});

describe("StartContracting · failure paths", () => {
  it("shows a real error instead of a success screen when the call fails", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

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
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getByText(/could not record that/i)).toBeTruthy());
    expect(screen.queryByText(/You're in the queue/i)).toBeNull();
  });

  it("maps a server field error back onto its field", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: "npn_invalid", field: "npn" },
      error: null,
    });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getByText(/NPN is 5 to 10 digits/i)).toBeTruthy());
  });

  it("explains when an NPN belongs to another account", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => ({ error: { message: "npn_in_use", field: "npn" } }),
        },
      },
    });
    render(<StartContracting />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /start contracting/i }));

    await waitFor(() => expect(screen.getByText(/already tied to another account/i)).toBeTruthy());
    expect(screen.queryByText(/profile is active/i)).toBeNull();
  });
});
