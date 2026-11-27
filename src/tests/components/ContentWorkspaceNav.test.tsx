import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentWorkspaceNav } from "@/components/content/ContentWorkspaceNav";

const auth = { isAdmin: false, user: { email: "agent@example.invalid" } as { email: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
const mount = (path = "/dashboard/admin/content-command") => render(<MemoryRouter initialEntries={[path]}><ContentWorkspaceNav /></MemoryRouter>);

beforeEach(() => { auth.isAdmin = false; auth.user = { email: "agent@example.invalid" }; });

describe("Content workspace navigation", () => {
  it("does not give agents or owner-email nonadmins access to admin destinations", () => {
    auth.user = { email: "sam.com593@gmail.com" };
    mount();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("limits other admins to the three existing admin destinations", () => {
    auth.isAdmin = true;
    mount();
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "/dashboard/admin/content-command", "/dashboard/social", "/admin/contentwheel",
    ]);
    expect(screen.getByRole("link", { name: "Draft review" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Publishing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Plan & library" })).toBeNull();
  });
  it.each(["sam.com593@gmail.com", "sam@galaxyfinancial.org", "SAM.COM593@GMAIL.COM"])("uses the established owner-email helper for %s", email => {
    auth.isAdmin = true; auth.user = { email };
    mount("/dashboard/launch-board?tab=queue");
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Plan & library" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Publishing" })).toHaveAttribute("href", "/dashboard/admin/social-media-bot");
    fireEvent.click(screen.getByRole("link", { name: "Account analytics" }));
    expect(screen.getByRole("link", { name: "Account analytics" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan & library" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: /Social Command/ })).toBeNull();
  });
});
