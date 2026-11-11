// StateLicensingCosts — what getting licensed costs in the applicant's state (decision N1,
// MP-ONBOARD-ANCHOR-PKG3 2026-11-12).
//
// The applicant buys the pre-licensing course at the Xcel partner price; the state's exam,
// fingerprint and license fees come from official sources with an as-of date
// (public.licensing_state_requirements). No reimbursement promise, no income claim, no guess:
// a fee the source does not publish says so and is left out of the total.
//
// Data: get_licensing_requirements_for_application(p_application_id), a SECURITY DEFINER read
// the anonymous /status/:id page can call. It returns NULL for a licensed or suspended applicant,
// an unknown state, or a state with no row, and then this block renders nothing.

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  formatAsOf,
  formatUsd,
  parseStateLicensingCosts,
  type StateLicensingCostsData,
} from "@/lib/stateLicensingCosts";

const MISSING_LABEL: Record<string, string> = {
  course: "course",
  exam: "exam",
  fingerprint: "fingerprint",
  license: "license",
};

function Row({ label, detail, value, link }: { label: string; detail?: string | null; value: string; link?: { href: string; text: string } | null }) {
  return (
    <>
      <dt className="text-foreground">
        {label}
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
        {link ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
          >
            {link.text} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </>
  );
}

/** The block itself, from already-validated data. */
export function StateLicensingCostsView({ data }: { data: StateLicensingCostsData }) {
  const { course, exam, fingerprint, license } = data;
  const coursePaid = course.priceUsd != null ? course.priceUsd + (course.extraFeeUsd ?? 0) : null;
  const courseDetail = [
    course.listPriceUsd != null ? `Xcel partner price (list ${formatUsd(course.listPriceUsd)})` : "Xcel partner price",
    course.extraFeeUsd ? `includes a ${formatUsd(course.extraFeeUsd)} state reporting fee` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const fingerprintValue =
    fingerprint.required === false
      ? "Not required"
      : fingerprint.feeUsd != null
        ? formatUsd(fingerprint.feeUsd)
        : "Fee not published";

  const missing = data.missing.map((m) => MISSING_LABEL[m]).filter(Boolean);

  return (
    <section
      className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3 text-sm"
      aria-labelledby="state-licensing-costs-title"
      data-testid="state-licensing-costs"
    >
      <p id="state-licensing-costs-title" className="font-semibold text-foreground">
        What getting licensed costs in {data.stateName}
      </p>
      <dl className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2">
        {coursePaid != null ? (
          <Row
            label="Pre-licensing course"
            detail={courseDetail}
            value={formatUsd(coursePaid)}
            link={course.url ? { href: course.url, text: `Get the ${data.stateName} course` } : null}
          />
        ) : null}
        <Row
          label={exam.vendor ? `State exam (${exam.vendor})` : "State exam"}
          value={exam.feeUsd != null ? formatUsd(exam.feeUsd) : "Fee not published"}
          link={exam.scheduleUrl ? { href: exam.scheduleUrl, text: exam.vendor ? `Book with ${exam.vendor}` : "Book the exam" } : null}
        />
        <Row
          label={fingerprint.vendor && fingerprint.required !== false ? `Fingerprints (${fingerprint.vendor})` : "Fingerprints"}
          detail={fingerprint.required === false ? "Not required for a life license in this state" : null}
          value={fingerprintValue}
        />
        <Row
          label="State license fee"
          detail={license.processingFeeUsd ? `includes a ${formatUsd(license.processingFeeUsd)} processing fee` : null}
          value={license.feeUsd != null ? formatUsd(license.feeUsd + (license.processingFeeUsd ?? 0)) : "Fee not published"}
        />
        {data.totalKnownUsd != null ? (
          <>
            <dt className="border-t border-border/40 pt-2 font-semibold text-foreground">
              {missing.length ? "Total of the fees we know" : "Total"}
            </dt>
            <dd className="border-t border-border/40 pt-2 text-right font-semibold tabular-nums text-foreground">
              {formatUsd(data.totalKnownUsd)}
            </dd>
          </>
        ) : null}
      </dl>
      {missing.length ? (
        <p className="text-xs text-muted-foreground">
          The {missing.join(" and ")} fee is not published by the state, so it is not in the total.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Course price from Xcel&apos;s partner page.
        {data.asOf ? ` Fees from official state sources as of ${formatAsOf(data.asOf)}.` : " Fees from official state sources."}
      </p>
    </section>
  );
}

/** Loads the applicant's state block; renders nothing until there is a valid one. */
export function StateLicensingCosts({ applicationId }: { applicationId: string | null }) {
  const [data, setData] = useState<StateLicensingCostsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!applicationId) {
      setData(null);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const { data: raw, error } = await supabase.rpc(
          "get_licensing_requirements_for_application" as never,
          { p_application_id: applicationId } as never,
        );
        if (cancelled) return;
        setData(error ? null : parseStateLicensingCosts(raw));
      } catch {
        // A fee block that cannot load is left out; the rest of the page still works.
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  return data ? <StateLicensingCostsView data={data} /> : null;
}

export default StateLicensingCosts;
