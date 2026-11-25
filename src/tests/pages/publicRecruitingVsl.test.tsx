import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Vsl from "@/pages/Vsl";
import { VSL_VIDEO } from "@/lib/vslMedia";
import { LICENSING_VIDEO } from "@/lib/licensingMedia";
import { HeroSection } from "@/components/landing/HeroSection";
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
    expect(screen.getByRole("heading", { level: 1, name: "The unfair advantage for serious producers" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "I’m ready to scale & earn more" }));
    expect(screen.getByTestId("destination")).toHaveTextContent("/apply?ref=synthetic-agent&track=licensed-producer");
    expect(track).toHaveBeenCalledWith("hero_cta_click", { position: "vsl", cta_label: "I’m ready to scale & earn more", partner_path: "licensed-producer" });
  });

  it("keeps the licensing audience and paid-source mode when the video cannot load", () => {
    renderVsl("?ref=synthetic-agent&track=licensing-roadmap&source=ad&utm_medium=paid_social");
    expect(screen.getByRole("heading", { level: 1, name: "Start your insurance career" })).toBeInTheDocument();
    fireEvent.error(screen.getByLabelText(LICENSING_VIDEO.title));
    fireEvent.click(screen.getByRole("link", { name: "Start my application" }));
    const destination = new URL(screen.getByTestId("destination").textContent!, "https://galaxyfinancial.org");
    expect(destination.pathname).toBe("/apply");
    expect(destination.searchParams.get("ref")).toBe("synthetic-agent");
    expect(destination.searchParams.get("track")).toBe("licensing-roadmap");
    expect(destination.searchParams.get("source")).toBe("ad");
    expect(destination.searchParams.get("utm_medium")).toBe("paid_social");
  });

  it("uses the unlicensed video, poster, duration, schema and play ID together", () => {
    const { container } = renderVsl("?track=licensing-roadmap");
    const video = screen.getByLabelText(LICENSING_VIDEO.title);
    expect(video).toHaveAttribute("poster", LICENSING_VIDEO.poster);
    expect(video.querySelector("source")).toHaveAttribute("src", LICENSING_VIDEO.src);
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.getByText("5:18")).toBeInTheDocument();
    expect(screen.queryByText("5:46")).not.toBeInTheDocument();
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(JSON.parse(container.querySelector("#galaxy-vsl-schema")!.textContent!)).toMatchObject({
      name: LICENSING_VIDEO.title,
      contentUrl: LICENSING_VIDEO.src,
      thumbnailUrl: LICENSING_VIDEO.poster,
      duration: "PT5M18S",
      uploadDate: "2026-09-15",
      embedUrl: "https://galaxyfinancial.org/vsl?track=licensing-roadmap",
    });
    fireEvent.play(video);
    expect(track).toHaveBeenCalledWith("hero_vsl_play", { video: "licensing-2026-09-15", position: "vsl" });
  });

  it("replaces the media element when the audience changes on the mounted route", () => {
    function SwitchableVsl() {
      const navigate = useNavigate();
      return <><Vsl />
        <button onClick={() => navigate("/vsl?track=licensing-roadmap")}>Switch to licensing</button>
        <button onClick={() => navigate("/vsl?track=licensed-producer")}>Switch to licensed</button>
      </>;
    }
    render(<MemoryRouter initialEntries={["/vsl?track=licensed-producer"]}><Routes><Route path="/vsl" element={<SwitchableVsl />} /></Routes></MemoryRouter>);
    const original = screen.getByLabelText(VSL_VIDEO.title);
    fireEvent.click(screen.getByRole("button", { name: "Switch to licensing" }));
    const licensing = screen.getByLabelText(LICENSING_VIDEO.title);
    expect(licensing).not.toBe(original);
    expect(original).not.toBeInTheDocument();
    expect(licensing.querySelector("source")).toHaveAttribute("src", LICENSING_VIDEO.src);
    fireEvent.click(screen.getByRole("button", { name: "Switch to licensed" }));
    expect(screen.getByLabelText(VSL_VIDEO.title)).not.toBe(licensing);
    expect(licensing).not.toBeInTheDocument();
  });

  it.each([
    { choice: "Yes, I'm Currently Licensed", selectedTrack: "licensed-producer", media: VSL_VIDEO, cta: "I’m ready to scale & earn more" },
    { choice: "No, I'm Unlicensed", selectedTrack: "licensing-roadmap", media: LICENSING_VIDEO, cta: "Start my application" },
  ])("takes the $selectedTrack homepage choice to its video and preserves attribution through Apply", ({ choice, selectedTrack, media, cta }) => {
    render(<MemoryRouter initialEntries={["/?ref=synthetic-agent&track=agency-builder&source=ad&utm_source=ig&utm_medium=paid_social"]}><Routes>
      <Route path="/" element={<HeroSection />} />
      <Route path="/vsl" element={<Vsl />} />
      <Route path="/apply" element={<Destination />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: choice }));
    expect(screen.getByLabelText(media.title).querySelector("source")).toHaveAttribute("src", media.src);
    // Apply is available immediately, with no play/completion gate.
    fireEvent.click(screen.getByRole("link", { name: cta }));
    const destination = new URL(screen.getByTestId("destination").textContent!, "https://galaxyfinancial.org");
    expect(destination.pathname).toBe("/apply");
    expect(Object.fromEntries(destination.searchParams)).toEqual({ ref: "synthetic-agent", track: selectedTrack, source: "ad", utm_source: "ig", utm_medium: "paid_social" });
  });

  it.each(["", "?track=unknown"])("retains the producer overview for the existing generic entry %s", query => {
    renderVsl(query);
    expect(screen.getByLabelText(VSL_VIDEO.title).querySelector("source")).toHaveAttribute("src", VSL_VIDEO.src);
    expect(screen.queryByLabelText(LICENSING_VIDEO.title)).not.toBeInTheDocument();
  });

  it("keeps external agency-builder context while offering only one application action", () => {
    const { container } = renderVsl("?ref=synthetic-agent&track=agency-builder&utm_source=synthetic-campaign");
    const links = within(screen.getByRole("main")).getAllByRole("link");
    expect(links).toHaveLength(1);
    const apply = new URL(links[0].getAttribute("href")!, "https://galaxyfinancial.org");
    expect(apply.pathname).toBe("/apply");
    expect(apply.searchParams.get("track")).toBe("agency-builder");
    expect(apply.searchParams.get("ref")).toBe("synthetic-agent");
    expect(apply.searchParams.get("utm_source")).toBe("synthetic-campaign");
    expect(container.querySelector('a[href^="/get-licensed"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Galaxy Financial home" })).toHaveAttribute("href", "/?ref=synthetic-agent&track=agency-builder&utm_source=synthetic-campaign");
    const schema = JSON.parse(container.querySelector('#galaxy-vsl-schema')!.textContent!);
    expect(schema.contentUrl).toBe(VSL_VIDEO.src);
    expect(schema.thumbnailUrl).toBe(VSL_VIDEO.poster);
  });
});
