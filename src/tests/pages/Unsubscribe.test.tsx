/**
 * /unsubscribe (ANCHOR 2026-11-11). The opt-out happens only on the button press, never on load
 * (mail scanners open links), and a failed write is shown as a failure with a manual path,
 * never as "You're unsubscribed".
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Unsubscribe, { maskEmail } from "@/pages/Unsubscribe";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/unsubscribe" element={<Unsubscribe />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("maskEmail", () => {
  it("masks the local part and keeps the domain", () => {
    expect(maskEmail("jordan.smith%40gmail.com")).toBe("j•••h@gmail.com");
    expect(maskEmail("al@x.io")).toBe("a•••@x.io");
  });
  it("rejects anything that is not one address", () => {
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("not-an-email")).toBe("");
    expect(maskEmail("a@b.com, c@d.com")).toBe("");
  });
});

describe("Unsubscribe page", () => {
  it("does not call the endpoint on load", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("/unsubscribe?u=jordan%40gmail.com");
    expect(screen.getByText("Stop these emails?")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the one-click body on the button and shows success only on ok:true", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("/unsubscribe?u=jordan%40gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(screen.getByText("You're unsubscribed")).toBeTruthy());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/functions/v1/unsubscribe?u=jordan%40gmail.com");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("List-Unsubscribe=One-Click");
  });

  it("shows the manual fallback when the write fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false }) }));
    renderAt("/unsubscribe?u=jordan%40gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(screen.getByText("That didn't go through")).toBeTruthy());
    expect(screen.getByRole("link", { name: "info@kingofsales.net" }).getAttribute("href")).toBe(
      "mailto:info@kingofsales.net?subject=STOP",
    );
  });

  it("explains a link with no address instead of offering a button", () => {
    renderAt("/unsubscribe");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/missing the address/)).toBeTruthy();
  });
});
