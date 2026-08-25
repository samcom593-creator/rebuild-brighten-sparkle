import { useCallback, useState, useEffect, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, Crown, ExternalLink, GraduationCap, Link2, Loader2, ShieldCheck, User, UserPlus, Users, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface Manager {
  id: string;
  name: string;
}

interface AddAgentModalProps {
  onAgentAdded?: (agentId?: string) => void;
  trigger?: ReactNode;
}

type BuilderTrack = "agent" | "manager_track" | "agency_owner_track";
type FunctionErrorContext = {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};
type FunctionError = Error & { context?: FunctionErrorContext };

export const CONTRACTING_INTAKE_URL = "https://apex-financial.org/start-contracting";

const BUILDER_TRACK_OPTIONS: Array<{
  value: BuilderTrack;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "agent", label: "Agent", icon: User },
  { value: "manager_track", label: "Manager Track", icon: Users },
  { value: "agency_owner_track", label: "Agency Owner Track", icon: Crown },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function AddAgentModal({ onAgentAdded, trigger }: AddAgentModalProps) {
  const { user, isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [contractingLinkCopied, setContractingLinkCopied] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);

  // Simplified form state - essentials only
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [managerId, setManagerId] = useState("");
  // No hidden default: Add Agent always starts by asking which journey this
  // person belongs in. That prevents an accidental unlicensed add when the
  // operator moves quickly through the form.
  const [licenseStatus, setLicenseStatus] = useState<"licensed" | "unlicensed" | null>(null);
  // Sam 2026-08-06: capture the NPN at add time. agents.nipr_number has existed
  // since the original schema but no UI ever wrote to it — 0 of 178 agent rows
  // had an NPN. Same discipline as Apply.tsx / HireLink.tsx: an agent marked
  // "licensed" with no NPN is an unprovable self-claim, so the NPN is required
  // whenever the licensed option is picked.
  const [npn, setNpn] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseStates, setLicenseStates] = useState("");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState("");
  const [compPercentage, setCompPercentage] = useState("60");
  const [samApprovalRequested, setSamApprovalRequested] = useState(false);
  const [builderTrack, setBuilderTrack] = useState<BuilderTrack>("agent");
  // Sam-feedback 2026-06-03: Transfer needed = ON → collect carriers,
  // writing numbers, previous upline. Otherwise skip those entirely.
  const [transferNeeded, setTransferNeeded] = useState(false);
  const [carriers, setCarriers] = useState("");
  const [writingNumbers, setWritingNumbers] = useState("");
  const [previousUpline, setPreviousUpline] = useState("");
  const fetchManagers = useCallback(async () => {
    setLoadingManagers(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-active-managers");

      if (error) {
        console.error("Error fetching managers:", error);
        toast.error("Failed to load managers");
        return;
      }

      if (data?.managers && Array.isArray(data.managers)) {
        setManagers(data.managers);

        // Pre-select current user's agent record if they're a manager
        if (user) {
          const { data: currentAgent } = await supabase
            .from("agents")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();

          if (currentAgent) {
            const isCurrentUserManager = data.managers.some((m: Manager) => m.id === currentAgent.id);
            if (isCurrentUserManager) {
              setManagerId(currentAgent.id);
            } else if (data.managers.length > 0) {
              setManagerId(data.managers[0].id);
            }
          } else if (data.managers.length > 0) {
            setManagerId(data.managers[0].id);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching managers:", error);
      toast.error("Failed to load managers");
    } finally {
      setLoadingManagers(false);
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      fetchManagers();
    }
  }, [open, fetchManagers]);

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
  };

  const copyContractingLink = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACTING_INTAKE_URL);
      setContractingLinkCopied(true);
      toast.success("One-link contracting intake copied");
    } catch {
      toast.error(`Copy failed — open ${CONTRACTING_INTAKE_URL}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Sam 2026-04-29: surface specific missing-field message instead of a
    // generic "fill in all required fields" toast — multiple users reported
    // "Add Agent button not working" but the real issue was a missed field
    // on a tall form that they didn't scroll back to.
    const missing: string[] = [];
    if (!licenseStatus) missing.push("Licensed or unlicensed path");
    if (!firstName.trim()) missing.push("First name");
    if (!lastName.trim()) missing.push("Last name");
    if (!email.trim()) missing.push("Email");
    if (!phone.trim()) missing.push("Phone");
    if (!managerId) missing.push("Manager");
    if (missing.length) {
      toast.error(`Missing: ${missing.join(", ")}`);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    // Licensed => NPN required. Mirrors HireLink's >= 4-digit rule so the same
    // producer can't be added with proof on one surface and none on the other.
    const normalizedNpnLength = npn.replace(/\D+/g, "").length;
    if (licenseStatus === "licensed" && (normalizedNpnLength < 5 || normalizedNpnLength > 10)) {
      toast.error("NPN is required for a licensed agent — look it up free at nipr.com");
      return;
    }
    const normalizedComp = Number(compPercentage);
    if (licenseStatus === "licensed" && (!Number.isFinite(normalizedComp) || normalizedComp < 50 || normalizedComp > 200)) {
      toast.error("Comp must be between 50% and 200%.");
      return;
    }
    if (licenseStatus === "licensed" && normalizedComp > 100 && !samApprovalRequested) {
      toast.error("Check 'Request approval from Sam' for comp above 100%.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("add-agent", {
        body: {
          firstName,
          lastName,
          email,
          phone,
          managerId,
          licenseStatus,
          niprNumber: npn.trim() || undefined,
          licenseNumber: licenseNumber.trim() || undefined,
          // "TX, LA, MS" -> ["TX","LA","MS"] for the agents.license_states text[].
          licenseStates: licenseStates
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
          licenseExpiresAt: licenseExpiresAt || undefined,
          // Both paths enter training. Unlicensed hires receive XCEL; licensed
          // hires receive the licensed onboarding curriculum while contracting
          // is queued in the same canonical server transaction.
          hasTrainingCourse: true,
          compPercentage: licenseStatus === "licensed" ? normalizedComp : 60,
          samApprovalRequested: licenseStatus === "licensed" && normalizedComp > 100 && samApprovalRequested,
          builderTrack: isAdmin ? builderTrack : undefined,
          // Sam-feedback 2026-06-03: Transfer block — only sent when ON
          transferNeeded,
          transferCarriers: transferNeeded ? (carriers.trim() || undefined) : undefined,
          transferWritingNumbers: transferNeeded ? (writingNumbers.trim() || undefined) : undefined,
          transferPreviousUpline: transferNeeded ? (previousUpline.trim() || undefined) : undefined,
        },
      });

      // Surface every failure mode loudly. The previous code returned with
      // only a single toast for transport errors; data-level errors landed
      // in a separate branch; and a "neither succeeds nor errors" return
      // (e.g. empty body / 500 with no JSON) silently no-oped.
      if (error) {
        console.error("[AddAgentModal] transport error:", error);
        // supabase-js wraps non-2xx responses as FunctionsHttpError with the
        // raw Response in error.context. Parse the JSON body so the toast
        // shows the REAL server error instead of "Edge Function returned a
        // non-2xx status code".
        let realMessage = error.message || "Add Agent failed";
        try {
          const ctx = (error as FunctionError).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (isRecord(body) && body.error) {
              realMessage = typeof body.error === "string"
                ? body.error
                : `${String(body.error)}${body.stage ? ` (at ${String(body.stage)})` : ""}`;
            } else if (isRecord(body) && typeof body.message === "string") {
              realMessage = body.message;
            }
          } else if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            if (txt) realMessage = txt.slice(0, 500);
          }
        } catch (parseErr) {
          console.error("[AddAgentModal] couldn't parse error body:", parseErr);
        }
        toast.error(realMessage);
        return;
      }

      if (data?.error) {
        console.error("[AddAgentModal] server error:", data.error);
        const msg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        toast.error(data.stage ? `${msg} (at ${data.stage})` : msg);
        return;
      }

      if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
        console.error("[AddAgentModal] empty response", data);
        toast.error("Server returned no response — agent may not have been created. Refresh to verify.");
        return;
      }

      // wave-p1j (audit L151): edge fn now returns per-side-effect status +
      // partial:true when welcome-email or course-enrollment-email failed.
      // Show a warning toast (not celebrate) so admins know to resend manually
      // instead of the previous blanket-success lie.
      const partial = isRecord(data) && data.partial === true;
      const displayMessage = (isRecord(data) && typeof data.message === "string" && data.message) || "Agent added successfully!";
      if (partial) {
        toast.warning(displayMessage);
      } else {
        playSound("celebrate");
        toast.success(displayMessage);
      }

      // Invalidate dashboard queries so new agent appears immediately
      queryClient.invalidateQueries({ queryKey: ["manager-team-view"] });
      queryClient.invalidateQueries({ queryKey: ["recruiting-quick-view"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["team-overview"] });
      queryClient.invalidateQueries({ queryKey: ["builder-operating-dashboard"] });

      setOpen(false);
      resetForm();
      onAgentAdded?.(isRecord(data) && typeof data.agentId === "string" ? data.agentId : undefined);
    } catch (error: unknown) {
      console.error("Error adding agent:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to add agent";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setManagerId("");
    setLicenseStatus(null);
    setNpn("");
    setLicenseNumber("");
    setLicenseStates("");
    setLicenseExpiresAt("");
    setCompPercentage("60");
    setSamApprovalRequested(false);
    setBuilderTrack("agent");
    setTransferNeeded(false);
    setCarriers("");
    setWritingNumbers("");
    setPreviousUpline("");
    setContractingLinkCopied(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && !loading) resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add Agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {!licenseStatus ? "Add Agent" : licenseStatus === "licensed" ? "Add Licensed Agent" : "Add Unlicensed Recruit"}
          </DialogTitle>
          <DialogDescription>
            {!licenseStatus
              ? "First choose the correct journey. APEX will run the matching onboarding process inside this window."
              : licenseStatus === "licensed"
                ? "Create portal access and queue the agent for the contracting spreadsheet and Discord."
                : "Create portal access, send the XCEL course, and add the recruit to the licensing tracker."}
          </DialogDescription>
        </DialogHeader>
        {!licenseStatus ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Agent license path">
              <button
                type="button"
                role="radio"
                aria-checked="false"
                data-testid="add-agent-path-licensed"
                onClick={() => setLicenseStatus("licensed")}
                className="rounded-xl border border-border bg-background p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                </span>
                <span className="mt-3 block text-base font-bold">Licensed Agent</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Has an NPN. Start contracting now.</span>
                <span className="mt-4 block text-xs font-semibold text-emerald-500">Choose licensed →</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked="false"
                data-testid="add-agent-path-unlicensed"
                onClick={() => setLicenseStatus("unlicensed")}
                className="rounded-xl border border-border bg-background p-4 text-left transition hover:border-amber-500 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-amber-500/15">
                  <GraduationCap className="h-5 w-5 text-amber-500" />
                </span>
                <span className="mt-3 block text-base font-bold">Unlicensed Recruit</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Needs the course. Start licensing now.</span>
                <span className="mt-4 block text-xs font-semibold text-amber-500">Choose unlicensed →</span>
              </button>
              <div className="rounded-xl border border-primary/35 bg-primary/5 p-4 sm:col-span-2">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">One-link contracting</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Send one link to any licensed hire. Their intake queues the contracting spreadsheet and private support Discord.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => void copyContractingLink()} className="gap-1.5">
                        {contractingLinkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {contractingLinkCopied ? "Copied" : "Copy link"}
                      </Button>
                      <Button asChild type="button" size="sm" variant="outline" className="gap-1.5">
                        <a href={CONTRACTING_INTAKE_URL} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> Open
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <button
            type="button"
            onClick={() => setLicenseStatus(null)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Change licensed status
          </button>

          {licenseStatus === "licensed" ? (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-3">
              <div className="flex items-start gap-2.5">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Prefer one link?</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Skip manual entry and send the contracting intake. It queues the spreadsheet and support Discord after submission.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void copyContractingLink()} className="h-9 gap-1.5">
                      {contractingLinkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {contractingLinkCopied ? "Copied" : "Copy contracting link"}
                    </Button>
                    <Button asChild type="button" size="sm" variant="outline" className="h-9 gap-1.5">
                      <a href={CONTRACTING_INTAKE_URL} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Name Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                required
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={handlePhoneChange}
              placeholder="(555) 123-4567"
              required
            />
          </div>

          {/* Manager */}
          <div className="space-y-1.5">
            <Label htmlFor="manager">Assign to Manager *</Label>
            <Select value={managerId} onValueChange={setManagerId} required>
              <SelectTrigger>
                <SelectValue placeholder={loadingManagers ? "Loading..." : "Select a manager"} />
              </SelectTrigger>
              <SelectContent>
                {loadingManagers ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : managers.length === 0 ? (
                  <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                    No managers available
                  </div>
                ) : (
                  managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* License details. NPN is the only field that gates submit, and only
              when "Licensed" is picked — everything else is optional so an
              unlicensed add stays a 5-field form. */}
          {licenseStatus === "licensed" ? <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-npn">
                NPN{" "}
                <span className="text-rose-400">*</span>
              </Label>
              <Input
                id="agent-npn"
                inputMode="numeric"
                value={npn}
                onChange={(e) => setNpn(e.target.value)}
                placeholder="National Producer Number"
              />
              <p className="text-[11px] text-muted-foreground">
                Required — this is the proof of licensure. Free lookup at nipr.com.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="agent-license-number">License #</Label>
                <Input
                  id="agent-license-number"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="State license number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-license-expires">License expires</Label>
                <Input
                  id="agent-license-expires"
                  type="date"
                  value={licenseExpiresAt}
                  onChange={(e) => setLicenseExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-license-states">Licensed states</Label>
              <Input
                id="agent-license-states"
                value={licenseStates}
                onChange={(e) => setLicenseStates(e.target.value)}
                placeholder="TX, LA, MS"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-comp-percentage">Comp percentage *</Label>
              <Input
                id="agent-comp-percentage"
                type="number"
                min={50}
                max={200}
                step="0.1"
                value={compPercentage}
                onChange={(event) => {
                  setCompPercentage(event.target.value);
                  if (Number(event.target.value) <= 100) setSamApprovalRequested(false);
                }}
              />
              <p className="text-[11px] text-muted-foreground">50–100% is approved automatically. Default is 60%.</p>
            </div>

            {Number(compPercentage) > 100 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <Checkbox
                  id="agent-comp-sam-approval"
                  checked={samApprovalRequested}
                  onCheckedChange={(value) => setSamApprovalRequested(value === true)}
                />
                <Label htmlFor="agent-comp-sam-approval" className="cursor-pointer text-sm leading-snug">
                  Request approval from Sam. This comp stays pending and emails Sam before it is approved.
                </Label>
              </div>
            ) : null}
          </div> : null}

          {isAdmin ? (
            <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
              <Label className="text-sm font-medium">Builder track</Label>
              <div className="grid grid-cols-3 gap-3">
                {BUILDER_TRACK_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = builderTrack === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setBuilderTrack(option.value)}
                      className="group flex flex-col items-center gap-2 text-center"
                      aria-pressed={selected}
                    >
                      <span
                        className={[
                          "flex h-14 w-14 items-center justify-center rounded-full border transition",
                          selected
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-background text-muted-foreground group-hover:border-primary/60 group-hover:text-foreground",
                        ].join(" ")}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Sam-feedback 2026-06-03: Transfer needed toggle. Off = simple
              4-field add. On = collect carrier transfer info upline cares about. */}
          {licenseStatus === "licensed" ? <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="transferNeeded"
                checked={transferNeeded}
                onCheckedChange={(v) => setTransferNeeded(v === true)}
              />
              <Label htmlFor="transferNeeded" className="text-sm font-medium cursor-pointer">
                Transfer needed (already contracted under another upline)
              </Label>
            </div>
            {transferNeeded ? (
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label htmlFor="carriers" className="text-xs">All carriers (comma-separated)</Label>
                  <Input
                    id="carriers"
                    value={carriers}
                    onChange={(e) => setCarriers(e.target.value)}
                    placeholder="Mutual of Omaha, Americo, Foresters..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="writingNumbers" className="text-xs">Writing numbers</Label>
                  <Input
                    id="writingNumbers"
                    value={writingNumbers}
                    onChange={(e) => setWritingNumbers(e.target.value)}
                    placeholder="MoO: 123456, AM: 987654..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="previousUpline" className="text-xs">Previous upline</Label>
                  <Input
                    id="previousUpline"
                    value={previousUpline}
                    onChange={(e) => setPreviousUpline(e.target.value)}
                    placeholder="Agency / SGA / agent name"
                  />
                </div>
              </div>
            ) : null}
          </div> : null}

          {/* Single primary action — dialog X closes if user wants out. */}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {licenseStatus === "licensed" ? "Adding licensed agent..." : "Adding unlicensed recruit..."}
              </>
            ) : (
              licenseStatus === "licensed" ? "Add Licensed Agent" : "Add Unlicensed Recruit"
            )}
          </Button>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
