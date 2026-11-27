import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WinActionButton } from "@/components/celebrations/WinActionButton";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

afterEach(cleanup);

describe("deal and hire action handoff", () => {
  it.each(["deal", "hire"] as const)("keeps the %s action named when the rail is collapsed and hands one click to its dialog", (kind) => {
    const ref = createRef<HTMLButtonElement>();
    const label = kind === "deal" ? "Add a Deal" : "Hire an Agent";
    render(<Dialog><DialogTrigger asChild><WinActionButton ref={ref} kind={kind} compact /></DialogTrigger>
      <DialogContent><DialogTitle>{label}</DialogTitle><DialogDescription>Confirm the record before saving.</DialogDescription></DialogContent>
    </Dialog>);
    const trigger = screen.getByRole("button", { name: label });
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(label);
  });

  it("respects disabled actions instead of decorating a successful operation before it exists", () => {
    const onClick = vi.fn();
    render(<WinActionButton kind="deal" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a Deal" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("turns off interaction transforms and trophy entrance motion when reduced motion is requested", () => {
    const actions = readFileSync(resolve(process.cwd(), "src/components/celebrations/win-actions.css"), "utf8");
    const trophy = readFileSync(resolve(process.cwd(), "src/components/celebrations/celebration-trophy.css"), "utf8");
    expect(actions).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    expect(actions).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transform: none/);
    expect(trophy).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
