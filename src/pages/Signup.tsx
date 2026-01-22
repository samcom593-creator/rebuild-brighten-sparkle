import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, Mail, Lock, User, Loader2, ShieldAlert } from "lucide-react";
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

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidatingToken, setIsValidatingToken] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [tokenData, setTokenData] = useState<{
    id: string;
    manager_name: string | null;
    manager_email: string | null;
  } | null>(null);
  
  // Get token from URL
  const token = searchParams.get("token");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });

  // Validate token on load
  useEffect(() => {
    validateToken();
  }, [token]);

  const validateToken = async () => {
    if (!token) {
      setIsValidatingToken(false);
      setIsValidToken(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("manager_signup_tokens")
        .select("id, manager_name, manager_email, is_used, expires_at")
        .eq("token", token)
        .single();

      if (error || !data) {
        setIsValidToken(false);
      } else if (data.is_used) {
        setIsValidToken(false);
        toast.error("This invite link has already been used");
      } else if (new Date(data.expires_at) < new Date()) {
        setIsValidToken(false);
        toast.error("This invite link has expired");
      } else {
        setIsValidToken(true);
        setTokenData({
          id: data.id,
          manager_name: data.manager_name,
          manager_email: data.manager_email,
        });
      }
    } catch (error) {
      console.error("Token validation error:", error);
      setIsValidToken(false);
    } finally {
      setIsValidatingToken(false);
    }
  };

  const onSubmit = async (data: SignupFormData) => {
    if (!isValidToken || !tokenData) {
      toast.error("Invalid invite link");
      return;
    }

    setIsLoading(true);
    
    try {
      // Create the auth account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
          },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        // Create agent record with active status (pre-approved via token)
        const { error: agentError } = await supabase
          .from("agents")
          .insert({
            user_id: authData.user.id,
            status: "active",
            license_status: "unlicensed",
          });

        if (agentError) {
          console.error("Agent creation error:", agentError);
        }

        // Add manager role
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({
            user_id: authData.user.id,
            role: "manager",
          });

        if (roleError) {
          console.error("Role assignment error:", roleError);
        }
      }

      toast.success("Account created! Welcome to APEX Financial.");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Signup error:", error);
      if (error.message?.includes("already registered")) {
        toast.error("This email is already registered. Please log in instead.");
      } else {
        toast.error(error.message || "Failed to create account");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidatingToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Validating invite link...</p>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (!isValidToken) {
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
              This invite link is invalid, expired, or has already been used.
              Please contact your administrator for a new invite.
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

  // Valid token - show signup form
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
          <h1 className="text-3xl font-bold mb-2">Create Your Account</h1>
          <p className="text-muted-foreground">
            You've been invited to join as a manager
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
                  defaultValue={tokenData?.manager_name || ""}
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
                  defaultValue={tokenData?.manager_email || ""}
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
                "Create Account"
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
