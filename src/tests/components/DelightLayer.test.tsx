import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Phone } from "lucide-react";

import { AmbientBubbles } from "@/components/layout/AmbientBubbles";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { CountUp } from "@/components/ui/delight/CountUp";
import { clampStagger, MAX_STAGGER_INDEX, Reveal } from "@/components/ui/delight/Reveal";
import { SoundToggle } from "@/components/ui/delight/SoundToggle";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

/** Pretend the OS asked for reduced motion (jsdom has no matchMedia of its own). */
function withReducedMotion<T>(reduce: boolean, run: () => T): T {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  try {
    return run();
  } finally {
    window.matchMedia = original;
  }
}

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
  it("under reduced motion, rapid changes show the current count at once", () => {
    withReducedMotion(true, () => {
      const { rerender } = render(<CountUp value={10} />);
      rerender(<CountUp value={500} />);
      expect(screen.getByText("500")).toBeInTheDocument();
      rerender(<CountUp value={1} />);
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });

  it("never renders NaN or Infinity, with motion on or off", () => {
    withReducedMotion(false, () => {
      const { rerender, container } = render(<CountUp value={10} />);
      rerender(<CountUp value={Number.NaN} />);
      expect(screen.getByText("—")).toBeInTheDocument();
      rerender(<CountUp value={Number.POSITIVE_INFINITY} />);
      expect(container.textContent).not.toMatch(/NaN|Infinity|∞/);
    });
  });
  it("shows the real number at once, and a dash when the number is unknown", () => {
    const { rerender } = render(<CountUp value={1234} />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
    rerender(<CountUp value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("under reduced motion the new number is on screen in the same commit, with no tween", () => {
    withReducedMotion(true, () => {
      const { rerender } = render(<CountUp value={10} />);
      rerender(<CountUp value={25} />);
      expect(screen.getByText("25")).toBeInTheDocument();
    });
  });

  it("with motion on, a change tweens from the old number and settles on the new one", async () => {
    await withReducedMotion(false, async () => {
      const { rerender, container } = render(<CountUp value={10} />);
      rerender(<CountUp value={25} />);
      // The tween starts from the old value, never from zero.
      expect(container.textContent).toBe("10");
      await waitFor(() => expect(screen.getByText("25")).toBeInTheDocument(), { timeout: 2000 });
      // The bump comes on the frame the tween settles, which can be a frame after "25" first shows.
      await waitFor(() => expect(container.querySelector(".apex-bump")).not.toBeNull(), { timeout: 2000 });
      expect(container.textContent).toBe("25");
    });
  });
});

describe("Reveal stagger", () => {
  it("caps the stagger index so a late section never waits more than eight steps", () => {
    expect(clampStagger(0)).toBe(0);
    expect(clampStagger(3)).toBe(3);
    expect(clampStagger(40)).toBe(MAX_STAGGER_INDEX);
    expect(clampStagger(-2)).toBe(0);
    const { container } = render(<Reveal index={40}>late</Reveal>);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("apex-rise");
    const applied = el.style.getPropertyValue("--rise-i") || el.getAttribute("style") || "";
    expect(applied).toContain(String(MAX_STAGGER_INDEX));
  });
});

describe("Button press feedback", () => {
  it("transitions named properties only, never `all`, and presses in on :active when motion is allowed", () => {
    render(<Button>Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toContain("transition-[background-color,box-shadow,filter,transform]");
    expect(cls).not.toMatch(/transition-all/);
    expect(cls).toContain("motion-safe:active:scale-[0.97]");
    // Arbitrary properties, because `duration-[140ms]` and `ease-[…]` never compiled in this config.
    expect(cls).toContain("[transition-duration:120ms]");
    expect(cls).toContain("[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]");
    expect(cls).not.toMatch(/\bduration-\[/);
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
    expect(layer.textContent).toBe("");
  });
});

describe("SoundToggle under reduced motion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is still a 44px control with a name; nothing about it depends on motion", () => {
    withReducedMotion(true, () => {
      render(<SoundToggle />);
      const button = screen.getByRole("button", { name: /Turn sounds/ });
      expect(button.className).toContain("h-11");
      expect(button.className).toContain("w-11");
    });
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
