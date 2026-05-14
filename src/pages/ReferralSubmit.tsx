import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2, Users, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const schema = z
  .object({
    firstName: z.string().min(2, "First name required").max(50),
    lastName: z.string().min(2, "Last name required").max(50),
    email: z.string().email("Valid email").optional().or(z.literal("")),
    phone: z.string().optional(),
    state: z.string().min(2),
    license: z.enum(["licensed", "unlicensed", "unknown"]),
    relationship: z.string().optional(),
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
  const [confirmation, setConfirmation] = useState<null | { name: string; isDup: boolean }>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { license: "unknown" },
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
        p_license: values.license,
        p_relationship: values.relationship ?? null,
        p_notes: values.notes ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setConfirmation({
        name: `${values.firstName} ${values.lastName}`,
        isDup: !!row?.is_duplicate,
      });
      toast.success(
        row?.is_duplicate
          ? "We already had this person — you're still logged."
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
                {confirmation.isDup
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
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Submit a referral
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Send us someone who could win in this business. We move fast — first contact inside 24 hours.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name *</Label>
                <Input id="firstName" {...form.register("firstName")} />
                {form.formState.errors.firstName && (
                  <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name *</Label>
                <Input id="lastName" {...form.register("lastName")} />
                {form.formState.errors.lastName && (
                  <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" {...form.register("phone")} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Need at least one — email or phone.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <Label>License status</Label>
                <Select
                  value={form.watch("license")}
                  onValueChange={(v) => form.setValue("license", v as FormData["license"], { shouldValidate: true })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlicensed">Not licensed</SelectItem>
                    <SelectItem value="licensed">Licensed</SelectItem>
                    <SelectItem value="unknown">Not sure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="relationship">How do you know them?</Label>
              <Select
                value={form.watch("relationship") ?? ""}
                onValueChange={(v) => form.setValue("relationship", v)}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="friend">Friend</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                  <SelectItem value="coworker">Coworker</SelectItem>
                  <SelectItem value="former_colleague">Former colleague</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (what makes them a good fit?)</Label>
              <Textarea id="notes" rows={3} {...form.register("notes")} />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
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
