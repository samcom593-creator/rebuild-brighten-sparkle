// Pure helpers for the applicant's state licensing fees (decision N1, MP-ONBOARD-ANCHOR-PKG3 2026-11-12).
// The payload comes from get_licensing_requirements_for_application (licensing_state_requirements);
// StateLicensingCosts renders it. Kept out of the component file so the component file exports
// components only.

export interface StateLicensingCostsData {
  state: string;
  stateName: string;
  asOf: string | null;
  course: {
    priceUsd: number | null;
    listPriceUsd: number | null;
    extraFeeUsd: number | null;
    extraFeeLabel: string | null;
    url: string | null;
  };
  exam: { vendor: string | null; feeUsd: number | null; scheduleUrl: string | null };
  fingerprint: { required: boolean | null; vendor: string | null; feeUsd: number | null };
  license: { feeUsd: number | null; processingFeeUsd: number | null };
  totalKnownUsd: number | null;
  missing: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Only https links render; anything else is dropped rather than linked. */
export function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

/** Validates the RPC payload. Anything that is not a state fee block returns null (render nothing). */
export function parseStateLicensingCosts(raw: unknown): StateLicensingCostsData | null {
  if (!isObj(raw)) return null;
  const state = str(raw.state);
  if (!state || !/^[A-Z]{2}$/.test(state)) return null;
  const course = isObj(raw.course) ? raw.course : {};
  const exam = isObj(raw.exam) ? raw.exam : {};
  const fp = isObj(raw.fingerprint) ? raw.fingerprint : {};
  const lic = isObj(raw.license) ? raw.license : {};
  const asOf = str(raw.as_of);
  return {
    state,
    stateName: str(raw.state_name) ?? state,
    asOf: asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : null,
    course: {
      priceUsd: num(course.price_usd),
      listPriceUsd: num(course.list_price_usd),
      extraFeeUsd: num(course.extra_fee_usd),
      extraFeeLabel: str(course.extra_fee_label),
      url: httpsUrl(course.url),
    },
    exam: { vendor: str(exam.vendor), feeUsd: num(exam.fee_usd), scheduleUrl: httpsUrl(exam.schedule_url) },
    fingerprint: { required: bool(fp.required), vendor: str(fp.vendor), feeUsd: num(fp.fee_usd) },
    license: { feeUsd: num(lic.fee_usd), processingFeeUsd: num(lic.processing_fee_usd) },
    totalKnownUsd: num(raw.total_known_usd),
    missing: Array.isArray(raw.missing) ? raw.missing.filter((m): m is string => typeof m === "string") : [],
  };
}

/** $49, $34.75, $5.60 */
export function formatUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-11" -> "Nov 11, 2026". Parsed by hand so the reader's time zone cannot shift the day. */
export function formatAsOf(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : isoDate;
}
