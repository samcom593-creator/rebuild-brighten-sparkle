import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, Mail, Lock, User, Loader2, ShieldAlert, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const signupSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

export default function AgentSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidatingRef, setIsValidatingRef] = useState(true);
  const [isValidRef, setIsValidRef] = useState(false);
  const [refData, setRefData] = useState<{
    manager_agent_id: string;
    manager_name: string;
  } | null>(null);
  
  // Get ref code from URL
  const refCode = searchParams.get("ref");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });

  // Validate ref code on load
  useEffect(() => {
    validateRefCode();
  }, [refCode]);

  const validateRefCode = async () => {
    if (!refCode) {
      setIsValidatingRef(false);
      setIsValidRef(false);
      return;
    }

    try {
      // Check if the invite code exists and is active
      const { data: inviteLink, error } = await supabase
        .from("manager_invite_links")
        .select("id, manager_agent_id, is_active")
        .eq("invite_code", refCode)
        .eq("is_active", true)
        .single();

      if (error || !inviteLink) {
        setIsValidRef(false);
        setIsValidatingRef(false);
        return;
      }

      // Get the manager's name
      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", inviteLink.manager_agent_id)
        .single();

      let managerName = "your manager";
      if (agent?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", agent.user_id)
          .single();
        managerName = profile?.full_name || "your manager";
      }

      setIsValidRef(true);
      setRefData({
        manager_agent_id: inviteLink.manager_agent_id,
        manager_name: managerName,
      });
    } catch (error) {
      console.error("Ref validation error:", error);
      setIsValidRef(false);
    } finally {
      setIsValidatingRef(false);
    }
  };

  const onSubmit = async (data: SignupFormData) => {
    if (!isValidRef || !refData) {
      toast.error("Invalid invite link");
      return;
    }

    setIsLoading(true);
    
    try {
      // Use edge function for secure agent signup
      const { data: response, error: functionError } = await supabase.functions.invoke(
        "agent-signup",
        {
          body: {
            refCode,
            email: data.email,
            password: data.password,
            fullName: data.fullName,
            managerAgentId: refData.manager_agent_id,
          },
        }
      );

      if (functionError) {
        throw new Error(functionError.message || "Failed to create account");
      }

      if (response?.error) {
        throw new Error(response.error);
      }

      // Delete the used invite link so it's one-time-use
      if (refCode) {
        await supabase
          .from("manager_invite_links")
          .update({ is_active: false })
          .eq("invite_code", refCode);
      }

      // Sign in the user after successful signup
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError) {
        toast.success("Account created! Please log in.");
        navigate("/login");
        return;
      }

      toast.success("Account created! Welcome to APEX Financial.");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Signup error:", error);
      toast.error(error.message || "Failed to create account");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidatingRef) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Validating invite link...</p>
        </div>
      </div>
    );
  }

  // Invalid ref state
  if (!isValidRef) {
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
          </div>

          <GlassCard className="p-8 text-center">
            <ShieldAlert className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <h1 className="text-2xl font-bold mb-2">Invalid Invite Link</h1>
            <p className="text-muted-foreground mb-6">
              This invite link is invalid or has been deactivated.
              Please contact your manager for a new invite link.
            </p>
            <Link to="/login">
              <GradientButton className="w-full">
                Go to Login
              </GradientButton>
            </Link>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Valid ref - show signup form
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
          <h1 className="text-3xl font-bold mb-2">Join the Team</h1>
          <p className="text-muted-foreground">
            You've been invited by{" "}
            <span className="text-primary font-medium">{refData?.manager_name}</span>
          </p>
        </div>

        <GlassCard className="p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  {...register("fullName")}
                  placeholder="John Smith"
                  className="pl-10 bg-input"
                />
              </div>
              {errors.fullName && (
                <p className="text-sm text-destructive">{errors.fullName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
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
                  {...register("password")}
                  placeholder="••••••••"
                  className="pl-10 bg-input"
                />
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  {...register("confirmPassword")}
                  placeholder="••••••••"
                  className="pl-10 bg-input"
                />
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <GradientButton type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating account...
                </>
              ) : (
                <>
                  <Users className="h-4 w-4 mr-2" />
                  Create Account
                </>
              )}
            </GradientButton>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
