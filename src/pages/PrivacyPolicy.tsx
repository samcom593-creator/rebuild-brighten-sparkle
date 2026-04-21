import { Shield, Mail } from "lucide-react";

export default function PrivacyPolicy() {
  const updated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="apex-headline text-3xl md:text-4xl font-bold">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground mt-1">Last updated: {updated}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Information we collect</h2>
          <p className="text-muted-foreground leading-relaxed">
            We collect information you provide directly, including:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Name, email, and phone number</li>
            <li>Instagram username and profile data</li>
            <li>Message content from direct messages</li>
            <li>Application and licensing information you submit</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How we use information</h2>
          <p className="text-muted-foreground leading-relaxed">We use this information to:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Respond to inquiries</li>
            <li>Qualify leads for our services</li>
            <li>Improve our marketing and outreach</li>
            <li>Deliver notifications related to your account or application</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Data security</h2>
          <p className="text-muted-foreground leading-relaxed">
            Your data is encrypted in transit and at rest, and stored securely in Supabase.
            We apply row-level security, role-based access controls, and regular audits.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Third parties</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use Meta (Instagram), Supabase, Resend, and Discord to process your data.
            We never sell your information to advertisers or unrelated third parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Your rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            You may request access to, correction of, or deletion of your personal data at any
            time by contacting us. We respond to verified requests within 30 days.
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
