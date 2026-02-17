import { useState } from "react";

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}
import { motion } from "framer-motion";
import { Phone, Mail, Instagram, Clock, User, Calendar, Sparkles, Building2, FileText, MapPin } from "lucide-react";
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
  lastContactedAt?: string;
  previousCompany?: string;
  niprNumber?: string;
  licensedStates?: string[];
  city?: string;
  state?: string;
  availability?: string;
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
  onSendFollowUp?: (calendarLink?: string) => Promise<void>;
  className?: string;
}

// Map license_progress to LicensingStage
function progressToStage(licenseProgress: string | null | undefined, licenseStatus: string): LicensingStage {
  if (licenseStatus === "licensed") return "licensed";
  
  switch (licenseProgress) {
    case "course_purchased": return "course_purchased";
    case "finished_course": return "finished_course";
    case "test_scheduled": return "test_scheduled";
    case "passed_test": return "passed_test";
    case "fingerprints_done": return "fingerprints_done";
    case "waiting_on_license": return "waiting_on_license";
    case "licensed": return "licensed";
    default: return "course_purchased";
  }
}

// Animation variants - simplified for type compatibility
const containerVariants = {
  hidden: { opacity: 0, x: 60, scale: 0.96 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    x: -60,
    scale: 0.96,
    transition: { duration: 0.2 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
} as const;

const badgeVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
} as const;

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
  onSendFollowUp,
  className,
}: CallCenterLeadCardProps) {
  const currentStage = progressToStage(lead.licenseProgress, lead.licenseStatus);
  const [showRipple, setShowRipple] = useState(false);

  const handleCall = () => {
    setShowRipple(true);
    setTimeout(() => setShowRipple(false), 600);
    onCall();
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        "relative overflow-hidden rounded-2xl",
        "bg-gradient-to-br from-card/95 via-card/90 to-card/85",
        "backdrop-blur-xl border border-border/50",
        "shadow-2xl shadow-black/20",
        "transition-all duration-300",
        "hover:border-primary/40 hover:shadow-primary/10",
        className
      )}
    >
      {/* Ambient glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none opacity-40" />

      {/* Recording indicator overlay */}
      {isRecording && (
        <motion.div
          className="absolute inset-0 border-2 border-red-500/40 rounded-2xl pointer-events-none z-10"
          animate={{
            opacity: [0.4, 0.8, 0.4],
            boxShadow: [
              "0 0 0 0 rgba(239, 68, 68, 0)",
              "0 0 20px 4px rgba(239, 68, 68, 0.3)",
              "0 0 0 0 rgba(239, 68, 68, 0)",
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Header */}
      <motion.div variants={itemVariants} className="relative p-4 md:p-6 border-b border-border/30">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {/* Source Badges */}
            <motion.div variants={itemVariants} className="flex items-center gap-2 mb-3">
              <motion.span
                variants={badgeVariants}
                whileHover={{ scale: 1.05 }}
                className={cn(
                  "text-xs px-3 py-1 rounded-full font-medium",
                  lead.source === "aged_leads"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                )}
              >
                {lead.source === "aged_leads" ? "Aged Lead" : "New Applicant"}
              </motion.span>
              <motion.span
                variants={badgeVariants}
                whileHover={{ scale: 1.05 }}
                className={cn(
                  "text-xs px-3 py-1 rounded-full font-medium",
                  lead.licenseStatus === "licensed"
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                )}
              >
                {lead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
              </motion.span>
            </motion.div>

            {/* Name with sparkle */}
            <motion.div variants={itemVariants} className="flex items-center gap-2">
              <h2 className="text-xl md:text-2xl font-bold text-foreground">
                {lead.firstName} {lead.lastName || ""}
              </h2>
              <Sparkles className="h-4 w-4 text-primary/60" />
            </motion.div>

            {/* Time info - All three timestamps */}
            <motion.div variants={itemVariants} className="flex flex-col gap-1 text-sm mt-2">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Lead Added:</span>
                <span className="text-foreground">{format(new Date(lead.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
              
              {lead.contactedAt && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 text-green-500" />
                  <span>First Contact:</span>
                  <span className="text-foreground">{format(new Date(lead.contactedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
              )}
              
              {lead.lastContactedAt && lead.lastContactedAt !== lead.contactedAt && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 text-blue-500" />
                  <span>Last Contact:</span>
                  <span className="text-foreground">{format(new Date(lead.lastContactedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
              )}
            </motion.div>
          </div>

          {/* Stage Selector */}
          <motion.div variants={itemVariants} className="hidden md:block w-48">
            <CallCenterStageSelector
              currentStage={currentStage}
              onStageChange={onStageChange}
              testScheduledDate={lead.testScheduledDate}
              onTestDateChange={onTestDateChange}
            />
          </motion.div>
        </div>
      </motion.div>

      {/* Contact Info & Countdown */}
      <div className="p-4 md:p-6 space-y-4">
        {/* 2-Week Countdown - starts from first contact */}
        <motion.div variants={itemVariants}>
          <LeadExpiryCountdown
            createdAt={lead.createdAt}
            contactedAt={lead.contactedAt}
            lastContactedAt={lead.lastContactedAt}
          />
        </motion.div>

        <motion.div variants={itemVariants} className="grid gap-3">
          {/* Phone - Primary CTA with ripple */}
          {lead.phone && (
            <motion.button
              onClick={handleCall}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className={cn(
                "relative flex items-center gap-4 p-4 rounded-xl w-full text-left transition-all overflow-hidden min-h-[60px]",
                "bg-gradient-to-r from-green-500/10 to-emerald-500/10",
                "border border-green-500/30 hover:border-green-500/50",
                "hover:from-green-500/20 hover:to-emerald-500/20",
                "group"
              )}
            >
              {/* Ripple effect */}
              {showRipple && (
                <motion.div
                  className="absolute inset-0 bg-green-500/30 rounded-xl"
                  initial={{ scale: 0, opacity: 1 }}
                  animate={{ scale: 2.5, opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              )}

              <div className="relative p-3 rounded-full bg-green-500/20 group-hover:bg-green-500/30 transition-colors">
                <Phone className="h-5 w-5 text-green-400" />
              </div>
              <div className="flex-1 relative z-10">
                <div className="text-lg font-semibold text-foreground">{formatPhoneDisplay(lead.phone)}</div>
                <div className="text-xs text-green-400">Tap to call</div>
              </div>
              <motion.div
                className="relative z-10 text-xs px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 font-medium"
                whileHover={{ scale: 1.05, backgroundColor: "rgba(34, 197, 94, 0.3)" }}
              >
                CALL NOW
              </motion.div>
            </motion.button>
          )}

          {/* Email */}
          <motion.a
            href={`mailto:${lead.email}`}
            whileHover={{ scale: 1.01, x: 2 }}
            className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="p-2.5 rounded-full bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm text-foreground">{lead.email}</span>
          </motion.a>

          {/* Instagram */}
          {lead.instagramHandle && (
            <motion.a
              href={`https://instagram.com/${lead.instagramHandle.replace("@", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.01, x: 2 }}
              className="flex items-center gap-4 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="p-2.5 rounded-full bg-pink-500/10">
                <Instagram className="h-4 w-4 text-pink-400" />
              </div>
              <span className="text-sm text-foreground">@{lead.instagramHandle.replace("@", "")}</span>
            </motion.a>
          )}
        </motion.div>

        {/* Notes / Motivation */}
        {(lead.notes || lead.motivation) && (
          <motion.div
            variants={itemVariants}
            className="p-4 rounded-xl bg-muted/20 border border-border/30"
          >
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <User className="h-3.5 w-3.5" />
              Lead Notes
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {lead.motivation || lead.notes}
            </p>
          </motion.div>
        )}

        {/* Applicant Details - Collapsible on mobile, always visible on desktop */}
        {(lead.previousCompany || lead.niprNumber || lead.licensedStates?.length || (lead.city || lead.state) || lead.availability) && (
          <>
            {/* Mobile: collapsible */}
            <motion.div variants={itemVariants} className="md:hidden">
              <details className="group">
                <summary className="p-4 rounded-xl bg-muted/20 border border-border/30 cursor-pointer list-none flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    Applicant Details
                  </div>
                  <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="p-4 rounded-b-xl bg-muted/20 border border-t-0 border-border/30 space-y-2">
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    {lead.previousCompany && (
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">Previous Agency:</span>
                        <span className="text-foreground font-medium truncate">{lead.previousCompany}</span>
                      </div>
                    )}
                    {lead.niprNumber && (
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">NIPR #:</span>
                        <span className="text-foreground font-medium">{lead.niprNumber}</span>
                      </div>
                    )}
                    {(lead.city || lead.state) && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-foreground">{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {lead.licensedStates && lead.licensedStates.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Licensed States:</span>
                        <span className="text-foreground font-medium">{lead.licensedStates.join(", ")}</span>
                      </div>
                    )}
                    {lead.availability && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">Availability:</span>
                        <span className="text-foreground">{lead.availability}</span>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </motion.div>

            {/* Desktop: always visible */}
            <motion.div
              variants={itemVariants}
              className="hidden md:block p-4 rounded-xl bg-muted/20 border border-border/30 space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Applicant Details
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {lead.previousCompany && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Previous Agency:</span>
                    <span className="text-foreground font-medium truncate">{lead.previousCompany}</span>
                  </div>
                )}
                {lead.niprNumber && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">NIPR #:</span>
                    <span className="text-foreground font-medium">{lead.niprNumber}</span>
                  </div>
                )}
                {(lead.city || lead.state) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-foreground">{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {lead.licensedStates && lead.licensedStates.length > 0 && (
                  <div className="flex items-center gap-2 col-span-2">
                    <span className="text-muted-foreground">Licensed States:</span>
                    <span className="text-foreground font-medium">{lead.licensedStates.join(", ")}</span>
                  </div>
                )}
                {lead.availability && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Availability:</span>
                    <span className="text-foreground">{lead.availability}</span>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}

        {/* Voice Recorder & Quick Email & Admin Actions */}
        <motion.div variants={itemVariants} className="pt-4 border-t border-border/30 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <CallCenterVoiceRecorder
                onTranscriptionUpdate={onTranscriptionUpdate}
                onRecordingStateChange={onRecordingStateChange}
                onSendFollowUp={onSendFollowUp}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
            <QuickEmailMenu
              applicationId={lead.id}
              agentId={null}
              licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
              recipientEmail={lead.email}
              recipientName={lead.firstName + (lead.lastName ? ` ${lead.lastName}` : "")}
              leadSource={lead.source}
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
        </motion.div>
      </div>
    </motion.div>
  );
}
