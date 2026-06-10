import { FileText, Mail } from "lucide-react";

export default function TermsOfService() {
  const updated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-md bg-primary/15 flex items-center justify-center">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="apex-headline text-3xl md:text-4xl font-bold">Terms of Service</h1>
            <p className="text-sm text-muted-foreground mt-1">Last updated: {updated}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Acceptance</h2>
          <p className="text-muted-foreground leading-relaxed">
            By using APEX Financial's services (the "Service"), you agree to these Terms. If you don't agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Who can use APEX</h2>
          <p className="text-muted-foreground leading-relaxed">
            You must be 18+, legally able to enter contracts, and — for agent functions — legally permitted to sell life insurance in the states where you operate.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Your account</h2>
          <p className="text-muted-foreground leading-relaxed">
            You are responsible for activity under your account and keeping credentials secure. Notify us of any unauthorized use.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Acceptable use</h2>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>No fraud, misrepresentation, or unlawful activity</li>
            <li>No spam, scraping, or reverse engineering</li>
            <li>No uploading malicious code or overloading our infrastructure</li>
            <li>Respect applicants' and clients' privacy and data</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Content you submit</h2>
          <p className="text-muted-foreground leading-relaxed">
            You retain ownership of content you submit (applications, notes, uploads). You grant APEX a non-exclusive license to use it for operating the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may suspend or terminate accounts that violate these Terms or put our platform or clients at risk. You may close your account at any time.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Disclaimers</h2>
          <p className="text-muted-foreground leading-relaxed">
            The Service is provided "as is". We don't guarantee uninterrupted availability or specific outcomes. Nothing here is legal, tax, or financial advice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Limitation of liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            To the maximum extent allowed by law, APEX is not liable for indirect, incidental, or consequential damages.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Changes</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update these Terms. Material changes will be announced. Continued use after changes means you accept them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-4 w-4" />
            <a href="mailto:info@kingofsales.net" className="text-primary hover:underline">
              info@kingofsales.net
            </a>
          </div>
        </section>

        <div className="border-t border-border/40 pt-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} APEX Financial · Building Empires · Protecting Families
        </div>
      </div>
    </div>
  );
}
