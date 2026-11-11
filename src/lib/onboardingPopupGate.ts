// One onboarding pop-up per browser session (2026-11-11, "people can't post deals").
//
// The first-login guide (agent dashboard) and the profile-picture prompt (every authenticated
// page) both auto-open for a new agent. Stacked, they froze the page: a Radix modal sets
// pointer-events:none on everything behind it, so Post a Deal in the sidebar could not be tapped
// until BOTH were closed, and an agent who closed one saw the next and assumed posting was broken.
// Reproduced live as a real agent on desktop and phone: "Welcome to Galaxy" -> "Add your profile
// picture" -> only then does Post a Deal open the deal form.
//
// Whichever pop-up claims first shows this session; the other waits for the next session. A
// pop-up the user opens on purpose (a button) never needs the gate.
const KEY = "galaxy.onboarding-popup.claimed";
let claimedInMemory: string | null = null;

export function claimOnboardingPopup(name: string): boolean {
  let current = claimedInMemory;
  if (!current) {
    try {
      current = window.sessionStorage.getItem(KEY);
    } catch {
      current = null; // empty-catch-allow:storage-optional — blocked storage falls back to the in-memory claim
    }
  }
  if (current && current !== name) return false;
  claimedInMemory = name;
  try {
    window.sessionStorage.setItem(KEY, name);
  } catch { /* empty-catch-allow:storage-optional — the in-memory claim still prevents stacking in this tab */ }
  return true;
}

/** Test helper: forget the claim so each test starts with a free slot. */
export function resetOnboardingPopupGate(): void {
  claimedInMemory = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch { /* empty-catch-allow:storage-optional — nothing to reset when storage is blocked */ }
}
