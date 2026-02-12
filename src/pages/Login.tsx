import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, Mail, Lock, Loader2, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPhoneLogin, setShowPhoneLogin] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;

      // Check if agent should go to course or force password change
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: agent } = await supabase
          .from("agents")
          .select("has_training_course, onboarding_stage, portal_password_set")
          .eq("user_id", user.id)
          .maybeSingle();

        // Force password change if they used the default "123456"
        if (data.password === "123456" && agent && !agent.portal_password_set) {
          navigate("/dashboard/settings?force_password_change=true");
          return;
        }
        
        if (agent?.has_training_course) {
          toast.success("Welcome! Taking you to your course 📚");
          navigate("/onboarding-course");
          return;
        }
      }

      toast.success("Welcome back!");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Login error:", error);
      toast.error(error.message || "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });

      if (error) throw error;
      // Redirect will happen automatically
    } catch (error: any) {
      console.error("Google sign-in error:", error);
      toast.error(error.message || "Google sign-in failed");
      setIsGoogleLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!phoneNumber.trim()) {
      toast.error("Please enter your phone number");
      return;
    }

    setPhoneLoading(true);
    try {
      // Normalize phone to E.164 format
      const digitsOnly = phoneNumber.replace(/\D/g, "");
      let normalizedPhone = digitsOnly;
      
      // If 10 digits, assume US and add +1
      if (digitsOnly.length === 10) {
        normalizedPhone = `+1${digitsOnly}`;
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
        normalizedPhone = `+${digitsOnly}`;
      } else if (!phoneNumber.startsWith("+")) {
        normalizedPhone = `+${digitsOnly}`;
      }

      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });

      if (error) throw error;

      setOtpSent(true);
      toast.success("Verification code sent!");
    } catch (error: any) {
      console.error("Phone OTP error:", error);
      toast.error(error.message || "Failed to send code");
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) {
      toast.error("Please enter the verification code");
      return;
    }

    setPhoneLoading(true);
    try {
      // Normalize phone to match what was used for OTP
      const digitsOnly = phoneNumber.replace(/\D/g, "");
      let normalizedPhone = digitsOnly;
      
      if (digitsOnly.length === 10) {
        normalizedPhone = `+1${digitsOnly}`;
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
        normalizedPhone = `+${digitsOnly}`;
      } else if (!phoneNumber.startsWith("+")) {
        normalizedPhone = `+${digitsOnly}`;
      }

      const { error } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: otpCode,
        type: "sms",
      });

      if (error) throw error;

      toast.success("Welcome!");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("OTP verification error:", error);
      toast.error(error.message || "Invalid code");
    } finally {
      setPhoneLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <Crown className="h-10 w-10 text-primary" />
            <span className="text-2xl font-bold gradient-text">APEX Financial</span>
          </Link>
          <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
          <p className="text-muted-foreground">Sign in to access your dashboard</p>
        </div>

        <GlassCard className="p-8">
          {showPhoneLogin ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center">Sign in with Phone</h3>
              
              {!otpSent ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className="pl-10 bg-input"
                        autoFocus
                      />
                    </div>
                  </div>
                  <GradientButton
                    type="button"
                    className="w-full"
                    onClick={handleSendOtp}
                    disabled={phoneLoading}
                  >
                    {phoneLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Send Verification Code
                  </GradientButton>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="otp">Verification Code</Label>
                    <Input
                      id="otp"
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="bg-input text-center text-2xl tracking-widest"
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                  <GradientButton
                    type="button"
                    className="w-full"
                    onClick={handleVerifyOtp}
                    disabled={phoneLoading}
                  >
                    {phoneLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Verify & Sign In
                  </GradientButton>
                </>
              )}

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setShowPhoneLogin(false);
                  setOtpSent(false);
                  setPhoneNumber("");
                  setOtpCode("");
                }}
              >
                Back to email login
              </Button>
            </div>
          ) : (
            <>
              {/* Google Sign In */}
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 gap-3 mb-4"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                Continue with Google
              </Button>

              <div className="relative mb-4">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  or
                </span>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      {...register("email")}
                      placeholder="you@example.com"
                      className="pl-10 bg-input"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      {...register("password")}
                      placeholder="••••••••"
                      className="pl-10 bg-input"
                    />
                  </div>
                  {errors.password && (
                    <p className="text-sm text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <GradientButton type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </GradientButton>
              </form>

              <div className="flex items-center justify-between mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const email = (document.getElementById("email") as HTMLInputElement)?.value;
                    if (!email) {
                      toast.error("Please enter your email first");
                      return;
                    }
                    try {
                      const { error } = await supabase.functions.invoke("send-password-reset", {
                        body: { email, type: "reset" },
                      });
                      if (error) throw error;
                      toast.success("Password reset email sent! Check your inbox.");
                    } catch (err: any) {
                      toast.error(err.message || "Failed to send reset email");
                    }
                  }}
                >
                  Forgot password?
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPhoneLogin(true)}
                >
                  <Phone className="h-4 w-4 mr-2" />
                  Use phone
                </Button>
              </div>
            </>
          )}

          <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20 text-center">
            <p className="text-sm font-medium mb-2">Are you an agent?</p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/agent-login")}
            >
              Agent Login →
            </Button>
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Contact your administrator for account access.
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
