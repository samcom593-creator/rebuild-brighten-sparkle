import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseQuiz } from "@/components/course/CourseQuiz";

vi.mock("@/components/dashboard/ConfettiCelebration", () => ({ ConfettiCelebration: ({ trigger }: { trigger: boolean }) => trigger ? <div data-testid="celebration" /> : null }));
const questions = [{ id: "q", module_id: "m", question: "Which answer?", options: ["Correct", "Incorrect"], correct_answer: 0, explanation: null, order_index: 1 }];
afterEach(() => vi.useRealTimers());

async function finish() {
  fireEvent.click(screen.getByRole("radio", { name: "Correct" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish Quiz" }));
  await act(async () => { vi.advanceTimersByTime(1500); });
}

describe("CourseQuiz persistence", () => {
  it("shows success only after save confirmation and retains the original attempt number", async () => {
    vi.useFakeTimers();
    let confirm!: (saved: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>(resolve => { confirm = resolve; }));
    const { rerender } = render(<CourseQuiz questions={questions} passThreshold={80} attempts={0} onSubmit={onSubmit} onRetry={vi.fn()} />);
    await finish();
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(screen.queryByText(/Congratulations/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Incorrect" })).toBeDisabled();
    rerender(<CourseQuiz questions={questions} passThreshold={80} attempts={1} onSubmit={onSubmit} onRetry={vi.fn()} />);
    await act(async () => { confirm(true); });
    expect(screen.getByText(/Congratulations/)).toBeInTheDocument();
    expect(screen.getByText(/Attempt 1 of 4/)).toBeInTheDocument();
    expect(screen.getByTestId("celebration")).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "rejection"])("keeps answers and permits a save retry after %s", async failure => {
    vi.useFakeTimers();
    const onSubmit = vi.fn().mockResolvedValueOnce(true);
    if (failure === "false") onSubmit.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    else onSubmit.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    render(<CourseQuiz questions={questions} passThreshold={80} attempts={0} onSubmit={onSubmit} onRetry={vi.fn()} />);
    await finish();
    expect(screen.getByRole("alert")).toHaveTextContent("answers are still here");
    expect(screen.getByRole("radio", { name: "Correct" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Congratulations/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry saving" })); });
    expect(onSubmit.mock.calls).toEqual([[[0], 100, true], [[0], 100, true]]);
    expect(screen.getByText(/Congratulations/)).toBeInTheDocument();
  });
});
