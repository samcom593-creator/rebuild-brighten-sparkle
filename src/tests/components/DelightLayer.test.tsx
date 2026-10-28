import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Phone } from "lucide-react";

import { AmbientBubbles } from "@/components/layout/AmbientBubbles";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { CountUp } from "@/components/ui/delight/CountUp";
import { SoundToggle } from "@/components/ui/delight/SoundToggle";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { PageHeader } from "@/components/ui/page-header";

describe("tone bubble and pill", () => {
  it("the bubble is decorative and the pill carries the words", () => {
    const { container } = render(
      <>
        <ToneBubble tone="good"><Phone /></ToneBubble>
        <TonePill tone="hot" dot>Hot</TonePill>
      </>,
    );
    const bubble = container.querySelector('[aria-hidden="true"]');
    expect(bubble).toHaveClass("bg-tone-good/12");
    expect(bubble).toHaveClass("text-tone-good");
    expect(screen.getByText("Hot")).toHaveClass("text-tone-hot");
  });
});

describe("CountUp", () => {
  it("keeps rapidly changing counts equal to the current list and never renders NaN", () => {
    const { rerender } = render(<CountUp value={10} />);
    rerender(<CountUp value={500} />);
    expect(screen.getByText("500")).toBeInTheDocument();
    rerender(<CountUp value={1} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    rerender(<CountUp value={Number.NaN} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("shows the real number at once, and a dash when the number is unknown", () => {
    const { rerender } = render(<CountUp value={1234} />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
    rerender(<CountUp value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("SoundToggle", () => {
  afterEach(() => localStorage.clear());

  it("names the action it will take and flips the shared preference", () => {
    render(<SoundToggle />);
    const off = screen.getByRole("button", { name: "Turn sounds off" });
    expect(off).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(off);
    expect(localStorage.getItem("apex_sound_enabled")).toBe("false");
    const on = screen.getByRole("button", { name: "Turn sounds on" });
    expect(on).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(on);
    expect(localStorage.getItem("apex_sound_enabled")).toBe("true");
  });
});

describe("AmbientBubbles", () => {
  it("is hidden from assistive technology and draws five fields", () => {
    render(<AmbientBubbles />);
    const layer = screen.getByTestId("ambient-bubbles");
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer.querySelectorAll("span")).toHaveLength(5);
  });
});

describe("PageHeader with an icon", () => {
  it("keeps the title as the heading and puts the icon in a bubble of the page's tone", () => {
    const { container } = render(<PageHeader title="Pipeline" subtitle="Everyone from first call to active agent." icon={<Phone />} tone="cool" />);
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toBeInTheDocument();
    const bubble = container.querySelector(".apex-pop");
    expect(bubble).toHaveAttribute("aria-hidden", "true");
    expect(bubble).toHaveClass("bg-tone-cool/12");
  });
});

describe("GrowScoreboard tones", () => {
  it("a selected tile takes its tone, its number is shown, and unknown stays a dash", () => {
    render(
      <GrowScoreboard
        label="Numbers"
        tiles={[
          { label: "Showed", value: 2, hint: "Prospects who came", tone: "good", icon: <Phone />, onSelect: () => undefined, active: true },
          { label: "Onboarding", value: null, hint: "Getting set up", tone: "royal", onSelect: () => undefined },
        ]}
      />,
    );
    const showed = screen.getByRole("button", { name: /Showed/ });
    expect(showed).toHaveAttribute("aria-pressed", "true");
    expect(showed).toHaveClass("bg-tone-good/8");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Onboarding/ })).toHaveTextContent("—");
  });
});
