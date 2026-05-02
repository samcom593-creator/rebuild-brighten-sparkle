/**
 * /join — single shareable link admins send to agents.
 * One page does both sign-in + signup:
 *   - If the email already has an auth account → sign in with password
 *   - If not → create the account on the spot with that email + password
 * No separate signup flow to confuse anyone.
 */

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Mail, Lock, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Join() {
  usePageTitle("Join APEX");
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"auto" | "signup">("auto");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || password.length < 6) {
      toast.error("Enter your email and a password of 6+ characters");
      return;
    }
    setLoading(true);

    try {
      // Try sign-in first (the email probably already has an account if an admin added them)
      const signIn = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (!signIn.error) {
        toast.success("Welcome back");
        nav("/dashboard");
        return;
      }

      // Sign-in failed — usually means "Invalid login" OR no account exists.
      // Try to sign up; if the email is already taken with a different password, Supabase will tell us.
      const signUp = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: firstName || undefined },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (signUp.error) {
        // If the account exists but the password they typed was wrong
        if (/already/i.test(signUp.error.message)) {
          toast.error("An account with this email exists — the password didn't match. Try /forgot.");
        } else {
          toast.error(signUp.error.message);
        }
        return;
      }

      if (signUp.data.session) {
        toast.success("Account created — welcome to APEX");
        nav("/dashboard");
      } else {
        toast.success("Check your email to confirm your account");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-violet-500/20">
              <Crown className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Welcome to APEX</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and password. First time? We'll create your account automatically.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">First name</Label>
                <Input id="name" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Alex" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email" type="email" autoComplete="email" required
                  className="pl-9"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password" type="password" autoComplete="current-password" required minLength={6}
                  className="pl-9"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="6+ characters"
                />
              </div>
              <p className="text-xs text-muted-foreground">Pick something you'll remember — you set it now, use it forever.</p>
            </div>

            <GradientButton type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
              {loading ? "Signing in…" : "Continue"}
            </GradientButton>
          </form>

          <div className="text-center text-xs text-muted-foreground space-y-1">
            <div>
              Forgot your password? <Link to="/login" className="text-primary underline">Reset it</Link>
            </div>
            <div>
              Already know your account is set up? <Link to="/login" className="text-primary underline">Regular sign in</Link>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
