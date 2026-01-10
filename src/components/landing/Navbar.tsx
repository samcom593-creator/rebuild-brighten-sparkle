import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Crown } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const navLinks = [{
    href: "#benefits",
    label: "Benefits"
  }, {
    href: "#earnings",
    label: "Earnings"
  }, {
    href: "#testimonials",
    label: "Success Stories"
  }, {
    href: "#faq",
    label: "FAQ"
  }];
  return <motion.nav className="fixed top-0 left-0 right-0 z-50 glass-strong" initial={{
    y: -100
  }} animate={{
    y: 0
  }} transition={{
    duration: 0.5
  }}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="relative">
              <Crown className="h-8 w-8 text-primary" />
              <div className="absolute inset-0 blur-lg bg-primary/30" />
            </div>
            <span className="text-xl md:text-2xl font-bold gradient-text">
              APEX Financial
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(link => {})}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link to="/login">
              <GradientButton variant="ghost" size="sm">
                Login
              </GradientButton>
            </Link>
            <Link to="/apply">
              <GradientButton size="sm">
                Apply Now
              </GradientButton>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button className="md:hidden p-2 text-foreground" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && <motion.div className="md:hidden glass-strong border-t border-border" initial={{
        opacity: 0,
        height: 0
      }} animate={{
        opacity: 1,
        height: "auto"
      }} exit={{
        opacity: 0,
        height: 0
      }} transition={{
        duration: 0.2
      }}>
            <div className="container mx-auto px-4 py-4 flex flex-col gap-4">
              {navLinks.map(link => <a key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground transition-colors py-2" onClick={() => setIsOpen(false)}>
                  {link.label}
                </a>)}
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                <Link to="/login" onClick={() => setIsOpen(false)}>
                  <GradientButton variant="outline" className="w-full">
                    Login
                  </GradientButton>
                </Link>
                <Link to="/apply" onClick={() => setIsOpen(false)}>
                  <GradientButton className="w-full">
                    Apply Now
                  </GradientButton>
                </Link>
              </div>
            </div>
          </motion.div>}
      </AnimatePresence>
    </motion.nav>;
}