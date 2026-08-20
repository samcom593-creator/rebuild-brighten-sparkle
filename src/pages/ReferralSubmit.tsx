import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { US_STATES } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// PL-SAM-2026-06-03-008 wave-85: collapsed 8-field 4-grouped-section layout down
// to a single vertical 6-field stack. Removed license-status select (was always
// defaulting to "unknown" — we ask after first contact instead) and the
// "How do you know them?" relationship dropdown (zero signal upfront).
// Mobile-first vertical scan, one decision per line, ship in <30 seconds.
const schema = z
  .object({
    firstName: z.string().min(2, "First name required").max(50),
    lastName: z.string().min(2, "Last name required").max(50),
    email: z.string().email("Valid email").optional().or(z.literal("")),
    phone: z.string().optional(),
    state: z.string().min(2, "Pick a state"),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => (v.email && v.email.length > 0) || (v.phone && v.phone.length >= 10),
    { message: "Need either email or phone", path: ["email"] },
  );

type FormData = z.infer<typeof schema>;

export default function ReferralSubmit() {
  usePageTitle("Submit a Referral · APEX");
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<null | {
    name: string;
    isDup: boolean;
    matchingApplicationId?: string | null;
  }>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormData) {
    setSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("submit_referral", {
        p_first_name: values.firstName,
        p_last_name: values.lastName,
        p_email: values.email || null,
        p_phone: values.phone || null,
        p_state: values.state,
        p_license: "unknown",
        p_relationship: null,
        p_notes: values.notes ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setConfirmation({
        name: `${values.firstName} ${values.lastName}`,
        isDup: !!row?.is_duplicate,
        matchingApplicationId: row?.matching_application_id ?? null,
      });
      toast.success(
        row?.matching_application_id
          ? "This person already applied — you're logged as referrer."
          : row?.is_duplicate
            ? "We already had this referral on file — you're still logged."
            : "Referral submitted — we'll follow up within 24 hours.",
      );
    } catch (err: any) {
      console.error("[referral.submit]", err);
      toast.error(err?.message ?? "Couldn't submit the referral.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="p-4 sm:p-6 max-w-xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-primary">
                <CheckCircle2 className="h-6 w-6" />
                <span className="text-xs uppercase tracking-wider">Submitted</span>
              </div>
              <h1 className="text-2xl font-bold">Thanks for sending {confirmation.name}</h1>
              <p className="text-sm text-muted-foreground">
                {confirmation.matchingApplicationId
                  ? "This person already submitted an application. We logged you as the referrer — if they convert, the bonus is yours."
                  : confirmation.isDup
                    ? "We already had this person in the system — your name is logged in case they convert."
                    : "We'll make first contact within 24 hours. You'll see the status update in your referrals list."}
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <Button variant="outline" onClick={() => setConfirmation(null)}>Submit another</Button>
                <Button onClick={() => navigate("/dashboard/referrals/mine")}>See my referrals</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <div className="mb-5 rounded-md border border-primary/40 bg-white dark:bg-card p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Referral bonus</p>
        <h2 className="text-lg font-bold mt-1">$300 when your referral hits their first $10k in production.</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Paid automatically when the agent you sent crosses $10k AP. We track it for you in <span className="text-foreground">My Referrals</span>.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <h1 className="text-xl font-bold mb-1">Send us someone who could win.</h1>
          <p className="text-sm text-muted-foreground mb-5">
            First contact in 24 hours. Takes 30 seconds.
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name *</Label>
              <Input id="firstName" autoComplete="given-name" {...form.register("firstName")} />
              {form.formState.errors.firstName && (
                <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name *</Label>
              <Input id="lastName" autoComplete="family-name" {...form.register("lastName")} />
              {form.formState.errors.lastName && (
                <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" autoComplete="tel" {...form.register("phone")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              <p className="text-[11px] text-muted-foreground">Phone or email — at least one.</p>
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>State *</Label>
              <Select
                value={form.watch("state")}
                onValueChange={(v) => form.setValue("state", v, { shouldValidate: true })}
              >
                <SelectTrigger><SelectValue placeholder="Pick a state" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s: any) => (
                    <SelectItem key={s.value ?? s} value={s.value ?? s}>{s.label ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.state && (
                <p className="text-xs text-destructive">{form.formState.errors.state.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Anything we should know? (background, why they'd be a fit, when to reach out)"
                {...form.register("notes")}
              />
            </div>

            <Button type="submit" disabled={submitting} className="w-full" size="lg">
              {submitting ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</span>
              ) : (
                "Submit referral"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
