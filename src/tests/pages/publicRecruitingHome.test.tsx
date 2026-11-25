import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRefSlug } from "@/lib/refSlug";
import { VSL_VIDEO } from "@/lib/vslMedia";

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, isLoading: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
import Index from "@/pages/Index";
import Vsl from "@/pages/Vsl";

function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{location.pathname}{location.search}</output>;
}

function renderHome(query = "") {
  return render(<MemoryRouter initialEntries={[`/${query}`]}><Routes>
    <Route path="/" element={<Index />} />
    <Route path="/vsl" element={<Vsl />} />
    <Route path="/apply" element={<Destination />} />
    <Route path="/dashboard" element={<Destination />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  auth.user = null;
  auth.isLoading = false;
  localStorage.clear();
  vi.clearAllMocks();
});

describe("two-choice public recruiting home", () => {
  it("offers two recruiting answers and agent login without extra page sections", () => {
    const { container } = renderHome();
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Agent Login", "Yes, I'm Currently Licensed", "No, I'm Unlicensed",
    ]);
    expect(screen.getByRole("link", { name: "Agent Login" })).toHaveAttribute("href", "/login");
    expect(container.querySelectorAll("main section")).toHaveLength(1);
    expect(container.querySelector("video, nav, footer")).toBeNull();
    expect(screen.queryByText("Building an agency?")).toBeNull();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(screen.queryByRole("note")).toBeNull();
    expect(within(main).queryByRole("list")).toBeNull();
    expect(screen.getByRole("img", { name: "Where winning agencies are built." })).toBeInTheDocument();
    for (const removed of ["$100M", "Instant", "Compensation", "Carrier partners", "Unpublished design draft"]) {
      expect(main).not.toHaveTextContent(removed);
    }
  });

  it.each([
    ["Yes, I'm Currently Licensed", "licensed-producer"],
    ["No, I'm Unlicensed", "licensing-roadmap"],
  ])("carries %s through the real VSL and into the application with campaign context", (answer, track) => {
    renderHome("?ref=synthetic-agent&track=agency-builder&source=ad&utm_medium=paid_social&gclid=synthetic-click&email=private@example.invalid");
    fireEvent.click(screen.getByRole("link", { name: answer }));
    expect(screen.getByLabelText(VSL_VIDEO.title)).toHaveAttribute("controls");
    const applyLinks = within(screen.getByRole("main")).getAllByRole("link");
    expect(applyLinks).toHaveLength(1);
    fireEvent.click(applyLinks[0]);
    const destination = new URL(screen.getByTestId("destination").textContent!, "https://galaxyfinancial.org");
    expect(destination.pathname).toBe("/apply");
    expect(destination.searchParams.get("track")).toBe(track);
    expect(destination.searchParams.get("ref")).toBe("synthetic-agent");
    expect(destination.searchParams.get("source")).toBe("ad");
    expect(destination.searchParams.get("utm_medium")).toBe("paid_social");
    expect(destination.searchParams.get("gclid")).toBe("synthetic-click");
    expect(destination.searchParams.has("email")).toBe(false);
  });

  it("preserves the signed-in redirect and referral capture", () => {
    auth.user = { id: "synthetic-user" };
    renderHome("?ref=synthetic-manager");
    expect(screen.getByTestId("destination")).toHaveTextContent("/dashboard");
    expect(getRefSlug(null)).toBe("synthetic-manager");
  });

  it("keeps title and description lifecycle intact", () => {
    document.title = "Previous page";
    const meta = document.createElement("meta");
    meta.name = "description";
    meta.content = "Previous description";
    document.head.appendChild(meta);
    const view = renderHome();
    expect(document.title).toBe("Galaxy Financial · Build Your Insurance Career");
    expect(meta.content).toContain("licensed producers and future agents");
    view.unmount();
    expect(document.title).toBe("Previous page");
    expect(meta.content).toBe("Previous description");
    meta.remove();
  });
});
