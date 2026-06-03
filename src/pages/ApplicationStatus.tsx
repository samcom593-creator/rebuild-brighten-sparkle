import { useParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ApplicationConfirmationV2 as ApplicationConfirmation } from "@/components/landing/ApplicationConfirmationV2";
import { NextStepCandidateCard } from "@/components/next-step/NextStepCandidateCard";
import { ApplicantSelfReport } from "@/components/landing/ApplicantSelfReport";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";

// Public status page — applicants can come back at any time via
// /status/<applicationId> and see exactly where their application is, who
// owns it, and what the next move is. The RPC is SECURITY DEFINER + only
// returns by id, so no auth required.
export default function ApplicationStatus() {
  usePageTitle("Your APEX Application Status");
  const { applicationId } = useParams<{ applicationId: string }>();
  const { snap } = useApplicationStatus(applicationId ?? null);

  return (
    <div className="min-h-screen bg-background">
      {applicationId && (
        <div className="container mx-auto px-4 pt-6 max-w-3xl space-y-4">
          {/* Always show "what's next" first — no scrolling required. */}
          <NextStepCandidateCard applicationId={applicationId} />
          {/* XCEL Gmail pull fallback — applicants can self-report progress. */}
          <ApplicantSelfReport
            applicationId={applicationId}
            currentStage={(snap as any)?.next_step_stage_key ?? null}
            licenseStatus={(snap?.license_status as any) ?? null}
          />
        </div>
      )}
      <ApplicationConfirmation
        applicationId={applicationId ?? null}
        showCalendly={false}
      />
    </div>
  );
}
