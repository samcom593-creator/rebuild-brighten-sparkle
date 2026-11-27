// MP-POST-A-DEAL-SIMPLE (2026-11-27): Sam asked for Post a Deal to be simpler.
// The dialog shows only what a deal needs to post (who, what, price, lead type)
// and folds the rest behind one disclosure. These tests pin that shape two ways:
// a render that opens the dialog and checks what is on screen before and after
// the fold opens, and source pins on the file so the fold cannot be quietly
// flattened back (comments are stripped first, MP-277: a scanner that counts its
// own footnotes stops measuring).
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

// Every Supabase chain in the dialog ends in `await` of a builder, so the mock is
// a thenable builder that returns itself for any method and resolves empty: an
// empty list, or null once .maybeSingle()/.single() has been called, the way
// PostgREST answers a filter that matches no row.
function chain(single = false): unknown {
  const target = () => chain(single);
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void) => resolve({ data: single ? null : [], error: null, count: 0 });
      }
      if (prop === "maybeSingle" || prop === "single") return () => chain(true);
      return () => chain(single);
    },
    apply() {
      return chain(single);
    },
  });
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => chain(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({}) }) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: false, isManager: false }) }));
vi.mock("@/hooks/useMyDownline", () => ({ useMyDownline: () => ({ data: [], isSuccess: true, isLoading: false }) }));
vi.mock("@/lib/offlineQueue", () => ({
  enqueue: vi.fn(() => ({ ok: true, entry: { id: "local-1" } })),
  isOffline: () => false,
  isTransportError: () => false,
}));
vi.mock("@/components/shared/TeamLookupError", () => ({ TeamLookupError: () => null }));
vi.mock("@/lib/invalidateOperationalTruth", () => ({ invalidateOperationalTruth: vi.fn() }));
vi.mock("@/lib/dealCelebrations", () => ({ announcePostedDealReceipt: vi.fn() }));
vi.mock("@/components/celebrations/WinActionButton", () => ({
  WinActionButton: () => <button type="button">Post a Deal</button>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const SOURCE = fs.readFileSync(path.resolve(process.cwd(), "src/components/deals/SubmitDealDialog.tsx"), "utf8");
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("Post a Deal is one short form with the optional fields folded away", () => {
  it("opens on the essentials only, with one Post button and a live list of what is still needed", async () => {
    renderDialog(<SubmitDealDialog trigger={<button type="button">Open deal form</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Open deal form" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Post a Deal");

    // Essentials are on screen as soon as the dialog opens.
    for (const label of ["First name", "Last name", "Phone number", "Date of birth", "Carrier", "Product sold", "Monthly premium", "Payment frequency", "Face amount", "Policy number"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("What kind of lead was this?")).toBeInTheDocument();

    // The optional fields are behind the fold, not deleted.
    for (const label of ["Payment method", "Policy status", "Draft day", "Effective date", "Sale date"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByText("Beneficiaries (Optional)")).toBeNull();
    expect(screen.queryByText("Notes (Optional)")).toBeNull();
    expect(screen.queryByText("Supporting document (Optional)")).toBeNull();

    // One primary action. The old second button is gone; its duplicate check moved under the policy-number field.
    expect(screen.getByRole("button", { name: /Post Deal/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review before submit/ })).toBeNull();

    // The footer says what blocks Post instead of leaving it to a toast after the click.
    expect(screen.getByText(/Still needed: first name, last name, phone, date of birth, carrier, product, premium, face amount, lead type\./)).toBeInTheDocument();
  });

  it("the fold opens every optional field, and the required list shrinks as fields are filled", async () => {
    renderDialog(<SubmitDealDialog trigger={<button type="button">Open deal form</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Open deal form" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /More details \(optional\)/ }));
    for (const label of ["Payment method", "Policy status", "Draft day", "Effective date", "Sale date"]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Beneficiaries (Optional)")).toBeInTheDocument();
    expect(screen.getByText("Notes (Optional)")).toBeInTheDocument();
    expect(screen.getByText("Supporting document (Optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide the optional details/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Marisol" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Tovar" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "(602) 555-0142" } });
    await waitFor(() => expect(screen.getByText(/Still needed: date of birth, carrier, product, premium, face amount, lead type\./)).toBeInTheDocument());
  });

  it("source: optional controls live inside the disclosure, the guard's pins survive, and there is one submit", () => {
    const content = CODE.indexOf("<CollapsibleContent");
    const trigger = CODE.indexOf("<CollapsibleTrigger");
    expect(content).toBeGreaterThan(0);
    expect(trigger).toBeGreaterThan(0);
    // Essentials come before the fold.
    for (const essential of ['id="deal-carrier"', 'id="deal-product"', 'id="deal-modal-premium"', 'id="deal-face"', 'id="deal-policy"', 'id="deal-lead-type-label"']) {
      expect(CODE.indexOf(essential), essential).toBeLessThan(trigger);
    }
    // Optional controls come after it. These three strings are also pinned by scripts/check-native-deals.mjs.
    for (const optional of ['id="deal-payment-method"', 'id="deal-policy-status"', 'title="Beneficiaries (Optional)"', 'id="deal-application-date"', 'id="deal-effective-date"', 'id="deal-draft-day"', 'id="deal-notes"', 'id="deal-evidence"']) {
      expect(CODE.indexOf(optional), optional).toBeGreaterThan(content);
    }
    expect(CODE).toContain('list="deal-product-options"');
    expect(CODE).toContain('"submit_apex_deal"');
    expect(CODE).toContain('saveSection("review")');
    expect(CODE.match(/type="submit"/g) ?? []).toHaveLength(1);
    expect(CODE).not.toContain("Review before submit");
    expect(CODE).toContain("onBlur={() => { void checkPolicyNumber(); }}");
    // The positive pins above prove CODE is the real file, so the negative pin is not vacuous.
    expect(SOURCE.length).toBeGreaterThan(1000);
  });
});
