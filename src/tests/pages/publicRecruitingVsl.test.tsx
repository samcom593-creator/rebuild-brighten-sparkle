import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Vsl from "@/pages/Vsl";
import { VSL_VIDEO } from "@/lib/vslMedia";
import { track } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{location.pathname}{location.search}</output>;
}
function renderVsl(query: string) {
  return render(<MemoryRouter initialEntries={[`/vsl${query}`]}><Routes>
    <Route path="/vsl" element={<Vsl />} />
    <Route path="/apply" element={<Destination />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("focused public video page", () => {
  it("renders the canonical 5:46 native video with controls and one immediately usable Apply CTA", () => {
    const { container } = renderVsl("?ref=synthetic-agent&track=licensed-producer");
    const video = screen.getByLabelText(VSL_VIDEO.title);
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("poster", VSL_VIDEO.poster);
    expect(video.querySelector("source")).toHaveAttribute("src", VSL_VIDEO.src);
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.getByText("5:46")).toBeInTheDocument();
    expect(container.querySelectorAll(".recruiting-action-primary")).toHaveLength(1);
    fireEvent.play(video);
    expect(track).toHaveBeenCalledWith("hero_vsl_play", { video: "vsl-2026-09-02", position: "vsl" });
    fireEvent.click(screen.getByRole("link", { name: "Apply to Galaxy" }));
    expect(screen.getByTestId("destination")).toHaveTextContent("/apply?ref=synthetic-agent&track=licensed-producer");
    expect(track).toHaveBeenCalledWith("hero_cta_click", { position: "vsl", cta_label: "Apply to Galaxy", partner_path: "licensed-producer" });
  });

  it("keeps the licensing audience and paid-source mode when the video cannot load", () => {
    renderVsl("?ref=synthetic-agent&track=licensing-roadmap&source=ad&utm_medium=paid_social");
    expect(screen.getByRole("heading", { level: 1, name: "Start your insurance career" })).toBeInTheDocument();
    fireEvent.error(screen.getByLabelText(VSL_VIDEO.title));
    fireEvent.click(screen.getByRole("link", { name: "Start my application" }));
    const destination = new URL(screen.getByTestId("destination").textContent!, "https://galaxyfinancial.org");
    expect(destination.pathname).toBe("/apply");
    expect(destination.searchParams.get("ref")).toBe("synthetic-agent");
    expect(destination.searchParams.get("track")).toBe("licensing-roadmap");
    expect(destination.searchParams.get("source")).toBe("ad");
    expect(destination.searchParams.get("utm_medium")).toBe("paid_social");
  });

  it("retains the referral on its supplemental licensing roadmap and home links", () => {
    renderVsl("?ref=synthetic-agent&track=agency-builder&utm_source=synthetic-campaign");
    const roadmap = new URL(screen.getByRole("link", { name: "Need a license? View the roadmap" }).getAttribute("href")!, "https://galaxyfinancial.org");
    expect(roadmap.pathname).toBe("/get-licensed");
    expect(roadmap.searchParams.get("track")).toBe("licensing-roadmap");
    expect(roadmap.searchParams.get("ref")).toBe("synthetic-agent");
    expect(roadmap.searchParams.get("utm_source")).toBe("synthetic-campaign");
    expect(screen.getByRole("link", { name: "Galaxy Financial home" })).toHaveAttribute("href", "/?ref=synthetic-agent&track=agency-builder&utm_source=synthetic-campaign");
  });
});
