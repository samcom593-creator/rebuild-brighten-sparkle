import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, Mail, Lock, Loader2, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  usePageTitle("Sign in · APEX Financial");
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const { playSound } = useSoundEffects();
  const [showPhoneLogin, setShowPhoneLogin] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });
  const watchedEmail = watch("email");
  const [resetLoading, setResetLoading] = useState(false);

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;

      // After successful login, determine where to send the user
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check role
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        const isAdmin = roles?.some(r => r.role === "admin");
        const isManager = roles?.some(r => r.role === "manager");

        // Force password change if default password
        const { data: agent } = await supabase
          .from("agents")
          .select("portal_password_set, onboarding_stage")
          .eq("user_id", user.id)
          .maybeSingle();

        if (data.password === "123456" && agent && !agent.portal_password_set) {
          navigate("/dashboard/settings?force_password_change=true");
          return;
        }

        playSound("success");
        toast.success("Welcome back!");

        // Route by role — NEVER auto-route to course
        if (isAdmin || isManager) {
          navigate("/dashboard");
        } else {
          navigate("/agent-portal");
        }
        return;
      }

      playSound("success");
      toast.success("Welcome back!");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Login error:", error);
      playSound("error");
      toast.error(error.message || "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  // PL-014: shared phone normalizer + length guard (was duplicated, no validation)
  const normalizePhone = (raw: string): { ok: boolean; phone: string; reason?: string } => {
    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly.length < 10) {
      return { ok: false, phone: "", reason: "Phone number is too short (need 10+ digits)" };
    }
    if (digitsOnly.length === 10) return { ok: true, phone: `+1${digitsOnly}` };
    if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) return { ok: true, phone: `+${digitsOnly}` };
    if (raw.trim().startsWith("+")) return { ok: true, phone: raw.trim() };
    if (digitsOnly.length >= 11) return { ok: true, phone: `+${digitsOnly}` };
    return { ok: false, phone: "", reason: "Could not normalize to E.164 format" };
  };

  const handleSendOtp = async () => {
    if (!phoneNumber.trim()) {
      toast.error("Please enter your phone number");
      return;
    }
    const norm = normalizePhone(phoneNumber);
    if (!norm.ok) {
      toast.error(norm.reason || "Invalid phone number");
      return;
    }

    setPhoneLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: norm.phone });

      if (error) {
        // PL-014: phone provider disabled is the most likely failure mode (no Twilio config in Supabase Auth).
        // Surface a clear, action-oriented message + give email as the always-on fallback.
        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("phone") && (msg.includes("disabled") || msg.includes("not enabled") || msg.includes("provider"))) {
          toast.error("Phone sign-in isn't configured yet. Use email + password or 'Forgot password' to email yourself a magic link.");
          setShowPhoneLogin(false);
          return;
        }
        throw error;
      }

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
    const norm = normalizePhone(phoneNumber);
    if (!norm.ok) {
      toast.error(norm.reason || "Invalid phone number");
      return;
    }

    setPhoneLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: norm.phone,
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

  // PL-014: real Forgot Password flow — uses the send-password-reset edge function
  // (custom Resend path), falls back to native Supabase resetPasswordForEmail() if
  // the edge fn is unreachable. Uses react-hook-form watch() for the email value
  // instead of brittle document.getElementById which races with re-renders.
  const handleForgotPassword = async () => {
    const email = (watchedEmail || "").trim();
    if (!email) {
      toast.error("Type your email above first.");
      return;
    }
    if (!email.includes("@")) {
      toast.error("That doesn't look like a valid email.");
      return;
    }
    setResetLoading(true);
    try {
      // Try the branded Resend-based edge fn first.
      const { error: edgeErr } = await supabase.functions.invoke("send-password-reset", {
        body: { email, type: "reset" },
      });
      if (edgeErr) throw edgeErr;
      toast.success(`Reset link sent to ${email}. Check your inbox (+ spam).`);
    } catch (edgeFail: any) {
      // Native Supabase fallback — always available.
      try {
        const { error: nativeErr } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (nativeErr) throw nativeErr;
        toast.success(`Reset link sent to ${email} via Supabase. Check your inbox.`);
      } catch (nativeFail: any) {
        console.error("Forgot-password both paths failed:", { edgeFail, nativeFail });
        toast.error(nativeFail.message || edgeFail.message || "Could not send reset email.");
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-x-hidden bg-background text-foreground ops-surface ops-fade-in">
      {/* PL-013: explicit dark surface — Welcome-back page rendered white in
          some hydration paths. bg-background + text-foreground bind to the
          dark theme tokens regardless of pre-paint state. */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-4 mb-6 group">
            <motion.span
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="relative h-12 w-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-primary/30 via-primary/20 to-primary/5 border border-primary/40 backdrop-blur-md shadow-[0_0_30px_hsl(168_80%_50%/0.35)]"
            >
              <Crown className="h-6 w-6 text-primary" />
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
            </motion.span>
            <div className="flex flex-col items-start leading-none">
              <span className="text-2xl font-bold brand-gradient tracking-wider">APEX</span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-1">Financial</span>
            </div>
          </Link>
          <motion.h1
            className="font-extrabold mb-3 brand-gradient leading-tight tracking-tight max-w-full text-balance"
            style={{ fontSize: "clamp(2rem, 8vw, 3.5rem)", filter: "drop-shadow(0 0 30px hsl(168 80% 50% / 0.35))" }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <span className="block">Welcome</span>
            <span className="block">back</span>
          </motion.h1>
          <p className="text-muted-foreground leading-snug">
            <span className="block">Sign in to access</span>
            <span className="block">your operating system</span>
          </p>
        </div>

        <GlassCard className="p-4 sm:p-8">
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
              <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
                Email and password is the active sign-in path. Google and phone
                sign-in are hidden until those providers are configured.
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

              <div className="flex items-center justify-center mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-center"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                >
                  {resetLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                      Sending…
                    </>
                  ) : (
                    "Forgot password?"
                  )}
                </Button>
              </div>
            </>
          )}

          <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20 text-center">
            <p className="text-sm font-medium mb-2">Agent daily-numbers account?</p>
            <p className="text-xs text-muted-foreground mb-3">
              Use this only if your agent portal account was created separately.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/agent-login")}
            >
              Agent Login →
            </Button>
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground leading-snug">
            Contact your admin for account access.
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
