import { useState } from "react";
import { Check, Shield, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const packages = [
  {
    name: "Standard Leads",
    price: 250,
    features: ["30 days old or less", "Pre-qualified prospects", "Verified contact info", "Weekly delivery"],
    popular: false,
  },
  {
    name: "Premium Leads",
    price: 350,
    features: ["Fresh this week", "Highest conversion rates", "Priority delivery", "Exclusive territories"],
    popular: true,
  },
];

const trustSignals = [
  { icon: Shield, text: "Real people who requested info" },
  { icon: Check, text: "Verified phone numbers" },
  { icon: TrendingUp, text: "Agents average 3.2x ROI" },
];

export function ApexLeadsSection() {
  const [showModal, setShowModal] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<typeof packages[0] | null>(null);
  const [step, setStep] = useState<"choose" | "confirm" | "done">("choose");
  const [transactionId, setTransactionId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"venmo" | "cashapp">("venmo");
  const [submitting, setSubmitting] = useState(false);

  const handlePurchase = (pkg: typeof packages[0]) => {
    setSelectedPkg(pkg);
    setStep("choose");
    setShowModal(true);
  };

  const handlePayClicked = (method: "venmo" | "cashapp") => {
    setPaymentMethod(method);
    if (method === "venmo") window.open("https://venmo.com/ApexFinancial", "_blank");
    else window.open("https://cash.app/$ApexFinancial", "_blank");
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (!selectedPkg) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("notify-lead-purchase", {
        body: {
          packageType: selectedPkg.name,
          amountPaid: selectedPkg.price,
          paymentMethod,
          transactionId: transactionId || "N/A",
        },
      });
      if (error) throw error;
      setStep("done");
      toast.success("Purchase submitted! Sam will confirm within 24 hours.");
    } catch {
      toast.error("Failed to submit. Please contact support.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section id="leads" className="py-20 px-6 relative overflow-hidden" style={{ background: "#030712" }}>
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full opacity-5" style={{ background: "#22d3a5", filter: "blur(100px)" }} />
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-xs tracking-[0.3em] text-primary uppercase mb-4" style={{ fontFamily: "Syne" }}>APEX LEAD MARKETPLACE</div>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4" style={{ fontFamily: "Syne", lineHeight: 1.1 }}>
              Warm Leads. Real Conversations.<br />
              <span className="text-primary">Faster Closes.</span>
            </h2>
            <p className="text-white/60 max-w-lg mx-auto">
              Stop cold calling. APEX agents get access to pre-qualified leads who are already interested in life insurance.
            </p>
          </div>

          {/* Packages */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {packages.map(pkg => (
              <div key={pkg.name} className={`relative bg-white/[0.03] border rounded-2xl p-6 ${pkg.popular ? "border-primary/50 ring-1 ring-primary/20" : "border-white/10"}`}>
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full" style={{ fontFamily: "Syne" }}>
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "Syne" }}>{pkg.name}</h3>
                <p className="text-3xl font-extrabold text-primary mb-4" style={{ fontFamily: "Syne" }}>${pkg.price}</p>
                <ul className="space-y-2 mb-6">
                  {pkg.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-white/70">
                      <Check className="h-4 w-4 text-primary flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Button onClick={() => handlePurchase(pkg)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90" style={{ fontFamily: "Syne", fontWeight: 700 }}>
                  Purchase {pkg.name} <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            ))}
          </div>

          {/* Trust signals */}
          <div className="flex flex-wrap justify-center gap-8 mb-12">
            {trustSignals.map(s => (
              <div key={s.text} className="flex items-center gap-2 text-sm text-white/50">
                <s.icon className="h-4 w-4 text-primary" /> {s.text}
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="text-center">
            <h3 className="text-lg font-bold text-white mb-6" style={{ fontFamily: "Syne" }}>How It Works</h3>
            <div className="flex flex-wrap justify-center gap-8">
              {["Choose your package below", "Complete payment via Venmo or CashApp", "Sam confirms within 24hrs — leads delivered"].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-white/60">
                  <div className="h-8 w-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm" style={{ fontFamily: "Syne" }}>{i + 1}</div>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Purchase Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Syne" }}>
              {step === "done" ? "Purchase Submitted!" : `Purchase ${selectedPkg?.name}`}
            </DialogTitle>
          </DialogHeader>

          {step === "choose" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose your payment method to send <span className="font-bold text-foreground">${selectedPkg?.price}</span></p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-12" onClick={() => handlePayClicked("venmo")}>Pay via Venmo</Button>
                <Button variant="outline" className="h-12" onClick={() => handlePayClicked("cashapp")}>Pay via CashApp</Button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">After sending payment, enter your transaction reference below:</p>
              <div className="space-y-2">
                <Label>Transaction ID (optional)</Label>
                <Input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="e.g. Venmo #12345" />
              </div>
              <Button className="w-full" onClick={handleConfirm} disabled={submitting} style={{ fontFamily: "Syne", fontWeight: 700 }}>
                {submitting ? "Submitting..." : "I've Sent the Payment ✓"}
              </Button>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4 space-y-3">
              <div className="h-16 w-16 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Sam will confirm your purchase within 24 hours. You'll receive an email when your leads are ready.</p>
              <Button variant="outline" onClick={() => setShowModal(false)}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
