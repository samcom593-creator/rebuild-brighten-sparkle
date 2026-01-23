import { useState, useEffect } from "react";
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
  previousProduction: z.number().min(0).optional(),
  
  // Step 3: Licensing
  licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
  niprNumber: z.string().max(20).optional(),
  licensedStates: z.array(z.string()).optional(),
  
  // Step 4: Goals
  availability: z.string().min(1, "Availability is required"),
  referralSource: z.string().optional(),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface ActiveAgent {
  id: string;
  name: string;
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

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<ApplicationFormData>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      hasInsuranceExperience: false,
      licenseStatus: "unlicensed",
      licensedStates: [],
    },
  });

  const hasExperience = watch("hasInsuranceExperience");
  const licenseStatus = watch("licenseStatus");

  // Fetch only active MANAGERS for referral selection
  useEffect(() => {
    const fetchActiveManagers = async () => {
      try {
        // Get all active agents
        const { data: activeAgents, error: agentsError } = await supabase
          .from("agents")
          .select("id, user_id")
          .eq("status", "active");

        if (agentsError || !activeAgents) {
          console.error("Error fetching agents:", agentsError);
          return;
        }

        // Filter to only those with manager role
        const managersWithProfiles: ActiveAgent[] = [];

        for (const agent of activeAgents) {
          if (!agent.user_id) continue;

          // Check if this user has the manager role
          const { data: roleData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", agent.user_id)
            .eq("role", "manager")
            .maybeSingle();

          if (roleData) {
            // Get their profile name
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("user_id", agent.user_id)
              .maybeSingle();

            if (profile?.full_name) {
              managersWithProfiles.push({
                id: agent.id,
                name: profile.full_name,
              });
            }
          }
        }

        setActiveAgents(managersWithProfiles);
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
        fieldsToValidate = ["availability"];
        break;
    }
    
    return await trigger(fieldsToValidate);
  };

  const nextStep = async () => {
    const isValid = await validateStep(currentStep);
    if (isValid && currentStep < 5) {
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

      const previousProduction = Number.isFinite(data.previousProduction as number)
        ? (data.previousProduction as number)
        : undefined;

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
            previousProduction,

            licenseStatus: data.licenseStatus,
            niprNumber: data.niprNumber,
            licensedStates: selectedStates,

            availability: data.availability,
            referralSource: data.referralSource,
          },
        },
      );

      if (error) throw error;
      if (!submitResult?.applicationId) throw new Error("Missing application id");

      // Save application ID and license status for referral step
      setApplicationId(submitResult.applicationId);
      setSavedLicenseStatus(data.licenseStatus);

      // Send email notifications (don't block on this)
      supabase.functions.invoke("send-application-notification", {
        body: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          city: data.city,
          state: data.state,
          licenseStatus: data.licenseStatus,
          hasInsuranceExperience: data.hasInsuranceExperience,
          yearsExperience: data.yearsExperience,
          previousCompany: data.previousCompany,
          availability: data.availability,
          referralSource: data.referralSource,
        },
      }).then(({ error: emailError }) => {
        if (emailError) {
          console.error("Failed to send notification email:", emailError);
        }
      });

      toast.success("Application submitted! One more step...");
      
      // Move to referral step
      setCurrentStep(5);
    } catch (error) {
      console.error("Error submitting application:", error);
      toast.error("Failed to submit application. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReferralSubmit = async () => {
    if (!applicationId) return;

    setIsSubmitting(true);
    try {
      // Update application with referrer if selected
      await supabase.functions.invoke("update-application-referral", {
        body: {
          applicationId,
          selectedReferrer,
          customReferrer,
        },
      });

      // Redirect based on license status
      if (savedLicenseStatus === "licensed") {
        navigate("/apply/success/licensed");
      } else {
        navigate("/apply/success/unlicensed");
      }
    } catch (error) {
      console.error("Error updating referral:", error);
      // Still redirect even if update fails
      if (savedLicenseStatus === "licensed") {
        navigate("/apply/success/licensed");
      } else {
        navigate("/apply/success/unlicensed");
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
                  <span className={`text-xs mt-2 font-medium ${
                    currentStep >= step.id ? "text-foreground" : "text-muted-foreground"
                  }`}>
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <GlassCard className="p-8">
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
                          <Select onValueChange={(value) => setValue("state", value, { shouldValidate: true })}>
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
                            <Label htmlFor="previousProduction">Annual Premium Production ($)</Label>
                            <Input
                              id="previousProduction"
                              type="number"
                              {...register("previousProduction", { valueAsNumber: true })}
                              placeholder="100000"
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

                      <div className="space-y-2">
                        <Label>Availability *</Label>
                        <Select onValueChange={(value) => setValue("availability", value, { shouldValidate: true })}>
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

                      <div className="space-y-2">
                        <Label>How did you hear about us?</Label>
                        <Select onValueChange={(value) => setValue("referralSource", value, { shouldValidate: true })}>
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
                    </div>
                  )}

                  {/* Step 5: Referral Selection */}
                  {currentStep === 5 && (
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
                                  {agent.name}
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
                      <GradientButton type="submit" disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          <>
                            Continue
                            <ArrowRight className="h-4 w-4 ml-2" />
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
