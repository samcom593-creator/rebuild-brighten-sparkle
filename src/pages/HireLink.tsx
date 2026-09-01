/**
 * /hire/:token — MP-233 magic hire link.
 *
 * Public, token-gated. Prospect lands here after Sam pastes their link.
 * Name, phone, email, and an explicit license branch, one CTA — "Join APEX."
 *
 * On submit → POST /functions/v1/consume-invite-token → agent row created,
 * magic-login token minted, redirect to /magic-login?token=... (or /agent-hub).
 *
 * Anti-fake-success: never show success unless the edge fn returned ok:true.
 * Invalid/used/expired tokens render <InviteTokenInvalid /> — no form.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  PostSubmitOnboardingVideo,
  type PostSubmitOnboardingVideoHandle,
} from "@/components/onboarding/PostSubmitOnboardingVideo";

interface Prefill {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  license_status?: "licensed" | "unlicensed" | null;
  license_status_locked?: boolean | null;
}

interface PrefillResponse {
  ok: boolean;
  reason?: string;
  kind?: string;
  target_role?: string;
  expires_at?: string;
  prefill?: Prefill;
}

function maskPhone(v: string) {
  const d = v.replace(/\D+/g, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function HireLink() {
  usePageTitle("Activate your APEX account");
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();

  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nipr, setNipr] = useState("");
  const [licensedHire, setLicensedHire] = useState<boolean | null>(null);
  const [lockedLicenseStatus, setLockedLicenseStatus] = useState<"licensed" | "unlicensed" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const onboardingPlayerRef = useRef<PostSubmitOnboardingVideoHandle>(null);

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
        const pf = resp.prefill ?? {};
        if (pf.full_name) setFullName(pf.full_name);
        if (pf.phone) setPhone(maskPhone(pf.phone));
        if (pf.email) setEmail(pf.email);
        if (pf.license_status_locked && (pf.license_status === "licensed" || pf.license_status === "unlicensed")) {
          setLockedLicenseStatus(pf.license_status);
          setLicensedHire(pf.license_status === "licensed");
        } else if (resp.target_role === "hired_licensed") {
          setLicensedHire(true);
        }
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
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
      licensedHire !== null &&
      // Licensed producers must give the same 5–10 digit NPN accepted by the
      // contracting intake. One validation contract prevents a hire from
      // activating successfully and then failing silently downstream.
      (licensedHire !== true || /^\d{5,10}$/.test(nipr.replace(/\D+/g, "")))
    );
  }, [fullName, phone, email, licensedHire, nipr]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !canSubmit || submitting) return;
    const onboardingPrepared = onboardingPlayerRef.current?.prepare() ?? false;
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
            nipr_number: nipr.trim() || undefined,
            licensed: licensedHire === true,
          },
        },
      );
      if (error) {
        const detail = (error as { context?: { body?: string } })?.context?.body;
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
          toast.error(`Couldn't activate: ${code}`);
        }
        if (onboardingPrepared) await onboardingPlayerRef.current?.cancel();
        setSubmitting(false);
        return;
      }
      if (!data?.ok) {
        toast.error("Activation failed. Ask Sam for a fresh link.");
        if (onboardingPrepared) await onboardingPlayerRef.current?.cancel();
        setSubmitting(false);
        return;
      }
      toast.success("You're in. Welcome to APEX.");
      const redirect = (data as { redirect_url?: string })?.redirect_url;
      // /agent-hub does not exist — a just-hired agent was landing on the
      // NotFound catch-all right after "You're in." Send them to the real
      // agent home (or /agent-login if the session isn't established yet).
      const nextUrl = redirect || "/agent-portal?welcome=1";
      if (onboardingPrepared) {
        await onboardingPlayerRef.current?.start(nextUrl);
      } else {
        nav(nextUrl);
      }
    } catch (err) {
      console.error("consume-invite-token failed", err);
      toast.error("Network hiccup. Try again in a moment.");
      if (onboardingPrepared) await onboardingPlayerRef.current?.cancel();
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

  if (invalid) {
    return <InviteTokenInvalid reason={invalid} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <PostSubmitOnboardingVideo
        ref={onboardingPlayerRef}
        onFinished={(nextUrl) => nav(nextUrl)}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-6">
          <Crown className="h-10 w-10 text-primary mb-3" />
          <h1 className="text-2xl font-bold text-center tracking-tight">
            You're in. Activate your APEX account.
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Confirm your info — your manager will reach out.
          </p>
        </div>

        <GlassCard className="p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="hire-name" className="text-xs uppercase tracking-wide">
                Full name
              </Label>
              <Input
                id="hire-name"
                autoComplete="name"
                autoFocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="First Last"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div>
              <Label htmlFor="hire-phone" className="text-xs uppercase tracking-wide">
                Phone
              </Label>
              <Input
                id="hire-phone"
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
              <Label htmlFor="hire-email" className="text-xs uppercase tracking-wide">
                Email
              </Label>
              <Input
                id="hire-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide">
                License path <span className="text-rose-400">*</span>
              </Label>
              {lockedLicenseStatus ? (
                <div className="rounded-lg border border-primary/40 bg-primary/10 p-3" data-testid="hire-license-path-locked">
                  <span className="block text-sm font-semibold">
                    {lockedLicenseStatus === "licensed" ? "Licensed agent" : "Unlicensed recruit"}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {lockedLicenseStatus === "licensed"
                      ? "Your manager selected the fast-track contracting path."
                      : "Your manager selected the course → exam → fingerprints roadmap."}
                  </span>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="License status">
                <button
                  type="button"
                  onClick={() => setLicensedHire(true)}
                  aria-pressed={licensedHire === true}
                  data-testid="hire-licensed"
                  className={`rounded-lg border p-3 text-left transition-colors ${licensedHire === true ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
                >
                  <span className="block text-sm font-semibold">Yes, licensed</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Start contracting now</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setLicensedHire(false); setNipr(""); }}
                  aria-pressed={licensedHire === false}
                  data-testid="hire-unlicensed"
                  className={`rounded-lg border p-3 text-left transition-colors ${licensedHire === false ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
                >
                  <span className="block text-sm font-semibold">Not yet</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Start licensing roadmap</span>
                </button>
              </div>
              )}
            </div>

            {licensedHire === true && (
              <div>
                <Label htmlFor="hire-npn" className="text-xs uppercase tracking-wide">
                  NPN <span className="text-rose-400">*</span>
                </Label>
                <Input
                  id="hire-npn"
                  inputMode="numeric"
                  value={nipr}
                  onChange={(e) => setNipr(e.target.value)}
                  placeholder="National Producer Number"
                  className="mt-1 h-11 text-base"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Required. Submission starts the contracting spreadsheet and private support desk automatically.
                </p>
              </div>
            )}

            <GradientButton
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full h-12 text-base"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Activating…
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
                One-use link
                {expiresAt ? ` · expires ${new Date(expiresAt).toLocaleDateString()}` : ""}
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
          : "This link isn't valid.";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="max-w-sm text-center">
        <Crown className="h-10 w-10 text-primary mx-auto mb-4 opacity-60" />
        <h1 className="text-xl font-bold mb-2">{message}</h1>
        <p className="text-sm text-muted-foreground">
          Ask Sam for a fresh link and try again.
        </p>
      </div>
    </div>
  );
}
