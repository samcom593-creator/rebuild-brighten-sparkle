import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  Users,
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

const applicationSchema = z.object({
  // Step 1: Personal Info
  firstName: z.string().min(2, "First name is required").max(50),
  lastName: z.string().min(2, "Last name is required").max(50),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required").max(20),
  city: z.string().min(2, "City is required").max(100),
  state: z.string().min(2, "State is required"),
  instagramHandle: z.string().max(50).optional(),
  
  // Step 2: Experience
  hasInsuranceExperience: z.boolean().default(false),
  yearsExperience: z.number().min(0).max(50).optional(),
  previousCompany: z.string().max(100).optional(),
  numberOfDownlines: z.number().min(0).optional(),
  
  // Step 3: Licensing
  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional(),
  licensedStates: z.array(z.string()).optional(),
  
  // Step 4: Goals
  availability: z.string().min(1, "Please select your availability"),
  referralSource: z.string().optional(),
  whyJoin: z.string().optional(),
  motivation: z.string().min(25, "Please share your motivation (minimum 25 characters)"),
  
  // Communication Consent
  smsConsent: z.boolean().refine(val => val === true, {
    message: "SMS consent is required to receive onboarding steps by text",
  }),
  emailConsent: z.boolean().default(false),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface ActiveAgent {
  id: string;
  name: string;
  instagramHandle?: string;
}

const steps = [
  { id: 1, title: "Personal Info", icon: User },
  { id: 2, title: "Experience", icon: Briefcase },
  { id: 3, title: "Licensing", icon: FileText },
  { id: 4, title: "Goals", icon: CheckCircle2 },
  { id: 5, title: "Referral", icon: Users },
];

export default function Apply() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [selectedReferrer, setSelectedReferrer] = useState<string>("");
  const [customReferrer, setCustomReferrer] = useState("");
  const [savedLicenseStatus, setSavedLicenseStatus] = useState<string>("unlicensed");
  const [showMotivationStep, setShowMotivationStep] = useState(false);
  const [motivationText, setMotivationText] = useState("");
  const [motivationError, setMotivationError] = useState("");
  const [duplicateError, setDuplicateError] = useState(false);
  const [smsConsentError, setSmsConsentError] = useState(false);
  const smsConsentRef = useRef<HTMLDivElement>(null);
  const isSubmittedRef = useRef(false);
  const [sessionId] = useState<string>(() => {
    // Generate a unique session ID for partial application tracking
    const stored = sessionStorage.getItem("apex_apply_session");
    if (stored) return stored;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem("apex_apply_session", newId);
    return newId;
  });

  const STORAGE_KEY_FORM = "apex_apply_form";
  const STORAGE_KEY_STEP = "apex_apply_step";
  const STORAGE_KEY_STATES = "apex_apply_states";

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
        if (step >= 1 && step <= 4) setCurrentStep(step);
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
  }, [setValue]);

  // Persist form data to sessionStorage (debounced)
  useEffect(() => {
    const subscription = watch((value) => {
      if (isSubmittedRef.current) return;
      const timeout = setTimeout(() => {
        try {
          sessionStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(value));
        } catch (e) { /* ignore */ }
      }, 300);
      return () => clearTimeout(timeout);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  // Persist currentStep
  useEffect(() => {
    if (!isSubmittedRef.current && currentStep <= 4) {
      sessionStorage.setItem(STORAGE_KEY_STEP, String(currentStep));
    }
  }, [currentStep]);

  // Persist selectedStates
  useEffect(() => {
    if (!isSubmittedRef.current) {
      sessionStorage.setItem(STORAGE_KEY_STATES, JSON.stringify(selectedStates));
    }
  }, [selectedStates]);

  // Warn on page unload if form has progress
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isSubmittedRef.current || currentStep >= 5) return;
      const values = getValues();
      if (values.firstName || values.email || values.phone) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [currentStep, getValues]);

  // Auto-save partial application after Step 1 is completed
  const savePartialApplication = async (stepCompleted: number) => {
    try {
      const values = getValues();
      
      // Only save if we have at least email or phone
      if (!values.email && !values.phone) return;

      const partialData = {
        session_id: sessionId,
        email: values.email || null,
        phone: values.phone || null,
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
        },
        user_agent: navigator.userAgent,
      };

      // Upsert partial application
      const { error } = await supabase
        .from("partial_applications")
        .upsert(partialData, { 
          onConflict: "session_id",
          ignoreDuplicates: false 
        });

      if (error) {
        console.error("Error saving partial application:", error);
      } else {
        console.log(`Partial application saved at step ${stepCompleted}`);
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
    } catch (err) {
      console.error("Error marking as converted:", err);
    }
  };

  const hasExperience = watch("hasInsuranceExperience");
  const licenseStatus = watch("licenseStatus");

  // Fetch only active MANAGERS for referral selection via edge function (bypasses RLS for public access)
  useEffect(() => {
    const fetchActiveManagers = async () => {
      try {
        console.log("Fetching managers via edge function...");
        
        const { data, error } = await supabase.functions.invoke("get-active-managers");

        if (error) {
          console.error("Error fetching managers:", error);
          return;
        }

        if (data?.managers && Array.isArray(data.managers)) {
          console.log("Managers loaded:", data.managers);
          setActiveAgents(data.managers);
        } else {
          console.log("No managers returned from edge function");
        }
      } catch (error) {
        console.error("Error fetching managers:", error);
      }
    };

    fetchActiveManagers();
  }, []);

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
        fieldsToValidate = ["availability", "smsConsent", "motivation"];
        break;
    }
    
    return await trigger(fieldsToValidate);
  };

  const nextStep = async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) {
      toast.error("Please fill in all required fields before continuing");
      return;
    }
    
    // Auto-save partial application after each step (except step 5 which is referral)
    if (currentStep <= 4) {
      savePartialApplication(currentStep);
    }
    
    if (currentStep < 5) {
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
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            city: data.city,
            state: data.state,
            instagramHandle,

            hasInsuranceExperience: data.hasInsuranceExperience,
            yearsExperience,
            previousCompany: data.previousCompany,
            numberOfDownlines,

            licenseStatus: data.licenseStatus,
            niprNumber: data.niprNumber,
            licensedStates: selectedStates,

            availability: data.availability,
            referralSource: data.referralSource,

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
          },
        },
      );

      if (error) throw error;
      if (!submitResult?.applicationId) throw new Error("Missing application id");

      // Mark partial application as converted
      await markAsConverted();

      // Save application ID and license status for referral step
      setApplicationId(submitResult.applicationId);
      setSavedLicenseStatus(data.licenseStatus);

      // Email notifications are now handled by submit-application function
      // No need to call send-application-notification separately

      toast.success("Application submitted! One more step...");
      
      // Move to referral step
      setCurrentStep(5);
    } catch (error: any) {
      console.error("Error submitting application:", error);
      
      // Handle FunctionsHttpError: error.context is a Response object
      if (error?.context && typeof error.context.json === 'function' && typeof error.context.status === 'number') {
        const status = error.context.status;
        try {
          const body = await error.context.json();
          if (status === 409) {
            setDuplicateError(true);
            toast.error(body?.error || "An application with this email already exists. Contact info@apex-financial.org if you need help.", { duration: 10000 });
          } else if (body?.details && Array.isArray(body.details)) {
            const fields = body.details.map((d: any) => d.path?.join?.(".") || d.message).filter(Boolean);
            toast.error(`Please fix these fields: ${fields.join(", ")}`, { duration: 6000 });
          } else {
            toast.error(body?.error || "Failed to submit application. Please try again.", { duration: 5000 });
          }
        } catch (_) {
          if (status === 409) {
            setDuplicateError(true);
            toast.error("An application with this email already exists. Contact info@apex-financial.org if you need help.", { duration: 10000 });
          } else {
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

  const handleReferralSubmit = async () => {
    if (!applicationId) return;

    setIsSubmitting(true);
    try {
      await supabase.functions.invoke("update-application-referral", {
        body: {
          applicationId,
          selectedReferrer,
          customReferrer,
        },
      });

      if (savedLicenseStatus === "licensed") {
        navigate("/apply/success/licensed");
      } else {
        setShowMotivationStep(true);
      }
    } catch (error) {
      console.error("Error updating referral:", error);
      if (savedLicenseStatus === "licensed") {
        navigate("/apply/success/licensed");
      } else {
        setShowMotivationStep(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMotivationSubmit = async () => {
    if (motivationText.trim().length < 10) {
      setMotivationError("Please share at least a few words about your motivation (minimum 10 characters).");
      return;
    }
    setMotivationError("");
    setIsSubmitting(true);
    try {
      await supabase
        .from("applications")
        .update({ notes: motivationText.trim() })
        .eq("id", applicationId!);
    } catch (err) {
      console.error("Error saving motivation:", err);
    } finally {
      setIsSubmitting(false);
      navigate("/apply/success/unlicensed");
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="glass-strong border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <Crown className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold gradient-text">APEX Financial</span>
            </Link>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          {/* Progress Steps */}
          <div className="mb-12">
            <div className="flex items-center justify-between relative">
              <div className="absolute top-5 left-0 right-0 h-0.5 bg-border" />
              <div 
                className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-500"
                style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
              />
              
              {steps.map((step) => (
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
              Step {currentStep} of {steps.length}: {steps[currentStep - 1]?.title}
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
                  {/* Duplicate Application Error Banner */}
                  {duplicateError && (
                    <div className="mb-6 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
                      <p className="font-semibold text-sm">⚠️ Application Already Exists</p>
                      <p className="text-xs mt-1">An application with this email or phone number is already on file. If you need to update your application, please email <a href="mailto:info@apex-financial.org" className="underline font-medium">info@apex-financial.org</a>.</p>
                    </div>
                  )}
                  {/* Step 1: Personal Info */}
                  {currentStep === 1 && (
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
                          value={watch("carrier" as any) || undefined}
                          onValueChange={(value) => setValue("carrier" as any, value)}
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
                  {currentStep === 2 && (
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
                            Many of our top producers came to APEX with zero insurance experience. 
                            Our comprehensive training program will teach you everything you need to know 
                            to succeed. Most new agents close their first sale within 2 weeks of training.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Licensing */}
                  {currentStep === 3 && (
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
                          <h3 className="font-semibold text-primary mb-2">We've got you covered!</h3>
                          <p className="text-sm text-muted-foreground">
                            APEX will guide you through the entire licensing process. We provide study materials, 
                            exam prep courses, and even reimburse your licensing fees once you're contracted. 
                            Most candidates get licensed within 2-3 weeks.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                   {/* Step 4: Goals */}
                  {currentStep === 4 && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-2">Your Goals</h2>
                        <p className="text-muted-foreground">Help us understand what you're looking for.</p>
                      </div>

                      {/* SMS Consent Error Banner */}
                      {smsConsentError && (
                        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
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
                        <Label>How did you hear about us?</Label>
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
                              I agree to receive SMS/text messages from Apex Financial. *
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

                  {/* Step 5: Referral Selection OR Motivation */}
                  {currentStep === 5 && !showMotivationStep && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                          <Users className="h-8 w-8 text-primary" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">One More Thing!</h2>
                        <p className="text-muted-foreground">
                          Who referred you to APEX Financial?
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Select your referrer</Label>
                          <Select 
                            value={selectedReferrer}
                            onValueChange={setSelectedReferrer}
                          >
                            <SelectTrigger className="bg-input">
                              <SelectValue placeholder="Choose who referred you" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">I found APEX on my own</SelectItem>
                              {activeAgents.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                  {agent.name}{agent.instagramHandle ? ` (@${agent.instagramHandle})` : ''}
                                </SelectItem>
                              ))}
                              <SelectItem value="other">Someone else not listed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {selectedReferrer === "other" && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="space-y-2"
                          >
                            <Label htmlFor="customReferrer">Who referred you?</Label>
                            <Input
                              id="customReferrer"
                              value={customReferrer}
                              onChange={(e) => setCustomReferrer(e.target.value)}
                              placeholder="Enter their name"
                              className="bg-input"
                            />
                          </motion.div>
                        )}
                      </div>

                      <div className="p-4 rounded-lg bg-muted/50 border border-border">
                        <p className="text-sm text-muted-foreground text-center">
                          This helps us give credit to our team members who spread the word about APEX.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Motivation Step (unlicensed/pending only) */}
                  {currentStep === 5 && showMotivationStep && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                          <Heart className="h-8 w-8 text-primary" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Almost There!</h2>
                        <p className="text-muted-foreground">
                          What is your motivation for joining APEX Financial?
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="motivation">Your Motivation *</Label>
                        <Textarea
                          id="motivation"
                          value={motivationText}
                          onChange={(e) => {
                            setMotivationText(e.target.value);
                            if (e.target.value.trim().length >= 10) setMotivationError("");
                          }}
                          placeholder="Tell us why you want to join APEX and what drives you to succeed..."
                          className="bg-input min-h-[120px]"
                          maxLength={1000}
                        />
                        {motivationError && (
                          <p className="text-sm text-destructive">{motivationError}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {motivationText.length}/1000 characters
                        </p>
                      </div>

                      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                        <p className="text-sm text-muted-foreground">
                          We love to hear what drives our future agents. Your answer helps us tailor your onboarding experience.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Navigation Buttons */}
                  <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
                    {currentStep > 1 && currentStep < 5 ? (
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

                    {currentStep < 4 ? (
                      <GradientButton type="button" onClick={nextStep}>
                        Next Step
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </GradientButton>
                    ) : currentStep === 4 ? (
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
                            Submit Application
                            <CheckCircle2 className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </GradientButton>
                    ) : showMotivationStep ? (
                      <GradientButton 
                        type="button" 
                        onClick={handleMotivationSubmit}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          <>
                            Submit & Continue
                            <CheckCircle2 className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </GradientButton>
                    ) : (
                      <GradientButton 
                        type="button" 
                        onClick={handleReferralSubmit}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Finishing...
                          </>
                        ) : (
                          <>
                            Complete Application
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
        </div>
      </main>
    </div>
  );
}
