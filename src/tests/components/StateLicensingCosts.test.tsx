// PKG3 (N1, 2026-11-12): the unlicensed applicant's own state fees, from official sources with an
// as-of date. No fee is guessed, nothing renders without a valid state block, and the copy makes no
// reimbursement promise or income claim. Synthetic applicant only.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import { StateLicensingCosts, StateLicensingCostsView } from "@/components/landing/StateLicensingCosts";
import { formatAsOf, formatUsd, parseStateLicensingCosts } from "@/lib/stateLicensingCosts";
import { LicensingProofStep } from "@/components/landing/LicensingProofStep";

const APP = "11111111-2222-4333-8444-555555555555";

// The shape get_licensing_requirements_for_application returns (Wisconsin row as seeded 2026-11-11).
const WI = {
  state: "WI",
  state_name: "Wisconsin",
  as_of: "2026-11-11",
  course: {
    provider: "XCEL Solutions",
    price_usd: 49,
    list_price_usd: 199,
    extra_fee_usd: 0,
    extra_fee_label: null,
    url: "https://partners.xcelsolutions.com/wisconsin-life-pre-licensing-611wi020001a00?partner=afe",
    required_by_state: true,
  },
  exam: { vendor: "PSI", fee_usd: 75, schedule_url: "https://test-takers.psiexams.com/wiins" },
  fingerprint: { required: true, vendor: "Fieldprint", fee_usd: 34.75, url: "https://www.fieldprintwisconsin.com/" },
  license: { fee_usd: 10, processing_fee_usd: 5.6, apply_via: "NIPR" },
  total_known_usd: 174.35,
  missing: [],
};

// Texas: fingerprints required, fee not published by any official source.
const TX = {
  ...WI,
  state: "TX",
  state_name: "Texas",
  course: { ...WI.course, url: "https://partners.xcelsolutions.com/texas-life-pre-licensing-611tx020001a00?partner=afe" },
  exam: { vendor: "Pearson VUE", fee_usd: 39, schedule_url: "https://www.pearsonvue.com/us/en/tx/insurance.html" },
  fingerprint: { required: true, vendor: "IdentoGO", fee_usd: null, url: "https://uenroll.identogo.com/" },
  license: { fee_usd: 50, processing_fee_usd: null, apply_via: "Sircon or NIPR" },
  total_known_usd: 138,
  missing: ["fingerprint"],
};

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

describe("parseStateLicensingCosts", () => {
  it("accepts the RPC payload and keeps unknown fees as null", () => {
    const tx = parseStateLicensingCosts(TX);
    expect(tx?.state).toBe("TX");
    expect(tx?.fingerprint.feeUsd).toBeNull();
    expect(tx?.missing).toEqual(["fingerprint"]);
  });

  it("rejects anything that is not a state block", () => {
    expect(parseStateLicensingCosts(null)).toBeNull();
    expect(parseStateLicensingCosts({ submitted: false })).toBeNull();
    expect(parseStateLicensingCosts({ state: "Wisconsin" })).toBeNull();
    expect(parseStateLicensingCosts([WI])).toBeNull();
  });

  it("drops a link that is not https", () => {
    const parsed = parseStateLicensingCosts({ ...WI, exam: { ...WI.exam, schedule_url: "javascript:alert(1)" } });
    expect(parsed?.exam.scheduleUrl).toBeNull();
  });
});

describe("formatting", () => {
  it("prints whole dollars without cents and keeps real cents", () => {
    expect(formatUsd(49)).toBe("$49");
    expect(formatUsd(34.75)).toBe("$34.75");
    expect(formatUsd(5.6)).toBe("$5.60");
  });

  it("prints the as-of date without shifting it by time zone", () => {
    expect(formatAsOf("2026-11-11")).toBe("Nov 11, 2026");
    expect(formatAsOf("2026-01-01")).toBe("Jan 1, 2026");
  });
});

describe("StateLicensingCostsView", () => {
  it("shows course, exam, fingerprints, license and the known total with the as-of line", () => {
    render(<StateLicensingCostsView data={parseStateLicensingCosts(WI)!} />);
    const block = screen.getByTestId("state-licensing-costs");
    expect(block.textContent).toMatch(/What getting licensed costs in Wisconsin/);
    expect(block.textContent).toMatch(/Pre-licensing course/);
    expect(block.textContent).toMatch(/\$49/);
    expect(block.textContent).toMatch(/list \$199/);
    expect(block.textContent).toMatch(/State exam \(PSI\)/);
    expect(block.textContent).toMatch(/\$75/);
    expect(block.textContent).toMatch(/Fingerprints \(Fieldprint\)/);
    expect(block.textContent).toMatch(/\$34\.75/);
    // the license line already contains the processing fee: "includes", never "plus" ($10 + $5.60 = $15.60)
    expect(block.textContent).toMatch(/includes a \$5\.60 processing fee/);
    expect(block.textContent).not.toMatch(/plus \$5\.60/);
    expect(block.textContent).toMatch(/\$15\.60/);
    expect(block.textContent).toMatch(/Total\$174\.35/);
    expect(block.textContent).toMatch(/Fees from official state sources as of Nov 11, 2026\./);
  });

  it("links the partner course and the exam vendor in a new tab", () => {
    render(<StateLicensingCostsView data={parseStateLicensingCosts(WI)!} />);
    const course = screen.getByRole("link", { name: /Get the Wisconsin course/ });
    expect(course.getAttribute("href")).toContain("partner=afe");
    expect(course.getAttribute("target")).toBe("_blank");
    expect(course.getAttribute("rel")).toContain("noopener");
    const exam = screen.getByRole("link", { name: /Book with PSI/ });
    expect(exam.getAttribute("href")).toBe("https://test-takers.psiexams.com/wiins");
    expect(exam.getAttribute("target")).toBe("_blank");
  });

  it("says an unpublished fee is unpublished and leaves it out of the total", () => {
    render(<StateLicensingCostsView data={parseStateLicensingCosts(TX)!} />);
    const block = screen.getByTestId("state-licensing-costs");
    expect(block.textContent).toMatch(/Fee not published/);
    expect(block.textContent).toMatch(/Total of the fees we know\$138/);
    expect(block.textContent).toMatch(/The fingerprint fee is not published by the state, so it is not in the total\./);
  });

  it("marks fingerprints not required where the state does not require them", () => {
    const il = parseStateLicensingCosts({
      ...WI,
      state: "IL",
      state_name: "Illinois",
      fingerprint: { required: false, vendor: null, fee_usd: 0, url: null },
    })!;
    render(<StateLicensingCostsView data={il} />);
    expect(screen.getByTestId("state-licensing-costs").textContent).toMatch(/Not required for a life license in this state/);
  });

  it("shows the state reporting fee inside the course price", () => {
    const ca = parseStateLicensingCosts({
      ...WI,
      state: "CA",
      state_name: "California",
      course: { ...WI.course, extra_fee_usd: 6, extra_fee_label: "California state reporting fee, added at Xcel checkout" },
    })!;
    render(<StateLicensingCostsView data={ca} />);
    const text = screen.getByTestId("state-licensing-costs").textContent ?? "";
    expect(text).toMatch(/includes a \$6 state reporting fee/);
    expect(text).toMatch(/\$55/);
  });

  it("makes no reimbursement promise and no income claim", () => {
    render(<StateLicensingCostsView data={parseStateLicensingCosts(TX)!} />);
    const text = screen.getByTestId("state-licensing-costs").textContent ?? "";
    expect(text).not.toMatch(/reimburs|we (cover|pay)|galaxy pays|on us|free|no upfront|earn|income|\/month|per month/i);
  });
});

describe("StateLicensingCosts (data loading)", () => {
  it("asks for the application's own state block and renders it", async () => {
    rpc.mockResolvedValue({ data: WI, error: null });
    render(<StateLicensingCosts applicationId={APP} />);
    await waitFor(() => expect(screen.getByTestId("state-licensing-costs")).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith("get_licensing_requirements_for_application", { p_application_id: APP });
  });

  it("renders nothing when the state is unknown or not seeded (RPC returns null)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { container } = render(<StateLicensingCosts applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the RPC errors or throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "PGRST202" } });
    const first = render(<StateLicensingCosts applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(first.container.innerHTML).toBe("");
    rpc.mockRejectedValueOnce(new Error("network"));
    const second = render(<StateLicensingCosts applicationId="22222222-2222-4333-8444-555555555555" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(second.container.innerHTML).toBe("");
  });

  it("makes no call without an application id", () => {
    const { container } = render(<StateLicensingCosts applicationId={null} />);
    expect(rpc).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});

describe("LicensingProofStep shows the state block", () => {
  it("renders the fee block under the four steps when the state is seeded", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "get_licensing_requirements_for_application"
          ? { data: WI, error: null }
          : { data: { submitted: false }, error: null },
      ),
    );
    render(<LicensingProofStep applicationId={APP} firstName="Jordan" />);
    await waitFor(() => expect(screen.getByTestId("state-licensing-costs")).toBeTruthy());
    // still exactly the four ordered steps: the fee block is a description list, not a fifth step
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByTestId("ask-us-first")).toBeTruthy();
  });

  it("shows no fee block when the RPC has nothing for this applicant", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: { submitted: false }, error: null }));
    render(<LicensingProofStep applicationId={APP} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_licensing_requirements_for_application", { p_application_id: APP }));
    expect(screen.queryByTestId("state-licensing-costs")).toBeNull();
  });
});
