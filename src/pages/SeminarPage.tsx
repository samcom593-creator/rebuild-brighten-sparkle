import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crown, CalendarClock, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { GlassCard } from "@/components/ui/glass-card";
import { GradientButton } from "@/components/ui/gradient-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const schema = z.object({
  firstName: z.string().min(2, "First name is required").max(50),
  lastName: z.string().min(2, "Last name is required").max(50),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required").max(20),
  licenseStatus: z.enum(["licensed", "unlicensed", "unknown"]),
  seminarSlot: z.string().min(1, "Pick a seminar date"),
  reminderOptIn: z.boolean().refine((value) => value === true, "Confirm reminder opt-in"),
});

type FormData = z.infer<typeof schema>;

// Sam runs Wed 7pm CT and Sat 10am CT weekly. seminar_date column is type `date`
// so we send YYYY-MM-DD. Time of day is implied by day-of-week.
function nextSeminarSlots(): { date: string; label: string; clockLabel: string }[] {
  const slots: { date: string; label: string; clockLabel: string }[] = [];
  const now = new Date();

  for (let add = 0; add < 28 && slots.length < 6; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    const dow = d.getDay();
    if (dow !== 3 && dow !== 6) continue;
    const clockLabel = dow === 3 ? "7:00 PM CT" : "10:00 AM CT";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${dd}`;
    const label = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(d);
    slots.push({ date: dateStr, label: `${label} · ${clockLabel}`, clockLabel });
  }
  return slots;
}

export default function SeminarPage() {
  usePageTitle("Join the APEX Career Seminar · Group Interview");
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<null | { slotLabel: string; isNew: boolean }>(null);

  const slots = useMemo(() => nextSeminarSlots(), []);

  // Real meeting URL comes from system_settings so Sam can rotate it
  // (Zoom/Meet link) without a redeploy. Falls back to a /seminar/join
  // route for the rare case the row is missing.
  const meetingCfg = useQuery({
    queryKey: ["seminar-meeting-url"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", ["seminar_meeting_url", "seminar_meeting_url_label"]);
      const map = new Map((data ?? []).map((r: any) => [r.key, r.value as string]));
      return {
        url: map.get("seminar_meeting_url") || "/seminar/join",
        label: map.get("seminar_meeting_url_label") || "Join the seminar",
      };
    },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: params.get("first") ?? params.get("first_name") ?? "",
      lastName: params.get("last") ?? params.get("last_name") ?? "",
      email: params.get("email") ?? "",
      phone: params.get("phone") ?? "",
      licenseStatus: (params.get("license") as "licensed" | "unlicensed" | "unknown") || "unlicensed",
      seminarSlot: slots[0]?.date ?? "",
      reminderOptIn: false,
    },
  });

  // Capture UTMs from URL once for analytics passthrough
  const utms = useMemo(() => ({
    utm_source: params.get("utm_source") || undefined,
    utm_medium: params.get("utm_medium") || undefined,
    utm_campaign: params.get("utm_campaign") || undefined,
  }), [params]);

  async function onSubmit(values: FormData) {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("seminar-register", {
        body: {
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email.trim().toLowerCase(),
          phone: values.phone,
          seminarDate: values.seminarSlot,
          licenseStatus: values.licenseStatus,
          reminderOptIn: values.reminderOptIn,
          utm: utms,
        },
      });

      if (error) {
        let message = error.message;
        const context = (error as any).context;
        if (context && typeof context.clone === "function") {
          try {
            const body = await context.clone().json();
            message = body?.error ?? message;
          } catch { // empty-catch-allow:jsonparse-fallback
            // Keep Supabase's original function error when the body is not JSON.
          }
        }
        throw new Error(message);
      }
      if (!data?.ok) throw new Error(data?.error ?? "Couldn't register — try again in a moment.");

      const slotLabel = slots.find((s) => s.date === values.seminarSlot)?.label ?? values.seminarSlot;
      setSuccess({ slotLabel, isNew: !!data?.is_new_application });
      toast.success("You're registered. Check your email for confirmation.");
    } catch (err: any) {
      console.error("[seminar.register]", err);
      toast.error(err?.message ?? "Couldn't register — try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  // PL-SAM-2026-06-03-009: Hide seminar UI for unlicensed prospects. The
  // seminar is the last step before hire — unlicensed people need a license
  // first, not a 60-minute group interview. Default form state is
  // "unlicensed" so most landings hit this gate; one-click flip to
  // "licensed" exits the gate for already-licensed visitors who arrived
  // with a stale URL default.
  const watchedLicense = form.watch("licenseStatus");

  if (!success && watchedLicense === "unlicensed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl"
        >
          <GlassCard className="p-6 sm:p-8 space-y-5 text-center">
            <div className="flex items-center justify-center gap-2">
              <Crown className="h-6 w-6 text-primary" />
              <span className="text-base font-bold" style={{ fontFamily: "Syne" }}>APEX Financial</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
              You need your license first.
            </h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The seminar is the final step before we hire you. Get licensed first — most agents finish the course, exam, and license issuance in 2-4 weeks — then we put you on the seminar and write you a check.
            </p>
            <Link to="/get-licensed" className="block">
              <GradientButton className="w-full text-base h-14" size="lg">
                Start prelicensing course
                <ArrowRight className="ml-2 h-4 w-4" />
              </GradientButton>
            </Link>
            <button
              type="button"
              onClick={() => form.setValue("licenseStatus", "licensed", { shouldValidate: true })}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
            >
              I'm already licensed → continue to seminar signup
            </button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl"
        >
          <GlassCard className="p-8 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-primary">
              <CheckCircle2 className="h-6 w-6" />
              <span className="text-sm uppercase tracking-wider">Registered</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold">
              You're locked in for {success.slotLabel}
            </h1>
            <p className="text-muted-foreground">
              You'll get a reminder 24 hours before and 1 hour before. Bring your questions and bring focus —
              we move fast.
            </p>
            {meetingCfg.data?.url ? (
              <a
                href={meetingCfg.data.url}
                target={meetingCfg.data.url.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="inline-block"
              >
                <GradientButton className="w-full">
                  {meetingCfg.data.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </GradientButton>
              </a>
            ) : null}
            {success.isNew ? (
              <div className="border border-primary/30 bg-primary/5 rounded-md p-4 text-left">
                <p className="text-sm font-semibold mb-1">Finish your application while you wait</p>
                <p className="text-xs text-muted-foreground mb-3">
                  We started an application from your registration — finish it in 90 seconds so you're ready on day one.
                </p>
                <Link to="/apply">
                  <GradientButton className="w-full" variant="ghost">
                    Finish my application
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </GradientButton>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                We already have an application on file for you. See you on the call.
              </p>
            )}
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 sm:p-6 text-center"
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <Crown className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold" style={{ fontFamily: "Syne" }}>APEX Financial</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">Lock your seat for the next career seminar</h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Group interview with the team. Live, fast-paced, 60 minutes. You'll leave knowing
          exactly what your first 30 days look like.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15 }}
        className="flex-1 flex items-start justify-center px-4 pb-8"
      >
        <GlassCard className="w-full max-w-xl p-6 sm:p-8 space-y-5">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" autoComplete="given-name" {...form.register("firstName")} />
                {form.formState.errors.firstName && (
                  <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" autoComplete="family-name" {...form.register("lastName")} />
                {form.formState.errors.lastName && (
                  <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" autoComplete="tel" {...form.register("phone")} />
                {form.formState.errors.phone && (
                  <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>License status</Label>
              <Select
                value={form.watch("licenseStatus")}
                onValueChange={(v) => form.setValue("licenseStatus", v as FormData["licenseStatus"], { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select your license status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlicensed">Not licensed yet</SelectItem>
                  <SelectItem value="licensed">Licensed already</SelectItem>
                  <SelectItem value="unknown">Not sure</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Pick a seminar
              </Label>
              <Select
                value={form.watch("seminarSlot")}
                onValueChange={(v) => form.setValue("seminarSlot", v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a date" />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s.date} value={s.date}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.seminarSlot && (
                <p className="text-xs text-destructive">{form.formState.errors.seminarSlot.message}</p>
              )}
            </div>

            <div className="rounded-lg border border-border/70 p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="reminderOptIn"
                  checked={form.watch("reminderOptIn")}
                  onCheckedChange={(checked) => form.setValue("reminderOptIn", checked === true, { shouldValidate: true })}
                />
                <div className="space-y-1">
                  <Label htmlFor="reminderOptIn" className="text-sm leading-snug">
                    Send me email and SMS reminders for this seminar.
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    We log the confirmation, manager alert, and Discord alert for review in the communication center.
                  </p>
                  {form.formState.errors.reminderOptIn && (
                    <p className="text-xs text-destructive">{form.formState.errors.reminderOptIn.message}</p>
                  )}
                </div>
              </div>
            </div>

            <GradientButton type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving your seat…
                </span>
              ) : (
                "Lock my seat"
              )}
            </GradientButton>

            <p className="text-[11px] text-muted-foreground text-center">
              Reply STOP to opt out of SMS reminders.
            </p>
          </form>
        </GlassCard>
      </motion.div>

      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Already applied? <Link to="/apply" className="underline">Finish your application →</Link>
        </p>
      </div>
    </div>
  );
}
