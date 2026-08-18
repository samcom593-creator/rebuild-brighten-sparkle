/**
 * Central brand configuration — the single source of every user-facing platform
 * name, co-brand string and support URL.
 *
 * WHY THIS EXISTS
 * The 2026-08-17 Phase Zero audit measured 760 hardcoded "Apex"/"APEX" literals
 * across 195 files with no central config. That is the exact pattern the APEX OS
 * directive (§11) prohibits: "Do not scatter APEX strings through components. Use
 * centralized tenant-aware configuration." Every one of those literals is a
 * white-label blocker — a tenant on "Agency Branded" or "Full White Label" mode
 * would still see APEX's name baked into components.
 *
 * MIGRATION SHAPE
 * `resolveBrand()` is the seam. Today it returns platform defaults. When the
 * tenant entity lands (traceability R-007) it will merge tenant overrides on top.
 * Call sites written against `resolveBrand()` do not change again at that point —
 * which is the whole point of building this before the schema work.
 *
 * Guarded by scripts/check-brand-literals.mjs, a baseline ratchet: the hardcoded
 * count may fall, never rise.
 */

/** How much of the APEX identity a tenant surfaces. Directive section 11. */
export type BrandingMode =
  /** Full APEX identity. */
  | "apex"
  /** Agency identity primary; APEX appears in configured locations. */
  | "powered_by"
  /** Agency identity only, where contractually and technically permitted. */
  | "white_label";

/** Surfaces where the co-brand line may appear under `powered_by`. */
export type PoweredByLocation =
  | "loading_screen"
  | "auth_screen"
  | "footer"
  | "email_footer"
  | "about_panel";

export interface Brand {
  /** Parent brand, e.g. "APEX". */
  platformName: string;
  /** Product name, e.g. "APEX OS". */
  productName: string;
  /** Legal entity name for documents and invoices. */
  legalName: string;
  /** Short form for tight UI (nav, mobile). */
  shortName: string;
  /** Co-brand line rendered under `powered_by`. */
  poweredBy: string;
  brandingMode: BrandingMode;
  poweredByLocations: readonly PoweredByLocation[];
  supportEmail: string;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Document title suffix. */
  titleSuffix: string;
}

/**
 * Platform defaults. These are APEX's own values and double as the fallback for
 * any tenant field left unset.
 */
export const APEX_BRAND: Brand = {
  platformName: "APEX",
  productName: "APEX OS",
  legalName: "Apex Financial",
  shortName: "APEX",
  poweredBy: "Powered by APEX",
  brandingMode: "apex",
  poweredByLocations: ["loading_screen", "auth_screen", "footer", "email_footer"],
  supportEmail: "info@kingofsales.net",
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  titleSuffix: "· APEX OS",
} as const;

/**
 * Fields a tenant may override. Deliberately a subset of Brand — `brandingMode`
 * and co-brand placement are platform-controlled, because a tenant must not be
 * able to promote itself out of its contracted white-label tier from the UI.
 */
export type TenantBrandOverrides = Partial<
  Pick<
    Brand,
    | "platformName"
    | "productName"
    | "legalName"
    | "shortName"
    | "supportEmail"
    | "supportUrl"
    | "termsUrl"
    | "privacyUrl"
    | "titleSuffix"
  >
>;

/** Shape of the not-yet-existing tenant record this will read from (R-007). */
export interface TenantBrandSource {
  brandingMode?: BrandingMode;
  poweredByLocations?: readonly PoweredByLocation[];
  overrides?: TenantBrandOverrides;
}

/**
 * Resolve the effective brand.
 *
 * Returns platform defaults when no tenant is supplied — which is every call site
 * today, since the tenant entity does not exist yet. Undefined and empty tenant
 * fields fall through to APEX defaults rather than rendering blank, so a
 * half-configured tenant can never produce an unnamed product.
 */
export function resolveBrand(tenant?: TenantBrandSource | null): Brand {
  if (!tenant) return APEX_BRAND;
  const { overrides, brandingMode, poweredByLocations } = tenant;
  const applied = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined && v !== ""),
  ) as TenantBrandOverrides;
  return {
    ...APEX_BRAND,
    ...applied,
    brandingMode: brandingMode ?? APEX_BRAND.brandingMode,
    poweredByLocations: poweredByLocations ?? APEX_BRAND.poweredByLocations,
  };
}

/**
 * Whether the co-brand line should render at `location`.
 *
 * `apex` mode does not show "Powered by APEX" — the whole product is already APEX,
 * so the line would be redundant. `white_label` never shows it. Only `powered_by`
 * consults the configured locations.
 */
export function showsPoweredBy(brand: Brand, location: PoweredByLocation): boolean {
  return brand.brandingMode === "powered_by" && brand.poweredByLocations.includes(location);
}
