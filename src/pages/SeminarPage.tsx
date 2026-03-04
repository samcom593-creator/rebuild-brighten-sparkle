import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, Users, Mail, Phone, CheckCircle, Award, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function SeminarPage() {
  const [searchParams] = useSearchParams();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  // Pre-fill from URL params
  useEffect(() => {
    const fn = searchParams.get("first_name");
    const ln = searchParams.get("last_name");
    const em = searchParams.get("email");
    if (fn) setFirstName(fn);
    if (ln) setLastName(ln);
    if (em) setEmail(em);
  }, [searchParams]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("seminar_registrations").insert({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        source: "landing_page",
      } as any);
      if (error) throw error;
      setSubmitted(true);
      toast.success("You're registered!");
    } catch {
      toast.error("Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
        >
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">You're In! 🎉</h2>
          <p className="text-muted-foreground mb-4">
            You've been registered for the weekly seminar. We'll send you a reminder before it starts.
          </p>
          <Badge variant="outline" className="text-sm">
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            Every Thursday at 7:00 PM CST
          </Badge>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative max-w-4xl mx-auto px-4 py-16 sm:py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Badge variant="outline" className="mb-4 text-sm">
              <Clock className="h-3.5 w-3.5 mr-1" />
              Every Thursday • 7:00 PM CST
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold mb-4 tracking-tight">
              Weekly Career Seminar
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              Learn how top producers in the life insurance industry are building 6-figure careers.
              Free, live, and packed with value.
            </p>
          </motion.div>

          {/* Benefits */}
          <div className="grid sm:grid-cols-3 gap-4 mb-12 max-w-2xl mx-auto">
            {[
              { icon: Award, label: "Industry Insights", desc: "Learn from top earners" },
              { icon: Users, label: "Live Q&A", desc: "Get your questions answered" },
              { icon: CalendarDays, label: "Weekly", desc: "Every Thursday at 7 PM" },
            ].map((item) => (
              <div key={item.label} className="bg-card border border-border rounded-xl p-4 text-center">
                <item.icon className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="font-semibold text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Registration Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-md mx-auto"
          >
            <form onSubmit={handleRegister} className="bg-card border border-border rounded-2xl p-6 space-y-4 text-left">
              <h3 className="font-semibold text-lg text-center">Reserve Your Spot</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">First Name *</label>
                  <Input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="John"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Last Name *</label>
                  <Input
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="Doe"
                    required
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email *</label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone (optional)</label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="mt-1"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Registering..." : "Register Now — It's Free"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                By registering, you agree to receive reminder emails about the seminar.
              </p>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
