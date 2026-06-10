import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import InboundLeads from "@/pages/InboundLeads";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-001", email: "sam@example.com" },
    isAdmin: true,
    isManager: false,
  }),
}));

vi.mock("@/hooks/usePageTitle", () => ({
  usePageTitle: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

function makeInboundFromMock() {
  return vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }));
}

describe("InboundLeads", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: vi.fn(() => store.clear()),
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        removeItem: vi.fn((key: string) => store.delete(key)),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      },
    });
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(supabase.from).mockImplementation(makeInboundFromMock() as any);
  });

  it("opens the new-client intake, saves locally when remote insert is unavailable, and shows the lead", async () => {
    const user = userEvent.setup();
    render(<InboundLeads />);

    expect(await screen.findByRole("heading", { name: "Inbound Leads" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New Client" }));
    expect(screen.getByRole("heading", { name: "New inbound client" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Client first name"), "John");
    await user.type(screen.getByPlaceholderText("Client last name"), "Doe");
    await user.type(screen.getByPlaceholderText("(555) 123-4567"), "6025551212");
    await user.type(
      screen.getByPlaceholderText(/Transcript lands here/i),
      "My name is John Doe. I need mortgage protection today and can spend $90 a month.",
    );

    await user.click(screen.getByRole("button", { name: "Save inbound lead" }));

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });
    expect(screen.getByText("Mortgage protection")).toBeInTheDocument();
    expect(screen.getByText("hot")).toBeInTheDocument();
  });
});
