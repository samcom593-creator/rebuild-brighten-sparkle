import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    // 8px spacing grid (base unit)
    spacing: {
      '0': '0px',
      'px': '1px',
      '0.5': '0.125rem', // 2px
      '1': '0.25rem',    // 4px
      '1.5': '0.375rem', // 6px
      '2': '0.5rem',     // 8px (base)
      '2.5': '0.625rem', // 10px
      '3': '0.75rem',    // 12px
      '3.5': '0.875rem', // 14px
      '4': '1rem',       // 16px (2 units)
      '5': '1.25rem',    // 20px
      '6': '1.5rem',     // 24px (3 units)
      '7': '1.75rem',    // 28px
      '8': '2rem',       // 32px (4 units)
      '9': '2.25rem',    // 36px
      '10': '2.5rem',    // 40px (5 units)
      '11': '2.75rem',   // 44px
      '12': '3rem',      // 48px (6 units)
      '14': '3.5rem',    // 56px (7 units)
      '16': '4rem',      // 64px (8 units)
      '20': '5rem',      // 80px (10 units)
      '24': '6rem',      // 96px (12 units)
      '28': '7rem',      // 112px
      '32': '8rem',      // 128px (16 units)
      '36': '9rem',      // 144px
      '40': '10rem',     // 160px (20 units)
      '44': '11rem',     // 176px
      '48': '12rem',     // 192px (24 units)
      '52': '13rem',     // 208px
      '56': '14rem',     // 224px
      '60': '15rem',     // 240px
      '64': '16rem',     // 256px (32 units)
      '72': '18rem',     // 288px
      '80': '20rem',     // 320px (40 units)
      '96': '24rem',     // 384px (48 units)
    },
    extend: {
      colors: {
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
        // APEX custom colors
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
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Clash Display", "Inter", "system-ui", "sans-serif"],
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
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "apex-gradient": "linear-gradient(135deg, hsl(168 84% 42%), hsl(160 84% 39%))",
        "apex-gradient-soft": "linear-gradient(135deg, hsl(168 84% 42% / 0.2), hsl(160 84% 39% / 0.2))",
      },
      boxShadow: {
        "apex-glow": "0 0 20px hsl(168 84% 42% / 0.3), 0 0 40px hsl(168 84% 42% / 0.1)",
        "apex-glow-strong": "0 0 30px hsl(168 84% 42% / 0.4), 0 0 60px hsl(168 84% 42% / 0.2)",
        glass: "0 8px 32px hsl(222 47% 3% / 0.5)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;