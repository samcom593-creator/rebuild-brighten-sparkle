import { describe, it, expect } from "vitest";
import { APEX_BRAND, resolveBrand, showsPoweredBy } from "../brand";

describe("resolveBrand", () => {
  it("returns platform defaults when no tenant is supplied", () => {
    expect(resolveBrand()).toEqual(APEX_BRAND);
    expect(resolveBrand(null)).toEqual(APEX_BRAND);
  });

  it("applies tenant overrides over defaults", () => {
    const b = resolveBrand({ overrides: { platformName: "Summit", shortName: "SUM" } });
    expect(b.platformName).toBe("Summit");
    expect(b.shortName).toBe("SUM");
  });

  it("falls back to APEX defaults for unset and EMPTY tenant fields", () => {
    // A half-configured tenant must never render an unnamed product.
    const b = resolveBrand({ overrides: { platformName: "", productName: undefined } });
    expect(b.platformName).toBe(APEX_BRAND.platformName);
    expect(b.productName).toBe(APEX_BRAND.productName);
  });

  it("does not let a tenant escalate its own branding tier", () => {
    // brandingMode is absent from TenantBrandOverrides by design, so an
    // overrides blob cannot promote a tenant to white_label.
    const b = resolveBrand({
      brandingMode: "powered_by",
      overrides: { platformName: "Summit" } as Record<string, string>,
    });
    expect(b.brandingMode).toBe("powered_by");
  });
});

describe("showsPoweredBy", () => {
  it("is false in apex mode — the product is already APEX", () => {
    expect(showsPoweredBy(APEX_BRAND, "footer")).toBe(false);
  });

  it("is false in white_label mode everywhere", () => {
    const b = resolveBrand({ brandingMode: "white_label" });
    for (const loc of ["footer", "auth_screen", "email_footer", "loading_screen"] as const) {
      expect(showsPoweredBy(b, loc)).toBe(false);
    }
  });

  it("is true in powered_by mode only at configured locations", () => {
    const b = resolveBrand({ brandingMode: "powered_by", poweredByLocations: ["footer"] });
    expect(showsPoweredBy(b, "footer")).toBe(true);
    expect(showsPoweredBy(b, "auth_screen")).toBe(false);
  });
});
