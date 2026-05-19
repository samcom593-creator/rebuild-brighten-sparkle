import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ApplicationConfirmation } from "@/components/landing/ApplicationConfirmation";

export default function ApplySuccessLicensed() {
  usePageTitle("Schedule Your Call · APEX Financial");
  const [search] = useSearchParams();
  const applicationId = search.get("aid") || search.get("application_id") || null;

  return (
    <ApplicationConfirmation
      applicationId={applicationId}
      forceLicenseStatus="licensed"
      showCalendly
    />
  );
}
