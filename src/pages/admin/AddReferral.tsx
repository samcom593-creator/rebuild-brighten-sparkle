import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { US_STATES } from "@/lib/constants";
import { toast } from "sonner";

/**
 * Manager self-serve referral form.
 *
 * Sam-feedback 2026-06-03: managers should be able to drop a recruit without
 * texting Sam. This form takes the 6 required fields, stamps the current
 * user's agent id as referral_manager_id + referral_source='manager_submit',
 * and routes the applicant into the same triggers as a public submission.
 */

export default function AddReferral() {
  usePageTitle("Add Referral · APEX Financial");
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: myAgent } = useQuery({
    queryKey: ["myAgentId", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<"licensed" | "unlicensed">("unlicensed");
  const [niprNumber, setNiprNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const formatPhone = (raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!myAgent?.id) {
      toast.error("Could not resolve your agent record. Refresh and try again.");
      return;
    }
    const missing: string[] = [];
    if (!firstName.trim()) missing.push("First name");
    if (!lastName.trim()) missing.push("Last name");
    if (!email.trim()) missing.push("Email");
    if (!phone.trim()) missing.push("Phone");
    if (!state) missing.push("State");
    if (licenseStatus === "licensed" && !niprNumber.trim()) missing.push("NPN");
    if (missing.length) {
      toast.error(`Missing: ${missing.join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("applications")
        .insert({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.replace(/\D/g, ""),
          state,
          license_status: licenseStatus,
          nipr_number: licenseStatus === "licensed" ? niprNumber.trim() : null,
          referral_manager_id: myAgent.id,
          referral_source: "manager_submit",
          referral_source_detail: myAgent.display_name ?? "manager",
          status: "new",
          source: "manager_submit",
          consent_form_version: "manager_submit_v1",
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success(`Submitted. ${firstName} is in your pipeline.`);
      navigate(`/admin/my-applicants`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="container mx-auto max-w-xl p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Add a Referral
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              The applicant will be attributed to you. They'll get the same automated emails
              + bot DM as a public applicant.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First name *</Label>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last name *</Label>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="state">State *</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="state">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s: any) => (
                      <SelectItem key={s.value ?? s} value={s.value ?? s}>{s.label ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="licenseStatus">License status *</Label>
                <Select value={licenseStatus} onValueChange={(v: "licensed" | "unlicensed") => setLicenseStatus(v)}>
                  <SelectTrigger id="licenseStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="licensed">Licensed</SelectItem>
                    <SelectItem value="unlicensed">Unlicensed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {licenseStatus === "licensed" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="nipr">NPN *</Label>
                  <Input id="nipr" value={niprNumber} onChange={(e) => setNiprNumber(e.target.value)} required />
                </div>
              ) : null}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...
                  </>
                ) : (
                  "Submit Referral"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
