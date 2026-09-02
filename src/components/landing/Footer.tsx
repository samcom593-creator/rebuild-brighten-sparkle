import { forwardRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Crown, Mail, Phone, MapPin } from "lucide-react";
import { applyHrefWithRef } from "@/lib/refSlug";

const CURRENT_YEAR = new Date().getFullYear();

export const Footer = forwardRef<HTMLElement>((_, ref) => {
  const [searchParams] = useSearchParams();
  const applyHref = applyHrefWithRef(searchParams.get("ref"));
  return (
    <footer ref={ref} className="py-12 border-t border-[#1e293b] bg-white dark:bg-[#030712]">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2 border-b border-[#1e293b]/30 pb-6 md:border-b-0 md:pb-0">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <Crown className="h-8 w-8 text-[#e8bb2b]" />
              <span className="text-xl font-extrabold text-[#e8bb2b] font-display">APEX Financial</span>
            </Link>
            <p className="text-sm text-[#94a3b8] max-w-sm mb-4">
              One connected operating system for recruiting, contracting, training,
              production, and agency growth.
            </p>
            <div className="flex flex-col gap-2 text-sm text-[#94a3b8]">
              <a href="mailto:info@apex-financial.org" className="flex min-h-6 items-center gap-2 hover:text-[#e8bb2b] transition-colors">
                <Mail className="h-4 w-4" /> info@apex-financial.org
              </a>
              <a href="tel:+14697676068" className="flex min-h-6 items-center gap-2 hover:text-[#e8bb2b] transition-colors">
                <Phone className="h-4 w-4" /> (469) 767-6068
              </a>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Nationwide Opportunities
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-bold mb-4 text-[#f1f5f9] font-display">Quick Links</h3>
            <ul className="space-y-2 text-sm text-[#94a3b8]">
              <li><a href="#agency-system" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Platform</a></li>
              <li><a href="#benefits" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Capabilities</a></li>
              <li><a href="#earnings" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Growth Paths</a></li>
              <li><a href="#receipts" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Receipts</a></li>
              <li><Link to={applyHref} className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Apply Now</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold mb-4 text-[#f1f5f9] font-display">Legal</h3>
            <ul className="space-y-2 text-sm text-[#94a3b8]">
              <li><Link to="/privacy" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Terms of Service</Link></li>
              <li><Link to="/data-deletion" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Delete My Data</Link></li>
              <li><Link to="/disclosures" className="inline-flex min-h-6 items-center hover:text-[#e8bb2b] transition-colors">Disclosures</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-[#1e293b] mt-8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="text-sm text-[#94a3b8]">
              © {CURRENT_YEAR} APEX Financial Empire. All rights reserved.
            </p>
            <p className="text-xs text-[#e8bb2b] font-bold font-display">
              Powered by Apex Financial
            </p>
          </div>
          <p className="text-xs text-[#8395ab] max-w-xl text-center md:text-right">
            Income examples are illustrative and not guaranteed. Individual results vary based on effort, skill, and market conditions.
          </p>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";
