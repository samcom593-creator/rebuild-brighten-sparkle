import { beforeEach, describe, expect, it } from "vitest";
import { claimOnboardingPopup, resetOnboardingPopupGate } from "@/lib/onboardingPopupGate";

// Stacked onboarding modals froze Post a Deal for new agents (2026-11-11). Only one may auto-open
// per session.
describe("onboardingPopupGate", () => {
  beforeEach(() => resetOnboardingPopupGate());

  it("lets the first pop-up open and refuses a second, different one", () => {
    expect(claimOnboardingPopup("first-login-guide")).toBe(true);
    expect(claimOnboardingPopup("profile-picture")).toBe(false);
  });

  it("lets the same pop-up re-claim (effects re-run on re-render)", () => {
    expect(claimOnboardingPopup("first-login-guide")).toBe(true);
    expect(claimOnboardingPopup("first-login-guide")).toBe(true);
  });

  it("remembers the claim for the browser session, not just the module", () => {
    expect(claimOnboardingPopup("profile-picture")).toBe(true);
    expect(window.sessionStorage.getItem("galaxy.onboarding-popup.claimed")).toBe("profile-picture");
    expect(claimOnboardingPopup("first-login-guide")).toBe(false);
  });

  it("frees the slot after a reset", () => {
    expect(claimOnboardingPopup("profile-picture")).toBe(true);
    resetOnboardingPopupGate();
    expect(claimOnboardingPopup("first-login-guide")).toBe(true);
  });
});
