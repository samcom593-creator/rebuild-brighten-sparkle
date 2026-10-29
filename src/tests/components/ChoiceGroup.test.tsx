/**
 * The either-or control behind Quick link / With details, Licensed / Not licensed yet and
 * Permanent / Temporary (OVERHAUL-1). It is a real radio group: one Tab stop, arrow keys move
 * the choice, the picked option says so without colour (a filled ring), and nothing is picked
 * until someone picks.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChoiceGroup } from "@/components/invitations/ChoiceGroup";

const OPTIONS = [
  { value: "licensed" as const, label: "Licensed", tone: "good" as const },
  { value: "unlicensed" as const, label: "Not licensed yet", tone: "cool" as const },
];

function Harness({ initial = null as "licensed" | "unlicensed" | null, invalid = false }) {
  const [value, setValue] = useState(initial);
  return <ChoiceGroup<"licensed" | "unlicensed"> label="License" value={value} options={OPTIONS} onChange={setValue} invalid={invalid} stackOnPhone />;
}

describe("ChoiceGroup", () => {
  it("starts with nothing picked and one Tab stop, on the first option", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "License" });
    expect(group).toHaveAttribute("aria-required", "true");
    const [a, b] = screen.getAllByRole("radio");
    expect(a).toHaveAttribute("aria-checked", "false");
    expect(b).toHaveAttribute("aria-checked", "false");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
  });

  it("picks on press, moves the Tab stop to the picked option, and shows a filled ring in its tone", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Not licensed yet" }));
    const picked = screen.getByRole("radio", { name: "Not licensed yet" });
    expect(picked).toHaveAttribute("aria-checked", "true");
    expect(picked).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Licensed" })).toHaveAttribute("tabindex", "-1");
    // The mark is decoration beside the word: a ring with a dot, hidden from assistive technology.
    const ring = picked.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ring.className).toMatch(/\bborder-tone-cool\b/);
    expect(ring.querySelector(".bg-tone-cool")).not.toBeNull();
    expect(picked.className).toMatch(/\bbg-tone-cool\/8\b/);
    // Never a gold button fill: the page's one gold button stays the action.
    expect(picked.className).not.toMatch(/\bbg-primary\b(?!\/)/);
  });

  it("arrow keys move the choice the way native radios do, wrapping at the ends", () => {
    render(<Harness initial="licensed" />);
    const licensed = screen.getByRole("radio", { name: "Licensed" });
    fireEvent.keyDown(licensed, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Not licensed yet" })).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Not licensed yet" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Licensed" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Not licensed yet" })).toHaveAttribute("aria-checked", "true");
  });

  it("marks the whole group invalid when a required choice was skipped, and stacks long labels on a phone", () => {
    render(<Harness invalid />);
    const group = screen.getByRole("radiogroup", { name: "License" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.className).toMatch(/\bgrid-cols-1\b/);
    expect(group.className).toMatch(/\bsm:grid-cols-2\b/);
    for (const radio of screen.getAllByRole("radio")) expect(radio.className).toMatch(/\bmin-h-12\b/);
  });
});
