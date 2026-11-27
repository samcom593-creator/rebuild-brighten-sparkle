import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

describe("shared primitive contracts", () => {
  it("preserves native form submission, disabled actions, forwarded refs and caller overrides", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const disabled = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<form onSubmit={submit}>
      <Button ref={ref} type="submit" className="rounded-none h-8">Save</Button>
      <Button disabled onClick={disabled}>Unavailable action</Button>
    </form>);
    const save = screen.getByRole("button", { name: "Save" });
    expect(ref.current).toBe(save);
    expect(save).toHaveClass("rounded-none", "h-8");
    expect(save).not.toHaveClass("h-10");
    expect(save.className).not.toContain("rounded-[var(");
    fireEvent.click(save);
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Unavailable action" }));
    expect(disabled).not.toHaveBeenCalled();
  });

  it("preserves child link semantics and caller click behavior without a nested control", () => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<Button asChild variant="outline"><a href="/apply" onClick={clicked} aria-label="Start application">Apply</a></Button>);
    const link = screen.getByRole("link", { name: "Start application" });
    expect(link).toHaveAttribute("href", "/apply");
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(link);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("keeps cards structural and preserves headings, descriptions and footer actions", () => {
    const ref = createRef<HTMLDivElement>();
    const saved = vi.fn();
    render(<Card ref={ref} aria-labelledby="card-title" className="rounded-none">
      <CardHeader><CardTitle id="card-title">Review application</CardTitle><CardDescription>Confirm the details before saving.</CardDescription></CardHeader>
      <CardContent>Application details</CardContent>
      <CardFooter><Button onClick={saved}>Save application</Button></CardFooter>
    </Card>);
    expect(screen.getByRole("heading", { level: 3, name: "Review application" })).toBeInTheDocument();
    expect(screen.getByText("Confirm the details before saving.")).toBeInTheDocument();
    expect(ref.current).toHaveClass("rounded-none");
    expect(ref.current).not.toHaveAttribute("tabindex");
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));
    expect(saved).toHaveBeenCalledTimes(1);
  });
});
