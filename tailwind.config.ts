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
      // v9 Wave 0: APEX design tokens. AgentLink/Agent Cloud-class restraint.
      // One accent. Three surfaces. Six type sizes. Use these instead of
      // creating new tokens or hard-coded colors.
      fontSize: {
        '11': ['11px', { lineHeight: '14px' }],
        '12': ['12px', { lineHeight: '16px' }],
        '14': ['14px', { lineHeight: '20px' }],
        '16': ['16px', { lineHeight: '22px' }],
        '20': ['20px', { lineHeight: '28px' }],
        '28': ['28px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
      },
      transitionDuration: {
        'fast': '120ms',
        'base': '180ms',
        'slow': '240ms',
      },
      colors: {
        // ── BLACK + GOLD REBRAND ────────────────────────────────────────────
        // The app shipped with a teal/emerald accent. Rather than rewrite the
        // ~1,850 hardcoded emerald-*/teal-* utilities across 253 files (huge
        // diff, huge regression surface), we remap those two Tailwind palettes
        // onto the APEX gold ramp. Every existing `bg-emerald-400`,
        // `text-teal-300`, `border-emerald-500/30` etc. becomes gold with zero
        // component edits, and the change is reversible by deleting this block.
        // Semantic `green-*` is deliberately left alone so success states stay
        // readable as success.
        emerald: {
          50:"#fdf8e7",100:"#faefc4",200:"#f5e08d",300:"#efcd52",400:"#e8bb2b",
          500:"#d9a41a",600:"#bb7f13",700:"#955c14",800:"#7b4a18",900:"#683e1a",950:"#3d2009",
        },
        teal: {
          50:"#fdf8e7",100:"#faefc4",200:"#f5e08d",300:"#efcd52",400:"#e8bb2b",
          500:"#d9a41a",600:"#bb7f13",700:"#955c14",800:"#7b4a18",900:"#683e1a",950:"#3d2009",
        },
        apex: {
          // v9 wave-0 tokens (single source of truth)
          bg:           "hsl(var(--apex-bg))",
          card:         "hsl(var(--apex-card))",
          hover:        "hsl(var(--apex-hover))",
          border:       "hsl(var(--apex-border))",
          'border-strong': "hsl(var(--apex-border-strong))",
          text:         "hsl(var(--apex-text))",
          mute:         "hsl(var(--apex-text-mute))",
          dim:          "hsl(var(--apex-text-dim))",
          accent:       "hsl(var(--apex-accent))",
          'accent-soft':   "hsl(var(--apex-accent-soft))",
          'accent-strong': "hsl(var(--apex-accent-strong))",
          success:      "hsl(var(--apex-success))",
          warning:      "hsl(var(--apex-warning))",
          danger:       "hsl(var(--apex-danger))",
          info:         "hsl(var(--apex-info))",
          neutral:      "hsl(var(--apex-neutral))",
          // Legacy apex.* keys (pre-wave-0). Kept here so the merged Tailwind
          // build still emits the prior bg-apex-navy / text-apex-teal classes
          // some older surfaces still reference (see src/index.css :root).
          navy:         "hsl(var(--apex-navy))",
          "navy-light": "hsl(var(--apex-navy-light))",
          "navy-lighter": "hsl(var(--apex-navy-lighter))",
          slate:        "hsl(var(--apex-slate))",
          teal:         "hsl(var(--apex-teal))",
          "teal-light": "hsl(var(--apex-teal-light))",
          "teal-glow":  "hsl(var(--apex-teal-glow))",
          emerald:      "hsl(var(--apex-emerald))",
          gold:         "hsl(var(--apex-gold))",
          error:        "hsl(var(--apex-error))",
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
        // v9 wave-C: legacy apex.* keys (navy / teal / emerald / gold) merged
        // into the wave-0 token block above. Duplicate `apex:` object literal
        // keys collapse to the LAST one in JS spec, which silently wiped the
        // wave-0 bg/card/border/text/mute/accent classes from the Tailwind
        // build. Merging both into the single block above keeps both APIs
        // alive and unblocks RecruitFAQ + Wave B tile usage.
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
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        // 2026-08-06: these four were still teal→emerald and the emerald→gold
        // palette remap above does NOT reach them — they are literal hsl in the
        // config, not palette lookups. `bg-apex-gradient shadow-apex-glow` is
        // the Login "Sign In" button, so the primary CTA of the whole app was
        // rendering bright green with a green halo long after the rebrand.
        // Caught by screenshotting the rendered page, not by grepping src/.
        // Stops match --gradient-primary (src/index.css:98) exactly, and the
        // pairing with text-primary-foreground measures 9.9:1.
        "apex-gradient": "linear-gradient(135deg, hsl(45 85% 52%), hsl(38 88% 46%))",
        "apex-gradient-soft": "linear-gradient(135deg, hsl(45 85% 52% / 0.2), hsl(38 88% 46% / 0.2))",
      },
      boxShadow: {
        "apex-glow": "0 0 20px hsl(45 85% 52% / 0.3), 0 0 40px hsl(45 85% 52% / 0.1)",
        "apex-glow-strong": "0 0 30px hsl(45 85% 52% / 0.4), 0 0 60px hsl(45 85% 52% / 0.2)",
        glass: "0 8px 32px hsl(222 47% 3% / 0.5)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;