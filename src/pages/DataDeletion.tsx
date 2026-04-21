import { useState } from "react";
import { Trash2, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * Meta app review requires a Data Deletion URL.
 * Self-service form → logs a deletion request; we process within 30 days.
 */
export default function DataDeletion() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await supabase.from("data_deletion_requests" as any).insert({
        email: email.trim().toLowerCase(),
        reason: reason.trim() || null,
      });
      setSubmitted(true);
      toast.success("Request received. We'll process it within 30 days.");
    } catch (err: any) {
      toast.error(err?.message ?? "Submission failed. Email info@kingofsales.net instead.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-xl bg-rose-500/15 flex items-center justify-center">
            <Trash2 className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <h1 className="apex-headline text-3xl md:text-4xl font-bold">Data Deletion</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Request removal of your personal data from APEX Financial.
            </p>
          </div>
        </div>

        <section className="space-y-3 text-muted-foreground leading-relaxed">
          <p>
            You have the right to request deletion of any personal data we hold about you —
            including application submissions, profile data, Instagram handles, messages,
            and any files you uploaded. Submit the form below and we'll complete deletion
            within <strong className="text-foreground">30 days</strong> of verifying your identity.
          </p>
          <p>
            Some records may be retained for legal / regulatory compliance (insurance
            licensing records, contract confirmations) as required by law.
          </p>
        </section>

        {submitted ? (
          <div className="p-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-start gap-4">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">Request received</h3>
              <p className="text-sm text-muted-foreground">
                We've logged your deletion request for <code className="text-foreground">{email}</code>.
                You'll receive a confirmation email once processing completes (within 30 days).
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-6 rounded-xl border border-border/60 bg-card/40">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email address</label>
              <Input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Use the email you originally submitted to APEX.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Reason (optional)</label>
              <Textarea
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Anything you'd like us to know…"
              />
            </div>

            <Button type="submit" className="w-full gap-2" size="lg" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Submit deletion request
            </Button>
          </form>
        )}

        <div className="text-sm text-muted-foreground text-center pt-4 border-t border-border/40">
          Prefer email? Write to{" "}
          <a href="mailto:info@kingofsales.net" className="text-primary hover:underline inline-flex items-center gap-1">
            <Mail className="h-3 w-3" /> info@kingofsales.net
          </a>{" "}
          with "Data deletion" in the subject.
        </div>
      </div>
    </div>
  );
}
