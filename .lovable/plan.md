
# Mobile-First Refinement: Native-Feeling Phone Experience

## Overview
After a thorough code review of every page and component, the app has strong mobile foundations (44px tap targets, overflow prevention, responsive grids). This plan focuses on polishing the remaining rough edges to make the phone version feel like a purpose-built native app rather than a scaled-down desktop site.

## Issues Found and Fixes

### 1. Landing Page Navbar - Overlapping with Deals Ticker
The DealsTicker is `fixed top-0` at `h-8` (32px) and the Navbar is `fixed top-8`. On mobile, this creates visual issues where the navbar glass background can bleed into the ticker.

**Fix:** Add `top-[32px]` explicitly to the Navbar on mobile and ensure the hero section's `pt-32` properly accounts for both elements. Ensure the mobile hamburger menu dropdown has solid background (not glass-through) to prevent content bleeding.

### 2. Landing Page - Hero Section Vertical Spacing on Short Phones
The hero uses `min-h-[100dvh]` with `pt-32`, but on shorter phones (iPhone SE at 568px height), the content stacks too tightly with the video, trust indicators, and carrier banner competing for space.

**Fix:** Reduce hero padding on mobile (`pt-24 sm:pt-28`), make the trust indicators grid `gap-3` on mobile, and reduce the carrier banner `max-w-xs` on mobile to prevent it from being too wide.

### 3. Apply Form - Input Fields Not Full-Width on Mobile
The `grid grid-cols-1 md:grid-cols-2` pattern works but some form card containers have padding that reduces the usable input width. On mobile (390px), inputs should fill the entire card width.

**Fix:** Ensure the GlassCard form wrapper uses `p-4 sm:p-8` instead of always `p-8`, giving more breathing room for form inputs on small screens.

### 4. Apply Form - Step Indicators Cramped on Mobile
The 5-step progress bar at the top of the Apply page shows all 5 icons with labels. On a 320px screen, the labels overlap each other.

**Fix:** Hide step labels on very small screens (`hidden xs:block`), showing only the icons. Add a current step indicator text below (e.g., "Step 2 of 5: Experience").

### 5. Login Page - Bottom Section Gets Cut Off
The "Are you an agent?" card and the "Contact your administrator" text at the bottom of the login page can get cut off on shorter phones because the page uses `min-h-screen flex items-center`.

**Fix:** Change to `min-h-[100dvh]` and add `py-8` instead of just `p-4` for consistent vertical padding. Ensure the content scrolls naturally rather than trying to center in viewport.

### 6. Dashboard Quick Actions - Text Truncation on Mobile
The 4 quick action cards use `grid grid-cols-2 md:grid-cols-4`. On a 320px phone, the text "Agent Portal" and "View applicants" can wrap awkwardly.

**Fix:** Use `text-[13px]` on mobile for card titles and `text-[10px]` for subtitles to prevent wrapping while maintaining readability. Add `truncate` to subtitles.

### 7. Mobile Sidebar - Safe Area Handling
The mobile sidebar panel uses `pt-[env(safe-area-inset-top)]` but the sidebar content inside GlobalSidebar doesn't account for the notch. On iPhones with dynamic island, the APEX logo can overlap with the notch area.

**Fix:** Add `pt-[max(1rem,env(safe-area-inset-top))]` to the sidebar's inner container and `pb-[max(1rem,env(safe-area-inset-bottom))]` to the bottom action area.

### 8. ApplicationToast - Overlaps "Start Your Journey" Button
The synthetic notification popup is `fixed bottom-6 left-6` which can overlap with the "Start Your Journey" CTA button when the hero section is visible.

**Fix:** Move the toast position to `bottom-20 sm:bottom-6` on mobile so it clears the CTA, or `left-4 right-4 sm:left-6 sm:right-auto` for full-width on mobile for better readability.

### 9. CareerPathwaySection - Floating Phase Sidebar Hidden on Mobile
The floating phase navigation sidebar is `hidden md:flex`, so mobile users have no way to quickly jump between career phases.

**Fix:** Add a compact horizontal sticky phase bar at the top of the section on mobile (only visible when section is in viewport) with small phase dots that scroll the user to each phase.

### 10. Select Dropdowns - Need Solid Background
The Select dropdowns (state selector on Apply, availability selector) use default styling. On mobile, ensure the `SelectContent` has a solid `bg-popover` background with high `z-[99]` to prevent see-through issues.

**Fix:** Verify all SelectContent instances have proper opaque backgrounds. The shadcn Select already handles this, but add explicit `bg-popover` class as insurance.

### 11. Footer - Grid Stacking Too Tight on Mobile
The footer grid uses `grid-cols-1 md:grid-cols-4` but on mobile, the four sections (Brand, Quick Links, Legal, Copyright) stack with no visual separation.

**Fix:** Add `space-y-8` between stacked sections on mobile and a subtle `border-b border-border/30 pb-6` to the Brand section when stacked.

### 12. Global CSS - Prevent iOS Bounce/Overscroll on Fixed Elements
Add `-webkit-overflow-scrolling: touch` and `overscroll-behavior: contain` to scrollable containers to prevent the rubber-band effect from interfering with the sidebar and fixed headers.

---

## Files to Modify

1. **`src/components/landing/Navbar.tsx`** - Mobile menu solid background, safe area padding
2. **`src/components/landing/HeroSection.tsx`** - Tighter mobile spacing, smaller trust indicator grid
3. **`src/pages/Apply.tsx`** - Responsive form padding, step indicator improvements
4. **`src/pages/Login.tsx`** - dvh height, scroll-safe centering
5. **`src/pages/Dashboard.tsx`** - Quick action text sizing tweaks
6. **`src/components/layout/SidebarLayout.tsx`** - Safe area improvements for mobile sidebar
7. **`src/components/landing/ApplicationToast.tsx`** - Mobile positioning to avoid CTA overlap
8. **`src/components/landing/CareerPathwaySection.tsx`** - Mobile phase navigation
9. **`src/components/landing/Footer.tsx`** - Mobile stacking improvements
10. **`src/index.css`** - Overscroll behavior, additional mobile refinements
