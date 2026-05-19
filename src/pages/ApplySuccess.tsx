import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ApplicationConfirmation } from "@/components/landing/ApplicationConfirmation";

// Generic post-application landing — used as a safety fallback whenever the
// caller didn't route the applicant into the licensed/unlicensed-specific
// success page. Apply.tsx normally routes by license_status; this exists so
// any stray /apply/success?aid=... link still renders the full confirmation.
export default function ApplySuccess() {
  usePageTitle("Application Received · APEX Financial");
  const [search] = useSearchParams();
  const applicationId = search.get("aid") || search.get("application_id") || null;

  return (
    <ApplicationConfirmation
      applicationId={applicationId}
      showCalendly={false}
    />
  );
}
