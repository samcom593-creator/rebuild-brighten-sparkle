import { render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendlyEmbed, WIDGET_MOUNT_WATCHDOG_MS } from "@/components/landing/CalendlyEmbed";

const URL = "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone";
const SCRIPT_SELECTOR = 'script[src="https://assets.calendly.com/assets/external/widget.js"]';

function appendedScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
}

/** The manual-contact fallback is the thing a licensed applicant must always get
 *  if booking can't render. Any of its three real CTAs proves it mounted. */
function fallbackPresent(): boolean {
  return !!screen.queryByLabelText("Call Sam");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Remove any widget script a test left behind so the next test starts clean.
  appendedScript()?.remove();
});

describe("CalendlyEmbed never leaves the hire-call applicant at a dead end", () => {
  beforeEach(() => {
    // no-cors HEAD resolves opaque on any status — the real runtime behaviour.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ type: "opaque" } as Response));
  });

  it("renders the live widget (not the fallback) when the embed is healthy", async () => {
    const { container } = render(<CalendlyEmbed url={URL} />);
    // reachable resolves true -> the inline widget div renders with the url.
    await waitFor(() => {
      const div = container.querySelector(".calendly-inline-widget");
      expect(div).not.toBeNull();
      expect(div?.getAttribute("data-url")).toBe(URL);
    });
    expect(fallbackPresent()).toBe(false);
  });

  it("falls back to phone/email when the widget SCRIPT is blocked (adblock / CDN / 404)", async () => {
    render(<CalendlyEmbed url={URL} />);
    const script = await waitFor(() => {
      const s = appendedScript();
      expect(s).not.toBeNull();
      return s!;
    });
    // uBlock / corporate filter blocking assets.calendly.com surfaces as an error event.
    await act(async () => {
      script.dispatchEvent(new Event("error"));
    });
    await waitFor(() => expect(fallbackPresent()).toBe(true));
    expect(screen.getByText(/Reach Sam directly/i)).toBeTruthy();
  });

  it("falls back when a HEAD probe fails outright (total network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<CalendlyEmbed url={URL} />);
    await waitFor(() => expect(fallbackPresent()).toBe(true));
  });

  it("falls back when the script loads but no iframe ever mounts (silent init block)", async () => {
    vi.useFakeTimers();
    try {
      render(<CalendlyEmbed url={URL} />);
      // flush the fetch microtask + effects so the script is appended.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const script = appendedScript();
      expect(script).not.toBeNull();
      // Script loaded, but jsdom (like a blocked init) never injects the iframe,
      // so the widget div has zero children when the watchdog fires.
      await act(async () => {
        script!.dispatchEvent(new Event("load"));
        await vi.advanceTimersByTimeAsync(WIDGET_MOUNT_WATCHDOG_MS + 100);
      });
      expect(fallbackPresent()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
