import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// PL-014 — destination for the magic-link in Supabase's password-reset email.
// Supabase puts a `?code=...` (or `#access_token=...`) on the redirect URL and
// the SDK exchanges it for a session automatically. Once that session is live,
// `supabase.auth.updateUser({ password })` lands the new password on the user
// and we send them back to /login.

export default function ResetPassword() {
  usePageTitle("Reset password · APEX Financial");
  const navigate = useNavigate();
  const [sessionReady, setSessionReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      // The SDK auto-exchanges ?code= for a session via detectSessionInUrl on import.
      // We wait up to ~3s for the session to land, then surface a friendly error if it didn't.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) { setSessionReady(true); return; }
        await new Promise(r => setTimeout(r, 200));
      }
      if (!cancelled) setLinkInvalid(true);
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated");
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative bg-background text-foreground">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-4 mb-6">
            <span className="relative h-12 w-12 rounded-md flex items-center justify-center bg-white dark:bg-card border border-primary/40  ">
              <Crown className="h-6 w-6 text-primary" />
            </span>
            <div className="flex flex-col items-start leading-none">
              <span className="text-2xl font-bold brand-gradient tracking-wider">APEX</span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-1">Financial</span>
            </div>
          </div>
          <h1
            className="font-extrabold mb-3 brand-gradient leading-tight tracking-tight"
            // 2026-08-06: teal glow behind the gold wordmark, twin of Login.tsx.
            style={{ fontSize: "clamp(2rem, 7vw, 3.5rem)", filter: "drop-shadow(0 0 30px hsl(var(--primary) / 0.35))" }}
          >
            Set new password
          </h1>
          <p className="text-muted-foreground">Choose something only you would type.</p>
        </div>

        <GlassCard className="p-4 sm:p-8">
          {linkInvalid ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-destructive">
                This reset link is invalid or expired. Request a new one from the login page.
              </p>
              <GradientButton type="button" className="w-full" onClick={() => navigate("/login")}>
                Back to sign in
              </GradientButton>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
              <p className="text-sm">Password updated. Redirecting to sign in…</p>
            </div>
          ) : !sessionReady ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-input"
                    minLength={6}
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-input"
                    minLength={6}
                  />
                </div>
              </div>
              <GradientButton type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Update password
              </GradientButton>
            </form>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}
