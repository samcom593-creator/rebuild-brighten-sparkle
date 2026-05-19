import { useParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ApplicationConfirmation } from "@/components/landing/ApplicationConfirmation";

// Public status page — applicants can come back at any time via
// /status/<applicationId> and see exactly where their application is, who
// owns it, and what the next move is. The RPC is SECURITY DEFINER + only
// returns by id, so no auth required.
export default function ApplicationStatus() {
  usePageTitle("Your APEX Application Status");
  const { applicationId } = useParams<{ applicationId: string }>();

  return (
    <ApplicationConfirmation
      applicationId={applicationId ?? null}
      showCalendly={false}
    />
  );
}
