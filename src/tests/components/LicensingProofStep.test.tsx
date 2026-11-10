// WP2: the unlicensed path must always leave a human reachable, accept PDF receipts, and keep
// the licensing call locked until a receipt is in (unless there is no application to attach
// one to). Synthetic applicant only.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import { LicensingProofStep } from "@/components/landing/LicensingProofStep";

const APP = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  rpc.mockResolvedValue({ data: { submitted: false }, error: null });
});

function bookingLink() {
  return screen.queryByRole("link", { name: /Book your licensing call/i });
}

describe("LicensingProofStep", () => {
  it("renders one ordered 4-step list and always shows the ask-first human path", async () => {
    render(<LicensingProofStep applicationId={APP} firstName="Jordan" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toMatch(/Watch the 5-min licensing video/);
    expect(items[1].textContent).toMatch(/Get the pre-licensing course/);
    expect(items[2].textContent).toMatch(/Upload your receipt/);
    expect(items[3].textContent).toMatch(/Book your licensing call/);
    expect(screen.getByTestId("ask-us-first").textContent).toMatch(/Not ready to buy\? Ask us first/);
  });

  it("opens the video in a new tab so the upload stays on screen", async () => {
    render(<LicensingProofStep applicationId={APP} videoHref="/get-licensed#licensing-video" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const video = screen.getByRole("link", { name: /Watch the 5-min licensing video/i });
    expect(video.getAttribute("target")).toBe("_blank");
  });

  it("keeps the licensing call locked until a receipt is in", async () => {
    render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(bookingLink()).toBeNull();
    expect(screen.getByText(/Unlocks the moment your receipt is in/)).toBeTruthy();
  });

  it("accepts PDF receipts, not only images", async () => {
    const { container } = render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain("application/pdf");
    expect(input.accept).toContain("image/heic");
  });

  it("uploads a PDF, unlocks the call with prefill + utm, and offers the self-report", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { container } = render(<LicensingProofStep applicationId={APP} firstName="Jordan" lastName="Lee" />);
    await waitFor(() => expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false));
    const file = new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(bookingLink()).not.toBeNull());
    const [fn, opts] = invoke.mock.calls[0] as [string, { body: { content_type: string; application_id: string } }];
    expect(fn).toBe("submit-licensing-proof");
    expect(opts.body.content_type).toBe("application/pdf");
    const href = new URL(bookingLink()!.getAttribute("href")!);
    expect(href.pathname).toBe("/apexfinancialempire/licensing-call");
    expect(href.searchParams.get("utm_content")).toBe(APP);
    expect(href.searchParams.get("name")).toBe("Jordan Lee");
    expect(screen.getByTestId("licensing-self-report")).toBeTruthy();
  });

  it("an upload error still shows a human path and does not unlock the call", async () => {
    invoke.mockResolvedValue({ data: { error: { message: "Upload failed: storage down" } }, error: null });
    const { container } = render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false));
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/storage down/));
    expect(bookingLink()).toBeNull();
    expect(screen.getByTestId("ask-us-first")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Text Sam/ })).toBeTruthy();
  });

  it("a returning applicant with a receipt on file sees the call unlocked", async () => {
    rpc.mockResolvedValue({ data: { submitted: true }, error: null });
    render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect(bookingLink()).not.toBeNull());
  });

  it("the ask-first path uses the applicant's recruiter when the snapshot has one", async () => {
    render(<LicensingProofStep applicationId={APP} owner={{ name: "Aisha", phone: "+15555550123", email: "recruiter@example.com" }} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /Text Aisha/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Email Aisha/ }).getAttribute("href")).toBe("mailto:recruiter@example.com");
  });

  it("without an application id the call is open (nothing to attach a receipt to)", () => {
    render(<LicensingProofStep applicationId={null} />);
    expect(bookingLink()).not.toBeNull();
  });

  it("makes no claim about who pays", async () => {
    const { container } = render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/we (cover|pay|reimburse)|galaxy pays|on us|buy the course/i);
  });
});
