import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Crown, Search } from "lucide-react";

const NAV_LINKS = [
  { href: "#benefits", label: "Benefits" },
  { href: "#earnings", label: "Earnings" },
  { href: "#testimonials", label: "Success Stories" },
  { href: "#systems", label: "Systems" },
  { href: "#career", label: "Career Path" },
  { href: "#leads", label: "Leads" },
  { href: "#ig-growth", label: "IG Growth" },
];

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const filtered = searchTerm.trim()
    ? NAV_LINKS.filter((l) =>
        l.label.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : [];

  const handleJump = (href: string) => {
    setSearchOpen(false);
    setSearchTerm("");
    setIsOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <motion.nav
      className="fixed top-[32px] left-0 right-0 z-50 bg-[#030712]/90 backdrop-blur-xl border-b border-[#1e293b]/50"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <Crown className="h-8 w-8 text-[#22d3a5]" />
              <div className="absolute inset-0 blur-lg bg-[#22d3a5]/30" />
            </div>
            <span className="text-xl md:text-2xl font-extrabold text-[#22d3a5] font-display">
              APEX Financial
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleJump(link.href);
                }}
                className="text-[#94a3b8] hover:text-[#f1f5f9] transition-colors font-display font-semibold text-sm tracking-wide whitespace-nowrap"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop Search + CTAs */}
          <div className="hidden md:flex items-center gap-3 flex-shrink-0">
            {/* Mini search */}
            <div className="relative">
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-white/5 transition-colors"
              >
                <Search className="h-4 w-4" />
              </button>

              <AnimatePresence>
                {searchOpen && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 220 }}
                    exit={{ opacity: 0, width: 0 }}
                    className="absolute right-0 top-full mt-2 bg-[#0f172a] border border-[#1e293b] rounded-xl shadow-2xl overflow-hidden"
                  >
                    <input
                      ref={inputRef}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Jump to section…"
                      className="w-full px-4 py-2.5 bg-transparent text-sm text-white placeholder:text-white/30 outline-none font-display"
                    />
                    {filtered.length > 0 && (
                      <div className="border-t border-[#1e293b]">
                        {filtered.map((link) => (
                          <button
                            key={link.href}
                            onClick={() => handleJump(link.href)}
                            className="w-full text-left px-4 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors font-display"
                          >
                            {link.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Link to="/login">
              <button className="px-4 py-2 text-sm font-bold font-display text-[#f1f5f9] hover:text-[#22d3a5] transition-colors">
                Login
              </button>
            </Link>
            <Link to="/apply">
              <button className="px-6 py-2.5 text-sm font-bold font-display bg-[#22d3a5] text-[#030712] rounded-lg hover:shadow-[0_0_20px_hsl(168_84%_42%/0.3)] transition-all duration-200">
                Apply Now
              </button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button className="md:hidden p-2 text-[#f1f5f9]" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="md:hidden bg-[#030712]/95 backdrop-blur-xl border-t border-[#1e293b]"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
              {/* Mobile search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Jump to section…"
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 outline-none font-display"
                />
              </div>

              {(searchTerm.trim() ? filtered : NAV_LINKS).map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-[#94a3b8] hover:text-[#f1f5f9] transition-colors py-2 font-display font-semibold"
                  onClick={(e) => {
                    e.preventDefault();
                    handleJump(link.href);
                  }}
                >
                  {link.label}
                </a>
              ))}

              <div className="flex flex-col gap-2 pt-4 border-t border-[#1e293b]">
                <Link to="/login" onClick={() => setIsOpen(false)}>
                  <button className="w-full py-3 text-sm font-bold font-display border-2 border-[#1e293b] text-[#f1f5f9] rounded-lg hover:border-[#22d3a5] transition-colors">
                    Login
                  </button>
                </Link>
                <Link to="/apply" onClick={() => setIsOpen(false)}>
                  <button className="w-full py-3 text-sm font-bold font-display bg-[#22d3a5] text-[#030712] rounded-lg">
                    Apply Now
                  </button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
