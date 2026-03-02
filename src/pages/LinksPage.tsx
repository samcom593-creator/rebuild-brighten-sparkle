import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crown, Instagram, MessageCircle, Video, Users, Sparkles, ArrowRight,
  Loader2, CheckCircle2, X, Dumbbell, Cpu, Briefcase, Heart
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GradientButton } from "@/components/ui/gradient-button";
import { z } from "zod";

const waitlistSchema = z.object({
  firstName: z.string().trim().min(2, "First name required").max(50),
  lastName: z.string().trim().min(2, "Last name required").max(50),
  email: z.string().trim().email("Valid email required").max(255),
  phone: z.string().trim().min(10, "Valid phone required").max(20),
  motivation: z.string().trim().max(1000).optional(),
});

const socialLinks = [
  { icon: Instagram, label: "Instagram", href: "https://instagram.com/apexfinancial", gradient: "from-pink-500 to-purple-600", hoverGlow: "hover:shadow-[0_0_30px_hsl(330_80%_50%/0.3)]" },
  { icon: Video, label: "TikTok", href: "https://tiktok.com/@apexfinancial", gradient: "from-cyan-400 to-pink-500", hoverGlow: "hover:shadow-[0_0_30px_hsl(180_80%_50%/0.3)]" },
  { icon: MessageCircle, label: "Snapchat", href: "https://snapchat.com/add/apexfinancial", gradient: "from-yellow-400 to-yellow-500", hoverGlow: "hover:shadow-[0_0_30px_hsl(50_90%_55%/0.3)]" },
];

const offerCards = [
  {
    icon: Users,
    title: "Join My Team",
    subtitle: "Start your financial career — no experience needed",
    href: "/apply",
    gradient: "from-primary/20 to-primary/10",
    border: "border-primary/30",
    iconBg: "bg-primary",
    iconColor: "text-primary-foreground",
    glow: "hover:shadow-[0_0_30px_hsl(168_84%_42%/0.3)]",
    accentColor: "text-primary",
  },
  {
    icon: Dumbbell,
    title: "Elite Circle",
    subtitle: "Body, mind & money transformation mentorship",
    action: "waitlist",
    gradient: "from-amber-500/15 to-orange-500/10",
    border: "border-amber-500/30",
    iconBg: "bg-gradient-to-br from-amber-500 to-orange-600",
    iconColor: "text-white",
    glow: "hover:shadow-[0_0_30px_hsl(38_90%_55%/0.25)]",
    accentColor: "text-amber-500",
  },
  {
    icon: Cpu,
    title: "Our Systems",
    subtitle: "See the tech & tools powering our agency",
    href: "/seminar",
    gradient: "from-blue-500/15 to-indigo-500/10",
    border: "border-blue-500/30",
    iconBg: "bg-gradient-to-br from-blue-500 to-indigo-600",
    iconColor: "text-white",
    glow: "hover:shadow-[0_0_30px_hsl(220_80%_55%/0.25)]",
    accentColor: "text-blue-500",
  },
  {
    icon: Heart,
    title: "Book a Call",
    subtitle: "Chat 1-on-1 about your goals",
    href: "/schedule-call",
    gradient: "from-rose-500/15 to-pink-500/10",
    border: "border-rose-500/30",
    iconBg: "bg-gradient-to-br from-rose-500 to-pink-600",
    iconColor: "text-white",
    glow: "hover:shadow-[0_0_30px_hsl(350_80%_55%/0.25)]",
    accentColor: "text-rose-500",
  },
];

export default function LinksPage() {
  const [showEliteForm, setShowEliteForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", motivation: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async () => {
    const result = waitlistSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => { fieldErrors[issue.path[0] as string] = issue.message; });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("elite_circle_waitlist").insert({
        first_name: result.data.firstName, last_name: result.data.lastName,
        email: result.data.email, phone: result.data.phone, motivation: result.data.motivation || null,
      });
      if (error) throw error;
      setSubmitted(true);
      toast.success("You're on the waitlist! We'll be in touch.");
    } catch (err) { console.error(err); toast.error("Something went wrong. Please try again."); }
    finally { setIsSubmitting(false); }
  };

  const handleOfferClick = (card: typeof offerCards[0]) => {
    if (card.action === "waitlist") setShowEliteForm(!showEliteForm);
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-4 py-12 max-w-md mx-auto min-h-screen">
        {/* Avatar / Brand */}
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }} className="mb-6 text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent mx-auto mb-4 flex items-center justify-center shadow-lg glow-teal">
            <Crown className="h-12 w-12 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">APEX Financial</h1>
          <p className="text-sm text-muted-foreground mt-1">Build your empire. Live on your terms.</p>
        </motion.div>

        {/* Social Links */}
        <div className="w-full space-y-3 mb-6">
          {socialLinks.map((link, i) => (
            <motion.a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }}
              className={`flex items-center gap-4 w-full p-4 rounded-xl bg-card border border-border transition-all duration-300 hover:-translate-y-1 ${link.hoverGlow} group`}
            >
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${link.gradient} flex items-center justify-center flex-shrink-0`}>
                <link.icon className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-foreground">{link.label}</span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground group-hover:text-foreground transition-colors" />
            </motion.a>
          ))}
        </div>

        {/* Offer Pathway Cards */}
        <div className="w-full space-y-3 mb-6">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest text-center mb-2">What Are You Looking For?</p>
          {offerCards.map((card, i) => {
            const content = (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className={`flex items-center gap-4 w-full p-4 rounded-xl bg-gradient-to-r ${card.gradient} border ${card.border} transition-all duration-300 hover:-translate-y-1 ${card.glow} group cursor-pointer`}
                onClick={card.action ? () => handleOfferClick(card) : undefined}
              >
                <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <card.icon className={`h-5 w-5 ${card.iconColor}`} />
                </div>
                <div>
                  <span className="font-bold text-foreground block">{card.title}</span>
                  <span className="text-xs text-muted-foreground">{card.subtitle}</span>
                </div>
                <ArrowRight className={`h-4 w-4 ml-auto ${card.accentColor} group-hover:translate-x-1 transition-transform ${card.action === "waitlist" && showEliteForm ? "rotate-90" : ""}`} />
              </motion.div>
            );

            if (card.href) {
              return <Link key={card.title} to={card.href} className="block">{content}</Link>;
            }
            return content;
          })}
        </div>

        {/* Elite Circle Signup Form */}
        <AnimatePresence>
          {showEliteForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="w-full overflow-hidden">
              <GlassCard className="mt-2 p-6">
                {submitted ? (
                  <div className="text-center py-4">
                    <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-3" />
                    <h3 className="text-lg font-bold mb-1">You're In!</h3>
                    <p className="text-sm text-muted-foreground">We'll reach out when doors open.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold gradient-text">Elite Circle Waitlist</h3>
                      <button onClick={() => setShowEliteForm(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 mb-5">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">An overall life makeover</span> — from out of shape and financially stuck to highly successful, in peak fitness, and financially free.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="ec-fn" className="text-xs">First Name *</Label>
                          <Input id="ec-fn" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="First" className="bg-input" />
                          {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ec-ln" className="text-xs">Last Name *</Label>
                          <Input id="ec-ln" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Last" className="bg-input" />
                          {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ec-email" className="text-xs">Email *</Label>
                        <Input id="ec-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" className="bg-input" />
                        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ec-phone" className="text-xs">Phone *</Label>
                        <Input id="ec-phone" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(555) 123-4567" className="bg-input" />
                        {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ec-motivation" className="text-xs">What's your biggest goal? (optional)</Label>
                        <Textarea id="ec-motivation" value={form.motivation} onChange={e => setForm({ ...form, motivation: e.target.value })} placeholder="Financial freedom, fitness transformation..." className="bg-input min-h-[80px]" maxLength={1000} />
                      </div>
                      <GradientButton onClick={handleSubmit} disabled={isSubmitting} className="w-full">
                        {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Joining...</> : <>Join the Waitlist <Sparkles className="h-4 w-4 ml-2" /></>}
                      </GradientButton>
                    </div>
                  </>
                )}
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="mt-auto pt-8 text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
            Powered by <span className="text-primary/70 font-semibold">Apex Financial</span>
          </p>
        </div>
      </div>
    </div>
  );
}
