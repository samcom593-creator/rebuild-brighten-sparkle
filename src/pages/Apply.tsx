import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { 
  Crown, 
  ArrowLeft, 
  ArrowRight, 
  User, 
  FileText, 
  Briefcase, 
  CheckCircle2,
  Loader2,
  Instagram,
  Heart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATES, AVAILABILITY_OPTIONS, REFERRAL_SOURCES } from "@/lib/constants";
import { CARRIER_OPTIONS } from "@/lib/carrierOptions";
import { track } from "@/lib/analytics";
import { QuickQualifyStep } from "@/pages/apply/QuickQualifyStep";
// S11 fix (2026-06-15): when the landing -> /apply hop dropped `?ref=` from
// the CTA href, fall back to the localStorage relay captured on landing
// mount. Cleared on successful submit so it doesn't leak into a second
// application from the same browser.
import { getRefSlug, clearRefSlug } from "@/lib/refSlug";
import { isDialablePhone, normalizePhoneForDial } from "@/lib/phone";

const applicationSchema = z.object({
  // Step 1: Personal Info
  firstName: z.string().min(2, "First name is required").max(50),
  lastName: z.string().min(2, "Last name is required").max(50),
  email: z.string().email("Valid email is required"),
  phone: z
    .string()
    .trim()
    .max(32)
    .refine(isDialablePhone, "Enter a valid US number or an international number with country code"),
  city: z.string().min(2, "City is required").max(100),
  state: z.string().min(2, "State is required"),
  instagramHandle: z.string().max(50).optional(),
  carrier: z.string().max(20).optional(),

  // Step 2: Experience
  hasInsuranceExperience: z.boolean().default(false),
  yearsExperience: z.preprocess(
    (v) => (v === "" || v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? undefined : Number(v)),
    z.number().min(0).max(50).optional(),
  ),
  previousCompany: z.string().max(100).optional(),
  numberOfDownlines: z.preprocess(
    (v) => (v === "" || v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? undefined : Number(v)),
    z.number().min(0).optional(),
  ),
  
  // Step 3: Licensing
  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional(),
  licensedStates: z.array(z.string()).optional(),
  
  // Step 4: Goals
  availability: z.string().min(1, "Please select your availability"),
  referralSource: z.string().optional(),
  whyJoin: z.string().optional(),
  motivation: z.string().min(25, "Please share your motivation (minimum 25 characters)"),
  
  // Communication Consent — both opt-in (was required for SMS until 2026-05-24;
  // hard-required SMS consent killed an estimated 4-6% of submissions for
  // negligible deliverability gain. We already have phone + email, so SMS is
  // additive, not gating. Users see the checkbox; unchecked is fine.)
  smsConsent: z.boolean().default(false),
  emailConsent: z.boolean().default(false),
});

const quickQualifySchema = applicationSchema.pick({
  firstName: true,
  email: true,
  phone: true,
  licenseStatus: true,
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface ActiveAgent {
  id: string;
  name: string;
  instagramHandle?: string;
  avatarUrl?: string | null;
}

// Compact circular avatar for the referral picker (PL-006: "add circles of
// our faces"). Falls back to initials when no photo is uploaded.
function ManagerAvatar({ name, src }: { name: string; src?: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="h-7 w-7 rounded-full overflow-hidden bg-white dark:bg-slate-900 ring-1 ring-primary/40 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </span>
  );
}

const steps = [
  { id: 1, title: "Personal Info", icon: User },
  { id: 2, title: "Experience", icon: Briefcase },
  { id: 3, title: "Licensing", icon: FileText },
  { id: 4, title: "Goals", icon: CheckCircle2 },
];

export default function Apply() {
  usePageTitle("Apply to APEX Financial · Insurance Career Pathway");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // S11 fix: prefer URL ?ref= when present, fall back to the localStorage
  // relay set by Index.tsx on landing mount. getRefSlug() handles validation
  // + TTL expiry + SSR safety internally.
  const refSlug = getRefSlug(searchParams.get("ref"));
  const sourceParam = searchParams.get("source")?.trim().toLowerCase() ?? "";
  const utmMediumParam = searchParams.get("utm_medium")?.trim().toLowerCase() ?? "";
  const isQuickQualifyTraffic = sourceParam === "ad" || utmMediumParam === "paid_social";
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const activeSteps = isQuickQualifyTraffic
    ? [{ id: 1, title: "Quick Qualify", icon: User }, ...steps.map((step) => ({ ...step, id: step.id + 1 }))]
    : steps;
  const visibleFormStep = isQuickQualifyTraffic ? currentStep - 1 : currentStep;
  const [isSubmitting, setIsSubmitting] = useState(false);
  // VSL gate fully removed — no video, no gate, no placeholder state.
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [selectedReferrer, setSelectedReferrer] = useState<string>("");
  const [customReferrer, setCustomReferrer] = useState("");
  
  const [smsConsentError, setSmsConsentError] = useState(false);
  const smsConsentRef = useRef<HTMLDivElement>(null);
  const isSubmittedRef = useRef(false);
  const STORAGE_KEY_FORM = "apex_apply_form";
  const STORAGE_KEY_STEP = isQuickQualifyTraffic ? "apex_apply_step_quick" : "apex_apply_step";
  const STORAGE_KEY_STATES = "apex_apply_states";
  const STORAGE_KEY_QUICK_APP = "apex_apply_quick_application_id";
  const [sessionId] = useState<string>(() => {
    // Generate a unique session ID for partial application tracking
    const stored = sessionStorage.getItem("apex_apply_session");
    if (stored) return stored;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem("apex_apply_session", newId);
    return newId;
  });
  const [quickApplicationId, setQuickApplicationId] = useState<string | null>(() => {
    if (!isQuickQualifyTraffic) return null;
    return sessionStorage.getItem(STORAGE_KEY_QUICK_APP);
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<ApplicationFormData>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      hasInsuranceExperience: false,
      licenseStatus: "unlicensed",
      licensedStates: [],
      smsConsent: false,
      emailConsent: false,
    },
  });

  // Restore form data from sessionStorage on mount
  useEffect(() => {
    try {
      const savedStep = sessionStorage.getItem(STORAGE_KEY_STEP);
      if (savedStep) {
        const step = parseInt(savedStep, 10);
        if (step >= 1 && step <= activeSteps.length) setCurrentStep(step);
      }

      const savedStates = sessionStorage.getItem(STORAGE_KEY_STATES);
      if (savedStates) {
        setSelectedStates(JSON.parse(savedStates));
      }

      const savedForm = sessionStorage.getItem(STORAGE_KEY_FORM);
      if (savedForm) {
        const parsed = JSON.parse(savedForm);
        Object.entries(parsed).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            setValue(key as keyof ApplicationFormData, value as any);
          }
        });
      }
    } catch (e) {
      console.error("Error restoring form data:", e);
    }
  }, [STORAGE_KEY_STEP, activeSteps.length, setValue]);

  // Persist form data to sessionStorage (debounced)
  useEffect(() => {
    const subscription = watch((value) => {
      if (isSubmittedRef.current) return;
      const timeout = setTimeout(() => {
        try {
          sessionStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(value));
        } catch (e) { /* ignore */ } // empty-catch-allow:localstorage-incognito
      }, 300);
      return () => clearTimeout(timeout);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  // Persist currentStep
  useEffect(() => {
    if (!isSubmittedRef.current && currentStep <= activeSteps.length) {
      sessionStorage.setItem(STORAGE_KEY_STEP, String(currentStep));
    }
  }, [STORAGE_KEY_STEP, activeSteps.length, currentStep]);

  // Persist selectedStates
  useEffect(() => {
    if (!isSubmittedRef.current) {
      sessionStorage.setItem(STORAGE_KEY_STATES, JSON.stringify(selectedStates));
    }
  }, [selectedStates]);

  // Warn on page unload if form has progress
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isSubmittedRef.current || currentStep >= activeSteps.length) return;
      const values = getValues();
      if (values.firstName || values.email || values.phone) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeSteps.length, currentStep, getValues]);

  // Auto-save partial application after Step 1 is completed
  const savePartialApplication = async (stepCompleted: number, quickIdOverride?: string | null) => {
    try {
      const values = getValues();
      
      // Only save if we have at least email or phone
      if (!values.email && !values.phone) return;

      const partialData = {
        session_id: sessionId,
        email: values.email || null,
        phone: normalizePhoneForDial(values.phone),
        first_name: values.firstName || null,
        last_name: values.lastName || null,
        city: values.city || null,
        state: values.state || null,
        step_completed: stepCompleted,
        form_data: {
          hasInsuranceExperience: values.hasInsuranceExperience,
          yearsExperience: values.yearsExperience,
          previousCompany: values.previousCompany,
          licenseStatus: values.licenseStatus,
          instagramHandle: values.instagramHandle,
          availability: values.availability,
          quickQualifiedApplicationId: quickIdOverride ?? quickApplicationId ?? null,
          source: searchParams.get("source") || null,
          utmSource: searchParams.get("utm_source") || null,
          utmMedium: searchParams.get("utm_medium") || null,
          utmCampaign: searchParams.get("utm_campaign") || null,
          utmContent: searchParams.get("utm_content") || null,
          utmTerm: searchParams.get("utm_term") || null,
          landingUrl: window.location.pathname,
        },
        user_agent: navigator.userAgent,
      };

      // 2026-07-29: this used to upsert directly into partial_applications with
      // onConflict:"session_id". It had been failing silently for months — the table held
      // 4 rows, newest 2026-05-19, while applications kept arriving daily. Every abandoned
      // application in that window, people who typed an email and phone then dropped off,
      // was lost.
      //
      // Reproduced against the live API with the anon key:
      //   plain INSERT                          -> 201
      //   upsert (resolution=merge-duplicates)  -> 401, 42501 RLS violation
      // anon may INSERT and UPDATE, but has NO SELECT policy, and ON CONFLICT DO UPDATE has
      // to read the conflicting row. Granting anon SELECT was not an option: this table
      // holds the email and phone of every partial lead.
      //
      // Now goes through a SECURITY DEFINER RPC, which needs no SELECT grant and returns
      // nothing to the caller.
      const { error } = await (supabase.rpc as any)("save_partial_application", {
        p_session_id: sessionId,
        p_email: partialData.email,
        p_phone: partialData.phone,
        p_first_name: partialData.first_name,
        p_last_name: partialData.last_name,
        p_city: partialData.city,
        p_state: partialData.state,
        p_step_completed: partialData.step_completed,
        p_form_data: partialData.form_data,
        p_user_agent: partialData.user_agent,
      });

      if (error) {
        console.error("Error saving partial application:", error);
      }
    } catch (err) {
      console.error("Error in savePartialApplication:", err);
    }
  };

  // Mark partial application as converted when full submission succeeds
  const markAsConverted = async () => {
    try {
      await supabase
        .from("partial_applications")
        .update({ converted_at: new Date().toISOString() })
        .eq("session_id", sessionId);
      
      // Clear all session storage
      isSubmittedRef.current = true;
      sessionStorage.removeItem("apex_apply_session");
      sessionStorage.removeItem(STORAGE_KEY_FORM);
      sessionStorage.removeItem(STORAGE_KEY_STEP);
      sessionStorage.removeItem(STORAGE_KEY_STATES);
      sessionStorage.removeItem(STORAGE_KEY_QUICK_APP);
      // S11 fix: the referral relay has served its purpose now that the
      // application landed with the right recruiter credited. Clearing here
      // keeps a follow-up application from the same browser from inheriting
      // an old slug.
      clearRefSlug();
    } catch (err) {
      console.error("Error marking as converted:", err);
    }
  };

  const hasExperience = watch("hasInsuranceExperience");
  const licenseStatus = watch("licenseStatus");

  // Live trust-ribbon numbers (carriers + active agents). Pulled from the same
  // landing_live_stats() RPC the LiveStatsCounterStrip + CTASection use so the
  // ribbon can never silently drift past the roster — fake-success killer.
  const { data: liveStats } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<{ active_agents: number; carriers_partnered: number } | null> => {
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as { active_agents: number; carriers_partnered: number };
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  // wave-88 (2026-06-13): truth-floor sync with LiveStatsCounterStrip (95 → 104).
  const liveActiveAgents = liveStats?.active_agents ?? 104;
  const liveCarriers = liveStats?.carriers_partnered ?? 22;

  // Fetch only active MANAGERS for referral selection via edge function (bypasses RLS for public access)
  useEffect(() => {
    const fetchActiveManagers = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-active-managers");

        if (error) {
          console.error("Error fetching managers:", error);
          return;
        }

        if (data?.managers && Array.isArray(data.managers)) {
          setActiveAgents(data.managers);
        }
      } catch (error) {
        console.error("Error fetching managers:", error);
      }
    };

    fetchActiveManagers();
  }, []);

  // Capture ?ref= referral slug from URL. RLS denies anon reads on `agents`,
  // so we resolve via a service-role edge function instead of querying the
  // table client-side (prior direct query returned null silently for every
  // public visitor — credits went to no one).
  useEffect(() => {
    if (!refSlug) return;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("resolve-ref-slug", {
          body: { slug: refSlug },
        });
        if (error) {
          console.error("[Apply] resolve-ref-slug invoke error:", error);
          return;
        }
        const payload = data as { resolved?: boolean; agent_id?: string; display_name?: string };
        if (payload?.resolved && payload.agent_id) {
          setReferrerId(payload.agent_id);
          setReferrerName(payload.display_name ?? "");
          setSelectedReferrer(payload.agent_id);
          toast.success(
            payload.display_name
              ? `Referred by ${payload.display_name} — we'll credit them.`
              : "Referral link detected!",
          );
        } else {

        }
      } catch (err) {
        console.error("[Apply] ref_slug resolve failed:", err);
      }
    })();
  }, [refSlug]);

  const validateStep = async (step: number): Promise<boolean> => {
    let fieldsToValidate: (keyof ApplicationFormData)[] = [];
    
    switch (step) {
      case 1:
        fieldsToValidate = ["firstName", "lastName", "email", "phone", "city", "state"];
        break;
      case 2:
        fieldsToValidate = ["hasInsuranceExperience"];
        break;
      case 3:
        fieldsToValidate = ["licenseStatus"];
        break;
      case 4:
        // v26 audit fix: smsConsent removed from validation — schema makes
        // it optional (line 80: z.boolean().default(false)), label now
        // says "(optional)". Was a UI/schema contradiction (asterisk +
        // validation + always-pass schema).
        fieldsToValidate = ["availability", "motivation"];
        break;
    }
    
    return await trigger(fieldsToValidate);
  };

  const getTrafficPayload = () => ({
    source: searchParams.get("source") || null,
    utmSource: searchParams.get("utm_source") || null,
    utmMedium: searchParams.get("utm_medium") || null,
    utmCampaign: searchParams.get("utm_campaign") || null,
    utmContent: searchParams.get("utm_content") || null,
    utmTerm: searchParams.get("utm_term") || null,
    landingUrl: window.location.pathname,
  });

  const submitQuickQualify = async () => {
    const values = getValues();
    const parsed = quickQualifySchema.safeParse(values);

    if (!parsed.success) {
      await trigger(["firstName", "email", "phone", "licenseStatus"]);
      toast.error("Please fill in the quick qualify fields before continuing");
      return;
    }

    setIsSubmitting(true);

    try {
      const traffic = getTrafficPayload();
      const { data: submitResult, error } = await supabase.functions.invoke(
        "submit-application",
        {
          body: {
            quickQualify: true,
            firstName: parsed.data.firstName,
            email: parsed.data.email,
            phone: normalizePhoneForDial(parsed.data.phone),
            licenseStatus: parsed.data.licenseStatus === "pending" ? "unlicensed" : parsed.data.licenseStatus,
            recruiterId:
              referrerId ??
              (selectedReferrer && selectedReferrer !== "none" && selectedReferrer !== "other" && selectedReferrer !== ""
                ? selectedReferrer
                : null),
            selectedReferralAgentId:
              referrerId ??
              (selectedReferrer && selectedReferrer !== "none" && selectedReferrer !== "other" && selectedReferrer !== ""
                ? selectedReferrer
                : null),
            consent: {
              smsConsentGiven: false,
              emailConsentGiven: false,
              consentTimestampUtc: new Date().toISOString(),
              sourceUrl: window.location.href,
              userAgent: navigator.userAgent,
              formVersion: "apply_quick_qualify_v1",
            },
            ...traffic,
          },
        },
      );

      if (error) throw error;
      if (!submitResult?.applicationId) throw new Error("Missing application id");

      setQuickApplicationId(submitResult.applicationId);
      sessionStorage.setItem(STORAGE_KEY_QUICK_APP, submitResult.applicationId);
      await savePartialApplication(1, submitResult.applicationId);

      track("apply_quick_qualified", {
        application_id: submitResult.applicationId,
        source: traffic.source,
        utm_source: traffic.utmSource,
        utm_medium: traffic.utmMedium,
        utm_campaign: traffic.utmCampaign,
        utm_content: traffic.utmContent,
        utm_term: traffic.utmTerm,
        landing_url: traffic.landingUrl,
      });

      toast.success("You're qualified. Finish the full application when you're ready.");
      setCurrentStep(2);
    } catch (error: any) {
      console.error("Error quick-qualifying application:", error);

      if (error?.context && typeof error.context.json === "function") {
        try {
          const body = await error.context.json();
          toast.error(body?.error || "Could not save your quick application. Please try again.", { duration: 5000 });
        } catch (_) {
          toast.error("Could not save your quick application. Please try again.", { duration: 5000 });
        }
      } else {
        toast.error("Could not save your quick application. Please try again.", { duration: 5000 });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = async () => {
    if (isQuickQualifyTraffic && currentStep === 1) {
      await submitQuickQualify();
      return;
    }

    const formStep = isQuickQualifyTraffic ? currentStep - 1 : currentStep;
    const isValid = await validateStep(formStep);
    if (!isValid) {
      toast.error("Please fill in all required fields before continuing");
      return;
    }
    
    // Auto-save partial application after each step.
    if (formStep >= 1 && formStep <= steps.length) {
      savePartialApplication(formStep);
    }
    
    if (currentStep < activeSteps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const onSubmit = async (data: ApplicationFormData) => {
    setIsSubmitting(true);
    
    try {
      // Clean Instagram handle
      let instagramHandle = data.instagramHandle?.trim() || null;
      if (instagramHandle && instagramHandle.startsWith("@")) {
        instagramHandle = instagramHandle.substring(1);
      }

      const yearsExperience = Number.isFinite(data.yearsExperience as number)
        ? (data.yearsExperience as number)
        : undefined;

      const numberOfDownlines = Number.isFinite(data.numberOfDownlines as number)
        ? (data.numberOfDownlines as number)
        : undefined;

      // Capture consent disclosure text
      const smsConsentText = document.getElementById("smsConsentDisclosure")?.textContent?.trim() || "";
      const emailConsentText = document.getElementById("emailConsentDisclosure")?.textContent?.trim() || "";

      const { data: submitResult, error } = await supabase.functions.invoke(
        "submit-application",
        {
          body: {
            quickQualifiedApplicationId: quickApplicationId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: normalizePhoneForDial(data.phone),
            city: data.city,
            state: data.state,
            instagramHandle,
            carrier: data.carrier || null,

            hasInsuranceExperience: data.hasInsuranceExperience,
            yearsExperience,
            previousCompany: data.previousCompany,
            numberOfDownlines,

            licenseStatus: data.licenseStatus,
            niprNumber: data.niprNumber,
            licensedStates: selectedStates,

            availability: data.availability,
            referralSource: data.referralSource,
            customReferrer:
              selectedReferrer === "other" && customReferrer.trim()
                ? customReferrer.trim()
                : null,

            // Referral attribution.
            // 1. Prefer the ?ref= URL slug (referrerId resolved server-side).
            // 2. Otherwise use the Step 4 in-form agent picker. "none" and
            //    "other" are non-agent selections, so we only pass through
            //    real agent UUIDs.
            recruiterId:
              referrerId ??
              (selectedReferrer && selectedReferrer !== "none" && selectedReferrer !== "other" && selectedReferrer !== ""
                ? selectedReferrer
                : null),
            selectedReferralAgentId:
              referrerId ??
              (selectedReferrer && selectedReferrer !== "none" && selectedReferrer !== "other" && selectedReferrer !== ""
                ? selectedReferrer
                : null),

            // Consent data for Twilio compliance
            consent: {
              smsConsentGiven: data.smsConsent,
              smsConsentText,
              emailConsentGiven: data.emailConsent,
              emailConsentText,
              consentTimestampUtc: new Date().toISOString(),
              sourceUrl: window.location.href,
              userAgent: navigator.userAgent,
              formVersion: "apply_v2.0",
            },
            ...getTrafficPayload(),
          },
        },
      );

      if (error) throw error;
      if (!submitResult?.applicationId) throw new Error("Missing application id");

      // Mark partial application as converted
      await markAsConverted();

      // Email notifications are now handled by submit-application function
      // No need to call send-application-notification separately

      toast.success("Application submitted. Routing you to your next step...");

      // Referral credit is captured before submit, so there is no second
      // post-submit referral gate to block the applicant.
      const aidQuery = `?aid=${encodeURIComponent(submitResult.applicationId)}`;
      if (data.licenseStatus === "licensed") {
        navigate(`/apply/success/licensed${aidQuery}`);
      } else {
        navigate(`/apply/success/unlicensed${aidQuery}`);
      }
    } catch (error: any) {
      console.error("Error submitting application:", error);
      
      // Handle FunctionsHttpError: error.context is a Response object
      if (error?.context && typeof error.context.json === 'function' && typeof error.context.status === 'number') {
        const status = error.context.status;
        try {
          const body = await error.context.json();
          if (body?.details && Array.isArray(body.details)) {
            const fields = body.details.map((d: any) => d.path?.join?.(".") || d.message).filter(Boolean);
            toast.error(`Please fix these fields: ${fields.join(", ")}`, { duration: 6000 });
          } else {
            toast.error(body?.error || "Failed to submit application. Please try again.", { duration: 5000 });
          }
        } catch (_) {
          {
            toast.error("Failed to submit application. Please check your connection and try again.", { duration: 5000 });
          }
        }
        return;
      }
      
      // Generic / network errors
      const errorMessage = error?.message?.toLowerCase() || "";
      if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
        toast.error("Network error. Please check your connection and try again.", { duration: 5000 });
      } else {
        toast.error("Failed to submit application. Please check your connection and try again.", { duration: 5000 });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleState = (stateValue: string) => {
    setSelectedStates(prev => 
      prev.includes(stateValue) 
        ? prev.filter(s => s !== stateValue)
        : [...prev, stateValue]
    );
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background ops-surface ops-fade-in">
      {/* v26 audit fix: triple-stacked header collapsed into ONE bar.
          Was: live ribbon (40px) + glass-strong header (64px) + (founder
          credit rendered elsewhere). Now: single 56px bar with brand on
          left + live stats inline + Back-to-Home on right. */}
      <header className="border-b border-border bg-white dark:bg-slate-900">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2">
              <Crown className="h-7 w-7 text-primary" />
              <span className="text-lg font-bold">APEX Financial</span>
            </Link>
            <div className="hidden md:flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] font-display font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 dark:text-emerald-300">Headhunters live</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-foreground/80">{liveCarriers} carriers · {liveActiveAgents} active</span>
            </div>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Home</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-full px-4 py-12">
        <div className="w-full max-w-3xl mx-auto">
          {/* Founder credit — Brand Bible: "the face IS the brand". Trust signal
              on the conversion page, just under the page header. */}
          <div className="flex items-start sm:items-center justify-start sm:justify-center gap-3 mb-10 max-w-full">
            <img
              src="https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/avatars/4491dc82-a056-4fb3-ab38-b132afffb700/avatar-1777285677901.jpg"
              alt="Samuel James, Founder of APEX Financial"
              loading="lazy"
              className="h-12 w-12 shrink-0 rounded-full ring-2 ring-primary/40 object-cover "
            />
            <div className="text-left min-w-0">
              <p className="text-sm font-bold leading-tight">You're applying directly to Samuel James</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.08em] sm:tracking-wider leading-snug">
                <span className="block">Founder · $120K/mo producer</span>
                <span className="block">Every application reviewed personally</span>
              </p>
            </div>
          </div>
          {/* Progress Steps */}
          <>
          <div className="mb-12">
            <div className="flex items-center justify-between relative">
              <div className="absolute top-5 left-0 right-0 h-0.5 bg-border" />
              <div 
                className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-500"
                style={{ width: `${((currentStep - 1) / (activeSteps.length - 1)) * 100}%` }}
              />
              
              {activeSteps.map((step) => (
                <div key={step.id} className="relative z-10 flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                      currentStep >= step.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <step.icon className="h-5 w-5" />
                  </div>
                  <span className={`text-xs mt-2 font-medium hidden sm:block ${
                    currentStep >= step.id ? "text-foreground" : "text-muted-foreground"
                  }`}>
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
            {/* Mobile step label */}
            <p className="text-center text-sm text-muted-foreground mt-3 sm:hidden">
              Step {currentStep} of {activeSteps.length}: {activeSteps[currentStep - 1]?.title}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <GlassCard className="p-4 sm:p-8">
                  {isQuickQualifyTraffic && currentStep === 1 && (
                    <QuickQualifyStep
                      firstNameInput={register("firstName")}
                      emailInput={register("email")}
                      phoneInput={register("phone")}
                      firstNameError={errors.firstName}
                      emailError={errors.email}
                      phoneError={errors.phone}
                      licenseStatus={licenseStatus}
                      onLicenseStatusChange={(value) => setValue("licenseStatus", value, { shouldValidate: true })}
                    />
                  )}

                  {/* Step 1: Personal Info */}
                  {visibleFormStep === 1 && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-2">Personal Information</h2>
                        <p className="text-muted-foreground">Tell us a bit about yourself.</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name *</Label>
                          <Input
                            id="firstName"
                            {...register("firstName")}
                            placeholder="John"
                            className="bg-input"
                          />
                          {errors.firstName && (
                            <p className="text-sm text-destructive">{errors.firstName.message}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name *</Label>
                          <Input
                            id="lastName"
                            {...register("lastName")}
                            placeholder="Smith"
                            className="bg-input"
                          />
                          {errors.lastName && (
                            <p className="text-sm text-destructive">{errors.lastName.message}</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address *</Label>
                        <Input
                          id="email"
                          type="email"
                          {...register("email")}
                          placeholder="john@example.com"
                          className="bg-input"
                        />
                        {errors.email && (
                          <p className="text-sm text-destructive">{errors.email.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number *</Label>
                        <Input
                          id="phone"
                          type="tel"
                          {...register("phone")}
                          placeholder="(555) 123-4567"
                          className="bg-input"
                        />
                        {errors.phone && (
                          <p className="text-sm text-destructive">{errors.phone.message}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="city">City *</Label>
                          <Input
                            id="city"
                            {...register("city")}
                            placeholder="Atlanta"
                            className="bg-input"
                          />
                          {errors.city && (
                            <p className="text-sm text-destructive">{errors.city.message}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="state">State *</Label>
                          <Select value={watch("state") || undefined} onValueChange={(value) => setValue("state", value, { shouldValidate: true })}>
                            <SelectTrigger className="bg-input">
                              <SelectValue placeholder="Select state" />
                            </SelectTrigger>
                            <SelectContent>
                              {US_STATES.map((state) => (
                                <SelectItem key={state.value} value={state.value}>
                                  {state.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {errors.state && (
                            <p className="text-sm text-destructive">{errors.state.message}</p>
                          )}
                        </div>
                      </div>

                      {/* Instagram Handle Field */}
                      <div className="space-y-2">
                        <Label htmlFor="instagramHandle" className="flex items-center gap-2">
                          <Instagram className="h-4 w-4 text-primary" />
                          Instagram Handle (optional)
                        </Label>
                        <Input
                          id="instagramHandle"
                          {...register("instagramHandle")}
                          placeholder="@yourhandle"
                          className="bg-input"
                        />
                        <p className="text-xs text-muted-foreground">
                          We may reach out via Instagram for faster communication
                        </p>
                      </div>

                      {/* Mobile Carrier Field */}
                      <div className="space-y-2">
                        <Label htmlFor="carrier">Mobile Carrier (optional)</Label>
                        <Select
                          value={watch("carrier") || undefined}
                          onValueChange={(value) => setValue("carrier", value)}
                        >
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select your carrier" />
                          </SelectTrigger>
                          <SelectContent>
                            {CARRIER_OPTIONS.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Helps us send you text alerts about your application status
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Experience */}
                  {visibleFormStep === 2 && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-2">Your Experience</h2>
                        <p className="text-muted-foreground">No experience? No problem! We train everyone.</p>
                      </div>

                      <div className="flex items-center space-x-3 p-4 rounded-lg border border-border">
                        <Checkbox
                          id="hasExperience"
                          checked={hasExperience}
                          onCheckedChange={(checked) => setValue("hasInsuranceExperience", checked === true)}
                        />
                        <Label htmlFor="hasExperience" className="cursor-pointer">
                          I have previous insurance industry experience
                        </Label>
                      </div>

                      {hasExperience && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="space-y-4"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="yearsExperience">Years of Experience</Label>
                              <Input
                                id="yearsExperience"
                                type="number"
                                step="1"
                                min="0"
                                {...register("yearsExperience", { valueAsNumber: true })}
                                placeholder="0"
                                className="bg-input"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="previousCompany">Previous Company</Label>
                              <Input
                                id="previousCompany"
                                {...register("previousCompany")}
                                placeholder="Company name"
                                className="bg-input"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="numberOfDownlines">Number of Downlines (if any)</Label>
                            <Input
                              id="numberOfDownlines"
                              type="number"
                              {...register("numberOfDownlines", { valueAsNumber: true })}
                              placeholder="0"
                              className="bg-input"
                            />
                          </div>
                        </motion.div>
                      )}

                      {!hasExperience && (
                        <div className="p-6 rounded-lg bg-primary/10 border border-primary/20">
                          <h3 className="font-semibold text-primary mb-2">Great news!</h3>
                          <p className="text-sm text-muted-foreground">
                            Half our top producers walked in with zero insurance experience. We hand you the scripts,
                            the carriers, the leads, and the coaching. Most new agents close their first deal inside
                            two weeks of training.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Licensing */}
                  {visibleFormStep === 3 && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-2">Licensing Status</h2>
                        <p className="text-muted-foreground">We help unlicensed candidates get their license.</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Current License Status *</Label>
                        <Select 
                          value={licenseStatus}
                          onValueChange={(value: "licensed" | "unlicensed" | "pending") => setValue("licenseStatus", value)}
                        >
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="licensed">Currently Licensed</SelectItem>
                            <SelectItem value="pending">License Pending</SelectItem>
                            <SelectItem value="unlicensed">Not Yet Licensed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {licenseStatus === "licensed" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="space-y-4"
                        >
                          <div className="space-y-2">
                            <Label htmlFor="niprNumber">NIPR Number (optional)</Label>
                            <Input
                              id="niprNumber"
                              {...register("niprNumber")}
                              placeholder="Your NIPR number"
                              className="bg-input"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Licensed States (select all that apply)</Label>
                            <div className="grid grid-cols-4 md:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-2 rounded-lg border border-border">
                              {US_STATES.map((state) => (
                                <button
                                  key={state.value}
                                  type="button"
                                  onClick={() => toggleState(state.value)}
                                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                                    selectedStates.includes(state.value)
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted hover:bg-muted/80"
                                  }`}
                                >
                                  {state.value}
                                </button>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {licenseStatus === "unlicensed" && (
                        <div className="p-6 rounded-lg bg-primary/10 border border-primary/20">
                          <h3 className="font-semibold text-primary mb-2">Not licensed yet? Doesn't matter.</h3>
                          <p className="text-sm text-muted-foreground">
                            APEX pays for your study materials and exam prep. We reimburse your licensing fees
                            once you're contracted. Most candidates are licensed inside 2–3 weeks.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                   {/* Step 4: Goals */}
                  {visibleFormStep === 4 && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-2">Your Goals</h2>
                        <p className="text-muted-foreground">Help us understand what you're looking for.</p>
                      </div>

                      {/* SMS Consent Error Banner */}
                      {smsConsentError && (
                        <div className="p-4 rounded-md border border-destructive/30 bg-destructive/10 text-destructive">
                          <p className="font-semibold text-sm">⚠️ SMS Consent Required</p>
                          <p className="text-xs mt-1">Please scroll down and check the SMS consent checkbox to submit your application.</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label>Availability *</Label>
                        <Select value={watch("availability") || undefined} onValueChange={(value) => setValue("availability", value, { shouldValidate: true })}>
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select availability" />
                          </SelectTrigger>
                          <SelectContent>
                            {AVAILABILITY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.availability && (
                          <p className="text-sm text-destructive">{errors.availability.message}</p>
                        )}
                      </div>

                      {/* Motivation - Required */}
                      <div className="space-y-2">
                        <Label htmlFor="motivation" className="flex items-center gap-2">
                          <Heart className="h-4 w-4 text-primary" />
                          What motivates you to join APEX? *
                        </Label>
                        <Textarea
                          id="motivation"
                          {...register("motivation")}
                          placeholder="Tell us what drives you — your goals, your why, what excites you about this opportunity... (minimum 25 characters)"
                          className="bg-input min-h-[100px]"
                        />
                        {errors.motivation && (
                          <p className="text-sm text-destructive">{(errors.motivation as any).message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>
                          {referrerName
                            ? `Referred by ${referrerName} ✓`
                            : "Where did you find APEX? (optional)"}
                        </Label>
                        <Select value={watch("referralSource") || undefined} onValueChange={(value) => setValue("referralSource", value, { shouldValidate: true })}>
                          <SelectTrigger className="bg-input">
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                          <SelectContent>
                            {REFERRAL_SOURCES.map((source) => (
                              <SelectItem key={source.value} value={source.value}>
                                {source.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Agent picker — asked BEFORE submit so the writing
                          agent gets credited at application creation, not
                          retroactively. Hidden when the ?ref= URL already
                          identified the referrer. */}
                      {!referrerId && (
                        <div className="space-y-2">
                          <Label>Which APEX agent should get credit?</Label>
                          <Select
                            value={selectedReferrer}
                            onValueChange={setSelectedReferrer}
                          >
                            <SelectTrigger className="bg-input">
                              <SelectValue placeholder="Choose an agent (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">I found APEX on my own</SelectItem>
                              {activeAgents.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                  <div className="flex items-center gap-2 py-0.5">
                                    <ManagerAvatar name={agent.name} src={agent.avatarUrl ?? null} />
                                    <span className="font-medium">{agent.name}</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/30 text-primary">Manager</Badge>
                                    {agent.instagramHandle && (
                                      <span className="text-xs text-muted-foreground">@{agent.instagramHandle}</span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                              <SelectItem value="other">Someone else not listed</SelectItem>
                            </SelectContent>
                          </Select>
                          {selectedReferrer === "other" && (
                            <Input
                              value={customReferrer}
                              onChange={(e) => setCustomReferrer(e.target.value)}
                              placeholder="Enter their name"
                              className="bg-input mt-2"
                            />
                          )}
                          <p className="text-xs text-muted-foreground">
                            We lock this in before submission so the right leader gets credit immediately.
                          </p>
                        </div>
                      )}

                      {/* Communication Consent Section */}
                      <div className="p-6 rounded-lg border border-border bg-muted/30 space-y-5">
                        <h3 className="font-semibold text-foreground">Communication Consent</h3>
                        
                        {/* SMS Consent */}
                        <div ref={smsConsentRef} className="space-y-3">
                          <p id="smsConsentDisclosure" className="text-sm text-muted-foreground leading-relaxed">
                            By checking the box below, you agree to receive SMS/text messages from{" "}
                            <strong className="text-foreground">Apex Financial</strong> at the number you provide 
                            regarding application updates, onboarding steps, training instructions, and support. 
                            Message frequency varies. Message & data rates may apply. Reply STOP to cancel, HELP for help. 
                            Consent is not a condition of purchase.
                          </p>
                          <div className="flex items-start gap-3">
                            <Checkbox
                              id="smsConsent"
                              checked={watch("smsConsent") || false}
                              onCheckedChange={(checked) => 
                                setValue("smsConsent", checked === true, { shouldValidate: true })
                              }
                              className="mt-0.5"
                            />
                            <Label htmlFor="smsConsent" className="text-sm text-foreground cursor-pointer leading-relaxed font-medium">
                              I agree to receive SMS/text messages from Apex Financial. <span className="text-muted-foreground font-normal">(optional)</span>
                            </Label>
                          </div>
                          {errors.smsConsent && (
                            <p className="text-sm text-destructive">{errors.smsConsent.message}</p>
                          )}
                        </div>

                        {/* Email Consent */}
                        <div className="space-y-3 pt-2 border-t border-border">
                          <p id="emailConsentDisclosure" className="text-sm text-muted-foreground leading-relaxed">
                            By checking the box below, you agree to receive emails from{" "}
                            <strong className="text-foreground">Apex Financial</strong> regarding 
                            application updates and onboarding.
                          </p>
                          <div className="flex items-start gap-3">
                            <Checkbox
                              id="emailConsent"
                              checked={watch("emailConsent") || false}
                              onCheckedChange={(checked) => 
                                setValue("emailConsent", checked === true)
                              }
                              className="mt-0.5"
                            />
                            <Label htmlFor="emailConsent" className="text-sm text-foreground cursor-pointer leading-relaxed font-medium">
                              I agree to receive emails from Apex Financial.
                            </Label>
                          </div>
                        </div>

                        {/* Policy Links */}
                        <div className="flex items-center gap-3 pt-2 border-t border-border text-sm">
                          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
                          <span className="text-muted-foreground">|</span>
                          <Link to="/terms" className="text-primary hover:underline">Terms & Conditions</Link>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Navigation Buttons */}
                  <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
                    {currentStep > 1 && currentStep <= activeSteps.length ? (
                      <GradientButton
                        type="button"
                        variant="outline"
                        onClick={prevStep}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Previous
                      </GradientButton>
                    ) : (
                      <div />
                    )}

                    {currentStep < activeSteps.length ? (
                      <GradientButton type="button" onClick={nextStep} disabled={isSubmitting}>
                        {isSubmitting && currentStep === 1 && isQuickQualifyTraffic ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            {isQuickQualifyTraffic && currentStep === 1 ? "Continue" : "Next Step"}
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </GradientButton>
                    ) : (
                      <GradientButton
                        type="button"
                        disabled={isSubmitting}
                        onClick={async () => {
                          const step4Valid = await validateStep(4);
                          if (!step4Valid) {
                            // Check specifically for SMS consent
                            const smsValue = getValues("smsConsent");
                            if (!smsValue) {
                              setSmsConsentError(true);
                              smsConsentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                              toast.error("Please scroll down and check the SMS consent box to continue.", { duration: 6000 });
                            } else {
                              toast.error("Please select your availability to continue.");
                            }
                            return;
                          }
                          setSmsConsentError(false);
                          handleSubmit(onSubmit, (validationErrors) => {
                            const fieldNames = Object.keys(validationErrors);
                            toast.error(`Please go back and fix: ${fieldNames.join(", ")}`, { duration: 6000 });
                          })();
                        }}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          <>
                            Continue Application
                            <CheckCircle2 className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </GradientButton>
                    )}
                  </div>
                </GlassCard>
              </motion.div>
            </AnimatePresence>
          </form>
          </>
        </div>
      </main>
    </div>
  );
}
