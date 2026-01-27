import { useState, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BarChart3, Mail, Lock, Loader2, TrendingUp, Trophy, Target, ArrowLeft, CheckCircle, User, Phone, UserPlus, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import apexIcon from "@/assets/apex-icon.png";

type FlowStep = "identifier" | "password" | "set-password" | "create-account" | "reset-sent";

const identifierSchema = z.object({
  identifier: z.string().min(1, "Email or phone is required"),
});

const passwordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// Simplified: only password required for CRM users
const setPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const createAccountSchema = z.object({
  fullName: z.string().min(2, "Name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type IdentifierFormData = z.infer<typeof identifierSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;
type SetPasswordFormData = z.infer<typeof setPasswordSchema>;
type CreateAccountFormData = z.infer<typeof createAccountSchema>;

export default function AgentNumbersLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  const [step, setStep] = useState<FlowStep>("identifier");
  const [email, setEmail] = useState("");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingIdentifier, setIsCheckingIdentifier] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Check URL params for setup flow
  useEffect(() => {
    const setupParam = searchParams.get("setup");
    const emailParam = searchParams.get("email");
    
    if (setupParam === "true" && emailParam) {
      setEmail(emailParam);
      setStep("set-password");
    }
  }, [searchParams]);

  // Check if already authenticated
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/agent-portal", { replace: true });
      }
    };
    checkSession();
  }, [navigate]);

  const identifierForm = useForm<IdentifierFormData>({
    resolver: zodResolver(identifierSchema),
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const setPasswordForm = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
  });

  const createAccountForm = useForm<CreateAccountFormData>({
    resolver: zodResolver(createAccountSchema),
  });

  const handleIdentifierSubmit = async (data: IdentifierFormData) => {
    setIsCheckingIdentifier(true);
    const input = data.identifier.trim();

    try {
      const { data: result, error } = await supabase.functions.invoke("check-email-status", {
        body: { identifier: input },
      });

      if (error) throw error;

      const { inCRM, hasAuthAccount, agentName: name, agentEmail } = result;
      
      // Use the email from CRM (important for phone lookups)
      const emailToUse = agentEmail || input;
      setEmail(emailToUse.toLowerCase().trim());
      setAgentName(name);

      if (inCRM && hasAuthAccount) {
        // Existing user with auth - show password field
        setStep("password");
      } else if (inCRM && !hasAuthAccount) {
        // CRM user without auth - just need password (name already in CRM)
        setStep("set-password");
      } else {
        // Not in CRM - create new account
        setStep("create-account");
      }
    } catch (error: any) {
      console.error("Error checking identifier:", error);
      toast.error("Failed to check. Please try again.");
    } finally {
      setIsCheckingIdentifier(false);
    }
  };

  const handlePasswordSubmit = async (data: PasswordFormData) => {
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });

      if (error) throw error;

      toast.success("Welcome! Let's log your numbers 🎯");
      const from = (location.state as any)?.from?.pathname || "/agent-portal";
      navigate(from, { replace: true });
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.message.includes("Invalid login")) {
        toast.error("Invalid password. Please try again or reset your password.");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPasswordSubmit = async (data: SetPasswordFormData) => {
    setIsLoading(true);
    
    try {
      const { data: result, error } = await supabase.functions.invoke("setup-agent-password", {
        body: { email, password: data.password },
      });

      if (error) throw error;
      if (result.error) throw new Error(result.error);

      toast.success("Password set! Signing you in...");

      // Now sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });

      if (signInError) throw signInError;

      const from = (location.state as any)?.from?.pathname || "/agent-portal";
      navigate(from, { replace: true });
    } catch (error: any) {
      console.error("Setup error:", error);
      toast.error(error.message || "Failed to set password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAccountSubmit = async (data: CreateAccountFormData) => {
    setIsLoading(true);
    
    try {
      const { data: result, error } = await supabase.functions.invoke("create-new-agent-account", {
        body: { 
          email, 
          password: data.password,
          fullName: data.fullName,
        },
      });

      if (error) throw error;
      if (result.error) throw new Error(result.error);

      toast.success("Account created! Signing you in...");

      // Now sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });

      if (signInError) throw signInError;

      const from = (location.state as any)?.from?.pathname || "/agent-portal";
      navigate(from, { replace: true });
    } catch (error: any) {
      console.error("Create account error:", error);
      toast.error(error.message || "Failed to create account");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.error("Please enter your email first");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://apex-financial.org/agent-portal",
      });

      if (error) throw error;

      setStep("reset-sent");
      toast.success("Password reset email sent!");
    } catch (error: any) {
      console.error("Reset error:", error);
      toast.error("Failed to send reset email");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setStep("identifier");
    setEmail("");
    setAgentName(null);
    identifierForm.reset();
    passwordForm.reset();
    setPasswordForm.reset();
    createAccountForm.reset();
  };

  const features = [
    { icon: BarChart3, text: "Track daily production" },
    { icon: TrendingUp, text: "See your ranking" },
    { icon: Trophy, text: "Compete on leaderboard" },
  ];

  const getStepTitle = () => {
    switch (step) {
      case "identifier": return "Sign in to log your production";
      case "password": return agentName ? `Welcome back, ${agentName.split(" ")[0]}!` : "Enter your password";
      case "set-password": return agentName ? `Welcome, ${agentName.split(" ")[0]}! 👋` : "Set your password";
      case "create-account": return "Create your account";
      case "reset-sent": return "Check your email";
      default: return "";
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,hsl(var(--chart-2)/0.1)_0%,transparent_50%)]" />
      
      {/* Floating elements */}
      <motion.div
        className="absolute top-20 left-10 w-20 h-20 rounded-full bg-primary/10 blur-xl"
        animate={{ y: [0, -20, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-20 right-10 w-32 h-32 rounded-full bg-primary/5 blur-xl"
        animate={{ y: [0, 20, 0], scale: [1, 1.2, 1] }}
        transition={{ duration: 5, repeat: Infinity }}
      />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Header with branding */}
        <div className="text-center mb-8">
          <motion.div 
            className="inline-flex items-center justify-center mb-4"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2 }}
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-xl" />
              <img 
                src={apexIcon} 
                alt="Apex" 
                className="h-16 w-16 rounded-2xl relative z-10 shadow-lg shadow-primary/20" 
              />
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary via-violet-400 to-amber-400 bg-clip-text text-transparent">
              Apex Daily Numbers
            </h1>
            <p className="text-muted-foreground">{getStepTitle()}</p>
          </motion.div>
        </div>

        {/* Feature highlights - only show on identifier step */}
        <AnimatePresence mode="wait">
          {step === "identifier" && (
            <motion.div 
              className="flex justify-center gap-4 mb-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.4 }}
            >
              {features.map((feature, i) => (
                <motion.div
                  key={i}
                  className="flex flex-col items-center gap-1 text-xs text-muted-foreground"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                >
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <feature.icon className="h-4 w-4" />
                  </div>
                  <span className="text-center">{feature.text}</span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {/* Step 1: Email/Phone Input */}
          {step === "identifier" && (
            <motion.div
              key="identifier-step"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <GlassCard className="p-8">
                <form onSubmit={identifierForm.handleSubmit(handleIdentifierSubmit)} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="identifier" className="text-sm font-medium">Email or Phone</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="identifier"
                        type="text"
                        {...identifierForm.register("identifier")}
                        placeholder="your@email.com or (555) 123-4567"
                        className="pl-10 bg-input h-11"
                        autoComplete="email tel"
                        autoFocus
                      />
                    </div>
                    {identifierForm.formState.errors.identifier && (
                      <p className="text-sm text-destructive">{identifierForm.formState.errors.identifier.message}</p>
                    )}
                  </div>

                  <GradientButton 
                    type="submit" 
                    className="w-full h-11 text-base font-semibold" 
                    disabled={isCheckingIdentifier}
                  >
                    {isCheckingIdentifier ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Checking...
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
                      </>
                    )}
                  </GradientButton>
                </form>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 2a: Password (existing user) */}
          {step === "password" && (
            <motion.div
              key="password-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-8">
                <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-5">
                  <div className="p-3 rounded-lg bg-primary/10 text-sm text-center mb-4">
                    <Mail className="h-4 w-4 inline mr-2" />
                    {email}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                        disabled={isLoading}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        {...passwordForm.register("password")}
                        placeholder="••••••••"
                        className="pl-10 bg-input h-11"
                        autoComplete="current-password"
                        autoFocus
                      />
                    </div>
                    {passwordForm.formState.errors.password && (
                      <p className="text-sm text-destructive">{passwordForm.formState.errors.password.message}</p>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="remember-me" 
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                    />
                    <Label htmlFor="remember-me" className="text-sm text-muted-foreground cursor-pointer">
                      Remember me
                    </Label>
                  </div>

                  <GradientButton 
                    type="submit" 
                    className="w-full h-11 text-base font-semibold" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <Target className="h-4 w-4 mr-2" />
                        Sign In & Log Numbers
                      </>
                    )}
                  </GradientButton>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBack}
                    className="w-full"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Use different email
                  </Button>
                </form>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 2b: Set Password (CRM user, no auth) - SIMPLIFIED: just password */}
          {step === "set-password" && (
            <motion.div
              key="set-password-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-8">
                <form onSubmit={setPasswordForm.handleSubmit(handleSetPasswordSubmit)} className="space-y-5">
                  {/* Welcome banner with name */}
                  {agentName && (
                    <div className="p-4 rounded-lg bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/20 text-center">
                      <CheckCircle className="h-5 w-5 inline mr-2 text-primary" />
                      <span className="font-medium">We found you, {agentName}!</span>
                    </div>
                  )}

                  <div className="p-2 rounded-lg bg-muted/50 text-xs text-center text-muted-foreground">
                    <Mail className="h-3 w-3 inline mr-1" />
                    {email}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="set-password" className="text-sm font-medium">Create a Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="set-password"
                        type="password"
                        {...setPasswordForm.register("password")}
                        placeholder="Choose a password (6+ characters)"
                        className="pl-10 bg-input h-11"
                        autoComplete="new-password"
                        autoFocus
                      />
                    </div>
                    {setPasswordForm.formState.errors.password && (
                      <p className="text-sm text-destructive">{setPasswordForm.formState.errors.password.message}</p>
                    )}
                  </div>

                  <GradientButton 
                    type="submit" 
                    className="w-full h-11 text-base font-semibold" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Setting up...
                      </>
                    ) : (
                      <>
                        <Target className="h-4 w-4 mr-2" />
                        Set Password & Log In
                      </>
                    )}
                  </GradientButton>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBack}
                    className="w-full"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Use different email
                  </Button>
                </form>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 2c: Create Account (not in CRM) */}
          {step === "create-account" && (
            <motion.div
              key="create-account-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-8">
                <form onSubmit={createAccountForm.handleSubmit(handleCreateAccountSubmit)} className="space-y-4">
                  <div className="p-3 rounded-lg bg-primary/10 text-sm text-center mb-2">
                    <UserPlus className="h-4 w-4 inline mr-2" />
                    Create your APEX account
                  </div>

                  <div className="p-2 rounded-lg bg-muted/50 text-xs text-center text-muted-foreground">
                    <Mail className="h-3 w-3 inline mr-1" />
                    {email}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-sm font-medium">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="fullName"
                        type="text"
                        {...createAccountForm.register("fullName")}
                        placeholder="Your full name"
                        className="pl-10 bg-input h-11"
                        autoComplete="name"
                        autoFocus
                      />
                    </div>
                    {createAccountForm.formState.errors.fullName && (
                      <p className="text-sm text-destructive">{createAccountForm.formState.errors.fullName.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="create-password" className="text-sm font-medium">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="create-password"
                        type="password"
                        {...createAccountForm.register("password")}
                        placeholder="Choose a password"
                        className="pl-10 bg-input h-11"
                        autoComplete="new-password"
                      />
                    </div>
                    {createAccountForm.formState.errors.password && (
                      <p className="text-sm text-destructive">{createAccountForm.formState.errors.password.message}</p>
                    )}
                  </div>

                  <GradientButton 
                    type="submit" 
                    className="w-full h-11 text-base font-semibold" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating account...
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4 mr-2" />
                        Create Account & Log In
                      </>
                    )}
                  </GradientButton>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBack}
                    className="w-full"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Use different email
                  </Button>
                </form>
              </GlassCard>
            </motion.div>
          )}

          {/* Reset Email Sent */}
          {step === "reset-sent" && (
            <motion.div
              key="reset-sent-step"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <GlassCard className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 text-accent-foreground mb-4">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Check Your Email</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  We've sent a password reset link to <strong>{email}</strong>. Click the link to set a new password.
                </p>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Sign In
                </Button>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.p 
          className="text-center text-xs text-muted-foreground mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          APEX Financial • Daily Production Tracker
        </motion.p>
      </motion.div>
    </div>
  );
}
