import { Link } from "react-router-dom";
import { Crown, Mail, Phone, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer className="py-12 border-t border-border bg-card/50">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <Crown className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold gradient-text">APEX Financial</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Building the next generation of financial professionals. 
              Join America's fastest-growing life insurance agency.
            </p>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <a href="mailto:info@apex-financial.org" className="flex items-center gap-2 hover:text-primary transition-colors">
                <Mail className="h-4 w-4" />
                info@apex-financial.org
              </a>
              <a href="tel:+14697676068" className="flex items-center gap-2 hover:text-primary transition-colors">
                <Phone className="h-4 w-4" />
                (469) 767-6068
              </a>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Nationwide Opportunities
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#benefits" className="hover:text-primary transition-colors">Benefits</a>
              </li>
              <li>
                <a href="#earnings" className="hover:text-primary transition-colors">Earnings</a>
              </li>
              <li>
                <a href="#testimonials" className="hover:text-primary transition-colors">Success Stories</a>
              </li>
              <li>
                <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
              </li>
              <li>
                <Link to="/apply" className="hover:text-primary transition-colors">Apply Now</Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
              </li>
              <li>
                <Link to="/disclosures" className="hover:text-primary transition-colors">Disclosures</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} APEX Financial Empire. All rights reserved.
            </p>
            <p className="text-xs text-primary font-medium">
              Powered by Apex Financial
            </p>
          </div>
          <p className="text-xs text-muted-foreground max-w-xl text-center md:text-right">
            Income examples are illustrative and not guaranteed. Individual results vary based on effort, skill, and market conditions. 
            Insurance licenses required in most states.
          </p>
        </div>
      </div>
    </footer>
  );
}
