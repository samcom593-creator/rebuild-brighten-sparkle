/**
 * /claim — the one link Sam sends to the whole team at once.
 *
 * Everyone opens the same URL, types who they are, and gets a login attached to
 * the record that already exists for them. No referral code, no per-person
 * setup by Sam, no duplicate record created.
 *
 * This is not /agent-signup. That page needs a manager's ?ref= code and CREATES
 * a new agent row; this one MATCHES an existing one and refuses when it can't
 * find exactly one. The matching rules and their reasoning live in
 * supabase/functions/claim-account/index.ts — the short version is that a name
 * alone never matches, because display_name is published on the leaderboard.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, Mail, Lock, User, Phone, Hash, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveBrand } from "@/config/brand";

const BRAND = resolveBrand();

const claimSchema = z
  .object({
    fullName: z.string().min(2, `Your full name, as ${BRAND.shortName} has it on file`),
    email: z.string().email("Enter the email you want to sign in with"),
    phone: z.string().optional(),
    agentCode: z.string().optional(),
    password: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((d) => Boolean(d.phone?.trim()) || Boolean(d.agentCode?.trim()), {
    // Enforced here AND in the function. The form asks nicely; the server is
    // the one that actually decides.
    message: "Add your phone number or your agent code so we can match you",
    path: ["phone"],
  });

type ClaimFormData = z.infer<typeof claimSchema>;

export default function ClaimAccount() {
  usePageTitle(`Activate your ${BRAND.shortName} account`);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimFormData>({ resolver: zodResolver(claimSchema) });

  const onSubmit = async (values: ClaimFormData) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("claim-account", {
        body: {
          fullName: values.fullName,
          email: values.email,
          password: values.password,
          phone: values.phone,
          agentCode: values.agentCode,
        },
      });

      // functions.invoke resolves with { error } on a non-2xx instead of
      // throwing, so a bare try/catch would report every refusal as success.
      // The function's own message is the useful one — surface it, don't
      // replace it with a generic.
      const payload = (data ?? {}) as { ok?: boolean; error?: string; displayName?: string };
      if (error || !payload.ok) {
        let message = payload.error;
        if (!message && error) {
          // Non-2xx bodies arrive on error.context for FunctionsHttpError.
          try {
            const ctx = (error as { context?: Response }).context;
            if (ctx && typeof ctx.json === "function") {
              const body = await ctx.json();
              message = body?.error;
            }
            // empty-catch-allow:body-already-consumed; the generic message below is the handler
          } catch {
            /* the response body was not JSON — fall through to the generic */
          }
        }
        toast.error(message ?? `We couldn't activate your account. Email ${BRAND.supportEmail}.`);
        return;
      }

      // The account exists now — sign them straight in rather than making them
      // retype what they just typed.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      setDone(payload.displayName ?? values.fullName);
      toast.success("Your account is live.");

      if (signInError) {
        setTimeout(() => navigate("/login"), 1800);
      } else {
        setTimeout(() => navigate("/dashboard"), 1200);
      }
    } catch (e) {
      console.error("[claim] unexpected", e);
      toast.error(`Something went wrong. Email ${BRAND.supportEmail}.`);
    } finally {
      setIsLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <GlassCard className="w-full max-w-md p-8 text-center">
          <CheckCircle2 className="h-14 w-14 mx-auto mb-4 text-emerald-500" />
          <h1 className="text-2xl font-bold mb-2">You're in, {done.split(" ")[0]}.</h1>
          <p className="text-muted-foreground">
            Your login is attached to your existing {BRAND.shortName} record. Taking you to your dashboard…
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8">
          <div className="text-center mb-6">
            <Crown className="h-10 w-10 mx-auto mb-3 text-primary" />
            <h1 className="text-2xl font-bold">Activate your {BRAND.shortName} account</h1>
            <p className="text-sm text-muted-foreground mt-2">
              You're already in the system. This connects a login to the record we
              already have for you.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="fullName">Full name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="fullName" className="pl-9" placeholder={`As ${BRAND.shortName} has it on file`} {...register("fullName")} />
              </div>
              {errors.fullName && <p className="text-sm text-destructive mt-1">{errors.fullName.message}</p>}
            </div>

            <div>
              <Label htmlFor="phone">Phone number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="phone" className="pl-9" placeholder="The one you applied with" {...register("phone")} />
              </div>
              {errors.phone && <p className="text-sm text-destructive mt-1">{errors.phone.message}</p>}
            </div>

            <div>
              <Label htmlFor="agentCode">
                Agent code <span className="text-muted-foreground font-normal">(if you have one)</span>
              </Label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="agentCode" className="pl-9" placeholder="e.g. JSMITH01" {...register("agentCode")} />
              </div>
            </div>

            <div className="pt-2 border-t border-border/50" />

            <div>
              <Label htmlFor="email">Email to sign in with</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" className="pl-9" {...register("email")} />
              </div>
              {errors.email && <p className="text-sm text-destructive mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <Label htmlFor="password">Create a password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="password" type="password" className="pl-9" {...register("password")} />
              </div>
              {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
            </div>

            <div>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="confirmPassword" type="password" className="pl-9" {...register("confirmPassword")} />
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            <GradientButton type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Matching your record…
                </>
              ) : (
                "Activate my account"
              )}
            </GradientButton>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have a login?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
