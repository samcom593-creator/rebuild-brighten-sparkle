import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BarChart3, Mail, Lock, Loader2, TrendingUp, Trophy, Target, ArrowLeft, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import apexIcon from "@/assets/apex-icon.png";

const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const resetSchema = z.object({
  email: z.string().email("Valid email is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;
type ResetFormData = z.infer<typeof resetSchema>;

export default function AgentNumbersLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/apex-daily-numbers", { replace: true });
      }
    };
    checkSession();
  }, [navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const {
    register: registerReset,
    handleSubmit: handleResetSubmit,
    formState: { errors: resetErrors },
    reset: resetForm,
    setValue: setResetValue,
  } = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;

      toast.success("Welcome! Let's log your numbers 🎯");
      
      const from = (location.state as any)?.from?.pathname || "/apex-daily-numbers";
      navigate(from, { replace: true });
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.message.includes("Invalid login")) {
        toast.error("Invalid email or password. Please try again.");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onResetSubmit = async (data: ResetFormData) => {
    setIsResetting(true);
    
    try {
      const { error } = await supabase.functions.invoke("send-password-reset", {
        body: { email: data.email },
      });

      if (error) throw error;

      setResetEmailSent(true);
      toast.success("Password reset email sent!");
    } catch (error: any) {
      console.error("Reset error:", error);
      toast.error("Failed to send reset email. Please try again.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleForgotPasswordClick = () => {
    const currentEmail = getValues("email");
    if (currentEmail) {
      setResetValue("email", currentEmail);
    }
    setShowForgotPassword(true);
  };

  const handleBackToLogin = () => {
    setShowForgotPassword(false);
    setResetEmailSent(false);
    resetForm();
  };

  const features = [
    { icon: BarChart3, text: "Track daily production" },
    { icon: TrendingUp, text: "See your ranking" },
    { icon: Trophy, text: "Compete on leaderboard" },
  ];

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
            <p className="text-muted-foreground">
              {showForgotPassword ? "Reset your password" : "Sign in to log your production"}
            </p>
          </motion.div>
        </div>

        {/* Feature highlights - only show on login */}
        <AnimatePresence mode="wait">
          {!showForgotPassword && (
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
          {showForgotPassword ? (
            /* Forgot Password Form */
            <motion.div
              key="forgot-password"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-8">
                {resetEmailSent ? (
                  /* Success State */
                  <div className="text-center py-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 text-green-500 mb-4">
                      <CheckCircle className="h-8 w-8" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Check Your Email</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      We've sent a password reset link to your email address. Click the link to set a new password.
                    </p>
                    <Button
                      variant="outline"
                      onClick={handleBackToLogin}
                      className="w-full"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Sign In
                    </Button>
                  </div>
                ) : (
                  /* Reset Form */
                  <form onSubmit={handleResetSubmit(onResetSubmit)} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email" className="text-sm font-medium">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reset-email"
                          type="email"
                          {...registerReset("email")}
                          placeholder="your@email.com"
                          className="pl-10 bg-input h-11"
                          autoComplete="email"
                        />
                      </div>
                      {resetErrors.email && (
                        <p className="text-sm text-destructive">{resetErrors.email.message}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Enter the email address associated with your account and we'll send you a link to reset your password.
                      </p>
                    </div>

                    <GradientButton 
                      type="submit" 
                      className="w-full h-11 text-base font-semibold" 
                      disabled={isResetting}
                    >
                      {isResetting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 mr-2" />
                          Send Reset Link
                        </>
                      )}
                    </GradientButton>

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleBackToLogin}
                      className="w-full"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Sign In
                    </Button>
                  </form>
                )}
              </GlassCard>
            </motion.div>
          ) : (
            /* Login Form */
            <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <GlassCard className="p-8">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        {...register("email")}
                        placeholder="your@email.com"
                        className="pl-10 bg-input h-11"
                        autoComplete="email"
                      />
                    </div>
                    {errors.email && (
                      <p className="text-sm text-destructive">{errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                      <button
                        type="button"
                        onClick={handleForgotPasswordClick}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        {...register("password")}
                        placeholder="••••••••"
                        className="pl-10 bg-input h-11"
                        autoComplete="current-password"
                      />
                    </div>
                    {errors.password && (
                      <p className="text-sm text-destructive">{errors.password.message}</p>
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
                        Signing in...
                      </>
                    ) : (
                      <>
                        <Target className="h-4 w-4 mr-2" />
                        Sign In & Log Numbers
                      </>
                    )}
                  </GradientButton>
                </form>

                <div className="mt-6 pt-6 border-t border-border/50">
                  <p className="text-center text-sm text-muted-foreground">
                    Need an account? Contact your manager or admin.
                  </p>
                </div>
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
