import { motion } from "framer-motion";
import { Phone, Mail, Instagram, Clock, User, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { CallCenterVoiceRecorder } from "./CallCenterVoiceRecorder";
import { CallCenterStageSelector, type LicensingStage } from "./CallCenterStageSelector";
import { LeadReassignButton } from "./LeadReassignButton";
import { LeadExpiryCountdown } from "./LeadExpiryCountdown";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ResendLicensingButton } from "./ResendLicensingButton";

interface UnifiedLead {
  id: string;
  source: "aged_leads" | "applications";
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  instagramHandle?: string;
  notes?: string;
  motivation?: string;
  licenseStatus: string;
  licenseProgress?: string | null;
  testScheduledDate?: string | null;
  createdAt: string;
  status: string;
  contactedAt?: string;
}

interface CallCenterLeadCardProps {
  lead: UnifiedLead;
  onTranscriptionUpdate: (notes: string) => void;
  onStageChange: (stage: LicensingStage) => void;
  onTestDateChange?: (date: Date | undefined) => void;
  onCall: () => void;
  isRecording: boolean;
  onRecordingStateChange: (recording: boolean) => void;
  isAdmin?: boolean;
  onReassigned?: (newManagerId: string) => void;
  className?: string;
}

// Map license_progress to LicensingStage
function progressToStage(licenseProgress: string | null | undefined, licenseStatus: string): LicensingStage {
  // If licensed, always show licensed
  if (licenseStatus === "licensed") {
    return "licensed";
  }
  
  // Map license_progress values
  switch (licenseProgress) {
    case "course_purchased":
      return "course_purchased";
    case "finished_course":
      return "finished_course";
    case "test_scheduled":
      return "test_scheduled";
    case "passed_test":
      return "passed_test";
    case "fingerprints_done":
      return "fingerprints_done";
    case "waiting_on_license":
      return "waiting_on_license";
    case "licensed":
      return "licensed";
    default:
      // Default to course_purchased for unlicensed leads
      return "course_purchased";
  }
}

export function CallCenterLeadCard({
  lead,
  onTranscriptionUpdate,
  onStageChange,
  onTestDateChange,
  onCall,
  isRecording,
  onRecordingStateChange,
  isAdmin = false,
  onReassigned,
  className,
}: CallCenterLeadCardProps) {
  const currentStage = progressToStage(lead.licenseProgress, lead.licenseStatus);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.98 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "relative overflow-hidden rounded-2xl",
        "bg-gradient-to-br from-card/90 via-card/80 to-card/70",
        "backdrop-blur-xl border border-border/50",
        "shadow-2xl shadow-black/20",
        "hover:border-primary/30 transition-all duration-300",
        className
      )}
    >
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
      
      {/* Recording indicator overlay */}
      {isRecording && (
        <motion.div
          className="absolute inset-0 border-2 border-red-500/30 rounded-2xl pointer-events-none"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* Header */}
      <div className="relative p-6 border-b border-border/30">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {/* Source Badge */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className={cn(
                  "text-xs px-3 py-1 rounded-full font-medium",
                  lead.source === "aged_leads"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                )}
              >
                {lead.source === "aged_leads" ? "Aged Lead" : "New Applicant"}
              </span>
              <span
                className={cn(
                  "text-xs px-3 py-1 rounded-full font-medium",
                  lead.licenseStatus === "licensed"
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                )}
              >
                {lead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
              </span>
            </div>

            {/* Name */}
            <h2 className="text-2xl font-bold text-foreground mb-1">
              {lead.firstName} {lead.lastName || ""}
            </h2>

            {/* Time info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Added {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
              </span>
              {lead.contactedAt && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Last contact: {format(new Date(lead.contactedAt), "MMM d")}
                </span>
              )}
            </div>
          </div>

          {/* Stage Selector */}
          <div className="w-48">
            <CallCenterStageSelector
              currentStage={currentStage}
              onStageChange={onStageChange}
              testScheduledDate={lead.testScheduledDate}
              onTestDateChange={onTestDateChange}
            />
          </div>
        </div>
      </div>

      {/* Contact Info & Countdown */}
      <div className="p-6 space-y-4">
        {/* 2-Week Countdown */}
        <LeadExpiryCountdown 
          createdAt={lead.createdAt} 
          contactedAt={lead.contactedAt} 
        />

        <div className="grid gap-3">
          {/* Phone - Primary CTA */}
          {lead.phone && (
            <button
              onClick={onCall}
              className={cn(
                "flex items-center gap-4 p-4 rounded-xl w-full text-left transition-all",
                "bg-gradient-to-r from-green-500/10 to-emerald-500/10",
                "border border-green-500/30 hover:border-green-500/50",
                "hover:from-green-500/20 hover:to-emerald-500/20",
                "group"
              )}
            >
              <div className="p-3 rounded-full bg-green-500/20 group-hover:bg-green-500/30 transition-colors">
                <Phone className="h-5 w-5 text-green-400" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold text-foreground">{lead.phone}</div>
                <div className="text-xs text-green-400">Tap to call</div>
              </div>
              <motion.div
                className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 font-medium"
                whileHover={{ scale: 1.05 }}
              >
                CALL NOW
              </motion.div>
            </button>
          )}

          {/* Email */}
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="p-2.5 rounded-full bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm text-foreground">{lead.email}</span>
          </a>

          {/* Instagram */}
          {lead.instagramHandle && (
            <a
              href={`https://instagram.com/${lead.instagramHandle.replace("@", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="p-2.5 rounded-full bg-pink-500/10">
                <Instagram className="h-4 w-4 text-pink-400" />
              </div>
              <span className="text-sm text-foreground">@{lead.instagramHandle.replace("@", "")}</span>
            </a>
          )}
        </div>

        {/* Notes / Motivation */}
        {(lead.notes || lead.motivation) && (
          <div className="p-4 rounded-xl bg-muted/20 border border-border/30">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <User className="h-3.5 w-3.5" />
              Lead Notes
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {lead.motivation || lead.notes}
            </p>
          </div>
        )}

        {/* Voice Recorder & Quick Email & Resend Licensing & Admin Reassign */}
        <div className="pt-4 border-t border-border/30 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <CallCenterVoiceRecorder
                onTranscriptionUpdate={onTranscriptionUpdate}
                onRecordingStateChange={onRecordingStateChange}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <QuickEmailMenu
                applicationId={lead.id}
                agentId={null}
                licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                recipientEmail={lead.email}
                recipientName={lead.firstName + (lead.lastName ? ` ${lead.lastName}` : "")}
              />
              {lead.licenseStatus !== "licensed" && (
                <ResendLicensingButton
                  recipientEmail={lead.email}
                  recipientName={lead.firstName}
                  licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                />
              )}
              {isAdmin && (
                <LeadReassignButton
                  leadId={lead.id}
                  leadSource={lead.source}
                  onReassigned={onReassigned}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
