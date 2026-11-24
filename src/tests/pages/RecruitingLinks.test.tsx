import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import RecruitingLinks from "@/pages/RecruitingLinks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "admin-one" } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
type Rpc = (name: string) => Promise<{ data: unknown; error: unknown }>;
const rpc = vi.mocked(supabase.rpc as unknown as Rpc);
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  rpc.mockReset(); writeText.mockClear(); auth.user.id = "admin-one";
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = () => <QueryClientProvider client={client}><MemoryRouter><RecruitingLinks /></MemoryRouter></QueryClientProvider>;
  const view = render(app());
  return { client, rerender: () => view.rerender(app()) };
}

describe("manager recruiting links", () => {
  it("copies the canonical encoded owner link and connects the application and hiring workflows", async () => {
    rpc.mockResolvedValue({ data: [{ agent_id: "manager-1", display_name: "Pat", account_mode: "manager", is_manager: true, ref_slug: " a b/c ", avatar_url: null }], error: null });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "/r/a b/c" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://galaxyfinancial.org/r/a%20b%2Fc"));
    expect(screen.getByRole("link", { name: "Grow my team" })).toHaveAttribute("href", "/dashboard/grow");
    expect(screen.getByRole("link", { name: "Review applicants" })).toHaveAttribute("href", "/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Personal hiring invitation" })).toHaveAttribute("href", "/admin/invite-links");
    expect(screen.getByText(/Review and hire the applicant to create their agent account/)).toBeInTheDocument();
    expect(decodeURIComponent(screen.getByRole("link", { name: "Text Pat's application link" }).getAttribute("href") ?? "")).toContain("https://galaxyfinancial.org/r/a%20b%2Fc");
  });

  it("shows a retryable load failure without calling it an empty roster", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("Recruiting feed unavailable") })
      .mockResolvedValueOnce({ data: [], error: null });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Recruiting feed unavailable");
    expect(screen.queryByText("No matches.")).not.toBeInTheDocument();
    expect(screen.queryByText("No active managers found.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry links" }));
    await screen.findByText("No active managers found.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a prior login's recruiting roster", async () => {
    rpc.mockResolvedValueOnce({ data: [{ agent_id: "manager-one", display_name: "First roster", account_mode: "manager", is_manager: true, ref_slug: "first", avatar_url: null }], error: null })
      .mockResolvedValueOnce({ data: [{ agent_id: "manager-two", display_name: "Second roster", account_mode: "manager", is_manager: true, ref_slug: "second", avatar_url: null }], error: null });
    const view = renderPage();
    await screen.findByText("First roster");
    auth.user.id = "admin-two";
    view.rerender();
    expect(screen.queryByText("First roster")).not.toBeInTheDocument();
    await screen.findByText("Second roster");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryData(["admin-recruiting-links", "admin-one"])).toEqual(expect.arrayContaining([expect.objectContaining({ display_name: "First roster" })]));
    expect(view.client.getQueryData(["admin-recruiting-links", "admin-two"])).toEqual(expect.arrayContaining([expect.objectContaining({ display_name: "Second roster" })]));
  });
});
