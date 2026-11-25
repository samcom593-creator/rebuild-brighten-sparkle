import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwardCopyActions } from "@/components/awards/AwardCopyActions";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("award text tools", () => {
  it("reports copied only after the clipboard accepts the requested text", async () => {
    let finish = () => {};
    writeText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<AwardCopyActions caption="Recorded win." summary="Recorded ALP: $5,000" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
    expect(screen.queryByText("Caption copied.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copying…" })).toBeDisabled();
    expect(writeText).toHaveBeenCalledWith("Recorded win.");
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Caption copied.");
  });

  it("provides a selected editable caption after rejection and copies the edited text on retry", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<AwardCopyActions caption="Original caption" summary="Recorded ALP: $1,031.76" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
    const field = await screen.findByRole("textbox", { name: /Caption text/ }) as HTMLTextAreaElement;
    expect(screen.getByRole("status")).toHaveTextContent("Clipboard unavailable");
    expect(screen.queryByText("Caption copied.")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe("Original caption".length);
    fireEvent.change(field, { target: { value: "My edited caption" } });
    expect(field).toHaveValue("My edited caption");
    expect(field).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("My edited caption"));
    expect(await screen.findByText("Caption copied.")).toBeInTheDocument();
  });

  it("provides read-only selectable facts when the clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<AwardCopyActions caption="Caption" summary="Recorded ALP: Premium not on file" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy stats" }));
    const field = await screen.findByRole("textbox", { name: /Award stats/ }) as HTMLTextAreaElement;
    expect(field).toHaveValue("Recorded ALP: Premium not on file");
    expect(field).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Select text" }));
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.queryByText("Stats copied.")).not.toBeInTheDocument();
  });

  it("keeps caption edits local while copied stats remain the supplied record", async () => {
    render(<AwardCopyActions caption="Caption" summary="Recorded ALP: $3,125.50" showText />);
    fireEvent.change(screen.getByRole("textbox", { name: /Caption text/ }), { target: { value: "Rewritten caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy stats" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Recorded ALP: $3,125.50"));
    expect(screen.getByRole("textbox", { name: /Award stats/ })).toHaveAttribute("readonly");
  });

  it("discards the previous record's draft and ignores its late clipboard result", async () => {
    let finish = () => {};
    writeText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<AwardCopyActions caption="Old record" summary="Old facts" showText />);
    fireEvent.change(screen.getByRole("textbox", { name: /Caption text/ }), { target: { value: "Private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
    view.rerender(<AwardCopyActions caption="New record" summary="New facts" showText />);
    expect(screen.getByRole("textbox", { name: /Caption text/ })).toHaveValue("New record");
    await act(async () => finish());
    expect(screen.queryByText("Caption copied.")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private draft")).not.toBeInTheDocument();
  });
});
