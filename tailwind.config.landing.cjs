// wave-53a (2026-06-09): landing-only Tailwind config.
//
// Mirrors tailwind.config.ts exactly (theme + plugins identical) but narrows
// `content` to the 17 landing-reachable files from
// scripts/check-vendor-icons-landing-census.mjs's LANDING_FILES list. This is
// the additive measurement step on the path to wave-54's full extraction:
//
//   wave-53a (NOW): emit landing.css with this config, measure raw/gz size
//                   against current cold-landing index-*.css (250KB raw /
//                   37KB gz). Validate the -25 to -30KB gz projection from
//                   wave-52 recon BEFORE doing the 60-90 min cutover.
//
//   wave-54   :    if measurement confirms, wire this config into a Vite
//                  pre-build step that emits public/landing.css, swap
//                  index.html <link>, lazy-import the admin-only utility
//                  block of src/index.css post-first-paint, add pre-commit
//                  size guard scripts/check-landing-css-size.mjs.
//
// Why a separate file (vs modifying tailwind.config.ts): keeps the production
// build path untouched while wave-53a measures. Zero risk to live landing.
// CommonJS extension (.cjs) because tailwind v3 CLI prefers CJS configs in
// repos with "type":"module" in package.json (vite/esbuild handle the .ts
// config via PostCSS but the CLI does not).

const base = require("./tailwind.config.ts");

// `import type { Config }` makes tailwind.config.ts an ESM default-export
// module. Node's require() of it via ts-node won't work directly — but the
// tailwind CLI v3 resolves .ts configs through its own loader. To keep this
// landing config dep-free we duplicate the theme inline below instead of
// importing from .ts.

const LANDING_CONTENT = [
  // Mirrors scripts/check-vendor-icons-landing-census.mjs LANDING_FILES + entry
  // index.html. Keep in sync with that list — it's the canonical source of
  // truth for "what renders on cold landing."
  "./index.html",
  "./src/main.tsx", // bootstraps the page
  "./src/App.tsx", // route shell + eager landing-reachable banners
  "./src/pages/Index.tsx",
  "./src/components/landing/Navbar.tsx",
  "./src/components/landing/HeroSection.tsx",
  "./src/components/landing/DealsTicker.tsx",
  "./src/components/landing/LiveStatsCounterStrip.tsx",
  "./src/components/landing/RecentHiresTicker.tsx",
  "./src/components/landing/Testimonials.tsx",
  "./src/components/landing/BenefitsSection.tsx",
  "./src/components/landing/EarningsSection.tsx",
  "./src/components/landing/CareerPathwaySection.tsx",
  "./src/components/landing/ApexLeadsSection.tsx",
  "./src/components/landing/InstagramGrowthSection.tsx",
  "./src/components/landing/RecruitFAQ.tsx",
  "./src/components/landing/CTASection.tsx",
  "./src/components/landing/Footer.tsx",
  "./src/components/landing/StickyMobileCTA.tsx",
  "./src/components/SupabaseHealthBanner.tsx",
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: LANDING_CONTENT,
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    spacing: {
      "0": "0px",
      px: "1px",
      "0.5": "0.125rem",
      "1": "0.25rem",
      "1.5": "0.375rem",
      "2": "0.5rem",
      "2.5": "0.625rem",
      "3": "0.75rem",
      "3.5": "0.875rem",
      "4": "1rem",
      "5": "1.25rem",
      "6": "1.5rem",
      "7": "1.75rem",
      "8": "2rem",
      "9": "2.25rem",
      "10": "2.5rem",
      "11": "2.75rem",
      "12": "3rem",
      "14": "3.5rem",
      "16": "4rem",
      "20": "5rem",
      "24": "6rem",
      "28": "7rem",
      "32": "8rem",
      "36": "9rem",
      "40": "10rem",
      "44": "11rem",
      "48": "12rem",
      "52": "13rem",
      "56": "14rem",
      "60": "15rem",
      "64": "16rem",
      "72": "18rem",
      "80": "20rem",
      "96": "24rem",
    },
    extend: {
      colors: {
        // BLACK + GOLD REBRAND — the landing bundle has its own Tailwind config,
        // so the emerald/teal -> gold remap from tailwind.config.ts must be
        // mirrored here or the public page keeps rendering the old teal accent.
        emerald: {
          50:"#fdf8e7",100:"#faefc4",200:"#f5e08d",300:"#efcd52",400:"#e8bb2b",
          500:"#d9a41a",600:"#bb7f13",700:"#955c14",800:"#7b4a18",900:"#683e1a",950:"#3d2009",
        },
        teal: {
          50:"#fdf8e7",100:"#faefc4",200:"#f5e08d",300:"#efcd52",400:"#e8bb2b",
          500:"#d9a41a",600:"#bb7f13",700:"#955c14",800:"#7b4a18",900:"#683e1a",950:"#3d2009",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        apex: {
          navy: "hsl(var(--apex-navy))",
          "navy-light": "hsl(var(--apex-navy-light))",
          "navy-lighter": "hsl(var(--apex-navy-lighter))",
          slate: "hsl(var(--apex-slate))",
          teal: "hsl(var(--apex-teal))",
          "teal-light": "hsl(var(--apex-teal-light))",
          "teal-glow": "hsl(var(--apex-teal-glow))",
          emerald: "hsl(var(--apex-emerald))",
          gold: "hsl(var(--apex-gold))",
          success: "hsl(var(--apex-success))",
          warning: "hsl(var(--apex-warning))",
          error: "hsl(var(--apex-error))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Syne", "system-ui", "sans-serif"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(20px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
        "count-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "fade-in-up": "fade-in-up 0.6s ease-out forwards",
        "slide-in-right": "slide-in-right 0.5s ease-out forwards",
        "scale-in": "scale-in 0.3s ease-out forwards",
        shimmer: "shimmer 2s infinite linear",
        "pulse-ring": "pulse-ring 1.5s ease-out infinite",
        "count-up": "count-up 0.5s ease-out forwards",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "apex-gradient":
          "linear-gradient(135deg, hsl(168 84% 42%), hsl(160 84% 39%))",
        "apex-gradient-soft":
          "linear-gradient(135deg, hsl(168 84% 42% / 0.2), hsl(160 84% 39% / 0.2))",
      },
      boxShadow: {
        "apex-glow":
          "0 0 20px hsl(168 84% 42% / 0.3), 0 0 40px hsl(168 84% 42% / 0.1)",
        "apex-glow-strong":
          "0 0 30px hsl(168 84% 42% / 0.4), 0 0 60px hsl(168 84% 42% / 0.2)",
        glass: "0 8px 32px hsl(222 47% 3% / 0.5)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
