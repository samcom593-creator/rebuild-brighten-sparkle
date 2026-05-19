import { useParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ApplicationConfirmation } from "@/components/landing/ApplicationConfirmation";
import { NextStepCandidateCard } from "@/components/next-step/NextStepCandidateCard";

// Public status page — applicants can come back at any time via
// /status/<applicationId> and see exactly where their application is, who
// owns it, and what the next move is. The RPC is SECURITY DEFINER + only
// returns by id, so no auth required.
export default function ApplicationStatus() {
  usePageTitle("Your APEX Application Status");
  const { applicationId } = useParams<{ applicationId: string }>();

  return (
    <div className="min-h-screen bg-background">
      {applicationId && (
        <div className="container mx-auto px-4 pt-6 max-w-3xl">
          {/* Always show "what's next" first — no scrolling required. */}
          <NextStepCandidateCard applicationId={applicationId} />
        </div>
      )}
      <ApplicationConfirmation
        applicationId={applicationId ?? null}
        showCalendly={false}
      />
    </div>
  );
}
