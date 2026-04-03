import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Crown, Mail, Phone, MapPin } from "lucide-react";

export const Footer = forwardRef<HTMLElement>((_, ref) => {
  return (
    <footer ref={ref} className="py-12 border-t border-[#1e293b] bg-[#030712]">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2 border-b border-[#1e293b]/30 pb-6 md:border-b-0 md:pb-0">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <Crown className="h-8 w-8 text-[#22d3a5]" />
              <span className="text-xl font-extrabold text-[#22d3a5] font-display">APEX Financial</span>
            </Link>
            <p className="text-sm text-[#94a3b8] max-w-sm mb-4">
              Building the next generation of financial professionals. 
              Join America's fastest-growing life insurance agency.
            </p>
            <div className="flex flex-col gap-2 text-sm text-[#94a3b8]">
              <a href="mailto:info@apex-financial.org" className="flex items-center gap-2 hover:text-[#22d3a5] transition-colors">
                <Mail className="h-4 w-4" /> info@apex-financial.org
              </a>
              <a href="tel:+14697676068" className="flex items-center gap-2 hover:text-[#22d3a5] transition-colors">
                <Phone className="h-4 w-4" /> (469) 767-6068
              </a>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Nationwide Opportunities
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-4 text-[#f1f5f9] font-display">Quick Links</h4>
            <ul className="space-y-2 text-sm text-[#94a3b8]">
              <li><a href="#benefits" className="hover:text-[#22d3a5] transition-colors">Benefits</a></li>
              <li><a href="#earnings" className="hover:text-[#22d3a5] transition-colors">Earnings</a></li>
              <li><a href="#testimonials" className="hover:text-[#22d3a5] transition-colors">Success Stories</a></li>
              <li><Link to="/apply" className="hover:text-[#22d3a5] transition-colors">Apply Now</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-4 text-[#f1f5f9] font-display">Legal</h4>
            <ul className="space-y-2 text-sm text-[#94a3b8]">
              <li><Link to="/privacy" className="hover:text-[#22d3a5] transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-[#22d3a5] transition-colors">Terms of Service</Link></li>
              <li><Link to="/disclosures" className="hover:text-[#22d3a5] transition-colors">Disclosures</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-[#1e293b] mt-8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="text-sm text-[#94a3b8]">
              © {new Date().getFullYear()} APEX Financial Empire. All rights reserved.
            </p>
            <p className="text-xs text-[#22d3a5] font-bold font-display">
              Powered by Apex Financial
            </p>
          </div>
          <p className="text-xs text-[#64748b] max-w-xl text-center md:text-right">
            Income examples are illustrative and not guaranteed. Individual results vary based on effort, skill, and market conditions.
          </p>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = "Footer";
