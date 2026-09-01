/**
 * /join/:token — MP-234 magic prospect join link.
 *
 * Public, token-gated. Prospect lands here after a manager pastes the link.
 * Four fields (name, phone, email, state) + optional "Do you have a life
 * insurance license?" toggle.
 *
 *   - Default (unlicensed) → creates public.applications with
 *     license_status='unlicensed'. DB triggers enqueue calendly-invite +
 *     one applicant onboarding email (outreach_queue).
 *   - Licensed toggle ON → creates public.applications with
 *     license_status='licensed'. DB triggers fire trg_bot_alert_licensed_app
 *     which pushes the critical Sam/manager alert.
 *
 * Never expose this route in nav — it's share-only.
 * Anti-fake-success: never show success unless edge fn returned ok:true.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Crown,
  Loader2,
  ArrowRight,
  ShieldCheck,
  BadgeCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePageTitle } from "@/hooks/usePageTitle";

interface Prefill {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
}

interface PrefillResponse {
  ok: boolean;
  reason?: string;
  kind?: string;
  expires_at?: string;
  prefill?: Prefill;
}

function maskPhone(v: string) {
  const d = v.replace(/\D+/g, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function JoinLink() {
  usePageTitle("Join APEX");
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();

  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [wrongKind, setWrongKind] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("");
  const [licensed, setLicensed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setInvalid("missing_token");
        setLoadingPrefill(false);
        return;
      }
      try {
        const { data, error } = await supabase.rpc("get_invite_token_prefill", {
          p_token: token,
        });
        if (cancelled) return;
        if (error) {
          setInvalid("lookup_failed");
          setLoadingPrefill(false);
          return;
        }
        const resp = (data ?? {}) as unknown as PrefillResponse;
        if (!resp.ok) {
          setInvalid(resp.reason ?? "invalid_or_used");
          setLoadingPrefill(false);
          return;
        }
        // Reject if the link is a hire link opened at /join/:token.
        if (resp.kind && resp.kind !== "join") {
          setWrongKind(true);
          setLoadingPrefill(false);
          return;
        }
        const pf = resp.prefill ?? {};
        if (pf.full_name) setFullName(pf.full_name);
        if (pf.phone) setPhone(maskPhone(pf.phone));
        if (pf.email) setEmail(pf.email);
        if (pf.state) setState(pf.state.toUpperCase().slice(0, 2));
        if (resp.expires_at) setExpiresAt(resp.expires_at);
        setLoadingPrefill(false);
      } catch {
        if (!cancelled) {
          setInvalid("lookup_failed");
          setLoadingPrefill(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit = useMemo(() => {
    return (
      fullName.trim().split(/\s+/).filter(Boolean).length >= 2 &&
      phone.replace(/\D+/g, "").length >= 10 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    );
  }, [fullName, phone, email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "consume-invite-token",
        {
          body: {
            token,
            full_name: fullName.trim(),
            phone: phone.replace(/\D+/g, ""),
            email: email.trim().toLowerCase(),
            state: state.trim().toUpperCase().slice(0, 2) || undefined,
            licensed,
          },
        },
      );
      if (error) {
        const detail = (error as { context?: { body?: string } })?.context
          ?.body;
        let parsed: { error?: string } | null = null;
        try {
          if (detail) parsed = JSON.parse(detail);
        } catch { // empty-catch-allow:jsonparse-fallback
          // noop
        }
        const code = parsed?.error ?? error.message ?? "unknown_error";
        if (
          code === "invite_invalid" ||
          code === "invite_already_used" ||
          code === "invite_expired" ||
          code === "invite_revoked"
        ) {
          setInvalid(code);
        } else {
          toast.error(`Couldn't submit: ${code}`);
        }
        setSubmitting(false);
        return;
      }
      if (!data?.ok) {
        toast.error("Submit failed. Ask for a fresh link.");
        setSubmitting(false);
        return;
      }
      toast.success(
        licensed
          ? "Locked in. Your manager will reach out fast."
          : "You're in. We'll be in touch.",
      );
      const response = data as { redirect_url?: string; application_id?: string };
      const nextUrl = licensed
        ? response.redirect_url || (response.application_id ? `/status/${response.application_id}` : "/")
        : response.application_id
          ? `/get-licensed?applicationId=${encodeURIComponent(response.application_id)}#licensing-video`
          : "/get-licensed#licensing-video";
      nav(nextUrl);
    } catch (err) {
      console.error("consume-invite-token (join) failed", err);
      toast.error("Network hiccup. Try again in a moment.");
      setSubmitting(false);
    }
  }

  if (loadingPrefill) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (wrongKind) {
    return <InviteTokenInvalid reason="wrong_kind_use_hire" />;
  }
  if (invalid) {
    return <InviteTokenInvalid reason={invalid} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-6">
          <Crown className="h-10 w-10 text-primary mb-3" />
          <h1 className="text-2xl font-bold text-center tracking-tight">
            Join APEX
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2 max-w-sm">
            Drop your info. Sam's team will reach out — no filler, no delay.
          </p>
        </div>

        <GlassCard className="p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label
                htmlFor="join-name"
                className="text-xs uppercase tracking-wide"
              >
                Full name
              </Label>
              <Input
                id="join-name"
                autoComplete="name"
                autoFocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="First Last"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div>
              <Label
                htmlFor="join-phone"
                className="text-xs uppercase tracking-wide"
              >
                Phone
              </Label>
              <Input
                id="join-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(555) 123-4567"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div>
              <Label
                htmlFor="join-email"
                className="text-xs uppercase tracking-wide"
              >
                Email
              </Label>
              <Input
                id="join-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div>
              <Label
                htmlFor="join-state"
                className="text-xs uppercase tracking-wide"
              >
                State (optional)
              </Label>
              <Input
                id="join-state"
                autoComplete="address-level1"
                value={state}
                onChange={(e) =>
                  setState(
                    e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2),
                  )
                }
                placeholder="TX"
                maxLength={2}
                className="mt-1 h-11 text-base uppercase"
              />
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
              <BadgeCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="join-licensed"
                    className="text-sm font-medium cursor-pointer"
                  >
                    I already have a life insurance license
                  </Label>
                  <Switch
                    id="join-licensed"
                    checked={licensed}
                    onCheckedChange={setLicensed}
                    data-testid="join-licensed-toggle"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {licensed
                    ? "Your manager gets pinged immediately — expect a call."
                    : "No license yet is fine. We'll walk you through it."}
                </p>
              </div>
            </div>

            <GradientButton
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full h-12 text-base"
              data-testid="join-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting…
                </>
              ) : (
                <>
                  Join APEX
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </GradientButton>

            <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              <span>
                One-use link · securely attributed to your APEX manager
                {expiresAt
                  ? ` · expires ${new Date(expiresAt).toLocaleDateString()}`
                  : ""}
              </span>
            </div>
          </form>
        </GlassCard>
      </motion.div>
    </div>
  );
}

function InviteTokenInvalid({ reason }: { reason: string }) {
  const message =
    reason === "invite_already_used"
      ? "This link has already been used."
      : reason === "invite_expired"
        ? "This link has expired."
        : reason === "invite_revoked"
          ? "This link was revoked."
          : reason === "wrong_kind_use_hire"
            ? "Wrong link. Ask your recruiter to resend the join link."
            : "This link isn't valid.";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="max-w-sm text-center">
        <Crown className="h-10 w-10 text-primary mx-auto mb-4 opacity-60" />
        <h1 className="text-xl font-bold mb-2">{message}</h1>
        <p className="text-sm text-muted-foreground">
          Ask for a fresh link and try again.
        </p>
      </div>
    </div>
  );
}
